/**
 * populate_proj_093.mjs
 * Populates ALL remaining NULL columns in wc2026_model_projections for wc26-r16-093
 * Uses the same Dixon-Coles analytical model from v20 engine
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

// ═══ CONSTANTS ═══
const MATCH_ID = 'wc26-r16-093';
const HOME = 'POR', AWAY = 'ESP';
const MAX_G = 9;

// From v20 engine output:
const lambdaH = 1.4671231613141762;
const lambdaA = 1.919178826728612;
const rho = -0.03; // Dixon-Coles correlation (from V7 best variation)
const spreadLine = 0; // pk

// Book odds from BetExplorer (bet365)
const BOOK = {
  homeMl: 290, draw: 250, awayMl: -105,
  homeAdv: 175, awayAdv: -233,
  homeSpread: 175, awaySpread: -233,
  over: -125, under: 100,
  bttsY: -149, bttsN: 110,
  homeWD: -125, awayWD: -400, noDraw: -345
};

// ═══ HELPER FUNCTIONS ═══
function poissonPMF(k, lambda) {
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function buildJointMatrix(lH, lA, rho) {
  const joint = Array.from({length: MAX_G+1}, () => Array(MAX_G+1).fill(0));
  for (let h = 0; h <= MAX_G; h++) {
    for (let a = 0; a <= MAX_G; a++) {
      let p = poissonPMF(h, lH) * poissonPMF(a, lA);
      // Dixon-Coles correction for low scores
      if (h === 0 && a === 0) p *= (1 + lH * lA * rho);
      else if (h === 1 && a === 0) p *= (1 - lA * rho);
      else if (h === 0 && a === 1) p *= (1 - lH * rho);
      else if (h === 1 && a === 1) p *= (1 + rho);
      joint[h][a] = Math.max(0, p);
    }
  }
  // Normalize
  let total = 0;
  for (let h = 0; h <= MAX_G; h++) for (let a = 0; a <= MAX_G; a++) total += joint[h][a];
  for (let h = 0; h <= MAX_G; h++) for (let a = 0; a <= MAX_G; a++) joint[h][a] /= total;
  return joint;
}

function mlToProb(ml) {
  if (ml > 0) return 100 / (ml + 100);
  else return Math.abs(ml) / (Math.abs(ml) + 100);
}

function probToML(p) {
  if (p <= 0) return 9999;
  if (p >= 1) return -9999;
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  else return Math.round(100 * (1 - p) / p);
}

// ═══ COMPUTE ALL DERIVED METRICS ═══
console.log('═══ POPULATING wc2026_model_projections: wc26-r16-093 ═══');
console.log(`[INPUT] λH=${lambdaH.toFixed(4)} λA=${lambdaA.toFixed(4)} ρ=${rho}`);

const joint = buildJointMatrix(lambdaH, lambdaA, rho);

// 1. Win probabilities
let pH=0, pD=0, pA=0;
for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
  if (h>a) pH+=joint[h][a];
  else if (h===a) pD+=joint[h][a];
  else pA+=joint[h][a];
}
console.log(`[PROB] pH=${(pH*100).toFixed(2)}% pD=${(pD*100).toFixed(2)}% pA=${(pA*100).toFixed(2)}%`);

// 2. Over/Under thresholds
let over05=0, over15=0, over25=0, over35=0, over45=0;
for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
  const t = h+a;
  if (t>0.5) over05+=joint[h][a];
  if (t>1.5) over15+=joint[h][a];
  if (t>2.5) over25+=joint[h][a];
  if (t>3.5) over35+=joint[h][a];
  if (t>4.5) over45+=joint[h][a];
}
const under25 = 1 - over25;
console.log(`[TOTALS] O0.5=${(over05*100).toFixed(1)}% O1.5=${(over15*100).toFixed(1)}% O2.5=${(over25*100).toFixed(1)}% O3.5=${(over35*100).toFixed(1)}% O4.5=${(over45*100).toFixed(1)}%`);

// 3. BTTS + Clean sheets
let pBTTS=0, homeCS=0, awayCS=0;
for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
  if (h>0&&a>0) pBTTS+=joint[h][a];
  if (a===0) homeCS+=joint[h][a];
  if (h===0) awayCS+=joint[h][a];
}
console.log(`[BTTS] Yes=${(pBTTS*100).toFixed(1)}% | HomeCS=${(homeCS*100).toFixed(1)}% AwayCS=${(awayCS*100).toFixed(1)}%`);

// 4. To Advance (with ET/pens)
const lambdaH_et = lambdaH/3, lambdaA_et = lambdaA/3;
let pAdvH=0, pAdvA=0;
for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
  const p = joint[h][a];
  if (h>a) pAdvH+=p;
  else if (h<a) pAdvA+=p;
  else {
    let etH=0, etA=0, etD=0;
    for (let eh=0;eh<=4;eh++) for (let ea=0;ea<=4;ea++) {
      const ep = poissonPMF(eh,lambdaH_et)*poissonPMF(ea,lambdaA_et);
      if (eh>ea) etH+=ep; else if (ea>eh) etA+=ep; else etD+=ep;
    }
    const etTotal = etH+etA+etD;
    etH/=etTotal; etA/=etTotal; etD/=etTotal;
    pAdvH += p*(etH + etD*0.505);
    pAdvA += p*(etA + etD*0.495);
  }
}
console.log(`[ADVANCE] POR=${(pAdvH*100).toFixed(1)}% ESP=${(pAdvA*100).toFixed(1)}%`);

// 5. Top scorelines
const allScores = [];
for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) allScores.push({h,a,p:joint[h][a]});
allScores.sort((a,b)=>b.p-a.p);
const top5 = allScores.slice(0,5).map(s=>({score:`${s.h}-${s.a}`,prob:+(s.p*100).toFixed(2)}));
console.log(`[TOP_SCORES] ${top5.map(s=>`${s.score}(${s.prob}%)`).join(' | ')}`);

// 6. Goal distributions (marginals)
const homeGoalDist = [], awayGoalDist = [];
for (let g=0;g<=6;g++) {
  let hSum=0, aSum=0;
  for (let x=0;x<=MAX_G;x++) { hSum+=joint[g][x]; aSum+=joint[x][g]; }
  homeGoalDist.push(+(hSum*100).toFixed(2));
  awayGoalDist.push(+(aSum*100).toFixed(2));
}
console.log(`[GOAL_DIST] Home: ${homeGoalDist.map((v,i)=>`${i}g=${v}%`).join(' ')}`);
console.log(`[GOAL_DIST] Away: ${awayGoalDist.map((v,i)=>`${i}g=${v}%`).join(' ')}`);

// 7. Win margins
let hWin1=0, hWin2=0, hWin3p=0, aWin1=0, aWin2=0, aWin3p=0;
for (let h=0;h<=MAX_G;h++) for (let a=0;a<=MAX_G;a++) {
  const m = h-a;
  if (m===1) hWin1+=joint[h][a];
  else if (m===2) hWin2+=joint[h][a];
  else if (m>=3) hWin3p+=joint[h][a];
  else if (m===-1) aWin1+=joint[h][a];
  else if (m===-2) aWin2+=joint[h][a];
  else if (m<=-3) aWin3p+=joint[h][a];
}
console.log(`[MARGINS] H+1=${(hWin1*100).toFixed(1)}% H+2=${(hWin2*100).toFixed(1)}% H+3+=${(hWin3p*100).toFixed(1)}% | A+1=${(aWin1*100).toFixed(1)}% A+2=${(aWin2*100).toFixed(1)}% A+3+=${(aWin3p*100).toFixed(1)}%`);

// 8. Half-time probabilities (using lambda/2)
const lH_ht = lambdaH/2, lA_ht = lambdaA/2;
let htOver05=0, htOver15=0, htHW=0, htD=0, htAW=0;
for (let h=0;h<=4;h++) for (let a=0;a<=4;a++) {
  const p = poissonPMF(h,lH_ht)*poissonPMF(a,lA_ht);
  if (h+a>0.5) htOver05+=p;
  if (h+a>1.5) htOver15+=p;
  if (h>a) htHW+=p;
  else if (h===a) htD+=p;
  else htAW+=p;
}
console.log(`[HT] O0.5=${(htOver05*100).toFixed(1)}% O1.5=${(htOver15*100).toFixed(1)}% HW=${(htHW*100).toFixed(1)}% D=${(htD*100).toFixed(1)}% AW=${(htAW*100).toFixed(1)}%`);

// 9. No-vig probabilities from book
const nvHome = mlToProb(BOOK.homeMl);
const nvDraw = mlToProb(BOOK.draw);
const nvAway = mlToProb(BOOK.awayMl);
const nvTotal = nvHome + nvDraw + nvAway;
const nvHomeNorm = nvHome / nvTotal;
const nvDrawNorm = nvDraw / nvTotal;
const nvAwayNorm = nvAway / nvTotal;
console.log(`[NO-VIG] H=${(nvHomeNorm*100).toFixed(1)}% D=${(nvDrawNorm*100).toFixed(1)}% A=${(nvAwayNorm*100).toFixed(1)}%`);

// No-vig DC
const nvDC1x = mlToProb(BOOK.homeWD);
const nvDCx2 = mlToProb(BOOK.awayWD);
const nvNoDraw = mlToProb(BOOK.noDraw);
const nvDCTotal = nvDC1x + nvDCx2 + nvNoDraw;
console.log(`[NO-VIG DC] 1X=${(nvDC1x/nvDCTotal*100).toFixed(1)}% X2=${(nvDCx2/nvDCTotal*100).toFixed(1)}% 12=${(nvNoDraw/nvDCTotal*100).toFixed(1)}%`);

// 10. Edges
const homeEdge = pH - nvHomeNorm;
const drawEdge = pD - nvDrawNorm;
const awayEdge = pA - nvAwayNorm;
console.log(`[EDGE] H=${(homeEdge*100).toFixed(2)}% D=${(drawEdge*100).toFixed(2)}% A=${(awayEdge*100).toFixed(2)}%`);

// 11. Model lean
let modelLean, leanProb;
if (homeEdge > drawEdge && homeEdge > awayEdge) { modelLean = 'HOME'; leanProb = pH; }
else if (awayEdge > homeEdge && awayEdge > drawEdge) { modelLean = 'AWAY'; leanProb = pA; }
else { modelLean = 'DRAW'; leanProb = pD; }
console.log(`[LEAN] ${modelLean} (${(leanProb*100).toFixed(1)}%)`);

// 12. Advanced metrics
const favFragility = Math.min(pH, pA) / Math.max(pH, pA); // closer to 1 = more fragile favorite
const drawQuality = pD / 0.33; // >1 means draw is more likely than average
const underdogViability = Math.min(pH, pA); // probability of the underdog winning
const xgBalanceRatio = Math.min(lambdaH, lambdaA) / Math.max(lambdaH, lambdaA);
console.log(`[ADVANCED] fragility=${favFragility.toFixed(3)} drawQ=${drawQuality.toFixed(3)} underdogV=${(underdogViability*100).toFixed(1)}% xgBalance=${xgBalanceRatio.toFixed(3)}`);

// ═══ DB UPDATE ═══
const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log('[DB] Connected. Executing UPDATE...');

await conn.query(`
  UPDATE wc2026_model_projections SET
    home_win_prob = ?,
    draw_prob = ?,
    away_win_prob = ?,
    proj_spread = ?,
    over_0_5 = ?,
    over_1_5 = ?,
    over_2_5 = ?,
    under_2_5 = ?,
    over_3_5 = ?,
    over_4_5 = ?,
    btts_prob = ?,
    home_clean_sheet = ?,
    away_clean_sheet = ?,
    ht_over_0_5 = ?,
    ht_over_1_5 = ?,
    ht_home_win = ?,
    ht_draw = ?,
    ht_away_win = ?,
    model_spread_raw = ?,
    model_total_raw = ?,
    nv_home_prob = ?,
    nv_draw_prob = ?,
    nv_away_prob = ?,
    home_edge = ?,
    draw_edge = ?,
    away_edge = ?,
    model_lean = ?,
    lean_prob = ?,
    fav_fragility_score = ?,
    draw_quality_score = ?,
    underdog_viability = ?,
    xg_balance_ratio = ?,
    book_odds = ?,
    top_scorelines = ?,
    home_goal_dist = ?,
    away_goal_dist = ?,
    home_win_by_1 = ?,
    home_win_by_2 = ?,
    home_win_by_3plus = ?,
    away_win_by_1 = ?,
    away_win_by_2 = ?,
    away_win_by_3plus = ?,
    nv_dc_1x = ?,
    nv_dc_x2 = ?,
    dc_1x_odds = ?,
    dc_x2_odds = ?,
    nv_no_draw_home = ?,
    nv_no_draw_away = ?,
    no_draw_home_odds = ?,
    no_draw_away_odds = ?,
    to_advance_home_prob = ?,
    to_advance_away_prob = ?,
    calculation_method = 'ANALYTICAL_DIXON_COLES',
    xg_source = 'ESPN_WC2026_TOURNAMENT'
  WHERE match_id = ?
`, [
  pH, pD, pA,
  lambdaH - lambdaA, // proj_spread (negative = away favored)
  over05, over15, over25, under25, over35, over45,
  pBTTS, homeCS, awayCS,
  htOver05, htOver15, htHW, htD, htAW,
  lambdaH - lambdaA, // model_spread_raw
  lambdaH + lambdaA, // model_total_raw
  nvHomeNorm, nvDrawNorm, nvAwayNorm,
  homeEdge, drawEdge, awayEdge,
  modelLean, leanProb,
  favFragility, drawQuality, underdogViability, xgBalanceRatio,
  JSON.stringify(BOOK), // book_odds
  JSON.stringify(top5), // top_scorelines
  JSON.stringify(homeGoalDist), // home_goal_dist
  JSON.stringify(awayGoalDist), // away_goal_dist
  hWin1, hWin2, hWin3p,
  aWin1, aWin2, aWin3p,
  nvDC1x/nvDCTotal, nvDCx2/nvDCTotal, // nv_dc_1x, nv_dc_x2
  probToML(pH+pD), probToML(pA+pD), // dc_1x_odds, dc_x2_odds
  nvNoDraw/nvDCTotal, nvNoDraw/nvDCTotal, // nv_no_draw_home, nv_no_draw_away (same)
  probToML(pH+pA), probToML(pH+pA), // no_draw_home_odds, no_draw_away_odds (NoDraw = either team wins)
  pAdvH, pAdvA,
  MATCH_ID
]);

console.log('[DB] UPDATE complete. Verifying...');

// Verify
const [rows] = await conn.query('SELECT * FROM wc2026_model_projections WHERE match_id = ?', [MATCH_ID]);
const row = rows[0];
const nullCols = Object.entries(row).filter(([k,v]) => v === null && k !== 'frozen_at' && k !== 'integrity_flags' && k !== 'full_output').map(([k])=>k);
console.log(`[VERIFY] NULL columns remaining (excl optional): ${nullCols.length > 0 ? nullCols.join(', ') : 'NONE ✅'}`);
if (nullCols.length > 0) console.log(`[WARN] ${nullCols.length} columns still NULL`);
else console.log('[PASS] ALL columns populated ✅');

await conn.end();
process.exit(0);
