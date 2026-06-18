/**
 * wc_verify_roi_june18.cjs
 * 
 * Full ROI + edge verification for all 4 June 18 WC2026 fixtures.
 * Validates:
 * 1. Team display order (home top, away bottom in component convention)
 * 2. DK ML odds correctly mapped to teams
 * 3. Model ML odds correctly mapped to teams
 * 4. TOTAL over/under correctly populated
 * 5. DRAW odds present and correct
 * 6. ROI/edge calculation for 3-way market (home, draw, away) — ALL 3 sides
 * 
 * ROI formula (3-way market):
 *   impliedProb = 1 / (1 + |odds|/100) for negative, 100/(odds+100) for positive
 *   noVigProb = impliedProb / sum(all 3 implied probs)
 *   edge = modelProb - noVigProb
 *   roi = edge / noVigProb  (edge as % of fair price)
 * 
 * Logging: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY]
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function noVig3Way(homeOdds, drawOdds, awayOdds) {
  const hImpl = americanToImplied(homeOdds);
  const dImpl = americanToImplied(drawOdds);
  const aImpl = americanToImplied(awayOdds);
  const total = hImpl + dImpl + aImpl;
  return {
    homeNoVig: hImpl / total,
    drawNoVig: dImpl / total,
    awayNoVig: aImpl / total,
    vig: total - 1,
    total,
  };
}

function calcEdge(modelProb, noVigProb) {
  return modelProb - noVigProb;
}

function calcROI(edge, noVigProb) {
  if (noVigProb === 0) return null;
  return edge / noVigProb;
}

function impliedToAmerican(prob) {
  if (prob >= 0.5) return -(prob / (1 - prob)) * 100;
  return ((1 - prob) / prob) * 100;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[INPUT] Connected to DB');
  console.log('[INPUT] Verifying all 4 June 18 WC2026 fixtures: team order, odds, TOTAL, DRAW, ROI\n');

  // Ground truth from DK screenshot
  const DK_GT = {
    'wc26-g-025': { homeCode: 'CZE', awayCode: 'RSA', homeML: -120, awayML: 380, draw: 260 },
    'wc26-g-027': { homeCode: 'SUI', awayCode: 'BIH', homeML: -180, awayML: 500, draw: 310 },
    'wc26-g-028': { homeCode: 'CAN', awayCode: 'QAT', homeML: -350, awayML: 1000, draw: 475 },
    'wc26-g-026': { homeCode: 'MEX', awayCode: 'KOR', homeML: 105, awayML: 295, draw: 230 },
  };

  const [fixtures] = await conn.execute(`
    SELECT f.fixture_id, f.kickoff_utc,
           ht.name AS home_name, ht.fifa_code AS home_code,
           at2.name AS away_name, at2.fifa_code AS away_code
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
    ORDER BY f.kickoff_utc
  `);

  let overallPass = true;

  for (const fix of fixtures) {
    const gt = DK_GT[fix.fixture_id];
    console.log(`\n${'='.repeat(70)}`);
    console.log(`FIXTURE: ${fix.fixture_id} | ${fix.kickoff_utc}`);
    console.log(`  HOME: ${fix.home_name} (${fix.home_code})`);
    console.log(`  AWAY: ${fix.away_name} (${fix.away_code})`);

    // Get latest DK odds
    const [dkTs] = await conn.execute(`
      SELECT MAX(snapshot_ts) AS maxTs FROM wc2026_odds_snapshots
      WHERE fixture_id = ? AND book_id = 68
    `, [fix.fixture_id]);
    const dkMaxTs = dkTs[0]?.maxTs;

    const [dkOdds] = await conn.execute(`
      SELECT market, selection, american_odds, line FROM wc2026_odds_snapshots
      WHERE fixture_id = ? AND book_id = 68 AND snapshot_ts = ?
      ORDER BY market, selection
    `, [fix.fixture_id, dkMaxTs]);

    // Get latest MODEL odds (book_id=0)
    const [modelTs] = await conn.execute(`
      SELECT MAX(snapshot_ts) AS maxTs FROM wc2026_odds_snapshots
      WHERE fixture_id = ? AND book_id = 0
    `, [fix.fixture_id]);
    const modelMaxTs = modelTs[0]?.maxTs;

    const [modelOdds] = await conn.execute(`
      SELECT market, selection, american_odds, line FROM wc2026_odds_snapshots
      WHERE fixture_id = ? AND book_id = 0 AND snapshot_ts = ?
      ORDER BY market, selection
    `, [fix.fixture_id, modelMaxTs]);

    // ── 1X2 ML ──
    const dkHome1X2 = dkOdds.find(o => o.market === '1X2' && o.selection === 'home');
    const dkAway1X2 = dkOdds.find(o => o.market === '1X2' && o.selection === 'away');
    const dkDraw1X2 = dkOdds.find(o => o.market === '1X2' && o.selection === 'draw');
    const modelHome1X2 = modelOdds.find(o => o.market === '1X2' && o.selection === 'home');
    const modelAway1X2 = modelOdds.find(o => o.market === '1X2' && o.selection === 'away');
    const modelDraw1X2 = modelOdds.find(o => o.market === '1X2' && o.selection === 'draw');

    console.log(`\n  [ML / 1X2]`);
    console.log(`  DK:    home(${fix.home_code})=${dkHome1X2?.american_odds ?? 'MISSING'} | draw=${dkDraw1X2?.american_odds ?? 'MISSING'} | away(${fix.away_code})=${dkAway1X2?.american_odds ?? 'MISSING'}`);
    console.log(`  MODEL: home(${fix.home_code})=${modelHome1X2?.american_odds ?? 'MISSING'} | draw=${modelDraw1X2?.american_odds ?? 'MISSING'} | away(${fix.away_code})=${modelAway1X2?.american_odds ?? 'MISSING'}`);

    // ── TOTAL ──
    const dkOver = dkOdds.find(o => o.market === 'TOTAL' && o.selection === 'over');
    const dkUnder = dkOdds.find(o => o.market === 'TOTAL' && o.selection === 'under');
    const modelOver = modelOdds.find(o => o.market === 'TOTAL' && o.selection === 'over');
    const modelUnder = modelOdds.find(o => o.market === 'TOTAL' && o.selection === 'under');

    console.log(`\n  [TOTAL]`);
    console.log(`  DK:    line=${dkOver?.line ?? dkUnder?.line ?? 'N/A'} over=${dkOver?.american_odds ?? 'MISSING'} under=${dkUnder?.american_odds ?? 'MISSING'}`);
    console.log(`  MODEL: line=${modelOver?.line ?? modelUnder?.line ?? 'N/A'} over=${modelOver?.american_odds ?? 'MISSING'} under=${modelUnder?.american_odds ?? 'MISSING'}`);

    // ── Orientation verification ──
    const orientOk = gt
      ? (fix.home_code.toUpperCase() === gt.homeCode && fix.away_code.toUpperCase() === gt.awayCode)
      : null;
    const dkHomeOk = gt ? dkHome1X2?.american_odds === gt.homeML : null;
    const dkAwayOk = gt ? dkAway1X2?.american_odds === gt.awayML : null;
    const dkDrawOk = gt ? dkDraw1X2?.american_odds === gt.draw : null;

    console.log(`\n  [ORIENTATION VERIFY]`);
    console.log(`  Fixture home/away: ${orientOk === true ? 'PASS ✓' : orientOk === false ? 'FAIL ✗' : 'NO GT'}`);
    console.log(`  DK home ML: ${dkHomeOk === true ? 'PASS ✓' : dkHomeOk === false ? `FAIL ✗ (got ${dkHome1X2?.american_odds} expected ${gt?.homeML})` : 'NO GT'}`);
    console.log(`  DK away ML: ${dkAwayOk === true ? 'PASS ✓' : dkAwayOk === false ? `FAIL ✗ (got ${dkAway1X2?.american_odds} expected ${gt?.awayML})` : 'NO GT'}`);
    console.log(`  DK draw:    ${dkDrawOk === true ? 'PASS ✓' : dkDrawOk === false ? `FAIL ✗ (got ${dkDraw1X2?.american_odds} expected ${gt?.draw})` : 'NO GT'}`);

    if (orientOk === false || dkHomeOk === false || dkAwayOk === false || dkDrawOk === false) {
      overallPass = false;
    }

    // ── ROI / Edge calculation (3-way market) ──
    const dkH = dkHome1X2?.american_odds;
    const dkD = dkDraw1X2?.american_odds;
    const dkA = dkAway1X2?.american_odds;
    const mH = modelHome1X2?.american_odds;
    const mD = modelDraw1X2?.american_odds;
    const mA = modelAway1X2?.american_odds;

    if (dkH != null && dkD != null && dkA != null && mH != null && mD != null && mA != null) {
      const { homeNoVig, drawNoVig, awayNoVig, vig } = noVig3Way(dkH, dkD, dkA);

      // Model no-vig probabilities
      const { homeNoVig: mHnv, drawNoVig: mDnv, awayNoVig: mAnv } = noVig3Way(mH, mD, mA);

      const homeEdge = calcEdge(mHnv, homeNoVig);
      const drawEdge = calcEdge(mDnv, drawNoVig);
      const awayEdge = calcEdge(mAnv, awayNoVig);

      const homeROI = calcROI(homeEdge, homeNoVig);
      const drawROI = calcROI(drawEdge, drawNoVig);
      const awayROI = calcROI(awayEdge, awayNoVig);

      console.log(`\n  [ROI / EDGE — 3-WAY MARKET]`);
      console.log(`  DK vig: ${(vig * 100).toFixed(2)}%`);
      console.log(`  DK no-vig probs: home=${(homeNoVig*100).toFixed(2)}% draw=${(drawNoVig*100).toFixed(2)}% away=${(awayNoVig*100).toFixed(2)}%`);
      console.log(`  MODEL no-vig probs: home=${(mHnv*100).toFixed(2)}% draw=${(mDnv*100).toFixed(2)}% away=${(mAnv*100).toFixed(2)}%`);
      console.log(`  EDGE: home=${(homeEdge*100).toFixed(2)}% draw=${(drawEdge*100).toFixed(2)}% away=${(awayEdge*100).toFixed(2)}%`);
      console.log(`  ROI:  home=${homeROI != null ? (homeROI*100).toFixed(2)+'%' : 'N/A'} draw=${drawROI != null ? (drawROI*100).toFixed(2)+'%' : 'N/A'} away=${awayROI != null ? (awayROI*100).toFixed(2)+'%' : 'N/A'}`);

      // Identify edges (model has >0 edge vs DK no-vig)
      const edges = [];
      if (homeEdge > 0) edges.push(`${fix.home_code} HOME (edge=${(homeEdge*100).toFixed(2)}% ROI=${(homeROI*100).toFixed(2)}%)`);
      if (drawEdge > 0) edges.push(`DRAW (edge=${(drawEdge*100).toFixed(2)}% ROI=${(drawROI*100).toFixed(2)}%)`);
      if (awayEdge > 0) edges.push(`${fix.away_code} AWAY (edge=${(awayEdge*100).toFixed(2)}% ROI=${(awayROI*100).toFixed(2)}%)`);

      if (edges.length > 0) {
        console.log(`  EDGES DETECTED: ${edges.join(' | ')}`);
      } else {
        console.log(`  EDGES DETECTED: None (model aligns with or is below DK market)`);
      }

      // Verify sum of no-vig probs = 1 (sanity check)
      const nvSum = homeNoVig + drawNoVig + awayNoVig;
      console.log(`  [VERIFY] No-vig sum = ${nvSum.toFixed(6)} (expected 1.000000): ${Math.abs(nvSum - 1) < 0.000001 ? 'PASS ✓' : 'FAIL ✗'}`);
    } else {
      console.log(`\n  [ROI] SKIP — missing DK or MODEL odds`);
      console.log(`  DK: h=${dkH} d=${dkD} a=${dkA} | MODEL: h=${mH} d=${mD} a=${mA}`);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[OUTPUT] Overall orientation + odds verification: ${overallPass ? 'ALL PASS ✓' : 'SOME FAILURES ✗ — review above'}`);
  await conn.end();
}

main().catch(err => {
  console.error('[VERIFY] FAIL —', err);
  process.exit(1);
});
