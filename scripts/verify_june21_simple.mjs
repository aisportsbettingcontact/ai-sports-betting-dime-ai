/**
 * verify_june21_simple.mjs
 * Simple synchronous-style verification of June 21 DK odds in DB
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get latest DK 1X2 odds for all 4 June 21 fixtures
const [rows] = await conn.execute(`
  SELECT s.fixture_id, s.selection, s.american_odds,
         f.home_team_id, f.away_team_id
  FROM wc2026_odds_snapshots s
  JOIN wc2026_matches f ON s.fixture_id = f.fixture_id
  WHERE s.fixture_id IN ('wc26-g-037','wc26-g-038','wc26-g-039','wc26-g-040')
    AND s.book_id = 68
    AND s.market = '1X2'
  ORDER BY s.fixture_id, s.snapshot_ts DESC, s.selection
`);

const seen = new Set();
const latest = {};
for (const r of rows) {
  const k = `${r.fixture_id}:${r.selection}`;
  if (!seen.has(k)) {
    seen.add(k);
    if (!latest[r.fixture_id]) latest[r.fixture_id] = {};
    latest[r.fixture_id][r.selection] = { odds: r.american_odds, home: r.home_team_id, away: r.away_team_id };
  }
}

console.log('\n[VERIFY] Latest DK 1X2 odds in DB (post-fix):');
console.log('='.repeat(70));

const expected = {
  'wc26-g-039': { home: 'esp', away: 'ksa', homeOdds: -900, awayOdds: 2200, drawOdds: 950, label: 'Spain vs Saudi Arabia' },
  'wc26-g-037': { home: 'irn', away: 'bel', homeOdds: 650, awayOdds: -225, drawOdds: 370, label: 'Iran vs Belgium' },
  'wc26-g-040': { home: 'cpv', away: 'uru', homeOdds: 750, awayOdds: -215, drawOdds: 320, label: 'Cape Verde vs Uruguay' },
  'wc26-g-038': { home: 'nzl', away: 'egy', homeOdds: 500, awayOdds: -165, drawOdds: 300, label: 'New Zealand vs Egypt' },
};

let allPass = true;
for (const [fid, exp] of Object.entries(expected)) {
  const db = latest[fid] ?? {};
  const homeOdds = db.home?.odds;
  const awayOdds = db.away?.odds;
  const drawOdds = db.draw?.odds;
  
  const homePass = homeOdds === exp.homeOdds;
  const awayPass = awayOdds === exp.awayOdds;
  const drawPass = drawOdds === exp.drawOdds;
  const pass = homePass && awayPass && drawPass;
  if (!pass) allPass = false;
  
  console.log(`\n  ${fid} — ${exp.label}`);
  console.log(`  DB home(${exp.home}): ${homeOdds > 0 ? '+' : ''}${homeOdds ?? 'MISSING'} | Expected: ${exp.homeOdds > 0 ? '+' : ''}${exp.homeOdds} | ${homePass ? '✅' : '❌ WRONG'}`);
  console.log(`  DB away(${exp.away}): ${awayOdds > 0 ? '+' : ''}${awayOdds ?? 'MISSING'} | Expected: ${exp.awayOdds > 0 ? '+' : ''}${exp.awayOdds} | ${awayPass ? '✅' : '❌ WRONG'}`);
  console.log(`  DB draw:       ${drawOdds > 0 ? '+' : ''}${drawOdds ?? 'MISSING'} | Expected: ${exp.drawOdds > 0 ? '+' : ''}${exp.drawOdds} | ${drawPass ? '✅' : '❌ WRONG'}`);
}

console.log(`\n[RESULT] Overall: ${allPass ? '✅ ALL PASS' : '❌ FAILURES DETECTED'}`);

await conn.end();
