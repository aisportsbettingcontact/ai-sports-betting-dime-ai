/**
 * testRotoSync.mts
 * Run: npx tsx scripts/testRotoSync.mts
 * Runs syncRotowireLineupTabs() and prints full structured output.
 */
import { syncRotowireLineupTabs } from "../server/rotowireLineupSheetSync.js";

console.log("[TEST] ============================================================");
console.log("[TEST] Starting syncRotowireLineupTabs() test run");
console.log("[TEST] ============================================================\n");

const result = await syncRotowireLineupTabs();

console.log("\n[TEST] ============================================================");
console.log("[TEST] FINAL RESULT:");
console.log("[TEST] success:", result.success);
console.log("[TEST] syncedAt:", result.syncedAt);
console.log("[TEST] totalRowsWritten:", result.totalRowsWritten);
console.log("[TEST] elapsedMs:", result.elapsedMs);
console.log("[TEST] errors:", JSON.stringify(result.errors));
console.log("[TEST] todayTab:", JSON.stringify(result.todayTab));
console.log("[TEST] tomorrowTab:", JSON.stringify(result.tomorrowTab));
console.log("[TEST] ============================================================");
