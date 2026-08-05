/**
 * Independent recalibration gate tests (G2). Pure logic only — the DB apply
 * path is exercised through injected fakes, never a real engine patch.
 */
import { describe, expect, it } from "vitest";
import {
  buildProposalEnvelope,
  parseProposalEnvelope,
  resolveRecalMode,
  validateApproval,
  RECAL_PROPOSER,
  type ProposalEnvelope,
} from "./mlbRecalibrationGate";

const CALIBRATION = { overall: { f5_run_share: 0.5701, nrfi_rate: 0.512 } };

function proposal(overrides: Partial<ProposalEnvelope["gate"]> = {}): ProposalEnvelope {
  const base = buildProposalEnvelope({
    calibration: CALIBRATION,
    newF5Share: 0.5701,
    newNrfiRate: 0.512,
    backtestElapsedSec: 1100,
    calibrationJsonPath: "/tmp/cal.json",
    mode: "propose",
  });
  return { ...base, gate: { ...base.gate, ...overrides } };
}

const ownerApproval = {
  decidedBy: "owner:aisportbettingcontact",
  role: "owner",
  decision: "APPROVED" as const,
  rationale: "reviewed drift evidence; sample n=5,103 supports the new F5 share",
};

describe("recalibration mode resolution", () => {
  it("defaults to propose — self-patching is never the default", () => {
    expect(resolveRecalMode({}).mode).toBe("propose");
    expect(resolveRecalMode({ MLB_RECAL_MODE: "garbage" }).mode).toBe("propose");
  });

  it("autopatch requires the explicit emergency override", () => {
    const resolved = resolveRecalMode({ MLB_RECAL_MODE: "autopatch" });
    expect(resolved.mode).toBe("autopatch");
    expect(resolved.source).toContain("OVERRIDE");
  });
});

describe("proposal envelope", () => {
  it("propose mode yields PROPOSED by the agent identity, carrying the calibration payload", () => {
    const env = proposal();
    expect(env.gate).toEqual({ status: "PROPOSED", proposedBy: RECAL_PROPOSER });
    expect(env.calibration).toEqual(CALIBRATION);
    expect(env.summary.newF5Share).toBe(0.5701);
  });

  it("autopatch mode is stamped as an auditable override", () => {
    const env = buildProposalEnvelope({
      calibration: CALIBRATION,
      newF5Share: 0.5701,
      newNrfiRate: 0.512,
      backtestElapsedSec: 1100,
      calibrationJsonPath: "/tmp/cal.json",
      mode: "autopatch",
    });
    expect(env.gate.status).toBe("APPLIED");
    expect(env.gate.autopatchOverride).toBe(true);
  });

  it("round-trips through JSON and treats legacy rows as undecidable", () => {
    const env = proposal();
    expect(parseProposalEnvelope(JSON.stringify(env))).toEqual(env);
    // Pre-gate rows have no gate key — legacy history, not pending work.
    expect(parseProposalEnvelope(JSON.stringify({ newF5Share: 0.55 }))).toBeNull();
    expect(parseProposalEnvelope("not json")).toBeNull();
    expect(parseProposalEnvelope(null)).toBeNull();
  });
});

describe("independent-gate approval rules", () => {
  it("owner approval with rationale and a clean window passes", () => {
    expect(validateApproval(ownerApproval, proposal(), 0)).toEqual({ ok: true });
  });

  it("the proposing agent can never decide its own proposal", () => {
    const verdict = validateApproval({ ...ownerApproval, decidedBy: RECAL_PROPOSER }, proposal(), 0);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("SELF_APPROVAL_FORBIDDEN");
  });

  it("non-owner roles are rejected", () => {
    const verdict = validateApproval({ ...ownerApproval, role: "admin" }, proposal(), 0);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("UNAUTHORIZED_APPROVER");
  });

  it("a decision without rationale is rejected (audit trail)", () => {
    const verdict = validateApproval({ ...ownerApproval, rationale: "  " }, proposal(), 0);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("MISSING_RATIONALE");
  });

  it("zero-tolerance: open leakage quarantines block APPROVED but not REJECTED", () => {
    const blocked = validateApproval(ownerApproval, proposal(), 3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toContain("LEAKAGE_IN_EVALUATION_WINDOW");
    expect(validateApproval({ ...ownerApproval, decision: "REJECTED" }, proposal(), 3).ok).toBe(true);
  });

  it("only PROPOSED rows can be decided — no double-apply, no flip after rejection", () => {
    for (const status of ["APPLIED", "REJECTED"] as const) {
      const verdict = validateApproval(ownerApproval, proposal({ status }), 0);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain("NOT_PENDING");
    }
  });
});
