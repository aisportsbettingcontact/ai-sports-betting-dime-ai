/**
 * modelJune22WC2026.mjs
 *
 * June 22, 2026 WC2026 Model — v3 Champion Parameters
 *
 * Champion: v3:Pass1_Baseline
 *   2026 accuracy: ML=55.0% Draw=45.0% DC=90.0% Total=65.0%
 *   params: eloK=0.70, rankK=0.30, homeAdv=1.08, rho=-0.13, baseGoals=2.65, drawFloor=0.22
 *
 * Fixtures (June 22, 2026 PST):
 *   wc26-g-043: Austria (H) vs Argentina (A)  — 10:00 AM PST
 *   wc26-g-041: Iraq (H) vs France (A)        — 2:00 PM PST
 *   wc26-g-042: Norway (H) vs Senegal (A)     — 5:00 PM PST
 *   wc26-g-044: Algeria (H) vs Jordan (A)     — 8:00 PM PST
 *
 * Markets computed:
 *   1X2 (Home ML, Draw, Away ML)
 *   Double Chance (1X, X2)
 *   O/U 0.5, O/U 1.5, O/U 2.5, O/U 3.5
 *   Correct Score (top predicted score)
 *
 * All probabilities converted to no-vig American odds (sharp originated lines).
 *
 * LOGGING: [MODEL_J22] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';

const TAG = '[MODEL_J22]';
const N_SIM = 1_000_000;

// ── Champion Parameters (v3:Pass1_Baseline — best 2026 performer) ─────────
const PARAMS = {
  eloK: 0.70,
  rankK: 0.30,
  homeAdv: 1.08,
  rho: -0.13,
  baseGoals: 2.65,
  drawFloor: 0.22,
};

// ── Elo Ratings (pre-tournament 2026) ─────────────────────────────────────
const ELO = {
  aut: 1840, arg: 2142,
  irq: 1620, fra: 2005,
  nor: 1880, sen: 1747,
  alg: 1748, jor: 1640,
};

// ── FIFA Rankings (2026 pre-tournament) ───────────────────────────────────
const FIFA_RANK = {
  aut: 32, arg: 1,
  irq: 58, fra: 2,
  nor: 19, sen: 20,
  alg: 34, jor: 75,
};

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
function formatAmerican(n) {
  if (n === null) return 'N/A';
  return n > 0 ? `+${n}` : `${n}`;
}
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
function buildScoreMatrix(lambdaH, lambdaA, rho, maxGoals = 10) {
  const m = [];
  for (let h = 0; h <= maxGoals; h++) {
    m[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      m[h][a] = Math.max(0, poissonPMF(h, lambdaH) * poissonPMF(a, lambdaA) * tau(h, a, lambdaH, lambdaA, rho));
    }
  }
  return m;
}

function runMonteCarlo(lambdaH, lambdaA, rho) {
  const N = N_SIM;
  const maxGoals = 10;
  const matrix = buildScoreMatrix(lambdaH, lambdaA, rho, maxGoals);
  const cdf = [], scores = [];
  let cumP = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      cumP += matrix[h][a]; cdf.push(cumP); scores.push([h, a]);
    }
  }
  const total = cumP;
  for (let i = 0; i < cdf.length; i++) cdf[i] /= total;

  let hw = 0, d = 0, aw = 0, ou05 = 0, ou15 = 0, ou25 = 0, ou35 = 0;
  const sc = {};
  for (let i = 0; i < N; i++) {
    const r = Math.random();
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
    const [h, a] = scores[lo];
    const g = h + a;
    if (h > a) hw++; else if (h < a) aw++; else d++;
    if (g > 0.5) ou05++; if (g > 1.5) ou15++; if (g > 2.5) ou25++; if (g > 3.5) ou35++;
    const key = `${h}-${a}`; sc[key] = (sc[key] || 0) + 1;
  }

  const pH = hw / N, pD = d / N, pA = aw / N;
  const topScores = Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    pH, pD, pA,
    pO05: ou05 / N, pO15: ou15 / N, pO25: ou25 / N, pO35: ou35 / N,
    pU05: 1 - ou05 / N, pU15: 1 - ou15 / N, pU25: 1 - ou25 / N, pU35: 1 - ou35 / N,
    topScores,
  };
}

function computeLambdas(homeId, awayId) {
  const eloH = ELO[homeId], eloA = ELO[awayId];
  const rankH = FIFA_RANK[homeId], rankA = FIFA_RANK[awayId];
  const { eloK, rankK, homeAdv, baseGoals } = PARAMS;

  const eloDiff = (eloH - eloA) / 400;
  const eloRatio = Math.pow(10, eloDiff * eloK);
  const rankDiff = Math.log((rankA + 1) / (rankH + 1)) * rankK;
  const rankRatio = Math.exp(rankDiff);
  const strengthRatio = eloRatio * rankRatio;

  const lambdaH = Math.max(0.15, (baseGoals * strengthRatio / (1 + strengthRatio)) * homeAdv);
  const lambdaA = Math.max(0.15, (baseGoals / (1 + strengthRatio)) / homeAdv);

  return { lambdaH, lambdaA, eloH, eloA, rankH, rankA, eloDiff: eloH - eloA, strengthRatio };
}

async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} June 22, 2026 WC2026 Model — v3 Champion (eloK=0.70 rankK=0.30 homeAdv=1.08 rho=-0.13 bg=2.65)`);
  console.log(`${TAG} N=${N_SIM.toLocaleString()} Monte Carlo | 4 fixtures | 9 markets each`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Verify fixtures exist and are SCHEDULED
  const [fixtureCheck] = await conn.execute(`
    SELECT fixture_id, status FROM wc2026_fixtures
    WHERE fixture_id IN ('wc26-g-043','wc26-g-041','wc26-g-042','wc26-g-044')
    ORDER BY kickoff_utc
  `);
  console.log(`${TAG} [VERIFY] DB fixtures: ${fixtureCheck.map(r => `${r.fixture_id}(${r.status})`).join(', ')}`);

  // Load existing DK odds for edge comparison
  const [dkOdds] = await conn.execute(`
    SELECT fixture_id, market, selection, american_odds, over_under_line
    FROM wc2026_odds_snapshots
    WHERE fixture_id IN ('wc26-g-043','wc26-g-041','wc26-g-042','wc26-g-044')
    AND book_id = 68
    ORDER BY fixture_id, market, selection
  `);
  const dkMap = {};
  for (const row of dkOdds) {
    const key = `${row.fixture_id}:${row.market}:${row.selection}`;
    dkMap[key] = row.american_odds;
  }
  console.log(`${TAG} [INPUT] DK odds loaded: ${dkOdds.length} rows`);

  const projections = [];

  for (const fix of FIXTURES) {
    console.log(`\n${TAG} ${'─'.repeat(60)}`);
    console.log(`${TAG} [STEP] ${fix.homeName} vs ${fix.awayName} (${fix.id}) — ${fix.kickoffPST}`);

    const { lambdaH, lambdaA, eloH, eloA, rankH, rankA, eloDiff, strengthRatio } = computeLambdas(fix.home, fix.away);

    console.log(`${TAG} [INPUT] ${fix.home.toUpperCase()} Elo=${eloH} Rank=${rankH} | ${fix.away.toUpperCase()} Elo=${eloA} Rank=${rankA}`);
    console.log(`${TAG} [STATE] ΔElo=${eloDiff} | strengthRatio=${strengthRatio.toFixed(4)} | λH=${lambdaH.toFixed(4)} λA=${lambdaA.toFixed(4)}`);

    const sim = runMonteCarlo(lambdaH, lambdaA, PARAMS.rho);

    // Apply draw floor
    let { pH, pD, pA } = sim;
    if (pD < PARAMS.drawFloor) {
      const deficit = PARAMS.drawFloor - pD;
      pD = PARAMS.drawFloor;
      const hs = pH / (pH + pA);
      pH -= deficit * hs; pA -= deficit * (1 - hs);
    }
    const s = pH + pD + pA;
    pH /= s; pD /= s; pA /= s;

    const p1X = pH + pD, pX2 = pD + pA;

    // Sharp originated lines (no-vig)
    const mlH = probToAmerican(pH);
    const mlD = probToAmerican(pD);
    const mlA = probToAmerican(pA);
    const dc1X = probToAmerican(p1X);
    const dcX2 = probToAmerican(pX2);
    const ou05Over = probToAmerican(sim.pO05);
    const ou15Over = probToAmerican(sim.pO15);
    const ou25Over = probToAmerican(sim.pO25);
    const ou35Over = probToAmerican(sim.pO35);
    const ou05Under = probToAmerican(sim.pU05);
    const ou15Under = probToAmerican(sim.pU15);
    const ou25Under = probToAmerican(sim.pU25);
    const ou35Under = probToAmerican(sim.pU35);

    // DK book odds for edge calculation
    const dkH = dkMap[`${fix.id}:MONEYLINE:HOME`] ?? null;
    const dkD = dkMap[`${fix.id}:MONEYLINE:DRAW`] ?? null;
    const dkA = dkMap[`${fix.id}:MONEYLINE:AWAY`] ?? null;
    const dkO25 = dkMap[`${fix.id}:TOTAL:OVER`] ?? null;
    const dkU25 = dkMap[`${fix.id}:TOTAL:UNDER`] ?? null;

    // Edge = model prob - book implied prob (positive = model sees more value)
    function edgePp(modelOdds, bookOdds) {
      if (!modelOdds || !bookOdds) return null;
      const modelP = modelOdds < 0 ? (-modelOdds / (-modelOdds + 100)) : (100 / (modelOdds + 100));
      const bookP = bookOdds < 0 ? (-bookOdds / (-bookOdds + 100)) : (100 / (bookOdds + 100));
      return ((modelP - bookP) * 100).toFixed(2);
    }

    const edgeH = edgePp(mlH, dkH);
    const edgeD = edgePp(mlD, dkD);
    const edgeA = edgePp(mlA, dkA);
    const edgeO25 = edgePp(ou25Over, dkO25);
    const edgeU25 = edgePp(ou25Under, dkU25);

    console.log(`${TAG} [OUTPUT] 1X2 Probabilities:`);
    console.log(`${TAG}   Home (${fix.homeName}): ${(pH * 100).toFixed(2)}% → ${formatAmerican(mlH)} | DK: ${formatAmerican(dkH)} | Edge: ${edgeH !== null ? edgeH + 'pp' : 'N/A'}`);
    console.log(`${TAG}   Draw:                  ${(pD * 100).toFixed(2)}% → ${formatAmerican(mlD)} | DK: ${formatAmerican(dkD)} | Edge: ${edgeD !== null ? edgeD + 'pp' : 'N/A'}`);
    console.log(`${TAG}   Away (${fix.awayName}): ${(pA * 100).toFixed(2)}% → ${formatAmerican(mlA)} | DK: ${formatAmerican(dkA)} | Edge: ${edgeA !== null ? edgeA + 'pp' : 'N/A'}`);
    console.log(`${TAG} [OUTPUT] Double Chance:`);
    console.log(`${TAG}   1X (${fix.homeName}/Draw): ${(p1X * 100).toFixed(2)}% → ${formatAmerican(dc1X)}`);
    console.log(`${TAG}   X2 (Draw/${fix.awayName}): ${(pX2 * 100).toFixed(2)}% → ${formatAmerican(dcX2)}`);
    console.log(`${TAG} [OUTPUT] Totals:`);
    console.log(`${TAG}   O/U 0.5: Over=${formatAmerican(ou05Over)} Under=${formatAmerican(ou05Under)} (pO=${(sim.pO05*100).toFixed(1)}%)`);
    console.log(`${TAG}   O/U 1.5: Over=${formatAmerican(ou15Over)} Under=${formatAmerican(ou15Under)} (pO=${(sim.pO15*100).toFixed(1)}%)`);
    console.log(`${TAG}   O/U 2.5: Over=${formatAmerican(ou25Over)} Under=${formatAmerican(ou25Under)} (pO=${(sim.pO25*100).toFixed(1)}%) | DK O: ${formatAmerican(dkO25)} U: ${formatAmerican(dkU25)} | Edge O: ${edgeO25 !== null ? edgeO25 + 'pp' : 'N/A'} U: ${edgeU25 !== null ? edgeU25 + 'pp' : 'N/A'}`);
    console.log(`${TAG}   O/U 3.5: Over=${formatAmerican(ou35Over)} Under=${formatAmerican(ou35Under)} (pO=${(sim.pO35*100).toFixed(1)}%)`);
    console.log(`${TAG} [OUTPUT] Top 5 Correct Scores:`);
    sim.topScores.forEach(([score, count], i) => {
      console.log(`${TAG}   #${i + 1}: ${score} (${(count / N_SIM * 100).toFixed(2)}%)`);
    });

    projections.push({
      fixture_id: fix.id,
      home: fix.home, away: fix.away,
      homeName: fix.homeName, awayName: fix.awayName,
      kickoffPST: fix.kickoffPST,
      lambdaH, lambdaA,
      pH, pD, pA, p1X, pX2,
      pO05: sim.pO05, pO15: sim.pO15, pO25: sim.pO25, pO35: sim.pO35,
      pU05: sim.pU05, pU15: sim.pU15, pU25: sim.pU25, pU35: sim.pU35,
      mlH, mlD, mlA, dc1X, dcX2,
      ou05Over, ou15Over, ou25Over, ou35Over,
      ou05Under, ou15Under, ou25Under, ou35Under,
      topScore: sim.topScores[0][0],
      topScores: sim.topScores.map(([s, c]) => ({ score: s, pct: (c / N_SIM * 100).toFixed(2) })),
      edgeH, edgeD, edgeA, edgeO25, edgeU25,
      dkH, dkD, dkA, dkO25, dkU25,
    });
  }

  // ── Upsert into wc2026_model_projections ─────────────────────────────────
  console.log(`\n${TAG} ${'─'.repeat(60)}`);
  console.log(`${TAG} [STEP] Upserting model projections into wc2026_model_projections`);

  // Check table columns first
  const [cols] = await conn.execute(`SHOW COLUMNS FROM wc2026_model_projections`);
  const colNames = cols.map(c => c.Field);
  console.log(`${TAG} [STATE] Table columns: ${colNames.join(', ')}`);

  let upserted = 0;
  for (const p of projections) {
    try {
      await conn.execute(`
        INSERT INTO wc2026_model_projections
          (fixture_id, model_version, prob_home, prob_draw, prob_away,
           prob_1x, prob_x2,
           prob_over_05, prob_over_15, prob_over_25, prob_over_35,
           prob_under_05, prob_under_15, prob_under_25, prob_under_35,
           ml_home, ml_draw, ml_away, dc_1x, dc_x2,
           ou05_over, ou15_over, ou25_over, ou35_over,
           ou05_under, ou15_under, ou25_under, ou35_under,
           top_score, lambda_home, lambda_away, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          model_version=VALUES(model_version),
          prob_home=VALUES(prob_home), prob_draw=VALUES(prob_draw), prob_away=VALUES(prob_away),
          prob_1x=VALUES(prob_1x), prob_x2=VALUES(prob_x2),
          prob_over_05=VALUES(prob_over_05), prob_over_15=VALUES(prob_over_15),
          prob_over_25=VALUES(prob_over_25), prob_over_35=VALUES(prob_over_35),
          prob_under_05=VALUES(prob_under_05), prob_under_15=VALUES(prob_under_15),
          prob_under_25=VALUES(prob_under_25), prob_under_35=VALUES(prob_under_35),
          ml_home=VALUES(ml_home), ml_draw=VALUES(ml_draw), ml_away=VALUES(ml_away),
          dc_1x=VALUES(dc_1x), dc_x2=VALUES(dc_x2),
          ou05_over=VALUES(ou05_over), ou15_over=VALUES(ou15_over),
          ou25_over=VALUES(ou25_over), ou35_over=VALUES(ou35_over),
          ou05_under=VALUES(ou05_under), ou15_under=VALUES(ou15_under),
          ou25_under=VALUES(ou25_under), ou35_under=VALUES(ou35_under),
          top_score=VALUES(top_score), lambda_home=VALUES(lambda_home), lambda_away=VALUES(lambda_away),
          created_at=NOW()
      `, [
        p.fixture_id, 'v3-champion-2026',
        p.pH, p.pD, p.pA, p.p1X, p.pX2,
        p.pO05, p.pO15, p.pO25, p.pO35,
        p.pU05, p.pU15, p.pU25, p.pU35,
        p.mlH, p.mlD, p.mlA, p.dc1X, p.dcX2,
        p.ou05Over, p.ou15Over, p.ou25Over, p.ou35Over,
        p.ou05Under, p.ou15Under, p.ou25Under, p.ou35Under,
        p.topScore, p.lambdaH, p.lambdaA,
      ]);
      upserted++;
      console.log(`${TAG} [STATE] Upserted ${p.fixture_id} (${p.homeName} vs ${p.awayName}) ✅`);
    } catch (err) {
      console.error(`${TAG} [ERROR] Failed to upsert ${p.fixture_id}: ${err.message}`);
      // Try with fewer columns if schema mismatch
      try {
        await conn.execute(`
          INSERT INTO wc2026_model_projections
            (fixture_id, model_version, prob_home, prob_draw, prob_away,
             prob_1x, prob_x2, prob_over_25, prob_under_25,
             ml_home, ml_draw, ml_away, dc_1x, dc_x2,
             ou25_over, ou25_under, top_score, lambda_home, lambda_away, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            model_version=VALUES(model_version),
            prob_home=VALUES(prob_home), prob_draw=VALUES(prob_draw), prob_away=VALUES(prob_away),
            prob_1x=VALUES(prob_1x), prob_x2=VALUES(prob_x2),
            prob_over_25=VALUES(prob_over_25), prob_under_25=VALUES(prob_under_25),
            ml_home=VALUES(ml_home), ml_draw=VALUES(ml_draw), ml_away=VALUES(ml_away),
            dc_1x=VALUES(dc_1x), dc_x2=VALUES(dc_x2),
            ou25_over=VALUES(ou25_over), ou25_under=VALUES(ou25_under),
            top_score=VALUES(top_score), lambda_home=VALUES(lambda_home), lambda_away=VALUES(lambda_away),
            created_at=NOW()
        `, [
          p.fixture_id, 'v3-champion-2026',
          p.pH, p.pD, p.pA, p.p1X, p.pX2, p.pO25, p.pU25,
          p.mlH, p.mlD, p.mlA, p.dc1X, p.dcX2,
          p.ou25Over, p.ou25Under, p.topScore, p.lambdaH, p.lambdaA,
        ]);
        upserted++;
        console.log(`${TAG} [STATE] Upserted ${p.fixture_id} (minimal schema) ✅`);
      } catch (err2) {
        console.error(`${TAG} [ERROR] Minimal upsert also failed for ${p.fixture_id}: ${err2.message}`);
      }
    }
  }

  await conn.end();

  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} [VERIFY] Upserted ${upserted}/4 projections ✅`);

  // ── Final summary table ───────────────────────────────────────────────────
  console.log(`\n${TAG} ╔${'═'.repeat(70)}╗`);
  console.log(`${TAG} ║  JUNE 22, 2026 WC2026 — SHARP ORIGINATED LINES (v3 Champion)        ║`);
  console.log(`${TAG} ╠${'═'.repeat(70)}╣`);
  for (const p of projections) {
    console.log(`${TAG} ║  ${p.homeName} vs ${p.awayName} — ${p.kickoffPST}`);
    console.log(`${TAG} ║    1X2:  H=${formatAmerican(p.mlH)} D=${formatAmerican(p.mlD)} A=${formatAmerican(p.mlA)}`);
    console.log(`${TAG} ║    DC:   1X=${formatAmerican(p.dc1X)} X2=${formatAmerican(p.dcX2)}`);
    console.log(`${TAG} ║    O/U 0.5: O=${formatAmerican(p.ou05Over)} U=${formatAmerican(p.ou05Under)}`);
    console.log(`${TAG} ║    O/U 1.5: O=${formatAmerican(p.ou15Over)} U=${formatAmerican(p.ou15Under)}`);
    console.log(`${TAG} ║    O/U 2.5: O=${formatAmerican(p.ou25Over)} U=${formatAmerican(p.ou25Under)}`);
    console.log(`${TAG} ║    O/U 3.5: O=${formatAmerican(p.ou35Over)} U=${formatAmerican(p.ou35Under)}`);
    console.log(`${TAG} ║    Top Score: ${p.topScore} (${p.topScores[0].pct}%)`);
    if (p.dkH !== null) {
      console.log(`${TAG} ║    DK Book: H=${formatAmerican(p.dkH)} D=${formatAmerican(p.dkD)} A=${formatAmerican(p.dkA)} | O2.5=${formatAmerican(p.dkO25)} U2.5=${formatAmerican(p.dkU25)}`);
      console.log(`${TAG} ║    Edges:   H=${p.edgeH}pp D=${p.edgeD}pp A=${p.edgeA}pp | O2.5=${p.edgeO25}pp U2.5=${p.edgeU25}pp`);
    }
    console.log(`${TAG} ╠${'═'.repeat(70)}╣`);
  }
  console.log(`${TAG} ╚${'═'.repeat(70)}╝`);
  console.log(`${TAG} Done.`);

  // Return projections for feed publishing
  return projections;
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});
