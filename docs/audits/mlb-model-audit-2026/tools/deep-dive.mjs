#!/usr/bin/env node
// Maximum-granularity deep dive across all MLB market families and projection series.
// Series: live_pregame, replay p1 (fixed raw), p2 (monthly-calibrated), p2d (daily-calibrated).
// Emits DEEP-DIVE.md + deep-dive.json. READ-ONLY. Skips series that don't exist yet.
import { connect } from './remediation/_db.mjs';
import fs from 'fs';

const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];
const OUT = new URL('../', import.meta.url).pathname;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const ci95 = (a) => { if (a.length < 3) return null; const m = mean(a); const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); return 1.96 * sd / Math.sqrt(a.length); };
const r4 = (v) => (v === null ? null : +Number(v).toFixed(4));
const parseOdds = (s) => { if (s == null) return null; const t = String(s).trim().toUpperCase(); if (['EVEN','EV','PK'].includes(t)) return 100; const v = Number(t); return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null; };

// ---------- context tables ----------
const gamesCtx = new Map();
for (const g of await q(
  `SELECT id, gameDate, awayTeam, homeTeam, startTimeEst, awayML, bookTotal, f5Total, homeTeam team FROM games
   WHERE sport='MLB' AND gameStatus='final' AND gameDate>='2026-03-25' AND gameDate<='2026-07-24'`)) {
  const m = String(g.startTimeEst || '').match(/(\d+):\d+\s*(AM|PM)/i);
  let hour = m ? (Number(m[1]) % 12) + (/pm/i.test(m[2]) ? 12 : 0) : null;
  gamesCtx.set(g.id, {
    date: g.gameDate, mo: g.gameDate.slice(0, 7),
    fav: parseOdds(g.awayML) === null ? null : parseOdds(g.awayML) < 0 ? 'away_fav' : 'home_fav',
    dn: hour === null ? null : hour < 17 ? 'day' : 'night',
    totLine: num(g.bookTotal), f5Line: num(g.f5Total), home: g.homeTeam,
  });
}
const parkHr = new Map();
{
  const rows = await q(`SELECT teamAbbrev, hrFactor FROM mlb_park_factors WHERE hrFactor IS NOT NULL ORDER BY hrFactor`);
  rows.forEach((r, i) => parkHr.set(r.teamAbbrev, i < rows.length / 3 ? 'hr_low' : i < (2 * rows.length) / 3 ? 'hr_mid' : 'hr_high'));
}
const kHand = new Map();
for (const r of await q(`SELECT gameId, mlbamId, pitcherHand FROM mlb_strikeout_props WHERE pitcherHand IS NOT NULL`)) kHand.set(`${r.gameId}|${r.mlbamId}`, r.pitcherHand.startsWith('L') ? 'L' : 'R');
const lsHand = new Map();
for (const r of await q(`SELECT gameId, awayStarterId, homeStarterId, awayStarterHand, homeStarterHand FROM mlb_replay_linescores`)) {
  if (r.awayStarterId) lsHand.set(`${r.gameId}|${r.awayStarterId}`, r.awayStarterHand);
  if (r.homeStarterId) lsHand.set(`${r.gameId}|${r.homeStarterId}`, r.homeStarterHand);
}

// pick-CLV context: ledger clv by (gameId, market-side)
const clvIdx = new Map();
for (const r of await q(`SELECT gameId, market, clv FROM mlb_game_backtest WHERE clv IS NOT NULL`)) clvIdx.set(`${r.gameId}|${r.market}`, Number(r.clv));
const clvKey = (market, gameId, pick) => {
  if (market === 'fg_ml') return `${gameId}|fg_ml_${pick === 'AWAY' ? 'away' : 'home'}`;
  if (market === 'fg_rl') return `${gameId}|fg_rl_${pick === 'AWAY' ? 'away' : 'home'}`;
  if (market === 'fg_total') return `${gameId}|fg_${pick === 'OVER' ? 'over' : 'under'}`;
  return null;
};

// ---------- load grades ----------
const grades = await q(
  `SELECT gameId, gameDate, market, refId, source, modelVersion, pick, prob, projValue, line, actual, result, correct, brier, signedError
   FROM mlb_replay_grades WHERE gameDate>='2026-03-25' AND gameDate<='2026-07-24'`);
if (!grades.length) { console.log('no grades yet — run after the grade stage'); process.exit(0); }

const seriesOf = (r) => r.source === 'live_pregame' ? 'live' : r.modelVersion.endsWith('-p2d') ? 'p2d' : r.modelVersion.endsWith('-p2') ? 'p2' : 'p1';
const propMeta = new Map();
for (const r of await q(`SELECT id, mlbamId, side, playerName FROM mlb_replay_prop_projections`)) propMeta.set(r.id, r);
const livePropMeta = new Map();
for (const r of await q(`SELECT id, mlbamId, side, pitcherName playerName FROM mlb_strikeout_props`)) livePropMeta.set(`K|${r.id}`, r);
for (const r of await q(`SELECT id, mlbamId, side, playerName FROM mlb_hr_props`)) livePropMeta.set(`HR|${r.id}`, r);

function metricsFor(rows) {
  const graded = rows.filter((r) => r.correct !== null);
  const hits = graded.filter((r) => Number(r.correct) === 1).length;
  const briers = rows.map((r) => num(r.brier)).filter((v) => v !== null);
  const errs = rows.map((r) => num(r.signedError)).filter((v) => v !== null);
  const m = { n: rows.length, graded: graded.length };
  if (graded.length) { m.hit = r4(hits / graded.length); m.hit_ci = r4(ci95(graded.map((r) => Number(r.correct)))); }
  if (briers.length) m.brier = +mean(briers).toFixed(5);
  if (errs.length) { m.bias = r4(mean(errs)); m.bias_ci = r4(ci95(errs)); m.mae = r4(mean(errs.map(Math.abs))); m.rmse = r4(Math.sqrt(mean(errs.map((e) => e * e)))); }
  return m;
}
function reliability(rows, bins = 10) {
  const withP = rows.filter((r) => r.prob !== null && r.brier !== null);
  if (withP.length < 100) return null;
  const b = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of withP) {
    const p = Number(r.prob);
    const y = Math.abs(Math.sqrt(Number(r.brier)) - Math.abs(p - 1)) < 1e-6 ? 1 : 0;
    const i = Math.min(bins - 1, Math.floor(p * bins));
    b[i].n++; b[i].p += p; b[i].y += y;
  }
  return b.filter((x) => x.n >= 20).map((x) => ({ n: x.n, p: r4(x.p / x.n), obs: r4(x.y / x.n) }));
}

const bySeriesMarket = new Map();
for (const g of grades) {
  const k = `${g.market}|${seriesOf(g)}`;
  if (!bySeriesMarket.has(k)) bySeriesMarket.set(k, []);
  bySeriesMarket.get(k).push(g);
}

const MARKETS = ['fg_ml', 'fg_rl', 'fg_total', 'f5_ml', 'f5_rl', 'f5_total', 'nrfi_yrfi', 'k_prop', 'hr_prop'];
const SERIES = ['live', 'p1', 'p2', 'p2d'];
const report = { generated: new Date().toISOString(), markets: {} };

for (const market of MARKETS) {
  const sec = { series: {}, slices: {}, exemplars: {} };
  for (const s of SERIES) {
    const rows = bySeriesMarket.get(`${market}|${s}`) || [];
    if (!rows.length) continue;
    const overall = metricsFor(rows);
    const rel = reliability(rows);
    // pick-CLV for FG markets
    if (['fg_ml', 'fg_rl', 'fg_total'].includes(market)) {
      const clvs = rows.map((r) => { const k = clvKey(market, r.gameId, r.pick); return k ? clvIdx.get(k) : undefined; }).filter((v) => v !== undefined);
      if (clvs.length >= 50) { overall.pick_clv = r4(mean(clvs)); overall.pick_clv_ci = r4(ci95(clvs)); overall.n_clv = clvs.length; }
    }
    sec.series[s] = { overall, reliability: rel };
    // slices (headline series only: live + p2d, or p2 if no p2d yet)
    const headline = bySeriesMarket.has(`${market}|p2d`) ? 'p2d' : 'p2';
    if (s === 'live' || s === headline) {
      const sl = {};
      const push = (name, rowsSub) => { if (rowsSub.length >= 30) sl[name] = metricsFor(rowsSub); };
      const byMo = new Map();
      for (const r of rows) { const mo = r.gameDate.slice(0, 7); if (!byMo.has(mo)) byMo.set(mo, []); byMo.get(mo).push(r); }
      for (const [mo, rr] of [...byMo].sort()) push(`mo_${mo}`, rr);
      const ctx = (r) => gamesCtx.get(r.gameId) || {};
      push('home_fav', rows.filter((r) => ctx(r).fav === 'home_fav'));
      push('away_fav', rows.filter((r) => ctx(r).fav === 'away_fav'));
      push('day', rows.filter((r) => ctx(r).dn === 'day'));
      push('night', rows.filter((r) => ctx(r).dn === 'night'));
      if (market.endsWith('_total')) {
        const lineOf = (r) => (market === 'fg_total' ? ctx(r).totLine : ctx(r).f5Line);
        push('line_low', rows.filter((r) => lineOf(r) !== null && lineOf(r) < (market === 'fg_total' ? 8 : 4.5)));
        push('line_mid', rows.filter((r) => { const l = lineOf(r); return l !== null && l >= (market === 'fg_total' ? 8 : 4.5) && l <= (market === 'fg_total' ? 9 : 5); }));
        push('line_high', rows.filter((r) => { const l = lineOf(r); return l !== null && l > (market === 'fg_total' ? 9 : 5); }));
      }
      if (r0IsProp(market)) {
        const handOf = (r) => {
          const pm = r.source === 'live_pregame' ? livePropMeta.get(`${market === 'k_prop' ? 'K' : 'HR'}|${r.refId}`) : propMeta.get(r.refId);
          if (!pm) return null;
          if (market === 'k_prop') return kHand.get(`${r.gameId}|${pm.mlbamId}`) ?? lsHand.get(`${r.gameId}|${pm.mlbamId}`) ?? null;
          return null;
        };
        if (market === 'k_prop') {
          push('hand_L', rows.filter((r) => handOf(r) === 'L'));
          push('hand_R', rows.filter((r) => handOf(r) === 'R'));
          push('line_le5', rows.filter((r) => num(r.line) !== null && num(r.line) <= 5));
          push('line_gt5', rows.filter((r) => num(r.line) !== null && num(r.line) > 5));
          push('pick_OVER', rows.filter((r) => r.pick === 'OVER'));
          push('pick_UNDER', rows.filter((r) => r.pick === 'UNDER'));
        }
        if (market === 'hr_prop') {
          push('park_hr_low', rows.filter((r) => parkHr.get((gamesCtx.get(r.gameId) || {}).home) === 'hr_low'));
          push('park_hr_mid', rows.filter((r) => parkHr.get((gamesCtx.get(r.gameId) || {}).home) === 'hr_mid'));
          push('park_hr_high', rows.filter((r) => parkHr.get((gamesCtx.get(r.gameId) || {}).home) === 'hr_high'));
        }
      }
      sec.slices[s] = sl;
    }
    // exemplars for headline replay series
    if (s === (bySeriesMarket.has(`${market}|p2d`) ? 'p2d' : 'p2')) {
      const scored = rows.filter((r) => r.brier !== null || r.signedError !== null)
        .map((r) => ({ ...r, badness: r.brier !== null ? Number(r.brier) : Math.abs(Number(r.signedError)) }))
        .sort((a, b) => b.badness - a.badness);
      sec.exemplars.worst20 = scored.slice(0, 20).map((r) => ({ gameId: r.gameId, date: r.gameDate, refId: r.refId, pick: r.pick, prob: r.prob, proj: r.projValue, line: r.line, actual: r.actual, brier: r.brier, err: r.signedError }));
    }
  }
  report.markets[market] = sec;
}
function r0IsProp(m) { return m === 'k_prop' || m === 'hr_prop'; }

// K per-pitcher residuals (headline replay series)
{
  const headline = [...bySeriesMarket.keys()].some((k) => k.endsWith('|p2d')) ? 'p2d' : 'p2';
  const rows = bySeriesMarket.get(`k_prop|${headline}`) || [];
  const byPitcher = new Map();
  for (const r of rows) {
    const pm = propMeta.get(r.refId);
    if (!pm || num(r.signedError) === null) continue;
    const k = pm.playerName;
    if (!byPitcher.has(k)) byPitcher.set(k, []);
    byPitcher.get(k).push(Number(r.signedError));
  }
  report.k_pitcher_residuals = [...byPitcher.entries()].filter(([, v]) => v.length >= 5)
    .map(([name, v]) => ({ name, n: v.length, bias: r4(mean(v)), mae: r4(mean(v.map(Math.abs))) }))
    .sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias)).slice(0, 20);
}
// NRFI beta stability from p2d calibMeta
{
  const rows = await q(`SELECT gameDate, calibMeta FROM mlb_replay_projections WHERE modelVersion LIKE '%-p2d' ORDER BY gameDate`);
  const betasByMo = new Map();
  for (const r of rows) {
    try {
      const m = JSON.parse(r.calibMeta || '{}');
      const beta = m?.nrfi?.beta;
      if (Array.isArray(beta)) { const mo = r.gameDate.slice(0, 7); if (!betasByMo.has(mo)) betasByMo.set(mo, []); betasByMo.get(mo).push(beta); }
    } catch {}
  }
  report.nrfi_beta_by_month = Object.fromEntries([...betasByMo].map(([mo, bs]) => [mo, bs[bs.length - 1]]));
}

fs.writeFileSync(OUT + 'deep-dive.json', JSON.stringify(report, null, 1));

// markdown digest
let md = `# Deep Dive — per-market, per-series, per-slice (generated ${report.generated})\n\nSeries: live = as published; p1 = fixed model raw; p2 = monthly walk-forward calibration; p2d = per-slate (daily) walk-forward calibration.\n`;
for (const market of MARKETS) {
  const sec = report.markets[market];
  if (!Object.keys(sec.series).length) continue;
  md += `\n## ${market}\n\n| series | n | hit | brier | bias | mae | pick-CLV |\n|---|---|---|---|---|---|---|\n`;
  for (const s of SERIES) {
    const o = sec.series[s]?.overall;
    if (!o) continue;
    md += `| ${s} | ${o.n} | ${o.hit ?? '-'}${o.hit_ci ? '±' + o.hit_ci : ''} | ${o.brier ?? '-'} | ${o.bias ?? '-'}${o.bias_ci ? '±' + o.bias_ci : ''} | ${o.mae ?? '-'} | ${o.pick_clv !== undefined ? o.pick_clv + '±' + o.pick_clv_ci : '-'} |\n`;
  }
  for (const s of Object.keys(sec.slices)) {
    const sl = sec.slices[s];
    const keys = Object.keys(sl);
    if (!keys.length) continue;
    md += `\n${s} slices: ` + keys.map((k) => { const m = sl[k]; return `${k}(n=${m.graded ?? m.n}${m.hit !== undefined ? ` hit=${m.hit}` : ''}${m.bias !== undefined ? ` bias=${m.bias}` : ''}${m.brier !== undefined ? ` br=${m.brier}` : ''})`; }).join(' · ') + '\n';
  }
  const rel = sec.series.p2d?.reliability ?? sec.series.p2?.reliability;
  if (rel) md += `\nreliability (headline replay): ` + rel.map((b) => `${b.p}->${b.obs}(n${b.n})`).join(' ') + '\n';
}
md += `\n## K props — largest per-pitcher residuals (headline replay, n>=5)\n` +
  (report.k_pitcher_residuals || []).map((p) => `- ${p.name}: bias ${p.bias} (mae ${p.mae}, n=${p.n})`).join('\n') + '\n';
md += `\n## NRFI logistic betas (last fit per month)\n` +
  Object.entries(report.nrfi_beta_by_month || {}).map(([mo, b]) => `- ${mo}: [${(b || []).join(', ')}]`).join('\n') + '\n';
fs.writeFileSync(OUT + 'DEEP-DIVE.md', md);
console.log('wrote DEEP-DIVE.md + deep-dive.json;', grades.length, 'grade rows analyzed');
await conn.end();
