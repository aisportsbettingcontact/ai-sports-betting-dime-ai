/**
 * forceRunPublishMlb.mjs
 * ======================
 * Force-runs the MLB model for a given date and publishes all results.
 *
 * Pipeline (3 steps):
 *   1. runMlbModelForDate(date, { forceRerun: true })
 *      → clears modelRunAt for all upcoming games, re-runs the full model,
 *        writes modelAwayScore, modelHomeScore, modelAwayML, modelHomeML,
 *        modelTotal to the games table.
 *
 *   2. bulkApproveModels(date, 'MLB')
 *      → sets publishedModel = true for all games that have model data
 *        (awayModelSpread + modelTotal not null) and are not yet approved.
 *
 *   3. publishAllStagingGames(date, 'MLB')
 *      → sets publishedToFeed = true for all games on the date.
 *
 * Usage:
 *   npx tsx server/forceRunPublishMlb.mjs [YYYY-MM-DD]
 *   npx tsx server/forceRunPublishMlb.mjs 2026-07-10
 *
 * If no date is passed, defaults to today in ET.
 */

// ── Bootstrap: load env and TypeScript via tsx ────────────────────────────────
// This script is run with: node --import tsx/esm server/forceRunPublishMlb.mjs
// OR: npx tsx server/forceRunPublishMlb.mjs
// The tsx loader handles .ts imports transparently.

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// ── Validate DATABASE_URL ─────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('[BOOT] FATAL: DATABASE_URL is not set. Cannot connect to TiDB.');
  process.exit(1);
}

// ── Parse target date ─────────────────────────────────────────────────────────
function getTodayET() {
  const etStr = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [m, d, y] = etStr.split('/');
  return `${y}-${m}-${d}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const targetDate = process.argv[2] ?? getTodayET();

if (!DATE_RE.test(targetDate)) {
  console.error(`[INPUT] FATAL: Invalid date format "${targetDate}". Expected YYYY-MM-DD.`);
  process.exit(1);
}

console.log(`[INPUT]  Target date : ${targetDate}`);
console.log(`[INPUT]  DB host     : ${process.env.DATABASE_URL.replace(/:([^@]+)@/, ':***@')}`);
console.log('');

// ── Dynamic imports (TypeScript modules via tsx) ──────────────────────────────
const { runMlbModelForDate } = await import('./mlbModelRunner.ts');
const { bulkApproveModels, publishAllStagingGames } = await import('./db.ts');

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Force-run the MLB model
// ─────────────────────────────────────────────────────────────────────────────
console.log(`[STEP 1] Running MLB model for ${targetDate} (forceRerun=true) ...`);
const t1Start = Date.now();

let modelResult;
try {
  modelResult = await runMlbModelForDate(targetDate, { forceRerun: true });
} catch (err) {
  console.error('[STEP 1] FATAL: runMlbModelForDate threw:', err);
  process.exit(1);
}

const t1Ms = Date.now() - t1Start;
console.log(`[STATE]  written=${modelResult.written} skipped=${modelResult.skipped} errors=${modelResult.errors} (${t1Ms}ms)`);

if (modelResult.errors > 0) {
  console.warn(`[VERIFY] WARNING: ${modelResult.errors} game(s) had model errors. Check logs above.`);
} else {
  console.log(`[VERIFY] PASS — model ran with 0 errors`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Bulk approve model projections (publishedModel = true)
// ─────────────────────────────────────────────────────────────────────────────
console.log(`[STEP 2] Bulk-approving model projections for ${targetDate} MLB ...`);
const t2Start = Date.now();

let approvedCount;
try {
  approvedCount = await bulkApproveModels(targetDate, 'MLB');
} catch (err) {
  console.error('[STEP 2] FATAL: bulkApproveModels threw:', err);
  process.exit(1);
}

const t2Ms = Date.now() - t2Start;
console.log(`[STATE]  approved=${approvedCount} games (${t2Ms}ms)`);

if (approvedCount === 0 && modelResult.written > 0) {
  console.warn('[VERIFY] WARNING: 0 games approved despite model writing results. ' +
    'Check that awayModelSpread and modelTotal are non-null in the games table.');
} else {
  console.log(`[VERIFY] PASS — ${approvedCount} game(s) approved`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Publish all staging games to feed (publishedToFeed = true)
// ─────────────────────────────────────────────────────────────────────────────
console.log(`[STEP 3] Publishing all MLB staging games for ${targetDate} to feed ...`);
const t3Start = Date.now();

try {
  await publishAllStagingGames(targetDate, 'MLB');
} catch (err) {
  console.error('[STEP 3] FATAL: publishAllStagingGames threw:', err);
  process.exit(1);
}

const t3Ms = Date.now() - t3Start;
console.log(`[STATE]  publishAllStagingGames completed (${t3Ms}ms)`);
console.log(`[VERIFY] PASS — all MLB games for ${targetDate} published to feed`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const totalMs = t1Ms + t2Ms + t3Ms;
console.log('═══════════════════════════════════════════════════════════');
console.log(`[OUTPUT] MLB model force-run + publish COMPLETE`);
console.log(`[OUTPUT]   date     : ${targetDate}`);
console.log(`[OUTPUT]   modeled  : ${modelResult.written} written, ${modelResult.skipped} skipped, ${modelResult.errors} errors`);
console.log(`[OUTPUT]   approved : ${approvedCount} games`);
console.log(`[OUTPUT]   published: all staging games → feed`);
console.log(`[OUTPUT]   total    : ${totalMs}ms`);
console.log('═══════════════════════════════════════════════════════════');

process.exit(0);
