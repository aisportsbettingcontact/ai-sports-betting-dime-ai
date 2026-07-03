/**
 * fixMatchDatesPT.mjs
 * 
 * RULE: match_date = PT (Pacific Daylight Time = UTC-7) date of kickoff_utc
 * 
 * Audits and corrects match_date for all 13 target fixtures.
 * Logs every step with full transparency.
 */
import mysql from 'mysql2/promise';
import 'dotenv/config';

const PT_OFFSET_MS = -7 * 60 * 60 * 1000; // PDT = UTC-7

const TARGET_IDS = [
  'wc26-r32-079',
  'wc26-r32-080','wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084',
  'wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088',
  'wc26-r16-089','wc26-r16-090','wc26-r16-091'
];

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname, port: parseInt(url.port || '3306'),
  user: url.username, password: url.password,
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  WC2026 MATCH DATE CORRECTION — PT (UTC-7 PDT) Convention');
console.log('  Rule: match_date = date of kickoff_utc in Pacific Time');
console.log('════════════════════════════════════════════════════════════════════\n');

const ph = TARGET_IDS.map(() => '?').join(',');
const [rows] = await conn.execute(`
  SELECT f.match_id, f.match_date, f.kickoff_utc,
         ht.name AS home_name, at.name AS away_name
  FROM wc2026_matches f
  LEFT JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  LEFT JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.match_id IN (${ph})
  ORDER BY f.kickoff_utc, f.match_id
`, TARGET_IDS);

console.log(`[INPUT]  ${rows.length} fixtures loaded from DB\n`);

const corrections = [];

for (const r of rows) {
  const kickoffUTC = r.kickoff_utc instanceof Date ? r.kickoff_utc : new Date(r.kickoff_utc);
  const kickoffPT = new Date(kickoffUTC.getTime() + PT_OFFSET_MS);
  
  // PT date string YYYY-MM-DD
  const expectedDate = kickoffPT.toISOString().split('T')[0];
  
  // Kickoff time in ET (UTC-4 EDT) for display
  const kickoffET = new Date(kickoffUTC.getTime() - 4 * 60 * 60 * 1000);
  const kickoffETStr = kickoffET.toISOString().replace('T', ' ').substring(11, 16) + ' ET';
  
  // Current stored date
  const storedDate = r.match_date instanceof Date
    ? r.match_date.toISOString().split('T')[0]
    : String(r.match_date).split('T')[0];
  
  const needsFix = storedDate !== expectedDate;
  const status = needsFix ? '❌ MISMATCH' : '✅ CORRECT';
  
  console.log(`[${r.match_id}] ${r.away_name} @ ${r.home_name}`);
  console.log(`  kickoff_utc:  ${kickoffUTC.toISOString()}`);
  console.log(`  kickoff_PT:   ${kickoffPT.toISOString().replace('T', ' ').substring(0, 16)} PT`);
  console.log(`  kickoff_ET:   ${kickoffETStr}`);
  console.log(`  match_date DB:    ${storedDate}`);
  console.log(`  match_date (PT):  ${expectedDate}  ${status}`);
  
  if (needsFix) {
    corrections.push({ matchId: r.match_id, from: storedDate, to: expectedDate, matchup: `${r.away_name} @ ${r.home_name}` });
    console.log(`  → WILL CORRECT: ${storedDate} → ${expectedDate}`);
  }
  console.log();
}

// Apply corrections
if (corrections.length === 0) {
  console.log('[RESULT] ✅ All match_dates are already correct (PT convention). No changes needed.\n');
} else {
  console.log(`[STEP]   Applying ${corrections.length} match_date correction(s)...\n`);
  
  for (const c of corrections) {
    console.log(`[STEP]   UPDATE wc2026_matches SET match_date='${c.to}' WHERE match_id='${c.matchId}'`);
    const [res] = await conn.execute(
      `UPDATE wc2026_matches SET match_date = ? WHERE match_id = ?`,
      [c.to, c.matchId]
    );
    const ok = res.affectedRows === 1;
    console.log(`[${ok ? 'OUTPUT' : 'ERROR '}]  ${ok ? '✅' : '❌'} match_id=${c.matchId} | ${c.matchup} | ${c.from} → ${c.to} | rows_affected=${res.affectedRows}`);
  }
  
  // Verify all corrections
  console.log('\n[VERIFY] Re-querying all corrected fixtures...');
  const correctedIds = corrections.map(c => c.matchId);
  const verPh = correctedIds.map(() => '?').join(',');
  const [verRows] = await conn.execute(
    `SELECT match_id, match_date, kickoff_utc FROM wc2026_matches WHERE match_id IN (${verPh})`,
    correctedIds
  );
  
  let allPass = true;
  for (const c of corrections) {
    const row = verRows.find(r => r.match_id === c.matchId);
    const actual = row?.match_date instanceof Date
      ? row.match_date.toISOString().split('T')[0]
      : String(row?.match_date).split('T')[0];
    const pass = actual === c.to;
    if (!pass) allPass = false;
    console.log(`[VERIFY] ${pass ? '✅ PASS' : '❌ FAIL'} ${c.matchId}: expected=${c.to} actual=${actual}`);
  }
  
  console.log(`\n[RESULT] ${allPass ? '✅ ALL CORRECTIONS VERIFIED' : '❌ SOME CORRECTIONS FAILED'}`);
}

// Final state dump
console.log('\n════════════════════════════════════════════════════════════════════');
console.log('  FINAL STATE — All 13 Fixtures');
console.log('════════════════════════════════════════════════════════════════════');
const [final] = await conn.execute(`
  SELECT f.match_id, f.match_date, f.kickoff_utc,
         ht.name AS home_name, at.name AS away_name
  FROM wc2026_matches f
  LEFT JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  LEFT JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.match_id IN (${ph})
  ORDER BY f.kickoff_utc, f.match_id
`, TARGET_IDS);

console.log('match_id          | match_date | kickoff_ET   | matchup');
console.log('─'.repeat(90));
for (const r of final) {
  const md = r.match_date instanceof Date ? r.match_date.toISOString().split('T')[0] : String(r.match_date).split('T')[0];
  const kickoffUTC = r.kickoff_utc instanceof Date ? r.kickoff_utc : new Date(r.kickoff_utc);
  const kickoffET = new Date(kickoffUTC.getTime() - 4 * 60 * 60 * 1000);
  const etStr = kickoffET.toISOString().replace('T', ' ').substring(11, 16) + ' ET';
  console.log(`${r.match_id.padEnd(20)}| ${md} | ${etStr}    | ${r.away_name} @ ${r.home_name}`);
}

await conn.end();
console.log('\n[DONE] match_date PT correction complete.');
