/**
 * mlbClosingLineResolver.ts — deterministic AN↔gamePk closing-line resolution
 * (audit gap G5 / next-action Q4).
 *
 * Closing lines live in mlb_schedule_history (AN-keyed, DK NJ block locked at
 * first pitch). Graded projections live against games (gamePk-keyed). The
 * owner's crosswalk merge added mlb_schedule_history.gamePk ("canonical join
 * key; null until backfilled"), so resolution is tiered, confidence-scored,
 * and NEVER guesses — mirroring wc2026_provider_match_map and the
 * mlbEventIdentity contract (matchup/date/time are never identities; on
 * ambiguity we return null with a reason instead of fuzzy-matching):
 *
 *   T1 EXACT_GAMEPK       gamePk column equality                 confidence 1.00
 *   T2 DATE_TEAMS_UNIQUE  gameDate + both teams (via registry),  confidence 0.95
 *                         exactly one candidate
 *   T3 DATE_TEAMS_TIME    doubleheader disambiguation by start   confidence 0.80
 *                         instant (≤90 min tolerance, unique)
 *
 * Matching core is pure (unit-tested); the DB wrapper adds a write-through
 * heal: a T2/T3 match persists the resolved gamePk (capability-safe — the
 * column exists in schema) so the row is T1 next time. Every decision logs.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbScheduleHistory } from "../drizzle/schema";
import { getMlbTeamByAnSlug, MLB_BY_ABBREV } from "@shared/mlbTeams";

const TAG = "[ClosingResolver]";

/** ≤90 min between AN start and statsapi start still counts as "same game". */
const START_TIME_TOLERANCE_MS = 90 * 60 * 1000;

export interface ScheduleHistoryLite {
  id: number;
  anGameId: number;
  gamePk: number | null;
  gameDate: string;
  startTimeUtc: string;
  awaySlug: string;
  homeSlug: string;
  dkClosingAwayRunLine: string | number | null;
  dkClosingAwayRunLineOdds: string | null;
  dkClosingHomeRunLine: string | number | null;
  dkClosingHomeRunLineOdds: string | null;
  dkClosingTotal: string | number | null;
  dkClosingOverOdds: string | null;
  dkClosingUnderOdds: string | null;
  dkClosingAwayML: string | null;
  dkClosingHomeML: string | null;
  closingLineLockedAt: number | null;
}

export interface GameIdentity {
  mlbGamePk: number | null;
  gameDate: string;
  /** Registry abbrevs (games.awayTeam/homeTeam store these for MLB rows). */
  awayTeam: string;
  homeTeam: string;
  startUtcMs: number | null;
}

export type MatchMethod = "EXACT_GAMEPK" | "DATE_TEAMS_UNIQUE" | "DATE_TEAMS_TIME";

export type ResolverOutcome =
  | { matched: true; row: ScheduleHistoryLite; method: MatchMethod; confidence: number }
  | { matched: false; reason: string };

/** Pure tiered matcher. */
export function matchScheduleHistory(
  game: GameIdentity,
  candidates: ScheduleHistoryLite[],
): ResolverOutcome {
  // T1 — canonical id join.
  if (game.mlbGamePk !== null) {
    const exact = candidates.filter((c) => c.gamePk === game.mlbGamePk);
    if (exact.length === 1) {
      return { matched: true, row: exact[0], method: "EXACT_GAMEPK", confidence: 1.0 };
    }
    if (exact.length > 1) {
      return {
        matched: false,
        reason: `DUPLICATE_GAMEPK_ROWS: ${exact.length} schedule-history rows claim gamePk=${game.mlbGamePk} — data defect, refusing to pick`,
      };
    }
  }

  // T2/T3 — registry-canonicalized team match, same date.
  const awayEntry = MLB_BY_ABBREV.get(game.awayTeam);
  const homeEntry = MLB_BY_ABBREV.get(game.homeTeam);
  if (!awayEntry || !homeEntry) {
    return {
      matched: false,
      reason: `UNRESOLVED_TEAM: '${game.awayTeam}'/'${game.homeTeam}' not registry abbrevs — cannot canonicalize for matching`,
    };
  }
  const teamDateMatches = candidates.filter((c) => {
    if (c.gameDate !== game.gameDate) return false;
    const away = getMlbTeamByAnSlug(c.awaySlug);
    const home = getMlbTeamByAnSlug(c.homeSlug);
    return away?.abbrev === awayEntry.abbrev && home?.abbrev === homeEntry.abbrev;
  });
  if (teamDateMatches.length === 0) {
    return {
      matched: false,
      reason: `NO_CANDIDATE: no schedule-history row for ${game.awayTeam}@${game.homeTeam} on ${game.gameDate}`,
    };
  }
  if (teamDateMatches.length === 1) {
    return { matched: true, row: teamDateMatches[0], method: "DATE_TEAMS_UNIQUE", confidence: 0.95 };
  }

  // T3 — doubleheader: disambiguate by start instant, never by row order.
  if (game.startUtcMs === null) {
    return {
      matched: false,
      reason: `AMBIGUOUS_DOUBLEHEADER: ${teamDateMatches.length} candidates on ${game.gameDate} and no start instant to disambiguate`,
    };
  }
  const withinTolerance = teamDateMatches.filter((c) => {
    const t = Date.parse(c.startTimeUtc);
    return Number.isFinite(t) && Math.abs(t - game.startUtcMs!) <= START_TIME_TOLERANCE_MS;
  });
  if (withinTolerance.length === 1) {
    return { matched: true, row: withinTolerance[0], method: "DATE_TEAMS_TIME", confidence: 0.8 };
  }
  return {
    matched: false,
    reason: `AMBIGUOUS_DOUBLEHEADER: ${withinTolerance.length} of ${teamDateMatches.length} candidates within ±90min of start — refusing to guess game 1 vs 2`,
  };
}

export type ClosingPair =
  | { available: true; odds: number; oddsOpposite: number; closingLine: number | null }
  | { available: false; reason: string };

function parseAmerican(value: string | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = parseInt(String(value).replace("+", ""), 10);
  return Number.isFinite(n) ? n : null;
}

function parseLine(value: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure: closing odds pair for a graded market/side. Line-bearing markets
 * (RL/total) require the closing line to equal the graded line — a moved line
 * is a different bet, so CLV is honestly unavailable rather than wrong.
 * F5/NRFI/props have no closing source in the DK block → unavailable.
 */
export function closingPairForMarket(
  row: ScheduleHistoryLite,
  market: string,
  gradedBookLine: string | null,
): ClosingPair {
  const need = (odds: number | null, opposite: number | null, closingLine: number | null = null): ClosingPair =>
    odds !== null && opposite !== null
      ? { available: true, odds, oddsOpposite: opposite, closingLine }
      : { available: false, reason: "CLOSING_ODDS_NULL: closing block not captured for this row" };

  const lineMatches = (closingLine: number | null): boolean => {
    const graded = gradedBookLine === null ? null : parseFloat(gradedBookLine);
    if (graded === null || !Number.isFinite(graded) || closingLine === null) return false;
    return Math.abs(Math.abs(graded) - Math.abs(closingLine)) < 1e-9;
  };

  switch (market) {
    case "fg_ml_home":
      return need(parseAmerican(row.dkClosingHomeML), parseAmerican(row.dkClosingAwayML));
    case "fg_ml_away":
      return need(parseAmerican(row.dkClosingAwayML), parseAmerican(row.dkClosingHomeML));
    case "fg_rl_home": {
      const line = parseLine(row.dkClosingHomeRunLine);
      if (!lineMatches(line)) return { available: false, reason: `CLOSING_LINE_MISMATCH: graded RL ${gradedBookLine} vs closing ${line ?? "null"}` };
      return need(parseAmerican(row.dkClosingHomeRunLineOdds), parseAmerican(row.dkClosingAwayRunLineOdds), line);
    }
    case "fg_rl_away": {
      const line = parseLine(row.dkClosingAwayRunLine);
      if (!lineMatches(line)) return { available: false, reason: `CLOSING_LINE_MISMATCH: graded RL ${gradedBookLine} vs closing ${line ?? "null"}` };
      return need(parseAmerican(row.dkClosingAwayRunLineOdds), parseAmerican(row.dkClosingHomeRunLineOdds), line);
    }
    case "fg_over": {
      const line = parseLine(row.dkClosingTotal);
      if (!lineMatches(line)) return { available: false, reason: `CLOSING_LINE_MISMATCH: graded total ${gradedBookLine} vs closing ${line ?? "null"}` };
      return need(parseAmerican(row.dkClosingOverOdds), parseAmerican(row.dkClosingUnderOdds), line);
    }
    case "fg_under": {
      const line = parseLine(row.dkClosingTotal);
      if (!lineMatches(line)) return { available: false, reason: `CLOSING_LINE_MISMATCH: graded total ${gradedBookLine} vs closing ${line ?? "null"}` };
      return need(parseAmerican(row.dkClosingUnderOdds), parseAmerican(row.dkClosingOverOdds), line);
    }
    default:
      return { available: false, reason: `NO_CLOSING_SOURCE: market '${market}' has no DK closing block (F5/NRFI/props)` };
  }
}

/**
 * DB wrapper: load candidates for the game's date, run the pure matcher, and
 * write-through-heal the gamePk on a confident T2/T3 match so subsequent
 * resolutions are T1. Heal failures degrade to a WARN, never break grading.
 */
export async function resolveClosingRowForGame(game: GameIdentity): Promise<ResolverOutcome> {
  const db = await getDb();
  const candidates = (await db
    .select({
      id: mlbScheduleHistory.id,
      anGameId: mlbScheduleHistory.anGameId,
      gamePk: mlbScheduleHistory.gamePk,
      gameDate: mlbScheduleHistory.gameDate,
      startTimeUtc: mlbScheduleHistory.startTimeUtc,
      awaySlug: mlbScheduleHistory.awaySlug,
      homeSlug: mlbScheduleHistory.homeSlug,
      dkClosingAwayRunLine: mlbScheduleHistory.dkClosingAwayRunLine,
      dkClosingAwayRunLineOdds: mlbScheduleHistory.dkClosingAwayRunLineOdds,
      dkClosingHomeRunLine: mlbScheduleHistory.dkClosingHomeRunLine,
      dkClosingHomeRunLineOdds: mlbScheduleHistory.dkClosingHomeRunLineOdds,
      dkClosingTotal: mlbScheduleHistory.dkClosingTotal,
      dkClosingOverOdds: mlbScheduleHistory.dkClosingOverOdds,
      dkClosingUnderOdds: mlbScheduleHistory.dkClosingUnderOdds,
      dkClosingAwayML: mlbScheduleHistory.dkClosingAwayML,
      dkClosingHomeML: mlbScheduleHistory.dkClosingHomeML,
      closingLineLockedAt: mlbScheduleHistory.closingLineLockedAt,
    })
    .from(mlbScheduleHistory)
    .where(eq(mlbScheduleHistory.gameDate, game.gameDate))) as ScheduleHistoryLite[];

  const outcome = matchScheduleHistory(game, candidates);
  if (!outcome.matched) {
    console.warn(`${TAG} [STATE] no closing row for gamePk=${game.mlbGamePk} ${game.awayTeam}@${game.homeTeam} ${game.gameDate}: ${outcome.reason}`);
    return outcome;
  }
  console.log(
    `${TAG} [VERIFY] gamePk=${game.mlbGamePk} → anGameId=${outcome.row.anGameId} method=${outcome.method} confidence=${outcome.confidence} closingLockedAt=${outcome.row.closingLineLockedAt ?? "null"}`,
  );
  if (outcome.method !== "EXACT_GAMEPK" && game.mlbGamePk !== null && outcome.row.gamePk === null) {
    try {
      await db
        .update(mlbScheduleHistory)
        .set({ gamePk: game.mlbGamePk })
        .where(and(eq(mlbScheduleHistory.id, outcome.row.id), isNull(mlbScheduleHistory.gamePk)));
      console.log(`${TAG} [STEP] healed crosswalk: anGameId=${outcome.row.anGameId} gamePk=${game.mlbGamePk} (${outcome.method})`);
    } catch (err) {
      console.warn(`${TAG} [WARN] crosswalk heal failed for anGameId=${outcome.row.anGameId}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return outcome;
}

/** Coverage introspection for the operating brief: how many rows still lack gamePk. */
export async function closingCrosswalkCoverage(): Promise<{ mapped: number; unmapped: number }> {
  const db = await getDb();
  const rows = (await db.execute(
    sql`SELECT SUM(gamePk IS NOT NULL) AS mapped, SUM(gamePk IS NULL) AS unmapped FROM mlb_schedule_history`,
  )) as unknown;
  const first = Array.isArray(rows)
    ? (Array.isArray((rows as unknown[])[0]) ? ((rows as unknown[][])[0][0] as Record<string, unknown>) : ((rows as unknown[])[0] as Record<string, unknown>))
    : {};
  return { mapped: Number(first?.mapped ?? 0), unmapped: Number(first?.unmapped ?? 0) };
}
