/**
 * rotogrinderProxy.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side scraper for Rotogrinders THE BAT X projection tables.
 *
 * Authenticates with Rotogrinders, fetches the CSV endpoint (NOT the HTML page),
 * parses the CSV, and returns clean structured JSON.
 *
 * WHY CSV INSTEAD OF HTML:
 *   The HTML pages use virtual/lazy scrolling — only ~33 rows render in the
 *   initial server-side HTML. The CSV endpoints return the COMPLETE dataset
 *   (all players, all columns) in a single authenticated request.
 *
 * Access is restricted to @prez, @sippi, and @lucianobets only.
 *
 * Route: GET /api/rg-proxy?page=<key>
 * Valid page keys: today-pitchers | today-hitters | tomorrow-pitchers | tomorrow-hitters
 *
 * Response: { columns, rows, updatedAt, title, type }
 *   Each row includes:
 *     NAME          — player name (normalized from PLAYER for pitchers)
 *     PLAYER_ID     — Rotogrinders internal player ID (from PLAYERID column)
 *     MLB_ID        — MLB Stats API player ID (resolved via name lookup, cached)
 *     HEADSHOT_URL  — MLB static headshot CDN URL
 *     TEAM_LOGO_URL — ESPN team logo CDN URL
 *     OPP_LOGO_URL  — ESPN opponent logo CDN URL
 */

import type { Express, Request, Response } from "express";
import { verifyAppUserToken } from "./routers/appUsers";
import { getAppUserById } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────

const RG_BASE = "https://rotogrinders.com";
const MLB_STATS_API = "https://statsapi.mlb.com/api/v1";
const MLB_HEADSHOT_BASE = "https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_96,q_auto:best/v1/people";
const ESPN_LOGO_BASE = "https://a.espncdn.com/i/teamlogos/mlb/500";

// JACK MAC whitelist: @prez, @sippi, @lucianobets
const ALLOWED_USERNAMES = new Set(["prez", "lucianobets", "sippi"]);

/**
 * PAGE_CONFIG maps page keys to their CSV endpoint IDs and metadata.
 *
 * CSV URL format: https://rotogrinders.com/grids/<numeric-id>.csv
 * The numeric ID is extracted from the grid slug (last segment after the last dash).
 *
 * Confirmed working CSV endpoints (verified 2026-05-15):
 *   today-pitchers:    /grids/standard-projections-the-bat-x-3372510        → 3372510.csv
 *   today-hitters:     /grids/standard-projections-the-bat-x-hitters-3372512 → 3372512.csv
 *   tomorrow-pitchers: /grids/tomorrow-projections-the-bat-x-3375509         → 3375509.csv
 *   tomorrow-hitters:  /grids/tomorrow-projections-the-bat-x-hitters-3375510 → 3375510.csv
 */
export const PAGE_CONFIG: Record<string, {
  slug: string;
  csvId: string;
  title: string;
  type: "pitchers" | "hitters";
}> = {
  "today-pitchers":    { slug: "/grids/standard-projections-the-bat-x-3372510",         csvId: "3372510", title: "Standard Projections — THE BAT X Pitchers (Today)",  type: "pitchers" },
  "today-hitters":     { slug: "/grids/standard-projections-the-bat-x-hitters-3372512",  csvId: "3372512", title: "Standard Projections — THE BAT X Hitters (Today)",   type: "hitters"  },
  "tomorrow-pitchers": { slug: "/grids/tomorrow-projections-the-bat-x-3375509",          csvId: "3375509", title: "Tomorrow Projections — THE BAT X Pitchers",          type: "pitchers" },
  "tomorrow-hitters":  { slug: "/grids/tomorrow-projections-the-bat-x-hitters-3375510",  csvId: "3375510", title: "Tomorrow Projections — THE BAT X Hitters",           type: "hitters"  },
};

// ─── MLB Team Abbreviation → ESPN slug map ────────────────────────────────────

const TEAM_TO_ESPN: Record<string, string> = {
  BAL: "bal", BOS: "bos", NYY: "nyy", TB: "tb", TBR: "tb", TOR: "tor",
  CWS: "chw", CHW: "chw", CLE: "cle", DET: "det", KC: "kc", KCR: "kc", MIN: "min",
  HOU: "hou", LAA: "laa", ATH: "oak", OAK: "oak", SEA: "sea", TEX: "tex",
  ATL: "atl", MIA: "mia", NYM: "nym", PHI: "phi", WSH: "wsh", WAS: "wsh",
  CHC: "chc", CIN: "cin", MIL: "mil", PIT: "pit", STL: "stl",
  ARI: "ari", COL: "col", LAD: "lad", SD: "sd", SDP: "sd", SF: "sf", SFG: "sf",
};

function teamLogoUrl(abbrev: string): string {
  const slug = TEAM_TO_ESPN[abbrev?.toUpperCase()] ?? abbrev?.toLowerCase();
  return `${ESPN_LOGO_BASE}/${slug}.png`;
}

// ─── MLB Player ID Cache ──────────────────────────────────────────────────────

interface MlbIdEntry {
  mlbId: number | null;
  cachedAt: number;
}

const mlbIdCache = new Map<string, MlbIdEntry>();
const MLB_ID_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
}

async function resolveMlbId(playerName: string): Promise<number | null> {
  const key = normalizeName(playerName);
  const cached = mlbIdCache.get(key);
  if (cached && Date.now() - cached.cachedAt < MLB_ID_TTL_MS) {
    return cached.mlbId;
  }

  try {
    const encoded = encodeURIComponent(playerName.trim());
    const url = `${MLB_STATS_API}/people/search?names=${encoded}&sportId=1`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      mlbIdCache.set(key, { mlbId: null, cachedAt: Date.now() });
      return null;
    }
    const data = await res.json() as { people?: { id: number; fullName: string }[] };
    const mlbId = data.people?.[0]?.id ?? null;
    mlbIdCache.set(key, { mlbId, cachedAt: Date.now() });
    return mlbId;
  } catch {
    mlbIdCache.set(key, { mlbId: null, cachedAt: Date.now() });
    return null;
  }
}

function headshotUrl(mlbId: number | null): string {
  if (!mlbId) return "";
  return `${MLB_HEADSHOT_BASE}/${mlbId}/headshot/67/current`;
}

// ─── Session Cookie Cache ─────────────────────────────────────────────────────

let cachedRgCookie: string | null = null;
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 55 * 60 * 1000; // 55 minutes

function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return result;
}

export async function getRgSessionCookie(): Promise<string> {
  const now = Date.now();
  if (cachedRgCookie && now - cookieFetchedAt < COOKIE_TTL_MS) {
    console.log("[RGProxy] [STATE] Using cached RG session cookie");
    return cachedRgCookie;
  }

  const username = process.env.ROTOGRINDERS_USERNAME;
  const password = process.env.ROTOGRINDERS_PASSWORD;

  if (!username || !password) {
    throw new Error("ROTOGRINDERS_USERNAME or ROTOGRINDERS_PASSWORD not set in environment");
  }

  console.log(`[RGProxy] [STEP] Logging in to Rotogrinders as ${username}...`);

  const loginRes = await fetch(`${RG_BASE}/sign-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Referer": `${RG_BASE}/sign-in`,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    body: new URLSearchParams({ username, password }).toString(),
    redirect: "manual",
  });

  const setCookieHeaders: string[] = [];
  loginRes.headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() === "set-cookie") {
      setCookieHeaders.push(value);
    }
  });

  const rguidCookie = setCookieHeaders
    .map((c: string) => c.split(";")[0])
    .find((c: string) => c.startsWith("rguid="));

  const cookieStr = setCookieHeaders
    .map((c: string) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!rguidCookie && !cookieStr) {
    throw new Error(`RG login returned no cookies (status=${loginRes.status})`);
  }

  if (!rguidCookie) {
    console.warn(`[RGProxy] [STATE] Warning — rguid cookie not found. Status=${loginRes.status}. Using all cookies.`);
  } else {
    console.log(`[RGProxy] [STATE] RG login success — rguid obtained (status=${loginRes.status})`);
  }

  cachedRgCookie = cookieStr;
  cookieFetchedAt = Date.now();
  return cachedRgCookie;
}

// ─── CSV Fetch with Auto-Retry on 401/403 ────────────────────────────────────

export async function fetchRgCsv(csvId: string, cookie: string): Promise<string> {
  const csvUrl = `${RG_BASE}/grids/${csvId}.csv`;
  console.log(`[RGProxy] [STEP] Fetching CSV: ${csvUrl}`);

  const res = await fetch(csvUrl, {
    headers: {
      "Cookie": cookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Referer": RG_BASE,
      "Accept": "text/csv,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (res.status === 401 || res.status === 403) {
    console.warn(`[RGProxy] [STATE] RG returned ${res.status} — clearing cookie cache and retrying`);
    cachedRgCookie = null;
    cookieFetchedAt = 0;
    const freshCookie = await getRgSessionCookie();
    const retryRes = await fetch(csvUrl, {
      headers: {
        "Cookie": freshCookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer": RG_BASE,
        "Accept": "text/csv,text/plain,*/*",
      },
    });
    if (!retryRes.ok) throw new Error(`RG CSV returned ${retryRes.status} after re-auth`);
    return retryRes.text();
  }

  if (!res.ok) throw new Error(`RG CSV returned ${res.status}`);
  const text = await res.text();

  // Validate: CSV must start with a header row containing PLAYER or NAME
  if (!text.trim()) {
    throw new Error(`RG CSV returned empty response for csvId=${csvId}`);
  }
  if (!text.includes("PLAYER") && !text.includes("NAME")) {
    // Might be a paywall HTML redirect — log and throw
    console.error(`[RGProxy] [VERIFY] FAIL — CSV response does not contain expected headers. First 200 chars: ${text.substring(0, 200)}`);
    throw new Error(`RG CSV response appears to be non-CSV (paywall or redirect) for csvId=${csvId}`);
  }

  console.log(`[RGProxy] [STATE] CSV fetched: ${text.length} bytes, ${text.split("\n").length} lines`);
  return text;
}

// Keep fetchRgPage as a legacy export for backward compatibility (jackMacSheetsSync may use it)
async function fetchRgPage(pageUrl: string, cookie: string): Promise<string> {
  const res = await fetch(pageUrl, {
    headers: {
      "Cookie": cookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Referer": RG_BASE,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`RG returned ${res.status}`);
  return res.text();
}

// ─── CSV → Structured JSON Table Parser ──────────────────────────────────────

export interface RgTableData {
  title: string;
  pageKey: string;
  type: "pitchers" | "hitters";
  updatedAt: string;
  columns: string[];
  rows: Record<string, string>[];
}

/**
 * Parse a Rotogrinders CSV string into the same RgTableData format
 * that the old HTML parser produced.
 *
 * CSV format (confirmed 2026-05-15):
 *   Row 0: header — PLAYERID,PLAYER,SALARY,POS,TEAM,OPP,...
 *   Rows 1+: data — 6109687,"Jack Leiter",7100,SP,TEX,...
 *
 * Enrichment added:
 *   NAME          — normalized from PLAYER column
 *   PLAYER_ID     — from PLAYERID column
 *   MLB_ID        — resolved via MLB Stats API
 *   HEADSHOT_URL  — MLB CDN headshot
 *   TEAM_LOGO_URL — ESPN team logo
 *   OPP_LOGO_URL  — ESPN opponent logo
 */
export async function parseRgCsv(
  csvText: string,
  pageKey: string,
  title: string,
  type: "pitchers" | "hitters"
): Promise<RgTableData> {
  // ── Parse CSV ─────────────────────────────────────────────────────────────
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) {
    console.warn(`[RGProxy] [VERIFY] WARN — CSV has fewer than 2 lines for page=${pageKey}`);
    return { title, pageKey, type, updatedAt: "", columns: [], rows: [] };
  }

  // Parse a single CSV line respecting quoted fields
  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
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

  const rawHeaders = parseCsvLine(lines[0]);
  console.log(`[RGProxy] [STATE] CSV headers (${rawHeaders.length}): ${rawHeaders.slice(0, 15).join(", ")}`);

  // Detect name column: pitchers use "PLAYER", hitters use "NAME"
  const playerColIdx = rawHeaders.findIndex(h => h === "PLAYER" || h === "NAME");
  const playerIdColIdx = rawHeaders.findIndex(h => h === "PLAYERID");
  const teamColIdx = rawHeaders.findIndex(h => h === "TM" || h === "TEAM");
  const oppColIdx = rawHeaders.findIndex(h => h === "OPP_TM" || h === "OPP");

  console.log(
    `[RGProxy] [STATE] page=${pageKey} playerColIdx=${playerColIdx} playerIdColIdx=${playerIdColIdx} teamColIdx=${teamColIdx} oppColIdx=${oppColIdx}`
  );

  // Normalize "PLAYER" → "NAME" in the columns array for frontend consistency
  const normalizedHeaders = rawHeaders.map(h => (h === "PLAYER" ? "NAME" : h));

  // ── Parse data rows ───────────────────────────────────────────────────────
  const rawRows: { row: Record<string, string>; playerName: string; teamAbbrev: string; oppAbbrev: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};

    for (let j = 0; j < normalizedHeaders.length; j++) {
      row[normalizedHeaders[j]] = cells[j] ?? "";
    }

    const playerName = row["NAME"] ?? "";
    if (!playerName) continue;

    // PLAYER_ID from PLAYERID column
    row["PLAYER_ID"] = row["PLAYERID"] ?? "";

    const teamAbbrev = cells[teamColIdx] ?? "";
    const oppAbbrev  = cells[oppColIdx]  ?? "";

    rawRows.push({ row, playerName, teamAbbrev, oppAbbrev });
  }

  console.log(`[RGProxy] [STATE] Parsed rows with NAME: ${rawRows.length}`);

  // ── Resolve MLB IDs in parallel ───────────────────────────────────────────
  const uniqueNames = Array.from(new Set(rawRows.map(r => r.playerName)));
  console.log(`[RGProxy] [STEP] Resolving MLB IDs for ${uniqueNames.length} unique players...`);

  const mlbIdMap = new Map<string, number | null>();
  await Promise.all(
    uniqueNames.map(async name => {
      const id = await resolveMlbId(name);
      mlbIdMap.set(normalizeName(name), id);
    })
  );

  const resolvedCount = Array.from(mlbIdMap.values()).filter(v => v !== null).length;
  console.log(`[RGProxy] [STATE] MLB ID resolution: ${resolvedCount}/${uniqueNames.length} resolved`);

  // ── Build final rows with enriched fields ─────────────────────────────────
  const rows: Record<string, string>[] = rawRows.map(({ row, playerName, teamAbbrev, oppAbbrev }) => {
    const mlbId = mlbIdMap.get(normalizeName(playerName)) ?? null;
    return {
      ...row,
      MLB_ID:        mlbId ? String(mlbId) : "",
      HEADSHOT_URL:  headshotUrl(mlbId),
      TEAM_LOGO_URL: teamAbbrev ? teamLogoUrl(teamAbbrev) : "",
      OPP_LOGO_URL:  oppAbbrev  ? teamLogoUrl(oppAbbrev)  : "",
    };
  });

  // ── Build final columns list (enriched columns at front) ──────────────────
  const enrichedCols = ["NAME", "HEADSHOT_URL", "MLB_ID", "PLAYER_ID", "TEAM_LOGO_URL", "OPP_LOGO_URL"];
  const remainingCols = normalizedHeaders.filter(c => !enrichedCols.includes(c) && c !== "PLAYERID");
  const finalColumns = [...enrichedCols, ...remainingCols];

  console.log(
    `[RGProxy] [OUTPUT] page=${pageKey} finalColumns=${finalColumns.length} rows=${rows.length}`
  );

  // updatedAt is not in the CSV — use current timestamp
  const updatedAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: true });

  return { title, pageKey, type, updatedAt, columns: finalColumns, rows };
}

// Keep parseRgTable as a legacy export for backward compatibility
async function parseRgTable(
  html: string,
  pageKey: string,
  title: string,
  type: "pitchers" | "hitters"
): Promise<RgTableData> {
  // Redirect to CSV-based parser — html param is ignored
  // This function is kept for backward compatibility with jackMacSheetsSync.ts
  console.warn(`[RGProxy] parseRgTable called — redirecting to parseRgCsv (html parsing deprecated)`);
  const pageConf = PAGE_CONFIG[pageKey];
  if (!pageConf) {
    return { title, pageKey, type, updatedAt: "", columns: [], rows: [] };
  }
  const cookie = await getRgSessionCookie();
  const csvText = await fetchRgCsv(pageConf.csvId, cookie);
  return parseRgCsv(csvText, pageKey, title, type);
}

// ─── Express Route Registration ───────────────────────────────────────────────

export function registerRgProxyRoute(app: Express): void {
  app.get("/api/rg-proxy", async (req: Request, res: Response) => {
    const startMs = Date.now();

    // ── Step 1: Verify app session JWT ────────────────────────────────────────
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const token = cookies["app_session"];
    if (!token) {
      console.warn("[RGProxy] [VERIFY] FAIL — No app_session cookie. Returning 401.");
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const payload = await verifyAppUserToken(token);
    if (!payload) {
      console.warn("[RGProxy] [VERIFY] FAIL — JWT verification failed. Returning 401.");
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    // ── Step 2: Load user from DB and enforce allowlist ───────────────────────
    let appUser: Awaited<ReturnType<typeof getAppUserById>>;
    try {
      appUser = await getAppUserById(payload.userId);
    } catch (err) {
      console.error("[RGProxy] [VERIFY] FAIL — DB error:", (err as Error).message);
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!appUser) {
      console.warn(`[RGProxy] [VERIFY] FAIL — userId=${payload.userId} not found in DB.`);
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (!ALLOWED_USERNAMES.has(appUser.username)) {
      console.warn(`[RGProxy] [VERIFY] FAIL — @${appUser.username} not in allowlist. Returning 403.`);
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // ── Step 3: Validate page key ─────────────────────────────────────────────
    const pageKey = (req.query.page as string) ?? "";
    const pageConf = PAGE_CONFIG[pageKey];
    if (!pageConf) {
      console.warn(`[RGProxy] [VERIFY] FAIL — Invalid page key: "${pageKey}"`);
      res.status(400).json({ error: `Invalid page key. Valid: ${Object.keys(PAGE_CONFIG).join(", ")}` });
      return;
    }

    console.log(`[RGProxy] [INPUT] user=@${appUser.username} page=${pageKey} csvId=${pageConf.csvId}`);

    // ── Step 4: Get Rotogrinders session cookie ───────────────────────────────
    let rgCookie: string;
    try {
      rgCookie = await getRgSessionCookie();
    } catch (err) {
      console.error("[RGProxy] [VERIFY] FAIL — Could not obtain RG session:", (err as Error).message);
      res.status(502).json({ error: "Failed to authenticate with Rotogrinders" });
      return;
    }

    // ── Step 5: Fetch the CSV (complete dataset, no lazy-loading issues) ──────
    let csvText: string;
    try {
      csvText = await fetchRgCsv(pageConf.csvId, rgCookie);
      console.log(`[RGProxy] [STATE] Fetched CSV: ${csvText.length} bytes`);
    } catch (err) {
      console.error("[RGProxy] [VERIFY] FAIL — CSV fetch error:", (err as Error).message);
      res.status(503).json({ error: (err as Error).message });
      return;
    }

    // ── Step 6: Parse CSV + enrich with MLB IDs / headshots / logos ───────────
    const tableData = await parseRgCsv(csvText, pageKey, pageConf.title, pageConf.type);

    const elapsed = Date.now() - startMs;
    console.log(
      `[RGProxy] [OUTPUT] page=${pageKey} user=@${appUser.username} rows=${tableData.rows.length} cols=${tableData.columns.length} elapsed=${elapsed}ms`
    );
    console.log(`[RGProxy] [VERIFY] PASS — JSON response sent`);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.status(200).json(tableData);
  });

  console.log("[RGProxy] Route registered: GET /api/rg-proxy?page=<key> → JSON table data (CSV-based)");
}
