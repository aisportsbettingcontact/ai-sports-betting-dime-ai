import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [r] = await conn.query('SELECT match_id, book_home_ml, book_draw, book_away_ml, book_primary_spread, book_total FROM wc2026_frozen_book_odds WHERE match_id LIKE "wc26-r16-%"');
for (const row of r) {
  console.log(JSON.stringify(row));
}
await conn.end();
