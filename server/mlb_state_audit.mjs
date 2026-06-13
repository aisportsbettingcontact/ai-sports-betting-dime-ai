/**
 * MLB Game State Audit — checks current state of all MLB games in the 7-day window.
 * Uses camelCase column names as defined in drizzle/schema.ts
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

const urlObj = new URL(DATABASE_URL);
const conn = await mysql.createConnection({
  host: urlObj.hostname,
  port: parseInt(urlObj.port || '3306'),
  user: urlObj.username,
  password: urlObj.password,
  database: urlObj.pathname.slice(1).split('?')[0],
  ssl: { rejectUnauthorized: false },
});

console.log('[AUDIT] Connected to DB');

// Compute 7-day window (same logic as db.ts)
const FEED_CUTOFF_UTC_HOUR = 11;
const nowMs = Date.now();
const nowUtc = new Date(nowMs);
const isBeforeCutoff = nowUtc.getUTCHours() < FEED_CUTOFF_UTC_HOUR;
const windowStartMs = isBeforeCutoff ? nowMs - 24 * 60 * 60 * 1000 : nowMs;
const windowStartDate = new Date(windowStartMs);
const todayUtc = [
  windowStartDate.getUTCFullYear(),
  String(windowStartDate.getUTCMonth() + 1).padStart(2, '0'),
  String(windowStartDate.getUTCDate()).padStart(2, '0'),
].join('-');
const plusSeven = new Date(windowStartMs + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

console.log(`[WINDOW] UTC hour=${nowUtc.getUTCHours()} isBeforeCutoff=${isBeforeCutoff}`);
console.log(`[WINDOW] MLB 7-day window: ${todayUtc} → ${plusSeven}\n`);

// Query all MLB games in window using camelCase column names
const [rows] = await conn.execute(
  `SELECT 
    gameDate, awayTeam, homeTeam, 
    publishedToFeed, publishedModel,
    gameStatus, startTimeEst,
    awayBookSpread, homeBookSpread, bookTotal, 
    awayML, homeML, overOdds, underOdds,
    awayModelSpread, homeModelSpread, modelTotal, 
    modelAwayML, modelHomeML,
    spreadEdge, totalEdge,
    oddsSource
   FROM games 
   WHERE sport='MLB' AND gameDate BETWEEN ? AND ?
     AND gameStatus != 'postponed'
   ORDER BY gameDate, startTimeEst`,
  [todayUtc, plusSeven]
);

console.log(`[AUDIT] Found ${rows.length} non-postponed MLB games in window ${todayUtc} → ${plusSeven}\n`);

// Per-date summary
const byDate = {};
for (const r of rows) {
  const d = r.gameDate;
  if (!byDate[d]) byDate[d] = { total: 0, published: 0, noBook: 0, noModel: 0, noML: 0 };
  byDate[d].total++;
  if (r.publishedToFeed) byDate[d].published++;
  if (r.awayBookSpread === null && r.bookTotal === null) byDate[d].noBook++;
  if (r.awayModelSpread === null && r.modelTotal === null && r.modelAwayML === null) byDate[d].noModel++;
  if (r.awayML === null || r.homeML === null) byDate[d].noML++;
}

console.log('[DATE SUMMARY]');
console.log('Date       | Total | Published | NoBook | NoModel | NoML');
console.log('-----------|-------|-----------|--------|---------|-----');
for (const [date, s] of Object.entries(byDate)) {
  console.log(`${date} |  ${String(s.total).padStart(3)}  |    ${String(s.published).padStart(3)}    |   ${String(s.noBook).padStart(3)}  |    ${String(s.noModel).padStart(3)}  |  ${String(s.noML).padStart(3)}`);
}

// Today's games detailed
console.log(`\n[TODAY ${todayUtc} DETAILED]`);
const todayGames = rows.filter(r => r.gameDate === todayUtc);
for (const r of todayGames) {
  const hasBook = r.awayBookSpread !== null || r.bookTotal !== null;
  const hasML = r.awayML !== null && r.homeML !== null;
  const hasModel = r.awayModelSpread !== null || r.modelTotal !== null || r.modelAwayML !== null;
  console.log(
    `  ${r.awayTeam}@${r.homeTeam} ${r.startTimeEst} ` +
    `pub=${r.publishedToFeed ? 'Y' : 'N'} status=${r.gameStatus} ` +
    `book=${hasBook ? '✓' : '✗'} ML=${hasML ? '✓' : '✗'} model=${hasModel ? '✓' : '✗'} ` +
    `src=${r.oddsSource ?? 'null'} ` +
    `spread=${r.awayBookSpread ?? 'null'}/${r.homeBookSpread ?? 'null'} ` +
    `total=${r.bookTotal ?? 'null'} ` +
    `awayML=${r.awayML ?? 'null'} homeML=${r.homeML ?? 'null'}`
  );
}

// Check for postponed games
const [postponed] = await conn.execute(
  `SELECT gameDate, awayTeam, homeTeam, gameStatus, publishedToFeed
   FROM games WHERE sport='MLB' AND gameDate BETWEEN ? AND ? AND gameStatus='postponed'
   ORDER BY gameDate`,
  [todayUtc, plusSeven]
);
if (postponed.length > 0) {
  console.log(`\n[POSTPONED] ${postponed.length} postponed MLB games in window:`);
  for (const r of postponed) {
    console.log(`  ${r.gameDate} ${r.awayTeam}@${r.homeTeam} status=${r.gameStatus} published=${r.publishedToFeed}`);
  }
}

// Check the mlbPublicationGate — does it write to the games table?
console.log('\n[GATE CHECK] Checking if any heartbeat job sets publishedToFeed=false for MLB...');
const [heartbeatRows] = await conn.execute(
  `SELECT id, name, last_run_at, last_status, last_error 
   FROM heartbeat_jobs WHERE name LIKE '%mlb%' OR name LIKE '%MLB%' ORDER BY name`
).catch(() => [[]]);
if (heartbeatRows.length > 0) {
  console.log('[HEARTBEAT] MLB-related heartbeat jobs:');
  for (const r of heartbeatRows) {
    console.log(`  ${r.name} lastRun=${r.last_run_at} status=${r.last_status} err=${r.last_error ?? 'none'}`);
  }
} else {
  console.log('[HEARTBEAT] No heartbeat_jobs table or no MLB jobs found');
}

await conn.end();
console.log('\n[AUDIT] Complete');
