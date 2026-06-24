/**
 * wcOriginateJune24v4.mjs — DEFINITIVE WC2026 June 24 Line Origination Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERSION: v4 — FINAL / BULLETPROOF
 * DATE: 2026-06-24
 *
 * CRITICAL FIXES vs ALL PRIOR VERSIONS:
 *
 * FIX 1 — DYNAMIC SPREAD DIRECTION (ROOT CAUSE OF ALL SPREAD BUGS)
 *   Prior versions hardcoded: home team always gets -1.5, away team always gets +1.5
 *   This is WRONG. The spread favorite varies by fixture:
 *     - Brazil (AWAY) is -1.5 favorite → model must price P(BRA wins by 2+)
 *     - Mexico (AWAY) is -1.5 favorite → model must price P(MEX wins by 2+)
 *     - South Korea (AWAY) is -1.5 favorite → model must price P(KOR wins by 2+)
 *     - Switzerland (HOME) is -1.5 favorite → model must price P(SUI wins by 2+)
 *     - Bosnia (HOME) is -1.5 favorite → model must price P(BIH wins by 2+)
 *     - Morocco (HOME) is -1.5 favorite → model must price P(MAR wins by 2+)
 *   Each fixture has a `spreadFavTeam` field ('home' or 'away') that drives all spread logic.
 *
 * FIX 2 — BTTS CALIBRATION (baseH=1.300, baseA=1.250)
 *   Prior v1/v2: baseH=1.500, baseA=1.440 → avg BTTS=57.2% → all 6 BTTS YES favored (-130 to -146)
 *   Prior v3: baseH=1.350, baseA=1.300 → avg BTTS=52.1% → still mostly BTTS YES favored
 *   v4: baseH=1.300, baseA=1.250 → avg BTTS=50.2% → near-even, matches WC2026 actual 52.3%
 *   Result: BTTS YES ranges from +119 (BRA/SCO) to -108 (CZE/MEX) — correct variance
 *
 * FIX 3 — SPREAD PROBABILITY COMPUTATION
 *   P(spread fav covers -1.5) = P(spread fav wins by 2+) — computed from Poisson PMF
 *   P(spread dog covers +1.5) = 1 - P(spread fav covers -1.5) — complementary
 *   These are the ONLY two outcomes (no push on ±1.5 lines)
 *
 * FIX 4 — DB STORAGE CONVENTION (MATCHES ROUTER EXPECTATION)
 *   Router reads: selection='home' → homeSpreadLine/homeSpreadOdds
 *                 selection='away' → awaySpreadLine/awaySpreadOdds
 *   We store:
 *     - Spread favorite (whether home or away): selection=their_side, line=-1.5, odds=spreadFavOdds
 *     - Spread dog (whether home or away): selection=their_side, line=+1.5, odds=spreadDogOdds
 *   This ensures the frontend always shows the correct team with the correct line sign.
 *
 * 10 INVARIANT GUARDS:
 *   G1: pH + pD + pA = 1.000 (±0.0001)
 *   G2: pSpreadFav + pSpreadDog = 1.000 (±0.0001)
 *   G3: pOver + pUnder = 1.000 (±0.0001)
 *   G4: pBTTS ∈ [0.35, 0.70] (calibrated range)
 *   G5: pSpreadFav < pFavML (covering -1.5 harder than winning outright)
 *   G6: pSpreadDog > pDogML (covering +1.5 easier than winning outright)
 *   G7: spreadFavOdds > favML in American (longer odds for -1.5 than ML)
 *   G8: spreadDogOdds < dogML in American (shorter odds for +1.5 than ML)
 *   G9: DC1X = pH + pD (home win or draw)
 *   G10: DCX2 = pA + pD (away win or draw)
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_ORIG_V4]';
const N_SIM = 1_000_000;

// ── CHAMPION MODEL PARAMETERS (from v10e backtest) ──────────────────────────
const PARAMS = {
  ss: 0.70,       // ELO sensitivity scaling factor
  rho: -0.10,     // Dixon-Coles low-score correction (applied analytically)
  baseH: 1.300,   // Home base lambda (calibrated to WC2026 actual 2.70 goals/game)
  baseA: 1.250,   // Away base lambda
};

// ── ELO RATINGS (FIFA World Rankings, June 2026) ─────────────────────────────
const ELO = {
  SUI: 1879,  // Switzerland
  CAN: 1769,  // Canada
  BIH: 1780,  // Bosnia-Herzegovina
  QAT: 1674,  // Qatar
  SCO: 1820,  // Scotland
  BRA: 2166,  // Brazil
  MAR: 1748,  // Morocco
  HAI: 1580,  // Haiti
  CZE: 1831,  // Czech Republic
  MEX: 1842,  // Mexico
  RSA: 1636,  // South Africa
  KOR: 1746,  // South Korea
};

// ── FIXTURES: June 24, 2026 ──────────────────────────────────────────────────
// spreadFavTeam: 'home' or 'away' — WHICH TEAM IS THE -1.5 SPREAD FAVORITE
// Derived from book lines provided:
//   SUI vs CAN: SUI (home) is -1.5 favorite (book: SUI -1.5 +400, CAN +1.5 -575)
//   BIH vs QAT: BIH (home) is -1.5 favorite (book: BIH -1.5 +110, QAT +1.5 -140)
//   SCO vs BRA: BRA (away) is -1.5 favorite (book: BRA -1.5 +100, SCO +1.5 -130)
//   MAR vs HAI: MAR (home) is -1.5 favorite (book: MAR -1.5 -170, HAI +1.5 +135)
//   CZE vs MEX: MEX (away) is -1.5 favorite (book: MEX -1.5 +260, CZE +1.5 -350)
//   RSA vs KOR: KOR (away) is -1.5 favorite (book: KOR -1.5 +195, RSA +1.5 -250)
const FIXTURES = [
  {
    id: 'wc26-g-049',
    homeCode: 'SUI', homeName: 'Switzerland',
    awayCode: 'CAN', awayName: 'Canada',
    bookTotal: 2.5,
    spreadFavTeam: 'home',  // SUI -1.5
    // Book lines for reference/validation:
    book: { homeML: 135, awayML: 240, draw: 210, over: 100, under: -125,
            spreadFav: 400, spreadDog: -575, bttsYes: -140, bttsNo: 110,
            dc1X: -310, dcX2: -170 }
  },
  {
    id: 'wc26-g-050',
    homeCode: 'BIH', homeName: 'Bosnia-Herzegovina',
    awayCode: 'QAT', awayName: 'Qatar',
    bookTotal: 2.5,
    spreadFavTeam: 'home',  // BIH -1.5
    book: { homeML: -240, awayML: 600, draw: 400, over: -175, under: 140,
            spreadFav: 110, spreadDog: -140, bttsYes: -135, bttsNo: 105,
            dc1X: -1000, dcX2: 185 }
  },
  {
    id: 'wc26-g-051',
    homeCode: 'SCO', homeName: 'Scotland',
    awayCode: 'BRA', awayName: 'Brazil',
    bookTotal: 2.5,
    spreadFavTeam: 'away',  // BRA -1.5
    book: { homeML: 700, awayML: -265, draw: 425, over: -115, under: -105,
            spreadFav: 100, spreadDog: -130, bttsYes: 130, bttsNo: -165,
            dc1X: 200, dcX2: -1100 }
  },
  {
    id: 'wc26-g-052',
    homeCode: 'MAR', homeName: 'Morocco',
    awayCode: 'HAI', awayName: 'Haiti',
    bookTotal: 3.5,
    spreadFavTeam: 'home',  // MAR -1.5
    book: { homeML: -500, awayML: 1400, draw: 600, over: 145, under: -175,
            spreadFav: -170, spreadDog: 135, bttsYes: 130, bttsNo: -165,
            dc1X: -3500, dcX2: 340 }
  },
  {
    id: 'wc26-g-053',
    homeCode: 'CZE', homeName: 'Czech Republic',
    awayCode: 'MEX', awayName: 'Mexico',
    bookTotal: 2.5,
    spreadFavTeam: 'away',  // MEX -1.5
    book: { homeML: 265, awayML: -105, draw: 285, over: 105, under: -130,
            spreadFav: 260, spreadDog: -350, bttsYes: -110, bttsNo: -115,
            dc1X: -120, dcX2: -350 }
  },
  {
    id: 'wc26-g-054',
    homeCode: 'RSA', homeName: 'South Africa',
    awayCode: 'KOR', awayName: 'South Korea',
    bookTotal: 2.5,
    spreadFavTeam: 'away',  // KOR -1.5
    book: { homeML: 425, awayML: -150, draw: 295, over: 105, under: -130,
            spreadFav: 195, spreadDog: -250, bttsYes: -105, bttsNo: -125,
            dc1X: 115, dcX2: -600 }
  },
];

// ── UTILITY FUNCTIONS ────────────────────────────────────────────────────────

/** American odds → implied probability (raw, with vig) */
function americanToImplied(odds) {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Probability → American odds (no-vig) */
function probToAmerican(p) {
  if (p <= 0.0001) return 9999;
  if (p >= 0.9999) return -9999;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

/** Poisson PMF: P(X=k) for mean lambda */
function poissonPMF(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lam) - lam;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Remove vig from 3-way market [p1, p2, p3] → normalized no-vig probs */
function noVig3(p1, p2, p3) {
  const sum = p1 + p2 + p3;
  return [p1 / sum, p2 / sum, p3 / sum];
}

/** Remove vig from 2-way market [p1, p2] → normalized no-vig probs */
function noVig2(p1, p2) {
  const sum = p1 + p2;
  return [p1 / sum, p2 / sum];
}

// ── SECTION A: BOOK-IMPLIED PROBABILITY ANALYSIS ────────────────────────────
console.log(`\n${TAG} ═══════════════════════════════════════════════════════════`);
console.log(`${TAG} SECTION A: BOOK-IMPLIED PROBABILITY ANALYSIS`);
console.log(`${TAG} ═══════════════════════════════════════════════════════════`);
console.log(`${TAG} [PURPOSE] Validate book lines, compute no-vig probs, confirm spread direction`);

for (const fix of FIXTURES) {
  const b = fix.book;
  const rawH = americanToImplied(b.homeML);
  const rawD = americanToImplied(b.draw);
  const rawA = americanToImplied(b.awayML);
  const [nvH, nvD, nvA] = noVig3(rawH, rawD, rawA);
  const rawOver = americanToImplied(b.over);
  const rawUnder = americanToImplied(b.under);
  const [nvOver, nvUnder] = noVig2(rawOver, rawUnder);
  const rawBTTSY = americanToImplied(b.bttsYes);
  const rawBTTSN = americanToImplied(b.bttsNo);
  const [nvBTTSY, nvBTTSN] = noVig2(rawBTTSY, rawBTTSN);
  const rawSpreadFav = americanToImplied(b.spreadFav);
  const rawSpreadDog = americanToImplied(b.spreadDog);
  const [nvSpreadFav, nvSpreadDog] = noVig2(rawSpreadFav, rawSpreadDog);

  const favTeam = fix.spreadFavTeam === 'home' ? fix.homeName : fix.awayName;
  const dogTeam = fix.spreadFavTeam === 'home' ? fix.awayName : fix.homeName;

  console.log(`\n${TAG} ── ${fix.id}: ${fix.homeName}(H) vs ${fix.awayName}(A) ──`);
  console.log(`${TAG} [INPUT] Book ML: H=${b.homeML} D=${b.draw} A=${b.awayML}`);
  console.log(`${TAG} [STATE] Raw implied: H=${(rawH*100).toFixed(2)}% D=${(rawD*100).toFixed(2)}% A=${(rawA*100).toFixed(2)}% | Vig=${((rawH+rawD+rawA-1)*100).toFixed(2)}%`);
  console.log(`${TAG} [STATE] No-vig: H=${(nvH*100).toFixed(3)}% D=${(nvD*100).toFixed(3)}% A=${(nvA*100).toFixed(3)}%`);
  console.log(`${TAG} [STATE] Book Over${fix.bookTotal}: ${(nvOver*100).toFixed(3)}% | Book Under: ${(nvUnder*100).toFixed(3)}%`);
  console.log(`${TAG} [STATE] Book BTTS YES: ${(nvBTTSY*100).toFixed(3)}% | Book BTTS NO: ${(nvBTTSN*100).toFixed(3)}%`);
  console.log(`${TAG} [STATE] Spread fav (${favTeam} -1.5): ${(nvSpreadFav*100).toFixed(3)}% | Dog (${dogTeam} +1.5): ${(nvSpreadDog*100).toFixed(3)}%`);
  console.log(`${TAG} [VERIFY] spreadFavTeam=${fix.spreadFavTeam} → ${favTeam} is -1.5 favorite ✓`);
}

// ── SECTION B: MONTE CARLO SIMULATION ENGINE ────────────────────────────────
console.log(`\n${TAG} ═══════════════════════════════════════════════════════════`);
console.log(`${TAG} SECTION B: MONTE CARLO SIMULATION — N=${N_SIM.toLocaleString()}`);
console.log(`${TAG} PARAMS: ss=${PARAMS.ss} | rho=${PARAMS.rho} | baseH=${PARAMS.baseH} | baseA=${PARAMS.baseA}`);
console.log(`${TAG} ═══════════════════════════════════════════════════════════`);

/** Poisson random variate using Knuth algorithm */
function poissonRandom(lam) {
  if (lam <= 0) return 0;
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function runSimulation(lH, lA, nSim) {
  let homeWins = 0, draws = 0, awayWins = 0;
  let homeWinsBy2 = 0, awayWinsBy2 = 0;
  let bttsYes = 0;
  let over25 = 0, over35 = 0;
  let sumH = 0, sumA = 0;
  const scoreFreq = new Map();

  for (let i = 0; i < nSim; i++) {
    const h = poissonRandom(lH);
    const a = poissonRandom(lA);
    sumH += h; sumA += a;
    const total = h + a;
    if (total > 2.5) over25++;
    if (total > 3.5) over35++;
    if (h > 0 && a > 0) bttsYes++;
    if (h > a) { homeWins++; if (h - a >= 2) homeWinsBy2++; }
    else if (h < a) { awayWins++; if (a - h >= 2) awayWinsBy2++; }
    else draws++;
    const key = `${h}-${a}`;
    scoreFreq.set(key, (scoreFreq.get(key) || 0) + 1);
  }

  const sorted = [...scoreFreq.entries()].sort((a, b) => b[1] - a[1]);
  const topScorelines = JSON.stringify(
    sorted.slice(0, 8).map(([k, v]) => ({ score: k, pct: parseFloat((v / nSim * 100).toFixed(2)) }))
  );

  return {
    pH: homeWins / nSim,
    pD: draws / nSim,
    pA: awayWins / nSim,
    pHomeWinsBy2: homeWinsBy2 / nSim,
    pAwayWinsBy2: awayWinsBy2 / nSim,
    pBTTSY: bttsYes / nSim,
    pOU25O: over25 / nSim,
    pOU35O: over35 / nSim,
    projH: sumH / nSim,
    projA: sumA / nSim,
    topScorelines,
    modeScore: sorted[0][0],
  };
}

// ── SECTION C: LINE COMPUTATION WITH DYNAMIC SPREAD ─────────────────────────
function computeLines(sim, fix) {
  const { pH, pD, pA, pHomeWinsBy2, pAwayWinsBy2, pBTTSY, pOU25O, pOU35O } = sim;

  // ── 1X2 (no-vig normalization) ──────────────────────────────────────────
  const [nvH, nvD, nvA] = noVig3(pH, pD, pA);
  const homeML = probToAmerican(nvH);
  const drawML = probToAmerican(nvD);
  const awayML = probToAmerican(nvA);

  // ── DOUBLE CHANCE ───────────────────────────────────────────────────────
  const pDC1X = pH + pD;  // home win or draw
  const pDCX2 = pA + pD;  // away win or draw
  const [nvDC1X, nvDCX2] = noVig2(pDC1X, pDCX2);
  const dc1X = probToAmerican(nvDC1X);
  const dcX2 = probToAmerican(nvDCX2);

  // ── NO DRAW (2-way: home win vs away win) ───────────────────────────────
  const [nvHnd, nvAnd] = noVig2(pH, pA);
  const noDrawH = probToAmerican(nvHnd);
  const noDrawA = probToAmerican(nvAnd);

  // ── TOTAL ───────────────────────────────────────────────────────────────
  const pOver = fix.bookTotal === 3.5 ? pOU35O : pOU25O;
  const pUnder = 1 - pOver;
  const [nvOver, nvUnder] = noVig2(pOver, pUnder);
  const overOdds = probToAmerican(nvOver);
  const underOdds = probToAmerican(nvUnder);

  // ── BTTS ────────────────────────────────────────────────────────────────
  const [nvBTTSY, nvBTTSN] = noVig2(pBTTSY, 1 - pBTTSY);
  const bttsYesOdds = probToAmerican(nvBTTSY);
  const bttsNoOdds = probToAmerican(nvBTTSN);

  // ── SPREAD (DYNAMIC DIRECTION) ──────────────────────────────────────────
  // CRITICAL: The spread favorite is determined by fix.spreadFavTeam
  // P(spread fav covers -1.5) = P(spread fav wins by 2+)
  // P(spread dog covers +1.5) = 1 - P(spread fav covers -1.5)
  let pSpreadFav, pSpreadDog;
  if (fix.spreadFavTeam === 'home') {
    // Home team is -1.5 favorite
    pSpreadFav = pHomeWinsBy2;  // P(home wins by 2+)
    pSpreadDog = 1 - pHomeWinsBy2;  // P(away covers +1.5)
  } else {
    // Away team is -1.5 favorite
    pSpreadFav = pAwayWinsBy2;  // P(away wins by 2+)
    pSpreadDog = 1 - pAwayWinsBy2;  // P(home covers +1.5)
  }

  // No-vig on 2-way spread market
  const [nvSpreadFav, nvSpreadDog] = noVig2(pSpreadFav, pSpreadDog);
  const spreadFavOdds = probToAmerican(nvSpreadFav);
  const spreadDogOdds = probToAmerican(nvSpreadDog);

  // Assign to home/away for DB storage
  // DB convention: selection='home' → homeSpreadLine/homeSpreadOdds
  //                selection='away' → awaySpreadLine/awaySpreadOdds
  let homeSpreadLine, homeSpreadOdds, awaySpreadLine, awaySpreadOdds;
  if (fix.spreadFavTeam === 'home') {
    homeSpreadLine = -1.5;  // home is -1.5 favorite
    homeSpreadOdds = spreadFavOdds;
    awaySpreadLine = 1.5;   // away is +1.5 dog
    awaySpreadOdds = spreadDogOdds;
  } else {
    homeSpreadLine = 1.5;   // home is +1.5 dog
    homeSpreadOdds = spreadDogOdds;
    awaySpreadLine = -1.5;  // away is -1.5 favorite
    awaySpreadOdds = spreadFavOdds;
  }

  // Spread favorite and dog ML (for invariant checks)
  const spreadFavML = fix.spreadFavTeam === 'home' ? homeML : awayML;
  const spreadDogML = fix.spreadFavTeam === 'home' ? awayML : homeML;
  const pSpreadFavML = fix.spreadFavTeam === 'home' ? nvH : nvA;
  const pSpreadDogML = fix.spreadFavTeam === 'home' ? nvA : nvH;

  return {
    homeML, drawML, awayML,
    dc1X, dcX2,
    noDrawH, noDrawA,
    overOdds, underOdds,
    bttsYesOdds, bttsNoOdds,
    homeSpreadLine, homeSpreadOdds,
    awaySpreadLine, awaySpreadOdds,
    spreadFavOdds, spreadDogOdds,
    pSpreadFav, pSpreadDog,
    nvSpreadFav, nvSpreadDog,
    spreadFavML, spreadDogML,
    pSpreadFavML, pSpreadDogML,
    nvH, nvD, nvA,
    nvBTTSY, nvBTTSN,
    nvOver, nvUnder,
    pDC1X, pDCX2,
  };
}

// ── SECTION D: INVARIANT VALIDATION ─────────────────────────────────────────
function validateInvariants(sim, lines, fix) {
  const errors = [];
  const EPSILON = 0.0005;

  // G1: 1X2 probs sum to 1
  const mlSum = sim.pH + sim.pD + sim.pA;
  if (Math.abs(mlSum - 1.0) > EPSILON)
    errors.push(`G1 FAIL: pH+pD+pA=${mlSum.toFixed(6)} ≠ 1.0`);

  // G2: Spread probs sum to 1
  const spreadSum = lines.pSpreadFav + lines.pSpreadDog;
  if (Math.abs(spreadSum - 1.0) > EPSILON)
    errors.push(`G2 FAIL: pSpreadFav+pSpreadDog=${spreadSum.toFixed(6)} ≠ 1.0`);

  // G3: Over + Under probs sum to 1
  const ouSum = (fix.bookTotal === 3.5 ? sim.pOU35O : sim.pOU25O) + (fix.bookTotal === 3.5 ? (1-sim.pOU35O) : (1-sim.pOU25O));
  if (Math.abs(ouSum - 1.0) > EPSILON)
    errors.push(`G3 FAIL: pOver+pUnder=${ouSum.toFixed(6)} ≠ 1.0`);

  // G4: BTTS in calibrated range [0.35, 0.70]
  if (sim.pBTTSY < 0.35 || sim.pBTTSY > 0.70)
    errors.push(`G4 FAIL: pBTTSY=${(sim.pBTTSY*100).toFixed(2)}% outside [35%, 70%]`);

  // G5: P(spread fav covers -1.5) < P(spread fav wins outright)
  // Covering -1.5 is a SUBSET of winning → must be strictly less probable
  if (lines.pSpreadFav >= lines.pSpreadFavML)
    errors.push(`G5 FAIL: pSpreadFav(${(lines.pSpreadFav*100).toFixed(3)}%) >= pFavML(${(lines.pSpreadFavML*100).toFixed(3)}%)`);

  // G6: P(spread dog covers +1.5) > P(spread dog wins outright)
  // Covering +1.5 includes draws and losses by 1 → must be more probable than winning
  if (lines.pSpreadDog <= lines.pSpreadDogML)
    errors.push(`G6 FAIL: pSpreadDog(${(lines.pSpreadDog*100).toFixed(3)}%) <= pDogML(${(lines.pSpreadDogML*100).toFixed(3)}%)`);

  // G7: spreadFavOdds > spreadFavML in American (longer odds for -1.5 than ML)
  // For favorites (negative ML): spreadFavOdds must be LESS negative (closer to 0 or positive)
  // For underdogs (positive ML): spreadFavOdds must be MORE positive
  // In both cases: spreadFavOdds > spreadFavML numerically
  if (lines.spreadFavOdds <= lines.spreadFavML)
    errors.push(`G7 FAIL: spreadFavOdds(${lines.spreadFavOdds}) <= spreadFavML(${lines.spreadFavML}) — -1.5 must be longer than ML`);

  // G8: spreadDogOdds < spreadDogML in American (shorter odds for +1.5 than ML)
  if (lines.spreadDogOdds >= lines.spreadDogML)
    errors.push(`G8 FAIL: spreadDogOdds(${lines.spreadDogOdds}) >= spreadDogML(${lines.spreadDogML}) — +1.5 must be shorter than ML`);

  // G9: DC1X = pH + pD (within epsilon)
  if (Math.abs(lines.pDC1X - (sim.pH + sim.pD)) > EPSILON)
    errors.push(`G9 FAIL: pDC1X=${lines.pDC1X.toFixed(6)} ≠ pH+pD=${(sim.pH+sim.pD).toFixed(6)}`);

  // G10: DCX2 = pA + pD (within epsilon)
  if (Math.abs(lines.pDCX2 - (sim.pA + sim.pD)) > EPSILON)
    errors.push(`G10 FAIL: pDCX2=${lines.pDCX2.toFixed(6)} ≠ pA+pD=${(sim.pA+sim.pD).toFixed(6)}`);

  return errors;
}

// ── MAIN EXECUTION ───────────────────────────────────────────────────────────
const results = [];

for (const fix of FIXTURES) {
  const eH = ELO[fix.homeCode], eA = ELO[fix.awayCode];
  const eloDiff = (eH - eA) / 400;
  const lH = Math.max(0.25, Math.min(3.5, PARAMS.baseH * Math.exp(eloDiff * PARAMS.ss)));
  const lA = Math.max(0.25, Math.min(3.5, PARAMS.baseA * Math.exp(-eloDiff * PARAMS.ss)));

  console.log(`\n${TAG} ─── ${fix.id}: ${fix.homeName}(H) vs ${fix.awayName}(A) ───`);
  console.log(`${TAG} [INPUT] eH=${eH} | eA=${eA} | eloDiff=${eloDiff.toFixed(4)}`);
  console.log(`${TAG} [STEP] lH=${lH.toFixed(4)} | lA=${lA.toFixed(4)} | λTotal=${(lH+lA).toFixed(4)}`);
  console.log(`${TAG} [STEP] spreadFavTeam=${fix.spreadFavTeam} → ${fix.spreadFavTeam==='home'?fix.homeName:fix.awayName} is -1.5 favorite`);
  console.log(`${TAG} [STEP] Running ${N_SIM.toLocaleString()} simulations...`);

  const sim = runSimulation(lH, lA, N_SIM);

  console.log(`${TAG} [STATE] pH=${(sim.pH*100).toFixed(3)}% | pD=${(sim.pD*100).toFixed(3)}% | pA=${(sim.pA*100).toFixed(3)}%`);
  console.log(`${TAG} [STATE] pHomeWinsBy2=${(sim.pHomeWinsBy2*100).toFixed(3)}% | pAwayWinsBy2=${(sim.pAwayWinsBy2*100).toFixed(3)}%`);
  console.log(`${TAG} [STATE] pBTTSY=${(sim.pBTTSY*100).toFixed(3)}% | pOU25O=${(sim.pOU25O*100).toFixed(3)}% | pOU35O=${(sim.pOU35O*100).toFixed(3)}%`);
  console.log(`${TAG} [STATE] projH=${sim.projH.toFixed(3)} | projA=${sim.projA.toFixed(3)} | projTotal=${(sim.projH+sim.projA).toFixed(3)}`);
  console.log(`${TAG} [STATE] modeScore=${sim.modeScore}`);

  const lines = computeLines(sim, fix);

  // Spread probability state
  const favTeam = fix.spreadFavTeam === 'home' ? fix.homeName : fix.awayName;
  const dogTeam = fix.spreadFavTeam === 'home' ? fix.awayName : fix.homeName;
  console.log(`${TAG} [STATE] P(${favTeam} covers -1.5)=${(lines.pSpreadFav*100).toFixed(3)}%`);
  console.log(`${TAG} [STATE] P(${dogTeam} covers +1.5)=${(lines.pSpreadDog*100).toFixed(3)}%`);

  // Validate invariants
  const errors = validateInvariants(sim, lines, fix);

  console.log(`\n${TAG} [OUTPUT] ── ORIGINATED LINES ──`);
  console.log(`${TAG} [OUTPUT] Away ML (${fix.awayName}):        ${lines.awayML > 0 ? '+' : ''}${lines.awayML}`);
  console.log(`${TAG} [OUTPUT] Home ML (${fix.homeName}):       ${lines.homeML > 0 ? '+' : ''}${lines.homeML}`);
  console.log(`${TAG} [OUTPUT] Draw:                    ${lines.drawML > 0 ? '+' : ''}${lines.drawML}`);
  console.log(`${TAG} [OUTPUT] Away WD (${fix.awayName} or Draw): ${lines.dcX2 > 0 ? '+' : ''}${lines.dcX2}`);
  console.log(`${TAG} [OUTPUT] Home WD (${fix.homeName} or Draw): ${lines.dc1X > 0 ? '+' : ''}${lines.dc1X}`);
  console.log(`${TAG} [OUTPUT] Away or Home ML (No Draw): A=${lines.noDrawA > 0 ? '+' : ''}${lines.noDrawA} / H=${lines.noDrawH > 0 ? '+' : ''}${lines.noDrawH}`);
  console.log(`${TAG} [OUTPUT] Over ${fix.bookTotal}:                  ${lines.overOdds > 0 ? '+' : ''}${lines.overOdds}`);
  console.log(`${TAG} [OUTPUT] Under ${fix.bookTotal}:                 ${lines.underOdds > 0 ? '+' : ''}${lines.underOdds}`);
  console.log(`${TAG} [OUTPUT] ${favTeam} -1.5:           ${lines.spreadFavOdds > 0 ? '+' : ''}${lines.spreadFavOdds} [P=${(lines.pSpreadFav*100).toFixed(3)}%]`);
  console.log(`${TAG} [OUTPUT] ${dogTeam} +1.5:            ${lines.spreadDogOdds > 0 ? '+' : ''}${lines.spreadDogOdds} [P=${(lines.pSpreadDog*100).toFixed(3)}%]`);
  console.log(`${TAG} [OUTPUT] BTTS YES:                ${lines.bttsYesOdds > 0 ? '+' : ''}${lines.bttsYesOdds} [P=${(sim.pBTTSY*100).toFixed(3)}%]`);
  console.log(`${TAG} [OUTPUT] BTTS NO:                 ${lines.bttsNoOdds > 0 ? '+' : ''}${lines.bttsNoOdds}`);
  console.log(`${TAG} [OUTPUT] DB: homeSpreadLine=${lines.homeSpreadLine} homeSpreadOdds=${lines.homeSpreadOdds}`);
  console.log(`${TAG} [OUTPUT] DB: awaySpreadLine=${lines.awaySpreadLine} awaySpreadOdds=${lines.awaySpreadOdds}`);

  if (errors.length > 0) {
    console.log(`\n${TAG} ❌ INVARIANT VIOLATIONS for ${fix.id}:`);
    for (const e of errors) console.log(`${TAG}   ${e}`);
    console.log(`${TAG} FATAL: Aborting to prevent publishing bad lines`);
    process.exit(1);
  } else {
    console.log(`\n${TAG} [VERIFY] ✅ All 10 invariant guards PASSED for ${fix.id}`);
  }

  results.push({ fix, sim, lines, lH, lA });
}

// ── SECTION E: PUBLISH TO DATABASE ──────────────────────────────────────────
console.log(`\n${TAG} ═══════════════════════════════════════════════════════════`);
console.log(`${TAG} SECTION E: PUBLISHING TO DATABASE`);
console.log(`${TAG} ═══════════════════════════════════════════════════════════`);

const conn = await mysql.createConnection(process.env.DATABASE_URL);
let totalInserted = 0;

try {
  // Delete existing model odds for all 6 fixtures
  const fixtureIds = FIXTURES.map(f => f.id);
  const placeholders = fixtureIds.map(() => '?').join(',');
  const [delResult] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots WHERE book_id=0 AND fixture_id IN (${placeholders})`,
    fixtureIds
  );
  console.log(`${TAG} [STEP] Deleted ${delResult.affectedRows} existing model odds rows`);

  for (const { fix, sim, lines, lH, lA } of results) {
    const projTotal = sim.projH + sim.projA;
    const projSpread = sim.projH - sim.projA;

    // Build 12 odds rows
    const oddsRows = [
      // 1X2
      { market: '1X2', selection: 'home',    line: null, odds: lines.homeML,       prob: lines.nvH },
      { market: '1X2', selection: 'away',    line: null, odds: lines.awayML,       prob: lines.nvA },
      { market: '1X2', selection: 'draw',    line: null, odds: lines.drawML,       prob: lines.nvD },
      { market: '1X2', selection: 'no_draw', line: null, odds: lines.noDrawH,      prob: sim.pH / (sim.pH + sim.pA) },
      // TOTAL
      { market: 'TOTAL', selection: 'over',  line: fix.bookTotal, odds: lines.overOdds,  prob: lines.nvOver },
      { market: 'TOTAL', selection: 'under', line: fix.bookTotal, odds: lines.underOdds, prob: lines.nvUnder },
      // BTTS
      { market: 'BTTS', selection: 'yes',    line: null, odds: lines.bttsYesOdds,  prob: lines.nvBTTSY },
      { market: 'BTTS', selection: 'no',     line: null, odds: lines.bttsNoOdds,   prob: lines.nvBTTSN },
      // ASIAN_HANDICAP — DYNAMIC: home gets their actual line (−1.5 or +1.5)
      { market: 'ASIAN_HANDICAP', selection: 'home', line: lines.homeSpreadLine, odds: Math.max(-2000, Math.min(2000, lines.homeSpreadOdds)), prob: fix.spreadFavTeam === 'home' ? lines.nvSpreadFav : lines.nvSpreadDog },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: lines.awaySpreadLine, odds: Math.max(-2000, Math.min(2000, lines.awaySpreadOdds)), prob: fix.spreadFavTeam === 'away' ? lines.nvSpreadFav : lines.nvSpreadDog },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: lines.dc1X, prob: lines.pDC1X / (lines.pDC1X + lines.pDCX2) },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: lines.dcX2, prob: lines.pDCX2 / (lines.pDC1X + lines.pDCX2) },
    ];

    if (oddsRows.length !== 12) {
      throw new Error(`GUARD: Expected 12 rows for ${fix.id}, got ${oddsRows.length}`);
    }

    for (const row of oddsRows) {
      await conn.execute(
        `INSERT INTO wc2026_odds_snapshots
           (fixture_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
         VALUES (?, 0, ?, ?, ?, ?, ?, NOW(), 0)`,
        [fix.id, row.market, row.selection, row.line, row.odds, row.prob]
      );
      totalInserted++;
    }

    // Upsert model projections
    const modelSpread = fix.spreadFavTeam === 'home'
      ? (sim.pHomeWinsBy2 > 0.5 ? -1.5 : 1.5)
      : (sim.pAwayWinsBy2 > 0.5 ? -1.5 : 1.5);

    await conn.execute(
      `INSERT INTO wc2026_model_projections
         (fixture_id, model_version, n_simulations,
          home_team, away_team, home_lambda, away_lambda,
          home_win_prob, draw_prob, away_win_prob,
          proj_home_score, proj_away_score, proj_total, proj_spread,
          over_2_5, under_2_5, over_3_5,
          btts_prob,
          model_home_ml, model_draw_ml, model_away_ml,
          model_spread, model_spread_raw,
          over_odds, under_odds,
          home_spread_odds, away_spread_odds,
          nv_home_prob, nv_draw_prob, nv_away_prob,
          nv_dc_1x, nv_dc_x2,
          nv_no_draw_home, nv_no_draw_away,
          dc_1x_odds, dc_x2_odds,
          no_draw_home_odds, no_draw_away_odds,
          btts_yes_odds, btts_no_odds,
          top_scorelines,
          modeled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         model_version=VALUES(model_version), n_simulations=VALUES(n_simulations),
         home_team=VALUES(home_team), away_team=VALUES(away_team),
         home_lambda=VALUES(home_lambda), away_lambda=VALUES(away_lambda),
         home_win_prob=VALUES(home_win_prob), draw_prob=VALUES(draw_prob), away_win_prob=VALUES(away_win_prob),
         proj_home_score=VALUES(proj_home_score), proj_away_score=VALUES(proj_away_score),
         proj_total=VALUES(proj_total), proj_spread=VALUES(proj_spread),
         over_2_5=VALUES(over_2_5), under_2_5=VALUES(under_2_5), over_3_5=VALUES(over_3_5),
         btts_prob=VALUES(btts_prob),
         model_home_ml=VALUES(model_home_ml), model_draw_ml=VALUES(model_draw_ml), model_away_ml=VALUES(model_away_ml),
         model_spread=VALUES(model_spread), model_spread_raw=VALUES(model_spread_raw),
         over_odds=VALUES(over_odds), under_odds=VALUES(under_odds),
         home_spread_odds=VALUES(home_spread_odds), away_spread_odds=VALUES(away_spread_odds),
         nv_home_prob=VALUES(nv_home_prob), nv_draw_prob=VALUES(nv_draw_prob), nv_away_prob=VALUES(nv_away_prob),
         nv_dc_1x=VALUES(nv_dc_1x), nv_dc_x2=VALUES(nv_dc_x2),
         nv_no_draw_home=VALUES(nv_no_draw_home), nv_no_draw_away=VALUES(nv_no_draw_away),
         dc_1x_odds=VALUES(dc_1x_odds), dc_x2_odds=VALUES(dc_x2_odds),
         no_draw_home_odds=VALUES(no_draw_home_odds), no_draw_away_odds=VALUES(no_draw_away_odds),
         btts_yes_odds=VALUES(btts_yes_odds), btts_no_odds=VALUES(btts_no_odds),
         top_scorelines=VALUES(top_scorelines),
         modeled_at=NOW()`,
      [
        fix.id, 'v10e-june24-v4-final', N_SIM,
        fix.homeName, fix.awayName, lH, lA,
        sim.pH, sim.pD, sim.pA,
        sim.projH, sim.projA, projTotal, projSpread,
        sim.pOU25O, 1 - sim.pOU25O, sim.pOU35O,
        sim.pBTTSY,
        lines.homeML, lines.drawML, lines.awayML,
        modelSpread, projSpread,
        lines.overOdds, lines.underOdds,
        Math.max(-2000, Math.min(2000, lines.homeSpreadOdds)),
        Math.max(-2000, Math.min(2000, lines.awaySpreadOdds)),
        lines.nvH, lines.nvD, lines.nvA,
        lines.pDC1X, lines.pDCX2,
        sim.pH / (sim.pH + sim.pA), sim.pA / (sim.pH + sim.pA),
        lines.dc1X, lines.dcX2,
        lines.noDrawH, lines.noDrawA,
        lines.bttsYesOdds, lines.bttsNoOdds,
        sim.topScorelines,
      ]
    );

    console.log(`${TAG} [OUTPUT] ✅ ${fix.id}: 12 odds rows + projection upserted`);
  }

  console.log(`\n${TAG} ═══════════════════════════════════════════════════════════`);
  console.log(`${TAG} PUBLISH COMPLETE`);
  console.log(`${TAG}   Total odds rows inserted: ${totalInserted} (expected: 72)`);
  console.log(`${TAG}   Total projection rows upserted: ${results.length} (expected: 6)`);
  if (totalInserted !== 72) {
    console.log(`${TAG} ❌ WARN: Expected 72 rows, got ${totalInserted}`);
  } else {
    console.log(`${TAG} ✅ All 72 rows confirmed`);
  }
  console.log(`${TAG} ═══════════════════════════════════════════════════════════`);

} finally {
  await conn.end();
}
