/**
 * Force-rerun the MLB model for all 15 June 17, 2026 games.
 * Uses the existing runMlbModelForDate with forceRerun=true.
 * This ensures all 60+ DB columns are populated by the full Python engine.
 *
 * Run: npx tsx server/forceRerunJune17.ts
 */
import { runMlbModelForDate } from "./mlbModelRunner";

const TAG = "[ForceRerunJune17]";

async function main() {
  const dateStr = "2026-06-17";

  console.log(`${TAG} Starting force-rerun for ${dateStr}...`);
  console.log(`${TAG} forceRerun=true — all games will be re-modeled regardless of modelRunAt`);

  try {
    const summary = await runMlbModelForDate(dateStr, { forceRerun: true });

    console.log(`\n${TAG} ══════════════════════════════════════════════`);
    console.log(`${TAG} COMPLETE`);
    console.log(`${TAG} Date:           ${summary.date}`);
    console.log(`${TAG} Total games:    ${summary.total}`);
    console.log(`${TAG} Written to DB:  ${summary.written}`);
    console.log(`${TAG} Skipped:        ${summary.skipped}`);
    console.log(`${TAG} Errors:         ${summary.errors}`);
    console.log(`${TAG} Validation:     ${summary.validation.passed ? 'PASS' : 'FAIL'}`);

    if (summary.validation.issues && summary.validation.issues.length > 0) {
      console.error(`${TAG} ISSUES:`);
      for (const issue of summary.validation.issues) {
        console.error(`  - ${issue}`);
      }
    }
    if (summary.validation.warnings && summary.validation.warnings.length > 0) {
      console.warn(`${TAG} WARNINGS:`);
      for (const w of summary.validation.warnings) {
        console.warn(`  - ${w}`);
      }
    }

    if (summary.written === 0) {
      console.error(`${TAG} [FAIL] No games were successfully written to DB`);
      process.exit(1);
    }

    console.log(`${TAG} [PASS] ${summary.written}/${summary.total} games modeled and published to DB`);
    process.exit(0);
  } catch (err) {
    console.error(`${TAG} [FATAL] Unhandled error:`, err);
    process.exit(1);
  }
}

main();
