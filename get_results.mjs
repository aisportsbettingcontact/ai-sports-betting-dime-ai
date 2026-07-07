import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT match_id, home_team_id, away_team_id, home_score, away_score FROM wc2026_matches WHERE match_id LIKE 'wc26-r16-08%' OR match_id LIKE 'wc26-r16-09%' ORDER BY match_id`);
for (const r of rows) console.log(JSON.stringify(r));
await conn.end();
