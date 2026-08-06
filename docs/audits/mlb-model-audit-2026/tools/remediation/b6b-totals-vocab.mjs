#!/usr/bin/env node
// Batch B6b: align B6's *TotalResult vocabulary with the schema-documented domain used by the
// repaired forward path (cluster G): *TotalResult holds the ACTUAL market side
// (OVER/UNDER/PUSH); the model-pick verdict lives in *TotalCorrect. B6 wrote WIN/LOSS there;
// this converts those rows. Idempotent.
import { connect, execFlag } from './_db.mjs';

const AS_OF = '2026-07-25';
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

const [pre] = await q(
  `SELECT SUM(fgTotalResult IN ('WIN','LOSS')) fg, SUM(f5TotalResult IN ('WIN','LOSS')) f5
   FROM games WHERE sport='MLB' AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
console.log(`rows to convert: fgTotalResult=${pre.fg}, f5TotalResult=${pre.f5}`);

if (EXECUTE) {
  const [r1] = await conn.query(
    `UPDATE games SET fgTotalResult = IF(COALESCE(actualFgTotal, actualAwayScore+actualHomeScore) > bookTotal, 'OVER', 'UNDER')
     WHERE sport='MLB' AND gameDate>='2026-03-01' AND gameDate<=? AND fgTotalResult IN ('WIN','LOSS')
       AND bookTotal IS NOT NULL AND actualAwayScore IS NOT NULL`, [AS_OF]);
  const [r2] = await conn.query(
    `UPDATE games SET f5TotalResult = IF(COALESCE(actualF5Total, actualF5AwayScore+actualF5HomeScore) > f5Total, 'OVER', 'UNDER')
     WHERE sport='MLB' AND gameDate>='2026-03-01' AND gameDate<=? AND f5TotalResult IN ('WIN','LOSS')
       AND f5Total IS NOT NULL AND actualF5AwayScore IS NOT NULL`, [AS_OF]);
  console.log(`converted: fg=${r1.affectedRows}, f5=${r2.affectedRows}`);
  const [post] = await q(
    `SELECT SUM(fgTotalResult IN ('WIN','LOSS')) fg, SUM(f5TotalResult IN ('WIN','LOSS')) f5
     FROM games WHERE sport='MLB' AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
  console.log(`remaining WIN/LOSS vocab: fg=${post.fg}, f5=${post.f5} (should be 0)`);
}
await conn.end();
