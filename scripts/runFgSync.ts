/**
 * runFgSync.ts
 * One-shot runner: deletes stale tabs, populates today + tomorrow lineup tabs.
 * Execute with: npx tsx scripts/runFgSync.ts
 */
import { syncFangraphsLineupTabs } from "../server/fangraphsLineupSync";

async function main() {
  console.log("[RunFgSync] Starting immediate Fangraphs lineup sync...");
  const result = await syncFangraphsLineupTabs();
  console.log("\n[RunFgSync] ─── FINAL RESULT ───────────────────────────────────");
  console.log(`  success:          ${result.success}`);
  console.log(`  syncedAt:         ${result.syncedAt}`);
  console.log(`  totalRowsWritten: ${result.totalRowsWritten}`);
  console.log(`  elapsedMs:        ${result.elapsedMs}`);
  console.log(`  todayTab:         ${result.todayTab.tabName} | status=${result.todayTab.status} | rows=${result.todayTab.rowsWritten} | readBack=${result.todayTab.readBackRowCount} | validated=${result.todayTab.readBackValidated}`);
  console.log(`  tomorrowTab:      ${result.tomorrowTab.tabName} | status=${result.tomorrowTab.status} | rows=${result.tomorrowTab.rowsWritten} | readBack=${result.tomorrowTab.readBackRowCount} | validated=${result.tomorrowTab.readBackValidated}`);
  if (result.errors.length > 0) {
    console.log(`  errors:           ${result.errors.join(" | ")}`);
  }
  console.log("[RunFgSync] ─────────────────────────────────────────────────────\n");
  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error("[RunFgSync] FATAL:", err);
  process.exit(1);
});
