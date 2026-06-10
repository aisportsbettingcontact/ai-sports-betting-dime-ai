/**
 * resolveWcTeam.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Name normalization layer for WC2026 team resolution.
 *
 * Resolves any external feed name (Action Network, VSIN, Rotowire, FIFA.com)
 * to a canonical wc2026_teams.team_id via the wc2026_team_aliases table.
 *
 * Resolution order:
 *   1. Exact alias match (wc2026_team_aliases.alias)
 *   2. Exact canonical name match (wc2026_teams.name)
 *   3. FIFA code match (wc2026_teams.fifa_code, case-insensitive)
 *   4. Slug match (wc2026_teams.slug)
 *   5. Normalized fuzzy match (strip accents, lowercase, collapse whitespace)
 *   6. Partial match (substring containment)
 *
 * Logging format:
 *   [ResolveWcTeam] [INPUT]  → raw name
 *   [ResolveWcTeam] [STEP]   → resolution path
 *   [ResolveWcTeam] [OUTPUT] → resolved team_id or null
 *   [ResolveWcTeam] [VERIFY] → PASS / FAIL + reason
 */

import { getDb } from "../db";
import { wc2026Teams, wc2026TeamAliases } from "../../drizzle/wc2026.schema";

// ─── In-memory resolution cache (cleared on server restart) ──────────────────
const _cache = new Map<string, string | null>();
let _cacheBuiltAt: number | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Unicode normalization helper ─────────────────────────────────────────────
function normalizeStr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Alias + teams cache ──────────────────────────────────────────────────────
interface TeamRecord {
  teamId: string;
  name: string;
  fifaCode: string;
  slug: string;
  normName: string;
  normCode: string;
  normSlug: string;
}

let _teams: TeamRecord[] = [];
let _aliases: Map<string, string> = new Map(); // alias → team_id

async function ensureCache(): Promise<void> {
  const now = Date.now();
  if (_cacheBuiltAt && now - _cacheBuiltAt < CACHE_TTL_MS && _teams.length > 0) return;

  const db = await getDb();

  const [teams, aliases] = await Promise.all([
    db.select().from(wc2026Teams),
    db.select().from(wc2026TeamAliases),
  ]);

  _teams = teams.map((t: typeof wc2026Teams.$inferSelect) => ({
    teamId: t.teamId,
    name: t.name,
    fifaCode: t.fifaCode,
    slug: t.slug,
    normName: normalizeStr(t.name),
    normCode: t.fifaCode.toLowerCase(),
    normSlug: normalizeStr(t.slug),
  }));

  _aliases = new Map(aliases.map((a: typeof wc2026TeamAliases.$inferSelect) => [a.alias.toLowerCase(), a.teamId]));
  _cacheBuiltAt = now;

  console.log(
    `[ResolveWcTeam] [STEP] Cache rebuilt: ${_teams.length} teams, ${_aliases.size} aliases`
  );
}

// ─── Main resolver ────────────────────────────────────────────────────────────
/**
 * Resolves an external team name to a wc2026_teams.team_id.
 * Returns null if no match found — caller must handle unmatched names.
 */
export async function resolveWcTeam(rawName: string): Promise<string | null> {
  const cacheKey = rawName.toLowerCase().trim();

  // Check resolution cache first
  if (_cache.has(cacheKey)) {
    return _cache.get(cacheKey) ?? null;
  }

  console.log(`[ResolveWcTeam] [INPUT] rawName="${rawName}"`);

  await ensureCache();

  const norm = normalizeStr(rawName);

  // Step 1: Exact alias match
  const aliasMatch = _aliases.get(cacheKey);
  if (aliasMatch) {
    console.log(`[ResolveWcTeam] [STEP] Resolved via alias: "${rawName}" → "${aliasMatch}"`);
    _cache.set(cacheKey, aliasMatch);
    return aliasMatch;
  }

  // Step 2: Exact canonical name match
  const exactName = _teams.find((t) => t.name.toLowerCase() === cacheKey);
  if (exactName) {
    console.log(
      `[ResolveWcTeam] [STEP] Resolved via exact name: "${rawName}" → "${exactName.teamId}"`
    );
    _cache.set(cacheKey, exactName.teamId);
    return exactName.teamId;
  }

  // Step 3: FIFA code match (3-letter abbr from Rotowire/AN)
  const codeMatch = _teams.find((t) => t.normCode === norm || t.normCode === cacheKey);
  if (codeMatch) {
    console.log(
      `[ResolveWcTeam] [STEP] Resolved via FIFA code: "${rawName}" → "${codeMatch.teamId}"`
    );
    _cache.set(cacheKey, codeMatch.teamId);
    return codeMatch.teamId;
  }

  // Step 4: Slug match
  const slugMatch = _teams.find((t) => t.normSlug === norm);
  if (slugMatch) {
    console.log(
      `[ResolveWcTeam] [STEP] Resolved via slug: "${rawName}" → "${slugMatch.teamId}"`
    );
    _cache.set(cacheKey, slugMatch.teamId);
    return slugMatch.teamId;
  }

  // Step 5: Normalized fuzzy match on canonical name
  const fuzzyMatch = _teams.find((t) => t.normName === norm);
  if (fuzzyMatch) {
    console.log(
      `[ResolveWcTeam] [STEP] Resolved via fuzzy norm: "${rawName}" → "${fuzzyMatch.teamId}"`
    );
    _cache.set(cacheKey, fuzzyMatch.teamId);
    return fuzzyMatch.teamId;
  }

  // Step 6: Partial match (rawName contains canonical name or vice versa)
  const partialMatch = _teams.find(
    (t) => norm.includes(t.normName) || t.normName.includes(norm)
  );
  if (partialMatch) {
    console.log(
      `[ResolveWcTeam] [STEP] Resolved via partial match: "${rawName}" → "${partialMatch.teamId}"`
    );
    _cache.set(cacheKey, partialMatch.teamId);
    return partialMatch.teamId;
  }

  // No match found
  console.warn(
    `[ResolveWcTeam] [VERIFY] FAIL — No match for rawName="${rawName}" (norm="${norm}")`
  );
  _cache.set(cacheKey, null);
  return null;
}

/**
 * Batch-resolve multiple names. Returns a Map<rawName, teamId|null>.
 * Logs all unmatched names as a group for easy diagnosis.
 */
export async function resolveWcTeamBatch(
  rawNames: string[]
): Promise<Map<string, string | null>> {
  await ensureCache();
  const result = new Map<string, string | null>();
  const unmatched: string[] = [];

  for (const name of rawNames) {
    const resolved = await resolveWcTeam(name);
    result.set(name, resolved);
    if (!resolved) unmatched.push(name);
  }

  if (unmatched.length > 0) {
    console.warn(
      `[ResolveWcTeam] [VERIFY] WARN — ${unmatched.length} unmatched names: ${unmatched.join(", ")}`
    );
  }

  return result;
}

/** Force-invalidate the in-memory cache (call after alias table updates). */
export function invalidateWcTeamCache(): void {
  _cache.clear();
  _teams = [];
  _aliases = new Map();
  _cacheBuiltAt = null;
  console.log("[ResolveWcTeam] [STEP] Cache invalidated");
}

/** Expose cache stats for health checks. */
export function getWcTeamCacheStats(): {
  teamCount: number;
  aliasCount: number;
  resolutionCacheSize: number;
  builtAt: string | null;
} {
  return {
    teamCount: _teams.length,
    aliasCount: _aliases.size,
    resolutionCacheSize: _cache.size,
    builtAt: _cacheBuiltAt ? new Date(_cacheBuiltAt).toISOString() : null,
  };
}
