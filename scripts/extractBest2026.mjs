/**
 * extractBest2026.mjs
 * Find the best-performing model pass for 2026 WC matches specifically
 * across all completed backtest JSON files (v3-v9 partial).
 */
import { readFileSync, existsSync } from 'fs';

const TAG = '[BEST2026]';

const files = [
  '/tmp/wc_backtest_v3_results.json',
  '/tmp/wc_backtest_v4_results.json',
  '/tmp/wc_backtest_v5_results.json',
  '/tmp/wc_backtest_v6_results.json',
  '/tmp/wc_backtest_v7_results.json',
  '/tmp/wc_backtest_v8_results.json',
  '/tmp/wc_backtest_v9_results.json',
];

console.log(`\n${TAG} ${'='.repeat(72)}`);
console.log(`${TAG} Extracting best 2026-specific accuracy from all backtest files`);
console.log(`${TAG} ${'='.repeat(72)}\n`);

let best = null;
let bestScore2026 = 0;

for (const f of files) {
  if (!existsSync(f)) { console.log(`${TAG} SKIP (not found): ${f}`); continue; }
  try {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    const vNum = (f.match(/v(\d+)/) || [])[0] || '?';
    const label = `${vNum}:${d.params?.label || '?'}`;

    // Get 2026-specific metrics
    const y26 = d.byYear?.[2026];
    if (!y26) { console.log(`${TAG} SKIP (no 2026 data): ${f}`); continue; }

    const ml26 = parseFloat(y26.ml) / 100;
    const draw26 = parseFloat(y26.draw) / 100;
    const dc26 = parseFloat(y26.dc) / 100;
    const total26 = parseFloat(y26.total) / 100;
    const cs26 = parseFloat(y26.cs) / 100;
    const score2026 = ml26 + draw26 + dc26 + total26;

    console.log(`${TAG} ${label}`);
    console.log(`${TAG}   2026: ML=${y26.ml}% Draw=${y26.draw}% DC=${y26.dc}% Total=${y26.total}% CS=${y26.cs}% | score=${score2026.toFixed(4)}`);
    console.log(`${TAG}   ALL:  ML=${(d.accuracy.ml*100).toFixed(1)}% Draw=${(d.accuracy.draw*100).toFixed(1)}% DC=${(d.accuracy.dc*100).toFixed(1)}% Total=${(d.accuracy.total*100).toFixed(1)}%`);
    console.log(`${TAG}   params: eloK=${d.params.eloK ?? d.params.mlEloK} rankK=${d.params.rankK ?? d.params.mlRankK} homeAdv=${d.params.homeAdv} rho=${d.params.rho} bg=${d.params.baseGoals ?? d.params.bgMin + '-' + d.params.bgMax} drawFloor=${d.params.drawFloor} drawBoost=${d.params.drawBoost ?? 'N/A'}`);

    if (score2026 > bestScore2026) {
      bestScore2026 = score2026;
      best = { label, params: d.params, accuracy: d.accuracy, byYear: d.byYear, score2026 };
    }
  } catch (e) {
    console.log(`${TAG} ERROR ${f}: ${e.message}`);
  }
}

console.log(`\n${TAG} ${'='.repeat(72)}`);
console.log(`${TAG} [OUTPUT] BEST FOR 2026: ${best?.label ?? 'none'}`);
if (best) {
  const y26 = best.byYear[2026];
  console.log(`${TAG}   2026: ML=${y26.ml}% Draw=${y26.draw}% DC=${y26.dc}% Total=${y26.total}% CS=${y26.cs}%`);
  console.log(`${TAG}   ALL:  ML=${(best.accuracy.ml*100).toFixed(1)}% Draw=${(best.accuracy.draw*100).toFixed(1)}% DC=${(best.accuracy.dc*100).toFixed(1)}% Total=${(best.accuracy.total*100).toFixed(1)}%`);
  console.log(`${TAG}   params: ${JSON.stringify(best.params)}`);
}
console.log(`${TAG} Done.`);
