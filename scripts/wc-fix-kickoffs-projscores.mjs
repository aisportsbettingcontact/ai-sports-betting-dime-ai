/**
 * WC2026 June 24 — Fix kickoff times and projected scores
 * 
 * Kickoff corrections (EDT = UTC-4):
 *   wc26-g-049: CAN@SUI  — 3:00PM EDT = 19:00 UTC ✅ already correct
 *   wc26-g-050: QAT@BIH  — 3:00PM EDT = 19:00 UTC (DB has 01:00 UTC next day → WRONG)
 *   wc26-g-051: BRA@SCO  — 6:00PM EDT = 22:00 UTC (DB has 01:00 UTC next day → WRONG)
 *   wc26-g-052: HAI@MAR  — 6:00PM EDT = 22:00 UTC (DB has 19:00 UTC → WRONG)
 *   wc26-g-053: MEX@CZE  — 9:00PM EDT = 01:00 UTC June 25 (was incorrectly set to 22:00 UTC → FIXED Jun 24 2026)
 *   wc26-g-054: KOR@RSA  — 9:00PM EDT = 01:00 UTC June 25 (DB has 22:00 UTC → WRONG)
 *
 * Projected scores: use book NV probs + bisection to derive lambdas, then use raw lambda sum
 * as projTotal (not rounded to .5), and derive individual scores from lambda ratio.
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── STEP 1: Fix kickoff times ──────────────────────────────────────────────
console.log('[FIX] === STEP 1: FIXING KICKOFF TIMES ===');

// Correct UTC kickoffs for June 24 EDT games:
// 3PM EDT = 19:00 UTC same day
// 6PM EDT = 22:00 UTC same day  
// 9PM EDT = 01:00 UTC next day (June 25)
const kickoffFixes = [
  { id: 'wc26-g-050', utc: '2026-06-24 19:00:00', label: 'QAT@BIH 3PM EDT' },
  { id: 'wc26-g-051', utc: '2026-06-24 22:00:00', label: 'BRA@SCO 6PM EDT' },
  { id: 'wc26-g-052', utc: '2026-06-24 22:00:00', label: 'HAI@MAR 6PM EDT' },
  { id: 'wc26-g-053', utc: '2026-06-25 01:00:00', label: 'MEX@CZE 9PM EDT' },
  { id: 'wc26-g-054', utc: '2026-06-25 01:00:00', label: 'KOR@RSA 9PM EDT' },
];

for (const fix of kickoffFixes) {
  const [result] = await conn.query(
    'UPDATE wc2026_fixtures SET kickoff_utc = ? WHERE fixture_id = ?',
    [fix.utc, fix.id]
  );
  const ok = result.affectedRows === 1;
  console.log(`[FIX] ${ok ? '✅' : '❌'} ${fix.id} (${fix.label}): kickoff_utc → ${fix.utc}`);
}

// ── STEP 2: Verify kickoff times ──────────────────────────────────────────
console.log('\n[FIX] === STEP 2: VERIFYING KICKOFF TIMES ===');
const [fixtures] = await conn.query(`
  SELECT f.fixture_id, f.kickoff_utc,
    ht.fifa_code AS home_code, at.fifa_code AS away_code
  FROM wc2026_fixtures f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.match_date = '2026-06-24'
  ORDER BY f.kickoff_utc
`);

const expectedOrder = [
  { id: 'wc26-g-049', edtHour: 15 },
  { id: 'wc26-g-050', edtHour: 15 },
  { id: 'wc26-g-051', edtHour: 18 },
  { id: 'wc26-g-052', edtHour: 18 },
  { id: 'wc26-g-053', edtHour: 21 },
  { id: 'wc26-g-054', edtHour: 21 },
];

for (const f of fixtures) {
  const kickoffUTC = new Date(f.kickoff_utc);
  const edtHour = (kickoffUTC.getUTCHours() - 4 + 24) % 24;
  const edtMin = kickoffUTC.getUTCMinutes();
  const edtStr = `${String(edtHour).padStart(2,'0')}:${String(edtMin).padStart(2,'0')}EDT`;
  console.log(`[FIX] ${f.fixture_id}: ${f.away_code}@${f.home_code} kickoff=${edtStr}`);
}

// ── STEP 3: Fix projected scores ──────────────────────────────────────────
console.log('\n[FIX] === STEP 3: FIXING PROJECTED SCORES ===');

/**
 * Poisson PMF: P(X=k | lambda)
 */
function poissonPMF(lambda, k) {
  if (k < 0) return 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Compute P(home wins), P(draw), P(away wins) from Poisson(lambdaH, lambdaA)
 * Max goals = 10 per team (sufficient for soccer)
 */
function computeMatchProbs(lambdaH, lambdaA, maxGoals = 10) {
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const ph = poissonPMF(lambdaH, h);
    for (let a = 0; a <= maxGoals; a++) {
      const pa = poissonPMF(lambdaA, a);
      const joint = ph * pa;
      if (h > a) pH += joint;
      else if (h === a) pD += joint;
      else pA += joint;
    }
  }
  return { pH, pD, pA };
}

/**
 * Convert American odds to no-vig probability
 * Returns raw implied probability (not no-vig adjusted)
 */
function americanToImplied(american) {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/**
 * Remove vig from 3-way market (home, draw, away)
 * Returns { nvHome, nvDraw, nvAway } summing to 1.0
 */
function removeVig3Way(mlHome, mlDraw, mlAway) {
  const iH = americanToImplied(mlHome);
  const iD = americanToImplied(mlDraw);
  const iA = americanToImplied(mlAway);
  const total = iH + iD + iA;
  return { nvHome: iH/total, nvDraw: iD/total, nvAway: iA/total };
}

/**
 * Derive (lambdaH, lambdaA) from no-vig win probs and total line
 * Uses bisection on ratio r = lambdaH/lambdaA with lambdaH + lambdaA = totalLine
 * Objective: P(home wins | lambdaH, lambdaA) = nvHome
 */
function deriveLambdas(nvHome, totalLine) {
  // r = lambdaH / lambdaA, lambdaH = r*lambdaA, lambdaH + lambdaA = T
  // → lambdaA = T / (1+r), lambdaH = T * r / (1+r)
  let lo = 0.01, hi = 50.0;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const lambdaA = totalLine / (1 + mid);
    const lambdaH = totalLine * mid / (1 + mid);
    const { pH } = computeMatchProbs(lambdaH, lambdaA);
    if (pH < nvHome) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-8) break;
  }
  const r = (lo + hi) / 2;
  const lambdaA = totalLine / (1 + r);
  const lambdaH = totalLine * r / (1 + r);
  return { lambdaH, lambdaA };
}

/**
 * Run Monte Carlo simulation to get mean scores
 * Uses Poisson random variate generation (Knuth's algorithm)
 */
function poissonRandom(lambda, rng) {
  // Knuth's algorithm
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

/**
 * Simple seeded LCG random number generator for reproducibility
 */
function makeLCG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Run N simulations and return mean home/away scores
 */
function simulateMeanScores(lambdaH, lambdaA, N = 100000, seed = 42) {
  const rng = makeLCG(seed);
  let sumH = 0, sumA = 0;
  for (let i = 0; i < N; i++) {
    sumH += poissonRandom(lambdaH, rng);
    sumA += poissonRandom(lambdaA, rng);
  }
  return { meanH: sumH / N, meanA: sumA / N };
}

// Ground truth book odds for lambda derivation
const fixtures24 = [
  { id: 'wc26-g-049', away: 'CAN', home: 'SUI', mlAway: 240, mlHome: 135, mlDraw: 210, totalLine: 2.5 },
  { id: 'wc26-g-050', away: 'QAT', home: 'BIH', mlAway: 600, mlHome: -240, mlDraw: 400, totalLine: 2.5 },
  { id: 'wc26-g-051', away: 'BRA', home: 'SCO', mlAway: -265, mlHome: 700, mlDraw: 425, totalLine: 2.5 },
  { id: 'wc26-g-052', away: 'HAI', home: 'MAR', mlAway: 1400, mlHome: -500, mlDraw: 600, totalLine: 3.5 },
  { id: 'wc26-g-053', away: 'MEX', home: 'CZE', mlAway: -105, mlHome: 265, mlDraw: 285, totalLine: 2.5 },
  { id: 'wc26-g-054', away: 'KOR', home: 'RSA', mlAway: -150, mlHome: 425, mlDraw: 295, totalLine: 2.5 },
];

for (const f of fixtures24) {
  // Step A: Remove vig from 3-way market
  // NOTE: mlHome/mlAway in DB are stored as home=SUI, away=CAN
  // The fixture home_team is SUI (home), away_team is CAN (away)
  const { nvHome, nvDraw, nvAway } = removeVig3Way(f.mlHome, f.mlDraw, f.mlAway);
  
  console.log(`[FIX] ${f.id} (${f.away}@${f.home}):`);
  console.log(`  [STATE] nvHome=${nvHome.toFixed(4)} nvDraw=${nvDraw.toFixed(4)} nvAway=${nvAway.toFixed(4)} sum=${(nvHome+nvDraw+nvAway).toFixed(6)}`);
  
  // Step B: Derive lambdas via bisection
  const { lambdaH, lambdaA } = deriveLambdas(nvHome, f.totalLine);
  console.log(`  [STATE] lambdaH(home)=${lambdaH.toFixed(4)} lambdaA(away)=${lambdaA.toFixed(4)} sum=${(lambdaH+lambdaA).toFixed(4)}`);
  
  // Step C: Verify derived lambdas reproduce win probs
  const { pH, pD, pA } = computeMatchProbs(lambdaH, lambdaA);
  console.log(`  [VERIFY] Poisson probs: pH=${pH.toFixed(4)} pD=${pD.toFixed(4)} pA=${pA.toFixed(4)} (target nvHome=${nvHome.toFixed(4)})`);
  const pHOk = Math.abs(pH - nvHome) < 0.005;
  console.log(`  [VERIFY] lambdaH calibration: ${pHOk ? '✅ PASS' : '❌ FAIL'} (diff=${Math.abs(pH-nvHome).toFixed(5)})`);
  
  // Step D: Run 100K simulations to get mean scores
  const { meanH, meanA } = simulateMeanScores(lambdaH, lambdaA, 100000, 42 + fixtures24.indexOf(f));
  const projTotal = meanH + meanA;
  
  console.log(`  [STATE] Monte Carlo 100K: meanH=${meanH.toFixed(4)} meanA=${meanA.toFixed(4)} projTotal=${projTotal.toFixed(4)}`);
  
  // Step E: Verify projTotal is not exactly 2.5 or 3.5
  const isRound = projTotal === 2.5 || projTotal === 3.5 || Number.isInteger(projTotal);
  console.log(`  [VERIFY] projTotal=${projTotal.toFixed(4)} ${isRound ? '❌ ROUND' : '✅ DECIMAL'}`);
  
  // Step F: Update projection row
  const [result] = await conn.query(`
    UPDATE wc2026_model_projections 
    SET proj_home_score = ?, proj_away_score = ?, proj_total = ?
    WHERE fixture_id = ?
    ORDER BY modeled_at DESC
    LIMIT 1
  `, [
    parseFloat(meanH.toFixed(4)),
    parseFloat(meanA.toFixed(4)),
    parseFloat(projTotal.toFixed(4)),
    f.id
  ]);
  
  console.log(`  [OUTPUT] Updated: projHome=${meanH.toFixed(4)} projAway=${meanA.toFixed(4)} projTotal=${projTotal.toFixed(4)} | rows=${result.affectedRows}`);
}

await conn.end();
console.log('\n[FIX] ===== KICKOFF + PROJECTED SCORES FIX COMPLETE =====\n');
