/**
 * WC2026 v7.0 Model Seed Script — June 25, 2026
 * ================================================
 * Seeds all 6 June 25 matchs with v7.0 model projections.
 * Deletes v6.0-backtest-optimized-june25 rows first.
 * 
 * v7.0 improvements:
 * - Per-team calibration factors (actual/model ratio per team)
 * - Save-rate-adjusted opponent permissiveness
 * - Dynamic total line (uses book line for O/U grading)
 * - BTTS uses 15% shrinkage (vs 30% for ML/spread)
 * - Market coherence enforcement (5 rules)
 * - User-verified book odds for all 6 matchs
 * - 11 DB home/away inversions corrected
 */

import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';

const conn = await createConnection(process.env.DATABASE_URL);

console.log('[v7.0 SEED] Starting...');

// Load v7 results
const results = JSON.parse(readFileSync('/home/ubuntu/wc2026_v7_june25_final.json', 'utf8'));
console.log(`[INPUT] ${results.length} matchs to seed`);

// Delete v6 rows
const [del] = await conn.execute(
  `DELETE FROM wc2026_model_projections WHERE model_version = 'v6.0-backtest-optimized-june25'`
);
console.log(`[DELETE] Removed ${del.affectedRows} v6.0 rows`);

// Also delete any existing v7 rows (idempotent)
const [del7] = await conn.execute(
  `DELETE FROM wc2026_model_projections WHERE model_version = 'v7.0-june25-final'`
);
if (del7.affectedRows > 0) console.log(`[DELETE] Removed ${del7.affectedRows} existing v7.0 rows`);

let inserted = 0;
const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

for (const r of results) {
  const fid = r.match_id;
  const home = r.home_team.toUpperCase();
  const away = r.away_team.toUpperCase();
  
  console.log(`\n[SEED] ${fid} | ${home} vs ${away}`);
  console.log(`  Proj: ${r.proj_home.toFixed(2)} - ${r.proj_away.toFixed(2)} | Total=${r.proj_total.toFixed(2)}`);
  console.log(`  1X2: ${home}=${r.p_home.toFixed(4)} D=${r.p_draw.toFixed(4)} ${away}=${r.p_away.toFixed(4)}`);
  console.log(`  Spread (${r.book_spread_line >= 0 ? '+' : ''}${r.book_spread_line}): ${home}=${r.p_home_spread.toFixed(4)} ${away}=${r.p_away_spread.toFixed(4)}`);
  console.log(`  Total (${r.book_total_line}): OVER=${r.p_over.toFixed(4)} UNDER=${r.p_under.toFixed(4)}`);
  console.log(`  BTTS: YES=${r.p_btts_yes.toFixed(4)} NO=${r.p_btts_no.toFixed(4)}`);
  
  // Build book_odds JSON
  const bookOdds = {
    home_ml: r.book_home_ml, draw_ml: r.book_draw_ml, away_ml: r.book_away_ml,
    over_odds: r.book_over_odds, under_odds: r.book_under_odds,
    total_line: r.book_total_line,
    home_spread_odds: r.book_home_spread_odds, away_spread_odds: r.book_away_spread_odds,
    spread_line: r.book_spread_line,
    btts_yes: r.book_btts_yes_odds, btts_no: r.book_btts_no_odds,
  };
  
  // Build full_output JSON
  const fullOutput = {
    version: 'v7.0-june25-final',
    lH: r.lH, lA: r.lA,
    lH_btts: r.lH_btts, lA_btts: r.lA_btts,
    cal_home: r.cal_home, cal_away: r.cal_away,
    edge_home: r.edge_home, edge_draw: r.edge_draw, edge_away: r.edge_away,
    edge_over: r.edge_over, edge_under: r.edge_under,
    edge_home_spread: r.edge_home_spread, edge_away_spread: r.edge_away_spread,
    edge_btts_yes: r.edge_btts_yes, edge_btts_no: r.edge_btts_no,
    edge_dc_home: r.edge_dc_home, edge_dc_away: r.edge_dc_away,
    nv_home: r.nv_home, nv_draw: r.nv_draw, nv_away: r.nv_away,
    nv_over: r.nv_over, nv_under: r.nv_under,
    nv_home_spread: r.nv_home_spread, nv_away_spread: r.nv_away_spread,
    nv_btts_yes: r.nv_btts_yes, nv_btts_no: r.nv_btts_no,
    p_home_spread: r.p_home_spread, p_away_spread: r.p_away_spread,
    p_dc_home: r.p_dc_home, p_dc_away: r.p_dc_away,
    p_no_draw: r.p_no_draw,
    p_home_no_draw: r.p_home_no_draw, p_away_no_draw: r.p_away_no_draw,
    coherence_flags: r.coherence_flags,
    best_edge_market: r.best_edge_market, best_edge_val: r.best_edge_val,
    model_spread_raw: r.model_spread_raw,
    model_spread_rounded: r.model_spread_rounded,
  };
  
  // Top scorelines
  const topScorelines = r.top_scores.map(([score, prob]) => ({
    score, prob: parseFloat(prob)
  }));
  
  // Spread: model uses book spread line
  // model_spread = book_spread_line (we're grading against the book line)
  // model_spread_raw = raw model projection
  const spreadLine = r.book_spread_line;
  const totalLine = r.book_total_line;
  
  // For over/under: use book total line
  // over_2_5 = p_over when line=2.5, over_3_5 = p_over when line=3.5, etc.
  const over2_5 = totalLine === 2.5 ? r.p_over : null;
  const under2_5 = totalLine === 2.5 ? r.p_under : null;
  const over3_5 = totalLine === 3.5 ? r.p_over : null;
  const over1_5 = totalLine === 1.5 ? r.p_over : null;
  
  const [ins] = await conn.execute(`
    INSERT INTO wc2026_model_projections (
      match_id, model_version, n_simulations,
      home_team, away_team,
      home_lambda, away_lambda,
      home_win_prob, draw_prob, away_win_prob,
      proj_home_score, proj_away_score, proj_total, proj_spread,
      over_1_5, over_2_5, under_2_5, over_3_5,
      btts_prob,
      model_home_ml, model_draw_ml, model_away_ml,
      model_spread, model_spread_raw,
      model_total, model_total_raw,
      over_odds, under_odds,
      home_spread_odds, away_spread_odds,
      nv_home_prob, nv_draw_prob, nv_away_prob,
      home_edge, draw_edge, away_edge,
      model_lean, lean_prob,
      nv_dc_1x, nv_dc_x2, dc_1x_odds, dc_x2_odds,
      nv_no_draw_home, nv_no_draw_away, no_draw_home_odds, no_draw_away_odds,
      btts_yes_odds, btts_no_odds,
      book_odds, top_scorelines, full_output,
      modeled_at
    ) VALUES (
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?
    )
  `, [
    fid, 'v7.0-june25-final', 1000000,
    home, away,
    r.lH, r.lA,
    r.p_home, r.p_draw, r.p_away,
    r.proj_home, r.proj_away, r.proj_total, r.model_spread_raw,
    over1_5, over2_5, under2_5, over3_5,
    r.p_btts_yes,
    r.model_home_ml, r.model_draw_ml, r.model_away_ml,
    spreadLine, r.model_spread_raw,
    totalLine, r.proj_total,
    r.model_over_odds, r.model_under_odds,
    r.model_home_spread_odds, r.model_away_spread_odds,
    r.nv_home, r.nv_draw, r.nv_away,
    r.edge_home, r.edge_draw, r.edge_away,
    r.lean.toUpperCase(), r.lean_prob,
    r.p_dc_home, r.p_dc_away, r.model_dc_home_odds, r.model_dc_away_odds,
    r.p_home_no_draw, r.p_away_no_draw, r.model_home_ml, r.model_away_ml,
    r.model_btts_yes_odds, r.model_btts_no_odds,
    JSON.stringify(bookOdds), JSON.stringify(topScorelines), JSON.stringify(fullOutput),
    now
  ]);
  
  console.log(`  [INSERT] id=${ins.insertId} ✓`);
  inserted++;
}

// ── VERIFICATION ────────────────────────────────────────────────────────────
console.log('\n[VERIFY] Checking seeded rows...');
const [verify] = await conn.execute(
  `SELECT match_id, model_version, home_team, away_team, 
          home_win_prob, draw_prob, away_win_prob,
          proj_home_score, proj_away_score, proj_total,
          model_home_ml, model_draw_ml, model_away_ml,
          over_odds, under_odds, model_total,
          btts_yes_odds, btts_no_odds,
          dc_1x_odds, dc_x2_odds,
          home_edge, draw_edge, away_edge
   FROM wc2026_model_projections 
   WHERE model_version = 'v7.0-june25-final'
   ORDER BY match_id`
);

console.log(`[VERIFY] ${verify.length}/6 rows confirmed in DB`);
for (const row of verify) {
  const sum = (row.home_win_prob + row.draw_prob + row.away_win_prob).toFixed(4);
  console.log(`  ${row.match_id} | ${row.home_team} vs ${row.away_team}`);
  console.log(`    Proj: ${row.proj_home_score.toFixed(2)}-${row.proj_away_score.toFixed(2)} | Total=${row.proj_total.toFixed(2)}`);
  console.log(`    1X2: ${row.home_team}=${row.home_win_prob.toFixed(4)} D=${row.draw_prob.toFixed(4)} ${row.away_team}=${row.away_win_prob.toFixed(4)} SUM=${sum}`);
  console.log(`    ML: ${row.home_team}=${row.model_home_ml} D=${row.model_draw_ml} ${row.away_team}=${row.model_away_ml}`);
  console.log(`    O/U (${row.model_total}): OVER=${row.over_odds} UNDER=${row.under_odds}`);
  console.log(`    BTTS: YES=${row.btts_yes_odds} NO=${row.btts_no_odds}`);
  console.log(`    DC: 1X=${row.dc_1x_odds} X2=${row.dc_x2_odds}`);
  console.log(`    Edges: H=${row.home_edge?.toFixed(4)} D=${row.draw_edge?.toFixed(4)} A=${row.away_edge?.toFixed(4)}`);
  
  // Sanity checks
  const sumVal = parseFloat(sum);
  if (Math.abs(sumVal - 1.0) > 0.001) {
    console.log(`    ⚠ WARN: 1X2 sum=${sum} ≠ 1.0`);
  } else {
    console.log(`    ✓ 1X2 sum valid`);
  }
}

if (verify.length === 6) {
  console.log('\n[COMPLETE] ✓ All 6 v7.0 matchs seeded and verified');
} else {
  console.log(`\n[ERROR] Only ${verify.length}/6 rows found — check for errors above`);
}

await conn.end();
