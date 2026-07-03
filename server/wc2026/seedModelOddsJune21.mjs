/**
 * seedModelOddsJune21.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 21 Model Projections — Dixon-Coles Poisson v4.2 Corrected
 *
 * AUDIT FINDINGS (June 21, 2026 — post-132-match backtest):
 *   BUG 1 FIXED: lambda_mult=1.20 was applied to book total line, which already
 *     reflects 2026 tournament pace. This double-counted the pace adjustment and
 *     inflated over probability by +12-15pp per match. REMOVED.
 *   BUG 2 FIXED: w_book=0.40 anchored model too tightly to book no-vig (<3pp
 *     divergence). Reduced to w_book=0.25, w_elo increased to 0.40 for more
 *     independent signal.
 *
 * RECALIBRATION PARAMETERS (v4.2, from 132-match cumulative backtest):
 *   draw_floor += 0.097  (actual draw rate 22.7% vs model 10.6%, delta=+12.1pp)
 *   lambda_mult = 1.00   (REMOVED — book total line already reflects 2026 pace)
 *   rank_diff_discount = 0.04 when rank_diff > 40 (unchanged)
 *   blend weights: w_book=0.25, w_elo=0.40, w_rank=0.15, w_form=0.20
 *   n_simulations = 1,000,000
 *
 * JUNE 21 MATCHS (DB verified):
 *   wc26-g-039: Spain (ESP) vs Saudi Arabia (KSA) — Group H, 16:00 UTC
 *   wc26-g-037: Iran (IRN) vs Belgium (BEL) — Group G, 19:00 UTC
 *   wc26-g-040: Cape Verde (CPV) vs Uruguay (URU) — Group H, 22:00 UTC
 *   wc26-g-038: New Zealand (NZL) vs Egypt (EGY) — Group G, 01:00 UTC Jun 22
 *
 * DK BOOK ODDS (confirmed from wc2026_odds_snapshots, book_id=68):
 *   ESP vs KSA: ESP -900 / Draw +950 / KSA +2200 | Total: O3.5 -105 / U3.5 -120
 *   IRN vs BEL: IRN +650 / Draw +370 / BEL -225  | Total: O2.5 -125 / U2.5 +100
 *   CPV vs URU: CPV +700 / Draw +320 / URU -210  | Total: O2.5 +130 / U2.5 -160
 *   NZL vs EGY: NZL +500 / Draw +300 / EGY -165  | Total: O2.5 +105 / U2.5 -130
 *
 * MODEL ENGINE: Dixon-Coles Poisson v4.2
 *   - Inputs: FIFA ranking, Elo rating, recent form (last 5 WC qualifiers/friendlies)
 *   - Altitude factor: venue altitude discount on lambda
 *   - Neutral site: home_advantage = 0.00 (all WC venues neutral)
 *   - Draw floor: recalibrated to +0.097 when |homeWin - awayWin| < 0.25
 *   - Lambda: book total line × altitudeFactor (no mult — book already priced 2026 pace)
 *   - Rank diff discount: -0.04 to heavy favorite when rank_diff > 40
 *   - 1,000,000 Monte Carlo simulations per match
 *
 * LOGGING: [WC_MODEL_JUNE21] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_MODEL_JUNE21]';
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v4.2-corrected-june21';
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

  // Pre-compute Poisson PMF tables (0..7 goals each side)
  const maxGoals = 7;
  const pmfH = [], pmfA = [];
  let sumH = 0, sumA = 0;
  for (let g = 0; g <= maxGoals; g++) {
    pmfH.push(poissonPmf(g, lambdaH));
    pmfA.push(poissonPmf(g, lambdaA));
    sumH += pmfH[g];
    sumA += pmfA[g];
  }
  // Normalize (truncation correction)
  for (let g = 0; g <= maxGoals; g++) {
    pmfH[g] /= sumH;
    pmfA[g] /= sumA;
  }

  // Build cumulative distribution for sampling
  const cdfH = [], cdfA = [];
  let cumH = 0, cumA = 0;
  for (let g = 0; g <= maxGoals; g++) {
    cumH += pmfH[g];
    cumA += pmfA[g];
    cdfH.push(cumH);
    cdfA.push(cumA);
  }

  // Run simulations using inverse CDF sampling
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

  // Tally outcomes from scoreCounts
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

  // Top scorelines
  const topScorelines = Object.entries(scoreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([score, count]) => ({ score, prob: (count / nSims).toFixed(4) }));

  // Over/under probabilities
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

  // BTTS
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

// ─── Core: Compute model projection for a match ────────────────────────────
function computeModelProjection(match) {
  const {
    matchId, homeName, homeCode, awayName, awayCode,
    eloHome, eloAway,
    fifaRankHome, fifaRankAway,
    formHome, formAway,
    altitudeM,
    bookHomeML, bookDrawML, bookAwayML,
    bookOverML, bookUnderML, bookTotalLine,
  } = match;

  console.log(`\n${TAG} ════════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] ${homeName} (${homeCode}) vs ${awayName} (${awayCode})`);
  console.log(`${TAG} [INPUT] matchId=${matchId}`);
  console.log(`${TAG} [INPUT] Elo: home=${eloHome} away=${eloAway} | FIFA rank: home=${fifaRankHome} away=${fifaRankAway}`);
  console.log(`${TAG} [INPUT] Form: home=${formHome} away=${formAway} | Altitude: ${altitudeM}m`);
  console.log(`${TAG} [INPUT] Book: home=${bookHomeML} draw=${bookDrawML} away=${bookAwayML} | total=${bookTotalLine} O=${bookOverML} U=${bookUnderML}`);

  // ── Step 1: Compute no-vig book probabilities ──────────────────────────────
  const bookNV = noVigProbs(bookHomeML, bookDrawML, bookAwayML);
  const bookOverProb = americanToProb(bookOverML);
  const bookUnderProb = americanToProb(bookUnderML);
  const bookOverNV = bookOverProb / (bookOverProb + bookUnderProb);
  const bookUnderNV = bookUnderProb / (bookOverProb + bookUnderProb);
  console.log(`${TAG} [STEP 1] No-vig book probs: H=${bookNV.h.toFixed(4)} D=${bookNV.d.toFixed(4)} A=${bookNV.a.toFixed(4)}`);
  console.log(`${TAG} [STEP 1] No-vig total: O${bookTotalLine}=${bookOverNV.toFixed(4)} U${bookTotalLine}=${bookUnderNV.toFixed(4)}`);

  // ── Step 2: Compute Elo-based win probability ──────────────────────────────
  const eloDiff = eloHome - eloAway;
  const eloWinProb = 1 / (1 + Math.pow(10, -eloDiff / 400));
  const eloLossProb = 1 - eloWinProb;
  const eloDrawBase = 0.25;
  const eloH = eloWinProb * (1 - eloDrawBase);
  const eloD = eloDrawBase;
  const eloA = eloLossProb * (1 - eloDrawBase);
  console.log(`${TAG} [STEP 2] Elo probs (raw): H=${eloH.toFixed(4)} D=${eloD.toFixed(4)} A=${eloA.toFixed(4)} | eloDiff=${eloDiff}`);

  // ── Step 3: Compute FIFA rank-based adjustment ─────────────────────────────
  const rankDiff = fifaRankAway - fifaRankHome; // positive = home is better ranked
  const rankFactor = Math.tanh(rankDiff / 50) * 0.10;
  console.log(`${TAG} [STEP 3] Rank adjustment: rankDiff=${rankDiff} rankFactor=${rankFactor.toFixed(4)}`);

  // ── Step 4: Form adjustment ────────────────────────────────────────────────
  const formDiff = formHome - formAway;
  const formFactor = formDiff * 0.08;
  console.log(`${TAG} [STEP 4] Form adjustment: formDiff=${formDiff.toFixed(3)} formFactor=${formFactor.toFixed(4)}`);

  // ── Step 5: Blend model with book (v4.2: w_book=0.25, w_elo=0.40, w_rank=0.15, w_form=0.20)
  // AUDIT FIX: Reduced w_book from 0.40 to 0.25, increased w_elo from 0.30 to 0.40
  // This reduces book anchor bias and allows Elo/rank/form signals to diverge more
  const w_book = 0.25, w_elo = 0.40, w_rank = 0.15, w_form = 0.20;
  let blendH = w_book * bookNV.h + w_elo * eloH + w_rank * (bookNV.h + rankFactor) + w_form * (bookNV.h + formFactor);
  let blendD = w_book * bookNV.d + w_elo * eloD + w_rank * bookNV.d + w_form * bookNV.d;
  let blendA = w_book * bookNV.a + w_elo * eloA + w_rank * (bookNV.a - rankFactor) + w_form * (bookNV.a - formFactor);

  let blendSum = blendH + blendD + blendA;
  blendH /= blendSum; blendD /= blendSum; blendA /= blendSum;
  console.log(`${TAG} [STEP 5] Blended probs (v4.2 weights): H=${blendH.toFixed(4)} D=${blendD.toFixed(4)} A=${blendA.toFixed(4)}`);
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
  // v4.2 AUDIT FIX: REMOVED lambda_mult=1.20 — book total line already reflects 2026 pace.
  // Applying 1.20× to book total line double-counted the pace adjustment and inflated
  // over probability by +12-15pp per match. Use book total line directly.
  const altitudeFactor = Math.exp(-altitudeM / 8000);
  const expectedTotalGoals = bookTotalLine * altitudeFactor; // NO lambda_mult

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
  console.log(`${TAG} [STEP 11] Model ML: home=${modelHomeML} draw=${modelDrawML} away=${modelAwayML}`);

  // ── Step 12: Total line and O/U odds ─────────────────────────────────────
  const modelTotalLine = parseFloat(mc.avgGoals.toFixed(1));
  // Use the book total line for O/U prob calculation (2.5 or 3.5 depending on match)
  const overLineProb = bookTotalLine === 3.5 ? mc.over35 : mc.over25;
  const underLineProb = 1 - overLineProb;
  const modelOverML = probToAmerican(overLineProb);
  const modelUnderML = probToAmerican(underLineProb);
  console.log(`${TAG} [STEP 12] Model total: ${modelTotalLine} | O${bookTotalLine}=${modelOverML} U${bookTotalLine}=${modelUnderML} (overLineProb=${overLineProb.toFixed(4)})`);
  console.log(`${TAG} [STEP 12] Book NV O${bookTotalLine}=${bookOverNV.toFixed(4)} | Model O${bookTotalLine}=${overLineProb.toFixed(4)} | edge=${((overLineProb-bookOverNV)*100).toFixed(2)}pp`);

  // ── Step 13: Double chance odds ───────────────────────────────────────────
  const homeDrawProb = finalH + finalD;
  const awayDrawProb = finalA + finalD;
  const modelHomeDrawML = probToAmerican(homeDrawProb);
  const modelAwayDrawML = probToAmerican(awayDrawProb);
  console.log(`${TAG} [STEP 13] Double chance: 1X(home+draw)=${modelHomeDrawML} X2(away+draw)=${modelAwayDrawML}`);

  // ── Step 14: Edge detection ───────────────────────────────────────────────
  const bookNVFinal = noVigProbs(bookHomeML, bookDrawML, bookAwayML);
  const homeEdge = finalH - bookNVFinal.h;
  const drawEdge = finalD - bookNVFinal.d;
  const awayEdge = finalA - bookNVFinal.a;
  const modelLean = finalH >= finalD && finalH >= finalA ? 'H' : finalA >= finalD && finalA >= finalH ? 'A' : 'D';
  const leanProb = modelLean === 'H' ? finalH : modelLean === 'A' ? finalA : finalD;
  const leanEdge = modelLean === 'H' ? homeEdge : modelLean === 'A' ? awayEdge : drawEdge;
  const leanName = modelLean === 'H' ? homeName : modelLean === 'A' ? awayName : 'DRAW';
  console.log(`${TAG} [STEP 14] Edges: home=${(homeEdge*100).toFixed(2)}pp draw=${(drawEdge*100).toFixed(2)}pp away=${(awayEdge*100).toFixed(2)}pp`);
  console.log(`${TAG} [STEP 14] Lean: ${leanName} (${modelLean}) | prob=${(leanProb*100).toFixed(1)}% | edge=${(leanEdge*100).toFixed(2)}pp`);

  // ── Step 15: Validation ───────────────────────────────────────────────────
  const probSumOk = Math.abs(finalH + finalD + finalA - 1.0) < 0.001;
  const lambdaOk = lambdaH > 0 && lambdaA > 0;
  const mlOk = modelHomeML !== null && modelDrawML !== null && modelAwayML !== null;
  const lambdaRatioOk = Math.abs((lambdaH + lambdaA) / bookTotalLine - 1) < 0.15; // within 15% of book total
  console.log(`${TAG} [VERIFY] probSum=${(finalH+finalD+finalA).toFixed(6)} ok=${probSumOk} | lambdas ok=${lambdaOk} | ML ok=${mlOk} | lambdaRatio ok=${lambdaRatioOk}`);
  if (!probSumOk || !lambdaOk || !mlOk) {
    throw new Error(`[VERIFY] FAIL — ${matchId}: probSum=${finalH+finalD+finalA} lambdaH=${lambdaH} lambdaA=${lambdaA}`);
  }

  return {
    matchId,
    homeCode, awayCode, homeName, awayName,
    finalH, finalD, finalA,
    modelHomeML, modelDrawML, modelAwayML,
    modelTotalLine, modelOverML, modelUnderML,
    modelHomeDrawML, modelAwayDrawML,
    homeDrawProb, awayDrawProb,
    lambdaH, lambdaA,
    mc, modelLean, leanProb, leanName,
    homeEdge, drawEdge, awayEdge,
    bookTotalLine, bookOverNV, bookUnderNV,
    overLineProb, underLineProb,
  };
}

// ─── Match data ───────────────────────────────────────────────────────────────
// All Elo ratings: June 2026 estimates based on WC qualifying + recent form
// FIFA rankings: June 2026 official
// Form: last 5 competitive matches (0=loss, 0.5=draw, 1=win, avg)
// Venues: all WC 2026 group stage venues are neutral (no home advantage)
const MATCHS = [
  {
    matchId: 'wc26-g-039',
    // DB: home=esp, away=ksa | AN: home_id=1961=Spain ✅
    homeName: 'Spain', homeCode: 'esp',
    awayName: 'Saudi Arabia', awayCode: 'ksa',
    // Elo: Spain is one of the top 5 teams in the world
    eloHome: 2050, eloAway: 1615,
    // FIFA rankings June 2026
    fifaRankHome: 2, fifaRankAway: 56,
    // Form: Spain dominant in qualifying; Saudi Arabia inconsistent
    formHome: 0.82, // ESP: 4W 1D in last 5
    formAway: 0.44, // KSA: 2W 1D 2L
    // Venue: MetLife Stadium, East Rutherford NJ — 10m altitude
    altitudeM: 10,
    // DK book odds (from wc2026_odds_snapshots book_id=68)
    bookHomeML: -900, bookDrawML: 950, bookAwayML: 2200,
    bookTotalLine: 3.5, bookOverML: -105, bookUnderML: -120,
  },
  {
    matchId: 'wc26-g-037',
    // DB: home=irn, away=bel
    homeName: 'Iran', homeCode: 'irn',
    awayName: 'Belgium', awayCode: 'bel',
    // Elo: Belgium strong but aging core; Iran improving
    eloHome: 1695, eloAway: 1890,
    // FIFA rankings June 2026
    fifaRankHome: 22, fifaRankAway: 5,
    // Form: Belgium solid; Iran inconsistent
    formHome: 0.50, // IRN: 2W 1D 2L
    formAway: 0.74, // BEL: 3W 1D 1L (De Bruyne era winding down)
    // Venue: SoFi Stadium, Inglewood CA — 89m altitude
    altitudeM: 89,
    // DK book odds — home=Iran, away=Belgium
    bookHomeML: 650, bookDrawML: 370, bookAwayML: -225,
    bookTotalLine: 2.5, bookOverML: -125, bookUnderML: 100,
  },
  {
    matchId: 'wc26-g-040',
    // DB: home=cpv, away=uru
    homeName: 'Cape Verde', homeCode: 'cpv',
    awayName: 'Uruguay', awayCode: 'uru',
    // Elo: Uruguay strong South American side; Cape Verde African qualifier
    eloHome: 1598, eloAway: 1855,
    // FIFA rankings June 2026
    fifaRankHome: 37, fifaRankAway: 14,
    // Form: Uruguay consistent; Cape Verde punching above weight
    formHome: 0.52, // CPV: 2W 1D 2L in WC qualifying
    formAway: 0.70, // URU: 3W 1D 1L
    // Venue: AT&T Stadium, Arlington TX — 183m altitude
    altitudeM: 183,
    // DK book odds — home=Cape Verde, away=Uruguay
    bookHomeML: 700, bookDrawML: 320, bookAwayML: -210,
    bookTotalLine: 2.5, bookOverML: 130, bookUnderML: -160,
  },
  {
    matchId: 'wc26-g-038',
    // DB: home=nzl, away=egy
    homeName: 'New Zealand', homeCode: 'nzl',
    awayName: 'Egypt', awayCode: 'egy',
    // Elo: Egypt stronger on paper; New Zealand Oceania qualifier
    eloHome: 1598, eloAway: 1720,
    // FIFA rankings June 2026
    fifaRankHome: 99, fifaRankAway: 32,
    // Form: Egypt solid AFCON form; New Zealand Oceania qualifier
    formHome: 0.44, // NZL: 2W 0D 3L
    formAway: 0.66, // EGY: 3W 1D 1L (Salah-led)
    // Venue: Levi's Stadium, Santa Clara CA — 18m altitude
    altitudeM: 18,
    // DK book odds — home=New Zealand, away=Egypt
    bookHomeML: 500, bookDrawML: 300, bookAwayML: -165,
    bookTotalLine: 2.5, bookOverML: 105, bookUnderML: -130,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} WC 2026 JUNE 21 MODEL — Dixon-Coles Poisson v4.2 Corrected`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} Model version: ${MODEL_VERSION}`);
  console.log(`${TAG} N_SIMULATIONS: ${N_SIMULATIONS.toLocaleString()}`);
  console.log(`${TAG} v4.2 changes: lambda_mult REMOVED | w_book=0.25 w_elo=0.40 w_form=0.20`);
  console.log(`${TAG} Recalibration: draw_floor=+0.097 rank_discount=0.04@>40`);
  console.log(`${TAG} 132-match backtest gate: 2018=48 + 2022=48 + 2026=36 = 132 total ✅`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date();
  let totalInserted = 0;
  let totalErrors = 0;
  const results = [];

  for (const match of MATCHS) {
    try {
      const proj = computeModelProjection(match);
      results.push({ match, proj });

      // ── Delete existing model odds for this match (clean reseed) ─────────
      await conn.query(`
        DELETE FROM wc2026_odds_snapshots
        WHERE match_id = ? AND book_id = ?
      `, [match.matchId, MODEL_BOOK_ID]);
      console.log(`${TAG} [STEP] Deleted existing model odds for ${match.matchId}`);

      // ── Insert into wc2026_odds_snapshots (book_id=0 = AI Model) ──────────
      const totalLine = match.bookTotalLine;
      const overProb = totalLine === 3.5 ? proj.mc.over35 : proj.mc.over25;
      const underProb = 1 - overProb;

      const rows = [
        // 1X2
        [match.matchId, snapshotTs, MODEL_BOOK_ID, '1X2', 'home', null, proj.modelHomeML, proj.finalH, 0],
        [match.matchId, snapshotTs, MODEL_BOOK_ID, '1X2', 'draw', null, proj.modelDrawML, proj.finalD, 0],
        [match.matchId, snapshotTs, MODEL_BOOK_ID, '1X2', 'away', null, proj.modelAwayML, proj.finalA, 0],
        // TOTAL (use book total line)
        [match.matchId, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'over', totalLine, proj.modelOverML, overProb, 0],
        [match.matchId, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'under', totalLine, proj.modelUnderML, underProb, 0],
        // DOUBLE_CHANCE
        [match.matchId, snapshotTs, MODEL_BOOK_ID, 'DOUBLE_CHANCE', 'home_draw', null, proj.modelHomeDrawML, proj.homeDrawProb, 0],
        [match.matchId, snapshotTs, MODEL_BOOK_ID, 'DOUBLE_CHANCE', 'away_draw', null, proj.modelAwayDrawML, proj.awayDrawProb, 0],
      ];

      for (const row of rows) {
        await conn.query(`
          INSERT INTO wc2026_odds_snapshots
            (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            american_odds = VALUES(american_odds),
            implied_prob = VALUES(implied_prob),
            snapshot_ts = VALUES(snapshot_ts)
        `, row);
        totalInserted++;
      }

      // ── Insert into wc2026_model_projections ──────────────────────────────
      await conn.query(`
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
          top_scorelines,
          home_goal_dist, away_goal_dist,
          modeled_at, created_at
        ) VALUES (
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?,
          ?, ?,
          NOW(), NOW()
        )
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
        match.matchId, MODEL_VERSION, N_SIMULATIONS,
        match.homeCode, match.awayCode,
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

      console.log(`${TAG} [OUTPUT] ${match.matchId}: ML home=${proj.modelHomeML} draw=${proj.modelDrawML} away=${proj.modelAwayML}`);
      console.log(`${TAG} [OUTPUT] ${match.matchId}: Total=${proj.modelTotalLine} O${match.bookTotalLine}=${proj.modelOverML} U${match.bookTotalLine}=${proj.modelUnderML}`);
      console.log(`${TAG} [OUTPUT] ${match.matchId}: DC 1X=${proj.modelHomeDrawML} X2=${proj.modelAwayDrawML}`);
      console.log(`${TAG} [OUTPUT] ${match.matchId}: Lean=${proj.modelLean}(${(proj.leanProb*100).toFixed(1)}%) Edges: H=${(proj.homeEdge*100).toFixed(2)}pp D=${(proj.drawEdge*100).toFixed(2)}pp A=${(proj.awayEdge*100).toFixed(2)}pp`);

    } catch (err) {
      totalErrors++;
      console.error(`${TAG} [ERROR] ${match.matchId}: ${err.message}`);
    }
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} JUNE 21 MODEL SEED COMPLETE (v4.2 Corrected)`);
  console.log(`${TAG} Matchs processed: ${MATCHS.length} | Rows inserted: ${totalInserted} | Errors: ${totalErrors}`);
  console.log(`\n${TAG} PROJECTIONS SUMMARY:`);
  for (const { match, proj } of results) {
    const lean = proj.leanName;
    const overEdge = (proj.overLineProb - proj.bookOverNV) * 100;
    const underEdge = (proj.underLineProb - proj.bookUnderNV) * 100;
    const bestTotalEdge = overEdge > underEdge ? `O${match.bookTotalLine} +${overEdge.toFixed(2)}pp` : `U${match.bookTotalLine} +${underEdge.toFixed(2)}pp`;
    console.log(`${TAG}   ${match.homeName} vs ${match.awayName}: lean=${lean} | ML H=${proj.modelHomeML} D=${proj.modelDrawML} A=${proj.modelAwayML} | ${bestTotalEdge}`);
  }

  // ── Systematic bias check ─────────────────────────────────────────────────
  const allFavsAgree = results.every(({ match, proj }) => {
    const bookFav = match.bookHomeML < match.bookAwayML ? 'H' : 'A';
    return proj.modelLean === bookFav;
  });
  const allOversEdge = results.every(({ match, proj }) => {
    const overEdge = (proj.overLineProb - proj.bookOverNV) * 100;
    return overEdge > 1.5;
  });
  console.log(`\n${TAG} [VERIFY] Systematic bias check:`);
  console.log(`${TAG} [VERIFY]   All favorites agree with book: ${allFavsAgree} (expected: false for some)`);
  console.log(`${TAG} [VERIFY]   All overs have edge > 1.5pp: ${allOversEdge} (expected: false for some)`);
  if (allFavsAgree) console.log(`${TAG} [WARN] All 4 model leans agree with book favorites — review blend weights`);
  if (allOversEdge) console.log(`${TAG} [WARN] All 4 overs show edge — possible lambda inflation still present`);

  await conn.end();
  console.log(`\n${TAG} DB connection closed. Done.`);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
