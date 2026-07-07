import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

const drizzleTables = [
  'wc2026_espn_matches', 'wc2026_espn_team_stats', 'wc2026_espn_match_stats',
  'wc2026_espn_expected_goals', 'wc2026_espn_shot_map', 'wc2026_espn_player_stats',
  'wc2026_espn_lineups', 'wc2026_espn_glossary', 'wc2026MatchOdds',
  'wc2026_teams', 'wc2026_team_aliases', 'wc2026_venues', 'wc2026_matches',
  'wc2026_odds_snapshots', 'wc2026_lineups', 'wc2026_match_stats',
  'wc2026_match_events', 'wc2026_model_projections', 'wc2026_frozen_book_odds',
  'wc2026_espn_bracket'
];

const liveTables = [
  'wc2026MatchOdds', 'wc2026_data_lineage', 'wc2026_edges_bak_t3r',
  'wc2026_espn_bracket', 'wc2026_espn_expected_goals', 'wc2026_espn_glossary',
  'wc2026_espn_lineups', 'wc2026_espn_match_stats', 'wc2026_espn_matches',
  'wc2026_espn_player_stats', 'wc2026_espn_shot_map', 'wc2026_espn_team_stats',
  'wc2026_frozen_book_odds', 'wc2026_holdout_validation', 'wc2026_lineups',
  'wc2026_market_edges', 'wc2026_market_no_vig', 'wc2026_match_events',
  'wc2026_match_stats', 'wc2026_matches', 'wc2026_model_grades',
  'wc2026_model_projections', 'wc2026_model_runs', 'wc2026_mp_bak',
  'wc2026_mp_dedup_archive', 'wc2026_novig_bak_t3r', 'wc2026_odds_bak_t2',
  'wc2026_odds_bak_tier2', 'wc2026_odds_snapshots',
  'wc2026_orphan_match_odds_quarantine', 'wc2026_proj_bak_t3r',
  'wc2026_proj_bak_tier2', 'wc2026_provider_match_map', 'wc2026_rec_bak_t3r',
  'wc2026_recommendations', 'wc2026_team_aliases', 'wc2026_teams', 'wc2026_venues'
];

const orphans = liveTables.filter(t => !drizzleTables.includes(t));
console.log('ORPHAN TABLES (in live DB, NOT in Drizzle schema) — ' + orphans.length + ':');
orphans.forEach(t => console.log('  ' + t));

console.log('');
console.log('IN DRIZZLE BUT NOT IN LIVE DB:');
const missing = drizzleTables.filter(t => !liveTables.includes(t));
missing.forEach(t => console.log('  ' + t));

// Now get SHOW CREATE TABLE for key drifted tables
// DB-007 focus: wc2026_matches, wc2026_model_projections (known drift from drizzle-kit generate output)
console.log('\n=== DB-007: SHOW CREATE TABLE for key tables ===\n');

const driftCandidates = ['wc2026_matches', 'wc2026_model_projections', 'wc2026MatchOdds'];
for (const table of driftCandidates) {
  const [create] = await conn.execute('SHOW CREATE TABLE `' + table + '`');
  console.log('--- ' + table + ' ---');
  console.log(create[0]['Create Table']);
  console.log('');
}

await conn.end();
process.exit(0);
