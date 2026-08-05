/**
 * Typed query layer over the loop ledger — the "queryable company" surface for
 * the projection-evaluation loop.
 *
 * Honesty contract (mirrors server/analytics/metricDefinitions.ts): every
 * aggregate is a QueryPoint whose value is present only when state === "ok".
 * Missing evidence stays missing ("not_measured"), thin evidence is
 * "incomplete" — a query must never fabricate a number from zero evidence.
 * Every answer carries the artifact ids it was derived from (provenance).
 */
import type { LoopArtifact } from "./envelope";
import type { LoopLedger } from "./ledger";

export type QueryState = "ok" | "not_measured" | "incomplete" | "unknown";

export interface QueryPoint<T> {
  state: QueryState;
  value: T | null;
  reason: string | null;
  /** Artifact ids the answer was derived from. */
  evidence: string[];
}

/** Minimum graded sample before aggregate quality metrics are reported as "ok". */
export const MIN_GRADED_SAMPLE = 5;

/** Structural view of a grading_record payload (produced by server/loop). */
export interface GradingRecordPayload {
  grading: {
    grade: "WIN" | "LOSS" | "PUSH" | "VOID" | "QUARANTINED" | "UNGRADED";
    modelProb: number;
    clv: number | null;
    profitLoss: number | null;
    edge: number | null;
  };
  /** 1 = model side hit, 0 = missed, null = not resolvable (void/quarantine/ungraded). */
  outcomeBinary: 0 | 1 | null;
}

function isGradingPayload(p: unknown): p is GradingRecordPayload {
  if (typeof p !== "object" || p === null) return false;
  const g = (p as { grading?: unknown }).grading;
  return typeof g === "object" && g !== null && typeof (g as { grade?: unknown }).grade === "string";
}

/**
 * What did the user see at decision time for this event+market, and on what
 * evidence? Returns the current (non-superseded) display artifact with its
 * projection and odds-snapshot lineage.
 */
export function decisionTimeView(
  ledger: LoopLedger,
  gamePk: number,
  market: string,
): QueryPoint<{
  display: LoopArtifact;
  projection: LoopArtifact | null;
  oddsSnapshot: LoopArtifact | null;
}> {
  const superseded = ledger.supersededIds();
  const displays = ledger
    .list({ artifactType: "display_artifact", gamePk })
    .filter((a) => a.entityRefs.market === market && !superseded.has(a.artifactId));
  if (displays.length === 0) {
    return {
      state: "not_measured",
      value: null,
      reason: `no display artifact for gamePk=${gamePk} market=${market} — nothing was shown to users`,
      evidence: [],
    };
  }
  const display = displays[displays.length - 1];
  const projection =
    display.sources.map((s) => ledger.getById(s)).find((a) => a?.artifactType === "projection") ??
    null;
  const oddsSnapshot =
    projection?.sources
      .map((s) => ledger.getById(s))
      .find((a) => a?.artifactType === "odds_snapshot") ?? null;
  return {
    state: "ok",
    value: { display, projection, oddsSnapshot },
    reason: null,
    evidence: [display.artifactId, projection?.artifactId, oddsSnapshot?.artifactId].filter(
      (x): x is string => typeof x === "string",
    ),
  };
}

export interface VersionRecord {
  modelVersion: string;
  graded: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  quarantined: number;
  ungraded: number;
  brierMean: number | null;
  clvMean: number | null;
  clvSamples: number;
  profitUnits: number | null;
}

/**
 * Grading record by model version — the question the current production
 * pipeline cannot answer (audit gap G1). Superseded grading records are
 * excluded so corrections replace, not double-count.
 */
export function gradingByModelVersion(
  ledger: LoopLedger,
): QueryPoint<VersionRecord[]> {
  const superseded = ledger.supersededIds();
  const records = ledger
    .list({ artifactType: "grading_record" })
    .filter((a) => !superseded.has(a.artifactId));
  if (records.length === 0) {
    return {
      state: "not_measured",
      value: null,
      reason: "no grading records in ledger — no projection has been evaluated yet",
      evidence: [],
    };
  }
  const byVersion = new Map<string, LoopArtifact[]>();
  for (const record of records) {
    const version = record.versions.modelVersion ?? "UNVERSIONED";
    const bucket = byVersion.get(version) ?? [];
    bucket.push(record);
    byVersion.set(version, bucket);
  }
  const out: VersionRecord[] = [];
  for (const [modelVersion, artifacts] of Array.from(byVersion.entries())) {
    const row: VersionRecord = {
      modelVersion,
      graded: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      voids: 0,
      quarantined: 0,
      ungraded: 0,
      brierMean: null,
      clvMean: null,
      clvSamples: 0,
      profitUnits: null,
    };
    const briers: number[] = [];
    const clvs: number[] = [];
    let profit = 0;
    let profitSeen = false;
    for (const artifact of artifacts) {
      if (!isGradingPayload(artifact.payload)) continue;
      const { grading, outcomeBinary } = artifact.payload;
      row.graded += 1;
      if (grading.grade === "WIN") row.wins += 1;
      else if (grading.grade === "LOSS") row.losses += 1;
      else if (grading.grade === "PUSH") row.pushes += 1;
      else if (grading.grade === "VOID") row.voids += 1;
      else if (grading.grade === "QUARANTINED") row.quarantined += 1;
      else if (grading.grade === "UNGRADED") row.ungraded += 1;
      if (outcomeBinary !== null && (grading.grade === "WIN" || grading.grade === "LOSS")) {
        briers.push((grading.modelProb - outcomeBinary) ** 2);
      }
      if (grading.clv !== null) clvs.push(grading.clv);
      if (grading.profitLoss !== null) {
        profit += grading.profitLoss;
        profitSeen = true;
      }
    }
    row.brierMean =
      briers.length > 0
        ? Number((briers.reduce((a, b) => a + b, 0) / briers.length).toFixed(6))
        : null;
    row.clvMean =
      clvs.length > 0 ? Number((clvs.reduce((a, b) => a + b, 0) / clvs.length).toFixed(6)) : null;
    row.clvSamples = clvs.length;
    row.profitUnits = profitSeen ? Number(profit.toFixed(4)) : null;
    out.push(row);
  }
  const evidence = records.map((r) => r.artifactId);
  const total = out.reduce((n, r) => n + r.graded, 0);
  if (total < MIN_GRADED_SAMPLE) {
    return {
      state: "incomplete",
      value: out,
      reason: `only ${total} graded records (< ${MIN_GRADED_SAMPLE}) — aggregates are directional, not conclusive`,
      evidence,
    };
  }
  return { state: "ok", value: out, reason: null, evidence };
}

/** Full provenance chain (sources + links) from an artifact back to its roots. */
export function lineage(ledger: LoopLedger, artifactId: string): QueryPoint<string[]> {
  const root = ledger.getById(artifactId);
  if (!root) {
    return {
      state: "unknown",
      value: null,
      reason: `artifact '${artifactId}' not found in ledger`,
      evidence: [],
    };
  }
  const seen = new Set<string>();
  const queue = [artifactId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const artifact = ledger.getById(id);
    if (!artifact) continue;
    for (const source of artifact.sources) {
      if (!source.startsWith("ext:")) queue.push(source);
      else seen.add(source);
    }
    for (const target of Object.values(artifact.links)) {
      if (typeof target === "string") queue.push(target);
    }
  }
  const chain = Array.from(seen);
  return { state: "ok", value: chain, reason: null, evidence: chain.filter((c) => !c.startsWith("ext:")) };
}

/** Improvement proposals with no approval decision yet — the founder-facing queue. */
export function pendingApprovals(ledger: LoopLedger): QueryPoint<LoopArtifact[]> {
  const proposals = ledger.list({ artifactType: "improvement_proposal" });
  if (proposals.length === 0) {
    return {
      state: "not_measured",
      value: null,
      reason: "no improvement proposals in ledger",
      evidence: [],
    };
  }
  const decided = new Set(
    ledger
      .list({ artifactType: "approval_decision" })
      .map((a) => a.links.decides)
      .filter((x): x is string => typeof x === "string"),
  );
  const pending = proposals.filter((p) => !decided.has(p.artifactId));
  return {
    state: "ok",
    value: pending,
    reason: null,
    evidence: proposals.map((p) => p.artifactId),
  };
}

export interface ResultConflict {
  gamePk: number;
  artifactIds: string[];
  detail: string;
}

/**
 * Conflicting authoritative results: two live (non-superseded, non-corrected)
 * result observations for the same event with different content. Grading must
 * refuse to run while a conflict is open (invariant 8).
 */
export function resultConflicts(ledger: LoopLedger): QueryPoint<ResultConflict[]> {
  const superseded = ledger.supersededIds();
  const results = ledger
    .list({ artifactType: "result_observation" })
    .filter((a) => !superseded.has(a.artifactId));
  const byGame = new Map<number, LoopArtifact[]>();
  for (const r of results) {
    const pk = r.entityRefs.gamePk;
    if (pk === undefined) continue;
    const bucket = byGame.get(pk) ?? [];
    bucket.push(r);
    byGame.set(pk, bucket);
  }
  const conflicts: ResultConflict[] = [];
  for (const [gamePk, artifacts] of Array.from(byGame.entries())) {
    const hashes = new Set(artifacts.map((a) => a.contentHash));
    if (artifacts.length > 1 && hashes.size > 1) {
      conflicts.push({
        gamePk,
        artifactIds: artifacts.map((a) => a.artifactId),
        detail: `${artifacts.length} live result observations with ${hashes.size} distinct contents — needs a correction artifact`,
      });
    }
  }
  return {
    state: "ok",
    value: conflicts,
    reason: null,
    evidence: results.map((r) => r.artifactId),
  };
}

export interface EconomicsSummary {
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  costArtifacts: number;
  verifiedOutcomes: number;
  usdPerVerifiedOutcome: number | null;
}

/**
 * Outcome-adjusted AI economics (token-maxing must be measured, not asserted).
 * "Verified outcome" = a grading record with a settled grade (WIN/LOSS/PUSH).
 */
export function costPerVerifiedOutcome(ledger: LoopLedger): QueryPoint<EconomicsSummary> {
  const costs = ledger.list({ artifactType: "workflow_cost" });
  const superseded = ledger.supersededIds();
  const settled = ledger
    .list({ artifactType: "grading_record" })
    .filter((a) => !superseded.has(a.artifactId))
    .filter((a) => {
      if (!isGradingPayload(a.payload)) return false;
      const g = a.payload.grading.grade;
      return g === "WIN" || g === "LOSS" || g === "PUSH";
    });
  if (costs.length === 0) {
    return {
      state: "not_measured",
      value: null,
      reason: "no workflow_cost artifacts — AI spend is not yet instrumented for this loop",
      evidence: [],
    };
  }
  let totalUsd = 0;
  let inTok = 0;
  let outTok = 0;
  for (const c of costs) {
    totalUsd += c.cost?.usd ?? 0;
    inTok += c.cost?.inputTokens ?? 0;
    outTok += c.cost?.outputTokens ?? 0;
  }
  const summary: EconomicsSummary = {
    totalUsd: Number(totalUsd.toFixed(6)),
    totalInputTokens: inTok,
    totalOutputTokens: outTok,
    costArtifacts: costs.length,
    verifiedOutcomes: settled.length,
    usdPerVerifiedOutcome:
      settled.length > 0 ? Number((totalUsd / settled.length).toFixed(6)) : null,
  };
  const evidence = [...costs, ...settled].map((a) => a.artifactId);
  if (settled.length === 0) {
    return {
      state: "incomplete",
      value: summary,
      reason: "spend recorded but zero verified outcomes yet — leverage cannot be assessed",
      evidence,
    };
  }
  return { state: "ok", value: summary, reason: null, evidence };
}
