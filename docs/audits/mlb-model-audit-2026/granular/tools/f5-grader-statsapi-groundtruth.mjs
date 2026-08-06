#!/usr/bin/env node
// f5-grader-statsapi-groundtruth.mjs — GRADER role, f5 market group.
// External ground-truthing (sampling permitted for this purpose only): fetches the MLB StatsAPI
// linescore for (a) every game where games.actualF5* disagrees with mlb_replay_linescores or
// actualF5Total, (b) the 2 games with actualF5Total null, (c) a deterministic stratified sample
// of the remaining population (every Nth by date order, ~60 games). Sums innings 1-5 per side
// and compares against both DB sources.
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const DATE_LO = '2026-03-25', DATE_HI = '2026-07-24';
const OUTDIR = path.resolve(new URL('.', import.meta.url).pathname, '../f5');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(2); }
const conn = await mysql.createConnection(url).catch(async () =>
  mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }));
await conn.query('SET SESSION transaction_read_only = 1').catch(() => {});
const q = async (sql, p) => (await conn.query(sql, p))[0];
const num = (v) => (v === null || v === undefined || v === '' ? null : (isNaN(Number(v)) ? null : Number(v)));

const games = await q(`
  SELECT g.id, g.gameDate, g.awayTeam, g.homeTeam, g.mlbGamePk, g.gameNumber,
         g.actualF5AwayScore, g.actualF5HomeScore, g.actualF5Total,
         l.f5AwayRuns lsA, l.f5HomeRuns lsH
  FROM games g LEFT JOIN mlb_replay_linescores l ON l.gameId = g.id
  WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate BETWEEN ? AND ?
    AND g.mlbGamePk IS NOT NULL
  ORDER BY g.gameDate, g.id`, [DATE_LO, DATE_HI]);

const disputed = [], sample = [];
for (const g of games) {
  const a = num(g.actualF5AwayScore), h = num(g.actualF5HomeScore), t = num(g.actualF5Total);
  const lsA = num(g.lsA), lsH = num(g.lsH);
  const dis = (a !== null && lsA !== null && (a !== lsA || h !== lsH)) ||
              (a !== null && t !== null && Math.round(t) !== a + h) ||
              (a !== null && t === null) || a === null;
  if (dis) disputed.push(g);
}
const rest = games.filter((g) => !disputed.includes(g));
const stride = Math.max(1, Math.floor(rest.length / 60));
for (let i = 0; i < rest.length; i += stride) sample.push(rest[i]);
const targets = [...disputed, ...sample];
console.error(`[targets] ${disputed.length} disputed + ${sample.length} sampled = ${targets.length}`);

const out = [];
for (const g of targets) {
  const pk = num(g.mlbGamePk);
  let apiA = null, apiH = null, innCount = null, note = '';
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/game/${pk}/linescore`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    const j = await res.json();
    const inn = j.innings ?? [];
    innCount = inn.length;
    if (inn.length >= 5) {
      apiA = 0; apiH = 0;
      for (const i of inn.slice(0, 5)) { apiA += i.away?.runs ?? 0; apiH += i.home?.runs ?? 0; }
    } else note = `only ${inn.length} innings`;
  } catch (e) { note = 'fetch-failed: ' + e.message; }
  const a = num(g.actualF5AwayScore), h = num(g.actualF5HomeScore), t = num(g.actualF5Total);
  const lsA = num(g.lsA), lsH = num(g.lsH);
  const gamesOk = apiA === null || a === null ? '' : (a === apiA && h === apiH ? 'AGREE' : 'DISAGREE');
  const lsOk = apiA === null || lsA === null ? '' : (lsA === apiA && lsH === apiH ? 'AGREE' : 'DISAGREE');
  const totOk = apiA === null || t === null ? '' : (Math.round(t) === apiA + apiH ? 'AGREE' : 'DISAGREE');
  out.push({
    gameId: g.id, gamePk: pk, gameDate: g.gameDate,
    matchup: `${g.awayTeam}@${g.homeTeam}` + (num(g.gameNumber) > 1 ? ` G${g.gameNumber}` : ''),
    kind: disputed.includes(g) ? 'disputed' : 'sample',
    statsapi_f5: apiA !== null ? `${apiA}-${apiH}` : '', innings: innCount,
    games_actualF5: a !== null ? `${a}-${h}` : '', games_actualF5Total: t,
    linescores_f5: lsA !== null ? `${lsA}-${lsH}` : '',
    games_vs_api: gamesOk, linescores_vs_api: lsOk, actualF5Total_vs_api: totOk, note,
  });
  await new Promise((r) => setTimeout(r, 120));
}
const header = Object.keys(out[0]);
const csvEsc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
fs.writeFileSync(path.join(OUTDIR, 'f5-grader-statsapi-groundtruth.csv'),
  header.join(',') + '\n' + out.map((r) => header.map((hh) => csvEsc(r[hh])).join(',')).join('\n') + '\n');
const agg = { targets: out.length, disputed: disputed.length,
  games_agree: out.filter((r) => r.games_vs_api === 'AGREE').length,
  games_disagree: out.filter((r) => r.games_vs_api === 'DISAGREE').length,
  ls_agree: out.filter((r) => r.linescores_vs_api === 'AGREE').length,
  ls_disagree: out.filter((r) => r.linescores_vs_api === 'DISAGREE').length,
  disagreeRows: out.filter((r) => r.games_vs_api === 'DISAGREE' || r.linescores_vs_api === 'DISAGREE') };
console.log(JSON.stringify(agg, null, 2));
await conn.end();
