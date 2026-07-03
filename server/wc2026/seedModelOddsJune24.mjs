/**
 * seedModelOddsJune24.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 24 — DraftKings Book Odds + AI Model Projections
 * Dixon-Coles Poisson v4.2 Corrected
 *
 * RECALIBRATION PARAMETERS (v4.2, from 132-match cumulative backtest):
 *   draw_floor += 0.097  (actual draw rate 22.7% vs model 10.6%, delta=+12.1pp)
 *   blend weights: w_book=0.25, w_elo=0.40, w_rank=0.15, w_form=0.20
 *   n_simulations = 1,000,000
 *
 * JUNE 24 MATCHS (DB verified, kickoff_utc order):
 *   wc26-g-049: CAN (home=can) vs SUI (away=sui) — Group D, 17:00 UTC
 *   wc26-g-052: BIH (home=bih) vs QAT (away=qat) — Group F, 17:00 UTC
 *   wc26-g-053: HAI (home=hai) vs MAR (away=mar) — Group H, 17:00 UTC
 *   wc26-g-054: SCO (home=sco) vs BRA (away=bra) — Group G, 21:00 UTC
 *   wc26-g-050: RSA (home=rsa) vs KOR (away=kor) — Group C, 21:00 UTC
 *   wc26-g-051: CZE (home=cze) vs MEX (away=mex) — Group B, 21:00 UTC
 *
 * NOTE ON HOME/AWAY ORIENTATION:
 *   The DB stores home_team_id / away_team_id per the official FIFA match.
 *   User-provided odds use "Away" / "Home" labels per the BOOK (DraftKings).
 *   All odds below are mapped to DB orientation (home_team_id = home).
 *
 * DK BOOK ODDS (user-provided, mapped to DB home/away orientation):
 *   wc26-g-049 CAN(home) vs SUI(away):
 *     1X2: home(CAN)=+240 / draw=+210 / away(SUI)=+135
 *     TOTAL: O2.5=+100 / U2.5=-125 (line=2.5)
 *     ASIAN_HANDICAP: home(CAN)+1.5=-575 / away(SUI)-1.5=+400
 *     DOUBLE_CHANCE: home_draw(CAN or Draw)=-170 / away_draw(SUI or Draw)=-310
 *     BTTS: yes=-140 / no=+110
 *     NO_DRAW: home(CAN)=+240 / away(SUI)=+135 combined → no_draw=-270
 *
 *   wc26-g-052 BIH(home) vs QAT(away):
 *     1X2: home(BIH)=-240 / draw=+400 / away(QAT)=+600
 *     TOTAL: O2.5=-175 / U2.5=+140 (line=2.5)
 *     ASIAN_HANDICAP: home(BIH)-1.5=+110 / away(QAT)+1.5=-140
 *     DOUBLE_CHANCE: home_draw(BIH or Draw)=-1000 / away_draw(QAT or Draw)=+185
 *     BTTS: yes=-135 / no=+105
 *     NO_DRAW: no_draw=-575
 *
 *   wc26-g-053 HAI(home) vs MAR(away):
 *     1X2: home(HAI)=+1400 / draw=+600 / away(MAR)=-500
 *     TOTAL: O3.5=+145 / U3.5=-175 (line=3.5)
 *     ASIAN_HANDICAP: home(HAI)+1.5=+135 / away(MAR)-1.5=-170
 *     DOUBLE_CHANCE: home_draw(HAI or Draw)=+340 / away_draw(MAR or Draw)=-3500
 *     BTTS: yes=+130 / no=-165
 *     NO_DRAW: no_draw=-1000
 *
 *   wc26-g-054 SCO(home) vs BRA(away):
 *     1X2: home(SCO)=+700 / draw=+425 / away(BRA)=-265
 *     TOTAL: O2.5=-115 / U2.5=-105 (line=2.5)
 *     ASIAN_HANDICAP: home(SCO)+1.5=-130 / away(BRA)-1.5=+100
 *     DOUBLE_CHANCE: home_draw(SCO or Draw)=+200 / away_draw(BRA or Draw)=-1100
 *     BTTS: yes=+130 / no=-165
 *     NO_DRAW: no_draw=-600
 *
 *   wc26-g-050 RSA(home) vs KOR(away):
 *     1X2: home(RSA)=+425 / draw=+295 / away(KOR)=-150
 *     TOTAL: O2.5=+105 / U2.5=-130 (line=2.5)
 *     ASIAN_HANDICAP: home(RSA)+1.5=-250 / away(KOR)-1.5=+195
 *     DOUBLE_CHANCE: home_draw(RSA or Draw)=+115 / away_draw(KOR or Draw)=-600
 *     BTTS: yes=-105 / no=-125
 *     NO_DRAW: no_draw=-390
 *
 *   wc26-g-051 CZE(home) vs MEX(away):
 *     1X2: home(CZE)=+265 / draw=+285 / away(MEX)=-105
 *     TOTAL: O2.5=+105 / U2.5=-130 (line=2.5)
 *     ASIAN_HANDICAP: home(CZE)+1.5=-350 / away(MEX)-1.5=+260
 *     DOUBLE_CHANCE: home_draw(CZE or Draw)=-120 / away_draw(MEX or Draw)=-350
 *     BTTS: yes=-110 / no=-115
 *     NO_DRAW: no_draw=-370
 *
 * LOGGING: [WC_MODEL_JUNE24] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_MODEL_JUNE24]';
const DK_BOOK_ID = 68;
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v4.2-corrected-june24';
const N_SIMULATIONS = 1_000_000;

// ─── Utility: American odds → no-vig probability ─────────────────────────────
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
  if (!p || p <= 0 || p >= 1) return null;
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
// ─── Utility: Full Poisson simulation ────────────────────────────────────────
function runPoisson(lambdaH, lambdaA, maxGoals = 8) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0, over25 = 0, under25 = 0, over35 = 0, over15 = 0, over05 = 0, under35 = 0;
  let totalGoals = 0, totalSims = 0;
  const scorelines = {};
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) * dixonColesRho(h, a, lambdaH, lambdaA);
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
  // Normalize
  homeWin /= totalSims; draw /= totalSims; awayWin /= totalSims;
  btts /= totalSims; over25 /= totalSims; under25 /= totalSims;
  over35 /= totalSims; over15 /= totalSims; over05 /= totalSims; under35 /= totalSims;
  const avgGoals = totalGoals / totalSims;
  // Top scorelines
  const top = Object.entries(scorelines)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s, p]) => `${s}:${(p / totalSims * 100).toFixed(1)}%`);
  const topJson = JSON.stringify(top);
  return { homeWin, draw, awayWin, btts, over25, under25, over35, over15, over05, under35, avgGoals, top: topJson };
}
// ─── Utility: Compute lambda from book odds + team ratings ───────────────────
function computeLambda(nv, isHome, elo, rank, form, drawFloor = 0.097) {
  // Base expected goals from no-vig win probability
  // Higher win prob → higher lambda
  const winProb = isHome ? nv.h : nv.a;
  const baseLambda = 0.5 + winProb * 2.2;
  // Elo adjustment: normalize to 1700 baseline
  const eloAdj = (elo - 1700) / 1000 * 0.3;
  // Rank adjustment: top-10 teams get slight boost
  const rankAdj = rank <= 10 ? 0.1 : rank <= 30 ? 0.05 : 0;
  // Form adjustment
  const formAdj = (form - 0.6) * 0.2;
  return Math.max(0.3, baseLambda + eloAdj + rankAdj + formAdj);
}

// ─── June 24 Matchs ────────────────────────────────────────────────────────
// DB orientation: home_team_id / away_team_id
// All odds mapped to DB home/away
const MATCHS = [
  {
    matchId: 'wc26-g-049',
    homeId: 'can', awayId: 'sui',
    homeName: 'Canada', awayName: 'Switzerland',
    // DK 1X2
    dkHomeML: 240, dkDrawML: 210, dkAwayML: 135,
    // DK TOTAL
    dkTotalLine: 2.5, dkOverOdds: 100, dkUnderOdds: -125,
    // DK ASIAN_HANDICAP (home line, away line)
    dkHomeSpread: 1.5, dkHomeSpreadOdds: -575,
    dkAwaySpread: -1.5, dkAwaySpreadOdds: 400,
    // DK DOUBLE_CHANCE (home_draw=1X, away_draw=X2)
    dkHomeDraw: -170, dkAwayDraw: -310,
    // DK BTTS
    dkBttsYes: -140, dkBttsNo: 110,
    // DK NO_DRAW (1X2 without draw)
    dkNoDraw: -270,
    // Team ratings
    homeElo: 1760, homeRank: 38, homeForm: 0.58,
    awayElo: 1800, awayRank: 15, awayForm: 0.68,
  },
  {
    matchId: 'wc26-g-052',
    homeId: 'bih', awayId: 'qat',
    homeName: 'Bosnia', awayName: 'Qatar',
    dkHomeML: -240, dkDrawML: 400, dkAwayML: 600,
    dkTotalLine: 2.5, dkOverOdds: -175, dkUnderOdds: 140,
    dkHomeSpread: -1.5, dkHomeSpreadOdds: 110,
    dkAwaySpread: 1.5, dkAwaySpreadOdds: -140,
    dkHomeDraw: -1000, dkAwayDraw: 185,
    dkBttsYes: -135, dkBttsNo: 105,
    dkNoDraw: -575,
    homeElo: 1720, homeRank: 55, homeForm: 0.60,
    awayElo: 1620, awayRank: 68, awayForm: 0.42,
  },
  {
    matchId: 'wc26-g-053',
    homeId: 'hai', awayId: 'mar',
    homeName: 'Haiti', awayName: 'Morocco',
    dkHomeML: 1400, dkDrawML: 600, dkAwayML: -500,
    dkTotalLine: 3.5, dkOverOdds: 145, dkUnderOdds: -175,
    dkHomeSpread: 1.5, dkHomeSpreadOdds: 135,
    dkAwaySpread: -1.5, dkAwaySpreadOdds: -170,
    dkHomeDraw: 340, dkAwayDraw: -3500,
    dkBttsYes: 130, dkBttsNo: -165,
    dkNoDraw: -1000,
    homeElo: 1580, homeRank: 95, homeForm: 0.38,
    awayElo: 1870, awayRank: 14, awayForm: 0.72,
  },
  {
    matchId: 'wc26-g-054',
    homeId: 'sco', awayId: 'bra',
    homeName: 'Scotland', awayName: 'Brazil',
    dkHomeML: 700, dkDrawML: 425, dkAwayML: -265,
    dkTotalLine: 2.5, dkOverOdds: -115, dkUnderOdds: -105,
    dkHomeSpread: 1.5, dkHomeSpreadOdds: -130,
    dkAwaySpread: -1.5, dkAwaySpreadOdds: 100,
    dkHomeDraw: 200, dkAwayDraw: -1100,
    dkBttsYes: 130, dkBttsNo: -165,
    dkNoDraw: -600,
    homeElo: 1720, homeRank: 40, homeForm: 0.58,
    awayElo: 2010, awayRank: 5, awayForm: 0.80,
  },
  {
    matchId: 'wc26-g-050',
    homeId: 'rsa', awayId: 'kor',
    homeName: 'South Africa', awayName: 'South Korea',
    dkHomeML: 425, dkDrawML: 295, dkAwayML: -150,
    dkTotalLine: 2.5, dkOverOdds: 105, dkUnderOdds: -130,
    dkHomeSpread: 1.5, dkHomeSpreadOdds: -250,
    dkAwaySpread: -1.5, dkAwaySpreadOdds: 195,
    dkHomeDraw: 115, dkAwayDraw: -600,
    dkBttsYes: -105, dkBttsNo: -125,
    dkNoDraw: -390,
    homeElo: 1660, homeRank: 62, homeForm: 0.50,
    awayElo: 1790, awayRank: 22, awayForm: 0.65,
  },
  {
    matchId: 'wc26-g-051',
    homeId: 'cze', awayId: 'mex',
    homeName: 'Czech Republic', awayName: 'Mexico',
    dkHomeML: 265, dkDrawML: 285, dkAwayML: -105,
    dkTotalLine: 2.5, dkOverOdds: 105, dkUnderOdds: -130,
    dkHomeSpread: 1.5, dkHomeSpreadOdds: -350,
    dkAwaySpread: -1.5, dkAwaySpreadOdds: 260,
    dkHomeDraw: -120, dkAwayDraw: -350,
    dkBttsYes: -110, dkBttsNo: -115,
    dkNoDraw: -370,
    homeElo: 1760, homeRank: 35, homeForm: 0.62,
    awayElo: 1800, awayRank: 16, awayForm: 0.68,
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${TAG} [INPUT] Starting June 24 seed — ${MATCHS.length} matchs`);
  console.log(`${TAG} [INPUT] DK book_id=${DK_BOOK_ID} | Model book_id=${MODEL_BOOK_ID} | version=${MODEL_VERSION}`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  let totalDkRows = 0;
  let totalModelRows = 0;
  let totalProjRows = 0;
  const errors = [];

  for (const f of MATCHS) {
    console.log(`\n${TAG} [STEP] Processing match=${f.matchId} | ${f.homeName}(home) vs ${f.awayName}(away)`);

    // ── Step 1: Clear existing odds for this match ──────────────────────────
    const [delDk] = await conn.query(
      `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ?`,
      [f.matchId, DK_BOOK_ID]
    );
    const [delModel] = await conn.query(
      `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ?`,
      [f.matchId, MODEL_BOOK_ID]
    );
    console.log(`${TAG} [STATE] Cleared DK rows=${delDk.affectedRows} Model rows=${delModel.affectedRows}`);

    // ── Step 2: Compute no-vig probabilities from DK 1X2 ─────────────────────
    const nv = noVigProbs(f.dkHomeML, f.dkDrawML, f.dkAwayML);
    console.log(`${TAG} [STATE] NV probs: home=${nv.h.toFixed(4)} draw=${nv.d.toFixed(4)} away=${nv.a.toFixed(4)}`);

    // ── Step 3: Compute lambdas (expected goals) ──────────────────────────────
    const rawLambdaH = computeLambda(nv, true, f.homeElo, f.homeRank, f.homeForm);
    const rawLambdaA = computeLambda(nv, false, f.awayElo, f.awayRank, f.awayForm);
    // Scale to match book total line
    const rawTotal = rawLambdaH + rawLambdaA;
    const scale = f.dkTotalLine / rawTotal;
    const lambdaH = rawLambdaH * scale;
    const lambdaA = rawLambdaA * scale;
    console.log(`${TAG} [STATE] lambdaH=${lambdaH.toFixed(4)} lambdaA=${lambdaA.toFixed(4)} (scaled from raw ${rawLambdaH.toFixed(4)}/${rawLambdaA.toFixed(4)})`);

    // ── Step 4: Run Poisson simulation ────────────────────────────────────────
    const sim = runPoisson(lambdaH, lambdaA);
    console.log(`${TAG} [STATE] Sim: homeWin=${sim.homeWin.toFixed(4)} draw=${sim.draw.toFixed(4)} awayWin=${sim.awayWin.toFixed(4)}`);
    console.log(`${TAG} [STATE] Sim: btts=${sim.btts.toFixed(4)} over25=${sim.over25.toFixed(4)} under25=${sim.under25.toFixed(4)}`);
    console.log(`${TAG} [STATE] Sim: avgGoals=${sim.avgGoals.toFixed(4)} top=${sim.top}`);

    // ── Step 5: Apply draw floor recalibration ────────────────────────────────
    const drawFloor = 0.097;
    let adjDraw = Math.max(sim.draw, drawFloor);
    const excess = adjDraw - sim.draw;
    const adjHomeWin = sim.homeWin - excess * (sim.homeWin / (sim.homeWin + sim.awayWin));
    const adjAwayWin = sim.awayWin - excess * (sim.awayWin / (sim.homeWin + sim.awayWin));
    const totalAdj = adjHomeWin + adjDraw + adjAwayWin;
    const finalHome = adjHomeWin / totalAdj;
    const finalDraw = adjDraw / totalAdj;
    const finalAway = adjAwayWin / totalAdj;
    console.log(`${TAG} [STATE] After draw_floor: home=${finalHome.toFixed(4)} draw=${finalDraw.toFixed(4)} away=${finalAway.toFixed(4)}`);

    // ── Step 6: Compute model American odds ───────────────────────────────────
    const modelHomeML = probToAmerican(finalHome);
    const modelDrawML = probToAmerican(finalDraw);
    const modelAwayML = probToAmerican(finalAway);
    const modelOverOdds = probToAmerican(sim.over25);
    const modelUnderOdds = probToAmerican(sim.under25);
    const modelBttsYes = probToAmerican(sim.btts);
    const modelBttsNo = probToAmerican(1 - sim.btts);
    // Model spread: derived from lambda difference
    const rawSpread = lambdaH - lambdaA;
    const modelSpreadRaw = rawSpread;
    const modelSpread = Math.round(rawSpread * 2) / 2; // round to nearest 0.5
    // Spread odds: home covers at modelSpread, away covers at -modelSpread
    const homeCoversProb = sim.homeWin * 0.85 + sim.draw * 0.10; // simplified
    const awayCoversProb = sim.awayWin * 0.85 + sim.draw * 0.10;
    const modelHomeSpreadOdds = probToAmerican(homeCoversProb);
    const modelAwaySpreadOdds = probToAmerican(awayCoversProb);
    // Double chance model odds
    const modelHomeDraw = probToAmerican(finalHome + finalDraw);
    const modelAwayDraw = probToAmerican(finalAway + finalDraw);
    // No-draw model odds
    const modelNoDraw = probToAmerican(finalHome + finalAway);
    console.log(`${TAG} [STATE] Model ML: home=${modelHomeML} draw=${modelDrawML} away=${modelAwayML}`);
    console.log(`${TAG} [STATE] Model TOTAL: over=${modelOverOdds} under=${modelUnderOdds} | BTTS: yes=${modelBttsYes} no=${modelBttsNo}`);
    console.log(`${TAG} [STATE] Model SPREAD: spread=${modelSpread}(raw=${modelSpreadRaw.toFixed(4)}) homeOdds=${modelHomeSpreadOdds} awayOdds=${modelAwaySpreadOdds}`);

    // ── Step 7: Projected scores ───────────────────────────────────────────────
    const projHomeScore = parseFloat(lambdaH.toFixed(2));
    const projAwayScore = parseFloat(lambdaA.toFixed(2));
    const projTotal = parseFloat((lambdaH + lambdaA).toFixed(2));
    const projSpread = parseFloat((lambdaH - lambdaA).toFixed(2));
    console.log(`${TAG} [STATE] Projected: home=${projHomeScore} away=${projAwayScore} total=${projTotal} spread=${projSpread}`);

    // ── Step 8: Compute implied probs for DB ──────────────────────────────────
    const impliedProb = (ml) => {
      if (!ml || isNaN(ml)) return 0;
      return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
    };

    // ── Step 9: Build DK odds rows ────────────────────────────────────────────
    const dkRows = [
      // 1X2
      { market: '1X2', selection: 'home', line: null, odds: f.dkHomeML },
      { market: '1X2', selection: 'draw', line: null, odds: f.dkDrawML },
      { market: '1X2', selection: 'away', line: null, odds: f.dkAwayML },
      // TOTAL
      { market: 'TOTAL', selection: 'over', line: f.dkTotalLine, odds: f.dkOverOdds },
      { market: 'TOTAL', selection: 'under', line: f.dkTotalLine, odds: f.dkUnderOdds },
      // ASIAN_HANDICAP (spread)
      { market: 'ASIAN_HANDICAP', selection: 'home', line: f.dkHomeSpread, odds: f.dkHomeSpreadOdds },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: f.dkAwaySpread, odds: f.dkAwaySpreadOdds },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: f.dkHomeDraw },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: f.dkAwayDraw },
      // BTTS
      { market: 'BTTS', selection: 'yes', line: null, odds: f.dkBttsYes },
      { market: 'BTTS', selection: 'no', line: null, odds: f.dkBttsNo },
      // NO_DRAW (stored as 1X2 market, selection=no_draw)
      { market: '1X2', selection: 'no_draw', line: null, odds: f.dkNoDraw },
    ];

    // ── Step 10: Build Model odds rows ────────────────────────────────────────
    const modelRows = [
      // 1X2
      { market: '1X2', selection: 'home', line: null, odds: modelHomeML, prob: finalHome },
      { market: '1X2', selection: 'draw', line: null, odds: modelDrawML, prob: finalDraw },
      { market: '1X2', selection: 'away', line: null, odds: modelAwayML, prob: finalAway },
      // TOTAL
      { market: 'TOTAL', selection: 'over', line: f.dkTotalLine, odds: modelOverOdds, prob: sim.over25 },
      { market: 'TOTAL', selection: 'under', line: f.dkTotalLine, odds: modelUnderOdds, prob: sim.under25 },
      // ASIAN_HANDICAP
      { market: 'ASIAN_HANDICAP', selection: 'home', line: modelSpread, odds: modelHomeSpreadOdds, prob: homeCoversProb },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: -modelSpread, odds: modelAwaySpreadOdds, prob: awayCoversProb },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: modelHomeDraw, prob: finalHome + finalDraw },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: modelAwayDraw, prob: finalAway + finalDraw },
      // BTTS
      { market: 'BTTS', selection: 'yes', line: null, odds: modelBttsYes, prob: sim.btts },
      { market: 'BTTS', selection: 'no', line: null, odds: modelBttsNo, prob: 1 - sim.btts },
      // NO_DRAW
      { market: '1X2', selection: 'no_draw', line: null, odds: modelNoDraw, prob: finalHome + finalAway },
    ];

    // ── Step 11: Insert DK odds ───────────────────────────────────────────────
    for (const row of dkRows) {
      if (row.odds == null) continue;
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [f.matchId, snapshotTs, DK_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, impliedProb(row.odds)]
      );
      totalDkRows++;
    }
    console.log(`${TAG} [OUTPUT] Inserted ${dkRows.length} DK rows for ${f.matchId}`);

    // ── Step 12: Insert Model odds ────────────────────────────────────────────
    for (const row of modelRows) {
      if (row.odds == null) continue;
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [f.matchId, snapshotTs, MODEL_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, row.prob ?? impliedProb(row.odds)]
      );
      totalModelRows++;
    }
    console.log(`${TAG} [OUTPUT] Inserted ${modelRows.length} Model rows for ${f.matchId}`);

    // ── Step 13: Upsert model projections ─────────────────────────────────────
    await conn.query(`
      INSERT INTO wc2026_model_projections (
        match_id, model_version, n_simulations,
        home_team, away_team,
        home_lambda, away_lambda,
        home_win_prob, draw_prob, away_win_prob,
        proj_home_score, proj_away_score, proj_total, proj_spread,
        over_0_5, over_1_5, over_2_5, under_2_5, over_3_5,
        btts_prob,
        model_home_ml, model_draw_ml, model_away_ml,
        model_total, over_odds, under_odds,
        model_spread, model_spread_raw, home_spread_odds, away_spread_odds,
        nv_home_prob, nv_draw_prob, nv_away_prob,
        home_edge, draw_edge, away_edge,
        model_lean, lean_prob,
        top_scorelines,
        modeled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
        proj_spread = VALUES(proj_spread),
        over_2_5 = VALUES(over_2_5),
        under_2_5 = VALUES(under_2_5),
        btts_prob = VALUES(btts_prob),
        model_home_ml = VALUES(model_home_ml),
        model_draw_ml = VALUES(model_draw_ml),
        model_away_ml = VALUES(model_away_ml),
        model_total = VALUES(model_total),
        over_odds = VALUES(over_odds),
        under_odds = VALUES(under_odds),
        model_spread = VALUES(model_spread),
        model_spread_raw = VALUES(model_spread_raw),
        home_spread_odds = VALUES(home_spread_odds),
        away_spread_odds = VALUES(away_spread_odds),
        nv_home_prob = VALUES(nv_home_prob),
        nv_draw_prob = VALUES(nv_draw_prob),
        nv_away_prob = VALUES(nv_away_prob),
        home_edge = VALUES(home_edge),
        draw_edge = VALUES(draw_edge),
        away_edge = VALUES(away_edge),
        model_lean = VALUES(model_lean),
        lean_prob = VALUES(lean_prob),
        top_scorelines = VALUES(top_scorelines),
        modeled_at = NOW()
    `, [
      f.matchId, MODEL_VERSION, N_SIMULATIONS,
      f.homeName, f.awayName,
      lambdaH, lambdaA,
      finalHome, finalDraw, finalAway,
      projHomeScore, projAwayScore, projTotal, projSpread,
      sim.over05, sim.over15, sim.over25, sim.under25, sim.over35,
      sim.btts,
      modelHomeML, modelDrawML, modelAwayML,
      f.dkTotalLine, modelOverOdds, modelUnderOdds,
      modelSpread, modelSpreadRaw, modelHomeSpreadOdds, modelAwaySpreadOdds,
      nv.h, nv.d, nv.a,
      // edges: model prob - book implied prob (in pp)
      (finalHome - impliedProb(f.dkHomeML)) * 100,
      (finalDraw - impliedProb(f.dkDrawML)) * 100,
      (finalAway - impliedProb(f.dkAwayML)) * 100,
      // model lean
      finalHome > finalAway ? 'home' : 'away',
      Math.max(finalHome, finalAway),
      sim.top,
    ]);
    totalProjRows++;
    console.log(`${TAG} [OUTPUT] Upserted model projection for ${f.matchId}: proj=${projHomeScore}-${projAwayScore} spread=${projSpread} btts=${sim.btts.toFixed(4)}`);
  }

  // ── Final verification ────────────────────────────────────────────────────
  const [verifyDk] = await conn.query(
    `SELECT match_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE match_id IN ('wc26-g-049','wc26-g-050','wc26-g-051','wc26-g-052','wc26-g-053','wc26-g-054') AND book_id = ${DK_BOOK_ID} GROUP BY match_id`
  );
  const [verifyModel] = await conn.query(
    `SELECT match_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE match_id IN ('wc26-g-049','wc26-g-050','wc26-g-051','wc26-g-052','wc26-g-053','wc26-g-054') AND book_id = ${MODEL_BOOK_ID} GROUP BY match_id`
  );
  const [verifyProj] = await conn.query(
    `SELECT match_id, proj_home_score, proj_away_score, proj_total FROM wc2026_model_projections WHERE match_id IN ('wc26-g-049','wc26-g-050','wc26-g-051','wc26-g-052','wc26-g-053','wc26-g-054')`
  );

  console.log(`\n${TAG} [VERIFY] DK odds per match:`);
  for (const r of verifyDk) console.log(`  ${r.match_id}: ${r.cnt} rows`);
  console.log(`${TAG} [VERIFY] Model odds per match:`);
  for (const r of verifyModel) console.log(`  ${r.match_id}: ${r.cnt} rows`);
  console.log(`${TAG} [VERIFY] Model projections:`);
  for (const r of verifyProj) console.log(`  ${r.match_id}: proj=${r.proj_home_score}-${r.proj_away_score} total=${r.proj_total}`);

  const pass = verifyDk.length === 6 && verifyModel.length === 6 && verifyProj.length === 6;
  console.log(`\n${TAG} [VERIFY] ${pass ? '✅ PASS' : '❌ FAIL'} — DK=${verifyDk.length}/6 Model=${verifyModel.length}/6 Proj=${verifyProj.length}/6`);
  console.log(`${TAG} [OUTPUT] Total DK rows=${totalDkRows} Model rows=${totalModelRows} Proj rows=${totalProjRows} Errors=${errors.length}`);

  await conn.end();
  process.exit(pass ? 0 : 1);
}

main().catch(e => {
  console.error(`${TAG} [VERIFY] FAIL — unhandled error: ${e.message}`);
  process.exit(1);
});
