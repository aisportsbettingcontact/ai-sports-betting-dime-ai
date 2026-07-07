/**
 * DATA-002 FIX: Spread inversion correction for wc2026MatchOdds
 * 
 * Protocol: DATA-001 standard (dry-run → scope proof → atomic UPDATEs → before/after → provenance)
 * 
 * Affected matches:
 *   r16-089 (PAR vs FRA): Fix BOTH book + model (both inverted)
 *   r16-090 (CAN vs MAR): Fix book ONLY (model is correct — home convention)
 *   r16-092 (MEX vs ENG): Fix BOTH book + model (both inverted)
 * 
 * Fix logic:
 *   - Negate spread line (e.g., -1.5 → +1.5)
 *   - Swap H/A spread odds (home_odds ↔ away_odds)
 *   - Applied to book columns for all 3; applied to model columns for 089 and 092 only
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const MATCH_IDS = ['wc26-r16-089', 'wc26-r16-090', 'wc26-r16-092'];
const TIMESTAMP = new Date().toISOString();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log(`[DATA-002 FIX] ${TIMESTAMP}`);
console.log(`[MODE] ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE EXECUTION'}`);
console.log('');

// ═══════════════════════════════════════════════════════════════
// PHASE 1: BEFORE STATE (read current values)
// ═══════════════════════════════════════════════════════════════
console.log('═══ PHASE 1: BEFORE STATE ═══');
const [beforeRows] = await conn.execute(`
  SELECT match_id, 
    book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
    model_primary_spread, model_home_primary_spread_odds, model_away_primary_spread_odds
  FROM wc2026MatchOdds 
  WHERE match_id IN (?, ?, ?)
  ORDER BY match_id
`, MATCH_IDS);

for (const r of beforeRows) {
  console.log(`[BEFORE] ${r.match_id}:`);
  console.log(`  BOOK:  spread=${r.book_primary_spread} H_odds=${r.book_home_primary_spread_odds} A_odds=${r.book_away_primary_spread_odds}`);
  console.log(`  MODEL: spread=${r.model_primary_spread} H_odds=${r.model_home_primary_spread_odds} A_odds=${r.model_away_primary_spread_odds}`);
}
console.log('');

// ═══════════════════════════════════════════════════════════════
// PHASE 2: SCOPE PROOF (verify these are the right rows)
// ═══════════════════════════════════════════════════════════════
console.log('═══ PHASE 2: SCOPE PROOF ═══');
const [scopeCheck] = await conn.execute(`
  SELECT match_id, book_home_ml, book_away_ml, 
    model_projected_home_goals, model_projected_away_goals
  FROM wc2026MatchOdds 
  WHERE match_id IN (?, ?, ?)
  ORDER BY match_id
`, MATCH_IDS);

let scopeValid = true;
for (const r of scopeCheck) {
  const homeIsUnderdog = r.book_home_ml > r.book_away_ml || (r.book_home_ml > 0 && r.book_away_ml < 0);
  const bookSpread = beforeRows.find(b => b.match_id === r.match_id).book_primary_spread;
  const spreadSaysHomeGives = bookSpread < 0;
  const inverted = homeIsUnderdog && spreadSaysHomeGives;
  console.log(`[SCOPE] ${r.match_id}: homeML=${r.book_home_ml} awayML=${r.book_away_ml} homeUnderdog=${homeIsUnderdog} spreadSaysGives=${spreadSaysHomeGives} INVERTED=${inverted}`);
  if (!inverted) {
    console.log(`[SCOPE FAIL] ${r.match_id} does NOT appear inverted — ABORTING`);
    scopeValid = false;
  }
}

if (!scopeValid) {
  console.log('[ABORT] Scope validation failed. No writes performed.');
  await conn.end();
  process.exit(1);
}
console.log('[SCOPE] All 3 matches confirmed INVERTED. Proceeding.');
console.log('');

// ═══════════════════════════════════════════════════════════════
// PHASE 3: EXECUTE FIX (atomic UPDATEs)
// ═══════════════════════════════════════════════════════════════
console.log('═══ PHASE 3: EXECUTE FIX ═══');

if (DRY_RUN) {
  console.log('[DRY-RUN] Would execute:');
  console.log('  UPDATE r16-089: negate book_spread, swap book H/A odds, negate model_spread, swap model H/A odds');
  console.log('  UPDATE r16-090: negate book_spread, swap book H/A odds ONLY (model is correct)');
  console.log('  UPDATE r16-092: negate book_spread, swap book H/A odds, negate model_spread, swap model H/A odds');
  console.log('[DRY-RUN] No writes performed.');
} else {
  await conn.beginTransaction();
  try {
    // r16-089: Fix BOTH book + model
    const [res089] = await conn.execute(`
      UPDATE wc2026MatchOdds SET
        book_primary_spread = -book_primary_spread,
        book_home_primary_spread_odds = @tmp_h := book_home_primary_spread_odds,
        book_home_primary_spread_odds = book_away_primary_spread_odds,
        book_away_primary_spread_odds = @tmp_h,
        model_primary_spread = -model_primary_spread,
        model_home_primary_spread_odds = @tmp_mh := model_home_primary_spread_odds,
        model_home_primary_spread_odds = model_away_primary_spread_odds,
        model_away_primary_spread_odds = @tmp_mh
      WHERE match_id = 'wc26-r16-089'
    `);
    // MySQL doesn't support the @tmp trick in a single UPDATE like that.
    // Use a simpler approach: read, compute, write.
    await conn.rollback();
    
    // Restart with explicit value swaps
    await conn.beginTransaction();
    
    // r16-089: Fix BOTH
    const b089 = beforeRows.find(r => r.match_id === 'wc26-r16-089');
    await conn.execute(`
      UPDATE wc2026MatchOdds SET
        book_primary_spread = ?,
        book_home_primary_spread_odds = ?,
        book_away_primary_spread_odds = ?,
        model_primary_spread = ?,
        model_home_primary_spread_odds = ?,
        model_away_primary_spread_odds = ?
      WHERE match_id = 'wc26-r16-089'
    `, [
      -b089.book_primary_spread,
      b089.book_away_primary_spread_odds,  // swap: old away → new home
      b089.book_home_primary_spread_odds,  // swap: old home → new away
      -b089.model_primary_spread,
      b089.model_away_primary_spread_odds, // swap
      b089.model_home_primary_spread_odds  // swap
    ]);
    console.log('[WRITE] r16-089: book+model spread negated, H/A odds swapped');

    // r16-090: Fix book ONLY
    const b090 = beforeRows.find(r => r.match_id === 'wc26-r16-090');
    await conn.execute(`
      UPDATE wc2026MatchOdds SET
        book_primary_spread = ?,
        book_home_primary_spread_odds = ?,
        book_away_primary_spread_odds = ?
      WHERE match_id = 'wc26-r16-090'
    `, [
      -b090.book_primary_spread,
      b090.book_away_primary_spread_odds,  // swap
      b090.book_home_primary_spread_odds   // swap
    ]);
    console.log('[WRITE] r16-090: book spread negated, book H/A odds swapped (model UNCHANGED)');

    // r16-092: Fix BOTH
    const b092 = beforeRows.find(r => r.match_id === 'wc26-r16-092');
    await conn.execute(`
      UPDATE wc2026MatchOdds SET
        book_primary_spread = ?,
        book_home_primary_spread_odds = ?,
        book_away_primary_spread_odds = ?,
        model_primary_spread = ?,
        model_home_primary_spread_odds = ?,
        model_away_primary_spread_odds = ?
      WHERE match_id = 'wc26-r16-092'
    `, [
      -b092.book_primary_spread,
      b092.book_away_primary_spread_odds,
      b092.book_home_primary_spread_odds,
      -b092.model_primary_spread,
      b092.model_away_primary_spread_odds,
      b092.model_home_primary_spread_odds
    ]);
    console.log('[WRITE] r16-092: book+model spread negated, H/A odds swapped');

    await conn.commit();
    console.log('[COMMIT] All 3 UPDATEs committed atomically.');
  } catch (err) {
    await conn.rollback();
    console.log('[ROLLBACK] Transaction failed:', err.message);
    await conn.end();
    process.exit(1);
  }
}
console.log('');

// ═══════════════════════════════════════════════════════════════
// PHASE 4: AFTER STATE (verify)
// ═══════════════════════════════════════════════════════════════
console.log('═══ PHASE 4: AFTER STATE ═══');
const [afterRows] = await conn.execute(`
  SELECT match_id, 
    book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
    model_primary_spread, model_home_primary_spread_odds, model_away_primary_spread_odds,
    book_home_ml, book_away_ml
  FROM wc2026MatchOdds 
  WHERE match_id IN (?, ?, ?)
  ORDER BY match_id
`, MATCH_IDS);

for (const r of afterRows) {
  const homeIsUnderdog = r.book_home_ml > r.book_away_ml || (r.book_home_ml > 0 && r.book_away_ml < 0);
  const spreadCorrect = homeIsUnderdog ? r.book_primary_spread > 0 : r.book_primary_spread < 0;
  console.log(`[AFTER] ${r.match_id}:`);
  console.log(`  BOOK:  spread=${r.book_primary_spread} H_odds=${r.book_home_primary_spread_odds} A_odds=${r.book_away_primary_spread_odds}`);
  console.log(`  MODEL: spread=${r.model_primary_spread} H_odds=${r.model_home_primary_spread_odds} A_odds=${r.model_away_primary_spread_odds}`);
  console.log(`  VERIFY: homeUnderdog=${homeIsUnderdog} spreadPositive=${r.book_primary_spread > 0} CORRECT=${spreadCorrect}`);
}
console.log('');

// ═══════════════════════════════════════════════════════════════
// PHASE 5: PROVENANCE
// ═══════════════════════════════════════════════════════════════
console.log('═══ PHASE 5: PROVENANCE ═══');
console.log(`[PROVENANCE] Fix: DATA-002`);
console.log(`[PROVENANCE] Timestamp: ${TIMESTAMP}`);
console.log(`[PROVENANCE] Script: fix_data002_spread_inversion.mjs`);
console.log(`[PROVENANCE] Scope: 3 rows (wc26-r16-089, wc26-r16-090, wc26-r16-092)`);
console.log(`[PROVENANCE] Columns modified:`);
console.log(`  r16-089: book_primary_spread, book_home/away_primary_spread_odds, model_primary_spread, model_home/away_primary_spread_odds`);
console.log(`  r16-090: book_primary_spread, book_home/away_primary_spread_odds ONLY`);
console.log(`  r16-092: book_primary_spread, book_home/away_primary_spread_odds, model_primary_spread, model_home/away_primary_spread_odds`);
console.log(`[PROVENANCE] Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);

await conn.end();
process.exit(0);
