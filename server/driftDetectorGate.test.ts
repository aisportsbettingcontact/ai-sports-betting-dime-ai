/**
 * server/driftDetectorGate.test.ts — the drift detector must PROPOSE, not patch.
 *
 * `migrateCalibrationConstants()` rewrites `MLBAIModel.py` in place, on a monthly
 * schedule, with no proposal record, no approver and no version stamp. It is the
 * Stage 1 audit's named D15 #2 exemplar (gap F4.1, HIGH), and DR-009 forbids a new
 * agent seat from doing exactly what this shipped code already does.
 *
 * WHAT PHASE 1 ACTUALLY FOUND — it changes what these tests must protect.
 * The patcher's regex requires SINGLE-quoted keys (`'f5_share':`). The model file
 * has used DOUBLE quotes since 2026-05-09, when commit 4c27b4f5f reformatted it.
 * So the patcher has matched 0 of 9 constants for 89 days: it opens the file,
 * changes one comment line, writes it back, and reports `constantsPatched: 0`.
 *
 * That means the danger is NOT that a bad recalibration is live — none has ever
 * been applied. The danger is the reverse: repairing the regex would take a
 * dormant ungated writer and make it live. So the gate lands FIRST, and these
 * tests are what stop the patch path from being reachable by default.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveRecalMode,
  buildProposalEnvelope,
  RECAL_PROPOSER,
} from "./mlbRecalibrationGate";
import { applyOrPropose } from "./mlbDriftDetector";

const SERVER = resolve(__dirname);

describe("the default is propose — patching is the exception, not the rule", () => {
  it("an empty environment resolves to propose", () => {
    expect(resolveRecalMode({}).mode).toBe("propose");
  });

  it("only the explicit override reaches autopatch", () => {
    expect(resolveRecalMode({ MLB_RECAL_MODE: "autopatch" }).mode).toBe(
      "autopatch"
    );
    expect(resolveRecalMode({ MLB_RECAL_MODE: "propose" }).mode).toBe(
      "propose"
    );
    // Anything unrecognised must fail SAFE, not open.
    expect(resolveRecalMode({ MLB_RECAL_MODE: "yes" }).mode).toBe("propose");
    expect(resolveRecalMode({ MLB_RECAL_MODE: "AUTOPATCH" }).mode).toBe(
      "propose"
    );
    expect(resolveRecalMode({ MLB_RECAL_MODE: "" }).mode).toBe("propose");
  });

  it("names its own source, so a live run can be audited from logs alone", () => {
    expect(resolveRecalMode({}).source).toMatch(/default/i);
    expect(resolveRecalMode({ MLB_RECAL_MODE: "autopatch" }).source).toMatch(
      /OVERRIDE/
    );
  });
});

describe("the model file is never written on the default path", () => {
  // BEHAVIOURAL, not structural. The first version of this suite asserted that
  // the string "resolveRecalMode" appeared near the patch call — and mutation
  // testing showed that passed when the guard was replaced with `if (true)`,
  // i.e. when the unconditional patch was restored. An injectable patcher tests
  // the property that actually matters: on the default path it is NEVER CALLED.
  const propose = { mode: "propose" as const, source: "test" };
  const autopatch = { mode: "autopatch" as const, source: "test" };
  const calibration = { overall: { f5_run_share: 0.56 } };

  it("does not call the patcher in propose mode", async () => {
    const patcher = vi.fn().mockResolvedValue({ patched: 9, backup: "/tmp/b" });
    const result = await applyOrPropose(
      propose,
      calibration,
      "SCHEDULED",
      patcher
    );
    expect(
      patcher,
      "the model file must not be touched without an approval"
    ).not.toHaveBeenCalled();
    expect(result).toEqual({ patched: 0, backup: "" });
  });

  it("does not call the patcher for ANY unrecognised mode value", async () => {
    const patcher = vi.fn().mockResolvedValue({ patched: 9, backup: "/tmp/b" });
    for (const mode of ["", "yes", "AUTOPATCH", "1", "true"]) {
      await applyOrPropose(
        { mode: mode as never, source: "test" },
        calibration,
        "SCHEDULED",
        patcher
      );
    }
    expect(
      patcher,
      "anything but the exact override must fail safe"
    ).not.toHaveBeenCalled();
  });

  it("calls the patcher ONLY under the explicit autopatch override", async () => {
    const patcher = vi.fn().mockResolvedValue({ patched: 9, backup: "/tmp/b" });
    const result = await applyOrPropose(
      autopatch,
      calibration,
      "SCHEDULED",
      patcher
    );
    expect(patcher).toHaveBeenCalledOnce();
    expect(patcher).toHaveBeenCalledWith(calibration, "SCHEDULED");
    expect(result.patched).toBe(9);
  });

  it("logs the override at CRITICAL, and logs nothing alarming on the default path", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await applyOrPropose(propose, calibration, "SCHEDULED", vi.fn());
      expect(err, "the safe path must not shout").not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join(" ")).toMatch(/propose mode/);

      await applyOrPropose(
        autopatch,
        calibration,
        "SCHEDULED",
        vi.fn().mockResolvedValue({ patched: 1, backup: "" })
      );
      expect(err.mock.calls.flat().join(" ")).toMatch(
        /CRITICAL[\s\S]*autopatch/
      );
    } finally {
      err.mockRestore();
      log.mockRestore();
    }
  });

  it("triggerRecalibration itself writes no file", () => {
    const src = readFileSync(resolve(SERVER, "mlbDriftDetector.ts"), "utf-8");
    const fn = src.slice(
      src.indexOf("export async function triggerRecalibration")
    );
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).not.toMatch(/fs\.writeFileSync/);
  });
});

describe("what the learning log records", () => {
  const base = {
    calibration: { overall: { f5_run_share: 0.56 } },
    newF5Share: 0.56,
    newNrfiRate: 0.51,
    backtestElapsedSec: 12,
    calibrationJsonPath: "/tmp/cal.json",
  };

  it("a proposed recalibration is recorded as PROPOSED, not APPLIED", () => {
    const env = buildProposalEnvelope({ ...base, mode: "propose" });
    expect(env.gate.status).toBe("PROPOSED");
    expect(env.gate.proposedBy).toBe(RECAL_PROPOSER);
    expect(env.gate.autopatchOverride).toBeUndefined();
  });

  it("an autopatch run is recorded as APPLIED and flagged as an override", () => {
    const env = buildProposalEnvelope({
      ...base,
      mode: "autopatch",
      constantsPatched: 7,
    });
    expect(env.gate.status).toBe("APPLIED");
    expect(env.gate.autopatchOverride).toBe(true);
  });

  it("carries the calibration it proposes, so a decision has something to decide on", () => {
    const env = buildProposalEnvelope({ ...base, mode: "propose" });
    expect(env.calibration).toEqual(base.calibration);
    expect(env.summary.newF5Share).toBe(0.56);
  });
});

describe("Phase 1's finding, pinned so it cannot rot", () => {
  const model = readFileSync(resolve(SERVER, "MLBAIModel.py"), "utf-8");
  const detector = readFileSync(
    resolve(SERVER, "mlbDriftDetector.ts"),
    "utf-8"
  );

  it("the patcher's regex and the model file's quoting still disagree", () => {
    // This is the measured fact the incident records. If someone repairs the
    // regex, this test fails — which is the point: repairing it must be a
    // deliberate act reviewed alongside the gate, never a drive-by fix.
    const keys = [
      "f5_share",
      "nrfi_rate",
      "fg_mean",
      "i1_share",
      "fg_home_win_rate",
    ];
    for (const key of keys) {
      expect(model, `${key} should be present`).toMatch(
        new RegExp(`["']${key}["']\\s*:`)
      );
      const patcherPattern = new RegExp(
        `('${key}':\\s*)([-\\d.]+)(,\\s*#[^\\n]*)`
      );
      expect(
        patcherPattern.test(model),
        `${key}: the patcher matches again — repair it only together with the gate, and update the incident`
      ).toBe(false);
    }
  });

  it("the patcher still uses single-quoted keys", () => {
    expect(detector).toMatch(/\('\$\{key\}':/);
  });
});
