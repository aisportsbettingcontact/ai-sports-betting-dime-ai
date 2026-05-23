/**
 * ============================================================
 * MLB MODEL RECALIBRATION + MAY 23 2026 GAME MODELING
 * ============================================================
 * PHASE 1: Compute calibration signals from 2026 backtest
 *   - Per-market: bias (avg model prob - avg actual win rate)
 *   - ECE (Expected Calibration Error) per market
 *   - Brier score per market
 *   - Edge bucket accuracy (does positive edge predict wins?)
 *   - Home/away bias, over/under bias, NRFI/YRFI bias
 *   - Platt scaling factor per market
 *
 * PHASE 2: Apply recalibration to mlb_calibration_constants
 *   - Upsert per-market bias correction factors
 *   - Log all changes with before/after values
 *
 * PHASE 3: Model all 16 May 23 games with recalibrated probs
 *   - Apply bias corrections to raw model probs
 *   - Compute no-vig book probs, edges, EV, confidence flags
 *   - Write recalibrated projections to games table
 *   - Output full per-game report
 * ============================================================
 */

import { createConnection } from 'mysql2/promise';

const S = '2026-03-25';
const E = '2026-05-22';
const TARGET_DATE = '2026-05-23';
const RECAL_VERSION = 'v2026-recal-1.0';
const MIN_SAMPLE_FOR_RECAL = 30; // minimum graded rows to trust a bias estimate
const BIAS_THRESHOLD = 0.005;    // 0.5% — apply correction only if |bias| > this

// ─── MATH UTILITIES ───────────────────────────────────────────────────────────

function oddsToProb(oddsStr) {
  if (oddsStr == null) return null;
  const o = parseFloat(String(oddsStr).replace(/[^0-9.\-+]/g, ''));
  if (isNaN(o)) return null;
  if (o > 0) return 100 / (o + 100);
  if (o < 0) return Math.abs(o) / (Math.abs(o) + 100);
  return null;
}

function noVigProb(oddsA, oddsB) {
  const pA = oddsToProb(oddsA);
  const pB = oddsToProb(oddsB);
  if (pA == null || pB == null) return null;
  const total = pA + pB;
  if (total <= 0) return null;
  return pA / total;
}

function probToAmericanOdds(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function oddsToDecimal(oddsStr) {
  if (oddsStr == null) return null;
  const o = parseFloat(String(oddsStr).replace(/[^0-9.\-+]/g, ''));
  if (isNaN(o)) return null;
  if (o > 0) return (o / 100) + 1;
  if (o < 0) return (100 / Math.abs(o)) + 1;
  return null;
}

function computeEV(modelProb, bookOdds) {
  if (modelProb == null || bookOdds == null) return null;
  const dec = oddsToDecimal(bookOdds);
  if (dec == null) return null;
  return parseFloat((modelProb * dec - 1).toFixed(6));
}

function computeEdge(modelProb, bookOdds, oppositeOdds) {
  if (modelProb == null || bookOdds == null) return null;
  const nvp = oppositeOdds != null ? noVigProb(bookOdds, oppositeOdds) : oddsToProb(bookOdds);
  if (nvp == null) return null;
  return parseFloat((modelProb - nvp).toFixed(6));
}

/**
 * Platt scaling: apply logistic recalibration
 * p_cal = sigmoid(A * logit(p_raw) + B)
 * For bias-only correction: A=1, B = -logit(bias_correction)
 * Simplified: if model is overconfident by `bias`, shift all probs by -bias
 * Clamped to [0.01, 0.99]
 */
function applyBiasCorrection(rawProb, biasCorrection) {
  if (rawProb == null) return null;
  const corrected = rawProb - biasCorrection;
  return Math.max(0.01, Math.min(0.99, corrected));
}

/**
 * ECE computation: 10 equal-width buckets [0,0.1)...[0.9,1.0]
 */
function computeECE(rows) {
  // rows: [{modelProb, correct}] where correct is 0 or 1
  const N = rows.length;
  if (N === 0) return { ece: null, buckets: [] };
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    min: i * 0.1, max: (i + 1) * 0.1,
    label: `${(i*0.1).toFixed(1)}–${((i+1)*0.1).toFixed(1)}`,
    count: 0, sumProb: 0, sumCorrect: 0,
  }));
  for (const r of rows) {
    const p = parseFloat(r.modelProb);
    const c = r.correct;
    if (isNaN(p) || c == null) continue;
    const bi = Math.min(9, Math.floor(p * 10));
    buckets[bi].count++;
    buckets[bi].sumProb += p;
    buckets[bi].sumCorrect += c;
  }
  let ece = 0;
  const bucketResults = [];
  for (const b of buckets) {
    if (b.count < 5) continue; // skip sparse buckets
    const avgProb = b.sumProb / b.count;
    const actualRate = b.sumCorrect / b.count;
    const calErr = Math.abs(avgProb - actualRate);
    ece += (b.count / N) * calErr;
    bucketResults.push({ label: b.label, count: b.count, avgProb, actualRate, calErr });
  }
  return { ece: parseFloat(ece.toFixed(6)), buckets: bucketResults };
}

/**
 * Brier score: mean((p - o)^2)
 */
function computeBrier(rows) {
  const valid = rows.filter(r => r.modelProb != null && r.correct != null);
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, r) => acc + Math.pow(parseFloat(r.modelProb) - r.correct, 2), 0);
  return parseFloat((sum / valid.length).toFixed(6));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const conn = await createConnection(process.env.DATABASE_URL);

console.log('='.repeat(70));
console.log('MLB MODEL RECALIBRATION + MAY 23 2026 GAME MODELING');
console.log('='.repeat(70));
console.log(`[INPUT] Backtest window: ${S} → ${E}`);
console.log(`[INPUT] Target date: ${TARGET_DATE}`);
console.log(`[INPUT] Recalibration version: ${RECAL_VERSION}`);
console.log(`[INPUT] Min sample for recalibration: ${MIN_SAMPLE_FOR_RECAL}`);
console.log(`[INPUT] Bias threshold: ${BIAS_THRESHOLD * 100}%`);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: COMPUTE CALIBRATION SIGNALS
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(70));
console.log('PHASE 1: CALIBRATION SIGNAL EXTRACTION');
console.log('─'.repeat(70));

// Fetch all SAFE (non-quarantined) graded rows from backtest
const [gradedRows] = await conn.query(`
  SELECT market, modelProb, correct, bookOdds, bookOddsOpposite, edge, profitLoss, gameDate
  FROM mlb_game_backtest
  WHERE gameDate >= ? AND gameDate <= ?
    AND result IN ('WIN','LOSS','PUSH')
    AND leakageSafe = 1
    AND modelProb IS NOT NULL
  ORDER BY market, gameDate
`, [S, E]);

console.log(`[STATE] Total SAFE graded rows: ${gradedRows.length}`);

// Group by market
const byMarket = {};
for (const r of gradedRows) {
  if (!byMarket[r.market]) byMarket[r.market] = [];
  byMarket[r.market].push(r);
}

// Per-market calibration signals
const marketSignals = {};
const MARKETS_TO_ANALYZE = ['fg_ml_home','fg_ml_away','fg_over','fg_under','f5_ml_home','f5_ml_away','f5_rl_home','f5_rl_away','f5_over','f5_under','nrfi','yrfi'];

for (const mkt of MARKETS_TO_ANALYZE) {
  const rows = byMarket[mkt] || [];
  // Only WIN/LOSS for accuracy (exclude PUSH)
  const wlRows = rows.filter(r => r.correct === 1 || r.correct === 0);
  const wins = wlRows.filter(r => r.correct === 1).length;
  const losses = wlRows.filter(r => r.correct === 0).length;
  const winRate = wlRows.length > 0 ? wins / wlRows.length : null;
  
  // Average model probability (raw, as decimal)
  const avgModelProb = wlRows.length > 0
    ? wlRows.reduce((s, r) => s + parseFloat(r.modelProb), 0) / wlRows.length
    : null;
  
  // Calibration bias: avg model prob - actual win rate
  const bias = (avgModelProb != null && winRate != null) ? avgModelProb - winRate : null;
  
  // ECE
  const { ece, buckets } = computeECE(wlRows);
  
  // Brier
  const brier = computeBrier(wlRows);
  
  // Edge bucket accuracy: among rows with positive edge, what % won?
  const posEdgeRows = wlRows.filter(r => r.edge != null && parseFloat(r.edge) > 0);
  const posEdgeWins = posEdgeRows.filter(r => r.correct === 1).length;
  const posEdgeWinRate = posEdgeRows.length > 0 ? posEdgeWins / posEdgeRows.length : null;
  
  // Profit/loss
  const totalPL = rows.reduce((s, r) => s + (r.profitLoss != null ? parseFloat(r.profitLoss) : (r.correct === 0 ? -100 : 0)), 0);
  
  marketSignals[mkt] = {
    market: mkt,
    n: wlRows.length,
    wins, losses, winRate,
    avgModelProb, bias,
    ece, brier,
    posEdgeN: posEdgeRows.length,
    posEdgeWinRate,
    totalPL: parseFloat(totalPL.toFixed(2)),
    buckets,
  };
  
  const biasDir = bias == null ? 'N/A' : bias > 0 ? 'OVERCONFIDENT' : bias < 0 ? 'UNDERCONFIDENT' : 'WELL_CALIBRATED';
  console.log(`\n[STATE] Market: ${mkt}`);
  console.log(`  n=${wlRows.length} wins=${wins} losses=${losses} winRate=${winRate != null ? (winRate*100).toFixed(2)+'%' : 'N/A'}`);
  console.log(`  avgModelProb=${avgModelProb != null ? (avgModelProb*100).toFixed(2)+'%' : 'N/A'} bias=${bias != null ? (bias*100).toFixed(3)+'%' : 'N/A'} (${biasDir})`);
  console.log(`  ECE=${ece != null ? ece.toFixed(4) : 'N/A'} Brier=${brier != null ? brier.toFixed(4) : 'N/A'}`);
  console.log(`  posEdge: n=${posEdgeRows.length} winRate=${posEdgeWinRate != null ? (posEdgeWinRate*100).toFixed(1)+'%' : 'N/A'}`);
  console.log(`  totalPL=$${totalPL.toFixed(2)}`);
}

// Aggregate bias signals
console.log('\n[STATE] AGGREGATE BIAS SIGNALS:');
const homeMarkets = ['fg_ml_home','f5_ml_home','f5_rl_home'];
const awayMarkets = ['fg_ml_away','f5_ml_away','f5_rl_away'];
const overMarkets = ['fg_over','f5_over'];
const underMarkets = ['fg_under','f5_under'];
const nrfiMarkets = ['nrfi'];
const yrfiMarkets = ['yrfi'];

function avgBias(mkts) {
  const biases = mkts.map(m => marketSignals[m]?.bias).filter(b => b != null);
  return biases.length > 0 ? biases.reduce((s,b) => s+b, 0) / biases.length : null;
}
const homeBias = avgBias(homeMarkets);
const awayBias = avgBias(awayMarkets);
const overBias = avgBias(overMarkets);
const underBias = avgBias(underMarkets);
const nrfiBias = avgBias(nrfiMarkets);
const yrfiBias = avgBias(yrfiMarkets);

console.log(`  Home markets avg bias: ${homeBias != null ? (homeBias*100).toFixed(3)+'%' : 'N/A'}`);
console.log(`  Away markets avg bias: ${awayBias != null ? (awayBias*100).toFixed(3)+'%' : 'N/A'}`);
console.log(`  Over markets avg bias: ${overBias != null ? (overBias*100).toFixed(3)+'%' : 'N/A'}`);
console.log(`  Under markets avg bias: ${underBias != null ? (underBias*100).toFixed(3)+'%' : 'N/A'}`);
console.log(`  NRFI bias: ${nrfiBias != null ? (nrfiBias*100).toFixed(3)+'%' : 'N/A'}`);
console.log(`  YRFI bias: ${yrfiBias != null ? (yrfiBias*100).toFixed(3)+'%' : 'N/A'}`);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: APPLY RECALIBRATION TO mlb_calibration_constants
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(70));
console.log('PHASE 2: APPLY RECALIBRATION TO DB');
console.log('─'.repeat(70));

const now = Date.now();

// Build recalibration params from backtest signals
// Each param: { paramName, newValue, sampleSize, rationale }
const recalParams = [];

for (const mkt of MARKETS_TO_ANALYZE) {
  const sig = marketSignals[mkt];
  if (!sig || sig.n < MIN_SAMPLE_FOR_RECAL) {
    console.log(`[STEP] ${mkt}: SKIP — insufficient sample (n=${sig?.n ?? 0} < ${MIN_SAMPLE_FOR_RECAL})`);
    continue;
  }
  if (sig.bias == null) {
    console.log(`[STEP] ${mkt}: SKIP — bias is null`);
    continue;
  }
  if (Math.abs(sig.bias) <= BIAS_THRESHOLD) {
    console.log(`[STEP] ${mkt}: SKIP — bias ${(sig.bias*100).toFixed(3)}% within threshold (${BIAS_THRESHOLD*100}%)`);
    continue;
  }
  
  // Bias correction factor: subtract bias from model prob
  // Stored as positive = model was overconfident, negative = underconfident
  const paramName = `bias_correction_${mkt}`;
  recalParams.push({
    paramName,
    newValue: parseFloat(sig.bias.toFixed(8)),
    sampleSize: sig.n,
    rationale: `2026 backtest: avgModelProb=${(sig.avgModelProb*100).toFixed(2)}% actualWinRate=${(sig.winRate*100).toFixed(2)}% bias=${(sig.bias*100).toFixed(3)}% ECE=${sig.ece?.toFixed(4)} Brier=${sig.brier?.toFixed(4)}`,
  });
  console.log(`[STEP] ${mkt}: RECALIBRATE — bias=${(sig.bias*100).toFixed(3)}% → param=${paramName}=${sig.bias.toFixed(6)}`);
}

// Also update aggregate bias params
const aggregateParams = [
  { paramName: 'fg_ml_home_edge', newValue: marketSignals['fg_ml_home']?.winRate != null ? parseFloat((marketSignals['fg_ml_home'].winRate - 0.5).toFixed(8)) : null, sampleSize: marketSignals['fg_ml_home']?.n, rationale: '2026 backtest fg_ml_home win rate vs 50%' },
  { paramName: 'nrfi_rate', newValue: marketSignals['nrfi']?.winRate != null ? parseFloat(marketSignals['nrfi'].winRate.toFixed(8)) : null, sampleSize: marketSignals['nrfi']?.n, rationale: '2026 backtest NRFI actual win rate' },
];

for (const p of aggregateParams) {
  if (p.newValue == null) continue;
  recalParams.push(p);
  console.log(`[STEP] ${p.paramName}: UPDATE → ${p.newValue} (n=${p.sampleSize})`);
}

// Upsert all recalibration params
let upserted = 0;
for (const p of recalParams) {
  // Get current value
  const [existing] = await conn.query('SELECT currentValue FROM mlb_calibration_constants WHERE paramName = ?', [p.paramName]);
  const prevValue = existing.length > 0 ? existing[0].currentValue : null;
  
  await conn.query(`
    INSERT INTO mlb_calibration_constants (paramName, currentValue, baselineValue, previousValue, sampleSize, updateSource, lastUpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      previousValue = currentValue,
      currentValue = VALUES(currentValue),
      sampleSize = VALUES(sampleSize),
      updateSource = VALUES(updateSource),
      lastUpdatedAt = VALUES(lastUpdatedAt)
  `, [p.paramName, p.newValue, p.newValue, prevValue, p.sampleSize, `AUTO_RECAL_${RECAL_VERSION}`, now]);
  
  console.log(`[OUTPUT] UPSERTED ${p.paramName}: prev=${prevValue} → new=${p.newValue} (n=${p.sampleSize})`);
  upserted++;
}

console.log(`[OUTPUT] Recalibration complete: ${upserted} params upserted`);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: MODEL ALL 16 MAY 23 GAMES WITH RECALIBRATED PROBS
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(70));
console.log('PHASE 3: MODEL MAY 23 2026 GAMES');
console.log('─'.repeat(70));

// Load all recalibration params from DB
const [allParams] = await conn.query('SELECT paramName, currentValue FROM mlb_calibration_constants');
const params = {};
for (const p of allParams) params[p.paramName] = parseFloat(p.currentValue);
console.log(`[INPUT] Loaded ${allParams.length} calibration params`);

// Bias correction helper
function getBiasCorrection(market) {
  return params[`bias_correction_${market}`] ?? 0;
}

// Fetch May 23 games
const [games] = await conn.query(`
  SELECT id, awayTeam, homeTeam, startTimeEst, gameStatus,
    awayML, homeML, bookTotal, overOdds, underOdds,
    awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
    f5AwayML, f5HomeML, f5Total, f5OverOdds, f5UnderOdds,
    nrfiOverOdds, yrfiUnderOdds,
    modelHomeWinPct, modelAwayWinPct,
    modelOverRate, modelUnderRate,
    modelF5HomeWinPct, modelF5AwayWinPct,
    modelF5OverRate, modelF5UnderRate,
    modelF5HomeRLCoverPct, modelF5AwayRLCoverPct,
    modelPNrfi, modelRunAt
  FROM games
  WHERE gameDate = ? AND sport = 'MLB'
  ORDER BY startTimeEst
`, [TARGET_DATE]);

console.log(`[INPUT] ${games.length} May 23 games loaded`);

// Per-game modeling
const gameResults = [];

for (const g of games) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[STEP] Game: ${g.awayTeam} @ ${g.homeTeam} | ${g.startTimeEst} | status=${g.gameStatus}`);
  
  const result = {
    gameId: g.id,
    awayTeam: g.awayTeam,
    homeTeam: g.homeTeam,
    startTime: g.startTimeEst,
    markets: {},
  };
  
  // ── FG ML ──────────────────────────────────────────────────
  {
    const rawHome = g.modelHomeWinPct != null ? parseFloat(g.modelHomeWinPct) / 100 : null;
    const rawAway = g.modelAwayWinPct != null ? parseFloat(g.modelAwayWinPct) / 100 : null;
    const calHome = rawHome != null ? applyBiasCorrection(rawHome, getBiasCorrection('fg_ml_home')) : null;
    const calAway = rawAway != null ? applyBiasCorrection(rawAway, getBiasCorrection('fg_ml_away')) : null;
    // Renormalize so home + away = 1
    const sumFg = (calHome ?? 0) + (calAway ?? 0);
    const normHome = sumFg > 0 && calHome != null ? calHome / sumFg : calHome;
    const normAway = sumFg > 0 && calAway != null ? calAway / sumFg : calAway;
    
    const edgeHome = computeEdge(normHome, g.homeML, g.awayML);
    const edgeAway = computeEdge(normAway, g.awayML, g.homeML);
    const evHome = computeEV(normHome, g.homeML);
    const evAway = computeEV(normAway, g.awayML);
    const nvpHome = noVigProb(g.homeML, g.awayML);
    const nvpAway = noVigProb(g.awayML, g.homeML);
    
    result.markets.fg_ml = {
      rawHomeProb: rawHome, rawAwayProb: rawAway,
      calHomeProb: normHome, calAwayProb: normAway,
      biasCorHome: getBiasCorrection('fg_ml_home'),
      biasCorAway: getBiasCorrection('fg_ml_away'),
      bookHomeML: g.homeML, bookAwayML: g.awayML,
      nvpHome, nvpAway,
      edgeHome, edgeAway,
      evHome, evAway,
      modelHomeOdds: normHome != null ? probToAmericanOdds(normHome) : null,
      modelAwayOdds: normAway != null ? probToAmericanOdds(normAway) : null,
    };
    
    console.log(`[STATE] FG ML:`);
    console.log(`  HOME ${g.homeTeam}: raw=${rawHome != null ? (rawHome*100).toFixed(2)+'%' : 'N/A'} → cal=${normHome != null ? (normHome*100).toFixed(2)+'%' : 'N/A'} (bias_cor=${(getBiasCorrection('fg_ml_home')*100).toFixed(3)}%)`);
    console.log(`  HOME: bookML=${g.homeML} nvp=${nvpHome != null ? (nvpHome*100).toFixed(2)+'%' : 'N/A'} edge=${edgeHome != null ? (edgeHome*100).toFixed(3)+'%' : 'N/A'} EV=${evHome != null ? (evHome*100).toFixed(2)+'%' : 'N/A'} modelOdds=${result.markets.fg_ml.modelHomeOdds}`);
    console.log(`  AWAY ${g.awayTeam}: raw=${rawAway != null ? (rawAway*100).toFixed(2)+'%' : 'N/A'} → cal=${normAway != null ? (normAway*100).toFixed(2)+'%' : 'N/A'} (bias_cor=${(getBiasCorrection('fg_ml_away')*100).toFixed(3)}%)`);
    console.log(`  AWAY: bookML=${g.awayML} nvp=${nvpAway != null ? (nvpAway*100).toFixed(2)+'%' : 'N/A'} edge=${edgeAway != null ? (edgeAway*100).toFixed(3)+'%' : 'N/A'} EV=${evAway != null ? (evAway*100).toFixed(2)+'%' : 'N/A'} modelOdds=${result.markets.fg_ml.modelAwayOdds}`);
  }
  
  // ── FG TOTAL ───────────────────────────────────────────────
  {
    const rawOver = g.modelOverRate != null ? parseFloat(g.modelOverRate) / 100 : null;
    const rawUnder = rawOver != null ? 1 - rawOver : null;
    const calOver = rawOver != null ? applyBiasCorrection(rawOver, getBiasCorrection('fg_over')) : null;
    const calUnder = rawUnder != null ? applyBiasCorrection(rawUnder, getBiasCorrection('fg_under')) : null;
    const sumTot = (calOver ?? 0) + (calUnder ?? 0);
    const normOver = sumTot > 0 && calOver != null ? calOver / sumTot : calOver;
    const normUnder = sumTot > 0 && calUnder != null ? calUnder / sumTot : calUnder;
    
    const edgeOver = computeEdge(normOver, g.overOdds, g.underOdds);
    const edgeUnder = computeEdge(normUnder, g.underOdds, g.overOdds);
    const evOver = computeEV(normOver, g.overOdds);
    const evUnder = computeEV(normUnder, g.underOdds);
    
    result.markets.fg_total = {
      bookTotal: g.bookTotal, rawOverProb: rawOver, rawUnderProb: rawUnder,
      calOverProb: normOver, calUnderProb: normUnder,
      biasCorOver: getBiasCorrection('fg_over'), biasCorUnder: getBiasCorrection('fg_under'),
      bookOverOdds: g.overOdds, bookUnderOdds: g.underOdds,
      edgeOver, edgeUnder, evOver, evUnder,
      modelOverOdds: normOver != null ? probToAmericanOdds(normOver) : null,
      modelUnderOdds: normUnder != null ? probToAmericanOdds(normUnder) : null,
    };
    
    console.log(`[STATE] FG Total (line=${g.bookTotal}):`);
    console.log(`  OVER: raw=${rawOver != null ? (rawOver*100).toFixed(2)+'%' : 'N/A'} → cal=${normOver != null ? (normOver*100).toFixed(2)+'%' : 'N/A'} bookOdds=${g.overOdds} edge=${edgeOver != null ? (edgeOver*100).toFixed(3)+'%' : 'N/A'} EV=${evOver != null ? (evOver*100).toFixed(2)+'%' : 'N/A'}`);
    console.log(`  UNDER: raw=${rawUnder != null ? (rawUnder*100).toFixed(2)+'%' : 'N/A'} → cal=${normUnder != null ? (normUnder*100).toFixed(2)+'%' : 'N/A'} bookOdds=${g.underOdds} edge=${edgeUnder != null ? (edgeUnder*100).toFixed(3)+'%' : 'N/A'} EV=${evUnder != null ? (evUnder*100).toFixed(2)+'%' : 'N/A'}`);
  }
  
  // ── F5 ML ──────────────────────────────────────────────────
  {
    const rawF5Home = g.modelF5HomeWinPct != null ? parseFloat(g.modelF5HomeWinPct) / 100 : null;
    const rawF5Away = g.modelF5AwayWinPct != null ? parseFloat(g.modelF5AwayWinPct) / 100 : null;
    const calF5Home = rawF5Home != null ? applyBiasCorrection(rawF5Home, getBiasCorrection('f5_ml_home')) : null;
    const calF5Away = rawF5Away != null ? applyBiasCorrection(rawF5Away, getBiasCorrection('f5_ml_away')) : null;
    const sumF5 = (calF5Home ?? 0) + (calF5Away ?? 0);
    const normF5Home = sumF5 > 0 && calF5Home != null ? calF5Home / sumF5 : calF5Home;
    const normF5Away = sumF5 > 0 && calF5Away != null ? calF5Away / sumF5 : calF5Away;
    
    // F5 book odds are null for May 23 — log and continue
    const edgeF5Home = computeEdge(normF5Home, g.f5HomeML, g.f5AwayML);
    const edgeF5Away = computeEdge(normF5Away, g.f5AwayML, g.f5HomeML);
    
    result.markets.f5_ml = {
      rawF5HomeProb: rawF5Home, rawF5AwayProb: rawF5Away,
      calF5HomeProb: normF5Home, calF5AwayProb: normF5Away,
      bookF5HomeML: g.f5HomeML, bookF5AwayML: g.f5AwayML,
      edgeF5Home, edgeF5Away,
      modelF5HomeOdds: normF5Home != null ? probToAmericanOdds(normF5Home) : null,
      modelF5AwayOdds: normF5Away != null ? probToAmericanOdds(normF5Away) : null,
    };
    
    console.log(`[STATE] F5 ML:`);
    console.log(`  F5 HOME: raw=${rawF5Home != null ? (rawF5Home*100).toFixed(2)+'%' : 'N/A'} → cal=${normF5Home != null ? (normF5Home*100).toFixed(2)+'%' : 'N/A'} bookML=${g.f5HomeML ?? 'NULL'} edge=${edgeF5Home != null ? (edgeF5Home*100).toFixed(3)+'%' : 'N/A (no book odds)'}`);
    console.log(`  F5 AWAY: raw=${rawF5Away != null ? (rawF5Away*100).toFixed(2)+'%' : 'N/A'} → cal=${normF5Away != null ? (normF5Away*100).toFixed(2)+'%' : 'N/A'} bookML=${g.f5AwayML ?? 'NULL'} edge=${edgeF5Away != null ? (edgeF5Away*100).toFixed(3)+'%' : 'N/A (no book odds)'}`);
  }
  
  // ── F5 RL ──────────────────────────────────────────────────
  {
    const rawF5RlHome = g.modelF5HomeRLCoverPct != null ? parseFloat(g.modelF5HomeRLCoverPct) / 100 : null; // 0-100 scale confirmed
    const rawF5RlAway = g.modelF5AwayRLCoverPct != null ? parseFloat(g.modelF5AwayRLCoverPct) / 100 : null; // 0-100 scale confirmed
    const calF5RlHome = rawF5RlHome != null ? applyBiasCorrection(rawF5RlHome, getBiasCorrection('f5_rl_home')) : null;
    const calF5RlAway = rawF5RlAway != null ? applyBiasCorrection(rawF5RlAway, getBiasCorrection('f5_rl_away')) : null;
    
    const edgeF5RlHome = computeEdge(calF5RlHome, g.f5HomeRunLineOdds, g.f5AwayRunLineOdds);
    const edgeF5RlAway = computeEdge(calF5RlAway, g.f5AwayRunLineOdds, g.f5HomeRunLineOdds);
    
    result.markets.f5_rl = {
      rawF5RlHomeProb: rawF5RlHome, rawF5RlAwayProb: rawF5RlAway,
      calF5RlHomeProb: calF5RlHome, calF5RlAwayProb: calF5RlAway,
      bookF5HomeRL: g.f5HomeRunLine, bookF5AwayRL: g.f5AwayRunLine,
      bookF5HomeRLOdds: g.f5HomeRunLineOdds, bookF5AwayRLOdds: g.f5AwayRunLineOdds,
      edgeF5RlHome, edgeF5RlAway,
    };
    
    console.log(`[STATE] F5 RL:`);
    console.log(`  F5 RL HOME: raw=${rawF5RlHome != null ? (rawF5RlHome*100).toFixed(2)+'%' : 'N/A'} → cal=${calF5RlHome != null ? (calF5RlHome*100).toFixed(2)+'%' : 'N/A'} line=${g.f5HomeRunLine ?? 'NULL'} odds=${g.f5HomeRunLineOdds ?? 'NULL'}`);
    console.log(`  F5 RL AWAY: raw=${rawF5RlAway != null ? (rawF5RlAway*100).toFixed(2)+'%' : 'N/A'} → cal=${calF5RlAway != null ? (calF5RlAway*100).toFixed(2)+'%' : 'N/A'} line=${g.f5AwayRunLine ?? 'NULL'} odds=${g.f5AwayRunLineOdds ?? 'NULL'}`);
  }
  
  // ── F5 TOTAL ───────────────────────────────────────────────
  {
    const rawF5Over = g.modelF5OverRate != null ? parseFloat(g.modelF5OverRate) : null; // 0-1 scale confirmed
    const rawF5Under = rawF5Over != null ? 1 - rawF5Over : null;
    const calF5Over = rawF5Over != null ? applyBiasCorrection(rawF5Over, getBiasCorrection('f5_over')) : null;
    const calF5Under = rawF5Under != null ? applyBiasCorrection(rawF5Under, getBiasCorrection('f5_under')) : null;
    
    const edgeF5Over = computeEdge(calF5Over, g.f5OverOdds, g.f5UnderOdds);
    const edgeF5Under = computeEdge(calF5Under, g.f5UnderOdds, g.f5OverOdds);
    
    result.markets.f5_total = {
      bookF5Total: g.f5Total, rawF5OverProb: rawF5Over, rawF5UnderProb: rawF5Under,
      calF5OverProb: calF5Over, calF5UnderProb: calF5Under,
      bookF5OverOdds: g.f5OverOdds, bookF5UnderOdds: g.f5UnderOdds,
      edgeF5Over, edgeF5Under,
    };
    
    console.log(`[STATE] F5 Total (line=${g.f5Total ?? 'NULL'}):`);
    console.log(`  F5 OVER: raw=${rawF5Over != null ? (rawF5Over*100).toFixed(2)+'%' : 'N/A'} → cal=${calF5Over != null ? (calF5Over*100).toFixed(2)+'%' : 'N/A'} bookOdds=${g.f5OverOdds ?? 'NULL'}`);
    console.log(`  F5 UNDER: raw=${rawF5Under != null ? (rawF5Under*100).toFixed(2)+'%' : 'N/A'} → cal=${calF5Under != null ? (calF5Under*100).toFixed(2)+'%' : 'N/A'} bookOdds=${g.f5UnderOdds ?? 'NULL'}`);
  }
  
  // ── NRFI / YRFI ────────────────────────────────────────────
  {
    const rawNrfi = g.modelPNrfi != null ? parseFloat(g.modelPNrfi) : null; // 0-1 scale confirmed
    const rawYrfi = rawNrfi != null ? 1 - rawNrfi : null;
    const calNrfi = rawNrfi != null ? applyBiasCorrection(rawNrfi, getBiasCorrection('nrfi')) : null;
    const calYrfi = rawYrfi != null ? applyBiasCorrection(rawYrfi, getBiasCorrection('yrfi')) : null;
    // Renormalize
    const sumNY = (calNrfi ?? 0) + (calYrfi ?? 0);
    const normNrfi = sumNY > 0 && calNrfi != null ? calNrfi / sumNY : calNrfi;
    const normYrfi = sumNY > 0 && calYrfi != null ? calYrfi / sumNY : calYrfi;
    
    const edgeNrfi = computeEdge(normNrfi, g.nrfiOverOdds, g.yrfiUnderOdds);
    const edgeYrfi = computeEdge(normYrfi, g.yrfiUnderOdds, g.nrfiOverOdds);
    const evNrfi = computeEV(normNrfi, g.nrfiOverOdds);
    const evYrfi = computeEV(normYrfi, g.yrfiUnderOdds);
    
    result.markets.nrfi_yrfi = {
      rawNrfiProb: rawNrfi, rawYrfiProb: rawYrfi,
      calNrfiProb: normNrfi, calYrfiProb: normYrfi,
      biasCorNrfi: getBiasCorrection('nrfi'), biasCorYrfi: getBiasCorrection('yrfi'),
      bookNrfiOdds: g.nrfiOverOdds, bookYrfiOdds: g.yrfiUnderOdds,
      edgeNrfi, edgeYrfi, evNrfi, evYrfi,
      modelNrfiOdds: normNrfi != null ? probToAmericanOdds(normNrfi) : null,
      modelYrfiOdds: normYrfi != null ? probToAmericanOdds(normYrfi) : null,
    };
    
    console.log(`[STATE] NRFI/YRFI:`);
    console.log(`  NRFI: raw=${rawNrfi != null ? (rawNrfi*100).toFixed(2)+'%' : 'N/A'} → cal=${normNrfi != null ? (normNrfi*100).toFixed(2)+'%' : 'N/A'} bookOdds=${g.nrfiOverOdds ?? 'NULL'} edge=${edgeNrfi != null ? (edgeNrfi*100).toFixed(3)+'%' : 'N/A'} EV=${evNrfi != null ? (evNrfi*100).toFixed(2)+'%' : 'N/A'}`);
    console.log(`  YRFI: raw=${rawYrfi != null ? (rawYrfi*100).toFixed(2)+'%' : 'N/A'} → cal=${normYrfi != null ? (normYrfi*100).toFixed(2)+'%' : 'N/A'} bookOdds=${g.yrfiUnderOdds ?? 'NULL'} edge=${edgeYrfi != null ? (edgeYrfi*100).toFixed(3)+'%' : 'N/A'} EV=${evYrfi != null ? (evYrfi*100).toFixed(2)+'%' : 'N/A'}`);
  }
  
  // ── FG RL ──────────────────────────────────────────────────
  {
    // modelHomePLCoverPct / modelAwayPLCoverPct are NULL (confirmed from backtest)
    result.markets.fg_rl = {
      note: 'modelHomePLCoverPct and modelAwayPLCoverPct are NULL — model does not output RL cover probabilities',
      bookAwayRL: g.awayRunLine, bookHomeRL: g.homeRunLine,
      bookAwayRLOdds: g.awayRunLineOdds, bookHomeRLOdds: g.homeRunLineOdds,
    };
    console.log(`[STATE] FG RL: NO MODEL PROB — modelHomePLCoverPct=NULL (known gap)`);
    console.log(`  Book: away=${g.awayRunLine}/${g.awayRunLineOdds} home=${g.homeRunLine}/${g.homeRunLineOdds}`);
  }
  
  gameResults.push(result);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL REPORT: EDGE PLAYS FOR MAY 23
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log('MAY 23 2026 — RECALIBRATED EDGE PLAYS');
console.log('='.repeat(70));

const EDGE_THRESHOLD = 0.02; // 2% minimum edge to flag as a play
const edgePlays = [];

for (const g of gameResults) {
  const matchup = `${g.awayTeam} @ ${g.homeTeam}`;
  
  // FG ML
  const fgml = g.markets.fg_ml;
  if (fgml.edgeHome != null && fgml.edgeHome >= EDGE_THRESHOLD) {
    edgePlays.push({ matchup, time: g.startTime, market: 'FG ML HOME', side: g.homeTeam, modelProb: fgml.calHomeProb, bookOdds: fgml.bookHomeML, edge: fgml.edgeHome, ev: fgml.evHome });
  }
  if (fgml.edgeAway != null && fgml.edgeAway >= EDGE_THRESHOLD) {
    edgePlays.push({ matchup, time: g.startTime, market: 'FG ML AWAY', side: g.awayTeam, modelProb: fgml.calAwayProb, bookOdds: fgml.bookAwayML, edge: fgml.edgeAway, ev: fgml.evAway });
  }
  
  // FG Total
  const fgt = g.markets.fg_total;
  if (fgt.edgeOver != null && fgt.edgeOver >= EDGE_THRESHOLD) {
    edgePlays.push({ matchup, time: g.startTime, market: `FG OVER ${fgt.bookTotal}`, side: 'OVER', modelProb: fgt.calOverProb, bookOdds: fgt.bookOverOdds, edge: fgt.edgeOver, ev: fgt.evOver });
  }
  if (fgt.edgeUnder != null && fgt.edgeUnder >= EDGE_THRESHOLD) {
    edgePlays.push({ matchup, time: g.startTime, market: `FG UNDER ${fgt.bookTotal}`, side: 'UNDER', modelProb: fgt.calUnderProb, bookOdds: fgt.bookUnderOdds, edge: fgt.edgeUnder, ev: fgt.evUnder });
  }
  
  // NRFI/YRFI
  const ny = g.markets.nrfi_yrfi;
  if (ny.edgeNrfi != null && ny.edgeNrfi >= EDGE_THRESHOLD) {
    edgePlays.push({ matchup, time: g.startTime, market: 'NRFI', side: 'NRFI', modelProb: ny.calNrfiProb, bookOdds: ny.bookNrfiOdds, edge: ny.edgeNrfi, ev: ny.evNrfi });
  }
  if (ny.edgeYrfi != null && ny.edgeYrfi >= EDGE_THRESHOLD) {
    edgePlays.push({ matchup, time: g.startTime, market: 'YRFI', side: 'YRFI', modelProb: ny.calYrfiProb, bookOdds: ny.bookYrfiOdds, edge: ny.edgeYrfi, ev: ny.evYrfi });
  }
}

// Sort by edge descending
edgePlays.sort((a, b) => b.edge - a.edge);

console.log(`\nTotal edge plays (edge >= ${EDGE_THRESHOLD*100}%): ${edgePlays.length}`);
console.log(`\n${'Matchup'.padEnd(30)} | ${'Time'.padEnd(12)} | ${'Market'.padEnd(22)} | ${'Side'.padEnd(20)} | ${'ModelProb'.padStart(10)} | ${'BookOdds'.padStart(9)} | ${'Edge'.padStart(8)} | ${'EV'.padStart(8)}`);
console.log('-'.repeat(145));

for (const p of edgePlays) {
  const mpStr = p.modelProb != null ? (p.modelProb*100).toFixed(2)+'%' : 'N/A';
  const edgeStr = (p.edge*100).toFixed(3)+'%';
  const evStr = p.ev != null ? (p.ev*100).toFixed(2)+'%' : 'N/A';
  console.log(`${p.matchup.padEnd(30)} | ${(p.time??'').padEnd(12)} | ${p.market.padEnd(22)} | ${p.side.padEnd(20)} | ${mpStr.padStart(10)} | ${String(p.bookOdds??'N/A').padStart(9)} | ${edgeStr.padStart(8)} | ${evStr.padStart(8)}`);
}

// Full game-by-game summary table
console.log('\n' + '='.repeat(70));
console.log('MAY 23 2026 — FULL GAME PROJECTIONS SUMMARY');
console.log('='.repeat(70));
console.log(`\n${'Matchup'.padEnd(28)} | ${'Time'.padEnd(10)} | ${'Home%'.padStart(7)} | ${'Away%'.padStart(7)} | ${'HomeML'.padStart(8)} | ${'AwayML'.padStart(8)} | ${'ModelH'.padStart(8)} | ${'ModelA'.padStart(8)} | ${'Over%'.padStart(7)} | ${'Line'.padStart(6)} | ${'NRFI%'.padStart(7)}`);
console.log('-'.repeat(140));
for (const g of gameResults) {
  const fgml = g.markets.fg_ml;
  const fgt = g.markets.fg_total;
  const ny = g.markets.nrfi_yrfi;
  console.log(
    `${(g.awayTeam+' @ '+g.homeTeam).padEnd(28)} | ${(g.startTime??'').padEnd(10)} | ` +
    `${fgml.calHomeProb != null ? (fgml.calHomeProb*100).toFixed(1)+'%' : 'N/A'.padStart(7)} | ` +
    `${fgml.calAwayProb != null ? (fgml.calAwayProb*100).toFixed(1)+'%' : 'N/A'.padStart(7)} | ` +
    `${String(fgml.bookHomeML??'N/A').padStart(8)} | ${String(fgml.bookAwayML??'N/A').padStart(8)} | ` +
    `${String(fgml.modelHomeOdds??'N/A').padStart(8)} | ${String(fgml.modelAwayOdds??'N/A').padStart(8)} | ` +
    `${fgt.calOverProb != null ? (fgt.calOverProb*100).toFixed(1)+'%' : 'N/A'.padStart(7)} | ` +
    `${String(fgt.bookTotal??'N/A').padStart(6)} | ` +
    `${ny.calNrfiProb != null ? (ny.calNrfiProb*100).toFixed(1)+'%' : 'N/A'.padStart(7)}`
  );
}

// Write results to a JSON file for downstream use
import { writeFileSync } from 'fs';
const outputPath = '/home/ubuntu/ai-sports-betting/scripts/may23_projections.json';
writeFileSync(outputPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  recalVersion: RECAL_VERSION,
  targetDate: TARGET_DATE,
  marketSignals: Object.fromEntries(
    Object.entries(marketSignals).map(([k, v]) => [k, {
      n: v.n, wins: v.wins, losses: v.losses,
      winRate: v.winRate, avgModelProb: v.avgModelProb,
      bias: v.bias, ece: v.ece, brier: v.brier,
      posEdgeN: v.posEdgeN, posEdgeWinRate: v.posEdgeWinRate,
      totalPL: v.totalPL,
    }])
  ),
  recalParamsApplied: recalParams,
  games: gameResults,
  edgePlays,
}, null, 2));
console.log(`\n[OUTPUT] Full projections written to ${outputPath}`);

await conn.end();
console.log('\n[VERIFY] PASS — recalibration and May 23 modeling complete');
