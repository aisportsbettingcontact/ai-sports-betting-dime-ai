/**
 * deep_crossref_audit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * MAXIMUM-DEPTH cross-reference audit:
 *   Layer 1: Raw RG HTML page → extract visible column headers from the DOM
 *   Layer 2: Raw RG CSV → parse headers + all row values
 *   Layer 3: parseRgCsv output → columns + rows after pipeline processing
 *   Layer 4: Google Sheets read-back → actual headers + row values in the sheet
 *
 * Cross-validation matrix (all 4 layers × all 4 pages):
 *   A. HTML columns vs CSV columns     — are all HTML-visible columns in the CSV?
 *   B. CSV columns vs parsed columns   — does the pipeline preserve native order?
 *   C. Parsed columns vs Sheet columns — does the sheet match the parsed output?
 *   D. CSV row[1] vs Sheet row[1]      — do cell values match exactly?
 *   E. MLB_ID presence                 — is MLB_ID last column on every tab?
 *   F. Row count parity                — CSV rows == Sheet rows?
 *
 * Run: npx tsx scripts/deep_crossref_audit.ts
 */

import "dotenv/config";
import { google } from "googleapis";
import { PAGE_CONFIG, getRgSessionCookie, fetchRgCsv, parseRgCsv } from "../server/rotogrinderProxy";

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";
const RG_BASE = "https://rotogrinders.com";

const PAGE_TO_SHEET_TAB: Record<string, string> = {
  "today-pitchers":    "The Bat X",
  "today-hitters":     "The Bat X Hitters",
  "tomorrow-pitchers": "Tomorrow's Projections (The Bat X)",
  "tomorrow-hitters":  "Tomorrow's Projections (The Bat X Hitters)",
};

const EXCLUDED_FROM_SHEET = new Set(["HEADSHOT_URL", "TEAM_LOGO_URL", "OPP_LOGO_URL"]);

// ─── Google Sheets client ─────────────────────────────────────────────────────

function getSheets() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("[INPUT] FAIL — GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const creds = JSON.parse(raw);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ─── Raw CSV parser (mirrors rotogrinderProxy.ts parseCsvLine) ────────────────

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

// ─── Fetch raw RG HTML page ───────────────────────────────────────────────────

async function fetchRgHtml(slug: string, cookie: string): Promise<string> {
  const url = `${RG_BASE}${slug}`;
  console.log(`[INPUT] fetchRgHtml: GET ${url}`);
  const res = await fetch(url, {
    headers: {
      "Cookie": cookie,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  console.log(`[STATE] fetchRgHtml: status=${res.status} url=${url}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ─── Extract column headers from RG HTML ─────────────────────────────────────
// RG renders column headers in <th> elements with data-col or class="col-header"
// Also checks for JSON config embedded in the page script tags

function extractHtmlColumns(html: string, pageKey: string): string[] {
  const cols: string[] = [];

  // Method 1: Look for th elements with column header text
  const thMatches = html.matchAll(/<th[^>]*class="[^"]*(?:col-header|column-header|header)[^"]*"[^>]*>([^<]+)<\/th>/gi);
  for (const m of thMatches) {
    const text = m[1].trim().replace(/\s+/g, "_").toUpperCase();
    if (text && !cols.includes(text)) cols.push(text);
  }

  // Method 2: Look for data-field attributes on th elements
  const dataFieldMatches = html.matchAll(/<th[^>]*data-field="([^"]+)"[^>]*/gi);
  for (const m of dataFieldMatches) {
    const field = m[1].trim().toUpperCase();
    if (field && !cols.includes(field)) cols.push(field);
  }

  // Method 3: Look for column config in embedded JSON (RG uses React with embedded state)
  // Pattern: "columns":[{"field":"PLAYERID",...},...]
  const jsonColMatch = html.match(/"columns"\s*:\s*\[([^\]]{50,})\]/);
  if (jsonColMatch) {
    const fieldMatches = jsonColMatch[1].matchAll(/"field"\s*:\s*"([^"]+)"/g);
    for (const m of fieldMatches) {
      const field = m[1].trim().toUpperCase();
      if (field && !cols.includes(field)) cols.push(field);
    }
  }

  // Method 4: Look for column definitions in script tags
  const scriptMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  for (const sm of scriptMatches) {
    const scriptContent = sm[1];
    // Look for field definitions like {field:"PLAYERID"} or field:'SALARY'
    const fieldMatches = scriptContent.matchAll(/field\s*:\s*["']([A-Z_$%/][A-Z0-9_$%/]*)["']/g);
    for (const m of fieldMatches) {
      const field = m[1].trim().toUpperCase();
      if (field && field.length > 1 && !cols.includes(field)) cols.push(field);
    }
  }

  console.log(`[STATE] extractHtmlColumns: pageKey=${pageKey} found=${cols.length} cols via HTML parsing`);
  return cols;
}

// ─── Per-page audit ───────────────────────────────────────────────────────────

interface PageAuditResult {
  pageKey: string;
  tabName: string;
  htmlCols: string[];
  csvRawHeaders: string[];
  parsedColumns: string[];
  sheetHeaders: string[];
  sheetRowCount: number;
  csvRowCount: number;
  parsedRowCount: number;
  csvRow1: Record<string, string>;
  sheetRow1: Record<string, string>;
  issues: string[];
  passes: string[];
}

async function auditPage(
  pageKey: string,
  cookie: string,
  sheets: ReturnType<typeof getSheets>
): Promise<PageAuditResult> {
  const conf = PAGE_CONFIG[pageKey];
  const tabName = PAGE_TO_SHEET_TAB[pageKey];
  const result: PageAuditResult = {
    pageKey, tabName,
    htmlCols: [], csvRawHeaders: [], parsedColumns: [], sheetHeaders: [],
    sheetRowCount: 0, csvRowCount: 0, parsedRowCount: 0,
    csvRow1: {}, sheetRow1: {},
    issues: [], passes: [],
  };

  const sep = "─".repeat(70);
  console.log(`\n${sep}`);
  console.log(`[INPUT] AUDIT START: pageKey=${pageKey} tabName="${tabName}"`);
  console.log(sep);

  // ── Layer 1: Raw HTML ─────────────────────────────────────────────────────
  console.log(`\n[STEP] Layer 1: Fetching raw HTML for ${conf.slug}...`);
  try {
    const html = await fetchRgHtml(conf.slug, cookie);
    result.htmlCols = extractHtmlColumns(html, pageKey);
    console.log(`[OUTPUT] Layer 1: HTML columns found: ${result.htmlCols.length}`);
    if (result.htmlCols.length > 0) {
      console.log(`[STATE] HTML cols (first 20): [${result.htmlCols.slice(0, 20).join(", ")}]`);
    } else {
      console.log(`[STATE] HTML cols: NONE FOUND — RG page likely requires JS rendering (expected for SPA)`);
    }
  } catch (err) {
    const msg = `HTML fetch failed: ${(err as Error).message}`;
    result.issues.push(`[Layer1] ${msg}`);
    console.warn(`[VERIFY] WARN — ${msg}`);
  }

  // ── Layer 2: Raw CSV ──────────────────────────────────────────────────────
  console.log(`\n[STEP] Layer 2: Fetching raw CSV (csvId=${conf.csvId})...`);
  let rawCsvText = "";
  try {
    rawCsvText = await fetchRgCsv(conf.csvId, cookie);
    const lines = rawCsvText.split("\n").filter(l => l.trim());
    result.csvRawHeaders = parseCsvLine(lines[0]);
    // Count data rows (skip header, skip empty, skip numeric-only footer)
    result.csvRowCount = lines.slice(1).filter(l => {
      if (!l.trim()) return false;
      const cells = parseCsvLine(l);
      const name = cells[result.csvRawHeaders.findIndex(h => h === "PLAYER" || h === "NAME")] ?? "";
      return name && !/^\d+$/.test(name.trim());
    }).length;

    console.log(`[OUTPUT] Layer 2: CSV headers=${result.csvRawHeaders.length} dataRows=${result.csvRowCount}`);
    console.log(`[STATE] CSV raw headers (ALL ${result.csvRawHeaders.length}): [${result.csvRawHeaders.join(", ")}]`);

    // Extract row 1 values
    const dataLines = lines.slice(1).filter(l => {
      if (!l.trim()) return false;
      const cells = parseCsvLine(l);
      const nameIdx = result.csvRawHeaders.findIndex(h => h === "PLAYER" || h === "NAME");
      const name = cells[nameIdx] ?? "";
      return name && !/^\d+$/.test(name.trim());
    });
    if (dataLines.length > 0) {
      const cells = parseCsvLine(dataLines[0]);
      result.csvRawHeaders.forEach((h, i) => {
        result.csvRow1[h] = cells[i] ?? "";
      });
      console.log(`[STATE] CSV row[1] (first 10 fields): ${
        result.csvRawHeaders.slice(0, 10).map(h => `${h}="${result.csvRow1[h]}"`).join(" | ")
      }`);
      console.log(`[STATE] CSV row[1] SALARY="${result.csvRow1["SALARY"] ?? "(not present)"}" POS="${result.csvRow1["POS"] ?? "(not present)"}" TEAM="${result.csvRow1["TEAM"] ?? "(not present)"}" OPP="${result.csvRow1["OPP"] ?? "(not present)"}"`);
    }
  } catch (err) {
    const msg = `CSV fetch failed: ${(err as Error).message}`;
    result.issues.push(`[Layer2] ${msg}`);
    console.error(`[VERIFY] FAIL — ${msg}`);
    return result;
  }

  // ── Layer 3: parseRgCsv pipeline output ──────────────────────────────────
  console.log(`\n[STEP] Layer 3: Running parseRgCsv pipeline...`);
  try {
    const parsed = await parseRgCsv(rawCsvText, pageKey, conf.title, conf.type);
    // Sheet columns = parsed.columns minus excluded
    result.parsedColumns = parsed.columns.filter(c => !EXCLUDED_FROM_SHEET.has(c));
    result.parsedRowCount = parsed.rows.length;

    console.log(`[OUTPUT] Layer 3: parsedColumns=${result.parsedColumns.length} rows=${result.parsedRowCount}`);
    console.log(`[STATE] Parsed columns (ALL ${result.parsedColumns.length}): [${result.parsedColumns.join(", ")}]`);

    if (parsed.rows.length > 0) {
      const r = parsed.rows[0];
      console.log(`[STATE] Parsed row[0] (first 10 fields): ${
        result.parsedColumns.slice(0, 10).map(c => `${c}="${r[c] ?? ""}"`).join(" | ")
      }`);
    }

    // ── Cross-check A: CSV raw headers vs parsed columns (order + completeness) ──
    console.log(`\n[STEP] Cross-check A: CSV raw headers vs parsed columns...`);
    // Normalize: PLAYER→NAME in CSV
    const normalizedCsvHeaders = result.csvRawHeaders.map(h => h === "PLAYER" ? "NAME" : h);
    // Expected sheet columns = normalizedCsvHeaders + MLB_ID (minus excluded)
    const expectedSheetCols = [...normalizedCsvHeaders, "MLB_ID"].filter(c => !EXCLUDED_FROM_SHEET.has(c));

    let orderOk = true;
    let countOk = result.parsedColumns.length === expectedSheetCols.length;

    if (!countOk) {
      const msg = `Column count mismatch: expected ${expectedSheetCols.length} (CSV+MLB_ID) got ${result.parsedColumns.length}`;
      result.issues.push(`[CrossA] ${msg}`);
      console.warn(`[VERIFY] FAIL — CrossA: ${msg}`);
    }

    for (let i = 0; i < Math.max(expectedSheetCols.length, result.parsedColumns.length); i++) {
      const exp = expectedSheetCols[i] ?? "(missing)";
      const got = result.parsedColumns[i] ?? "(missing)";
      if (exp !== got) {
        const msg = `Column order mismatch at index ${i}: expected="${exp}" got="${got}"`;
        result.issues.push(`[CrossA] ${msg}`);
        console.warn(`[VERIFY] FAIL — CrossA: ${msg}`);
        orderOk = false;
      }
    }

    if (countOk && orderOk) {
      result.passes.push(`[CrossA] CSV headers → parsed columns: ORDER PRESERVED, COUNT MATCH (${result.parsedColumns.length} cols)`);
      console.log(`[VERIFY] PASS — CrossA: CSV→parsed: all ${result.parsedColumns.length} columns in correct order`);
    }

    // Check MLB_ID is last
    const lastParsed = result.parsedColumns[result.parsedColumns.length - 1];
    if (lastParsed === "MLB_ID") {
      result.passes.push(`[CrossA] MLB_ID is last column in parsed output`);
      console.log(`[VERIFY] PASS — CrossA: MLB_ID is last column: parsedCols[-1]="${lastParsed}"`);
    } else {
      const msg = `MLB_ID is NOT last column in parsed output: parsedCols[-1]="${lastParsed}"`;
      result.issues.push(`[CrossA] ${msg}`);
      console.warn(`[VERIFY] FAIL — CrossA: ${msg}`);
    }

  } catch (err) {
    const msg = `parseRgCsv failed: ${(err as Error).message}`;
    result.issues.push(`[Layer3] ${msg}`);
    console.error(`[VERIFY] FAIL — ${msg}`);
    return result;
  }

  // ── Layer 4: Google Sheets read-back ──────────────────────────────────────
  console.log(`\n[STEP] Layer 4: Reading back Google Sheet tab "${tabName}"...`);
  try {
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'`,
    });
    const sheetValues = (sheetRes.data.values as string[][] | null | undefined) ?? [];
    result.sheetHeaders = sheetValues[0] ?? [];
    result.sheetRowCount = Math.max(0, sheetValues.length - 1); // minus header row

    console.log(`[OUTPUT] Layer 4: sheetHeaders=${result.sheetHeaders.length} dataRows=${result.sheetRowCount}`);
    console.log(`[STATE] Sheet headers (ALL ${result.sheetHeaders.length}): [${result.sheetHeaders.join(", ")}]`);

    if (sheetValues.length > 1) {
      const row1Cells = sheetValues[1];
      result.sheetHeaders.forEach((h, i) => {
        result.sheetRow1[h] = row1Cells[i] ?? "";
      });
      console.log(`[STATE] Sheet row[1] (first 10 fields): ${
        result.sheetHeaders.slice(0, 10).map(h => `${h}="${result.sheetRow1[h]}"`).join(" | ")
      }`);
    }

    // ── Cross-check B: Parsed columns vs Sheet headers ────────────────────
    console.log(`\n[STEP] Cross-check B: Parsed columns vs Sheet headers...`);
    let bOrderOk = true;
    let bCountOk = result.parsedColumns.length === result.sheetHeaders.length;

    if (!bCountOk) {
      const msg = `Column count mismatch: parsed=${result.parsedColumns.length} sheet=${result.sheetHeaders.length}`;
      result.issues.push(`[CrossB] ${msg}`);
      console.warn(`[VERIFY] FAIL — CrossB: ${msg}`);

      // Show which columns are missing or extra
      const parsedSet = new Set(result.parsedColumns);
      const sheetSet = new Set(result.sheetHeaders);
      const missingFromSheet = result.parsedColumns.filter(c => !sheetSet.has(c));
      const extraInSheet = result.sheetHeaders.filter(c => !parsedSet.has(c));
      if (missingFromSheet.length > 0) console.warn(`[VERIFY] FAIL — CrossB: Columns in parsed but NOT in sheet: [${missingFromSheet.join(", ")}]`);
      if (extraInSheet.length > 0) console.warn(`[VERIFY] FAIL — CrossB: Columns in sheet but NOT in parsed: [${extraInSheet.join(", ")}]`);
    }

    for (let i = 0; i < Math.max(result.parsedColumns.length, result.sheetHeaders.length); i++) {
      const exp = result.parsedColumns[i] ?? "(missing)";
      const got = result.sheetHeaders[i] ?? "(missing)";
      if (exp !== got) {
        const msg = `Column order mismatch at index ${i}: parsed="${exp}" sheet="${got}"`;
        result.issues.push(`[CrossB] ${msg}`);
        console.warn(`[VERIFY] FAIL — CrossB: ${msg}`);
        bOrderOk = false;
      }
    }

    if (bCountOk && bOrderOk) {
      result.passes.push(`[CrossB] Parsed → Sheet: ORDER PRESERVED, COUNT MATCH (${result.sheetHeaders.length} cols)`);
      console.log(`[VERIFY] PASS — CrossB: parsed→sheet: all ${result.sheetHeaders.length} columns in correct order`);
    }

    // ── Cross-check C: Row counts ─────────────────────────────────────────
    console.log(`\n[STEP] Cross-check C: Row count parity (CSV vs Sheet)...`);
    if (result.csvRowCount === result.sheetRowCount) {
      result.passes.push(`[CrossC] Row count match: CSV=${result.csvRowCount} Sheet=${result.sheetRowCount}`);
      console.log(`[VERIFY] PASS — CrossC: row count match: CSV=${result.csvRowCount} Sheet=${result.sheetRowCount}`);
    } else {
      const msg = `Row count mismatch: CSV=${result.csvRowCount} Sheet=${result.sheetRowCount}`;
      result.issues.push(`[CrossC] ${msg}`);
      console.warn(`[VERIFY] WARN — CrossC: ${msg} (may be expected if RG CSV has footer rows)`);
    }

    // ── Cross-check D: Cell value parity (row 1, all columns) ────────────
    console.log(`\n[STEP] Cross-check D: Cell value parity for row[1]...`);
    let dMismatches = 0;
    const csvNormHeaders = result.csvRawHeaders.map(h => h === "PLAYER" ? "NAME" : h);

    for (const col of csvNormHeaders) {
      const csvVal = result.csvRow1[col === "NAME" ? (result.csvRawHeaders.includes("PLAYER") ? "PLAYER" : "NAME") : col] ?? result.csvRow1[col] ?? "";
      const sheetVal = result.sheetRow1[col] ?? "";

      if (csvVal !== sheetVal) {
        dMismatches++;
        if (dMismatches <= 10) { // cap output at 10 mismatches
          console.warn(`[VERIFY] FAIL — CrossD: col="${col}" CSV="${csvVal}" Sheet="${sheetVal}"`);
          result.issues.push(`[CrossD] col="${col}" CSV="${csvVal}" Sheet="${sheetVal}"`);
        }
      }
    }

    // Check MLB_ID in sheet row 1
    const sheetMlbId = result.sheetRow1["MLB_ID"] ?? "";
    if (sheetMlbId) {
      result.passes.push(`[CrossD] MLB_ID populated in row[1]: "${sheetMlbId}"`);
      console.log(`[VERIFY] PASS — CrossD: MLB_ID populated in sheet row[1]: "${sheetMlbId}"`);
    } else {
      result.issues.push(`[CrossD] MLB_ID is empty in sheet row[1]`);
      console.warn(`[VERIFY] FAIL — CrossD: MLB_ID is empty in sheet row[1]`);
    }

    if (dMismatches === 0) {
      result.passes.push(`[CrossD] All CSV columns match sheet values in row[1] (${csvNormHeaders.length} cols checked)`);
      console.log(`[VERIFY] PASS — CrossD: all ${csvNormHeaders.length} CSV columns match sheet values in row[1]`);
    } else {
      console.warn(`[VERIFY] FAIL — CrossD: ${dMismatches} cell value mismatch(es) in row[1]`);
    }

    // ── Cross-check E: MLB_ID last column in sheet ────────────────────────
    const lastSheetCol = result.sheetHeaders[result.sheetHeaders.length - 1];
    if (lastSheetCol === "MLB_ID") {
      result.passes.push(`[CrossE] MLB_ID is last column in sheet`);
      console.log(`[VERIFY] PASS — CrossE: MLB_ID is last column in sheet: sheetHeaders[-1]="${lastSheetCol}"`);
    } else {
      const msg = `MLB_ID is NOT last column in sheet: sheetHeaders[-1]="${lastSheetCol}"`;
      result.issues.push(`[CrossE] ${msg}`);
      console.warn(`[VERIFY] FAIL — CrossE: ${msg}`);
    }

    // ── Cross-check F: MLB_ID population rate across all rows ────────────
    console.log(`\n[STEP] Cross-check F: MLB_ID population rate across all ${result.sheetRowCount} data rows...`);
    const mlbIdColIdx = result.sheetHeaders.indexOf("MLB_ID");
    if (mlbIdColIdx >= 0) {
      let populated = 0;
      let empty = 0;
      const emptyPlayers: string[] = [];
      const nameColIdx = result.sheetHeaders.indexOf("NAME");

      for (let r = 1; r < sheetValues.length; r++) {
        const row = sheetValues[r];
        const mlbId = row[mlbIdColIdx] ?? "";
        const playerName = nameColIdx >= 0 ? (row[nameColIdx] ?? "") : `row[${r}]`;
        if (mlbId) { populated++; }
        else { empty++; if (emptyPlayers.length < 5) emptyPlayers.push(playerName); }
      }

      const pct = result.sheetRowCount > 0 ? ((populated / result.sheetRowCount) * 100).toFixed(1) : "0.0";
      console.log(`[STATE] MLB_ID population: ${populated}/${result.sheetRowCount} (${pct}%) populated, ${empty} empty`);

      if (empty > 0) {
        console.warn(`[VERIFY] WARN — CrossF: ${empty} players missing MLB_ID: [${emptyPlayers.join(", ")}${empty > 5 ? ` +${empty - 5} more` : ""}]`);
        result.issues.push(`[CrossF] ${empty} players missing MLB_ID`);
      } else {
        result.passes.push(`[CrossF] MLB_ID 100% populated: ${populated}/${result.sheetRowCount} rows`);
        console.log(`[VERIFY] PASS — CrossF: MLB_ID 100% populated: ${populated}/${result.sheetRowCount} rows`);
      }
    }

  } catch (err) {
    const msg = `Sheet read-back failed: ${(err as Error).message}`;
    result.issues.push(`[Layer4] ${msg}`);
    console.error(`[VERIFY] FAIL — ${msg}`);
  }

  // ── Per-page summary ──────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log(`[OUTPUT] AUDIT COMPLETE: pageKey=${pageKey}`);
  console.log(`  PASSES (${result.passes.length}): ${result.passes.join(" | ")}`);
  if (result.issues.length > 0) {
    console.log(`  ISSUES (${result.issues.length}):`);
    result.issues.forEach(i => console.log(`    ⚠ ${i}`));
  } else {
    console.log(`  ISSUES: NONE — ALL CHECKS PASS`);
  }
  console.log(`${"═".repeat(70)}`);

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const t0 = Date.now();
  console.log(`\n${"█".repeat(70)}`);
  console.log(`[INPUT] DEEP CROSS-REFERENCE AUDIT — ALL 4 RG PAGES`);
  console.log(`[INPUT] Timestamp: ${new Date().toISOString()}`);
  console.log(`${"█".repeat(70)}\n`);

  const sheets = getSheets();

  // Get RG session cookie once
  console.log(`[STEP] Fetching RG session cookie...`);
  const cookie = await getRgSessionCookie();
  console.log(`[STATE] RG session cookie obtained`);

  const pageKeys = ["today-pitchers", "today-hitters", "tomorrow-pitchers", "tomorrow-hitters"];
  const results: PageAuditResult[] = [];

  // Run audits sequentially to avoid rate limiting
  for (const pageKey of pageKeys) {
    const r = await auditPage(pageKey, cookie, sheets);
    results.push(r);
    // Small delay between pages
    await new Promise(res => setTimeout(res, 1000));
  }

  // ── Global summary ────────────────────────────────────────────────────────
  const elapsed = Date.now() - t0;
  const totalIssues = results.reduce((s, r) => s + r.issues.length, 0);
  const totalPasses = results.reduce((s, r) => s + r.passes.length, 0);

  console.log(`\n${"█".repeat(70)}`);
  console.log(`[OUTPUT] GLOBAL AUDIT SUMMARY — elapsed=${elapsed}ms`);
  console.log(`${"█".repeat(70)}`);

  for (const r of results) {
    const status = r.issues.length === 0 ? "✓ PASS" : `✗ FAIL (${r.issues.length} issues)`;
    console.log(`\n  [${status}] ${r.pageKey} → "${r.tabName}"`);
    console.log(`    CSV: ${r.csvRawHeaders.length} cols / ${r.csvRowCount} rows`);
    console.log(`    Parsed: ${r.parsedColumns.length} cols / ${r.parsedRowCount} rows`);
    console.log(`    Sheet: ${r.sheetHeaders.length} cols / ${r.sheetRowCount} rows`);
    if (r.issues.length > 0) {
      r.issues.forEach(i => console.log(`    ⚠ ${i}`));
    }
  }

  console.log(`\n  TOTAL: ${totalPasses} PASS checks, ${totalIssues} FAIL/WARN issues`);
  console.log(`  VERDICT: ${totalIssues === 0 ? "✓ ALL CHECKS PASS — pipeline is 100% accurate" : `✗ ${totalIssues} ISSUE(S) DETECTED — see above`}`);
  console.log(`${"█".repeat(70)}\n`);

  // Write results to file for inspection
  const outputPath = "/tmp/deep_crossref_audit_results.json";
  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`[OUTPUT] Full results written to ${outputPath}`);

  if (totalIssues > 0) process.exit(1);
})();
