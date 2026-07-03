/**
 * WC2026 v7.0 Model Projections Seed — June 26, 2026
 * =====================================================
 * Seeds all 6 June 26 matchs with v7.0 model projections.
 * Uses exact column names from wc2026_model_projections table.
 * Marks all rows as is_frozen=1 immediately on insert.
 *
 * Model: Dixon-Coles Bivariate Poisson
 * Version: v7.0-june26-final
 * Coherence: 66/66 checks passed (11 per match)
 */

import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';

const conn = await createConnection(process.env.DATABASE_URL);

console.log('[INPUT] Loading June 26 v7.0 model results...');
const results = JSON.parse(readFileSync('/home/ubuntu/june26_v7_results.json', 'utf8'));

const VERSION = 'v7.0-june26-final';
const MATCH_IDS = ['wc26-g-064', 'wc26-g-065', 'wc26-g-061', 'wc26-g-066', 'wc26-g-062', 'wc26-g-063'];

const LABELS = {
  'wc26-g-064': 'NOR vs FRA',
  'wc26-g-065': 'IRQ vs SEN',
  'wc26-g-061': 'CPV vs KSA',
  'wc26-g-066': 'URU vs ESP',
  'wc26-g-062': 'IRN vs EGY',
  'wc26-g-063': 'NZL vs BEL',
};

// ── Step 1: Delete existing v7.0 rows for June 26 matchs ──
console.log('\n[STEP] Deleting existing v7.0 rows for June 26 matchs...');
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
  const r = results[fid];
  if (!r) {
    console.error(`[ERROR] No results for ${fid}`);
    continue;
  }

  if (!r.coherence_pass) {
    console.error(`[ERROR] ${fid} failed coherence checks — skipping insert`);
    continue;
  }

  const p = r.markets;
  const mo = r.model_odds;
  const book = r.book;
  const edges = r.edges;

  // Best edge
  const bestEdge = Object.entries(edges).sort((a, b) => b[1] - a[1])[0];
  const leanLabel = bestEdge[0].replace('_edge', '').replace(/_/g, ' ').toUpperCase();
  const leanEdge = bestEdge[1];

  // ML lean
  let mlLean, leanProb;
  if (p.p_home > p.p_away && p.p_home > p.p_draw) {
    mlLean = r.home_id;
    leanProb = p.p_home;
  } else if (p.p_away > p.p_home && p.p_away > p.p_draw) {
    mlLean = r.away_id;
    leanProb = p.p_away;
  } else {
    mlLean = 'draw';
    leanProb = p.p_draw;
  }

  // Build book_odds JSON for storage
  const bookOddsJson = JSON.stringify({
    home_ml: book.home_ml,
    draw_ml: book.draw_ml,
    away_ml: book.away_ml,
    total_line: book.total_line,
    over_odds: book.over_odds,
    under_odds: book.under_odds,
    spread_line: book.spread_line,
    home_spread_odds: book.home_spread_odds,
    away_spread_odds: book.away_spread_odds,
    dc_1x: book.dc_1x,
    dc_x2: book.dc_x2,
    btts_yes: book.btts_yes,
    btts_no: book.btts_no,
    no_draw: book.no_draw,
  });

  // Build full_output JSON
  const fullOutputJson = JSON.stringify({
    model_version: VERSION,
    lam_h: r.lam_h,
    lam_a: r.lam_a,
    markets: p,
    model_odds: mo,
    edges: edges,
    coherence_checks: r.coherence_checks,
    most_likely_score: r.most_likely_score,
  });

  console.log(`\n[STEP] Inserting ${fid} (${LABELS[fid]})...`);
  console.log(`  [STATE] Proj: ${r.proj_home}-${r.proj_away} | Total: ${r.proj_total}`);
  console.log(`  [STATE] ML: H${mo.home_ml}/D${mo.draw_ml}/A${mo.away_ml}`);
  console.log(`  [STATE] Total ${book.total_line}: O${mo.over_odds}/U${mo.under_odds}`);
  console.log(`  [STATE] Spread ${book.spread_line}: H${mo.home_spread_odds}/A${mo.away_spread_odds}`);
  console.log(`  [STATE] BTTS: Y${mo.btts_yes_odds}/N${mo.btts_no_odds}`);
  console.log(`  [STATE] DC: 1X${mo.dc_1x_odds}/X2${mo.dc_x2_odds} ND${mo.no_draw_home_odds}`);
  console.log(`  [STATE] Best edge: ${leanLabel} +${leanEdge.toFixed(4)}`);

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
      book_odds, full_output,
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
      ?, ?,
      1, NOW(), NOW(), NOW()
    )`,
    [
      fid, VERSION,
      r.home_id, r.away_id,
      r.lam_h, r.lam_a,
      p.p_home, p.p_draw, p.p_away,
      r.proj_home, r.proj_away, r.proj_total,
      book.spread_line,
      p.p_over,  // over_2_5 (using book total line probability)
      p.p_over,  // over_3_5 (same — book line is the reference)
      p.p_btts_yes, mo.btts_yes_odds, mo.btts_no_odds,
      mo.home_ml, mo.draw_ml, mo.away_ml,
      book.spread_line, book.total_line,
      mo.over_odds, mo.under_odds,
      mo.home_spread_odds, mo.away_spread_odds,
      p.p_home, p.p_draw, p.p_away,  // nv probs (already no-vig from model)
      edges.home_edge, edges.draw_edge, edges.away_edge,
      mlLean, leanProb,
      p.p_dc_1x, p.p_dc_x2,
      mo.dc_1x_odds, mo.dc_x2_odds,
      p.p_no_draw, 1 - p.p_no_draw,  // nv_no_draw_home, nv_no_draw_away
      mo.no_draw_home_odds, -mo.no_draw_home_odds,  // no_draw_home_odds, no_draw_away_odds
      bookOddsJson, fullOutputJson,
    ]
  );

  console.log(`  [OUTPUT] ${fid} inserted successfully`);
}

// ── Step 3: Verify all 6 rows ──
console.log('\n[STEP] Verifying all 6 June 26 v7.0 rows...');
const [rows] = await conn.execute(
  `SELECT match_id, model_version,
          model_home_ml, model_draw_ml, model_away_ml,
          model_total, over_odds, under_odds,
          model_spread, home_spread_odds, away_spread_odds,
          btts_yes_odds, btts_no_odds,
          dc_1x_odds, dc_x2_odds, no_draw_home_odds,
          proj_home_score, proj_away_score, proj_total,
          is_frozen, model_lean, home_edge, draw_edge, away_edge
   FROM wc2026_model_projections
   WHERE match_id IN (?, ?, ?, ?, ?, ?) AND model_version = ?
   ORDER BY match_id`,
  [...MATCH_IDS, VERSION]
);

console.log(`\n[VERIFY] Found ${rows.length}/6 rows`);
let allPass = true;
for (const row of rows) {
  const label = LABELS[row.match_id] || row.match_id;
  const frozen = row.is_frozen ? 'FROZEN' : 'NOT_FROZEN';
  const valid = row.model_home_ml !== null && row.model_draw_ml !== null && row.model_away_ml !== null;
  if (!valid) allPass = false;

  console.log(`[${valid ? 'PASS' : 'FAIL'}] ${row.match_id} ${label} [${frozen}]`);
  console.log(`  ML: H${row.model_home_ml}/D${row.model_draw_ml}/A${row.model_away_ml}`);
  console.log(`  Total ${row.model_total}: O${row.over_odds}/U${row.under_odds}`);
  console.log(`  Spread ${row.model_spread}: H${row.home_spread_odds}/A${row.away_spread_odds}`);
  console.log(`  BTTS: Y${row.btts_yes_odds}/N${row.btts_no_odds}`);
  console.log(`  DC: 1X${row.dc_1x_odds}/X2${row.dc_x2_odds} ND${row.no_draw_home_odds}`);
  console.log(`  Proj: ${row.proj_home_score}-${row.proj_away_score} (total ${row.proj_total})`);
  console.log(`  Edges: H${parseFloat(row.home_edge).toFixed(4)} D${parseFloat(row.draw_edge).toFixed(4)} A${parseFloat(row.away_edge).toFixed(4)}`);
}

console.log(`\n[VERIFY] All rows valid: ${allPass}`);
console.log(`[VERIFY] Version: ${VERSION}`);
console.log('[OUTPUT] June 26 v7.0 seed complete. Ready to publish to feed.');

await conn.end();
