import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// First check venue columns
const [vcols] = await conn.execute(`SHOW COLUMNS FROM wc2026_venues`);
console.log('VENUE COLS:', vcols.map(c => c.Field).join(', '));

const [rows] = await conn.execute(`
  SELECT f.match_id, f.kickoff_utc, f.home_score, f.away_score, f.status,
         ht.team_id as home_id, at.team_id as away_id,
         ht.name as home_name, at.name as away_name
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE DATE(CONVERT_TZ(f.kickoff_utc, '+00:00', '-07:00')) = '2026-06-22'
  ORDER BY f.kickoff_utc
`);
console.log('JUNE 22 MATCHES:');
rows.forEach(r => console.log(JSON.stringify(r)));
await conn.end();
