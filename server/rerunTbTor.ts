/**
 * rerunTbTor.ts
 * Force re-run the TB @ TOR (id=2250578) game through the full model pipeline.
 * Used to validate the RL sign inversion fix (awayBookSpread corrected from -1.5 to +1.5).
 */

import { runMlbModelForDate } from "./mlbModelRunner";

(async () => {
  console.log("[RERUN] Starting TB @ TOR force rerun (id=2250578)...");
  const result = await runMlbModelForDate("2026-05-11", {
    targetGameIds: [2250578],
    forceRerun: true,
  });
  console.log("[RERUN] Complete:", JSON.stringify(result, null, 2));
  process.exit(0);
})();
