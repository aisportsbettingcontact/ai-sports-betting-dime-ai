/**
 * seedDkOddsJune23.mjs
 * Seeds DraftKings (book_id=68) odds for all 4 June 23, 2026 WC Group Stage fixtures.
 *
 * ORIENTATION AUDIT (critical — confirmed from DB query):
 *   wc26-g-045: Uzbekistan (HOME) vs Portugal (AWAY)   — user input: Uzbekistan ML +1800 / Portugal ML -650 ✅ HOME=UZB, AWAY=POR
 *   wc26-g-047: Ghana (HOME) vs England (AWAY)          — user input: Ghana ML +1300 / England ML -475 ✅ HOME=GHA, AWAY=ENG
 *   wc26-g-048: Panama (HOME) vs Croatia (AWAY)         — user input: Croatia ML -205 / Panama ML +550 ⚠️ DB HOME=PAN, AWAY=CRO
 *                                                          → home_ml = +550 (Panama), away_ml = -205 (Croatia)
 *   wc26-g-046: DR Congo (HOME) vs Colombia (AWAY)      — user input: DR Congo ML +550 / Colombia ML -180 ✅ HOME=COD, AWAY=COL
 *
 * MARKETS SEEDED PER FIXTURE:
 *   1X2 market:
 *     - selection='home'  → home team ML
 *     - selection='draw'  → draw odds
 *     - selection='away'  → away team ML
 *   DOUBLE_CHANCE market:
 *     - selection='home_draw' → home team W/D
 *     - selection='away_draw' → away team W/D
 *   TOTAL market:
 *     - selection='over'  → over line + over odds
 *     - selection='under' → under odds (line same as over)
 *
 * Total rows: 4 fixtures × 7 rows = 28 rows
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const BOOK_ID = 68; // DraftKings
const NOW_TS = new Date().toISOString().slice(0, 19).replace('T', ' '); // MySQL DATETIME format

// ─── FIXTURE DEFINITIONS ──────────────────────────────────────────────────────
// Each fixture: { id, homeTeam, awayTeam, markets }
// All odds/lines sourced directly from user-provided DK screenshot values.
// Orientation verified against DB: home_team_id = first team listed in DB.
const FIXTURES = [
  {
    id: 'wc26-g-045',
    homeTeam: 'Uzbekistan',
    awayTeam: 'Portugal',
    // DB orientation: Uzbekistan=HOME, Portugal=AWAY ✅ matches user input
    markets: {
      '1X2': { home: 1800, draw: 700, away: -650 },
      DOUBLE_CHANCE: { home_draw: 400, away_draw: -6000 },
      TOTAL: { line: 3.5, over: 130, under: -160 },
    },
  },
  {
    id: 'wc26-g-047',
    homeTeam: 'Ghana',
    awayTeam: 'England',
    // DB orientation: Ghana=HOME, England=AWAY ✅ matches user input
    markets: {
      '1X2': { home: 1300, draw: 550, away: -475 },
      DOUBLE_CHANCE: { home_draw: 320, away_draw: -3000 },
      TOTAL: { line: 2.5, over: -170, under: 140 },
    },
  },
  {
    id: 'wc26-g-048',
    homeTeam: 'Panama',
    awayTeam: 'Croatia',
    // DB orientation: Panama=HOME, Croatia=AWAY ⚠️ INVERTED from user input
    // User input: "Croatia ML: -205, Panama ML: +550, Croatia W/D: -900, Panama W/D: +160"
    // DB home=Panama → home_ml = +550 (Panama), away_ml = -205 (Croatia)
    // DC: home_draw = Panama W/D = +160, away_draw = Croatia W/D = -900
    markets: {
      '1X2': { home: 550, draw: 340, away: -205 },
      DOUBLE_CHANCE: { home_draw: 160, away_draw: -900 },
      TOTAL: { line: 2.5, over: -135, under: 110 },
    },
  },
  {
    id: 'wc26-g-046',
    homeTeam: 'DR Congo',
    awayTeam: 'Colombia',
    // DB orientation: DR Congo=HOME, Colombia=AWAY ✅ matches user input
    markets: {
      '1X2': { home: 550, draw: 310, away: -180 },
      DOUBLE_CHANCE: { home_draw: 140, away_draw: -800 },
      TOTAL: { line: 2.5, over: 125, under: -155 },
    },
  },
];

// ─── ROW BUILDER ──────────────────────────────────────────────────────────────
function impliedProb(americanOdds) {
  if (americanOdds < 0) return parseFloat((Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)).toFixed(5));
  return parseFloat((100 / (americanOdds + 100)).toFixed(5));
}
function buildRows(fixture) {
  const { id, homeTeam, awayTeam, markets } = fixture;
  const rows = [];

  // 1X2 — 3 rows
  rows.push({ fixture_id: id, book_id: BOOK_ID, market: '1X2', selection: 'home',  american_odds: markets['1X2'].home, line: null, implied_prob: impliedProb(markets['1X2'].home), snapshot_ts: NOW_TS, is_closing: 0 });
  rows.push({ fixture_id: id, book_id: BOOK_ID, market: '1X2', selection: 'draw',  american_odds: markets['1X2'].draw, line: null, implied_prob: impliedProb(markets['1X2'].draw), snapshot_ts: NOW_TS, is_closing: 0 });
  rows.push({ fixture_id: id, book_id: BOOK_ID, market: '1X2', selection: 'away',  american_odds: markets['1X2'].away, line: null, implied_prob: impliedProb(markets['1X2'].away), snapshot_ts: NOW_TS, is_closing: 0 });

  // DOUBLE_CHANCE — 2 rows
  rows.push({ fixture_id: id, book_id: BOOK_ID, market: 'DOUBLE_CHANCE', selection: 'home_draw', american_odds: markets.DOUBLE_CHANCE.home_draw, line: null, implied_prob: impliedProb(markets.DOUBLE_CHANCE.home_draw), snapshot_ts: NOW_TS, is_closing: 0 });
  rows.push({ fixture_id: id, book_id: BOOK_ID, market: 'DOUBLE_CHANCE', selection: 'away_draw', american_odds: markets.DOUBLE_CHANCE.away_draw, line: null, implied_prob: impliedProb(markets.DOUBLE_CHANCE.away_draw), snapshot_ts: NOW_TS, is_closing: 0 });

  // TOTAL — 2 rows
  rows.push({ fixture_id: id, book_id: BOOK_ID, market: 'TOTAL', selection: 'over',  american_odds: markets.TOTAL.over,  line: markets.TOTAL.line, implied_prob: impliedProb(markets.TOTAL.over), snapshot_ts: NOW_TS, is_closing: 0 });
  rows.push({ fixture_id: id, book_id: BOOK_ID, market: 'TOTAL', selection: 'under', american_odds: markets.TOTAL.under, line: markets.TOTAL.line, implied_prob: impliedProb(markets.TOTAL.under), snapshot_ts: NOW_TS, is_closing: 0 });

  return rows;
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────
function validateRows(fixture, rows) {
  const errors = [];
  const { id, homeTeam, awayTeam, markets } = fixture;

  // Check row count
  if (rows.length !== 7) errors.push(`Expected 7 rows, got ${rows.length}`);

  // Validate 1X2
  const homeRow = rows.find(r => r.market === '1X2' && r.selection === 'home');
  const drawRow = rows.find(r => r.market === '1X2' && r.selection === 'draw');
  const awayRow = rows.find(r => r.market === '1X2' && r.selection === 'away');
  if (!homeRow || homeRow.american_odds !== markets['1X2'].home) errors.push(`1X2 home mismatch: expected ${markets['1X2'].home}`);
  if (!drawRow || drawRow.american_odds !== markets['1X2'].draw) errors.push(`1X2 draw mismatch: expected ${markets['1X2'].draw}`);
  if (!awayRow || awayRow.american_odds !== markets['1X2'].away) errors.push(`1X2 away mismatch: expected ${markets['1X2'].away}`);

  // Validate DC
  const hdRow = rows.find(r => r.market === 'DOUBLE_CHANCE' && r.selection === 'home_draw');
  const adRow = rows.find(r => r.market === 'DOUBLE_CHANCE' && r.selection === 'away_draw');
  if (!hdRow || hdRow.american_odds !== markets.DOUBLE_CHANCE.home_draw) errors.push(`DC home_draw mismatch: expected ${markets.DOUBLE_CHANCE.home_draw}`);
  if (!adRow || adRow.american_odds !== markets.DOUBLE_CHANCE.away_draw) errors.push(`DC away_draw mismatch: expected ${markets.DOUBLE_CHANCE.away_draw}`);

  // Validate TOTAL
  const overRow = rows.find(r => r.market === 'TOTAL' && r.selection === 'over');
  const underRow = rows.find(r => r.market === 'TOTAL' && r.selection === 'under');
  if (!overRow || overRow.american_odds !== markets.TOTAL.over) errors.push(`TOTAL over mismatch: expected ${markets.TOTAL.over}`);
  if (!underRow || underRow.american_odds !== markets.TOTAL.under) errors.push(`TOTAL under mismatch: expected ${markets.TOTAL.under}`);
  if (!overRow || overRow.line !== markets.TOTAL.line) errors.push(`TOTAL line mismatch: expected ${markets.TOTAL.line}`);
  if (!underRow || underRow.line !== markets.TOTAL.line) errors.push(`TOTAL under line mismatch: expected ${markets.TOTAL.line}`);

  return errors;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[STEP] Connecting to database...');
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[STATE] Database connection established');

  let totalInserted = 0;
  let totalErrors = 0;

  for (const fixture of FIXTURES) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`[STEP] Processing fixture: ${fixture.id}`);
    console.log(`[INPUT] Home: ${fixture.homeTeam} | Away: ${fixture.awayTeam}`);
    console.log(`[INPUT] 1X2: home=${fixture.markets['1X2'].home} / draw=${fixture.markets['1X2'].draw} / away=${fixture.markets['1X2'].away}`);
    console.log(`[INPUT] DC: home_draw=${fixture.markets.DOUBLE_CHANCE.home_draw} / away_draw=${fixture.markets.DOUBLE_CHANCE.away_draw}`);
    console.log(`[INPUT] TOTAL: line=${fixture.markets.TOTAL.line} | over=${fixture.markets.TOTAL.over} / under=${fixture.markets.TOTAL.under}`);

    // Build rows
    const rows = buildRows(fixture);
    console.log(`[STATE] Built ${rows.length} rows for insertion`);

    // Pre-insert validation
    const validationErrors = validateRows(fixture, rows);
    if (validationErrors.length > 0) {
      console.error(`[ERROR] Pre-insert validation FAILED for ${fixture.id}:`);
      validationErrors.forEach(e => console.error(`  ✗ ${e}`));
      totalErrors += validationErrors.length;
      continue;
    }
    console.log(`[VERIFY] Pre-insert validation PASSED — all ${rows.length} rows structurally correct`);

    // Delete existing rows for this fixture+book to avoid duplicates
    const [delResult] = await conn.execute(
      `DELETE FROM wc2026_odds_snapshots WHERE fixture_id = ? AND book_id = ?`,
      [fixture.id, BOOK_ID]
    );
    console.log(`[STEP] Cleared ${delResult.affectedRows} existing rows for ${fixture.id} book_id=${BOOK_ID}`);

    // Insert all 7 rows
    for (const row of rows) {
      const [result] = await conn.execute(
        `INSERT INTO wc2026_odds_snapshots 
          (fixture_id, book_id, market, selection, american_odds, line, implied_prob, snapshot_ts, is_closing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.fixture_id, row.book_id, row.market, row.selection, row.american_odds, row.line, row.implied_prob, row.snapshot_ts, row.is_closing]
      );
      console.log(`[OUTPUT] Inserted: ${row.fixture_id} | ${row.market} | ${row.selection} | odds=${row.american_odds} | line=${row.line ?? 'N/A'} → insertId=${result.insertId}`);
      totalInserted++;
    }
    console.log(`[VERIFY] ${fixture.id} — all 7 rows inserted ✅`);
  }

  // ─── POST-INSERT AUDIT ───────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log('[STEP] Running post-insert audit — reading back all seeded rows...');

  for (const fixture of FIXTURES) {
    const [rows] = await conn.execute(
      `SELECT market, selection, american_odds, line 
       FROM wc2026_odds_snapshots 
       WHERE fixture_id = ? AND book_id = ?
       ORDER BY market, selection`,
      [fixture.id, BOOK_ID]
    );

    console.log(`\n[AUDIT] ${fixture.id} | ${fixture.homeTeam} (H) vs ${fixture.awayTeam} (A) — ${rows.length} rows in DB`);
    let auditPass = true;

    for (const row of rows) {
      let expected = null;
      if (row.market === '1X2') expected = fixture.markets['1X2'][row.selection];
      else if (row.market === 'DOUBLE_CHANCE') expected = fixture.markets.DOUBLE_CHANCE[row.selection];
      else if (row.market === 'TOTAL' && row.selection === 'over') expected = fixture.markets.TOTAL.over;
      else if (row.market === 'TOTAL' && row.selection === 'under') expected = fixture.markets.TOTAL.under;

      const match = expected !== null && row.american_odds === expected;
      const lineCheck = row.market === 'TOTAL' ? ` | line=${row.line}` : '';
      const status = match ? '✅' : '❌';
      if (!match) auditPass = false;
      console.log(`  ${status} ${row.market.padEnd(15)} ${row.selection.padEnd(12)} odds=${String(row.american_odds).padStart(6)}${lineCheck} | expected=${expected}`);
    }

    if (auditPass && rows.length === 7) {
      console.log(`[VERIFY] ${fixture.id} AUDIT PASSED — 7/7 rows correct ✅`);
    } else {
      console.error(`[ERROR] ${fixture.id} AUDIT FAILED — ${rows.length} rows, mismatches detected ❌`);
      totalErrors++;
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`[OUTPUT] SEED COMPLETE`);
  console.log(`[OUTPUT] Total rows inserted: ${totalInserted} / 28`);
  console.log(`[OUTPUT] Total errors: ${totalErrors}`);
  console.log(`[VERIFY] ${totalInserted === 28 && totalErrors === 0 ? 'ALL 28 ROWS SEEDED AND VERIFIED ✅' : 'SEED INCOMPLETE — CHECK ERRORS ABOVE ❌'}`);

  await conn.end();
  console.log('[STATE] Database connection closed');
}

main().catch(e => {
  console.error('[ERROR] Fatal:', e.message);
  process.exit(1);
});
