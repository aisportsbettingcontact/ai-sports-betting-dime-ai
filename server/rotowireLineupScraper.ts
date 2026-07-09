/**
 * rotowireLineupScraper.ts
 *
 * Scrapes Rotowire MLB daily lineups pages:
 *   Today:    https://www.rotowire.com/baseball/daily-lineups.php
 *   Tomorrow: https://www.rotowire.com/baseball/daily-lineups.php?date=tomorrow
 *
 * Extracts per-game:
 *   - Starting pitchers (name, hand, ERA/W-L, Rotowire player ID, confirmed status)
 *   - Batting lineups (9-man order: batting position, field position, name, bats, Rotowire ID)
 *   - Weather (temperature, wind, precipitation %, dome status)
 *   - Umpire (home plate umpire name)
 *
 * ─── HTML structure (per .lineup.is-mlb card) ────────────────────────────────
 *   .lineup__meta          → start time (ET), broadcaster
 *   .lineup__top           → team logos (.lineup__logo) + abbreviations (.lineup__abbr)
 *   .lineup__matchup       → full team names + W-L records
 *   .lineup__main          → two .lineup__list columns (away=.is-visit, home=.is-home)
 *     .lineup__player-highlight → starting pitcher row
 *       .lineup__throws        → pitcher handedness ("RHP" / "LHP")
 *       .lineup__stats         → season stats "W-L · ERA" e.g. "12-4 · 3.06 ERA"
 *     .lineup__status          → "Confirmed Lineup" or "Expected Lineup"
 *     .lineup__player (×9)     → batting order rows
 *       .lineup__pos           → field position (CF, SS, 1B, etc.)
 *       a[href*="player.php?id="] → player name + Rotowire player ID in href
 *       .lineup__bats          → bats handedness (R / L / S)
 *   .lineup__bottom        → umpire + weather
 *     .lineup__umpire        → "HP: John Doe"
 *     .lineup__weather-text  → "0% 81° Wind 3 mph Out"
 *
 * ─── Rotowire player ID extraction ───────────────────────────────────────────
 *   Rotowire player URLs: /baseball/player.php?id=NNNNN
 *   We store the Rotowire internal ID (NOT the MLBAM ID).
 *   MLBAM headshot URL: https://img.mlbstatic.com/mlb-photos/image/upload/
 *     d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/{mlbamId}/headshot/67/current
 *   Rotowire headshot URL: https://www.rotowire.com/images/photos/{rotowireId}.jpg
 *
 * ─── Team matching ────────────────────────────────────────────────────────────
 *   Rotowire uses abbreviations in .lineup__abbr (e.g. "NYY", "SF", "WSH", "CWS").
 *   We match to DB games using awayTeam / homeTeam abbreviation fields.
 *   Known overrides: WSH→WSH, CWS→CWS, ATH→ATH (Rotowire may use "OAK" for Athletics).
 *
 * ─── Auth ─────────────────────────────────────────────────────────────────────
 *   No authentication required — lineups page is publicly accessible.
 *   Rate limit: scrape at most once per 10 minutes (enforced by caller).
 */

import * as cheerio from "cheerio";
import { MLB_BY_ABBREV } from "../shared/mlbTeams.js";
import { logToDb } from "./dbLogger";

const ROTO_SRC = "RotoScraper";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RotoLineupPlayer {
  /** Batting order position (1-9) */
  battingOrder: number;
  /** Field position abbreviation: CF, SS, 1B, 2B, 3B, LF, RF, C, DH, P */
  position: string;
  /** Full player name */
  name: string;
  /** Bats: "R" | "L" | "S" (switch) */
  bats: string;
  /** Rotowire internal player ID (from href /baseball/player.php?id=NNNNN) */
  rotowireId: number | null;
}

export interface RotoStartingPitcher {
  /** Full pitcher name */
  name: string;
  /** Throws: "R" | "L" */
  hand: string;
  /** Season stats string, e.g. "12-4 · 3.06 ERA" or "0-0 · 0.00 ERA" */
  era: string;
  /** Rotowire internal player ID */
  rotowireId: number | null;
  /** Whether the lineup card shows "Confirmed Lineup" (vs "Expected Lineup") */
  confirmed: boolean;
}

export interface RotoWeather {
  /** Weather emoji icon: ☀️ ⛅ 🌧️ ❄️ 🏟️ etc. */
  icon: string;
  /** Temperature string, e.g. "73°F" */
  temp: string;
  /** Wind string, e.g. "8 mph Out" or "3 mph In" or "Calm" */
  wind: string;
  /** Precipitation percentage (0-100) */
  precip: number;
  /** Whether the game is in a dome (retractable or fixed) */
  dome: boolean;
}

export interface RotoLineupGame {
  /** Away team abbreviation (e.g. "NYY") — matches DB awayTeam column */
  awayAbbrev: string;
  /** Home team abbreviation (e.g. "SF") — matches DB homeTeam column */
  homeAbbrev: string;
  /** Start time string from Rotowire, e.g. "7:05 PM ET" */
  startTime: string;
  /** Away starting pitcher */
  awayPitcher: RotoStartingPitcher | null;
  /** Home starting pitcher */
  homePitcher: RotoStartingPitcher | null;
  /** Whether the away batting lineup is confirmed (9 players shown) */
  awayLineupConfirmed: boolean;
  /** Whether the home batting lineup is confirmed (9 players shown) */
  homeLineupConfirmed: boolean;
  /** Away batting order (9 players), empty array if not yet available */
  awayLineup: RotoLineupPlayer[];
  /** Home batting order (9 players), empty array if not yet available */
  homeLineup: RotoLineupPlayer[];
  /** Weather data */
  weather: RotoWeather | null;
  /** Home plate umpire name */
  umpire: string | null;
}

export interface ScrapeRotowireResult {
  games: RotoLineupGame[];
  /** Total .lineup.is-mlb cards found on page */
  cardsFound: number;
  /** Cards successfully parsed */
  cardsParsed: number;
  /** Cards skipped (team not in MLB registry or exhibition) */
  cardsSkipped: number;
  /** Parse errors encountered */
  parseErrors: number;
  /** UTC timestamp (ms) when scrape completed */
  scrapedAt: number;
  /** HTTP status code */
  httpStatus: number;
  /** Total fetch duration in ms */
  fetchMs: number;
  /** Total parse duration in ms */
  parseMs: number;
  /** Which date was scraped: "today" | "tomorrow" */
  dateScope: "today" | "tomorrow";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://www.rotowire.com/baseball/daily-lineups.php";
const TODAY_URL = BASE_URL;
const TOMORROW_URL = `${BASE_URL}?date=tomorrow`;

/**
 * Rotowire abbreviation overrides — some differ from standard MLB abbreviations.
 * Maps Rotowire abbrev → DB abbrev (which matches the games.awayTeam / homeTeam column).
 */
const ROTO_ABBREV_OVERRIDES: Record<string, string> = {
  "OAK": "ATH",  // Athletics relocated to Sacramento; Rotowire may still show "OAK"
  "SAC": "ATH",  // Sacramento Athletics alternate
};

/** Weather icon selection based on text patterns (first match wins) */
const WEATHER_ICON_RULES: Array<[RegExp, string]> = [
  [/dome|retractable|indoor|roof/i, "🏟️"],
  [/snow|blizzard/i, "❄️"],
  [/thunder|storm|lightning/i, "⛈️"],
  [/rain|drizzle|shower/i, "🌧️"],
  [/fog|mist/i, "🌫️"],
  [/overcast|cloudy/i, "☁️"],
  [/partly|mostly cloudy/i, "⛅"],
  [/clear|sunny|fair/i, "☀️"],
  [/wind/i, "💨"],
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract Rotowire player ID from href.
 * Handles both formats:
 *   Old: /baseball/player.php?id=12345
 *   New: /baseball/player/rafael-devers-13179  (numeric suffix after last hyphen)
 */
function extractRotowireId(href: string | undefined): number | null {
  if (!href) return null;
  // Old format: ?id=NNNNN
  const oldFmt = href.match(/[?&]id=(\d+)/i);
  if (oldFmt) return parseInt(oldFmt[1], 10);
  // New format: /baseball/player/name-NNNNN  (last segment ends with -digits)
  const newFmt = href.match(/-(\d+)\s*$/);
  if (newFmt) return parseInt(newFmt[1], 10);
  return null;
}

/** Normalize pitcher hand from Rotowire text like "RHP", "LHP", "R", "L" */
function normalizePitcherHand(text: string): string {
  const t = text.trim().toUpperCase();
  if (t.includes("L")) return "L";
  if (t.includes("R")) return "R";
  return "?";
}

/** Parse weather text like "0% 81° Wind 3 mph Out" into structured RotoWeather */
function parseWeatherText(rawText: string, isDome: boolean): RotoWeather {
  const text = rawText.trim();

  if (isDome || /dome|retractable|indoor|roof/i.test(text)) {
    return { icon: "🏟️", temp: "Dome", wind: "Indoor", precip: 0, dome: true };
  }

  // Precipitation %
  const precipMatch = text.match(/(\d+)%/);
  const precip = precipMatch ? parseInt(precipMatch[1], 10) : 0;

  // Temperature (e.g. "81°" or "81°F")
  const tempMatch = text.match(/(\d+)\s*°/);
  const temp = tempMatch ? `${tempMatch[1]}°F` : "?°F";

  // Wind (e.g. "Wind 8 mph Out", "Wind 3 mph In", "Wind 12 mph L-R")
  const windMatch = text.match(/Wind\s+(\d+)\s*mph(?:\s+(In|Out|L-R|R-L|Calm|N|S|E|W|NE|NW|SE|SW))?/i);
  let wind = "Calm";
  if (windMatch) {
    const speed = windMatch[1];
    const dir = windMatch[2] ? ` ${windMatch[2]}` : "";
    wind = `${speed} mph${dir}`;
  }

  // Determine icon — check text first, then override by precip %
  let icon = "⛅";
  for (const [pattern, emoji] of WEATHER_ICON_RULES) {
    if (pattern.test(text)) {
      icon = emoji;
      break;
    }
  }
  // Override by precip severity
  if (!isDome) {
    if (precip >= 60) icon = "🌧️";
    else if (precip >= 30) icon = "⛅";
    else if (precip === 0 && wind === "Calm") icon = "☀️";
  }

  return { icon, temp, wind, precip, dome: false };
}

/** Normalize Rotowire team abbreviation to DB abbreviation */
function normalizeAbbrev(rotoAbbrev: string): string {
  const upper = rotoAbbrev.trim().toUpperCase();
  return ROTO_ABBREV_OVERRIDES[upper] ?? upper;
}

// ─── Core HTML parser ─────────────────────────────────────────────────────────

function parseLineupHtml(
  html: string,
  dateScope: "today" | "tomorrow",
  tag: string
): { games: RotoLineupGame[]; cardsFound: number; cardsParsed: number; cardsSkipped: number; parseErrors: number } {
  const $ = cheerio.load(html);
  const games: RotoLineupGame[] = [];

  const cards = $(".lineup.is-mlb");
  const cardsFound = cards.length;
  logToDb(ROTO_SRC, 'info', `${tag} Found ${cardsFound} .lineup.is-mlb cards on ${dateScope} page`);

  let cardsParsed = 0;
  let cardsSkipped = 0;
  let parseErrors = 0;

  cards.each((cardIdx: number, cardEl: any) => {
    const cardTag = `${tag}[${dateScope}][card ${cardIdx + 1}/${cardsFound}]`;

    try {
      const $card = $(cardEl);

      // ── Team abbreviations ────────────────────────────────────────────────
      const abbrevEls = $card.find(".lineup__abbr");
      const rawAway = abbrevEls.eq(0).text().trim();
      const rawHome = abbrevEls.eq(1).text().trim();
      const awayAbbrev = normalizeAbbrev(rawAway);
      const homeAbbrev = normalizeAbbrev(rawHome);

      // Validate both teams exist in MLB registry
      const awayTeam = MLB_BY_ABBREV.get(awayAbbrev);
      const homeTeam = MLB_BY_ABBREV.get(homeAbbrev);

      if (!awayTeam || !homeTeam) {
        logToDb(ROTO_SRC, 'warn',
          `${cardTag} SKIP — unknown team(s): ` +
          `away="${rawAway}"→"${awayAbbrev}" (${awayTeam ? "found" : "MISSING"}) | ` +
          `home="${rawHome}"→"${homeAbbrev}" (${homeTeam ? "found" : "MISSING"})`
        );
        cardsSkipped++;
        return;
      }

      // ── Start time ────────────────────────────────────────────────────────
      // Rotowire puts time in .lineup__time or first text in .lineup__meta
      const startTime =
        $card.find(".lineup__time").first().text().trim() ||
        $card.find(".lineup__meta").first().children().first().text().trim() ||
        "TBD";

      logToDb(ROTO_SRC, 'info', `${cardTag} Parsing ${awayAbbrev} @ ${homeAbbrev} | startTime="${startTime}"`);

      // ── Parse one team's lineup column ────────────────────────────────────
      const parseColumn = (
        $col: cheerio.Cheerio<any>,
        side: "away" | "home"
      ): { pitcher: RotoStartingPitcher | null; lineup: RotoLineupPlayer[]; lineupConfirmed: boolean } => {
        const colTag = `${cardTag}[${side}]`;

        // ── Pitcher ────────────────────────────────────────────────────────
        let pitcher: RotoStartingPitcher | null = null;
        const $highlight = $col.find(".lineup__player-highlight").first();

        if ($highlight.length) {
          const $link = $highlight.find("a").first();
          // Prefer the `title` attribute for the full name (e.g. "Max Fried");
          // fall back to visible text which may be abbreviated (e.g. "M. Fried")
          const pitcherName = ($link.attr("title") || $link.text()).trim();
          const rotowireId = extractRotowireId($link.attr("href"));

          // Hand: from .lineup__throws span ("RHP" / "LHP")
          const throwsRaw = $highlight.find(".lineup__throws").text().trim();
          const hand = normalizePitcherHand(throwsRaw || "R");

          // Stats: "12-4 · 3.06 ERA" — try both class names (page updated to .lineup__player-highlight-stats)
          const statsRaw = (
            $highlight.find(".lineup__player-highlight-stats").text().trim() ||
            $highlight.find(".lineup__stats").text().trim()
          );
          // Normalize: convert "2-2&nbsp;5.21 ERA" or "2-2 5.21 ERA" to "2-2 · 5.21 ERA"
          const eraRaw = statsRaw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
          // If format is "W-L ERA" (no middle dot), insert the dot
          const era = eraRaw
            ? eraRaw.replace(/^(\d+-\d+)\s+([.\d]+\s*ERA)$/, "$1 · $2")
            : "0-0 · 0.00 ERA";

          // Confirmed: check .lineup__status text in the column
          const statusText = $col.find(".lineup__status").first().text().trim();
          const confirmed = /confirmed/i.test(statusText);

          if (pitcherName) {
            pitcher = { name: pitcherName, hand, era, rotowireId, confirmed };
            logToDb(ROTO_SRC, 'info',
              `${colTag} Pitcher: "${pitcherName}" (${hand}HP) | era="${era}" | ` +
              `rotowireId=${rotowireId ?? "null"} | confirmed=${confirmed}`
            );
          } else {
            logToDb(ROTO_SRC, 'warn', `${colTag} Pitcher highlight found but name is empty (TBD)`);
          }
        } else {
          logToDb(ROTO_SRC, 'warn', `${colTag} No .lineup__player-highlight found — pitcher TBD`);
        }

        // ── Batting lineup ────────────────────────────────────────────────
        const lineup: RotoLineupPlayer[] = [];
        const statusText = $col.find(".lineup__status").first().text().trim();
        const lineupConfirmed = /confirmed/i.test(statusText);

        $col.find(".lineup__player").each((i: number, playerEl: any) => {
          const battingOrder = i + 1;
          if (battingOrder > 9) return false; // stop after 9

          const $p = $(playerEl);
          const position = $p.find(".lineup__pos").text().trim() || "?";
          const $nameLink = $p.find("a").first();
          // Prefer the `title` attribute for the full name (e.g. "Rafael Devers");
          // fall back to visible text which may be abbreviated (e.g. "R. Devers")
          const name = ($nameLink.attr("title") || $nameLink.text()).trim();
          const rotowireId = extractRotowireId($nameLink.attr("href"));
          const bats = $p.find(".lineup__bats").text().trim() || "?";

          if (!name) {
            logToDb(ROTO_SRC, 'warn', `${colTag} Empty player name at batting order ${battingOrder}`);
            return;
          }

          lineup.push({ battingOrder, position, name, bats, rotowireId });
        });

        if (lineup.length > 0) {
          logToDb(ROTO_SRC, 'info',
            `${colTag} Lineup: ${lineup.length}/9 players | confirmed=${lineupConfirmed} | ` +
            `1: ${lineup[0]?.name ?? "?"} (${lineup[0]?.position ?? "?"}, ${lineup[0]?.bats ?? "?"}B) | ` +
            `4: ${lineup[3]?.name ?? "?"} (${lineup[3]?.position ?? "?"}, ${lineup[3]?.bats ?? "?"}B)`
          );
        } else {
          logToDb(ROTO_SRC, 'info', `${colTag} Lineup: not yet posted (0 players)`);
        }

        return { pitcher, lineup, lineupConfirmed };
      };

      // Away = .is-visit, Home = .is-home
      const awayData = parseColumn($card.find(".lineup__list.is-visit").first(), "away");
      const homeData = parseColumn($card.find(".lineup__list.is-home").first(), "home");

      // ── Weather ────────────────────────────────────────────────────────────
      let weather: RotoWeather | null = null;
      const $bottom = $card.find(".lineup__bottom").first();

      if ($bottom.length) {
        const isDome =
          $bottom.find(".lineup__weather-icon--dome").length > 0 ||
          /dome|retractable|roof/i.test($bottom.text());
        const weatherText = $bottom.find(".lineup__weather-text").text().trim();

        if (weatherText || isDome) {
          weather = parseWeatherText(weatherText, isDome);
          logToDb(ROTO_SRC, 'info',
            `${cardTag} Weather: ${weather.icon} ${weather.temp} | ` +
            `wind="${weather.wind}" | precip=${weather.precip}% | dome=${weather.dome} | ` +
            `raw="${weatherText}"`
          );
        } else {
          logToDb(ROTO_SRC, 'warn', `${cardTag} No weather text in .lineup__bottom`);
        }
      } else {
        logToDb(ROTO_SRC, 'warn', `${cardTag} No .lineup__bottom found`);
      }

      // ── Umpire ─────────────────────────────────────────────────────────────
      let umpire: string | null = null;
      const $umpireEl = $bottom.find(".lineup__umpire");
      if ($umpireEl.length) {
        // Rotowire umpire block structure:
        //   <div class="lineup__umpire">
        //     <span>Umpire:</span>
        //     <a href="...">John Doe</a>   ← umpire name
        //     <span>9.2 R/G · 17.5 K/G</span>  ← stats (ignore)
        //   </div>
        // Prefer the <a> tag for the name; fall back to stripping the label + stats.
        const $nameLink = $umpireEl.find("a").first();
        if ($nameLink.length) {
          umpire = ($nameLink.attr("title") || $nameLink.text()).trim() || null;
        } else {
          // Fallback: strip "Umpire:" label and numeric stats (R/G, K/G) from raw text
          const rawText = $umpireEl.text().trim();
          umpire = rawText
            .replace(/^Umpire:\s*/i, "")
            .replace(/\d+\.\d+\s*R\/G/gi, "")
            .replace(/\d+\.\d+\s*K\/G/gi, "")
            .replace(/\s+/g, " ")
            .trim() || null;
        }
        if (umpire) logToDb(ROTO_SRC, 'info', `${cardTag} Umpire: "${umpire}"`);
      }

      // ── Assemble ───────────────────────────────────────────────────────────
      const game: RotoLineupGame = {
        awayAbbrev,
        homeAbbrev,
        startTime,
        awayPitcher: awayData.pitcher,
        homePitcher: homeData.pitcher,
        awayLineupConfirmed: awayData.lineupConfirmed,
        homeLineupConfirmed: homeData.lineupConfirmed,
        awayLineup: awayData.lineup,
        homeLineup: homeData.lineup,
        weather,
        umpire,
      };

      games.push(game);
      cardsParsed++;

      logToDb(ROTO_SRC, 'info',
        `${cardTag} OK ${awayAbbrev} @ ${homeAbbrev} | ` +
        `awayP=${awayData.pitcher?.name ?? "TBD"} | homeP=${homeData.pitcher?.name ?? "TBD"} | ` +
        `awayLineup=${awayData.lineup.length}/9 | homeLineup=${homeData.lineup.length}/9 | ` +
        `weather=${weather?.icon ?? "none"} | umpire=${umpire ?? "none"}`
      );

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logToDb(ROTO_SRC, 'error', `${cardTag} PARSE ERROR: ${msg}`);
      parseErrors++;
    }
  });

  return { games, cardsFound, cardsParsed, cardsSkipped, parseErrors };
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchLineupPage(url: string, tag: string): Promise<{ html: string; httpStatus: number; fetchMs: number }> {
  const fetchStart = Date.now();
  logToDb(ROTO_SRC, 'info', `${tag} GET ${url}`);

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(30_000),
  });

  const fetchMs = Date.now() - fetchStart;
  const html = await resp.text();
  logToDb(ROTO_SRC, 'info', `${tag} HTTP ${resp.status} in ${fetchMs}ms | HTML ${html.length} chars`);

  return { html, httpStatus: resp.status, fetchMs };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scrape today's Rotowire MLB lineups page.
 * Use when it's game day (games are today in ET).
 */
export async function scrapeRotowireLineupsToday(): Promise<ScrapeRotowireResult> {
  const tag = "[RotoScraper][today]";
  const startMs = Date.now();

  let html: string;
  let httpStatus: number;
  let fetchMs: number;

  try {
    ({ html, httpStatus, fetchMs } = await fetchLineupPage(TODAY_URL, tag));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logToDb(ROTO_SRC, 'error', `${tag} Fetch failed: ${msg}`);
    return {
      games: [], cardsFound: 0, cardsParsed: 0, cardsSkipped: 0, parseErrors: 1,
      scrapedAt: Date.now(), httpStatus: 0, fetchMs: 0, parseMs: 0, dateScope: "today",
    };
  }

  if (httpStatus !== 200) {
    logToDb(ROTO_SRC, 'error', `${tag} Non-200 HTTP status: ${httpStatus}`);
    return {
      games: [], cardsFound: 0, cardsParsed: 0, cardsSkipped: 0, parseErrors: 1,
      scrapedAt: Date.now(), httpStatus, fetchMs, parseMs: 0, dateScope: "today",
    };
  }

  const parseStart = Date.now();
  const result = parseLineupHtml(html, "today", tag);
  const parseMs = Date.now() - parseStart;
  const totalMs = Date.now() - startMs;

  logToDb(ROTO_SRC, 'info',
    `${tag} DONE | cardsFound=${result.cardsFound} parsed=${result.cardsParsed} ` +
    `skipped=${result.cardsSkipped} errors=${result.parseErrors} | ` +
    `fetchMs=${fetchMs} parseMs=${parseMs} totalMs=${totalMs}`
  );

  return { ...result, scrapedAt: Date.now(), httpStatus, fetchMs, parseMs, dateScope: "today" };
}

/**
 * Scrape tomorrow's Rotowire MLB lineups page.
 * Use when today has no games but tomorrow does (e.g. Opening Night on March 25
 * when today is March 24).
 */
export async function scrapeRotowireLineupsTomorrow(): Promise<ScrapeRotowireResult> {
  const tag = "[RotoScraper][tomorrow]";
  const startMs = Date.now();

  let html: string;
  let httpStatus: number;
  let fetchMs: number;

  try {
    ({ html, httpStatus, fetchMs } = await fetchLineupPage(TOMORROW_URL, tag));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logToDb(ROTO_SRC, 'error', `${tag} Fetch failed: ${msg}`);
    return {
      games: [], cardsFound: 0, cardsParsed: 0, cardsSkipped: 0, parseErrors: 1,
      scrapedAt: Date.now(), httpStatus: 0, fetchMs: 0, parseMs: 0, dateScope: "tomorrow",
    };
  }

  if (httpStatus !== 200) {
    logToDb(ROTO_SRC, 'error', `${tag} Non-200 HTTP status: ${httpStatus}`);
    return {
      games: [], cardsFound: 0, cardsParsed: 0, cardsSkipped: 0, parseErrors: 1,
      scrapedAt: Date.now(), httpStatus, fetchMs, parseMs: 0, dateScope: "tomorrow",
    };
  }

  const parseStart = Date.now();
  const result = parseLineupHtml(html, "tomorrow", tag);
  const parseMs = Date.now() - parseStart;
  const totalMs = Date.now() - startMs;

  logToDb(ROTO_SRC, 'info',
    `${tag} DONE | cardsFound=${result.cardsFound} parsed=${result.cardsParsed} ` +
    `skipped=${result.cardsSkipped} errors=${result.parseErrors} | ` +
    `fetchMs=${fetchMs} parseMs=${parseMs} totalMs=${totalMs}`
  );

  return { ...result, scrapedAt: Date.now(), httpStatus, fetchMs, parseMs, dateScope: "tomorrow" };
}

/**
 * Scrape both today and tomorrow, deduplicate by awayAbbrev+homeAbbrev.
 * Returns all unique games found across both pages.
 * Today's results take precedence (more up-to-date confirmations).
 */
export async function scrapeRotowireLineupsBoth(): Promise<{
  today: ScrapeRotowireResult;
  tomorrow: ScrapeRotowireResult;
  combined: RotoLineupGame[];
}> {
  const tag = "[RotoScraper][both]";
  logToDb(ROTO_SRC, 'info', `${tag} Scraping today + tomorrow in parallel`);

  const [today, tomorrow] = await Promise.all([
    scrapeRotowireLineupsToday(),
    scrapeRotowireLineupsTomorrow(),
  ]);

  // Deduplicate: today takes precedence over tomorrow for same matchup
  const seen = new Set<string>();
  const combined: RotoLineupGame[] = [];

  for (const game of [...today.games, ...tomorrow.games]) {
    const key = `${game.awayAbbrev}@${game.homeAbbrev}`;
    if (!seen.has(key)) {
      seen.add(key);
      combined.push(game);
    }
  }

  logToDb(ROTO_SRC, 'info',
    `${tag} Combined: today=${today.cardsParsed} + tomorrow=${tomorrow.cardsParsed} → ` +
    `${combined.length} unique games`
  );

  return { today, tomorrow, combined };
}

// ─── DB Upsert ────────────────────────────────────────────────────────────────

/**
 * Persist a list of scraped RotoLineupGame records to the mlb_lineups table.
 * Matches each game to a DB game row by awayTeam + homeTeam + gameDate.
 * Skips games not found in the DB (e.g. Spring Training games not seeded).
 *
 * @param games - Parsed lineup games from scrapeRotowireLineupsBoth()
 * @param targetDate - YYYY-MM-DD date string to restrict DB lookup to exact date.
 *   REQUIRED to prevent tomorrow's scrape from overwriting today's lineup records
 *   when the same team matchup appears on consecutive days (e.g. series games).
 *   Pass todayStr for today's games, tomorrowStr for tomorrow's games.
 * @returns Summary: { saved, skipped, errors }
 */
export async function upsertLineupsToDB(
  games: RotoLineupGame[],
  targetDate?: string
): Promise<{ saved: number; skipped: number; errors: number; gameIdMap: Map<string, number> }> {
  const tag = "[RotoScraper][upsertDB]";

  if (games.length === 0) {
    logToDb(ROTO_SRC, 'info', `${tag} No games to upsert`);
    return { saved: 0, skipped: 0, errors: 0, gameIdMap: new Map() };
  }

  // Lazy-import DB helpers to avoid circular deps at module load time
  const { getDb } = await import("./db.js");
  const { upsertMlbLineup } = await import("./db.js");
  const { games: gamesTable, mlbPlayers } = await import("../drizzle/schema.js");
  const { eq, and, gte, lte } = await import("drizzle-orm");

  // Date window: use targetDate for exact match (prevents cross-day overwrite),
  // or fall back to a 7-day window if no targetDate is provided.
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const dateFrom = targetDate ?? todayStr;
  const plusSevenDate = new Date(dateFrom + "T12:00:00Z");
  plusSevenDate.setUTCDate(plusSevenDate.getUTCDate() + (targetDate ? 0 : 6));
  const dateTo = targetDate ?? plusSevenDate.toISOString().slice(0, 10);
  logToDb(ROTO_SRC, 'info', `${tag} Date window: ${dateFrom} → ${dateTo} (targetDate=${targetDate ?? "none, using 7-day window"})`);

  const db = await getDb();
  if (!db) {
    logToDb(ROTO_SRC, 'warn', `${tag} DB not available — skipping all ${games.length} games`);
    return { saved: 0, skipped: games.length, errors: 0, gameIdMap: new Map() };
  }

  // ── Build name → mlbamId lookup from mlb_players table ──────────────────────
  // Used to resolve headshot IDs for pitchers and batters by full name.
  const playerRows = await db
    .select({ name: mlbPlayers.name, mlbamId: mlbPlayers.mlbamId })
    .from(mlbPlayers)
    .where(eq(mlbPlayers.isActive, true));

  // Normalize names: lowercase, strip accents, strip generational suffixes (Jr./Sr./II/III),
  // collapse whitespace — for fuzzy matching Rotowire names to MLB Stats API names.
  const normalize = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")        // strip diacritics
      .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, "") // strip generational suffixes
      .replace(/[^a-z0-9 ]/g, "")             // strip punctuation
      .replace(/\s+/g, " ")
      .trim();

  const nameToMlbamId = new Map<string, number>();
  for (const p of playerRows) {
    if (p.mlbamId != null) {
      nameToMlbamId.set(normalize(p.name), p.mlbamId);
    }
  }
  logToDb(ROTO_SRC, 'info', `${tag} Loaded ${nameToMlbamId.size} active players for mlbamId lookup`);

  const resolveMlbamId = (name: string | null | undefined): number | null => {
    if (!name) return null;
    return nameToMlbamId.get(normalize(name)) ?? null;
  };

  let saved = 0;
  let skipped = 0;
  let errors = 0;
  /** Maps "awayAbbrev@homeAbbrev" → DB gameId — consumed by LineupWatcher after upsert */
  const gameIdMap = new Map<string, number>();

  for (const g of games) {
    const gameTag = `${tag}[${g.awayAbbrev}@${g.homeAbbrev}]`;

    try {
      // Look up the DB game row by awayTeam + homeTeam within 7-day window
      // (Rotowire doesn't give us an exact date, so we match by team pair)
      const rows = await db
        .select({ id: gamesTable.id, gameDate: gamesTable.gameDate })
        .from(gamesTable)
        .where(
          and(
            eq(gamesTable.awayTeam, g.awayAbbrev),
            eq(gamesTable.homeTeam, g.homeAbbrev),
            eq(gamesTable.sport, "MLB"),
            gte(gamesTable.gameDate, dateFrom),
            lte(gamesTable.gameDate, dateTo)
          )
        )
        .limit(1);

      if (rows.length === 0) {
        logToDb(ROTO_SRC, 'info', `${gameTag} NO_MATCH in DB — skipping (Spring Training or unseeded game)`);
        skipped++;
        continue;
      }

      const gameId = rows[0].id;
      // Register in gameIdMap so the LineupWatcher can resolve gameIds without a second DB query
      gameIdMap.set(`${g.awayAbbrev}@${g.homeAbbrev}`, gameId);

      // Resolve mlbamIds for pitchers
      const awayPitcherMlbamId = resolveMlbamId(g.awayPitcher?.name);
      const homePitcherMlbamId = resolveMlbamId(g.homePitcher?.name);

      // Resolve mlbamIds for each batter and embed into lineup JSON
      const enrichLineup = (players: RotoLineupPlayer[]): string | null => {
        if (players.length === 0) return null;
        const enriched = players.map(p => ({
          ...p,
          mlbamId: resolveMlbamId(p.name),
        }));
        return JSON.stringify(enriched);
      };

      // Build the InsertMlbLineup payload
      const payload = {
        gameId,
        scrapedAt: Date.now(),
        awayPitcherName: g.awayPitcher?.name ?? null,
        awayPitcherHand: g.awayPitcher?.hand ?? null,
        awayPitcherEra: g.awayPitcher?.era ?? null,
        awayPitcherRotowireId: g.awayPitcher?.rotowireId ?? null,
        awayPitcherMlbamId,
        awayPitcherConfirmed: g.awayPitcher?.confirmed ?? false,
        homePitcherName: g.homePitcher?.name ?? null,
        homePitcherHand: g.homePitcher?.hand ?? null,
        homePitcherEra: g.homePitcher?.era ?? null,
        homePitcherRotowireId: g.homePitcher?.rotowireId ?? null,
        homePitcherMlbamId,
        homePitcherConfirmed: g.homePitcher?.confirmed ?? false,
        awayLineup: enrichLineup(g.awayLineup),
        homeLineup: enrichLineup(g.homeLineup),
        awayLineupConfirmed: g.awayLineupConfirmed,
        homeLineupConfirmed: g.homeLineupConfirmed,
        weatherIcon: g.weather?.icon ?? null,
        weatherTemp: g.weather?.temp ?? null,
        weatherWind: g.weather?.wind ?? null,
        weatherPrecip: g.weather?.precip ?? null,
        weatherDome: g.weather?.dome ?? false,
        umpire: g.umpire ?? null,
      };

      logToDb(ROTO_SRC, 'info',
        `${gameTag} Upserting gameId=${gameId} | ` +
        `awayP="${payload.awayPitcherName ?? "TBD"}" (${payload.awayPitcherHand ?? "?"}) | ` +
        `homeP="${payload.homePitcherName ?? "TBD"}" (${payload.homePitcherHand ?? "?"}) | ` +
        `awayLineup=${g.awayLineup.length}/9 (${g.awayLineupConfirmed ? "CONFIRMED" : "expected"}) | ` +
        `homeLineup=${g.homeLineup.length}/9 (${g.homeLineupConfirmed ? "CONFIRMED" : "expected"}) | ` +
        `weather=${payload.weatherIcon ?? "none"} ${payload.weatherTemp ?? ""} | ` +
        `umpire="${payload.umpire ?? "none"}"`
      );

      await upsertMlbLineup(payload);
      saved++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logToDb(ROTO_SRC, 'error', `${gameTag} Error: ${msg}`);
      errors++;
    }
  }

  logToDb(ROTO_SRC, 'info', `${tag} Done — saved=${saved} skipped=${skipped} errors=${errors} gameIdMap=${gameIdMap.size}`);
  return { saved, skipped, errors, gameIdMap };
}
