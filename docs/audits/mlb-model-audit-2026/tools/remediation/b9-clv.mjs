#!/usr/bin/env node
// Batch B9 (Phase 6): CLV backfill for mlb_game_backtest from in-repo closing sources.
// Definition (documented here and in the master report):
//   clv = noVigProb(closing pair, bet side) - bookNoVigProb(at projection, bet side)
//   Positive = the model's side beat the closing market.
// Sources, in preference order per game:
//   A. mlb_schedule_history dkClosing* (locked DK closing lines, from 2026-04-11)
//   B. proxy: last odds_history snapshot before first pitch (labeled proxy in clv-coverage.csv;
//      measured mean age ~60 min before start)
// Rules: price CLV only when the closing line equals the row's line (totals/RL); line-moved and
// no-source rows stay null with the reason recorded in the coverage artifact.
// Markets covered: fg_ml_*, fg_rl_*, fg_over/under. F5/NRFI/props have no closing archive
// in-repo — reported as coverage gaps.
import { connect, execFlag } from './_db.mjs';
import fs from 'fs';

const AS_OF = '2026-07-25';
const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];

const parseOdds = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toUpperCase();
  if (['EVEN', 'EV', 'PK'].includes(t)) return 100;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null;
};
const imp = (o) => (o === null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const noVig = (a, b) => (a !== null && b !== null && a + b > 0 ? a / (a + b) : null);

// closing sources per game
const sched = new Map();
for (const r of await q(
  `SELECT s.anGameId, s.gameDate, s.awayAbbr, s.homeAbbr, s.startTimeUtc,
          s.dkClosingAwayML, s.dkClosingHomeML, s.dkClosingTotal, s.dkClosingOverOdds, s.dkClosingUnderOdds,
          s.dkClosingAwayRunLine, s.dkClosingAwayRunLineOdds, s.dkClosingHomeRunLineOdds, s.closingLineLockedAt
   FROM mlb_schedule_history s WHERE s.game_type='regular_season' AND s.gameDate>='2026-03-01' AND s.gameDate<=?`, [AS_OF]
)) sched.set(`${r.gameDate}|${r.awayAbbr}|${r.homeAbbr}`, r);

const games = await q(
  `SELECT id, gameDate, awayTeam, homeTeam FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-25' AND gameDate<=?`, [AS_OF]);

// proxy closing: last pre-start odds snapshot per game
const proxy = new Map();
for (const r of await q(
  `SELECT o.gameId, o.awayML, o.homeML, o.total, o.overOdds, o.underOdds, o.awaySpread, o.awaySpreadOdds, o.homeSpreadOdds,
          o.scrapedAt
   FROM odds_history o
   JOIN (SELECT o2.gameId gid, MAX(o2.scrapedAt) mx FROM odds_history o2
         JOIN games g2 ON g2.id=o2.gameId
         JOIN mlb_schedule_history s2 ON s2.gameDate=g2.gameDate AND s2.awayAbbr=g2.awayTeam AND s2.homeAbbr=g2.homeTeam AND s2.gameStatus='complete'
         WHERE o2.sport='MLB' AND g2.sport='MLB' AND g2.gameDate>='2026-03-25' AND g2.gameDate<=?
           AND o2.scrapedAt < UNIX_TIMESTAMP(REPLACE(REPLACE(s2.startTimeUtc,'T',' '),'.000Z',''))*1000
         GROUP BY o2.gameId) last ON last.gid = o.gameId AND last.mx = o.scrapedAt`, [AS_OF]
)) proxy.set(r.gameId, r);

const rows = await q(
  `SELECT b.id, b.gameId, b.market, b.bookLine, b.bookNoVigProb, b.clv, g.gameDate, g.awayTeam, g.homeTeam
   FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId
   WHERE g.sport='MLB' AND g.gameDate>='2026-03-25' AND g.gameDate<=? AND b.market LIKE 'fg_%' AND b.clv IS NULL`, [AS_OF]);

const updates = [];
const coverage = [];
for (const b of rows) {
  const s = sched.get(`${b.gameDate}|${b.awayTeam}|${b.homeTeam}`);
  const p = proxy.get(b.gameId);
  let src = null, closeSide = null, closeOpp = null, closeLine = null;
  const pick = (dkA, dkB, pxA, pxB) => {
    if (s && parseOdds(dkA) !== null && parseOdds(dkB) !== null) { src = 'dk_closing'; return [parseOdds(dkA), parseOdds(dkB)]; }
    if (p && parseOdds(pxA) !== null && parseOdds(pxB) !== null) { src = 'proxy_snapshot'; return [parseOdds(pxA), parseOdds(pxB)]; }
    return [null, null];
  };
  if (b.market === 'fg_ml_away') [closeSide, closeOpp] = pick(s?.dkClosingAwayML, s?.dkClosingHomeML, p?.awayML, p?.homeML);
  else if (b.market === 'fg_ml_home') [closeOpp, closeSide] = pick(s?.dkClosingAwayML, s?.dkClosingHomeML, p?.awayML, p?.homeML);
  else if (b.market === 'fg_over' || b.market === 'fg_under') {
    const closeTotal = s?.dkClosingTotal !== null && s?.dkClosingTotal !== undefined ? Number(s.dkClosingTotal) : (p?.total !== null && p?.total !== undefined ? Number(p.total) : null);
    if (closeTotal !== null && b.bookLine !== null && Number(b.bookLine) === closeTotal) {
      const [ov, un] = pick(s?.dkClosingOverOdds, s?.dkClosingUnderOdds, p?.overOdds, p?.underOdds);
      if (b.market === 'fg_over') { closeSide = ov; closeOpp = un; } else { closeSide = un; closeOpp = ov; }
      closeLine = closeTotal;
    } else if (closeTotal !== null) { coverage.push([b.gameId, b.market, 'line_moved', `${b.bookLine}->${closeTotal}`]); continue; }
  } else if (b.market === 'fg_rl_away' || b.market === 'fg_rl_home') {
    const closeRl = s?.dkClosingAwayRunLine !== null && s?.dkClosingAwayRunLine !== undefined ? Number(s.dkClosingAwayRunLine) : (p?.awaySpread !== null && p?.awaySpread !== undefined ? Number(p.awaySpread) : null);
    const rowLine = b.bookLine !== null ? Number(String(b.bookLine).replace('+', '')) : null;
    if (closeRl !== null && rowLine !== null && Math.abs(Math.abs(closeRl) - Math.abs(rowLine)) < 0.01) {
      const [a, h] = pick(s?.dkClosingAwayRunLineOdds, s?.dkClosingHomeRunLineOdds, p?.awaySpreadOdds, p?.homeSpreadOdds);
      if (b.market === 'fg_rl_away') { closeSide = a; closeOpp = h; } else { closeSide = h; closeOpp = a; }
    } else if (closeRl !== null) { coverage.push([b.gameId, b.market, 'line_moved', `${b.bookLine}->${closeRl}`]); continue; }
  }
  if (closeSide === null || closeOpp === null || b.bookNoVigProb === null) {
    coverage.push([b.gameId, b.market, src ? 'incomplete_pair' : 'no_source', '']);
    continue;
  }
  const closeNv = noVig(imp(closeSide), imp(closeOpp));
  if (closeNv === null) { coverage.push([b.gameId, b.market, 'novig_fail', '']); continue; }
  const clv = +(closeNv - Number(b.bookNoVigProb)).toFixed(4);
  updates.push({ id: b.id, clv, closingOdds: String(closeSide), closingOddsOpposite: String(closeOpp) });
  coverage.push([b.gameId, b.market, src, String(clv)]);
}
console.log(`CLV computable: ${updates.length} of ${rows.length} fg rows (${coverage.filter((c) => c[2] === 'dk_closing').length} dk, ${coverage.filter((c) => c[2] === 'proxy_snapshot').length} proxy)`);

if (EXECUTE) {
  for (let i = 0; i < updates.length; i += 300) {
    const chunk = updates.slice(i, i + 300);
    const ids = chunk.map((u) => u.id);
    const caseFor = (col) => `\`${col}\` = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} ELSE \`${col}\` END`;
    const params = [];
    for (const col of ['clv', 'closingOdds', 'closingOddsOpposite']) for (const u of chunk) params.push(u.id, u[col]);
    params.push(...ids);
    await conn.query(
      `UPDATE mlb_game_backtest SET ${caseFor('clv')}, ${caseFor('closingOdds')}, ${caseFor('closingOddsOpposite')} WHERE id IN (${ids.map(() => '?').join(',')})`,
      params);
  }
  fs.writeFileSync(new URL('../../census/clv-coverage.csv', import.meta.url).pathname,
    'gameId,market,source_or_reason,clv\n' + coverage.map((c) => c.join(',')).join('\n') + '\n');
  const [[v]] = [await q(`SELECT COUNT(*) n, SUM(clv IS NOT NULL) withClv FROM mlb_game_backtest b JOIN games g ON g.id=b.gameId WHERE g.sport='MLB' AND b.market LIKE 'fg_%' AND g.gameDate>='2026-03-25' AND g.gameDate<=?`, [AS_OF])];
  console.log(`post: fg rows=${v.n}, with clv=${v.withClv}`);
}
await conn.end();
