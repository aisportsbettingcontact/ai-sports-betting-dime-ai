/**
 * DIRECT SHEET INSPECTION — reads all 4 RG tabs directly, no CSV fetch needed.
 * Checks: Pedro Ramirez presence, PLAYERID column, MLB_ID last column, borders.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

const TABS = [
  { name: "The Bat X",                                    key: "today-pitchers"  },
  { name: "The Bat X Hitters",                            key: "today-hitters"   },
  { name: "Tomorrow's Projections (The Bat X)",           key: "tomorrow-pitchers" },
  { name: "Tomorrow's Projections (The Bat X Hitters)",   key: "tomorrow-hitters"  },
];

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const creds = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] DIRECT SHEET INSPECTION — All 4 RG Tabs");
  console.log("[STATE] Spreadsheet ID:", SPREADSHEET_ID);
  console.log("═══════════════════════════════════════════════════════════════════════");

  const sheets = await getSheetsClient();

  // ── Step 1: Get all tab names and sheet IDs ──────────────────────────────────
  console.log("\n[STEP] Fetching spreadsheet metadata (all tab names + sheet IDs)...");
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties",
  });
  const allTabs = (meta.data.sheets ?? []).map((s: any) => ({
    title: s.properties.title,
    sheetId: s.properties.sheetId,
  }));
  console.log(`[STATE] All tabs (${allTabs.length}): ${allTabs.map((t: any) => `"${t.title}"(id=${t.sheetId})`).join(", ")}`);

  // ── Step 2: Read each of the 4 RG tabs ──────────────────────────────────────
  for (const tab of TABS) {
    const tabMeta = allTabs.find((t: any) => t.title === tab.name);
    console.log(`\n════════════════════════════════════════════════════════════════════════`);
    console.log(`[INPUT] Tab: "${tab.name}" (key=${tab.key})`);
    if (!tabMeta) {
      console.error(`[VERIFY] CRITICAL — Tab "${tab.name}" NOT FOUND in spreadsheet`);
      console.log(`[STATE] Available tabs: ${allTabs.map((t: any) => `"${t.title}"`).join(", ")}`);
      continue;
    }
    console.log(`[STATE] sheetId=${tabMeta.sheetId}`);

    // Read values
    let sheetData: string[][] = [];
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${tab.name}!A1:ZZZ2000`,
      });
      sheetData = (resp.data.values ?? []) as string[][];
    } catch (err: any) {
      console.error(`[VERIFY] FAIL — Could not read tab "${tab.name}": ${err.message}`);
      continue;
    }

    if (sheetData.length === 0) {
      console.error(`[VERIFY] CRITICAL — Tab "${tab.name}" is EMPTY`);
      continue;
    }

    const headers = sheetData[0];
    const dataRows = sheetData.length - 1;

    console.log(`[STATE] Rows: ${dataRows} data rows + 1 header row = ${sheetData.length} total`);
    console.log(`[STATE] Columns: ${headers.length}`);
    console.log(`[STATE] Headers[0..9]: ${headers.slice(0, 10).join(" | ")}`);
    console.log(`[STATE] Headers[-5..last]: ${headers.slice(-5).join(" | ")}`);
    console.log(`[STATE] col[0]="${headers[0]}" col[1]="${headers[1]}" col[-1]="${headers[headers.length - 1]}"`);

    // Check PLAYERID
    const pidIdx = headers.findIndex(h => h === "PLAYERID");
    const partnerIdx = headers.findIndex(h => h === "PARTNERID");
    const mlbIdIdx = headers.findIndex(h => h === "MLB_ID");
    const nameIdx = headers.findIndex(h => h === "NAME" || h === "PLAYER");

    console.log(`[STATE] PLAYERID col idx=${pidIdx} (${pidIdx >= 0 ? "PRESENT ✓" : "ABSENT ✗"})`);
    console.log(`[STATE] PARTNERID col idx=${partnerIdx} (${partnerIdx >= 0 ? "PRESENT ✓" : "ABSENT ✗"})`);
    console.log(`[STATE] MLB_ID col idx=${mlbIdIdx} (${mlbIdIdx >= 0 ? "PRESENT ✓" : "ABSENT ✗"})`);
    console.log(`[STATE] MLB_ID is last col: ${mlbIdIdx === headers.length - 1 ? "YES ✓" : `NO ✗ (last col is "${headers[headers.length - 1]}")`}`);

    // Sample first 3 rows
    for (let i = 1; i <= Math.min(3, dataRows); i++) {
      const row = sheetData[i];
      const name = nameIdx >= 0 ? row[nameIdx] : row[0];
      const pid = pidIdx >= 0 ? row[pidIdx] : "N/A";
      const mlbId = mlbIdIdx >= 0 ? row[mlbIdIdx] : "N/A";
      const partner = partnerIdx >= 0 ? row[partnerIdx] : "N/A";
      console.log(`[STATE] Row ${i}: NAME="${name}" PLAYERID="${pid}" PARTNERID="${partner}" MLB_ID="${mlbId}"`);
    }

    // Check for Pedro Ramirez (only in hitter tabs)
    if (tab.key === "today-hitters" || tab.key === "tomorrow-hitters") {
      let pedroFound = false;
      for (let i = 1; i < sheetData.length; i++) {
        const name = nameIdx >= 0 ? sheetData[i][nameIdx] : sheetData[i][0];
        if (name && name.toLowerCase().includes("pedro") && name.toLowerCase().includes("ramirez")) {
          pedroFound = true;
          const pid = pidIdx >= 0 ? sheetData[i][pidIdx] : "N/A";
          const mlbId = mlbIdIdx >= 0 ? sheetData[i][mlbIdIdx] : "N/A";
          const partner = partnerIdx >= 0 ? sheetData[i][partnerIdx] : "N/A";
          console.log(`[STATE] Pedro Ramirez FOUND at row ${i + 1}: NAME="${name}" PLAYERID="${pid}" PARTNERID="${partner}" MLB_ID="${mlbId}"`);
          break;
        }
      }
      if (!pedroFound) {
        console.error(`[VERIFY] CRITICAL — Pedro Ramirez NOT FOUND in tab "${tab.name}" (${dataRows} rows)`);
        // Show players with "pedro" or "ramirez" in name
        const similar: string[] = [];
        for (let i = 1; i < sheetData.length; i++) {
          const name = nameIdx >= 0 ? sheetData[i][nameIdx] : sheetData[i][0];
          if (name && (name.toLowerCase().includes("pedro") || name.toLowerCase().includes("ramirez"))) {
            similar.push(`row=${i+1} "${name}"`);
          }
        }
        if (similar.length > 0) {
          console.log(`[STATE] Similar names found: ${similar.join(", ")}`);
        } else {
          console.error(`[VERIFY] CRITICAL — No 'pedro' or 'ramirez' in any row of "${tab.name}"`);
        }
      }
    }

    // Check for missing MLB_IDs
    if (mlbIdIdx >= 0) {
      let missingCount = 0;
      const missingNames: string[] = [];
      for (let i = 1; i < sheetData.length; i++) {
        const mlbId = sheetData[i][mlbIdIdx] ?? "";
        if (!mlbId || mlbId === "" || mlbId === "null" || mlbId === "undefined") {
          missingCount++;
          const name = nameIdx >= 0 ? sheetData[i][nameIdx] : sheetData[i][0];
          if (missingNames.length < 10) missingNames.push(`row=${i+1} "${name}"`);
        }
      }
      if (missingCount === 0) {
        console.log(`[VERIFY] PASS — All ${dataRows} rows have MLB_ID ✓`);
      } else {
        console.error(`[VERIFY] CRITICAL — ${missingCount}/${dataRows} rows missing MLB_ID`);
        console.log(`[STATE] Missing MLB_ID (first 10): ${missingNames.join(", ")}`);
      }
    }

    // Check borders via spreadsheet.get with includeGridData
    try {
      const borderResp = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [`${tab.name}!A1:C3`],
        includeGridData: true,
        fields: "sheets.data.rowData.values.effectiveFormat.borders",
      });
      const rows = borderResp.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
      const cell00 = rows[0]?.values?.[0]?.effectiveFormat?.borders;
      if (!cell00) {
        console.error(`[VERIFY] FAIL — No border data on cell A1 of "${tab.name}"`);
      } else {
        const topStyle = cell00.top?.style ?? "NONE";
        const topR = cell00.top?.color?.red ?? 0;
        const topG = cell00.top?.color?.green ?? 0;
        const topB = cell00.top?.color?.blue ?? 0;
        const isBlack = topR < 0.05 && topG < 0.05 && topB < 0.05;
        const isSolid = topStyle === "SOLID";
        if (isSolid && isBlack) {
          console.log(`[VERIFY] PASS — Black SOLID borders on A1 of "${tab.name}" (style=${topStyle} R=${topR} G=${topG} B=${topB})`);
        } else if (topStyle !== "NONE") {
          console.warn(`[VERIFY] WARN — Borders present but NOT black-solid on "${tab.name}": style=${topStyle} R=${topR} G=${topG} B=${topB}`);
        } else {
          console.error(`[VERIFY] FAIL — NO borders on "${tab.name}": style=${topStyle}`);
        }
      }
    } catch (err: any) {
      console.error(`[VERIFY] FAIL — Border check error for "${tab.name}": ${err.message}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("[OUTPUT] DIRECT SHEET INSPECTION COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
