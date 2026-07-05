import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('═══════════════════════════════════════════════════════════════');
console.log('  FINAL VERIFICATION — JUL 5 R16 MATCHES');
console.log('═══════════════════════════════════════════════════════════════');

// 1. wc2026MatchOdds - full dump
const [odds] = await conn.query(`SELECT * FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);
for (const row of odds) {
  console.log(`\n─── ${row.match_id}: ${row.home_team} vs ${row.away_team} ───`);
  const nullCols = [];
  for (const [k, v] of Object.entries(row)) {
    if (v === null) nullCols.push(k);
  }
  console.log(`  NULL columns: ${nullCols.length === 0 ? 'NONE ✅' : nullCols.join(', ')}`);
  console.log(`  1X2 Book: H=${row.book_home_ml} D=${row.book_draw} A=${row.book_away_ml}`);
  console.log(`  1X2 Model: H=${row.model_home_ml} D=${row.model_draw} A=${row.model_away_ml}`);
  console.log(`  Advance Book: H=${row.book_home_to_advance} A=${row.book_away_to_advance}`);
  console.log(`  Advance Model: H=${row.model_home_to_advance} A=${row.model_away_to_advance}`);
  console.log(`  O/U Book: Over=${row.book_over_odds} Under=${row.book_under_odds}`);
  console.log(`  O/U Model: Over=${row.model_over_odds} Under=${row.model_under_odds}`);
  console.log(`  Spread: Line=${row.book_primary_spread} H=${row.book_home_primary_spread_odds} A=${row.book_away_primary_spread_odds}`);
  console.log(`  BTTS Book: Yes=${row.book_btts_yes} No=${row.book_btts_no}`);
  console.log(`  BTTS Model: Yes=${row.model_btts_yes} No=${row.model_btts_no}`);
  console.log(`  DC Book: HomeWD=${row.book_home_win_draw} AwayWD=${row.book_away_win_draw} NoDraw=${row.book_no_draw}`);
  console.log(`  DC Model: HomeWD=${row.model_home_win_draw} AwayWD=${row.model_away_win_draw} NoDraw=${row.model_no_draw}`);
  console.log(`  Lambda: H=${row.home_lambda} A=${row.away_lambda}`);
  console.log(`  ESPN: ${row.espn_match_id} | BetExplorer: ${row.bet_explorer_match_id}`);
  console.log(`  Version: ${row.model_version}`);
}

// 2. wc2026_model_projections
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  MODEL PROJECTIONS TABLE');
console.log('═══════════════════════════════════════════════════════════════');
const [projs] = await conn.query(`SELECT * FROM wc2026_model_projections WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);
for (const p of projs) {
  console.log(`\n  ${p.match_id}: ${p.home_team} vs ${p.away_team}`);
  console.log(`    Version: ${p.model_version}`);
  console.log(`    Lambda: H=${p.home_lambda} A=${p.away_lambda}`);
  console.log(`    Projected Score: ${p.proj_home_score} - ${p.proj_away_score}`);
  console.log(`    1X2 Prob: H=${p.home_win_prob} D=${p.draw_prob} A=${p.away_win_prob}`);
  console.log(`    Advance: H=${p.home_advance_prob} A=${p.away_advance_prob}`);
}

// 3. wc2026_matches
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  WC2026_MATCHES TABLE');
console.log('═══════════════════════════════════════════════════════════════');
const [matches] = await conn.query(`SELECT match_id, match_date, stage, home_team_id, away_team_id, venue_id, status, espn_match_id FROM wc2026_matches WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);
for (const m of matches) {
  console.log(`  ${m.match_id}: ${m.home_team_id} vs ${m.away_team_id} | date=${m.match_date} | stage=${m.stage} | ESPN=${m.espn_match_id}`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  ✅ VERIFICATION COMPLETE');
console.log('═══════════════════════════════════════════════════════════════');

await conn.end();
process.exit(0);
