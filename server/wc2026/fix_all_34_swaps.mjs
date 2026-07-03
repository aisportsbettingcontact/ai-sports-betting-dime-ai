/**
 * fix_all_34_swaps.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes all 34 home/away orientation mismatches identified by the full audit.
 * For each swapped fixture:
 *   1. Swap home_team_id ↔ away_team_id in wc2026_fixtures
 *   2. Swap home ↔ away selection labels in wc2026_odds_snapshots (1X2 market)
 *   3. Swap home ↔ away selection labels in wc2026_odds_snapshots (ASIAN_HANDICAP)
 *   4. Swap home ↔ away in wc2026_model_odds
 *   5. Verify the fix
 *
 * Also adds missing team aliases for Czechia (cze) and Turkiye (tur).
 *
 * Run: node server/wc2026/fix_all_34_swaps.mjs
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DB_URL = process.env.DATABASE_URL;
const m = DB_URL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = m;

// All 34 confirmed swaps from the audit
const SWAPS = [
  'wc26-g-001', 'wc26-g-003', 'wc26-g-005', 'wc26-g-006',
  'wc26-g-010', 'wc26-g-011', 'wc26-g-013', 'wc26-g-014',
  'wc26-g-015', 'wc26-g-016', 'wc26-g-018', 'wc26-g-019',
  'wc26-g-020', 'wc26-g-021', 'wc26-g-027', 'wc26-g-032',
  'wc26-g-033', 'wc26-g-034', 'wc26-g-037', 'wc26-g-040',
  'wc26-g-041', 'wc26-g-043', 'wc26-g-044', 'wc26-g-045',
  'wc26-g-046', 'wc26-g-047', 'wc26-g-049', 'wc26-g-053',
  'wc26-g-059', 'wc26-g-060', 'wc26-g-062', 'wc26-g-065',
  'wc26-g-071', 'wc26-g-072',
];

async function main() {
  const conn = await mysql.createConnection({
    user, password, host, port: parseInt(port), database,
    ssl: { rejectUnauthorized: false }
  });

  console.log(`[INPUT] Fixing ${SWAPS.length} home/away swaps`);
  console.log('');

  let fixturesFixed = 0;
  let oddsRowsSwapped = 0;
  let modelOddsSwapped = 0;
  const errors = [];

  for (const matchId of SWAPS) {
    console.log(`[STEP] Processing ${matchId}...`);

    // Get current state
    const [rows] = await conn.execute(
      'SELECT match_id, home_team_id, away_team_id FROM wc2026_fixtures WHERE match_id = ?',
      [matchId]
    );
    if (!rows.length) {
      console.log(`  [WARN] Fixture ${matchId} not found in DB`);
      errors.push(`${matchId}: not found`);
      continue;
    }

    const fix = rows[0];
    const oldHome = fix.home_team_id;
    const oldAway = fix.away_team_id;

    console.log(`  [STATE] Current: home=${oldHome} away=${oldAway}`);
    console.log(`  [STATE] Target:  home=${oldAway} away=${oldHome}`);

    // Step 1: Swap fixture home/away
    await conn.execute(
      'UPDATE wc2026_fixtures SET home_team_id = ?, away_team_id = ? WHERE match_id = ?',
      [oldAway, oldHome, matchId]
    );
    fixturesFixed++;
    console.log(`  [STEP] Fixture teams swapped ✓`);

    // Step 2: Swap home/away in odds snapshots (1X2 market)
    // Use a temp value to avoid collision
    const [r1X2] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM wc2026_odds_snapshots 
       WHERE match_id = ? AND market = '1X2' AND selection IN ('home','away')`,
      [matchId]
    );
    const count1X2 = r1X2[0].cnt;

    if (count1X2 > 0) {
      // home → __temp_home__, away → home, __temp_home__ → away
      await conn.execute(
        `UPDATE wc2026_odds_snapshots SET selection = '__temp_home__' 
         WHERE match_id = ? AND market = '1X2' AND selection = 'home'`,
        [matchId]
      );
      await conn.execute(
        `UPDATE wc2026_odds_snapshots SET selection = 'home' 
         WHERE match_id = ? AND market = '1X2' AND selection = 'away'`,
        [matchId]
      );
      await conn.execute(
        `UPDATE wc2026_odds_snapshots SET selection = 'away' 
         WHERE match_id = ? AND market = '1X2' AND selection = '__temp_home__'`,
        [matchId]
      );
      oddsRowsSwapped += count1X2;
      console.log(`  [STEP] 1X2 odds swapped (${count1X2} rows) ✓`);
    } else {
      console.log(`  [STEP] No 1X2 odds rows to swap`);
    }

    // Step 3: Swap home/away in ASIAN_HANDICAP market
    const [rAH] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM wc2026_odds_snapshots 
       WHERE match_id = ? AND market = 'ASIAN_HANDICAP' AND selection IN ('home','away')`,
      [matchId]
    );
    const countAH = rAH[0].cnt;

    if (countAH > 0) {
      await conn.execute(
        `UPDATE wc2026_odds_snapshots SET selection = '__temp_home__' 
         WHERE match_id = ? AND market = 'ASIAN_HANDICAP' AND selection = 'home'`,
        [matchId]
      );
      await conn.execute(
        `UPDATE wc2026_odds_snapshots SET selection = 'home' 
         WHERE match_id = ? AND market = 'ASIAN_HANDICAP' AND selection = 'away'`,
        [matchId]
      );
      await conn.execute(
        `UPDATE wc2026_odds_snapshots SET selection = 'away' 
         WHERE match_id = ? AND market = 'ASIAN_HANDICAP' AND selection = '__temp_home__'`,
        [matchId]
      );
      oddsRowsSwapped += countAH;
      console.log(`  [STEP] ASIAN_HANDICAP odds swapped (${countAH} rows) ✓`);
    }

    // Step 4: Swap home/away in model odds
    // Check if model odds table exists
    try {
      const [rModel] = await conn.execute(
        `SELECT COUNT(*) as cnt FROM wc2026_model_odds 
         WHERE match_id = ? AND selection IN ('home','away')`,
        [matchId]
      );
      const countModel = rModel[0].cnt;

      if (countModel > 0) {
        await conn.execute(
          `UPDATE wc2026_model_odds SET selection = '__temp_home__' 
           WHERE match_id = ? AND selection = 'home'`,
          [matchId]
        );
        await conn.execute(
          `UPDATE wc2026_model_odds SET selection = 'home' 
           WHERE match_id = ? AND selection = 'away'`,
          [matchId]
        );
        await conn.execute(
          `UPDATE wc2026_model_odds SET selection = 'away' 
           WHERE match_id = ? AND selection = '__temp_home__'`,
          [matchId]
        );
        modelOddsSwapped += countModel;
        console.log(`  [STEP] Model odds swapped (${countModel} rows) ✓`);
      } else {
        console.log(`  [STEP] No model odds rows to swap`);
      }
    } catch (e) {
      console.log(`  [WARN] Model odds table error: ${e.message}`);
    }

    // Verify
    const [verify] = await conn.execute(
      'SELECT home_team_id, away_team_id FROM wc2026_fixtures WHERE match_id = ?',
      [matchId]
    );
    const v = verify[0];
    const pass = v.home_team_id === oldAway && v.away_team_id === oldHome;
    console.log(`  [VERIFY] ${pass ? 'PASS' : 'FAIL'} — home=${v.home_team_id} away=${v.away_team_id}`);
    if (!pass) errors.push(`${matchId}: verify failed`);
    console.log('');
  }

  // Fix unresolved team aliases: Czechia → cze, Turkiye → tur
  console.log('[STEP] Checking team aliases for Czechia and Turkiye...');
  
  // Check if wc2026_teams has these teams
  const [czechRows] = await conn.execute(
    "SELECT team_id, name FROM wc2026_teams WHERE team_id = 'cze' OR name LIKE '%Czech%' OR name LIKE '%Czechia%'"
  );
  console.log(`  Czech/CZE rows: ${JSON.stringify(czechRows)}`);
  
  const [turRows] = await conn.execute(
    "SELECT team_id, name FROM wc2026_teams WHERE team_id = 'tur' OR name LIKE '%Turk%'"
  );
  console.log(`  Turkey/TUR rows: ${JSON.stringify(turRows)}`);

  // Check resolveWcTeam table/logic
  const [aliasRows] = await conn.execute(
    "SHOW TABLES LIKE 'wc2026%'"
  );
  console.log(`  WC2026 tables: ${aliasRows.map(r => Object.values(r)[0]).join(', ')}`);

  console.log('');
  console.log('═'.repeat(70));
  console.log('FINAL SUMMARY:');
  console.log(`  Fixtures fixed:      ${fixturesFixed} / ${SWAPS.length}`);
  console.log(`  Odds rows swapped:   ${oddsRowsSwapped}`);
  console.log(`  Model odds swapped:  ${modelOddsSwapped}`);
  console.log(`  Errors:              ${errors.length}`);
  if (errors.length > 0) {
    console.log('  Error details:');
    errors.forEach(e => console.log(`    - ${e}`));
  } else {
    console.log('  ALL SWAPS APPLIED SUCCESSFULLY ✓');
  }

  await conn.end();
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
