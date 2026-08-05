/**
 * fileParser.ts
 *
 * Parses XLSX and CSV model files using header-name-driven column mapping.
 * Supports any column order as long as the required headers are present.
 *
 * Required headers (case-insensitive):
 *   date, start_time_est, away_team, away_book_spread, away_model_spread,
 *   home_team, home_book_spread, home_model_spread, book_total, model_total,
 *   spread_edge, spread_diff, total_edge, total_diff
 */

import * as XLSX from "xlsx";
import type { InsertGame } from "../drizzle/schema";
import { BY_DB_SLUG } from "../shared/ncaamTeams";

/**
 * Convert a CSV team name to a DB slug.
 * The CSV is expected to already contain canonical DB slugs (snake_case).
 * This function normalises whitespace/case and verifies the slug is in the
 * 365-team registry. Unrecognised slugs are passed through as-is so the
 * upload pipeline can surface them as validation errors.
 */
function normalizeTeamSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  // If it's in the registry, return the canonical dbSlug (handles any minor case/spacing drift)
  const team = BY_DB_SLUG.get(slug);
  return team ? team.dbSlug : slug;
}

// Required column names (all must be present, order doesn't matter)
const REQUIRED_HEADERS = new Set([
  "date",
  "start_time_est",
  "away_team",
  "away_book_spread",
  "away_model_spread",
  "home_team",
  "home_book_spread",
  "home_model_spread",
  "book_total",
  "model_total",
  "spread_edge",
  "spread_diff",
  "total_edge",
  "total_diff",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function toNum(v: unknown): string {
  if (v === null || v === undefined || v === "") return "0";
  const n = parseFloat(String(v));
  return isNaN(n) ? "0" : String(n);
}

/**
 * Convert "MMDDYYYY" → "YYYY-MM-DD"
 * Also handles JS Date objects from openpyxl-style reads.
 */
function parseDate(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).replace(/\D/g, "");
  if (s.length === 8) {
    // MMDDYYYY
    return `${s.slice(4, 8)}-${s.slice(0, 2)}-${s.slice(2, 4)}`;
  }
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
  return s;
}

/**
 * Convert 4-digit 24h time "1900" → "19:00"
 * Also handles Date objects (Excel stores times as Date with 1899-12-30 base).
 */
function parseTime(v: unknown): string {
  if (!v) return "00:00";
  if (v instanceof Date) {
    const h = String(v.getHours()).padStart(2, "0");
    const m = String(v.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  const s = String(v).trim();
  if (/^\d{4}$/.test(s)) {
    return `${s.slice(0, 2)}:${s.slice(2)}`;
  }
  if (/^\d{1,2}:\d{2}$/.test(s)) return s.padStart(5, "0");
  return s;
}

/**
 * Format team name from snake_case to Title Case display.
 * e.g. "nc_state" → "NC State", "duke" → "Duke"
 */
export function formatTeamName(raw: string): string {
  return raw
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// ─── Header mapping ───────────────────────────────────────────────────────────

type ColMap = Record<string, number>;

/**
 * Build a column name → index map from a header row.
 * Returns null if any required header is missing.
 */
function buildColMap(headerRow: unknown[]): ColMap | null {
  const map: ColMap = {};
  for (let i = 0; i < headerRow.length; i++) {
    const name = toStr(headerRow[i]).toLowerCase();
    if (name) map[name] = i;
  }
  // Check all required headers are present
  for (const required of Array.from(REQUIRED_HEADERS)) {
    if (!(required in map)) {
      return null;
    }
  }
  return map;
}

// ─── Row parser ───────────────────────────────────────────────────────────────

function parseDataRow(
  row: unknown[],
  colMap: ColMap,
  fileId: number,
  sport: string
): InsertGame | null {
  const awayTeam = normalizeTeamSlug(toStr(row[colMap.away_team]));
  const homeTeam = normalizeTeamSlug(toStr(row[colMap.home_team]));

  // Skip empty or header-like rows
  if (!awayTeam || !homeTeam) return null;
  if (awayTeam.toLowerCase() === "away_team") return null;

  const gameDate = parseDate(row[colMap.date]);
  if (!gameDate) return null;

  return {
    fileId,
    sport,
    gameDate,
    startTimeEst: parseTime(row[colMap.start_time_est]),
    awayTeam,
    awayBookSpread: toNum(row[colMap.away_book_spread]),
    awayModelSpread: toNum(row[colMap.away_model_spread]),
    homeTeam,
    homeBookSpread: toNum(row[colMap.home_book_spread]),
    homeModelSpread: toNum(row[colMap.home_model_spread]),
    bookTotal: toNum(row[colMap.book_total]),
    modelTotal: toNum(row[colMap.model_total]),
    spreadEdge: toStr(row[colMap.spread_edge]) || "PASS",
    spreadDiff: toNum(row[colMap.spread_diff]),
    totalEdge: toStr(row[colMap.total_edge]) || "PASS",
    totalDiff: toNum(row[colMap.total_diff]),
  };
}

// ─── XLSX parser ──────────────────────────────────────────────────────────────

export function parseXlsxBuffer(
  buffer: Buffer,
  fileId: number,
  sport = "NCAAM"
): InsertGame[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const allGames: InsertGame[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: false, // get formatted strings for dates/times
    });

    if (rawRows.length < 2) continue;

    const headerRow = rawRows[0] as unknown[];
    const colMap = buildColMap(headerRow);

    if (!colMap) {
      console.log(
        `[XLSX Parser] Skipping sheet "${sheetName}" — missing required headers`
      );
      continue;
    }

    console.log(
      `[XLSX Parser] Processing sheet "${sheetName}" (${rawRows.length - 1} data rows)`
    );

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] as unknown[];
      if (!row || row.every(v => v === null || v === "")) continue;

      const game = parseDataRow(row, colMap, fileId, sport);
      if (game) allGames.push(game);
    }
  }

  return allGames;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
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

export function parseCsvBuffer(
  buffer: Buffer,
  fileId: number,
  sport = "NCAAM"
): InsertGame[] {
  const content = buffer.toString("utf-8");
  const lines = content
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headerRow = parseCsvLine(lines[0]);
  const colMap = buildColMap(headerRow);

  if (!colMap) {
    throw new Error(
      `CSV does not match the expected format. Missing one or more required headers: ${Array.from(REQUIRED_HEADERS).join(", ")}`
    );
  }

  const rows: InsertGame[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length < 2) continue;

    const game = parseDataRow(vals, colMap, fileId, sport);
    if (game) rows.push(game);
  }

  return rows;
}

// ─── Unified entry point ──────────────────────────────────────────────────────

export function parseFileBuffer(
  buffer: Buffer,
  filename: string,
  fileId: number,
  sport = "NCAAM"
): InsertGame[] {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") {
    return parseXlsxBuffer(buffer, fileId, sport);
  }
  return parseCsvBuffer(buffer, fileId, sport);
}

export function detectSportFromFilename(filename: string): string {
  const upper = filename.toUpperCase();
  if (upper.includes("NCAAM")) return "NCAAM";
  if (upper.includes("NCAAF")) return "NCAAF";
  if (upper.includes("NFL")) return "NFL";
  if (upper.includes("NBA")) return "NBA";
  if (upper.includes("MLB")) return "MLB";
  if (upper.includes("NHL")) return "NHL";
  return "NCAAM";
}

export function detectDateFromFilename(filename: string): string | null {
  const m1 = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (m1) return `${m1[3]}-${m1[1]}-${m1[2]}`;
  const m2 = filename.match(/(\d{2})(\d{2})(\d{4})/);
  if (m2) return `${m2[3]}-${m2[1]}-${m2[2]}`;
  return null;
}
