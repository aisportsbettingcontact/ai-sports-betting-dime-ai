/**
 * june29_pry_ger_db_seed.mjs
 * Seed Paraguay vs Germany match + frozen book odds to DB
 * Match columns: match_id, match_date, kickoff_utc, stage, group_letter, matchday,
 *                  home_team_id, away_team_id, venue_id, status, display_order
 */
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const MATCH_ID   = 'wc26-r32-075';
const HOME_TEAM_ID = 'ger';
const AWAY_TEAM_ID = 'par'; // FIFA team_id for Paraguay in wc2026_teams
const KICKOFF_UTC  = '2026-06-29T20:30:00Z';
const MATCH_DATE   = '2026-06-29';

const BOOK = {
  toAdvanceHome:  -700,
  toAdvanceAway:  +450,
  homeML:         -275,
  drawML:         +400,
  awayML:         +800,
  noDrawAway:    -2000,
  overOdds:       -140,
  underOdds:      +110,
  totalLine:       2.5,
  homeSpreadLine:  -1.5,
  homeSpreadOdds:  +105,
  awaySpreadOdds:  -135,
  dc1X:           +370,
  dcX2:          -1100,
  bttsYes:        +100,
  bttsNo:         -130,
};

const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log('[STEP] DB connected');

// Upsert match
await conn.execute(`
  INSERT INTO wc2026_matches
    (match_id, match_date, kickoff_utc, stage, home_team_id, away_team_id, venue_id, status, display_order)
  VALUES (?, ?, ?, 'R32', ?, ?, 'inglewood', 'scheduled', 75)
  ON DUPLICATE KEY UPDATE
    match_date=VALUES(match_date), kickoff_utc=VALUES(kickoff_utc),
    home_team_id=VALUES(home_team_id), away_team_id=VALUES(away_team_id)
`, [MATCH_ID, MATCH_DATE, KICKOFF_UTC, HOME_TEAM_ID, AWAY_TEAM_ID]);
console.log('[VERIFY] Match upserted:', MATCH_ID);

// Upsert frozen book odds
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
console.log('[VERIFY] Book odds upserted:', MATCH_ID);

// Verify
const [rows] = await conn.execute(
  'SELECT match_id, book_home_ml, book_draw_ml, book_away_ml, book_no_draw_away_odds, to_advance_home_odds, to_advance_away_odds FROM wc2026_frozen_book_odds WHERE match_id=?',
  [MATCH_ID]
);
console.log('[VERIFY] DB row:', JSON.stringify(rows[0]));

await conn.end();
console.log('[STEP] DB disconnected | SEED COMPLETE');
