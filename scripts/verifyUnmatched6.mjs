/**
 * verifyUnmatched6.mjs
 * Directly verifies the 6 unmatched 2026 WC matches against ESPN API
 * by fetching the specific date for each and matching by any name variant.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// The 6 unmatched matches with their DB data
const MATCHES = [
  { id: 'wc26-g-002', dbHome: 'South Korea',            dbAway: 'Czech Republic',          dbHS: 2, dbAS: 1, date: '20260612' },
  { id: 'wc26-g-003', dbHome: 'Bosnia and Herzegovina', dbAway: 'Canada',                  dbHS: 1, dbAS: 1, date: '20260612' },
  { id: 'wc26-g-008', dbHome: 'Australia',              dbAway: 'Turkey',                  dbHS: 2, dbAS: 0, date: '20260614' },
  { id: 'wc26-g-025', dbHome: 'Czech Republic',         dbAway: 'South Africa',            dbHS: 1, dbAS: 1, date: '20260618' },
  { id: 'wc26-g-027', dbHome: 'Switzerland',            dbAway: 'Bosnia and Herzegovina',  dbHS: 4, dbAS: 1, date: '20260618' },
  { id: 'wc26-g-030', dbHome: 'Turkey',                 dbAway: 'Paraguay',                dbHS: 0, dbAS: 1, date: '20260620' },
];

// Expanded name aliases for ESPN matching
const ALIASES = {
  'south korea': ['south korea', 'korea republic', 'korea'],
  'czech republic': ['czech republic', 'czechia', 'czech'],
  'bosnia and herzegovina': ['bosnia and herzegovina', 'bosnia-herzegovina', 'bosnia', 'bih'],
  'turkey': ['turkey', 'türkiye', 'turkiye'],
  'australia': ['australia'],
  'canada': ['canada'],
  'switzerland': ['switzerland'],
  'south africa': ['south africa'],
  'paraguay': ['paraguay'],
};

function normalize(name) {
  if (!name) return '';
  const n = name.toLowerCase().trim();
  // Check if any alias group contains this name
  for (const [canonical, variants] of Object.entries(ALIASES)) {
    if (variants.some(v => n.includes(v) || v.includes(n))) return canonical;
  }
  return n;
}

async function fetchEspnDate(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.WORLD/scoreboard?dates=${dateStr}&limit=20`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.events || []).filter(e => e.status?.type?.completed === true);
}

console.log('══════════════════════════════════════════════════════════════════════');
console.log('[STEP] verifyUnmatched6.mjs — Verifying 6 unmatched 2026 WC matches');
console.log('══════════════════════════════════════════════════════════════════════');

let allPass = true;

for (const fix of MATCHES) {
  console.log(`\n[STEP] ${fix.id} | ${fix.dbHome} vs ${fix.dbAway} | ESPN date: ${fix.date}`);
  const events = await fetchEspnDate(fix.date);
  console.log(`  [ESPN] ${events.length} completed events on ${fix.date}`);

  // Log all events on this date for full transparency
  for (const e of events) {
    const comps = e.competitions?.[0]?.competitors || [];
    const home = comps.find(c => c.homeAway === 'home');
    const away = comps.find(c => c.homeAway === 'away');
    if (!home || !away) continue;
    const hn = home.team?.displayName || home.team?.name || '';
    const an = away.team?.displayName || away.team?.name || '';
    console.log(`    [EVENT] ${hn} ${home.score}-${away.score} ${an} (id=${e.id})`);
  }

  // Find matching event
  const dbHomeNorm = normalize(fix.dbHome);
  const dbAwayNorm = normalize(fix.dbAway);

  const match = events.find(e => {
    const comps = e.competitions?.[0]?.competitors || [];
    const home = comps.find(c => c.homeAway === 'home');
    const away = comps.find(c => c.homeAway === 'away');
    if (!home || !away) return false;
    const hn = normalize(home.team?.displayName || home.team?.name || '');
    const an = normalize(away.team?.displayName || away.team?.name || '');
    return (hn === dbHomeNorm && an === dbAwayNorm) || (hn === dbAwayNorm && an === dbHomeNorm);
  });

  if (!match) {
    console.error(`  [❌] No ESPN event found for ${fix.dbHome} vs ${fix.dbAway} on ${fix.date}`);
    allPass = false;
    continue;
  }

  const comps = match.competitions?.[0]?.competitors || [];
  const homeComp = comps.find(c => c.homeAway === 'home');
  const awayComp = comps.find(c => c.homeAway === 'away');
  const espnHomeName = homeComp?.team?.displayName || homeComp?.team?.name || '';
  const espnAwayName = awayComp?.team?.displayName || awayComp?.team?.name || '';
  const espnHomeScore = parseInt(homeComp?.score, 10);
  const espnAwayScore = parseInt(awayComp?.score, 10);

  // Determine if ESPN home/away is swapped vs DB
  const espnHomeNorm = normalize(espnHomeName);
  const espnAwayNorm = normalize(espnAwayName);
  const swapped = espnHomeNorm === dbAwayNorm && espnAwayNorm === dbHomeNorm;

  const expectedDbHS = swapped ? espnAwayScore : espnHomeScore;
  const expectedDbAS = swapped ? espnHomeScore : espnAwayScore;

  const pass = fix.dbHS === expectedDbHS && fix.dbAS === expectedDbAS;

  console.log(`  [ESPN] ${espnHomeName} ${espnHomeScore}-${espnAwayScore} ${espnAwayName} (swapped=${swapped})`);
  console.log(`  [DB]   ${fix.dbHome} ${fix.dbHS}-${fix.dbAS} ${fix.dbAway}`);
  console.log(`  [EXPECTED DB] home=${expectedDbHS}, away=${expectedDbAS}`);
  console.log(`  [RESULT] ${pass ? '✅ PASS — DB score matches ESPN' : '❌ FAIL — DISCREPANCY FOUND'}`);

  if (!pass) {
    console.error(`  [FIX NEEDED] ${fix.id}: DB has ${fix.dbHS}-${fix.dbAS}, ESPN says ${expectedDbHS}-${expectedDbAS}`);
    allPass = false;
  }
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`[FINAL] ${allPass ? '✅ ALL 6 UNMATCHED MATCHES VERIFIED CORRECT' : '❌ DISCREPANCIES FOUND — fixes required'}`);
console.log('══════════════════════════════════════════════════════════════════════');

await db.end();
