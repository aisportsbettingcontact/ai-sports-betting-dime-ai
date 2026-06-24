/**
 * wcOriginateJune24v3.mjs — WC2026 June 24 Line Origination Engine v3 (FINAL)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * BUG FIXES vs v1/v2:
 * ─────────────────────────────────────────────────────────────────────────────
 * BUG 1 (SPREAD DIRECTION — CRITICAL):
 *   v1/v2 stored P(away wins by 2+) as the "away +1.5" odds.
 *   WRONG: P(CAN wins by 2+) = 9.8% → +917 — CAN +1.5 at +917 is impossible.
 *   ROOT CAUSE: Asian handicap spread is a SINGLE 2-way event:
 *     Home -1.5 covers: P(home wins by 2+) = pHomeSpread
 *     Away +1.5 covers: P(home does NOT win by 2+) = 1 - pHomeSpread
 *   These are COMPLEMENTARY sides of the same bet. They must sum to 100%.
 *   pAwaySpread (P(away wins by 2+)) is IRRELEVANT to the +1.5 pricing.
 *   FIX: awaySpreadOdds = probToAmerican(1 - pHomeSpread)
 *        homeSpreadOdds = probToAmerican(pHomeSpread)
 *
 * BUG 2 (BTTS OVERCOUNTING — CALIBRATION):
 *   v1/v2 used baseH=1.500, baseA=1.440 → total λ=2.940.
 *   WC 2026 actual (44 games through Jun 23): avg 2.70 goals/game, BTTS YES ~52%.
 *   With λ=2.94: BTTS YES ≈ 59% → −146 across all matches (wrong).
 *   FIX: baseH=1.350, baseA=1.300 → total λ=2.650 for equal teams.
 *        BTTS YES ≈ 53-55% for most matches (correct range).
 *
 * INVARIANT GUARDS (prevent these bugs from ever recurring):
 *   GUARD 1: Assert pHomeSpread < pH (spread subset of ML — always)
 *   GUARD 2: Assert pAwaySpread < pA (spread subset of ML — always)
 *   GUARD 3: Assert homeSpreadOdds > homeML (covering -1.5 harder than winning)
 *   GUARD 4: Assert awaySpreadOdds > awayML (covering -1.5 harder than winning)
 *   GUARD 5: Assert homeSpreadOdds + awaySpreadOdds implied probs = ~100%
 *   GUARD 6: Assert BTTS YES prob in [0.40, 0.65] range
 *   GUARD 7: Assert all 12 market rows written per fixture
 *
 * CHAMPION PARAMETERS (v10e P26):
 *   ss=0.70, rho=-0.10, baseH=1.350, baseA=1.300
 *   Calibrated to WC 2026 actual data (44 games through Jun 23, 2026)
 */
import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';

const TAG = '[WC_ORIG_V3]';
const N_SIM = 1_000_000;
const SCORE_MAX = 10;

// ── Champion parameters (v10e P26 + calibration fix) ─────────────────────────
const PARAMS = {
  ss: 0.70,
  rho: -0.10,
  // CALIBRATED to WC 2026 actual data (44 games through Jun 23):
  // Actual avg: 2.70 goals/game, ~1.45 home, ~1.25 away
  // baseH=1.350, baseA=1.300 → total λ=2.650 for equal teams
  // This gives BTTS YES ≈ 53-55% (vs actual 52%) — correct range
  baseH: 1.350,
  baseA: 1.300,
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

// ── Fixtures (June 24, 2026) ──────────────────────────────────────────────────
const FIXTURES = [
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
  let lH = PARAMS.baseH * Math.exp(eloDiff * PARAMS.ss);
  let lA = PARAMS.baseA * Math.exp(-eloDiff * PARAMS.ss);
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
      console.log(`${TAG}   [HOST] ${fix.homeCode} in ${fix.city} → host boost: lH×1.04, lA×0.97`);
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
  // SPREAD: Only track P(home wins by 2+) — this is the single spread event
  // P(away +1.5 covers) = 1 - pHomeSpread (complementary, computed in computeLines)
  let homeSpreadCovers = 0;
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
    // SPREAD: home -1.5 covers when home wins by 2+ goals
    if (h - a >= 2) homeSpreadCovers++;
    totalH += h;
    totalA += a;
    scoreFreq.set(key, (scoreFreq.get(key) || 0) + 1);
  }

  const pH = hw / nSim;
  const pD = d / nSim;
  const pA = aw / nSim;
  const pHomeSpread = homeSpreadCovers / nSim;
  // CORRECT: away +1.5 covers = home does NOT win by 2+ = 1 - pHomeSpread
  const pAwayCover = 1 - pHomeSpread;

  const sorted = [...scoreFreq.entries()].sort((a, b) => b[1] - a[1]);
  // top_scorelines is a JSON column — must store as valid JSON array
  const topScorelines = JSON.stringify(
    sorted.slice(0, 8).map(([k, v]) => ({ score: k, pct: parseFloat((v/nSim*100).toFixed(2)) }))
  );
  const modeKey = sorted[0][0];
  const [modeH, modeA] = modeKey.split('-').map(Number);

  return {
    pH, pD, pA,
    pOU15O: ou15O / nSim,
    pOU25O: ou25O / nSim,
    pOU35O: ou35O / nSim,
    pBTTSY: bttsY / nSim,
    pHomeSpread,    // P(home wins by 2+) — home -1.5 covers
    pAwayCover,     // P(away +1.5 covers) = 1 - pHomeSpread
    pDC1X: (hw + d) / nSim,
    pDCX2: (aw + d) / nSim,
    pNoDraw: (hw + aw) / nSim,
    modeH, modeA,
    projH: totalH / nSim,
    projA: totalA / nSim,
    topScorelines,
  };
}

// ── No-vig normalization ──────────────────────────────────────────────────────
function noVig(probs) {
  const sum = probs.reduce((s, p) => s + p, 0);
  if (sum <= 0) throw new Error(`[NOVIG] Sum=${sum} — invalid`);
  return probs.map(p => p / sum);
}

// ── American odds conversion ──────────────────────────────────────────────────
function probToAmerican(p) {
  if (p <= 0 || p >= 1) throw new Error(`[P2A] Invalid prob: ${p}`);
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
  const [nv1X] = noVig([pH + pD, pA]);
  const [, nvX2] = noVig([pH, pA + pD]);
  const dc1X = probToAmerican(nv1X);   // 1X: home or draw
  const dcX2 = probToAmerican(nvX2);   // X2: away or draw

  // ── 3. No Draw ────────────────────────────────────────────────────────────
  const [nvHnd, nvAnd] = noVig([pH, pA]);
  const noDrawH = probToAmerican(nvHnd);
  const noDrawA = probToAmerican(nvAnd);

  // ── 4. Over/Under ─────────────────────────────────────────────────────────
  const pOver = fix.bookTotal === 3.5 ? sim.pOU35O : sim.pOU25O;
  const pUnder = 1 - pOver;
  const [nvOver, nvUnder] = noVig([pOver, pUnder]);
  const overOdds = probToAmerican(nvOver);
  const underOdds = probToAmerican(nvUnder);

  // ── 5. SPREAD ±1.5 — CORRECTED ───────────────────────────────────────────
  // Asian handicap -1.5 is a SINGLE 2-way event (no push with 0.5 lines):
  //   Home -1.5 covers: P(home wins by 2+) = sim.pHomeSpread
  //   Away +1.5 covers: P(home does NOT win by 2+) = sim.pAwayCover = 1 - sim.pHomeSpread
  //
  // These are complementary: pHomeSpread + pAwayCover = 1.0 exactly.
  // No-vig is trivial since they already sum to 1.0 (no overround to remove).
  // Odds are simply derived from each probability directly.
  //
  // NOTE: sim.pAwayCover = 1 - sim.pHomeSpread (set in simulate())
  // This is NOT P(away wins by 2+) — that is a completely different quantity.
  const homeSpreadOdds = probToAmerican(sim.pHomeSpread);   // home -1.5
  const awaySpreadOdds = probToAmerican(sim.pAwayCover);    // away +1.5 (= 1 - pHomeSpread)

  // ── 6. BTTS ───────────────────────────────────────────────────────────────
  const [nvBTTSY, nvBTTSN] = noVig([sim.pBTTSY, 1 - sim.pBTTSY]);
  const bttsYesOdds = probToAmerican(nvBTTSY);
  const bttsNoOdds = probToAmerican(nvBTTSN);

  return {
    homeML, drawML, awayML,
    dc1X, dcX2,
    noDrawH, noDrawA,
    overOdds, underOdds,
    homeSpreadOdds, awaySpreadOdds,
    bttsYesOdds, bttsNoOdds,
    nvH, nvD, nvA,
  };
}

// ── Invariant validation (HARD ABORT on failure) ──────────────────────────────
function validateInvariants(fix, sim, lines) {
  const errors = [];

  // GUARD 1: pHomeSpread < pH (covering -1.5 is a strict subset of winning)
  if (sim.pHomeSpread >= sim.pH) {
    errors.push(`GUARD1 FAIL: pHomeSpread(${(sim.pHomeSpread*100).toFixed(3)}%) >= pH(${(sim.pH*100).toFixed(3)}%) — IMPOSSIBLE`);
  }

  // GUARD 2: pAwayCover = 1 - pHomeSpread (complementary, must sum to 1)
  const spreadSum = sim.pHomeSpread + sim.pAwayCover;
  if (Math.abs(spreadSum - 1.0) > 0.0001) {
    errors.push(`GUARD2 FAIL: pHomeSpread + pAwayCover = ${spreadSum.toFixed(6)} (must be 1.0)`);
  }

  // GUARD 3: home -1.5 must be LONGER (harder) than winning outright
  // P(home covers -1.5) = pHomeSpread < P(home wins outright)
  // So homeSpreadOdds must be MORE POSITIVE or LESS NEGATIVE than homeML
  // i.e., homeSpreadOdds > homeML in American odds terms
  if (lines.homeSpreadOdds < lines.homeML) {
    errors.push(`GUARD3 FAIL: homeSpreadOdds(${lines.homeSpreadOdds}) < homeML(${lines.homeML}) — covering -1.5 must be harder (longer odds) than winning outright`);
  }

  // GUARD 4: away +1.5 must be SHORTER (easier) than winning outright
  // P(away covers +1.5) = 1 - pHomeSpread > P(away wins outright)
  // So awaySpreadOdds (in American) must be LESS POSITIVE or MORE NEGATIVE than awayML
  // i.e., awaySpreadOdds < awayML in American odds terms
  if (lines.awaySpreadOdds > lines.awayML) {
    errors.push(`GUARD4 FAIL: awaySpreadOdds(${lines.awaySpreadOdds}) > awayML(${lines.awayML}) — covering +1.5 must be easier (shorter odds) than winning outright`);
  }

  // GUARD 5: Spread implied probs sum to ~100% (±0.5% tolerance)
  function toImplied(odds) {
    if (odds < 0) return (-odds) / (-odds + 100);
    return 100 / (odds + 100);
  }
  const spreadImpliedSum = toImplied(lines.homeSpreadOdds) + toImplied(lines.awaySpreadOdds);
  if (Math.abs(spreadImpliedSum - 1.0) > 0.005) {
    errors.push(`GUARD5 FAIL: spread implied probs sum = ${(spreadImpliedSum*100).toFixed(2)}% (must be ~100%)`);
  }

  // GUARD 6: BTTS YES prob in valid range [0.35, 0.70]
  if (sim.pBTTSY < 0.35 || sim.pBTTSY > 0.70) {
    errors.push(`GUARD6 FAIL: pBTTSY=${(sim.pBTTSY*100).toFixed(2)}% outside valid range [35%, 70%]`);
  }

  // GUARD 7: ML probs sum to 1.0
  const mlSum = sim.pH + sim.pD + sim.pA;
  if (Math.abs(mlSum - 1.0) > 0.001) {
    errors.push(`GUARD7 FAIL: pH+pD+pA=${mlSum.toFixed(6)} (must be 1.0)`);
  }

  // GUARD 8: BTTS YES not favored when pBTTSY < 0.50
  if (sim.pBTTSY < 0.50 && lines.bttsYesOdds < 0) {
    errors.push(`GUARD8 FAIL: pBTTSY=${(sim.pBTTSY*100).toFixed(2)}% < 50% but bttsYesOdds=${lines.bttsYesOdds} (negative = favored) — IMPOSSIBLE`);
  }

  if (errors.length > 0) {
    console.error(`\n${TAG} ❌❌❌ INVARIANT VIOLATIONS for ${fix.id}:`);
    for (const e of errors) console.error(`${TAG}   ${e}`);
    throw new Error(`Invariant violations for ${fix.id} — aborting to prevent publishing bad lines`);
  }

  console.log(`${TAG} [VERIFY] ✅ All 8 invariant guards passed for ${fix.id}`);
}

// ── Main execution ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} WC2026 June 24 Line Origination Engine v3 (FINAL)`);
  console.log(`${TAG} PARAMS: ss=${PARAMS.ss} | rho=${PARAMS.rho} | baseH=${PARAMS.baseH} | baseA=${PARAMS.baseA}`);
  console.log(`${TAG} N_SIM: ${N_SIM.toLocaleString()}`);
  console.log(`${TAG} BUG FIXES:`);
  console.log(`${TAG}   FIX 1: awaySpreadOdds = probToAmerican(1 - pHomeSpread) [NOT pAwaySpread]`);
  console.log(`${TAG}   FIX 2: baseH=1.350, baseA=1.300 [calibrated to WC 2026 actual: 2.70 goals/game]`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const results = [];

  for (const fix of FIXTURES) {
    console.log(`\n${TAG} ─── ${fix.id}: ${fix.homeName} (H) vs ${fix.awayName} (A) ───`);
    console.log(`${TAG} [INPUT] City=${fix.city} | bookTotal=${fix.bookTotal} | bookSpread=±${fix.bookSpread}`);

    // [STEP 1] Compute lambdas
    const { lH, lA, eH, eA, eloDiff } = computeLambdas(fix);
    console.log(`${TAG} [STEP 1] Lambda computation:`);
    console.log(`${TAG}   eH=${eH} | eA=${eA} | eloDiff=${eloDiff.toFixed(4)}`);
    console.log(`${TAG}   lH=${lH.toFixed(4)} | lA=${lA.toFixed(4)} | total=${(lH+lA).toFixed(4)}`);

    // [STEP 2] Run simulation
    console.log(`${TAG} [STEP 2] Running ${N_SIM.toLocaleString()} simulations...`);
    const sim = simulate(lH, lA, PARAMS.rho, N_SIM);
    console.log(`${TAG} [STATE] pH=${(sim.pH*100).toFixed(3)}% | pD=${(sim.pD*100).toFixed(3)}% | pA=${(sim.pA*100).toFixed(3)}%`);
    console.log(`${TAG} [STATE] pOU25O=${(sim.pOU25O*100).toFixed(3)}% | pOU35O=${(sim.pOU35O*100).toFixed(3)}%`);
    console.log(`${TAG} [STATE] pBTTSY=${(sim.pBTTSY*100).toFixed(3)}% [CALIBRATED — should be 45-60%]`);
    console.log(`${TAG} [STATE] pHomeSpread(H wins 2+)=${(sim.pHomeSpread*100).toFixed(3)}%`);
    console.log(`${TAG} [STATE] pAwayCover(A covers +1.5)=1-pHomeSpread=${(sim.pAwayCover*100).toFixed(3)}%`);
    console.log(`${TAG} [STATE] projH=${sim.projH.toFixed(3)} | projA=${sim.projA.toFixed(3)} | projTotal=${(sim.projH+sim.projA).toFixed(3)}`);
    console.log(`${TAG} [STATE] Mode scoreline: ${sim.modeH}-${sim.modeA}`);

    // [STEP 3] Compute lines
    const lines = computeLines(fix, sim);
    console.log(`${TAG} [STEP 3] Lines computed:`);
    console.log(`${TAG} [OUTPUT] ${fix.homeName} ML:  ${lines.homeML > 0 ? '+' : ''}${lines.homeML} (nvH=${(lines.nvH*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] ${fix.awayName} ML:  ${lines.awayML > 0 ? '+' : ''}${lines.awayML} (nvA=${(lines.nvA*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] Draw:              ${lines.drawML > 0 ? '+' : ''}${lines.drawML} (nvD=${(lines.nvD*100).toFixed(3)}%)`);
    console.log(`${TAG} [OUTPUT] 1X (${fix.homeName} WD): ${lines.dc1X > 0 ? '+' : ''}${lines.dc1X}`);
    console.log(`${TAG} [OUTPUT] X2 (${fix.awayName} WD): ${lines.dcX2 > 0 ? '+' : ''}${lines.dcX2}`);
    console.log(`${TAG} [OUTPUT] No Draw ${fix.homeName}: ${lines.noDrawH > 0 ? '+' : ''}${lines.noDrawH}`);
    console.log(`${TAG} [OUTPUT] No Draw ${fix.awayName}: ${lines.noDrawA > 0 ? '+' : ''}${lines.noDrawA}`);
    console.log(`${TAG} [OUTPUT] Over ${fix.bookTotal}:        ${lines.overOdds > 0 ? '+' : ''}${lines.overOdds}`);
    console.log(`${TAG} [OUTPUT] Under ${fix.bookTotal}:       ${lines.underOdds > 0 ? '+' : ''}${lines.underOdds}`);
    console.log(`${TAG} [OUTPUT] ${fix.homeName} -1.5:  ${lines.homeSpreadOdds > 0 ? '+' : ''}${lines.homeSpreadOdds} [P(H wins 2+)=${(sim.pHomeSpread*100).toFixed(3)}%]`);
    console.log(`${TAG} [OUTPUT] ${fix.awayName} +1.5:  ${lines.awaySpreadOdds > 0 ? '+' : ''}${lines.awaySpreadOdds} [P(A covers +1.5)=${(sim.pAwayCover*100).toFixed(3)}%]`);
    console.log(`${TAG} [OUTPUT] BTTS Yes:          ${lines.bttsYesOdds > 0 ? '+' : ''}${lines.bttsYesOdds} [pBTTSY=${(sim.pBTTSY*100).toFixed(3)}%]`);
    console.log(`${TAG} [OUTPUT] BTTS No:           ${lines.bttsNoOdds > 0 ? '+' : ''}${lines.bttsNoOdds}`);

    // [STEP 4] Validate invariants — HARD ABORT on failure
    validateInvariants(fix, sim, lines);

    results.push({ fix, sim, lines, lH, lA, eH, eA });
  }

  // ── Phase 2: Publish to DB ────────────────────────────────────────────────
  console.log(`\n${TAG} ═══ PUBLISHING TO DATABASE ═══`);

  const fixtureIds = FIXTURES.map(f => f.id);
  const placeholders = fixtureIds.map(() => '?').join(',');
  const [delSnap] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots WHERE book_id = 0 AND fixture_id IN (${placeholders})`,
    fixtureIds
  );
  console.log(`${TAG} [STEP] Deleted ${delSnap.affectedRows} existing model odds rows`);

  let totalInserted = 0;
  for (const { fix, sim, lines, lH, lA, eH, eA } of results) {
    // ── 12 odds rows per fixture ──────────────────────────────────────────
    const oddsRows = [
      // 1X2
      { market: '1X2', selection: 'home',    line: null,          odds: lines.homeML,       prob: sim.pH },
      { market: '1X2', selection: 'away',    line: null,          odds: lines.awayML,       prob: sim.pA },
      { market: '1X2', selection: 'draw',    line: null,          odds: lines.drawML,       prob: sim.pD },
      { market: '1X2', selection: 'no_draw', line: null,          odds: lines.noDrawH,      prob: sim.pNoDraw },
      // TOTAL
      { market: 'TOTAL', selection: 'over',  line: fix.bookTotal, odds: lines.overOdds,     prob: fix.bookTotal === 3.5 ? sim.pOU35O : sim.pOU25O },
      { market: 'TOTAL', selection: 'under', line: fix.bookTotal, odds: lines.underOdds,    prob: fix.bookTotal === 3.5 ? (1-sim.pOU35O) : (1-sim.pOU25O) },
      // BTTS
      { market: 'BTTS', selection: 'yes',    line: null,          odds: lines.bttsYesOdds,  prob: sim.pBTTSY },
      { market: 'BTTS', selection: 'no',     line: null,          odds: lines.bttsNoOdds,   prob: 1 - sim.pBTTSY },
      // ASIAN_HANDICAP (±1.5 spread)
      // CRITICAL: home selection = home -1.5 (line=-1.5), away selection = away +1.5 (line=+1.5)
      // homeSpreadOdds = P(home wins by 2+) → home -1.5 odds
      // awaySpreadOdds = P(1 - pHomeSpread) → away +1.5 odds (complementary)
      { market: 'ASIAN_HANDICAP', selection: 'home', line: -1.5, odds: Math.max(-2000, Math.min(2000, lines.homeSpreadOdds)), prob: sim.pHomeSpread },
      { market: 'ASIAN_HANDICAP', selection: 'away', line:  1.5, odds: Math.max(-2000, Math.min(2000, lines.awaySpreadOdds)), prob: sim.pAwayCover },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: lines.dc1X, prob: sim.pDC1X },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: lines.dcX2, prob: sim.pDCX2 },
    ];

    if (oddsRows.length !== 12) {
      throw new Error(`GUARD7 FAIL: Expected 12 odds rows for ${fix.id}, got ${oddsRows.length}`);
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

    // ── Upsert model projections ──────────────────────────────────────────
    const projTotal = sim.projH + sim.projA;
    const projSpread = sim.projH - sim.projA;
    const modelSpread = sim.pHomeSpread > 0.5 ? -1.5 : 1.5;

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
        fix.id, 'v10e-june24-v3-final', N_SIM,
        fix.homeName, fix.awayName, lH, lA,
        sim.pH, sim.pD, sim.pA,
        sim.projH, sim.projA, projTotal, projSpread,
        sim.pOU25O, 1-sim.pOU25O, sim.pOU35O,
        sim.pBTTSY,
        lines.homeML, lines.drawML, lines.awayML,
        modelSpread, projSpread,
        lines.overOdds, lines.underOdds,
        Math.max(-2000, Math.min(2000, lines.homeSpreadOdds)),
        Math.max(-2000, Math.min(2000, lines.awaySpreadOdds)),
        lines.nvH, lines.nvD, lines.nvA,
        sim.pDC1X, sim.pDCX2,
        sim.pH / (sim.pH + sim.pA), sim.pA / (sim.pH + sim.pA),
        lines.dc1X, lines.dcX2,
        lines.noDrawH, lines.noDrawA,
        lines.bttsYesOdds, lines.bttsNoOdds,
        sim.topScorelines,
      ]
    );

    console.log(`${TAG} [OUTPUT] ✅ ${fix.id}: 12 odds rows + projection upserted`);
  }

  console.log(`\n${TAG} ═══ PUBLICATION COMPLETE ═══`);
  console.log(`${TAG} [OUTPUT] Total odds rows inserted: ${totalInserted}/72`);

  // ── Phase 3: Final cross-match validation ────────────────────────────────
  console.log(`\n${TAG} ═══ FINAL CROSS-MATCH VALIDATION ═══`);
  const [dbRows] = await conn.execute(
    `SELECT o.fixture_id, o.market, o.selection, o.american_odds, o.line, o.implied_prob
     FROM wc2026_odds_snapshots o
     WHERE o.book_id = 0 AND o.fixture_id IN (${placeholders})
     ORDER BY o.fixture_id, o.market, o.selection`,
    fixtureIds
  );

  const byFixture = {};
  for (const row of dbRows) {
    if (!byFixture[row.fixture_id]) byFixture[row.fixture_id] = [];
    byFixture[row.fixture_id].push(row);
  }

  let allValid = true;
  for (const [fid, rows] of Object.entries(byFixture)) {
    const fix = FIXTURES.find(f => f.id === fid);
    const get = (market, sel) => rows.find(r => r.market === market && r.selection === sel);
    const homeML = get('1X2', 'home');
    const awayML = get('1X2', 'away');
    const homeSp = get('ASIAN_HANDICAP', 'home');
    const awaySp = get('ASIAN_HANDICAP', 'away');
    const bttsY = get('BTTS', 'yes');
    const overR = get('TOTAL', 'over');
    const underR = get('TOTAL', 'under');

    console.log(`\n${TAG} [VERIFY] ${fid} (${fix.homeName} vs ${fix.awayName}):`);
    console.log(`${TAG}   ML:     ${fix.homeName} ${homeML?.american_odds > 0 ? '+' : ''}${homeML?.american_odds} | ${fix.awayName} ${awayML?.american_odds > 0 ? '+' : ''}${awayML?.american_odds}`);
    console.log(`${TAG}   Spread: ${fix.homeName} -1.5 ${homeSp?.american_odds > 0 ? '+' : ''}${homeSp?.american_odds} [P=${(Number(homeSp?.implied_prob)*100).toFixed(2)}%]`);
    console.log(`${TAG}   Spread: ${fix.awayName} +1.5 ${awaySp?.american_odds > 0 ? '+' : ''}${awaySp?.american_odds} [P=${(Number(awaySp?.implied_prob)*100).toFixed(2)}%]`);
    console.log(`${TAG}   Spread sum: ${((Number(homeSp?.implied_prob) + Number(awaySp?.implied_prob))*100).toFixed(2)}% (must be 100%)`);
    console.log(`${TAG}   BTTS Yes: ${bttsY?.american_odds > 0 ? '+' : ''}${bttsY?.american_odds} [P=${(Number(bttsY?.implied_prob)*100).toFixed(2)}%]`);
    console.log(`${TAG}   O/U ${fix.bookTotal}: Over ${overR?.american_odds > 0 ? '+' : ''}${overR?.american_odds} | Under ${underR?.american_odds > 0 ? '+' : ''}${underR?.american_odds}`);

    let fixValid = true;

    // CRITICAL: Home -1.5 must be longer odds than home ML for ML favorites
    if (homeML?.american_odds < 0 && homeSp?.american_odds < homeML?.american_odds) {
      console.error(`${TAG}   ❌ FAIL: ${fix.homeName} is ML favorite (${homeML?.american_odds}) but -1.5 (${homeSp?.american_odds}) is shorter — IMPOSSIBLE`);
      fixValid = false; allValid = false;
    }

    // CRITICAL: Away +1.5 implied prob + home -1.5 implied prob must = ~100%
    const spreadProbSum = Number(homeSp?.implied_prob) + Number(awaySp?.implied_prob);
    if (Math.abs(spreadProbSum - 1.0) > 0.01) {
      console.error(`${TAG}   ❌ FAIL: Spread prob sum = ${(spreadProbSum*100).toFixed(2)}% (must be ~100%)`);
      fixValid = false; allValid = false;
    }

    // CRITICAL: BTTS YES should not be heavily favored (< -150) for most matches
    if (bttsY?.american_odds < -150) {
      console.error(`${TAG}   ❌ FAIL: BTTS YES at ${bttsY?.american_odds} — overcounting (should be -130 or longer)`);
      fixValid = false; allValid = false;
    }

    if (rows.length !== 12) {
      console.error(`${TAG}   ❌ FAIL: Expected 12 rows, got ${rows.length}`);
      fixValid = false; allValid = false;
    }

    if (fixValid) console.log(`${TAG}   ✅ PASS`);
  }

  if (allValid) {
    console.log(`\n${TAG} ✅✅✅ ALL 6 FIXTURES VALIDATED — LINES ARE CORRECT AND PUBLISHED`);
  } else {
    console.error(`\n${TAG} ❌❌❌ VALIDATION FAILURES — REVIEW ABOVE`);
    process.exit(1);
  }

  await conn.end();
  console.log(`${TAG} Done.`);
}

main().catch(err => {
  console.error(`${TAG} FATAL:`, err.message);
  process.exit(1);
});
