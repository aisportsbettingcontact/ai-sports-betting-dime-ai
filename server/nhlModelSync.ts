/**
 * nhlModelSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NHL model auto-detect cron.
 *
 * Execution flow:
 *   1. Detect all NHL games in the DB for today that have NOT yet been modeled
 *      (modelRunAt IS NULL) and are not live/final (gameStatus = 'upcoming')
 *   2. Scrape NaturalStatTrick team stats + goalie stats
 *   3. Scrape RotoWire starting goalies
 *   4. For each unmodeled game, build the engine input and run the Python model
 *   5. Write model output back to the games table (model fields only)
 *   6. Auto-approve projection (publishedModel = true) — owner has approved NHL model output
 *      Projections go live on the feed immediately after each successful model run.
 *
 * Schedule: runs every 30 minutes, 9AM–9PM PST (same window as NBA model sync)
 *
 * Manual trigger: call syncNhlModelForToday() directly from the tRPC procedure
 */

import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "./db.js";
import { bulkApproveModels } from "./db.js";
import { games } from "../drizzle/schema.js";
import type { Game } from "../drizzle/schema.js";
import { scrapeNhlTeamStats, scrapeNhlGoalieStats, getDefaultGoalieStats } from "./nhlNaturalStatScraper.js";
import { scrapeNhlTeamStatsFromHockeyRef, getHardcodedPlayoffTeamStats, fetchNhlPlayoffTeamStats, fetchNhlPlayoffGoalieStats } from "./nhlHockeyRefTeamStats.js";
import { scrapeNhlTeamStatsFromMoneyPuck, scrapeNhlGoalieStatsFromMoneyPuck } from "./nhlMoneyPuckFallback.js";
import { scrapeNhlStartingGoalies, matchGoalieName } from "./nhlRotoWireScraper.js";
import { runNhlModelForGame, runNhlModelBatch, buildTeamStatsDict, formatNhlML } from "./nhlModelEngine.js";
import type { NhlModelEngineInput } from "./nhlModelEngine.js";
import { NHL_BY_DB_SLUG } from "../shared/nhlTeams.js";
import { computeNhlRestDays } from "./nhlHockeyRefScraper.js";
import { fetchNhlGamesForRange } from "./nhlSchedule.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NhlModelSyncResult {
  synced:   number;
  skipped:  number;
  errors:   string[];
  syncedAt: string;
}

let lastSyncResult: NhlModelSyncResult | null = null;

export function getLastNhlSyncResult(): NhlModelSyncResult | null {
  return lastSyncResult;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayDate(): string {
  const now = new Date();
  // Use Eastern time for game date (NHL games are typically scheduled in ET)
  const etStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  // Convert MM/DD/YYYY → YYYY-MM-DD
  const [m, d, y] = etStr.split("/");
  return `${y}-${m}-${d}`;
}

function getPSTHour(): number {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(pstStr, 10);
}

function isWithinSyncWindow(): boolean {
  const h = getPSTHour();
  return h >= 9 && h < 21;
}

/** Convert American odds to break-even probability (0–1). */
const americanOddsToBreakEven = (odds: number | null): number | null => {
  if (odds === null) return null;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
};

/** Minimum edge (probability points above break-even) to flag a bet. */
const EDGE_THRESHOLD = 0.03;

/** Round a spread to nearest 0.5 */
function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Format a decimal ML to integer string with sign */
function fmtML(ml: number): string {
  const rounded = Math.round(ml);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

// ─── Core Sync Function ───────────────────────────────────────────────────────

/**
 * Run the NHL model for all unmodeled games today.
 * Called by the scheduler and by the manual triggerRefresh tRPC procedure.
 */
export async function syncNhlModelForToday(
  source: "auto" | "manual" = "auto",
  forceRerun = false,
  runAllStatuses = false,
  dateOverride?: string
): Promise<NhlModelSyncResult> {
  const gameDate = dateOverride ?? getTodayDate();
  const tag = source === "manual" ? "[MANUAL]" : "[AUTO]";

  console.log(`\n${"=".repeat(70)}`);
  console.log(`[NhlModelSync]${tag} ► START — date: ${gameDate}`);
  console.log(`${"=".repeat(70)}`);

  const result: NhlModelSyncResult = {
    synced: 0, skipped: 0, errors: [], syncedAt: new Date().toISOString(),
  };

  // ── Step 1: Find unmodeled NHL games for today ─────────────────────────────
  console.log(`[NhlModelSync]${tag} Step 1: Querying DB for unmodeled NHL games on ${gameDate}...`);

  const db = await getDb();

  // If forceRerun, clear modelRunAt for today's NHL games
  // runAllStatuses=true clears ALL statuses (upcoming + live + final)
  // forceRerun=true (without runAllStatuses) only clears upcoming
  if (forceRerun || runAllStatuses) {
    const statusMsg = runAllStatuses ? "ALL statuses (upcoming + live + final)" : "upcoming only";
    console.log(`[NhlModelSync]${tag}   forceRerun=true — clearing modelRunAt for NHL games today (${statusMsg})`);
    const clearWhere = runAllStatuses
      ? and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"))
      : and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"), eq(games.gameStatus, "upcoming"));
    await db.update(games).set({ modelRunAt: null }).where(clearWhere);
  }

  // Query games to model — runAllStatuses=true includes live/final games
  const statusFilter = runAllStatuses
    ? and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"), or(isNull(games.modelRunAt), isNull(games.modelAwayScore)))
    : and(eq(games.gameDate, gameDate), eq(games.sport, "NHL"), eq(games.gameStatus, "upcoming"), or(isNull(games.modelRunAt), isNull(games.modelAwayScore)));

  const unmodeled = await db
    .select()
    .from(games)
    .where(statusFilter);

  console.log(`[NhlModelSync]${tag}   Found ${unmodeled.length} unmodeled NHL game(s) for ${gameDate}`);

  if (unmodeled.length === 0) {
    // Also check if there are any NHL games at all today
    const allNhl = await db
      .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam, gameStatus: games.gameStatus, modelRunAt: games.modelRunAt })
      .from(games)
      .where(and(eq(games.gameDate, gameDate), eq(games.sport, "NHL")));

    console.log(`[NhlModelSync]${tag}   Total NHL games today: ${allNhl.length}`);
    allNhl.forEach((g: Pick<Game, 'awayTeam' | 'homeTeam' | 'gameStatus' | 'modelRunAt'>) => {
      console.log(`[NhlModelSync]${tag}     ${g.awayTeam} @ ${g.homeTeam} | status=${g.gameStatus} | modelRunAt=${g.modelRunAt ?? "null"}`);
    });

    if (allNhl.length === 0) {
      console.log(`[NhlModelSync]${tag} ✅ No NHL games today — nothing to model`);
    } else {
      console.log(`[NhlModelSync]${tag} ✅ All NHL games already modeled or live/final — skipping`);
    }
    result.syncedAt = new Date().toISOString();
    lastSyncResult = result;
    return result;
  }

  // Log all games to be modeled
  unmodeled.forEach((g: Game, i: number) => {
    console.log(`[NhlModelSync]${tag}   [${i + 1}/${unmodeled.length}] ${g.awayTeam} @ ${g.homeTeam} | bookSpread=${g.awayBookSpread}/${g.homeBookSpread} | total=${g.bookTotal} | ML=${g.awayML}/${g.homeML}`);
  });

  // ── Step 2: Scrape NaturalStatTrick team + goalie stats ───────────────────
  console.log(`\n[NhlModelSync]${tag} Step 2: Scraping NaturalStatTrick team + goalie stats...`);

  let teamStatsMap = new Map<string, import("./nhlNaturalStatScraper.js").NhlTeamStats>();
  let goalieStatsMap = new Map<string, import("./nhlNaturalStatScraper.js").NhlGoalieStats>();

  // Fetch team stats and goalie stats independently so one failure doesn't block the other
  const [teamStatsResult, goalieStatsResult] = await Promise.allSettled([
    scrapeNhlTeamStats(),
    scrapeNhlGoalieStats(),
  ]);

  if (teamStatsResult.status === "fulfilled" && teamStatsResult.value.size >= 30) {
    teamStatsMap = teamStatsResult.value;
    console.log(`[NhlModelSync]${tag}   ✅ Team stats (NST): ${teamStatsMap.size} teams`);
  } else {
    const nstMsg = teamStatsResult.status === "rejected"
      ? (teamStatsResult.reason instanceof Error ? teamStatsResult.reason.message : String(teamStatsResult.reason))
      : `only ${(teamStatsResult as PromiseFulfilledResult<any>).value.size} teams returned`;
    console.warn(`[NhlModelSync]${tag}   ⚠ NST team stats failed (${nstMsg}) — trying Hockey-Reference fallback...`);
    try {
      teamStatsMap = await scrapeNhlTeamStatsFromHockeyRef();
      if (teamStatsMap.size >= 30) {
        console.log(`[NhlModelSync]${tag}   ✅ Team stats (HR fallback): ${teamStatsMap.size} teams`);
      } else {
        throw new Error(`HR returned only ${teamStatsMap.size} teams (need ≥30)`);
      }
    } catch (hrErr) {
      const hrMsg = hrErr instanceof Error ? hrErr.message : String(hrErr);
      console.warn(`[NhlModelSync]${tag}   ⚠ HR fallback failed (${hrMsg}) — trying MoneyPuck fallback (tier 3)...`);
      try {
        teamStatsMap = await scrapeNhlTeamStatsFromMoneyPuck();
        if (teamStatsMap.size >= 30) {
          console.log(`[NhlModelSync]${tag}   ✅ Team stats (MoneyPuck fallback): ${teamStatsMap.size} teams`);
        } else {
          throw new Error(`MoneyPuck returned only ${teamStatsMap.size} teams (need ≥30)`);
        }
      } catch (mpErr) {
        const mpMsg = mpErr instanceof Error ? mpErr.message : String(mpErr);
        console.warn(`[NhlModelSync]${tag}   ⚠ MoneyPuck fallback failed (${mpMsg}) — trying hardcoded playoff stats (tier 4)...`);
        // Tier 4: Hardcoded 2025-26 regular season per-60 stats for all 16 playoff teams.
        // These are derived from NHL Stats API data and are always available (no network required).
        // Covers the scenario where all 3 external scrapers are Cloudflare-blocked simultaneously.
        const hardcoded = getHardcodedPlayoffTeamStats();
        if (hardcoded.size >= 8) {
          teamStatsMap = hardcoded;
          console.log(`[NhlModelSync]${tag}   ✅ Team stats (hardcoded playoff fallback): ${teamStatsMap.size} teams`);
          result.errors.push(`Team stats: using hardcoded 2025-26 regular season fallback (NST: ${nstMsg}; HR: ${hrMsg}; MP: ${mpMsg})`);
        } else {
          console.error(`[NhlModelSync]${tag}   ✗ All 4 team stat sources failed — using league-average defaults`);
          console.error(`[NhlModelSync]${tag}     NST: ${nstMsg}`);
          console.error(`[NhlModelSync]${tag}     HR:  ${hrMsg}`);
          console.error(`[NhlModelSync]${tag}     MP:  ${mpMsg}`);
          result.errors.push(`Team stats scrape failed (NST: ${nstMsg}; HR: ${hrMsg}; MP: ${mpMsg})`);
        }
      }
    }
  }

  if (goalieStatsResult.status === "fulfilled" && goalieStatsResult.value.size >= 10) {
    goalieStatsMap = goalieStatsResult.value;
    console.log(`[NhlModelSync]${tag}   ✅ Goalie stats (NST): ${Math.floor(goalieStatsMap.size / 2)} goalies`);
  } else {
    const nstGoalieMsg = goalieStatsResult.status === "rejected"
      ? (goalieStatsResult.reason instanceof Error ? goalieStatsResult.reason.message : String(goalieStatsResult.reason))
      : `only ${(goalieStatsResult as PromiseFulfilledResult<any>).value.size} goalies returned`;
    console.warn(`[NhlModelSync]${tag}   ⚠ NST goalie stats failed (${nstGoalieMsg}) — trying MoneyPuck goalie fallback...`);
    try {
      goalieStatsMap = await scrapeNhlGoalieStatsFromMoneyPuck();
      if (goalieStatsMap.size >= 10) {
        console.log(`[NhlModelSync]${tag}   ✅ Goalie stats (MoneyPuck fallback): ${goalieStatsMap.size} goalies`);
      } else {
        throw new Error(`MoneyPuck returned only ${goalieStatsMap.size} goalies (need ≥10)`);
      }
    } catch (mpGoalieErr) {
      const mpGoalieMsg = mpGoalieErr instanceof Error ? mpGoalieErr.message : String(mpGoalieErr);
      console.error(`[NhlModelSync]${tag}   ✗ All goalie stat sources failed — using defaults for all goalies`);
      console.error(`[NhlModelSync]${tag}     NST: ${nstGoalieMsg}`);
      console.error(`[NhlModelSync]${tag}     MP:  ${mpGoalieMsg}`);
      result.errors.push(`Goalie stats scrape failed (NST: ${nstGoalieMsg}; MP: ${mpGoalieMsg})`);
    }
  }

  // ── Step 3: Scrape RotoWire starting goalies ──────────────────────────────
  console.log(`\n[NhlModelSync]${tag} Step 3: Scraping RotoWire starting goalies...`);

  const goalieByTeam = new Map<string, { name: string; confirmed: boolean }>();

  try {
    const rotoGames = await scrapeNhlStartingGoalies();
    console.log(`[NhlModelSync]${tag}   RotoWire returned ${rotoGames.length} games`);

    for (const rg of rotoGames) {
      if (rg.awayGoalie) {
        goalieByTeam.set(rg.awayTeam, { name: rg.awayGoalie.name, confirmed: rg.awayGoalie.confirmed });
        console.log(`[NhlModelSync]${tag}     ${rg.awayTeam} (away): ${rg.awayGoalie.name} (${rg.awayGoalie.confirmed ? "CONFIRMED" : "PROJECTED"})`);
      }
      if (rg.homeGoalie) {
        goalieByTeam.set(rg.homeTeam, { name: rg.homeGoalie.name, confirmed: rg.homeGoalie.confirmed });
        console.log(`[NhlModelSync]${tag}     ${rg.homeTeam} (home): ${rg.homeGoalie.name} (${rg.homeGoalie.confirmed ? "CONFIRMED" : "PROJECTED"})`);
      }
    }
    console.log(`[NhlModelSync]${tag}   ✅ Goalies mapped for ${goalieByTeam.size} teams`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NhlModelSync]${tag}   ⚠ RotoWire scrape failed: ${msg}`);
    console.error(`[NhlModelSync]${tag}   Proceeding without starting goalie data`);
    result.errors.push(`RotoWire scrape failed: ${msg}`);
  }

  // ── Step 4: Run model for each unmodeled game ─────────────────────────────
  console.log(`\n[NhlModelSync]${tag} Step 4: Running NHL model for ${unmodeled.length} game(s)...`);

  // ── Phase A-1: Detect playoff games via NHL schedule API ────────────────────────────────
  // The DB games table does not store NHL gameType. We detect playoffs by cross-referencing
  // the NHL schedule API which returns gameType: 1=preseason, 2=regular, 3=playoffs.
  // If the API call fails, we fall back to date-based detection (April 20 – June 30 = playoffs).
  console.log(`[NhlModelSync]${tag} Step 4A-1: Detecting playoff games via NHL schedule API...`);
  const nhlScheduleGameTypeMap = new Map<string, number>(); // key: "awaySlug@homeSlug" → gameType
  let isPlayoffSeason = false;
  try {
    const scheduleGames = await fetchNhlGamesForRange(gameDate, gameDate);
    for (const sg of scheduleGames) {
      const key = `${sg.awayDbSlug}@${sg.homeDbSlug}`;
      nhlScheduleGameTypeMap.set(key, sg.gameType);
      if (sg.gameType === 3) isPlayoffSeason = true;
    }
    console.log(`[NhlModelSync]${tag}   ✅ NHL schedule fetched: ${scheduleGames.length} games, isPlayoffSeason=${isPlayoffSeason}`);
  } catch (schedErr) {
    const schedMsg = schedErr instanceof Error ? schedErr.message : String(schedErr);
    console.warn(`[NhlModelSync]${tag}   ⚠ NHL schedule fetch failed (${schedMsg}) — using date-based playoff detection`);
    // Date-based fallback: NHL playoffs run April 20 – June 30
    const month = new Date(gameDate).getMonth() + 1; // 1-indexed
    isPlayoffSeason = month >= 4 && month <= 6;
    console.log(`[NhlModelSync]${tag}   Date-based playoff detection: month=${month} isPlayoffSeason=${isPlayoffSeason}`);
  }

  // ── Phase A-2: If playoff season, fetch playoff team + goalie stats from NHL API ──────────
  let playoffTeamStatsMap = new Map<string, import("./nhlNaturalStatScraper.js").NhlTeamStats>();
  let playoffGoalieStatsMap = new Map<string, import("./nhlNaturalStatScraper.js").NhlGoalieStats>();
  if (isPlayoffSeason) {
    console.log(`[NhlModelSync]${tag} Step 4A-2: Fetching playoff team + goalie stats from NHL API...`);
    const [playoffTeamResult, playoffGoalieResult] = await Promise.allSettled([
      fetchNhlPlayoffTeamStats(),
      fetchNhlPlayoffGoalieStats(),
    ]);
    if (playoffTeamResult.status === "fulfilled" && playoffTeamResult.value.size >= 4) {
      playoffTeamStatsMap = playoffTeamResult.value;
      console.log(`[NhlModelSync]${tag}   ✅ Playoff team stats (NHL API): ${playoffTeamStatsMap.size} teams`);
    } else {
      const msg = playoffTeamResult.status === "rejected"
        ? (playoffTeamResult.reason instanceof Error ? playoffTeamResult.reason.message : String(playoffTeamResult.reason))
        : `only ${(playoffTeamResult as PromiseFulfilledResult<any>).value.size} teams`;
      console.warn(`[NhlModelSync]${tag}   ⚠ Playoff team stats fetch failed (${msg}) — will use regular season stats with playoff_mode=true`);
      result.errors.push(`Playoff team stats: ${msg}`);
    }
    if (playoffGoalieResult.status === "fulfilled" && playoffGoalieResult.value.size >= 4) {
      playoffGoalieStatsMap = playoffGoalieResult.value;
      console.log(`[NhlModelSync]${tag}   ✅ Playoff goalie stats (NHL API): ${playoffGoalieStatsMap.size} goalies`);
    } else {
      const msg = playoffGoalieResult.status === "rejected"
        ? (playoffGoalieResult.reason instanceof Error ? playoffGoalieResult.reason.message : String(playoffGoalieResult.reason))
        : `only ${(playoffGoalieResult as PromiseFulfilledResult<any>).value.size} goalies`;
      console.warn(`[NhlModelSync]${tag}   ⚠ Playoff goalie stats fetch failed (${msg}) — will use regular season goalie stats`);
      result.errors.push(`Playoff goalie stats: ${msg}`);
    }
  }

  // ── Phase A0: Pre-fetch all rest days in parallel ─────────────────────────────────────────
  // computeNhlRestDays makes a network call to Hockey Reference per game.
  // Running them sequentially would take N×30s. Run all in parallel first.
  console.log(`[NhlModelSync]${tag} Step 4A0: Pre-fetching rest days for ${unmodeled.length} game(s) in parallel...`);
  const restDaysMap = new Map<number, { awayRestDays: number; homeRestDays: number }>();
  await Promise.allSettled(
    unmodeled.map(async (game: typeof unmodeled[number]) => {
      try {
        const rd = await computeNhlRestDays(game.awayTeam, game.homeTeam, gameDate);
        restDaysMap.set(game.id, rd);
      } catch (e) {
        // Default to 2 rest days (mid-week) if scrape fails — non-fatal
        restDaysMap.set(game.id, { awayRestDays: 2, homeRestDays: 2 });
        console.warn(`[NhlModelSync]${tag}   [REST DAYS] Failed for game ${game.id}: ${e instanceof Error ? e.message : String(e)} — defaulting to 2/2`);
      }
    })
  );
  console.log(`[NhlModelSync]${tag}   Rest days pre-fetched for ${restDaysMap.size}/${unmodeled.length} games`);

  // ── Phase A: Build all engine inputs (async: rest days, goalie resolution) ──────────────
  // Collect validated game contexts. Games that fail validation are skipped immediately.
  type GameContext = {
    game:                  typeof unmodeled[number];
    gameLabel:             string;
    awayAbbrev:            string;
    homeAbbrev:            string;
    awayGoalieName:        string | null;
    homeGoalieName:        string | null;
    awayGoalieInfo:        { name: string; confirmed: boolean } | null;
    homeGoalieInfo:        { name: string; confirmed: boolean } | null;
    mktAwayPLOdds:         number | null;
    mktHomePLOdds:         number | null;
    mktTotal:              number | null;
    correctedAwaySpread:   number | null;
    correctedAwaySpreadStr: string | null;
    correctedHomeSpreadStr: string | null;
    engineInput:           NhlModelEngineInput;
  };
  const gameContexts: GameContext[] = [];

  for (let i = 0; i < unmodeled.length; i++) {
    const game = unmodeled[i];

    // Resolve 3-letter abbrev from dbSlug (e.g. "boston_bruins" → "BOS")
    const awayTeamEntry = NHL_BY_DB_SLUG.get(game.awayTeam);
    const homeTeamEntry = NHL_BY_DB_SLUG.get(game.homeTeam);
    const awayAbbrev = awayTeamEntry?.abbrev ?? game.awayTeam.toUpperCase();
    const homeAbbrev = homeTeamEntry?.abbrev ?? game.homeTeam.toUpperCase();
    const gameLabel  = `${awayAbbrev} @ ${homeAbbrev}`;

    console.log(`\n[NhlModelSync]${tag} ── Game ${i + 1}/${unmodeled.length}: ${gameLabel} (${game.awayTeam} @ ${game.homeTeam}) ──`);

    try {
      // Detect if this specific game is a playoff game
      const scheduleKey = `${game.awayTeam}@${game.homeTeam}`;
      const gameTypeFromSchedule = nhlScheduleGameTypeMap.get(scheduleKey);
      const isPlayoffGame = gameTypeFromSchedule === 3 || (isPlayoffSeason && gameTypeFromSchedule === undefined);
      console.log(`[NhlModelSync]${tag}   Game type: ${isPlayoffGame ? 'PLAYOFF (gameType=3)' : 'REGULAR SEASON (gameType=2)'} (scheduleKey=${scheduleKey}, gameTypeFromSchedule=${gameTypeFromSchedule ?? 'not found'})`);

      // Resolve team stats — for playoff games, prefer playoff stats from NHL API
      // For regular season games, use the NST/HR/MP scraped stats
      let awayStats = isPlayoffGame && playoffTeamStatsMap.size > 0
        ? (playoffTeamStatsMap.get(awayAbbrev) ?? teamStatsMap.get(awayAbbrev))
        : teamStatsMap.get(awayAbbrev);
      let homeStats = isPlayoffGame && playoffTeamStatsMap.size > 0
        ? (playoffTeamStatsMap.get(homeAbbrev) ?? teamStatsMap.get(homeAbbrev))
        : teamStatsMap.get(homeAbbrev);

      if (!awayStats || !homeStats) {
        const missing = [!awayStats && awayAbbrev, !homeStats && homeAbbrev].filter(Boolean).join(", ");
        throw new Error(`Team stats not available for: ${missing}. NST scrape may have failed or team abbreviation mismatch.`);
      }

      const statsSource = isPlayoffGame && playoffTeamStatsMap.size > 0 ? 'NHL API playoff' : 'NST/HR/MP regular season';
      console.log(`[NhlModelSync]${tag}   Away (${awayAbbrev}) [${statsSource}]: xGF%=${awayStats.xGF_pct.toFixed(2)} xGF/60=${awayStats.xGF_60.toFixed(3)} HDCF/60=${awayStats.HDCF_60.toFixed(3)} SCF/60=${awayStats.SCF_60.toFixed(3)} CF/60=${awayStats.CF_60.toFixed(3)}`);
      console.log(`[NhlModelSync]${tag}   Home (${homeAbbrev}) [${statsSource}]: xGF%=${homeStats.xGF_pct.toFixed(2)} xGF/60=${homeStats.xGF_60.toFixed(3)} HDCF/60=${homeStats.HDCF_60.toFixed(3)} SCF/60=${homeStats.SCF_60.toFixed(3)} CF/60=${homeStats.CF_60.toFixed(3)}`);

      // Resolve starting goalies
      const awayGoalieInfo = goalieByTeam.get(awayAbbrev) ?? null;
      const homeGoalieInfo = goalieByTeam.get(homeAbbrev) ?? null;
      const awayGoalieName = awayGoalieInfo?.name ?? null;
      const homeGoalieName = homeGoalieInfo?.name ?? null;

      // For playoff games, prefer playoff goalie stats from NHL API
      // For regular season games, use NST/MP scraped stats
      const effectiveGoalieStatsMap = isPlayoffGame && playoffGoalieStatsMap.size > 0
        ? playoffGoalieStatsMap
        : goalieStatsMap;
      const goalieStatsSource = isPlayoffGame && playoffGoalieStatsMap.size > 0 ? 'NHL API playoff' : 'NST/MP regular season';

      const awayGoalieStats = awayGoalieName
        ? (matchGoalieName(awayGoalieName, effectiveGoalieStatsMap) ?? getDefaultGoalieStats(awayGoalieName, awayAbbrev))
        : getDefaultGoalieStats("TBD", awayAbbrev);
      const homeGoalieStats = homeGoalieName
        ? (matchGoalieName(homeGoalieName, effectiveGoalieStatsMap) ?? getDefaultGoalieStats(homeGoalieName, homeAbbrev))
        : getDefaultGoalieStats("TBD", homeAbbrev);

      console.log(`[NhlModelSync]${tag}   Away goalie: ${awayGoalieName ?? "TBD"} [${goalieStatsSource}] | GSAx=${awayGoalieStats.gsax.toFixed(2)} SV%=${awayGoalieStats.sv_pct} GP=${awayGoalieStats.gp}`);
      console.log(`[NhlModelSync]${tag}   Home goalie: ${homeGoalieName ?? "TBD"} [${goalieStatsSource}] | GSAx=${homeGoalieStats.gsax.toFixed(2)} SV%=${homeGoalieStats.sv_pct} GP=${homeGoalieStats.gp}`);

      // ── CRITICAL: Require confirmed DK puck line before running model ──────────────────
      if (!game.awayBookSpread || !game.bookTotal || !game.awayML || !game.homeML) {
        const missing: string[] = [];
        if (!game.awayBookSpread) missing.push('awayBookSpread [PL GATE]');
        if (!game.bookTotal) missing.push('bookTotal');
        if (!game.awayML) missing.push('awayML');
        if (!game.homeML) missing.push('homeML');
        console.warn(`[NhlModelSync]${tag}   SKIP ${gameLabel} — missing required book lines: ${missing.join(', ')}`);
        result.skipped++;
        continue;
      }

      // Parse book lines from DB
      const mktAwayPLOdds  = game.awaySpreadOdds ? parseInt(game.awaySpreadOdds, 10) : null;
      const mktHomePLOdds  = game.homeSpreadOdds ? parseInt(game.homeSpreadOdds, 10) : null;
      const mktTotal       = game.bookTotal ? parseFloat(String(game.bookTotal)) : null;
      const mktOverOdds    = game.overOdds ? parseInt(game.overOdds, 10) : null;
      const mktUnderOdds   = game.underOdds ? parseInt(game.underOdds, 10) : null;
      const mktAwayML      = game.awayML ? parseInt(game.awayML, 10) : null;
      const mktHomeML      = game.homeML ? parseInt(game.homeML, 10) : null;

      // ── PUCK LINE SPREAD: Trust AN API spread value directly ────────────────────────────
      // In NHL puck lines, the spread value itself is authoritative: +1.5 = dog, -1.5 = fav.
      // The odds sign is NOT reliable for determining fav/dog because the dog at +1.5 often
      // has negative odds (e.g., -155) since covering +1.5 is easier than covering -1.5.
      // DO NOT apply any sign correction — pass rawAwaySpread directly to Python.
      const rawAwaySpread = game.awayBookSpread != null ? parseFloat(String(game.awayBookSpread)) : null;
      const correctedAwaySpread = rawAwaySpread;  // No correction — AN API spread is authoritative
      const correctedAwaySpreadStr = correctedAwaySpread !== null
        ? (correctedAwaySpread >= 0 ? `+${correctedAwaySpread}` : String(correctedAwaySpread))
        : null;
      const correctedHomeSpreadStr = correctedAwaySpread !== null
        ? (correctedAwaySpread >= 0 ? `-${Math.abs(correctedAwaySpread)}` : `+${Math.abs(correctedAwaySpread)}`)
        : null;
      // ─────────────────────────────────────────────────────────────────────────────────────

      console.log(`[NhlModelSync]${tag}   Market lines: PL=${mktAwayPLOdds}/${mktHomePLOdds} Total=${mktTotal} (${mktOverOdds}/${mktUnderOdds}) ML=${mktAwayML}/${mktHomeML}`);
      console.log(`[NhlModelSync]${tag}   [INPUT] awaySpread=${correctedAwaySpread} (raw from AN API — no sign correction applied; +1.5=dog, -1.5=fav)`);

      // Use pre-fetched rest days (fetched in parallel in Phase A0)
      const restDays = restDaysMap.get(game.id) ?? { awayRestDays: 2, homeRestDays: 2 };
      console.log(`[NhlModelSync]${tag}   Rest days: away=${restDays.awayRestDays}d home=${restDays.homeRestDays}d`);

      // Build engine input
      // For playoff games: use playoff team stats (already resolved above) and set playoff_mode=true
      // The playoff_mode flag tells the Python engine to use playoff league averages
      // (LEAGUE_GOAL_RATE=2.83, GOALIE_REGRESSION_K=200) instead of regular season values.
      const effectiveTeamStatsMap = isPlayoffGame && playoffTeamStatsMap.size > 0
        ? playoffTeamStatsMap
        : teamStatsMap;
      if (isPlayoffGame) {
        console.log(`[NhlModelSync]${tag}   🏆 PLAYOFF GAME — using playoff_mode=true with ${statsSource} stats`);
      }
      const engineInput: NhlModelEngineInput = {
        away_team:                awayAbbrev,
        home_team:                homeAbbrev,
        away_abbrev:              awayAbbrev,
        home_abbrev:              homeAbbrev,
        away_goalie:              awayGoalieName,
        home_goalie:              homeGoalieName,
        away_goalie_gp:           awayGoalieStats.gp,
        home_goalie_gp:           homeGoalieStats.gp,
        away_goalie_gsax:         awayGoalieStats.gsax,
        home_goalie_gsax:         homeGoalieStats.gsax,
        away_goalie_shots_faced:  awayGoalieStats.shots ?? undefined,
        home_goalie_shots_faced:  homeGoalieStats.shots ?? undefined,
        away_rest_days:           restDays.awayRestDays,
        home_rest_days:           restDays.homeRestDays,
        mkt_puck_line:            1.5,
        mkt_away_spread:          correctedAwaySpread,
        mkt_away_pl_odds:         mktAwayPLOdds,
        mkt_home_pl_odds:         mktHomePLOdds,
        mkt_total:                mktTotal,
        mkt_over_odds:            mktOverOdds,
        mkt_under_odds:           mktUnderOdds,
        mkt_away_ml:              mktAwayML,
        mkt_home_ml:              mktHomeML,
        team_stats:               buildTeamStatsDict(awayAbbrev, homeAbbrev, effectiveTeamStatsMap),
        playoff_mode:             isPlayoffGame,
      };

      gameContexts.push({
        game, gameLabel, awayAbbrev, homeAbbrev,
        awayGoalieName, homeGoalieName, awayGoalieInfo, homeGoalieInfo,
        mktAwayPLOdds, mktHomePLOdds, mktTotal,
        correctedAwaySpread, correctedAwaySpreadStr, correctedHomeSpreadStr,
        engineInput,
      });

    } catch (err) {
      const awayTeamEntry2 = NHL_BY_DB_SLUG.get(game.awayTeam);
      const homeTeamEntry2 = NHL_BY_DB_SLUG.get(game.homeTeam);
      const awayAbbrev2 = awayTeamEntry2?.abbrev ?? game.awayTeam.toUpperCase();
      const homeAbbrev2 = homeTeamEntry2?.abbrev ?? game.homeTeam.toUpperCase();
      const gameLabel2 = `${awayAbbrev2} @ ${homeAbbrev2}`;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[NhlModelSync]${tag}   ✗ Error building input for ${gameLabel2}: ${msg}`);
      result.errors.push(`${gameLabel2}: ${msg}`);
      result.skipped++;
    }
  }

  // ── Phase B: Batch dispatch — ONE Python process for all validated games ─────────────────
  console.log(`\n[NhlModelSync]${tag} Step 4B: Dispatching batch Python engine for ${gameContexts.length} game(s)...`);
  const batchResults = gameContexts.length > 0
    ? await runNhlModelBatch(gameContexts.map(ctx => ctx.engineInput))
    : [];

  // ── Phase C: Process results + write DB per game ─────────────────────────────────────────
  for (let i = 0; i < gameContexts.length; i++) {
    const ctx = gameContexts[i];
    const { game, gameLabel, awayAbbrev, homeAbbrev, awayGoalieName, homeGoalieName,
            awayGoalieInfo, homeGoalieInfo, mktAwayPLOdds, mktHomePLOdds, mktTotal,
            correctedAwaySpread, correctedAwaySpreadStr, correctedHomeSpreadStr } = ctx;
    const modelResult = batchResults[i];

    try {
      // Run the Python model
      // (result already computed in batch above)

      if (!modelResult.ok) {
        console.error(`[NhlModelSync]${tag}   ✗ Model failed for ${gameLabel}: ${modelResult.error}`);
        result.errors.push(`Model failed for ${gameLabel}: ${modelResult.error}`);
        result.skipped++;
        continue;
      }

      // ── Extract edges from Python Sharp Edge Detection Engine ───────────────────────────
      // The Python model already implements the full Sharp Edge Detection spec:
      //   - Distribution-translated probabilities at market threshold
      //   - Vig removal (true no-vig market probabilities)
      //   - EV calculation, price edge, edge classification
      // We read the results directly instead of re-computing in TypeScript.

      // ── Market values from simulation distribution (NOT goal differential) ──
      // modelResult.away_puck_line / home_puck_line = "+1.5" / "-1.5" (or ±2.5)
      // derived from P(margin >= 2) and P(margin >= 3) in the simulation.
      // modelResult.total_line = mean of total distribution, rounded to nearest 0.5.
      // NEVER use proj_away_goals - proj_home_goals as the spread.
      const modelAwayPL  = modelResult.away_puck_line;   // e.g. "+1.5" or "-2.5"
      const modelHomePL  = modelResult.home_puck_line;   // e.g. "-1.5" or "+2.5"
      const modelTotalVal = modelResult.total_line;       // from simulation distribution

      // Find the best puck line edge from model output
      const plEdges = modelResult.edges.filter(e => e.type === "PUCK_LINE");
      const bestPLEdge = plEdges.sort((a, b) => b.edge_vs_be - a.edge_vs_be)[0] ?? null;

      let spreadEdge: string | null = null;
      let spreadDiff: string | null = null;

      if (bestPLEdge && bestPLEdge.classification !== "NO EDGE") {
        // Use the BOOK's puck line for the edge label — must mirror what DK actually offers.
        // e.g. if DK has STL +1.5 (away underdog), label must say "STL +1.5", not "STL -1.5".
        const fmtSpread = (v: number | string | null | undefined): string => {
          if (v == null) return "±1.5";
          const n = parseFloat(String(v));
          return isNaN(n) ? "±1.5" : (n >= 0 ? `+${n}` : String(n));
        };
        const bookAwayPLLabel = fmtSpread(game.awayBookSpread);
        const bookHomePLLabel = fmtSpread(game.homeBookSpread);
        const sideLabel = bestPLEdge.side.startsWith("AWAY")
          ? `${awayAbbrev} ${bookAwayPLLabel}`
          : `${homeAbbrev} ${bookHomePLLabel}`;
        spreadEdge = `${sideLabel} [${bestPLEdge.classification}]`;
        spreadDiff = String(bestPLEdge.edge_vs_be);  // probability edge in pp
      } else if (mktAwayPLOdds !== null) {
        // No edge but market odds exist — compute raw probability diff for display
        // Use book-line cover% (mkt_pl_away_cover_pct) to match the book-line odds in mkt_pl_away_odds
        const awayPLCoverPct = ((modelResult.mkt_pl_away_cover_pct ?? modelResult.away_pl_cover_pct)) / 100;
        const mktAwayBreakEven = americanOddsToBreakEven(mktAwayPLOdds);
        if (mktAwayBreakEven !== null) {
          const diff = awayPLCoverPct - mktAwayBreakEven;
          spreadDiff = String(roundToHalf(diff * 100));  // in probability points
        }
      }

      // Find the best total edge from model output
      const totalEdges = modelResult.edges.filter(e => e.type === "TOTAL");
      const bestTotalEdge = totalEdges.sort((a, b) => b.edge_vs_be - a.edge_vs_be)[0] ?? null;

      let totalEdge: string | null = null;
      let totalDiff: string | null = null;

      if (bestTotalEdge && bestTotalEdge.classification !== "NO EDGE") {
        totalEdge = `${bestTotalEdge.side} [${bestTotalEdge.classification}]`;
        totalDiff = String(bestTotalEdge.edge_vs_be);
      } else if (mktTotal !== null) {
        // No edge but market total exists — compute raw diff between model and market line
        const diff = modelTotalVal - mktTotal;
        totalDiff = String(roundToHalf(diff));
        if (Math.abs(diff) >= 0.5) {
          totalEdge = diff > 0 ? `OVER ${roundToHalf(modelTotalVal)}` : `UNDER ${roundToHalf(modelTotalVal)}`;
        }
      }

      console.log(`[NhlModelSync]${tag}   Model result: Goals=${modelResult.proj_away_goals}/${modelResult.proj_home_goals} | PL=${modelAwayPL}/${modelHomePL} (edge=${spreadEdge ?? "NONE"}) | Total=${modelTotalVal} (edge=${totalEdge ?? "NONE"})`);
      console.log(`[NhlModelSync]${tag}   PL odds: ${modelResult.away_puck_line_odds}/${modelResult.home_puck_line_odds} | ML: ${modelResult.away_ml}/${modelResult.home_ml} | O/U odds: ${modelResult.over_odds}/${modelResult.under_odds}`);
      const mktPLAwayCover = modelResult.mkt_pl_away_cover_pct ?? modelResult.away_pl_cover_pct;
      const mktPLHomeCover = modelResult.mkt_pl_home_cover_pct ?? modelResult.home_pl_cover_pct;
      console.log(`[NhlModelSync]${tag}   Win%: away=${modelResult.away_win_pct}% home=${modelResult.home_win_pct}% | PL cover% (book line): away=${mktPLAwayCover}% home=${mktPLHomeCover}%`);
      if (modelResult.edges.length > 0) {
        console.log(`[NhlModelSync]${tag}   Edges: ${modelResult.edges.map(e => `${e.type}:${e.side}(${e.classification}, EV=${e.ev?.toFixed(1)}%, edge=${e.edge_vs_be}pp)`).join(" | ")}`);
      } else {
        console.log(`[NhlModelSync]${tag}   Edges: none`);
      }

      // ── Write to DB ──────────────────────────────────────────────────────
      await db
        .update(games)
        .set({
          // Spread (puck line) — MUST mirror the BOOK's spread direction, not the model's own origination.
          // modelAwayPL / modelHomePL are the model's own origination line (may differ from book direction).
          // correctedAwaySpreadStr is derived from awayBookSpread (the book's authoritative spread).
          // CRITICAL: awayModelSpread MUST use correctedAwaySpreadStr so the MODEL column always shows
          //   the same side as the BOOK column. Using modelAwayPL here causes the flip bug:
          //   e.g. book has EDM -1.5 (fav) but model shows +1.5 (dog) in the spread column.
          awayModelSpread:     correctedAwaySpreadStr ?? modelAwayPL,
          homeModelSpread:     correctedHomeSpreadStr ?? modelHomePL,
          spreadEdge:          spreadEdge ?? undefined,
          spreadDiff:          spreadDiff ?? undefined,
          // Total — ALWAYS anchored to book O/U line (mktTotal), NOT model-derived line
          // CRITICAL: modelTotal must equal bookTotal so displayed model line matches book line
          // modelTotalVal = model's own optimal line (may differ from book by 0.5)
          // mktTotal = the actual book total we must display at
          modelTotal:          mktTotal !== null ? String(mktTotal) : String(roundToHalf(modelTotalVal)),
          totalEdge:           totalEdge ?? undefined,
          totalDiff:           totalDiff ?? undefined,
          // Moneylines
          modelAwayML:         fmtML(modelResult.away_ml),
          modelHomeML:         fmtML(modelResult.home_ml),
          // Scores
          modelAwayScore:      String(modelResult.proj_away_goals),
          modelHomeScore:      String(modelResult.proj_home_goals),
          // Win/cover probabilities
          modelAwayWinPct:     String(modelResult.away_win_pct),
          modelHomeWinPct:     String(modelResult.home_win_pct),
          modelOverRate:       String(modelResult.over_pct),
          modelUnderRate:      String(modelResult.under_pct),
          // CRITICAL: use mkt_pl_*_cover_pct (cover% AT the book's line) to match mkt_pl_*_odds.
          // away_pl_cover_pct is the model's own origination line cover% — a DIFFERENT line when
          // model and book disagree on the favorite. Using the book-line cover% ensures
          // modelAwayPLCoverPct and modelAwayPLOdds are always for the same line.
          modelAwayPLCoverPct: String(modelResult.mkt_pl_away_cover_pct ?? modelResult.away_pl_cover_pct),
          modelHomePLCoverPct: String(modelResult.mkt_pl_home_cover_pct ?? modelResult.home_pl_cover_pct),
          // Puck line spread for MODEL column must MIRROR the BOOK's spread (not model's own origination).
          // e.g. if book has STL +1.5 (away underdog), model must show +1.5 (not -1.5).
          // The model's fair odds for that side are mkt_pl_away_odds / mkt_pl_home_odds.
          // Puck line labels: ALWAYS use correctedAwaySpreadStr (odds-authoritative sign).
          // correctedAwaySpreadStr accounts for awayBookSpread sign errors in the AN API.
          // e.g. STL@UTA: awayBookSpread=-1.5 (wrong) → corrected to +1.5 (STL is the dog at +200)
          modelAwayPuckLine:   correctedAwaySpreadStr ?? modelResult.away_puck_line,
          modelHomePuckLine:   correctedHomeSpreadStr ?? modelResult.home_puck_line,
          // Model fair odds AT the BOOK's ±1.5 puck line (for side-by-side display)
          // e.g. book shows +1.5 (-198), model shows +1.5 (-143) → edge detected
          // Python computed these from the corrected mkt_away_spread, so they are always correct.
          modelAwayPLOdds:     fmtML(modelResult.mkt_pl_away_odds ?? modelResult.away_puck_line_odds),
          modelHomePLOdds:     fmtML(modelResult.mkt_pl_home_odds ?? modelResult.home_puck_line_odds),
          // Model fair odds AT the BOOK's total line (for side-by-side display)
          // e.g. book shows O/U 6.5 (-115/-105), model shows O/U 6.5 (+138/-138) → edge detected
          modelOverOdds:       fmtML(modelResult.mkt_total_over_odds ?? modelResult.over_odds),
          modelUnderOdds:      fmtML(modelResult.mkt_total_under_odds ?? modelResult.under_odds),
          // Goalie info
          awayGoalie:          awayGoalieName ?? undefined,
          homeGoalie:          homeGoalieName ?? undefined,
          awayGoalieConfirmed: awayGoalieInfo?.confirmed ?? false,
          homeGoalieConfirmed: homeGoalieInfo?.confirmed ?? false,
          // Metadata
          modelRunAt:          Date.now(),
          // Puck line odds (update from model if book odds not available)
          awaySpreadOdds:      game.awaySpreadOdds ?? fmtML(modelResult.away_puck_line_odds),
          homeSpreadOdds:      game.homeSpreadOdds ?? fmtML(modelResult.home_puck_line_odds),
          overOdds:            game.overOdds ?? fmtML(modelResult.over_odds),
          underOdds:           game.underOdds ?? fmtML(modelResult.under_odds),
        })
        .where(eq(games.id, game.id));

      // ── POST-WRITE VERIFICATION ─────────────────────────────────────────────────────────────────────────────
      // Invariants that must ALWAYS hold after every NHL model write:
      //   1. modelAwayPuckLine sign matches awaySpreadOdds sign (dog=+, fav=-)
      //   2. modelTotal equals bookTotal (no drift from Python's own optimal line)
      const writtenPL = correctedAwaySpreadStr ?? modelResult.away_puck_line;
      const writtenTotal = mktTotal !== null ? String(mktTotal) : String(Math.round(modelResult.total_line * 2) / 2);
      // Spread-authoritative sign check: +spread = dog = +1.5, -spread = fav = -1.5
      // Do NOT use odds sign — in NHL, the dog at +1.5 often has negative odds (-155)
      const plSignOk = writtenPL !== null && correctedAwaySpread !== null
        ? (correctedAwaySpread >= 0 ? writtenPL.startsWith('+') : writtenPL.startsWith('-'))
        : true; // no spread to check against
      const totalOk = mktTotal !== null ? Math.abs(parseFloat(writtenTotal) - mktTotal) < 0.01 : true;
      const verifyStatus = plSignOk && totalOk ? 'PASS' : 'FAIL';
      console.log(`[NhlModelSync]${tag}   [VERIFY] ${verifyStatus} | PL: away=${writtenPL}(bookSpread=${correctedAwaySpread}) sign_ok=${plSignOk} | Total: written=${writtenTotal} book=${mktTotal} match=${totalOk}`);
      if (!plSignOk || !totalOk) {
        console.error(`[NhlModelSync]${tag}   [VERIFY FAIL] ${gameLabel}: PL_sign_ok=${plSignOk} total_ok=${totalOk} — DATA INTEGRITY VIOLATION`);
      }
      // ─────────────────────────────────────────────────────────────────────────────
      console.log(`[NhlModelSync]${tag}   ✅ DB updated for game ID=${game.id} (${gameLabel})`);
      result.synced++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[NhlModelSync]${tag}   ✗ Error processing ${gameLabel}: ${msg}`);
      result.errors.push(`${gameLabel}: ${msg}`);
      result.skipped++;
    }
  }

  // ── Post-write validation gate ──────────────────────────────────────────────────────────────────────────────────
  if (result.synced > 0) {
    const db = await getDb();
    const nhlRows = await db.select({
      id:              games.id,
      away:            games.awayTeam,
      home:            games.homeTeam,
      bookTotal:       games.bookTotal,
      modelTotal:      games.modelTotal,
      awayBookSpread:  games.awayBookSpread,
      modelAwayPuckLine: games.modelAwayPuckLine,
    }).from(games)
      .where(and(
        eq(games.gameDate, gameDate),
        eq(games.sport, 'NHL'),
      ));
    const nhlIssues: string[] = [];
    for (const g of nhlRows) {
      const label = `[${g.id}] ${g.away}@${g.home}`;
      // 1. Total alignment: modelTotal must equal bookTotal
      const bookT  = parseFloat(String(g.bookTotal  ?? '0'));
      const modelT = parseFloat(String(g.modelTotal ?? '0'));
      if (!isNaN(bookT) && !isNaN(modelT) && Math.abs(bookT - modelT) > 0.01) {
        nhlIssues.push(`${label}: modelTotal=${modelT} ≠ bookTotal=${bookT} [TOTAL MISMATCH]`);
      }
      // 2. Puck line must be exactly ±1.5 or ±2.5 — NHL PL is NEVER 0
      const awayPL = String(g.modelAwayPuckLine ?? '');
      const validPL = awayPL === '+1.5' || awayPL === '-1.5' || awayPL === '+2.5' || awayPL === '-2.5';
      if (awayPL && !validPL) {
        nhlIssues.push(`${label}: modelAwayPuckLine="${awayPL}" — expected ±1.5 or ±2.5 (NHL PL is never 0)`);
      }
      // 3. Puck line sign alignment: model PL must match the SPREAD-AUTHORITATIVE direction.
      // The spread value itself is authoritative: +1.5 = dog, -1.5 = fav.
      // The odds sign is NOT reliable for determining fav/dog in NHL puck lines because
      // the dog at +1.5 often has negative odds (e.g., -155) since covering +1.5 is easier.
      // Rule: awayBookSpread > 0 → away is the dog → modelAwayPuckLine MUST be +1.5
      //       awayBookSpread < 0 → away is the fav → modelAwayPuckLine MUST be -1.5
      const bookSpreadNum = g.awayBookSpread != null ? parseFloat(String(g.awayBookSpread)) : null;
      const modelPLNum = parseFloat(awayPL || '0');
      if (bookSpreadNum !== null && !isNaN(bookSpreadNum) && bookSpreadNum !== 0 && awayPL) {
        const bookSign  = bookSpreadNum > 0 ? 1 : -1;  // +spread = dog = +1.5, -spread = fav = -1.5
        const modelSign = modelPLNum < 0 ? -1 : 1;
        if (bookSign !== modelSign) {
          nhlIssues.push(
            `${label}: PL SIGN MISMATCH — awayBookSpread=${bookSpreadNum} (${bookSign > 0 ? 'dog' : 'fav'}) ` +
            `but modelAwayPuckLine=${awayPL} (${modelSign > 0 ? 'dog' : 'fav'}) — SPREAD-AUTHORITATIVE VIOLATION`
          );
        }
      }
    }
    if (nhlIssues.length === 0) {
      console.log(`[NhlModelSync]${tag} ✅ LINE VALIDATION PASSED — all ${nhlRows.length} NHL games correct`);
    } else {
      console.error(`[NhlModelSync]${tag} ❌ LINE VALIDATION FAILED — ${nhlIssues.length} issues:`);
      for (const issue of nhlIssues) {
        console.error(`  ✗ ${issue}`);
      }
    }
  }
  // ── Summary ──────────────────────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[NhlModelSync]${tag} ✅ DONE — Synced: ${result.synced} | Skipped: ${result.skipped} | Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.warn(`[NhlModelSync]${tag} Errors:`, result.errors.join("; "));
  }
  console.log(`${"=".repeat(70)}\n`);

  // ── Auto-approve: publish all newly modeled NHL games immediately ───────────
  // Owner has approved the NHL model output — projections go live automatically.
  // This runs even if result.synced === 0 (idempotent: approves any still-pending games).
  try {
    const approved = await bulkApproveModels(gameDate, "NHL");
    if (approved > 0) {
      console.log(`[NhlModelSync]${tag} ✅ Auto-approved ${approved} NHL projection(s) for ${gameDate} — live on feed`);
    } else {
      console.log(`[NhlModelSync]${tag}   Auto-approve: 0 pending projections (all already published or no model data)`);
    }
  } catch (approveErr) {
    const msg = approveErr instanceof Error ? approveErr.message : String(approveErr);
    console.error(`[NhlModelSync]${tag} ⚠ Auto-approve failed: ${msg}`);
    result.errors.push(`Auto-approve failed: ${msg}`);
  }

  result.syncedAt = new Date().toISOString();
  lastSyncResult = result;
  return result;
}
// ─── Scheduler ───────────────────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

// ─── Tomorrow Date Helper ──────────────────────────────────────────────────────────────────
/** Returns tomorrow's date in YYYY-MM-DD format (ET-based, same as getTodayDate). */
function getNhlTomorrowDate(): string {
  const now = new Date();
  const etStr = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [m, d, y] = etStr.split("/");
  // Add 1 day using Date arithmetic to handle month/year rollover correctly
  const tomorrow = new Date(Number(y), Number(m) - 1, Number(d) + 1);
  const ty = tomorrow.getFullYear();
  const tm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const td = String(tomorrow.getDate()).padStart(2, '0');
  return `${ty}-${tm}-${td}`;
}

export function startNhlModelSyncScheduler(): void {
  if (syncInterval) return;

  const FIVE_MIN_MS = 5 * 60 * 1000; // 24/7 — no time gate

  /**
   * Run today + tomorrow in sequence.
   * TODAY:    syncNhlModelForToday() — handles all upcoming games with modelRunAt=null
   * TOMORROW: syncNhlModelForToday(dateOverride=tomorrow) — catch-all for tomorrow games
   *           seeded by GoalieTomorrowSeeder but not yet modeled.
   *           The modelRunAt IS NULL guard prevents re-running already-modeled games.
   */
  async function runBothDates(trigger: string): Promise<void> {
    const today    = getTodayDate();
    const tomorrow = getNhlTomorrowDate();
    console.log(`[NhlModelSync] ${trigger} — today=${today} tomorrow=${tomorrow}`);

    // 1. Today
    try {
      await syncNhlModelForToday("auto");
    } catch (err) {
      console.error(`[NhlModelSync] ${trigger} today sync error:`, err);
    }

    // 2. Tomorrow — modelRunAt IS NULL guard prevents re-running already-modeled games
    try {
      const tomorrowResult = await syncNhlModelForToday("auto", false, false, tomorrow);
      if (tomorrowResult.synced > 0) {
        console.log(
          `[NhlModelSync] ${trigger} TOMORROW (${tomorrow}):` +
          ` synced=${tomorrowResult.synced} skipped=${tomorrowResult.skipped}` +
          ` errors=${tomorrowResult.errors.length}`
        );
      } else {
        console.log(`[NhlModelSync] ${trigger} TOMORROW (${tomorrow}): no unmodeled games — skipping`);
      }
    } catch (err) {
      console.error(`[NhlModelSync] ${trigger} tomorrow sync error:`, err);
    }
  }

  // Run immediately on startup
  console.log("[NhlModelSync] Starting initial sync (24/7, no time gate, today+tomorrow)...");
  runBothDates("STARTUP").catch(err =>
    console.error("[NhlModelSync] Initial startup error:", err)
  );

  syncInterval = setInterval(() => {
    runBothDates("SCHEDULED").catch(err =>
      console.error("[NhlModelSync] Scheduled sync error:", err)
    );
  }, FIVE_MIN_MS);

  console.log("[NhlModelSync] Scheduler started (every 5 min, 24/7, today+tomorrow).");
}

export function stopNhlModelSyncScheduler(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[NhlModelSync] Scheduler stopped.");
  }
}
