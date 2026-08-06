#!/usr/bin/env node
// Batch B2: resolve zombie statuses and backfill FG actual scores on `games` from
// mlb_schedule_history (both already snapshotted in B1).
// Rules (targeted UPDATEs only, idempotent):
//   R1: games MLB row, gameDate < AS_OF, status in (live, upcoming):
//         schedule complete  -> gameStatus='final' + scores
//         schedule postponed -> gameStatus='postponed'
//   R2: games MLB row linked to a complete schedule game, actual scores null -> fill scores
//       (covers SF@ATL 6/16 postponed->final and the All-Star row via R1/R2 status+scores)
//   R3: games.awayScore/homeScore (display) filled only where null.
import { connect, execFlag } from './_db.mjs';

const AS_OF = '2026-07-25';
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

// Build schedule linkage exactly as the census did (date + abbrs + start-time sequence)
const sched = await q(
  `SELECT anGameId, gameDate, awayAbbr, homeAbbr, gameStatus, awayScore, homeScore, startTimeUtc
   FROM mlb_schedule_history WHERE game_type='regular_season' AND gameDate>='2026-01-01' AND gameDate<=?
   ORDER BY gameDate, awayAbbr, homeAbbr, startTimeUtc`, [AS_OF]);
{ const c = new Map(); for (const r of sched) { const k = `${r.gameDate}|${r.awayAbbr}|${r.homeAbbr}`; c.set(k, (c.get(k)||0)+1); r.seq = c.get(k); } }
const sByKey = new Map(sched.map(r => [`${r.gameDate}|${r.awayAbbr}|${r.homeAbbr}|${r.seq}`, r]));

const games = await q(
  `SELECT id, gameDate, awayTeam, homeTeam, gameNumber, startTimeEst, gameStatus,
          actualAwayScore, actualHomeScore, awayScore, homeScore
   FROM games WHERE sport='MLB' AND gameDate>='2026-03-01' AND gameDate<=?
   ORDER BY gameDate, awayTeam, homeTeam, gameNumber, startTimeEst`, [AS_OF]);
{ const c = new Map(); for (const r of games) { const k = `${r.gameDate}|${r.awayTeam}|${r.homeTeam}`; c.set(k, (c.get(k)||0)+1); r.seq = c.get(k); } }

const updates = [];
for (const g of games) {
  const s = sByKey.get(`${g.gameDate}|${g.awayTeam}|${g.homeTeam}|${g.seq}`);
  if (!s) continue;
  const set = {};
  if (['live', 'upcoming'].includes(g.gameStatus) && g.gameDate < AS_OF) {
    if (s.gameStatus === 'complete') set.gameStatus = 'final';
    else if (s.gameStatus === 'postponed') set.gameStatus = 'postponed';
  }
  if (g.gameStatus === 'postponed' && s.gameStatus === 'complete') set.gameStatus = 'final'; // SF@ATL 6/16 class
  const complete = s.gameStatus === 'complete';
  if (complete && s.awayScore !== null && s.homeScore !== null) {
    if (g.actualAwayScore === null) set.actualAwayScore = s.awayScore;
    if (g.actualHomeScore === null) set.actualHomeScore = s.homeScore;
    if (g.awayScore === null) set.awayScore = s.awayScore;
    if (g.homeScore === null) set.homeScore = s.homeScore;
  }
  if (Object.keys(set).length) updates.push({ id: g.id, date: g.gameDate, matchup: `${g.awayTeam}@${g.homeTeam}#${g.seq}`, from: g.gameStatus, set });
}

console.log(`planned updates: ${updates.length}`);
for (const u of updates) console.log(` ${u.id} ${u.date} ${u.matchup} [${u.from}] -> ${JSON.stringify(u.set)}`);

if (EXECUTE && updates.length) {
  const [{ n: beforeFinal }] = await q(`SELECT COUNT(*) n FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
  await conn.beginTransaction();
  try {
    for (const u of updates) {
      const cols = Object.keys(u.set).map(c => `\`${c}\`=?`).join(', ');
      await conn.query(`UPDATE games SET ${cols} WHERE id=?`, [...Object.values(u.set), u.id]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  const [{ n: afterFinal }] = await q(`SELECT COUNT(*) n FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
  const [{ n: missingActuals }] = await q(`SELECT COUNT(*) n FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-01' AND gameDate<=? AND (actualAwayScore IS NULL OR actualHomeScore IS NULL)`, [AS_OF]);
  console.log(`final-count before=${beforeFinal} after=${afterFinal}; finals still missing actuals=${missingActuals}`);
}
await conn.end();
