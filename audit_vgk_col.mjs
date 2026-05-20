/**
 * AUDIT: VGK@COL NHL Game — May 20, 2026
 * [INPUT] Target: games table, nhl_goalie_assignments, nhl_team_stats
 * [STEP] Pull full game record + all modelability gate conditions
 * [OUTPUT] Complete state dump with PASS/FAIL per condition
 */
import { createConnection } from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

console.log("=".repeat(80));
console.log("[AUDIT] VGK@COL NHL Game — May 20, 2026");
console.log("=".repeat(80));

// Step 1: Find the game record
console.log("\n[STEP 1] Locate VGK@COL game in games table");
const [games] = await db.query(`
  SELECT 
    id, sport, gameDate, awayTeam, homeTeam, gameTime,
    awayML, homeML, awaySpread, homeSpread, awaySpreadOdds, homeSpreadOdds,
    total, overOdds, underOdds,
    awayRunLine, homeRunLine,
    modelRunAt, publishedToFeed, publishedModel,
    modelAwayML, modelHomeML, modelTotal, modelOverRate,
    awayScore, homeScore, status,
    awayStartingPitcher, homeStartingPitcher,
    createdAt, updatedAt
  FROM games
  WHERE gameDate = '2026-05-20'
    AND sport = 'NHL'
  ORDER BY gameTime ASC
`);

if (!games.length) {
  console.log("[OUTPUT] ❌ NO NHL games found for May 20, 2026");
  await db.end();
  process.exit(1);
}

console.log(`[OUTPUT] Found ${games.length} NHL game(s) on 2026-05-20`);

for (const g of games) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[GAME] id=${g.id} | ${g.awayTeam} @ ${g.homeTeam} | ${g.gameTime}`);
  console.log(`[STATE] gameDate=${g.gameDate} status=${g.status}`);
  console.log(`[STATE] awayScore=${g.awayScore} homeScore=${g.homeScore}`);
  
  console.log("\n[LINES]");
  console.log(`  ML:     away=${g.awayML} home=${g.homeML} → ${g.awayML && g.homeML ? '✅' : '❌ MISSING'}`);
  console.log(`  Spread: away=${g.awaySpread}(${g.awaySpreadOdds}) home=${g.homeSpread}(${g.homeSpreadOdds}) → ${g.awaySpread && g.homeSpread ? '✅' : '❌ MISSING'}`);
  console.log(`  Total:  ${g.total} over=${g.overOdds} under=${g.underOdds} → ${g.total ? '✅' : '❌ MISSING'}`);
  console.log(`  PuckLine (awayRunLine): ${g.awayRunLine} → ${g.awayRunLine ? '✅' : '❌ MISSING (NHL RL GATE)'}`);
  
  console.log("\n[GOALIES]");
  console.log(`  awayStartingPitcher (goalie): ${g.awayStartingPitcher ?? 'NULL'} → ${g.awayStartingPitcher ? '✅' : '❌ MISSING'}`);
  console.log(`  homeStartingPitcher (goalie): ${g.homeStartingPitcher ?? 'NULL'} → ${g.homeStartingPitcher ? '✅' : '❌ MISSING'}`);
  
  console.log("\n[MODEL STATE]");
  console.log(`  modelRunAt:       ${g.modelRunAt ?? 'NULL (never run)'}`);
  console.log(`  publishedToFeed:  ${g.publishedToFeed}`);
  console.log(`  publishedModel:   ${g.publishedModel}`);
  console.log(`  modelAwayML:      ${g.modelAwayML ?? 'NULL'}`);
  console.log(`  modelHomeML:      ${g.modelHomeML ?? 'NULL'}`);
  console.log(`  modelTotal:       ${g.modelTotal ?? 'NULL'}`);
  console.log(`  modelOverRate:    ${g.modelOverRate ?? 'NULL'}`);
  
  // Modelability gate check
  const hasML = !!(g.awayML && g.homeML);
  const hasSpread = !!(g.awaySpread && g.homeSpread);
  const hasTotal = !!g.total;
  const hasPuckLine = !!g.awayRunLine;
  const hasAwayGoalie = !!g.awayStartingPitcher;
  const hasHomeGoalie = !!g.homeStartingPitcher;
  const alreadyModeled = !!g.modelRunAt;
  
  console.log("\n[MODELABILITY GATE]");
  console.log(`  hasML:          ${hasML ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  hasSpread:      ${hasSpread ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  hasTotal:       ${hasTotal ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  hasPuckLine:    ${hasPuckLine ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  hasAwayGoalie:  ${hasAwayGoalie ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  hasHomeGoalie:  ${hasHomeGoalie ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  alreadyModeled: ${alreadyModeled ? 'YES (modelRunAt set)' : 'NO (needs run)'}`);
  
  const allGatesPass = hasML && hasSpread && hasTotal && hasPuckLine && hasAwayGoalie && hasHomeGoalie;
  console.log(`\n[VERIFY] Modelable: ${allGatesPass ? '✅ YES — all gates pass' : '❌ NO — gates failing above'}`);
}

// Step 2: Check nhl_goalie_assignments table
console.log("\n\n[STEP 2] Check nhl_goalie_assignments for May 20");
try {
  const [goalieRows] = await db.query(`
    SELECT * FROM nhl_goalie_assignments
    WHERE gameDate = '2026-05-20'
    ORDER BY awayTeam ASC
  `);
  if (!goalieRows.length) {
    console.log("[OUTPUT] ❌ No rows in nhl_goalie_assignments for 2026-05-20");
  } else {
    console.log(`[OUTPUT] ${goalieRows.length} goalie assignment(s):`);
    for (const r of goalieRows) {
      console.log(`  ${r.awayTeam}@${r.homeTeam}: away=${r.awayGoalie ?? 'NULL'} home=${r.homeGoalie ?? 'NULL'} source=${r.source ?? 'N/A'} updatedAt=${r.updatedAt}`);
    }
  }
} catch (e) {
  console.log(`[OUTPUT] ⚠ nhl_goalie_assignments table error: ${e.message}`);
}

// Step 3: Check nhl_team_stats for VGK and COL
console.log("\n[STEP 3] Check nhl_team_stats for VGK and COL");
try {
  const [teamStats] = await db.query(`
    SELECT teamAbbr, gamesPlayed, goalsFor, goalsAgainst, 
           xGoalsFor, xGoalsAgainst, corsiFor, corsiAgainst,
           updatedAt
    FROM nhl_team_stats
    WHERE teamAbbr IN ('VGK', 'COL', 'VEG', 'Colorado', 'Vegas')
    ORDER BY teamAbbr
  `);
  if (!teamStats.length) {
    console.log("[OUTPUT] ❌ No nhl_team_stats rows for VGK/COL");
  } else {
    for (const t of teamStats) {
      console.log(`  [${t.teamAbbr}] GP=${t.gamesPlayed} GF=${t.goalsFor} GA=${t.goalsAgainst} xGF=${t.xGoalsFor} xGA=${t.xGoalsAgainst} updatedAt=${t.updatedAt}`);
    }
  }
} catch (e) {
  console.log(`[OUTPUT] ⚠ nhl_team_stats error: ${e.message}`);
}

// Step 4: Check nhl_goalie_stats for likely starters
console.log("\n[STEP 4] Check nhl_goalie_stats for VGK/COL goalies");
try {
  const [goalieStats] = await db.query(`
    SELECT goalieName, team, gamesStarted, savePercentage, goalsAgainstAverage,
           xGoalsAgainst, highDangerSavePercentage, updatedAt
    FROM nhl_goalie_stats
    WHERE team IN ('VGK', 'COL', 'VEG', 'Colorado', 'Vegas')
    ORDER BY gamesStarted DESC
    LIMIT 10
  `);
  if (!goalieStats.length) {
    console.log("[OUTPUT] ❌ No nhl_goalie_stats rows for VGK/COL");
  } else {
    for (const g of goalieStats) {
      console.log(`  [${g.team}] ${g.goalieName}: GS=${g.gamesStarted} SV%=${g.savePercentage} GAA=${g.goalsAgainstAverage} xGA=${g.xGoalsAgainst} updatedAt=${g.updatedAt}`);
    }
  }
} catch (e) {
  console.log(`[OUTPUT] ⚠ nhl_goalie_stats error: ${e.message}`);
}

console.log("\n" + "=".repeat(80));
console.log("[AUDIT COMPLETE]");
console.log("=".repeat(80));

await db.end();
