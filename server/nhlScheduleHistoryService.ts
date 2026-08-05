/**
 * nhlScheduleHistoryService.ts
 *
 * Fetches NHL game schedules and DraftKings NJ (book_id=68) odds from the
 * Action Network v2 scoreboard API, then upserts results into the
 * nhl_schedule_history table.
 *
 * ─── Data Source ─────────────────────────────────────────────────────────────
 *   API: https://api.actionnetwork.com/web/v2/scoreboard/nhl
 *   Book: DraftKings NJ (book_id=68) — SOLE odds source per user requirement
 *   Markets: markets["68"].event.spread (puck line) / total / moneyline
 *
 * ─── Result Derivation ───────────────────────────────────────────────────────
 *   awayPuckLineCovered — away score + puckLine > home score
 *   homePuckLineCovered — home score - puckLine > away score (inverse)
 *   totalResult         — 'OVER' | 'UNDER' | 'PUSH' vs dkTotal
 *   awayWon             — away score > home score
 *
 * ─── Refresh Cadence ─────────────────────────────────────────────────────────
 *   - Startup: backfill last 30 days
 *   - Every 4 hours during active season (6AM–midnight EST)
 *
 * ─── Logging Standard ────────────────────────────────────────────────────────
 *   [NhlScheduleHistory][STEP] plain-English description
 *   Maximum granularity, zero noise, fully traceable
 */
import axios from "axios";
import { getDb } from "./db";
import {
  nhlScheduleHistory,
  type InsertNhlScheduleHistory,
  type NhlScheduleHistoryRow,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────
const TAG = "[NhlScheduleHistory]";
const AN_API_BASE = "https://api.actionnetwork.com/web/v2/scoreboard/nhl";
const DK_NJ_BOOK_ID = 68;
const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface AnV2Outcome {
  side?: string;
  team_id?: number;
  odds?: number;
  value?: number;
  is_live?: boolean;
}
interface AnV2MarketEvent {
  spread?: AnV2Outcome[];
  total?: AnV2Outcome[];
  moneyline?: AnV2Outcome[];
}
interface AnV2Market {
  event?: AnV2MarketEvent;
}
interface AnV2Team {
  id: number;
  abbr: string;
  full_name: string;
  url_slug: string;
}
interface AnV2Boxscore {
  total_away_points?: number | null;
  total_home_points?: number | null;
}
interface AnV2Game {
  id: number;
  status: string;
  start_time: string;
  away_team_id: number;
  home_team_id: number;
  teams: AnV2Team[];
  boxscore?: AnV2Boxscore;
  markets?: Record<string, AnV2Market>;
}
interface AnV2Response {
  games?: AnV2Game[];
}

export interface NhlScheduleRefreshResult {
  date: string;
  fetched: number;
  upserted: number;
  skipped: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an American odds integer to a signed string.
 * e.g. 129 → "+129", -156 → "-156"
 */
function fmtOdds(odds: number | null | undefined): string | null {
  if (odds == null) return null;
  const rounded = Math.round(odds);
  if (rounded >= 0) return `+${rounded}`;
  return String(rounded);
}

/**
 * Find the first pre-game outcome matching the given criteria.
 * Filters out live lines (is_live=true) to ensure we only store pre-game odds.
 */
function findPreGameOutcome(
  outcomes: AnV2Outcome[] | undefined,
  criteria: { side?: string; teamId?: number }
): AnV2Outcome | null {
  if (!outcomes?.length) return null;
  const preGame = outcomes.filter(o => !o.is_live);
  if (!preGame.length) return null;

  if (criteria.side) {
    return preGame.find(o => o.side === criteria.side) ?? null;
  }
  if (criteria.teamId != null) {
    return preGame.find(o => o.team_id === criteria.teamId) ?? null;
  }
  return null;
}

/**
 * Convert a UTC ISO date string to YYYY-MM-DD in EST (UTC-5 / UTC-4 DST).
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
 * Format a Date as YYYYMMDD for the AN API date parameter.
 */
function formatAnDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Derive whether the away team covered the puck line.
 * NHL puck line is almost always ±1.5.
 * away covers if: awayScore + awayPuckLine > homeScore
 */
function deriveAwayPuckLineCovered(
  awayScore: number | null,
  homeScore: number | null,
  awayPuckLine: number | null
): boolean | null {
  if (awayScore == null || homeScore == null || awayPuckLine == null)
    return null;
  return awayScore + awayPuckLine > homeScore;
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
 * Fetch all NHL games for a single date from the AN v2 API (DK NJ book only).
 * Returns structured game data ready for DB upsert.
 *
 * @param dateStr - YYYYMMDD format (e.g. "20260410")
 */
export async function fetchNhlScheduleForDate(
  dateStr: string
): Promise<InsertNhlScheduleHistory[]> {
  const url = `${AN_API_BASE}?bookIds=30,${DK_NJ_BOOK_ID}&date=${dateStr}&periods=event`;

  console.log(
    `${TAG}[FETCH] Requesting AN API for date=${dateStr} | URL: ${url}`
  );

  let response: AnV2Response;
  try {
    const res = await axios.get<AnV2Response>(url, {
      headers: AN_HEADERS,
      timeout: 15_000,
    });
    response = res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${TAG}[FETCH] AN API request FAILED for date=${dateStr}: ${msg}`
    );
    throw new Error(`AN API fetch failed for date=${dateStr}: ${msg}`);
  }

  const games = response.games ?? [];
  console.log(
    `${TAG}[FETCH] AN API returned ${games.length} games for date=${dateStr}`
  );

  const results: InsertNhlScheduleHistory[] = [];
  let skippedNoTeam = 0;
  let skippedNoDk = 0;

  for (const game of games) {
    const teams = game.teams ?? [];
    const awayTeam = teams.find(t => t.id === game.away_team_id);
    const homeTeam = teams.find(t => t.id === game.home_team_id);

    if (!awayTeam || !homeTeam) {
      console.warn(
        `${TAG}[SKIP] Game id=${game.id} — missing team data` +
          ` (away_id=${game.away_team_id}, home_id=${game.home_team_id})`
      );
      skippedNoTeam++;
      continue;
    }

    const gameLabel = `${awayTeam.abbr} @ ${homeTeam.abbr} (anId=${game.id})`;

    // ── Extract DK NJ market (markets is a dict keyed by book_id string) ─────
    const dkMarket = game.markets?.[String(DK_NJ_BOOK_ID)]?.event;

    // NHL: spread = puck line (±1.5)
    const dkPuckAway = findPreGameOutcome(dkMarket?.spread, { side: "away" });
    const dkPuckHome = findPreGameOutcome(dkMarket?.spread, { side: "home" });
    const dkTotalOver = findPreGameOutcome(dkMarket?.total, { side: "over" });
    const dkTotalUnder = findPreGameOutcome(dkMarket?.total, { side: "under" });
    const dkMlAway = findPreGameOutcome(dkMarket?.moneyline, {
      teamId: game.away_team_id,
    });
    const dkMlHome = findPreGameOutcome(dkMarket?.moneyline, {
      teamId: game.home_team_id,
    });

    const hasDk = !!(dkPuckAway || dkTotalOver || dkMlAway);
    if (!hasDk) {
      skippedNoDk++;
      console.log(
        `${TAG}[ODDS] ${gameLabel} — DK NJ has no odds yet (status=${game.status}), storing without odds`
      );
    }

    // ── Extract final scores ──────────────────────────────────────────────────
    const bs = game.boxscore;
    const awayScore =
      bs?.total_away_points != null ? Number(bs.total_away_points) : null;
    const homeScore =
      bs?.total_home_points != null ? Number(bs.total_home_points) : null;
    const isComplete = game.status === "complete";

    // ── Puck line and total values ────────────────────────────────────────────
    const awayPuckLineVal =
      dkPuckAway?.value != null ? Number(dkPuckAway.value) : null;
    const homePuckLineVal =
      dkPuckHome?.value != null ? Number(dkPuckHome.value) : null;
    const totalVal =
      dkTotalOver?.value != null ? Number(dkTotalOver.value) : null;

    // ── Derive result columns (only for complete games with scores) ───────────
    const awayPuckLineCovered = isComplete
      ? deriveAwayPuckLineCovered(awayScore, homeScore, awayPuckLineVal)
      : null;
    const homePuckLineCovered =
      isComplete && awayPuckLineCovered != null ? !awayPuckLineCovered : null;
    const totalResult = isComplete
      ? deriveTotalResult(awayScore, homeScore, totalVal)
      : null;
    const awayWon =
      isComplete && awayScore != null && homeScore != null
        ? awayScore > homeScore
        : null;

    // ── Determine game date in EST ────────────────────────────────────────────
    const gameDateEst = utcToEstDate(game.start_time);

    console.log(
      `${TAG}[GAME] ${gameLabel} | date=${gameDateEst} status=${game.status}` +
        ` | score=${awayScore ?? "?"}–${homeScore ?? "?"}` +
        ` | DK puck=${awayPuckLineVal != null ? (awayPuckLineVal > 0 ? "+" : "") + awayPuckLineVal : "—"}` +
        `(${fmtOdds(dkPuckAway?.odds) ?? "—"})` +
        ` total=${totalVal ?? "—"}(${fmtOdds(dkTotalOver?.odds) ?? "—"})` +
        ` ML=${fmtOdds(dkMlAway?.odds) ?? "—"}/${fmtOdds(dkMlHome?.odds) ?? "—"}` +
        (isComplete
          ? ` | puck_cov=${awayPuckLineCovered ?? "—"} total=${totalResult ?? "—"} awayWon=${awayWon ?? "—"}`
          : "")
    );

    results.push({
      anGameId: game.id,
      gameDate: gameDateEst,
      startTimeUtc: game.start_time,
      gameStatus: game.status,
      awaySlug: awayTeam.url_slug,
      awayAbbr: awayTeam.abbr,
      awayName: awayTeam.full_name,
      awayTeamId: game.away_team_id,
      awayScore: awayScore,
      homeSlug: homeTeam.url_slug,
      homeAbbr: homeTeam.abbr,
      homeName: homeTeam.full_name,
      homeTeamId: game.home_team_id,
      homeScore: homeScore,
      dkAwayPuckLine: awayPuckLineVal != null ? String(awayPuckLineVal) : null,
      dkAwayPuckLineOdds: fmtOdds(dkPuckAway?.odds),
      dkHomePuckLine: homePuckLineVal != null ? String(homePuckLineVal) : null,
      dkHomePuckLineOdds: fmtOdds(dkPuckHome?.odds),
      dkTotal: totalVal != null ? String(totalVal) : null,
      dkOverOdds: fmtOdds(dkTotalOver?.odds),
      dkUnderOdds: fmtOdds(dkTotalUnder?.odds),
      dkAwayML: fmtOdds(dkMlAway?.odds),
      dkHomeML: fmtOdds(dkMlHome?.odds),
      awayPuckLineCovered: awayPuckLineCovered,
      homePuckLineCovered: homePuckLineCovered,
      totalResult: totalResult,
      awayWon: awayWon,
      lastRefreshedAt: Date.now(),
    });
  }

  console.log(
    `${TAG}[FETCH] date=${dateStr} — parsed ${results.length} games` +
      ` | ${results.filter(g => g.dkAwayPuckLine != null).length} with DK NJ puck line` +
      ` | ${skippedNoDk} without DK odds` +
      ` | ${skippedNoTeam} skipped (no team data)`
  );

  return results;
}

// ─── DB Upsert Function ───────────────────────────────────────────────────────

/**
 * Upsert a batch of NHL schedule history rows into the DB.
 * Uses anGameId as the deduplication key.
 * On conflict: updates all mutable fields (scores, status, odds, results, lastRefreshedAt).
 */
export async function upsertNhlScheduleHistory(
  rows: InsertNhlScheduleHistory[]
): Promise<{ upserted: number; errors: string[] }> {
  if (!rows.length) {
    console.log(`${TAG}[UPSERT] No rows to upsert — skipping`);
    return { upserted: 0, errors: [] };
  }

  let upserted = 0;
  const errors: string[] = [];
  const db = await getDb();

  for (const row of rows) {
    try {
      await db
        .insert(nhlScheduleHistory)
        .values(row)
        .onDuplicateKeyUpdate({
          set: {
            gameStatus: row.gameStatus,
            awayScore: row.awayScore,
            homeScore: row.homeScore,
            dkAwayPuckLine: row.dkAwayPuckLine,
            dkAwayPuckLineOdds: row.dkAwayPuckLineOdds,
            dkHomePuckLine: row.dkHomePuckLine,
            dkHomePuckLineOdds: row.dkHomePuckLineOdds,
            dkTotal: row.dkTotal,
            dkOverOdds: row.dkOverOdds,
            dkUnderOdds: row.dkUnderOdds,
            dkAwayML: row.dkAwayML,
            dkHomeML: row.dkHomeML,
            awayPuckLineCovered: row.awayPuckLineCovered,
            homePuckLineCovered: row.homePuckLineCovered,
            totalResult: row.totalResult,
            awayWon: row.awayWon,
            lastRefreshedAt: row.lastRefreshedAt,
          },
        });
      upserted++;
    } catch (err) {
      const msg =
        `anGameId=${row.anGameId} ${row.awayAbbr}@${row.homeAbbr}: ` +
        (err instanceof Error ? err.message : String(err));
      console.error(`${TAG}[UPSERT] ERROR — ${msg}`);
      errors.push(msg);
    }
  }

  console.log(
    `${TAG}[UPSERT] Complete — upserted=${upserted} errors=${errors.length}`
  );
  return { upserted, errors };
}

// ─── Main Refresh Function ────────────────────────────────────────────────────

/**
 * Refresh NHL schedule history for a single date.
 * Fetches from AN DK NJ API and upserts into nhl_schedule_history.
 *
 * @param dateStr - YYYYMMDD format (e.g. "20260410")
 */
export async function refreshNhlScheduleForDate(
  dateStr: string
): Promise<NhlScheduleRefreshResult> {
  console.log(`${TAG}[REFRESH] ════ Starting refresh for date=${dateStr} ════`);

  let rows: InsertNhlScheduleHistory[];
  try {
    rows = await fetchNhlScheduleForDate(dateStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG}[REFRESH] Fetch failed for date=${dateStr}: ${msg}`);
    return {
      date: dateStr,
      fetched: 0,
      upserted: 0,
      skipped: 0,
      errors: [msg],
    };
  }

  const { upserted, errors } = await upsertNhlScheduleHistory(rows);

  const result: NhlScheduleRefreshResult = {
    date: dateStr,
    fetched: rows.length,
    upserted,
    skipped: rows.length - upserted,
    errors,
  };

  console.log(
    `${TAG}[REFRESH] ════ DONE date=${dateStr}` +
      ` | fetched=${result.fetched} upserted=${result.upserted}` +
      ` skipped=${result.skipped} errors=${result.errors.length} ════`
  );

  return result;
}

/**
 * Backfill NHL schedule history for the last N days (default: 30).
 * Runs sequentially to avoid hammering the AN API.
 */
export async function backfillNhlScheduleHistory(
  daysBack = 30
): Promise<NhlScheduleRefreshResult[]> {
  console.log(`${TAG}[BACKFILL] ════ Starting ${daysBack}-day backfill ════`);

  const results: NhlScheduleRefreshResult[] = [];
  const now = new Date();

  for (let i = 0; i <= daysBack; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = formatAnDate(d);

    try {
      const result = await refreshNhlScheduleForDate(dateStr);
      results.push(result);

      // Brief pause between requests to be respectful to the AN API
      if (i < daysBack) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG}[BACKFILL] ERROR on date=${dateStr}: ${msg}`);
      results.push({
        date: dateStr,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        errors: [msg],
      });
    }
  }

  const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
  const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  console.log(
    `${TAG}[BACKFILL] ════ COMPLETE — ${daysBack} days` +
      ` | totalFetched=${totalFetched} totalUpserted=${totalUpserted}` +
      ` totalErrors=${totalErrors} ════`
  );

  return results;
}

// ─── DB Query Helpers ─────────────────────────────────────────────────────────

/**
 * Get the last N completed games for a specific NHL team (by AN url_slug).
 * Returns games where the team was either away or home.
 * Sorted by gameDate DESC (most recent first).
 *
 * @param teamSlug - AN url_slug, e.g. "boston-bruins"
 * @param limit    - Number of games to return (default: 5 for Last 5 panel)
 */
export async function getNhlLastNGamesForTeam(
  teamSlug: string,
  limit = 5
): Promise<NhlScheduleHistoryRow[]> {
  console.log(
    `${TAG}[QUERY] Fetching last ${limit} completed games for team slug="${teamSlug}"`
  );

  const db = await getDb();
  const rows = await db
    .select()
    .from(nhlScheduleHistory)
    .where(eq(nhlScheduleHistory.gameStatus, "complete"))
    .orderBy(nhlScheduleHistory.gameDate)
    .limit(300);

  const teamGames = (rows as NhlScheduleHistoryRow[])
    .filter(r => r.awaySlug === teamSlug || r.homeSlug === teamSlug)
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
    .slice(0, limit);

  console.log(
    `${TAG}[QUERY] Found ${teamGames.length} completed games for team="${teamSlug}"` +
      ` (searched ${rows.length} total complete games)`
  );

  return teamGames;
}

/**
 * Get the full schedule for an NHL team (all games, any status).
 * Returns games sorted by gameDate DESC (most recent first).
 *
 * @param teamSlug - AN url_slug, e.g. "boston-bruins"
 */
export async function getNhlFullScheduleForTeam(
  teamSlug: string
): Promise<NhlScheduleHistoryRow[]> {
  console.log(
    `${TAG}[QUERY] Fetching full schedule for team slug="${teamSlug}"`
  );

  const db = await getDb();
  const rows = await db
    .select()
    .from(nhlScheduleHistory)
    .orderBy(nhlScheduleHistory.gameDate)
    .limit(500);

  const teamGames = (rows as NhlScheduleHistoryRow[])
    .filter(r => r.awaySlug === teamSlug || r.homeSlug === teamSlug)
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate));

  console.log(
    `${TAG}[QUERY] Found ${teamGames.length} total games for team="${teamSlug}"`
  );

  return teamGames;
}

/**
 * Get last 5 completed games for both teams in an NHL matchup.
 * Used to power the Last 5 Games panel on each matchup card.
 *
 * @param awaySlug - AN url_slug for the away team
 * @param homeSlug - AN url_slug for the home team
 */
export async function getNhlLast5ForMatchup(
  awaySlug: string,
  homeSlug: string
): Promise<{
  awayLast5: NhlScheduleHistoryRow[];
  homeLast5: NhlScheduleHistoryRow[];
}> {
  console.log(
    `${TAG}[QUERY] Fetching Last 5 for matchup: away="${awaySlug}" vs home="${homeSlug}"`
  );

  const [awayLast5, homeLast5] = await Promise.all([
    getNhlLastNGamesForTeam(awaySlug, 5),
    getNhlLastNGamesForTeam(homeSlug, 5),
  ]);

  console.log(
    `${TAG}[QUERY] Last 5 results — away="${awaySlug}": ${awayLast5.length} games` +
      ` | home="${homeSlug}": ${homeLast5.length} games`
  );

  return { awayLast5, homeLast5 };
}

/**
 * Compute situational records for an NHL team from their schedule history.
 * Used to power the Situational Results panel (Overall, Last 10, Home/Away, Fav/Dog).
 *
 * @param teamSlug - AN url_slug, e.g. "boston-bruins"
 * @param limit    - Max games to analyze (default: 82 = full season)
 */
export async function getNhlSituationalStats(teamSlug: string, limit = 82) {
  console.log(
    `${TAG}[SITUATIONAL] Computing situational stats for team="${teamSlug}" limit=${limit}`
  );

  const db = await getDb();
  const rows = await db
    .select()
    .from(nhlScheduleHistory)
    .where(eq(nhlScheduleHistory.gameStatus, "complete"))
    .orderBy(nhlScheduleHistory.gameDate)
    .limit(500);

  const teamGames = (rows as NhlScheduleHistoryRow[])
    .filter(r => r.awaySlug === teamSlug || r.homeSlug === teamSlug)
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
    .slice(0, limit);

  const isAway = (g: NhlScheduleHistoryRow) => g.awaySlug === teamSlug;

  const teamWon = (g: NhlScheduleHistoryRow): boolean | null => {
    if (g.awayWon == null) return null;
    return isAway(g) ? g.awayWon : !g.awayWon;
  };

  const teamCovered = (g: NhlScheduleHistoryRow): boolean | null => {
    if (isAway(g)) return g.awayPuckLineCovered ?? null;
    return g.homePuckLineCovered ?? null;
  };

  const wasFavorite = (g: NhlScheduleHistoryRow): boolean => {
    const ml = isAway(g) ? g.dkAwayML : g.dkHomeML;
    if (!ml) return false;
    return parseInt(ml, 10) < 0;
  };

  const wasHome = (g: NhlScheduleHistoryRow): boolean => !isAway(g);

  const computeRecord = (
    games: NhlScheduleHistoryRow[],
    wonFn: (g: NhlScheduleHistoryRow) => boolean | null
  ) => {
    let w = 0,
      l = 0;
    for (const g of games) {
      const won = wonFn(g);
      if (won === true) w++;
      else if (won === false) l++;
    }
    return { w, l };
  };

  const computeAtsRecord = (games: NhlScheduleHistoryRow[]) => {
    let w = 0,
      l = 0;
    for (const g of games) {
      const cov = teamCovered(g);
      if (cov === true) w++;
      else if (cov === false) l++;
    }
    return { w, l };
  };

  const computeOuRecord = (games: NhlScheduleHistoryRow[]) => {
    let over = 0,
      under = 0,
      push = 0;
    for (const g of games) {
      if (g.totalResult === "OVER") over++;
      else if (g.totalResult === "UNDER") under++;
      else if (g.totalResult === "PUSH") push++;
    }
    return { over, under, push };
  };

  const last10 = teamGames.slice(0, 10);
  const homeGames = teamGames.filter(wasHome);
  const awayGames = teamGames.filter(g => !wasHome(g));
  const favGames = teamGames.filter(wasFavorite);
  const dogGames = teamGames.filter(g => !wasFavorite(g));

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

  console.log(
    `${TAG}[SITUATIONAL] team="${teamSlug}" analyzed=${teamGames.length} games` +
      ` | ML overall=${stats.ml.overall.w}-${stats.ml.overall.l}` +
      ` | ATS overall=${stats.spread.overall.w}-${stats.spread.overall.l}` +
      ` | O/U overall=${stats.total.overall.over}-${stats.total.overall.under}`
  );

  return stats;
}
