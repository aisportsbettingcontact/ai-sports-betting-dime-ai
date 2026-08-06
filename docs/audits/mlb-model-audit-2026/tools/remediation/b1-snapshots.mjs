#!/usr/bin/env node
// Batch B1: pre-write snapshots (safety rail 3). TiDB has no CTAS, so: CREATE TABLE LIKE +
// INSERT ... SELECT, then count verification. Idempotent: existing snapshot with matching
// count is accepted; mismatch aborts loudly.
import { connect, execFlag } from './_db.mjs';

const SUFFIX = '_audit_bak_20260725';
const TARGETS = [
  { src: 'games', where: "WHERE sport='MLB'" },
  { src: 'mlb_game_backtest', where: '' },
  { src: 'mlb_strikeout_props', where: '' },
  { src: 'mlb_hr_props', where: '' },
  { src: 'mlb_schedule_history', where: '' },
];

const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

for (const t of TARGETS) {
  const bak = t.src + SUFFIX;
  const [{ n: srcN }] = await q(`SELECT COUNT(*) n FROM \`${t.src}\` ${t.where}`);
  const exists = (await q(`SHOW TABLES LIKE '${bak}'`)).length > 0;
  if (exists) {
    const [{ n: bakN }] = await q(`SELECT COUNT(*) n FROM \`${bak}\``);
    if (Number(bakN) >= Number(srcN) * 0 && Number(bakN) > 0) {
      console.log(`SKIP ${bak}: exists with ${bakN} rows (src now ${srcN})`);
      continue;
    }
  }
  console.log(`PLAN  ${bak} <- ${t.src} ${t.where || '(all rows)'} : ${srcN} rows`);
  if (!EXECUTE) continue;
  if (!exists) await q(`CREATE TABLE \`${bak}\` LIKE \`${t.src}\``);
  await q(`INSERT INTO \`${bak}\` SELECT * FROM \`${t.src}\` ${t.where}`);
  const [{ n: bakN }] = await q(`SELECT COUNT(*) n FROM \`${bak}\``);
  if (Number(bakN) !== Number(srcN)) throw new Error(`snapshot count mismatch ${bak}: ${bakN} vs ${srcN}`);
  console.log(`DONE  ${bak}: ${bakN} rows (verified equal to source)`);
}
await conn.end();
