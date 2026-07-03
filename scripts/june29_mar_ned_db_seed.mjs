/**
 * june29_mar_ned_db_seed.mjs
 * Seed Morocco vs Netherlands match + frozen book odds to DB
 * Standalone seed — no simulation, minimal memory footprint
 */
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const MATCH_ID   = 'wc26-r32-076';
const HOME_TEAM_ID = 'ned';
const AWAY_TEAM_ID = 'mar';
const KICKOFF_UTC  = '2026-06-30T01:00:00Z';
const MATCH_DATE   = '2026-06-29';
const VENUE_ID     = 'dallas';

const BOOK = {
  toAdvanceHome:  -155,
  toAdvanceAway:  +120,
  homeML:         +130,
  drawML:         +210,
  awayML:         +250,
  noDrawAway:     -800,
  overOdds:       +120,
  underOdds:      -150,
  totalLine:       2.5,
  homeSpreadLine:  -1.5,
  homeSpreadOdds:  +400,
  awaySpreadOdds:  -600,
  dc1X:           -105,
  dcX2:           -265,
  bttsYes:        -145,
  bttsNo:         +110,
};

console.log('[STEP][001] Connecting to MySQL...');
const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log('[VERIFY][002] DB connected');

// Check venue_id exists
const [venues] = await conn.execute('SELECT venue_id FROM wc2026_venues WHERE venue_id=?', [VENUE_ID]);
const venueOk = venues.length > 0;
console.log(`[VERIFY][003] venue_id="${VENUE_ID}" exists=${venueOk}`);
const useVenue = venueOk ? VENUE_ID : 'inglewood';
console.log(`[STATE][004] Using venue_id="${useVenue}"`);

// Upsert match
console.log(`[STEP][005] Upserting match ${MATCH_ID}...`);
await conn.execute(`
  INSERT INTO wc2026_matches
    (match_id, match_date, kickoff_utc, stage, home_team_id, away_team_id, venue_id, status, display_order)
  VALUES (?, ?, ?, 'R32', ?, ?, ?, 'scheduled', 76)
  ON DUPLICATE KEY UPDATE
    match_date=VALUES(match_date), kickoff_utc=VALUES(kickoff_utc),
    home_team_id=VALUES(home_team_id), away_team_id=VALUES(away_team_id)
`, [MATCH_ID, MATCH_DATE, KICKOFF_UTC, HOME_TEAM_ID, AWAY_TEAM_ID, useVenue]);
console.log(`[VERIFY][006] Match upserted: ${MATCH_ID} | home=${HOME_TEAM_ID} away=${AWAY_TEAM_ID} venue=${useVenue}`);

// Upsert frozen book odds
console.log(`[STEP][007] Upserting frozen book odds for ${MATCH_ID}...`);
await conn.execute(`
  INSERT INTO wc2026_frozen_book_odds
    (match_id, book_home_ml, book_draw_ml, book_away_ml,
     book_spread_line, book_home_spread_odds, book_away_spread_odds,
     book_total_line, book_over_odds, book_under_odds,
     book_btts_yes_odds, book_btts_no_odds,
     book_dc_1x_odds, book_dc_x2_odds,
     book_no_draw_home_odds, book_no_draw_away_odds,
     to_advance_home_odds, to_advance_away_odds,
     frozen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    book_home_ml=VALUES(book_home_ml), book_draw_ml=VALUES(book_draw_ml),
    book_away_ml=VALUES(book_away_ml), book_spread_line=VALUES(book_spread_line),
    book_home_spread_odds=VALUES(book_home_spread_odds), book_away_spread_odds=VALUES(book_away_spread_odds),
    book_total_line=VALUES(book_total_line), book_over_odds=VALUES(book_over_odds),
    book_under_odds=VALUES(book_under_odds), book_btts_yes_odds=VALUES(book_btts_yes_odds),
    book_btts_no_odds=VALUES(book_btts_no_odds), book_dc_1x_odds=VALUES(book_dc_1x_odds),
    book_dc_x2_odds=VALUES(book_dc_x2_odds), book_no_draw_away_odds=VALUES(book_no_draw_away_odds),
    to_advance_home_odds=VALUES(to_advance_home_odds), to_advance_away_odds=VALUES(to_advance_away_odds),
    frozen_at=NOW()
`, [
  MATCH_ID,
  BOOK.homeML, BOOK.drawML, BOOK.awayML,
  BOOK.homeSpreadLine, BOOK.homeSpreadOdds, BOOK.awaySpreadOdds,
  BOOK.totalLine, BOOK.overOdds, BOOK.underOdds,
  BOOK.bttsYes, BOOK.bttsNo,
  BOOK.dc1X, BOOK.dcX2,
  BOOK.noDrawAway,
  BOOK.toAdvanceHome, BOOK.toAdvanceAway,
]);
console.log(`[VERIFY][008] Book odds upserted: homeML=${BOOK.homeML} drawML=${BOOK.drawML} awayML=${BOOK.awayML} toAdvHome=${BOOK.toAdvanceHome} toAdvAway=${BOOK.toAdvanceAway} noDrawAway=${BOOK.noDrawAway}`);

// Verify
const [rows] = await conn.execute(
  'SELECT match_id, book_home_ml, book_draw_ml, book_away_ml, book_no_draw_away_odds, to_advance_home_odds, to_advance_away_odds, frozen_at FROM wc2026_frozen_book_odds WHERE match_id=?',
  [MATCH_ID]
);
if (rows.length === 1) {
  console.log(`[VERIFY][009] DB READ PASS | ${JSON.stringify(rows[0])}`);
} else {
  console.error(`[ERROR][009] DB READ FAIL | expected 1 row, got ${rows.length}`);
}

await conn.end();
console.log('[STEP][010] DB disconnected | SEED COMPLETE | match=wc26-r32-076 Morocco vs Netherlands');
