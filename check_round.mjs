import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT match_id, world_cup_round FROM wc2026MatchOdds WHERE match_id LIKE 'wc26-r16-%' LIMIT 3`);
for (const r of rows) console.log(JSON.stringify(r));
await conn.end();
