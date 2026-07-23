/**
 * espnIngest.test.live.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Live integration test: scrape + ingest all 9 wc2026_espn_* tables.
 * Accepts gameId as CLI argument (defaults to 760487 for backward compat).
 *
 * SCHEMA-VERIFIED COLUMN NAMES (from drizzle/schema.ts forensic audit):
 *   wc2026_espn_matches:     espn_match_id, homeTeamId, homeTeamAbbrev, homeTeamName,
 *                            homeScore, awayScore, venue, matchDateUtc,
 *                            statusState, statusDetail, statusDisplay,
 *                            homeFormation, awayFormation, attendance, referee
 *   wc2026_espn_team_stats:  possession, shotsOnGoal, shotsOnGoalAway,
 *                            shotAttempts, shotAttemptsAway, fouls, foulsAway,
 *                            yellowCards, yellowCardsAway, redCards, redCardsAway,
 *                            cornerKicks, cornerKicksAway, saves, savesAway, possessionAway
 *   wc2026_espn_match_stats: homeTackles, awayTackles, homeInterceptions,
 *                            awayInterceptions, homeClearances, awayClearances,
 *                            homeRecoveries, awayRecoveries,
 *                            homePasses, awayPasses, homeAccuratePasses, awayAccuratePasses,
 *                            homePassAccuracyPct, awayPassAccuracyPct,
 *                            homeAccurateLongBalls, awayAccurateLongBalls,
 *                            homeAccurateCrosses, awayAccurateCrosses,
 *                            homeBigChancesCreated, awayBigChancesCreated,
 *                            homeBigChancesMissed, awayBigChancesMissed,
 *                            homeAttemptsInsideBox, awayAttemptsInsideBox,
 *                            homeAttemptsOutsideBox, awayAttemptsOutsideBox,
 *                            homeGkSaves, awayGkSaves, homeGoalKicks, awayGoalKicks,
 *                            homeShotsFaced, awayShotsFaced,
 *                            homeTotalHighClaims, awayTotalHighClaims,
 *                            homePenaltyKicksSaved, awayPenaltyKicksSaved,
 *                            homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay,
 *                            homeXGSetPlay, awayXGSetPlay, homeXGOT, awayXGOT,
 *                            homeFoulsCommitted, awayFoulsCommitted,
 *                            homeOffsides, awayOffsides,
 *                            homeFoulYellowCards, awayFoulYellowCards,
 *                            homeFoulRedCards, awayFoulRedCards,
 *                            homeDuelsWon, awayDuelsWon, homeDuels, awayDuels,
 *                            homeAerialsWon, awayAerialsWon
 *   wc2026_espn_expected_goals: homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay,
 *                               homeXGSetPlay, awayXGSetPlay, homeXGOT, awayXGOT,
 *                               homeXA, awayXA, perPlayerJson
 *   wc2026_espn_shot_map:    fieldStartX, fieldStartY, fieldEndX, fieldEndY,
 *                            goalPositionY, goalPositionZ, playerName, playerJersey,
 *                            shotType, iconType, xG, xGOT, period, clock,
 *                            situation, goalZone, description, shortDescription
 *   wc2026_espn_player_stats: name, jersey, teamAbbrev, isHome, positionGroup,
 *                             isGoalkeeper, tch, g, a, xG, xA, sog, shot, bcc, dint, duelw,
 *                             ga, sv, soga, xGC, xGOTC, gp, bcs, clr, cc, ks,
 *                             appearances, foulsCommitted, foulsSuffered, ownGoals,
 *                             redCards, subIns, yellowCards, offsides, shotsFaced
 *   wc2026_espn_lineups:     name, jersey, teamAbbrev, isHome, role (enum), formationPlace
 *   wc2026_espn_match_odds:  provider, homeMoneylineCurrent, awayMoneylineCurrent,
 *                            drawMoneylineCurrent, homeSpreadLine, homeTotalSide
 *
 * Usage:
 *   node server/wc2026/espnIngest.test.live.mjs [gameId]
 */

import { spawnSync } from "child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");

// ─── CLI arg: gameId ──────────────────────────────────────────────────────────
const GAME_ID = process.argv[2] ?? "760487";
const LOG_FILE = join(projectRoot, `.scraper-logs/espn_ingest_test_${GAME_ID}.txt`);
const RESULT_FILE = join(tmpdir(), `espn_ingest_result_${GAME_ID}.json`);

// ─── Color helpers ────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  magenta: "\x1b[35m", blue: "\x1b[34m",
};

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function banner(msg, color = C.cyan) {
  const bar = "═".repeat(70);
  log(`${color}${bar}${C.reset}`);
  log(`${color}${C.bold}  ${msg}${C.reset}`);
  log(`${color}${bar}${C.reset}`);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(label, value, expected) {
  const ok = value === expected;
  if (ok) {
    log(`  ${C.green}✓ PASS${C.reset}  ${label} = ${JSON.stringify(value)}`);
    passed++;
  } else {
    const msg = `  ${C.red}✗ FAIL${C.reset}  ${label} = ${JSON.stringify(value)} (expected ${JSON.stringify(expected)})`;
    log(msg);
    failed++;
    failures.push(`${label} = ${JSON.stringify(value)} (expected ${JSON.stringify(expected)})`);
  }
}

function checkGt(label, value, min) {
  if (typeof value === "number" && value > min) {
    log(`  ${C.green}✓ PASS${C.reset}  ${label} = ${value} (> ${min})`);
    passed++;
  } else {
    const msg = `  ${C.red}✗ FAIL${C.reset}  ${label} = ${JSON.stringify(value)} (expected > ${min})`;
    log(msg);
    failed++;
    failures.push(`${label} = ${JSON.stringify(value)} (expected > ${min})`);
  }
}

function checkNotNull(label, value) {
  if (value !== null && value !== undefined) {
    log(`  ${C.green}✓ PASS${C.reset}  ${label} = ${JSON.stringify(value)}`);
    passed++;
  } else {
    const msg = `  ${C.red}✗ FAIL${C.reset}  ${label} = ${JSON.stringify(value)} (expected non-null)`;
    log(msg);
    failed++;
    failures.push(`${label} = ${JSON.stringify(value)} (expected non-null)`);
  }
}

function checkTruthy(label, value) {
  if (!!value) {
    log(`  ${C.green}✓ PASS${C.reset}  ${label} = ${JSON.stringify(value)}`);
    passed++;
  } else {
    const msg = `  ${C.red}✗ FAIL${C.reset}  ${label} = ${JSON.stringify(value)} (expected truthy)`;
    log(msg);
    failed++;
    failures.push(`${label} = ${JSON.stringify(value)} (expected truthy)`);
  }
}

// ─── Temporary runner script ──────────────────────────────────────────────────
const tmpScript = join(projectRoot, `server/wc2026/_espn_ingest_runner_${GAME_ID}_tmp.ts`);
writeFileSync(tmpScript, `
import { scrapeAndIngest } from "${join(__dirname, "espnDbIngester.ts")}";
import { getDb } from "${join(projectRoot, "server/db.ts")}";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

const GAME_ID = "${GAME_ID}";
const RESULT_FILE = "${RESULT_FILE}";

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
      ? sql.raw(\`SELECT COUNT(*) as cnt FROM \${table}\`)
      : sql.raw(\`SELECT COUNT(*) as cnt FROM \${table} WHERE espn_match_id = '${GAME_ID}'\`);
    const [rows] = await db.execute(query);
    rowCounts[table] = Number((rows as any)[0]?.cnt ?? 0);
    console.log("[RUNNER] Table " + table + " → " + rowCounts[table] + " rows");
  }

  // ── Spot checks (using VERIFIED column names from drizzle/schema.ts) ─────────

  // 1. Match metadata
  const [matchData] = await db.execute(sql.raw(
    \`SELECT homeTeamName, awayTeamName, homeScore, awayScore, venue, attendance, referee,
            homeFormation, awayFormation, matchDateUtc, statusState, statusDetail, statusDisplay,
            homeTeamAbbrev, awayTeamAbbrev, homeTeamId, awayTeamId, competition, round, season
     FROM wc2026_espn_matches WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 2. Shot map (iconType=outcome, goalZone=zone, period, clock)
  const [shotData] = await db.execute(sql.raw(
    \`SELECT shotType, iconType, fieldStartX, fieldStartY, fieldEndX, fieldEndY,
            goalPositionY, goalPositionZ, playerName, playerJersey, xG, xGOT,
            period, clock, situation, goalZone, teamAbbrev, isAway
     FROM wc2026_espn_shot_map WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 3. Defense stats (from match_stats)
  const [defData] = await db.execute(sql.raw(
    \`SELECT homeTackles, awayTackles, homeInterceptions, awayInterceptions,
            homeClearances, awayClearances, homeRecoveries, awayRecoveries,
            homeFoulsCommitted, awayFoulsCommitted, homeOffsides, awayOffsides,
            homeFoulYellowCards, awayFoulYellowCards, homeFoulRedCards, awayFoulRedCards,
            homeDuelsWon, awayDuelsWon, homeAerialsWon, awayAerialsWon
     FROM wc2026_espn_match_stats WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 4. Expected goals
  const [xgData] = await db.execute(sql.raw(
    \`SELECT homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay,
            homeXGSetPlay, awayXGSetPlay, homeXGOT, awayXGOT, homeXA, awayXA, perPlayerJson
     FROM wc2026_espn_expected_goals WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 5. Match odds (table dropped in DB-013 — skip)
  const oddsData = [null];

  // 6. Team stats (tmStatsGrph)
  const [teamStatsData] = await db.execute(sql.raw(
    \`SELECT possession, possessionAway, shotsOnGoal, shotsOnGoalAway,
            shotAttempts, shotAttemptsAway, fouls, foulsAway,
            yellowCards, yellowCardsAway, redCards, redCardsAway,
            cornerKicks, cornerKicksAway, saves, savesAway
     FROM wc2026_espn_team_stats WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 7. Passes (from match_stats)
  const [passData] = await db.execute(sql.raw(
    \`SELECT homePasses, awayPasses, homeAccuratePasses, awayAccuratePasses,
            homePassAccuracyPct, awayPassAccuracyPct,
            homeAccurateLongBalls, awayAccurateLongBalls,
            homeAccurateCrosses, awayAccurateCrosses,
            homeTotalBackZonePass, awayTotalBackZonePass,
            homeTotalForwardZonePass, awayTotalForwardZonePass,
            homePassTouchesInOppBox, awayPassTouchesInOppBox,
            homeTotalThrows, awayTotalThrows
     FROM wc2026_espn_match_stats WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 8. Attack (from match_stats)
  const [attackData] = await db.execute(sql.raw(
    \`SELECT homeBigChancesCreated, awayBigChancesCreated,
            homeBigChancesMissed, awayBigChancesMissed,
            homeAttemptsInsideBox, awayAttemptsInsideBox,
            homeAttemptsOutsideBox, awayAttemptsOutsideBox,
            homeThroughBalls, awayThroughBalls,
            homeAttkTouchesInOppBox, awayAttkTouchesInOppBox,
            homeFouledInFinalThird, awayFouledInFinalThird,
            homeCornersWon, awayCornersWon
     FROM wc2026_espn_match_stats WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 9. Goalkeeping (from match_stats)
  const [gkData] = await db.execute(sql.raw(
    \`SELECT homeGkSaves, awayGkSaves, homeGoalKicks, awayGoalKicks,
            homeShotsFaced, awayShotsFaced,
            homeTotalHighClaims, awayTotalHighClaims,
            homePenaltyKicksSaved, awayPenaltyKicksSaved
     FROM wc2026_espn_match_stats WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 10. Shots (from match_stats)
  const [shotsData] = await db.execute(sql.raw(
    \`SELECT homeShotsOnGoal, awayShotsOnGoal, homeShots, awayShots,
            homeShotsBlocked, awayShotsBlocked, homeHitWoodwork, awayHitWoodwork
     FROM wc2026_espn_match_stats WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 11. Player stats (outfield) — use 'name' not 'playerName', 'teamAbbrev' not 'teamSide'
  const [playerData] = await db.execute(sql.raw(
    \`SELECT name, jersey, teamAbbrev, isHome, positionGroup, isGoalkeeper,
            tch, g, a, xG, xA, sog, shot, bcc, dint, duelw,
            appearances, foulsCommitted, foulsSuffered, yellowCards, redCards, offsides
     FROM wc2026_espn_player_stats WHERE espn_match_id = '${GAME_ID}' AND isGoalkeeper = 0 LIMIT 1\`
  ));

  // 12. GK stats
  const [gkPlayerData] = await db.execute(sql.raw(
    \`SELECT name, jersey, teamAbbrev, isGoalkeeper,
            ga, sv, soga, xGC, xGOTC, gp, bcs, clr, cc, ks, shotsFaced
     FROM wc2026_espn_player_stats WHERE espn_match_id = '${GAME_ID}' AND isGoalkeeper = 1 LIMIT 1\`
  ));

  // 13. Lineups — use 'name' not 'playerName', 'jersey' not 'jerseyNumber', 'role' enum not 'isStarter'
  const [lineupData] = await db.execute(sql.raw(
    \`SELECT name, jersey, teamAbbrev, isHome, role, formationPlace
     FROM wc2026_espn_lineups WHERE espn_match_id = '${GAME_ID}' LIMIT 1\`
  ));

  // 14. Starters count (role = 'starter')
  const [starterCount] = await db.execute(sql.raw(
    \`SELECT COUNT(*) as cnt FROM wc2026_espn_lineups WHERE espn_match_id = '${GAME_ID}' AND role = 'starter'\`
  ));

  // 15. Total lineup count
  const [lineupTotal] = await db.execute(sql.raw(
    \`SELECT COUNT(*) as cnt FROM wc2026_espn_lineups WHERE espn_match_id = '${GAME_ID}'\`
  ));

  // 16. Shot count by iconType
  const [shotGoals] = await db.execute(sql.raw(
    \`SELECT COUNT(*) as cnt FROM wc2026_espn_shot_map WHERE espn_match_id = '${GAME_ID}' AND iconType = 'goal'\`
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
`);

// ─── RUN ─────────────────────────────────────────────────────────────────────
banner(`ESPN WC2026 INGEST LIVE TEST — gameId=${GAME_ID}`, C.magenta);
log(`  Target: https://www.espn.com/soccer/match/_/gameId/${GAME_ID}`);
log(`  Tables: 9 wc2026_espn_* tables`);
log(`  Timeout: 300s (3 ESPN page loads + DB writes)`);
log(`  Log file: ${LOG_FILE}`);

const t0 = Date.now();
const proc = spawnSync(
  join(projectRoot, "node_modules/.bin/tsx"),
  [tmpScript],
  {
    cwd: projectRoot,
    timeout: 300_000,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["inherit", "inherit", "inherit"],
  }
);

const elapsed = Date.now() - t0;

if (proc.status !== 0) {
  banner(`INGEST PROCESS FAILED (exit ${proc.status}, ${(elapsed/1000).toFixed(1)}s)`, C.red);
  if (proc.error) console.error(proc.error);
  process.exit(1);
}

if (!existsSync(RESULT_FILE)) {
  banner("RESULT FILE NOT FOUND", C.red);
  process.exit(1);
}

const { ingestResult, rowCounts, spotChecks } = JSON.parse(readFileSync(RESULT_FILE, "utf8"));

// ─── PHASE RESULTS ───────────────────────────────────────────────────────────
banner("Phase Results (9 Tables)");
for (const phase of ingestResult.phases) {
  const status = phase.pass ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`;
  log(`  Phase ${phase.phase}/9 [${status}] ${phase.table} — ${phase.rowsWritten} rows${phase.error ? ` | ERROR: ${phase.error}` : ""}`);
}

// ─── INGEST RESULT VALIDATION ─────────────────────────────────────────────────
banner("Ingest Result Validation");
check("result.success", ingestResult.success, true);
checkGt("result.totalRowsWritten", ingestResult.totalRowsWritten, 50);
check("result.errors.length", ingestResult.errors.length, 0);
check("result.phases.length", ingestResult.phases.length, 9);
const phasesPassed = ingestResult.phases.filter(p => p.pass).length;
check("phases all pass (9/9)", phasesPassed, 9);

// ─── DB ROW COUNTS ────────────────────────────────────────────────────────────
banner("Database Row Counts");
for (const [table, cnt] of Object.entries(rowCounts)) {
  checkGt(table, cnt, 0);
}

// ─── MATCH METADATA ──────────────────────────────────────────────────────────
banner("Match Metadata (wc2026_espn_matches)");
if (spotChecks.match) {
  const m = spotChecks.match;
  log(`  Match: ${m.homeTeamName} ${m.homeScore}-${m.awayScore} ${m.awayTeamName}`);
  log(`  Venue: ${m.venue} | Attendance: ${m.attendance} | Referee: ${m.referee}`);
  log(`  Competition: ${m.competition} | Round: ${m.round} | Season: ${m.season}`);
  log(`  Formations: ${m.homeFormation} vs ${m.awayFormation}`);
  log(`  Status: ${m.statusState} / ${m.statusDetail} / ${m.statusDisplay}`);
  log(`  matchDateUtc: ${m.matchDateUtc} | homeTeamId: ${m.homeTeamId}`);
  checkTruthy("homeTeamName", m.homeTeamName);
  checkTruthy("awayTeamName", m.awayTeamName);
  checkTruthy("venue", m.venue);
  checkNotNull("homeScore", m.homeScore);
  checkNotNull("awayScore", m.awayScore);
  checkTruthy("homeFormation", m.homeFormation);
  checkTruthy("awayFormation", m.awayFormation);
  checkNotNull("matchDateUtc", m.matchDateUtc);
  checkTruthy("homeTeamId", m.homeTeamId);
  checkTruthy("homeTeamAbbrev", m.homeTeamAbbrev);
  checkTruthy("statusState", m.statusState);
}

// ─── TEAM STATS (tmStatsGrph) ─────────────────────────────────────────────────
banner("Team Stats (wc2026_espn_team_stats — 8 summary stats)");
if (spotChecks.teamStats) {
  const ts = spotChecks.teamStats;
  log(`  Possession: H=${ts.possession} A=${ts.possessionAway}`);
  log(`  Shots on Goal: H=${ts.shotsOnGoal} A=${ts.shotsOnGoalAway}`);
  log(`  Shot Attempts: H=${ts.shotAttempts} A=${ts.shotAttemptsAway}`);
  log(`  Fouls: H=${ts.fouls} A=${ts.foulsAway}`);
  log(`  Yellow Cards: H=${ts.yellowCards} A=${ts.yellowCardsAway}`);
  log(`  Red Cards: H=${ts.redCards} A=${ts.redCardsAway}`);
  log(`  Corner Kicks: H=${ts.cornerKicks} A=${ts.cornerKicksAway}`);
  log(`  Saves: H=${ts.saves} A=${ts.savesAway}`);
  checkNotNull("possession", ts.possession);
  checkNotNull("shotsOnGoal", ts.shotsOnGoal);
  checkNotNull("shotAttempts", ts.shotAttempts);
  checkNotNull("fouls", ts.fouls);
  checkNotNull("cornerKicks", ts.cornerKicks);
  checkNotNull("saves", ts.saves);
  checkNotNull("possessionAway", ts.possessionAway);
}

// ─── SHOTS (match_stats) ──────────────────────────────────────────────────────
banner("Shots (wc2026_espn_match_stats — shtsTbls)");
if (spotChecks.shots) {
  const s = spotChecks.shots;
  log(`  SoG: H=${s.homeShotsOnGoal} A=${s.awayShotsOnGoal}`);
  log(`  Total Shots: H=${s.homeShots} A=${s.awayShots}`);
  log(`  Blocked: H=${s.homeShotsBlocked} A=${s.awayShotsBlocked}`);
  log(`  Hit Woodwork: H=${s.homeHitWoodwork} A=${s.awayHitWoodwork}`);
  checkNotNull("homeShotsOnGoal", s.homeShotsOnGoal);
  checkNotNull("homeShots", s.homeShots);
}

// ─── DEFENSE ─────────────────────────────────────────────────────────────────
banner("Defense (wc2026_espn_match_stats — tmStatsTbls[defense])");
if (spotChecks.defense) {
  const d = spotChecks.defense;
  log(`  Tackles: H=${d.homeTackles} A=${d.awayTackles}`);
  log(`  Interceptions: H=${d.homeInterceptions} A=${d.awayInterceptions}`);
  log(`  Clearances: H=${d.homeClearances} A=${d.awayClearances}`);
  log(`  Recoveries: H=${d.homeRecoveries} A=${d.awayRecoveries}`);
  log(`  Duels Won: H=${d.homeDuelsWon} A=${d.awayDuelsWon} | Aerials: H=${d.homeAerialsWon} A=${d.awayAerialsWon}`);
  log(`  Fouls: H=${d.homeFoulsCommitted} A=${d.awayFoulsCommitted} | Offsides: H=${d.homeOffsides} A=${d.awayOffsides}`);
  log(`  Yellow: H=${d.homeFoulYellowCards} A=${d.awayFoulYellowCards} | Red: H=${d.homeFoulRedCards} A=${d.awayFoulRedCards}`);
  checkNotNull("homeTackles", d.homeTackles);
  checkNotNull("homeClearances", d.homeClearances);
  checkNotNull("homeInterceptions", d.homeInterceptions);
  checkNotNull("homeRecoveries", d.homeRecoveries);
  checkNotNull("homeDuelsWon", d.homeDuelsWon);
  checkNotNull("homeFoulsCommitted", d.homeFoulsCommitted);
}

// ─── PASSES ──────────────────────────────────────────────────────────────────
banner("Passes (wc2026_espn_match_stats — pssTbls)");
if (spotChecks.passes) {
  const p = spotChecks.passes;
  log(`  Total Passes: H=${p.homePasses} A=${p.awayPasses}`);
  log(`  Accurate Passes: H=${p.homeAccuratePasses} A=${p.awayAccuratePasses}`);
  log(`  Pass Accuracy: H=${p.homePassAccuracyPct} A=${p.awayPassAccuracyPct}`);
  log(`  Long Balls: H=${p.homeAccurateLongBalls} A=${p.awayAccurateLongBalls}`);
  log(`  Crosses: H=${p.homeAccurateCrosses} A=${p.awayAccurateCrosses}`);
  log(`  Throws: H=${p.homeTotalThrows} A=${p.awayTotalThrows}`);
  log(`  Opp Box Touches: H=${p.homePassTouchesInOppBox} A=${p.awayPassTouchesInOppBox}`);
  checkNotNull("homePasses", p.homePasses);
  checkNotNull("homePassAccuracyPct", p.homePassAccuracyPct);
  checkNotNull("homeAccurateLongBalls", p.homeAccurateLongBalls);
}

// ─── ATTACK ──────────────────────────────────────────────────────────────────
banner("Attack (wc2026_espn_match_stats — attkTbls)");
if (spotChecks.attack) {
  const a = spotChecks.attack;
  log(`  Big Chances Created: H=${a.homeBigChancesCreated} A=${a.awayBigChancesCreated}`);
  log(`  Big Chances Missed: H=${a.homeBigChancesMissed} A=${a.awayBigChancesMissed}`);
  log(`  Attempts Inside Box: H=${a.homeAttemptsInsideBox} A=${a.awayAttemptsInsideBox}`);
  log(`  Attempts Outside Box: H=${a.homeAttemptsOutsideBox} A=${a.awayAttemptsOutsideBox}`);
  log(`  Through Balls: H=${a.homeThroughBalls} A=${a.awayThroughBalls}`);
  log(`  Corners Won: H=${a.homeCornersWon} A=${a.awayCornersWon}`);
  checkNotNull("homeBigChancesCreated", a.homeBigChancesCreated);
  checkNotNull("homeAttemptsInsideBox", a.homeAttemptsInsideBox);
}

// ─── GOALKEEPING ─────────────────────────────────────────────────────────────
banner("Goalkeeping (wc2026_espn_match_stats — tmStatsTbls[goalkeeping])");
if (spotChecks.gk) {
  const g = spotChecks.gk;
  log(`  GK Saves: H=${g.homeGkSaves} A=${g.awayGkSaves}`);
  log(`  Goal Kicks: H=${g.homeGoalKicks} A=${g.awayGoalKicks}`);
  log(`  Shots Faced: H=${g.homeShotsFaced} A=${g.awayShotsFaced}`);
  log(`  High Claims: H=${g.homeTotalHighClaims} A=${g.awayTotalHighClaims}`);
  log(`  PKs Saved: H=${g.homePenaltyKicksSaved} A=${g.awayPenaltyKicksSaved}`);
  checkNotNull("homeGkSaves", g.homeGkSaves);
  checkNotNull("homeGoalKicks", g.homeGoalKicks);
}

// ─── EXPECTED GOALS ───────────────────────────────────────────────────────────
banner("Expected Goals (wc2026_espn_expected_goals)");
if (spotChecks.xg) {
  const x = spotChecks.xg;
  const playerArr = x.perPlayerJson ? JSON.parse(x.perPlayerJson) : [];
  log(`  xG: H=${x.homeXG} A=${x.awayXG}`);
  log(`  xGOT: H=${x.homeXGOT} A=${x.awayXGOT}`);
  log(`  Open Play xG: H=${x.homeXGOpenPlay} A=${x.awayXGOpenPlay}`);
  log(`  Set Play xG: H=${x.homeXGSetPlay} A=${x.awayXGSetPlay}`);
  log(`  xA: H=${x.homeXA} A=${x.awayXA}`);
  log(`  Per-player entries: ${playerArr.length}`);
  checkNotNull("homeXG", x.homeXG);
  checkNotNull("homeXGOT", x.homeXGOT);
  checkGt("perPlayer count", playerArr.length, 5);
}

// ─── SHOT MAP ─────────────────────────────────────────────────────────────────
banner("Shot Map (wc2026_espn_shot_map)");
if (spotChecks.shot) {
  const s = spotChecks.shot;
  log(`  Shot: type=${s.shotType} iconType=${s.iconType} situation=${s.situation}`);
  log(`  Field: start=(${s.fieldStartX},${s.fieldStartY}) end=(${s.fieldEndX},${s.fieldEndY})`);
  log(`  Goal: Y=${s.goalPositionY} Z=${s.goalPositionZ} zone=${s.goalZone}`);
  log(`  Player: ${s.playerName} #${s.playerJersey} | team=${s.teamAbbrev} away=${s.isAway}`);
  log(`  xG=${s.xG} xGOT=${s.xGOT} | period=${s.period} clock=${s.clock}`);
  checkNotNull("fieldStartX", s.fieldStartX);
  checkTruthy("playerName", s.playerName);
  checkTruthy("iconType", s.iconType);
  checkNotNull("xG", s.xG);
  checkNotNull("period", s.period);
}
log(`  Goals in shot map: ${spotChecks.shotGoals}`);
checkGt("shot map goal count", spotChecks.shotGoals, 0);

// ─── PLAYER STATS (OUTFIELD) ──────────────────────────────────────────────────
banner("Player Stats — Outfield (wc2026_espn_player_stats)");
if (spotChecks.player) {
  const p = spotChecks.player;
  log(`  Player: ${p.name} #${p.jersey} (${p.teamAbbrev}) | isHome=${p.isHome} | pos=${p.positionGroup}`);
  log(`  Goals=${p.g} Assists=${p.a} SoG=${p.sog} Shots=${p.shot} Touches=${p.tch}`);
  log(`  DuelsW=${p.duelw} BCC=${p.bcc} DINT=${p.dint} xG=${p.xG} xA=${p.xA}`);
  log(`  Appearances=${p.appearances} FC=${p.foulsCommitted} FS=${p.foulsSuffered}`);
  log(`  YC=${p.yellowCards} RC=${p.redCards} Offsides=${p.offsides}`);
  checkTruthy("player.name", p.name);
  checkTruthy("player.teamAbbrev", p.teamAbbrev);
  checkNotNull("player.tch (touches)", p.tch);
}

// ─── PLAYER STATS (GK) ───────────────────────────────────────────────────────
banner("Player Stats — Goalkeeper (wc2026_espn_player_stats)");
if (spotChecks.gkPlayer) {
  const g = spotChecks.gkPlayer;
  log(`  GK: ${g.name} #${g.jersey} (${g.teamAbbrev}) | isGK=${g.isGoalkeeper}`);
  log(`  GA=${g.ga} SV=${g.sv} SOGA=${g.soga} xGC=${g.xGC} xGOTC=${g.xGOTC}`);
  log(`  GP=${g.gp} BCS=${g.bcs} CLR=${g.clr} CC=${g.cc} KS=${g.ks} ShotsFaced=${g.shotsFaced}`);
  checkTruthy("gkPlayer.name", g.name);
  check("gkPlayer.isGoalkeeper", g.isGoalkeeper, 1);
  checkNotNull("gkPlayer.sv (saves)", g.sv);
}

// ─── LINEUPS ──────────────────────────────────────────────────────────────────
banner("Lineups (wc2026_espn_lineups)");
if (spotChecks.lineup) {
  const l = spotChecks.lineup;
  log(`  Sample: ${l.name} #${l.jersey} | role=${l.role} | slot=${l.formationPlace} | home=${l.isHome} | team=${l.teamAbbrev}`);
  checkTruthy("lineup.name", l.name);
  checkTruthy("lineup.jersey", l.jersey);
  checkTruthy("lineup.role", l.role);
}
log(`  Starters: ${spotChecks.starterCount} (expected 22)`);
log(`  Total lineup entries: ${spotChecks.lineupTotal}`);
check("starters count = 22", spotChecks.starterCount, 22);
checkGt("total lineup entries", spotChecks.lineupTotal, 22);

// ─── ODDS (table dropped in DB-013 — skipped) ──────────────────────────────
log(`  [SKIP] wc2026_espn_match_odds dropped in DB-013`);

// ─── FINAL SUMMARY ───────────────────────────────────────────────────────────
banner("LIVE INGEST TEST COMPLETE", C.magenta);
log(`  ${C.bold}gameId: ${GAME_ID}${C.reset}`);
log(`  ${C.bold}PASS: ${passed} | FAIL: ${failed} | TOTAL: ${passed + failed}${C.reset}`);
const pct = ((passed / (passed + failed)) * 100).toFixed(1);
const color = failed === 0 ? C.green : C.red;
log(`  ${color}${C.bold}PASS RATE: ${pct}%${C.reset}`);
log(`  Duration: ${(elapsed / 1000).toFixed(1)}s`);
if (failures.length > 0) {
  log(`\n  ${C.red}FAILURES:${C.reset}`);
  for (const f of failures) log(`    ${C.red}✗${C.reset} ${f}`);
}

// Save log
try {
  mkdirSync(join(projectRoot, ".scraper-logs"), { recursive: true });
  writeFileSync(LOG_FILE, logLines.join("\n") + "\n");
  log(`\n  Log saved to: ${LOG_FILE}`);
} catch {}

process.exit(failed > 0 ? 1 : 0);
