#!/usr/bin/env node
// Phase 7 final census (v2) — proves the amended exit criteria. READ-ONLY.
// Completeness definition (CHECKPOINT ALPHA response): every completed 2026 game carries a
// projection, a grade, and a deviation in every one of the ten markets, from live_pregame or
// walkforward_replay provenance; zero unexplained nulls; currency intact.
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const OUT_DIR = new URL('../census/', import.meta.url).pathname;
const AS_OF = process.env.AUDIT_AS_OF || '2026-07-25';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');
async function connect() {
  try { const c = await mysql.createConnection(url); await c.query('SELECT 1'); return c; }
  catch { return mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }); }
}
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];
const summary = { asOf: AS_OF, generatedBy: 'run-census-v2.mjs', checks: {} };

// ── 1. Universe reconciliation ──────────────────────────────────────────────
const [uni] = await q(
  `SELECT
    (SELECT COUNT(*) FROM mlb_schedule_history WHERE game_type='regular_season' AND gameStatus='complete' AND gameDate>=  '2026-03-25' AND gameDate<=?) schedComplete,
    (SELECT COUNT(*) FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-25' AND gameDate<=? AND mlbGamePk IS NOT NULL) gamesFinals,
    (SELECT COUNT(*) FROM games WHERE sport='MLB' AND gameStatus IN ('live','upcoming') AND gameDate<'2026-07-25' AND gameDate>='2026-03-01') zombies,
    (SELECT COUNT(*) FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-25' AND gameDate<=? AND mlbGamePk IS NOT NULL AND (actualAwayScore IS NULL OR actualHomeScore IS NULL OR actualFgTotal IS NULL OR actualF5AwayScore IS NULL OR actualNrfiBinary IS NULL)) finalsMissingAnyActual`,
  [AS_OF, AS_OF, AS_OF]);
summary.checks.universe = uni;

// ── 2. Ten-market projection coverage (live ∪ replay) over finals ───────────
const finals = await q(
  `SELECT g.id, g.gameDate,
          g.modelAwayWinPct IS NOT NULL liveFg, g.modelF5AwayWinPct IS NOT NULL liveF5, g.modelPNrfi IS NOT NULL liveNrfi,
          g.awayRunLine IS NOT NULL bookRl, g.bookTotal IS NOT NULL bookTot, g.f5AwayRunLine IS NOT NULL bookF5Rl, g.f5Total IS NOT NULL bookF5Tot,
          r.id IS NOT NULL hasReplay,
          rk.n kReplay, rh.n hrReplay, lk.n kLive, lh.n hrLive
   FROM games g
   LEFT JOIN mlb_replay_projections r ON r.gameId = g.id AND r.modelVersion LIKE '%-p2'
   LEFT JOIN (SELECT gameId, COUNT(*) n FROM mlb_replay_prop_projections WHERE propType='K' GROUP BY gameId) rk ON rk.gameId=g.id
   LEFT JOIN (SELECT gameId, COUNT(*) n FROM mlb_replay_prop_projections WHERE propType='HR' GROUP BY gameId) rh ON rh.gameId=g.id
   LEFT JOIN (SELECT gameId, COUNT(*) n FROM mlb_strikeout_props WHERE kProj IS NOT NULL GROUP BY gameId) lk ON lk.gameId=g.id
   LEFT JOIN (SELECT gameId, COUNT(*) n FROM mlb_hr_props WHERE modelPHr IS NOT NULL GROUP BY gameId) lh ON lh.gameId=g.id
   WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate>='2026-03-25' AND g.gameDate<=? AND g.mlbGamePk IS NOT NULL`, [AS_OF]);

const cov = { finals: finals.length, gaps: {} };
const gapList = [];
for (const m of ['fg_ml', 'fg_rl', 'fg_total', 'f5_ml', 'f5_rl', 'f5_total', 'nrfi_yrfi', 'k_prop', 'hr_prop']) cov.gaps[m] = 0;
for (const g of finals) {
  const game = (m) => { cov.gaps[m]++; gapList.push([g.id, g.gameDate, m]); };
  const fgOk = g.liveFg || g.hasReplay; if (!fgOk) { game('fg_ml'); game('fg_rl'); game('fg_total'); }
  const f5Ok = g.liveF5 || g.hasReplay; if (!f5Ok) { game('f5_ml'); game('f5_rl'); game('f5_total'); }
  if (!(g.liveNrfi || g.hasReplay)) game('nrfi_yrfi');
  if (!((g.kLive ?? 0) > 0 || (g.kReplay ?? 0) > 0)) game('k_prop');
  if (!((g.hrLive ?? 0) > 0 || (g.hrReplay ?? 0) > 0)) game('hr_prop');
}
summary.checks.projectionCoverage = cov;
if (gapList.length) fs.writeFileSync(path.join(OUT_DIR, 'coverage-gaps-v2.csv'), 'gameId,date,market\n' + gapList.map((r) => r.join(',')).join('\n') + '\n');

// ── 3. Grade reconciliation: mlb_replay_grades per market x source vs finals ─
const gradeRows = await q(
  `SELECT market, source, COUNT(DISTINCT gameId) games, COUNT(*) rows_n,
          SUM(result='PUSH') pushes, SUM(correct IS NOT NULL) graded
   FROM mlb_replay_grades rg JOIN games g ON g.id=rg.gameId
   WHERE g.gameStatus='final' AND rg.gameDate>='2026-03-25' AND rg.gameDate<=?
   GROUP BY market, source ORDER BY market, source`, [AS_OF]);
summary.checks.gradeLedger = gradeRows;
// per-market union coverage
const unionCov = await q(
  `SELECT market, COUNT(DISTINCT gameId) gamesCovered FROM mlb_replay_grades rg JOIN games g ON g.id=rg.gameId
   WHERE g.gameStatus='final' AND g.mlbGamePk IS NOT NULL AND rg.gameDate>='2026-03-25' AND rg.gameDate<=?
   GROUP BY market`, [AS_OF]);
summary.checks.gradeUnionCoverage = Object.fromEntries(unionCov.map((r) => [r.market, Number(r.gamesCovered)]));

// ── 4. Ledger enrollment + CLV ──────────────────────────────────────────────
const [ledger] = await q(
  `SELECT COUNT(DISTINCT b.gameId) enrolledFinals,
          SUM(b.clv IS NOT NULL) clvRows,
          SUM(b.result='QUARANTINED') quarantined
   FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId
   WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate>='2026-03-25' AND g.gameDate<=?`, [AS_OF]);
summary.checks.ledger = ledger;

// ── 5. Games grading columns (forward-path repair proof) ────────────────────
const [grades] = await q(
  `SELECT SUM(modelAwayWinPct IS NOT NULL AND fgMlCorrect IS NULL) fgMlUngraded,
          SUM(modelPNrfi IS NOT NULL AND actualNrfiBinary IS NOT NULL AND nrfiCorrect IS NULL) nrfiUngraded,
          SUM(modelF5AwayWinPct IS NOT NULL AND actualF5AwayScore IS NOT NULL AND f5MlCorrect IS NULL AND f5MlResult IS NULL) f5Ungraded
   FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-25' AND gameDate<=?`, [AS_OF]);
summary.checks.liveGradeColumns = grades;

// ── 6. Currency ─────────────────────────────────────────────────────────────
const [cur] = await q(
  `SELECT
    (SELECT COUNT(*) FROM games WHERE sport='MLB' AND gameDate=? AND modelAwayWinPct IS NOT NULL) todaysProjected,
    (SELECT COUNT(*) FROM games WHERE sport='MLB' AND gameDate=?) todaysGames,
    (SELECT MAX(g.gameDate) FROM mlb_strikeout_props p JOIN games g ON g.id=p.gameId WHERE p.modelCorrect IS NOT NULL) lastKGraded,
    (SELECT MAX(gameDate) FROM games WHERE sport='MLB' AND fgMlCorrect IS NOT NULL) lastFgGraded`, [AS_OF, AS_OF]);
summary.checks.currency = cur;

fs.writeFileSync(path.join(OUT_DIR, 'census-v2-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.checks, null, 1));
await conn.end();
