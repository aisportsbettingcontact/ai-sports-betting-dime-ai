#!/usr/bin/env node
// f5-grader-audit.mjs — GRADER role, f5 market group (5x5 granular backtest).
// Grading-integrity proof for ALL final 2026 regular-season games (2026-03-25..2026-07-24):
//  A. Cross-check actualF5AwayScore/actualF5HomeScore/actualF5Total against
//     mlb_replay_linescores f5 sums for EVERY game (join by gameId; gamePk consistency too).
//  B. Re-derive games.f5MlResult/f5MlCorrect/f5RlResult/f5RlCorrect/f5TotalResult/
//     f5TotalCorrect/brierF5Ml/brierF5Total from raw actuals + stored model/book columns;
//     diff vs stored. Two historical writer conventions are both computed and recorded:
//       - B6 audit regrade (tools/remediation/b6-regrade.mjs): RL pick from
//         modelF5AwayRLCoverPct>50; brierF5Ml AWAY-base.
//       - production forward path (server/mlbOutcomeIngestor.ts): RL pick from model F5
//         margin + f5AwayRunLine; brierF5Ml HOME-base.
//     A stored value matching either convention counts as a match; the base/convention is
//     recorded per row. brierF5Total legacy (/100, M-203) is also tested to prove eradication.
//  C. Re-derive mlb_game_backtest f5_* rows (f5_ml_home/away, f5_rl_home/away, f5_over/f5_under)
//     per server/mlbMultiMarketBacktest.ts rules:
//       ml: PUSH on F5 tie; rl home -0.5 WIN iff margin>0, away +0.5 WIN iff margin<=0 (no push);
//       over/under vs bookLine ?? games.f5Total, PUSH on exact.
//     Thresholds (informational): ml/rl edge>=0.05; totals modelProb>=0.60.
//  D. Reconcile mlb_replay_grades f5_ml/f5_rl/f5_total rows (ALL sources/modelVersions present
//     at run time — pipeline is live, counts are a recorded snapshot): internal consistency of
//     pick/prob/line/actual/result/correct/brier/signedError vs raw actuals; for source
//     live_pregame additionally full re-derivation of prob/line from the games row.
// READ-ONLY: SELECTs only. Outputs CSVs + JSON summary to ../f5/.
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const DATE_LO = '2026-03-25', DATE_HI = '2026-07-24';
const OUTDIR = path.resolve(new URL('.', import.meta.url).pathname, '../f5');
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
const tenths = (v) => { const n = num(v); return n === null ? null : Math.round(n * 10); };
const cents = (v) => { const n = num(v); return n === null ? null : Math.round(n * 100); };
const b6r = (p, y) => +((p - y) ** 2).toFixed(6);
const close = (a, b, tol = 1.5e-6) => a !== null && b !== null && Math.abs(a - b) <= tol;
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

// ─── Population ──────────────────────────────────────────────────────────────
const games = await q(`
  SELECT g.id, g.gameDate, g.awayTeam, g.homeTeam, g.mlbGamePk, g.doubleHeader, g.gameNumber,
         g.actualAwayScore, g.actualHomeScore,
         g.actualF5AwayScore, g.actualF5HomeScore, g.actualF5Total,
         g.modelF5AwayWinPct, g.modelF5HomeWinPct, g.modelF5AwayScore, g.modelF5HomeScore,
         g.modelF5AwayRLCoverPct, g.modelF5HomeRLCoverPct,
         g.modelF5OverRate, g.modelF5UnderRate, g.modelF5Total,
         g.f5AwayRunLine, g.f5HomeRunLine, g.f5Total, g.f5AwayML, g.f5HomeML,
         g.modelF5OverOdds, g.modelF5UnderOdds,
         g.f5MlResult, g.f5MlCorrect, g.f5RlResult, g.f5RlCorrect,
         g.f5TotalResult, g.f5TotalCorrect, g.brierF5Ml, g.brierF5Total, g.f5BacktestRunAt,
         l.gamePk lsGamePk, l.f5AwayRuns lsF5Away, l.f5HomeRuns lsF5Home,
         l.awayFinalRuns lsFgAway, l.homeFinalRuns lsFgHome
  FROM games g
  LEFT JOIN mlb_replay_linescores l ON l.gameId = g.id
  WHERE g.sport='MLB' AND g.gameStatus='final' AND g.gameDate BETWEEN ? AND ?
  ORDER BY g.gameDate, g.id`, [DATE_LO, DATE_HI]);
console.error(`[population] ${games.length} final games ${DATE_LO}..${DATE_HI}`);

// ─── A + B: actuals cross-check + games grade re-derivation ─────────────────
const rederivRows = [], gameMismatches = [], actualsIssues = [];
const C = {
  population: games.length,
  actuals: { lsAgree: 0, lsDisagree: 0, lsMissing: 0, gamesF5Missing: 0,
             gamePkMismatch: 0, f5TotalColAgree: 0, f5TotalColDisagree: 0, f5TotalColNullDerivable: 0 },
  f5Ml: { match: 0, mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0 },
  f5MlCorrect: { mismatch: 0 },
  f5Rl: { match: 0, matchProbConvOnly: 0, matchMarginConvOnly: 0, matchBothConv: 0,
          mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0, convDisagreeRows: 0 },
  f5RlCorrect: { mismatch: 0 },
  f5Total: { match: 0, mismatch: 0, bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0, legacyVocab: 0 },
  f5TotalCorrect: { mismatch: 0 },
  brierF5Ml: { match: 0, matchAwayBase: 0, matchHomeBase: 0, matchBothBase: 0, mismatch: 0,
               bothNull: 0, storedNullDerivable: 0, storedNotDerivable: 0 },
  brierF5Total: { match: 0, matchLegacyCorrupt: 0, mismatch: 0, bothNull: 0,
                  storedNullDerivable: 0, storedNotDerivable: 0 },
  linePlausibility: { rlNotHalf: 0, totalOutside3to7: 0 },
  f5RunAtMissingButGraded: 0,
};

function pushMismatch(gid, label, field, cls, stored, derived, ctx) {
  gameMismatches.push({ gameId: gid, matchup: label, field, class: cls, stored: stored ?? '', derived: derived ?? '', ...ctx });
}
function cmp3(counter, gid, label, field, stored, derived, ctx) {
  const sNull = stored === null || stored === undefined;
  const dNull = derived === null || derived === undefined;
  if (sNull && dNull) { counter.bothNull++; return 'both-null'; }
  if (sNull && !dNull) { counter.storedNullDerivable++; pushMismatch(gid, label, field, 'stored-null-derivable', '', derived, ctx); return 'stored-null-derivable'; }
  if (!sNull && dNull) { counter.storedNotDerivable++; pushMismatch(gid, label, field, 'stored-not-derivable', stored, '', ctx); return 'stored-not-derivable'; }
  const eq = typeof derived === 'number' && typeof stored === 'number' ? close(stored, derived) : String(stored) === String(derived);
  if (eq) { counter.match++; return 'match'; }
  counter.mismatch++;
  pushMismatch(gid, label, field, 'value-mismatch', stored, derived, ctx);
  return 'MISMATCH';
}

const linePlausRows = [];
for (const g of games) {
  const label = `${g.awayTeam}@${g.homeTeam} ${g.gameDate}` + (num(g.gameNumber) > 1 || g.doubleHeader === 'Y' || g.doubleHeader === 'S' ? ` G${g.gameNumber}` : '');
  const f5a = num(g.actualF5AwayScore), f5h = num(g.actualF5HomeScore);
  const haveActuals = f5a !== null && f5h !== null;
  if (!haveActuals) C.actuals.gamesF5Missing++;

  // A. linescore cross-check (every game)
  const lsA = num(g.lsF5Away), lsH = num(g.lsF5Home);
  if (lsA === null || lsH === null) {
    C.actuals.lsMissing++;
    if (haveActuals) actualsIssues.push({ gameId: g.id, matchup: label, check: 'linescore-f5-missing', games_value: `${f5a}-${f5h}`, other_value: '' });
  } else if (haveActuals && (lsA !== f5a || lsH !== f5h)) {
    C.actuals.lsDisagree++;
    actualsIssues.push({ gameId: g.id, matchup: label, check: 'linescore-f5-disagree', games_value: `${f5a}-${f5h}`, other_value: `${lsA}-${lsH}` });
  } else if (haveActuals) C.actuals.lsAgree++;
  if (g.lsGamePk !== null && num(g.mlbGamePk) !== null && num(g.lsGamePk) !== num(g.mlbGamePk)) {
    C.actuals.gamePkMismatch++;
    actualsIssues.push({ gameId: g.id, matchup: label, check: 'linescore-gamePk-mismatch', games_value: String(g.mlbGamePk), other_value: String(g.lsGamePk) });
  }
  const aTotCol = num(g.actualF5Total);
  if (haveActuals && aTotCol !== null) {
    if (Math.round(aTotCol) !== f5a + f5h) {
      C.actuals.f5TotalColDisagree++;
      actualsIssues.push({ gameId: g.id, matchup: label, check: 'actualF5Total-disagrees-with-scores', games_value: String(f5a + f5h), other_value: String(aTotCol) });
    } else C.actuals.f5TotalColAgree++;
  } else if (haveActuals && aTotCol === null) {
    C.actuals.f5TotalColNullDerivable++;
    actualsIssues.push({ gameId: g.id, matchup: label, check: 'actualF5Total-null-derivable', games_value: `${f5a}+${f5h}=${f5a + f5h}`, other_value: '' });
  }

  // line plausibility (context finding, not a grade defect per se)
  const rlN = num(g.f5AwayRunLine), f5tN = num(g.f5Total);
  const rlOdd = rlN !== null && Math.abs(rlN) !== 0.5;
  const totOdd = f5tN !== null && (f5tN < 3 || f5tN > 7);
  if (rlOdd) C.linePlausibility.rlNotHalf++;
  if (totOdd) C.linePlausibility.totalOutside3to7++;
  if (rlOdd || totOdd) linePlausRows.push({ gameId: g.id, matchup: label, f5AwayRunLine: g.f5AwayRunLine ?? '', f5Total: g.f5Total ?? '', graded_rl: g.f5RlResult ?? '', graded_total: g.f5TotalResult ?? '' });

  // B. re-derivation
  const pA = num(g.modelF5AwayWinPct), pH = num(g.modelF5HomeWinPct);
  const ctx = { f5Actual: haveActuals ? `${f5a}-${f5h}` : '', f5AwayRunLine: g.f5AwayRunLine ?? '', f5Total: g.f5Total ?? '',
    modelF5AwayWinPct: pA, modelF5AwayRLCoverPct: num(g.modelF5AwayRLCoverPct),
    modelF5AwayScore: num(g.modelF5AwayScore), modelF5HomeScore: num(g.modelF5HomeScore),
    modelF5OverRate: num(g.modelF5OverRate) };

  // F5 ML
  let dMlResult = null, dMlCorrect = null;
  if (pA !== null && haveActuals) {
    if (f5a === f5h) { dMlResult = 'PUSH'; dMlCorrect = null; }
    else {
      const won = (pA / 100 > 0.5) === (f5a > f5h);
      dMlResult = won ? 'WIN' : 'LOSS'; dMlCorrect = won ? 1 : 0;
    }
  }
  const mlStatus = cmp3(C.f5Ml, g.id, label, 'f5MlResult', g.f5MlResult ?? null, dMlResult, ctx);
  const sMlCorrect = num(g.f5MlCorrect);
  if (!((sMlCorrect === dMlCorrect) || (sMlCorrect === null && dMlCorrect === null))) {
    C.f5MlCorrect.mismatch++;
    pushMismatch(g.id, label, 'f5MlCorrect', 'value-mismatch', sMlCorrect, dMlCorrect, ctx);
  }

  // F5 RL — two writer conventions
  const rlT = tenths(g.f5AwayRunLine);
  const pRl = num(g.modelF5AwayRLCoverPct);
  const mAC = cents(g.modelF5AwayScore), mHC = cents(g.modelF5HomeScore);
  let dRlProb = null, dRlProbCor = null, dRlMargin = null, dRlMarginCor = null;
  if (rlT !== null && haveActuals) {
    const actualCoverT = (f5a - f5h) * 10 + rlT;
    if (actualCoverT === 0) { // push (impossible on .5 lines but integer contaminated lines can push)
      if (pRl !== null) { dRlProb = 'PUSH'; }
      if (mAC !== null && mHC !== null) { dRlMargin = 'PUSH'; }
    } else {
      const awayCovered = actualCoverT > 0;
      if (pRl !== null) {
        const won = (pRl > 50) === awayCovered;
        dRlProb = won ? 'WIN' : 'LOSS'; dRlProbCor = won ? 1 : 0;
      }
      if (mAC !== null && mHC !== null) {
        const modelCoverC = (mAC - mHC) + rlT * 10;
        if (modelCoverC !== 0) {
          const won = (modelCoverC > 0) === awayCovered;
          dRlMargin = won ? 'WIN' : 'LOSS'; dRlMarginCor = won ? 1 : 0;
        }
      }
    }
  }
  const sRl = g.f5RlResult ?? null, sRlCorrect = num(g.f5RlCorrect);
  const convDisagree = dRlProb !== null && dRlMargin !== null && dRlProb !== dRlMargin;
  if (convDisagree) C.f5Rl.convDisagreeRows++;
  let rlStatus;
  {
    const sNull = sRl === null, dNull = dRlProb === null && dRlMargin === null;
    if (sNull && dNull) { C.f5Rl.bothNull++; rlStatus = 'both-null'; }
    else if (sNull) { C.f5Rl.storedNullDerivable++; rlStatus = 'stored-null-derivable'; pushMismatch(g.id, label, 'f5RlResult', 'stored-null-derivable', '', `prob=${dRlProb} margin=${dRlMargin}`, ctx); }
    else if (dNull) { C.f5Rl.storedNotDerivable++; rlStatus = 'stored-not-derivable'; pushMismatch(g.id, label, 'f5RlResult', 'stored-not-derivable', sRl, '', ctx); }
    else {
      const mProb = sRl === dRlProb, mMargin = sRl === dRlMargin;
      if (mProb || mMargin) {
        C.f5Rl.match++;
        if (mProb && mMargin) { C.f5Rl.matchBothConv++; rlStatus = 'match-both-conv'; }
        else if (mProb) { C.f5Rl.matchProbConvOnly++; rlStatus = 'match-prob-conv'; }
        else { C.f5Rl.matchMarginConvOnly++; rlStatus = 'match-margin-conv'; }
      } else {
        C.f5Rl.mismatch++; rlStatus = 'MISMATCH';
        pushMismatch(g.id, label, 'f5RlResult', 'value-mismatch', sRl, `prob=${dRlProb} margin=${dRlMargin}`, ctx);
      }
    }
  }
  const rlCorOk = (sRlCorrect === dRlProbCor) || (sRlCorrect === dRlMarginCor) ||
    (sRlCorrect === null && dRlProbCor === null && dRlMarginCor === null);
  if (!rlCorOk) {
    C.f5RlCorrect.mismatch++;
    pushMismatch(g.id, label, 'f5RlCorrect', 'value-mismatch', sRlCorrect, `prob=${dRlProbCor} margin=${dRlMarginCor}`, ctx);
  }

  // F5 TOTAL — result = actual side (B6b vocab), correct = model verdict
  const f5tT = tenths(g.f5Total), p5o = num(g.modelF5OverRate);
  let dTotResult = null, dTotCorrect = null;
  if (f5tT !== null && f5tT > 0 && haveActuals) {
    const atT = (f5a + f5h) * 10;
    if (atT === f5tT) { dTotResult = 'PUSH'; dTotCorrect = null; }
    else {
      dTotResult = atT > f5tT ? 'OVER' : 'UNDER';
      if (p5o !== null) dTotCorrect = ((p5o > 0.5) === (atT > f5tT)) ? 1 : 0;
    }
  }
  const sTot = g.f5TotalResult ?? null;
  if (sTot === 'WIN' || sTot === 'LOSS') C.f5Total.legacyVocab++;
  const totStatus = cmp3(C.f5Total, g.id, label, 'f5TotalResult', sTot, dTotResult, ctx);
  const sTotCorrect = num(g.f5TotalCorrect);
  if (!((sTotCorrect === dTotCorrect) || (sTotCorrect === null && dTotCorrect === null))) {
    C.f5TotalCorrect.mismatch++;
    pushMismatch(g.id, label, 'f5TotalCorrect', 'value-mismatch', sTotCorrect, dTotCorrect, ctx);
  }

  // brierF5Ml — away-base (B6) vs home-base (production ingestor); NOT equivalent (pA+pH≈85)
  let dBrierAway = null, dBrierHome = null;
  if (haveActuals && f5a !== f5h) {
    if (pA !== null && pA >= 0 && pA <= 100) dBrierAway = b6r(pA / 100, f5a > f5h ? 1 : 0);
    if (pH !== null && pH >= 0 && pH <= 100) dBrierHome = b6r(pH / 100, f5h > f5a ? 1 : 0);
  }
  const sBrierMl = num(g.brierF5Ml);
  let brierMlStatus;
  {
    const cB = C.brierF5Ml;
    const dAny = dBrierAway !== null ? dBrierAway : dBrierHome;
    if (sBrierMl === null && dAny === null) { cB.bothNull++; brierMlStatus = 'both-null'; }
    else if (sBrierMl === null) { cB.storedNullDerivable++; brierMlStatus = 'stored-null-derivable'; pushMismatch(g.id, label, 'brierF5Ml', 'stored-null-derivable', '', dAny, ctx); }
    else if (dAny === null) { cB.storedNotDerivable++; brierMlStatus = 'stored-not-derivable'; pushMismatch(g.id, label, 'brierF5Ml', 'stored-not-derivable', sBrierMl, '', ctx); }
    else {
      const mA = close(sBrierMl, dBrierAway), mH = close(sBrierMl, dBrierHome);
      if (mA || mH) {
        cB.match++;
        if (mA && mH) { cB.matchBothBase++; brierMlStatus = 'match-both-base'; }
        else if (mA) { cB.matchAwayBase++; brierMlStatus = 'match-away-base'; }
        else { cB.matchHomeBase++; brierMlStatus = 'match-home-base'; }
      } else {
        cB.mismatch++; brierMlStatus = 'MISMATCH';
        pushMismatch(g.id, label, 'brierF5Ml', 'value-mismatch', sBrierMl, `away=${dBrierAway} home=${dBrierHome}`, ctx);
      }
    }
  }

  // brierF5Total — unit scale (correct) vs legacy /100 (M-203 corruption)
  let dBrierTot = null, dBrierTotLegacy = null;
  if (f5tT !== null && f5tT > 0 && haveActuals && p5o !== null) {
    const atT = (f5a + f5h) * 10;
    if (atT !== f5tT) {
      const y = atT > f5tT ? 1 : 0;
      if (p5o >= 0 && p5o <= 1) dBrierTot = b6r(p5o, y);
      dBrierTotLegacy = b6r(p5o / 100, y);
    }
  }
  const sBrierTot = num(g.brierF5Total);
  let brierTotStatus;
  {
    const cB = C.brierF5Total;
    if (sBrierTot === null && dBrierTot === null) { cB.bothNull++; brierTotStatus = 'both-null'; }
    else if (sBrierTot === null) { cB.storedNullDerivable++; brierTotStatus = 'stored-null-derivable'; pushMismatch(g.id, label, 'brierF5Total', 'stored-null-derivable', '', dBrierTot, ctx); }
    else if (dBrierTot === null) { cB.storedNotDerivable++; brierTotStatus = 'stored-not-derivable'; pushMismatch(g.id, label, 'brierF5Total', 'stored-not-derivable', sBrierTot, '', ctx); }
    else if (close(sBrierTot, dBrierTot)) { cB.match++; brierTotStatus = 'match'; }
    else if (close(sBrierTot, dBrierTotLegacy)) { cB.matchLegacyCorrupt++; brierTotStatus = 'MATCH-LEGACY-CORRUPT'; pushMismatch(g.id, label, 'brierF5Total', 'legacy-corrupt-scale', sBrierTot, dBrierTot, ctx); }
    else { cB.mismatch++; brierTotStatus = 'MISMATCH'; pushMismatch(g.id, label, 'brierF5Total', 'value-mismatch', sBrierTot, dBrierTot, ctx); }
  }

  const anyGrade = g.f5MlResult !== null || g.f5RlResult !== null || g.f5TotalResult !== null;
  if (anyGrade && g.f5BacktestRunAt === null) C.f5RunAtMissingButGraded++;

  rederivRows.push({
    gameId: g.id, gameDate: g.gameDate, matchup: label, mlbGamePk: g.mlbGamePk,
    actualF5Away: f5a, actualF5Home: f5h, actualF5Total: aTotCol,
    lsF5: lsA !== null ? `${lsA}-${lsH}` : '',
    f5AwayRunLine: g.f5AwayRunLine ?? '', f5Total: g.f5Total ?? '',
    modelF5AwayWinPct: pA, modelF5HomeWinPct: pH,
    modelF5AwayRLCoverPct: pRl, modelF5AwayScore: num(g.modelF5AwayScore), modelF5HomeScore: num(g.modelF5HomeScore),
    modelF5OverRate: p5o,
    stored_f5MlResult: g.f5MlResult ?? '', derived_f5MlResult: dMlResult ?? '', f5Ml_status: mlStatus,
    stored_f5MlCorrect: sMlCorrect, derived_f5MlCorrect: dMlCorrect,
    stored_f5RlResult: sRl ?? '', derived_f5Rl_probConv: dRlProb ?? '', derived_f5Rl_marginConv: dRlMargin ?? '', f5Rl_status: rlStatus, f5Rl_convDisagree: convDisagree ? 1 : 0,
    stored_f5RlCorrect: sRlCorrect, derived_f5RlCorrect_probConv: dRlProbCor, derived_f5RlCorrect_marginConv: dRlMarginCor,
    stored_f5TotalResult: sTot ?? '', derived_f5TotalResult: dTotResult ?? '', f5Total_status: totStatus,
    stored_f5TotalCorrect: sTotCorrect, derived_f5TotalCorrect: dTotCorrect,
    stored_brierF5Ml: sBrierMl, derived_brierF5Ml_away: dBrierAway, derived_brierF5Ml_home: dBrierHome, brierF5Ml_status: brierMlStatus,
    stored_brierF5Total: sBrierTot, derived_brierF5Total: dBrierTot, brierF5Total_status: brierTotStatus,
    f5BacktestRunAt: g.f5BacktestRunAt ?? '',
  });
}

writeCsv('f5-grader-games-rederivation.csv', Object.keys(rederivRows[0]), rederivRows);
writeCsv('f5-grader-games-mismatches.csv',
  ['gameId','matchup','field','class','stored','derived','f5Actual','f5AwayRunLine','f5Total','modelF5AwayWinPct','modelF5AwayRLCoverPct','modelF5AwayScore','modelF5HomeScore','modelF5OverRate'],
  gameMismatches);
writeCsv('f5-grader-actuals-crosscheck-issues.csv', ['gameId','matchup','check','games_value','other_value'], actualsIssues);
writeCsv('f5-grader-line-plausibility.csv', ['gameId','matchup','f5AwayRunLine','f5Total','graded_rl','graded_total'], linePlausRows);

// ─── C: mlb_game_backtest f5_* rows ──────────────────────────────────────────
const btRows = await q(`
  SELECT b.id btId, b.gameId, b.gameDate btDate, b.market, b.modelSide, b.modelProb, b.bookLine,
         b.bookOdds, b.bookNoVigProb, b.edge, b.confidencePassed, b.result, b.correct,
         b.actualAwayScore btAway, b.actualHomeScore btHome, b.quarantineReason, b.voidReason,
         b.auditVersion,
         g.actualF5AwayScore gF5A, g.actualF5HomeScore gF5H, g.f5Total gF5Total,
         g.actualAwayScore gFgA, g.actualHomeScore gFgH
  FROM mlb_game_backtest b
  JOIN games g ON g.id = b.gameId
  WHERE b.market LIKE 'f5\\_%'
    AND g.sport='MLB' AND g.gameStatus='final' AND g.gameDate BETWEEN ? AND ?
  ORDER BY b.gameId, b.market`, [DATE_LO, DATE_HI]);
console.error(`[backtest] ${btRows.length} f5_* rows in population`);

const btOut = [], btMismatches = [];
const btCounters = {};
const bump = (k) => { btCounters[k] = (btCounters[k] ?? 0) + 1; };

for (const r of btRows) {
  const f5a = num(r.gF5A), f5h = num(r.gF5H);
  const haveActuals = f5a !== null && f5h !== null;
  const market = r.market, stored = r.result, storedCorrect = num(r.correct), conf = num(r.confidencePassed);
  let derivedOutcome = null, lineUsed = null;
  if (haveActuals) {
    const marginT = (f5h - f5a) * 10; // home - away, tenths
    if (market === 'f5_ml_home') derivedOutcome = f5h === f5a ? 'PUSH' : (f5h > f5a ? 'WIN' : 'LOSS');
    else if (market === 'f5_ml_away') derivedOutcome = f5h === f5a ? 'PUSH' : (f5a > f5h ? 'WIN' : 'LOSS');
    else if (market === 'f5_rl_home' || market === 'f5_rl_away') {
      // Three writer eras: live + audit-backfill-20260725 hardcode home -0.5 / away +0.5
      // (grade = margin rule); v2026-full-audit-1.0 recorded the real FD line per side
      // (signs vary, alternate lines exist). Grade against the row's recorded line,
      // falling back to the canonical hardcode when bookLine is null.
      const lineN = num(r.bookLine) !== null ? num(r.bookLine) : (market === 'f5_rl_home' ? -0.5 : 0.5);
      lineUsed = lineN;
      const sideMarginT = market === 'f5_rl_home' ? (f5h - f5a) * 10 : (f5a - f5h) * 10;
      const coverT = sideMarginT + Math.round(lineN * 10);
      derivedOutcome = coverT === 0 ? 'PUSH' : coverT > 0 ? 'WIN' : 'LOSS';
    }
    else if (market === 'f5_over' || market === 'f5_under') {
      lineUsed = num(r.bookLine) !== null ? num(r.bookLine) : num(r.gF5Total);
      if (lineUsed !== null) {
        const atT = (f5a + f5h) * 10, lT = Math.round(lineUsed * 10);
        derivedOutcome = atT === lT ? 'PUSH' : ((market === 'f5_over') === (atT > lT) ? 'WIN' : 'LOSS');
      }
    }
  }
  const isActioned = stored === 'WIN' || stored === 'LOSS' || stored === 'PUSH';
  let status = 'ok', note = '';
  if (isActioned) {
    if (!haveActuals) status = 'DEFECT:actioned-no-actuals';
    else if (derivedOutcome === null) status = 'DEFECT:actioned-no-line';
    else if (stored !== derivedOutcome) { status = 'DEFECT:result-mismatch'; note = `derived=${derivedOutcome}`; }
    const expCorrect = stored === 'WIN' ? 1 : stored === 'LOSS' ? 0 : null;
    if (status === 'ok' && storedCorrect !== expCorrect) { status = 'DEFECT:correct-mismatch'; note = `expected correct=${expCorrect}`; }
    if (status === 'ok' && conf !== 1) status = 'WARN:actioned-conf0';
  } else if (stored === 'NO_ACTION') {
    if (storedCorrect !== null) status = 'DEFECT:noaction-correct-set';
    else if (conf !== 0) status = 'WARN:noaction-conf1';
  } else if (stored === 'MISSING_DATA') {
    if (haveActuals && derivedOutcome !== null) { status = 'INFO:missingdata-now-derivable'; note = `derived=${derivedOutcome}`; }
    if (storedCorrect !== null) status = 'DEFECT:missingdata-correct-set';
  } else if (stored === 'QUARANTINED') {
    if (!r.quarantineReason) status = 'DEFECT:quarantined-no-reason';
    if (storedCorrect !== null) status = 'DEFECT:quarantined-correct-set';
  } else if (stored === 'VOID') {
    if (!r.voidReason) status = 'DEFECT:void-no-reason';
    if (storedCorrect !== null) status = 'DEFECT:void-correct-set';
  } else status = 'DEFECT:unknown-result-value';

  // stale FG actuals embedded in the backtest row (writer stores FG scores)
  const btA = num(r.btAway), btH = num(r.btHome);
  const gFgA = num(r.gFgA), gFgH = num(r.gFgH);
  let staleActuals = '';
  if (gFgA !== null && gFgH !== null && btA !== null && btH !== null && (btA !== gFgA || btH !== gFgH)) {
    staleActuals = `row=${btA}-${btH} games=${gFgA}-${gFgH}`;
    if (status === 'ok') status = 'DEFECT:stale-row-actuals';
  }

  // informational: edge recompute + threshold consistency
  const mp = num(r.modelProb), nv = num(r.bookNoVigProb), e = num(r.edge);
  let edgeCheck = '';
  if (mp !== null && nv !== null && e !== null && Math.abs(e - (mp - nv)) > 0.0051) {
    edgeCheck = `stored=${e} recomputed=${(mp - nv).toFixed(4)}`;
    bump('edge-outlier:' + market);
  }
  let threshCheck = '';
  if (stored === 'NO_ACTION' || isActioned) {
    if (market === 'f5_over' || market === 'f5_under') {
      if (mp !== null) {
        const shouldAct = mp >= 0.60;
        if (shouldAct !== isActioned) { threshCheck = `p=${mp} actioned=${isActioned}`; bump('threshold-inconsistent:' + market); }
      }
    } else if (e !== null) {
      const shouldAct = e >= 0.05;
      if (shouldAct !== isActioned) { threshCheck = `edge=${e} thresh=0.05 actioned=${isActioned}`; bump('threshold-inconsistent:' + market); }
    } else if (isActioned) { threshCheck = 'actioned-with-null-edge'; bump('threshold-inconsistent:' + market); }
  }

  bump(`result:${market}:${stored}`);
  bump(`status:${status.split(':')[0]}`);
  if (status !== 'ok') bump(`statusDetail:${status}`);

  const row = {
    btId: r.btId, gameId: r.gameId, gameDate: r.btDate, market, modelSide: r.modelSide,
    stored_result: stored, derived_outcome: derivedOutcome, stored_correct: storedCorrect,
    confidencePassed: conf, modelProb: mp, bookNoVigProb: nv, edge: e, bookLine: r.bookLine,
    lineUsed, f5_actual: haveActuals ? `${f5a}-${f5h}` : '',
    staleActuals, edgeCheck, threshCheck, status,
    quarantineReason: r.quarantineReason ? String(r.quarantineReason).slice(0, 80) : '',
    voidReason: r.voidReason ? String(r.voidReason).slice(0, 80) : '',
    auditVersion: r.auditVersion ?? '', note,
  };
  btOut.push(row);
  if (status.startsWith('DEFECT') || status.startsWith('WARN')) btMismatches.push(row);
}
writeCsv('f5-grader-backtest-rederivation.csv', Object.keys(btOut[0]), btOut);
writeCsv('f5-grader-backtest-mismatches.csv', Object.keys(btOut[0]), btMismatches);

// coverage + duplicates
const mlMarkets = ['f5_ml_home', 'f5_ml_away', 'f5_rl_home', 'f5_rl_away'];
const byGame = new Map();
for (const r of btRows) {
  if (!byGame.has(r.gameId)) byGame.set(r.gameId, []);
  byGame.get(r.gameId).push(r.market);
}
const uncovered = games.filter((g) => !byGame.has(g.id)).map((g) => ({
  gameId: g.id, gameDate: g.gameDate, matchup: `${g.awayTeam}@${g.homeTeam}` }));
const partialCoverage = [];
for (const [gid, mkts] of byGame) {
  const missing = mlMarkets.filter((m) => !mkts.includes(m));
  if (missing.length) partialCoverage.push({ gameId: gid, missing: missing.join(' ') });
}
const dupCount = {};
for (const r of btRows) { const k = r.gameId + ':' + r.market; dupCount[k] = (dupCount[k] ?? 0) + 1; }
const dups = Object.entries(dupCount).filter(([, n]) => n > 1);
writeCsv('f5-grader-backtest-uncovered-games.csv', ['gameId','gameDate','matchup'], uncovered);

// ─── D: mlb_replay_grades f5_* reconciliation (snapshot) ─────────────────────
const rgSnapshot = await q(`SELECT market, source, modelVersion, COUNT(*) n
  FROM mlb_replay_grades WHERE market IN ('f5_ml','f5_rl','f5_total')
  GROUP BY market, source, modelVersion ORDER BY market, source, modelVersion`);
const rgRows = await q(`
  SELECT r.id rgId, r.gameId, r.gameDate rgDate, r.market, r.source, r.modelVersion,
         r.pick, r.prob, r.projValue, r.line, r.actual, r.result, r.correct, r.brier, r.signedError,
         g.actualF5AwayScore gF5A, g.actualF5HomeScore gF5H, g.actualF5Total gF5T,
         g.modelF5AwayWinPct, g.modelF5AwayRLCoverPct, g.modelF5OverRate, g.modelF5Total gModelF5Total,
         g.f5AwayRunLine gRl, g.f5Total gF5Line,
         l.f5AwayRuns lsF5A, l.f5HomeRuns lsF5H
  FROM mlb_replay_grades r
  JOIN games g ON g.id = r.gameId
  LEFT JOIN mlb_replay_linescores l ON l.gameId = g.id
  WHERE r.market IN ('f5_ml','f5_rl','f5_total')
  ORDER BY r.market, r.source, r.modelVersion, r.gameId`);
console.error(`[replay-grades] ${rgRows.length} f5_* rows at snapshot`);

const rgOut = [], rgMismatches = [];
const rgCounters = {};
const rbump = (k) => { rgCounters[k] = (rgCounters[k] ?? 0) + 1; };

for (const r of rgRows) {
  // actuals: games first, linescores fallback (matches calibrate_and_grade.actual_f5)
  let f5a = num(r.gF5A), f5h = num(r.gF5H);
  if (f5a === null || f5h === null) { f5a = num(r.lsF5A); f5h = num(r.lsF5H); }
  const haveActuals = f5a !== null && f5h !== null;
  const market = r.market, src = r.source, mv = r.modelVersion;
  const pick = r.pick ?? null, prob = num(r.prob), line = num(r.line);
  const storedResult = r.result ?? null, storedCorrect = num(r.correct), storedBrier = num(r.brier);
  const issues = [];

  if (!haveActuals) {
    issues.push('graded-row-no-actuals');
  } else {
    let actualSide = null, y = null, expActualField = null;
    if (market === 'f5_ml') {
      actualSide = f5a > f5h ? 'AWAY' : f5a < f5h ? 'HOME' : 'PUSH';
      expActualField = actualSide === 'PUSH' ? 'TIE' : actualSide;
      y = actualSide === 'PUSH' ? null : (actualSide === 'AWAY' ? 1 : 0);
    } else if (market === 'f5_rl') {
      if (line === null) issues.push('rl-null-line');
      else {
        const coverT = (f5a - f5h) * 10 + Math.round(line * 10);
        actualSide = coverT > 0 ? 'AWAY' : coverT < 0 ? 'HOME' : 'PUSH';
        expActualField = actualSide;
        y = actualSide === 'PUSH' ? null : (actualSide === 'AWAY' ? 1 : 0);
      }
    } else { // f5_total
      const at5 = num(r.gF5T) !== null ? num(r.gF5T) : f5a + f5h;
      if (line === null) issues.push('total-null-line');
      else {
        const atT = Math.round(at5 * 10), lT = Math.round(line * 10);
        actualSide = atT > lT ? 'OVER' : atT < lT ? 'UNDER' : 'PUSH';
        expActualField = String(at5);
        y = actualSide === 'PUSH' ? null : (actualSide === 'OVER' ? 1 : 0);
      }
    }
    if (actualSide !== null) {
      // stored actual field
      const sAct = r.actual === null || r.actual === undefined ? null : String(r.actual);
      if (market === 'f5_total') {
        if (sAct === null || num(sAct) === null || num(sAct) !== num(expActualField)) issues.push(`actual-field:stored=${sAct} exp=${expActualField}`);
      } else if (sAct !== expActualField) issues.push(`actual-field:stored=${sAct} exp=${expActualField}`);
      // result/correct via side_result(pick, actualSide)
      let expResult = null, expCorrect = null;
      if (actualSide === 'PUSH') { expResult = 'PUSH'; expCorrect = null; }
      else if (pick !== null) { expResult = pick === actualSide ? 'WIN' : 'LOSS'; expCorrect = pick === actualSide ? 1 : 0; }
      if (String(storedResult) !== String(expResult)) issues.push(`result:stored=${storedResult} exp=${expResult}`);
      if (!(storedCorrect === expCorrect)) issues.push(`correct:stored=${storedCorrect} exp=${expCorrect}`);
      // brier from stored prob
      const expBrier = prob !== null && y !== null ? b6r(prob, y) : null;
      if (expBrier === null && storedBrier !== null) issues.push(`brier:stored=${storedBrier} exp=null`);
      else if (expBrier !== null && storedBrier === null) issues.push(`brier:stored=null exp=${expBrier}`);
      else if (expBrier !== null && !close(storedBrier, expBrier, 5.1e-6)) issues.push(`brier:stored=${storedBrier} exp=${expBrier}`);
      // pick vs prob coherence (boundary |p-0.5|<=1e-5 tolerated)
      if (pick !== null && prob !== null && Math.abs(prob - 0.5) > 1e-5) {
        const expPick = market === 'f5_total' ? (prob > 0.5 ? 'OVER' : 'UNDER') : (prob > 0.5 ? 'AWAY' : 'HOME');
        if (pick !== expPick) issues.push(`pick-prob-incoherent:pick=${pick} prob=${prob}`);
      }
      // signedError for f5_total
      if (market === 'f5_total') {
        const pv = num(r.projValue), se = num(r.signedError);
        if (pv !== null && haveActuals) {
          const at5 = num(r.gF5T) !== null ? num(r.gF5T) : f5a + f5h;
          const expSe = +(pv - at5).toFixed(3);
          if (se === null || Math.abs(se - expSe) > 0.0015) issues.push(`signedError:stored=${se} exp=${expSe}`);
        }
      }
    }
  }
  // live source: full re-derivation of prob + line from games row
  if (src === 'live_pregame') {
    if (market === 'f5_ml') {
      const expProb = num(r.modelF5AwayWinPct) !== null ? +(num(r.modelF5AwayWinPct) / 100).toFixed(5) : null;
      if (!(prob === null && expProb === null) && !close(prob, expProb, 1e-5)) issues.push(`live-prob:stored=${prob} exp=${expProb}`);
    } else if (market === 'f5_rl') {
      const expProb = num(r.modelF5AwayRLCoverPct) !== null ? +(num(r.modelF5AwayRLCoverPct) / 100).toFixed(5) : null;
      if (!(prob === null && expProb === null) && !close(prob, expProb, 1e-5)) issues.push(`live-prob:stored=${prob} exp=${expProb}`);
      const expLine = num(r.gRl);
      if (!(line === null && expLine === null) && !close(line, expLine, 1e-9)) issues.push(`live-line:stored=${line} exp=${expLine}`);
    } else {
      const expProb = num(r.modelF5OverRate) !== null ? +num(r.modelF5OverRate).toFixed(5) : null;
      if (!(prob === null && expProb === null) && !close(prob, expProb, 1e-5)) issues.push(`live-prob:stored=${prob} exp=${expProb}`);
      const expLine = num(r.gF5Line);
      if (!(line === null && expLine === null) && !close(line, expLine, 1e-9)) issues.push(`live-line:stored=${line} exp=${expLine}`);
      const expProj = num(r.gModelF5Total);
      const pv = num(r.projValue);
      if (!(pv === null && expProj === null) && !close(pv, expProj, 1.1e-4)) issues.push(`live-projValue:stored=${pv} exp=${expProj}`);
    }
  }

  const status = issues.length ? 'DEFECT' : 'ok';
  rbump(`rows:${market}:${src}:${mv}`);
  rbump(`status:${market}:${src}:${status}`);
  for (const iss of issues) rbump(`issue:${market}:${src}:${iss.split(':')[0]}`);
  const row = {
    rgId: r.rgId, gameId: r.gameId, gameDate: r.rgDate, market, source: src, modelVersion: mv,
    pick, prob, projValue: num(r.projValue), line: r.line ?? '', actual: r.actual ?? '',
    stored_result: storedResult, stored_correct: storedCorrect, stored_brier: storedBrier,
    stored_signedError: num(r.signedError),
    f5_actual: haveActuals ? `${f5a}-${f5h}` : '', issues: issues.join('; '), status,
  };
  rgOut.push(row);
  if (status === 'DEFECT') rgMismatches.push(row);
}
writeCsv('f5-grader-replay-grades-rederivation.csv', Object.keys(rgOut[0]), rgOut);
writeCsv('f5-grader-replay-grades-mismatches.csv', Object.keys(rgOut[0]), rgMismatches);

// replay-grade duplicates on (gameId, market, source, modelVersion)
const rgDupCount = {};
for (const r of rgRows) { const k = [r.gameId, r.market, r.source, r.modelVersion].join(':'); rgDupCount[k] = (rgDupCount[k] ?? 0) + 1; }
const rgDups = Object.entries(rgDupCount).filter(([, n]) => n > 1);

// ─── Summary ─────────────────────────────────────────────────────────────────
const summary = {
  ranAt: new Date().toISOString(),
  window: [DATE_LO, DATE_HI],
  population: games.length,
  gamesCounters: C,
  gamesMismatchRows: gameMismatches.length,
  actualsIssueRows: actualsIssues.length,
  linePlausibilityRows: linePlausRows.length,
  backtest: {
    rows: btRows.length,
    coveredGames: byGame.size,
    uncoveredGames: uncovered.length,
    partialMlRlCoverage: partialCoverage.length,
    duplicates: dups,
    counters: btCounters,
    mismatchRows: btMismatches.length,
  },
  replayGrades: {
    snapshotAtRun: rgSnapshot,
    rowsGraded: rgRows.length,
    duplicates: rgDups,
    counters: rgCounters,
    mismatchRows: rgMismatches.length,
  },
};
fs.writeFileSync(path.join(OUTDIR, 'f5-grader-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await conn.end();
