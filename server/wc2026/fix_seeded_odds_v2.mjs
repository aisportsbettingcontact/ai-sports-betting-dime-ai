/**
 * fix_seeded_odds_v2.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * Corrects all data errors in wc2026_frozen_book_odds for 12 fixtures.
 * Uses explicit named objects — zero column alignment risk.
 *
 * Source: User-provided book lines table (exact values, Jul 1 2026)
 * Convention:
 *   - "Home" = team on the right in user's table (Home column)
 *   - "Away" = team on the left in user's table (Away column)
 *   - spread = HOME team's spread line (positive = home is underdog)
 *   - homeSpreadOdds = odds for the HOME team's spread
 *   - awaySpreadOdds = odds for the AWAY team's spread
 *   - toAdvHome = odds for HOME team to advance
 *   - toAdvAway = odds for AWAY team to advance
 * ══════════════════════════════════════════════════════════════════════════════
 */
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CORRECTIONS = [
  // ── R32 ──────────────────────────────────────────────────────────────────────
  {
    fid: 'wc26-r32-080', // COD (Away) @ ENG (Home)
    homeML: -345, drawML: 400, awayML: 1100,
    spreadLine: 1.5, homeSpreadOdds: -105, awaySpreadOdds: -111,
    totalLine: 2.5, overOdds: 103, underOdds: -120,
    bttsYes: 163, bttsNo: -163,
    dc1x: 250, dcX2: -2000,
    noDrawHome: -588, noDrawAway: 1100,
    toAdvHome: -1100, toAdvAway: 600,
  },
  {
    fid: 'wc26-r32-081', // SEN (Away) @ BEL (Home)
    homeML: 115, drawML: 220, awayML: 270,
    spreadLine: 1.5, homeSpreadOdds: 300, awaySpreadOdds: -435,
    totalLine: 2.5, overOdds: 100, underOdds: -118,
    bttsYes: -133, bttsNo: 100,
    dc1x: -149, dcX2: -345,
    noDrawHome: -278, noDrawAway: 135,
    toAdvHome: -175, toAdvAway: 135,
  },
  {
    fid: 'wc26-r32-082', // BIH (Away) @ USA (Home)
    homeML: -250, drawML: 400, awayML: 600,
    spreadLine: 1.5, homeSpreadOdds: 108, awaySpreadOdds: -137,
    totalLine: 2.5, overOdds: -137, underOdds: 110,
    bttsYes: -105, bttsNo: -125,
    dc1x: 175, dcX2: -1000,
    noDrawHome: -588, noDrawAway: 450,
    toAdvHome: -700, toAdvAway: 450,
  },
  {
    fid: 'wc26-r32-083', // AUT (Away) @ ESP (Home)
    homeML: -303, drawML: 425, awayML: 750,
    spreadLine: 1.5, homeSpreadOdds: 103, awaySpreadOdds: -120,
    totalLine: 2.5, overOdds: -125, underOdds: 100,
    bttsYes: 120, bttsNo: -161,
    dc1x: 225, dcX2: -1250,
    noDrawHome: -588, noDrawAway: 475,
    toAdvHome: -750, toAdvAway: 475,
  },
  {
    fid: 'wc26-r32-084', // CRO (Away) @ POR (Home)
    homeML: -133, drawML: 250, awayML: 400,
    spreadLine: 1.5, homeSpreadOdds: 210, awaySpreadOdds: -286,
    totalLine: 2.5, overOdds: 110, underOdds: -137,
    bttsYes: -105, bttsNo: -125,
    dc1x: 100, dcX2: -588,
    noDrawHome: -345, noDrawAway: 205,
    toAdvHome: -270, toAdvAway: 205,
  },
  {
    fid: 'wc26-r32-085', // ALG (Away) @ SUI (Home)
    homeML: 100, drawML: 220, awayML: 320,
    spreadLine: 1.5, homeSpreadOdds: 270, awaySpreadOdds: -385,
    totalLine: 2.5, overOdds: 110, underOdds: -137,
    bttsYes: -110, bttsNo: -110,
    dc1x: -125, dcX2: -455,
    noDrawHome: -278, noDrawAway: 155,
    toAdvHome: -200, toAdvAway: 155,
  },
  {
    fid: 'wc26-r32-086', // EGY (Away) @ AUS (Home)
    homeML: 240, drawML: 188, awayML: 145,
    spreadLine: -1.5, homeSpreadOdds: -667, awaySpreadOdds: 450,
    totalLine: 1.5, overOdds: -175, underOdds: 138,
    bttsYes: 120, bttsNo: -161,
    dc1x: -333, dcX2: -189,
    noDrawHome: -250, noDrawAway: -150,
    toAdvHome: 115, toAdvAway: -150,
  },
  {
    fid: 'wc26-r32-087', // CPV (Away) @ ARG (Home)
    homeML: -588, drawML: 650, awayML: 1400,
    spreadLine: 2.5, homeSpreadOdds: 142, awaySpreadOdds: -189,
    totalLine: 2.5, overOdds: -149, underOdds: 120,
    bttsYes: 175, bttsNo: -250,
    dc1x: 400, dcX2: -3333,
    noDrawHome: -1000, noDrawAway: 950,
    toAdvHome: -2500, toAdvAway: 950,
  },
  {
    fid: 'wc26-r32-088', // GHA (Away) @ COL (Home)
    homeML: -189, drawML: 290, awayML: 600,
    spreadLine: 1.5, homeSpreadOdds: 150, awaySpreadOdds: -200,
    totalLine: 2.5, overOdds: 120, underOdds: -149,
    bttsYes: 125, bttsNo: -175,
    dc1x: 138, dcX2: -1000,
    noDrawHome: -400, noDrawAway: 320,
    toAdvHome: -450, toAdvAway: 320,
  },
  // ── R16 ──────────────────────────────────────────────────────────────────────
  {
    fid: 'wc26-r16-089', // FRA (Away) @ PAR (Home)
    homeML: 1400, drawML: 600, awayML: -500,
    spreadLine: -2.5, homeSpreadOdds: -189, awaySpreadOdds: 142,
    totalLine: 2.5, overOdds: -175, underOdds: 138,
    bttsYes: 138, bttsNo: -189,
    dc1x: 333, dcX2: -1000,
    noDrawHome: null, noDrawAway: null,
    toAdvHome: 850, toAdvAway: -2000,
  },
  {
    fid: 'wc26-r16-090', // MAR (Away) @ CAN (Home)
    homeML: 375, drawML: 250, awayML: -125,
    spreadLine: -1.5, homeSpreadOdds: -303, awaySpreadOdds: 230,
    totalLine: 2.5, overOdds: 130, underOdds: -161,
    bttsYes: 105, bttsNo: -143,
    dc1x: -105, dcX2: -556,
    noDrawHome: -345, noDrawAway: -255,
    toAdvHome: 195, toAdvAway: -255,
  },
  {
    fid: 'wc26-r16-091', // NOR (Away) @ BRA (Home)
    homeML: -111, drawML: 240, awayML: 320,
    spreadLine: 1.5, homeSpreadOdds: 230, awaySpreadOdds: -303,
    totalLine: 2.5, overOdds: -108, underOdds: -108,
    bttsYes: -133, bttsNo: 100,
    dc1x: -110, dcX2: -455,
    noDrawHome: -333, noDrawAway: 170,
    toAdvHome: -215, toAdvAway: 170,
  },
];

console.log('[INPUT] Applying corrections to 12 fixtures with explicit named fields...\n');

let totalUpdated = 0;
let totalErrors = 0;

for (const c of CORRECTIONS) {
  const [result] = await conn.query(`
    UPDATE wc2026_frozen_book_odds SET
      book_home_ml           = ?,
      book_draw_ml           = ?,
      book_away_ml           = ?,
      book_spread_line       = ?,
      book_home_spread_odds  = ?,
      book_away_spread_odds  = ?,
      book_total_line        = ?,
      book_over_odds         = ?,
      book_under_odds        = ?,
      book_btts_yes_odds     = ?,
      book_btts_no_odds      = ?,
      book_dc_1x_odds        = ?,
      book_dc_x2_odds        = ?,
      book_no_draw_home_odds = ?,
      book_no_draw_away_odds = ?,
      to_advance_home_odds   = ?,
      to_advance_away_odds   = ?
    WHERE match_id = ?
  `, [
    c.homeML, c.drawML, c.awayML,
    c.spreadLine, c.homeSpreadOdds, c.awaySpreadOdds,
    c.totalLine, c.overOdds, c.underOdds,
    c.bttsYes, c.bttsNo,
    c.dc1x, c.dcX2,
    c.noDrawHome, c.noDrawAway,
    c.toAdvHome, c.toAdvAway,
    c.fid
  ]);

  const affected = result.affectedRows;
  totalUpdated += affected;

  if (affected === 1) {
    console.log(`[STEP] ✅ ${c.fid}: UPDATED`);
    console.log(`  [STATE] homeML=${c.homeML} drawML=${c.drawML} awayML=${c.awayML}`);
    console.log(`  [STATE] spread=${c.spreadLine} homeSpreadOdds=${c.homeSpreadOdds} awaySpreadOdds=${c.awaySpreadOdds}`);
    console.log(`  [STATE] total=${c.totalLine} over=${c.overOdds} under=${c.underOdds}`);
    console.log(`  [STATE] bttsYes=${c.bttsYes} bttsNo=${c.bttsNo}`);
    console.log(`  [STATE] dc1x=${c.dc1x} dcX2=${c.dcX2}`);
    console.log(`  [STATE] noDrawHome=${c.noDrawHome} noDrawAway=${c.noDrawAway}`);
    console.log(`  [STATE] toAdvHome=${c.toAdvHome} toAdvAway=${c.toAdvAway}`);
  } else {
    console.log(`[STEP] ❌ ${c.fid}: NOT FOUND (affectedRows=${affected})`);
    totalErrors++;
  }
}

console.log(`\n[OUTPUT] Updated: ${totalUpdated}/12 | Errors: ${totalErrors}`);

// ── Full verification re-read ─────────────────────────────────────────────────
console.log('\n[VERIFY] Re-reading all 12 rows for full validation...\n');
const fids = CORRECTIONS.map(c => c.fid);
const [rows] = await conn.query(`
  SELECT match_id,
    book_home_ml, book_draw_ml, book_away_ml,
    book_spread_line, book_home_spread_odds, book_away_spread_odds,
    book_total_line, book_over_odds, book_under_odds,
    book_btts_yes_odds, book_btts_no_odds,
    book_dc_1x_odds, book_dc_x2_odds,
    book_no_draw_home_odds, book_no_draw_away_odds,
    to_advance_home_odds, to_advance_away_odds
  FROM wc2026_frozen_book_odds
  WHERE match_id IN (?)
  ORDER BY match_id
`, [fids]);

const corrMap = Object.fromEntries(CORRECTIONS.map(c => [c.fid, c]));
let verifyErrors = 0;

for (const row of rows) {
  const c = corrMap[row.match_id];
  const checks = [
    ['book_home_ml',           row.book_home_ml,           c.homeML],
    ['book_draw_ml',           row.book_draw_ml,            c.drawML],
    ['book_away_ml',           row.book_away_ml,            c.awayML],
    ['book_spread_line',       parseFloat(row.book_spread_line), c.spreadLine],
    ['book_home_spread_odds',  row.book_home_spread_odds,   c.homeSpreadOdds],
    ['book_away_spread_odds',  row.book_away_spread_odds,   c.awaySpreadOdds],
    ['book_total_line',        parseFloat(row.book_total_line), c.totalLine],
    ['book_over_odds',         row.book_over_odds,          c.overOdds],
    ['book_under_odds',        row.book_under_odds,         c.underOdds],
    ['book_btts_yes_odds',     row.book_btts_yes_odds,      c.bttsYes],
    ['book_btts_no_odds',      row.book_btts_no_odds,       c.bttsNo],
    ['to_advance_home_odds',   row.to_advance_home_odds,    c.toAdvHome],
    ['to_advance_away_odds',   row.to_advance_away_odds,    c.toAdvAway],
  ];

  let rowErrors = 0;
  const errLines = [];
  for (const [col, actual, expected] of checks) {
    const match = (actual === null && expected === null) || Number(actual) === Number(expected);
    if (!match) {
      errLines.push(`    ❌ ${col}: DB=${actual} EXPECTED=${expected}`);
      rowErrors++;
      verifyErrors++;
    }
  }

  if (rowErrors === 0) {
    console.log(`[VERIFY] ✅ ${row.match_id}: ALL ${checks.length} VALUES CORRECT`);
  } else {
    console.log(`[VERIFY] ❌ ${row.match_id}: ${rowErrors} ERRORS`);
    errLines.forEach(e => console.log(e));
  }
}

console.log(`\n[VERIFY] Total verification errors: ${verifyErrors}`);
if (verifyErrors === 0) {
  console.log('[VERIFY] ✅ ALL 12 FIXTURES FULLY CORRECT — ZERO ERRORS');
} else {
  console.log('[VERIFY] ❌ CORRECTIONS INCOMPLETE — RE-RUN REQUIRED');
}

await conn.end();
console.log('\n[DONE]');
