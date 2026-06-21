import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

async function verify() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Get the LATEST DK (book_id=68) 1X2 odds for all 4 June 21 fixtures
  const [rows] = await conn.query(`
    SELECT s.fixture_id, s.selection, s.american_odds, s.snapshot_ts,
           f.home_team_id, f.away_team_id
    FROM wc2026_odds_snapshots s
    JOIN wc2026_fixtures f ON s.fixture_id = f.fixture_id
    WHERE s.fixture_id IN ('wc26-g-037','wc26-g-038','wc26-g-039','wc26-g-040')
      AND s.book_id = 68
      AND s.market = '1X2'
    ORDER BY s.fixture_id, s.snapshot_ts DESC, s.selection
  `);

  // Show latest per fixture/selection
  const seen = new Set();
  console.log('\n[VERIFY] Latest DK 1X2 odds after fix (book_id=68):');
  console.log('='.repeat(70));
  for (const r of rows) {
    const k = `${r.fixture_id}:${r.selection}`;
    if (!seen.has(k)) {
      seen.has(k); // mark
      seen.add(k);
      const label = r.selection === 'home'
        ? `DB_HOME(${r.home_team_id})`
        : r.selection === 'away'
          ? `DB_AWAY(${r.away_team_id})`
          : 'DRAW';
      const odds = r.american_odds > 0 ? `+${r.american_odds}` : `${r.american_odds}`;
      console.log(`  ${r.fixture_id} | selection=${r.selection.padEnd(4)} [${label.padEnd(18)}] odds=${odds}`);
    }
  }

  // Also check model odds (book_id=0) for comparison
  const [modelRows] = await conn.query(`
    SELECT s.fixture_id, s.selection, s.american_odds,
           f.home_team_id, f.away_team_id
    FROM wc2026_odds_snapshots s
    JOIN wc2026_fixtures f ON s.fixture_id = f.fixture_id
    WHERE s.fixture_id IN ('wc26-g-037','wc26-g-038','wc26-g-039','wc26-g-040')
      AND s.book_id = 0
      AND s.market = '1X2'
    ORDER BY s.fixture_id, s.selection
  `);

  console.log('\n[VERIFY] Model (book_id=0) 1X2 odds:');
  console.log('='.repeat(70));
  for (const r of modelRows) {
    const label = r.selection === 'home'
      ? `DB_HOME(${r.home_team_id})`
      : r.selection === 'away'
        ? `DB_AWAY(${r.away_team_id})`
        : 'DRAW';
    const odds = r.american_odds > 0 ? `+${r.american_odds}` : `${r.american_odds}`;
    console.log(`  ${r.fixture_id} | selection=${r.selection.padEnd(4)} [${label.padEnd(18)}] odds=${odds}`);
  }

  // Check double chance odds (book_id=68, market=DOUBLE_CHANCE)
  const [dcRows] = await conn.query(`
    SELECT s.fixture_id, s.selection, s.american_odds,
           f.home_team_id, f.away_team_id
    FROM wc2026_odds_snapshots s
    JOIN wc2026_fixtures f ON s.fixture_id = f.fixture_id
    WHERE s.fixture_id IN ('wc26-g-037','wc26-g-038','wc26-g-039','wc26-g-040')
      AND s.book_id = 68
      AND s.market = 'DOUBLE_CHANCE'
    ORDER BY s.fixture_id, s.selection
  `);

  console.log('\n[VERIFY] Double Chance (book_id=68, market=DOUBLE_CHANCE):');
  console.log('='.repeat(70));
  if (dcRows.length === 0) {
    console.log('  [MISSING] No DOUBLE_CHANCE rows found — need to seed user-provided odds');
  } else {
    for (const r of dcRows) {
      const label = r.selection === 'home_draw'
        ? `HOME_DRAW(${r.home_team_id})`
        : `AWAY_DRAW(${r.away_team_id})`;
      const odds = r.american_odds > 0 ? `+${r.american_odds}` : `${r.american_odds}`;
      console.log(`  ${r.fixture_id} | selection=${r.selection.padEnd(10)} [${label.padEnd(22)}] odds=${odds}`);
    }
  }

  // Summary: expected correct values
  console.log('\n[EXPECTED] Correct DK 1X2 orientation (DB home/away):');
  console.log('='.repeat(70));
  const expected = [
    { id: 'wc26-g-039', home: 'esp', away: 'ksa', homeOdds: -900, awayOdds: 2200, drawOdds: 950 },
    { id: 'wc26-g-037', home: 'irn', away: 'bel', homeOdds: 650, awayOdds: -225, drawOdds: 370 },
    { id: 'wc26-g-040', home: 'cpv', away: 'uru', homeOdds: 700, awayOdds: -210, drawOdds: 320 },
    { id: 'wc26-g-038', home: 'nzl', away: 'egy', homeOdds: 500, awayOdds: -165, drawOdds: 300 },
  ];
  for (const e of expected) {
    console.log(`  ${e.id} | home(${e.home})=${e.homeOdds > 0 ? '+' : ''}${e.homeOdds} | away(${e.away})=${e.awayOdds > 0 ? '+' : ''}${e.awayOdds} | draw=${e.drawOdds > 0 ? '+' : ''}${e.drawOdds}`);
  }

  await conn.end();
}

verify().catch(e => {
  console.error('[ERROR]', e.message);
  process.exit(1);
});
