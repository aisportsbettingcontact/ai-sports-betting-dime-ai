/**
 * updateJune22ScoresV2.mjs
 * Updates June 22, 2026 WC2026 final scores using confirmed match IDs.
 * Note: wc2026_matches has no 'result' column — result is derived from scores.
 *
 * Confirmed DB orientations:
 *   wc26-g-043: Austria (H) vs Argentina (A) → Argentina 2-0 Austria → H=0, A=2
 *   wc26-g-041: Iraq (H) vs France (A)       → France 3-0 Iraq       → H=0, A=3
 *   wc26-g-042: Norway (H) vs Senegal (A)    → Norway 3-2 Senegal    → H=3, A=2
 *   wc26-g-044: Algeria (H) vs Jordan (A)    → Algeria 2-1 Jordan    → H=2, A=1
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

console.log('══════════════════════════════════════════════════════════════════════');
console.log('[STEP] updateJune22ScoresV2.mjs — START');
console.log('[INPUT] 4 matches: wc26-g-043, wc26-g-041, wc26-g-042, wc26-g-044');
console.log('══════════════════════════════════════════════════════════════════════');

const UPDATES = [
  { match_id: 'wc26-g-043', home_name: 'Austria',  away_name: 'Argentina', home_score: 0, away_score: 2, description: 'Argentina 2-0 Austria' },
  { match_id: 'wc26-g-041', home_name: 'Iraq',     away_name: 'France',    home_score: 0, away_score: 3, description: 'France 3-0 Iraq' },
  { match_id: 'wc26-g-042', home_name: 'Norway',   away_name: 'Senegal',   home_score: 3, away_score: 2, description: 'Norway 3-2 Senegal' },
  { match_id: 'wc26-g-044', home_name: 'Algeria',  away_name: 'Jordan',    home_score: 2, away_score: 1, description: 'Algeria 2-1 Jordan' },
];

const ids = UPDATES.map(u => u.match_id);
const placeholders = ids.map(() => '?').join(',');

// Step 1: Pre-update orientation verification
console.log('\n[STEP 1] Pre-update orientation verification...');
const [preRows] = await db.execute(
  `SELECT f.match_id, ht.name AS home_name, at.name AS away_name,
          f.home_score, f.away_score, f.status
   FROM wc2026_matches f
   JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
   JOIN wc2026_teams at ON f.away_team_id = at.team_id
   WHERE f.match_id IN (${placeholders})
   ORDER BY f.kickoff_utc ASC`,
  ids
);

let orientationOk = true;
for (const u of UPDATES) {
  const row = preRows.find(r => r.match_id === u.match_id);
  if (!row) {
    console.error(`  [ERROR] ${u.match_id} not found in DB — aborting ❌`);
    orientationOk = false;
    continue;
  }
  const homeMatch = row.home_name.toLowerCase() === u.home_name.toLowerCase();
  const awayMatch = row.away_name.toLowerCase() === u.away_name.toLowerCase();
  const ok = homeMatch && awayMatch;
  const label = ok ? '✅ ORIENTATION CORRECT' : '❌ ORIENTATION MISMATCH';
  console.log(`  [VERIFY] ${u.match_id}: DB home=${row.home_name}, DB away=${row.away_name} | expected home=${u.home_name}, away=${u.away_name} → ${label}`);
  if (!ok) orientationOk = false;
}

if (!orientationOk) {
  console.error('[ERROR] Orientation mismatch — aborting to prevent incorrect score assignment ❌');
  await db.end();
  process.exit(1);
}
console.log('[VERIFY] All 4 orientations confirmed correct ✅');

// Step 2: Apply updates
console.log('\n[STEP 2] Applying score updates...');
let updateCount = 0;
for (const u of UPDATES) {
  console.log(`\n  [STEP] Updating ${u.match_id} — ${u.description}`);
  console.log(`  [INPUT] home_score=${u.home_score}, away_score=${u.away_score}, status=FT`);

  const [res] = await db.execute(
    `UPDATE wc2026_matches SET home_score=?, away_score=?, status='FT' WHERE match_id=?`,
    [u.home_score, u.away_score, u.match_id]
  );

  if (res.affectedRows !== 1) {
    console.error(`  [ERROR] Expected 1 row updated, got ${res.affectedRows} ❌`);
    await db.end();
    process.exit(1);
  }
  console.log(`  [OUTPUT] ${u.match_id} updated — affectedRows=1 ✅`);
  updateCount++;
}

// Step 3: Read-back verification
console.log('\n[STEP 3] Read-back verification...');
const [postRows] = await db.execute(
  `SELECT f.match_id, ht.name AS home_name, at.name AS away_name,
          f.home_score, f.away_score, f.status
   FROM wc2026_matches f
   JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
   JOIN wc2026_teams at ON f.away_team_id = at.team_id
   WHERE f.match_id IN (${placeholders})
   ORDER BY f.kickoff_utc ASC`,
  ids
);

let allPass = true;
for (const u of UPDATES) {
  const row = postRows.find(r => r.match_id === u.match_id);
  const scoreOk = row.home_score === u.home_score && row.away_score === u.away_score;
  const statusOk = row.status === 'FT';
  const pass = scoreOk && statusOk;
  const passLabel = pass ? '✅ PASS' : '❌ FAIL';
  console.log(`  [VERIFY] ${row.match_id} | ${row.home_name} ${row.home_score}-${row.away_score} ${row.away_name} | status=${row.status} → ${passLabel}`);
  if (!pass) {
    console.error(`    [DETAIL] Expected: home=${u.home_score}, away=${u.away_score}, status=FT`);
    console.error(`    [DETAIL] Got:      home=${row.home_score}, away=${row.away_score}, status=${row.status}`);
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
