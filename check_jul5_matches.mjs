import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`
  SELECT match_id, match_date, stage, home_team_id, away_team_id, venue_id, status, espn_match_id, kickoff_utc
  FROM wc2026_matches WHERE match_id IN ('wc26-r16-091', 'wc26-r16-092')
`);
for (const r of rows) console.log(JSON.stringify(r));
await conn.end();
process.exit(0);
