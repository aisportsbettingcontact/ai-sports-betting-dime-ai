/**
 * june29_mar_ned_simulate.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 * MOROCCO vs NETHERLANDS | wc26-r32-076 | June 29, 2026 | 9:00 PM ET (01:00 UTC Jun 30)
 * 1,000,000 Bayesian Poisson + FIFA Elo Monte Carlo Simulations
 * Model Version: v7.2-R32 | Industry-Grade Logging Framework
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

// ── LOGGING FRAMEWORK ─────────────────────────────────────────────────────────
const LOG_FILE = '/home/ubuntu/june29_mar_ned_sim.log';
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
const FIXTURE_ID     = 'wc26-r32-076';
const HOME_TEAM_ID   = 'ned';
const AWAY_TEAM_ID   = 'mar';
const HOME_NAME      = 'Netherlands';
const AWAY_NAME      = 'Morocco';
const KICKOFF_UTC    = '2026-06-30T01:00:00Z'; // 9:00 PM ET = 01:00 UTC Jun 30
const MATCH_DATE     = '2026-06-29';
const VENUE_ID       = 'dallas'; // AT&T Stadium, Arlington TX
const ROUND          = 'R32';
const N_SIMS         = 1_000_000;

// ── BOOK ODDS (FROZEN — DraftKings) ──────────────────────────────────────────
const BOOK = {
  toAdvanceHome:  -155,  // Netherlands to advance
  toAdvanceAway:  +120,  // Morocco to advance
  homeML:         +130,  // Netherlands ML
  drawML:         +210,  // Draw
  awayML:         +250,  // Morocco ML
  noDrawAway:     -800,  // Morocco or Netherlands (No Draw)
  overOdds:       +120,  // Over 2.5
  underOdds:      -150,  // Under 2.5
  totalLine:       2.5,
  homeSpreadLine:  -1.5, // Netherlands -1.5
  homeSpreadOdds:  +400, // Netherlands -1.5 odds
  awaySpreadLine:  +1.5, // Morocco +1.5
  awaySpreadOdds:  -600, // Morocco +1.5 odds
  dc1X:           -105,  // Morocco or Draw
  dcX2:           -265,  // Netherlands or Draw
  bttsYes:        -145,  // BTTS YES
  bttsNo:         +110,  // BTTS NO
};

// ── FIFA ELO RATINGS (June 2026) ──────────────────────────────────────────────
// Netherlands: Strong European side, WC 2022 QF, ELO ~1920
// Morocco: WC 2022 semi-finalist, strong defensive unit, ELO ~1870
// This is a genuinely close match — Morocco is a legitimate threat
const ELO_HOME = 1920;  // Netherlands
const ELO_AWAY = 1870;  // Morocco
const ELO_DIFF = ELO_HOME - ELO_AWAY; // +50 — very close

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
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function computeEdge(bookML, modelML) {
  if (bookML == null || modelML == null) return { edge: 0, roiPct: 0, significant: false, direction: 'N/A' };
  const bookProb = americanToProb(bookML);
  const modelProb = americanToProb(modelML);
  const edge = modelProb - bookProb;
  const payout = bookML > 0 ? bookML / 100 : 100 / Math.abs(bookML);
  const roi = (modelProb * payout - (1 - modelProb)) * 100;
  const significant = Math.abs(edge) >= 0.04;
  const direction = edge > 0 ? 'MODEL_EDGE' : 'BOOK_EDGE';
  return { edge: edge.toFixed(4), roiPct: roi.toFixed(2), significant, direction };
}

// ── STEP 1: ELO-ADJUSTED LAMBDA COMPUTATION ───────────────────────────────────
logSep('STEP 1 — ELO-ADJUSTED LAMBDA COMPUTATION');
log('INPUT', 'MATCH', `${HOME_NAME} vs ${AWAY_NAME} | ${FIXTURE_ID} | 9:00 PM ET`);
log('INPUT', 'ELO', `Home=${HOME_NAME} ELO=${ELO_HOME} | Away=${AWAY_NAME} ELO=${ELO_AWAY} | Diff=${ELO_DIFF}`);

const ELO_FACTOR = 0.0025;
const eloAdj = ELO_DIFF * ELO_FACTOR;

// No-vig 3-way probs from book ML
const rawH = americanToProb(BOOK.homeML);
const rawD = americanToProb(BOOK.drawML);
const rawA = americanToProb(BOOK.awayML);
const { pH: nvH, pD: nvD, pA: nvA } = noVig3Way(rawH, rawD, rawA);

log('STATE', 'NO_VIG_3WAY', `rawH=${rawH.toFixed(6)} rawD=${rawD.toFixed(6)} rawA=${rawA.toFixed(6)} | nvH=${nvH.toFixed(6)} nvD=${nvD.toFixed(6)} nvA=${nvA.toFixed(6)}`);

// Morocco is a very defensive team — low-scoring match expected
// Netherlands: solid attack, Morocco: compact defense
const HOME_ATTACK_STRENGTH = 1.25;  // Netherlands attack
const AWAY_DEFENSE_STRENGTH = 1.05; // Morocco defense (strong)
const AWAY_ATTACK_STRENGTH = 0.95;  // Morocco attack (counter-attacking)
const HOME_DEFENSE_STRENGTH = 1.10; // Netherlands defense

const LEAGUE_AVG_HOME = 1.35;
const LEAGUE_AVG_AWAY = 0.95;

let lambdaHome = HOME_ATTACK_STRENGTH * AWAY_DEFENSE_STRENGTH * LEAGUE_AVG_HOME;
let lambdaAway = AWAY_ATTACK_STRENGTH * HOME_DEFENSE_STRENGTH * LEAGUE_AVG_AWAY;

lambdaHome += eloAdj * 0.55;
lambdaAway -= eloAdj * 0.45;
lambdaHome = Math.max(0.15, lambdaHome);
lambdaAway = Math.max(0.10, lambdaAway);

log('STATE', 'LAMBDA_INITIAL', `eloAdj=${eloAdj.toFixed(4)} | lambdaHome=${lambdaHome.toFixed(6)} lambdaAway=${lambdaAway.toFixed(6)} | projTotal=${(lambdaHome+lambdaAway).toFixed(4)}`);

// ── STEP 2: VALIDATE LAMBDAS ──────────────────────────────────────────────────
logSep('STEP 2 — LAMBDA VALIDATION AGAINST BOOK PROBS');

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

// Blend 60% Elo-Poisson + 40% book no-vig
const BLEND_MODEL = 0.60;
const BLEND_BOOK  = 0.40;
const blendH = BLEND_MODEL * pHomeWin + BLEND_BOOK * nvH;
const blendD = BLEND_MODEL * pDraw    + BLEND_BOOK * nvD;
const blendA = BLEND_MODEL * pAwayWin + BLEND_BOOK * nvA;
const blendTotal = blendH + blendD + blendA;
const finalH = blendH / blendTotal;
const finalD = blendD / blendTotal;
const finalA = blendA / blendTotal;

log('STATE', 'BLEND_PROBS', `finalH=${finalH.toFixed(6)} finalD=${finalD.toFixed(6)} finalA=${finalA.toFixed(6)} | sum=${(finalH+finalD+finalA).toFixed(8)}`);

const totalLambda = lambdaHome + lambdaAway;
lambdaHome = totalLambda * (finalH + 0.5 * finalD);
lambdaAway = totalLambda * (finalA + 0.5 * finalD);
lambdaHome = Math.max(0.15, lambdaHome);
lambdaAway = Math.max(0.10, lambdaAway);

log('STATE', 'LAMBDA_RECALIBRATED', `lambdaHome=${lambdaHome.toFixed(6)} lambdaAway=${lambdaAway.toFixed(6)} | projTotal=${(lambdaHome+lambdaAway).toFixed(4)}`);

// ── STEP 3: 1M MONTE CARLO SIMULATION ────────────────────────────────────────
logSep('STEP 3 — 1,000,000 MONTE CARLO SIMULATIONS');
log('INPUT', 'SIM_PARAMS', `N=${N_SIMS.toLocaleString()} | lambdaHome=${lambdaHome.toFixed(6)} lambdaAway=${lambdaAway.toFixed(6)}`);

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

let homeWins = 0, draws = 0, awayWins = 0;
let over25 = 0, under25 = 0;
let bttsYes = 0, bttsNo = 0;
let homeAdvances = 0, awayAdvances = 0;
let totalGoals = 0, homeTotalGoals = 0, awayTotalGoals = 0;
const scoreCounts = new Map();

let seed = 0xCAFEBABE ^ (Date.now() & 0xFFFFFFFF);
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
  } else if (hGoals === aGoals) {
    draws++;
    if (lcg() < 0.5) homeAdvances++;
    else awayAdvances++;
  } else {
    awayWins++;
    awayAdvances++;
  }

  if (total > 2.5) over25++;
  else under25++;

  if (hGoals >= 1 && aGoals >= 1) bttsYes++;
  else bttsNo++;

  const key = `${hGoals}-${aGoals}`;
  scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
}

// FIX v7.3: Correct spread recount — clean canonical formula
// Netherlands -1.5 covers: NED wins by 2 or more goals (h - a >= 2)
// Morocco +1.5 covers: MAR does NOT lose by 2+ (i.e., h - a <= 1)
// These are strict complements: awaySpreadCover = N_SIMS - homeSpreadCover
let homeSpreadCover = 0;
for (const [score, count] of scoreCounts) {
  const [h, a] = score.split('-').map(Number);
  if (h - a >= 2) homeSpreadCover += count;  // Netherlands covers -1.5
}
let awaySpreadCover = N_SIMS - homeSpreadCover;  // Morocco covers +1.5 (strict complement)

const SIM_END = Date.now();
const simMs = SIM_END - SIM_START;

log('STATE', 'SIM_COMPLETE', `sims=${N_SIMS.toLocaleString()} | elapsed=${simMs}ms | homeWins=${homeWins} draws=${draws} awayWins=${awayWins}`);
log('VERIFY', 'SIM_TOTAL_CHECK', `total=${homeWins+draws+awayWins} | expected=${N_SIMS} | PASS=${homeWins+draws+awayWins===N_SIMS}`);

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
const pDC1X    = (draws + awayWins) / N_SIMS;  // Morocco or Draw
const pDCX2    = (homeWins + draws) / N_SIMS;  // Netherlands or Draw

const projHomeScore = homeTotalGoals / N_SIMS;
const projAwayScore = awayTotalGoals / N_SIMS;
const projTotal = totalGoals / N_SIMS;
const projSpread = projHomeScore - projAwayScore;

log('OUTPUT', 'PROBS_3WAY', `pHW=${pHW.toFixed(6)} pD=${pD.toFixed(6)} pAW=${pAW.toFixed(6)} | sum=${(pHW+pD+pAW).toFixed(8)}`);
log('OUTPUT', 'PROBS_ADVANCE', `pHA=${pHA.toFixed(6)} pAA=${pAA.toFixed(6)} | sum=${(pHA+pAA).toFixed(8)}`);
log('OUTPUT', 'PROBS_TOTAL', `pOver25=${pOver25.toFixed(6)} pUnder25=${pUnder25.toFixed(6)}`);
log('OUTPUT', 'PROBS_BTTS', `pBttsY=${pBttsY.toFixed(6)} pBttsN=${pBttsN.toFixed(6)}`);
log('OUTPUT', 'PROBS_SPREAD', `pHomeSpr=${pHomeSpr.toFixed(6)} pAwaySpr=${pAwaySpr.toFixed(6)}`);
log('OUTPUT', 'PROJ_SCORE', `NED ${projHomeScore.toFixed(4)} - ${projAwayScore.toFixed(4)} MAR | total=${projTotal.toFixed(4)} spread=${projSpread.toFixed(4)}`);

// ── STEP 5: MODEL ODDS COMPUTATION ────────────────────────────────────────────
logSep('STEP 5 — MODEL ODDS COMPUTATION (NO-VIG FAIR ODDS)');

const nvModelH = pHW / (pHW + pD + pAW);
const nvModelD = pD  / (pHW + pD + pAW);
const nvModelA = pAW / (pHW + pD + pAW);

const modelHomeML  = probToAmerican(nvModelH);
const modelDrawML  = probToAmerican(nvModelD);
const modelAwayML  = probToAmerican(nvModelA);

// FIX v7.3 — Corrected market computations:
// ADVANCE: pHA and pAA already sum to 1.0 by construction (knockout format)
//   Do NOT apply noVig2Way — that inflates the underdog's advance probability.
// NO DRAW: probToAmerican(pNoDraw) where pNoDraw = pHW + pAW (unconditional)
//   WRONG: probToAmerican(pNoDraw / (pNoDraw + pD)) — normalizes against sub-1 denominator
// SPREAD: pHomeSpr + pAwaySpr = 1.0 (strict complements after fix above)

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

log('FIX', 'ADVANCE_FIX', `pHA=${pHA.toFixed(6)} pAA=${pAA.toFixed(6)} sum=${(pHA+pAA).toFixed(8)} | NED_ADV=${modelAdvHomeML} MAR_ADV=${modelAdvAwayML}`);
log('FIX', 'NODRAW_FIX', `pNoDraw=${pNoDraw.toFixed(6)} (=pHW+pAW) | modelNoDrawML=${modelNoDrawML}`);
log('FIX', 'SPREAD_FIX', `pHomeSpr=${pHomeSpr.toFixed(6)} pAwaySpr=${pAwaySpr.toFixed(6)} sum=${(pHomeSpr+pAwaySpr).toFixed(8)}`);

log('OUTPUT', 'MODEL_ML', `NED=${modelHomeML} Draw=${modelDrawML} MAR=${modelAwayML}`);
log('OUTPUT', 'MODEL_ADVANCE', `NED_ADV=${modelAdvHomeML} MAR_ADV=${modelAdvAwayML}`);
log('OUTPUT', 'MODEL_SPREAD', `NED-1.5=${modelHomeSprML} MAR+1.5=${modelAwaySprML}`);
log('OUTPUT', 'MODEL_TOTAL', `Over2.5=${modelOverML} Under2.5=${modelUnderML}`);
log('OUTPUT', 'MODEL_BTTS', `YES=${modelBttsYML} NO=${modelBttsNML}`);
log('OUTPUT', 'MODEL_DC', `DC1X(MAR_or_Draw)=${modelDC1XML} DCX2(NED_or_Draw)=${modelDCX2ML}`);
log('OUTPUT', 'MODEL_NODRAW', `NoDrawOdds=${modelNoDrawML}`);

// ── STEP 6: EDGE DETECTION ────────────────────────────────────────────────────
logSep('STEP 6 — EDGE DETECTION (BOOK vs MODEL)');

const edges = {
  ned_advance:  computeEdge(BOOK.toAdvanceHome, modelAdvHomeML),
  mar_advance:  computeEdge(BOOK.toAdvanceAway, modelAdvAwayML),
  ned_ml:       computeEdge(BOOK.homeML, modelHomeML),
  draw_ml:      computeEdge(BOOK.drawML, modelDrawML),
  mar_ml:       computeEdge(BOOK.awayML, modelAwayML),
  ned_spread:   computeEdge(BOOK.homeSpreadOdds, modelHomeSprML),
  mar_spread:   computeEdge(BOOK.awaySpreadOdds, modelAwaySprML),
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

topScorelines.forEach(s => log('OUTPUT', 'SCORELINE', `NED ${s.score} MAR | ${s.pct}% (${s.count.toLocaleString()} sims)`));

// ── STEP 8: INVARIANT VALIDATION ─────────────────────────────────────────────
logSep('STEP 8 — INVARIANT VALIDATION');

const invariants = [
  ['3WAY_SUM_APPROX_1',    Math.abs(pHW + pD + pAW - 1) < 0.0001,       `${(pHW+pD+pAW).toFixed(8)}`],
  ['ADVANCE_SUM_APPROX_1', Math.abs(pHA + pAA - 1) < 0.0001,            `${(pHA+pAA).toFixed(8)}`],
  ['TOTAL_SUM_APPROX_1',   Math.abs(pOver25 + pUnder25 - 1) < 0.0001,   `${(pOver25+pUnder25).toFixed(8)}`],
  ['BTTS_SUM_APPROX_1',    Math.abs(pBttsY + pBttsN - 1) < 0.0001,      `${(pBttsY+pBttsN).toFixed(8)}`],
  ['LAMBDA_HOME_POSITIVE', lambdaHome > 0,                               `lambdaHome=${lambdaHome.toFixed(6)}`],
  ['LAMBDA_AWAY_POSITIVE', lambdaAway > 0,                               `lambdaAway=${lambdaAway.toFixed(6)}`],
  ['SIM_COUNT_EXACT',      homeWins + draws + awayWins === N_SIMS,       `${homeWins+draws+awayWins}`],
  ['CLOSE_MATCH_EXPECTED', Math.abs(pHW - pAW) < 0.25,                  `|pHW-pAW|=${Math.abs(pHW-pAW).toFixed(4)}`],
];

let allPass = true;
for (const [name, pass, detail] of invariants) {
  log(pass ? 'VERIFY' : 'ERROR', `INVARIANT_${name}`, `${pass ? 'PASS' : 'FAIL'} | ${detail}`);
  if (!pass) allPass = false;
}
log(allPass ? 'VERIFY' : 'ERROR', 'INVARIANTS_SUMMARY', `${allPass ? 'ALL PASS' : 'FAILURES DETECTED'} | ${invariants.length} checks`);

// ── STEP 9: SEED FIXTURE + BOOK ODDS TO DB ────────────────────────────────────
logSep('STEP 9 — SEED FIXTURE + FROZEN BOOK ODDS TO DB');

let conn;
try {
  conn = await mysql.createConnection(process.env.DATABASE_URL);
  log('STEP', 'DB_CONNECT', 'MySQL connection established');

  await conn.execute(`
    INSERT INTO wc2026_fixtures
      (fixture_id, match_date, kickoff_utc, stage, home_team_id, away_team_id, venue_id, status, display_order)
    VALUES (?, ?, ?, 'R32', ?, ?, ?, 'scheduled', 76)
    ON DUPLICATE KEY UPDATE
      match_date=VALUES(match_date), kickoff_utc=VALUES(kickoff_utc),
      home_team_id=VALUES(home_team_id), away_team_id=VALUES(away_team_id)
  `, [FIXTURE_ID, MATCH_DATE, KICKOFF_UTC, HOME_TEAM_ID, AWAY_TEAM_ID, VENUE_ID]);
  log('VERIFY', 'DB_FIXTURE_UPSERT', `PASS | fixture_id=${FIXTURE_ID} home=${HOME_TEAM_ID} away=${AWAY_TEAM_ID}`);

  await conn.execute(`
    INSERT INTO wc2026_frozen_book_odds
      (fixture_id, book_home_ml, book_draw_ml, book_away_ml,
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
    FIXTURE_ID,
    BOOK.homeML, BOOK.drawML, BOOK.awayML,
    BOOK.homeSpreadLine, BOOK.homeSpreadOdds, BOOK.awaySpreadOdds,
    BOOK.totalLine, BOOK.overOdds, BOOK.underOdds,
    BOOK.bttsYes, BOOK.bttsNo,
    BOOK.dc1X, BOOK.dcX2,
    BOOK.noDrawAway,
    BOOK.toAdvanceHome, BOOK.toAdvanceAway,
  ]);
  log('VERIFY', 'DB_BOOK_ODDS_UPSERT', `PASS | fixture_id=${FIXTURE_ID} | homeML=${BOOK.homeML} drawML=${BOOK.drawML} awayML=${BOOK.awayML}`);

  const [verRows] = await conn.execute(
    'SELECT fixture_id, book_home_ml, book_draw_ml, book_away_ml, book_no_draw_away_odds, to_advance_home_odds, to_advance_away_odds FROM wc2026_frozen_book_odds WHERE fixture_id=?',
    [FIXTURE_ID]
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
  fixture_id: FIXTURE_ID,
  home: HOME_NAME, away: AWAY_NAME,
  kickoff_et: '9:00 PM ET', kickoff_utc: KICKOFF_UTC,
  n_sims: N_SIMS,
  elo_home: ELO_HOME, elo_away: ELO_AWAY, elo_diff: ELO_DIFF,
  home_lam: lambdaHome.toFixed(6), away_lam: lambdaAway.toFixed(6),
  home_win_prob: pHW.toFixed(6), draw_prob: pD.toFixed(6), away_win_prob: pAW.toFixed(6),
  p_home_advances: pHA.toFixed(6), p_away_advances: pAA.toFixed(6),
  p_over_25: pOver25.toFixed(6), p_under_25: pUnder25.toFixed(6),
  btts_prob: pBttsY.toFixed(6),
  p_home_spread: pHomeSpr.toFixed(6), p_away_spread: pAwaySpr.toFixed(6),
  p_no_draw: pNoDraw.toFixed(6),
  p_dc_1x: pDC1X.toFixed(6), p_dc_x2: pDCX2.toFixed(6),
  proj_home_score: projHomeScore.toFixed(4),
  proj_away_score: projAwayScore.toFixed(4),
  proj_total: projTotal.toFixed(4),
  proj_spread: projSpread.toFixed(4),
  mode_score: topScorelines[0]?.score ?? 'N/A',
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
  book: BOOK,
  edges,
  top_scorelines: topScorelines,
  model_version: 'v7.2-R32',
  generated_at: new Date().toISOString(),
  elapsed_ms: Date.now() - startTs,
};

const JSON_FILE = '/home/ubuntu/june29_mar_ned_results.json';
fs.writeFileSync(JSON_FILE, JSON.stringify(results, null, 2));
log('VERIFY', 'JSON_WRITE', `PASS | file=${JSON_FILE} | size=${fs.statSync(JSON_FILE).size} bytes`);

// ── FINAL SUMMARY ─────────────────────────────────────────────────────────────
logSep('FINAL SUMMARY — MOROCCO vs NETHERLANDS');
log('OUTPUT', 'FINAL_SCORE_PROJ', `NED ${projHomeScore.toFixed(2)} - ${projAwayScore.toFixed(2)} MAR | Total=${projTotal.toFixed(2)} | Spread=${projSpread.toFixed(2)}`);
log('OUTPUT', 'FINAL_PROBS', `NED Win=${(pHW*100).toFixed(2)}% Draw=${(pD*100).toFixed(2)}% MAR Win=${(pAW*100).toFixed(2)}%`);
log('OUTPUT', 'FINAL_ADVANCE', `NED Advances=${(pHA*100).toFixed(2)}% MAR Advances=${(pAA*100).toFixed(2)}%`);
log('OUTPUT', 'FINAL_MODEL_ML', `NED ML=${modelHomeML} Draw=${modelDrawML} MAR ML=${modelAwayML}`);
log('OUTPUT', 'FINAL_ADVANCE_ML', `NED ADV=${modelAdvHomeML} MAR ADV=${modelAdvAwayML}`);
log('OUTPUT', 'FINAL_ELAPSED', `Total elapsed=${elapsed()} | sims=${N_SIMS.toLocaleString()} | simSpeed=${(N_SIMS/simMs*1000).toFixed(0)} sims/sec`);

const sigEdges = Object.entries(edges).filter(([,e]) => e.significant && e.direction === 'MODEL_EDGE');
if (sigEdges.length > 0) {
  log('OUTPUT', 'SIGNIFICANT_EDGES', `${sigEdges.length} model edges found:`);
  sigEdges.forEach(([k,e]) => log('OUTPUT', `EDGE_${k.toUpperCase()}`, `edge=${e.edge} ROI=${e.roiPct}%`));
} else {
  log('OUTPUT', 'SIGNIFICANT_EDGES', 'None above 4pp threshold');
}

log('VERIFY', 'PIPELINE_COMPLETE', `ALL STEPS COMPLETE | fixture=${FIXTURE_ID} | allInvariantsPass=${allPass}`);
flushLog();
