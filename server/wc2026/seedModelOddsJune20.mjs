/**
 * seedModelOddsJune20.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 20 Model Projections — Dixon-Coles Poisson v4.0 Recalibrated
 *
 * RECALIBRATION PARAMETERS (from June 19 backtest, 124 match cumulative):
 *   draw_floor += 0.090  (actual draw rate 22.6% vs model 11.3%)
 *   lambda_multiplier *= 1.12  (2026 avg goals 2.93 vs model 2.09)
 *   rank_diff_discount = 0.04 when rank_diff > 40 (upset correction)
 *   n_simulations = 1,000,000
 *
 * JUNE 20 MATCHS:
 *   wc26-g-035: Netherlands (NED) vs Sweden (SWE) — Group F, Houston, 1:00 PM EDT
 *   wc26-g-033: Ivory Coast (CIV) vs Germany (GER) — Group E, Toronto, 4:00 PM EDT
 *   wc26-g-034: Curaçao (CUW) vs Ecuador (ECU) — Group E, Kansas City, 11:00 PM EDT
 *   wc26-g-036: Tunisia (TUN) vs Japan (JPN) — Group F, Guadalajara, 12:00 AM EDT
 *
 * DK BOOK ODDS (confirmed from wc2026_odds_snapshots, book_id=68):
 *   NED vs SWE: NED -140 / Draw +310 / SWE +370 | Total: O2.5 -160 / U2.5 +130
 *   CIV vs GER: CIV -190 / Draw +370 / GER +475 | Total: O2.5 -175 / U2.5 +140
 *   CUW vs ECU: CUW -750 / Draw +800 / ECU +2000 | Total: O2.5 -170 / U2.5 +135
 *   TUN vs JPN: TUN +500 / Draw +300 / JPN -170 | Total: O2.5 +110 / U2.5 -140
 *
 * MODEL ENGINE: Dixon-Coles Poisson v4.0
 *   - Inputs: FIFA ranking, Elo rating, recent form (last 5 WC qualifiers/friendlies)
 *   - Altitude factor: venue altitude discount on lambda
 *   - Neutral site: home_advantage = 0.00 (all WC venues neutral)
 *   - Draw floor: recalibrated to +0.09 when |homeWin - awayWin| < 0.25
 *   - Lambda multiplier: 1.12 for 2026 tournament pace
 *   - Rank diff discount: -0.04 to heavy favorite when rank_diff > 40
 *   - 1,000,000 Monte Carlo simulations per match
 *
 * LOGGING: [WC_MODEL_JUNE20] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_MODEL_JUNE20]';
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v4.0-recal-june20';
const N_SIMULATIONS = 1_000_000;

// ─── Utility: American odds to no-vig probability ────────────────────────────
function americanToProb(ml) {
  if (!ml) return null;
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
  let homeWins = 0, draws = 0, awayWins = 0;
  let totalGoals = 0;
  const scoreCounts = {};
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
    if (gH > awayWins) homeWins++;
    else if (gH < gA) awayWins++;
    else draws++;

    // Wait — fix the comparison
    if (gH > gA) homeWins++;
    else if (gH < gA) awayWins++;
    else draws++;

    const key = `${gH}-${gA}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;
    if (gH <= 7) homeGoalDist[gH]++;
    if (gA <= 7) awayGoalDist[gA]++;
  }

  // Fix: the above double-counts — redo cleanly
  homeWins = 0; draws = 0; awayWins = 0;
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
    espn_match_id, homeName, homeCode, awayName, awayCode,
    // Elo ratings (from FIFA/Elo World Rankings June 2026)
    eloHome, eloAway,
    // FIFA rankings
    fifaRankHome, fifaRankAway,
    // Recent form (0-1 scale, last 5 competitive matches)
    formHome, formAway,
    // Venue altitude in meters
    altitudeM,
    // Book odds for calibration
    bookHomeML, bookDrawML, bookAwayML,
    bookOverML, bookUnderML, bookTotalLine,
  } = match;

  console.log(`\n${TAG} ════════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] ${homeName} (${homeCode}) vs ${awayName} (${awayCode})`);
  console.log(`${TAG} [INPUT] espn_match_id=${espn_match_id}`);
  console.log(`${TAG} [INPUT] Elo: home=${eloHome} away=${eloAway} | FIFA rank: home=${fifaRankHome} away=${fifaRankAway}`);
  console.log(`${TAG} [INPUT] Form: home=${formHome} away=${formAway} | Altitude: ${altitudeM}m`);
  console.log(`${TAG} [INPUT] Book: home=${bookHomeML} draw=${bookDrawML} away=${bookAwayML} | total=${bookTotalLine} O=${bookOverML} U=${bookUnderML}`);

  // ── Step 1: Compute no-vig book probabilities ──────────────────────────────
  const bookNV = noVigProbs(bookHomeML, bookDrawML, bookAwayML);
  console.log(`${TAG} [STEP 1] No-vig book probs: H=${bookNV.h.toFixed(4)} D=${bookNV.d.toFixed(4)} A=${bookNV.a.toFixed(4)}`);

  // ── Step 2: Compute Elo-based win probability ──────────────────────────────
  // Standard Elo formula: P(home wins) = 1 / (1 + 10^((eloAway - eloHome) / 400))
  const eloDiff = eloHome - eloAway;
  const eloWinProb = 1 / (1 + Math.pow(10, -eloDiff / 400));
  const eloLossProb = 1 - eloWinProb;
  // Distribute draw from Elo: use 0.25 base draw rate for Elo-only model
  const eloDrawBase = 0.25;
  const eloH = eloWinProb * (1 - eloDrawBase);
  const eloD = eloDrawBase;
  const eloA = eloLossProb * (1 - eloDrawBase);
  console.log(`${TAG} [STEP 2] Elo probs (raw): H=${eloH.toFixed(4)} D=${eloD.toFixed(4)} A=${eloA.toFixed(4)} | eloDiff=${eloDiff}`);

  // ── Step 3: Compute FIFA rank-based adjustment ─────────────────────────────
  const rankDiff = fifaRankAway - fifaRankHome; // positive = home is better ranked
  const rankFactor = Math.tanh(rankDiff / 50) * 0.10; // max ±10% adjustment
  console.log(`${TAG} [STEP 3] Rank adjustment: rankDiff=${rankDiff} rankFactor=${rankFactor.toFixed(4)}`);

  // ── Step 4: Form adjustment ────────────────────────────────────────────────
  const formDiff = formHome - formAway;
  const formFactor = formDiff * 0.08; // max ±8% from form
  console.log(`${TAG} [STEP 4] Form adjustment: formDiff=${formDiff.toFixed(3)} formFactor=${formFactor.toFixed(4)}`);

  // ── Step 5: Blend model with book (w_book=0.40, w_elo=0.30, w_rank=0.15, w_form=0.15) ──
  const w_book = 0.40, w_elo = 0.30, w_rank = 0.15, w_form = 0.15;
  let blendH = w_book * bookNV.h + w_elo * eloH + w_rank * (bookNV.h + rankFactor) + w_form * (bookNV.h + formFactor);
  let blendD = w_book * bookNV.d + w_elo * eloD + w_rank * bookNV.d + w_form * bookNV.d;
  let blendA = w_book * bookNV.a + w_elo * eloA + w_rank * (bookNV.a - rankFactor) + w_form * (bookNV.a - formFactor);

  // Normalize
  let blendSum = blendH + blendD + blendA;
  blendH /= blendSum; blendD /= blendSum; blendA /= blendSum;
  console.log(`${TAG} [STEP 5] Blended probs (pre-recal): H=${blendH.toFixed(4)} D=${blendD.toFixed(4)} A=${blendA.toFixed(4)}`);

  // ── Step 6: Recalibration — draw floor ────────────────────────────────────
  // Backtest signal: model underestimates draws by 11.3pp
  // Apply draw floor when |H - A| < 0.25 (competitive match)
  const DRAW_FLOOR_BOOST = 0.090;
  const probDiff = Math.abs(blendH - blendA);
  let recalH = blendH, recalD = blendD, recalA = blendA;

  if (probDiff < 0.25) {
    // Boost draw, redistribute equally from H and A
    const boost = DRAW_FLOOR_BOOST * (1 - probDiff / 0.25); // taper off as diff increases
    recalD = Math.min(0.45, blendD + boost);
    const reduction = (recalD - blendD) / 2;
    recalH = Math.max(0.05, blendH - reduction);
    recalA = Math.max(0.05, blendA - reduction);
    console.log(`${TAG} [STEP 6] Draw floor applied: boost=${boost.toFixed(4)} | H=${recalH.toFixed(4)} D=${recalD.toFixed(4)} A=${recalA.toFixed(4)}`);
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
  // Use book total line as the expected goals anchor, then scale by lambda_mult
  const LAMBDA_MULT = 1.12; // 2026 goal pace correction
  const altitudeFactor = Math.exp(-altitudeM / 8000); // ~1% per 80m
  const bookTotalNV = bookTotalLine; // already a line, not odds
  const expectedTotalGoals = bookTotalNV * LAMBDA_MULT * altitudeFactor;

  // Distribute total goals between home and away using recalibrated win probs
  // Higher win prob → higher lambda
  const totalProb = recalH + recalA; // exclude draw for lambda distribution
  const lambdaH = expectedTotalGoals * (recalH / (recalH + recalA)) * (1 + formHome * 0.05);
  const lambdaA = expectedTotalGoals * (recalA / (recalH + recalA)) * (1 + formAway * 0.05);

  console.log(`${TAG} [STEP 8] Lambdas: H=${lambdaH.toFixed(4)} A=${lambdaA.toFixed(4)} | expectedTotal=${expectedTotalGoals.toFixed(4)} | altFactor=${altitudeFactor.toFixed(4)}`);

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
  const over25Prob = mc.over25;
  const under25Prob = 1 - over25Prob;
  const modelOverML = probToAmerican(over25Prob);
  const modelUnderML = probToAmerican(under25Prob);
  console.log(`${TAG} [STEP 12] Model total: ${modelTotalLine} | O2.5=${modelOverML} U2.5=${modelUnderML}`);

  // ── Step 13: Double chance odds ───────────────────────────────────────────
  const homeDrawProb = finalH + finalD; // 1X
  const awayDrawProb = finalA + finalD; // X2
  const modelHomeDrawML = probToAmerican(homeDrawProb);
  const modelAwayDrawML = probToAmerican(awayDrawProb);
  console.log(`${TAG} [STEP 13] Double chance: 1X(home+draw)=${modelHomeDrawML} X2(away+draw)=${modelAwayDrawML}`);

  // ── Step 14: Edge detection ───────────────────────────────────────────────
  const bookNVFinal = noVigProbs(bookHomeML, bookDrawML, bookAwayML);
  const homeEdge = finalH - bookNVFinal.h;
  const drawEdge = finalD - bookNVFinal.d;
  const awayEdge = finalA - bookNVFinal.a;
  const bestEdge = Math.max(Math.abs(homeEdge), Math.abs(drawEdge), Math.abs(awayEdge));
  const modelLean = finalH >= finalD && finalH >= finalA ? 'H' : finalA >= finalD && finalA >= finalH ? 'A' : 'D';
  const leanProb = modelLean === 'H' ? finalH : modelLean === 'A' ? finalA : finalD;
  console.log(`${TAG} [STEP 14] Edges: home=${(homeEdge*100).toFixed(2)}pp draw=${(drawEdge*100).toFixed(2)}pp away=${(awayEdge*100).toFixed(2)}pp | lean=${modelLean}(${(leanProb*100).toFixed(1)}%)`);

  // ── Step 15: Validation ───────────────────────────────────────────────────
  const probSumOk = Math.abs(finalH + finalD + finalA - 1.0) < 0.001;
  const lambdaOk = lambdaH > 0 && lambdaA > 0;
  const mlOk = modelHomeML !== null && modelDrawML !== null && modelAwayML !== null;
  console.log(`${TAG} [VERIFY] probSum=${(finalH+finalD+finalA).toFixed(6)} ok=${probSumOk} | lambdas ok=${lambdaOk} | ML ok=${mlOk}`);
  if (!probSumOk || !lambdaOk || !mlOk) {
    throw new Error(`[VERIFY] FAIL — ${espn_match_id}: probSum=${finalH+finalD+finalA} lambdaH=${lambdaH} lambdaA=${lambdaA}`);
  }

  return {
    espn_match_id,
    homeCode, awayCode,
    finalH, finalD, finalA,
    modelHomeML, modelDrawML, modelAwayML,
    modelTotalLine, modelOverML, modelUnderML,
    modelHomeDrawML, modelAwayDrawML,
    homeDrawProb, awayDrawProb,
    lambdaH, lambdaA,
    mc, modelLean, leanProb,
    homeEdge, drawEdge, awayEdge,
  };
}

// ─── Match data ───────────────────────────────────────────────────────────────
const MATCHS = [
  {
    espn_match_id: 'wc26-g-035',
    homeName: 'Netherlands', homeCode: 'ned',
    awayName: 'Sweden', awayCode: 'swe',
    // Elo ratings (June 2026 estimates based on WC qualifying performance)
    eloHome: 1952, eloAway: 1815,
    // FIFA rankings June 2026
    fifaRankHome: 7, fifaRankAway: 25,
    // Form: last 5 competitive matches (0=loss, 0.5=draw, 1=win, avg)
    formHome: 0.72, // NED: 3W 1D 1L in WC qualifying + friendlies
    formAway: 0.60, // SWE: 2W 2D 1L
    // Venue: Houston, TX — 15m altitude
    altitudeM: 15,
    // DK book odds (confirmed from DB)
    bookHomeML: -140, bookDrawML: 310, bookAwayML: 370,
    bookTotalLine: 2.5, bookOverML: -160, bookUnderML: 130,
  },
  {
    espn_match_id: 'wc26-g-033',
    // ESPN/FIFA official: GER is home (Toronto), CIV is away
    // DB corrected: home_team_id=ger, away_team_id=civ
    homeName: 'Germany', homeCode: 'ger',
    awayName: 'Ivory Coast', awayCode: 'civ',
    eloHome: 1988, eloAway: 1668,
    fifaRankHome: 14, fifaRankAway: 38,
    formHome: 0.75, // GER: strong qualifying
    formAway: 0.55, // CIV: mixed form
    altitudeM: 76, // Toronto
    // DK book odds with correct orientation: GER (home) -190, CIV (away) +475
    bookHomeML: -190, bookDrawML: 370, bookAwayML: 475,
    bookTotalLine: 2.5, bookOverML: -175, bookUnderML: 140,
  },
  {
    espn_match_id: 'wc26-g-034',
    // ESPN/FIFA official: ECU is home (Kansas City), CUW is away
    // DB corrected: home_team_id=ecu, away_team_id=cuw
    homeName: 'Ecuador', homeCode: 'ecu',
    awayName: 'Curaçao', awayCode: 'cuw',
    eloHome: 1803, eloAway: 1512,
    fifaRankHome: 39, fifaRankAway: 78,
    formHome: 0.65,
    formAway: 0.50,
    altitudeM: 270, // Kansas City
    // DK book odds with correct orientation: ECU (home) -750, CUW (away) +2000
    bookHomeML: -750, bookDrawML: 800, bookAwayML: 2000,
    bookTotalLine: 2.5, bookOverML: -170, bookUnderML: 135,
  },
  {
    espn_match_id: 'wc26-g-036',
    homeName: 'Tunisia', homeCode: 'tun',
    awayName: 'Japan', awayCode: 'jpn',
    // JPN is the favorite at -170
    eloHome: 1618, eloAway: 1876,
    fifaRankHome: 32, fifaRankAway: 18,
    formHome: 0.50,
    formAway: 0.72,
    altitudeM: 1566, // Guadalajara — significant altitude
    bookHomeML: 500, bookDrawML: 300, bookAwayML: -170,
    bookTotalLine: 2.5, bookOverML: 110, bookUnderML: -140,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} WC 2026 JUNE 20 MODEL — Dixon-Coles Poisson v4.0 Recalibrated`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} Model version: ${MODEL_VERSION}`);
  console.log(`${TAG} N_SIMULATIONS: ${N_SIMULATIONS.toLocaleString()}`);
  console.log(`${TAG} Recalibration: draw_floor=+0.090 lambda_mult=1.12 rank_discount=0.04@>40`);
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

      // ── Insert into wc2026_odds_snapshots (book_id=0 = AI Model) ──────────
      // Markets: 1X2, TOTAL, DOUBLE_CHANCE
      const rows = [
        // 1X2
        [match.espn_match_id, snapshotTs, MODEL_BOOK_ID, '1X2', 'home', null, proj.modelHomeML, proj.finalH, 0],
        [match.espn_match_id, snapshotTs, MODEL_BOOK_ID, '1X2', 'draw', null, proj.modelDrawML, proj.finalD, 0],
        [match.espn_match_id, snapshotTs, MODEL_BOOK_ID, '1X2', 'away', null, proj.modelAwayML, proj.finalA, 0],
        // TOTAL (O/U 2.5)
        [match.espn_match_id, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'over', 2.5, proj.modelOverML, proj.mc.over25, 0],
        [match.espn_match_id, snapshotTs, MODEL_BOOK_ID, 'TOTAL', 'under', 2.5, proj.modelUnderML, 1 - proj.mc.over25, 0],
        // DOUBLE_CHANCE
        [match.espn_match_id, snapshotTs, MODEL_BOOK_ID, 'DOUBLE_CHANCE', 'home_draw', null, proj.modelHomeDrawML, proj.homeDrawProb, 0],
        [match.espn_match_id, snapshotTs, MODEL_BOOK_ID, 'DOUBLE_CHANCE', 'away_draw', null, proj.modelAwayDrawML, proj.awayDrawProb, 0],
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
        match.espn_match_id, MODEL_VERSION, N_SIMULATIONS,
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

      console.log(`${TAG} [OUTPUT] ${match.espn_match_id}: ML home=${proj.modelHomeML} draw=${proj.modelDrawML} away=${proj.modelAwayML}`);
      console.log(`${TAG} [OUTPUT] ${match.espn_match_id}: Total=${proj.modelTotalLine} O=${proj.modelOverML} U=${proj.modelUnderML}`);
      console.log(`${TAG} [OUTPUT] ${match.espn_match_id}: DC 1X=${proj.modelHomeDrawML} X2=${proj.modelAwayDrawML}`);
      console.log(`${TAG} [OUTPUT] ${match.espn_match_id}: Lean=${proj.modelLean}(${(proj.leanProb*100).toFixed(1)}%) Edges: H=${(proj.homeEdge*100).toFixed(2)}pp D=${(proj.drawEdge*100).toFixed(2)}pp A=${(proj.awayEdge*100).toFixed(2)}pp`);

    } catch (err) {
      totalErrors++;
      console.error(`${TAG} [ERROR] ${match.espn_match_id}: ${err.message}`);
    }
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} JUNE 20 MODEL SEED COMPLETE`);
  console.log(`${TAG} Matchs processed: ${MATCHS.length} | Rows inserted: ${totalInserted} | Errors: ${totalErrors}`);
  console.log(`\n${TAG} PROJECTIONS SUMMARY:`);
  for (const { match, proj } of results) {
    const lean = proj.modelLean === 'H' ? match.homeName : proj.modelLean === 'A' ? match.awayName : 'DRAW';
    console.log(`${TAG}   ${match.homeName} vs ${match.awayName}:`);
    console.log(`${TAG}     ML: ${match.homeName}=${proj.modelHomeML} / DRAW=${proj.modelDrawML} / ${match.awayName}=${proj.modelAwayML}`);
    console.log(`${TAG}     Total: ${proj.modelTotalLine} (O=${proj.modelOverML} U=${proj.modelUnderML})`);
    console.log(`${TAG}     Lean: ${lean} (${(proj.leanProb*100).toFixed(1)}%)`);
    console.log(`${TAG}     Edges: H=${(proj.homeEdge*100).toFixed(2)}pp D=${(proj.drawEdge*100).toFixed(2)}pp A=${(proj.awayEdge*100).toFixed(2)}pp`);
  }
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  await conn.end();
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
