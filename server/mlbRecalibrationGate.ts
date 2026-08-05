/**
 * mlbRecalibrationGate.ts — independent promotion gate for model recalibration
 * (audit gap G2 / next-action Q2).
 *
 * Before this gate, the drift loop was self-promoting: drift detected → 3-yr
 * backtest → MLBAIModel.py constants patched in place, no human in the loop.
 * That violates the core AI-native rule that an agent may propose changes to
 * its own model but never silently promote them.
 *
 * New flow (default):
 *   drift/schedule/manual → backtest → **PROPOSED** row in
 *   mlb_model_learning_log (paramChanges JSON carries the full calibration
 *   payload, so applying later needs no 20-minute backtest re-run) →
 *   owner decision via tRPC (`decideRecalibration`) → APPLIED (engine patched)
 *   or REJECTED. Zero-tolerance: any leakage-QUARANTINED grading row in the
 *   evaluation window blocks approval (mirrors ml/dime-1.0 RELEASE_GATES).
 *
 * Emergency escape hatch: MLB_RECAL_MODE=autopatch restores the legacy
 * self-patching behavior — logged as CRITICAL every time it is used.
 *
 * Proposal state lives in the existing mlb_model_learning_log.paramChanges
 * JSON (no schema change, deploy-safe today):
 *   { gate: { status, proposedBy, decidedBy?, decidedRole?, rationale?, decidedAt? }, calibration: {...} }
 * Rows written before this gate have no `gate` key and are treated as legacy
 * APPLIED history.
 */
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { mlbModelLearningLog, mlbGameBacktest } from "../drizzle/schema";

const TAG = "[RecalGate]";

export type RecalMode = "propose" | "autopatch";

/** Distinct agent identity — a human approver can never collide with it. */
export const RECAL_PROPOSER = "drift-detector-agent";

/** Quarantined rows inside this window block approval (zero-tolerance). */
export const QUARANTINE_LOOKBACK_DAYS = 30;

export function resolveRecalMode(env: Record<string, string | undefined>): {
  mode: RecalMode;
  source: string;
} {
  if (env.MLB_RECAL_MODE === "autopatch") {
    return { mode: "autopatch", source: "MLB_RECAL_MODE=autopatch (legacy self-patching OVERRIDE)" };
  }
  if (env.MLB_RECAL_MODE === "propose") {
    return { mode: "propose", source: "MLB_RECAL_MODE=propose (explicit)" };
  }
  return { mode: "propose", source: "default (independent gate)" };
}

export interface GateState {
  status: "PROPOSED" | "APPLIED" | "REJECTED";
  proposedBy: string;
  decidedBy?: string;
  decidedRole?: string;
  rationale?: string;
  decidedAt?: number;
  /** Present on legacy autopatch rows so the override is auditable. */
  autopatchOverride?: boolean;
}

export interface ProposalEnvelope {
  gate: GateState;
  calibration: Record<string, unknown>;
  summary: {
    newF5Share: number | null;
    newNrfiRate: number | null;
    backtestElapsedSec: number;
    calibrationJsonPath: string;
  };
}

/** Pure: build the paramChanges JSON for a PROPOSED (or autopatch-APPLIED) row. */
export function buildProposalEnvelope(input: {
  calibration: Record<string, unknown>;
  newF5Share: number | null;
  newNrfiRate: number | null;
  backtestElapsedSec: number;
  calibrationJsonPath: string;
  mode: RecalMode;
  constantsPatched?: number;
}): ProposalEnvelope {
  return {
    gate:
      input.mode === "propose"
        ? { status: "PROPOSED", proposedBy: RECAL_PROPOSER }
        : { status: "APPLIED", proposedBy: RECAL_PROPOSER, autopatchOverride: true },
    calibration: input.calibration,
    summary: {
      newF5Share: input.newF5Share,
      newNrfiRate: input.newNrfiRate,
      backtestElapsedSec: input.backtestElapsedSec,
      calibrationJsonPath: input.calibrationJsonPath,
    },
  };
}

/** Pure: parse a stored paramChanges payload; legacy rows (no gate key) → null. */
export function parseProposalEnvelope(paramChanges: string | null): ProposalEnvelope | null {
  if (!paramChanges) return null;
  try {
    const parsed = JSON.parse(paramChanges) as ProposalEnvelope;
    if (!parsed || typeof parsed !== "object" || !parsed.gate?.status) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface ApprovalRequest {
  decidedBy: string;
  role: string;
  decision: "APPROVED" | "REJECTED";
  rationale: string;
}

export type ApprovalVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Pure: the independent-gate rules. Self-approval is structurally impossible
 * (proposer is an agent identity), but the check stays — a future agent-issued
 * decision must never slip through.
 */
export function validateApproval(
  request: ApprovalRequest,
  proposal: ProposalEnvelope,
  openQuarantines: number,
): ApprovalVerdict {
  if (proposal.gate.status !== "PROPOSED") {
    return { ok: false, reason: `NOT_PENDING: proposal is ${proposal.gate.status}, only PROPOSED can be decided` };
  }
  if (request.decidedBy === proposal.gate.proposedBy) {
    return { ok: false, reason: "SELF_APPROVAL_FORBIDDEN: the proposing agent may not decide its own recalibration" };
  }
  if (request.role !== "owner") {
    return { ok: false, reason: `UNAUTHORIZED_APPROVER: role '${request.role}' may not decide model recalibrations` };
  }
  if (!request.rationale || request.rationale.trim().length === 0) {
    return { ok: false, reason: "MISSING_RATIONALE: a decision must record why (audit trail)" };
  }
  if (request.decision === "APPROVED" && openQuarantines > 0) {
    return {
      ok: false,
      reason: `LEAKAGE_IN_EVALUATION_WINDOW: ${openQuarantines} QUARANTINED grading row(s) in the last ${QUARANTINE_LOOKBACK_DAYS} days — zero-tolerance gate blocks promotion until resolved`,
    };
  }
  return { ok: true };
}

/** DB: count leakage-quarantined grading rows inside the lookback window. */
export async function countOpenQuarantines(nowMs: number = Date.now()): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(nowMs - QUARANTINE_LOOKBACK_DAYS * 24 * 3600_000)
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(mlbGameBacktest)
    .where(sql`${mlbGameBacktest.result} = 'QUARANTINED' AND ${mlbGameBacktest.gameDate} >= ${cutoff}`);
  const n = Number(rows[0]?.n ?? 0);
  console.log(`${TAG} [STATE] open quarantines since ${cutoff}: ${n}`);
  return n;
}

export interface ProposalListItem {
  id: number;
  runAt: number;
  triggerReason: string | null;
  envelope: ProposalEnvelope | null;
  legacy: boolean;
}

export async function listRecalibrationProposals(limit = 20): Promise<ProposalListItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(mlbModelLearningLog)
    .where(eq(mlbModelLearningLog.market, "ALL_MARKETS"))
    .orderBy(desc(mlbModelLearningLog.runAt))
    .limit(limit);
  return rows.map((row: typeof mlbModelLearningLog.$inferSelect) => {
    const envelope = parseProposalEnvelope(row.paramChanges);
    return {
      id: row.id,
      runAt: Number(row.runAt),
      triggerReason: row.triggerReason,
      envelope,
      legacy: envelope === null,
    };
  });
}

export interface DecisionResult {
  ok: boolean;
  status?: "APPLIED" | "REJECTED";
  reason?: string;
  constantsPatched?: number;
}

/**
 * DB: decide a PROPOSED recalibration. APPROVED → patch the engine via the
 * existing migrateCalibrationConstants (single implementation, now behind the
 * gate) and mark APPLIED; REJECTED → mark only. Every path logs the verdict.
 *
 * `applyPatch` is injected so the decision logic is testable without spawning
 * anything and so this module never imports the detector (no import cycle).
 */
export async function decideRecalibration(
  proposalId: number,
  request: ApprovalRequest,
  applyPatch: (calibration: Record<string, unknown>, reason: string) => Promise<{ patched: number }>,
  nowMs: number = Date.now(),
): Promise<DecisionResult> {
  const db = await getDb();
  const rows = await db.select().from(mlbModelLearningLog).where(eq(mlbModelLearningLog.id, proposalId));
  if (rows.length === 0) return { ok: false, reason: `NOT_FOUND: learning-log row ${proposalId}` };
  const envelope = parseProposalEnvelope(rows[0].paramChanges);
  if (!envelope) return { ok: false, reason: "LEGACY_ROW: pre-gate row has no proposal envelope — nothing to decide" };

  const openQuarantines = request.decision === "APPROVED" ? await countOpenQuarantines(nowMs) : 0;
  const verdict = validateApproval(request, envelope, openQuarantines);
  if (!verdict.ok) {
    console.warn(`${TAG} [VERIFY] decision REJECTED by gate: proposal=${proposalId} ${verdict.reason}`);
    return { ok: false, reason: verdict.reason };
  }

  let constantsPatched = 0;
  let status: "APPLIED" | "REJECTED";
  if (request.decision === "APPROVED") {
    const patch = await applyPatch(envelope.calibration, `APPROVED:${request.decidedBy}`);
    constantsPatched = patch.patched;
    status = "APPLIED";
  } else {
    status = "REJECTED";
  }

  const updated: ProposalEnvelope = {
    ...envelope,
    gate: {
      ...envelope.gate,
      status,
      decidedBy: request.decidedBy,
      decidedRole: request.role,
      rationale: request.rationale,
      decidedAt: nowMs,
    },
  };
  await db
    .update(mlbModelLearningLog)
    .set({ paramChanges: JSON.stringify(updated) })
    .where(eq(mlbModelLearningLog.id, proposalId));
  console.log(
    `${TAG} [OUTPUT] proposal=${proposalId} ${status} by ${request.decidedBy} (${request.role}) constantsPatched=${constantsPatched} — "${request.rationale}"`,
  );
  return { ok: true, status, constantsPatched };
}
