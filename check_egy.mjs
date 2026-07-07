import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);
// Check what ESPN match ID data exists for Egypt (team abbrev EGY)
const [xg] = await conn.query(`SELECT espn_match_id, homeTeamAbbrev, awayTeamAbbrev FROM wc2026_espn_expected_goals WHERE homeTeamAbbrev='EGY' OR awayTeamAbbrev='EGY'`);
console.log(`EGY xG rows: ${xg.length}`);
for (const r of xg) console.log(JSON.stringify(r));
await conn.end();
