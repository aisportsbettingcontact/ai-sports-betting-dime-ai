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
import { getAppUserById, getDb } from "./db";
import { mlbPlayers, rgSessionCache } from "../drizzle/schema";
import { like, isNotNull, or, eq, sql as drizzleSql } from "drizzle-orm";

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

// ─── Concurrency Limiter for MLB API fallback ─────────────────────────────────
// Caps parallel MLB Stats API calls at 10 to prevent request storms.
// DB batch lookup handles the bulk; this only fires for cache misses.
let _mlbApiSlots = 10;
const _mlbApiQueue: Array<() => void> = [];

function acquireMlbApiSlot(): Promise<void> {
  if (_mlbApiSlots > 0) {
    _mlbApiSlots--;
    return Promise.resolve();
  }
  return new Promise(resolve => _mlbApiQueue.push(resolve));
}

function releaseMlbApiSlot(): void {
  const next = _mlbApiQueue.shift();
  if (next) {
    next();
  } else {
    _mlbApiSlots++;
  }
}

/**
 * Batch-resolve MLB IDs for a list of player names using a single DB query.
 * Returns a Map<normalizedName, mlbamId|null>.
 * Players already in the in-memory cache are skipped.
 * Players not found in DB fall through to the individual MLB API lookup.
 */
async function batchResolveMlbIdsFromDb(
  names: string[]
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  const needsDb: Array<{ aliasedName: string; key: string; lastNameRaw: string }> = [];

  // Phase 1: check in-memory cache
  for (const name of names) {
    const aliasedName = applyFirstNameAlias(name);
    const key = normalizeName(aliasedName);
    const cached = mlbIdCache.get(key);
    const nullTtl = 5 * 60 * 1000;
    if (cached) {
      const age = Date.now() - cached.cachedAt;
      if (cached.mlbId !== null && age < MLB_ID_TTL_MS) {
        result.set(key, cached.mlbId);
        continue;
      }
      if (cached.mlbId === null && age < nullTtl) {
        result.set(key, null);
        continue;
      }
    }
    const nameParts = aliasedName.trim().split(/\s+/);
    const lastNameRaw = nameParts[nameParts.length - 1];
    needsDb.push({ aliasedName, key, lastNameRaw });
  }

  if (needsDb.length === 0) return result;

  // Phase 2: single batch DB query for all cache-miss last names
  try {
    const db = await getDb();
    if (db) {
      // Build OR clause: name LIKE '%LastName1%' OR name LIKE '%LastName2%' ...
      // Deduplicate last names to minimize DB work
      const uniqueLastNames = Array.from(new Set(needsDb.map(p => p.lastNameRaw)));
      console.log(`[RGProxy] [STEP] Batch DB lookup: ${needsDb.length} players → ${uniqueLastNames.length} unique last names → 1 query`);
      const t0 = Date.now();

      // Build raw SQL with OR conditions for all last names
      const conditions = uniqueLastNames
        .map(ln => `name COLLATE utf8mb4_unicode_ci LIKE '%${ln.replace(/'/g, "''")}%'`)
        .join(' OR ');
      const [dbRowsRaw] = await db.execute(
        drizzleSql.raw(`SELECT name, mlbamId FROM mlb_players WHERE (${conditions}) AND mlbamId IS NOT NULL LIMIT 2000`)
      ) as [Array<{ name: string; mlbamId: number }>, unknown];

      console.log(`[RGProxy] [STATE] Batch DB lookup: ${dbRowsRaw.length} rows returned in ${Date.now() - t0}ms`);

      // Build a lookup map: normalizedName → mlbamId
      const dbLookup = new Map<string, number>();
      for (const row of dbRowsRaw) {
        dbLookup.set(normalizeNameForDb(row.name), row.mlbamId);
      }

      // Match each player to the DB results
      for (const { aliasedName, key } of needsDb) {
        const normalizedSearch = normalizeNameForDb(aliasedName);
        const mlbId = dbLookup.get(normalizedSearch) ?? null;
        if (mlbId) {
          mlbIdCache.set(key, { mlbId, cachedAt: Date.now() });
          result.set(key, mlbId);
        }
        // If not found, leave out of result — will fall through to MLB API
      }
    }
  } catch (dbErr) {
    console.warn(`[RGProxy] [STATE] Batch DB lookup failed: ${(dbErr as Error).message} — falling back to MLB API for all ${needsDb.length} players`);
  }

  return result;
}

function normalizeName(name: string): string {
  // Replace hyphens with spaces FIRST so "Hao-Yu Lee" → "hao yu lee" (not "haoyu lee")
  // Then strip remaining non-alpha-space characters (apostrophes, periods, etc.)
  return name.trim().toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
}

/**
 * First-name alias map for players whose RotoGrinders name differs from MLB Stats API.
 * Key: normalized first name as it appears in RG CSV
 * Value: normalized first name as it appears in MLB Stats API
 *
 * Usage: applied in resolveMlbId before the MLB API lookup.
 */
const FIRST_NAME_ALIASES: Record<string, string> = {
  // Cameron Schlittler → Cam Schlittler (MLB API uses "Cam")
  "cameron": "cam",
};

/**
 * Apply first-name aliases to a player name.
 * e.g. "Cameron Schlittler" → "Cam Schlittler"
 */
function applyFirstNameAlias(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const firstLower = parts[0].toLowerCase();
  const alias = FIRST_NAME_ALIASES[firstLower];
  if (!alias) return name;
  // Preserve original casing style (capitalize alias)
  const aliasCapitalized = alias.charAt(0).toUpperCase() + alias.slice(1);
  return [aliasCapitalized, ...parts.slice(1)].join(" ");
}

/**
 * Normalize a player name for DB lookup:
 * - Strip Unicode accents (NFD decompose → strip combining marks)
 * - Lowercase, trim, collapse whitespace
 * - Replace hyphens with spaces
 * - Strip non-alpha-space characters
 */
function normalizeNameForDb(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents: é→e, ñ→n, etc.
    .trim()
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Resolve a player MLB ID via the MLB Stats API only (no DB).
 * Used as fallback for players not found in the batch DB lookup.
 * Concurrency is controlled by the caller via acquireMlbApiSlot/releaseMlbApiSlot.
 */
async function resolveMlbIdViaApi(playerName: string): Promise<number | null> {
  const aliasedName = applyFirstNameAlias(playerName);
  if (aliasedName !== playerName) {
    console.log(`[RGProxy] [STATE] First-name alias applied: "${playerName}" → "${aliasedName}"`);
  }
  const key = normalizeName(aliasedName);

  // Check cache first (may have been populated by a concurrent batch lookup)
  const cached = mlbIdCache.get(key);
  const nullTtl = 5 * 60 * 1000;
  if (cached) {
    const age = Date.now() - cached.cachedAt;
    if (cached.mlbId !== null && age < MLB_ID_TTL_MS) return cached.mlbId;
    if (cached.mlbId === null && age < nullTtl) return null;
  }

  const encoded = encodeURIComponent(aliasedName.trim());

  // ── Attempt 1: MLB Stats API /people/search with sportId=1 (MLB only) ────────
  try {
    const url1 = `${MLB_STATS_API}/people/search?names=${encoded}&sportId=1`;
    console.log(`[RGProxy] [STEP] MLB API lookup: player="${playerName}"`);
    const res1 = await fetch(url1, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(2000), // 2s timeout (was 800ms — give API more time)
    });
    if (res1.ok) {
      const data1 = await res1.json() as { people?: { id: number; fullName: string }[] };
      const mlbId1 = data1.people?.[0]?.id ?? null;
      if (mlbId1) {
        console.log(`[RGProxy] [STATE] MLB ID resolved (API): player="${playerName}" id=${mlbId1}`);
        mlbIdCache.set(key, { mlbId: mlbId1, cachedAt: Date.now() });
        return mlbId1;
      }
    }
  } catch (e) {
    console.warn(`[RGProxy] [STATE] MLB API attempt 1 failed for "${playerName}": ${(e as Error).message}`);
  }

  // ── Attempt 2: MLB Stats API /people/search with all sport levels (MiLB + MLB) ─
  const allSportIds = [11, 12, 13, 14, 16];
  for (const sportId of allSportIds) {
    try {
      const url2 = `${MLB_STATS_API}/people/search?names=${encoded}&sportId=${sportId}`;
      const res2 = await fetch(url2, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(2000),
      });
      if (res2.ok) {
        const data2 = await res2.json() as { people?: { id: number; fullName: string }[] };
        const mlbId2 = data2.people?.[0]?.id ?? null;
        if (mlbId2) {
          console.log(`[RGProxy] [STATE] MLB ID resolved (API sportId=${sportId}): player="${playerName}" id=${mlbId2}`);
          mlbIdCache.set(key, { mlbId: mlbId2, cachedAt: Date.now() });
          return mlbId2;
        }
      }
    } catch (e) {
      // silent — fail fast
    }
  }

  console.warn(`[RGProxy] [VERIFY] WARN — MLB ID not found for player="${playerName}"${aliasedName !== playerName ? ` (aliased: "${aliasedName}")` : ""} after API attempts`);
  mlbIdCache.set(key, { mlbId: null, cachedAt: Date.now() });
  return null;
}

function headshotUrl(mlbId: number | null): string {
  if (!mlbId) return "";
  return `${MLB_HEADSHOT_BASE}/${mlbId}/headshot/67/current`;
}

// ─── Session Cookie Cache ─────────────────────────────────────────────────────

/**
 * Parse a raw Cookie header string into a key→value map.
 * Used by the RG proxy route to extract the app_session JWT.
 */
function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return result;
}

// ─── In-memory session cookie cache (fast path, same process) ─────────────────
let cachedRgCookie: string | null = null;
let cookieFetchedAt = 0;
// 25-minute TTL matches RotoGrinders session lifetime.
// DB cache (rg_session_cache) is the cross-process fallback.
const COOKIE_TTL_MS = 25 * 60 * 1000; // 25 minutes

// ─── DB-backed session cookie cache helpers ────────────────────────────────────

/**
 * Load the RG session cookie from the DB cache.
 * Returns the cookie string if valid (not expired), or null if missing/expired.
 */
async function loadDbRgCookie(): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(rgSessionCache).where(eq(rgSessionCache.id, 1)).limit(1);
    if (rows.length === 0) {
      console.log("[RGProxy] [STATE] DB cookie cache: no row found");
      return null;
    }
    const row = rows[0];
    const now = Date.now();
    if (row.expiresAt <= now) {
      console.log(`[RGProxy] [STATE] DB cookie cache: expired (expiresAt=${new Date(row.expiresAt).toISOString()} now=${new Date(now).toISOString()})`);
      return null;
    }
    const remainingMin = Math.round((row.expiresAt - now) / 60000);
    console.log(`[RGProxy] [STATE] DB cookie cache: valid cookie found (expires in ${remainingMin}min)`);
    return row.cookieStr;
  } catch (err) {
    console.warn(`[RGProxy] [VERIFY] WARN — loadDbRgCookie failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Persist the RG session cookie to the DB cache (upsert, id=1).
 * Fire-and-forget — never throws.
 */
async function saveDbRgCookie(cookieStr: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const now = Date.now();
    const expiresAt = now + COOKIE_TTL_MS;
    // MySQL upsert: INSERT ... ON DUPLICATE KEY UPDATE
    await db
      .insert(rgSessionCache)
      .values({ id: 1, cookieStr, fetchedAt: now, expiresAt })
      .onDuplicateKeyUpdate({ set: { cookieStr, fetchedAt: now, expiresAt } });
    console.log(`[RGProxy] [STATE] DB cookie cache: saved (expires ${new Date(expiresAt).toISOString()})`);
  } catch (err) {
    console.warn(`[RGProxy] [VERIFY] WARN — saveDbRgCookie failed: ${(err as Error).message}`);
  }
}

/**
 * Invalidate the DB cookie cache (called on 401/403 to force re-login).
 * Fire-and-forget — never throws.
 */
async function invalidateDbRgCookie(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.delete(rgSessionCache).where(eq(rgSessionCache.id, 1));
    console.log("[RGProxy] [STATE] DB cookie cache: invalidated");
  } catch {
    // Non-fatal
  }
}

/**
 * Get a valid RotoGrinders session cookie.
 *
 * Cache hierarchy (fastest → slowest):
 *   1. In-memory (same process, zero latency)
 *   2. DB rg_session_cache (cross-process, survives server restarts)
 *   3. Fresh login via POST /sign-in (6-8s, 15s hard timeout)
 *
 * Progress events are emitted via the optional onProgress callback so the
 * live sync panel shows granular sub-steps inside the rg-login phase.
 */
export async function getRgSessionCookie(
  onProgress?: (msg: string) => void
): Promise<string> {
  const t0 = Date.now();
  const now = t0;

  // ── Layer 1: in-memory cache ────────────────────────────────────────────────
  if (cachedRgCookie && now - cookieFetchedAt < COOKIE_TTL_MS) {
    const remainingMin = Math.round((COOKIE_TTL_MS - (now - cookieFetchedAt)) / 60000);
    console.log(`[RGProxy] [STATE] Using in-memory RG session cookie (expires in ~${remainingMin}min)`);
    onProgress?.("RotoGrinders session restored from cache");
    return cachedRgCookie;
  }

  // ── Layer 2: DB cache ───────────────────────────────────────────────────────
  onProgress?.("Checking RotoGrinders session cache...");
  console.log("[RGProxy] [STEP] In-memory cookie expired or missing — checking DB cache");
  const dbCookie = await loadDbRgCookie();
  if (dbCookie) {
    // Warm the in-memory cache from DB so next call is instant
    cachedRgCookie = dbCookie;
    cookieFetchedAt = Date.now();
    console.log("[RGProxy] [STATE] RG session cookie loaded from DB cache — in-memory cache warmed");
    onProgress?.("RotoGrinders session restored from DB cache");
    return dbCookie;
  }

  // ── Layer 3: fresh login ────────────────────────────────────────────────────
  const username = process.env.ROTOGRINDERS_USERNAME;
  const password = process.env.ROTOGRINDERS_PASSWORD;

  if (!username || !password) {
    throw new Error("ROTOGRINDERS_USERNAME or ROTOGRINDERS_PASSWORD not set in environment");
  }

  console.log(`[RGProxy] [STEP] Sending login request to RotoGrinders (username=${username})...`);
  onProgress?.("Sending login request to RotoGrinders...");

  const LOGIN_TIMEOUT_MS = 15_000; // 15s hard timeout — RG login should complete in < 3s
  const loginStart = Date.now();

  let loginRes: globalThis.Response;
  try {
    loginRes = await fetch(`${RG_BASE}/sign-in`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer": `${RG_BASE}/sign-in`,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": RG_BASE,
        "Connection": "keep-alive",
      },
      body: new URLSearchParams({ username, password }).toString(),
      redirect: "manual",
      // CRITICAL: 15s hard timeout. Without this, Node.js fetch waits indefinitely
      // if RotoGrinders is rate-limiting or the TCP connection hangs.
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    const elapsed = Date.now() - loginStart;
    const msg = (fetchErr as Error).message;
    if (msg.includes("TimeoutError") || msg.includes("AbortError") || msg.includes("timed out")) {
      console.error(`[RGProxy] [VERIFY] FAIL — RG login request timed out after ${elapsed}ms (limit=${LOGIN_TIMEOUT_MS}ms) — RotoGrinders may be rate-limiting`);
      throw new Error(`RotoGrinders login timed out after ${(elapsed / 1000).toFixed(1)}s — server may be rate-limiting. Retry in 30s.`);
    }
    console.error(`[RGProxy] [VERIFY] FAIL — RG login fetch error after ${elapsed}ms: ${msg}`);
    throw new Error(`RotoGrinders login network error: ${msg}`);
  }

  const loginElapsed = Date.now() - loginStart;
  console.log(`[RGProxy] [STATE] RG login response received: status=${loginRes.status} elapsed=${loginElapsed}ms`);
  onProgress?.("RotoGrinders login response received — extracting session cookie...");

  const setCookieHeaders: string[] = [];
  loginRes.headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() === "set-cookie") {
      setCookieHeaders.push(value);
    }
  });

  console.log(`[RGProxy] [STATE] RG login set-cookie headers: count=${setCookieHeaders.length}`);

  const rguidCookie = setCookieHeaders
    .map((c: string) => c.split(";")[0])
    .find((c: string) => c.startsWith("rguid="));

  const cookieStr = setCookieHeaders
    .map((c: string) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!rguidCookie && !cookieStr) {
    console.error(`[RGProxy] [VERIFY] FAIL — RG login returned no cookies (status=${loginRes.status} elapsed=${loginElapsed}ms)`);
    throw new Error(`RotoGrinders login returned no session cookies (HTTP ${loginRes.status}) — credentials may be invalid or account locked`);
  }

  if (!rguidCookie) {
    console.warn(`[RGProxy] [STATE] WARN — rguid cookie not found in response (status=${loginRes.status}). Using all ${setCookieHeaders.length} cookies.`);
  } else {
    console.log(`[RGProxy] [STATE] RG login success — rguid obtained (status=${loginRes.status} elapsed=${loginElapsed}ms)`);
  }

  // Update in-memory cache
  cachedRgCookie = cookieStr;
  cookieFetchedAt = Date.now();

  // Persist to DB cache (fire-and-forget)
  void saveDbRgCookie(cookieStr);

  const totalElapsed = Date.now() - t0;
  console.log(`[RGProxy] [OUTPUT] RG session cookie obtained via fresh login in ${totalElapsed}ms`);
  onProgress?.(`RotoGrinders session established (${(totalElapsed / 1000).toFixed(1)}s)`);
  return cookieStr;
}

// ─── CSV Fetch with Auto-Retry on 401/403 ────────────────────────────────────

export async function fetchRgCsv(csvId: string, cookie: string): Promise<string> {
  const csvUrl = `${RG_BASE}/grids/${csvId}.csv`;
  console.log(`[RGProxy] [STEP] Fetching CSV: ${csvUrl}`);

  // ── Helper: single attempt ─────────────────────────────────────────────────
  async function attemptFetch(cookieStr: string): Promise<globalThis.Response> {
    return fetch(csvUrl, {
      headers: {
        "Cookie": cookieStr,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer": RG_BASE,
        "Accept": "text/csv,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
  }

  // ── Helper: validate CSV text ──────────────────────────────────────────────
  // Returns true if CSV has data, false if empty (empty is valid for tomorrow tabs when
  // projections haven't been published yet). Throws only for non-CSV (paywall/redirect).
  function validateCsv(text: string): boolean {
    if (!text.trim()) {
      console.log(`[RGProxy] [STATE] CSV is empty for csvId=${csvId} (projections not yet published — this is normal for tomorrow tabs)`);
      return false; // empty but valid
    }
    if (!text.includes("PLAYER") && !text.includes("NAME")) {
      console.error(`[RGProxy] [VERIFY] FAIL — CSV response does not contain expected headers. First 300 chars: ${text.substring(0, 300)}`);
      throw new Error(`RG CSV response appears to be non-CSV (paywall or redirect) for csvId=${csvId}`);
    }
    return true; // has data
  }

  // ── Attempt 1: use provided cookie ────────────────────────────────────────
  let res = await attemptFetch(cookie);
  console.log(`[RGProxy] [STATE] CSV fetch attempt 1: status=${res.status}`);

  // ── 401/403: re-authenticate and retry immediately ─────────────────────────
  if (res.status === 401 || res.status === 403) {
    console.warn(`[RGProxy] [STATE] RG returned ${res.status} — clearing in-memory + DB cookie cache and re-authenticating`);
    cachedRgCookie = null;
    cookieFetchedAt = 0;
    // Also invalidate DB cache so next process doesn't reuse the expired cookie
    void invalidateDbRgCookie();
    const freshCookie = await getRgSessionCookie();
    res = await attemptFetch(freshCookie);
    console.log(`[RGProxy] [STATE] CSV fetch after re-auth: status=${res.status}`);
    if (!res.ok) throw new Error(`RG CSV returned ${res.status} after re-auth`);
    const text = await res.text();
    const hasData = validateCsv(text);
    if (!hasData) {
      console.log(`[RGProxy] [STATE] CSV empty after re-auth for csvId=${csvId} — returning empty string`);
      return "";
    }
    console.log(`[RGProxy] [STATE] CSV fetched after re-auth: ${text.length} bytes, ${text.split("\n").length} lines`);
    return text;
  }

  // ── 503/502/429: exponential backoff retry (up to 3 total attempts) ─────────────
  const RETRYABLE = new Set([429, 502, 503, 504]);
  if (RETRYABLE.has(res.status)) {
    const delays = [1500, 3500]; // ms between retries
    for (let attempt = 2; attempt <= 3; attempt++) {
      const delay = delays[attempt - 2];
      console.warn(`[RGProxy] [STATE] RG returned ${res.status} — waiting ${delay}ms before attempt ${attempt}/3`);
      await new Promise(r => setTimeout(r, delay));
      res = await attemptFetch(cookie);
      console.log(`[RGProxy] [STATE] CSV fetch attempt ${attempt}: status=${res.status}`);
      if (res.ok) break;
      if (!RETRYABLE.has(res.status)) break; // non-retryable error, stop
    }
  }

  if (!res.ok) {
    // Read body for diagnostic context
    const body = await res.text().catch(() => "");
    console.error(`[RGProxy] [VERIFY] FAIL — CSV fetch failed after retries: status=${res.status} body_preview="${body.substring(0, 200)}"`);
    throw new Error(`RG CSV returned ${res.status}${body ? ` — ${body.substring(0, 120)}` : ""} for csvId=${csvId}`);
  }

  const text = await res.text();
  const hasData = validateCsv(text);
  if (!hasData) {
    console.log(`[RGProxy] [STATE] CSV empty for csvId=${csvId} — returning empty string (projections not yet published)`);
    return "";
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
  // ── Handle empty CSV (projections not yet published for tomorrow tabs) ───────────────
  if (!csvText || !csvText.trim()) {
    console.log(`[RGProxy] [STATE] parseRgCsv: empty csvText for page=${pageKey} — returning empty result (projections not yet published)`);
    return { title, pageKey, type, updatedAt: "", columns: [], rows: [] };
  }

  // ── Parse CSV ─────────────────────────────────────────────────────
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
    // Skip empty names and metadata/footer rows (RG CSVs end with a row of column indices)
    if (!playerName) continue;
    if (/^\d+$/.test(playerName.trim())) {
      console.log(`[RGProxy] [STATE] Skipping numeric NAME row (metadata footer): NAME="${playerName}" line=${i}`);
      continue;
    }

    // PLAYER_ID from PLAYERID column
    row["PLAYER_ID"] = row["PLAYERID"] ?? "";

    const teamAbbrev = cells[teamColIdx] ?? "";
    const oppAbbrev  = cells[oppColIdx]  ?? "";

    rawRows.push({ row, playerName, teamAbbrev, oppAbbrev });
  }

  console.log(`[RGProxy] [STATE] Parsed rows with NAME: ${rawRows.length}`);

  // ── Resolve MLB IDs: batch DB lookup + concurrency-limited MLB API fallback ────────────────
  // CRITICAL: Never fire 390 individual DB queries in parallel — this exhausts the
  // connection pool (20 connections) when the Sheets sync runs concurrently.
  // Solution: 1 batch DB query for all players, then max-10-concurrent MLB API for misses.
  const uniqueNames = Array.from(new Set(rawRows.map(r => r.playerName)));
  console.log(`[RGProxy] [STEP] Resolving MLB IDs for ${uniqueNames.length} unique players...`);

  // Phase 1: batch DB lookup (1 query, returns all matches)
  const mlbIdMap = await batchResolveMlbIdsFromDb(uniqueNames);

  // Phase 2: MLB API fallback for players not resolved by DB (concurrency-limited to 10)
  const needsApi = uniqueNames.filter(name => {
    const aliasedName = applyFirstNameAlias(name);
    const key = normalizeName(aliasedName);
    return !mlbIdMap.has(key);
  });

  if (needsApi.length > 0) {
    console.log(`[RGProxy] [STEP] MLB API fallback for ${needsApi.length} players not found in DB (max 10 concurrent)...`);
    await Promise.all(
      needsApi.map(async name => {
        await acquireMlbApiSlot();
        try {
          const id = await resolveMlbIdViaApi(name);
          const aliasedName = applyFirstNameAlias(name);
          const key = normalizeName(aliasedName);
          mlbIdMap.set(key, id);
          mlbIdMap.set(normalizeName(name), id);
        } finally {
          releaseMlbApiSlot();
        }
      })
    );
  }

  // Ensure all names have an entry (null for unresolved)
  for (const name of uniqueNames) {
    const aliasedName = applyFirstNameAlias(name);
    const key = normalizeName(aliasedName);
    if (!mlbIdMap.has(key)) mlbIdMap.set(key, null);
    mlbIdMap.set(normalizeName(name), mlbIdMap.get(key) ?? null);
  }

  const resolvedCount = Array.from(mlbIdMap.values()).filter(v => v !== null).length;
  const apiCount = needsApi.length;
  const dbCount = uniqueNames.length - apiCount;
  console.log(`[RGProxy] [STATE] MLB ID resolution: ${resolvedCount}/${uniqueNames.length} resolved (${dbCount} from DB/cache, ${apiCount} via API)`);

  // ── Build final rows with enriched fields ─────────────────────────────────
  const missingMlbIds: string[] = [];
  const missingPlayerIds: string[] = [];

  const rows: Record<string, string>[] = rawRows.map(({ row, playerName, teamAbbrev, oppAbbrev }) => {
    const mlbId = mlbIdMap.get(normalizeName(playerName)) ?? null;
    const playerId = row["PLAYERID"] ?? row["PLAYER_ID"] ?? "";

    if (!mlbId) missingMlbIds.push(playerName);
    if (!playerId) missingPlayerIds.push(playerName);

    return {
      ...row,
      MLB_ID:        mlbId ? String(mlbId) : "",
      PLAYER_ID:     playerId,
      HEADSHOT_URL:  headshotUrl(mlbId),
      TEAM_LOGO_URL: teamAbbrev ? teamLogoUrl(teamAbbrev) : "",
      OPP_LOGO_URL:  oppAbbrev  ? teamLogoUrl(oppAbbrev)  : "",
    };
  });

  if (missingMlbIds.length > 0) {
    console.warn(`[RGProxy] [VERIFY] WARN — ${missingMlbIds.length} player(s) missing MLB_ID on page=${pageKey}: ${missingMlbIds.join(", ")}`);
  }
  if (missingPlayerIds.length > 0) {
    console.warn(`[RGProxy] [VERIFY] WARN — ${missingPlayerIds.length} player(s) missing PLAYER_ID (RG) on page=${pageKey}: ${missingPlayerIds.join(", ")}`);
  }
  if (missingMlbIds.length === 0 && missingPlayerIds.length === 0) {
    console.log(`[RGProxy] [VERIFY] PASS — All ${rows.length} players have MLB_ID and PLAYER_ID on page=${pageKey}`);
  }

  // ── Build final columns list (DETERMINISTIC CANONICAL ORDER) ────────────────
  //
  // RULE: PLAYER_ID first, NAME second, all known RG columns in exact source order,
  //       any unknown columns appended before MLB_ID, MLB_ID always last.
  //
  // This is the single source of truth for column order across all 4 RG tabs.
  // Never derive order from CSV headers — RG column order is not stable between slates.
  //
  // Internal-only columns (HEADSHOT_URL, TEAM_LOGO_URL, OPP_LOGO_URL, PLAYERID) are
  // excluded from the sheet write by EXCLUDED_COLUMNS in jackMacSheetsSync.ts.
  const CANONICAL_RG_COLUMNS: string[] = [
    // ── Identity (always first two) ──────────────────────────────────────────
    "PLAYER_ID",
    "NAME",
    // ── Core DFS columns (RG source order) ──────────────────────────────────
    "SALARY",
    "POS",
    "TEAM",
    "OPP",
    "SCHEDULE_ID",
    "SLATE",
    "TM",
    "OPP_TM",
    "HAND",
    "OL",
    "OD",
    "PCC",
    "ERROR",
    "2H",
    "BPC",
    "PPC",
    "MPC",
    "OPENER",
    "CATCHER",
    "UMPIRE",
    "PARK",
    "ROOF",
    "PLATOON",
    "SPLIT",
    "GVF",
    "HFA",
    "DH",
    "FAMILIARITY",
    "TILT_BIAS",
    "FPTS",
    "FPTS/$",
    "POWN",
    "RGID",
    "OBFPTS",
    // ── Pitcher-specific columns ─────────────────────────────────────────────
    "IP",
    "OUTS",
    "ERA",
    "CNERA",
    "W",
    "L",
    "QS",
    "CG",
    "CGSH",
    "TBF",
    "AB",
    "K",
    "BB",
    "IBB",
    "HBP",
    "H",
    "HR",
    "TB",
    "SH",
    "SF",
    "GIDP",
    "SB",
    "CS",
    "ER",
    "FLOOR",
    "CEILING",
    "PARTNERID",
    "OWNERSHIP",
    // ── Internal enrichment (excluded from sheet write by EXCLUDED_COLUMNS) ──
    "HEADSHOT_URL",
    "TEAM_LOGO_URL",
    "OPP_LOGO_URL",
    // ── MLB_ID always last ────────────────────────────────────────────────────
    "MLB_ID",
  ];

  // Build a set of all columns present in the data (normalized headers + enriched)
  const availableCols = new Set<string>([
    ...normalizedHeaders.filter(c => c !== "PLAYERID"), // PLAYERID → PLAYER_ID already in CANONICAL
    "PLAYER_ID",
    "MLB_ID",
    "HEADSHOT_URL",
    "TEAM_LOGO_URL",
    "OPP_LOGO_URL",
  ]);

  // Step 1: canonical columns that are actually present in this CSV
  const canonicalPresent = CANONICAL_RG_COLUMNS.filter(c => availableCols.has(c));

  // Step 2: any columns RG sent that are NOT in the canonical list (unknown future columns)
  //         — insert them before MLB_ID so they are visible but not disruptive
  const canonicalSet = new Set(CANONICAL_RG_COLUMNS);
  const unknownCols = normalizedHeaders.filter(
    c => c !== "PLAYERID" && !canonicalSet.has(c)
  );

  if (unknownCols.length > 0) {
    console.warn(
      `[RGProxy] [VERIFY] WARN — page=${pageKey} has ${unknownCols.length} unknown column(s) not in canonical list: ${unknownCols.join(", ")}. Appending before MLB_ID.`
    );
  }

  // Insert unknown columns before MLB_ID in the canonical list
  const mlbIdIdx = canonicalPresent.indexOf("MLB_ID");
  const finalColumns: string[] = mlbIdIdx >= 0
    ? [...canonicalPresent.slice(0, mlbIdIdx), ...unknownCols, "MLB_ID"]
    : [...canonicalPresent, ...unknownCols];

  console.log(
    `[RGProxy] [OUTPUT] page=${pageKey} finalColumns=${finalColumns.length} rows=${rows.length} first3=[${finalColumns.slice(0, 3).join(",")}] last=[${finalColumns[finalColumns.length - 1]}]`
  );
  console.log(
    `[RGProxy] [VERIFY] ${finalColumns[0] === "PLAYER_ID" && finalColumns[1] === "NAME" && finalColumns[finalColumns.length - 1] === "MLB_ID" ? "PASS" : "FAIL"} — column order: PLAYER_ID[0]=${finalColumns[0]} NAME[1]=${finalColumns[1]} LAST=${finalColumns[finalColumns.length - 1]}`
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
