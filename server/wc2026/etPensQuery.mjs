/**
 * etPensQuery.mjs
 * Query wc2026_espn_matches for ET/Pens data across all 7 completed R32 matches.
 * ESPN IDs: 760487–760493
 */
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const ESPN_IDS = ['760487','760488','760489','760490','760491','760492','760493'];

const db = await createConnection(process.env.DATABASE_URL);

// Step 1: Show all columns in wc2026_espn_matches
const [cols] = await db.query("SHOW COLUMNS FROM wc2026_espn_matches");
console.log("\n=== wc2026_espn_matches COLUMNS ===");
cols.forEach(c => console.log(`  ${c.Field}  (${c.Type})`));

// Step 2: Pull all data for the 7 ESPN IDs
const [rows] = await db.query(
  `SELECT * FROM wc2026_espn_matches WHERE espn_match_id IN (?) ORDER BY espn_match_id`,
  [ESPN_IDS]
);
console.log(`\n=== MATCH DATA (${rows.length} rows) ===`);
for (const r of rows) {
  console.log(JSON.stringify(r, null, 2));
}

await db.end();
