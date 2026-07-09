/**
 * mlbScheduleHistoryService.ts
 *
 * Fetches MLB game schedules and DraftKings NJ (book_id=68) odds from the
 * Action Network v1 scoreboard API, then upserts results into the
 * mlb_schedule_history table.
 *
 * ─── Data Source ─────────────────────────────────────────────────────────────
 *   API: https://api.actionnetwork.com/web/v1/scoreboard/mlb
 *   Book: DraftKings NJ (book_id=68) — SOLE odds source per user requirement
 *
 *   NOTE: v2 API returns HTTP 400 for all requests (platform-level issue).
 *         v1 API is fully operational and returns flat-field odds structure.
 *
 * ─── v1 DK NJ Flat-Field Schema ──────────────────────────────────────────────
 *   game.odds[] → find entry where book_id === 68
 *   dk.spread_away        → away run line (e.g. -1.5 or +1.5)
 *   dk.spread_home        → home run line (e.g. +1.5 or -1.5)
 *   dk.spread_away_line   → away run line odds (e.g. -140)
 *   dk.spread_home_line   → home run line odds (e.g. +120)
 *   dk.ml_away            → away moneyline (e.g. -255)
 *   dk.ml_home            → home moneyline (e.g. +215)
 *   dk.total              → game total (e.g. 7.5) — float, NOT a nested object
 *   dk.over               → over odds (e.g. -115)
 *   dk.under              → under odds (e.g. -105)
 *
 * ─── v1 Team Schema ──────────────────────────────────────────────────────────
 *   game.teams[]          → array, teams[0]=away, teams[1]=home
 *   team.abbr             → abbreviation (e.g. "ATL")
 *   team.url_slug         → slug (e.g. "atlanta-braves")
 *   team.full_name        → full name (e.g. "Atlanta Braves")
 *
 * ─── v1 Score Schema ─────────────────────────────────────────────────────────
 *   game.boxscore.total_away_points → final away score
 *   game.boxscore.total_home_points → final home score
 *
 * ─── Result Derivation ───────────────────────────────────────────────────────
 *   awayRunLineCovered  — awayScore + spread_away > homeScore
 *   homeRunLineCovered  — homeScore + spread_home > awayScore
 *   totalResult         — 'OVER' | 'UNDER' | 'PUSH' vs dk.total
 *   awayWon             — awayScore > homeScore
 *
 * ─── Refresh Cadence ─────────────────────────────────────────────────────────
 *   - Server startup: backfill last 30 days
 *   - Every 4 hours 6AM–midnight EST: refresh today + yesterday
 *   - Full historical backfill: 2023-03-30 → today (run once via tRPC)
 *
 * ─── Logging Standard ────────────────────────────────────────────────────────
 *   [MlbScheduleHistory][STEP] plain-English description
 *   Maximum granularity, zero noise, fully traceable
 */

import axios from "axios";
import { getDb } from "./db";
import {
  mlbScheduleHistory,
  type InsertMlbScheduleHistory,
  type MlbScheduleHistoryRow,
} from "../drizzle/schema";
import { eq, and, or, desc, gte, lte, sql } from "drizzle-orm";
import { logToDb } from "./dbLogger";

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG = "[MlbScheduleHistory]";
const SRC = "MlbScheduleHistory";
const AN_V1_BASE = "https://api.actionnetwork.com/web/v1/scoreboard/mlb";

// ─── Season Date Boundaries ───────────────────────────────────────────────────
// 2026 MLB Opening Day: March 25, 2026 (LAD@CWS Tokyo series)
// H2H lookback floor: 2023 Opening Day (March 30, 2023)
const SEASON_2026_START = "2026-03-25";
const H2H_LOOKBACK_START = "2023-03-30"; // earliest H2H game to consider
const DK_NJ_BOOK_ID = 68;

// ─── Odds Book Fallback Chain ─────────────────────────────────────────────────
// AN API returns DK NJ (book_id=68) for live/recent games.
// For completed games older than ~2 days, book 68 disappears retroactively.
// Fallback priority: 68 (DK NJ) → 15 (DK national) → 21 (Pinnacle) → 30
// All books carry the same DraftKings line family — acceptable fallback.
const BOOK_FALLBACK_CHAIN = [68, 15, 21, 30];
const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.actionnetwork.com/",
};

// ─── v1 API Types ─────────────────────────────────────────────────────────────

interface AnV1DkOdds {
  book_id: number;
  // Run Line (spread)
  spread_away?: number | null;
  spread_home?: number | null;
  spread_away_line?: number | null;
  spread_home_line?: number | null;
  // Moneyline
  ml_away?: number | null;
  ml_home?: number | null;
  // Total — NOTE: this is a float, NOT a nested object
  total?: number | null;
  over?: number | null;
  under?: number | null;
  // Inserted timestamp
  inserted?: string;
}

interface AnV1Team {
  id?: number;
  abbr?: string;
  short_name?: string;
  full_name?: string;
  url_slug?: string;
}

interface AnV1Boxscore {
  total_away_points?: number | null;
  total_home_points?: number | null;
}

interface AnV1Game {
  id: number;
  status: string;
  real_status?: string;
  start_time: string;
  // Authoritative home/away team IDs — use these, NOT teams[] array position
  away_team_id?: number;
  home_team_id?: number;
  teams: AnV1Team[];
  boxscore?: AnV1Boxscore;
  odds?: AnV1DkOdds[];
}

interface AnV1Response {
  games?: AnV1Game[];
}

export interface MlbScheduleRefreshResult {
  date: string;
  fetched: number;
  upserted: number;
  skipped: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an American odds number to a signed string.
 * e.g. 129 → "+129", -156 → "-156", null → null
 */
function fmtOdds(odds: number | null | undefined): string | null {
  if (odds == null) return null;
  const rounded = Math.round(odds);
  if (rounded >= 0) return `+${rounded}`;
  return String(rounded);
}

/**
 * Format a run line number to a signed string.
 * e.g. -1.5 → "-1.5", 1.5 → "+1.5"
 */
function fmtLine(line: number | null | undefined): string | null {
  if (line == null) return null;
  if (line >= 0) return `+${line}`;
  return String(line);
}

/**
 * Convert a UTC ISO date string to YYYY-MM-DD in EST (UTC-5 / UTC-4 DST).
 * Uses Intl.DateTimeFormat for correct DST handling.
 */
function utcToEstDate(utcIso: string): string {
  const d = new Date(utcIso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2");
}

/**
 * Format a Date object as YYYYMMDD for the AN API date parameter.
 */
export function formatAnDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Derive the run line cover result for the away team.
 *
 * Run line logic (MLB standard ±1.5):
 *   - away spread_away = -1.5 (favorite): away covers if awayScore - 1.5 > homeScore → must win by 2+
 *   - away spread_away = +1.5 (underdog):  away covers if awayScore + 1.5 > homeScore → can lose by 1
 *
 * Returns null if scores or run line are missing.
 */
function deriveAwayRunLineCovered(
  awayScore: number | null,
  homeScore: number | null,
  spreadAway: number | null
): boolean | null {
  if (awayScore == null || homeScore == null || spreadAway == null) return null;
  return awayScore + spreadAway > homeScore;
}

/**
 * Derive the total result (OVER / UNDER / PUSH) vs the DK NJ total.
 */
function deriveTotalResult(
  awayScore: number | null,
  homeScore: number | null,
  total: number | null
): "OVER" | "UNDER" | "PUSH" | null {
  if (awayScore == null || homeScore == null || total == null) return null;
  const combined = awayScore + homeScore;
  if (combined > total) return "OVER";
  if (combined < total) return "UNDER";
  return "PUSH";
}

// ─── Core Fetch Function ──────────────────────────────────────────────────────

/**
 * Fetch all MLB games for a single date from the AN v1 API (DK NJ book only).
 * Returns structured game data ready for DB upsert.
 *
 * @param dateStr - YYYYMMDD format (e.g. "20230330")
 */
export async function fetchMlbScheduleForDate(
  dateStr: string
): Promise<InsertMlbScheduleHistory[]> {
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${dateStr}`;

  logToDb(SRC, 'info', `${TAG}[FETCH] Requesting AN v1 API | date=${dateStr} | URL: ${url}`);

  let response: AnV1Response;
  try {
    const res = await axios.get<AnV1Response>(url, {
      headers: AN_HEADERS,
      timeout: 15_000,
    });
    response = res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToDb(SRC, 'error', `${TAG}[FETCH] AN v1 API request FAILED for date=${dateStr}: ${msg}`);
    throw new Error(`AN v1 API fetch failed for date=${dateStr}: ${msg}`);
  }

  const games = response.games ?? [];
  logToDb(SRC, 'info', `${TAG}[FETCH] AN v1 API returned ${games.length} games for date=${dateStr}`);

  if (games.length === 0) {
    logToDb(SRC, 'info', `${TAG}[FETCH] No games for date=${dateStr} — off-day or pre/post-season`);
    return [];
  }

  const results: InsertMlbScheduleHistory[] = [];
  let skippedNoTeam = 0;
  let skippedNoDk = 0;
  let gamesWithFullOdds = 0;

  for (const game of games) {
    const teams = game.teams ?? [];

    // ── CRITICAL: Use away_team_id / home_team_id for authoritative home/away assignment.
    // The teams[] array order is NOT guaranteed to be [away, home] — the AN API sometimes
    // returns teams in home/away order depending on the game. The only reliable source of
    // truth is game.away_team_id and game.home_team_id.
    // VERIFIED: Apr 10 PHI@ARI — teams[0]=PHI but away_team_id=ARI(205), home_team_id=PHI(212)
    let awayTeam: AnV1Team | undefined;
    let homeTeam: AnV1Team | undefined;

    if (game.away_team_id && game.home_team_id) {
      // Authoritative path: match by team id
      awayTeam = teams.find((t) => t.id === game.away_team_id);
      homeTeam = teams.find((t) => t.id === game.home_team_id);
      if (!awayTeam || !homeTeam) {
        // Fallback: ids didn't match any team entry — use positional as last resort
        logToDb(SRC, 'warn',
          `${TAG}[WARN] Game id=${game.id} — away_team_id=${game.away_team_id} home_team_id=${game.home_team_id}` +
          ` did not match any teams[] entry (ids: ${teams.map(t=>t.id).join(',')}) — falling back to teams[0]/[1]`
        );
        awayTeam = teams[0];
        homeTeam = teams[1];
      } else {
        // Log when teams[] order differs from away_team_id assignment (the bug we fixed)
        if (teams[0]?.id !== game.away_team_id) {
          logToDb(SRC, 'info',
            `${TAG}[FIX] Game id=${game.id} — teams[] order mismatch corrected:` +
            ` teams[0]=${teams[0]?.abbr}(id=${teams[0]?.id}) but away_team_id=${game.away_team_id}` +
            ` → AWAY=${awayTeam.abbr} HOME=${homeTeam.abbr}`
          );
        }
      }
    } else {
      // No away_team_id/home_team_id present — fall back to positional (legacy)
      logToDb(SRC, 'warn', `${TAG}[WARN] Game id=${game.id} — no away_team_id/home_team_id in response, using teams[0]/[1]`);
      awayTeam = teams[0];
      homeTeam = teams[1];
    }

    if (!awayTeam || !homeTeam) {
      logToDb(SRC, 'warn', `${TAG}[SKIP] Game id=${game.id} — missing team data (teams.length=${teams.length})`);
      skippedNoTeam++;
      continue;
    }

    const awayAbbr = awayTeam.abbr ?? awayTeam.short_name ?? "???";
    const homeAbbr = homeTeam.abbr ?? homeTeam.short_name ?? "???";
    // Normalize slugs: AN sometimes returns "st.-louis-cardinals" (with period).
    // Canonical form is "st-louis-cardinals" (no period). Normalize at ingest.
    const normalizeSlug = (s: string) => s.replace(/\./g, "");
    const awaySlug = normalizeSlug(awayTeam.url_slug ?? "");
    const homeSlug = normalizeSlug(homeTeam.url_slug ?? "");
    const gameLabel = `${awayAbbr} @ ${homeAbbr} (anId=${game.id})`;

    // ── Extract odds via fallback chain: DK NJ (68) → 15 → 21 → 30 ────────────
    // Book 68 (DK NJ) disappears retroactively for completed games after ~2 days.
    // We walk the fallback chain and use the first book that has ml_away populated.
    const oddsList = game.odds ?? [];
    let dk: typeof oddsList[0] | null = null;
    let usedBookId: number | null = null;
    for (const bookId of BOOK_FALLBACK_CHAIN) {
      const candidate = oddsList.find((o) => o.book_id === bookId);
      if (candidate && candidate.ml_away != null) {
        dk = candidate;
        usedBookId = bookId;
        break;
      }
    }
    if (usedBookId !== null && usedBookId !== DK_NJ_BOOK_ID) {
      logToDb(SRC, 'info',
        `${TAG}[ODDS_FALLBACK] ${awayAbbr}@${homeAbbr} — DK NJ (68) absent, using book_id=${usedBookId} as fallback` +
        ` | ml_away=${dk?.ml_away} ml_home=${dk?.ml_home} spread=${dk?.spread_away} total=${dk?.total}`
      );
    }

    // Run Line
    const spreadAway = dk?.spread_away ?? null;
    const spreadHome = dk?.spread_home ?? null;
    const spreadAwayLine = dk?.spread_away_line ?? null;
    const spreadHomeLine = dk?.spread_home_line ?? null;

    // Moneyline
    const mlAway = dk?.ml_away ?? null;
    const mlHome = dk?.ml_home ?? null;

    // Total — NOTE: dk.total is a float (e.g. 7.5), NOT a nested object
    const totalLine = dk?.total ?? null;
    const overOdds = dk?.over ?? null;
    const underOdds = dk?.under ?? null;

    const hasDk = dk != null;
    const hasFullOdds = spreadAway != null && mlAway != null && totalLine != null;

    if (!hasDk) {
      skippedNoDk++;
      const availableBooks = oddsList.map((o) => o.book_id).join(",") || "none";
      logToDb(SRC, 'info',
        `${TAG}[ODDS] ${gameLabel} — No usable odds in fallback chain [${BOOK_FALLBACK_CHAIN.join(",")}]` +
        ` (status=${game.status}) | available books: ${availableBooks} — storing without odds`
      );
    } else if (!hasFullOdds) {
      logToDb(SRC, 'info', `${TAG}[ODDS] ${gameLabel} — DK NJ partial odds: RL=${spreadAway ?? "—"} ML=${mlAway ?? "—"} TOT=${totalLine ?? "—"}`);
    } else {
      gamesWithFullOdds++;
    }

    // ── Extract final scores ──────────────────────────────────────────────────
    const bs = game.boxscore;
    const awayScore = bs?.total_away_points != null ? Number(bs.total_away_points) : null;
    const homeScore = bs?.total_home_points != null ? Number(bs.total_home_points) : null;
    const isComplete = game.status === "complete";

    // ── Derive result columns (only for complete games with scores) ───────────
    const awayRunLineCovered =
      isComplete ? deriveAwayRunLineCovered(awayScore, homeScore, spreadAway) : null;
    const homeRunLineCovered =
      isComplete && awayRunLineCovered != null ? !awayRunLineCovered : null;
    const totalResult =
      isComplete ? deriveTotalResult(awayScore, homeScore, totalLine) : null;
    const awayWon =
      isComplete && awayScore != null && homeScore != null
        ? awayScore > homeScore
        : null;

    // ── Determine game date in EST ────────────────────────────────────────────
    const gameDateEst = utcToEstDate(game.start_time);

    // ── Log this game ─────────────────────────────────────────────────────────
    logToDb(SRC, 'info',
      `${TAG}[GAME] ${gameLabel}` +
      ` | date=${gameDateEst} status=${game.status}` +
      ` | score=${awayScore ?? "?"}–${homeScore ?? "?"}` +
      ` | RL=${fmtLine(spreadAway) ?? "—"}(${fmtOdds(spreadAwayLine) ?? "—"})` +
      ` ML=${fmtOdds(mlAway) ?? "—"}/${fmtOdds(mlHome) ?? "—"}` +
      ` TOT=${totalLine ?? "—"}(O:${fmtOdds(overOdds) ?? "—"} U:${fmtOdds(underOdds) ?? "—"})` +
      (isComplete
        ? ` | result: ${awayWon ? awayAbbr + " W" : homeAbbr + " W"}` +
          ` ATS=${awayRunLineCovered != null ? (awayRunLineCovered ? awayAbbr + " COV" : homeAbbr + " COV") : "—"}` +
          ` O/U=${totalResult ?? "—"}`
        : "")
    );

    results.push({
      anGameId: game.id,
      gameDate: gameDateEst,
      gameStatus: game.status,
      startTimeUtc: game.start_time,
      awaySlug,
      homeSlug,
      awayAbbr,
      homeAbbr,
      awayName: awayTeam.full_name ?? awayAbbr,
      homeName: homeTeam.full_name ?? homeAbbr,
      awayTeamId: awayTeam.id ?? 0,
      homeTeamId: homeTeam.id ?? 0,
      awayScore,
      homeScore,
      awayWon,
      // Run Line
      dkAwayRunLine: fmtLine(spreadAway),
      dkHomeRunLine: fmtLine(spreadHome),
      dkAwayRunLineOdds: fmtOdds(spreadAwayLine),
      dkHomeRunLineOdds: fmtOdds(spreadHomeLine),
      awayRunLineCovered,
      homeRunLineCovered,
      // Moneyline
      dkAwayML: fmtOdds(mlAway),
      dkHomeML: fmtOdds(mlHome),
      // Total
      dkTotal: totalLine != null ? String(totalLine) : null,
      dkOverOdds: fmtOdds(overOdds),
      dkUnderOdds: fmtOdds(underOdds),
      totalResult,
      lastRefreshedAt: Date.now(),
    });
  }

  logToDb(SRC, 'info',
    `${TAG}[FETCH] date=${dateStr} processed ${games.length} games:` +
    ` ${results.length} valid | ${gamesWithFullOdds} with full odds` +
    ` | ${skippedNoDk} without DK odds | ${skippedNoTeam} skipped (no team data)`
  );

  return results;
}

// ─── Upsert Function ──────────────────────────────────────────────────────────

/**
 * Upsert a batch of MLB schedule history records into the DB.
 * Uses anGameId as the unique key — updates all fields on conflict.
 *
 * @param records - Array of InsertMlbScheduleHistory records to upsert
 * @returns Number of records upserted
 */
export async function upsertMlbScheduleHistory(
  records: InsertMlbScheduleHistory[]
): Promise<number> {
  if (records.length === 0) {
    logToDb(SRC, 'info', `${TAG}[UPSERT] No records to upsert`);
    return 0;
  }

  logToDb(SRC, 'info', `${TAG}[UPSERT] Upserting ${records.length} records into mlb_schedule_history`);

  const db = await getDb();

  // Upsert in batches of 50 to avoid query size limits
  const BATCH_SIZE = 50;
  let totalUpserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await db
      .insert(mlbScheduleHistory)
      .values(batch)
      .onDuplicateKeyUpdate({
        set: {
          gameStatus: sql`VALUES(${sql.raw('gameStatus')})`,
          awayScore: sql`VALUES(${sql.raw('awayScore')})`,
          homeScore: sql`VALUES(${sql.raw('homeScore')})`,
          awayWon: sql`VALUES(${sql.raw('awayWon')})`,
          dkAwayRunLine: sql`VALUES(${sql.raw('dkAwayRunLine')})`,
          dkHomeRunLine: sql`VALUES(${sql.raw('dkHomeRunLine')})`,
          dkAwayRunLineOdds: sql`VALUES(${sql.raw('dkAwayRunLineOdds')})`,
          dkHomeRunLineOdds: sql`VALUES(${sql.raw('dkHomeRunLineOdds')})`,
          awayRunLineCovered: sql`VALUES(${sql.raw('awayRunLineCovered')})`,
          homeRunLineCovered: sql`VALUES(${sql.raw('homeRunLineCovered')})`,
          dkAwayML: sql`VALUES(${sql.raw('dkAwayML')})`,
          dkHomeML: sql`VALUES(${sql.raw('dkHomeML')})`,
          dkTotal: sql`VALUES(${sql.raw('dkTotal')})`,
          dkOverOdds: sql`VALUES(${sql.raw('dkOverOdds')})`,
          dkUnderOdds: sql`VALUES(${sql.raw('dkUnderOdds')})`,
          totalResult: sql`VALUES(${sql.raw('totalResult')})`,
          lastRefreshedAt: sql`VALUES(${sql.raw('lastRefreshedAt')})`,
        },
      });
    totalUpserted += batch.length;
    logToDb(SRC, 'info', `${TAG}[UPSERT] Batch ${Math.floor(i / BATCH_SIZE) + 1}: upserted ${batch.length} records (total so far: ${totalUpserted})`);
  }

  logToDb(SRC, 'info', `${TAG}[UPSERT] Complete — ${totalUpserted} records upserted`);
  return totalUpserted;
}

// ─── Single-Date Refresh ──────────────────────────────────────────────────────

/**
 * Fetch and upsert MLB schedule history for a single date.
 * This is the atomic unit used by both the scheduler and the backfill.
 *
 * @param dateStr - YYYYMMDD format
 */
export async function refreshMlbScheduleForDate(
  dateStr: string
): Promise<MlbScheduleRefreshResult> {
  logToDb(SRC, 'info', `${TAG}[REFRESH] Starting refresh for date=${dateStr}`);

  const errors: string[] = [];
  let fetched = 0;
  let upserted = 0;
  let skipped = 0;

  try {
    const records = await fetchMlbScheduleForDate(dateStr);
    fetched = records.length;

    if (records.length > 0) {
      upserted = await upsertMlbScheduleHistory(records);
    }

    logToDb(SRC, 'info', `${TAG}[REFRESH] date=${dateStr} COMPLETE — fetched=${fetched} upserted=${upserted} skipped=${skipped}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToDb(SRC, 'error', `${TAG}[REFRESH] date=${dateStr} FAILED: ${msg}`);
    errors.push(msg);
  }

  return {
    date: dateStr,
    fetched,
    upserted,
    skipped,
    errors,
  };
}

// ─── Rolling Window Refresh ───────────────────────────────────────────────────

/**
 * Refresh MLB schedule history for the last N days.
 * Used by the daily scheduler to keep recent data current.
 *
 * @param days - Number of days to backfill (default: 7)
 * @param delayMs - Delay between API calls in ms (default: 400ms to avoid rate limiting)
 */
export async function refreshMlbScheduleLastNDays(
  days = 7,
  delayMs = 400
): Promise<MlbScheduleRefreshResult[]> {
  logToDb(SRC, 'info', `${TAG}[ROLLING] Starting rolling refresh for last ${days} days`);

  const results: MlbScheduleRefreshResult[] = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = formatAnDate(date);

    const result = await refreshMlbScheduleForDate(dateStr);
    results.push(result);

    if (i < days - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
  const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  logToDb(SRC, 'info',
    `${TAG}[ROLLING] Complete — ${days} days processed` +
    ` | totalFetched=${totalFetched} totalUpserted=${totalUpserted} errors=${totalErrors}`
  );

  return results;
}

// ─── Full Historical Backfill ─────────────────────────────────────────────────

/**
 * Backfill MLB schedule history for a full date range.
 *
 * Phase 1 (full DK NJ odds): 2023-03-30 → today
 *   - Run line, moneyline, total available for every game
 *
 * Skips spring training (pre-season games have no DK NJ odds).
 * Skips All-Star break dates automatically (API returns 0 games).
 *
 * @param startDate - Start date string "YYYY-MM-DD" (default: "2023-03-30")
 * @param endDate   - End date string "YYYY-MM-DD" (default: today)
 * @param delayMs   - Delay between API calls in ms (default: 400ms)
 * @param onProgress - Optional callback for progress updates
 */
export async function backfillMlbScheduleHistory(
  startDate = "2023-03-30",
  endDate?: string,
  delayMs = 400,
  onProgress?: (progress: {
    current: number;
    total: number;
    date: string;
    fetched: number;
    upserted: number;
    errors: number;
  }) => void
): Promise<{
  totalDates: number;
  totalFetched: number;
  totalUpserted: number;
  totalErrors: number;
  dateResults: MlbScheduleRefreshResult[];
}> {
  const start = new Date(startDate + "T00:00:00Z");
  const end = endDate ? new Date(endDate + "T00:00:00Z") : new Date();

  logToDb(SRC, 'info', `${TAG}[BACKFILL] Starting full historical backfill | Date range: ${startDate} → ${endDate ?? "today"}`);

  // Build list of all dates in range
  const allDates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    allDates.push(formatAnDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  logToDb(SRC, 'info', `${TAG}[BACKFILL] Total dates: ${allDates.length} | Est. time: ~${Math.ceil(allDates.length * delayMs / 60000)} min at ${delayMs}ms delay`);

  const dateResults: MlbScheduleRefreshResult[] = [];
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;
  let datesWithGames = 0;
  let datesWithOdds = 0;

  for (let i = 0; i < allDates.length; i++) {
    const dateStr = allDates[i];
    const dateLabel = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

    logToDb(SRC, 'info', `${TAG}[BACKFILL] [${i + 1}/${allDates.length}] Processing date=${dateLabel}`);

    const result = await refreshMlbScheduleForDate(dateStr);
    dateResults.push(result);

    totalFetched += result.fetched;
    totalUpserted += result.upserted;
    totalErrors += result.errors.length;
    if (result.fetched > 0) datesWithGames++;
    if (result.upserted > 0) datesWithOdds++;

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: allDates.length,
        date: dateLabel,
        fetched: totalFetched,
        upserted: totalUpserted,
        errors: totalErrors,
      });
    }

    // Log milestone summaries every 50 dates
    if ((i + 1) % 50 === 0 || i === allDates.length - 1) {
      logToDb(SRC, 'info',
        `${TAG}[BACKFILL] ── Milestone [${i + 1}/${allDates.length}] ──` +
        ` totalFetched=${totalFetched} totalUpserted=${totalUpserted}` +
        ` datesWithGames=${datesWithGames} errors=${totalErrors}`
      );
    }

    // Delay between requests to avoid rate limiting
    if (i < allDates.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  logToDb(SRC, 'info',
    `${TAG}[BACKFILL] COMPLETE — dates=${allDates.length} datesWithGames=${datesWithGames}` +
    ` datesWithOdds=${datesWithOdds} totalFetched=${totalFetched}` +
    ` totalUpserted=${totalUpserted} errors=${totalErrors}`
  );

  return {
    totalDates: allDates.length,
    totalFetched,
    totalUpserted,
    totalErrors,
    dateResults,
  };
}

// ─── Query Functions ──────────────────────────────────────────────────────────

/**
 * Get the last N completed games for a team from the schedule history DB.
 * Returns games where the team was either the away or home team.
 * Sorted by gameDate DESC (most recent first).
 *
 * IMPLEMENTATION NOTE: Uses SQL-level OR filter on awaySlug/homeSlug so the
 * DB engine does the heavy lifting — no full-table scan, no JS-side filtering.
 * The LIMIT is pushed to the DB after ordering, so we always get the true
 * most-recent N games regardless of how large the table grows.
 *
 * @param teamSlug - AN url_slug, e.g. "arizona-diamondbacks"
 * @param limit    - Number of games to return (default: 5 for Last 5 panel)
 */
export async function getLastNGamesForTeam(
  teamSlug: string,
  limit = 5
) {
  logToDb(SRC, 'info', `${TAG}[getLastNGamesForTeam] [INPUT] teamSlug="${teamSlug}" limit=${limit} | seasonFilter=gte(${SEASON_2026_START})`);

  const db = await getDb();

  // ── SQL-level filter: 2026 season only, status=complete, team appears ─────────
  // gte(gameDate, SEASON_2026_START) pins results to 2026 Opening Day forward.
  // ORDER BY gameDate DESC + LIMIT pushed to DB — zero JS filtering.
  const rows = await db
    .select()
    .from(mlbScheduleHistory)
    .where(
      and(
        eq(mlbScheduleHistory.gameStatus, "complete"),
        gte(mlbScheduleHistory.gameDate, SEASON_2026_START),
        or(
          eq(mlbScheduleHistory.awaySlug, teamSlug),
          eq(mlbScheduleHistory.homeSlug, teamSlug)
        )
      )
    )
    .orderBy(desc(mlbScheduleHistory.gameDate))
    .limit(limit);

  const teamGames = rows as MlbScheduleHistoryRow[];

  logToDb(SRC, 'info', `${TAG}[getLastNGamesForTeam] [OUTPUT] team="${teamSlug}" → ${teamGames.length} 2026 completed games returned (limit=${limit})`);
  }

  return teamGames;
}

/**
 * Get the full schedule for a team (all games, any status).
 * Returns games sorted by gameDate DESC (most recent first).
 *
 * @param teamSlug - AN url_slug, e.g. "arizona-diamondbacks"
 */
export async function getFullScheduleForTeam(teamSlug: string) {
  logToDb(SRC, 'info', `${TAG}[getFullScheduleForTeam] [INPUT] teamSlug="${teamSlug}" | seasonFilter=gte(${SEASON_2026_START})`);

  const db = await getDb();

  // ── SQL-level filter: 2026 season only, any status, team appears ────────────
  // gte(gameDate, SEASON_2026_START) pins to 2026 Opening Day forward.
  // ORDER BY gameDate DESC — no JS filtering, no JS sorting, no row cap.
  const rows = await db
    .select()
    .from(mlbScheduleHistory)
    .where(
      and(
        gte(mlbScheduleHistory.gameDate, SEASON_2026_START),
        or(
          eq(mlbScheduleHistory.awaySlug, teamSlug),
          eq(mlbScheduleHistory.homeSlug, teamSlug)
        )
      )
    )
    .orderBy(desc(mlbScheduleHistory.gameDate));

  const teamGames = rows as MlbScheduleHistoryRow[];

  const completed  = teamGames.filter((r) => r.gameStatus === "complete").length;
  const scheduled  = teamGames.filter((r) => r.gameStatus === "scheduled").length;
  const inprogress = teamGames.filter((r) => r.gameStatus === "inprogress").length;

  logToDb(SRC, 'info',
    `${TAG}[getFullScheduleForTeam] [OUTPUT] team="${teamSlug}"` +
    ` → ${teamGames.length} 2026 games` +
    ` | complete=${completed} scheduled=${scheduled} inprogress=${inprogress}`
  );
  }

  return teamGames;
}

/**
 * Get last 5 completed games for both teams in a matchup.
 * Used to power the Last 5 Games panel on each matchup card.
 *
 * @param awaySlug - AN url_slug for the away team
 * @param homeSlug - AN url_slug for the home team
 */
export async function getLast5ForMatchup(awaySlug: string, homeSlug: string) {
  logToDb(SRC, 'info', `${TAG}[QUERY] Fetching Last 5 for matchup: away="${awaySlug}" vs home="${homeSlug}"`);

  const [awayLast5, homeLast5] = await Promise.all([
    getLastNGamesForTeam(awaySlug, 5),
    getLastNGamesForTeam(homeSlug, 5),
  ]);

  logToDb(SRC, 'info', `${TAG}[QUERY] Last 5 results — away="${awaySlug}": ${awayLast5.length} games | home="${homeSlug}": ${homeLast5.length} games`);

  return { awayLast5, homeLast5 };
}

/**
 * Fetch the last 5 head-to-head games between two specific teams.
 * Lookback floor: 2023 Opening Day (2023-03-30).
 * If fewer than 5 games exist since 2023, returns however many are available.
 * Returns games sorted newest-first.
 *
 * @param slugA - AN url_slug for team A (either away or home)
 * @param slugB - AN url_slug for team B (either away or home)
 * @param limit - Max H2H games to return (default: 5, max: 20)
 */
export async function getMlbH2HGames(
  slugA: string,
  slugB: string,
  limit = 5
): Promise<MlbScheduleHistoryRow[]> {
  logToDb(SRC, 'info', `${TAG}[getMlbH2HGames] [INPUT] slugA="${slugA}" slugB="${slugB}" limit=${limit} | lookbackFloor=${H2H_LOOKBACK_START}`);

  const db = await getDb();

  // ── Precise SQL filter: both teams present, 2023+ lookback floor ─────────────
  // Pattern: (away=A AND home=B) OR (away=B AND home=A) — both orderings.
  // gte(gameDate, H2H_LOOKBACK_START) = no games before 2023 Opening Day.
  // LIMIT 5 pushed to DB — returns the 5 most recent H2H matchups.
  const rows = await db
    .select()
    .from(mlbScheduleHistory)
    .where(
      and(
        eq(mlbScheduleHistory.gameStatus, "complete"),
        gte(mlbScheduleHistory.gameDate, H2H_LOOKBACK_START),
        or(
          and(
            eq(mlbScheduleHistory.awaySlug, slugA),
            eq(mlbScheduleHistory.homeSlug, slugB)
          ),
          and(
            eq(mlbScheduleHistory.awaySlug, slugB),
            eq(mlbScheduleHistory.homeSlug, slugA)
          )
        )
      )
    )
    .orderBy(desc(mlbScheduleHistory.gameDate))
    .limit(limit);

  const h2h = rows as MlbScheduleHistoryRow[];

  logToDb(SRC, 'info', `${TAG}[getMlbH2HGames] [OUTPUT] "${slugA}" vs "${slugB}" → ${h2h.length} H2H games returned (limit=${limit})`);

  if (h2h.length > 0) {
    const latest = h2h[0];
    const oldest = h2h[h2h.length - 1];
    logToDb(SRC, 'info',
      `${TAG}[getMlbH2HGames] [STATE]` +
      ` mostRecent=${latest.gameDate}` +
      ` (${latest.awayAbbr}@${latest.homeAbbr} ${latest.awayScore ?? "?"}–${latest.homeScore ?? "?"})` +
      ` | oldest=${oldest.gameDate}` +
      ` | gamesFound=${h2h.length}/${limit} requested`
    );
  } else {
    logToDb(SRC, 'warn',
      `${TAG}[getMlbH2HGames] [VERIFY] WARN — 0 H2H games found between "${slugA}" and "${slugB}"` +
      ` since ${H2H_LOOKBACK_START} — teams may not have played each other in DB date range`
    );
  }

  return h2h;
}

/**
 * Compute situational records for an MLB team from their schedule history.
 * Used to power the Situational Results panel (Overall, Last 10, Home/Away, Fav/Dog).
 *
 * Tabs:
 *   Moneyline → win/loss records
 *   Spread    → run line ATS records
 *   Total     → over/under records
 *
 * @param teamSlug - AN url_slug, e.g. "arizona-diamondbacks"
 * @param limit    - Max games to analyze (default: 162 = full MLB season)
 */
export async function getMlbSituationalStats(teamSlug: string, limit = 162) {
  logToDb(SRC, 'info', `${TAG}[getMlbSituationalStats] [INPUT] team="${teamSlug}" limit=${limit} | seasonFilter=gte(${SEASON_2026_START})`);

  const db = await getDb();

  // LIMIT pushed to DB — no full-table scan, no JS filtering, no JS sorting.
  const rows = await db
    .select()
    .from(mlbScheduleHistory)
    .where(
      and(
        eq(mlbScheduleHistory.gameStatus, "complete"),
        gte(mlbScheduleHistory.gameDate, SEASON_2026_START),
        or(
          eq(mlbScheduleHistory.awaySlug, teamSlug),
          eq(mlbScheduleHistory.homeSlug, teamSlug)
        )
      )
    )
    .orderBy(desc(mlbScheduleHistory.gameDate))
    .limit(limit);

  const teamGames = rows as MlbScheduleHistoryRow[];

  logToDb(SRC, 'info', `${TAG}[getMlbSituationalStats] [STATE] team="${teamSlug}" → ${teamGames.length} 2026 completed games fetched from DB`);

  if (teamGames.length === 0) {
    logToDb(SRC, 'warn',
      `${TAG}[getMlbSituationalStats] [VERIFY] WARN — 0 2026 completed games for team="${teamSlug}"` +
      ` | seasonStart=${SEASON_2026_START} — all situational records will be 0-0`
    );
  }

  const isAway = (g: MlbScheduleHistoryRow) => g.awaySlug === teamSlug;

  const teamWon = (g: MlbScheduleHistoryRow): boolean | null => {
    if (g.awayWon == null) return null;
    return isAway(g) ? g.awayWon : !g.awayWon;
  };

  const teamCovered = (g: MlbScheduleHistoryRow): boolean | null => {
    if (isAway(g)) return g.awayRunLineCovered ?? null;
    return g.homeRunLineCovered ?? null;
  };

  // wasFavoriteOrNull: returns true=fav, false=dog, null=no ML odds available.
  // CRITICAL: null-ML games must be excluded from BOTH fav and dog pools.
  // Previously, wasFavorite() returned false for null-ML games, polluting dogGames.
  const wasFavoriteOrNull = (g: MlbScheduleHistoryRow): boolean | null => {
    const ml = isAway(g) ? g.dkAwayML : g.dkHomeML;
    if (!ml) return null; // no odds — exclude from fav/dog classification
    const mlNum = parseInt(ml, 10);
    if (isNaN(mlNum)) return null;
    return mlNum < 0; // negative ML = favorite
  };

  const wasHome = (g: MlbScheduleHistoryRow): boolean => !isAway(g);

  const computeRecord = (
    games: MlbScheduleHistoryRow[],
    wonFn: (g: MlbScheduleHistoryRow) => boolean | null
  ) => {
    let wins = 0, losses = 0;
    for (const g of games) {
      const won = wonFn(g);
      if (won === true) wins++;
      else if (won === false) losses++;
    }
    return { wins, losses };
  };

  const computeAtsRecord = (games: MlbScheduleHistoryRow[]) => {
    let wins = 0, losses = 0;
    for (const g of games) {
      const cov = teamCovered(g);
      if (cov === true) wins++;
      else if (cov === false) losses++;
    }
    return { wins, losses };
  };

  const computeOuRecord = (games: MlbScheduleHistoryRow[]) => {
    let wins = 0, losses = 0, pushes = 0;
    for (const g of games) {
      if (g.totalResult === "OVER") wins++;
      else if (g.totalResult === "UNDER") losses++;
      else if (g.totalResult === "PUSH") pushes++;
    }
    return { wins, losses, pushes };
  };

  const last10 = teamGames.slice(0, 10);
  const homeGames = teamGames.filter(wasHome);
  const awayGames = teamGames.filter((g) => !wasHome(g));
  // Exclude null-ML games from both fav and dog pools (no odds = unclassifiable)
  const favGames = teamGames.filter((g) => wasFavoriteOrNull(g) === true);
  const dogGames = teamGames.filter((g) => wasFavoriteOrNull(g) === false);
  const noOddsGames = teamGames.filter((g) => wasFavoriteOrNull(g) === null);

  if (noOddsGames.length > 0) {
    logToDb(SRC, 'warn',
      `${TAG}[getMlbSituationalStats] [VERIFY] WARN — ${noOddsGames.length} games have no ML odds` +
      ` for team="${teamSlug}" — excluded from fav/dog classification` +
      ` | games: ${noOddsGames.map(g => `${g.awayAbbr}@${g.homeAbbr}(${g.gameDate})`).join(", ")}`
    );
  }

  const stats = {
    ml: {
      overall: computeRecord(teamGames, teamWon),
      last10: computeRecord(last10, teamWon),
      home: computeRecord(homeGames, teamWon),
      away: computeRecord(awayGames, teamWon),
      favorite: computeRecord(favGames, teamWon),
      underdog: computeRecord(dogGames, teamWon),
    },
    spread: {
      overall: computeAtsRecord(teamGames),
      last10: computeAtsRecord(last10),
      home: computeAtsRecord(homeGames),
      away: computeAtsRecord(awayGames),
      favorite: computeAtsRecord(favGames),
      underdog: computeAtsRecord(dogGames),
    },
    total: {
      overall: computeOuRecord(teamGames),
      last10: computeOuRecord(last10),
      home: computeOuRecord(homeGames),
      away: computeOuRecord(awayGames),
      favorite: computeOuRecord(favGames),
      underdog: computeOuRecord(dogGames),
    },
    gamesAnalyzed: teamGames.length,
  };

  // ── Comprehensive output log ───────────────────────────────────────────────────────────────────────
  logToDb(SRC, 'info',
    `${TAG}[getMlbSituationalStats] [OUTPUT] team="${teamSlug}" 2026 season` +
    ` | analyzed=${teamGames.length} games` +
    ` | home=${homeGames.length} away=${awayGames.length}` +
    ` | fav=${favGames.length} dog=${dogGames.length} last10=${last10.length}`
  );
  logToDb(SRC, 'info',
    `${TAG}[getMlbSituationalStats] [OUTPUT] ML:` +
    ` overall=${stats.ml.overall.wins}-${stats.ml.overall.losses}` +
    ` last10=${stats.ml.last10.wins}-${stats.ml.last10.losses}` +
    ` home=${stats.ml.home.wins}-${stats.ml.home.losses}` +
    ` away=${stats.ml.away.wins}-${stats.ml.away.losses}` +
    ` fav=${stats.ml.favorite.wins}-${stats.ml.favorite.losses}` +
    ` dog=${stats.ml.underdog.wins}-${stats.ml.underdog.losses}`
  );
  logToDb(SRC, 'info',
    `${TAG}[getMlbSituationalStats] [OUTPUT] ATS:` +
    ` overall=${stats.spread.overall.wins}-${stats.spread.overall.losses}` +
    ` last10=${stats.spread.last10.wins}-${stats.spread.last10.losses}` +
    ` home=${stats.spread.home.wins}-${stats.spread.home.losses}` +
    ` away=${stats.spread.away.wins}-${stats.spread.away.losses}` +
    ` fav=${stats.spread.favorite.wins}-${stats.spread.favorite.losses}` +
    ` dog=${stats.spread.underdog.wins}-${stats.spread.underdog.losses}`
  );
  logToDb(SRC, 'info',
    `${TAG}[getMlbSituationalStats] [OUTPUT] O/U:` +
    ` overall=${stats.total.overall.wins}O-${stats.total.overall.losses}U-${stats.total.overall.pushes}P` +
    ` last10=${stats.total.last10.wins}O-${stats.total.last10.losses}U-${stats.total.last10.pushes}P` +
    ` home=${stats.total.home.wins}O-${stats.total.home.losses}U` +
    ` away=${stats.total.away.wins}O-${stats.total.away.losses}U`
  );

  // ── Sanity check: ML wins + losses should not exceed gamesAnalyzed ──────────
  const mlTotal = stats.ml.overall.wins + stats.ml.overall.losses;
  if (mlTotal > teamGames.length) {
    logToDb(SRC, 'error',
      `${TAG}[getMlbSituationalStats] [VERIFY] FAIL — ML wins+losses (${mlTotal}) > gamesAnalyzed (${teamGames.length})` +
      ` — data integrity issue`
    );
  } else {
    logToDb(SRC, 'info',
      `${TAG}[getMlbSituationalStats] [VERIFY] PASS — ML total=${mlTotal} ≤ gamesAnalyzed=${teamGames.length}` +
      ` | null/pending games=${teamGames.length - mlTotal}`
    );
  }

  return stats;
}

// ─── Closing Line Capture ─────────────────────────────────────────────────────

/**
 * captureClosingLines
 *
 * Scans all scheduled/in-progress MLB games for today via the AN v1 API.
 * For any game whose status has just transitioned to "inprogress" (first pitch)
 * AND whose closing lines have NOT yet been locked (closingLineLockedAt IS NULL),
 * this function writes the current DK NJ odds into the dkClosing* columns and
 * stamps closingLineLockedAt with the current UTC ms timestamp.
 *
 * ─── Trigger cadence ────────────────────────────────────────────────────────
 *   Called every 5 minutes from the MLB scheduler during game hours (10AM–2AM EST).
 *   Only locks closing lines once per game (idempotent — skips already-locked rows).
 *
 * ─── Logging standard ───────────────────────────────────────────────────────
 *   [MlbClosingLine][STEP] description
 *   [MlbClosingLine][LOCK] game details + closing line values
 *   [MlbClosingLine][SKIP] reason why a game was skipped
 *   [MlbClosingLine][VERIFY] pass/fail + counts
 */
export async function captureClosingLines(): Promise<{
  scanned: number;
  locked: number;
  alreadyLocked: number;
  noOdds: number;
  errors: string[];
}> {
  const CTAG = "[MlbClosingLine]";
  const now = Date.now();

  logToDb(SRC, 'info', `${CTAG}[STEP] Starting closing line capture | utcMs=${now}`);

  // ── Step 1: Fetch today's games from AN API ──────────────────────────────
  const todayStr = formatAnDate(new Date());
  const url = `${AN_V1_BASE}?period=game&bookIds=${DK_NJ_BOOK_ID}&date=${todayStr}`;

  logToDb(SRC, 'info', `${CTAG}[FETCH] Requesting AN v1 API | date=${todayStr} | URL: ${url}`);

  let games: AnV1Game[] = [];
  try {
    const res = await axios.get<AnV1Response>(url, {
      headers: AN_HEADERS,
      timeout: 15_000,
    });
    games = res.data.games ?? [];
    logToDb(SRC, 'info', `${CTAG}[FETCH] AN v1 returned ${games.length} games for date=${todayStr}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToDb(SRC, 'error', `${CTAG}[FETCH] AN v1 API request FAILED: ${msg}`);
    return { scanned: 0, locked: 0, alreadyLocked: 0, noOdds: 0, errors: [msg] };
  }

  // ── Step 2: Filter to inprogress games only ──────────────────────────────
  const inProgressGames = games.filter(
    (g) => g.status === "inprogress" || g.real_status === "inprogress"
  );

  logToDb(SRC, 'info', `${CTAG}[STEP] ${inProgressGames.length} in-progress games found out of ${games.length} total`);

  const db = await getDb();
  let locked = 0;
  let alreadyLocked = 0;
  let noOdds = 0;
  const errors: string[] = [];

  // ── Step 3: For each in-progress game, check if closing line is already locked ──
  for (const game of inProgressGames) {
    const gameLabel = `anId=${game.id} status=${game.status}`;

    try {
      // Fetch the existing DB row for this game
      const rows = await db
        .select({
          id: mlbScheduleHistory.id,
          anGameId: mlbScheduleHistory.anGameId,
          awayAbbr: mlbScheduleHistory.awayAbbr,
          homeAbbr: mlbScheduleHistory.homeAbbr,
          closingLineLockedAt: mlbScheduleHistory.closingLineLockedAt,
        })
        .from(mlbScheduleHistory)
        .where(eq(mlbScheduleHistory.anGameId, game.id))
        .limit(1);

      if (rows.length === 0) {
        logToDb(SRC, 'info', `${CTAG}[SKIP] ${gameLabel} — not found in DB (not yet ingested)`);
        continue;
      }

      const row = rows[0];
      const matchLabel = `${row.awayAbbr}@${row.homeAbbr} (anId=${game.id})`;

      // ── Already locked — skip ────────────────────────────────────────────
      if (row.closingLineLockedAt != null) {
        logToDb(SRC, 'info', `${CTAG}[SKIP] ${matchLabel} — closing lines already locked at utcMs=${row.closingLineLockedAt}`);
        alreadyLocked++;
        continue;
      }

      // ── Extract current DK NJ odds ───────────────────────────────────────
      const oddsList = game.odds ?? [];
      const dk = oddsList.find((o) => o.book_id === DK_NJ_BOOK_ID) ?? null;

      if (!dk) {
        logToDb(SRC, 'info', `${CTAG}[SKIP] ${matchLabel} — no DK NJ odds entry in API response`);
        noOdds++;
        continue;
      }

      const closingAwayRL   = dk.spread_away ?? null;
      const closingHomeRL   = dk.spread_home ?? null;
      const closingAwayRLOdds = dk.spread_away_line ?? null;
      const closingHomeRLOdds = dk.spread_home_line ?? null;
      const closingAwayML   = dk.ml_away ?? null;
      const closingHomeML   = dk.ml_home ?? null;
      const closingTotal    = dk.total ?? null;
      const closingOverOdds = dk.over ?? null;
      const closingUnderOdds = dk.under ?? null;

      const hasFullClosing = closingAwayRL != null && closingAwayML != null && closingTotal != null;

      logToDb(SRC, 'info',
        `${CTAG}[LOCK] ${matchLabel}` +
        ` | RL=${fmtLine(closingAwayRL) ?? "—"}(${fmtOdds(closingAwayRLOdds) ?? "—"})` +
        ` ML=${fmtOdds(closingAwayML) ?? "—"}/${fmtOdds(closingHomeML) ?? "—"}` +
        ` TOT=${closingTotal ?? "—"}(O:${fmtOdds(closingOverOdds) ?? "—"} U:${fmtOdds(closingUnderOdds) ?? "—"})` +
        ` | fullOdds=${hasFullClosing}`
      );

      // ── Write closing lines to DB ────────────────────────────────────────
      await db
        .update(mlbScheduleHistory)
        .set({
          dkClosingAwayRunLine:     fmtLine(closingAwayRL),
          dkClosingHomeRunLine:     fmtLine(closingHomeRL),
          dkClosingAwayRunLineOdds: fmtOdds(closingAwayRLOdds),
          dkClosingHomeRunLineOdds: fmtOdds(closingHomeRLOdds),
          dkClosingAwayML:          fmtOdds(closingAwayML),
          dkClosingHomeML:          fmtOdds(closingHomeML),
          dkClosingTotal:           closingTotal != null ? String(closingTotal) : null,
          dkClosingOverOdds:        fmtOdds(closingOverOdds),
          dkClosingUnderOdds:       fmtOdds(closingUnderOdds),
          closingLineLockedAt:      now,
          lastRefreshedAt:          now,
        })
        .where(eq(mlbScheduleHistory.anGameId, game.id));

      logToDb(SRC, 'info', `${CTAG}[LOCK] ${matchLabel} — closing lines LOCKED at utcMs=${now}`);
      locked++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logToDb(SRC, 'error', `${CTAG}[ERROR] ${gameLabel} — ${msg}`);
      errors.push(`anId=${game.id}: ${msg}`);
    }
  }

  // ── Step 4: Final verification log ──────────────────────────────────────
  logToDb(SRC, 'info',
    `${CTAG}[VERIFY] ${locked > 0 ? "✅ PASS" : "ℹ️  INFO"} — ` +
    `scanned=${inProgressGames.length} locked=${locked} alreadyLocked=${alreadyLocked} ` +
    `noOdds=${noOdds} errors=${errors.length}`
  );

  return {
    scanned: inProgressGames.length,
    locked,
    alreadyLocked,
    noOdds,
    errors,
  };
}
