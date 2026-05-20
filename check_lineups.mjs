import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Check mlb_lineups schema
  const [cols] = await conn.execute('DESCRIBE mlb_lineups');
  const colNames = cols.map(c => c.Field);
  console.log('[MLB_LINEUPS COLS]', colNames.join(', '));

  // Check what columns the query expects vs what exists
  const expected = ['gameId','awayPitcherName','homePitcherName','weatherTemp','weatherWind','weatherDome','weatherPrecip','awayLineup','homeLineup','awayLineupConfirmed','homeLineupConfirmed'];
  const missing = expected.filter(c => colNames.indexOf(c) === -1);
  const present = expected.filter(c => colNames.indexOf(c) !== -1);
  console.log('[PRESENT]', present.join(', '));
  console.log('[MISSING FROM LINEUPS]', missing.length > 0 ? missing.join(', ') : 'NONE — all columns present');

  // Count May 20 lineup rows
  const [cnt20] = await conn.execute('SELECT COUNT(*) as cnt FROM mlb_lineups WHERE gameId IN (2250689,2250690,2250691,2250692,2250693,2250694,2250695,2250696,2250697,2250698,2250699,2250700,2250701,2250702,2253008)');
  console.log('[MAY 20 LINEUP ROWS BY GAME_ID]', cnt20[0].cnt);

  // Show lineup rows for May 20
  const [lineups] = await conn.execute('SELECT gameId, awayPitcherName, homePitcherName, weatherTemp, weatherWind, weatherDome, awayLineupConfirmed, homeLineupConfirmed FROM mlb_lineups WHERE gameId IN (2250689,2250690,2250691,2250692,2250693,2250694,2250695,2250696,2250697,2250698,2250699,2250700,2250701,2250702,2253008)');
  console.log('[LINEUP ROWS]', lineups.length);
  for (const l of lineups) {
    console.log('  gameId=' + l.gameId + ' awayP=' + l.awayPitcherName + ' homeP=' + l.homePitcherName + ' temp=' + l.weatherTemp + ' wind=' + l.weatherWind + ' dome=' + l.weatherDome);
  }

  // Now try the exact failing query
  console.log('\n[TEST] Running the exact model query for 2026-05-20...');
  try {
    const [result] = await conn.execute(`
      SELECT g.id, g.awayTeam, g.homeTeam, g.awayML, g.homeML, g.bookTotal, g.awayRunLine,
             COALESCE(g.awayStartingPitcher, l.awayPitcherName) as awayStartingPitcher,
             COALESCE(g.homeStartingPitcher, l.homePitcherName) as homeStartingPitcher,
             l.weatherTemp, l.weatherWind, l.weatherDome
      FROM games g
      LEFT JOIN mlb_lineups l ON l.gameId = g.id
      WHERE g.gameDate = '2026-05-20' AND g.sport = 'MLB'
      ORDER BY g.id ASC
    `);
    console.log('[QUERY SUCCESS] rows=' + result.length);
    for (const r of result) {
      const modelable = r.bookTotal && r.awayML && r.homeML && r.awayRunLine && r.awayStartingPitcher && r.homeStartingPitcher;
      console.log('  [id=' + r.id + '] ' + r.awayTeam + '@' + r.homeTeam + ' modelable=' + (modelable ? 'YES' : 'NO') + ' awayP=' + r.awayStartingPitcher + ' homeP=' + r.homeStartingPitcher);
    }
  } catch (e) {
    console.error('[QUERY FAILED]', e.message);
    console.error('[SQL ERROR CODE]', e.code);
  }

  await conn.end();
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
