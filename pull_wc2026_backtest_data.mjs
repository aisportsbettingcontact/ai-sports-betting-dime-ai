/**
 * Pull all WC2026 data needed for v6 backtest:
 * - Completed fixtures (June 11-24) with scores
 * - DK historical odds (book_id=15) for all markets
 * - All book odds for consensus line derivation
 */
import mysql2 from 'mysql2/promise';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
dotenv.config();

const db = await mysql2.createConnection(process.env.DATABASE_URL);
console.log('[DB] Connected');

// Pull completed fixtures
const [fixtures] = await db.execute(`
  SELECT fixture_id, home_team_id, away_team_id, home_score, away_score,
         match_date, kickoff_utc, group_letter, matchday, status
  FROM wc2026_fixtures
  WHERE match_date < '2026-06-25' AND status = 'FT'
  ORDER BY match_date, kickoff_utc
`);
console.log(`[FIXTURES] ${fixtures.length} completed fixtures`);

// Pull DK odds (book_id=15) - primary book for backtesting
const [dkOdds] = await db.execute(`
  SELECT o.fixture_id, o.book_id, o.market, o.selection, o.american_odds, o.implied_prob, o.snapshot_ts
  FROM wc2026_odds_snapshots o
  JOIN wc2026_fixtures f ON f.fixture_id = o.fixture_id
  WHERE f.match_date < '2026-06-25' AND f.status = 'FT'
  AND o.book_id = 15
  ORDER BY o.fixture_id, o.market, o.selection, o.snapshot_ts
`);
console.log(`[DK_ODDS] ${dkOdds.length} DK odds rows`);

// Pull all book odds for consensus
const [allOdds] = await db.execute(`
  SELECT o.fixture_id, o.book_id, o.market, o.selection, o.american_odds, o.implied_prob, o.snapshot_ts
  FROM wc2026_odds_snapshots o
  JOIN wc2026_fixtures f ON f.fixture_id = o.fixture_id
  WHERE f.match_date < '2026-06-25' AND f.status = 'FT'
  AND o.book_id != 0
  ORDER BY o.fixture_id, o.book_id, o.market, o.selection
`);
console.log(`[ALL_ODDS] ${allOdds.length} total book odds rows`);

// Check which fixtures have DK odds
const fixturesWithDK = new Set(dkOdds.map(o => o.fixture_id));
console.log(`[COVERAGE] ${fixturesWithDK.size}/54 fixtures have DK odds`);

// Show fixtures WITHOUT DK odds
const allFixtureIds = new Set(fixtures.map(f => f.fixture_id));
const missingDK = [...allFixtureIds].filter(id => !fixturesWithDK.has(id));
if (missingDK.length > 0) {
  console.log(`[MISSING_DK] Fixtures without DK odds: ${missingDK.join(', ')}`);
  
  // Check what books they have
  const [altBooks] = await db.execute(`
    SELECT fixture_id, book_id, COUNT(*) as cnt
    FROM wc2026_odds_snapshots
    WHERE fixture_id IN (${missingDK.map(() => '?').join(',')})
    AND book_id != 0
    GROUP BY fixture_id, book_id
    ORDER BY fixture_id, book_id
  `, missingDK);
  console.log('[ALT_BOOKS]', JSON.stringify(altBooks));
}

// Save to files
writeFileSync('/home/ubuntu/wc2026_completed_fixtures.json', JSON.stringify(fixtures, null, 2));
writeFileSync('/home/ubuntu/wc2026_dk_odds_historical.json', JSON.stringify(dkOdds, null, 2));
writeFileSync('/home/ubuntu/wc2026_all_odds_historical.json', JSON.stringify(allOdds, null, 2));

console.log('[OUTPUT] Files written:');
console.log('  /home/ubuntu/wc2026_completed_fixtures.json');
console.log('  /home/ubuntu/wc2026_dk_odds_historical.json');
console.log('  /home/ubuntu/wc2026_all_odds_historical.json');

await db.end();
console.log('[DB] Disconnected');
