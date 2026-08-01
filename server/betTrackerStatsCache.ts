/**
 * betTrackerStatsCache.ts — process-local memo for computed Bet Tracker stats.
 *
 * Lives in its own module so both the tRPC router (which reads/writes it) and
 * the grading engine (which invalidates it after a background settle) can depend
 * on it without importing each other. The router previously owned it, which
 * forced the scheduler to import the router and made it impossible for the
 * router to reuse the scheduler's grading code.
 *
 * Correctness contract: the cache key is derived from the RESOLVED userId — the
 * user whose rows were actually aggregated — never the requesting viewer. An
 * owner viewing a handicapper's tracker reads and writes that handicapper's
 * cache entry, so the two can never cross-contaminate.
 */

interface StatsCacheEntry {
  stats: unknown;
  expiresAt: number;
}

const statsCache = new Map<string, StatsCacheEntry>();

/** Historical ranges are immutable once graded; live ranges may still settle. */
const TTL_HISTORICAL_MS = 5 * 60_000;
const TTL_LIVE_MS = 30_000;
const MAX_ENTRIES = 500;

export interface StatsCacheKeyInput {
  sport?: string | null;
  gameDate?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  unitSize?: number | null;
  isHistorical?: boolean | null;
}

/**
 * Build the cache key for a resolved user + filter combination.
 *
 * Note what is NOT in the key: the `result` filter and the pagination cursor.
 * Stats are always computed over the full filtered set regardless of which page
 * is being displayed or which result the list is filtered to, so including
 * either would fragment the cache into entries holding identical values.
 */
export function buildStatsCacheKey(userId: number, input: StatsCacheKeyInput | undefined): string {
  return JSON.stringify({
    u: userId,
    s: input?.sport ?? null,
    gd: input?.gameDate ?? null,
    df: input?.dateFrom ?? null,
    dt: input?.dateTo ?? null,
    us: input?.unitSize ?? 100,
    ih: input?.isHistorical ?? false,
  });
}

export function getStatsCache<T = unknown>(key: string): T | null {
  const entry = statsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    statsCache.delete(key);
    return null;
  }
  return entry.stats as T;
}

export function setStatsCache(key: string, stats: unknown, isHistorical: boolean): void {
  const ttl = isHistorical ? TTL_HISTORICAL_MS : TTL_LIVE_MS;
  statsCache.set(key, { stats, expiresAt: Date.now() + ttl });
  if (statsCache.size > MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of Array.from(statsCache.entries())) {
      if (now > v.expiresAt) statsCache.delete(k);
    }
  }
}

/**
 * Drop every cached entry belonging to a user.
 *
 * Callers MUST pass the OWNER of the mutated bet, not the actor who mutated it.
 * An admin editing a handicapper's bet has to clear the handicapper's entries;
 * clearing the admin's own does nothing and leaves the handicapper looking at
 * stale W/L and ROI for up to the full TTL.
 */
export function invalidateStatsCacheForUser(userId: number): number {
  let removed = 0;
  for (const key of Array.from(statsCache.keys())) {
    try {
      const parsed = JSON.parse(key) as { u: number };
      if (parsed.u === userId) {
        statsCache.delete(key);
        removed++;
      }
    } catch {
      /* malformed key — leave it; it will expire on TTL */
    }
  }
  return removed;
}

/** Clear every entry. Test-only helper. */
export function clearStatsCache(): void {
  statsCache.clear();
}

/** Current entry count. Test-only helper. */
export function statsCacheSize(): number {
  return statsCache.size;
}
