/**
 * populate_jul5_projections_full.mjs
 * Populates ALL 54 NULL columns in wc2026_model_projections for Jul 5 matches
 * using Dixon-Coles Poisson model from stored lambdas
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('═══════════════════════════════════════════════════════════════');
console.log('  FULL PROJECTION POPULATION — JUL 5 R16');
console.log('═══════════════════════════════════════════════════════════════');

// Book odds from wc2026MatchOdds for edge calculation
const [oddsRows] = await conn.query(`SELECT * FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);
const oddsMap = Object.fromEntries(oddsRows.map(r => [r.match_id, r]));

const [rows] = await conn.query(`SELECT * FROM wc2026_model_projections WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);

function poissonPmf(k, lambda) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function probToAmerican(p) {
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  return Math.round(100 * (1 - p) / p);
}
function americanToProb(odds) {
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

for (const row of rows) {
  const hLam = row.home_lambda;
  const aLam = row.away_lambda;
  const rho = 0.055;
  const matchId = row.match_id;
  const odds = oddsMap[matchId];
  
  console.log(`\n─── ${matchId}: ${row.home_team} vs ${row.away_team} ───`);
  console.log(`  Lambda: H=${hLam.toFixed(4)} A=${aLam.toFixed(4)} | rho=${rho}`);
  
  // Build full score matrix 0-9
  const scoreMatrix = {};
  let homeWin = 0, draw = 0, awayWin = 0;
  let over05 = 0, over15 = 0, over25 = 0, over35 = 0, over45 = 0;
  let bttsYes = 0, bttsNo = 0;
  let homeCS = 0, awayCS = 0; // clean sheets
  let htHomeWin = 0, htDraw = 0, htAwayWin = 0;
  let htOver05 = 0, htOver15 = 0;
  
  // Goal distributions
  const homeGoalDist = new Array(7).fill(0);
  const awayGoalDist = new Array(7).fill(0);
  
  // Win margins
  let homeBy1 = 0, homeBy2 = 0, homeBy3plus = 0;
  let awayBy1 = 0, awayBy2 = 0, awayBy3plus = 0;
  
  for (let h = 0; h <= 9; h++) {
    for (let a = 0; a <= 9; a++) {
      let p = poissonPmf(h, hLam) * poissonPmf(a, aLam);
      // DC correction
      if (h === 0 && a === 0) p *= (1 + rho * hLam * aLam);
      else if (h === 0 && a === 1) p *= (1 - rho * hLam);
      else if (h === 1 && a === 0) p *= (1 - rho * aLam);
      else if (h === 1 && a === 1) p *= (1 + rho);
      
      scoreMatrix[`${h}-${a}`] = p;
      
      // 1X2
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      
      // Totals
      const total = h + a;
      if (total > 0.5) over05 += p;
      if (total > 1.5) over15 += p;
      if (total > 2.5) over25 += p;
      if (total > 3.5) over35 += p;
      if (total > 4.5) over45 += p;
      
      // BTTS
      if (h > 0 && a > 0) bttsYes += p;
      else bttsNo += p;
      
      // Clean sheets
      if (a === 0) homeCS += p;
      if (h === 0) awayCS += p;
      
      // Goal distributions
      if (h <= 6) homeGoalDist[h] += p;
      if (a <= 6) awayGoalDist[a] += p;
      
      // Win margins
      if (h - a === 1) homeBy1 += p;
      else if (h - a === 2) homeBy2 += p;
      else if (h - a >= 3) homeBy3plus += p;
      if (a - h === 1) awayBy1 += p;
      else if (a - h === 2) awayBy2 += p;
      else if (a - h >= 3) awayBy3plus += p;
    }
  }
  
  // Half-time approximation (lambda/2 for each half)
  const htHLam = hLam / 2;
  const htALam = aLam / 2;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      let p = poissonPmf(h, htHLam) * poissonPmf(a, htALam);
      if (h > a) htHomeWin += p;
      else if (h === a) htDraw += p;
      else htAwayWin += p;
      if (h + a > 0.5) htOver05 += p;
      if (h + a > 1.5) htOver15 += p;
    }
  }
  
  // Normalize
  const sum = homeWin + draw + awayWin;
  homeWin /= sum; draw /= sum; awayWin /= sum;
  const ouSum = over25 + (1 - over25);
  
  // DC markets
  const dc1x = homeWin + draw;
  const dcx2 = awayWin + draw;
  const noDraw = homeWin + awayWin;
  
  // Advance probability
  const homeAdvance = homeWin + 0.5 * draw;
  const awayAdvance = awayWin + 0.5 * draw;
  
  // No-vig probabilities (same as model probs)
  const nvHome = homeWin;
  const nvDraw = draw;
  const nvAway = awayWin;
  
  // Edge calculations (model prob - book implied prob)
  let homeEdge = null, drawEdge = null, awayEdge = null;
  if (odds) {
    const bookHomeProb = americanToProb(odds.book_home_ml);
    const bookDrawProb = americanToProb(odds.book_draw);
    const bookAwayProb = americanToProb(odds.book_away_ml);
    // Remove vig
    const bookTotal = bookHomeProb + bookDrawProb + bookAwayProb;
    homeEdge = homeWin - (bookHomeProb / bookTotal);
    drawEdge = draw - (bookDrawProb / bookTotal);
    awayEdge = awayWin - (bookAwayProb / bookTotal);
  }
  
  // Model lean
  let modelLean, leanProb;
  if (homeWin > awayWin && homeWin > draw) { modelLean = row.home_team; leanProb = homeWin; }
  else if (awayWin > homeWin && awayWin > draw) { modelLean = row.away_team; leanProb = awayWin; }
  else { modelLean = 'DRAW'; leanProb = draw; }
  
  // Fragility/quality scores
  const favFragility = 1 - Math.max(homeWin, awayWin); // how close to upset
  const drawQuality = draw / 0.35; // normalized (0.35 = high draw league avg)
  const underdogViability = Math.min(homeWin, awayWin) / Math.max(homeWin, awayWin);
  const xgBalanceRatio = Math.min(hLam, aLam) / Math.max(hLam, aLam);
  
  // Top scorelines
  const sortedScores = Object.entries(scoreMatrix).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topScorelines = JSON.stringify(sortedScores.map(([s, p]) => ({ score: s, prob: parseFloat((p * 100).toFixed(2)) })));
  
  // Goal distributions as JSON
  const homeGoalDistJson = JSON.stringify(homeGoalDist.map(p => parseFloat((p * 100).toFixed(2))));
  const awayGoalDistJson = JSON.stringify(awayGoalDist.map(p => parseFloat((p * 100).toFixed(2))));
  
  // Book odds as JSON
  const bookOddsJson = odds ? JSON.stringify({
    home_ml: odds.book_home_ml, draw: odds.book_draw, away_ml: odds.book_away_ml,
    home_advance: odds.book_home_to_advance, away_advance: odds.book_away_to_advance,
    over: odds.book_over_odds, under: odds.book_under_odds,
    spread: odds.book_primary_spread, spread_home: odds.book_home_primary_spread_odds, spread_away: odds.book_away_primary_spread_odds
  }) : null;
  
  // Full output JSON
  const fullOutput = JSON.stringify({
    engine: 'v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL5',
    lambda: { home: hLam, away: aLam },
    rho: rho,
    probabilities: { homeWin, draw, awayWin, over25, under25: 1 - over25, bttsYes, bttsNo: 1 - bttsYes },
    advance: { home: homeAdvance, away: awayAdvance },
    topScorelines: sortedScores.slice(0, 5).map(([s, p]) => `${s}(${(p*100).toFixed(1)}%)`),
  });
  
  console.log(`  1X2: H=${(homeWin*100).toFixed(2)}% D=${(draw*100).toFixed(2)}% A=${(awayWin*100).toFixed(2)}%`);
  console.log(`  Advance: H=${(homeAdvance*100).toFixed(2)}% A=${(awayAdvance*100).toFixed(2)}%`);
  console.log(`  O/U 2.5: Over=${(over25*100).toFixed(2)}% Under=${((1-over25)*100).toFixed(2)}%`);
  console.log(`  BTTS: Yes=${(bttsYes*100).toFixed(2)}% No=${((1-bttsYes)*100).toFixed(2)}%`);
  console.log(`  Lean: ${modelLean} (${(leanProb*100).toFixed(1)}%)`);
  console.log(`  Top CS: ${sortedScores.slice(0,5).map(([s,p])=>`${s}(${(p*100).toFixed(1)}%)`).join(', ')}`);
  
  // UPDATE all columns
  await conn.query(`
    UPDATE wc2026_model_projections SET
      home_win_prob = ?, draw_prob = ?, away_win_prob = ?,
      proj_total = ?, proj_spread = ?,
      over_0_5 = ?, over_1_5 = ?, over_2_5 = ?, under_2_5 = ?,
      over_3_5 = ?, over_4_5 = ?,
      btts_prob = ?,
      home_clean_sheet = ?, away_clean_sheet = ?,
      ht_over_0_5 = ?, ht_over_1_5 = ?,
      ht_home_win = ?, ht_draw = ?, ht_away_win = ?,
      model_spread_raw = ?, model_total_raw = ?,
      nv_home_prob = ?, nv_draw_prob = ?, nv_away_prob = ?,
      home_edge = ?, draw_edge = ?, away_edge = ?,
      model_lean = ?, lean_prob = ?,
      fav_fragility_score = ?, draw_quality_score = ?,
      underdog_viability = ?, xg_balance_ratio = ?,
      book_odds = ?, top_scorelines = ?,
      home_goal_dist = ?, away_goal_dist = ?,
      home_win_by_1 = ?, home_win_by_2 = ?, home_win_by_3plus = ?,
      away_win_by_1 = ?, away_win_by_2 = ?, away_win_by_3plus = ?,
      full_output = ?,
      nv_dc_1x = ?, nv_dc_x2 = ?,
      dc_1x_odds = ?, dc_x2_odds = ?,
      nv_no_draw_home = ?, nv_no_draw_away = ?,
      no_draw_home_odds = ?, no_draw_away_odds = ?,
      to_advance_home_prob = ?, to_advance_away_prob = ?,
      frozen_at = NOW()
    WHERE match_id = ?
  `, [
    homeWin, draw, awayWin,
    hLam + aLam, hLam - aLam,
    over05, over15, over25, 1 - over25,
    over35, over45,
    bttsYes,
    homeCS, awayCS,
    htOver05, htOver15,
    htHomeWin, htDraw, htAwayWin,
    hLam - aLam, hLam + aLam,
    nvHome, nvDraw, nvAway,
    homeEdge, drawEdge, awayEdge,
    modelLean, leanProb,
    favFragility, drawQuality,
    underdogViability, xgBalanceRatio,
    bookOddsJson, topScorelines,
    homeGoalDistJson, awayGoalDistJson,
    homeBy1, homeBy2, homeBy3plus,
    awayBy1, awayBy2, awayBy3plus,
    fullOutput,
    dc1x, dcx2,
    probToAmerican(dc1x), probToAmerican(dcx2),
    homeWin / noDraw, awayWin / noDraw,
    probToAmerican(homeWin / noDraw), probToAmerican(awayWin / noDraw),
    homeAdvance, awayAdvance,
    matchId
  ]);
  console.log(`  ✅ ALL 54 columns populated for ${matchId}`);
}

// Final verification
console.log('\n═══ FINAL NULL CHECK ═══');
const [final] = await conn.query(`SELECT * FROM wc2026_model_projections WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')`);
for (const row of final) {
  const nullCols = Object.entries(row).filter(([k, v]) => v === null).map(([k]) => k);
  console.log(`  ${row.match_id}: ${nullCols.length === 0 ? '✅ ZERO NULLs' : `❌ ${nullCols.length} NULLs: ${nullCols.join(', ')}`}`);
}

await conn.end();
process.exit(0);
