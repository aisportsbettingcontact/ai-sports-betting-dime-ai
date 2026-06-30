// rename_espn_tables.mjs
// Renames all 7 ESPN scraper tables to use wc2026_espn_ prefix
// Drops wc2026_betting_splits (already dropped, but IF EXISTS for safety)
// Run once: node drizzle/rename_espn_tables.mjs

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const renames = [
  ['wc2026_matches',        'wc2026_espn_matches'],
  ['wc2026_match_odds',     'wc2026_espn_match_odds'],
  ['wc2026_team_stats',     'wc2026_espn_team_stats'],
  ['wc2026_expected_goals', 'wc2026_espn_expected_goals'],
  ['wc2026_shot_map',       'wc2026_espn_shot_map'],
  ['wc2026_player_stats',   'wc2026_espn_player_stats'],
  ['wc2026_glossary',       'wc2026_espn_glossary'],
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('[RENAME] Starting ESPN table renames...');

for (const [from, to] of renames) {
  try {
    // Check if source table exists
    const [rows] = await conn.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [from]
    );
    if (rows.length === 0) {
      console.log(`[SKIP]   ${from} → ${to} (source does not exist)`);
      continue;
    }
    // Check if target already exists
    const [existing] = await conn.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [to]
    );
    if (existing.length > 0) {
      console.log(`[SKIP]   ${from} → ${to} (target already exists)`);
      continue;
    }
    await conn.execute(`RENAME TABLE \`${from}\` TO \`${to}\``);
    console.log(`[OK]     ${from} → ${to}`);
  } catch (e) {
    console.error(`[ERROR]  ${from} → ${to}: ${e.message}`);
  }
}

// Verify final state
const [tables] = await conn.execute(
  `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'wc2026_%' ORDER BY TABLE_NAME`
);
console.log('\n[VERIFY] All WC2026 tables in DB:');
for (const row of tables) {
  const name = row.TABLE_NAME;
  const isEspn = name.includes('_espn_');
  const isBettingSplits = name === 'wc2026_betting_splits';
  const marker = isBettingSplits ? ' ← SHOULD BE GONE' : (isEspn ? ' ✓' : ' ← NEEDS espn_ prefix');
  console.log(`  ${name}${marker}`);
}

await conn.end();
console.log('\n[DONE] Rename migration complete.');
