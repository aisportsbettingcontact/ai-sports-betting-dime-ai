#!/usr/bin/env node
// f5-grader-truth-impact.mjs — GRADER role, f5 market group.
// For the 3 games whose games.actualF5AwayScore/actualF5HomeScore hold the DH-twin's F5 scores
// (StatsAPI-verified: 2250733 true 1-5, 2250738 true 2-0, 2251290 true 3-0), enumerate every
// stored grade in (a) games columns, (b) mlb_game_backtest f5_* rows, (c) mlb_replay_grades
// f5_* rows, and classify each as CORRECT or WRONG against the true actuals.
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const TRUTH = {
  2250733: { a: 1, h: 5 },  // STL@CIN 2026-05-23 G2 (pk 824516)
  2250738: { a: 2, h: 0 },  // DET@BAL 2026-05-24 G1 (pk 824839)
  2251290: { a: 3, h: 0 },  // MIL@STL 2026-07-07 G2 (pk 823035)
};
const OUTDIR = path.resolve(new URL('.', import.meta.url).pathname, '../f5');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(2); }
const conn = await mysql.createConnection(url).catch(async () =>
  mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }));
await conn.query('SET SESSION transaction_read_only = 1').catch(() => {});
const q = async (sql, p) => (await conn.query(sql, p))[0];
const num = (v) => (v === null || v === undefined || v === '' ? null : (isNaN(Number(v)) ? null : Number(v)));
const b6 = (p, y) => +((p - y) ** 2).toFixed(6);
const ids = Object.keys(TRUTH).map(Number);

const rows = [];
const add = (store, gameId, field, stored, trueVal, verdict, note = '') =>
  rows.push({ store, gameId, field, stored: stored ?? '', trueValue: trueVal ?? '', verdict, note });

// (a) games columns
const gs = await q(`SELECT id, awayTeam, homeTeam, gameDate, actualF5AwayScore, actualF5HomeScore,
    actualF5Total, modelF5AwayWinPct, modelF5HomeWinPct, modelF5AwayRLCoverPct, modelF5OverRate,
    f5AwayRunLine, f5Total, f5MlResult, f5MlCorrect, f5RlResult, f5RlCorrect,
    f5TotalResult, f5TotalCorrect, brierF5Ml, brierF5Total
  FROM games WHERE id IN (?, ?, ?)`, ids);
for (const g of gs) {
  const { a, h } = TRUTH[g.id];
  add('games', g.id, 'actualF5AwayScore', num(g.actualF5AwayScore), a,
    num(g.actualF5AwayScore) === a ? 'CORRECT' : 'WRONG', 'holds DH-twin F5 score');
  add('games', g.id, 'actualF5HomeScore', num(g.actualF5HomeScore), h,
    num(g.actualF5HomeScore) === h ? 'CORRECT' : 'WRONG', 'holds DH-twin F5 score');
  add('games', g.id, 'actualF5Total', num(g.actualF5Total), a + h,
    Math.round(num(g.actualF5Total)) === a + h ? 'CORRECT' : 'WRONG');
  const pA = num(g.modelF5AwayWinPct);
  if (pA !== null) {
    let tRes = null, tCor = null;
    if (a === h) { tRes = 'PUSH'; }
    else { const won = (pA / 100 > 0.5) === (a > h); tRes = won ? 'WIN' : 'LOSS'; tCor = won ? 1 : 0; }
    add('games', g.id, 'f5MlResult', g.f5MlResult, tRes, String(g.f5MlResult) === String(tRes) ? 'CORRECT' : 'WRONG');
    add('games', g.id, 'f5MlCorrect', num(g.f5MlCorrect), tCor, num(g.f5MlCorrect) === tCor ? 'CORRECT' : 'WRONG');
    if (a !== h) {
      const tBrier = b6(pA / 100, a > h ? 1 : 0); // away-base (B6 convention, matches all stored)
      add('games', g.id, 'brierF5Ml', num(g.brierF5Ml), tBrier,
        num(g.brierF5Ml) !== null && Math.abs(num(g.brierF5Ml) - tBrier) <= 1.5e-6 ? 'CORRECT' : 'WRONG', 'away-base');
    }
  }
  const pRl = num(g.modelF5AwayRLCoverPct), rl = num(g.f5AwayRunLine);
  if (pRl !== null && rl !== null) {
    const coverT = (a - h) * 10 + Math.round(rl * 10);
    let tRes = null, tCor = null;
    if (coverT === 0) tRes = 'PUSH';
    else { const won = (pRl > 50) === (coverT > 0); tRes = won ? 'WIN' : 'LOSS'; tCor = won ? 1 : 0; }
    add('games', g.id, 'f5RlResult', g.f5RlResult, tRes, String(g.f5RlResult) === String(tRes) ? 'CORRECT' : 'WRONG', 'B6 prob-convention pick');
    add('games', g.id, 'f5RlCorrect', num(g.f5RlCorrect), tCor, num(g.f5RlCorrect) === tCor ? 'CORRECT' : 'WRONG');
  }
  const p5o = num(g.modelF5OverRate), f5t = num(g.f5Total);
  if (f5t !== null) {
    const atT = (a + h) * 10, lT = Math.round(f5t * 10);
    let tRes, tCor = null, tBrier = null;
    if (atT === lT) tRes = 'PUSH';
    else {
      tRes = atT > lT ? 'OVER' : 'UNDER';
      if (p5o !== null) { tCor = ((p5o > 0.5) === (atT > lT)) ? 1 : 0; tBrier = b6(p5o, atT > lT ? 1 : 0); }
    }
    add('games', g.id, 'f5TotalResult', g.f5TotalResult, tRes, String(g.f5TotalResult) === String(tRes) ? 'CORRECT' : 'WRONG');
    add('games', g.id, 'f5TotalCorrect', num(g.f5TotalCorrect), tCor, num(g.f5TotalCorrect) === tCor ? 'CORRECT' : 'WRONG');
    if (tBrier !== null) add('games', g.id, 'brierF5Total', num(g.brierF5Total), tBrier,
      num(g.brierF5Total) !== null && Math.abs(num(g.brierF5Total) - tBrier) <= 1.5e-6 ? 'CORRECT' : 'WRONG');
  }
}

// (b) backtest f5_* rows
const bts = await q(`SELECT id, gameId, market, modelSide, bookLine, result, correct
  FROM mlb_game_backtest WHERE gameId IN (?, ?, ?) AND market LIKE 'f5\\_%' ORDER BY gameId, market`, ids);
for (const r of bts) {
  const { a, h } = TRUTH[r.gameId];
  const actioned = ['WIN', 'LOSS', 'PUSH'].includes(r.result);
  if (!actioned) { add('mlb_game_backtest', r.gameId, `${r.market}#${r.id}`, r.result, '', 'N/A', 'not actioned'); continue; }
  let t = null;
  if (r.market === 'f5_ml_home') t = h === a ? 'PUSH' : h > a ? 'WIN' : 'LOSS';
  else if (r.market === 'f5_ml_away') t = h === a ? 'PUSH' : a > h ? 'WIN' : 'LOSS';
  else if (r.market === 'f5_rl_home' || r.market === 'f5_rl_away') {
    const lineN = num(r.bookLine) !== null ? num(r.bookLine) : (r.market === 'f5_rl_home' ? -0.5 : 0.5);
    const coverT = (r.market === 'f5_rl_home' ? (h - a) : (a - h)) * 10 + Math.round(lineN * 10);
    t = coverT === 0 ? 'PUSH' : coverT > 0 ? 'WIN' : 'LOSS';
  } else {
    const lineN = num(r.bookLine);
    if (lineN !== null) {
      const atT = (a + h) * 10, lT = Math.round(lineN * 10);
      t = atT === lT ? 'PUSH' : ((r.market === 'f5_over') === (atT > lT) ? 'WIN' : 'LOSS');
    }
  }
  add('mlb_game_backtest', r.gameId, `${r.market}#${r.id}`, r.result, t, String(r.result) === String(t) ? 'CORRECT' : 'WRONG');
}

// (c) replay grades f5_* rows
const rgs = await q(`SELECT id, gameId, market, source, modelVersion, pick, prob, line, actual, result, correct, brier
  FROM mlb_replay_grades WHERE gameId IN (?, ?, ?) AND market IN ('f5_ml','f5_rl','f5_total')
  ORDER BY gameId, market, source, modelVersion`, ids);
for (const r of rgs) {
  const { a, h } = TRUTH[r.gameId];
  let side = null, expActual = null;
  if (r.market === 'f5_ml') { side = a > h ? 'AWAY' : a < h ? 'HOME' : 'PUSH'; expActual = side === 'PUSH' ? 'TIE' : side; }
  else if (r.market === 'f5_rl') {
    const lineN = num(r.line);
    if (lineN !== null) { const cT = (a - h) * 10 + Math.round(lineN * 10); side = cT > 0 ? 'AWAY' : cT < 0 ? 'HOME' : 'PUSH'; expActual = side; }
  } else {
    const lineN = num(r.line);
    if (lineN !== null) { const atT = (a + h) * 10, lT = Math.round(lineN * 10); side = atT > lT ? 'OVER' : atT < lT ? 'UNDER' : 'PUSH'; expActual = String(a + h); }
  }
  if (side === null) { add('mlb_replay_grades', r.gameId, `${r.market}/${r.source}/${r.modelVersion}#${r.id}`, r.result, '', 'N/A', 'no line'); continue; }
  let tRes = null, tCor = null;
  if (side === 'PUSH') tRes = 'PUSH';
  else if (r.pick !== null) { tRes = r.pick === side ? 'WIN' : 'LOSS'; tCor = r.pick === side ? 1 : 0; }
  const resOk = String(r.result) === String(tRes) && num(r.correct) === tCor;
  const actOk = r.market === 'f5_total' ? num(r.actual) === num(expActual) : String(r.actual) === expActual;
  add('mlb_replay_grades', r.gameId, `${r.market}/${r.source}/${r.modelVersion}#${r.id}`,
    `result=${r.result} actual=${r.actual}`, `result=${tRes} actual=${expActual}`,
    resOk && actOk ? 'CORRECT' : 'WRONG');
}

const header = ['store', 'gameId', 'field', 'stored', 'trueValue', 'verdict', 'note'];
const csvEsc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
fs.writeFileSync(path.join(OUTDIR, 'f5-grader-truth-impact.csv'),
  header.join(',') + '\n' + rows.map((r) => header.map((hh) => csvEsc(r[hh])).join(',')).join('\n') + '\n');
const agg = {};
for (const r of rows) { const k = `${r.store}:${r.verdict}`; agg[k] = (agg[k] ?? 0) + 1; }
console.log(JSON.stringify({ perStore: agg, wrong: rows.filter((r) => r.verdict === 'WRONG') }, null, 2));
await conn.end();
