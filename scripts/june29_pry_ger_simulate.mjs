/**
 * june29_pry_ger_simulate.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 * PARAGUAY vs GERMANY | wc26-r32-075 | June 29, 2026 | 4:30 PM ET (20:30 UTC)
 * 1,000,000 Bayesian Poisson + FIFA Elo Monte Carlo Simulations
 * Model Version: v7.2-R32 | Industry-Grade Logging Framework
 * ═══════════════════════════════════════════════════════════════════════════════
 * PIPELINE:
 *   [1] DB SEED   — Match + frozen book odds (book lines ONLY, no model)
 *   [2] SIMULATE  — 1M Poisson draws with Elo-adjusted lambdas
 *   [3] COMPUTE   — All market probabilities + no-vig fair odds
 *   [4] EDGE      — Book vs model edge detection (pp + ROI)
 *   [5] OUTPUT    — JSON results file (DO NOT seed model to DB until approved)
 *   [6] LOG       — Full structured log to /home/ubuntu/june29_pry_ger_sim.log
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

// ── LOGGING FRAMEWORK ─────────────────────────────────────────────────────────
const LOG_FILE = '/home/ubuntu/june29_pry_ger_sim.log';
const startTs = Date.now();
let stepCounter = 0;
const logLines = [];

function ts() { return new Date().toISOString(); }
function elapsed() { return ((Date.now() - startTs) / 1000).toFixed(3) + 's'; }

function log(level, tag, msg, data = null) {
  stepCounter++;
  const line = `[${ts()}] [${String(stepCounter).padStart(4,'0')}] [${level}] [${tag}] ${msg}${data ? ' | ' + JSON.stringify(data) : ''}`;
  console.log(line);
  logLines.push(line);
}

function logSep(title = '') {
  const sep = title
    ? `\n${'═'.repeat(80)}\n  ${title}\n${'═'.repeat(80)}`
    : '─'.repeat(80);
  console.log(sep);
  logLines.push(sep);
}

function flushLog() {
  fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n');
  log('INFO', 'LOG_FLUSH', `Log written to ${LOG_FILE} | lines=${logLines.length}`);
}

// ── MATCH CONSTANTS ───────────────────────────────────────────────────────────
const MATCH_ID     = 'wc26-r32-075';
const HOME_TEAM_ID   = 'ger';
const AWAY_TEAM_ID   = 'pry';
const HOME_NAME      = 'Germany';
const AWAY_NAME      = 'Paraguay';
const KICKOFF_ET     = '2026-06-29T20:30:00Z'; // 4:30 PM ET = 20:30 UTC
const VENUE          = 'SoFi Stadium, Inglewood, CA';
const ROUND          = 'R32';
const N_SIMS         = 1_000_000;

// ── BOOK ODDS (FROZEN — DraftKings) ──────────────────────────────────────────
const BOOK = {
  toAdvanceHome:  -700,  // Germany to advance
  toAdvanceAway:  +450,  // Paraguay to advance
  homeML:         -275,  // Germany ML
  drawML:         +400,  // Draw
  awayML:         +800,  // Paraguay ML
  noDrawAway:    -2000,  // Paraguay or Germany (No Draw)
  overOdds:       -140,  // Over 2.5
  underOdds:      +110,  // Under 2.5
  totalLine:       2.5,
  homeSpreadLine:  -1.5, // Germany -1.5
  homeSpreadOdds:  +105, // Germany -1.5 odds
  awaySpreadLine:  +1.5, // Paraguay +1.5
  awaySpreadOdds:  -135, // Paraguay +1.5 odds
  dc1X:           +370,  // Paraguay or Draw
  dcX2:          -1100,  // Germany or Draw
  bttsYes:        +100,  // BTTS YES
  bttsNo:         -130,  // BTTS NO
};

// ── FIFA ELO RATINGS (June 2026) ──────────────────────────────────────────────
// Germany: Top-8 WC contender, strong European pedigree, ELO ~2050
// Paraguay: CONMEBOL qualifier, significant underdog, ELO ~1680
const ELO_HOME = 2050;  // Germany
const ELO_AWAY = 1680;  // Paraguay
const ELO_DIFF = ELO_HOME - ELO_AWAY;

// ── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────
function americanToProb(ml) {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round((1 - p) / p * 100);
}

function noVig2Way(p1Raw, p2Raw) {
  const total = p1Raw + p2Raw;
  return { p1: p1Raw / total, p2: p2Raw / total };
}

function noVig3Way(pHRaw, pDRaw, pARaw) {
  const total = pHRaw + pDRaw + pARaw;
  return { pH: pHRaw / total, pD: pDRaw / total, pA: pARaw / total };
}

function poissonPMF(lambda, k) {
  // Poisson probability mass function P(X=k)
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function computeEdge(bookML, modelML) {
  if (bookML == null || modelML == null) return { edge: 0, roiPct: 0, significant: false, direction: 'N/A' };
  const bookProb = americanToProb(bookML);
  const modelProb = americanToProb(modelML);
  const edge = modelProb - bookProb;
  // ROI = (modelProb * (payout) - (1 - modelProb)) where payout = bookML>0 ? bookML/100 : 100/|bookML|
  const payout = bookML > 0 ? bookML / 100 : 100 / Math.abs(bookML);
  const roi = (modelProb * payout - (1 - modelProb)) * 100;
  const significant = Math.abs(edge) >= 0.04; // 4pp threshold
  const direction = edge > 0 ? 'MODEL_EDGE' : 'BOOK_EDGE';
  return { edge: edge.toFixed(4), roiPct: roi.toFixed(2), significant, direction };
}

// ── STEP 1: ELO-ADJUSTED LAMBDA COMPUTATION ───────────────────────────────────
logSep('STEP 1 — ELO-ADJUSTED LAMBDA COMPUTATION');
log('INPUT', 'ELO', `Home=${HOME_NAME} ELO=${ELO_HOME} | Away=${AWAY_NAME} ELO=${ELO_AWAY} | Diff=${ELO_DIFF}`);

// Base WC 2026 R32 expected goals (group stage avg ~2.6 goals/game)
// Elo advantage factor: each 100 Elo points ≈ 0.25 goal differential
const BASE_TOTAL = 2.55;
const ELO_FACTOR = 0.0025; // per Elo point
const eloAdj = ELO_DIFF * ELO_FACTOR; // positive = home advantage in goals

// No-vig 3-way probs from book ML
const rawH = americanToProb(BOOK.homeML);
const rawD = americanToProb(BOOK.drawML);
const rawA = americanToProb(BOOK.awayML);
const { pH: nvH, pD: nvD, pA: nvA } = noVig3Way(rawH, rawD, rawA);

log('STATE', 'NO_VIG_3WAY', `rawH=${rawH.toFixed(6)} rawD=${rawD.toFixed(6)} rawA=${rawA.toFixed(6)} | nvH=${nvH.toFixed(6)} nvD=${nvD.toFixed(6)} nvA=${nvA.toFixed(6)}`);

// Expected goals from Dixon-Coles style calibration
// Germany is a massive favorite — lambda calibrated to Elo + book probs
const HOME_ATTACK_STRENGTH = 1.85; // Germany attack rating (WC 2026 form)
const AWAY_DEFENSE_STRENGTH = 0.72; // Paraguay defense rating
const AWAY_ATTACK_STRENGTH = 0.65; // Paraguay attack rating
const HOME_DEFENSE_STRENGTH = 1.35; // Germany defense rating

const LEAGUE_AVG_HOME = 1.45; // WC R32 home avg goals
const LEAGUE_AVG_AWAY = 0.95; // WC R32 away avg goals

// Dixon-Coles expected goals
let lambdaHome = HOME_ATTACK_STRENGTH * AWAY_DEFENSE_STRENGTH * LEAGUE_AVG_HOME;
let lambdaAway = AWAY_ATTACK_STRENGTH * HOME_DEFENSE_STRENGTH * LEAGUE_AVG_AWAY;

// Elo adjustment: shift expected goals toward home team
lambdaHome += eloAdj * 0.55;
lambdaAway -= eloAdj * 0.45;
lambdaHome = Math.max(0.15, lambdaHome);
lambdaAway = Math.max(0.05, lambdaAway);

log('STATE', 'LAMBDA_COMPUTE', `eloAdj=${eloAdj.toFixed(4)} | lambdaHome=${lambdaHome.toFixed(6)} lambdaAway=${lambdaAway.toFixed(6)} | projTotal=${(lambdaHome+lambdaAway).toFixed(4)}`);

// ── STEP 2: VALIDATE LAMBDAS AGAINST BOOK PROBABILITIES ──────────────────────
logSep('STEP 2 — LAMBDA VALIDATION AGAINST BOOK PROBS');

// Compute theoretical 3-way probs from Poisson lambdas (up to score 10-10)
let pHomeWin = 0, pDraw = 0, pAwayWin = 0;
for (let h = 0; h <= 10; h++) {
  for (let a = 0; a <= 10; a++) {
    const p = poissonPMF(lambdaHome, h) * poissonPMF(lambdaAway, a);
    if (h > a) pHomeWin += p;
    else if (h === a) pDraw += p;
    else pAwayWin += p;
  }
}
const poissonTotal = pHomeWin + pDraw + pAwayWin;
pHomeWin /= poissonTotal; pDraw /= poissonTotal; pAwayWin /= poissonTotal;

log('VERIFY', 'POISSON_3WAY', `pHomeWin=${pHomeWin.toFixed(6)} pDraw=${pDraw.toFixed(6)} pAwayWin=${pAwayWin.toFixed(6)} | sum=${(pHomeWin+pDraw+pAwayWin).toFixed(8)}`);
log('VERIFY', 'BOOK_VS_POISSON', `nvH=${nvH.toFixed(4)} vs pHW=${pHomeWin.toFixed(4)} diff=${(pHomeWin-nvH).toFixed(4)} | nvD=${nvD.toFixed(4)} vs pD=${pDraw.toFixed(4)} | nvA=${nvA.toFixed(4)} vs pAW=${pAwayWin.toFixed(4)}`);

// Blend: 60% Elo-Poisson, 40% book no-vig for final probs
const BLEND_MODEL = 0.60;
const BLEND_BOOK  = 0.40;
const blendH = BLEND_MODEL * pHomeWin + BLEND_BOOK * nvH;
const blendD = BLEND_MODEL * pDraw    + BLEND_BOOK * nvD;
const blendA = BLEND_MODEL * pAwayWin + BLEND_BOOK * nvA;
const blendTotal = blendH + blendD + blendA;
const finalH = blendH / blendTotal;
const finalD = blendD / blendTotal;
const finalA = blendA / blendTotal;

log('STATE', 'BLEND_PROBS', `blendH=${finalH.toFixed(6)} blendD=${finalD.toFixed(6)} blendA=${finalA.toFixed(6)} | sum=${(finalH+finalD+finalA).toFixed(8)}`);

// Recalibrate lambdas to match blended probs
const targetRatio = Math.log((finalH + 0.5 * finalD) / (finalA + 0.5 * finalD));
const totalLambda = lambdaHome + lambdaAway;
lambdaHome = totalLambda * (finalH + 0.5 * finalD);
lambdaAway = totalLambda * (finalA + 0.5 * finalD);
lambdaHome = Math.max(0.15, lambdaHome);
lambdaAway = Math.max(0.05, lambdaAway);

log('STATE', 'LAMBDA_RECALIBRATED', `lambdaHome=${lambdaHome.toFixed(6)} lambdaAway=${lambdaAway.toFixed(6)} | projTotal=${(lambdaHome+lambdaAway).toFixed(4)}`);

// ── STEP 3: 1M MONTE CARLO SIMULATION ────────────────────────────────────────
logSep('STEP 3 — 1,000,000 MONTE CARLO SIMULATIONS');
log('INPUT', 'SIM_PARAMS', `N=${N_SIMS.toLocaleString()} | lambdaHome=${lambdaHome.toFixed(6)} lambdaAway=${lambdaAway.toFixed(6)}`);

// Precompute Poisson CDF for scores 0-12
function buildPoissonCDF(lambda, maxK = 12) {
  const cdf = new Float64Array(maxK + 2);
  let cumP = 0;
  for (let k = 0; k <= maxK; k++) {
    cumP += poissonPMF(lambda, k);
    cdf[k] = cumP;
  }
  cdf[maxK + 1] = 1.0;
  return cdf;
}

function samplePoisson(cdf, rng) {
  for (let k = 0; k < cdf.length - 1; k++) {
    if (rng < cdf[k]) return k;
  }
  return cdf.length - 2;
}

const cdfHome = buildPoissonCDF(lambdaHome);
const cdfAway = buildPoissonCDF(lambdaAway);

log('STATE', 'CDF_BUILT', `cdfHome[0]=${cdfHome[0].toFixed(6)} cdfHome[1]=${cdfHome[1].toFixed(6)} cdfHome[2]=${cdfHome[2].toFixed(6)} | cdfAway[0]=${cdfAway[0].toFixed(6)}`);

// Simulation counters
let homeWins = 0, draws = 0, awayWins = 0;
let over25 = 0, under25 = 0;
let bttsYes = 0, bttsNo = 0;
let homeAdvances = 0, awayAdvances = 0;
let homeSpreadCover = 0, awaySpreadCover = 0; // home -1.5 / away +1.5
let totalGoals = 0;
let homeTotalGoals = 0, awayTotalGoals = 0;
const scoreCounts = new Map();

// LCG PRNG for deterministic, fast simulation
let seed = 0xDEADBEEF ^ (Date.now() & 0xFFFFFFFF);
function lcg() {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
}

const SIM_START = Date.now();
log('STEP', 'SIM_START', `Starting ${N_SIMS.toLocaleString()} simulations | PRNG=LCG | seed=${seed}`);

for (let i = 0; i < N_SIMS; i++) {
  const hGoals = samplePoisson(cdfHome, lcg());
  const aGoals = samplePoisson(cdfAway, lcg());
  const total = hGoals + aGoals;

  totalGoals += total;
  homeTotalGoals += hGoals;
  awayTotalGoals += aGoals;

  if (hGoals > aGoals) {
    homeWins++;
    homeAdvances++;
    if (hGoals - aGoals >= 2) homeSpreadCover++;
    awaySpreadCover++; // away +1.5 covers when home wins by exactly 1 too
    if (hGoals - aGoals === 1) awaySpreadCover--; // undo: away +1.5 loses when home wins by exactly 1? No: +1.5 covers unless home wins by 2+
  } else if (hGoals === aGoals) {
    draws++;
    // Knockout: extra time + penalties — model as 50/50 for advancement
    if (lcg() < 0.5) homeAdvances++;
    else awayAdvances++;
    awaySpreadCover++; // draw: away +1.5 covers, home -1.5 does not
  } else {
    awayWins++;
    awayAdvances++;
    awaySpreadCover++;
  }

  if (total > 2.5) over25++;
  else under25++;

  if (hGoals >= 1 && aGoals >= 1) bttsYes++;
  else bttsNo++;

  const key = `${hGoals}-${aGoals}`;
  scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
}

// FIX v7.3: Correct spread recount — clean canonical formula
// Germany -1.5 covers: Germany wins by 2 or more goals (h - a >= 2)
// Paraguay +1.5 covers: Paraguay does NOT lose by 2+ (i.e., h - a <= 1)
// These are strict complements: awaySpreadCover = N_SIMS - homeSpreadCover
homeSpreadCover = 0;
for (const [score, count] of scoreCounts) {
  const [h, a] = score.split('-').map(Number);
  if (h - a >= 2) homeSpreadCover += count;  // Germany covers -1.5
}
awaySpreadCover = N_SIMS - homeSpreadCover;  // Paraguay covers +1.5 (strict complement)

const SIM_END = Date.now();
const simMs = SIM_END - SIM_START;

log('STATE', 'SIM_COMPLETE', `sims=${N_SIMS.toLocaleString()} | elapsed=${simMs}ms | homeWins=${homeWins} draws=${draws} awayWins=${awayWins}`);
log('VERIFY', 'SIM_TOTAL_CHECK', `homeWins+draws+awayWins=${homeWins+draws+awayWins} | expected=${N_SIMS} | PASS=${homeWins+draws+awayWins===N_SIMS}`);

// ── STEP 4: PROBABILITY COMPUTATION ──────────────────────────────────────────
logSep('STEP 4 — PROBABILITY COMPUTATION');

const pHW = homeWins / N_SIMS;
const pD  = draws   / N_SIMS;
const pAW = awayWins / N_SIMS;
const pHA = homeAdvances / N_SIMS;
const pAA = awayAdvances / N_SIMS;
const pOver25  = over25  / N_SIMS;
const pUnder25 = under25 / N_SIMS;
const pBttsY   = bttsYes / N_SIMS;
const pBttsN   = bttsNo  / N_SIMS;
const pHomeSpr = homeSpreadCover / N_SIMS;
const pAwaySpr = awaySpreadCover / N_SIMS;
const pNoDraw  = (homeWins + awayWins) / N_SIMS;
const pDC1X    = (draws + awayWins) / N_SIMS;  // Paraguay or Draw
const pDCX2    = (homeWins + draws) / N_SIMS;  // Germany or Draw

const projHomeScore = homeTotalGoals / N_SIMS;
const projAwayScore = awayTotalGoals / N_SIMS;
const projTotal = totalGoals / N_SIMS;
const projSpread = projHomeScore - projAwayScore;

log('OUTPUT', 'PROBS_3WAY', `pHW=${pHW.toFixed(6)} pD=${pD.toFixed(6)} pAW=${pAW.toFixed(6)} | sum=${(pHW+pD+pAW).toFixed(8)}`);
log('OUTPUT', 'PROBS_ADVANCE', `pHA=${pHA.toFixed(6)} pAA=${pAA.toFixed(6)} | sum=${(pHA+pAA).toFixed(8)}`);
log('OUTPUT', 'PROBS_TOTAL', `pOver25=${pOver25.toFixed(6)} pUnder25=${pUnder25.toFixed(6)} | sum=${(pOver25+pUnder25).toFixed(8)}`);
log('OUTPUT', 'PROBS_BTTS', `pBttsY=${pBttsY.toFixed(6)} pBttsN=${pBttsN.toFixed(6)} | sum=${(pBttsY+pBttsN).toFixed(8)}`);
log('OUTPUT', 'PROBS_SPREAD', `pHomeSpr=${pHomeSpr.toFixed(6)} pAwaySpr=${pAwaySpr.toFixed(6)} | sum=${(pHomeSpr+pAwaySpr).toFixed(8)}`);
log('OUTPUT', 'PROBS_DC', `pDC1X=${pDC1X.toFixed(6)} pDCX2=${pDCX2.toFixed(6)}`);
log('OUTPUT', 'PROJ_SCORE', `GER ${projHomeScore.toFixed(4)} - ${projAwayScore.toFixed(4)} PRY | total=${projTotal.toFixed(4)} spread=${projSpread.toFixed(4)}`);

// ── STEP 5: MODEL ODDS COMPUTATION (NO-VIG) ───────────────────────────────────
logSep('STEP 5 — MODEL ODDS COMPUTATION (NO-VIG FAIR ODDS)');

// 3-way no-vig for ML
const nvModelH = pHW / (pHW + pD + pAW);
const nvModelD = pD  / (pHW + pD + pAW);
const nvModelA = pAW / (pHW + pD + pAW);

const modelHomeML  = probToAmerican(nvModelH);
const modelDrawML  = probToAmerican(nvModelD);
const modelAwayML  = probToAmerican(nvModelA);

// FIX v7.3 — Corrected market computations:
// ADVANCE: pHA and pAA already sum to 1.0 by construction (knockout format)
//   Do NOT apply noVig2Way — that inflates the underdog's advance probability.
//   Use raw probabilities directly in probToAmerican().
// NO DRAW: pNoDraw = pH + pA (unconditional). probToAmerican(pNoDraw) is correct.
//   WRONG: probToAmerican(pNoDraw / (pNoDraw + pD)) normalizes against sub-1 denominator.
// SPREAD: pHomeSpr + pAwaySpr = 1.0 (strict complements after fix above).

const { p1: nvOver, p2: nvUnder } = noVig2Way(pOver25, pUnder25);
const { p1: nvHomeSpr, p2: nvAwaySpr } = noVig2Way(pHomeSpr, pAwaySpr);
const { p1: nvBttsY, p2: nvBttsN } = noVig2Way(pBttsY, pBttsN);
const { p1: nvDC1X, p2: nvDCX2 } = noVig2Way(pDC1X, pDCX2);

const modelOverML  = probToAmerican(nvOver);
const modelUnderML = probToAmerican(nvUnder);
const modelHomeSprML = probToAmerican(nvHomeSpr);
const modelAwaySprML = probToAmerican(nvAwaySpr);
const modelBttsYML = probToAmerican(nvBttsY);
const modelBttsNML = probToAmerican(nvBttsN);
// ADVANCE FIX: raw probabilities (already sum to 1.0)
const modelAdvHomeML = probToAmerican(pHA);
const modelAdvAwayML = probToAmerican(pAA);
// NO DRAW FIX: unconditional probability
const modelNoDrawML  = probToAmerican(pNoDraw);
const modelDC1XML    = probToAmerican(nvDC1X);
const modelDCX2ML    = probToAmerican(nvDCX2);

log('FIX', 'ADVANCE_FIX', `pHA=${pHA.toFixed(6)} pAA=${pAA.toFixed(6)} sum=${(pHA+pAA).toFixed(8)} | GER_ADV=${modelAdvHomeML} PRY_ADV=${modelAdvAwayML}`);
log('FIX', 'NODRAW_FIX', `pNoDraw=${pNoDraw.toFixed(6)} (=pHW+pAW) | modelNoDrawML=${modelNoDrawML}`);
log('FIX', 'SPREAD_FIX', `pHomeSpr=${pHomeSpr.toFixed(6)} pAwaySpr=${pAwaySpr.toFixed(6)} sum=${(pHomeSpr+pAwaySpr).toFixed(8)}`);

log('OUTPUT', 'MODEL_ML', `GER=${modelHomeML} Draw=${modelDrawML} PRY=${modelAwayML}`);
log('OUTPUT', 'MODEL_ADVANCE', `GER_ADV=${modelAdvHomeML} PRY_ADV=${modelAdvAwayML}`);
log('OUTPUT', 'MODEL_SPREAD', `GER-1.5=${modelHomeSprML} PRY+1.5=${modelAwaySprML}`);
log('OUTPUT', 'MODEL_TOTAL', `Over2.5=${modelOverML} Under2.5=${modelUnderML}`);
log('OUTPUT', 'MODEL_BTTS', `YES=${modelBttsYML} NO=${modelBttsNML}`);
log('OUTPUT', 'MODEL_DC', `DC1X(PRY_or_Draw)=${modelDC1XML} DCX2(GER_or_Draw)=${modelDCX2ML}`);
log('OUTPUT', 'MODEL_NODRAW', `NoDrawOdds=${modelNoDrawML}`);

// ── STEP 6: EDGE DETECTION ────────────────────────────────────────────────────
logSep('STEP 6 — EDGE DETECTION (BOOK vs MODEL)');

const edges = {
  ger_advance:  computeEdge(BOOK.toAdvanceHome, modelAdvHomeML),
  pry_advance:  computeEdge(BOOK.toAdvanceAway, modelAdvAwayML),
  ger_ml:       computeEdge(BOOK.homeML, modelHomeML),
  draw_ml:      computeEdge(BOOK.drawML, modelDrawML),
  pry_ml:       computeEdge(BOOK.awayML, modelAwayML),
  ger_spread:   computeEdge(BOOK.homeSpreadOdds, modelHomeSprML),
  pry_spread:   computeEdge(BOOK.awaySpreadOdds, modelAwaySprML),
  over_25:      computeEdge(BOOK.overOdds, modelOverML),
  under_25:     computeEdge(BOOK.underOdds, modelUnderML),
  btts_yes:     computeEdge(BOOK.bttsYes, modelBttsYML),
  btts_no:      computeEdge(BOOK.bttsNo, modelBttsNML),
  dc_1x:        computeEdge(BOOK.dc1X, modelDC1XML),
  dc_x2:        computeEdge(BOOK.dcX2, modelDCX2ML),
};

for (const [market, e] of Object.entries(edges)) {
  const flag = e.significant && e.direction === 'MODEL_EDGE' ? '*** MODEL_EDGE ***' : '';
  log('OUTPUT', `EDGE_${market.toUpperCase()}`, `edge=${e.edge} roiPct=${e.roiPct}% dir=${e.direction} sig=${e.significant} ${flag}`);
}

// ── STEP 7: TOP SCORELINES ────────────────────────────────────────────────────
logSep('STEP 7 — TOP SCORELINES');
const topScorelines = Array.from(scoreCounts.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([score, count]) => ({ score, count, pct: ((count / N_SIMS) * 100).toFixed(3) }));

topScorelines.forEach(s => log('OUTPUT', 'SCORELINE', `GER ${s.score} PRY | ${s.pct}% (${s.count.toLocaleString()} sims)`));

// ── STEP 8: INVARIANT VALIDATION ─────────────────────────────────────────────
logSep('STEP 8 — INVARIANT VALIDATION');

const invariants = [
  ['3WAY_SUM_APPROX_1',    Math.abs(pHW + pD + pAW - 1) < 0.0001,       `${(pHW+pD+pAW).toFixed(8)}`],
  ['ADVANCE_SUM_APPROX_1', Math.abs(pHA + pAA - 1) < 0.0001,            `${(pHA+pAA).toFixed(8)}`],
  ['TOTAL_SUM_APPROX_1',   Math.abs(pOver25 + pUnder25 - 1) < 0.0001,   `${(pOver25+pUnder25).toFixed(8)}`],
  ['BTTS_SUM_APPROX_1',    Math.abs(pBttsY + pBttsN - 1) < 0.0001,      `${(pBttsY+pBttsN).toFixed(8)}`],
  ['SPREAD_SUM_APPROX_1',  Math.abs(pHomeSpr + pAwaySpr - 1) < 0.001,   `${(pHomeSpr+pAwaySpr).toFixed(8)}`],
  ['HOME_FAV_WINS_MORE',   pHW > pAW,                                    `pHW=${pHW.toFixed(4)} > pAW=${pAW.toFixed(4)}`],
  ['GER_ADVANCES_MORE',    pHA > pAA,                                    `pHA=${pHA.toFixed(4)} > pAA=${pAA.toFixed(4)}`],
  ['LAMBDA_HOME_POSITIVE', lambdaHome > 0,                               `lambdaHome=${lambdaHome.toFixed(6)}`],
  ['LAMBDA_AWAY_POSITIVE', lambdaAway > 0,                               `lambdaAway=${lambdaAway.toFixed(6)}`],
  ['SIM_COUNT_EXACT',      homeWins + draws + awayWins === N_SIMS,       `${homeWins+draws+awayWins}`],
];

let allPass = true;
for (const [name, pass, detail] of invariants) {
  log(pass ? 'VERIFY' : 'ERROR', `INVARIANT_${name}`, `${pass ? 'PASS' : 'FAIL'} | ${detail}`);
  if (!pass) allPass = false;
}
log(allPass ? 'VERIFY' : 'ERROR', 'INVARIANTS_SUMMARY', `${allPass ? 'ALL PASS' : 'FAILURES DETECTED'} | ${invariants.length} checks`);

// ── STEP 9: SEED MATCH + BOOK ODDS TO DB ────────────────────────────────────
logSep('STEP 9 — SEED MATCH + FROZEN BOOK ODDS TO DB');

let conn;
try {
  conn = await mysql.createConnection(process.env.DATABASE_URL);
  log('STEP', 'DB_CONNECT', 'MySQL connection established');

  // Upsert match
  await conn.execute(`
    INSERT INTO wc2026_matches
      (match_id, home_team_id, away_team_id, kickoff_utc, venue, round, status, group_name)
    VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL)
    ON DUPLICATE KEY UPDATE
      home_team_id=VALUES(home_team_id), away_team_id=VALUES(away_team_id),
      kickoff_utc=VALUES(kickoff_utc), venue=VALUES(venue), round=VALUES(round)
  `, [MATCH_ID, HOME_TEAM_ID, AWAY_TEAM_ID, KICKOFF_ET, VENUE, ROUND]);
  log('VERIFY', 'DB_MATCH_UPSERT', `PASS | match_id=${MATCH_ID} home=${HOME_TEAM_ID} away=${AWAY_TEAM_ID}`);

  // Upsert frozen book odds (BOOK LINES ONLY — no model)
  await conn.execute(`
    INSERT INTO wc2026_frozen_book_odds
      (match_id, book_home_ml, book_draw_ml, book_away_ml,
       book_spread_line, book_home_spread_odds, book_away_spread_odds,
       book_total_line, book_over_odds, book_under_odds,
       book_btts_yes_odds, book_btts_no_odds,
       book_dc_1x_odds, book_dc_x2_odds,
       book_no_draw_home_odds, book_no_draw_away_odds,
       to_advance_home_odds, to_advance_away_odds,
       frozen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      book_home_ml=VALUES(book_home_ml), book_draw_ml=VALUES(book_draw_ml),
      book_away_ml=VALUES(book_away_ml), book_spread_line=VALUES(book_spread_line),
      book_home_spread_odds=VALUES(book_home_spread_odds), book_away_spread_odds=VALUES(book_away_spread_odds),
      book_total_line=VALUES(book_total_line), book_over_odds=VALUES(book_over_odds),
      book_under_odds=VALUES(book_under_odds), book_btts_yes_odds=VALUES(book_btts_yes_odds),
      book_btts_no_odds=VALUES(book_btts_no_odds), book_dc_1x_odds=VALUES(book_dc_1x_odds),
      book_dc_x2_odds=VALUES(book_dc_x2_odds), book_no_draw_away_odds=VALUES(book_no_draw_away_odds),
      to_advance_home_odds=VALUES(to_advance_home_odds), to_advance_away_odds=VALUES(to_advance_away_odds),
      frozen_at=NOW()
  `, [
    MATCH_ID,
    BOOK.homeML, BOOK.drawML, BOOK.awayML,
    BOOK.homeSpreadLine, BOOK.homeSpreadOdds, BOOK.awaySpreadOdds,
    BOOK.totalLine, BOOK.overOdds, BOOK.underOdds,
    BOOK.bttsYes, BOOK.bttsNo,
    BOOK.dc1X, BOOK.dcX2,
    BOOK.noDrawAway,
    BOOK.toAdvanceHome, BOOK.toAdvanceAway,
  ]);
  log('VERIFY', 'DB_BOOK_ODDS_UPSERT', `PASS | match_id=${MATCH_ID} | homeML=${BOOK.homeML} drawML=${BOOK.drawML} awayML=${BOOK.awayML} | toAdvHome=${BOOK.toAdvanceHome} toAdvAway=${BOOK.toAdvanceAway} | noDrawAway=${BOOK.noDrawAway}`);

  // Verify the row
  const [verRows] = await conn.execute(
    'SELECT match_id, book_home_ml, book_draw_ml, book_away_ml, book_no_draw_away_odds, to_advance_home_odds, to_advance_away_odds, frozen_at FROM wc2026_frozen_book_odds WHERE match_id=?',
    [MATCH_ID]
  );
  if (verRows.length === 1) {
    log('VERIFY', 'DB_BOOK_ODDS_READ', `PASS | ${JSON.stringify(verRows[0])}`);
  } else {
    log('ERROR', 'DB_BOOK_ODDS_READ', `FAIL | expected 1 row, got ${verRows.length}`);
  }

  await conn.end();
  log('STEP', 'DB_DISCONNECT', 'MySQL connection closed');
} catch (err) {
  log('ERROR', 'DB_SEED', `FAIL | ${err.message}`, { stack: err.stack?.split('\n')[1] });
  if (conn) await conn.end().catch(() => {});
}

// ── STEP 10: WRITE RESULTS JSON ───────────────────────────────────────────────
logSep('STEP 10 — WRITE RESULTS JSON');

const results = {
  match_id: MATCH_ID,
  home: HOME_NAME, away: AWAY_NAME,
  kickoff_et: '4:30 PM ET', kickoff_utc: KICKOFF_ET,
  n_sims: N_SIMS,
  elo_home: ELO_HOME, elo_away: ELO_AWAY, elo_diff: ELO_DIFF,
  home_lam: lambdaHome.toFixed(6), away_lam: lambdaAway.toFixed(6),
  // Probabilities
  home_win_prob: pHW.toFixed(6), draw_prob: pD.toFixed(6), away_win_prob: pAW.toFixed(6),
  p_home_advances: pHA.toFixed(6), p_away_advances: pAA.toFixed(6),
  p_over_25: pOver25.toFixed(6), p_under_25: pUnder25.toFixed(6),
  btts_prob: pBttsY.toFixed(6),
  p_home_spread: pHomeSpr.toFixed(6), p_away_spread: pAwaySpr.toFixed(6),
  p_no_draw: pNoDraw.toFixed(6),
  p_dc_1x: pDC1X.toFixed(6), p_dc_x2: pDCX2.toFixed(6),
  // Projections
  proj_home_score: projHomeScore.toFixed(4),
  proj_away_score: projAwayScore.toFixed(4),
  proj_total: projTotal.toFixed(4),
  proj_spread: projSpread.toFixed(4),
  mode_score: topScorelines[0]?.score ?? 'N/A',
  // Model odds
  model_home_ml: modelHomeML,
  model_draw_ml: modelDrawML,
  model_away_ml: modelAwayML,
  model_to_advance_home_ml: modelAdvHomeML,
  model_to_advance_away_ml: modelAdvAwayML,
  model_home_spread_ml: modelHomeSprML,
  model_away_spread_ml: modelAwaySprML,
  model_over_ml: modelOverML,
  model_under_ml: modelUnderML,
  model_btts_yes_ml: modelBttsYML,
  model_btts_no_ml: modelBttsNML,
  model_dc_1x_ml: modelDC1XML,
  model_dc_x2_ml: modelDCX2ML,
  model_no_draw_ml: modelNoDrawML,
  // Book odds
  book: BOOK,
  // Edges
  edges,
  // Top scorelines
  top_scorelines: topScorelines,
  // Meta
  model_version: 'v7.2-R32',
  generated_at: new Date().toISOString(),
  elapsed_ms: Date.now() - startTs,
};

const JSON_FILE = '/home/ubuntu/june29_pry_ger_results.json';
fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2));
log('VERIFY', 'JSON_WRITE', `PASS | file=${JSON_FILE} | size=${fs.statSync(JSON_FILE).size} bytes`);

// ── FINAL SUMMARY ─────────────────────────────────────────────────────────────
logSep('FINAL SUMMARY — PARAGUAY vs GERMANY');
log('OUTPUT', 'FINAL_SCORE_PROJ', `GER ${projHomeScore.toFixed(2)} - ${projAwayScore.toFixed(2)} PRY | Total=${projTotal.toFixed(2)} | Spread=${projSpread.toFixed(2)}`);
log('OUTPUT', 'FINAL_PROBS', `GER Win=${(pHW*100).toFixed(2)}% Draw=${(pD*100).toFixed(2)}% PRY Win=${(pAW*100).toFixed(2)}%`);
log('OUTPUT', 'FINAL_ADVANCE', `GER Advances=${(pHA*100).toFixed(2)}% PRY Advances=${(pAA*100).toFixed(2)}%`);
log('OUTPUT', 'FINAL_MODEL_ML', `GER ML=${modelHomeML} Draw=${modelDrawML} PRY ML=${modelAwayML}`);
log('OUTPUT', 'FINAL_ADVANCE_ML', `GER ADV=${modelAdvHomeML} PRY ADV=${modelAdvAwayML}`);
log('OUTPUT', 'FINAL_ELAPSED', `Total elapsed=${elapsed()} | sims=${N_SIMS.toLocaleString()} | simSpeed=${(N_SIMS/simMs*1000).toFixed(0)} sims/sec`);

const sigEdges = Object.entries(edges).filter(([,e]) => e.significant && e.direction === 'MODEL_EDGE');
if (sigEdges.length > 0) {
  log('OUTPUT', 'SIGNIFICANT_EDGES', `${sigEdges.length} model edges found:`);
  sigEdges.forEach(([k,e]) => log('OUTPUT', `EDGE_${k.toUpperCase()}`, `edge=${e.edge} ROI=${e.roiPct}%`));
} else {
  log('OUTPUT', 'SIGNIFICANT_EDGES', 'None above 4pp threshold');
}

log('VERIFY', 'PIPELINE_COMPLETE', `ALL STEPS COMPLETE | match=${MATCH_ID} | allInvariantsPass=${allPass}`);
flushLog();
