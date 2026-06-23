/**
 * resolveUnmatched2.mjs
 * Searches ±2 days around expected dates for wc26-g-002 and wc26-g-030
 * ESPN uses "Korea Republic" for South Korea, "Türkiye" for Turkey
 */
import dotenv from 'dotenv';
dotenv.config();

async function fetchEspnDate(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard?dates=${dateStr}&limit=20`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).filter(e => e.status?.type?.completed === true);
  } catch (e) {
    return [];
  }
}

function addDays(dateStr, delta) {
  const y = parseInt(dateStr.slice(0,4));
  const m = parseInt(dateStr.slice(4,6)) - 1;
  const d = parseInt(dateStr.slice(6,8));
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const dd = String(dt.getDate()).padStart(2,'0');
  return `${yy}${mm}${dd}`;
}

const TARGETS = [
  {
    id: 'wc26-g-002',
    dbHome: 'South Korea', dbAway: 'Czech Republic',
    dbHS: 2, dbAS: 1,
    baseDate: '20260612',
    // ESPN name variants to look for
    homeVariants: ['south korea', 'korea republic', 'korea'],
    awayVariants: ['czech republic', 'czechia', 'czech'],
  },
  {
    id: 'wc26-g-030',
    dbHome: 'Turkey', dbAway: 'Paraguay',
    dbHS: 0, dbAS: 1,
    baseDate: '20260620',
    homeVariants: ['turkey', 'türkiye', 'turkiye'],
    awayVariants: ['paraguay'],
  },
];

function matchesTarget(espnName, variants) {
  const n = espnName.toLowerCase().trim();
  return variants.some(v => n.includes(v) || v.includes(n));
}

console.log('══════════════════════════════════════════════════════════════════════');
console.log('[STEP] resolveUnmatched2.mjs — Searching ±2 days for 2 unresolved fixtures');
console.log('══════════════════════════════════════════════════════════════════════');

for (const target of TARGETS) {
  console.log(`\n[STEP] ${target.id} | ${target.dbHome} vs ${target.dbAway} | DB score: ${target.dbHS}-${target.dbAS}`);
  let found = false;

  for (let delta = -2; delta <= 2; delta++) {
    const dateStr = addDays(target.baseDate, delta);
    const events = await fetchEspnDate(dateStr);
    console.log(`  [ESPN] ${dateStr} (delta=${delta > 0 ? '+' : ''}${delta}): ${events.length} completed events`);

    for (const e of events) {
      const comps = e.competitions?.[0]?.competitors || [];
      const homeComp = comps.find(c => c.homeAway === 'home');
      const awayComp = comps.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      const hn = homeComp.team?.displayName || homeComp.team?.name || '';
      const an = awayComp.team?.displayName || awayComp.team?.name || '';
      const hs = parseInt(homeComp.score, 10);
      const as_ = parseInt(awayComp.score, 10);

      // Check both orientations
      const normalMatch = matchesTarget(hn, target.homeVariants) && matchesTarget(an, target.awayVariants);
      const swappedMatch = matchesTarget(hn, target.awayVariants) && matchesTarget(an, target.homeVariants);

      if (normalMatch || swappedMatch) {
        const espnDbHS = normalMatch ? hs : as_;
        const espnDbAS = normalMatch ? as_ : hs;
        const pass = target.dbHS === espnDbHS && target.dbAS === espnDbAS;

        console.log(`    [MATCH FOUND] ${hn} ${hs}-${as_} ${an} on ${dateStr} (swapped=${swappedMatch})`);
        console.log(`    [DB]          ${target.dbHome} ${target.dbHS}-${target.dbAS} ${target.dbAway}`);
        console.log(`    [EXPECTED DB] home=${espnDbHS}, away=${espnDbAS}`);
        console.log(`    [RESULT] ${pass ? '✅ PASS — DB score matches ESPN' : '❌ FAIL — DB score WRONG, ESPN says ' + espnDbHS + '-' + espnDbAS}`);
        found = true;
      } else {
        // Print all events for transparency
        console.log(`    [event] ${hn} ${hs}-${as_} ${an}`);
      }
    }
  }

  if (!found) {
    console.error(`  [❌] ${target.id}: No ESPN event found within ±2 days of ${target.baseDate}`);
  }
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('[FINAL] Search complete');
console.log('══════════════════════════════════════════════════════════════════════');
