/**
 * test_rg_proxy.mts — Live test of RotoGrinders auth + CSV fetch pipeline
 * Usage: npx tsx test_rg_proxy.mts
 */

import { getRgSessionCookie, fetchRgCsv, parseRgCsv, PAGE_CONFIG } from "./server/rotogrinderProxy.js";

const TAB_KEYS = ["today-pitchers", "today-hitters", "tomorrow-pitchers", "tomorrow-hitters"] as const;

console.log("=".repeat(70));
console.log("[TEST][INPUT] RotoGrinders proxy live test — May 21, 2026");
console.log("[TEST][STATE] PAGE_CONFIG keys:", Object.keys(PAGE_CONFIG).join(", "));
console.log("=".repeat(70));

// Step 1: Auth
let cookie: string;
try {
  console.log("\n[TEST][STEP] Fetching RG session cookie...");
  cookie = await getRgSessionCookie();
  const preview = cookie ? cookie.substring(0, 80) + "..." : "EMPTY";
  console.log("[TEST][STATE] Cookie obtained:", preview);
  console.log("[TEST][VERIFY] PASS — auth succeeded");
} catch (e) {
  console.error("[TEST][VERIFY] FAIL — auth error:", (e as Error).message);
  process.exit(1);
}

// Step 2: Fetch all 4 CSVs
for (const key of TAB_KEYS) {
  const conf = PAGE_CONFIG[key];
  if (!conf) {
    console.error(`[TEST][VERIFY] FAIL — no PAGE_CONFIG entry for key="${key}"`);
    continue;
  }
  console.log(`\n[TEST][STEP] Fetching CSV for tab="${key}" csvId=${conf.csvId}...`);
  const t0 = Date.now();
  try {
    const csv = await fetchRgCsv(conf.csvId, cookie);
    const elapsed = Date.now() - t0;
    if (!csv || !csv.trim()) {
      console.warn(`[TEST][STATE] tab="${key}" — CSV is EMPTY (projections not yet published)`);
      continue;
    }
    const lines = csv.split("\n");
    console.log(`[TEST][OUTPUT] tab="${key}" bytes=${csv.length} lines=${lines.length} elapsed=${elapsed}ms`);
    console.log(`[TEST][OUTPUT] Headers: ${lines[0].substring(0, 120)}`);
    console.log(`[TEST][OUTPUT] Row 1:   ${lines[1]?.substring(0, 120)}`);

    // Step 3: Parse
    console.log(`[TEST][STEP] Parsing CSV for tab="${key}"...`);
    const parsed = await parseRgCsv(csv, key, conf.title, conf.type);
    console.log(`[TEST][OUTPUT] Parsed: rows=${parsed.rows.length} cols=${parsed.columns.length} updatedAt="${parsed.updatedAt}"`);
    const resolvedMlb = parsed.rows.filter(r => r["MLB_ID"] && r["MLB_ID"] !== "").length;
    console.log(`[TEST][OUTPUT] MLB_ID resolved: ${resolvedMlb}/${parsed.rows.length} players`);
    if (parsed.rows.length > 0) {
      const sample = parsed.rows[0];
      console.log(`[TEST][OUTPUT] Sample row[0]: NAME="${sample["NAME"]}" TEAM="${sample["TEAM"] ?? sample["TM"]}" FPTS="${sample["FPTS"]}" MLB_ID="${sample["MLB_ID"]}"`);
    }
    console.log(`[TEST][VERIFY] PASS — tab="${key}" fully parsed`);
  } catch (e) {
    console.error(`[TEST][VERIFY] FAIL — tab="${key}" error:`, (e as Error).message);
  }
}

console.log("\n" + "=".repeat(70));
console.log("[TEST][OUTPUT] RotoGrinders proxy test complete");
console.log("=".repeat(70));
