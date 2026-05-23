/**
 * diagnose_missing_values.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deep diagnosis of missing SALARY/POS/TEAM/OPP/SCHEDULE_ID/SLATE values.
 *
 * Steps:
 *  1. Fetch the live RG CSV for today-pitchers (raw bytes)
 *  2. Print the raw CSV header row and first 3 data rows VERBATIM
 *  3. Run parseRgCsv on the same CSV text
 *  4. Print the parsed columns and first 3 row objects
 *  5. Cross-validate: for every column in the raw CSV, check if the parsed
 *     row has the same value — flag any mismatch or missing value
 *  6. Print a full column-by-column diff for row 0 (first player)
 *
 * Run: npx tsx scripts/diagnose_missing_values.ts
 */

import "dotenv/config";
import { PAGE_CONFIG, getRgSessionCookie, fetchRgCsv, parseRgCsv } from "../server/rotogrinderProxy";

// ── Inline CSV parser (same logic as parseRgCsv — used for raw comparison) ───
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const PAGE_KEYS = ["today-pitchers", "today-hitters", "tomorrow-pitchers", "tomorrow-hitters"];

async function diagnose(pageKey: string): Promise<void> {
  console.log(`\n${"═".repeat(80)}`);
  console.log(`[INPUT] pageKey=${pageKey}`);

  const pageConf = PAGE_CONFIG[pageKey];
  if (!pageConf) {
    console.error(`[VERIFY] FAIL — No PAGE_CONFIG entry for pageKey=${pageKey}`);
    return;
  }

  // ── Step 1: Fetch raw CSV ─────────────────────────────────────────────────
  console.log(`[STEP] Fetching RG session cookie...`);
  const cookie = await getRgSessionCookie();
  console.log(`[STATE] Cookie obtained (length=${cookie.length})`);

  console.log(`[STEP] Fetching CSV for csvId=${pageConf.csvId}...`);
  const csvText = await fetchRgCsv(pageConf.csvId, cookie);
  console.log(`[STATE] CSV fetched: ${csvText.length} bytes`);

  // ── Step 2: Parse raw CSV manually ───────────────────────────────────────
  const lines = csvText.trim().split("\n");
  console.log(`[STATE] CSV lines: ${lines.length} (including header)`);

  const rawHeaders = parseCsvLine(lines[0]);
  console.log(`[STATE] RAW CSV HEADERS (${rawHeaders.length}): [${rawHeaders.join(", ")}]`);

  // Print first 3 data rows verbatim
  for (let i = 1; i <= Math.min(3, lines.length - 1); i++) {
    const cells = parseCsvLine(lines[i]);
    const rowMap: Record<string, string> = {};
    rawHeaders.forEach((h, j) => { rowMap[h] = cells[j] ?? ""; });
    console.log(`[STATE] RAW row[${i}]: ${JSON.stringify(rowMap)}`);
  }

  // ── Step 3: Run parseRgCsv ────────────────────────────────────────────────
  console.log(`[STEP] Running parseRgCsv...`);
  const tableData = await parseRgCsv(csvText, pageKey, pageConf.title, pageConf.type);
  console.log(`[OUTPUT] parseRgCsv: columns=${tableData.columns.length} rows=${tableData.rows.length}`);
  console.log(`[STATE] PARSED COLUMNS: [${tableData.columns.join(", ")}]`);

  // Print first 3 parsed rows
  for (let i = 0; i < Math.min(3, tableData.rows.length); i++) {
    console.log(`[STATE] PARSED row[${i}]: ${JSON.stringify(tableData.rows[i])}`);
  }

  // ── Step 4: Column-by-column diff for row 0 ──────────────────────────────
  if (tableData.rows.length === 0) {
    console.log(`[VERIFY] SKIP — No parsed rows to diff`);
    return;
  }

  console.log(`\n[STEP] Column-by-column diff: RAW CSV row[1] vs PARSED row[0]`);
  console.log(`${"─".repeat(80)}`);

  const rawRow1Cells = parseCsvLine(lines[1]);
  const rawRow1: Record<string, string> = {};
  rawHeaders.forEach((h, j) => { rawRow1[h] = rawRow1Cells[j] ?? ""; });

  const parsedRow0 = tableData.rows[0];

  // Check every raw CSV column
  let mismatches = 0;
  let missing = 0;
  for (const rawCol of rawHeaders) {
    const normalizedCol = rawCol === "PLAYER" ? "NAME" : rawCol;
    const rawVal = rawRow1[rawCol] ?? "";
    const parsedVal = parsedRow0[normalizedCol] ?? parsedRow0[rawCol] ?? "";
    const match = rawVal === parsedVal;
    if (!match) {
      if (!parsedVal && rawVal) {
        console.log(`[VERIFY] MISSING — col="${rawCol}" rawVal="${rawVal}" parsedVal="${parsedVal}"`);
        missing++;
      } else {
        console.log(`[VERIFY] MISMATCH — col="${rawCol}" rawVal="${rawVal}" parsedVal="${parsedVal}"`);
        mismatches++;
      }
    }
  }

  // Check columns that are in parsed but not in raw (enriched columns)
  const rawColSet = new Set(rawHeaders.map(h => h === "PLAYER" ? "NAME" : h));
  const enrichedCols = tableData.columns.filter(c => !rawColSet.has(c));
  console.log(`[STATE] Enriched columns (not in raw CSV): [${enrichedCols.join(", ")}]`);

  console.log(`${"─".repeat(80)}`);
  console.log(
    `[VERIFY] ${mismatches === 0 && missing === 0 ? "PASS" : "FAIL"} — ` +
    `pageKey=${pageKey} mismatches=${mismatches} missing=${missing}`
  );

  // ── Step 5: Spot-check key columns across all rows ────────────────────────
  const KEY_COLS = ["SALARY", "POS", "TEAM", "OPP", "SCHEDULE_ID", "SLATE", "FPTS", "OWNERSHIP"];
  console.log(`\n[STEP] Key column population check across all ${tableData.rows.length} rows:`);
  for (const col of KEY_COLS) {
    if (!tableData.columns.includes(col)) {
      console.log(`[STATE] col="${col}" NOT IN COLUMNS — skipping`);
      continue;
    }
    const nonEmpty = tableData.rows.filter(r => r[col] && r[col].trim() !== "").length;
    const pct = ((nonEmpty / tableData.rows.length) * 100).toFixed(1);
    const status = nonEmpty === 0 ? "EMPTY" : nonEmpty < tableData.rows.length ? "PARTIAL" : "FULL";
    console.log(
      `[STATE] col="${col}" populated=${nonEmpty}/${tableData.rows.length} (${pct}%) status=${status}`
    );
    if (status !== "FULL") {
      // Show first 3 empty rows
      const emptyRows = tableData.rows.filter(r => !r[col] || r[col].trim() === "").slice(0, 3);
      for (const row of emptyRows) {
        console.log(`  [VERIFY] MISSING — NAME="${row["NAME"]}" PLAYERID="${row["PLAYERID"]}" col="${col}"="${row[col] ?? ""}"`);
      }
    }
  }
}

(async () => {
  try {
    for (const pageKey of PAGE_KEYS) {
      await diagnose(pageKey);
    }
    console.log(`\n${"═".repeat(80)}`);
    console.log(`[OUTPUT] Diagnosis complete for all ${PAGE_KEYS.length} pages`);
  } catch (err) {
    console.error("[VERIFY] FAIL — Unhandled error:", (err as Error).message);
    console.error((err as Error).stack);
    process.exit(1);
  }
})();
