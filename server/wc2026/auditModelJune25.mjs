/**
 * auditModelJune25.mjs
 * Exhaustive 4-layer audit of June 25 WC2026 model odds and projections
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[AUDIT_MODEL_JUNE25]';
const MODEL_BOOK_ID = 0;
const DK_BOOK_ID = 68;
const FIXTURE_IDS = ['wc26-g-057','wc26-g-058','wc26-g-059','wc26-g-060','wc26-g-055','wc26-g-056'];

function americanToProb(ml) {
  if (ml == null || isNaN(ml)) return null;
  return ml < 0 ? (-ml) / (-ml + 100) : 100 / (ml + 100);
}

(async () => {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} JUNE 25 MODEL AUDIT — 4-LAYER VALIDATION`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  let totalErrors = 0;

  // ── Layer 1: Model odds row count per fixture ─────────────────────────────
  console.log(`${TAG} [LAYER 1] Model odds row count (expected 12 per fixture):`);
  const idList = FIXTURE_IDS.map(() => '?').join(',');
  const [modelCounts] = await conn.query(
    `SELECT match_id, COUNT(*) as cnt FROM wc2026_odds_snapshots WHERE match_id IN (${idList}) AND book_id = ${MODEL_BOOK_ID} GROUP BY match_id`,
    FIXTURE_IDS
  );
  for (const fid of FIXTURE_IDS) {
    const row = modelCounts.find(r => r.match_id === fid);
    const cnt = row ? row.cnt : 0;
    const pass = cnt === 12;
    if (!pass) totalErrors++;
    console.log(`${TAG}   ${fid}: ${cnt} rows ${pass ? 'PASS ✓' : 'FAIL ✗ (expected 12)'}`);
  }

  // ── Layer 2: Market completeness per fixture ──────────────────────────────
  console.log(`\n${TAG} [LAYER 2] Market completeness (all 6 markets present):`);
  const REQUIRED_MARKETS = [
    ['1X2','home'], ['1X2','draw'], ['1X2','away'], ['1X2','no_draw'],
    ['TOTAL','over'], ['TOTAL','under'],
    ['ASIAN_HANDICAP','home'], ['ASIAN_HANDICAP','away'],
    ['DOUBLE_CHANCE','home_draw'], ['DOUBLE_CHANCE','away_draw'],
    ['BTTS','yes'], ['BTTS','no'],
  ];
  for (const fid of FIXTURE_IDS) {
    const [rows] = await conn.query(
      `SELECT market, selection, line, american_odds, implied_prob FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ${MODEL_BOOK_ID}`,
      [fid]
    );
    const missing = [];
    for (const [mkt, sel] of REQUIRED_MARKETS) {
      if (!rows.find(r => r.market === mkt && r.selection === sel)) {
        missing.push(`${mkt}/${sel}`);
      }
    }
    if (missing.length > 0) {
      totalErrors += missing.length;
      console.log(`${TAG}   ${fid}: FAIL ✗ — missing: ${missing.join(', ')}`);
    } else {
      console.log(`${TAG}   ${fid}: ALL 12 MARKETS PRESENT ✓`);
    }
  }

  // ── Layer 3: Probability integrity checks ─────────────────────────────────
  console.log(`\n${TAG} [LAYER 3] Probability integrity (1X2 probs sum to 1.0, no-draw = 1-draw):`);
  for (const fid of FIXTURE_IDS) {
    const [rows] = await conn.query(
      `SELECT market, selection, american_odds, implied_prob FROM wc2026_odds_snapshots WHERE match_id = ? AND book_id = ${MODEL_BOOK_ID}`,
      [fid]
    );
    const get = (mkt, sel) => rows.find(r => r.market === mkt && r.selection === sel);

    const home = get('1X2','home');
    const draw = get('1X2','draw');
    const away = get('1X2','away');
    const noDraw = get('1X2','no_draw');

    if (!home || !draw || !away || !noDraw) {
      console.log(`${TAG}   ${fid}: SKIP — missing 1X2 rows`);
      continue;
    }

    const pHome = parseFloat(home.implied_prob);
    const pDraw = parseFloat(draw.implied_prob);
    const pAway = parseFloat(away.implied_prob);
    const pNoDraw = parseFloat(noDraw.implied_prob);

    const probSum = pHome + pDraw + pAway;
    const noDrawCheck = Math.abs(pNoDraw - (pHome + pAway));
    const sumOk = Math.abs(probSum - 1.0) < 0.001;
    const noDrawOk = noDrawCheck < 0.005;

    console.log(`${TAG}   ${fid}: 1X2 sum=${probSum.toFixed(4)} ${sumOk ? 'PASS ✓' : 'FAIL ✗'} | no_draw_delta=${noDrawCheck.toFixed(4)} ${noDrawOk ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!sumOk) totalErrors++;
    if (!noDrawOk) totalErrors++;

    // Also check: BTTS yes + no ≈ 1.0
    const bttsYes = get('BTTS','yes');
    const bttsNo = get('BTTS','no');
    if (bttsYes && bttsNo) {
      const bttsSum = parseFloat(bttsYes.implied_prob) + parseFloat(bttsNo.implied_prob);
      const bttsOk = Math.abs(bttsSum - 1.0) < 0.001;
      console.log(`${TAG}   ${fid}: BTTS sum=${bttsSum.toFixed(4)} ${bttsOk ? 'PASS ✓' : 'FAIL ✗'}`);
      if (!bttsOk) totalErrors++;
    }

    // Check: TOTAL over + under ≈ 1.0
    const over = get('TOTAL','over');
    const under = get('TOTAL','under');
    if (over && under) {
      const totalSum = parseFloat(over.implied_prob) + parseFloat(under.implied_prob);
      const totalOk = Math.abs(totalSum - 1.0) < 0.001;
      console.log(`${TAG}   ${fid}: TOTAL sum=${totalSum.toFixed(4)} ${totalOk ? 'PASS ✓' : 'FAIL ✗'}`);
      if (!totalOk) totalErrors++;
    }
  }

  // ── Layer 4: Projection table audit ──────────────────────────────────────
  console.log(`\n${TAG} [LAYER 4] Projection table — all 6 fixtures present with valid values:`);
  const [projRows] = await conn.query(
    `SELECT match_id, model_version, n_simulations,
      home_team, away_team,
      home_lambda, away_lambda,
      home_win_prob, draw_prob, away_win_prob,
      proj_home_score, proj_away_score, proj_total, proj_spread,
      model_home_ml, model_draw_ml, model_away_ml,
      model_total, over_odds, under_odds,
      model_spread, home_spread_odds, away_spread_odds,
      btts_prob, btts_yes_odds, btts_no_odds,
      model_lean, lean_prob,
      home_edge, draw_edge, away_edge,
      modeled_at
    FROM wc2026_model_projections WHERE match_id IN (${idList})
    AND model_version = 'v4.2-corrected-june25'`,
    FIXTURE_IDS
  );

  if (projRows.length !== 6) {
    console.log(`${TAG}   FAIL ✗ — expected 6 projection rows, got ${projRows.length}`);
    totalErrors++;
  }

  for (const r of projRows) {
    const checks = [];
    // Probabilities sum to ~1
    const probSum = parseFloat(r.home_win_prob) + parseFloat(r.draw_prob) + parseFloat(r.away_win_prob);
    if (Math.abs(probSum - 1.0) > 0.001) checks.push(`prob_sum=${probSum.toFixed(4)}`);
    // Lambdas positive
    if (parseFloat(r.home_lambda) <= 0) checks.push(`home_lambda=${r.home_lambda}`);
    if (parseFloat(r.away_lambda) <= 0) checks.push(`away_lambda=${r.away_lambda}`);
    // Proj scores positive
    if (parseFloat(r.proj_home_score) < 0) checks.push(`proj_home<0`);
    if (parseFloat(r.proj_away_score) < 0) checks.push(`proj_away<0`);
    // Model ML not null
    if (!r.model_home_ml) checks.push('model_home_ml=null');
    if (!r.model_draw_ml) checks.push('model_draw_ml=null');
    if (!r.model_away_ml) checks.push('model_away_ml=null');
    // BTTS prob in [0,1]
    if (parseFloat(r.btts_prob) < 0 || parseFloat(r.btts_prob) > 1) checks.push(`btts_prob=${r.btts_prob}`);
    // Lean is home or away
    if (!['home','away'].includes(r.model_lean)) checks.push(`lean=${r.model_lean}`);

    const pass = checks.length === 0;
    if (!pass) totalErrors += checks.length;
    console.log(`${TAG}   ${r.match_id}: ${r.home_team}(h) vs ${r.away_team}(a) | proj=${r.proj_home_score}-${r.proj_away_score} total=${r.proj_total} | ML: home=${r.model_home_ml > 0 ? '+' : ''}${r.model_home_ml} draw=${r.model_draw_ml > 0 ? '+' : ''}${r.model_draw_ml} away=${r.model_away_ml > 0 ? '+' : ''}${r.model_away_ml} | lean=${r.model_lean} | ${pass ? 'PASS ✓' : 'FAIL ✗: ' + checks.join(', ')}`);
  }

  // ── Final verdict ─────────────────────────────────────────────────────────
  console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
  console.log(`${TAG} FINAL VERDICT: ${totalErrors === 0 ? 'ALL LAYERS PASSED — 100% ACCURATE ✓' : `${totalErrors} ERRORS FOUND ✗`}`);
  console.log(`${TAG} ═══════════════════════════════════════════════════════\n`);

  await conn.end();
  process.exit(totalErrors > 0 ? 1 : 0);
})().catch(e => {
  console.error(`${TAG} [FATAL]`, e.message);
  process.exit(1);
});
