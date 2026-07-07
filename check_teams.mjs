import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
// Check existing R16 matches for home_team/away_team values to understand format
const [rows] = await conn.query(`SELECT match_id, home_team, away_team FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-089','wc26-r16-090','wc26-r16-091')`);
for (const r of rows) console.log(JSON.stringify(r));
// Also check if there's a team mapping table
const [cols] = await conn.query(`SELECT match_id, home_team, away_team FROM wc2026MatchOdds WHERE match_id LIKE 'wc26-r16-09%'`);
console.log("---ALL R16---");
for (const r of cols) console.log(JSON.stringify(r));
await conn.end();
