import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`SELECT match_id, book_home_ml, book_draw, book_away_ml, book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds, book_total, book_over_odds, book_under_odds, book_btts_yes, book_btts_no, book_home_wd, book_away_wd, book_home_to_advance, book_away_to_advance FROM wc2026MatchOdds WHERE match_id LIKE 'wc26-r16-%' LIMIT 5`);
for (const r of rows) console.log(JSON.stringify(r));
await conn.end();
