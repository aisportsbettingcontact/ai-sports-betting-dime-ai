/**
 * MLB Pipeline State Audit — corrected column names
 */
import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const url = process.env.DATABASE_URL;
const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:/]+):?(\d+)?\/([^?]+)/);
const conn = await createConnection({
  host: m[3], port: parseInt(m[4] || '4000'),
  user: m[1], password: m[2], database: m[5],
  ssl: { rejectUnauthorized: false }, connectTimeout: 15000,
});

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
})();

console.log(`\n${'='.repeat(70)}`);
console.log(`MLB PIPELINE STATE AUDIT — ${new Date().toISOString()}`);
console.log(`Today (PST): ${today} | Tomorrow: ${tomorrow}`);
console.log('='.repeat(70));

// ── 1. Today's games state ───────────────────────────────────────────────────
console.log('\n[1] TODAY\'S MLB GAMES STATE');
const [todayGames] = await conn.execute(`
  SELECT id, awayTeam, homeTeam, gameStatus, publishedToFeed, publishedModel,
         awayStartingPitcher, homeStartingPitcher,
         awayPitcherConfirmed, homePitcherConfirmed,
         awayML, homeML, bookTotal,
         awayBookSpread, homeBookSpread,
         awayModelSpread, homeModelSpread, modelTotal,
         modelAwayML, modelHomeML,
         modelAwayWinPct, modelHomeWinPct,
         modelAwayScore, modelHomeScore,
         modelRunAt, startTimeEst
  FROM games
  WHERE sport = 'MLB' AND gameDate = ?
  ORDER BY startTimeEst ASC
`, [today]);

console.log(`  Total games today: ${todayGames.length}`);
let publishedCount = 0, modelledCount = 0, noOddsCount = 0, noPitcherCount = 0;
for (const g of todayGames) {
  const hasOdds = g.awayML !== null && g.homeML !== null && g.bookTotal !== null;
  const hasPitchers = g.awayStartingPitcher && g.homeStartingPitcher;
  const hasModel = g.modelTotal !== null && g.awayModelSpread !== null;
  if (g.publishedToFeed) publishedCount++;
  if (hasModel) modelledCount++;
  if (!hasOdds) noOddsCount++;
  if (!hasPitchers) noPitcherCount++;
  
  const awayConf = g.awayPitcherConfirmed ? '[CONF]' : '[PROJ]';
  const homeConf = g.homePitcherConfirmed ? '[CONF]' : '[PROJ]';
  const modelAge = g.modelRunAt ? Math.round((Date.now() - g.modelRunAt) / 60000) + 'min ago' : 'NEVER';
  // Fetch lineup version from mlb_lineups
  const [luRows] = await conn.execute(`SELECT lineupVersion, lineupModeledVersion FROM mlb_lineups WHERE gameId = ? LIMIT 1`, [g.id]);
  const lu = luRows[0] || { lineupVersion: 0, lineupModeledVersion: 0 };
  const status = [
    hasOdds ? '✓odds' : '✗odds',
    hasPitchers ? '✓ptch' : '✗ptch',
    hasModel ? '✓model' : '✗model',
    g.publishedToFeed ? '✓pub' : '✗pub',
  ].join(' ');
  console.log(`  ${g.awayTeam}@${g.homeTeam} | ${status}`);
  console.log(`    ML: ${g.awayML}/${g.homeML} | RL: ${g.awayBookSpread}/${g.homeBookSpread} | OU: ${g.bookTotal}`);
  console.log(`    Model: RL=${g.awayModelSpread}/${g.homeModelSpread} OU=${g.modelTotal} ML=${g.modelAwayML}/${g.modelHomeML} WinPct=${g.modelAwayWinPct}%/${g.modelHomeWinPct}%`);
  console.log(`    Pitchers: ${g.awayStartingPitcher||'TBD'}${awayConf} vs ${g.homeStartingPitcher||'TBD'}${homeConf}`);
    console.log(`    modelRunAt: ${modelAge} | lineupV=${lu.lineupVersion} modeledV=${lu.lineupModeledVersion}`);
}
console.log(`\n  SUMMARY: ${publishedCount}/${todayGames.length} published | ${modelledCount}/${todayGames.length} modelled | ${noOddsCount} no-odds | ${noPitcherCount} no-pitchers`);

// ── 2. Tomorrow's games state ────────────────────────────────────────────────
console.log('\n[2] TOMORROW\'S MLB GAMES STATE');
const [tomorrowGames] = await conn.execute(`
  SELECT id, awayTeam, homeTeam, gameStatus, publishedToFeed, publishedModel,
         awayStartingPitcher, homeStartingPitcher,
         awayML, homeML, bookTotal,
         awayModelSpread, homeModelSpread, modelTotal,
         modelRunAt
  FROM games
  WHERE sport = 'MLB' AND gameDate = ?
  ORDER BY startTimeEst ASC
`, [tomorrow]);

console.log(`  Total games tomorrow: ${tomorrowGames.length}`);
let tmrModelled = 0, tmrNoOdds = 0;
for (const g of tomorrowGames) {
  const hasOdds = g.awayML !== null && g.homeML !== null;
  const hasPitchers = g.awayStartingPitcher && g.homeStartingPitcher;
  const hasModel = g.modelTotal !== null;
  if (hasModel) tmrModelled++;
  if (!hasOdds) tmrNoOdds++;
  const status = [
    hasOdds ? '✓odds' : '✗odds',
    hasPitchers ? '✓ptch' : '✗ptch',
    hasModel ? '✓model' : '✗model',
    g.publishedToFeed ? '✓pub' : '✗pub',
  ].join(' ');
  console.log(`  ${g.awayTeam}@${g.homeTeam} | ${status} | ML:${g.awayML}/${g.homeML} OU:${g.bookTotal} | modelRunAt:${g.modelRunAt ? new Date(g.modelRunAt).toISOString() : 'NULL'}`);
}
console.log(`  SUMMARY: ${tmrModelled}/${tomorrowGames.length} modelled | ${tmrNoOdds} no-odds`);

// ── 3. Pitcher DB freshness ──────────────────────────────────────────────────
console.log('\n[3] PITCHER DB FRESHNESS (mlb_pitcher_stats)');
const [pitcherCount] = await conn.execute(`SELECT COUNT(*) as cnt FROM mlb_pitcher_stats`);
const [pitcherUpdated] = await conn.execute(`
  SELECT MAX(updatedAt) as latest, MIN(updatedAt) as oldest, COUNT(*) as cnt
  FROM mlb_pitcher_stats WHERE gamesStarted >= 1
`);
const latestAge = pitcherUpdated[0].latest
  ? Math.round((Date.now() - new Date(pitcherUpdated[0].latest).getTime()) / 3600000) + 'h ago'
  : 'NEVER';
console.log(`  Total pitchers: ${pitcherCount[0].cnt} | Starters (GS>=1): ${pitcherUpdated[0].cnt}`);
console.log(`  Latest update: ${pitcherUpdated[0].latest} (${latestAge})`);

// Check today's starters against DB
console.log('\n[3b] TODAY\'S STARTER RESOLUTION');
for (const g of todayGames) {
  for (const [role, pitcher, team] of [
    ['away', g.awayStartingPitcher, g.awayTeam],
    ['home', g.homeStartingPitcher, g.homeTeam]
  ]) {
    if (!pitcher) { console.log(`  ${team} ${role}: TBD`); continue; }
    const lastName = pitcher.split(' ').slice(-1)[0];
    const [rows] = await conn.execute(`
      SELECT fullName, teamAbbrev, era, fip, xfip, k9, bb9, whip, ip, gamesStarted, updatedAt
      FROM mlb_pitcher_stats WHERE fullName LIKE ? LIMIT 3
    `, [`%${lastName}%`]);
    if (rows.length === 0) {
      console.log(`  ${team} ${role}: "${pitcher}" → ✗ NOT IN DB (team SP avg or league default fallback)`);
    } else {
      const r = rows[0];
      const age = r.updatedAt ? Math.round((Date.now() - new Date(r.updatedAt).getTime()) / 3600000) + 'h ago' : '?';
      console.log(`  ${team} ${role}: "${pitcher}" → ✓ DB: ERA=${r.era?.toFixed(2)} FIP=${r.fip?.toFixed(2)} K/9=${r.k9?.toFixed(2)} GS=${r.gamesStarted} (${age})`);
    }
  }
}

// ── 4. Team batting splits freshness ────────────────────────────────────────
console.log('\n[4] TEAM BATTING SPLITS FRESHNESS');
const [splitsInfo] = await conn.execute(`
  SELECT COUNT(DISTINCT teamAbbrev) as teams, COUNT(*) as rowCount,
         MAX(updatedAt) as latest
  FROM mlb_team_batting_splits
`);
const splitsAge = splitsInfo[0].latest
  ? Math.round((Date.now() - new Date(splitsInfo[0].latest).getTime()) / 3600000) + 'h ago'
  : 'NEVER';
console.log(`  Teams: ${splitsInfo[0].teams} | Rows: ${splitsInfo[0].rowCount} | Latest: ${splitsInfo[0].latest} (${splitsAge})`);

// ── 5. Park factors freshness ────────────────────────────────────────────────
console.log('\n[5] PARK FACTORS FRESHNESS');
const [parkInfo] = await conn.execute(`
  SELECT COUNT(*) as cnt, MAX(updatedAt) as latest FROM mlb_park_factors
`);
const parkAge = parkInfo[0].latest
  ? Math.round((Date.now() - new Date(parkInfo[0].latest).getTime()) / 3600000) + 'h ago'
  : 'NEVER';
console.log(`  Parks: ${parkInfo[0].cnt} | Latest: ${parkInfo[0].latest} (${parkAge})`);

// ── 6. Bullpen stats freshness ───────────────────────────────────────────────
console.log('\n[6] BULLPEN STATS FRESHNESS');
const [bullpenInfo] = await conn.execute(`
  SELECT COUNT(DISTINCT teamAbbrev) as teams, MAX(updatedAt) as latest FROM mlb_bullpen_stats
`);
const bullpenAge = bullpenInfo[0].latest
  ? Math.round((Date.now() - new Date(bullpenInfo[0].latest).getTime()) / 3600000) + 'h ago'
  : 'NEVER';
console.log(`  Teams: ${bullpenInfo[0].teams} | Latest: ${bullpenInfo[0].latest} (${bullpenAge})`);

// ── 7. Rolling-5 pitcher stats ───────────────────────────────────────────────
console.log('\n[7] ROLLING-5 PITCHER STATS FRESHNESS');
const [r5Info] = await conn.execute(`
  SELECT COUNT(*) as cnt, MAX(updatedAt) as latest FROM mlb_pitcher_rolling5
`);
const r5Age = r5Info[0].latest
  ? Math.round((Date.now() - new Date(r5Info[0].latest).getTime()) / 3600000) + 'h ago'
  : 'NEVER';
console.log(`  Pitchers: ${r5Info[0].cnt} | Latest: ${r5Info[0].latest} (${r5Age})`);

// ── 8. Model staleness — games with odds but no model ───────────────────────
console.log('\n[8] MODEL STALENESS — GAMES WITH ODDS BUT NO MODEL (next 7 days)');
const [staleGames] = await conn.execute(`
  SELECT awayTeam, homeTeam, gameDate, awayML, homeML, bookTotal,
         awayStartingPitcher, homeStartingPitcher, modelRunAt, publishedToFeed
  FROM games
  WHERE sport = 'MLB'
    AND gameDate >= ?
    AND gameDate <= DATE_ADD(?, INTERVAL 7 DAY)
    AND awayML IS NOT NULL
    AND homeML IS NOT NULL
    AND bookTotal IS NOT NULL
    AND modelTotal IS NULL
    AND gameStatus != 'postponed'
  ORDER BY gameDate ASC
`, [today, today]);
console.log(`  Games with full odds but NO model: ${staleGames.length}`);
for (const g of staleGames) {
  console.log(`  ${g.gameDate} ${g.awayTeam}@${g.homeTeam} | away_p=${g.awayStartingPitcher||'TBD'} home_p=${g.homeStartingPitcher||'TBD'} | pub=${g.publishedToFeed}`);
}

// ── 9. Rolling-5 coverage for today's starters ──────────────────────────────
console.log('\n[9] ROLLING-5 COVERAGE FOR TODAY\'S STARTERS');
for (const g of todayGames) {
  for (const [pitcher, team] of [
    [g.awayStartingPitcher, g.awayTeam],
    [g.homeStartingPitcher, g.homeTeam]
  ]) {
    if (!pitcher) continue;
    const lastName = pitcher.split(' ').slice(-1)[0];
    const [r5rows] = await conn.execute(`
      SELECT r.mlbamId, r.era5, r.k9_5, r.whip5, r.startsIncluded, r.updatedAt
      FROM mlb_pitcher_rolling5 r
      JOIN mlb_pitcher_stats s ON r.mlbamId = s.mlbamId
      WHERE s.fullName LIKE ? LIMIT 1
    `, [`%${lastName}%`]);
    if (r5rows.length > 0 && r5rows[0].startsIncluded >= 3) {
      console.log(`  ${team} "${pitcher}" → ✓ rolling-5: ERA=${r5rows[0].era5?.toFixed(2)} K/9=${r5rows[0].k9_5?.toFixed(2)} starts=${r5rows[0].startsIncluded}`);
    } else if (r5rows.length > 0) {
      console.log(`  ${team} "${pitcher}" → ⚠ rolling-5: only ${r5rows[0].startsIncluded} starts (min 3 required)`);
    } else {
      console.log(`  ${team} "${pitcher}" → ✗ no rolling-5 data`);
    }
  }
}

// ── 10. Umpire modifiers freshness ───────────────────────────────────────────
console.log('\n[10] UMPIRE MODIFIERS FRESHNESS');
const [umpireInfo] = await conn.execute(`
  SELECT COUNT(*) as cnt, MAX(updatedAt) as latest FROM mlb_umpire_modifiers
`);
const umpireAge = umpireInfo[0].latest
  ? Math.round((Date.now() - new Date(umpireInfo[0].latest).getTime()) / 3600000) + 'h ago'
  : 'NEVER';
console.log(`  Umpires: ${umpireInfo[0].cnt} | Latest: ${umpireInfo[0].latest} (${umpireAge})`);

console.log('\n' + '='.repeat(70));
console.log('AUDIT COMPLETE');
console.log('='.repeat(70));
await conn.end();
