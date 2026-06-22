/**
 * validateFeedJune22.mjs
 * Full feed validation for June 22 WC2026 fixtures.
 * Compares DK book odds (book_id=68) vs model v4.2 (book_id=0) for all cells.
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const TAG = '[FEED_VALIDATE_JUNE22]';

const FIXTURE_IDS = ['wc26-g-043', 'wc26-g-041', 'wc26-g-042', 'wc26-g-044'];
const FIXTURE_NAMES = {
  'wc26-g-043': 'Austria (DB-H) vs Argentina (DB-A)',
  'wc26-g-041': 'Iraq (DB-H) vs France (DB-A)',
  'wc26-g-042': 'Norway (DB-H) vs Senegal (DB-A)',
  'wc26-g-044': 'Algeria (DB-H) vs Jordan (DB-A)',
};
const MARKETS = [
  ['1X2', 'home'],
  ['1X2', 'draw'],
  ['1X2', 'away'],
  ['TOTAL', 'over'],
  ['TOTAL', 'under'],
  ['DOUBLE_CHANCE', 'home_draw'],
  ['DOUBLE_CHANCE', 'away_draw'],
];

async function main() {
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} WC2026 June 22 Feed Validation — DK Book vs Model v4.2`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(80)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const ph = FIXTURE_IDS.map(() => '?').join(',');

  const [rows] = await conn.execute(
    `SELECT fixture_id, book_id, market, selection, american_odds, line
     FROM wc2026_odds_snapshots
     WHERE fixture_id IN (${ph}) AND book_id IN (0, 68)
     ORDER BY fixture_id, book_id, market, selection`,
    FIXTURE_IDS
  );

  console.log(`${TAG} [STATE] Total rows fetched from DB: ${rows.length}`);

  // Index by fixture_id + book_id + market + selection
  const idx = {};
  for (const r of rows) {
    const k = `${r.fixture_id}|${r.book_id}|${r.market}|${r.selection}`;
    idx[k] = r;
  }

  let totalCells = 0;
  let passedCells = 0;
  const failedCells = [];

  for (const fid of FIXTURE_IDS) {
    console.log(`\n${TAG} ── ${FIXTURE_NAMES[fid]} (${fid}) ──`);
    console.log(`${TAG} ${'Market/Selection'.padEnd(30)} ${'DK Book'.padEnd(14)} ${'Model v4.2'.padEnd(14)} Status`);
    console.log(`${TAG} ${'-'.repeat(70)}`);

    for (const [market, selection] of MARKETS) {
      const dkKey = `${fid}|68|${market}|${selection}`;
      const modelKey = `${fid}|0|${market}|${selection}`;
      const dkRow = idx[dkKey];
      const modelRow = idx[modelKey];

      const dkOdds = dkRow
        ? (dkRow.american_odds > 0 ? `+${dkRow.american_odds}` : `${dkRow.american_odds}`) +
          (dkRow.line !== null ? ` (${dkRow.line})` : '')
        : 'MISSING';
      const modelOdds = modelRow
        ? (modelRow.american_odds > 0 ? `+${modelRow.american_odds}` : `${modelRow.american_odds}`) +
          (modelRow.line !== null ? ` (${modelRow.line})` : '')
        : 'MISSING';

      const cellKey = `${market}_${selection}`;
      const pass = dkRow !== undefined && modelRow !== undefined;
      const status = pass ? '✅' : '❌';

      if (pass) passedCells++;
      else failedCells.push(`${fid}/${cellKey}`);
      totalCells++;

      console.log(`${TAG} ${status} ${cellKey.padEnd(28)} ${dkOdds.padEnd(14)} ${modelOdds.padEnd(14)}`);
    }
  }

  // ── Model projection summary ──────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} MODEL PROJECTION SUMMARY (v4.2 Corrected, 1M Monte Carlo):`);

  const [projRows] = await conn.execute(
    `SELECT fixture_id, home_team, away_team, home_win_prob, draw_prob, away_win_prob,
            model_home_ml, model_draw_ml, model_away_ml,
            model_total, over_odds, under_odds,
            home_edge, draw_edge, away_edge,
            model_lean, lean_prob, proj_total,
            over_2_5, btts_prob
     FROM wc2026_model_projections
     WHERE fixture_id IN (${ph}) AND model_version = 'v4.2-corrected-june22'
     ORDER BY fixture_id`,
    FIXTURE_IDS
  );

  for (const p of projRows) {
    const hml = p.model_home_ml > 0 ? `+${p.model_home_ml}` : `${p.model_home_ml}`;
    const dml = p.model_draw_ml > 0 ? `+${p.model_draw_ml}` : `${p.model_draw_ml}`;
    const aml = p.model_away_ml > 0 ? `+${p.model_away_ml}` : `${p.model_away_ml}`;
    const oml = p.over_odds > 0 ? `+${p.over_odds}` : `${p.over_odds}`;
    const uml = p.under_odds > 0 ? `+${p.under_odds}` : `${p.under_odds}`;
    console.log(`${TAG}   ${p.fixture_id}: ${p.home_team.toUpperCase()} vs ${p.away_team.toUpperCase()}`);
    console.log(`${TAG}     ML: H=${hml} D=${dml} A=${aml}`);
    console.log(`${TAG}     Total: ${p.model_total} | O=${oml} U=${uml}`);
    console.log(`${TAG}     Probs: H=${(p.home_win_prob*100).toFixed(2)}% D=${(p.draw_prob*100).toFixed(2)}% A=${(p.away_win_prob*100).toFixed(2)}%`);
    console.log(`${TAG}     Edges: H=${(p.home_edge*100).toFixed(2)}pp D=${(p.draw_edge*100).toFixed(2)}pp A=${(p.away_edge*100).toFixed(2)}pp`);
    console.log(`${TAG}     Lean: ${p.model_lean} (${(p.lean_prob*100).toFixed(1)}%) | O2.5=${(p.over_2_5*100).toFixed(2)}% BTTS=${(p.btts_prob*100).toFixed(2)}%`);
  }

  // ── Final verdict ─────────────────────────────────────────────────────────
  console.log(`\n${TAG} ${'='.repeat(80)}`);
  console.log(`${TAG} [VERIFY] Total cells: ${totalCells} | Passed: ${passedCells} | Failed: ${failedCells.length}`);
  if (failedCells.length > 0) {
    console.log(`${TAG} [FAIL] ❌ Missing cells: ${failedCells.join(', ')}`);
  } else {
    console.log(`${TAG} [PASS] ✅ All ${totalCells} feed cells populated correctly.`);
  }
  console.log(`${TAG} [VERIFY] Model projections rows: ${projRows.length}/4 ${projRows.length === 4 ? '✅' : '❌'}`);

  await conn.end();
  console.log(`\n${TAG} Done.`);

  if (failedCells.length > 0 || projRows.length !== 4) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}`);
  process.exit(1);
});
