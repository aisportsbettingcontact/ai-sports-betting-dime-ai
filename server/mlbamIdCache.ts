/**
 * mlbamIdCache.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared MLB AM ID lookup cache.
 *
 * PROBLEM ELIMINATED:
 *   Previously, both mlbHrPropsModelService.ts and mlbKPropsModelService.ts
 *   each defined their own `fetchMlbamIdMap()` function that hit the MLB Stats
 *   API fresh on every cycle. During a single MLBCycle run, this caused:
 *     • 2 redundant MLB Stats API calls (each fetching ~1,200 players)
 *     • ~15–30s of unnecessary network latency per cycle
 *     • Duplicate WARN logs for the same unresolved players
 *
 * FIX:
 *   Single module-level cache with a 6-hour TTL.
 *   Both services import `getMlbamIdMap()` from here.
 *   First call in a cycle fetches; subsequent calls return the cached map.
 *
 * USAGE:
 *   import { getMlbamIdMap } from "./mlbamIdCache";
 *   const apiMap = await getMlbamIdMap();
 *   const id = apiMap.get(normalizeName(playerName)) ?? null;
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TAG = "[MlbamIdCache]";

// Cache TTL: 6 hours — roster changes are infrequent within a day
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Module-level cache — persists across calls within the same server process
let cachedMap: Map<string, number> | null = null;
let cacheBuiltAt = 0;

/**
 * Normalize a player name for consistent lookup.
 * Matches the normalization used in both HR and K-Props services.
 */
export function normalizeMlbamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+jr\.?$|\s+sr\.?$|\s+ii$|\s+iii$|\s+iv$/i, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

/**
 * Returns the MLB AM ID map, using the module-level cache when fresh.
 * Falls back to an empty map on API failure (callers should handle null mlbamId gracefully).
 */
export async function getMlbamIdMap(): Promise<Map<string, number>> {
  const now = Date.now();

  // Return cached map if still fresh
  if (cachedMap !== null && now - cacheBuiltAt < CACHE_TTL_MS) {
    console.log(`${TAG} [CACHE HIT] ${cachedMap.size} players (age=${Math.round((now - cacheBuiltAt) / 1000)}s)`);
    return cachedMap;
  }

  console.log(`${TAG} [CACHE MISS] Fetching MLB Stats API player roster...`);
  const map = new Map<string, number>();

  try {
    const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=2026&gameType=R`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { people?: Array<{ id: number; fullName: string }> };
    for (const p of data.people ?? []) {
      map.set(normalizeMlbamName(p.fullName), p.id);
    }
    console.log(`${TAG} [OUTPUT] Loaded ${map.size} players from MLB Stats API (season=2026)`);
    cachedMap = map;
    cacheBuiltAt = now;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] MLB Stats API fetch failed: ${msg}`);
    // Return stale cache if available, otherwise empty map
    if (cachedMap !== null) {
      console.warn(`${TAG} [FALLBACK] Returning stale cache (${cachedMap.size} players, age=${Math.round((now - cacheBuiltAt) / 1000)}s)`);
      return cachedMap;
    }
  }

  return map;
}

/**
 * Force-invalidate the cache (e.g., after a roster trade or call-up).
 */
export function invalidateMlbamIdCache(): void {
  cachedMap = null;
  cacheBuiltAt = 0;
  console.log(`${TAG} [INVALIDATED] Cache cleared`);
}

/**
 * Returns cache health stats for monitoring.
 */
export function getMlbamIdCacheStats(): { size: number; ageSeconds: number; fresh: boolean } {
  const now = Date.now();
  return {
    size: cachedMap?.size ?? 0,
    ageSeconds: cachedMap ? Math.round((now - cacheBuiltAt) / 1000) : -1,
    fresh: cachedMap !== null && now - cacheBuiltAt < CACHE_TTL_MS,
  };
}
