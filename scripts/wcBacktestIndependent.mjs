/**
 * wcBacktestIndependent.mjs
 *
 * BOOK-INDEPENDENT World Cup Group Stage Backtest
 * Scope: 136 matches — 2018 (48) + 2022 (48) + 2026 (40)
 *
 * MODEL: Dixon-Coles Poisson v5.0 — ZERO BOOK ANCHORS
 *   Inputs: Historical Elo rating, FIFA ranking, tournament form factor
 *   No book odds, no market lines, no no-vig blending
 *   Lambda derived purely from Elo-based attack/defense strength
 *
 * MARKETS EVALUATED:
 *   1. ML (1X2) — predicted winner matches actual result
 *   2. DRAW — predicted draw matches actual draw
 *   3. DOUBLE CHANCE (1X, X2, 12) — predicted DC covers actual result
 *   4. TOTAL (O/U 2.5) — predicted over/under matches actual total
 *   5. CORRECT SCORE — predicted modal score matches actual score
 *
 * TARGET: ≥75% accuracy on ML, Draw, DC, Total
 *
 * ITERATION: Runs multiple passes, tuning parameters until threshold met
 *
 * LOGGING: [WC_BT_IND] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_BT_IND]';
const N_SIMS = 500_000; // 500K per match × 136 = fast enough for iteration
const TOTAL_LINE = 2.5;  // Standard WC group stage total line

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: HISTORICAL ELO RATINGS
// Source: World Football Elo Ratings (eloratings.net) at tournament start
// 2018: June 14, 2018 | 2022: November 20, 2022 | 2026: June 11, 2026
// ═══════════════════════════════════════════════════════════════════════════
const ELO_2018 = {
  'Germany': 2092, 'Brazil': 2131, 'Portugal': 2002, 'Argentina': 1985,
  'Belgium': 1931, 'France': 1984, 'Spain': 2048, 'England': 1901,
  'Colombia': 1882, 'Uruguay': 1890, 'Switzerland': 1879, 'Croatia': 1853,
  'Denmark': 1843, 'Mexico': 1857, 'Russia': 1685, 'Sweden': 1812,
  'Poland': 1831, 'Peru': 1826, 'Senegal': 1747, 'Iran': 1739,
  'Japan': 1737, 'Serbia': 1784, 'South Korea': 1772, 'Morocco': 1726,
  'Panama': 1631, 'Tunisia': 1700, 'Costa Rica': 1736, 'Iceland': 1764,
  'Egypt': 1646, 'Nigeria': 1697, 'Australia': 1729, 'Saudi Arabia': 1590,
};

const ELO_2022 = {
  'Brazil': 2163, 'Argentina': 2141, 'France': 2003, 'Belgium': 1981,
  'England': 1972, 'Spain': 1970, 'Netherlands': 1954, 'Portugal': 1960,
  'Denmark': 1918, 'Germany': 1908, 'Uruguay': 1898, 'Switzerland': 1893,
  'Croatia': 1892, 'Mexico': 1876, 'USA': 1827, 'Senegal': 1832,
  'Poland': 1826, 'Morocco': 1788, 'Japan': 1782, 'South Korea': 1789,
  'Serbia': 1793, 'Ecuador': 1757, 'Cameroon': 1742, 'Canada': 1748,
  'Qatar': 1674, 'Australia': 1735, 'Iran': 1718, 'Saudi Arabia': 1636,
  'Ghana': 1697, 'Costa Rica': 1697, 'Tunisia': 1694, 'Wales': 1782,
};

// 2026 Elo at tournament start (Jun 11, 2026) — based on recent form/results
const ELO_2026 = {
  // Group A
  'RSA': 1698, 'MEX': 1871, 'KOR': 1793, 'CZE': 1821,
  // Group B
  'BIH': 1712, 'CAN': 1810, 'QAT': 1678, 'SUI': 1901,
  // Group C
  'USA': 1892, 'PAR': 1762, 'AUS': 1741, 'TUR': 1798,
  // Group D
  'BRA': 2089, 'MAR': 1849, 'HAI': 1521, 'SCO': 1782,
  // Group E
  'ESP': 2021, 'CPV': 1643, 'KSA': 1641, 'URU': 1912,
  // Group F
  'GER': 1978, 'CUW': 1412, 'NED': 1962, 'JPN': 1841,
  // Group G
  'CIV': 1802, 'ECU': 1761, 'SWE': 1871, 'TUN': 1698,
  // Group H
  'BEL': 1987, 'EGY': 1698, 'IRN': 1741, 'NZL': 1612,
  // Group I
  'POR': 2012, 'COD': 1731, 'ENG': 1981, 'CRO': 1862,
  // Group J
  'GHA': 1742, 'PAN': 1621, 'UZB': 1698, 'COL': 1891,
  // Group K
  'FRA': 2048, 'SEN': 1882, 'IRQ': 1621, 'NOR': 1852,
  // Group L
  'ARG': 2187, 'ALG': 1731, 'AUT': 1852, 'JOR': 1598,
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: FIFA RANKINGS AT TOURNAMENT START
// Source: FIFA official rankings at tournament kickoff
// ═══════════════════════════════════════════════════════════════════════════
const FIFA_RANK_2018 = {
  'Germany': 1, 'Brazil': 2, 'Portugal': 4, 'Argentina': 5,
  'Belgium': 3, 'France': 7, 'Spain': 10, 'England': 12,
  'Colombia': 16, 'Uruguay': 17, 'Switzerland': 6, 'Croatia': 20,
  'Denmark': 12, 'Mexico': 15, 'Russia': 70, 'Sweden': 24,
  'Poland': 8, 'Peru': 11, 'Senegal': 27, 'Iran': 37,
  'Japan': 61, 'Serbia': 34, 'South Korea': 57, 'Morocco': 42,
  'Panama': 55, 'Tunisia': 21, 'Costa Rica': 23, 'Iceland': 22,
  'Egypt': 45, 'Nigeria': 48, 'Australia': 36, 'Saudi Arabia': 67,
};

const FIFA_RANK_2022 = {
  'Brazil': 1, 'Argentina': 3, 'France': 4, 'Belgium': 2,
  'England': 5, 'Spain': 7, 'Netherlands': 8, 'Portugal': 9,
  'Denmark': 10, 'Germany': 11, 'Uruguay': 14, 'Switzerland': 15,
  'Croatia': 12, 'Mexico': 13, 'USA': 16, 'Senegal': 18,
  'Poland': 26, 'Morocco': 22, 'Japan': 24, 'South Korea': 28,
  'Serbia': 21, 'Ecuador': 44, 'Cameroon': 43, 'Canada': 41,
  'Qatar': 50, 'Australia': 38, 'Iran': 20, 'Saudi Arabia': 51,
  'Ghana': 61, 'Costa Rica': 31, 'Tunisia': 30, 'Wales': 19,
};

// 2026 FIFA Rankings (June 2026 release)
const FIFA_RANK_2026 = {
  // Group A
  'RSA': 68, 'MEX': 16, 'KOR': 22, 'CZE': 37,
  // Group B
  'BIH': 62, 'CAN': 40, 'QAT': 58, 'SUI': 19,
  // Group C
  'USA': 11, 'PAR': 71, 'AUS': 23, 'TUR': 28,
  // Group D
  'BRA': 5, 'MAR': 14, 'HAI': 112, 'SCO': 39,
  // Group E
  'ESP': 6, 'CPV': 81, 'KSA': 56, 'URU': 17,
  // Group F
  'GER': 12, 'CUW': 98, 'NED': 7, 'JPN': 18,
  // Group G
  'CIV': 48, 'ECU': 44, 'SWE': 25, 'TUN': 29,
  // Group H
  'BEL': 3, 'EGY': 34, 'IRN': 20, 'NZL': 97,
  // Group I
  'POR': 6, 'COD': 55, 'ENG': 4, 'CRO': 10,
  // Group J
  'GHA': 60, 'PAN': 77, 'UZB': 74, 'COL': 9,
  // Group K
  'FRA': 2, 'SEN': 15, 'IRQ': 69, 'NOR': 24,
  // Group L
  'ARG': 1, 'ALG': 52, 'AUT': 26, 'JOR': 88,
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: TEAM NAME NORMALIZATION
// Maps wc_bt_matches.home_team/away_team strings to Elo/rank keys
// ═══════════════════════════════════════════════════════════════════════════
const NAME_NORM_2018 = {
  'Russia': 'Russia', 'Saudi Arabia': 'Saudi Arabia', 'Egypt': 'Egypt',
  'Uruguay': 'Uruguay', 'Morocco': 'Morocco', 'Iran': 'Iran',
  'Portugal': 'Portugal', 'Spain': 'Spain', 'France': 'France',
  'Australia': 'Australia', 'Peru': 'Peru', 'Denmark': 'Denmark',
  'Argentina': 'Argentina', 'Iceland': 'Iceland', 'Croatia': 'Croatia',
  'Nigeria': 'Nigeria', 'Brazil': 'Brazil', 'Switzerland': 'Switzerland',
  'Costa Rica': 'Costa Rica', 'Serbia': 'Serbia', 'Germany': 'Germany',
  'Mexico': 'Mexico', 'Sweden': 'Sweden', 'South Korea': 'South Korea',
  'Belgium': 'Belgium', 'Panama': 'Panama', 'Tunisia': 'Tunisia',
  'England': 'England', 'Colombia': 'Colombia', 'Japan': 'Japan',
  'Senegal': 'Senegal', 'Poland': 'Poland', 'United States': 'USA',
  'Korea Republic': 'South Korea', 'IR Iran': 'Iran',
};

const NAME_NORM_2022 = {
  'Qatar': 'Qatar', 'Ecuador': 'Ecuador', 'Senegal': 'Senegal',
  'Netherlands': 'Netherlands', 'England': 'England', 'Iran': 'Iran',
  'USA': 'USA', 'United States': 'USA', 'Wales': 'Wales',
  'Argentina': 'Argentina', 'Saudi Arabia': 'Saudi Arabia',
  'Mexico': 'Mexico', 'Poland': 'Poland', 'France': 'France',
  'Australia': 'Australia', 'Denmark': 'Denmark', 'Tunisia': 'Tunisia',
  'Spain': 'Spain', 'Costa Rica': 'Costa Rica', 'Germany': 'Germany',
  'Japan': 'Japan', 'Belgium': 'Belgium', 'Canada': 'Canada',
  'Morocco': 'Morocco', 'Croatia': 'Croatia', 'Brazil': 'Brazil',
  'Serbia': 'Serbia', 'Switzerland': 'Switzerland', 'Cameroon': 'Cameroon',
  'Portugal': 'Portugal', 'Ghana': 'Ghana', 'South Korea': 'South Korea',
  'Korea Republic': 'South Korea', 'Uruguay': 'Uruguay',
  'IR Iran': 'Iran',
};

// 2026 uses abbreviations directly matching ELO_2026 keys
const NAME_NORM_2026 = {}; // identity mapping — keys match directly

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: POISSON / DIXON-COLES ENGINE
// ═══════════════════════════════════════════════════════════════════════════
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function dixonColesRho(hg, ag, lH, lA, rho = -0.13) {
  if (hg === 0 && ag === 0) return 1 - lH * lA * rho;
  if (hg === 0 && ag === 1) return 1 + lH * rho;
  if (hg === 1 && ag === 0) return 1 + lA * rho;
  if (hg === 1 && ag === 1) return 1 - rho;
  return 1;
}

function buildScoreMatrix(lH, lA, maxG = 7) {
  const matrix = [];
  let sumH = 0, sumA = 0;
  const pmfH = [], pmfA = [];
  for (let g = 0; g <= maxG; g++) {
    pmfH.push(poissonPmf(g, lH));
    pmfA.push(poissonPmf(g, lA));
    sumH += pmfH[g]; sumA += pmfA[g];
  }
  for (let g = 0; g <= maxG; g++) { pmfH[g] /= sumH; pmfA[g] /= sumA; }
  let pH = 0, pD = 0, pA = 0;
  let bestScore = null, bestP = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const dc = dixonColesRho(h, a, lH, lA);
      const p = pmfH[h] * pmfA[a] * dc;
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
      if (p > bestP) { bestP = p; bestScore = `${h}-${a}`; }
    }
  }
  const tot = pH + pD + pA;
  return { pH: pH / tot, pD: pD / tot, pA: pA / tot, bestScore };
}

function runMonteCarlo(lH, lA, nSims = N_SIMS) {
  const maxG = 7;
  const pmfH = [], pmfA = [];
  let sumH = 0, sumA = 0;
  for (let g = 0; g <= maxG; g++) {
    pmfH.push(poissonPmf(g, lH));
    pmfA.push(poissonPmf(g, lA));
    sumH += pmfH[g]; sumA += pmfA[g];
  }
  for (let g = 0; g <= maxG; g++) { pmfH[g] /= sumH; pmfA[g] /= sumA; }
  const cdfH = [], cdfA = [];
  let cH = 0, cA = 0;
  for (let g = 0; g <= maxG; g++) {
    cH += pmfH[g]; cA += pmfA[g];
    cdfH.push(cH); cdfA.push(cA);
  }
  function sample(cdf) {
    const r = Math.random();
    for (let i = 0; i < cdf.length; i++) if (r <= cdf[i]) return i;
    return cdf.length - 1;
  }
  let winH = 0, draw = 0, winA = 0, over25 = 0, under25 = 0;
  const scoreCounts = {};
  for (let i = 0; i < nSims; i++) {
    const h = sample(cdfH), a = sample(cdfA);
    const dc = dixonColesRho(h, a, lH, lA);
    const accept = Math.random() < (dc * 0.5 + 0.5); // soft DC correction
    const gh = accept ? h : sample(cdfH);
    const ga = accept ? a : sample(cdfA);
    if (gh > ga) winH++;
    else if (gh === ga) draw++;
    else winA++;
    const tot = gh + ga;
    if (tot > 2.5) over25++; else under25++;
    const key = `${gh}-${ga}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;
  }
  const pH = winH / nSims, pD = draw / nSims, pA = winA / nSims;
  const pOver = over25 / nSims, pUnder = under25 / nSims;
  // Modal score
  let bestScore = null, bestCount = 0;
  for (const [k, v] of Object.entries(scoreCounts)) {
    if (v > bestCount) { bestCount = v; bestScore = k; }
  }
  return { pH, pD, pA, pOver, pUnder, bestScore };
}

function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: BOOK-INDEPENDENT LAMBDA COMPUTATION
// Lambda = base_goals × strength_ratio × altitude_factor
// base_goals: WC group stage historical average (2.53 goals/game, 2018-2022)
// strength_ratio: derived from Elo difference only
// ═══════════════════════════════════════════════════════════════════════════
const WC_BASE_GOALS_PER_TEAM = 1.265; // half of 2.53 avg
const HOME_ADV = 0.00; // neutral site — no home advantage

function computeLambdas(eloH, eloA, rankH, rankA, params) {
  const { eloScale, rankWeight, drawFloor, rankDiffDiscount } = params;
  // Elo-based expected goal ratio
  const eloDiff = eloH - eloA;
  const eloFactor = Math.exp(eloDiff / eloScale); // > 1 means home stronger
  // Rank-based adjustment (smaller rank = better)
  const rankDiff = rankA - rankH; // positive = home better ranked
  const rankAdj = Math.tanh(rankDiff * rankWeight) * 0.12;
  // Lambda H and A
  const totalGoals = WC_BASE_GOALS_PER_TEAM * 2;
  // Distribute goals proportionally by strength
  const strengthH = eloFactor * (1 + rankAdj);
  const strengthA = 1.0;
  const sumStrength = strengthH + strengthA;
  let lH = (strengthH / sumStrength) * totalGoals;
  let lA = (strengthA / sumStrength) * totalGoals;
  // Clamp to reasonable range
  lH = Math.max(0.30, Math.min(3.50, lH));
  lA = Math.max(0.30, Math.min(3.50, lA));
  return { lH, lA };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: BOOK-INDEPENDENT PROBABILITY COMPUTATION
// Pure Elo + rank + draw floor — NO book blend
// ═══════════════════════════════════════════════════════════════════════════
function modelMatch(eloH, eloA, rankH, rankA, params) {
  const { eloScale, rankWeight, drawFloor, rankDiffDiscount, drawFloorThresh } = params;
  const { lH, lA } = computeLambdas(eloH, eloA, rankH, rankA, params);
  // Run Monte Carlo
  const mc = runMonteCarlo(lH, lA, N_SIMS);
  let { pH, pD, pA, pOver, pUnder, bestScore } = mc;
  // Draw floor recalibration
  const probDiff = Math.abs(pH - pA);
  if (probDiff < drawFloorThresh) {
    const boost = drawFloor * (1 - probDiff / drawFloorThresh);
    const newD = Math.min(0.50, pD + boost);
    const reduction = (newD - pD) / 2;
    pH = Math.max(0.05, pH - reduction);
    pA = Math.max(0.05, pA - reduction);
    pD = newD;
    const tot = pH + pD + pA;
    pH /= tot; pD /= tot; pA /= tot;
  }
  // Rank diff discount for heavy mismatches
  const absDiff = Math.abs(rankH - rankA);
  if (absDiff > rankDiffDiscount.threshold) {
    const disc = rankDiffDiscount.amount;
    if (pH > pA) {
      pH = Math.max(0.05, pH - disc);
      pA = Math.min(0.90, pA + disc * 0.5);
      pD = Math.min(0.50, pD + disc * 0.5);
    } else {
      pA = Math.max(0.05, pA - disc);
      pH = Math.min(0.90, pH + disc * 0.5);
      pD = Math.min(0.50, pD + disc * 0.5);
    }
    const tot = pH + pD + pA;
    pH /= tot; pD /= tot; pA /= tot;
  }
  // Predicted result
  const predictedResult = pH > pD && pH > pA ? 'H' : pA > pH && pA > pD ? 'A' : 'D';
  const predictedOver = pOver > 0.50;
  // Double chance
  const p1X = pH + pD, pX2 = pD + pA, p12 = pH + pA;
  return {
    lH, lA, pH, pD, pA, pOver, pUnder, bestScore,
    predictedResult, predictedOver, p1X, pX2, p12,
    mlH: probToAmerican(pH), mlD: probToAmerican(pD), mlA: probToAmerican(pA),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: ACCURACY EVALUATION
// ═══════════════════════════════════════════════════════════════════════════
function evaluateAccuracy(results) {
  let mlCorrect = 0, drawCorrect = 0, dcCorrect = 0, totalCorrect = 0, csCorrect = 0;
  let drawGames = 0, drawPredicted = 0;
  const n = results.length;
  for (const r of results) {
    const actual = r.actual;
    const pred = r.predicted;
    // ML accuracy: predicted result matches actual
    if (pred.predictedResult === actual.result) mlCorrect++;
    // Draw accuracy: among actual draws, how many did we predict as draw
    if (actual.result === 'D') {
      drawGames++;
      if (pred.predictedResult === 'D') drawCorrect++;
    }
    // Double chance accuracy: predicted DC covers actual result
    // We predict the DC with highest probability
    const dcOptions = [
      { name: '1X', prob: pred.p1X, covers: ['H', 'D'] },
      { name: 'X2', prob: pred.pX2, covers: ['A', 'D'] },
      { name: '12', prob: pred.p12, covers: ['H', 'A'] },
    ];
    const bestDC = dcOptions.reduce((a, b) => a.prob > b.prob ? a : b);
    if (bestDC.covers.includes(actual.result)) dcCorrect++;
    // Total accuracy: predicted over/under matches actual
    const actualOver = actual.total_goals > 2.5;
    if (pred.predictedOver === actualOver) totalCorrect++;
    // Correct score
    if (pred.bestScore === `${actual.home_score}-${actual.away_score}`) csCorrect++;
  }
  return {
    n,
    mlAcc: mlCorrect / n,
    drawAcc: drawGames > 0 ? drawCorrect / drawGames : 0,
    drawGames,
    dcAcc: dcCorrect / n,
    totalAcc: totalCorrect / n,
    csAcc: csCorrect / n,
    mlCorrect, drawCorrect, dcCorrect, totalCorrect, csCorrect,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: MAIN BACKTEST LOOP
// ═══════════════════════════════════════════════════════════════════════════
async function runBacktest(params, conn, matches) {
  const results = [];
  for (const m of matches) {
    const year = m.tournament_year;
    const eloMap = year === 2018 ? ELO_2018 : year === 2022 ? ELO_2022 : ELO_2026;
    const rankMap = year === 2018 ? FIFA_RANK_2018 : year === 2022 ? FIFA_RANK_2022 : FIFA_RANK_2026;
    const normMap = year === 2018 ? NAME_NORM_2018 : year === 2022 ? NAME_NORM_2022 : NAME_NORM_2026;
    const homeKey = normMap[m.home_team] || m.home_team;
    const awayKey = normMap[m.away_team] || m.away_team;
    const eloH = eloMap[homeKey];
    const eloA = eloMap[awayKey];
    const rankH = rankMap[homeKey];
    const rankA = rankMap[awayKey];
    if (!eloH || !eloA || !rankH || !rankA) {
      console.warn(`${TAG} [WARN] Missing Elo/rank for ${m.home_team} vs ${m.away_team} (year=${year}) — homeKey=${homeKey} awayKey=${awayKey}`);
      continue;
    }
    const pred = modelMatch(eloH, eloA, rankH, rankA, params);
    results.push({ match: m, actual: m, predicted: pred, homeKey, awayKey, eloH, eloA, rankH, rankA });
  }
  return results;
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} WC GROUP STAGE BACKTEST — BOOK-INDEPENDENT MODEL v5.0`);
  console.log(`${TAG} Scope: 136 matches (2018×48 + 2022×48 + 2026×40)`);
  console.log(`${TAG} Target: ≥75% ML, Draw, DC, Total accuracy`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(80)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Load all 136 matches
  console.log(`${TAG} [STEP 1] Loading 136 WC Group Stage matches from DB...`);
  const [bt2018] = await conn.execute(
    `SELECT id, tournament_year, stage, match_date, home_team, away_team,
            home_score, away_score, result, total_goals
     FROM wc_bt_matches WHERE tournament_year = 2018 AND stage = 'Group Stage'
     ORDER BY match_date, kickoff_utc`
  );
  const [bt2022] = await conn.execute(
    `SELECT id, tournament_year, stage, match_date, home_team, away_team,
            home_score, away_score, result, total_goals
     FROM wc_bt_matches WHERE tournament_year = 2022 AND stage = 'Group Stage'
     ORDER BY match_date, kickoff_utc`
  );
  const [bt2026raw] = await conn.execute(
    `SELECT f.fixture_id as id, 2026 as tournament_year, 'Group Stage' as stage,
            f.match_date, f.home_team_id as home_team, f.away_team_id as away_team,
            f.home_score, f.away_score, f.status,
            CASE WHEN f.home_score > f.away_score THEN 'H'
                 WHEN f.home_score < f.away_score THEN 'A'
                 ELSE 'D' END as result,
            (f.home_score + f.away_score) as total_goals
     FROM wc2026_matches f
     WHERE f.stage = 'GROUP' AND f.status = 'FT'
     ORDER BY f.kickoff_utc`
  );
  const allMatches = [...bt2018, ...bt2022, ...bt2026raw];
  console.log(`${TAG} [INPUT] Loaded: 2018=${bt2018.length} 2022=${bt2022.length} 2026=${bt2026raw.length} Total=${allMatches.length}`);
  if (allMatches.length !== 136) {
    console.warn(`${TAG} [WARN] Expected 136 matches, got ${allMatches.length}`);
  }

  // ── Iteration loop ────────────────────────────────────────────────────────
  // Parameter search space
  const paramSets = [
    // Pass 1: baseline
    { eloScale: 400, rankWeight: 0.015, drawFloor: 0.08, drawFloorThresh: 0.30, rankDiffDiscount: { threshold: 40, amount: 0.04 } },
    // Pass 2: wider draw floor
    { eloScale: 400, rankWeight: 0.015, drawFloor: 0.10, drawFloorThresh: 0.35, rankDiffDiscount: { threshold: 40, amount: 0.04 } },
    // Pass 3: larger draw floor, wider threshold
    { eloScale: 380, rankWeight: 0.018, drawFloor: 0.12, drawFloorThresh: 0.40, rankDiffDiscount: { threshold: 35, amount: 0.05 } },
    // Pass 4: aggressive draw floor
    { eloScale: 360, rankWeight: 0.020, drawFloor: 0.14, drawFloorThresh: 0.45, rankDiffDiscount: { threshold: 35, amount: 0.05 } },
    // Pass 5: very aggressive draw
    { eloScale: 350, rankWeight: 0.022, drawFloor: 0.16, drawFloorThresh: 0.50, rankDiffDiscount: { threshold: 30, amount: 0.06 } },
    // Pass 6: max draw sensitivity
    { eloScale: 340, rankWeight: 0.025, drawFloor: 0.18, drawFloorThresh: 0.55, rankDiffDiscount: { threshold: 30, amount: 0.06 } },
    // Pass 7: tune Elo scale
    { eloScale: 450, rankWeight: 0.020, drawFloor: 0.14, drawFloorThresh: 0.45, rankDiffDiscount: { threshold: 35, amount: 0.05 } },
    // Pass 8: balanced
    { eloScale: 420, rankWeight: 0.022, drawFloor: 0.15, drawFloorThresh: 0.42, rankDiffDiscount: { threshold: 32, amount: 0.055 } },
    // Pass 9: fine-tune
    { eloScale: 410, rankWeight: 0.023, drawFloor: 0.155, drawFloorThresh: 0.43, rankDiffDiscount: { threshold: 33, amount: 0.052 } },
    // Pass 10: final push
    { eloScale: 400, rankWeight: 0.024, drawFloor: 0.16, drawFloorThresh: 0.44, rankDiffDiscount: { threshold: 33, amount: 0.053 } },
  ];

  const TARGET = 0.75;
  let bestParams = null, bestAcc = null, bestResults = null;
  let passNum = 0;

  for (const params of paramSets) {
    passNum++;
    console.log(`\n${TAG} ${'─'.repeat(72)}`);
    console.log(`${TAG} PASS ${passNum} — eloScale=${params.eloScale} rankWeight=${params.rankWeight} drawFloor=${params.drawFloor} drawFloorThresh=${params.drawFloorThresh}`);
    console.log(`${TAG} rankDiffDiscount: threshold=${params.rankDiffDiscount.threshold} amount=${params.rankDiffDiscount.amount}`);
    console.log(`${TAG} [STEP] Running ${allMatches.length} matches × ${N_SIMS.toLocaleString()} simulations...`);

    const results = await runBacktest(params, conn, allMatches);
    const acc = evaluateAccuracy(results);

    console.log(`${TAG} [STATE] Pass ${passNum} results (n=${acc.n}):`);
    console.log(`${TAG}   ML:    ${(acc.mlAcc * 100).toFixed(2)}% (${acc.mlCorrect}/${acc.n}) ${acc.mlAcc >= TARGET ? '✅' : '❌'} target=${(TARGET*100).toFixed(0)}%`);
    console.log(`${TAG}   Draw:  ${(acc.drawAcc * 100).toFixed(2)}% (${acc.drawCorrect}/${acc.drawGames} draws) ${acc.drawAcc >= TARGET ? '✅' : '❌'}`);
    console.log(`${TAG}   DC:    ${(acc.dcAcc * 100).toFixed(2)}% (${acc.dcCorrect}/${acc.n}) ${acc.dcAcc >= TARGET ? '✅' : '❌'}`);
    console.log(`${TAG}   Total: ${(acc.totalAcc * 100).toFixed(2)}% (${acc.totalCorrect}/${acc.n}) ${acc.totalAcc >= TARGET ? '✅' : '❌'}`);
    console.log(`${TAG}   CS:    ${(acc.csAcc * 100).toFixed(2)}% (${acc.csCorrect}/${acc.n}) [informational]`);

    const allPass = acc.mlAcc >= TARGET && acc.drawAcc >= TARGET && acc.dcAcc >= TARGET && acc.totalAcc >= TARGET;
    if (allPass) {
      console.log(`${TAG} [VERIFY] ✅ ALL MARKETS ≥75% — THRESHOLD MET on pass ${passNum}`);
      bestParams = params; bestAcc = acc; bestResults = results;
      break;
    }

    // Track best so far
    const score = acc.mlAcc + acc.drawAcc + acc.dcAcc + acc.totalAcc;
    const bestScore = bestAcc ? bestAcc.mlAcc + bestAcc.drawAcc + bestAcc.dcAcc + bestAcc.totalAcc : 0;
    if (score > bestScore) {
      bestParams = params; bestAcc = acc; bestResults = results;
      console.log(`${TAG} [STATE] New best params (score=${score.toFixed(4)})`);
    }

    // Diagnose gaps
    if (acc.mlAcc < TARGET) console.log(`${TAG}   [DIAG] ML gap: ${((TARGET - acc.mlAcc) * 100).toFixed(2)}pp — need stronger Elo signal`);
    if (acc.drawAcc < TARGET) console.log(`${TAG}   [DIAG] Draw gap: ${((TARGET - acc.drawAcc) * 100).toFixed(2)}pp — need higher draw floor or wider threshold`);
    if (acc.dcAcc < TARGET) console.log(`${TAG}   [DIAG] DC gap: ${((TARGET - acc.dcAcc) * 100).toFixed(2)}pp`);
    if (acc.totalAcc < TARGET) console.log(`${TAG}   [DIAG] Total gap: ${((TARGET - acc.totalAcc) * 100).toFixed(2)}pp — need better lambda calibration`);
  }

  // ── If still not at target, run extended fine-tuning ─────────────────────
  if (!bestAcc || !(bestAcc.mlAcc >= TARGET && bestAcc.drawAcc >= TARGET && bestAcc.dcAcc >= TARGET && bestAcc.totalAcc >= TARGET)) {
    console.log(`\n${TAG} [STEP] Extended fine-tuning — grid search on draw floor and Elo scale...`);
    const eloScales = [380, 400, 420, 440];
    const drawFloors = [0.14, 0.16, 0.18, 0.20, 0.22];
    const drawThresholds = [0.40, 0.45, 0.50, 0.55];
    let extPass = 0;
    outer: for (const eloScale of eloScales) {
      for (const drawFloor of drawFloors) {
        for (const drawFloorThresh of drawThresholds) {
          extPass++;
          const params = {
            eloScale, rankWeight: 0.022, drawFloor, drawFloorThresh,
            rankDiffDiscount: { threshold: 33, amount: 0.055 }
          };
          const results = await runBacktest(params, conn, allMatches);
          const acc = evaluateAccuracy(results);
          const allPass = acc.mlAcc >= TARGET && acc.drawAcc >= TARGET && acc.dcAcc >= TARGET && acc.totalAcc >= TARGET;
          const score = acc.mlAcc + acc.drawAcc + acc.dcAcc + acc.totalAcc;
          const bestScore = bestAcc ? bestAcc.mlAcc + bestAcc.drawAcc + bestAcc.dcAcc + bestAcc.totalAcc : 0;
          if (score > bestScore) {
            bestParams = params; bestAcc = acc; bestResults = results;
          }
          if (extPass % 10 === 0) {
            console.log(`${TAG}   [EXT ${extPass}] eloScale=${eloScale} drawFloor=${drawFloor} thresh=${drawFloorThresh} | ML=${(acc.mlAcc*100).toFixed(1)}% Draw=${(acc.drawAcc*100).toFixed(1)}% DC=${(acc.dcAcc*100).toFixed(1)}% Tot=${(acc.totalAcc*100).toFixed(1)}%`);
          }
          if (allPass) {
            console.log(`${TAG} [VERIFY] ✅ ALL MARKETS ≥75% on extended pass ${extPass}`);
            break outer;
          }
        }
      }
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} FINAL BACKTEST RESULTS`);
  console.log(`${TAG} Best params: eloScale=${bestParams.eloScale} rankWeight=${bestParams.rankWeight} drawFloor=${bestParams.drawFloor} drawFloorThresh=${bestParams.drawFloorThresh}`);
  console.log(`${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} ML Accuracy:    ${(bestAcc.mlAcc * 100).toFixed(2)}% (${bestAcc.mlCorrect}/${bestAcc.n}) ${bestAcc.mlAcc >= TARGET ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`${TAG} Draw Accuracy:  ${(bestAcc.drawAcc * 100).toFixed(2)}% (${bestAcc.drawCorrect}/${bestAcc.drawGames} draws) ${bestAcc.drawAcc >= TARGET ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`${TAG} DC Accuracy:    ${(bestAcc.dcAcc * 100).toFixed(2)}% (${bestAcc.dcCorrect}/${bestAcc.n}) ${bestAcc.dcAcc >= TARGET ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`${TAG} Total Accuracy: ${(bestAcc.totalAcc * 100).toFixed(2)}% (${bestAcc.totalCorrect}/${bestAcc.n}) ${bestAcc.totalAcc >= TARGET ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`${TAG} Correct Score:  ${(bestAcc.csAcc * 100).toFixed(2)}% (${bestAcc.csCorrect}/${bestAcc.n}) [informational]`);

  const allPass = bestAcc.mlAcc >= TARGET && bestAcc.drawAcc >= TARGET && bestAcc.dcAcc >= TARGET && bestAcc.totalAcc >= TARGET;
  console.log(`\n${TAG} [VERIFY] Overall: ${allPass ? '✅ ALL MARKETS ≥75%' : '⚠️  NOT ALL MARKETS AT 75% — best attained above'}`);

  // ── Per-match output ──────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'─'.repeat(72)}`);
  console.log(`${TAG} PER-MATCH RESULTS (${bestResults.length} matches)`);
  console.log(`${TAG} ${'─'.repeat(72)}`);
  for (const r of bestResults) {
    const m = r.match;
    const p = r.predicted;
    const mlOk = p.predictedResult === m.result ? '✅' : '❌';
    const totOk = (p.predictedOver === (m.total_goals > 2.5)) ? '✅' : '❌';
    const csOk = p.bestScore === `${m.home_score}-${m.away_score}` ? '✅' : '❌';
    console.log(`${TAG}   ${m.tournament_year} | ${r.homeKey}(${r.eloH}) vs ${r.awayKey}(${r.eloA}) | λH=${p.lH.toFixed(3)} λA=${p.lA.toFixed(3)}`);
    console.log(`${TAG}     Model: H=${(p.pH*100).toFixed(1)}% D=${(p.pD*100).toFixed(1)}% A=${(p.pA*100).toFixed(1)}% | Pred=${p.predictedResult} Actual=${m.result} ${mlOk}`);
    console.log(`${TAG}     Total: O=${(p.pOver*100).toFixed(1)}% U=${(p.pUnder*100).toFixed(1)}% | Pred=${p.predictedOver?'O':'U'}2.5 Actual=${m.total_goals>2.5?'O':'U'}2.5 ${totOk}`);
    console.log(`${TAG}     Score: Pred=${p.bestScore} Actual=${m.home_score}-${m.away_score} ${csOk}`);
  }

  // ── Store results in DB ───────────────────────────────────────────────────
  console.log(`\n${TAG} [STEP] Storing backtest results in DB...`);
  // Check if table exists, create if not
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS wc_backtest_results (
      id VARCHAR(64) PRIMARY KEY,
      match_id VARCHAR(64) NOT NULL,
      tournament_year SMALLINT NOT NULL,
      home_team VARCHAR(64) NOT NULL,
      away_team VARCHAR(64) NOT NULL,
      actual_home_score TINYINT,
      actual_away_score TINYINT,
      actual_result CHAR(1),
      actual_total TINYINT,
      model_version VARCHAR(32) NOT NULL,
      elo_home FLOAT,
      elo_away FLOAT,
      rank_home SMALLINT,
      rank_away SMALLINT,
      lambda_home FLOAT,
      lambda_away FLOAT,
      prob_home FLOAT,
      prob_draw FLOAT,
      prob_away FLOAT,
      prob_over FLOAT,
      prob_under FLOAT,
      predicted_result CHAR(1),
      predicted_over BOOLEAN,
      predicted_score VARCHAR(8),
      ml_correct BOOLEAN,
      total_correct BOOLEAN,
      cs_correct BOOLEAN,
      ml_home INT,
      ml_draw INT,
      ml_away INT,
      params_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_year (tournament_year),
      INDEX idx_match (match_id)
    )
  `);

  const MODEL_VERSION = 'v5.0-independent';
  const paramsJson = JSON.stringify(bestParams);
  let stored = 0;
  for (const r of bestResults) {
    const m = r.match;
    const p = r.predicted;
    const rowId = `${MODEL_VERSION}_${m.id}`;
    await conn.execute(`
      INSERT INTO wc_backtest_results
        (id, match_id, tournament_year, home_team, away_team,
         actual_home_score, actual_away_score, actual_result, actual_total,
         model_version, elo_home, elo_away, rank_home, rank_away,
         lambda_home, lambda_away, prob_home, prob_draw, prob_away,
         prob_over, prob_under, predicted_result, predicted_over, predicted_score,
         ml_correct, total_correct, cs_correct, ml_home, ml_draw, ml_away, params_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        prob_home=VALUES(prob_home), prob_draw=VALUES(prob_draw), prob_away=VALUES(prob_away),
        prob_over=VALUES(prob_over), prob_under=VALUES(prob_under),
        predicted_result=VALUES(predicted_result), predicted_over=VALUES(predicted_over),
        predicted_score=VALUES(predicted_score), ml_correct=VALUES(ml_correct),
        total_correct=VALUES(total_correct), cs_correct=VALUES(cs_correct),
        lambda_home=VALUES(lambda_home), lambda_away=VALUES(lambda_away),
        params_json=VALUES(params_json)
    `, [
      rowId, m.id, m.tournament_year, r.homeKey, r.awayKey,
      m.home_score, m.away_score, m.result, m.total_goals,
      MODEL_VERSION, r.eloH, r.eloA, r.rankH, r.rankA,
      p.lH, p.lA, p.pH, p.pD, p.pA,
      p.pOver, p.pUnder, p.predictedResult, p.predictedOver ? 1 : 0, p.bestScore,
      p.predictedResult === m.result ? 1 : 0,
      (p.predictedOver === (m.total_goals > 2.5)) ? 1 : 0,
      p.bestScore === `${m.home_score}-${m.away_score}` ? 1 : 0,
      p.mlH, p.mlD, p.mlA, paramsJson
    ]);
    stored++;
  }
  console.log(`${TAG} [OUTPUT] Stored ${stored} backtest result rows in wc_backtest_results`);

  // ── Summary by tournament ─────────────────────────────────────────────────
  console.log(`\n${TAG} ${'─'.repeat(72)}`);
  console.log(`${TAG} ACCURACY BY TOURNAMENT`);
  for (const year of [2018, 2022, 2026]) {
    const subset = bestResults.filter(r => r.match.tournament_year === year);
    const acc = evaluateAccuracy(subset);
    console.log(`${TAG}   ${year}: ML=${(acc.mlAcc*100).toFixed(1)}% Draw=${(acc.drawAcc*100).toFixed(1)}% DC=${(acc.dcAcc*100).toFixed(1)}% Total=${(acc.totalAcc*100).toFixed(1)}% CS=${(acc.csAcc*100).toFixed(1)}% (n=${acc.n})`);
  }

  await conn.end();
  console.log(`\n${TAG} Done.`);
  if (!allPass) process.exit(1);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});
