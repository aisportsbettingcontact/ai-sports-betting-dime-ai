#!/usr/bin/env node
// GRADER/kprops extract: pull the FULL live K-prop population + game context + substrate
// + k_prop ledger rows into TSV files for offline re-derivation. READ-ONLY.
// Usage: node grader-kprops-extract.mjs <outDir>
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(2); }
const outDir = process.argv[2];
if (!outDir) { console.error('usage: node grader-kprops-extract.mjs <outDir>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

async function connect() {
  try { const c = await mysql.createConnection(url); await c.query('SELECT 1'); return c; }
  catch { return mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }); }
}
const conn = await connect();
await conn.query('SET SESSION transaction_read_only = 1').catch(() => {});

function writeTsv(file, rows, fields) {
  const esc = (v) => (v === null || v === undefined ? '\\N'
    : (v instanceof Date ? v.toISOString() : String(v)).replace(/\t/g, ' ').replace(/\r?\n/g, ' '));
  const out = fs.createWriteStream(path.join(outDir, file));
  out.write(fields.join('\t') + '\n');
  for (const r of rows) out.write(fields.map((f) => esc(r[f])).join('\t') + '\n');
  out.end();
  console.error(`[extract] ${file}: ${rows.length} rows`);
}

// 1. ALL live strikeout props with their game context (every row in the table, no filter —
//    population accounting happens in the analysis step).
const [props] = await conn.query(
  `SELECT p.id, p.gameId, p.side, p.pitcherName, p.mlbamId, p.kProj, p.bookLine,
          p.pOver, p.pUnder, p.verdict, p.actualKs, p.backtestResult, p.modelError,
          p.modelCorrect, p.backtestRunAt, p.modelRunAt, p.createdAt,
          g.gameDate, g.gameStatus, g.mlbGamePk, g.awayTeam, g.homeTeam, g.sport
   FROM mlb_strikeout_props p LEFT JOIN games g ON g.id = p.gameId`);
writeTsv('props.tsv', props, ['id','gameId','side','pitcherName','mlbamId','kProj','bookLine',
  'pOver','pUnder','verdict','actualKs','backtestResult','modelError','modelCorrect',
  'backtestRunAt','modelRunAt','createdAt','gameDate','gameStatus','mlbGamePk','awayTeam','homeTeam','sport']);

// 2. Finals universe in scope (for population framing).
const [finals] = await conn.query(
  `SELECT id, gameDate, mlbGamePk, awayTeam, homeTeam FROM games
   WHERE sport='MLB' AND gameStatus='final' AND gameDate >= '2026-03-25' AND gameDate <= '2026-07-24'`);
writeTsv('finals.tsv', finals, ['id','gameDate','mlbGamePk','awayTeam','homeTeam']);

// 3. Replay linescore substrate (starter identity + starter Ks per side).
const [ls] = await conn.query(
  `SELECT gamePk, gameId, gameDate, awayStarterId, homeStarterId, awayStarterKs, homeStarterKs,
          awayStarterOuts, homeStarterOuts FROM mlb_replay_linescores`);
writeTsv('linescores.tsv', ls, ['gamePk','gameId','gameDate','awayStarterId','homeStarterId',
  'awayStarterKs','homeStarterKs','awayStarterOuts','homeStarterOuts']);

// 4. k_prop rows in the unified replay-grades ledger (all sources; snapshot at run time —
//    the pipeline may still be writing).
const [ledger] = await conn.query(
  `SELECT id, gameId, gameDate, market, refId, source, modelVersion, pick, prob, projValue,
          line, actual, result, correct, brier, signedError, createdAt
   FROM mlb_replay_grades WHERE market='k_prop'`);
writeTsv('ledger_kprop.tsv', ledger, ['id','gameId','gameDate','market','refId','source','modelVersion',
  'pick','prob','projValue','line','actual','result','correct','brier','signedError','createdAt']);

await conn.end();
