/**
 * wc_fix_june18_final.cjs
 * 
 * GROUND TRUTH from DraftKings screenshot (June 18, 2026):
 * DK lists top team = HOME, bottom team = AWAY
 * 
 * Game 1: Czech Republic (HOME -120) vs South Africa (AWAY +380) | Draw +260
 * Game 2: Switzerland (HOME -180) vs Bosnia (AWAY +500) | Draw +310
 * Game 3: Canada (HOME -350) vs Qatar (AWAY +1000) | Draw +475
 * Game 4: Mexico (HOME +105) vs South Korea (AWAY +295) | Draw +230
 * 
 * CURRENT DB STATE (from audit):
 * wc26-g-025: home=CZE, away=RSA, DK home=-115, away=360 → ODDS STALE, orientation OK
 * wc26-g-027: home=BIH, away=SUI, DK home=-180, away=500 → ORIENTATION INVERTED (SUI should be HOME)
 * wc26-g-028: home=CAN, away=QAT, DK home=-360, away=1000 → ODDS STALE (-360 vs -350)
 * wc26-g-026: home=MEX, away=KOR, DK home=105, away=295 → CORRECT
 * 
 * FIXES NEEDED:
 * 1. wc26-g-027: Swap home_team_id/away_team_id (SUI→home, BIH→away)
 *    AND swap home/away in ALL odds snapshots (so SUI gets -180, BIH gets +500)
 * 2. wc26-g-025: Orientation correct (CZE=home), but odds are stale → refresh from DK screenshot
 * 3. wc26-g-028: Orientation correct (CAN=home), odds stale → refresh
 * 4. wc26-g-026: Correct → refresh to confirm
 * 
 * Logging: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY]
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// ─── Ground truth from DK screenshot ─────────────────────────────────────────
// fixtureId: { home: { code, ml }, away: { code, ml }, draw, totalLine, overOdds, underOdds }
const DK_GROUND_TRUTH = {
  'wc26-g-025': { homeCode: 'CZE', awayCode: 'RSA', homeML: -120, awayML: 380, draw: 260 },
  'wc26-g-027': { homeCode: 'SUI', awayCode: 'BIH', homeML: -180, awayML: 500, draw: 310 },
  'wc26-g-028': { homeCode: 'CAN', awayCode: 'QAT', homeML: -350, awayML: 1000, draw: 475 },
  'wc26-g-026': { homeCode: 'MEX', awayCode: 'KOR', homeML: 105, awayML: 295, draw: 230 },
};

function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

async function swapFixtureOrientation(conn, fixtureId) {
  console.log(`[STEP] Swapping home/away for ${fixtureId}...`);
  
  // Swap fixture home_team_id / away_team_id
  await conn.execute(`
    UPDATE wc2026_fixtures
    SET home_team_id = away_team_id, away_team_id = home_team_id
    WHERE fixture_id = ?
  `, [fixtureId]);
  console.log(`[VERIFY] Fixture ${fixtureId} home/away swapped`);

  // Swap 1X2 home/away selections (ALL books including model)
  await conn.execute(`
    UPDATE wc2026_odds_snapshots
    SET selection = CASE
      WHEN selection = 'home' THEN '_tmp_home'
      WHEN selection = 'away' THEN 'home'
      ELSE selection
    END
    WHERE fixture_id = ? AND market = '1X2' AND selection IN ('home','away')
  `, [fixtureId]);
  await conn.execute(`
    UPDATE wc2026_odds_snapshots SET selection = 'away'
    WHERE fixture_id = ? AND market = '1X2' AND selection = '_tmp_home'
  `, [fixtureId]);
  console.log(`[VERIFY] 1X2 selections swapped for ${fixtureId}`);

  // Swap ASIAN_HANDICAP selections and negate lines
  const [ahRows] = await conn.execute(`
    SELECT id, selection, line FROM wc2026_odds_snapshots
    WHERE fixture_id = ? AND market = 'ASIAN_HANDICAP'
  `, [fixtureId]);
  for (const row of ahRows) {
    let newSel = row.selection;
    let newLine = row.line;
    if (row.selection.startsWith('home')) {
      newSel = 'away' + row.selection.slice(4);
      newLine = row.line !== null ? -parseFloat(row.line) : null;
    } else if (row.selection.startsWith('away')) {
      newSel = 'home' + row.selection.slice(4);
      newLine = row.line !== null ? -parseFloat(row.line) : null;
    }
    await conn.execute(`UPDATE wc2026_odds_snapshots SET selection=?, line=? WHERE id=?`, [newSel, newLine, row.id]);
    console.log(`  AH id=${row.id}: ${row.selection}/${row.line} -> ${newSel}/${newLine}`);
  }
  console.log(`[VERIFY] ASIAN_HANDICAP swapped for ${fixtureId}`);
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[INPUT] Connected to DB');
  console.log('[INPUT] Ground truth source: DraftKings sportsbook screenshot (June 18, 2026)');

  // ─── STEP 1: Audit current DB fixture orientations ──────────────────────────
  console.log('\n[STEP 1] Auditing current DB fixture orientations...');
  const [dbFixtures] = await conn.execute(`
    SELECT f.fixture_id, f.home_team_id, f.away_team_id,
           ht.fifa_code AS home_code, ht.name AS home_name,
           at2.fifa_code AS away_code, at2.name AS away_name
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
    ORDER BY f.kickoff_utc
  `);

  const swapsNeeded = [];
  for (const f of dbFixtures) {
    const gt = DK_GROUND_TRUTH[f.fixture_id];
    if (!gt) { console.log(`[STATE] No ground truth for ${f.fixture_id}`); continue; }
    const correct = f.home_code.toUpperCase() === gt.homeCode && f.away_code.toUpperCase() === gt.awayCode;
    console.log(`[STATE] ${f.fixture_id}: DB home=${f.home_code} away=${f.away_code} | GT home=${gt.homeCode} away=${gt.awayCode} | ${correct ? 'CORRECT ✓' : 'INVERTED ✗ — needs swap'}`);
    if (!correct) swapsNeeded.push(f.fixture_id);
  }

  // ─── STEP 2: Apply orientation swaps ────────────────────────────────────────
  if (swapsNeeded.length > 0) {
    console.log(`\n[STEP 2] Applying orientation swaps for: ${swapsNeeded.join(', ')}`);
    for (const fid of swapsNeeded) {
      await swapFixtureOrientation(conn, fid);
    }
  } else {
    console.log('\n[STEP 2] No orientation swaps needed');
  }

  // ─── STEP 3: Upsert correct DK 1X2 odds from ground truth ──────────────────
  console.log('\n[STEP 3] Inserting fresh DK 1X2 odds from DK screenshot ground truth...');
  const snapshotTs = new Date();

  for (const [fixtureId, gt] of Object.entries(DK_GROUND_TRUTH)) {
    console.log(`\n[STEP] ${fixtureId}: home(${gt.homeCode})=${gt.homeML} draw=${gt.draw} away(${gt.awayCode})=${gt.awayML}`);

    const rows = [
      [fixtureId, snapshotTs, 68, '1X2', 'home', null, gt.homeML, americanToImplied(gt.homeML), 0],
      [fixtureId, snapshotTs, 68, '1X2', 'draw', null, gt.draw,   americanToImplied(gt.draw),   0],
      [fixtureId, snapshotTs, 68, '1X2', 'away', null, gt.awayML, americanToImplied(gt.awayML), 0],
    ];

    for (const row of rows) {
      await conn.execute(`
        INSERT INTO wc2026_odds_snapshots
          (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, row);
    }
    console.log(`[OUTPUT] Inserted 3 DK 1X2 rows for ${fixtureId}`);
  }

  // ─── STEP 4: Also fetch live TOTAL odds from AN API ─────────────────────────
  console.log('\n[STEP 4] Fetching live TOTAL + HANDICAP odds from Action Network...');
  const AN_URL = "https://api.actionnetwork.com/web/v2/scoreboard/soccer?bookIds=68&date=20260618&periods=event";
  const AN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
    Referer: "https://www.actionnetwork.com/soccer/odds",
    Origin: "https://www.actionnetwork.com",
  };

  let anData;
  try {
    const res = await fetch(AN_URL, { headers: AN_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    anData = await res.json();
  } catch (err) {
    console.error(`[VERIFY] FAIL — AN fetch: ${err} — skipping TOTAL refresh`);
    anData = { games: [] };
  }

  // Re-read DB fixtures AFTER orientation swaps
  const [fixedFixtures] = await conn.execute(`
    SELECT f.fixture_id, ht.fifa_code AS home_code, at2.fifa_code AS away_code
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
  `);

  for (const game of (anData.games ?? [])) {
    const anAwayAbbr = (game.teams[0]?.abbr ?? '').toUpperCase();
    const anHomeAbbr = (game.teams[1]?.abbr ?? '').toUpperCase();
    const dbFix = fixedFixtures.find(f =>
      f.home_code.toUpperCase() === anHomeAbbr && f.away_code.toUpperCase() === anAwayAbbr
    );
    if (!dbFix) {
      console.log(`[STATE] No match for AN game ${game.id} home=${anHomeAbbr} away=${anAwayAbbr}`);
      continue;
    }

    const dk = game.markets?.["68"]?.event;
    if (!dk) continue;

    const rows = [];
    // TOTAL
    for (const o of (dk.total ?? [])) {
      if (!['over','under'].includes(o.side)) continue;
      const impl = americanToImplied(o.odds);
      rows.push([dbFix.fixture_id, snapshotTs, 68, 'TOTAL', o.side, o.value ?? null, o.odds, impl, 0]);
    }
    // ASIAN_HANDICAP
    for (const o of (dk.spread ?? [])) {
      if (!['home','away'].includes(o.side)) continue;
      const impl = americanToImplied(o.odds);
      rows.push([dbFix.fixture_id, snapshotTs, 68, 'ASIAN_HANDICAP', o.side, o.value ?? null, o.odds, impl, 0]);
    }

    for (const row of rows) {
      await conn.execute(`
        INSERT INTO wc2026_odds_snapshots
          (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, row);
    }
    console.log(`[OUTPUT] Inserted ${rows.length} TOTAL+HANDICAP rows for ${dbFix.fixture_id}`);
  }

  // ─── STEP 5: Final verification ──────────────────────────────────────────────
  console.log('\n[STEP 5] Final verification — all 4 June 18 fixtures...');
  const [finalFixtures] = await conn.execute(`
    SELECT f.fixture_id, ht.fifa_code AS home_code, ht.name AS home_name,
           at2.fifa_code AS away_code, at2.name AS away_name
    FROM wc2026_fixtures f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
    ORDER BY f.kickoff_utc
  `);

  let allPass = true;
  for (const f of finalFixtures) {
    const gt = DK_GROUND_TRUTH[f.fixture_id];
    if (!gt) continue;

    // Get latest DK 1X2 odds
    const [latestTs] = await conn.execute(`
      SELECT MAX(snapshot_ts) AS maxTs FROM wc2026_odds_snapshots
      WHERE fixture_id = ? AND book_id = 68 AND market = '1X2'
    `, [f.fixture_id]);
    const maxTs = latestTs[0]?.maxTs;
    const [odds] = await conn.execute(`
      SELECT selection, american_odds FROM wc2026_odds_snapshots
      WHERE fixture_id = ? AND book_id = 68 AND market = '1X2' AND snapshot_ts = ?
    `, [f.fixture_id, maxTs]);

    const homeOdds = odds.find(o => o.selection === 'home')?.american_odds;
    const awayOdds = odds.find(o => o.selection === 'away')?.american_odds;
    const drawOdds = odds.find(o => o.selection === 'draw')?.american_odds;

    const orientOk = f.home_code.toUpperCase() === gt.homeCode && f.away_code.toUpperCase() === gt.awayCode;
    const oddsOk = homeOdds === gt.homeML && awayOdds === gt.awayML && drawOdds === gt.draw;
    const pass = orientOk && oddsOk;
    if (!pass) allPass = false;

    console.log(`[VERIFY] ${f.fixture_id}: home=${f.home_code}(${homeOdds}) draw=${drawOdds} away=${f.away_code}(${awayOdds})`);
    console.log(`         GT: home=${gt.homeCode}(${gt.homeML}) draw=${gt.draw} away=${gt.awayCode}(${gt.awayML})`);
    console.log(`         Orientation: ${orientOk ? 'PASS ✓' : 'FAIL ✗'} | Odds: ${oddsOk ? 'PASS ✓' : 'FAIL ✗'}`);
  }

  console.log(`\n[OUTPUT] Overall: ${allPass ? 'ALL PASS ✓' : 'SOME FAILURES — review above'}`);
  await conn.end();
  console.log('[OUTPUT] Fix complete');
}

main().catch(err => {
  console.error('[VERIFY] FAIL —', err);
  process.exit(1);
});
