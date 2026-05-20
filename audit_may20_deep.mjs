import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('═══════════════════════════════════════════════════════════════════');
console.log('[INPUT] Deep audit: May 20, 2026 MLB games — publish + model state');
console.log('═══════════════════════════════════════════════════════════════════\n');

// STEP 1: Full mlb_games state for May 20
const [games] = await conn.execute(`
  SELECT id, gameDate, awayTeam, homeTeam, awayAbbrev, homeAbbrev,
         startTimeUtc, gameStatus, isPublished, 
         awaySpread, awaySpreadOdds, homeSpreadOdds,
         total, overOdds, underOdds,
         awayML, homeML,
         modelAwaySpread, modelAwaySpreadOdds, modelHomeSpreadOdds,
         modelTotal, modelOverOdds, modelUnderOdds,
         modelAwayML, modelHomeML,
         awayScore, homeScore
  FROM mlb_games
  WHERE gameDate = '2026-05-20'
  ORDER BY startTimeUtc ASC
`);

console.log(`[STEP 1] mlb_games for May 20: ${games.length} rows`);
console.log(`[STATE] isPublished breakdown:`);
const pubCount = games.filter(g => g.isPublished).length;
const unpubCount = games.filter(g => !g.isPublished).length;
console.log(`  Published: ${pubCount}`);
console.log(`  Unpublished: ${unpubCount}`);

console.log(`\n[STATE] Full game list:`);
for (const g of games) {
  const hasBookOdds = g.awaySpread !== null && g.total !== null && g.awayML !== null;
  const hasModelOdds = g.modelAwaySpread !== null && g.modelTotal !== null && g.modelAwayML !== null;
  console.log(`  [GAME id=${g.id}] ${g.awayAbbrev||g.awayTeam} @ ${g.homeAbbrev||g.homeTeam} | date=${g.gameDate} | published=${g.isPublished} | bookOdds=${hasBookOdds} | modelOdds=${hasModelOdds} | status=${g.gameStatus}`);
  if (!hasBookOdds) {
    console.log(`    [MISSING BOOK] spread=${g.awaySpread} total=${g.total} awayML=${g.awayML}`);
  }
  if (!hasModelOdds) {
    console.log(`    [MISSING MODEL] modelSpread=${g.modelAwaySpread} modelTotal=${g.modelTotal} modelAwayML=${g.modelAwayML}`);
  }
}

// STEP 2: Check mlb_game_projections for May 20
const gameIds = games.map(g => g.id);
if (gameIds.length > 0) {
  const [projections] = await conn.execute(`
    SELECT gameId, awayScore, homeScore, awayWinProb, homeWinProb, 
           modelSpread, modelTotal, modelAwayML, modelHomeML,
           isPublished, createdAt
    FROM mlb_game_projections
    WHERE gameId IN (${gameIds.join(',')})
    ORDER BY gameId ASC
  `);
  console.log(`\n[STEP 2] mlb_game_projections for May 20 gameIds: ${projections.length} rows`);
  const projPub = projections.filter(p => p.isPublished).length;
  const projUnpub = projections.filter(p => !p.isPublished).length;
  console.log(`  Published projections: ${projPub}`);
  console.log(`  Unpublished projections: ${projUnpub}`);
  
  for (const p of projections) {
    const g = games.find(g => g.id === p.gameId);
    const label = g ? `${g.awayAbbrev||g.awayTeam}@${g.homeAbbrev||g.homeTeam}` : `gameId=${p.gameId}`;
    console.log(`  [PROJ gameId=${p.gameId}] ${label} | awayScore=${p.awayScore} homeScore=${p.homeScore} | spread=${p.modelSpread} total=${p.modelTotal} | awayML=${p.modelAwayML} homeML=${p.modelHomeML} | published=${p.isPublished}`);
  }
  
  // Find games WITHOUT projections
  const projectedGameIds = new Set(projections.map(p => p.gameId));
  const unprojectGames = games.filter(g => !projectedGameIds.has(g.id));
  if (unprojectGames.length > 0) {
    console.log(`\n  [MISSING PROJECTIONS] ${unprojectGames.length} games have NO projection row:`);
    for (const g of unprojectGames) {
      console.log(`    gameId=${g.id} ${g.awayAbbrev||g.awayTeam}@${g.homeAbbrev||g.homeTeam}`);
    }
  }
}

// STEP 3: Check scheduled tasks / heartbeat jobs for MLB modeling
const [schedules] = await conn.execute(`SHOW TABLES`).catch(() => [[]]);;
const allTables = schedules.map ? schedules.map(t => Object.values(t)[0]) : [];
const heartbeatTables = allTables.filter(t => /heartbeat|schedule|cron|job|task/i.test(t));
console.log(`\n[STEP 3] Heartbeat/schedule tables: ${heartbeatTables.join(', ') || 'NONE'}`);

for (const tbl of heartbeatTables) {
  const [rows] = await conn.execute(`SELECT * FROM \`${tbl}\` LIMIT 20`);
  console.log(`  [TABLE ${tbl}] ${rows.length} rows:`);
  for (const r of rows) console.log(`    `, JSON.stringify(r).substring(0, 250));
}

await conn.end();
console.log('\n[VERIFY] PASS — deep audit complete');
