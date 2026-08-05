/**
 * NBA Schedule API scraper
 * Fetches game start times (in ET) from the NBA.com CDN schedule JSON.
 * No authentication required — public endpoint.
 *
 * Data source: https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json
 *
 * Team resolution: NBA.com teamSlug values (e.g. "celtics") are looked up
 * directly in the 30-team registry (NBA_BY_NBA_SLUG). If a slug is not in the
 * registry, the game is filtered out downstream by NBA_VALID_DB_SLUGS.
 *
 * Time format: gameTimeEst is "1900-01-01T{HH}:{MM}:00Z" where HH:MM is the
 * actual ET start time (the 1900-01-01 date is a placeholder).
 */

import {
  NBA_BY_NBA_SLUG,
  NBA_BY_TEAM_ID,
  getNbaTeamByNbaSlug,
} from "../shared/nbaTeams";

const NBA_SCHEDULE_URL =
  "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json";

export interface NbaGame {
  /** NBA game ID, e.g. "0022500915" */
  gameId: string;
  /** DB-style slug for away team, e.g. "boston_celtics" */
  awayDbSlug: string;
  /** DB-style slug for home team, e.g. "new_york_knicks" */
  homeDbSlug: string;
  /**
   * Start time in ET as "HH:MM" (24-hour), e.g. "19:30".
   * "TBD" when no confirmed start time.
   */
  startTimeEst: string;
  /** Game date in YYYY-MM-DD (Eastern Time) */
  gameDateEst: string;
  /** Game status: 1=scheduled, 2=in-progress, 3=final */
  gameStatus: number;
  /** Whether the game is postponed */
  isPostponed: boolean;
}

/** Cached schedule data to avoid re-fetching on every call */
let cachedSchedule: { data: NbaGame[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

/**
 * Parse the gameTimeEst field from the NBA schedule API.
 * Format: "1900-01-01T{HH}:{MM}:00Z" → "HH:MM"
 * Returns "TBD" if the time cannot be parsed.
 */
function parseGameTimeEst(gameTimeEst: string): string {
  if (!gameTimeEst) return "TBD";
  // Match "1900-01-01T19:00:00Z" → extract "19:00"
  const match = gameTimeEst.match(/T(\d{2}):(\d{2}):/);
  if (!match) return "TBD";
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  // The NBA API stores ET times as-is in this field
  // A time of 00:00 could be midnight ET (late West Coast game)
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Fetches and parses the full NBA season schedule from NBA.com CDN.
 * Results are cached for 1 hour to avoid excessive requests.
 */
async function fetchNbaSchedule(): Promise<NbaGame[]> {
  const now = Date.now();
  if (cachedSchedule && now - cachedSchedule.fetchedAt < CACHE_TTL_MS) {
    return cachedSchedule.data;
  }

  const resp = await fetch(NBA_SCHEDULE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
      Referer: "https://www.nba.com/",
    },
  });

  if (!resp.ok) {
    throw new Error(`NBA schedule API returned HTTP ${resp.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await resp.json()) as any;
  const gameDates: any[] = json?.leagueSchedule?.gameDates ?? [];

  const games: NbaGame[] = [];

  for (const dateEntry of gameDates) {
    const gamesOnDate: any[] = dateEntry.games ?? [];
    for (const g of gamesOnDate) {
      const awaySlug: string = g.awayTeam?.teamSlug ?? "";
      const homeSlug: string = g.homeTeam?.teamSlug ?? "";

      // Resolve to DB slugs via registry (with alias resolution for NBA.com slug variants)
      const awayTeam = getNbaTeamByNbaSlug(awaySlug);
      const homeTeam = getNbaTeamByNbaSlug(homeSlug);

      // Skip if either team is not in the 30-team registry
      if (!awayTeam || !homeTeam) continue;

      // gameDateEst: "2026-03-07T00:00:00Z" → "2026-03-07"
      const gameDateEst = (g.gameDateEst ?? "").slice(0, 10);
      if (!gameDateEst) continue;

      const startTimeEst = parseGameTimeEst(g.gameTimeEst ?? "");
      const gameStatus: number = g.gameStatus ?? 1;
      const isPostponed: boolean = g.postponedStatus === "P";

      games.push({
        gameId: String(g.gameId ?? ""),
        awayDbSlug: awayTeam.dbSlug,
        homeDbSlug: homeTeam.dbSlug,
        startTimeEst,
        gameDateEst,
        gameStatus,
        isPostponed,
      });
    }
  }

  cachedSchedule = { data: games, fetchedAt: now };
  console.log(
    `[NBAScoreboard] Fetched ${games.length} NBA games from schedule API`
  );
  return games;
}

/**
 * Returns all NBA games for a given date (YYYY-MM-DD in ET).
 * Excludes postponed games and pre-season/all-star games (gameId prefix "001" or "004").
 */
export async function fetchNbaGamesForDate(
  dateEst: string
): Promise<NbaGame[]> {
  const all = await fetchNbaSchedule();
  return all.filter(g => {
    if (g.gameDateEst !== dateEst) return false;
    if (g.isPostponed) return false;
    // Filter out pre-season (001), all-star (004), and other non-regular/playoff games
    // Regular season: "002xxxxx", Playoffs: "004xxxxx"
    const prefix = g.gameId.slice(0, 3);
    if (prefix === "001") return false; // pre-season
    return true;
  });
}

/**
 * Returns NBA games for a date range [fromDate, toDate] inclusive (YYYY-MM-DD).
 */
// Dead export — no active callers in pipeline
async function fetchNbaGamesForRange(
  fromDate: string,
  toDate: string
): Promise<NbaGame[]> {
  const all = await fetchNbaSchedule();
  return all.filter(g => {
    if (g.gameDateEst < fromDate || g.gameDateEst > toDate) return false;
    if (g.isPostponed) return false;
    const prefix = g.gameId.slice(0, 3);
    if (prefix === "001") return false;
    return true;
  });
}

/**
 * Builds a map of "awayDbSlug@homeDbSlug" → startTimeEst for a list of games.
 */
export function buildNbaStartTimeMap(games: NbaGame[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of games) {
    map.set(`${g.awayDbSlug}@${g.homeDbSlug}`, g.startTimeEst);
  }
  return map;
}

/**
 * Invalidates the cached schedule, forcing a fresh fetch on the next call.
 * Call this after a manual refresh or when stale data is suspected.
 */
// Dead export — no active callers in pipeline
function invalidateNbaScheduleCache(): void {
  cachedSchedule = null;
}

// ─── Live Scoreboard ─────────────────────────────────────────────────────────

const NBA_LIVE_SCOREBOARD_URL =
  "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";

export interface NbaLiveGame {
  /** DB slug for away team */
  awayDbSlug: string;
  /** DB slug for home team */
  homeDbSlug: string;
  /** Away team score (null if not started) */
  awayScore: number | null;
  /** Home team score (null if not started) */
  homeScore: number | null;
  /**
   * Game status mapped to our DB enum:
   * 1 (scheduled) → 'upcoming', 2 (in-progress) → 'live', 3 (final) → 'final'
   */
  gameStatus: "upcoming" | "live" | "final";
  /**
   * Human-readable game clock string, e.g. "15:07 1st", "Half", "OT", "Final".
   * Null for upcoming games.
   */
  gameClock: string | null;
}

/**
 * Parses the NBA gameClock ISO duration (e.g. "PT12M34.00S") and period number
 * into a human-readable string like "12:34 1st", "Half", "OT".
 */
function parseNbaGameClock(
  gameClock: string,
  period: number,
  gameStatusText: string
): string | null {
  // Halftime
  if (gameStatusText?.toLowerCase().includes("half")) return "Half";
  // Overtime
  if (period > 4) {
    const otNum = period - 4;
    const match = gameClock?.match(/PT(\d+)M([\d.]+)S/);
    if (match) {
      const mins = match[1].padStart(2, "0");
      const secs = Math.floor(parseFloat(match[2])).toString().padStart(2, "0");
      return `${mins}:${secs} OT${otNum > 1 ? otNum : ""}`;
    }
    return `OT${otNum > 1 ? otNum : ""}`;
  }
  // Regular period
  const periodNames = ["1st", "2nd", "3rd", "4th"];
  const periodLabel = periodNames[period - 1] ?? `P${period}`;
  if (!gameClock) return periodLabel;
  const match = gameClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return periodLabel;
  const mins = match[1].padStart(2, "0");
  const secs = Math.floor(parseFloat(match[2])).toString().padStart(2, "0");
  return `${mins}:${secs} ${periodLabel}`;
}

/**
 * Fetches today's NBA live scoreboard from NBA.com CDN.
 * Returns live/final scores and status for all games today.
 * This endpoint updates in near-real-time during games.
 */
export async function fetchNbaLiveScores(): Promise<NbaLiveGame[]> {
  const resp = await fetch(NBA_LIVE_SCOREBOARD_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
      Referer: "https://www.nba.com/",
    },
  });

  if (!resp.ok) {
    throw new Error(`NBA live scoreboard API returned HTTP ${resp.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await resp.json()) as any;
  const games: any[] = json?.scoreboard?.games ?? [];

  const result: NbaLiveGame[] = [];

  for (const g of games) {
    const awayTeamId: number = g.awayTeam?.teamId;
    const homeTeamId: number = g.homeTeam?.teamId;

    const awayTeam = NBA_BY_TEAM_ID.get(awayTeamId);
    const homeTeam = NBA_BY_TEAM_ID.get(homeTeamId);

    // Skip if either team is not in our registry
    if (!awayTeam || !homeTeam) continue;

    const rawStatus: number = g.gameStatus ?? 1;
    const gameStatus: "upcoming" | "live" | "final" =
      rawStatus === 3 ? "final" : rawStatus === 2 ? "live" : "upcoming";

    const awayScore: number | null =
      rawStatus > 1 ? (g.awayTeam?.score ?? null) : null;
    const homeScore: number | null =
      rawStatus > 1 ? (g.homeTeam?.score ?? null) : null;

    let gameClock: string | null = null;
    if (rawStatus === 2) {
      gameClock = parseNbaGameClock(
        g.gameClock ?? "",
        g.period ?? 0,
        g.gameStatusText ?? ""
      );
    } else if (rawStatus === 3) {
      gameClock = "Final";
    }

    result.push({
      awayDbSlug: awayTeam.dbSlug,
      homeDbSlug: homeTeam.dbSlug,
      awayScore,
      homeScore,
      gameStatus,
      gameClock,
    });
  }

  console.log(
    `[NBAScoreboard] Live scoreboard: ${result.length} games (${result.filter(g => g.gameStatus === "live").length} live, ${result.filter(g => g.gameStatus === "final").length} final)`
  );
  return result;
}
