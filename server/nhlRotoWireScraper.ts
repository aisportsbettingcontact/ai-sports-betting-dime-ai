/**
 * nhlRotoWireScraper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes starting goalies from RotoWire NHL Lineups page.
 *
 * Data source:
 *   https://www.rotowire.com/hockey/nhl-lineups.php
 *
 * Page structure (verified Mar 2026):
 *   .lineup__box                   — one per game
 *     .lineup__top
 *       .lineup__teams
 *         a.lineup__team.is-visit  — away team link
 *           .lineup__abbr          — 3-letter abbrev (e.g. "STL")
 *         a.lineup__team.is-home   — home team link
 *           .lineup__abbr          — 3-letter abbrev (e.g. "WPG")
 *     .lineup__main
 *       ul.lineup__list.is-visit   — away team lineup
 *         li.lineup__player-highlight  — starting goalie (first item)
 *           .lineup__player-highlight-name > a  — goalie name
 *           .is-confirmed / .is-expected        — status
 *       ul.lineup__list.is-home    — home team lineup
 *         li.lineup__player-highlight  — starting goalie (first item)
 *
 * Outputs:
 *   NhlLineupGame — per-game lineup with starting goalies confirmed/projected
 */

import * as cheerio from "cheerio";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlStartingGoalie {
  name: string;
  confirmed: boolean; // true = confirmed starter, false = projected/expected
  team: string; // NHL abbreviation (e.g. "BOS")
}

export interface NhlLineupGame {
  awayTeam: string; // NHL abbreviation (e.g. "BOS")
  homeTeam: string; // NHL abbreviation (e.g. "TOR")
  awayGoalie: NhlStartingGoalie | null;
  homeGoalie: NhlStartingGoalie | null;
  gameTime: string; // e.g. "7:00 PM ET"
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROTOWIRE_LINEUPS_URL_TODAY =
  "https://www.rotowire.com/hockey/nhl-lineups.php";
const ROTOWIRE_LINEUPS_URL_TOMORROW =
  "https://www.rotowire.com/hockey/nhl-lineups.php?date=tomorrow";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.rotowire.com/",
};

// ─── Scraper ─────────────────────────────────────────────────────────────────

/**
 * Scrape RotoWire NHL lineups page for starting goalies.
 * @param date - 'today' (default) or 'tomorrow'
 * Returns a list of games with away/home starting goalies.
 */
export async function scrapeNhlStartingGoalies(
  date: "today" | "tomorrow" = "today"
): Promise<NhlLineupGame[]> {
  const url =
    date === "tomorrow"
      ? ROTOWIRE_LINEUPS_URL_TOMORROW
      : ROTOWIRE_LINEUPS_URL_TODAY;
  console.log(
    `[RotoWireScraper] ► Fetching NHL lineups from RotoWire (${date.toUpperCase()})...`
  );
  console.log(`[RotoWireScraper]   URL: ${url}`);

  const resp = await fetch(url, { headers: FETCH_HEADERS });
  if (!resp.ok) {
    throw new Error(
      `[RotoWireScraper] Fetch failed: HTTP ${resp.status} ${resp.statusText}`
    );
  }
  const html = await resp.text();
  console.log(`[RotoWireScraper]   Received ${html.length} bytes`);

  const games = parseRotoWireLineups(html);
  console.log(
    `[RotoWireScraper] ✅ Scraped ${games.length} ${date.toUpperCase()} games`
  );
  return games;
}

/**
 * Scrape both today's and tomorrow's NHL lineups in parallel.
 */
export async function scrapeNhlStartingGoaliesBoth(): Promise<{
  today: NhlLineupGame[];
  tomorrow: NhlLineupGame[];
}> {
  console.log(
    "[RotoWireScraper] ► Fetching NHL lineups for TODAY + TOMORROW in parallel..."
  );
  const [today, tomorrow] = await Promise.all([
    scrapeNhlStartingGoalies("today"),
    scrapeNhlStartingGoalies("tomorrow"),
  ]);
  console.log(
    `[RotoWireScraper] ✅ TODAY: ${today.length} games | TOMORROW: ${tomorrow.length} games`
  );
  return { today, tomorrow };
}

/**
 * Parse RotoWire lineups HTML.
 * Exported for testing.
 */
export function parseRotoWireLineups(html: string): NhlLineupGame[] {
  const $ = cheerio.load(html);
  const games: NhlLineupGame[] = [];

  const gameBoxes = $(".lineup__box").toArray();
  console.log(`[RotoWireScraper]   Found ${gameBoxes.length} game boxes`);

  for (const box of gameBoxes) {
    const $box = $(box);

    // ── Team abbreviations ────────────────────────────────────────────────
    const awayAbbr = $box
      .find(".lineup__team.is-visit .lineup__abbr")
      .first()
      .text()
      .trim();
    const homeAbbr = $box
      .find(".lineup__team.is-home .lineup__abbr")
      .first()
      .text()
      .trim();

    if (!awayAbbr || !homeAbbr) {
      console.warn(
        "[RotoWireScraper]   Skipping box — could not find team abbrevs"
      );
      continue;
    }

    // ── Game time ─────────────────────────────────────────────────────────
    const gameTime = $box.find(".lineup__time").first().text().trim();

    // ── Goalies from lineup__player-highlight ─────────────────────────────
    const awayGoalie = extractGoalie($, $box, "is-visit", awayAbbr);
    const homeGoalie = extractGoalie($, $box, "is-home", homeAbbr);

    const game: NhlLineupGame = {
      awayTeam: awayAbbr,
      homeTeam: homeAbbr,
      awayGoalie,
      homeGoalie,
      gameTime,
    };
    games.push(game);

    console.log(
      `[RotoWireScraper]   ${awayAbbr} @ ${homeAbbr} | ` +
        `Away G: ${awayGoalie?.name ?? "TBD"} (${awayGoalie?.confirmed ? "CONFIRMED" : "EXPECTED"}) | ` +
        `Home G: ${homeGoalie?.name ?? "TBD"} (${homeGoalie?.confirmed ? "CONFIRMED" : "EXPECTED"})`
    );
  }

  console.log(
    `[RotoWireScraper] ✅ Scraped ${games.length} games with goalie data`
  );
  return games;
}

/**
 * Extract the starting goalie from a lineup list (is-visit or is-home).
 *
 * Structure:
 *   ul.lineup__list.{side}
 *     li.lineup__player-highlight   ← goalie (first item)
 *       .lineup__player-highlight-name > a  ← name
 *       .is-confirmed / .is-expected        ← status
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGoalie(
  $: cheerio.CheerioAPI,
  $box: cheerio.Cheerio<any>,
  side: "is-visit" | "is-home",
  teamAbbr: string
): NhlStartingGoalie | null {
  const $list = $box.find(`ul.lineup__list.${side}`).first();
  if (!$list.length) return null;

  const $highlight = $list.find("li.lineup__player-highlight").first();
  if (!$highlight.length) return null;

  // Goalie name
  const nameEl = $highlight.find(".lineup__player-highlight-name a").first();
  const name = nameEl.text().trim();
  if (!name) return null;

  // Status: look for .is-confirmed or .is-expected class
  const hasConfirmed = $highlight.find(".is-confirmed").length > 0;
  const hasExpected = $highlight.find(".is-expected").length > 0;

  // Also check text content for "Confirmed" / "Expected" / "Projected"
  const statusText = $highlight.text().toLowerCase();
  const textConfirmed = statusText.includes("confirmed");
  const textExpected =
    statusText.includes("expected") || statusText.includes("projected");

  const confirmed = hasConfirmed || (textConfirmed && !hasExpected);

  return { name, confirmed, team: teamAbbr };
}

// ─── Goalie Name Matching ─────────────────────────────────────────────────────

/**
 * Fuzzy match a goalie name from RotoWire against NaturalStatTrick goalie stats.
 * RotoWire may use "J. Swayman" while NST uses "Jeremy Swayman".
 */
export function matchGoalieName(
  rotoName: string,
  nstGoalieMap: Map<string, import("./nhlNaturalStatScraper").NhlGoalieStats>
): import("./nhlNaturalStatScraper").NhlGoalieStats | null {
  if (!rotoName) return null;

  // Try exact match first
  const exact =
    nstGoalieMap.get(rotoName) ?? nstGoalieMap.get(rotoName.toLowerCase());
  if (exact) return exact;

  // Try last name match
  const parts = rotoName.trim().split(/\s+/);
  const lastName = parts[parts.length - 1].toLowerCase();

  for (const entry of Array.from(nstGoalieMap.entries())) {
    const [key, stats] = entry;
    const keyParts = key.split(/\s+/);
    const keyLastName = keyParts[keyParts.length - 1].toLowerCase();
    if (keyLastName === lastName) {
      console.log(
        `[RotoWireScraper]   Goalie fuzzy match: "${rotoName}" → "${stats.name}"`
      );
      return stats;
    }
  }

  // Try first initial + last name (e.g. "J. Swayman")
  if (rotoName.includes(".")) {
    const initial = rotoName[0].toLowerCase();
    for (const entry of Array.from(nstGoalieMap.entries())) {
      const [key, stats] = entry;
      const keyParts = key.split(/\s+/);
      if (keyParts.length >= 2) {
        const keyInitial = keyParts[0][0].toLowerCase();
        const keyLastName = keyParts[keyParts.length - 1].toLowerCase();
        if (keyInitial === initial && keyLastName === lastName) {
          console.log(
            `[RotoWireScraper]   Goalie initial match: "${rotoName}" → "${stats.name}"`
          );
          return stats;
        }
      }
    }
  }

  console.warn(`[RotoWireScraper] ⚠ No goalie match found for: "${rotoName}"`);
  return null;
}
