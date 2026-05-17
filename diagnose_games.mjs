/**
 * diagnose_games.mjs
 * Direct DB query to diagnose "No games found" on the feed.
 * Checks: game counts, odds presence, gameStatus, listGames filter logic.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error('[ERROR] DATABASE_URL not set'); process.exit(1); }

console.log('[INPUT] DATABASE_URL found');

// Parse the MySQL URL
const conn = await mysql.createConnection({ uri: url });

const today = new Date();
const utcHour = today.getUTCHours();
const isBeforeCutoff = utcHour < 11;
const effectiveMs = isBeforeCutoff ? today.getTime() - 24*60*60*1000 : today.getTime();
const effectiveDate = new Date(effectiveMs);
const todayStr = effectiveDate.toISOString().slice(0, 10);
const yesterdayStr = new Date(effectiveMs - 24*60*60*1000).toISOString().slice(0, 10);
const tomorrowStr = new Date(effectiveMs + 24*60*60*1000).toISOString().slice(0, 10);

console.log(`[STATE] utcHour=${utcHour} isBeforeCutoff=${isBeforeCutoff}`);
console.log(`[STATE] effectiveDate=${todayStr} yesterday=${yesterdayStr} tomorrow=${tomorrowStr}`);

// Query 1: Game counts per date for MLB
console.log('\n=== [STEP 1] MLB game counts per date (today ±2 days) ===');
const [rows1] = await conn.execute(`
  SELECT 
    gameDate,
    COUNT(*) as total,
    SUM(CASE WHEN awayBookSpread IS NOT NULL OR bookTotal IS NOT NULL THEN 1 ELSE 0 END) as with_odds,
    SUM(CASE WHEN awayBookSpread IS NULL AND bookTotal IS NULL THEN 1 ELSE 0 END) as no_odds,
    SUM(CASE WHEN gameStatus = 'postponed' THEN 1 ELSE 0 END) as postponed,
    SUM(CASE WHEN gameStatus = 'final' THEN 1 ELSE 0 END) as final_ct,
    SUM(CASE WHEN gameStatus IN ('in_progress','live','in progress') THEN 1 ELSE 0 END) as live_ct,
    GROUP_CONCAT(DISTINCT gameStatus ORDER BY gameStatus) as statuses
  FROM games 
  WHERE sport = 'MLB' 
    AND gameDate >= ? AND gameDate <= ?
  GROUP BY gameDate
  ORDER BY gameDate
`, [yesterdayStr, tomorrowStr]);

for (const r of rows1) {
  console.log(`[OUTPUT] ${r.gameDate}: total=${r.total} with_odds=${r.with_odds} no_odds=${r.no_odds} postponed=${r.postponed} final=${r.final_ct} live=${r.live_ct} statuses=[${r.statuses}]`);
}

// Query 2: Simulate the exact listGames filter for today
console.log(`\n=== [STEP 2] Simulate listGames(sport=MLB, gameDate=${todayStr}) ===`);
const [rows2] = await conn.execute(`
  SELECT 
    id, awayTeam, homeTeam, gameDate, gameStatus,
    awayBookSpread, homeBookSpread, bookTotal,
    startTimeEst, sortOrder
  FROM games 
  WHERE sport = 'MLB' 
    AND gameDate = ?
    AND gameStatus != 'postponed'
  ORDER BY sortOrder
  LIMIT 30
`, [todayStr]);

console.log(`[OUTPUT] Rows matching listGames filter: ${rows2.length}`);
for (const r of rows2) {
  const hasOdds = r.awayBookSpread !== null || r.bookTotal !== null;
  console.log(`[OUTPUT]   id=${r.id} ${r.awayTeam}@${r.homeTeam} status=${r.gameStatus} odds=${hasOdds} spread=${r.awayBookSpread} total=${r.bookTotal} time=${r.startTimeEst}`);
}

// Query 3: Check if the frontend date matches DB date
console.log(`\n=== [STEP 3] Check frontend date vs DB date ===`);
// The frontend uses todayUTC() which is UTC-based with 11:00 cutoff
// The DB query uses the same logic
// Check if there's a PST vs UTC mismatch
const pstNow = new Date(today.getTime() - 7*60*60*1000); // PST = UTC-7 (PDT)
const pstDate = pstNow.toISOString().slice(0, 10);
const estNow = new Date(today.getTime() - 4*60*60*1000); // EDT = UTC-4
const estDate = estNow.toISOString().slice(0, 10);
console.log(`[STATE] UTC date: ${today.toISOString().slice(0,10)}`);
console.log(`[STATE] PST/PDT date: ${pstDate}`);
console.log(`[STATE] EST/EDT date: ${estDate}`);
console.log(`[STATE] Effective feed date (server): ${todayStr}`);

// Query 4: Check if the games cache TTL might be serving stale 0-game data
console.log(`\n=== [STEP 4] Check all distinct game statuses in DB for today ===`);
const [rows4] = await conn.execute(`
  SELECT DISTINCT gameStatus, COUNT(*) as cnt
  FROM games 
  WHERE sport = 'MLB' AND gameDate = ?
  GROUP BY gameStatus
`, [todayStr]);
for (const r of rows4) {
  console.log(`[OUTPUT] status="${r.gameStatus}" count=${r.cnt}`);
}

// Query 5: Check if the 7-day window query would return games
console.log(`\n=== [STEP 5] Simulate MLB 7-day rolling window query ===`);
const plusSeven = new Date(effectiveMs + 7*24*60*60*1000).toISOString().slice(0, 10);
const [rows5] = await conn.execute(`
  SELECT gameDate, COUNT(*) as cnt,
    SUM(CASE WHEN awayBookSpread IS NOT NULL OR bookTotal IS NOT NULL THEN 1 ELSE 0 END) as with_odds
  FROM games 
  WHERE sport = 'MLB' 
    AND gameDate >= ? AND gameDate <= ?
    AND gameStatus != 'postponed'
  GROUP BY gameDate
  ORDER BY gameDate
`, [todayStr, plusSeven]);
console.log(`[OUTPUT] 7-day window ${todayStr} → ${plusSeven}:`);
for (const r of rows5) {
  console.log(`[OUTPUT]   ${r.gameDate}: total=${r.cnt} with_odds=${r.with_odds}`);
}

await conn.end();
console.log('\n[VERIFY] Diagnosis complete');
