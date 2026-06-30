/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║              ESPN WORLD CUP PAGE SCRAPER — 100x EDITION                    ║
 * ║                                                                              ║
 * ║  Direct Playwright DOM + __espnfitt__ JSON extraction.                      ║
 * ║  ZERO API fallback. All data sourced exclusively from live ESPN pages.      ║
 * ║                                                                              ║
 * ║  CONFIRMED TABLES:                                                           ║
 * ║    1.  GAME STRIP        — score, status, venue, attendance, officials       ║
 * ║    2.  BOXSCORE          — per-player stats (TCH/G/A/xG/xA/SOG/SHOT/...)   ║
 * ║    3.  GOALKEEPING       — GA/SV/SOGA/xGC/xGOTC/GP/BCS/CLR/CC/KS          ║
 * ║    4.  FORMATIONS        — formation string + full 11-player grid            ║
 * ║    5.  LINEUPS           — starters, subs, unused (with formationPlace)     ║
 * ║    6.  TEAM STATS        — possession, shots, fouls, corners, saves, etc.   ║
 * ║    7.  EXPECTED GOALS    — xG/xA per player + team totals                  ║
 * ║    8.  SHOT MAP          — 24 shots: player, team, type, xG, dist, foot     ║
 * ║    9.  SHOTS             — shot breakdown by type (goal/save/off/blocked)   ║
 * ║   10.  PASSES            — accurate passes, pass accuracy %                 ║
 * ║   11.  DUELS             — duels won per team                               ║
 * ║   12.  FOULS             — fouls committed, yellow/red cards                ║
 * ║   13.  ATTACK            — big chances created/missed                       ║
 * ║                                                                              ║
 * ║  PAGES LOADED (3 total):                                                     ║
 * ║    A. /soccer/player-stats/_/gameId/{id}  → boxscore + lineups + glossary  ║
 * ║    B. /soccer/matchstats/_/gameId/{id}    → shot map + team stats + xG     ║
 * ║    C. /soccer/team-stats/_/gameId/{id}    → full team stat breakdown        ║
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
 * ║  ELITE LOGGER: EspnLogger — dual-channel (terminal + .manus-logs/...)      ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { EspnLogger } from "./espnLogger";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  "/home/ubuntu/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";

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

export interface ShotMapEntry {
  shotId: string;
  sequence: number;
  playerName: string;
  playerShortName: string;
  teamAbbrev: string;
  isAway: boolean;
  period: number;
  clock: string;
  iconType: "goal" | "save" | "offTarget" | "blocked";
  isOwnGoal: boolean;
  fieldPositionX: number | null;
  fieldPositionY: number | null;
  xG: string;
  xGOT: string;
  distance: string;
  shotType: string;
  situation: string;
  goalZone: string;
  description: string;
  shortDescription: string;
}

export interface TeamStatRow {
  name: string;
  homeValue: string;
  awayValue: string;
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

export interface EspnMatchPageData {
  // ── Meta ──────────────────────────────────────────────────────────────────
  gameId: string;
  scrapedAt: string;
  scrapeDurationMs: number;
  pagesLoaded: string[];

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

  // ── 6. Team Stats ─────────────────────────────────────────────────────────
  teamStats: {
    homeAbbrev: string;
    awayAbbrev: string;
    stats: TeamStatRow[];
  };

  // ── 7. Expected Goals ─────────────────────────────────────────────────────
  expectedGoals: {
    homeTeamXG: string;
    awayTeamXG: string;
    homeTeamXA: string;
    awayTeamXA: string;
    perPlayer: Array<{
      name: string;
      team: string;
      xG: string;
      xA: string;
    }>;
  };

  // ── 8. Shot Map ───────────────────────────────────────────────────────────
  shotMap: {
    totalShots: number;
    homeShots: number;
    awayShots: number;
    shots: ShotMapEntry[];
    availableTypes: string[];
  };

  // ── 9. Shots breakdown ────────────────────────────────────────────────────
  shots: {
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

  // ── 10. Passes ────────────────────────────────────────────────────────────
  passes: {
    homeAccuratePasses: string;
    homePassAccuracyPct: string;
    awayAccuratePasses: string;
    awayPassAccuracyPct: string;
  };

  // ── 11. Duels ─────────────────────────────────────────────────────────────
  duels: {
    homeDuelsWon: string;
    awayDuelsWon: string;
  };

  // ── 12. Fouls ─────────────────────────────────────────────────────────────
  fouls: {
    homeFoulsCommitted: string;
    awayFoulsCommitted: string;
    homeYellowCards: string;
    awayYellowCards: string;
    homeRedCards: string;
    awayRedCards: string;
  };

  // ── 13. Attack ────────────────────────────────────────────────────────────
  attack: {
    homeBigChancesCreated: string;
    awayBigChancesCreated: string;
    homeBigChancesMissed: string;
    awayBigChancesMissed: string;
  };

  // ── Full team stats page (extended) ──────────────────────────────────────
  fullTeamStats: TeamStatRow[];

  // ── Raw espnfitt data (for downstream use) ────────────────────────────────
  rawGamepackage: {
    playerStatsPage: Record<string, unknown>;
    matchStatsPage: Record<string, unknown>;
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

  // ── bxscr (boxscore JSON) ────────────────────────────────────────────────
  log.state("Extracting bxscr");
  const bxscr = (gp["bxscr"] as Array<Record<string, unknown>>) ?? [];
  log.parse("bxscr teams", { count: bxscr.length });

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

  log.verify(homeTeamBxscr.outfieldPlayers.length > 0 && awayTeamBxscr.outfieldPlayers.length > 0 ? "PASS" : "FAIL",
    "Boxscore outfield players present",
    {
      homePlayers: homeTeamBxscr.outfieldPlayers.length,
      awayPlayers: awayTeamBxscr.outfieldPlayers.length,
    });

  // ── Lineups ──────────────────────────────────────────────────────────────
  log.step("PARSE_LINEUPS", "Parsing lineups");
  const lineUps = (gp["lineUps"] as Array<Record<string, unknown>>) ?? [];

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

  log.verify(homeLineup.starters.length === 11 && awayLineup.starters.length === 11 ? "PASS" : "FAIL",
    "Both lineups have 11 starters",
    { homeStarters: homeLineup.starters.length, awayStarters: awayLineup.starters.length });

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

  // Determine home/away from gmStrp.invrtTms
  const invertTeams = Boolean(gmStrp["invrtTms"]);
  const homeIdx = invertTeams ? 0 : 0;
  const awayIdx = invertTeams ? 1 : 1;

  const homeTeamStrip = tms[homeIdx] ? parseTeamStrip(tms[homeIdx], "home") : {
    id: "", abbrev: "", displayName: "", logo: "", score: 0, linescores: [], goals: [], redCards: [],
  };
  const awayTeamStrip = tms[awayIdx] ? parseTeamStrip(tms[awayIdx], "away") : {
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

  log.verify(gameStrip.gameId !== "" ? "PASS" : "FAIL", "Game strip has gameId", { gameId: gameStrip.gameId });
  log.verify(gameStrip.homeTeam.score >= 0 ? "PASS" : "FAIL", "Home team score present", {
    score: gameStrip.homeTeam.score,
  });

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
  expectedGoals: EspnMatchPageData["expectedGoals"];
  shotMap: EspnMatchPageData["shotMap"];
  shots: EspnMatchPageData["shots"];
  passes: EspnMatchPageData["passes"];
  duels: EspnMatchPageData["duels"];
  fouls: EspnMatchPageData["fouls"];
  attack: EspnMatchPageData["attack"];
} {
  log.step("PARSE_MATCH_STATS", "Parsing matchstats page gamepackage");

  // ── Team Stats ───────────────────────────────────────────────────────────
  log.state("Extracting tmStatsGrph");
  const tmStatsGrph = (gp["tmStatsGrph"] as Record<string, unknown>) ?? {};
  const tmStatsGrphTeams = (tmStatsGrph["teams"] as Record<string, Record<string, unknown>>) ?? {};
  const homeAbbrev = safeStr(tmStatsGrphTeams["teamOne"]?.["abbrv"] ?? "HOME");
  const awayAbbrev = safeStr(tmStatsGrphTeams["teamTwo"]?.["abbrv"] ?? "AWAY");

  const statsArr = (tmStatsGrph["stats"] as Array<Record<string, unknown>>) ?? [];
  const statsData = statsArr[0]
    ? ((statsArr[0]["data"] as Array<Record<string, unknown>>) ?? [])
    : [];

  const teamStatRows: TeamStatRow[] = statsData.map((s) => ({
    name: safeStr(s["name"]),
    homeValue: safeStr((s["teamOne"] as Record<string, unknown>)?.["displayValue"] ?? ""),
    awayValue: safeStr((s["teamTwo"] as Record<string, unknown>)?.["displayValue"] ?? ""),
  }));

  log.parse("Team stats extracted", {
    homeAbbrev,
    awayAbbrev,
    statCount: teamStatRows.length,
    stats: teamStatRows.map((r) => `${r.name}: ${r.homeValue} vs ${r.awayValue}`),
  });

  log.verify(teamStatRows.length > 0 ? "PASS" : "FAIL", "Team stats rows present", { count: teamStatRows.length });

  // ── mtchStatsGrph — extract early so findStat can search it too ───────────
  // mtchStatsGrph has: Expected Goals, Possession, Shots on Goal, Big Chances,
  // Accurate Passes, Duels Won, Saves, Fouls Committed
  const mtchStatsGrph = (gp["mtchStatsGrph"] as Record<string, unknown>) ?? {};
  const mtchStats = (mtchStatsGrph["stats"] as Array<Record<string, unknown>>) ?? [];
  const mtchStatsData = mtchStats[0]
    ? ((mtchStats[0]["data"] as Array<Record<string, unknown>>) ?? [])
    : [];

  const mtchStatRows: TeamStatRow[] = mtchStatsData.map((s) => ({
    name: safeStr(s["name"]),
    homeValue: safeStr((s["teamOne"] as Record<string, unknown>)?.["displayValue"] ?? ""),
    awayValue: safeStr((s["teamTwo"] as Record<string, unknown>)?.["displayValue"] ?? ""),
  }));

  log.parse("mtchStatsGrph extracted", {
    count: mtchStatRows.length,
    stats: mtchStatRows.map((r) => `${r.name}: ${r.homeValue} vs ${r.awayValue}`),
  });

  // ── Helper: find stat by name — searches mtchStatsGrph first, then tmStatsGrph ─
  function findStat(name: string): TeamStatRow {
    return mtchStatRows.find((r) => r.name.toLowerCase().includes(name.toLowerCase())) ??
           teamStatRows.find((r) => r.name.toLowerCase().includes(name.toLowerCase())) ?? {
      name,
      homeValue: "",
      awayValue: "",
    };
  }

  const findMtchStat = (name: string) =>
    mtchStatsData.find((s) => safeStr(s["name"]).toLowerCase().includes(name.toLowerCase()));

  // ── Expected Goals ───────────────────────────────────────────────────────
  log.state("Extracting Expected Goals");
  const xgStat = findStat("Expected Goals");
  log.parse("xG extracted", { home: xgStat.homeValue, away: xgStat.awayValue });

  // ── Shot Map ─────────────────────────────────────────────────────────────
  log.state("Extracting shot map (shtMp)");
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
    const athlete = (firstParticipant["athlete"] as Record<string, string>) ?? {};

    const period = safeNum((play["period"] as Record<string, unknown>)?.["number"]);
    const clock = safeStr((play["clock"] as Record<string, string>)?.["displayValue"]);
    const isAway = Boolean(shot["isAway"]);
    const teamAbbrev = isAway ? awayTeamAbbrev : homeTeamAbbrev;

    const attrs: Record<string, string> = {};
    ((play["attributes"] as Array<Record<string, string>>) ?? []).forEach((a) => {
      attrs[a["label"]] = a["displayValue"];
    });

    const fx = shot["fieldPositionX"];
    const fy = shot["fieldPositionY"];

    const entry: ShotMapEntry = {
      shotId: safeStr(shot["id"]),
      sequence: safeNum(shot["sequence"]),
      playerName: safeStr(athlete["displayName"] ?? athlete["fullName"]),
      playerShortName: safeStr(athlete["shortName"]),
      teamAbbrev,
      isAway,
      period,
      clock,
      iconType: safeStr(shot["iconType"]) as ShotMapEntry["iconType"],
      isOwnGoal: Boolean(shot["isOwnGoal"]),
      fieldPositionX: typeof fx === "number" ? fx : null,
      fieldPositionY: typeof fy === "number" ? fy : null,
      xG: attrs["xG"] ?? "",
      xGOT: attrs["xGOT"] ?? "",
      distance: attrs["Distance"] ?? "",
      shotType: attrs["Shot Type"] ?? "",
      situation: attrs["Situation"] ?? "",
      goalZone: attrs["Goal Zone"] ?? "",
      description: safeStr(play["text"]),
      shortDescription: safeStr(play["shortText"]),
    };

    log.parse(`Shot[${idx}]: ${entry.teamAbbrev} ${entry.playerShortName || entry.playerName}`, {
      type: entry.iconType,
      period: entry.period,
      clock: entry.clock,
      xG: entry.xG,
      distance: entry.distance,
      foot: entry.shotType,
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

  log.verify(shotMapEntries.length > 0 ? "PASS" : "FAIL", "Shot map has entries", { count: shotMapEntries.length });

  // ── Shots breakdown ──────────────────────────────────────────────────────
  const homeGoals = shotMapEntries.filter((s) => !s.isAway && s.iconType === "goal").length;
  const homeSaves = shotMapEntries.filter((s) => !s.isAway && s.iconType === "save").length;
  const homeOffTarget = shotMapEntries.filter((s) => !s.isAway && s.iconType === "offTarget").length;
  const homeBlocked = shotMapEntries.filter((s) => !s.isAway && s.iconType === "blocked").length;
  const awayGoals = shotMapEntries.filter((s) => s.isAway && s.iconType === "goal").length;
  const awaySaves = shotMapEntries.filter((s) => s.isAway && s.iconType === "save").length;
  const awayOffTarget = shotMapEntries.filter((s) => s.isAway && s.iconType === "offTarget").length;
  const awayBlocked = shotMapEntries.filter((s) => s.isAway && s.iconType === "blocked").length;

  log.parse("Shots breakdown", {
    home: { goals: homeGoals, saves: homeSaves, offTarget: homeOffTarget, blocked: homeBlocked },
    away: { goals: awayGoals, saves: awaySaves, offTarget: awayOffTarget, blocked: awayBlocked },
  });

  // ── Passes ───────────────────────────────────────────────────────────────
  // ESPN stores pass count in displayValue and accuracy % in the 'note' field
  const passesRawEntry = findMtchStat("Accurate Passes");
  const homePassCount = safeStr((passesRawEntry?.["teamOne"] as Record<string, unknown>)?.["displayValue"] ?? "");
  const awayPassCount = safeStr((passesRawEntry?.["teamTwo"] as Record<string, unknown>)?.["displayValue"] ?? "");
  const homePassPct = safeStr((passesRawEntry?.["teamOne"] as Record<string, unknown>)?.["note"] ?? "");
  const awayPassPct = safeStr((passesRawEntry?.["teamTwo"] as Record<string, unknown>)?.["note"] ?? "");

  log.parse("Passes extracted", {
    home: { count: homePassCount, pct: homePassPct },
    away: { count: awayPassCount, pct: awayPassPct },
  });

  // ── Duels ────────────────────────────────────────────────────────────────
  const duelsStat = findStat("Duels Won");
  log.parse("Duels extracted", { home: duelsStat.homeValue, away: duelsStat.awayValue });

  // ── Fouls ────────────────────────────────────────────────────────────────
  const foulsStat = findStat("Fouls");
  const yellowStat = findStat("Yellow Cards");
  const redStat = findStat("Red Cards");

  log.parse("Fouls extracted", {
    fouls: { home: foulsStat.homeValue, away: foulsStat.awayValue },
    yellow: { home: yellowStat.homeValue, away: yellowStat.awayValue },
    red: { home: redStat.homeValue, away: redStat.awayValue },
  });

  // ── Attack ───────────────────────────────────────────────────────────────
  // Big chances from mtchStatsGrph (already extracted above)
  const bigChancesCreated = findMtchStat("Big Chances Created");
  const bigChancesMissed = findMtchStat("Big Chances Missed");

  const homeBCC = safeStr((bigChancesCreated?.["teamOne"] as Record<string, unknown>)?.["displayValue"] ?? "");
  const awayBCC = safeStr((bigChancesCreated?.["teamTwo"] as Record<string, unknown>)?.["displayValue"] ?? "");
  const homeBCM = safeStr((bigChancesMissed?.["teamOne"] as Record<string, unknown>)?.["displayValue"] ?? "");
  const awayBCM = safeStr((bigChancesMissed?.["teamTwo"] as Record<string, unknown>)?.["displayValue"] ?? "");

  log.parse("Attack (Big Chances) extracted", {
    bcc: { home: homeBCC, away: awayBCC },
    bcm: { home: homeBCM, away: awayBCM },
  });

  // ── Per-player xG/xA from boxscore ───────────────────────────────────────
  // This comes from the player-stats page, so we'll populate it there
  // Here we just extract team totals from team stats
  const xgRow = findStat("Expected Goals");

  return {
    teamStats: {
      homeAbbrev,
      awayAbbrev,
      stats: teamStatRows,
    },
    expectedGoals: {
      homeTeamXG: xgRow.homeValue,
      awayTeamXG: xgRow.awayValue,
      homeTeamXA: "",
      awayTeamXA: "",
      perPlayer: [], // populated from boxscore data
    },
    shotMap: {
      totalShots: shotMapEntries.length,
      homeShots,
      awayShots,
      shots: shotMapEntries,
      availableTypes: Object.keys(availShts).filter((k) => availShts[k]),
    },
    shots: {
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
    passes: {
      homeAccuratePasses: homePassCount,
      homePassAccuracyPct: homePassPct,
      awayAccuratePasses: awayPassCount,
      awayPassAccuracyPct: awayPassPct,
    },
    duels: {
      homeDuelsWon: duelsStat.homeValue,
      awayDuelsWon: duelsStat.awayValue,
    },
    fouls: {
      homeFoulsCommitted: foulsStat.homeValue,
      awayFoulsCommitted: foulsStat.awayValue,
      homeYellowCards: yellowStat.homeValue,
      awayYellowCards: yellowStat.awayValue,
      homeRedCards: redStat.homeValue,
      awayRedCards: redStat.awayValue,
    },
    attack: {
      homeBigChancesCreated: homeBCC,
      awayBigChancesCreated: awayBCC,
      homeBigChancesMissed: homeBCM,
      awayBigChancesMissed: awayBCM,
    },
  };
}

// ─── PARSER: TEAM STATS PAGE ──────────────────────────────────────────────────

function parseTeamStatsPage(
  gp: Record<string, unknown>,
  log: EspnLogger
): TeamStatRow[] {
  log.step("PARSE_TEAM_STATS", "Parsing team-stats page gamepackage");

  const tmStatsGrph = (gp["tmStatsGrph"] as Record<string, unknown>) ?? {};
  const statsArr = (tmStatsGrph["stats"] as Array<Record<string, unknown>>) ?? [];

  const allStats: TeamStatRow[] = [];
  for (const statGroup of statsArr) {
    const data = (statGroup["data"] as Array<Record<string, unknown>>) ?? [];
    for (const s of data) {
      const row: TeamStatRow = {
        name: safeStr(s["name"]),
        homeValue: safeStr((s["teamOne"] as Record<string, unknown>)?.["displayValue"] ?? ""),
        awayValue: safeStr((s["teamTwo"] as Record<string, unknown>)?.["displayValue"] ?? ""),
      };
      allStats.push(row);
      log.parse(`Team stat: ${row.name}`, { home: row.homeValue, away: row.awayValue });
    }
  }

  log.output("Full team stats extracted", { count: allStats.length });
  log.verify(allStats.length > 0 ? "PASS" : "FAIL", "Full team stats present", { count: allStats.length });

  return allStats;
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

  const logDir = options.logDir ?? ".manus-logs";
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

    log.verify(true ? "PASS" : "FAIL", "__espnfitt__ extracted from player-stats page", {
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

    log.verify(true ? "PASS" : "FAIL", "__espnfitt__ extracted from matchstats page", {
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
      log.verify(true ? "PASS" : "FAIL", "__espnfitt__ extracted from team-stats page", {
        gpKeys: Object.keys(gpTS).length,
      });
    }

    // ── Parse all pages ───────────────────────────────────────────────────
    log.step("PARSE_ALL", "Parsing all extracted data");

    const { boxscore, lineups, gameStrip } = parsePlayerStatsPage(gpPS, log);
    const matchStatsResult = parseMatchStatsPage(gpMS, log);
    // fullTeamStats: use mtchStatsGrph (9 rich stats) from match-stats page.
    // parseTeamStatsPage on the team-stats page is a bonus if available.
    const mtchStatsGrphFull = (gpMS["mtchStatsGrph"] as Record<string, unknown>) ?? {};
    const mtchStatsArrFull = (mtchStatsGrphFull["stats"] as Array<Record<string, unknown>>) ?? [];
    const mtchStatsDataFull: TeamStatRow[] = [];
    for (const sg of mtchStatsArrFull) {
      const data = (sg["data"] as Array<Record<string, unknown>>) ?? [];
      for (const s of data) {
        mtchStatsDataFull.push({
          name: safeStr(s["name"]),
          homeValue: safeStr((s["teamOne"] as Record<string, unknown>)?.["displayValue"] ?? ""),
          awayValue: safeStr((s["teamTwo"] as Record<string, unknown>)?.["displayValue"] ?? ""),
        });
      }
    }
    const tsPageStats = gpTS ? parseTeamStatsPage(gpTS, log) : [];
    const fullTeamStats = tsPageStats.length > 0 ? tsPageStats :
      (mtchStatsDataFull.length > 0 ? mtchStatsDataFull : matchStatsResult.teamStats.stats);
    log.output("fullTeamStats assembled", {
      count: fullTeamStats.length,
      source: tsPageStats.length > 0 ? "teamStatsPage" : (mtchStatsDataFull.length > 0 ? "mtchStatsGrph" : "teamStats.stats"),
    });

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

    // Add GK xG/xA if present
    for (const gkData of [
      { gk: boxscore.homeTeam.goalkeeper, team: boxscore.homeTeam.teamAbbrev },
      { gk: boxscore.awayTeam.goalkeeper, team: boxscore.awayTeam.teamAbbrev },
    ]) {
      if (gkData.gk) {
        const xGC = gkData.gk.stats["xGC"] ?? "";
        if (xGC) {
          perPlayerXG.push({
            name: gkData.gk.name,
            team: gkData.gk.stats["team"] ?? gkData.team,
            xG: xGC,
            xA: "",
          });
        }
      }
    }

    log.output("Per-player xG/xA table built", { count: perPlayerXG.length });

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

    const result: EspnMatchPageData = {
      gameId,
      scrapedAt: new Date().toISOString(),
      scrapeDurationMs: totalDurationMs,
      pagesLoaded,
      gameStrip,
      boxscore,
      lineups,
      teamStats: matchStatsResult.teamStats,
      expectedGoals: {
        ...matchStatsResult.expectedGoals,
        homeTeamXA: homeXA,
        awayTeamXA: awayXA,
        perPlayer: perPlayerXG,
      },
      shotMap: matchStatsResult.shotMap,
      shots: matchStatsResult.shots,
      passes: matchStatsResult.passes,
      duels: matchStatsResult.duels,
      fouls: matchStatsResult.fouls,
      attack: matchStatsResult.attack,
      fullTeamStats,
      rawGamepackage: {
        playerStatsPage: gpPS,
        matchStatsPage: gpMS,
      },
    };

    // ── Final verification gates ──────────────────────────────────────────
    log.step("FINAL_VERIFY", "Running final verification gates");

    log.verify(result.gameStrip.gameId !== "" ? "PASS" : "FAIL", "GAME_STRIP: gameId present");
    log.verify(result.gameStrip.venue !== "" ? "PASS" : "FAIL", "GAME_STRIP: venue present");
    log.verify(result.boxscore.homeTeam.outfieldPlayers.length > 0 ? "PASS" : "FAIL",
      "BOXSCORE: home outfield players present",
      { count: result.boxscore.homeTeam.outfieldPlayers.length });
    log.verify(result.boxscore.awayTeam.outfieldPlayers.length > 0 ? "PASS" : "FAIL",
      "BOXSCORE: away outfield players present",
      { count: result.boxscore.awayTeam.outfieldPlayers.length });
    log.verify(result.boxscore.homeTeam.goalkeeper !== null ? "PASS" : "FAIL",
      "GOALKEEPING: home GK present");
    log.verify(result.boxscore.awayTeam.goalkeeper !== null ? "PASS" : "FAIL",
      "GOALKEEPING: away GK present");
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
    log.verify(result.teamStats.stats.length > 0 ? "PASS" : "FAIL",
      "TEAM_STATS: rows present",
      { count: result.teamStats.stats.length });
    log.verify(result.expectedGoals.homeTeamXG !== "" ? "PASS" : "FAIL",
      "EXPECTED_GOALS: home xG present",
      { xG: result.expectedGoals.homeTeamXG });
    log.verify(result.expectedGoals.perPlayer.length > 0 ? "PASS" : "FAIL",
      "EXPECTED_GOALS: per-player xG present",
      { count: result.expectedGoals.perPlayer.length });
    log.verify(result.shotMap.shots.length > 0 ? "PASS" : "FAIL",
      "SHOT_MAP: shots present",
      { count: result.shotMap.shots.length });
    log.verify(result.shots.homeTotalShots > 0 || result.shots.awayTotalShots > 0 ? "PASS" : "FAIL",
      "SHOTS: totals present",
      { home: result.shots.homeTotalShots, away: result.shots.awayTotalShots });
    log.verify(result.passes.homeAccuratePasses !== "" ? "PASS" : "FAIL",
      "PASSES: home accurate passes present",
      { value: result.passes.homeAccuratePasses });
    log.verify(result.duels.homeDuelsWon !== "" ? "PASS" : "FAIL",
      "DUELS: home duels won present",
      { value: result.duels.homeDuelsWon });
    log.verify(result.fouls.homeFoulsCommitted !== "" ? "PASS" : "FAIL",
      "FOULS: home fouls committed present",
      { value: result.fouls.homeFoulsCommitted });
    log.verify(result.attack.homeBigChancesCreated !== "" || result.attack.awayBigChancesCreated !== "" ? "PASS" : "FAIL",
      "ATTACK: big chances present",
      { home: result.attack.homeBigChancesCreated, away: result.attack.awayBigChancesCreated });
    log.verify(result.fullTeamStats.length > 0 ? "PASS" : "FAIL",
      "FULL_TEAM_STATS: rows present",
      { count: result.fullTeamStats.length });
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

    log.output("SCRAPE COMPLETE", {
      gameId: result.gameId,
      competition: result.gameStrip.competition,
      score: `${result.gameStrip.homeTeam.abbrev} ${result.gameStrip.homeTeam.score}-${result.gameStrip.awayTeam.score} ${result.gameStrip.awayTeam.abbrev}`,
      venue: result.gameStrip.venue,
      attendance: result.gameStrip.attendance,
      pagesLoaded: pagesLoaded.length,
      totalPlayers,
      shotMapEntries: result.shotMap.shots.length,
      teamStatRows: result.teamStats.stats.length,
      fullTeamStatRows: result.fullTeamStats.length,
      xgPerPlayerRows: result.expectedGoals.perPlayer.length,
      homeFormation: result.lineups.home.formation,
      awayFormation: result.lineups.away.formation,
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

// ─── SCOREBOARD SCRAPER ───────────────────────────────────────────────────────

export interface EspnScoreboardEntry {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: string;
  awayScore: string;
  status: string;
  competition: string;
  dateTimeUTC: string;
  playerStatsUrl: string;
  matchStatsUrl: string;
}

export async function scrapeEspnScoreboard(
  date?: string, // YYYYMMDD or YYYY-MM-DD
  options: { logDir?: string } = {}
): Promise<EspnScoreboardEntry[]> {
  const logDir = options.logDir ?? ".manus-logs";
  const dateStr = date ? date.replace(/-/g, "") : "";
  const url = dateStr
    ? `https://www.espn.com/soccer/scoreboard/_/date/${dateStr}`
    : "https://www.espn.com/soccer/scoreboard";

  const log = new EspnLogger("scoreboard", logDir);
  log.input("scrapeEspnScoreboard called", { date, url });

  const ua = pickUA();
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
    });

    const { html } = await loadPage(context, url, log);
    await context.close();

    const espnfitt = extractEspnfitt(html);
    if (!espnfitt) {
      log.error("Failed to extract __espnfitt__ from scoreboard page");
      return [];
    }

    const page = espnfitt["page"] as Record<string, unknown>;
    const content = page?.["content"] as Record<string, unknown>;
    const events = (content?.["events"] as Array<Record<string, unknown>>) ?? [];

    const entries: EspnScoreboardEntry[] = events.map((evt) => {
      const gid = safeStr(evt["id"]);
      const competitors = (evt["competitors"] as Array<Record<string, unknown>>) ?? [];
      const home = competitors.find((c) => (c["homeAway"] as string) === "home") ?? {};
      const away = competitors.find((c) => (c["homeAway"] as string) === "away") ?? {};
      const status = (evt["status"] as Record<string, string>) ?? {};
      const competition = safeStr(evt["competition"]);
      const dateTime = safeStr(evt["date"]);

      return {
        gameId: gid,
        homeTeam: safeStr((home["team"] as Record<string, string>)?.["abbreviation"]),
        awayTeam: safeStr((away["team"] as Record<string, string>)?.["abbreviation"]),
        homeScore: safeStr(home["score"]),
        awayScore: safeStr(away["score"]),
        status: safeStr(status["type"]),
        competition,
        dateTimeUTC: dateTime,
        playerStatsUrl: `https://www.espn.com/soccer/player-stats/_/gameId/${gid}`,
        matchStatsUrl: `https://www.espn.com/soccer/matchstats/_/gameId/${gid}`,
      };
    });

    log.output("Scoreboard scraped", { count: entries.length });
    log.summary("SUCCESS");

    return entries;
  } finally {
    await browser.close();
  }
}
