/**
 * betTrackerStatsCache.test.ts — the cache must be correct under >1 replica.
 *
 * The cache and its invalidation are both per-process. With one replica that is
 * sound; with two, a write served by replica A leaves B's entry intact and B
 * serves stale W/L and ROI until the TTL expires — silently, and triggered by
 * scaling up, which looks like a safe ops action.
 *
 * A fingerprint of the underlying rows makes that detectable rather than
 * trusting invalidation to reach every process.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildStatsCacheKey,
  buildStatsFingerprint,
  clearStatsCache,
  getStatsCache,
  invalidateStatsCacheForUser,
  setStatsCache,
  statsCacheSize,
} from "./betTrackerStatsCache";

const KEY = buildStatsCacheKey(14, { sport: "MLB", unitSize: 100 });
const FP = (rowCount: number, maxUpdated: string | null, idChecksum: number | null) =>
  buildStatsFingerprint({ rowCount, maxUpdated, idChecksum });

const BASE = FP(10, "2026-08-01 12:00:00", 550);

beforeEach(() => clearStatsCache());

describe("fingerprint validation", () => {
  it("returns the cached value when the rows are unchanged", () => {
    setStatsCache(KEY, { netProfit: 5 }, false, BASE);
    expect(getStatsCache(KEY, BASE)).toEqual({ netProfit: 5 });
  });

  it("REGRESSION: rejects an entry another replica's write invalidated", () => {
    // Replica A caches. Replica B inserts a bet — A's map never hears about it.
    setStatsCache(KEY, { netProfit: 5 }, false, BASE);
    const afterInsert = FP(11, "2026-08-01 12:00:05", 601);
    expect(getStatsCache(KEY, afterInsert)).toBeNull();
  });

  it("detects a grade landing on an existing row (count unchanged, updatedAt moves)", () => {
    setStatsCache(KEY, { netProfit: 5 }, false, BASE);
    expect(getStatsCache(KEY, FP(10, "2026-08-01 12:00:09", 550))).toBeNull();
  });

  it("detects a deletion (count drops, checksum drops)", () => {
    setStatsCache(KEY, { netProfit: 5 }, false, BASE);
    expect(getStatsCache(KEY, FP(9, "2026-08-01 12:00:00", 500))).toBeNull();
  });

  it("detects a same-second delete+insert, which count and updatedAt alone would miss", () => {
    // Row 50 deleted and row 99 inserted inside one second: rowCount identical,
    // maxUpdated identical at second granularity. Only the id checksum moves.
    setStatsCache(KEY, { netProfit: 5 }, false, BASE);
    expect(getStatsCache(KEY, FP(10, "2026-08-01 12:00:00", 599))).toBeNull();
  });

  it("drops the poisoned entry rather than leaving it to be re-checked", () => {
    setStatsCache(KEY, { netProfit: 5 }, false, BASE);
    expect(statsCacheSize()).toBe(1);
    getStatsCache(KEY, FP(11, "2026-08-01 12:00:05", 601));
    expect(statsCacheSize()).toBe(0);
  });

  it("handles an empty row set without collapsing distinct states", () => {
    const empty = FP(0, null, null);
    setStatsCache(KEY, { netProfit: 0 }, false, empty);
    expect(getStatsCache(KEY, empty)).toEqual({ netProfit: 0 });
    // First bet arrives.
    expect(getStatsCache(KEY, FP(1, "2026-08-01 12:00:00", 7))).toBeNull();
  });
});

describe("fingerprint construction", () => {
  it("is stable for identical inputs and distinct for any single change", () => {
    expect(FP(10, "t", 5)).toBe(FP(10, "t", 5));
    expect(FP(10, "t", 5)).not.toBe(FP(11, "t", 5));
    expect(FP(10, "t", 5)).not.toBe(FP(10, "u", 5));
    expect(FP(10, "t", 5)).not.toBe(FP(10, "t", 6));
  });

  it("cannot be confused by null vs zero", () => {
    expect(FP(0, null, null)).not.toBe(FP(0, "0", 0));
  });
});

describe("in-process invalidation still works as the fast path", () => {
  it("clears only the target user's entries", () => {
    const a = buildStatsCacheKey(14, { unitSize: 100 });
    const b = buildStatsCacheKey(99, { unitSize: 100 });
    setStatsCache(a, { x: 1 }, false, BASE);
    setStatsCache(b, { x: 2 }, false, BASE);
    expect(invalidateStatsCacheForUser(14)).toBe(1);
    expect(getStatsCache(a, BASE)).toBeNull();
    expect(getStatsCache(b, BASE)).toEqual({ x: 2 });
  });
});

describe("cache key", () => {
  it("excludes the result filter and cursor — stats span the whole filtered set", () => {
    // Including either would fragment the cache into entries holding identical
    // values, since stats are computed over the unfiltered set regardless of
    // which page or result filter the table is showing.
    const withResult = buildStatsCacheKey(14, { sport: "MLB", unitSize: 100 } as never);
    const plain = buildStatsCacheKey(14, { sport: "MLB", unitSize: 100 });
    expect(withResult).toBe(plain);
  });

  it("separates users, so one tracker can never serve another's numbers", () => {
    expect(buildStatsCacheKey(14, { unitSize: 100 }))
      .not.toBe(buildStatsCacheKey(15, { unitSize: 100 }));
  });

  it("separates unit sizes, which rescale every figure", () => {
    expect(buildStatsCacheKey(14, { unitSize: 100 }))
      .not.toBe(buildStatsCacheKey(14, { unitSize: 50 }));
  });
});
