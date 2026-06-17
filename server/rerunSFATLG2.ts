/**
 * Force-rerun SF@ATL Game 2 (id=2251041) with correct pitchers:
 * Away: Robbie Ray (SF), Home: JR Ritchie (ATL)
 * Run: npx tsx server/rerunSFATLG2.ts
 */
import { runMlbModelForDate } from "./mlbModelRunner";

const TAG = "[RerunSFATLG2]";

async function main() {
  console.log(`${TAG} Force-rerunning SF@ATL G2 id=2251041 with Robbie Ray vs JR Ritchie`);

  const summary = await runMlbModelForDate("2026-06-17", {
    forceRerun: true,
    targetGameIds: [2251041],
  });

  console.log(`\n${TAG} COMPLETE`);
  console.log(`${TAG} Total: ${summary.total} | Written: ${summary.written} | Errors: ${summary.errors}`);
  console.log(`${TAG} Validation: ${summary.validation.passed ? "PASS" : "FAIL"}`);

  if (summary.validation.issues?.length) {
    for (const issue of summary.validation.issues) {
      console.error(`  ISSUE: ${issue}`);
    }
  }

  if (summary.written === 1) {
    console.log(`${TAG} [PASS] SF@ATL G2 re-modeled with correct pitchers`);
    process.exit(0);
  } else {
    console.error(`${TAG} [FAIL] Expected 1 game written, got ${summary.written}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${TAG} [FATAL]`, err);
  process.exit(1);
});
