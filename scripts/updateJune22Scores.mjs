/**
 * updateJune22Scores.mjs
 * Updates June 22, 2026 WC2026 final scores in wc2026_fixtures.
 * Validates DB home/away orientation before writing any score.
 *
 * Confirmed results (user-provided):
 *   Argentina beat Austria 2-0
 *   France beat Iraq 3-0
 *   Norway beat Senegal 3-2
 *   Algeria beat Jordan 2-1
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

console.log('══════════════════════════════════════════════════════════════════════');
console.log('[STEP] updateJune22Scores.mjs — START');
console.log('[INPUT] 4 matches to update: ARG/AUT, FRA/IRQ, NOR/SEN, ALG/JOR');
console.log('══════════════════════════════════════════════════════════════════════');

// ─── Step 1: Fetch June 22 fixtures with team orientations ───────────────────
console.log('\n[STEP 1] Fetching June 22 fixture orientations from DB...');

const [rows] = await db.execute(`
  SELECT
    f.fixture_id,
    f.kickoff_utc,
    f.home_team_id,
    f.away_team_id,
    f.home_score,
    f.away_score,
    f.status,
    ht.name AS home_name,
    at.name AS away_name
  FROM wc2026_fixtures f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE DATE(f.kickoff_utc) = '2026-06-22'
  ORDER BY f.kickoff_utc ASC
`);

console.log(`[STATE] Found ${rows.length} June 22 fixtures in DB:`);
for (const r of rows) {
  console.log(`  [FIXTURE] ${r.fixture_id} | ${r.home_name} (H) vs ${r.away_name} (A) | kickoff=${r.kickoff_utc} | current: ${r.home_score}-${r.away_score} status=${r.status}`);
}

if (rows.length !== 4) {
  console.error(`[ERROR] Expected 4 June 22 fixtures, found ${rows.length}. Aborting.`);
  await db.end();
  process.exit(1);
}

// ─── Step 2: Define expected results (user-provided) ─────────────────────────
// User said: Argentina beat Austria 2-0, France beat Iraq 3-0,
//            Norway beat Senegal 3-2, Algeria beat Jordan 2-1
// DB orientation must be verified before assigning home_score/away_score.

const RESULTS = [
  {
    fixture_id: null, // will be matched by team names
    homeTeamExpected: 'Austria',
    awayTeamExpected: 'Argentina',
    // Argentina beat Austria 2-0 → Argentina scored 2, Austria scored 0
    // DB home=Austria → home_score=0, away_score=2
    home_score: 0,
    away_score: 2,
    result: 'A', // away win
    description: 'Argentina 2-0 Austria (DB: Austria H=0, Argentina A=2)',
  },
  {
    fixture_id: null,
    homeTeamExpected: 'Iraq',
    awayTeamExpected: 'France',
    // France beat Iraq 3-0 → France scored 3, Iraq scored 0
    // DB home=Iraq → home_score=0, away_score=3
    home_score: 0,
    away_score: 3,
    result: 'A',
    description: 'France 3-0 Iraq (DB: Iraq H=0, France A=3)',
  },
  {
    fixture_id: null,
    homeTeamExpected: 'Norway',
    awayTeamExpected: 'Senegal',
    // Norway beat Senegal 3-2 → Norway scored 3, Senegal scored 2
    // DB home=Norway → home_score=3, away_score=2
    home_score: 3,
    away_score: 2,
    result: 'H',
    description: 'Norway 3-2 Senegal (DB: Norway H=3, Senegal A=2)',
  },
  {
    fixture_id: null,
    homeTeamExpected: 'Algeria',
    awayTeamExpected: 'Jordan',
    // Algeria beat Jordan 2-1 → Algeria scored 2, Jordan scored 1
    // DB home=Algeria → home_score=2, away_score=1
    home_score: 2,
    away_score: 1,
    result: 'H',
    description: 'Algeria 2-1 Jordan (DB: Algeria H=2, Jordan A=1)',
  },
];

// ─── Step 3: Match fixtures to results by team names ─────────────────────────
console.log('\n[STEP 2] Matching DB fixtures to expected results by team names...');

for (const expected of RESULTS) {
  const match = rows.find(
    r =>
      r.home_name.toLowerCase() === expected.homeTeamExpected.toLowerCase() &&
      r.away_name.toLowerCase() === expected.awayTeamExpected.toLowerCase()
  );
  if (!match) {
    console.error(`[ERROR] No DB fixture found for ${expected.homeTeamExpected} (H) vs ${expected.awayTeamExpected} (A). Aborting.`);
    await db.end();
    process.exit(1);
  }
  expected.fixture_id = match.fixture_id;
  console.log(`  [MATCH] ${expected.fixture_id} → ${expected.description}`);
}

console.log('[VERIFY] All 4 fixtures matched ✅');

// ─── Step 4: Update scores ────────────────────────────────────────────────────
console.log('\n[STEP 3] Updating scores in wc2026_fixtures...');

let updateCount = 0;
for (const expected of RESULTS) {
  console.log(`\n  [STEP] Updating ${expected.fixture_id}...`);
  console.log(`  [INPUT] home_score=${expected.home_score}, away_score=${expected.away_score}, status=FT, result=${expected.result}`);

  const [updateResult] = await db.execute(
    `UPDATE wc2026_fixtures
     SET home_score = ?, away_score = ?, status = 'FT', result = ?
     WHERE fixture_id = ?`,
    [expected.home_score, expected.away_score, expected.result, expected.fixture_id]
  );

  if (updateResult.affectedRows !== 1) {
    console.error(`  [ERROR] Expected 1 row updated for ${expected.fixture_id}, got ${updateResult.affectedRows}. Aborting.`);
    await db.end();
    process.exit(1);
  }

  console.log(`  [OUTPUT] ${expected.fixture_id} updated — affectedRows=1 ✅`);
  updateCount++;
}

// ─── Step 5: Read-back verification ──────────────────────────────────────────
console.log('\n[STEP 4] Read-back verification — confirming all 4 rows in DB...');

const [verifyRows] = await db.execute(`
  SELECT
    f.fixture_id,
    ht.name AS home_name,
    at.name AS away_name,
    f.home_score,
    f.away_score,
    f.status,
    f.result
  FROM wc2026_fixtures f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE DATE(f.kickoff_utc) = '2026-06-22'
  ORDER BY f.kickoff_utc ASC
`);

let allPass = true;
for (const expected of RESULTS) {
  const row = verifyRows.find(r => r.fixture_id === expected.fixture_id);
  if (!row) {
    console.error(`  [FAIL] ${expected.fixture_id} not found in read-back ❌`);
    allPass = false;
    continue;
  }

  const scoreOk = row.home_score === expected.home_score && row.away_score === expected.away_score;
  const statusOk = row.status === 'FT';
  const resultOk = row.result === expected.result;
  const pass = scoreOk && statusOk && resultOk;

  console.log(`  [VERIFY] ${row.fixture_id} | ${row.home_name} ${row.home_score}-${row.away_score} ${row.away_name} | status=${row.status} result=${row.result} → ${pass ? '✅ PASS' : '❌ FAIL'}`);
  if (!pass) {
    console.error(`    [DETAIL] Expected: home=${expected.home_score}, away=${expected.away_score}, status=FT, result=${expected.result}`);
    console.error(`    [DETAIL] Got:      home=${row.home_score}, away=${row.away_score}, status=${row.status}, result=${row.result}`);
    allPass = false;
  }
}

console.log('\n══════════════════════════════════════════════════════════════════════');
if (allPass) {
  console.log(`[OUTPUT] June 22 score update COMPLETE — ${updateCount}/4 rows updated and verified ✅`);
} else {
  console.error('[OUTPUT] June 22 score update FAILED — discrepancies found ❌');
  await db.end();
  process.exit(1);
}
console.log('══════════════════════════════════════════════════════════════════════');

await db.end();
