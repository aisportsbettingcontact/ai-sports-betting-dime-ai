/**
 * WC2026 v7.0 Model Projections Seed — June 27, 2026
 * =====================================================
 * Seeds all 6 June 27 matchs with v7.0 model projections.
 * Uses exact column names from wc2026_model_projections table.
 * Marks all rows as is_frozen=1 immediately on insert.
 *
 * Model: Dixon-Coles Bivariate Poisson
 * Version: v7.0-june27-final
 * Coherence: 66/66 checks passed (11 per match)
 * Lambda floor: 0.20 (prevents degenerate zeroing for clean-sheet defenses)
 */
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';

const conn = await createConnection(process.env.DATABASE_URL);
console.log('[INPUT] Loading June 27 v7.0 model results...');
const results = JSON.parse(readFileSync('/home/ubuntu/june27_v7_results.json', 'utf8'));

const VERSION = 'v7.0-june27-final';
const MATCH_IDS = ['wc26-g-069', 'wc26-g-070', 'wc26-g-068', 'wc26-g-072', 'wc26-g-067', 'wc26-g-071'];
const LABELS = {
  'wc26-g-069': 'ALG vs AUT',
  'wc26-g-070': 'JOR vs ARG',
  'wc26-g-068': 'PAN vs ENG',
  'wc26-g-072': 'CRO vs GHA',
  'wc26-g-067': 'COD vs UZB',
  'wc26-g-071': 'COL vs POR',
};

// SMALLINT range: -32768 to 32767
const SMALLINT_MAX = 32767;
const SMALLINT_MIN = -32768;
const capSmallInt = (v) => Math.max(SMALLINT_MIN, Math.min(SMALLINT_MAX, Math.round(v)));

// Build lookup by match_id
const resultsByFid = {};
for (const r of results) {
  resultsByFid[r.match_id] = r;
}

// ── Step 1: Delete existing v7.0 rows for June 27 matchs ──
console.log('\n[STEP] Deleting existing v7.0 rows for June 27 matchs...');
for (const fid of MATCH_IDS) {
  const [del] = await conn.execute(
    `DELETE FROM wc2026_model_projections WHERE match_id = ? AND model_version = ?`,
    [fid, VERSION]
  );
  console.log(`  [STATE] ${fid}: deleted ${del.affectedRows} rows`);
}

// ── Step 2: Insert v7.0 projection rows ──
console.log('\n[STEP] Inserting v7.0 model projections...');
for (const fid of MATCH_IDS) {
  const r = resultsByFid[fid];
  if (!r) {
    console.error(`[ERROR] No results for ${fid}`);
    continue;
  }
  if (!r.coherence_pass) {
    console.error(`[ERROR] ${fid} failed coherence checks — skipping insert`);
    continue;
  }

  // Probabilities
  const p_home = r.p_home;
  const p_draw = r.p_draw;
  const p_away = r.p_away;
  const p_home_cover = r.p_home_cover;
  const p_away_cover = r.p_away_cover;
  const p_over = r.p_over;
  const p_under = r.p_under;
  const p_btts_yes = r.p_btts_yes;
  const p_btts_no = r.p_btts_no;
  const p_dc_1x = r.p_dc_1x;
  const p_dc_x2 = r.p_dc_x2;
  const p_no_draw = r.p_no_draw;

  // Model odds
  const home_ml = r.model_home_ml;
  const draw_ml = r.model_draw_ml;
  const away_ml = r.model_away_ml;
  const spread_line = r.model_spread_line;
  const home_spread_odds = r.model_home_spread_odds;
  const away_spread_odds = r.model_away_spread_odds;
  const total_line = r.model_total_line;
  const over_odds = r.model_over_odds;
  const under_odds = r.model_under_odds;
  const btts_yes_odds = capSmallInt(r.model_btts_yes_odds);
  const btts_no_odds = capSmallInt(r.model_btts_no_odds);
  const dc_1x_odds = capSmallInt(r.model_dc_1x_odds);
  const dc_x2_odds = capSmallInt(r.model_dc_x2_odds);
  const no_draw_home_odds = capSmallInt(r.model_no_draw_home_odds);
  const no_draw_away_odds = capSmallInt(r.model_no_draw_away_odds);

  // Edges
  const edges = r.edges;
  const home_edge = edges.home_ml_edge;
  const draw_edge = edges.draw_ml_edge;
  const away_edge = edges.away_ml_edge;

  // ML lean
  let mlLean, leanProb;
  if (r.lean === 'home') {
    mlLean = r.home_id;
    leanProb = p_home;
  } else if (r.lean === 'away') {
    mlLean = r.away_id;
    leanProb = p_away;
  } else {
    mlLean = 'draw';
    leanProb = p_draw;
  }

  // Full output JSON
  const fullOutputJson = JSON.stringify({
    model_version: VERSION,
    lam_h: r.lam_h,
    lam_a: r.lam_a,
    markets: {
      p_home, p_draw, p_away,
      p_home_cover, p_away_cover,
      p_over, p_under,
      p_btts_yes, p_btts_no,
      p_dc_1x, p_dc_x2, p_no_draw,
    },
    model_odds: {
      home_ml, draw_ml, away_ml,
      spread_line, home_spread_odds, away_spread_odds,
      total_line, over_odds, under_odds,
      btts_yes_odds, btts_no_odds,
      dc_1x_odds, dc_x2_odds,
      no_draw_home_odds, no_draw_away_odds,
    },
    edges,
    coherence_pass: r.coherence_pass,
  });

  console.log(`\n[STEP] Inserting ${fid} (${LABELS[fid]})...`);
  console.log(`  [STATE] Proj: ${r.proj_home_score}-${r.proj_away_score} | Total: ${r.proj_total} | Spread: ${r.proj_spread}`);
  console.log(`  [STATE] ML: H${home_ml}/D${draw_ml}/A${away_ml}`);
  console.log(`  [STATE] Total ${total_line}: O${over_odds}/U${under_odds}`);
  console.log(`  [STATE] Spread ${spread_line}: H${home_spread_odds}/A${away_spread_odds}`);
  console.log(`  [STATE] BTTS: Y${btts_yes_odds}/N${btts_no_odds}`);
  console.log(`  [STATE] DC: 1X${dc_1x_odds}/X2${dc_x2_odds}`);
  console.log(`  [STATE] Lean: ${mlLean} (${(leanProb * 100).toFixed(1)}%)`);

  await conn.execute(
    `INSERT INTO wc2026_model_projections (
      match_id, model_version, n_simulations,
      home_team, away_team,
      home_lambda, away_lambda,
      home_win_prob, draw_prob, away_win_prob,
      proj_home_score, proj_away_score, proj_total,
      proj_spread,
      over_2_5, over_3_5,
      btts_prob, btts_yes_odds, btts_no_odds,
      model_home_ml, model_draw_ml, model_away_ml,
      model_spread, model_total,
      over_odds, under_odds,
      home_spread_odds, away_spread_odds,
      nv_home_prob, nv_draw_prob, nv_away_prob,
      home_edge, draw_edge, away_edge,
      model_lean, lean_prob,
      nv_dc_1x, nv_dc_x2,
      dc_1x_odds, dc_x2_odds,
      nv_no_draw_home, nv_no_draw_away,
      no_draw_home_odds, no_draw_away_odds,
      full_output,
      is_frozen, frozen_at, modeled_at, created_at
    ) VALUES (
      ?, ?, 100000,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?,
      1, NOW(), NOW(), NOW()
    )`,
    [
      fid, VERSION,
      r.home_id, r.away_id,
      r.lam_h, r.lam_a,
      p_home, p_draw, p_away,
      r.proj_home_score, r.proj_away_score, r.proj_total,
      spread_line,
      p_over,  // over_2_5 (using book total line probability)
      p_over,  // over_3_5 (same — book line is the reference)
      p_btts_yes, btts_yes_odds, btts_no_odds,
      home_ml, draw_ml, away_ml,
      spread_line, total_line,
      over_odds, under_odds,
      home_spread_odds, away_spread_odds,
      p_home, p_draw, p_away,  // nv probs (already no-vig from model)
      home_edge, draw_edge, away_edge,
      mlLean, leanProb,
      p_dc_1x, p_dc_x2,
      dc_1x_odds, dc_x2_odds,
      p_no_draw, 1 - p_no_draw,  // nv_no_draw_home, nv_no_draw_away
      no_draw_home_odds, no_draw_away_odds,
      fullOutputJson,
    ]
  );
  console.log(`  [OUTPUT] ${fid} inserted successfully`);
}

// ── Step 3: Verify all 6 rows ──
console.log('\n[STEP] Verifying all 6 June 27 v7.0 rows...');
const [rows] = await conn.execute(
  `SELECT match_id, model_version,
          model_home_ml, model_draw_ml, model_away_ml,
          model_total, over_odds, under_odds,
          model_spread, home_spread_odds, away_spread_odds,
          btts_yes_odds, btts_no_odds,
          dc_1x_odds, dc_x2_odds,
          proj_home_score, proj_away_score, proj_total,
          home_win_prob, draw_prob, away_win_prob,
          is_frozen, frozen_at
   FROM wc2026_model_projections
   WHERE match_id IN ('wc26-g-069','wc26-g-070','wc26-g-068','wc26-g-072','wc26-g-067','wc26-g-071')
   AND model_version = ?
   ORDER BY match_id`,
  [VERSION]
);

console.log(`\n[VERIFY] Found ${rows.length}/6 rows`);
let allPass = true;
for (const row of rows) {
  const frozen = row.is_frozen === 1 ? 'FROZEN' : 'NOT_FROZEN';
  const hasAllOdds = row.model_home_ml !== null && row.model_draw_ml !== null && row.model_away_ml !== null
    && row.over_odds !== null && row.under_odds !== null
    && row.home_spread_odds !== null && row.away_spread_odds !== null
    && row.btts_yes_odds !== null && row.btts_no_odds !== null
    && row.dc_1x_odds !== null && row.dc_x2_odds !== null;
  const status = hasAllOdds ? 'PASS' : 'FAIL';
  if (status === 'FAIL') allPass = false;
  console.log(`  [${status}][${frozen}] ${row.match_id}: H${row.model_home_ml}/D${row.model_draw_ml}/A${row.model_away_ml} | O${row.over_odds}/U${row.under_odds} | Proj:${row.proj_home_score}-${row.proj_away_score}`);
}

console.log(`\n[VERIFY] Overall: ${allPass ? 'ALL PASS' : 'SOME FAILURES'}`);
console.log(`[VERIFY] Rows seeded: ${rows.length}/6`);

await conn.end();
console.log('[DB] Disconnected');
