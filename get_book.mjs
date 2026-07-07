import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT match_id, book_home_ml, book_draw, book_away_ml, book_primary_spread, book_total, book_over_odds, book_under_odds, book_btts_yes, book_btts_no FROM wc2026MatchOdds WHERE match_id IN ('wc26-r16-089','wc26-r16-090','wc26-r16-093','wc26-r16-094') ORDER BY match_id`);
for (const r of rows) console.log(JSON.stringify(r));
await conn.end();
