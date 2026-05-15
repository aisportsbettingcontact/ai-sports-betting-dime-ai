/**
 * trigger_mlb_rerun.mjs
 * Directly invoke runMlbModelForDate for today to populate totalDiff/totalEdge.
 * Run: node scripts/trigger_mlb_rerun.mjs
 */
import dotenv from 'dotenv';
dotenv.config();

// Import the compiled runner via tsx
const { runMlbModelForDate } = await import('../server/mlbModelRunner.ts');

const today = new Date().toISOString().slice(0, 10);
console.log(`[TRIGGER] Running MLB model for ${today}...`);

try {
  const result = await runMlbModelForDate(today, { forceRerun: true });
  console.log(`[TRIGGER] ✅ Complete: written=${result.written} skipped=${result.skipped} errors=${result.errors}`);
} catch (err) {
  console.error(`[TRIGGER] ❌ Error:`, err);
  process.exit(1);
}
