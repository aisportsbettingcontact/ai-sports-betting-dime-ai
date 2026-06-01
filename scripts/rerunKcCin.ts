/**
 * rerunKcCin.ts
 * Targeted re-run of the MLB model for KC @ CIN (id=2250841) on June 1, 2026.
 * Book total has moved from 8.5 → 9.5. forceRerun=true overwrites the existing model output.
 */
import { runMlbModelForDate } from '../server/mlbModelRunner';

async function main() {
  const gameId = 2250841;
  console.log(`[INPUT] Target game id=${gameId} (KC @ CIN, 2026-06-01)`);
  console.log('[INPUT] Book total has moved 8.5 → 9.5. Re-running with current book odds.');
  console.log('[STEP] Calling runMlbModelForDate("2026-06-01", { targetGameIds: [2250841], forceRerun: true })...');

  const result = await runMlbModelForDate('2026-06-01', {
    targetGameIds: [gameId],
    forceRerun: true,
  });

  console.log('[OUTPUT] Model re-run result:');
  console.log(`  written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
  console.log(`  validation=${result.validation.passed ? '✅ PASSED' : '❌ FAILED'}`);
  if (result.validation.issues.length > 0) {
    console.log('  issues:', result.validation.issues);
  }
  console.log('[VERIFY] KC @ CIN re-run complete');
  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });
