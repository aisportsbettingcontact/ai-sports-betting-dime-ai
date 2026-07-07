import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT match_id, espn_match_id, book_home_ml, book_draw, book_away_ml, insert_method FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-095','wc26-r16-096')`);
if (rows.length === 0) console.log("NO ROWS FOUND - need INSERT");
else for (const r of rows) console.log(JSON.stringify(r));
await conn.end();
