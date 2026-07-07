import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Spot-check 1: wc26-r16-089 (Paraguay vs France) — check if it's in frozen_book_odds
const [r1] = await conn.query('SELECT * FROM wc2026_frozen_book_odds WHERE match_id = ?', ['wc26-r16-089']);
console.log('=== SPOT CHECK 1: wc26-r16-089 in frozen_book_odds ===');
console.log('Rows found:', r1.length);
if (r1.length > 0) {
  console.log('  book_home_ml:', r1[0].book_home_ml);
  console.log('  book_draw:', r1[0].book_draw);
  console.log('  book_away_ml:', r1[0].book_away_ml);
}

// Spot-check 2: wc26-r32-080 (England vs Congo DR) — check frozen_book_odds vs seedJuly1Direct.ts
const [r2] = await conn.query('SELECT * FROM wc2026_frozen_book_odds WHERE match_id = ?', ['wc26-r32-080']);
console.log('\n=== SPOT CHECK 2: wc26-r32-080 in frozen_book_odds ===');
console.log('Rows found:', r2.length);
if (r2.length > 0) {
  console.log('  book_home_ml:', r2[0].book_home_ml);
  console.log('  book_draw:', r2[0].book_draw);
  console.log('  book_away_ml:', r2[0].book_away_ml);
  console.log('  book_total:', r2[0].book_total);
}

// Spot-check 3: wc26-g-001 (first group match) — check model_projections
const [r3] = await conn.query('SELECT * FROM wc2026_model_projections WHERE match_id = ?', ['wc26-g-001']);
console.log('\n=== SPOT CHECK 3: wc26-g-001 in model_projections ===');
console.log('Rows found:', r3.length);

// Spot-check 4: wc26-r16-091 in ESPN tables (should be in espn_matches but missing from team_stats)
const [r4] = await conn.query('SELECT espn_match_id FROM wc2026_matches WHERE match_id = ?', ['wc26-r16-091']);
const espnId = r4[0]?.espn_match_id;
console.log('\n=== SPOT CHECK 4: wc26-r16-091 ESPN coverage ===');
console.log('ESPN match ID:', espnId);
const [r4a] = await conn.query('SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE espn_match_id = ?', [espnId]);
const [r4b] = await conn.query('SELECT COUNT(*) as cnt FROM wc2026_espn_team_stats WHERE espn_match_id = ?', [espnId]);
const [r4c] = await conn.query('SELECT COUNT(*) as cnt FROM wc2026_espn_player_stats WHERE espn_match_id = ?', [espnId]);
console.log('  espn_matches:', r4a[0].cnt);
console.log('  espn_team_stats:', r4b[0].cnt);
console.log('  espn_player_stats:', r4c[0].cnt);

await conn.end();
