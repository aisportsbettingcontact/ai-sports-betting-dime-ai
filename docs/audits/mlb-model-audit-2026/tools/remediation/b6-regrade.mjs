#!/usr/bin/env node
// Batch B6: season-wide regrade of every stored grade from raw values (live_pregame
// projections + repaired actuals). Replaces the defective stored semantics:
//   - old f5MlCorrect graded "away team won F5" (M-101) -> now grades the MODEL'S pick
//   - old brierNrfi/brierF5Total divided 0-1 probabilities by 100 (M-203) -> correct scales
//   - pushes/ties -> result 'PUSH', correct NULL (excluded from hit rates)
// Rules (identical to GRADING-REPORT "Grading rules", stated there before any metric was run):
//   FG ML pick = modelAwayWinPct>50 ? AWAY : HOME; result vs actual winner
//   FG RL pick from model margin + awayRunLine; F5 analogous with modelF5AwayRLCoverPct
//   FG TOTAL pick = modelOverRate>50; F5 TOTAL pick = modelF5OverRate>0.5 (0-1 scale!)
//   NRFI pick = modelPNrfi>0.5 ? NRFI : YRFI vs actualNrfiBinary
//   K prop: actual side = actualKs vs bookLine; correct = (pOver>pUnder side) == actual side
//   K modelError = kProj - actualKs (explicit definition, was undocumented)
//   HR prop: backtestResult = WIN/LOSS for actioned verdicts (bet always the over side),
//            NO_ACTION otherwise; modelCorrect = (modelPHr>=0.5) == (actualHr>=1)
// games.*BacktestRunAt is stamped with the regrade time (this is a grading timestamp, not a
// projection timestamp — projections and modelRunAt are untouched).
import { connect, execFlag } from './_db.mjs';

const AS_OF = '2026-07-25';
const NOW = Date.now();
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const brier = (p, y) => +((p - y) ** 2).toFixed(6);

// ---------- games regrade ----------
const games = await q(
  `SELECT id, modelAwayWinPct, modelHomeWinPct, modelAwayScore, modelHomeScore, modelOverRate,
          modelF5AwayWinPct, modelF5AwayRLCoverPct, modelF5OverRate, modelPNrfi,
          awayRunLine, bookTotal, f5AwayRunLine, f5Total,
          actualAwayScore, actualHomeScore, actualFgTotal, actualF5AwayScore, actualF5HomeScore,
          actualF5Total, actualNrfiBinary
   FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-01' AND gameDate<=?
     AND actualAwayScore IS NOT NULL`, [AS_OF]);

const gUpdates = [];
for (const g of games) {
  const set = {};
  const aA = num(g.actualAwayScore), aH = num(g.actualHomeScore);
  // FG ML
  const pAway = num(g.modelAwayWinPct);
  if (pAway !== null) {
    const pick = pAway > 50 ? 'AWAY' : 'HOME';
    const winner = aA > aH ? 'AWAY' : 'HOME';
    set.fgMlResult = pick === winner ? 'WIN' : 'LOSS';
    set.fgMlCorrect = pick === winner ? 1 : 0;
    set.brierFgMl = brier(pAway / 100, aA > aH ? 1 : 0);
  }
  // FG RL
  const rl = num(g.awayRunLine);
  if (g.modelAwayScore !== null && rl !== null) {
    const margin = num(g.modelAwayScore) - num(g.modelHomeScore);
    const pick = margin + rl > 0 ? 'AWAY' : 'HOME';
    const cover = aA + rl - aH;
    if (cover === 0) { set.fgRlResult = 'PUSH'; set.fgRlCorrect = null; }
    else {
      const covered = cover > 0 ? 'AWAY' : 'HOME';
      set.fgRlResult = pick === covered ? 'WIN' : 'LOSS';
      set.fgRlCorrect = pick === covered ? 1 : 0;
    }
  }
  // FG TOTAL
  const pOver = num(g.modelOverRate), bt = num(g.bookTotal), at = num(g.actualFgTotal) ?? aA + aH;
  if (pOver !== null && bt !== null) {
    const pick = pOver > 50 ? 'OVER' : 'UNDER';
    if (at === bt) { set.fgTotalResult = 'PUSH'; set.fgTotalCorrect = null; }
    else {
      const side = at > bt ? 'OVER' : 'UNDER';
      set.fgTotalResult = pick === side ? 'WIN' : 'LOSS';
      set.fgTotalCorrect = pick === side ? 1 : 0;
      set.brierFgTotal = brier(pOver / 100, side === 'OVER' ? 1 : 0);
    }
  }
  // F5
  const f5a = num(g.actualF5AwayScore), f5h = num(g.actualF5HomeScore);
  if (f5a !== null && f5h !== null) {
    const p5 = num(g.modelF5AwayWinPct);
    if (p5 !== null) {
      const pick = p5 > 50 ? 'AWAY' : 'HOME';
      if (f5a === f5h) { set.f5MlResult = 'PUSH'; set.f5MlCorrect = null; }
      else {
        const w = f5a > f5h ? 'AWAY' : 'HOME';
        set.f5MlResult = pick === w ? 'WIN' : 'LOSS';
        set.f5MlCorrect = pick === w ? 1 : 0;
        set.brierF5Ml = brier(p5 / 100, w === 'AWAY' ? 1 : 0);
      }
    }
    const pRl = num(g.modelF5AwayRLCoverPct), frl = num(g.f5AwayRunLine);
    if (pRl !== null && frl !== null) {
      const pick = pRl > 50 ? 'AWAY' : 'HOME';
      const cover = f5a + frl - f5h;
      if (cover === 0) { set.f5RlResult = 'PUSH'; set.f5RlCorrect = null; }
      else {
        const c = cover > 0 ? 'AWAY' : 'HOME';
        set.f5RlResult = pick === c ? 'WIN' : 'LOSS';
        set.f5RlCorrect = pick === c ? 1 : 0;
      }
    }
    const p5o = num(g.modelF5OverRate), f5t = num(g.f5Total), a5t = num(g.actualF5Total) ?? f5a + f5h;
    if (p5o !== null && f5t !== null) {
      const pick = p5o > 0.5 ? 'OVER' : 'UNDER';
      if (a5t === f5t) { set.f5TotalResult = 'PUSH'; set.f5TotalCorrect = null; }
      else {
        const side = a5t > f5t ? 'OVER' : 'UNDER';
        set.f5TotalResult = pick === side ? 'WIN' : 'LOSS';
        set.f5TotalCorrect = pick === side ? 1 : 0;
        set.brierF5Total = brier(p5o, side === 'OVER' ? 1 : 0);
      }
    }
    if (Object.keys(set).some((k) => k.startsWith('f5'))) set.f5BacktestRunAt = NOW;
  }
  // NRFI
  const pN = num(g.modelPNrfi), yN = num(g.actualNrfiBinary);
  if (pN !== null && yN !== null) {
    const pick = pN > 0.5 ? 'NRFI' : 'YRFI';
    const actual = yN === 1 ? 'NRFI' : 'YRFI';
    set.nrfiBacktestResult = pick === actual ? 'WIN' : 'LOSS';
    set.nrfiCorrect = pick === actual ? 1 : 0;
    set.brierNrfi = brier(pN, yN);
    set.nrfiBacktestRunAt = NOW;
  }
  if (set.fgMlResult || set.fgTotalResult || set.fgRlResult) set.fgBacktestRunAt = NOW;
  if (Object.keys(set).length) gUpdates.push({ id: g.id, set });
}
console.log(`games regrade: ${gUpdates.length} rows planned (of ${games.length} finals with actuals)`);

// ---------- K props regrade ----------
const kProps = await q(
  `SELECT p.id, p.kProj, p.bookLine, p.pOver, p.pUnder, p.actualKs
   FROM mlb_strikeout_props p JOIN games g ON g.id=p.gameId
   WHERE g.gameStatus='final' AND g.gameDate>='2026-03-01' AND g.gameDate<=? AND p.actualKs IS NOT NULL
     AND p.bookLine IS NOT NULL AND p.kProj IS NOT NULL`, [AS_OF]);
const kUpdates = [];
for (const p of kProps) {
  const proj = num(p.kProj), line = num(p.bookLine), aK = num(p.actualKs);
  const pO = num(p.pOver), pU = num(p.pUnder);
  const set = { modelError: +(proj - aK).toFixed(2), backtestRunAt: NOW };
  if (aK === line) { set.backtestResult = 'PUSH'; set.modelCorrect = null; }
  else {
    const side = aK > line ? 'OVER' : 'UNDER';
    set.backtestResult = side;
    if (pO !== null && pU !== null) set.modelCorrect = (pO > pU ? 'OVER' : 'UNDER') === side ? 1 : 0;
    else set.modelCorrect = (proj > line ? 'OVER' : 'UNDER') === side ? 1 : 0;
  }
  kUpdates.push({ id: p.id, set });
}
console.log(`K props regrade: ${kUpdates.length} rows planned`);

// ---------- HR props regrade ----------
const hrProps = await q(
  `SELECT p.id, p.modelPHr, p.verdict, p.actualHr
   FROM mlb_hr_props p JOIN games g ON g.id=p.gameId
   WHERE g.gameStatus='final' AND g.gameDate>='2026-03-01' AND g.gameDate<=? AND p.actualHr IS NOT NULL
     AND p.modelPHr IS NOT NULL`, [AS_OF]);
const hrUpdates = [];
for (const p of hrProps) {
  const pHr = num(p.modelPHr), hit = num(p.actualHr) >= 1;
  const actionable = p.verdict && !['PASS', 'NO_ACTION', 'NO ACTION'].includes(String(p.verdict).toUpperCase());
  hrUpdates.push({
    id: p.id,
    set: {
      backtestResult: actionable ? (hit ? 'WIN' : 'LOSS') : 'NO_ACTION',
      modelCorrect: (pHr >= 0.5) === hit ? 1 : 0,
      backtestRunAt: NOW,
    },
  });
}
console.log(`HR props regrade: ${hrUpdates.length} rows planned`);

if (EXECUTE) {
  async function applyChunked(table, updates) {
    await conn.beginTransaction();
    try {
      for (const u of updates) {
        const cols = Object.keys(u.set).map((c) => `\`${c}\`=?`).join(', ');
        await conn.query(`UPDATE \`${table}\` SET ${cols} WHERE id=?`, [...Object.values(u.set), u.id]);
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; }
    console.log(`applied ${updates.length} updates to ${table}`);
  }
  await applyChunked('games', gUpdates);
  await applyChunked('mlb_strikeout_props', kUpdates);
  await applyChunked('mlb_hr_props', hrUpdates);
  const [v] = await q(
    `SELECT SUM(fgMlCorrect IS NOT NULL) fgMl, SUM(fgTotalCorrect IS NOT NULL OR fgTotalResult='PUSH') fgTot,
            SUM(f5MlCorrect IS NOT NULL OR f5MlResult='PUSH') f5Ml, SUM(nrfiCorrect IS NOT NULL) nrfi,
            SUM(brierNrfi > 0.9) nrfiBrierInsane
     FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-01' AND gameDate<=?`, [AS_OF]);
  console.log(`post-state graded: fgMl=${v.fgMl} fgTot=${v.fgTot} f5Ml=${v.f5Ml} nrfi=${v.nrfi} (brierNrfi>0.9: ${v.nrfiBrierInsane})`);
}
await conn.end();
