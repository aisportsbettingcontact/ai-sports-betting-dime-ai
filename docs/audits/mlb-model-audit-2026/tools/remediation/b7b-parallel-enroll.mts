#!/usr/bin/env tsx
// Batch B7b (replaces B7, which ran at ~1 game/min): parallel backtest-ledger enrollment.
// Scope: ONLY games that need the engine —
//   (a) final games with zero ledger rows (the June/July/May enrollment gap),
//   (b) the 3 score-corruption games from B3 (rows echo wrong actuals),
//   (c) games whose rows have quarantineReason='actual score missing' (actuals now exist).
// Legacy rows elsewhere are untouched. Leakage quarantines (result='QUARANTINED' with
// modelRunAt>=start reasons) are preserved exactly (pre-capture + restore); the provenance rule
// is applied to newly written rows in the post-pass.
// Coordinator forks N worker processes (this same file with --worker --ids-file), each driving
// runMultiMarketBacktest(gameId, false) over its slice.
import mysql from 'mysql2/promise';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const AS_OF = '2026-07-25';
const AUDIT_VERSION = 'audit-backfill-20260725';
const WORKERS = 8;
const IS_WORKER = process.argv.includes('--worker');
const EXECUTE = process.argv.includes('--execute') || IS_WORKER;

async function connect() {
  const url = process.env.DATABASE_URL!;
  try { const c = await mysql.createConnection(url); await c.query('SELECT 1'); return c; }
  catch { return mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }); }
}

if (IS_WORKER) {
  const idsFile = process.argv[process.argv.indexOf('--ids-file') + 1];
  const ids: number[] = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
  const { runMultiMarketBacktest } = await import('../../../../../server/mlbMultiMarketBacktest');
  const origLog = console.log;
  console.log = () => {};
  let ok = 0, err = 0;
  for (const id of ids) {
    try { await runMultiMarketBacktest(id, false); ok++; }
    catch (e: any) { console.error(`WORKER FAIL ${id}: ${String(e?.message).slice(0, 120)}`); err++; }
  }
  console.log = origLog;
  console.log(`worker done: ok=${ok} err=${err}`);
  process.exit(0);
}

const conn = await connect();
const q = async (sql: string, p?: unknown[]) => (await conn.query(sql, p))[0] as any[];
const runStart = Date.now();

// target set
const unenrolled = await q(
  `SELECT g.id FROM games g LEFT JOIN (SELECT DISTINCT gameId FROM mlb_game_backtest) b ON b.gameId=g.id
   WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate>='2026-03-25' AND g.gameDate<=? AND g.mlbGamePk IS NOT NULL
     AND b.gameId IS NULL`, [AS_OF]);
const scoreFixed = await q(
  `SELECT DISTINCT b.gameId id FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId
   WHERE (b.actualAwayScore <> g.actualAwayScore OR b.actualHomeScore <> g.actualHomeScore)
     AND g.gameStatus='final' AND g.sport='MLB'`);
const missingData = await q(
  `SELECT DISTINCT b.gameId id FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId
   WHERE b.quarantineReason='actual score missing' AND g.actualAwayScore IS NOT NULL AND g.gameStatus='final'`);
const targetIds = [...new Set([...unenrolled, ...scoreFixed, ...missingData].map((r: any) => Number(r.id)))];
console.log(`targets: unenrolled=${unenrolled.length}, scoreFixed=${scoreFixed.length}, missingDataGames=${missingData.length}, union=${targetIds.length}`);

// preserve ONLY true leakage quarantines
const preserved = await q(
  `SELECT id, quarantineReason FROM mlb_game_backtest WHERE result='QUARANTINED' AND quarantineReason LIKE 'modelRunAt%'`);
console.log(`preserved leakage-quarantine rows: ${preserved.length}`);

if (!EXECUTE) { console.log('[dry-run] stopping before drive'); await conn.end(); process.exit(0); }

// fork workers
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b7b-'));
const slices: number[][] = Array.from({ length: WORKERS }, () => []);
targetIds.forEach((id, i) => slices[i % WORKERS].push(id));
await Promise.all(
  slices.filter((s) => s.length).map((slice, w) => {
    const f = path.join(tmp, `ids-${w}.json`);
    fs.writeFileSync(f, JSON.stringify(slice));
    return new Promise<void>((resolve) => {
      const child = spawn('npx', ['tsx', process.argv[1], '--worker', '--ids-file', f], { stdio: ['ignore', 'inherit', 'inherit'] });
      child.on('exit', () => resolve());
    });
  })
);
console.log('all workers finished');

// post-pass: restore leakage quarantines
for (const p of preserved) {
  await conn.query(`UPDATE mlb_game_backtest SET result='QUARANTINED', correct=NULL, quarantineReason=? WHERE id=?`, [p.quarantineReason, p.id]);
}
// stamp start times + modelRunAt + leakageSafe on this run's rows
await conn.query(
  `UPDATE mlb_game_backtest b
   JOIN games g ON g.id = b.gameId
   JOIN mlb_schedule_history s ON s.gameDate = g.gameDate AND s.awayAbbr = g.awayTeam AND s.homeAbbr = g.homeTeam AND s.gameStatus='complete'
   SET b.gameStartUtcMs = UNIX_TIMESTAMP(REPLACE(REPLACE(s.startTimeUtc,'T',' '),'.000Z',''))*1000,
       b.modelRunAt = g.modelRunAt
   WHERE b.backtestRunAt >= ? AND b.gameStartUtcMs IS NULL`, [runStart]);
await conn.query(
  `UPDATE mlb_game_backtest SET leakageSafe = IF(modelRunAt IS NULL OR gameStartUtcMs IS NULL, NULL, modelRunAt < gameStartUtcMs)
   WHERE backtestRunAt >= ?`, [runStart]);
const [newQ] = await conn.query(
  `UPDATE mlb_game_backtest SET result='QUARANTINED', correct=NULL,
     quarantineReason=CONCAT('modelRunAt=', modelRunAt, ' >= gameStartUtcMs=', gameStartUtcMs)
   WHERE backtestRunAt >= ? AND leakageSafe = 0 AND result <> 'QUARANTINED'`, [runStart]) as any;
await conn.query(`UPDATE mlb_game_backtest SET auditVersion=? WHERE backtestRunAt >= ? AND auditVersion IS NULL`, [AUDIT_VERSION, runStart]);

const [[after]] = [await q(`SELECT COUNT(*) rows_total, COUNT(DISTINCT gameId) games FROM mlb_game_backtest`)] as any;
const [[cov]] = [await q(
  `SELECT COUNT(DISTINCT g.id) enrolled FROM games g JOIN mlb_game_backtest b ON b.gameId=g.id
   WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate>='2026-03-25' AND g.gameDate<=?`, [AS_OF])] as any;
console.log(`post: rows=${after.rows_total} games=${after.games}; enrolled finals=${cov.enrolled}; new provenance quarantines=${newQ.affectedRows}`);
await conn.end();
process.exit(0);
