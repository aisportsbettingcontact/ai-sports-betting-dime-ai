import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

const tables = ['wc2026MatchOdds', 'wc2026_odds_snapshots', 'wc2026_model_projections', 'wc2026_frozen_book_odds'];

for (const t of tables) {
  const [cols] = await conn.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE() ORDER BY ORDINAL_POSITION`, [t]);
  console.log(`\n=== ${t} (${cols.length} columns) ===`);
  console.log(cols.map(c => c.COLUMN_NAME).join(', '));
}

await conn.end();
