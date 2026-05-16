import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const env = readFileSync('/home/ubuntu/ai-sports-betting/.env', 'utf8');
const dbUrl = env.match(/DATABASE_URL=(.+)/)[1].trim();
const conn = await mysql.createConnection(dbUrl);

const [recent] = await conn.execute('SELECT id, userId, sport, gameDate, awayTeam, homeTeam, pick, result, riskUnits, toWinUnits, createdAt FROM tracked_bets ORDER BY createdAt DESC LIMIT 10');
console.log('[RECENT 10 BETS]');
for (const r of recent) console.log(JSON.stringify(r));

const [today] = await conn.execute("SELECT id, userId, sport, gameDate, awayTeam, homeTeam, pick, result, riskUnits, toWinUnits FROM tracked_bets WHERE gameDate='2026-05-16'");
console.log('[TODAY 05/16 BETS] count=' + today.length);
for (const r of today) console.log(JSON.stringify(r));

const [users] = await conn.execute('SELECT id, name, role FROM app_users ORDER BY id');
console.log('[APP USERS]');
for (const u of users) console.log(JSON.stringify(u));

// Count by userId
const [byUser] = await conn.execute('SELECT userId, COUNT(*) as cnt FROM tracked_bets GROUP BY userId ORDER BY cnt DESC');
console.log('[BETS BY USER]');
for (const r of byUser) console.log(JSON.stringify(r));

await conn.end();
