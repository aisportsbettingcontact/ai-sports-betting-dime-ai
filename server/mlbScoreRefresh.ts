/**
 * mlbScoreRefresh.ts
 *
 * Fetches live MLB game scores, status, and pitcher info from the official
 * MLB Stats API (statsapi.mlb.com).  Runs on a 10-minute cron alongside the
 * VSiN splits and AN odds refreshes.
 *
 * ─── API endpoints ───────────────────────────────────────────────────────────
 *
 *   Schedule (today's games + basic linescore):
 *     https://statsapi.mlb.com/api/v1/schedule
 *       ?sportId=1
 *       &date=YYYY-MM-DD
 *       &hydrate=linescore,probablePitcher(note),decisions,broadcasts(all)
 *       &language=en
 *
 *   Response shape (per game):
 *     game.gamePk              — unique game ID (matches our mlbGamePk column)
 *     game.status.abstractGameState  — "Preview" | "Live" | "Final"
 *     game.status.detailedState      — "Scheduled" | "In Progress" | "Final" | "Postponed" etc.
 *     game.status.codedGameState     — "S" | "L" | "F" | "P" | "D" | "U"
 *     game.linescore.currentInning   — current inning number (int)
 *     game.linescore.inningHalf      — "Top" | "Bottom" | "Middle" | "End"
 *     game.linescore.teams.away.runs — away runs
 *     game.linescore.teams.home.runs — home runs
 *     game.teams.away.team.abbreviation — e.g. "NYY"
 *     game.teams.home.team.abbreviation — e.g. "SF"
 *     game.decisions.winner.fullName  — winning pitcher full name
 *     game.decisions.loser.fullName   — losing pitcher full name
 *     game.probablePitchers.away.fullName — probable away starter
 *     game.probablePitchers.home.fullName — probable home starter
 *
 * ─── Status mapping ──────────────────────────────────────────────────────────
 *   abstractGameState "Preview"  → DB gameStatus "upcoming"
 *   abstractGameState "Live"     → DB gameStatus "live"
 *   abstractGameState "Final"    → DB gameStatus "final"
 *   detailedState "Postponed"    → DB gameStatus "upcoming" (game not played)
 *   detailedState "Suspended"    → DB gameStatus "upcoming"
 *
 * ─── Game clock string ───────────────────────────────────────────────────────
 *   Live:  "Top 3rd" | "Bot 3rd" | "Mid 3rd" | "End 3rd"
 *   Final: "Final" | "Final/10" (extra innings)
 *   Upcoming: null
 *
 * ─── Team matching ───────────────────────────────────────────────────────────
 *   DB stores teams as MLB abbreviations (e.g. "NYY", "SF").
 *   We match by mlbGamePk (primary) or by awayTeam+homeTeam abbreviation (fallback).
 */

import { eq } from "drizzle-orm";
import { games } from "../drizzle/schema";
import { MLB_BY_ABBREV, MLB_BY_ID } from "../shared/mlbTeams";
import { getDb, listGamesByDate, updateNcaaStartTime, updateBookOdds, getMlbLineupsByGameIds } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────

const MLB_STATS_API_BASE = "https://statsapi.mlb.com/api/v1";

const MLB_SCHEDULE_HYDRATE = [
  "linescore",
  "probablePitcher(note)",
  "decisions",
  "broadcasts(all)",
].join(",");

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.mlb.com/",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MlbLiveGame {
  /** MLB Stats API game PK — matches our mlbGamePk column */
  gamePk: number;
  /** Away team abbreviation as stored in DB (e.g. "NYY") */
  awayAbbrev: string;
  /** Home team abbreviation as stored in DB (e.g. "SF") */
  homeAbbrev: string;
  /** Scheduled start as UTC ISO instant (API `gameDate`) — used for DH-safe fallback matching */
  startUtc: string;
  /** Doubleheader flag from the API: "N" | "Y" (traditional) | "S" (split) */
  doubleHeader: string;
  /** Game number within the day (1 for singles and G1; 2 for G2 of a doubleheader) */
  gameNumber: number;
  /** Away team runs (null if game not started) */
  awayRuns: number | null;
  /** Home team runs (null if game not started) */
  homeRuns: number | null;
  /**
   * Mapped DB game status:
   *   "upcoming"   — not yet started (Preview, Scheduled, Warmup, Delayed)
   *   "live"       — in progress (Live, In Progress)
   *   "final"      — completed (Final, Game Over, Completed Early)
   *   "postponed"  — game postponed, suspended, or cancelled (hidden from feed)
   */
  gameStatus: "upcoming" | "live" | "final" | "postponed";
  /**
   * Human-readable game clock string for display:
   *   Live:    "Top 3rd" | "Bot 3rd" | "Mid 3rd" | "End 3rd" | "Top 10th (Extra)" etc.
   *   Final:   "Final" | "Final/10" (extra innings suffix)
   *   Upcoming: null
   */
  gameClock: string | null;
  /** Probable away starting pitcher full name (e.g. "Gerrit Cole") — null if TBD */
  awayProbablePitcher: string | null;
  /** Probable home starting pitcher full name — null if TBD */
  homeProbablePitcher: string | null;
  /** Winning pitcher full name (only for final games) */
  winningPitcher: string | null;
  /** Losing pitcher full name (only for final games) */
  losingPitcher: string | null;
  /** Raw abstractGameState from MLB API: "Preview" | "Live" | "Final" */
  rawAbstractState: string;
  /** Raw detailedState from MLB API: "Scheduled" | "In Progress" | "Final" | "Postponed" etc. */
  rawDetailedState: string;
  /** Total innings played (for extra-inning detection) */
  totalInnings: number | null;
  /**
   * Away team F5 runs (sum of innings 1–5 away runs).
   * Only set for final games with full linescore.innings data (≥5 innings).
   * null for live/upcoming games or when innings data is unavailable.
   */
  awayF5Runs: number | null;
  /**
   * Home team F5 runs (sum of innings 1–5 home runs).
   * Only set for final games with full linescore.innings data (≥5 innings).
   * null for live/upcoming games or when innings data is unavailable.
   */
  homeF5Runs: number | null;
  /**
   * NRFI result derived from 1st inning linescore.
   * "NRFI" = both teams scored 0 runs in the 1st inning.
   * "YRFI" = at least one team scored ≥1 run in the 1st inning.
   * null for live/upcoming games or when innings data is unavailable.
   */
  nrfiResult: "NRFI" | "YRFI" | null;
}

// ─── Raw API types ────────────────────────────────────────────────────────────

interface MlbApiTeamInfo {
  team: {
    id: number;
    name: string;
    // NOTE: 'abbreviation' is NOT returned by the schedule endpoint — only id/name/link.
    // Use MLB_BY_ID.get(team.id)?.abbrev for team resolution.
    abbreviation?: string;
  };
  score?: number;
  // probablePitcher is nested under teams.away/home in the schedule hydration
  probablePitcher?: MlbApiPitcher;
}

interface MlbApiLinescore {
  currentInning?: number;
  currentInningOrdinal?: string;
  inningHalf?: string;
  teams?: {
    away?: { runs?: number; hits?: number; errors?: number };
    home?: { runs?: number; hits?: number; errors?: number };
  };
  innings?: Array<{
    num: number;
    ordinalNum: string;
    away?: { runs?: number };
    home?: { runs?: number };
  }>;
}

interface MlbApiPitcher {
  id: number;
  fullName: string;
}

interface MlbApiGame {
  gamePk: number;
  /** UTC ISO start instant */
  gameDate?: string;
  /** "N" | "Y" | "S" — doubleheader designation */
  doubleHeader?: string;
  /** 1|2 — game number within a doubleheader day */
  gameNumber?: number;
  status: {
    abstractGameState: string;
    detailedState: string;
    codedGameState: string;
    statusCode: string;
  };
  teams: {
    away: MlbApiTeamInfo;
    home: MlbApiTeamInfo;
  };
  linescore?: MlbApiLinescore;
  probablePitchers?: {
    away?: MlbApiPitcher;
    home?: MlbApiPitcher;
  };
  decisions?: {
    winner?: MlbApiPitcher;
    loser?: MlbApiPitcher;
    save?: MlbApiPitcher;
  };
}

interface MlbApiScheduleResponse {
  dates: Array<{
    date: string;
    games: MlbApiGame[];
  }>;
  totalGames?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps MLB API abstractGameState + detailedState to our DB gameStatus enum.
 *
 * Detailed mapping:
 *   abstractGameState="Preview"  → "upcoming"  (includes: Scheduled, Pre-Game, Warmup, Delayed Start)
 *   abstractGameState="Live"     → "live"       (includes: In Progress, Manager Challenge, Replay Review)
 *   abstractGameState="Final"    → "final"      (includes: Final, Game Over, Completed Early)
 *   detailedState="Postponed"    → "postponed"  (override: game not played today — hidden from feed)
 *   detailedState="Suspended"    → "postponed"  (override: game suspended — hidden from feed)
 *   detailedState="Cancelled"    → "postponed"  (override: treat as not played — hidden from feed)
 */
function mapMlbStatus(
  abstractState: string,
  detailedState: string
): "upcoming" | "live" | "final" | "postponed" {
  // Explicit overrides for special states — these games are NOT played and must be hidden from feed
  const detailedLower = detailedState.toLowerCase();
  if (
    detailedLower.includes("postponed") ||
    detailedLower.includes("suspended") ||
    detailedLower.includes("cancelled") ||
    detailedLower.includes("canceled")
  ) {
    return "postponed";
  }

  switch (abstractState) {
    case "Live":
      return "live";
    case "Final":
      return "final";
    case "Preview":
    default:
      return "upcoming";
  }
}

/**
 * Builds a human-readable game clock string from the MLB linescore.
 *
 * Examples:
 *   Live, top of 3rd  → "Top 3rd"
 *   Live, bottom 7th  → "Bot 7th"
 *   Live, middle 3rd  → "Mid 3rd"  (between half-innings)
 *   Live, end of 9th  → "End 9th"
 *   Final, 9 innings  → "Final"
 *   Final, 12 innings → "Final/12"
 *   Upcoming          → null
 */
function buildMlbGameClock(
  status: "upcoming" | "live" | "final" | "postponed",
  linescore: MlbApiLinescore | undefined,
  totalInnings: number | null
): string | null {
  if (status === "upcoming" || status === "postponed") return null;

  if (status === "final") {
    if (totalInnings != null && totalInnings > 9) {
      return `Final/${totalInnings}`;
    }
    return "Final";
  }

  // Live game
  if (!linescore) return "Live";

  const inning = linescore.currentInningOrdinal ?? String(linescore.currentInning ?? "?");
  const half = linescore.inningHalf ?? "";

  if (half === "Top") return `Top ${inning}`;
  if (half === "Bottom") return `Bot ${inning}`;
  if (half === "Middle") return `Mid ${inning}`;
  if (half === "End") return `End ${inning}`;

  // Fallback: just show inning
  return `${inning}`;
}

/**
 * Counts the total number of innings played from the linescore innings array.
 * Returns null if no innings data is available.
 */
function countTotalInnings(linescore: MlbApiLinescore | undefined): number | null {
  if (!linescore?.innings || linescore.innings.length === 0) return null;
  return linescore.innings.length;
}

/**
 * Normalizes an MLB abbreviation from the Stats API to match our DB format.
 * The API uses "AZ" for Arizona Diamondbacks; we store "ARI".
 * The API uses "OAK" for Athletics; we store "ATH" (Sacramento).
 */
function normalizeAbbrev(apiAbbrev: string): string {
  const MAP: Record<string, string> = {
    AZ: "ARI",   // Diamondbacks: API uses AZ, we use ARI
    OAK: "ATH",  // Athletics: relocated to Sacramento, we use ATH
  };
  return MAP[apiAbbrev] ?? apiAbbrev;
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetches today's MLB games from the Stats API with full linescore hydration.
 *
 * @param dateStr - Date in YYYY-MM-DD format (ET/local date)
 * @returns Array of MlbLiveGame objects for all games on that date
 */
export async function fetchMlbLiveScores(dateStr: string): Promise<MlbLiveGame[]> {
  const url =
    `${MLB_STATS_API_BASE}/schedule` +
    `?sportId=1` +
    `&date=${dateStr}` +
    `&hydrate=${encodeURIComponent(MLB_SCHEDULE_HYDRATE)}` +
    `&language=en`;

  console.log(
    `[MLBScoreRefresh] ► Fetching MLB Stats API for ${dateStr}` +
    ` | URL: ${url}`
  );

  const fetchStart = Date.now();
  const resp = await fetch(url, { headers: FETCH_HEADERS });
  const fetchMs = Date.now() - fetchStart;

  if (!resp.ok) {
    throw new Error(
      `[MLBScoreRefresh] MLB Stats API returned HTTP ${resp.status} for ${dateStr} (${fetchMs}ms)`
    );
  }

  const data = (await resp.json()) as MlbApiScheduleResponse;
  const dateEntry = data.dates?.find((d) => d.date === dateStr);
  const apiGames: MlbApiGame[] = dateEntry?.games ?? [];

  console.log(
    `[MLBScoreRefresh] API response: ${apiGames.length} games for ${dateStr}` +
    ` (HTTP ${resp.status}, ${fetchMs}ms)`
  );

  const results: MlbLiveGame[] = [];
  let skippedUnknownTeam = 0;
  let skippedNoLinescore = 0;

  for (const g of apiGames) {
    // The schedule endpoint returns team.id + team.name but NOT team.abbreviation.
    // Resolve via MLB_BY_ID (keyed by MLB Stats API team ID, e.g. 147 = Yankees).
    const awayTeamId = g.teams.away.team.id;
    const homeTeamId = g.teams.home.team.id;
    const awayTeamEntry = MLB_BY_ID.get(awayTeamId);
    const homeTeamEntry = MLB_BY_ID.get(homeTeamId);

    // Fallback: if ID lookup fails, try abbreviation field (future-proofing)
    const rawAwayAbbrev = g.teams.away.team.abbreviation ?? awayTeamEntry?.abbrev ?? "";
    const rawHomeAbbrev = g.teams.home.team.abbreviation ?? homeTeamEntry?.abbrev ?? "";
    const awayAbbrev = awayTeamEntry?.abbrev ?? normalizeAbbrev(rawAwayAbbrev);
    const homeAbbrev = homeTeamEntry?.abbrev ?? normalizeAbbrev(rawHomeAbbrev);

    // Validate both teams are in our registry
    const awayTeam = awayTeamEntry ?? MLB_BY_ABBREV.get(awayAbbrev);
    const homeTeam = homeTeamEntry ?? MLB_BY_ABBREV.get(homeAbbrev);

    if (!awayTeam || !homeTeam) {
      console.warn(
        `[MLBScoreRefresh] SKIP gamePk=${g.gamePk}: unknown team(s)` +
        ` away: id=${awayTeamId} name="${g.teams.away.team.name}" abbrev="${awayAbbrev}" (${awayTeam ? "✓" : "✗"})` +
        ` home: id=${homeTeamId} name="${g.teams.home.team.name}" abbrev="${homeAbbrev}" (${homeTeam ? "✓" : "✗"})` +
        ` — add to MLB_TEAMS in mlbTeams.ts if this is a valid MLB team`
      );
      skippedUnknownTeam++;
      continue;
    }

    const abstractState = g.status.abstractGameState;
    const detailedState = g.status.detailedState;
    const gameStatus = mapMlbStatus(abstractState, detailedState);

    const linescore = g.linescore;
    const totalInnings = countTotalInnings(linescore);
    const gameClock = buildMlbGameClock(gameStatus, linescore, totalInnings);

    // Scores: only available once game has started
    const awayRuns =
      gameStatus !== "upcoming"
        ? (linescore?.teams?.away?.runs ?? g.teams.away.score ?? null)
        : null;
    const homeRuns =
      gameStatus !== "upcoming"
        ? (linescore?.teams?.home?.runs ?? g.teams.home.score ?? null)
        : null;

    // Pitchers
    // NOTE: The schedule endpoint hydrates probable pitchers under teams.away.probablePitcher,
    // NOT under a top-level probablePitchers field (that's only in the live game feed).
    const awayProbablePitcher =
      g.teams.away.probablePitcher?.fullName ?? g.probablePitchers?.away?.fullName ?? null;
    const homeProbablePitcher =
      g.teams.home.probablePitcher?.fullName ?? g.probablePitchers?.home?.fullName ?? null;
    const winningPitcher = g.decisions?.winner?.fullName ?? null;
    const losingPitcher = g.decisions?.loser?.fullName ?? null;

    // ── F5 scores: sum innings 1–5 (indices 0–4) ────────────────────────────
    // Only compute for final games with full innings data (≥5 innings played).
    // For live games or games with incomplete innings, set null.
    let awayF5Runs: number | null = null;
    let homeF5Runs: number | null = null;
    let nrfiResult: "NRFI" | "YRFI" | null = null;

    if (gameStatus === "final" && linescore?.innings && linescore.innings.length >= 5) {
      // F5 = sum of innings 1–5 (array indices 0–4)
      awayF5Runs = linescore.innings
        .slice(0, 5)
        .reduce((sum, inn) => sum + (inn.away?.runs ?? 0), 0);
      homeF5Runs = linescore.innings
        .slice(0, 5)
        .reduce((sum, inn) => sum + (inn.home?.runs ?? 0), 0);
      console.log(
        `[MLBScoreRefresh] F5 computed: gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
        ` | awayF5=${awayF5Runs} homeF5=${homeF5Runs}` +
        ` | innings_available=${linescore.innings.length}`
      );
    } else if (gameStatus === "final" && linescore?.innings && linescore.innings.length < 5) {
      console.warn(
        `[MLBScoreRefresh] F5 SKIP: gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
        ` — only ${linescore.innings.length} innings in linescore (need ≥5 for F5)`
      );
    }

    // ── NRFI: 1st inning both teams scored 0 runs ─────────────────────────────
    // Requires at least 1 inning of data. For final games only.
    if (gameStatus === "final" && linescore?.innings && linescore.innings.length >= 1) {
      const inn1 = linescore.innings[0];
      const inn1Away = inn1.away?.runs ?? 0;
      const inn1Home = inn1.home?.runs ?? 0;
      nrfiResult = (inn1Away === 0 && inn1Home === 0) ? "NRFI" : "YRFI";
      console.log(
        `[MLBScoreRefresh] NRFI computed: gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
        ` | inn1Away=${inn1Away} inn1Home=${inn1Home} → ${nrfiResult}`
      );
    }

    const game: MlbLiveGame = {
      gamePk: g.gamePk,
      awayAbbrev,
      homeAbbrev,
      startUtc: g.gameDate ?? "",
      doubleHeader: g.doubleHeader ?? "N",
      gameNumber: typeof g.gameNumber === "number" && g.gameNumber >= 1 ? g.gameNumber : 1,
      awayRuns,
      homeRuns,
      gameStatus,
      gameClock,
      awayProbablePitcher,
      homeProbablePitcher,
      winningPitcher,
      losingPitcher,
      rawAbstractState: abstractState,
      rawDetailedState: detailedState,
      totalInnings,
      awayF5Runs,
      homeF5Runs,
      nrfiResult,
    };

    results.push(game);

    // Detailed per-game log
    const scoreStr =
      gameStatus === "upcoming"
        ? "not started"
        : `${awayRuns ?? "?"}-${homeRuns ?? "?"}`;
    const pitcherStr =
      gameStatus === "final" && winningPitcher
        ? ` | W: ${winningPitcher}, L: ${losingPitcher ?? "?"}`
        : awayProbablePitcher
        ? ` | SP: ${awayProbablePitcher} vs ${homeProbablePitcher ?? "TBD"}`
        : "";

    console.log(
      `[MLBScoreRefresh] gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
      ` | status=${gameStatus} (${abstractState}/${detailedState})` +
      ` | clock=${gameClock ?? "—"}` +
      ` | score=${scoreStr}` +
      pitcherStr
    );

    if (!linescore && gameStatus !== "upcoming") {
      console.warn(
        `[MLBScoreRefresh] WARNING: gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
        ` has status=${gameStatus} but NO linescore in API response`
      );
      skippedNoLinescore++;
    }
  }

  console.log(
    `[MLBScoreRefresh] ✅ Parsed ${results.length} games` +
    ` (${results.filter((g) => g.gameStatus === "live").length} live,` +
    ` ${results.filter((g) => g.gameStatus === "final").length} final,` +
    ` ${results.filter((g) => g.gameStatus === "upcoming").length} upcoming)` +
    ` | skipped: ${skippedUnknownTeam} unknown teams, ${skippedNoLinescore} no linescore`
  );

  return results;
}

// ─── DB Refresh ───────────────────────────────────────────────────────────────

/** Minimal DB-row shape the matcher needs (subset of a `games` row). */
export interface MatchableDbGame {
  id: number;
  awayTeam: string;
  homeTeam: string;
  mlbGamePk: number | null;
  gameNumber: number | null;
  startTimeEst: string;
}

export interface MlbScoreMatch<R extends MatchableDbGame> {
  apiGame: MlbLiveGame;
  dbGame: R | null;
  matchMethod: "gamePk" | "teams+gameNumber" | "teams+time" | "teams" | "none";
}

/** Parse "h:mm AM/PM" to minutes-since-midnight ET; null for TBD/unparseable. */
function estTimeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

/** Convert a UTC ISO instant to minutes-since-midnight ET; null when invalid. */
function utcToEstMinutes(utcIso: string): number | null {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return null;
  const s = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  return (parseInt(m[1], 10) % 24) * 60 + parseInt(m[2], 10);
}

/**
 * DOUBLEHEADER-SAFE matching of API games to DB rows (pure, exported for tests).
 *
 * Replaces the pre-incident single-slot `away@home` map, which had exactly one
 * slot per matchup: for a doubleheader the second DB row overwrote the first
 * in the map, and both API games matched the same row — cross-contaminating
 * status/scores between Game 1 and Game 2 (2026-07-17 TB@BOS incident class).
 *
 * Strategy, in priority order, with claim semantics (a DB row is matched by at
 * most ONE API game, and vice versa):
 *   1. mlbGamePk exact match (canonical identity).
 *   2. Same matchup + same gameNumber (DH-disambiguated fallback).
 *   3. Same matchup + closest start time (legacy rows with default gameNumber).
 *   4. Same matchup when exactly one candidate remains (single games).
 */
export function matchMlbLiveGamesToDbRows<R extends MatchableDbGame>(
  apiGames: MlbLiveGame[],
  dbGames: R[]
): { matches: Array<MlbScoreMatch<R>>; warnings: string[] } {
  const warnings: string[] = [];
  const claimed = new Set<number>();
  const results = new Map<number, MlbScoreMatch<R>>(); // gamePk → match

  const byPk = new Map<number, R>();
  for (const r of dbGames) {
    if (r.mlbGamePk == null) continue;
    const pk = Number(r.mlbGamePk);
    if (byPk.has(pk)) {
      warnings.push(`DB rows id=${byPk.get(pk)!.id} and id=${r.id} share mlbGamePk=${pk}`);
      continue;
    }
    byPk.set(pk, r);
  }

  // Pass 1: canonical identity.
  const unmatched: MlbLiveGame[] = [];
  for (const g of apiGames) {
    const row = byPk.get(g.gamePk);
    if (row && !claimed.has(row.id)) {
      claimed.add(row.id);
      results.set(g.gamePk, { apiGame: g, dbGame: row, matchMethod: "gamePk" });
    } else {
      unmatched.push(g);
    }
  }

  // Passes 2–4 operate per matchup so DH siblings are resolved together.
  const byMatchup = new Map<string, MlbLiveGame[]>();
  for (const g of unmatched) {
    const key = `${g.awayAbbrev}@${g.homeAbbrev}`;
    const arr = byMatchup.get(key);
    if (arr) arr.push(g); else byMatchup.set(key, [g]);
  }

  // Array.from: tsconfig targets ES5 (no downlevelIteration) — direct Map iteration is TS2802
  for (const [key, group] of Array.from(byMatchup.entries())) {
    const candidates = () => dbGames.filter(
      r => !claimed.has(r.id) && `${r.awayTeam}@${r.homeTeam}` === key
    );

    // Pass 2: gameNumber alignment — ONLY when the DB rows genuinely encode
    // doubleheader numbering (≥2 rows with pairwise-distinct gameNumbers).
    // A lone legacy row (or two rows both at the schema default of 1) carries
    // no numbering signal; trusting it would let Game 1 of a DH claim the
    // sibling's row before start-time distance can decide (incident class).
    const initialCandidates = candidates();
    const numbersAreSignal =
      initialCandidates.length >= 2 &&
      new Set(initialCandidates.map(r => r.gameNumber ?? 1)).size === initialCandidates.length;
    if (numbersAreSignal) {
      for (const g of group) {
        const rows = candidates().filter(r => (r.gameNumber ?? 1) === g.gameNumber);
        if (rows.length === 1) {
          claimed.add(rows[0].id);
          results.set(g.gamePk, { apiGame: g, dbGame: rows[0], matchMethod: "teams+gameNumber" });
        }
      }
    }

    // Pass 3: closest start time (greedy over globally sorted distances).
    const stillUnmatched = group.filter(g => !results.has(g.gamePk));
    const pairs: Array<{ dist: number; g: MlbLiveGame; row: R }> = [];
    for (const g of stillUnmatched) {
      const gMin = utcToEstMinutes(g.startUtc);
      for (const row of candidates()) {
        const rMin = estTimeToMinutes(row.startTimeEst);
        const dist = gMin != null && rMin != null ? Math.abs(gMin - rMin) : 24 * 60;
        pairs.push({ dist, g, row });
      }
    }
    pairs.sort((a, b) => (a.dist - b.dist) || (a.g.gamePk - b.g.gamePk) || (a.row.id - b.row.id));
    for (const p of pairs) {
      if (results.has(p.g.gamePk) || claimed.has(p.row.id)) continue;
      claimed.add(p.row.id);
      results.set(p.g.gamePk, {
        apiGame: p.g,
        dbGame: p.row,
        matchMethod: p.dist < 24 * 60 ? "teams+time" : "teams",
      });
      if (group.length > 1) {
        warnings.push(
          `doubleheader fallback match for ${key} gamePk=${p.g.gamePk} via ${p.dist < 24 * 60 ? "start-time distance" : "last-resort teams"} — stamp mlbGamePk to make this exact`
        );
      }
    }
  }

  const matches: Array<MlbScoreMatch<R>> = apiGames.map(
    g => results.get(g.gamePk) ?? { apiGame: g, dbGame: null, matchMethod: "none" as const }
  );

  // Cardinality invariant: no DB row may serve two API games (claim set makes
  // this structurally impossible), and every unmatched API game is reported.
  const missing = matches.filter(m => m.dbGame === null);
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} API game(s) have no DB row: ` +
      missing.map(m => `gamePk=${m.apiGame.gamePk} ${m.apiGame.awayAbbrev}@${m.apiGame.homeAbbrev} G${m.apiGame.gameNumber}`).join(", ") +
      ` — schedule sync should have inserted these (doubleheader-loss class)`
    );
  }
  return { matches, warnings };
}

/**
 * Fetches live MLB scores from the Stats API and updates the DB for today's games.
 *
 * Matching strategy (in priority order):
 *   1. mlbGamePk exact match (most reliable — gamePk is a stable unique ID)
 *   2. awayTeam + homeTeam + gameNumber / closest-start-time (doubleheader-safe fallback)
 *
 * Only updates rows where status or scores have actually changed to minimize
 * unnecessary DB writes.
 *
 * Also updates awayStartingPitcher / homeStartingPitcher when probable pitchers
 * are confirmed by the API.
 *
 * @param dateStr - Date in YYYY-MM-DD format (ET date)
 */
export async function refreshMlbScores(dateStr: string): Promise<{
  updated: number;
  unchanged: number;
  noMatch: number;
  errors: string[];
  /** Game PKs that transitioned to 'final' status in this cycle — triggers immediate backtest */
  newlyFinalGamePks: number[];
}> {
  const tag = `[MLBScoreRefresh][${dateStr}]`;
  console.log(`${tag} ════════════════════════════════════════════`);
  console.log(`${tag} Starting MLB score refresh for ${dateStr}`);

  let apiGames: MlbLiveGame[] = [];
  try {
    apiGames = await fetchMlbLiveScores(dateStr);
  } catch (err) {
    const msg = `${tag} ❌ API fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    return { updated: 0, unchanged: 0, noMatch: 0, errors: [msg], newlyFinalGamePks: [] };
  }

  if (apiGames.length === 0) {
    console.log(`${tag} No MLB games from API — nothing to update`);
    return { updated: 0, unchanged: 0, noMatch: 0, errors: [], newlyFinalGamePks: [] };
  }

  // Fetch all MLB games for this date from our DB
  const dbGames = await listGamesByDate(dateStr, "MLB");
  console.log(
    `${tag} DB has ${dbGames.length} MLB games for ${dateStr}` +
    ` | API returned ${apiGames.length} games`
  );

  // DOUBLEHEADER-SAFE matching (claim-based; a DB row serves at most one API game).
  // Replaces the single-slot `away@home` map that collapsed doubleheaders.
  const { matches, warnings: matchWarnings } = matchMlbLiveGamesToDbRows(apiGames, dbGames);
  for (const w of matchWarnings) console.warn(`${tag} [MATCH] ${w}`);

  let updated = 0;
  let unchanged = 0;
  let noMatch = 0;
  const errors: string[] = [];
  /** Tracks game PKs that transitioned to 'final' this cycle for immediate backtest trigger */
  const newlyFinalGamePks: number[] = [];

  for (const match of matches) {
    const apiGame = match.apiGame;
    try {
      const dbGame = match.dbGame;
      const matchMethod = match.matchMethod;

      if (!dbGame) {
        console.warn(
          `${tag} NO_MATCH: gamePk=${apiGame.gamePk} ${apiGame.awayAbbrev}@${apiGame.homeAbbrev} G${apiGame.gameNumber}` +
          ` | status=${apiGame.gameStatus} | score=${apiGame.awayRuns ?? "?"}-${apiGame.homeRuns ?? "?"}` +
          ` | DB has: [${dbGames.map((g) => `${g.awayTeam}@${g.homeTeam}#${g.gameNumber ?? 1}`).join(", ")}]`
        );
        noMatch++;
        continue;
      }

      // Determine what has changed
      const statusChanged = dbGame.gameStatus !== apiGame.gameStatus;
      // Track games that just transitioned to 'final' for immediate backtest trigger
      if (statusChanged && apiGame.gameStatus === 'final') {
        newlyFinalGamePks.push(apiGame.gamePk);
        console.log(
          `${tag} 🏁 NEWLY_FINAL: gamePk=${apiGame.gamePk} ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
          ` — will trigger immediate K-Props backtest`
        );
      }
      const scoresChanged =
        dbGame.awayScore !== apiGame.awayRuns ||
        dbGame.homeScore !== apiGame.homeRuns;
      const clockChanged = dbGame.gameClock !== apiGame.gameClock;

      // Check if pitcher info has changed (only update if API has data)
      const awayPitcherChanged =
        apiGame.awayProbablePitcher !== null &&
        dbGame.awayStartingPitcher !== apiGame.awayProbablePitcher;
      const homePitcherChanged =
        apiGame.homeProbablePitcher !== null &&
        dbGame.homeStartingPitcher !== apiGame.homeProbablePitcher;

      const hasChanges =
        statusChanged || scoresChanged || clockChanged ||
        awayPitcherChanged || homePitcherChanged;

      if (!hasChanges) {
        console.log(
          `${tag} UNCHANGED [${matchMethod}]: ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
          ` | status=${apiGame.gameStatus} score=${apiGame.awayRuns ?? "?"}-${apiGame.homeRuns ?? "?"}` +
          ` clock=${apiGame.gameClock ?? "—"}`
        );
        unchanged++;
        continue;
      }

      // Log what changed
      const changes: string[] = [];
      if (statusChanged) changes.push(`status: ${dbGame.gameStatus} → ${apiGame.gameStatus}`);
      if (scoresChanged) changes.push(`score: ${dbGame.awayScore ?? "?"}-${dbGame.homeScore ?? "?"} → ${apiGame.awayRuns ?? "?"}-${apiGame.homeRuns ?? "?"}`);
      if (clockChanged) changes.push(`clock: "${dbGame.gameClock ?? "—"}" → "${apiGame.gameClock ?? "—"}"`);
      if (awayPitcherChanged) changes.push(`awayPitcher: "${dbGame.awayStartingPitcher ?? "—"}" → "${apiGame.awayProbablePitcher}"`);
      if (homePitcherChanged) changes.push(`homePitcher: "${dbGame.homeStartingPitcher ?? "—"}" → "${apiGame.homeProbablePitcher}"`);

      console.log(
        `${tag} UPDATE [${matchMethod}]: ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
        ` (DB id=${dbGame.id}, gamePk=${apiGame.gamePk})` +
        ` | ${changes.join(" | ")}`
      );

      // Write to DB using the existing updateNcaaStartTime helper
      // (it updates gameStatus, awayScore, homeScore, gameClock — shared across all sports)
      await updateNcaaStartTime(dbGame.id, {
        startTimeEst: dbGame.startTimeEst,
        ncaaContestId: dbGame.ncaaContestId ?? String(apiGame.gamePk),
        gameStatus: apiGame.gameStatus,
        awayScore: apiGame.awayRuns,
        homeScore: apiGame.homeRuns,
        gameClock: apiGame.gameClock,
      });

      // ── Write actual scores + F5 + NRFI for final games ──────────────────────
      // These columns are consumed by mlbMultiMarketBacktest.ts for WIN/LOSS grading.
      // Only write when the game is final AND we have valid score data.
      // Uses a separate direct DB update to keep updateNcaaStartTime sport-agnostic.
      if (apiGame.gameStatus === "final" && apiGame.awayRuns !== null && apiGame.homeRuns !== null) {
        const db = await getDb();
        if (db) {
          // Build the update payload — only include F5/NRFI when computed
          const actualScoreUpdate: Record<string, number | string> = {
            actualAwayScore: apiGame.awayRuns,
            actualHomeScore: apiGame.homeRuns,
          };

          if (apiGame.awayF5Runs !== null && apiGame.homeF5Runs !== null) {
            actualScoreUpdate.actualF5AwayScore = apiGame.awayF5Runs;
            actualScoreUpdate.actualF5HomeScore = apiGame.homeF5Runs;
          }

          if (apiGame.nrfiResult !== null) {
            actualScoreUpdate.nrfiActualResult = apiGame.nrfiResult;
          }

          await db
            .update(games)
            .set(actualScoreUpdate)
            .where(eq(games.id, dbGame.id));

          // ── Post-write verification ───────────────────────────────────────────
          const [verify] = await db
            .select({
              actualAwayScore: games.actualAwayScore,
              actualHomeScore: games.actualHomeScore,
              actualF5AwayScore: games.actualF5AwayScore,
              actualF5HomeScore: games.actualF5HomeScore,
              nrfiActualResult: games.nrfiActualResult,
            })
            .from(games)
            .where(eq(games.id, dbGame.id));

          const fgMatch =
            verify.actualAwayScore === apiGame.awayRuns &&
            verify.actualHomeScore === apiGame.homeRuns;
          const f5Match =
            apiGame.awayF5Runs === null
              ? true
              : verify.actualF5AwayScore === apiGame.awayF5Runs &&
                verify.actualF5HomeScore === apiGame.homeF5Runs;
          const nrfiMatch =
            apiGame.nrfiResult === null
              ? true
              : verify.nrfiActualResult === apiGame.nrfiResult;

          if (fgMatch && f5Match && nrfiMatch) {
            console.log(
              `${tag} [VERIFY PASS] id=${dbGame.id} ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
              ` | actualFG=${verify.actualAwayScore}-${verify.actualHomeScore}` +
              ` | actualF5=${verify.actualF5AwayScore ?? "null"}-${verify.actualF5HomeScore ?? "null"}` +
              ` | nrfi=${verify.nrfiActualResult ?? "null"}`
            );
          } else {
            console.error(
              `${tag} [VERIFY FAIL] id=${dbGame.id} ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
              ` | fgMatch=${fgMatch} f5Match=${f5Match} nrfiMatch=${nrfiMatch}` +
              ` | expected FG=${apiGame.awayRuns}-${apiGame.homeRuns}` +
              ` F5=${apiGame.awayF5Runs ?? "null"}-${apiGame.homeF5Runs ?? "null"}` +
              ` nrfi=${apiGame.nrfiResult ?? "null"}` +
              ` | got FG=${verify.actualAwayScore}-${verify.actualHomeScore}` +
              ` F5=${verify.actualF5AwayScore ?? "null"}-${verify.actualF5HomeScore ?? "null"}` +
              ` nrfi=${verify.nrfiActualResult ?? "null"}`
            );
          }
        }
      }

      // Update pitcher info if changed
      // PITCHER OVERRIDE GUARD: If mlb_lineups has a Rotowire-sourced pitcher that
      // differs from the MLB Stats API probable pitcher, do NOT overwrite it.
      // This protects doubleheader G2 pitcher assignments (e.g. Robbie Ray for SF@ATL G2)
      // from being overwritten by the API returning the G1 pitcher (e.g. Adrian Houser).
      if (awayPitcherChanged || homePitcherChanged) {
        // Fetch lineup row for this game to check for Rotowire override
        const lineupMap = await getMlbLineupsByGameIds([dbGame.id]);
        const lineupRow = lineupMap.get(dbGame.id);
        const pitcherUpdate: Parameters<typeof updateBookOdds>[1] = {};
        if (awayPitcherChanged && apiGame.awayProbablePitcher) {
          // If mlb_lineups has a different pitcher name, skip the API overwrite
          if (
            lineupRow?.awayPitcherName &&
            lineupRow.awayPitcherName.trim().toLowerCase() !== apiGame.awayProbablePitcher.trim().toLowerCase()
          ) {
            console.warn(
              `${tag} [PITCHER_OVERRIDE] id=${dbGame.id} ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
              ` | API awayPitcher="${apiGame.awayProbablePitcher}" BLOCKED by Rotowire lineup` +
              ` awayPitcher="${lineupRow.awayPitcherName}" — keeping Rotowire value`
            );
          } else {
            pitcherUpdate.awayStartingPitcher = apiGame.awayProbablePitcher;
            pitcherUpdate.awayPitcherConfirmed = true;
          }
        }
        if (homePitcherChanged && apiGame.homeProbablePitcher) {
          // If mlb_lineups has a different pitcher name, skip the API overwrite
          if (
            lineupRow?.homePitcherName &&
            lineupRow.homePitcherName.trim().toLowerCase() !== apiGame.homeProbablePitcher.trim().toLowerCase()
          ) {
            console.warn(
              `${tag} [PITCHER_OVERRIDE] id=${dbGame.id} ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}` +
              ` | API homePitcher="${apiGame.homeProbablePitcher}" BLOCKED by Rotowire lineup` +
              ` homePitcher="${lineupRow.homePitcherName}" — keeping Rotowire value`
            );
          } else {
            pitcherUpdate.homeStartingPitcher = apiGame.homeProbablePitcher;
            pitcherUpdate.homePitcherConfirmed = true;
          }
        }
        if (Object.keys(pitcherUpdate).length > 0) {
          await updateBookOdds(dbGame.id, pitcherUpdate);
        }
      }

      updated++;
    } catch (err) {
      const msg =
        `${tag} ERROR updating gamePk=${apiGame.gamePk}` +
        ` ${apiGame.awayAbbrev}@${apiGame.homeAbbrev}: ` +
        (err instanceof Error ? err.message : String(err));
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `${tag} ✅ DONE — updated=${updated} unchanged=${unchanged}` +
    ` noMatch=${noMatch} errors=${errors.length}` +
    ` | live=${apiGames.filter((g) => g.gameStatus === "live").length}` +
    ` final=${apiGames.filter((g) => g.gameStatus === "final").length}`
  );
  // Boundary cardinality check: every provider game should have a DB row once
  // syncMlbSchedule (MLB cycle Step 0.5) has run. A persistent nonzero noMatch
  // is the doubleheader-loss signature — surface it as an ERROR, not a warning.
  if (noMatch > 0) {
    console.error(
      `${tag} [CARDINALITY] ❌ ${noMatch}/${apiGames.length} provider games have no DB row — ` +
      `feed is missing events (run syncMlbSchedule / check reconciliation alerts)`
    );
  }
  console.log(`${tag} ════════════════════════════════════════════`);

  return { updated, unchanged, noMatch, errors, newlyFinalGamePks };
}
