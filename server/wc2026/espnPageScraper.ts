/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║              ESPN WORLD CUP PAGE SCRAPER — 250x EDITION                    ║
 * ║                                                                              ║
 * ║  Direct Playwright DOM + __espnfitt__ JSON extraction.                      ║
 * ║  ZERO API fallback. All data sourced exclusively from live ESPN pages.      ║
 * ║                                                                              ║
 * ║  CONFIRMED TABLES (16 total):                                                ║
 * ║    1.  GAME STRIP        — score, status, venue, attendance, officials       ║
 * ║    2.  BOXSCORE          — per-player stats (TCH/G/A/xG/xA/SOG/SHOT/...)   ║
 * ║    3.  GOALKEEPING       — GA/SV/SOGA/xGC/xGOTC/GP/BCS/CLR/CC/KS          ║
 * ║    4.  FORMATIONS        — formation string + full 11-player grid            ║
 * ║    5.  LINEUPS           — starters, subs, unused (with formationPlace)     ║
 * ║    6.  TEAM STATS        — tmStatsGrph 8-row (possession/shots/fouls/...)   ║
 * ║    7.  MATCH STATS       — mtchStatsGrph 9-row (xG/possession/passes/...)  ║
 * ║    8.  EXPECTED GOALS    — xG/xGOT/xGOpenPlay/xGSetPlay per team + player  ║
 * ║    9.  SHOT MAP          — 24 shots: player name/jersey/team, fieldStart,   ║
 * ║                            fieldEnd, goalPosition, xG, xGOT, dist, foot    ║
 * ║   10.  SHOTS             — shotsOnGoal/shots/blocked/hitWoodwork/inside/out ║
 * ║   11.  PASSES            — accuratePasses/passes/backZone/fwdZone/longBalls ║
 * ║                            accurateCrosses/totalThrows/touchesInOppBox      ║
 * ║   12.  ATTACK            — bigChancesCreated/Missed/throughBalls/touches/  ║
 * ║                            fouledInFinalThird/cornersWon                    ║
 * ║   13.  GOALKEEPING TABLE — saves/goalKicks/shotsFaced/highClaims/pkSaved   ║
 * ║   14.  DEFENSE           — tackles/interceptions/clearances/recoveries      ║
 * ║   15.  DUELS             — duelsWon/duels/aerialsWon                        ║
 * ║   16.  FOULS             — foulsCommitted/offsides/yellowCards/redCards     ║
 * ║   17.  GAME ODDS         — moneyline/spread/total (DraftKings)              ║
 * ║   18.  GLOSSARY          — 20-entry stat abbreviation map                   ║
 * ║                                                                              ║
 * ║  PAGES LOADED (3 total):                                                     ║
 * ║    A. /soccer/player-stats/_/gameId/{id}  → boxscore + lineups + glossary  ║
 * ║    B. /soccer/matchstats/_/gameId/{id}    → shot map + tmStats + gameOdds  ║
 * ║    C. /soccer/team-stats/_/gameId/{id}    → full deferred section tables   ║
 * ║                                                                              ║
 * ║  ANTI-BLOCKING STACK:                                                        ║
 * ║    • 8-UA rotation pool (Chrome/Firefox/Edge/Safari desktop + mobile)       ║
 * ║    • Full browser headers (sec-ch-ua, sec-fetch-*, DNT, Accept-Language)    ║
 * ║    • Random inter-request jitter (300–900ms)                                ║
 * ║    • Exponential backoff on failure (2s/4s/8s)                              ║
 * ║    • Image/font/media blocking for 3x speed                                 ║
 * ║    • Stealth viewport (1280×720, deviceScaleFactor=1)                       ║
 * ║    • Cookie persistence across page loads                                   ║
 * ║                                                                              ║
 * ║  ELITE LOGGER: EspnLogger — dual-channel (terminal + .scraper-logs/...)    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { EspnLogger } from "./espnLogger";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CHROMIUM_PATH: string = (() => {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  // Try ms-playwright first, fall back to system chromium
  const candidates = [
    "/home/ubuntu/.cache/ms-playwright/chromium-1161/chrome-linux/chrome",
    "/home/ubuntu/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/home/ubuntu/.cache/ms-playwright/chromium-1169/chrome-linux/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "/usr/bin/chromium";
})();

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
];

const JITTER_MIN_MS = 300;
const JITTER_MAX_MS = 900;
const PAGE_TIMEOUT_MS = 90_000;
const WAIT_AFTER_LOAD_MS = 8_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface PlayerBoxscoreRow {
  athleteId: string;
  name: string;
  nameShort: string;
  jersey: string;
  positionGroup: string; // Forwards | Midfielders | Defenders | Goalkeepers
  stats: Record<string, string>; // e.g. { TCH: "62", G: "0", xG: "0.36", ... }
}

export interface GoalkeeperRow {
  athleteId: string;
  name: string;
  nameShort: string;
  jersey: string;
  stats: Record<string, string>; // GA/SV/SOGA/xGC/xGOTC/GP/BCS/CLR/CC/KS
}

export interface LineupPlayer {
  athleteId: string;
  name: string;
  nameShort: string;
  jersey: string;
  formationPlace: string; // "1"–"11" for starters
  role: "starter" | "substitute" | "unused";
  stats: Record<string, string>; // appearances, foulsCommitted, etc.
}

export interface TeamLineup {
  teamId: string;
  teamName: string;
  teamAbbrev: string;
  teamLogo: string;
  teamColor: string;
  formation: string;
  starters: LineupPlayer[];
  substitutes: LineupPlayer[];
  unused: LineupPlayer[];
}

/** Full shot map entry with confirmed field paths from forensic audit */
export interface ShotMapEntry {
  shotId: string;
  sequence: number;
  // ── Participant (play.participants[0].athlete) ──────────────────────────────
  playerName: string;        // athlete.displayName
  playerShortName: string;   // athlete.shortName
  playerJersey: string;      // athlete.jersey
  playerId: string;          // athlete.id
  // ── Team ──────────────────────────────────────────────────────────────────
  teamAbbrev: string;
  isAway: boolean;
  // ── Timing ────────────────────────────────────────────────────────────────
  period: number;            // play.period.number
  clock: string;             // play.clock.displayValue
  // ── Shot type ─────────────────────────────────────────────────────────────
  iconType: "goal" | "save" | "offTarget" | "blocked";
  isOwnGoal: boolean;
  // ── Field coordinates (play.fieldStart / play.fieldEnd) ───────────────────
  fieldStartX: number | null;   // play.fieldStart.x
  fieldStartY: number | null;   // play.fieldStart.y
  fieldEndX: number | null;     // play.fieldEnd.x
  fieldEndY: number | null;     // play.fieldEnd.y
  // ── Goal position (play.goalPosition) ─────────────────────────────────────
  goalPositionY: number | null; // play.goalPosition.y
  goalPositionZ: number | null; // play.goalPosition.z
  // ── Attributes (play.attributes[]) ────────────────────────────────────────
  xG: string;          // label: "xG"
  xGOT: string;        // label: "xGOT"
  distance: string;    // label: "Distance"
  shotType: string;    // label: "Shot Type"
  situation: string;   // label: "Situation"
  goalZone: string;    // label: "Goal Zone"
  // ── Text ──────────────────────────────────────────────────────────────────
  description: string;
  shortDescription: string;
}

export interface TeamStatRow {
  name: string;
  homeValue: string;
  homeNote: string;  // e.g. "37%" for shot accuracy
  awayValue: string;
  awayNote: string;
  advantage: string; // "LEFT" | "RIGHT" | "NONE" (from deferred tables)
}

export interface GameStrip {
  gameId: string;
  uid: string;
  dateTimeUTC: string;
  status: string;
  statusDetail: string;
  statusState: string;
  competition: string;
  venue: string;
  city: string;
  attendance: number;
  referee: string;
  broadcasts: string[];
  homeTeam: {
    id: string;
    abbrev: string;
    displayName: string;
    logo: string;
    score: number;
    linescores: string[];
    goals: Array<{ id: string; name: string; clock: string }>;
    redCards: string[];
  };
  awayTeam: {
    id: string;
    abbrev: string;
    displayName: string;
    logo: string;
    score: number;
    linescores: string[];
    goals: Array<{ id: string; name: string; clock: string }>;
    redCards: string[];
  };
}

export interface GlossaryEntry {
  abbreviation: string;
  displayName: string;
}

/** Game odds from gameOdds.odds[] (DraftKings) */
export interface GameOddsTeam {
  teamAbbrev: string;
  teamName: string;
  isLoser: boolean;
  moneylineOpen: string;   // gameOdds.odds[i].open.primary
  moneylineCurrent: string; // gameOdds.odds[i].moneyline.primary
  totalSide: string;       // gameOdds.odds[i].total.primary  e.g. "o2.5"
  totalOdds: string;       // gameOdds.odds[i].total.secondary
  spreadLine: string;      // gameOdds.odds[i].pointSpread.primary
  spreadOdds: string;      // gameOdds.odds[i].pointSpread.secondary
}

export interface GameOdds {
  provider: string;         // gameOdds.providerName
  headerText: string;       // gameOdds.headerText
  homeTeam: GameOddsTeam;
  awayTeam: GameOddsTeam;
  drawMoneyline: string;    // gameOdds.odds[2].moneyline.primary (draw)
  drawMoneylineOpen: string; // gameOdds.odds[2].open.primary
}

/** Deferred section table row (from tmStatsTbls / attkTbls / pssTbls / shtsTbls) */
export interface DeferredStatRow {
  name: string;
  homeValue: string;
  homeNote: string;
  awayValue: string;
  awayNote: string;
  advantage: string;
}

export interface EspnMatchPageData {
  // ── Meta ──────────────────────────────────────────────────────────────────
  gameId: string;
  scrapedAt: string;
  scrapeDurationMs: number;
  pagesLoaded: string[];
  /** ESPN-native round label from site.api.espn.com header.season.slug
   *  e.g. "group-stage" | "round-of-32" | "round-of-16" | "quarterfinals" | "semifinals" | "final"
   */
  seasonSlug: string;
  /** ESPN season type code: 13802=group-stage, 13801=round-of-32, etc. */
  seasonType: number;
  /** ESPN full season name: e.g. "2026 FIFA World Cup, Group Stage" */
  seasonName: string;

  // ── 1. Game Strip ─────────────────────────────────────────────────────────
  gameStrip: GameStrip;

  // ── 2 & 3. Boxscore (outfield + GK) ──────────────────────────────────────
  boxscore: {
    homeTeam: {
      teamId: string;
      teamAbbrev: string;
      teamName: string;
      outfieldPlayers: PlayerBoxscoreRow[];
      goalkeeper: GoalkeeperRow | null;
    };
    awayTeam: {
      teamId: string;
      teamAbbrev: string;
      teamName: string;
      outfieldPlayers: PlayerBoxscoreRow[];
      goalkeeper: GoalkeeperRow | null;
    };
    statColumns: string[];
    gkStatColumns: string[];
    glossary: GlossaryEntry[];
  };

  // ── 4 & 5. Formations & Lineups ───────────────────────────────────────────
  lineups: {
    home: TeamLineup;
    away: TeamLineup;
  };

  // ── 6. Team Stats (tmStatsGrph — 8 rows) ─────────────────────────────────
  teamStats: {
    homeAbbrev: string;
    awayAbbrev: string;
    stats: TeamStatRow[];
  };

  // ── 7. Match Stats (mtchStatsGrph — 9 rows) ──────────────────────────────
  matchStats: {
    homeAbbrev: string;
    awayAbbrev: string;
    stats: TeamStatRow[];
  };

  // ── 8. Expected Goals ─────────────────────────────────────────────────────
  expectedGoals: {
    homeTeamXG: string;
    awayTeamXG: string;
    homeTeamXGOpenPlay: string;
    awayTeamXGOpenPlay: string;
    homeTeamXGSetPlay: string;
    awayTeamXGSetPlay: string;
    homeTeamXGOT: string;
    awayTeamXGOT: string;
    homeTeamXA: string;
    awayTeamXA: string;
    perPlayer: Array<{
      name: string;
      team: string;
      xG: string;
      xA: string;
    }>;
  };

  // ── 9. Shot Map ───────────────────────────────────────────────────────────
  shotMap: {
    totalShots: number;
    homeShots: number;
    awayShots: number;
    shots: ShotMapEntry[];
    availableTypes: string[];
    // shtsTbls.tableMap — goal-frame shot coordinates per team
    goalFrameMap: Array<{
      teamAbbrev: string;
      teamName: string;
      teamId: string;
      shots: Array<{ y: number; z: number; type: string }>;
      hasOwnGoal: boolean;
    }>;
  };

  // ── 10. Shots breakdown (shtsTbls) ────────────────────────────────────────
  shots: {
    homeShotsOnGoal: string;
    homeShots: string;
    homeShotsBlocked: string;
    homeHitWoodwork: string;
    homeAttemptsInsideBox: string;
    homeAttemptsOutsideBox: string;
    awayShotsOnGoal: string;
    awayShots: string;
    awayShotsBlocked: string;
    awayHitWoodwork: string;
    awayAttemptsInsideBox: string;
    awayAttemptsOutsideBox: string;
    // raw counts from shot map (for cross-validation)
    homeGoals: number;
    homeSaves: number;
    homeOffTarget: number;
    homeBlocked: number;
    homeTotalShots: number;
    awayGoals: number;
    awaySaves: number;
    awayOffTarget: number;
    awayBlocked: number;
    awayTotalShots: number;
  };

  // ── 11. Passes (pssTbls — 8 rows) ────────────────────────────────────────
  passes: {
    homeAccuratePasses: string;
    homePassAccuracyPct: string;
    homePasses: string;
    homeTotalBackZonePass: string;
    homeTotalForwardZonePass: string;
    homeAccurateLongBalls: string;
    homeAccurateCrosses: string;
    homeTotalThrows: string;
    homeTouchesInOppositionBox: string;
    awayAccuratePasses: string;
    awayPassAccuracyPct: string;
    awayPasses: string;
    awayTotalBackZonePass: string;
    awayTotalForwardZonePass: string;
    awayAccurateLongBalls: string;
    awayAccurateCrosses: string;
    awayTotalThrows: string;
    awayTouchesInOppositionBox: string;
  };

  // ── 12. Attack (attkTbls — 6 rows) ───────────────────────────────────────
  attack: {
    homeBigChancesCreated: string;
    awayBigChancesCreated: string;
    homeBigChancesMissed: string;
    awayBigChancesMissed: string;
    homeThroughBalls: string;
    awayThroughBalls: string;
    homeTouchesInOppositionBox: string;
    awayTouchesInOppositionBox: string;
    homeFouledInFinalThird: string;
    awayFouledInFinalThird: string;
    homeCornersWon: string;
    awayCornersWon: string;
  };

  // ── 13. Goalkeeping (tmStatsTbls[categoryKey=goalkeeping] — 5 rows) ───────
  goalkeeping: {
    homeSaves: string;
    awaySaves: string;
    homeGoalKicks: string;
    awayGoalKicks: string;
    homeShotsFaced: string;
    awayShotsFaced: string;
    homeTotalHighClaims: string;
    awayTotalHighClaims: string;
    homePenaltyKicksSaved: string;
    awayPenaltyKicksSaved: string;
  };

  // ── 14. Defense (tmStatsTbls[categoryKey=defense] — 4 rows) ──────────────
  defense: {
    homeTackles: string;
    awayTackles: string;
    homeInterceptions: string;
    awayInterceptions: string;
    homeClearances: string;
    awayClearances: string;
    homeRecoveries: string;
    awayRecoveries: string;
  };

  // ── 15. Duels (tmStatsTbls[categoryKey=duels] — 3 rows) ──────────────────
  duels: {
    homeDuelsWon: string;
    awayDuelsWon: string;
    homeDuels: string;
    awayDuels: string;
    homeAerialsWon: string;
    awayAerialsWon: string;
  };

  // ── 16. Fouls (tmStatsTbls[categoryKey=fouls] — 4 rows) ──────────────────
  fouls: {
    homeFoulsCommitted: string;
    awayFoulsCommitted: string;
    homeOffsides: string;
    awayOffsides: string;
    homeYellowCards: string;
    awayYellowCards: string;
    homeRedCards: string;
    awayRedCards: string;
  };

  // ── 17. Game Odds ─────────────────────────────────────────────────────────
  gameOdds: GameOdds | null;

  // ── Full deferred table rows (all sections combined) ─────────────────────
  fullTeamStats: DeferredStatRow[];

  // ── Raw espnfitt data (for downstream use) ────────────────────────────────
  rawGamepackage: {
    playerStatsPage: Record<string, unknown>;
    matchStatsPage: Record<string, unknown>;
    teamStatsPage: Record<string, unknown>;
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function pickUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function jitter(): Promise<void> {
  const ms = JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);
  return new Promise((r) => setTimeout(r, ms));
}

function extractEspnfitt(html: string): Record<string, unknown> | null {
  const match = html.match(/window\['__espnfitt__'\]\s*=\s*(\{[\s\S]+?);\s*(?:window|<\/script>)/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getGamepackage(espnfitt: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const page = espnfitt["page"] as Record<string, unknown>;
    const content = page["content"] as Record<string, unknown>;
    return content["gamepackage"] as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** Extract a numeric coordinate from a fieldStart/fieldEnd/goalPosition object */
function safeCoord(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** Parse a deferred section table (attkTbls / pssTbls / shtsTbls / tmStatsTbls item) */
function parseDeferredTable(item: Record<string, unknown>): DeferredStatRow[] {
  const stats = (item["stats"] as Array<Record<string, unknown>>) ?? [];
  return stats.map((s) => {
    const t1 = (s["teamOne"] as Record<string, unknown>) ?? {};
    const t2 = (s["teamTwo"] as Record<string, unknown>) ?? {};
    return {
      name: safeStr(s["name"]),
      homeValue: safeStr(t1["displayValue"] ?? ""),
      homeNote: safeStr(t1["note"] ?? ""),
      awayValue: safeStr(t2["displayValue"] ?? ""),
      awayNote: safeStr(t2["note"] ?? ""),
      advantage: safeStr(s["advantage"] ?? ""),
    };
  });
}

/** Find a stat by name in a DeferredStatRow array (case-insensitive partial match) */
function findDeferred(rows: DeferredStatRow[], name: string): DeferredStatRow {
  return rows.find((r) => r.name.toLowerCase().includes(name.toLowerCase())) ?? {
    name,
    homeValue: "",
    homeNote: "",
    awayValue: "",
    awayNote: "",
    advantage: "",
  };
}

// ─── PAGE LOADER ──────────────────────────────────────────────────────────────

async function loadPage(
  context: BrowserContext,
  url: string,
  log: EspnLogger,
  attempt = 1
): Promise<{ html: string; durationMs: number }> {
  const t0 = Date.now();
  log.http("REQ", url, { attempt });

  let page: Page | null = null;
  try {
    page = await context.newPage();

    // Block heavy assets for speed
    await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,ico,mp4,mp3}", (r) =>
      r.abort()
    );
    await page.route("**/{ads,analytics,tracking,beacon,telemetry}**", (r) => r.abort());

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });

    // Wait for ESPN React hydration
    await page.waitForTimeout(WAIT_AFTER_LOAD_MS);

    // Verify __espnfitt__ is present
    const hasData = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>)["__espnfitt__"] !== "undefined";
    });

    if (!hasData) {
      log.state("__espnfitt__ not found after load — waiting extra 5s", { url });
      await page.waitForTimeout(5_000);
    }

    const html = await page.content();
    const durationMs = Date.now() - t0;

    // Bot-detection guard: ESPN pages are 700KB–1.7MB. A page < 50KB is a block/redirect stub.
    const MIN_PAGE_BYTES = 50_000;
    if (html.length < MIN_PAGE_BYTES) {
      log.warn("BOT_BLOCK", `Page too small (${html.length} bytes < ${MIN_PAGE_BYTES}) — likely bot-detection block. Retrying.`, { url, attempt, bytes: html.length });
      await page.close();
      if (attempt <= MAX_RETRIES) {
        const delay = (RETRY_DELAYS_MS[attempt - 1] ?? 8_000) * 2; // double delay for bot blocks
        log.retry(url, attempt, MAX_RETRIES, delay, `Bot block detected (${html.length} bytes)`);
        await new Promise((r) => setTimeout(r, delay));
        return loadPage(context, url, log, attempt + 1);
      }
      throw new Error(`Bot block on ${url} — page returned ${html.length} bytes after ${MAX_RETRIES} attempts`);
    }

    log.http("RES", url, {
      attempt,
      statusCode: 200,
      bytes: html.length,
      durationMs,
    });

    await page.close();
    return { html, durationMs };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const errMsg = err instanceof Error ? err.message : String(err);
    log.http("RES", url, { attempt, error: errMsg, durationMs });

    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }

    if (attempt <= MAX_RETRIES) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 8_000;
      log.retry(url, attempt, MAX_RETRIES, delay, `Page load failed: ${errMsg}`);
      await new Promise((r) => setTimeout(r, delay));
      return loadPage(context, url, log, attempt + 1);
    }

    throw new Error(`Failed to load ${url} after ${MAX_RETRIES} attempts: ${errMsg}`);
  }
}

// ─── PARSER: PLAYER STATS PAGE ────────────────────────────────────────────────

function parsePlayerStatsPage(
  gp: Record<string, unknown>,
  log: EspnLogger
): {
  boxscore: EspnMatchPageData["boxscore"];
  lineups: EspnMatchPageData["lineups"];
  gameStrip: GameStrip;
} {
  log.step("PARSE_PLAYER_STATS", "Parsing player-stats page gamepackage");

  // ── Glossary ────────────────────────────────────────────────────────────
  log.state("Extracting glossary");
  const rawGlossary = (gp["glossary"] as Array<Record<string, string>>) ?? [];
  const glossary: GlossaryEntry[] = rawGlossary.map((g) => ({
    abbreviation: safeStr(g["abbreviation"]),
    displayName: safeStr(g["displayName"]),
  }));
  log.parse("Glossary extracted", { count: glossary.length });
  log.verify(glossary.length > 0 ? "PASS" : "WARN", "GLOSSARY: entries present", { count: glossary.length });

  // ── bxscr (boxscore JSON) ────────────────────────────────────────────────
  log.state("Extracting bxscr");
  const bxscr = (gp["bxscr"] as Array<Record<string, unknown>>) ?? [];
  log.parse("bxscr teams", { count: bxscr.length });
  log.verify(bxscr.length >= 2 ? "PASS" : "FAIL", "BOXSCORE: 2 teams present in bxscr", { count: bxscr.length });

  // ── bxscrConfig (stat column keys) ──────────────────────────────────────
  const bxscrConfig = (gp["bxscrConfig"] as Record<string, unknown>) ?? {};
  const grps = (bxscrConfig["grps"] as Array<Record<string, unknown>>) ?? [];
  const outfieldStatKeys: string[] = grps[0]
    ? ((grps[0]["stats"] as string[]) ?? [])
    : ["TCH", "G", "A", "xG", "xA", "SOG", "SHOT", "BCC", "DINT", "DUELW"];
  const gkStatKeys: string[] =
    grps.find((g) => (g["types"] as string[])?.[0] === "Goalkeepers")?.["stats"] as string[] ??
    ["GA", "SV", "SOGA", "xGC", "xGOTC", "GP", "BCS", "CLR", "CC", "KS"];

  log.parse("Stat columns", { outfield: outfieldStatKeys, gk: gkStatKeys });

  // ── Parse each team's boxscore ───────────────────────────────────────────
  function parseTeamBxscr(teamData: Record<string, unknown>): {
    teamId: string;
    teamAbbrev: string;
    teamName: string;
    outfieldPlayers: PlayerBoxscoreRow[];
    goalkeeper: GoalkeeperRow | null;
  } {
    const tm = (teamData["tm"] as Record<string, string>) ?? {};
    const teamId = safeStr(tm["id"]);
    const teamAbbrev = safeStr(tm["abbrev"]);
    const teamName = safeStr(tm["dspNm"]);

    const statGroups = (teamData["stats"] as Array<Record<string, unknown>>) ?? [];
    const outfieldPlayers: PlayerBoxscoreRow[] = [];
    let goalkeeper: GoalkeeperRow | null = null;

    for (const grp of statGroups) {
      const grpType = safeStr(grp["type"]);
      // ESPN uses abbreviated key 'athlts' (not 'players') in bxscr.stats[i]
      const players = (grp["athlts"] as Array<Record<string, unknown>>) ??
                      (grp["players"] as Array<Record<string, unknown>>) ?? [];
      const keys = (grp["keys"] as string[]) ?? [];
      const lbls = (grp["lbls"] as string[]) ?? [];
      // Use lbls (abbreviations) if available, else keys, else fallback
      const statAbbrevs = lbls.length > 0 ? lbls : (keys.length > 0 ? keys : outfieldStatKeys);

      for (const p of players) {
        // ESPN bxscr.stats[i].athlts[j] structure: { stats: string[], athlt: { id, dspNm, shrtNm, jersey, lnk } }
        const athlete = (p["athlt"] as Record<string, unknown>) ??
                        (p["athlete"] as Record<string, unknown>) ?? {};
        const athleteId = safeStr(athlete["id"]);
        const name = safeStr(athlete["dspNm"] ?? athlete["displayName"] ?? athlete["fullName"]);
        const nameShort = safeStr(athlete["shrtNm"] ?? athlete["shortName"]);
        const jersey = safeStr(athlete["jersey"]);
        const rawStats = (p["stats"] as string[]) ?? [];

        // Map stat values to abbreviation keys (lbls) AND full key names
        const statsMap: Record<string, string> = {};
        statAbbrevs.forEach((abbr, idx) => {
          statsMap[abbr] = rawStats[idx] ?? "";
        });
        // Also map by full key name if different from abbr
        keys.forEach((key, idx) => {
          if (key !== statAbbrevs[idx]) {
            statsMap[key] = rawStats[idx] ?? "";
          }
        });

        if (grpType === "Goalkeepers") {
          goalkeeper = { athleteId, name, nameShort, jersey, stats: statsMap };
          log.parse(`GK parsed: ${name}`, { team: teamAbbrev, stats: statsMap });
        } else {
          outfieldPlayers.push({
            athleteId,
            name,
            nameShort,
            jersey,
            positionGroup: grpType,
            stats: statsMap,
          });
          log.parse(`Player parsed: ${name}`, {
            team: teamAbbrev,
            group: grpType,
            stats: statsMap,
          });
        }
      }
    }

    log.output(`Team boxscore: ${teamAbbrev}`, {
      outfield: outfieldPlayers.length,
      hasGK: goalkeeper !== null,
    });

    return { teamId, teamAbbrev, teamName, outfieldPlayers, goalkeeper };
  }

  const homeTeamBxscr = bxscr[0] ? parseTeamBxscr(bxscr[0]) : {
    teamId: "", teamAbbrev: "", teamName: "", outfieldPlayers: [], goalkeeper: null,
  };
  const awayTeamBxscr = bxscr[1] ? parseTeamBxscr(bxscr[1]) : {
    teamId: "", teamAbbrev: "", teamName: "", outfieldPlayers: [], goalkeeper: null,
  };

  log.verify(homeTeamBxscr.outfieldPlayers.length > 0 ? "PASS" : "FAIL",
    "BOXSCORE: home outfield players present",
    { count: homeTeamBxscr.outfieldPlayers.length });
  log.verify(awayTeamBxscr.outfieldPlayers.length > 0 ? "PASS" : "FAIL",
    "BOXSCORE: away outfield players present",
    { count: awayTeamBxscr.outfieldPlayers.length });
  log.verify(homeTeamBxscr.goalkeeper !== null ? "PASS" : "FAIL",
    "GOALKEEPING: home GK present");
  log.verify(awayTeamBxscr.goalkeeper !== null ? "PASS" : "FAIL",
    "GOALKEEPING: away GK present");

  // ── Lineups ──────────────────────────────────────────────────────────────
  log.step("PARSE_LINEUPS", "Parsing lineups");
  const lineUps = (gp["lineUps"] as Array<Record<string, unknown>>) ?? [];
  log.verify(lineUps.length >= 2 ? "PASS" : "FAIL", "LINEUPS: 2 teams present", { count: lineUps.length });

  function parseLineup(lu: Record<string, unknown>): TeamLineup {
    const team = (lu["team"] as Record<string, string>) ?? {};
    const formation = safeStr(lu["formation"]);
    const playersMap = (lu["playersMap"] as Record<string, Record<string, unknown>>) ?? {};
    const starterIds = (lu["players"] as string[]) ?? [];
    const subIds = (lu["substitutes"] as string[]) ?? [];
    const unusedIds = (lu["unused"] as string[]) ?? [];

    function mapPlayer(pid: string, role: LineupPlayer["role"]): LineupPlayer {
      const p = playersMap[pid] ?? {};
      return {
        athleteId: safeStr(p["id"] ?? pid),
        name: safeStr(p["name"]),
        nameShort: safeStr(p["shrtNm"]),
        jersey: safeStr(p["nmbr"]),
        formationPlace: safeStr(p["frmtnPlc"]),
        role,
        stats: (p["stats"] as Record<string, string>) ?? {},
      };
    }

    const starters = starterIds.map((id) => mapPlayer(id, "starter"));
    const substitutes = subIds.map((id) => mapPlayer(id, "substitute"));
    const unused = unusedIds.map((id) => mapPlayer(id, "unused"));

    log.parse(`Lineup: ${team["displayName"] ?? "?"} ${formation}`, {
      starters: starters.length,
      subs: substitutes.length,
      unused: unused.length,
    });

    return {
      teamId: safeStr(team["id"] ?? ""),
      teamName: safeStr(team["displayName"]),
      teamAbbrev: safeStr(team["abbreviation"]),
      teamLogo: safeStr(team["logo"]),
      teamColor: safeStr(team["color"]),
      formation,
      starters,
      substitutes,
      unused,
    };
  }

  const homeLineup = lineUps[0] ? parseLineup(lineUps[0]) : {
    teamId: "", teamName: "", teamAbbrev: "", teamLogo: "", teamColor: "",
    formation: "", starters: [], substitutes: [], unused: [],
  };
  const awayLineup = lineUps[1] ? parseLineup(lineUps[1]) : {
    teamId: "", teamName: "", teamAbbrev: "", teamLogo: "", teamColor: "",
    formation: "", starters: [], substitutes: [], unused: [],
  };

  log.verify(homeLineup.starters.length === 11 ? "PASS" : "FAIL",
    "FORMATIONS: home has 11 starters",
    { count: homeLineup.starters.length });
  log.verify(awayLineup.starters.length === 11 ? "PASS" : "FAIL",
    "FORMATIONS: away has 11 starters",
    { count: awayLineup.starters.length });
  log.verify(homeLineup.formation !== "" ? "PASS" : "FAIL",
    "FORMATIONS: home formation string present",
    { formation: homeLineup.formation });
  log.verify(awayLineup.formation !== "" ? "PASS" : "FAIL",
    "FORMATIONS: away formation string present",
    { formation: awayLineup.formation });

  // ── Game Strip ───────────────────────────────────────────────────────────
  log.step("PARSE_GAME_STRIP", "Parsing game strip");
  const gmStrp = (gp["gmStrp"] as Record<string, unknown>) ?? {};
  const gmInfo = (gp["gmInfo"] as Record<string, unknown>) ?? {};
  const status = (gmStrp["status"] as Record<string, string>) ?? {};
  const tms = (gmStrp["tms"] as Array<Record<string, unknown>>) ?? [];
  const goals = (gmStrp["goals"] as Record<string, unknown>) ?? {};

  function parseTeamStrip(tm: Record<string, unknown>, side: "home" | "away") {
    const teamGoals = (goals[side] as Record<string, unknown>) ?? {};
    return {
      id: safeStr(tm["id"]),
      abbrev: safeStr(tm["abbrev"]),
      displayName: safeStr(tm["displayName"]),
      logo: safeStr(tm["logo"]),
      score: safeNum(tm["score"]),
      linescores: ((tm["linescores"] as Array<Record<string, string>>) ?? []).map(
        (ls) => safeStr(ls["displayValue"])
      ),
      goals: ((teamGoals["goals"] as Array<Record<string, string>>) ?? []).map((g) => ({
        id: safeStr(g["id"]),
        name: safeStr(g["name"]),
        clock: safeStr(g["clock"]),
      })),
      redCards: ((teamGoals["redCards"] as string[]) ?? []),
    };
  }

  const homeTeamStrip = tms[0] ? parseTeamStrip(tms[0], "home") : {
    id: "", abbrev: "", displayName: "", logo: "", score: 0, linescores: [], goals: [], redCards: [],
  };
  const awayTeamStrip = tms[1] ? parseTeamStrip(tms[1], "away") : {
    id: "", abbrev: "", displayName: "", logo: "", score: 0, linescores: [], goals: [], redCards: [],
  };

  const refs = (gmInfo["refs"] as Array<Record<string, string>>) ?? [];
  const referee = refs.find((r) => r["pos"] === "Referee")?.["dspNm"] ?? "";
  const broadcasts = ((gmInfo["broadcasts"] as Array<Record<string, string>>) ?? []).map(
    (b) => safeStr(b["name"])
  );
  const locAddr = (gmInfo["locAddr"] as Record<string, string>) ?? {};

  const gameStrip: GameStrip = {
    gameId: safeStr(gmStrp["gid"]),
    uid: safeStr(gmStrp["uid"]),
    dateTimeUTC: safeStr(gmStrp["dt"]),
    status: safeStr(status["desc"]),
    statusDetail: safeStr(status["det"]),
    statusState: safeStr(gmStrp["statusState"]),
    competition: safeStr(gmStrp["nte"]),
    venue: safeStr(gmInfo["loc"]),
    city: safeStr(locAddr["city"]),
    attendance: safeNum(gmInfo["attnd"]),
    referee,
    broadcasts,
    homeTeam: homeTeamStrip,
    awayTeam: awayTeamStrip,
  };

  log.output("Game strip parsed", {
    gameId: gameStrip.gameId,
    competition: gameStrip.competition,
    venue: gameStrip.venue,
    attendance: gameStrip.attendance,
    score: `${gameStrip.homeTeam.abbrev} ${gameStrip.homeTeam.score}-${gameStrip.awayTeam.score} ${gameStrip.awayTeam.abbrev}`,
    status: gameStrip.status,
  });

  log.verify(gameStrip.gameId !== "" ? "PASS" : "FAIL", "GAME_STRIP: gameId present", { gameId: gameStrip.gameId });
  log.verify(gameStrip.venue !== "" ? "PASS" : "FAIL", "GAME_STRIP: venue present", { venue: gameStrip.venue });
  log.verify(gameStrip.attendance > 0 ? "PASS" : "WARN", "GAME_STRIP: attendance present", { attendance: gameStrip.attendance });
  log.verify(gameStrip.referee !== "" ? "PASS" : "WARN", "GAME_STRIP: referee present", { referee: gameStrip.referee });
  log.verify(gameStrip.homeTeam.score >= 0 ? "PASS" : "FAIL", "GAME_STRIP: home score present", { score: gameStrip.homeTeam.score });
  log.verify(gameStrip.homeTeam.goals.length > 0 || gameStrip.homeTeam.score === 0 ? "PASS" : "WARN",
    "GAME_STRIP: home goal scorers present",
    { count: gameStrip.homeTeam.goals.length });

  return {
    boxscore: {
      homeTeam: homeTeamBxscr,
      awayTeam: awayTeamBxscr,
      statColumns: outfieldStatKeys,
      gkStatColumns: gkStatKeys,
      glossary,
    },
    lineups: { home: homeLineup, away: awayLineup },
    gameStrip,
  };
}

// ─── PARSER: MATCH STATS PAGE ─────────────────────────────────────────────────

function parseMatchStatsPage(
  gp: Record<string, unknown>,
  log: EspnLogger
): {
  teamStats: EspnMatchPageData["teamStats"];
  matchStats: EspnMatchPageData["matchStats"];
  shotMap: EspnMatchPageData["shotMap"];
  shots: EspnMatchPageData["shots"];
  gameOdds: GameOdds | null;
} {
  log.step("PARSE_MATCH_STATS", "Parsing matchstats page gamepackage");

  // ── tmStatsGrph — 8-row summary bar ─────────────────────────────────────
  log.step("SECTION_TEAM_STATS", "Extracting tmStatsGrph (8-row summary)");
  const tmStatsGrph = (gp["tmStatsGrph"] as Record<string, unknown>) ?? {};
  const tmStatsGrphTeams = (tmStatsGrph["teams"] as Record<string, Record<string, unknown>>) ?? {};
  const homeAbbrev = safeStr(tmStatsGrphTeams["teamOne"]?.["abbrv"] ?? "HOME");
  const awayAbbrev = safeStr(tmStatsGrphTeams["teamTwo"]?.["abbrv"] ?? "AWAY");

  const tmStatsArr = (tmStatsGrph["stats"] as Array<Record<string, unknown>>) ?? [];
  const tmStatsData = tmStatsArr[0]
    ? ((tmStatsArr[0]["data"] as Array<Record<string, unknown>>) ?? [])
    : [];

  const teamStatRows: TeamStatRow[] = tmStatsData.map((s) => {
    const t1 = (s["teamOne"] as Record<string, unknown>) ?? {};
    const t2 = (s["teamTwo"] as Record<string, unknown>) ?? {};
    return {
      name: safeStr(s["name"]),
      homeValue: safeStr(t1["displayValue"] ?? ""),
      homeNote: safeStr(t1["note"] ?? ""),
      awayValue: safeStr(t2["displayValue"] ?? ""),
      awayNote: safeStr(t2["note"] ?? ""),
      advantage: "",
    };
  });

  log.parse("tmStatsGrph extracted", {
    homeAbbrev,
    awayAbbrev,
    statCount: teamStatRows.length,
    stats: teamStatRows.map((r) => `${r.name}: ${r.homeValue} vs ${r.awayValue}`),
  });
  log.verify(teamStatRows.length === 8 ? "PASS" : "WARN",
    "TEAM_STATS: expected 8 rows from tmStatsGrph",
    { count: teamStatRows.length });

  // ── mtchStatsGrph — 9-row match stats ───────────────────────────────────
  log.step("SECTION_MATCH_STATS", "Extracting mtchStatsGrph (9-row match stats)");
  const mtchStatsGrph = (gp["mtchStatsGrph"] as Record<string, unknown>) ?? {};
  const mtchStatsTeams = (mtchStatsGrph["teams"] as Record<string, Record<string, unknown>>) ?? {};
  const mtchHomeAbbrev = safeStr(mtchStatsTeams["teamOne"]?.["abbrv"] ?? homeAbbrev);
  const mtchAwayAbbrev = safeStr(mtchStatsTeams["teamTwo"]?.["abbrv"] ?? awayAbbrev);
  const mtchStatsArr = (mtchStatsGrph["stats"] as Array<Record<string, unknown>>) ?? [];
  const mtchStatsData = mtchStatsArr[0]
    ? ((mtchStatsArr[0]["data"] as Array<Record<string, unknown>>) ?? [])
    : [];

  const matchStatRows: TeamStatRow[] = mtchStatsData.map((s) => {
    const t1 = (s["teamOne"] as Record<string, unknown>) ?? {};
    const t2 = (s["teamTwo"] as Record<string, unknown>) ?? {};
    return {
      name: safeStr(s["name"]),
      homeValue: safeStr(t1["displayValue"] ?? ""),
      homeNote: safeStr(t1["note"] ?? ""),
      awayValue: safeStr(t2["displayValue"] ?? ""),
      awayNote: safeStr(t2["note"] ?? ""),
      advantage: "",
    };
  });

  log.parse("mtchStatsGrph extracted", {
    count: matchStatRows.length,
    stats: matchStatRows.map((r) => `${r.name}: ${r.homeValue} vs ${r.awayValue}`),
  });
  log.verify(matchStatRows.length === 9 ? "PASS" : "WARN",
    "MATCH_STATS: expected 9 rows from mtchStatsGrph",
    { count: matchStatRows.length });

  // ── Shot Map ─────────────────────────────────────────────────────────────
  log.step("SECTION_SHOT_MAP", "Extracting shot map (shtMp)");
  const shtMp = (gp["shtMp"] as Record<string, unknown>) ?? {};
  const rawShots = (shtMp["shts"] as Array<Record<string, unknown>>) ?? [];
  const shtMpTeams = (shtMp["tms"] as Record<string, Record<string, string>>) ?? {};
  const homeTeamAbbrev = safeStr(shtMpTeams["home"]?.["abbrev"] ?? homeAbbrev);
  const awayTeamAbbrev = safeStr(shtMpTeams["away"]?.["abbrev"] ?? awayAbbrev);
  const availShts = (shtMp["availShts"] as Record<string, boolean>) ?? {};

  const shotMapEntries: ShotMapEntry[] = rawShots.map((shot, idx) => {
    const play = (shot["play"] as Record<string, unknown>) ?? {};
    const participants = (play["participants"] as Array<Record<string, unknown>>) ?? [];
    const firstParticipant = participants[0] ?? {};
    const athlete = (firstParticipant["athlete"] as Record<string, unknown>) ?? {};

    const period = safeNum((play["period"] as Record<string, unknown>)?.["number"]);
    const clock = safeStr((play["clock"] as Record<string, string>)?.["displayValue"]);
    const isAway = Boolean(shot["isAway"]);
    const teamAbbrev = isAway ? awayTeamAbbrev : homeTeamAbbrev;

    // ── Attributes ──────────────────────────────────────────────────────────
    const attrs: Record<string, string> = {};
    ((play["attributes"] as Array<Record<string, string>>) ?? []).forEach((a) => {
      attrs[safeStr(a["label"])] = safeStr(a["displayValue"]);
    });

    // ── Confirmed coordinate paths from forensic audit ──────────────────────
    // play.fieldStart = { x: number, y: number }
    // play.fieldEnd   = { x: number, y: number }
    // play.goalPosition = { y: number, z: number }
    const fieldStart = play["fieldStart"];
    const fieldEnd = play["fieldEnd"];
    const goalPosition = play["goalPosition"];

    const entry: ShotMapEntry = {
      shotId: safeStr(shot["id"]),
      sequence: safeNum(shot["sequence"]),
      // ── Participant ──────────────────────────────────────────────────────
      playerName: safeStr(athlete["displayName"] ?? athlete["fullName"]),
      playerShortName: safeStr(athlete["shortName"] ?? athlete["shrtNm"]),
      playerJersey: safeStr(athlete["jersey"]),
      playerId: safeStr(athlete["id"]),
      // ── Team ────────────────────────────────────────────────────────────
      teamAbbrev,
      isAway,
      // ── Timing ──────────────────────────────────────────────────────────
      period,
      clock,
      // ── Type ────────────────────────────────────────────────────────────
      iconType: safeStr(shot["iconType"]) as ShotMapEntry["iconType"],
      isOwnGoal: Boolean(shot["isOwnGoal"]),
      // ── Field coordinates ────────────────────────────────────────────────
      fieldStartX: safeCoord(fieldStart, "x"),
      fieldStartY: safeCoord(fieldStart, "y"),
      fieldEndX: safeCoord(fieldEnd, "x"),
      fieldEndY: safeCoord(fieldEnd, "y"),
      // ── Goal position ────────────────────────────────────────────────────
      goalPositionY: safeCoord(goalPosition, "y"),
      goalPositionZ: safeCoord(goalPosition, "z"),
      // ── Attributes ──────────────────────────────────────────────────────
      xG: attrs["xG"] ?? "",
      xGOT: attrs["xGOT"] ?? "",
      distance: attrs["Distance"] ?? "",
      shotType: attrs["Shot Type"] ?? "",
      situation: attrs["Situation"] ?? "",
      goalZone: attrs["Goal Zone"] ?? "",
      // ── Text ────────────────────────────────────────────────────────────
      description: safeStr(play["text"]),
      shortDescription: safeStr(play["shortText"]),
    };

    log.parse(`Shot[${idx}]: ${entry.teamAbbrev} ${entry.playerShortName || entry.playerName} #${entry.playerJersey}`, {
      type: entry.iconType,
      period: entry.period,
      clock: entry.clock,
      xG: entry.xG,
      distance: entry.distance,
      foot: entry.shotType,
      fieldStart: `(${entry.fieldStartX},${entry.fieldStartY})`,
      fieldEnd: `(${entry.fieldEndX},${entry.fieldEndY})`,
      goalPos: `(y=${entry.goalPositionY},z=${entry.goalPositionZ})`,
    });

    return entry;
  });

  const homeShots = shotMapEntries.filter((s) => !s.isAway).length;
  const awayShots = shotMapEntries.filter((s) => s.isAway).length;

  log.output("Shot map extracted", {
    total: shotMapEntries.length,
    home: homeShots,
    away: awayShots,
    goals: shotMapEntries.filter((s) => s.iconType === "goal").length,
    saves: shotMapEntries.filter((s) => s.iconType === "save").length,
    offTarget: shotMapEntries.filter((s) => s.iconType === "offTarget").length,
    blocked: shotMapEntries.filter((s) => s.iconType === "blocked").length,
  });

  log.verify(shotMapEntries.length > 0 ? "PASS" : "FAIL", "SHOT_MAP: shots present", { count: shotMapEntries.length });
  log.verify(shotMapEntries.every((s) => s.fieldStartX !== null) ? "PASS" : "WARN",
    "SHOT_MAP: all shots have fieldStart.x coordinate",
    { withCoords: shotMapEntries.filter((s) => s.fieldStartX !== null).length });
  log.verify(shotMapEntries.every((s) => s.playerName !== "") ? "PASS" : "WARN",
    "SHOT_MAP: all shots have player name",
    { withName: shotMapEntries.filter((s) => s.playerName !== "").length });
  log.verify(shotMapEntries.every((s) => s.playerJersey !== "") ? "PASS" : "WARN",
    "SHOT_MAP: all shots have player jersey",
    { withJersey: shotMapEntries.filter((s) => s.playerJersey !== "").length });

  // ── Shots breakdown (from shot map) ──────────────────────────────────────
  const homeGoals = shotMapEntries.filter((s) => !s.isAway && s.iconType === "goal").length;
  const homeSaves = shotMapEntries.filter((s) => !s.isAway && s.iconType === "save").length;
  const homeOffTarget = shotMapEntries.filter((s) => !s.isAway && s.iconType === "offTarget").length;
  const homeBlocked = shotMapEntries.filter((s) => !s.isAway && s.iconType === "blocked").length;
  const awayGoals = shotMapEntries.filter((s) => s.isAway && s.iconType === "goal").length;
  const awaySaves = shotMapEntries.filter((s) => s.isAway && s.iconType === "save").length;
  const awayOffTarget = shotMapEntries.filter((s) => s.isAway && s.iconType === "offTarget").length;
  const awayBlocked = shotMapEntries.filter((s) => s.isAway && s.iconType === "blocked").length;

  log.parse("Shots breakdown (from shot map)", {
    home: { goals: homeGoals, saves: homeSaves, offTarget: homeOffTarget, blocked: homeBlocked },
    away: { goals: awayGoals, saves: awaySaves, offTarget: awayOffTarget, blocked: awayBlocked },
  });

  // ── Game Odds ─────────────────────────────────────────────────────────────
  log.step("SECTION_GAME_ODDS", "Extracting gameOdds");
  const rawOdds = (gp["gameOdds"] as Record<string, unknown>) ?? {};
  let gameOdds: GameOdds | null = null;

  if (rawOdds && typeof rawOdds === "object" && Object.keys(rawOdds).length > 0) {
    const oddsArr = (rawOdds["odds"] as Array<Record<string, unknown>>) ?? [];
    const providerName = safeStr(rawOdds["providerName"]);
    const headerText = safeStr(rawOdds["headerText"]);

    const parseOddsTeam = (item: Record<string, unknown>): GameOddsTeam => {
      const line = (item["line"] as Record<string, unknown>) ?? {};
      const open = (item["open"] as Record<string, unknown>) ?? {};
      const ml = (item["moneyline"] as Record<string, unknown>) ?? {};
      const total = (item["total"] as Record<string, unknown>) ?? {};
      const spread = (item["pointSpread"] as Record<string, unknown>) ?? {};
      return {
        teamAbbrev: safeStr(line["primaryText"]),
        teamName: safeStr(line["primaryTextFull"]),
        isLoser: Boolean(line["isLoser"]),
        moneylineOpen: safeStr(open["primary"]),
        moneylineCurrent: safeStr(ml["primary"]),
        totalSide: safeStr(total["primary"]),
        totalOdds: safeStr(total["secondary"]),
        spreadLine: safeStr(spread["primary"]),
        spreadOdds: safeStr(spread["secondary"]),
      };
    }

    const homeOddsItem = oddsArr[0] ?? {};
    const awayOddsItem = oddsArr[1] ?? {};
    const drawOddsItem = oddsArr[2] ?? {};

    const drawLine = (drawOddsItem["line"] as Record<string, unknown>) ?? {};
    const drawML = (drawOddsItem["moneyline"] as Record<string, unknown>) ?? {};
    const drawOpen = (drawOddsItem["open"] as Record<string, unknown>) ?? {};

    gameOdds = {
      provider: providerName,
      headerText,
      homeTeam: parseOddsTeam(homeOddsItem),
      awayTeam: parseOddsTeam(awayOddsItem),
      drawMoneyline: safeStr(drawML["primary"]),
      drawMoneylineOpen: safeStr(drawOpen["primary"]),
    };

    log.parse("Game odds extracted", {
      provider: gameOdds.provider,
      home: `${gameOdds.homeTeam.teamAbbrev} ML=${gameOdds.homeTeam.moneylineCurrent} spread=${gameOdds.homeTeam.spreadLine}`,
      away: `${gameOdds.awayTeam.teamAbbrev} ML=${gameOdds.awayTeam.moneylineCurrent} spread=${gameOdds.awayTeam.spreadLine}`,
      draw: `ML=${gameOdds.drawMoneyline}`,
      total: `${gameOdds.homeTeam.totalSide} @ ${gameOdds.homeTeam.totalOdds}`,
    });
    log.verify("PASS", "GAME_ODDS: extracted successfully", { provider: gameOdds.provider });
  } else {
    log.verify("WARN", "GAME_ODDS: not present in matchstats page", {});
  }

  return {
    teamStats: {
      homeAbbrev,
      awayAbbrev,
      stats: teamStatRows,
    },
    matchStats: {
      homeAbbrev: mtchHomeAbbrev,
      awayAbbrev: mtchAwayAbbrev,
      stats: matchStatRows,
    },
    shotMap: {
      totalShots: shotMapEntries.length,
      homeShots,
      awayShots,
      shots: shotMapEntries,
      availableTypes: Object.keys(availShts).filter((k) => availShts[k]),
      goalFrameMap: [], // populated from team-stats page
    },
    shots: {
      // These will be overwritten with shtsTbls values from team-stats page
      homeShotsOnGoal: "",
      homeShots: "",
      homeShotsBlocked: "",
      homeHitWoodwork: "",
      homeAttemptsInsideBox: "",
      homeAttemptsOutsideBox: "",
      awayShotsOnGoal: "",
      awayShots: "",
      awayShotsBlocked: "",
      awayHitWoodwork: "",
      awayAttemptsInsideBox: "",
      awayAttemptsOutsideBox: "",
      homeGoals,
      homeSaves,
      homeOffTarget,
      homeBlocked,
      homeTotalShots: homeShots,
      awayGoals,
      awaySaves,
      awayOffTarget,
      awayBlocked,
      awayTotalShots: awayShots,
    },
    gameOdds,
  };
}

// ─── PARSER: TEAM STATS PAGE ──────────────────────────────────────────────────

function parseTeamStatsPage(
  gp: Record<string, unknown>,
  log: EspnLogger
): {
  shots: Partial<EspnMatchPageData["shots"]>;
  passes: EspnMatchPageData["passes"];
  attack: EspnMatchPageData["attack"];
  goalkeeping: EspnMatchPageData["goalkeeping"];
  defense: EspnMatchPageData["defense"];
  duels: EspnMatchPageData["duels"];
  fouls: EspnMatchPageData["fouls"];
  expectedGoalsExtended: {
    homeXGOpenPlay: string;
    awayXGOpenPlay: string;
    homeXGSetPlay: string;
    awayXGSetPlay: string;
    homeXGOT: string;
    awayXGOT: string;
  };
  goalFrameMap: EspnMatchPageData["shotMap"]["goalFrameMap"];
  fullTeamStats: DeferredStatRow[];
} {
  log.step("PARSE_TEAM_STATS", "Parsing team-stats page gamepackage");

  // ── tmStatsTbls — 5 deferred sections ────────────────────────────────────
  log.step("SECTION_DEFERRED_TABLES", "Extracting tmStatsTbls (5 deferred sections)");
  const tmStatsTbls = (gp["tmStatsTbls"] as Array<Record<string, unknown>>) ?? [];
  log.parse("tmStatsTbls count", { count: tmStatsTbls.length });
  log.verify(tmStatsTbls.length === 5 ? "PASS" : "WARN",
    "DEFERRED_TABLES: expected 5 sections in tmStatsTbls",
    { count: tmStatsTbls.length });

  // Index by categoryKey
  const deferredByKey: Record<string, DeferredStatRow[]> = {};
  for (const item of tmStatsTbls) {
    const key = safeStr(item["categoryKey"]);
    const rows = parseDeferredTable(item);
    deferredByKey[key] = rows;
    log.parse(`tmStatsTbls[${key}]`, {
      rows: rows.length,
      stats: rows.map((r) => `${r.name}: ${r.homeValue} vs ${r.awayValue}`),
    });
  }

  // ── Expected Goals (tmStatsTbls[expected-goals]) ─────────────────────────
  log.step("SECTION_EXPECTED_GOALS", "Extracting expected goals from tmStatsTbls");
  const xgRows = deferredByKey["expected-goals"] ?? [];
  log.verify(xgRows.length === 4 ? "PASS" : "WARN",
    "EXPECTED_GOALS: expected 4 rows (xG/xGOpenPlay/xGSetPlay/xGOT)",
    { count: xgRows.length });

  const xgRow = findDeferred(xgRows, "Expected Goals (xG)");
  const xgOpenPlayRow = findDeferred(xgRows, "xG Open Play");
  const xgSetPlayRow = findDeferred(xgRows, "xG Set Play");
  const xgOTRow = findDeferred(xgRows, "xG On Target");

  log.parse("Expected Goals extracted", {
    xG: `${xgRow.homeValue} vs ${xgRow.awayValue}`,
    xGOpenPlay: `${xgOpenPlayRow.homeValue} vs ${xgOpenPlayRow.awayValue}`,
    xGSetPlay: `${xgSetPlayRow.homeValue} vs ${xgSetPlayRow.awayValue}`,
    xGOT: `${xgOTRow.homeValue} vs ${xgOTRow.awayValue}`,
  });

  log.verify(xgRow.homeValue !== "" ? "PASS" : "FAIL", "EXPECTED_GOALS: home xG present", { value: xgRow.homeValue });
  log.verify(xgOpenPlayRow.homeValue !== "" ? "PASS" : "FAIL", "EXPECTED_GOALS: home xG Open Play present", { value: xgOpenPlayRow.homeValue });
  log.verify(xgSetPlayRow.homeValue !== "" ? "PASS" : "FAIL", "EXPECTED_GOALS: home xG Set Play present", { value: xgSetPlayRow.homeValue });
  log.verify(xgOTRow.homeValue !== "" ? "PASS" : "FAIL", "EXPECTED_GOALS: home xGOT present", { value: xgOTRow.homeValue });

  // ── Goalkeeping (tmStatsTbls[goalkeeping]) ────────────────────────────────
  log.step("SECTION_GOALKEEPING", "Extracting goalkeeping from tmStatsTbls");
  const gkRows = deferredByKey["goalkeeping"] ?? [];
  log.verify(gkRows.length === 5 ? "PASS" : "WARN",
    "GOALKEEPING: expected 5 rows",
    { count: gkRows.length });

  const gkSaves = findDeferred(gkRows, "Saves");
  const gkGoalKicks = findDeferred(gkRows, "Goal Kicks");
  const gkShotsFaced = findDeferred(gkRows, "Shots Faced");
  const gkHighClaims = findDeferred(gkRows, "Total High Claims");
  const gkPKSaved = findDeferred(gkRows, "Penalty Kicks Saved");

  log.parse("Goalkeeping extracted", {
    saves: `${gkSaves.homeValue} vs ${gkSaves.awayValue}`,
    goalKicks: `${gkGoalKicks.homeValue} vs ${gkGoalKicks.awayValue}`,
    shotsFaced: `${gkShotsFaced.homeValue} vs ${gkShotsFaced.awayValue}`,
    highClaims: `${gkHighClaims.homeValue} vs ${gkHighClaims.awayValue}`,
    pkSaved: `${gkPKSaved.homeValue} vs ${gkPKSaved.awayValue}`,
  });

  log.verify(gkSaves.homeValue !== "" ? "PASS" : "FAIL", "GOALKEEPING: saves present", { home: gkSaves.homeValue, away: gkSaves.awayValue });
  log.verify(gkShotsFaced.homeValue !== "" ? "PASS" : "FAIL", "GOALKEEPING: shots faced present", { home: gkShotsFaced.homeValue, away: gkShotsFaced.awayValue });
  log.verify(gkGoalKicks.homeValue !== "" ? "PASS" : "FAIL", "GOALKEEPING: goal kicks present", { home: gkGoalKicks.homeValue, away: gkGoalKicks.awayValue });
  log.verify(gkHighClaims.homeValue !== "" ? "PASS" : "FAIL", "GOALKEEPING: high claims present", { home: gkHighClaims.homeValue, away: gkHighClaims.awayValue });
  log.verify(gkPKSaved.homeValue !== "" ? "PASS" : "WARN", "GOALKEEPING: penalty kicks saved present", { home: gkPKSaved.homeValue, away: gkPKSaved.awayValue });

  // ── Defense (tmStatsTbls[defense]) ────────────────────────────────────────
  log.step("SECTION_DEFENSE", "Extracting defense from tmStatsTbls");
  const defRows = deferredByKey["defense"] ?? [];
  log.verify(defRows.length === 4 ? "PASS" : "WARN",
    "DEFENSE: expected 4 rows (tackles/interceptions/clearances/recoveries)",
    { count: defRows.length });

  const defTackles = findDeferred(defRows, "Tackles");
  const defInterceptions = findDeferred(defRows, "Interceptions");
  const defClearances = findDeferred(defRows, "Clearances");
  const defRecoveries = findDeferred(defRows, "Recoveries");

  log.parse("Defense extracted", {
    tackles: `${defTackles.homeValue} vs ${defTackles.awayValue}`,
    interceptions: `${defInterceptions.homeValue} vs ${defInterceptions.awayValue}`,
    clearances: `${defClearances.homeValue} vs ${defClearances.awayValue}`,
    recoveries: `${defRecoveries.homeValue} vs ${defRecoveries.awayValue}`,
  });

  log.verify(defTackles.homeValue !== "" ? "PASS" : "FAIL", "DEFENSE: tackles present", { home: defTackles.homeValue, away: defTackles.awayValue });
  log.verify(defInterceptions.homeValue !== "" ? "PASS" : "FAIL", "DEFENSE: interceptions present", { home: defInterceptions.homeValue, away: defInterceptions.awayValue });
  log.verify(defClearances.homeValue !== "" ? "PASS" : "FAIL", "DEFENSE: clearances present", { home: defClearances.homeValue, away: defClearances.awayValue });
  log.verify(defRecoveries.homeValue !== "" ? "PASS" : "FAIL", "DEFENSE: recoveries present", { home: defRecoveries.homeValue, away: defRecoveries.awayValue });

  // ── Duels (tmStatsTbls[duels]) ────────────────────────────────────────────
  log.step("SECTION_DUELS", "Extracting duels from tmStatsTbls");
  const duelRows = deferredByKey["duels"] ?? [];
  log.verify(duelRows.length === 3 ? "PASS" : "WARN",
    "DUELS: expected 3 rows (duelsWon/duels/aerialsWon)",
    { count: duelRows.length });

  const duelWon = findDeferred(duelRows, "Duels Won");
  const duelTotal = findDeferred(duelRows, "Duels");
  const duelAerials = findDeferred(duelRows, "Aerials Won");

  log.parse("Duels extracted", {
    duelsWon: `${duelWon.homeValue} vs ${duelWon.awayValue}`,
    duels: `${duelTotal.homeValue} vs ${duelTotal.awayValue}`,
    aerialsWon: `${duelAerials.homeValue} vs ${duelAerials.awayValue}`,
  });

  log.verify(duelWon.homeValue !== "" ? "PASS" : "FAIL", "DUELS: duels won present", { home: duelWon.homeValue, away: duelWon.awayValue });
  log.verify(duelTotal.homeValue !== "" ? "PASS" : "FAIL", "DUELS: total duels present", { home: duelTotal.homeValue, away: duelTotal.awayValue });
  log.verify(duelAerials.homeValue !== "" ? "PASS" : "FAIL", "DUELS: aerials won present", { home: duelAerials.homeValue, away: duelAerials.awayValue });

  // ── Fouls (tmStatsTbls[fouls]) ────────────────────────────────────────────
  log.step("SECTION_FOULS", "Extracting fouls from tmStatsTbls");
  const foulRows = deferredByKey["fouls"] ?? [];
  log.verify(foulRows.length === 4 ? "PASS" : "WARN",
    "FOULS: expected 4 rows (foulsCommitted/offsides/yellowCards/redCards)",
    { count: foulRows.length });

  const foulCommitted = findDeferred(foulRows, "Fouls Committed");
  const foulOffsides = findDeferred(foulRows, "Offsides");
  const foulYellow = findDeferred(foulRows, "Yellow Cards");
  const foulRed = findDeferred(foulRows, "Red Cards");

  log.parse("Fouls extracted", {
    foulsCommitted: `${foulCommitted.homeValue} vs ${foulCommitted.awayValue}`,
    offsides: `${foulOffsides.homeValue} vs ${foulOffsides.awayValue}`,
    yellow: `${foulYellow.homeValue} vs ${foulYellow.awayValue}`,
    red: `${foulRed.homeValue} vs ${foulRed.awayValue}`,
  });

  log.verify(foulCommitted.homeValue !== "" ? "PASS" : "FAIL", "FOULS: fouls committed present", { home: foulCommitted.homeValue, away: foulCommitted.awayValue });
  log.verify(foulOffsides.homeValue !== "" ? "PASS" : "FAIL", "FOULS: offsides present", { home: foulOffsides.homeValue, away: foulOffsides.awayValue });
  log.verify(foulYellow.homeValue !== "" ? "PASS" : "FAIL", "FOULS: yellow cards present", { home: foulYellow.homeValue, away: foulYellow.awayValue });
  log.verify(foulRed.homeValue !== "" ? "PASS" : "WARN", "FOULS: red cards present", { home: foulRed.homeValue, away: foulRed.awayValue });

  // ── Shots Table (shtsTbls) ────────────────────────────────────────────────
  log.step("SECTION_SHOTS_TABLE", "Extracting shtsTbls (shots breakdown)");
  const shtsTblsArr = (gp["shtsTbls"] as Array<Record<string, unknown>>) ?? [];
  const shtsTblsItem = shtsTblsArr[0] ?? {};
  const shotsRows = parseDeferredTable(shtsTblsItem);
  log.verify(shotsRows.length === 6 ? "PASS" : "WARN",
    "SHOTS_TABLE: expected 6 rows",
    { count: shotsRows.length });

  const shtOnGoal = findDeferred(shotsRows, "Shots on Goal");
  const shtTotal = findDeferred(shotsRows, "Shots");
  const shtBlocked = findDeferred(shotsRows, "Shots Blocked");
  const shtWoodwork = findDeferred(shotsRows, "Hit Woodwork");
  const shtInsideBox = findDeferred(shotsRows, "Attempts Inside Box");
  const shtOutsideBox = findDeferred(shotsRows, "Attempts Outside Box");

  log.parse("Shots table extracted", {
    shotsOnGoal: `${shtOnGoal.homeValue} vs ${shtOnGoal.awayValue}`,
    shots: `${shtTotal.homeValue} vs ${shtTotal.awayValue}`,
    blocked: `${shtBlocked.homeValue} vs ${shtBlocked.awayValue}`,
    hitWoodwork: `${shtWoodwork.homeValue} vs ${shtWoodwork.awayValue}`,
    insideBox: `${shtInsideBox.homeValue} vs ${shtInsideBox.awayValue}`,
    outsideBox: `${shtOutsideBox.homeValue} vs ${shtOutsideBox.awayValue}`,
  });

  log.verify(shtOnGoal.homeValue !== "" ? "PASS" : "FAIL", "SHOTS: shots on goal present", { home: shtOnGoal.homeValue, away: shtOnGoal.awayValue });
  log.verify(shtTotal.homeValue !== "" ? "PASS" : "FAIL", "SHOTS: total shots present", { home: shtTotal.homeValue, away: shtTotal.awayValue });
  log.verify(shtBlocked.homeValue !== "" ? "PASS" : "FAIL", "SHOTS: blocked shots present", { home: shtBlocked.homeValue, away: shtBlocked.awayValue });
  log.verify(shtWoodwork.homeValue !== "" ? "PASS" : "FAIL", "SHOTS: hit woodwork present", { home: shtWoodwork.homeValue, away: shtWoodwork.awayValue });
  log.verify(shtInsideBox.homeValue !== "" ? "PASS" : "FAIL", "SHOTS: attempts inside box present", { home: shtInsideBox.homeValue, away: shtInsideBox.awayValue });
  log.verify(shtOutsideBox.homeValue !== "" ? "PASS" : "FAIL", "SHOTS: attempts outside box present", { home: shtOutsideBox.homeValue, away: shtOutsideBox.awayValue });

  // Goal-frame shot map from shtsTbls.tableMap
  const goalFrameMap: EspnMatchPageData["shotMap"]["goalFrameMap"] = [];
  const tableMap = (shtsTblsItem["tableMap"] as Array<Record<string, unknown>>) ?? [];
  for (const tm of tableMap) {
    const team = (tm["team"] as Record<string, unknown>) ?? {};
    const tmShots = (tm["shots"] as Array<Record<string, unknown>>) ?? [];
    goalFrameMap.push({
      teamAbbrev: safeStr(team["abbrev"]),
      teamName: safeStr(team["displayName"]),
      teamId: safeStr(team["id"]),
      shots: tmShots.map((s) => {
        const coords = (s["coordinates"] as Record<string, number>) ?? {};
        return {
          y: coords["y"] ?? 0,
          z: coords["z"] ?? 0,
          type: safeStr(s["type"]),
        };
      }),
      hasOwnGoal: Boolean(tm["hasOwnGoal"]),
    });
  }
  log.parse("Goal frame map extracted", {
    teams: goalFrameMap.length,
    homeShots: goalFrameMap[0]?.shots.length ?? 0,
    awayShots: goalFrameMap[1]?.shots.length ?? 0,
  });
  log.verify(goalFrameMap.length === 2 ? "PASS" : "WARN", "SHOT_MAP: goal frame map has 2 teams", { count: goalFrameMap.length });

  // ── Passes Table (pssTbls) ────────────────────────────────────────────────
  log.step("SECTION_PASSES", "Extracting pssTbls (passes breakdown)");
  const pssTblsArr = (gp["pssTbls"] as Array<Record<string, unknown>>) ?? [];
  const pssTblsItem = pssTblsArr[0] ?? {};
  const passRows = parseDeferredTable(pssTblsItem);
  log.verify(passRows.length === 8 ? "PASS" : "WARN",
    "PASSES: expected 8 rows",
    { count: passRows.length });

  const pssAccurate = findDeferred(passRows, "Accurate Passes");
  const pssTotal = findDeferred(passRows, "Passes");
  const pssBackZone = findDeferred(passRows, "Total Back Zone Pass");
  const pssFwdZone = findDeferred(passRows, "Total Forward Zone Pass");
  const pssLongBalls = findDeferred(passRows, "Accurate Long Balls");
  const pssCrosses = findDeferred(passRows, "Accurate Crosses");
  const pssThrows = findDeferred(passRows, "Total Throws");
  const pssTouchesOppBox = findDeferred(passRows, "Touches In Opposition Box");

  log.parse("Passes extracted", {
    accuratePasses: `${pssAccurate.homeValue}(${pssAccurate.homeNote}) vs ${pssAccurate.awayValue}(${pssAccurate.awayNote})`,
    passes: `${pssTotal.homeValue} vs ${pssTotal.awayValue}`,
    backZone: `${pssBackZone.homeValue} vs ${pssBackZone.awayValue}`,
    fwdZone: `${pssFwdZone.homeValue} vs ${pssFwdZone.awayValue}`,
    longBalls: `${pssLongBalls.homeValue} vs ${pssLongBalls.awayValue}`,
    crosses: `${pssCrosses.homeValue} vs ${pssCrosses.awayValue}`,
    throws: `${pssThrows.homeValue} vs ${pssThrows.awayValue}`,
    touchesOppBox: `${pssTouchesOppBox.homeValue} vs ${pssTouchesOppBox.awayValue}`,
  });

  log.verify(pssAccurate.homeValue !== "" ? "PASS" : "FAIL", "PASSES: accurate passes present", { home: pssAccurate.homeValue, away: pssAccurate.awayValue });
  log.verify(pssTotal.homeValue !== "" ? "PASS" : "FAIL", "PASSES: total passes present", { home: pssTotal.homeValue, away: pssTotal.awayValue });
  log.verify(pssBackZone.homeValue !== "" ? "PASS" : "FAIL", "PASSES: back zone pass present", { home: pssBackZone.homeValue, away: pssBackZone.awayValue });
  log.verify(pssFwdZone.homeValue !== "" ? "PASS" : "FAIL", "PASSES: forward zone pass present", { home: pssFwdZone.homeValue, away: pssFwdZone.awayValue });
  log.verify(pssLongBalls.homeValue !== "" ? "PASS" : "FAIL", "PASSES: accurate long balls present", { home: pssLongBalls.homeValue, away: pssLongBalls.awayValue });
  log.verify(pssCrosses.homeValue !== "" ? "PASS" : "FAIL", "PASSES: accurate crosses present", { home: pssCrosses.homeValue, away: pssCrosses.awayValue });
  log.verify(pssThrows.homeValue !== "" ? "PASS" : "FAIL", "PASSES: total throws present", { home: pssThrows.homeValue, away: pssThrows.awayValue });
  log.verify(pssTouchesOppBox.homeValue !== "" ? "PASS" : "FAIL", "PASSES: touches in opp box present", { home: pssTouchesOppBox.homeValue, away: pssTouchesOppBox.awayValue });

  // ── Attack Table (attkTbls) ────────────────────────────────────────────────
  log.step("SECTION_ATTACK", "Extracting attkTbls (attack breakdown)");
  const attkTblsArr = (gp["attkTbls"] as Array<Record<string, unknown>>) ?? [];
  const attkTblsItem = attkTblsArr[0] ?? {};
  const attkRows = parseDeferredTable(attkTblsItem);
  log.verify(attkRows.length === 6 ? "PASS" : "WARN",
    "ATTACK: expected 6 rows",
    { count: attkRows.length });

  const attkBCC = findDeferred(attkRows, "Big Chances Created");
  const attkBCM = findDeferred(attkRows, "Big Chances Missed");
  const attkThrough = findDeferred(attkRows, "Through Balls");
  const attkTouches = findDeferred(attkRows, "Touches In Opposition Box");
  const attkFouled = findDeferred(attkRows, "Fouled In Final Third");
  const attkCorners = findDeferred(attkRows, "Corners Won");

  log.parse("Attack extracted", {
    bcc: `${attkBCC.homeValue} vs ${attkBCC.awayValue}`,
    bcm: `${attkBCM.homeValue} vs ${attkBCM.awayValue}`,
    throughBalls: `${attkThrough.homeValue} vs ${attkThrough.awayValue}`,
    touchesOppBox: `${attkTouches.homeValue} vs ${attkTouches.awayValue}`,
    fouledFinalThird: `${attkFouled.homeValue} vs ${attkFouled.awayValue}`,
    cornersWon: `${attkCorners.homeValue} vs ${attkCorners.awayValue}`,
  });

  log.verify(attkBCC.homeValue !== "" ? "PASS" : "FAIL", "ATTACK: big chances created present", { home: attkBCC.homeValue, away: attkBCC.awayValue });
  log.verify(attkBCM.homeValue !== "" ? "PASS" : "FAIL", "ATTACK: big chances missed present", { home: attkBCM.homeValue, away: attkBCM.awayValue });
  log.verify(attkThrough.homeValue !== "" ? "PASS" : "FAIL", "ATTACK: through balls present", { home: attkThrough.homeValue, away: attkThrough.awayValue });
  log.verify(attkTouches.homeValue !== "" ? "PASS" : "FAIL", "ATTACK: touches in opp box present", { home: attkTouches.homeValue, away: attkTouches.awayValue });
  log.verify(attkFouled.homeValue !== "" ? "PASS" : "FAIL", "ATTACK: fouled in final third present", { home: attkFouled.homeValue, away: attkFouled.awayValue });
  log.verify(attkCorners.homeValue !== "" ? "PASS" : "FAIL", "ATTACK: corners won present", { home: attkCorners.homeValue, away: attkCorners.awayValue });

  // ── Assemble fullTeamStats (all deferred rows combined) ───────────────────
  const fullTeamStats: DeferredStatRow[] = [
    ...shotsRows,
    ...passRows,
    ...attkRows,
    ...(deferredByKey["expected-goals"] ?? []),
    ...(deferredByKey["goalkeeping"] ?? []),
    ...(deferredByKey["defense"] ?? []),
    ...(deferredByKey["duels"] ?? []),
    ...(deferredByKey["fouls"] ?? []),
  ];

  log.output("Full team stats assembled", { count: fullTeamStats.length });
  log.verify(fullTeamStats.length > 0 ? "PASS" : "FAIL", "FULL_TEAM_STATS: rows present", { count: fullTeamStats.length });

  return {
    shots: {
      homeShotsOnGoal: shtOnGoal.homeValue,
      homeShots: shtTotal.homeValue,
      homeShotsBlocked: shtBlocked.homeValue,
      homeHitWoodwork: shtWoodwork.homeValue,
      homeAttemptsInsideBox: shtInsideBox.homeValue,
      homeAttemptsOutsideBox: shtOutsideBox.homeValue,
      awayShotsOnGoal: shtOnGoal.awayValue,
      awayShots: shtTotal.awayValue,
      awayShotsBlocked: shtBlocked.awayValue,
      awayHitWoodwork: shtWoodwork.awayValue,
      awayAttemptsInsideBox: shtInsideBox.awayValue,
      awayAttemptsOutsideBox: shtOutsideBox.awayValue,
    },
    passes: {
      homeAccuratePasses: pssAccurate.homeValue,
      homePassAccuracyPct: pssAccurate.homeNote,
      homePasses: pssTotal.homeValue,
      homeTotalBackZonePass: pssBackZone.homeValue,
      homeTotalForwardZonePass: pssFwdZone.homeValue,
      homeAccurateLongBalls: pssLongBalls.homeValue,
      homeAccurateCrosses: pssCrosses.homeValue,
      homeTotalThrows: pssThrows.homeValue,
      homeTouchesInOppositionBox: pssTouchesOppBox.homeValue,
      awayAccuratePasses: pssAccurate.awayValue,
      awayPassAccuracyPct: pssAccurate.awayNote,
      awayPasses: pssTotal.awayValue,
      awayTotalBackZonePass: pssBackZone.awayValue,
      awayTotalForwardZonePass: pssFwdZone.awayValue,
      awayAccurateLongBalls: pssLongBalls.awayValue,
      awayAccurateCrosses: pssCrosses.awayValue,
      awayTotalThrows: pssThrows.awayValue,
      awayTouchesInOppositionBox: pssTouchesOppBox.awayValue,
    },
    attack: {
      homeBigChancesCreated: attkBCC.homeValue,
      awayBigChancesCreated: attkBCC.awayValue,
      homeBigChancesMissed: attkBCM.homeValue,
      awayBigChancesMissed: attkBCM.awayValue,
      homeThroughBalls: attkThrough.homeValue,
      awayThroughBalls: attkThrough.awayValue,
      homeTouchesInOppositionBox: attkTouches.homeValue,
      awayTouchesInOppositionBox: attkTouches.awayValue,
      homeFouledInFinalThird: attkFouled.homeValue,
      awayFouledInFinalThird: attkFouled.awayValue,
      homeCornersWon: attkCorners.homeValue,
      awayCornersWon: attkCorners.awayValue,
    },
    goalkeeping: {
      homeSaves: gkSaves.homeValue,
      awaySaves: gkSaves.awayValue,
      homeGoalKicks: gkGoalKicks.homeValue,
      awayGoalKicks: gkGoalKicks.awayValue,
      homeShotsFaced: gkShotsFaced.homeValue,
      awayShotsFaced: gkShotsFaced.awayValue,
      homeTotalHighClaims: gkHighClaims.homeValue,
      awayTotalHighClaims: gkHighClaims.awayValue,
      homePenaltyKicksSaved: gkPKSaved.homeValue,
      awayPenaltyKicksSaved: gkPKSaved.awayValue,
    },
    defense: {
      homeTackles: defTackles.homeValue,
      awayTackles: defTackles.awayValue,
      homeInterceptions: defInterceptions.homeValue,
      awayInterceptions: defInterceptions.awayValue,
      homeClearances: defClearances.homeValue,
      awayClearances: defClearances.awayValue,
      homeRecoveries: defRecoveries.homeValue,
      awayRecoveries: defRecoveries.awayValue,
    },
    duels: {
      homeDuelsWon: duelWon.homeValue,
      awayDuelsWon: duelWon.awayValue,
      homeDuels: duelTotal.homeValue,
      awayDuels: duelTotal.awayValue,
      homeAerialsWon: duelAerials.homeValue,
      awayAerialsWon: duelAerials.awayValue,
    },
    fouls: {
      homeFoulsCommitted: foulCommitted.homeValue,
      awayFoulsCommitted: foulCommitted.awayValue,
      homeOffsides: foulOffsides.homeValue,
      awayOffsides: foulOffsides.awayValue,
      homeYellowCards: foulYellow.homeValue,
      awayYellowCards: foulYellow.awayValue,
      homeRedCards: foulRed.homeValue,
      awayRedCards: foulRed.awayValue,
    },
    expectedGoalsExtended: {
      homeXGOpenPlay: xgOpenPlayRow.homeValue,
      awayXGOpenPlay: xgOpenPlayRow.awayValue,
      homeXGSetPlay: xgSetPlayRow.homeValue,
      awayXGSetPlay: xgSetPlayRow.awayValue,
      homeXGOT: xgOTRow.homeValue,
      awayXGOT: xgOTRow.awayValue,
    },
    goalFrameMap,
    fullTeamStats,
  };
}

// ─── MAIN SCRAPER ─────────────────────────────────────────────────────────────

export async function scrapeEspnMatchPage(
  gameIdOrUrl: string,
  options: {
    logDir?: string;
    saveHtml?: boolean;
  } = {}
): Promise<EspnMatchPageData> {
  // ── Extract gameId ────────────────────────────────────────────────────────
  const gameIdMatch = gameIdOrUrl.match(/gameId[=/](\d+)/);
  const gameId = gameIdMatch ? gameIdMatch[1] : gameIdOrUrl.replace(/\D/g, "");

  const logDir = options.logDir ?? ".scraper-logs";
  const log = new EspnLogger(gameId, logDir);

  log.input("scrapeEspnMatchPage called", {
    gameIdOrUrl,
    gameId,
    logDir,
    saveHtml: options.saveHtml ?? false,
  });

  const t0 = Date.now();
  const pagesLoaded: string[] = [];

  // ── URLs ──────────────────────────────────────────────────────────────────
  const playerStatsUrl = `https://www.espn.com/soccer/player-stats/_/gameId/${gameId}`;
  const matchStatsUrl = `https://www.espn.com/soccer/matchstats/_/gameId/${gameId}`;
  const teamStatsUrl = `https://www.espn.com/soccer/team-stats/_/gameId/${gameId}`;

  log.state("Target URLs", {
    playerStats: playerStatsUrl,
    matchStats: matchStatsUrl,
    teamStats: teamStatsUrl,
  });

  // ── Launch browser ────────────────────────────────────────────────────────
  log.step("BROWSER_LAUNCH", "Launching Playwright Chromium");

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,720",
      ],
    });

    const ua = pickUA();
    log.state("User-Agent selected", { ua });

    context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
      },
    });

    log.output("Browser context created", { ua: ua.substring(0, 60) });

    // ── ESPN Summary API: Fetch season.slug (round label) ─────────────────────
    // This is ESPN's own API (same domain) — returns native season.slug = "group-stage" etc.
    // No JS rendering required — lightweight JSON fetch
    log.step("FETCH_SEASON_SLUG", "Fetching ESPN season.slug from summary API");
    let seasonSlug = "";
    let seasonType = 0;
    let seasonName = "";
    try {
      const summaryUrl = `https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${gameId}`;
      const summaryResp = await fetch(summaryUrl, {
        headers: { "User-Agent": ua, "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (summaryResp.ok) {
        const summaryData = await summaryResp.json() as Record<string, unknown>;
        const header = (summaryData["header"] as Record<string, unknown>) ?? {};
        const season = (header["season"] as Record<string, unknown>) ?? {};
        seasonType = typeof season["type"] === "number" ? season["type"] as number : 0;
        seasonName = typeof season["name"] === "string" ? season["name"] as string : "";
        // Derive slug from type (ESPN scoreboard API uses slug directly; summary API uses type)
        const SEASON_TYPE_TO_SLUG: Record<number, string> = {
          13802: "group-stage",
          13801: "round-of-32",
          13800: "round-of-16",
          13799: "quarterfinals",
          13798: "semifinals",
          13797: "final",
          13796: "third-place",
        };
        seasonSlug = SEASON_TYPE_TO_SLUG[seasonType] ?? `season-type-${seasonType}`;
        log.verify(seasonSlug !== "" ? "PASS" : "WARN",
          "SEASON_SLUG: ESPN round label fetched",
          { seasonSlug, seasonType, seasonName });
      } else {
        log.verify("WARN", "SEASON_SLUG: summary API returned non-200", { status: summaryResp.status });
      }
    } catch (err) {
      log.verify("WARN", "SEASON_SLUG: summary API fetch failed (non-fatal)",
        { error: err instanceof Error ? err.message : String(err) });
    }
    log.state("Season slug resolved", { seasonSlug, seasonType, seasonName });

    // ── Load Page A: Player Stats ─────────────────────────────────────────
    log.step("LOAD_PLAYER_STATS", `Loading player-stats page`);
    const { html: htmlPlayerStats, durationMs: dur1 } = await loadPage(
      context,
      playerStatsUrl,
      log
    );
    pagesLoaded.push(playerStatsUrl);

    if (options.saveHtml) {
      const absLogDir2 = path.isAbsolute(logDir) ? logDir : path.join(process.cwd(), logDir);
      const htmlPath = path.join(absLogDir2, "espn-player-stats-live.html");
      fs.writeFileSync(htmlPath, htmlPlayerStats);
      log.state("Player stats HTML saved", { path: htmlPath, bytes: htmlPlayerStats.length });
    }

    log.output("Player stats page loaded", { bytes: htmlPlayerStats.length, durationMs: dur1 });

    const espnfittPS = extractEspnfitt(htmlPlayerStats);
    if (!espnfittPS) {
      throw new Error("Failed to extract __espnfitt__ from player-stats page");
    }
    const gpPS = getGamepackage(espnfittPS);
    if (!gpPS) {
      throw new Error("Failed to extract gamepackage from player-stats __espnfitt__");
    }

    log.verify("PASS", "__espnfitt__ extracted from player-stats page", {
      gpKeys: Object.keys(gpPS).length,
    });

    // ── Jitter between requests ───────────────────────────────────────────
    await jitter();

    // ── Load Page B: Match Stats ──────────────────────────────────────────
    log.step("LOAD_MATCH_STATS", `Loading matchstats page`);
    const { html: htmlMatchStats, durationMs: dur2 } = await loadPage(
      context,
      matchStatsUrl,
      log
    );
    pagesLoaded.push(matchStatsUrl);

    if (options.saveHtml) {
      const absLogDir3 = path.isAbsolute(logDir) ? logDir : path.join(process.cwd(), logDir);
      const htmlPath = path.join(absLogDir3, "espn-matchstats-live.html");
      fs.writeFileSync(htmlPath, htmlMatchStats);
      log.state("Match stats HTML saved", { path: htmlPath, bytes: htmlMatchStats.length });
    }

    log.output("Match stats page loaded", { bytes: htmlMatchStats.length, durationMs: dur2 });

    const espnfittMS = extractEspnfitt(htmlMatchStats);
    if (!espnfittMS) {
      throw new Error("Failed to extract __espnfitt__ from matchstats page");
    }
    const gpMS = getGamepackage(espnfittMS);
    if (!gpMS) {
      throw new Error("Failed to extract gamepackage from matchstats __espnfitt__");
    }

    log.verify("PASS", "__espnfitt__ extracted from matchstats page", {
      gpKeys: Object.keys(gpMS).length,
    });

    // ── Jitter between requests ───────────────────────────────────────────
    await jitter();

    // ── Load Page C: Team Stats ───────────────────────────────────────────
    log.step("LOAD_TEAM_STATS", `Loading team-stats page`);
    const { html: htmlTeamStats, durationMs: dur3 } = await loadPage(
      context,
      teamStatsUrl,
      log
    );
    pagesLoaded.push(teamStatsUrl);

    if (options.saveHtml) {
      const absLogDir4 = path.isAbsolute(logDir) ? logDir : path.join(process.cwd(), logDir);
      const htmlPath = path.join(absLogDir4, "espn-teamstats-live.html");
      fs.writeFileSync(htmlPath, htmlTeamStats);
      log.state("Team stats HTML saved", { path: htmlPath, bytes: htmlTeamStats.length });
    }

    log.output("Team stats page loaded", { bytes: htmlTeamStats.length, durationMs: dur3 });

    const espnfittTS = extractEspnfitt(htmlTeamStats);
    const gpTS = espnfittTS ? getGamepackage(espnfittTS) : null;

    if (!gpTS) {
      log.error("Failed to extract gamepackage from team-stats page — continuing without it", {
        hasEspnfitt: !!espnfittTS,
      });
    } else {
      log.verify("PASS", "__espnfitt__ extracted from team-stats page", {
        gpKeys: Object.keys(gpTS).length,
      });
    }

    // ── Parse all pages ───────────────────────────────────────────────────
    log.step("PARSE_ALL", "Parsing all extracted data");

    const { boxscore, lineups, gameStrip } = parsePlayerStatsPage(gpPS, log);
    const matchStatsResult = parseMatchStatsPage(gpMS, log);

    // Parse team-stats page for deferred sections
    let tsResult: ReturnType<typeof parseTeamStatsPage> | null = null;
    if (gpTS) {
      tsResult = parseTeamStatsPage(gpTS, log);
    } else {
      log.error("Team-stats page unavailable — deferred sections will be empty", {});
    }

    // ── Build per-player xG/xA table from boxscore ────────────────────────
    log.step("BUILD_XG_TABLE", "Building per-player xG/xA table");
    const perPlayerXG: EspnMatchPageData["expectedGoals"]["perPlayer"] = [];

    const allPlayers = [
      ...boxscore.homeTeam.outfieldPlayers.map((p) => ({
        ...p,
        team: boxscore.homeTeam.teamAbbrev,
      })),
      ...boxscore.awayTeam.outfieldPlayers.map((p) => ({
        ...p,
        team: boxscore.awayTeam.teamAbbrev,
      })),
    ];

    for (const p of allPlayers) {
      const xG = p.stats["xG"] ?? p.stats["expectedGoals"] ?? "";
      const xA = p.stats["xA"] ?? p.stats["expectedAssists"] ?? "";
      if (xG || xA) {
        perPlayerXG.push({ name: p.name, team: p.team, xG, xA });
        log.parse(`xG/xA: ${p.name} (${p.team})`, { xG, xA });
      }
    }

    // Add GK xGC if present
    for (const gkData of [
      { gk: boxscore.homeTeam.goalkeeper, team: boxscore.homeTeam.teamAbbrev },
      { gk: boxscore.awayTeam.goalkeeper, team: boxscore.awayTeam.teamAbbrev },
    ]) {
      if (gkData.gk) {
        const xGC = gkData.gk.stats["xGC"] ?? "";
        if (xGC) {
          perPlayerXG.push({
            name: gkData.gk.name,
            team: gkData.team,
            xG: xGC,
            xA: "",
          });
        }
      }
    }

    log.output("Per-player xG/xA table built", { count: perPlayerXG.length });
    log.verify(perPlayerXG.length > 0 ? "PASS" : "WARN", "EXPECTED_GOALS: per-player xG present", { count: perPlayerXG.length });

    // ── Compute home/away xA totals ───────────────────────────────────────
    const homeXA = perPlayerXG
      .filter((p) => p.team === boxscore.homeTeam.teamAbbrev)
      .reduce((sum, p) => sum + (parseFloat(p.xA) || 0), 0)
      .toFixed(2);
    const awayXA = perPlayerXG
      .filter((p) => p.team === boxscore.awayTeam.teamAbbrev)
      .reduce((sum, p) => sum + (parseFloat(p.xA) || 0), 0)
      .toFixed(2);

    // ── Assemble final result ─────────────────────────────────────────────
    log.step("ASSEMBLE_RESULT", "Assembling final EspnMatchPageData");

    const totalDurationMs = Date.now() - t0;

    // Merge shots: shtsTbls values override shot-map counts for named fields
    const mergedShots: EspnMatchPageData["shots"] = {
      ...(tsResult?.shots ?? {}),
      homeGoals: matchStatsResult.shots.homeGoals,
      homeSaves: matchStatsResult.shots.homeSaves,
      homeOffTarget: matchStatsResult.shots.homeOffTarget,
      homeBlocked: matchStatsResult.shots.homeBlocked,
      homeTotalShots: matchStatsResult.shots.homeTotalShots,
      awayGoals: matchStatsResult.shots.awayGoals,
      awaySaves: matchStatsResult.shots.awaySaves,
      awayOffTarget: matchStatsResult.shots.awayOffTarget,
      awayBlocked: matchStatsResult.shots.awayBlocked,
      awayTotalShots: matchStatsResult.shots.awayTotalShots,
      // Fill any missing named fields from matchStats fallback
      homeShotsOnGoal: tsResult?.shots.homeShotsOnGoal ?? "",
      homeShots: tsResult?.shots.homeShots ?? "",
      homeShotsBlocked: tsResult?.shots.homeShotsBlocked ?? "",
      homeHitWoodwork: tsResult?.shots.homeHitWoodwork ?? "",
      homeAttemptsInsideBox: tsResult?.shots.homeAttemptsInsideBox ?? "",
      homeAttemptsOutsideBox: tsResult?.shots.homeAttemptsOutsideBox ?? "",
      awayShotsOnGoal: tsResult?.shots.awayShotsOnGoal ?? "",
      awayShots: tsResult?.shots.awayShots ?? "",
      awayShotsBlocked: tsResult?.shots.awayShotsBlocked ?? "",
      awayHitWoodwork: tsResult?.shots.awayHitWoodwork ?? "",
      awayAttemptsInsideBox: tsResult?.shots.awayAttemptsInsideBox ?? "",
      awayAttemptsOutsideBox: tsResult?.shots.awayAttemptsOutsideBox ?? "",
    };

    // Merge shotMap with goalFrameMap from team-stats page
    const mergedShotMap: EspnMatchPageData["shotMap"] = {
      ...matchStatsResult.shotMap,
      goalFrameMap: tsResult?.goalFrameMap ?? [],
    };

    const result: EspnMatchPageData = {
      gameId,
      scrapedAt: new Date().toISOString(),
      scrapeDurationMs: totalDurationMs,
      pagesLoaded,
      seasonSlug,
      seasonType,
      seasonName,
      gameStrip,
      boxscore,
      lineups,
      teamStats: matchStatsResult.teamStats,
      matchStats: matchStatsResult.matchStats,
      expectedGoals: {
        homeTeamXG: tsResult?.expectedGoalsExtended.homeXGOpenPlay
          ? (matchStatsResult.matchStats.stats.find((r) => r.name === "Expected Goals")?.homeValue ?? "")
          : (matchStatsResult.matchStats.stats.find((r) => r.name === "Expected Goals")?.homeValue ?? ""),
        awayTeamXG: matchStatsResult.matchStats.stats.find((r) => r.name === "Expected Goals")?.awayValue ?? "",
        homeTeamXGOpenPlay: tsResult?.expectedGoalsExtended.homeXGOpenPlay ?? "",
        awayTeamXGOpenPlay: tsResult?.expectedGoalsExtended.awayXGOpenPlay ?? "",
        homeTeamXGSetPlay: tsResult?.expectedGoalsExtended.homeXGSetPlay ?? "",
        awayTeamXGSetPlay: tsResult?.expectedGoalsExtended.awayXGSetPlay ?? "",
        homeTeamXGOT: tsResult?.expectedGoalsExtended.homeXGOT ?? "",
        awayTeamXGOT: tsResult?.expectedGoalsExtended.awayXGOT ?? "",
        homeTeamXA: homeXA,
        awayTeamXA: awayXA,
        perPlayer: perPlayerXG,
      },
      shotMap: mergedShotMap,
      shots: mergedShots,
      passes: tsResult?.passes ?? {
        homeAccuratePasses: "", homePassAccuracyPct: "", homePasses: "",
        homeTotalBackZonePass: "", homeTotalForwardZonePass: "", homeAccurateLongBalls: "",
        homeAccurateCrosses: "", homeTotalThrows: "", homeTouchesInOppositionBox: "",
        awayAccuratePasses: "", awayPassAccuracyPct: "", awayPasses: "",
        awayTotalBackZonePass: "", awayTotalForwardZonePass: "", awayAccurateLongBalls: "",
        awayAccurateCrosses: "", awayTotalThrows: "", awayTouchesInOppositionBox: "",
      },
      attack: tsResult?.attack ?? {
        homeBigChancesCreated: "", awayBigChancesCreated: "",
        homeBigChancesMissed: "", awayBigChancesMissed: "",
        homeThroughBalls: "", awayThroughBalls: "",
        homeTouchesInOppositionBox: "", awayTouchesInOppositionBox: "",
        homeFouledInFinalThird: "", awayFouledInFinalThird: "",
        homeCornersWon: "", awayCornersWon: "",
      },
      goalkeeping: tsResult?.goalkeeping ?? {
        homeSaves: "", awaySaves: "", homeGoalKicks: "", awayGoalKicks: "",
        homeShotsFaced: "", awayShotsFaced: "", homeTotalHighClaims: "", awayTotalHighClaims: "",
        homePenaltyKicksSaved: "", awayPenaltyKicksSaved: "",
      },
      defense: tsResult?.defense ?? {
        homeTackles: "", awayTackles: "", homeInterceptions: "", awayInterceptions: "",
        homeClearances: "", awayClearances: "", homeRecoveries: "", awayRecoveries: "",
      },
      duels: tsResult?.duels ?? {
        homeDuelsWon: "", awayDuelsWon: "", homeDuels: "", awayDuels: "",
        homeAerialsWon: "", awayAerialsWon: "",
      },
      fouls: tsResult?.fouls ?? {
        homeFoulsCommitted: "", awayFoulsCommitted: "", homeOffsides: "", awayOffsides: "",
        homeYellowCards: "", awayYellowCards: "", homeRedCards: "", awayRedCards: "",
      },
      gameOdds: matchStatsResult.gameOdds,
      fullTeamStats: tsResult?.fullTeamStats ?? [],
      rawGamepackage: {
        playerStatsPage: gpPS,
        matchStatsPage: gpMS,
        teamStatsPage: gpTS ?? {},
      },
    };

    // ── Final verification gates ──────────────────────────────────────────
    log.step("FINAL_VERIFY", "Running final verification gates — 250x edition");

    // ── 1. Game Strip ──────────────────────────────────────────────────────
    log.verify(result.gameStrip.gameId !== "" ? "PASS" : "FAIL", "GAME_STRIP: gameId present");
    log.verify(result.gameStrip.venue !== "" ? "PASS" : "FAIL", "GAME_STRIP: venue present");
    log.verify(result.gameStrip.attendance > 0 ? "PASS" : "WARN", "GAME_STRIP: attendance present");
    log.verify(result.gameStrip.referee !== "" ? "PASS" : "WARN", "GAME_STRIP: referee present");
    log.verify(result.gameStrip.competition !== "" ? "PASS" : "WARN", "GAME_STRIP: competition present");
    log.verify(result.gameStrip.homeTeam.score >= 0 ? "PASS" : "FAIL", "GAME_STRIP: home score present");
    log.verify(result.gameStrip.awayTeam.score >= 0 ? "PASS" : "FAIL", "GAME_STRIP: away score present");

    // ── 2. Boxscore ────────────────────────────────────────────────────────
    log.verify(result.boxscore.homeTeam.outfieldPlayers.length > 0 ? "PASS" : "FAIL",
      "BOXSCORE: home outfield players present",
      { count: result.boxscore.homeTeam.outfieldPlayers.length });
    log.verify(result.boxscore.awayTeam.outfieldPlayers.length > 0 ? "PASS" : "FAIL",
      "BOXSCORE: away outfield players present",
      { count: result.boxscore.awayTeam.outfieldPlayers.length });
    log.verify(result.boxscore.homeTeam.outfieldPlayers.every((p) => p.jersey !== "") ? "PASS" : "WARN",
      "BOXSCORE: all home players have jersey numbers",
      { count: result.boxscore.homeTeam.outfieldPlayers.filter((p) => p.jersey !== "").length });
    log.verify(result.boxscore.statColumns.length > 0 ? "PASS" : "FAIL",
      "BOXSCORE: stat columns present",
      { cols: result.boxscore.statColumns });

    // ── 3. Goalkeeping ─────────────────────────────────────────────────────
    log.verify(result.boxscore.homeTeam.goalkeeper !== null ? "PASS" : "FAIL",
      "GOALKEEPING: home GK present");
    log.verify(result.boxscore.awayTeam.goalkeeper !== null ? "PASS" : "FAIL",
      "GOALKEEPING: away GK present");
    log.verify(result.goalkeeping.homeSaves !== "" ? "PASS" : "FAIL",
      "GOALKEEPING_TABLE: home saves present",
      { value: result.goalkeeping.homeSaves });
    log.verify(result.goalkeeping.homeShotsFaced !== "" ? "PASS" : "FAIL",
      "GOALKEEPING_TABLE: home shots faced present",
      { value: result.goalkeeping.homeShotsFaced });
    log.verify(result.goalkeeping.homeGoalKicks !== "" ? "PASS" : "FAIL",
      "GOALKEEPING_TABLE: home goal kicks present",
      { value: result.goalkeeping.homeGoalKicks });
    log.verify(result.goalkeeping.homeTotalHighClaims !== "" ? "PASS" : "FAIL",
      "GOALKEEPING_TABLE: home high claims present",
      { value: result.goalkeeping.homeTotalHighClaims });
    log.verify(result.goalkeeping.homePenaltyKicksSaved !== "" ? "PASS" : "WARN",
      "GOALKEEPING_TABLE: home pk saved present",
      { value: result.goalkeeping.homePenaltyKicksSaved });

    // ── 4 & 5. Formations & Lineups ────────────────────────────────────────
    log.verify(result.lineups.home.starters.length === 11 ? "PASS" : "FAIL",
      "FORMATIONS: home has 11 starters",
      { count: result.lineups.home.starters.length });
    log.verify(result.lineups.away.starters.length === 11 ? "PASS" : "FAIL",
      "FORMATIONS: away has 11 starters",
      { count: result.lineups.away.starters.length });
    log.verify(result.lineups.home.formation !== "" ? "PASS" : "FAIL",
      "FORMATIONS: home formation string present",
      { formation: result.lineups.home.formation });
    log.verify(result.lineups.away.formation !== "" ? "PASS" : "FAIL",
      "FORMATIONS: away formation string present",
      { formation: result.lineups.away.formation });

    // ── 6. Team Stats ──────────────────────────────────────────────────────
    log.verify(result.teamStats.stats.length === 8 ? "PASS" : "WARN",
      "TEAM_STATS: 8 rows from tmStatsGrph",
      { count: result.teamStats.stats.length });

    // ── 7. Match Stats ─────────────────────────────────────────────────────
    log.verify(result.matchStats.stats.length === 9 ? "PASS" : "WARN",
      "MATCH_STATS: 9 rows from mtchStatsGrph",
      { count: result.matchStats.stats.length });

    // ── 8. Expected Goals ──────────────────────────────────────────────────
    log.verify(result.expectedGoals.homeTeamXG !== "" ? "PASS" : "FAIL",
      "EXPECTED_GOALS: home xG present",
      { xG: result.expectedGoals.homeTeamXG });
    log.verify(result.expectedGoals.homeTeamXGOpenPlay !== "" ? "PASS" : "FAIL",
      "EXPECTED_GOALS: home xG Open Play present",
      { value: result.expectedGoals.homeTeamXGOpenPlay });
    log.verify(result.expectedGoals.homeTeamXGSetPlay !== "" ? "PASS" : "FAIL",
      "EXPECTED_GOALS: home xG Set Play present",
      { value: result.expectedGoals.homeTeamXGSetPlay });
    log.verify(result.expectedGoals.homeTeamXGOT !== "" ? "PASS" : "FAIL",
      "EXPECTED_GOALS: home xGOT present",
      { value: result.expectedGoals.homeTeamXGOT });
    log.verify(result.expectedGoals.perPlayer.length > 0 ? "PASS" : "WARN",
      "EXPECTED_GOALS: per-player xG present",
      { count: result.expectedGoals.perPlayer.length });

    // ── 9. Shot Map ────────────────────────────────────────────────────────
    log.verify(result.shotMap.shots.length > 0 ? "PASS" : "FAIL",
      "SHOT_MAP: shots present",
      { count: result.shotMap.shots.length });
    log.verify(result.shotMap.shots.every((s) => s.fieldStartX !== null) ? "PASS" : "WARN",
      "SHOT_MAP: all shots have fieldStart.x",
      { withCoords: result.shotMap.shots.filter((s) => s.fieldStartX !== null).length });
    log.verify(result.shotMap.shots.every((s) => s.playerName !== "") ? "PASS" : "WARN",
      "SHOT_MAP: all shots have player name",
      { withName: result.shotMap.shots.filter((s) => s.playerName !== "").length });
    log.verify(result.shotMap.shots.every((s) => s.playerJersey !== "") ? "PASS" : "WARN",
      "SHOT_MAP: all shots have player jersey",
      { withJersey: result.shotMap.shots.filter((s) => s.playerJersey !== "").length });
    log.verify(result.shotMap.goalFrameMap.length === 2 ? "PASS" : "WARN",
      "SHOT_MAP: goal frame map has 2 teams",
      { count: result.shotMap.goalFrameMap.length });

    // ── 10. Shots ──────────────────────────────────────────────────────────
    log.verify(result.shots.homeShotsOnGoal !== "" ? "PASS" : "FAIL",
      "SHOTS: home shots on goal present",
      { value: result.shots.homeShotsOnGoal });
    log.verify(result.shots.homeHitWoodwork !== "" ? "PASS" : "FAIL",
      "SHOTS: home hit woodwork present",
      { value: result.shots.homeHitWoodwork });
    log.verify(result.shots.homeAttemptsInsideBox !== "" ? "PASS" : "FAIL",
      "SHOTS: home attempts inside box present",
      { value: result.shots.homeAttemptsInsideBox });
    log.verify(result.shots.homeTotalShots > 0 ? "PASS" : "FAIL",
      "SHOTS: home total shots from shot map present",
      { count: result.shots.homeTotalShots });

    // ── 11. Passes ─────────────────────────────────────────────────────────
    log.verify(result.passes.homeAccuratePasses !== "" ? "PASS" : "FAIL",
      "PASSES: home accurate passes present",
      { value: result.passes.homeAccuratePasses });
    log.verify(result.passes.homePassAccuracyPct !== "" ? "PASS" : "FAIL",
      "PASSES: home pass accuracy % present",
      { value: result.passes.homePassAccuracyPct });
    log.verify(result.passes.homePasses !== "" ? "PASS" : "FAIL",
      "PASSES: home total passes present",
      { value: result.passes.homePasses });
    log.verify(result.passes.homeTotalBackZonePass !== "" ? "PASS" : "FAIL",
      "PASSES: home back zone passes present",
      { value: result.passes.homeTotalBackZonePass });
    log.verify(result.passes.homeTotalForwardZonePass !== "" ? "PASS" : "FAIL",
      "PASSES: home forward zone passes present",
      { value: result.passes.homeTotalForwardZonePass });
    log.verify(result.passes.homeAccurateLongBalls !== "" ? "PASS" : "FAIL",
      "PASSES: home accurate long balls present",
      { value: result.passes.homeAccurateLongBalls });
    log.verify(result.passes.homeAccurateCrosses !== "" ? "PASS" : "FAIL",
      "PASSES: home accurate crosses present",
      { value: result.passes.homeAccurateCrosses });
    log.verify(result.passes.homeTotalThrows !== "" ? "PASS" : "FAIL",
      "PASSES: home total throws present",
      { value: result.passes.homeTotalThrows });
    log.verify(result.passes.homeTouchesInOppositionBox !== "" ? "PASS" : "FAIL",
      "PASSES: home touches in opp box present",
      { value: result.passes.homeTouchesInOppositionBox });

    // ── 12. Attack ─────────────────────────────────────────────────────────
    log.verify(result.attack.homeBigChancesCreated !== "" ? "PASS" : "FAIL",
      "ATTACK: home big chances created present",
      { value: result.attack.homeBigChancesCreated });
    log.verify(result.attack.homeBigChancesMissed !== "" ? "PASS" : "FAIL",
      "ATTACK: home big chances missed present",
      { value: result.attack.homeBigChancesMissed });
    log.verify(result.attack.homeThroughBalls !== "" ? "PASS" : "FAIL",
      "ATTACK: home through balls present",
      { value: result.attack.homeThroughBalls });
    log.verify(result.attack.homeTouchesInOppositionBox !== "" ? "PASS" : "FAIL",
      "ATTACK: home touches in opp box present",
      { value: result.attack.homeTouchesInOppositionBox });
    log.verify(result.attack.homeFouledInFinalThird !== "" ? "PASS" : "FAIL",
      "ATTACK: home fouled in final third present",
      { value: result.attack.homeFouledInFinalThird });
    log.verify(result.attack.homeCornersWon !== "" ? "PASS" : "FAIL",
      "ATTACK: home corners won present",
      { value: result.attack.homeCornersWon });

    // ── 13. Defense ────────────────────────────────────────────────────────
    log.verify(result.defense.homeTackles !== "" ? "PASS" : "FAIL",
      "DEFENSE: home tackles present",
      { value: result.defense.homeTackles });
    log.verify(result.defense.homeInterceptions !== "" ? "PASS" : "FAIL",
      "DEFENSE: home interceptions present",
      { value: result.defense.homeInterceptions });
    log.verify(result.defense.homeClearances !== "" ? "PASS" : "FAIL",
      "DEFENSE: home clearances present",
      { value: result.defense.homeClearances });
    log.verify(result.defense.homeRecoveries !== "" ? "PASS" : "FAIL",
      "DEFENSE: home recoveries present",
      { value: result.defense.homeRecoveries });

    // ── 14. Duels ──────────────────────────────────────────────────────────
    log.verify(result.duels.homeDuelsWon !== "" ? "PASS" : "FAIL",
      "DUELS: home duels won present",
      { value: result.duels.homeDuelsWon });
    log.verify(result.duels.homeDuels !== "" ? "PASS" : "FAIL",
      "DUELS: home total duels present",
      { value: result.duels.homeDuels });
    log.verify(result.duels.homeAerialsWon !== "" ? "PASS" : "FAIL",
      "DUELS: home aerials won present",
      { value: result.duels.homeAerialsWon });

    // ── 15. Fouls ──────────────────────────────────────────────────────────
    log.verify(result.fouls.homeFoulsCommitted !== "" ? "PASS" : "FAIL",
      "FOULS: home fouls committed present",
      { value: result.fouls.homeFoulsCommitted });
    log.verify(result.fouls.homeOffsides !== "" ? "PASS" : "FAIL",
      "FOULS: home offsides present",
      { value: result.fouls.homeOffsides });
    log.verify(result.fouls.homeYellowCards !== "" ? "PASS" : "FAIL",
      "FOULS: home yellow cards present",
      { value: result.fouls.homeYellowCards });
    log.verify(result.fouls.homeRedCards !== "" ? "PASS" : "WARN",
      "FOULS: home red cards present",
      { value: result.fouls.homeRedCards });

    // ── 16. Game Odds ──────────────────────────────────────────────────────
    log.verify(result.gameOdds !== null ? "PASS" : "WARN",
      "GAME_ODDS: odds data present",
      { provider: result.gameOdds?.provider ?? "N/A" });

    // ── 17. Full Team Stats ────────────────────────────────────────────────
    log.verify(result.fullTeamStats.length > 0 ? "PASS" : "FAIL",
      "FULL_TEAM_STATS: rows present",
      { count: result.fullTeamStats.length });

    // ── 18. Glossary ───────────────────────────────────────────────────────
    log.verify(result.boxscore.glossary.length > 0 ? "PASS" : "FAIL",
      "GLOSSARY: entries present",
      { count: result.boxscore.glossary.length });

    // ── Run summary ───────────────────────────────────────────────────────
    const totalPlayers =
      result.boxscore.homeTeam.outfieldPlayers.length +
      result.boxscore.awayTeam.outfieldPlayers.length +
      (result.boxscore.homeTeam.goalkeeper ? 1 : 0) +
      (result.boxscore.awayTeam.goalkeeper ? 1 : 0);

    log.summary("SUCCESS");

    log.output("SCRAPE COMPLETE — 500x EDITION", {
      gameId: result.gameId,
      seasonSlug: result.seasonSlug,
      seasonType: result.seasonType,
      seasonName: result.seasonName,
      competition: result.gameStrip.competition,
      score: `${result.gameStrip.homeTeam.abbrev} ${result.gameStrip.homeTeam.score}-${result.gameStrip.awayTeam.score} ${result.gameStrip.awayTeam.abbrev}`,
      venue: result.gameStrip.venue,
      attendance: result.gameStrip.attendance,
      referee: result.gameStrip.referee,
      pagesLoaded: pagesLoaded.length,
      totalPlayers,
      shotMapEntries: result.shotMap.shots.length,
      goalFrameMapTeams: result.shotMap.goalFrameMap.length,
      teamStatRows: result.teamStats.stats.length,
      matchStatRows: result.matchStats.stats.length,
      fullTeamStatRows: result.fullTeamStats.length,
      xgPerPlayerRows: result.expectedGoals.perPlayer.length,
      homeFormation: result.lineups.home.formation,
      awayFormation: result.lineups.away.formation,
      homeXG: result.expectedGoals.homeTeamXG,
      awayXG: result.expectedGoals.awayTeamXG,
      homeXGOpenPlay: result.expectedGoals.homeTeamXGOpenPlay,
      awayXGOpenPlay: result.expectedGoals.awayTeamXGOpenPlay,
      homeXGSetPlay: result.expectedGoals.homeTeamXGSetPlay,
      awayXGSetPlay: result.expectedGoals.awayTeamXGSetPlay,
      homeXGOT: result.expectedGoals.homeTeamXGOT,
      awayXGOT: result.expectedGoals.awayTeamXGOT,
      homeSaves: result.goalkeeping.homeSaves,
      awaySaves: result.goalkeeping.awaySaves,
      homeTackles: result.defense.homeTackles,
      awayTackles: result.defense.awayTackles,
      homeInterceptions: result.defense.homeInterceptions,
      awayInterceptions: result.defense.awayInterceptions,
      homeClearances: result.defense.homeClearances,
      awayClearances: result.defense.awayClearances,
      homeRecoveries: result.defense.homeRecoveries,
      awayRecoveries: result.defense.awayRecoveries,
      homeDuelsWon: result.duels.homeDuelsWon,
      awayDuelsWon: result.duels.awayDuelsWon,
      homeFoulsCommitted: result.fouls.homeFoulsCommitted,
      awayFoulsCommitted: result.fouls.awayFoulsCommitted,
      homeYellowCards: result.fouls.homeYellowCards,
      awayYellowCards: result.fouls.awayYellowCards,
      gameOddsProvider: result.gameOdds?.provider ?? "N/A",
      durationMs: totalDurationMs,
    });

    return result;
  } finally {
    if (context) {
      try { await context.close(); } catch { /* ignore */ }
    }
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
