import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';

// Load environment
dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('[ERROR] DATABASE_URL not found in .env');
  process.exit(1);
}

console.log('[INPUT] Connecting to database...');

const conn = await mysql.createConnection(DB_URL);

// ─── STEP 1: Inspect tracked_bets columns fully ───────────────────────────────
console.log('\n[STEP 1] Full tracked_bets schema');
const [cols] = await conn.execute(`
  SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracked_bets'
  ORDER BY ORDINAL_POSITION
`);
console.log('[STATE] Columns:', cols.map(c => `${c.COLUMN_NAME}(${c.COLUMN_TYPE})`).join(', '));

// ─── STEP 2: Sample 5 rows to understand data format ─────────────────────────
console.log('\n[STEP 2] Sample 5 rows from tracked_bets');
const [sample] = await conn.execute(`SELECT * FROM tracked_bets LIMIT 5`);
console.log('[STATE] Sample rows:');
sample.forEach((r, i) => console.log(`  Row ${i+1}:`, JSON.stringify(r)));

// ─── STEP 3: Find all users with bets ─────────────────────────────────────────
console.log('\n[STEP 3] All users with tracked bets');
const [users] = await conn.execute(`
  SELECT tb.userId, au.username, au.email, au.discordUsername,
         COUNT(*) as total_bets,
         SUM(CASE WHEN tb.sport = 'MLB' THEN 1 ELSE 0 END) as mlb_bets,
         MIN(tb.gameDate) as first_date,
         MAX(tb.gameDate) as last_date
  FROM tracked_bets tb
  LEFT JOIN app_users au ON tb.userId = au.id
  GROUP BY tb.userId, au.username, au.email, au.discordUsername
  ORDER BY total_bets DESC
`);
console.log('[STATE] Users with bets:');
users.forEach(u => console.log(`  userId=${u.userId} username=${u.username} email=${u.email} discord=${u.discordUsername} total=${u.total_bets} mlb=${u.mlb_bets} range=${u.first_date}→${u.last_date}`));

// ─── STEP 4: Check distinct result values ─────────────────────────────────────
console.log('\n[STEP 4] Distinct result values in tracked_bets');
const [results] = await conn.execute(`SELECT DISTINCT result FROM tracked_bets ORDER BY result`);
console.log('[STATE] Result values:', results.map(r => r.result));

// ─── STEP 5: Check profit/units columns ───────────────────────────────────────
console.log('\n[STEP 5] Checking for profit/units columns');
const [profitCols] = await conn.execute(`
  SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tracked_bets'
  AND COLUMN_NAME LIKE '%profit%' OR COLUMN_NAME LIKE '%unit%' OR COLUMN_NAME LIKE '%pnl%' OR COLUMN_NAME LIKE '%win%'
`);
console.log('[STATE] Profit/unit columns:', profitCols.map(c => c.COLUMN_NAME));

await conn.end();
console.log('\n[VERIFY] PASS — schema audit complete');
