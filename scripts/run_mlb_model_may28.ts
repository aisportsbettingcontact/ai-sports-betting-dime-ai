/**
 * run_mlb_model_may28.ts
 *
 * Standalone runner: force-reruns the MLB model for 2026-05-28.
 * Bypasses tRPC auth layer — calls runMlbModelForDate directly.
 *
 * Usage:
 *   cd /home/ubuntu/ai-sports-betting
 *   npx tsx scripts/run_mlb_model_may28.ts
 *
 * [INPUT]  date=2026-05-28, forceRerun=true, targetGameIds=ALL
 * [STEP]   1. Load DB connection
 * [STEP]   2. Call runMlbModelForDate with forceRerun=true
 * [STEP]   3. Log full result summary
 * [STEP]   4. Run post-write validation gate
 * [OUTPUT] Written/skipped/error counts + validation pass/fail
 */

import 'dotenv/config';
import { runMlbModelForDate, validateMlbModelResults } from '../server/mlbModelRunner';

const DATE = '2026-05-28';

async function main() {
  console.log('\n════════════════════════════════════════════════════════');
  console.log('[INPUT]  date=' + DATE + ' | forceRerun=true | targetGameIds=ALL');
  console.log('[STEP]   Initializing MLB model force-rerun...');
  console.log('════════════════════════════════════════════════════════\n');

  const t0 = Date.now();

  let result;
  try {
    result = await runMlbModelForDate(DATE, { forceRerun: true });
  } catch (err) {
    console.error('[FAIL]   runMlbModelForDate threw an exception:');
    console.error(err);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n════════════════════════════════════════════════════════');
  console.log('[OUTPUT] MODEL RUN COMPLETE');
  console.log('════════════════════════════════════════════════════════');
  console.log(`[OUTPUT] date=${result.date}`);
  console.log(`[OUTPUT] total games in DB : ${result.total}`);
  console.log(`[OUTPUT] written (modeled) : ${result.written}`);
  console.log(`[OUTPUT] skipped (no data) : ${result.skipped}`);
  console.log(`[OUTPUT] errors            : ${result.errors}`);
  console.log(`[OUTPUT] elapsed           : ${elapsed}s`);

  console.log('\n[STEP]   Post-write validation gate...');
  const validation = result.validation;

  if (validation.passed) {
    console.log('[VERIFY] ✅ VALIDATION PASSED — all modeled games correct');
  } else {
    console.error('[VERIFY] ❌ VALIDATION FAILED — ' + validation.issues.length + ' issue(s):');
    for (const issue of validation.issues) {
      console.error('  [ISSUE] ' + issue);
    }
  }

  if (validation.warnings.length > 0) {
    console.warn('[VERIFY] ⚠ ' + validation.warnings.length + ' warning(s):');
    for (const w of validation.warnings) {
      console.warn('  [WARN]  ' + w);
    }
  }

  console.log('\n════════════════════════════════════════════════════════');
  if (result.errors > 0) {
    console.error('[FINAL]  ❌ COMPLETED WITH ERRORS — ' + result.errors + ' game(s) failed');
    process.exit(1);
  } else if (!validation.passed) {
    console.error('[FINAL]  ❌ COMPLETED — validation FAILED');
    process.exit(2);
  } else {
    console.log('[FINAL]  ✅ SUCCESS — ' + result.written + '/' + result.total + ' games modeled and published');
  }
  console.log('════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(err => {
  console.error('[FATAL]  Unhandled exception in main():', err);
  process.exit(1);
});
