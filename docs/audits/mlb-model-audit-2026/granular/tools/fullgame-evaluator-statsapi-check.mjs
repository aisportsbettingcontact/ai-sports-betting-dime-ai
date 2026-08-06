#!/usr/bin/env node
// GRANULAR AUDIT — FULLGAME / EVALUATOR — external ground-truth sample.
// Draws a deterministic random sample of games from the evaluator ledger and
// verifies the actual scores used for grading against MLB StatsAPI
// (statsapi.mlb.com, linescore hydrate). Sampling is allowed for external
// ground-truthing only — grading itself is full-population from the DB.
// READ-ONLY everywhere; writes one CSV artifact.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT_DIR = path.resolve(HERE, '..', 'fullgame');
const SAMPLE_N = 60;
const SEED = 20260725;

// Nothing derived from the API response is written to disk. Both helpers below compare
// the response value and then return a LOCALLY CONSTRUCTED string — never the value
// itself, nor anything computed from it. Stripping characters is not enough: the result
// is still response-derived, so a CSV write of it remains an untrusted-data flow.

// Scores are small non-negative integers; emit the matching entry from a local table.
const SCORE_LABELS = Array.from({ length: 101 }, (_, i) => String(i));
const csvNum = (v) => {
  // absent stays absent: Number(null) is 0, which would write a fabricated score
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < SCORE_LABELS.length ? SCORE_LABELS[n] : '';
};

// abstractGameState is a StatsAPI enum; each branch returns its own literal.
const csvState = (v) => {
  if (v === 'Preview') return 'Preview';
  if (v === 'Live') return 'Live';
  if (v === 'Final') return 'Final';
  if (v === 'Other') return 'Other';
  if (v === null || v === undefined) return 'fetch-fail';
  return 'unexpected';
};

// mulberry32 PRNG for reproducible sampling
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ledger = fs.readFileSync(path.join(OUT_DIR, 'fullgame-evaluator-ledger.csv'), 'utf8').trim().split('\n');
const cols = ledger[0].split(',');
const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
// unique games with a gamePk and a graded live ML row (actual present)
const byGame = new Map();
for (const l of ledger.slice(1)) {
  const p = l.split(',');
  if (p[idx.series] !== 'live') continue;
  if (!p[idx.mlb_game_pk]) continue;
  if (!byGame.has(p[idx.game_id])) byGame.set(p[idx.game_id], p);
}
const games = [...byGame.values()];
const rand = mulberry32(SEED);
const sample = [];
const pool = [...games];
while (sample.length < Math.min(SAMPLE_N, pool.length)) {
  const i = Math.floor(rand() * pool.length);
  sample.push(pool.splice(i, 1)[0]);
}

// reconstruct graded actual margin/total from the ledger rows of each sampled game
const ledgerRows = ledger.slice(1).map((l) => l.split(','));
function gameRows(gid) { return ledgerRows.filter((p) => p[idx.game_id] === gid && p[idx.series] === 'live'); }

const out = [['game_id', 'mlb_game_pk', 'date', 'teams', 'api_away', 'api_home', 'api_status',
  'ledger_ml_actual', 'ml_match', 'ledger_total_actual_side', 'ledger_total_line', 'total_match', 'note'].join(',')];
let checked = 0, mlOk = 0, totOk = 0, mlBad = [], totBad = [];
for (const g of sample) {
  const pk = g[idx.mlb_game_pk];
  const url = `https://statsapi.mlb.com/api/v1/schedule?gamePks=${pk}&hydrate=linescore`;
  let api = null;
  try {
    const res = await fetch(url);
    const j = await res.json();
    // suspended/resumed games return one entry per date; take the entry that
    // actually carries final scores (the resumption date), else the last one
    const entries = (j?.dates ?? []).flatMap((d) => d.games ?? []);
    api = entries.find((g) => g?.teams?.away?.score !== undefined && g?.teams?.away?.score !== null)
      ?? entries[entries.length - 1] ?? null;
  } catch { /* network fail -> note */ }
  const rows = gameRows(g[idx.game_id]);
  const mlRow = rows.find((p) => p[idx.sub_market] === 'ML');
  const totRow = rows.find((p) => p[idx.sub_market] === 'TOTAL');
  if (!api || api?.status?.abstractGameState !== 'Final') {
    out.push([g[idx.game_id], pk, g[idx.date], g[idx.teams], '', '', csvState(api?.status?.abstractGameState),
      mlRow?.[idx.actual] ?? '', '', totRow?.[idx.actual] ?? '', totRow?.[idx.line] ?? '', '', 'api-unavailable'].join(','));
    continue;
  }
  const aAway = api.linescore?.teams?.away?.runs ?? api.teams?.away?.score;
  const aHome = api.linescore?.teams?.home?.runs ?? api.teams?.home?.score;
  checked++;
  const apiMlWinner = aAway > aHome ? 'AWAY' : 'HOME';
  const mlMatch = mlRow && mlRow[idx.actual] ? (mlRow[idx.actual] === apiMlWinner ? 1 : 0) : '';
  if (mlMatch === 1) mlOk++; else if (mlMatch === 0) mlBad.push(g[idx.game_id]);
  let totMatch = '';
  if (totRow && totRow[idx.actual] && totRow[idx.line] !== '') {
    const line = Number(totRow[idx.line]);
    const apiSide = aAway + aHome > line ? 'OVER' : aAway + aHome < line ? 'UNDER' : 'PUSH';
    totMatch = apiSide === totRow[idx.actual] ? 1 : 0;
    if (totMatch === 1) totOk++; else totBad.push(g[idx.game_id]);
  }
  // API-derived scores are numeric-validated before serialization (identical output for
  // real linescores; keeps unvalidated response data out of the written file)
  out.push([g[idx.game_id], pk, g[idx.date], g[idx.teams], csvNum(aAway), csvNum(aHome), 'Final',
    mlRow?.[idx.actual] ?? '', mlMatch, totRow?.[idx.actual] ?? '', totRow?.[idx.line] ?? '', totMatch, ''].join(','));
  await new Promise((r) => setTimeout(r, 120)); // polite rate limit
}
fs.writeFileSync(path.join(OUT_DIR, 'fullgame-evaluator-statsapi-sample.csv'), out.join('\n') + '\n');
console.log(JSON.stringify({ sampled: sample.length, api_final_checked: checked, ml_actual_match: mlOk, total_side_match: totOk, ml_mismatch_ids: mlBad, total_mismatch_ids: totBad }, null, 1));
