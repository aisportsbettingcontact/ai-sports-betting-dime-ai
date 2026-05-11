#!/usr/bin/env python3
"""
patchRlSigmoid.py
Patches mlbMultiMarketBacktest.ts to add sigmoid fallback for FG RL evaluation.
When modelHomePLCoverPct is NULL (all current games), derives RL cover probability
from model score differential using calibrated k=0.4 sigmoid.
"""

import sys

FILEPATH = 'server/mlbMultiMarketBacktest.ts'

with open(FILEPATH, 'r') as f:
    content = f.read()

# The exact block to replace (lines 305-355 approx)
OLD = """  // Model RL cover probabilities (stored as 0-100 percentages)
  const pHomeRlRaw = parseNum(game.modelHomePLCoverPct);
  const pAwayRlRaw = parseNum(game.modelAwayPLCoverPct);
  const bookHomeRlOdds = parseOdds(game.homeRunLineOdds);
  const bookAwayRlOdds = parseOdds(game.awayRunLineOdds);

  const nvHomeRl = (bookHomeRlOdds !== null && bookAwayRlOdds !== null)
    ? noVigProb(bookHomeRlOdds, bookAwayRlOdds) : null;
  const nvAwayRl = nvHomeRl !== null ? parseFloat((1 - nvHomeRl).toFixed(4)) : null;

  if (pHomeRlRaw !== null) {
    const pHomeRl = pHomeRlRaw / 100;
    const edge = calcEdge(pHomeRl, nvHomeRl);
    const ev   = calcEV(pHomeRl, bookHomeRlOdds);
    const conf = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : homeCovers ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_RL_HOME, modelSide: "home -1.5",
      modelProb: parseFloat(pHomeRl.toFixed(4)),
      bookLine: "-1.5", bookOdds: bookHomeRlOdds !== null ? String(bookHomeRlOdds) : null,
      bookNoVigProb: nvHomeRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `margin=${margin}`,
      notes: `P(home RL -1.5)=${pHomeRl.toFixed(4)} margin=${margin} covers=${homeCovers} book=${bookHomeRlOdds}`,
    });
  }

  if (pAwayRlRaw !== null) {
    const pAwayRl = pAwayRlRaw / 100;
    const edge = calcEdge(pAwayRl, nvAwayRl);
    const ev   = calcEV(pAwayRl, bookAwayRlOdds);
    // Use FG_RL_AWAY_EDGE_THRESHOLD (18%) \u2014 raised from global 5% to filter out
    // systematic home-edge correction bias. See constant definition for full rationale.
    const conf = edge !== null && edge >= FG_RL_AWAY_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : awayCovers ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_RL_AWAY, modelSide: "away +1.5",
      modelProb: parseFloat(pAwayRl.toFixed(4)),
      bookLine: "+1.5", bookOdds: bookAwayRlOdds !== null ? String(bookAwayRlOdds) : null,
      bookNoVigProb: nvAwayRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `margin=${margin}`,
      notes: `P(away RL +1.5)=${pAwayRl.toFixed(4)} edge=${edge?.toFixed(4)} threshold=${FG_RL_AWAY_EDGE_THRESHOLD} margin=${margin} covers=${awayCovers} book=${bookAwayRlOdds}`,
    });
  }

  return results;
}"""

NEW = """  // Model RL cover probabilities (stored as 0-100 percentages)
  // NOTE: modelHomePLCoverPct / modelAwayPLCoverPct are NULL for all current games.
  // Fallback: derive from model score differential using calibrated sigmoid.
  // Sigmoid calibration (2026-05-11, n=554 games, auditFgRlHomeSigmoid.mjs):
  //   k=0.4, center=1.5 -> Brier=0.2366 (optimal; k=0.8 was Brier=0.2475, bias=-7.84%)
  const RL_SIGMOID_K = 0.4;
  const rlSigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const pHomeRlRaw = parseNum(game.modelHomePLCoverPct);
  const pAwayRlRaw = parseNum(game.modelAwayPLCoverPct);
  const modelHomeScore = parseNum(game.modelHomeScore);
  const modelAwayScore = parseNum(game.modelAwayScore);
  const modelMargin = (modelHomeScore !== null && modelAwayScore !== null)
    ? modelHomeScore - modelAwayScore : null;
  // Resolve RL cover probabilities: use stored values if available, else sigmoid fallback
  const pHomeRlResolved: number | null = pHomeRlRaw !== null
    ? pHomeRlRaw / 100
    : modelMargin !== null ? rlSigmoid((modelMargin - 1.5) * RL_SIGMOID_K) : null;
  const pAwayRlResolved: number | null = pAwayRlRaw !== null
    ? pAwayRlRaw / 100
    : pHomeRlResolved !== null ? 1 - pHomeRlResolved : null;
  const rlSource = pHomeRlRaw !== null ? 'stored' : 'sigmoid-fallback';
  const bookHomeRlOdds = parseOdds(game.homeRunLineOdds);
  const bookAwayRlOdds = parseOdds(game.awayRunLineOdds);

  const nvHomeRl = (bookHomeRlOdds !== null && bookAwayRlOdds !== null)
    ? noVigProb(bookHomeRlOdds, bookAwayRlOdds) : null;
  const nvAwayRl = nvHomeRl !== null ? parseFloat((1 - nvHomeRl).toFixed(4)) : null;

  if (pHomeRlResolved !== null) {
    const pHomeRl = pHomeRlResolved;
    const edge = calcEdge(pHomeRl, nvHomeRl);
    const ev   = calcEV(pHomeRl, bookHomeRlOdds);
    const conf = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : homeCovers ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_RL_HOME, modelSide: "home -1.5",
      modelProb: parseFloat(pHomeRl.toFixed(4)),
      bookLine: "-1.5", bookOdds: bookHomeRlOdds !== null ? String(bookHomeRlOdds) : null,
      bookNoVigProb: nvHomeRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `margin=${margin}`,
      notes: `P(home RL -1.5)=${pHomeRl.toFixed(4)} source=${rlSource} modelMargin=${modelMargin?.toFixed(2)} margin=${margin} covers=${homeCovers} book=${bookHomeRlOdds}`,
    });
  }

  if (pAwayRlResolved !== null) {
    const pAwayRl = pAwayRlResolved;
    const edge = calcEdge(pAwayRl, nvAwayRl);
    const ev   = calcEV(pAwayRl, bookAwayRlOdds);
    // Use FG_RL_AWAY_EDGE_THRESHOLD (18%) -- raised from global 5% to filter out
    // systematic home-edge correction bias. See constant definition for full rationale.
    const conf = edge !== null && edge >= FG_RL_AWAY_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : awayCovers ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_RL_AWAY, modelSide: "away +1.5",
      modelProb: parseFloat(pAwayRl.toFixed(4)),
      bookLine: "+1.5", bookOdds: bookAwayRlOdds !== null ? String(bookAwayRlOdds) : null,
      bookNoVigProb: nvAwayRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `margin=${margin}`,
      notes: `P(away RL +1.5)=${pAwayRl.toFixed(4)} source=${rlSource} edge=${edge?.toFixed(4)} threshold=${FG_RL_AWAY_EDGE_THRESHOLD} modelMargin=${modelMargin?.toFixed(2)} covers=${awayCovers} book=${bookAwayRlOdds}`,
    });
  }

  return results;
}"""

if OLD not in content:
    print('[ERROR] Could not find target block — check for encoding differences')
    sys.exit(1)

count = content.count(OLD)
print(f'[INPUT] Found {count} occurrence(s) of target block')

new_content = content.replace(OLD, NEW, 1)

with open(FILEPATH, 'w') as f:
    f.write(new_content)

print('[OUTPUT] Patch applied successfully')
print('[VERIFY] New content contains RL_SIGMOID_K:', 'RL_SIGMOID_K' in new_content)
print('[VERIFY] New content contains sigmoid-fallback:', 'sigmoid-fallback' in new_content)
print('[VERIFY] Old block removed:', OLD not in new_content)
