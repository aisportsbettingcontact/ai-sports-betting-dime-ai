/**
 * seedDoubleChanceJune21.mjs
 * Seeds DK Double Chance (1X / X2) odds for all 4 June 21 WC2026 matches.
 *
 * Double Chance market:
 *   home_draw (1X) = Home Win OR Draw
 *   away_draw (X2) = Away Win OR Draw
 *
 * User-provided DK odds (June 21, 2026):
 *
 * wc26-g-039 Spain vs Saudi Arabia (home=esp, away=ksa)
 *   Spain or Draw (1X):        -10000
 *   Saudi Arabia or Draw (X2): +500
 *
 * wc26-g-037 Iran vs Belgium (home=irn, away=bel)
 *   Iran or Draw (1X):         +175
 *   Belgium or Draw (X2):      -1000
 *
 * wc26-g-040 Cape Verde vs Uruguay (home=cpv, away=uru)
 *   Cape Verde or Draw (1X):   +165
 *   Uruguay or Draw (X2):      -1100
 *
 * wc26-g-038 New Zealand vs Egypt (home=nzl, away=egy)
 *   New Zealand or Draw (1X):  +130
 *   Egypt or Draw (X2):        -700
 *
 * Logging format:
 *   [INPUT]  → match, odds provided
 *   [STEP]   → insert operation
 *   [STATE]  → row details
 *   [OUTPUT] → rows written
 *   [VERIFY] → PASS/FAIL + reason
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const BOOK_ID_DK = 68;
const MARKET = 'DOUBLE_CHANCE';
const snapshotTs = new Date();

// User-provided DK Double Chance odds
// home_draw = 1X (Home Win OR Draw), away_draw = X2 (Away Win OR Draw)
const MATCHES = [
  {
    matchId: 'wc26-g-039',
    label: 'Spain vs Saudi Arabia',
    homeTeamId: 'esp',
    awayTeamId: 'ksa',
    home_draw: -10000,  // Spain or Draw (1X)
    away_draw: 500,     // Saudi Arabia or Draw (X2)
  },
  {
    matchId: 'wc26-g-037',
    label: 'Iran vs Belgium',
    homeTeamId: 'irn',
    awayTeamId: 'bel',
    home_draw: 175,     // Iran or Draw (1X)
    away_draw: -1000,   // Belgium or Draw (X2)
  },
  {
    matchId: 'wc26-g-040',
    label: 'Cape Verde vs Uruguay',
    homeTeamId: 'cpv',
    awayTeamId: 'uru',
    home_draw: 165,     // Cape Verde or Draw (1X)
    away_draw: -1100,   // Uruguay or Draw (X2)
  },
  {
    matchId: 'wc26-g-038',
    label: 'New Zealand vs Egypt',
    homeTeamId: 'nzl',
    awayTeamId: 'egy',
    home_draw: 130,     // New Zealand or Draw (1X)
    away_draw: -700,    // Egypt or Draw (X2)
  },
];

function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

async function main() {
  console.log('[INPUT] Seeding DK Double Chance odds for 4 June 21 WC2026 matches');
  console.log(`[INPUT] snapshotTs=${snapshotTs.toISOString()} bookId=${BOOK_ID_DK} market=${MARKET}`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Delete existing DK double chance rows for these matches to avoid duplicates
  const matchIds = MATCHES.map(f => f.matchId);
  const placeholders = matchIds.map(() => '?').join(',');
  const [deleteResult] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots WHERE match_id IN (${placeholders}) AND book_id = ? AND market = ?`,
    [...matchIds, BOOK_ID_DK, MARKET]
  );
  console.log(`[STEP] Deleted ${deleteResult.affectedRows} existing DK double chance rows`);

  const rows = [];
  for (const f of MATCHES) {
    console.log(`\n[STATE] ${f.matchId} — ${f.label}`);
    console.log(`  [STATE] home(${f.homeTeamId}) 1X (home_draw): ${f.home_draw > 0 ? '+' : ''}${f.home_draw} → implied=${(americanToImplied(f.home_draw) * 100).toFixed(3)}%`);
    console.log(`  [STATE] away(${f.awayTeamId}) X2 (away_draw): ${f.away_draw > 0 ? '+' : ''}${f.away_draw} → implied=${(americanToImplied(f.away_draw) * 100).toFixed(3)}%`);

    rows.push({
      matchId: f.matchId,
      selection: 'home_draw',
      americanOdds: f.home_draw,
      impliedProb: americanToImplied(f.home_draw),
    });
    rows.push({
      matchId: f.matchId,
      selection: 'away_draw',
      americanOdds: f.away_draw,
      impliedProb: americanToImplied(f.away_draw),
    });
  }

  // Insert all rows
  let inserted = 0;
  for (const row of rows) {
    await conn.execute(
      `INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, american_odds, implied_prob, is_closing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.matchId, snapshotTs, BOOK_ID_DK, MARKET, row.selection, row.americanOdds, row.impliedProb, false]
    );
    inserted++;
    console.log(`[STEP] Inserted: match=${row.matchId} selection=${row.selection} odds=${row.americanOdds > 0 ? '+' : ''}${row.americanOdds}`);
  }

  // Verify
  const [verifyRows] = await conn.execute(
    `SELECT match_id, selection, american_odds FROM wc2026_odds_snapshots
     WHERE match_id IN (${placeholders}) AND book_id = ? AND market = ?
     ORDER BY match_id, selection`,
    [...matchIds, BOOK_ID_DK, MARKET]
  );

  console.log(`\n[VERIFY] DB state after insert:`);
  for (const r of verifyRows) {
    console.log(`  ${r.match_id} | ${r.selection} | ${r.american_odds > 0 ? '+' : ''}${r.american_odds}`);
  }

  const expectedCount = MATCHES.length * 2; // 2 rows per match (home_draw + away_draw)
  const pass = verifyRows.length === expectedCount && inserted === expectedCount;
  console.log(`\n[OUTPUT] Inserted ${inserted} rows`);
  console.log(`[VERIFY] ${pass ? '✅ PASS' : '❌ FAIL'} — expected=${expectedCount} actual=${verifyRows.length}`);

  await conn.end();
}

main().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
