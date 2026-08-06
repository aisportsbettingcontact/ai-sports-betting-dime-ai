#!/usr/bin/env node
// Phase 1 census for the 2026 MLB model audit. STRICTLY READ-ONLY (SELECT only).
// Emits, under docs/audits/mlb-model-audit-2026/census/:
//   game-universe.csv    one row per 2026 regular-season schedule game, linked to games.id
//   coverage-matrix.csv  one row per game x coverage flags for every market family
//   null-audit.csv       per table.column null counts across all MLB tables
//   census-summary.json  aggregates consumed by CENSUS-REPORT.md
// Season boundaries are derived from mlb_schedule_history, not assumed.

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const OUT_DIR = new URL('../census/', import.meta.url).pathname;
const AS_OF = process.env.AUDIT_AS_OF || '2026-07-25'; // last date with a populated slate; passed explicitly for reproducibility

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

async function connect() {
  try {
    const c = await mysql.createConnection(url);
    await c.query('SELECT 1');
    return c;
  } catch {
    return mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
  }
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv(file, rows, columns) {
  const cols = columns || Object.keys(rows[0] || {});
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(','));
  fs.writeFileSync(path.join(OUT_DIR, file), lines.join('\n') + '\n');
  console.error(`[census] wrote ${file}: ${rows.length} rows`);
}

const conn = await connect();
const q = async (sql, params) => (await conn.query(sql, params))[0];

const summary = { asOf: AS_OF, generatedBy: 'run-census.mjs', sections: {} };

// ---------------------------------------------------------------------------
// 1. Game universe: 2026 regular season from mlb_schedule_history (source of truth)
// ---------------------------------------------------------------------------
const schedule = await q(
  `SELECT anGameId, gameDate, startTimeUtc, gameStatus, awayAbbr, homeAbbr, awayName, homeName,
          awayScore, homeScore, game_type,
          dkTotal, dkAwayML, dkHomeML, dkAwayRunLine, dkHomeRunLine,
          dkClosingTotal, dkClosingAwayML, dkClosingHomeML, closingLineLockedAt
   FROM mlb_schedule_history
   WHERE game_type = 'regular_season' AND gameDate >= '2026-01-01' AND gameDate <= ?
   ORDER BY gameDate, awayAbbr, homeAbbr, startTimeUtc`,
  [AS_OF]
);

// sequence doubleheader legs within (date, matchup) by start time
const seqKey = (r) => `${r.gameDate}|${r.awayAbbr}|${r.homeAbbr}`;
{
  const counters = new Map();
  for (const r of schedule) {
    const k = seqKey(r);
    counters.set(k, (counters.get(k) || 0) + 1);
    r.seq = counters.get(k);
  }
}

const gamesRows = await q(
  `SELECT id, gameDate, awayTeam, homeTeam, startTimeEst, gameNumber, doubleHeader, gameStatus AS gStatus,
          mlbGamePk, publishedToFeed, publishedModel, rescheduledFrom,
          actualAwayScore, actualHomeScore, awayScore AS liveAwayScore, homeScore AS liveHomeScore,
          modelAwayWinPct, modelHomeWinPct, modelAwayML, modelTotal, modelProjTotal, awayModelSpread,
          modelOverRate, modelRunAt,
          bookTotal, awayML, homeML, awayRunLine,
          modelF5AwayWinPct, modelF5Total, modelF5OverRate, modelF5AwayRLCoverPct, f5Total AS bookF5Total, f5AwayML AS bookF5AwayML, f5AwayRunLine AS bookF5AwayRL,
          modelPNrfi, nrfiOverOdds, yrfiUnderOdds, actualNrfiBinary,
          modelAwayHrPct, modelHomeHrPct, modelAwayExpHr,
          actualF5AwayScore, actualF5HomeScore, actualFgTotal, actualF5Total,
          fgMlResult, fgMlCorrect, fgRlCorrect, fgTotalCorrect, f5MlCorrect, f5RlCorrect, f5TotalCorrect, nrfiCorrect,
          brierFgMl, brierFgTotal, brierF5Ml, brierF5Total, brierNrfi, outcomeIngestedAt
   FROM games WHERE sport='MLB' AND gameDate >= '2026-01-01' AND gameDate <= ?
   ORDER BY gameDate, awayTeam, homeTeam, gameNumber, startTimeEst`,
  [AS_OF]
);
{
  const counters = new Map();
  for (const r of gamesRows) {
    const k = `${r.gameDate}|${r.awayTeam}|${r.homeTeam}`;
    counters.set(k, (counters.get(k) || 0) + 1);
    r.seq = counters.get(k);
  }
}
const gamesByKey = new Map();
for (const r of gamesRows) gamesByKey.set(`${r.gameDate}|${r.awayTeam}|${r.homeTeam}|${r.seq}`, r);

// per-game prop aggregates
const kAgg = new Map();
for (const r of await q(
  `SELECT gameId, COUNT(*) props, SUM(kProj IS NOT NULL) proj, SUM(bookLine IS NOT NULL) line,
          SUM(actualKs IS NOT NULL) actual, SUM(modelCorrect IS NOT NULL) graded
   FROM mlb_strikeout_props GROUP BY gameId`
)) kAgg.set(r.gameId, r);
const hrAgg = new Map();
for (const r of await q(
  `SELECT gameId, COUNT(*) props, SUM(modelPHr IS NOT NULL) proj, SUM(actualHr IS NOT NULL) actual,
          SUM(modelCorrect IS NOT NULL) graded, SUM(verdict IS NOT NULL) verdicts
   FROM mlb_hr_props GROUP BY gameId`
)) hrAgg.set(r.gameId, r);
const btAgg = new Map();
for (const r of await q(
  `SELECT gameId, COUNT(*) rows_total,
          SUM(result IN ('WIN','LOSS','PUSH')) settled,
          SUM(result='NO_ACTION') no_action,
          SUM(result='QUARANTINED') quarantined,
          SUM(result IN ('MISSING_DATA','VOID')) missing_or_void,
          SUM(clv IS NOT NULL) with_clv, SUM(closingOdds IS NOT NULL) with_closing
   FROM mlb_game_backtest GROUP BY gameId`
)) btAgg.set(r.gameId, r);

// ---------------------------------------------------------------------------
// 2. Build universe + coverage matrix
// ---------------------------------------------------------------------------
const universe = [];
const matrix = [];
const usedGameIds = new Set();
for (const s of schedule) {
  const g = gamesByKey.get(`${s.gameDate}|${s.awayAbbr}|${s.homeAbbr}|${s.seq}`);
  if (g) usedGameIds.add(g.id);
  const completed = s.gameStatus === 'complete';
  universe.push({
    anGameId: s.anGameId,
    gameDate: s.gameDate,
    matchup: `${s.awayAbbr}@${s.homeAbbr}`,
    seq: s.seq,
    schedStatus: s.gameStatus,
    schedAway: s.awayScore,
    schedHome: s.homeScore,
    gamesId: g ? g.id : null,
    gamesStatus: g ? g.gStatus : null,
    mlbGamePk: g ? g.mlbGamePk : null,
    linkStatus: g ? 'LINKED' : 'UNLINKED',
    statusMismatch: g && completed && g.gStatus !== 'final' ? 1 : 0,
    published: g ? g.publishedToFeed : null,
    hasClosingML: s.dkClosingAwayML ? 1 : 0,
    hasClosingTotal: s.dkClosingTotal != null ? 1 : 0,
  });
  if (!g) continue;
  const k = kAgg.get(g.id) || {};
  const hr = hrAgg.get(g.id) || {};
  const bt = btAgg.get(g.id) || {};
  matrix.push({
    gamesId: g.id,
    anGameId: s.anGameId,
    gameDate: s.gameDate,
    matchup: `${s.awayAbbr}@${s.homeAbbr}`,
    seq: s.seq,
    completed: completed ? 1 : 0,
    schedStatus: s.gameStatus,
    // Full game
    fg_proj: g.modelAwayWinPct != null ? 1 : 0,
    fg_ml_book: g.awayML != null ? 1 : 0,
    fg_total_book: g.bookTotal != null ? 1 : 0,
    fg_rl_book: g.awayRunLine != null ? 1 : 0,
    fg_actual: g.actualAwayScore != null && g.actualHomeScore != null ? 1 : 0,
    fg_graded_games: g.fgMlCorrect != null ? 1 : 0,
    // First 5
    f5_proj: g.modelF5AwayWinPct != null ? 1 : 0,
    f5_total_proj: g.modelF5Total != null ? 1 : 0,
    f5_book: g.bookF5Total != null || g.bookF5AwayML != null ? 1 : 0,
    f5_actual: g.actualF5AwayScore != null && g.actualF5HomeScore != null ? 1 : 0,
    f5_graded_games: g.f5MlCorrect != null || g.f5TotalCorrect != null ? 1 : 0,
    // NRFI
    nrfi_proj: g.modelPNrfi != null ? 1 : 0,
    nrfi_book: g.nrfiOverOdds != null || g.yrfiUnderOdds != null ? 1 : 0,
    nrfi_actual: g.actualNrfiBinary != null ? 1 : 0,
    nrfi_graded_games: g.nrfiCorrect != null ? 1 : 0,
    // Team-level HR (games columns)
    teamhr_proj: g.modelAwayHrPct != null ? 1 : 0,
    // K props
    k_props: k.props || 0,
    k_proj: Number(k.proj) || 0,
    k_line: Number(k.line) || 0,
    k_actual: Number(k.actual) || 0,
    k_graded: Number(k.graded) || 0,
    // HR props
    hr_props: hr.props || 0,
    hr_proj: Number(hr.proj) || 0,
    hr_actual: Number(hr.actual) || 0,
    hr_graded: Number(hr.graded) || 0,
    // Backtest ledger presence
    bt_rows: bt.rows_total || 0,
    bt_settled: Number(bt.settled) || 0,
    bt_no_action: Number(bt.no_action) || 0,
    bt_quarantined: Number(bt.quarantined) || 0,
    bt_with_clv: Number(bt.with_clv) || 0,
    bt_with_closing: Number(bt.with_closing) || 0,
    outcomeIngested: g.outcomeIngestedAt != null ? 1 : 0,
  });
}

// games rows in-window that no schedule row claimed (reverse orphans)
const reverseOrphans = gamesRows.filter((g) => !usedGameIds.has(g.id) && g.gameDate >= '2026-03-01');

writeCsv('game-universe.csv', universe);
writeCsv('coverage-matrix.csv', matrix);

summary.sections.universe = {
  scheduleGames: schedule.length,
  completed: schedule.filter((s) => s.gameStatus === 'complete').length,
  postponed: schedule.filter((s) => s.gameStatus === 'postponed').length,
  scheduledFuture: schedule.filter((s) => s.gameStatus === 'scheduled').length,
  linked: universe.filter((u) => u.linkStatus === 'LINKED').length,
  unlinked: universe.filter((u) => u.linkStatus === 'UNLINKED').length,
  statusMismatches: universe.filter((u) => u.statusMismatch).length,
  reverseOrphans: reverseOrphans.length,
  withClosingML: universe.filter((u) => u.hasClosingML).length,
  withClosingTotal: universe.filter((u) => u.hasClosingTotal).length,
};
if (reverseOrphans.length) {
  writeCsv(
    'reverse-orphans.csv',
    reverseOrphans.map((g) => ({ id: g.id, gameDate: g.gameDate, matchup: `${g.awayTeam}@${g.homeTeam}`, status: g.gStatus, mlbGamePk: g.mlbGamePk }))
  );
}

// coverage aggregates over completed games only
const comp = matrix.filter((m) => m.completed === 1);
const agg = (flag) => comp.filter((m) => m[flag]).length;
summary.sections.coverageCompleted = {
  completedGames: comp.length,
  fg_proj: agg('fg_proj'),
  f5_proj: agg('f5_proj'),
  nrfi_proj: agg('nrfi_proj'),
  teamhr_proj: agg('teamhr_proj'),
  k_any: comp.filter((m) => m.k_props > 0).length,
  hr_any: comp.filter((m) => m.hr_props > 0).length,
  fg_actual: agg('fg_actual'),
  f5_actual: agg('f5_actual'),
  nrfi_actual: agg('nrfi_actual'),
  fg_graded_games: agg('fg_graded_games'),
  f5_graded_games: agg('f5_graded_games'),
  nrfi_graded_games: agg('nrfi_graded_games'),
  bt_any: comp.filter((m) => m.bt_rows > 0).length,
  bt_with_clv_any: comp.filter((m) => m.bt_with_clv > 0).length,
};

// ---------------------------------------------------------------------------
// 3. Null audit across every MLB table (full-table scope; games/props scoped to 2026 season)
// ---------------------------------------------------------------------------
const tables = (
  await q(
    `SELECT TABLE_NAME t FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'mlb\\_%' OR TABLE_NAME IN ('games','odds_history'))`
  )
).map((r) => r.t);

const nullAudit = [];
for (const t of tables) {
  const cols = (
    await q(
      `SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [t]
    )
  ).map((r) => r.c);
  let where = '';
  if (t === 'games') where = `WHERE sport='MLB' AND gameDate >= '2026-03-01' AND gameDate <= '${AS_OF}'`;
  if (t === 'odds_history') where = `WHERE sport='mlb' OR sport='MLB'`;
  const sums = cols.map((c) => `SUM(\`${c}\` IS NULL) AS \`${c}\``).join(', ');
  const [row] = await q(`SELECT COUNT(*) AS __total, ${sums} FROM \`${t}\` ${where}`);
  const total = Number(row.__total);
  for (const c of cols) {
    const nulls = Number(row[c]);
    if (nulls > 0) nullAudit.push({ table: t, column: c, rows: total, nulls, pct: total ? +((100 * nulls) / total).toFixed(2) : 0 });
  }
  if (!cols.length || total === 0) nullAudit.push({ table: t, column: '(table empty)', rows: total, nulls: 0, pct: 0 });
}
writeCsv('null-audit.csv', nullAudit, ['table', 'column', 'rows', 'nulls', 'pct']);
summary.sections.nullAudit = { tablesScanned: tables.length, columnsWithNulls: nullAudit.filter((r) => r.nulls > 0).length };

// ---------------------------------------------------------------------------
// 4. Currency check
// ---------------------------------------------------------------------------
const [cur] = await q(
  `SELECT
     (SELECT MAX(gameDate) FROM mlb_schedule_history WHERE gameStatus='complete' AND game_type='regular_season') lastCompletedSlate,
     (SELECT MAX(gameDate) FROM games WHERE sport='MLB' AND fgMlCorrect IS NOT NULL) lastFgGradedGames,
     (SELECT MAX(gameDate) FROM mlb_game_backtest WHERE result IN ('WIN','LOSS','PUSH')) lastBtSettled,
     (SELECT MAX(g.gameDate) FROM mlb_strikeout_props p JOIN games g ON g.id=p.gameId WHERE p.modelCorrect IS NOT NULL) lastKGraded,
     (SELECT MAX(g.gameDate) FROM mlb_hr_props p JOIN games g ON g.id=p.gameId WHERE p.modelCorrect IS NOT NULL) lastHrGraded,
     (SELECT COUNT(*) FROM games WHERE sport='MLB' AND gameDate=? AND modelAwayWinPct IS NOT NULL) todaysProjected,
     (SELECT COUNT(*) FROM games WHERE sport='MLB' AND gameDate=?) todaysGames`,
  [AS_OF, AS_OF]
);
summary.sections.currency = cur;

fs.writeFileSync(path.join(OUT_DIR, 'census-summary.json'), JSON.stringify(summary, null, 2));
console.error('[census] summary written');
console.log(JSON.stringify(summary.sections, null, 1));
await conn.end();
