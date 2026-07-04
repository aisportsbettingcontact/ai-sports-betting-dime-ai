import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Jul 4 matches
const [jul4] = await conn.query(`
  SELECT m.match_id, m.home_team_id, m.away_team_id, m.home_score, m.away_score, 
         m.status, m.match_date, m.kickoff_utc, m.espn_match_id,
         t1.name as home_name, t1.fifa_code as home_code,
         t2.name as away_name, t2.fifa_code as away_code
  FROM wc2026_matches m
  LEFT JOIN wc2026_teams t1 ON m.home_team_id=t1.team_id
  LEFT JOIN wc2026_teams t2 ON m.away_team_id=t2.team_id
  WHERE m.match_id IN ('wc26-r16-089','wc26-r16-090')
  ORDER BY m.kickoff_utc
`);
console.log('═══ JULY 4 MATCHES ═══');
for (const m of jul4) {
  console.log(`  ${m.match_id}: ${m.home_name} (${m.home_code}) vs ${m.away_name} (${m.away_code})`);
  console.log(`    kickoff=${m.kickoff_utc} | match_date=${m.match_date} | espn=${m.espn_match_id} | status=${m.status}`);
}

// Jul 3 model projections
const [proj] = await conn.query(`
  SELECT match_id, model_version, home_team, away_team, home_lambda, away_lambda, 
         proj_home_score, proj_away_score, proj_total,
         model_home_ml, model_draw_ml, model_away_ml,
         to_advance_home_odds, to_advance_away_odds, to_advance_home_prob, to_advance_away_prob,
         over_odds, under_odds, btts_yes_odds, btts_no_odds, home_spread_odds, away_spread_odds,
         model_spread, home_win_prob, draw_prob, away_win_prob, over_2_5, btts_prob
  FROM wc2026_model_projections 
  WHERE match_id IN ('wc26-r32-086','wc26-r32-087','wc26-r32-088')
`);
console.log('\n═══ JULY 3 MODEL PROJECTIONS (stored in DB) ═══');
for (const p of proj) {
  console.log(`  ${p.match_id}: ${p.home_team} vs ${p.away_team} | v=${p.model_version}`);
  console.log(`    λH=${p.home_lambda} λA=${p.away_lambda} | Proj: ${p.proj_home_score}-${p.proj_away_score} (T=${p.proj_total})`);
  console.log(`    ML: H=${p.model_home_ml} D=${p.model_draw_ml} A=${p.model_away_ml}`);
  console.log(`    Advance: H=${p.to_advance_home_odds}(${p.to_advance_home_prob}) A=${p.to_advance_away_odds}(${p.to_advance_away_prob})`);
  console.log(`    Total: O=${p.over_odds} U=${p.under_odds} | BTTS: Y=${p.btts_yes_odds} N=${p.btts_no_odds}`);
  console.log(`    Probs: H=${p.home_win_prob} D=${p.draw_prob} A=${p.away_win_prob} | O2.5=${p.over_2_5} BTTS=${p.btts_prob}`);
}

// Check wc2026MatchOdds for Jul 4 book odds
const [odds] = await conn.query(`
  SELECT match_id, book_home_ml, book_draw, book_away_ml, book_home_spread, book_away_spread,
         book_home_spread_odds, book_away_spread_odds, book_total, book_over_odds, book_under_odds,
         book_btts_yes, book_btts_no, book_home_to_advance, book_away_to_advance
  FROM wc2026MatchOdds 
  WHERE match_id IN ('wc26-r16-089','wc26-r16-090')
`);
console.log('\n═══ JULY 4 BOOK ODDS (wc2026MatchOdds) ═══');
for (const o of odds) {
  console.log(`  ${o.match_id}:`);
  console.log(`    ML: H=${o.book_home_ml} D=${o.book_draw} A=${o.book_away_ml}`);
  console.log(`    Spread: H=${o.book_home_spread}(${o.book_home_spread_odds}) A=${o.book_away_spread}(${o.book_away_spread_odds})`);
  console.log(`    Total: ${o.book_total} O=${o.book_over_odds} U=${o.book_under_odds}`);
  console.log(`    BTTS: Y=${o.book_btts_yes} N=${o.book_btts_no}`);
  console.log(`    Advance: H=${o.book_home_to_advance} A=${o.book_away_to_advance}`);
}

// Check frozen book odds for Jul 4
const [frozen] = await conn.query(`
  SELECT match_id, book_home_ml, book_draw_ml, book_away_ml, book_spread_line, 
         book_home_spread_odds, book_away_spread_odds, book_total_line, book_over_odds, book_under_odds,
         book_btts_yes, book_btts_no, book_home_to_advance, book_away_to_advance
  FROM wc2026_frozen_book_odds 
  WHERE match_id IN ('wc26-r16-089','wc26-r16-090')
`);
console.log('\n═══ JULY 4 FROZEN BOOK ODDS ═══');
for (const f of frozen) {
  console.log(`  ${f.match_id}:`);
  console.log(`    ML: H=${f.book_home_ml} D=${f.book_draw_ml} A=${f.book_away_ml}`);
  console.log(`    Spread: ${f.book_spread_line} H=${f.book_home_spread_odds} A=${f.book_away_spread_odds}`);
  console.log(`    Total: ${f.book_total_line} O=${f.book_over_odds} U=${f.book_under_odds}`);
  console.log(`    BTTS: Y=${f.book_btts_yes} N=${f.book_btts_no}`);
  console.log(`    Advance: H=${f.book_home_to_advance} A=${f.book_away_to_advance}`);
}

// Check ESPN data availability for teams in Jul 4 matches
const [espnData] = await conn.query(`
  SELECT espn_match_id, homeTeam, awayTeam, status, homeScore, awayScore
  FROM wc2026_espn_matches 
  WHERE homeTeam IN ('Canada','Morocco','Paraguay','France') 
     OR awayTeam IN ('Canada','Morocco','Paraguay','France')
  ORDER BY espn_match_id
`);
console.log('\n═══ ESPN DATA FOR JUL 4 TEAMS (historical matches) ═══');
for (const e of espnData) {
  console.log(`  ${e.espn_match_id}: ${e.homeTeam} vs ${e.awayTeam} | ${e.homeScore}-${e.awayScore} | ${e.status}`);
}

await conn.end();
process.exit(0);
