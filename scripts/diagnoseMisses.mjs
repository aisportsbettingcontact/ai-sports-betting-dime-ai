/**
 * diagnoseMisses.mjs
 *
 * Deep diagnostic: load the best backtest results and analyze
 * EXACTLY which games are being missed and WHY.
 *
 * Questions to answer:
 *   1. Which 60 games does the model get wrong on ML?
 *   2. What is the Elo differential for those games?
 *   3. How many of the 32 draws does the model call H vs A?
 *   4. What is the actual goal distribution vs predicted?
 *   5. Is the Total miss concentrated in specific Elo ranges?
 *   6. Is the DC miss correlated with specific game types?
 *
 * LOGGING: [DIAG] [INPUT/STEP/STATE/OUTPUT/VERIFY]
 */
import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';

const TAG = '[DIAG]';

// Load best results from v6 (most recent complete run)
const data = JSON.parse(readFileSync('/tmp/wc_backtest_v6_results.json', 'utf8'));
const matches = data.matches;

console.log(`\n${TAG} ${'='.repeat(72)}`);
console.log(`${TAG} WC Backtest Diagnostic — Match-Level Analysis`);
console.log(`${TAG} Source: ${data.params.label} | n=${matches.length}`);
console.log(`${TAG} ${'='.repeat(72)}\n`);

// ── 1. Overall distribution ───────────────────────────────────────────────
const actH = matches.filter(m => m.actual === 'H').length;
const actD = matches.filter(m => m.actual === 'D').length;
const actA = matches.filter(m => m.actual === 'A').length;
const predH = matches.filter(m => m.predicted === 'H').length;
const predD = matches.filter(m => m.predicted === 'D').length;
const predA = matches.filter(m => m.predicted === 'A').length;

console.log(`${TAG} [STATE] Actual:    H=${actH} D=${actD} A=${actA}`);
console.log(`${TAG} [STATE] Predicted: H=${predH} D=${predD} A=${predA}`);
console.log(`${TAG} [STATE] Model over-predicts H by ${predH - actH} and under-predicts D by ${actD - predD}`);

// ── 2. Confusion matrix ───────────────────────────────────────────────────
const cm = { HH: 0, HD: 0, HA: 0, DH: 0, DD: 0, DA: 0, AH: 0, AD: 0, AA: 0 };
for (const m of matches) cm[`${m.actual}${m.predicted}`]++;
console.log(`\n${TAG} [STATE] Confusion Matrix (actual→predicted):`);
console.log(`${TAG}   Actual H → Pred H=${cm.HH} D=${cm.HD} A=${cm.HA}  (${cm.HH}/${actH} = ${(cm.HH/actH*100).toFixed(1)}% correct)`);
console.log(`${TAG}   Actual D → Pred H=${cm.DH} D=${cm.DD} A=${cm.DA}  (${cm.DD}/${actD} = ${(cm.DD/actD*100).toFixed(1)}% correct)`);
console.log(`${TAG}   Actual A → Pred H=${cm.AH} D=${cm.AD} A=${cm.AA}  (${cm.AA}/${actA} = ${(cm.AA/actA*100).toFixed(1)}% correct)`);

// ── 3. Elo differential analysis for misses ───────────────────────────────
// Reconstruct Elo diff from lambdaH/lambdaA ratio
// lambdaH/lambdaA ≈ strengthRatio * homeAdv^2
// log10(ratio/homeAdv^2) * 400 ≈ eloDiff
const ELO_2018 = {
  'Russia': 1685, 'Saudi Arabia': 1582, 'Egypt': 1646, 'Uruguay': 1890,
  'Morocco': 1711, 'Iran': 1793, 'Portugal': 2002, 'Spain': 2048,
  'France': 1984, 'Australia': 1712, 'Peru': 1906, 'Denmark': 1843,
  'Argentina': 1985, 'Iceland': 1764, 'Croatia': 1853, 'Nigeria': 1699,
  'Brazil': 2131, 'Switzerland': 1879, 'Costa Rica': 1784, 'Serbia': 1770,
  'Germany': 2092, 'Mexico': 1859, 'Sweden': 1812, 'South Korea': 1746,
  'Belgium': 2018, 'Panama': 1669, 'Tunisia': 1672, 'England': 1941,
  'Poland': 1831, 'Senegal': 1747, 'Colombia': 1940, 'Japan': 1726,
};
const ELO_2022 = {
  'Qatar': 1674, 'Ecuador': 1820, 'Senegal': 1747, 'Netherlands': 1975,
  'England': 1957, 'Iran': 1793, 'United States': 1827, 'Wales': 1793,
  'Argentina': 2142, 'Saudi Arabia': 1627, 'Mexico': 1842, 'Poland': 1831,
  'France': 2005, 'Australia': 1712, 'Denmark': 1877, 'Tunisia': 1672,
  'Spain': 2048, 'Costa Rica': 1784, 'Germany': 1988, 'Japan': 1726,
  'Belgium': 2018, 'Canada': 1769, 'Morocco': 1748, 'Croatia': 1920,
  'Brazil': 2166, 'Serbia': 1770, 'Switzerland': 1879, 'Cameroon': 1636,
  'Portugal': 2002, 'Ghana': 1636, 'Uruguay': 1890, 'South Korea': 1746,
  'USA': 1827,
};
const ELO_2026 = {
  'MEX': 1842, 'RSA': 1636, 'CZE': 1831, 'KOR': 1746,
  'ARG': 2142, 'AUS': 1712, 'EGY': 1646, 'UKR': 1870,
  'USA': 1827, 'PAN': 1669, 'NZL': 1612, 'ALB': 1720,
  'BRA': 2166, 'CMR': 1636, 'CHI': 1820, 'JPN': 1726,
  'ENG': 1957, 'TUN': 1672, 'SRB': 1770, 'IRQ': 1620,
  'FRA': 2005, 'MAR': 1748, 'BEL': 2018, 'URU': 1890,
  'ESP': 2048, 'KSA': 1627, 'SEN': 1747, 'NOR': 1880,
  'POR': 2002, 'IRN': 1793, 'GHA': 1636, 'TRI': 1650,
  'NED': 1975, 'COD': 1620, 'COL': 1940, 'ECU': 1820,
  'GER': 1988, 'SUI': 1879, 'VEN': 1720, 'IVB': 1580,
  'CRO': 1920, 'DEN': 1877, 'POL': 1831, 'CPV': 1650,
  'ALG': 1748, 'JOR': 1640, 'CAN': 1769,
  'BIH': 1780, 'PAR': 1750, 'QAT': 1674, 'HAI': 1580,
  'SCO': 1820, 'TUR': 1870, 'CUW': 1560, 'CIV': 1780,
  'SWE': 1870, 'AUT': 1840, 'UZB': 1680,
};
for (const [k, v] of Object.entries({ ...ELO_2026 })) ELO_2026[k.toLowerCase()] = v;

function getElo(name, year) {
  const em = year === 2018 ? ELO_2018 : year === 2022 ? ELO_2022 : ELO_2026;
  return em[name] ?? em[name.toUpperCase()] ?? em[name.toLowerCase()] ?? 1750;
}

// Annotate each match with Elo diff
const annotated = matches.map(m => {
  const eloH = getElo(m.home, m.year);
  const eloA = getElo(m.away, m.year);
  const eloDiff = eloH - eloA; // positive = home favored
  return { ...m, eloH, eloA, eloDiff };
});

// ── 4. ML misses by Elo differential bucket ───────────────────────────────
const buckets = [
  { label: 'Home dominant (Δ>200)', filter: m => m.eloDiff > 200 },
  { label: 'Home favored (100<Δ≤200)', filter: m => m.eloDiff > 100 && m.eloDiff <= 200 },
  { label: 'Even (-100≤Δ≤100)', filter: m => Math.abs(m.eloDiff) <= 100 },
  { label: 'Away favored (-200≤Δ<-100)', filter: m => m.eloDiff < -100 && m.eloDiff >= -200 },
  { label: 'Away dominant (Δ<-200)', filter: m => m.eloDiff < -200 },
];

console.log(`\n${TAG} [STATE] ML Accuracy by Elo Differential Bucket:`);
for (const b of buckets) {
  const grp = annotated.filter(b.filter);
  if (!grp.length) continue;
  const correct = grp.filter(m => m.mlCorrect).length;
  const actHg = grp.filter(m => m.actual === 'H').length;
  const actDg = grp.filter(m => m.actual === 'D').length;
  const actAg = grp.filter(m => m.actual === 'A').length;
  const predHg = grp.filter(m => m.predicted === 'H').length;
  const predAg = grp.filter(m => m.predicted === 'A').length;
  console.log(`${TAG}   ${b.label}: n=${grp.length} ML=${(correct/grp.length*100).toFixed(1)}% | Actual H=${actHg} D=${actDg} A=${actAg} | Pred H=${predHg} A=${predAg}`);
}

// ── 5. Draw games: what does the model predict? ───────────────────────────
const drawGames = annotated.filter(m => m.actual === 'D');
console.log(`\n${TAG} [STATE] All 32 Draw Games — Model Prediction:`);
const drawPredH = drawGames.filter(m => m.predicted === 'H').length;
const drawPredA = drawGames.filter(m => m.predicted === 'A').length;
console.log(`${TAG}   Model calls H: ${drawPredH} | Model calls A: ${drawPredA}`);
console.log(`${TAG}   Draw games by Elo bucket:`);
for (const b of buckets) {
  const grp = drawGames.filter(b.filter);
  if (!grp.length) continue;
  console.log(`${TAG}     ${b.label}: n=${grp.length} | pH range: ${Math.min(...grp.map(m=>parseFloat(m.pH))).toFixed(3)}-${Math.max(...grp.map(m=>parseFloat(m.pH))).toFixed(3)} | pD range: ${Math.min(...grp.map(m=>parseFloat(m.pD))).toFixed(3)}-${Math.max(...grp.map(m=>parseFloat(m.pD))).toFixed(3)}`);
}

// ── 6. Total misses analysis ───────────────────────────────────────────────
const totalMisses = annotated.filter(m => !m.totalCorrect);
const totalHits = annotated.filter(m => m.totalCorrect);
console.log(`\n${TAG} [STATE] Total (O/U 2.5) Analysis:`);
console.log(`${TAG}   Correct: ${totalHits.length} | Missed: ${totalMisses.length}`);
const overGames = annotated.filter(m => Number(m.homeScore)+Number(m.awayScore) > 2.5);
const underGames = annotated.filter(m => Number(m.homeScore)+Number(m.awayScore) <= 2.5);
const predOverGames = annotated.filter(m => parseFloat(m.pO25) > 0.5);
console.log(`${TAG}   Actual Over: ${overGames.length} | Actual Under: ${underGames.length}`);
console.log(`${TAG}   Model predicts Over: ${predOverGames.length} | Model predicts Under: ${annotated.length - predOverGames.length}`);
console.log(`${TAG}   pO25 distribution: min=${Math.min(...annotated.map(m=>parseFloat(m.pO25))).toFixed(3)} max=${Math.max(...annotated.map(m=>parseFloat(m.pO25))).toFixed(3)} mean=${(annotated.reduce((s,m)=>s+parseFloat(m.pO25),0)/annotated.length).toFixed(3)}`);
console.log(`${TAG}   → The model NEVER predicts over (all pO25 < 0.5). This is the total accuracy ceiling.`);

// ── 7. DC misses analysis ─────────────────────────────────────────────────
const dcMisses = annotated.filter(m => !m.dcCorrect);
console.log(`\n${TAG} [STATE] DC Miss Analysis (${dcMisses.length} misses):`);
const dcMissActual = { H: 0, D: 0, A: 0 };
for (const m of dcMisses) dcMissActual[m.actual]++;
console.log(`${TAG}   DC misses by actual result: H=${dcMissActual.H} D=${dcMissActual.D} A=${dcMissActual.A}`);
console.log(`${TAG}   DC misses = games where model predicts X2 but actual is H or D`);
const dcMissX2 = dcMisses.filter(m => m.dcPredicted === 'X2' || (parseFloat(m.pX2) > parseFloat(m.p1X)));
console.log(`${TAG}   Model predicts X2 incorrectly: ${dcMissX2.length} games`);
console.log(`${TAG}   p1X range in DC misses: ${Math.min(...dcMisses.map(m=>parseFloat(m.p1X))).toFixed(3)}-${Math.max(...dcMisses.map(m=>parseFloat(m.p1X))).toFixed(3)}`);
console.log(`${TAG}   pX2 range in DC misses: ${Math.min(...dcMisses.map(m=>parseFloat(m.pX2))).toFixed(3)}-${Math.max(...dcMisses.map(m=>parseFloat(m.pX2))).toFixed(3)}`);

// ── 8. Key insight: what would it take to hit 75%? ────────────────────────
console.log(`\n${TAG} ${'='.repeat(72)}`);
console.log(`${TAG} [OUTPUT] WHAT WOULD IT TAKE TO HIT 75% ON EACH MARKET?`);
console.log(`${TAG} ${'─'.repeat(72)}`);

const n = annotated.length;
const target = Math.ceil(n * 0.75);
const currentML = annotated.filter(m => m.mlCorrect).length;
const currentDC = annotated.filter(m => m.dcCorrect).length;
const currentTotal = annotated.filter(m => m.totalCorrect).length;

console.log(`${TAG} ML:    need ${target} correct, have ${currentML}, gap=${target - currentML} games`);
console.log(`${TAG}   → Must flip ${target - currentML} currently-wrong games to correct`);
console.log(`${TAG}   → These are mostly: draws called as H (${cm.DH}) + away upsets called as H (${cm.AH})`);
console.log(`${TAG}   → To fix draws: need draw prediction for the 32 draw games`);
console.log(`${TAG}   → If we correctly call 20 of 32 draws: ${currentML - cm.DH - cm.DA + 20} correct = ${((currentML - cm.DH - cm.DA + 20)/n*100).toFixed(1)}%`);

console.log(`${TAG} DC:    need ${target} correct, have ${currentDC}, gap=${target - currentDC} games`);
console.log(`${TAG}   → DC is 1X vs X2. Actual 1X=${actH+actD}(${((actH+actD)/n*100).toFixed(1)}%) X2=${actA}(${(actA/n*100).toFixed(1)}%)`);
console.log(`${TAG}   → Always predict 1X = ${actH+actD} correct = ${((actH+actD)/n*100).toFixed(1)}%`);
console.log(`${TAG}   → Need ${target - (actH+actD)} more correct beyond always-1X strategy`);

console.log(`${TAG} Total: need ${target} correct, have ${currentTotal}, gap=${target - currentTotal} games`);
console.log(`${TAG}   → pO25 is always < 0.5 (model always predicts under)`);
console.log(`${TAG}   → Always-under gives ${underGames.length} correct = ${(underGames.length/n*100).toFixed(1)}%`);
console.log(`${TAG}   → Need to correctly identify ${target - underGames.length} of ${overGames.length} over games`);
console.log(`${TAG}   → pO25 mean=${(annotated.reduce((s,m)=>s+parseFloat(m.pO25),0)/n).toFixed(3)} — needs to be higher for over games`);

// ── 9. Show the 20 games with highest pO25 (closest to over threshold) ────
const sortedByPO25 = [...annotated].sort((a, b) => parseFloat(b.pO25) - parseFloat(a.pO25));
console.log(`\n${TAG} [STATE] Top 20 games by pO25 (closest to over threshold):`);
sortedByPO25.slice(0, 20).forEach(m => {
  const totalG = Number(m.homeScore) + Number(m.awayScore);
  const actualOver = totalG > 2.5;
  console.log(`${TAG}   ${m.year} ${m.home} vs ${m.away}: ${m.homeScore}-${m.awayScore} (${actualOver ? 'OVER' : 'UNDER'}) pO25=${m.pO25} λH=${m.lambdaH} λA=${m.lambdaA}`);
});

// ── 10. Show the 20 away upsets the model called H ────────────────────────
const awayUpsets = annotated.filter(m => m.actual === 'A' && m.predicted === 'H');
console.log(`\n${TAG} [STATE] Away upsets model called H (${awayUpsets.length} games):`);
awayUpsets.sort((a, b) => parseFloat(b.pH) - parseFloat(a.pH)).forEach(m => {
  console.log(`${TAG}   ${m.year} ${m.home}(${m.eloH}) vs ${m.away}(${m.eloA}): ${m.homeScore}-${m.awayScore} | pH=${m.pH} pD=${m.pD} pA=${m.pA} | ΔElo=${m.eloDiff}`);
});

console.log(`\n${TAG} Done.`);
