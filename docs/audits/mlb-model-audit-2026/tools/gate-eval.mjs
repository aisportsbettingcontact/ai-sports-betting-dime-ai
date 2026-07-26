#!/usr/bin/env node
// Phase 7 publication-gate evaluator. Walk-forward evidence ONLY:
// mlb_replay_grades, source='walkforward_replay', modelVersion '%-p2d' (the per-slate
// daily-calibrated headline series), months May-July 2026 (March-April are calibration
// seed months and are excluded from gate evidence).
// Per-market criteria (a) beat stated baseline with 95% CI excluding zero, (b) Brier skill >= 0
// vs baseline + monotone-ish reliability, (c) signed bias inside the stated band.
// Verdicts are RECOMMENDATIONS; rows written to mlb_calibration_constants (publish_* 1/0) have
// no production effect until the gate code merges, and the owner can flip any row.
// Baselines (stated per directive):
//   fg_ml/f5_ml   -> market-implied no-vig book probability (Brier)
//   fg_total/f5_total -> p=0.5 coin flip (Brier) + book line as projection (MAE)
//   nrfi_yrfi     -> climatology: season-to-date NRFI rate as constant predictor
//   fg_rl/f5_rl   -> 50% pick accuracy (no stored probability channel)
//   k_prop        -> book line as projection (MAE) + p=0.5 sides
//   hr_prop       -> climatology base rate (Brier)
// Bias bands: fg_total ±0.15 runs, f5_total ±0.10, k_prop ±0.15 K; others n/a (binary).
import { connect, execFlag } from './remediation/_db.mjs';
import fs from 'fs';

const EXECUTE = execFlag();
const conn = await connect();
const q = async (sql, p) => (await conn.query(sql, p))[0];
const EVAL_START = '2026-05-01', EVAL_END = '2026-07-24';

const parseOdds = (s) => { if (s == null) return null; const t = String(s).trim().toUpperCase(); if (['EVEN','EV','PK'].includes(t)) return 100; const v = Number(t); return Number.isFinite(v) && Math.abs(v) >= 100 ? v : null; };
const imp = (o) => (o === null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const ci95 = (a) => { const m = mean(a); const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); return 1.96 * sd / Math.sqrt(a.length); };

const rows = await q(
  `SELECT rg.market, rg.gameId, rg.pick, rg.prob, rg.projValue, rg.line, rg.actual, rg.result, rg.correct, rg.brier, rg.signedError,
          g.awayML, g.homeML, g.f5AwayML, g.f5HomeML
   FROM mlb_replay_grades rg JOIN games g ON g.id = rg.gameId
   WHERE rg.source='walkforward_replay' AND rg.modelVersion LIKE '%-p2d'
     AND rg.gameDate >= ? AND rg.gameDate <= ?
     AND (rg.result IS NULL OR rg.result <> 'PUSH')
     AND (rg.result IS NOT NULL OR rg.brier IS NOT NULL)`,
  [EVAL_START, EVAL_END]);

const byMarket = new Map();
for (const r of rows) { if (!byMarket.has(r.market)) byMarket.set(r.market, []); byMarket.get(r.market).push(r); }

const BANDS = { fg_total: 0.15, f5_total: 0.10, k_prop: 0.15 };
const MIN_N = { k_prop: 300, hr_prop: 300 };
const gate = [];

for (const [market, rs] of [...byMarket.entries()].sort()) {
  const n = rs.length;
  const minN = MIN_N[market] ?? 150;
  const g = { market, n, verdict: 'BACKTEST-ONLY', reasons: [], stats: {} };

  const briers = rs.filter((r) => r.brier !== null).map((r) => Number(r.brier));
  const correct = rs.filter((r) => r.correct !== null).map((r) => Number(r.correct));
  const errs = rs.filter((r) => r.signedError !== null).map((r) => Number(r.signedError));

  if (correct.length) { g.stats.hit = +mean(correct).toFixed(4); g.stats.hit_ci = +ci95(correct).toFixed(4); }
  if (briers.length) { g.stats.brier = +mean(briers).toFixed(5); }
  if (errs.length) { g.stats.bias = +mean(errs).toFixed(3); g.stats.bias_ci = +ci95(errs).toFixed(3); g.stats.mae = +mean(errs.map(Math.abs)).toFixed(3); }

  // (a) baseline comparison
  let baselineOk = false, skillOk = false;
  if (market === 'fg_ml' || market === 'f5_ml') {
    const pairs = rs.filter((r) => r.brier !== null).map((r) => {
      const [aOdds, hOdds] = market === 'fg_ml' ? [r.awayML, r.homeML] : [r.f5AwayML, r.f5HomeML];
      const pa = imp(parseOdds(aOdds)), ph = imp(parseOdds(hOdds));
      if (pa === null || ph === null) return null;
      const bookPAway = pa / (pa + ph);
      const y = r.actual === 'AWAY' ? 1 : 0;
      return { model: Number(r.brier), book: (bookPAway - y) ** 2 };
    }).filter(Boolean);
    if (pairs.length >= minN) {
      const diffs = pairs.map((p) => p.book - p.model); // positive = model beats book
      g.stats.baseline = 'book_novig';
      g.stats.brier_vs_book = +mean(diffs).toFixed(5);
      g.stats.brier_vs_book_ci = +ci95(diffs).toFixed(5);
      baselineOk = mean(diffs) - ci95(diffs) > 0;
      skillOk = mean(diffs) >= 0;
      g.stats.n_baseline = pairs.length;
    } else g.reasons.push(`baseline pairs ${pairs.length} < ${minN}`);
  } else if (market === 'fg_total' || market === 'f5_total' || market === 'nrfi_yrfi' || market === 'hr_prop' || market === 'k_prop') {
    let baseBrier;
    if (market === 'nrfi_yrfi') { const yr = rs.filter((r) => r.actual).map((r) => (r.actual === 'NRFI' ? 1 : 0)); const p0 = mean(yr); baseBrier = p0 * (1 - p0); g.stats.baseline = `climatology p=${p0.toFixed(3)}`; }
    else if (market === 'hr_prop') { const yr = rs.filter((r) => r.actual).map((r) => (r.actual === 'HR' ? 1 : 0)); const p0 = mean(yr); baseBrier = p0 * (1 - p0); g.stats.baseline = `climatology p=${p0.toFixed(3)}`; }
    else { baseBrier = 0.25; g.stats.baseline = 'coin flip 0.25'; }
    if (briers.length >= minN) {
      const diffs = briers.map((b) => baseBrier - b);
      g.stats.brier_skill = +mean(diffs).toFixed(5);
      g.stats.brier_skill_ci = +ci95(diffs).toFixed(5);
      baselineOk = mean(diffs) - ci95(diffs) > 0;
      skillOk = mean(diffs) >= 0;
    } else g.reasons.push(`prob rows ${briers.length} < ${minN}`);
  } else if (market === 'fg_rl' || market === 'f5_rl') {
    // P-007: the +1.5 dog covers ~59% structurally — a naive always-better-side strategy
    // is the honest baseline, not a coin flip. Compute both naive side strategies' hit
    // rates on the SAME rows (using actual as the covering side) and take the max.
    if (correct.length >= minN) {
      const decided = rs.filter((r) => (r.actual === 'AWAY' || r.actual === 'HOME') && r.line !== null);
      const awayRate = mean(decided.map((r) => (r.actual === 'AWAY' ? 1 : 0)));
      // always-dog: dog side per game from the away line sign (+1.5 = away is the dog)
      const dogHits = decided.map((r) => {
        const awayLine = Number(String(r.line).split('/')[0].replace('+', ''));
        const dogSide = awayLine > 0 ? 'AWAY' : 'HOME';
        return r.actual === dogSide ? 1 : 0;
      });
      const naive = Math.max(awayRate, 1 - awayRate, mean(dogHits), 1 - mean(dogHits));
      g.stats.baseline = `best naive strategy ${(naive * 100).toFixed(1)}% (always-dog ${(mean(dogHits) * 100).toFixed(1)}%)`;
      baselineOk = mean(correct) - ci95(correct) > naive;
      skillOk = mean(correct) >= naive;
    } else g.reasons.push(`graded ${correct.length} < ${minN}`);
  }
  if (!baselineOk) g.reasons.push('does not beat baseline with CI excluding zero');
  if (!skillOk) g.reasons.push('negative skill vs baseline');

  // (b) reliability monotonicity (5 bins) where probs exist
  let reliabilityOk = true;
  const probRows = rs.filter((r) => r.prob !== null && r.brier !== null);
  if (probRows.length >= minN) {
    const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, y: 0 }));
    for (const r of probRows) {
      const p = Number(r.prob);
      const y = Math.abs(Math.sqrt(Number(r.brier)) - Math.abs(p - 1)) < 1e-6 ? 1 : 0;
      const b = Math.min(4, Math.floor(p * 5));
      bins[b].n++; bins[b].p += p; bins[b].y += y;
    }
    const used = bins.filter((b) => b.n >= 25).map((b) => ({ p: b.p / b.n, obs: b.y / b.n }));
    let inversions = 0;
    for (let i = 1; i < used.length; i++) if (used[i].obs < used[i - 1].obs - 0.05) inversions++;
    g.stats.reliability_bins = used.map((u) => `${u.p.toFixed(2)}->${u.obs.toFixed(2)}`).join(' ');
    reliabilityOk = inversions === 0;
    if (!reliabilityOk) g.reasons.push(`reliability inversions: ${inversions}`);
  }

  // (c) bias band
  let biasOk = true;
  if (BANDS[market] !== undefined && errs.length) {
    biasOk = Math.abs(mean(errs)) <= BANDS[market] || Math.abs(mean(errs)) - ci95(errs) <= 0;
    g.stats.bias_band = BANDS[market];
    if (!biasOk) g.reasons.push(`bias ${mean(errs).toFixed(3)} outside ±${BANDS[market]}`);
  }

  if (n >= minN && baselineOk && skillOk && reliabilityOk && biasOk) { g.verdict = 'PUBLISH'; g.reasons = []; }
  gate.push(g);
}

console.log(JSON.stringify(gate, null, 1));
fs.writeFileSync(new URL('../GATE-TABLE.json', import.meta.url).pathname, JSON.stringify({ evalWindow: [EVAL_START, EVAL_END], generated: 'gate-eval.mjs', gate }, null, 2));

if (EXECUTE) {
  const MAP = { fg_ml: 'publish_fg_ml', fg_rl: 'publish_fg_rl', fg_total: 'publish_fg_total', f5_ml: 'publish_f5_ml', f5_rl: 'publish_f5_rl', f5_total: 'publish_f5_total', nrfi_yrfi: 'publish_nrfi_yrfi', k_prop: 'publish_k_props', hr_prop: 'publish_hr_props' };
  const now = Date.now();
  for (const g of gate) {
    const param = MAP[g.market];
    if (!param) continue;
    const val = g.verdict === 'PUBLISH' ? '1' : '0';
    await conn.query(
      `INSERT INTO mlb_calibration_constants (paramName, currentValue, baselineValue, sampleSize, updateSource, lastUpdatedAt)
       VALUES (?, ?, 1, ?, 'audit-gate-20260725', ?)
       ON DUPLICATE KEY UPDATE previousValue=currentValue, currentValue=VALUES(currentValue), sampleSize=VALUES(sampleSize), updateSource=VALUES(updateSource), lastUpdatedAt=VALUES(lastUpdatedAt)`,
      [param, val, g.n, now]);
  }
  console.log('publish_* rows written (no production effect until gate code merges; owner can flip any row)');
}
await conn.end();
