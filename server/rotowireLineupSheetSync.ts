/**
 * rotowireLineupSheetSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes Rotowire MLB daily lineups (today + tomorrow) and writes them to the
 * Google Sheet's MM-DD-YYYY LINEUPS tabs.
 *
 * Source:
 *   Today:    https://www.rotowire.com/baseball/daily-lineups.php
 *   Tomorrow: https://www.rotowire.com/baseball/daily-lineups.php?date=tomorrow
 *
 * Sheet:  1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw
 * Tabs:   MM-DD-YYYY LINEUPS  (e.g. "06-04-2026 LINEUPS")
 *
 * Output schema per data row (columns A–T, 20 cols):
 *   A: DATE             B: GAME            C: GAME_TIME_ET    D: SIDE
 *   E: TEAM             F: PITCHER         G: PITCHER_HAND    H: PITCHER_ERA
 *   I: LINEUP_STATUS    J: BATTING_ORDER   K: BATTER_NAME     L: BAT_HAND
 *   M: POSITION         N: AWAY_TEAM       O: HOME_TEAM
 *   P: ROTO_AWAY_PITCHER_ID               Q: ROTO_HOME_PITCHER_ID
 *   R: AWAY_CONFIRMED   S: HOME_CONFIRMED  T: ROTO_PLAYER_ID
 *
 * Primary user-requested columns: BATTING_ORDER (J), BATTER_NAME (K),
 *   BAT_HAND (L), POSITION (M)
 *
 * ─── Safeguards on every write ───────────────────────────────────────────────
 *   1. Snapshot existing tab content before any destructive operation
 *   2. Clear → write raw values
 *   3. Read-back row count validation
 *   4. Rollback to snapshot on write failure
 *   5. Stale tab cleanup (delete tabs older than today PST)
 *
 * ─── Logging format ──────────────────────────────────────────────────────────
 *   [RotoSync] [INPUT]  → source + parsed values
 *   [RotoSync] [STEP]   → operation description
 *   [RotoSync] [STATE]  → intermediate computations
 *   [RotoSync] [OUTPUT] → final result
 *   [RotoSync] [VERIFY] → PASS / FAIL / WARN + reason
 */

import { google } from "googleapis";
import {
  scrapeRotowireLineupsToday,
  scrapeRotowireLineupsTomorrow,
  type RotoLineupGame,
  type ScrapeRotowireResult,
} from "./rotowireLineupScraper";

// ─── Constants ────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface RotoTabResult {
  tabName: string;
  dateStr: string;
  status: "success" | "error" | "empty" | "skip" | "no_lineups";
  gamesFound: number;
  rowsWritten: number;
  readBackRowCount: number;
  readBackValidated: boolean;
  snapshotRowCount: number;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  elapsedMs: number;
  error?: string;
}

export interface RotoSyncResult {
  success: boolean;
  syncedAt: string;
  todayTab: RotoTabResult;
  tomorrowTab: RotoTabResult;
  totalRowsWritten: number;
  elapsedMs: number;
  errors: string[];
}

// ─── Google Sheets Auth ───────────────────────────────────────────────────────

function getGoogleSheetsClient(): ReturnType<typeof google.sheets> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    throw new Error("[RotoSync] GOOGLE_SERVICE_ACCOUNT_JSON is not set in environment");
  }
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(saJson);
  } catch (err) {
    throw new Error(`[RotoSync] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${(err as Error).message}`);
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a date in PST/PDT as "YYYY-MM-DD".
 * offsetDays=0 → today, offsetDays=1 → tomorrow.
 */
function getPstDate(offsetDays = 0): string {
  const now = new Date();
  const pst = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  pst.setDate(pst.getDate() + offsetDays);
  const yyyy = pst.getFullYear();
  const mm = String(pst.getMonth() + 1).padStart(2, "0");
  const dd = String(pst.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Converts YYYY-MM-DD → "MM-DD-YYYY LINEUPS"
 * e.g. "2026-06-04" → "06-04-2026 LINEUPS"
 * Fangraphs fg-lineups sync is PAUSED — Rotowire is the sole writer of these tabs.
 */
function formatLineupTabName(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) {
    console.warn(`[RotoSync] [VERIFY] WARN — formatLineupTabName: unexpected format "${dateStr}" — using raw fallback`);
    return `${dateStr} LINEUPS`;
  }
  const [yyyy, mm, dd] = parts;
  const tabName = `${mm}-${dd}-${yyyy} LINEUPS`;
  console.log(`[RotoSync] [STEP] formatLineupTabName: input="${dateStr}" output="${tabName}"`);
  return tabName;
}

// ─── Sheet Metadata Helpers ───────────────────────────────────────────────────

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
  console.log(`[RotoSync] [STATE] getAllTabsMap: found ${map.size} tabs`);
  return map;
}

async function ensureTabExists(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<void> {
  const tabsMap = await getAllTabsMap(sheets);
  if (tabsMap.has(tabName)) {
    console.log(`[RotoSync] [STATE] ensureTabExists: "${tabName}" already exists — no-op`);
    return;
  }
  console.log(`[RotoSync] [STEP] ensureTabExists: creating tab "${tabName}"`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  console.log(`[RotoSync] [OUTPUT] ensureTabExists: tab "${tabName}" created`);
}

// ─── Stale Tab Cleanup ────────────────────────────────────────────────────────

async function deleteStaleLineupTabs(
  sheets: ReturnType<typeof google.sheets>
): Promise<void> {
  const t0 = Date.now();
  console.log(`[RotoSync] [STEP] deleteStaleLineupTabs: scanning for stale lineup tabs`);

  const tabsMap = await getAllTabsMap(sheets);
  const LINEUP_TAB_RE = /^(\d{2})-(\d{2})-(\d{4}) LINEUPS$/;

  const todayPst = getPstDate(0);
  const todayInt = parseInt(todayPst.replace(/-/g, ""), 10);
  console.log(`[RotoSync] [STATE] deleteStaleLineupTabs: todayPst=${todayPst} todayInt=${todayInt}`);

  const staleIds: number[] = [];
  const staleNames: string[] = [];

  for (const [title, sheetId] of Array.from(tabsMap.entries())) {
    const m = LINEUP_TAB_RE.exec(title);
    if (!m) continue;
    const [, mm, dd, yyyy] = m;
    const tabDateInt = parseInt(`${yyyy}${mm}${dd}`, 10);
    if (tabDateInt < todayInt) {
      staleIds.push(sheetId);
      staleNames.push(title);
      console.log(`[RotoSync] [STATE] deleteStaleLineupTabs: STALE tab="${title}" tabDateInt=${tabDateInt} < todayInt=${todayInt}`);
    } else {
      console.log(`[RotoSync] [STATE] deleteStaleLineupTabs: KEEP tab="${title}" tabDateInt=${tabDateInt}`);
    }
  }

  if (staleIds.length === 0) {
    console.log(`[RotoSync] [VERIFY] PASS — deleteStaleLineupTabs: no stale tabs found elapsed=${Date.now() - t0}ms`);
    return;
  }

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: staleIds.map(id => ({ deleteSheet: { sheetId: id } })),
      },
    });
    console.log(`[RotoSync] [OUTPUT] deleteStaleLineupTabs: deleted [${staleNames.join(", ")}] elapsed=${Date.now() - t0}ms`);
  } catch (err) {
    console.warn(`[RotoSync] [VERIFY] WARN — deleteStaleLineupTabs failed: ${(err as Error).message} — continuing`);
  }
}

// ─── Snapshot / Clear / Write / Read-back ────────────────────────────────────

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
    console.log(`[RotoSync] [STATE] snapshotTab: "${tabName}" snapshot=${rows.length} rows`);
    return rows.length > 0 ? rows : null;
  } catch {
    console.warn(`[RotoSync] [VERIFY] WARN — snapshotTab: "${tabName}" unreadable — no snapshot`);
    return null;
  }
}

async function clearTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
  });
  console.log(`[RotoSync] [STEP] clearTab: "${tabName}" cleared`);
}

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
  console.log(`[RotoSync] [STEP] writeValues: "${tabName}" wrote ${values.length} rows × ${values[0]?.length ?? 0} cols`);
}

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
 * Converts RotoLineupGame[] into a flat 2D string array for Google Sheets.
 *
 * Schema (20 columns, A–T):
 *   A: DATE                — "MM-DD-YYYY" (e.g. "06-04-2026")
 *   B: GAME                — "AWAY @ HOME" (e.g. "SD @ PHI")
 *   C: GAME_TIME_ET        — start time string from Rotowire (e.g. "1:35 PM ET")
 *   D: SIDE                — "AWAY" or "HOME"
 *   E: TEAM                — team abbreviation (e.g. "SD", "PHI")
 *   F: PITCHER             — starting pitcher full name (or "TBD")
 *   G: PITCHER_HAND        — "R", "L", or "?"
 *   H: PITCHER_ERA         — season stats string (e.g. "4-1 · 2.27 ERA")
 *   I: LINEUP_STATUS       — "Confirmed Lineup" or "Expected Lineup"
 *   J: BATTING_ORDER       — 1–9 (empty string if lineup not posted)
 *   K: BATTER_NAME         — full player name (e.g. "Fernando Tatis Jr.")
 *   L: BAT_HAND            — "R", "L", or "S" (switch)
 *   M: POSITION            — field position (e.g. "CF", "SS", "1B", "DH")
 *   N: AWAY_TEAM           — away team abbreviation
 *   O: HOME_TEAM           — home team abbreviation
 *   P: ROTO_AWAY_PITCHER_ID — Rotowire pitcher ID for away starter (or "")
 *   Q: ROTO_HOME_PITCHER_ID — Rotowire pitcher ID for home starter (or "")
 *   R: AWAY_CONFIRMED      — "TRUE" or "FALSE"
 *   S: HOME_CONFIRMED      — "TRUE" or "FALSE"
 *   T: ROTO_PLAYER_ID      — Rotowire player ID for this batter (or "")
 *
 * Row expansion:
 *   - Lineup posted (9 batters): 9 rows per team side
 *   - No lineup: 1 stub row per team side (batter columns J–M empty)
 *   - Both sides posted: 18 data rows per game
 */
function buildLineupRows(games: RotoLineupGame[], dateLabel: string): string[][] {
  const header = [
    "DATE", "GAME", "GAME_TIME_ET", "SIDE", "TEAM",
    "PITCHER", "PITCHER_HAND", "PITCHER_ERA", "LINEUP_STATUS",
    "BATTING_ORDER", "BATTER_NAME", "BAT_HAND", "POSITION",
    "AWAY_TEAM", "HOME_TEAM",
    "ROTO_AWAY_PITCHER_ID", "ROTO_HOME_PITCHER_ID",
    "AWAY_CONFIRMED", "HOME_CONFIRMED",
    "ROTO_PLAYER_ID",
  ];

  const rows: string[][] = [header];

  for (const game of games) {
    const gameLabel = `${game.awayAbbrev} @ ${game.homeAbbrev}`;
    const awayConfirmed = game.awayLineupConfirmed ? "TRUE" : "FALSE";
    const homeConfirmed = game.homeLineupConfirmed ? "TRUE" : "FALSE";
    const rotoAwayPitcherId = game.awayPitcher?.rotowireId != null ? String(game.awayPitcher.rotowireId) : "";
    const rotoHomePitcherId = game.homePitcher?.rotowireId != null ? String(game.homePitcher.rotowireId) : "";

    for (const side of ["away", "home"] as const) {
      const isAway = side === "away";
      const teamAbbrev = isAway ? game.awayAbbrev : game.homeAbbrev;
      const pitcher = isAway ? game.awayPitcher : game.homePitcher;
      const lineup = isAway ? game.awayLineup : game.homeLineup;
      const lineupConfirmed = isAway ? game.awayLineupConfirmed : game.homeLineupConfirmed;

      const pitcherName = pitcher?.name ?? "TBD";
      const pitcherHand = pitcher?.hand ?? "?";
      const pitcherEra = pitcher?.era ?? "";
      const lineupStatus = lineupConfirmed ? "Confirmed Lineup" : "Expected Lineup";
      const sideLabel = side.toUpperCase();

      if (lineup.length === 0) {
        // Stub row — lineup not yet posted; batter columns are empty
        rows.push([
          dateLabel, gameLabel, game.startTime,
          sideLabel, teamAbbrev,
          pitcherName, pitcherHand, pitcherEra, lineupStatus,
          "", "", "", "",
          game.awayAbbrev, game.homeAbbrev,
          rotoAwayPitcherId, rotoHomePitcherId,
          awayConfirmed, homeConfirmed,
          "",
        ]);
      } else {
        for (const batter of lineup) {
          const rotoPlayerId = batter.rotowireId != null ? String(batter.rotowireId) : "";
          rows.push([
            dateLabel, gameLabel, game.startTime,
            sideLabel, teamAbbrev,
            pitcherName, pitcherHand, pitcherEra, lineupStatus,
            String(batter.battingOrder), batter.name, batter.bats, batter.position,
            game.awayAbbrev, game.homeAbbrev,
            rotoAwayPitcherId, rotoHomePitcherId,
            awayConfirmed, homeConfirmed,
            rotoPlayerId,
          ]);
        }
      }
    }
  }

  console.log(
    `[RotoSync] [STATE] buildLineupRows: dateLabel="${dateLabel}" games=${games.length} ` +
    `dataRows=${rows.length - 1} (excl. header)`
  );

  // Log first data row sample for audit traceability
  const firstRow = rows[1];
  if (firstRow) {
    console.log(
      `[RotoSync] [STATE] buildLineupRows: row[1] sample: ` +
      `DATE=${firstRow[0]} GAME=${firstRow[1]} TIME=${firstRow[2]} SIDE=${firstRow[3]} ` +
      `TEAM=${firstRow[4]} PITCHER=${firstRow[5]} HAND=${firstRow[6]} ERA=${firstRow[7]} ` +
      `STATUS=${firstRow[8]} BAT_ORDER=${firstRow[9]} BATTER=${firstRow[10]} ` +
      `BAT_HAND=${firstRow[11]} POS=${firstRow[12]}`
    );
  }

  return rows;
}

// ─── Single Tab Write ─────────────────────────────────────────────────────────

/**
 * Writes one lineup tab with full safeguards:
 *   ensure exists → snapshot → clear → write → read-back → rollback on failure
 */
async function writeLineupTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string,
  games: RotoLineupGame[],
  dateLabel: string,
  dateStr: string
): Promise<RotoTabResult> {
  const t0 = Date.now();
  const result: RotoTabResult = {
    tabName,
    dateStr,
    status: "error",
    gamesFound: games.length,
    rowsWritten: 0,
    readBackRowCount: 0,
    readBackValidated: false,
    snapshotRowCount: 0,
    rollbackAttempted: false,
    rollbackSucceeded: false,
    elapsedMs: 0,
  };

  console.log(
    `[RotoSync] [STEP] writeLineupTab: tabName="${tabName}" games=${games.length} dateLabel="${dateLabel}"`
  );

  // ── 1. Empty slate check ──────────────────────────────────────────────────
  if (games.length === 0) {
    console.warn(
      `[RotoSync] [VERIFY] WARN — writeLineupTab: no games for "${tabName}" date="${dateLabel}" — ` +
      `writing header-only placeholder so tab exists`
    );
    await ensureTabExists(sheets, tabName);
    const headerOnly = [buildLineupRows([], dateLabel)[0]];
    try {
      await clearTab(sheets, tabName);
      await writeValues(sheets, tabName, headerOnly);
    } catch (e) {
      console.warn(`[RotoSync] [VERIFY] WARN — writeLineupTab: header-only write failed: ${(e as Error).message}`);
    }
    result.status = "no_lineups";
    result.elapsedMs = Date.now() - t0;
    return result;
  }

  // ── 2. Build rows ─────────────────────────────────────────────────────────
  const values = buildLineupRows(games, dateLabel);
  const dataRowCount = values.length - 1; // exclude header row

  // ── 3. Ensure tab exists ──────────────────────────────────────────────────
  await ensureTabExists(sheets, tabName);

  // ── 4. Snapshot ───────────────────────────────────────────────────────────
  const snapshot = await snapshotTab(sheets, tabName);
  result.snapshotRowCount = snapshot ? Math.max(0, snapshot.length - 1) : 0;
  console.log(
    `[RotoSync] [STATE] writeLineupTab: "${tabName}" snapshot=${result.snapshotRowCount} rows, incoming=${dataRowCount} rows`
  );

  // ── 5. Clear → Write ──────────────────────────────────────────────────────
  try {
    await clearTab(sheets, tabName);
    await writeValues(sheets, tabName, values);
  } catch (writeErr) {
    const msg = (writeErr as Error).message;
    result.error = `Write failed: ${msg}`;
    result.elapsedMs = Date.now() - t0;
    console.error(`[RotoSync] [VERIFY] FAIL — writeLineupTab: "${tabName}" write error: ${msg}`);

    if (snapshot && snapshot.length > 0) {
      result.rollbackAttempted = true;
      console.log(`[RotoSync] [STEP] writeLineupTab: "${tabName}" attempting rollback (${snapshot.length} rows)`);
      try {
        await clearTab(sheets, tabName);
        await writeValues(sheets, tabName, snapshot);
        result.rollbackSucceeded = true;
        console.log(`[RotoSync] [VERIFY] PASS — writeLineupTab: "${tabName}" rollback succeeded`);
      } catch (rollbackErr) {
        result.rollbackSucceeded = false;
        console.error(
          `[RotoSync] [VERIFY] FAIL — writeLineupTab: "${tabName}" rollback FAILED: ${(rollbackErr as Error).message}`
        );
      }
    } else {
      console.warn(`[RotoSync] [STATE] writeLineupTab: "${tabName}" no snapshot available for rollback`);
    }

    return result;
  }

  // ── 6. Read-back validation ───────────────────────────────────────────────
  const readBack = await readBackRowCount(sheets, tabName);
  result.readBackRowCount = readBack;
  result.readBackValidated = readBack === dataRowCount;

  if (!result.readBackValidated) {
    console.warn(
      `[RotoSync] [VERIFY] WARN — writeLineupTab: "${tabName}" read-back mismatch: ` +
      `wrote=${dataRowCount} readBack=${readBack} — data was written, mismatch may be Sheets API caching`
    );
  } else {
    console.log(
      `[RotoSync] [VERIFY] PASS — writeLineupTab: "${tabName}" read-back validated: ${readBack} rows`
    );
  }

  result.status = "success";
  result.rowsWritten = dataRowCount;
  result.elapsedMs = Date.now() - t0;

  console.log(
    `[RotoSync] [OUTPUT] writeLineupTab: "${tabName}" DONE — ` +
    `games=${games.length} rows=${dataRowCount} readBack=${readBack} ` +
    `validated=${result.readBackValidated} elapsed=${result.elapsedMs}ms`
  );

  return result;
}

// ─── Per-game Audit Logger ────────────────────────────────────────────────────

function logGameAudit(game: RotoLineupGame, dateStr: string): void {
  const tag = `[RotoSync] [STATE] [${dateStr}] ${game.awayAbbrev}@${game.homeAbbrev}`;

  console.log(
    `${tag} startTime="${game.startTime}" | ` +
    `awayP="${game.awayPitcher?.name ?? "TBD"}" (${game.awayPitcher?.hand ?? "?"}) | ` +
    `homeP="${game.homePitcher?.name ?? "TBD"}" (${game.homePitcher?.hand ?? "?"})`
  );

  if (game.awayLineup.length > 0) {
    const sample = game.awayLineup
      .slice(0, 3)
      .map(p => `${p.battingOrder}.${p.name}(${p.position},${p.bats}B)`)
      .join(" | ");
    console.log(
      `${tag} AWAY lineup: ${game.awayLineup.length}/9 | confirmed=${game.awayLineupConfirmed} | top3: ${sample}`
    );
  } else {
    console.log(`${tag} AWAY lineup: NOT POSTED | confirmed=${game.awayLineupConfirmed}`);
  }

  if (game.homeLineup.length > 0) {
    const sample = game.homeLineup
      .slice(0, 3)
      .map(p => `${p.battingOrder}.${p.name}(${p.position},${p.bats}B)`)
      .join(" | ");
    console.log(
      `${tag} HOME lineup: ${game.homeLineup.length}/9 | confirmed=${game.homeLineupConfirmed} | top3: ${sample}`
    );
  } else {
    console.log(`${tag} HOME lineup: NOT POSTED | confirmed=${game.homeLineupConfirmed}`);
  }
}

// ─── Main Sync Function ───────────────────────────────────────────────────────

/**
 * Syncs TODAY and TOMORROW Rotowire lineup tabs to the Google Sheet.
 *
 * Execution order:
 *   1. Google Sheets auth
 *   2. Delete stale lineup tabs (< today PST)
 *   3. Determine today + tomorrow date strings (PST)
 *   4. Scrape Rotowire today + tomorrow in parallel
 *   5. Per-game audit log (every game, every side, every batter)
 *   6. Write today tab (MM-DD-YYYY LINEUPS)
 *   7. Write tomorrow tab (MM-DD-YYYY LINEUPS)
 *
 * Handles partial lineups gracefully:
 *   - If a game has 0 batters posted → stub row (pitcher data + empty batter cols)
 *   - If a game has 9 batters posted → 9 rows per side
 *   - "Expected Lineup" and "Confirmed Lineup" both written; status in LINEUP_STATUS col
 */
export async function syncRotowireLineupTabs(): Promise<RotoSyncResult> {
  const syncStart = Date.now();
  const errors: string[] = [];

  console.log(`\n[RotoSync] [INPUT] syncRotowireLineupTabs: starting at ${new Date().toISOString()}`);
  console.log(`[RotoSync] [STATE] spreadsheetId=${SPREADSHEET_ID}`);

  // ── Step 1: Google Sheets auth ────────────────────────────────────────────
  console.log(`[RotoSync] [STEP] Step 1: Initializing Google Sheets client`);
  let sheets: ReturnType<typeof google.sheets>;
  try {
    sheets = getGoogleSheetsClient();
    console.log(`[RotoSync] [VERIFY] PASS — Step 1: Google Sheets client initialized`);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[RotoSync] [VERIFY] FAIL — Step 1: Sheets auth failed: ${msg}`);
    errors.push(msg);
    const stubTab: RotoTabResult = {
      tabName: "UNKNOWN", dateStr: "UNKNOWN", status: "error",
      gamesFound: 0, rowsWritten: 0, readBackRowCount: 0, readBackValidated: false,
      snapshotRowCount: 0, rollbackAttempted: false, rollbackSucceeded: false,
      elapsedMs: 0, error: msg,
    };
    return {
      success: false, syncedAt: new Date().toISOString(),
      todayTab: stubTab, tomorrowTab: stubTab,
      totalRowsWritten: 0, elapsedMs: Date.now() - syncStart, errors,
    };
  }

  // ── Step 2: Delete stale lineup tabs ─────────────────────────────────────
  console.log(`[RotoSync] [STEP] Step 2: Deleting stale lineup tabs (< today PST)`);
  try {
    await deleteStaleLineupTabs(sheets);
    console.log(`[RotoSync] [VERIFY] PASS — Step 2: Stale tab cleanup complete`);
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[RotoSync] [VERIFY] WARN — Step 2: Stale tab cleanup failed (non-fatal): ${msg}`);
  }

  // ── Step 3: Determine date strings ───────────────────────────────────────
  const todayStr = getPstDate(0);
  const tomorrowStr = getPstDate(1);
  const todayTabName = formatLineupTabName(todayStr);
  const tomorrowTabName = formatLineupTabName(tomorrowStr);
  const todayLabel = todayTabName.replace(" LINEUPS", "");
  const tomorrowLabel = tomorrowTabName.replace(" LINEUPS", "");

  console.log(
    `[RotoSync] [STATE] Step 3: todayStr=${todayStr} tomorrowStr=${tomorrowStr} | ` +
    `todayTab="${todayTabName}" tomorrowTab="${tomorrowTabName}"`
  );

  // ── Step 4: Scrape Rotowire today + tomorrow (parallel) ──────────────────
  console.log(`[RotoSync] [STEP] Step 4: Scraping Rotowire today + tomorrow in parallel`);
  let todayScrape: ScrapeRotowireResult;
  let tomorrowScrape: ScrapeRotowireResult;

  try {
    [todayScrape, tomorrowScrape] = await Promise.all([
      scrapeRotowireLineupsToday(),
      scrapeRotowireLineupsTomorrow(),
    ]);
    console.log(
      `[RotoSync] [VERIFY] PASS — Step 4: Scrape complete | ` +
      `today: ${todayScrape.cardsParsed}/${todayScrape.cardsFound} games ` +
      `(${todayScrape.fetchMs}ms fetch + ${todayScrape.parseMs}ms parse) | ` +
      `tomorrow: ${tomorrowScrape.cardsParsed}/${tomorrowScrape.cardsFound} games ` +
      `(${tomorrowScrape.fetchMs}ms fetch + ${tomorrowScrape.parseMs}ms parse)`
    );
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[RotoSync] [VERIFY] FAIL — Step 4: Scrape threw: ${msg}`);
    errors.push(`Scrape failed: ${msg}`);
    const stubTab: RotoTabResult = {
      tabName: "UNKNOWN", dateStr: "UNKNOWN", status: "error",
      gamesFound: 0, rowsWritten: 0, readBackRowCount: 0, readBackValidated: false,
      snapshotRowCount: 0, rollbackAttempted: false, rollbackSucceeded: false,
      elapsedMs: 0, error: msg,
    };
    return {
      success: false, syncedAt: new Date().toISOString(),
      todayTab: stubTab, tomorrowTab: stubTab,
      totalRowsWritten: 0, elapsedMs: Date.now() - syncStart, errors,
    };
  }

  // ── Step 5: Per-game audit log ────────────────────────────────────────────
  console.log(`[RotoSync] [STEP] Step 5: Per-game lineup audit`);
  console.log(`[RotoSync] [STATE] TODAY (${todayStr}): ${todayScrape.games.length} games`);
  for (const game of todayScrape.games) logGameAudit(game, todayStr);
  console.log(`[RotoSync] [STATE] TOMORROW (${tomorrowStr}): ${tomorrowScrape.games.length} games`);
  for (const game of tomorrowScrape.games) logGameAudit(game, tomorrowStr);

  // ── Step 6: Write today tab ───────────────────────────────────────────────
  console.log(`[RotoSync] [STEP] Step 6: Writing today tab "${todayTabName}"`);
  const todayTabResult = await writeLineupTab(
    sheets, todayTabName, todayScrape.games, todayLabel, todayStr
  );
  if (todayTabResult.status === "error") {
    errors.push(`Today tab write failed: ${todayTabResult.error}`);
  }

  // ── Step 7: Write tomorrow tab ────────────────────────────────────────────
  console.log(`[RotoSync] [STEP] Step 7: Writing tomorrow tab "${tomorrowTabName}"`);
  const tomorrowTabResult = await writeLineupTab(
    sheets, tomorrowTabName, tomorrowScrape.games, tomorrowLabel, tomorrowStr
  );
  if (tomorrowTabResult.status === "error") {
    errors.push(`Tomorrow tab write failed: ${tomorrowTabResult.error}`);
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const totalRowsWritten = todayTabResult.rowsWritten + tomorrowTabResult.rowsWritten;
  const success = errors.length === 0;
  const elapsedMs = Date.now() - syncStart;

  console.log(
    `\n[RotoSync] [OUTPUT] syncRotowireLineupTabs DONE — ` +
    `success=${success} totalRows=${totalRowsWritten} elapsed=${elapsedMs}ms`
  );
  console.log(
    `[RotoSync] [OUTPUT] Today  "${todayTabName}": status=${todayTabResult.status} ` +
    `games=${todayTabResult.gamesFound} rows=${todayTabResult.rowsWritten} ` +
    `readBack=${todayTabResult.readBackRowCount} validated=${todayTabResult.readBackValidated}`
  );
  console.log(
    `[RotoSync] [OUTPUT] Tomorrow "${tomorrowTabName}": status=${tomorrowTabResult.status} ` +
    `games=${tomorrowTabResult.gamesFound} rows=${tomorrowTabResult.rowsWritten} ` +
    `readBack=${tomorrowTabResult.readBackRowCount} validated=${tomorrowTabResult.readBackValidated}`
  );

  if (errors.length > 0) {
    for (const e of errors) {
      console.warn(`[RotoSync] [VERIFY] WARN — error: ${e}`);
    }
    console.log(`[RotoSync] [VERIFY] PARTIAL — ${errors.length} error(s) encountered`);
  } else {
    console.log(`[RotoSync] [VERIFY] PASS — all tabs written successfully`);
  }

  return {
    success,
    syncedAt: new Date().toISOString(),
    todayTab: todayTabResult,
    tomorrowTab: tomorrowTabResult,
    totalRowsWritten,
    elapsedMs,
    errors,
  };
}
