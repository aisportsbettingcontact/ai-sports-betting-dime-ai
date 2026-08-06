#!/usr/bin/env node
// fullgame-grader-audit.mjs — GRADER role, fullgame market group (5x5 granular backtest).
// Grading-integrity proof: re-derives EVERY full-game grade from raw actuals for the entire
// population of final 2026 regular-season games (2026-03-25..2026-07-24) and diffs against:
//   (a) games.fgMlResult/fgMlCorrect/fgRlResult/fgRlCorrect/fgTotalResult/fgTotalCorrect,
//       games.brierFgMl/brierFgTotal
//   (b) mlb_game_backtest fg_* rows (fg_ml_home/away, fg_rl_home/away, fg_over/fg_under)
// Also cross-checks actuals against three independent sources (games.actual*, games.away/homeScore,
// mlb_schedule_history, mlb_replay_linescores) and verifies the 3 score-corrected games.
//
// READ-ONLY: only SELECT statements are issued. Outputs CSVs + JSON summary.
//
// Canonical grading rules (production forward path server/mlbOutcomeIngestor.ts + B6b vocab):
//   FG ML:    pAway = modelAwayWinPct/100; pick = away iff pAway > 0.5; WIN iff pick side won.
//   FG RL:    modelCover = (modelAwayScore - modelHomeScore) + awayRunLine;
//             actualCover = (aA - aH) + awayRunLine; actualCover==0 -> PUSH/null;
//             modelCover==0 -> null/null (production; B6 regrade would pick HOME — flagged class);
//             else WIN iff sign(modelCover) agrees with sign(actualCover).
//   FG TOTAL: result = actual market side OVER/UNDER/PUSH vs bookTotal;
//             correct = (modelOverRate/100 > 0.5 pick) == actual side; PUSH -> null.
//   brierFgMl:    (p - outcome)^2 to 6dp. Stored base may be away (B6 regrade) or home
//                 (production ingestor); both are computed, either accepted, base recorded.
//   brierFgTotal: (modelOverRate/100 - wentOver)^2 to 6dp; null on push/missing.
// Backtest fg_* actioned rows (result WIN/LOSS/PUSH):
//   fg_ml_home WIN iff home won; fg_ml_away WIN iff away won;
//   fg_rl_home WIN iff (aH-aA) > 1.5; fg_rl_away WIN iff (aH-aA) < 1.5;
//   fg_over WIN iff total > line, PUSH iff ==; fg_under mirrored. correct: WIN->1 LOSS->0 else null.
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const DATE_LO = '2026-03-25', DATE_HI = '2026-07-24';
const OUTDIR = path.resolve(new URL('.', import.meta.url).pathname, '../fullgame');
fs.mkdirSync(OUTDIR, { recursive: true });

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(2); }
async function connect() {
  try { const c = await mysql.createConnection(url); await c.query('SELECT 1'); return c; }
  catch { return mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }); }
}
const conn = await connect();
await conn.query('SET SESSION transaction_read_only = 1').catch(() => {});
const q = async (sql, p) => (await conn.query(sql, p))[0];

const num = (v) => (v === null || v === undefined || v === '' ? null : (isNaN(Number(v)) ? null : Number(v)));
// exact tenth-of-run integer arithmetic (scores int, lines 1dp, model scores 2dp -> use cents)
const cents = (v) => { const n = num(v); return n === null ? null : Math.round(n * 100); };
const b6 = (p, y) => +((p - y) ** 2).toFixed(6);
const csvEsc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function writeCsv(file, header, rows) {
  const fp = path.join(OUTDIR, file);
  fs.writeFileSync(fp, header.join(',') + '\n' + rows.map((r) => header.map((h) => csvEsc(r[h])).join(',')).join('\n') + (rows.length ? '\n' : ''));
  console.error(`[out] ${fp} (${rows.length} rows)`);
}

// ─── Pull population ─────────────────────────────────────────────────────────
const games = await q(`
  SELECT g.id, g.gameDate, g.awayTeam, g.homeTeam, g.mlbGamePk, g.doubleHeader, g.gameNumber,
         g.awayScore, g.homeScore, g.actualAwayScore, g.actualHomeScore, g.actualFgTotal,
         g.bookTotal, g.awayRunLine, g.awayML, g.homeML,
         g.modelAwayWinPct, g.modelHomeWinPct, g.modelAwayScore, g.modelHomeScore,
         g.modelOverRate, g.modelRunAt,
         g.fgMlResult, g.fgMlCorrect, g.fgRlResult, g.fgRlCorrect,
         g.fgTotalResult, g.fgTotalCorrect, g.brierFgMl, g.brierFgTotal, g.fgBacktestRunAt,
         l.awayFinalRuns lsAway, l.homeFinalRuns lsHome
  FROM games g
  LEFT JOIN mlb_replay_linescores l ON l.gamePk = g.mlbGamePk
  WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate BETWEEN ? AND ?
  ORDER BY g.gameDate, g.id`, [DATE_LO, DATE_HI]);
console.error(`[population] ${games.length} final games ${DATE_LO}..${DATE_HI}`);

// Schedule truth via the census linkage (gamesId -> anGameId), which resolves doubleheader
// twins correctly (a matchup+date join cannot).
const universeCsv = fs.readFileSync(path.resolve(new URL('.', import.meta.url).pathname, '../../census/game-universe.csv'), 'utf8')
  .trim().split('\n');
const uHead = universeCsv[0].split(',');
const uIdx = Object.fromEntries(uHead.map((h, i) => [h, i]));
const gamesIdToAn = new Map();
for (const line of universeCsv.slice(1)) {
  const f = line.split(',');
  const gid = Number(f[uIdx.gamesId]);
  if (gid) gamesIdToAn.set(gid, Number(f[uIdx.anGameId]));
}
const schedRows = await q(`SELECT anGameId, awayScore, homeScore, gameStatus FROM mlb_schedule_history WHERE gameDate BETWEEN ? AND ?`, [DATE_LO, DATE_HI]);
const schedByAn = new Map(schedRows.map((r) => [Number(r.anGameId), r]));
for (const g of games) {
  const an = gamesIdToAn.get(g.id);
  const s = an ? schedByAn.get(an) : undefined;
  g.schedAway = s && s.gameStatus === 'complete' ? s.awayScore : null;
  g.schedHome = s && s.gameStatus === 'complete' ? s.homeScore : null;
}

// ─── Re-derive games grades ──────────────────────────────────────────────────
const rederivRows = [], gameMismatches = [], actualsIssues = [];
const counters = {
  population: games.length,
  fgMl: { match: 0, mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0 },
  fgRl: { match: 0, mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0 },
  fgTotal: { match: 0, mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0 },
  brierFgMl: { match: 0, matchAwayBase: 0, matchHomeBase: 0, mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0 },
  brierFgTotal: { match: 0, mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0 },
  actuals: { schedAgree: 0, schedDisagree: 0, schedMissing: 0, lsAgree: 0, lsDisagree: 0, lsMissing: 0,
             scoreboardDisagree: 0, fgTotalColDisagree: 0, actualsMissing: 0 },
};

function cmp(field, gid, label, stored, derived, ctx) {
  const c = counters[field];
  const sNull = stored === null || stored === undefined;
  const dNull = derived === null || derived === undefined;
  if (sNull && dNull) { c.bothNull++; return 'both-null'; }
  if (sNull && !dNull) { c.storedNullDerivable++; gameMismatches.push({ gameId: gid, matchup: label, field, class: 'stored-null-derivable', stored: '', derived, ...ctx }); return 'stored-null-derivable'; }
  if (!sNull && dNull) { c.storedNotDerivable++; gameMismatches.push({ gameId: gid, matchup: label, field, class: 'stored-not-derivable', stored, derived: '', ...ctx }); return 'stored-not-derivable'; }
  const eq = typeof derived === 'number' && typeof stored === 'number'
    ? Math.abs(stored - derived) <= 1.5e-6
    : String(stored) === String(derived);
  if (eq) { c.match++; return 'match'; }
  c.mismatch++;
  gameMismatches.push({ gameId: gid, matchup: label, field, class: 'value-mismatch', stored, derived, ...ctx });
  return 'MISMATCH';
}

for (const g of games) {
  const label = `${g.awayTeam}@${g.homeTeam} ${g.gameDate}` + (num(g.gameNumber) > 1 || g.doubleHeader === 'Y' || g.doubleHeader === 'S' ? ` G${g.gameNumber}` : '');
  const aA = num(g.actualAwayScore), aH = num(g.actualHomeScore);
  const haveActuals = aA !== null && aH !== null;
  if (!haveActuals) counters.actuals.actualsMissing++;

  // actuals cross-checks
  const schedA = num(g.schedAway), schedH = num(g.schedHome);
  if (schedA === null || schedH === null) counters.actuals.schedMissing++;
  else if (haveActuals && (schedA !== aA || schedH !== aH)) {
    counters.actuals.schedDisagree++;
    actualsIssues.push({ gameId: g.id, matchup: label, source: 'mlb_schedule_history', games_actual: `${aA}-${aH}`, other: `${schedA}-${schedH}` });
  } else counters.actuals.schedAgree++;
  const lsA = num(g.lsAway), lsH = num(g.lsHome);
  if (lsA === null || lsH === null) counters.actuals.lsMissing++;
  else if (haveActuals && (lsA !== aA || lsH !== aH)) {
    counters.actuals.lsDisagree++;
    actualsIssues.push({ gameId: g.id, matchup: label, source: 'mlb_replay_linescores', games_actual: `${aA}-${aH}`, other: `${lsA}-${lsH}` });
  } else counters.actuals.lsAgree++;
  const sbA = num(g.awayScore), sbH = num(g.homeScore);
  if (haveActuals && sbA !== null && sbH !== null && (sbA !== aA || sbH !== aH)) {
    counters.actuals.scoreboardDisagree++;
    actualsIssues.push({ gameId: g.id, matchup: label, source: 'games.awayScore/homeScore', games_actual: `${aA}-${aH}`, other: `${sbA}-${sbH}` });
  }
  const aTotCol = num(g.actualFgTotal);
  if (haveActuals && aTotCol !== null && Math.round(aTotCol) !== aA + aH) {
    counters.actuals.fgTotalColDisagree++;
    actualsIssues.push({ gameId: g.id, matchup: label, source: 'games.actualFgTotal', games_actual: String(aA + aH), other: String(aTotCol) });
  }

  // FG ML
  const pAwayPct = num(g.modelAwayWinPct), pHomePct = num(g.modelHomeWinPct);
  let dMlResult = null, dMlCorrect = null;
  if (pAwayPct !== null && haveActuals) {
    if (aA === aH) { dMlResult = 'PUSH'; dMlCorrect = null; }
    else {
      const pickedAway = pAwayPct / 100 > 0.5;
      const won = pickedAway === (aA > aH);
      dMlResult = won ? 'WIN' : 'LOSS'; dMlCorrect = won ? 1 : 0;
    }
  }
  // FG RL (cents arithmetic; modelCover==0 boundary handled per production=null, flag if stored graded)
  const rlC = cents(g.awayRunLine), mA = cents(g.modelAwayScore), mH = cents(g.modelHomeScore);
  let dRlResult = null, dRlCorrect = null, rlBoundary = false;
  if (rlC !== null && mA !== null && mH !== null && haveActuals) {
    const actualCoverC = (aA - aH) * 100 + rlC;
    const modelCoverC = (mA - mH) + rlC;
    if (actualCoverC === 0) { dRlResult = 'PUSH'; dRlCorrect = null; }
    else if (modelCoverC === 0) { dRlResult = null; dRlCorrect = null; rlBoundary = true; }
    else {
      const won = (modelCoverC > 0) === (actualCoverC > 0);
      dRlResult = won ? 'WIN' : 'LOSS'; dRlCorrect = won ? 1 : 0;
    }
  }
  // FG TOTAL
  const btC = cents(g.bookTotal), pOverPct = num(g.modelOverRate);
  let dTotResult = null, dTotCorrect = null;
  if (btC !== null && btC > 0 && haveActuals) {
    const atC = (aA + aH) * 100;
    if (atC === btC) { dTotResult = 'PUSH'; dTotCorrect = null; }
    else {
      dTotResult = atC > btC ? 'OVER' : 'UNDER';
      if (pOverPct !== null) dTotCorrect = ((pOverPct / 100 > 0.5) === (atC > btC)) ? 1 : 0;
    }
  }
  // Briers
  let dBrierMlAway = null, dBrierMlHome = null;
  if (haveActuals && aA !== aH) {
    if (pAwayPct !== null) dBrierMlAway = b6(pAwayPct / 100, aA > aH ? 1 : 0);
    if (pHomePct !== null) dBrierMlHome = b6(pHomePct / 100, aH > aA ? 1 : 0);
  }
  let dBrierTot = null;
  if (btC !== null && btC > 0 && haveActuals && pOverPct !== null) {
    const atC = (aA + aH) * 100;
    if (atC !== btC) dBrierTot = b6(pOverPct / 100, atC > btC ? 1 : 0);
  }

  const sMlResult = g.fgMlResult ?? null, sMlCorrect = num(g.fgMlCorrect);
  const sRlResult = g.fgRlResult ?? null, sRlCorrect = num(g.fgRlCorrect);
  const sTotResult = g.fgTotalResult ?? null, sTotCorrect = num(g.fgTotalCorrect);
  const sBrierMl = num(g.brierFgMl), sBrierTot = num(g.brierFgTotal);

  const ctx = { actualAway: aA, actualHome: aH, bookTotal: num(g.bookTotal), awayRunLine: num(g.awayRunLine),
    modelAwayWinPct: pAwayPct, modelOverRate: pOverPct, modelAwayScore: num(g.modelAwayScore), modelHomeScore: num(g.modelHomeScore) };

  const mlR = cmp('fgMl', g.id, label, sMlResult, dMlResult, ctx);
  const mlCcmp = (sMlCorrect === dMlCorrect) || (sMlCorrect === null && dMlCorrect === null);
  if (!mlCcmp) gameMismatches.push({ gameId: g.id, matchup: label, field: 'fgMlCorrect', class: 'value-mismatch', stored: sMlCorrect, derived: dMlCorrect, ...ctx });

  const rlR = cmp('fgRl', g.id, label, sRlResult, dRlResult, { ...ctx, rlBoundary });
  const rlCcmp = (sRlCorrect === dRlCorrect) || (sRlCorrect === null && dRlCorrect === null);
  if (!rlCcmp) gameMismatches.push({ gameId: g.id, matchup: label, field: 'fgRlCorrect', class: 'value-mismatch', stored: sRlCorrect, derived: dRlCorrect, ...ctx });

  const totR = cmp('fgTotal', g.id, label, sTotResult, dTotResult, ctx);
  const totCcmp = (sTotCorrect === dTotCorrect) || (sTotCorrect === null && dTotCorrect === null);
  if (!totCcmp) gameMismatches.push({ gameId: g.id, matchup: label, field: 'fgTotalCorrect', class: 'value-mismatch', stored: sTotCorrect, derived: dTotCorrect, ...ctx });

  // brierFgMl: accept away-base (B6 regrade) or home-base (production forward path)
  let brierMlStatus;
  const cM = counters.brierFgMl;
  const dAny = dBrierMlAway !== null ? dBrierMlAway : dBrierMlHome;
  if (sBrierMl === null && dAny === null) { cM.bothNull++; brierMlStatus = 'both-null'; }
  else if (sBrierMl === null) { cM.storedNullDerivable++; brierMlStatus = 'stored-null-derivable'; gameMismatches.push({ gameId: g.id, matchup: label, field: 'brierFgMl', class: 'stored-null-derivable', stored: '', derived: dAny, ...ctx }); }
  else if (dAny === null) { cM.storedNotDerivable++; brierMlStatus = 'stored-not-derivable'; gameMismatches.push({ gameId: g.id, matchup: label, field: 'brierFgMl', class: 'stored-not-derivable', stored: sBrierMl, derived: '', ...ctx }); }
  else if (dBrierMlAway !== null && Math.abs(sBrierMl - dBrierMlAway) <= 1.5e-6) { cM.match++; cM.matchAwayBase++; brierMlStatus = 'match-away-base'; }
  else if (dBrierMlHome !== null && Math.abs(sBrierMl - dBrierMlHome) <= 1.5e-6) { cM.match++; cM.matchHomeBase++; brierMlStatus = 'match-home-base'; }
  else { cM.mismatch++; brierMlStatus = 'MISMATCH'; gameMismatches.push({ gameId: g.id, matchup: label, field: 'brierFgMl', class: 'value-mismatch', stored: sBrierMl, derived: `away=${dBrierMlAway} home=${dBrierMlHome}`, ...ctx }); }

  const brierTotStatus = cmp('brierFgTotal', g.id, label, sBrierTot, dBrierTot, ctx);

  rederivRows.push({
    gameId: g.id, gameDate: g.gameDate, matchup: label, mlbGamePk: g.mlbGamePk,
    actualAway: aA, actualHome: aH, schedScore: schedA !== null ? `${schedA}-${schedH}` : '',
    linescoreScore: lsA !== null ? `${lsA}-${lsH}` : '',
    bookTotal: num(g.bookTotal), awayRunLine: num(g.awayRunLine),
    modelAwayWinPct: pAwayPct, modelOverRate: pOverPct,
    modelAwayScore: num(g.modelAwayScore), modelHomeScore: num(g.modelHomeScore),
    stored_fgMlResult: sMlResult, derived_fgMlResult: dMlResult, fgMl_status: mlR,
    stored_fgMlCorrect: sMlCorrect, derived_fgMlCorrect: dMlCorrect,
    stored_fgRlResult: sRlResult, derived_fgRlResult: dRlResult, fgRl_status: rlR,
    stored_fgRlCorrect: sRlCorrect, derived_fgRlCorrect: dRlCorrect,
    stored_fgTotalResult: sTotResult, derived_fgTotalResult: dTotResult, fgTotal_status: totR,
    stored_fgTotalCorrect: sTotCorrect, derived_fgTotalCorrect: dTotCorrect,
    stored_brierFgMl: sBrierMl, derived_brierFgMl_away: dBrierMlAway, derived_brierFgMl_home: dBrierMlHome, brierFgMl_status: brierMlStatus,
    stored_brierFgTotal: sBrierTot, derived_brierFgTotal: dBrierTot, brierFgTotal_status: brierTotStatus,
  });
}

writeCsv('fullgame-grader-games-rederivation.csv', Object.keys(rederivRows[0]), rederivRows);
writeCsv('fullgame-grader-games-mismatches.csv',
  ['gameId','matchup','field','class','stored','derived','actualAway','actualHome','bookTotal','awayRunLine','modelAwayWinPct','modelOverRate','modelAwayScore','modelHomeScore','rlBoundary'],
  gameMismatches);
writeCsv('fullgame-grader-actuals-crosscheck-issues.csv', ['gameId','matchup','source','games_actual','other'], actualsIssues);

// ─── Backtest fg_* rows ──────────────────────────────────────────────────────
const btRows = await q(`
  SELECT b.id btId, b.gameId, b.gameDate btDate, b.market, b.modelSide, b.modelProb, b.bookLine,
         b.bookOdds, b.bookNoVigProb, b.edge, b.ev, b.confidencePassed, b.result, b.correct,
         b.actualAwayScore btAway, b.actualHomeScore btHome, b.backtestRunAt, b.quarantineReason,
         b.voidReason, b.leakageSafe, b.auditVersion,
         g.actualAwayScore gAway, g.actualHomeScore gHome, g.bookTotal gBookTotal, g.gameDate
  FROM mlb_game_backtest b
  JOIN games g ON g.id = b.gameId
  WHERE b.market LIKE 'fg\\_%'
    AND g.sport='MLB' AND g.gameStatus='final' AND g.gameDate BETWEEN ? AND ?
  ORDER BY b.gameId, b.market`, [DATE_LO, DATE_HI]);
console.error(`[backtest] ${btRows.length} fg_* rows in population`);

const btOut = [], btMismatches = [];
const btCounters = {};
const bump = (k) => { btCounters[k] = (btCounters[k] ?? 0) + 1; };
const THRESH = { fg_ml_home: 0.06, fg_ml_away: 0.05, fg_rl_home: 0.05, fg_rl_away: 0.18 };

for (const r of btRows) {
  const aA = num(r.gAway), aH = num(r.gHome);
  const haveActuals = aA !== null && aH !== null;
  const market = r.market;
  const stored = r.result;
  const storedCorrect = num(r.correct);
  const conf = num(r.confidencePassed);
  let derivedOutcome = null; // WIN/LOSS/PUSH from actuals for this side, independent of confidence
  let lineUsed = null;
  if (haveActuals) {
    if (market === 'fg_ml_home') derivedOutcome = aH === aA ? 'PUSH' : (aH > aA ? 'WIN' : 'LOSS');
    else if (market === 'fg_ml_away') derivedOutcome = aH === aA ? 'PUSH' : (aA > aH ? 'WIN' : 'LOSS');
    else if (market === 'fg_rl_home' || market === 'fg_rl_away') {
      const marginC = (aH - aA) * 100;
      const covers = market === 'fg_rl_home' ? marginC > 150 : marginC < 150;
      derivedOutcome = marginC === 150 ? 'PUSH' : (covers ? 'WIN' : 'LOSS');
    } else if (market === 'fg_over' || market === 'fg_under') {
      lineUsed = num(r.bookLine) !== null ? num(r.bookLine) : num(r.gBookTotal);
      if (lineUsed !== null) {
        const atC = (aA + aH) * 100, lC = Math.round(lineUsed * 100);
        derivedOutcome = atC === lC ? 'PUSH' : ((market === 'fg_over') === (atC > lC) ? 'WIN' : 'LOSS');
      }
    }
  }
  const isActioned = stored === 'WIN' || stored === 'LOSS' || stored === 'PUSH';
  let status = 'ok', note = '';
  if (isActioned) {
    if (!haveActuals) { status = 'DEFECT:actioned-no-actuals'; }
    else if (derivedOutcome === null) { status = 'DEFECT:actioned-no-line'; }
    else if (stored !== derivedOutcome) { status = 'DEFECT:result-mismatch'; note = `derived=${derivedOutcome}`; }
    const expCorrect = stored === 'WIN' ? 1 : stored === 'LOSS' ? 0 : null;
    if (status === 'ok' && !(storedCorrect === expCorrect)) { status = 'DEFECT:correct-mismatch'; note = `expected correct=${expCorrect}`; }
    if (status === 'ok' && conf !== 1) { status = 'WARN:actioned-conf0'; }
  } else if (stored === 'NO_ACTION') {
    if (storedCorrect !== null) { status = 'DEFECT:noaction-correct-set'; }
    else if (conf !== 0) { status = 'WARN:noaction-conf1'; }
  } else if (stored === 'MISSING_DATA') {
    if (haveActuals) { status = 'INFO:missingdata-now-derivable'; note = `derived=${derivedOutcome ?? ''}`; }
    if (storedCorrect !== null) { status = 'DEFECT:missingdata-correct-set'; }
  } else if (stored === 'QUARANTINED') {
    if (!r.quarantineReason) { status = 'DEFECT:quarantined-no-reason'; }
    if (storedCorrect !== null) { status = 'DEFECT:quarantined-correct-set'; }
  } else if (stored === 'VOID') {
    if (!r.voidReason) { status = 'DEFECT:void-no-reason'; }
    if (storedCorrect !== null) { status = 'DEFECT:void-correct-set'; }
  } else { status = 'DEFECT:unknown-result-value'; }

  // stale actuals embedded in backtest row
  const btA = num(r.btAway), btH = num(r.btHome);
  let staleActuals = '';
  if (haveActuals && btA !== null && btH !== null && (btA !== aA || btH !== aH)) {
    staleActuals = `row=${btA}-${btH} games=${aA}-${aH}`;
    if (status === 'ok') status = 'DEFECT:stale-row-actuals';
  }

  // edge recompute (informational; modelProb stored at 2dp so tolerance 0.0051)
  const mp = num(r.modelProb), nv = num(r.bookNoVigProb), e = num(r.edge);
  let edgeCheck = '';
  if (mp !== null && nv !== null && e !== null && Math.abs(e - (mp - nv)) > 0.0051) {
    edgeCheck = `stored=${e} recomputed=${(mp - nv).toFixed(4)}`;
    bump('edge-outlier:' + market);
  }
  // threshold consistency (informational — thresholds changed over time)
  let threshCheck = '';
  if (stored === 'NO_ACTION' || isActioned) {
    if (market === 'fg_over' || market === 'fg_under') {
      if (mp !== null) {
        const shouldAct = mp >= 0.65;
        if (shouldAct !== isActioned) { threshCheck = `p=${mp} actioned=${isActioned}`; bump('threshold-inconsistent:' + market); }
      }
    } else if (e !== null) {
      const shouldAct = e >= THRESH[market];
      if (shouldAct !== isActioned) { threshCheck = `edge=${e} thresh=${THRESH[market]} actioned=${isActioned}`; bump('threshold-inconsistent:' + market); }
    }
  }

  bump(`result:${market}:${stored}`);
  bump(`status:${status.split(':')[0]}`);
  if (status !== 'ok') bump(`statusDetail:${status}`);

  const row = {
    btId: r.btId, gameId: r.gameId, gameDate: r.gameDate, market, modelSide: r.modelSide,
    stored_result: stored, derived_outcome: derivedOutcome, stored_correct: storedCorrect,
    confidencePassed: conf, modelProb: mp, bookNoVigProb: nv, edge: e, bookLine: r.bookLine,
    lineUsed, games_actual: haveActuals ? `${aA}-${aH}` : '', bt_row_actual: btA !== null ? `${btA}-${btH}` : '',
    staleActuals, edgeCheck, threshCheck, status,
    quarantineReason: r.quarantineReason ? String(r.quarantineReason).slice(0, 80) : '',
    voidReason: r.voidReason ? String(r.voidReason).slice(0, 80) : '',
    auditVersion: r.auditVersion ?? '', note,
  };
  btOut.push(row);
  if (status.startsWith('DEFECT') || status.startsWith('WARN')) btMismatches.push(row);
}

writeCsv('fullgame-grader-backtest-rederivation.csv', Object.keys(btOut[0]), btOut);
writeCsv('fullgame-grader-backtest-mismatches.csv', Object.keys(btOut[0]), btMismatches);

// games in population lacking any fg backtest rows
const covered = new Set(btRows.map((r) => r.gameId));
const uncovered = games.filter((g) => !covered.has(g.id)).map((g) => ({
  gameId: g.id, gameDate: g.gameDate, matchup: `${g.awayTeam}@${g.homeTeam}`, mlbGamePk: g.mlbGamePk }));
writeCsv('fullgame-grader-backtest-uncovered-games.csv', ['gameId','gameDate','matchup','mlbGamePk'], uncovered);

// duplicate (gameId, market) check
const dupCount = {};
for (const r of btRows) { const k = r.gameId + ':' + r.market; dupCount[k] = (dupCount[k] ?? 0) + 1; }
const dups = Object.entries(dupCount).filter(([, n]) => n > 1);

// ─── The 3 score-corrected games ─────────────────────────────────────────────
const corrected = [
  { away: 'STL', home: 'CIN', date: '2026-05-23', gameNumber: 2, fixedScore: '6-7' },
  { away: 'DET', home: 'BAL', date: '2026-05-24', gameNumber: 1, fixedScore: '3-5' },
  { away: 'MIL', home: 'STL', date: '2026-07-07', gameNumber: 2, fixedScore: '10-2' },
];
const correctedReport = [];
for (const c of corrected) {
  const g = games.find((x) => x.awayTeam === c.away && x.homeTeam === c.home && x.gameDate === c.date && num(x.gameNumber) === c.gameNumber);
  if (!g) { correctedReport.push({ ...c, found: 'NO' }); continue; }
  const rr = rederivRows.find((x) => x.gameId === g.id);
  const bt = btOut.filter((x) => x.gameId === g.id);
  correctedReport.push({
    gameId: g.id, matchup: `${c.away}@${c.home} ${c.date} G${c.gameNumber}`, expectedScore: c.fixedScore,
    games_actual: `${num(g.actualAwayScore)}-${num(g.actualHomeScore)}`,
    sched: rr.schedScore, linescore: rr.linescoreScore,
    scoreOk: `${num(g.actualAwayScore)}-${num(g.actualHomeScore)}` === c.fixedScore ? 'YES' : 'NO',
    fgMl: `${rr.stored_fgMlResult}/${rr.derived_fgMlResult}/${rr.fgMl_status}`,
    fgRl: `${rr.stored_fgRlResult}/${rr.derived_fgRlResult}/${rr.fgRl_status}`,
    fgTotal: `${rr.stored_fgTotalResult}/${rr.derived_fgTotalResult}/${rr.fgTotal_status}`,
    brierFgMl: rr.brierFgMl_status, brierFgTotal: rr.brierFgTotal_status,
    backtestRows: bt.length,
    backtestStale: bt.filter((x) => x.staleActuals).length,
    backtestDefects: bt.filter((x) => x.status.startsWith('DEFECT')).length,
    backtestDetail: bt.map((x) => `${x.market}:${x.stored_result}${x.staleActuals ? '(STALE)' : ''}`).join(' '),
  });
}
writeCsv('fullgame-grader-corrected-games.csv', Object.keys(correctedReport[0]), correctedReport);

// ─── replay-grades state snapshot (running pipeline — record, not judge) ─────
const rg = await q(`SELECT market, source, modelVersion, COUNT(*) n FROM mlb_replay_grades GROUP BY market, source, modelVersion`);

// ─── Summary ─────────────────────────────────────────────────────────────────
const summary = {
  ranAt: new Date().toISOString(),
  window: [DATE_LO, DATE_HI],
  population: games.length,
  gamesCounters: counters,
  gamesMismatchRows: gameMismatches.length,
  actualsIssueRows: actualsIssues.length,
  backtest: {
    rows: btRows.length,
    perGameMarkets: 6,
    coveredGames: covered.size,
    uncoveredGames: uncovered,
    duplicates: dups,
    counters: btCounters,
    mismatchRows: btMismatches.length,
  },
  correctedGames: correctedReport,
  replayGradesStateAtRun: rg,
};
fs.writeFileSync(path.join(OUTDIR, 'fullgame-grader-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await conn.end();
