#!/usr/bin/env node
// Batch B3 (revised after diagnosis): the 11 "missing" games all EXIST in `games` under stale
// pre-postponement dates (MLB preserves gamePk across reschedules). Repair = date/status/score
// corrections on existing rows keyed by mlbGamePk — never inserts, projections untouched.
// Also fixes 3 rows where the DH team-pair ingestion bug stored the twin game's score, and two
// schedule-table defects (BOS@BAL 4/25 duplicated onto 4/26; TB@BOS 5/9 stale 'scheduled').
// Every action verified against StatsAPI facts fetched fresh at run time.
import { connect, execFlag } from './_db.mjs';

const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

async function statsapiGame(date, pk) {
  const j = await (await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`)).json();
  return (j.dates?.[0]?.games ?? []).find((g) => g.gamePk === pk) ?? null;
}

// action: { pk, newDate, aw, hm, gameNumber, dh } — applied to the games row holding pk.
const ACTIONS = [
  { pk: 824621, newDate: '2026-04-03', aw: 4, hm: 5, gameNumber: 1, dh: 'N', label: 'TOR@CWS makeup' },
  { pk: 824134, newDate: '2026-04-04', aw: 2, hm: 8, gameNumber: 2, dh: 'S', label: 'MIL@KC G2' },
  { pk: 824132, newDate: '2026-04-04', aw: 5, hm: 2, gameNumber: 1, dh: 'S', label: 'MIL@KC G1 flags' },
  { pk: 823637, newDate: '2026-04-26', aw: 3, hm: 0, gameNumber: 2, dh: 'Y', label: 'COL@NYM G2 (resumed)' },
  { pk: 823635, newDate: '2026-04-26', aw: 3, hm: 1, gameNumber: 1, dh: 'Y', label: 'COL@NYM G1 flags' },
  { pk: 824362, newDate: '2026-05-07', aw: 2, hm: 6, gameNumber: 1, dh: 'N', label: 'NYM@COL makeup' },
  { pk: 824518, newDate: '2026-05-23', aw: 8, hm: 1, gameNumber: 1, dh: 'S', label: 'STL@CIN G1' },
  { pk: 824516, newDate: '2026-05-23', aw: 6, hm: 7, gameNumber: 2, dh: 'S', label: 'STL@CIN G2 SCORE FIX (was 8-1)' },
  { pk: 824839, newDate: '2026-05-24', aw: 3, hm: 5, gameNumber: 1, dh: 'S', label: 'DET@BAL G1 SCORE FIX (was 4-1)' },
  { pk: 824840, newDate: '2026-05-24', aw: 4, hm: 1, gameNumber: 2, dh: 'S', label: 'DET@BAL G2' },
  { pk: 823613, newDate: '2026-06-24', aw: 10, hm: 3, gameNumber: 1, dh: 'S', label: 'CHC@NYM G1' },
  { pk: 823611, newDate: '2026-06-24', aw: 10, hm: 5, gameNumber: 2, dh: 'S', label: 'CHC@NYM G2 flags' },
  { pk: 823062, newDate: '2026-07-07', aw: 4, hm: 3, gameNumber: 1, dh: 'S', label: 'MIL@STL G1' },
  { pk: 823035, newDate: '2026-07-07', aw: 10, hm: 2, gameNumber: 2, dh: 'S', label: 'MIL@STL G2 SCORE FIX (was 4-3)' },
  { pk: 823357, newDate: '2026-07-11', aw: 6, hm: 7, gameNumber: 1, dh: 'S', label: 'MIL@PIT G1' },
  { pk: 823356, newDate: '2026-07-11', aw: 2, hm: 3, gameNumber: 2, dh: 'S', label: 'MIL@PIT G2 flags' },
  { pk: 824851, newDate: '2026-04-25', aw: 17, hm: 1, gameNumber: 1, dh: 'N', label: 'BOS@BAL 4/25 verify' },
];

const plans = [];
let aborts = 0;
for (const a of ACTIONS) {
  const api = await statsapiGame(a.newDate, a.pk);
  if (!api || api.status.codedGameState !== 'F' || api.teams.away.score !== a.aw || api.teams.home.score !== a.hm) {
    console.log(`ABORT ${a.label}: StatsAPI disagrees (${api ? `state=${api.status.codedGameState} score=${api?.teams.away.score}-${api?.teams.home.score}` : 'not found on date'})`);
    aborts++;
    continue;
  }
  const [row] = await q(
    `SELECT id, gameDate, gameStatus, actualAwayScore, actualHomeScore, gameNumber, doubleHeader FROM games WHERE mlbGamePk=?`, [a.pk]);
  if (!row) { console.log(`ABORT ${a.label}: no games row holds pk ${a.pk}`); aborts++; continue; }
  const set = {};
  if (row.gameDate !== a.newDate) set.gameDate = a.newDate;
  if (row.gameStatus !== 'final') set.gameStatus = 'final';
  if (row.actualAwayScore !== a.aw) set.actualAwayScore = a.aw;
  if (row.actualHomeScore !== a.hm) set.actualHomeScore = a.hm;
  if (row.gameNumber !== a.gameNumber) set.gameNumber = a.gameNumber;
  if (row.doubleHeader !== a.dh) set.doubleHeader = a.dh;
  if (Object.keys(set).length === 0) { console.log(`OK    ${a.label}: already correct (id=${row.id})`); continue; }
  set.awayScore = a.aw; set.homeScore = a.hm;
  plans.push({ id: row.id, label: a.label, was: `${row.gameDate}/${row.gameStatus}/${row.actualAwayScore}-${row.actualHomeScore}/G${row.gameNumber}${row.doubleHeader}`, set });
}

// Schedule-table fixes
const schedFixes = [];
{
  const rows = await q(`SELECT anGameId, gameDate, gameStatus, awayScore, homeScore FROM mlb_schedule_history WHERE awayAbbr='BOS' AND homeAbbr='BAL' AND gameDate IN ('2026-04-25','2026-04-26') ORDER BY startTimeUtc`);
  const on26 = rows.filter((r) => r.gameDate === '2026-04-26' && r.gameStatus === 'complete');
  const on25 = rows.filter((r) => r.gameDate === '2026-04-25');
  if (on26.length === 2 && on25.length === 0) {
    // duplicate: earliest-start row keeps 4/26 (5-3); the other becomes the 4/25 game (17-1, StatsAPI-verified above)
    const dup = on26[1];
    schedFixes.push({ table: 'mlb_schedule_history', anGameId: dup.anGameId, set: { gameDate: '2026-04-25', awayScore: 17, homeScore: 1 }, label: `BOS@BAL dup ${dup.anGameId} -> 4/25 17-1 (was ${dup.awayScore}-${dup.homeScore} on 4/26)` });
  } else console.log(`schedule BOS@BAL state: ${JSON.stringify(rows)} — no dup fix applied`);
  const [tbbos] = await q(`SELECT anGameId, gameStatus FROM mlb_schedule_history WHERE anGameId=287980`);
  if (tbbos && tbbos.gameStatus === 'scheduled') {
    const j = await (await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-05-09')).json();
    const tb = (j.dates?.[0]?.games ?? []).filter((g) => g.teams.away.team.id === 139 && g.teams.home.team.id === 111);
    const anyFinal = tb.some((g) => g.status.codedGameState === 'F');
    if (!anyFinal) schedFixes.push({ table: 'mlb_schedule_history', anGameId: 287980, set: { gameStatus: 'postponed' }, label: `TB@BOS 5/9 stale scheduled -> postponed (StatsAPI shows ${tb.length} TB@BOS games on 5/9, none final)` });
    else console.log('TB@BOS 5/9: StatsAPI shows a final game — investigate manually, no fix applied');
  }
}

console.log(`\nplanned games updates: ${plans.length} (aborts: ${aborts})`);
for (const p of plans) console.log(` ${p.id} ${p.label}: [${p.was}] -> ${JSON.stringify(p.set)}`);
console.log(`planned schedule fixes: ${schedFixes.length}`);
for (const f of schedFixes) console.log(` ${f.label}`);

if (EXECUTE && (plans.length || schedFixes.length)) {
  // games_matchup_unique covers (gameDate, awayTeam, homeTeam, gameNumber): apply in-place
  // renumbers (no gameDate change) before date moves so G1 arrivals never collide with a
  // yet-to-be-renumbered G2 twin.
  plans.sort((a, b) => (a.set.gameDate ? 1 : 0) - (b.set.gameDate ? 1 : 0));
  await conn.beginTransaction();
  try {
    for (const p of plans) {
      const cols = Object.keys(p.set).map((c) => `\`${c}\`=?`).join(', ');
      await conn.query(`UPDATE games SET ${cols} WHERE id=?`, [...Object.values(p.set), p.id]);
    }
    for (const f of schedFixes) {
      const cols = Object.keys(f.set).map((c) => `\`${c}\`=?`).join(', ');
      await conn.query(`UPDATE mlb_schedule_history SET ${cols} WHERE anGameId=?`, [...Object.values(f.set), f.anGameId]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  const [{ n }] = await q(`SELECT COUNT(*) n FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-01' AND gameDate<='2026-07-25'`);
  console.log(`post-execute: in-season final games = ${n}`);
}
await conn.end();
