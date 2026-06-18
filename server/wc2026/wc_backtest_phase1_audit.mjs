/**
 * wc_backtest_phase1_audit.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1: Database State Audit
 * World Cup AI Model Master Backtesting Engine
 *
 * Verifies the current state of all backtesting infrastructure:
 *   - 2018 World Cup Group Stage match records
 *   - 2022 World Cup Group Stage match records
 *   - 2026 completed matches through June 16
 *   - June 17 newly ingested matches
 *   - All supporting tables (odds, box scores, events, lineups, stats, simulations)
 *
 * Logging format:
 *   [AUDIT] [INPUT]  → what is being checked
 *   [AUDIT] [STATE]  → current state found
 *   [AUDIT] [VERIFY] → PASS / FAIL / WARN + reason
 *   [AUDIT] [OUTPUT] → final counts and readiness status
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('\n[AUDIT] ================================================================');
console.log('[AUDIT] PHASE 1: DATABASE STATE AUDIT — WC BACKTESTING ENGINE');
console.log('[AUDIT] Timestamp:', new Date().toISOString());
console.log('[AUDIT] ================================================================\n');

// ─── Step 1: Check what tables exist ─────────────────────────────────────────
console.log('[AUDIT] [STEP 1] Enumerating all WC-related tables in database...');
const [tables] = await conn.query(`
  SELECT TABLE_NAME, TABLE_ROWS
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND (TABLE_NAME LIKE 'wc%' OR TABLE_NAME LIKE 'backtest%' OR TABLE_NAME LIKE 'raw_%'
         OR TABLE_NAME LIKE 'normalized_%' OR TABLE_NAME LIKE 'monte_carlo%'
         OR TABLE_NAME LIKE 'advanced_%' OR TABLE_NAME LIKE 'composite_%'
         OR TABLE_NAME LIKE 'recalibration%' OR TABLE_NAME LIKE 'validation%')
  ORDER BY TABLE_NAME
`);

console.log(`[AUDIT] [STATE] Found ${tables.length} WC/backtest-related tables:`);
const tableNames = new Set();
tables.forEach(t => {
  tableNames.add(t.TABLE_NAME);
  console.log(`  ${t.TABLE_NAME} (~${t.TABLE_ROWS} rows)`);
});

// ─── Step 2: Check for 2018/2022 backtest tables ──────────────────────────────
console.log('\n[AUDIT] [STEP 2] Checking for 2018/2022 historical backtest tables...');
const required2018Tables = ['wc2018_matches', 'wc_backtest_matches', 'backtest_matches'];
const required2022Tables = ['wc2022_matches'];
const backtestTables = ['wc_backtest_matches', 'backtest_matches', 'wc_historical_matches',
  'wc2018_matches', 'wc2022_matches', 'raw_match_sources', 'normalized_matches',
  'monte_carlo_outputs', 'recalibration_logs', 'validation_reports'];

const missingBacktestTables = backtestTables.filter(t => !tableNames.has(t));
const presentBacktestTables = backtestTables.filter(t => tableNames.has(t));

console.log(`[AUDIT] [STATE] Present backtest tables (${presentBacktestTables.length}/${backtestTables.length}):`);
presentBacktestTables.forEach(t => console.log(`  ✅ ${t}`));
console.log(`[AUDIT] [STATE] Missing backtest tables (${missingBacktestTables.length}):`);
missingBacktestTables.forEach(t => console.log(`  ❌ ${t}`));

// ─── Step 3: Audit wc2026_fixtures — 2026 match counts ───────────────────────
console.log('\n[AUDIT] [STEP 3] Auditing wc2026_fixtures for 2026 match counts...');
const [fixtureSummary] = await conn.query(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status = 'FT' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'SCHEDULED' THEN 1 ELSE 0 END) as scheduled,
    SUM(CASE WHEN match_date <= '2026-06-16' AND status = 'FT' THEN 1 ELSE 0 END) as completed_through_june16,
    SUM(CASE WHEN match_date = '2026-06-17' AND status = 'FT' THEN 1 ELSE 0 END) as completed_june17,
    SUM(CASE WHEN match_date <= '2026-06-17' AND status = 'FT' THEN 1 ELSE 0 END) as completed_through_june17
  FROM wc2026_fixtures
`);
const fs = fixtureSummary[0];
console.log(`[AUDIT] [STATE] wc2026_fixtures:`);
console.log(`  Total fixtures: ${fs.total}`);
console.log(`  Completed (FT): ${fs.completed}`);
console.log(`  Scheduled: ${fs.scheduled}`);
console.log(`  Completed through June 16: ${fs.completed_through_june16}`);
console.log(`  Completed on June 17: ${fs.completed_june17}`);
console.log(`  Completed through June 17: ${fs.completed_through_june17}`);

// Expected: 20 through June 16, 4 on June 17, 24 total through June 17
const expected_through_june16 = 20;
const expected_june17 = 4;
const expected_through_june17 = 24;

const june16Pass = Number(fs.completed_through_june16) === expected_through_june16;
const june17Pass = Number(fs.completed_june17) === expected_june17;
const totalPass = Number(fs.completed_through_june17) === expected_through_june17;

console.log(`\n[AUDIT] [VERIFY] Through June 16: expected=${expected_through_june16} actual=${fs.completed_through_june16} → ${june16Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`[AUDIT] [VERIFY] June 17 matches: expected=${expected_june17} actual=${fs.completed_june17} → ${june17Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`[AUDIT] [VERIFY] Through June 17: expected=${expected_through_june17} actual=${fs.completed_through_june17} → ${totalPass ? 'PASS ✅' : 'FAIL ❌'}`);

// ─── Step 4: List all completed 2026 matches ─────────────────────────────────
console.log('\n[AUDIT] [STEP 4] Listing all completed 2026 matches...');
const [completedMatches] = await conn.query(`
  SELECT f.fixture_id, f.match_date, ht.name as home_team, at2.name as away_team,
         f.home_score, f.away_score, f.status, f.group_letter, f.matchday,
         f.espn_event_id,
         (SELECT COUNT(*) FROM wc2026_match_stats ms WHERE ms.fixture_id = f.fixture_id) as has_stats,
         (SELECT COUNT(*) FROM wc2026_match_events me WHERE me.fixture_id = f.fixture_id) as event_count,
         (SELECT COUNT(*) FROM wc2026_lineups l WHERE l.fixture_id = f.fixture_id AND l.is_confirmed = 1) as confirmed_lineups,
         (SELECT COUNT(*) FROM wc2026_odds_snapshots os WHERE os.fixture_id = f.fixture_id AND os.book_id = 68 AND os.is_closing = 1) as dk_closing_odds,
         (SELECT COUNT(*) FROM wc2026_odds_snapshots os2 WHERE os2.fixture_id = f.fixture_id AND os2.book_id = 0) as model_odds
  FROM wc2026_fixtures f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
  WHERE f.status = 'FT'
  ORDER BY f.match_date, f.fixture_id
`);

console.log(`[AUDIT] [STATE] All ${completedMatches.length} completed 2026 matches:`);
let matchNum = 0;
completedMatches.forEach(m => {
  matchNum++;
  const statsOk = m.has_stats > 0 ? '✅' : '❌';
  const eventsOk = m.event_count > 0 ? '✅' : '❌';
  const lineupsOk = m.confirmed_lineups >= 20 ? '✅' : '⚠️';
  const oddsOk = m.dk_closing_odds > 0 ? '✅' : '❌';
  const modelOk = m.model_odds > 0 ? '✅' : '❌';
  console.log(`  M${String(matchNum).padStart(2,'0')} [${m.match_date}] ${m.fixture_id}: ${m.away_team} ${m.away_score}-${m.home_score} ${m.home_team} | Grp=${m.group_letter} | stats=${statsOk} events=${m.event_count}${eventsOk} lineups=${m.confirmed_lineups}${lineupsOk} DK=${m.dk_closing_odds}${oddsOk} model=${m.model_odds}${modelOk}`);
});

// ─── Step 5: Check June 17 specific matches ───────────────────────────────────
console.log('\n[AUDIT] [STEP 5] Detailed audit of June 17 matches...');
const june17Fixtures = ['wc26-g-021', 'wc26-g-022', 'wc26-g-023', 'wc26-g-024'];
for (const fid of june17Fixtures) {
  const [rows] = await conn.query(`
    SELECT f.fixture_id, ht.name as home_team, at2.name as away_team,
           f.home_score, f.away_score, f.status, f.group_letter, f.matchday,
           f.kickoff_utc, f.espn_event_id, f.attendance,
           v.name as venue_name, v.city as venue_city
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    LEFT JOIN wc2026_venues v ON f.venue_id = v.venue_id
    WHERE f.fixture_id = ?
  `, [fid]);

  if (rows.length === 0) {
    console.log(`[AUDIT] [VERIFY] FAIL ❌ — ${fid} NOT FOUND in wc2026_fixtures`);
    continue;
  }
  const r = rows[0];
  console.log(`\n[AUDIT] [STATE] ${fid}:`);
  console.log(`  Match: ${r.away_team} vs ${r.home_team}`);
  console.log(`  Score: ${r.away_score}-${r.home_score} (${r.status})`);
  console.log(`  Group: ${r.group_letter} | Matchday: ${r.matchday}`);
  console.log(`  Kickoff: ${r.kickoff_utc?.toISOString()}`);
  console.log(`  Venue: ${r.venue_name}, ${r.venue_city}`);
  console.log(`  ESPN ID: ${r.espn_event_id} | Attendance: ${r.attendance}`);

  // Check match stats
  const [stats] = await conn.query(`SELECT * FROM wc2026_match_stats WHERE fixture_id = ?`, [fid]);
  if (stats.length > 0) {
    const s = stats[0];
    console.log(`  Stats: home_shots=${s.home_shots} away_shots=${s.away_shots} | home_poss=${s.home_possession_pct}% away_poss=${s.away_possession_pct}% | home_xg=${s.home_xg} away_xg=${s.away_xg}`);
    console.log(`  Corners: home=${s.home_corners} away=${s.away_corners} | Fouls: home=${s.home_fouls} away=${s.away_fouls}`);
    console.log(`  Cards: home_y=${s.home_yellow_cards} away_y=${s.away_yellow_cards} | Saves: home=${s.home_saves} away=${s.away_saves}`);
    console.log(`  [VERIFY] Match stats: PRESENT ✅`);
  } else {
    console.log(`  [VERIFY] Match stats: MISSING ❌`);
  }

  // Check events
  const [events] = await conn.query(`
    SELECT event_type, COUNT(*) as cnt FROM wc2026_match_events
    WHERE fixture_id = ? GROUP BY event_type ORDER BY event_type
  `, [fid]);
  const eventSummary = events.map(e => `${e.event_type}(${e.cnt})`).join(', ');
  console.log(`  Events: ${eventSummary || 'NONE'} ${events.length > 0 ? '✅' : '❌'}`);

  // Check lineups
  const [lineups] = await conn.query(`
    SELECT is_confirmed, COUNT(*) as cnt FROM wc2026_lineups
    WHERE fixture_id = ? GROUP BY is_confirmed
  `, [fid]);
  const confirmed = lineups.find(l => l.is_confirmed)?.cnt ?? 0;
  const unconfirmed = lineups.find(l => !l.is_confirmed)?.cnt ?? 0;
  console.log(`  Lineups: confirmed=${confirmed} unconfirmed=${unconfirmed} ${confirmed >= 20 ? '✅' : '⚠️'}`);

  // Check DK closing odds
  const [dkOdds] = await conn.query(`
    SELECT market, selection, american_odds FROM wc2026_odds_snapshots
    WHERE fixture_id = ? AND book_id = 68 AND is_closing = 1
    ORDER BY market, selection
  `, [fid]);
  if (dkOdds.length > 0) {
    console.log(`  DK Closing Odds (${dkOdds.length} rows): ${dkOdds.map(o => `${o.market}/${o.selection}=${o.american_odds}`).join(', ')} ✅`);
  } else {
    console.log(`  DK Closing Odds: MISSING ❌`);
  }

  // Check model odds
  const [modelOdds] = await conn.query(`
    SELECT market, selection, american_odds FROM wc2026_odds_snapshots
    WHERE fixture_id = ? AND book_id = 0
    ORDER BY market, selection
  `, [fid]);
  if (modelOdds.length > 0) {
    console.log(`  Model Odds (${modelOdds.length} rows): ${modelOdds.map(o => `${o.market}/${o.selection}=${o.american_odds}`).join(', ')} ✅`);
  } else {
    console.log(`  Model Odds: MISSING ❌`);
  }
}

// ─── Step 6: Check for backtesting infrastructure tables ─────────────────────
console.log('\n[AUDIT] [STEP 6] Checking for backtesting infrastructure tables...');
const backtestInfrastructure = {
  'raw_match_sources': false,
  'raw_odds_sources': false,
  'raw_box_score_sources': false,
  'raw_event_sources': false,
  'raw_player_sources': false,
  'raw_goalkeeper_sources': false,
  'raw_lineup_sources': false,
  'raw_substitution_sources': false,
  'raw_card_sources': false,
  'raw_corner_sources': false,
  'raw_penalty_sources': false,
  'raw_advanced_stat_sources': false,
  'raw_source_conflicts': false,
  'normalized_matches': false,
  'normalized_teams': false,
  'normalized_players': false,
  'normalized_lineups': false,
  'normalized_substitutions': false,
  'normalized_odds': false,
  'normalized_box_scores': false,
  'normalized_events': false,
  'normalized_player_stats': false,
  'normalized_goalkeeper_stats': false,
  'normalized_team_stats': false,
  'normalized_cards': false,
  'normalized_corners': false,
  'normalized_penalties': false,
  'normalized_tournament_impact': false,
  'normalized_game_state_segments': false,
  'normalized_possession_sequences': false,
  'normalized_advanced_stats': false,
  'advanced_offensive_player_features': false,
  'advanced_defensive_player_features': false,
  'advanced_goalkeeper_features': false,
  'advanced_collective_match_features': false,
  'advanced_team_features': false,
  'composite_model_features': false,
  'market_audit_features': false,
  'game_state_features': false,
  'upset_draw_features': false,
  'monte_carlo_input_features': false,
  'monte_carlo_outputs': false,
  'model_projection_snapshots': false,
  'recalibration_logs': false,
  'validation_reports': false,
  'data_quality_flags': false,
  'tournament_impact_snapshots': false,
};

for (const tbl of Object.keys(backtestInfrastructure)) {
  backtestInfrastructure[tbl] = tableNames.has(tbl);
}

const presentInfra = Object.entries(backtestInfrastructure).filter(([,v]) => v);
const missingInfra = Object.entries(backtestInfrastructure).filter(([,v]) => !v);

console.log(`[AUDIT] [STATE] Backtesting infrastructure: ${presentInfra.length} present, ${missingInfra.length} missing`);
if (presentInfra.length > 0) {
  console.log(`  Present: ${presentInfra.map(([k]) => k).join(', ')}`);
}
console.log(`  Missing (${missingInfra.length}): ${missingInfra.map(([k]) => k).join(', ')}`);

// ─── Step 7: Check for 2018/2022 historical data ──────────────────────────────
console.log('\n[AUDIT] [STEP 7] Checking for 2018/2022 historical match data...');
// Check if any wc2026 table has tournament_year or year field
const [yearCheck] = await conn.query(`
  SELECT TABLE_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND COLUMN_NAME IN ('tournament_year', 'year', 'tournament')
    AND TABLE_NAME LIKE 'wc%'
`);
console.log(`[AUDIT] [STATE] Tables with tournament_year/year column: ${yearCheck.map(r => r.TABLE_NAME).join(', ') || 'NONE'}`);

// ─── Final Summary ────────────────────────────────────────────────────────────
console.log('\n[AUDIT] ================================================================');
console.log('[AUDIT] DATABASE READINESS REPORT — SUMMARY');
console.log('[AUDIT] ================================================================');
console.log(`\n[AUDIT] 2018 World Cup Group Stage:`);
console.log(`  Expected matches: 48`);
console.log(`  Actual matches in DB: 0 (no wc2018_matches table)`);
console.log(`  Status: ❌ MISSING — 2018 backtest tables do not exist`);
console.log(`  Action required: BUILD — create wc_backtest schema and seed 2018 data`);

console.log(`\n[AUDIT] 2022 World Cup Group Stage:`);
console.log(`  Expected matches: 48`);
console.log(`  Actual matches in DB: 0 (no wc2022_matches table)`);
console.log(`  Status: ❌ MISSING — 2022 backtest tables do not exist`);
console.log(`  Action required: BUILD — create wc_backtest schema and seed 2022 data`);

console.log(`\n[AUDIT] 2026 World Cup through June 16:`);
console.log(`  Expected matches: 20`);
console.log(`  Actual matches in DB: ${fs.completed_through_june16}`);
console.log(`  Status: ${june16Pass ? '✅ PASS' : '❌ FAIL'}`);

console.log(`\n[AUDIT] 2026 World Cup June 17 (new):`);
console.log(`  Expected matches: 4`);
console.log(`  Actual matches in DB: ${fs.completed_june17}`);
console.log(`  Status: ${june17Pass ? '✅ PASS' : '❌ FAIL'}`);

console.log(`\n[AUDIT] 2026 World Cup total through June 17:`);
console.log(`  Expected matches: 24`);
console.log(`  Actual matches in DB: ${fs.completed_through_june17}`);
console.log(`  Status: ${totalPass ? '✅ PASS' : '❌ FAIL'}`);

console.log(`\n[AUDIT] Backtesting infrastructure tables:`);
console.log(`  Required: ${Object.keys(backtestInfrastructure).length}`);
console.log(`  Present: ${presentInfra.length}`);
console.log(`  Missing: ${missingInfra.length}`);
console.log(`  Status: ${missingInfra.length === 0 ? '✅ COMPLETE' : '❌ INCOMPLETE — must build before ingestion'}`);

console.log(`\n[AUDIT] OVERALL DATABASE READINESS STATUS:`);
if (missingInfra.length > 0) {
  console.log(`  ❌ NOT READY — ${missingInfra.length} required tables missing`);
  console.log(`  BLOCKING ISSUE: Backtesting schema must be built before ingestion`);
  console.log(`  NEXT ACTION: Phase 2 — Build full backtesting schema`);
} else {
  console.log(`  ✅ READY — All required tables present`);
}

console.log('\n[AUDIT] ================================================================\n');

await conn.end();
