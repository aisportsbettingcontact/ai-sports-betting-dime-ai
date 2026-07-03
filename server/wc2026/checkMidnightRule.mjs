/**
 * checkMidnightRule.mjs
 * Verifies matchGameDate and matchKickoffEt are correctly stored for all matches
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('\n══════════════════════════════════════════════════════════');
console.log('  MIDNIGHT RULE VERIFICATION — wc2026_espn_matches');
console.log('══════════════════════════════════════════════════════════\n');

const [rows] = await conn.execute(
  `SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev, matchDateUtc, matchGameDate, matchKickoffEt
   FROM wc2026_espn_matches
   ORDER BY matchDateUtc ASC`
);

const EXPECTED = {
  '760449': { gameDate: '2026-06-20', kickoffEt: '00:00', note: 'MIDNIGHT RULE: 9PM PT Jun20 = 12AM ET Jun21 → stored as Jun20' },
  '760486': { gameDate: '2026-06-28', kickoffEt: '15:00', note: '12PM PT Jun28 = 3PM ET Jun28' },
  '760487': { gameDate: '2026-06-29', kickoffEt: '13:00', note: '10AM PT Jun29 = 1PM ET Jun29' },
  '760489': { gameDate: '2026-06-29', kickoffEt: '16:30', note: '1:30PM PT Jun29 = 4:30PM ET Jun29' },
  '760488': { gameDate: '2026-06-29', kickoffEt: '21:00', note: '6PM PT Jun29 = 9PM ET Jun29' },
};

let pass = 0, fail = 0;

for (const row of rows) {
  const exp = EXPECTED[row.espn_match_id];
  const utcStr = new Date(Number(row.matchDateUtc)).toISOString();
  
  console.log(`Match: ${row.espn_match_id} | ${row.homeTeamAbbrev} vs ${row.awayTeamAbbrev}`);
  console.log(`  UTC:            ${utcStr}`);
  console.log(`  matchGameDate:  ${row.matchGameDate}  (expected: ${exp?.gameDate ?? 'N/A'})`);
  console.log(`  matchKickoffEt: ${row.matchKickoffEt}  (expected: ${exp?.kickoffEt ?? 'N/A'})`);
  
  if (exp) {
    const dateOk = row.matchGameDate === exp.gameDate;
    const timeOk = row.matchKickoffEt === exp.kickoffEt;
    const status = dateOk && timeOk ? '✅ PASS' : '❌ FAIL';
    if (dateOk && timeOk) pass++; else fail++;
    console.log(`  Status:         ${status}`);
    if (exp.note) console.log(`  Note:           ${exp.note}`);
    if (!dateOk) console.log(`  ⚠ DATE MISMATCH: got "${row.matchGameDate}" expected "${exp.gameDate}"`);
    if (!timeOk) console.log(`  ⚠ TIME MISMATCH: got "${row.matchKickoffEt}" expected "${exp.kickoffEt}"`);
  } else {
    console.log(`  Status:         ℹ No GT defined for this espn_match_id`);
  }
  console.log();
}

console.log('══════════════════════════════════════════════════════════');
console.log(`  RESULT: ${pass} PASS | ${fail} FAIL`);
console.log('══════════════════════════════════════════════════════════\n');

await conn.end();
process.exit(fail > 0 ? 1 : 0);
