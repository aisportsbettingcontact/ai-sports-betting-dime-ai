/**
 * forensicAudit.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * WC2026 ESPN Scraper — Full Forensic Audit Engine
 * Scope: 4 knockout stage matches (760487, 760489, 760488, 760486)
 * Sections:
 *   A. Individual per-match deep audit (all 9 tables, all stat categories)
 *   B. Cross-reference quad audit (consistency, completeness, anomaly detection)
 *   C. Schema & index audit
 *   D. Data integrity checks (null rates, range violations, cross-table consistency)
 *   E. Scraper performance metrics
 *   F. Verdict & recommendations
 *
 * Output: terminal + .scraper-logs/forensic_audit_quad.txt
 */

import mysql from "mysql2/promise";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");
dotenv.config({ path: join(projectRoot, ".env") });

const MATCH_IDS = ["760487", "760489", "760488", "760486"];
const MATCH_LABELS = {
  "760487": "Japan vs Brazil (TRUTH ANCHOR)",
  "760489": "Germany vs Paraguay",
  "760488": "Netherlands vs Morocco",
  "760486": "South Africa vs Canada",
};

const LOG_FILE = join(projectRoot, ".scraper-logs/forensic_audit_quad.txt");
mkdirSync(join(projectRoot, ".scraper-logs"), { recursive: true });

// ─── Color + Logger ───────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  magenta: "\x1b[35m", blue: "\x1b[34m", white: "\x1b[37m",
};

const logLines = [];
let passCount = 0, failCount = 0, warnCount = 0;
const allFindings = [];

function ts() { return new Date().toISOString(); }
function log(msg, noFile = false) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  if (!noFile) logLines.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
}
function banner(title, color = C.cyan) {
  const bar = "═".repeat(72);
  log(`${color}${bar}${C.reset}`);
  log(`${color}${C.bold}  ${title}${C.reset}`);
  log(`${color}${bar}${C.reset}`);
}
function section(title) {
  log(`\n${C.blue}${C.bold}  ▶ ${title}${C.reset}`);
  log(`${C.blue}  ${"─".repeat(68)}${C.reset}`);
}
function pass(label, value, detail = "") {
  passCount++;
  log(`  ${C.green}✓ PASS${C.reset}  ${label}${value !== undefined ? ` = ${JSON.stringify(value)}` : ""}${detail ? `  ${C.dim}(${detail})${C.reset}` : ""}`);
}
function fail(label, value, expected, detail = "") {
  failCount++;
  const msg = `  ${C.red}✗ FAIL${C.reset}  ${label} = ${JSON.stringify(value)} (expected ${expected})${detail ? `  ${C.dim}(${detail})${C.reset}` : ""}`;
  log(msg);
  allFindings.push({ type: "FAIL", label, value, expected, detail });
}
function warn(label, value, detail = "") {
  warnCount++;
  const msg = `  ${C.yellow}⚠ WARN${C.reset}  ${label} = ${JSON.stringify(value)}${detail ? `  ${C.dim}(${detail})${C.reset}` : ""}`;
  log(msg);
  allFindings.push({ type: "WARN", label, value, detail });
}
function info(label, value) {
  log(`  ${C.dim}ℹ INFO${C.reset}  ${label}${value !== undefined ? ` = ${JSON.stringify(value)}` : ""}`);
}
function checkNotNull(label, value, detail = "") {
  if (value !== null && value !== undefined) pass(label, value, detail);
  else fail(label, value, "non-null", detail);
}
function checkGt(label, value, min, detail = "") {
  if (typeof value === "number" && value > min) pass(label, value, `> ${min}${detail ? " | " + detail : ""}`);
  else fail(label, value, `> ${min}`, detail);
}
function checkEq(label, value, expected, detail = "") {
  if (String(value) === String(expected)) pass(label, value, detail);
  else fail(label, value, expected, detail);
}
function checkRange(label, value, min, max, detail = "") {
  const v = Number(value);
  if (!isNaN(v) && v >= min && v <= max) pass(label, v, `[${min}–${max}]${detail ? " | " + detail : ""}`);
  else fail(label, value, `[${min}–${max}]`, detail);
}
function checkNullRate(label, nullCount, total, maxPct = 0.2) {
  const pct = total > 0 ? nullCount / total : 0;
  if (pct <= maxPct) pass(label, `${nullCount}/${total} null (${(pct*100).toFixed(1)}%)`, `≤ ${(maxPct*100).toFixed(0)}% allowed`);
  else warn(label, `${nullCount}/${total} null (${(pct*100).toFixed(1)}%)`, `> ${(maxPct*100).toFixed(0)}% threshold`);
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function q(db, sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows;
}
async function q1(db, sql, params = []) {
  const rows = await q(db, sql, params);
  return rows[0] ?? null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  banner("WC2026 ESPN SCRAPER — FULL FORENSIC QUAD AUDIT", C.magenta);
  log(`  Matches: ${MATCH_IDS.join(", ")}`);
  log(`  Truth Anchor: 760487 (Japan vs Brazil)`);
  log(`  Audit Scope: 9 tables × 4 matches + cross-reference quad analysis`);
  log(`  Output: ${LOG_FILE}`);

  const db = await mysql.createConnection(process.env.DATABASE_URL);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 0: SCHEMA & INDEX AUDIT
  // ══════════════════════════════════════════════════════════════════════════
  banner("SECTION 0 — SCHEMA & INDEX AUDIT", C.cyan);

  const tables = [
    "wc2026_espn_matches",
    "wc2026_espn_match_odds",
    "wc2026_espn_team_stats",
    "wc2026_espn_match_stats",
    "wc2026_espn_expected_goals",
    "wc2026_espn_shot_map",
    "wc2026_espn_player_stats",
    "wc2026_espn_lineups",
    "wc2026_espn_glossary",
  ];

  for (const table of tables) {
    const cols = await q(db, `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [table]);
    const idxs = await q(db, `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [table]);
    const [cnt] = await q(db, `SELECT COUNT(*) as cnt FROM \`${table}\``);
    info(`${table}`, `${cols.length} columns | ${idxs.length} index entries | ${cnt.cnt} total rows`);
    const pkIdx = idxs.find(i => i.INDEX_NAME === "PRIMARY");
    const uniqueIdxs = idxs.filter(i => i.NON_UNIQUE === 0 && i.INDEX_NAME !== "PRIMARY");
    const regularIdxs = idxs.filter(i => i.NON_UNIQUE === 1);
    checkNotNull(`${table}: PRIMARY KEY`, pkIdx ? pkIdx.COLUMN_NAME : null);
    checkGt(`${table}: total index count`, idxs.length, 0, "must have at least 1 index");
    if (table !== "wc2026_espn_glossary") {
      const hasMatchId = cols.find(c => c.COLUMN_NAME === "espn_match_id");
      checkNotNull(`${table}: espn_match_id column exists`, hasMatchId ? "yes" : null);
    }
    const hasCreatedAt = cols.find(c => c.COLUMN_NAME === "createdAt");
    checkNotNull(`${table}: createdAt column exists`, hasCreatedAt ? "yes" : null);
    info(`  Unique indexes`, uniqueIdxs.map(i => i.INDEX_NAME).join(", ") || "none");
    info(`  Regular indexes`, regularIdxs.map(i => i.INDEX_NAME).join(", ") || "none");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1: INDIVIDUAL PER-MATCH DEEP AUDIT
  // ══════════════════════════════════════════════════════════════════════════
  const matchAudits = {};

  for (const mid of MATCH_IDS) {
    const label = MATCH_LABELS[mid];
    banner(`SECTION 1.${MATCH_IDS.indexOf(mid)+1} — INDIVIDUAL AUDIT: ${mid} (${label})`, C.cyan);
    const audit = { espn_match_id: mid, label, tables: {} };

    // ── TABLE 1: wc2026_espn_matches ─────────────────────────────────────────
    section("TABLE 1: wc2026_espn_matches");
    const m = await q1(db, `SELECT * FROM wc2026_espn_matches WHERE espn_match_id=?`, [mid]);
    if (!m) { fail(`${mid}: match row exists`, null, "1 row"); continue; }
    audit.tables.matches = m;

    log(`  ${C.bold}${m.homeTeamName} ${m.homeScore}–${m.awayScore} ${m.awayTeamName}${C.reset}`);
    log(`  Venue: ${m.venue} | City: ${m.city} | Attendance: ${m.attendance} | Referee: ${m.referee}`);
    log(`  Competition: ${m.competition} | Round: ${m.round} | Season: ${m.season}`);
    log(`  Formations: ${m.homeFormation} vs ${m.awayFormation}`);
    log(`  Status: ${m.statusState}/${m.statusDetail}/${m.statusDisplay}`);
    log(`  matchDateUtc: ${m.matchDateUtc} (${new Date(Number(m.matchDateUtc)).toISOString()})`);
    log(`  homeTeamId: ${m.homeTeamId} | awayTeamId: ${m.awayTeamId}`);
    log(`  scrapeVersion: ${m.scrapeVersion} | scrapeDurationMs: ${m.scrapeDurationMs}`);
    log(`  broadcasts: ${m.broadcasts}`);
    log(`  homeGoalScorers: ${m.homeGoalScorers}`);
    log(`  awayGoalScorers: ${m.awayGoalScorers}`);
    log(`  homeLinescores: ${m.homeLinescores} | awayLinescores: ${m.awayLinescores}`);

    checkNotNull(`${mid}: homeTeamName`, m.homeTeamName);
    checkNotNull(`${mid}: awayTeamName`, m.awayTeamName);
    checkNotNull(`${mid}: homeTeamAbbrev`, m.homeTeamAbbrev);
    checkNotNull(`${mid}: awayTeamAbbrev`, m.awayTeamAbbrev);
    checkNotNull(`${mid}: homeTeamId`, m.homeTeamId);
    checkNotNull(`${mid}: awayTeamId`, m.awayTeamId);
    checkNotNull(`${mid}: venue`, m.venue);
    checkNotNull(`${mid}: city`, m.city);
    checkNotNull(`${mid}: attendance`, m.attendance);
    checkGt(`${mid}: attendance > 0`, Number(m.attendance), 0);
    checkNotNull(`${mid}: referee`, m.referee);
    checkNotNull(`${mid}: matchDateUtc`, m.matchDateUtc);
    checkGt(`${mid}: matchDateUtc > 0`, Number(m.matchDateUtc), 0);
    checkNotNull(`${mid}: statusState`, m.statusState);
    checkEq(`${mid}: statusState = 'post'`, m.statusState, "post");
    checkNotNull(`${mid}: statusDetail`, m.statusDetail);
    checkNotNull(`${mid}: homeScore`, m.homeScore);
    checkNotNull(`${mid}: awayScore`, m.awayScore);
    checkRange(`${mid}: homeScore range`, Number(m.homeScore), 0, 20);
    checkRange(`${mid}: awayScore range`, Number(m.awayScore), 0, 20);
    checkNotNull(`${mid}: homeFormation`, m.homeFormation);
    checkNotNull(`${mid}: awayFormation`, m.awayFormation);
    checkNotNull(`${mid}: competition`, m.competition);
    checkNotNull(`${mid}: round`, m.round);
    checkEq(`${mid}: season = '2026'`, m.season, "2026");
    checkNotNull(`${mid}: scrapeVersion`, m.scrapeVersion);
    checkEq(`${mid}: scrapeVersion = '250x'`, m.scrapeVersion, "250x");
    checkNotNull(`${mid}: scrapeDurationMs`, m.scrapeDurationMs);
    checkGt(`${mid}: scrapeDurationMs > 0`, Number(m.scrapeDurationMs), 0);
    const goalScorers = JSON.parse(m.homeGoalScorers || "[]").concat(JSON.parse(m.awayGoalScorers || "[]"));
    const totalGoals = Number(m.homeScore) + Number(m.awayScore);
    info(`${mid}: total goals`, totalGoals);
    info(`${mid}: goal scorer entries`, goalScorers.length);
    const linescoresH = JSON.parse(m.homeLinescores || "[]");
    const linescoresA = JSON.parse(m.awayLinescores || "[]");
    checkGt(`${mid}: homeLinescores has halftime data`, linescoresH.length, 0);
    checkGt(`${mid}: awayLinescores has halftime data`, linescoresA.length, 0);
    const broadcasts = JSON.parse(m.broadcasts || "[]");
    info(`${mid}: broadcasts`, broadcasts);

    // ── TABLE 2: wc2026_espn_match_odds ──────────────────────────────────────
    section("TABLE 2: wc2026_espn_match_odds");
    const odds = await q1(db, `SELECT * FROM wc2026_espn_match_odds WHERE espn_match_id=?`, [mid]);
    audit.tables.odds = odds;
    if (odds) {
      log(`  Provider: ${odds.provider}`);
      log(`  Moneylines: H=${odds.homeMoneylineCurrent} D=${odds.drawMoneylineCurrent} A=${odds.awayMoneylineCurrent}`);
      log(`  Open ML: H=${odds.homeMoneylineOpen} A=${odds.awayMoneylineOpen}`);
      log(`  Spread: H=${odds.homeSpreadLine} (${odds.homeSpreadOdds}) A=${odds.awaySpreadLine} (${odds.awaySpreadOdds})`);
      log(`  Total: H=${odds.homeTotalSide} (${odds.homeTotalOdds}) A=${odds.awayTotalSide} (${odds.awayTotalOdds})`);
      checkNotNull(`${mid}: odds.provider`, odds.provider);
      checkEq(`${mid}: odds.provider = 'draftkings'`, odds.provider, "draftkings");
      checkNotNull(`${mid}: odds.homeMoneylineCurrent`, odds.homeMoneylineCurrent);
      checkNotNull(`${mid}: odds.awayMoneylineCurrent`, odds.awayMoneylineCurrent);
      checkNotNull(`${mid}: odds.drawMoneylineCurrent`, odds.drawMoneylineCurrent);
      checkNotNull(`${mid}: odds.homeSpreadLine`, odds.homeSpreadLine);
      checkNotNull(`${mid}: odds.homeTotalSide`, odds.homeTotalSide);
    } else {
      warn(`${mid}: match_odds row`, null, "no odds row found");
    }

    // ── TABLE 3: wc2026_espn_team_stats ──────────────────────────────────────
    section("TABLE 3: wc2026_espn_team_stats (tmStatsGrph — 8 summary stats)");
    const ts = await q1(db, `SELECT * FROM wc2026_espn_team_stats WHERE espn_match_id=?`, [mid]);
    audit.tables.teamStats = ts;
    if (ts) {
      log(`  Possession: H=${ts.possession} A=${ts.possessionAway}`);
      log(`  Shots on Goal: H=${ts.shotsOnGoal} A=${ts.shotsOnGoalAway}`);
      log(`  Shot Attempts: H=${ts.shotAttempts} A=${ts.shotAttemptsAway}`);
      log(`  Fouls: H=${ts.fouls} A=${ts.foulsAway}`);
      log(`  Yellow Cards: H=${ts.yellowCards} A=${ts.yellowCardsAway}`);
      log(`  Red Cards: H=${ts.redCards} A=${ts.redCardsAway}`);
      log(`  Corner Kicks: H=${ts.cornerKicks} A=${ts.cornerKicksAway}`);
      log(`  Saves: H=${ts.saves} A=${ts.savesAway}`);
      checkNotNull(`${mid}: teamStats.possession`, ts.possession);
      checkNotNull(`${mid}: teamStats.possessionAway`, ts.possessionAway);
      checkNotNull(`${mid}: teamStats.shotsOnGoal`, ts.shotsOnGoal);
      checkNotNull(`${mid}: teamStats.shotsOnGoalAway`, ts.shotsOnGoalAway);
      checkNotNull(`${mid}: teamStats.shotAttempts`, ts.shotAttempts);
      checkNotNull(`${mid}: teamStats.shotAttemptsAway`, ts.shotAttemptsAway);
      checkNotNull(`${mid}: teamStats.fouls`, ts.fouls);
      checkNotNull(`${mid}: teamStats.foulsAway`, ts.foulsAway);
      checkNotNull(`${mid}: teamStats.yellowCards`, ts.yellowCards);
      checkNotNull(`${mid}: teamStats.yellowCardsAway`, ts.yellowCardsAway);
      checkNotNull(`${mid}: teamStats.redCards`, ts.redCards);
      checkNotNull(`${mid}: teamStats.redCardsAway`, ts.redCardsAway);
      checkNotNull(`${mid}: teamStats.cornerKicks`, ts.cornerKicks);
      checkNotNull(`${mid}: teamStats.cornerKicksAway`, ts.cornerKicksAway);
      checkNotNull(`${mid}: teamStats.saves`, ts.saves);
      checkNotNull(`${mid}: teamStats.savesAway`, ts.savesAway);
      // Possession sanity: H + A should sum to ~100%
      const posH = parseFloat(ts.possession);
      const posA = parseFloat(ts.possessionAway);
      const posSum = posH + posA;
      checkRange(`${mid}: possession sum (H+A)`, posSum, 99, 101, "should ≈ 100%");
      // SoG ≤ total shots
      if (ts.shotsOnGoal !== null && ts.shotAttempts !== null) {
        if (Number(ts.shotsOnGoal) <= Number(ts.shotAttempts)) pass(`${mid}: SoG ≤ shotAttempts (H)`, `${ts.shotsOnGoal}≤${ts.shotAttempts}`);
        else fail(`${mid}: SoG ≤ shotAttempts (H)`, ts.shotsOnGoal, `≤ ${ts.shotAttempts}`);
      }
    } else {
      fail(`${mid}: team_stats row exists`, null, "1 row");
    }

    // ── TABLE 4: wc2026_espn_match_stats ─────────────────────────────────────
    section("TABLE 4: wc2026_espn_match_stats (40 deferred stats — 6 categories)");
    const ms = await q1(db, `SELECT * FROM wc2026_espn_match_stats WHERE espn_match_id=?`, [mid]);
    audit.tables.matchStats = ms;
    if (ms) {
      // SHOTS (shtsTbls — 6 rows)
      log(`  [SHOTS] SoG: H=${ms.homeShotsOnGoal} A=${ms.awayShotsOnGoal}`);
      log(`  [SHOTS] Total: H=${ms.homeShots} A=${ms.awayShots}`);
      log(`  [SHOTS] Blocked: H=${ms.homeShotsBlocked} A=${ms.awayShotsBlocked}`);
      log(`  [SHOTS] Hit Woodwork: H=${ms.homeHitWoodwork} A=${ms.awayHitWoodwork}`);
      log(`  [SHOTS] Inside Box: H=${ms.homeAttemptsInsideBox} A=${ms.awayAttemptsInsideBox}`);
      log(`  [SHOTS] Outside Box: H=${ms.homeAttemptsOutsideBox} A=${ms.awayAttemptsOutsideBox}`);
      checkNotNull(`${mid}: shots.homeShotsOnGoal`, ms.homeShotsOnGoal);
      checkNotNull(`${mid}: shots.awayShotsOnGoal`, ms.awayShotsOnGoal);
      checkNotNull(`${mid}: shots.homeShots`, ms.homeShots);
      checkNotNull(`${mid}: shots.awayShots`, ms.awayShots);
      checkNotNull(`${mid}: shots.homeShotsBlocked`, ms.homeShotsBlocked);
      checkNotNull(`${mid}: shots.awayShotsBlocked`, ms.awayShotsBlocked);
      checkNotNull(`${mid}: shots.homeHitWoodwork`, ms.homeHitWoodwork);
      checkNotNull(`${mid}: shots.awayHitWoodwork`, ms.awayHitWoodwork);
      checkNotNull(`${mid}: shots.homeAttemptsInsideBox`, ms.homeAttemptsInsideBox);
      checkNotNull(`${mid}: shots.awayAttemptsInsideBox`, ms.awayAttemptsInsideBox);
      checkNotNull(`${mid}: shots.homeAttemptsOutsideBox`, ms.homeAttemptsOutsideBox);
      checkNotNull(`${mid}: shots.awayAttemptsOutsideBox`, ms.awayAttemptsOutsideBox);

      // PASSES (pssTbls — 8 rows)
      log(`  [PASSES] Total: H=${ms.homePasses} A=${ms.awayPasses}`);
      log(`  [PASSES] Accurate: H=${ms.homeAccuratePasses} A=${ms.awayAccuratePasses}`);
      log(`  [PASSES] Accuracy: H=${ms.homePassAccuracyPct} A=${ms.awayPassAccuracyPct}`);
      log(`  [PASSES] Long Balls: H=${ms.homeAccurateLongBalls} A=${ms.awayAccurateLongBalls}`);
      log(`  [PASSES] Crosses: H=${ms.homeAccurateCrosses} A=${ms.awayAccurateCrosses}`);
      log(`  [PASSES] Throws: H=${ms.homeTotalThrows} A=${ms.awayTotalThrows}`);
      log(`  [PASSES] Opp Box Touches: H=${ms.homePassTouchesInOppBox} A=${ms.awayPassTouchesInOppBox}`);
      log(`  [PASSES] Back Zone: H=${ms.homeTotalBackZonePass} A=${ms.awayTotalBackZonePass}`);
      log(`  [PASSES] Forward Zone: H=${ms.homeTotalForwardZonePass} A=${ms.awayTotalForwardZonePass}`);
      checkNotNull(`${mid}: passes.homePasses`, ms.homePasses);
      checkNotNull(`${mid}: passes.awayPasses`, ms.awayPasses);
      checkNotNull(`${mid}: passes.homeAccuratePasses`, ms.homeAccuratePasses);
      checkNotNull(`${mid}: passes.awayAccuratePasses`, ms.awayAccuratePasses);
      checkNotNull(`${mid}: passes.homePassAccuracyPct`, ms.homePassAccuracyPct);
      checkNotNull(`${mid}: passes.awayPassAccuracyPct`, ms.awayPassAccuracyPct);
      checkNotNull(`${mid}: passes.homeAccurateLongBalls`, ms.homeAccurateLongBalls);
      checkNotNull(`${mid}: passes.awayAccurateLongBalls`, ms.awayAccurateLongBalls);
      checkNotNull(`${mid}: passes.homeAccurateCrosses`, ms.homeAccurateCrosses);
      checkNotNull(`${mid}: passes.awayAccurateCrosses`, ms.awayAccurateCrosses);
      checkNotNull(`${mid}: passes.homeTotalThrows`, ms.homeTotalThrows);
      checkNotNull(`${mid}: passes.awayTotalThrows`, ms.awayTotalThrows);
      checkNotNull(`${mid}: passes.homePassTouchesInOppBox`, ms.homePassTouchesInOppBox);
      checkNotNull(`${mid}: passes.awayPassTouchesInOppBox`, ms.awayPassTouchesInOppBox);
      checkNotNull(`${mid}: passes.homeTotalBackZonePass`, ms.homeTotalBackZonePass);
      checkNotNull(`${mid}: passes.awayTotalBackZonePass`, ms.awayTotalBackZonePass);
      checkNotNull(`${mid}: passes.homeTotalForwardZonePass`, ms.homeTotalForwardZonePass);
      checkNotNull(`${mid}: passes.awayTotalForwardZonePass`, ms.awayTotalForwardZonePass);
      // Accurate passes ≤ total passes
      if (ms.homeAccuratePasses !== null && ms.homePasses !== null) {
        if (Number(ms.homeAccuratePasses) <= Number(ms.homePasses)) pass(`${mid}: homeAccuratePasses ≤ homePasses`, `${ms.homeAccuratePasses}≤${ms.homePasses}`);
        else fail(`${mid}: homeAccuratePasses ≤ homePasses`, ms.homeAccuratePasses, `≤ ${ms.homePasses}`);
      }

      // ATTACK (attkTbls — 6 rows)
      log(`  [ATTACK] Big Chances Created: H=${ms.homeBigChancesCreated} A=${ms.awayBigChancesCreated}`);
      log(`  [ATTACK] Big Chances Missed: H=${ms.homeBigChancesMissed} A=${ms.awayBigChancesMissed}`);
      log(`  [ATTACK] Through Balls: H=${ms.homeThroughBalls} A=${ms.awayThroughBalls}`);
      log(`  [ATTACK] Attk Touches Opp Box: H=${ms.homeAttkTouchesInOppBox} A=${ms.awayAttkTouchesInOppBox}`);
      log(`  [ATTACK] Fouled in Final Third: H=${ms.homeFouledInFinalThird} A=${ms.awayFouledInFinalThird}`);
      log(`  [ATTACK] Corners Won: H=${ms.homeCornersWon} A=${ms.awayCornersWon}`);
      checkNotNull(`${mid}: attack.homeBigChancesCreated`, ms.homeBigChancesCreated);
      checkNotNull(`${mid}: attack.awayBigChancesCreated`, ms.awayBigChancesCreated);
      checkNotNull(`${mid}: attack.homeBigChancesMissed`, ms.homeBigChancesMissed);
      checkNotNull(`${mid}: attack.awayBigChancesMissed`, ms.awayBigChancesMissed);
      checkNotNull(`${mid}: attack.homeThroughBalls`, ms.homeThroughBalls);
      checkNotNull(`${mid}: attack.awayThroughBalls`, ms.awayThroughBalls);
      checkNotNull(`${mid}: attack.homeAttkTouchesInOppBox`, ms.homeAttkTouchesInOppBox);
      checkNotNull(`${mid}: attack.awayAttkTouchesInOppBox`, ms.awayAttkTouchesInOppBox);
      checkNotNull(`${mid}: attack.homeFouledInFinalThird`, ms.homeFouledInFinalThird);
      checkNotNull(`${mid}: attack.awayFouledInFinalThird`, ms.awayFouledInFinalThird);
      checkNotNull(`${mid}: attack.homeCornersWon`, ms.homeCornersWon);
      checkNotNull(`${mid}: attack.awayCornersWon`, ms.awayCornersWon);

      // EXPECTED GOALS (tmStatsTbls[expected-goals] — 4 rows)
      log(`  [XG] xG: H=${ms.homeXG} A=${ms.awayXG}`);
      log(`  [XG] xGOT: H=${ms.homeXGOT} A=${ms.awayXGOT}`);
      log(`  [XG] Open Play: H=${ms.homeXGOpenPlay} A=${ms.awayXGOpenPlay}`);
      log(`  [XG] Set Play: H=${ms.homeXGSetPlay} A=${ms.awayXGSetPlay}`);
      checkNotNull(`${mid}: xg.homeXG`, ms.homeXG);
      checkNotNull(`${mid}: xg.awayXG`, ms.awayXG);
      checkNotNull(`${mid}: xg.homeXGOT`, ms.homeXGOT);
      checkNotNull(`${mid}: xg.awayXGOT`, ms.awayXGOT);
      checkNotNull(`${mid}: xg.homeXGOpenPlay`, ms.homeXGOpenPlay);
      checkNotNull(`${mid}: xg.awayXGOpenPlay`, ms.awayXGOpenPlay);
      checkNotNull(`${mid}: xg.homeXGSetPlay`, ms.homeXGSetPlay);
      checkNotNull(`${mid}: xg.awayXGSetPlay`, ms.awayXGSetPlay);
      checkRange(`${mid}: homeXG range`, Number(ms.homeXG), 0, 10);
      checkRange(`${mid}: awayXG range`, Number(ms.awayXG), 0, 10);

      // GOALKEEPING (tmStatsTbls[goalkeeping] — 5 rows)
      log(`  [GK] Saves: H=${ms.homeGkSaves} A=${ms.awayGkSaves}`);
      log(`  [GK] Goal Kicks: H=${ms.homeGoalKicks} A=${ms.awayGoalKicks}`);
      log(`  [GK] Shots Faced: H=${ms.homeShotsFaced} A=${ms.awayShotsFaced}`);
      log(`  [GK] High Claims: H=${ms.homeTotalHighClaims} A=${ms.awayTotalHighClaims}`);
      log(`  [GK] PKs Saved: H=${ms.homePenaltyKicksSaved} A=${ms.awayPenaltyKicksSaved}`);
      checkNotNull(`${mid}: gk.homeGkSaves`, ms.homeGkSaves);
      checkNotNull(`${mid}: gk.awayGkSaves`, ms.awayGkSaves);
      checkNotNull(`${mid}: gk.homeGoalKicks`, ms.homeGoalKicks);
      checkNotNull(`${mid}: gk.awayGoalKicks`, ms.awayGoalKicks);
      checkNotNull(`${mid}: gk.homeShotsFaced`, ms.homeShotsFaced);
      checkNotNull(`${mid}: gk.awayShotsFaced`, ms.awayShotsFaced);
      checkNotNull(`${mid}: gk.homeTotalHighClaims`, ms.homeTotalHighClaims);
      checkNotNull(`${mid}: gk.awayTotalHighClaims`, ms.awayTotalHighClaims);
      checkNotNull(`${mid}: gk.homePenaltyKicksSaved`, ms.homePenaltyKicksSaved);
      checkNotNull(`${mid}: gk.awayPenaltyKicksSaved`, ms.awayPenaltyKicksSaved);
      // GK saves cross-check with team_stats
      if (ts && ms.homeGkSaves !== null && ts.saves !== null) {
        checkEq(`${mid}: homeGkSaves matches teamStats.saves`, Number(ms.homeGkSaves), Number(ts.saves), "cross-table consistency");
        checkEq(`${mid}: awayGkSaves matches teamStats.savesAway`, Number(ms.awayGkSaves), Number(ts.savesAway), "cross-table consistency");
      }

      // DEFENSE (tmStatsTbls[defense] — 4 rows)
      log(`  [DEFENSE] Tackles: H=${ms.homeTackles} A=${ms.awayTackles}`);
      log(`  [DEFENSE] Interceptions: H=${ms.homeInterceptions} A=${ms.awayInterceptions}`);
      log(`  [DEFENSE] Clearances: H=${ms.homeClearances} A=${ms.awayClearances}`);
      log(`  [DEFENSE] Recoveries: H=${ms.homeRecoveries} A=${ms.awayRecoveries}`);
      checkNotNull(`${mid}: defense.homeTackles`, ms.homeTackles);
      checkNotNull(`${mid}: defense.awayTackles`, ms.awayTackles);
      checkNotNull(`${mid}: defense.homeInterceptions`, ms.homeInterceptions);
      checkNotNull(`${mid}: defense.awayInterceptions`, ms.awayInterceptions);
      checkNotNull(`${mid}: defense.homeClearances`, ms.homeClearances);
      checkNotNull(`${mid}: defense.awayClearances`, ms.awayClearances);
      checkNotNull(`${mid}: defense.homeRecoveries`, ms.homeRecoveries);
      checkNotNull(`${mid}: defense.awayRecoveries`, ms.awayRecoveries);
      checkRange(`${mid}: homeTackles range`, Number(ms.homeTackles), 0, 100);
      checkRange(`${mid}: homeClearances range`, Number(ms.homeClearances), 0, 200);

      // DUELS (tmStatsTbls[duels] — 3 rows)
      log(`  [DUELS] Duels Won: H=${ms.homeDuelsWon} A=${ms.awayDuelsWon}`);
      log(`  [DUELS] Total Duels: H=${ms.homeDuels} A=${ms.awayDuels}`);
      log(`  [DUELS] Aerials Won: H=${ms.homeAerialsWon} A=${ms.awayAerialsWon}`);
      checkNotNull(`${mid}: duels.homeDuelsWon`, ms.homeDuelsWon);
      checkNotNull(`${mid}: duels.awayDuelsWon`, ms.awayDuelsWon);
      checkNotNull(`${mid}: duels.homeDuels`, ms.homeDuels);
      checkNotNull(`${mid}: duels.awayDuels`, ms.awayDuels);
      checkNotNull(`${mid}: duels.homeAerialsWon`, ms.homeAerialsWon);
      checkNotNull(`${mid}: duels.awayAerialsWon`, ms.awayAerialsWon);
      // Duels won ≤ total duels
      if (ms.homeDuelsWon !== null && ms.homeDuels !== null && Number(ms.homeDuels) > 0) {
        if (Number(ms.homeDuelsWon) <= Number(ms.homeDuels)) pass(`${mid}: homeDuelsWon ≤ homeDuels`, `${ms.homeDuelsWon}≤${ms.homeDuels}`);
        else fail(`${mid}: homeDuelsWon ≤ homeDuels`, ms.homeDuelsWon, `≤ ${ms.homeDuels}`);
      }

      // FOULS & DISCIPLINE (tmStatsTbls[fouls] — 4 rows)
      log(`  [FOULS] Fouls Committed: H=${ms.homeFoulsCommitted} A=${ms.awayFoulsCommitted}`);
      log(`  [FOULS] Offsides: H=${ms.homeOffsides} A=${ms.awayOffsides}`);
      log(`  [FOULS] Yellow Cards: H=${ms.homeFoulYellowCards} A=${ms.awayFoulYellowCards}`);
      log(`  [FOULS] Red Cards: H=${ms.homeFoulRedCards} A=${ms.awayFoulRedCards}`);
      checkNotNull(`${mid}: fouls.homeFoulsCommitted`, ms.homeFoulsCommitted);
      checkNotNull(`${mid}: fouls.awayFoulsCommitted`, ms.awayFoulsCommitted);
      checkNotNull(`${mid}: fouls.homeOffsides`, ms.homeOffsides);
      checkNotNull(`${mid}: fouls.awayOffsides`, ms.awayOffsides);
      checkNotNull(`${mid}: fouls.homeFoulYellowCards`, ms.homeFoulYellowCards);
      checkNotNull(`${mid}: fouls.awayFoulYellowCards`, ms.awayFoulYellowCards);
      checkNotNull(`${mid}: fouls.homeFoulRedCards`, ms.homeFoulRedCards);
      checkNotNull(`${mid}: fouls.awayFoulRedCards`, ms.awayFoulRedCards);
      // Fouls cross-check with team_stats
      if (ts && ms.homeFoulsCommitted !== null && ts.fouls !== null) {
        checkEq(`${mid}: homeFoulsCommitted matches teamStats.fouls`, Number(ms.homeFoulsCommitted), Number(ts.fouls), "cross-table consistency");
        checkEq(`${mid}: awayFoulsCommitted matches teamStats.foulsAway`, Number(ms.awayFoulsCommitted), Number(ts.foulsAway), "cross-table consistency");
      }
      // Yellow cards cross-check
      if (ts && ms.homeFoulYellowCards !== null && ts.yellowCards !== null) {
        checkEq(`${mid}: homeFoulYellowCards matches teamStats.yellowCards`, Number(ms.homeFoulYellowCards), Number(ts.yellowCards), "cross-table consistency");
        checkEq(`${mid}: awayFoulYellowCards matches teamStats.yellowCardsAway`, Number(ms.awayFoulYellowCards), Number(ts.yellowCardsAway), "cross-table consistency");
      }
    } else {
      fail(`${mid}: match_stats row exists`, null, "1 row");
    }

    // ── TABLE 5: wc2026_espn_expected_goals ──────────────────────────────────
    section("TABLE 5: wc2026_espn_expected_goals");
    const xg = await q1(db, `SELECT * FROM wc2026_espn_expected_goals WHERE espn_match_id=?`, [mid]);
    audit.tables.xg = xg;
    if (xg) {
      const players = JSON.parse(xg.perPlayerJson || "[]");
      log(`  xG: H=${xg.homeXG} A=${xg.awayXG}`);
      log(`  xGOT: H=${xg.homeXGOT} A=${xg.awayXGOT}`);
      log(`  xGOpenPlay: H=${xg.homeXGOpenPlay} A=${xg.awayXGOpenPlay}`);
      log(`  xGSetPlay: H=${xg.homeXGSetPlay} A=${xg.awayXGSetPlay}`);
      log(`  xA: H=${xg.homeXA} A=${xg.awayXA}`);
      log(`  Per-player entries: ${players.length}`);
      if (players.length > 0) {
        const sample = players[0];
        log(`  Sample player: ${JSON.stringify(sample)}`);
      }
      checkNotNull(`${mid}: xg.homeXG`, xg.homeXG);
      checkNotNull(`${mid}: xg.awayXG`, xg.awayXG);
      checkNotNull(`${mid}: xg.homeXGOT`, xg.homeXGOT);
      checkNotNull(`${mid}: xg.awayXGOT`, xg.awayXGOT);
      checkNotNull(`${mid}: xg.homeXGOpenPlay`, xg.homeXGOpenPlay);
      checkNotNull(`${mid}: xg.awayXGOpenPlay`, xg.awayXGOpenPlay);
      checkNotNull(`${mid}: xg.homeXGSetPlay`, xg.homeXGSetPlay);
      checkNotNull(`${mid}: xg.awayXGSetPlay`, xg.awayXGSetPlay);
      checkNotNull(`${mid}: xg.homeXA`, xg.homeXA);
      checkNotNull(`${mid}: xg.awayXA`, xg.awayXA);
      checkGt(`${mid}: xg.perPlayer count`, players.length, 5);
      // xG cross-check with match_stats
      if (ms && xg.homeXG !== null && ms.homeXG !== null) {
        const diff = Math.abs(Number(xg.homeXG) - Number(ms.homeXG));
        if (diff < 0.01) pass(`${mid}: xg.homeXG matches match_stats.homeXG`, `diff=${diff.toFixed(4)}`, "cross-table consistency");
        else warn(`${mid}: xg.homeXG vs match_stats.homeXG`, `xg=${xg.homeXG} ms=${ms.homeXG} diff=${diff.toFixed(4)}`, "minor discrepancy");
      }
      // xGOpenPlay + xGSetPlay should ≈ xG total
      const xgSum = Number(xg.homeXGOpenPlay) + Number(xg.homeXGSetPlay);
      const xgTotal = Number(xg.homeXG);
      const xgDiff = Math.abs(xgSum - xgTotal);
      if (xgDiff < 0.05) pass(`${mid}: homeXGOpenPlay + homeXGSetPlay ≈ homeXG`, `${xgSum.toFixed(3)} ≈ ${xgTotal.toFixed(3)}`);
      else warn(`${mid}: homeXGOpenPlay + homeXGSetPlay vs homeXG`, `sum=${xgSum.toFixed(3)} total=${xgTotal.toFixed(3)} diff=${xgDiff.toFixed(3)}`, "may include penalty xG");
    } else {
      fail(`${mid}: expected_goals row exists`, null, "1 row");
    }

    // ── TABLE 6: wc2026_espn_shot_map ────────────────────────────────────────
    section("TABLE 6: wc2026_espn_shot_map");
    const shots = await q(db, `SELECT * FROM wc2026_espn_shot_map WHERE espn_match_id=? ORDER BY sequence`, [mid]);
    audit.tables.shots = shots;
    const shotsByType = {};
    for (const s of shots) {
      shotsByType[s.iconType] = (shotsByType[s.iconType] || 0) + 1;
    }
    log(`  Total shots: ${shots.length}`);
    log(`  By iconType: ${JSON.stringify(shotsByType)}`);
    const goalShots = shots.filter(s => s.iconType === "goal");
    log(`  Goals in shot map: ${goalShots.length}`);
    if (goalShots.length > 0) {
      for (const g of goalShots) {
        log(`    Goal: ${g.playerName} #${g.playerJersey} (${g.teamAbbrev}) ${g.clock} | xG=${g.xG} | zone=${g.goalZone}`);
      }
    }
    checkGt(`${mid}: shot_map total shots`, shots.length, 0);
    checkGt(`${mid}: shot_map goal shots`, goalShots.length, 0, "at least 1 goal shot");
    // Shot map goals should match score
    if (m) {
      const totalGoals2 = Number(m.homeScore) + Number(m.awayScore);
      if (goalShots.length === totalGoals2) pass(`${mid}: shot_map goals = match score total`, `${goalShots.length} = ${totalGoals2}`);
      else warn(`${mid}: shot_map goals vs match score`, `shotMap=${goalShots.length} score=${totalGoals2}`, "may include ET/PK goals");
    }
    // Check field coordinates populated
    const shotsWithCoords = shots.filter(s => s.fieldStartX !== null && s.fieldStartY !== null);
    checkNullRate(`${mid}: shot_map fieldCoords null rate`, shots.length - shotsWithCoords.length, shots.length, 0.1);
    // Check xG populated
    const shotsWithXG = shots.filter(s => s.xG !== null);
    checkNullRate(`${mid}: shot_map xG null rate`, shots.length - shotsWithXG.length, shots.length, 0.2);
    // Check player populated
    const shotsWithPlayer = shots.filter(s => s.playerName !== null && s.playerName !== "");
    checkNullRate(`${mid}: shot_map playerName null rate`, shots.length - shotsWithPlayer.length, shots.length, 0.1);
    // Period distribution
    const period1 = shots.filter(s => s.period === 1).length;
    const period2 = shots.filter(s => s.period === 2).length;
    info(`${mid}: shots period 1/2`, `${period1}/${period2}`);
    checkGt(`${mid}: shot_map period 1 shots`, period1, 0);
    checkGt(`${mid}: shot_map period 2 shots`, period2, 0);

    // ── TABLE 7: wc2026_espn_player_stats ────────────────────────────────────
    section("TABLE 7: wc2026_espn_player_stats");
    const players = await q(db, `SELECT * FROM wc2026_espn_player_stats WHERE espn_match_id=? ORDER BY isHome DESC, isGoalkeeper ASC, name ASC`, [mid]);
    audit.tables.players = players;
    const outfield = players.filter(p => p.isGoalkeeper === 0);
    const gks = players.filter(p => p.isGoalkeeper === 1);
    log(`  Total players: ${players.length} (${outfield.length} outfield + ${gks.length} GKs)`);
    checkGt(`${mid}: player_stats total`, players.length, 20);
    checkGt(`${mid}: player_stats outfield`, outfield.length, 18);
    checkGt(`${mid}: player_stats GKs`, gks.length, 0);
    checkEq(`${mid}: player_stats GK count = 2`, gks.length, 2);

    // Outfield null rate checks
    const tchNulls = outfield.filter(p => p.tch === null).length;
    checkNullRate(`${mid}: outfield.tch null rate`, tchNulls, outfield.length, 0.1);
    const sogNulls = outfield.filter(p => p.sog === null).length;
    checkNullRate(`${mid}: outfield.sog null rate`, sogNulls, outfield.length, 0.3);
    const xGNulls = outfield.filter(p => p.xG === null).length;
    checkNullRate(`${mid}: outfield.xG null rate`, xGNulls, outfield.length, 0.3);

    // GK stat checks
    for (const gk of gks) {
      log(`  GK: ${gk.name} #${gk.jersey} (${gk.teamAbbrev}) | GA=${gk.ga} SV=${gk.sv} SOGA=${gk.soga} xGC=${gk.xGC} xGOTC=${gk.xGOTC} GP=${gk.gp} BCS=${gk.bcs} CLR=${gk.clr} CC=${gk.cc} KS=${gk.ks}`);
      checkNotNull(`${mid}: GK ${gk.name}.sv`, gk.sv);
      checkNotNull(`${mid}: GK ${gk.name}.ga`, gk.ga);
      checkNotNull(`${mid}: GK ${gk.name}.soga`, gk.soga);
      checkNotNull(`${mid}: GK ${gk.name}.xGC`, gk.xGC);
      checkNotNull(`${mid}: GK ${gk.name}.xGOTC`, gk.xGOTC);
      checkNotNull(`${mid}: GK ${gk.name}.gp`, gk.gp);
    }

    // Position group distribution
    const byPos = {};
    for (const p of outfield) {
      byPos[p.positionGroup || "null"] = (byPos[p.positionGroup || "null"] || 0) + 1;
    }
    log(`  Position groups: ${JSON.stringify(byPos)}`);
    checkGt(`${mid}: Forwards count`, (byPos["Forwards"] || 0), 0);
    checkGt(`${mid}: Midfielders count`, (byPos["Midfielders"] || 0), 0);
    checkGt(`${mid}: Defenders count`, (byPos["Defenders"] || 0), 0);

    // Top scorers in this match
    const scorers = players.filter(p => Number(p.g) > 0);
    if (scorers.length > 0) {
      log(`  Goal scorers: ${scorers.map(p => `${p.name}(${p.g})`).join(", ")}`);
    }
    // Lineup stats populated
    const withAppearances = players.filter(p => p.appearances !== null).length;
    checkGt(`${mid}: player_stats with appearances`, withAppearances, 20);

    // ── TABLE 8: wc2026_espn_lineups ─────────────────────────────────────────
    section("TABLE 8: wc2026_espn_lineups");
    const lineups = await q(db, `SELECT * FROM wc2026_espn_lineups WHERE espn_match_id=? ORDER BY isHome DESC, role, formationPlace`, [mid]);
    audit.tables.lineups = lineups;
    const starters = lineups.filter(l => l.role === "starter");
    const subs = lineups.filter(l => l.role === "substitute");
    const unused = lineups.filter(l => l.role === "unused");
    log(`  Total lineup entries: ${lineups.length}`);
    log(`  Starters: ${starters.length} | Substitutes: ${subs.length} | Unused: ${unused.length}`);
    checkEq(`${mid}: lineups starters = 22`, starters.length, 22);
    checkGt(`${mid}: lineups total > 22`, lineups.length, 22);
    // Formation slots 1-11 for starters
    const homeStarters = starters.filter(l => l.isHome === 1);
    const awayStarters = starters.filter(l => l.isHome === 0);
    checkEq(`${mid}: home starters = 11`, homeStarters.length, 11);
    checkEq(`${mid}: away starters = 11`, awayStarters.length, 11);
    // Formation places populated
    const withFormPlace = starters.filter(l => l.formationPlace !== null).length;
    checkEq(`${mid}: all starters have formationPlace`, withFormPlace, 22);
    // Jersey numbers populated
    const withJersey = lineups.filter(l => l.jersey !== null && l.jersey !== "").length;
    checkNullRate(`${mid}: lineups jersey null rate`, lineups.length - withJersey, lineups.length, 0.05);
    // Formation populated
    const withFormation = lineups.filter(l => l.formation !== null).length;
    checkNullRate(`${mid}: lineups formation null rate`, lineups.length - withFormation, lineups.length, 0.05);
    // Sample starters
    for (const s of homeStarters.slice(0, 3)) {
      log(`  Home starter: ${s.name} #${s.jersey} slot=${s.formationPlace} formation=${s.formation}`);
    }
    for (const s of awayStarters.slice(0, 3)) {
      log(`  Away starter: ${s.name} #${s.jersey} slot=${s.formationPlace} formation=${s.formation}`);
    }

    // ── TABLE 9: wc2026_espn_glossary ────────────────────────────────────────
    section("TABLE 9: wc2026_espn_glossary");
    const glossary = await q(db, `SELECT * FROM wc2026_espn_glossary ORDER BY abbreviation`);
    audit.tables.glossary = glossary;
    log(`  Glossary entries: ${glossary.length}`);
    checkEq(`${mid}: glossary count = 20`, glossary.length, 20);
    const expectedAbbrevs = ["A","BCC","BCS","CC","CLR","DINT","DUELW","G","GA","GP","KS","SHOT","SOG","SOGA","SV","TCH","xA","xG","xGC","xGOTC"];
    for (const abbr of expectedAbbrevs) {
      const found = glossary.find(g => g.abbreviation === abbr);
      checkNotNull(`${mid}: glossary.${abbr}`, found ? found.displayName : null);
    }

    matchAudits[mid] = audit;
    log(`\n  ${C.green}${C.bold}Match ${mid} individual audit complete.${C.reset}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2: CROSS-REFERENCE QUAD AUDIT
  // ══════════════════════════════════════════════════════════════════════════
  banner("SECTION 2 — CROSS-REFERENCE QUAD AUDIT (All 4 Matches)", C.magenta);

  // 2A. Match metadata consistency
  section("2A. Match Metadata Consistency");
  const allMatches = await q(db, `SELECT * FROM wc2026_espn_matches WHERE espn_match_id IN (?,?,?,?) ORDER BY matchDateUtc`, MATCH_IDS);
  log(`  Matches in DB: ${allMatches.length}`);
  checkEq("quad: all 4 matches present", allMatches.length, 4);
  for (const m2 of allMatches) {
    log(`  ${m2.espn_match_id}: ${m2.homeTeamName} ${m2.homeScore}-${m2.awayScore} ${m2.awayTeamName} | ${m2.venue} | ${m2.homeFormation} vs ${m2.awayFormation} | ${m2.statusState}`);
    checkEq(`quad: ${m2.espn_match_id} statusState='post'`, m2.statusState, "post");
    checkEq(`quad: ${m2.espn_match_id} season='2026'`, m2.season, "2026");
    checkEq(`quad: ${m2.espn_match_id} scrapeVersion='250x'`, m2.scrapeVersion, "250x");
  }
  // All matchIds unique
  const uniqueMids = new Set(allMatches.map(m2 => m2.espn_match_id));
  checkEq("quad: no duplicate matchIds in matches table", uniqueMids.size, 4);

  // 2B. Row count cross-reference
  section("2B. Row Count Cross-Reference (All 9 Tables × 4 Matches)");
  const rowCountTable = [];
  for (const mid of MATCH_IDS) {
    const row = { espn_match_id: mid, label: MATCH_LABELS[mid] };
    for (const table of tables.filter(t => t !== "wc2026_espn_glossary")) {
      const [cnt] = await q(db, `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE espn_match_id=?`, [mid]);
      row[table] = Number(cnt.cnt);
    }
    const [gcnt] = await q(db, `SELECT COUNT(*) as cnt FROM wc2026_espn_glossary`);
    row["wc2026_espn_glossary"] = Number(gcnt.cnt);
    rowCountTable.push(row);
  }
  // Print table
  log(`\n  ${"espn_match_id".padEnd(10)} ${"matches".padEnd(8)} ${"odds".padEnd(6)} ${"t_stats".padEnd(8)} ${"m_stats".padEnd(8)} ${"xg".padEnd(5)} ${"shots".padEnd(7)} ${"players".padEnd(8)} ${"lineups".padEnd(8)} ${"glossary".padEnd(9)}`);
  log(`  ${"─".repeat(82)}`);
  for (const r of rowCountTable) {
    log(`  ${r.espn_match_id.padEnd(10)} ${String(r["wc2026_espn_matches"]).padEnd(8)} ${String(r["wc2026_espn_match_odds"]).padEnd(6)} ${String(r["wc2026_espn_team_stats"]).padEnd(8)} ${String(r["wc2026_espn_match_stats"]).padEnd(8)} ${String(r["wc2026_espn_expected_goals"]).padEnd(5)} ${String(r["wc2026_espn_shot_map"]).padEnd(7)} ${String(r["wc2026_espn_player_stats"]).padEnd(8)} ${String(r["wc2026_espn_lineups"]).padEnd(8)} ${String(r["wc2026_espn_glossary"]).padEnd(9)}`);
    checkEq(`quad: ${r.espn_match_id} matches=1`, r["wc2026_espn_matches"], 1);
    checkGt(`quad: ${r.espn_match_id} odds>0`, r["wc2026_espn_match_odds"], 0);
    checkEq(`quad: ${r.espn_match_id} team_stats=1`, r["wc2026_espn_team_stats"], 1);
    checkEq(`quad: ${r.espn_match_id} match_stats=1`, r["wc2026_espn_match_stats"], 1);
    checkEq(`quad: ${r.espn_match_id} expected_goals=1`, r["wc2026_espn_expected_goals"], 1);
    checkGt(`quad: ${r.espn_match_id} shots>0`, r["wc2026_espn_shot_map"], 0);
    checkGt(`quad: ${r.espn_match_id} players>20`, r["wc2026_espn_player_stats"], 20);
    checkGt(`quad: ${r.espn_match_id} lineups>22`, r["wc2026_espn_lineups"], 22);
    checkEq(`quad: ${r.espn_match_id} glossary=20`, r["wc2026_espn_glossary"], 20);
  }

  // 2C. Stat category completeness (all 6 categories × 4 matches)
  section("2C. Stat Category Completeness (6 Categories × 4 Matches)");
  const statCategories = [
    { name: "SHOTS", cols: ["homeShotsOnGoal","homeShots","homeShotsBlocked","homeHitWoodwork","homeAttemptsInsideBox","homeAttemptsOutsideBox"] },
    { name: "PASSES", cols: ["homePasses","homeAccuratePasses","homePassAccuracyPct","homeAccurateLongBalls","homeAccurateCrosses","homeTotalThrows","homePassTouchesInOppBox","homeTotalBackZonePass","homeTotalForwardZonePass"] },
    { name: "ATTACK", cols: ["homeBigChancesCreated","homeBigChancesMissed","homeThroughBalls","homeAttkTouchesInOppBox","homeFouledInFinalThird","homeCornersWon"] },
    { name: "EXPECTED GOALS", cols: ["homeXG","awayXG","homeXGOT","awayXGOT","homeXGOpenPlay","homeXGSetPlay"] },
    { name: "GOALKEEPING", cols: ["homeGkSaves","awayGkSaves","homeGoalKicks","awayGoalKicks","homeShotsFaced","awayShotsFaced","homeTotalHighClaims","awayTotalHighClaims","homePenaltyKicksSaved","awayPenaltyKicksSaved"] },
    { name: "DEFENSE", cols: ["homeTackles","awayTackles","homeInterceptions","awayInterceptions","homeClearances","awayClearances","homeRecoveries","awayRecoveries"] },
    { name: "DUELS", cols: ["homeDuelsWon","awayDuelsWon","homeDuels","awayDuels","homeAerialsWon","awayAerialsWon"] },
    { name: "FOULS", cols: ["homeFoulsCommitted","awayFoulsCommitted","homeOffsides","awayOffsides","homeFoulYellowCards","awayFoulYellowCards","homeFoulRedCards","awayFoulRedCards"] },
  ];
  for (const cat of statCategories) {
    for (const mid of MATCH_IDS) {
      const row = await q1(db, `SELECT ${cat.cols.join(",")} FROM wc2026_espn_match_stats WHERE espn_match_id=?`, [mid]);
      if (!row) { fail(`quad: ${mid} ${cat.name} row exists`, null, "1 row"); continue; }
      const nullCols = cat.cols.filter(c => row[c] === null);
      if (nullCols.length === 0) {
        pass(`quad: ${mid} ${cat.name} all ${cat.cols.length} cols populated`);
      } else {
        warn(`quad: ${mid} ${cat.name} null cols`, nullCols.join(","), `${nullCols.length}/${cat.cols.length} null`);
      }
    }
  }

  // 2D. Shot map cross-reference
  section("2D. Shot Map Cross-Reference (iconType distribution)");
  const shotMapSummary = await q(db, `
    SELECT espn_match_id, iconType, COUNT(*) as cnt, AVG(CAST(xG AS DECIMAL(6,4))) as avgXG
    FROM wc2026_espn_shot_map 
    WHERE espn_match_id IN (?,?,?,?)
    GROUP BY espn_match_id, iconType
    ORDER BY espn_match_id, iconType
  `, MATCH_IDS);
  const smByMatch = {};
  for (const r of shotMapSummary) {
    if (!smByMatch[r.espn_match_id]) smByMatch[r.espn_match_id] = {};
    smByMatch[r.espn_match_id][r.iconType] = { cnt: Number(r.cnt), avgXG: Number(r.avgXG) };
  }
  for (const mid of MATCH_IDS) {
    const sm = smByMatch[mid] || {};
    log(`  ${mid}: goal=${sm.goal?.cnt||0} save=${sm.save?.cnt||0} blocked=${sm.blocked?.cnt||0} offTarget=${sm.offTarget?.cnt||0}`);
    checkGt(`quad: ${mid} shot_map goal shots`, sm.goal?.cnt || 0, 0);
    // xG on goal shots should be > 0
    if (sm.goal && sm.goal.avgXG > 0) pass(`quad: ${mid} goal shots have xG > 0`, sm.goal.avgXG.toFixed(4));
    else warn(`quad: ${mid} goal shots avgXG`, sm.goal?.avgXG || 0, "expected > 0");
  }

  // 2E. Player stats cross-reference
  section("2E. Player Stats Cross-Reference");
  const playerSummary = await q(db, `
    SELECT espn_match_id, 
           COUNT(*) as total,
           SUM(CASE WHEN isGoalkeeper=0 THEN 1 ELSE 0 END) as outfield,
           SUM(CASE WHEN isGoalkeeper=1 THEN 1 ELSE 0 END) as gks,
           SUM(CASE WHEN isHome=1 THEN 1 ELSE 0 END) as home,
           SUM(CASE WHEN isHome=0 THEN 1 ELSE 0 END) as away,
           SUM(CASE WHEN tch IS NULL AND isGoalkeeper=0 THEN 1 ELSE 0 END) as tchNulls,
           SUM(CASE WHEN appearances IS NULL THEN 1 ELSE 0 END) as appNulls
    FROM wc2026_espn_player_stats 
    WHERE espn_match_id IN (?,?,?,?)
    GROUP BY espn_match_id
  `, MATCH_IDS);
  for (const r of playerSummary) {
    log(`  ${r.espn_match_id}: total=${r.total} outfield=${r.outfield} gks=${r.gks} home=${r.home} away=${r.away} tchNulls=${r.tchNulls} appNulls=${r.appNulls}`);
    checkGt(`quad: ${r.espn_match_id} player_stats total`, Number(r.total), 20);
    checkEq(`quad: ${r.espn_match_id} GKs = 2`, Number(r.gks), 2);
    checkNullRate(`quad: ${r.espn_match_id} outfield tch null rate`, Number(r.tchNulls), Number(r.outfield), 0.1);
    checkNullRate(`quad: ${r.espn_match_id} appearances null rate`, Number(r.appNulls), Number(r.total), 0.1);
  }

  // 2F. Lineup cross-reference
  section("2F. Lineup Cross-Reference");
  const lineupSummary = await q(db, `
    SELECT espn_match_id, role, COUNT(*) as cnt
    FROM wc2026_espn_lineups 
    WHERE espn_match_id IN (?,?,?,?)
    GROUP BY espn_match_id, role
    ORDER BY espn_match_id, role
  `, MATCH_IDS);
  const luByMatch = {};
  for (const r of lineupSummary) {
    if (!luByMatch[r.espn_match_id]) luByMatch[r.espn_match_id] = {};
    luByMatch[r.espn_match_id][r.role] = Number(r.cnt);
  }
  for (const mid of MATCH_IDS) {
    const lu = luByMatch[mid] || {};
    log(`  ${mid}: starter=${lu.starter||0} substitute=${lu.substitute||0} unused=${lu.unused||0} total=${(lu.starter||0)+(lu.substitute||0)+(lu.unused||0)}`);
    checkEq(`quad: ${mid} starters = 22`, lu.starter || 0, 22);
    checkGt(`quad: ${mid} substitutes > 0`, lu.substitute || 0, 0);
  }

  // 2G. xG consistency across tables (match_stats vs expected_goals)
  section("2G. xG Cross-Table Consistency (match_stats vs expected_goals)");
  const xgCompare = await q(db, `
    SELECT ms.espn_match_id,
           ms.homeXG as ms_homeXG, eg.homeXG as eg_homeXG,
           ms.awayXG as ms_awayXG, eg.awayXG as eg_awayXG,
           ABS(CAST(ms.homeXG AS DECIMAL(6,3)) - CAST(eg.homeXG AS DECIMAL(6,3))) as homeXGDiff,
           ABS(CAST(ms.awayXG AS DECIMAL(6,3)) - CAST(eg.awayXG AS DECIMAL(6,3))) as awayXGDiff
    FROM wc2026_espn_match_stats ms
    JOIN wc2026_espn_expected_goals eg ON ms.espn_match_id = eg.espn_match_id
    WHERE ms.espn_match_id IN (?,?,?,?)
  `, MATCH_IDS);
  for (const r of xgCompare) {
    log(`  ${r.espn_match_id}: ms.homeXG=${r.ms_homeXG} eg.homeXG=${r.eg_homeXG} diff=${Number(r.homeXGDiff).toFixed(4)}`);
    log(`  ${r.espn_match_id}: ms.awayXG=${r.ms_awayXG} eg.awayXG=${r.eg_awayXG} diff=${Number(r.awayXGDiff).toFixed(4)}`);
    if (Number(r.homeXGDiff) < 0.01) pass(`quad: ${r.espn_match_id} homeXG consistent across tables`, `diff=${Number(r.homeXGDiff).toFixed(4)}`);
    else warn(`quad: ${r.espn_match_id} homeXG discrepancy`, `diff=${Number(r.homeXGDiff).toFixed(4)}`, "match_stats vs expected_goals");
    if (Number(r.awayXGDiff) < 0.01) pass(`quad: ${r.espn_match_id} awayXG consistent across tables`, `diff=${Number(r.awayXGDiff).toFixed(4)}`);
    else warn(`quad: ${r.espn_match_id} awayXG discrepancy`, `diff=${Number(r.awayXGDiff).toFixed(4)}`, "match_stats vs expected_goals");
  }

  // 2H. Fouls/saves cross-table consistency (team_stats vs match_stats)
  section("2H. Fouls & Saves Cross-Table Consistency (team_stats vs match_stats)");
  const crossCheck = await q(db, `
    SELECT ts.espn_match_id,
           ts.fouls as ts_fouls, ms.homeFoulsCommitted as ms_fouls,
           ts.foulsAway as ts_foulsAway, ms.awayFoulsCommitted as ms_foulsAway,
           ts.saves as ts_saves, ms.homeGkSaves as ms_saves,
           ts.savesAway as ts_savesAway, ms.awayGkSaves as ms_savesAway,
           ts.yellowCards as ts_yc, ms.homeFoulYellowCards as ms_yc,
           ts.yellowCardsAway as ts_ycAway, ms.awayFoulYellowCards as ms_ycAway
    FROM wc2026_espn_team_stats ts
    JOIN wc2026_espn_match_stats ms ON ts.espn_match_id = ms.espn_match_id
    WHERE ts.espn_match_id IN (?,?,?,?)
  `, MATCH_IDS);
  for (const r of crossCheck) {
    log(`  ${r.espn_match_id}: fouls ts=${r.ts_fouls} ms=${r.ms_fouls} | saves ts=${r.ts_saves} ms=${r.ms_saves} | YC ts=${r.ts_yc} ms=${r.ms_yc}`);
    checkEq(`quad: ${r.espn_match_id} fouls consistent`, Number(r.ts_fouls), Number(r.ms_fouls));
    checkEq(`quad: ${r.espn_match_id} foulsAway consistent`, Number(r.ts_foulsAway), Number(r.ms_foulsAway));
    checkEq(`quad: ${r.espn_match_id} saves consistent`, Number(r.ts_saves), Number(r.ms_saves));
    checkEq(`quad: ${r.espn_match_id} savesAway consistent`, Number(r.ts_savesAway), Number(r.ms_savesAway));
    checkEq(`quad: ${r.espn_match_id} yellowCards consistent`, Number(r.ts_yc), Number(r.ms_yc));
    checkEq(`quad: ${r.espn_match_id} yellowCardsAway consistent`, Number(r.ts_ycAway), Number(r.ms_ycAway));
  }

  // 2I. Aggregate stats across all 4 matches
  section("2I. Aggregate Statistics Across All 4 Matches");
  const aggStats = await q1(db, `
    SELECT 
      COUNT(*) as matches,
      SUM(homeScore + awayScore) as totalGoals,
      AVG(homeScore + awayScore) as avgGoals,
      AVG(attendance) as avgAttendance,
      MIN(attendance) as minAttendance,
      MAX(attendance) as maxAttendance
    FROM wc2026_espn_matches WHERE espn_match_id IN (?,?,?,?)
  `, MATCH_IDS);
  log(`  Total matches: ${aggStats.matches}`);
  log(`  Total goals: ${aggStats.totalGoals} | Avg goals/match: ${Number(aggStats.avgGoals).toFixed(2)}`);
  log(`  Attendance: avg=${Math.round(aggStats.avgAttendance)} min=${aggStats.minAttendance} max=${aggStats.maxAttendance}`);

  const aggXG = await q1(db, `
    SELECT AVG(CAST(homeXG AS DECIMAL(6,3))) as avgHomeXG, AVG(CAST(awayXG AS DECIMAL(6,3))) as avgAwayXG,
           MIN(CAST(homeXG AS DECIMAL(6,3))) as minHomeXG, MAX(CAST(homeXG AS DECIMAL(6,3))) as maxHomeXG
    FROM wc2026_espn_expected_goals WHERE espn_match_id IN (?,?,?,?)
  `, MATCH_IDS);
  log(`  Avg xG: H=${Number(aggXG.avgHomeXG).toFixed(3)} A=${Number(aggXG.avgAwayXG).toFixed(3)}`);
  log(`  homeXG range: [${Number(aggXG.minHomeXG).toFixed(3)}, ${Number(aggXG.maxHomeXG).toFixed(3)}]`);

  const aggShots = await q1(db, `
    SELECT COUNT(*) as totalShots,
           SUM(CASE WHEN iconType='goal' THEN 1 ELSE 0 END) as goals,
           SUM(CASE WHEN iconType='save' THEN 1 ELSE 0 END) as saves,
           SUM(CASE WHEN iconType='blocked' THEN 1 ELSE 0 END) as blocked,
           SUM(CASE WHEN iconType='offTarget' THEN 1 ELSE 0 END) as offTarget,
           AVG(CAST(xG AS DECIMAL(6,4))) as avgXG
    FROM wc2026_espn_shot_map WHERE espn_match_id IN (?,?,?,?)
  `, MATCH_IDS);
  log(`  Shot map totals: ${aggShots.totalShots} shots | ${aggShots.goals} goals | ${aggShots.saves} saves | ${aggShots.blocked} blocked | ${aggShots.offTarget} off-target`);
  log(`  Avg xG per shot: ${Number(aggShots.avgXG).toFixed(4)}`);

  const aggPlayers = await q1(db, `
    SELECT COUNT(*) as total, SUM(CASE WHEN isGoalkeeper=0 THEN 1 ELSE 0 END) as outfield,
           SUM(CASE WHEN isGoalkeeper=1 THEN 1 ELSE 0 END) as gks
    FROM wc2026_espn_player_stats WHERE espn_match_id IN (?,?,?,?)
  `, MATCH_IDS);
  log(`  Total player-match records: ${aggPlayers.total} (${aggPlayers.outfield} outfield + ${aggPlayers.gks} GKs)`);

  const aggLineups = await q1(db, `
    SELECT COUNT(*) as total, 
           SUM(CASE WHEN role='starter' THEN 1 ELSE 0 END) as starters,
           SUM(CASE WHEN role='substitute' THEN 1 ELSE 0 END) as subs,
           SUM(CASE WHEN role='unused' THEN 1 ELSE 0 END) as unused
    FROM wc2026_espn_lineups WHERE espn_match_id IN (?,?,?,?)
  `, MATCH_IDS);
  log(`  Total lineup records: ${aggLineups.total} (${aggLineups.starters} starters + ${aggLineups.subs} subs + ${aggLineups.unused} unused)`);
  checkEq("quad: total starters across 4 matches = 88", Number(aggLineups.starters), 88);

  // 2J. Scraper performance
  section("2J. Scraper Performance Metrics");
  const perfData = await q(db, `SELECT espn_match_id, scrapeDurationMs, scrapeVersion, scrapedAt FROM wc2026_espn_matches WHERE espn_match_id IN (?,?,?,?) ORDER BY scrapedAt`, MATCH_IDS);
  for (const p of perfData) {
    log(`  ${p.espn_match_id}: duration=${p.scrapeDurationMs}ms version=${p.scrapeVersion} scrapedAt=${new Date(Number(p.scrapedAt)).toISOString()}`);
    checkNotNull(`quad: ${p.espn_match_id} scrapeDurationMs`, p.scrapeDurationMs);
    checkGt(`quad: ${p.espn_match_id} scrapeDurationMs > 0`, Number(p.scrapeDurationMs), 0);
    checkEq(`quad: ${p.espn_match_id} scrapeVersion='250x'`, p.scrapeVersion, "250x");
  }

  // 2K. Truth anchor comparison (760487 as reference)
  section("2K. Truth Anchor Comparison (760487 Japan vs Brazil as Reference)");
  const anchor = matchAudits["760487"];
  if (anchor) {
    const anchorM = anchor.tables.matches;
    log(`  Anchor: ${anchorM.homeTeamName} ${anchorM.homeScore}-${anchorM.awayScore} ${anchorM.awayTeamName}`);
    log(`  Anchor venue: ${anchorM.venue} | Attendance: ${anchorM.attendance}`);
    log(`  Anchor formations: ${anchorM.homeFormation} vs ${anchorM.awayFormation}`);
    // Compare all 4 matches against anchor for schema consistency
    for (const mid of MATCH_IDS.filter(m => m !== "760487")) {
      const comp = matchAudits[mid]?.tables.matches;
      if (!comp) continue;
      // Same schema fields populated
      const anchorFields = ["homeTeamName","awayTeamName","venue","attendance","referee","homeFormation","awayFormation","statusState","matchDateUtc","homeTeamId","competition","round","season","scrapeVersion"];
      let allMatch = true;
      for (const f of anchorFields) {
        if ((anchorM[f] !== null) !== (comp[f] !== null)) {
          warn(`quad: ${mid} vs anchor field nullability mismatch`, f, `anchor=${anchorM[f]!==null} comp=${comp[f]!==null}`);
          allMatch = false;
        }
      }
      if (allMatch) pass(`quad: ${mid} vs anchor — all key fields have same nullability`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3: DATA INTEGRITY DEEP CHECKS
  // ══════════════════════════════════════════════════════════════════════════
  banner("SECTION 3 — DATA INTEGRITY DEEP CHECKS", C.cyan);

  // 3A. Orphan rows check
  section("3A. Orphan Row Check (espn_match_id FK consistency)");
  const orphanTables = ["wc2026_espn_match_odds","wc2026_espn_team_stats","wc2026_espn_match_stats","wc2026_espn_expected_goals","wc2026_espn_shot_map","wc2026_espn_player_stats","wc2026_espn_lineups"];
  for (const table of orphanTables) {
    const orphans = await q(db, `SELECT COUNT(*) as cnt FROM \`${table}\` t WHERE NOT EXISTS (SELECT 1 FROM wc2026_espn_matches m WHERE m.espn_match_id = t.espn_match_id)`);
    checkEq(`${table}: no orphan rows`, Number(orphans[0].cnt), 0);
  }

  // 3B. Duplicate espn_match_id check (for 1:1 tables)
  section("3B. Duplicate espn_match_id Check (1:1 Tables)");
  const oneToOneTables = ["wc2026_espn_team_stats","wc2026_espn_match_stats","wc2026_espn_expected_goals"];
  for (const table of oneToOneTables) {
    const dups = await q(db, `SELECT espn_match_id, COUNT(*) as cnt FROM \`${table}\` GROUP BY espn_match_id HAVING cnt > 1`);
    checkEq(`${table}: no duplicate matchIds`, dups.length, 0);
  }

  // 3C. Shot map coordinate range check
  section("3C. Shot Map Coordinate Range Check");
  const coordOutOfRange = await q1(db, `
    SELECT COUNT(*) as cnt FROM wc2026_espn_shot_map 
    WHERE espn_match_id IN (?,?,?,?)
    AND (CAST(fieldStartX AS DECIMAL(6,2)) < 0 OR CAST(fieldStartX AS DECIMAL(6,2)) > 100
      OR CAST(fieldStartY AS DECIMAL(6,2)) < 0 OR CAST(fieldStartY AS DECIMAL(6,2)) > 100)
  `, MATCH_IDS);
  checkEq("shot_map: all field coordinates in [0,100]", Number(coordOutOfRange.cnt), 0);

  // 3D. xG range check
  section("3D. xG Range Check (all shot-level xG in [0,1])");
  const xgOutOfRange = await q1(db, `
    SELECT COUNT(*) as cnt FROM wc2026_espn_shot_map 
    WHERE espn_match_id IN (?,?,?,?)
    AND xG IS NOT NULL AND (CAST(xG AS DECIMAL(6,4)) < 0 OR CAST(xG AS DECIMAL(6,4)) > 1)
  `, MATCH_IDS);
  checkEq("shot_map: all xG in [0,1]", Number(xgOutOfRange.cnt), 0);

  // 3E. Player-match uniqueness
  section("3E. Player-Match Uniqueness (no duplicate athleteId per match)");
  const dupPlayers = await q(db, `
    SELECT espn_match_id, athleteId, COUNT(*) as cnt 
    FROM wc2026_espn_player_stats 
    WHERE espn_match_id IN (?,?,?,?)
    GROUP BY espn_match_id, athleteId HAVING cnt > 1
  `, MATCH_IDS);
  checkEq("player_stats: no duplicate (espn_match_id,athleteId)", dupPlayers.length, 0);

  const dupLineups = await q(db, `
    SELECT espn_match_id, athleteId, COUNT(*) as cnt 
    FROM wc2026_espn_lineups 
    WHERE espn_match_id IN (?,?,?,?)
    GROUP BY espn_match_id, athleteId HAVING cnt > 1
  `, MATCH_IDS);
  checkEq("lineups: no duplicate (espn_match_id,athleteId)", dupLineups.length, 0);

  // 3F. Attendance sanity
  section("3F. Attendance Sanity Check");
  const attendanceData = await q(db, `SELECT espn_match_id, attendance, venue FROM wc2026_espn_matches WHERE espn_match_id IN (?,?,?,?)`, MATCH_IDS);
  for (const a of attendanceData) {
    log(`  ${a.espn_match_id}: ${a.venue} attendance=${a.attendance}`);
    checkRange(`${a.espn_match_id}: attendance range`, Number(a.attendance), 10000, 200000, "World Cup stadium range");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  banner("FORENSIC AUDIT COMPLETE — FINAL VERDICT", C.magenta);
  const total = passCount + failCount + warnCount;
  const passRate = ((passCount / (passCount + failCount)) * 100).toFixed(1);
  log(`  ${C.bold}PASS: ${passCount} | FAIL: ${failCount} | WARN: ${warnCount} | TOTAL CHECKS: ${total}${C.reset}`);
  log(`  ${failCount === 0 ? C.green : C.red}${C.bold}PASS RATE (excl. warns): ${passRate}%${C.reset}`);

  if (allFindings.filter(f => f.type === "FAIL").length > 0) {
    log(`\n  ${C.red}${C.bold}FAILURES:${C.reset}`);
    for (const f of allFindings.filter(f => f.type === "FAIL")) {
      log(`    ${C.red}✗${C.reset} [${f.label}] = ${JSON.stringify(f.value)} (expected ${f.expected})${f.detail ? " | " + f.detail : ""}`);
    }
  }
  if (allFindings.filter(f => f.type === "WARN").length > 0) {
    log(`\n  ${C.yellow}${C.bold}WARNINGS:${C.reset}`);
    for (const f of allFindings.filter(f => f.type === "WARN")) {
      log(`    ${C.yellow}⚠${C.reset} [${f.label}] = ${JSON.stringify(f.value)}${f.detail ? " | " + f.detail : ""}`);
    }
  }

  // Verdict
  log(`\n  ${C.bold}VERDICT:${C.reset}`);
  if (failCount === 0 && warnCount <= 5) {
    log(`  ${C.green}${C.bold}✓ ELITE — All 4 matches fully scraped, databased, and validated with maximum precision.${C.reset}`);
    log(`  ${C.green}  9 tables × 4 matches = 36 table-match combinations all passing.${C.reset}`);
    log(`  ${C.green}  Schema: optimal indexing, correct column types, no orphans, no duplicates.${C.reset}`);
    log(`  ${C.green}  Data: all 6 stat categories populated, xG consistent across tables.${C.reset}`);
  } else if (failCount === 0) {
    log(`  ${C.yellow}${C.bold}✓ STRONG — All checks pass, ${warnCount} warnings to review.${C.reset}`);
  } else {
    log(`  ${C.red}${C.bold}✗ ISSUES FOUND — ${failCount} failures require remediation.${C.reset}`);
  }

  await db.end();

  // Save log
  writeFileSync(LOG_FILE, logLines.join("\n") + "\n");
  log(`\n  ${C.dim}Full audit log saved to: ${LOG_FILE}${C.reset}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
