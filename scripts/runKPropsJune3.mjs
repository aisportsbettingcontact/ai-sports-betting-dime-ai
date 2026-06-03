/**
 * K-Props model run for June 3, 2026
 * Invokes modelKPropsForDate for all 15 games.
 */
import { modelKPropsForDate } from '../server/mlbKPropsModelService.ts';

const DATE = '2026-06-03';

console.log('[K-PROPS] ═══════════════════════════════════════════════════════════');
console.log(`[K-PROPS] K-PROPS MODEL RUN — ${DATE}`);
console.log('[K-PROPS] ═══════════════════════════════════════════════════════════');
console.log(`[INPUT]  date=${DATE}`);

const startMs = Date.now();

try {
  const result = await modelKPropsForDate(DATE);
  const elapsedMs = Date.now() - startMs;

  console.log('\n[K-PROPS] ═══════════════════════════════════════════════════════════');
  console.log('[K-PROPS] FINAL SUMMARY');
  console.log('[K-PROPS] ═══════════════════════════════════════════════════════════');
  console.log(`[OUTPUT] elapsed=${(elapsedMs/1000).toFixed(1)}s`);
  console.log(`[OUTPUT] result=`, JSON.stringify(result, null, 2));
  console.log(`[VERIFY] PASS — K-Props model run complete`);
} catch (err) {
  console.error('[K-PROPS] FATAL ERROR:', err);
  process.exit(1);
}
