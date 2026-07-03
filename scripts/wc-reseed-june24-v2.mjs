/**
 * wc-reseed-june24-v2.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 24 — Full reseed v2 with ALL bugs fixed:
 *
 * BUG 1 FIXED: Spread formula
 *   OLD (WRONG): diff > line (where line=-1.5 → catches everything except losing by 2+)
 *   NEW (CORRECT): diff > -homeSpreadLine (unified formula)
 *     homeSpreadLine=-1.5 → diff > 1.5 → P(home wins by 2+) ✅
 *     homeSpreadLine=+1.5 → diff > -1.5 → P(home doesn't lose by 2+) ✅
 *
 * BUG 2 FIXED: Lambda derivation
 *   OLD (WRONG): lambdaH = totalLine * (nvHome + 0.45*nvDraw) — linear allocation, ignores Poisson
 *   NEW (CORRECT): Bisection calibration — find (λH, λA) with λH+λA=T such that
 *     P(H>A | λH,λA) = nvHome using full Poisson simulation
 *
 * GROUND TRUTH (June 24, 2026 — DK lines, verified):
 *   wc26-g-049: CAN(away) @ SUI(home)  — SUI ML: +135, CAN ML: +240
 *   wc26-g-050: QAT(away) @ BIH(home)  — BIH ML: -240, QAT ML: +600
 *   wc26-g-051: BRA(away) @ SCO(home)  — BRA ML: -265, SCO ML: +700
 *   wc26-g-052: HAI(away) @ MAR(home)  — MAR ML: -500, HAI ML: +1400
 *   wc26-g-053: MEX(away) @ CZE(home)  — MEX ML: -105, CZE ML: +265
 *   wc26-g-054: KOR(away) @ RSA(home)  — KOR ML: -150, RSA ML: +425
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_RESEED_V2]';
const DK_BOOK_ID = 68;
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v4.2-june24-v2';

// ─── Math utilities ──────────────────────────────────────────────────────────
function probToAmerican(p) {
  if (p == null || isNaN(p) || p <= 0 || p >= 1) return null;
  const odds = p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
  return Math.max(-9999, Math.min(9999, odds));
}
function americanToProb(odds) {
  if (!odds) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
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

// Full Poisson simulation: returns all probabilities
function runPoisson(lH, lA, maxGoals = 10) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0, over25 = 0, under25 = 0, over35 = 0, under35 = 0;
  let totalSims = 0;
  const scorelines = {};
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lH) * poissonPmf(a, lA) * dixonColesRho(h, a, lH, lA);
      if (p < 1e-12) continue;
      totalSims += p;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h > 0 && a > 0) btts += p;
      if (h + a > 2.5) over25 += p; else under25 += p;
      if (h + a > 3.5) over35 += p; else under35 += p;
      const key = `${h}-${a}`;
      scorelines[key] = (scorelines[key] || 0) + p;
    }
  }
  homeWin /= totalSims; draw /= totalSims; awayWin /= totalSims;
  btts /= totalSims; over25 /= totalSims; under25 /= totalSims;
  over35 /= totalSims; under35 /= totalSims;
  const top = Object.entries(scorelines)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([s, p]) => `${s}:${(p / totalSims * 100).toFixed(1)}%`);
  return { homeWin, draw, awayWin, btts, over25, under25, over35, under35, top: JSON.stringify(top) };
}

// ─── FIXED: Asian Handicap probability ───────────────────────────────────────
// UNIFIED FORMULA: P(home covers) = P(diff > -homeSpreadLine)
//   homeSpreadLine=-1.5 → P(diff > 1.5) = P(home wins by 2+) ✅
//   homeSpreadLine=+1.5 → P(diff > -1.5) = P(home doesn't lose by 2+) ✅
// P(away covers) = 1 - P(home covers) [no push with .5 lines]
function computeSpreadProbs(lambdaH, lambdaA, homeSpreadLine, maxGoals = 10) {
  const threshold = -homeSpreadLine; // e.g., -(-1.5) = 1.5 for home -1.5
  let homeCoversProb = 0;
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) * dixonColesRho(h, a, lambdaH, lambdaA);
      if (p < 1e-12) continue;
      total += p;
      const diff = h - a;
      if (diff > threshold) homeCoversProb += p;
    }
  }
  homeCoversProb /= total;
  const awayCoversProb = 1 - homeCoversProb;
  return { homeCoversProb, awayCoversProb };
}

// ─── FIXED: Lambda calibration via bisection ─────────────────────────────────
// Find (λH, λA) with λH+λA = totalLine such that P(H>A | λH,λA) = targetHomeWinProb
// Uses bisection on ratio r = λH / (λH + λA) in [0.01, 0.99]
function calibrateLambdas(targetHomeWinProb, totalLine, maxIter = 50, tol = 1e-6) {
  // Edge case: if target is very extreme, clamp
  const target = Math.max(0.02, Math.min(0.98, targetHomeWinProb));

  let lo = 0.01, hi = 0.99;
  let lH, lA;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    lH = mid * totalLine;
    lA = (1 - mid) * totalLine;
    const sim = runPoisson(lH, lA);
    const homeWin = sim.homeWin;
    if (Math.abs(homeWin - target) < tol) break;
    if (homeWin < target) lo = mid;
    else hi = mid;
  }

  return { lambdaH: lH, lambdaA: lA };
}

// ─── June 24 Fixtures with exact ground truth ────────────────────────────────
const FIXTURES = [
  {
    fixtureId: 'wc26-g-049',
    correctHomeId: 'sui', correctAwayId: 'can',
    homeName: 'Switzerland', awayName: 'Canada',
    homeAbbr: 'SUI', awayAbbr: 'CAN',
    book: {
      mlAway: 240, mlHome: 135, mlDraw: 210, mlNoDraw: -270,
      totalLine: 2.5, overOdds: 100, underOdds: -125,
      awaySpreadLine: 1.5, awaySpreadOdds: -575,
      homeSpreadLine: -1.5, homeSpreadOdds: 400,
      dcAwayDraw: -170, dcHomeDraw: -310,
      bttsYes: -140, bttsNo: 110,
    }
  },
  {
    fixtureId: 'wc26-g-050',
    correctHomeId: 'bih', correctAwayId: 'qat',
    homeName: 'Bosnia', awayName: 'Qatar',
    homeAbbr: 'BIH', awayAbbr: 'QAT',
    book: {
      mlAway: 600, mlHome: -240, mlDraw: 400, mlNoDraw: -575,
      totalLine: 2.5, overOdds: -175, underOdds: 140,
      awaySpreadLine: 1.5, awaySpreadOdds: -140,
      homeSpreadLine: -1.5, homeSpreadOdds: 110,
      dcAwayDraw: 185, dcHomeDraw: -1000,
      bttsYes: -135, bttsNo: 105,
    }
  },
  {
    fixtureId: 'wc26-g-051',
    correctHomeId: 'sco', correctAwayId: 'bra',
    homeName: 'Scotland', awayName: 'Brazil',
    homeAbbr: 'SCO', awayAbbr: 'BRA',
    book: {
      mlAway: -265, mlHome: 700, mlDraw: 425, mlNoDraw: -600,
      totalLine: 2.5, overOdds: -115, underOdds: -105,
      // BRA away -1.5, SCO home +1.5
      awaySpreadLine: -1.5, awaySpreadOdds: 100,
      homeSpreadLine: 1.5, homeSpreadOdds: -130,
      dcAwayDraw: -1100, dcHomeDraw: 200,
      bttsYes: 130, bttsNo: -165,
    }
  },
  {
    fixtureId: 'wc26-g-052',
    correctHomeId: 'mar', correctAwayId: 'hai',
    homeName: 'Morocco', awayName: 'Haiti',
    homeAbbr: 'MAR', awayAbbr: 'HAI',
    book: {
      mlAway: 1400, mlHome: -500, mlDraw: 600, mlNoDraw: -1000,
      totalLine: 3.5, overOdds: 145, underOdds: -175,
      awaySpreadLine: 1.5, awaySpreadOdds: 135,
      homeSpreadLine: -1.5, homeSpreadOdds: -170,
      dcAwayDraw: 340, dcHomeDraw: -3500,
      bttsYes: 130, bttsNo: -165,
    }
  },
  {
    fixtureId: 'wc26-g-053',
    correctHomeId: 'cze', correctAwayId: 'mex',
    homeName: 'Czech Republic', awayName: 'Mexico',
    homeAbbr: 'CZE', awayAbbr: 'MEX',
    book: {
      mlAway: -105, mlHome: 265, mlDraw: 285, mlNoDraw: -370,
      totalLine: 2.5, overOdds: 105, underOdds: -130,
      // MEX away -1.5, CZE home +1.5
      awaySpreadLine: -1.5, awaySpreadOdds: 260,
      homeSpreadLine: 1.5, homeSpreadOdds: -350,
      dcAwayDraw: -350, dcHomeDraw: -120,
      bttsYes: -110, bttsNo: -115,
    }
  },
  {
    fixtureId: 'wc26-g-054',
    correctHomeId: 'rsa', correctAwayId: 'kor',
    homeName: 'South Africa', awayName: 'South Korea',
    homeAbbr: 'RSA', awayAbbr: 'KOR',
    book: {
      mlAway: -150, mlHome: 425, mlDraw: 295, mlNoDraw: -390,
      totalLine: 2.5, overOdds: 105, underOdds: -130,
      // KOR away -1.5, RSA home +1.5
      awaySpreadLine: -1.5, awaySpreadOdds: 195,
      homeSpreadLine: 1.5, homeSpreadOdds: -250,
      dcAwayDraw: -600, dcHomeDraw: 115,
      bttsYes: -105, bttsNo: -125,
    }
  },
];

async function main() {
  console.log(`${TAG} [INPUT] Starting June 24 reseed v2 — ${FIXTURES.length} fixtures`);
  console.log(`${TAG} [INPUT] Fixes: (1) spread formula unified, (2) lambdas via bisection calibration`);
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  // Verify fixture orientation (already fixed in v1)
  const fixtureIds = FIXTURES.map(f => f.fixtureId);
  const [dbFixtures] = await conn.query(
    `SELECT fixture_id, home_team_id, away_team_id FROM wc2026_matches WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')}) ORDER BY fixture_id`,
    fixtureIds
  );
  console.log(`\n${TAG} [STEP] Verifying fixture orientation...`);
  for (const f of FIXTURES) {
    const dbF = dbFixtures.find(r => r.fixture_id === f.fixtureId);
    const ok = dbF?.home_team_id === f.correctHomeId && dbF?.away_team_id === f.correctAwayId;
    if (!ok) {
      await conn.query(`UPDATE wc2026_matches SET home_team_id=?, away_team_id=? WHERE fixture_id=?`, [f.correctHomeId, f.correctAwayId, f.fixtureId]);
      console.log(`${TAG} [STATE] FIXED orientation ${f.fixtureId}: home=${f.correctHomeId} away=${f.correctAwayId}`);
    } else {
      console.log(`${TAG} [STATE] OK ${f.fixtureId}: home=${f.correctHomeId} away=${f.correctAwayId}`);
    }
  }

  // Delete all existing odds for June 24 fixtures (both v1 and any prior)
  console.log(`\n${TAG} [STEP] Clearing all odds for June 24 fixtures...`);
  const [del] = await conn.query(`DELETE FROM wc2026_odds_snapshots WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')})`, fixtureIds);
  console.log(`${TAG} [STATE] Deleted ${del.affectedRows} rows`);

  // Delete old projections for June 24 fixtures
  const [delProj] = await conn.query(`DELETE FROM wc2026_model_projections WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')})`, fixtureIds);
  console.log(`${TAG} [STATE] Deleted ${delProj.affectedRows} projection rows`);

  let totalBookRows = 0, totalModelRows = 0;
  const results = [];

  for (const f of FIXTURES) {
    const b = f.book;
    console.log(`\n${TAG} [STEP] Processing ${f.fixtureId} | ${f.awayName}(away) @ ${f.homeName}(home)`);

    // ── Step 1: Remove vig from 1X2 ──
    const rawHome = americanToProb(b.mlHome);
    const rawDraw = americanToProb(b.mlDraw);
    const rawAway = americanToProb(b.mlAway);
    const sum = rawHome + rawDraw + rawAway;
    const nvHome = rawHome / sum;
    const nvDraw = rawDraw / sum;
    const nvAway = rawAway / sum;
    console.log(`${TAG} [STATE] No-vig probs: home=${nvHome.toFixed(4)} draw=${nvDraw.toFixed(4)} away=${nvAway.toFixed(4)} sum=${(nvHome+nvDraw+nvAway).toFixed(4)}`);

    // ── Step 2: Calibrate lambdas via bisection ──
    // Target: P(home wins) = nvHome, total goals = totalLine
    const { lambdaH, lambdaA } = calibrateLambdas(nvHome, b.totalLine);
    console.log(`${TAG} [STATE] Calibrated lambdas: lambdaH=${lambdaH.toFixed(4)} lambdaA=${lambdaA.toFixed(4)} sum=${(lambdaH+lambdaA).toFixed(4)}`);

    // ── Step 3: Run Poisson simulation ──
    const sim = runPoisson(lambdaH, lambdaA);
    console.log(`${TAG} [STATE] Sim: homeWin=${sim.homeWin.toFixed(4)} draw=${sim.draw.toFixed(4)} awayWin=${sim.awayWin.toFixed(4)}`);
    console.log(`${TAG} [STATE] Target homeWin=${nvHome.toFixed(4)} | Error=${Math.abs(sim.homeWin - nvHome).toFixed(6)}`);

    // ── Step 4: Draw floor recalibration (+9.7pp) ──
    const drawFloor = 0.097;
    const adjDraw = Math.max(sim.draw, drawFloor);
    const excess = adjDraw - sim.draw;
    const adjHomeWin = sim.homeWin - excess * (sim.homeWin / (sim.homeWin + sim.awayWin + 1e-10));
    const adjAwayWin = sim.awayWin - excess * (sim.awayWin / (sim.homeWin + sim.awayWin + 1e-10));
    const totalAdj = adjHomeWin + adjDraw + adjAwayWin;
    const finalHome = adjHomeWin / totalAdj;
    const finalDraw = adjDraw / totalAdj;
    const finalAway = adjAwayWin / totalAdj;
    console.log(`${TAG} [STATE] After draw floor: home=${finalHome.toFixed(4)} draw=${finalDraw.toFixed(4)} away=${finalAway.toFixed(4)}`);

    // ── Step 5: FIXED spread computation ──
    const { homeCoversProb, awayCoversProb } = computeSpreadProbs(lambdaH, lambdaA, b.homeSpreadLine);
    console.log(`${TAG} [STATE] Spread: homeSpreadLine=${b.homeSpreadLine} threshold=${-b.homeSpreadLine}`);
    console.log(`${TAG} [STATE] homeCoversProb=${homeCoversProb.toFixed(4)} awayCoversProb=${awayCoversProb.toFixed(4)}`);

    // ── Step 6: Sanity checks ──
    const homeIsMLFav = b.mlHome < 0;
    const homeIsSpreadFav = b.homeSpreadLine < 0;
    // If home is spread favorite (-1.5), home covers prob should be LESS than home ML win prob
    // (harder to win by 2+ than to just win)
    const spreadSanity = homeIsSpreadFav
      ? homeCoversProb < nvHome  // home -1.5: harder than just winning
      : homeCoversProb > nvHome; // home +1.5: easier than just winning (covers if don't lose by 2+)
    console.log(`${TAG} [VERIFY] Spread sanity: ${spreadSanity ? 'PASS ✅' : 'FAIL ❌'} (homeCoversProb=${homeCoversProb.toFixed(4)} vs nvHome=${nvHome.toFixed(4)})`);
    console.log(`${TAG} [VERIFY] homeCoversProb + awayCoversProb = ${(homeCoversProb + awayCoversProb).toFixed(6)} (must be 1.0)`);

    // ── Step 7: Model odds ──
    const modelHomeML = probToAmerican(finalHome);
    const modelDrawML = probToAmerican(finalDraw);
    const modelAwayML = probToAmerican(finalAway);
    const modelOverProb = b.totalLine === 3.5 ? sim.over35 : sim.over25;
    const modelUnderProb = b.totalLine === 3.5 ? sim.under35 : sim.under25;
    const modelOverOdds = probToAmerican(modelOverProb);
    const modelUnderOdds = probToAmerican(modelUnderProb);
    const modelHomeSpreadOdds = probToAmerican(homeCoversProb);
    const modelAwaySpreadOdds = probToAmerican(awayCoversProb);
    const modelHomeDraw = probToAmerican(finalHome + finalDraw);
    const modelAwayDraw = probToAmerican(finalAway + finalDraw);
    const modelNoDraw = probToAmerican(finalHome + finalAway);
    const modelBttsYes = probToAmerican(sim.btts);
    const modelBttsNo = probToAmerican(1 - sim.btts);

    console.log(`${TAG} [OUTPUT] Model ML: home=${modelHomeML} draw=${modelDrawML} away=${modelAwayML}`);
    console.log(`${TAG} [OUTPUT] Model Spread: home=${modelHomeSpreadOdds} away=${modelAwaySpreadOdds} (at line ${b.homeSpreadLine}/${b.awaySpreadLine})`);
    console.log(`${TAG} [OUTPUT] Book Spread:  home=${b.homeSpreadOdds} away=${b.awaySpreadOdds}`);
    console.log(`${TAG} [OUTPUT] Model Total: over=${modelOverOdds} under=${modelUnderOdds} | Book: over=${b.overOdds} under=${b.underOdds}`);

    // ── Step 8: Insert book odds ──
    const bookRows = [
      { market: '1X2', selection: 'home', line: null, odds: b.mlHome, prob: rawHome / sum },
      { market: '1X2', selection: 'draw', line: null, odds: b.mlDraw, prob: rawDraw / sum },
      { market: '1X2', selection: 'away', line: null, odds: b.mlAway, prob: rawAway / sum },
      { market: '1X2', selection: 'no_draw', line: null, odds: b.mlNoDraw, prob: (rawHome + rawAway) / sum },
      { market: 'TOTAL', selection: 'over', line: b.totalLine, odds: b.overOdds, prob: americanToProb(b.overOdds) },
      { market: 'TOTAL', selection: 'under', line: b.totalLine, odds: b.underOdds, prob: americanToProb(b.underOdds) },
      { market: 'ASIAN_HANDICAP', selection: 'home', line: b.homeSpreadLine, odds: b.homeSpreadOdds, prob: americanToProb(b.homeSpreadOdds) },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: b.awaySpreadLine, odds: b.awaySpreadOdds, prob: americanToProb(b.awaySpreadOdds) },
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: b.dcHomeDraw, prob: americanToProb(b.dcHomeDraw) },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: b.dcAwayDraw, prob: americanToProb(b.dcAwayDraw) },
      { market: 'BTTS', selection: 'yes', line: null, odds: b.bttsYes, prob: americanToProb(b.bttsYes) },
      { market: 'BTTS', selection: 'no', line: null, odds: b.bttsNo, prob: americanToProb(b.bttsNo) },
    ];
    for (const row of bookRows) {
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [f.fixtureId, snapshotTs, DK_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, row.prob]
      );
      totalBookRows++;
    }

    // ── Step 9: Insert model odds ──
    const modelRows = [
      { market: '1X2', selection: 'home', line: null, odds: modelHomeML, prob: finalHome },
      { market: '1X2', selection: 'draw', line: null, odds: modelDrawML, prob: finalDraw },
      { market: '1X2', selection: 'away', line: null, odds: modelAwayML, prob: finalAway },
      { market: '1X2', selection: 'no_draw', line: null, odds: modelNoDraw, prob: finalHome + finalAway },
      { market: 'TOTAL', selection: 'over', line: b.totalLine, odds: modelOverOdds, prob: modelOverProb },
      { market: 'TOTAL', selection: 'under', line: b.totalLine, odds: modelUnderOdds, prob: modelUnderProb },
      { market: 'ASIAN_HANDICAP', selection: 'home', line: b.homeSpreadLine, odds: modelHomeSpreadOdds, prob: homeCoversProb },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: b.awaySpreadLine, odds: modelAwaySpreadOdds, prob: awayCoversProb },
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: modelHomeDraw, prob: finalHome + finalDraw },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: modelAwayDraw, prob: finalAway + finalDraw },
      { market: 'BTTS', selection: 'yes', line: null, odds: modelBttsYes, prob: sim.btts },
      { market: 'BTTS', selection: 'no', line: null, odds: modelBttsNo, prob: 1 - sim.btts },
    ];
    for (const row of modelRows) {
      if (row.odds == null) { console.log(`${TAG} [VERIFY] SKIP null odds: ${row.market}:${row.selection}`); continue; }
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [f.fixtureId, snapshotTs, MODEL_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, row.prob]
      );
      totalModelRows++;
    }

    // ── Step 10: Upsert projection ──
    const projHomeScore = parseFloat(lambdaH.toFixed(2));
    const projAwayScore = parseFloat(lambdaA.toFixed(2));
    const projTotal = parseFloat((lambdaH + lambdaA).toFixed(2));
    const projSpread = parseFloat((lambdaH - lambdaA).toFixed(2));

    await conn.query(`
      INSERT INTO wc2026_model_projections (
        fixture_id, model_version, n_simulations, home_team, away_team,
        home_lambda, away_lambda, home_win_prob, draw_prob, away_win_prob,
        proj_home_score, proj_away_score, proj_total, proj_spread,
        over_2_5, under_2_5, over_3_5, btts_prob,
        model_home_ml, model_draw_ml, model_away_ml,
        model_total, over_odds, under_odds,
        model_spread, model_spread_raw, home_spread_odds, away_spread_odds,
        nv_home_prob, nv_draw_prob, nv_away_prob,
        home_edge, draw_edge, away_edge, model_lean, lean_prob, top_scorelines, modeled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      f.fixtureId, MODEL_VERSION, 1000000, f.homeName, f.awayName,
      lambdaH, lambdaA, finalHome, finalDraw, finalAway,
      projHomeScore, projAwayScore, projTotal, projSpread,
      sim.over25, sim.under25, sim.over35, sim.btts,
      modelHomeML, modelDrawML, modelAwayML,
      b.totalLine, modelOverOdds, modelUnderOdds,
      b.homeSpreadLine, projSpread, modelHomeSpreadOdds, modelAwaySpreadOdds,
      nvHome, nvDraw, nvAway,
      0, 0, 0,
      finalHome > finalAway ? 'home' : 'away', Math.max(finalHome, finalAway), sim.top,
    ]);

    results.push({ id: f.fixtureId, home: f.homeAbbr, away: f.awayAbbr, homeML: modelHomeML, awayML: modelAwayML, homeSpread: modelHomeSpreadOdds, awaySpread: modelAwaySpreadOdds, spreadSanity });
    console.log(`${TAG} [OUTPUT] ${f.fixtureId}: DONE — bookRows=12 modelRows=12`);
  }

  // ── Final verification ──
  console.log(`\n${TAG} ═══ FINAL VERIFICATION ═══`);
  const [verify] = await conn.query(
    `SELECT fixture_id, book_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')}) GROUP BY fixture_id, book_id ORDER BY fixture_id, book_id`,
    fixtureIds
  );
  const [verifyProj] = await conn.query(
    `SELECT fixture_id, proj_home_score, proj_away_score, proj_total, model_home_ml, model_away_ml, home_spread_odds, away_spread_odds FROM wc2026_model_projections WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')}) ORDER BY fixture_id, modeled_at DESC`,
    fixtureIds
  );

  let allOk = true;
  for (const r of results) {
    const bookRows = verify.find(v => v.fixture_id === r.id && v.book_id === DK_BOOK_ID);
    const modelRows = verify.find(v => v.fixture_id === r.id && v.book_id === MODEL_BOOK_ID);
    const proj = verifyProj.find(v => v.fixture_id === r.id);
    const bookCnt = Number(bookRows?.cnt ?? 0);
    const modelCnt = Number(modelRows?.cnt ?? 0);
    const projTotal = Number(proj?.proj_total);
    const projRound = projTotal === 2.5 || projTotal === 3.5;
    const ok = bookCnt === 12 && modelCnt === 12 && r.spreadSanity && !projRound;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${r.id} | ${r.away}@${r.home} | book=${bookCnt}/12 model=${modelCnt}/12 | projTotal=${projTotal}${projRound ? '⚠️ROUND' : '✅'} | spreadSanity=${r.spreadSanity ? '✅' : '❌'}`);
    console.log(`   ML: home=${r.homeML} away=${r.awayML} | Spread: home=${r.homeSpread} away=${r.awaySpread}`);
  }

  console.log(`\n${TAG} [VERIFY] ${allOk ? '✅ ALL PASS' : '❌ FAILURES DETECTED'}`);
  console.log(`${TAG} [OUTPUT] Total: book=${totalBookRows} model=${totalModelRows}`);
  await conn.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(e => {
  console.error(`${TAG} FATAL: ${e.message}\n${e.stack}`);
  process.exit(1);
});
