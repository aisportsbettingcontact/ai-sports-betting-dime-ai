import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const envPath = '/home/ubuntu/ai-sports-betting/.env';
let dbUrl;
try {
  const envContent = readFileSync(envPath, 'utf8');
  const match = envContent.match(/DATABASE_URL=(.+)/);
  if (match) dbUrl = match[1].trim().replace(/^["']|["']$/g, '');
} catch {}
if (!dbUrl) dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('[ERROR] DATABASE_URL not found'); process.exit(1); }

const conn = await mysql.createConnection(dbUrl);

// Show column names first
const [cols] = await conn.execute('DESCRIBE tracked_bets');
console.log('[SCHEMA] tracked_bets columns:', cols.map(c => c.Field).join(', '));

// Count all bets
const [countRows] = await conn.execute('SELECT COUNT(*) as cnt FROM tracked_bets');
console.log('[RESULT] TOTAL TRACKED_BETS:', countRows[0].cnt);

// Recent 10 bets
const [recent] = await conn.execute('SELECT * FROM tracked_bets ORDER BY created_at DESC LIMIT 10');
console.log('[RESULT] RECENT 10 BETS:');
for (const row of recent) {
  console.log('  id=' + row.id + ' userId=' + (row.userId || row.user_id) + ' sport=' + row.sport + ' date=' + row.game_date + ' pick=' + row.pick + ' result=' + row.result + ' created=' + row.created_at);
}

// Check for Cardinals ML on 05/16/2026
const [cardinals] = await conn.execute("SELECT * FROM tracked_bets WHERE game_date = '2026-05-16'");
console.log('[RESULT] 05/16/2026 BETS (' + cardinals.length + ' total):');
for (const row of cardinals) {
  console.log('  id=' + row.id + ' userId=' + (row.userId || row.user_id) + ' pick=' + row.pick + ' result=' + row.result + ' riskUnits=' + (row.riskUnits || row.risk_units) + ' toWinUnits=' + (row.toWinUnits || row.to_win_units));
}

// Check app_users
const [users] = await conn.execute('SELECT * FROM app_users ORDER BY id LIMIT 10');
console.log('[RESULT] APP USERS:');
for (const u of users) {
  console.log('  id=' + u.id + ' name=' + u.name + ' role=' + u.role);
}

await conn.end();
