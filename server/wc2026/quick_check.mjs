import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const m = process.env.DATABASE_URL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = m;
const conn = await mysql.createConnection({user, password, host, port: parseInt(port), database, ssl:{rejectUnauthorized:false}});

const [fixtures] = await conn.execute(
  'SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id IN (?,?) ORDER BY match_id',
  ['wc26-g-002', 'wc26-g-008']
);
console.log('FIXTURES:');
for (const f of fixtures) {
  console.log(`  ${f.match_id}: home=${f.home_team_id} away=${f.away_team_id}`);
}

const [odds] = await conn.execute(`
  SELECT match_id, book_id, market, selection, american_odds
  FROM wc2026_odds_snapshots
  WHERE match_id IN ('wc26-g-002','wc26-g-008') AND book_id IN (0,68) AND market='1X2'
  ORDER BY match_id, book_id, selection
`);
console.log('\nODDS (1X2):');
let last = '';
for (const o of odds) {
  if (o.match_id !== last) { console.log(`  ${o.match_id}:`); last = o.match_id; }
  const bookLabel = o.book_id === 0 ? 'MODEL' : 'DK   ';
  const sign = o.american_odds > 0 ? '+' : '';
  console.log(`    [${bookLabel}] ${o.selection}: ${sign}${o.american_odds}`);
}

await conn.end();
