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
  /** Fingerprint of the underlying rows when these stats were computed. */
  fingerprint: string;
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

/**
 * Read a cached stats block, but ONLY if the underlying rows are unchanged.
 *
 * WHY A FINGERPRINT AND NOT JUST INVALIDATION
 *
 * This cache is per-process, and so is `invalidateStatsCacheForUser`. With one
 * replica that is sound. With two, a write served by replica A invalidates
 * A's map and leaves B's entry intact, so a user who lands on B sees stale W/L
 * and ROI for up to the full TTL — with nothing logged and nothing to notice.
 * `numReplicas` is a dashboard setting, so scaling up (a routine, safe-looking
 * operation) would silently start serving wrong money numbers.
 *
 * The caller passes a cheap fingerprint of the rows the stats were computed
 * from. A mismatch means someone else changed the data, whatever process they
 * were on, so the entry is dropped and recomputed. In-process invalidation is
 * kept as a fast path; correctness no longer depends on it.
 */
export function getStatsCache<T = unknown>(key: string, fingerprint: string): T | null {
  const entry = statsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    statsCache.delete(key);
    return null;
  }
  if (entry.fingerprint !== fingerprint) {
    // Written by another replica, or by a path that could not reach this map.
    statsCache.delete(key);
    return null;
  }
  return entry.stats as T;
}

export function setStatsCache(
  key: string,
  stats: unknown,
  isHistorical: boolean,
  fingerprint: string,
): void {
  const ttl = isHistorical ? TTL_HISTORICAL_MS : TTL_LIVE_MS;
  statsCache.set(key, { stats, expiresAt: Date.now() + ttl, fingerprint });
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

/**
 * Build the fingerprint string from a cheap row-set summary.
 *
 * The three components together detect every mutation that can change a stats
 * block:
 *   rowCount   — inserts and deletes
 *   maxUpdated — updates (grading, edits); `updatedAt` has ON UPDATE CURRENT_TIMESTAMP
 *   idChecksum — a delete plus an insert inside the same second, which would
 *                otherwise leave rowCount and maxUpdated unchanged
 *
 * Cheap by construction: one narrow aggregate over an indexed userId, versus
 * the full-history scan it protects.
 */
export function buildStatsFingerprint(parts: {
  rowCount: number;
  maxUpdated: string | null;
  idChecksum: number | null;
}): string {
  return `${parts.rowCount}:${parts.maxUpdated ?? "-"}:${parts.idChecksum ?? 0}`;
}
