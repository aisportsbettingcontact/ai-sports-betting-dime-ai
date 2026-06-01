/**
 * runJune1Model.ts
 * Run the full MLB model pipeline for June 1, 2026.
 * Forces rerun on all 9 games.
 * Deep logging: every step, every game, every validation gate.
 */
import { runMlbModelForDate, validateMlbModelResults } from "../server/mlbModelRunner.ts";

const DATE = "2026-06-01";
const EXPECTED_GAMES = 9;

async function main() {
  const startMs = Date.now();
  console.log(`\n[RunJune1] ═══════════════════════════════════════════════════════`);
  console.log(`[RunJune1] [INPUT]  date=${DATE}  forceRerun=true  expected=${EXPECTED_GAMES} games`);
  console.log(`[RunJune1] [STEP]   Invoking runMlbModelForDate...`);
  console.log(`[RunJune1] ═══════════════════════════════════════════════════════\n`);

  let summary: any;
  try {
    summary = await runMlbModelForDate(DATE, { forceRerun: true });
  } catch (err) {
    console.error(`[RunJune1] FATAL ERROR in runMlbModelForDate:`, err);
    process.exit(1);
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(`\n[RunJune1] ═══════════════════════════════════════════════════════`);
  console.log(`[RunJune1] [OUTPUT] MODEL RUN COMPLETE`);
  console.log(`  Date:      ${summary.date}`);
  console.log(`  Total:     ${summary.total}`);
  console.log(`  Written:   ${summary.written}`);
  console.log(`  Skipped:   ${summary.skipped}`);
  console.log(`  Errors:    ${summary.errors}`);
  console.log(`  Elapsed:   ${elapsedSec}s`);
  console.log(`[RunJune1] ═══════════════════════════════════════════════════════`);

  // Post-write validation gate
  console.log(`\n[RunJune1] [STEP] Running post-write validation gate...`);
  const validation = await validateMlbModelResults(DATE);

  console.log(`\n[RunJune1] ═══════════════════════════════════════════════════════`);
  console.log(`[RunJune1] [VERIFY] Validation: ${validation.passed ? "✅ PASSED" : "❌ FAILED"}`);
  if (validation.issues.length > 0) {
    console.log(`[RunJune1] ISSUES (${validation.issues.length}):`);
    for (const issue of validation.issues) console.log(`  ❌ ${issue}`);
  }
  if (validation.warnings.length > 0) {
    console.log(`[RunJune1] WARNINGS (${validation.warnings.length}):`);
    for (const warn of validation.warnings) console.log(`  ⚠  ${warn}`);
  }
  console.log(`[RunJune1] ═══════════════════════════════════════════════════════\n`);

  const success = summary.written === EXPECTED_GAMES && validation.passed;
  if (!success) {
    console.error(`[RunJune1] ❌ INCOMPLETE: written=${summary.written}/${EXPECTED_GAMES}, validation.passed=${validation.passed}`);
  } else {
    console.log(`[RunJune1] ✅ SUCCESS: All ${EXPECTED_GAMES} games modeled and validated.`);
  }
  process.exit(success ? 0 : 1);
}

main().catch(err => { console.error("[RunJune1] FATAL:", err); process.exit(1); });
