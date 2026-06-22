/**
 * modelJune22Final.mjs
 *
 * June 22, 2026 WC2026 Model — v3 Champion Parameters
 * Champion: v3:Pass1_Baseline — Best 2026 performer
 *   2026 accuracy: ML=55.0% Draw=45.0% DC=90.0% Total=65.0%
 *   params: eloK=0.70, rankK=0.30, homeAdv=1.08, rho=-0.13, baseGoals=2.65, drawFloor=0.22
 *
 * Fixtures (June 22, 2026 PST):
 *   wc26-g-043: Austria (H) vs Argentina (A)  — 10:00 AM PST
 *   wc26-g-041: Iraq (H) vs France (A)        — 2:00 PM PST
 *   wc26-g-042: Norway (H) vs Senegal (A)     — 5:00 PM PST
 *   wc26-g-044: Algeria (H) vs Jordan (A)     — 8:00 PM PST
 *
 * LOGGING: [MODEL_J22F] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';

const TAG = '[MODEL_J22F]';
const N_SIM = 1_000_000;
const MODEL_VERSION = 'v3-champion-2026';

// ── Champion Parameters ───────────────────────────────────────────────────
const P = { eloK: 0.70, rankK: 0.30, homeAdv: 1.08, rho: -0.13, baseGoals: 2.65, drawFloor: 0.22 };

// ── Elo Ratings (2026 pre-tournament) ─────────────────────────────────────
const ELO = { aut: 1840, arg: 2142, irq: 1620, fra: 2005, nor: 1880, sen: 1747, alg: 1748, jor: 1640 };

// ── FIFA Rankings (2026 pre-tournament) ───────────────────────────────────
const RANK = { aut: 32, arg: 1, irq: 58, fra: 2, nor: 19, sen: 20, alg: 34, jor: 75 };

// ── June 22 Fixtures ──────────────────────────────────────────────────────
const FIXTURES = [
  { id: 'wc26-g-043', home: 'aut', away: 'arg', homeName: 'Austria', awayName: 'Argentina', kickoffPST: '10:00 AM PST' },
  { id: 'wc26-g-041', home: 'irq', away: 'fra', homeName: 'Iraq', awayName: 'France', kickoffPST: '2:00 PM PST' },
  { id: 'wc26-g-042', home: 'nor', away: 'sen', homeName: 'Norway', awayName: 'Senegal', kickoffPST: '5:00 PM PST' },
  { id: 'wc26-g-044', home: 'alg', away: 'jor', homeName: 'Algeria', awayName: 'Jordan', kickoffPST: '8:00 PM PST' },
];

// ── Math helpers ──────────────────────────────────────────────────────────
function probToAmerican(p) {
  if (p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}
function fmt(n) { return n === null ? 'N/A' : n > 0 ? `+${n}` : `${n}`; }

function tau(x, y, mu, nu, rho) {
  if (x === 0 && y === 0) return 1 - mu * nu * rho;
  if (x === 0 && y === 1) return 1 + mu * rho;
  if (x === 1 && y === 0) return 1 + nu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = k * Math.log(lambda) - lambda;
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}
function buildMatrix(lH, lA, rho, max = 10) {
  const m = [];
  for (let h = 0; h <= max; h++) {
    m[h] = [];
    for (let a = 0; a <= max; a++) {
      m[h][a] = Math.max(0, poissonPMF(h, lH) * poissonPMF(a, lA) * tau(h, a, lH, lA, rho));
    }
  }
  return m;
}

function simulate(lH, lA, rho) {
  const N = N_SIM, max = 10;
  const matrix = buildMatrix(lH, lA, rho, max);
  const cdf = [], scores = [];
  let cumP = 0;
  for (let h = 0; h <= max; h++) for (let a = 0; a <= max; a++) { cumP += matrix[h][a]; cdf.push(cumP); scores.push([h, a]); }
  for (let i = 0; i < cdf.length; i++) cdf[i] /= cumP;

  let hw = 0, d = 0, aw = 0, ou05 = 0, ou15 = 0, ou25 = 0, ou35 = 0, ou45 = 0, btts = 0;
  let totalGoals = 0;
  const sc = {};
  const hGoals = new Array(max + 1).fill(0);
  const aGoals = new Array(max + 1).fill(0);

  for (let i = 0; i < N; i++) {
    const r = Math.random();
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
    const [h, a] = scores[lo];
    const g = h + a;
    if (h > a) hw++; else if (h < a) aw++; else d++;
    if (g > 0.5) ou05++; if (g > 1.5) ou15++; if (g > 2.5) ou25++; if (g > 3.5) ou35++; if (g > 4.5) ou45++;
    if (h > 0 && a > 0) btts++;
    totalGoals += g;
    hGoals[h]++; aGoals[a]++;
    const key = `${h}-${a}`; sc[key] = (sc[key] || 0) + 1;
  }

  const pH = hw / N, pD = d / N, pA = aw / N;
  const topScores = Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const hDist = hGoals.map((c, i) => ({ goals: i, prob: (c / N * 100).toFixed(2) })).filter(x => parseFloat(x.prob) > 0.1);
  const aDist = aGoals.map((c, i) => ({ goals: i, prob: (c / N * 100).toFixed(2) })).filter(x => parseFloat(x.prob) > 0.1);

  return {
    pH, pD, pA,
    pO05: ou05 / N, pO15: ou15 / N, pO25: ou25 / N, pO35: ou35 / N, pO45: ou45 / N,
    pU05: 1 - ou05 / N, pU15: 1 - ou15 / N, pU25: 1 - ou25 / N, pU35: 1 - ou35 / N,
    btts: btts / N,
    avgGoals: totalGoals / N,
    topScores,
    hDist, aDist,
  };
}

function computeLambdas(homeId, awayId) {
  const eloH = ELO[homeId], eloA = ELO[awayId];
  const rankH = RANK[homeId], rankA = RANK[awayId];
  const eloDiff = (eloH - eloA) / 400;
  const eloRatio = Math.pow(10, eloDiff * P.eloK);
  const rankDiff = Math.log((rankA + 1) / (rankH + 1)) * P.rankK;
  const rankRatio = Math.exp(rankDiff);
  const sr = eloRatio * rankRatio;
  const lH = Math.max(0.15, (P.baseGoals * sr / (1 + sr)) * P.homeAdv);
  const lA = Math.max(0.15, (P.baseGoals / (1 + sr)) / P.homeAdv);
  return { lH, lA, eloH, eloA, rankH, rankA, eloDiff: eloH - eloA, sr };
}

// Implied prob from American odds
function impliedProb(odds) {
  if (!odds) return null;
  return odds < 0 ? (-odds / (-odds + 100)) : (100 / (odds + 100));
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} June 22, 2026 WC2026 Model — v3 Champion`);
  console.log(`${TAG} params: eloK=${P.eloK} rankK=${P.rankK} homeAdv=${P.homeAdv} rho=${P.rho} bg=${P.baseGoals} drawFloor=${P.drawFloor}`);
  console.log(`${TAG} N=${N_SIM.toLocaleString()} Monte Carlo | 4 fixtures | 9 markets`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Verify fixtures
  const [fixtureCheck] = await conn.execute(`
    SELECT fixture_id, status FROM wc2026_fixtures
    WHERE fixture_id IN ('wc26-g-043','wc26-g-041','wc26-g-042','wc26-g-044')
    ORDER BY kickoff_utc
  `);
  console.log(`${TAG} [VERIFY] DB fixtures: ${fixtureCheck.map(r => `${r.fixture_id}(${r.status})`).join(', ')}`);
  if (fixtureCheck.length !== 4) { console.error(`${TAG} [FATAL] Expected 4 fixtures, got ${fixtureCheck.length}`); process.exit(1); }

  // Load DK odds (book_id=68) — column is 'line' not 'over_under_line'
  const [dkOdds] = await conn.execute(`
    SELECT fixture_id, market, selection, american_odds, line
    FROM wc2026_odds_snapshots
    WHERE fixture_id IN ('wc26-g-043','wc26-g-041','wc26-g-042','wc26-g-044')
    AND book_id = 68
    ORDER BY fixture_id, market, selection
  `);
  const dkMap = {};
  for (const row of dkOdds) {
    const key = `${row.fixture_id}:${row.market}:${row.selection}`;
    dkMap[key] = { odds: row.american_odds, line: row.line };
  }
  console.log(`${TAG} [INPUT] DK odds loaded: ${dkOdds.length} rows`);

  const projections = [];

  for (const fix of FIXTURES) {
    console.log(`\n${TAG} ${'─'.repeat(60)}`);
    console.log(`${TAG} [STEP] ${fix.homeName} (H) vs ${fix.awayName} (A) — ${fix.id} — ${fix.kickoffPST}`);

    const { lH, lA, eloH, eloA, rankH, rankA, eloDiff, sr } = computeLambdas(fix.home, fix.away);
    console.log(`${TAG} [INPUT] ${fix.home.toUpperCase()} Elo=${eloH} Rank=${rankH} | ${fix.away.toUpperCase()} Elo=${eloA} Rank=${rankA}`);
    console.log(`${TAG} [STATE] ΔElo=${eloDiff} | strengthRatio=${sr.toFixed(4)} | λH=${lH.toFixed(4)} λA=${lA.toFixed(4)}`);

    const sim = simulate(lH, lA, P.rho);

    // Apply draw floor
    let { pH, pD, pA } = sim;
    if (pD < P.drawFloor) {
      const deficit = P.drawFloor - pD;
      pD = P.drawFloor;
      const hs = pH / (pH + pA);
      pH -= deficit * hs; pA -= deficit * (1 - hs);
    }
    const s = pH + pD + pA;
    pH /= s; pD /= s; pA /= s;

    // No-vig American odds
    const mlH = probToAmerican(pH);
    const mlD = probToAmerican(pD);
    const mlA = probToAmerican(pA);
    const dc1X = probToAmerican(pH + pD);
    const dcX2 = probToAmerican(pD + pA);
    const ou05O = probToAmerican(sim.pO05), ou05U = probToAmerican(sim.pU05);
    const ou15O = probToAmerican(sim.pO15), ou15U = probToAmerican(sim.pU15);
    const ou25O = probToAmerican(sim.pO25), ou25U = probToAmerican(sim.pU25);
    const ou35O = probToAmerican(sim.pO35), ou35U = probToAmerican(sim.pU35);

    // DK book odds
    const dkH = dkMap[`${fix.id}:MONEYLINE:HOME`]?.odds ?? null;
    const dkD = dkMap[`${fix.id}:MONEYLINE:DRAW`]?.odds ?? null;
    const dkA = dkMap[`${fix.id}:MONEYLINE:AWAY`]?.odds ?? null;
    const dkO25 = dkMap[`${fix.id}:TOTAL:OVER`]?.odds ?? null;
    const dkU25 = dkMap[`${fix.id}:TOTAL:UNDER`]?.odds ?? null;

    // Edge = model prob - book implied prob (pp)
    const edgeH = dkH ? ((pH - impliedProb(dkH)) * 100).toFixed(2) : null;
    const edgeD = dkD ? ((pD - impliedProb(dkD)) * 100).toFixed(2) : null;
    const edgeA = dkA ? ((pA - impliedProb(dkA)) * 100).toFixed(2) : null;
    const edgeO25 = dkO25 ? ((sim.pO25 - impliedProb(dkO25)) * 100).toFixed(2) : null;
    const edgeU25 = dkU25 ? ((sim.pU25 - impliedProb(dkU25)) * 100).toFixed(2) : null;

    // Determine model lean
    const leanMap = { H: fix.homeName, D: 'Draw', A: fix.awayName };
    const modelLean = pH >= pD && pH >= pA ? 'H' : pA >= pD ? 'A' : 'D';
    const leanProb = modelLean === 'H' ? pH : modelLean === 'A' ? pA : pD;

    // Projected scores
    const projHomeScore = lH;
    const projAwayScore = lA;
    const projTotal = sim.avgGoals;
    const projSpread = -(lH - lA);

    // Top scorelines JSON
    const topScorelines = JSON.stringify(sim.topScores.map(([sc, cnt]) => ({
      score: sc, prob: (cnt / N_SIM * 100).toFixed(2)
    })));
    const hGoalDist = JSON.stringify(sim.hDist);
    const aGoalDist = JSON.stringify(sim.aDist);

    // Logging
    console.log(`${TAG} [OUTPUT] 1X2:`);
    console.log(`${TAG}   H (${fix.homeName}): ${(pH*100).toFixed(2)}% → ${fmt(mlH)} | DK: ${fmt(dkH)} | Edge: ${edgeH !== null ? edgeH+'pp' : 'N/A'}`);
    console.log(`${TAG}   D (Draw):            ${(pD*100).toFixed(2)}% → ${fmt(mlD)} | DK: ${fmt(dkD)} | Edge: ${edgeD !== null ? edgeD+'pp' : 'N/A'}`);
    console.log(`${TAG}   A (${fix.awayName}): ${(pA*100).toFixed(2)}% → ${fmt(mlA)} | DK: ${fmt(dkA)} | Edge: ${edgeA !== null ? edgeA+'pp' : 'N/A'}`);
    console.log(`${TAG} [OUTPUT] DC: 1X=${fmt(dc1X)} (${((pH+pD)*100).toFixed(1)}%) | X2=${fmt(dcX2)} (${((pD+pA)*100).toFixed(1)}%)`);
    console.log(`${TAG} [OUTPUT] Totals:`);
    console.log(`${TAG}   O/U 0.5: O=${fmt(ou05O)} (${(sim.pO05*100).toFixed(1)}%) U=${fmt(ou05U)}`);
    console.log(`${TAG}   O/U 1.5: O=${fmt(ou15O)} (${(sim.pO15*100).toFixed(1)}%) U=${fmt(ou15U)}`);
    console.log(`${TAG}   O/U 2.5: O=${fmt(ou25O)} (${(sim.pO25*100).toFixed(1)}%) U=${fmt(ou25U)} | DK O=${fmt(dkO25)} U=${fmt(dkU25)} | Edge O=${edgeO25 !== null ? edgeO25+'pp' : 'N/A'} U=${edgeU25 !== null ? edgeU25+'pp' : 'N/A'}`);
    console.log(`${TAG}   O/U 3.5: O=${fmt(ou35O)} (${(sim.pO35*100).toFixed(1)}%) U=${fmt(ou35U)}`);
    console.log(`${TAG} [OUTPUT] BTTS: ${(sim.btts*100).toFixed(1)}% | AvgGoals: ${projTotal.toFixed(3)}`);
    console.log(`${TAG} [OUTPUT] Lean: ${leanMap[modelLean]} (${(leanProb*100).toFixed(1)}%)`);
    console.log(`${TAG} [OUTPUT] Top 5 Scores: ${sim.topScores.map(([s,c]) => `${s}(${(c/N_SIM*100).toFixed(2)}%)`).join(' | ')}`);

    projections.push({
      fix, lH, lA, pH, pD, pA,
      mlH, mlD, mlA, dc1X, dcX2,
      ou05O, ou05U, ou15O, ou15U, ou25O, ou25U, ou35O, ou35U,
      sim, projHomeScore, projAwayScore, projTotal, projSpread,
      edgeH, edgeD, edgeA, edgeO25, edgeU25,
      dkH, dkD, dkA, dkO25, dkU25,
      modelLean, leanProb,
      topScorelines, hGoalDist, aGoalDist,
    });
  }

  // ── Upsert into wc2026_model_projections ─────────────────────────────────
  console.log(`\n${TAG} ${'─'.repeat(60)}`);
  console.log(`${TAG} [STEP] Upserting 4 projections into wc2026_model_projections`);

  let upserted = 0;
  for (const p of projections) {
    const { fix } = p;
    try {
      await conn.execute(`
        INSERT INTO wc2026_model_projections (
          fixture_id, model_version, n_simulations,
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
          top_scorelines, home_goal_dist, away_goal_dist,
          modeled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          model_version=VALUES(model_version), n_simulations=VALUES(n_simulations),
          home_lambda=VALUES(home_lambda), away_lambda=VALUES(away_lambda),
          home_win_prob=VALUES(home_win_prob), draw_prob=VALUES(draw_prob), away_win_prob=VALUES(away_win_prob),
          proj_home_score=VALUES(proj_home_score), proj_away_score=VALUES(proj_away_score), proj_total=VALUES(proj_total),
          over_0_5=VALUES(over_0_5), over_1_5=VALUES(over_1_5), over_2_5=VALUES(over_2_5), under_2_5=VALUES(under_2_5),
          over_3_5=VALUES(over_3_5), over_4_5=VALUES(over_4_5), btts_prob=VALUES(btts_prob),
          model_home_ml=VALUES(model_home_ml), model_draw_ml=VALUES(model_draw_ml), model_away_ml=VALUES(model_away_ml),
          model_total=VALUES(model_total), over_odds=VALUES(over_odds), under_odds=VALUES(under_odds),
          nv_home_prob=VALUES(nv_home_prob), nv_draw_prob=VALUES(nv_draw_prob), nv_away_prob=VALUES(nv_away_prob),
          home_edge=VALUES(home_edge), draw_edge=VALUES(draw_edge), away_edge=VALUES(away_edge),
          model_lean=VALUES(model_lean), lean_prob=VALUES(lean_prob),
          top_scorelines=VALUES(top_scorelines), home_goal_dist=VALUES(home_goal_dist), away_goal_dist=VALUES(away_goal_dist),
          modeled_at=NOW()
      `, [
        fix.id, MODEL_VERSION, N_SIM,
        fix.home, fix.away,
        p.lH, p.lA,
        p.pH, p.pD, p.pA,
        p.projHomeScore, p.projAwayScore, p.projTotal,
        p.sim.pO05, p.sim.pO15, p.sim.pO25, p.sim.pU25, p.sim.pO35, p.sim.pO45,
        p.sim.btts,
        p.mlH, p.mlD, p.mlA,
        2.5, p.ou25O, p.ou25U,
        p.pH, p.pD, p.pA,
        p.edgeH ? parseFloat(p.edgeH) : null,
        p.edgeD ? parseFloat(p.edgeD) : null,
        p.edgeA ? parseFloat(p.edgeA) : null,
        p.modelLean, p.leanProb,
        p.topScorelines, p.hGoalDist, p.aGoalDist,
      ]);
      upserted++;
      console.log(`${TAG} [STATE] ✅ Upserted ${fix.id} (${fix.homeName} vs ${fix.awayName})`);
    } catch (err) {
      console.error(`${TAG} [ERROR] Failed ${fix.id}: ${err.message}`);
    }
  }

  await conn.end();

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} [VERIFY] Upserted ${upserted}/4 projections ${upserted === 4 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`\n${TAG} ╔${'═'.repeat(70)}╗`);
  console.log(`${TAG} ║  JUNE 22, 2026 WC2026 — SHARP ORIGINATED LINES (v3 Champion)        ║`);
  console.log(`${TAG} ╠${'═'.repeat(70)}╣`);
  for (const p of projections) {
    const { fix } = p;
    console.log(`${TAG} ║  ${fix.homeName} vs ${fix.awayName} — ${fix.kickoffPST}`);
    console.log(`${TAG} ║    Proj Score: ${p.lH.toFixed(2)}-${p.lA.toFixed(2)} | AvgGoals: ${p.projTotal.toFixed(2)} | Spread: ${p.projSpread > 0 ? '+' : ''}${p.projSpread.toFixed(2)}`);
    console.log(`${TAG} ║    1X2:  H=${fmt(p.mlH)} (${(p.pH*100).toFixed(1)}%)  D=${fmt(p.mlD)} (${(p.pD*100).toFixed(1)}%)  A=${fmt(p.mlA)} (${(p.pA*100).toFixed(1)}%)`);
    console.log(`${TAG} ║    DC:   1X=${fmt(p.dc1X)} (${((p.pH+p.pD)*100).toFixed(1)}%)  X2=${fmt(p.dcX2)} (${((p.pD+p.pA)*100).toFixed(1)}%)`);
    console.log(`${TAG} ║    O/U 0.5: O=${fmt(p.ou05O)} U=${fmt(p.ou05U)}  |  O/U 1.5: O=${fmt(p.ou15O)} U=${fmt(p.ou15U)}`);
    console.log(`${TAG} ║    O/U 2.5: O=${fmt(p.ou25O)} U=${fmt(p.ou25U)}  |  O/U 3.5: O=${fmt(p.ou35O)} U=${fmt(p.ou35U)}`);
    console.log(`${TAG} ║    BTTS: ${(p.sim.btts*100).toFixed(1)}% | Lean: ${p.modelLean === 'H' ? fix.homeName : p.modelLean === 'A' ? fix.awayName : 'Draw'} (${(p.leanProb*100).toFixed(1)}%)`);
    console.log(`${TAG} ║    Top Score: ${p.sim.topScores[0][0]} (${(p.sim.topScores[0][1]/N_SIM*100).toFixed(2)}%)`);
    if (p.dkH !== null) {
      console.log(`${TAG} ║    DK Book: H=${fmt(p.dkH)} D=${fmt(p.dkD)} A=${fmt(p.dkA)} | O2.5=${fmt(p.dkO25)} U2.5=${fmt(p.dkU25)}`);
      console.log(`${TAG} ║    Edges:   H=${p.edgeH}pp D=${p.edgeD}pp A=${p.edgeA}pp | O2.5=${p.edgeO25}pp U2.5=${p.edgeU25}pp`);
    }
    console.log(`${TAG} ╠${'═'.repeat(70)}╣`);
  }
  console.log(`${TAG} ╚${'═'.repeat(70)}╝`);
  console.log(`${TAG} Done.`);
  process.exit(0);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});
