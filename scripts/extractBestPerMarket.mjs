import { readFileSync } from 'fs';

const files = [
  '/tmp/wc_backtest_v3_results.json',
  '/tmp/wc_backtest_v4_results.json',
  '/tmp/wc_backtest_v5_results.json',
  '/tmp/wc_backtest_v6_results.json',
];

let bestML = null, bestDraw = null, bestDC = null, bestTotal = null;

for (const f of files) {
  try {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    const acc = d.accuracy;
    const vNum = (f.match(/v(\d+)/) || [])[0] || '?';
    const label = `${vNum}:${d.params.label || '?'}`;

    if (!bestML || acc.ml > bestML.acc) bestML = { acc: acc.ml, label, params: d.params, byYear: d.byYear };
    if (!bestDraw || acc.draw > bestDraw.acc) bestDraw = { acc: acc.draw, label, params: d.params, byYear: d.byYear };
    if (!bestDC || acc.dc > bestDC.acc) bestDC = { acc: acc.dc, label, params: d.params, byYear: d.byYear };
    if (!bestTotal || acc.total > bestTotal.acc) bestTotal = { acc: acc.total, label, params: d.params, byYear: d.byYear };
  } catch (e) {
    console.log('SKIP', f, e.message);
  }
}

console.log('\n=== BEST PER MARKET ACROSS ALL PASSES ===\n');

console.log(`BEST ML:    ${(bestML.acc*100).toFixed(2)}%  from ${bestML.label}`);
console.log(`  params: baseGoals=${bestML.params.baseGoals} eloDivisor=${bestML.params.eloDivisor ?? 'N/A(eloK='+bestML.params.eloK+')'} rankK=${bestML.params.rankK} homeAdv=${bestML.params.homeAdv} rho=${bestML.params.rho} drawFloor=${bestML.params.drawFloor} drawThreshold=${bestML.params.drawThreshold ?? 'N/A'}`);
console.log(`  byYear: 2018=${bestML.byYear?.[2018]?.ml}% 2022=${bestML.byYear?.[2022]?.ml}% 2026=${bestML.byYear?.[2026]?.ml}%`);

console.log(`\nBEST DRAW:  ${(bestDraw.acc*100).toFixed(2)}%  from ${bestDraw.label}`);
console.log(`  params: baseGoals=${bestDraw.params.baseGoals} eloDivisor=${bestDraw.params.eloDivisor ?? 'N/A(eloK='+bestDraw.params.eloK+')'} rankK=${bestDraw.params.rankK} homeAdv=${bestDraw.params.homeAdv} rho=${bestDraw.params.rho} drawFloor=${bestDraw.params.drawFloor} drawThreshold=${bestDraw.params.drawThreshold ?? 'N/A'}`);
console.log(`  byYear: 2018=${bestDraw.byYear?.[2018]?.draw}% 2022=${bestDraw.byYear?.[2022]?.draw}% 2026=${bestDraw.byYear?.[2026]?.draw}%`);

console.log(`\nBEST DC:    ${(bestDC.acc*100).toFixed(2)}%  from ${bestDC.label}`);
console.log(`  params: baseGoals=${bestDC.params.baseGoals} eloDivisor=${bestDC.params.eloDivisor ?? 'N/A(eloK='+bestDC.params.eloK+')'} rankK=${bestDC.params.rankK} homeAdv=${bestDC.params.homeAdv} rho=${bestDC.params.rho} drawFloor=${bestDC.params.drawFloor} drawThreshold=${bestDC.params.drawThreshold ?? 'N/A'}`);
console.log(`  byYear: 2018=${bestDC.byYear?.[2018]?.dc}% 2022=${bestDC.byYear?.[2022]?.dc}% 2026=${bestDC.byYear?.[2026]?.dc}%`);

console.log(`\nBEST TOTAL: ${(bestTotal.acc*100).toFixed(2)}%  from ${bestTotal.label}`);
console.log(`  params: baseGoals=${bestTotal.params.baseGoals} eloDivisor=${bestTotal.params.eloDivisor ?? 'N/A(eloK='+bestTotal.params.eloK+')'} rankK=${bestTotal.params.rankK} homeAdv=${bestTotal.params.homeAdv} rho=${bestTotal.params.rho} drawFloor=${bestTotal.params.drawFloor} drawThreshold=${bestTotal.params.drawThreshold ?? 'N/A'}`);
console.log(`  byYear: 2018=${bestTotal.byYear?.[2018]?.total}% 2022=${bestTotal.byYear?.[2022]?.total}% 2026=${bestTotal.byYear?.[2026]?.total}%`);

console.log('\n=== KEY TAKEAWAYS ===');
console.log('ML champion:    eloK/eloDivisor, rankK, homeAdv, rho, drawFloor from best ML pass');
console.log('Draw champion:  drawThreshold=1.0 (never-predict-draw) = 76.47% baseline');
console.log('DC champion:    DC is derived from ML — improving ML improves DC');
console.log('Total champion: baseGoals calibration — lower base goals → more unders predicted');
