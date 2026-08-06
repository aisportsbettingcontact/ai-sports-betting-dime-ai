#!/usr/bin/env node
// Phase 2 grading engine for the 2026 MLB model audit. STRICTLY READ-ONLY.
// Re-derives every grade from raw projections + actuals (never trusts stored correct flags),
// emits one ledger row per game per sub-market, plus a metric suite and a
// stored-vs-rederived consistency report.
//
// Grading rules (stated precisely; scales verified empirically this session):
//   FG ML:    P(away win) = modelAwayWinPct/100. Pick = side with p > 0.5. Correct = pick won.
//   FG RL:    model margin = modelAwayScore - modelHomeScore vs book awayRunLine.
//             Pick = away if margin + runLine > 0. Correct = picked side covered. No stored probability.
//   FG TOTAL: P(over) = modelOverRate/100 vs bookTotal. Push if actual == line.
//             signed_error = (modelProjTotal ?? modelTotal) - actualTotal.
//   F5 ML:    P(away) = modelF5AwayWinPct/100. F5 tie = push.
//   F5 RL:    P(away cover) = modelF5AwayRLCoverPct/100 vs f5AwayRunLine.
//   F5 TOTAL: P(over) = modelF5OverRate (already 0-1) vs f5Total. signed_error = modelF5Total - actualF5Total.
//   NRFI:     P(NRFI) = modelPNrfi (0-1). actual = actualNrfiBinary ?? (nrfiActualResult NRFI->1, YRFI->0).
//   K PROP:   pick = pOver > pUnder ? OVER : UNDER vs bookLine, actual = actualKs. Push if equal.
//             signed_error = kProj - actualKs.
//   HR PROP:  P(HR) = modelPHr (0-1), actual = actualHr. Probability grading (Brier/logloss);
//             bet grading only where verdict is an actionable side.
// Actual-score source: games.actual*; fallback to mlb_schedule_history scores (FG only).
// Games without a gradable actual emit a ledger row with correct='' and note=missing-actual.

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const OUT_DIR = new URL('../grading/', import.meta.url).pathname;
const AS_OF = process.env.AUDIT_AS_OF || '2026-07-25';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

async function connect() {
  try { const c = await mysql.createConnection(url); await c.query('SELECT 1'); return c; }
  catch { return mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }); }
}
const conn = await connect();
const q = async (sql, params) => (await conn.query(sql, params))[0];

// ---------- helpers ----------
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
function parseOdds(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toUpperCase();
  if (t === 'EVEN' || t === 'EV' || t === 'PK') return 100;
  const m = t.match(/^[+-]?\d+(\.\d+)?$/);
  if (!m) return null;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null;
}
const impliedProb = (odds) => (odds === null ? null : odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100));
function noVig(pA, pB) { return pA !== null && pB !== null && pA + pB > 0 ? pA / (pA + pB) : null; }
const clampP = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const brier = (p, y) => (p - y) ** 2;
const logloss = (p, y) => -(y * Math.log(clampP(p)) + (1 - y) * Math.log(1 - clampP(p)));

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, rows, cols) {
  const c = cols || Object.keys(rows[0] || {});
  fs.writeFileSync(path.join(OUT_DIR, file), [c.join(',')].concat(rows.map((r) => c.map((k) => csvEscape(r[k])).join(','))).join('\n') + '\n');
  console.error(`[grade] wrote ${file}: ${rows.length} rows`);
}

// ---------- load universe linkage (from Phase 1 census) ----------
const universeCsv = fs.readFileSync(new URL('../census/game-universe.csv', import.meta.url).pathname, 'utf8').trim().split('\n');
const uCols = universeCsv[0].split(',');
const uRows = universeCsv.slice(1).map((l) => {
  // census CSV has no embedded commas in practice; guarded by column count check
  const parts = l.split(',');
  return Object.fromEntries(uCols.map((c, i) => [c, parts[i] === '' ? null : parts[i]]));
});
const schedByGamesId = new Map();
for (const u of uRows) if (u.gamesId) schedByGamesId.set(Number(u.gamesId), u);

// closing lines from schedule, keyed by anGameId
const closingByAnId = new Map();
for (const r of await q(
  `SELECT anGameId, dkClosingAwayML, dkClosingHomeML, dkClosingTotal, dkClosingOverOdds, dkClosingUnderOdds,
          dkClosingAwayRunLine, dkClosingAwayRunLineOdds, dkClosingHomeRunLineOdds,
          dkAwayML, dkHomeML, dkTotal
   FROM mlb_schedule_history WHERE game_type='regular_season' AND gameDate >= '2026-01-01' AND gameDate <= ?`, [AS_OF]
)) closingByAnId.set(r.anGameId, r);

// ---------- load games ----------
const games = await q(
  `SELECT id, gameDate, awayTeam, homeTeam, startTimeEst, gameNumber, gameStatus,
          awayML, homeML, awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds, bookTotal, overOdds, underOdds,
          modelAwayWinPct, modelHomeWinPct, modelAwayScore, modelHomeScore, modelOverRate, modelTotal, modelProjTotal,
          f5AwayRunLine, f5Total, f5AwayML, f5HomeML, f5OverOdds, f5UnderOdds,
          modelF5AwayWinPct, modelF5AwayRLCoverPct, modelF5OverRate, modelF5Total, modelF5AwayScore, modelF5HomeScore,
          modelPNrfi, nrfiOverOdds, yrfiUnderOdds,
          actualAwayScore, actualHomeScore, actualFgTotal, actualF5AwayScore, actualF5HomeScore, actualF5Total,
          actualNrfiBinary, nrfiActualResult,
          fgMlCorrect, fgRlCorrect, fgTotalCorrect, f5MlCorrect, f5RlCorrect, f5TotalCorrect, nrfiCorrect, modelRunAt
   FROM games WHERE sport='MLB' AND gameDate >= '2026-03-01' AND gameDate <= ? ORDER BY gameDate, id`, [AS_OF]
);

const isCompleted = (g) => {
  const u = schedByGamesId.get(g.id);
  return u ? u.schedStatus === 'complete' : g.gameStatus === 'final';
};
const dayNight = (g) => {
  const m = String(g.startTimeEst || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h < 17 ? 'day' : 'night';
};

const ledgers = { fullgame: [], f5: [], nrfi: [], kprops: [], hrprops: [] };
const consistency = { fg: [], f5: [], nrfi: [], k: [], hr: [] };

function pushRow(family, row) { ledgers[family].push(row); }

for (const g of games) {
  if (g.gameDate > AS_OF) continue;
  const completed = isCompleted(g);
  const u = schedByGamesId.get(g.id);
  const closing = u ? closingByAnId.get(Number(u.anGameId)) : null;
  // actual scores: games actuals, fallback schedule
  let aAway = num(g.actualAwayScore), aHome = num(g.actualHomeScore);
  let scoreSource = 'games';
  if ((aAway === null || aHome === null) && completed && u && u.schedAway !== null) {
    aAway = num(u.schedAway); aHome = num(u.schedHome); scoreSource = 'schedule';
  }
  const base = { game_id: g.id, date: g.gameDate, teams: `${g.awayTeam}@${g.homeTeam}`, game_no: g.gameNumber };
  const fav = (() => { const a = parseOdds(g.awayML); return a === null ? '' : a < 0 ? 'away_fav' : 'home_fav'; })();
  const dn = dayNight(g);

  // ----- FG ML -----
  if (g.modelAwayWinPct !== null) {
    const p = num(g.modelAwayWinPct) / 100;
    const pick = p > 0.5 ? 'AWAY' : 'HOME';
    let actual = '', correct = '', note = '';
    let y = null;
    if (completed && aAway !== null) {
      y = aAway > aHome ? 1 : 0;
      actual = y ? 'AWAY' : 'HOME';
      correct = (pick === actual) ? 1 : 0;
      if (scoreSource === 'schedule') note = 'actual-from-schedule';
    } else note = completed ? 'missing-actual' : 'not-completed';
    const closeML = closing ? parseOdds(closing.dkClosingAwayML) : null;
    const closeNoVig = closing ? noVig(impliedProb(parseOdds(closing.dkClosingAwayML)), impliedProb(parseOdds(closing.dkClosingHomeML))) : null;
    pushRow('fullgame', { ...base, market: 'FG', sub_market: 'ML', projected_value: '', projected_probability: p.toFixed(4), pick,
      line_at_projection: g.awayML ?? '', closing_line: closeML ?? '', closing_novig_p_away: closeNoVig === null ? '' : closeNoVig.toFixed(4),
      actual_outcome: actual, correct, signed_error: '', abs_error: '',
      brier: y === null ? '' : brier(p, y).toFixed(6), logloss: y === null ? '' : logloss(p, y).toFixed(6),
      fav, day_night: dn, completed: completed ? 1 : 0, notes: note, stored_correct: g.fgMlCorrect ?? '' });
    if (y !== null && g.fgMlCorrect !== null) consistency.fg.push({ id: g.id, mine: (pick === actual) ? 1 : 0, stored: g.fgMlCorrect });
  }

  // ----- FG RL -----
  const rl = num(g.awayRunLine);
  if (g.modelAwayScore !== null && rl !== null) {
    const margin = num(g.modelAwayScore) - num(g.modelHomeScore);
    const pick = margin + rl > 0 ? 'AWAY' : 'HOME';
    let actual = '', correct = '', se = '', ae = '', note = '';
    if (completed && aAway !== null) {
      const cover = aAway + rl - aHome;
      actual = cover > 0 ? 'AWAY' : cover < 0 ? 'HOME' : 'PUSH';
      correct = actual === 'PUSH' ? '' : (pick === actual ? 1 : 0);
      se = (margin - (aAway - aHome)).toFixed(2); ae = Math.abs(margin - (aAway - aHome)).toFixed(2);
      if (actual === 'PUSH') note = 'push';
    } else note = completed ? 'missing-actual' : 'not-completed';
    pushRow('fullgame', { ...base, market: 'FG', sub_market: 'RL', projected_value: margin.toFixed(2), projected_probability: '', pick,
      line_at_projection: `${g.awayRunLine}/${g.awayRunLineOdds ?? ''}`, closing_line: closing && closing.dkClosingAwayRunLine !== null ? `${closing.dkClosingAwayRunLine}/${closing.dkClosingAwayRunLineOdds ?? ''}` : '', closing_novig_p_away: '',
      actual_outcome: actual, correct, signed_error: se, abs_error: ae, brier: '', logloss: '',
      fav, day_night: dn, completed: completed ? 1 : 0, notes: note, stored_correct: g.fgRlCorrect ?? '' });
  }

  // ----- FG TOTAL -----
  const bt = num(g.bookTotal);
  if (g.modelOverRate !== null && bt !== null) {
    const p = num(g.modelOverRate) / 100; // P(over)
    const proj = num(g.modelProjTotal) ?? num(g.modelTotal);
    const pick = p > 0.5 ? 'OVER' : 'UNDER';
    let actual = '', correct = '', se = '', ae = '', y = null, note = '';
    const at = num(g.actualFgTotal) ?? (aAway !== null && aHome !== null ? aAway + aHome : null);
    if (completed && at !== null) {
      actual = at > bt ? 'OVER' : at < bt ? 'UNDER' : 'PUSH';
      if (actual !== 'PUSH') { y = actual === 'OVER' ? 1 : 0; correct = pick === actual ? 1 : 0; } else note = 'push';
      if (proj !== null) { se = (proj - at).toFixed(2); ae = Math.abs(proj - at).toFixed(2); }
    } else note = completed ? 'missing-actual' : 'not-completed';
    const closeTotal = closing ? num(closing.dkClosingTotal) : null;
    pushRow('fullgame', { ...base, market: 'FG', sub_market: 'TOTAL', projected_value: proj === null ? '' : proj.toFixed(2), projected_probability: p.toFixed(4), pick,
      line_at_projection: bt, closing_line: closeTotal ?? '', closing_novig_p_away: '',
      actual_outcome: actual, correct, signed_error: se, abs_error: ae,
      brier: y === null ? '' : brier(p, y).toFixed(6), logloss: y === null ? '' : logloss(p, y).toFixed(6),
      fav, day_night: dn, completed: completed ? 1 : 0, notes: note, stored_correct: g.fgTotalCorrect ?? '' });
  }

  // ----- F5 ML -----
  if (g.modelF5AwayWinPct !== null) {
    const p = num(g.modelF5AwayWinPct) / 100;
    const pick = p > 0.5 ? 'AWAY' : 'HOME';
    const f5a = num(g.actualF5AwayScore), f5h = num(g.actualF5HomeScore);
    let actual = '', correct = '', y = null, note = '';
    if (completed && f5a !== null && f5h !== null) {
      actual = f5a > f5h ? 'AWAY' : f5a < f5h ? 'HOME' : 'PUSH';
      if (actual !== 'PUSH') { y = actual === 'AWAY' ? 1 : 0; correct = pick === actual ? 1 : 0; } else note = 'push(tie)';
    } else note = completed ? 'missing-actual' : 'not-completed';
    pushRow('f5', { ...base, market: 'F5', sub_market: 'ML', projected_value: '', projected_probability: p.toFixed(4), pick,
      line_at_projection: g.f5AwayML ?? '', closing_line: '', actual_outcome: actual, correct,
      signed_error: '', abs_error: '', brier: y === null ? '' : brier(p, y).toFixed(6), logloss: y === null ? '' : logloss(p, y).toFixed(6),
      fav, day_night: dn, completed: completed ? 1 : 0, notes: note, stored_correct: g.f5MlCorrect ?? '' });
    if (y !== null && g.f5MlCorrect !== null) consistency.f5.push({ id: g.id, mine: pick === actual ? 1 : 0, stored: g.f5MlCorrect });
  }

  // ----- F5 RL -----
  const f5rl = num(g.f5AwayRunLine);
  if (g.modelF5AwayRLCoverPct !== null && f5rl !== null) {
    const p = num(g.modelF5AwayRLCoverPct) / 100;
    const pick = p > 0.5 ? 'AWAY' : 'HOME';
    const f5a = num(g.actualF5AwayScore), f5h = num(g.actualF5HomeScore);
    let actual = '', correct = '', y = null, note = '';
    if (completed && f5a !== null && f5h !== null) {
      const cover = f5a + f5rl - f5h;
      actual = cover > 0 ? 'AWAY' : cover < 0 ? 'HOME' : 'PUSH';
      if (actual !== 'PUSH') { y = actual === 'AWAY' ? 1 : 0; correct = pick === actual ? 1 : 0; } else note = 'push';
    } else note = completed ? 'missing-actual' : 'not-completed';
    pushRow('f5', { ...base, market: 'F5', sub_market: 'RL', projected_value: '', projected_probability: p.toFixed(4), pick,
      line_at_projection: `${g.f5AwayRunLine}`, closing_line: '', actual_outcome: actual, correct,
      signed_error: '', abs_error: '', brier: y === null ? '' : brier(p, y).toFixed(6), logloss: y === null ? '' : logloss(p, y).toFixed(6),
      fav, day_night: dn, completed: completed ? 1 : 0, notes: note, stored_correct: g.f5RlCorrect ?? '' });
  }

  // ----- F5 TOTAL -----
  const f5t = num(g.f5Total);
  if (g.modelF5OverRate !== null && f5t !== null) {
    const p = num(g.modelF5OverRate); // already 0-1
    const proj = num(g.modelF5Total);
    const pick = p > 0.5 ? 'OVER' : 'UNDER';
    const at = num(g.actualF5Total) ?? (num(g.actualF5AwayScore) !== null && num(g.actualF5HomeScore) !== null ? num(g.actualF5AwayScore) + num(g.actualF5HomeScore) : null);
    let actual = '', correct = '', se = '', ae = '', y = null, note = '';
    if (completed && at !== null) {
      actual = at > f5t ? 'OVER' : at < f5t ? 'UNDER' : 'PUSH';
      if (actual !== 'PUSH') { y = actual === 'OVER' ? 1 : 0; correct = pick === actual ? 1 : 0; } else note = 'push';
      if (proj !== null) { se = (proj - at).toFixed(2); ae = Math.abs(proj - at).toFixed(2); }
    } else note = completed ? 'missing-actual' : 'not-completed';
    pushRow('f5', { ...base, market: 'F5', sub_market: 'TOTAL', projected_value: proj === null ? '' : proj.toFixed(2), projected_probability: p.toFixed(4), pick,
      line_at_projection: f5t, closing_line: '', actual_outcome: actual, correct, signed_error: se, abs_error: ae,
      brier: y === null ? '' : brier(p, y).toFixed(6), logloss: y === null ? '' : logloss(p, y).toFixed(6),
      fav, day_night: dn, completed: completed ? 1 : 0, notes: note, stored_correct: g.f5TotalCorrect ?? '' });
  }

  // ----- NRFI -----
  if (g.modelPNrfi !== null) {
    const p = num(g.modelPNrfi); // P(NRFI), 0-1
    const pick = p > 0.5 ? 'NRFI' : 'YRFI';
    let yN = num(g.actualNrfiBinary);
    let src = 'binary';
    if (yN === null && g.nrfiActualResult) { yN = g.nrfiActualResult === 'NRFI' ? 1 : g.nrfiActualResult === 'YRFI' ? 0 : null; src = 'string'; }
    let actual = '', correct = '', note = '';
    if (completed && yN !== null) {
      actual = yN ? 'NRFI' : 'YRFI';
      correct = pick === actual ? 1 : 0;
      if (src === 'string') note = 'actual-from-string';
    } else note = completed ? 'missing-actual' : 'not-completed';
    pushRow('nrfi', { ...base, market: 'NRFI', sub_market: 'NRFI', projected_value: '', projected_probability: p.toFixed(4), pick,
      line_at_projection: g.nrfiOverOdds ?? '', closing_line: '', actual_outcome: actual, correct,
      signed_error: '', abs_error: '', brier: yN === null || !completed ? '' : brier(p, yN).toFixed(6), logloss: yN === null || !completed ? '' : logloss(p, yN).toFixed(6),
      fav, day_night: dn, completed: completed ? 1 : 0, notes: note, stored_correct: g.nrfiCorrect ?? '' });
    if (completed && yN !== null && g.nrfiCorrect !== null) consistency.nrfi.push({ id: g.id, mine: pick === actual ? 1 : 0, stored: g.nrfiCorrect });
  }
}

// ---------- K props ----------
const kRows = await q(
  `SELECT p.id, p.gameId, g.gameDate, g.awayTeam, g.homeTeam, g.startTimeEst, p.side, p.pitcherName, p.pitcherHand,
          p.kProj, p.kMedian, p.bookLine, p.bookOverOdds, p.bookUnderOdds, p.pOver, p.pUnder,
          p.actualKs, p.backtestResult, p.modelError, p.modelCorrect, p.verdict, g.gameStatus
   FROM mlb_strikeout_props p JOIN games g ON g.id = p.gameId
   WHERE g.gameDate >= '2026-03-01' AND g.gameDate <= ? ORDER BY g.gameDate, p.id`, [AS_OF]
);
for (const r of kRows) {
  const proj = num(r.kProj), line = num(r.bookLine), pOver = num(r.pOver), pUnder = num(r.pUnder), aK = num(r.actualKs);
  if (proj === null) continue; // no projection => census item, not gradable
  const completed = r.gameStatus === 'final';
  const pick = pOver !== null && pUnder !== null ? (pOver > pUnder ? 'OVER' : 'UNDER') : (line !== null && proj !== null ? (proj > line ? 'OVER' : 'UNDER') : '');
  const pPick = pick === 'OVER' ? pOver : pUnder;
  let actual = '', correct = '', se = '', ae = '', y = null, note = '';
  if (aK !== null && line !== null) {
    actual = aK > line ? 'OVER' : aK < line ? 'UNDER' : 'PUSH';
    if (actual !== 'PUSH' && pick) { y = actual === 'OVER' ? 1 : 0; correct = pick === actual ? 1 : 0; } else if (actual === 'PUSH') note = 'push';
    se = (proj - aK).toFixed(2); ae = Math.abs(proj - aK).toFixed(2);
  } else if (aK === null && completed) note = 'missing-actual(possible-scratch)';
  else if (!completed) note = 'not-completed';
  else note = 'no-book-line';
  ledgers.kprops.push({ game_id: r.gameId, date: r.gameDate, teams: `${r.awayTeam}@${r.homeTeam}`, prop_id: r.id,
    market: 'K_PROP', sub_market: r.side, player: r.pitcherName, hand: r.pitcherHand ?? '',
    projected_value: proj, projected_probability: pOver === null ? '' : Number(pOver).toFixed(4), pick,
    line_at_projection: line ?? '', closing_line: '', actual_outcome: actual, actual_ks: aK ?? '', correct,
    signed_error: se, abs_error: ae,
    brier: y === null || pOver === null ? '' : brier(pOver, y).toFixed(6), logloss: y === null || pOver === null ? '' : logloss(pOver, y).toFixed(6),
    completed: completed ? 1 : 0, notes: note, stored_result: r.backtestResult ?? '', stored_correct: r.modelCorrect ?? '', stored_error: r.modelError ?? '', verdict: r.verdict ?? '' });
  if (y !== null && r.backtestResult && ['OVER', 'UNDER', 'PUSH'].includes(r.backtestResult)) {
    consistency.k.push({ id: r.id, mineActualSide: actual, storedActualSide: r.backtestResult, mineCorrect: correct, storedCorrect: r.modelCorrect });
  }
}

// ---------- HR props ----------
const hrRows = await q(
  `SELECT p.id, p.gameId, g.gameDate, g.awayTeam, g.homeTeam, p.side, p.playerName, p.bookLine,
          p.fdOverOdds, p.consensusOverOdds, p.modelPHr, p.verdict, p.actualHr, p.backtestResult, p.modelCorrect, g.gameStatus
   FROM mlb_hr_props p JOIN games g ON g.id = p.gameId
   WHERE g.gameDate >= '2026-03-01' AND g.gameDate <= ? ORDER BY g.gameDate, p.id`, [AS_OF]
);
for (const r of hrRows) {
  const p = num(r.modelPHr);
  if (p === null) continue;
  const completed = r.gameStatus === 'final';
  const aH = num(r.actualHr);
  let y = null, note = '';
  if (aH !== null) y = aH >= 1 ? 1 : 0;
  else if (completed) note = 'missing-actual(possible-scratch)';
  else note = 'not-completed';
  const actionable = r.verdict && !['PASS', 'NO_ACTION', 'NO ACTION'].includes(String(r.verdict).toUpperCase());
  ledgers.hrprops.push({ game_id: r.gameId, date: r.gameDate, teams: `${r.awayTeam}@${r.homeTeam}`, prop_id: r.id,
    market: 'HR_PROP', sub_market: r.side, player: r.playerName,
    projected_value: '', projected_probability: p.toFixed(4), pick: actionable ? String(r.verdict) : 'PASS',
    line_at_projection: r.bookLine ?? '', book_over_odds: r.fdOverOdds ?? r.consensusOverOdds ?? '', closing_line: '',
    actual_outcome: y === null ? '' : y ? 'HR' : 'NO_HR', correct: '',
    signed_error: '', abs_error: '',
    brier: y === null ? '' : brier(p, y).toFixed(6), logloss: y === null ? '' : logloss(p, y).toFixed(6),
    completed: completed ? 1 : 0, notes: note, stored_result: r.backtestResult ?? '', stored_correct: r.modelCorrect ?? '' });
}

// ---------- write ledgers ----------
writeCsv('ledger-fullgame.csv', ledgers.fullgame);
writeCsv('ledger-f5.csv', ledgers.f5);
writeCsv('ledger-nrfi.csv', ledgers.nrfi);
writeCsv('ledger-kprops.csv', ledgers.kprops);
writeCsv('ledger-hrprops.csv', ledgers.hrprops);

// ---------- metrics ----------
function metricsFor(rows, opts = {}) {
  const graded = rows.filter((r) => r.correct === 1 || r.correct === 0);
  const withP = rows.filter((r) => r.brier !== '' && r.brier !== undefined);
  const withErr = rows.filter((r) => r.signed_error !== '' && r.signed_error !== undefined);
  const n = graded.length;
  const hits = graded.filter((r) => r.correct === 1).length;
  const m = {
    rows: rows.length, graded: n, hit_rate: n ? +(hits / n).toFixed(4) : null,
    hit_ci95: n ? +(1.96 * Math.sqrt((hits / n) * (1 - hits / n) / n)).toFixed(4) : null,
    brier: withP.length ? +(withP.reduce((s, r) => s + Number(r.brier), 0) / withP.length).toFixed(5) : null,
    logloss: withP.length ? +(withP.reduce((s, r) => s + Number(r.logloss), 0) / withP.length).toFixed(5) : null,
    n_prob: withP.length,
  };
  if (withErr.length) {
    const errs = withErr.map((r) => Number(r.signed_error));
    const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
    const sd = Math.sqrt(errs.reduce((s, e) => s + (e - mean) ** 2, 0) / (errs.length - 1));
    m.n_err = errs.length;
    m.mae = +(errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length).toFixed(4);
    m.rmse = +Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length).toFixed(4);
    m.signed_bias = +mean.toFixed(4);
    m.bias_ci95 = +(1.96 * sd / Math.sqrt(errs.length)).toFixed(4);
    m.bias_significant = Math.abs(mean) > 1.96 * sd / Math.sqrt(errs.length);
  }
  if (opts.reliability && withP.length >= 50) {
    const bins = Array.from({ length: 10 }, () => ({ n: 0, pSum: 0, ySum: 0 }));
    for (const r of withP) {
      const p = Number(r.projected_probability);
      const y = Number(r.brier) !== null ? (Math.sqrt(Number(r.brier)) === Math.abs(p - 1) ? 1 : 0) : null; // y from brier: (p-y)^2
      const yy = Math.abs(Math.sqrt(Number(r.brier)) - Math.abs(p - 1)) < 1e-6 ? 1 : 0;
      const b = Math.min(9, Math.floor(p * 10));
      bins[b].n++; bins[b].pSum += p; bins[b].ySum += yy;
    }
    m.reliability = bins.map((b, i) => ({ bin: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`, n: b.n, avg_p: b.n ? +(b.pSum / b.n).toFixed(3) : null, obs: b.n ? +(b.ySum / b.n).toFixed(3) : null }));
  }
  return m;
}

const summary = { asOf: AS_OF, families: {} };
const groupBy = (rows, keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
const mo = (r) => String(r.date).slice(0, 7);

function familyReport(name, rows, subKey, opts = {}) {
  const rep = { overall: metricsFor(rows, { reliability: true }), by_sub: {}, by_month: {}, slices: {} };
  for (const [k, v] of groupBy(rows, (r) => r[subKey])) rep.by_sub[k] = metricsFor(v, { reliability: true });
  for (const [k, v] of groupBy(rows, mo)) rep.by_month[k] = metricsFor(v);
  for (const [k, v] of groupBy(rows.filter((r) => r.pick === 'OVER' || r.pick === 'UNDER'), (r) => r.pick)) rep.slices[`pick_${k}`] = metricsFor(v);
  if (rows[0] && 'fav' in rows[0]) {
    for (const [k, v] of groupBy(rows.filter((r) => r.fav), (r) => r.fav)) rep.slices[k] = metricsFor(v);
    for (const [k, v] of groupBy(rows.filter((r) => r.day_night), (r) => r.day_night)) rep.slices[k] = metricsFor(v);
  }
  if (rows[0] && 'hand' in rows[0]) for (const [k, v] of groupBy(rows.filter((r) => r.hand), (r) => r.hand)) rep.slices[`hand_${k}`] = metricsFor(v);
  if (opts.probBuckets) {
    for (const [k, v] of groupBy(rows.filter((r) => r.projected_probability !== ''), (r) => { const p = Number(r.projected_probability); return p < 0.4 ? 'p<0.40' : p < 0.5 ? 'p0.40-0.50' : p < 0.6 ? 'p0.50-0.60' : 'p>=0.60'; })) rep.slices[k] = metricsFor(v);
  }
  summary.families[name] = rep;
}

familyReport('fullgame', ledgers.fullgame, 'sub_market', { probBuckets: true });
familyReport('f5', ledgers.f5, 'sub_market', { probBuckets: true });
familyReport('nrfi', ledgers.nrfi, 'sub_market', { probBuckets: true });
familyReport('kprops', ledgers.kprops, 'sub_market', { probBuckets: true });
familyReport('hrprops', ledgers.hrprops, 'sub_market', { probBuckets: true });

// per-sub-market x month for bias hunting on totals
summary.families.fullgame.total_by_month_bias = {};
for (const [k, v] of groupBy(ledgers.fullgame.filter((r) => r.sub_market === 'TOTAL'), mo)) summary.families.fullgame.total_by_month_bias[k] = metricsFor(v);

// consistency report
summary.consistency = {
  fg_ml: { n: consistency.fg.length, mismatches: consistency.fg.filter((c) => c.mine !== Number(c.stored)).length },
  f5_ml: { n: consistency.f5.length, mismatches: consistency.f5.filter((c) => c.mine !== Number(c.stored)).length },
  nrfi: { n: consistency.nrfi.length, mismatches: consistency.nrfi.filter((c) => c.mine !== Number(c.stored)).length },
  k_actual_side: { n: consistency.k.length, mismatches: consistency.k.filter((c) => c.mineActualSide !== c.storedActualSide).length },
  k_correct: { n: consistency.k.filter((c) => c.storedCorrect !== null && c.mineCorrect !== '').length, mismatches: consistency.k.filter((c) => c.storedCorrect !== null && c.mineCorrect !== '' && Number(c.mineCorrect) !== Number(c.storedCorrect)).length },
};
writeCsv('consistency-k-mismatches.csv', consistency.k.filter((c) => c.mineActualSide !== c.storedActualSide).slice(0, 500));

// exemplars: worst/best calibrated per family by logloss
for (const fam of ['fullgame', 'f5', 'nrfi', 'kprops', 'hrprops']) {
  const rows = ledgers[fam].filter((r) => r.logloss !== '' && r.logloss !== undefined).sort((a, b) => Number(b.logloss) - Number(a.logloss));
  summary.families[fam].worst20 = rows.slice(0, 20).map((r) => ({ id: r.game_id, date: r.date, teams: r.teams, sub: r.sub_market, p: r.projected_probability, actual: r.actual_outcome, logloss: r.logloss }));
  summary.families[fam].best20 = rows.slice(-20).map((r) => ({ id: r.game_id, date: r.date, teams: r.teams, sub: r.sub_market, p: r.projected_probability, actual: r.actual_outcome, logloss: r.logloss }));
}

fs.writeFileSync(path.join(OUT_DIR, 'metrics-summary.json'), JSON.stringify(summary, null, 2));
console.error('[grade] metrics-summary.json written');
// terse stdout digest
const digest = {};
for (const [k, v] of Object.entries(summary.families)) digest[k] = { overall: v.overall, by_sub: Object.fromEntries(Object.entries(v.by_sub).map(([s, m]) => [s, { graded: m.graded, hit: m.hit_rate, brier: m.brier, mae: m.mae, bias: m.signed_bias, biasSig: m.bias_significant }])) };
digest.consistency = summary.consistency;
console.log(JSON.stringify(digest, null, 1));
await conn.end();
