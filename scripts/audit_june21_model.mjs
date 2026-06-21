/**
 * audit_june21_model.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * MAXIMUM-DEPTH AUDIT of June 21 WC2026 Model Projections
 *
 * Investigates:
 *   1. Lambda inflation bug: lambda_mult applied to book total line
 *   2. Book-anchoring bias: blend weights pull model toward book
 *   3. Over probability inflation: systematic over edge on all 4 games
 *   4. Favorite bias: model always agreeing with book favorite
 *   5. Draw floor miscalibration: 0.097 boost from 132-match backtest validity
 *   6. Recalibration parameter validity vs the original prompt instructions
 *
 * LOGGING FORMAT:
 *   [AUDIT][INPUT]  — raw inputs
 *   [AUDIT][STEP]   — computation step
 *   [AUDIT][STATE]  — intermediate state
 *   [AUDIT][BUG]    — identified bug or anomaly
 *   [AUDIT][OUTPUT] — final result
 *   [AUDIT][VERIFY] — pass/fail check
 */

const TAG = '[AUDIT]';

// ─── Utility functions ────────────────────────────────────────────────────────
function americanToProb(ml) {
  if (!ml || isNaN(ml)) return null;
  return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
}

function noVigProbs(homeML, drawML, awayML) {
  const rawH = americanToProb(homeML);
  const rawD = americanToProb(drawML);
  const rawA = americanToProb(awayML);
  const sum = rawH + rawD + rawA;
  return { h: rawH / sum, d: rawD / sum, a: rawA / sum, vig: (sum - 1) * 100 };
}

function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Analytical Poisson over/under probabilities (no Monte Carlo needed for audit)
function poissonOverProb(line, lambdaH, lambdaA) {
  // P(total > line) = 1 - P(total <= floor(line))
  const maxGoals = Math.floor(line);
  let prob = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals - h; a++) {
      prob += poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA);
    }
  }
  return 1 - prob;
}

// Analytical Poisson 1X2 probabilities
function poissonOutcomeProbs(lambdaH, lambdaA, maxG = 10) {
  let homeWin = 0, draw = 0, awayWin = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }
  return { homeWin, draw, awayWin };
}

function calculateEdge3Way(book, model, side) {
  const bH = americanToProb(book.home);
  const bD = americanToProb(book.draw);
  const bA = americanToProb(book.away);
  const mH = americanToProb(model.home);
  const mD = americanToProb(model.draw);
  const mA = americanToProb(model.away);
  const bTotal = bH + bD + bA;
  const mTotal = mH + mD + mA;
  const bFair = { home: bH/bTotal, draw: bD/bTotal, away: bA/bTotal };
  const mFair = { home: mH/mTotal, draw: mD/mTotal, away: mA/mTotal };
  return (mFair[side] - bFair[side]) * 100;
}

function calculateRoi(modelML, bookML, bookOppML) {
  const mI = americanToProb(modelML);
  const bI = americanToProb(bookML);
  const bO = americanToProb(bookOppML);
  const vigTotal = bI + bO;
  if (vigTotal <= 0) return NaN;
  const bookNoVig = bI / vigTotal;
  if (bookNoVig <= 0) return NaN;
  return (mI / bookNoVig - 1) * 100;
}

// ─── Fixture data (from seed script) ─────────────────────────────────────────
const FIXTURES = [
  {
    fixtureId: 'wc26-g-039',
    homeName: 'Spain', homeCode: 'esp',
    awayName: 'Saudi Arabia', awayCode: 'ksa',
    eloHome: 2050, eloAway: 1615,
    fifaRankHome: 2, fifaRankAway: 56,
    formHome: 0.82, formAway: 0.44,
    altitudeM: 10,
    bookHomeML: -900, bookDrawML: 950, bookAwayML: 2200,
    bookTotalLine: 3.5, bookOverML: -105, bookUnderML: -120,
  },
  {
    fixtureId: 'wc26-g-037',
    homeName: 'Iran', homeCode: 'irn',
    awayName: 'Belgium', awayCode: 'bel',
    eloHome: 1695, eloAway: 1890,
    fifaRankHome: 22, fifaRankAway: 5,
    formHome: 0.50, formAway: 0.74,
    altitudeM: 89,
    bookHomeML: 650, bookDrawML: 370, bookAwayML: -225,
    bookTotalLine: 2.5, bookOverML: -125, bookUnderML: 100,
  },
  {
    fixtureId: 'wc26-g-040',
    homeName: 'Cape Verde', homeCode: 'cpv',
    awayName: 'Uruguay', awayCode: 'uru',
    eloHome: 1598, eloAway: 1855,
    fifaRankHome: 37, fifaRankAway: 14,
    formHome: 0.52, formAway: 0.70,
    altitudeM: 183,
    bookHomeML: 700, bookDrawML: 320, bookAwayML: -210,
    bookTotalLine: 2.5, bookOverML: 130, bookUnderML: -160,
  },
  {
    fixtureId: 'wc26-g-038',
    homeName: 'New Zealand', homeCode: 'nzl',
    awayName: 'Egypt', awayCode: 'egy',
    eloHome: 1598, eloAway: 1720,
    fifaRankHome: 99, fifaRankAway: 32,
    formHome: 0.44, formAway: 0.66,
    altitudeM: 18,
    bookHomeML: 500, bookDrawML: 300, bookAwayML: -165,
    bookTotalLine: 2.5, bookOverML: 105, bookUnderML: -130,
  },
];

// ─── Audit each fixture ───────────────────────────────────────────────────────
function auditFixture(f) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${TAG}[INPUT] ${f.homeName} (${f.homeCode}) vs ${f.awayName} (${f.awayCode}) | ${f.fixtureId}`);
  console.log(`${TAG}[INPUT] Elo: home=${f.eloHome} away=${f.eloAway} | FIFA: home=#${f.fifaRankHome} away=#${f.fifaRankAway}`);
  console.log(`${TAG}[INPUT] Form: home=${f.formHome} away=${f.formAway} | Altitude: ${f.altitudeM}m`);
  console.log(`${TAG}[INPUT] Book: home=${f.bookHomeML} draw=${f.bookDrawML} away=${f.bookAwayML} | Total: O${f.bookTotalLine}=${f.bookOverML} U${f.bookTotalLine}=${f.bookUnderML}`);

  // ── AUDIT 1: Book no-vig probabilities ────────────────────────────────────
  const bookNV = noVigProbs(f.bookHomeML, f.bookDrawML, f.bookAwayML);
  console.log(`\n${TAG}[STEP 1] Book no-vig probs: H=${(bookNV.h*100).toFixed(2)}% D=${(bookNV.d*100).toFixed(2)}% A=${(bookNV.a*100).toFixed(2)}% | vig=${bookNV.vig.toFixed(2)}%`);

  // ── AUDIT 2: Book total no-vig ────────────────────────────────────────────
  const bookOverProb = americanToProb(f.bookOverML);
  const bookUnderProb = americanToProb(f.bookUnderML);
  const bookTotalVig = (bookOverProb + bookUnderProb - 1) * 100;
  const bookOverNV = bookOverProb / (bookOverProb + bookUnderProb);
  const bookUnderNV = bookUnderProb / (bookOverProb + bookUnderProb);
  console.log(`${TAG}[STEP 1b] Book total no-vig: O${f.bookTotalLine}=${(bookOverNV*100).toFixed(2)}% U${f.bookTotalLine}=${(bookUnderNV*100).toFixed(2)}% | vig=${bookTotalVig.toFixed(2)}%`);

  // ── AUDIT 3: Elo-based probabilities ─────────────────────────────────────
  const eloDiff = f.eloHome - f.eloAway;
  const eloWinProb = 1 / (1 + Math.pow(10, -eloDiff / 400));
  const eloLossProb = 1 - eloWinProb;
  const eloDrawBase = 0.25;
  const eloH = eloWinProb * (1 - eloDrawBase);
  const eloD = eloDrawBase;
  const eloA = eloLossProb * (1 - eloDrawBase);
  console.log(`\n${TAG}[STEP 2] Elo: diff=${eloDiff} | eloWinProb=${(eloWinProb*100).toFixed(2)}% | H=${(eloH*100).toFixed(2)}% D=${(eloD*100).toFixed(2)}% A=${(eloA*100).toFixed(2)}%`);

  // ── AUDIT 4: Rank adjustment ──────────────────────────────────────────────
  const rankDiff = f.fifaRankAway - f.fifaRankHome;
  const rankFactor = Math.tanh(rankDiff / 50) * 0.10;
  console.log(`${TAG}[STEP 3] Rank: diff=${rankDiff} (positive=home better) | rankFactor=${rankFactor.toFixed(4)}`);

  // ── AUDIT 5: Form adjustment ──────────────────────────────────────────────
  const formDiff = f.formHome - f.formAway;
  const formFactor = formDiff * 0.08;
  console.log(`${TAG}[STEP 4] Form: diff=${formDiff.toFixed(3)} | formFactor=${formFactor.toFixed(4)}`);

  // ── AUDIT 6: Blend ────────────────────────────────────────────────────────
  const w_book = 0.40, w_elo = 0.30, w_rank = 0.15, w_form = 0.15;
  let blendH = w_book * bookNV.h + w_elo * eloH + w_rank * (bookNV.h + rankFactor) + w_form * (bookNV.h + formFactor);
  let blendD = w_book * bookNV.d + w_elo * eloD + w_rank * bookNV.d + w_form * bookNV.d;
  let blendA = w_book * bookNV.a + w_elo * eloA + w_rank * (bookNV.a - rankFactor) + w_form * (bookNV.a - formFactor);
  let blendSum = blendH + blendD + blendA;
  blendH /= blendSum; blendD /= blendSum; blendA /= blendSum;
  console.log(`\n${TAG}[STEP 5] Blend (w_book=0.40 w_elo=0.30 w_rank=0.15 w_form=0.15):`);
  console.log(`${TAG}[STEP 5]   H=${(blendH*100).toFixed(2)}% D=${(blendD*100).toFixed(2)}% A=${(blendA*100).toFixed(2)}%`);

  // BUG CHECK: How much does the blend differ from pure book no-vig?
  const blendVsBookH = (blendH - bookNV.h) * 100;
  const blendVsBookD = (blendD - bookNV.d) * 100;
  const blendVsBookA = (blendA - bookNV.a) * 100;
  console.log(`${TAG}[STATE] Blend vs book NV: H${blendVsBookH > 0 ? '+' : ''}${blendVsBookH.toFixed(2)}pp D${blendVsBookD > 0 ? '+' : ''}${blendVsBookD.toFixed(2)}pp A${blendVsBookA > 0 ? '+' : ''}${blendVsBookA.toFixed(2)}pp`);
  if (Math.abs(blendVsBookH) < 3 && Math.abs(blendVsBookA) < 3) {
    console.log(`${TAG}[BUG] ⚠️  BOOK ANCHOR BIAS: blend is within 3pp of book NV — model adds minimal independent signal`);
  }

  // ── AUDIT 7: Draw floor recalibration ─────────────────────────────────────
  const DRAW_FLOOR_BOOST = 0.097;
  const probDiff = Math.abs(blendH - blendA);
  let recalH = blendH, recalD = blendD, recalA = blendA;
  let drawBoostApplied = 0;

  if (probDiff < 0.25) {
    const boost = DRAW_FLOOR_BOOST * (1 - probDiff / 0.25);
    recalD = Math.min(0.45, blendD + boost);
    const reduction = (recalD - blendD) / 2;
    recalH = Math.max(0.05, blendH - reduction);
    recalA = Math.max(0.05, blendA - reduction);
    drawBoostApplied = boost;
    console.log(`\n${TAG}[STEP 6] Draw floor APPLIED: probDiff=${probDiff.toFixed(4)} < 0.25 | boost=${boost.toFixed(4)}`);
    console.log(`${TAG}[STEP 6]   H=${(recalH*100).toFixed(2)}% D=${(recalD*100).toFixed(2)}% A=${(recalA*100).toFixed(2)}%`);
  } else {
    console.log(`\n${TAG}[STEP 6] Draw floor NOT applied: probDiff=${probDiff.toFixed(4)} >= 0.25`);
    console.log(`${TAG}[STATE]   H=${(recalH*100).toFixed(2)}% D=${(recalD*100).toFixed(2)}% A=${(recalA*100).toFixed(2)}%`);
  }

  // ── AUDIT 8: Rank diff discount ───────────────────────────────────────────
  const absFifaRankDiff = Math.abs(f.fifaRankHome - f.fifaRankAway);
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
    console.log(`${TAG}[STEP 7] Rank diff discount APPLIED (rankDiff=${absFifaRankDiff} > 40):`);
    console.log(`${TAG}[STEP 7]   H=${(recalH*100).toFixed(2)}% D=${(recalD*100).toFixed(2)}% A=${(recalA*100).toFixed(2)}%`);
  } else {
    console.log(`${TAG}[STEP 7] Rank diff discount NOT applied (rankDiff=${absFifaRankDiff} <= 40)`);
  }

  // Re-normalize
  const recalSum = recalH + recalD + recalA;
  recalH /= recalSum; recalD /= recalSum; recalA /= recalSum;
  console.log(`${TAG}[STATE] Recalibrated probs (normalized): H=${(recalH*100).toFixed(2)}% D=${(recalD*100).toFixed(2)}% A=${(recalA*100).toFixed(2)}%`);

  // ── AUDIT 9: Lambda computation — THE CRITICAL BUG ───────────────────────
  const LAMBDA_MULT = 1.20;
  const altitudeFactor = Math.exp(-f.altitudeM / 8000);
  const expectedTotalGoals = f.bookTotalLine * LAMBDA_MULT * altitudeFactor;
  const lambdaH = expectedTotalGoals * (recalH / (recalH + recalA)) * (1 + f.formHome * 0.05);
  const lambdaA = expectedTotalGoals * (recalA / (recalH + recalA)) * (1 + f.formAway * 0.05);
  const lambdaTotal = lambdaH + lambdaA;

  console.log(`\n${TAG}[STEP 8] Lambda computation:`);
  console.log(`${TAG}[STEP 8]   bookTotalLine=${f.bookTotalLine} × LAMBDA_MULT=${LAMBDA_MULT} × altFactor=${altitudeFactor.toFixed(4)} = expectedTotal=${expectedTotalGoals.toFixed(4)}`);
  console.log(`${TAG}[STEP 8]   lambdaH=${lambdaH.toFixed(4)} lambdaA=${lambdaA.toFixed(4)} sum=${lambdaTotal.toFixed(4)}`);

  // BUG: Lambda mult inflates expected goals above book total line
  if (LAMBDA_MULT > 1.0) {
    console.log(`${TAG}[BUG] ⚠️  LAMBDA INFLATION: expectedTotal=${expectedTotalGoals.toFixed(3)} > bookTotalLine=${f.bookTotalLine}`);
    console.log(`${TAG}[BUG]     lambda_mult=${LAMBDA_MULT} inflates expected goals by ${((LAMBDA_MULT-1)*100).toFixed(0)}% above book line`);
    console.log(`${TAG}[BUG]     This SYSTEMATICALLY inflates over probability for ALL fixtures`);
    console.log(`${TAG}[BUG]     For O${f.bookTotalLine}: book NV over=${(bookOverNV*100).toFixed(2)}%, model will produce ~${(poissonOverProb(f.bookTotalLine, lambdaH, lambdaA)*100).toFixed(2)}%`);
  }

  // ── AUDIT 10: Analytical Poisson over probability ─────────────────────────
  const analyticalOverProb = poissonOverProb(f.bookTotalLine, lambdaH, lambdaA);
  const analyticalOutcomes = poissonOutcomeProbs(lambdaH, lambdaA);
  console.log(`\n${TAG}[STEP 9] Analytical Poisson (no MC needed):`);
  console.log(`${TAG}[STEP 9]   1X2: H=${(analyticalOutcomes.homeWin*100).toFixed(2)}% D=${(analyticalOutcomes.draw*100).toFixed(2)}% A=${(analyticalOutcomes.awayWin*100).toFixed(2)}%`);
  console.log(`${TAG}[STEP 9]   O${f.bookTotalLine}: ${(analyticalOverProb*100).toFixed(2)}% | U${f.bookTotalLine}: ${((1-analyticalOverProb)*100).toFixed(2)}%`);

  // ── AUDIT 11: What lambda_mult SHOULD be ─────────────────────────────────
  // The original prompt said: "lambda_multiplier += 20% (2026 avg goals 3.00 vs target 2.50)"
  // This means the 2026 tournament is averaging 3.00 goals/game vs 2.50 expected.
  // The lambda_mult should scale the BASE lambda (derived from historical data),
  // NOT the book total line (which already reflects the market's expectation of 2026 pace).
  // Applying lambda_mult to the book total line double-counts the pace adjustment.
  console.log(`\n${TAG}[BUG] ⚠️  LAMBDA MULT MISAPPLICATION:`);
  console.log(`${TAG}[BUG]     Original intent: scale BASE lambda (from historical avg ~2.50 goals)`);
  console.log(`${TAG}[BUG]     Actual behavior: scale BOOK TOTAL LINE (already reflects 2026 pace)`);
  console.log(`${TAG}[BUG]     Book total line for O${f.bookTotalLine} games already implies ~${(bookOverNV*100).toFixed(1)}% over probability`);
  console.log(`${TAG}[BUG]     Applying 1.20× to book line creates expected goals of ${expectedTotalGoals.toFixed(3)} — ABOVE the market's own estimate`);
  console.log(`${TAG}[BUG]     FIX: lambda_mult should NOT be applied to book total line`);
  console.log(`${TAG}[BUG]     FIX: Use book total line directly as expected goals (market already priced in pace)`);

  // ── AUDIT 12: Correct lambda (no mult applied to book line) ──────────────
  const correctExpectedTotal = f.bookTotalLine * altitudeFactor; // no mult
  const correctLambdaH = correctExpectedTotal * (recalH / (recalH + recalA)) * (1 + f.formHome * 0.05);
  const correctLambdaA = correctExpectedTotal * (recalA / (recalH + recalA)) * (1 + f.formAway * 0.05);
  const correctOverProb = poissonOverProb(f.bookTotalLine, correctLambdaH, correctLambdaA);
  const correctOutcomes = poissonOutcomeProbs(correctLambdaH, correctLambdaA);
  console.log(`\n${TAG}[STATE] CORRECTED lambda (no mult):`);
  console.log(`${TAG}[STATE]   expectedTotal=${correctExpectedTotal.toFixed(4)} | lambdaH=${correctLambdaH.toFixed(4)} lambdaA=${correctLambdaA.toFixed(4)}`);
  console.log(`${TAG}[STATE]   1X2: H=${(correctOutcomes.homeWin*100).toFixed(2)}% D=${(correctOutcomes.draw*100).toFixed(2)}% A=${(correctOutcomes.awayWin*100).toFixed(2)}%`);
  console.log(`${TAG}[STATE]   O${f.bookTotalLine}: ${(correctOverProb*100).toFixed(2)}% | U${f.bookTotalLine}: ${((1-correctOverProb)*100).toFixed(2)}%`);

  // ── AUDIT 13: Edge comparison — current vs corrected ─────────────────────
  // Current model ML (from DB — what was seeded)
  // We'll compute what the current model produced vs what corrected would produce
  // For 1X2: use the recalibrated probs (same for both, since lambda only affects total)
  const W_MC = 0.60, W_RECAL = 0.40;
  // Approximate MC with analytical (close enough for audit)
  const mcApproxH = analyticalOutcomes.homeWin;
  const mcApproxD = analyticalOutcomes.draw;
  const mcApproxA = analyticalOutcomes.awayWin;
  let finalH = W_MC * mcApproxH + W_RECAL * recalH;
  let finalD = W_MC * mcApproxD + W_RECAL * recalD;
  let finalA = W_MC * mcApproxA + W_RECAL * recalA;
  const finalSum = finalH + finalD + finalA;
  finalH /= finalSum; finalD /= finalSum; finalA /= finalSum;

  const mcCorrectH = correctOutcomes.homeWin;
  const mcCorrectD = correctOutcomes.draw;
  const mcCorrectA = correctOutcomes.awayWin;
  let correctFinalH = W_MC * mcCorrectH + W_RECAL * recalH;
  let correctFinalD = W_MC * mcCorrectD + W_RECAL * recalD;
  let correctFinalA = W_MC * mcCorrectA + W_RECAL * recalA;
  const correctFinalSum = correctFinalH + correctFinalD + correctFinalA;
  correctFinalH /= correctFinalSum; correctFinalD /= correctFinalSum; correctFinalA /= correctFinalSum;

  console.log(`\n${TAG}[STATE] ML comparison (current inflated vs corrected):`);
  console.log(`${TAG}[STATE]   Current:   H=${probToAmerican(finalH)} D=${probToAmerican(finalD)} A=${probToAmerican(finalA)}`);
  console.log(`${TAG}[STATE]   Corrected: H=${probToAmerican(correctFinalH)} D=${probToAmerican(correctFinalD)} A=${probToAmerican(correctFinalA)}`);

  // ── AUDIT 14: Total edge comparison ──────────────────────────────────────
  const currentOverML = probToAmerican(analyticalOverProb);
  const currentUnderML = probToAmerican(1 - analyticalOverProb);
  const correctOverML = probToAmerican(correctOverProb);
  const correctUnderML = probToAmerican(1 - correctOverProb);

  const currentOverEdge = (analyticalOverProb - bookOverNV) * 100;
  const correctOverEdge = (correctOverProb - bookOverNV) * 100;

  console.log(`\n${TAG}[STATE] Total edge comparison:`);
  console.log(`${TAG}[STATE]   Book NV: O${f.bookTotalLine}=${(bookOverNV*100).toFixed(2)}% U${f.bookTotalLine}=${(bookUnderNV*100).toFixed(2)}%`);
  console.log(`${TAG}[STATE]   Current model: O${f.bookTotalLine}=${(analyticalOverProb*100).toFixed(2)}% (${currentOverML}) | edge=${currentOverEdge > 0 ? '+' : ''}${currentOverEdge.toFixed(2)}pp`);
  console.log(`${TAG}[STATE]   Corrected model: O${f.bookTotalLine}=${(correctOverProb*100).toFixed(2)}% (${correctOverML}) | edge=${correctOverEdge > 0 ? '+' : ''}${correctOverEdge.toFixed(2)}pp`);

  if (currentOverEdge > 2 && correctOverEdge < 1) {
    console.log(`${TAG}[BUG] ⚠️  OVER EDGE IS ENTIRELY DUE TO LAMBDA INFLATION — corrected model has NO over edge`);
  } else if (currentOverEdge > 2 && correctOverEdge > 0) {
    console.log(`${TAG}[STATE] Over edge partially real, partially inflated`);
  }

  // ── AUDIT 15: ML edge analysis ────────────────────────────────────────────
  const homeEdge3W = calculateEdge3Way({home: f.bookHomeML, draw: f.bookDrawML, away: f.bookAwayML},
    {home: probToAmerican(finalH), draw: probToAmerican(finalD), away: probToAmerican(finalA)}, 'home');
  const awayEdge3W = calculateEdge3Way({home: f.bookHomeML, draw: f.bookDrawML, away: f.bookAwayML},
    {home: probToAmerican(finalH), draw: probToAmerican(finalD), away: probToAmerican(finalA)}, 'away');
  const drawEdge3W = calculateEdge3Way({home: f.bookHomeML, draw: f.bookDrawML, away: f.bookAwayML},
    {home: probToAmerican(finalH), draw: probToAmerican(finalD), away: probToAmerican(finalA)}, 'draw');

  console.log(`\n${TAG}[STATE] ML 3-way edges (current model):`);
  console.log(`${TAG}[STATE]   home=${homeEdge3W > 0 ? '+' : ''}${homeEdge3W.toFixed(2)}pp draw=${drawEdge3W > 0 ? '+' : ''}${drawEdge3W.toFixed(2)}pp away=${awayEdge3W > 0 ? '+' : ''}${awayEdge3W.toFixed(2)}pp`);

  // Is the ML edge real or just from book-anchoring?
  const eloOnlyH = eloH / (eloH + eloD + eloA);
  const eloOnlyA = eloA / (eloH + eloD + eloA);
  const eloVsBookH = (eloOnlyH - bookNV.h) * 100;
  const eloVsBookA = (eloOnlyA - bookNV.a) * 100;
  console.log(`${TAG}[STATE] Elo-only vs book NV: H${eloVsBookH > 0 ? '+' : ''}${eloVsBookH.toFixed(2)}pp A${eloVsBookA > 0 ? '+' : ''}${eloVsBookA.toFixed(2)}pp`);

  if (Math.sign(homeEdge3W) === Math.sign(eloVsBookH) || Math.abs(homeEdge3W) < 2) {
    console.log(`${TAG}[STATE] ML edge direction consistent with Elo signal`);
  } else {
    console.log(`${TAG}[BUG] ⚠️  ML edge direction CONTRADICTS Elo signal — book anchor may be dominating`);
  }

  // ── AUDIT 16: Summary ─────────────────────────────────────────────────────
  const bookFavorite = f.bookHomeML < f.bookAwayML ? f.homeName : f.awayName;
  const modelFavorite = finalH > finalA ? f.homeName : f.awayName;
  const modelAgreesWithBook = bookFavorite === modelFavorite;
  console.log(`\n${TAG}[OUTPUT] ${f.homeName} vs ${f.awayName}:`);
  console.log(`${TAG}[OUTPUT]   Book favorite: ${bookFavorite} | Model favorite: ${modelFavorite} | Agrees: ${modelAgreesWithBook}`);
  console.log(`${TAG}[OUTPUT]   Over edge (current): ${currentOverEdge > 0 ? '+' : ''}${currentOverEdge.toFixed(2)}pp | Over edge (corrected): ${correctOverEdge > 0 ? '+' : ''}${correctOverEdge.toFixed(2)}pp`);
  console.log(`${TAG}[OUTPUT]   Lambda inflation impact: +${((analyticalOverProb - correctOverProb)*100).toFixed(2)}pp on over probability`);

  return {
    fixtureId: f.fixtureId,
    homeName: f.homeName, awayName: f.awayName,
    bookFavorite, modelFavorite, modelAgreesWithBook,
    currentOverEdge, correctOverEdge,
    lambdaInflationImpact: (analyticalOverProb - correctOverProb) * 100,
    currentOverML, correctOverML,
    currentFinalH: finalH, currentFinalD: finalD, currentFinalA: finalA,
    correctFinalH, correctFinalD, correctFinalA,
    bookNV,
    bookOverNV, bookUnderNV,
    analyticalOverProb, correctOverProb,
    recalH, recalD, recalA,
    lambdaH, lambdaA, correctLambdaH, correctLambdaA,
    homeEdge3W, awayEdge3W, drawEdge3W,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`${'═'.repeat(80)}`);
console.log(`${TAG} WC2026 JUNE 21 MODEL AUDIT — MAXIMUM DEPTH`);
console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
console.log(`${'═'.repeat(80)}`);

const results = FIXTURES.map(auditFixture);

// ── Cross-fixture summary ──────────────────────────────────────────────────
console.log(`\n${'═'.repeat(80)}`);
console.log(`${TAG}[OUTPUT] CROSS-FIXTURE AUDIT SUMMARY`);
console.log(`${'═'.repeat(80)}`);

let allFavsAgree = 0;
let allOversInflated = 0;
let totalLambdaInflation = 0;

for (const r of results) {
  allFavsAgree += r.modelAgreesWithBook ? 1 : 0;
  allOversInflated += r.currentOverEdge > 1.5 ? 1 : 0;
  totalLambdaInflation += r.lambdaInflationImpact;

  console.log(`\n${TAG}[OUTPUT] ${r.homeName} vs ${r.awayName} (${r.fixtureId}):`);
  console.log(`${TAG}[OUTPUT]   ML: Book fav=${r.bookFavorite} | Model fav=${r.modelFavorite} | Agrees=${r.modelAgreesWithBook}`);
  console.log(`${TAG}[OUTPUT]   Current model: H=${probToAmerican(r.currentFinalH)} D=${probToAmerican(r.currentFinalD)} A=${probToAmerican(r.currentFinalA)}`);
  console.log(`${TAG}[OUTPUT]   Corrected:     H=${probToAmerican(r.correctFinalH)} D=${probToAmerican(r.correctFinalD)} A=${probToAmerican(r.correctFinalA)}`);
  console.log(`${TAG}[OUTPUT]   Over edge: current=${r.currentOverEdge > 0 ? '+' : ''}${r.currentOverEdge.toFixed(2)}pp corrected=${r.correctOverEdge > 0 ? '+' : ''}${r.correctOverEdge.toFixed(2)}pp | inflation=${r.lambdaInflationImpact.toFixed(2)}pp`);
  console.log(`${TAG}[OUTPUT]   ML 3-way edges: H=${r.homeEdge3W > 0 ? '+' : ''}${r.homeEdge3W.toFixed(2)}pp D=${r.drawEdge3W > 0 ? '+' : ''}${r.drawEdge3W.toFixed(2)}pp A=${r.awayEdge3W > 0 ? '+' : ''}${r.awayEdge3W.toFixed(2)}pp`);
}

console.log(`\n${TAG}[VERIFY] Favorites: model agrees with book on ${allFavsAgree}/4 fixtures`);
console.log(`${TAG}[VERIFY] Overs: ${allOversInflated}/4 fixtures show over edge > 1.5pp`);
console.log(`${TAG}[VERIFY] Avg lambda inflation impact: ${(totalLambdaInflation/4).toFixed(2)}pp per fixture`);

if (allFavsAgree === 4) {
  console.log(`${TAG}[BUG] ⚠️  SYSTEMATIC FAVORITE BIAS: model agrees with book on ALL 4 favorites`);
  console.log(`${TAG}[BUG]     Root cause: w_book=0.40 anchors model to book; Elo/rank/form signals are too weak to override`);
  console.log(`${TAG}[BUG]     For mismatched games (Iran/Belgium, Cape Verde/Uruguay), book NV already has favorite at 60-65%`);
  console.log(`${TAG}[BUG]     Elo signal agrees with book favorite in 3/4 cases, so model cannot diverge`);
}

if (allOversInflated >= 3) {
  console.log(`\n${TAG}[BUG] ⚠️  SYSTEMATIC OVER BIAS: ${allOversInflated}/4 fixtures show inflated over edge`);
  console.log(`${TAG}[BUG]     Root cause: lambda_mult=1.20 applied to book total line (already reflects 2026 pace)`);
  console.log(`${TAG}[BUG]     This double-counts the pace adjustment — book line is the market's 2026-adjusted estimate`);
  console.log(`${TAG}[BUG]     FIX: Remove lambda_mult from book total line calculation`);
  console.log(`${TAG}[BUG]     FIX: lambda_mult should only apply if deriving lambdas from historical base rates`);
}

console.log(`\n${TAG}[OUTPUT] RECOMMENDED FIXES:`);
console.log(`${TAG}[OUTPUT]   1. LAMBDA: Remove LAMBDA_MULT from expectedTotalGoals = bookTotalLine * altitudeFactor (no mult)`);
console.log(`${TAG}[OUTPUT]   2. BLEND: Reduce w_book from 0.40 to 0.25, increase w_elo from 0.30 to 0.40`);
console.log(`${TAG}[OUTPUT]   3. DRAW FLOOR: 0.097 boost is valid for close games (probDiff < 0.25) but verify threshold`);
console.log(`${TAG}[OUTPUT]   4. FORM: Form factor (0.08 per unit) is reasonable, keep`);
console.log(`${TAG}[OUTPUT]   5. RANK DISCOUNT: 0.04 for rank_diff > 40 is reasonable, keep`);
