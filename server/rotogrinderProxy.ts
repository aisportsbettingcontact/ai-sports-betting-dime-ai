/**
 * rotogrinderProxy.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side scraper for Rotogrinders THE BAT X projection tables.
 *
 * Authenticates with Rotogrinders, fetches the grid page, parses the
 * <table> via cheerio, and returns clean structured JSON.
 *
 * Access is restricted to @prez and @lucianobets only.
 *
 * Route: GET /api/rg-proxy?page=<key>
 * Valid page keys: today-pitchers | today-hitters | tomorrow-pitchers | tomorrow-hitters
 *
 * Response: { columns, rows, updatedAt, title, type }
 *   Each row includes:
 *     NAME        — player name (normalized from PLAYER for pitchers)
 *     PLAYER_ID   — Rotogrinders internal player ID (from href)
 *     MLB_ID      — MLB Stats API player ID (resolved via name lookup, cached)
 *     HEADSHOT_URL — MLB static headshot CDN URL
 *     TEAM_LOGO_URL — ESPN team logo CDN URL
 *     OPP_LOGO_URL  — ESPN opponent logo CDN URL
 *
 * ROOT CAUSE FIX (2026-05-08):
 *   Pitchers table uses "PLAYER" as column 0, hitters use "NAME".
 *   The old parser filtered rows where row["NAME"] was empty, dropping ALL pitchers.
 *   Fix: detect the name column by checking for "NAME" or "PLAYER", normalize to "NAME".
 */

import type { Express, Request, Response } from "express";
import * as cheerio from "cheerio";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CheerioEl = any;
import { verifyAppUserToken } from "./routers/appUsers";
import { getAppUserById } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────

const RG_BASE = "https://rotogrinders.com";
const MLB_STATS_API = "https://statsapi.mlb.com/api/v1";
const MLB_HEADSHOT_BASE = "https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_96,q_auto:best/v1/people";
const ESPN_LOGO_BASE = "https://a.espncdn.com/i/teamlogos/mlb/500";

// JACK MAC whitelist: @prez, @sippi, @lucianobets
const ALLOWED_USERNAMES = new Set(["prez", "lucianobets", "sippi"]);

const PAGE_CONFIG: Record<string, { slug: string; title: string; type: "pitchers" | "hitters" }> = {
  "today-pitchers":    { slug: "/grids/standard-projections-the-bat-x-3372510",        title: "Standard Projections — THE BAT X Pitchers (Today)",  type: "pitchers" },
  "today-hitters":     { slug: "/grids/standard-projections-the-bat-x-hitters-3372512", title: "Standard Projections — THE BAT X Hitters (Today)",   type: "hitters"  },
  "tomorrow-pitchers": { slug: "/grids/tomorrow-projections-the-bat-x-3375509",         title: "Tomorrow Projections — THE BAT X Pitchers",          type: "pitchers" },
  "tomorrow-hitters":  { slug: "/grids/tomorrow-projections-the-bat-x-hitters-3375510", title: "Tomorrow Projections — THE BAT X Hitters",           type: "hitters"  },
};

// ─── MLB Team Abbreviation → ESPN slug map ────────────────────────────────────
// ESPN uses lowercase 2-3 letter slugs. Some teams differ from RG abbreviations.

const TEAM_TO_ESPN: Record<string, string> = {
  // AL East
  BAL: "bal", BOS: "bos", NYY: "nyy", TB: "tb", TBR: "tb", TOR: "tor",
  // AL Central
  CWS: "chw", CHW: "chw", CLE: "cle", DET: "det", KC: "kc", KCR: "kc", MIN: "min",
  // AL West
  HOU: "hou", LAA: "laa", ATH: "oak", OAK: "oak", SEA: "sea", TEX: "tex",
  // NL East
  ATL: "atl", MIA: "mia", NYM: "nym", PHI: "phi", WSH: "wsh", WAS: "wsh",
  // NL Central
  CHC: "chc", CIN: "cin", MIL: "mil", PIT: "pit", STL: "stl",
  // NL West
  ARI: "ari", COL: "col", LAD: "lad", SD: "sd", SDP: "sd", SF: "sf", SFG: "sf",
};

function teamLogoUrl(abbrev: string): string {
  const slug = TEAM_TO_ESPN[abbrev?.toUpperCase()] ?? abbrev?.toLowerCase();
  return `${ESPN_LOGO_BASE}/${slug}.png`;
}

// ─── MLB Player ID Cache ──────────────────────────────────────────────────────
// Maps normalized player name → { mlbId, cachedAt }

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

async function getRgSessionCookie(): Promise<string> {
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

// ─── Fetch with Auto-Retry on 401/403 ────────────────────────────────────────

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

  if (res.status === 401 || res.status === 403) {
    console.warn(`[RGProxy] [STATE] RG returned ${res.status} — clearing cookie cache and retrying`);
    cachedRgCookie = null;
    cookieFetchedAt = 0;
    const freshCookie = await getRgSessionCookie();
    const retryRes = await fetch(pageUrl, {
      headers: {
        "Cookie": freshCookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer": RG_BASE,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!retryRes.ok) throw new Error(`RG returned ${retryRes.status} after re-auth`);
    return retryRes.text();
  }

  if (!res.ok) throw new Error(`RG returned ${res.status}`);
  return res.text();
}

// ─── HTML → Structured JSON Table Parser ─────────────────────────────────────

export interface RgTableData {
  title: string;
  pageKey: string;
  type: "pitchers" | "hitters";
  updatedAt: string;
  columns: string[];
  rows: Record<string, string>[];
}

/**
 * Extract the RG player ID from a player profile href.
 * e.g. "/players/jesus-luzardo-1266776" → "1266776"
 */
function extractRgPlayerId(href: string): string {
  if (!href || href === "#edit-tags") return "";
  const parts = href.split("-");
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : "";
}

async function parseRgTable(
  html: string,
  pageKey: string,
  title: string,
  type: "pitchers" | "hitters"
): Promise<RgTableData> {
  const $ = cheerio.load(html);

  // ── Extract "FPTS Updated" timestamp ─────────────────────────────────────
  let updatedAt = "";
  $("*").each(function () {
    const text = $(this).clone().children().remove().end().text().trim();
    if (text.startsWith("FPTS Updated:") && !updatedAt) {
      updatedAt = text.replace("FPTS Updated:", "").trim();
    }
  });

  // ── Find the main data table (most <th> columns) ──────────────────────────
  let $table = $("div[data-role='sortable'] table").first();

  if (!$table.length) {
    let maxCols = 0;
    let bestTable: cheerio.Cheerio<Element> | null = null;
    $("table").each(function () {
      const cols = $(this).find("thead tr th").length;
      if (cols > maxCols) {
        maxCols = cols;
        bestTable = $(this) as unknown as cheerio.Cheerio<CheerioEl>;
      }
    });
    if (bestTable) $table = bestTable;
  }

  if (!$table.length) {
    console.warn(`[RGProxy] [VERIFY] WARN — No table found in HTML for page=${pageKey}`);
    return { title, pageKey, type, updatedAt, columns: [], rows: [] };
  }

  // ── Extract column headers ────────────────────────────────────────────────
  const rawColumns: string[] = [];
  $table.find("thead tr th").each(function () {
    const dataCol = $(this).attr("data-col") ?? "";
    const textCol = $(this)
      .clone()
      .children("input, select, span.sort-icon, i")
      .remove()
      .end()
      .text()
      .trim();
    rawColumns.push(dataCol || textCol || `col_${rawColumns.length}`);
  });

  // ── Detect name column: pitchers use "PLAYER", hitters use "NAME" ─────────
  // Normalize "PLAYER" → "NAME" in the output columns array so the frontend
  // always has a consistent "NAME" column regardless of tab type.
  const nameColIndex = rawColumns.findIndex(c => c === "NAME" || c === "PLAYER" || c === "name" || c === "player");
  const columns = rawColumns.map(c => (c === "PLAYER" || c === "player") ? "NAME" : c);

  console.log(
    `[RGProxy] [STATE] page=${pageKey} rawNameCol="${rawColumns[nameColIndex]}" idx=${nameColIndex} totalCols=${columns.length}`
  );
  console.log(
    `[RGProxy] [STATE] Columns[0..11]: ${columns.slice(0, 12).join(", ")}`
  );

  // ── Extract data rows ─────────────────────────────────────────────────────
  const rawRows: { row: Record<string, string>; playerName: string; teamAbbrev: string; oppAbbrev: string }[] = [];

  $table.find("tbody tr").each(function () {
    const $tr = $(this);
    const tds = $tr.find("td");
    if (!tds.length) return;

    const row: Record<string, string> = {};

    // Carry over <tr> data attributes
    const trTeam = $tr.attr("data-team");
    const trPos  = $tr.attr("data-position");
    const trSchedule = $tr.attr("data-schedule");
    if (trTeam)     row["_team"]      = trTeam;
    if (trPos)      row["_position"]  = trPos;
    if (trSchedule) row["_schedule"]  = trSchedule;

    let playerName = "";
    let rgPlayerId = "";

    tds.each(function (i: number) {
      const rawCol = rawColumns[i] ?? `col_${i}`;
      const col    = columns[i]    ?? `col_${i}`;
      const $td    = $(this);

      // ── Boolean checkmark cells ─────────────────────────────────────────
      if ($td.hasClass("truefalse") || $td.attr("data-type") === "bool") {
        row[col] = $td.find("i, span").length > 0 ? "true" : ($td.text().trim() ? "true" : "false");
        return;
      }

      // ── NAME / PLAYER cell ──────────────────────────────────────────────
      // Hitters: <td><span>Player Name</span><span data-auth="analyst">...</span></td>
      // Pitchers: <td><a href="/players/slug-ID">Player Name</a><span data-auth="analyst">...</span></td>
      if (rawCol === "NAME" || rawCol === "name" || rawCol === "PLAYER" || rawCol === "player") {
        const $link = $td.find("a[href^='/players/']").first();
        if ($link.length) {
          // Pitcher structure: name is in the link text
          playerName = $link.text().trim();
          rgPlayerId = extractRgPlayerId($link.attr("href") ?? "");
          row[col] = playerName;
        } else {
          // Hitter structure: name is in the first <span>
          const $firstSpan = $td.find("span").first();
          playerName = $firstSpan.length ? $firstSpan.text().trim() : $td.text().trim().split("\n")[0]?.trim() ?? "";
          // For hitters, try to extract player ID from the data-pointer attribute (base64 encoded URL)
          const $authSpan = $td.find("span[data-auth]");
          const pointer = $authSpan.find("a").attr("data-pointer") ?? "";
          if (pointer) {
            try {
              const decoded = Buffer.from(pointer, "base64").toString("utf8");
              // URL contains player ID: /tags/1086660?
              const match = decoded.match(/\/tags\/(\d+)/);
              if (match) rgPlayerId = match[1];
            } catch { /* ignore */ }
          }
          row[col] = playerName;
        }
        row["PLAYER_ID"] = rgPlayerId;
        return;
      }

      // ── Default: raw text content ────────────────────────────────────────
      row[col] = $td.text().trim().replace(/\s+/g, " ");
    });

    // Only include rows with a non-empty NAME
    if (row["NAME"]) {
      rawRows.push({
        row,
        playerName: row["NAME"],
        teamAbbrev: row["TEAM"] ?? row["_team"] ?? "",
        oppAbbrev:  row["OPP_TM"] ?? row["OPP"] ?? "",
      });
    }
  });

  console.log(`[RGProxy] [STATE] Raw rows with NAME: ${rawRows.length}`);

  // ── Resolve MLB IDs and build headshot/logo URLs in parallel ─────────────
  // Batch MLB ID lookups: deduplicate by name to avoid redundant API calls
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

  // ── Build final columns list (add enriched columns at front) ──────────────
  // Insert enriched columns right after NAME so they appear first in the table
  const enrichedCols = ["NAME", "HEADSHOT_URL", "MLB_ID", "PLAYER_ID", "TEAM_LOGO_URL", "OPP_LOGO_URL"];
  const remainingCols = columns.filter(c => !enrichedCols.includes(c));
  const finalColumns = [...enrichedCols, ...remainingCols];

  console.log(
    `[RGProxy] [OUTPUT] page=${pageKey} finalColumns=${finalColumns.length} rows=${rows.length}`
  );

  return { title, pageKey, type, updatedAt, columns: finalColumns, rows };
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

    const pageUrl = `${RG_BASE}${pageConf.slug}#expand`;
    console.log(`[RGProxy] [INPUT] user=@${appUser.username} page=${pageKey} url=${pageUrl}`);

    // ── Step 4: Get Rotogrinders session cookie ───────────────────────────────
    let rgCookie: string;
    try {
      rgCookie = await getRgSessionCookie();
    } catch (err) {
      console.error("[RGProxy] [VERIFY] FAIL — Could not obtain RG session:", (err as Error).message);
      res.status(502).json({ error: "Failed to authenticate with Rotogrinders" });
      return;
    }

    // ── Step 5: Fetch the page ────────────────────────────────────────────────
    let html: string;
    try {
      html = await fetchRgPage(pageUrl, rgCookie);
      console.log(`[RGProxy] [STATE] Fetched HTML: ${html.length} bytes`);
    } catch (err) {
      console.error("[RGProxy] [VERIFY] FAIL — Fetch error:", (err as Error).message);
      res.status(502).json({ error: "Failed to fetch from Rotogrinders" });
      return;
    }

    // ── Step 6: Parse table + enrich with MLB IDs / headshots / logos ─────────
    const tableData = await parseRgTable(html, pageKey, pageConf.title, pageConf.type);

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

  console.log("[RGProxy] Route registered: GET /api/rg-proxy?page=<key> → JSON table data");
}
