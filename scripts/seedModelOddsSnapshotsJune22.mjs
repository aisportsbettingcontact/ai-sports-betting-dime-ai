/**
 * seedModelOddsSnapshotsJune22.mjs
 *
 * Seeds v3-champion model lines into wc2026_odds_snapshots (book_id=0)
 * for all 4 June 22, 2026 WC2026 matches.
 *
 * These are HARDCODED final values from the v3-champion 1M Monte Carlo model.
 * is_closing=1 marks them as final — they will not be overwritten by future runs.
 *
 * MATCHES (June 22, 2026 PST):
 *   wc26-g-043: Austria (H) vs Argentina (A)  — 10:00 AM PST
 *   wc26-g-041: Iraq (H) vs France (A)        — 2:00 PM PST  [TOTAL LINE = 3.5]
 *   wc26-g-042: Norway (H) vs Senegal (A)     — 5:00 PM PST
 *   wc26-g-044: Algeria (H) vs Jordan (A)     — 8:00 PM PST
 *
 * MARKETS SEEDED:
 *   1X2: home / draw / away
 *   TOTAL: over / under (with correct line)
 *   DOUBLE_CHANCE: home_draw (1X) / away_draw (X2)
 *
 * LOGGING: [SEED_MODEL_J22]
 */
import { config } from 'dotenv';
config();
import mysql from 'mysql2/promise';

const TAG = '[SEED_MODEL_J22]';

// ── HARDCODED v3-champion lines ───────────────────────────────────────────────
// Source: 1M Monte Carlo, eloK=0.70 rankK=0.30 homeAdv=1.08 rho=-0.13 bg=2.65 drawFloor=0.22
// Iraq/France total line = 3.5 (per user specification)
const MODEL_ODDS = [
  {
    matchId: 'wc26-g-043',
    label: 'Austria (H) vs Argentina (A)',
    markets: [
      // 1X2
      { market: '1X2', selection: 'home',  americanOdds: 2928, impliedProb: 0.033, line: null },
      { market: '1X2', selection: 'draw',  americanOdds: 355,  impliedProb: 0.220, line: null },
      { market: '1X2', selection: 'away',  americanOdds: -295, impliedProb: 0.747, line: null },
      // TOTAL (line=2.5)
      { market: 'TOTAL', selection: 'over',  americanOdds: 119,  impliedProb: 0.456, line: 2.5 },
      { market: 'TOTAL', selection: 'under', americanOdds: -119, impliedProb: 0.544, line: 2.5 },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', americanOdds: 295,   impliedProb: 0.253, line: null },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', americanOdds: -2928, impliedProb: 0.967, line: null },
    ],
  },
  {
    matchId: 'wc26-g-041',
    label: 'Iraq (H) vs France (A)',
    markets: [
      // 1X2
      { market: '1X2', selection: 'home',  americanOdds: 5037, impliedProb: 0.019, line: null },
      { market: '1X2', selection: 'draw',  americanOdds: 355,  impliedProb: 0.220, line: null },
      { market: '1X2', selection: 'away',  americanOdds: -318, impliedProb: 0.761, line: null },
      // TOTAL (line=3.5 — per user specification)
      { market: 'TOTAL', selection: 'over',  americanOdds: 317,  impliedProb: 0.240, line: 3.5 },
      { market: 'TOTAL', selection: 'under', americanOdds: -317, impliedProb: 0.760, line: 3.5 },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', americanOdds: 318,   impliedProb: 0.239, line: null },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', americanOdds: -5037, impliedProb: 0.981, line: null },
    ],
  },
  {
    matchId: 'wc26-g-042',
    label: 'Norway (H) vs Senegal (A)',
    markets: [
      // 1X2
      { market: '1X2', selection: 'home',  americanOdds: -136, impliedProb: 0.576, line: null },
      { market: '1X2', selection: 'draw',  americanOdds: 291,  impliedProb: 0.256, line: null },
      { market: '1X2', selection: 'away',  americanOdds: 495,  impliedProb: 0.168, line: null },
      // TOTAL (line=2.5)
      { market: 'TOTAL', selection: 'over',  americanOdds: -104, impliedProb: 0.510, line: 2.5 },
      { market: 'TOTAL', selection: 'under', americanOdds: 104,  impliedProb: 0.490, line: 2.5 },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', americanOdds: -495, impliedProb: 0.832, line: null },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', americanOdds: 136,  impliedProb: 0.424, line: null },
    ],
  },
  {
    matchId: 'wc26-g-044',
    label: 'Algeria (H) vs Jordan (A)',
    markets: [
      // 1X2
      { market: '1X2', selection: 'home',  americanOdds: -157, impliedProb: 0.610, line: null },
      { market: '1X2', selection: 'draw',  americanOdds: 310,  impliedProb: 0.244, line: null },
      { market: '1X2', selection: 'away',  americanOdds: 586,  impliedProb: 0.146, line: null },
      // TOTAL (line=2.5)
      { market: 'TOTAL', selection: 'over',  americanOdds: -105, impliedProb: 0.513, line: 2.5 },
      { market: 'TOTAL', selection: 'under', americanOdds: 105,  impliedProb: 0.487, line: 2.5 },
      // DOUBLE_CHANCE
      { market: 'DOUBLE_CHANCE', selection: 'home_draw', americanOdds: -586, impliedProb: 0.854, line: null },
      { market: 'DOUBLE_CHANCE', selection: 'away_draw', americanOdds: 157,  impliedProb: 0.390, line: null },
    ],
  },
];

async function main() {
  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} Seeding v3-champion model lines → wc2026_odds_snapshots (book_id=0)`);
  console.log(`${TAG} 4 matches × 7 markets = 28 rows | is_closing=1 (hardcoded final)`);
  console.log(`${TAG} Timestamp: ${new Date().toISOString()}`);
  console.log(`${TAG} ${'='.repeat(72)}\n`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Step 1: Verify all 4 match IDs exist in DB
  const matchIds = MODEL_ODDS.map(f => f.matchId);
  const [matchCheck] = await conn.execute(
    `SELECT match_id, status FROM wc2026_matches WHERE match_id IN (${matchIds.map(() => '?').join(',')}) ORDER BY kickoff_utc`,
    matchIds
  );
  console.log(`${TAG} [VERIFY] DB matches found: ${matchCheck.length}/4`);
  for (const row of matchCheck) {
    console.log(`${TAG}   ✓ ${row.match_id} (${row.status})`);
  }
  if (matchCheck.length !== 4) {
    console.error(`${TAG} [FATAL] Expected 4 matches, got ${matchCheck.length}. Aborting.`);
    process.exit(1);
  }

  // Step 2: Delete existing book_id=0 rows for these matches (clean slate)
  const [delResult] = await conn.execute(
    `DELETE FROM wc2026_odds_snapshots WHERE book_id = 0 AND match_id IN (${matchIds.map(() => '?').join(',')})`,
    matchIds
  );
  console.log(`\n${TAG} [STEP] Deleted ${delResult.affectedRows} existing book_id=0 rows for June 22 matches`);

  // Step 3: Insert all 28 rows
  let inserted = 0;
  let errors = 0;
  const now = new Date();

  for (const match of MODEL_ODDS) {
    console.log(`\n${TAG} [STEP] Inserting ${match.markets.length} rows for ${match.matchId} (${match.label})`);
    for (const mkt of match.markets) {
      try {
        await conn.execute(
          `INSERT INTO wc2026_odds_snapshots
            (match_id, book_id, market, selection, line, american_odds, implied_prob, snapshot_ts, is_closing)
           VALUES (?, 0, ?, ?, ?, ?, ?, ?, 1)`,
          [match.matchId, mkt.market, mkt.selection, mkt.line, mkt.americanOdds, mkt.impliedProb, now]
        );
        inserted++;
        const lineStr = mkt.line !== null ? ` line=${mkt.line}` : '';
        const oddsStr = mkt.americanOdds > 0 ? `+${mkt.americanOdds}` : `${mkt.americanOdds}`;
        console.log(`${TAG}   [STATE] ✅ ${mkt.market}:${mkt.selection}${lineStr} → ${oddsStr} (${(mkt.impliedProb*100).toFixed(1)}%)`);
      } catch (err) {
        errors++;
        console.error(`${TAG}   [ERROR] ❌ ${match.matchId}:${mkt.market}:${mkt.selection} → ${err.message}`);
      }
    }
  }

  // Step 4: Verify all 28 rows are in DB
  const [verifyRows] = await conn.execute(
    `SELECT match_id, market, selection, american_odds, line, is_closing
     FROM wc2026_odds_snapshots
     WHERE book_id = 0 AND match_id IN (${matchIds.map(() => '?').join(',')})
     ORDER BY match_id, market, selection`,
    matchIds
  );
  const verifyCount = verifyRows.length;

  console.log(`\n${TAG} ${'='.repeat(72)}`);
  console.log(`${TAG} [VERIFY] Inserted: ${inserted}/28 | Errors: ${errors} | DB rows confirmed: ${verifyCount}/28`);
  console.log(`${TAG} [VERIFY] ${verifyCount === 28 && errors === 0 ? '✅ PASS — all 28 rows clean' : '❌ FAIL — check errors above'}`);

  // Step 5: Print final summary per match
  console.log(`\n${TAG} ── Final DB state ──────────────────────────────────────────`);
  for (const match of MODEL_ODDS) {
    const rows = verifyRows.filter(r => r.match_id === match.matchId);
    console.log(`${TAG} ${match.matchId} (${match.label}) — ${rows.length} rows:`);
    for (const row of rows) {
      const odds = row.american_odds > 0 ? `+${row.american_odds}` : `${row.american_odds}`;
      const lineStr = row.line !== null ? ` [line=${row.line}]` : '';
      console.log(`${TAG}   ${row.market}:${row.selection}${lineStr} = ${odds} | is_closing=${row.is_closing}`);
    }
  }

  await conn.end();

  if (errors > 0 || verifyCount !== 28) {
    console.error(`${TAG} [FATAL] Seed incomplete. errors=${errors} verifyCount=${verifyCount}`);
    process.exit(1);
  }

  console.log(`\n${TAG} ✅ DONE — 28/28 v3-champion model lines hardcoded into feed (book_id=0, is_closing=1)`);
  process.exit(0);
}

main().catch(err => {
  console.error(`${TAG} [FATAL] ${err.message}\n${err.stack}`);
  process.exit(1);
});
