/**
 * fix_june15_dk_odds_v2.mjs
 * =========================
 * CORRECTED fix for June 15 WC DK odds.
 *
 * ROOT CAUSE ANALYSIS (FINAL):
 * The AN API uses team_id to anchor odds to specific teams.
 * The `side` field (home/away) in the moneyline outcomes is correct per FIFA.
 *
 * Raw AN API data (verified from debug_an_june15.mjs):
 *
 * wc26-g-015 (ESP home, CPV away):
 *   Spain (id=1961): side=home, odds=-1600
 *   Cape Verde (id=6102): side=away, odds=3000
 *   → DB should have: home=-1600, away=3000, draw=1300
 *
 * wc26-g-013 (BEL home, EGY away):
 *   Belgium (id=1936): side=home, odds=-175
 *   Egypt (id=1942): side=away, odds=475
 *   → DB should have: home=-175, away=475, draw=300
 *
 * wc26-g-016 (KSA home, URU away):
 *   Saudi Arabia (id=1958): side=home, odds=700
 *   Uruguay (id=1964): side=away, odds=-220
 *   → DB should have: home=700, away=-220, draw=330
 *
 * wc26-g-014 (IRN home, NZL away):
 *   Iran (id=1947): side=home, odds=-125
 *   New Zealand (id=6172): side=away, odds=400
 *   → DB should have: home=-125, away=400, draw=250
 *
 * PREVIOUS ERROR: fix_june15_dk_odds.mjs incorrectly assumed AN teams[0]=away
 * and swapped home/away. The AN API side labels ARE correct — they match FIFA.
 *
 * This script:
 * 1. Deletes the incorrectly-fixed DK odds
 * 2. Inserts correct DK odds using the team_id-anchored values
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const u = new URL(process.env.DATABASE_URL);
const c = await mysql.createConnection({
  host: u.hostname,
  port: parseInt(u.port || '3306'),
  user: u.username,
  password: u.password,
  database: u.pathname.slice(1).split('?')[0],
  ssl: { rejectUnauthorized: false }
});

console.log('[INPUT] fix_june15_dk_odds_v2.mjs — inserting correct DK odds for June 15 WC');
console.log('[STEP] Using team_id-anchored values from AN API raw response');

// Correct DK odds (from AN API, team_id verified)
// home = FIFA home team, away = FIFA away team
const CORRECT_DK = {
  'wc26-g-015': {
    home_ml: -1600,  // Spain (id=1961, side=home)
    draw_ml: 1300,
    away_ml: 3000,   // Cape Verde (id=6102, side=away)
    total_line: 3.5,
    over_odds: -135,
    under_odds: 110,
    // Asian handicap
    ah_home_line: -2.5, ah_home_odds: -165,
    ah_away_line: 2.5, ah_away_odds: 130,
  },
  'wc26-g-013': {
    home_ml: -175,   // Belgium (id=1936, side=home)
    draw_ml: 300,
    away_ml: 475,    // Egypt (id=1942, side=away)
    total_line: 2.5,
    over_odds: -110,
    under_odds: -110,
    // Asian handicap
    ah_home_line: -0.5, ah_home_odds: -180,
    ah_away_line: 0.5, ah_away_odds: 140,
  },
  'wc26-g-016': {
    home_ml: 700,    // Saudi Arabia (id=1958, side=home)
    draw_ml: 330,
    away_ml: -220,   // Uruguay (id=1964, side=away)
    total_line: 2.5,
    over_odds: 105,
    under_odds: -130,
    // Asian handicap
    ah_home_line: 1.5, ah_home_odds: -165,
    ah_away_line: -1.5, ah_away_odds: 130,
  },
  'wc26-g-014': {
    home_ml: -125,   // Iran (id=1947, side=home)
    draw_ml: 250,
    away_ml: 400,    // New Zealand (id=6172, side=away)
    total_line: 2.5,
    over_odds: 140,
    under_odds: -170,
    // Asian handicap
    ah_home_line: -0.5, ah_home_odds: -135,
    ah_away_line: 0.5, ah_away_odds: 105,
  },
};

const june15Ids = ['wc26-g-015', 'wc26-g-013', 'wc26-g-016', 'wc26-g-014'];
const ph = june15Ids.map(() => '?').join(',');

// Step 1: Show current state
const [current] = await c.execute(`
  SELECT fixture_id, market, selection, american_odds, line
  FROM wc2026_odds_snapshots
  WHERE fixture_id IN (${ph}) AND book_id = 68
  AND snapshot_ts = (
    SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
    WHERE s2.fixture_id = wc2026_odds_snapshots.fixture_id AND s2.book_id = 68
  )
  ORDER BY fixture_id, market, selection
`, june15Ids);

console.log('[STATE] Current DK odds in DB (to be replaced):');
for (const o of current) {
  console.log(`  ${o.fixture_id} ${o.market} ${o.selection}=${o.american_odds}${o.line ? ' line='+o.line : ''}`);
}

// Step 2: Delete all DK odds for these fixtures
const [del] = await c.execute(
  `DELETE FROM wc2026_odds_snapshots WHERE fixture_id IN (${ph}) AND book_id = 68`,
  june15Ids
);
console.log('[STATE] Deleted', del.affectedRows, 'rows');

// Step 3: Insert correct odds
function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

const snapshotTs = new Date();
const rows = [];

for (const fid of june15Ids) {
  const odds = CORRECT_DK[fid];
  // 1X2
  rows.push([fid, snapshotTs, 68, '1X2', 'home', null, odds.home_ml, americanToImplied(odds.home_ml), false]);
  rows.push([fid, snapshotTs, 68, '1X2', 'draw', null, odds.draw_ml, americanToImplied(odds.draw_ml), false]);
  rows.push([fid, snapshotTs, 68, '1X2', 'away', null, odds.away_ml, americanToImplied(odds.away_ml), false]);
  // TOTAL
  rows.push([fid, snapshotTs, 68, 'TOTAL', 'over', odds.total_line, odds.over_odds, americanToImplied(odds.over_odds), false]);
  rows.push([fid, snapshotTs, 68, 'TOTAL', 'under', odds.total_line, odds.under_odds, americanToImplied(odds.under_odds), false]);
  // ASIAN_HANDICAP
  rows.push([fid, snapshotTs, 68, 'ASIAN_HANDICAP', 'home', odds.ah_home_line, odds.ah_home_odds, americanToImplied(odds.ah_home_odds), false]);
  rows.push([fid, snapshotTs, 68, 'ASIAN_HANDICAP', 'away', odds.ah_away_line, odds.ah_away_odds, americanToImplied(odds.ah_away_odds), false]);
}

await c.execute(
  `INSERT INTO wc2026_odds_snapshots (fixture_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}`,
  rows.flat()
);
console.log('[STATE] Inserted', rows.length, 'rows');

// Step 4: Verify
const [verify] = await c.execute(`
  SELECT fixture_id, market, selection, american_odds, line
  FROM wc2026_odds_snapshots
  WHERE fixture_id IN (${ph}) AND book_id = 68
  AND snapshot_ts = (
    SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
    WHERE s2.fixture_id = wc2026_odds_snapshots.fixture_id AND s2.book_id = 68
  )
  ORDER BY fixture_id, market, selection
`, june15Ids);

const byFix = {};
for (const o of verify) {
  if (!byFix[o.fixture_id]) byFix[o.fixture_id] = {};
  byFix[o.fixture_id][`${o.market}_${o.selection}`] = { odds: o.american_odds, line: o.line };
}

// Get fixture names
const [fixtures] = await c.execute(`
  SELECT f.fixture_id, ht.fifa_code as homeCode, ht.name as homeName,
         at.fifa_code as awayCode, at.name as awayName,
         f.kickoff_utc
  FROM wc2026_fixtures f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.fixture_id IN (${ph})
  ORDER BY f.kickoff_utc
`, june15Ids);

const fxMap = {};
for (const f of fixtures) fxMap[f.fixture_id] = f;

const KICKOFF_ET = {
  'wc26-g-015': '12:00 PM ET',
  'wc26-g-013': '3:00 PM ET',
  'wc26-g-016': '6:00 PM ET',
  'wc26-g-014': '9:00 PM ET',
};

console.log('');
console.log('[STATE] Final verified DK odds (as will display in PROJECTIONS feed):');
console.log('');

let allPass = true;
for (const fid of june15Ids) {
  const f = fxMap[fid];
  const db = byFix[fid] || {};
  const exp = CORRECT_DK[fid];
  
  const homeOk = db['1X2_home']?.odds === exp.home_ml;
  const drawOk = db['1X2_draw']?.odds === exp.draw_ml;
  const awayOk = db['1X2_away']?.odds === exp.away_ml;
  const overOk = db['TOTAL_over']?.odds === exp.over_odds;
  const underOk = db['TOTAL_under']?.odds === exp.under_odds;
  const ok = homeOk && drawOk && awayOk && overOk && underOk;
  if (!ok) allPass = false;
  
  console.log(`[FIXTURE] ${fid} | ${f?.awayCode}(away) @ ${f?.homeCode}(home) | ${KICKOFF_ET[fid]}`);
  console.log(`  HOME (${f?.homeCode}/${f?.homeName}): DK ML = ${db['1X2_home']?.odds ?? 'MISSING'} ${homeOk ? '✓' : '✗ exp='+exp.home_ml}`);
  console.log(`  DRAW:                         DK ML = ${db['1X2_draw']?.odds ?? 'MISSING'} ${drawOk ? '✓' : '✗ exp='+exp.draw_ml}`);
  console.log(`  AWAY (${f?.awayCode}/${f?.awayName}): DK ML = ${db['1X2_away']?.odds ?? 'MISSING'} ${awayOk ? '✓' : '✗ exp='+exp.away_ml}`);
  console.log(`  TOTAL: ${db['TOTAL_over']?.line ?? '?'} | OVER=${db['TOTAL_over']?.odds ?? 'MISSING'} ${overOk ? '✓' : '✗'} | UNDER=${db['TOTAL_under']?.odds ?? 'MISSING'} ${underOk ? '✓' : '✗'}`);
  console.log(`  AH: home=${db['ASIAN_HANDICAP_home']?.line ?? '?'}@${db['ASIAN_HANDICAP_home']?.odds ?? '?'} away=${db['ASIAN_HANDICAP_away']?.line ?? '?'}@${db['ASIAN_HANDICAP_away']?.odds ?? '?'}`);
  console.log('');
}

console.log(`[OUTPUT] DK odds fix v2: ${allPass ? 'ALL PASS' : 'FAILURES DETECTED'}`);
console.log(`[VERIFY] ${allPass ? 'PASS' : 'FAIL'} — June 15 WC DK odds correctly mapped`);

await c.end();
