/**
 * validatePitcherIds.ts
 * Reads back the 05-31-2026 LINEUPS tab and validates PITCHER_MLB_ID values
 * against the known MLB Stats API IDs confirmed in the audit.
 */
import { google } from "googleapis";

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";
const TAB = "05-31-2026 LINEUPS";

// Ground truth from MLB Stats API audit (gamePk scan on 2026-05-31)
const EXPECTED: Record<string, string> = {
  "TOR":  "",         // TBD pitcher
  "BAL":  "680694",   // Kyle Bradish
  "SD":   "656288",   // Griffin Canning
  "WSH":  "641793",   // Zack Littell
  "MIN":  "805673",   // Zebby Matthews
  "PIT":  "677952",   // Braxton Ashcraft
  "BOS":  "624133",   // Ranger Suarez
  "CLE":  "676440",   // Tanner Bibee
  "LAA":  "686799",   // Jack Kochanowicz
  "TB":   "663556",   // Shane McClanahan
  "ATL":  "675911",   // Spencer Strider
  "CIN":  "666157",   // Nick Lodolo
  "MIA":  "676083",   // Janson Junk
  "NYM":  "690997",   // Nolan McLean
  "DET":  "672456",   // Keider Montero
  "CWS":  "680732",   // Sean Burke
  "MIL":  "694819",   // Jacob Misiorowski
  "HOU":  "837227",   // Tatsuya Imai
  "KC":   "608379",   // Michael Wacha
  "TEX":  "683004",   // Jack Leiter
  "SF":   "592662",   // Robbie Ray
  "COL":  "685299",   // Tanner Gordon
  "NYY":  "701542",   // Will Warren
  "OAK":  "",         // TBD pitcher
  "ARI":  "518876",   // Merrill Kelly
  "SEA":  "682243",   // Bryce Miller
  "PHI":  "691725",   // Andrew Painter
  "LAD":  "808967",   // Yoshinobu Yamamoto
  "CHC":  "696136",   // Jordan Wicks
  "STL":  "669461",   // Matthew Liberatore
};

async function main() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(saJson);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'`,
  });
  const rows = (res.data.values as string[][]) ?? [];
  const header = rows[0] ?? [];
  const data = rows.slice(1);

  // Find column indices
  const col = (name: string) => header.indexOf(name);
  const TEAM_COL = col("TEAM");
  const PITCHER_COL = col("PITCHER");
  const PITCHER_ID_COL = col("PITCHER_MLB_ID");

  console.log(`\n[ValidatePitcherIds] Tab: "${TAB}" | Rows: ${data.length} | Header cols: ${header.length}`);
  console.log(`[ValidatePitcherIds] Header: ${header.join(" | ")}\n`);

  let pass = 0;
  let fail = 0;
  const seen = new Set<string>();

  for (const row of data) {
    const team = row[TEAM_COL] ?? "";
    if (seen.has(team)) continue; // only check first row per team (stub row)
    seen.add(team);

    const pitcher = row[PITCHER_COL] ?? "";
    const pitcherId = row[PITCHER_ID_COL] ?? "";
    const expected = EXPECTED[team];

    if (expected === undefined) {
      console.log(`  [SKIP] TEAM=${team} — not in expected map`);
      continue;
    }

    const ok = pitcherId === expected;
    if (ok) {
      console.log(`  [PASS] TEAM=${team} PITCHER="${pitcher}" PITCHER_MLB_ID=${pitcherId || "(empty=TBD)"}`);
      pass++;
    } else {
      console.error(`  [FAIL] TEAM=${team} PITCHER="${pitcher}" got=${pitcherId} expected=${expected || "(empty=TBD)"}`);
      fail++;
    }
  }

  console.log(`\n[ValidatePitcherIds] ─── SUMMARY ───`);
  console.log(`  PASS: ${pass}`);
  console.log(`  FAIL: ${fail}`);
  console.log(`  TOTAL checked: ${pass + fail}`);
  console.log(`[ValidatePitcherIds] ${fail === 0 ? "✅ ALL IDs CORRECT" : "❌ FAILURES DETECTED"}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
