import mysql from 'mysql2/promise';
import 'dotenv/config';

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port || '3306'),
  user: url.username,
  password: url.password,
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

const dates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];

console.log('\n══════════════════════════════════════════════════════');
console.log('  WC2026 FEED VERIFICATION — All 12 New Matchs');
console.log('══════════════════════════════════════════════════════\n');

let totalFound = 0;

for (const date of dates) {
  const [rows] = await conn.execute(`
    SELECT f.match_id, f.stage, f.match_date,
           ht.name AS home_name, at.name AS away_name,
           b.book_home_ml, b.book_away_ml, b.book_draw_ml,
           b.book_total_line, b.book_spread_line,
           b.book_btts_yes_odds, b.to_advance_home_odds, b.to_advance_away_odds,
           b.frozen_at, b.frozen_by
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at ON f.away_team_id = at.team_id
    LEFT JOIN wc2026_frozen_book_odds b ON b.match_id = f.match_id
    WHERE f.match_date = ?
    ORDER BY f.kickoff_utc, f.match_id
  `, [date]);

  console.log(`📅 ${date} — ${rows.length} match(s)`);
  for (const r of rows) {
    const hasOdds = r.book_home_ml !== null;
    const oddsStatus = hasOdds ? '✅ ODDS SEEDED' : '❌ NO ODDS';
    console.log(`  [${r.match_id}] ${r.away_name} @ ${r.home_name} | Stage=${r.stage} | ${oddsStatus}`);
    if (hasOdds) {
      console.log(`    Home ML=${r.book_home_ml} | Away ML=${r.book_away_ml} | Draw=${r.book_draw_ml}`);
      console.log(`    Total=${r.book_total_line} | Spread=${r.book_spread_line} | BTTS Y=${r.book_btts_yes_odds}`);
      console.log(`    ToAdv Home=${r.to_advance_home_odds} | ToAdv Away=${r.to_advance_away_odds}`);
      console.log(`    Frozen by: ${r.frozen_by} at ${r.frozen_at}`);
    }
    totalFound++;
  }
  console.log();
}

// Verify all 12 target matchs specifically
const targetIds = [
  'wc26-r32-080','wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084',
  'wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088',
  'wc26-r16-089','wc26-r16-090','wc26-r16-091'
];

const [seedCheck] = await conn.execute(
  `SELECT match_id FROM wc2026_frozen_book_odds WHERE match_id IN (${targetIds.map(() => '?').join(',')})`,
  targetIds
);

const seededIds = new Set(seedCheck.map(r => r.match_id));
console.log('══════════════════════════════════════════════════════');
console.log(`  SEED VALIDATION: ${seededIds.size}/12 target matchs have book odds`);
for (const id of targetIds) {
  const status = seededIds.has(id) ? '✅' : '❌ MISSING';
  console.log(`  ${status} ${id}`);
}
console.log('══════════════════════════════════════════════════════\n');

await conn.end();
console.log('[DONE] Feed verification complete.');
