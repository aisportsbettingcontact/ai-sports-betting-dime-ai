/**
 * Direct MLB model run for June 3, 2026
 * Invokes runMlbModelForDate with forceRerun=true for all 15 games.
 * Captures full structured output for validation.
 */
import { runMlbModelForDate } from '../server/mlbModelRunner.ts';

const DATE = '2026-06-03';

console.log('[SCRIPT] ═══════════════════════════════════════════════════════════');
console.log(`[SCRIPT] MLB MODEL RUN — ${DATE}`);
console.log('[SCRIPT] ═══════════════════════════════════════════════════════════');
console.log(`[INPUT]  date=${DATE} forceRerun=true`);
console.log(`[INPUT]  scope=ALL_15_GAMES (Full Game + F5 + NRFI/YRFI + K-Props + HR Props)`);
console.log('[SCRIPT] Starting...\n');

const startMs = Date.now();

try {
  const result = await runMlbModelForDate(DATE, { forceRerun: true });
  const elapsedMs = Date.now() - startMs;

  console.log('\n[SCRIPT] ═══════════════════════════════════════════════════════════');
  console.log('[SCRIPT] FINAL SUMMARY');
  console.log('[SCRIPT] ═══════════════════════════════════════════════════════════');
  console.log(`[OUTPUT] date=${result.date}`);
  console.log(`[OUTPUT] total=${result.total} written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
  console.log(`[OUTPUT] elapsed=${(elapsedMs/1000).toFixed(1)}s`);
  if (result.validation) {
    console.log(`[VERIFY] validation.passed=${result.validation.passed}`);
    if (result.validation.issues?.length > 0) {
      console.log(`[VERIFY] ISSUES (${result.validation.issues.length}):`);
      result.validation.issues.forEach(i => console.log(`  [ISSUE] ${i}`));
    }
    if (result.validation.warnings?.length > 0) {
      console.log(`[VERIFY] WARNINGS (${result.validation.warnings.length}):`);
      result.validation.warnings.forEach(w => console.log(`  [WARN]  ${w}`));
    }
  }
  if (result.errors > 0) {
    console.error(`[VERIFY] FAIL — ${result.errors} errors occurred during model run`);
    process.exit(1);
  } else {
    console.log(`[VERIFY] PASS — All ${result.written} games modeled successfully`);
  }
} catch (err) {
  console.error('[SCRIPT] FATAL ERROR:', err);
  process.exit(1);
}
