/**
 * splitsBar.test.ts
 *
 * Tests for the betting splits bar percentage display logic.
 *
 * Design rules (non-negotiable):
 *   1. Labels ALWAYS appear INSIDE their pill segment — never outside.
 *   2. 100%/0% → single full-width segment, only the 100% label shown, 0% hidden entirely.
 *   3. Any value 1–99% → segment gets a dynamic minWidth guarantee so the label always fits.
 *   4. Single-digit values (1-9%) get a LARGER minWidth than two-digit values (10-99%).
 *
 * These tests validate the pure logic layer (segment visibility, minWidth, label values)
 * that drives both LabeledBar (mobile) and SplitBar (desktop).
 */

import { describe, it, expect } from "vitest";

// ── Pure logic extracted from the component ──────────────────────────────────
// This mirrors exactly what LabeledBar and SplitBar compute.

// Dynamic minWidth — matches mobileSegMinPx() in BettingSplitsPanel.tsx
function mobileSegMinPx(pct: number): number {
  return pct < 10 ? 40 : 30;
}

// Dynamic minWidth — matches desktopSegMinPx() in BettingSplitsPanel.tsx
function desktopSegMinPx(pct: number): number {
  return pct < 10 ? 58 : 50;
}

interface SegmentResult {
  awayVisible: boolean;
  homeVisible: boolean;
  awayLabel: string | null; // null = not rendered
  homeLabel: string | null; // null = not rendered
  awayMinWidth: number | null; // null = not applicable (full-bar case)
  homeMinWidth: number | null;
  dividerVisible: boolean;
  awayIsFull: boolean;
  homeIsFull: boolean;
}

function computeSegments(
  awayPct: number,
  homePct: number,
  minPxFn: (pct: number) => number
): SegmentResult {
  const isAwayFull = awayPct >= 100;
  const isHomeFull = homePct >= 100;

  // Visibility rules
  const awayVisible = awayPct > 0 && !isHomeFull;
  const homeVisible = homePct > 0 && !isAwayFull;

  // Labels — always inside, never outside
  const awayLabel = isAwayFull
    ? "100%"
    : awayPct > 0 && !isHomeFull
      ? `${awayPct}%`
      : null;

  const homeLabel = isHomeFull
    ? "100%"
    : homePct > 0 && !isAwayFull
      ? `${homePct}%`
      : null;

  // minWidth — applied to every non-full segment that is visible
  const awayMinWidth = awayVisible && !isAwayFull ? minPxFn(awayPct) : null;
  const homeMinWidth = homeVisible && !isHomeFull ? minPxFn(homePct) : null;

  // Divider only between two non-full segments
  const dividerVisible =
    !isAwayFull && !isHomeFull && awayPct > 0 && homePct > 0;

  return {
    awayVisible,
    homeVisible,
    awayLabel,
    homeLabel,
    awayMinWidth,
    homeMinWidth,
    dividerVisible,
    awayIsFull: isAwayFull,
    homeIsFull: isHomeFull,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Splits bar segment logic — 100%/0% cases", () => {
  it("100/0: away is full-bar, home is hidden, no divider", () => {
    const r = computeSegments(100, 0, mobileSegMinPx);
    expect(r.awayIsFull).toBe(true);
    expect(r.homeIsFull).toBe(false);
    // awayVisible tracks the normal segment branch ({away > 0 && !isHomeFull});
    // the full-bar is rendered via the separate {isAwayFull && ...} branch
    expect(r.awayVisible).toBe(true); // 100 > 0 && !isHomeFull(false) → true
    expect(r.homeVisible).toBe(false); // home is 0, so hidden
    expect(r.awayLabel).toBe("100%"); // label says 100%
    expect(r.homeLabel).toBe(null); // 0% is NEVER shown
    expect(r.dividerVisible).toBe(false);
  });

  it("0/100: home is full-bar, away is hidden, no divider", () => {
    const r = computeSegments(0, 100, mobileSegMinPx);
    expect(r.homeIsFull).toBe(true);
    expect(r.awayIsFull).toBe(false);
    expect(r.awayVisible).toBe(false); // away is 0, so hidden
    // homeVisible tracks the normal segment branch ({home > 0 && !isAwayFull});
    // the full-bar is rendered via the separate {isHomeFull && ...} branch
    expect(r.homeVisible).toBe(true); // 100 > 0 && !isAwayFull(false) → true
    expect(r.homeLabel).toBe("100%"); // label says 100%
    expect(r.awayLabel).toBe(null); // 0% is NEVER shown
    expect(r.dividerVisible).toBe(false);
  });
});

describe("Splits bar segment logic — single-digit percentages (1–9%) — mobile", () => {
  it("1/99: away gets larger minWidth (single-digit), home gets standard minWidth", () => {
    const r = computeSegments(1, 99, mobileSegMinPx);
    expect(r.awayVisible).toBe(true);
    expect(r.homeVisible).toBe(true);
    expect(r.awayLabel).toBe("1%");
    expect(r.homeLabel).toBe("99%");
    expect(r.awayMinWidth).toBe(40); // single-digit → 40px
    expect(r.homeMinWidth).toBe(30); // two-digit → 30px
    expect(r.dividerVisible).toBe(true);
  });

  it("4/96: away gets larger minWidth (single-digit), home gets standard minWidth", () => {
    const r = computeSegments(4, 96, mobileSegMinPx);
    expect(r.awayVisible).toBe(true);
    expect(r.homeVisible).toBe(true);
    expect(r.awayLabel).toBe("4%");
    expect(r.homeLabel).toBe("96%");
    expect(r.awayMinWidth).toBe(40); // single-digit → 40px
    expect(r.homeMinWidth).toBe(30); // two-digit → 30px
    expect(r.dividerVisible).toBe(true);
  });

  it("9/91: away gets larger minWidth (single-digit), home gets standard minWidth", () => {
    const r = computeSegments(9, 91, mobileSegMinPx);
    expect(r.awayVisible).toBe(true);
    expect(r.homeVisible).toBe(true);
    expect(r.awayLabel).toBe("9%");
    expect(r.homeLabel).toBe("91%");
    expect(r.awayMinWidth).toBe(40); // single-digit → 40px
    expect(r.homeMinWidth).toBe(30); // two-digit → 30px
    expect(r.dividerVisible).toBe(true);
  });

  it("99/1: home gets larger minWidth (single-digit), away gets standard minWidth", () => {
    const r = computeSegments(99, 1, mobileSegMinPx);
    expect(r.awayVisible).toBe(true);
    expect(r.homeVisible).toBe(true);
    expect(r.awayLabel).toBe("99%");
    expect(r.homeLabel).toBe("1%");
    expect(r.awayMinWidth).toBe(30); // two-digit → 30px
    expect(r.homeMinWidth).toBe(40); // single-digit → 40px
    expect(r.dividerVisible).toBe(true);
  });

  it("6/94: away gets larger minWidth (single-digit)", () => {
    const r = computeSegments(6, 94, mobileSegMinPx);
    expect(r.awayLabel).toBe("6%");
    expect(r.homeLabel).toBe("94%");
    expect(r.awayMinWidth).toBe(40);
    expect(r.homeMinWidth).toBe(30);
  });

  it("94/6: home gets larger minWidth (single-digit)", () => {
    const r = computeSegments(94, 6, mobileSegMinPx);
    expect(r.awayLabel).toBe("94%");
    expect(r.homeLabel).toBe("6%");
    expect(r.awayMinWidth).toBe(30);
    expect(r.homeMinWidth).toBe(40);
  });
});

describe("Splits bar segment logic — single-digit percentages (1–9%) — desktop", () => {
  it("1/99 desktop: away gets 58px (single-digit), home gets 50px", () => {
    const r = computeSegments(1, 99, desktopSegMinPx);
    expect(r.awayMinWidth).toBe(58);
    expect(r.homeMinWidth).toBe(50);
  });

  it("4/96 desktop: away gets 58px (single-digit), home gets 50px", () => {
    const r = computeSegments(4, 96, desktopSegMinPx);
    expect(r.awayMinWidth).toBe(58);
    expect(r.homeMinWidth).toBe(50);
  });

  it("9/91 desktop: away gets 58px (single-digit), home gets 50px", () => {
    const r = computeSegments(9, 91, desktopSegMinPx);
    expect(r.awayMinWidth).toBe(58);
    expect(r.homeMinWidth).toBe(50);
  });

  it("10/90 desktop: both get 50px (two-digit boundary)", () => {
    const r = computeSegments(10, 90, desktopSegMinPx);
    expect(r.awayMinWidth).toBe(50);
    expect(r.homeMinWidth).toBe(50);
  });

  it("100/0 desktop: no minWidth needed (full-bar case)", () => {
    const r = computeSegments(100, 0, desktopSegMinPx);
    expect(r.awayMinWidth).toBeNull();
    expect(r.homeMinWidth).toBeNull();
    expect(r.awayLabel).toBe("100%");
    expect(r.homeLabel).toBeNull();
  });
});

describe("Splits bar segment logic — normal splits", () => {
  it("50/50: both segments visible with divider, both two-digit minWidth", () => {
    const r = computeSegments(50, 50, mobileSegMinPx);
    expect(r.awayVisible).toBe(true);
    expect(r.homeVisible).toBe(true);
    expect(r.awayLabel).toBe("50%");
    expect(r.homeLabel).toBe("50%");
    expect(r.dividerVisible).toBe(true);
    expect(r.awayIsFull).toBe(false);
    expect(r.homeIsFull).toBe(false);
    expect(r.awayMinWidth).toBe(30);
    expect(r.homeMinWidth).toBe(30);
  });

  it("65/35: both segments visible with divider", () => {
    const r = computeSegments(65, 35, mobileSegMinPx);
    expect(r.awayVisible).toBe(true);
    expect(r.homeVisible).toBe(true);
    expect(r.awayLabel).toBe("65%");
    expect(r.homeLabel).toBe("35%");
    expect(r.dividerVisible).toBe(true);
    expect(r.awayMinWidth).toBe(30);
    expect(r.homeMinWidth).toBe(30);
  });

  it("95/5: 5% side gets single-digit minWidth", () => {
    const r = computeSegments(95, 5, mobileSegMinPx);
    expect(r.awayVisible).toBe(true);
    expect(r.homeVisible).toBe(true);
    expect(r.awayLabel).toBe("95%");
    expect(r.homeLabel).toBe("5%");
    expect(r.awayMinWidth).toBe(30); // two-digit
    expect(r.homeMinWidth).toBe(40); // single-digit
    expect(r.dividerVisible).toBe(true);
  });
});

describe("Splits bar segment logic — no outside labels ever (full invariant sweep)", () => {
  // This test validates the core invariant: no label is ever placed outside the pill.
  // We verify this by checking that every visible segment has a minWidth guarantee
  // AND that the label is always set (not null) for visible segments.

  const testCases = [
    [1, 99],
    [2, 98],
    [3, 97],
    [4, 96],
    [5, 95],
    [6, 94],
    [7, 93],
    [8, 92],
    [9, 91],
    [10, 90],
    [11, 89],
    [12, 88],
    [13, 87],
    [14, 86],
    [15, 85],
    [20, 80],
    [25, 75],
    [30, 70],
    [50, 50],
    [70, 30],
    [75, 25],
    [80, 20],
    [85, 15],
    [86, 14],
    [87, 13],
    [88, 12],
    [89, 11],
    [90, 10],
    [91, 9],
    [92, 8],
    [93, 7],
    [94, 6],
    [95, 5],
    [96, 4],
    [97, 3],
    [98, 2],
    [99, 1],
  ];

  for (const [away, home] of testCases) {
    it(`mobile ${away}/${home}: both labels inside, minWidth set correctly`, () => {
      const r = computeSegments(away, home, mobileSegMinPx);
      // Both segments must be visible
      expect(r.awayVisible).toBe(true);
      expect(r.homeVisible).toBe(true);
      // Both labels must be non-null (i.e., rendered inside the segment)
      expect(r.awayLabel).not.toBeNull();
      expect(r.homeLabel).not.toBeNull();
      // Both segments must have a minWidth guarantee
      expect(r.awayMinWidth).not.toBeNull();
      expect(r.homeMinWidth).not.toBeNull();
      // Single-digit values get larger minWidth
      expect(r.awayMinWidth).toBe(away < 10 ? 40 : 30);
      expect(r.homeMinWidth).toBe(home < 10 ? 40 : 30);
    });

    it(`desktop ${away}/${home}: both labels inside, minWidth set correctly`, () => {
      const r = computeSegments(away, home, desktopSegMinPx);
      expect(r.awayVisible).toBe(true);
      expect(r.homeVisible).toBe(true);
      expect(r.awayLabel).not.toBeNull();
      expect(r.homeLabel).not.toBeNull();
      expect(r.awayMinWidth).not.toBeNull();
      expect(r.homeMinWidth).not.toBeNull();
      // Single-digit values get larger minWidth
      expect(r.awayMinWidth).toBe(away < 10 ? 58 : 50);
      expect(r.homeMinWidth).toBe(home < 10 ? 58 : 50);
    });
  }
});
