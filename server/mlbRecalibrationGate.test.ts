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
  buildApprovalRequest,
  RECAL_PROPOSER,
  RECAL_PROPOSER,
  type ProposalEnvelope,
} from "./mlbRecalibrationGate";

const CALIBRATION = { overall: { f5_run_share: 0.5701, nrfi_rate: 0.512 } };

function proposal(
  overrides: Partial<ProposalEnvelope["gate"]> = {}
): ProposalEnvelope {
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
  rationale:
    "reviewed drift evidence; sample n=5,103 supports the new F5 share",
};

describe("recalibration mode resolution", () => {
  it("defaults to propose — self-patching is never the default", () => {
    expect(resolveRecalMode({}).mode).toBe("propose");
    expect(resolveRecalMode({ MLB_RECAL_MODE: "garbage" }).mode).toBe(
      "propose"
    );
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
    expect(env.gate).toEqual({
      status: "PROPOSED",
      proposedBy: RECAL_PROPOSER,
    });
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
    expect(
      parseProposalEnvelope(JSON.stringify({ newF5Share: 0.55 }))
    ).toBeNull();
    expect(parseProposalEnvelope("not json")).toBeNull();
    expect(parseProposalEnvelope(null)).toBeNull();
  });
});

describe("independent-gate approval rules", () => {
  it("owner approval with rationale and a clean window passes", () => {
    expect(validateApproval(ownerApproval, proposal(), 0)).toEqual({
      ok: true,
    });
  });

  it("the proposing agent can never decide its own proposal", () => {
    const verdict = validateApproval(
      { ...ownerApproval, decidedBy: RECAL_PROPOSER },
      proposal(),
      0
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok)
      expect(verdict.reason).toContain("SELF_APPROVAL_FORBIDDEN");
  });

  it("non-owner roles are rejected", () => {
    const verdict = validateApproval(
      { ...ownerApproval, role: "admin" },
      proposal(),
      0
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("UNAUTHORIZED_APPROVER");
  });

  it("a decision without rationale is rejected (audit trail)", () => {
    const verdict = validateApproval(
      { ...ownerApproval, rationale: "  " },
      proposal(),
      0
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("MISSING_RATIONALE");
  });

  it("zero-tolerance: open leakage quarantines block APPROVED but not REJECTED", () => {
    const blocked = validateApproval(ownerApproval, proposal(), 3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok)
      expect(blocked.reason).toContain("LEAKAGE_IN_EVALUATION_WINDOW");
    expect(
      validateApproval(
        { ...ownerApproval, decision: "REJECTED" },
        proposal(),
        3
      ).ok
    ).toBe(true);
  });

  it("only PROPOSED rows can be decided — no double-apply, no flip after rejection", () => {
    for (const status of ["APPLIED", "REJECTED"] as const) {
      const verdict = validateApproval(ownerApproval, proposal({ status }), 0);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain("NOT_PENDING");
    }
  });
});

describe("the approver's identity comes from the session, never from the client", () => {
  // The whole gate rests on this. If `decidedBy` could be supplied by the
  // caller, the self-approval check and the owner-role check are both trivially
  // bypassed by lying — the proposing agent could name itself a human owner.
  // The signature makes that impossible: there is no input parameter for it.
  it("derives decidedBy and role from the authenticated user", () => {
    const req = buildApprovalRequest(
      { id: 42, email: "prez@example.com", role: "owner" },
      { decision: "APPROVED", rationale: "backtest looks sound" }
    );
    expect(req.decidedBy).toBe("appUser:42");
    expect(req.role).toBe("owner");
    expect(req.decision).toBe("APPROVED");
    expect(req.rationale).toBe("backtest looks sound");
  });

  it("carries a non-owner's real role through, so validateApproval can reject it", () => {
    const req = buildApprovalRequest(
      { id: 7, email: "user@example.com", role: "user" },
      { decision: "APPROVED", rationale: "looks fine to me" }
    );
    expect(req.role).toBe("user");
    const proposal = buildProposalEnvelope({
      calibration: {},
      newF5Share: 0.5,
      newNrfiRate: 0.5,
      backtestElapsedSec: 1,
      calibrationJsonPath: "/tmp/x",
      mode: "propose",
    });
    expect(validateApproval(req, proposal, 0)).toEqual({
      ok: false,
      reason: expect.stringContaining("UNAUTHORIZED_APPROVER"),
    });
  });

  it("can never collide with the proposing agent's identity", () => {
    // RECAL_PROPOSER is "drift-detector-agent"; a session identity is always
    // "appUser:<numeric id>", so the two namespaces cannot overlap.
    for (const id of [1, 42, 999999]) {
      const req = buildApprovalRequest(
        { id, email: "x@y.z", role: "owner" },
        {
          decision: "APPROVED",
          rationale: "ok",
        }
      );
      expect(req.decidedBy).not.toBe(RECAL_PROPOSER);
      expect(req.decidedBy).toMatch(/^appUser:\d+$/);
    }
  });

  it("trims the rationale and refuses a blank one at the gate", () => {
    const proposal = buildProposalEnvelope({
      calibration: {},
      newF5Share: 0.5,
      newNrfiRate: 0.5,
      backtestElapsedSec: 1,
      calibrationJsonPath: "/tmp/x",
      mode: "propose",
    });
    const blank = buildApprovalRequest(
      { id: 1, email: "a@b.c", role: "owner" },
      {
        decision: "APPROVED",
        rationale: "   ",
      }
    );
    expect(validateApproval(blank, proposal, 0)).toEqual({
      ok: false,
      reason: expect.stringContaining("MISSING_RATIONALE"),
    });
  });
});

describe("a client-supplied identity is ignored at RUNTIME, not just by the type", () => {
  // Mutation testing caught this: the type forbids `decidedBy` in the input, so
  // no test could express the attack, and adding a runtime fallback to a
  // client-supplied value left the suite green. TypeScript is not a runtime
  // guard — a tRPC payload is JSON and can carry anything.
  it("ignores extra identity fields smuggled into the decision input", () => {
    const hostile = {
      decision: "APPROVED" as const,
      rationale: "ok",
      // none of these may influence the outcome
      decidedBy: "drift-detector-agent",
      role: "owner",
      approver: "prez",
      userId: 1,
    };
    const req = buildApprovalRequest(
      { id: 7, email: "user@example.com", role: "user" },
      hostile as unknown as { decision: "APPROVED"; rationale: string }
    );
    expect(req.decidedBy, "identity must come from the session").toBe(
      "appUser:7"
    );
    expect(req.role, "role must come from the session").toBe("user");
  });

  it("a smuggled owner role cannot promote a non-owner past the validator", () => {
    const proposal = buildProposalEnvelope({
      calibration: {},
      newF5Share: 0.5,
      newNrfiRate: 0.5,
      backtestElapsedSec: 1,
      calibrationJsonPath: "/tmp/x",
      mode: "propose",
    });
    const req = buildApprovalRequest(
      { id: 7, email: "u@e.com", role: "user" },
      { decision: "APPROVED", rationale: "ok", role: "owner" } as unknown as {
        decision: "APPROVED";
        rationale: string;
      }
    );
    expect(validateApproval(req, proposal, 0)).toEqual({
      ok: false,
      reason: expect.stringContaining("UNAUTHORIZED_APPROVER"),
    });
  });

  it("a smuggled proposer identity cannot self-approve", () => {
    const proposal = buildProposalEnvelope({
      calibration: {},
      newF5Share: 0.5,
      newNrfiRate: 0.5,
      backtestElapsedSec: 1,
      calibrationJsonPath: "/tmp/x",
      mode: "propose",
    });
    const req = buildApprovalRequest(
      { id: 1, email: "o@e.com", role: "owner" },
      {
        decision: "APPROVED",
        rationale: "ok",
        decidedBy: RECAL_PROPOSER,
      } as unknown as {
        decision: "APPROVED";
        rationale: string;
      }
    );
    expect(req.decidedBy).toBe("appUser:1");
    expect(validateApproval(req, proposal, 0)).toEqual({ ok: true });
  });
});
