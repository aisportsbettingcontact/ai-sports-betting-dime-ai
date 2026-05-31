/**
 * runMay31Model.ts
 * Run the full MLB model pipeline for May 31, 2026.
 * Forces rerun on all 15 games.
 * Deep logging: every step, every game, every validation gate.
 */
import { runMlbModelForDate, validateMlbModelResults } from "../server/mlbModelRunner.ts";

const DATE = "2026-05-31";

async function main() {
  const startMs = Date.now();
  console.log(`\n[RunMay31] ═══════════════════════════════════════════════════════`);
  console.log(`[RunMay31] [INPUT]  date=${DATE}  forceRerun=true`);
  console.log(`[RunMay31] [STEP]   Invoking runMlbModelForDate...`);
  console.log(`[RunMay31] ═══════════════════════════════════════════════════════\n`);

  let summary;
  try {
    summary = await runMlbModelForDate(DATE, { forceRerun: true });
  } catch (err) {
    console.error(`[RunMay31] FATAL ERROR in runMlbModelForDate:`, err);
    process.exit(1);
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n[RunMay31] ═══════════════════════════════════════════════════════`);
  console.log(`[RunMay31] [OUTPUT] MODEL RUN COMPLETE`);
  console.log(`  Date:      ${summary.date}`);
  console.log(`  Total:     ${summary.total}`);
  console.log(`  Written:   ${summary.written}`);
  console.log(`  Skipped:   ${summary.skipped}`);
  console.log(`  Errors:    ${summary.errors}`);
  console.log(`  Elapsed:   ${elapsedSec}s`);
  console.log(`[RunMay31] ═══════════════════════════════════════════════════════`);

  // Post-write validation gate
  console.log(`\n[RunMay31] [STEP] Running post-write validation gate...`);
  const validation = await validateMlbModelResults(DATE);

  console.log(`\n[RunMay31] ═══════════════════════════════════════════════════════`);
  console.log(`[RunMay31] [VERIFY] Validation: ${validation.passed ? "✅ PASSED" : "❌ FAILED"}`);
  if (validation.issues.length > 0) {
    console.log(`[RunMay31] ISSUES (${validation.issues.length}):`);
    for (const issue of validation.issues) {
      console.log(`  ❌ ${issue}`);
    }
  }
  if (validation.warnings.length > 0) {
    console.log(`[RunMay31] WARNINGS (${validation.warnings.length}):`);
    for (const warn of validation.warnings) {
      console.log(`  ⚠  ${warn}`);
    }
  }
  console.log(`[RunMay31] ═══════════════════════════════════════════════════════\n`);

  const exitCode = (summary.written === 15 && validation.passed) ? 0 : 1;
  if (exitCode !== 0) {
    console.error(`[RunMay31] ❌ INCOMPLETE: written=${summary.written}/15, validation.passed=${validation.passed}`);
  } else {
    console.log(`[RunMay31] ✅ SUCCESS: All 15 games modeled and validated.`);
  }
  process.exit(exitCode);
}

main().catch(err => { console.error("[RunMay31] FATAL:", err); process.exit(1); });
