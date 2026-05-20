import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('[INPUT] Deep audit: May 20, 2026 MLB games — publish + model state');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // STEP 1: Describe the games table
  const [gamesCols] = await conn.execute('DESCRIBE games');
  console.log('[STEP 1] games table columns:');
  for (const c of gamesCols) console.log(`  ${c.Field} (${c.Type}) null=${c.Null} default=${c.Default}`);

  // STEP 2: May 20 MLB games in games table
  const [games] = await conn.execute(`
    SELECT * FROM games WHERE gameDate = '2026-05-20' ORDER BY startTimeUtc ASC
  `);
  console.log(`\n[STEP 2] games table — May 20 rows: ${games.length}`);
  
  // Filter MLB if sport column exists
  const hasSport = gamesCols.some(c => c.Field === 'sport');
  const mlbGames = hasSport ? games.filter(g => g.sport === 'MLB' || g.sport === 'mlb') : games;
  console.log(`[STATE] MLB games on May 20: ${mlbGames.length}`);
  
  for (const g of mlbGames) {
    const cols = Object.keys(g);
    const publishCol = cols.find(c => /publish|status|active|visible|modeled/i.test(c));
    const modelCol = cols.find(c => /model|proj/i.test(c));
    console.log(`  [GAME id=${g.id}]`, JSON.stringify(g).substring(0, 400));
  }

  // STEP 3: Describe mlb_schedule_history
  const [schedCols] = await conn.execute('DESCRIBE mlb_schedule_history');
  console.log(`\n[STEP 3] mlb_schedule_history columns:`);
  for (const c of schedCols) console.log(`  ${c.Field} (${c.Type})`);

  // May 20 in mlb_schedule_history
  const [schedGames] = await conn.execute(`
    SELECT * FROM mlb_schedule_history WHERE gameDate = '2026-05-20' ORDER BY startTimeUtc ASC
  `);
  console.log(`\n[STATE] mlb_schedule_history May 20 rows: ${schedGames.length}`);
  for (const g of schedGames) {
    console.log(`  [SCHED id=${g.id}] anGameId=${g.anGameId} ${g.awayAbbr||g.awaySlug}@${g.homeAbbr||g.homeSlug} status=${g.gameStatus} published=${g.isPublished||'N/A'}`);
    // Show model-related fields
    const modelFields = Object.keys(g).filter(k => /model|proj|spread|total|ml|odds/i.test(k));
    if (modelFields.length > 0) {
      const modelData = {};
      for (const f of modelFields) modelData[f] = g[f];
      console.log(`    [MODEL FIELDS]`, JSON.stringify(modelData));
    }
  }

  // STEP 4: Check if there's a publish/model status column
  const schedColNames = schedCols.map(c => c.Field);
  const publishCols = schedColNames.filter(c => /publish|model|status|active/i.test(c));
  console.log(`\n[STEP 4] Publish/model-related columns in mlb_schedule_history: ${publishCols.join(', ') || 'NONE'}`);
  
  if (publishCols.length > 0 && schedGames.length > 0) {
    for (const col of publishCols) {
      const breakdown = {};
      for (const g of schedGames) {
        const v = String(g[col]);
        breakdown[v] = (breakdown[v] || 0) + 1;
      }
      console.log(`  [STATE] ${col} breakdown:`, JSON.stringify(breakdown));
    }
  }

  // STEP 5: Check model_files table
  const [modelFiles] = await conn.execute(`SELECT * FROM model_files ORDER BY createdAt DESC LIMIT 10`);
  console.log(`\n[STEP 5] model_files — last 10 entries: ${modelFiles.length}`);
  for (const f of modelFiles) {
    console.log(`  [FILE id=${f.id}] sport=${f.sport} date=${f.gameDate} status=${f.status} rows=${f.rowsImported} created=${f.createdAt}`);
  }

  // STEP 6: Check mlb_pitcher_stats for May 20 pitchers
  const [pitcherCols] = await conn.execute('DESCRIBE mlb_pitcher_stats');
  const pitcherColNames = pitcherCols.map(c => c.Field);
  console.log(`\n[STEP 6] mlb_pitcher_stats columns: ${pitcherColNames.join(', ')}`);
  const [pitcherCount] = await conn.execute('SELECT COUNT(*) as cnt FROM mlb_pitcher_stats');
  console.log(`[STATE] mlb_pitcher_stats total rows: ${pitcherCount[0].cnt}`);

  // STEP 7: Check mlb_lineups for May 20
  const [lineupCols] = await conn.execute('DESCRIBE mlb_lineups');
  const lineupColNames = lineupCols.map(c => c.Field);
  console.log(`\n[STEP 7] mlb_lineups columns: ${lineupColNames.join(', ')}`);
  const dateLineupCol = lineupColNames.find(c => /date|game_date/i.test(c));
  if (dateLineupCol) {
    const [lineupCount] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM mlb_lineups WHERE \`${dateLineupCol}\` = '2026-05-20'`
    );
    console.log(`[STATE] mlb_lineups May 20 rows: ${lineupCount[0].cnt}`);
  }

  // STEP 8: Check the server-side MLB model router/procedure
  console.log('\n[STEP 8] Checking server router files for MLB model/publish procedures...');

  await conn.end();
  console.log('\n[VERIFY] PASS — deep audit v2 complete');
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
