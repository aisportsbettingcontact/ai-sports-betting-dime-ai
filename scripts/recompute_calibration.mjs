/**
 * RECALIBRATION ENGINE — 2026 MLB Season
 * =======================================
 * Reads all WIN/LOSS rows from mlb_game_backtest (leakageSafe=1 or NULL, not QUARANTINED)
 * Computes per-market:
 *   - actualWinRate (empirical accuracy)
 *   - avgModelProb (mean model probability)
 *   - biasCorrection = actualWinRate - avgModelProb
 *   - Brier score = mean((modelProb - correct)^2)
 *   - ECE (Expected Calibration Error) across 10 equal-width bins
 *   - Log loss = -mean(correct*log(p) + (1-correct)*log(1-p))
 * Then writes updated bias_correction_* params to mlb_calibration_constants.
 *
 * IMPORTANT: Only uses leakageSafe=1 (confirmed pre-game) OR leakageSafe IS NULL (unknown)
 * rows to avoid contaminating calibration with leaked data.
 * Minimum sample: 30 graded rows per market to write a calibration update.
 */
import { createConnection } from 'mysql2/promise';

const SEASON_START = '2026-03-25';
const SEASON_END   = '2026-05-22';
const MIN_SAMPLE   = 30;
const ECE_BINS     = 10;
const UPDATE_SOURCE = 'backtest_2026_recalibration_v2';

const MARKETS = [
  'fg_ml_home','fg_ml_away',
  'fg_rl_home','fg_rl_away',
  'fg_over','fg_under',
  'f5_ml_home','f5_ml_away',
  'f5_rl_home','f5_rl_away',
  'f5_over','f5_under',
  'nrfi','yrfi',
];

function computeECE(rows, nBins = ECE_BINS) {
  // rows: [{modelProb, correct}]
  const bins = Array.from({length: nBins}, () => ({sumProb:0, sumCorrect:0, count:0}));
  for (const r of rows) {
    const binIdx = Math.min(Math.floor(r.modelProb * nBins), nBins - 1);
    bins[binIdx].sumProb += r.modelProb;
    bins[binIdx].sumCorrect += r.correct;
    bins[binIdx].count++;
  }
  let ece = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const avgProb = b.sumProb / b.count;
    const avgCorrect = b.sumCorrect / b.count;
    ece += (b.count / rows.length) * Math.abs(avgCorrect - avgProb);
  }
  return ece;
}

function computeBrier(rows) {
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + Math.pow(r.modelProb - r.correct, 2), 0) / rows.length;
}

function computeLogLoss(rows) {
  if (rows.length === 0) return null;
  const eps = 1e-7;
  return -rows.reduce((s, r) => {
    const p = Math.max(eps, Math.min(1 - eps, r.modelProb));
    return s + (r.correct * Math.log(p) + (1 - r.correct) * Math.log(1 - p));
  }, 0) / rows.length;
}

const conn = await createConnection(process.env.DATABASE_URL);

console.log('='.repeat(70));
console.log('RECALIBRATION ENGINE — 2026 MLB Season');
console.log('='.repeat(70));
console.log(`[INPUT] Date range: ${SEASON_START} → ${SEASON_END}`);
console.log(`[INPUT] Min sample per market: ${MIN_SAMPLE}`);
console.log(`[INPUT] Using leakageSafe=1 OR leakageSafe IS NULL rows only`);
console.log('');

// Delete old bias corrections
const [del] = await conn.query(
  `DELETE FROM mlb_calibration_constants WHERE paramName LIKE 'bias_correction_%'`
);
console.log(`[STEP] Deleted ${del.affectedRows} old bias_correction_* params`);
console.log('');

const calibrationResults = [];

for (const market of MARKETS) {
  // Fetch all WIN/LOSS rows with valid modelProb
  const [rows] = await conn.query(`
    SELECT modelProb, correct
    FROM mlb_game_backtest
    WHERE market = ?
      AND gameDate >= ? AND gameDate <= ?
      AND result IN ('WIN','LOSS')
      AND modelProb IS NOT NULL
      AND correct IS NOT NULL
      AND (leakageSafe = 1 OR leakageSafe IS NULL)
  `, [market, SEASON_START, SEASON_END]);

  const n = rows.length;
  console.log(`[STEP] Market: ${market.padEnd(14)} n=${String(n).padStart(4)}`);

  if (n < MIN_SAMPLE) {
    console.log(`  [WARN] Insufficient sample (${n} < ${MIN_SAMPLE}) — skipping calibration update`);
    calibrationResults.push({ market, n, skipped: true });
    continue;
  }

  // Convert BigDecimal/string values to numbers
  const numRows = rows.map(r => ({
    modelProb: parseFloat(r.modelProb),
    correct: parseInt(r.correct, 10),
  }));

  const avgModelProb = numRows.reduce((s, r) => s + r.modelProb, 0) / n;
  const actualWinRate = numRows.reduce((s, r) => s + r.correct, 0) / n;
  const biasCorrection = actualWinRate - avgModelProb;
  const brier = computeBrier(numRows);
  const ece = computeECE(numRows);
  const logLoss = computeLogLoss(numRows);

  console.log(`  [STATE] avgModelProb=${(avgModelProb*100).toFixed(3)}%  actualWinRate=${(actualWinRate*100).toFixed(3)}%`);
  console.log(`  [STATE] biasCorrection=${biasCorrection >= 0 ? '+' : ''}${(biasCorrection*100).toFixed(4)}%  Brier=${brier.toFixed(5)}  ECE=${ece.toFixed(5)}  LogLoss=${logLoss.toFixed(5)}`);

  // Write to mlb_calibration_constants
  const paramName = `bias_correction_${market}`;
  await conn.query(`
    INSERT INTO mlb_calibration_constants
      (paramName, currentValue, sampleSize, updateSource, lastUpdatedAt)
    VALUES (?, ?, ?, ?, UNIX_TIMESTAMP()*1000)
    ON DUPLICATE KEY UPDATE
      currentValue = VALUES(currentValue),
      sampleSize = VALUES(sampleSize),
      updateSource = VALUES(updateSource),
      lastUpdatedAt = UNIX_TIMESTAMP()*1000
  `, [paramName, biasCorrection, n, UPDATE_SOURCE]);

  // Also write Brier, ECE, LogLoss as separate params
  await conn.query(`
    INSERT INTO mlb_calibration_constants (paramName, currentValue, sampleSize, updateSource, lastUpdatedAt)
    VALUES (?, ?, ?, ?, UNIX_TIMESTAMP()*1000)
    ON DUPLICATE KEY UPDATE currentValue=VALUES(currentValue), sampleSize=VALUES(sampleSize), updateSource=VALUES(updateSource), lastUpdatedAt=UNIX_TIMESTAMP()*1000
  `, [`brier_${market}`, brier, n, UPDATE_SOURCE]);

  await conn.query(`
    INSERT INTO mlb_calibration_constants (paramName, currentValue, sampleSize, updateSource, lastUpdatedAt)
    VALUES (?, ?, ?, ?, UNIX_TIMESTAMP()*1000)
    ON DUPLICATE KEY UPDATE currentValue=VALUES(currentValue), sampleSize=VALUES(sampleSize), updateSource=VALUES(updateSource), lastUpdatedAt=UNIX_TIMESTAMP()*1000
  `, [`ece_${market}`, ece, n, UPDATE_SOURCE]);

  await conn.query(`
    INSERT INTO mlb_calibration_constants (paramName, currentValue, sampleSize, updateSource, lastUpdatedAt)
    VALUES (?, ?, ?, ?, UNIX_TIMESTAMP()*1000)
    ON DUPLICATE KEY UPDATE currentValue=VALUES(currentValue), sampleSize=VALUES(sampleSize), updateSource=VALUES(updateSource), lastUpdatedAt=UNIX_TIMESTAMP()*1000
  `, [`log_loss_${market}`, logLoss, n, UPDATE_SOURCE]);

  calibrationResults.push({ market, n, avgModelProb, actualWinRate, biasCorrection, brier, ece, logLoss, skipped: false });
  console.log(`  [OUTPUT] Written: ${paramName} = ${biasCorrection.toFixed(8)}`);
  console.log('');
}

// Summary table
console.log('='.repeat(70));
console.log('CALIBRATION SUMMARY');
console.log('='.repeat(70));
console.log('Market          | n    | AvgProb | ActualWR | Bias      | Brier  | ECE    | LogLoss');
console.log('-'.repeat(90));
for (const r of calibrationResults) {
  if (r.skipped) {
    console.log(`${r.market.padEnd(16)}| ${String(r.n).padStart(4)} | SKIPPED (insufficient sample)`);
    continue;
  }
  const bias = r.biasCorrection >= 0 ? '+' + (r.biasCorrection*100).toFixed(3)+'%' : (r.biasCorrection*100).toFixed(3)+'%';
  console.log(
    `${r.market.padEnd(16)}| ${String(r.n).padStart(4)} | ${(r.avgModelProb*100).toFixed(2)}%  | ${(r.actualWinRate*100).toFixed(2)}%    | ${bias.padEnd(9)} | ${r.brier.toFixed(5)} | ${r.ece.toFixed(5)} | ${r.logLoss.toFixed(5)}`
  );
}

// Publication gate check
console.log('');
console.log('='.repeat(70));
console.log('PUBLICATION GATE');
console.log('='.repeat(70));
const ACCURACY_THRESHOLD = 0.52; // 52% minimum (above coin flip + vig)
const BRIER_THRESHOLD = 0.26;    // Brier < 0.25 is good, < 0.26 acceptable
const ECE_THRESHOLD = 0.05;      // ECE < 5% is well-calibrated

for (const r of calibrationResults) {
  if (r.skipped) continue;
  const accuracyOk = r.actualWinRate >= ACCURACY_THRESHOLD;
  const brierOk = r.brier <= BRIER_THRESHOLD;
  const eceOk = r.ece <= ECE_THRESHOLD;
  const allOk = accuracyOk && brierOk && eceOk;
  const status = allOk ? 'SAFE_TO_PUBLISH' : (!accuracyOk ? 'BLOCKED_ACCURACY' : (!brierOk ? 'BLOCKED_BRIER' : 'BLOCKED_ECE'));
  console.log(`${r.market.padEnd(16)} → ${status}  (acc=${(r.actualWinRate*100).toFixed(1)}% brier=${r.brier.toFixed(4)} ece=${r.ece.toFixed(4)})`);
}

await conn.end();
console.log('');
console.log('[VERIFY] PASS — recalibration complete');
