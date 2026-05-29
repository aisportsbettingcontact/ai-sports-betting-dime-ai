/**
 * run_mlb_model_may29_v2.ts
 * Force-rerun MLB model for all 15 May 29, 2026 games after RL invariant fix.
 * Validates: P(cover -1.5) < P(win outright) for every game.
 */
import { runMlbModelForDate } from "../server/mlbModelRunner";

const TAG = "[MAY29-RERUN-V2]";
const DATE = "2026-05-29";

async function main() {
  console.log(`${TAG} ============================================================`);
  console.log(`${TAG} [INPUT]  date=${DATE} forceRerun=true`);
  console.log(`${TAG} [STEP]   Running MLB model with RL invariant fix applied`);
  console.log(`${TAG} [STATE]  Fix: MLBAIModel.py lines 1742-1793 — FINAL RL INVARIANT ENFORCEMENT`);
  console.log(`${TAG} [STATE]  Invariant: P(fav covers -1.5) < P(fav wins outright) — unconditional`);
  console.log(`${TAG} ============================================================`);

  const t0 = Date.now();
  
  try {
    const result = await runMlbModelForDate(DATE, { forceRerun: true });
    
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    
    console.log(`\n${TAG} ============================================================`);
    console.log(`${TAG} [OUTPUT] Model run complete in ${elapsed}s`);
    console.log(`${TAG} [OUTPUT] written=${result.written} errors=${result.errors} skipped=${result.skipped}`);
    console.log(`${TAG} [OUTPUT] invalidated=${result.invalidated ?? 0}`);
    
    if (result.errors > 0) {
      console.error(`${TAG} [VERIFY] ❌ ERRORS DETECTED: ${result.errors} games failed`);
    } else {
      console.log(`${TAG} [VERIFY] ✅ All ${result.written} games written successfully`);
    }
    
    if (result.written !== 15) {
      console.error(`${TAG} [VERIFY] ❌ Expected 15 games written, got ${result.written}`);
    } else {
      console.log(`${TAG} [VERIFY] ✅ 15/15 games written`);
    }
    
    console.log(`${TAG} ============================================================`);
    
  } catch (err) {
    console.error(`${TAG} [ERROR] Fatal error:`, err);
    process.exit(1);
  }
  
  process.exit(0);
}

main();
