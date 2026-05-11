import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const db = await mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });

// First check column names
const [cols] = await db.execute('DESCRIBE games');
const colNames = cols.map(c => c.Field);
console.log('[SCHEMA] games columns:', colNames.filter(c => 
  c.includes('Time') || c.includes('time') || c.includes('Score') || 
  c.includes('score') || c.includes('Pitcher') || c.includes('pitcher') ||
  c.includes('moneyline') || c.includes('Moneyline') || c.includes('total') ||
  c.includes('Total') || c.includes('spread') || c.includes('Spread')
).join(', '));

const [rows] = await db.execute(`
  SELECT id, awayTeam, homeTeam, startTimeEst, awayStartingPitcher, homeStartingPitcher,
         modelAwayScore, modelHomeScore, modelTotal, awayModelSpread, homeModelSpread,
         awayBookSpread, homeBookSpread, bookTotal
  FROM games
  WHERE gameDate = '2026-05-11' AND sport = 'MLB'
  ORDER BY startTimeEst ASC
`);

console.log(`\nMay 11 MLB Games: ${rows.length}`);
rows.forEach(r => {
  console.log(`  [${r.id}] ${r.awayTeam} @ ${r.homeTeam} | ${r.startTimeEst}`);
  console.log(`    Pitchers: ${r.awayStartingPitcher || 'TBD'} vs ${r.homeStartingPitcher || 'TBD'}`);
  console.log(`    Model: ${r.modelAwayScore ?? 'NULL'}-${r.modelHomeScore ?? 'NULL'} | Total=${r.modelTotal ?? 'NULL'}`);
  console.log(`    Model Spread: away=${r.awayModelSpread ?? 'NULL'} home=${r.homeModelSpread ?? 'NULL'}`);
  console.log(`    Book: spread away=${r.awayBookSpread ?? 'NULL'} home=${r.homeBookSpread ?? 'NULL'} | Total=${r.bookTotal ?? 'NULL'}`);
});

await db.end();
