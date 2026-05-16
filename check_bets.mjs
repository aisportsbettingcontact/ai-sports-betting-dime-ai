import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

// Load env from the project
const envPath = '/home/ubuntu/ai-sports-betting/.env';
let dbUrl;
try {
  const envContent = readFileSync(envPath, 'utf8');
  const match = envContent.match(/DATABASE_URL=(.+)/);
  if (match) dbUrl = match[1].trim().replace(/^["']|["']$/g, '');
} catch {}

if (!dbUrl) {
  // Try from process env (injected by sandbox)
  dbUrl = process.env.DATABASE_URL;
}

if (!dbUrl) {
  console.error('[ERROR] DATABASE_URL not found');
  process.exit(1);
}

console.log('[INFO] Connecting to DB...');
const conn = await mysql.createConnection(dbUrl);

// Count all bets
const [countRows] = await conn.execute('SELECT COUNT(*) as cnt FROM tracked_bets');
console.log('[RESULT] TOTAL TRACKED_BETS:', JSON.stringify(countRows[0]));

// Count by user
const [byUser] = await conn.execute('SELECT user_id, COUNT(*) as cnt FROM tracked_bets GROUP BY user_id ORDER BY cnt DESC LIMIT 10');
console.log('[RESULT] BETS BY USER:', JSON.stringify(byUser));

// Recent 10 bets
const [recent] = await conn.execute('SELECT id, user_id, sport, game_date, away_team, home_team, pick, odds, risk_units, to_win_units, result, created_at FROM tracked_bets ORDER BY created_at DESC LIMIT 10');
console.log('[RESULT] RECENT 10 BETS:');
for (const row of recent) {
  console.log(' ', JSON.stringify(row));
}

// Check for Cardinals ML on 05/16/2026
const [cardinals] = await conn.execute("SELECT id, user_id, sport, game_date, away_team, home_team, pick, result, created_at FROM tracked_bets WHERE game_date = '2026-05-16' AND (away_team LIKE '%STL%' OR home_team LIKE '%STL%' OR pick LIKE '%Cardinal%')");
console.log('[RESULT] CARDINALS 05/16 BETS:', JSON.stringify(cardinals));

// Check app_users to find the owner user_id
const [users] = await conn.execute('SELECT id, open_id, name, role FROM app_users ORDER BY id LIMIT 10');
console.log('[RESULT] APP USERS:', JSON.stringify(users));

await conn.end();
console.log('[DONE]');
