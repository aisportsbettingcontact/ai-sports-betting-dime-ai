/**
 * listSheetTabs.ts
 * Lists all tabs in the Jack Mac spreadsheet.
 */
import { google } from "googleapis";

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

async function main() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(saJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties",
  });
  console.log("\n[ListTabs] Current tabs in spreadsheet:");
  for (const s of meta.data.sheets ?? []) {
    console.log(`  sheetId=${s.properties?.sheetId} title="${s.properties?.title}"`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
