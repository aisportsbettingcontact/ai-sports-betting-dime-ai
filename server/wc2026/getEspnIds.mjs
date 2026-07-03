import mysql from 'mysql2/promise';
import 'dotenv/config';

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname, port: parseInt(url.port || '3306'),
  user: url.username, password: url.password,
  database: url.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

const TARGET_IDS = [
  'wc26-r32-079',
  'wc26-r32-080','wc26-r32-081','wc26-r32-082','wc26-r32-083','wc26-r32-084',
  'wc26-r32-085','wc26-r32-086','wc26-r32-087','wc26-r32-088',
  'wc26-r16-089','wc26-r16-090','wc26-r16-091'
];

const ph = TARGET_IDS.map(() => '?').join(',');
const [rows] = await conn.execute(`
  SELECT f.match_id, f.stage, f.match_date, f.kickoff_utc,
         f.espn_event_id, f.venue_id,
         v.stadium, v.city, v.country, v.timezone,
         ht.name AS home_name, at.name AS away_name
  FROM wc2026_matches f
  LEFT JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  LEFT JOIN wc2026_teams at ON f.away_team_id = at.team_id
  LEFT JOIN wc2026_venues v ON f.venue_id = v.venue_id
  WHERE f.match_id IN (${ph})
  ORDER BY f.kickoff_utc, f.match_id
`, TARGET_IDS);

console.log('\n[MATCH DATA — 13 TARGET MATCHES]');
console.log('match_id          | match_date | kickoff_utc (UTC)    | espn_event_id | venue_id | stadium                    | city          | away @ home');
console.log('─'.repeat(160));
for (const r of rows) {
  const md = r.match_date instanceof Date ? r.match_date.toISOString().split('T')[0] : String(r.match_date).split('T')[0];
  const ku = r.kickoff_utc instanceof Date ? r.kickoff_utc.toISOString().replace('T',' ').substring(0,16) : String(r.kickoff_utc);
  const espnId = r.espn_event_id ?? 'NULL';
  const venueId = r.venue_id ?? 'NULL';
  const stadium = (r.stadium ?? 'NULL').padEnd(26);
  const city = (r.city ?? 'NULL').padEnd(13);
  const matchup = `${r.away_name} @ ${r.home_name}`;
  console.log(`${r.match_id.padEnd(20)}| ${md} | ${ku} | ${espnId.padEnd(13)} | ${String(venueId).padEnd(8)} | ${stadium} | ${city} | ${matchup}`);
}

// ET conversion check for wc26-r32-079 (Ecuador vs Mexico)
console.log('\n[ET DATE CHECK — wc26-r32-079 Ecuador @ Mexico]');
const r079 = rows.find(r => r.match_id === 'wc26-r32-079');
if (r079 && r079.kickoff_utc) {
  const kickoffUTC = new Date(r079.kickoff_utc);
  const kickoffET = new Date(kickoffUTC.getTime() - 4 * 60 * 60 * 1000); // EDT = UTC-4
  const matchDateDB = r079.match_date instanceof Date ? r079.match_date.toISOString().split('T')[0] : String(r079.match_date).split('T')[0];
  const expectedDate = kickoffET.toISOString().split('T')[0];
  console.log(`  kickoff_utc: ${kickoffUTC.toISOString()}`);
  console.log(`  kickoff_ET:  ${kickoffET.toISOString()} (EDT = UTC-4)`);
  console.log(`  match_date in DB: ${matchDateDB}`);
  console.log(`  expected match_date (ET): ${expectedDate}`);
  console.log(`  STATUS: ${matchDateDB === expectedDate ? '✅ CORRECT' : '❌ MISMATCH — needs fix'}`);
}

await conn.end();
console.log('\n[DONE]');
