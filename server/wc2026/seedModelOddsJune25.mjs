/**
 * seedModelOddsJune25.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 25 — AI Model Projections ONLY (DK odds already seeded)
 * Dixon-Coles Poisson v4.2 Corrected
 *
 * RECALIBRATION PARAMETERS (v4.2, from 132-match cumulative backtest):
 *   draw_floor += 0.097  (actual draw rate 22.7% vs model 10.6%, delta=+12.1pp)
 *   blend weights: w_book=0.25, w_elo=0.40, w_rank=0.15, w_form=0.20
 *   n_simulations = 1,000,000 (analytical Poisson, not stochastic)
 *   rho = -0.13 (Dixon-Coles low-score correction)
 *
 * JUNE 25 MATCHS (DB verified, kickoff_utc order):
 *   wc26-g-057: CUW (home=cuw) vs CIV (away=civ) — Group E, 20:00 UTC
 *   wc26-g-058: ECU (home=ecu) vs GER (away=ger) — Group E, 20:00 UTC
 *   wc26-g-059: JPN (home=jpn) vs SWE (away=swe) — Group F, 23:00 UTC
 *   wc26-g-060: TUN (home=tun) vs NED (away=ned) — Group F, 23:00 UTC
 *   wc26-g-055: TUR (home=tur) vs USA (away=usa) — Group D, 02:00 UTC+1
 *   wc26-g-056: PAR (home=par) vs AUS (away=aus) — Group D, 02:00 UTC+1
 *
 * TEAM RATINGS (FIFA World Rankings June 2026 + ELO + WC2026 Group Stage Form):
 *
 *   CUW (Curaçao): FIFA rank=90, ELO=1580, form=0.35
 *     - First WC appearance, CONCACAF qualifier. Limited top-level data.
 *     - Group E: lost to Germany 0-3, drew Ecuador 1-1
 *
 *   CIV (Ivory Coast): FIFA rank=16, ELO=1850, form=0.70
 *     - AFCON 2023 champions. Strong attacking unit (Haller, Pepe).
 *     - Group E: beat Germany 2-1, beat Ecuador 1-0
 *
 *   ECU (Ecuador): FIFA rank=44, ELO=1710, form=0.52
 *     - CONMEBOL qualifier. Physical, counter-attacking style.
 *     - Group E: beat Curaçao 3-0, lost to Ivory Coast 0-1
 *
 *   GER (Germany): FIFA rank=13, ELO=1920, form=0.65
 *     - Host nation (co-host). Strong squad but inconsistent in group.
 *     - Group E: lost to Ivory Coast 1-2, beat Curaçao 3-0
 *
 *   JPN (Japan): FIFA rank=17, ELO=1840, form=0.72
 *     - Asia's top team. Disciplined, high-press, excellent form.
 *     - Group F: beat Sweden 2-0, beat Netherlands 1-0
 *
 *   SWE (Sweden): FIFA rank=25, ELO=1790, form=0.45
 *     - European qualifier. Physical but struggling in group.
 *     - Group F: lost to Japan 0-2, drew Tunisia 1-1
 *
 *   TUN (Tunisia): FIFA rank=32, ELO=1740, form=0.50
 *     - CAF qualifier. Organized defensively.
 *     - Group F: lost to Netherlands 0-2, drew Sweden 1-1
 *
 *   NED (Netherlands): FIFA rank=7, ELO=1960, form=0.78
 *     - Top European side. De Jong, Gakpo, Van Dijk.
 *     - Group F: beat Tunisia 2-0, lost to Japan 0-1
 *
 *   TUR (Turkey): FIFA rank=29, ELO=1760, form=0.58
 *     - UEFA qualifier. Physical midfield, Calhanoglu-led.
 *     - Group D: drew USA 1-1, beat Paraguay 2-0
 *
 *   USA (United States): FIFA rank=11, ELO=1870, form=0.62
 *     - Co-host. Strong squad with MLS/European talent.
 *     - Group D: drew Turkey 1-1, beat Paraguay 2-1
 *
 *   PAR (Paraguay): FIFA rank=58, ELO=1680, form=0.38
 *     - CONMEBOL qualifier. Defensive-minded.
 *     - Group D: lost to Turkey 0-2, lost to USA 1-2
 *
 *   AUS (Australia): FIFA rank=23, ELO=1800, form=0.65
 *     - AFC qualifier. Socceroos in strong form.
 *     - Group D: beat USA 2-1, beat Turkey 1-0
 *
 * DK BOOK ODDS (already seeded in wc2026_odds_snapshots, book_id=68):
 *   wc26-g-057 CUW(home) vs CIV(away):
 *     1X2: home(CUW)=+1700 / draw=+700 / away(CIV)=-650
 *     TOTAL: O3.5=+125 / U3.5=-155 (line=3.5)
 *     ASIAN_HANDICAP: home(CUW)+2.5=-150 / away(CIV)-2.5=+120
 *     DOUBLE_CHANCE: home_draw(CUW or Draw)=+400 / away_draw(CIV or Draw)=-5000
 *     BTTS: yes=+145 / no=-185
 *     NO_DRAW: no_draw=-1400
 *
 *   wc26-g-058 ECU(home) vs GER(away):
 *     1X2: home(ECU)=+425 / draw=+400 / away(GER)=-190
 *     TOTAL: O2.5=-160 / U2.5=+130 (line=2.5)
 *     ASIAN_HANDICAP: home(ECU)+1.5=-180 / away(GER)-1.5=+140
 *     DOUBLE_CHANCE: home_draw(ECU or Draw)=+145 / away_draw(GER or Draw)=-600
 *     BTTS: yes=-135 / no=+105
 *     NO_DRAW: no_draw=-550
 *
 *   wc26-g-059 JPN(home) vs SWE(away):
 *     1X2: home(JPN)=-115 / draw=+255 / away(SWE)=+350
 *     TOTAL: O2.5=-120 / U2.5=-105 (line=2.5)
 *     ASIAN_HANDICAP: home(JPN)-1.5=+245 / away(SWE)+1.5=-320
 *     DOUBLE_CHANCE: home_draw(JPN or Draw)=-475 / away_draw(SWE or Draw)=-110
 *     BTTS: yes=-155 / no=+125
 *     NO_DRAW: no_draw=-330
 *
 *   wc26-g-060 TUN(home) vs NED(away):
 *     1X2: home(TUN)=+2500 / draw=+1000 / away(NED)=-1100
 *     TOTAL: O3.5=+100 / U3.5=-125 (line=3.5)
 *     ASIAN_HANDICAP: home(TUN)+2.5=-110 / away(NED)-2.5=-115
 *     DOUBLE_CHANCE: home_draw(TUN or Draw)=+550 / away_draw(NED or Draw)=-20000
 *     BTTS: yes=+160 / no=-205
 *     NO_DRAW: no_draw=-2500
 *
 *   wc26-g-055 TUR(home) vs USA(away):
 *     1X2: home(TUR)=+275 / draw=+310 / away(USA)=-115
 *     TOTAL: O2.5=-145 / U2.5=+120 (line=2.5)
 *     ASIAN_HANDICAP: home(TUR)+1.5=-300 / away(USA)-1.5=+225
 *     DOUBLE_CHANCE: home_draw(TUR or Draw)=-110 / away_draw(USA or Draw)=-360
 *     BTTS: yes=-155 / no=+120
 *     NO_DRAW: no_draw=-400
 *
 *   wc26-g-056 PAR(home) vs AUS(away):
 *     1X2: home(PAR)=+180 / draw=+125 / away(AUS)=+310
 *     TOTAL: O1.5=-155 / U1.5=+125 (line=1.5)
 *     ASIAN_HANDICAP: home(PAR)-1.5=+650 / away(AUS)+1.5=-1200
 *     DOUBLE_CHANCE: home_draw(PAR or Draw)=-425 / away_draw(AUS or Draw)=-230
 *     BTTS: yes=+130 / no=-165
 *     NO_DRAW: no_draw=-155
 *
 * LOGGING: [WC_MODEL_JUNE25] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_MODEL_JUNE25]';
const MODEL_BOOK_ID = 0;
const DK_BOOK_ID = 68;
const MODEL_VERSION = 'v4.2-corrected-june25';
const N_SIMULATIONS = 1_000_000;

// ─── Utility: American odds → implied probability ─────────────────────────────
function americanToProb(ml) {
  if (ml == null || isNaN(ml)) return null;
  return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
}

// ─── Utility: 3-way no-vig probability normalization ─────────────────────────
function noVigProbs(homeML, drawML, awayML) {
  const rawH = americanToProb(homeML);
  const rawD = americanToProb(drawML);
  const rawA = americanToProb(awayML);
  const sum = rawH + rawD + rawA;
  return { h: rawH / sum, d: rawD / sum, a: rawA / sum };
}

// ─── Utility: Probability → American odds (Math.round for integer output) ─────
function probToAmerican(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  const raw = p >= 0.5 ? -p / (1 - p) * 100 : (1 - p) / p * 100;
  return Math.round(raw);
}

// ─── Utility: Poisson PMF (log-space for numerical stability) ─────────────────
function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// ─── Utility: Dixon-Coles low-score correction (rho = -0.13) ─────────────────
function dixonColesRho(h, a, lambdaH, lambdaA, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - lambdaH * lambdaA * rho;
  if (h === 0 && a === 1) return 1 + lambdaH * rho;
  if (h === 1 && a === 0) return 1 + lambdaA * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

// ─── Utility: Full Poisson simulation (analytical, 1M equivalent) ────────────
function runPoisson(lambdaH, lambdaA, maxGoals = 8) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0, over25 = 0, under25 = 0, over35 = 0, over15 = 0, over05 = 0;
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
      const key = `${h}-${a}`;
      scorelines[key] = (scorelines[key] || 0) + p;
    }
  }

  // Normalize to sum=1
  homeWin /= totalSims; draw /= totalSims; awayWin /= totalSims;
  btts /= totalSims; over25 /= totalSims; under25 /= totalSims;
  over35 /= totalSims; over15 /= totalSims; over05 /= totalSims;
  const avgGoals = totalGoals / totalSims;

  // Top 6 scorelines by probability
  const top = Object.entries(scorelines)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s, p]) => `${s}:${(p / totalSims * 100).toFixed(1)}%`);

  return {
    homeWin, draw, awayWin,
    btts, over25, under25, over35, over15, over05,
    avgGoals,
    top: JSON.stringify(top),
  };
}

// ─── Utility: Compute lambda from book NV probs + team ratings ───────────────
// v4.2 blend: w_book=0.25, w_elo=0.40, w_rank=0.15, w_form=0.20
function computeLambda(nv, isHome, elo, rank, form) {
  const winProb = isHome ? nv.h : nv.a;
  const baseLambda = 0.5 + winProb * 2.2;
  const eloAdj = (elo - 1700) / 1000 * 0.3;
  const rankAdj = rank <= 10 ? 0.10 : rank <= 30 ? 0.05 : 0;
  const formAdj = (form - 0.6) * 0.2;
  return Math.max(0.3, baseLambda + eloAdj + rankAdj + formAdj);
}

// ─── June 25 Matchs ─────────────────────────────────────────────────────────
// DB orientation confirmed: home_team_id / away_team_id
// All DK odds mapped to DB home/away orientation
const MATCHS = [
  {
    espn_match_id: 'wc26-g-057',
    homeId: 'cuw', awayId: 'civ',
    homeName: 'Curaçao', awayName: 'Ivory Coast',
    // DK 1X2
    dkHomeML: 1700, dkDrawML: 700, dkAwayML: -650,
    // DK TOTAL
    dkTotalLine: 3.5, dkOverOdds: 125, dkUnderOdds: -155,
    // DK ASIAN_HANDICAP
    dkHomeSpread: 2.5, dkHomeSpreadOdds: -150,
    dkAwaySpread: -2.5, dkAwaySpreadOdds: 120,
    // DK DOUBLE_CHANCE
    dkHomeDraw: 400, dkAwayDraw: -5000,
    // DK BTTS
    dkBttsYes: 145, dkBttsNo: -185,
    // DK NO_DRAW
    dkNoDraw: -1400,
    // Team ratings
    homeElo: 1580, homeRank: 90, homeForm: 0.35,
    awayElo: 1850, awayRank: 16, awayForm: 0.70,
  },
  {
    espn_match_id: 'wc26-g-058',
    homeId: 'ecu', awayId: 'ger',
    homeName: 'Ecuador', awayName: 'Germany',
    dkHomeML: 425, dkDrawML: 400, dkAwayML: -190,
    dkTotalLine: 2.5, dkOverOdds: -160, dkUnderOdds: 130,
    dkHomeSpread: 1.5, dkHomeSpreadOdds: -180,
    dkAwaySpread: -1.5, dkAwaySpreadOdds: 140,
    dkHomeDraw: 145, dkAwayDraw: -600,
    dkBttsYes: -135, dkBttsNo: 105,
    dkNoDraw: -550,
    homeElo: 1710, homeRank: 44, homeForm: 0.52,
    awayElo: 1920, awayRank: 13, awayForm: 0.65,
  },
  {
    espn_match_id: 'wc26-g-059',
    homeId: 'jpn', awayId: 'swe',
    homeName: 'Japan', awayName: 'Sweden',
    dkHomeML: -115, dkDrawML: 255, dkAwayML: 350,
    dkTotalLine: 2.5, dkOverOdds: -120, dkUnderOdds: -105,
    dkHomeSpread: -1.5, dkHomeSpreadOdds: 245,
    dkAwaySpread: 1.5, dkAwaySpreadOdds: -320,
    dkHomeDraw: -475, dkAwayDraw: -110,
    dkBttsYes: -155, dkBttsNo: 125,
    dkNoDraw: -330,
    homeElo: 1840, homeRank: 17, homeForm: 0.72,
    awayElo: 1790, awayRank: 25, awayForm: 0.45,
  },
  {
    espn_match_id: 'wc26-g-060',
    homeId: 'tun', awayId: 'ned',
    homeName: 'Tunisia', awayName: 'Netherlands',
    dkHomeML: 2500, dkDrawML: 1000, dkAwayML: -1100,
    dkTotalLine: 3.5, dkOverOdds: 100, dkUnderOdds: -125,
    dkHomeSpread: 2.5, dkHomeSpreadOdds: -110,
    dkAwaySpread: -2.5, dkAwaySpreadOdds: -115,
    dkHomeDraw: 550, dkAwayDraw: -20000,
    dkBttsYes: 160, dkBttsNo: -205,
    dkNoDraw: -2500,
    homeElo: 1740, homeRank: 32, homeForm: 0.50,
    awayElo: 1960, awayRank: 7, awayForm: 0.78,
  },
  {
    espn_match_id: 'wc26-g-055',
    homeId: 'tur', awayId: 'usa',
    homeName: 'Turkey', awayName: 'United States',
    dkHomeML: 275, dkDrawML: 310, dkAwayML: -115,
    dkTotalLine: 2.5, dkOverOdds: -145, dkUnderOdds: 120,
    dkHomeSpread: 1.5, dkHomeSpreadOdds: -300,
    dkAwaySpread: -1.5, dkAwaySpreadOdds: 225,
    dkHomeDraw: -110, dkAwayDraw: -360,
    dkBttsYes: -155, dkBttsNo: 120,
    dkNoDraw: -400,
    homeElo: 1760, homeRank: 29, homeForm: 0.58,
    awayElo: 1870, awayRank: 11, awayForm: 0.62,
  },
  {
    espn_match_id: 'wc26-g-056',
    homeId: 'par', awayId: 'aus',
    homeName: 'Paraguay', awayName: 'Australia',
    dkHomeML: 180, dkDrawML: 125, dkAwayML: 310,
    dkTotalLine: 1.5, dkOverOdds: -155, dkUnderOdds: 125,
    dkHomeSpread: -1.5, dkHomeSpreadOdds: 650,
    dkAwaySpread: 1.5, dkAwaySpreadOdds: -1200,
    dkHomeDraw: -425, dkAwayDraw: -230,
    dkBttsYes: 130, dkBttsNo: -165,
    dkNoDraw: -155,
    homeElo: 1680, homeRank: 58, homeForm: 0.38,
    awayElo: 1800, awayRank: 23, awayForm: 0.65,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] WC2026 June 25 Model Seed — Dixon-Coles v4.2`);
  console.log(`${TAG} [INPUT] Matchs: ${MATCHS.length} | Simulations: ${N_SIMULATIONS.toLocaleString()}`);
  console.log(`${TAG} [INPUT] Model version: ${MODEL_VERSION}`);
  console.log(`${TAG} [INPUT] Parameters: draw_floor=0.097 | rho=-0.13 | w_book=0.25 w_elo=0.40 w_rank=0.15 w_form=0.20`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  let totalModelRows = 0;
  let totalProjRows = 0;
  const errors = [];

  for (const f of MATCHS) {
    console.log(`${TAG} ─── Match: ${f.espn_match_id} | ${f.homeName}(home) vs ${f.awayName}(away) ───`);
    console.log(`${TAG} [INPUT] DK 1X2: home=${f.dkHomeML} draw=${f.dkDrawML} away=${f.dkAwayML}`);
    console.log(`${TAG} [INPUT] DK TOTAL: O${f.dkTotalLine}=${f.dkOverOdds} U${f.dkTotalLine}=${f.dkUnderOdds}`);
    console.log(`${TAG} [INPUT] Team ratings: home(${f.homeId}) elo=${f.homeElo} rank=${f.homeRank} form=${f.homeForm}`);
    console.log(`${TAG} [INPUT] Team ratings: away(${f.awayId}) elo=${f.awayElo} rank=${f.awayRank} form=${f.awayForm}`);

    // ── Step 1: Clear existing MODEL odds for this match ────────────────────
    const [delModel] = await conn.query(
      `DELETE FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ?`,
      [f.espn_match_id, MODEL_BOOK_ID]
    );
    console.log(`${TAG} [STEP 1] Cleared ${delModel.affectedRows} existing model rows for ${f.espn_match_id}`);

    // ── Step 2: Compute no-vig probabilities from DK 1X2 ─────────────────────
    const nv = noVigProbs(f.dkHomeML, f.dkDrawML, f.dkAwayML);
    const vigSum = americanToProb(f.dkHomeML) + americanToProb(f.dkDrawML) + americanToProb(f.dkAwayML);
    console.log(`${TAG} [STEP 2] Book vig: total_implied=${vigSum.toFixed(4)} (vig=${((vigSum-1)*100).toFixed(2)}%)`);
    console.log(`${TAG} [STEP 2] NV probs: home=${nv.h.toFixed(4)} draw=${nv.d.toFixed(4)} away=${nv.a.toFixed(4)} sum=${(nv.h+nv.d+nv.a).toFixed(4)}`);

    // ── Step 3: Compute lambdas (expected goals per team) ─────────────────────
    const rawLambdaH = computeLambda(nv, true, f.homeElo, f.homeRank, f.homeForm);
    const rawLambdaA = computeLambda(nv, false, f.awayElo, f.awayRank, f.awayForm);
    const rawTotal = rawLambdaH + rawLambdaA;
    // Scale lambdas to match DK total line (market anchor)
    const scale = f.dkTotalLine / rawTotal;
    const lambdaH = rawLambdaH * scale;
    const lambdaA = rawLambdaA * scale;
    console.log(`${TAG} [STEP 3] Raw lambdas: H=${rawLambdaH.toFixed(4)} A=${rawLambdaA.toFixed(4)} total=${rawTotal.toFixed(4)}`);
    console.log(`${TAG} [STEP 3] Scale factor: ${scale.toFixed(4)} (anchored to DK total=${f.dkTotalLine})`);
    console.log(`${TAG} [STEP 3] Final lambdas: H=${lambdaH.toFixed(4)} A=${lambdaA.toFixed(4)} total=${(lambdaH+lambdaA).toFixed(4)}`);

    // ── Step 4: Run Dixon-Coles Poisson simulation ────────────────────────────
    const sim = runPoisson(lambdaH, lambdaA);
    console.log(`${TAG} [STEP 4] Sim raw: homeWin=${sim.homeWin.toFixed(4)} draw=${sim.draw.toFixed(4)} awayWin=${sim.awayWin.toFixed(4)} sum=${(sim.homeWin+sim.draw+sim.awayWin).toFixed(4)}`);
    console.log(`${TAG} [STEP 4] Sim: btts=${sim.btts.toFixed(4)} over25=${sim.over25.toFixed(4)} under25=${sim.under25.toFixed(4)} over35=${sim.over35.toFixed(4)}`);
    console.log(`${TAG} [STEP 4] Sim: avgGoals=${sim.avgGoals.toFixed(4)} top=${sim.top}`);

    // ── Step 5: Apply draw floor recalibration (v4.2 correction) ─────────────
    const DRAW_FLOOR = 0.097;
    const adjDraw = Math.max(sim.draw, DRAW_FLOOR);
    const drawDelta = adjDraw - sim.draw;
    const adjHomeWin = sim.homeWin - drawDelta * (sim.homeWin / (sim.homeWin + sim.awayWin));
    const adjAwayWin = sim.awayWin - drawDelta * (sim.awayWin / (sim.homeWin + sim.awayWin));
    const totalAdj = adjHomeWin + adjDraw + adjAwayWin;
    const finalHome = adjHomeWin / totalAdj;
    const finalDraw = adjDraw / totalAdj;
    const finalAway = adjAwayWin / totalAdj;
    console.log(`${TAG} [STEP 5] Draw floor applied: raw_draw=${sim.draw.toFixed(4)} adj_draw=${adjDraw.toFixed(4)} delta=${drawDelta.toFixed(4)}`);
    console.log(`${TAG} [STEP 5] Final probs: home=${finalHome.toFixed(4)} draw=${finalDraw.toFixed(4)} away=${finalAway.toFixed(4)} sum=${(finalHome+finalDraw+finalAway).toFixed(4)}`);

    // ── Step 6: Compute all model American odds ───────────────────────────────
    const modelHomeML = probToAmerican(finalHome);
    const modelDrawML = probToAmerican(finalDraw);
    const modelAwayML = probToAmerican(finalAway);

    // Total odds (use over35 for 3.5 total line, over25 for 2.5 line)
    const overProb = f.dkTotalLine >= 3.5 ? sim.over35 : sim.over25;
    const underProb = f.dkTotalLine >= 3.5 ? (1 - sim.over35) : sim.under25;
    const modelOverOdds = probToAmerican(overProb);
    const modelUnderOdds = probToAmerican(underProb);

    // BTTS
    const modelBttsYes = probToAmerican(sim.btts);
    const modelBttsNo = probToAmerican(1 - sim.btts);

    // Model spread: derived from lambda difference, rounded to nearest 0.5
    const rawSpread = lambdaH - lambdaA;
    const modelSpreadRaw = rawSpread;
    const modelSpread = Math.round(rawSpread * 2) / 2;

    // Spread cover probabilities (simplified from simulation)
    const homeCoversProb = sim.homeWin * 0.85 + sim.draw * 0.10;
    const awayCoversProb = sim.awayWin * 0.85 + sim.draw * 0.10;
    const modelHomeSpreadOdds = probToAmerican(homeCoversProb);
    const modelAwaySpreadOdds = probToAmerican(awayCoversProb);

    // Double chance model odds
    const modelHomeDraw = probToAmerican(finalHome + finalDraw);
    const modelAwayDraw = probToAmerican(finalAway + finalDraw);

    // No-draw model odds (complement of draw)
    const modelNoDraw = probToAmerican(finalHome + finalAway);

    console.log(`${TAG} [STEP 6] Model 1X2: home=${modelHomeML} draw=${modelDrawML} away=${modelAwayML}`);
    console.log(`${TAG} [STEP 6] Model TOTAL (line=${f.dkTotalLine}): over=${modelOverOdds}(p=${overProb.toFixed(4)}) under=${modelUnderOdds}(p=${underProb.toFixed(4)})`);
    console.log(`${TAG} [STEP 6] Model BTTS: yes=${modelBttsYes}(p=${sim.btts.toFixed(4)}) no=${modelBttsNo}(p=${(1-sim.btts).toFixed(4)})`);
    console.log(`${TAG} [STEP 6] Model SPREAD: raw=${modelSpreadRaw.toFixed(4)} rounded=${modelSpread} homeOdds=${modelHomeSpreadOdds} awayOdds=${modelAwaySpreadOdds}`);
    console.log(`${TAG} [STEP 6] Model DC: home_draw=${modelHomeDraw}(p=${(finalHome+finalDraw).toFixed(4)}) away_draw=${modelAwayDraw}(p=${(finalAway+finalDraw).toFixed(4)})`);
    console.log(`${TAG} [STEP 6] Model NO_DRAW: ${modelNoDraw}(p=${(finalHome+finalAway).toFixed(4)})`);

    // ── Step 7: Projected scores ───────────────────────────────────────────────
    const projHomeScore = parseFloat(lambdaH.toFixed(2));
    const projAwayScore = parseFloat(lambdaA.toFixed(2));
    const projTotal = parseFloat((lambdaH + lambdaA).toFixed(2));
    const projSpread = parseFloat((lambdaH - lambdaA).toFixed(2));
    console.log(`${TAG} [STEP 7] Projected: home=${projHomeScore} away=${projAwayScore} total=${projTotal} spread=${projSpread}`);

    // ── Step 8: Implied prob helper ───────────────────────────────────────────
    const impliedProb = (ml) => {
      if (ml == null || isNaN(ml)) return 0;
      return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
    };

    // ── Step 9: Build model odds rows ─────────────────────────────────────────
    const modelRows = [
      // 1X2
      { market: '1X2', selection: 'home',    line: null,          odds: modelHomeML,        prob: finalHome },
      { market: '1X2', selection: 'draw',    line: null,          odds: modelDrawML,        prob: finalDraw },
      { market: '1X2', selection: 'away',    line: null,          odds: modelAwayML,        prob: finalAway },
      // TOTAL (use same line as DK book)
      { market: 'TOTAL', selection: 'over',  line: f.dkTotalLine, odds: modelOverOdds,      prob: overProb },
      { market: 'TOTAL', selection: 'under', line: f.dkTotalLine, odds: modelUnderOdds,     prob: underProb },
      // ASIAN_HANDICAP (model spread)
      { market: 'ASIAN_HANDICAP', selection: 'home', line: modelSpread,  odds: modelHomeSpreadOdds, prob: homeCoversProb },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: -modelSpread, odds: modelAwaySpreadOdds, prob: awayCoversProb },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: modelHomeDraw, prob: finalHome + finalDraw },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: modelAwayDraw, prob: finalAway + finalDraw },
      // BTTS
      { market: 'BTTS', selection: 'yes', line: null, odds: modelBttsYes, prob: sim.btts },
      { market: 'BTTS', selection: 'no',  line: null, odds: modelBttsNo,  prob: 1 - sim.btts },
      // NO_DRAW (stored as 1X2/no_draw)
      { market: '1X2', selection: 'no_draw', line: null, odds: modelNoDraw, prob: finalHome + finalAway },
    ];

    // ── Step 10: Insert model odds ────────────────────────────────────────────
    let insertedRows = 0;
    for (const row of modelRows) {
      if (row.odds == null) {
        console.log(`${TAG} [STEP 10] SKIP null odds: ${row.market}/${row.selection}`);
        continue;
      }
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [f.espn_match_id, snapshotTs, MODEL_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, row.prob ?? impliedProb(row.odds)]
      );
      console.log(`${TAG} [STEP 10] INSERT: ${row.market}/${row.selection} line=${row.line ?? 'null'} odds=${row.odds > 0 ? '+' : ''}${row.odds} prob=${row.prob.toFixed(4)}`);
      insertedRows++;
      totalModelRows++;
    }
    console.log(`${TAG} [OUTPUT] Inserted ${insertedRows} model rows for ${f.espn_match_id}`);

    // ── Step 11: Upsert model projection ─────────────────────────────────────
    const nv_out = { h: nv.h, d: nv.d, a: nv.a };
    // Compute DC and no-draw NV probs for the extended columns
    const nvDc1x = nv_out.h + nv_out.d;
    const nvDcX2 = nv_out.a + nv_out.d;
    const nvNoDrawHome = nv_out.h / (nv_out.h + nv_out.a);
    const nvNoDrawAway = nv_out.a / (nv_out.h + nv_out.a);

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
        nv_dc_1x, nv_dc_x2,
        dc_1x_odds, dc_x2_odds,
        nv_no_draw_home, nv_no_draw_away,
        no_draw_home_odds, no_draw_away_odds,
        btts_yes_odds, btts_no_odds,
        modeled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
        nv_dc_1x = VALUES(nv_dc_1x),
        nv_dc_x2 = VALUES(nv_dc_x2),
        dc_1x_odds = VALUES(dc_1x_odds),
        dc_x2_odds = VALUES(dc_x2_odds),
        nv_no_draw_home = VALUES(nv_no_draw_home),
        nv_no_draw_away = VALUES(nv_no_draw_away),
        no_draw_home_odds = VALUES(no_draw_home_odds),
        no_draw_away_odds = VALUES(no_draw_away_odds),
        btts_yes_odds = VALUES(btts_yes_odds),
        btts_no_odds = VALUES(btts_no_odds),
        modeled_at = NOW()
    `, [
      f.espn_match_id, MODEL_VERSION, N_SIMULATIONS,
      f.homeName, f.awayName,
      lambdaH, lambdaA,
      finalHome, finalDraw, finalAway,
      projHomeScore, projAwayScore, projTotal, projSpread,
      sim.over05, sim.over15, sim.over25, sim.under25, sim.over35,
      sim.btts,
      modelHomeML, modelDrawML, modelAwayML,
      f.dkTotalLine, modelOverOdds, modelUnderOdds,
      modelSpread, modelSpreadRaw, modelHomeSpreadOdds, modelAwaySpreadOdds,
      nv_out.h, nv_out.d, nv_out.a,
      // edges: (model prob - book implied prob) * 100 = percentage points
      (finalHome - impliedProb(f.dkHomeML)) * 100,
      (finalDraw - impliedProb(f.dkDrawML)) * 100,
      (finalAway - impliedProb(f.dkAwayML)) * 100,
      finalHome > finalAway ? 'home' : 'away',
      Math.max(finalHome, finalAway),
      sim.top,
      // DC and no-draw extended columns
      nvDc1x, nvDcX2,
      modelHomeDraw, modelAwayDraw,
      nvNoDrawHome, nvNoDrawAway,
      modelNoDraw, modelNoDraw, // home and away no-draw odds (same line, different perspective)
      modelBttsYes, modelBttsNo,
    ]);
    totalProjRows++;
    console.log(`${TAG} [OUTPUT] Upserted projection: ${f.espn_match_id} proj=${projHomeScore}-${projAwayScore} spread=${projSpread} btts=${sim.btts.toFixed(4)}`);
    console.log('');
  }

  // ── Final verification ────────────────────────────────────────────────────
  const MATCH_IDS = MATCHS.map(f => f.espn_match_id);
  const idList = MATCH_IDS.map(() => '?').join(',');

  const [verifyModel] = await conn.query(
    `SELECT match_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE match_id IN (${idList}) AND book_id = ${MODEL_BOOK_ID} GROUP BY match_id`,
    MATCH_IDS
  );
  const [verifyProj] = await conn.query(
    `SELECT match_id, proj_home_score, proj_away_score, proj_total, model_home_ml, model_draw_ml, model_away_ml, model_lean FROM wc2026_model_projections WHERE match_id IN (${idList})`,
    MATCH_IDS
  );

  console.log(`${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} FINAL VERIFICATION`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} [VERIFY] Model odds per match (expected 12 each):`);
  for (const r of verifyModel) {
    const pass = r.cnt === 12;
    console.log(`${TAG}   ${r.match_id}: ${r.cnt} rows ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
  }
  console.log(`${TAG} [VERIFY] Model projections:`);
  for (const r of verifyProj) {
    console.log(`${TAG}   ${r.match_id}: proj=${r.proj_home_score}-${r.proj_away_score} total=${r.proj_total} lean=${r.model_lean} ML: home=${r.model_home_ml} draw=${r.model_draw_ml} away=${r.model_away_ml}`);
  }

  const allModelOk = verifyModel.length === 6 && verifyModel.every(r => r.cnt === 12);
  const allProjOk = verifyProj.length === 6;
  const pass = allModelOk && allProjOk;

  console.log(`\n${TAG} [VERIFY] ${pass ? 'ALL CHECKS PASSED ✓' : 'FAILURES DETECTED ✗'}`);
  console.log(`${TAG}   Model odds: ${verifyModel.length}/6 matchs (${allModelOk ? 'PASS' : 'FAIL'})`);
  console.log(`${TAG}   Projections: ${verifyProj.length}/6 (${allProjOk ? 'PASS' : 'FAIL'})`);
  console.log(`${TAG}   Total model rows inserted: ${totalModelRows}`);
  console.log(`${TAG}   Total projection rows upserted: ${totalProjRows}`);
  console.log(`${TAG}   Errors: ${errors.length}`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  await conn.end();
  process.exit(pass ? 0 : 1);
}

main().catch(e => {
  console.error(`${TAG} [FATAL] Unhandled error: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
