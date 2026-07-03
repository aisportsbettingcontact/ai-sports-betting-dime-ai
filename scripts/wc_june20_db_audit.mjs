/**
 * WC2026 June 20 DB Audit Script
 * - Verifies all 4 June 20 matches are ingested with correct scores
 * - Runs 36-match gate check (2026 completed count must = 36)
 * - Verifies home/away orientations against ESPN ground truth
 * - Checks wc_bt_matches for June 20 entries
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const DB_URL = process.env.DATABASE_URL;

// ESPN Ground Truth for June 20 matches (verified directly from ESPN API)
// Format: { espn_match_id, espnHome, espnAway, espnHomeScore, espnAwayScore, result }
const JUNE20_GROUND_TRUTH = [
  {
    espn_match_id: 'wc26-g-035',
    espnHome: 'Netherlands',
    espnAway: 'Sweden',
    espnHomeScore: 5,
    espnAwayScore: 1,
    result: 'Netherlands 5-1 Sweden (NED home win)',
    group: 'D'
  },
  {
    espn_match_id: 'wc26-g-033',
    espnHome: 'Germany',
    espnAway: 'Ivory Coast',
    espnHomeScore: 2,
    espnAwayScore: 1,
    result: 'Germany 2-1 Ivory Coast (GER home win)',
    group: 'C'
  },
  {
    espn_match_id: 'wc26-g-034',
    espnHome: 'Ecuador',
    espnAway: 'Curaçao',
    espnHomeScore: 0,
    espnAwayScore: 0,
    result: 'Ecuador 0-0 Curaçao (Draw)',
    group: 'C'
  },
  {
    espn_match_id: 'wc26-g-036',
    espnHome: 'Tunisia',
    espnAway: 'Japan',
    espnHomeScore: 0,
    espnAwayScore: 4,
    result: 'Japan 4-0 Tunisia (JPN away win)',
    group: 'E'
  }
];

async function main() {
  console.log('[INPUT] WC2026 June 20 DB Audit starting...');
  console.log('[INPUT] DATABASE_URL:', DB_URL ? 'PRESENT' : 'MISSING');
  
  if (!DB_URL) {
    console.error('[VERIFY] FAIL — DATABASE_URL not set');
    process.exit(1);
  }

  const conn = await mysql.createConnection(DB_URL);
  
  // ─── STEP 1: Verify June 20 matches ─────────────────────────────────────────
  console.log('\n[STEP] === STEP 1: June 20 Match Verification ===');
  
  let allPass = true;
  
  for (const gt of JUNE20_GROUND_TRUTH) {
    const [rows] = await conn.execute(`
      SELECT f.match_id, ht.name as home_name, at2.name as away_name,
             f.home_score, f.away_score, f.status,
             DATE_FORMAT(f.kickoff_utc, '%Y-%m-%d %H:%i UTC') as kickoff
      FROM wc2026_matches f
      JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
      JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
      WHERE f.match_id = ?
    `, [gt.espn_match_id]);
    
    if (rows.length === 0) {
      console.error(`[VERIFY] FAIL — ${gt.espn_match_id} NOT FOUND in DB`);
      allPass = false;
      continue;
    }
    
    const row = rows[0];
    const homeScoreOk = row.home_score === gt.espnHomeScore;
    const awayScoreOk = row.away_score === gt.espnAwayScore;
    const statusOk = row.status === 'FT' || row.status === 'Full Time';
    
    const pass = homeScoreOk && awayScoreOk && statusOk;
    if (!pass) allPass = false;
    
    console.log(`[STATE] ${gt.espn_match_id}: DB home=${row.home_name} ${row.home_score}-${row.away_score} away=${row.away_name} status=${row.status}`);
    console.log(`[STATE]   ESPN GT: ${gt.espnHome} ${gt.espnHomeScore}-${gt.espnAwayScore} ${gt.espnAway}`);
    console.log(`[VERIFY] ${pass ? 'PASS' : 'FAIL'} — score=${homeScoreOk && awayScoreOk ? 'OK' : 'MISMATCH'} status=${statusOk ? 'OK' : 'NOT_FT'}`);
    console.log(`[OUTPUT] ${gt.result}`);
    console.log();
  }
  
  // ─── STEP 2: 36-match gate check ─────────────────────────────────────────────
  console.log('[STEP] === STEP 2: 2026 36-Match Gate Check ===');
  
  const [cntRows] = await conn.execute(`
    SELECT 
      COUNT(*) as total_2026,
      SUM(CASE WHEN status IN ('FT', 'Full Time') THEN 1 ELSE 0 END) as completed_2026,
      SUM(CASE WHEN status NOT IN ('FT', 'Full Time') THEN 1 ELSE 0 END) as upcoming_2026
    FROM wc2026_matches WHERE match_id LIKE 'wc26-%'
  `);
  
  const cnt = cntRows[0];
  console.log(`[STATE] Total 2026 matches in DB: ${cnt.total_2026}`);
  console.log(`[STATE] Completed (FT): ${cnt.completed_2026}`);
  console.log(`[STATE] Upcoming: ${cnt.upcoming_2026}`);
  
  const gatePass = parseInt(cnt.completed_2026) === 36;
  console.log(`[VERIFY] 36-match gate: ${gatePass ? 'PASS' : 'FAIL'} — completed=${cnt.completed_2026} (expected=36)`);
  
  if (!gatePass) {
    console.error(`[VERIFY] FAIL — 2026 completed count is ${cnt.completed_2026}, NOT 36. BLOCKING EXECUTION.`);
    allPass = false;
  }
  
  // ─── STEP 3: List all completed 2026 matches ─────────────────────────────────
  console.log('\n[STEP] === STEP 3: All Completed 2026 Matchs ===');
  
  const [allRows] = await conn.execute(`
    SELECT f.match_id, ht.name as home_name, at2.name as away_name,
           f.home_score, f.away_score, f.status,
           DATE_FORMAT(f.kickoff_utc, '%Y-%m-%d') as match_date
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_id LIKE 'wc26-%' AND f.status IN ('FT', 'Full Time')
    ORDER BY f.kickoff_utc
  `);
  
  console.log(`[STATE] Completed 2026 matches (${allRows.length} total):`);
  allRows.forEach((r, i) => {
    console.log(`  ${String(i+1).padStart(2,'0')}. ${r.match_id} ${r.match_date} ${r.home_name} ${r.home_score}-${r.away_score} ${r.away_name}`);
  });
  
  // ─── STEP 4: Check wc_bt_matches for June 20 entries ─────────────────────────
  console.log('\n[STEP] === STEP 4: wc_bt_matches June 20 Check ===');
  
  try {
    const [btRows] = await conn.execute(`
      SELECT match_id, home_team, away_team, home_score, away_score, match_date
      FROM wc_bt_matches
      WHERE match_date >= '2026-06-20' AND match_date <= '2026-06-21'
      ORDER BY match_date
    `);
    
    console.log(`[STATE] wc_bt_matches June 20-21 entries: ${btRows.length}`);
    btRows.forEach(r => {
      console.log(`  ${r.match_id}: ${r.home_team} ${r.home_score}-${r.away_score} ${r.away_team} (${r.match_date})`);
    });
    
    if (btRows.length < 4) {
      console.log(`[STATE] WARNING: Only ${btRows.length} June 20 entries in wc_bt_matches — need to add June 20 matches`);
    }
  } catch (err) {
    console.log(`[STATE] wc_bt_matches query error: ${err.message}`);
  }
  
  // ─── STEP 5: Check wc_bt_matches total count ─────────────────────────────────
  console.log('\n[STEP] === STEP 5: wc_bt_matches Universe Check ===');
  
  try {
    const [btCnt] = await conn.execute(`
      SELECT 
        SUM(CASE WHEN tournament_year = 2018 THEN 1 ELSE 0 END) as cnt_2018,
        SUM(CASE WHEN tournament_year = 2022 THEN 1 ELSE 0 END) as cnt_2022,
        SUM(CASE WHEN tournament_year = 2026 THEN 1 ELSE 0 END) as cnt_2026,
        COUNT(*) as total
      FROM wc_bt_matches
    `);
    
    const bt = btCnt[0];
    console.log(`[STATE] wc_bt_matches universe: 2018=${bt.cnt_2018} 2022=${bt.cnt_2022} 2026=${bt.cnt_2026} total=${bt.total}`);
    
    const universePass = parseInt(bt.cnt_2018) === 48 && parseInt(bt.cnt_2022) === 48;
    console.log(`[VERIFY] 2018 gate: ${parseInt(bt.cnt_2018) === 48 ? 'PASS' : 'FAIL'} (${bt.cnt_2018}/48)`);
    console.log(`[VERIFY] 2022 gate: ${parseInt(bt.cnt_2022) === 48 ? 'PASS' : 'FAIL'} (${bt.cnt_2022}/48)`);
    console.log(`[VERIFY] 2026 gate: ${parseInt(bt.cnt_2026) === 36 ? 'PASS' : `FAIL — need 36, have ${bt.cnt_2026}`}`);
  } catch (err) {
    console.log(`[STATE] wc_bt_matches universe query error: ${err.message}`);
  }
  
  await conn.end();
  
  console.log('\n[OUTPUT] === AUDIT SUMMARY ===');
  console.log(`[VERIFY] ${allPass ? 'PASS — All June 20 checks passed' : 'FAIL — One or more checks failed'}`);
  
  if (!gatePass) {
    console.error('[VERIFY] BLOCKING: 2026 completed count != 36. Cannot proceed to modeling.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[VERIFY] FAIL — Unhandled error:', err);
  process.exit(1);
});
