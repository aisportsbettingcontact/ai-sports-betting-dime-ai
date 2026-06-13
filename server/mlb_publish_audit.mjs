/**
 * MLB Publish Audit — checks why games are being unpublished on the feed.
 * Examines: publishedToFeed state, game_status, odds presence, 7-day window.
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

// Parse the URL
const urlObj = new URL(DATABASE_URL);
const conn = await mysql.createConnection({
  host: urlObj.hostname,
  port: parseInt(urlObj.port || '3306'),
  user: urlObj.username,
  password: urlObj.password,
  database: urlObj.pathname.slice(1).split('?')[0],
  ssl: { rejectUnauthorized: false },
});

console.log('[AUDIT] Connected to DB\n');

// 1. Check current UTC time and MLB 7-day window
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

// 2. Get all MLB games in the 7-day window with full publish state
const [rows] = await conn.execute(
  `SELECT game_date, away_team, home_team, published_to_feed, published_model,
          game_status, away_book_spread, home_book_spread, book_total, away_ml, home_ml,
          away_model_spread, model_total, model_away_ml,
          start_time_est
   FROM games 
   WHERE sport='MLB' AND game_date BETWEEN ? AND ?
   ORDER BY game_date, start_time_est`,
  [todayUtc, plusSeven]
);

console.log(`[AUDIT] Found ${rows.length} MLB games in window ${todayUtc} → ${plusSeven}\n`);

// 3. Categorize each game
let publishedCount = 0;
let unpublishedCount = 0;
let noOddsCount = 0;
let postponedCount = 0;
let noModelCount = 0;

for (const r of rows) {
  const hasBookOdds = r.away_book_spread !== null || r.book_total !== null;
  const hasML = r.away_ml !== null && r.home_ml !== null;
  const hasModelOdds = r.away_model_spread !== null || r.model_total !== null || r.model_away_ml !== null;
  const isPostponed = r.game_status === 'postponed';
  const isPublished = r.published_to_feed === 1 || r.published_to_feed === true;
  const isModelPublished = r.published_model === 1 || r.published_model === true;

  if (isPostponed) postponedCount++;
  if (!hasBookOdds) noOddsCount++;
  if (!hasModelOdds) noModelCount++;
  if (isPublished) publishedCount++;
  else unpublishedCount++;

  // Flag games that would be HIDDEN from the feed
  // MLB games are shown regardless of publishedToFeed (line 432 db.ts)
  // BUT postponed games are excluded
  const wouldBeHidden = isPostponed;
  const wouldShowWithoutModel = !hasModelOdds && !isPostponed;

  if (wouldShowWithoutModel || !hasBookOdds) {
    console.log(`[FLAG] ${r.game_date} ${r.away_team}@${r.home_team} ` +
      `status=${r.game_status} published=${isPublished} modelPublished=${isModelPublished} ` +
      `hasBook=${hasBookOdds} hasML=${hasML} hasModel=${hasModelOdds}`);
  }
}

console.log(`\n[SUMMARY] Total=${rows.length} published=${publishedCount} unpublished=${unpublishedCount}`);
console.log(`[SUMMARY] postponed=${postponedCount} noBookOdds=${noOddsCount} noModelOdds=${noModelCount}`);

// 4. Check the mlbPublicationGate logic
console.log('\n[GATE] Checking mlbPublicationGate for today...');
const [gateRows] = await conn.execute(
  `SELECT game_date, away_team, home_team, published_to_feed, game_status,
          away_book_spread, book_total, away_ml, away_model_spread, model_total
   FROM games 
   WHERE sport='MLB' AND game_date=? AND game_status != 'postponed'
   ORDER BY start_time_est`,
  [todayUtc]
);

console.log(`[GATE] Today (${todayUtc}): ${gateRows.length} non-postponed MLB games`);
let gatePublished = 0, gateUnpublished = 0, gateNoOdds = 0;
for (const r of gateRows) {
  const isPublished = r.published_to_feed === 1 || r.published_to_feed === true;
  const hasBookOdds = r.away_book_spread !== null || r.book_total !== null;
  const hasML = r.away_ml !== null;
  if (isPublished) gatePublished++;
  else gateUnpublished++;
  if (!hasBookOdds) gateNoOdds++;
  console.log(`  ${r.away_team}@${r.home_team} published=${isPublished} hasBook=${hasBookOdds} hasML=${hasML} status=${r.game_status}`);
}
console.log(`[GATE] published=${gatePublished} unpublished=${gateUnpublished} noBookOdds=${gateNoOdds}`);

// 5. Check if there's a publication gate file that controls MLB visibility
console.log('\n[GATE_FILE] Checking mlbPublicationGate table if exists...');
try {
  const [gateFileRows] = await conn.execute(
    `SELECT * FROM mlb_publication_gate ORDER BY gate_date LIMIT 10`
  );
  console.log('[GATE_FILE] mlb_publication_gate rows:', gateFileRows.length);
  for (const r of gateFileRows) console.log(' ', JSON.stringify(r));
} catch (e) {
  console.log('[GATE_FILE] No mlb_publication_gate table:', e.message);
}

// 6. Check the mlbPublicationGate.ts file logic
console.log('\n[GATE_TS] Reading mlbPublicationGate.ts...');

await conn.end();
console.log('\n[AUDIT] Complete');
