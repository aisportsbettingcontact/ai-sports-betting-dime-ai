/**
 * seedModelOddsJune27v72.mjs
 * Seeds WC2026 v7.2 (Bayesian Poisson + FIFA Elo Prior) model projections
 * for all 6 June 27 fixtures into wc2026_model_projections.
 * is_frozen=1 — these values are locked and will not be overwritten by live queries.
 *
 * [LOG] All operations logged with [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY] format.
 */

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ── Load v7.2 results ─────────────────────────────────────────────────────────
const RESULTS_PATH = "/home/ubuntu/june27_v72_results.json";
console.log(`[INPUT] Loading v7.2 results from: ${RESULTS_PATH}`);
const results = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
const matchIds = Object.keys(results);
console.log(`[INPUT] ${matchIds.length} fixtures to seed: ${matchIds.join(", ")}`);

// ── SMALLINT cap helper ───────────────────────────────────────────────────────
const SMALLINT_MAX = 32767;
const SMALLINT_MIN = -32768;
function capSmallInt(v) {
  if (v == null || isNaN(v)) return null;
  return Math.max(SMALLINT_MIN, Math.min(SMALLINT_MAX, Math.round(v)));
}

// ── Connect ───────────────────────────────────────────────────────────────────
console.log("[STEP] Connecting to database...");
const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log("[STATE] DB connected");

// ── Delete existing projections for these fixtures ────────────────────────────
console.log("[STEP] Deleting existing projections for June 27 fixtures...");
const [delResult] = await conn.execute(
  `DELETE FROM wc2026_model_projections WHERE match_id IN (${matchIds.map(() => "?").join(",")})`,
  matchIds
);
console.log(`[STATE] Deleted ${delResult.affectedRows} existing rows`);

// ── Insert v7.2 projections ───────────────────────────────────────────────────
let insertCount = 0;
for (const fid of matchIds) {
  const r = results[fid];
  console.log(`\n[STEP] Seeding ${fid}: ${r.home_code}(H) vs ${r.away_code}(A)`);
  console.log(`  [STATE] λH=${r.home_lam} λA=${r.away_lam} | proj: ${r.proj_home_score}-${r.proj_away_score} | total: ${r.proj_total}`);
  console.log(`  [STATE] H:${r.model_home_ml} D:${r.model_draw_ml} A:${r.model_away_ml}`);
  console.log(`  [STATE] BTTS Y:${r.model_btts_yes_ml} N:${r.model_btts_no_ml}`);
  console.log(`  [STATE] Spread ${r.book_home_spread}: H:${r.model_home_spread_ml} A:${r.model_away_spread_ml}`);
  console.log(`  [STATE] Total ${r.book_total_line}: O:${r.model_over_ml} U:${r.model_under_ml}`);
  console.log(`  [STATE] DC 1X:${r.model_dc_1x_ml} X2:${r.model_dc_x2_ml}`);

  const [ins] = await conn.execute(
    `INSERT INTO wc2026_model_projections (
      match_id, model_version, n_simulations,
      home_team, away_team,
      home_lambda, away_lambda,
      home_win_prob, draw_prob, away_win_prob,
      proj_home_score, proj_away_score, proj_total,
      proj_spread,
      model_home_ml, model_draw_ml, model_away_ml,
      model_total, model_total_raw,
      over_odds, under_odds,
      model_spread, model_spread_raw,
      home_spread_odds, away_spread_odds,
      dc_1x_odds, dc_x2_odds,
      no_draw_home_odds, no_draw_away_odds,
      btts_prob, btts_yes_odds, btts_no_odds,
      nv_home_prob, nv_draw_prob, nv_away_prob,
      nv_dc_1x, nv_dc_x2,
      nv_no_draw_home, nv_no_draw_away,
      home_edge, draw_edge, away_edge,
      model_lean, lean_prob,
      is_frozen, frozen_at, modeled_at
    ) VALUES (
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      1, NOW(), NOW()
    )`,
    [
      fid, r.model_version, r.n_sims,
      r.home_code, r.away_code,
      r.home_lam, r.away_lam,
      r.home_win_prob, r.draw_prob, r.away_win_prob,
      r.proj_home_score, r.proj_away_score, r.proj_total,
      r.model_spread_line,
      capSmallInt(r.model_home_ml), capSmallInt(r.model_draw_ml), capSmallInt(r.model_away_ml),
      r.model_total_line, r.proj_total,
      capSmallInt(r.model_over_ml), capSmallInt(r.model_under_ml),
      r.model_spread_line, r.model_spread_line,
      capSmallInt(r.model_home_spread_ml), capSmallInt(r.model_away_spread_ml),
      capSmallInt(r.model_dc_1x_ml), capSmallInt(r.model_dc_x2_ml),
      null, null, // no_draw_home/away — not computed in v7.2
      r.btts_prob, capSmallInt(r.model_btts_yes_ml), capSmallInt(r.model_btts_no_ml),
      r.home_win_prob, r.draw_prob, r.away_win_prob,
      r.dc_1x_prob, r.dc_x2_prob,
      r.home_win_prob, r.away_win_prob,
      0, 0, 0, // edges — not computed in v7.2
      r.home_win_prob > r.away_win_prob ? r.home_code : r.away_code,
      Math.max(r.home_win_prob, r.away_win_prob),
    ]
  );
  insertCount++;
  console.log(`  [VERIFY] PASS — inserted row for ${fid} (affectedRows=${ins.affectedRows})`);
}

// ── Final verification ────────────────────────────────────────────────────────
console.log("\n[STEP] Running final verification query...");
const [verRows] = await conn.execute(
  `SELECT match_id, model_version, model_home_ml, model_draw_ml, model_away_ml,
          proj_home_score, proj_away_score, proj_total, model_spread, model_total,
          btts_yes_odds, btts_no_odds, is_frozen, frozen_at
   FROM wc2026_model_projections
   WHERE match_id IN (${matchIds.map(() => "?").join(",")})
   ORDER BY match_id`,
  matchIds
);
console.log(`[OUTPUT] ${verRows.length}/${matchIds.length} rows verified in DB:`);
for (const row of verRows) {
  console.log(`  ${row.match_id}: H:${row.model_home_ml} D:${row.model_draw_ml} A:${row.model_away_ml} | ${row.proj_home_score}-${row.proj_away_score} | total:${row.proj_total} | spread:${row.model_spread} | BTTS Y:${row.btts_yes_odds} N:${row.btts_no_odds} | frozen:${row.is_frozen}`);
}

const allFrozen = verRows.every(r => r.is_frozen === 1);
const allPresent = verRows.length === matchIds.length;
console.log(`\n[VERIFY] ${allPresent ? "PASS" : "FAIL"} — all ${matchIds.length} rows present: ${allPresent}`);
console.log(`[VERIFY] ${allFrozen ? "PASS" : "FAIL"} — all rows is_frozen=1: ${allFrozen}`);
console.log(`[OUTPUT] Seeded ${insertCount}/${matchIds.length} v7.2 projections successfully`);

await conn.end();
console.log("[STATE] DB disconnected");
console.log("\n✅ v7.2 SEED COMPLETE — June 27 WC2026 model projections locked");
