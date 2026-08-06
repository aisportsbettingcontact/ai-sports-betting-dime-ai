#!/usr/bin/env node
// Batch B7c: post-pass that B7b's crashed coordinator never ran (its connection idled out
// during the 40-min worker drive; workers completed; quarantine integrity verified undamaged).
// Stamps gameStartUtcMs/modelRunAt/leakageSafe on rows missing them, quarantines new rows with
// unprovable provenance (same rule + format as legacy), stamps auditVersion on rows written
// today without one.
import { connect, execFlag } from './_db.mjs';

const AS_OF = '2026-07-25';
const AUDIT_VERSION = 'audit-backfill-20260725';
const TODAY_START_MS = Date.parse('2026-07-25T14:00:00Z'); // authorization time; all backfill writes are after this
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

const [pre] = await q(
  `SELECT SUM(gameStartUtcMs IS NULL) noStart, SUM(auditVersion IS NULL AND backtestRunAt >= ?) unversioned,
          SUM(leakageSafe IS NULL) noLeakFlag FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId
   WHERE g.sport='MLB' AND g.gameDate>='2026-03-25' AND g.gameDate<=?`, [TODAY_START_MS, AS_OF]);
console.log(`pre: rows missing start=${pre.noStart}, unversioned-today=${pre.unversioned}, no leak flag=${pre.noLeakFlag}`);

if (EXECUTE) {
  const [r1] = await conn.query(
    `UPDATE mlb_game_backtest b
     JOIN games g ON g.id = b.gameId
     JOIN mlb_schedule_history s ON s.gameDate = g.gameDate AND s.awayAbbr = g.awayTeam AND s.homeAbbr = g.homeTeam AND s.gameStatus='complete'
     SET b.gameStartUtcMs = UNIX_TIMESTAMP(REPLACE(REPLACE(s.startTimeUtc,'T',' '),'.000Z',''))*1000,
         b.modelRunAt = COALESCE(b.modelRunAt, g.modelRunAt)
     WHERE g.sport='MLB' AND g.gameDate>='2026-03-25' AND g.gameDate<=? AND b.gameStartUtcMs IS NULL`, [AS_OF]);
  const [r2] = await conn.query(
    `UPDATE mlb_game_backtest SET leakageSafe = IF(modelRunAt IS NULL OR gameStartUtcMs IS NULL, NULL, modelRunAt < gameStartUtcMs)
     WHERE leakageSafe IS NULL OR backtestRunAt >= ?`, [TODAY_START_MS]);
  const [r3] = await conn.query(
    `UPDATE mlb_game_backtest SET result='QUARANTINED', correct=NULL,
       quarantineReason=CONCAT('modelRunAt=', modelRunAt, ' >= gameStartUtcMs=', gameStartUtcMs)
     WHERE backtestRunAt >= ? AND leakageSafe = 0 AND result <> 'QUARANTINED'`, [TODAY_START_MS]);
  const [r4] = await conn.query(
    `UPDATE mlb_game_backtest SET auditVersion=? WHERE backtestRunAt >= ? AND auditVersion IS NULL`, [AUDIT_VERSION, TODAY_START_MS]);
  console.log(`stamped start=${r1.affectedRows}, leakFlag=${r2.affectedRows}, newQuarantines=${r3.affectedRows}, versioned=${r4.affectedRows}`);
  const [post] = await q(
    `SELECT COUNT(DISTINCT b.gameId) enrolled, SUM(b.result='QUARANTINED') quarantined, COUNT(*) rows_n
     FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId
     WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate>='2026-03-25' AND g.gameDate<=?`, [AS_OF]);
  console.log(`post: enrolled finals=${post.enrolled}, quarantined rows=${post.quarantined}, in-season rows=${post.rows_n}`);
}
await conn.end();
