/**
 * Projection-evaluation loop — the first complete closed-loop vertical slice:
 *
 *   provider observation → canonical event (gamePk) → immutable odds snapshot
 *   → versioned projection (abstention explicit) → public display artifact
 *   (evidence cross-checked, certainty language rejected) → authoritative
 *   result (corrections supersede) → grading with leakage quarantine, Brier
 *   and CLV vs the closing snapshot → per-version evaluation → improvement
 *   proposal → independent approval decision.
 *
 * This engine deliberately reuses the repo's existing-but-unwired evaluation
 * suite (server/mlbBacktestAuditCore.ts: gradeMarket, checkLeakage-in-preflight,
 * calcCLV, noVigProb) and the gamePk-first identity rule from
 * server/mlbEventIdentity.ts. It closes audit gaps G1 (versioning), G2
 * (independent gate), G3 (CLV), G4 (leakage), G6 (unwired audit tooling) —
 * see docs/ai-native/current-state-audit.md.
 *
 * Pure and DB-free: state lives in a LoopLedger, the clock is always injected,
 * so the whole slice runs deterministically under vitest with no credentials.
 * Wiring into mlbMultiMarketBacktest/drizzle is a queued, owner-gated step.
 */
import {
  makeArtifact,
  type LoopArtifact,
  type CostBlock,
} from "@shared/loop/envelope";
import type { LoopLedger, AppendResult } from "@shared/loop/ledger";
import { gradingByModelVersion, resultConflicts } from "@shared/loop/queries";
import {
  gradeMarket,
  noVigProb,
  calcEdge,
  MARKET_TIMEFRAME,
  type ApprovedMarket,
  type GradingInput,
  type GradingOutput,
} from "../mlbBacktestAuditCore";

export type StageResult =
  | { ok: true; artifact: LoopArtifact; appended: AppendResult }
  | { ok: false; reason: string };

const PRODUCER = "projection-loop-v1";

/** Odds older than this at display time are flagged stale (mirrors DIME_ODDS_FRESHNESS_MS). */
export const ODDS_STALE_MS = 15 * 60 * 1000;

/** Minimum absolute probability edge before the loop recommends rather than abstains. */
export const MIN_ACTIONABLE_EDGE = 0.015;

/** Certainty language that may never reach a user-facing artifact. */
const FORBIDDEN_CERTAINTY = /\b(guarantee[ds]?|lock of the (day|night|week)|can't lose|cannot lose|risk[- ]free|sure thing|100% (win|winner))\b/i;

function fail(reason: string): StageResult {
  return { ok: false, reason };
}

function appendOrFail(ledger: LoopLedger, artifact: LoopArtifact): StageResult {
  const appended = ledger.append(artifact);
  if (appended.status === "rejected") return fail(`LEDGER_REJECTED: ${appended.reason}`);
  return { ok: true, artifact, appended };
}

// ─── Stage 1: provider observation ────────────────────────────────────────────

export interface ProviderGameObservation {
  /** MLB Stats API gamePk. Nullable here because providers can omit it; canonicalization rejects that. */
  gamePk: number | null;
  officialDate: string;
  awayTeam: string;
  homeTeam: string;
  startUtcMs: number | null;
  status: "scheduled" | "final" | "postponed" | "suspended";
  doubleHeader?: "N" | "Y" | "S";
  gameNumber?: number;
}

export function observeProviderGame(
  ledger: LoopLedger,
  raw: ProviderGameObservation,
  opts: { source: string; observedAtMs: number; nowMs: number },
): StageResult {
  const idKey = raw.gamePk ?? `${raw.officialDate}-${raw.awayTeam}-${raw.homeTeam}`;
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `obs:${idKey}:${opts.observedAtMs}`,
      artifactType: "provider_observation",
      createdAtMs: opts.nowMs,
      observedAtMs: opts.observedAtMs,
      eventTimeMs: raw.startUtcMs,
      producer: PRODUCER,
      sources: [`ext:${opts.source}`],
      entityRefs: raw.gamePk ? { gamePk: raw.gamePk, gameDate: raw.officialDate } : { gameDate: raw.officialDate },
      accessClass: "internal",
      freshness: "live",
      // Provider payloads are evidence, never instructions — stored verbatim.
      payload: raw,
    }),
  );
}

// ─── Stage 2: canonical event ─────────────────────────────────────────────────

export function canonicalizeEvent(
  ledger: LoopLedger,
  observationId: string,
  nowMs: number,
): StageResult {
  const obs = ledger.getById(observationId);
  if (!obs || obs.artifactType !== "provider_observation") {
    return fail(`MISSING_OBSERVATION: '${observationId}' is not a provider_observation in the ledger`);
  }
  const raw = obs.payload as ProviderGameObservation;
  // Identity contract (server/mlbEventIdentity.ts): gamePk is the only event
  // identity — matchup text, date, and start time are never identities.
  if (raw.gamePk === null || raw.gamePk === undefined) {
    return fail("MISSING_GAME_PK: provider observation has no gamePk — cannot canonicalize; matchup/date must never substitute for identity");
  }
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `evt:${raw.gamePk}`,
      artifactType: "canonical_event",
      createdAtMs: nowMs,
      eventTimeMs: raw.startUtcMs,
      observedAtMs: obs.observedAtMs,
      producer: PRODUCER,
      sources: [observationId],
      entityRefs: { gamePk: raw.gamePk, gameDate: raw.officialDate },
      accessClass: "internal",
      freshness: "derived",
      payload: {
        gamePk: raw.gamePk,
        officialDate: raw.officialDate,
        awayTeam: raw.awayTeam,
        homeTeam: raw.homeTeam,
        startUtcMs: raw.startUtcMs,
        doubleHeader: raw.doubleHeader ?? "N",
        gameNumber: raw.gameNumber ?? 1,
      },
    }),
  );
}

// ─── Stage 3: immutable odds snapshot ─────────────────────────────────────────

export interface OddsSnapshotInput {
  eventId: string;
  market: ApprovedMarket;
  bookLine: number | null;
  /** American odds for the model-relevant side and its opposite. */
  bookOdds: number;
  bookOddsOpposite: number;
  kind: "pregame" | "closing";
  source: string;
  observedAtMs: number;
  nowMs: number;
}

export function snapshotOdds(ledger: LoopLedger, input: OddsSnapshotInput): StageResult {
  const event = ledger.getById(input.eventId);
  if (!event || event.artifactType !== "canonical_event") {
    return fail(`MISSING_EVENT: '${input.eventId}' is not a canonical_event`);
  }
  if (!(input.market in MARKET_TIMEFRAME)) {
    return fail(`UNAPPROVED_MARKET: '${input.market}' is not an approved market`);
  }
  const gamePk = event.entityRefs.gamePk!;
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `odds:${gamePk}:${input.market}:${input.kind}:${input.observedAtMs}`,
      artifactType: "odds_snapshot",
      createdAtMs: input.nowMs,
      observedAtMs: input.observedAtMs,
      eventTimeMs: event.eventTimeMs,
      producer: PRODUCER,
      sources: [input.eventId, `ext:${input.source}`],
      entityRefs: { gamePk, gameDate: event.entityRefs.gameDate, market: input.market },
      accessClass: "internal",
      freshness: "live",
      payload: {
        kind: input.kind,
        bookLine: input.bookLine,
        bookOdds: input.bookOdds,
        bookOddsOpposite: input.bookOddsOpposite,
      },
    }),
  );
}

// ─── Stage 4: versioned projection (abstention explicit) ──────────────────────

export interface ProjectionInput {
  eventId: string;
  oddsSnapshotId: string;
  modelVersion: string;
  paramsHash: string;
  market: ApprovedMarket;
  modelSide: string;
  modelProb: number;
  modelRunAtMs: number;
  nowMs: number;
}

export function runProjection(ledger: LoopLedger, input: ProjectionInput): StageResult {
  if (!input.modelVersion || !input.paramsHash) {
    // Invariant 1 (gap G1): no unversioned projection may enter the loop.
    return fail("UNVERSIONED_PROJECTION: modelVersion and paramsHash are mandatory — an unattributable projection cannot be evaluated");
  }
  if (!(Number.isFinite(input.modelProb) && input.modelProb > 0 && input.modelProb < 1)) {
    return fail(`UNSUPPORTED_CERTAINTY: modelProb=${input.modelProb} — probabilities must lie strictly inside (0,1); certainty is never evidence-supported`);
  }
  const event = ledger.getById(input.eventId);
  if (!event || event.artifactType !== "canonical_event") {
    return fail(`MISSING_EVENT: '${input.eventId}' is not a canonical_event`);
  }
  const snapshot = ledger.getById(input.oddsSnapshotId);
  if (!snapshot || snapshot.artifactType !== "odds_snapshot") {
    return fail(`MISSING_ODDS_SNAPSHOT: '${input.oddsSnapshotId}' is not an odds_snapshot`);
  }
  const snapPayload = snapshot.payload as { kind: string; bookOdds: number; bookOddsOpposite: number; bookLine: number | null };
  if (snapPayload.kind === "closing") {
    // Truth contract: closing-line information is post-prediction evaluation
    // data — feeding it into a projection is future-data leakage by construction.
    return fail("CLOSING_DATA_LEAKAGE: closing odds are evaluation-only and may never be a projection input");
  }
  if (snapshot.entityRefs.gamePk !== event.entityRefs.gamePk) {
    return fail("ENTITY_MISMATCH: odds snapshot belongs to a different event");
  }
  const bookNoVig = noVigProb(snapPayload.bookOdds, snapPayload.bookOddsOpposite);
  const edge = calcEdge(input.modelProb, bookNoVig);
  const decision = edge !== null && Math.abs(edge) >= MIN_ACTIONABLE_EDGE ? "EDGE" : "NO_EDGE";
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `proj:${event.entityRefs.gamePk}:${input.market}:${input.modelVersion}:${input.modelRunAtMs}`,
      artifactType: "projection",
      createdAtMs: input.nowMs,
      observedAtMs: input.modelRunAtMs,
      eventTimeMs: event.eventTimeMs,
      producer: PRODUCER,
      sources: [input.eventId, input.oddsSnapshotId],
      entityRefs: {
        gamePk: event.entityRefs.gamePk,
        gameDate: event.entityRefs.gameDate,
        market: input.market,
        selection: input.modelSide,
        modelVersion: input.modelVersion,
      },
      versions: { modelVersion: input.modelVersion, paramsHash: input.paramsHash },
      accessClass: "internal",
      freshness: "derived",
      uncertainty:
        decision === "NO_EDGE"
          ? "model edge below actionable threshold — abstaining, no recommendation"
          : "model probability from simulation; edge vs book no-vig at snapshot time",
      payload: {
        market: input.market,
        modelSide: input.modelSide,
        modelProb: input.modelProb,
        modelRunAtMs: input.modelRunAtMs,
        bookNoVigProb: bookNoVig,
        edge,
        decision,
      },
    }),
  );
}

// ─── Stage 5: user-facing display artifact ────────────────────────────────────

export function buildDisplayArtifact(
  ledger: LoopLedger,
  projectionId: string,
  nowMs: number,
): StageResult {
  const projection = ledger.getById(projectionId);
  if (!projection || projection.artifactType !== "projection") {
    return fail(`MISSING_PROJECTION: '${projectionId}' is not a projection`);
  }
  // Evidence cross-check (closes the dimeVerdict gap pattern: cited sources
  // must actually exist in the evidence store, not merely be asserted).
  const snapshotId = projection.sources.find((s) => ledger.getById(s)?.artifactType === "odds_snapshot");
  const snapshot = snapshotId ? ledger.getById(snapshotId) : null;
  if (!snapshot) {
    return fail("EVIDENCE_UNRESOLVED: projection cites no resolvable odds snapshot — display refused");
  }
  const p = projection.payload as {
    market: string;
    modelSide: string;
    modelProb: number;
    edge: number | null;
    decision: "EDGE" | "NO_EDGE";
  };
  const oddsAge = snapshot.observedAtMs === null ? null : nowMs - snapshot.observedAtMs;
  const stale = oddsAge === null || oddsAge > ODDS_STALE_MS;
  const event = ledger.getById(projection.sources.find((s) => ledger.getById(s)?.artifactType === "canonical_event") ?? "");
  const eventPayload = event?.payload as { awayTeam?: string; homeTeam?: string } | undefined;
  const matchup = `${eventPayload?.awayTeam ?? "away"} @ ${eventPayload?.homeTeam ?? "home"}`;
  const copy =
    p.decision === "NO_EDGE"
      ? `${matchup} — ${p.market}: no actionable edge at current prices. Model probability ${(p.modelProb * 100).toFixed(1)}%.`
      : `${matchup} — ${p.market}: model leans ${p.modelSide} at ${(p.modelProb * 100).toFixed(1)}% vs the no-vig market price (edge ${((p.edge ?? 0) * 100).toFixed(1)} pts). Odds move; this is probability, not a promise. 21+ · Gambling problem? 1-800-GAMBLER`;
  if (FORBIDDEN_CERTAINTY.test(copy) || FORBIDDEN_CERTAINTY.test(matchup)) {
    return fail("PROHIBITED_CERTAINTY_LANGUAGE: user-facing copy implies a guaranteed outcome — display refused");
  }
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `disp:${projectionId}`,
      artifactType: "display_artifact",
      createdAtMs: nowMs,
      observedAtMs: nowMs,
      eventTimeMs: projection.eventTimeMs,
      producer: PRODUCER,
      sources: [projectionId, snapshot.artifactId],
      entityRefs: projection.entityRefs,
      versions: projection.versions,
      accessClass: "public",
      freshness: stale ? "stale" : "live",
      uncertainty: stale
        ? `odds snapshot is ${oddsAge === null ? "of unknown age" : `${Math.round(oddsAge / 60000)} min old`} (> ${ODDS_STALE_MS / 60000} min) — prices may have moved`
        : projection.uncertainty,
      payload: { copy, decision: p.decision, modelProb: p.modelProb, edge: p.edge, staleOdds: stale },
    }),
  );
}

// ─── Stage 6: authoritative result (corrections supersede) ────────────────────

export interface ResultInput {
  eventId: string;
  status: "FINAL" | "POSTPONED" | "SUSPENDED";
  fgAwayRuns: number | null;
  fgHomeRuns: number | null;
  f5AwayRuns?: number | null;
  f5HomeRuns?: number | null;
  nrfiResult?: "NRFI" | "YRFI" | null;
  source: string;
  observedAtMs: number;
  nowMs: number;
  /** Set when this result corrects an earlier observation of the same game. */
  correctionOf?: string;
}

export function ingestResult(ledger: LoopLedger, input: ResultInput): StageResult {
  const event = ledger.getById(input.eventId);
  if (!event || event.artifactType !== "canonical_event") {
    return fail(`MISSING_EVENT: '${input.eventId}' is not a canonical_event`);
  }
  const gamePk = event.entityRefs.gamePk!;
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `res:${gamePk}:${input.observedAtMs}`,
      artifactType: "result_observation",
      createdAtMs: input.nowMs,
      observedAtMs: input.observedAtMs,
      eventTimeMs: event.eventTimeMs,
      producer: PRODUCER,
      sources: [input.eventId, `ext:${input.source}`],
      entityRefs: { gamePk, gameDate: event.entityRefs.gameDate },
      accessClass: "internal",
      freshness: "live",
      links: input.correctionOf ? { correctionOf: input.correctionOf } : {},
      payload: {
        status: input.status,
        fgAwayRuns: input.fgAwayRuns,
        fgHomeRuns: input.fgHomeRuns,
        f5AwayRuns: input.f5AwayRuns ?? null,
        f5HomeRuns: input.f5HomeRuns ?? null,
        nrfiResult: input.nrfiResult ?? null,
      },
    }),
  );
}

// ─── Stage 7: grading (leakage quarantine + Brier + CLV) ──────────────────────

export interface GradeInput {
  projectionId: string;
  resultId: string;
  /** Optional closing odds snapshot for CLV — evaluation-time data only. */
  closingSnapshotId?: string;
  gradedAtMs: number;
}

export function gradeProjection(ledger: LoopLedger, input: GradeInput): StageResult {
  const projection = ledger.getById(input.projectionId);
  if (!projection || projection.artifactType !== "projection") {
    return fail(`MISSING_PROJECTION: '${input.projectionId}' is not a projection`);
  }
  if (!projection.versions.modelVersion) {
    return fail("UNVERSIONED_PROJECTION: refusing to grade a projection without modelVersion");
  }
  const result = ledger.getById(input.resultId);
  if (!result || result.artifactType !== "result_observation") {
    return fail(`MISSING_RESULT: '${input.resultId}' is not a result_observation`);
  }
  if (result.entityRefs.gamePk !== projection.entityRefs.gamePk) {
    return fail("ENTITY_MISMATCH: result and projection reference different gamePks — refusing cross-game grading");
  }
  // Invariant 8: open result conflicts block grading.
  const conflicts = resultConflicts(ledger);
  if (conflicts.value?.some((c) => c.gamePk === projection.entityRefs.gamePk)) {
    return fail("RESULT_CONFLICT_OPEN: multiple live result observations disagree for this game — resolve with a correction artifact before grading");
  }
  const superseded = ledger.supersededIds();
  if (superseded.has(input.resultId)) {
    return fail("SUPERSEDED_RESULT: this result observation was corrected — grade against the correcting artifact");
  }

  let closingOdds: number | null = null;
  let closingOddsOpposite: number | null = null;
  if (input.closingSnapshotId) {
    const closing = ledger.getById(input.closingSnapshotId);
    if (!closing || closing.artifactType !== "odds_snapshot") {
      return fail(`MISSING_CLOSING_SNAPSHOT: '${input.closingSnapshotId}' is not an odds_snapshot`);
    }
    const closingPayload = closing.payload as { kind: string; bookOdds: number; bookOddsOpposite: number };
    if (closingPayload.kind !== "closing") {
      return fail("NOT_A_CLOSING_SNAPSHOT: CLV requires a snapshot captured at close");
    }
    if (closing.entityRefs.gamePk !== projection.entityRefs.gamePk || closing.entityRefs.market !== projection.entityRefs.market) {
      return fail("ENTITY_MISMATCH: closing snapshot is for a different game or market");
    }
    closingOdds = closingPayload.bookOdds;
    closingOddsOpposite = closingPayload.bookOddsOpposite;
  }

  const pregameSnapshot = projection.sources
    .map((s) => ledger.getById(s))
    .find((a) => a?.artifactType === "odds_snapshot");
  const pregamePayload = pregameSnapshot?.payload as
    | { bookLine: number | null; bookOdds: number; bookOddsOpposite: number }
    | undefined;
  const projPayload = projection.payload as {
    market: ApprovedMarket;
    modelSide: string;
    modelProb: number;
    modelRunAtMs: number;
  };
  const resPayload = result.payload as {
    status: "FINAL" | "POSTPONED" | "SUSPENDED";
    fgAwayRuns: number | null;
    fgHomeRuns: number | null;
    f5AwayRuns: number | null;
    f5HomeRuns: number | null;
    nrfiResult: "NRFI" | "YRFI" | null;
  };

  const gradingInput: GradingInput = {
    market: projPayload.market,
    // Fixture scope: gamePk stands in for games.id; production wiring maps it.
    gameId: projection.entityRefs.gamePk!,
    gameDate: projection.entityRefs.gameDate ?? "1970-01-01",
    modelSide: projPayload.modelSide,
    modelProb: projPayload.modelProb,
    bookLine: pregamePayload?.bookLine ?? null,
    bookOdds: pregamePayload?.bookOdds ?? null,
    bookOddsOpposite: pregamePayload?.bookOddsOpposite ?? null,
    closingOdds,
    closingOddsOpposite,
    modelRunAt: projPayload.modelRunAtMs,
    gameStartUtcMs: projection.eventTimeMs,
    oddsTimestamp: pregameSnapshot?.observedAtMs ?? null,
    resultTimestamp: result.observedAtMs,
    actualValue: {
      fgAwayRuns: resPayload.fgAwayRuns,
      fgHomeRuns: resPayload.fgHomeRuns,
      f5AwayRuns: resPayload.f5AwayRuns,
      f5HomeRuns: resPayload.f5HomeRuns,
      nrfiResult: resPayload.nrfiResult,
      isPostponed: resPayload.status === "POSTPONED",
      isSuspended: resPayload.status === "SUSPENDED",
    },
    sourceTraceId: `${input.projectionId}|${input.resultId}`,
  };

  const grading: GradingOutput = gradeMarket(gradingInput);
  // Deterministic processing time so replaying the same grade deduplicates.
  grading.gradingTimestamp = input.gradedAtMs;
  const outcomeBinary: 0 | 1 | null =
    grading.grade === "WIN" ? 1 : grading.grade === "LOSS" ? 0 : null;

  // Regrade after a correction supersedes the earlier grading record.
  const priorGrade = ledger
    .list({ artifactType: "grading_record" })
    .filter((a) => !superseded.has(a.artifactId))
    .find((a) => a.sources.includes(input.projectionId) && !a.sources.includes(input.resultId));

  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `grade:${input.projectionId}:${input.resultId}`,
      artifactType: "grading_record",
      createdAtMs: input.gradedAtMs,
      observedAtMs: input.gradedAtMs,
      eventTimeMs: projection.eventTimeMs,
      producer: PRODUCER,
      sources: [
        input.projectionId,
        input.resultId,
        ...(input.closingSnapshotId ? [input.closingSnapshotId] : []),
      ],
      entityRefs: projection.entityRefs,
      versions: projection.versions,
      accessClass: "internal",
      freshness: "derived",
      uncertainty: grading.quarantineFlag
        ? `quarantined: ${grading.quarantineReason}`
        : grading.clv === null
          ? "no closing snapshot — CLV unavailable for this record"
          : null,
      links: priorGrade ? { supersedes: priorGrade.artifactId } : {},
      payload: { grading, outcomeBinary },
    }),
  );
}

// ─── Stage 8: evaluation per model version ────────────────────────────────────

export function evaluateModelVersion(
  ledger: LoopLedger,
  modelVersion: string,
  evaluatedAtMs: number,
): StageResult {
  const all = gradingByModelVersion(ledger);
  const row = all.value?.find((r) => r.modelVersion === modelVersion) ?? null;
  if (!row) {
    return fail(`NO_GRADED_RECORDS: no grading records exist for modelVersion='${modelVersion}'`);
  }
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `eval:${modelVersion}:${evaluatedAtMs}`,
      artifactType: "evaluation_report",
      createdAtMs: evaluatedAtMs,
      observedAtMs: evaluatedAtMs,
      producer: PRODUCER,
      sources: all.evidence.filter((id) => {
        const a = ledger.getById(id);
        return a?.versions.modelVersion === modelVersion;
      }),
      entityRefs: { modelVersion },
      versions: { modelVersion },
      accessClass: "owner",
      freshness: "derived",
      uncertainty:
        all.state === "incomplete"
          ? (all.reason ?? "sample below minimum — directional only")
          : null,
      payload: { record: row, sampleState: all.state },
    }),
  );
}

// ─── Stage 9: guarded improvement proposal + independent approval ─────────────

export interface ProposalInput {
  evaluationId: string;
  proposedBy: string;
  title: string;
  change: string;
  expectedEffect: string;
  nowMs: number;
}

export function proposeImprovement(ledger: LoopLedger, input: ProposalInput): StageResult {
  const evaluation = ledger.getById(input.evaluationId);
  if (!evaluation || evaluation.artifactType !== "evaluation_report") {
    return fail(`MISSING_EVALUATION: '${input.evaluationId}' is not an evaluation_report — proposals must be grounded in an evaluation`);
  }
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `prop:${input.evaluationId}:${input.nowMs}`,
      artifactType: "improvement_proposal",
      createdAtMs: input.nowMs,
      observedAtMs: input.nowMs,
      producer: PRODUCER,
      sources: [input.evaluationId],
      entityRefs: evaluation.entityRefs,
      versions: evaluation.versions,
      accessClass: "owner",
      freshness: "derived",
      payload: {
        proposedBy: input.proposedBy,
        title: input.title,
        change: input.change,
        expectedEffect: input.expectedEffect,
        status: "PROPOSED",
      },
    }),
  );
}

export interface DecisionInput {
  proposalId: string;
  decidedBy: string;
  role: string;
  decision: "APPROVED" | "REJECTED";
  rationale: string;
  nowMs: number;
}

/**
 * Independent gate (invariant 7, gap G2): a proposal is only promoted by a
 * distinct, authorized approver, and never while the evaluation window
 * contains leakage-quarantined records (zero-tolerance, mirroring
 * ml/dime-1.0/docs/RELEASE_GATES.md).
 */
export function decideProposal(ledger: LoopLedger, input: DecisionInput): StageResult {
  const proposal = ledger.getById(input.proposalId);
  if (!proposal || proposal.artifactType !== "improvement_proposal") {
    return fail(`MISSING_PROPOSAL: '${input.proposalId}' is not an improvement_proposal`);
  }
  const proposalPayload = proposal.payload as { proposedBy: string };
  if (input.decidedBy === proposalPayload.proposedBy) {
    return fail("SELF_APPROVAL_FORBIDDEN: the proposer may not decide its own proposal — an agent never promotes its own change");
  }
  if (input.role !== "owner") {
    return fail(`UNAUTHORIZED_APPROVER: role '${input.role}' may not decide model-improvement proposals — owner approval required`);
  }
  if (input.decision === "APPROVED") {
    const modelVersion = proposal.versions.modelVersion;
    const superseded = ledger.supersededIds();
    const quarantined = ledger
      .list({ artifactType: "grading_record", modelVersion })
      .filter((a) => !superseded.has(a.artifactId))
      .filter((a) => {
        const payload = a.payload as { grading?: { grade?: string } };
        return payload.grading?.grade === "QUARANTINED";
      });
    if (quarantined.length > 0) {
      return fail(
        `LEAKAGE_IN_EVALUATION_WINDOW: ${quarantined.length} quarantined grading record(s) for modelVersion='${modelVersion}' — zero-tolerance gate blocks approval until quarantines are resolved`,
      );
    }
  }
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `appr:${input.proposalId}`,
      artifactType: "approval_decision",
      createdAtMs: input.nowMs,
      observedAtMs: input.nowMs,
      producer: PRODUCER,
      sources: [input.proposalId],
      entityRefs: proposal.entityRefs,
      versions: proposal.versions,
      accessClass: "owner",
      freshness: "derived",
      links: { decides: input.proposalId },
      payload: {
        decidedBy: input.decidedBy,
        role: input.role,
        decision: input.decision,
        rationale: input.rationale,
      },
    }),
  );
}

export type PromotionStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "UNKNOWN";

export function promotionStatus(ledger: LoopLedger, proposalId: string): PromotionStatus {
  const proposal = ledger.getById(proposalId);
  if (!proposal || proposal.artifactType !== "improvement_proposal") return "UNKNOWN";
  const decision = ledger
    .list({ artifactType: "approval_decision" })
    .find((a) => a.links.decides === proposalId);
  if (!decision) return "PROPOSED";
  const payload = decision.payload as { decision: "APPROVED" | "REJECTED" };
  return payload.decision;
}

// ─── Economics: workflow cost attribution ─────────────────────────────────────

export function recordWorkflowCost(
  ledger: LoopLedger,
  input: { workflow: string; cost: CostBlock; outcomeRef?: string; nowMs: number },
): StageResult {
  return appendOrFail(
    ledger,
    makeArtifact({
      artifactId: `cost:${input.workflow}:${input.nowMs}`,
      artifactType: "workflow_cost",
      createdAtMs: input.nowMs,
      observedAtMs: input.nowMs,
      producer: PRODUCER,
      sources: input.outcomeRef ? [input.outcomeRef] : [],
      accessClass: "owner",
      freshness: "live",
      links: input.outcomeRef ? { outcomeRef: input.outcomeRef } : {},
      cost: input.cost,
      payload: { workflow: input.workflow },
    }),
  );
}
