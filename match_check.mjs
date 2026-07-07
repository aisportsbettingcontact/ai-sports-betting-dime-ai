import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT match_id, home_team_id, away_team_id, kickoff_utc, stage, espn_match_id FROM wc2026_matches WHERE match_id IN ('wc26-r16-095','wc26-r16-096') OR (kickoff_utc >= '2026-07-07' AND kickoff_utc < '2026-07-08') ORDER BY kickoff_utc`);
for (const r of rows) console.log(JSON.stringify(r));
// Also check by team name
const [teams] = await conn.query(`SELECT match_id, home_team_id, away_team_id, kickoff_utc, espn_match_id FROM wc2026_matches WHERE stage = 'R16' AND status = 'SCHEDULED' ORDER BY kickoff_utc`);
console.log('\n=== ALL SCHEDULED R16 ===');
for (const r of teams) console.log(JSON.stringify(r));
await conn.end();
