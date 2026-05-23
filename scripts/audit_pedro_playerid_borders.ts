/**
 * MAXIMUM-DEPTH AUDIT: Pedro Ramirez, PLAYERID on Tomorrow tabs, Border verification
 * Uses exact same URL pattern as live sync: https://rotogrinders.com/grids/{csvId}.csv
 */

import * as dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import * as https from "https";

const SPREADSHEET_ID = "1IlUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";
const RG_BASE = "https://rotogrinders.com";

// Exact PAGE_CONFIG from rotogrinderProxy.ts
const PAGE_CONFIG: Record<string, { csvId: string; tabName: string; type: string }> = {
  "today-hitters":     { csvId: "3372512", tabName: "The Bat X Hitters",                                   type: "hitters"  },
  "tomorrow-pitchers": { csvId: "3375509", tabName: "Tomorrow's Projections (The Bat X)",                  type: "pitchers" },
  "tomorrow-hitters":  { csvId: "3375510", tabName: "Tomorrow's Projections (The Bat X Hitters)",          type: "hitters"  },
};

// ── Google Sheets auth ─────────────────────────────────────────────────────────
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

// ── RG Login (same as rotogrinderProxy.ts) ────────────────────────────────────
async function getRgSessionCookie(): Promise<string> {
  const username = process.env.ROTOGRINDERS_USERNAME;
  const password = process.env.ROTOGRINDERS_PASSWORD;
  if (!username || !password) throw new Error("ROTOGRINDERS_USERNAME/PASSWORD not set");

  const postData = JSON.stringify({ username, password });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "rotogrinders.com",
      path: "/sign-in",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://rotogrinders.com/sign-in",
        "Origin": "https://rotogrinders.com",
      },
    }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        const cookies = (res.headers["set-cookie"] ?? []).join("; ");
        console.log(`[AUDIT] [STATE] Login HTTP ${res.statusCode} — cookie length=${cookies.length}`);
        resolve(cookies);
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// ── Fetch RG CSV (exact URL pattern from rotogrinderProxy.ts) ─────────────────
async function fetchRgCsv(csvId: string, cookie: string): Promise<string> {
  const csvUrl = `${RG_BASE}/grids/${csvId}.csv`;
  console.log(`[AUDIT] [STEP] Fetching CSV: ${csvUrl}`);
  return new Promise((resolve, reject) => {
    const req = https.request(csvUrl, {
      headers: {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/csv,text/plain,*/*",
        "Referer": "https://rotogrinders.com/",
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        console.log(`[AUDIT] [STATE] HTTP ${res.statusCode} — ${data.length} bytes`);
        resolve(data);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// ── Read sheet tab ─────────────────────────────────────────────────────────────
async function readSheetTab(sheets: any, tabName: string): Promise<string[][]> {
  // Use A1:ZZZ notation without single-quote escaping — use the tab name directly
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A1:ZZZ2000`,
  });
  return resp.data.values ?? [];
}

// ── Check borders on a tab ─────────────────────────────────────────────────────
async function checkBorders(sheets: any, tabName: string): Promise<void> {
  try {
    const resp = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [`${tabName}!A1:B2`],
      includeGridData: true,
      fields: "sheets.data.rowData.values.effectiveFormat.borders",
    });
    const rows = resp.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    const cell = rows[0]?.values?.[0]?.effectiveFormat?.borders;
    if (!cell) {
      console.error(`[AUDIT] [VERIFY] FAIL — No border data for tab="${tabName}"`);
      return;
    }
    const topStyle = cell.top?.style ?? "NONE";
    const topColorR = cell.top?.color?.red ?? 0;
    const topColorG = cell.top?.color?.green ?? 0;
    const topColorB = cell.top?.color?.blue ?? 0;
    const isBlack = topColorR < 0.01 && topColorG < 0.01 && topColorB < 0.01;
    const isSolid = topStyle === "SOLID";
    if (isSolid && isBlack) {
      console.log(`[AUDIT] [VERIFY] PASS — Black SOLID borders on tab="${tabName}" (R=${topColorR} G=${topColorG} B=${topColorB})`);
    } else if (topStyle !== "NONE") {
      console.warn(`[AUDIT] [VERIFY] WARN — Borders present but not black-solid on tab="${tabName}": style=${topStyle} R=${topColorR} G=${topColorG} B=${topColorB}`);
    } else {
      console.error(`[AUDIT] [VERIFY] FAIL — NO borders on tab="${tabName}": style=${topStyle}`);
    }
  } catch (err: any) {
    console.error(`[AUDIT] [VERIFY] FAIL — Border check error for tab="${tabName}": ${err.message}`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] MAXIMUM-DEPTH AUDIT: Pedro Ramirez, PLAYERID, Borders");
  console.log("═══════════════════════════════════════════════════════════════════════");

  const sheets = await getSheetsClient();
  console.log("[STEP] Logging into RotoGrinders...");
  const sessionCookie = await getRgSessionCookie();
  if (!sessionCookie || sessionCookie.length < 10) {
    throw new Error("RG login failed — no session cookie returned");
  }

  // ── AUDIT 1: Pedro Ramirez in today-hitters ──────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] AUDIT 1: Pedro Ramirez in today-hitters raw CSV");
  console.log("[STATE] csvId=3372512 URL=https://rotogrinders.com/grids/3372512.csv");
  console.log("════════════════════════════════════════════════════════════════════════");

  const todayHittersCsv = await fetchRgCsv("3372512", sessionCookie);
  const todayLines = todayHittersCsv.split("\n").filter(l => l.trim());

  if (todayLines.length < 2) {
    console.error(`[VERIFY] CRITICAL — today-hitters CSV is empty or unparseable (${todayLines.length} lines)`);
    console.log(`[STATE] First 200 chars: ${todayHittersCsv.substring(0, 200)}`);
  } else {
    const todayHeaders = parseCsvLine(todayLines[0]);
    const nameColIdx = todayHeaders.findIndex(h => h === "NAME" || h === "PLAYER");
    const playerIdColIdx = todayHeaders.findIndex(h => h === "PLAYERID");
    const partnerIdColIdx = todayHeaders.findIndex(h => h === "PARTNERID");

    console.log(`[STATE] today-hitters CSV: ${todayLines.length - 1} data rows, ${todayHeaders.length} columns`);
    console.log(`[STATE] Headers[0..14]: ${todayHeaders.slice(0, 15).join(", ")}`);
    console.log(`[STATE] NAME col idx=${nameColIdx} | PLAYERID col idx=${playerIdColIdx} | PARTNERID col idx=${partnerIdColIdx}`);

    // Search for Pedro Ramirez
    let pedroFoundInCsv = false;
    for (let i = 1; i < todayLines.length; i++) {
      const cells = parseCsvLine(todayLines[i]);
      const name = cells[nameColIdx] ?? "";
      if (name.toLowerCase().includes("pedro") && name.toLowerCase().includes("ramirez")) {
        pedroFoundInCsv = true;
        console.log(`[STATE] Pedro Ramirez FOUND in raw CSV at line ${i}`);
        console.log(`[STATE] NAME="${name}"`);
        console.log(`[STATE] PLAYERID="${playerIdColIdx >= 0 ? cells[playerIdColIdx] : "N/A (no col)"}"`);
        console.log(`[STATE] PARTNERID="${partnerIdColIdx >= 0 ? cells[partnerIdColIdx] : "N/A (no col)"}"`);
        console.log(`[STATE] Full row[0..14]: ${cells.slice(0, 15).join(" | ")}`);
        break;
      }
    }
    if (!pedroFoundInCsv) {
      console.error(`[VERIFY] CRITICAL — Pedro Ramirez NOT FOUND in today-hitters raw CSV (${todayLines.length - 1} rows)`);
      // Find similar names
      const similar: string[] = [];
      for (let i = 1; i < todayLines.length; i++) {
        const cells = parseCsvLine(todayLines[i]);
        const name = cells[nameColIdx] ?? "";
        if (name.toLowerCase().includes("pedro") || name.toLowerCase().includes("ramirez")) {
          similar.push(`line=${i} NAME="${name}" PLAYERID="${playerIdColIdx >= 0 ? cells[playerIdColIdx] : "?"}" PARTNERID="${partnerIdColIdx >= 0 ? cells[partnerIdColIdx] : "?"}"`);
        }
      }
      if (similar.length > 0) {
        console.log(`[STATE] Similar names: ${similar.join(" | ")}`);
      } else {
        console.error(`[VERIFY] CRITICAL — No 'pedro' or 'ramirez' anywhere in today-hitters CSV`);
        // Print first 5 names for context
        const first5: string[] = [];
        for (let i = 1; i <= Math.min(5, todayLines.length - 1); i++) {
          const cells = parseCsvLine(todayLines[i]);
          first5.push(`"${cells[nameColIdx] ?? ""}"`);
        }
        console.log(`[STATE] First 5 player names in CSV: ${first5.join(", ")}`);
      }
    }
  }

  // Check Pedro in the live sheet
  console.log("\n[STEP] Reading live sheet tab 'The Bat X Hitters'...");
  try {
    const hitterSheetData = await readSheetTab(sheets, "The Bat X Hitters");
    const sheetHeaders = hitterSheetData[0] ?? [];
    const sheetNameIdx = sheetHeaders.findIndex(h => h === "NAME");
    console.log(`[STATE] Sheet 'The Bat X Hitters': ${hitterSheetData.length - 1} data rows, ${sheetHeaders.length} columns`);
    console.log(`[STATE] Sheet headers[0..9]: ${sheetHeaders.slice(0, 10).join(", ")}`);
    console.log(`[STATE] Sheet last col="${sheetHeaders[sheetHeaders.length - 1]}"`);

    let pedroFoundInSheet = false;
    for (let i = 1; i < hitterSheetData.length; i++) {
      const name = hitterSheetData[i][sheetNameIdx] ?? "";
      if (name.toLowerCase().includes("pedro") && name.toLowerCase().includes("ramirez")) {
        pedroFoundInSheet = true;
        const mlbId = hitterSheetData[i][sheetHeaders.length - 1] ?? "";
        console.log(`[STATE] Pedro Ramirez FOUND in sheet at row ${i + 1}: NAME="${name}" MLB_ID="${mlbId}"`);
        break;
      }
    }
    if (!pedroFoundInSheet) {
      console.error(`[VERIFY] CRITICAL — Pedro Ramirez NOT FOUND in sheet 'The Bat X Hitters' (${hitterSheetData.length - 1} rows)`);
    }
  } catch (err: any) {
    console.error(`[VERIFY] FAIL — Sheet read error: ${err.message}`);
  }

  // ── AUDIT 2: PLAYERID column in tomorrow tabs ────────────────────────────
  for (const pageKey of ["tomorrow-pitchers", "tomorrow-hitters"]) {
    const conf = PAGE_CONFIG[pageKey];
    console.log(`\n════════════════════════════════════════════════════════════════════════`);
    console.log(`[INPUT] AUDIT 2: PLAYERID in ${pageKey} (csvId=${conf.csvId})`);
    console.log(`════════════════════════════════════════════════════════════════════════`);

    const csv = await fetchRgCsv(conf.csvId, sessionCookie);
    const lines = csv.split("\n").filter(l => l.trim());

    if (lines.length < 2) {
      console.error(`[VERIFY] CRITICAL — ${pageKey} CSV is empty (${lines.length} lines)`);
      console.log(`[STATE] First 200 chars: ${csv.substring(0, 200)}`);
      continue;
    }

    const headers = parseCsvLine(lines[0]);
    const pidIdx = headers.findIndex(h => h === "PLAYERID");
    const partnerIdx = headers.findIndex(h => h === "PARTNERID");
    const nameIdx = headers.findIndex(h => h === "NAME" || h === "PLAYER");

    console.log(`[STATE] ${pageKey} CSV: ${lines.length - 1} rows, ${headers.length} cols`);
    console.log(`[STATE] Headers[0..14]: ${headers.slice(0, 15).join(", ")}`);
    console.log(`[STATE] PLAYERID col idx=${pidIdx} (${pidIdx >= 0 ? "PRESENT ✓" : "ABSENT ✗"})`);
    console.log(`[STATE] PARTNERID col idx=${partnerIdx} (${partnerIdx >= 0 ? "PRESENT ✓" : "ABSENT ✗"})`);

    if (pidIdx < 0) {
      console.error(`[VERIFY] CRITICAL — PLAYERID NOT in ${pageKey} raw CSV`);
    } else {
      console.log(`[VERIFY] PASS — PLAYERID present in ${pageKey} CSV`);
    }

    if (partnerIdx >= 0) {
      const samples: string[] = [];
      for (let i = 1; i <= Math.min(3, lines.length - 1); i++) {
        const cells = parseCsvLine(lines[i]);
        samples.push(`NAME="${cells[nameIdx] ?? ""}" PARTNERID="${cells[partnerIdx] ?? ""}"`);
      }
      console.log(`[STATE] PARTNERID samples: ${samples.join(" | ")}`);
    }

    // Check live sheet
    try {
      const sheetData = await readSheetTab(sheets, conf.tabName);
      const sheetHdrs = sheetData[0] ?? [];
      const sheetPidIdx = sheetHdrs.findIndex(h => h === "PLAYERID");
      const sheetPartnerIdx = sheetHdrs.findIndex(h => h === "PARTNERID");
      console.log(`[STATE] Sheet '${conf.tabName}': ${sheetData.length - 1} rows, ${sheetHdrs.length} cols`);
      console.log(`[STATE] Sheet headers[0..14]: ${sheetHdrs.slice(0, 15).join(", ")}`);
      console.log(`[STATE] Sheet PLAYERID col idx=${sheetPidIdx} (${sheetPidIdx >= 0 ? "PRESENT ✓" : "ABSENT ✗"})`);
      console.log(`[STATE] Sheet PARTNERID col idx=${sheetPartnerIdx} (${sheetPartnerIdx >= 0 ? "PRESENT ✓" : "ABSENT ✗"})`);
      console.log(`[STATE] Sheet last col="${sheetHdrs[sheetHdrs.length - 1]}" (should be MLB_ID)`);
    } catch (err: any) {
      console.error(`[VERIFY] FAIL — Sheet read error for '${conf.tabName}': ${err.message}`);
    }
  }

  // ── AUDIT 3: Border verification on all 4 RG tabs ───────────────────────
  console.log("\n════════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] AUDIT 3: Border verification on all 4 RG tabs");
  console.log("════════════════════════════════════════════════════════════════════════");

  const tabsToCheck = [
    "The Bat X",
    "The Bat X Hitters",
    "Tomorrow's Projections (The Bat X)",
    "Tomorrow's Projections (The Bat X Hitters)",
  ];

  for (const tabName of tabsToCheck) {
    await checkBorders(sheets, tabName);
  }

  console.log("\n════════════════════════════════════════════════════════════════════════");
  console.log("[OUTPUT] AUDIT COMPLETE");
  console.log("════════════════════════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
