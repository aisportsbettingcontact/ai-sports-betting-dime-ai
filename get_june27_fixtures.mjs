import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const db = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await db.execute(`
  SELECT f.match_id,
         ht.fifa_code as home_code, ht.name as home_name,
         at.fifa_code as away_code, at.name as away_name,
         DATE(f.kickoff_utc) as match_date,
         f.kickoff_utc
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE DATE(f.kickoff_utc) BETWEEN '2026-06-27' AND '2026-06-28'
  ORDER BY f.kickoff_utc
`);

console.log(`\n[FIXTURES] June 27-28 WC Fixtures: ${rows.length}`);
for (const r of rows) {
  console.log(`[FIXTURE] ${r.match_id} | HOME: ${r.home_code} (${r.home_name}) | AWAY: ${r.away_code} (${r.away_name}) | DATE: ${r.match_date}`);
}

// Also check frozen_book_odds for these fixtures
const ids = rows.map(r => `'${r.match_id}'`).join(',');
const [frozen] = await db.execute(`SELECT match_id FROM wc2026_frozen_book_odds WHERE match_id IN (${ids})`);
console.log(`\n[FROZEN] Already have frozen odds for: ${frozen.map(r => r.match_id).join(', ')}`);

await db.end();
