/**
 * updateJune21Scores.mjs
 * Updates the 4 June 21, 2026 WC2026 Group Stage matches with confirmed final scores.
 *
 * Confirmed results (user-provided):
 *   Spain 4-0 Saudi Arabia
 *   Belgium 0-0 Iran
 *   Uruguay 2-2 Cape Verde
 *   Egypt 3-1 New Zealand
 *
 * DB orientation (home_team_id vs away_team_id) must be verified before writing.
 * Status is set to 'FT' (Full Time) for all 4 matches.
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[UPDATE_JUNE21_SCORES]';

// Confirmed final scores from user
// Key: fixture_id → { home_score, away_score, note }
// We'll determine fixture_ids from the DB first, then map scores to correct home/away orientation
const CONFIRMED_RESULTS = [
  { team1: 'esp', team2: 'ksa', score1: 4, score2: 0, label: 'Spain 4-0 Saudi Arabia' },
  { team1: 'bel', team2: 'irn', score1: 0, score2: 0, label: 'Belgium 0-0 Iran' },
  { team1: 'uru', team2: 'cpv', score1: 2, score2: 2, label: 'Uruguay 2-2 Cape Verde' },
  { team1: 'egy', team2: 'nzl', score1: 3, score2: 1, label: 'Egypt 3-1 New Zealand' },
];

async function main() {
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} June 21, 2026 WC2026 Final Score Update`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(80)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Step 1: Fetch all June 21 fixtures with their team orientations
  const [fixtures] = await conn.execute(
    `SELECT fixture_id, home_team_id, away_team_id, kickoff_utc, status, home_score, away_score
     FROM wc2026_matches
     WHERE match_date = '2026-06-21'
     ORDER BY kickoff_utc`
  );

  console.log(`${TAG} [INPUT] June 21 fixtures in DB (${fixtures.length}):`);
  for (const f of fixtures) {
    const hs = f.home_score !== null ? f.home_score : 'NULL';
    const as_ = f.away_score !== null ? f.away_score : 'NULL';
    console.log(`${TAG}   ${f.fixture_id}: ${f.home_team_id} (H) vs ${f.away_team_id} (A) | status=${f.status} | score=${hs}-${as_}`);
  }

  if (fixtures.length !== 4) {
    console.error(`${TAG} [FAIL] Expected 4 June 21 fixtures, found ${fixtures.length}. Aborting.`);
    await conn.end();
    process.exit(1);
  }

  // Step 2: Match each confirmed result to the correct fixture by team IDs
  let updateCount = 0;
  const updates = [];

  for (const result of CONFIRMED_RESULTS) {
    const { team1, team2, score1, score2, label } = result;

    // Find fixture where (home=team1 AND away=team2) OR (home=team2 AND away=team1)
    const fx = fixtures.find(f =>
      (f.home_team_id === team1 && f.away_team_id === team2) ||
      (f.home_team_id === team2 && f.away_team_id === team1)
    );

    if (!fx) {
      console.error(`${TAG} [FAIL] No fixture found for ${label} (team1=${team1}, team2=${team2})`);
      await conn.end();
      process.exit(1);
    }

    // Determine correct home/away score based on DB orientation
    let homeScore, awayScore;
    if (fx.home_team_id === team1) {
      // team1 is home
      homeScore = score1;
      awayScore = score2;
      console.log(`${TAG} [STEP] ${label} → ${fx.fixture_id}: ${team1}(H)=${score1} ${team2}(A)=${score2} [orientation: team1=home]`);
    } else {
      // team2 is home (team1 is away)
      homeScore = score2;
      awayScore = score1;
      console.log(`${TAG} [STEP] ${label} → ${fx.fixture_id}: ${team2}(H)=${score2} ${team1}(A)=${score1} [orientation: team2=home]`);
    }

    updates.push({ fixture_id: fx.fixture_id, homeScore, awayScore, label });
  }

  // Step 3: Apply all updates
  console.log(`\n${TAG} [STEP] Applying ${updates.length} score updates...`);
  for (const u of updates) {
    const [res] = await conn.execute(
      `UPDATE wc2026_matches SET home_score = ?, away_score = ?, status = 'FT' WHERE fixture_id = ?`,
      [u.homeScore, u.awayScore, u.fixture_id]
    );
    if (res.affectedRows !== 1) {
      console.error(`${TAG} [FAIL] Update failed for ${u.fixture_id} (affectedRows=${res.affectedRows})`);
      await conn.end();
      process.exit(1);
    }
    console.log(`${TAG} [OUTPUT] ${u.fixture_id}: home_score=${u.homeScore} away_score=${u.awayScore} status=FT → affectedRows=${res.affectedRows} ✅`);
    updateCount++;
  }

  // Step 4: Verify final state
  console.log(`\n${TAG} [VERIFY] Re-reading June 21 fixtures from DB after update...`);
  const [verify] = await conn.execute(
    `SELECT fixture_id, home_team_id, away_team_id, kickoff_utc, status, home_score, away_score
     FROM wc2026_matches
     WHERE match_date = '2026-06-21'
     ORDER BY kickoff_utc`
  );

  let allPass = true;
  for (const f of verify) {
    const expected = updates.find(u => u.fixture_id === f.fixture_id);
    if (!expected) { console.error(`${TAG} [FAIL] Unexpected fixture in verify: ${f.fixture_id}`); allPass = false; continue; }
    const scoreOk = f.home_score === expected.homeScore && f.away_score === expected.awayScore;
    const statusOk = f.status === 'FT';
    const pass = scoreOk && statusOk;
    if (!pass) allPass = false;
    const icon = pass ? '✅' : '❌';
    console.log(`${TAG} ${icon} ${f.fixture_id}: ${f.home_team_id}(H) ${f.home_score}-${f.away_score} ${f.away_team_id}(A) | status=${f.status} | ${expected.label}`);
  }

  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} [VERIFY] Updates applied: ${updateCount}/4 | All pass: ${allPass ? '✅ YES' : '❌ NO'}`);

  await conn.end();

  if (!allPass) {
    console.error(`${TAG} [FATAL] Verification failed. Manual review required.`);
    process.exit(1);
  }
  console.log(`${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
