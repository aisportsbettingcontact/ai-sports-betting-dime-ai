/**
 * fix_june15_swaps.mjs
 * ====================
 * Fixes home/away orientation for all 4 June 15 WC2026 fixtures.
 *
 * ISSUE: All 4 June 15 fixtures have home_team_id and away_team_id swapped
 * in the wc2026_fixtures table relative to the official FIFA schedule.
 *
 * Official FIFA WC2026 June 15 schedule:
 *   wc26-g-015: Spain (home) vs Cape Verde (away) — Atlanta, 12:00 PM ET
 *   wc26-g-013: Belgium (home) vs Egypt (away) — Seattle, 3:00 PM ET
 *   wc26-g-016: Saudi Arabia (home) vs Uruguay (away) — Miami, 6:00 PM ET
 *   wc26-g-014: Iran (home) vs New Zealand (away) — Inglewood, 9:00 PM ET
 *
 * Fix: Swap home_team_id <-> away_team_id for each fixture.
 *
 * NOTE: The odds snapshots use 'home'/'away' selections which are relative
 * to the fixture orientation. After swapping the fixture, the odds selections
 * will correctly map: 'home' = Spain/Belgium/KSA/Iran, 'away' = CPV/EGY/URU/NZL.
 *
 * The model odds (book_id=0) were seeded with the CORRECT orientation
 * (Spain=home, etc.) so the model odds are already correct — no change needed.
 *
 * The DK odds (book_id=68) were scraped from Action Network which uses
 * the same home/away convention as FIFA, so DK odds are also correct.
 *
 * After this fix, the WcFeedInline will display:
 *   HOME ML = Spain/Belgium/KSA/Iran (correct)
 *   AWAY ML = CPV/EGY/URU/NZL (correct)
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const u = new URL(process.env.DATABASE_URL);
const c = await mysql.createConnection({
  host: u.hostname,
  port: parseInt(u.port || '3306'),
  user: u.username,
  password: u.password,
  database: u.pathname.slice(1).split('?')[0],
  ssl: { rejectUnauthorized: false }
});

console.log('[INPUT] fix_june15_swaps.mjs — fixing home/away orientation for 4 June 15 WC fixtures');
console.log('[STEP] Reading current state before fix');

// Read current state
const [before] = await c.execute(`
  SELECT f.fixture_id, f.home_team_id, f.away_team_id,
         ht.fifa_code as homeCode, at.fifa_code as awayCode
  FROM wc2026_fixtures f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.fixture_id IN ('wc26-g-015', 'wc26-g-013', 'wc26-g-016', 'wc26-g-014')
  ORDER BY f.fixture_id
`);

console.log('[STATE] Before fix:');
for (const f of before) {
  console.log(`  ${f.fixture_id}: home=${f.homeCode}(${f.home_team_id}) away=${f.awayCode}(${f.away_team_id})`);
}

// Official correct orientation
const CORRECT = {
  'wc26-g-015': { home: 'esp', away: 'cpv', homeCode: 'ESP', awayCode: 'CPV' },
  'wc26-g-013': { home: 'bel', away: 'egy', homeCode: 'BEL', awayCode: 'EGY' },
  'wc26-g-016': { home: 'ksa', away: 'uru', homeCode: 'KSA', awayCode: 'URU' },
  'wc26-g-014': { home: 'irn', away: 'nzl', homeCode: 'IRN', awayCode: 'NZL' },
};

console.log('');
console.log('[STEP] Applying fixes...');

let fixed = 0;
let skipped = 0;

for (const f of before) {
  const correct = CORRECT[f.fixture_id];
  if (!correct) continue;
  
  if (f.home_team_id === correct.home && f.away_team_id === correct.away) {
    console.log(`[STATE] ${f.fixture_id}: already correct (home=${f.homeCode} away=${f.awayCode}) — SKIP`);
    skipped++;
    continue;
  }
  
  console.log(`[STEP] ${f.fixture_id}: swapping home=${f.homeCode}→${correct.homeCode} away=${f.awayCode}→${correct.awayCode}`);
  
  await c.execute(
    `UPDATE wc2026_fixtures SET home_team_id = ?, away_team_id = ? WHERE fixture_id = ?`,
    [correct.home, correct.away, f.fixture_id]
  );
  
  console.log(`[STATE] ${f.fixture_id}: updated`);
  fixed++;
}

console.log('');
console.log('[STEP] Reading state after fix');

// Verify after fix
const [after] = await c.execute(`
  SELECT f.fixture_id, f.home_team_id, f.away_team_id,
         ht.fifa_code as homeCode, at.fifa_code as awayCode
  FROM wc2026_fixtures f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.fixture_id IN ('wc26-g-015', 'wc26-g-013', 'wc26-g-016', 'wc26-g-014')
  ORDER BY f.fixture_id
`);

console.log('[STATE] After fix:');
let allCorrect = true;
for (const f of after) {
  const correct = CORRECT[f.fixture_id];
  const ok = f.home_team_id === correct.home && f.away_team_id === correct.away;
  if (!ok) allCorrect = false;
  console.log(`  ${f.fixture_id}: home=${f.homeCode}(${f.home_team_id}) away=${f.awayCode}(${f.away_team_id}) ${ok ? '✓' : '✗ STILL WRONG'}`);
}

console.log('');
console.log(`[OUTPUT] Fixed: ${fixed}, Skipped (already correct): ${skipped}`);
console.log(`[VERIFY] ${allCorrect ? 'PASS' : 'FAIL'} — orientation fix`);

// Now verify odds are still present and correctly labeled
console.log('');
console.log('[STEP] Verifying odds snapshots after orientation fix');

const june15Ids = ['wc26-g-015', 'wc26-g-013', 'wc26-g-016', 'wc26-g-014'];
const ph = june15Ids.map(() => '?').join(',');

const [dkOdds] = await c.execute(
  `SELECT fixture_id, market, selection, american_odds, line
   FROM wc2026_odds_snapshots
   WHERE fixture_id IN (${ph}) AND book_id = 68
   AND snapshot_ts = (
     SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
     WHERE s2.fixture_id = wc2026_odds_snapshots.fixture_id AND s2.book_id = 68
   )
   ORDER BY fixture_id, market, selection`,
  june15Ids
);

const [modelOdds] = await c.execute(
  `SELECT fixture_id, market, selection, american_odds, line
   FROM wc2026_odds_snapshots
   WHERE fixture_id IN (${ph}) AND book_id = 0
   AND snapshot_ts = (
     SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
     WHERE s2.fixture_id = wc2026_odds_snapshots.fixture_id AND s2.book_id = 0
   )
   ORDER BY fixture_id, market, selection`,
  june15Ids
);

// Group odds by fixture
const dkByFix = {};
const modelByFix = {};
for (const o of dkOdds) {
  if (!dkByFix[o.fixture_id]) dkByFix[o.fixture_id] = {};
  dkByFix[o.fixture_id][`${o.market}_${o.selection}`] = o.american_odds;
}
for (const o of modelOdds) {
  if (!modelByFix[o.fixture_id]) modelByFix[o.fixture_id] = {};
  modelByFix[o.fixture_id][`${o.market}_${o.selection}`] = o.american_odds;
}

// Build fixture map
const fxMap = {};
for (const f of after) fxMap[f.fixture_id] = f;

const OFFICIAL_DISPLAY = {
  'wc26-g-015': { kickoffET: '12:00 PM ET' },
  'wc26-g-013': { kickoffET: '3:00 PM ET' },
  'wc26-g-016': { kickoffET: '6:00 PM ET' },
  'wc26-g-014': { kickoffET: '9:00 PM ET' },
};

console.log('');
console.log('[STATE] Post-fix odds display (as will appear in PROJECTIONS feed):');
console.log('');

for (const fid of june15Ids) {
  const f = fxMap[fid];
  const dk = dkByFix[fid] || {};
  const model = modelByFix[fid] || {};
  const disp = OFFICIAL_DISPLAY[fid];
  
  console.log(`[FIXTURE] ${fid} | ${f.awayCode} @ ${f.homeCode} | ${disp.kickoffET}`);
  console.log(`  HOME (${f.homeCode}): DK=${dk['1X2_home'] ?? 'MISSING'} | Model=${model['1X2_home'] ?? 'MISSING'}`);
  console.log(`  DRAW:          DK=${dk['1X2_draw'] ?? 'MISSING'} | Model=${model['1X2_draw'] ?? 'MISSING'}`);
  console.log(`  AWAY (${f.awayCode}): DK=${dk['1X2_away'] ?? 'MISSING'} | Model=${model['1X2_away'] ?? 'MISSING'}`);
  console.log(`  TOTAL:         DK ${dk['TOTAL_over'] != null ? 'o'+dk['TOTAL_over'] : '?'}/u${dk['TOTAL_under'] ?? '?'} | Model o${model['TOTAL_over'] ?? '?'}/u${model['TOTAL_under'] ?? '?'}`);
  console.log('');
}

console.log('[VERIFY] PASS — June 15 WC fixture orientation fixed and odds verified');
await c.end();
