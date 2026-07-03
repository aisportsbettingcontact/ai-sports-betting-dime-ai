/**
 * wc_june19_backtest_v2.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-run June 19 backtest with corrected scores.
 * Compute cumulative accuracy across all 3 tournaments (2018, 2022, 2026).
 * Generate recalibration signals.
 *
 * Logging: [WC_BT] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_BT]';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} JUNE 19 BACKTEST RE-RUN + CUMULATIVE ACCURACY ANALYSIS`);
console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
console.log(`${TAG} ================================================================\n`);

// ─── Step 1: Pull June 19 model projections ───────────────────────────────────
console.log(`${TAG} [STEP 1] Pulling June 19 model projections from wc2026_model_projections...`);
const [projRows] = await conn.query(`
  SELECT p.*, 
         f.home_score, f.away_score,
         ht.name as home_team_name, ht.fifa_code as home_code,
         at.name as away_team_name, at.fifa_code as away_code
  FROM wc2026_model_projections p
  JOIN wc2026_matches f ON f.match_id = p.match_id
  JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
  JOIN wc2026_teams at ON at.team_id = f.away_team_id
  WHERE f.match_date = '2026-06-19'
  ORDER BY f.kickoff_utc
`);

console.log(`${TAG} [INPUT] June 19 projections: ${projRows.length}`);

if (projRows.length === 0) {
  console.log(`${TAG} [WARN] No June 19 projections found — checking wc_bt_projections...`);
  const [btProj] = await conn.query(`
    SELECT p.*, m.home_score, m.away_score, m.home_team, m.away_team
    FROM wc_bt_projections p
    JOIN wc_bt_matches m ON m.id = p.match_id
    WHERE m.match_date = '2026-06-19' AND p.tournament_year = 2026
  `);
  console.log(`${TAG} [STATE] wc_bt_projections June 19: ${btProj.length}`);
  for (const r of btProj) {
    console.log(`${TAG}   ${r.match_id}: ${r.home_team} vs ${r.away_team} | model_lean=${r.model_lean} actual=${r.actual_result}`);
  }
}

// ─── Step 2: Compute June 19 results ─────────────────────────────────────────
console.log(`\n${TAG} [STEP 2] Computing June 19 backtest results with corrected scores...`);

const june19Results = [];
for (const p of projRows) {
  const homeScore = p.home_score;
  const awayScore = p.away_score;
  
  if (homeScore === null || awayScore === null) {
    console.log(`${TAG} [WARN] ${p.match_id}: No score — skipping`);
    continue;
  }
  
  // Actual result from corrected DB
  const actualResult = homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D';
  const actualTotalGoals = homeScore + awayScore;
  
  // Model lean: highest probability outcome
  const homeWinProb = parseFloat(p.home_win_prob || 0);
  const drawProb = parseFloat(p.draw_prob || 0);
  const awayWinProb = parseFloat(p.away_win_prob || 0);
  // Use proj_total as book total if book_total_line not available
  const bookTotalFallback = parseFloat(p.proj_total || 2.5);
  
  let modelLean;
  if (homeWinProb >= drawProb && homeWinProb >= awayWinProb) modelLean = 'H';
  else if (awayWinProb >= drawProb && awayWinProb >= homeWinProb) modelLean = 'A';
  else modelLean = 'D';
  
  // Model total lean
  const modelExpectedGoals = parseFloat(p.proj_home_score || 0) + parseFloat(p.proj_away_score || 0);
  // Pull book total from book_odds JSON if available, else use proj_total
  let bookTotal = 2.5;
  try {
    const bookOdds = typeof p.book_odds === 'string' ? JSON.parse(p.book_odds) : (p.book_odds || {});
    if (bookOdds.total_line) bookTotal = parseFloat(bookOdds.total_line);
    else if (bookOdds.overLine) bookTotal = parseFloat(bookOdds.overLine);
  } catch(e) { bookTotal = 2.5; }
  const modelTotalLean = modelExpectedGoals > bookTotal ? 'OVER' : 'UNDER';
  const actualTotalResult = actualTotalGoals > bookTotal ? 'OVER' : actualTotalGoals < bookTotal ? 'UNDER' : 'PUSH';
  
  const mlCorrect = modelLean === actualResult;
  const totalCorrect = modelTotalLean === actualTotalResult;
  
  // Model ML odds
  const modelHomeML = p.model_home_ml ? parseInt(p.model_home_ml) : null;
  const modelAwayML = p.model_away_ml ? parseInt(p.model_away_ml) : null;
  // Pull book ML from book_odds JSON
  let bookHomeML = null, bookAwayML = null;
  try {
    const bookOdds = typeof p.book_odds === 'string' ? JSON.parse(p.book_odds) : (p.book_odds || {});
    bookHomeML = bookOdds.home ? parseInt(bookOdds.home) : null;
    bookAwayML = bookOdds.away ? parseInt(bookOdds.away) : null;
  } catch(e) {}
  
  // Edge detection: model vs book
  function mlToProb(ml) {
    if (!ml) return null;
    return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
  }
  
  const modelHomeProb = mlToProb(modelHomeML);
  const bookHomeProb = mlToProb(bookHomeML);
  const hasEdge = modelHomeProb && bookHomeProb && Math.abs(modelHomeProb - bookHomeProb) > 0.03;
  
  const result = {
    matchId: p.match_id,
    homeTeam: p.home_team_name,
    awayTeam: p.away_team_name,
    homeCode: p.home_code,
    awayCode: p.away_code,
    homeScore,
    awayScore,
    actualResult,
    actualTotalGoals,
    modelLean,
    modelTotalLean,
    actualTotalResult,
    mlCorrect,
    totalCorrect,
    homeWinProb: (homeWinProb * 100).toFixed(1),
    drawProb: (drawProb * 100).toFixed(1),
    awayWinProb: (awayWinProb * 100).toFixed(1),
    modelExpectedGoals: modelExpectedGoals.toFixed(2),
    bookTotal,
    modelHomeML,
    modelAwayML,
    bookHomeML,
    bookAwayML,
    hasEdge,
  };
  
  june19Results.push(result);
  
  const mlIcon = mlCorrect ? '✅' : '❌';
  const totIcon = totalCorrect ? '✅' : '❌';
  console.log(`${TAG} [STATE] ${p.home_team_name} vs ${p.away_team_name}:`);
  console.log(`${TAG}   Score: ${homeScore}-${awayScore} | Actual: ${actualResult} | ModelLean: ${modelLean} | ML: ${mlIcon}`);
  console.log(`${TAG}   Goals: ${actualTotalGoals} | ExpGoals: ${modelExpectedGoals} | BookTotal: ${bookTotal} | ModelLean: ${modelTotalLean} | Actual: ${actualTotalResult} | Total: ${totIcon}`);
  console.log(`${TAG}   Probs: H=${result.homeWinProb}% D=${result.drawProb}% A=${result.awayWinProb}%`);
}

// ─── Step 3: June 19 summary ──────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 3] June 19 Summary:`);
const j19ML = june19Results.filter(r => r.mlCorrect).length;
const j19Total = june19Results.filter(r => r.totalCorrect).length;
const j19N = june19Results.length;
console.log(`${TAG} June 19 ML: ${j19ML}/${j19N} = ${(j19ML/j19N*100).toFixed(1)}%`);
console.log(`${TAG} June 19 Total: ${j19Total}/${j19N} = ${(j19Total/j19N*100).toFixed(1)}%`);

// ─── Step 4: Cumulative accuracy across all 3 tournaments ────────────────────
console.log(`\n${TAG} [STEP 4] Computing cumulative accuracy across all tournaments...`);

// Pull all wc_bt_projections with actual results
const [allProj] = await conn.query(`
  SELECT p.tournament_year, p.match_id, p.model_lean, p.actual_result,
         p.market_lean as model_total_lean, p.model_correct_result, p.model_correct_total,
         p.model_home_win_prob as home_win_prob, p.model_draw_prob as draw_prob, p.model_away_win_prob as away_win_prob,
         m.home_team, m.away_team, m.home_score, m.away_score, m.match_date
  FROM wc_bt_projections p
  JOIN wc_bt_matches m ON m.id = p.match_id
  WHERE p.actual_result IS NOT NULL
  ORDER BY p.tournament_year, m.match_date
`);

console.log(`${TAG} [INPUT] Total projections with results: ${allProj.length}`);

// Group by tournament
const byYear = { 2018: [], 2022: [], 2026: [] };
for (const p of allProj) {
  const yr = p.tournament_year;
  if (byYear[yr]) byYear[yr].push(p);
}

// Also add June 19 results from wc2026_model_projections (if not already in wc_bt_projections)
// First check what June 19 matches are in wc_bt_projections
const [june19BtProj] = await conn.query(`
  SELECT p.match_id FROM wc_bt_projections p
  JOIN wc_bt_matches m ON m.id = p.match_id
  WHERE m.match_date = '2026-06-19' AND p.tournament_year = 2026
`);
const june19BtIds = new Set(june19BtProj.map(r => r.match_id));
console.log(`${TAG} [STATE] June 19 in wc_bt_projections: ${june19BtIds.size}`);

// Upsert June 19 results into wc_bt_projections
for (const r of june19Results) {
  const matchId = r.matchId; // wc26-g-029 etc
  const modelTotalLean = r.modelTotalLean;
  const actualTotalResult = r.actualTotalResult === 'PUSH' ? 'PUSH' : r.actualTotalResult;
  const totalCorrect = r.totalCorrect ? 1 : 0;
  const mlCorrect = r.mlCorrect ? 1 : 0;
  
  if (june19BtIds.has(matchId)) {
    // Update existing
    await conn.query(`
      UPDATE wc_bt_projections SET
        actual_result = ?,
        actual_total_goals = ?,
        model_correct_result = ?,
        model_correct_total = ?
      WHERE match_id = ? AND tournament_year = 2026
    `, [r.actualResult, r.actualTotalGoals, mlCorrect, totalCorrect, matchId]);
    console.log(`${TAG} [FIX] Updated wc_bt_projections ${matchId}: actual=${r.actualResult} total=${r.actualTotalGoals}`);
  } else {
    // Insert new
    await conn.query(`
      INSERT INTO wc_bt_projections (
        match_id, tournament_year, model_lean, actual_result,
        actual_total_goals, model_correct_result, model_correct_total,
        model_home_win_prob, model_draw_prob, model_away_win_prob,
        market_total_line, market_lean,
        created_at
      ) VALUES (?, 2026, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        actual_result = VALUES(actual_result),
        actual_total_goals = VALUES(actual_total_goals),
        model_correct_result = VALUES(model_correct_result),
        model_correct_total = VALUES(model_correct_total),
        created_at = NOW()
    `, [
      matchId, r.modelLean, r.actualResult,
      r.actualTotalGoals, mlCorrect, totalCorrect,
      parseFloat(r.homeWinProb)/100, parseFloat(r.drawProb)/100, parseFloat(r.awayWinProb)/100,
      bookTotal, modelTotalLean
    ]);
    console.log(`${TAG} [FIX] Inserted wc_bt_projections ${matchId}: actual=${r.actualResult} total=${r.actualTotalGoals}`);
  }
}

// Re-pull all projections after upsert
  const [allProjFinal] = await conn.query(`
  SELECT p.tournament_year, p.match_id, p.model_lean, p.actual_result,
         p.market_lean as model_total_lean, p.model_correct_result, p.model_correct_total,
         p.model_home_win_prob as home_win_prob, p.model_draw_prob as draw_prob, p.model_away_win_prob as away_win_prob,
         m.home_team, m.away_team, m.home_score, m.away_score, m.match_date
  FROM wc_bt_projections p
  JOIN wc_bt_matches m ON m.id = p.match_id
  WHERE p.actual_result IS NOT NULL
  ORDER BY p.tournament_year, m.match_date
`);

const byYearFinal = { 2018: [], 2022: [], 2026: [] };
for (const p of allProjFinal) {
  const yr = p.tournament_year;
  if (byYearFinal[yr]) byYearFinal[yr].push(p);
}

// ─── Step 5: Accuracy metrics ─────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 5] Accuracy Metrics:`);
console.log(`${TAG} ================================================================`);

let totalML = 0, correctML = 0;
let totalTot = 0, correctTot = 0;
let totalDraw = 0, correctDraw = 0;
let actualDraws = 0, modelDraws = 0;

for (const [year, rows] of Object.entries(byYearFinal)) {
  if (rows.length === 0) continue;
  
  const mlCorrectCount = rows.filter(r => r.model_correct_result === 1 || r.model_lean === r.actual_result).length;
  const totCorrectCount = rows.filter(r => r.model_correct_total === 1).length;
  const drawsActual = rows.filter(r => r.actual_result === 'D').length;
  const drawsModel = rows.filter(r => r.model_lean === 'D').length;
  
  totalML += rows.length;
  correctML += mlCorrectCount;
  totalTot += rows.length;
  correctTot += totCorrectCount;
  actualDraws += drawsActual;
  modelDraws += drawsModel;
  
  console.log(`${TAG} ${year} (${rows.length} matches):`);
  console.log(`${TAG}   ML: ${mlCorrectCount}/${rows.length} = ${(mlCorrectCount/rows.length*100).toFixed(1)}%`);
  console.log(`${TAG}   Total: ${totCorrectCount}/${rows.length} = ${(totCorrectCount/rows.length*100).toFixed(1)}%`);
  console.log(`${TAG}   Actual draws: ${drawsActual} (${(drawsActual/rows.length*100).toFixed(1)}%) | Model predicted draws: ${drawsModel} (${(drawsModel/rows.length*100).toFixed(1)}%)`);
}

console.log(`\n${TAG} CUMULATIVE (all tournaments):`);
console.log(`${TAG}   Total matches: ${totalML}`);
console.log(`${TAG}   ML Accuracy: ${correctML}/${totalML} = ${(correctML/totalML*100).toFixed(1)}% (target: 70%+)`);
console.log(`${TAG}   Total Accuracy: ${correctTot}/${totalTot} = ${(correctTot/totalTot*100).toFixed(1)}% (target: 70%+)`);
console.log(`${TAG}   Actual draw rate: ${actualDraws}/${totalML} = ${(actualDraws/totalML*100).toFixed(1)}%`);
console.log(`${TAG}   Model draw rate: ${modelDraws}/${totalML} = ${(modelDraws/totalML*100).toFixed(1)}%`);

// ─── Step 6: Recalibration signals ───────────────────────────────────────────
console.log(`\n${TAG} [STEP 6] Recalibration Signals:`);
console.log(`${TAG} ================================================================`);

const drawRateDelta = (actualDraws/totalML) - (modelDraws/totalML);
const mlAccuracy = correctML/totalML;
const totAccuracy = correctTot/totalTot;

console.log(`${TAG} Draw rate delta: actual=${(actualDraws/totalML*100).toFixed(1)}% model=${(modelDraws/totalML*100).toFixed(1)}% → delta=${(drawRateDelta*100).toFixed(1)}%`);

if (drawRateDelta > 0.03) {
  console.log(`${TAG} [SIGNAL] DRAW UNDERESTIMATION: Model predicts draws at ${(modelDraws/totalML*100).toFixed(1)}% but actual rate is ${(actualDraws/totalML*100).toFixed(1)}%`);
  console.log(`${TAG}   → Increase draw probability floor by ${(drawRateDelta*100).toFixed(1)}pp`);
  console.log(`${TAG}   → Recommended: draw_floor += ${(drawRateDelta * 0.8).toFixed(3)}`);
}

if (mlAccuracy < 0.60) {
  console.log(`${TAG} [SIGNAL] ML ACCURACY BELOW TARGET: ${(mlAccuracy*100).toFixed(1)}% < 60%`);
  console.log(`${TAG}   → Review FIFA rank weight and home advantage multiplier`);
  console.log(`${TAG}   → Consider reducing heavy-favorite win probability by 3-5% for rank_diff > 40`);
}

if (totAccuracy < 0.65) {
  console.log(`${TAG} [SIGNAL] TOTAL ACCURACY BELOW TARGET: ${(totAccuracy*100).toFixed(1)}% < 65%`);
  console.log(`${TAG}   → Review lambda multiplier — model may be underestimating 2026 goal pace`);
}

// Analyze upset patterns
const upsets2026 = byYearFinal[2026].filter(r => {
  // Upset = model predicted heavy favorite but wrong
  const homeProb = parseFloat(r.home_win_prob || 0);
  const awayProb = parseFloat(r.away_win_prob || 0);
  const maxProb = Math.max(homeProb, awayProb);
  return maxProb > 0.55 && r.model_lean !== r.actual_result;
});

console.log(`\n${TAG} 2026 Upsets (model >55% confident but wrong): ${upsets2026.length}`);
for (const u of upsets2026) {
  console.log(`${TAG}   ${u.match_date}: ${u.home_team} vs ${u.away_team} | ModelLean=${u.model_lean} Actual=${u.actual_result} | H=${(parseFloat(u.home_win_prob||0)*100).toFixed(1)}% A=${(parseFloat(u.away_win_prob||0)*100).toFixed(1)}%`);
}

// ─── Step 7: Write batch result to DB ────────────────────────────────────────
console.log(`\n${TAG} [STEP 7] Writing batch result to wc_bt_batch_results...`);
await conn.query(`
  INSERT INTO wc_bt_batch_results (
    batch_name, tournament_year, n_matches, ml_accuracy, total_accuracy,
    draw_rate_actual, draw_rate_model, n_upsets, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    ml_accuracy = VALUES(ml_accuracy),
    total_accuracy = VALUES(total_accuracy),
    draw_rate_actual = VALUES(draw_rate_actual),
    draw_rate_model = VALUES(draw_rate_model),
    n_upsets = VALUES(n_upsets),
    created_at = NOW()
`, [
  'june19_corrected_rerun', 2026, june19Results.length,
  j19ML/j19N, j19Total/j19N,
  actualDraws/totalML, modelDraws/totalML,
  upsets2026.length
]).catch(() => {
  // Table may not have all columns — log and continue
  console.log(`${TAG} [WARN] Could not write to wc_bt_batch_results — schema mismatch, continuing`);
});

console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} BACKTEST RE-RUN COMPLETE`);
console.log(`${TAG} June 19: ML=${j19ML}/${j19N} Total=${j19Total}/${j19N}`);
console.log(`${TAG} Cumulative: ML=${correctML}/${totalML}=${(correctML/totalML*100).toFixed(1)}% Total=${correctTot}/${totalTot}=${(correctTot/totalTot*100).toFixed(1)}%`);
console.log(`${TAG} ================================================================\n`);

await conn.end();
