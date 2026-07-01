
import { scrapeAndIngest } from "/home/ubuntu/ai-sports-betting/server/wc2026/espnDbIngester.ts";
import { getDb } from "/home/ubuntu/ai-sports-betting/server/db.ts";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

const GAME_ID = "760444";
const RESULT_FILE = "/tmp/espn_ingest_result_760444.json";

async function run() {
  console.log("[RUNNER] ════════════════════════════════════════════════════════════");
  console.log("[RUNNER]   ESPN WC2026 INGEST RUNNER — gameId=" + GAME_ID);
  console.log("[RUNNER] ════════════════════════════════════════════════════════════");

  const ingestResult = await scrapeAndIngest(GAME_ID, { dryRun: false });
  console.log("[RUNNER] Ingest complete — success=" + ingestResult.success + " | rows=" + ingestResult.totalRowsWritten + " | errors=" + ingestResult.errors.length);

  // DB row counts
  const db = await getDb();
  const tables = [
    "wc2026_espn_matches",
    "wc2026_espn_match_odds",
    "wc2026_espn_team_stats",
    "wc2026_espn_match_stats",
    "wc2026_espn_expected_goals",
    "wc2026_espn_shot_map",
    "wc2026_espn_player_stats",
    "wc2026_espn_lineups",
    "wc2026_espn_glossary",
  ];

  const rowCounts: Record<string, number> = {};
  for (const table of tables) {
    const isGlossary = table === "wc2026_espn_glossary";
    const query = isGlossary
      ? sql.raw(`SELECT COUNT(*) as cnt FROM ${table}`)
      : sql.raw(`SELECT COUNT(*) as cnt FROM ${table} WHERE matchId = '760444'`);
    const [rows] = await db.execute(query);
    rowCounts[table] = Number((rows as any)[0]?.cnt ?? 0);
    console.log("[RUNNER] Table " + table + " → " + rowCounts[table] + " rows");
  }

  // ── Spot checks (using VERIFIED column names from drizzle/schema.ts) ─────────

  // 1. Match metadata
  const [matchData] = await db.execute(sql.raw(
    `SELECT homeTeamName, awayTeamName, homeScore, awayScore, venue, attendance, referee,
            homeFormation, awayFormation, matchDateUtc, statusState, statusDetail, statusDisplay,
            homeTeamAbbrev, awayTeamAbbrev, homeTeamId, awayTeamId, competition, round, season
     FROM wc2026_espn_matches WHERE matchId = '760444' LIMIT 1`
  ));

  // 2. Shot map (iconType=outcome, goalZone=zone, period, clock)
  const [shotData] = await db.execute(sql.raw(
    `SELECT shotType, iconType, fieldStartX, fieldStartY, fieldEndX, fieldEndY,
            goalPositionY, goalPositionZ, playerName, playerJersey, xG, xGOT,
            period, clock, situation, goalZone, teamAbbrev, isAway
     FROM wc2026_espn_shot_map WHERE matchId = '760444' LIMIT 1`
  ));

  // 3. Defense stats (from match_stats)
  const [defData] = await db.execute(sql.raw(
    `SELECT homeTackles, awayTackles, homeInterceptions, awayInterceptions,
            homeClearances, awayClearances, homeRecoveries, awayRecoveries,
            homeFoulsCommitted, awayFoulsCommitted, homeOffsides, awayOffsides,
            homeFoulYellowCards, awayFoulYellowCards, homeFoulRedCards, awayFoulRedCards,
            homeDuelsWon, awayDuelsWon, homeAerialsWon, awayAerialsWon
     FROM wc2026_espn_match_stats WHERE matchId = '760444' LIMIT 1`
  ));

  // 4. Expected goals
  const [xgData] = await db.execute(sql.raw(
    `SELECT homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay,
            homeXGSetPlay, awayXGSetPlay, homeXGOT, awayXGOT, homeXA, awayXA, perPlayerJson
     FROM wc2026_espn_expected_goals WHERE matchId = '760444' LIMIT 1`
  ));

  // 5. Match odds
  const [oddsData] = await db.execute(sql.raw(
    `SELECT provider, homeMoneylineCurrent, awayMoneylineCurrent, drawMoneylineCurrent,
            homeSpreadLine, homeTotalSide, homeMoneylineOpen, awayMoneylineOpen
     FROM wc2026_espn_match_odds WHERE matchId = '760444' LIMIT 1`
  ));

  // 6. Team stats (tmStatsGrph)
  const [teamStatsData] = await db.execute(sql.raw(
    `SELECT possession, possessionAway, shotsOnGoal, shotsOnGoalAway,
            shotAttempts, shotAttemptsAway, fouls, foulsAway,
            yellowCards, yellowCardsAway, redCards, redCardsAway,
            cornerKicks, cornerKicksAway, saves, savesAway
     FROM wc2026_espn_team_stats WHERE matchId = '760444' LIMIT 1`
  ));

  // 7. Passes (from match_stats)
  const [passData] = await db.execute(sql.raw(
    `SELECT homePasses, awayPasses, homeAccuratePasses, awayAccuratePasses,
            homePassAccuracyPct, awayPassAccuracyPct,
            homeAccurateLongBalls, awayAccurateLongBalls,
            homeAccurateCrosses, awayAccurateCrosses,
            homeTotalBackZonePass, awayTotalBackZonePass,
            homeTotalForwardZonePass, awayTotalForwardZonePass,
            homePassTouchesInOppBox, awayPassTouchesInOppBox,
            homeTotalThrows, awayTotalThrows
     FROM wc2026_espn_match_stats WHERE matchId = '760444' LIMIT 1`
  ));

  // 8. Attack (from match_stats)
  const [attackData] = await db.execute(sql.raw(
    `SELECT homeBigChancesCreated, awayBigChancesCreated,
            homeBigChancesMissed, awayBigChancesMissed,
            homeAttemptsInsideBox, awayAttemptsInsideBox,
            homeAttemptsOutsideBox, awayAttemptsOutsideBox,
            homeThroughBalls, awayThroughBalls,
            homeAttkTouchesInOppBox, awayAttkTouchesInOppBox,
            homeFouledInFinalThird, awayFouledInFinalThird,
            homeCornersWon, awayCornersWon
     FROM wc2026_espn_match_stats WHERE matchId = '760444' LIMIT 1`
  ));

  // 9. Goalkeeping (from match_stats)
  const [gkData] = await db.execute(sql.raw(
    `SELECT homeGkSaves, awayGkSaves, homeGoalKicks, awayGoalKicks,
            homeShotsFaced, awayShotsFaced,
            homeTotalHighClaims, awayTotalHighClaims,
            homePenaltyKicksSaved, awayPenaltyKicksSaved
     FROM wc2026_espn_match_stats WHERE matchId = '760444' LIMIT 1`
  ));

  // 10. Shots (from match_stats)
  const [shotsData] = await db.execute(sql.raw(
    `SELECT homeShotsOnGoal, awayShotsOnGoal, homeShots, awayShots,
            homeShotsBlocked, awayShotsBlocked, homeHitWoodwork, awayHitWoodwork
     FROM wc2026_espn_match_stats WHERE matchId = '760444' LIMIT 1`
  ));

  // 11. Player stats (outfield) — use 'name' not 'playerName', 'teamAbbrev' not 'teamSide'
  const [playerData] = await db.execute(sql.raw(
    `SELECT name, jersey, teamAbbrev, isHome, positionGroup, isGoalkeeper,
            tch, g, a, xG, xA, sog, shot, bcc, dint, duelw,
            appearances, foulsCommitted, foulsSuffered, yellowCards, redCards, offsides
     FROM wc2026_espn_player_stats WHERE matchId = '760444' AND isGoalkeeper = 0 LIMIT 1`
  ));

  // 12. GK stats
  const [gkPlayerData] = await db.execute(sql.raw(
    `SELECT name, jersey, teamAbbrev, isGoalkeeper,
            ga, sv, soga, xGC, xGOTC, gp, bcs, clr, cc, ks, shotsFaced
     FROM wc2026_espn_player_stats WHERE matchId = '760444' AND isGoalkeeper = 1 LIMIT 1`
  ));

  // 13. Lineups — use 'name' not 'playerName', 'jersey' not 'jerseyNumber', 'role' enum not 'isStarter'
  const [lineupData] = await db.execute(sql.raw(
    `SELECT name, jersey, teamAbbrev, isHome, role, formationPlace
     FROM wc2026_espn_lineups WHERE matchId = '760444' LIMIT 1`
  ));

  // 14. Starters count (role = 'starter')
  const [starterCount] = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM wc2026_espn_lineups WHERE matchId = '760444' AND role = 'starter'`
  ));

  // 15. Total lineup count
  const [lineupTotal] = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM wc2026_espn_lineups WHERE matchId = '760444'`
  ));

  // 16. Shot count by iconType
  const [shotGoals] = await db.execute(sql.raw(
    `SELECT COUNT(*) as cnt FROM wc2026_espn_shot_map WHERE matchId = '760444' AND iconType = 'goal'`
  ));

  const output = {
    ingestResult,
    rowCounts,
    spotChecks: {
      match: (matchData as any)[0] ?? null,
      shot: (shotData as any)[0] ?? null,
      defense: (defData as any)[0] ?? null,
      xg: (xgData as any)[0] ?? null,
      odds: (oddsData as any)[0] ?? null,
      teamStats: (teamStatsData as any)[0] ?? null,
      passes: (passData as any)[0] ?? null,
      attack: (attackData as any)[0] ?? null,
      gk: (gkData as any)[0] ?? null,
      shots: (shotsData as any)[0] ?? null,
      player: (playerData as any)[0] ?? null,
      gkPlayer: (gkPlayerData as any)[0] ?? null,
      lineup: (lineupData as any)[0] ?? null,
      starterCount: Number((starterCount as any)[0]?.cnt ?? 0),
      lineupTotal: Number((lineupTotal as any)[0]?.cnt ?? 0),
      shotGoals: Number((shotGoals as any)[0]?.cnt ?? 0),
    },
  };

  writeFileSync(RESULT_FILE, JSON.stringify(output, null, 2));
  console.log("[RUNNER] Result written to " + RESULT_FILE);
  process.exit(0);
}

run().catch(err => {
  console.error("[RUNNER] FATAL:", err);
  process.exit(1);
});
