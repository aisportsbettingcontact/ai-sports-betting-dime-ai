/**
 * mlbBacktestIntegrity.ts — the pure integrity enrichment the production
 * grader was missing (audit gaps G1/G3/G4): for every mlb_game_backtest row it
 * computes the leakage verdict, CLV vs the closing snapshot, flat-stake
 * profit/loss, and model-version attribution.
 *
 * Reuses the previously test-only audit core (server/mlbBacktestAuditCore.ts)
 * as the single source of grading math — checkLeakage, calcCLV,
 * calcProfitLoss — so production and audit can never disagree on definitions.
 *
 * Pure and deterministic: callers supply every timestamp and the resolved
 * closing pair; this module never touches the DB or the clock. Each decision
 * is returned as an `events` entry so the caller can log the full reasoning
 * chain verbatim.
 */
import {
  calcCLV,
  calcProfitLoss,
  checkLeakage,
  parseGameStartUtcMs,
  type GradeValue,
} from "./mlbBacktestAuditCore";
import { BACKTEST_INTEGRITY_VERSION, type ModelIdentity } from "./mlbModelIdentity";
import { closingPairForMarket, type ClosingPair, type ScheduleHistoryLite, type MatchMethod } from "./mlbClosingLineResolver";

export interface IntegrityResultInput {
  market: string;
  modelSide: string;
  /** Model probability in [0,1] (BacktestResult.modelProb). */
  modelProb: number;
  bookLine: string | null;
  bookOdds: string | null;
  result: "WIN" | "LOSS" | "PUSH" | "NO_ACTION" | "MISSING_DATA";
  correct: boolean | null;
}

export interface IntegrityContext {
  gameDate: string;
  /** e.g. games.startTimeEst "7:10 PM"; used only when no canonical instant exists. */
  startTimeEst: string | null;
  /** Canonical first-pitch instant (mlb_games.game_datetime_utc) when available. */
  canonicalStartUtcMs: number | null;
  /** games.modelRunAt — when the projection was produced. */
  modelRunAt: number | null;
  identity: ModelIdentity;
  /** Resolved closing row (or null with the reason why). */
  closingRow: ScheduleHistoryLite | null;
  closingResolution: { method: MatchMethod; confidence: number } | { method: null; reason: string };
}

export interface IntegrityFields {
  result: "WIN" | "LOSS" | "PUSH" | "NO_ACTION" | "MISSING_DATA" | "QUARANTINED";
  correct: boolean | null;
  leakageSafe: 0 | 1;
  quarantineReason: string | null;
  modelRunAt: number | null;
  gameStartUtcMs: number | null;
  closingOdds: string | null;
  closingOddsOpposite: string | null;
  clv: number | null;
  profitLoss: number | null;
  auditVersion: string;
}

export interface IntegrityOutcome {
  fields: IntegrityFields;
  /** Human-readable reasoning chain — log verbatim. */
  events: string[];
}

const SETTLED: ReadonlySet<string> = new Set(["WIN", "LOSS", "PUSH"]);

export function computeIntegrityFields(
  r: IntegrityResultInput,
  ctx: IntegrityContext,
): IntegrityOutcome {
  const events: string[] = [];

  // ── Game-start instant: canonical beats parsed-EST, absence is explicit ────
  const parsedStart = parseGameStartUtcMs(ctx.gameDate, ctx.startTimeEst);
  const gameStartUtcMs = ctx.canonicalStartUtcMs ?? parsedStart;
  events.push(
    ctx.canonicalStartUtcMs !== null
      ? `start-instant: canonical mlb_games.game_datetime_utc=${new Date(ctx.canonicalStartUtcMs).toISOString()}`
      : parsedStart !== null
        ? `start-instant: parsed from startTimeEst='${ctx.startTimeEst}' → ${new Date(parsedStart).toISOString()} (no canonical row)`
        : `start-instant: UNAVAILABLE (startTimeEst='${ctx.startTimeEst}') — leakage check degraded`,
  );

  // ── Leakage verdict (audit-core semantics, single source of truth) ─────────
  const leakage = checkLeakage(ctx.modelRunAt, gameStartUtcMs, ctx.gameDate, ctx.startTimeEst);
  events.push(`leakage: safe=${leakage.safe}${leakage.reason ? ` (${leakage.reason})` : ""}`);

  // A leaked prediction can only poison SETTLED grades; NO_ACTION/MISSING_DATA
  // carry no claim to quarantine, but the flag is still recorded.
  let result: IntegrityFields["result"] = r.result;
  let correct = r.correct;
  let quarantineReason: string | null = null;
  if (!leakage.safe && SETTLED.has(r.result)) {
    result = "QUARANTINED";
    correct = null;
    quarantineReason = leakage.reason;
    events.push(`quarantine: ${r.result} → QUARANTINED (grade withheld from accuracy/ROI)`);
  }

  // ── Closing pair + CLV (evaluation-time data only) ─────────────────────────
  let closingOdds: string | null = null;
  let closingOddsOpposite: string | null = null;
  let clv: number | null = null;
  if (ctx.closingRow) {
    const pair: ClosingPair = closingPairForMarket(ctx.closingRow, r.market, r.bookLine);
    if (pair.available) {
      closingOdds = String(pair.odds);
      closingOddsOpposite = String(pair.oddsOpposite);
      if (result !== "QUARANTINED") {
        clv = calcCLV(r.modelProb, pair.odds, pair.oddsOpposite);
        const method = "method" in ctx.closingResolution && ctx.closingResolution.method !== null ? ctx.closingResolution.method : "?";
        events.push(`clv: ${clv} vs closing ${closingOdds}/${closingOddsOpposite} (resolver=${method})`);
      } else {
        events.push("clv: withheld — quarantined row must not contribute skill metrics");
      }
    } else {
      events.push(`clv: unavailable — ${pair.reason}`);
    }
  } else {
    const why = "reason" in ctx.closingResolution ? ctx.closingResolution.reason : "no closing row";
    events.push(`clv: unavailable — ${why}`);
  }

  // ── Flat-stake P/L (settled grades only; audit-core math) ──────────────────
  let profitLoss: number | null = null;
  if (SETTLED.has(result)) {
    const odds = r.bookOdds === null ? null : parseInt(String(r.bookOdds).replace("+", ""), 10);
    profitLoss = calcProfitLoss(result as GradeValue, Number.isFinite(odds as number) ? odds : null);
    events.push(`profitLoss: ${profitLoss} units at ${r.bookOdds ?? "no-odds"}`);
  }

  return {
    fields: {
      result,
      correct,
      leakageSafe: leakage.safe ? 1 : 0,
      quarantineReason,
      modelRunAt: ctx.modelRunAt,
      gameStartUtcMs,
      closingOdds,
      closingOddsOpposite,
      clv,
      profitLoss,
      auditVersion: `${BACKTEST_INTEGRITY_VERSION}|${ctx.identity.modelVersion}|params:${ctx.identity.modelParamsHash}`,
    },
    events,
  };
}
