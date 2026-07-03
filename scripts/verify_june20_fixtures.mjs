import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [rows] = await conn.execute(
  `SELECT fixture_id, home_team_id, away_team_id, kickoff_utc 
   FROM wc2026_matches 
   WHERE fixture_id IN ('wc26-g-033','wc26-g-034','wc26-g-035','wc26-g-036') 
   ORDER BY fixture_id`
);

console.log('\n[VERIFY] June 20 Fixture Orientations (post-correction):');
console.log('═══════════════════════════════════════════════════════');
for (const r of rows) {
  const espnExpected = {
    'wc26-g-033': { home: 'ger', away: 'civ' },
    'wc26-g-034': { home: 'ecu', away: 'cuw' },
    'wc26-g-035': { home: 'ned', away: 'swe' },
    'wc26-g-036': { home: 'tun', away: 'jpn' },
  };
  const expected = espnExpected[r.fixture_id];
  const homeOk = r.home_team_id === expected?.home;
  const awayOk = r.away_team_id === expected?.away;
  const status = homeOk && awayOk ? '✅ CORRECT' : '❌ STILL WRONG';
  console.log(`  ${r.fixture_id}: home=${r.home_team_id} away=${r.away_team_id} | ESPN: home=${expected?.home} away=${expected?.away} | ${status}`);
}

// Check odds snapshot counts for June 20 fixtures
const [oddsRows] = await conn.execute(
  `SELECT fixture_id, COUNT(*) as cnt, 
          MIN(snapshot_ts) as first_snap, MAX(snapshot_ts) as last_snap
   FROM wc2026_odds_snapshots 
   WHERE fixture_id IN ('wc26-g-033','wc26-g-034','wc26-g-035','wc26-g-036')
   GROUP BY fixture_id`
);
console.log('\n[VERIFY] Odds Snapshot Counts:');
for (const r of oddsRows) {
  console.log(`  ${r.fixture_id}: ${r.cnt} rows | first=${r.first_snap} last=${r.last_snap}`);
}

await conn.end();
