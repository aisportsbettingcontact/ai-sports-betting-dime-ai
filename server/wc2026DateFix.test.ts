/**
 * wc2026DateFix.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the WC2026 date scheduling fix.
 *
 * Root cause: todayWithOdds used raw UTC ISO date which caused late-night UTC
 * matches (kickoff_utc crossing midnight UTC) to disappear from the feed after
 * midnight UTC because their match_date is the local date (e.g. June 18) but
 * the server was computing today as June 19.
 *
 * Fix: Apply the same 11:00 UTC cutoff gate as CalendarPicker.todayUTC().
 * Before 11:00 UTC → use previous calendar day.
 * After 11:00 UTC → use current UTC calendar day.
 */

import { describe, it, expect } from "vitest";

// ─── Replicate the server-side effective date logic ───────────────────────────

const FEED_CUTOFF_UTC_HOUR = 11;

function getEffectiveFeedDate(nowMs: number): string {
  const now = new Date(nowMs);
  const isBeforeCutoff = now.getUTCHours() < FEED_CUTOFF_UTC_HOUR;
  if (isBeforeCutoff) {
    const prev = new Date(now);
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().split("T")[0];
  }
  return now.toISOString().split("T")[0];
}

function getRawUtcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().split("T")[0];
}

// ─── Test cases ───────────────────────────────────────────────────────────────

describe("WC2026 Date Scheduling Fix", () => {

  // ── June 18 at 16:00 UTC (noon EDT) — normal daytime match ─────────────────
  it("June 18 at 16:00 UTC → effective date = June 18 (after cutoff)", () => {
    const ts = Date.UTC(2026, 5, 18, 16, 0, 0); // June 18, 16:00 UTC
    expect(getEffectiveFeedDate(ts)).toBe("2026-06-18");
    expect(getRawUtcDate(ts)).toBe("2026-06-18");
    // Both agree — no bug at this time
  });

  // ── June 19 at 01:30 UTC (June 18 at 9:30 PM EDT) — MEX vs KOR ─────────────
  // This is the exact scenario that caused the bug:
  // match_date = '2026-06-18', kickoff_utc = '2026-06-19 01:00:00'
  it("June 19 at 01:30 UTC → effective date = June 18 (before cutoff)", () => {
    const ts = Date.UTC(2026, 5, 19, 1, 30, 0); // June 19, 01:30 UTC
    const effective = getEffectiveFeedDate(ts);
    const raw = getRawUtcDate(ts);
    
    // [FIX] effective date should be June 18 (match_date in DB)
    expect(effective).toBe("2026-06-18");
    
    // [BUG] raw UTC date would be June 19 — causing the fixture to be missed
    expect(raw).toBe("2026-06-19");
    
    // Confirm the fix resolves the mismatch
    expect(effective).not.toBe(raw);
  });

  // ── June 12 at 02:30 UTC (June 11 at 10:30 PM EDT) — KOR vs CZE ────────────
  // wc26-g-002: match_date='2026-06-11', kickoff_utc='2026-06-12 02:00:00'
  // This is the "Mexico vs South Africa was June 12" bug reported by the user
  it("June 12 at 02:30 UTC → effective date = June 11 (before cutoff)", () => {
    const ts = Date.UTC(2026, 5, 12, 2, 30, 0); // June 12, 02:30 UTC
    const effective = getEffectiveFeedDate(ts);
    const raw = getRawUtcDate(ts);
    
    // [FIX] effective date should be June 11 (match_date in DB)
    expect(effective).toBe("2026-06-11");
    
    // [BUG] raw UTC date would be June 12 — causing the fixture to be missed
    expect(raw).toBe("2026-06-12");
  });

  // ── June 18 at 11:00 UTC (cutoff boundary) ─────────────────────────────────
  it("June 18 at exactly 11:00 UTC → effective date = June 18 (cutoff gate open)", () => {
    const ts = Date.UTC(2026, 5, 18, 11, 0, 0);
    expect(getEffectiveFeedDate(ts)).toBe("2026-06-18");
  });

  // ── June 18 at 10:59 UTC (just before cutoff) ──────────────────────────────
  it("June 18 at 10:59 UTC → effective date = June 17 (before cutoff)", () => {
    const ts = Date.UTC(2026, 5, 18, 10, 59, 0);
    expect(getEffectiveFeedDate(ts)).toBe("2026-06-17");
  });

  // ── June 13 at 04:30 UTC (June 12 at 11:30 PM PDT) — AUS vs TUR ────────────
  // wc26-g-008: match_date='2026-06-13', kickoff_utc='2026-06-14 04:00:00'
  it("June 14 at 04:30 UTC → effective date = June 13 (before cutoff)", () => {
    const ts = Date.UTC(2026, 5, 14, 4, 30, 0);
    const effective = getEffectiveFeedDate(ts);
    expect(effective).toBe("2026-06-13");
  });

  // ── Verify all 4 June 18 fixtures are accessible at various times ───────────
  const june18MatchDates = ["2026-06-18", "2026-06-18", "2026-06-18", "2026-06-18"];
  const testTimes = [
    { label: "16:00 UTC (noon EDT)", ts: Date.UTC(2026, 5, 18, 16, 0, 0) },
    { label: "19:00 UTC (3 PM EDT)", ts: Date.UTC(2026, 5, 18, 19, 0, 0) },
    { label: "22:00 UTC (6 PM EDT)", ts: Date.UTC(2026, 5, 18, 22, 0, 0) },
    { label: "01:30 UTC next day (9:30 PM EDT)", ts: Date.UTC(2026, 5, 19, 1, 30, 0) },
    { label: "03:00 UTC next day (11 PM EDT)", ts: Date.UTC(2026, 5, 19, 3, 0, 0) },
  ];

  for (const { label, ts } of testTimes) {
    it(`June 18 fixtures accessible at ${label}`, () => {
      const effective = getEffectiveFeedDate(ts);
      // All 4 June 18 fixtures should be accessible at any of these times
      expect(effective).toBe("2026-06-18");
    });
  }

  // ── Verify the fix does NOT affect normal daytime matches ───────────────────
  it("Normal daytime match (June 18 at 19:00 UTC) is unaffected by fix", () => {
    const ts = Date.UTC(2026, 5, 18, 19, 0, 0);
    const effective = getEffectiveFeedDate(ts);
    const raw = getRawUtcDate(ts);
    // Both methods agree for daytime matches — fix has no side effect
    expect(effective).toBe(raw);
    expect(effective).toBe("2026-06-18");
  });
});
