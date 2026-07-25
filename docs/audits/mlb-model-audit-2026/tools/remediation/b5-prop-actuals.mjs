#!/usr/bin/env node
// Batch B5: prop actuals from StatsAPI boxscores (one fetch per game, fills both tables).
//   K props: actualKs = starter's strikeouts, ONLY if the listed pitcher actually started
//            (team.pitchers[0]); otherwise EX-SCRATCH exemption (row left null, book-void rule).
//   HR props: actualHr = batter's HR count if the player appeared; otherwise EX-SCRATCH.
// Fills actuals on ALL rows missing them (with or without projections — replay grading needs both).
// Exemptions appended to census/exemptions.csv. Idempotent (only fills nulls).
import { connect, execFlag } from './_db.mjs';
import fs from 'fs';

const AS_OF = '2026-07-25';
const EXEMPT_FILE = new URL('../../census/exemptions.csv', import.meta.url).pathname;
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();

const kRows = await q(
  `SELECT p.id, p.gameId, p.side, p.pitcherName, p.mlbamId, g.mlbGamePk, g.gameDate
   FROM mlb_strikeout_props p JOIN games g ON g.id=p.gameId
   WHERE g.gameStatus='final' AND g.mlbGamePk IS NOT NULL AND g.gameDate>='2026-03-01' AND g.gameDate<=? AND p.actualKs IS NULL`, [AS_OF]);
const hrRows = await q(
  `SELECT p.id, p.gameId, p.side, p.playerName, p.mlbamId, g.mlbGamePk, g.gameDate
   FROM mlb_hr_props p JOIN games g ON g.id=p.gameId
   WHERE g.gameStatus='final' AND g.mlbGamePk IS NOT NULL AND g.gameDate>='2026-03-01' AND g.gameDate<=? AND p.actualHr IS NULL`, [AS_OF]);

const byGame = new Map();
for (const r of kRows) { if (!byGame.has(r.mlbGamePk)) byGame.set(r.mlbGamePk, { k: [], hr: [] }); byGame.get(r.mlbGamePk).k.push(r); }
for (const r of hrRows) { if (!byGame.has(r.mlbGamePk)) byGame.set(r.mlbGamePk, { k: [], hr: [] }); byGame.get(r.mlbGamePk).hr.push(r); }
console.log(`targets: ${kRows.length} K rows + ${hrRows.length} HR rows across ${byGame.size} games`);

const kUpdates = [], hrUpdates = [], exemptions = [];
let fetched = 0, fetchFail = 0;
for (const [pk, rows] of byGame) {
  let box;
  try {
    box = await (await fetch(`https://statsapi.mlb.com/api/v1/game/${pk}/boxscore`)).json();
    fetched++;
  } catch (e) { console.log(` FAIL boxscore ${pk}: ${e.message}`); fetchFail++; continue; }
  for (const teamKey of ['away', 'home']) {
    const team = box.teams?.[teamKey];
    if (!team) continue;
    const starterId = team.pitchers?.[0] ?? null;
    const players = team.players ?? {};
    const byId = new Map(); const byName = new Map();
    for (const p of Object.values(players)) {
      byId.set(p.person?.id, p);
      byName.set(norm(p.person?.fullName), p);
    }
    for (const r of rows.k.filter((x) => x.side === teamKey)) {
      const pl = (r.mlbamId && byId.get(r.mlbamId)) || byName.get(norm(r.pitcherName));
      if (pl && pl.person?.id === starterId && pl.stats?.pitching) {
        kUpdates.push({ id: r.id, ks: pl.stats.pitching.strikeOuts ?? 0 });
      } else {
        exemptions.push(['EX-SCRATCH-K', r.gameDate, String(pk), r.pitcherName, `listed pitcher ${pl ? 'did not start' : 'not in boxscore'}; book-void`].join(','));
      }
    }
    for (const r of rows.hr.filter((x) => x.side === teamKey)) {
      const pl = (r.mlbamId && byId.get(r.mlbamId)) || byName.get(norm(r.playerName));
      const batting = pl?.stats?.batting;
      if (batting && (batting.plateAppearances ?? 0) > 0) {
        hrUpdates.push({ id: r.id, hr: batting.homeRuns ?? 0 });
      } else {
        exemptions.push(['EX-SCRATCH-HR', r.gameDate, String(pk), r.playerName, `player ${pl ? 'no plate appearance' : 'not in boxscore'}; book-void`].join(','));
      }
    }
  }
}
console.log(`plan: ${kUpdates.length} K actuals, ${hrUpdates.length} HR actuals, ${exemptions.length} scratch exemptions (boxscores: ${fetched} ok/${fetchFail} fail)`);

if (EXECUTE) {
  await conn.beginTransaction();
  try {
    for (const u of kUpdates) await conn.query(`UPDATE mlb_strikeout_props SET actualKs=? WHERE id=? AND actualKs IS NULL`, [u.ks, u.id]);
    for (const u of hrUpdates) await conn.query(`UPDATE mlb_hr_props SET actualHr=? WHERE id=? AND actualHr IS NULL`, [u.hr, u.id]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  if (!fs.existsSync(EXEMPT_FILE)) fs.writeFileSync(EXEMPT_FILE, 'code,gameDate,gamePk,player,reason\n');
  fs.appendFileSync(EXEMPT_FILE, exemptions.join('\n') + (exemptions.length ? '\n' : ''));
  const [k] = await q(`SELECT COUNT(*) n FROM mlb_strikeout_props p JOIN games g ON g.id=p.gameId WHERE g.gameStatus='final' AND g.gameDate>='2026-03-01' AND g.gameDate<=? AND p.actualKs IS NULL`, [AS_OF]);
  const [h] = await q(`SELECT COUNT(*) n FROM mlb_hr_props p JOIN games g ON g.id=p.gameId WHERE g.gameStatus='final' AND g.gameDate>='2026-03-01' AND g.gameDate<=? AND p.actualHr IS NULL`, [AS_OF]);
  console.log(`post-state: K rows still null actuals=${k.n} (should equal K scratches), HR still null=${h.n} (should equal HR scratches)`);
}
await conn.end();
