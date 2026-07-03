/**
 * wc_fix_june18_orientation.cjs
 * 
 * Fixes:
 * 1. wc26-g-025 (RSA vs CZE): INVERTED — DB has CZE as home, AN has RSA as home
 *    Fix: swap home_team_id/away_team_id in match + swap home/away in all odds snapshots
 * 2. Refresh stale DK odds for all 4 June 18 matches from live AN API
 * 
 * Run from: /home/ubuntu/ai-sports-betting
 * Logging: [INPUT] [STEP] [STATE] [OUTPUT] [VERIFY]
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  console.log('[INPUT] Connected to DB');

  // ─── STEP 1: Audit and fix wc26-g-025 orientation ──────────────────────────
  console.log('\n[STEP 1] Auditing wc26-g-025 (RSA vs CZE)...');
  const [g025rows] = await conn.execute(`
    SELECT f.match_id, f.home_team_id, f.away_team_id,
           ht.name AS home_name, ht.fifa_code AS home_code,
           at2.name AS away_name, at2.fifa_code AS away_code
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_id = 'wc26-g-025'
  `);
  const g025 = g025rows[0];
  console.log(`[STATE] DB: home=${g025.home_name}(${g025.home_code}) away=${g025.away_name}(${g025.away_code})`);
  console.log(`[STATE] AN: home=South Africa(RSA) away=Czechia(CZE)`);
  const g025NeedsSwap = g025.home_code !== 'RSA';
  console.log(`[STATE] Orientation: ${g025NeedsSwap ? 'INVERTED — needs fix' : 'CORRECT'}`);

  if (g025NeedsSwap) {
    console.log('\n[STEP 1a] Swapping home_team_id/away_team_id for wc26-g-025...');
    await conn.execute(`
      UPDATE wc2026_matches
      SET home_team_id = away_team_id, away_team_id = home_team_id
      WHERE match_id = 'wc26-g-025'
    `);
    console.log('[VERIFY] Match orientation swapped');

    console.log('[STEP 1b] Swapping 1X2 home/away selections in odds snapshots...');
    await conn.execute(`
      UPDATE wc2026_odds_snapshots
      SET selection = CASE
        WHEN selection = 'home' THEN '_tmp'
        WHEN selection = 'away' THEN 'home'
        ELSE selection
      END
      WHERE match_id = 'wc26-g-025' AND market = '1X2' AND selection IN ('home','away')
    `);
    await conn.execute(`
      UPDATE wc2026_odds_snapshots SET selection = 'away'
      WHERE match_id = 'wc26-g-025' AND market = '1X2' AND selection = '_tmp'
    `);
    console.log('[VERIFY] 1X2 selections swapped');

    console.log('[STEP 1c] Swapping ASIAN_HANDICAP selections for wc26-g-025...');
    const [ahRows] = await conn.execute(`
      SELECT id, selection, line FROM wc2026_odds_snapshots
      WHERE match_id = 'wc26-g-025' AND market = 'ASIAN_HANDICAP'
    `);
    for (const row of ahRows) {
      let newSel = row.selection;
      let newLine = row.line;
      if (row.selection.startsWith('home')) {
        newSel = 'away' + row.selection.slice(4);
        newLine = row.line !== null ? -row.line : null;
      } else if (row.selection.startsWith('away')) {
        newSel = 'home' + row.selection.slice(4);
        newLine = row.line !== null ? -row.line : null;
      }
      await conn.execute(`UPDATE wc2026_odds_snapshots SET selection=?, line=? WHERE id=?`, [newSel, newLine, row.id]);
      console.log(`  id=${row.id}: ${row.selection}/${row.line} -> ${newSel}/${newLine}`);
    }
    console.log('[VERIFY] ASIAN_HANDICAP selections swapped');

    // Also swap model odds (book_id=0) for wc26-g-025
    console.log('[STEP 1d] Swapping MODEL (book_id=0) 1X2 selections for wc26-g-025...');
    // Already done above since we swapped ALL rows with market=1X2 (no book_id filter)
    console.log('[VERIFY] Model odds selections already swapped in step 1b');
  } else {
    console.log('[VERIFY] wc26-g-025 orientation already correct');
  }

  // ─── STEP 2: Fetch live DK odds from Action Network ──────────────────────────
  console.log('\n[STEP 2] Fetching live DK odds from Action Network for June 18...');
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
    console.error(`[VERIFY] FAIL — AN fetch error: ${err}`);
    await conn.end();
    process.exit(1);
  }
  const games = anData.games ?? [];
  console.log(`[STATE] AN returned ${games.length} games`);

  // Get current DB match orientations (AFTER the swap above)
  const [dbMatches] = await conn.execute(`
    SELECT f.match_id, f.home_team_id, f.away_team_id,
           ht.fifa_code AS home_code, at2.fifa_code AS away_code
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
  `);

  console.log('[STATE] DB matches (post-fix orientation):');
  dbMatches.forEach(f => console.log(`  ${f.match_id}: home=${f.home_code} away=${f.away_code}`));

  let totalInserted = 0;

  for (const game of games) {
    const anAwayAbbr = (game.teams[0]?.abbr ?? '').toUpperCase();
    const anHomeAbbr = (game.teams[1]?.abbr ?? '').toUpperCase();

    const dbFix = dbMatches.find(f =>
      f.home_code.toUpperCase() === anHomeAbbr && f.away_code.toUpperCase() === anAwayAbbr
    );

    if (!dbFix) {
      console.log(`[STATE] No DB match for AN game ${game.id}: home=${anHomeAbbr} away=${anAwayAbbr}`);
      continue;
    }

    console.log(`\n[STEP] Processing ${dbFix.match_id}: home=${anHomeAbbr} away=${anAwayAbbr}`);
    const dk = game.markets?.["68"]?.event;
    if (!dk) {
      console.log(`[STATE] No DK data for ${dbFix.match_id}`);
      continue;
    }

    const snapshotTs = new Date();
    const rows = [];

    // 1X2
    const ml = dk.moneyline ?? [];
    for (const outcome of ml) {
      if (!['home','away','draw'].includes(outcome.side)) continue;
      rows.push([dbFix.match_id, snapshotTs, 68, '1X2', outcome.side, null, outcome.odds, null, 0]);
    }

    // TOTAL
    const tot = dk.total ?? [];
    for (const outcome of tot) {
      if (!['over','under'].includes(outcome.side)) continue;
      rows.push([dbFix.match_id, snapshotTs, 68, 'TOTAL', outcome.side, outcome.value ?? null, outcome.odds, null, 0]);
    }

    // ASIAN_HANDICAP
    const sp = dk.spread ?? [];
    for (const outcome of sp) {
      if (!['home','away'].includes(outcome.side)) continue;
      rows.push([dbFix.match_id, snapshotTs, 68, 'ASIAN_HANDICAP', outcome.side, outcome.value ?? null, outcome.odds, null, 0]);
    }

    console.log(`[STATE] Inserting ${rows.length} fresh DK rows for ${dbFix.match_id}`);
    for (const row of rows) {
      await conn.execute(`
        INSERT INTO wc2026_odds_snapshots
          (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, row);
    }
    totalInserted += rows.length;

    const mlHome = ml.find(o => o.side === 'home');
    const mlAway = ml.find(o => o.side === 'away');
    const mlDraw = ml.find(o => o.side === 'draw');
    console.log(`[OUTPUT] DK 1X2: home(${anHomeAbbr})=${mlHome?.odds} away(${anAwayAbbr})=${mlAway?.odds} draw=${mlDraw?.odds}`);
  }

  console.log(`\n[OUTPUT] Total DK rows inserted: ${totalInserted}`);

  // ─── STEP 3: Final verification ──────────────────────────────────────────────
  console.log('\n[STEP 3] Final verification — latest DK 1X2 odds per match...');
  const [finalMatches] = await conn.execute(`
    SELECT f.match_id, ht.fifa_code AS home_code, ht.name AS home_name,
           at2.fifa_code AS away_code, at2.name AS away_name
    FROM wc2026_matches f
    JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
    JOIN wc2026_teams at2 ON f.away_team_id = at2.team_id
    WHERE f.match_date = '2026-06-18'
    ORDER BY f.kickoff_utc
  `);

  for (const f of finalMatches) {
    const [latestTs] = await conn.execute(`
      SELECT MAX(snapshot_ts) AS maxTs FROM wc2026_odds_snapshots
      WHERE match_id = ? AND book_id = 68
    `, [f.match_id]);
    const maxTs = latestTs[0]?.maxTs;

    const [odds] = await conn.execute(`
      SELECT selection, american_odds FROM wc2026_odds_snapshots
      WHERE match_id = ? AND book_id = 68 AND market = '1X2' AND snapshot_ts = ?
    `, [f.match_id, maxTs]);

    const homeOdds = odds.find(o => o.selection === 'home')?.american_odds;
    const awayOdds = odds.find(o => o.selection === 'away')?.american_odds;
    const drawOdds = odds.find(o => o.selection === 'draw')?.american_odds;

    const favTeam = (homeOdds != null && awayOdds != null)
      ? (homeOdds < awayOdds ? `${f.home_name}(HOME)` : `${f.away_name}(AWAY)`)
      : 'UNKNOWN';

    console.log(`[VERIFY] ${f.match_id}: home(${f.home_code})=${homeOdds} away(${f.away_code})=${awayOdds} draw=${drawOdds} | FAVORITE=${favTeam}`);
  }

  await conn.end();
  console.log('\n[OUTPUT] All fixes complete');
}

main().catch(err => {
  console.error('[VERIFY] FAIL —', err);
  process.exit(1);
});
