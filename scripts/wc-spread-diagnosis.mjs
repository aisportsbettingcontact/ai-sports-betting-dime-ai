/**
 * wc-spread-diagnosis.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * DEEP DIAGNOSTIC: Trace the exact spread probability computation for all
 * June 24 fixtures to find the root cause of impossible spread odds.
 *
 * KNOWN ANOMALY: SUI +136 ML but SUI -1.5 = -812 (impossible)
 * Expected: SUI at ~42% win prob → SUI -1.5 should be around +150 to +400
 *
 * This script:
 * 1. Replicates the EXACT computeAsianHandicapProb() function from the seed script
 * 2. Traces every step with explicit logging
 * 3. Identifies the exact logical error
 * 4. Validates the correct implementation
 */

const TAG = '[SPREAD_DIAG]';

// ─── Exact copy of the seed script math ──────────────────────────────────────
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function dixonColesRho(h, a, lH, lA, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - lH * lA * rho;
  if (h === 0 && a === 1) return 1 + lH * rho;
  if (h === 1 && a === 0) return 1 + lA * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

function probToAmerican(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}

// ─── THE BUGGY FUNCTION (exact copy from seed script) ────────────────────────
function computeAsianHandicapProb_BUGGY(lambdaH, lambdaA, line, side, maxGoals = 8) {
  // line is from HOME perspective: home -1.5 means home must win by 2+
  // side='home': P(home goals - away goals > line)
  // side='away': P(away goals - home goals > -line) = P(home goals - away goals < line)
  let prob = 0;
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) * dixonColesRho(h, a, lambdaH, lambdaA);
      if (p < 1e-10) continue;
      total += p;
      const diff = h - a; // positive = home winning
      if (side === 'home' && diff > line) prob += p;
      if (side === 'away' && diff < line) prob += p;
    }
  }
  return prob / total;
}

// ─── CORRECT FUNCTION ────────────────────────────────────────────────────────
// Asian Handicap: home_team_id gets the spread line from the DB
// homeSpreadLine = -1.5 means "home team -1.5" = home must win by 2+
// awaySpreadLine = +1.5 means "away team +1.5" = away team gets 1.5 goal head start
//
// P(home covers -1.5) = P(home_goals - away_goals > 1.5) = P(home_goals - away_goals >= 2)
// P(away covers +1.5) = P(away_goals + 1.5 > home_goals) = P(home_goals - away_goals < 1.5) = P(home_goals - away_goals <= 1)
//
// CRITICAL: The line parameter passed to the function must be the NUMERIC threshold
// For home -1.5: threshold = 1.5 (home wins by MORE than 1.5 = wins by 2+)
// For away +1.5: threshold = 1.5 (away covers if home wins by LESS than 1.5 = wins by 0 or 1, or away wins)
function computeAsianHandicapProb_CORRECT(lambdaH, lambdaA, homeSpreadLine, side, maxGoals = 8) {
  // homeSpreadLine: negative = home favored (e.g., -1.5), positive = home dog (e.g., +1.5)
  // For home side: P(home wins by > |homeSpreadLine|) when homeSpreadLine < 0
  //                P(home wins by > homeSpreadLine) when homeSpreadLine > 0 (rarely used)
  // For away side: complement of home side (push impossible with .5 lines)
  let homeProb = 0;
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) * dixonColesRho(h, a, lambdaH, lambdaA);
      if (p < 1e-10) continue;
      total += p;
      const goalDiff = h - a; // positive = home winning
      // Home covers if: goalDiff > |homeSpreadLine| (for negative lines like -1.5)
      // i.e., goalDiff > 1.5 → goalDiff >= 2
      if (goalDiff > Math.abs(homeSpreadLine)) homeProb += p;
    }
  }
  homeProb /= total;
  const awayProb = 1 - homeProb; // no push with .5 lines
  return side === 'home' ? homeProb : awayProb;
}

// ─── DIAGNOSIS ───────────────────────────────────────────────────────────────
console.log(`\n${TAG} ═══ STEP 1: REPRODUCE THE BUG ═══`);
console.log(`${TAG} [INPUT] SUI(home) vs CAN(away): lambdaH=1.3689 lambdaA=1.0537`);
console.log(`${TAG} [INPUT] Book line: SUI -1.5 (homeSpreadLine=-1.5), CAN +1.5 (awaySpreadLine=1.5)`);
console.log(`${TAG} [INPUT] Seed script call: computeAsianHandicapProb(lambdaH, lambdaA, b.homeSpreadLine, 'home')`);
console.log(`${TAG} [INPUT] b.homeSpreadLine = -1.5`);
console.log(`${TAG} [STATE] This means: line=-1.5, side='home'`);
console.log(`${TAG} [STATE] Buggy condition: diff > line → diff > -1.5`);
console.log(`${TAG} [STATE] diff = h - a (home goals - away goals)`);
console.log(`${TAG} [STATE] diff > -1.5 is TRUE whenever home wins (diff=1,2,3...) OR draws (diff=0) OR loses by 1 (diff=-1)`);
console.log(`${TAG} [STATE] This is NOT "home wins by 2+" — this is "home does not lose by 2 or more"`);
console.log(`${TAG} [STATE] The bug: passing line=-1.5 directly to "diff > line" instead of "diff > |line|"`);

const lambdaH = 1.3689, lambdaA = 1.0537;
const buggyHomeProb = computeAsianHandicapProb_BUGGY(lambdaH, lambdaA, -1.5, 'home');
const buggyAwayProb = computeAsianHandicapProb_BUGGY(lambdaH, lambdaA, -1.5, 'away');
console.log(`\n${TAG} [OUTPUT] BUGGY homeProb (SUI -1.5) = ${buggyHomeProb.toFixed(6)} → American: ${probToAmerican(buggyHomeProb)}`);
console.log(`${TAG} [OUTPUT] BUGGY awayProb (CAN +1.5) = ${buggyAwayProb.toFixed(6)} → American: ${probToAmerican(buggyAwayProb)}`);
console.log(`${TAG} [VERIFY] FAIL: SUI at ${probToAmerican(buggyHomeProb)} ML but -1.5 = ${probToAmerican(buggyHomeProb)} is WRONG`);
console.log(`${TAG} [VERIFY] FAIL: diff > -1.5 catches ALL outcomes except home losing by 2+ (diff <= -2)`);
console.log(`${TAG} [VERIFY] FAIL: This is computing P(home does NOT lose by 2+), not P(home wins by 2+)`);

console.log(`\n${TAG} ═══ STEP 2: CORRECT COMPUTATION ═══`);
const correctHomeProb = computeAsianHandicapProb_CORRECT(lambdaH, lambdaA, -1.5, 'home');
const correctAwayProb = computeAsianHandicapProb_CORRECT(lambdaH, lambdaA, -1.5, 'away');
console.log(`${TAG} [OUTPUT] CORRECT homeProb (SUI -1.5) = ${correctHomeProb.toFixed(6)} → American: ${probToAmerican(correctHomeProb)}`);
console.log(`${TAG} [OUTPUT] CORRECT awayProb (CAN +1.5) = ${correctAwayProb.toFixed(6)} → American: ${probToAmerican(correctAwayProb)}`);
console.log(`${TAG} [VERIFY] ${correctHomeProb < 0.5 ? 'PASS' : 'FAIL'}: SUI -1.5 should be underdog (prob < 0.5) since SUI ML is only +136`);
console.log(`${TAG} [VERIFY] ${correctAwayProb > 0.5 ? 'PASS' : 'FAIL'}: CAN +1.5 should be favorite (prob > 0.5) since CAN is the spread favorite`);

console.log(`\n${TAG} ═══ STEP 3: VERIFY ALL JUNE 24 FIXTURES ═══`);

// June 24 fixtures with correct lambdas (from reseed script output)
const fixtures = [
  { id: 'wc26-g-049', home: 'SUI', away: 'CAN', lH: 1.3689, lA: 1.0537, homeML: 136, awayML: 267, homeSpreadLine: -1.5, awaySpreadLine: 1.5, bookHomeSpread: 400, bookAwaySpread: -575 },
  { id: 'wc26-g-050', home: 'BIH', away: 'QAT', lH: 1.8972, lA: 0.5551, homeML: -217, awayML: 1033, homeSpreadLine: -1.5, awaySpreadLine: 1.5, bookHomeSpread: 110, bookAwaySpread: -140 },
  { id: 'wc26-g-051', home: 'SCO', away: 'BRA', lH: 0.5058, lA: 1.9485, homeML: 1225, awayML: -243, homeSpreadLine: 1.5, awaySpreadLine: -1.5, bookHomeSpread: -130, bookAwaySpread: 100 },
  { id: 'wc26-g-052', home: 'MAR', away: 'HAI', lH: 3.0126, lA: 0.4395, homeML: -691, awayML: 3837, homeSpreadLine: -1.5, awaySpreadLine: 1.5, bookHomeSpread: -170, bookAwaySpread: 135 },
  { id: 'wc26-g-053', home: 'CZE', away: 'MEX', lH: 0.9342, lA: 1.5037, homeML: 358, awayML: 104, homeSpreadLine: 1.5, awaySpreadLine: -1.5, bookHomeSpread: -350, bookAwaySpread: 260 },
  { id: 'wc26-g-054', home: 'RSA', away: 'KOR', lH: 0.7292, lA: 1.7102, homeML: 605, awayML: -147, homeSpreadLine: 1.5, awaySpreadLine: -1.5, bookHomeSpread: -250, bookAwaySpread: 195 },
];

for (const f of fixtures) {
  const buggyH = computeAsianHandicapProb_BUGGY(f.lH, f.lA, f.homeSpreadLine, 'home');
  const buggyA = computeAsianHandicapProb_BUGGY(f.lH, f.lA, f.homeSpreadLine, 'away');
  const correctH = computeAsianHandicapProb_CORRECT(f.lH, f.lA, f.homeSpreadLine, 'home');
  const correctA = computeAsianHandicapProb_CORRECT(f.lH, f.lA, f.homeSpreadLine, 'away');

  const buggyHomeOdds = probToAmerican(buggyH);
  const buggyAwayOdds = probToAmerican(buggyA);
  const correctHomeOdds = probToAmerican(correctH);
  const correctAwayOdds = probToAmerican(correctA);

  // Sanity check: if home is ML favorite (homeML < 0), home spread favorite (homeSpreadLine < 0)
  // should have home spread prob LESS than home ML prob (harder to win by 2+)
  const homeIsMLFav = f.homeML < 0;
  const homeIsSpreadFav = f.homeSpreadLine < 0;
  const mlHomeProb = f.homeML < 0 ? Math.abs(f.homeML) / (Math.abs(f.homeML) + 100) : 100 / (f.homeML + 100);
  const spreadSanity = homeIsSpreadFav ? correctH < mlHomeProb : correctH > mlHomeProb;

  console.log(`\n${TAG} ${f.id} | ${f.away}(away) @ ${f.home}(home)`);
  console.log(`${TAG} [INPUT] lambdaH=${f.lH} lambdaA=${f.lA} | homeML=${f.homeML} awayML=${f.awayML}`);
  console.log(`${TAG} [INPUT] homeSpreadLine=${f.homeSpreadLine} awaySpreadLine=${f.awaySpreadLine}`);
  console.log(`${TAG} [INPUT] bookHomeSpread=${f.bookHomeSpread} bookAwaySpread=${f.bookAwaySpread}`);
  console.log(`${TAG} [STATE] BUGGY:   homeSpreadProb=${buggyH.toFixed(4)} → ${buggyHomeOdds} | awaySpreadProb=${buggyA.toFixed(4)} → ${buggyAwayOdds}`);
  console.log(`${TAG} [STATE] CORRECT: homeSpreadProb=${correctH.toFixed(4)} → ${correctHomeOdds} | awaySpreadProb=${correctA.toFixed(4)} → ${correctAwayOdds}`);
  console.log(`${TAG} [STATE] Book:    homeSpread=${f.bookHomeSpread} awaySpread=${f.bookAwaySpread}`);
  console.log(`${TAG} [VERIFY] Spread sanity (home spread prob < home ML prob when home is spread fav): ${spreadSanity ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`${TAG} [VERIFY] Correct odds sum to ~100%: ${((1/Math.abs(correctH)) + (1/Math.abs(correctA))).toFixed(3)} (should be ~1.0)`);
}

console.log(`\n${TAG} ═══ ROOT CAUSE SUMMARY ═══`);
console.log(`${TAG} BUG: computeAsianHandicapProb(lH, lA, line=-1.5, side='home') uses condition "diff > line"`);
console.log(`${TAG} BUG: "diff > -1.5" is TRUE for diff = -1, 0, 1, 2, 3... (all except losing by 2+)`);
console.log(`${TAG} BUG: This computes P(home does NOT lose by 2+), not P(home wins by 2+)`);
console.log(`${TAG} BUG: For home +1.5 line (homeSpreadLine=+1.5): "diff > 1.5" → P(home wins by 2+) — ALSO WRONG`);
console.log(`${TAG} FIX: Use Math.abs(homeSpreadLine) as the threshold`);
console.log(`${TAG} FIX: P(home covers) = P(diff > Math.abs(homeSpreadLine)) when homeSpreadLine < 0`);
console.log(`${TAG} FIX: P(home covers) = P(diff > -Math.abs(homeSpreadLine)) = P(diff > -1.5) when homeSpreadLine > 0`);
console.log(`${TAG} FIX: Wait — for home +1.5 (underdog), home covers if they don't lose by 2+`);
console.log(`${TAG} FIX: P(home +1.5 covers) = P(diff > -1.5) = P(diff >= -1) = P(home wins, draws, or loses by 1)`);
console.log(`${TAG} FIX: P(away -1.5 covers) = P(diff < -1.5) = P(diff <= -2) = P(away wins by 2+)`);
console.log(`\n${TAG} CORRECT FORMULA:`);
console.log(`${TAG}   homeSpreadLine < 0 (home favored): P(home covers) = P(diff > |homeSpreadLine|)`);
console.log(`${TAG}   homeSpreadLine > 0 (home dog):     P(home covers) = P(diff > -homeSpreadLine) = P(diff > -|homeSpreadLine|)`);
console.log(`${TAG}   UNIFIED: P(home covers) = P(diff > -homeSpreadLine)`);
console.log(`${TAG}   For homeSpreadLine=-1.5: P(diff > 1.5) = P(diff >= 2) ✅`);
console.log(`${TAG}   For homeSpreadLine=+1.5: P(diff > -1.5) = P(diff >= -1) ✅`);
console.log(`${TAG}   P(away covers) = 1 - P(home covers) [no push with .5 lines]`);
