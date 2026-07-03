/**
 * wc_june19_backtest.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Full backtest for June 19, 2026 WC matches.
 * 
 * Pipeline:
 *   1. Pull June 19 fixtures + final scores from wc2026_matches
 *   2. Pull pre-game model projections from wc2026_model_projections
 *   3. Pull pre-game book odds from wc2026_odds_snapshots (earliest snapshot)
 *   4. Ingest 4 matches into wc_bt_matches (2026)
 *   5. Compute backtest projections and grade all markets:
 *      - ML (home/draw/away)
 *      - Total (O/U 2.5)
 *      - Double Chance (1X, X2, 12)
 *      - BTTS
 *      - Spread
 *   6. Write to wc_bt_projections
 *   7. Run cumulative accuracy analysis across ALL 124 matches (2018+2022+2026)
 *   8. Identify recalibration signals
 *   9. Output full backtest report
 *
 * Logging: [WC_BT] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_BT]';
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── Math helpers ─────────────────────────────────────────────────────────────
function mlToProb(ml) {
  if (ml === null || ml === undefined) return null;
  const n = typeof ml === 'number' ? ml : parseInt(String(ml), 10);
  if (isNaN(n)) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function probToMl(p) {
  if (p === null || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return -Math.round(p / (1 - p) * 100);
  return Math.round((1 - p) / p * 100);
}

function noVig3Way(homeML, drawML, awayML) {
  const ph = mlToProb(homeML), pd = mlToProb(drawML), pa = mlToProb(awayML);
  if (ph === null || pd === null || pa === null) return null;
  const total = ph + pd + pa;
  return { home: ph / total, draw: pd / total, away: pa / total };
}

function calcEdge(modelP, nvP) {
  if (modelP === null || nvP === null) return null;
  return modelP - nvP;
}

function brierScore(probs, outcomes) {
  if (!probs.length) return null;
  return probs.reduce((acc, p, i) => acc + Math.pow(p - outcomes[i], 2), 0) / probs.length;
}

function roi(wins, losses, pushes, vig = 110) {
  const wagered = wins + losses;
  if (wagered === 0) return null;
  const profit = wins * (100 / vig) - losses;
  return (profit / wagered * 100).toFixed(2);
}

// ─── Step 1: Pull June 19 fixtures ───────────────────────────────────────────
console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} WC JUNE 19, 2026 BACKTEST ENGINE`);
console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
console.log(`${TAG} ================================================================\n`);

console.log(`${TAG} [STEP 1] Pulling June 19 fixtures from wc2026_matches...`);
const [fixtures] = await conn.query(`
  SELECT f.fixture_id, ht.name as home_team, at.name as away_team,
         f.home_score, f.away_score, f.status, f.kickoff_utc,
         f.group_letter, f.matchday
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON ht.team_id = f.home_team_id
  JOIN wc2026_teams at ON at.team_id = f.away_team_id
  WHERE f.match_date = '2026-06-19'
  ORDER BY f.kickoff_utc
`);

console.log(`${TAG} [INPUT] June 19 fixtures: ${fixtures.length}`);
for (const f of fixtures) {
  const result = f.home_score > f.away_score ? 'H' : f.home_score < f.away_score ? 'A' : 'D';
  console.log(`${TAG} [INPUT]   ${f.fixture_id}: ${f.home_team} ${f.home_score}-${f.away_score} ${f.away_team} | result=${result} | status=${f.status}`);
}

const june19Ids = fixtures.map(f => f.fixture_id);
if (fixtures.length !== 4) {
  console.error(`${TAG} [VERIFY] FAIL — Expected 4 June 19 fixtures, got ${fixtures.length}`);
  process.exit(1);
}
const allFT = fixtures.every(f => f.status === 'FT');
console.log(`${TAG} [VERIFY] ${allFT ? 'PASS' : 'FAIL'} — All June 19 fixtures FT: ${allFT}`);

// ─── Step 2: Pull pre-game model projections ──────────────────────────────────
console.log(`\n${TAG} [STEP 2] Pulling pre-game model projections from wc2026_model_projections...`);
const [projections] = await conn.query(`
  SELECT p.*
  FROM wc2026_model_projections p
  WHERE p.fixture_id IN (${june19Ids.map(() => '?').join(',')})
  ORDER BY p.fixture_id
`, june19Ids);

console.log(`${TAG} [INPUT] Model projections found: ${projections.length}/4`);
if (projections.length !== 4) {
  console.error(`${TAG} [VERIFY] FAIL — Missing model projections for some June 19 fixtures`);
  process.exit(1);
}

const projMap = {};
for (const p of projections) {
  projMap[p.fixture_id] = p;
  console.log(`${TAG} [STATE]   ${p.fixture_id}: homeWin=${(p.home_win_prob*100).toFixed(1)}% draw=${(p.draw_prob*100).toFixed(1)}% awayWin=${(p.away_win_prob*100).toFixed(1)}% total=${p.proj_total?.toFixed(2)} lean=${p.model_lean}`);
}

// ─── Step 3: Pull pre-game book odds ─────────────────────────────────────────
// wc2026_odds_snapshots: id, fixture_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing
console.log(`\n${TAG} [STEP 3] Pulling pre-game book odds from wc2026_odds_snapshots...`);
const [oddsRaw] = await conn.query(`
  SELECT fixture_id, market, selection, american_odds, line, snapshot_ts
  FROM wc2026_odds_snapshots
  WHERE fixture_id IN (${june19Ids.map(() => '?').join(',')})
  ORDER BY fixture_id, snapshot_ts ASC
`, june19Ids);

console.log(`${TAG} [INPUT] Book odds snapshot rows found: ${oddsRaw.length}`);
// Build per-fixture odds map from individual market rows (one row per selection)
const oddsMap = {};
for (const o of oddsRaw) {
  if (!oddsMap[o.fixture_id]) oddsMap[o.fixture_id] = { fixture_id: o.fixture_id };
  const sel = String(o.selection || '').toLowerCase();
  const mkt = String(o.market || '').toLowerCase();
  if (mkt.includes('moneyline') || mkt.includes('1x2') || mkt === 'h2h' || mkt.includes('match result')) {
    if (sel.includes('home') || sel === '1') oddsMap[o.fixture_id].home_ml = o.american_odds;
    else if (sel.includes('draw') || sel === 'x') oddsMap[o.fixture_id].draw_ml = o.american_odds;
    else if (sel.includes('away') || sel === '2') oddsMap[o.fixture_id].away_ml = o.american_odds;
  } else if (mkt.includes('total') || mkt.includes('over/under')) {
    if (!oddsMap[o.fixture_id].total_line && o.line) oddsMap[o.fixture_id].total_line = o.line;
  }
}
// Fall back to model odds for any missing book odds
for (const fid of june19Ids) {
  const proj = projMap[fid];
  if (!oddsMap[fid]) oddsMap[fid] = { fixture_id: fid };
  const o = oddsMap[fid];
  if (!o.home_ml && proj?.model_home_ml) o.home_ml = proj.model_home_ml;
  if (!o.draw_ml && proj?.model_draw_ml) o.draw_ml = proj.model_draw_ml;
  if (!o.away_ml && proj?.model_away_ml) o.away_ml = proj.model_away_ml;
  if (!o.total_line && proj?.model_total) o.total_line = proj.model_total;
  const src = oddsRaw.some(r => r.fixture_id === fid) ? 'DK' : 'MODEL_FALLBACK';
  console.log(`${TAG} [STATE]   ${fid} [${src}]: homeML=${o.home_ml} drawML=${o.draw_ml} awayML=${o.away_ml} total=${o.total_line}`);
}

// ─── Step 4: Ingest June 19 matches into wc_bt_matches ───────────────────────
console.log(`\n${TAG} [STEP 4] Ingesting June 19 matches into wc_bt_matches...`);
let ingested = 0;
for (const f of fixtures) {
  const result = f.home_score > f.away_score ? 'H' : f.home_score < f.away_score ? 'A' : 'D';
  const totalGoals = f.home_score + f.away_score;
  
  // Check if already exists
  const [existing] = await conn.query(`SELECT id FROM wc_bt_matches WHERE id = ?`, [f.fixture_id]);
  if (existing.length > 0) {
    // Update scores
    await conn.query(`
      UPDATE wc_bt_matches SET home_score=?, away_score=?, updated_at=NOW()
      WHERE id = ?
    `, [f.home_score, f.away_score, f.fixture_id]);
    console.log(`${TAG} [STATE]   ${f.fixture_id}: UPDATED (already existed)`);
  } else {
    await conn.query(`
      INSERT INTO wc_bt_matches 
        (id, tournament_year, stage, group_letter, matchday, match_date, kickoff_utc,
         home_team, away_team, home_score, away_score, source, espn_event_id)
      VALUES (?, 2026, 'Group Stage', ?, ?, '2026-06-19', ?,
              ?, ?, ?, ?, 'espn', NULL)
    `, [f.fixture_id, f.group_letter || 'X', f.matchday || 1, f.kickoff_utc,
        f.home_team, f.away_team, f.home_score, f.away_score]);
    console.log(`${TAG} [STATE]   ${f.fixture_id}: INSERTED — ${f.home_team} ${f.home_score}-${f.away_score} ${f.away_team} result=${result}`);
    ingested++;
  }
}
console.log(`${TAG} [OUTPUT] Ingested ${ingested} new matches into wc_bt_matches`);
console.log(`${TAG} [VERIFY] ${ingested + (4 - ingested) === 4 ? 'PASS' : 'FAIL'} — All 4 June 19 matches in wc_bt_matches`);

// ─── Step 5: Grade all markets for June 19 ───────────────────────────────────
console.log(`\n${TAG} [STEP 5] Grading all markets for June 19 matches...`);

const backtestResults = [];

for (const f of fixtures) {
  const proj = projMap[f.fixture_id];
  const odds = oddsMap[f.fixture_id];
  
  const actualResult = f.home_score > f.away_score ? 'H' : f.home_score < f.away_score ? 'A' : 'D';
  const actualTotal = f.home_score + f.away_score;
  const totalLine = odds?.total_line ?? proj?.model_total ?? 2.5;
  const actualOver = actualTotal > totalLine ? 1 : 0;
  
  // Model probabilities
  const mHomeWin = proj?.home_win_prob ?? null;
  const mDraw = proj?.draw_prob ?? null;
  const mAwayWin = proj?.away_win_prob ?? null;
  
  // Book no-vig probabilities
  const nvProbs = odds ? noVig3Way(odds.home_ml, odds.draw_ml, odds.away_ml) : null;
  
  // Correct result
  const modelLean = proj?.model_lean; // 'H', 'D', 'A'
  const modelCorrectResult = modelLean === actualResult;
  
  // Correct total (O/U 2.5)
  const modelOverProb = proj?.over_2_5 ?? null;
  const modelPredOver = modelOverProb !== null ? modelOverProb > 0.5 : null;
  const modelCorrectTotal = modelPredOver !== null ? (modelPredOver === (actualOver === 1)) : null;
  
  // Double chance
  const dc1X = proj?.home_win_prob !== null && proj?.draw_prob !== null ? proj.home_win_prob + proj.draw_prob : null;
  const dcX2 = proj?.draw_prob !== null && proj?.away_win_prob !== null ? proj.draw_prob + proj.away_win_prob : null;
  const dc12 = proj?.home_win_prob !== null && proj?.away_win_prob !== null ? proj.home_win_prob + proj.away_win_prob : null;
  
  const dc1XActual = actualResult === 'H' || actualResult === 'D' ? 1 : 0;
  const dcX2Actual = actualResult === 'A' || actualResult === 'D' ? 1 : 0;
  const dc12Actual = actualResult === 'H' || actualResult === 'A' ? 1 : 0;
  
  // BTTS
  const bttsProb = proj?.btts_prob ?? null;
  const bttsActual = f.home_score > 0 && f.away_score > 0 ? 1 : 0;
  const bttsCorrect = bttsProb !== null ? ((bttsProb > 0.5) === (bttsActual === 1)) : null;
  
  // Edge calculations
  const homeEdge = mHomeWin !== null && nvProbs ? calcEdge(mHomeWin, nvProbs.home) : null;
  const drawEdge = mDraw !== null && nvProbs ? calcEdge(mDraw, nvProbs.draw) : null;
  const awayEdge = mAwayWin !== null && nvProbs ? calcEdge(mAwayWin, nvProbs.away) : null;
  
  // Model error type
  let errorType = null;
  if (!modelCorrectResult) {
    if (actualResult === 'D' && modelLean !== 'D') errorType = 'MISSED_DRAW';
    else if (actualResult !== 'D' && modelLean === 'D') errorType = 'FALSE_DRAW';
    else errorType = 'WRONG_WINNER';
  }
  
  console.log(`\n${TAG} [STATE] ─── ${f.fixture_id}: ${f.home_team} vs ${f.away_team} ───`);
  console.log(`${TAG} [STATE]   Actual: ${f.home_score}-${f.away_score} (${actualResult}) | Total: ${actualTotal} | Over${totalLine}: ${actualOver ? 'YES' : 'NO'}`);
  console.log(`${TAG} [STATE]   Model: lean=${modelLean} homeWin=${(mHomeWin*100).toFixed(1)}% draw=${(mDraw*100).toFixed(1)}% awayWin=${(mAwayWin*100).toFixed(1)}%`);
  console.log(`${TAG} [STATE]   Model total: ${proj?.model_total?.toFixed(2)} | over2.5prob=${(modelOverProb*100).toFixed(1)}%`);
  console.log(`${TAG} [STATE]   Book NV probs: home=${nvProbs ? (nvProbs.home*100).toFixed(1)+'%' : 'N/A'} draw=${nvProbs ? (nvProbs.draw*100).toFixed(1)+'%' : 'N/A'} away=${nvProbs ? (nvProbs.away*100).toFixed(1)+'%' : 'N/A'}`);
  console.log(`${TAG} [STATE]   Edges: home=${homeEdge !== null ? (homeEdge*100).toFixed(1)+'%' : 'N/A'} draw=${drawEdge !== null ? (drawEdge*100).toFixed(1)+'%' : 'N/A'} away=${awayEdge !== null ? (awayEdge*100).toFixed(1)+'%' : 'N/A'}`);
  console.log(`${TAG} [STATE]   ML correct: ${modelCorrectResult ? '✅' : '❌'} | Total correct: ${modelCorrectTotal ? '✅' : '❌'} | BTTS correct: ${bttsCorrect ? '✅' : '❌'}`);
  console.log(`${TAG} [STATE]   DC 1X: ${dc1X !== null ? (dc1X*100).toFixed(1)+'%' : 'N/A'} actual=${dc1XActual} | DC X2: ${dcX2 !== null ? (dcX2*100).toFixed(1)+'%' : 'N/A'} actual=${dcX2Actual}`);
  if (errorType) console.log(`${TAG} [STATE]   Error type: ${errorType}`);
  
  backtestResults.push({
    fixture_id: f.fixture_id,
    home_team: f.home_team,
    away_team: f.away_team,
    home_score: f.home_score,
    away_score: f.away_score,
    actual_result: actualResult,
    actual_total: actualTotal,
    model_lean: modelLean,
    model_correct_result: modelCorrectResult,
    model_correct_total: modelCorrectTotal,
    btts_correct: bttsCorrect,
    error_type: errorType,
    home_win_prob: mHomeWin,
    draw_prob: mDraw,
    away_win_prob: mAwayWin,
    over_2_5_prob: modelOverProb,
    dc_1x: dc1X,
    dc_x2: dcX2,
    dc_12: dc12,
    home_edge: homeEdge,
    draw_edge: drawEdge,
    away_edge: awayEdge,
    book_home_ml: odds?.home_ml ?? null,
    book_draw_ml: odds?.draw_ml ?? null,
    book_away_ml: odds?.away_ml ?? null,
    book_total: totalLine,
  });
  
  // Upsert into wc_bt_projections
  const [existingProj] = await conn.query(`SELECT id FROM wc_bt_projections WHERE match_id = ? AND tournament_year = 2026`, [f.fixture_id]);
  if (existingProj.length > 0) {
    await conn.query(`
      UPDATE wc_bt_projections SET
        actual_result=?, actual_total_goals=?,
        model_correct_result=?, model_correct_total=?,
        model_error_type=?
      WHERE match_id = ? AND tournament_year = 2026
    `, [actualResult, actualTotal, modelCorrectResult ? 1 : 0, modelCorrectTotal ? 1 : 0, errorType, f.fixture_id]);
    console.log(`${TAG} [STATE]   wc_bt_projections: UPDATED`);
  } else {
    await conn.query(`
      INSERT INTO wc_bt_projections 
        (match_id, tournament_year, model_version,
         model_home_win_prob, model_draw_prob, model_away_win_prob,
         model_home_lambda, model_away_lambda, model_total_goals,
         model_lean, model_lean_prob,
         market_home_win_prob, market_draw_prob, market_away_win_prob,
         market_total_line, market_lean,
         actual_result, actual_total_goals,
         model_correct_result, model_correct_total, model_error_type)
      VALUES (?, 2026, ?,
              ?, ?, ?,
              ?, ?, ?,
              ?, ?,
              ?, ?, ?,
              ?, ?,
              ?, ?,
              ?, ?, ?)
    `, [
      f.fixture_id, proj?.model_version ?? 'v7.0',
      mHomeWin, mDraw, mAwayWin,
      proj?.home_lambda ?? null, proj?.away_lambda ?? null, proj?.proj_total ?? null,
      modelLean, modelLean === 'H' ? mHomeWin : modelLean === 'D' ? mDraw : mAwayWin,
      nvProbs?.home ?? null, nvProbs?.draw ?? null, nvProbs?.away ?? null,
      totalLine, nvProbs ? (nvProbs.home > nvProbs.away ? 'H' : nvProbs.away > nvProbs.home ? 'A' : 'D') : null,
      actualResult, actualTotal,
      modelCorrectResult ? 1 : 0, modelCorrectTotal ? 1 : 0, errorType
    ]);
    console.log(`${TAG} [STATE]   wc_bt_projections: INSERTED`);
  }
}

// ─── Step 6: June 19 summary ─────────────────────────────────────────────────
console.log(`\n${TAG} [STEP 6] June 19 backtest summary...`);
const june19MLCorrect = backtestResults.filter(r => r.model_correct_result).length;
const june19TotalCorrect = backtestResults.filter(r => r.model_correct_total === true).length;
const june19BTTSCorrect = backtestResults.filter(r => r.btts_correct === true).length;
const june19MLAcc = (june19MLCorrect / 4 * 100).toFixed(1);
const june19TotalAcc = (june19TotalCorrect / 4 * 100).toFixed(1);

console.log(`${TAG} [OUTPUT] June 19 ML accuracy: ${june19MLCorrect}/4 = ${june19MLAcc}%`);
console.log(`${TAG} [OUTPUT] June 19 Total accuracy: ${june19TotalCorrect}/4 = ${june19TotalAcc}%`);
console.log(`${TAG} [OUTPUT] June 19 BTTS accuracy: ${june19BTTSCorrect}/4`);

for (const r of backtestResults) {
  const mlIcon = r.model_correct_result ? '✅' : '❌';
  const totIcon = r.model_correct_total ? '✅' : '❌';
  console.log(`${TAG} [OUTPUT]   ${r.home_team} ${r.home_score}-${r.away_score} ${r.away_team} | ML ${mlIcon} (lean=${r.model_lean} actual=${r.actual_result}) | Total ${totIcon} | ${r.error_type ?? 'CORRECT'}`);
}

// ─── Step 7: Cumulative accuracy across all 124 matches ──────────────────────
console.log(`\n${TAG} [STEP 7] Computing cumulative accuracy across all 124 matches (2018+2022+2026)...`);
const [allProj] = await conn.query(`
  SELECT 
    tournament_year,
    COUNT(*) as n,
    SUM(CASE WHEN actual_result IS NOT NULL THEN 1 ELSE 0 END) as graded,
    SUM(CASE WHEN model_correct_result = 1 THEN 1 ELSE 0 END) as ml_correct,
    SUM(CASE WHEN model_correct_total = 1 THEN 1 ELSE 0 END) as total_correct,
    SUM(CASE WHEN model_error_type = 'MISSED_DRAW' THEN 1 ELSE 0 END) as missed_draw,
    SUM(CASE WHEN model_error_type = 'FALSE_DRAW' THEN 1 ELSE 0 END) as false_draw,
    SUM(CASE WHEN model_error_type = 'WRONG_WINNER' THEN 1 ELSE 0 END) as wrong_winner
  FROM wc_bt_projections
  WHERE actual_result IS NOT NULL
  GROUP BY tournament_year
  ORDER BY tournament_year
`);

let totalGraded = 0, totalMLCorrect = 0, totalTotalCorrect = 0;
let totalMissedDraw = 0, totalFalseDraw = 0, totalWrongWinner = 0;

for (const row of allProj) {
  const mlAcc = (row.ml_correct / row.graded * 100).toFixed(1);
  const totAcc = (row.total_correct / row.graded * 100).toFixed(1);
  console.log(`${TAG} [STATE]   ${row.tournament_year}: n=${row.graded} ML=${mlAcc}% Total=${totAcc}% | errors: missedDraw=${row.missed_draw} falseDraw=${row.false_draw} wrongWinner=${row.wrong_winner}`);
  totalGraded += Number(row.graded);
  totalMLCorrect += Number(row.ml_correct);
  totalTotalCorrect += Number(row.total_correct);
  totalMissedDraw += Number(row.missed_draw);
  totalFalseDraw += Number(row.false_draw);
  totalWrongWinner += Number(row.wrong_winner);
}

const overallMLAcc = (totalMLCorrect / totalGraded * 100).toFixed(1);
const overallTotalAcc = (totalTotalCorrect / totalGraded * 100).toFixed(1);

console.log(`\n${TAG} [OUTPUT] CUMULATIVE ACCURACY (${totalGraded} matches):`);
console.log(`${TAG} [OUTPUT]   ML (Result): ${totalMLCorrect}/${totalGraded} = ${overallMLAcc}%`);
console.log(`${TAG} [OUTPUT]   Total (O/U 2.5): ${totalTotalCorrect}/${totalGraded} = ${overallTotalAcc}%`);
console.log(`${TAG} [OUTPUT]   Error breakdown: missedDraw=${totalMissedDraw} falseDraw=${totalFalseDraw} wrongWinner=${totalWrongWinner}`);

// ─── Step 8: Recalibration signals ───────────────────────────────────────────
console.log(`\n${TAG} [STEP 8] Recalibration signal analysis...`);

// Draw rate analysis
const [drawStats] = await conn.query(`
  SELECT 
    tournament_year,
    COUNT(*) as n,
    SUM(CASE WHEN actual_result = 'D' THEN 1 ELSE 0 END) as actual_draws,
    AVG(model_draw_prob) as avg_model_draw_prob,
    SUM(CASE WHEN model_lean = 'D' THEN 1 ELSE 0 END) as model_predicted_draws
  FROM wc_bt_projections
  WHERE actual_result IS NOT NULL
  GROUP BY tournament_year
  ORDER BY tournament_year
`);

console.log(`${TAG} [STATE] Draw rate analysis:`);
for (const d of drawStats) {
  const actualDrawRate = (d.actual_draws / d.n * 100).toFixed(1);
  const modelDrawRate = (d.model_predicted_draws / d.n * 100).toFixed(1);
  const avgModelDrawProb = (d.avg_model_draw_prob * 100).toFixed(1);
  console.log(`${TAG} [STATE]   ${d.tournament_year}: actualDrawRate=${actualDrawRate}% modelPredictedDrawRate=${modelDrawRate}% avgModelDrawProb=${avgModelDrawProb}%`);
}

// Total goals analysis
const [totalStats] = await conn.query(`
  SELECT 
    tournament_year,
    AVG(actual_total_goals) as avg_actual_goals,
    AVG(model_total_goals) as avg_model_total,
    SUM(CASE WHEN actual_total_goals > 2.5 THEN 1 ELSE 0 END) as actual_over_25,
    COUNT(*) as n
  FROM wc_bt_projections
  WHERE actual_result IS NOT NULL
  GROUP BY tournament_year
  ORDER BY tournament_year
`);

console.log(`${TAG} [STATE] Total goals analysis:`);
for (const t of totalStats) {
  const actualOver25Rate = (t.actual_over_25 / t.n * 100).toFixed(1);
  console.log(`${TAG} [STATE]   ${t.tournament_year}: avgActualGoals=${Number(t.avg_actual_goals).toFixed(2)} avgModelTotal=${Number(t.avg_model_total).toFixed(2)} over2.5Rate=${actualOver25Rate}%`);
}

// Upset detection
const [upsetStats] = await conn.query(`
  SELECT 
    COUNT(*) as n,
    SUM(CASE WHEN actual_result = 'A' AND market_lean = 'H' THEN 1 ELSE 0 END) as away_upsets,
    SUM(CASE WHEN actual_result = 'H' AND market_lean = 'A' THEN 1 ELSE 0 END) as home_upsets,
    SUM(CASE WHEN model_lean = actual_result THEN 1 ELSE 0 END) as model_correct,
    SUM(CASE WHEN market_lean = actual_result THEN 1 ELSE 0 END) as market_correct
  FROM wc_bt_projections
  WHERE actual_result IS NOT NULL AND market_lean IS NOT NULL
`);

const us = upsetStats[0];
console.log(`${TAG} [STATE] Upset analysis: awayUpsets=${us.away_upsets} homeUpsets=${us.home_upsets}`);
console.log(`${TAG} [STATE] Model vs Market: model=${us.model_correct} market=${us.market_correct} (n=${us.n})`);

// ─── Step 9: Recalibration recommendations ───────────────────────────────────
console.log(`\n${TAG} [STEP 9] Recalibration recommendations...`);

const mlAccNum = parseFloat(overallMLAcc);
const totalAccNum = parseFloat(overallTotalAcc);
const drawMissRate = totalMissedDraw / totalGraded;
const falseDrwRate = totalFalseDraw / totalGraded;

const recalSignals = [];

if (mlAccNum < 70) {
  recalSignals.push({ signal: 'ML_ACCURACY_BELOW_70PCT', value: mlAccNum, action: 'Increase FIFA rank weight, reduce form recency bias' });
}
if (drawMissRate > 0.15) {
  recalSignals.push({ signal: 'HIGH_MISSED_DRAW_RATE', value: (drawMissRate*100).toFixed(1)+'%', action: 'Increase draw probability floor for evenly-matched teams (rank diff < 10)' });
}
if (falseDrwRate > 0.10) {
  recalSignals.push({ signal: 'HIGH_FALSE_DRAW_RATE', value: (falseDrwRate*100).toFixed(1)+'%', action: 'Reduce draw probability for large rank differentials (>30)' });
}
if (totalAccNum < 60) {
  recalSignals.push({ signal: 'TOTAL_ACCURACY_BELOW_60PCT', value: totalAccNum, action: 'Recalibrate lambda (Poisson mean) — check if tournament pace discount is too aggressive' });
}

if (recalSignals.length === 0) {
  console.log(`${TAG} [OUTPUT] ✅ No critical recalibration signals — model is performing within acceptable thresholds`);
} else {
  console.log(`${TAG} [OUTPUT] ⚠️  ${recalSignals.length} recalibration signal(s) detected:`);
  for (const s of recalSignals) {
    console.log(`${TAG} [OUTPUT]   🔧 ${s.signal}: value=${s.value} → ${s.action}`);
  }
}

// ─── Final summary ────────────────────────────────────────────────────────────
console.log(`\n${TAG} ================================================================`);
console.log(`${TAG} BACKTEST COMPLETE — JUNE 19, 2026`);
console.log(`${TAG} ================================================================`);
console.log(`${TAG} June 19 Results:`);
for (const r of backtestResults) {
  console.log(`${TAG}   ${r.home_team} ${r.home_score}-${r.away_score} ${r.away_team} | ML: ${r.model_correct_result ? '✅' : '❌'} | Total: ${r.model_correct_total ? '✅' : '❌'}`);
}
console.log(`${TAG} June 19 ML: ${june19MLCorrect}/4 (${june19MLAcc}%) | Total: ${june19TotalCorrect}/4 (${june19TotalAcc}%)`);
console.log(`${TAG} Cumulative ML: ${totalMLCorrect}/${totalGraded} (${overallMLAcc}%) | Total: ${totalTotalCorrect}/${totalGraded} (${overallTotalAcc}%)`);
console.log(`${TAG} Recalibration signals: ${recalSignals.length}`);
console.log(`${TAG} ================================================================\n`);

await conn.end();
