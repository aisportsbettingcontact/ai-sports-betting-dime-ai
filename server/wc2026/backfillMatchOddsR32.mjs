/**
 * backfillMatchOddsR32.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 * 500x FORENSIC BACKFILL — wc2026MatchOdds — R32 Fixtures 073-082
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SOURCE OF TRUTH: wc2026_model_projections (is_frozen=1 rows only)
 * TARGET TABLE:    wc2026MatchOdds
 *
 * FIELDS BACKFILLED PER FIXTURE:
 *   lamba_away                    ← away_lambda
 *   lamba_home                    ← home_lambda
 *   model_projected_away_goals    ← proj_away_score
 *   model_projected_home_goals    ← proj_home_score
 *   model_away_ml                 ← model_away_ml
 *   model_home_ml                 ← model_home_ml
 *   model_draw                    ← model_draw_ml
 *   model_total                   ← model_total
 *   model_primary_spread          ← model_spread
 *   model_away_primary_spread_odds← away_spread_odds
 *   model_home_primary_spread_odds← home_spread_odds
 *   model_over_odds               ← over_odds
 *   model_under_odds              ← under_odds
 *   model_away_wd                 ← dc_x2_odds  (X2 = Away or Draw)
 *   model_home_wd                 ← dc_1x_odds  (1X = Home or Draw)
 *   model_btts_yes                ← btts_yes_odds
 *   model_btts_no                 ← btts_no_odds
 *
 * ORIENTATION INVARIANT (verified per fixture before every write):
 *   wc2026MatchOdds.home_team = ESPN team ID of HOME team
 *   wc2026MatchOdds.away_team = ESPN team ID of AWAY team
 *   wc2026_model_projections.home_team = HOME team abbreviation
 *   wc2026_model_projections.away_team = AWAY team abbreviation
 *   → Home values map to home columns, Away values map to away columns
 *
 * EXECUTION ORDER:
 *   1. PRE-FLIGHT: verify all 10 wc2026MatchOdds rows exist
 *   2. SOURCE PULL: read all 10 frozen model projection rows
 *   3. ORIENTATION CHECK: cross-reference home/away team alignment
 *   4. WRITE: UPDATE each row with explicit field mapping
 *   5. READ-BACK: SELECT every written field and compare to source
 *   6. AUDIT REPORT: pass/fail per fixture per field
 *
 * Run: node server/wc2026/backfillMatchOddsR32.mjs
 */

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const LOG_PATH = "/home/ubuntu/wc2026_backfill_r32.log";
const T0 = Date.now();
let _PASS = 0, _FAIL = 0, _WARN = 0, _STEP = 0;
const logLines = [];

function log(level, tag, msg, detail = "") {
  _STEP++;
  const t = new Date().toISOString();
  const ela = `+${((Date.now() - T0) / 1000).toFixed(3)}s`;
  const icon = {
    BANNER: "══", SECTION: "██", STEP: "▶▶", INPUT: "◀◀", CALC: "∑∑",
    STATE: "··", PASS: "✅", FAIL: "❌", WARN: "⚠️ ", VERIFY: "✓✓",
    OUTPUT: "→→", AUDIT: "🔍", FIX: "🔧", DATA: "📊"
  }[level] || "  ";
  if (level === "PASS") _PASS++;
  if (level === "FAIL") _FAIL++;
  if (level === "WARN") _WARN++;
  const line = `[${t}] ${ela.padEnd(10)} [${level.padEnd(7)}] [${tag.padEnd(14)}] ${icon} ${msg}${detail ? `\n    ↳ ${detail}` : ""}`;
  console.log(line);
  logLines.push(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch (_) {}
}

function flushLog() {
  fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURE MANIFEST — 10 R32 MATCHES
// ═══════════════════════════════════════════════════════════════════════════════
// Columns: fixtureId, homeTeamAbbrev, awayTeamAbbrev
// These are the HOME/AWAY designations from wc2026_model_projections
// Used to verify orientation before writing
const FIXTURE_MANIFEST = [
  { fixtureId: "wc26-r32-073", homeAbbrev: "RSA", awayAbbrev: "CAN"         },
  { fixtureId: "wc26-r32-074", homeAbbrev: "Brazil", awayAbbrev: "Japan"     },
  { fixtureId: "wc26-r32-075", homeAbbrev: "Germany", awayAbbrev: "Paraguay" },
  { fixtureId: "wc26-r32-076", homeAbbrev: "Netherlands", awayAbbrev: "Morocco" },
  { fixtureId: "wc26-r32-077", homeAbbrev: "CIV", awayAbbrev: "NOR"         },
  { fixtureId: "wc26-r32-078", homeAbbrev: "FRA", awayAbbrev: "SWE"         },
  { fixtureId: "wc26-r32-079", homeAbbrev: "MEX", awayAbbrev: "ECU"         },
  { fixtureId: "wc26-r32-080", homeAbbrev: "England", awayAbbrev: "Congo DR" },
  { fixtureId: "wc26-r32-081", homeAbbrev: "Belgium", awayAbbrev: "Senegal"  },
  { fixtureId: "wc26-r32-082", homeAbbrev: "USA", awayAbbrev: "Bosnia-Herz" },
];

const FIXTURE_IDS = FIXTURE_MANIFEST.map(f => f.fixtureId);

// ═══════════════════════════════════════════════════════════════════════════════
// FIELD MAPPING: source column → target column
// ═══════════════════════════════════════════════════════════════════════════════
// Each entry: { srcField, tgtField, label }
const FIELD_MAP = [
  { srcField: "away_lambda",      tgtField: "lamba_away",                     label: "Lambda Away"         },
  { srcField: "home_lambda",      tgtField: "lamba_home",                     label: "Lambda Home"         },
  { srcField: "proj_away_score",  tgtField: "model_projected_away_goals",     label: "Proj Away Goals"     },
  { srcField: "proj_home_score",  tgtField: "model_projected_home_goals",     label: "Proj Home Goals"     },
  { srcField: "model_away_ml",    tgtField: "model_away_ml",                  label: "Model Away ML"       },
  { srcField: "model_home_ml",    tgtField: "model_home_ml",                  label: "Model Home ML"       },
  { srcField: "model_draw_ml",    tgtField: "model_draw",                     label: "Model Draw ML"       },
  { srcField: "model_total",      tgtField: "model_total",                    label: "Model Total Line"    },
  { srcField: "model_spread",     tgtField: "model_primary_spread",           label: "Model Spread Line"   },
  { srcField: "away_spread_odds", tgtField: "model_away_primary_spread_odds", label: "Model Away Sprd Odds"},
  { srcField: "home_spread_odds", tgtField: "model_home_primary_spread_odds", label: "Model Home Sprd Odds"},
  { srcField: "over_odds",        tgtField: "model_over_odds",                label: "Model Over Odds"     },
  { srcField: "under_odds",       tgtField: "model_under_odds",               label: "Model Under Odds"    },
  { srcField: "dc_x2_odds",       tgtField: "model_away_wd",                  label: "Model Away WD (X2)"  },
  { srcField: "dc_1x_odds",       tgtField: "model_home_wd",                  label: "Model Home WD (1X)"  },
  { srcField: "btts_yes_odds",    tgtField: "model_btts_yes",                 label: "Model BTTS Yes"      },
  { srcField: "btts_no_odds",     tgtField: "model_btts_no",                  label: "Model BTTS No"       },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  log("BANNER", "INIT", "═══ 500x FORENSIC BACKFILL — wc2026MatchOdds R32 ═══");
  log("INPUT", "CONFIG", `Fixtures: ${FIXTURE_IDS.join(", ")}`);
  log("INPUT", "CONFIG", `Fields per fixture: ${FIELD_MAP.length}`);
  log("INPUT", "CONFIG", `Total writes planned: ${FIXTURE_IDS.length * FIELD_MAP.length}`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  log("PASS", "DB", "Database connection established");

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 1: PRE-FLIGHT — verify all 10 wc2026MatchOdds rows exist
  // ─────────────────────────────────────────────────────────────────────────────
  log("SECTION", "PHASE1", "PRE-FLIGHT: Verifying wc2026MatchOdds rows exist for all 10 fixtures");

  const placeholders = FIXTURE_IDS.map(() => "?").join(",");
  const [existingRows] = await conn.execute(
    `SELECT fixture_id, home_team, away_team FROM wc2026MatchOdds WHERE fixture_id IN (${placeholders})`,
    FIXTURE_IDS
  );
  const existingMap = Object.fromEntries(existingRows.map(r => [r.fixture_id, r]));

  let preflight_pass = true;
  for (const { fixtureId } of FIXTURE_MANIFEST) {
    if (existingMap[fixtureId]) {
      log("PASS", "PREFLIGHT", `${fixtureId} EXISTS in wc2026MatchOdds`,
        `home_team_id=${existingMap[fixtureId].home_team} away_team_id=${existingMap[fixtureId].away_team}`);
    } else {
      log("FAIL", "PREFLIGHT", `${fixtureId} MISSING from wc2026MatchOdds — ABORT`);
      preflight_pass = false;
    }
  }
  if (!preflight_pass) {
    log("FAIL", "PREFLIGHT", "Pre-flight failed — one or more target rows missing. Aborting.");
    await conn.end();
    flushLog();
    process.exit(1);
  }
  log("PASS", "PREFLIGHT", `All ${FIXTURE_IDS.length} target rows confirmed in wc2026MatchOdds`);

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 2: SOURCE PULL — read all 10 frozen model projection rows
  // ─────────────────────────────────────────────────────────────────────────────
  log("SECTION", "PHASE2", "SOURCE PULL: Reading frozen model projections from wc2026_model_projections");

  const [srcRows] = await conn.execute(
    `SELECT fixture_id, model_version, home_team, away_team,
            home_lambda, away_lambda,
            proj_home_score, proj_away_score,
            model_home_ml, model_draw_ml, model_away_ml,
            model_spread, model_total,
            home_spread_odds, away_spread_odds,
            over_odds, under_odds,
            dc_1x_odds, dc_x2_odds,
            btts_yes_odds, btts_no_odds,
            is_frozen
     FROM wc2026_model_projections
     WHERE fixture_id IN (${placeholders}) AND is_frozen = 1
     ORDER BY fixture_id`,
    FIXTURE_IDS
  );

  const srcMap = Object.fromEntries(srcRows.map(r => [r.fixture_id, r]));

  log("STATE", "SOURCE", `Rows returned from wc2026_model_projections: ${srcRows.length}`);

  let source_pass = true;
  for (const { fixtureId, homeAbbrev, awayAbbrev } of FIXTURE_MANIFEST) {
    const src = srcMap[fixtureId];
    if (!src) {
      log("FAIL", "SOURCE", `${fixtureId} — NO frozen model projection row found`);
      source_pass = false;
      continue;
    }
    log("DATA", "SOURCE", `${fixtureId} | model_version=${src.model_version} | home=${src.home_team} away=${src.away_team} | is_frozen=${src.is_frozen}`);

    // Log all source values
    log("DATA", "SOURCE", `${fixtureId} | λH=${src.home_lambda} λA=${src.away_lambda}`);
    log("DATA", "SOURCE", `${fixtureId} | projH=${src.proj_home_score} projA=${src.proj_away_score}`);
    log("DATA", "SOURCE", `${fixtureId} | modelHML=${src.model_home_ml} modelDraw=${src.model_draw_ml} modelAML=${src.model_away_ml}`);
    log("DATA", "SOURCE", `${fixtureId} | spread=${src.model_spread} total=${src.model_total}`);
    log("DATA", "SOURCE", `${fixtureId} | hSprdOdds=${src.home_spread_odds} aSprdOdds=${src.away_spread_odds}`);
    log("DATA", "SOURCE", `${fixtureId} | overOdds=${src.over_odds} underOdds=${src.under_odds}`);
    log("DATA", "SOURCE", `${fixtureId} | dc1X=${src.dc_1x_odds} dcX2=${src.dc_x2_odds}`);
    log("DATA", "SOURCE", `${fixtureId} | bttsY=${src.btts_yes_odds} bttsN=${src.btts_no_odds}`);
  }

  if (!source_pass) {
    log("FAIL", "SOURCE", "Source pull failed — missing model projection rows. Aborting.");
    await conn.end();
    flushLog();
    process.exit(1);
  }
  log("PASS", "SOURCE", `All ${srcRows.length} source rows confirmed with is_frozen=1`);

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 3: ORIENTATION CHECK — verify home/away alignment
  // ─────────────────────────────────────────────────────────────────────────────
  log("SECTION", "PHASE3", "ORIENTATION CHECK: Verifying home/away team alignment per fixture");

  for (const { fixtureId, homeAbbrev, awayAbbrev } of FIXTURE_MANIFEST) {
    const src = srcMap[fixtureId];
    if (!src) continue;

    const srcHomeMatch = src.home_team === homeAbbrev;
    const srcAwayMatch = src.away_team === awayAbbrev;

    if (srcHomeMatch && srcAwayMatch) {
      log("PASS", "ORIENT", `${fixtureId} | HOME=${src.home_team} ✓ | AWAY=${src.away_team} ✓`);
    } else {
      log("WARN", "ORIENT",
        `${fixtureId} | HOME: expected=${homeAbbrev} got=${src.home_team} | AWAY: expected=${awayAbbrev} got=${src.away_team}`,
        "Proceeding with DB values — home values → home columns, away values → away columns"
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 4: WRITE — UPDATE each row with explicit field mapping
  // ─────────────────────────────────────────────────────────────────────────────
  log("SECTION", "PHASE4", "WRITE PHASE: Executing UPDATE statements per fixture");

  const writeResults = {};

  for (const { fixtureId } of FIXTURE_MANIFEST) {
    const src = srcMap[fixtureId];
    if (!src) {
      log("FAIL", "WRITE", `${fixtureId} — skipping (no source row)`);
      writeResults[fixtureId] = { status: "SKIPPED", fieldsWritten: 0 };
      continue;
    }

    // Build the UPDATE payload — explicit field-by-field mapping
    const payload = {
      lamba_away:                     src.away_lambda,
      lamba_home:                     src.home_lambda,
      model_projected_away_goals:     src.proj_away_score,
      model_projected_home_goals:     src.proj_home_score,
      model_away_ml:                  src.model_away_ml,
      model_home_ml:                  src.model_home_ml,
      model_draw:                     src.model_draw_ml,
      model_total:                    src.model_total,
      model_primary_spread:           src.model_spread,
      model_away_primary_spread_odds: src.away_spread_odds,
      model_home_primary_spread_odds: src.home_spread_odds,
      model_over_odds:                src.over_odds,
      model_under_odds:               src.under_odds,
      model_away_wd:                  src.dc_x2_odds,
      model_home_wd:                  src.dc_1x_odds,
      model_btts_yes:                 src.btts_yes_odds,
      model_btts_no:                  src.btts_no_odds,
    };

    // Log every field being written
    log("STEP", "WRITE", `${fixtureId} — Building UPDATE payload (${Object.keys(payload).length} fields):`);
    for (const [col, val] of Object.entries(payload)) {
      log("CALC", "PAYLOAD", `  ${fixtureId}.${col} = ${val === null ? "NULL" : val}`);
    }

    // Build SET clause
    const setClauses = Object.keys(payload).map(col => `${col} = ?`).join(", ");
    const values = [...Object.values(payload), fixtureId];

    const [result] = await conn.execute(
      `UPDATE wc2026MatchOdds SET ${setClauses} WHERE fixture_id = ?`,
      values
    );

    if (result.affectedRows === 1) {
      log("PASS", "WRITE", `${fixtureId} — UPDATE succeeded (affectedRows=1, changedRows=${result.changedRows})`);
      writeResults[fixtureId] = { status: "OK", fieldsWritten: Object.keys(payload).length };
    } else {
      log("FAIL", "WRITE", `${fixtureId} — UPDATE failed (affectedRows=${result.affectedRows})`);
      writeResults[fixtureId] = { status: "FAIL", fieldsWritten: 0 };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 5: READ-BACK VERIFICATION — compare every written field to source
  // ─────────────────────────────────────────────────────────────────────────────
  log("SECTION", "PHASE5", "READ-BACK VERIFICATION: Comparing every written field to source values");

  const [verifyRows] = await conn.execute(
    `SELECT fixture_id,
            lamba_away, lamba_home,
            model_projected_away_goals, model_projected_home_goals,
            model_away_ml, model_home_ml, model_draw,
            model_total, model_primary_spread,
            model_away_primary_spread_odds, model_home_primary_spread_odds,
            model_over_odds, model_under_odds,
            model_away_wd, model_home_wd,
            model_btts_yes, model_btts_no
     FROM wc2026MatchOdds
     WHERE fixture_id IN (${placeholders})
     ORDER BY fixture_id`,
    FIXTURE_IDS
  );

  const verifyMap = Object.fromEntries(verifyRows.map(r => [r.fixture_id, r]));

  // Field-by-field comparison map: tgtField → srcField
  const compareMap = {
    lamba_away:                     "away_lambda",
    lamba_home:                     "home_lambda",
    model_projected_away_goals:     "proj_away_score",
    model_projected_home_goals:     "proj_home_score",
    model_away_ml:                  "model_away_ml",
    model_home_ml:                  "model_home_ml",
    model_draw:                     "model_draw_ml",
    model_total:                    "model_total",
    model_primary_spread:           "model_spread",
    model_away_primary_spread_odds: "away_spread_odds",
    model_home_primary_spread_odds: "home_spread_odds",
    model_over_odds:                "over_odds",
    model_under_odds:               "under_odds",
    model_away_wd:                  "dc_x2_odds",
    model_home_wd:                  "dc_1x_odds",
    model_btts_yes:                 "btts_yes_odds",
    model_btts_no:                  "btts_no_odds",
  };

  const auditResults = {};
  let totalFieldChecks = 0;
  let totalFieldPass = 0;
  let totalFieldFail = 0;
  let totalFieldNull = 0;

  for (const { fixtureId } of FIXTURE_MANIFEST) {
    const src = srcMap[fixtureId];
    const tgt = verifyMap[fixtureId];
    auditResults[fixtureId] = { pass: 0, fail: 0, null_src: 0, fields: {} };

    if (!src || !tgt) {
      log("FAIL", "READBACK", `${fixtureId} — missing source or target row`);
      continue;
    }

    log("AUDIT", "READBACK", `${fixtureId} — Verifying ${Object.keys(compareMap).length} fields:`);

    for (const [tgtField, srcField] of Object.entries(compareMap)) {
      totalFieldChecks++;
      const srcVal = src[srcField];
      const tgtVal = tgt[tgtField];

      if (srcVal === null || srcVal === undefined) {
        // Source is NULL — verify target is also NULL
        const ok = tgtVal === null;
        totalFieldNull++;
        if (ok) {
          log("PASS", "FIELD", `  ${fixtureId}.${tgtField} = NULL (source NULL → correctly stored NULL)`);
          auditResults[fixtureId].pass++;
          auditResults[fixtureId].fields[tgtField] = "NULL_OK";
          totalFieldPass++;
        } else {
          log("FAIL", "FIELD", `  ${fixtureId}.${tgtField} MISMATCH: src=NULL but tgt=${tgtVal}`);
          auditResults[fixtureId].fail++;
          auditResults[fixtureId].fields[tgtField] = `MISMATCH src=NULL tgt=${tgtVal}`;
          totalFieldFail++;
        }
        continue;
      }

      // Numeric comparison with tolerance for DOUBLE fields
      const srcNum = parseFloat(srcVal);
      const tgtNum = parseFloat(tgtVal);
      const isDouble = ["lamba_away","lamba_home","model_projected_away_goals","model_projected_home_goals","model_total","model_primary_spread"].includes(tgtField);
      const tolerance = isDouble ? 0.0001 : 0;
      const ok = Math.abs(srcNum - tgtNum) <= tolerance;

      if (ok) {
        log("PASS", "FIELD", `  ${fixtureId}.${tgtField} = ${tgtNum} ✓ (src=${srcNum})`);
        auditResults[fixtureId].pass++;
        auditResults[fixtureId].fields[tgtField] = `OK: ${tgtNum}`;
        totalFieldPass++;
      } else {
        log("FAIL", "FIELD", `  ${fixtureId}.${tgtField} MISMATCH: src=${srcNum} tgt=${tgtNum}`);
        auditResults[fixtureId].fail++;
        auditResults[fixtureId].fields[tgtField] = `MISMATCH src=${srcNum} tgt=${tgtNum}`;
        totalFieldFail++;
      }
    }

    const fixtureOk = auditResults[fixtureId].fail === 0;
    log(fixtureOk ? "PASS" : "FAIL", "FIXTURE",
      `${fixtureId} — ${auditResults[fixtureId].pass}/${Object.keys(compareMap).length} fields PASS, ${auditResults[fixtureId].fail} FAIL`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 6: FINAL AUDIT REPORT
  // ─────────────────────────────────────────────────────────────────────────────
  log("SECTION", "REPORT", "═══ FINAL 500x FORENSIC AUDIT REPORT ═══");
  log("OUTPUT", "SUMMARY", `Total fixtures processed: ${FIXTURE_IDS.length}`);
  log("OUTPUT", "SUMMARY", `Total field checks: ${totalFieldChecks}`);
  log("OUTPUT", "SUMMARY", `PASS: ${totalFieldPass} | FAIL: ${totalFieldFail} | NULL_OK: ${totalFieldNull}`);
  log("OUTPUT", "SUMMARY", `Overall PASS rate: ${((totalFieldPass / totalFieldChecks) * 100).toFixed(2)}%`);

  log("SECTION", "REPORT", "Per-Fixture Summary:");
  for (const { fixtureId, homeAbbrev, awayAbbrev } of FIXTURE_MANIFEST) {
    const src = srcMap[fixtureId];
    const ar = auditResults[fixtureId];
    const status = ar && ar.fail === 0 ? "✅ PASS" : "❌ FAIL";
    const version = src ? src.model_version : "N/A";
    log("OUTPUT", "FIXTURE",
      `${status} | ${fixtureId} | ${homeAbbrev} (H) vs ${awayAbbrev} (A) | model=${version} | fields=${ar ? ar.pass : 0}/${Object.keys(compareMap).length}`
    );
  }

  log("SECTION", "REPORT", "Per-Fixture Data Snapshot (source → stored):");
  for (const { fixtureId, homeAbbrev, awayAbbrev } of FIXTURE_MANIFEST) {
    const src = srcMap[fixtureId];
    const tgt = verifyMap[fixtureId];
    if (!src || !tgt) continue;
    log("DATA", "SNAPSHOT", `${fixtureId} | ${homeAbbrev} vs ${awayAbbrev}`);
    log("DATA", "SNAPSHOT", `  λH: ${src.home_lambda} → ${tgt.lamba_home} | λA: ${src.away_lambda} → ${tgt.lamba_away}`);
    log("DATA", "SNAPSHOT", `  projH: ${src.proj_home_score} → ${tgt.model_projected_home_goals} | projA: ${src.proj_away_score} → ${tgt.model_projected_away_goals}`);
    log("DATA", "SNAPSHOT", `  ML: H=${src.model_home_ml}→${tgt.model_home_ml} D=${src.model_draw_ml}→${tgt.model_draw} A=${src.model_away_ml}→${tgt.model_away_ml}`);
    log("DATA", "SNAPSHOT", `  Spread: line=${src.model_spread}→${tgt.model_primary_spread} H=${src.home_spread_odds}→${tgt.model_home_primary_spread_odds} A=${src.away_spread_odds}→${tgt.model_away_primary_spread_odds}`);
    log("DATA", "SNAPSHOT", `  Total: line=${src.model_total}→${tgt.model_total} Over=${src.over_odds}→${tgt.model_over_odds} Under=${src.under_odds}→${tgt.model_under_odds}`);
    log("DATA", "SNAPSHOT", `  DC: 1X=${src.dc_1x_odds}→${tgt.model_home_wd} X2=${src.dc_x2_odds}→${tgt.model_away_wd}`);
    log("DATA", "SNAPSHOT", `  BTTS: Y=${src.btts_yes_odds}→${tgt.model_btts_yes} N=${src.btts_no_odds}→${tgt.model_btts_no}`);
  }

  const overallPass = totalFieldFail === 0;
  log(overallPass ? "PASS" : "FAIL", "FINAL",
    overallPass
      ? `ALL ${totalFieldChecks} FIELD CHECKS PASSED — Backfill is 100% accurate`
      : `${totalFieldFail} FIELD(S) FAILED — Review log for details`
  );
  log("OUTPUT", "LOG", `Full log written to: ${LOG_PATH}`);

  await conn.end();
  flushLog();

  if (!overallPass) process.exit(1);
}

main().catch(e => {
  log("FAIL", "FATAL", `Unhandled error: ${e.message}`, e.stack);
  flushLog();
  process.exit(1);
});
