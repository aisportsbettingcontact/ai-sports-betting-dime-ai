#!/usr/bin/env node
// Batch B4: derived actuals for every completed game (grading substrate).
//   Step 1 (SQL): actualNrfiBinary derived from nrfiActualResult where present (D-005).
//   Step 2 (SQL): actualFgTotal = actualAwayScore+actualHomeScore where null.
//   Step 3 (StatsAPI linescore by mlbGamePk): F5 away/home/total, first-inning both halves
//            -> actualF5*, actualNrfiBinary, nrfiActualResult for all finals still missing them.
// Idempotent; only fills nulls (never overwrites a non-null actual except nothing here does).
import { connect, execFlag } from './_db.mjs';

const AS_OF = '2026-07-25';
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

// Step 1+2 previews
const [{ n: nrfiFromString }] = await q(
  `SELECT COUNT(*) n FROM games WHERE sport='MLB' AND actualNrfiBinary IS NULL AND nrfiActualResult IN ('NRFI','YRFI') AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
const [{ n: fgTotalFill }] = await q(
  `SELECT COUNT(*) n FROM games WHERE sport='MLB' AND gameStatus='final' AND actualFgTotal IS NULL AND actualAwayScore IS NOT NULL AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
console.log(`step1 nrfi binary from string: ${nrfiFromString} rows; step2 actualFgTotal fill: ${fgTotalFill} rows`);

if (EXECUTE) {
  await conn.query(
    `UPDATE games SET actualNrfiBinary = IF(nrfiActualResult='NRFI',1,0)
     WHERE sport='MLB' AND actualNrfiBinary IS NULL AND nrfiActualResult IN ('NRFI','YRFI') AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
  await conn.query(
    `UPDATE games SET actualFgTotal = actualAwayScore + actualHomeScore
     WHERE sport='MLB' AND gameStatus='final' AND actualFgTotal IS NULL AND actualAwayScore IS NOT NULL AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
  console.log('step1+2 executed');
}

// Step 3: linescore ingestion for finals missing F5 or NRFI actuals
const targets = await q(
  `SELECT id, mlbGamePk, gameDate, awayTeam, homeTeam FROM games
   WHERE sport='MLB' AND gameStatus='final' AND mlbGamePk IS NOT NULL AND gameDate>='2026-03-01' AND gameDate<=?
     AND (actualF5AwayScore IS NULL OR actualF5HomeScore IS NULL OR actualF5Total IS NULL OR actualNrfiBinary IS NULL)`, [AS_OF]);
console.log(`step3 linescore targets: ${targets.length} games`);

let done = 0, failed = 0;
const updates = [];
for (const t of targets) {
  try {
    const j = await (await fetch(`https://statsapi.mlb.com/api/v1/game/${t.mlbGamePk}/linescore`)).json();
    const inn = j.innings ?? [];
    if (inn.length < 5) { console.log(` SKIP ${t.id} ${t.gameDate} ${t.awayTeam}@${t.homeTeam}: only ${inn.length} innings`); failed++; continue; }
    const f5a = inn.slice(0, 5).reduce((s, i) => s + (i.away?.runs ?? 0), 0);
    const f5h = inn.slice(0, 5).reduce((s, i) => s + (i.home?.runs ?? 0), 0);
    const i1 = (inn[0].away?.runs ?? 0) + (inn[0].home?.runs ?? 0);
    updates.push({ id: t.id, f5a, f5h, f5t: f5a + f5h, nrfi: i1 === 0 ? 1 : 0 });
    done++;
  } catch (e) { console.log(` FAIL ${t.id}: ${e.message}`); failed++; }
}
console.log(`step3 fetched: ${done} ok, ${failed} skipped/failed`);

if (EXECUTE && updates.length) {
  await conn.beginTransaction();
  try {
    for (const u of updates) {
      await conn.query(
        `UPDATE games SET
           actualF5AwayScore = COALESCE(actualF5AwayScore, ?),
           actualF5HomeScore = COALESCE(actualF5HomeScore, ?),
           actualF5Total     = COALESCE(actualF5Total, ?),
           actualNrfiBinary  = COALESCE(actualNrfiBinary, ?),
           nrfiActualResult  = COALESCE(nrfiActualResult, IF(?=1,'NRFI','YRFI'))
         WHERE id = ?`,
        [u.f5a, u.f5h, u.f5t, u.nrfi, u.nrfi, u.id]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
}

// verification
const [v] = await q(
  `SELECT SUM(actualF5AwayScore IS NULL OR actualF5HomeScore IS NULL) missF5,
          SUM(actualNrfiBinary IS NULL) missNrfi,
          SUM(actualFgTotal IS NULL) missFgTot,
          COUNT(*) finals
   FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
console.log(`post-state over ${v.finals} finals: missing F5=${v.missF5}, NRFI=${v.missNrfi}, fgTotal=${v.missFgTot}`);
await conn.end();
