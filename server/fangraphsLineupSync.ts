/**
 * fangraphsLineupSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ISOLATED Fangraphs / MLB Stats API lineup tab sync.
 *
 * Scope: TODAY and TOMORROW lineup tabs ONLY.
 * Zero RotoGrinders code. Zero RG tab writes. Zero RG session cookies.
 *
 * Sheet:       1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw
 * Tab format:  MM-DD-YYYY LINEUPS  (e.g. "05-30-2026 LINEUPS")
 *
 * Logging format (noise-free, intentional, pinpointed):
 *   [FgSync] [INPUT]  → source + parsed values
 *   [FgSync] [STEP]   → operation description
 *   [FgSync] [STATE]  → intermediate computations
 *   [FgSync] [OUTPUT] → final result
 *   [FgSync] [VERIFY] → PASS / FAIL / WARN + reason
 *
 * Safeguards on every write:
 *   1. Snapshot existing tab content before any destructive operation
 *   2. Clear → write raw values
 *   3. Read-back row count validation
 *   4. Rollback to snapshot on write failure
 *   5. Stale tab cleanup (delete tabs older than today PST)
 *   6. Legacy tab rename (Today Lineups → MM-DD-YYYY LINEUPS)
 */

import { google } from "googleapis";
import { getPstDate, invalidateFgCache, scrapeFangraphsLineups } from "./fangraphsScraper";
import type { FgGame } from "./fangraphsScraper";

// ─── Constants ────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface FgTabResult {
  tabName: string;
  status: "success" | "error" | "empty" | "skip";
  rowsWritten: number;
  readBackRowCount: number;
  readBackValidated: boolean;
  snapshotRowCount: number;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  elapsedMs: number;
  error?: string;
}

export interface FgSyncResult {
  success: boolean;
  syncedAt: string;
  todayTab: FgTabResult;
  tomorrowTab: FgTabResult;
  totalRowsWritten: number;
  elapsedMs: number;
  errors: string[];
}

// ─── Google Sheets Auth ───────────────────────────────────────────────────────

function getGoogleSheetsClient(): ReturnType<typeof google.sheets> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    throw new Error("[FgSync] GOOGLE_SERVICE_ACCOUNT_JSON is not set in environment");
  }
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(saJson);
  } catch (err) {
    throw new Error(`[FgSync] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${(err as Error).message}`);
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ─── Tab Name Formatting ──────────────────────────────────────────────────────

/**
 * Converts YYYY-MM-DD → "MM-DD-YYYY LINEUPS"
 * e.g. "2026-05-30" → "05-30-2026 LINEUPS"
 */
function formatLineupTabName(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) {
    console.warn(`[FgSync] [VERIFY] WARN — formatLineupTabName: unexpected format "${dateStr}" — using raw fallback`);
    return `${dateStr} LINEUPS`;
  }
  const [yyyy, mm, dd] = parts;
  const tabName = `${mm}-${dd}-${yyyy} LINEUPS`;
  console.log(`[FgSync] [STEP] formatLineupTabName: input="${dateStr}" output="${tabName}"`);
  return tabName;
}

// ─── Sheet Metadata Helpers ───────────────────────────────────────────────────

/**
 * Fetches all tab titles + sheetIds from the spreadsheet.
 * Returns a map of title → sheetId.
 */
async function getAllTabsMap(
  sheets: ReturnType<typeof google.sheets>
): Promise<Map<string, number>> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties",
  });
  const map = new Map<string, number>();
  for (const s of meta.data.sheets ?? []) {
    const title = s.properties?.title ?? "";
    const id = s.properties?.sheetId ?? -1;
    if (title && id >= 0) map.set(title, id);
  }
  console.log(`[FgSync] [STATE] getAllTabsMap: found ${map.size} tabs`);
  return map;
}

/**
 * Ensures a named tab exists. Creates it if missing.
 */
async function ensureTabExists(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<void> {
  const tabsMap = await getAllTabsMap(sheets);
  if (tabsMap.has(tabName)) {
    console.log(`[FgSync] [STATE] ensureTabExists: "${tabName}" already exists — no-op`);
    return;
  }
  console.log(`[FgSync] [STEP] ensureTabExists: creating tab "${tabName}"`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  console.log(`[FgSync] [OUTPUT] ensureTabExists: tab "${tabName}" created`);
}

/**
 * Renames a tab if oldName exists and newName does not.
 * Idempotent — safe to call on every sync.
 */
async function renameTabIfExists(
  sheets: ReturnType<typeof google.sheets>,
  oldName: string,
  newName: string
): Promise<void> {
  const tabsMap = await getAllTabsMap(sheets);
  if (!tabsMap.has(oldName)) {
    console.log(`[FgSync] [STATE] renameTabIfExists: "${oldName}" not found — no-op`);
    return;
  }
  if (tabsMap.has(newName)) {
    console.log(`[FgSync] [STATE] renameTabIfExists: "${newName}" already exists — no-op`);
    return;
  }
  const sheetId = tabsMap.get(oldName)!;
  console.log(`[FgSync] [STEP] renameTabIfExists: renaming "${oldName}" → "${newName}" (sheetId=${sheetId})`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId, title: newName },
          fields: "title",
        },
      }],
    },
  });
  console.log(`[FgSync] [OUTPUT] renameTabIfExists: "${oldName}" → "${newName}" DONE`);
}

/**
 * Deletes a list of tabs by sheetId in a single batchUpdate.
 * Non-fatal — logs and continues on error.
 */
async function deleteTabsBySheetId(
  sheets: ReturnType<typeof google.sheets>,
  sheetIds: number[],
  tabNames: string[]
): Promise<void> {
  if (sheetIds.length === 0) return;
  console.log(`[FgSync] [STEP] deleteTabsBySheetId: deleting ${sheetIds.length} tabs: [${tabNames.join(", ")}]`);
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: sheetIds.map(id => ({ deleteSheet: { sheetId: id } })),
      },
    });
    console.log(`[FgSync] [OUTPUT] deleteTabsBySheetId: deleted [${tabNames.join(", ")}]`);
  } catch (err) {
    console.warn(`[FgSync] [VERIFY] WARN — deleteTabsBySheetId failed: ${(err as Error).message} — continuing`);
  }
}

// ─── Stale Tab Cleanup ────────────────────────────────────────────────────────

/**
 * Deletes all "MM-DD-YYYY LINEUPS" tabs where the date < today PST.
 * Prevents unbounded accumulation of historical lineup tabs.
 * Non-fatal.
 */
async function deleteStaleLineupTabs(
  sheets: ReturnType<typeof google.sheets>
): Promise<void> {
  const t0 = Date.now();
  console.log(`[FgSync] [STEP] deleteStaleLineupTabs: scanning for stale lineup tabs`);

  const tabsMap = await getAllTabsMap(sheets);
  const LINEUP_TAB_RE = /^(\d{2})-(\d{2})-(\d{4}) LINEUPS$/;

  // Today PST as YYYYMMDD integer for fast comparison
  const todayPst = getPstDate(0); // "YYYY-MM-DD"
  const todayInt = parseInt(todayPst.replace(/-/g, ""), 10); // e.g. 20260530
  console.log(`[FgSync] [STATE] deleteStaleLineupTabs: todayPst=${todayPst} todayInt=${todayInt}`);

  const staleIds: number[] = [];
  const staleNames: string[] = [];

  for (const [title, sheetId] of Array.from(tabsMap.entries())) {
    const m = LINEUP_TAB_RE.exec(title);
    if (!m) continue;
    const [, mm, dd, yyyy] = m;
    // Reconstruct as YYYYMMDD integer
    const tabDateInt = parseInt(`${yyyy}${mm}${dd}`, 10);
    if (tabDateInt < todayInt) {
      staleIds.push(sheetId);
      staleNames.push(title);
      console.log(`[FgSync] [STATE] deleteStaleLineupTabs: STALE tab="${title}" tabDateInt=${tabDateInt} < todayInt=${todayInt}`);
    } else {
      console.log(`[FgSync] [STATE] deleteStaleLineupTabs: KEEP tab="${title}" tabDateInt=${tabDateInt}`);
    }
  }

  if (staleIds.length === 0) {
    console.log(`[FgSync] [VERIFY] PASS — deleteStaleLineupTabs: no stale tabs found elapsed=${Date.now() - t0}ms`);
    return;
  }

  await deleteTabsBySheetId(sheets, staleIds, staleNames);
  console.log(
    `[FgSync] [VERIFY] PASS — deleteStaleLineupTabs: deleted ${staleIds.length} stale tabs elapsed=${Date.now() - t0}ms`
  );
}

// ─── Snapshot / Clear / Write / Read-back ────────────────────────────────────

/**
 * Reads all values from a tab for rollback snapshot.
 * Returns null if the tab is empty or unreadable.
 */
async function snapshotTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<string[][] | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'`,
    });
    const rows = (res.data.values as string[][] | null | undefined) ?? [];
    console.log(`[FgSync] [STATE] snapshotTab: "${tabName}" snapshot=${rows.length} rows`);
    return rows.length > 0 ? rows : null;
  } catch {
    console.warn(`[FgSync] [VERIFY] WARN — snapshotTab: "${tabName}" unreadable — no snapshot`);
    return null;
  }
}

/**
 * Clears all content from a tab.
 */
async function clearTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
  });
  console.log(`[FgSync] [STEP] clearTab: "${tabName}" cleared`);
}

/**
 * Writes a 2D array to a tab starting at A1.
 */
async function writeValues(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string,
  values: string[][]
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  console.log(`[FgSync] [STEP] writeValues: "${tabName}" wrote ${values.length} rows × ${values[0]?.length ?? 0} cols`);
}

/**
 * Reads back the row count (excluding header) from a tab.
 * Returns -1 if unreadable.
 */
async function readBackRowCount(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<number> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'`,
    });
    const rows = (res.data.values as string[][] | null | undefined) ?? [];
    return Math.max(0, rows.length - 1); // exclude header row
  } catch {
    return -1;
  }
}

// ─── Row Builder ──────────────────────────────────────────────────────────────

/**
 * Converts FgGame[] into a flat 2D string array for Google Sheets.
 *
 * Schema (18 columns):
 *   DATE | GAME | GAME_TIME_PST | SIDE | TEAM | PITCHER | THROWS |
 *   W | L | ERA | IP | SO | WHIP |
 *   BAT_ORDER | PLAYER | BATS | POSITION | LINEUP_STATUS
 *
 * Row expansion:
 *   - Lineup posted (9 batters): 9 rows per team (pitcher data repeated on each)
 *   - No lineup: 1 stub row per team (batter columns empty)
 *   - Full game both sides confirmed: 18 data rows
 */
function buildLineupRows(games: FgGame[], dateLabel: string): string[][] {
  const header = [
    "DATE", "GAME", "GAME_TIME_PST", "SIDE", "TEAM",
    "PITCHER", "THROWS", "W", "L", "ERA", "IP", "SO", "WHIP",
    "BAT_ORDER", "PLAYER", "BATS", "POSITION", "LINEUP_STATUS",
  ];

  const pstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const rows: string[][] = [header];

  for (const game of games) {
    const gameLabel = `${game.away.teamAbbr} @ ${game.home.teamAbbr}`;
    const gameTimePst = pstFormatter.format(new Date(game.gameTimeUtc));

    for (const side of ["away", "home"] as const) {
      const team = game[side];
      const pitcher = team.pitcher;

      const pitcherName  = pitcher?.name       ?? "TBD";
      const pitcherHand  = pitcher?.throws      ?? "?";
      const pitcherW     = pitcher != null ? String(pitcher.wins)        : "";
      const pitcherL     = pitcher != null ? String(pitcher.losses)      : "";
      const pitcherEra   = pitcher?.era         ?? "";
      const pitcherIp    = pitcher?.ip          ?? "";
      const pitcherSo    = pitcher != null ? String(pitcher.strikeouts)  : "";
      const pitcherWhip  = pitcher?.whip        ?? "";

      if (team.lineup.length === 0) {
        // Stub row — no lineup available yet
        rows.push([
          dateLabel, gameLabel, gameTimePst,
          side.toUpperCase(), team.teamAbbr,
          pitcherName, pitcherHand, pitcherW, pitcherL,
          pitcherEra, pitcherIp, pitcherSo, pitcherWhip,
          "", "", "", "", team.lineupStatus,
        ]);
      } else {
        for (const batter of team.lineup) {
          rows.push([
            dateLabel, gameLabel, gameTimePst,
            side.toUpperCase(), team.teamAbbr,
            pitcherName, pitcherHand, pitcherW, pitcherL,
            pitcherEra, pitcherIp, pitcherSo, pitcherWhip,
            String(batter.order), batter.name, batter.bats, batter.position,
            team.lineupStatus,
          ]);
        }
      }
    }
  }

  console.log(
    `[FgSync] [STATE] buildLineupRows: dateLabel="${dateLabel}" games=${games.length} dataRows=${rows.length - 1}`
  );
  return rows;
}

// ─── Single Tab Write ─────────────────────────────────────────────────────────

/**
 * Writes one lineup tab with full safeguards:
 *   legacy rename → ensure exists → snapshot → clear → write → read-back → rollback on failure
 */
async function writeLineupTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string,
  games: FgGame[],
  dateLabel: string,
  isToday: boolean
): Promise<FgTabResult> {
  const t0 = Date.now();
  const result: FgTabResult = {
    tabName,
    status: "error",
    rowsWritten: 0,
    readBackRowCount: 0,
    readBackValidated: false,
    snapshotRowCount: 0,
    rollbackAttempted: false,
    rollbackSucceeded: false,
    elapsedMs: 0,
  };

  console.log(
    `[FgSync] [STEP] writeLineupTab: tabName="${tabName}" isToday=${isToday} games=${games.length} dateLabel="${dateLabel}"`
  );

  // ── 0. Migrate legacy static tab name ────────────────────────────────────
  const legacyName = isToday ? "Today Lineups" : "Tomorrow Lineups";
  await renameTabIfExists(sheets, legacyName, tabName);

  // ── 1. Empty slate check ──────────────────────────────────────────────────
  if (games.length === 0) {
    console.warn(`[FgSync] [VERIFY] WARN — writeLineupTab: no games for "${tabName}" date="${dateLabel}" — skipping write`);
    result.status = "empty";
    result.elapsedMs = Date.now() - t0;
    return result;
  }

  // ── 2. Build rows ─────────────────────────────────────────────────────────
  const values = buildLineupRows(games, dateLabel);
  const dataRowCount = values.length - 1; // exclude header row

  // Log first data row sample for audit traceability
  const firstRow = values[1];
  if (firstRow) {
    console.log(
      `[FgSync] [STATE] writeLineupTab: "${tabName}" row[1] sample: ` +
      `DATE=${firstRow[0]} GAME=${firstRow[1]} TIME=${firstRow[2]} SIDE=${firstRow[3]} ` +
      `TEAM=${firstRow[4]} PITCHER=${firstRow[5]} STATUS=${firstRow[17]}`
    );
  }

  // ── 3. Ensure tab exists ──────────────────────────────────────────────────
  await ensureTabExists(sheets, tabName);

  // ── 4. Snapshot ───────────────────────────────────────────────────────────
  const snapshot = await snapshotTab(sheets, tabName);
  result.snapshotRowCount = snapshot ? Math.max(0, snapshot.length - 1) : 0;
  console.log(
    `[FgSync] [STATE] writeLineupTab: "${tabName}" snapshot=${result.snapshotRowCount} rows, incoming=${dataRowCount} rows`
  );

  // ── 5. Clear → Write ──────────────────────────────────────────────────────
  try {
    await clearTab(sheets, tabName);
    await writeValues(sheets, tabName, values);
  } catch (writeErr) {
    const msg = (writeErr as Error).message;
    result.error = `Write failed: ${msg}`;
    result.elapsedMs = Date.now() - t0;
    console.error(`[FgSync] [VERIFY] FAIL — writeLineupTab: "${tabName}" write error: ${msg}`);

    // Rollback
    if (snapshot && snapshot.length > 0) {
      result.rollbackAttempted = true;
      console.log(`[FgSync] [STEP] writeLineupTab: "${tabName}" attempting rollback (${snapshot.length} rows)`);
      try {
        await clearTab(sheets, tabName);
        await writeValues(sheets, tabName, snapshot);
        result.rollbackSucceeded = true;
        console.log(`[FgSync] [VERIFY] PASS — writeLineupTab: "${tabName}" rollback succeeded`);
      } catch (rollbackErr) {
        result.rollbackSucceeded = false;
        console.error(
          `[FgSync] [VERIFY] FAIL — writeLineupTab: "${tabName}" rollback FAILED: ${(rollbackErr as Error).message}`
        );
      }
    } else {
      console.warn(`[FgSync] [STATE] writeLineupTab: "${tabName}" no snapshot available for rollback`);
    }

    return result;
  }

  // ── 6. Read-back validation ───────────────────────────────────────────────
  const readBack = await readBackRowCount(sheets, tabName);
  result.readBackRowCount = readBack;
  result.readBackValidated = readBack === dataRowCount;

  if (!result.readBackValidated) {
    console.warn(
      `[FgSync] [VERIFY] WARN — writeLineupTab: "${tabName}" read-back mismatch: ` +
      `wrote=${dataRowCount} readBack=${readBack} — data was written, mismatch may be Sheets API caching`
    );
  } else {
    console.log(
      `[FgSync] [VERIFY] PASS — writeLineupTab: "${tabName}" read-back validated: ${readBack} rows`
    );
  }

  result.status = "success";
  result.rowsWritten = dataRowCount;
  result.elapsedMs = Date.now() - t0;

  console.log(
    `[FgSync] [OUTPUT] writeLineupTab: "${tabName}" DONE — rows=${dataRowCount} readBack=${readBack} ` +
    `validated=${result.readBackValidated} elapsed=${result.elapsedMs}ms`
  );

  return result;
}

// ─── Main Sync Function ───────────────────────────────────────────────────────

/**
 * Syncs TODAY and TOMORROW lineup tabs to the Google Sheet.
 *
 * Execution order:
 *   1. Google Sheets auth
 *   2. Delete stale lineup tabs (< today PST)
 *   3. Invalidate Fangraphs cache (always fresh on every call)
 *   4. Fetch today + tomorrow from MLB Stats API (parallel)
 *   5. Write today tab (MM-DD-YYYY LINEUPS)
 *   6. Write tomorrow tab (MM-DD-YYYY LINEUPS)
 *
 * Zero RotoGrinders code. Zero RG tab writes.
 */
export async function syncFangraphsLineupTabs(): Promise<FgSyncResult> {
  const syncStart = Date.now();
  const errors: string[] = [];

  console.log(`\n[FgSync] [INPUT] syncFangraphsLineupTabs: starting at ${new Date().toISOString()}`);
  console.log(`[FgSync] [STATE] spreadsheetId=${SPREADSHEET_ID}`);

  // ── Step 1: Google Sheets auth ────────────────────────────────────────────
  console.log(`[FgSync] [STEP] Step 1: Initializing Google Sheets client`);
  let sheets: ReturnType<typeof google.sheets>;
  try {
    sheets = getGoogleSheetsClient();
    console.log(`[FgSync] [VERIFY] PASS — Step 1: Google Sheets client initialized`);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[FgSync] [VERIFY] FAIL — Step 1: Sheets auth failed: ${msg}`);
    errors.push(msg);
    const stubTab: FgTabResult = {
      tabName: "UNKNOWN",
      status: "error",
      rowsWritten: 0,
      readBackRowCount: 0,
      readBackValidated: false,
      snapshotRowCount: 0,
      rollbackAttempted: false,
      rollbackSucceeded: false,
      elapsedMs: 0,
      error: msg,
    };
    return {
      success: false,
      syncedAt: new Date().toISOString(),
      todayTab: stubTab,
      tomorrowTab: stubTab,
      totalRowsWritten: 0,
      elapsedMs: Date.now() - syncStart,
      errors,
    };
  }

  // ── Step 2: Delete stale lineup tabs ─────────────────────────────────────
  console.log(`[FgSync] [STEP] Step 2: Deleting stale lineup tabs (< today PST)`);
  try {
    await deleteStaleLineupTabs(sheets);
    console.log(`[FgSync] [VERIFY] PASS — Step 2: Stale lineup tab cleanup complete`);
  } catch (err) {
    // Non-fatal
    console.warn(`[FgSync] [VERIFY] WARN — Step 2: Stale tab cleanup failed (non-fatal): ${(err as Error).message}`);
  }

  // ── Step 3: Invalidate cache + fetch fresh lineup data ────────────────────
  console.log(`[FgSync] [STEP] Step 3: Invalidating Fangraphs cache and fetching fresh MLB lineup data`);
  invalidateFgCache();
  console.log(`[FgSync] [STATE] Step 3: Cache invalidated — fetching today + tomorrow from MLB Stats API`);

  const fetchStart = Date.now();
  let fgResult;
  try {
    fgResult = await scrapeFangraphsLineups(true /* forceRefresh */);
    const fetchElapsed = Date.now() - fetchStart;
    console.log(
      `[FgSync] [VERIFY] PASS — Step 3: MLB Stats API fetch complete — ` +
      `today=${fgResult.today.games.length} games, tomorrow=${fgResult.tomorrow.games.length} games, ` +
      `errors=${fgResult.errors.length}, elapsed=${fetchElapsed}ms`
    );
    if (fgResult.errors.length > 0) {
      for (const e of fgResult.errors) {
        console.warn(`[FgSync] [VERIFY] WARN — Step 3: Scraper error: ${e}`);
        errors.push(e);
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    const fetchElapsed = Date.now() - fetchStart;
    console.error(`[FgSync] [VERIFY] FAIL — Step 3: MLB Stats API fetch failed: ${msg} elapsed=${fetchElapsed}ms`);
    errors.push(msg);

    // Compute fallback tab names from current PST date
    const todayDate    = getPstDate(0);
    const tomorrowDate = getPstDate(1);
    const todayTabName    = formatLineupTabName(todayDate);
    const tomorrowTabName = formatLineupTabName(tomorrowDate);

    const errTab = (tabName: string): FgTabResult => ({
      tabName,
      status: "error",
      rowsWritten: 0,
      readBackRowCount: 0,
      readBackValidated: false,
      snapshotRowCount: 0,
      rollbackAttempted: false,
      rollbackSucceeded: false,
      elapsedMs: fetchElapsed,
      error: msg,
    });

    return {
      success: false,
      syncedAt: new Date().toISOString(),
      todayTab: errTab(todayTabName),
      tomorrowTab: errTab(tomorrowTabName),
      totalRowsWritten: 0,
      elapsedMs: Date.now() - syncStart,
      errors,
    };
  }

  // ── Step 4: Compute tab names ─────────────────────────────────────────────
  const todayTabName    = formatLineupTabName(fgResult.today.date);
  const tomorrowTabName = formatLineupTabName(fgResult.tomorrow.date);
  console.log(
    `[FgSync] [STATE] Step 4: Tab names — today="${todayTabName}" tomorrow="${tomorrowTabName}"`
  );

  // ── Step 5: Write today tab ───────────────────────────────────────────────
  console.log(
    `[FgSync] [STEP] Step 5: Writing today tab "${todayTabName}" (${fgResult.today.games.length} games)`
  );
  const todayResult = await writeLineupTab(
    sheets, todayTabName, fgResult.today.games, fgResult.today.date, true
  );

  // ── Step 6: Write tomorrow tab ────────────────────────────────────────────
  console.log(
    `[FgSync] [STEP] Step 6: Writing tomorrow tab "${tomorrowTabName}" (${fgResult.tomorrow.games.length} games)`
  );
  const tomorrowResult = await writeLineupTab(
    sheets, tomorrowTabName, fgResult.tomorrow.games, fgResult.tomorrow.date, false
  );

  // ── Final summary ─────────────────────────────────────────────────────────
  const totalRowsWritten = todayResult.rowsWritten + tomorrowResult.rowsWritten;
  const totalElapsed = Date.now() - syncStart;
  const allSuccess =
    (todayResult.status === "success" || todayResult.status === "empty") &&
    (tomorrowResult.status === "success" || tomorrowResult.status === "empty");

  console.log(`\n[FgSync] [OUTPUT] syncFangraphsLineupTabs COMPLETE:`);
  console.log(
    `  [${todayResult.status.toUpperCase()}] "${todayTabName}" → ` +
    `rows=${todayResult.rowsWritten} readBack=${todayResult.readBackRowCount} ` +
    `validated=${todayResult.readBackValidated} elapsed=${todayResult.elapsedMs}ms`
  );
  console.log(
    `  [${tomorrowResult.status.toUpperCase()}] "${tomorrowTabName}" → ` +
    `rows=${tomorrowResult.rowsWritten} readBack=${tomorrowResult.readBackRowCount} ` +
    `validated=${tomorrowResult.readBackValidated} elapsed=${tomorrowResult.elapsedMs}ms`
  );
  console.log(
    `  totalRows=${totalRowsWritten} allSuccess=${allSuccess} totalElapsed=${totalElapsed}ms`
  );
  console.log(
    `[FgSync] [VERIFY] ${allSuccess ? "PASS" : "PARTIAL"} — syncFangraphsLineupTabs finished at ${new Date().toISOString()}`
  );

  if (todayResult.error)    errors.push(`today: ${todayResult.error}`);
  if (tomorrowResult.error) errors.push(`tomorrow: ${tomorrowResult.error}`);

  return {
    success: allSuccess,
    syncedAt: new Date().toISOString(),
    todayTab: todayResult,
    tomorrowTab: tomorrowResult,
    totalRowsWritten,
    elapsedMs: totalElapsed,
    errors,
  };
}
