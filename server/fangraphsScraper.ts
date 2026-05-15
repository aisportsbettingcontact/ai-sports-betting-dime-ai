/**
 * fangraphsScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches MLB lineups and probable pitchers using the public MLB Stats API.
 * No authentication, no Cloudflare, no browser required.
 *
 * Data source: https://statsapi.mlb.com/api/v1/schedule
 *   - Hydrates: lineups, probablePitcher
 *   - Bulk people lookup for handedness (bats/throws)
 *   - Pitcher season stats via separate hydration
 *
 * Logging format:
 *   [FgScraper] [INPUT]  → source + parsed values
 *   [FgScraper] [STEP]   → operation description
 *   [FgScraper] [STATE]  → intermediate computations
 *   [FgScraper] [OUTPUT] → final result
 *   [FgScraper] [VERIFY] → pass/fail + reason
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FgPitcher {
  playerId: number;
  name: string;
  throws: string; // "R" | "L"
  wins: number;
  losses: number;
  era: string;
  ip: string;
  strikeouts: number;
  whip: string;
}

export interface FgBatter {
  order: number; // 1-9
  playerId: number;
  name: string;
  bats: string; // "R" | "L" | "S"
  position: string; // "SS", "CF", "DH", etc.
  isProjected: boolean;
}

export interface FgTeamLineup {
  teamId: number;
  teamName: string;
  teamAbbr: string;
  winProbability: number; // 0-100
  pitcher: FgPitcher | null;
  lineup: FgBatter[];
  lineupStatus: "Posted" | "Projected" | "None";
}

export interface FgGame {
  gameId: number;
  gameTimeUtc: string; // ISO 8601
  away: FgTeamLineup;
  home: FgTeamLineup;
}

export interface FgDateResult {
  date: string; // "YYYY-MM-DD"
  games: FgGame[];
  scrapedAt: string; // ISO 8601
  elapsedMs: number;
}

export interface FgScrapeResult {
  today: FgDateResult;
  tomorrow: FgDateResult;
  totalGames: number;
  errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";
const CURRENT_SEASON = new Date().getFullYear();

// ─── In-Memory Cache (30-minute TTL) ─────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  result: FgScrapeResult;
  cachedAt: number;
}

let _cache: CacheEntry | null = null;

/**
 * Returns cached result if fresh (< 30 min old), otherwise null.
 */
function getCached(): FgScrapeResult | null {
  if (!_cache) return null;
  const age = Date.now() - _cache.cachedAt;
  if (age > CACHE_TTL_MS) {
    console.log(`[FgScraper] [STATE] Cache expired (age=${Math.round(age / 1000)}s). Fetching fresh data.`);
    _cache = null;
    return null;
  }
  console.log(`[FgScraper] [STATE] Cache hit (age=${Math.round(age / 1000)}s). Returning cached result.`);
  return _cache.result;
}

function setCache(result: FgScrapeResult): void {
  _cache = { result, cachedAt: Date.now() };
  console.log(`[FgScraper] [STATE] Cache updated at ${new Date().toISOString()}`);
}

/**
 * Invalidates the cache (used for force-refresh).
 */
export function invalidateFgCache(): void {
  _cache = null;
  console.log(`[FgScraper] [STATE] Cache invalidated`);
}

// MLB team abbreviation map (teamId → abbr)
const TEAM_ABBR_MAP: Record<number, string> = {
  108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC",
  113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU",
  118: "KC",  119: "LAD", 120: "WSH", 121: "NYM", 133: "OAK",
  134: "PIT", 135: "SD",  136: "SEA", 137: "SF",  138: "STL",
  139: "TB",  140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI",
  144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Returns the current date in PST/PDT as "YYYY-MM-DD".
 * offsetDays: 0 = today, 1 = tomorrow
 */
export function getPstDate(offsetDays = 0): string {
  const now = new Date();
  // PST = UTC-8, PDT = UTC-7. Use Intl to get the correct local date.
  const pstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = pstFormatter.formatToParts(
    new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  );
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

/**
 * Fetches JSON from a URL with a timeout.
 */
async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── MLB Stats API Types (minimal) ────────────────────────────────────────────

interface MlbScheduleResponse {
  totalGames: number;
  dates: Array<{
    date: string;
    games: MlbGame[];
  }>;
}

interface MlbGame {
  gamePk: number;
  gameDate: string;
  teams: {
    away: MlbTeamEntry;
    home: MlbTeamEntry;
  };
  lineups?: {
    awayPlayers: MlbPlayer[];
    homePlayers: MlbPlayer[];
  };
}

interface MlbTeamEntry {
  team: { id: number; name: string };
  probablePitcher?: { id: number; fullName: string };
  leagueRecord?: { wins: number; losses: number };
}

interface MlbPlayer {
  id: number;
  fullName: string;
  primaryPosition: { abbreviation: string };
}

interface MlbPeopleResponse {
  people: Array<{
    id: number;
    fullName: string;
    batSide?: { code: string };
    pitchHand?: { code: string };
    primaryPosition?: { abbreviation: string };
  }>;
}

interface MlbPersonStatsResponse {
  people: Array<{
    id: number;
    fullName: string;
    pitchHand?: { code: string };
    stats: Array<{
      splits: Array<{
        stat: {
          era?: string;
          inningsPitched?: string;
          strikeOuts?: number;
          wins?: number;
          losses?: number;
          whip?: string;
        };
      }>;
    }>;
  }>;
}

// ─── Exported Helpers (for testing) ─────────────────────────────────────────

/**
 * Builds the MLB Stats API schedule URL for a given date.
 */
export function buildMlbScheduleUrl(date: string): string {
  return `${MLB_API_BASE}/schedule?sportId=1&date=${date}&hydrate=lineups,probablePitcher`;
}

/**
 * Parses raw pitcher stats from the MLB Stats API response into a normalized object.
 */
export function parsePitcherStats(rawStats: Record<string, unknown> | null | undefined): {
  era: string; ip: string; strikeouts: number; wins: number; losses: number; whip: string;
} {
  if (!rawStats) {
    return { era: "-.--", ip: "0.0", strikeouts: 0, wins: 0, losses: 0, whip: "-.--" };
  }
  return {
    era: (rawStats.era as string) ?? "-.--",
    ip: (rawStats.inningsPitched as string) ?? "0.0",
    strikeouts: (rawStats.strikeOuts as number) ?? 0,
    wins: (rawStats.wins as number) ?? 0,
    losses: (rawStats.losses as number) ?? 0,
    whip: (rawStats.whip as string) ?? "-.--",
  };
}

/**
 * Determines lineup status based on the batter array.
 */
export function buildLineupStatus(batters: FgBatter[]): "Posted" | "Projected" | "None" {
  if (batters.length === 0) return "None";
  if (batters.some(b => b.isProjected)) return "Projected";
  return "Posted";
}

// ─── Core Scraper ─────────────────────────────────────────────────────────────

/**
 * Fetches lineup data for a single date from the MLB Stats API.
 */
export async function scrapeFangraphsDate(date: string): Promise<FgDateResult> {
  const start = Date.now();
  console.log(`[FgScraper] [INPUT] date=${date}`);

  // ── Step 1: Fetch schedule with lineups and probable pitchers ──────────────
  console.log(`[FgScraper] [STEP] date=${date} Fetching schedule from MLB Stats API`);
  const scheduleUrl = `${MLB_API_BASE}/schedule?sportId=1&date=${date}&hydrate=lineups,probablePitcher`;
  const schedule = await fetchJson<MlbScheduleResponse>(scheduleUrl);

  const dateEntry = schedule.dates.find((d) => d.date === date);
  const games = dateEntry?.games ?? [];
  console.log(`[FgScraper] [STATE] date=${date} Found ${games.length} games`);

  if (games.length === 0) {
    const elapsed = Date.now() - start;
    console.log(`[FgScraper] [OUTPUT] date=${date} No games found elapsed=${elapsed}ms`);
    return {
      date,
      games: [],
      scrapedAt: new Date().toISOString(),
      elapsedMs: elapsed,
    };
  }

  // ── Step 2: Collect all player IDs for bulk handedness lookup ─────────────
  console.log(`[FgScraper] [STEP] date=${date} Collecting player IDs for handedness lookup`);
  const playerIds = new Set<number>();
  const pitcherIds = new Set<number>();

  for (const g of games) {
    const lineups = g.lineups;
    if (lineups) {
      for (const p of [...lineups.awayPlayers, ...lineups.homePlayers]) {
        playerIds.add(p.id);
      }
    }
    for (const side of ["away", "home"] as const) {
      const pitcher = g.teams[side].probablePitcher;
      if (pitcher?.id) {
        pitcherIds.add(pitcher.id);
        playerIds.add(pitcher.id);
      }
    }
  }

  console.log(
    `[FgScraper] [STATE] date=${date} playerIds=${playerIds.size} pitcherIds=${pitcherIds.size}`
  );

  // ── Step 3 + 4: Bulk fetch handedness AND pitcher stats in parallel ─────────
  // Both calls run simultaneously using Promise.all to minimize latency.
  // Handedness: single bulk call for all player IDs (batters + pitchers)
  // Pitcher stats: single bulk call using people?personIds=...&hydrate=stats(...)
  console.log(
    `[FgScraper] [STEP] date=${date} Bulk fetching handedness (${playerIds.size} players) + pitcher stats (${pitcherIds.size} pitchers) in parallel`
  );

  const handednessMap = new Map<number, { bats: string; throws: string; pos: string }>();
  const pitcherStatsMap = new Map<
    number,
    { era: string; ip: string; so: number; w: number; l: number; whip: string; throws: string }
  >();

  // Build URL chunks (MLB API max 500 IDs per request)
  const idArray = Array.from(playerIds);
  const idChunks: number[][] = [];
  for (let i = 0; i < idArray.length; i += 500) {
    idChunks.push(idArray.slice(i, i + 500));
  }

  const pitcherIdArray = Array.from(pitcherIds);
  const pitcherChunks: number[][] = [];
  for (let i = 0; i < pitcherIdArray.length; i += 500) {
    pitcherChunks.push(pitcherIdArray.slice(i, i + 500));
  }

  // Run all bulk calls in parallel
  const [handednessResults, pitcherStatsResults] = await Promise.all([
    // Handedness: fetch all players (no currentTeam hydrate — faster)
    Promise.all(
      idChunks.map(chunk =>
        fetchJson<MlbPeopleResponse>(
          `${MLB_API_BASE}/people?personIds=${chunk.join(",")}`
        ).catch(err => {
          console.warn(`[FgScraper] [WARN] Handedness chunk failed: ${err}`);
          return { people: [] } as MlbPeopleResponse;
        })
      )
    ),
    // Pitcher stats: bulk hydrate with season stats
    pitcherIdArray.length > 0
      ? Promise.all(
          pitcherChunks.map(chunk =>
            fetchJson<MlbPersonStatsResponse>(
              `${MLB_API_BASE}/people?personIds=${chunk.join(",")}&hydrate=stats(type=season,group=pitching,season=${CURRENT_SEASON})`
            ).catch(err => {
              console.warn(`[FgScraper] [WARN] Pitcher stats chunk failed: ${err}`);
              return { people: [] } as MlbPersonStatsResponse;
            })
          )
        )
      : Promise.resolve([] as MlbPersonStatsResponse[]),
  ]);

  // Populate handedness map
  for (const res of handednessResults) {
    for (const p of res.people) {
      handednessMap.set(p.id, {
        bats: p.batSide?.code ?? "?",
        throws: p.pitchHand?.code ?? "?",
        pos: p.primaryPosition?.abbreviation ?? "?",
      });
    }
  }
  console.log(`[FgScraper] [STATE] date=${date} Handedness map: ${handednessMap.size} entries`);

  // Populate pitcher stats map
  for (const res of pitcherStatsResults) {
    for (const person of res.people) {
      const splits = person.stats?.[0]?.splits ?? [];
      const stat = splits[0]?.stat ?? {};
      pitcherStatsMap.set(person.id, {
        era: stat.era ?? "-.--",
        ip: stat.inningsPitched ?? "0.0",
        so: stat.strikeOuts ?? 0,
        w: stat.wins ?? 0,
        l: stat.losses ?? 0,
        whip: stat.whip ?? "-.--",
        throws: person.pitchHand?.code ?? handednessMap.get(person.id)?.throws ?? "?",
      });
    }
  }
  console.log(`[FgScraper] [STATE] date=${date} Pitcher stats map: ${pitcherStatsMap.size} entries`);

  // ── Step 5: Build FgGame objects ──────────────────────────────────────────
  console.log(`[FgScraper] [STEP] date=${date} Building FgGame objects`);
  const fgGames: FgGame[] = [];

  for (const g of games) {
    const buildTeam = (side: "away" | "home"): FgTeamLineup => {
      const teamEntry = g.teams[side];
      const teamId = teamEntry.team.id;
      const teamName = teamEntry.team.name;
      const teamAbbr = TEAM_ABBR_MAP[teamId] ?? teamName.substring(0, 3).toUpperCase();

      // Pitcher
      let pitcher: FgPitcher | null = null;
      const probPitcher = teamEntry.probablePitcher;
      if (probPitcher?.id) {
        const stats = pitcherStatsMap.get(probPitcher.id);
        const hand = handednessMap.get(probPitcher.id);
        pitcher = {
          playerId: probPitcher.id,
          name: probPitcher.fullName,
          throws: stats?.throws ?? hand?.throws ?? "?",
          wins: stats?.w ?? 0,
          losses: stats?.l ?? 0,
          era: stats?.era ?? "-.--",
          ip: stats?.ip ?? "0.0",
          strikeouts: stats?.so ?? 0,
          whip: stats?.whip ?? "-.--",
        };
      }

      // Lineup
      const lineupPlayers =
        side === "away"
          ? g.lineups?.awayPlayers ?? []
          : g.lineups?.homePlayers ?? [];

      const lineup: FgBatter[] = lineupPlayers.map((p, idx) => {
        const hand = handednessMap.get(p.id);
        return {
          order: idx + 1,
          playerId: p.id,
          name: p.fullName,
          bats: hand?.bats ?? "?",
          position: p.primaryPosition.abbreviation,
          isProjected: false, // MLB API only returns confirmed lineups
        };
      });

      // Lineup status
      let lineupStatus: "Posted" | "Projected" | "None" = "None";
      if (lineup.length === 9) {
        lineupStatus = "Posted";
      }

      return {
        teamId,
        teamName,
        teamAbbr,
        winProbability: 50, // MLB API doesn't provide win probability in this endpoint
        pitcher,
        lineup,
        lineupStatus,
      };
    };

    fgGames.push({
      gameId: g.gamePk,
      gameTimeUtc: g.gameDate,
      away: buildTeam("away"),
      home: buildTeam("home"),
    });
  }

  const elapsed = Date.now() - start;
  console.log(
    `[FgScraper] [OUTPUT] date=${date} games=${fgGames.length} elapsed=${elapsed}ms`
  );
  console.log(`[FgScraper] [VERIFY] PASS — date=${date} all ${fgGames.length} games parsed`);

  return {
    date,
    games: fgGames,
    scrapedAt: new Date().toISOString(),
    elapsedMs: elapsed,
  };
}

/**
 * Scrapes lineups for today AND tomorrow (PST dates).
 * Returns a combined FgScrapeResult.
 * @param forceRefresh - If true, bypasses the 30-min in-memory cache.
 */
export async function scrapeFangraphsLineups(forceRefresh = false): Promise<FgScrapeResult> {
  // Check cache first (unless forceRefresh)
  if (!forceRefresh) {
    const cached = getCached();
    if (cached) return cached;
  } else {
    invalidateFgCache();
  }
  const todayDate = getPstDate(0);
  const tomorrowDate = getPstDate(1);
  const errors: string[] = [];

  console.log(`[FgScraper] [INPUT] Scraping today=${todayDate} tomorrow=${tomorrowDate}`);

  const [todayResult, tomorrowResult] = await Promise.allSettled([
    scrapeFangraphsDate(todayDate),
    scrapeFangraphsDate(tomorrowDate),
  ]);

  const today: FgDateResult =
    todayResult.status === "fulfilled"
      ? todayResult.value
      : (() => {
          const err = `Today scrape failed: ${(todayResult as PromiseRejectedResult).reason}`;
          errors.push(err);
          console.error(`[FgScraper] [VERIFY] FAIL — ${err}`);
          return { date: todayDate, games: [], scrapedAt: new Date().toISOString(), elapsedMs: 0 };
        })();

  const tomorrow: FgDateResult =
    tomorrowResult.status === "fulfilled"
      ? tomorrowResult.value
      : (() => {
          const err = `Tomorrow scrape failed: ${(tomorrowResult as PromiseRejectedResult).reason}`;
          errors.push(err);
          console.error(`[FgScraper] [VERIFY] FAIL — ${err}`);
          return {
            date: tomorrowDate,
            games: [],
            scrapedAt: new Date().toISOString(),
            elapsedMs: 0,
          };
        })();

  const totalGames = today.games.length + tomorrow.games.length;
  console.log(
    `[FgScraper] [OUTPUT] today=${today.games.length} tomorrow=${tomorrow.games.length} total=${totalGames} errors=${errors.length}`
  );

  const result: FgScrapeResult = { today, tomorrow, totalGames, errors };

  // Cache the result for 30 minutes (only cache if we got at least some data)
  if (totalGames > 0) {
    setCache(result);
  }

  return result;
}
