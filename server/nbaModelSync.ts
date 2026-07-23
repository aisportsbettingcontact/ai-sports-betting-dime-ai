/**
 * NBA Model Sheet Sync
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches the DC_Context_adj sheet from Google Sheets every 3 hours
 * between 9AM and midnight PST, then syncs model projections into the
 * games table for each NBA game on that date.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1MWNh0pMkFdUfldhXj60bq9blLPXCg5N5fKh7yYMI0gU
 * Tab:   DC_Context_adj (gid=567059198)
 *
 * Column mapping (0-indexed, matches spreadsheet letter columns A–T):
 *   A  (0)  = date (YYYYMMDD)
 *   B  (1)  = matchup_key (e.g. "BOS@CLE")
 *   C  (2)  = away_team abbreviation (e.g. "BOS")
 *   D  (3)  = home_team abbreviation (e.g. "CLE")
 *   I  (8)  = Final_Proj_Total_Display (model total, e.g. "236.5")
 *   J  (9)  = Final_Favorite (favorite team abbreviation, e.g. "NYK" or "PK")
 *   L  (11) = Underdog_Team (underdog abbreviation, e.g. "LAL")
 *   M  (12) = Favorite_Spread_Display (e.g. "-6.5", "PK")
 *   N  (13) = Underdog_Spread_Display (e.g. "6.5", "PK")
 *   S  (18) = Fair_ML_Home (e.g. "115", "270", "-320")
 *   T  (19) = Fair_ML_Away (e.g. "-115", "-270", "320")
 */

import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { ENV } from "./_core/env";

/** In-memory record of the last completed sync */
export interface NbaModelSyncResult {
  synced: number;
  skipped: number;
  errors: string[];
  syncedAt: string; // ISO timestamp
}

let lastSyncResult: NbaModelSyncResult | null = null;

export function getLastNbaModelSyncResult(): NbaModelSyncResult | null {
  return lastSyncResult;
}

// ─── Startup guard: NBA_SHEET_ID must be set ─────────────────────────────────
// [INPUT]  ENV.nbaSheetId — sourced from NBA_SHEET_ID environment variable
// [VERIFY] If missing, all NBA model syncs will be skipped with a critical error.
//          Set NBA_SHEET_ID in Railway service variables or GitHub repository secrets.
const SHEET_ID = ENV.nbaSheetId;
if (!SHEET_ID) {
  console.error(
    "[NBAModelSync] [CRITICAL] NBA_SHEET_ID environment variable is NOT SET. " +
    "The NBA model sync pipeline is DISABLED. " +
    "All syncNbaModelFromSheet() calls will return immediately with an error. " +
    "Action required: set NBA_SHEET_ID in Railway service variables (or GitHub repository secrets)."
  );
}
const GID = "567059198";
const CSV_URL = SHEET_ID
  ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`
  : "";

// 3-letter abbreviation → NBA dbSlug mapping
const ABBREV_TO_SLUG: Record<string, string> = {
  ATL: "atlanta_hawks",
  BOS: "boston_celtics",
  BKN: "brooklyn_nets",
  CHA: "charlotte_hornets",
  CHI: "chicago_bulls",
  CLE: "cleveland_cavaliers",
  DAL: "dallas_mavericks",
  DEN: "denver_nuggets",
  DET: "detroit_pistons",
  GSW: "golden_state_warriors",
  GS:  "golden_state_warriors",
  HOU: "houston_rockets",
  IND: "indiana_pacers",
  LAC: "los_angeles_clippers",
  LAL: "los_angeles_lakers",
  MEM: "memphis_grizzlies",
  MIA: "miami_heat",
  MIL: "milwaukee_bucks",
  MIN: "minnesota_timberwolves",
  NOP: "new_orleans_pelicans",
  NO:  "new_orleans_pelicans",
  NYK: "new_york_knicks",
  NY:  "new_york_knicks",
  OKC: "oklahoma_city_thunder",
  ORL: "orlando_magic",
  PHI: "philadelphia_76ers",
  PHX: "phoenix_suns",
  POR: "portland_trail_blazers",
  SAC: "sacramento_kings",
  SAS: "san_antonio_spurs",
  SA:  "san_antonio_spurs",
  TOR: "toronto_raptors",
  UTA: "utah_jazz",
  WAS: "washington_wizards",
};

/** Format a moneyline integer as a string (e.g. 115 → "+115", -320 → "-320") */
function formatML(val: number): string {
  if (val > 0) return `+${val}`;
  return String(val);
}

/** Compute edge fields from model vs book data */
function computeEdges(
  awayBookSpread: string | null,
  homeBookSpread: string | null,
  bookTotal: string | null,
  awayModelSpread: number,
  homeModelSpread: number,
  modelTotal: number,
  awaySlug: string,
  homeSlug: string
): { spreadEdge: string; spreadDiff: string; totalEdge: string; totalDiff: string } {
  const awayBook = parseFloat(awayBookSpread ?? "");
  const homeBook = parseFloat(homeBookSpread ?? "");
  const bookTot  = parseFloat(bookTotal ?? "");

  let spreadEdge = "PASS";
  let spreadDiff = "0.0";
  let totalEdge  = "PASS";
  let totalDiff  = "0.0";

  if (!isNaN(awayBook) && !isNaN(homeBook)) {
    const awayDiff = awayBook - awayModelSpread;
    const homeDiff = homeBook - homeModelSpread;
    const useAway  = Math.abs(awayDiff) >= Math.abs(homeDiff);
    const bestDiff = useAway ? awayDiff : homeDiff;
    const edgeTeam   = useAway ? awaySlug : homeSlug;
    const edgeSpread = useAway ? awayModelSpread : homeModelSpread;

    if (Math.abs(bestDiff) > 0) {
      const sign = edgeSpread > 0 ? "+" : "";
      spreadEdge = `${edgeTeam} (${sign}${edgeSpread})`;
      spreadDiff = String(Math.round(Math.abs(bestDiff) * 10) / 10);
    }
  }

  if (!isNaN(bookTot)) {
    const diff = Math.round((modelTotal - bookTot) * 10) / 10;
    if (diff > 0) {
      totalEdge = `OVER ${modelTotal}`;
      totalDiff = String(Math.abs(diff));
    } else if (diff < 0) {
      totalEdge = `UNDER ${modelTotal}`;
      totalDiff = String(Math.abs(diff));
    }
  }

  return { spreadEdge, spreadDiff, totalEdge, totalDiff };
}

/** Parse a CSV line respecting quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
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

export async function syncNbaModelFromSheet(): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const result = { synced: 0, skipped: 0, errors: [] as string[] };

  // [VERIFY] Guard: abort immediately if NBA_SHEET_ID was not set at startup
  if (!CSV_URL) {
    const msg = "[NBAModelSync] ABORTED — NBA_SHEET_ID env var is not set. Set it in Railway service variables (or GitHub repository secrets).";
    console.error(msg);
    result.errors.push(msg);
    return result;
  }

  console.log("[NBAModelSync] Fetching sheet CSV...");
  let csvText: string;
  try {
    const res = await fetch(CSV_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NBAModelSync/1.0)",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    csvText = await res.text();
  } catch (err: any) {
    const msg = `Failed to fetch sheet: ${err.message}`;
    console.error(`[NBAModelSync] ${msg}`);
    result.errors.push(msg);
    return result;
  }

  if (!csvText || csvText.length < 100) {
    result.errors.push(`Sheet returned empty or too-short response (${csvText?.length ?? 0} bytes)`);
    return result;
  }

  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) {
    result.errors.push("Sheet returned no data rows");
    return result;
  }

  // Skip header row (row 0)
  const dataLines = lines.slice(1);
  console.log(`[NBAModelSync] Processing ${dataLines.length} data rows`);

  const db = await getDb();
  if (!db) {
    result.errors.push("Database not available");
    return result;
  }

  for (const line of dataLines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);

    // Column indices (0-based, matching spreadsheet letter columns A–T):
    const dateRaw    = cols[0]?.trim();   // A: date YYYYMMDD
    // cols[1] = matchup_key (B) — not used directly
    const awayAbbrev = cols[2]?.trim();   // C: away_team abbreviation
    const homeAbbrev = cols[3]?.trim();   // D: home_team abbreviation
    const totalRaw   = cols[8]?.trim();   // I: Final_Proj_Total_Display
    const favAbbrev  = cols[9]?.trim();   // J: Final_Favorite
    // cols[10] = Favorite_Team (K) — same as J
    // cols[11] = Underdog_Team (L) — same as away or home
    const favSpread  = cols[12]?.trim();  // M: Favorite_Spread_Display (negative or "PK")
    const undSpread  = cols[13]?.trim();  // N: Underdog_Spread_Display (positive or "PK")
    const fairMLHome = cols[18]?.trim();  // S: Fair_ML_Home (integer, e.g. "115" or "-320")
    const fairMLAway = cols[19]?.trim();  // T: Fair_ML_Away (integer, e.g. "-115" or "320")

    // Skip rows without a valid date
    if (!dateRaw || !/^\d{8}$/.test(dateRaw)) continue;

    // Parse date: 20260308 → 2026-03-08
    const gameDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;

    // Map abbreviations to dbSlugs
    const awaySlug = ABBREV_TO_SLUG[awayAbbrev?.toUpperCase()];
    const homeSlug = ABBREV_TO_SLUG[homeAbbrev?.toUpperCase()];

    if (!awaySlug || !homeSlug) {
      result.errors.push(`Unknown team abbrev: away=${awayAbbrev}, home=${homeAbbrev} (date=${gameDate})`);
      result.skipped++;
      continue;
    }

    // Parse model total
    const modelTotal = parseFloat(totalRaw);
    if (isNaN(modelTotal)) {
      result.errors.push(`Invalid total for ${awayAbbrev}@${homeAbbrev}: "${totalRaw}"`);
      result.skipped++;
      continue;
    }

    // Determine away and home model spreads:
    // Favorite_Spread_Display is negative (e.g. -6.5), Underdog_Spread_Display is positive (e.g. 6.5)
    // We need to determine if away team is the favorite or underdog
    let awayModelSpread: number;
    let homeModelSpread: number;

    if (favSpread === "PK" || undSpread === "PK" || !favSpread || !undSpread) {
      awayModelSpread = 0;
      homeModelSpread = 0;
    } else {
      const favVal = parseFloat(favSpread); // negative
      const undVal = parseFloat(undSpread); // positive
      if (isNaN(favVal) || isNaN(undVal)) {
        awayModelSpread = 0;
        homeModelSpread = 0;
      } else {
        // Check if away team is the favorite
        const awayIsFavorite = favAbbrev?.toUpperCase() === awayAbbrev?.toUpperCase();
        if (awayIsFavorite) {
          awayModelSpread = favVal; // negative (away is favorite)
          homeModelSpread = undVal; // positive (home is underdog)
        } else {
          awayModelSpread = undVal; // positive (away is underdog)
          homeModelSpread = favVal; // negative (home is favorite)
        }
      }
    }

    // Parse moneylines from Fair_ML_Home and Fair_ML_Away
    const mlHomeInt = parseInt(fairMLHome, 10);
    const mlAwayInt = parseInt(fairMLAway, 10);

    const modelHomeML = !isNaN(mlHomeInt) ? formatML(mlHomeInt) : "PK";
    const modelAwayML = !isNaN(mlAwayInt) ? formatML(mlAwayInt) : "PK";

    // Find the game in the database
    const existing = await db
      .select({
        id: games.id,
        awayBookSpread: games.awayBookSpread,
        homeBookSpread: games.homeBookSpread,
        bookTotal: games.bookTotal,
      })
      .from(games)
      .where(
        and(
          eq(games.gameDate, gameDate),
          eq(games.awayTeam, awaySlug),
          eq(games.homeTeam, homeSlug),
          eq(games.sport, "NBA")
        )
      )
      .limit(1);

    if (existing.length === 0) {
      result.errors.push(`Game not found in DB: ${awaySlug} @ ${homeSlug} on ${gameDate}`);
      result.skipped++;
      continue;
    }

    const game = existing[0];

    // ── CRITICAL: Require confirmed book spread + total before writing model ───────────────
    // Missing awayBookSpread causes edge detection to fail (can't compute spread diff).
    // Missing bookTotal causes modelTotal to be displayed without a book anchor.
    if (!game.awayBookSpread || !game.bookTotal) {
      const missing: string[] = [];
      if (!game.awayBookSpread) missing.push('awayBookSpread [SPREAD GATE]');
      if (!game.bookTotal) missing.push('bookTotal [TOTAL GATE]');
      result.errors.push(`SKIP ${awaySlug}@${homeSlug} (${gameDate}) — missing: ${missing.join(', ')}`);
      console.warn(`[NBAModelSync] SKIP ${awayAbbrev}@${homeAbbrev} — missing required book lines: ${missing.join(', ')}`);
      result.skipped++;
      continue;
    }

    // Anchor modelTotal to book total — NEVER display model's own derived total
    // CRITICAL: the book O/U line is the reference; model odds are computed at that line
    const bookTotalAnchor = parseFloat(String(game.bookTotal));
    const displayTotal = !isNaN(bookTotalAnchor) ? bookTotalAnchor : modelTotal;

    // Compute edges from model vs book
    const edges = computeEdges(
      game.awayBookSpread,
      game.homeBookSpread,
      game.bookTotal,
      awayModelSpread,
      homeModelSpread,
      modelTotal,
      awaySlug,
      homeSlug
    );

    // Update ONLY model fields — do NOT touch any other fields
    await db
      .update(games)
      .set({
        awayModelSpread: String(awayModelSpread),
        homeModelSpread: String(homeModelSpread),
        modelTotal: String(displayTotal),  // ALWAYS book-anchored
        modelAwayML,
        modelHomeML,
        spreadEdge: edges.spreadEdge,
        spreadDiff: edges.spreadDiff,
        totalEdge: edges.totalEdge,
        totalDiff: edges.totalDiff,
      })
      .where(eq(games.id, game.id));

    console.log(
      `[NBAModelSync] ✓ ${awayAbbrev}@${homeAbbrev} (${gameDate}): ` +
      `spread=${awayModelSpread}/${homeModelSpread}, total=${modelTotal}, ` +
      `ML=${modelAwayML}/${modelHomeML}, ` +
      `edge=${edges.spreadEdge}(${edges.spreadDiff}) / ${edges.totalEdge}(${edges.totalDiff})`
    );
    result.synced++;
  }

  console.log(
    `[NBAModelSync] Done. Synced: ${result.synced}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`
  );
  if (result.errors.length > 0) {
    console.warn("[NBAModelSync] Errors:", result.errors.join("; "));
  }

  // Store the result with timestamp for the Publish Projections page
  const syncedAt = new Date().toISOString();
  lastSyncResult = { ...result, syncedAt };

  return result;
}

/** Get current PST/PDT hour (accounts for daylight saving time) */
function getPSTHour(): number {
  const now = new Date();
  // Use Intl to get the correct PST/PDT offset automatically
  const pstTimeStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false });
  return parseInt(pstTimeStr, 10);
}

/** Returns true if current time is within the 9AM–9PM PST/PDT window */
function isWithinSyncWindow(): boolean {
  const pstHour = getPSTHour();
  // Window: 9AM (9) to 9PM (21, exclusive)
  return pstHour >= 9 && pstHour < 21;
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startNbaModelSyncScheduler(): void {
  if (syncInterval) return; // already running

  const THIRTY_MIN_MS = 30 * 60 * 1000;

  // Run immediately on startup if within window
  if (isWithinSyncWindow()) {
    console.log("[NBAModelSync] Within sync window — starting initial sync...");
    syncNbaModelFromSheet().catch(err =>
      console.error("[NBAModelSync] Initial sync error:", err)
    );
  } else {
    console.log("[NBAModelSync] Outside sync window (9AM–9PM PST), skipping initial sync.");
  }

  // Schedule every 30 minutes — .unref() prevents the interval from keeping the process alive
  syncInterval = setInterval(() => {
    if (isWithinSyncWindow()) {
      console.log("[NBAModelSync] Scheduled sync triggered...");
      syncNbaModelFromSheet().catch(err =>
        console.error("[NBAModelSync] Scheduled sync error:", err)
      );
    } else {
      console.log("[NBAModelSync] Outside sync window (9AM–9PM PST), skipping scheduled sync.");
    }
  }, THIRTY_MIN_MS).unref();

  console.log("[NBAModelSync] Scheduler started (every 30 min, 9AM–9PM PST).");
}
