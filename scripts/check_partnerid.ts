/**
 * check_partnerid.ts
 * Reads the first 5 rows of Tomorrow's Projections (The Bat X) and
 * Tomorrow's Projections (The Bat X Hitters) to verify PLAYERID and PARTNERID values.
 */
import { google } from "googleapis";
import * as dotenv from "dotenv";
dotenv.config();

const SPREADSHEET_ID = "1IlUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

async function main() {
  const SA = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const auth = new google.auth.GoogleAuth({
    credentials: SA,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client as any });

  const tabs = [
    { name: "Tomorrow's Projections (The Bat X)", partneridCol: 50 },
    { name: "Tomorrow's Projections (The Bat X Hitters)", partneridCol: 55 },
  ];

  for (const tab of tabs) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`[INPUT] tab="${tab.name}"`);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tab.name}'!A1:BZ6`,
    });
    const rows = res.data.values ?? [];
    if (rows.length === 0) {
      console.log(`[STATE] tab="${tab.name}" — EMPTY (no data)`);
      continue;
    }

    const header = rows[0];
    const playeridIdx = header.indexOf("PLAYERID");
    const nameIdx = header.indexOf("NAME");
    const partneridIdx = header.indexOf("PARTNERID");

    console.log(`[STATE] header cols=${header.length} PLAYERID@col${playeridIdx} NAME@col${nameIdx} PARTNERID@col${partneridIdx}`);
    console.log(`[STATE] first 5 headers: ${header.slice(0, 5).join(" | ")}`);
    console.log(`[STATE] last 5 headers: ${header.slice(-5).join(" | ")}`);

    for (let i = 1; i <= 5 && i < rows.length; i++) {
      const r = rows[i];
      const playerid = playeridIdx >= 0 ? (r[playeridIdx] ?? "(empty)") : "N/A";
      const name = nameIdx >= 0 ? (r[nameIdx] ?? "(empty)") : "N/A";
      const partnerid = partneridIdx >= 0 ? (r[partneridIdx] ?? "(empty)") : "N/A";
      const mlbId = r[r.length - 1] ?? "(empty)";
      console.log(
        `[ROW ${i}] PLAYERID="${playerid}" | NAME="${name}" | PARTNERID="${partnerid}" | MLB_ID="${mlbId}"`
      );
      if (playerid === "(empty)" || playerid === "") {
        console.warn(
          `[VERIFY] WARN — PLAYERID is empty for row ${i} name="${name}" — PARTNERID="${partnerid}" (source data timing issue if PARTNERID also empty)`
        );
      } else {
        console.log(`[VERIFY] PASS — PLAYERID="${playerid}" is populated for row ${i} name="${name}"`);
      }
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("[OUTPUT] PARTNERID/PLAYERID check complete");
}

main().catch(e => {
  console.error("[FAIL]", e);
  process.exit(1);
});
