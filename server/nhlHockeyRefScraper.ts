/**
 * nhlHockeyRefScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes the Hockey Reference 2025-26 NHL season schedule to compute
 * real rest days for each team heading into a given game date.
 *
 * Source: https://www.hockey-reference.com/leagues/NHL_2026_games.html
 *
 * The schedule table has columns:
 *   Date | Time | Visitor | G | Home | G | OT | Att. | LOG | Notes
 *
 * We parse every completed and scheduled game row to build a map of
 *   teamName → sorted list of game dates (YYYY-MM-DD)
 *
 * Then for any game on a target date, we find the most recent prior game
 * date for each team and compute daysRest = targetDate - lastGameDate.
 *
 * Caching: schedule is cached for 6 hours to avoid hammering HR.
 *
 * Team name → dbSlug mapping uses the NHL_TEAMS registry (name field).
 */

import * as cheerio from "cheerio";
import { NHL_TEAMS } from "../shared/nhlTeams.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NhlRestDays {
  awayRestDays: number;
  homeRestDays: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HR_SCHEDULE_URL =
  "https://www.hockey-reference.com/leagues/NHL_2026_games.html";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const HR_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: "https://www.hockey-reference.com/",
};

// ─── Team name → dbSlug lookup ────────────────────────────────────────────────

/**
 * Build a map from Hockey Reference full team name → dbSlug.
 * HR uses the same full names as our NHL_TEAMS registry (e.g. "Boston Bruins").
 * Special case: Utah Mammoth (new team 2025-26) — HR uses "Utah Mammoth".
 */
const HR_NAME_TO_DB_SLUG = new Map<string, string>(
  NHL_TEAMS.map(t => [t.name, t.dbSlug])
);

// Also map by city+nickname variants in case HR uses slightly different names
for (const t of NHL_TEAMS) {
  // e.g. "Vegas Golden Knights" → "vegas_golden_knights"
  HR_NAME_TO_DB_SLUG.set(t.name, t.dbSlug);
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface ScheduleCache {
  /** Map: dbSlug → sorted array of game dates (YYYY-MM-DD) */
  gameDatesByTeam: Map<string, string[]>;
  fetchedAt: number;
}

let scheduleCache: ScheduleCache | null = null;

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse the Hockey Reference schedule HTML and return a map of
 * dbSlug → sorted game dates.
 */
function parseScheduleHtml(html: string): Map<string, string[]> {
  const $ = cheerio.load(html);
  const gameDatesByTeam = new Map<string, string[]>();

  // The schedule table has id="games"
  const rows = $("#games tbody tr").toArray();

  for (const row of rows) {
    const $row = $(row);

    // Skip header rows (they have class "thead")
    if ($row.hasClass("thead")) continue;

    // Date cell: <th data-stat="date_game"> with a link or text
    const dateCell = $row.find('[data-stat="date_game"]');
    const dateText = dateCell.find("a").text().trim() || dateCell.text().trim();
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) continue;

    // Visitor team name
    const visitorCell = $row.find('[data-stat="visitor_team_name"]');
    const visitorName =
      visitorCell.find("a").text().trim() || visitorCell.text().trim();

    // Home team name
    const homeCell = $row.find('[data-stat="home_team_name"]');
    const homeName = homeCell.find("a").text().trim() || homeCell.text().trim();

    if (!visitorName || !homeName) continue;

    const visitorSlug = HR_NAME_TO_DB_SLUG.get(visitorName);
    const homeSlug = HR_NAME_TO_DB_SLUG.get(homeName);

    if (visitorSlug) {
      const dates = gameDatesByTeam.get(visitorSlug) ?? [];
      dates.push(dateText);
      gameDatesByTeam.set(visitorSlug, dates);
    } else {
      console.warn(`[HockeyRef] Unknown visitor team name: "${visitorName}"`);
    }

    if (homeSlug) {
      const dates = gameDatesByTeam.get(homeSlug) ?? [];
      dates.push(dateText);
      gameDatesByTeam.set(homeSlug, dates);
    } else {
      console.warn(`[HockeyRef] Unknown home team name: "${homeName}"`);
    }
  }

  // Sort each team's dates ascending
  Array.from(gameDatesByTeam.entries()).forEach(([slug, dates]) => {
    gameDatesByTeam.set(slug, Array.from(new Set(dates)).sort());
  });

  const teamCount = gameDatesByTeam.size;
  const totalGames = Array.from(gameDatesByTeam.values()).reduce(
    (s, d) => s + d.length,
    0
  );
  console.log(
    `[HockeyRef] Parsed schedule: ${teamCount} teams, ${totalGames} team-game entries`
  );

  return gameDatesByTeam;
}

// ─── Fetch + cache ────────────────────────────────────────────────────────────

async function fetchSchedule(): Promise<Map<string, string[]>> {
  const now = Date.now();

  if (scheduleCache && now - scheduleCache.fetchedAt < CACHE_TTL_MS) {
    console.log("[HockeyRef] Using cached schedule");
    return scheduleCache.gameDatesByTeam;
  }

  console.log("[HockeyRef] Fetching schedule from Hockey Reference...");

  const resp = await fetch(HR_SCHEDULE_URL, { headers: HR_HEADERS });
  if (!resp.ok) {
    throw new Error(`[HockeyRef] HTTP ${resp.status} fetching schedule`);
  }

  const html = await resp.text();
  const gameDatesByTeam = parseScheduleHtml(html);

  scheduleCache = { gameDatesByTeam, fetchedAt: now };
  console.log("[HockeyRef] Schedule cached successfully");

  return gameDatesByTeam;
}

// ─── Rest days computation ────────────────────────────────────────────────────

/**
 * Compute rest days for both teams in a game on a given date.
 *
 * Rest days = number of days between the team's last game and the target date.
 * - 0 = back-to-back (played yesterday)
 * - 1 = one day rest (played 2 days ago)
 * - 2 = two days rest (standard)
 * - 3+ = extended rest
 *
 * If no prior game is found (start of season), defaults to 3 (fresh legs).
 *
 * @param awayDbSlug  Away team dbSlug (e.g. "boston_bruins")
 * @param homeDbSlug  Home team dbSlug (e.g. "toronto_maple_leafs")
 * @param gameDate    Game date in YYYY-MM-DD format
 */
export async function computeNhlRestDays(
  awayDbSlug: string,
  homeDbSlug: string,
  gameDate: string
): Promise<NhlRestDays> {
  try {
    const gameDatesByTeam = await fetchSchedule();

    const getRestDays = (dbSlug: string): number => {
      const dates = gameDatesByTeam.get(dbSlug) ?? [];
      // Find all dates strictly before the game date
      const priorDates = dates.filter(d => d < gameDate);
      if (priorDates.length === 0) {
        // No prior games found — start of season or new team
        return 3;
      }
      // Most recent prior game date
      const lastGameDate = priorDates[priorDates.length - 1];
      const msPerDay = 24 * 60 * 60 * 1000;
      const lastMs = new Date(lastGameDate + "T12:00:00Z").getTime();
      const targetMs = new Date(gameDate + "T12:00:00Z").getTime();
      const days = Math.round((targetMs - lastMs) / msPerDay) - 1;
      // days = 0 means back-to-back (played yesterday, rest = 0)
      // days = 1 means played 2 days ago (rest = 1)
      return Math.max(0, days);
    };

    const awayRestDays = getRestDays(awayDbSlug);
    const homeRestDays = getRestDays(homeDbSlug);

    console.log(
      `[HockeyRef] Rest days for ${awayDbSlug} @ ${homeDbSlug} on ${gameDate}: ` +
        `away=${awayRestDays}d, home=${homeRestDays}d`
    );

    return { awayRestDays, homeRestDays };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[HockeyRef] Failed to compute rest days: ${msg} — defaulting to 2`
    );
    return { awayRestDays: 2, homeRestDays: 2 };
  }
}

/**
 * Invalidate the schedule cache (e.g. call at midnight to force a fresh fetch).
 */
// Dead export — no active callers in pipeline
function invalidateScheduleCache(): void {
  scheduleCache = null;
  console.log("[HockeyRef] Schedule cache invalidated");
}
