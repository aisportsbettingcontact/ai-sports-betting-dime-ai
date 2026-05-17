/**
 * NHL Schedule API scraper
 *
 * Fetches game start times (in ET) and live scores from the NHL.com API.
 * No authentication required — public endpoint.
 *
 * Data source: https://api-web.nhle.com/v1/schedule/now
 *   Returns a 7-day game week starting from today.
 *   For specific dates: https://api-web.nhle.com/v1/schedule/{YYYY-MM-DD}
 *
 * Team resolution: NHL API uses 3-letter abbreviations (e.g. "BOS", "SJS").
 * These are resolved to DB slugs via NHL_BY_ABBREV from the registry.
 *
 * Time format: startTimeUTC is "2026-03-12T23:00:00Z" (UTC).
 * The easternUTCOffset field (e.g. "-04:00") is used to convert to ET.
 * During EST (UTC-5): 23:00 UTC → 18:00 ET
 * During EDT (UTC-4): 23:00 UTC → 19:00 ET
 *
 * Game states:
 *   "FUT" = scheduled (future)
 *   "PRE" = pre-game
 *   "LIVE" = in progress
 *   "CRIT" = critical moment (late game)
 *   "FINAL" = final
 *   "OFF" = official (final, box score complete)
 */

import { NHL_BY_ABBREV } from "../shared/nhlTeams";

// ─── Public API URL ───────────────────────────────────────────────────────────
const NHL_SCHEDULE_BASE = "https://api-web.nhle.com/v1/schedule";

// ─── Cache ────────────────────────────────────────────────────────────────────
interface ScheduleCache {
  data: NhlScheduleGame[];
  fetchedAt: number;
  dateKey: string; // "YYYY-MM-DD" of the date this cache covers
}
let cachedSchedule: ScheduleCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Types ────────────────────────────────────────────────────────────────────
export interface NhlScheduleGame {
  /** NHL game ID, e.g. 2025021027 */
  gameId: number;
  /** DB-style slug for away team, e.g. "san_jose_sharks" */
  awayDbSlug: string;
  /** DB-style slug for home team, e.g. "boston_bruins" */
  homeDbSlug: string;
  /** 3-letter abbreviation for away team, e.g. "SJS" */
  awayAbbrev: string;
  /** 3-letter abbreviation for home team, e.g. "BOS" */
  homeAbbrev: string;
  /**
   * Start time in ET as "HH:MM" (24-hour), e.g. "19:00".
   * "TBD" when no confirmed start time.
   */
  startTimeEst: string;
  /** Game date in YYYY-MM-DD (Eastern Time) */
  gameDateEst: string;
  /**
   * Game state: "upcoming" | "live" | "final"
   * Maps from NHL API states: FUT/PRE → upcoming, LIVE/CRIT → live, FINAL/OFF → final
   */
  gameState: "upcoming" | "live" | "final";
  /** Away team score (null if game not started) */
  awayScore: number | null;
  /** Home team score (null if game not started) */
  homeScore: number | null;
  /** Game type: 1=preseason, 2=regular, 3=playoffs */
  gameType: number;
}

export interface NhlLiveGame {
  awayDbSlug: string;
  homeDbSlug: string;
  awayScore: number | null;
  homeScore: number | null;
  gameState: "upcoming" | "live" | "final";
  gameClock: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a UTC ISO timestamp and ET offset to a "HH:MM" ET time string.
 *
 * Example:
 *   startTimeUTC = "2026-03-12T23:00:00Z"
 *   easternUTCOffset = "-04:00"  (EDT)
 *   → 23:00 UTC - 4h = 19:00 ET → "19:00"
 *
 * Example:
 *   startTimeUTC = "2026-03-12T00:00:00Z"
 *   easternUTCOffset = "-05:00"  (EST)
 *   → 00:00 UTC - 5h = 19:00 ET (previous day) → "19:00"
 */
function utcToEt(startTimeUTC: string, easternUTCOffset: string): string {
  try {
    const utcMs = new Date(startTimeUTC).getTime();
    if (isNaN(utcMs)) return "TBD";

    // Parse offset: "-04:00" → -4 hours
    const offsetMatch = easternUTCOffset.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!offsetMatch) return "TBD";

    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const offsetHours = parseInt(offsetMatch[2], 10);
    const offsetMins = parseInt(offsetMatch[3], 10);
    const offsetMs = sign * (offsetHours * 60 + offsetMins) * 60 * 1000;

    const etMs = utcMs + offsetMs;
    const etDate = new Date(etMs);

    const hour = etDate.getUTCHours();
    const minute = etDate.getUTCMinutes();
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  } catch {
    return "TBD";
  }
}

/**
 * Maps NHL API game state string to our internal enum.
 * NHL states: FUT, PRE, LIVE, CRIT, FINAL, OFF
 */
function mapGameState(nhlState: string): "upcoming" | "live" | "final" {
  switch (nhlState?.toUpperCase()) {
    case "FUT":
    case "PRE":
      return "upcoming";
    case "LIVE":
    case "CRIT":
      return "live";
    case "FINAL":
    case "OFF":
      return "final";
    default:
      return "upcoming";
  }
}

/**
 * Extracts the game date in ET from the UTC start time and ET offset.
 * The game date is the date in ET when the game starts, not the UTC date.
 *
 * Example:
 *   startTimeUTC = "2026-03-13T00:00:00Z"
 *   easternUTCOffset = "-05:00"
 *   → 2026-03-12T19:00:00 ET → gameDateEst = "2026-03-12"
 */
function getGameDateEst(startTimeUTC: string, easternUTCOffset: string): string {
  try {
    const utcMs = new Date(startTimeUTC).getTime();
    if (isNaN(utcMs)) return startTimeUTC.slice(0, 10);

    const offsetMatch = easternUTCOffset.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!offsetMatch) return startTimeUTC.slice(0, 10);

    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const offsetHours = parseInt(offsetMatch[2], 10);
    const offsetMins = parseInt(offsetMatch[3], 10);
    const offsetMs = sign * (offsetHours * 60 + offsetMins) * 60 * 1000;

    const etMs = utcMs + offsetMs;
    const etDate = new Date(etMs);

    const year = etDate.getUTCFullYear();
    const month = String(etDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(etDate.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch {
    return startTimeUTC.slice(0, 10);
  }
}

// ─── Main Fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetches the NHL schedule for a specific date (or "now" for current week).
 * Results are cached for 1 hour.
 *
 * @param dateStr - "YYYY-MM-DD" or "now" (default)
 */
async function fetchNhlScheduleForDate(dateStr: string = "now"): Promise<NhlScheduleGame[]> {
  const cacheKey = dateStr;
  const now = Date.now();

  if (
    cachedSchedule &&
    cachedSchedule.dateKey === cacheKey &&
    now - cachedSchedule.fetchedAt < CACHE_TTL_MS
  ) {
    console.log(`[NHLSchedule] Using cached schedule for "${dateStr}" (${cachedSchedule.data.length} games)`);
    return cachedSchedule.data;
  }

  const url = `${NHL_SCHEDULE_BASE}/${dateStr}`;
  console.log(`[NHLSchedule] Fetching ${url} ...`);

  const resp = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),  // 12s hard timeout — prevents indefinite hang on slow NHL API
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
      Referer: "https://www.nhl.com/",
    },
  });

  if (!resp.ok) {
    throw new Error(`[NHLSchedule] API returned HTTP ${resp.status} for ${url}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await resp.json()) as any;
  const gameWeek: any[] = json?.gameWeek ?? [];

  const games: NhlScheduleGame[] = [];
  let totalRows = 0;
  let skipped = 0;

  for (const dateEntry of gameWeek) {
    const gamesOnDate: any[] = dateEntry.games ?? [];
    for (const g of gamesOnDate) {
      totalRows++;

      // Only include regular season (type 2) and playoff (type 3) games
      const gameType: number = g.gameType ?? 2;
      if (gameType === 1) {
        // Preseason — skip
        skipped++;
        continue;
      }

      const awayAbbrev: string = g.awayTeam?.abbrev ?? "";
      const homeAbbrev: string = g.homeTeam?.abbrev ?? "";

      const awayTeam = NHL_BY_ABBREV.get(awayAbbrev);
      const homeTeam = NHL_BY_ABBREV.get(homeAbbrev);

      if (!awayTeam || !homeTeam) {
        console.warn(
          `[NHLSchedule]   WARNING: Unknown team abbrev — away="${awayAbbrev}" home="${homeAbbrev}" — skipping game ${g.id}`
        );
        skipped++;
        continue;
      }

      const startTimeUTC: string = g.startTimeUTC ?? "";
      const easternUTCOffset: string = g.easternUTCOffset ?? "-05:00";
      const startTimeEst = utcToEt(startTimeUTC, easternUTCOffset);
      const gameDateEst = getGameDateEst(startTimeUTC, easternUTCOffset);
      const nhlState: string = g.gameState ?? "FUT";
      const gameState = mapGameState(nhlState);

      const awayScore: number | null =
        gameState !== "upcoming" ? (g.awayTeam?.score ?? null) : null;
      const homeScore: number | null =
        gameState !== "upcoming" ? (g.homeTeam?.score ?? null) : null;

      console.log(
        `[NHLSchedule]   ${awayAbbrev} (${awayTeam.dbSlug}) @ ${homeAbbrev} (${homeTeam.dbSlug}) ` +
        `| ${gameDateEst} ${startTimeEst} ET | state=${nhlState}→${gameState} ` +
        `| score=${awayScore ?? "?"}-${homeScore ?? "?"}`
      );

      games.push({
        gameId: g.id,
        awayDbSlug: awayTeam.dbSlug,
        homeDbSlug: homeTeam.dbSlug,
        awayAbbrev,
        homeAbbrev,
        startTimeEst,
        gameDateEst,
        gameState,
        awayScore,
        homeScore,
        gameType,
      });
    }
  }

  console.log(
    `[NHLSchedule] Parsed ${games.length} games from ${totalRows} rows ` +
    `(${skipped} skipped) for "${dateStr}"`
  );

  cachedSchedule = { data: games, fetchedAt: now, dateKey: cacheKey };
  return games;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches NHL games for a specific date in YYYY-MM-DD format.
 * Filters to only regular season and playoff games.
 */
// Dead export — no active callers in pipeline
async function fetchNhlGamesForDate(dateStr: string): Promise<NhlScheduleGame[]> {
  const all = await fetchNhlScheduleForDate(dateStr);
  return all.filter((g) => g.gameDateEst === dateStr && g.gameType >= 2);
}

/**
 * Fetches NHL games for a date range (inclusive).
 * Uses the "now" endpoint (7-day window) when the range falls within the current week.
 * Falls back to fetching each date individually otherwise.
 */
export async function fetchNhlGamesForRange(
  fromDate: string,
  toDate: string
): Promise<NhlScheduleGame[]> {
  const all = await fetchNhlScheduleForDate("now");
  const inRange = all.filter(
    (g) => g.gameDateEst >= fromDate && g.gameDateEst <= toDate && g.gameType >= 2
  );

  // If the range is outside the current 7-day window, fetch the specific date
  if (inRange.length === 0 && fromDate === toDate) {
    console.log(`[NHLSchedule] Date ${fromDate} not in current week — fetching directly`);
    const direct = await fetchNhlScheduleForDate(fromDate);
    return direct.filter((g) => g.gameDateEst >= fromDate && g.gameDateEst <= toDate);
  }

  return inRange;
}

/**
 * Builds a lookup map: "awayDbSlug@homeDbSlug" → startTimeEst
 * Used by the NHL refresh job to enrich VSiN scraped data with start times.
 */
export function buildNhlStartTimeMap(games: NhlScheduleGame[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of games) {
    const key = `${g.awayDbSlug}@${g.homeDbSlug}`;
    map.set(key, g.startTimeEst);
    console.log(`[NHLSchedule]   startTime map: ${key} → ${g.startTimeEst} ET`);
  }
  return map;
}

/**
 * Builds a lookup map: "awayDbSlug@homeDbSlug" → NhlScheduleGame
 * Used by the NHL refresh job to enrich VSiN scraped data with scores and state.
 */
export function buildNhlGameMap(games: NhlScheduleGame[]): Map<string, NhlScheduleGame> {
  const map = new Map<string, NhlScheduleGame>();
  for (const g of games) {
    map.set(`${g.awayDbSlug}@${g.homeDbSlug}`, g);
  }
  return map;
}

/**
 * Invalidates the cached schedule, forcing a fresh fetch on the next call.
 */
// Dead export — no active callers in pipeline
function invalidateNhlScheduleCache(): void {
  cachedSchedule = null;
  console.log("[NHLSchedule] Cache invalidated");
}

/**
 * Parses NHL clock/period data into a human-readable game clock string.
 *
 * Examples:
 *   period=1, inIntermission=false, timeRemaining="14:32" → "14:32 1P"
 *   period=2, inIntermission=true                          → "2ND INT"
 *   period=3, inIntermission=false, timeRemaining="00:00" → "END 3P"
 *   period=4, periodType="OT"                             → "OT"
 *   period=5, periodType="SO"                             → "SO"
 */
function parseNhlGameClock(
  period: number,
  timeRemaining: string | null,
  inIntermission: boolean,
  periodType: string
): string {
  // Shootout
  if (periodType === "SO") return "SO";

  // Overtime
  if (periodType === "OT" || period > 3) {
    if (inIntermission) return "OT INT";
    if (timeRemaining) {
      const isZero = /^0?0:00$/.test(timeRemaining);
      if (isZero) return "END OT";
      return `${timeRemaining} OT`;
    }
    return "OT";
  }

  // Regular periods (1, 2, 3)
  const periodLabel = `${period}P`;

  // Intermission between periods
  if (inIntermission) {
    // "1ST INT" = after period 1, "2ND INT" = after period 2
    const ordinals = ["1ST", "2ND", "3RD"];
    const ordinal = ordinals[period - 1] ?? `${period}TH`;
    return `${ordinal} INT`;
  }

  if (!timeRemaining) return periodLabel;

  const isZero = /^0?0:00$/.test(timeRemaining);
  if (isZero) return `END ${periodLabel}`;

  return `${timeRemaining} ${periodLabel}`;
}

/**
 * Fetches today's NHL live scores from the /v1/scoreboard/now endpoint.
 * This endpoint provides period, clock, and intermission data for live games.
 * Returns all games for today with current scores, state, and game clock.
 */
export async function fetchNhlLiveScores(): Promise<NhlLiveGame[]> {
  const startTime = Date.now();
  console.log("[NHLSchedule] Fetching live scores from scoreboard/now...");

  const url = "https://api-web.nhle.com/v1/scoreboard/now";
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(10_000),  // 10s hard timeout
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
      Referer: "https://www.nhl.com/",
    },
  });
  if (!resp.ok) {
    throw new Error(`[NHLSchedule] scoreboard/now returned HTTP ${resp.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await resp.json()) as any;

  // Get today's date in ET
  const todayEt = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2"); // MM/DD/YYYY → YYYY-MM-DD

  const result: NhlLiveGame[] = [];

  for (const dateEntry of json?.gamesByDate ?? []) {
    const dateStr: string = dateEntry.date ?? "";
    if (dateStr !== todayEt) continue;

    for (const g of dateEntry.games ?? []) {
      const awayAbbrev: string = g.awayTeam?.abbrev ?? "";
      const homeAbbrev: string = g.homeTeam?.abbrev ?? "";

      const awayTeam = NHL_BY_ABBREV.get(awayAbbrev);
      const homeTeam = NHL_BY_ABBREV.get(homeAbbrev);
      if (!awayTeam || !homeTeam) continue;

      const nhlState: string = g.gameState ?? "FUT";
      const gameState = mapGameState(nhlState);

      const awayScore: number | null =
        gameState !== "upcoming" ? (g.awayTeam?.score ?? null) : null;
      const homeScore: number | null =
        gameState !== "upcoming" ? (g.homeTeam?.score ?? null) : null;

      let gameClock: string | null = null;
      if (gameState === "final") {
        // Show period info for OT/SO finals
        const period: number = g.period ?? 3;
        const periodType: string = g.periodDescriptor?.periodType ?? "REG";
        if (periodType === "SO") {
          gameClock = "Final/SO";
        } else if (periodType === "OT" || period > 3) {
          gameClock = "Final/OT";
        } else {
          gameClock = "Final";
        }
      } else if (gameState === "live") {
        const period: number = g.period ?? 1;
        const clock = g.clock ?? {};
        const timeRemaining: string | null = clock.timeRemaining ?? null;
        const inIntermission: boolean = clock.inIntermission === true;
        const periodType: string = g.periodDescriptor?.periodType ?? "REG";
        gameClock = parseNhlGameClock(period, timeRemaining, inIntermission, periodType);
      }

      result.push({
        awayDbSlug: awayTeam.dbSlug,
        homeDbSlug: homeTeam.dbSlug,
        awayScore,
        homeScore,
        gameState,
        gameClock,
      });
    }
  }

  console.log(
    `[NHLSchedule] Live scores: ${result.length} games today (${result.filter((g) => g.gameState === "live").length} live, ` +
    `${result.filter((g) => g.gameState === "final").length} final) in ${Date.now() - startTime}ms`
  );

  return result;
}
