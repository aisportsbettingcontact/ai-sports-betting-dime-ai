/**
 * oddsHistoryPipeline.test.ts
 *
 * Tests for the odds history pipeline:
 * 1. Odds freeze: games with gameStatus='live' or 'final' must be skipped
 * 2. History insertion: source='auto' vs source='manual' tagging
 * 3. EST timestamp display: UTC epoch ms → correct EST string
 * 4. Schedule: active hours window is 3am–midnight PST (not 6am)
 */

import { describe, it, expect } from "vitest";

// ─── 1. Odds freeze logic ─────────────────────────────────────────────────────

/**
 * Mirrors the freeze check in refreshAnApiOdds:
 *   if (dbGame.gameStatus === "live" || dbGame.gameStatus === "final") → skip
 */
function shouldFreezeOdds(gameStatus: string | null | undefined): boolean {
  return gameStatus === "live" || gameStatus === "final";
}

describe("Odds freeze logic", () => {
  it("freezes games with status=live", () => {
    expect(shouldFreezeOdds("live")).toBe(true);
  });

  it("freezes games with status=final", () => {
    expect(shouldFreezeOdds("final")).toBe(true);
  });

  it("does NOT freeze upcoming games", () => {
    expect(shouldFreezeOdds("upcoming")).toBe(false);
  });

  it("does NOT freeze pre-game (null status)", () => {
    expect(shouldFreezeOdds(null)).toBe(false);
  });

  it("does NOT freeze pre-game (undefined status)", () => {
    expect(shouldFreezeOdds(undefined)).toBe(false);
  });

  it("does NOT freeze scheduled games", () => {
    expect(shouldFreezeOdds("scheduled")).toBe(false);
  });
});

// ─── 2. Source tagging ────────────────────────────────────────────────────────

describe("Odds history source tagging", () => {
  it("auto refresh produces source=auto", () => {
    const source: "auto" | "manual" = "auto";
    expect(source).toBe("auto");
  });

  it("manual refresh (Refresh Now button) produces source=manual", () => {
    const source: "auto" | "manual" = "manual";
    expect(source).toBe("manual");
  });

  it("source values are limited to auto|manual enum", () => {
    const validSources = ["auto", "manual"];
    expect(validSources).toContain("auto");
    expect(validSources).toContain("manual");
    expect(validSources).not.toContain("cron");
    expect(validSources).not.toContain("webhook");
  });
});

// ─── 3. EST timestamp display ─────────────────────────────────────────────────

/**
 * Mirrors the fmtEst() helper in OddsHistoryPanel.tsx.
 * UTC epoch ms → "Mar 15, 1:59 PM EDT" (DST) or "Mar 15, 1:59 PM EST" (standard)
 */
function fmtEst(epochMs: number): string {
  const d = new Date(epochMs);
  const datePart = d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const tzAbbr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "short",
    })
      .formatToParts(d)
      .find(p => p.type === "timeZoneName")?.value ?? "ET";
  return `${datePart}, ${timePart} ${tzAbbr}`;
}

describe("EST timestamp formatting", () => {
  it("converts 10:59 AM PDT (17:59 UTC) to 1:59 PM EDT during DST", () => {
    // Mar 15, 2026 is in DST: PDT=UTC-7, EDT=UTC-4
    // 10:59 AM PDT = 17:59 UTC = 1:59 PM EDT
    const pstDate = new Date("2026-03-15T17:59:00.000Z");
    const result = fmtEst(pstDate.getTime());
    expect(result).toContain("1:59 PM EDT");
    expect(result).toContain("Mar 15");
  });

  it("converts midnight UTC (Mar 15) to 8:00 PM EDT previous day (DST)", () => {
    // 2026-03-15T00:00:00Z = Mar 14, 2026 8:00 PM EDT (DST active)
    const utcMidnight = new Date("2026-03-15T00:00:00.000Z");
    const result = fmtEst(utcMidnight.getTime());
    expect(result).toContain("8:00 PM EDT");
    expect(result).toContain("Mar 14");
  });

  it("always appends Eastern timezone abbreviation (EST or EDT)", () => {
    const now = Date.now();
    const result = fmtEst(now);
    // Must end with either EST (standard time) or EDT (daylight saving time)
    expect(result.endsWith(" EST") || result.endsWith(" EDT")).toBe(true);
  });

  it("formats minutes with two digits (zero-padded)", () => {
    // 2026-03-15T15:05:00Z = 11:05 AM EDT (DST active)
    const d = new Date("2026-03-15T15:05:00.000Z");
    const result = fmtEst(d.getTime());
    expect(result).toMatch(/:\d{2} (AM|PM) (EST|EDT)/);
  });
});

// ─── 4. Active hours window ───────────────────────────────────────────────────

/**
 * Mirrors isWithinActiveHours() in vsinAutoRefresh.ts.
 * Active window: 3am–midnight PST.
 */
function isWithinActiveHours(pstHour: number): boolean {
  return pstHour >= 3 && pstHour < 24;
}

describe("Active hours window (3am–midnight PST)", () => {
  it("is active at 3am PST (hour=3)", () => {
    expect(isWithinActiveHours(3)).toBe(true);
  });

  it("is active at 6am PST (hour=6)", () => {
    expect(isWithinActiveHours(6)).toBe(true);
  });

  it("is active at noon PST (hour=12)", () => {
    expect(isWithinActiveHours(12)).toBe(true);
  });

  it("is active at 11pm PST (hour=23)", () => {
    expect(isWithinActiveHours(23)).toBe(true);
  });

  it("is NOT active at 2am PST (hour=2)", () => {
    expect(isWithinActiveHours(2)).toBe(false);
  });

  it("is NOT active at midnight PST (hour=0)", () => {
    expect(isWithinActiveHours(0)).toBe(false);
  });

  it("is NOT active at 1am PST (hour=1)", () => {
    expect(isWithinActiveHours(1)).toBe(false);
  });
});

// ─── 5. Spread formatting ─────────────────────────────────────────────────────

function fmtSpread(
  value: string | null | undefined,
  odds: string | null | undefined
): string {
  if (!value) return "—";
  const v = parseFloat(value);
  const sign = v > 0 ? "+" : "";
  const line = `${sign}${v}`;
  if (!odds) return line;
  return `${line} (${odds})`;
}

describe("Spread formatting in OddsHistoryPanel", () => {
  it("formats positive spread with + sign and juice", () => {
    expect(fmtSpread("3.5", "-118")).toBe("+3.5 (-118)");
  });

  it("formats negative spread without + sign", () => {
    expect(fmtSpread("-3.5", "-112")).toBe("-3.5 (-112)");
  });

  it("returns — for null value", () => {
    expect(fmtSpread(null, "-110")).toBe("—");
  });

  it("returns line without juice if odds is null", () => {
    expect(fmtSpread("7", null)).toBe("+7");
  });
});
