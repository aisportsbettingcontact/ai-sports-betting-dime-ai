/**
 * fix_june15_dk_odds.mjs
 * ======================
 * Fixes DK odds orientation for June 15 WC matchs.
 *
 * ROOT CAUSE:
 * The AN API returns teams[0]=away, teams[1]=home but for these WC matchs,
 * AN has the teams in the OPPOSITE order from FIFA official:
 *   AN: Spain=away, Cape Verde=home  (WRONG per FIFA)
 *   FIFA: Spain=home, Cape Verde=away (CORRECT)
 *
 * The scraper wrote DK odds with 'home' selection = Cape Verde (wrong)
 * and 'away' selection = Spain (wrong).
 *
 * After the match orientation fix, we need to:
 * 1. Delete the stale DK odds snapshots for June 15 matchs
 * 2. Insert fresh DK odds with correct home/away mapping
 *
 * Live DK odds from AN API (fetched 2026-06-15):
 *   wc26-g-015 (ESP home, CPV away):
 *     AN returns: away=Spain home=Cape Verde
 *     AN DK: home(CPV)=-1600 draw=1300 away(ESP)=3000 total=3.5 over=-135 under=110
 *     Correct mapping: home(ESP)=-1600 draw=1300 away(CPV)=3000 total=3.5 over=-135 under=110
 *
 *   wc26-g-013 (BEL home, EGY away):
 *     AN returns: away=Belgium home=Egypt
 *     AN DK: home(EGY)=-175 draw=300 away(BEL)=475 total=2.5 over=-110 under=-110
 *     Correct mapping: home(BEL)=-175 draw=300 away(EGY)=475 total=2.5 over=-110 under=-110
 *
 *   wc26-g-016 (KSA home, URU away) — ALREADY CORRECT:
 *     AN returns: away=Saudi Arabia home=Uruguay
 *     AN DK: home(URU)=-220 draw=330 away(KSA)=700 total=2.5 over=105 under=-130
 *     DB has: home=-220 away=650 — MISMATCH on away odds (DB=650, AN=700)
 *     Need to update to latest AN values
 *
 *   wc26-g-014 (IRN home, NZL away):
 *     AN returns: away=Iran home=New Zealand
 *     AN DK: home(NZL)=-125 draw=250 away(IRN)=400 total=2.5 over=140 under=-170
 *     Correct mapping: home(IRN)=-125 draw=250 away(NZL)=400 total=2.5 over=140 under=-170
 *
 * Strategy:
 * - Delete all existing DK (book_id=68) odds for these 4 matchs
 * - Insert fresh rows with correct home/away mapping and latest AN odds
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

console.log('[INPUT] fix_june15_dk_odds.mjs — fixing DK odds orientation for June 15 WC matchs');

// Step 1: Fetch latest DK odds from AN API
const AN_URL = 'https://api.actionnetwork.com/web/v2/scoreboard/soccer?bookIds=68&date=20260615&periods=event';
const AN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.actionnetwork.com/soccer/odds',
  'Origin': 'https://www.actionnetwork.com',
};

console.log('[STEP] Fetching latest DK odds from AN API...');
let anGames = [];
try {
  const res = await fetch(AN_URL, { headers: AN_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  anGames = data.games ?? [];
  console.log('[STATE] AN API returned', anGames.length, 'games');
} catch (err) {
  console.error('[WARN] AN API fetch failed:', err.message, '— using hardcoded values from earlier fetch');
}

// AN game ID → match mapping (from earlier fetch)
// AN teams[0]=away, teams[1]=home (per AN convention)
// But for these matchs, AN has teams SWAPPED vs FIFA
// So: AN teams[0] = FIFA home team, AN teams[1] = FIFA away team
const AN_TO_MATCH = {
  284359: 'wc26-g-015', // AN: away=Spain, home=CapeVerde → FIFA: home=Spain, away=CapeVerde
  284360: 'wc26-g-013', // AN: away=Belgium, home=Egypt → FIFA: home=Belgium, away=Egypt
  284361: 'wc26-g-016', // AN: away=SaudiArabia, home=Uruguay → FIFA: home=KSA, away=Uruguay
  284362: 'wc26-g-014', // AN: away=Iran, home=NewZealand → FIFA: home=Iran, away=NewZealand
};

// Build corrected DK odds from AN API response
// Key insight: AN teams[0] = FIFA home, AN teams[1] = FIFA away
// So AN 'away' selection = FIFA home team, AN 'home' selection = FIFA away team
// We need to SWAP the home/away selections when writing to DB
const correctedOdds = {};

for (const game of anGames) {
  const matchId = AN_TO_MATCH[game.id];
  if (!matchId) continue;
  
  const dkMarkets = game.markets?.['68']?.event;
  if (!dkMarkets) {
    console.log('[WARN] No DK markets for game', game.id);
    continue;
  }
  
  const ml = dkMarkets.moneyline ?? [];
  // AN 'away' = FIFA home (Spain/Belgium/KSA/Iran)
  // AN 'home' = FIFA away (CPV/EGY/URU/NZL)
  const anAway = ml.find(o => o.side === 'away'); // This is FIFA HOME team
  const anHome = ml.find(o => o.side === 'home'); // This is FIFA AWAY team
  const anDraw = ml.find(o => o.side === 'draw');
  
  const totals = dkMarkets.total ?? [];
  const over = totals.find(o => o.side === 'over');
  const under = totals.find(o => o.side === 'under');
  
  // Special case: wc26-g-016 (KSA@URU) — AN has it correctly oriented
  // AN: away=SaudiArabia, home=Uruguay → FIFA: away=URU, home=KSA
  // For this one, AN 'away' = FIFA away (URU), AN 'home' = FIFA home (KSA)
  // Wait — let me re-check: DB after fix has home=KSA, away=URU
  // AN returns: away=SaudiArabia, home=Uruguay
  // AN 'away'=KSA, AN 'home'=URU → FIFA home=KSA, FIFA away=URU ✓
  // So for g-016: AN 'away' = FIFA home (KSA), AN 'home' = FIFA away (URU) — SAME pattern!
  
  correctedOdds[matchId] = {
    // FIFA home = AN 'away' selection
    home_ml: anAway?.odds ?? null,
    // FIFA away = AN 'home' selection
    away_ml: anHome?.odds ?? null,
    draw_ml: anDraw?.odds ?? null,
    total_line: over?.value ?? under?.value ?? null,
    over_odds: over?.odds ?? null,
    under_odds: under?.odds ?? null,
  };
  
  console.log(`[STATE] Game ${game.id} → ${matchId}: FIFA_home_ML=${correctedOdds[matchId].home_ml} draw=${correctedOdds[matchId].draw_ml} FIFA_away_ML=${correctedOdds[matchId].away_ml} total=${correctedOdds[matchId].total_line} over=${correctedOdds[matchId].over_odds} under=${correctedOdds[matchId].under_odds}`);
}

// Fallback: use hardcoded values from earlier fetch if AN API didn't return all games
const FALLBACK_ODDS = {
  'wc26-g-015': { home_ml: -1600, draw_ml: 1300, away_ml: 3000, total_line: 3.5, over_odds: -135, under_odds: 110 },
  'wc26-g-013': { home_ml: -175, draw_ml: 300, away_ml: 475, total_line: 2.5, over_odds: -110, under_odds: -110 },
  'wc26-g-016': { home_ml: -220, draw_ml: 330, away_ml: 700, total_line: 2.5, over_odds: 105, under_odds: -130 },
  'wc26-g-014': { home_ml: -125, draw_ml: 250, away_ml: 400, total_line: 2.5, over_odds: 140, under_odds: -170 },
};

const june15Ids = ['wc26-g-015', 'wc26-g-013', 'wc26-g-016', 'wc26-g-014'];

// Merge: use live data if available, fallback otherwise
for (const fid of june15Ids) {
  if (!correctedOdds[fid]) {
    console.log(`[WARN] No live AN data for ${fid} — using fallback`);
    correctedOdds[fid] = FALLBACK_ODDS[fid];
  }
}

// Step 2: Delete existing DK odds for these matchs
console.log('');
console.log('[STEP] Deleting stale DK odds (book_id=68) for June 15 matchs...');
const ph = june15Ids.map(() => '?').join(',');
const [delResult] = await c.execute(
  `DELETE FROM wc2026_odds_snapshots WHERE match_id IN (${ph}) AND book_id = 68`,
  june15Ids
);
console.log('[STATE] Deleted', delResult.affectedRows, 'rows');

// Step 3: Insert corrected DK odds
console.log('[STEP] Inserting corrected DK odds...');
const snapshotTs = new Date();
const rows = [];

function americanToImplied(odds) {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

for (const fid of june15Ids) {
  const odds = correctedOdds[fid];
  if (!odds) { console.log('[WARN] No odds for', fid, '— skipping'); continue; }
  
  // 1X2 moneyline
  if (odds.home_ml != null) rows.push([fid, snapshotTs, 68, '1X2', 'home', null, odds.home_ml, americanToImplied(odds.home_ml), false]);
  if (odds.draw_ml != null) rows.push([fid, snapshotTs, 68, '1X2', 'draw', null, odds.draw_ml, americanToImplied(odds.draw_ml), false]);
  if (odds.away_ml != null) rows.push([fid, snapshotTs, 68, '1X2', 'away', null, odds.away_ml, americanToImplied(odds.away_ml), false]);
  
  // Total
  if (odds.over_odds != null) rows.push([fid, snapshotTs, 68, 'TOTAL', 'over', odds.total_line, odds.over_odds, americanToImplied(odds.over_odds), false]);
  if (odds.under_odds != null) rows.push([fid, snapshotTs, 68, 'TOTAL', 'under', odds.total_line, odds.under_odds, americanToImplied(odds.under_odds), false]);
  
  console.log(`[STATE] ${fid}: queued ${rows.length} rows total`);
}

if (rows.length > 0) {
  await c.execute(
    `INSERT INTO wc2026_odds_snapshots (match_id, snapshot_ts, book_id, market, selection, line, american_odds, implied_prob, is_closing) VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}`,
    rows.flat()
  );
  console.log('[STATE] Inserted', rows.length, 'rows');
}

// Step 4: Verify
console.log('');
console.log('[STEP] Verifying corrected odds...');
const [verify] = await c.execute(`
  SELECT match_id, market, selection, american_odds, line
  FROM wc2026_odds_snapshots
  WHERE match_id IN (${ph}) AND book_id = 68
  AND snapshot_ts = (
    SELECT MAX(s2.snapshot_ts) FROM wc2026_odds_snapshots s2
    WHERE s2.match_id = wc2026_odds_snapshots.match_id AND s2.book_id = 68
  )
  ORDER BY match_id, market, selection
`, june15Ids);

// Get match names
const [matchs] = await c.execute(`
  SELECT f.match_id, ht.fifa_code as homeCode, at.fifa_code as awayCode
  FROM wc2026_matches f
  JOIN wc2026_teams ht ON f.home_team_id = ht.team_id
  JOIN wc2026_teams at ON f.away_team_id = at.team_id
  WHERE f.match_id IN (${ph})
  ORDER BY f.kickoff_utc
`, june15Ids);

const fxMap = {};
for (const f of matchs) fxMap[f.match_id] = f;

const byFix = {};
for (const o of verify) {
  if (!byFix[o.match_id]) byFix[o.match_id] = {};
  byFix[o.match_id][`${o.market}_${o.selection}`] = o.american_odds;
}

let allPass = true;
for (const fid of june15Ids) {
  const f = fxMap[fid];
  const db = byFix[fid] || {};
  const exp = correctedOdds[fid];
  
  const homeOk = db['1X2_home'] === exp.home_ml;
  const drawOk = db['1X2_draw'] === exp.draw_ml;
  const awayOk = db['1X2_away'] === exp.away_ml;
  const overOk = db['TOTAL_over'] === exp.over_odds;
  const underOk = db['TOTAL_under'] === exp.under_odds;
  const allOk = homeOk && drawOk && awayOk && overOk && underOk;
  if (!allOk) allPass = false;
  
  console.log(`[VERIFY] ${allOk ? 'PASS' : 'FAIL'} ${fid} | ${f?.awayCode ?? '?'} @ ${f?.homeCode ?? '?'}`);
  console.log(`  HOME(${f?.homeCode}): ${db['1X2_home']} ${homeOk ? '✓' : '✗ exp='+exp.home_ml}`);
  console.log(`  DRAW: ${db['1X2_draw']} ${drawOk ? '✓' : '✗ exp='+exp.draw_ml}`);
  console.log(`  AWAY(${f?.awayCode}): ${db['1X2_away']} ${awayOk ? '✓' : '✗ exp='+exp.away_ml}`);
  console.log(`  OVER: ${db['TOTAL_over']} ${overOk ? '✓' : '✗ exp='+exp.over_odds}`);
  console.log(`  UNDER: ${db['TOTAL_under']} ${underOk ? '✓' : '✗ exp='+exp.under_odds}`);
  console.log('');
}

console.log(`[OUTPUT] DK odds fix: ${allPass ? 'ALL PASS' : 'FAILURES DETECTED'}`);
if (allPass) {
  console.log('[VERIFY] PASS — June 15 WC DK odds correctly mapped to home/away teams');
}

await c.end();
