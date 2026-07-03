/**
 * wc_june20_backtest_full132.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * MASTER EXECUTION ENGINE — June 21, 2026
 *
 * Phase 1: Populate wc_bt_matches for June 20 matches (wc26-g-033 through wc26-g-036)
 * Phase 2: Populate wc_bt_projections for June 20 from wc2026_model_projections
 * Phase 3: Run full 132-match backtest (2018: 48 + 2022: 48 + 2026: 36)
 * Phase 4: Advanced recalibration signals
 * Phase 5: Write batch result to wc_bt_batch_results
 *
 * Logging: [WC_BT_132] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_BT_132]';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} JUNE 20 BACKTEST POPULATION + FULL 132-MATCH BACKTEST`);
console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
console.log(`${TAG} ================================================================\n`);

// ─── PHASE 1: Populate wc_bt_matches for June 20 ─────────────────────────────
console.log(`${TAG} [STEP 1] Populating wc_bt_matches for June 20 matches...`);

// Pull June 20 matches from wc2026_matches
const [june20Matchs] = await conn.query(`
  SELECT f.match_id, f.home_score, f.away_score, f.status,
         f.kickoff_utc, f.attendance,
         ht.name as home_name, ht.fifa_code as home_code,
         at2.name as away_name, at2.fifa_code as away_code,
         f.group_letter, f.matchday, f.match_date
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
  WHERE f.match_id IN ('wc26-g-033','wc26-g-034','wc26-g-035','wc26-g-036')
  ORDER BY f.kickoff_utc
`);

console.log(`${TAG} [INPUT] June 20 matches: ${june20Matchs.length}`);

for (const f of june20Matchs) {
  const result = f.home_score > f.away_score ? 'H' : f.home_score < f.away_score ? 'A' : 'D';
  const totalGoals = (f.home_score || 0) + (f.away_score || 0);
  // Use match_date from DB (stored as June 20 per business rule for late kickoffs)
  const matchDate = f.match_date ? new Date(f.match_date).toISOString().slice(0, 10) : '2026-06-20';
  
  console.log(`${TAG} [STATE] Upserting ${f.match_id}: ${f.home_name} ${f.home_score}-${f.away_score} ${f.away_name} result=${result}`);
  
  await conn.query(`
    INSERT INTO wc_bt_matches (
      id, tournament_year, stage, group_letter, matchday,
      match_date, kickoff_utc, home_team, away_team,
      home_score, away_score, result, total_goals,
      venue, city, country, attendance,
      source, source_match_id, ingested_at, updated_at
    ) VALUES (?, 2026, 'group', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wc2026_matches', ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      home_score = VALUES(home_score),
      away_score = VALUES(away_score),
      result = VALUES(result),
      total_goals = VALUES(total_goals),
      attendance = VALUES(attendance),
      updated_at = NOW()
  `, [
    f.match_id,
    f.group_letter || null,
    f.matchday || null,
    matchDate,
    f.kickoff_utc || null,
    f.home_name,
    f.away_name,
    f.home_score,
    f.away_score,
    result,
    totalGoals,
    null,  // venue
    null,  // city
    null,  // country
    f.attendance || null,
    f.match_id
  ]);
  
  console.log(`${TAG} [OUTPUT] wc_bt_matches upserted: ${f.match_id} ✅`);
}

// Verify wc_bt_matches 2026 count
const [btCnt] = await conn.query(`
  SELECT COUNT(*) as cnt FROM wc_bt_matches WHERE tournament_year = 2026
`);
console.log(`${TAG} [VERIFY] wc_bt_matches 2026 count: ${btCnt[0].cnt} (expected: 36)`);

// ─── PHASE 2: Populate wc_bt_projections for June 20 ─────────────────────────
console.log(`\n${TAG} [STEP 2] Populating wc_bt_projections for June 20...`);

const [june20Proj] = await conn.query(`
  SELECT p.*, 
         f.home_score, f.away_score,
         ht.name as home_team_name, ht.fifa_code as home_code,
         at2.name as away_team_name, at2.fifa_code as away_code
  FROM wc2026_model_projections p
  JOIN wc2026_matches f ON f.match_id = p.match_id
  JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
  JOIN wc2026_teams at2 ON at2.team_id = f.away_team_id
  WHERE p.match_id IN ('wc26-g-033','wc26-g-034','wc26-g-035','wc26-g-036')
  ORDER BY f.kickoff_utc
`);

console.log(`${TAG} [INPUT] June 20 projections found: ${june20Proj.length}`);

const june20Results = [];

for (const p of june20Proj) {
  const homeScore = p.home_score;
  const awayScore = p.away_score;
  
  if (homeScore === null || awayScore === null) {
    console.log(`${TAG} [WARN] ${p.match_id}: No score — skipping`);
    continue;
  }
  
  const actualResult = homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D';
  const actualTotalGoals = homeScore + awayScore;
  
  const homeWinProb = parseFloat(p.home_win_prob || 0);
  const drawProb = parseFloat(p.draw_prob || 0);
  const awayWinProb = parseFloat(p.away_win_prob || 0);
  
  let modelLean;
  if (homeWinProb >= drawProb && homeWinProb >= awayWinProb) modelLean = 'H';
  else if (awayWinProb >= drawProb && awayWinProb >= homeWinProb) modelLean = 'A';
  else modelLean = 'D';
  
  const modelExpectedGoals = parseFloat(p.proj_home_score || 0) + parseFloat(p.proj_away_score || 0);
  
  let bookTotal = 2.5;
  try {
    const bookOdds = typeof p.book_odds === 'string' ? JSON.parse(p.book_odds) : (p.book_odds || {});
    if (bookOdds.total_line) bookTotal = parseFloat(bookOdds.total_line);
    else if (bookOdds.overLine) bookTotal = parseFloat(bookOdds.overLine);
    else if (p.proj_total) bookTotal = parseFloat(p.proj_total);
  } catch(e) { bookTotal = p.proj_total ? parseFloat(p.proj_total) : 2.5; }
  
  const modelTotalLean = modelExpectedGoals > bookTotal ? 'OVER' : 'UNDER';
  const actualTotalResult = actualTotalGoals > bookTotal ? 'OVER' : actualTotalGoals < bookTotal ? 'UNDER' : 'PUSH';
  
  const mlCorrect = modelLean === actualResult;
  const totalCorrect = modelTotalLean === actualTotalResult;
  
  const mlIcon = mlCorrect ? '✅' : '❌';
  const totIcon = totalCorrect ? '✅' : '❌';
  
  console.log(`${TAG} [STATE] ${p.home_team_name} vs ${p.away_team_name}:`);
  console.log(`${TAG}   Score: ${homeScore}-${awayScore} | Actual: ${actualResult} | ModelLean: ${modelLean} | ML: ${mlIcon}`);
  console.log(`${TAG}   Goals: ${actualTotalGoals} | ExpGoals: ${modelExpectedGoals.toFixed(2)} | BookTotal: ${bookTotal} | ModelLean: ${modelTotalLean} | Actual: ${actualTotalResult} | Total: ${totIcon}`);
  console.log(`${TAG}   Probs: H=${(homeWinProb*100).toFixed(1)}% D=${(drawProb*100).toFixed(1)}% A=${(awayWinProb*100).toFixed(1)}%`);
  
  june20Results.push({
    matchId: p.match_id,
    homeTeam: p.home_team_name,
    awayTeam: p.away_team_name,
    homeScore, awayScore,
    actualResult, actualTotalGoals,
    modelLean, modelTotalLean, actualTotalResult,
    mlCorrect, totalCorrect,
    homeWinProb, drawProb, awayWinProb,
    modelExpectedGoals, bookTotal,
  });
  
  // Upsert into wc_bt_projections
  await conn.query(`
    INSERT INTO wc_bt_projections (
      match_id, tournament_year, model_version, model_lean, actual_result,
      actual_total_goals, model_correct_result, model_correct_total,
      model_home_win_prob, model_draw_prob, model_away_win_prob,
      market_total_line, market_lean,
      created_at
    ) VALUES (?, 2026, 'v5.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      actual_result = VALUES(actual_result),
      actual_total_goals = VALUES(actual_total_goals),
      model_correct_result = VALUES(model_correct_result),
      model_correct_total = VALUES(model_correct_total),
      model_lean = VALUES(model_lean),
      model_version = VALUES(model_version),
      created_at = NOW()
  `, [
    p.match_id, modelLean, actualResult,
    actualTotalGoals, mlCorrect ? 1 : 0, totalCorrect ? 1 : 0,
    homeWinProb, drawProb, awayWinProb,
    bookTotal, modelTotalLean
  ]);
  
  console.log(`${TAG} [OUTPUT] wc_bt_projections upserted: ${p.match_id} ✅`);
}

// June 20 summary
const j20ML = june20Results.filter(r => r.mlCorrect).length;
const j20Total = june20Results.filter(r => r.totalCorrect).length;
const j20N = june20Results.length;
console.log(`\n${TAG} [STEP 2 SUMMARY] June 20:`);
console.log(`${TAG}   ML: ${j20ML}/${j20N} = ${j20N > 0 ? (j20ML/j20N*100).toFixed(1) : 'N/A'}%`);
console.log(`${TAG}   Total: ${j20Total}/${j20N} = ${j20N > 0 ? (j20Total/j20N*100).toFixed(1) : 'N/A'}%`);

if (j20N < 4) {
  console.log(`${TAG} [WARN] Only ${j20N} June 20 projections found in wc2026_model_projections`);
  console.log(`${TAG} [WARN] June 20 matches may not have been modeled yet — backtest will use available data`);
}

// ─── PHASE 3: Full 132-match backtest ─────────────────────────────────────────
console.log(`\n${TAG} [STEP 3] Running full 132-match backtest (2018: 48 + 2022: 48 + 2026: 36)...`);

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

const byYear = { 2018: [], 2022: [], 2026: [] };
for (const p of allProj) {
  const yr = p.tournament_year;
  if (byYear[yr]) byYear[yr].push(p);
}

console.log(`${TAG} [STATE] By year: 2018=${byYear[2018].length} 2022=${byYear[2022].length} 2026=${byYear[2026].length}`);

// ─── PHASE 4: Accuracy metrics + recalibration ────────────────────────────────
console.log(`\n${TAG} [STEP 4] Accuracy Metrics:`);
console.log(`${TAG} ================================================================`);

let totalML = 0, correctML = 0;
let totalTot = 0, correctTot = 0;
let totalDrawActual = 0, totalDrawModel = 0;

const yearMetrics = {};

for (const [year, rows] of Object.entries(byYear)) {
  if (rows.length === 0) continue;
  
  const mlCorrectCount = rows.filter(r => r.model_correct_result === 1 || r.model_lean === r.actual_result).length;
  const totCorrectCount = rows.filter(r => r.model_correct_total === 1).length;
  const drawsActual = rows.filter(r => r.actual_result === 'D').length;
  const drawsModel = rows.filter(r => r.model_lean === 'D').length;
  const homeWins = rows.filter(r => r.actual_result === 'H').length;
  const awayWins = rows.filter(r => r.actual_result === 'A').length;
  
  totalML += rows.length;
  correctML += mlCorrectCount;
  totalTot += rows.length;
  correctTot += totCorrectCount;
  totalDrawActual += drawsActual;
  totalDrawModel += drawsModel;
  
  yearMetrics[year] = {
    n: rows.length,
    mlAcc: mlCorrectCount / rows.length,
    totAcc: totCorrectCount / rows.length,
    drawRateActual: drawsActual / rows.length,
    drawRateModel: drawsModel / rows.length,
    homeWinRate: homeWins / rows.length,
    awayWinRate: awayWins / rows.length,
  };
  
  console.log(`${TAG} ${year} (${rows.length} matches):`);
  console.log(`${TAG}   ML: ${mlCorrectCount}/${rows.length} = ${(mlCorrectCount/rows.length*100).toFixed(1)}%`);
  console.log(`${TAG}   Total: ${totCorrectCount}/${rows.length} = ${(totCorrectCount/rows.length*100).toFixed(1)}%`);
  console.log(`${TAG}   Results: H=${homeWins}(${(homeWins/rows.length*100).toFixed(1)}%) D=${drawsActual}(${(drawsActual/rows.length*100).toFixed(1)}%) A=${awayWins}(${(awayWins/rows.length*100).toFixed(1)}%)`);
  console.log(`${TAG}   Model draws: ${drawsModel} (${(drawsModel/rows.length*100).toFixed(1)}%) vs actual ${drawsActual} (${(drawsActual/rows.length*100).toFixed(1)}%)`);
}

const cumulativeMLAcc = totalML > 0 ? correctML / totalML : 0;
const cumulativeTotAcc = totalTot > 0 ? correctTot / totalTot : 0;
const drawRateActual = totalML > 0 ? totalDrawActual / totalML : 0;
const drawRateModel = totalML > 0 ? totalDrawModel / totalML : 0;

console.log(`\n${TAG} CUMULATIVE (all tournaments):`);
console.log(`${TAG}   Total matches: ${totalML}`);
console.log(`${TAG}   ML Accuracy: ${correctML}/${totalML} = ${(cumulativeMLAcc*100).toFixed(1)}% (target: 70%+)`);
console.log(`${TAG}   Total Accuracy: ${correctTot}/${totalTot} = ${(cumulativeTotAcc*100).toFixed(1)}% (target: 70%+)`);
console.log(`${TAG}   Actual draw rate: ${totalDrawActual}/${totalML} = ${(drawRateActual*100).toFixed(1)}%`);
console.log(`${TAG}   Model draw rate: ${totalDrawModel}/${totalML} = ${(drawRateModel*100).toFixed(1)}%`);

// ─── Recalibration signals ────────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 5] Advanced Recalibration Signals:`);
console.log(`${TAG} ================================================================`);

const drawRateDelta = drawRateActual - drawRateModel;

// Signal 1: Draw underestimation
if (Math.abs(drawRateDelta) > 0.02) {
  const direction = drawRateDelta > 0 ? 'UNDERESTIMATION' : 'OVERESTIMATION';
  console.log(`${TAG} [SIGNAL] DRAW ${direction}: actual=${(drawRateActual*100).toFixed(1)}% model=${(drawRateModel*100).toFixed(1)}% delta=${(drawRateDelta*100).toFixed(1)}pp`);
  if (drawRateDelta > 0) {
    console.log(`${TAG}   → Increase draw probability floor by ${(drawRateDelta*0.8*100).toFixed(1)}pp`);
    console.log(`${TAG}   → Recommended: draw_floor += ${(drawRateDelta * 0.8).toFixed(3)}`);
  } else {
    console.log(`${TAG}   → Reduce draw probability ceiling by ${(Math.abs(drawRateDelta)*0.8*100).toFixed(1)}pp`);
  }
} else {
  console.log(`${TAG} [SIGNAL] Draw rate calibration: OK (delta=${(drawRateDelta*100).toFixed(1)}pp < 2pp threshold)`);
}

// Signal 2: ML accuracy
if (cumulativeMLAcc < 0.60) {
  console.log(`${TAG} [SIGNAL] ML ACCURACY BELOW TARGET: ${(cumulativeMLAcc*100).toFixed(1)}% < 60%`);
  console.log(`${TAG}   → Review FIFA rank weight and home advantage multiplier`);
  console.log(`${TAG}   → Consider reducing heavy-favorite win probability by 3-5% for rank_diff > 40`);
} else if (cumulativeMLAcc >= 0.70) {
  console.log(`${TAG} [SIGNAL] ML ACCURACY EXCELLENT: ${(cumulativeMLAcc*100).toFixed(1)}% ≥ 70% — no recalibration needed`);
} else {
  console.log(`${TAG} [SIGNAL] ML ACCURACY ACCEPTABLE: ${(cumulativeMLAcc*100).toFixed(1)}% (60-70% range)`);
}

// Signal 3: Total accuracy
if (cumulativeTotAcc < 0.55) {
  console.log(`${TAG} [SIGNAL] TOTAL ACCURACY BELOW TARGET: ${(cumulativeTotAcc*100).toFixed(1)}% < 55%`);
  console.log(`${TAG}   → Review lambda multiplier — model may be misestimating 2026 goal pace`);
  
  // Analyze 2026 goal pace
  const proj2026 = byYear[2026];
  if (proj2026.length > 0) {
    const avgActualGoals2026 = proj2026.reduce((s, r) => s + (r.home_score || 0) + (r.away_score || 0), 0) / proj2026.length;
    console.log(`${TAG}   → 2026 avg actual goals/match: ${avgActualGoals2026.toFixed(2)}`);
    if (avgActualGoals2026 > 2.8) {
      console.log(`${TAG}   → HIGH SCORING TOURNAMENT: avg ${avgActualGoals2026.toFixed(2)} goals/match`);
      console.log(`${TAG}   → Increase lambda multiplier by ${((avgActualGoals2026 - 2.5) / 2.5 * 100).toFixed(1)}%`);
    } else if (avgActualGoals2026 < 2.2) {
      console.log(`${TAG}   → LOW SCORING TOURNAMENT: avg ${avgActualGoals2026.toFixed(2)} goals/match`);
      console.log(`${TAG}   → Decrease lambda multiplier by ${((2.5 - avgActualGoals2026) / 2.5 * 100).toFixed(1)}%`);
    }
  }
} else {
  console.log(`${TAG} [SIGNAL] TOTAL ACCURACY ACCEPTABLE: ${(cumulativeTotAcc*100).toFixed(1)}%`);
}

// Signal 4: 2026 upset analysis
const upsets2026 = byYear[2026].filter(r => {
  const homeProb = parseFloat(r.home_win_prob || 0);
  const awayProb = parseFloat(r.away_win_prob || 0);
  const maxProb = Math.max(homeProb, awayProb);
  return maxProb > 0.55 && r.model_lean !== r.actual_result;
});

console.log(`\n${TAG} 2026 Upsets (model >55% confident but wrong): ${upsets2026.length}`);
for (const u of upsets2026) {
  const hProb = (parseFloat(u.home_win_prob||0)*100).toFixed(1);
  const aProb = (parseFloat(u.away_win_prob||0)*100).toFixed(1);
  console.log(`${TAG}   ${u.match_date}: ${u.home_team} vs ${u.away_team} | ModelLean=${u.model_lean} Actual=${u.actual_result} | H=${hProb}% A=${aProb}%`);
}

// Signal 5: 2026 goal pace analysis
if (byYear[2026].length > 0) {
  const goals2026 = byYear[2026].map(r => (r.home_score || 0) + (r.away_score || 0));
  const avgGoals2026 = goals2026.reduce((a, b) => a + b, 0) / goals2026.length;
  const over25 = goals2026.filter(g => g > 2.5).length;
  const under25 = goals2026.filter(g => g < 2.5).length;
  const exactly25 = goals2026.filter(g => g === 2.5).length; // can't happen with integers
  
  console.log(`\n${TAG} 2026 Goal Pace Analysis (${byYear[2026].length} matches):`);
  console.log(`${TAG}   Avg goals/match: ${avgGoals2026.toFixed(2)}`);
  console.log(`${TAG}   Over 2.5: ${over25}/${byYear[2026].length} = ${(over25/byYear[2026].length*100).toFixed(1)}%`);
  console.log(`${TAG}   Under 2.5: ${under25}/${byYear[2026].length} = ${(under25/byYear[2026].length*100).toFixed(1)}%`);
  
  // Lambda calibration signal
  const targetAvg = 2.5; // WC historical average
  const lambdaAdj = (avgGoals2026 - targetAvg) / targetAvg;
  if (Math.abs(lambdaAdj) > 0.05) {
    console.log(`${TAG} [SIGNAL] LAMBDA CALIBRATION: 2026 avg=${avgGoals2026.toFixed(2)} vs target=2.50 → adj=${(lambdaAdj*100).toFixed(1)}%`);
    console.log(`${TAG}   → Recommended lambda_multiplier adjustment: ${lambdaAdj > 0 ? '+' : ''}${(lambdaAdj*100).toFixed(1)}%`);
  } else {
    console.log(`${TAG} [SIGNAL] LAMBDA CALIBRATION: OK (2026 avg=${avgGoals2026.toFixed(2)} within 5% of target 2.50)`);
  }
}

// ─── PHASE 5: Write batch result ──────────────────────────────────────────────
console.log(`\n${TAG} [STEP 6] Writing batch result to wc_bt_batch_results...`);

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
  'june20_full_132match_backtest', 2026, totalML,
  cumulativeMLAcc, cumulativeTotAcc,
  drawRateActual, drawRateModel,
  upsets2026.length
]).catch(err => {
  console.log(`${TAG} [WARN] Could not write to wc_bt_batch_results: ${err.message}`);
});

// ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} FULL 132-MATCH BACKTEST COMPLETE`);
console.log(`${TAG} Universe: 2018=${byYear[2018].length} 2022=${byYear[2022].length} 2026=${byYear[2026].length} total=${totalML}`);
console.log(`${TAG} Cumulative ML Accuracy: ${correctML}/${totalML} = ${(cumulativeMLAcc*100).toFixed(1)}%`);
console.log(`${TAG} Cumulative Total Accuracy: ${correctTot}/${totalTot} = ${(cumulativeTotAcc*100).toFixed(1)}%`);
console.log(`${TAG} Draw Rate: actual=${(drawRateActual*100).toFixed(1)}% model=${(drawRateModel*100).toFixed(1)}% delta=${(drawRateDelta*100).toFixed(1)}pp`);
console.log(`${TAG} June 20 ML: ${j20ML}/${j20N} | Total: ${j20Total}/${j20N}`);
console.log(`${TAG} 2026 Upsets: ${upsets2026.length}`);
console.log(`${TAG} ================================================================\n`);

await conn.end();
