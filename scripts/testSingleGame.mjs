/**
 * Single-game diagnostic: run MIA@WSH (id=2250861) to get the exact MySQL error
 */
import { runMlbModelForDate } from '../server/mlbModelRunner.ts';

console.log('[TEST] Running single game diagnostic for MIA@WSH (id=2250861)...');
try {
  const result = await runMlbModelForDate('2026-06-03', { forceRerun: true, gameIds: [2250861] });
  console.log('[TEST] Result:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('[TEST] FATAL:', err);
  const cause = err?.cause;
  if (cause) console.error('[TEST] CAUSE:', cause);
}
process.exit(0);
