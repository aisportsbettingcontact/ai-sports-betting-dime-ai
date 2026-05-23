/**
 * READ HEADER ROW — Direct API read of row 1 for all 4 RG tabs
 * No caching, no intermediate processing. Raw API response.
 */
import { google } from "googleapis";
import * as dotenv from "dotenv";
dotenv.config({ path: "/home/ubuntu/ai-sports-betting/.env" });

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";
const TABS = [
  "The Bat X",
  "The Bat X Hitters",
  "Tomorrow's Projections (The Bat X)",
  "Tomorrow's Projections (The Bat X Hitters)",
];

async function main() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) { console.error("NO SA JSON"); process.exit(1); }
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(saJson),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  for (const tab of TABS) {
    console.log(`\n[TAB] "${tab}"`);
    // Read ONLY row 1 (the header)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'!1:1`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const row1 = ((res.data.values ?? [])[0] ?? []) as string[];
    console.log(`  [STATE] col count: ${row1.length}`);
    console.log(`  [STATE] col[0]: "${row1[0]}"`);
    console.log(`  [STATE] col[1]: "${row1[1]}"`);
    console.log(`  [STATE] col[-1]: "${row1[row1.length - 1]}"`);
    console.log(`  [STATE] all headers: ${row1.join(" | ")}`);

    // Also read row 2 (first data row)
    const res2 = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'!2:2`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const row2 = ((res2.data.values ?? [])[0] ?? []) as string[];
    console.log(`  [STATE] row2 (first data): ${row2.slice(0, 6).join(" | ")}`);

    // Check total rows
    const resAll = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab}'`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const allRows = (resAll.data.values ?? []) as string[][];
    console.log(`  [STATE] total rows (including header): ${allRows.length}`);

    const verdict = row1[0] === "PLAYER_ID" && row1[1] === "NAME" && row1[row1.length - 1] === "MLB_ID";
    console.log(`  [VERIFY] ${verdict ? "PASS" : "FAIL"} — PLAYER_ID[0]=${row1[0]} NAME[1]=${row1[1]} LAST=${row1[row1.length - 1]}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
