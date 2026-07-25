#!/usr/bin/env node
// Batch B3b: the two 4/30 DH game-2 rows (created manually, ids 3270003/3270004) lack
// mlbGamePk and carry doubleHeader='N'. Patch from StatsAPI-verified facts. This was part of
// the original B3 plan and was dropped in the rewrite — see action log.
import { connect, execFlag } from './_db.mjs';

const EXECUTE = execFlag();
const conn = await connect();

const PATCHES = [
  { id: 3270003, pk: 824850, dh: 'Y' }, // HOU@BAL 4/30 G2
  { id: 3270004, pk: 823471, dh: 'S' }, // SF@PHI 4/30 G2
];

const j = await (await fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-04-30')).json();
const day = j.dates?.[0]?.games ?? [];
for (const p of PATCHES) {
  const g = day.find((x) => x.gamePk === p.pk);
  if (!g || g.status.codedGameState !== 'F' || (g.gameNumber ?? 1) !== 2) {
    console.log(`ABORT ${p.id}: StatsAPI mismatch for pk ${p.pk}`);
    continue;
  }
  // The pk is currently held by the 4/29 postponed leftover row (2250429/2250432): the same
  // physical game listed twice. Transfer the pk to the canonical played-game row; the 4/29 row
  // stays as a factual postponement record (its K props are book-void, exempted separately).
  const [holder] = (await conn.query(`SELECT id, gameDate, gameStatus FROM games WHERE mlbGamePk=?`, [p.pk]))[0];
  console.log(`PLAN ${p.id} <- pk=${p.pk} dh=${p.dh} (G2 final ${g.teams.away.score}-${g.teams.home.score}); current holder: ${holder ? `${holder.id} ${holder.gameDate} ${holder.gameStatus}` : 'none'}`);
  if (EXECUTE) {
    if (holder && holder.gameStatus === 'postponed' && holder.id !== p.id) {
      await conn.beginTransaction();
      try {
        await conn.query(`UPDATE games SET mlbGamePk=NULL WHERE id=? AND gameStatus='postponed'`, [holder.id]);
        const [r] = await conn.query(`UPDATE games SET mlbGamePk=?, doubleHeader=? WHERE id=? AND mlbGamePk IS NULL`, [p.pk, p.dh, p.id]);
        await conn.commit();
        console.log(` transferred pk ${p.pk}: ${holder.id} -> ${p.id} (affected ${r.affectedRows})`);
      } catch (e) { await conn.rollback(); throw e; }
    } else if (!holder) {
      const [r] = await conn.query(`UPDATE games SET mlbGamePk=?, doubleHeader=? WHERE id=? AND mlbGamePk IS NULL`, [p.pk, p.dh, p.id]);
      console.log(` patched ${p.id}: affectedRows=${r.affectedRows}`);
    } else console.log(` SKIP: holder ${holder.id} is not a postponed leftover — manual review`);
  }
}
await conn.end();
