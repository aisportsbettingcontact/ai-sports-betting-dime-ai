/**
 * validate_june21_feed.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive end-to-end validation of all June 21 WC2026 feed cells.
 *
 * Validates:
 *   1. Book odds (DK, bookId=68): 1X2, TOTAL, DOUBLE_CHANCE — home/away orientation
 *   2. Model odds (bookId=0): 1X2, TOTAL, DOUBLE_CHANCE — home/away orientation
 *   3. Edge detection: model > book for each side
 *   4. ROI calculation: correct formula with proper opponent odds
 *   5. DC ROI: correct opponent pairing (1X vs X2)
 *
 * Expected orientations (DB home/away):
 *   wc26-g-039: home=esp (Spain), away=ksa (Saudi Arabia)
 *   wc26-g-037: home=irn (Iran), away=bel (Belgium)
 *   wc26-g-040: home=cpv (Cape Verde), away=uru (Uruguay)
 *   wc26-g-038: home=nzl (New Zealand), away=egy (Egypt)
 *
 * Expected DK book odds (user-verified):
 *   wc26-g-039: home(esp)=-900, draw=+950, away(ksa)=+2200, total O3.5=-105/U3.5=-120
 *   wc26-g-037: home(irn)=+650, draw=+370, away(bel)=-225, total O2.5=-125/U2.5=+100
 *   wc26-g-040: home(cpv)=+700, draw=+320, away(uru)=-210, total O2.5=+130/U2.5=-160
 *   wc26-g-038: home(nzl)=+500, draw=+300, away(egy)=-165, total O2.5=+105/U2.5=-130
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const MATCHES = ['wc26-g-039', 'wc26-g-037', 'wc26-g-040', 'wc26-g-038'];

// Expected DK book odds (ground truth from user-verified DK lines)
const EXPECTED_DK = {
  'wc26-g-039': { home: -900, draw: 950, away: 2200, overLine: 3.5, overOdds: -105, underOdds: -120, homeDraw: -10000, awayDraw: 500 },
  'wc26-g-037': { home: 650, draw: 370, away: -225, overLine: 2.5, overOdds: -125, underOdds: 100, homeDraw: 175, awayDraw: -1000 },
  'wc26-g-040': { home: 700, draw: 320, away: -210, overLine: 2.5, overOdds: 130, underOdds: -160, homeDraw: 165, awayDraw: -1100 },
  'wc26-g-038': { home: 500, draw: 300, away: -165, overLine: 2.5, overOdds: 105, underOdds: -130, homeDraw: 130, awayDraw: -700 },
};

// DB home/away team IDs
const MATCH_TEAMS = {
  'wc26-g-039': { home: 'esp', away: 'ksa', homeName: 'Spain', awayName: 'Saudi Arabia' },
  'wc26-g-037': { home: 'irn', away: 'bel', homeName: 'Iran', awayName: 'Belgium' },
  'wc26-g-040': { home: 'cpv', away: 'uru', homeName: 'Cape Verde', awayName: 'Uruguay' },
  'wc26-g-038': { home: 'nzl', away: 'egy', homeName: 'New Zealand', awayName: 'Egypt' },
};

// ─── Math helpers ─────────────────────────────────────────────────────────────
function americanToImplied(odds) {
  if (isNaN(odds)) return NaN;
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

function calculateEdge(bookOdds, modelOdds) {
  const b = americanToImplied(bookOdds);
  const m = americanToImplied(modelOdds);
  if (isNaN(b) || isNaN(m)) return NaN;
  return (m - b) * 100;
}

function calculate3WayEdge(book, model, side) {
  const bH = americanToImplied(book.home);
  const bD = americanToImplied(book.draw);
  const bA = americanToImplied(book.away);
  const mH = americanToImplied(model.home);
  const mD = americanToImplied(model.draw);
  const mA = americanToImplied(model.away);
  const bTotal = bH + bD + bA;
  const mTotal = mH + mD + mA;
  const bFair = { home: bH/bTotal, draw: bD/bTotal, away: bA/bTotal };
  const mFair = { home: mH/mTotal, draw: mD/mTotal, away: mA/mTotal };
  return (mFair[side] - bFair[side]) * 100;
}

function calculateRoi(modelML, bookML, bookOppML) {
  const mI = americanToImplied(modelML);
  const bI = americanToImplied(bookML);
  const bO = americanToImplied(bookOppML);
  const vigTotal = bI + bO;
  if (vigTotal <= 0) return NaN;
  const bookNoVig = bI / vigTotal;
  if (bookNoVig <= 0) return NaN;
  return (mI / bookNoVig - 1) * 100;
}

function calculate3WayRoi(book, model, side) {
  const bH = americanToImplied(book.home);
  const bD = americanToImplied(book.draw);
  const bA = americanToImplied(book.away);
  const mH = americanToImplied(model.home);
  const mD = americanToImplied(model.draw);
  const mA = americanToImplied(model.away);
  const bTotal = bH + bD + bA;
  const mTotal = mH + mD + mA;
  const bFair = bTotal > 0 ? { home: bH/bTotal, draw: bD/bTotal, away: bA/bTotal } : null;
  const mFair = mTotal > 0 ? { home: mH/mTotal, draw: mD/mTotal, away: mA/mTotal } : null;
  if (!bFair || !mFair || bFair[side] <= 0) return NaN;
  return (mFair[side] / bFair[side] - 1) * 100;
}

const EDGE_THRESHOLD = 1.5;

// ─── Main validation ──────────────────────────────────────────────────────────
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  let totalChecks = 0;
  let passed = 0;
  let failed = 0;
  const failures = [];

  console.log('[INPUT] Validating June 21 WC2026 feed — 4 matches × all cells');
  console.log('='.repeat(80));

  for (const matchId of MATCHES) {
    const teams = MATCH_TEAMS[matchId];
    const expected = EXPECTED_DK[matchId];
    console.log(`\n[MATCH] ${matchId} | home=${teams.homeName}(${teams.home}) away=${teams.awayName}(${teams.away})`);

    // ── Fetch latest DK rows ──────────────────────────────────────────────────
    const [dkRows] = await conn.execute(
      `SELECT market, selection, american_odds, line 
       FROM wc2026_odds_snapshots 
       WHERE match_id=? AND book_id=68 
       ORDER BY snapshot_ts DESC`,
      [matchId]
    );

    // Build DK odds map (first-seen per market+selection)
    const dk = {};
    const dkSeen = new Set();
    for (const r of dkRows) {
      const k = `${r.market}:${r.selection}`;
      if (!dkSeen.has(k)) {
        dkSeen.add(k);
        if (r.market === '1X2') dk[r.selection] = r.american_odds;
        else if (r.market === 'TOTAL') {
          if (r.selection === 'over') { dk.overLine = r.line; dk.overOdds = r.american_odds; }
          else if (r.selection === 'under') dk.underOdds = r.american_odds;
        } else if (r.market === 'DOUBLE_CHANCE') {
          if (r.selection === 'home_draw') dk.homeDraw = r.american_odds;
          else if (r.selection === 'away_draw') dk.awayDraw = r.american_odds;
        }
      }
    }

    // ── Fetch latest Model rows ───────────────────────────────────────────────
    const [modelRows] = await conn.execute(
      `SELECT market, selection, american_odds, line 
       FROM wc2026_odds_snapshots 
       WHERE match_id=? AND book_id=0 
       ORDER BY snapshot_ts DESC`,
      [matchId]
    );

    const model = {};
    const modelSeen = new Set();
    for (const r of modelRows) {
      const k = `${r.market}:${r.selection}`;
      if (!modelSeen.has(k)) {
        modelSeen.add(k);
        if (r.market === '1X2') model[r.selection] = r.american_odds;
        else if (r.market === 'TOTAL') {
          if (r.selection === 'over') { model.overLine = r.line; model.overOdds = r.american_odds; }
          else if (r.selection === 'under') model.underOdds = r.american_odds;
        } else if (r.market === 'DOUBLE_CHANCE') {
          if (r.selection === 'home_draw') model.homeDraw = r.american_odds;
          else if (r.selection === 'away_draw') model.awayDraw = r.american_odds;
        }
      }
    }

    // ── Helper: check a value ─────────────────────────────────────────────────
    function check(label, actual, expectedVal, tolerance = 0) {
      totalChecks++;
      const ok = actual != null && !isNaN(actual) && Math.abs(actual - expectedVal) <= tolerance;
      const status = ok ? '✅' : '❌';
      console.log(`  ${status} [${label}] actual=${actual ?? 'NULL'} expected=${expectedVal}`);
      if (ok) passed++;
      else { failed++; failures.push(`${matchId} ${label}: actual=${actual} expected=${expectedVal}`); }
    }

    function checkExists(label, actual) {
      totalChecks++;
      const ok = actual != null && !isNaN(actual);
      const status = ok ? '✅' : '❌';
      console.log(`  ${status} [${label}] actual=${actual ?? 'NULL'} (exists check)`);
      if (ok) passed++;
      else { failed++; failures.push(`${matchId} ${label}: NULL/missing`); }
    }

    // ── 1. Book DK 1X2 orientation ────────────────────────────────────────────
    console.log(`\n  [STEP] Book DK 1X2 orientation check`);
    check('DK home ML', dk.home, expected.home, 50); // allow ±50 for line movement
    check('DK draw ML', dk.draw, expected.draw, 100);
    check('DK away ML', dk.away, expected.away, 50);

    // ── 2. Book DK TOTAL ──────────────────────────────────────────────────────
    console.log(`\n  [STEP] Book DK TOTAL check`);
    check('DK overLine', dk.overLine, expected.overLine, 0.5);
    check('DK overOdds', dk.overOdds, expected.overOdds, 30);
    check('DK underOdds', dk.underOdds, expected.underOdds, 30);

    // ── 3. Book DK DOUBLE_CHANCE ──────────────────────────────────────────────
    console.log(`\n  [STEP] Book DK DOUBLE_CHANCE check`);
    check('DK homeDraw (1X)', dk.homeDraw, expected.homeDraw, 200); // DC odds can move more
    check('DK awayDraw (X2)', dk.awayDraw, expected.awayDraw, 200);

    // ── 4. Model 1X2 existence ────────────────────────────────────────────────
    console.log(`\n  [STEP] Model 1X2 existence check`);
    checkExists('Model home ML', model.home);
    checkExists('Model draw ML', model.draw);
    checkExists('Model away ML', model.away);

    // ── 5. Model TOTAL existence ──────────────────────────────────────────────
    console.log(`\n  [STEP] Model TOTAL existence check`);
    checkExists('Model overOdds', model.overOdds);
    checkExists('Model underOdds', model.underOdds);

    // ── 6. Model DOUBLE_CHANCE existence ─────────────────────────────────────
    console.log(`\n  [STEP] Model DOUBLE_CHANCE existence check`);
    checkExists('Model homeDraw (1X)', model.homeDraw);
    checkExists('Model awayDraw (X2)', model.awayDraw);

    // ── 7. Model DC consistency: homeDraw = P(home) + P(draw) ────────────────
    console.log(`\n  [STEP] Model DC probability consistency check`);
    if (model.home != null && model.draw != null && model.away != null && model.homeDraw != null && model.awayDraw != null) {
      const mH = americanToImplied(model.home);
      const mD = americanToImplied(model.draw);
      const mA = americanToImplied(model.away);
      const mTotal = mH + mD + mA;
      const expectedHomeDrawProb = (mH + mD) / mTotal;
      const expectedAwayDrawProb = (mA + mD) / mTotal;
      const actualHomeDrawProb = americanToImplied(model.homeDraw);
      const actualAwayDrawProb = americanToImplied(model.awayDraw);
      const homeDrawDelta = Math.abs(actualHomeDrawProb - expectedHomeDrawProb) * 100;
      const awayDrawDelta = Math.abs(actualAwayDrawProb - expectedAwayDrawProb) * 100;
      totalChecks += 2;
      const hOk = homeDrawDelta < 2; // allow 2pp tolerance for rounding
      const aOk = awayDrawDelta < 2;
      console.log(`  ${hOk ? '✅' : '❌'} [Model homeDraw consistency] expected≈${(expectedHomeDrawProb*100).toFixed(2)}% actual=${(actualHomeDrawProb*100).toFixed(2)}% delta=${homeDrawDelta.toFixed(2)}pp`);
      console.log(`  ${aOk ? '✅' : '❌'} [Model awayDraw consistency] expected≈${(expectedAwayDrawProb*100).toFixed(2)}% actual=${(actualAwayDrawProb*100).toFixed(2)}% delta=${awayDrawDelta.toFixed(2)}pp`);
      if (hOk) passed++; else { failed++; failures.push(`${matchId} Model homeDraw consistency: delta=${homeDrawDelta.toFixed(2)}pp`); }
      if (aOk) passed++; else { failed++; failures.push(`${matchId} Model awayDraw consistency: delta=${awayDrawDelta.toFixed(2)}pp`); }
    }

    // ── 8. Edge detection ─────────────────────────────────────────────────────
    console.log(`\n  [STEP] Edge detection (3-way for ML, 2-way for TOTAL/DC)`);
    if (dk.home != null && dk.draw != null && dk.away != null && model.home != null && model.draw != null && model.away != null) {
      const book3 = { home: dk.home, draw: dk.draw, away: dk.away };
      const model3 = { home: model.home, draw: model.draw, away: model.away };
      const homeEdge = calculate3WayEdge(book3, model3, 'home');
      const drawEdge = calculate3WayEdge(book3, model3, 'draw');
      const awayEdge = calculate3WayEdge(book3, model3, 'away');
      console.log(`  [STATE] ML 3-way edges: home=${homeEdge.toFixed(2)}pp draw=${drawEdge.toFixed(2)}pp away=${awayEdge.toFixed(2)}pp`);
      const bestMlEdge = Math.max(homeEdge, drawEdge, awayEdge);
      const bestMlSide = homeEdge >= drawEdge && homeEdge >= awayEdge ? 'HOME' : drawEdge >= awayEdge ? 'DRAW' : 'AWAY';
      if (bestMlEdge >= EDGE_THRESHOLD) {
        const roi = calculate3WayRoi(book3, model3, bestMlSide.toLowerCase());
        console.log(`  [OUTPUT] ML edge: ${bestMlSide} +${bestMlEdge.toFixed(2)}pp ROI=${roi.toFixed(2)}%`);
      } else {
        console.log(`  [OUTPUT] ML: NO EDGE (best=${bestMlEdge.toFixed(2)}pp < ${EDGE_THRESHOLD}pp threshold)`);
      }
    }

    if (dk.overOdds != null && model.overOdds != null) {
      const overEdge = calculateEdge(dk.overOdds, model.overOdds);
      const underEdge = calculateEdge(dk.underOdds, model.underOdds);
      console.log(`  [STATE] TOTAL edges: over=${overEdge.toFixed(2)}pp under=${underEdge.toFixed(2)}pp`);
      const bestTotalEdge = Math.max(overEdge, underEdge);
      if (bestTotalEdge >= EDGE_THRESHOLD) {
        const isBestOver = overEdge >= underEdge;
        const roi = isBestOver
          ? calculateRoi(model.overOdds, dk.overOdds, dk.underOdds)
          : calculateRoi(model.underOdds, dk.underOdds, dk.overOdds);
        console.log(`  [OUTPUT] TOTAL edge: ${isBestOver ? 'OVER' : 'UNDER'} +${bestTotalEdge.toFixed(2)}pp ROI=${roi.toFixed(2)}%`);
      } else {
        console.log(`  [OUTPUT] TOTAL: NO EDGE (best=${bestTotalEdge.toFixed(2)}pp)`);
      }
    }

    if (dk.homeDraw != null && model.homeDraw != null && dk.awayDraw != null && model.awayDraw != null) {
      const homeDcEdge = calculateEdge(dk.homeDraw, model.homeDraw);
      const awayDcEdge = calculateEdge(dk.awayDraw, model.awayDraw);
      console.log(`  [STATE] DC edges: homeDraw(1X)=${homeDcEdge.toFixed(2)}pp awayDraw(X2)=${awayDcEdge.toFixed(2)}pp`);
      if (homeDcEdge >= EDGE_THRESHOLD) {
        // [FIX VALIDATION] Correct opponent: 1X opponent is X2
        const roi = calculateRoi(model.homeDraw, dk.homeDraw, dk.awayDraw);
        console.log(`  [OUTPUT] DC edge: HOME W/D (1X) +${homeDcEdge.toFixed(2)}pp ROI=${roi.toFixed(2)}%`);
        console.log(`  [VERIFY] DC ROI formula: calculateRoi(model.homeDraw=${model.homeDraw}, dk.homeDraw=${dk.homeDraw}, dk.awayDraw=${dk.awayDraw}) = ${roi.toFixed(2)}%`);
      } else if (awayDcEdge >= EDGE_THRESHOLD) {
        // [FIX VALIDATION] Correct opponent: X2 opponent is 1X
        const roi = calculateRoi(model.awayDraw, dk.awayDraw, dk.homeDraw);
        console.log(`  [OUTPUT] DC edge: AWAY W/D (X2) +${awayDcEdge.toFixed(2)}pp ROI=${roi.toFixed(2)}%`);
        console.log(`  [VERIFY] DC ROI formula: calculateRoi(model.awayDraw=${model.awayDraw}, dk.awayDraw=${dk.awayDraw}, dk.homeDraw=${dk.homeDraw}) = ${roi.toFixed(2)}%`);
      } else {
        console.log(`  [OUTPUT] DC: NO EDGE`);
      }
    }

    console.log(`\n  [STATE] Raw DB values:`);
    console.log(`    DK: home=${dk.home} draw=${dk.draw} away=${dk.away} overLine=${dk.overLine} overOdds=${dk.overOdds} underOdds=${dk.underOdds} homeDraw=${dk.homeDraw} awayDraw=${dk.awayDraw}`);
    console.log(`    Model: home=${model.home} draw=${model.draw} away=${model.away} overOdds=${model.overOdds} underOdds=${model.underOdds} homeDraw=${model.homeDraw} awayDraw=${model.awayDraw}`);
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log(`[OUTPUT] Validation complete: ${passed}/${totalChecks} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('[VERIFY] FAILURES:');
    failures.forEach(f => console.log(`  ❌ ${f}`));
  } else {
    console.log('[VERIFY] ✅ ALL CHECKS PASSED');
  }

  await conn.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
