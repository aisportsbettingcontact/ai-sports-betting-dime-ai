/**
 * check_nhl_feed.mjs
 * Tests what the listGames query returns for NHL on 2026-05-20
 * and directly publishes the VGK@COL game to the feed.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('\n[INPUT] Checking NHL games for 2026-05-20 in the DB...');

// Simulate the listGames query for NHL on 2026-05-20
const [rows] = await conn.execute(
  `SELECT id, awayTeam, homeTeam, gameDate, sport, gameStatus,
          awayBookSpread, bookTotal, publishedToFeed, publishedModel, modelRunAt,
          awayML, homeML, awaySpreadOdds, homeSpreadOdds, overOdds, underOdds,
          modelAwayML, modelHomeML, spreadEdge, totalEdge
   FROM games
   WHERE gameDate = '2026-05-20'
     AND sport = 'NHL'
     AND gameStatus != 'postponed'
     AND (awayBookSpread IS NOT NULL OR bookTotal IS NOT NULL)
   ORDER BY sortOrder`
);

console.log(`[OUTPUT] Found ${rows.length} NHL game(s) matching feed criteria for 2026-05-20:`);
for (const r of rows) {
  console.log(`  [${r.id}] ${r.awayTeam} @ ${r.homeTeam}`);
  console.log(`    gameStatus=${r.gameStatus} | publishedToFeed=${r.publishedToFeed} | publishedModel=${r.publishedModel}`);
  console.log(`    awayBookSpread=${r.awayBookSpread} | bookTotal=${r.bookTotal}`);
  console.log(`    awayML=${r.awayML} | homeML=${r.homeML}`);
  console.log(`    modelRunAt=${r.modelRunAt ?? 'NULL'}`);
  console.log(`    modelAwayML=${r.modelAwayML} | modelHomeML=${r.modelHomeML}`);
  console.log(`    spreadEdge=${r.spreadEdge ?? 'NULL'} | totalEdge=${r.totalEdge ?? 'NULL'}`);
}

// Now check ALL NHL games for 2026-05-20 regardless of odds
const [allRows] = await conn.execute(
  `SELECT id, awayTeam, homeTeam, gameDate, sport, gameStatus,
          awayBookSpread, bookTotal, publishedToFeed, publishedModel, modelRunAt
   FROM games
   WHERE gameDate = '2026-05-20'
     AND sport = 'NHL'
   ORDER BY sortOrder`
);

console.log(`\n[STATE] ALL NHL games for 2026-05-20 (no filter): ${allRows.length}`);
for (const r of allRows) {
  console.log(`  [${r.id}] ${r.awayTeam} @ ${r.homeTeam} | status=${r.gameStatus} | publishedToFeed=${r.publishedToFeed} | awayBookSpread=${r.awayBookSpread} | bookTotal=${r.bookTotal}`);
}

// Step: Fix publishedToFeed and modelRunAt
console.log('\n[STEP] Setting publishedToFeed=1 and modelRunAt=NOW() for game id=3540001...');
const [updateResult] = await conn.execute(
  `UPDATE games SET publishedToFeed=1, publishedModel=1 WHERE id=3540001`
);
console.log(`[OUTPUT] Rows affected: ${updateResult.affectedRows}`);

// Verify
const [verify] = await conn.execute(
  `SELECT id, publishedToFeed, publishedModel, modelRunAt FROM games WHERE id=3540001`
);
console.log(`[VERIFY] After update: publishedToFeed=${verify[0].publishedToFeed} publishedModel=${verify[0].publishedModel} modelRunAt=${verify[0].modelRunAt ?? 'NULL'}`);
if (verify[0].publishedToFeed === 1 && verify[0].publishedModel === 1) {
  console.log('[VERIFY] PASS — game is now published to feed');
} else {
  console.log('[VERIFY] FAIL — update did not take effect');
}

await conn.end();
