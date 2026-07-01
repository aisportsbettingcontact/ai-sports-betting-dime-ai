/**
 * audit_column_mapping.mjs
 * 500x forensic audit: DB column names vs Drizzle schema vs router mapping vs frontend field names
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── 1. Get actual DB columns ──────────────────────────────────────────────────
const [bookCols] = await conn.query('SHOW COLUMNS FROM wc2026_frozen_book_odds');
const [modelCols] = await conn.query('SHOW COLUMNS FROM wc2026_model_projections');

console.log('\n══ FROZEN_BOOK_ODDS ACTUAL COLUMNS ══');
bookCols.forEach(c => console.log(`  ${c.Field.padEnd(40)} ${c.Type.padEnd(20)} NULL=${c.Null} DEFAULT=${c.Default}`));

console.log('\n══ MODEL_PROJECTIONS ACTUAL COLUMNS ══');
modelCols.forEach(c => console.log(`  ${c.Field.padEnd(40)} ${c.Type.padEnd(20)} NULL=${c.Null} DEFAULT=${c.Default}`));

// ── 2. Get actual seeded data for wc26-r32-080 (DR Congo @ England) ──────────
const [bookRow] = await conn.query('SELECT * FROM wc2026_frozen_book_odds WHERE fixture_id = ?', ['wc26-r32-080']);
console.log('\n══ BOOK ODDS ROW: wc26-r32-080 ══');
if (bookRow.length > 0) {
  Object.entries(bookRow[0]).forEach(([k, v]) => {
    const status = v === null ? '❌ NULL' : `✅ ${v}`;
    console.log(`  ${k.padEnd(40)} ${status}`);
  });
} else {
  console.log('  ❌ NO ROW FOUND');
}

// ── 3. Check what the router's frozenBookToOdds maps to ──────────────────────
// Router references: r.bookHomeMl, r.bookDrawMl, r.bookAwayMl, r.bookSpreadLine,
// r.bookHomeSpreadOdds, r.bookAwaySpreadOdds, r.bookTotalLine, r.bookOverOdds,
// r.bookUnderOdds, r.bookBttsYesOdds, r.bookBttsNoOdds, r.bookDc1XOdds,
// r.bookDcX2Odds, r.bookNoDrawAwayOdds, r.toAdvanceHomeOdds, r.toAdvanceAwayOdds

// These are Drizzle camelCase names. Map them to snake_case DB columns:
const ROUTER_TO_DB = {
  'bookHomeMl':          'book_home_ml',
  'bookDrawMl':          'book_draw_ml',
  'bookAwayMl':          'book_away_ml',
  'bookSpreadLine':      'book_spread_line',
  'bookHomeSpreadOdds':  'book_home_spread_odds',
  'bookAwaySpreadOdds':  'book_away_spread_odds',
  'bookTotalLine':       'book_total_line',
  'bookOverOdds':        'book_over_odds',
  'bookUnderOdds':       'book_under_odds',
  'bookBttsYesOdds':     'book_btts_yes_odds',
  'bookBttsNoOdds':      'book_btts_no_odds',
  'bookDc1XOdds':        'book_dc_1x_odds',
  'bookDcX2Odds':        'book_dc_x2_odds',
  'bookNoDrawAwayOdds':  'book_no_draw_away_odds',
  'toAdvanceHomeOdds':   'to_advance_home_odds',
  'toAdvanceAwayOdds':   'to_advance_away_odds',
};

const actualBookColNames = new Set(bookCols.map(c => c.Field));

console.log('\n══ ROUTER → DB COLUMN MAPPING VALIDATION ══');
let bookMapErrors = 0;
for (const [drizzle, snake] of Object.entries(ROUTER_TO_DB)) {
  const exists = actualBookColNames.has(snake);
  const val = bookRow.length > 0 ? bookRow[0][snake] : 'NO_ROW';
  const valStatus = val === null ? '❌ NULL' : val === undefined ? '❌ MISSING' : `✅ ${val}`;
  if (exists) {
    console.log(`  ✅ ${drizzle.padEnd(25)} → ${snake.padEnd(35)} | VALUE: ${valStatus}`);
  } else {
    console.log(`  ❌ ${drizzle.padEnd(25)} → ${snake.padEnd(35)} | COLUMN DOES NOT EXIST IN DB`);
    bookMapErrors++;
  }
}
console.log(`\n  Book mapping errors: ${bookMapErrors}`);

// ── 4. Model projections column mapping ──────────────────────────────────────
const MODEL_ROUTER_TO_DB = {
  'modelHomeML':        'model_home_ml',
  'modelDrawML':        'model_draw_ml',
  'modelAwayML':        'model_away_ml',
  'modelTotal':         'model_total',
  'overOdds':           'over_odds',
  'underOdds':          'under_odds',
  'modelSpread':        'model_spread',
  'homeSpreadOdds':     'home_spread_odds',
  'awaySpreadOdds':     'away_spread_odds',
  'dc1XOdds':           'dc_1x_odds',
  'dcX2Odds':           'dc_x2_odds',
  'bttsYesOdds':        'btts_yes_odds',
  'bttsNoOdds':         'btts_no_odds',
  'noDrawHomeOdds':     'no_draw_home_odds',
  'toAdvanceHomeOdds':  'to_advance_home_odds',
  'toAdvanceAwayOdds':  'to_advance_away_odds',
  'homeEdge':           'home_edge',
  'drawEdge':           'draw_edge',
  'awayEdge':           'away_edge',
  'homeWinProb':        'home_win_prob',
  'drawProb':           'draw_prob',
  'awayWinProb':        'away_win_prob',
  'projHomeScore':      'proj_home_score',
  'projAwayScore':      'proj_away_score',
  'projTotal':          'proj_total',
};

const actualModelColNames = new Set(modelCols.map(c => c.Field));

console.log('\n══ MODEL ROUTER → DB COLUMN MAPPING VALIDATION ══');
let modelMapErrors = 0;
for (const [drizzle, snake] of Object.entries(MODEL_ROUTER_TO_DB)) {
  const exists = actualModelColNames.has(snake);
  if (exists) {
    console.log(`  ✅ ${drizzle.padEnd(25)} → ${snake}`);
  } else {
    console.log(`  ❌ ${drizzle.padEnd(25)} → ${snake} | COLUMN DOES NOT EXIST IN DB`);
    modelMapErrors++;
  }
}
console.log(`\n  Model mapping errors: ${modelMapErrors}`);

// ── 5. Check Drizzle schema vs actual DB ──────────────────────────────────────
const schemaPath = '/home/ubuntu/ai-sports-betting/drizzle/wc2026.schema.ts';
const schemaContent = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';
console.log('\n══ SCHEMA FILE: ' + schemaPath + ' ══');
// Extract frozen book odds table definition
const frozenMatch = schemaContent.match(/wc2026FrozenBookOdds[\s\S]{0,3000}/);
if (frozenMatch) {
  console.log(frozenMatch[0].substring(0, 2000));
}

await conn.end();
console.log('\n[DONE]');
