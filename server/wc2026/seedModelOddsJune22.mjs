/**
 * seedModelOddsJune22.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 22 Model Projections — Dixon-Coles Poisson v4.2 Corrected
 *
 * RECALIBRATION PARAMETERS (v4.2, from 132-match cumulative backtest):
 *   draw_floor += 0.097  (actual draw rate 22.7% vs model 10.6%, delta=+12.1pp)
 *   lambda_mult = 1.00   (REMOVED — book total line already reflects 2026 pace)
 *   rank_diff_discount = 0.04 when rank_diff > 40 (unchanged)
 *   blend weights: w_book=0.25, w_elo=0.40, w_rank=0.15, w_form=0.20
 *   n_simulations = 1,000,000
 *
 * JUNE 22 FIXTURES (DB verified):
 *   wc26-g-043: Austria (aut, DB home) vs Argentina (arg, DB away) — Group F, 17:00 UTC
 *   wc26-g-041: Iraq (irq, DB home) vs France (fra, DB away) — Group E, 21:00 UTC
 *   wc26-g-042: Norway (nor, DB home) vs Senegal (sen, DB away) — Group A, 00:00 UTC Jun 23
 *   wc26-g-044: Algeria (alg, DB home) vs Jordan (jor, DB away) — Group B, 03:00 UTC Jun 23
 *
 * VENUES (from wc2026_venues):
 *   wc26-g-043: AT&T Stadium, Arlington TX — 184m elevation
 *   wc26-g-041: Lincoln Financial Field, Philadelphia PA — 12m elevation
 *   wc26-g-042: MetLife Stadium, East Rutherford NJ — 2m elevation
 *   wc26-g-044: Levi's Stadium, Santa Clara CA — 8m elevation
 *
 * DK BOOK ODDS (confirmed from DK screenshot, seeded in wc2026_odds_snapshots book_id=68):
 *   AUT vs ARG: AUT +600 / Draw +320 / ARG -190 | Total: O2.5 -105 / U2.5 -120
 *   IRQ vs FRA: IRQ +3000 / Draw +1100 / FRA -1200 | Total: O3.5 -115 / U3.5 -110
 *   NOR vs SEN: NOR +125 / Draw +255 / SEN +220 | Total: O2.5 -115 / U2.5 -110
 *   ALG vs JOR: ALG -180 / Draw +330 / JOR +500 | Total: O2.5 -115 / U2.5 -110
 *
 * TEAM RATINGS (Elo, FIFA ranking, form — June 2026):
 *   Argentina: Elo=2080, FIFA=1, Form=0.86 (dominant in CONMEBOL qualifying)
 *   Austria: Elo=1780, FIFA=25, Form=0.60 (solid UEFA Nations League run)
 *   France: Elo=2020, FIFA=3, Form=0.80 (strong qualifying, Mbappé-led)
 *   Iraq: Elo=1640, FIFA=65, Form=0.42 (AFC qualifier, inconsistent)
 *   Norway: Elo=1820, FIFA=19, Form=0.72 (Haaland-led, strong qualifying)
 *   Senegal: Elo=1790, FIFA=20, Form=0.68 (AFCON form, Mané-era)
 *   Algeria: Elo=1750, FIFA=30, Form=0.62 (AFCON qualifier, solid)
 *   Jordan: Elo=1580, FIFA=70, Form=0.40 (AFC qualifier, limited)
 *
 * LOGGING: [WC_MODEL_JUNE22] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_MODEL_JUNE22]';
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v4.2-corrected-june22';
const N_SIMULATIONS = 1_000_000;

// ─── Utility: American odds to no-vig probability ────────────────────────────
function americanToProb(ml) {
  if (!ml || isNaN(ml)) return null;
  return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
}
function noVigProbs(homeML, drawML, awayML) {
  const rawH = americanToProb(homeML);
  const rawD = americanToProb(drawML);
  const rawA = americanToProb(awayML);
  const sum = rawH + rawD + rawA;
  return { h: rawH / sum, d: rawD / sum, a: rawA / sum };
}
function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}

// ─── Utility: Poisson PMF ────────────────────────────────────────────────────
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// ─── Utility: Dixon-Coles correction ─────────────────────────────────────────
function dixonColesRho(homeGoals, awayGoals, lambdaH, lambdaA, rho = -0.13) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaH * lambdaA * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaH * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaA * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

// ─── Core: Monte Carlo simulation ────────────────────────────────────────────
function runMonteCarlo(lambdaH, lambdaA, nSims = N_SIMULATIONS) {
  const scoreCounts = {};
  let totalGoals = 0;
  const homeGoalDist = new Array(8).fill(0);
  const awayGoalDist = new Array(8).fill(0);
  const maxGoals = 7;
  const pmfH = [], pmfA = [];
  let sumH = 0, sumA = 0;
  for (let g = 0; g <= maxGoals; g++) {
    pmfH.push(poissonPmf(g, lambdaH));
    pmfA.push(poissonPmf(g, lambdaA));
    sumH += pmfH[g];
    sumA += pmfA[g];
  }
  for (let g = 0; g <= maxGoals; g++) {
    pmfH[g] /= sumH;
    pmfA[g] /= sumA;
  }
  const cdfH = [], cdfA = [];
  let cumH = 0, cumA = 0;
  for (let g = 0; g <= maxGoals; g++) {
    cumH += pmfH[g];
    cumA += pmfA[g];
    cdfH.push(cumH);
    cdfA.push(cumA);
  }
  for (let i = 0; i < nSims; i++) {
    const rH = Math.random();
    const rA = Math.random();
    let gH = 0, gA = 0;
    while (gH < maxGoals && rH > cdfH[gH]) gH++;
    while (gA < maxGoals && rA > cdfA[gA]) gA++;
    totalGoals += gH + gA;
    const key = `${gH}-${gA}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;
    if (gH <= 7) homeGoalDist[gH]++;
    if (gA <= 7) awayGoalDist[gA]++;
  }
  let homeWins = 0, draws = 0, awayWins = 0;
  for (const [score, count] of Object.entries(scoreCounts)) {
    const [h, a] = score.split('-').map(Number);
    if (h > a) homeWins += count;
    else if (h < a) awayWins += count;
    else draws += count;
  }
  const avgGoals = totalGoals / nSims;
  const homeWinProb = homeWins / nSims;
  const drawProb = draws / nSims;
  const awayWinProb = awayWins / nSims;
  const topScorelines = Object.entries(scoreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([score, count]) => ({ score, prob: (count / nSims).toFixed(4) }));
  const over05 = 1 - (scoreCounts['0-0'] || 0) / nSims;
  const over15 = 1 - (
    ((scoreCounts['0-0'] || 0) + (scoreCounts['1-0'] || 0) + (scoreCounts['0-1'] || 0)) / nSims
  );
  const over25 = Object.entries(scoreCounts)
    .filter(([s]) => s.split('-').map(Number).reduce((a, b) => a + b, 0) > 2)
    .reduce((sum, [, c]) => sum + c, 0) / nSims;
  const over35 = Object.entries(scoreCounts)
    .filter(([s]) => s.split('-').map(Number).reduce((a, b) => a + b, 0) > 3)
    .reduce((sum, [, c]) => sum + c, 0) / nSims;
  const over45 = Object.entries(scoreCounts)
    .filter(([s]) => s.split('-').map(Number).reduce((a, b) => a + b, 0) > 4)
    .reduce((sum, [, c]) => sum + c, 0) / nSims;
  const btts = Object.entries(scoreCounts)
    .filter(([s]) => { const [h, a] = s.split('-').map(Number); return h > 0 && a > 0; })
    .reduce((sum, [, c]) => sum + c, 0) / nSims;
  return {
    homeWinProb, drawProb, awayWinProb,
    avgGoals, over05, over15, over25, over35, over45, btts,
    topScorelines,
    homeGoalDist: homeGoalDist.map(c => c / nSims),
    awayGoalDist: awayGoalDist.map(c => c / nSims),
  };
}

// ─── Core: Compute model projection for a fixture ────────────────────────────
function computeModelProjection(fixture) {
  const {
    matchId, homeName, homeCode, awayName, awayCode,
    eloHome, eloAway,
    fifaRankHome, fifaRankAway,
    formHome, formAway,
    altitudeM,
    bookHomeML, bookDrawML, bookAwayML,
    bookOverML, bookUnderML, bookTotalLine,
  } = fixture;

  console.log(`\n${TAG} ════════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] ${homeName} (${homeCode}) vs ${awayName} (${awayCode})`);
  console.log(`${TAG} [INPUT] matchId=${matchId}`);
  console.log(`${TAG} [INPUT] Elo: home=${eloHome} away=${eloAway} | FIFA rank: home=${fifaRankHome} away=${fifaRankAway}`);
  console.log(`${TAG} [INPUT] Form: home=${formHome} away=${formAway} | Altitude: ${altitudeM}m`);
  console.log(`${TAG} [INPUT] DK ML: home=${bookHomeML > 0 ? '+' : ''}${bookHomeML} draw=${bookDrawML > 0 ? '+' : ''}${bookDrawML} away=${bookAwayML > 0 ? '+' : ''}${bookAwayML}`);
  console.log(`${TAG} [INPUT] DK Total: ${bookTotalLine} | over=${bookOverML > 0 ? '+' : ''}${bookOverML} under=${bookUnderML > 0 ? '+' : ''}${bookUnderML}`);

  // ── Step 1: Elo-based win probability ─────────────────────────────────────
  const ELO_K = 400;
  const eloDiff = eloHome - eloAway;
  const eloWinH = 1 / (1 + Math.pow(10, -eloDiff / ELO_K));
  const eloWinA = 1 - eloWinH;
  // Elo doesn't model draws natively; allocate draw from geometric mean
  const eloDrawBase = 2 * Math.sqrt(eloWinH * eloWinA) * 0.28;
  const eloH = eloWinH * (1 - eloDrawBase);
  const eloD = eloDrawBase;
  const eloA = eloWinA * (1 - eloDrawBase);
  console.log(`${TAG} [STEP 1] Elo probs: H=${eloH.toFixed(4)} D=${eloD.toFixed(4)} A=${eloA.toFixed(4)}`);

  // ── Step 2: Book no-vig probabilities ─────────────────────────────────────
  const bookNV = noVigProbs(bookHomeML, bookDrawML, bookAwayML);
  console.log(`${TAG} [STEP 2] Book NV probs: H=${bookNV.h.toFixed(4)} D=${bookNV.d.toFixed(4)} A=${bookNV.a.toFixed(4)}`);

  // ── Step 3: FIFA rank-based adjustment ────────────────────────────────────
  const rankDiff = fifaRankAway - fifaRankHome; // positive = home is better ranked
  const rankFactor = Math.tanh(rankDiff / 50) * 0.15;
  const rankH = 0.33 + rankFactor;
  const rankA = 0.33 - rankFactor;
  const rankD = 1 - rankH - rankA;
  console.log(`${TAG} [STEP 3] Rank probs: H=${rankH.toFixed(4)} D=${rankD.toFixed(4)} A=${rankA.toFixed(4)} (rankDiff=${rankDiff})`);

  // ── Step 4: Form-based adjustment ─────────────────────────────────────────
  const formDiff = formHome - formAway;
  const formFactor = Math.tanh(formDiff * 2) * 0.10;
  const formH = 0.33 + formFactor;
  const formA = 0.33 - formFactor;
  const formD = 1 - formH - formA;
  console.log(`${TAG} [STEP 4] Form probs: H=${formH.toFixed(4)} D=${formD.toFixed(4)} A=${formA.toFixed(4)} (formDiff=${formDiff.toFixed(3)})`);

  // ── Step 5: Blend all signals (v4.2 weights) ──────────────────────────────
  const W_ELO = 0.40, W_BOOK = 0.25, W_RANK = 0.15, W_FORM = 0.20;
  let blendH = W_ELO * eloH + W_BOOK * bookNV.h + W_RANK * rankH + W_FORM * formH;
  let blendD = W_ELO * eloD + W_BOOK * bookNV.d + W_RANK * rankD + W_FORM * formD;
  let blendA = W_ELO * eloA + W_BOOK * bookNV.a + W_RANK * rankA + W_FORM * formA;
  const blendSum = blendH + blendD + blendA;
  blendH /= blendSum; blendD /= blendSum; blendA /= blendSum;
  console.log(`${TAG} [STEP 5] Blended probs: H=${blendH.toFixed(4)} D=${blendD.toFixed(4)} A=${blendA.toFixed(4)}`);
  console.log(`${TAG} [STEP 5] vs book NV: H${((blendH-bookNV.h)*100).toFixed(2)}pp D${((blendD-bookNV.d)*100).toFixed(2)}pp A${((blendA-bookNV.a)*100).toFixed(2)}pp`);

  // ── Step 6: Recalibration — draw floor (v4.2: +0.097 from 132-match backtest) ──
  const DRAW_FLOOR_BOOST = 0.097;
  const probDiff = Math.abs(blendH - blendA);
  let recalH = blendH, recalD = blendD, recalA = blendA;
  if (probDiff < 0.25) {
    const boost = DRAW_FLOOR_BOOST * (1 - probDiff / 0.25);
    recalD = Math.min(0.45, blendD + boost);
    const reduction = (recalD - blendD) / 2;
    recalH = Math.max(0.05, blendH - reduction);
    recalA = Math.max(0.05, blendA - reduction);
    console.log(`${TAG} [STEP 6] Draw floor applied: probDiff=${probDiff.toFixed(4)} < 0.25 | boost=${boost.toFixed(4)}`);
    console.log(`${TAG} [STEP 6] After draw floor: H=${recalH.toFixed(4)} D=${recalD.toFixed(4)} A=${recalA.toFixed(4)}`);
  } else {
    console.log(`${TAG} [STEP 6] Draw floor NOT applied (probDiff=${probDiff.toFixed(4)} >= 0.25)`);
  }

  // ── Step 7: Rank diff discount for heavy favorites ─────────────────────────
  const absFifaRankDiff = Math.abs(fifaRankHome - fifaRankAway);
  if (absFifaRankDiff > 40) {
    const RANK_DISCOUNT = 0.04;
    if (recalH > recalA) {
      recalH = Math.max(0.05, recalH - RANK_DISCOUNT);
      recalA = Math.min(0.90, recalA + RANK_DISCOUNT * 0.5);
      recalD = Math.min(0.45, recalD + RANK_DISCOUNT * 0.5);
    } else {
      recalA = Math.max(0.05, recalA - RANK_DISCOUNT);
      recalH = Math.min(0.90, recalH + RANK_DISCOUNT * 0.5);
      recalD = Math.min(0.45, recalD + RANK_DISCOUNT * 0.5);
    }
    console.log(`${TAG} [STEP 7] Rank diff discount applied (rankDiff=${absFifaRankDiff}): H=${recalH.toFixed(4)} D=${recalD.toFixed(4)} A=${recalA.toFixed(4)}`);
  } else {
    console.log(`${TAG} [STEP 7] Rank diff discount NOT applied (rankDiff=${absFifaRankDiff} <= 40)`);
  }

  // Re-normalize
  const recalSum = recalH + recalD + recalA;
  recalH /= recalSum; recalD /= recalSum; recalA /= recalSum;
  console.log(`${TAG} [STATE] Final recalibrated probs: H=${recalH.toFixed(4)} D=${recalD.toFixed(4)} A=${recalA.toFixed(4)}`);

  // ── Step 8: Derive Poisson lambdas from recalibrated probs ────────────────
  // v4.2 AUDIT FIX: NO lambda_mult — book total line already reflects 2026 pace.
  const altitudeFactor = Math.exp(-altitudeM / 8000);
  const expectedTotalGoals = bookTotalLine * altitudeFactor;
  const lambdaH = expectedTotalGoals * (recalH / (recalH + recalA)) * (1 + formHome * 0.05);
  const lambdaA = expectedTotalGoals * (recalA / (recalH + recalA)) * (1 + formAway * 0.05);
  console.log(`${TAG} [STEP 8] Lambdas (v4.2 — no lambda_mult): H=${lambdaH.toFixed(4)} A=${lambdaA.toFixed(4)}`);
  console.log(`${TAG} [STEP 8] expectedTotal=${expectedTotalGoals.toFixed(4)} | altFactor=${altitudeFactor.toFixed(4)}`);
  console.log(`${TAG} [VERIFY] lambdaH+lambdaA=${(lambdaH+lambdaA).toFixed(4)} vs bookTotalLine=${bookTotalLine} | ratio=${((lambdaH+lambdaA)/bookTotalLine).toFixed(4)}`);

  // ── Step 9: Run 1M Monte Carlo simulations ────────────────────────────────
  console.log(`${TAG} [STEP 9] Running ${N_SIMULATIONS.toLocaleString()} Monte Carlo simulations...`);
  const startMs = Date.now();
  const mc = runMonteCarlo(lambdaH, lambdaA, N_SIMULATIONS);
  const elapsedMs = Date.now() - startMs;
  console.log(`${TAG} [STATE] MC complete in ${elapsedMs}ms: H=${mc.homeWinProb.toFixed(4)} D=${mc.drawProb.toFixed(4)} A=${mc.awayWinProb.toFixed(4)}`);
  console.log(`${TAG} [STATE] MC avg goals: ${mc.avgGoals.toFixed(3)} | O0.5=${mc.over05.toFixed(4)} O1.5=${mc.over15.toFixed(4)} O2.5=${mc.over25.toFixed(4)} O3.5=${mc.over35.toFixed(4)}`);
  console.log(`${TAG} [STATE] MC BTTS: ${mc.btts.toFixed(4)} | Top scorelines: ${mc.topScorelines.slice(0,5).map(s => `${s.score}(${s.prob})`).join(' ')}`);

  // ── Step 10: Blend MC with recalibrated probs (w_mc=0.60, w_recal=0.40) ──
  const W_MC = 0.60, W_RECAL = 0.40;
  let finalH = W_MC * mc.homeWinProb + W_RECAL * recalH;
  let finalD = W_MC * mc.drawProb + W_RECAL * recalD;
  let finalA = W_MC * mc.awayWinProb + W_RECAL * recalA;
  const finalSum = finalH + finalD + finalA;
  finalH /= finalSum; finalD /= finalSum; finalA /= finalSum;
  console.log(`${TAG} [STEP 10] Final blended probs: H=${finalH.toFixed(4)} D=${finalD.toFixed(4)} A=${finalA.toFixed(4)}`);

  // ── Step 11: Convert to American ML odds ─────────────────────────────────
  const modelHomeML = probToAmerican(finalH);
  const modelDrawML = probToAmerican(finalD);
  const modelAwayML = probToAmerican(finalA);
  console.log(`${TAG} [STEP 11] Model ML: home=${modelHomeML > 0 ? '+' : ''}${modelHomeML} draw=${modelDrawML > 0 ? '+' : ''}${modelDrawML} away=${modelAwayML > 0 ? '+' : ''}${modelAwayML}`);

  // ── Step 12: Compute over/under model odds ────────────────────────────────
  const overLineProb = bookTotalLine === 2.5 ? mc.over25 :
                       bookTotalLine === 3.5 ? mc.over35 :
                       bookTotalLine === 1.5 ? mc.over15 : mc.over25;
  const underLineProb = 1 - overLineProb;
  const modelOverML = probToAmerican(overLineProb);
  const modelUnderML = probToAmerican(underLineProb);
  const bookOverNV = americanToProb(bookOverML) / (americanToProb(bookOverML) + americanToProb(bookUnderML));
  const bookUnderNV = 1 - bookOverNV;
  console.log(`${TAG} [STEP 12] Model O${bookTotalLine}=${modelOverML > 0 ? '+' : ''}${modelOverML} U${bookTotalLine}=${modelUnderML > 0 ? '+' : ''}${modelUnderML}`);
  console.log(`${TAG} [STEP 12] Book NV: O=${(bookOverNV*100).toFixed(2)}% U=${(bookUnderNV*100).toFixed(2)}% | Model: O=${(overLineProb*100).toFixed(2)}% U=${(underLineProb*100).toFixed(2)}%`);

  // ── Step 13: Compute Double Chance model odds ─────────────────────────────
  const modelHomeDrawML = probToAmerican(finalH + finalD);
  const modelAwayDrawML = probToAmerican(finalA + finalD);
  console.log(`${TAG} [STEP 13] Model DC: 1X(home/draw)=${modelHomeDrawML > 0 ? '+' : ''}${modelHomeDrawML} X2(away/draw)=${modelAwayDrawML > 0 ? '+' : ''}${modelAwayDrawML}`);

  // ── Step 14: Edge detection ───────────────────────────────────────────────
  const homeEdge = finalH - bookNV.h;
  const drawEdge = finalD - bookNV.d;
  const awayEdge = finalA - bookNV.a;
  const modelLean = finalH > finalA ? 'H' : 'A';
  const leanProb = modelLean === 'H' ? finalH : finalA;
  const leanName = modelLean === 'H' ? homeName : awayName;
  console.log(`${TAG} [STEP 14] Edges: H=${(homeEdge*100).toFixed(2)}pp D=${(drawEdge*100).toFixed(2)}pp A=${(awayEdge*100).toFixed(2)}pp`);
  console.log(`${TAG} [STEP 14] Lean: ${leanName} (${(leanProb*100).toFixed(1)}%)`);

  // ── Step 15: Model total line ─────────────────────────────────────────────
  const modelTotalLine = bookTotalLine; // Use book line for display alignment
  console.log(`${TAG} [STEP 15] Model total line: ${modelTotalLine} (aligned to book)`);

  return {
    lambdaH, lambdaA,
    finalH, finalD, finalA,
    mc,
    modelHomeML, modelDrawML, modelAwayML,
    modelTotalLine, modelOverML, modelUnderML,
    modelHomeDrawML, modelAwayDrawML,
    homeEdge, drawEdge, awayEdge,
    modelLean, leanProb, leanName,
    overLineProb, underLineProb, bookOverNV, bookUnderNV,
  };
}

// ─── Fixture definitions ─────────────────────────────────────────────────────
const FIXTURES = [
  {
    matchId: 'wc26-g-043',
    // DB: home=aut, away=arg | DK display: Argentina on top (DK home) but DB has Austria as home
    homeName: 'Austria', homeCode: 'aut',
    awayName: 'Argentina', awayCode: 'arg',
    // Elo: Argentina is one of the top 2 teams in the world; Austria solid UEFA
    eloHome: 1780, eloAway: 2080,
    // FIFA rankings June 2026
    fifaRankHome: 25, fifaRankAway: 1,
    // Form: Argentina dominant; Austria solid
    formHome: 0.60, // AUT: 3W 0D 2L in last 5 (UEFA NL)
    formAway: 0.86, // ARG: 4W 1D 0L (CONMEBOL qualifying)
    // Venue: AT&T Stadium, Arlington TX — 184m elevation
    altitudeM: 184,
    // DK book odds (DB orientation: home=aut, away=arg)
    bookHomeML: 600,   // Austria (DB home)
    bookDrawML: 320,
    bookAwayML: -190,  // Argentina (DB away)
    bookTotalLine: 2.5, bookOverML: -105, bookUnderML: -120,
  },
  {
    matchId: 'wc26-g-041',
    // DB: home=irq, away=fra
    homeName: 'Iraq', homeCode: 'irq',
    awayName: 'France', awayCode: 'fra',
    // Elo: France world-class; Iraq improving AFC side
    eloHome: 1640, eloAway: 2020,
    // FIFA rankings June 2026
    fifaRankHome: 65, fifaRankAway: 3,
    // Form: France dominant; Iraq inconsistent
    formHome: 0.42, // IRQ: 2W 1D 2L (AFC qualifying)
    formAway: 0.80, // FRA: 4W 1D 0L (Mbappé-led)
    // Venue: Lincoln Financial Field, Philadelphia PA — 12m elevation
    altitudeM: 12,
    // DK book odds (DB orientation: home=irq, away=fra)
    bookHomeML: 3000,  // Iraq (DB home)
    bookDrawML: 1100,
    bookAwayML: -1200, // France (DB away)
    bookTotalLine: 3.5, bookOverML: -115, bookUnderML: -110,
  },
  {
    matchId: 'wc26-g-042',
    // DB: home=nor, away=sen
    homeName: 'Norway', homeCode: 'nor',
    awayName: 'Senegal', awayCode: 'sen',
    // Elo: Norway Haaland-led; Senegal AFCON champion
    eloHome: 1820, eloAway: 1790,
    // FIFA rankings June 2026
    fifaRankHome: 19, fifaRankAway: 20,
    // Form: Norway strong qualifying; Senegal solid AFCON
    formHome: 0.72, // NOR: 3W 1D 1L (UEFA qualifying)
    formAway: 0.68, // SEN: 3W 1D 1L (AFCON + qualifying)
    // Venue: MetLife Stadium, East Rutherford NJ — 2m elevation
    altitudeM: 2,
    // DK book odds (DB orientation: home=nor, away=sen)
    bookHomeML: 125,   // Norway (DB home)
    bookDrawML: 255,
    bookAwayML: 220,   // Senegal (DB away)
    bookTotalLine: 2.5, bookOverML: -115, bookUnderML: -110,
  },
  {
    matchId: 'wc26-g-044',
    // DB: home=alg, away=jor
    homeName: 'Algeria', homeCode: 'alg',
    awayName: 'Jordan', awayCode: 'jor',
    // Elo: Algeria solid AFCON side; Jordan AFC qualifier
    eloHome: 1750, eloAway: 1580,
    // FIFA rankings June 2026
    fifaRankHome: 30, fifaRankAway: 70,
    // Form: Algeria solid; Jordan limited
    formHome: 0.62, // ALG: 3W 1D 1L (AFCON qualifying)
    formAway: 0.40, // JOR: 2W 0D 3L (AFC qualifying)
    // Venue: Levi's Stadium, Santa Clara CA — 8m elevation
    altitudeM: 8,
    // DK book odds (DB orientation: home=alg, away=jor)
    bookHomeML: -180,  // Algeria (DB home)
    bookDrawML: 330,
    bookAwayML: 500,   // Jordan (DB away)
    bookTotalLine: 2.5, bookOverML: -115, bookUnderML: -110,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} WC 2026 JUNE 22 MODEL — Dixon-Coles Poisson v4.2 Corrected`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} Model version: ${MODEL_VERSION}`);
  console.log(`${TAG} N_SIMULATIONS: ${N_SIMULATIONS.toLocaleString()}`);
  console.log(`${TAG} v4.2 changes: lambda_mult REMOVED | w_book=0.25 w_elo=0.40 w_form=0.20`);
  console.log(`${TAG} Recalibration: draw_floor=+0.097 rank_discount=0.04@>40`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date();
  let totalInserted = 0;
  let totalErrors = 0;
  const results = [];

  for (const fixture of FIXTURES) {
    try {
      const proj = computeModelProjection(fixture);
      results.push({ fixture, proj });

      // ── Delete existing model rows for this fixture ──────────────────────
      await conn.execute(
        `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ?`,
        [fixture.matchId, MODEL_BOOK_ID]
      );

      // ── Insert model odds rows ────────────────────────────────────────────
      const modelRows = [
        { market: '1X2', selection: 'home', odds: proj.modelHomeML, line: null },
        { market: '1X2', selection: 'draw', odds: proj.modelDrawML, line: null },
        { market: '1X2', selection: 'away', odds: proj.modelAwayML, line: null },
        { market: 'TOTAL', selection: 'over',  odds: proj.modelOverML,  line: fixture.bookTotalLine },
        { market: 'TOTAL', selection: 'under', odds: proj.modelUnderML, line: fixture.bookTotalLine },
        { market: 'DOUBLE_CHANCE', selection: 'home_draw', odds: proj.modelHomeDrawML, line: null },
        { market: 'DOUBLE_CHANCE', selection: 'away_draw', odds: proj.modelAwayDrawML, line: null },
      ];

      for (const row of modelRows) {
        const impliedProb = row.odds > 0 ? 100 / (row.odds + 100) : Math.abs(row.odds) / (Math.abs(row.odds) + 100);
        await conn.execute(
          `INSERT INTO wc2026_odds_snapshots
             (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [fixture.matchId, snapshotTs, MODEL_BOOK_ID, row.market, row.selection,
           row.line, row.odds, impliedProb, false]
        );
        totalInserted++;
      }

      // ── Insert into wc2026_model_projections ─────────────────────────────
      await conn.execute(`
        INSERT INTO wc2026_model_projections (
          match_id, model_version, n_simulations,
          home_team, away_team,
          home_lambda, away_lambda,
          home_win_prob, draw_prob, away_win_prob,
          proj_home_score, proj_away_score, proj_total,
          over_0_5, over_1_5, over_2_5, under_2_5, over_3_5, over_4_5,
          btts_prob,
          model_home_ml, model_draw_ml, model_away_ml,
          model_total, over_odds, under_odds,
          nv_home_prob, nv_draw_prob, nv_away_prob,
          home_edge, draw_edge, away_edge,
          model_lean, lean_prob,
          top_scorelines, home_goal_dist, away_goal_dist,
          modeled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          model_version = VALUES(model_version),
          n_simulations = VALUES(n_simulations),
          home_lambda = VALUES(home_lambda),
          away_lambda = VALUES(away_lambda),
          home_win_prob = VALUES(home_win_prob),
          draw_prob = VALUES(draw_prob),
          away_win_prob = VALUES(away_win_prob),
          proj_home_score = VALUES(proj_home_score),
          proj_away_score = VALUES(proj_away_score),
          proj_total = VALUES(proj_total),
          over_2_5 = VALUES(over_2_5),
          under_2_5 = VALUES(under_2_5),
          btts_prob = VALUES(btts_prob),
          model_home_ml = VALUES(model_home_ml),
          model_draw_ml = VALUES(model_draw_ml),
          model_away_ml = VALUES(model_away_ml),
          model_total = VALUES(model_total),
          over_odds = VALUES(over_odds),
          under_odds = VALUES(under_odds),
          nv_home_prob = VALUES(nv_home_prob),
          nv_draw_prob = VALUES(nv_draw_prob),
          nv_away_prob = VALUES(nv_away_prob),
          home_edge = VALUES(home_edge),
          draw_edge = VALUES(draw_edge),
          away_edge = VALUES(away_edge),
          model_lean = VALUES(model_lean),
          lean_prob = VALUES(lean_prob),
          top_scorelines = VALUES(top_scorelines),
          home_goal_dist = VALUES(home_goal_dist),
          away_goal_dist = VALUES(away_goal_dist),
          modeled_at = NOW()
      `, [
        fixture.matchId, MODEL_VERSION, N_SIMULATIONS,
        fixture.homeCode, fixture.awayCode,
        proj.lambdaH, proj.lambdaA,
        proj.finalH, proj.finalD, proj.finalA,
        proj.lambdaH, proj.lambdaA, proj.mc.avgGoals,
        proj.mc.over05, proj.mc.over15, proj.mc.over25, 1 - proj.mc.over25, proj.mc.over35, proj.mc.over45,
        proj.mc.btts,
        proj.modelHomeML, proj.modelDrawML, proj.modelAwayML,
        proj.modelTotalLine, proj.modelOverML, proj.modelUnderML,
        proj.finalH, proj.finalD, proj.finalA,
        proj.homeEdge, proj.drawEdge, proj.awayEdge,
        proj.modelLean, proj.leanProb,
        JSON.stringify(proj.mc.topScorelines),
        JSON.stringify(proj.mc.homeGoalDist),
        JSON.stringify(proj.mc.awayGoalDist),
      ]);

      console.log(`${TAG} [OUTPUT] ${fixture.matchId}: ML home=${proj.modelHomeML > 0 ? '+' : ''}${proj.modelHomeML} draw=${proj.modelDrawML > 0 ? '+' : ''}${proj.modelDrawML} away=${proj.modelAwayML > 0 ? '+' : ''}${proj.modelAwayML}`);
      console.log(`${TAG} [OUTPUT] ${fixture.matchId}: Total=${proj.modelTotalLine} O${fixture.bookTotalLine}=${proj.modelOverML > 0 ? '+' : ''}${proj.modelOverML} U${fixture.bookTotalLine}=${proj.modelUnderML > 0 ? '+' : ''}${proj.modelUnderML}`);
      console.log(`${TAG} [OUTPUT] ${fixture.matchId}: DC 1X=${proj.modelHomeDrawML > 0 ? '+' : ''}${proj.modelHomeDrawML} X2=${proj.modelAwayDrawML > 0 ? '+' : ''}${proj.modelAwayDrawML}`);
      console.log(`${TAG} [OUTPUT] ${fixture.matchId}: Lean=${proj.modelLean}(${(proj.leanProb*100).toFixed(1)}%) Edges: H=${(proj.homeEdge*100).toFixed(2)}pp D=${(proj.drawEdge*100).toFixed(2)}pp A=${(proj.awayEdge*100).toFixed(2)}pp`);

    } catch (err) {
      totalErrors++;
      console.error(`${TAG} [ERROR] ${fixture.matchId}: ${err.message}`);
      console.error(err.stack);
    }
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} JUNE 22 MODEL SEED COMPLETE (v4.2 Corrected)`);
  console.log(`${TAG} Fixtures processed: ${FIXTURES.length} | Rows inserted: ${totalInserted} | Errors: ${totalErrors}`);
  console.log(`\n${TAG} PROJECTIONS SUMMARY:`);
  for (const { fixture, proj } of results) {
    const overEdge = (proj.overLineProb - proj.bookOverNV) * 100;
    const underEdge = (proj.underLineProb - proj.bookUnderNV) * 100;
    const bestTotalEdge = overEdge > underEdge ? `O${fixture.bookTotalLine} +${overEdge.toFixed(2)}pp` : `U${fixture.bookTotalLine} +${underEdge.toFixed(2)}pp`;
    console.log(`${TAG}   ${fixture.homeName} vs ${fixture.awayName}: lean=${proj.leanName} | ML H=${proj.modelHomeML > 0 ? '+' : ''}${proj.modelHomeML} D=${proj.modelDrawML > 0 ? '+' : ''}${proj.modelDrawML} A=${proj.modelAwayML > 0 ? '+' : ''}${proj.modelAwayML} | ${bestTotalEdge}`);
  }

  // ── Verify DB state ────────────────────────────────────────────────────────
  const matchIds = FIXTURES.map(f => f.matchId);
  const ph = matchIds.map(() => '?').join(',');
  const [verifyRows] = await conn.execute(
    `SELECT match_id, book_id, market, selection, american_odds FROM wc2026_odds_snapshots
     WHERE match_id IN (${ph}) AND book_id IN (0, 68)
     ORDER BY match_id, book_id, market, selection`,
    matchIds
  );
  const modelRows = verifyRows.filter(r => r.book_id === 0);
  const dkRows = verifyRows.filter(r => r.book_id === 68);
  console.log(`\n${TAG} [VERIFY] DB state: model rows=${modelRows.length} DK rows=${dkRows.length}`);
  const expectedModelRows = FIXTURES.length * 7;
  const expectedDkRows = FIXTURES.length * 7;
  const modelPass = modelRows.length === expectedModelRows;
  const dkPass = dkRows.length === expectedDkRows;
  console.log(`${TAG} [VERIFY] Model rows: ${modelPass ? '✅' : '❌'} expected=${expectedModelRows} actual=${modelRows.length}`);
  console.log(`${TAG} [VERIFY] DK rows: ${dkPass ? '✅' : '❌'} expected=${expectedDkRows} actual=${dkRows.length}`);
  console.log(`${TAG} [VERIFY] Errors: ${totalErrors === 0 ? '✅ 0' : '❌ ' + totalErrors}`);

  if (totalErrors > 0) {
    console.error(`${TAG} [FATAL] ${totalErrors} errors detected.`);
    await conn.end();
    process.exit(1);
  }

  await conn.end();
  console.log(`\n${TAG} DB connection closed. Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
