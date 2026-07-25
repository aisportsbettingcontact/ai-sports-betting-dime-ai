#!/usr/bin/env tsx
// Batch B7: backtest-ledger repair + enrollment by driving the repo's own engine
// (runMultiMarketBacktest) for every in-season final game, with a provenance wrapper:
//   pre-pass : preserve every quarantined/void row's state (the engine has NO leakage guard —
//              legacy quarantines came from a separate audit pass and must survive)
//   drive    : runMultiMarketBacktest(gameId, /*runKProps=*/false) — K props excluded so the
//              engine's scratched-pitcher grading bug cannot overwrite B6's corrected grades
//   post-pass: restore preserved quarantines; stamp gameStartUtcMs (schedule), modelRunAt
//              (games), leakageSafe; quarantine newly enrolled rows that fail the same
//              provenance rule; stamp auditVersion on rows written by this run.
// Idempotent: engine writer is insert-or-update; post-pass is deterministic.
import { runMultiMarketBacktest } from '../../../../../server/mlbMultiMarketBacktest';
import mysql from 'mysql2/promise';

const AS_OF = '2026-07-25';
const AUDIT_VERSION = 'audit-backfill-20260725';
const EXECUTE = process.argv.includes('--execute');
console.error(EXECUTE ? '[mode] EXECUTE' : '[mode] DRY-RUN (counts only, no engine drive)');

async function connect() {
  const url = process.env.DATABASE_URL!;
  try { const c = await mysql.createConnection(url); await c.query('SELECT 1'); return c; }
  catch { return mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }); }
}
const conn = await connect();
const q = async (sql: string, p?: unknown[]) => (await conn.query(sql, p))[0] as any[];

const runStart = Date.now();

// pre-pass
const preserved = await q(
  `SELECT id, result, correct, quarantineReason, voidReason, leakageSafe FROM mlb_game_backtest
   WHERE result='QUARANTINED' OR quarantineReason IS NOT NULL OR voidReason IS NOT NULL`);
const [{ n: rowsBefore }] = await q(`SELECT COUNT(*) n FROM mlb_game_backtest`);
const [{ n: learnBefore }] = await q(`SELECT COUNT(*) n FROM mlb_model_learning_log`);
const targets = await q(
  `SELECT id, gameDate FROM games
   WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-25' AND gameDate<=? AND mlbGamePk IS NOT NULL
   ORDER BY gameDate, id`, [AS_OF]);
console.log(`pre: ledger rows=${rowsBefore}, preserved quarantine/void rows=${preserved.length}, learning-log=${learnBefore}, target finals=${targets.length}`);

if (EXECUTE) {
  let ok = 0, err = 0;
  const origLog = console.log; // silence the engine's per-game spam, keep our own lines
  for (const t of targets) {
    console.log = () => {};
    try { await runMultiMarketBacktest(t.id, false); ok++; }
    catch (e: any) { console.log = origLog; console.error(` ENGINE FAIL game ${t.id} (${t.gameDate}): ${String(e?.message).slice(0, 160)}`); err++; }
    console.log = origLog;
    if ((ok + err) % 100 === 0) console.error(` progress: ${ok + err}/${targets.length} (errors ${err})`);
  }
  console.log(`engine drive: ok=${ok} err=${err}`);

  // post-pass 1: restore preserved quarantine/void state
  for (const p of preserved) {
    await conn.query(
      `UPDATE mlb_game_backtest SET result=?, correct=?, quarantineReason=?, voidReason=?, leakageSafe=? WHERE id=?`,
      [p.result, p.correct, p.quarantineReason, p.voidReason, p.leakageSafe, p.id]);
  }
  console.log(`restored ${preserved.length} preserved quarantine/void rows`);

  // post-pass 2: stamp gameStartUtcMs + modelRunAt + leakageSafe on all rows of target games
  await conn.query(
    `UPDATE mlb_game_backtest b
     JOIN games g ON g.id = b.gameId
     JOIN mlb_schedule_history s ON s.gameDate = g.gameDate AND s.awayAbbr = g.awayTeam AND s.homeAbbr = g.homeTeam
       AND s.gameStatus='complete'
     SET b.gameStartUtcMs = UNIX_TIMESTAMP(REPLACE(REPLACE(s.startTimeUtc,'T',' '),'.000Z',''))*1000,
         b.modelRunAt = g.modelRunAt
     WHERE g.sport='MLB' AND g.gameDate>='2026-03-25' AND g.gameDate<=? AND b.gameStartUtcMs IS NULL`, [AS_OF]);
  await conn.query(
    `UPDATE mlb_game_backtest SET leakageSafe = IF(modelRunAt IS NULL OR gameStartUtcMs IS NULL, NULL, modelRunAt < gameStartUtcMs)
     WHERE backtestRunAt >= ?`, [runStart]);
  // post-pass 3: quarantine newly written rows with unprovable provenance (same rule + format as legacy)
  const preservedIds = new Set(preserved.map((p: any) => p.id));
  const suspect = await q(
    `SELECT id FROM mlb_game_backtest
     WHERE backtestRunAt >= ? AND leakageSafe = 0 AND result <> 'QUARANTINED'`, [runStart]);
  const newQuarantine = suspect.filter((r: any) => !preservedIds.has(r.id));
  for (const r of newQuarantine) {
    await conn.query(
      `UPDATE mlb_game_backtest SET result='QUARANTINED', correct=NULL,
         quarantineReason=CONCAT('modelRunAt=', modelRunAt, ' >= gameStartUtcMs=', gameStartUtcMs) WHERE id=?`, [r.id]);
  }
  await conn.query(`UPDATE mlb_game_backtest SET auditVersion=? WHERE backtestRunAt >= ? AND auditVersion IS NULL`, [AUDIT_VERSION, runStart]);
  console.log(`new provenance quarantines on backfilled rows: ${newQuarantine.length}`);

  const [{ n: rowsAfter }] = await q(`SELECT COUNT(*) n FROM mlb_game_backtest`);
  const [{ n: learnAfter }] = await q(`SELECT COUNT(*) n FROM mlb_model_learning_log`);
  const [{ n: gamesEnrolled }] = await q(
    `SELECT COUNT(DISTINCT b.gameId) n FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId
     WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate>='2026-03-25' AND g.gameDate<=?`, [AS_OF]);
  console.log(`post: ledger rows ${rowsBefore} -> ${rowsAfter}; enrolled final games=${gamesEnrolled}/${targets.length}; learning-log ${learnBefore} -> ${learnAfter}`);
}
await conn.end();
process.exit(0);
