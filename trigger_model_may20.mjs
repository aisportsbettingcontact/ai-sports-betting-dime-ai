/**
 * trigger_model_may20.mjs
 * 
 * Directly invokes runMlbModelForDate("2026-05-20") from the server code.
 * Runs all 15 May 20 MLB games through the full model pipeline and publishes results.
 * 
 * [INPUT] date=2026-05-20, forceRerun=false (only runs unmodeled games)
 * [OUTPUT] MlbModelRunSummary with written/skipped/errors/validation
 */

// Set up environment
process.env.NODE_ENV = 'production';

import * as dotenv from 'dotenv';
dotenv.config();

console.log('═══════════════════════════════════════════════════════════════════');
console.log('[INPUT] Triggering MLB model run for 2026-05-20');
console.log('[INPUT] forceRerun=false — only models games with modelRunAt=NULL');
console.log('═══════════════════════════════════════════════════════════════════\n');

const startMs = Date.now();

try {
  console.log('[STEP 1] Importing runMlbModelForDate from mlbModelRunner...');
  const { runMlbModelForDate } = await import('./server/mlbModelRunner.ts');
  console.log('[STEP 1] Import successful');

  console.log('[STEP 2] Running model for 2026-05-20...');
  const result = await runMlbModelForDate('2026-05-20', { forceRerun: false });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('[OUTPUT] Model run complete in ' + elapsed + 's');
  console.log('[OUTPUT] date=' + result.date);
  console.log('[OUTPUT] total=' + result.total + ' written=' + result.written + ' skipped=' + result.skipped + ' errors=' + result.errors);
  console.log('[OUTPUT] validation=' + (result.validation.passed ? '✅ PASSED' : '❌ FAILED (' + result.validation.issues.length + ' issues)'));
  
  if (result.validation.issues && result.validation.issues.length > 0) {
    console.log('[VALIDATION ISSUES]');
    for (const issue of result.validation.issues) {
      console.log('  ⚠', issue);
    }
  }
  
  if (result.validation.warnings && result.validation.warnings.length > 0) {
    console.log('[VALIDATION WARNINGS]');
    for (const warn of result.validation.warnings) {
      console.log('  ℹ', warn);
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════════════');
  
  if (result.written > 0) {
    console.log('[VERIFY] ✅ PASS — ' + result.written + ' games modeled and published');
  } else if (result.skipped > 0 && result.errors === 0) {
    console.log('[VERIFY] ⚠ All games skipped — check if already modeled or missing data');
  } else if (result.errors > 0) {
    console.log('[VERIFY] ❌ FAIL — ' + result.errors + ' errors during model run');
    process.exit(1);
  }
  
} catch (err) {
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.error('\n[ERROR] Model run failed after ' + elapsed + 's');
  console.error('[ERROR] Message:', err.message);
  console.error('[ERROR] Stack:', err.stack);
  process.exit(1);
}

process.exit(0);
