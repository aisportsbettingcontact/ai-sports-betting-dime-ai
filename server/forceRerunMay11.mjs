/**
 * forceRerunMay11.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Force re-run of the MLB model for all 6 May 11, 2026 games using the
 * updated 2026 data (pitcher stats, team batting splits, park factors) and
 * all calibration fixes:
 *   - fg_ml_home_edge: +0.03 (MarketDerivation.derive())
 *   - FG ML Home threshold: 6% (mlbMultiMarketBacktest.ts)
 *   - FG RL sigmoid: k=0.4 (runFullHistoricalBacktest.mjs)
 *   - HR_CALIBRATION_FACTOR: 0.5317 (mlbHrPropsModelService.ts)
 *   - MIN_ABSOLUTE_P_HR: 0.18 (mlbHrPropsModelService.ts)
 *
 * Usage: node server/forceRerunMay11.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import * as dotenv from 'dotenv';
dotenv.config();

const TAG = '[ForceRerunMay11]';
const DATE = '2026-05-11';

console.log(`${TAG} [INPUT] date=${DATE} forceRerun=true`);
console.log(`${TAG} [STATE] Loading mlbModelRunner...`);

// Use tsx to run the TypeScript model runner
import { execSync } from 'child_process';

try {
  console.log(`${TAG} [STEP 1] Running MLB model for ${DATE} with forceRerun=true...`);
  const result = execSync(
    `cd /home/ubuntu/ai-sports-betting && npx tsx server/forceRerunMay11Runner.ts 2>&1`,
    { encoding: 'utf8', timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
  );
  console.log(result);
  console.log(`${TAG} [OUTPUT] Model run complete`);
} catch (err) {
  console.error(`${TAG} [ERROR] Model run failed:`, err.message);
  if (err.stdout) console.log(err.stdout);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
}
