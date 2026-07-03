/**
 * 500X JULY 2 BACKTEST ASSESSMENT
 * ─────────────────────────────────────────────────────────────────────
 * Phase 1: Pull model projections vs actual results for Jul 2
 * Phase 2: Grade correct scores, spreads, totals
 * Phase 3: Compute Brier scores, calibration metrics
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);
const SEP = '═'.repeat(80);
const LINE = '─'.repeat(70);

console.log(SEP);
console.log('500X JULY 2 BACKTEST — MODEL vs ACTUAL ASSESSMENT');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(SEP);

// ═══ PHASE 1: Get Jul 2 model projections ═══
console.log('\n═══ [PHASE 1] PULL JULY 2 MODEL PROJECTIONS ═══\n');

// Get model projections for Jul 2 matches
const [projections] = await db.execute(`
  SELECT p.*, m.home_team_id, m.away_team_id, m.home_score AS actual_home, m.away_score AS actual_away, m.status
  FROM wc2026_model_projections p
  JOIN wc2026_matches m ON p.match_id = m.match_id
  WHERE m.match_date = '2026-07-02'
  ORDER BY p.match_id
`);

console.log(`[INPUT] Jul 2 model projections found: ${projections.length}`);
if (projections.length === 0) {
  // Try different date format
  const [proj2] = await db.execute(`
    SELECT p.*, m.home_team_id, m.away_team_id, m.home_score AS actual_home, m.away_score AS actual_away, m.status
    FROM wc2026_model_projections p
    JOIN wc2026_matches m ON p.match_id = m.match_id
    WHERE m.match_date LIKE '2026-07-02%'
    ORDER BY p.match_id
  `);
  console.log(`[RETRY] With LIKE: ${proj2.length} projections`);
  if (proj2.length > 0) projections.push(...proj2);
}

if (projections.length === 0) {
  // Check what dates have projections
  const [dates] = await db.execute(`
    SELECT DISTINCT DATE(m.match_date) as d, COUNT(*) as cnt
    FROM wc2026_model_projections p
    JOIN wc2026_matches m ON p.match_id = m.match_id
    GROUP BY DATE(m.match_date)
    ORDER BY d DESC
    LIMIT 10
  `);
  console.log('[INFO] Dates with model projections:');
  dates.forEach(r => console.log(`  ${r.d}: ${r.cnt} projections`));
  
  // Also check the projection table columns
  const [cols] = await db.execute('SHOW COLUMNS FROM wc2026_model_projections');
  console.log('\n[INFO] wc2026_model_projections columns:');
  console.log('  ' + cols.map(c => c.Field).join(', '));
  
  // Get the Jul 2 match IDs
  const [jul2Matches] = await db.execute("SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_date LIKE '2026-07-02%'");
  console.log('\n[INFO] Jul 2 match IDs:');
  jul2Matches.forEach(r => console.log(`  match_id=${r.match_id} ${r.home_team_id} vs ${r.away_team_id}`));
  
  // Check if projections exist for those match IDs
  if (jul2Matches.length > 0) {
    const ids = jul2Matches.map(r => r.match_id);
    const [projs] = await db.execute(`SELECT match_id, COUNT(*) as cnt FROM wc2026_model_projections WHERE match_id IN (${ids.join(',')}) GROUP BY match_id`);
    console.log('\n[INFO] Projections for Jul 2 match IDs:');
    projs.forEach(r => console.log(`  match_id=${r.match_id}: ${r.cnt} projections`));
  }
}

// Get actual results from ESPN tables for cross-validation
console.log('\n═══ [PHASE 1B] ACTUAL RESULTS FROM ESPN (Jul 2) ═══\n');
const [espnResults] = await db.execute(`
  SELECT matchId, homeTeamAbbrev, awayTeamAbbrev, homeScore, awayScore, 
         statusState, matchGameDate, matchKickoffEt
  FROM wc2026_espn_matches 
  WHERE matchGameDate = '2026-07-02'
  ORDER BY matchDateUtc
`);
console.log(`[INPUT] ESPN Jul 2 results: ${espnResults.length} matches`);
espnResults.forEach(r => {
  console.log(`  ${r.homeTeamAbbrev} ${r.homeScore}-${r.awayScore} ${r.awayTeamAbbrev} | status=${r.statusState} | kickoff=${r.matchKickoffEt}`);
});

// Get xG data for Jul 2 matches
const [xgData] = await db.execute(`
  SELECT x.matchId, x.homeTeamAbbrev, x.awayTeamAbbrev, x.homeXG, x.awayXG,
         x.homeXGOpenPlay, x.awayXGOpenPlay, x.homeXGSetPlay, x.awayXGSetPlay
  FROM wc2026_espn_expected_goals x
  JOIN wc2026_espn_matches m ON x.matchId = m.matchId
  WHERE m.matchGameDate = '2026-07-02'
`);
console.log(`\n[INPUT] xG data for Jul 2: ${xgData.length} matches`);
xgData.forEach(r => {
  console.log(`  ${r.homeTeamAbbrev} xG=${r.homeXG} vs ${r.awayTeamAbbrev} xG=${r.awayXG} | openPlay: ${r.homeXGOpenPlay}-${r.awayXGOpenPlay} | setPlay: ${r.homeXGSetPlay}-${r.awayXGSetPlay}`);
});

// Get match stats for Jul 2
const [matchStats] = await db.execute(`
  SELECT s.matchId, s.homeTeamAbbrev, s.awayTeamAbbrev, 
         s.homeShots, s.awayShots, s.homeShotsOnGoal, s.awayShotsOnGoal,
         s.homeXG, s.awayXG, s.homeCornersWon, s.awayCornersWon,
         s.homeBigChancesCreated, s.awayBigChancesCreated,
         s.homePassAccuracyPct, s.awayPassAccuracyPct
  FROM wc2026_espn_match_stats s
  JOIN wc2026_espn_matches m ON s.matchId = m.matchId
  WHERE m.matchGameDate = '2026-07-02'
`);
console.log(`\n[INPUT] Match stats for Jul 2: ${matchStats.length} matches`);
matchStats.forEach(r => {
  console.log(`  ${r.homeTeamAbbrev} vs ${r.awayTeamAbbrev}:`);
  console.log(`    Shots: ${r.homeShots}-${r.awayShots} | SOG: ${r.homeShotsOnGoal}-${r.awayShotsOnGoal}`);
  console.log(`    xG: ${r.homeXG}-${r.awayXG} | Corners: ${r.homeCornersWon}-${r.awayCornersWon}`);
  console.log(`    BigChances: ${r.homeBigChancesCreated}-${r.awayBigChancesCreated}`);
  console.log(`    PassAcc: ${r.homePassAccuracyPct}%-${r.awayPassAccuracyPct}%`);
});

// Get possession from team_stats
const [teamStats] = await db.execute(`
  SELECT t.matchId, t.homeTeamAbbrev, t.awayTeamAbbrev, t.possession, t.possessionAway
  FROM wc2026_espn_team_stats t
  JOIN wc2026_espn_matches m ON t.matchId = m.matchId
  WHERE m.matchGameDate = '2026-07-02'
`);
console.log(`\n[INPUT] Team stats (possession) for Jul 2: ${teamStats.length}`);
teamStats.forEach(r => console.log(`  ${r.homeTeamAbbrev} vs ${r.awayTeamAbbrev}: possession ${r.possession}%-${r.possessionAway}%`));

// Get odds data for Jul 2
const [oddsData] = await db.execute(`
  SELECT o.match_id, m.home_team_id, m.away_team_id,
         o.market, o.home_value, o.away_value, o.draw_value,
         o.home_prob, o.away_prob, o.draw_prob
  FROM wc2026_odds_snapshots o
  JOIN wc2026_matches m ON o.match_id = m.match_id
  WHERE m.match_date LIKE '2026-07-02%'
  ORDER BY o.match_id, o.market
`);
console.log(`\n[INPUT] Odds snapshots for Jul 2: ${oddsData.length} entries`);
const oddsByMatch = {};
oddsData.forEach(r => {
  const key = `${r.home_team_id} vs ${r.away_team_id}`;
  if (!oddsByMatch[key]) oddsByMatch[key] = [];
  oddsByMatch[key].push(r);
});
Object.entries(oddsByMatch).forEach(([key, odds]) => {
  console.log(`  ${key}:`);
  odds.forEach(o => console.log(`    ${o.market}: home=${o.home_value} away=${o.away_value} draw=${o.draw_value || 'N/A'}`));
});

// Get frozen book odds for Jul 2
const [frozenOdds] = await db.execute(`
  SELECT f.match_id, m.home_team_id, m.away_team_id,
         f.market, f.home_line, f.away_line, f.draw_line,
         f.home_prob, f.away_prob, f.draw_prob
  FROM wc2026_frozen_book_odds f
  JOIN wc2026_matches m ON f.match_id = m.match_id
  WHERE m.match_date LIKE '2026-07-02%'
  ORDER BY f.match_id, f.market
`);
console.log(`\n[INPUT] Frozen book odds for Jul 2: ${frozenOdds.length} entries`);
const frozenByMatch = {};
frozenOdds.forEach(r => {
  const key = `${r.home_team_id} vs ${r.away_team_id}`;
  if (!frozenByMatch[key]) frozenByMatch[key] = [];
  frozenByMatch[key].push(r);
});
Object.entries(frozenByMatch).forEach(([key, odds]) => {
  console.log(`  ${key}:`);
  odds.forEach(o => console.log(`    ${o.market}: home=${o.home_line} away=${o.away_line} draw=${o.draw_line || 'N/A'} | prob: ${o.home_prob}/${o.away_prob}/${o.draw_prob}`));
});

console.log('\n' + SEP);
console.log('PHASE 1 COMPLETE — DATA PULLED');
console.log(SEP);

await db.end();
process.exit(0);
