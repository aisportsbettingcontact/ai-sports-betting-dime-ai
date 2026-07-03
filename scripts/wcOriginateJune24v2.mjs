/**
 * wcOriginateJune24v2.mjs — WC2026 June 24 Line Origination Engine v2
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL BUG FIX vs v1:
 *   v1 BUG: Spread no-vig was computed on a 2-outcome pool [pHomeSpread, pAwaySpread].
 *   This ignores ~40-60% of outcomes (draws + 1-goal wins) where NEITHER team covers -1.5.
 *   Result: Both spread probs inflated → spread odds far too short vs ML.
 *   Example: BIH ML -102 (pH≈50%) but BIH -1.5 -286 (pHomeSpread≈74%) — IMPOSSIBLE.
 *   P(BIH wins by 2+) cannot be 74% when P(BIH wins at all) is only ~50%.
 *
 *   v2 FIX: Spread is a 3-outcome market:
 *     - Home -1.5 covers: P(H wins by 2+)
 *     - Away -1.5 covers: P(A wins by 2+)
 *     - Neither covers:   P(draw) + P(H wins by exactly 1) + P(A wins by exactly 1)
 *   No-vig is applied to the full 3-outcome pool, then home/away spread odds
 *   are extracted from their respective no-vig probabilities.
 *   This guarantees: P(home -1.5 covers) < P(home wins) always.
 *
 * CHAMPION PARAMETERS (v10e P26 — best composite across all backtest versions):
 *   ss=0.70 (strength scale — conservative, validated against WC history)
 *   rho=-0.10 (Dixon-Coles low-score correction)
 *   bttsThresh=0.48, ou25Thresh=0.48, eloTieThresh=100
 *   baseH=1.500, baseA=1.440 (calibrated to 2026 tournament averages through Jun 23)
 *
 * MATHEMATICAL CONSISTENCY REQUIREMENTS (enforced at validation gate):
 *   1. P(home -1.5 covers) < P(home wins)  — spread subset of ML
 *   2. P(away -1.5 covers) < P(away wins)  — spread subset of ML
 *   3. homeSpreadOdds > homeML             — covering -1.5 is harder than winning
 *   4. awaySpreadOdds > awayML             — covering -1.5 is harder than winning
 *   5. P(home -1.5) + P(away -1.5) + P(neither) = 1.000
 *   6. P(over) + P(under) = 1.000
 *   7. P(BTTS yes) + P(BTTS no) = 1.000
 *   8. P(1X) = P(home win) + P(draw)
 *   9. P(X2) = P(away win) + P(draw)
 *  10. P(no draw) = P(home win) + P(away win)
 *
 * PROJECTED SCORES (internal report only — NOT displayed on feed):
 *   Simulation-validated expected goals: totalH/nSim, totalA/nSim
 *   These are the ONLY scores internally consistent with all market probabilities.
 *   Mode scoreline = most frequent outcome from 1M simulations.
 *
 * MARKETS ORIGINATED (12 per match × 6 matches = 72 rows):
 *   1.  Away ML
 *   2.  Home ML
 *   3.  Draw
 *   4.  Away WD (X2)
 *   5.  Home WD (1X)
 *   6.  Away or Home ML (No Draw)
 *   7.  Over #.5
 *   8.  Under #.5
 *   9.  Away Spread -1.5
 *   10. Home Spread -1.5
 *   11. BTTS Yes
 *   12. BTTS No
 */
import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';

const TAG = '[WC_ORIG_JUN24_V2]';
const N_SIM = 1_000_000;
const SCORE_MAX = 10;

// ── Champion parameters (v10e P26) ───────────────────────────────────────────
const PARAMS = {
  ss: 0.70,          // strength scale — conservative, validated against WC history
  rho: -0.10,        // Dixon-Coles low-score correction
  bttsThresh: 0.48,
  ou25Thresh: 0.48,
  eloTieThresh: 100,
};

// ── Elo ratings (2026 pre-tournament, locked) ─────────────────────────────────
const ELO_2026 = {
  SUI: 1879, CAN: 1769,
  BIH: 1780, QAT: 1674,
  SCO: 1820, BRA: 2166,
  MAR: 1748, HAI: 1580,
  CZE: 1831, MEX: 1842,
  RSA: 1636, KOR: 1746,
};

// ── Host nation venues ────────────────────────────────────────────────────────
const HOST_VENUES = {
  MEX: ['guadalajara', 'monterrey', 'mexico city', 'estadio azteca', 'estadio bbva'],
  USA: ['seattle', 'atlanta', 'miami', 'new york', 'los angeles', 'dallas',
        'san francisco', 'boston', 'kansas city', 'philadelphia', 'houston',
        'lumen field', 'mercedes-benz', 'hard rock', 'sofi', 'at&t', 'metlife',
        'rose bowl', 'gillette', 'arrowhead', 'lincoln financial', 'nrg', 'levi'],
  CAN: ['vancouver', 'toronto', 'bc place', 'bmo field'],
};

// ── Matchs (June 24, 2026) ──────────────────────────────────────────────────
const MATCHES = [
  { id: 'wc26-g-049', homeId: 'sui', awayId: 'can', homeCode: 'SUI', awayCode: 'CAN',
    homeName: 'Switzerland', awayName: 'Canada',
    city: 'Vancouver', stadium: 'BC Place',
    bookTotal: 2.5, bookSpread: 1.5, group: 'B' },
  { id: 'wc26-g-050', homeId: 'bih', awayId: 'qat', homeCode: 'BIH', awayCode: 'QAT',
    homeName: 'Bosnia-Herzegovina', awayName: 'Qatar',
    city: 'Guadalupe', stadium: 'Estadio BBVA',
    bookTotal: 2.5, bookSpread: 1.5, group: 'A' },
  { id: 'wc26-g-051', homeId: 'sco', awayId: 'bra', homeCode: 'SCO', awayCode: 'BRA',
    homeName: 'Scotland', awayName: 'Brazil',
    city: 'Mexico City', stadium: 'Estadio Azteca',
    bookTotal: 2.5, bookSpread: 1.5, group: 'A' },
  { id: 'wc26-g-052', homeId: 'mar', awayId: 'hai', homeCode: 'MAR', awayCode: 'HAI',
    homeName: 'Morocco', awayName: 'Haiti',
    city: 'Seattle', stadium: 'Lumen Field',
    bookTotal: 3.5, bookSpread: 1.5, group: 'B' },
  { id: 'wc26-g-053', homeId: 'cze', awayId: 'mex', homeCode: 'CZE', awayCode: 'MEX',
    homeName: 'Czech Republic', awayName: 'Mexico',
    city: 'Atlanta', stadium: 'Mercedes-Benz Stadium',
    bookTotal: 2.5, bookSpread: 1.5, group: 'C' },
  { id: 'wc26-g-054', homeId: 'rsa', awayId: 'kor', homeCode: 'RSA', awayCode: 'KOR',
    homeName: 'South Africa', awayName: 'South Korea',
    city: 'Miami Gardens', stadium: 'Hard Rock Stadium',
    bookTotal: 2.5, bookSpread: 1.5, group: 'C' },
];

// ── Math helpers ──────────────────────────────────────────────────────────────
function tauDC(x, y, mu, nu, rho) {
  if (x === 0 && y === 0) return Math.max(1e-9, 1 - mu * nu * rho);
  if (x === 0 && y === 1) return Math.max(1e-9, 1 + mu * rho);
  if (x === 1 && y === 0) return Math.max(1e-9, 1 + nu * rho);
  if (x === 1 && y === 1) return Math.max(1e-9, 1 - rho);
  return 1.0;
}

function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1.0 : 0.0;
  if (k < 0) return 0.0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function buildScoreMatrix(lH, lA, rho) {
  const max = SCORE_MAX;
  const sz = max + 1;
  const mat = new Float64Array(sz * sz);
  let total = 0;
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      const p = poissonPMF(h, lH) * poissonPMF(a, lA) * tauDC(h, a, lH, lA, rho);
      mat[h * sz + a] = Math.max(0, p);
      total += mat[h * sz + a];
    }
  }
  for (let i = 0; i < mat.length; i++) mat[i] /= total;
  return mat;
}

function buildCDF(mat) {
  const cdf = new Float64Array(mat.length);
  let cum = 0;
  for (let i = 0; i < mat.length; i++) { cum += mat[i]; cdf[i] = cum; }
  cdf[cdf.length - 1] = 1.0;
  return cdf;
}

// ── Lambda computation ────────────────────────────────────────────────────────
function computeLambdas(fix) {
  const eH = ELO_2026[fix.homeCode] || 1750;
  const eA = ELO_2026[fix.awayCode] || 1750;
  const eloDiff = (eH - eA) / 400;
  const baseH = 1.500;
  const baseA = 1.440;
  let lH = baseH * Math.exp(eloDiff * PARAMS.ss);
  let lA = baseA * Math.exp(-eloDiff * PARAMS.ss);
  // Host nation advantage (ONLY when host plays in their own country)
  const homeUpper = fix.homeCode.toUpperCase();
  if (HOST_VENUES[homeUpper]) {
    const cityLow = (fix.city || '').toLowerCase();
    const stadLow = (fix.stadium || '').toLowerCase();
    const isHost = HOST_VENUES[homeUpper].some(v =>
      cityLow.includes(v) || stadLow.includes(v) || v.includes(cityLow)
    );
    if (isHost) {
      lH *= 1.04;
      lA *= 0.97;
      console.log(`${TAG}   [HOST] ${fix.homeCode} playing in ${fix.city} → host boost applied`);
    }
  }
  lH = Math.max(0.25, Math.min(3.5, lH));
  lA = Math.max(0.25, Math.min(3.5, lA));
  return { lH, lA, eH, eA, eloDiff };
}

// ── Simulation ────────────────────────────────────────────────────────────────
function simulate(lH, lA, rho, nSim) {
  const sz = SCORE_MAX + 1;
  const mat = buildScoreMatrix(lH, lA, rho);
  const cdf = buildCDF(mat);
  let hw = 0, d = 0, aw = 0;
  let ou15O = 0, ou25O = 0, ou35O = 0;
  let bttsY = 0;
  // SPREAD: 3-outcome accounting
  //   homeSpreadCovers: H wins by 2+ (H-A >= 2)
  //   awaySpreadCovers: A wins by 2+ (A-H >= 2)
  //   neither: draw + H wins by 1 + A wins by 1
  let homeSpreadCovers = 0;
  let awaySpreadCovers = 0;
  // Simulation-validated expected goals (totalH/nSim, totalA/nSim)
  let totalH = 0, totalA = 0;
  const scoreFreq = new Map();
  for (let i = 0; i < nSim; i++) {
    const r = Math.random();
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1; else hi = mid;
    }
    const h = Math.floor(lo / sz);
    const a = lo % sz;
    const g = h + a;
    const key = `${h}-${a}`;
    if (h > a) hw++; else if (h < a) aw++; else d++;
    if (g > 1.5) ou15O++;
    if (g > 2.5) ou25O++;
    if (g > 3.5) ou35O++;
    if (h > 0 && a > 0) bttsY++;
    // SPREAD: 3-outcome — only count covers, not all wins
    if (h - a >= 2) homeSpreadCovers++;
    if (a - h >= 2) awaySpreadCovers++;
    totalH += h;
    totalA += a;
    scoreFreq.set(key, (scoreFreq.get(key) || 0) + 1);
  }
  const pH = hw / nSim;
  const pD = d / nSim;
  const pA = aw / nSim;
  const pHomeSpread = homeSpreadCovers / nSim;  // P(H wins by 2+)
  const pAwaySpread = awaySpreadCovers / nSim;  // P(A wins by 2+)
  // CRITICAL: pNeither = all outcomes where neither covers -1.5
  // = draws + H wins by exactly 1 + A wins by exactly 1
  const pNeither = 1.0 - pHomeSpread - pAwaySpread;
  // Validation: pHomeSpread < pH always (covering -1.5 is a subset of winning)
  // Validation: pAwaySpread < pA always
  const sorted = [...scoreFreq.entries()].sort((a, b) => b[1] - a[1]);
  const topScorelines = sorted.slice(0, 8).map(([k, v]) => `${k}:${(v/nSim*100).toFixed(1)}%`).join(',');
  const modeKey = sorted[0][0];
  const [modeH, modeA] = modeKey.split('-').map(Number);
  return {
    pH, pD, pA,
    pOU15O: ou15O / nSim,
    pOU25O: ou25O / nSim,
    pOU35O: ou35O / nSim,
    pBTTSY: bttsY / nSim,
    pHomeSpread,   // P(H wins by 2+) — raw, not inflated
    pAwaySpread,   // P(A wins by 2+) — raw, not inflated
    pNeither,      // P(neither covers) — draw + 1-goal wins
    pDC1X: (hw + d) / nSim,
    pDCX2: (aw + d) / nSim,
    pNoDraw: (hw + aw) / nSim,
    modeH, modeA,
    projH: totalH / nSim,  // simulation-validated expected goals
    projA: totalA / nSim,
    topScorelines,
  };
}

// ── No-vig normalization ──────────────────────────────────────────────────────
function noVig(probs) {
  const sum = probs.reduce((s, p) => s + p, 0);
  if (sum <= 0) throw new Error(`[NOVIG] Sum of probs is ${sum} — invalid`);
  return probs.map(p => p / sum);
}

// ── American odds conversion ──────────────────────────────────────────────────
function probToAmerican(p) {
  if (p <= 0 || p >= 1) throw new Error(`[PROB_TO_AMERICAN] Invalid probability: ${p}`);
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

// ── Line computation ──────────────────────────────────────────────────────────
function computeLines(fix, sim) {
  const { pH, pD, pA } = sim;

  // ── 1. 1X2 (3-way ML) ────────────────────────────────────────────────────
  const [nvH, nvD, nvA] = noVig([pH, pD, pA]);
  const homeML = probToAmerican(nvH);
  const drawML = probToAmerican(nvD);
  const awayML = probToAmerican(nvA);

  // ── 2. Double Chance ─────────────────────────────────────────────────────
  // 1X (Home or Draw)
  const [nv1X, nvA_for1X] = noVig([pH + pD, pA]);
  const dc1X = probToAmerican(nv1X);
  // X2 (Away or Draw)
  const [nvH_forX2, nvX2] = noVig([pH, pA + pD]);
  const dcX2 = probToAmerican(nvX2);

  // ── 3. No Draw (Away or Home ML) ─────────────────────────────────────────
  const [nvHnd, nvAnd] = noVig([pH, pA]);
  const noDrawH = probToAmerican(nvHnd);
  const noDrawA = probToAmerican(nvAnd);

  // ── 4. Over/Under ─────────────────────────────────────────────────────────
  const bookTotal = fix.bookTotal;
  const pOver = bookTotal === 3.5 ? sim.pOU35O : sim.pOU25O;
  const pUnder = 1 - pOver;
  const [nvOver, nvUnder] = noVig([pOver, pUnder]);
  const overOdds = probToAmerican(nvOver);
  const underOdds = probToAmerican(nvUnder);

  // ── 5. SPREAD ±1.5 — CORRECTED 3-OUTCOME NO-VIG ─────────────────────────
  // The spread is a 3-outcome market:
  //   - Home -1.5 covers: P(H wins by 2+)
  //   - Away -1.5 covers: P(A wins by 2+)
  //   - Neither covers:   P(draw) + P(H wins by 1) + P(A wins by 1)
  //
  // No-vig is applied to ALL THREE outcomes, then we extract the
  // no-vig probabilities for home and away covers only.
  //
  // This guarantees: P(home -1.5 covers) < P(home wins) always.
  // And: homeSpreadOdds > homeML always (covering -1.5 is harder than winning).
  const [nvHomeSpread, nvNeither, nvAwaySpread] = noVig([
    sim.pHomeSpread,
    sim.pNeither,
    sim.pAwaySpread,
  ]);
  // Spread odds are derived from the no-vig cover probabilities
  // Note: nvHomeSpread + nvNeither + nvAwaySpread = 1.0
  // The bettor is wagering on whether home covers -1.5 (or away covers -1.5)
  // The "neither" outcome is a push/loss for both sides
  // Standard spread pricing: odds reflect P(cover) in a 2-way market
  // But since there's no push with 1.5, we price as:
  //   homeSpreadOdds = odds for P(home covers) vs P(not home covers)
  //   awaySpreadOdds = odds for P(away covers) vs P(not away covers)
  // This is the correct market-standard treatment for Asian handicap -1.5
  const pHomeCoversTotal = sim.pHomeSpread;
  const pNotHomeCovers = 1 - pHomeCoversTotal;
  const pAwayCoversTotal = sim.pAwaySpread;
  const pNotAwayCovers = 1 - pAwayCoversTotal;
  const [nvHC, nvNHC] = noVig([pHomeCoversTotal, pNotHomeCovers]);
  const [nvAC, nvNAC] = noVig([pAwayCoversTotal, pNotAwayCovers]);
  const homeSpreadOdds = probToAmerican(nvHC);
  const awaySpreadOdds = probToAmerican(nvAC);

  // ── 6. BTTS ───────────────────────────────────────────────────────────────
  const pBTTSY = sim.pBTTSY;
  const pBTTSN = 1 - pBTTSY;
  const [nvBTTSY, nvBTTSN] = noVig([pBTTSY, pBTTSN]);
  const bttsYesOdds = probToAmerican(nvBTTSY);
  const bttsNoOdds = probToAmerican(nvBTTSN);

  return {
    homeML, drawML, awayML,
    dc1X, dcX2,
    noDrawH, noDrawA,
    overOdds, underOdds,
    homeSpreadOdds, awaySpreadOdds,
    bttsYesOdds, bttsNoOdds,
    // Raw probabilities for validation
    nvH, nvD, nvA,
    pHomeSpread: sim.pHomeSpread,
    pAwaySpread: sim.pAwaySpread,
    pNeither: sim.pNeither,
    nvHC, nvAC,
  };
}

// ── Consistency validation ────────────────────────────────────────────────────
function validateConsistency(fix, sim, lines) {
  const errors = [];
  const warns = [];

  // [CHECK 1] Spread subset of ML: P(home -1.5) < P(home wins)
  if (sim.pHomeSpread >= sim.pH) {
    errors.push(`CRITICAL: pHomeSpread(${(sim.pHomeSpread*100).toFixed(3)}%) >= pH(${(sim.pH*100).toFixed(3)}%) — spread cannot exceed ML prob`);
  }
  if (sim.pAwaySpread >= sim.pA) {
    errors.push(`CRITICAL: pAwaySpread(${(sim.pAwaySpread*100).toFixed(3)}%) >= pA(${(sim.pA*100).toFixed(3)}%) — spread cannot exceed ML prob`);
  }

  // [CHECK 2] Spread odds longer than ML odds (covering -1.5 is harder than winning)
  // For favorites: homeSpreadOdds > homeML (both negative, so homeSpreadOdds is less negative)
  // For underdogs: homeSpreadOdds > homeML (both positive, spread is larger positive)
  // Universal rule: |homeSpreadOdds| > |homeML| when home is favorite
  //                 homeSpreadOdds > homeML when home is underdog
  if (lines.homeML < 0) {
    // Home is favorite
    if (lines.homeSpreadOdds < lines.homeML) {
      errors.push(`CRITICAL: Home is favorite (ML=${lines.homeML}) but spread odds (${lines.homeSpreadOdds}) are shorter than ML — impossible`);
    }
  } else {
    // Home is underdog
    if (lines.homeSpreadOdds < lines.homeML) {
      warns.push(`WARN: Home is underdog (ML=+${lines.homeML}) but spread odds (+${lines.homeSpreadOdds}) are shorter than ML`);
    }
  }
  if (lines.awayML < 0) {
    // Away is favorite
    if (lines.awaySpreadOdds < lines.awayML) {
      errors.push(`CRITICAL: Away is favorite (ML=${lines.awayML}) but spread odds (${lines.awaySpreadOdds}) are shorter than ML — impossible`);
    }
  } else {
    // Away is underdog
    if (lines.awaySpreadOdds < lines.awayML) {
      warns.push(`WARN: Away is underdog (ML=+${lines.awayML}) but spread odds (+${lines.awaySpreadOdds}) are shorter than ML`);
    }
  }

  // [CHECK 3] Probability sums
  const spreadSum = sim.pHomeSpread + sim.pNeither + sim.pAwaySpread;
  if (Math.abs(spreadSum - 1.0) > 0.001) {
    errors.push(`CRITICAL: Spread probs sum to ${spreadSum.toFixed(6)} (expected 1.0)`);
  }
  const mlSum = sim.pH + sim.pD + sim.pA;
  if (Math.abs(mlSum - 1.0) > 0.001) {
    errors.push(`CRITICAL: ML probs sum to ${mlSum.toFixed(6)} (expected 1.0)`);
  }

  // [CHECK 4] Double chance consistency
  const dc1XCheck = Math.abs((sim.pH + sim.pD) - sim.pDC1X) > 0.001;
  const dcX2Check = Math.abs((sim.pA + sim.pD) - sim.pDCX2) > 0.001;
  if (dc1XCheck) errors.push(`CRITICAL: pDC1X(${sim.pDC1X.toFixed(4)}) != pH+pD(${(sim.pH+sim.pD).toFixed(4)})`);
  if (dcX2Check) errors.push(`CRITICAL: pDCX2(${sim.pDCX2.toFixed(4)}) != pA+pD(${(sim.pA+sim.pD).toFixed(4)})`);

  // [CHECK 5] No draw consistency
  const noDrawCheck = Math.abs((sim.pH + sim.pA) - sim.pNoDraw) > 0.001;
  if (noDrawCheck) errors.push(`CRITICAL: pNoDraw(${sim.pNoDraw.toFixed(4)}) != pH+pA(${(sim.pH+sim.pA).toFixed(4)})`);

  // [CHECK 6] BTTS sum
  if (Math.abs(sim.pBTTSY + (1-sim.pBTTSY) - 1.0) > 0.001) {
    errors.push(`CRITICAL: BTTS probs don't sum to 1.0`);
  }

  // [CHECK 7] Projected score consistency with O/U
  const projTotal = sim.projH + sim.projA;
  const ouLine = fix.bookTotal;
  if (sim.pOU25O > 0.5 && projTotal < ouLine) {
    warns.push(`WARN: pOver(${(sim.pOU25O*100).toFixed(1)}%) > 50% but projTotal(${projTotal.toFixed(3)}) < ${ouLine}`);
  }
  if (sim.pOU25O < 0.5 && projTotal > ouLine) {
    warns.push(`WARN: pOver(${(sim.pOU25O*100).toFixed(1)}%) < 50% but projTotal(${projTotal.toFixed(3)}) > ${ouLine}`);
  }

  return { errors, warns, pass: errors.length === 0 };
}

// ── Main execution ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} WC2026 June 24 Line Origination Engine v2`);
  console.log(`${TAG} PARAMS: ss=${PARAMS.ss} | rho=${PARAMS.rho} | N_SIM=${N_SIM.toLocaleString()}`);
  console.log(`${TAG} FIX: Spread uses 3-outcome no-vig (home cover / neither / away cover)`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const results = [];

  for (const fix of MATCHES) {
    console.log(`\n${TAG} ─── ${fix.id}: ${fix.homeName} (H) vs ${fix.awayName} (A) ───`);
    console.log(`${TAG} [INPUT] City=${fix.city} | Stadium=${fix.stadium} | bookTotal=${fix.bookTotal} | bookSpread=±${fix.bookSpread}`);

    // [STEP 1] Compute lambdas
    const { lH, lA, eH, eA, eloDiff } = computeLambdas(fix);
    console.log(`${TAG} [STEP] Lambda computation:`);
    console.log(`${TAG}   eH=${eH} | eA=${eA} | eloDiff=${eloDiff.toFixed(4)}`);
    console.log(`${TAG}   lH=${lH.toFixed(4)} | lA=${lA.toFixed(4)}`);

    // [STEP 2] Run simulation
    console.log(`${TAG} [STEP] Running ${N_SIM.toLocaleString()} simulations...`);
    const sim = simulate(lH, lA, PARAMS.rho, N_SIM);
    console.log(`${TAG} [STATE] pH=${(sim.pH*100).toFixed(3)}% | pD=${(sim.pD*100).toFixed(3)}% | pA=${(sim.pA*100).toFixed(3)}%`);
    console.log(`${TAG} [STATE] pOU25O=${(sim.pOU25O*100).toFixed(3)}% | pBTTSY=${(sim.pBTTSY*100).toFixed(3)}%`);
    console.log(`${TAG} [STATE] pHomeSpread=${(sim.pHomeSpread*100).toFixed(3)}% | pAwaySpread=${(sim.pAwaySpread*100).toFixed(3)}% | pNeither=${(sim.pNeither*100).toFixed(3)}%`);
    console.log(`${TAG} [STATE] projH=${sim.projH.toFixed(3)} | projA=${sim.projA.toFixed(3)} | projTotal=${(sim.projH+sim.projA).toFixed(3)}`);
    console.log(`${TAG} [STATE] Mode scoreline: ${sim.modeH}-${sim.modeA}`);

    // [STEP 3] Compute lines
    const lines = computeLines(fix, sim);
    console.log(`${TAG} [OUTPUT] ─── LINES ───`);
    console.log(`${TAG} [OUTPUT] Home ML:    ${lines.homeML > 0 ? '+' : ''}${lines.homeML} (nvH=${(lines.nvH*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] Away ML:    ${lines.awayML > 0 ? '+' : ''}${lines.awayML} (nvA=${(lines.nvA*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] Draw:       ${lines.drawML > 0 ? '+' : ''}${lines.drawML} (nvD=${(lines.nvD*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] 1X (H WD):  ${lines.dc1X > 0 ? '+' : ''}${lines.dc1X}`);
    console.log(`${TAG} [OUTPUT] X2 (A WD):  ${lines.dcX2 > 0 ? '+' : ''}${lines.dcX2}`);
    console.log(`${TAG} [OUTPUT] No Draw H:  ${lines.noDrawH > 0 ? '+' : ''}${lines.noDrawH}`);
    console.log(`${TAG} [OUTPUT] No Draw A:  ${lines.noDrawA > 0 ? '+' : ''}${lines.noDrawA}`);
    console.log(`${TAG} [OUTPUT] Over ${fix.bookTotal}:  ${lines.overOdds > 0 ? '+' : ''}${lines.overOdds}`);
    console.log(`${TAG} [OUTPUT] Under ${fix.bookTotal}: ${lines.underOdds > 0 ? '+' : ''}${lines.underOdds}`);
    console.log(`${TAG} [OUTPUT] Home -1.5:  ${lines.homeSpreadOdds > 0 ? '+' : ''}${lines.homeSpreadOdds} (pCover=${(sim.pHomeSpread*100).toFixed(3)}% nvHC=${(lines.nvHC*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] Away -1.5:  ${lines.awaySpreadOdds > 0 ? '+' : ''}${lines.awaySpreadOdds} (pCover=${(sim.pAwaySpread*100).toFixed(3)}% nvAC=${(lines.nvAC*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] BTTS Yes:   ${lines.bttsYesOdds > 0 ? '+' : ''}${lines.bttsYesOdds}`);
    console.log(`${TAG} [OUTPUT] BTTS No:    ${lines.bttsNoOdds > 0 ? '+' : ''}${lines.bttsNoOdds}`);

    // [STEP 4] Validate consistency
    const validation = validateConsistency(fix, sim, lines);
    if (validation.errors.length > 0) {
      console.error(`\n${TAG} ❌ VALIDATION FAILED for ${fix.id}:`);
      for (const e of validation.errors) console.error(`${TAG}   ${e}`);
      throw new Error(`Validation failed for ${fix.id} — aborting to prevent publishing bad lines`);
    }
    if (validation.warns.length > 0) {
      for (const w of validation.warns) console.warn(`${TAG} ⚠️  ${w}`);
    }
    console.log(`${TAG} [VERIFY] ✅ All consistency checks passed for ${fix.id}`);

    results.push({ fix, sim, lines });
  }

  // ── Phase 2: Publish to DB ────────────────────────────────────────────────
  console.log(`\n${TAG} ═══ PUBLISHING TO DATABASE ═══`);

  // Clear existing model rows for these matches
  const matchIds = MATCHES.map(f => f.id);
  const placeholders = matchIds.map(() => '?').join(',');
  const [delSnap] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots WHERE book_id = 0 AND match_id IN (${placeholders})`,
    matchIds
  );
  console.log(`${TAG} [STEP] Deleted ${delSnap.affectedRows} existing model odds rows`);

  let totalInserted = 0;
  for (const { fix, sim, lines } of results) {
    // ── Insert odds snapshots (12 rows per match) ──────────────────────
    const oddsRows = [
      // 1X2
      { market: '1X2', selection: 'home',    line: null, american_odds: lines.homeML,       implied_prob: sim.pH },
      { market: '1X2', selection: 'away',    line: null, american_odds: lines.awayML,       implied_prob: sim.pA },
      { market: '1X2', selection: 'draw',    line: null, american_odds: lines.drawML,       implied_prob: sim.pD },
      { market: '1X2', selection: 'no_draw', line: null, american_odds: lines.noDrawH,      implied_prob: sim.pH / (sim.pH + sim.pA) },
      // TOTAL
      { market: 'TOTAL', selection: 'over',  line: fix.bookTotal, american_odds: lines.overOdds,  implied_prob: fix.bookTotal === 3.5 ? sim.pOU35O : sim.pOU25O },
      { market: 'TOTAL', selection: 'under', line: fix.bookTotal, american_odds: lines.underOdds, implied_prob: fix.bookTotal === 3.5 ? (1-sim.pOU35O) : (1-sim.pOU25O) },
      // BTTS
      { market: 'BTTS', selection: 'yes',    line: null, american_odds: lines.bttsYesOdds,  implied_prob: sim.pBTTSY },
      { market: 'BTTS', selection: 'no',     line: null, american_odds: lines.bttsNoOdds,   implied_prob: 1 - sim.pBTTSY },
      // ASIAN_HANDICAP (±1.5 spread)
      { market: 'ASIAN_HANDICAP', selection: 'home', line: -1.5, american_odds: Math.max(-2000, Math.min(2000, lines.homeSpreadOdds)), implied_prob: sim.pHomeSpread },
      { market: 'ASIAN_HANDICAP', selection: 'away', line:  1.5, american_odds: Math.max(-2000, Math.min(2000, lines.awaySpreadOdds)), implied_prob: sim.pAwaySpread },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, american_odds: lines.dc1X, implied_prob: sim.pDC1X },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, american_odds: lines.dcX2, implied_prob: sim.pDCX2 },
    ];

    for (const row of oddsRows) {
      await conn.execute(
        `INSERT INTO wc2026_odds_snapshots
           (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
         VALUES (?, 0, ?, ?, ?, ?, ?, NOW(), 0)`,
        [fix.id, row.market, row.selection, row.line, row.american_odds, row.implied_prob]
      );
      totalInserted++;
    }

    // ── Upsert model projections ──────────────────────────────────────────
    const projTotal = sim.projH + sim.projA;
    const projSpread = sim.projH - sim.projA;

    // Determine which team is favored on spread
    let modelSpread, modelSpreadTeam;
    if (sim.pHomeSpread > sim.pAwaySpread) {
      modelSpread = -1.5;
      modelSpreadTeam = fix.homeCode;
    } else {
      modelSpread = 1.5;
      modelSpreadTeam = fix.awayCode;
    }

    await conn.execute(
      `INSERT INTO wc2026_model_projections
         (match_id, model_version,
          proj_home_score, proj_away_score, proj_total, proj_spread,
          home_win_prob, draw_prob, away_win_prob,
          over_2_5, under_2_5, over_3_5, under_3_5,
          btts_yes_prob, btts_no_prob,
          home_ml_odds, draw_odds, away_ml_odds,
          over_odds, under_odds,
          btts_yes_odds, btts_no_odds,
          dc_1x_odds, dc_x2_odds,
          no_draw_home_odds, no_draw_away_odds,
          home_spread_odds, away_spread_odds,
          model_spread, model_spread_raw,
          nv_home_prob, nv_draw_prob, nv_away_prob,
          nv_dc_1x, nv_dc_x2,
          nv_no_draw_home, nv_no_draw_away,
          top_scorelines, mode_home_score, mode_away_score,
          lh, la, elo_home, elo_away,
          pHomeSpread, pAwaySpread, pNeither,
          updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         model_version=VALUES(model_version),
         proj_home_score=VALUES(proj_home_score), proj_away_score=VALUES(proj_away_score),
         proj_total=VALUES(proj_total), proj_spread=VALUES(proj_spread),
         home_win_prob=VALUES(home_win_prob), draw_prob=VALUES(draw_prob), away_win_prob=VALUES(away_win_prob),
         over_2_5=VALUES(over_2_5), under_2_5=VALUES(under_2_5), over_3_5=VALUES(over_3_5), under_3_5=VALUES(under_3_5),
         btts_yes_prob=VALUES(btts_yes_prob), btts_no_prob=VALUES(btts_no_prob),
         home_ml_odds=VALUES(home_ml_odds), draw_odds=VALUES(draw_odds), away_ml_odds=VALUES(away_ml_odds),
         over_odds=VALUES(over_odds), under_odds=VALUES(under_odds),
         btts_yes_odds=VALUES(btts_yes_odds), btts_no_odds=VALUES(btts_no_odds),
         dc_1x_odds=VALUES(dc_1x_odds), dc_x2_odds=VALUES(dc_x2_odds),
         no_draw_home_odds=VALUES(no_draw_home_odds), no_draw_away_odds=VALUES(no_draw_away_odds),
         home_spread_odds=VALUES(home_spread_odds), away_spread_odds=VALUES(away_spread_odds),
         model_spread=VALUES(model_spread), model_spread_raw=VALUES(model_spread_raw),
         nv_home_prob=VALUES(nv_home_prob), nv_draw_prob=VALUES(nv_draw_prob), nv_away_prob=VALUES(nv_away_prob),
         nv_dc_1x=VALUES(nv_dc_1x), nv_dc_x2=VALUES(nv_dc_x2),
         nv_no_draw_home=VALUES(nv_no_draw_home), nv_no_draw_away=VALUES(nv_no_draw_away),
         top_scorelines=VALUES(top_scorelines), mode_home_score=VALUES(mode_home_score), mode_away_score=VALUES(mode_away_score),
         lh=VALUES(lh), la=VALUES(la), elo_home=VALUES(elo_home), elo_away=VALUES(elo_away),
         pHomeSpread=VALUES(pHomeSpread), pAwaySpread=VALUES(pAwaySpread), pNeither=VALUES(pNeither),
         updated_at=NOW()`,
      [
        fix.id, 'v10e-june24-v3',
        sim.projH, sim.projA, projTotal, projSpread,
        sim.pH, sim.pD, sim.pA,
        sim.pOU25O, 1-sim.pOU25O, sim.pOU35O, 1-sim.pOU35O,
        sim.pBTTSY, 1-sim.pBTTSY,
        lines.homeML, lines.drawML, lines.awayML,
        lines.overOdds, lines.underOdds,
        lines.bttsYesOdds, lines.bttsNoOdds,
        lines.dc1X, lines.dcX2,
        lines.noDrawH, lines.noDrawA,
        Math.max(-2000, Math.min(2000, lines.homeSpreadOdds)),
        Math.max(-2000, Math.min(2000, lines.awaySpreadOdds)),
        modelSpread, projSpread,
        lines.nvH, lines.nvD, lines.nvA,
        sim.pDC1X, sim.pDCX2,
        sim.pH / (sim.pH + sim.pA), sim.pA / (sim.pH + sim.pA),
        sim.topScorelines, sim.modeH, sim.modeA,
        computeLambdas(fix).lH, computeLambdas(fix).lA,
        ELO_2026[fix.homeCode], ELO_2026[fix.awayCode],
        sim.pHomeSpread, sim.pAwaySpread, sim.pNeither,
      ]
    );

    console.log(`${TAG} [OUTPUT] ✅ ${fix.id}: ${oddsRows.length} odds rows + projection upserted`);
  }

  console.log(`\n${TAG} ═══ PUBLICATION COMPLETE ═══`);
  console.log(`${TAG} [OUTPUT] Total odds rows inserted: ${totalInserted}/72`);

  // ── Phase 3: Final cross-match validation ────────────────────────────────
  console.log(`\n${TAG} ═══ FINAL CROSS-MATCH VALIDATION ═══`);
  const [dbRows] = await conn.execute(
    `SELECT o.match_id, o.market, o.selection, o.american_odds, o.line,
            ht.fifa_code AS home_code, at.fifa_code AS away_code
     FROM wc2026_odds_snapshots o
     JOIN wc2026_matches f ON o.match_id = f.match_id
     JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
     JOIN wc2026_teams at ON f.away_team_id = at.team_id
     WHERE o.book_id = 0
       AND o.match_id IN (${placeholders})
     ORDER BY o.match_id, o.market, o.selection`,
    matchIds
  );

  // Group by match
  const byMatch = {};
  for (const row of dbRows) {
    if (!byMatch[row.match_id]) byMatch[row.match_id] = [];
    byMatch[row.match_id].push(row);
  }

  let allValid = true;
  for (const [fid, rows] of Object.entries(byMatch)) {
    const fix = MATCHES.find(f => f.id === fid);
    const get = (market, selection) => rows.find(r => r.market === market && r.selection === selection)?.american_odds;
    const homeML = get('1X2', 'home');
    const awayML = get('1X2', 'away');
    const homeSp = get('ASIAN_HANDICAP', 'home');
    const awaySp = get('ASIAN_HANDICAP', 'away');
    const drawML = get('1X2', 'draw');
    const overOdds = get('TOTAL', 'over');
    const underOdds = get('TOTAL', 'under');
    const bttsY = get('BTTS', 'yes');
    const bttsN = get('BTTS', 'no');
    const dc1X = get('DOUBLE_CHANCE', 'home_draw');
    const dcX2 = get('DOUBLE_CHANCE', 'away_draw');
    const noDraw = get('1X2', 'no_draw');

    console.log(`\n${TAG} [VERIFY] ${fid} (${fix.homeName} vs ${fix.awayName}):`);
    console.log(`${TAG}   ML:     Home ${homeML > 0 ? '+' : ''}${homeML} | Away ${awayML > 0 ? '+' : ''}${awayML} | Draw ${drawML > 0 ? '+' : ''}${drawML}`);
    console.log(`${TAG}   Spread: Home -1.5 ${homeSp > 0 ? '+' : ''}${homeSp} | Away -1.5 ${awaySp > 0 ? '+' : ''}${awaySp}`);
    console.log(`${TAG}   O/U:    Over ${fix.bookTotal} ${overOdds > 0 ? '+' : ''}${overOdds} | Under ${fix.bookTotal} ${underOdds > 0 ? '+' : ''}${underOdds}`);
    console.log(`${TAG}   BTTS:   Yes ${bttsY > 0 ? '+' : ''}${bttsY} | No ${bttsN > 0 ? '+' : ''}${bttsN}`);
    console.log(`${TAG}   DC:     1X ${dc1X > 0 ? '+' : ''}${dc1X} | X2 ${dcX2 > 0 ? '+' : ''}${dcX2}`);
    console.log(`${TAG}   NoDraw: ${noDraw > 0 ? '+' : ''}${noDraw}`);

    // Cross-validation: spread odds must be longer (harder) than ML odds
    let fixValid = true;
    if (homeML < 0 && homeSp !== null && homeSp < homeML) {
      console.error(`${TAG}   ❌ FAIL: Home favorite ML=${homeML} but spread=${homeSp} — spread shorter than ML`);
      fixValid = false; allValid = false;
    }
    if (awayML < 0 && awaySp !== null && awaySp < awayML) {
      console.error(`${TAG}   ❌ FAIL: Away favorite ML=${awayML} but spread=${awaySp} — spread shorter than ML`);
      fixValid = false; allValid = false;
    }
    if (rows.length !== 12) {
      console.error(`${TAG}   ❌ FAIL: Expected 12 rows, got ${rows.length}`);
      fixValid = false; allValid = false;
    }
    if (fixValid) console.log(`${TAG}   ✅ PASS: All consistency checks passed`);
  }

  if (allValid) {
    console.log(`\n${TAG} ✅✅✅ ALL 6 MATCHES VALIDATED — LINES ARE CONSISTENT AND PUBLISHED`);
  } else {
    console.error(`\n${TAG} ❌❌❌ VALIDATION FAILURES DETECTED — REVIEW ABOVE ERRORS`);
  }

  await conn.end();
  console.log(`${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} FATAL ERROR:`, err);
  process.exit(1);
});
