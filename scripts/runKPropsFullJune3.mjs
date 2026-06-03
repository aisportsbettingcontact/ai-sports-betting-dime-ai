/**
 * Full K-Props pipeline for June 3, 2026:
 * Step 1: Scrape Action Network K-prop lines → upsert to DB
 * Step 2: Run StrikeoutModel.py for all seeded rows
 */
import { upsertKPropsForDate } from '../server/kPropsDbHelpers.ts';
import { modelKPropsForDate, resolveKPropsMlbamIdsForDate } from '../server/mlbKPropsModelService.ts';

const DATE = '2026-06-03';

console.log('[K-PROPS-FULL] ═══════════════════════════════════════════════════════');
console.log(`[K-PROPS-FULL] FULL K-PROPS PIPELINE — ${DATE}`);
console.log('[K-PROPS-FULL] ═══════════════════════════════════════════════════════');

// ── STEP 1: Scrape AN K-prop lines ──
console.log('\n[STEP 1] Scraping Action Network K-prop lines...');
const t1 = Date.now();
try {
  const upsertResult = await upsertKPropsForDate(DATE);
  console.log(`[OUTPUT] AN scrape complete in ${((Date.now()-t1)/1000).toFixed(1)}s: inserted=${upsertResult.inserted} updated=${upsertResult.updated} skipped=${upsertResult.skipped} errors=${upsertResult.errors}`);
  if (upsertResult.inserted + upsertResult.updated === 0) {
    console.log('[WARN] No K-prop rows seeded — Action Network may not have lines for today yet');
    console.log('[WARN] Proceeding to model step anyway (will model 0 rows)');
  }
} catch (err) {
  console.error('[STEP 1] FATAL: AN scrape failed:', err);
  process.exit(1);
}

// ── STEP 1b: Resolve MLBAM IDs ──
console.log('\n[STEP 1b] Resolving MLBAM IDs for today\'s K-prop rows...');
const t1b = Date.now();
try {
  await resolveKPropsMlbamIdsForDate(DATE);
  console.log(`[OUTPUT] MLBAM ID resolution complete in ${((Date.now()-t1b)/1000).toFixed(1)}s`);
} catch (err) {
  console.warn('[STEP 1b] WARN: MLBAM ID resolution failed (non-fatal):', err?.message ?? err);
}

// ── STEP 2: Run StrikeoutModel ──
console.log('\n[STEP 2] Running StrikeoutModel.py for all seeded rows...');
const t2 = Date.now();
try {
  const modelResult = await modelKPropsForDate(DATE);
  console.log(`[OUTPUT] StrikeoutModel complete in ${((Date.now()-t2)/1000).toFixed(1)}s`);
  console.log(`[OUTPUT] modeled=${modelResult.modeled} edges=${modelResult.edges} errors=${modelResult.errors} skipped=${modelResult.skipped}`);
  console.log(`[VERIFY] ${modelResult.errors === 0 ? 'PASS' : 'WARN'} — K-Props pipeline complete`);
} catch (err) {
  console.error('[STEP 2] FATAL: StrikeoutModel run failed:', err);
  process.exit(1);
}

console.log('\n[K-PROPS-FULL] ═══════════════════════════════════════════════════════');
console.log('[K-PROPS-FULL] PIPELINE COMPLETE');
console.log('[K-PROPS-FULL] ═══════════════════════════════════════════════════════');
