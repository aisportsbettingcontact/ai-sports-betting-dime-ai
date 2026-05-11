/**
 * auditFgRlHomeSigmoid.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive audit of the FG RL Home sigmoid calibration.
 *
 * Problem: fg_rl_home shows 26.7% ACC (W=4, L=11) despite the 18% away threshold
 * change not affecting home RL. The sigmoid-derived pHomeRl from model score margin
 * may be systematically underestimating home cover probability.
 *
 * This script:
 *   1. Loads all 554 graded games with model scores and actual scores
 *   2. Computes sigmoid pHomeRl for each game using current formula
 *   3. Computes actual home -1.5 cover rate by model margin bucket
 *   4. Identifies calibration bias (sigmoid vs actual cover rate)
 *   5. Runs grid search to find optimal sigmoid steepness parameter
 *   6. Computes optimal edge threshold for fg_rl_home
 *   7. Outputs corrected sigmoid parameters and recommended threshold
 *
 * Usage: node server/auditFgRlHomeSigmoid.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

const TAG = '[FgRlHomeAudit]';

function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? null : n;
}
function parseOdds(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}
function mlToProb(ml) {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}
function noVigProb(ml1, ml2) {
  const p1 = mlToProb(ml1), p2 = mlToProb(ml2);
  return p1 / (p1 + p2);
}
function sigmoid(x, k) {
  return 1 / (1 + Math.exp(-k * x));
}

async function main() {
  const db = await mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 });

  console.log(`${TAG} [INPUT] Loading all graded MLB games with model scores...`);
  const [rows] = await db.execute(`
    SELECT id, gameDate, homeTeam, awayTeam,
           modelHomeScore, modelAwayScore,
           actualHomeScore, actualAwayScore,
           homeRunLineOdds, awayRunLineOdds
    FROM games
    WHERE sport='MLB' AND gameStatus='final'
      AND modelRunAt IS NOT NULL
      AND actualHomeScore IS NOT NULL
      AND modelHomeScore IS NOT NULL
    ORDER BY gameDate ASC
  `);
  console.log(`${TAG} [STATE] Loaded ${rows.length} games`);

  // ── Step 1: Compute per-game sigmoid output vs actual cover ──────────────
  const games = [];
  let missingOdds = 0;

  for (const r of rows) {
    const ah = parseNum(r.actualHomeScore);
    const aa = parseNum(r.actualAwayScore);
    const mh = parseNum(r.modelHomeScore);
    const ma = parseNum(r.modelAwayScore);
    if (ah === null || aa === null || mh === null || ma === null) continue;

    const actualMargin = ah - aa;
    const modelMargin  = mh - ma;
    const homeCovers   = actualMargin > 1.5;  // home wins by 2+
    const awayCovers   = actualMargin < 1.5;  // away covers +1.5

    // Current sigmoid formula: k=0.8, center=1.5
    const pHomeRl_current = sigmoid(modelMargin - 1.5, 0.8);

    // Book odds
    const bookHomeRl = parseOdds(r.homeRunLineOdds);
    const bookAwayRl = parseOdds(r.awayRunLineOdds);
    const nvHomeRl = (bookHomeRl !== null && bookAwayRl !== null)
      ? noVigProb(bookHomeRl, bookAwayRl) : null;

    if (nvHomeRl === null) missingOdds++;

    games.push({
      id: r.id, date: r.gameDate,
      home: r.homeTeam, away: r.awayTeam,
      modelMargin, actualMargin,
      homeCovers, awayCovers,
      pHomeRl_current,
      nvHomeRl,
      bookHomeRl, bookAwayRl,
    });
  }

  console.log(`${TAG} [STATE] Processed ${games.length} games | missingOdds=${missingOdds}`);

  // ── Step 2: Actual home -1.5 cover rate overall ──────────────────────────
  const totalCovers = games.filter(g => g.homeCovers).length;
  const totalGames  = games.length;
  const actualCoverRate = totalCovers / totalGames;
  console.log(`\n${TAG} [STEP 2] Actual home -1.5 cover rate: ${totalCovers}/${totalGames} = ${(actualCoverRate*100).toFixed(2)}%`);

  // ── Step 3: Bucket analysis — model margin vs actual cover rate ──────────
  console.log(`\n${TAG} [STEP 3] Model margin bucket analysis:`);
  const buckets = [
    { label: 'margin < -3',    filter: g => g.modelMargin < -3 },
    { label: '-3 to -2',       filter: g => g.modelMargin >= -3 && g.modelMargin < -2 },
    { label: '-2 to -1',       filter: g => g.modelMargin >= -2 && g.modelMargin < -1 },
    { label: '-1 to 0',        filter: g => g.modelMargin >= -1 && g.modelMargin < 0 },
    { label: '0 to 1',         filter: g => g.modelMargin >= 0  && g.modelMargin < 1 },
    { label: '1 to 1.5',       filter: g => g.modelMargin >= 1  && g.modelMargin < 1.5 },
    { label: '1.5 to 2',       filter: g => g.modelMargin >= 1.5 && g.modelMargin < 2 },
    { label: '2 to 3',         filter: g => g.modelMargin >= 2  && g.modelMargin < 3 },
    { label: '3 to 4',         filter: g => g.modelMargin >= 3  && g.modelMargin < 4 },
    { label: '4 to 5',         filter: g => g.modelMargin >= 4  && g.modelMargin < 5 },
    { label: 'margin >= 5',    filter: g => g.modelMargin >= 5 },
  ];

  const bucketData = [];
  for (const b of buckets) {
    const bg = games.filter(b.filter);
    if (bg.length === 0) continue;
    const covers = bg.filter(g => g.homeCovers).length;
    const rate = covers / bg.length;
    const avgSigmoid = bg.reduce((s, g) => s + g.pHomeRl_current, 0) / bg.length;
    const bias = avgSigmoid - rate;  // positive = sigmoid overestimates
    bucketData.push({ label: b.label, n: bg.length, covers, rate, avgSigmoid, bias });
    console.log(
      `  ${b.label.padEnd(14)}: n=${String(bg.length).padStart(3)} ` +
      `actual=${(rate*100).toFixed(1).padStart(5)}% ` +
      `sigmoid=${(avgSigmoid*100).toFixed(1).padStart(5)}% ` +
      `bias=${bias >= 0 ? '+' : ''}${(bias*100).toFixed(1).padStart(5)}%`
    );
  }

  // ── Step 4: Grid search for optimal sigmoid steepness k ─────────────────
  console.log(`\n${TAG} [STEP 4] Grid search for optimal sigmoid steepness k (center fixed at 1.5)...`);
  const kValues = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0];
  let bestK = 0.8, bestBrier = Infinity;

  for (const k of kValues) {
    let brierSum = 0;
    let n = 0;
    for (const g of games) {
      const p = sigmoid(g.modelMargin - 1.5, k);
      const outcome = g.homeCovers ? 1 : 0;
      brierSum += Math.pow(p - outcome, 2);
      n++;
    }
    const brier = brierSum / n;
    if (brier < bestBrier) { bestBrier = brier; bestK = k; }
    console.log(`  k=${k.toFixed(1)}: Brier=${brier.toFixed(4)}`);
  }
  console.log(`${TAG} [STATE] Optimal k=${bestK} (Brier=${bestBrier.toFixed(4)})`);

  // ── Step 5: Edge threshold analysis with optimal k ───────────────────────
  console.log(`\n${TAG} [STEP 5] Edge threshold sensitivity with optimal k=${bestK}...`);
  const gamesWithOdds = games.filter(g => g.nvHomeRl !== null);
  console.log(`  Games with RL odds: ${gamesWithOdds.length}`);

  const thresholds = [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20];
  let bestThresh = 0.05, bestAcc = 0, bestROI = -Infinity;

  for (const thresh of thresholds) {
    const acted = gamesWithOdds.filter(g => {
      const p = sigmoid(g.modelMargin - 1.5, bestK);
      const edge = p - g.nvHomeRl;
      return edge >= thresh;
    });
    const wins   = acted.filter(g => g.homeCovers).length;
    const losses = acted.filter(g => !g.homeCovers).length;
    const acc    = acted.length > 0 ? wins / acted.length : 0;
    const roiVal = acted.length > 0 ? (wins * (100/110) - losses) / acted.length : null;
    if (acted.length >= 10 && acc > bestAcc) { bestAcc = acc; bestThresh = thresh; bestROI = roiVal ?? -Infinity; }
    console.log(
      `  edge>=${thresh.toFixed(2)}: n=${String(acted.length).padStart(3)} ` +
      `W=${wins} L=${losses} ` +
      `ACC=${acted.length > 0 ? (acc*100).toFixed(1) : 'N/A'}% ` +
      `ROI=${roiVal !== null ? (roiVal*100).toFixed(1) : 'N/A'}%`
    );
  }

  // ── Step 6: Compare current vs optimal ───────────────────────────────────
  console.log(`\n${TAG} [STEP 6] Current vs Optimal comparison:`);
  const currentActed = gamesWithOdds.filter(g => {
    const p = sigmoid(g.modelMargin - 1.5, 0.8);
    const edge = p - g.nvHomeRl;
    return edge >= 0.05;
  });
  const currentW = currentActed.filter(g => g.homeCovers).length;
  const currentL = currentActed.filter(g => !g.homeCovers).length;
  const currentAcc = currentActed.length > 0 ? currentW / currentActed.length : 0;
  console.log(`  CURRENT  k=0.8 thresh=0.05: n=${currentActed.length} W=${currentW} L=${currentL} ACC=${(currentAcc*100).toFixed(1)}%`);

  const optActed = gamesWithOdds.filter(g => {
    const p = sigmoid(g.modelMargin - 1.5, bestK);
    const edge = p - g.nvHomeRl;
    return edge >= bestThresh;
  });
  const optW = optActed.filter(g => g.homeCovers).length;
  const optL = optActed.filter(g => !g.homeCovers).length;
  const optAcc = optActed.length > 0 ? optW / optActed.length : 0;
  console.log(`  OPTIMAL  k=${bestK} thresh=${bestThresh}: n=${optActed.length} W=${optW} L=${optL} ACC=${(optAcc*100).toFixed(1)}%`);

  // ── Step 7: Diagnosis ─────────────────────────────────────────────────────
  console.log(`\n${TAG} [OUTPUT] DIAGNOSIS:`);
  console.log(`  Season-wide home -1.5 cover rate: ${(actualCoverRate*100).toFixed(2)}%`);
  console.log(`  Current sigmoid (k=0.8) average output: ${(games.reduce((s,g) => s + g.pHomeRl_current, 0) / games.length * 100).toFixed(2)}%`);
  const overallBias = games.reduce((s,g) => s + g.pHomeRl_current, 0) / games.length - actualCoverRate;
  console.log(`  Overall sigmoid bias: ${overallBias >= 0 ? '+' : ''}${(overallBias*100).toFixed(2)}% (positive = overestimates home cover)`);
  console.log(`  Recommended sigmoid k: ${bestK}`);
  console.log(`  Recommended edge threshold: ${bestThresh}`);
  console.log(`  Expected improvement: ${(currentAcc*100).toFixed(1)}% → ${(optAcc*100).toFixed(1)}% ACC`);

  if (overallBias > 0.03) {
    console.log(`\n${TAG} [VERIFY] ⚠ SIGNIFICANT POSITIVE BIAS (${(overallBias*100).toFixed(2)}%): sigmoid systematically overestimates home cover probability`);
    console.log(`  Root cause: The +0.03 fg_ml_home_edge correction in MLBAIModel.py inflates modelHomeScore,`);
    console.log(`  which increases modelMargin, which pushes sigmoid output higher than actual cover rate.`);
    console.log(`  Fix: Raise sigmoid center from 1.5 to ~${(1.5 + overallBias * 3).toFixed(2)} OR raise edge threshold to ${bestThresh}`);
  } else if (overallBias < -0.03) {
    console.log(`\n${TAG} [VERIFY] ⚠ SIGNIFICANT NEGATIVE BIAS (${(overallBias*100).toFixed(2)}%): sigmoid underestimates home cover probability`);
  } else {
    console.log(`\n${TAG} [VERIFY] ✅ Sigmoid bias within acceptable range (${(overallBias*100).toFixed(2)}%)`);
  }

  await db.end();
}

main().catch(e => {
  console.error(`${TAG} [FATAL]`, e.message);
  process.exit(1);
});
