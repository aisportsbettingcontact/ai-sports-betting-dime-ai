/**
 * seedJune28CAN_RSA.mjs
 * Seed Canada vs South Africa (Match 73, Round of 32) for June 28, 2026
 * Venue: SoFi Stadium, Inglewood CA (venue_id: inglewood)
 * Kickoff: 3:00 PM ET = 19:00 UTC
 * Away: Canada (CAN) | Home: South Africa (RSA)
 *
 * Odds Source: DraftKings (frozen, no model lines)
 * Canada ML: -145 | Draw: +265 | South Africa ML: +475
 * Canada or Draw (DC 1X): -650 | South Africa or Draw (DC X2): +115
 * Canada or South Africa No Draw: -350
 * Canada -1.5: +215 | South Africa +1.5: -280
 * Over 2.5: +125 | Under 2.5: -155
 * BTTS YES: +110 | BTTS NO: -140
 *
 * SCHEMA MAPPING:
 * Away = Canada = book_away_ml
 * Home = South Africa = book_home_ml
 * Spread: Canada -1.5 → away team is favorite → book_spread_line = -1.5 (from HOME perspective = +1.5)
 *   book_spread_line stores HOME team spread line
 *   Home = RSA = +1.5 → book_spread_line = 1.5
 *   book_home_spread_odds = -280 (RSA +1.5 odds)
 *   book_away_spread_odds = +215 (CAN -1.5 odds)
 * DC: Canada or Draw = DC 1X (away or draw) → book_dc_1x_odds = -650
 *     South Africa or Draw = DC X2 (home or draw) → book_dc_x2_odds = +115
 * No Draw: Canada or South Africa = -350 → book_no_draw_away_odds = -350 (away wins no draw)
 *   Note: no_draw_home_odds not provided — set to NULL
 */

import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const FIXTURE_ID = 'wc26-r32-073';
const HOME_TEAM = 'rsa';   // South Africa
const AWAY_TEAM = 'can';   // Canada
const VENUE_ID  = 'inglewood';
const MATCH_DATE = '2026-06-28';
const KICKOFF_UTC = '2026-06-28 19:00:00';  // 3:00 PM ET = 19:00 UTC
const STAGE = 'R32';
const DISPLAY_ORDER = 1;

// DK Frozen Odds
// Home = South Africa, Away = Canada
const ODDS = {
  book_home_ml:           475,   // South Africa ML
  book_draw_ml:           265,   // Draw
  book_away_ml:          -145,   // Canada ML
  // Spread: Home (RSA) +1.5 at -280, Away (CAN) -1.5 at +215
  book_spread_line:       1.5,   // HOME team spread line (RSA +1.5)
  book_home_spread_odds: -280,   // RSA +1.5
  book_away_spread_odds:  215,   // CAN -1.5
  // Total
  book_total_line:        2.5,
  book_over_odds:         125,   // Over 2.5
  book_under_odds:       -155,   // Under 2.5
  // BTTS
  book_btts_yes_odds:     110,   // BTTS YES
  book_btts_no_odds:     -140,   // BTTS NO
  // Double Chance
  // DC 1X = Away or Draw = Canada or Draw = -650
  // DC X2 = Home or Draw = South Africa or Draw = +115
  book_dc_1x_odds:       -650,   // Canada or Draw (away or draw)
  book_dc_x2_odds:        115,   // South Africa or Draw (home or draw)
  // No Draw
  // Canada or South Africa (no draw) = -350
  // This is the no-draw market — maps to no_draw_away_odds (Canada wins) or could be symmetric
  // Since only one no-draw line provided, store as no_draw_away_odds (CAN wins)
  book_no_draw_home_odds: null,  // Not provided
  book_no_draw_away_odds:-350,   // Canada or South Africa (no draw)
  book_source: 'DK_FROZEN',
};

async function run() {
  console.log('[STEP] Connecting to database...');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[STATE] Connected to DB');

  try {
    // ── STEP 1: Validate teams exist ──────────────────────────────────────────
    console.log('[STEP] Validating team IDs: home=rsa, away=can');
    const [teams] = await conn.execute(
      'SELECT team_id, fifa_code, name FROM wc2026_teams WHERE team_id IN (?, ?)',
      [HOME_TEAM, AWAY_TEAM]
    );
    if (teams.length !== 2) {
      throw new Error(`[FAIL] Expected 2 teams, found ${teams.length}: ${JSON.stringify(teams)}`);
    }
    for (const t of teams) {
      console.log(`[VERIFY] Team OK: ${t.team_id} = ${t.name} (${t.fifa_code})`);
    }

    // ── STEP 2: Validate venue exists ─────────────────────────────────────────
    console.log('[STEP] Validating venue: inglewood');
    const [venues] = await conn.execute(
      'SELECT venue_id, city, stadium FROM wc2026_venues WHERE venue_id = ?',
      [VENUE_ID]
    );
    if (venues.length === 0) {
      throw new Error(`[FAIL] Venue not found: ${VENUE_ID}`);
    }
    console.log(`[VERIFY] Venue OK: ${venues[0].venue_id} = ${venues[0].stadium}, ${venues[0].city}`);

    // ── STEP 3: Check for duplicate fixture ───────────────────────────────────
    console.log(`[STEP] Checking for existing fixture: ${FIXTURE_ID}`);
    const [existing] = await conn.execute(
      'SELECT match_id FROM wc2026_matches WHERE match_id = ?',
      [FIXTURE_ID]
    );
    if (existing.length > 0) {
      console.log(`[STATE] Fixture ${FIXTURE_ID} already exists — deleting and re-inserting`);
      await conn.execute('DELETE FROM wc2026_frozen_book_odds WHERE match_id = ?', [FIXTURE_ID]);
      await conn.execute('DELETE FROM wc2026_matches WHERE match_id = ?', [FIXTURE_ID]);
      console.log('[STATE] Deleted existing fixture and frozen odds');
    }

    // ── STEP 4: Insert fixture ─────────────────────────────────────────────────
    console.log(`[STEP] Inserting fixture ${FIXTURE_ID}: RSA(H) vs CAN(A) at ${KICKOFF_UTC}`);
    await conn.execute(
      `INSERT INTO wc2026_matches
        (match_id, match_date, kickoff_utc, stage, group_letter, matchday,
         home_team_id, away_team_id, venue_id, home_score, away_score,
         status, is_host_home, display_order)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, 'SCHEDULED', 0, ?)`,
      [FIXTURE_ID, MATCH_DATE, KICKOFF_UTC, STAGE, HOME_TEAM, AWAY_TEAM, VENUE_ID, DISPLAY_ORDER]
    );
    console.log(`[OUTPUT] Fixture inserted: ${FIXTURE_ID}`);

    // ── STEP 5: Insert frozen book odds ───────────────────────────────────────
    console.log('[STEP] Inserting frozen DK book odds...');
    console.log('[STATE] Odds payload:', JSON.stringify(ODDS, null, 2));

    await conn.execute(
      `INSERT INTO wc2026_frozen_book_odds
        (match_id, frozen_at, frozen_by,
         book_home_ml, book_draw_ml, book_away_ml,
         book_spread_line, book_home_spread_odds, book_away_spread_odds,
         book_total_line, book_over_odds, book_under_odds,
         book_btts_yes_odds, book_btts_no_odds,
         book_dc_1x_odds, book_dc_x2_odds,
         book_no_draw_home_odds, book_no_draw_away_odds,
         book_source)
       VALUES (?, NOW(), 'manual_seed',
               ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?,
               ?, ?,
               ?, ?,
               ?, ?,
               ?)`,
      [
        FIXTURE_ID,
        ODDS.book_home_ml, ODDS.book_draw_ml, ODDS.book_away_ml,
        ODDS.book_spread_line, ODDS.book_home_spread_odds, ODDS.book_away_spread_odds,
        ODDS.book_total_line, ODDS.book_over_odds, ODDS.book_under_odds,
        ODDS.book_btts_yes_odds, ODDS.book_btts_no_odds,
        ODDS.book_dc_1x_odds, ODDS.book_dc_x2_odds,
        ODDS.book_no_draw_home_odds, ODDS.book_no_draw_away_odds,
        ODDS.book_source,
      ]
    );
    console.log('[OUTPUT] Frozen book odds inserted');

    // ── STEP 6: Verify insertion ───────────────────────────────────────────────
    console.log('[STEP] Verifying inserted data...');
    const [verFix] = await conn.execute(
      'SELECT match_id, match_date, kickoff_utc, stage, home_team_id, away_team_id, venue_id, display_order FROM wc2026_matches WHERE match_id = ?',
      [FIXTURE_ID]
    );
    console.log('[VERIFY] Fixture row:', JSON.stringify(verFix[0]));

    const [verOdds] = await conn.execute(
      `SELECT match_id,
              book_home_ml, book_draw_ml, book_away_ml,
              book_spread_line, book_home_spread_odds, book_away_spread_odds,
              book_total_line, book_over_odds, book_under_odds,
              book_btts_yes_odds, book_btts_no_odds,
              book_dc_1x_odds, book_dc_x2_odds,
              book_no_draw_home_odds, book_no_draw_away_odds,
              book_source
       FROM wc2026_frozen_book_odds WHERE match_id = ?`,
      [FIXTURE_ID]
    );
    console.log('[VERIFY] Frozen odds row:', JSON.stringify(verOdds[0]));

    // ── STEP 7: Validate all odds values match expected ────────────────────────
    console.log('[STEP] Validating all odds values match expected...');
    const row = verOdds[0];
    const checks = [
      ['book_home_ml',           row.book_home_ml,           ODDS.book_home_ml],
      ['book_draw_ml',           row.book_draw_ml,           ODDS.book_draw_ml],
      ['book_away_ml',           row.book_away_ml,           ODDS.book_away_ml],
      ['book_spread_line',       parseFloat(row.book_spread_line), ODDS.book_spread_line],
      ['book_home_spread_odds',  row.book_home_spread_odds,  ODDS.book_home_spread_odds],
      ['book_away_spread_odds',  row.book_away_spread_odds,  ODDS.book_away_spread_odds],
      ['book_total_line',        parseFloat(row.book_total_line),  ODDS.book_total_line],
      ['book_over_odds',         row.book_over_odds,         ODDS.book_over_odds],
      ['book_under_odds',        row.book_under_odds,        ODDS.book_under_odds],
      ['book_btts_yes_odds',     row.book_btts_yes_odds,     ODDS.book_btts_yes_odds],
      ['book_btts_no_odds',      row.book_btts_no_odds,      ODDS.book_btts_no_odds],
      ['book_dc_1x_odds',        row.book_dc_1x_odds,        ODDS.book_dc_1x_odds],
      ['book_dc_x2_odds',        row.book_dc_x2_odds,        ODDS.book_dc_x2_odds],
      ['book_no_draw_away_odds', row.book_no_draw_away_odds, ODDS.book_no_draw_away_odds],
    ];

    let allPass = true;
    for (const [field, actual, expected] of checks) {
      const pass = actual === expected;
      if (!pass) allPass = false;
      console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${field}: expected=${expected} actual=${actual}`);
    }

    if (allPass) {
      console.log('\n[OUTPUT] ✅ ALL CHECKS PASSED — Canada vs South Africa seeded and frozen correctly');
      console.log(`[OUTPUT] match_id=${FIXTURE_ID} | stage=R32 | date=${MATCH_DATE} | kickoff=${KICKOFF_UTC}`);
      console.log('[OUTPUT] Home: South Africa (RSA) | Away: Canada (CAN) | Venue: SoFi Stadium, Inglewood');
      console.log('[OUTPUT] Model lines: NOT seeded (frozen book odds only)');
    } else {
      console.error('[FAIL] ❌ VALIDATION FAILED — some odds values do not match expected');
      process.exit(1);
    }

  } finally {
    await conn.end();
    console.log('[STATE] DB connection closed');
  }
}

run().catch(e => {
  console.error('[ERROR] Fatal:', e.message);
  process.exit(1);
});
