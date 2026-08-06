#!/usr/bin/env node
// GRANULAR AUDIT — FULLGAME / EVALUATOR
// Full-population per-game evaluation ledger + metric suite for the FG markets
// (ML / RL / TOTAL) across series: live (games table), p1 (wf-19288f01-p1),
// p2 (wf-19288f01-p2), and p2d if present at run time.
//
// STRICTLY READ-ONLY (SET SESSION transaction_read_only = 1).
//
// Population: ALL final MLB regular-season games 2026-03-25..2026-07-24 from
// `games` (sport='MLB', gameStatus='final'). 1,556 finals expected; 1,555 with
// mlbGamePk (All-Star exhibition 4110001 exempt from replay, flagged here).
// EVERY game emits a row per series x sub-market — games without a projection
// emit a stub row (pick='', note='no-projection') so population coverage is
// visible in the ledger itself.
//
// Grading rules — GRADING-REPORT.md, restated:
//   ML:    p_away (live: modelAwayWinPct/100; replay: pAwayMl). pick=p>0.5?AWAY:HOME.
//          correct = pick side won. brier/logloss on p_away.
//   RL:    line = away run line (live: games.awayRunLine; replay: protocol chain
//          games -> last pre-cutoff odds_history -> schedule DK -> ML-derived ±1.5,
//          replicating asof_features._book_lines). live pick = sign(modelMargin+line);
//          replay pick = pAwayRl>0.5?AWAY:HOME. push on exact cover.
//          prob = modelAwayPLCoverPct/100 where stored (live, from 2026-06-07) /
//          pAwayRl (replay). signedError = projMargin - actualMargin.
//   TOTAL: line = bookTotal (live) / protocol chain (replay, default 8.5).
//          p_over (live: modelOverRate/100; replay: pOver). push on exact line.
//          signedError = (modelProjTotal ?? modelTotal | projTotal) - actualTotal.
// Actual scores: games.actual*, fallback mlb_schedule_history scores.
// Live rows carry leakage_quarantine=1 when modelRunAt >= first pitch (startTimeUtc).
//
// CLV (per pick, B9 definition — matches the mlb_game_backtest.clv backfill):
//   clv = noVigProb(closing pair, pick side) - noVigProb(pregame pair at the
//   row's line, pick side); closing source: dkClosing* (locked) else last
//   pre-start odds_history snapshot (proxy). RL/TOTAL price-CLV only when the
//   closing line equals the row's line. stored_clv joined from mlb_game_backtest
//   (market = picked side) for comparison.
//
// Outputs (granular/fullgame/):
//   fullgame-evaluator-ledger.csv       one row per game x sub-market x series
//   fullgame-evaluator-metrics.csv      series x sub-market x month (+ALL) x scope
//   fullgame-evaluator-reliability.csv  10-bin reliability per series x sub-market
//   fullgame-evaluator-clv.csv          per-pick CLV rows (all series)
//   fullgame-evaluator-summary.json     aggregates for the report
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const AUDIT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(AUDIT, 'granular', 'fullgame');
fs.mkdirSync(OUT_DIR, { recursive: true });

const D0 = '2026-03-25', D1 = '2026-07-24';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

async function connect() {
  let c;
  try { c = await mysql.createConnection(url); await c.query('SELECT 1'); }
  catch { c = await mysql.createConnection({ uri: url, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }); }
  // TiDB implements transaction_read_only as a rejected noop — best-effort;
  // this script contains only SELECT statements (operative guard).
  await c.query('SET SESSION transaction_read_only = 1').catch(() => {});
  return c;
}
const conn = await connect();
const q = async (sql, params) => (await conn.query(sql, params))[0];

// ---------- helpers ----------
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
function parseOdds(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toUpperCase();
  if (t === 'EVEN' || t === 'EV' || t === 'PK') return 100;
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null;
}
const imp = (o) => (o === null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const noVig = (a, b) => (a !== null && b !== null && a + b > 0 ? a / (a + b) : null);
const clampP = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const brier = (p, y) => (p - y) ** 2;
const logloss = (p, y) => -(y * Math.log(clampP(p)) + (1 - y) * Math.log(1 - clampP(p)));
const r6 = (x) => (x === null || x === undefined || Number.isNaN(x) ? '' : Number(x).toFixed(6));
const csvEsc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function writeCsv(file, rows, cols) {
  const c = cols || Object.keys(rows[0] || {});
  fs.writeFileSync(path.join(OUT_DIR, file),
    [c.join(',')].concat(rows.map((r) => c.map((k) => csvEsc(r[k])).join(','))).join('\n') + '\n');
  console.error(`[eval] wrote ${file}: ${rows.length} rows`);
}

// ---------- census linkage (gamesId -> anGameId) ----------
const uniLines = fs.readFileSync(path.join(AUDIT, 'census', 'game-universe.csv'), 'utf8').trim().split('\n');
const uCols = uniLines[0].split(',');
const linkByGamesId = new Map();
for (const l of uniLines.slice(1)) {
  const p = l.split(',');
  const row = Object.fromEntries(uCols.map((c, i) => [c, p[i] === '' ? null : p[i]]));
  if (row.gamesId) linkByGamesId.set(Number(row.gamesId), row);
}

// ---------- run-time state of the replay ledger pipeline (record, not defect) ----------
const replayGradeState = await q(
  `SELECT COALESCE(source,'-') source, COALESCE(market,'-') market, COUNT(*) n
   FROM mlb_replay_grades GROUP BY source, market`);
const replayVersions = await q(
  `SELECT modelVersion, COUNT(*) n FROM mlb_replay_projections GROUP BY modelVersion`);

// ---------- games (the full population) ----------
const games = await q(
  `SELECT id, gameDate, awayTeam, homeTeam, startTimeEst, gameNumber, mlbGamePk, gameStatus,
          awayML, homeML, awayRunLine, awayRunLineOdds, homeRunLineOdds,
          bookTotal, overOdds, underOdds,
          modelAwayWinPct, modelAwayScore, modelHomeScore, modelOverRate, modelTotal, modelProjTotal,
          modelAwayPLCoverPct, modelRunAt,
          actualAwayScore, actualHomeScore, actualFgTotal
   FROM games WHERE sport='MLB' AND gameStatus='final' AND gameDate>=? AND gameDate<=?
   ORDER BY gameDate, id`, [D0, D1]);

// ---------- schedule rows (scores fallback, startTimeUtc, DK pregame + closing) ----------
const sched = new Map();
for (const r of await q(
  `SELECT anGameId, startTimeUtc, awayScore, homeScore, gameStatus,
          dkAwayML, dkHomeML, dkTotal, dkOverOdds, dkUnderOdds,
          dkAwayRunLine, dkAwayRunLineOdds, dkHomeRunLineOdds,
          dkClosingAwayML, dkClosingHomeML, dkClosingTotal, dkClosingOverOdds, dkClosingUnderOdds,
          dkClosingAwayRunLine, dkClosingAwayRunLineOdds, dkClosingHomeRunLineOdds, closingLineLockedAt
   FROM mlb_schedule_history WHERE game_type='regular_season' AND gameDate>=? AND gameDate<=?`, [D0, D1]))
  sched.set(Number(r.anGameId), r);

// ---------- replay projections (all versions present) ----------
const replayByVer = new Map(); // ver -> Map(gameId -> row)
for (const r of await q(
  `SELECT gameId, modelVersion, asOfCutoffMs, pAwayMl, projAwayScore, projHomeScore, projTotal, pOver, pAwayRl
   FROM mlb_replay_projections`)) {
  if (!replayByVer.has(r.modelVersion)) replayByVer.set(r.modelVersion, new Map());
  replayByVer.get(r.modelVersion).set(Number(r.gameId), r);
}
const verOf = (suffix) => [...replayByVer.keys()].find((v) => v.endsWith(suffix)) || null;
const SERIES_DEFS = [['p1', verOf('-p1')], ['p2', verOf('-p2')], ['p2d', verOf('-p2d')]]
  .filter(([, v]) => v !== null);

// ---------- last pre-cutoff odds_history snapshot per game (replay line chain + proxy closing) ----------
const snapByGame = new Map();
for (const r of await q(
  `SELECT o.gameId, o.awaySpread, o.awaySpreadOdds, o.homeSpreadOdds, o.total, o.overOdds, o.underOdds,
          o.awayML, o.homeML, o.scrapedAt
   FROM odds_history o
   JOIN (SELECT o2.gameId gid, MAX(o2.scrapedAt) mx
         FROM odds_history o2
         JOIN (SELECT DISTINCT gameId, asOfCutoffMs FROM mlb_replay_projections) r2 ON r2.gameId = o2.gameId
         WHERE o2.sport='MLB' AND o2.scrapedAt < r2.asOfCutoffMs
         GROUP BY o2.gameId) last ON last.gid = o.gameId AND last.mx = o.scrapedAt`))
  snapByGame.set(Number(r.gameId), r);

// ---------- mlb_game_backtest FG rows (stored CLV) ----------
const btByGameMarket = new Map(); // `${gameId}|${market}` -> row
for (const r of await q(
  `SELECT gameId, market, bookLine, bookOdds, bookOddsOpposite, bookNoVigProb, closingOdds, closingOddsOpposite, clv, result
   FROM mlb_game_backtest
   WHERE market IN ('fg_ml_away','fg_ml_home','fg_rl_away','fg_rl_home','fg_over','fg_under')`))
  btByGameMarket.set(`${r.gameId}|${r.market}`, r);

// ---------- replay line chain (replicates asof_features._book_lines) ----------
function replayBookLines(g, sn, sc) {
  const pick = (...vals) => { for (const v of vals) if (v !== null && v !== undefined && num(v) !== null) return v; return null; };
  const mlAwayS = pick(g.awayML, sn?.awayML, sc?.dkAwayML);
  const mlHomeS = pick(g.homeML, sn?.homeML, sc?.dkHomeML);
  const ouS = pick(g.bookTotal, sn?.total, sc?.dkTotal);
  const overS = pick(g.overOdds, sn?.overOdds, sc?.dkOverOdds);
  const underS = pick(g.underOdds, sn?.underOdds, sc?.dkUnderOdds);
  const rlS = pick(g.awayRunLine, sn?.awaySpread, sc?.dkAwayRunLine);
  const rlAwayOddsS = pick(g.awayRunLineOdds, sn?.awaySpreadOdds, sc?.dkAwayRunLineOdds);
  const rlHomeOddsS = pick(g.homeRunLineOdds, sn?.homeSpreadOdds, sc?.dkHomeRunLineOdds);
  const mlAway = parseOdds(mlAwayS) ?? 100;
  let awayRl = num(rlS);
  let rlSource = 'book';
  if (awayRl === null || awayRl === 0) { awayRl = mlAway < 0 ? -1.5 : 1.5; rlSource = 'ml-derived'; }
  let ou = num(ouS), ouSource = 'book';
  if (ou === null) { ou = 8.5; ouSource = 'default-8.5'; }
  return {
    mlAway: parseOdds(mlAwayS), mlHome: parseOdds(mlHomeS),
    ou, ouSource, overOdds: parseOdds(overS) ?? -110, underOdds: parseOdds(underS) ?? -110,
    awayRl, rlSource, rlAwayOdds: parseOdds(rlAwayOddsS) ?? 130, rlHomeOdds: parseOdds(rlHomeOddsS) ?? -150,
  };
}

// ---------- ledger construction ----------
const ledger = [];
const clvRows = [];
const popAudit = { finals: games.length, allstar: 0, live_missing_proj: [], replay_missing: {} };
for (const [s] of SERIES_DEFS) popAudit.replay_missing[s] = [];

const monthOf = (d) => String(d).slice(0, 7);
const dayNight = (g) => {
  const m = String(g.startTimeEst || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h < 17 ? 'day' : 'night';
};
const startUtcMs = (sc) => {
  if (!sc || !sc.startTimeUtc) return null;
  const t = Date.parse(sc.startTimeUtc);
  return Number.isFinite(t) ? t : null;
};

function closingFor(g, sc, sn) {
  // locked DK closing where present, else proxy = last pre-start odds snapshot
  const out = { source: 'none' };
  if (sc && (sc.dkClosingAwayML !== null || sc.dkClosingTotal !== null || sc.dkClosingAwayRunLine !== null)) {
    out.source = 'locked';
    out.mlAway = parseOdds(sc.dkClosingAwayML); out.mlHome = parseOdds(sc.dkClosingHomeML);
    out.total = num(sc.dkClosingTotal); out.overOdds = parseOdds(sc.dkClosingOverOdds); out.underOdds = parseOdds(sc.dkClosingUnderOdds);
    out.awayRl = num(sc.dkClosingAwayRunLine); out.rlAwayOdds = parseOdds(sc.dkClosingAwayRunLineOdds); out.rlHomeOdds = parseOdds(sc.dkClosingHomeRunLineOdds);
  } else if (sn) {
    out.source = 'proxy';
    out.mlAway = parseOdds(sn.awayML); out.mlHome = parseOdds(sn.homeML);
    out.total = num(sn.total); out.overOdds = parseOdds(sn.overOdds); out.underOdds = parseOdds(sn.underOdds);
    out.awayRl = num(sn.awaySpread); out.rlAwayOdds = parseOdds(sn.awaySpreadOdds); out.rlHomeOdds = parseOdds(sn.homeSpreadOdds);
  }
  return out;
}

function pushClv(base, series, sub, pick, projPair, closePair, lineMatch, storedKey) {
  // projPair/closePair: [oddsPickSide, oddsOtherSide]
  const [po, px] = projPair, [co, cx] = closePair;
  const nvProj = noVig(imp(po), imp(px));
  const nvClose = noVig(imp(co), imp(cx));
  const bt = storedKey ? btByGameMarket.get(storedKey) : null;
  const clv = lineMatch && nvProj !== null && nvClose !== null ? nvClose - nvProj : null;
  clvRows.push({
    game_id: base.game_id, date: base.date, month: base.month, teams: base.teams,
    series, sub_market: sub, pick,
    proj_odds_pick: po ?? '', proj_odds_opp: px ?? '', close_odds_pick: co ?? '', close_odds_opp: cx ?? '',
    novig_proj_pick: nvProj === null ? '' : nvProj.toFixed(6),
    novig_close_pick: nvClose === null ? '' : nvClose.toFixed(6),
    closing_source: base.closing_source, line_match: lineMatch ? 1 : 0,
    clv: clv === null ? '' : clv.toFixed(6),
    stored_market: storedKey ? storedKey.split('|')[1] : '',
    stored_clv: bt && bt.clv !== null ? Number(bt.clv).toFixed(6) : '',
    delta_vs_stored: clv !== null && bt && bt.clv !== null ? (clv - Number(bt.clv)).toFixed(6) : '',
  });
  return clv;
}

for (const g of games) {
  const link = linkByGamesId.get(g.id);
  const sc = link ? sched.get(Number(link.anGameId)) : null;
  const sn = snapByGame.get(g.id) || null;
  const isAllstar = g.mlbGamePk === null;
  if (isAllstar) popAudit.allstar++;

  // actual scores: games actuals -> schedule fallback
  let aAway = num(g.actualAwayScore), aHome = num(g.actualHomeScore), scoreSource = 'games';
  if ((aAway === null || aHome === null) && sc && sc.awayScore !== null && sc.homeScore !== null) {
    aAway = num(sc.awayScore); aHome = num(sc.homeScore); scoreSource = 'schedule';
  }
  const actTotal = num(g.actualFgTotal) ?? (aAway !== null && aHome !== null ? aAway + aHome : null);
  const actMargin = aAway !== null && aHome !== null ? aAway - aHome : null;

  const stUtc = startUtcMs(sc);
  const quarantine = g.modelRunAt !== null && stUtc !== null && Number(g.modelRunAt) >= stUtc ? 1 : 0;
  const closing = closingFor(g, sc, sn);
  const base = {
    game_id: g.id, mlb_game_pk: g.mlbGamePk ?? '', date: g.gameDate, month: monthOf(g.gameDate),
    teams: `${g.awayTeam}@${g.homeTeam}`, game_no: g.gameNumber,
    fav: (() => { const a = parseOdds(g.awayML); return a === null ? '' : a < 0 ? 'away_fav' : 'home_fav'; })(),
    day_night: dayNight(g), allstar: isAllstar ? 1 : 0, closing_source: closing.source,
  };

  const emit = (series, sub, row) => ledger.push({
    ...base, series, sub_market: sub,
    pick: '', prob: '', line: '', proj_value: '', actual: '', correct: '', brier: '', logloss: '',
    signed_error: '', abs_error: '', leakage_quarantine: series === 'live' ? quarantine : 0,
    score_source: scoreSource, note: '', ...row,
  });

  // ================= LIVE =================
  {
    // --- ML ---
    if (g.modelAwayWinPct === null) { emit('live', 'ML', { note: 'no-projection' }); popAudit.live_missing_proj.push(g.id); }
    else {
      const p = num(g.modelAwayWinPct) / 100;
      const pick = p > 0.5 ? 'AWAY' : 'HOME';
      let row = { pick, prob: p.toFixed(5), line: g.awayML ?? '' };
      if (aAway !== null && aHome !== null) {
        const y = aAway > aHome ? 1 : 0;
        row.actual = y ? 'AWAY' : 'HOME';
        row.correct = (pick === row.actual) ? 1 : 0;
        row.brier = r6(brier(p, y)); row.logloss = r6(logloss(p, y));
      } else row.note = 'missing-actual';
      if (isAllstar) row.note = (row.note ? row.note + ';' : '') + 'allstar-exhibition';
      emit('live', 'ML', row);
      if (pick && closing.source !== 'none' && !isAllstar) {
        const projPair = pick === 'AWAY' ? [parseOdds(g.awayML), parseOdds(g.homeML)] : [parseOdds(g.homeML), parseOdds(g.awayML)];
        const closePair = pick === 'AWAY' ? [closing.mlAway, closing.mlHome] : [closing.mlHome, closing.mlAway];
        pushClv(base, 'live', 'ML', pick, projPair, closePair, true, `${g.id}|fg_ml_${pick.toLowerCase()}`);
      }
    }

    // --- RL ---
    const rl = num(g.awayRunLine);
    if (g.modelAwayScore === null || rl === null || rl === 0) {
      emit('live', 'RL', { note: g.modelAwayScore === null ? 'no-projection' : 'no-book-runline' });
    } else {
      const margin = num(g.modelAwayScore) - num(g.modelHomeScore);
      const pick = margin + rl > 0 ? 'AWAY' : 'HOME';
      const pAwayCover = g.modelAwayPLCoverPct !== null ? num(g.modelAwayPLCoverPct) / 100 : null;
      let row = { pick, prob: pAwayCover === null ? '' : pAwayCover.toFixed(5), line: `${rl > 0 ? '+' : ''}${rl}`, proj_value: margin.toFixed(2) };
      if (actMargin !== null) {
        const cover = actMargin + rl;
        row.actual = cover > 0 ? 'AWAY' : cover < 0 ? 'HOME' : 'PUSH';
        row.correct = row.actual === 'PUSH' ? '' : (pick === row.actual ? 1 : 0);
        if (row.actual === 'PUSH') row.note = 'push';
        else if (pAwayCover !== null) { const y = row.actual === 'AWAY' ? 1 : 0; row.brier = r6(brier(pAwayCover, y)); row.logloss = r6(logloss(pAwayCover, y)); }
        row.signed_error = (margin - actMargin).toFixed(2); row.abs_error = Math.abs(margin - actMargin).toFixed(2);
      } else row.note = 'missing-actual';
      if (isAllstar) row.note = (row.note ? row.note + ';' : '') + 'allstar-exhibition';
      emit('live', 'RL', row);
      if (pick && closing.source !== 'none' && !isAllstar) {
        const lineMatch = closing.awayRl !== null && Math.abs(closing.awayRl - rl) < 1e-9;
        const projPair = pick === 'AWAY' ? [parseOdds(g.awayRunLineOdds), parseOdds(g.homeRunLineOdds)] : [parseOdds(g.homeRunLineOdds), parseOdds(g.awayRunLineOdds)];
        const closePair = pick === 'AWAY' ? [closing.rlAwayOdds, closing.rlHomeOdds] : [closing.rlHomeOdds, closing.rlAwayOdds];
        pushClv(base, 'live', 'RL', pick, projPair, closePair, lineMatch, `${g.id}|fg_rl_${pick.toLowerCase()}`);
      }
    }

    // --- TOTAL ---
    const bt = num(g.bookTotal);
    if (g.modelOverRate === null || bt === null) {
      emit('live', 'TOTAL', { note: g.modelOverRate === null ? 'no-projection' : 'no-book-total' });
    } else {
      const p = num(g.modelOverRate) / 100;
      const proj = num(g.modelProjTotal) ?? num(g.modelTotal);
      const pick = p > 0.5 ? 'OVER' : 'UNDER';
      let row = { pick, prob: p.toFixed(5), line: bt, proj_value: proj === null ? '' : proj.toFixed(2) };
      if (actTotal !== null) {
        row.actual = actTotal > bt ? 'OVER' : actTotal < bt ? 'UNDER' : 'PUSH';
        if (row.actual === 'PUSH') { row.note = 'push'; row.correct = ''; }
        else { const y = row.actual === 'OVER' ? 1 : 0; row.correct = pick === row.actual ? 1 : 0; row.brier = r6(brier(p, y)); row.logloss = r6(logloss(p, y)); }
        if (proj !== null) { row.signed_error = (proj - actTotal).toFixed(2); row.abs_error = Math.abs(proj - actTotal).toFixed(2); }
      } else row.note = 'missing-actual';
      if (isAllstar) row.note = (row.note ? row.note + ';' : '') + 'allstar-exhibition';
      emit('live', 'TOTAL', row);
      if (pick && closing.source !== 'none' && !isAllstar) {
        const lineMatch = closing.total !== null && Math.abs(closing.total - bt) < 1e-9;
        const projPair = pick === 'OVER' ? [parseOdds(g.overOdds) ?? -110, parseOdds(g.underOdds) ?? -110] : [parseOdds(g.underOdds) ?? -110, parseOdds(g.overOdds) ?? -110];
        const closePair = pick === 'OVER' ? [closing.overOdds, closing.underOdds] : [closing.underOdds, closing.overOdds];
        pushClv(base, 'live', 'TOTAL', pick, projPair, closePair, lineMatch, `${g.id}|fg_${pick.toLowerCase()}`);
      }
    }
  }

  // ================= REPLAY SERIES =================
  for (const [sname, ver] of SERIES_DEFS) {
    const r = replayByVer.get(ver).get(g.id);
    if (!r) {
      const note = isAllstar ? 'allstar-exempt' : 'no-replay-row';
      emit(sname, 'ML', { note }); emit(sname, 'RL', { note }); emit(sname, 'TOTAL', { note });
      if (!isAllstar) popAudit.replay_missing[sname].push(g.id);
      continue;
    }
    const bl = replayBookLines(g, sn, sc);

    // --- ML ---
    {
      const p = num(r.pAwayMl);
      const pick = p > 0.5 ? 'AWAY' : 'HOME';
      let row = { pick, prob: p.toFixed(5), line: bl.mlAway ?? '' };
      if (aAway !== null && aHome !== null) {
        const y = aAway > aHome ? 1 : 0;
        row.actual = y ? 'AWAY' : 'HOME'; row.correct = pick === row.actual ? 1 : 0;
        row.brier = r6(brier(p, y)); row.logloss = r6(logloss(p, y));
      } else row.note = 'missing-actual';
      emit(sname, 'ML', row);
      if (closing.source !== 'none') {
        const projPair = pick === 'AWAY' ? [bl.mlAway, bl.mlHome] : [bl.mlHome, bl.mlAway];
        const closePair = pick === 'AWAY' ? [closing.mlAway, closing.mlHome] : [closing.mlHome, closing.mlAway];
        pushClv(base, sname, 'ML', pick, projPair, closePair, true, `${g.id}|fg_ml_${pick.toLowerCase()}`);
      }
    }

    // --- RL ---
    {
      const p = num(r.pAwayRl);
      const rlLine = bl.awayRl;
      const margin = num(r.projAwayScore) - num(r.projHomeScore);
      const pick = p > 0.5 ? 'AWAY' : 'HOME';
      let row = { pick, prob: p.toFixed(5), line: `${rlLine > 0 ? '+' : ''}${rlLine}`, proj_value: margin.toFixed(2), note: bl.rlSource === 'ml-derived' ? 'rl-line-ml-derived' : '' };
      if (actMargin !== null) {
        const cover = actMargin + rlLine;
        row.actual = cover > 0 ? 'AWAY' : cover < 0 ? 'HOME' : 'PUSH';
        if (row.actual === 'PUSH') { row.note = (row.note ? row.note + ';' : '') + 'push'; row.correct = ''; }
        else { const y = row.actual === 'AWAY' ? 1 : 0; row.correct = pick === row.actual ? 1 : 0; row.brier = r6(brier(p, y)); row.logloss = r6(logloss(p, y)); }
        row.signed_error = (margin - actMargin).toFixed(2); row.abs_error = Math.abs(margin - actMargin).toFixed(2);
      } else row.note = (row.note ? row.note + ';' : '') + 'missing-actual';
      emit(sname, 'RL', row);
      if (closing.source !== 'none') {
        const lineMatch = closing.awayRl !== null && Math.abs(closing.awayRl - rlLine) < 1e-9;
        const projPair = pick === 'AWAY' ? [bl.rlAwayOdds, bl.rlHomeOdds] : [bl.rlHomeOdds, bl.rlAwayOdds];
        const closePair = pick === 'AWAY' ? [closing.rlAwayOdds, closing.rlHomeOdds] : [closing.rlHomeOdds, closing.rlAwayOdds];
        pushClv(base, sname, 'RL', pick, projPair, closePair, lineMatch, `${g.id}|fg_rl_${pick.toLowerCase()}`);
      }
    }

    // --- TOTAL ---
    {
      const p = num(r.pOver);
      const line = bl.ou;
      const proj = num(r.projTotal);
      const pick = p > 0.5 ? 'OVER' : 'UNDER';
      let row = { pick, prob: p.toFixed(5), line, proj_value: proj === null ? '' : proj.toFixed(2), note: bl.ouSource !== 'book' ? 'total-line-' + bl.ouSource : '' };
      if (actTotal !== null) {
        row.actual = actTotal > line ? 'OVER' : actTotal < line ? 'UNDER' : 'PUSH';
        if (row.actual === 'PUSH') { row.note = (row.note ? row.note + ';' : '') + 'push'; row.correct = ''; }
        else { const y = row.actual === 'OVER' ? 1 : 0; row.correct = pick === row.actual ? 1 : 0; row.brier = r6(brier(p, y)); row.logloss = r6(logloss(p, y)); }
        if (proj !== null) { row.signed_error = (proj - actTotal).toFixed(2); row.abs_error = Math.abs(proj - actTotal).toFixed(2); }
      } else row.note = (row.note ? row.note + ';' : '') + 'missing-actual';
      emit(sname, 'TOTAL', row);
      if (closing.source !== 'none') {
        const lineMatch = closing.total !== null && Math.abs(closing.total - line) < 1e-9;
        const projPair = pick === 'OVER' ? [bl.overOdds, bl.underOdds] : [bl.underOdds, bl.overOdds];
        const closePair = pick === 'OVER' ? [closing.overOdds, closing.underOdds] : [closing.underOdds, closing.overOdds];
        pushClv(base, sname, 'TOTAL', pick, projPair, closePair, lineMatch, `${g.id}|fg_${pick.toLowerCase()}`);
      }
    }
  }
}

// ---------- write ledger ----------
const LEDGER_COLS = ['game_id', 'mlb_game_pk', 'date', 'month', 'teams', 'game_no', 'series', 'sub_market',
  'pick', 'prob', 'line', 'proj_value', 'actual', 'correct', 'brier', 'logloss', 'signed_error', 'abs_error',
  'fav', 'day_night', 'allstar', 'leakage_quarantine', 'closing_source', 'score_source', 'note'];
writeCsv('fullgame-evaluator-ledger.csv', ledger, LEDGER_COLS);
writeCsv('fullgame-evaluator-clv.csv', clvRows);

// ---------- metrics ----------
function metricsFor(rows) {
  const graded = rows.filter((r) => r.correct === 1 || r.correct === 0);
  const withP = rows.filter((r) => r.brier !== '' && r.brier !== undefined);
  const withE = rows.filter((r) => r.signed_error !== '' && r.signed_error !== undefined);
  const n = graded.length, hits = graded.filter((r) => r.correct === 1).length;
  const m = {
    n_rows: rows.length, graded: n, hits,
    hit_rate: n ? +(hits / n).toFixed(4) : '',
    hit_ci95: n ? +(1.96 * Math.sqrt((hits / n) * (1 - hits / n) / n)).toFixed(4) : '',
    n_prob: withP.length,
    brier: withP.length ? +(withP.reduce((s, r) => s + Number(r.brier), 0) / withP.length).toFixed(5) : '',
    logloss: withP.length ? +(withP.reduce((s, r) => s + Number(r.logloss), 0) / withP.length).toFixed(5) : '',
    n_err: withE.length, mae: '', rmse: '', bias: '', bias_ci95: '', bias_sig: '',
  };
  if (withE.length > 1) {
    const errs = withE.map((r) => Number(r.signed_error));
    const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
    const sd = Math.sqrt(errs.reduce((s, e) => s + (e - mean) ** 2, 0) / (errs.length - 1));
    m.mae = +(errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length).toFixed(4);
    m.rmse = +Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length).toFixed(4);
    m.bias = +mean.toFixed(4);
    m.bias_ci95 = +(1.96 * sd / Math.sqrt(errs.length)).toFixed(4);
    m.bias_sig = Math.abs(mean) > 1.96 * sd / Math.sqrt(errs.length) ? 1 : 0;
  }
  return m;
}

const metricRows = [];
const seriesNames = ['live', ...SERIES_DEFS.map(([s]) => s)];
const months = [...new Set(ledger.map((r) => r.month))].sort();
const inPop = (r) => !r.allstar; // All-Star exhibition excluded from ALL metrics (flagged in ledger)
for (const s of seriesNames) {
  for (const sub of ['ML', 'RL', 'TOTAL']) {
    const rowsAll = ledger.filter((r) => r.series === s && r.sub_market === sub && inPop(r));
    const scopes = [['all', rowsAll]];
    if (s === 'live') scopes.push(['ex-quarantine', rowsAll.filter((r) => !r.leakage_quarantine)]);
    for (const [scope, rows] of scopes) {
      metricRows.push({ series: s, sub_market: sub, month: 'ALL', scope, ...metricsFor(rows) });
      for (const mth of months)
        metricRows.push({ series: s, sub_market: sub, month: mth, scope, ...metricsFor(rows.filter((r) => r.month === mth)) });
    }
  }
}
writeCsv('fullgame-evaluator-metrics.csv', metricRows);

// ---------- reliability (10 bins on canonical-side prob: p_away / p_over) ----------
const relRows = [];
for (const s of seriesNames) {
  for (const sub of ['ML', 'RL', 'TOTAL']) {
    const rows = ledger.filter((r) => r.series === s && r.sub_market === sub && inPop(r)
      && r.prob !== '' && (r.correct === 1 || r.correct === 0));
    const bins = Array.from({ length: 10 }, () => ({ n: 0, pSum: 0, ySum: 0 }));
    for (const r of rows) {
      const p = Number(r.prob);
      // y on canonical side: AWAY (ML/RL) or OVER (TOTAL) won
      const y = (r.actual === 'AWAY' || r.actual === 'OVER') ? 1 : 0;
      const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
      bins[b].n++; bins[b].pSum += p; bins[b].ySum += y;
    }
    bins.forEach((b, i) => relRows.push({
      series: s, sub_market: sub, bin: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
      n: b.n, avg_p: b.n ? +(b.pSum / b.n).toFixed(4) : '', obs_rate: b.n ? +(b.ySum / b.n).toFixed(4) : '',
      gap: b.n ? +((b.ySum / b.n) - (b.pSum / b.n)).toFixed(4) : '',
    }));
  }
}
writeCsv('fullgame-evaluator-reliability.csv', relRows);

// ---------- CLV aggregates ----------
function clvAgg(rows) {
  const withClv = rows.filter((r) => r.clv !== '');
  const vals = withClv.map((r) => Number(r.clv)).sort((a, b) => a - b);
  const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  const med = vals.length ? vals[Math.floor(vals.length / 2)] : null;
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)) : null;
  const pos = vals.filter((v) => v > 0).length;
  const both = withClv.filter((r) => r.stored_clv !== '');
  const deltas = both.map((r) => Math.abs(Number(r.delta_vs_stored)));
  const stored = rows.filter((r) => r.stored_clv !== '').map((r) => Number(r.stored_clv)).sort((a, b) => a - b);
  const smean = stored.length ? stored.reduce((s, v) => s + v, 0) / stored.length : null;
  const ssd = stored.length > 1 ? Math.sqrt(stored.reduce((s, v) => s + (v - smean) ** 2, 0) / (stored.length - 1)) : null;
  return {
    n_picks: rows.length, n_clv: vals.length,
    mean_clv: mean === null ? null : +mean.toFixed(5),
    mean_clv_ci95: sd === null ? null : +(1.96 * sd / Math.sqrt(vals.length)).toFixed(5),
    median_clv: med === null ? null : +med.toFixed(5),
    pct_beat_close: vals.length ? +(pos / vals.length).toFixed(4) : null,
    // stored (B9 / enrollment-time-odds) CLV over the same picks — primary for RL,
    // where current games odds columns are corrupted pre-June (see rl-odds-integrity)
    n_stored: stored.length,
    mean_stored_clv: smean === null ? null : +smean.toFixed(5),
    mean_stored_clv_ci95: ssd === null ? null : +(1.96 * ssd / Math.sqrt(stored.length)).toFixed(5),
    median_stored_clv: stored.length ? +stored[Math.floor(stored.length / 2)].toFixed(5) : null,
    pct_stored_positive: stored.length ? +(stored.filter((v) => v > 0).length / stored.length).toFixed(4) : null,
    n_stored_match: both.length,
    mean_abs_delta_vs_stored: deltas.length ? +(deltas.reduce((s, v) => s + v, 0) / deltas.length).toFixed(6) : null,
    max_abs_delta_vs_stored: deltas.length ? +Math.max(...deltas).toFixed(6) : null,
  };
}

// ---------- RL odds integrity: current games columns vs enrollment-time capture ----------
// The backtest rows captured book RL odds at enrollment (bookOdds/bookOddsOpposite on the
// fg_rl_away row = away/home). Compare with the CURRENT games.awayRunLineOdds/homeRunLineOdds.
const rlIntegrityRows = [];
for (const g of games) {
  if (g.mlbGamePk === null) continue;
  const bt = btByGameMarket.get(`${g.id}|fg_rl_away`);
  const gA = parseOdds(g.awayRunLineOdds), gH = parseOdds(g.homeRunLineOdds);
  const bA = bt ? parseOdds(bt.bookOdds) : null, bH = bt ? parseOdds(bt.bookOddsOpposite) : null;
  const mirrored = gA !== null && gH !== null && Math.abs(gA + gH) <= 2 ? 1 : 0;
  let status;
  if (gA === null || gH === null) status = 'games-null';
  else if (bA === null && bH === null) status = 'no-enrollment-capture';
  else if (bH === null) {
    // Jun/Jul era: bookOddsOpposite no longer written; compare away side only
    status = gA === bA ? 'agree(away-only)' : gH === bA ? 'swapped(away-only)' : 'other(away-only)';
  }
  else if (gA === bA && gH === bH) status = 'agree';
  else if (gA === bH && gH === bA) status = 'swapped';
  else status = 'other';
  rlIntegrityRows.push({ game_id: g.id, date: g.gameDate, month: monthOf(g.gameDate), teams: `${g.awayTeam}@${g.homeTeam}`,
    games_away_odds: gA ?? '', games_home_odds: gH ?? '', enroll_away_odds: bA ?? '', enroll_home_odds: bH ?? '',
    mirrored_pair: mirrored, status });
}
writeCsv('fullgame-evaluator-rl-odds-integrity.csv', rlIntegrityRows);
const rlIntegritySummary = {};
for (const r of rlIntegrityRows) {
  const k = r.month;
  rlIntegritySummary[k] = rlIntegritySummary[k] || { n: 0, agree: 0, swapped: 0, other: 0, mirrored: 0, games_null: 0, no_capture: 0 };
  const s = rlIntegritySummary[k];
  s.n++; s.mirrored += r.mirrored_pair;
  if (r.status.startsWith('agree')) s.agree++;
  else if (r.status.startsWith('swapped')) s.swapped++;
  else if (r.status === 'games-null') s.games_null++;
  else if (r.status === 'no-enrollment-capture') s.no_capture++;
  else s.other++;
}
const clvSummary = {};
for (const s of seriesNames) {
  clvSummary[s] = {};
  for (const sub of ['ML', 'RL', 'TOTAL']) {
    const rows = clvRows.filter((r) => r.series === s && r.sub_market === sub);
    clvSummary[s][sub] = {
      all: clvAgg(rows),
      locked_only: clvAgg(rows.filter((r) => r.closing_source === 'locked')),
    };
  }
}

// ---------- summary JSON ----------
const summary = {
  ranAt: new Date().toISOString(),
  window: [D0, D1],
  population: {
    finals: popAudit.finals,
    with_gamepk: games.filter((g) => g.mlbGamePk !== null).length,
    allstar_flagged: popAudit.allstar,
    live_missing_projection_games: popAudit.live_missing_proj.length,
    live_missing_projection_ids: popAudit.live_missing_proj,
    replay_missing: Object.fromEntries(Object.entries(popAudit.replay_missing).map(([k, v]) => [k, v.length])),
    quarantined_live_games: [...new Set(ledger.filter((r) => r.series === 'live' && r.leakage_quarantine === 1).map((r) => r.game_id))].length,
  },
  series_versions: Object.fromEntries(SERIES_DEFS),
  replay_grades_state_at_run: replayGradeState,
  replay_projection_counts: replayVersions,
  rl_odds_integrity_by_month: rlIntegritySummary,
  ledger_rows: ledger.length,
  clv_rows: clvRows.length,
  clv_summary: clvSummary,
  metrics_overall: Object.fromEntries(seriesNames.map((s) => [s,
    Object.fromEntries(['ML', 'RL', 'TOTAL'].map((sub) => [sub,
      metricsFor(ledger.filter((r) => r.series === s && r.sub_market === sub && inPop(r)))]))])),
};
fs.writeFileSync(path.join(OUT_DIR, 'fullgame-evaluator-summary.json'), JSON.stringify(summary, null, 2));
console.error('[eval] wrote fullgame-evaluator-summary.json');
console.log(JSON.stringify({
  population: summary.population, series: seriesNames, ledger_rows: ledger.length,
  overall: summary.metrics_overall,
  clv: Object.fromEntries(seriesNames.map((s) => [s, Object.fromEntries(['ML', 'RL', 'TOTAL'].map((sub) => [sub, clvSummary[s][sub].locked_only.mean_clv]))])),
}, null, 1));
await conn.end();
