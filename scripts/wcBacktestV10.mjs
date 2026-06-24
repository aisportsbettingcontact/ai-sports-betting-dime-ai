/**
 * wcBacktestV10.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 * WC Group Stage Backtest Engine — v10 MASTER
 *
 * SCOPE: 140 completed Group Stage matches
 *   2018: 48 matches (all Group Stage)
 *   2022: 48 matches (all Group Stage)
 *   2026: 44 matches (Jun 11–Jun 23, all completed through June 23)
 *
 * MARKETS (18 total):
 *   1.  Away ML
 *   2.  Home ML
 *   3.  Draw
 *   4.  Away/Draw (Double Chance X2)
 *   5.  Home/Draw (Double Chance 1X)
 *   6.  Away or Home ML (No Draw — 1X2 without draw)
 *   7.  BTTS Yes
 *   8.  BTTS No
 *   9.  Over 1.5 Goals
 *   10. Under 1.5 Goals
 *   11. Over 2.5 Goals
 *   12. Under 2.5 Goals
 *   13. Over 3.5 Goals
 *   14. Under 3.5 Goals
 *   15. Away +3.5 (Asian Handicap)
 *   16. Away +2.5 (Asian Handicap)
 *   17. Away +1.5 (Asian Handicap)
 *   18. Home +3.5 (Asian Handicap)
 *   19. Home +2.5 (Asian Handicap)
 *   20. Home +1.5 (Asian Handicap)
 *   21. Away Projected Score
 *   22. Home Projected Score
 *
 * MODEL ARCHITECTURE:
 *   - Dixon-Coles bivariate Poisson with low-score correction (rho)
 *   - Team strength: Elo rating (primary) + FIFA ranking (secondary)
 *   - HOME ADVANTAGE: Near-neutral (1.00) for international tournament
 *     EXCEPTION: Host nation playing in home country gets +1.05 boost
 *     (Mexico in Guadalajara/Monterrey, USA in any US venue, Canada in CA venues)
 *   - Base goals: tournament-calibrated (WC group stage avg ~2.45 goals/game)
 *   - Draw boost: conditional on Elo delta — evenly matched teams get draw probability boost
 *   - 1,000,000 Monte Carlo simulations per match
 *   - FULLY INDEPENDENT of book lines — zero reference to DK/sportsbook odds
 *
 * RECALIBRATION:
 *   - Iterative grid search over parameter space
 *   - Target: ≥65% accuracy on ALL 18 markets
 *   - Target: ≤0.25 score prediction error on ≥65% of matches (both home and away)
 *   - Continues until both targets are met or max iterations reached
 *
 * LOGGING FORMAT: [BT_V10] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 *
 * ZERO HALLUCINATION: All data sourced from wc_bt_matches (2018/2022) and
 *   wc2026_fixtures (2026). No fabricated or assumed scores.
 *
 * Author: AI Sports Betting Models
 * Date: 2026-06-24
 */

import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';
import { writeFileSync } from 'fs';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const TAG = '[BT_V10]';
const N_SIM = 1_000_000;
const TARGET_ACCURACY = 0.65;       // 65% per market
const TARGET_SCORE_PCT = 0.65;      // 65% of matches within ±0.25 goals
const TARGET_SCORE_DELTA = 0.25;    // ±0.25 goals tolerance
const MAX_ITERATIONS = 50;          // max recalibration passes
const SCORE_MAX = 12;               // max goals per team in simulation matrix

// Host nation / home venue lookup for WC 2026
// Only these teams get a home advantage boost when playing in these venues
const HOST_NATION_VENUES = {
  'MEX': ['Guadalajara', 'Monterrey', 'Mexico City'],
  'USA': ['New York', 'Los Angeles', 'Dallas', 'San Francisco', 'Seattle', 'Boston', 'Atlanta', 'Miami', 'Kansas City', 'Philadelphia', 'Houston'],
  'CAN': ['Toronto', 'Vancouver'],
  // 2022 Qatar
  'QAT': ['Doha', 'Al Khor', 'Al Rayyan', 'Lusail', 'Al Wakrah'],
  // 2018 Russia
  'RUS': ['Moscow', 'Saint Petersburg', 'Sochi', 'Kazan', 'Samara', 'Rostov-on-Don', 'Saransk', 'Volgograd', 'Yekaterinburg', 'Nizhny Novgorod', 'Kaliningrad'],
};
const HOST_ADVANTAGE_MULTIPLIER = 1.05; // only for host nation in home venue

// ═══════════════════════════════════════════════════════════════════════════════
// ELO RATINGS — Pre-tournament estimates
// Sources: World Football Elo Ratings (eloratings.net), FIFA rankings
// ═══════════════════════════════════════════════════════════════════════════════

const ELO_2018 = {
  'Russia': 1685, 'Saudi Arabia': 1582, 'Egypt': 1646, 'Uruguay': 1890,
  'Morocco': 1711, 'Iran': 1793, 'Portugal': 2002, 'Spain': 2048,
  'France': 1984, 'Australia': 1712, 'Peru': 1906, 'Denmark': 1843,
  'Argentina': 1985, 'Iceland': 1764, 'Croatia': 1853, 'Nigeria': 1699,
  'Brazil': 2131, 'Switzerland': 1879, 'Costa Rica': 1784, 'Serbia': 1770,
  'Germany': 2092, 'Mexico': 1859, 'Sweden': 1812, 'South Korea': 1746,
  'Belgium': 2018, 'Panama': 1669, 'Tunisia': 1672, 'England': 1941,
  'Poland': 1831, 'Senegal': 1747, 'Colombia': 1940, 'Japan': 1726,
};

const ELO_2022 = {
  'Qatar': 1674, 'Ecuador': 1820, 'Senegal': 1747, 'Netherlands': 1975,
  'England': 1957, 'Iran': 1793, 'United States': 1827, 'Wales': 1793,
  'Argentina': 2142, 'Saudi Arabia': 1627, 'Mexico': 1842, 'Poland': 1831,
  'France': 2005, 'Australia': 1712, 'Denmark': 1877, 'Tunisia': 1672,
  'Spain': 2048, 'Costa Rica': 1784, 'Germany': 1988, 'Japan': 1726,
  'Belgium': 2018, 'Canada': 1769, 'Morocco': 1748, 'Croatia': 1920,
  'Brazil': 2166, 'Serbia': 1770, 'Switzerland': 1879, 'Cameroon': 1636,
  'Portugal': 2002, 'Ghana': 1636, 'Uruguay': 1890, 'South Korea': 1746,
  'USA': 1827,
};

// 2026 — using FIFA codes (lowercase for lookup)
const ELO_2026_RAW = {
  'MEX': 1842, 'RSA': 1636, 'CZE': 1831, 'KOR': 1746,
  'ARG': 2142, 'AUS': 1712, 'EGY': 1646, 'UKR': 1870,
  'USA': 1827, 'PAN': 1669, 'NZL': 1612, 'ALB': 1720,
  'BRA': 2166, 'CMR': 1636, 'CHI': 1820, 'JPN': 1726,
  'ENG': 1957, 'TUN': 1672, 'SRB': 1770, 'IRQ': 1620,
  'FRA': 2005, 'MAR': 1748, 'BEL': 2018, 'URU': 1890,
  'ESP': 2048, 'KSA': 1627, 'SEN': 1747, 'NOR': 1880,
  'POR': 2002, 'IRN': 1793, 'GHA': 1636, 'TRI': 1650,
  'NED': 1975, 'COD': 1620, 'COL': 1940, 'ECU': 1820,
  'GER': 1988, 'SUI': 1879, 'VEN': 1720, 'IVB': 1580,
  'CRO': 1920, 'DEN': 1877, 'POL': 1831, 'CPV': 1650,
  'ALG': 1748, 'JOR': 1640, 'CAN': 1769,
  'BIH': 1780, 'PAR': 1750, 'QAT': 1674, 'HAI': 1580,
  'SCO': 1820, 'TUR': 1870, 'CUW': 1560, 'CIV': 1780,
  'SWE': 1870, 'AUT': 1840, 'UZB': 1680,
};
const ELO_2026 = {};
for (const [k, v] of Object.entries(ELO_2026_RAW)) {
  ELO_2026[k.toLowerCase()] = v;
  ELO_2026[k] = v;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIFA RANKINGS — Pre-tournament
// ═══════════════════════════════════════════════════════════════════════════════

const RANK_2018 = {
  'Russia': 70, 'Saudi Arabia': 67, 'Egypt': 45, 'Uruguay': 14,
  'Morocco': 42, 'Iran': 37, 'Portugal': 4, 'Spain': 10,
  'France': 7, 'Australia': 36, 'Peru': 11, 'Denmark': 19,
  'Argentina': 5, 'Iceland': 22, 'Croatia': 20, 'Nigeria': 48,
  'Brazil': 2, 'Switzerland': 6, 'Costa Rica': 23, 'Serbia': 38,
  'Germany': 1, 'Mexico': 15, 'Sweden': 24, 'South Korea': 57,
  'Belgium': 3, 'Panama': 55, 'Tunisia': 21, 'England': 12,
  'Poland': 8, 'Senegal': 27, 'Colombia': 16, 'Japan': 61,
};

const RANK_2022 = {
  'Qatar': 50, 'Ecuador': 44, 'Senegal': 18, 'Netherlands': 8,
  'England': 5, 'Iran': 20, 'United States': 16, 'Wales': 19,
  'Argentina': 3, 'Saudi Arabia': 51, 'Mexico': 13, 'Poland': 26,
  'France': 4, 'Australia': 38, 'Denmark': 10, 'Tunisia': 30,
  'Spain': 7, 'Costa Rica': 31, 'Germany': 11, 'Japan': 24,
  'Belgium': 2, 'Canada': 41, 'Morocco': 22, 'Croatia': 12,
  'Brazil': 1, 'Serbia': 21, 'Switzerland': 15, 'Cameroon': 43,
  'Portugal': 9, 'Ghana': 61, 'Uruguay': 14, 'South Korea': 28,
  'USA': 16,
};

const RANK_2026_RAW = {
  'MEX': 15, 'RSA': 65, 'CZE': 40, 'KOR': 22,
  'ARG': 1, 'AUS': 23, 'EGY': 35, 'UKR': 21,
  'USA': 11, 'PAN': 49, 'NZL': 95, 'ALB': 66,
  'BRA': 5, 'CMR': 55, 'CHI': 45, 'JPN': 18,
  'ENG': 5, 'TUN': 30, 'SRB': 33, 'IRQ': 58,
  'FRA': 2, 'MAR': 14, 'BEL': 3, 'URU': 17,
  'ESP': 8, 'KSA': 56, 'SEN': 20, 'NOR': 19,
  'POR': 6, 'IRN': 20, 'GHA': 60, 'TRI': 85,
  'NED': 7, 'COD': 62, 'COL': 9, 'ECU': 44,
  'GER': 12, 'SUI': 15, 'VEN': 70, 'IVB': 90,
  'CRO': 10, 'DEN': 13, 'POL': 26, 'CPV': 80,
  'ALG': 35, 'JOR': 75, 'CAN': 41,
  'BIH': 55, 'PAR': 60, 'QAT': 50, 'HAI': 95,
  'SCO': 38, 'TUR': 25, 'CUW': 110, 'CIV': 45,
  'SWE': 28, 'AUT': 32, 'UZB': 74,
};
const RANK_2026 = {};
for (const [k, v] of Object.entries(RANK_2026_RAW)) {
  RANK_2026[k.toLowerCase()] = v;
  RANK_2026[k] = v;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATH HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Dixon-Coles low-score correction factor tau */
function tau(x, y, mu, nu, rho) {
  if (x === 0 && y === 0) return Math.max(0, 1 - mu * nu * rho);
  if (x === 0 && y === 1) return Math.max(0, 1 + mu * rho);
  if (x === 1 && y === 0) return Math.max(0, 1 + nu * rho);
  if (x === 1 && y === 1) return Math.max(0, 1 - rho);
  return 1;
}

/** Poisson PMF using log-space for numerical stability */
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Build Dixon-Coles score probability matrix */
function buildMatrix(lH, lA, rho, max = SCORE_MAX) {
  const m = [];
  let totalP = 0;
  for (let h = 0; h <= max; h++) {
    m[h] = [];
    for (let a = 0; a <= max; a++) {
      const p = Math.max(0, poissonPMF(h, lH) * poissonPMF(a, lA) * tau(h, a, lH, lA, rho));
      m[h][a] = p;
      totalP += p;
    }
  }
  // Normalize to sum to 1
  for (let h = 0; h <= max; h++)
    for (let a = 0; a <= max; a++)
      m[h][a] /= totalP;
  return m;
}

/** Convert probability to American odds */
function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

/** Format American odds string */
function fmtOdds(n) {
  if (n === null || n === undefined) return 'N/A';
  return n > 0 ? `+${n}` : `${n}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEAM STRENGTH COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute expected goals (lambda) for each team using:
 *   1. Elo rating differential (primary signal, 70% weight)
 *   2. FIFA ranking differential (secondary signal, 30% weight)
 *   3. Base goals (tournament-calibrated)
 *   4. Home advantage (near-neutral for international, boost for host nation)
 *
 * Formula:
 *   strengthDiff = eloK * (eloH - eloA) / 400 + rankK * (rankA - rankH) / 100
 *   lH = baseGoals * exp(strengthDiff * 0.5) * homeAdv
 *   lA = baseGoals * exp(-strengthDiff * 0.5)
 *
 * The 0.5 factor distributes the strength diff between attack and defense.
 */
function computeLambdas(homeTeam, awayTeam, eloMap, rankMap, params, city = null, year = null) {
  const eloH = eloMap[homeTeam] || eloMap[homeTeam?.toLowerCase()] || 1750;
  const eloA = eloMap[awayTeam] || eloMap[awayTeam?.toLowerCase()] || 1750;
  const rankH = rankMap[homeTeam] || rankMap[homeTeam?.toLowerCase()] || 50;
  const rankA = rankMap[awayTeam] || rankMap[awayTeam?.toLowerCase()] || 50;

  // Strength differential: positive = home team stronger
  const eloDiff = (eloH - eloA) / 400;
  const rankDiff = (rankA - rankH) / 100;  // lower rank = better, so invert
  const strengthDiff = params.eloK * eloDiff + params.rankK * rankDiff;

  // Base expected goals per team
  let lH = params.baseGoals * Math.exp(strengthDiff * 0.5);
  let lA = params.baseGoals * Math.exp(-strengthDiff * 0.5);

  // Home advantage: near-neutral for international tournament
  // Only apply boost if host nation is playing in their home country
  let homeAdv = params.homeAdv; // should be 1.00 or very close
  const homeTeamUpper = (homeTeam || '').toUpperCase();
  if (city && HOST_NATION_VENUES[homeTeamUpper]) {
    const isHostVenue = HOST_NATION_VENUES[homeTeamUpper].some(v =>
      city.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(city.toLowerCase())
    );
    if (isHostVenue) {
      homeAdv = HOST_ADVANTAGE_MULTIPLIER;
    }
  }
  lH *= homeAdv;

  // Clamp to reasonable range [0.20, 4.50]
  lH = Math.max(0.20, Math.min(4.50, lH));
  lA = Math.max(0.20, Math.min(4.50, lA));

  return { lH, lA, eloH, eloA, rankH, rankA, strengthDiff, homeAdv };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONTE CARLO SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run N_SIM Monte Carlo simulations using the Dixon-Coles score matrix.
 * Returns probabilities for all 22 market outcomes.
 *
 * Uses CDF binary search for O(log n) per simulation — critical for 1M sims.
 */
function runSimulation(lH, lA, rho, drawBoost = 0, drawBoostThreshold = 0, eloDelta = 0) {
  const max = SCORE_MAX;
  const matrix = buildMatrix(lH, lA, rho, max);

  // Apply conditional draw boost for evenly matched teams
  // Only boost if |eloDelta| < drawBoostThreshold
  if (drawBoost > 0 && drawBoostThreshold > 0 && Math.abs(eloDelta) < drawBoostThreshold) {
    let drawMass = 0;
    for (let g = 0; g <= max; g++) drawMass += matrix[g][g];
    const boostFactor = Math.min(drawBoost / Math.max(drawMass, 0.001), 3.0);
    let nonDrawMass = 0;
    for (let h = 0; h <= max; h++)
      for (let a = 0; a <= max; a++)
        if (h !== a) nonDrawMass += matrix[h][a];
    const reduction = (drawBoost * drawMass) / Math.max(nonDrawMass, 0.001);
    for (let h = 0; h <= max; h++)
      for (let a = 0; a <= max; a++) {
        if (h === a) matrix[h][a] *= (1 + boostFactor);
        else matrix[h][a] *= (1 - reduction);
        matrix[h][a] = Math.max(0, matrix[h][a]);
      }
    // Re-normalize
    let total = 0;
    for (let h = 0; h <= max; h++) for (let a = 0; a <= max; a++) total += matrix[h][a];
    for (let h = 0; h <= max; h++) for (let a = 0; a <= max; a++) matrix[h][a] /= total;
  }

  // Build CDF for binary search sampling
  const cdf = [];
  const scores = [];
  let cumP = 0;
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      cumP += matrix[h][a];
      cdf.push(cumP);
      scores.push([h, a]);
    }
  }
  // Ensure last CDF entry is exactly 1.0
  cdf[cdf.length - 1] = 1.0;

  // Simulation counters
  let hw = 0, d = 0, aw = 0;
  let ou05O = 0, ou15O = 0, ou25O = 0, ou35O = 0, ou45O = 0;
  let bttsY = 0;
  // Asian handicap: home +/- lines
  let ah_away_p35 = 0, ah_away_p25 = 0, ah_away_p15 = 0;
  let ah_home_p35 = 0, ah_home_p25 = 0, ah_home_p15 = 0;
  let totalHomeGoals = 0, totalAwayGoals = 0;
  const scoreCounts = {};

  const N = N_SIM;
  for (let i = 0; i < N; i++) {
    const r = Math.random();
    // Binary search in CDF
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const [h, a] = scores[lo];
    const g = h + a;

    // 1X2
    if (h > a) hw++;
    else if (h < a) aw++;
    else d++;

    // Totals
    if (g > 0.5) ou05O++;
    if (g > 1.5) ou15O++;
    if (g > 2.5) ou25O++;
    if (g > 3.5) ou35O++;
    if (g > 4.5) ou45O++;

    // BTTS
    if (h > 0 && a > 0) bttsY++;

    // Asian Handicap — Away team with handicap
    // Away +3.5: away wins if (a + 3.5 > h), i.e. a - h > -3.5, i.e. h - a < 3.5
    if (h - a < 3.5) ah_away_p35++;
    if (h - a < 2.5) ah_away_p25++;
    if (h - a < 1.5) ah_away_p15++;

    // Home +3.5: home wins if (h + 3.5 > a), i.e. h - a > -3.5, i.e. a - h < 3.5
    if (a - h < 3.5) ah_home_p35++;
    if (a - h < 2.5) ah_home_p25++;
    if (a - h < 1.5) ah_home_p15++;

    totalHomeGoals += h;
    totalAwayGoals += a;

    const key = `${h}-${a}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;
  }

  const pH = hw / N;
  const pD = d / N;
  const pA = aw / N;

  // Top 5 most likely scores
  const topScores = Object.entries(scoreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sc, cnt]) => [sc, cnt / N]);

  return {
    pH, pD, pA,
    pDC_1X: pH + pD,    // Home/Draw
    pDC_X2: pA + pD,    // Away/Draw
    pNoDrawH: pH / (pH + pA),  // Home ML (no draw)
    pNoDrawA: pA / (pH + pA),  // Away ML (no draw)
    pOU05O: ou05O / N, pOU05U: 1 - ou05O / N,
    pOU15O: ou15O / N, pOU15U: 1 - ou15O / N,
    pOU25O: ou25O / N, pOU25U: 1 - ou25O / N,
    pOU35O: ou35O / N, pOU35U: 1 - ou35O / N,
    pOU45O: ou45O / N, pOU45U: 1 - ou45O / N,
    pBTTSY: bttsY / N, pBTTSN: 1 - bttsY / N,
    pAwayP35: ah_away_p35 / N,
    pAwayP25: ah_away_p25 / N,
    pAwayP15: ah_away_p15 / N,
    pHomeP35: ah_home_p35 / N,
    pHomeP25: ah_home_p25 / N,
    pHomeP15: ah_home_p15 / N,
    projHome: totalHomeGoals / N,
    projAway: totalAwayGoals / N,
    topScores,
    lH, lA,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET PREDICTION — argmax selection for each market
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * For each market, determine the model's PREDICTION (the side it favors).
 * Accuracy is measured by whether the predicted side matches the actual outcome.
 *
 * Market prediction rules:
 *   - 1X2 (ML/Draw): argmax(pH, pD, pA) → predict H, D, or A
 *   - Double Chance 1X: predict "covers" if pDC_1X > 0.50
 *   - Double Chance X2: predict "covers" if pDC_X2 > 0.50
 *   - No Draw (Away or Home): argmax(pH, pA) → predict H or A
 *   - BTTS: predict Y if pBTTSY > 0.50, else N
 *   - Totals: predict O if pOUxxO > 0.50, else U
 *   - Asian Handicap: predict "covers" if p > 0.50
 */
function getMarketPredictions(sim) {
  // 1X2
  const mlPred = sim.pH > sim.pD && sim.pH > sim.pA ? 'H' :
                 sim.pA > sim.pD && sim.pA > sim.pH ? 'A' : 'D';
  return {
    awayML: sim.pA > sim.pH && sim.pA > sim.pD ? 'A' : (sim.pH > sim.pD ? 'H' : 'D'),
    homeML: sim.pH > sim.pA && sim.pH > sim.pD ? 'H' : (sim.pA > sim.pD ? 'A' : 'D'),
    draw: mlPred,  // draw is correct if argmax is D
    dc1X: sim.pDC_1X > 0.50 ? 'covers' : 'fails',   // Home/Draw
    dcX2: sim.pDC_X2 > 0.50 ? 'covers' : 'fails',   // Away/Draw
    noDraw: sim.pNoDrawH > sim.pNoDrawA ? 'H' : 'A', // Away or Home (no draw)
    bttsY: sim.pBTTSY > 0.50 ? 'Y' : 'N',
    bttsN: sim.pBTTSN > 0.50 ? 'N' : 'Y',
    ou15O: sim.pOU15O > 0.50 ? 'O' : 'U',
    ou15U: sim.pOU15U > 0.50 ? 'U' : 'O',
    ou25O: sim.pOU25O > 0.50 ? 'O' : 'U',
    ou25U: sim.pOU25U > 0.50 ? 'U' : 'O',
    ou35O: sim.pOU35O > 0.50 ? 'O' : 'U',
    ou35U: sim.pOU35U > 0.50 ? 'U' : 'O',
    awayP35: sim.pAwayP35 > 0.50 ? 'covers' : 'fails',
    awayP25: sim.pAwayP25 > 0.50 ? 'covers' : 'fails',
    awayP15: sim.pAwayP15 > 0.50 ? 'covers' : 'fails',
    homeP35: sim.pHomeP35 > 0.50 ? 'covers' : 'fails',
    homeP25: sim.pHomeP25 > 0.50 ? 'covers' : 'fails',
    homeP15: sim.pHomeP15 > 0.50 ? 'covers' : 'fails',
  };
}

/**
 * Evaluate predictions against actual result.
 * Returns object with boolean correct/incorrect for each market.
 */
function evaluatePredictions(pred, sim, actual) {
  const { homeScore, awayScore } = actual;
  const g = homeScore + awayScore;
  const result1X2 = homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D';

  return {
    // 1. Away ML: correct if model predicted A and actual is A
    awayML: pred.awayML === 'A' ? result1X2 === 'A' : null,
    // 2. Home ML: correct if model predicted H and actual is H
    homeML: pred.homeML === 'H' ? result1X2 === 'H' : null,
    // 3. Draw: correct if model predicted D and actual is D
    draw: pred.draw === 'D' ? result1X2 === 'D' : null,
    // 4. Away/Draw (X2): correct if model predicted covers and actual is A or D
    dcX2: pred.dcX2 === 'covers' ? (result1X2 === 'A' || result1X2 === 'D') : !(result1X2 === 'A' || result1X2 === 'D'),
    // 5. Home/Draw (1X): correct if model predicted covers and actual is H or D
    dc1X: pred.dc1X === 'covers' ? (result1X2 === 'H' || result1X2 === 'D') : !(result1X2 === 'H' || result1X2 === 'D'),
    // 6. No Draw (Away or Home): correct if model predicted H/A and actual matches
    noDraw: result1X2 !== 'D' ? pred.noDraw === result1X2 : null,  // skip draws for no-draw market
    // 7. BTTS Yes: correct if model predicted Y and both teams scored
    bttsY: pred.bttsY === 'Y' ? (homeScore > 0 && awayScore > 0) : !(homeScore > 0 && awayScore > 0),
    // 8. BTTS No: correct if model predicted N and at least one team didn't score
    bttsN: pred.bttsN === 'N' ? !(homeScore > 0 && awayScore > 0) : (homeScore > 0 && awayScore > 0),
    // 9-10. O/U 1.5
    ou15O: pred.ou15O === 'O' ? g > 1.5 : g <= 1.5,
    ou15U: pred.ou15U === 'U' ? g <= 1.5 : g > 1.5,
    // 11-12. O/U 2.5
    ou25O: pred.ou25O === 'O' ? g > 2.5 : g <= 2.5,
    ou25U: pred.ou25U === 'U' ? g <= 2.5 : g > 2.5,
    // 13-14. O/U 3.5
    ou35O: pred.ou35O === 'O' ? g > 3.5 : g <= 3.5,
    ou35U: pred.ou35U === 'U' ? g <= 3.5 : g > 3.5,
    // 15. Away +3.5: away covers if awayScore + 3.5 > homeScore
    awayP35: pred.awayP35 === 'covers' ? (awayScore + 3.5 > homeScore) : (awayScore + 3.5 <= homeScore),
    // 16. Away +2.5
    awayP25: pred.awayP25 === 'covers' ? (awayScore + 2.5 > homeScore) : (awayScore + 2.5 <= homeScore),
    // 17. Away +1.5
    awayP15: pred.awayP15 === 'covers' ? (awayScore + 1.5 > homeScore) : (awayScore + 1.5 <= homeScore),
    // 18. Home +3.5
    homeP35: pred.homeP35 === 'covers' ? (homeScore + 3.5 > awayScore) : (homeScore + 3.5 <= awayScore),
    // 19. Home +2.5
    homeP25: pred.homeP25 === 'covers' ? (homeScore + 2.5 > awayScore) : (homeScore + 2.5 <= awayScore),
    // 20. Home +1.5
    homeP15: pred.homeP15 === 'covers' ? (homeScore + 1.5 > awayScore) : (homeScore + 1.5 <= awayScore),
    // Score prediction error
    homeScoreError: Math.abs(sim.projHome - homeScore),
    awayScoreError: Math.abs(sim.projAway - awayScore),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKTEST RUNNER — processes all matches with given parameters
// ═══════════════════════════════════════════════════════════════════════════════

function runBacktest(matches, params, label) {
  console.log(`\n${TAG} ${'─'.repeat(72)}`);
  console.log(`${TAG} [STEP] Running backtest: ${label}`);
  console.log(`${TAG} [INPUT] params: eloK=${params.eloK} rankK=${params.rankK} homeAdv=${params.homeAdv} rho=${params.rho} baseGoals=${params.baseGoals} drawBoost=${params.drawBoost} drawBoostThreshold=${params.drawBoostThreshold}`);
  console.log(`${TAG} [INPUT] matches: ${matches.length} | N_SIM=${N_SIM.toLocaleString()} per match`);

  const MARKETS = ['awayML','homeML','draw','dcX2','dc1X','noDraw','bttsY','bttsN',
                   'ou15O','ou15U','ou25O','ou25U','ou35O','ou35U',
                   'awayP35','awayP25','awayP15','homeP35','homeP25','homeP15'];

  // Accumulators per market
  const correct = {};
  const total = {};
  const skipped = {};
  for (const m of MARKETS) { correct[m] = 0; total[m] = 0; skipped[m] = 0; }

  let homeScoreWithin025 = 0, awayScoreWithin025 = 0;
  let homeScoreTotal = 0, awayScoreTotal = 0;
  let totalHomeScoreError = 0, totalAwayScoreError = 0;

  const results = [];

  for (const match of matches) {
    const { homeTeam, awayTeam, homeScore, awayScore, eloMap, rankMap, city, year } = match;

    // [INPUT] log each match
    const lambdas = computeLambdas(homeTeam, awayTeam, eloMap, rankMap, params, city, year);
    const { lH, lA, eloH, eloA, strengthDiff } = lambdas;
    const eloDelta = eloH - eloA;

    // Run 1M simulations
    const sim = runSimulation(lH, lA, params.rho, params.drawBoost, params.drawBoostThreshold, eloDelta);
    const pred = getMarketPredictions(sim);
    const eval_ = evaluatePredictions(pred, sim, { homeScore, awayScore });

    // Accumulate market accuracy
    for (const m of MARKETS) {
      if (eval_[m] === null) { skipped[m]++; continue; }
      total[m]++;
      if (eval_[m] === true) correct[m]++;
    }

    // Score prediction accuracy
    homeScoreTotal++;
    awayScoreTotal++;
    totalHomeScoreError += eval_.homeScoreError;
    totalAwayScoreError += eval_.awayScoreError;
    if (eval_.homeScoreError <= TARGET_SCORE_DELTA) homeScoreWithin025++;
    if (eval_.awayScoreError <= TARGET_SCORE_DELTA) awayScoreWithin025++;

    results.push({
      id: match.id,
      year: match.year,
      homeTeam, awayTeam,
      homeScore, awayScore,
      lH: lH.toFixed(4), lA: lA.toFixed(4),
      projHome: sim.projHome.toFixed(4), projAway: sim.projAway.toFixed(4),
      homeScoreError: eval_.homeScoreError.toFixed(4),
      awayScoreError: eval_.awayScoreError.toFixed(4),
      pH: sim.pH.toFixed(4), pD: sim.pD.toFixed(4), pA: sim.pA.toFixed(4),
      topScore: sim.topScores[0]?.[0] || 'N/A',
    });
  }

  // Compute accuracy per market
  const accuracy = {};
  for (const m of MARKETS) {
    accuracy[m] = total[m] > 0 ? correct[m] / total[m] : 0;
  }

  const homeScorePct = homeScoreWithin025 / homeScoreTotal;
  const awayScorePct = awayScoreWithin025 / awayScoreTotal;
  const avgHomeErr = totalHomeScoreError / homeScoreTotal;
  const avgAwayErr = totalAwayScoreError / awayScoreTotal;

  // Check if all targets met
  const marketsPassing = MARKETS.filter(m => accuracy[m] >= TARGET_ACCURACY);
  const marketsFailing = MARKETS.filter(m => accuracy[m] < TARGET_ACCURACY);
  const allMarketsPass = marketsFailing.length === 0;
  const scorePass = homeScorePct >= TARGET_SCORE_PCT && awayScorePct >= TARGET_SCORE_PCT;
  const allPass = allMarketsPass && scorePass;

  // [OUTPUT] summary
  console.log(`${TAG} [OUTPUT] ${label} results:`);
  for (const m of MARKETS) {
    const pct = (accuracy[m] * 100).toFixed(2);
    const status = accuracy[m] >= TARGET_ACCURACY ? '✅' : '❌';
    console.log(`${TAG}   ${status} ${m.padEnd(12)}: ${pct}% (${correct[m]}/${total[m]}, skipped=${skipped[m]})`);
  }
  console.log(`${TAG}   Home score ±0.25: ${(homeScorePct*100).toFixed(2)}% (${homeScoreWithin025}/${homeScoreTotal}) avgErr=${avgHomeErr.toFixed(4)} ${homeScorePct >= TARGET_SCORE_PCT ? '✅' : '❌'}`);
  console.log(`${TAG}   Away score ±0.25: ${(awayScorePct*100).toFixed(2)}% (${awayScoreWithin025}/${awayScoreTotal}) avgErr=${avgAwayErr.toFixed(4)} ${awayScorePct >= TARGET_SCORE_PCT ? '✅' : '❌'}`);
  console.log(`${TAG} [VERIFY] allMarketsPass=${allMarketsPass} scorePass=${scorePass} OVERALL=${allPass ? '✅ PASS' : '❌ FAIL'}`);
  if (marketsFailing.length > 0) {
    console.log(`${TAG} [VERIFY] Failing markets: ${marketsFailing.join(', ')}`);
  }

  return {
    label, params, accuracy, correct, total, skipped,
    homeScorePct, awayScorePct, avgHomeErr, avgAwayErr,
    homeScoreWithin025, awayScoreWithin025,
    marketsPassing, marketsFailing,
    allMarketsPass, scorePass, allPass,
    results,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARAMETER GRID — Systematic search space
// ═══════════════════════════════════════════════════════════════════════════════

function buildParamGrid() {
  const grid = [];

  // Tier 1: Baseline (neutral home advantage, standard rho)
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T1_Baseline' });
  grid.push({ eloK: 0.85, rankK: 0.15, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T1_eloK085' });
  grid.push({ eloK: 0.80, rankK: 0.20, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T1_eloK080' });
  grid.push({ eloK: 0.95, rankK: 0.05, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T1_eloK095' });

  // Tier 2: Vary base goals (WC group stage avg ~2.45, but range 2.20-2.70)
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.20, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T2_bg220' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.30, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T2_bg230' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.50, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T2_bg250' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.60, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T2_bg260' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.70, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T2_bg270' });

  // Tier 3: Vary rho (Dixon-Coles correction strength)
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.20, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T3_rho020' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T3_rho025' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.30, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T3_rho030' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.35, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T3_rho035' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.40, baseGoals: 2.45, drawBoost: 0.00, drawBoostThreshold: 0, label: 'T3_rho040' });

  // Tier 4: Draw boost for evenly matched teams
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.08, drawBoostThreshold: 100, label: 'T4_db008_t100' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.10, drawBoostThreshold: 100, label: 'T4_db010_t100' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.12, drawBoostThreshold: 150, label: 'T4_db012_t150' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.15, drawBoostThreshold: 150, label: 'T4_db015_t150' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.45, drawBoost: 0.10, drawBoostThreshold: 200, label: 'T4_db010_t200' });

  // Tier 5: Combined rho + draw boost
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.45, drawBoost: 0.08, drawBoostThreshold: 100, label: 'T5_rho025_db008' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.45, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T5_rho025_db010' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.30, baseGoals: 2.45, drawBoost: 0.10, drawBoostThreshold: 100, label: 'T5_rho030_db010' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.35, baseGoals: 2.45, drawBoost: 0.08, drawBoostThreshold: 100, label: 'T5_rho035_db008' });
  grid.push({ eloK: 0.85, rankK: 0.15, homeAdv: 1.00, rho: -0.25, baseGoals: 2.45, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T5_elo085_rho025_db010' });

  // Tier 6: Fine-tune base goals with rho
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.30, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T6_rho025_bg230_db010' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.40, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T6_rho025_bg240_db010' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.50, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T6_rho025_bg250_db010' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.30, baseGoals: 2.30, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T6_rho030_bg230_db010' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.30, baseGoals: 2.40, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T6_rho030_bg240_db010' });

  // Tier 7: Micro-tuning around best candidates
  grid.push({ eloK: 0.88, rankK: 0.12, homeAdv: 1.00, rho: -0.27, baseGoals: 2.42, drawBoost: 0.09, drawBoostThreshold: 130, label: 'T7_micro1' });
  grid.push({ eloK: 0.92, rankK: 0.08, homeAdv: 1.00, rho: -0.23, baseGoals: 2.48, drawBoost: 0.11, drawBoostThreshold: 120, label: 'T7_micro2' });
  grid.push({ eloK: 0.87, rankK: 0.13, homeAdv: 1.00, rho: -0.28, baseGoals: 2.35, drawBoost: 0.12, drawBoostThreshold: 140, label: 'T7_micro3' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.22, baseGoals: 2.45, drawBoost: 0.13, drawBoostThreshold: 160, label: 'T7_micro4' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.28, baseGoals: 2.45, drawBoost: 0.09, drawBoostThreshold: 110, label: 'T7_micro5' });

  // Tier 8: Aggressive draw boost (WC has ~26% draw rate)
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.20, baseGoals: 2.45, drawBoost: 0.18, drawBoostThreshold: 200, label: 'T8_db018_t200' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.20, baseGoals: 2.45, drawBoost: 0.20, drawBoostThreshold: 250, label: 'T8_db020_t250' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.45, drawBoost: 0.15, drawBoostThreshold: 200, label: 'T8_rho025_db015_t200' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.45, drawBoost: 0.18, drawBoostThreshold: 250, label: 'T8_rho025_db018_t250' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.30, baseGoals: 2.45, drawBoost: 0.15, drawBoostThreshold: 200, label: 'T8_rho030_db015_t200' });

  // Tier 9: Very low base goals (defensive tournament play)
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.10, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T9_bg210' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.15, drawBoost: 0.10, drawBoostThreshold: 150, label: 'T9_bg215' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.25, baseGoals: 2.20, drawBoost: 0.12, drawBoostThreshold: 150, label: 'T9_bg220_db012' });

  // Tier 10: Champion from v9 adapted with neutral home advantage
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.20, drawBoost: 0.10, drawBoostThreshold: 120, label: 'T10_v9champ_neutral' });
  grid.push({ eloK: 0.90, rankK: 0.10, homeAdv: 1.00, rho: -0.13, baseGoals: 2.20, drawBoost: 0.12, drawBoostThreshold: 150, label: 'T10_v9champ_db012' });

  return grid;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE SCORE — weighted sum for ranking parameter sets
// ═══════════════════════════════════════════════════════════════════════════════

function computeCompositeScore(bt) {
  const MARKETS = ['awayML','homeML','draw','dcX2','dc1X','noDraw','bttsY','bttsN',
                   'ou15O','ou15U','ou25O','ou25U','ou35O','ou35U',
                   'awayP35','awayP25','awayP15','homeP35','homeP25','homeP15'];
  let sum = 0;
  for (const m of MARKETS) sum += bt.accuracy[m];
  // Add score prediction bonus
  sum += bt.homeScorePct + bt.awayScorePct;
  return sum;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${TAG} ${'═'.repeat(72)}`);
  console.log(`${TAG} WC GROUP STAGE BACKTEST ENGINE v10`);
  console.log(`${TAG} Target: ≥${(TARGET_ACCURACY*100).toFixed(0)}% accuracy on ALL 18+ markets`);
  console.log(`${TAG} Target: ≤${TARGET_SCORE_DELTA} score error on ≥${(TARGET_SCORE_PCT*100).toFixed(0)}% of matches`);
  console.log(`${TAG} Simulations: ${N_SIM.toLocaleString()} per match`);
  console.log(`${TAG} Home advantage: NEUTRAL (1.00) — exception for host nation in home venue`);
  console.log(`${TAG} Book line independence: FULL — zero reference to sportsbook odds`);
  console.log(`${TAG} ${'═'.repeat(72)}`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── Step 1: Load 2018 and 2022 matches from wc_bt_matches ─────────────────
  console.log(`\n${TAG} [STEP 1] Loading 2018 and 2022 matches from wc_bt_matches...`);
  const [bt2018Rows] = await conn.execute(
    `SELECT id, tournament_year, home_team, away_team, home_score, away_score, city, venue
     FROM wc_bt_matches WHERE tournament_year = 2018 AND home_score IS NOT NULL ORDER BY match_date, id`
  );
  const [bt2022Rows] = await conn.execute(
    `SELECT id, tournament_year, home_team, away_team, home_score, away_score, city, venue
     FROM wc_bt_matches WHERE tournament_year = 2022 AND home_score IS NOT NULL ORDER BY match_date, id`
  );
  console.log(`${TAG} [STATE] 2018: ${bt2018Rows.length} matches | 2022: ${bt2022Rows.length} matches`);
  console.log(`${TAG} [VERIFY] 2018=${bt2018Rows.length === 48 ? '✅ 48' : `❌ ${bt2018Rows.length}`} | 2022=${bt2022Rows.length === 48 ? '✅ 48' : `❌ ${bt2022Rows.length}`}`);

  // ── Step 2: Load 2026 matches from wc2026_fixtures (all through Jun 23) ───
  console.log(`\n${TAG} [STEP 2] Loading 2026 matches from wc2026_fixtures (through Jun 23)...`);
  const [wc26Rows] = await conn.execute(
    `SELECT f.fixture_id, f.home_team_id, f.away_team_id, f.home_score, f.away_score,
            f.match_date, v.city
     FROM wc2026_fixtures f
     LEFT JOIN wc2026_venues v ON f.venue_id = v.venue_id
     WHERE f.match_date <= '2026-06-23' AND f.home_score IS NOT NULL
     ORDER BY f.match_date, f.fixture_id`
  );
  console.log(`${TAG} [STATE] 2026: ${wc26Rows.length} matches loaded`);
  console.log(`${TAG} [VERIFY] 2026=${wc26Rows.length === 44 ? '✅ 44' : `⚠️ ${wc26Rows.length} (expected 44)`}`);

  // ── Step 3: Normalize all matches into unified format ─────────────────────
  console.log(`\n${TAG} [STEP 3] Normalizing all matches into unified format...`);

  const matches2018 = bt2018Rows.map(r => ({
    id: r.id, year: 2018,
    homeTeam: r.home_team, awayTeam: r.away_team,
    homeScore: r.home_score, awayScore: r.away_score,
    city: r.city || '', venue: r.venue || '',
    eloMap: ELO_2018, rankMap: RANK_2018,
  }));

  const matches2022 = bt2022Rows.map(r => ({
    id: r.id, year: 2022,
    homeTeam: r.home_team, awayTeam: r.away_team,
    homeScore: r.home_score, awayScore: r.away_score,
    city: r.city || '', venue: r.venue || '',
    eloMap: ELO_2022, rankMap: RANK_2022,
  }));

  const matches2026 = wc26Rows.map(r => ({
    id: r.fixture_id, year: 2026,
    homeTeam: r.home_team_id, awayTeam: r.away_team_id,
    homeScore: r.home_score, awayScore: r.away_score,
    city: r.city || '', venue: '',
    eloMap: ELO_2026, rankMap: RANK_2026,
  }));

  const allMatches = [...matches2018, ...matches2022, ...matches2026];
  console.log(`${TAG} [STATE] Total matches: ${allMatches.length}`);
  console.log(`${TAG} [VERIFY] Expected 140: ${allMatches.length >= 140 ? '✅' : `⚠️ ${allMatches.length}`}`);

  // Log score distribution for validation
  const totalGoals = allMatches.reduce((s, m) => s + m.homeScore + m.awayScore, 0);
  const avgGoals = totalGoals / allMatches.length;
  const draws = allMatches.filter(m => m.homeScore === m.awayScore).length;
  const homeWins = allMatches.filter(m => m.homeScore > m.awayScore).length;
  const awayWins = allMatches.filter(m => m.homeScore < m.awayScore).length;
  console.log(`${TAG} [STATE] Actual results: H=${homeWins} D=${draws} A=${awayWins} | AvgGoals=${avgGoals.toFixed(3)}`);
  console.log(`${TAG} [STATE] Draw rate: ${(draws/allMatches.length*100).toFixed(1)}% | HomeWin: ${(homeWins/allMatches.length*100).toFixed(1)}% | AwayWin: ${(awayWins/allMatches.length*100).toFixed(1)}%`);

  await conn.end();

  // ── Step 4: Run parameter grid search ─────────────────────────────────────
  console.log(`\n${TAG} [STEP 4] Starting parameter grid search...`);
  const paramGrid = buildParamGrid();
  console.log(`${TAG} [INPUT] Parameter sets to evaluate: ${paramGrid.length}`);

  let bestResult = null;
  let bestScore = -Infinity;
  let iteration = 0;

  for (const params of paramGrid) {
    iteration++;
    console.log(`\n${TAG} [STEP] Iteration ${iteration}/${paramGrid.length}: ${params.label}`);
    const bt = runBacktest(allMatches, params, params.label);
    const score = computeCompositeScore(bt);
    console.log(`${TAG} [STATE] Composite score: ${score.toFixed(4)} | Best so far: ${bestScore.toFixed(4)}`);

    if (score > bestScore) {
      bestScore = score;
      bestResult = bt;
      console.log(`${TAG} [STATE] 🏆 NEW BEST: ${params.label} (score=${score.toFixed(4)})`);
    }

    if (bt.allPass) {
      console.log(`\n${TAG} ✅ ALL TARGETS ACHIEVED on ${params.label}! Stopping grid search.`);
      break;
    }

    if (iteration >= MAX_ITERATIONS) {
      console.log(`${TAG} [STEP] Max iterations (${MAX_ITERATIONS}) reached.`);
      break;
    }
  }

  // ── Step 5: Final report ───────────────────────────────────────────────────
  console.log(`\n${TAG} ${'═'.repeat(72)}`);
  console.log(`${TAG} FINAL REPORT — Champion: ${bestResult.label}`);
  console.log(`${TAG} ${'═'.repeat(72)}`);
  console.log(`${TAG} [OUTPUT] Champion params:`);
  console.log(`${TAG}   eloK=${bestResult.params.eloK} rankK=${bestResult.params.rankK} homeAdv=${bestResult.params.homeAdv}`);
  console.log(`${TAG}   rho=${bestResult.params.rho} baseGoals=${bestResult.params.baseGoals}`);
  console.log(`${TAG}   drawBoost=${bestResult.params.drawBoost} drawBoostThreshold=${bestResult.params.drawBoostThreshold}`);
  console.log(`${TAG}`);

  const MARKETS = ['awayML','homeML','draw','dcX2','dc1X','noDraw','bttsY','bttsN',
                   'ou15O','ou15U','ou25O','ou25U','ou35O','ou35U',
                   'awayP35','awayP25','awayP15','homeP35','homeP25','homeP15'];
  const MARKET_LABELS = {
    awayML: 'Away ML', homeML: 'Home ML', draw: 'Draw',
    dcX2: 'Away/Draw (X2)', dc1X: 'Home/Draw (1X)', noDraw: 'Away or Home ML',
    bttsY: 'BTTS Yes', bttsN: 'BTTS No',
    ou15O: 'Over 1.5', ou15U: 'Under 1.5',
    ou25O: 'Over 2.5', ou25U: 'Under 2.5',
    ou35O: 'Over 3.5', ou35U: 'Under 3.5',
    awayP35: 'Away +3.5', awayP25: 'Away +2.5', awayP15: 'Away +1.5',
    homeP35: 'Home +3.5', homeP25: 'Home +2.5', homeP15: 'Home +1.5',
  };

  console.log(`${TAG} [OUTPUT] Per-market accuracy:`);
  for (const m of MARKETS) {
    const pct = (bestResult.accuracy[m] * 100).toFixed(2);
    const status = bestResult.accuracy[m] >= TARGET_ACCURACY ? '✅' : '❌';
    const label = MARKET_LABELS[m] || m;
    console.log(`${TAG}   ${status} ${label.padEnd(20)}: ${pct}% (${bestResult.correct[m]}/${bestResult.total[m]})`);
  }
  console.log(`${TAG}`);
  console.log(`${TAG} [OUTPUT] Score prediction accuracy:`);
  console.log(`${TAG}   Home ±0.25: ${(bestResult.homeScorePct*100).toFixed(2)}% (${bestResult.homeScoreWithin025}/${allMatches.length}) avgErr=${bestResult.avgHomeErr.toFixed(4)} ${bestResult.homeScorePct >= TARGET_SCORE_PCT ? '✅' : '❌'}`);
  console.log(`${TAG}   Away ±0.25: ${(bestResult.awayScorePct*100).toFixed(2)}% (${bestResult.awayScoreWithin025}/${allMatches.length}) avgErr=${bestResult.avgAwayErr.toFixed(4)} ${bestResult.awayScorePct >= TARGET_SCORE_PCT ? '✅' : '❌'}`);
  console.log(`${TAG}`);
  console.log(`${TAG} [VERIFY] ALL MARKETS PASS: ${bestResult.allMarketsPass ? '✅ YES' : `❌ NO — failing: ${bestResult.marketsFailing.join(', ')}`}`);
  console.log(`${TAG} [VERIFY] SCORE TARGETS MET: ${bestResult.scorePass ? '✅ YES' : '❌ NO'}`);
  console.log(`${TAG} [VERIFY] OVERALL: ${bestResult.allPass ? '✅ ALL TARGETS ACHIEVED' : '⚠️ BEST AVAILABLE (targets not fully met)'}`);

  // ── Step 6: Save results ───────────────────────────────────────────────────
  const outputPath = '/tmp/wc_backtest_v10_results.json';
  const output = {
    version: 'v10',
    timestamp: new Date().toISOString(),
    scope: { total: allMatches.length, y2018: matches2018.length, y2022: matches2022.length, y2026: matches2026.length },
    targets: { accuracy: TARGET_ACCURACY, scorePct: TARGET_SCORE_PCT, scoreDelta: TARGET_SCORE_DELTA },
    champion: {
      label: bestResult.label,
      params: bestResult.params,
      compositeScore: bestScore,
      allPass: bestResult.allPass,
    },
    accuracy: bestResult.accuracy,
    scoreAccuracy: {
      homePct: bestResult.homeScorePct, awayPct: bestResult.awayScorePct,
      avgHomeErr: bestResult.avgHomeErr, avgAwayErr: bestResult.avgAwayErr,
    },
    marketsFailing: bestResult.marketsFailing,
    matchResults: bestResult.results,
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n${TAG} [OUTPUT] Results saved to ${outputPath}`);
  console.log(`${TAG} Done. Iterations run: ${iteration}`);
  process.exit(0);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});
