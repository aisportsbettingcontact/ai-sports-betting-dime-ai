/**
 * etPensBacktest.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Backtest the ET/Pens model against the 2 WC2026 matches that went to
 * ET/Pens: NED vs MAR (760488) and GER vs PAR (760489).
 *
 * Ground truth (from DB):
 *   760488: NED(home) 1-1 MAR(away) → MAR wins pens 3-2 → MAR advances
 *   760489: GER(home) 1-1 PAR(away) → PAR wins pens 4-3 → PAR advances
 *
 * We compare three ET/Pens models:
 *   M0: Flat 50/50 (current placeholder)
 *   M1: Pure λ-ratio: etH = λH / (λH + λA)
 *   M2: 70% regression to mean: etH = 0.5 + (λH/(λH+λA) - 0.5) * 0.70
 *   M3: 50% regression to mean: etH = 0.5 + (λH/(λH+λA) - 0.5) * 0.50
 *
 * For each model, we compute P(home advances) and P(away advances) given
 * the actual draw outcome (1-1), then check which model was closer to the
 * actual outcome (away advancing in both cases).
 *
 * Lambda values come from the V2 config (verified in lambda_diag.mjs):
 *   NED: λ = ? (need to query from DB — NED played 3 GS matches)
 *   MAR: λ = ? (need to query from DB — MAR played 3 GS matches)
 *   GER: λ = ? (need to query from DB — GER played 3 GS matches)
 *   PAR: λ = ? (need to query from DB — PAR played 3 GS matches)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

// ── V2 weight config (same as v12_pure_data_engine.mjs) ─────────────────────
const V2 = {
  xGW:0.45, xGOTW:0.15, smW:0.12, psW:0.08, xAW:0.08,
  spW:0.05, possW:0.04, convW:0.03, pace:0.035
};

// ── Poisson PMF ──────────────────────────────────────────────────────────────
function pois(k, l) {
  if (l <= 0) return k === 0 ? 1 : 0;
  let f = 1;
  for (let i = 1; i <= k; i++) f *= i;
  return Math.exp(-l) * Math.pow(l, k) / f;
}

// ── DC tau correction ────────────────────────────────────────────────────────
function tau(x, y, lH, lA, r) {
  if (x===0&&y===0) return 1 - lH*lA*r;
  if (x===0&&y===1) return 1 + lH*r;
  if (x===1&&y===0) return 1 + lA*r;
  if (x===1&&y===1) return 1 - r;
  return 1;
}

// ── Compute lambda for a team from ESPN data ─────────────────────────────────
async function computeLambda(teamAbbrev) {
  // xG per match (Phase A)
  const [xgRows] = await db.query(
    `SELECT e.homeXG, e.awayXG, m.homeTeamAbbrev, m.awayTeamAbbrev
     FROM wc2026_espn_expected_goals e
     JOIN wc2026_espn_matches m ON m.matchId = e.matchId
     WHERE (m.homeTeamAbbrev = ? OR m.awayTeamAbbrev = ?)
       AND e.homeXG IS NOT NULL
       AND m.round = 'Group Stage'`,
    [teamAbbrev, teamAbbrev]
  );

  if (xgRows.length === 0) {
    console.log(`[WARN] No xG data for ${teamAbbrev}`);
    return null;
  }

  let xGSum=0, xGOTSum=0, xASum=0, spXGSum=0, possSum=0, smXGSum=0, psXGSum=0;
  let n = 0;

  for (const row of xgRows) {
    const isHome = row.homeTeamAbbrev === teamAbbrev;
    const xG = isHome ? row.homeXG : row.awayXG;
    const xGOT = isHome ? row.homeXGOT : row.awayXGOT;
    const xA = isHome ? row.homeXA : row.awayXA;
    const spXG = isHome ? row.homeXGSetPlay : row.awayXGSetPlay;

    // shot map xG
    const [smRows] = await db.query(
      `SELECT SUM(xG) as smXG, SUM(xGOT) as smXGOT
       FROM wc2026_espn_shot_map sm
       JOIN wc2026_espn_matches m ON m.matchId = sm.matchId
       WHERE m.matchId = ? AND sm.teamAbbrev = ?`,
      [row.matchId || xgRows[0].matchId, teamAbbrev]
    );

    // player stats xG
    const [psRows] = await db.query(
      `SELECT SUM(xG) as psXG
       FROM wc2026_espn_player_stats ps
       JOIN wc2026_espn_matches m ON m.matchId = ps.matchId
       WHERE m.matchId = ? AND ps.teamAbbrev = ?`,
      [row.matchId || xgRows[0].matchId, teamAbbrev]
    );

    // possession
    const [tsRows] = await db.query(
      `SELECT ts.possession, ts.possessionAway, m.homeTeamAbbrev
       FROM wc2026_espn_team_stats ts
       JOIN wc2026_espn_matches m ON m.matchId = ts.matchId
       WHERE m.matchId = ?`,
      [row.matchId || xgRows[0].matchId]
    );

    const smXG = smRows[0]?.smXG ?? xG;
    const psXG = psRows[0]?.psXG ?? xG;
    const poss = tsRows.length > 0
      ? (isHome ? tsRows[0].possession : tsRows[0].possessionAway) ?? 50
      : 50;

    xGSum += xG ?? 0;
    xGOTSum += xGOT ?? 0;
    xASum += xA ?? 0;
    spXGSum += spXG ?? 0;
    smXGSum += smXG ?? 0;
    psXGSum += psXG ?? 0;
    possSum += poss;
    n++;
  }

  if (n === 0) return null;

  const xGAvg = xGSum / n;
  const xGOTAvg = xGOTSum / n;
  const xAAvg = xASum / n;
  const spXGAvg = spXGSum / n;
  const smXGAvg = smXGSum / n;
  const psXGAvg = psXGSum / n;
  const possAvg = possSum / n;
  const convW = V2.convW;

  // Conversion rate component
  const [convRows] = await db.query(
    `SELECT m.homeTeamAbbrev, ts.shotsOnGoal, ts.shotsOnGoalAway
     FROM wc2026_espn_team_stats ts
     JOIN wc2026_espn_matches m ON m.matchId = ts.matchId
     JOIN wc2026_espn_matches m2 ON m2.matchId = ts.matchId
     WHERE (m.homeTeamAbbrev = ? OR m2.awayTeamAbbrev = ?)
       AND m.round = 'Group Stage'`,
    [teamAbbrev, teamAbbrev]
  );

  // Raw lambda
  const raw = (
    V2.xGW * xGAvg +
    V2.xGOTW * xGOTAvg +
    V2.smW * smXGAvg +
    V2.psW * psXGAvg +
    V2.xAW * xAAvg +
    V2.spW * spXGAvg +
    V2.possW * (possAvg / 100) * 2.0
  );

  // Pace adjustment (tournament pace discount)
  const lambda = raw * (1 - V2.pace);

  return { teamAbbrev, n, xGAvg, xGOTAvg, xAAvg, spXGAvg, smXGAvg, psXGAvg, possAvg, raw, lambda };
}

// ── Simpler: use the verified lambda values from lambda_diag.mjs ─────────────
// We'll query directly from the DB using the same V2 logic as lambda_diag.mjs
// but for NED, MAR, GER, PAR

async function computeLambdaSimple(teamAbbrev) {
  const [rows] = await db.query(
    `SELECT 
       e.matchId,
       m.homeTeamAbbrev, m.awayTeamAbbrev,
       e.homeXG, e.awayXG,
       e.homeXGOT, e.awayXGOT,
       e.homeXA, e.awayXA,
       e.homeXGSetPlay, e.awayXGSetPlay
     FROM wc2026_espn_expected_goals e
     JOIN wc2026_espn_matches m ON m.matchId = e.matchId
     WHERE (m.homeTeamAbbrev = ? OR m.awayTeamAbbrev = ?)
       AND e.homeXG IS NOT NULL
       AND m.round = 'Group Stage'
     ORDER BY e.matchId`,
    [teamAbbrev, teamAbbrev]
  );

  if (rows.length === 0) {
    console.log(`[WARN] No GS xG data for ${teamAbbrev}`);
    return null;
  }

  let totXG=0, totXGOT=0, totXA=0, totSP=0, totSM=0, totPS=0, totPoss=0;
  let n = rows.length;

  for (const r of rows) {
    const isHome = r.homeTeamAbbrev === teamAbbrev;
    const xG   = isHome ? +r.homeXG   : +r.awayXG;
    const xGOT = isHome ? +r.homeXGOT : +r.awayXGOT;
    const xA   = isHome ? +r.homeXA   : +r.awayXA;
    const sp   = isHome ? +r.homeXGSetPlay : +r.awayXGSetPlay;

    // shot map
    const [sm] = await db.query(
      `SELECT COALESCE(SUM(xG),0) as smXG FROM wc2026_espn_shot_map
       WHERE matchId=? AND teamAbbrev=?`, [r.matchId, teamAbbrev]
    );
    // player stats
    const [ps] = await db.query(
      `SELECT COALESCE(SUM(xG),0) as psXG FROM wc2026_espn_player_stats
       WHERE matchId=? AND teamAbbrev=?`, [r.matchId, teamAbbrev]
    );
    // possession
    const [ts] = await db.query(
      `SELECT possession, possessionAway FROM wc2026_espn_team_stats WHERE matchId=?`, [r.matchId]
    );
    const poss = ts.length > 0 ? (isHome ? +ts[0].possession : +ts[0].possessionAway) : 50;

    const smXG = +sm[0].smXG || xG;
    const psXG = +ps[0].psXG || xG;

    totXG   += xG;
    totXGOT += xGOT;
    totXA   += xA;
    totSP   += sp;
    totSM   += smXG;
    totPS   += psXG;
    totPoss += poss;
  }

  const xGAvg   = totXG / n;
  const xGOTAvg = totXGOT / n;
  const xAAvg   = totXA / n;
  const spAvg   = totSP / n;
  const smAvg   = totSM / n;
  const psAvg   = totPS / n;
  const possAvg = totPoss / n;

  const raw = (
    V2.xGW   * xGAvg +
    V2.xGOTW * xGOTAvg +
    V2.smW   * smAvg +
    V2.psW   * psAvg +
    V2.xAW   * xAAvg +
    V2.spW   * spAvg +
    V2.possW * (possAvg / 100) * 2.0
  );

  const lambda = raw * (1 - V2.pace);

  return { teamAbbrev, n, xGAvg, xGOTAvg, xAAvg, spAvg, smAvg, psAvg, possAvg, raw, lambda };
}

// ── ET/Pens model comparison ─────────────────────────────────────────────────
function etModels(lH, lA) {
  const ratio = lH / (lH + lA);
  return {
    M0: { etH: 0.50,                                   etA: 0.50,                                   label: 'Flat 50/50' },
    M1: { etH: ratio,                                  etA: 1 - ratio,                              label: 'Pure λ-ratio' },
    M2: { etH: 0.5 + (ratio - 0.5) * 0.70,            etA: 1 - (0.5 + (ratio - 0.5) * 0.70),      label: '70% regression' },
    M3: { etH: 0.5 + (ratio - 0.5) * 0.50,            etA: 1 - (0.5 + (ratio - 0.5) * 0.50),      label: '50% regression' },
  };
}

// ── Dixon-Coles simulation (simplified — just pDraw + pAdvH/pAdvA) ───────────
function dcSim(lH, lA, rho=0.065) {
  const MAX = 8;
  let pD = 0, pAdvH_base = 0, pAdvA_base = 0;
  let tot = 0;

  for (let h = 0; h <= MAX; h++) {
    for (let a = 0; a <= MAX; a++) {
      const p = pois(h, lH) * pois(a, lA) * tau(h, a, lH, lA, rho);
      tot += p;
      if (h === a) pD += p;
      else if (h > a) pAdvH_base += p;
      else pAdvA_base += p;
    }
  }

  return { pD: pD/tot, pAdvH_base: pAdvH_base/tot, pAdvA_base: pAdvA_base/tot };
}

// ── Main backtest ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(80));
console.log('  ET/PENS MODEL BACKTEST — WC2026 R32');
console.log('  Matches: NED vs MAR (760488), GER vs PAR (760489)');
console.log('═'.repeat(80));

// Ground truth
const GROUND_TRUTH = [
  { matchId: '760488', home: 'NED', away: 'MAR', homeScore: 1, awayScore: 1, advancer: 'away', advancerName: 'MAR', note: 'MAR wins pens 3-2' },
  { matchId: '760489', home: 'GER', away: 'PAR', homeScore: 1, awayScore: 1, advancer: 'away', advancerName: 'PAR', note: 'PAR wins pens 4-3' },
];

// Compute lambdas for all 4 teams
const teams = ['NED', 'MAR', 'GER', 'PAR'];
const lambdas = {};

console.log('\n[STEP] Computing lambdas for NED, MAR, GER, PAR...');
for (const team of teams) {
  const result = await computeLambdaSimple(team);
  if (result) {
    lambdas[team] = result.lambda;
    console.log(`  [λ] ${team}: n=${result.n} | xGAvg=${result.xGAvg.toFixed(3)} | raw=${result.raw.toFixed(4)} | λ=${result.lambda.toFixed(4)}`);
  } else {
    console.log(`  [WARN] ${team}: no data found`);
    lambdas[team] = 1.0; // fallback
  }
}

// Backtest each match
const modelScores = { M0: 0, M1: 0, M2: 0, M3: 0 };
const modelLogLoss = { M0: 0, M1: 0, M2: 0, M3: 0 };

console.log('\n' + '─'.repeat(80));
for (const gt of GROUND_TRUTH) {
  const lH = lambdas[gt.home];
  const lA = lambdas[gt.away];

  console.log(`\n[MATCH] ${gt.home} (λ=${lH?.toFixed(4)}) vs ${gt.away} (λ=${lA?.toFixed(4)})`);
  console.log(`  Result: 1-1 after 90min → ${gt.advancerName} advances (${gt.note})`);
  console.log(`  Actual advancer: ${gt.advancer.toUpperCase()} (${gt.advancerName})`);

  if (!lH || !lA) {
    console.log('  [SKIP] Missing lambda data');
    continue;
  }

  const { pD, pAdvH_base, pAdvA_base } = dcSim(lH, lA);
  console.log(`\n  [DC SIM] pHome=${(pAdvH_base*100).toFixed(1)}% | pDraw=${(pD*100).toFixed(1)}% | pAway=${(pAdvA_base*100).toFixed(1)}%`);

  const models = etModels(lH, lA);

  console.log('\n  [ET/PENS MODEL COMPARISON]');
  console.log('  ' + '─'.repeat(70));
  console.log('  ' + 'Model'.padEnd(20) + 'etH%'.padEnd(10) + 'etA%'.padEnd(10) + 'P(H adv)'.padEnd(12) + 'P(A adv)'.padEnd(12) + 'Correct?');
  console.log('  ' + '─'.repeat(70));

  for (const [key, m] of Object.entries(models)) {
    // P(home advances) = P(home wins in 90) + P(draw) * etH
    const pAdvH = pAdvH_base + pD * m.etH;
    const pAdvA = pAdvA_base + pD * m.etA;

    const correct = gt.advancer === 'away' ? (pAdvA > pAdvH ? '✅ CORRECT' : '❌ WRONG') : (pAdvH > pAdvA ? '✅ CORRECT' : '❌ WRONG');
    const actualProb = gt.advancer === 'away' ? pAdvA : pAdvH;

    const row1 = (key + ' ' + m.label).padEnd(20) + (m.etH*100).toFixed(1)+'%'.padEnd(10) + (m.etA*100).toFixed(1)+'%'.padEnd(10) + ((pAdvH*100).toFixed(1)+'%').padEnd(12) + ((pAdvA*100).toFixed(1)+'%').padEnd(12) + correct;
    console.log('  ' + row1);

    // Log-loss for the actual outcome
    const logLoss = -Math.log(Math.max(actualProb, 0.001));
    modelLogLoss[key] += logLoss;

    if (correct.includes('CORRECT')) modelScores[key]++;
  }

  // Also show: given that the match DID go to ET/Pens (i.e., it was a draw),
  // what was each model's conditional P(advancer) in ET/Pens alone?
  console.log('\n  [CONDITIONAL ET/PENS ONLY — given draw occurred]');
  for (const [key, m] of Object.entries(models)) {
    const etCorrect = gt.advancer === 'away' ? (m.etA > m.etH ? '✅' : '❌') : (m.etH > m.etA ? '✅' : '❌');
    const etActualProb = gt.advancer === 'away' ? m.etA : m.etH;
    console.log('  ' + (key + ' ' + m.label).padEnd(20) + ' P(' + gt.advancerName + ' adv in ET)=' + (etActualProb*100).toFixed(1) + '%  ' + etCorrect);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(80));
console.log('  BACKTEST SUMMARY (2 ET/Pens matches)');
console.log('═'.repeat(80));
  console.log('  ' + 'Model'.padEnd(20) + 'Correct'.padEnd(10) + 'Log-Loss'.padEnd(12) + 'Winner?');
console.log('  ' + '─'.repeat(50));

let bestModel = null, bestLogLoss = Infinity;
for (const [key, score] of Object.entries(modelScores)) {
  const ll = modelLogLoss[key].toFixed(4);
  const isBest = modelLogLoss[key] < bestLogLoss;
  if (isBest) { bestLogLoss = modelLogLoss[key]; bestModel = key; }
  const models = etModels(1, 1); // just for labels
  const label = { M0:'Flat 50/50', M1:'Pure λ-ratio', M2:'70% regression', M3:'50% regression' }[key];
    const row2 = (key + ' ' + label).padEnd(20) + (score+'/2').padEnd(10) + ll.padEnd(12);
    console.log('  ' + row2);
}

console.log(`\n  ✅ WINNER: ${bestModel} (lowest log-loss = ${bestLogLoss.toFixed(4)})`);
console.log('\n  [NOTE] With only 2 samples, this is directional evidence only.');
console.log('  The model with lowest log-loss assigns highest probability to actual outcomes.');

await db.end();
