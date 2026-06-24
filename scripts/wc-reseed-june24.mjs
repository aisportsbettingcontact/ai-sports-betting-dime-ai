/**
 * wc-reseed-june24.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * WC 2026 June 24 — Full reseed with:
 * 1. Correct home/away fixture orientation (swap DB if needed)
 * 2. Exact book odds from ground truth (DK lines)
 * 3. Model odds recalculated at BOOK spread line (not model's own line)
 * 4. Correct total lines (HAI@MAR=3.5, MEX@CZE=2.5)
 * 5. Projected scores from raw lambda (not rounded to line)
 *
 * GROUND TRUTH (June 24, 2026 — DK lines):
 *   wc26-g-049: CAN(away) @ SUI(home)
 *   wc26-g-050: QAT(away) @ BIH(home)
 *   wc26-g-051: BRA(away) @ SCO(home)
 *   wc26-g-052: HAI(away) @ MAR(home)
 *   wc26-g-053: MEX(away) @ CZE(home)
 *   wc26-g-054: KOR(away) @ RSA(home)
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[WC_RESEED_JUN24]';
const DK_BOOK_ID = 68;
const MODEL_BOOK_ID = 0;
const MODEL_VERSION = 'v4.2-corrected-june24-reseed';

// ─── Math utilities ──────────────────────────────────────────────────────────
function probToAmerican(p) {
  if (!p || p <= 0 || p >= 1) return null;
  return p >= 0.5 ? Math.round(-p / (1 - p) * 100) : Math.round((1 - p) / p * 100);
}
function americanToProb(odds) {
  if (!odds) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}
function clamp(val, min = -9999, max = 9999) {
  if (val == null || isNaN(val)) return null;
  return Math.max(min, Math.min(max, val));
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

// Compute P(home wins by > line) for Asian Handicap at a given book line
function computeAsianHandicapProb(lambdaH, lambdaA, line, side, maxGoals = 8) {
  // line is from HOME perspective: home -1.5 means home must win by 2+
  // side='home': P(home goals - away goals > line)
  // side='away': P(away goals - home goals > -line) = P(home goals - away goals < line)
  let prob = 0;
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) * dixonColesRho(h, a, lambdaH, lambdaA);
      if (p < 1e-10) continue;
      total += p;
      const diff = h - a; // positive = home winning
      if (side === 'home' && diff > line) prob += p;
      if (side === 'away' && diff < line) prob += p;
    }
  }
  return prob / total;
}

function runPoisson(lH, lA, maxGoals = 8) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let btts = 0, over25 = 0, under25 = 0, over35 = 0, under35 = 0;
  let totalSims = 0;
  const scorelines = {};
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, lH) * poissonPmf(a, lA) * dixonColesRho(h, a, lH, lA);
      if (p < 1e-10) continue;
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

// Derive lambdas from book 1X2 odds (no-vig) + total line
function deriveLambdas(bookHomeML, bookAwayML, bookDrawML, totalLine) {
  // Remove vig from 1X2
  const rawHome = americanToProb(bookHomeML);
  const rawDraw = americanToProb(bookDrawML);
  const rawAway = americanToProb(bookAwayML);
  const sum = rawHome + rawDraw + rawAway;
  const nvHome = rawHome / sum;
  const nvDraw = rawDraw / sum;
  const nvAway = rawAway / sum;

  // Use total line as the expected goals total
  // Distribute based on win probabilities: stronger team scores more
  // lambdaH / lambdaA ratio derived from win probability ratio
  // P(home win) ≈ 1 - exp(-lambdaH) * sum(Poisson) — approximate via ratio
  // Simple approach: lambdaH = totalLine * (nvHome + 0.5*nvDraw) / (nvHome + nvAway + nvDraw)
  const lambdaH = totalLine * (nvHome + 0.45 * nvDraw);
  const lambdaA = totalLine * (nvAway + 0.45 * nvDraw);
  return { lambdaH, lambdaA, nvHome, nvDraw, nvAway };
}

// ─── June 24 Fixtures with exact ground truth ────────────────────────────────
const FIXTURES = [
  {
    fixtureId: 'wc26-g-049',
    // DB currently has home=CAN, away=SUI — NEEDS SWAP
    correctHomeId: 'sui', correctAwayId: 'can',
    homeName: 'Switzerland', awayName: 'Canada',
    homeAbbr: 'SUI', awayAbbr: 'CAN',
    book: {
      mlAway: 240, mlHome: 135, mlDraw: 210, mlNoDraw: -270,
      totalLine: 2.5, overOdds: 100, underOdds: -125,
      // Away = CAN, spread line from away perspective: CAN +1.5 -575
      awaySpreadLine: 1.5, awaySpreadOdds: -575,
      homeSpreadLine: -1.5, homeSpreadOdds: 400,
      dcAwayDraw: -170, dcHomeDraw: -310,
      bttsYes: -140, bttsNo: 110,
    }
  },
  {
    fixtureId: 'wc26-g-050',
    // DB currently has home=QAT, away=BIH — NEEDS SWAP
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
    // DB currently has home=MEX, away=CZE — NEEDS SWAP (this is BRA@SCO)
    correctHomeId: 'sco', correctAwayId: 'bra',
    homeName: 'Scotland', awayName: 'Brazil',
    homeAbbr: 'SCO', awayAbbr: 'BRA',
    book: {
      mlAway: -265, mlHome: 700, mlDraw: 425, mlNoDraw: -600,
      totalLine: 2.5, overOdds: -115, underOdds: -105,
      // BRA away -1.5 +100 | SCO home +1.5 -130
      awaySpreadLine: -1.5, awaySpreadOdds: 100,
      homeSpreadLine: 1.5, homeSpreadOdds: -130,
      dcAwayDraw: -1100, dcHomeDraw: 200,
      bttsYes: 130, bttsNo: -165,
    }
  },
  {
    fixtureId: 'wc26-g-052',
    // DB currently has home=KOR, away=RSA — NEEDS SWAP (this is HAI@MAR)
    correctHomeId: 'mar', correctAwayId: 'hai',
    homeName: 'Morocco', awayName: 'Haiti',
    homeAbbr: 'MAR', awayAbbr: 'HAI',
    book: {
      mlAway: 1400, mlHome: -500, mlDraw: 600, mlNoDraw: -1000,
      totalLine: 3.5, overOdds: 145, underOdds: -175,
      // HAI away +1.5 +135 | MAR home -1.5 -170
      awaySpreadLine: 1.5, awaySpreadOdds: 135,
      homeSpreadLine: -1.5, homeSpreadOdds: -170,
      dcAwayDraw: 340, dcHomeDraw: -3500,
      bttsYes: 130, bttsNo: -165,
    }
  },
  {
    fixtureId: 'wc26-g-053',
    // DB currently has home=HAI, away=MAR — NEEDS SWAP (this is MEX@CZE)
    correctHomeId: 'cze', correctAwayId: 'mex',
    homeName: 'Czech Republic', awayName: 'Mexico',
    homeAbbr: 'CZE', awayAbbr: 'MEX',
    book: {
      mlAway: -105, mlHome: 265, mlDraw: 285, mlNoDraw: -370,
      totalLine: 2.5, overOdds: 105, underOdds: -130,
      // MEX away -1.5 +260 | CZE home +1.5 -350
      awaySpreadLine: -1.5, awaySpreadOdds: 260,
      homeSpreadLine: 1.5, homeSpreadOdds: -350,
      dcAwayDraw: -350, dcHomeDraw: -120,
      bttsYes: -110, bttsNo: -115,
    }
  },
  {
    fixtureId: 'wc26-g-054',
    // DB currently has home=BRA, away=SCO — NEEDS SWAP (this is KOR@RSA)
    correctHomeId: 'rsa', correctAwayId: 'kor',
    homeName: 'South Africa', awayName: 'South Korea',
    homeAbbr: 'RSA', awayAbbr: 'KOR',
    book: {
      mlAway: -150, mlHome: 425, mlDraw: 295, mlNoDraw: -390,
      totalLine: 2.5, overOdds: 105, underOdds: -130,
      // KOR away -1.5 +195 | RSA home +1.5 -250
      awaySpreadLine: -1.5, awaySpreadOdds: 195,
      homeSpreadLine: 1.5, homeSpreadOdds: -250,
      dcAwayDraw: -600, dcHomeDraw: 115,
      bttsYes: -105, bttsNo: -125,
    }
  },
];

async function main() {
  console.log(`${TAG} [INPUT] Starting June 24 full reseed — ${FIXTURES.length} fixtures`);
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const snapshotTs = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  // Verify current DB home/away orientation
  console.log(`\n${TAG} [STEP] Verifying current DB fixture orientation...`);
  const fixtureIds = FIXTURES.map(f => f.fixtureId);
  const [dbFixtures] = await conn.query(
    `SELECT fixture_id, home_team_id, away_team_id FROM wc2026_fixtures WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')}) ORDER BY fixture_id`,
    fixtureIds
  );

  // Fix home/away orientation in fixtures table
  console.log(`\n${TAG} [STEP] Fixing home/away orientation in wc2026_fixtures...`);
  for (const f of FIXTURES) {
    const dbF = dbFixtures.find(r => r.fixture_id === f.fixtureId);
    const homeCorrect = dbF?.home_team_id === f.correctHomeId;
    const awayCorrect = dbF?.away_team_id === f.correctAwayId;
    if (!homeCorrect || !awayCorrect) {
      await conn.query(
        `UPDATE wc2026_fixtures SET home_team_id = ?, away_team_id = ? WHERE fixture_id = ?`,
        [f.correctHomeId, f.correctAwayId, f.fixtureId]
      );
      console.log(`${TAG} [STATE] SWAPPED ${f.fixtureId}: home=${f.correctHomeId} away=${f.correctAwayId} (was home=${dbF?.home_team_id} away=${dbF?.away_team_id})`);
    } else {
      console.log(`${TAG} [STATE] OK ${f.fixtureId}: home=${f.correctHomeId} away=${f.correctAwayId}`);
    }
  }

  // Delete all existing odds for June 24 fixtures
  console.log(`\n${TAG} [STEP] Clearing all odds for June 24 fixtures...`);
  const [del] = await conn.query(
    `DELETE FROM wc2026_odds_snapshots WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')})`,
    fixtureIds
  );
  console.log(`${TAG} [STATE] Deleted ${del.affectedRows} rows`);

  let totalBookRows = 0, totalModelRows = 0;

  for (const f of FIXTURES) {
    const b = f.book;
    console.log(`\n${TAG} [STEP] Processing ${f.fixtureId} | ${f.awayName}(away) @ ${f.homeName}(home)`);

    // ── Derive lambdas from book odds ──
    // Home team = home in DB (e.g., SUI for wc26-g-049)
    // mlHome = home team ML, mlAway = away team ML
    const { lambdaH, lambdaA, nvHome, nvDraw, nvAway } = deriveLambdas(b.mlHome, b.mlAway, b.mlDraw, b.totalLine);
    const sim = runPoisson(lambdaH, lambdaA);

    // Draw floor recalibration
    const drawFloor = 0.097;
    const adjDraw = Math.max(sim.draw, drawFloor);
    const excess = adjDraw - sim.draw;
    const adjHomeWin = sim.homeWin - excess * (sim.homeWin / (sim.homeWin + sim.awayWin + 1e-10));
    const adjAwayWin = sim.awayWin - excess * (sim.awayWin / (sim.homeWin + sim.awayWin + 1e-10));
    const totalAdj = adjHomeWin + adjDraw + adjAwayWin;
    const finalHome = adjHomeWin / totalAdj;
    const finalDraw = adjDraw / totalAdj;
    const finalAway = adjAwayWin / totalAdj;

    // Model odds at book spread line
    const homeSpreadProb = computeAsianHandicapProb(lambdaH, lambdaA, b.homeSpreadLine, 'home');
    const awaySpreadProb = computeAsianHandicapProb(lambdaH, lambdaA, b.homeSpreadLine, 'away');

    // Model total odds
    const modelOverProb = b.totalLine === 3.5 ? sim.over35 : sim.over25;
    const modelUnderProb = b.totalLine === 3.5 ? sim.under35 : sim.under25;

    // Model odds
    const modelHomeML = clamp(probToAmerican(finalHome));
    const modelDrawML = clamp(probToAmerican(finalDraw));
    const modelAwayML = clamp(probToAmerican(finalAway));
    const modelOverOdds = clamp(probToAmerican(modelOverProb));
    const modelUnderOdds = clamp(probToAmerican(modelUnderProb));
    const modelHomeSpreadOdds = clamp(probToAmerican(homeSpreadProb));
    const modelAwaySpreadOdds = clamp(probToAmerican(awaySpreadProb));
    const modelHomeDraw = clamp(probToAmerican(finalHome + finalDraw));
    const modelAwayDraw = clamp(probToAmerican(finalAway + finalDraw));
    const modelNoDraw = clamp(probToAmerican(finalHome + finalAway));
    const modelBttsYes = clamp(probToAmerican(sim.btts));
    const modelBttsNo = clamp(probToAmerican(1 - sim.btts));

    console.log(`${TAG} [STATE] lambdaH=${lambdaH.toFixed(4)} lambdaA=${lambdaA.toFixed(4)}`);
    console.log(`${TAG} [STATE] finalHome=${finalHome.toFixed(4)} finalDraw=${finalDraw.toFixed(4)} finalAway=${finalAway.toFixed(4)}`);
    console.log(`${TAG} [STATE] homeSpreadProb=${homeSpreadProb.toFixed(4)} awaySpreadProb=${awaySpreadProb.toFixed(4)}`);
    console.log(`${TAG} [STATE] Model ML: home=${modelHomeML} draw=${modelDrawML} away=${modelAwayML}`);
    console.log(`${TAG} [STATE] Model Spread: home=${modelHomeSpreadOdds} away=${modelAwaySpreadOdds} (at line ${b.homeSpreadLine}/${b.awaySpreadLine})`);

    // ── Book odds rows ──
    const bookRows = [
      { market: '1X2', selection: 'home', line: null, odds: b.mlHome, prob: nvHome },
      { market: '1X2', selection: 'draw', line: null, odds: b.mlDraw, prob: nvDraw },
      { market: '1X2', selection: 'away', line: null, odds: b.mlAway, prob: nvAway },
      { market: '1X2', selection: 'no_draw', line: null, odds: b.mlNoDraw, prob: nvHome + nvAway },
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

    // ── Model odds rows ──
    const modelRows = [
      { market: '1X2', selection: 'home', line: null, odds: modelHomeML, prob: finalHome },
      { market: '1X2', selection: 'draw', line: null, odds: modelDrawML, prob: finalDraw },
      { market: '1X2', selection: 'away', line: null, odds: modelAwayML, prob: finalAway },
      { market: '1X2', selection: 'no_draw', line: null, odds: modelNoDraw, prob: finalHome + finalAway },
      { market: 'TOTAL', selection: 'over', line: b.totalLine, odds: modelOverOdds, prob: modelOverProb },
      { market: 'TOTAL', selection: 'under', line: b.totalLine, odds: modelUnderOdds, prob: modelUnderProb },
      { market: 'ASIAN_HANDICAP', selection: 'home', line: b.homeSpreadLine, odds: modelHomeSpreadOdds, prob: homeSpreadProb },
      { market: 'ASIAN_HANDICAP', selection: 'away', line: b.awaySpreadLine, odds: modelAwaySpreadOdds, prob: awaySpreadProb },
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', line: null, odds: modelHomeDraw, prob: finalHome + finalDraw },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', line: null, odds: modelAwayDraw, prob: finalAway + finalDraw },
      { market: 'BTTS', selection: 'yes', line: null, odds: modelBttsYes, prob: sim.btts },
      { market: 'BTTS', selection: 'no', line: null, odds: modelBttsNo, prob: 1 - sim.btts },
    ];

    for (const row of modelRows) {
      if (row.odds == null) { console.log(`${TAG} [VERIFY] SKIP null: ${row.market}:${row.selection}`); continue; }
      await conn.query(
        `INSERT INTO wc2026_odds_snapshots (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [f.fixtureId, snapshotTs, MODEL_BOOK_ID, row.market, row.selection, row.line ?? null, row.odds, row.prob]
      );
      totalModelRows++;
    }

    // ── Upsert projection with raw lambda scores ──
    const projHomeScore = parseFloat(lambdaH.toFixed(2));
    const projAwayScore = parseFloat(lambdaA.toFixed(2));
    const projTotal = parseFloat((lambdaH + lambdaA).toFixed(2)); // RAW, not rounded to line
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
      ON DUPLICATE KEY UPDATE
        model_version=VALUES(model_version), home_lambda=VALUES(home_lambda), away_lambda=VALUES(away_lambda),
        home_win_prob=VALUES(home_win_prob), draw_prob=VALUES(draw_prob), away_win_prob=VALUES(away_win_prob),
        proj_home_score=VALUES(proj_home_score), proj_away_score=VALUES(proj_away_score),
        proj_total=VALUES(proj_total), proj_spread=VALUES(proj_spread),
        over_2_5=VALUES(over_2_5), under_2_5=VALUES(under_2_5), over_3_5=VALUES(over_3_5), btts_prob=VALUES(btts_prob),
        model_home_ml=VALUES(model_home_ml), model_draw_ml=VALUES(model_draw_ml), model_away_ml=VALUES(model_away_ml),
        model_total=VALUES(model_total), over_odds=VALUES(over_odds), under_odds=VALUES(under_odds),
        model_spread=VALUES(model_spread), model_spread_raw=VALUES(model_spread_raw),
        home_spread_odds=VALUES(home_spread_odds), away_spread_odds=VALUES(away_spread_odds),
        model_lean=VALUES(model_lean), lean_prob=VALUES(lean_prob),
        top_scorelines=VALUES(top_scorelines), modeled_at=NOW()
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

    console.log(`${TAG} [OUTPUT] ${f.fixtureId}: bookRows=12 modelRows=12 projTotal=${projTotal} (raw, not rounded)`);
  }

  // ── Final verification ──
  console.log(`\n${TAG} [VERIFY] Final verification...`);
  const [verify] = await conn.query(
    `SELECT fixture_id, book_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')}) GROUP BY fixture_id, book_id ORDER BY fixture_id, book_id`,
    fixtureIds
  );
  const [verifyProj] = await conn.query(
    `SELECT fixture_id, proj_home_score, proj_away_score, proj_total FROM wc2026_model_projections WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')}) ORDER BY fixture_id`,
    fixtureIds
  );
  const [verifyFix] = await conn.query(
    `SELECT fixture_id, home_team_id, away_team_id FROM wc2026_fixtures WHERE fixture_id IN (${fixtureIds.map(() => '?').join(',')}) ORDER BY fixture_id`,
    fixtureIds
  );

  let allOk = true;
  for (const fid of fixtureIds) {
    const f = FIXTURES.find(x => x.fixtureId === fid);
    const bookRows = verify.find(r => r.fixture_id === fid && r.book_id === DK_BOOK_ID);
    const modelRows = verify.find(r => r.fixture_id === fid && r.book_id === MODEL_BOOK_ID);
    const proj = verifyProj.find(r => r.fixture_id === fid);
    const fix = verifyFix.find(r => r.fixture_id === fid);
    const bookCnt = Number(bookRows?.cnt ?? 0);
    const modelCnt = Number(modelRows?.cnt ?? 0);
    const homeOk = fix?.home_team_id === f.correctHomeId;
    const awayOk = fix?.away_team_id === f.correctAwayId;
    const projTotal = Number(proj?.proj_total);
    const projRound = projTotal === 2.5 || projTotal === 3.5;
    const ok = bookCnt === 12 && modelCnt === 12 && homeOk && awayOk && !projRound;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${fid} | book=${bookCnt}/12 model=${modelCnt}/12 home=${fix?.home_team_id}(${homeOk ? '✅' : '❌'}) away=${fix?.away_team_id}(${awayOk ? '✅' : '❌'}) projTotal=${projTotal}(${projRound ? '⚠️ROUND' : '✅'})`);
  }

  console.log(`\n${TAG} [VERIFY] ${allOk ? '✅ ALL PASS' : '❌ FAILURES DETECTED'}`);
  console.log(`${TAG} [OUTPUT] Total book rows=${totalBookRows} model rows=${totalModelRows}`);
  await conn.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(e => {
  console.error(`${TAG} FAIL: ${e.message}`);
  process.exit(1);
});
