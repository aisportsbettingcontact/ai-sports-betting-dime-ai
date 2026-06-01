/**
 * rerunMay31Final.ts
 * Final targeted re-run for 2 remaining May 31 games:
 *   id=2250829 LAA @ TB  (totalEdge=null after re-run, but model says UNDER edge exists)
 *   id=2250830 ATL @ CIN (totalEdge=null after re-run, but model says UNDER edge exists)
 * Re-runs with the fixed no-vig formula.
 */
import { runMlbModelForDate } from '../server/mlbModelRunner';

async function main() {
  const gameIds = [2250829, 2250830];
  console.log(`[INPUT] Target game ids: [${gameIds.join(', ')}] (LAA@TB, ATL@CIN)`);
  console.log('[INPUT] Date: 2026-05-31 | forceRerun=true');
  console.log('[INPUT] Using fixed no-vig total edge formula (matches GameCard.tsx Tier 1)');
  console.log('[STEP] Calling runMlbModelForDate with targetGameIds...');

  const result = await runMlbModelForDate('2026-05-31', {
    targetGameIds: gameIds,
    forceRerun: true,
  });

  console.log('[OUTPUT] Model re-run result:');
  console.log(`  written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
  console.log(`  validation=${result.validation.passed ? '✅ PASSED' : '❌ FAILED'}`);
  if (result.validation.issues.length > 0) {
    console.log('  issues:', result.validation.issues);
  }
  console.log('[VERIFY] May 31 final re-run complete');
  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });
