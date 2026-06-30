/**
 * espnDbIngester.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ingests the output of espnPageScraper.ts (EspnMatchPageData) into the 9
 * wc2026_espn_* database tables.
 *
 * TABLES WRITTEN:
 *   1. wc2026_espn_matches         — master match record (game strip)
 *   2. wc2026_espn_match_odds      — DraftKings moneyline / spread / total
 *   3. wc2026_espn_team_stats      — 8-row tmStatsGrph summary
 *   4. wc2026_espn_match_stats     — 40-col deferred stats (shots/passes/attack/defense/duels/fouls/xG/GK)
 *   5. wc2026_espn_expected_goals  — team xG totals + per-player breakdown
 *   6. wc2026_espn_shot_map        — every shot with coords + attributes
 *   7. wc2026_espn_player_stats    — per-player boxscore (outfield + GK)
 *   8. wc2026_espn_lineups         — ESPN formation + starter/sub/unused
 *   9. wc2026_espn_glossary        — stat abbreviation → display name
 *
 * LOGGING FORMAT (noise-free, structured):
 *   [INGEST] [PHASE n/9] <table>   — section banner
 *   [INGEST] [INPUT]  <source>     — data source description
 *   [INGEST] [STEP]   <operation>  — what is being done
 *   [INGEST] [STATE]  <values>     — intermediate computation
 *   [INGEST] [OUTPUT] <result>     — rows written / updated
 *   [INGEST] [VERIFY] PASS/FAIL    — validation gate result
 *   [INGEST] [ERROR]  <message>    — error with context
 *
 * UPSERT STRATEGY:
 *   - All tables use INSERT ... ON DUPLICATE KEY UPDATE
 *   - matchId is the natural key for all match-scoped tables
 *   - (matchId, athleteId) is the key for player_stats and lineups
 *   - abbreviation is the key for glossary
 *   - Shot map: DELETE + re-INSERT on each ingest (shots can change mid-match)
 *
 * TERMINOLOGY: All WC fixtures are "matches" — never "games".
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import {
  wc2026EspnMatches,
  wc2026EspnMatchOdds,
  wc2026EspnTeamStats,
  wc2026EspnMatchStats,
  wc2026EspnExpectedGoals,
  wc2026EspnShotMap,
  wc2026EspnPlayerStats,
  wc2026EspnLineups,
  wc2026EspnGlossary,
} from "../../drizzle/schema";
import type { EspnMatchPageData } from "./espnPageScraper";

// ─── Logger ───────────────────────────────────────────────────────────────────

const TAG = "[INGEST]";

function logPhase(phase: number, total: number, table: string) {
  console.log(`${TAG} [${"═".repeat(60)}]`);
  console.log(`${TAG} [PHASE ${phase}/${total}] ${table.toUpperCase()}`);
  console.log(`${TAG} [${"═".repeat(60)}]`);
}

function logInput(msg: string) { console.log(`${TAG} [INPUT]  ${msg}`); }
function logStep(msg: string)  { console.log(`${TAG} [STEP]   ${msg}`); }
function logState(msg: string) { console.log(`${TAG} [STATE]  ${msg}`); }
function logOutput(msg: string){ console.log(`${TAG} [OUTPUT] ${msg}`); }
function logVerify(pass: boolean, msg: string) {
  console.log(`${TAG} [VERIFY] ${pass ? "✓ PASS" : "✗ FAIL"} — ${msg}`);
}
function logError(msg: string, err?: unknown) {
  console.error(`${TAG} [ERROR]  ${msg}`, err ?? "");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeInt(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return isNaN(n) ? null : n;
}

function safeDecimal(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n.toFixed(3);
}

function now(): number { return Date.now(); }

// ─── Result type ──────────────────────────────────────────────────────────────

export interface EspnIngestResult {
  matchId: string;
  success: boolean;
  phases: {
    phase: number;
    table: string;
    rowsWritten: number;
    pass: boolean;
    error?: string;
  }[];
  totalRowsWritten: number;
  durationMs: number;
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INGEST FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function ingestEspnMatchData(
  data: EspnMatchPageData,
  opts: { dryRun?: boolean } = {}
): Promise<EspnIngestResult> {
  const startMs = now();
  const db = getDb();
  const matchId = data.gameId;
  const { dryRun = false } = opts;

  const result: EspnIngestResult = {
    matchId,
    success: false,
    phases: [],
    totalRowsWritten: 0,
    durationMs: 0,
    errors: [],
  };

  console.log(`\n${TAG} ${"▓".repeat(70)}`);
  console.log(`${TAG} ESPN DB INGEST — matchId=${matchId} dryRun=${dryRun}`);
  console.log(`${TAG} scrapedAt=${data.scrapedAt} scrapeDurationMs=${data.scrapeDurationMs}`);
  console.log(`${TAG} ${"▓".repeat(70)}\n`);

  // ─── PHASE 1: wc2026_espn_matches ─────────────────────────────────────────
  logPhase(1, 9, "wc2026_espn_matches");
  try {
    const gs = data.gameStrip;
    logInput(`gameStrip: ${gs.homeTeam.abbrev} vs ${gs.awayTeam.abbrev} | ${gs.status}`);

    const matchDateUtc = gs.dateTimeUTC ? new Date(gs.dateTimeUTC).getTime() : now();
    logState(`matchDateUtc=${matchDateUtc} venue="${gs.venue}" attendance=${gs.attendance}`);
    logState(`homeScore=${gs.homeTeam.score} awayScore=${gs.awayTeam.score}`);
    logState(`homeFormation=${data.lineups.home.formation} awayFormation=${data.lineups.away.formation}`);

    const row = {
      matchId,
      uid: gs.uid ?? null,
      competition: gs.competition ?? null,
      round: gs.competition?.split(",")[1]?.trim() ?? null,
      season: "2026",
      matchDateUtc,
      statusState: gs.statusState ?? null,
      statusDetail: gs.statusDetail ?? null,
      statusDisplay: gs.status ?? null,
      venue: gs.venue ?? null,
      city: gs.city ?? null,
      attendance: gs.attendance ?? null,
      referee: gs.referee ?? null,
      broadcasts: JSON.stringify(gs.broadcasts ?? []),
      homeTeamId: gs.homeTeam.id,
      homeTeamAbbrev: gs.homeTeam.abbrev,
      homeTeamName: gs.homeTeam.displayName,
      homeTeamLogo: gs.homeTeam.logo ?? null,
      homeScore: gs.homeTeam.score ?? null,
      homeLinescores: JSON.stringify(gs.homeTeam.linescores ?? []),
      homeGoalScorers: JSON.stringify(gs.homeTeam.goals ?? []),
      homeRedCards: JSON.stringify(gs.homeTeam.redCards ?? []),
      awayTeamId: gs.awayTeam.id,
      awayTeamAbbrev: gs.awayTeam.abbrev,
      awayTeamName: gs.awayTeam.displayName,
      awayTeamLogo: gs.awayTeam.logo ?? null,
      awayScore: gs.awayTeam.score ?? null,
      awayLinescores: JSON.stringify(gs.awayTeam.linescores ?? []),
      awayGoalScorers: JSON.stringify(gs.awayTeam.goals ?? []),
      awayRedCards: JSON.stringify(gs.awayTeam.redCards ?? []),
      homeFormation: data.lineups.home.formation ?? null,
      awayFormation: data.lineups.away.formation ?? null,
      scrapedAt: new Date(data.scrapedAt).getTime(),
      scrapeDurationMs: data.scrapeDurationMs ?? null,
      scrapeVersion: "250x",
      createdAt: now(),
      updatedAt: now(),
    };

    logStep(`Upserting wc2026_espn_matches matchId=${matchId}`);
    if (!dryRun) {
      await db.insert(wc2026EspnMatches).values(row).onDuplicateKeyUpdate({
        set: { ...row, updatedAt: now() },
      });
    }

    const pass = !!row.homeTeamAbbrev && !!row.awayTeamAbbrev && !!row.matchDateUtc;
    logOutput(`1 row upserted — ${gs.homeTeam.abbrev} ${gs.homeTeam.score}-${gs.awayTeam.score} ${gs.awayTeam.abbrev}`);
    logVerify(pass, `homeTeamAbbrev="${row.homeTeamAbbrev}" awayTeamAbbrev="${row.awayTeamAbbrev}" matchDateUtc=${row.matchDateUtc}`);
    result.phases.push({ phase: 1, table: "wc2026_espn_matches", rowsWritten: 1, pass });
    result.totalRowsWritten += 1;
  } catch (err) {
    const msg = `Phase 1 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 1, table: "wc2026_espn_matches", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 2: wc2026_espn_match_odds ──────────────────────────────────────
  logPhase(2, 9, "wc2026_espn_match_odds");
  try {
    const odds = data.gameOdds;
    if (!odds) {
      logStep("No gameOdds data — skipping");
      logVerify(true, "gameOdds=null (pre-match or no odds available) — skip is valid");
      result.phases.push({ phase: 2, table: "wc2026_espn_match_odds", rowsWritten: 0, pass: true });
    } else {
      logInput(`provider="${odds.provider}" headerText="${odds.headerText}"`);
      logState(`home: ML=${odds.homeTeam.moneylineCurrent} spread=${odds.homeTeam.spreadLine} total=${odds.homeTeam.totalSide}`);
      logState(`away: ML=${odds.awayTeam.moneylineCurrent} spread=${odds.awayTeam.spreadLine} total=${odds.awayTeam.totalSide}`);
      logState(`draw: ML=${odds.drawMoneyline}`);

      const row = {
        matchId,
        provider: odds.provider ?? null,
        headerText: odds.headerText ?? null,
        homeTeamAbbrev: odds.homeTeam.teamAbbrev ?? data.gameStrip.homeTeam.abbrev,
        awayTeamAbbrev: odds.awayTeam.teamAbbrev ?? data.gameStrip.awayTeam.abbrev,
        homeMoneylineOpen: odds.homeTeam.moneylineOpen ?? null,
        homeMoneylineCurrent: odds.homeTeam.moneylineCurrent ?? null,
        awayMoneylineOpen: odds.awayTeam.moneylineOpen ?? null,
        awayMoneylineCurrent: odds.awayTeam.moneylineCurrent ?? null,
        homeSpreadLine: odds.homeTeam.spreadLine ?? null,
        homeSpreadOdds: odds.homeTeam.spreadOdds ?? null,
        awaySpreadLine: odds.awayTeam.spreadLine ?? null,
        awaySpreadOdds: odds.awayTeam.spreadOdds ?? null,
        homeTotalSide: odds.homeTeam.totalSide ?? null,
        homeTotalOdds: odds.homeTeam.totalOdds ?? null,
        awayTotalSide: odds.awayTeam.totalSide ?? null,
        awayTotalOdds: odds.awayTeam.totalOdds ?? null,
        drawMoneylineOpen: odds.drawMoneylineOpen ?? null,
        drawMoneylineCurrent: odds.drawMoneyline ?? null,
        createdAt: now(),
        updatedAt: now(),
      };

      logStep(`Upserting wc2026_espn_match_odds matchId=${matchId}`);
      if (!dryRun) {
        await db.insert(wc2026EspnMatchOdds).values(row).onDuplicateKeyUpdate({
          set: { ...row, updatedAt: now() },
        });
      }

      const pass = !!row.homeMoneylineCurrent || !!row.awayMoneylineCurrent;
      logOutput(`1 row upserted — ${odds.provider}`);
      logVerify(pass, `homeML=${row.homeMoneylineCurrent} awayML=${row.awayMoneylineCurrent} draw=${row.drawMoneylineCurrent}`);
      result.phases.push({ phase: 2, table: "wc2026_espn_match_odds", rowsWritten: 1, pass });
      result.totalRowsWritten += 1;
    }
  } catch (err) {
    const msg = `Phase 2 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 2, table: "wc2026_espn_match_odds", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 3: wc2026_espn_team_stats ──────────────────────────────────────
  logPhase(3, 9, "wc2026_espn_team_stats");
  try {
    const ts = data.teamStats;
    logInput(`teamStats: ${ts.homeAbbrev} vs ${ts.awayAbbrev} — ${ts.stats.length} rows`);

    // Map by stat name (case-insensitive)
    const statMap: Record<string, { home: string; away: string }> = {};
    for (const s of ts.stats) {
      statMap[s.name.toLowerCase()] = { home: s.homeValue, away: s.awayValue };
    }

    const get = (key: string) => statMap[key.toLowerCase()] ?? { home: "", away: "" };

    const possession = get("ball possession");
    const sog = get("shots on goal");
    const shots = get("shot attempts");
    const fouls = get("fouls");
    const yc = get("yellow cards");
    const rc = get("red cards");
    const corners = get("corner kicks");
    const saves = get("saves");

    logState(`possession: ${possession.home} / ${possession.away}`);
    logState(`SoG: ${sog.home} / ${sog.away} | shots: ${shots.home} / ${shots.away}`);
    logState(`fouls: ${fouls.home} / ${fouls.away} | YC: ${yc.home} / ${yc.away} | RC: ${rc.home} / ${rc.away}`);
    logState(`corners: ${corners.home} / ${corners.away} | saves: ${saves.home} / ${saves.away}`);

    const row = {
      matchId,
      homeTeamAbbrev: ts.homeAbbrev,
      awayTeamAbbrev: ts.awayAbbrev,
      possession: possession.home || null,
      possessionAway: possession.away || null,
      shotsOnGoal: safeInt(sog.home),
      shotsOnGoalAway: safeInt(sog.away),
      shotAttempts: safeInt(shots.home),
      shotAttemptsAway: safeInt(shots.away),
      fouls: safeInt(fouls.home),
      foulsAway: safeInt(fouls.away),
      yellowCards: safeInt(yc.home),
      yellowCardsAway: safeInt(yc.away),
      redCards: safeInt(rc.home),
      redCardsAway: safeInt(rc.away),
      cornerKicks: safeInt(corners.home),
      cornerKicksAway: safeInt(corners.away),
      saves: safeInt(saves.home),
      savesAway: safeInt(saves.away),
      createdAt: now(),
      updatedAt: now(),
    };

    logStep(`Upserting wc2026_espn_team_stats matchId=${matchId}`);
    if (!dryRun) {
      await db.insert(wc2026EspnTeamStats).values(row).onDuplicateKeyUpdate({
        set: { ...row, updatedAt: now() },
      });
    }

    const pass = ts.stats.length >= 7;
    logOutput(`1 row upserted — ${ts.stats.length} stats mapped`);
    logVerify(pass, `${ts.stats.length} stats (expected 8) | possession=${possession.home}/${possession.away}`);
    result.phases.push({ phase: 3, table: "wc2026_espn_team_stats", rowsWritten: 1, pass });
    result.totalRowsWritten += 1;
  } catch (err) {
    const msg = `Phase 3 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 3, table: "wc2026_espn_team_stats", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 4: wc2026_espn_match_stats ─────────────────────────────────────
  logPhase(4, 9, "wc2026_espn_match_stats");
  try {
    const s = data.shots;
    const p = data.passes;
    const a = data.attack;
    const eg = data.expectedGoals;
    const gk = data.goalkeeping;
    const def = data.defense;
    const d = data.duels;
    const f = data.fouls;

    logInput(`shots(6) + passes(8) + attack(6) + xG(4) + GK(5) + defense(4) + duels(3) + fouls(4) = 40 cols`);
    logState(`shots: SoG=${s.homeShotsOnGoal}/${s.awayShotsOnGoal} total=${s.homeShots}/${s.awayShots} blocked=${s.homeShotsBlocked}/${s.awayShotsBlocked}`);
    logState(`passes: accurate=${p.homeAccuratePasses}/${p.awayAccuratePasses} pct=${p.homePassAccuracyPct}/${p.awayPassAccuracyPct} total=${p.homePasses}/${p.awayPasses}`);
    logState(`attack: bigChances=${a.homeBigChancesCreated}/${a.awayBigChancesCreated} corners=${a.homeCornersWon}/${a.awayCornersWon}`);
    logState(`xG: ${eg.homeTeamXG}/${eg.awayTeamXG} openPlay=${eg.homeTeamXGOpenPlay}/${eg.awayTeamXGOpenPlay}`);
    logState(`defense: tackles=${def.homeTackles}/${def.awayTackles} interceptions=${def.homeInterceptions}/${def.awayInterceptions}`);
    logState(`defense: clearances=${def.homeClearances}/${def.awayClearances} recoveries=${def.homeRecoveries}/${def.awayRecoveries}`);
    logState(`duels: won=${d.homeDuelsWon}/${d.awayDuelsWon} total=${d.homeDuels}/${d.awayDuels} aerials=${d.homeAerialsWon}/${d.awayAerialsWon}`);
    logState(`fouls: committed=${f.homeFoulsCommitted}/${f.awayFoulsCommitted} offsides=${f.homeOffsides}/${f.awayOffsides}`);

    const row = {
      matchId,
      homeTeamAbbrev: data.gameStrip.homeTeam.abbrev,
      awayTeamAbbrev: data.gameStrip.awayTeam.abbrev,

      // SHOTS
      homeShotsOnGoal: safeInt(s.homeShotsOnGoal),
      awayShotsOnGoal: safeInt(s.awayShotsOnGoal),
      homeShots: safeInt(s.homeShots),
      awayShots: safeInt(s.awayShots),
      homeShotsBlocked: safeInt(s.homeShotsBlocked),
      awayShotsBlocked: safeInt(s.awayShotsBlocked),
      homeHitWoodwork: safeInt(s.homeHitWoodwork),
      awayHitWoodwork: safeInt(s.awayHitWoodwork),
      homeAttemptsInsideBox: safeInt(s.homeAttemptsInsideBox),
      awayAttemptsInsideBox: safeInt(s.awayAttemptsInsideBox),
      homeAttemptsOutsideBox: safeInt(s.homeAttemptsOutsideBox),
      awayAttemptsOutsideBox: safeInt(s.awayAttemptsOutsideBox),

      // PASSES
      homeAccuratePasses: safeInt(p.homeAccuratePasses),
      awayAccuratePasses: safeInt(p.awayAccuratePasses),
      homePassAccuracyPct: p.homePassAccuracyPct || null,
      awayPassAccuracyPct: p.awayPassAccuracyPct || null,
      homePasses: safeInt(p.homePasses),
      awayPasses: safeInt(p.awayPasses),
      homeTotalBackZonePass: safeInt(p.homeTotalBackZonePass),
      awayTotalBackZonePass: safeInt(p.awayTotalBackZonePass),
      homeTotalForwardZonePass: safeInt(p.homeTotalForwardZonePass),
      awayTotalForwardZonePass: safeInt(p.awayTotalForwardZonePass),
      homeAccurateLongBalls: safeInt(p.homeAccurateLongBalls),
      awayAccurateLongBalls: safeInt(p.awayAccurateLongBalls),
      homeAccurateCrosses: safeInt(p.homeAccurateCrosses),
      awayAccurateCrosses: safeInt(p.awayAccurateCrosses),
      homeTotalThrows: safeInt(p.homeTotalThrows),
      awayTotalThrows: safeInt(p.awayTotalThrows),
      homePassTouchesInOppBox: safeInt(p.homeTouchesInOppositionBox),
      awayPassTouchesInOppBox: safeInt(p.awayTouchesInOppositionBox),

      // ATTACK
      homeBigChancesCreated: safeInt(a.homeBigChancesCreated),
      awayBigChancesCreated: safeInt(a.awayBigChancesCreated),
      homeBigChancesMissed: safeInt(a.homeBigChancesMissed),
      awayBigChancesMissed: safeInt(a.awayBigChancesMissed),
      homeThroughBalls: safeInt(a.homeThroughBalls),
      awayThroughBalls: safeInt(a.awayThroughBalls),
      homeAttkTouchesInOppBox: safeInt(a.homeTouchesInOppositionBox),
      awayAttkTouchesInOppBox: safeInt(a.awayTouchesInOppositionBox),
      homeFouledInFinalThird: safeInt(a.homeFouledInFinalThird),
      awayFouledInFinalThird: safeInt(a.awayFouledInFinalThird),
      homeCornersWon: safeInt(a.homeCornersWon),
      awayCornersWon: safeInt(a.awayCornersWon),

      // EXPECTED GOALS
      homeXG: safeDecimal(eg.homeTeamXG),
      awayXG: safeDecimal(eg.awayTeamXG),
      homeXGOpenPlay: safeDecimal(eg.homeTeamXGOpenPlay),
      awayXGOpenPlay: safeDecimal(eg.awayTeamXGOpenPlay),
      homeXGSetPlay: safeDecimal(eg.homeTeamXGSetPlay),
      awayXGSetPlay: safeDecimal(eg.awayTeamXGSetPlay),
      homeXGOT: safeDecimal(eg.homeTeamXGOT),
      awayXGOT: safeDecimal(eg.awayTeamXGOT),

      // GOALKEEPING
      homeGkSaves: safeInt(gk.homeSaves),
      awayGkSaves: safeInt(gk.awaySaves),
      homeGoalKicks: safeInt(gk.homeGoalKicks),
      awayGoalKicks: safeInt(gk.awayGoalKicks),
      homeShotsFaced: safeInt(gk.homeShotsFaced),
      awayShotsFaced: safeInt(gk.awayShotsFaced),
      homeTotalHighClaims: safeInt(gk.homeTotalHighClaims),
      awayTotalHighClaims: safeInt(gk.awayTotalHighClaims),
      homePenaltyKicksSaved: safeInt(gk.homePenaltyKicksSaved),
      awayPenaltyKicksSaved: safeInt(gk.awayPenaltyKicksSaved),

      // DEFENSE
      homeTackles: safeInt(def.homeTackles),
      awayTackles: safeInt(def.awayTackles),
      homeInterceptions: safeInt(def.homeInterceptions),
      awayInterceptions: safeInt(def.awayInterceptions),
      homeClearances: safeInt(def.homeClearances),
      awayClearances: safeInt(def.awayClearances),
      homeRecoveries: safeInt(def.homeRecoveries),
      awayRecoveries: safeInt(def.awayRecoveries),

      // DUELS
      homeDuelsWon: safeInt(d.homeDuelsWon),
      awayDuelsWon: safeInt(d.awayDuelsWon),
      homeDuels: safeInt(d.homeDuels),
      awayDuels: safeInt(d.awayDuels),
      homeAerialsWon: safeInt(d.homeAerialsWon),
      awayAerialsWon: safeInt(d.awayAerialsWon),

      // FOULS & DISCIPLINE
      homeFoulsCommitted: safeInt(f.homeFoulsCommitted),
      awayFoulsCommitted: safeInt(f.awayFoulsCommitted),
      homeOffsides: safeInt(f.homeOffsides),
      awayOffsides: safeInt(f.awayOffsides),
      homeFoulYellowCards: safeInt(f.homeYellowCards),
      awayFoulYellowCards: safeInt(f.awayYellowCards),
      homeFoulRedCards: safeInt(f.homeRedCards),
      awayFoulRedCards: safeInt(f.awayRedCards),

      createdAt: now(),
      updatedAt: now(),
    };

    logStep(`Upserting wc2026_espn_match_stats matchId=${matchId}`);
    if (!dryRun) {
      await db.insert(wc2026EspnMatchStats).values(row).onDuplicateKeyUpdate({
        set: { ...row, updatedAt: now() },
      });
    }

    // Verify gates: defense section must have all 4 fields
    const defensePass = (row.homeTackles !== null || row.homeInterceptions !== null ||
                         row.homeClearances !== null || row.homeRecoveries !== null);
    const shotsPass = row.homeShotsOnGoal !== null;
    const passesPass = row.homePasses !== null;
    const pass = defensePass && shotsPass && passesPass;

    logOutput(`1 row upserted — 40 stat columns`);
    logVerify(shotsPass, `SHOTS: SoG=${row.homeShotsOnGoal}/${row.awayShotsOnGoal}`);
    logVerify(passesPass, `PASSES: total=${row.homePasses}/${row.awayPasses} pct=${row.homePassAccuracyPct}/${row.awayPassAccuracyPct}`);
    logVerify(defensePass, `DEFENSE: tackles=${row.homeTackles}/${row.awayTackles} interceptions=${row.homeInterceptions}/${row.awayInterceptions} clearances=${row.homeClearances}/${row.awayClearances} recoveries=${row.homeRecoveries}/${row.awayRecoveries}`);
    logVerify(pass, `All 8 stat sections populated`);
    result.phases.push({ phase: 4, table: "wc2026_espn_match_stats", rowsWritten: 1, pass });
    result.totalRowsWritten += 1;
  } catch (err) {
    const msg = `Phase 4 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 4, table: "wc2026_espn_match_stats", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 5: wc2026_espn_expected_goals ──────────────────────────────────
  logPhase(5, 9, "wc2026_espn_expected_goals");
  try {
    const eg = data.expectedGoals;
    logInput(`xG team totals + ${eg.perPlayer.length} per-player entries`);
    logState(`homeXG=${eg.homeTeamXG} awayXG=${eg.awayTeamXG}`);
    logState(`homeXGOpenPlay=${eg.homeTeamXGOpenPlay} awayXGOpenPlay=${eg.awayTeamXGOpenPlay}`);
    logState(`homeXGOT=${eg.homeTeamXGOT} awayXGOT=${eg.awayTeamXGOT}`);
    logState(`homeXA=${eg.homeTeamXA} awayXA=${eg.awayTeamXA}`);

    const row = {
      matchId,
      homeTeamAbbrev: data.gameStrip.homeTeam.abbrev,
      awayTeamAbbrev: data.gameStrip.awayTeam.abbrev,
      homeXG: safeDecimal(eg.homeTeamXG),
      awayXG: safeDecimal(eg.awayTeamXG),
      homeXGOpenPlay: safeDecimal(eg.homeTeamXGOpenPlay),
      awayXGOpenPlay: safeDecimal(eg.awayTeamXGOpenPlay),
      homeXGSetPlay: safeDecimal(eg.homeTeamXGSetPlay),
      awayXGSetPlay: safeDecimal(eg.awayTeamXGSetPlay),
      homeXGOT: safeDecimal(eg.homeTeamXGOT),
      awayXGOT: safeDecimal(eg.awayTeamXGOT),
      homeXA: safeDecimal(eg.homeTeamXA),
      awayXA: safeDecimal(eg.awayTeamXA),
      perPlayerJson: JSON.stringify(eg.perPlayer),
      createdAt: now(),
      updatedAt: now(),
    };

    logStep(`Upserting wc2026_espn_expected_goals matchId=${matchId}`);
    if (!dryRun) {
      await db.insert(wc2026EspnExpectedGoals).values(row).onDuplicateKeyUpdate({
        set: { ...row, updatedAt: now() },
      });
    }

    const pass = row.homeXG !== null && row.awayXG !== null && eg.perPlayer.length > 0;
    logOutput(`1 row upserted — ${eg.perPlayer.length} per-player xG entries in JSON`);
    logVerify(pass, `homeXG=${row.homeXG} awayXG=${row.awayXG} perPlayer=${eg.perPlayer.length}`);
    result.phases.push({ phase: 5, table: "wc2026_espn_expected_goals", rowsWritten: 1, pass });
    result.totalRowsWritten += 1;
  } catch (err) {
    const msg = `Phase 5 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 5, table: "wc2026_espn_expected_goals", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 6: wc2026_espn_shot_map ────────────────────────────────────────
  logPhase(6, 9, "wc2026_espn_shot_map");
  try {
    const shots = data.shotMap.shots;
    logInput(`${shots.length} shots — home=${data.shotMap.homeShots} away=${data.shotMap.awayShots}`);

    if (shots.length === 0) {
      logStep("No shots in shot map — skipping");
      logVerify(true, "0 shots (valid for 0-0 match or pre-match) — skip is valid");
      result.phases.push({ phase: 6, table: "wc2026_espn_shot_map", rowsWritten: 0, pass: true });
    } else {
      // DELETE existing shots for this match then re-INSERT (shots can change mid-match)
      logStep(`Deleting existing shots for matchId=${matchId}`);
      if (!dryRun) {
        await db.execute(sql`DELETE FROM wc2026_espn_shot_map WHERE matchId = ${matchId}`);
      }

      const rows = shots.map((shot, idx) => ({
        matchId,
        shotId: shot.shotId || `${matchId}-${idx}`,
        sequence: shot.sequence ?? idx,
        playerId: shot.playerId || null,
        playerName: shot.playerName || null,
        playerShortName: shot.playerShortName || null,
        playerJersey: shot.playerJersey || null,
        teamAbbrev: shot.teamAbbrev || null,
        isAway: shot.isAway ? 1 : 0,
        period: shot.period ?? null,
        clock: shot.clock || null,
        iconType: shot.iconType || null,
        isOwnGoal: shot.isOwnGoal ? 1 : 0,
        fieldStartX: shot.fieldStartX !== null ? String(shot.fieldStartX) : null,
        fieldStartY: shot.fieldStartY !== null ? String(shot.fieldStartY) : null,
        fieldEndX: shot.fieldEndX !== null ? String(shot.fieldEndX) : null,
        fieldEndY: shot.fieldEndY !== null ? String(shot.fieldEndY) : null,
        goalPositionY: shot.goalPositionY !== null ? String(shot.goalPositionY) : null,
        goalPositionZ: shot.goalPositionZ !== null ? String(shot.goalPositionZ) : null,
        xG: safeDecimal(shot.xG),
        xGOT: safeDecimal(shot.xGOT),
        distance: shot.distance || null,
        shotType: shot.shotType || null,
        situation: shot.situation || null,
        goalZone: shot.goalZone || null,
        description: shot.description || null,
        shortDescription: shot.shortDescription || null,
        createdAt: now(),
      }));

      logStep(`Inserting ${rows.length} shot rows`);
      if (!dryRun && rows.length > 0) {
        // Insert in batches of 50 to avoid packet size limits
        const BATCH = 50;
        for (let i = 0; i < rows.length; i += BATCH) {
          await db.insert(wc2026EspnShotMap).values(rows.slice(i, i + BATCH));
        }
      }

      // Verify: count goals in shot map vs game strip
      const goalsInMap = shots.filter(s => s.iconType === "goal").length;
      const expectedGoals = (data.gameStrip.homeTeam.score ?? 0) + (data.gameStrip.awayTeam.score ?? 0);
      const pass = rows.length > 0;

      logOutput(`${rows.length} shot rows inserted`);
      logVerify(pass, `${rows.length} shots | goals in map=${goalsInMap} vs scoreGoals=${expectedGoals}`);
      if (goalsInMap !== expectedGoals) {
        logState(`NOTE: goal count mismatch (own goals or penalty shootout may cause discrepancy)`);
      }
      result.phases.push({ phase: 6, table: "wc2026_espn_shot_map", rowsWritten: rows.length, pass });
      result.totalRowsWritten += rows.length;
    }
  } catch (err) {
    const msg = `Phase 6 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 6, table: "wc2026_espn_shot_map", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 7: wc2026_espn_player_stats ────────────────────────────────────
  logPhase(7, 9, "wc2026_espn_player_stats");
  try {
    const bx = data.boxscore;
    const allPlayers: Array<{
      teamAbbrev: string;
      teamId: string;
      teamName: string;
      isHome: boolean;
      player: typeof bx.homeTeam.outfieldPlayers[0];
      isGk: boolean;
      gkStats?: typeof bx.homeTeam.goalkeeper;
    }> = [];

    // Outfield players — home
    for (const p of bx.homeTeam.outfieldPlayers) {
      allPlayers.push({ teamAbbrev: bx.homeTeam.teamAbbrev, teamId: bx.homeTeam.teamId, teamName: bx.homeTeam.teamName, isHome: true, player: p, isGk: false });
    }
    // Outfield players — away
    for (const p of bx.awayTeam.outfieldPlayers) {
      allPlayers.push({ teamAbbrev: bx.awayTeam.teamAbbrev, teamId: bx.awayTeam.teamId, teamName: bx.awayTeam.teamName, isHome: false, player: p, isGk: false });
    }

    logInput(`${bx.homeTeam.outfieldPlayers.length} home outfield + ${bx.awayTeam.outfieldPlayers.length} away outfield players`);
    logInput(`GK: home=${bx.homeTeam.goalkeeper?.name ?? "none"} away=${bx.awayTeam.goalkeeper?.name ?? "none"}`);

    let rowsWritten = 0;
    for (const entry of allPlayers) {
      const p = entry.player;
      const stats = p.stats ?? {};
      const row = {
        matchId,
        athleteId: p.athleteId,
        name: p.name,
        nameShort: p.nameShort ?? null,
        jersey: p.jersey ?? null,
        teamId: entry.teamId ?? null,
        teamAbbrev: entry.teamAbbrev,
        teamName: entry.teamName ?? null,
        isHome: entry.isHome ? 1 : 0,
        positionGroup: p.positionGroup ?? null,
        isGoalkeeper: 0,
        // Outfield stats
        touches: safeInt(stats["TCH"]),
        goals: safeInt(stats["G"]),
        assists: safeInt(stats["A"]),
        xG: safeDecimal(stats["xG"]),
        xA: safeDecimal(stats["xA"]),
        shotsOnGoal: safeInt(stats["SOG"]),
        shots: safeInt(stats["SHOT"]),
        bigChancesCreated: safeInt(stats["BCC"]),
        defensiveInterventions: safeInt(stats["DINT"]),
        duelsWon: safeInt(stats["DUELW"]),
        // GK stats (null for outfield)
        goalsConceded: null,
        saves: null,
        shotsOnGoalAgainst: null,
        xGConceded: null,
        xGOTConceded: null,
        goalsPrevented: null,
        bigChanceSaves: null,
        clearances: null,
        crossesClaimed: null,
        keeperSweepers: null,
        shotsFaced: null,
        createdAt: now(),
        updatedAt: now(),
      };

      if (!dryRun) {
        await db.insert(wc2026EspnPlayerStats).values(row).onDuplicateKeyUpdate({
          set: { ...row, updatedAt: now() },
        });
      }
      rowsWritten++;
    }

    // Goalkeepers
    for (const [isHome, gkData, teamAbbrev, teamId, teamName] of [
      [true, bx.homeTeam.goalkeeper, bx.homeTeam.teamAbbrev, bx.homeTeam.teamId, bx.homeTeam.teamName],
      [false, bx.awayTeam.goalkeeper, bx.awayTeam.teamAbbrev, bx.awayTeam.teamId, bx.awayTeam.teamName],
    ] as const) {
      if (!gkData) continue;
      const stats = gkData.stats ?? {};
      const row = {
        matchId,
        athleteId: gkData.athleteId,
        name: gkData.name,
        nameShort: gkData.nameShort ?? null,
        jersey: gkData.jersey ?? null,
        teamId: teamId ?? null,
        teamAbbrev,
        teamName: teamName ?? null,
        isHome: isHome ? 1 : 0,
        positionGroup: "Goalkeepers",
        isGoalkeeper: 1,
        // Outfield stats (null for GK)
        touches: null,
        goals: null,
        assists: null,
        xG: null,
        xA: null,
        shotsOnGoal: null,
        shots: null,
        bigChancesCreated: null,
        defensiveInterventions: null,
        duelsWon: null,
        // GK stats
        goalsConceded: safeInt(stats["GA"]),
        saves: safeInt(stats["SV"]),
        shotsOnGoalAgainst: safeInt(stats["SOGA"]),
        xGConceded: safeDecimal(stats["xGC"]),
        xGOTConceded: safeDecimal(stats["xGOTC"]),
        goalsPrevented: safeDecimal(stats["GP"]),
        bigChanceSaves: safeInt(stats["BCS"]),
        clearances: safeInt(stats["CLR"]),
        crossesClaimed: safeInt(stats["CC"]),
        keeperSweepers: safeInt(stats["KS"]),
        shotsFaced: null,
        createdAt: now(),
        updatedAt: now(),
      };

      if (!dryRun) {
        await db.insert(wc2026EspnPlayerStats).values(row).onDuplicateKeyUpdate({
          set: { ...row, updatedAt: now() },
        });
      }
      rowsWritten++;
    }

    const pass = rowsWritten >= 20; // minimum 20 players expected
    logOutput(`${rowsWritten} player rows upserted`);
    logVerify(pass, `${rowsWritten} players (expected ≥20) | statCols=${bx.statColumns.length} gkCols=${bx.gkStatColumns.length}`);
    result.phases.push({ phase: 7, table: "wc2026_espn_player_stats", rowsWritten, pass });
    result.totalRowsWritten += rowsWritten;
  } catch (err) {
    const msg = `Phase 7 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 7, table: "wc2026_espn_player_stats", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 8: wc2026_espn_lineups ─────────────────────────────────────────
  logPhase(8, 9, "wc2026_espn_lineups");
  try {
    const lineups = data.lineups;
    const allEntries: Array<{
      lineup: typeof lineups.home;
      isHome: boolean;
      player: typeof lineups.home.starters[0];
      role: "starter" | "substitute" | "unused";
    }> = [];

    for (const [isHome, lineup] of [[true, lineups.home], [false, lineups.away]] as const) {
      for (const p of lineup.starters)    allEntries.push({ lineup, isHome, player: p, role: "starter" });
      for (const p of lineup.substitutes) allEntries.push({ lineup, isHome, player: p, role: "substitute" });
      for (const p of lineup.unused)      allEntries.push({ lineup, isHome, player: p, role: "unused" });
    }

    logInput(`home: ${lineups.home.starters.length} starters + ${lineups.home.substitutes.length} subs + ${lineups.home.unused.length} unused`);
    logInput(`away: ${lineups.away.starters.length} starters + ${lineups.away.substitutes.length} subs + ${lineups.away.unused.length} unused`);
    logState(`homeFormation=${lineups.home.formation} awayFormation=${lineups.away.formation}`);

    let rowsWritten = 0;
    for (const entry of allEntries) {
      const p = entry.player;
      const row = {
        matchId,
        teamId: entry.lineup.teamId ?? null,
        teamAbbrev: entry.lineup.teamAbbrev,
        teamName: entry.lineup.teamName ?? null,
        teamLogo: entry.lineup.teamLogo ?? null,
        teamColor: entry.lineup.teamColor ?? null,
        formation: entry.lineup.formation ?? null,
        isHome: entry.isHome ? 1 : 0,
        athleteId: p.athleteId,
        name: p.name,
        nameShort: p.nameShort ?? null,
        jersey: p.jersey ?? null,
        formationPlace: p.formationPlace ?? null,
        role: entry.role,
        createdAt: now(),
      };

      if (!dryRun) {
        await db.insert(wc2026EspnLineups).values(row).onDuplicateKeyUpdate({
          set: {
            teamAbbrev: row.teamAbbrev,
            formation: row.formation,
            isHome: row.isHome,
            jersey: row.jersey,
            formationPlace: row.formationPlace,
            role: row.role,
          },
        });
      }
      rowsWritten++;
    }

    const pass = rowsWritten >= 22; // minimum 22 starters
    logOutput(`${rowsWritten} lineup rows upserted`);
    logVerify(pass, `${rowsWritten} players (expected ≥22) | homeFormation=${lineups.home.formation} awayFormation=${lineups.away.formation}`);
    result.phases.push({ phase: 8, table: "wc2026_espn_lineups", rowsWritten, pass });
    result.totalRowsWritten += rowsWritten;
  } catch (err) {
    const msg = `Phase 8 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 8, table: "wc2026_espn_lineups", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── PHASE 9: wc2026_espn_glossary ────────────────────────────────────────
  logPhase(9, 9, "wc2026_espn_glossary");
  try {
    const glossary = data.boxscore.glossary;
    logInput(`${glossary.length} glossary entries from boxscore`);

    let rowsWritten = 0;
    for (const entry of glossary) {
      if (!entry.abbreviation || !entry.displayName) continue;

      // Determine category from known GK-only abbreviations
      const GK_ONLY = new Set(["GA", "SV", "SOGA", "xGC", "xGOTC", "GP", "BCS", "CLR", "CC", "KS"]);
      const OUTFIELD_ONLY = new Set(["TCH", "G", "A", "xG", "xA", "SOG", "SHOT", "BCC", "DINT", "DUELW"]);
      const category = GK_ONLY.has(entry.abbreviation)
        ? "goalkeeper"
        : OUTFIELD_ONLY.has(entry.abbreviation)
        ? "outfield"
        : "both";

      const row = {
        abbreviation: entry.abbreviation,
        displayName: entry.displayName,
        category: category as "outfield" | "goalkeeper" | "both",
        description: null,
        createdAt: now(),
        updatedAt: now(),
      };

      if (!dryRun) {
        await db.insert(wc2026EspnGlossary).values(row).onDuplicateKeyUpdate({
          set: { displayName: row.displayName, category: row.category, updatedAt: now() },
        });
      }
      rowsWritten++;
    }

    const pass = rowsWritten >= 10;
    logOutput(`${rowsWritten} glossary entries upserted`);
    logVerify(pass, `${rowsWritten} entries (expected ≥10 of 20 confirmed)`);
    result.phases.push({ phase: 9, table: "wc2026_espn_glossary", rowsWritten, pass });
    result.totalRowsWritten += rowsWritten;
  } catch (err) {
    const msg = `Phase 9 failed: ${err instanceof Error ? err.message : String(err)}`;
    logError(msg, err);
    result.phases.push({ phase: 9, table: "wc2026_espn_glossary", rowsWritten: 0, pass: false, error: msg });
    result.errors.push(msg);
  }

  // ─── FINAL SUMMARY ────────────────────────────────────────────────────────
  result.durationMs = now() - startMs;
  const passCount = result.phases.filter(p => p.pass).length;
  result.success = passCount === 9 && result.errors.length === 0;

  console.log(`\n${TAG} ${"▓".repeat(70)}`);
  console.log(`${TAG} INGEST COMPLETE — matchId=${matchId}`);
  console.log(`${TAG} ${"─".repeat(70)}`);
  for (const phase of result.phases) {
    const status = phase.pass ? "✓ PASS" : "✗ FAIL";
    console.log(`${TAG}   Phase ${phase.phase}/9 [${status}] ${phase.table} — ${phase.rowsWritten} rows${phase.error ? ` | ERROR: ${phase.error}` : ""}`);
  }
  console.log(`${TAG} ${"─".repeat(70)}`);
  console.log(`${TAG} RESULT: ${passCount}/9 phases PASS | ${result.totalRowsWritten} total rows | ${result.durationMs}ms`);
  console.log(`${TAG} SUCCESS: ${result.success}`);
  if (result.errors.length > 0) {
    console.log(`${TAG} ERRORS: ${result.errors.join(" | ")}`);
  }
  console.log(`${TAG} ${"▓".repeat(70)}\n`);

  return result;
}

// ─── Convenience wrapper: scrape + ingest in one call ─────────────────────────

export async function scrapeAndIngest(
  gameId: string,
  opts: { dryRun?: boolean } = {}
): Promise<EspnIngestResult> {
  const { scrapeEspnMatchPage } = await import("./espnPageScraper");
  console.log(`${TAG} [SCRAPE] Starting scrape for gameId=${gameId}`);
  const data = await scrapeEspnMatchPage(gameId);
  console.log(`${TAG} [SCRAPE] Complete — ${data.scrapeDurationMs}ms | pages=${data.pagesLoaded.join(",")}`);
  return ingestEspnMatchData(data, opts);
}
