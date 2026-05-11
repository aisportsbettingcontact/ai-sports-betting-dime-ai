/**
 * forceRerunMay11Runner.ts
 * Force re-run of the MLB model for May 11, 2026 using updated 2026 data.
 * Run with: npx tsx server/forceRerunMay11Runner.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { runMlbModelForDate } from "./mlbModelRunner";

const TAG = "[ForceRerunMay11]";
const DATE = "2026-05-11";

async function main() {
  console.log(`\n${TAG} ============================================================`);
  console.log(`${TAG} [INPUT] date=${DATE} forceRerun=true`);
  console.log(`${TAG} [STATE] Calibration state:`);
  console.log(`${TAG}   fg_ml_home_edge: +0.03 (MarketDerivation.derive())`);
  console.log(`${TAG}   FG ML Home threshold: 6% (mlbMultiMarketBacktest.ts)`);
  console.log(`${TAG}   FG RL sigmoid k: 0.4 (runFullHistoricalBacktest.mjs)`);
  console.log(`${TAG}   HR_CALIBRATION_FACTOR: 0.5317 (mlbHrPropsModelService.ts)`);
  console.log(`${TAG}   MIN_ABSOLUTE_P_HR: 0.18 (mlbHrPropsModelService.ts)`);
  console.log(`${TAG}   Data: 2026 pitcher stats, team batting splits, park factors`);
  console.log(`${TAG} ============================================================\n`);

  const startMs = Date.now();

  try {
    const result = await runMlbModelForDate(DATE, { forceRerun: true });
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    console.log(`\n${TAG} ============================================================`);
    console.log(`${TAG} [OUTPUT] Model run complete in ${elapsed}s`);
    console.log(`${TAG} [RESULT] written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
    console.log(`${TAG} [VERIFY] ${result.errors === 0 ? 'PASS' : 'WARN — check errors above'}`);
    console.log(`${TAG} ============================================================\n`);

    if (result.written === 0 && result.skipped > 0) {
      console.log(`${TAG} [WARN] All games skipped — check pitcher assignments and book lines`);
    }
  } catch (err) {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.error(`${TAG} [FATAL] Model run failed after ${elapsed}s:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
