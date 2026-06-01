/**
 * rerunMay31Stale.ts
 * Targeted re-run for 3 May 31 games where book lines moved after initial model run:
 *   id=2250829 LAA @ TB
 *   id=2250830 ATL @ CIN
 *   id=2250833 MIL @ HOU
 */
import { runMlbModelForDate } from '../server/mlbModelRunner';

async function main() {
  const gameIds = [2250829, 2250830, 2250833];
  console.log(`[INPUT] Target game ids: [${gameIds.join(', ')}] (LAA@TB, ATL@CIN, MIL@HOU)`);
  console.log('[INPUT] Date: 2026-05-31 | forceRerun=true');
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
  console.log('[VERIFY] May 31 stale game re-run complete');
  process.exit(0);
}

main().catch(e => { console.error('[ERROR]', e); process.exit(1); });
