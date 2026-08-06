#!/usr/bin/env node
// Batch B3: create the 11 completed games missing from `games` (8 DH game-2s + 3 makeups),
// patch mlbGamePk/doubleHeader on the two 4/30 DH G2 rows, and fix the D-003 pair.
// Every inserted game is verified against BOTH mlb_schedule_history scores and MLB StatsAPI
// (gamePk, doubleHeader type, game number, venue, start time). Inserts are final, unpublished
// (publishedToFeed=0, publishedModel=0), with no projections (those come from Phase 5 replay).
import { connect, execFlag } from './_db.mjs';

const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

const teamByAbbr = new Map((await q(`SELECT abbrev, mlbId FROM mlb_teams`)).map((r) => [r.abbrev, r.mlbId]));

// The 11 unlinked complete schedule games (census evidence: game-universe.csv linkStatus=UNLINKED, schedStatus=complete)
const MISSING = [
  { date: '2026-04-03', away: 'TOR', home: 'CWS' },
  { date: '2026-04-04', away: 'MIL', home: 'KC' },
  { date: '2026-04-26', away: 'BOS', home: 'BAL' },
  { date: '2026-04-26', away: 'COL', home: 'NYM' },
  { date: '2026-05-07', away: 'NYM', home: 'COL' },
  { date: '2026-05-23', away: 'STL', home: 'CIN' },
  { date: '2026-05-24', away: 'DET', home: 'BAL' },
  { date: '2026-06-17', away: 'SF', home: 'ATL' },
  { date: '2026-06-24', away: 'CHC', home: 'NYM' },
  { date: '2026-07-07', away: 'MIL', home: 'STL' },
  { date: '2026-07-11', away: 'MIL', home: 'PIT' },
];
const PATCH_PK = [
  { id: 3270003, date: '2026-04-30', away: 'HOU', home: 'BAL', gameNumber: 2 },
  { id: 3270004, date: '2026-04-30', away: 'SF', home: 'PHI', gameNumber: 2 },
];

const estTime = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

async function statsapiDay(date) {
  const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=venue`);
  if (!res.ok) throw new Error(`statsapi ${date}: HTTP ${res.status}`);
  const j = await res.json();
  return (j.dates?.[0]?.games ?? []);
}

const existingPks = new Set((await q(`SELECT mlbGamePk pk FROM games WHERE mlbGamePk IS NOT NULL`)).map((r) => Number(r.pk)));

const inserts = [];
for (const m of MISSING) {
  const dayGames = await statsapiDay(m.date);
  const cands = dayGames.filter(
    (g) => g.teams.away.team.id === teamByAbbr.get(m.away) && g.teams.home.team.id === teamByAbbr.get(m.home) && g.status.codedGameState === 'F'
  );
  const pick = cands.find((g) => !existingPks.has(g.gamePk));
  if (!pick) { console.log(`ERROR no unclaimed StatsAPI final game for ${m.date} ${m.away}@${m.home} (cands=${cands.length})`); continue; }
  // cross-check against schedule table scores
  const [sched] = await q(
    `SELECT awayScore, homeScore FROM mlb_schedule_history WHERE gameDate=? AND awayAbbr=? AND homeAbbr=? AND gameStatus='complete' ORDER BY startTimeUtc DESC LIMIT 1`,
    [m.date, m.away, m.home]
  );
  const aw = pick.teams.away.score, hm = pick.teams.home.score;
  const schedMatch = sched && Number(sched.awayScore) === aw && Number(sched.homeScore) === hm;
  inserts.push({
    ...m, gamePk: pick.gamePk, aw, hm, dh: pick.doubleHeader ?? 'N', gameNumber: pick.gameNumber ?? 1,
    venue: pick.venue?.name ?? null, time: estTime(pick.gameDate), schedMatch,
  });
}

console.log('planned inserts:');
for (const i of inserts)
  console.log(` ${i.date} ${i.away}@${i.home} G${i.gameNumber} dh=${i.dh} pk=${i.gamePk} score=${i.aw}-${i.hm} venue="${i.venue}" ${i.time} schedScoreMatch=${i.schedMatch}`);

const patches = [];
for (const p of PATCH_PK) {
  const dayGames = await statsapiDay(p.date);
  const pick = dayGames.find(
    (g) => g.teams.away.team.id === teamByAbbr.get(p.away) && g.teams.home.team.id === teamByAbbr.get(p.home) && (g.gameNumber ?? 1) === p.gameNumber
  );
  if (!pick) { console.log(`ERROR no StatsAPI match for patch ${p.date} ${p.away}@${p.home} G${p.gameNumber}`); continue; }
  patches.push({ id: p.id, gamePk: pick.gamePk, dh: pick.doubleHeader ?? 'S' });
}
console.log('planned patches:', JSON.stringify(patches));

if (EXECUTE) {
  const [{ n: before }] = await q(`SELECT COUNT(*) n FROM games WHERE sport='MLB'`);
  await conn.beginTransaction();
  try {
    for (const i of inserts) {
      await conn.query(
        `INSERT INTO games (fileId, gameDate, startTimeEst, awayTeam, homeTeam, sport, gameType, gameStatus,
                            actualAwayScore, actualHomeScore, awayScore, homeScore, mlbGamePk, doubleHeader, gameNumber,
                            venue, publishedToFeed, publishedModel, sortOrder)
         SELECT 0, ?, ?, ?, ?, 'MLB', 'regular_season', 'final', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 9999
         FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM games WHERE mlbGamePk = ?)`,
        [i.date, i.time, i.away, i.home, i.aw, i.hm, i.aw, i.hm, i.gamePk, i.dh, i.gameNumber, i.venue, i.gamePk]
      );
    }
    for (const p of patches) {
      await conn.query(`UPDATE games SET mlbGamePk=?, doubleHeader=? WHERE id=? AND mlbGamePk IS NULL`, [p.gamePk, p.dh, p.id]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  const [{ n: after }] = await q(`SELECT COUNT(*) n FROM games WHERE sport='MLB'`);
  const [{ n: nullPk }] = await q(`SELECT COUNT(*) n FROM games WHERE sport='MLB' AND gameDate>='2026-03-01' AND gameDate<='2026-07-25' AND mlbGamePk IS NULL AND awayTeam<>'AL'`);
  console.log(`games MLB rows before=${before} after=${after} (expected +${inserts.length}); in-season null gamePk (excl ASG)=${nullPk}`);
}
await conn.end();
