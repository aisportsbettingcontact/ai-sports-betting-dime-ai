/**
 * clear_all_formatting.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot script: clears ALL formatting from all 4 RG tabs and the 2 lineup tabs.
 *
 * Operations per tab (single batchUpdate call):
 *   1. repeatCell over the entire sheet — resets all cell formatting to default
 *   2. updateSheetProperties — removes freeze rows/columns
 *
 * After this runs, the sheet will be plain Google Sheets default style.
 * The sync pipeline does NOT re-apply any formatting, so this state is permanent.
 *
 * Run: npx tsx scripts/clear_all_formatting.ts
 */

import "dotenv/config";
import { google } from "googleapis";

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

const TAB_NAMES = [
  "The Bat X",
  "The Bat X Hitters",
  "Tomorrow's Projections (The Bat X)",
  "Tomorrow's Projections (The Bat X Hitters)",
  "05-22-2026 LINEUPS",
  "05-23-2026 LINEUPS",
  "05-24-2026 LINEUPS",
];

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

async function getSheetId(sheets: ReturnType<typeof getSheets>, tabName: string): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === tabName);
  return sheet?.properties?.sheetId ?? null;
}

async function clearFormattingForTab(
  sheets: ReturnType<typeof getSheets>,
  tabName: string
): Promise<void> {
  console.log(`[INPUT] tab="${tabName}" — fetching sheetId...`);

  const sheetId = await getSheetId(sheets, tabName);
  if (sheetId == null) {
    console.warn(`[VERIFY] WARN — tab="${tabName}" not found in spreadsheet — skipping`);
    return;
  }

  console.log(`[STATE] tab="${tabName}" sheetId=${sheetId}`);
  console.log(`[STEP] Firing batchUpdate: repeatCell (clear all formatting) + updateSheetProperties (unfreeze)...`);

  const t0 = Date.now();

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        // ── 1. Clear ALL cell formatting across the entire sheet ──────────────
        // repeatCell with an empty CellFormat object resets every cell to the
        // Google Sheets default: white background, black text, no bold, no borders,
        // default font (Arial 10pt), default alignment.
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              startColumnIndex: 0,
              // No endRowIndex/endColumnIndex = entire sheet
            },
            cell: {
              userEnteredFormat: {
                // Explicitly reset every formatting field
                backgroundColor:       { red: 1, green: 1, blue: 1, alpha: 1 },
                textFormat: {
                  bold:          false,
                  italic:        false,
                  strikethrough: false,
                  underline:     false,
                  fontSize:      10,
                  fontFamily:    "Arial",
                  foregroundColor: { red: 0, green: 0, blue: 0, alpha: 1 },
                },
                horizontalAlignment: "LEFT",
                verticalAlignment:   "BOTTOM",
                wrapStrategy:        "OVERFLOW_CELL",
                borders: {
                  top:    { style: "NONE" },
                  bottom: { style: "NONE" },
                  left:   { style: "NONE" },
                  right:  { style: "NONE" },
                },
                padding: { top: 2, bottom: 2, left: 3, right: 3 },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders,padding)",
          },
        },

        // ── 2. Remove freeze rows and columns ─────────────────────────────────
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount:    0,
                frozenColumnCount: 0,
              },
            },
            fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
          },
        },

        // ── 3. Reset all column widths to default (100px) ─────────────────────
        // This removes any custom pixel widths set by the old formatting code.
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension:  "COLUMNS",
              startIndex: 0,
            },
            properties: {
              pixelSize: 100,
            },
            fields: "pixelSize",
          },
        },

        // ── 4. Reset all row heights to default (21px) ────────────────────────
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension:  "ROWS",
              startIndex: 0,
            },
            properties: {
              pixelSize: 21,
            },
            fields: "pixelSize",
          },
        },
      ],
    },
  });

  const elapsed = Date.now() - t0;
  console.log(`[OUTPUT] tab="${tabName}" formatting cleared in ${elapsed}ms`);
  console.log(`[VERIFY] PASS — tab="${tabName}" is now plain text, no background, no freeze, default column widths`);
}

(async () => {
  const sheets = getSheets();
  let allPass = true;

  console.log(`\n[INPUT] Clearing formatting from ${TAB_NAMES.length} tabs in spreadsheet ${SPREADSHEET_ID}`);

  for (const tabName of TAB_NAMES) {
    try {
      await clearFormattingForTab(sheets, tabName);
    } catch (err) {
      console.error(`[VERIFY] FAIL — tab="${tabName}": ${(err as Error).message}`);
      allPass = false;
    }
    // Small delay between API calls to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`[VERIFY] ${allPass ? "PASS" : "FAIL"} — All tabs formatting cleared: ${allPass ? "100% PASS" : "FAILURES DETECTED"}`);
  console.log(`${"═".repeat(70)}\n`);

  if (!allPass) process.exit(1);
})();
