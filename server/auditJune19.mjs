/**
 * auditJune19.mjs
 * Pre-run audit for June 19, 2026 MLB slate.
 * Checks: games, lineups, odds, pitchers, weather, umpires.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const TAG = '[AuditJune19]';
const DATE = '2026-06-19';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log(`${TAG} ═══════════════════════════════════════════════════════`);
console.log(`${TAG} [INPUT] PRE-RUN AUDIT — ${DATE}`);
console.log(`${TAG} ═══════════════════════════════════════════════════════`);

// ── 1. Games ─────────────────────────────────────────────────────────────────
const [games] = await conn.execute(`
  SELECT id, awayTeam, homeTeam, startTimeEst, awayML, homeML, bookTotal,
         awayRunLine, awayRunLineOdds, homeRunLineOdds,
         awayStartingPitcher, homeStartingPitcher,
         modelRunAt, publishedToFeed, publishedModel,
         modelAwayScore, modelHomeScore, mlbGamePk
  FROM games
  WHERE gameDate = ? AND sport = 'MLB'
  ORDER BY startTimeEst
`, [DATE]);

console.log(`${TAG} [INPUT] Games found: ${games.length}`);
for (const g of games) {
  console.log(
    `${TAG} [INPUT] id=${g.id} pk=${g.mlbGamePk} ${g.awayTeam}@${g.homeTeam} ` +
    `${g.startTimeEst} | ML=${g.awayML}/${g.homeML} total=${g.bookTotal} ` +
    `rl=${g.awayRunLine}(${g.awayRunLineOdds}/${g.homeRunLineOdds}) | ` +
    `awayP="${g.awayStartingPitcher}" homeP="${g.homeStartingPitcher}" | ` +
    `modelRunAt=${g.modelRunAt ? 'SET' : 'NULL'} pub=${g.publishedToFeed}`
  );
}

// ── 2. Lineups ────────────────────────────────────────────────────────────────
const [lineups] = await conn.execute(`
  SELECT l.gameId, l.awayPitcherName, l.homePitcherName,
         l.awayPitcherHand, l.homePitcherHand,
         l.awayPitcherMlbamId, l.homePitcherMlbamId,
         l.awayLineupConfirmed, l.homeLineupConfirmed,
         l.umpire, l.weatherTemp, l.weatherWind, l.weatherDome,
         l.awayLineup, l.homeLineup
  FROM mlb_lineups l
  JOIN games g ON g.id = l.gameId
  WHERE g.gameDate = ? AND g.sport = 'MLB'
  ORDER BY l.gameId
`, [DATE]);

console.log(`\n${TAG} [INPUT] Lineups found: ${lineups.length}/${games.length}`);
for (const l of lineups) {
  const awayBatters = l.awayLineup ? JSON.parse(l.awayLineup).length : 0;
  const homeBatters = l.homeLineup ? JSON.parse(l.homeLineup).length : 0;
  console.log(
    `${TAG} [INPUT] gameId=${l.gameId} | ` +
    `awayP="${l.awayPitcherName}"(${l.awayPitcherHand},mlbam=${l.awayPitcherMlbamId}) ` +
    `homeP="${l.homePitcherName}"(${l.homePitcherHand},mlbam=${l.homePitcherMlbamId}) | ` +
    `awayConf=${l.awayLineupConfirmed}(${awayBatters}bat) homeConf=${l.homeLineupConfirmed}(${homeBatters}bat) | ` +
    `umpire="${l.umpire}" temp="${l.weatherTemp}" wind="${l.weatherWind}" dome=${l.weatherDome}`
  );
}

// ── 3. Missing lineups ────────────────────────────────────────────────────────
const lineupGameIds = new Set(lineups.map(l => l.gameId));
const missingLineups = games.filter(g => !lineupGameIds.has(g.id));
if (missingLineups.length > 0) {
  console.log(`\n${TAG} [STATE] Games WITHOUT lineups (${missingLineups.length}):`);
  for (const g of missingLineups) {
    console.log(`${TAG} [STATE] MISSING LINEUP: id=${g.id} ${g.awayTeam}@${g.homeTeam}`);
  }
} else {
  console.log(`\n${TAG} [STATE] All ${games.length} games have lineup records ✓`);
}

// ── 4. Missing odds ───────────────────────────────────────────────────────────
const missingOdds = games.filter(g => !g.awayML || !g.homeML || !g.bookTotal);
if (missingOdds.length > 0) {
  console.log(`\n${TAG} [STATE] Games with MISSING ODDS (${missingOdds.length}):`);
  for (const g of missingOdds) {
    console.log(`${TAG} [STATE] MISSING ODDS: id=${g.id} ${g.awayTeam}@${g.homeTeam} ML=${g.awayML}/${g.homeML} total=${g.bookTotal}`);
  }
} else {
  console.log(`${TAG} [STATE] All ${games.length} games have ML + total odds ✓`);
}

// ── 5. Already modeled ────────────────────────────────────────────────────────
const alreadyModeled = games.filter(g => g.modelRunAt !== null);
console.log(`\n${TAG} [STATE] Already modeled: ${alreadyModeled.length}/${games.length}`);

console.log(`\n${TAG} ═══════════════════════════════════════════════════════`);
console.log(`${TAG} [VERIFY] AUDIT COMPLETE`);
console.log(`${TAG} [VERIFY] Total games: ${games.length}`);
console.log(`${TAG} [VERIFY] With lineups: ${lineupGameIds.size}`);
console.log(`${TAG} [VERIFY] With ML odds: ${games.filter(g => g.awayML && g.homeML).length}`);
console.log(`${TAG} [VERIFY] With total: ${games.filter(g => g.bookTotal).length}`);
console.log(`${TAG} [VERIFY] Already modeled: ${alreadyModeled.length}`);
console.log(`${TAG} ═══════════════════════════════════════════════════════`);

await conn.end();
