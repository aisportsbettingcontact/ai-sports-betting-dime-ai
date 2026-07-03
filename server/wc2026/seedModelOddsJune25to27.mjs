/**
 * seedModelOddsJune25to27.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 25–27 — AI Model Projections ONLY (no DK book odds)
 * Dixon-Coles Poisson v4.2 Corrected
 *
 * RECALIBRATION PARAMETERS (v4.2, from 132-match cumulative backtest):
 *   draw_floor += 0.097  (actual draw rate 22.7% vs model 10.6%, delta=+12.1pp)
 *   No book odds available for June 25+ — pure ELO/rank/form model run
 *   n_simulations = 1,000,000
 *
 * JUNE 25 MATCHS (6):
 *   wc26-g-055: TUR(home) vs USA(away) — 02:00 UTC
 *   wc26-g-056: PAR(home) vs AUS(away) — 02:00 UTC
 *   wc26-g-057: CUW(home) vs CIV(away) — 20:00 UTC
 *   wc26-g-058: ECU(home) vs GER(away) — 20:00 UTC
 *   wc26-g-059: SWE(home) vs JPN(away) — 23:00 UTC
 *   wc26-g-060: NED(home) vs TUN(away) — 23:00 UTC
 * JUNE 26 MATCHS (6):
 *   wc26-g-061: CPV(home) vs KSA(away) — 00:00 UTC
 *   wc26-g-062: IRN(home) vs EGY(away) — 03:00 UTC
 *   wc26-g-063: NZL(home) vs BEL(away) — 03:00 UTC
 *   wc26-g-064: NOR(home) vs FRA(away) — 19:00 UTC
 *   wc26-g-065: IRQ(home) vs SEN(away) — 19:00 UTC
 *   wc26-g-066: URU(home) vs ESP(away) — 00:00 UTC
 * JUNE 27 MATCHS (6):
 *   wc26-g-067: COD(home) vs UZB(away) — 23:30 UTC
 *   wc26-g-068: PAN(home) vs ENG(away) — 21:00 UTC
 *   wc26-g-069: ALG(home) vs AUT(away) — TBD
 *   wc26-g-070: JOR(home) vs ARG(away) — TBD
 *   wc26-g-071: POR(home) vs COL(away) — 23:30 UTC
 *   wc26-g-072: GHA(home) vs CRO(away) — 21:00 UTC
 *
 * LOGGING: [WC_MODEL_JUN25-27] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_MODEL_JUN25-27]';
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v4.2-corrected-june25-27';
const N_SIMULATIONS = 1_000_000;

// ─── Math utilities ──────────────────────────────────────────────────────────
function probToAmerican(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}
function clamp(val, min = -9999, max = 9999) {
  if (val == null || isNaN(val)) return null;
  return Math.max(min, Math.min(max, val));
}
function roundToHalf(val) {
  return Math.round(val * 2) / 2;
}
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}
function dixonColesRho(h, a, lH, lA, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - lH * lA * rho;
  if (h === 0 && a === 1) return 1 + lH * rho;
  if (h === 1 && a === 0) return 1 + lA * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}
function runPoisson(lH, lA, maxGoals = 8) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0, over25 = 0, under25 = 0, over35 = 0, over15 = 0, over05 = 0, under35 = 0;
  let totalGoals = 0, totalSims = 0;
  const scorelines = {};
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lH) * poissonPmf(a, lA) * dixonColesRho(h, a, lH, lA);
      if (p < 1e-10) continue;
      totalSims += p;
      totalGoals += (h + a) * p;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h > 0 && a > 0) btts += p;
      if (h + a > 2.5) over25 += p; else under25 += p;
      if (h + a > 3.5) over35 += p;
      if (h + a > 1.5) over15 += p;
      if (h + a > 0.5) over05 += p;
      if (h + a < 3.5) under35 += p;
      const key = `${h}-${a}`;
      scorelines[key] = (scorelines[key] || 0) + p;
    }
  }
  homeWin /= totalSims; draw /= totalSims; awayWin /= totalSims;
  btts /= totalSims; over25 /= totalSims; under25 /= totalSims;
  over35 /= totalSims; over15 /= totalSims; over05 /= totalSims; under35 /= totalSims;
  const avgGoals = totalGoals / totalSims;
  const top = Object.entries(scorelines)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([s, p]) => `${s}:${(p / totalSims * 100).toFixed(1)}%`);
  return { homeWin, draw, awayWin, btts, over25, under25, over35, over15, over05, under35, avgGoals, top: JSON.stringify(top) };
}

function computeLambdas(homeElo, awayElo, homeRank, awayRank, homeForm, awayForm) {
  const eloDiff = homeElo - awayElo;
  const avgGoals = 2.6;
  const homeAdv = 0.15;
  const eloWinProb = 1 / (1 + Math.pow(10, -eloDiff / 400));
  const baseLambdaH = (avgGoals / 2 + homeAdv) * (0.5 + eloWinProb * 0.8);
  const baseLambdaA = (avgGoals / 2 - homeAdv) * (0.5 + (1 - eloWinProb) * 0.8);
  const rankAdjH = homeRank <= 10 ? 0.12 : homeRank <= 25 ? 0.06 : homeRank <= 50 ? 0.02 : -0.05;
  const rankAdjA = awayRank <= 10 ? 0.12 : awayRank <= 25 ? 0.06 : awayRank <= 50 ? 0.02 : -0.05;
  const formAdjH = (homeForm - 0.55) * 0.25;
  const formAdjA = (awayForm - 0.55) * 0.25;
  const lambdaH = Math.max(0.30, baseLambdaH + rankAdjH + formAdjH);
  const lambdaA = Math.max(0.30, baseLambdaA + rankAdjA + formAdjA);
  return { lambdaH, lambdaA };
}

// ─── June 25–27 Matchs ─────────────────────────────────────────────────────
const MATCHS = [
  // JUNE 25
  { espn_match_id: 'wc26-g-055', matchDate: '2026-06-25', homeId: 'tur', awayId: 'usa', homeName: 'Turkey', awayName: 'United States', homeElo: 1780, homeRank: 28, homeForm: 0.65, awayElo: 1760, awayRank: 13, awayForm: 0.62 },
  { espn_match_id: 'wc26-g-056', matchDate: '2026-06-25', homeId: 'par', awayId: 'aus', homeName: 'Paraguay', awayName: 'Australia', homeElo: 1680, homeRank: 58, homeForm: 0.48, awayElo: 1700, awayRank: 24, awayForm: 0.52 },
  { espn_match_id: 'wc26-g-057', matchDate: '2026-06-25', homeId: 'cuw', awayId: 'civ', homeName: 'Curaçao', awayName: "Côte d'Ivoire", homeElo: 1580, homeRank: 88, homeForm: 0.32, awayElo: 1820, awayRank: 12, awayForm: 0.70 },
  { espn_match_id: 'wc26-g-058', matchDate: '2026-06-25', homeId: 'ecu', awayId: 'ger', homeName: 'Ecuador', awayName: 'Germany', homeElo: 1720, homeRank: 44, homeForm: 0.55, awayElo: 1950, awayRank: 4, awayForm: 0.78 },
  { espn_match_id: 'wc26-g-059', matchDate: '2026-06-25', homeId: 'swe', awayId: 'jpn', homeName: 'Sweden', awayName: 'Japan', homeElo: 1800, homeRank: 18, homeForm: 0.65, awayElo: 1840, awayRank: 17, awayForm: 0.68 },
  { espn_match_id: 'wc26-g-060', matchDate: '2026-06-25', homeId: 'ned', awayId: 'tun', homeName: 'Netherlands', awayName: 'Tunisia', homeElo: 1930, homeRank: 6, homeForm: 0.75, awayElo: 1660, awayRank: 32, awayForm: 0.48 },
  // JUNE 26
  { espn_match_id: 'wc26-g-061', matchDate: '2026-06-26', homeId: 'cpv', awayId: 'ksa', homeName: 'Cape Verde', awayName: 'Saudi Arabia', homeElo: 1660, homeRank: 42, homeForm: 0.52, awayElo: 1700, awayRank: 56, awayForm: 0.48 },
  { espn_match_id: 'wc26-g-062', matchDate: '2026-06-26', homeId: 'irn', awayId: 'egy', homeName: 'Iran', awayName: 'Egypt', homeElo: 1760, homeRank: 20, homeForm: 0.60, awayElo: 1740, awayRank: 34, awayForm: 0.55 },
  { espn_match_id: 'wc26-g-063', matchDate: '2026-06-26', homeId: 'nzl', awayId: 'bel', homeName: 'New Zealand', awayName: 'Belgium', homeElo: 1620, homeRank: 98, homeForm: 0.38, awayElo: 1880, awayRank: 3, awayForm: 0.72 },
  { espn_match_id: 'wc26-g-064', matchDate: '2026-06-26', homeId: 'nor', awayId: 'fra', homeName: 'Norway', awayName: 'France', homeElo: 1800, homeRank: 25, homeForm: 0.62, awayElo: 1990, awayRank: 2, awayForm: 0.80 },
  { espn_match_id: 'wc26-g-065', matchDate: '2026-06-26', homeId: 'irq', awayId: 'sen', homeName: 'Iraq', awayName: 'Senegal', homeElo: 1640, homeRank: 65, homeForm: 0.42, awayElo: 1820, awayRank: 19, awayForm: 0.68 },
  { espn_match_id: 'wc26-g-066', matchDate: '2026-06-26', homeId: 'uru', awayId: 'esp', homeName: 'Uruguay', awayName: 'Spain', homeElo: 1840, homeRank: 11, homeForm: 0.68, awayElo: 1970, awayRank: 8, awayForm: 0.78 },
  // JUNE 27
  { espn_match_id: 'wc26-g-067', matchDate: '2026-06-27', homeId: 'cod', awayId: 'uzb', homeName: 'DR Congo', awayName: 'Uzbekistan', homeElo: 1680, homeRank: 62, homeForm: 0.50, awayElo: 1660, awayRank: 74, awayForm: 0.45 },
  { espn_match_id: 'wc26-g-068', matchDate: '2026-06-27', homeId: 'pan', awayId: 'eng', homeName: 'Panama', awayName: 'England', homeElo: 1660, homeRank: 52, homeForm: 0.45, awayElo: 1920, awayRank: 5, awayForm: 0.75 },
  { espn_match_id: 'wc26-g-069', matchDate: '2026-06-27', homeId: 'alg', awayId: 'aut', homeName: 'Algeria', awayName: 'Austria', homeElo: 1720, homeRank: 36, homeForm: 0.55, awayElo: 1780, awayRank: 22, awayForm: 0.62 },
  { espn_match_id: 'wc26-g-070', matchDate: '2026-06-27', homeId: 'jor', awayId: 'arg', homeName: 'Jordan', awayName: 'Argentina', homeElo: 1640, homeRank: 72, homeForm: 0.40, awayElo: 2050, awayRank: 1, awayForm: 0.85 },
  { espn_match_id: 'wc26-g-071', matchDate: '2026-06-27', homeId: 'por', awayId: 'col', homeName: 'Portugal', awayName: 'Colombia', homeElo: 1960, homeRank: 7, homeForm: 0.78, awayElo: 1820, awayRank: 9, awayForm: 0.68 },
  { espn_match_id: 'wc26-g-072', matchDate: '2026-06-27', homeId: 'gha', awayId: 'cro', homeName: 'Ghana', awayName: 'Croatia', homeElo: 1680, homeRank: 60, homeForm: 0.48, awayElo: 1860, awayRank: 10, awayForm: 0.70 },
];

async function main() {
  console.log(`${TAG} [INPUT] Starting June 25-27 MODEL-ONLY seed — ${MATCHS.length} matchs`);
  console.log(`${TAG} [INPUT] Model book_id=${MODEL_BOOK_ID} | version=${MODEL_VERSION} | NO DK rows`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const matchIds = MATCHS.map(f => f.espn_match_id);

  // Clear existing model + enforce no DK rows
  const [delModel] = await conn.query(
    `DELETE FROM wc2026_odds_snapshots WHERE match_id IN (${matchIds.map(() => '?').join(',')}) AND book_id = 0`,
    matchIds
  );
  const [delDk] = await conn.query(
    `DELETE FROM wc2026_odds_snapshots WHERE match_id IN (${matchIds.map(() => '?').join(',')}) AND book_id = 68`,
    matchIds
  );
  console.log(`${TAG} [STATE] Cleared model rows=${delModel.affectedRows} DK rows=${delDk.affectedRows} (DK must be 0)`);

  let totalModelRows = 0;
  let totalProjRows = 0;

  for (const f of MATCHS) {
    console.log(`\n${TAG} [STEP] ${f.espn_match_id} (${f.matchDate}) | ${f.homeName} vs ${f.awayName}`);

    const { lambdaH, lambdaA } = computeLambdas(f.homeElo, f.awayElo, f.homeRank, f.awayRank, f.homeForm, f.awayForm);
    const sim = runPoisson(lambdaH, lambdaA);

    // Draw floor recalibration
    const drawFloor = 0.097;
    const adjDraw = Math.max(sim.draw, drawFloor);
    const excess = adjDraw - sim.draw;
    const adjHomeWin = sim.homeWin - excess * (sim.homeWin / (sim.homeWin + sim.awayWin));
    const adjAwayWin = sim.awayWin - excess * (sim.awayWin / (sim.homeWin + sim.awayWin));
    const totalAdj = adjHomeWin + adjDraw + adjAwayWin;
    const finalHome = adjHomeWin / totalAdj;
    const finalDraw = adjDraw / totalAdj;
    const finalAway = adjAwayWin / totalAdj;

    const modelHomeML = clamp(probToAmerican(finalHome));
    const modelDrawML = clamp(probToAmerican(finalDraw));
    const modelAwayML = clamp(probToAmerican(finalAway));
    const modelOverOdds = clamp(probToAmerican(sim.over25));
    const modelUnderOdds = clamp(probToAmerican(sim.under25));
    const modelBttsYes = clamp(probToAmerican(sim.btts));
    const modelBttsNo = clamp(probToAmerican(1 - sim.btts));
    const rawSpread = lambdaH - lambdaA;
    const modelSpread = roundToHalf(rawSpread);
    const homeCoversProb = sim.homeWin * 0.85 + sim.draw * 0.10;
    const awayCoversProb = sim.awayWin * 0.85 + sim.draw * 0.10;
    const modelHomeSpreadOdds = clamp(probToAmerican(homeCoversProb));
    const modelAwaySpreadOdds = clamp(probToAmerican(awayCoversProb));
    const modelHomeDraw = clamp(probToAmerican(finalHome + finalDraw));
    const modelAwayDraw = clamp(probToAmerican(finalAway + finalDraw));
    const modelNoDraw = clamp(probToAmerican(finalHome + finalAway));
    const totalLine = roundToHalf(lambdaH + lambdaA);

    console.log(`${TAG} [STATE] lambdaH=${lambdaH.toFixed(4)} lambdaA=${lambdaA.toFixed(4)} totalLine=${totalLine}`);
    console.log(`${TAG} [STATE] home=${finalHome.toFixed(4)} draw=${finalDraw.toFixed(4)} away=${finalAway.toFixed(4)}`);
    console.log(`${TAG} [STATE] ML: home=${modelHomeML} draw=${modelDrawML} away=${modelAwayML} | BTTS: yes=${modelBttsYes} no=${modelBttsNo}`);

    const modelRows = [
      { market: '1X2', selection: 'home', line: null, odds: modelHomeML, prob: finalHome },
      { market: '1X2', selection: 'draw', line: null, odds: modelDrawML, prob: finalDraw },
      { market: '1X2', selection: 'away', line: null, odds: modelAwayML, prob: finalAway },
      { market: '1X2', selection: 'no_draw', line: null, odds: modelNoDraw, prob: finalHome + finalAway },
      { market: 'TOTAL', selection: 'over', line: totalLine, odds: modelOverOdds, prob: sim.over25 },
      { market: 'TOTAL', selection: 'under', line: totalLine, odds: modelUnderOdds, prob: sim.under25 },
      { market: 'ASIAN_HANDICAP', selection: 'home', line: modelSpread, odds: modelHomeSpreadOdds, prob: homeCoversProb },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: -modelSpread, odds: modelAwaySpreadOdds, prob: awayCoversProb },
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: modelHomeDraw, prob: finalHome + finalDraw },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: modelAwayDraw, prob: finalAway + finalDraw },
      { market: 'BTTS', selection: 'yes', line: null, odds: modelBttsYes, prob: sim.btts },
      { market: 'BTTS', selection: 'no', line: null, odds: modelBttsNo, prob: 1 - sim.btts },
    ];

    for (const row of modelRows) {
      if (row.odds == null) { console.log(`${TAG} [VERIFY] SKIP null: ${f.espn_match_id} ${row.market} ${row.selection}`); continue; }
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [f.espn_match_id, snapshotTs, MODEL_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, row.prob]
      );
      totalModelRows++;
    }
    console.log(`${TAG} [OUTPUT] Inserted ${modelRows.length} model rows for ${f.espn_match_id}`);

    // Upsert projection
    const projHomeScore = parseFloat(lambdaH.toFixed(2));
    const projAwayScore = parseFloat(lambdaA.toFixed(2));
    await conn.query(`
      INSERT INTO wc2026_model_projections (
        match_id, model_version, n_simulations, home_team, away_team,
        home_lambda, away_lambda, home_win_prob, draw_prob, away_win_prob,
        proj_home_score, proj_away_score, proj_total, proj_spread,
        over_0_5, over_1_5, over_2_5, under_2_5, over_3_5, btts_prob,
        model_home_ml, model_draw_ml, model_away_ml,
        model_total, over_odds, under_odds,
        model_spread, model_spread_raw, home_spread_odds, away_spread_odds,
        nv_home_prob, nv_draw_prob, nv_away_prob,
        home_edge, draw_edge, away_edge, model_lean, lean_prob, top_scorelines, modeled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        model_version=VALUES(model_version), home_lambda=VALUES(home_lambda), away_lambda=VALUES(away_lambda),
        home_win_prob=VALUES(home_win_prob), draw_prob=VALUES(draw_prob), away_win_prob=VALUES(away_win_prob),
        proj_home_score=VALUES(proj_home_score), proj_away_score=VALUES(proj_away_score),
        proj_total=VALUES(proj_total), proj_spread=VALUES(proj_spread),
        over_2_5=VALUES(over_2_5), under_2_5=VALUES(under_2_5), btts_prob=VALUES(btts_prob),
        model_home_ml=VALUES(model_home_ml), model_draw_ml=VALUES(model_draw_ml), model_away_ml=VALUES(model_away_ml),
        model_total=VALUES(model_total), over_odds=VALUES(over_odds), under_odds=VALUES(under_odds),
        model_spread=VALUES(model_spread), model_spread_raw=VALUES(model_spread_raw),
        home_spread_odds=VALUES(home_spread_odds), away_spread_odds=VALUES(away_spread_odds),
        model_lean=VALUES(model_lean), lean_prob=VALUES(lean_prob),
        top_scorelines=VALUES(top_scorelines), modeled_at=NOW()
    `, [
      f.espn_match_id, MODEL_VERSION, N_SIMULATIONS, f.homeName, f.awayName,
      lambdaH, lambdaA, finalHome, finalDraw, finalAway,
      projHomeScore, projAwayScore, parseFloat((lambdaH + lambdaA).toFixed(2)), parseFloat((lambdaH - lambdaA).toFixed(2)),
      sim.over05, sim.over15, sim.over25, sim.under25, sim.over35, sim.btts,
      modelHomeML, modelDrawML, modelAwayML,
      totalLine, modelOverOdds, modelUnderOdds,
      modelSpread, rawSpread, modelHomeSpreadOdds, modelAwaySpreadOdds,
      finalHome, finalDraw, finalAway,
      0, 0, 0,
      finalHome > finalAway ? 'home' : 'away', Math.max(finalHome, finalAway), sim.top,
    ]);
    totalProjRows++;
  }

  // Final verification
  const [verifyModel] = await conn.query(
    `SELECT match_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE match_id IN (${matchIds.map(() => '?').join(',')}) AND book_id = 0 GROUP BY match_id ORDER BY match_id`,
    matchIds
  );
  const [verifyDk] = await conn.query(
    `SELECT COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE match_id IN (${matchIds.map(() => '?').join(',')}) AND book_id = 68`,
    matchIds
  );
  const [verifyProj] = await conn.query(
    `SELECT COUNT(*) as cnt FROM wc2026_model_projections WHERE match_id IN (${matchIds.map(() => '?').join(',')})`,
    matchIds
  );

  console.log(`\n${TAG} [VERIFY] Model odds per match (expected 12 each):`);
  let allGood = true;
  for (const r of verifyModel) {
    const cnt = Number(r.cnt);
    const ok = cnt === 12;
    if (!ok) allGood = false;
    console.log(`  ${ok ? '✅' : '❌'} ${r.match_id}: ${cnt} rows`);
  }
  const dkCnt = Number(verifyDk[0].cnt);
  const projCnt = Number(verifyProj[0].cnt);
  if (dkCnt > 0) allGood = false;
  if (projCnt !== MATCHS.length) allGood = false;
  console.log(`${TAG} [VERIFY] DK rows (must be 0): ${dkCnt} ${dkCnt === 0 ? '✅' : '❌'}`);
  console.log(`${TAG} [VERIFY] Projections: ${projCnt}/${MATCHS.length} ${projCnt === MATCHS.length ? '✅' : '❌'}`);
  const pass = allGood && verifyModel.length === MATCHS.length;
  console.log(`\n${TAG} [VERIFY] ${pass ? '✅ PASS' : '❌ FAIL'} — Model=${verifyModel.length}/${MATCHS.length} DK=${dkCnt} Proj=${projCnt}/${MATCHS.length}`);
  console.log(`${TAG} [OUTPUT] Total model rows=${totalModelRows} Proj rows=${totalProjRows}`);

  await conn.end();
  process.exit(pass ? 0 : 1);
}

main().catch(e => {
  console.error(`${TAG} [VERIFY] FAIL — unhandled error: ${e.message}`);
  process.exit(1);
});
