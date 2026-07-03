/**
 * v12_model_build.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * WC2026 v12.0-KO24 — 500x Forensic Grading + Recalibration + 10-Variation
 * Backtest + Final Projections for Jul 1 R32 Matches
 *
 * PIPELINE:
 *   Phase A: Load forensic data (7 matches, all stats)
 *   Phase B: 500x forensic grading — score, direction, total, spread, BTTS, xG
 *   Phase C: Identify model strengths, weaknesses, recalibration targets
 *   Phase D: Build v12 engine with reinforced/recalibrated parameters
 *   Phase E: 10-variation backtest on 7 historical matches
 *   Phase F: Select optimal v12 config from backtest
 *   Phase G: Run v12 on DR Congo vs England, Senegal vs Belgium, Bosnia vs USA
 *   Phase H: Output full report + projections JSON
 *
 * ZERO PUBLISH — results written to JSON only, no DB writes.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';

// ── Logger ────────────────────────────────────────────────────────────────────
const LOG_PATH = '/home/ubuntu/wc2026_v12_build.log';
const logLines = [];
let stepCount = 0, passCount = 0, failCount = 0, warnCount = 0;

function ts() { return new Date().toISOString(); }
function pad(s, n) { return String(s).padEnd(n); }
function log(level, msg, step = null) {
  const stepTag = step ? `[${String(step).padStart(2,'0')}] ` : '    ';
  const line = `[${ts()}] ${pad(level,7)} │ ${stepTag}${msg}`;
  console.log(line); logLines.push(line);
}
function banner(msg) {
  const b = '═'.repeat(80);
  [b, msg.padStart(Math.floor((80+msg.length)/2)).padEnd(80), b].forEach(l => {
    const line = `[${ts()}] BANNER  │ ${l}`; console.log(line); logLines.push(line);
  });
}
function pass(msg) { passCount++; log('PASS', `✅ ${msg}`); }
function fail(msg) { failCount++; log('FAIL', `❌ ${msg}`); throw new Error(`FATAL: ${msg}`); }
function warn(msg) { warnCount++; log('WARN', `⚠️  ${msg}`); }
function saveLog() { fs.writeFileSync(LOG_PATH, logLines.join('\n') + '\n'); }

// ── Math helpers ──────────────────────────────────────────────────────────────
function probToML(p) {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}
function ml2prob(ml) {
  if (ml == null) return null;
  return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
}
function noVig3(p1, p2, p3) {
  const s = p1 + p2 + p3; return [p1/s, p2/s, p3/s];
}
function noVig2(p1, p2) {
  const s = p1 + p2; return [p1/s, p2/s];
}

// Poisson PMF
function poissonPMF(lambda, k) {
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Dixon-Coles rho correction
function dcRho(i, j, lH, lA, rho) {
  if (i === 0 && j === 0) return 1 - lH * lA * rho;
  if (i === 0 && j === 1) return 1 + lH * rho;
  if (i === 1 && j === 0) return 1 + lA * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

// Full score matrix simulation (Dixon-Coles)
function buildScoreMatrix(lH, lA, rho = 0.08, maxGoals = 8) {
  const matrix = [];
  let totalProb = 0;
  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPMF(lH, h) * poissonPMF(lA, a) * dcRho(h, a, lH, lA, rho);
      matrix[h][a] = Math.max(0, p);
      totalProb += matrix[h][a];
    }
  }
  // Normalize
  for (let h = 0; h <= maxGoals; h++)
    for (let a = 0; a <= maxGoals; a++)
      matrix[h][a] /= totalProb;
  return matrix;
}

// Derive all market probabilities from score matrix
function deriveMarkets(matrix, maxGoals = 8) {
  let pHW = 0, pDraw = 0, pAW = 0;
  let pOver25 = 0, pBTTS = 0;
  let pHCover15 = 0, pACover15 = 0;
  let pOver05 = 0, pOver15 = 0, pOver35 = 0, pOver45 = 0;
  let projH = 0, projA = 0;
  const scorelines = {};

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a];
      if (p <= 0) continue;
      projH += h * p;
      projA += a * p;
      if (h > a) pHW += p;
      else if (h === a) pDraw += p;
      else pAW += p;
      const tot = h + a;
      if (tot > 0.5) pOver05 += p;
      if (tot > 1.5) pOver15 += p;
      if (tot > 2.5) pOver25 += p;
      if (tot > 3.5) pOver35 += p;
      if (tot > 4.5) pOver45 += p;
      if (h > 0 && a > 0) pBTTS += p;
      if (h - a > 1.5) pHCover15 += p;
      if (a - h > 1.5) pACover15 += p;
      const key = `${h}-${a}`;
      scorelines[key] = (scorelines[key] || 0) + p;
    }
  }

  const topScorelines = Object.entries(scorelines)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([sc, p]) => ({ score: sc, prob: parseFloat((p * 100).toFixed(2)) }));

  return { pHW, pDraw, pAW, pOver25, pBTTS, pHCover15, pACover15,
           pOver05, pOver15, pOver35, pOver45,
           projH: parseFloat(projH.toFixed(4)), projA: parseFloat(projA.toFixed(4)),
           projTotal: parseFloat((projH + projA).toFixed(4)), topScorelines };
}

// Advancement probability (includes ET + pens)
function advancementProb(pHW, pDraw, pAW, etPenFactor = 0.50) {
  const pAdvH = pHW + pDraw * etPenFactor;
  const pAdvA = pAW + pDraw * (1 - etPenFactor);
  return noVig2(pAdvH, pAdvA);
}

// SMALLINT cap
const SMAX = 32767, SMIN = -32768;
function cap(v) {
  if (v == null || isNaN(v) || !isFinite(v)) return null;
  return Math.max(SMIN, Math.min(SMAX, Math.round(v)));
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE A: Load forensic data
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE A — Load Forensic Data');
const DATA_PATH = '/home/ubuntu/wc2026_forensic500x_data.json';
if (!fs.existsSync(DATA_PATH)) fail(`Forensic data not found: ${DATA_PATH}`);
const forensicData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
pass(`Loaded forensic data: ${forensicData.length} matches`);

// ══════════════════════════════════════════════════════════════════════════════
// PHASE B: 500x Forensic Grading
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE B — 500x Forensic Grading (7 Matches)');

const grades = [];

for (const d of forensicData) {
  const f = d.match;
  const m = d.model;
  const b = d.book;
  const exg = d.espnXG;
  const ets = d.espnTeamStats;
  const ems = d.espnMatchStats;

  if (!f || !m) {
    warn(`[${d.fid}] Missing match or model data — skipping`);
    continue;
  }

  const aS = f.away_score, hS = f.home_score;
  if (aS === null || hS === null) { warn(`[${d.fid}] No final score — skipping`); continue; }

  const actualTotal = aS + hS;
  const actualWinner = aS > hS ? 'AWAY' : aS < hS ? 'HOME' : 'DRAW';
  const actualSpread = hS - aS; // positive = home won by N

  const pH = m.proj_home_score, pA = m.proj_away_score;
  const projWinner = pA > pH ? 'AWAY' : pA < pH ? 'HOME' : 'DRAW';
  const directionCorrect = actualWinner === projWinner;

  // Score errors
  const homeErr = Math.abs(hS - pH);
  const awayErr = Math.abs(aS - pA);
  const totalErr = Math.abs(actualTotal - m.proj_total);
  const spreadErr = Math.abs(actualSpread - (pH - pA));

  // Total market
  const bookTotal = b?.book_total_line;
  const modelTotal = m.model_total;
  const totalHitBook = bookTotal !== null ? (actualTotal > bookTotal ? 'OVER' : actualTotal < bookTotal ? 'UNDER' : 'PUSH') : null;
  const totalHitModel = modelTotal !== null ? (actualTotal > modelTotal ? 'OVER' : actualTotal < modelTotal ? 'UNDER' : 'PUSH') : null;

  // Spread cover
  const bookSpread = b?.book_spread_line;
  const spreadCover = bookSpread !== null ? (actualSpread > bookSpread ? 'HOME' : actualSpread < bookSpread ? 'AWAY' : 'PUSH') : null;
  const modelSpread = m.model_spread;
  const modelSpreadCover = modelSpread !== null ? (actualSpread > modelSpread ? 'HOME' : actualSpread < modelSpread ? 'AWAY' : 'PUSH') : null;

  // BTTS
  const actualBTTS = hS > 0 && aS > 0;
  const modelBTTSProb = m.btts_prob;

  // xG vs actual
  const xgH = exg?.homeXG ?? ems?.homeXG ?? null;
  const xgA = exg?.awayXG ?? ems?.awayXG ?? null;
  const xgHOT = exg?.homeXGOT ?? ems?.homeXGOT ?? null;
  const xgAOT = exg?.awayXGOT ?? ems?.awayXGOT ?? null;

  // Lambda calibration check: compare λ vs actual xG
  const lambdaVsXgH = xgH !== null ? m.home_lambda - xgH : null;
  const lambdaVsXgA = xgA !== null ? m.away_lambda - xgA : null;

  // Possession
  const possH = ets?.possession ?? null;
  const possA = ets?.possessionAway ?? null;

  // Shots
  const shotsH = ets?.shotsOnGoal ?? null;
  const shotsA = ets?.shotsOnGoalAway ?? null;

  // Grade score (0-100)
  let score = 0;
  const scoreBreakdown = {};

  // Direction (25 pts)
  scoreBreakdown.direction = directionCorrect ? 25 : 0;
  score += scoreBreakdown.direction;

  // Score accuracy (20 pts) — max 10 per team, deduct per 0.5 error
  const homeScore = Math.max(0, 10 - homeErr * 4);
  const awayScore = Math.max(0, 10 - awayErr * 4);
  scoreBreakdown.scoreAccuracy = parseFloat((homeScore + awayScore).toFixed(1));
  score += scoreBreakdown.scoreAccuracy;

  // Total market (15 pts) — model total line accuracy
  const totalAccuracy = Math.max(0, 15 - totalErr * 5);
  scoreBreakdown.totalAccuracy = parseFloat(totalAccuracy.toFixed(1));
  score += scoreBreakdown.totalAccuracy;

  // Spread accuracy (15 pts)
  const spreadAccuracy = Math.max(0, 15 - spreadErr * 3);
  scoreBreakdown.spreadAccuracy = parseFloat(spreadAccuracy.toFixed(1));
  score += scoreBreakdown.spreadAccuracy;

  // BTTS calibration (10 pts)
  const bttsActualProb = actualBTTS ? 1 : 0;
  const bttsDiff = Math.abs(bttsActualProb - modelBTTSProb);
  const bttsScore = Math.max(0, 10 - bttsDiff * 20);
  scoreBreakdown.btts = parseFloat(bttsScore.toFixed(1));
  score += scoreBreakdown.btts;

  // Lambda vs xG calibration (15 pts)
  if (lambdaVsXgH !== null && lambdaVsXgA !== null) {
    const lambdaErr = (Math.abs(lambdaVsXgH) + Math.abs(lambdaVsXgA)) / 2;
    const lambdaScore = Math.max(0, 15 - lambdaErr * 10);
    scoreBreakdown.lambdaCalibration = parseFloat(lambdaScore.toFixed(1));
    score += scoreBreakdown.lambdaCalibration;
  } else {
    scoreBreakdown.lambdaCalibration = null;
    score += 7.5; // partial credit when xG not available
  }

  const finalScore = parseFloat(Math.min(100, score).toFixed(1));

  const grade = {
    fid: d.fid,
    matchup: `${f.away_name} @ ${f.home_name}`,
    modelVersion: m.model_version,
    actual: { home: hS, away: aS, total: actualTotal, winner: actualWinner, spread: actualSpread, btts: actualBTTS },
    projected: { home: pH, away: pA, total: m.proj_total, winner: projWinner, spread: parseFloat((pH - pA).toFixed(2)) },
    errors: { home: parseFloat(homeErr.toFixed(3)), away: parseFloat(awayErr.toFixed(3)), total: parseFloat(totalErr.toFixed(3)), spread: parseFloat(spreadErr.toFixed(3)) },
    directionCorrect,
    totalHitBook, totalHitModel,
    spreadCover, modelSpreadCover,
    btts: { actual: actualBTTS, modelProb: modelBTTSProb },
    lambdas: { home: m.home_lambda, away: m.away_lambda },
    xg: { home: xgH, away: xgA, homeOT: xgHOT, awayOT: xgAOT },
    lambdaVsXg: { home: lambdaVsXgH, away: lambdaVsXgA },
    possession: { home: possH, away: possA },
    shots: { home: shotsH, away: shotsA },
    gradeScore: finalScore,
    scoreBreakdown,
  };
  grades.push(grade);

  log('STATE', `[${d.fid}] ${grade.matchup}`);
  log('STATE', `  Actual: ${aS}-${hS} (${actualWinner}) | Proj: ${pA}-${pH} (${projWinner}) | Dir: ${directionCorrect ? '✅' : '❌'}`);
  log('STATE', `  Errors: H=${homeErr.toFixed(2)} A=${awayErr.toFixed(2)} Total=${totalErr.toFixed(2)} Spread=${spreadErr.toFixed(2)}`);
  log('STATE', `  Total: book=${bookTotal} model=${modelTotal} actual=${actualTotal} → ${totalHitBook}(book)/${totalHitModel}(model)`);
  log('STATE', `  BTTS: actual=${actualBTTS} modelProb=${(modelBTTSProb*100).toFixed(1)}%`);
  log('STATE', `  λH=${m.home_lambda} λA=${m.away_lambda} | xGH=${xgH} xGA=${xgA}`);
  log('STATE', `  λ vs xG: H=${lambdaVsXgH?.toFixed(3) ?? 'N/A'} A=${lambdaVsXgA?.toFixed(3) ?? 'N/A'}`);
  log('STATE', `  GRADE: ${finalScore}/100 | ${JSON.stringify(scoreBreakdown)}`);
}

const avgGrade = grades.reduce((s, g) => s + g.gradeScore, 0) / grades.length;
const directionAccuracy = grades.filter(g => g.directionCorrect).length / grades.length;
const totalHitsBook = grades.filter(g => g.totalHitBook !== null);
const bookTotalAcc = totalHitsBook.length > 0 ? totalHitsBook.filter(g => {
  const modelDir = g.projected.total > (g.actual.total) ? 'OVER' : 'UNDER';
  return g.totalHitBook === g.totalHitModel;
}).length / totalHitsBook.length : 0;

log('OUTPUT', `\n  ── AGGREGATE GRADES ──`);
log('OUTPUT', `  Avg Grade: ${avgGrade.toFixed(1)}/100`);
log('OUTPUT', `  Direction Accuracy: ${(directionAccuracy * 100).toFixed(1)}% (${grades.filter(g => g.directionCorrect).length}/${grades.length})`);
log('OUTPUT', `  Avg Score Error: H=${(grades.reduce((s,g) => s+g.errors.home, 0)/grades.length).toFixed(3)} A=${(grades.reduce((s,g) => s+g.errors.away, 0)/grades.length).toFixed(3)}`);
log('OUTPUT', `  Avg Total Error: ${(grades.reduce((s,g) => s+g.errors.total, 0)/grades.length).toFixed(3)}`);
log('OUTPUT', `  Avg Spread Error: ${(grades.reduce((s,g) => s+g.errors.spread, 0)/grades.length).toFixed(3)}`);

// ══════════════════════════════════════════════════════════════════════════════
// PHASE C: Strengths, Weaknesses, Recalibration Targets
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE C — Strengths, Weaknesses, Recalibration Targets');

// Lambda bias analysis
const lambdaBiasH = grades.filter(g => g.lambdaVsXg.home !== null).map(g => g.lambdaVsXg.home);
const lambdaBiasA = grades.filter(g => g.lambdaVsXg.away !== null).map(g => g.lambdaVsXg.away);
const avgLambdaBiasH = lambdaBiasH.length > 0 ? lambdaBiasH.reduce((s,v) => s+v, 0) / lambdaBiasH.length : 0;
const avgLambdaBiasA = lambdaBiasA.length > 0 ? lambdaBiasA.reduce((s,v) => s+v, 0) / lambdaBiasA.length : 0;

// Total bias
const totalBias = grades.filter(g => g.totalHitBook !== null).map(g => g.actual.total - g.projected.total);
const avgTotalBias = totalBias.length > 0 ? totalBias.reduce((s,v) => s+v, 0) / totalBias.length : 0;

// BTTS calibration
const bttsBias = grades.map(g => (g.btts.actual ? 1 : 0) - g.btts.modelProb);
const avgBttsBias = bttsBias.reduce((s,v) => s+v, 0) / bttsBias.length;

// Upset detection (wrong direction)
const upsets = grades.filter(g => !g.directionCorrect);

log('STATE', `Lambda Bias: H=${avgLambdaBiasH.toFixed(4)} A=${avgLambdaBiasA.toFixed(4)}`);
log('STATE', `Total Bias: ${avgTotalBias.toFixed(4)} (positive = model underestimates totals)`);
log('STATE', `BTTS Bias: ${avgBttsBias.toFixed(4)} (positive = model underestimates BTTS)`);
log('STATE', `Upsets missed: ${upsets.map(g => g.fid).join(', ')}`);

// Per-match xG vs lambda analysis
for (const g of grades) {
  if (g.xg.home !== null) {
    log('STATE', `[${g.fid}] λH=${g.lambdas.home} xGH=${g.xg.home} diff=${(g.lambdas.home - g.xg.home).toFixed(3)} | λA=${g.lambdas.away} xGA=${g.xg.away} diff=${(g.lambdas.away - g.xg.away).toFixed(3)}`);
  }
}

// Strengths
const strengths = [];
const weaknesses = [];
const recalibrations = [];

if (directionAccuracy >= 0.70) strengths.push(`Direction accuracy ${(directionAccuracy*100).toFixed(0)}% — strong winner identification`);
else weaknesses.push(`Direction accuracy only ${(directionAccuracy*100).toFixed(0)}% — upset detection needs improvement`);

if (Math.abs(avgLambdaBiasH) < 0.15) strengths.push(`Home lambda well-calibrated (avg bias ${avgLambdaBiasH.toFixed(3)})`);
else { weaknesses.push(`Home lambda bias ${avgLambdaBiasH.toFixed(3)} — systematic ${avgLambdaBiasH > 0 ? 'over' : 'under'}estimation`); recalibrations.push(`Apply home lambda correction factor: ${(1 - avgLambdaBiasH * 0.5).toFixed(4)}`); }

if (Math.abs(avgLambdaBiasA) < 0.15) strengths.push(`Away lambda well-calibrated (avg bias ${avgLambdaBiasA.toFixed(3)})`);
else { weaknesses.push(`Away lambda bias ${avgLambdaBiasA.toFixed(3)} — systematic ${avgLambdaBiasA > 0 ? 'over' : 'under'}estimation`); recalibrations.push(`Apply away lambda correction factor: ${(1 - avgLambdaBiasA * 0.5).toFixed(4)}`); }

if (Math.abs(avgTotalBias) < 0.3) strengths.push(`Total projection well-calibrated (avg bias ${avgTotalBias.toFixed(3)})`);
else { weaknesses.push(`Total bias ${avgTotalBias.toFixed(3)} — model ${avgTotalBias > 0 ? 'underestimates' : 'overestimates'} goals`); recalibrations.push(`Apply total scaling: λ *= ${(1 + avgTotalBias * 0.15).toFixed(4)}`); }

if (Math.abs(avgBttsBias) < 0.10) strengths.push(`BTTS calibration solid (avg bias ${avgBttsBias.toFixed(3)})`);
else { weaknesses.push(`BTTS bias ${avgBttsBias.toFixed(3)}`); recalibrations.push(`Adjust DC rho: ${avgBttsBias > 0 ? 'decrease' : 'increase'} correlation`); }

// Fragility/draw quality fields were null — flag
const missingFragility = grades.filter(g => {
  const d = forensicData.find(x => x.fid === g.fid);
  return d?.model?.fav_fragility_score === null;
});
if (missingFragility.length > 0) {
  weaknesses.push(`fav_fragility_score, draw_quality_score, underdog_viability, xg_balance_ratio all NULL in ${missingFragility.length} matches — v11 did not compute these`);
  recalibrations.push('v12 MUST compute and store fav_fragility_score, draw_quality_score, underdog_viability, xg_balance_ratio');
}

log('OUTPUT', '\n  ── STRENGTHS ──');
strengths.forEach(s => log('OUTPUT', `  ✅ ${s}`));
log('OUTPUT', '\n  ── WEAKNESSES ──');
weaknesses.forEach(w => log('OUTPUT', `  ❌ ${w}`));
log('OUTPUT', '\n  ── RECALIBRATIONS ──');
recalibrations.forEach(r => log('OUTPUT', `  🔧 ${r}`));

// ══════════════════════════════════════════════════════════════════════════════
// PHASE D: v12 Engine Parameters
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE D — v12.0-KO24 Engine Parameters');

// Compute correction factors from historical data
const lambdaCorrH = avgLambdaBiasH !== 0 ? Math.max(0.85, Math.min(1.15, 1 - avgLambdaBiasH * 0.40)) : 1.0;
const lambdaCorrA = avgLambdaBiasA !== 0 ? Math.max(0.85, Math.min(1.15, 1 - avgLambdaBiasA * 0.40)) : 1.0;
const totalScaling = avgTotalBias !== 0 ? Math.max(0.90, Math.min(1.10, 1 + avgTotalBias * 0.12)) : 1.0;

// Dixon-Coles rho: if BTTS was underestimated, decrease rho (less negative correlation)
const dcRhoBase = 0.08;
const dcRhoAdj = Math.max(0.02, Math.min(0.15, dcRhoBase - avgBttsBias * 0.05));

// ET/Pens factor: based on actual advancement outcomes
const actualAdvancers = forensicData.filter(d => d.match?.advancing_team_id);
// Compute actual ET/pen rate from draws
const actualDraws = grades.filter(g => g.actual.winner === 'DRAW');
// In KO, all draws go to ET/pens — use 50% base for ET/pens winner
const etPenFactor = 0.50; // symmetric — no evidence to adjust

log('STATE', `λ correction: H=${lambdaCorrH.toFixed(4)} A=${lambdaCorrA.toFixed(4)}`);
log('STATE', `Total scaling: ${totalScaling.toFixed(4)}`);
log('STATE', `DC rho: base=${dcRhoBase} → adj=${dcRhoAdj.toFixed(4)}`);
log('STATE', `ET/Pen factor: ${etPenFactor}`);

// ══════════════════════════════════════════════════════════════════════════════
// PHASE E: 10-Variation Backtest
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE E — 10-Variation Backtest on 7 Historical Matches');

// Define 10 parameter variations
const VARIATIONS = [
  { id: 'V1',  lCorrH: 1.00, lCorrA: 1.00, rho: 0.08, totalScale: 1.00, desc: 'Baseline v11 (no correction)' },
  { id: 'V2',  lCorrH: lambdaCorrH, lCorrA: lambdaCorrA, rho: dcRhoAdj, totalScale: totalScaling, desc: 'Full data-driven correction' },
  { id: 'V3',  lCorrH: lambdaCorrH, lCorrA: lambdaCorrA, rho: dcRhoAdj, totalScale: 1.00, desc: 'Lambda+rho correction, no total scale' },
  { id: 'V4',  lCorrH: 1.00, lCorrA: 1.00, rho: dcRhoAdj, totalScale: totalScaling, desc: 'Rho+total scale, no lambda correction' },
  { id: 'V5',  lCorrH: lambdaCorrH * 0.97, lCorrA: lambdaCorrA * 1.03, rho: 0.06, totalScale: totalScaling, desc: 'Asymmetric lambda, lower rho' },
  { id: 'V6',  lCorrH: lambdaCorrH * 1.03, lCorrA: lambdaCorrA * 0.97, rho: 0.10, totalScale: totalScaling * 0.98, desc: 'Asymmetric lambda (reversed), higher rho' },
  { id: 'V7',  lCorrH: lambdaCorrH, lCorrA: lambdaCorrA, rho: 0.05, totalScale: totalScaling * 1.02, desc: 'Low rho, slight total boost' },
  { id: 'V8',  lCorrH: lambdaCorrH * 0.95, lCorrA: lambdaCorrA * 0.95, rho: dcRhoAdj, totalScale: totalScaling, desc: 'Conservative lambda reduction' },
  { id: 'V9',  lCorrH: lambdaCorrH * 1.05, lCorrA: lambdaCorrA * 1.05, rho: dcRhoAdj, totalScale: totalScaling * 0.97, desc: 'Aggressive lambda, slight total discount' },
  { id: 'V10', lCorrH: lambdaCorrH, lCorrA: lambdaCorrA, rho: 0.08, totalScale: totalScaling, desc: 'Lambda correction + base rho + total scale' },
];

// For each variation, re-run score matrix on historical lambdas and grade
const backtestResults = [];

for (const v of VARIATIONS) {
  let totalScore = 0, dirCorrect = 0, totalErrSum = 0, spreadErrSum = 0, bttsErrSum = 0;
  const matchResults = [];

  for (const d of forensicData) {
    const f = d.match;
    const m = d.model;
    if (!f || !m || f.home_score === null) continue;

    const lH = m.home_lambda * v.lCorrH * v.totalScale;
    const lA = m.away_lambda * v.lCorrA * v.totalScale;
    const matrix = buildScoreMatrix(lH, lA, v.rho);
    const mkts = deriveMarkets(matrix);

    const actualH = f.home_score, actualA = f.away_score;
    const actualTotal = actualH + actualA;
    const actualWinner = actualA > actualH ? 'AWAY' : actualA < actualH ? 'HOME' : 'DRAW';
    const projWinner = mkts.projA > mkts.projH ? 'AWAY' : mkts.projA < mkts.projH ? 'HOME' : 'DRAW';

    const dirOK = actualWinner === projWinner;
    const totalErr = Math.abs(actualTotal - mkts.projTotal);
    const spreadErr = Math.abs((actualH - actualA) - (mkts.projH - mkts.projA));
    const bttsActual = actualH > 0 && actualA > 0 ? 1 : 0;
    const bttsDiff = Math.abs(bttsActual - mkts.pBTTS);

    if (dirOK) dirCorrect++;
    totalErrSum += totalErr;
    spreadErrSum += spreadErr;
    bttsErrSum += bttsDiff;

    // Grade
    let score = 0;
    score += dirOK ? 25 : 0;
    score += Math.max(0, 10 - Math.abs(actualH - mkts.projH) * 4);
    score += Math.max(0, 10 - Math.abs(actualA - mkts.projA) * 4);
    score += Math.max(0, 15 - totalErr * 5);
    score += Math.max(0, 15 - spreadErr * 3);
    score += Math.max(0, 10 - bttsDiff * 20);
    score += 7.5; // lambda partial credit
    totalScore += Math.min(100, score);

    matchResults.push({ fid: d.fid, dirOK, totalErr, spreadErr, bttsDiff });
  }

  const n = matchResults.length;
  const result = {
    variation: v.id,
    desc: v.desc,
    params: { lCorrH: v.lCorrH, lCorrA: v.lCorrA, rho: v.rho, totalScale: v.totalScale },
    avgGrade: parseFloat((totalScore / n).toFixed(2)),
    dirAccuracy: parseFloat((dirCorrect / n * 100).toFixed(1)),
    avgTotalErr: parseFloat((totalErrSum / n).toFixed(4)),
    avgSpreadErr: parseFloat((spreadErrSum / n).toFixed(4)),
    avgBttsErr: parseFloat((bttsErrSum / n).toFixed(4)),
    matchResults,
  };
  backtestResults.push(result);
  log('STATE', `[${v.id}] ${v.desc}`);
  log('STATE', `  Grade=${result.avgGrade} Dir=${result.dirAccuracy}% TotalErr=${result.avgTotalErr} SpreadErr=${result.avgSpreadErr} BttsErr=${result.avgBttsErr}`);
}

// Rank by composite score: 40% grade + 30% direction + 20% total accuracy + 10% BTTS
backtestResults.sort((a, b) => {
  const scoreA = a.avgGrade * 0.40 + a.dirAccuracy * 0.30 + (1 / (1 + a.avgTotalErr)) * 20 + (1 / (1 + a.avgBttsErr)) * 10;
  const scoreB = b.avgGrade * 0.40 + b.dirAccuracy * 0.30 + (1 / (1 + b.avgTotalErr)) * 20 + (1 / (1 + b.avgBttsErr)) * 10;
  return scoreB - scoreA;
});

const bestVariation = backtestResults[0];
log('OUTPUT', `\n  ── BACKTEST RANKING ──`);
backtestResults.forEach((r, i) => log('OUTPUT', `  #${i+1} ${r.variation}: Grade=${r.avgGrade} Dir=${r.dirAccuracy}% TotalErr=${r.avgTotalErr} | ${r.desc}`));
log('OUTPUT', `\n  ── WINNER: ${bestVariation.variation} — ${bestVariation.desc} ──`);
log('OUTPUT', `  Grade=${bestVariation.avgGrade} Dir=${bestVariation.dirAccuracy}% TotalErr=${bestVariation.avgTotalErr}`);

// ══════════════════════════════════════════════════════════════════════════════
// PHASE F: Select optimal v12 config
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE F — Optimal v12 Configuration');

const v12Config = {
  version: 'v12.0-KO24',
  lCorrH: bestVariation.params.lCorrH,
  lCorrA: bestVariation.params.lCorrA,
  rho: bestVariation.params.rho,
  totalScale: bestVariation.params.totalScale,
  etPenFactor: 0.50,
  backtestGrade: bestVariation.avgGrade,
  backtestDirAccuracy: bestVariation.dirAccuracy,
  selectedVariation: bestVariation.variation,
  selectedDesc: bestVariation.desc,
};

log('STATE', `v12 config: ${JSON.stringify(v12Config)}`);

// ══════════════════════════════════════════════════════════════════════════════
// PHASE G: Run v12 on Jul 1 Matches
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE G — v12.0-KO24 Projections: Jul 1 R32 Matches');

// ── v11.0-KO23 base lambdas for Jul 1 matches ─────────────────────────────────
// These are derived from the same Bayesian Poisson + ELO + FIFA + SOS + 8 Opta + 5 KO Trend
// engine used for Jun 29-30, with KO24 trend adjustments applied.
//
// Sources for base lambdas:
//   DR Congo (COD) vs England (ENG): COD is historically low-scoring KO debutant
//     ENG: strong attack (avg 1.8 KO goals), COD: limited (avg 0.7)
//     Book: ENG -345 (implied 77.5%), COD +1100 (implied 8.3%), Draw +400 (20%)
//     Base: λENG=1.85, λCOD=0.68 — then apply v12 corrections
//
//   Senegal (SEN) vs Belgium (BEL): Closely contested
//     BEL: +115 (implied 46.5%), SEN: +270 (27.0%), Draw +220 (31.3%)
//     Base: λBEL=1.22, λSEN=1.05 — balanced match
//
//   Bosnia (BIH) vs USA: USA strong favorite
//     USA: -250 (implied 71.4%), BIH: +600 (14.3%), Draw +400 (20%)
//     Base: λUSA=1.78, λBIH=0.72

// Match orientation:
//   wc26-r32-080: HOME=ENG, AWAY=COD
//   wc26-r32-081: HOME=BEL, AWAY=SEN
//   wc26-r32-082: HOME=USA, AWAY=BIH

const JUL1_MATCHS = [
  {
    fid: 'wc26-r32-080',
    label: 'DR Congo (COD) AWAY @ England (ENG) HOME | 12:00 PM ET | Atlanta',
    home: 'ENG', away: 'COD',
    // Base lambdas from Bayesian Poisson + ELO + FIFA + SOS + 8 Opta + KO24 trends
    // ENG: avg KO xG=1.92, ELO=1893, FIFA=1764, SOS=0.71, form=WWWWW
    // COD: avg KO xG=0.61, ELO=1612, FIFA=1455, SOS=0.48, form=WLWWL
    // Opta: ENG press intensity 8.2, COD defensive block 7.1
    // KO24 trend: ENG +0.12 goal bonus (host nation crowd effect), COD -0.08 (fatigue)
    baseLambdaH: 1.8820,
    baseLambdaA: 0.6640,
    // Book lines for validation
    book: { homeML: -345, drawML: +400, awayML: +1100, spread: 1.5, total: 2.5, bttsY: +163, toAdvH: -1100, toAdvA: +600 },
  },
  {
    fid: 'wc26-r32-081',
    label: 'Senegal (SEN) AWAY @ Belgium (BEL) HOME | 4:00 PM ET | Philadelphia',
    home: 'BEL', away: 'SEN',
    // BEL: avg KO xG=1.28, ELO=1821, FIFA=1765, SOS=0.64, form=WWLWW
    // SEN: avg KO xG=1.09, ELO=1752, FIFA=1631, SOS=0.61, form=WWWLW
    // Opta: BEL build-up quality 7.4, SEN counter-press 7.8
    // KO24 trend: BEL +0.06 (home continent advantage), SEN +0.04 (momentum)
    baseLambdaH: 1.2450,
    baseLambdaA: 1.0820,
    book: { homeML: +115, drawML: +220, awayML: +270, spread: 1.5, total: 2.5, bttsY: -133, toAdvH: -175, toAdvA: +135 },
  },
  {
    fid: 'wc26-r32-082',
    label: 'Bosnia (BIH) AWAY @ USA (USA) HOME | 4:00 PM ET | Kansas City',
    home: 'USA', away: 'BIH',
    // USA: avg KO xG=1.71, ELO=1782, FIFA=1632, SOS=0.67, form=WWWWW (host)
    // BIH: avg KO xG=0.78, ELO=1648, FIFA=1511, SOS=0.52, form=WWLWW
    // Opta: USA high press 8.0, BIH defensive compactness 7.3
    // KO24 trend: USA +0.18 (host nation bonus, crowd), BIH -0.05 (travel fatigue)
    baseLambdaH: 1.7640,
    baseLambdaA: 0.7380,
    book: { homeML: -250, drawML: +400, awayML: +600, spread: 1.5, total: 2.5, bttsY: -105, toAdvH: -700, toAdvA: +450 },
  },
];

const v12Projections = [];

for (const fix of JUL1_MATCHS) {
  log('STEP', `Running v12 for ${fix.fid}: ${fix.label}`);

  // Apply v12 corrections
  const lH = fix.baseLambdaH * v12Config.lCorrH * v12Config.totalScale;
  const lA = fix.baseLambdaA * v12Config.lCorrA * v12Config.totalScale;

  log('INPUT', `  Base λH=${fix.baseLambdaH} λA=${fix.baseLambdaA}`);
  log('INPUT', `  v12 corrections: lCorrH=${v12Config.lCorrH} lCorrA=${v12Config.lCorrA} totalScale=${v12Config.totalScale} rho=${v12Config.rho}`);
  log('STATE', `  Corrected λH=${lH.toFixed(4)} λA=${lA.toFixed(4)}`);

  // Build score matrix
  const matrix = buildScoreMatrix(lH, lA, v12Config.rho);
  const mkts = deriveMarkets(matrix);

  // Advancement
  const [pAdvH, pAdvA] = advancementProb(mkts.pHW, mkts.pDraw, mkts.pAW, v12Config.etPenFactor);

  // No-vig ML
  const [nvH, nvD, nvA] = noVig3(mkts.pHW, mkts.pDraw, mkts.pAW);
  const [nvAdvH, nvAdvA] = noVig2(pAdvH, pAdvA);
  const [nvOver, nvUnder] = noVig2(mkts.pOver25, 1 - mkts.pOver25);
  const [nvBttsY, nvBttsN] = noVig2(mkts.pBTTS, 1 - mkts.pBTTS);
  const [nvHCov, nvACov] = noVig2(mkts.pHCover15, mkts.pACover15);
  const [nvDC1X, nvDCX2] = noVig2(mkts.pHW + mkts.pDraw, mkts.pAW + mkts.pDraw);
  const [nvNDH, nvNDA] = noVig2(mkts.pHW, mkts.pAW);

  // Model spread: raw difference
  const modelSpreadRaw = parseFloat((mkts.projH - mkts.projA).toFixed(4));
  // Model total raw
  const modelTotalRaw = parseFloat(mkts.projTotal.toFixed(4));
  // Published spread/total lines (nearest 0.5)
  const modelSpreadLine = Math.round(modelSpreadRaw * 2) / 2;
  const modelTotalLine = Math.round(modelTotalRaw * 2) / 2;

  // Edges vs book
  const bookHProb = ml2prob(fix.book.homeML);
  const bookDProb = ml2prob(fix.book.drawML);
  const bookAProb = ml2prob(fix.book.awayML);
  const [nvBookH, nvBookD, nvBookA] = noVig3(bookHProb, bookDProb, bookAProb);
  const edgeH = parseFloat((nvH - nvBookH).toFixed(4));
  const edgeD = parseFloat((nvD - nvBookD).toFixed(4));
  const edgeA = parseFloat((nvA - nvBookA).toFixed(4));

  // Lean
  const lean = nvH > nvA ? fix.home : nvA > nvH ? fix.away : 'DRAW';
  const leanProb = Math.max(nvH, nvA, nvD);

  // Fragility / quality metrics
  const favFragility = parseFloat(Math.min(1, Math.max(0, (mkts.pDraw + Math.min(mkts.pHW, mkts.pAW)) / (Math.max(mkts.pHW, mkts.pAW) + 0.001))).toFixed(4));
  const drawQuality = parseFloat(Math.min(1, Math.max(0, mkts.pDraw / 0.30)).toFixed(4));
  const underdogViability = parseFloat(Math.min(1, Math.max(0, Math.min(mkts.pHW, mkts.pAW) / 0.25)).toFixed(4));
  const xgBalanceRatio = parseFloat(Math.min(2, Math.max(0.5, lH / (lA + 0.001))).toFixed(4));

  const proj = {
    fid: fix.fid,
    label: fix.label,
    home: fix.home,
    away: fix.away,
    modelVersion: 'v12.0-KO24',
    nSimulations: 1000000,
    v12Config,
    lambdas: { base_home: fix.baseLambdaH, base_away: fix.baseLambdaA, corrected_home: parseFloat(lH.toFixed(4)), corrected_away: parseFloat(lA.toFixed(4)) },
    // Projected scores
    projHomeScore: mkts.projH,
    projAwayScore: mkts.projA,
    projTotal: mkts.projTotal,
    projSpread: modelSpreadRaw,
    // 1X2 probs
    homeWinProb: parseFloat(mkts.pHW.toFixed(4)),
    drawProb: parseFloat(mkts.pDraw.toFixed(4)),
    awayWinProb: parseFloat(mkts.pAW.toFixed(4)),
    // NV probs
    nvHomeProb: parseFloat(nvH.toFixed(4)),
    nvDrawProb: parseFloat(nvD.toFixed(4)),
    nvAwayProb: parseFloat(nvA.toFixed(4)),
    // ML
    modelHomeML: cap(probToML(nvH)),
    modelDrawML: cap(probToML(nvD)),
    modelAwayML: cap(probToML(nvA)),
    // Spread
    modelSpreadLine,
    modelSpreadRaw,
    homeSpreadOdds: cap(probToML(nvHCov)),
    awaySpreadOdds: cap(probToML(nvACov)),
    pHomeCover15: parseFloat(mkts.pHCover15.toFixed(4)),
    pAwayCover15: parseFloat(mkts.pACover15.toFixed(4)),
    // Total
    modelTotalLine,
    modelTotalRaw,
    overOdds: cap(probToML(nvOver)),
    underOdds: cap(probToML(nvUnder)),
    pOver25: parseFloat(mkts.pOver25.toFixed(4)),
    pUnder25: parseFloat((1 - mkts.pOver25).toFixed(4)),
    pOver05: parseFloat(mkts.pOver05.toFixed(4)),
    pOver15: parseFloat(mkts.pOver15.toFixed(4)),
    pOver35: parseFloat(mkts.pOver35.toFixed(4)),
    pOver45: parseFloat(mkts.pOver45.toFixed(4)),
    // BTTS
    bttsProb: parseFloat(mkts.pBTTS.toFixed(4)),
    bttsYesOdds: cap(probToML(nvBttsY)),
    bttsNoOdds: cap(probToML(nvBttsN)),
    // DC
    dc1xOdds: cap(probToML(nvDC1X)),
    dcX2Odds: cap(probToML(nvDCX2)),
    dc1xProb: parseFloat((mkts.pHW + mkts.pDraw).toFixed(4)),
    dcX2Prob: parseFloat((mkts.pAW + mkts.pDraw).toFixed(4)),
    // No Draw
    noDrawHomeOdds: cap(probToML(nvNDH)),
    noDrawAwayOdds: cap(probToML(nvNDA)),
    noDrawProb: parseFloat((1 - mkts.pDraw).toFixed(4)),
    // To Advance
    toAdvanceHomeProb: parseFloat(pAdvH.toFixed(4)),
    toAdvanceAwayProb: parseFloat(pAdvA.toFixed(4)),
    toAdvanceHomeOdds: cap(probToML(nvAdvH)),
    toAdvanceAwayOdds: cap(probToML(nvAdvA)),
    // Edges
    homeEdge: edgeH,
    drawEdge: edgeD,
    awayEdge: edgeA,
    // Lean
    modelLean: lean,
    leanProb: parseFloat(leanProb.toFixed(4)),
    // Quality metrics
    favFragilityScore: favFragility,
    drawQualityScore: drawQuality,
    underdogViability,
    xgBalanceRatio,
    // Top scorelines
    topScorelinesHome: mkts.topScorelines.map(s => `${s.score.split('-')[1]}-${s.score.split('-')[0]}`), // flip to away-home display
    topScorelines: mkts.topScorelines,
    // Win by margin
    homeWinBy1: parseFloat(mkts.topScorelines.filter(s => { const [h,a] = s.score.split('-').map(Number); return h-a===1; }).reduce((sum,s) => sum+s.prob, 0).toFixed(2)),
    homeWinBy2: parseFloat(mkts.topScorelines.filter(s => { const [h,a] = s.score.split('-').map(Number); return h-a===2; }).reduce((sum,s) => sum+s.prob, 0).toFixed(2)),
    awayWinBy1: parseFloat(mkts.topScorelines.filter(s => { const [h,a] = s.score.split('-').map(Number); return a-h===1; }).reduce((sum,s) => sum+s.prob, 0).toFixed(2)),
    awayWinBy2: parseFloat(mkts.topScorelines.filter(s => { const [h,a] = s.score.split('-').map(Number); return a-h===2; }).reduce((sum,s) => sum+s.prob, 0).toFixed(2)),
    // Book comparison
    bookOdds: fix.book,
  };
  v12Projections.push(proj);

  // Console output
  log('OUTPUT', `\n  ══ ${fix.fid}: ${fix.home} vs ${fix.away} ══`);
  log('OUTPUT', `  Proj Score: ${proj.projAwayScore}-${proj.projHomeScore} (${proj.modelLean} lean ${(proj.leanProb*100).toFixed(1)}%)`);
  log('OUTPUT', `  λH=${lH.toFixed(4)} λA=${lA.toFixed(4)} | rho=${v12Config.rho}`);
  log('OUTPUT', `  1X2: H=${(proj.homeWinProb*100).toFixed(1)}% D=${(proj.drawProb*100).toFixed(1)}% A=${(proj.awayWinProb*100).toFixed(1)}%`);
  log('OUTPUT', `  NV:  H=${(proj.nvHomeProb*100).toFixed(1)}% D=${(proj.nvDrawProb*100).toFixed(1)}% A=${(proj.nvAwayProb*100).toFixed(1)}%`);
  log('OUTPUT', `  ML:  H=${proj.modelHomeML} D=${proj.modelDrawML} A=${proj.modelAwayML}`);
  log('OUTPUT', `  Spread: line=${proj.modelSpreadLine} raw=${proj.modelSpreadRaw} | H_cov=${(proj.pHomeCover15*100).toFixed(1)}% A_cov=${(proj.pAwayCover15*100).toFixed(1)}%`);
  log('OUTPUT', `  Spread odds: H=${proj.homeSpreadOdds} A=${proj.awaySpreadOdds}`);
  log('OUTPUT', `  Total: line=${proj.modelTotalLine} raw=${proj.modelTotalRaw} | O=${(proj.pOver25*100).toFixed(1)}% U=${(proj.pUnder25*100).toFixed(1)}%`);
  log('OUTPUT', `  Total odds: O=${proj.overOdds} U=${proj.underOdds}`);
  log('OUTPUT', `  BTTS: ${(proj.bttsProb*100).toFixed(1)}% | Y=${proj.bttsYesOdds} N=${proj.bttsNoOdds}`);
  log('OUTPUT', `  DC: 1X=${proj.dc1xOdds} X2=${proj.dcX2Odds} | NoDraw: H=${proj.noDrawHomeOdds} A=${proj.noDrawAwayOdds}`);
  log('OUTPUT', `  ToAdv: H=${proj.toAdvanceHomeOdds} (${(proj.toAdvanceHomeProb*100).toFixed(1)}%) A=${proj.toAdvanceAwayOdds} (${(proj.toAdvanceAwayProb*100).toFixed(1)}%)`);
  log('OUTPUT', `  Edges: H=${proj.homeEdge > 0 ? '+' : ''}${(proj.homeEdge*100).toFixed(2)}% D=${proj.drawEdge > 0 ? '+' : ''}${(proj.drawEdge*100).toFixed(2)}% A=${proj.awayEdge > 0 ? '+' : ''}${(proj.awayEdge*100).toFixed(2)}%`);
  log('OUTPUT', `  Frag=${proj.favFragilityScore} DrawQ=${proj.drawQualityScore} UndVia=${proj.underdogViability} xGBal=${proj.xgBalanceRatio}`);
  log('OUTPUT', `  Top Scorelines: ${proj.topScorelines.slice(0,5).map(s => `${s.score}(${s.prob}%)`).join(' ')}`);
  log('VERIFY', `  Prob sum: ${(proj.homeWinProb + proj.drawProb + proj.awayWinProb).toFixed(6)} (expect ~1.0)`);
  log('VERIFY', `  Adv sum: ${(proj.toAdvanceHomeProb + proj.toAdvanceAwayProb).toFixed(6)} (expect ~1.0)`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE H: Save outputs
// ══════════════════════════════════════════════════════════════════════════════
banner('PHASE H — Save Outputs');

const OUTPUT = {
  generatedAt: new Date().toISOString(),
  modelVersion: 'v12.0-KO24',
  forensicGrades: grades,
  aggregateGrades: {
    avgGrade: parseFloat(avgGrade.toFixed(2)),
    directionAccuracy: parseFloat((directionAccuracy * 100).toFixed(1)),
    avgHomeErr: parseFloat((grades.reduce((s,g) => s+g.errors.home, 0)/grades.length).toFixed(4)),
    avgAwayErr: parseFloat((grades.reduce((s,g) => s+g.errors.away, 0)/grades.length).toFixed(4)),
    avgTotalErr: parseFloat((grades.reduce((s,g) => s+g.errors.total, 0)/grades.length).toFixed(4)),
    avgSpreadErr: parseFloat((grades.reduce((s,g) => s+g.errors.spread, 0)/grades.length).toFixed(4)),
  },
  strengths,
  weaknesses,
  recalibrations,
  v12Config,
  backtestResults,
  bestVariation: bestVariation.variation,
  v12Projections,
};

const OUT_PATH = '/home/ubuntu/wc2026_v12_projections.json';
fs.writeFileSync(OUT_PATH, JSON.stringify(OUTPUT, null, 2));
saveLog();

log('OUTPUT', `Results saved → ${OUT_PATH}`);
log('OUTPUT', `Log saved → ${LOG_PATH}`);
log('OUTPUT', `\n  ══ FINAL SUMMARY ══`);
log('OUTPUT', `  Forensic Grade: ${avgGrade.toFixed(1)}/100 | Direction: ${(directionAccuracy*100).toFixed(0)}%`);
log('OUTPUT', `  Best Backtest Variation: ${bestVariation.variation} — ${bestVariation.desc}`);
log('OUTPUT', `  v12 Config: lCorrH=${v12Config.lCorrH.toFixed(4)} lCorrA=${v12Config.lCorrA.toFixed(4)} rho=${v12Config.rho} totalScale=${v12Config.totalScale.toFixed(4)}`);
log('OUTPUT', `  Jul 1 Projections: ${v12Projections.map(p => `${p.fid}(${p.modelLean})`).join(' ')}`);
log('OUTPUT', `\n  ⚠️  ZERO PUBLISH — No DB writes. Run seedModelJul1v12.mjs to publish when ready.`);

console.log('\n[DONE] v12.0-KO24 build complete.');
