/**
 * 500X JULY 2 BACKTEST → RECALIBRATION → JULY 3 MODELING
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 1: Grade Jul 2 model vs actual (correct score, spread, total, ML)
 * Phase 2: Brier scores, calibration metrics, edge detection performance
 * Phase 3: Recalibrate with 25 test variations
 * Phase 4: Model all 3 July 3 matches with recalibrated parameters
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);
const SEP = '═'.repeat(80);
const LINE = '─'.repeat(70);

console.log(SEP);
console.log('500X JULY 2 BACKTEST → RECALIBRATION → JULY 3 MODELING');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(SEP);

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: GRADE JULY 2 MODEL vs ACTUAL
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + SEP);
console.log('PHASE 1: GRADE JULY 2 MODEL vs ACTUAL');
console.log(SEP);

// Pull model data from wc2026MatchOdds
const [modelData] = await db.execute(`
  SELECT * FROM wc2026MatchOdds 
  WHERE espn_match_id IN ('760497','760496','760498') 
  ORDER BY espn_match_id
`);

// Pull actual results from wc2026_espn_matches
const [actuals] = await db.execute(`
  SELECT matchId, homeTeamAbbrev, awayTeamAbbrev, homeScore, awayScore, statusState
  FROM wc2026_espn_matches 
  WHERE matchId IN ('760497','760496','760498')
  ORDER BY matchId
`);

// Pull xG data
const [xgData] = await db.execute(`
  SELECT matchId, homeTeamAbbrev, awayTeamAbbrev, homeXG, awayXG
  FROM wc2026_espn_expected_goals 
  WHERE matchId IN ('760497','760496','760498')
`);

// Pull model_projections for detailed sim data
const [projections] = await db.execute(`
  SELECT * FROM wc2026_model_projections 
  WHERE match_id IN ('wc26-r32-083','wc26-r32-084','wc26-r32-085')
`);

console.log(`\n[INPUT] wc2026MatchOdds rows: ${modelData.length}`);
console.log(`[INPUT] ESPN actuals: ${actuals.length}`);
console.log(`[INPUT] xG data: ${xgData.length}`);
console.log(`[INPUT] Model projections (detailed): ${projections.length}`);

// Grade each match
const grades = [];
for (const actual of actuals) {
  const model = modelData.find(m => m.espn_match_id === String(actual.matchId));
  const xg = xgData.find(x => x.matchId === actual.matchId);
  const proj = projections.find(p => {
    if (actual.matchId == 760496) return p.match_id === 'wc26-r32-084';
    if (actual.matchId == 760497) return p.match_id === 'wc26-r32-083';
    if (actual.matchId == 760498) return p.match_id === 'wc26-r32-085';
    return false;
  });
  
  if (!model) { console.log(`[WARN] No model data for ${actual.matchId}`); continue; }
  
  const actualHome = actual.homeScore;
  const actualAway = actual.awayScore;
  const actualTotal = actualHome + actualAway;
  const actualSpread = actualHome - actualAway;
  
  const projHome = model.model_projected_home_goals;
  const projAway = model.model_projected_away_goals;
  const projTotal = projHome + projAway;
  const projSpread = projHome - projAway;
  
  // Determine outcomes
  const actualResult = actualHome > actualAway ? 'HOME' : actualHome < actualAway ? 'AWAY' : 'DRAW';
  const modelLean = projHome > projAway ? 'HOME' : projHome < projAway ? 'AWAY' : 'DRAW';
  
  // Book implied probabilities (from American odds)
  const americanToProb = (odds) => {
    if (!odds) return null;
    if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
    return 100 / (odds + 100);
  };
  
  const bookHomeProb = americanToProb(model.book_home_ml);
  const bookDrawProb = americanToProb(model.book_draw);
  const bookAwayProb = americanToProb(model.book_away_ml);
  const modelHomeProb = americanToProb(model.model_home_ml);
  const modelDrawProb = americanToProb(model.model_draw);
  const modelAwayProb = americanToProb(model.model_away_ml);
  
  // Grade
  const grade = {
    matchId: actual.matchId,
    slug: model.espn_slug,
    actual: `${actual.homeTeamAbbrev} ${actualHome}-${actualAway} ${actual.awayTeamAbbrev}`,
    projected: `${projHome.toFixed(2)}-${projAway.toFixed(2)}`,
    actualResult,
    modelLean,
    mlCorrect: actualResult === modelLean,
    spreadError: Math.abs(actualSpread - projSpread),
    totalError: Math.abs(actualTotal - projTotal),
    projSpread: projSpread.toFixed(3),
    projTotal: projTotal.toFixed(3),
    actualSpread,
    actualTotal,
    bookHomeML: model.book_home_ml,
    modelHomeML: model.model_home_ml,
    bookTotal: model.book_total,
    modelTotal: model.model_total,
    xgHome: xg ? xg.homeXG : null,
    xgAway: xg ? xg.awayXG : null,
    bookHomeProb,
    modelHomeProb,
    brierHome: proj ? Math.pow((actualResult === 'HOME' ? 1 : 0) - (proj.home_win_prob || modelHomeProb), 2) : null,
    brierDraw: proj ? Math.pow((actualResult === 'DRAW' ? 1 : 0) - (proj.draw_prob || modelDrawProb), 2) : null,
    brierAway: proj ? Math.pow((actualResult === 'AWAY' ? 1 : 0) - (proj.away_win_prob || modelAwayProb), 2) : null,
  };
  
  if (proj) {
    grade.homeWinProb = proj.home_win_prob;
    grade.drawProb = proj.draw_prob;
    grade.awayWinProb = proj.away_win_prob;
    grade.homeLambda = proj.home_lambda;
    grade.awayLambda = proj.away_lambda;
    grade.nSims = proj.n_simulations;
    grade.topScorelines = proj.top_scorelines;
  }
  
  grades.push(grade);
  
  console.log(`\n${LINE}`);
  console.log(`MATCH: ${grade.actual} (${model.espn_slug})`);
  console.log(LINE);
  console.log(`  [PROJECTED] ${grade.projected} goals | spread=${grade.projSpread} | total=${grade.projTotal}`);
  console.log(`  [ACTUAL]    ${actualHome}-${actualAway} | spread=${actualSpread} | total=${actualTotal}`);
  console.log(`  [xG]        home=${grade.xgHome} away=${grade.xgAway} | total=${xg ? (parseFloat(xg.homeXG)+parseFloat(xg.awayXG)).toFixed(3) : 'N/A'}`);
  console.log(`  [ML GRADE]  Model lean: ${modelLean} | Actual: ${actualResult} | ${grade.mlCorrect ? '✅ CORRECT' : '❌ WRONG'}`);
  console.log(`  [SPREAD]    Error: ${grade.spreadError.toFixed(3)} goals`);
  console.log(`  [TOTAL]     Error: ${grade.totalError.toFixed(3)} goals`);
  console.log(`  [BOOK ML]   home=${model.book_home_ml} draw=${model.book_draw} away=${model.book_away_ml}`);
  console.log(`  [MODEL ML]  home=${model.model_home_ml} draw=${model.model_draw} away=${model.model_away_ml}`);
  console.log(`  [BOOK PROB] home=${(bookHomeProb*100).toFixed(1)}% draw=${(bookDrawProb*100).toFixed(1)}% away=${(bookAwayProb*100).toFixed(1)}%`);
  console.log(`  [MODEL PROB] home=${(modelHomeProb*100).toFixed(1)}% draw=${(modelDrawProb*100).toFixed(1)}% away=${(modelAwayProb*100).toFixed(1)}%`);
  if (proj) {
    console.log(`  [SIM PROB]  home=${(proj.home_win_prob*100).toFixed(1)}% draw=${(proj.draw_prob*100).toFixed(1)}% away=${(proj.away_win_prob*100).toFixed(1)}%`);
    console.log(`  [LAMBDA]    home=${proj.home_lambda.toFixed(4)} away=${proj.away_lambda.toFixed(4)}`);
    console.log(`  [SIMS]      n=${proj.n_simulations}`);
  }
  console.log(`  [BRIER]     home=${grade.brierHome?.toFixed(4)} draw=${grade.brierDraw?.toFixed(4)} away=${grade.brierAway?.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: AGGREGATE METRICS
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + SEP);
console.log('PHASE 2: AGGREGATE BACKTEST METRICS');
console.log(SEP);

const mlCorrect = grades.filter(g => g.mlCorrect).length;
const avgSpreadError = grades.reduce((s, g) => s + g.spreadError, 0) / grades.length;
const avgTotalError = grades.reduce((s, g) => s + g.totalError, 0) / grades.length;
const avgBrier = grades.reduce((s, g) => s + (g.brierHome + g.brierDraw + g.brierAway) / 3, 0) / grades.length;

console.log(`\n  ML Accuracy: ${mlCorrect}/${grades.length} (${(mlCorrect/grades.length*100).toFixed(1)}%)`);
console.log(`  Avg Spread Error: ${avgSpreadError.toFixed(3)} goals`);
console.log(`  Avg Total Error: ${avgTotalError.toFixed(3)} goals`);
console.log(`  Avg Brier Score: ${avgBrier.toFixed(4)} (lower=better, 0=perfect)`);

// Edge detection
console.log('\n  EDGE DETECTION PERFORMANCE:');
grades.forEach(g => {
  const modelEdge = g.modelHomeProb - g.bookHomeProb;
  const edgeDirection = modelEdge > 0 ? 'HOME' : 'AWAY';
  const edgeHit = edgeDirection === g.actualResult;
  console.log(`    ${g.slug}: edge=${(modelEdge*100).toFixed(1)}% toward ${edgeDirection} | actual=${g.actualResult} | ${edgeHit ? '✅ HIT' : '❌ MISS'}`);
});

// Total/Over-Under performance
console.log('\n  TOTAL/OVER-UNDER PERFORMANCE:');
grades.forEach(g => {
  const projOver = g.projTotal > g.bookTotal ? 'OVER' : 'UNDER';
  const actualOU = g.actualTotal > g.bookTotal ? 'OVER' : g.actualTotal < g.bookTotal ? 'UNDER' : 'PUSH';
  console.log(`    ${g.slug}: model=${projOver} (proj=${g.projTotal}) book=${g.bookTotal} | actual=${g.actualTotal} → ${actualOU} | ${projOver === actualOU ? '✅' : '❌'}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: RECALIBRATION — 25 TEST VARIATIONS
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + SEP);
console.log('PHASE 3: RECALIBRATION — 25 TEST VARIATIONS');
console.log(SEP);

// Current model parameters (extracted from projections)
const baseParams = {
  homeAdvantage: 0.05,  // neutral venue, minimal home advantage
  tournamentPaceDiscount: 0.04, // 4% pace discount for knockout
  lambdaDecay: 1.0,     // no decay (single match)
  vsinWeight: 0.70,     // VSiN weight for total anchor
  poissonCap: 8,        // max goals in distribution
};

console.log('\n[BASE PARAMS]');
Object.entries(baseParams).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// Compute Poisson probability for a scoreline
const poissonPMF = (k, lambda) => Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }

// Score matrix from lambdas
function scoreMatrix(homeLambda, awayLambda, cap = 8) {
  const matrix = [];
  for (let h = 0; h <= cap; h++) {
    for (let a = 0; a <= cap; a++) {
      matrix.push({ h, a, prob: poissonPMF(h, homeLambda) * poissonPMF(a, awayLambda) });
    }
  }
  return matrix;
}

// Compute outcomes from lambdas
function computeOutcomes(homeLambda, awayLambda) {
  const matrix = scoreMatrix(homeLambda, awayLambda);
  let homeWin = 0, draw = 0, awayWin = 0, totalProb = 0;
  let over25 = 0, under25 = 0;
  
  for (const { h, a, prob } of matrix) {
    totalProb += prob;
    if (h > a) homeWin += prob;
    else if (h === a) draw += prob;
    else awayWin += prob;
    if (h + a > 2.5) over25 += prob;
    else under25 += prob;
  }
  
  return { homeWin, draw, awayWin, over25, under25, totalProb };
}

// 25 calibration variations
const variations = [];
for (let haAdj = -0.03; haAdj <= 0.03; haAdj += 0.015) {       // 5 levels
  for (let paceAdj = -0.02; paceAdj <= 0.02; paceAdj += 0.01) { // 5 levels
    variations.push({
      homeAdvAdj: haAdj,
      paceAdj: paceAdj,
      label: `HA${haAdj >= 0 ? '+' : ''}${(haAdj*100).toFixed(1)}% Pace${paceAdj >= 0 ? '+' : ''}${(paceAdj*100).toFixed(1)}%`
    });
  }
}

console.log(`\n[CALIBRATION] Running ${variations.length} variations against Jul 2 actuals...\n`);

const variationResults = [];
for (const v of variations) {
  let totalBrier = 0;
  let totalSpreadErr = 0;
  let totalTotalErr = 0;
  let mlHits = 0;
  
  for (const g of grades) {
    // Get base lambdas from projections
    const proj = projections.find(p => {
      if (g.matchId == 760496) return p.match_id === 'wc26-r32-084';
      if (g.matchId == 760497) return p.match_id === 'wc26-r32-083';
      if (g.matchId == 760498) return p.match_id === 'wc26-r32-085';
      return false;
    });
    if (!proj) continue;
    
    // Apply adjustments
    const adjHomeLambda = proj.home_lambda * (1 + v.homeAdvAdj) * (1 - baseParams.tournamentPaceDiscount - v.paceAdj);
    const adjAwayLambda = proj.away_lambda * (1 - v.homeAdvAdj) * (1 - baseParams.tournamentPaceDiscount - v.paceAdj);
    
    const outcomes = computeOutcomes(adjHomeLambda, adjAwayLambda);
    const projSpread = adjHomeLambda - adjAwayLambda;
    const projTotal = adjHomeLambda + adjAwayLambda;
    
    // Brier score
    const actualOutcome = g.actualResult === 'HOME' ? [1,0,0] : g.actualResult === 'DRAW' ? [0,1,0] : [0,0,1];
    const brier = (Math.pow(actualOutcome[0] - outcomes.homeWin, 2) + 
                   Math.pow(actualOutcome[1] - outcomes.draw, 2) + 
                   Math.pow(actualOutcome[2] - outcomes.awayWin, 2)) / 3;
    totalBrier += brier;
    
    // Spread/total error
    totalSpreadErr += Math.abs(g.actualSpread - projSpread);
    totalTotalErr += Math.abs(g.actualTotal - projTotal);
    
    // ML accuracy
    const lean = outcomes.homeWin > outcomes.awayWin ? 'HOME' : outcomes.awayWin > outcomes.homeWin ? 'AWAY' : 'DRAW';
    if (lean === g.actualResult) mlHits++;
  }
  
  variationResults.push({
    ...v,
    avgBrier: totalBrier / grades.length,
    avgSpreadErr: totalSpreadErr / grades.length,
    avgTotalErr: totalTotalErr / grades.length,
    mlAccuracy: mlHits / grades.length,
    composite: (totalBrier / grades.length) * 0.4 + (totalSpreadErr / grades.length) * 0.3 + (totalTotalErr / grades.length) * 0.3
  });
}

// Sort by composite score (lower = better)
variationResults.sort((a, b) => a.composite - b.composite);

console.log('  TOP 10 CALIBRATION VARIATIONS (by composite score):');
console.log('  ' + '─'.repeat(90));
console.log('  Rank | Variation                    | Brier  | SpreadErr | TotalErr | ML%    | Composite');
console.log('  ' + '─'.repeat(90));
variationResults.slice(0, 10).forEach((v, i) => {
  console.log(`  ${String(i+1).padStart(4)} | ${v.label.padEnd(28)} | ${v.avgBrier.toFixed(4)} | ${v.avgSpreadErr.toFixed(4)}    | ${v.avgTotalErr.toFixed(4)}   | ${(v.mlAccuracy*100).toFixed(1)}%  | ${v.composite.toFixed(4)}`);
});

const best = variationResults[0];
console.log(`\n  [BEST] ${best.label} → composite=${best.composite.toFixed(4)}`);
console.log(`         Brier=${best.avgBrier.toFixed(4)} SpreadErr=${best.avgSpreadErr.toFixed(4)} TotalErr=${best.avgTotalErr.toFixed(4)} ML=${(best.mlAccuracy*100).toFixed(1)}%`);

// Recalibrated parameters
const recalParams = {
  homeAdvantage: baseParams.homeAdvantage + best.homeAdvAdj,
  tournamentPaceDiscount: baseParams.tournamentPaceDiscount + best.paceAdj,
  lambdaDecay: baseParams.lambdaDecay,
  vsinWeight: baseParams.vsinWeight,
  poissonCap: baseParams.poissonCap,
};
console.log('\n  [RECALIBRATED PARAMS]');
Object.entries(recalParams).forEach(([k,v]) => console.log(`    ${k}: ${v}`));

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: MODEL ALL 3 JULY 3 MATCHES
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + SEP);
console.log('PHASE 4: MODEL JULY 3 MATCHES (RECALIBRATED)');
console.log(SEP);

// Get Jul 3 matches from wc2026MatchOdds
const [jul3Odds] = await db.execute(`
  SELECT * FROM wc2026MatchOdds 
  WHERE espn_match_id IN ('760499','760500','760501') 
  ORDER BY espn_match_id
`);

// Get Jul 3 matches from core table for team info
const [jul3Core] = await db.execute(`
  SELECT m.match_id, m.home_team_id, m.away_team_id, m.espn_event_id, m.status,
         ht.name as home_name, at.name as away_name
  FROM wc2026_matches m
  JOIN wc2026_teams ht ON m.home_team_id = ht.team_id
  JOIN wc2026_teams at ON m.away_team_id = at.team_id
  WHERE m.match_date LIKE '2026-07-03%'
  ORDER BY m.espn_event_id
`);

console.log(`\n[INPUT] Jul 3 wc2026MatchOdds: ${jul3Odds.length} rows`);
console.log(`[INPUT] Jul 3 core matches: ${jul3Core.length} rows`);

// Get existing model projections for Jul 3
const [existingProj] = await db.execute(`
  SELECT * FROM wc2026_model_projections 
  WHERE match_id IN (SELECT match_id FROM wc2026_matches WHERE match_date LIKE '2026-07-03%')
`);
console.log(`[INPUT] Existing Jul 3 projections: ${existingProj.length}`);

// Model each Jul 3 match
const jul3Models = [];
for (const core of jul3Core) {
  const odds = jul3Odds.find(o => o.espn_match_id === String(core.espn_event_id));
  const existing = existingProj.find(p => p.match_id === core.match_id);
  
  console.log(`\n${LINE}`);
  console.log(`MODELING: ${core.home_name} vs ${core.away_name} (${core.match_id})`);
  console.log(LINE);
  
  let homeLambda, awayLambda;
  
  if (existing) {
    // Use existing projection lambdas as base, apply recalibration
    homeLambda = existing.home_lambda * (1 + best.homeAdvAdj) * (1 - recalParams.tournamentPaceDiscount);
    awayLambda = existing.away_lambda * (1 - best.homeAdvAdj) * (1 - recalParams.tournamentPaceDiscount);
    console.log(`  [BASE] From existing projection: λ_home=${existing.home_lambda.toFixed(4)} λ_away=${existing.away_lambda.toFixed(4)}`);
  } else if (odds && odds.lamba_home) {
    // Use wc2026MatchOdds lambdas
    homeLambda = odds.lamba_home * (1 + best.homeAdvAdj) * (1 - recalParams.tournamentPaceDiscount);
    awayLambda = odds.lamba_away * (1 - best.homeAdvAdj) * (1 - recalParams.tournamentPaceDiscount);
    console.log(`  [BASE] From wc2026MatchOdds: λ_home=${odds.lamba_home.toFixed(4)} λ_away=${odds.lamba_away.toFixed(4)}`);
  } else {
    // Derive from book odds if no lambda available
    console.log(`  [WARN] No lambda data available — deriving from book odds`);
    // Use implied probabilities to estimate lambdas
    if (odds) {
      const bookHP = odds.book_home_ml < 0 ? Math.abs(odds.book_home_ml) / (Math.abs(odds.book_home_ml) + 100) : 100 / (odds.book_home_ml + 100);
      const bookAP = odds.book_away_ml < 0 ? Math.abs(odds.book_away_ml) / (Math.abs(odds.book_away_ml) + 100) : 100 / (odds.book_away_ml + 100);
      // Rough lambda estimation from win probability
      homeLambda = 1.2 + bookHP * 0.8;
      awayLambda = 1.2 + bookAP * 0.8;
    } else {
      homeLambda = 1.3;
      awayLambda = 1.3;
    }
    console.log(`  [DERIVED] λ_home=${homeLambda.toFixed(4)} λ_away=${awayLambda.toFixed(4)}`);
  }
  
  console.log(`  [RECAL] Applied: HA_adj=${best.homeAdvAdj} pace_disc=${recalParams.tournamentPaceDiscount}`);
  console.log(`  [FINAL] λ_home=${homeLambda.toFixed(4)} λ_away=${awayLambda.toFixed(4)}`);
  
  // Compute full probability matrix
  const outcomes = computeOutcomes(homeLambda, awayLambda);
  const projTotal = homeLambda + awayLambda;
  const projSpread = homeLambda - awayLambda;
  
  // Top scorelines
  const matrix = scoreMatrix(homeLambda, awayLambda);
  matrix.sort((a, b) => b.prob - a.prob);
  const topScorelines = matrix.slice(0, 10);
  
  // Over/Under probabilities
  let over05 = 0, over15 = 0, over25 = 0, over35 = 0, over45 = 0;
  let btts = 0;
  for (const { h, a, prob } of matrix) {
    if (h + a > 0.5) over05 += prob;
    if (h + a > 1.5) over15 += prob;
    if (h + a > 2.5) over25 += prob;
    if (h + a > 3.5) over35 += prob;
    if (h + a > 4.5) over45 += prob;
    if (h > 0 && a > 0) btts += prob;
  }
  
  // Convert probabilities to American odds
  const probToAmerican = (p) => {
    if (p >= 0.5) return Math.round(-100 * p / (1 - p));
    return Math.round(100 * (1 - p) / p);
  };
  
  const modelResult = {
    matchId: core.match_id,
    espnId: core.espn_event_id,
    home: core.home_name,
    away: core.away_name,
    homeLambda,
    awayLambda,
    projHomeGoals: homeLambda,
    projAwayGoals: awayLambda,
    projTotal,
    projSpread,
    homeWinProb: outcomes.homeWin,
    drawProb: outcomes.draw,
    awayWinProb: outcomes.awayWin,
    homeML: probToAmerican(outcomes.homeWin),
    drawML: probToAmerican(outcomes.draw),
    awayML: probToAmerican(outcomes.awayWin),
    over25Prob: over25,
    under25Prob: 1 - over25,
    bttsProb: btts,
    topScorelines,
    over05, over15, over25, over35, over45,
    bookHomeML: odds?.book_home_ml,
    bookDraw: odds?.book_draw,
    bookAwayML: odds?.book_away_ml,
    bookTotal: odds?.book_total,
    bookSpread: odds?.book_primary_spread,
  };
  
  jul3Models.push(modelResult);
  
  // Display
  console.log(`\n  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ ${core.home_name} vs ${core.away_name}`.padEnd(63) + '│');
  console.log(`  ├─────────────────────────────────────────────────────────────┤`);
  console.log(`  │ Projected Score: ${homeLambda.toFixed(2)} - ${awayLambda.toFixed(2)}`.padEnd(63) + '│');
  console.log(`  │ Spread: ${projSpread >= 0 ? '+' : ''}${projSpread.toFixed(3)} | Total: ${projTotal.toFixed(3)}`.padEnd(63) + '│');
  console.log(`  ├─────────────────────────────────────────────────────────────┤`);
  console.log(`  │ Win Prob: Home=${(outcomes.homeWin*100).toFixed(1)}% Draw=${(outcomes.draw*100).toFixed(1)}% Away=${(outcomes.awayWin*100).toFixed(1)}%`.padEnd(63) + '│');
  console.log(`  │ Model ML: Home=${modelResult.homeML} Draw=${modelResult.drawML} Away=${modelResult.awayML}`.padEnd(63) + '│');
  if (odds) {
    console.log(`  │ Book ML:  Home=${odds.book_home_ml} Draw=${odds.book_draw} Away=${odds.book_away_ml}`.padEnd(63) + '│');
  }
  console.log(`  ├─────────────────────────────────────────────────────────────┤`);
  console.log(`  │ O/U 2.5: Over=${(over25*100).toFixed(1)}% Under=${((1-over25)*100).toFixed(1)}%`.padEnd(63) + '│');
  console.log(`  │ BTTS: Yes=${(btts*100).toFixed(1)}% No=${((1-btts)*100).toFixed(1)}%`.padEnd(63) + '│');
  console.log(`  ├─────────────────────────────────────────────────────────────┤`);
  console.log(`  │ Top Scorelines:`.padEnd(63) + '│');
  topScorelines.slice(0, 5).forEach(s => {
    console.log(`  │   ${s.h}-${s.a}: ${(s.prob*100).toFixed(2)}%`.padEnd(63) + '│');
  });
  console.log(`  └─────────────────────────────────────────────────────────────┘`);
  
  // Edge analysis vs book
  if (odds && odds.book_home_ml) {
    const bookHP = odds.book_home_ml < 0 ? Math.abs(odds.book_home_ml) / (Math.abs(odds.book_home_ml) + 100) : 100 / (odds.book_home_ml + 100);
    const bookAP = odds.book_away_ml < 0 ? Math.abs(odds.book_away_ml) / (Math.abs(odds.book_away_ml) + 100) : 100 / (odds.book_away_ml + 100);
    const bookDP = odds.book_draw < 0 ? Math.abs(odds.book_draw) / (Math.abs(odds.book_draw) + 100) : 100 / (odds.book_draw + 100);
    
    const homeEdge = outcomes.homeWin - bookHP;
    const drawEdge = outcomes.draw - bookDP;
    const awayEdge = outcomes.awayWin - bookAP;
    
    console.log(`\n  EDGE ANALYSIS:`);
    console.log(`    Home edge: ${(homeEdge*100).toFixed(2)}% ${homeEdge > 0.03 ? '🔥 STRONG' : homeEdge > 0.01 ? '📊 MODERATE' : '─'}`);
    console.log(`    Draw edge: ${(drawEdge*100).toFixed(2)}% ${drawEdge > 0.03 ? '🔥 STRONG' : drawEdge > 0.01 ? '📊 MODERATE' : '─'}`);
    console.log(`    Away edge: ${(awayEdge*100).toFixed(2)}% ${awayEdge > 0.03 ? '🔥 STRONG' : awayEdge > 0.01 ? '📊 MODERATE' : '─'}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + SEP);
console.log('PHASE 5: FINAL SUMMARY — RELAY FOR APPROVAL');
console.log(SEP);

console.log('\n  JULY 2 BACKTEST GRADE:');
console.log(`    ML Accuracy: ${mlCorrect}/${grades.length} (${(mlCorrect/grades.length*100).toFixed(1)}%)`);
console.log(`    Avg Spread Error: ${avgSpreadError.toFixed(3)} goals`);
console.log(`    Avg Total Error: ${avgTotalError.toFixed(3)} goals`);
console.log(`    Avg Brier Score: ${avgBrier.toFixed(4)}`);

console.log('\n  RECALIBRATION APPLIED:');
console.log(`    Best variation: ${best.label}`);
console.log(`    Composite improvement: ${((variationResults[variationResults.length-1].composite - best.composite) / variationResults[variationResults.length-1].composite * 100).toFixed(1)}% better than worst`);

console.log('\n  JULY 3 PROJECTIONS:');
jul3Models.forEach(m => {
  console.log(`\n    ${m.home} vs ${m.away}:`);
  console.log(`      Score: ${m.projHomeGoals.toFixed(2)} - ${m.projAwayGoals.toFixed(2)}`);
  console.log(`      ML: Home=${m.homeML} Draw=${m.drawML} Away=${m.awayML}`);
  console.log(`      Total: ${m.projTotal.toFixed(2)} | Spread: ${m.projSpread >= 0 ? '+' : ''}${m.projSpread.toFixed(3)}`);
  console.log(`      O/U 2.5: ${(m.over25Prob*100).toFixed(1)}%/${((1-m.over25Prob)*100).toFixed(1)}% | BTTS: ${(m.bttsProb*100).toFixed(1)}%`);
});

console.log('\n' + SEP);
console.log('AWAITING APPROVAL');
console.log(SEP);

await db.end();
process.exit(0);
