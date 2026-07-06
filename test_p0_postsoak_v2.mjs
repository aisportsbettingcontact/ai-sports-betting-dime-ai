import mysql from 'mysql2/promise';
const DB_URL = process.env.DATABASE_URL;
const conn = await mysql.createConnection(DB_URL);

// First, get all table names to find correct ones
const [tables] = await conn.execute("SHOW TABLES");
const tableNames = tables.map(r => Object.values(r)[0]).filter(t => t.startsWith('wc2026'));
console.log('[DISCOVERY] WC2026 tables found:', tableNames.join(', '));

// Also check for xg/team_stats variants
const [allTables] = await conn.execute("SHOW TABLES");
const all = allTables.map(r => Object.values(r)[0]);
const xgLike = all.filter(t => t.includes('xg') || t.includes('expected_goals'));
const statsLike = all.filter(t => t.includes('team_stat') || t.includes('team_rating'));
console.log('[DISCOVERY] xg-like tables:', xgLike.join(', ') || 'NONE');
console.log('[DISCOVERY] team_stats-like tables:', statsLike.join(', ') || 'NONE');
console.log('[DISCOVERY] player-like tables:', all.filter(t => t.includes('player')).join(', ') || 'NONE');

await conn.end();
