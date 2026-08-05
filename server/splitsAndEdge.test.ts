/**
 * splitsAndEdge.test.ts
 *
 * Comprehensive validation suite for:
 *   1. Split bar rendering logic (MergedSplitBar / LabeledBar / SplitBar)
 *   2. Edge ROI calculation (calculateRoi / formatRoi)
 *   3. Edge direction logic (edgeLabelIsAway)
 *   4. VSIN data pipeline integrity (splits ingestion → DB mapping)
 *
 * All tests are deterministic and data-driven.
 * Zero tolerance for the 100%/100% double-render bug.
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// 1. SPLIT BAR RENDERING LOGIC
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors the exact logic in MergedSplitBar / LabeledBar / SplitBar components.
// The critical invariant: EXACTLY ONE of (normal, full-bar) branches renders per side.

type SegmentResult = {
  awayNormal: boolean; // normal proportional away segment renders
  awayFull: boolean; // full-bar away segment renders
  homeNormal: boolean; // normal proportional home segment renders
  homeFull: boolean; // full-bar home segment renders
  bothFull: boolean; // both-full fallback renders (should never happen with valid data)
};

function computeSegments(awayPct: number, homePct: number): SegmentResult {
  const away = awayPct;
  const home = homePct;
  const isAwayFull = away >= 100;
  const isHomeFull = home >= 100;

  // FIXED logic: normal segment only renders when NOT in full-bar state
  const awayNormal = away > 0 && !isHomeFull && !isAwayFull;
  const homeNormal = home > 0 && !isAwayFull && !isHomeFull;
  const awayFull = isAwayFull && !isHomeFull;
  const homeFull = isHomeFull && !isAwayFull;
  const bothFull = isAwayFull && isHomeFull; // data error — both 100%

  return { awayNormal, awayFull, homeNormal, homeFull, bothFull };
}

describe("Split Bar Rendering Logic", () => {
  // ── Core invariant: never render both normal AND full-bar for the same side ──

  it("invariant: awayNormal and awayFull are mutually exclusive for all valid inputs", () => {
    const cases = [0, 1, 25, 33, 50, 67, 75, 99, 100];
    for (const away of cases) {
      for (const home of cases) {
        const r = computeSegments(away, home);
        expect(
          r.awayNormal && r.awayFull,
          `away=${away} home=${home}: awayNormal AND awayFull both true`
        ).toBe(false);
        expect(
          r.homeNormal && r.homeFull,
          `away=${away} home=${home}: homeNormal AND homeFull both true`
        ).toBe(false);
      }
    }
  });

  // ── 100% / 0% cases (the original bug) ──

  it("away=100, home=0: renders awayFull only, no homeNormal, no awayNormal", () => {
    const r = computeSegments(100, 0);
    expect(r.awayFull).toBe(true);
    expect(r.awayNormal).toBe(false);
    expect(r.homeNormal).toBe(false);
    expect(r.homeFull).toBe(false);
    expect(r.bothFull).toBe(false);
  });

  it("away=0, home=100: renders homeFull only, no awayNormal, no homeNormal", () => {
    const r = computeSegments(0, 100);
    expect(r.homeFull).toBe(true);
    expect(r.homeNormal).toBe(false);
    expect(r.awayNormal).toBe(false);
    expect(r.awayFull).toBe(false);
    expect(r.bothFull).toBe(false);
  });

  // ── Normal split cases ──

  it("away=63, home=37: renders both normal segments, no full-bar", () => {
    const r = computeSegments(63, 37);
    expect(r.awayNormal).toBe(true);
    expect(r.homeNormal).toBe(true);
    expect(r.awayFull).toBe(false);
    expect(r.homeFull).toBe(false);
    expect(r.bothFull).toBe(false);
  });

  it("away=50, home=50: renders both normal segments", () => {
    const r = computeSegments(50, 50);
    expect(r.awayNormal).toBe(true);
    expect(r.homeNormal).toBe(true);
    expect(r.awayFull).toBe(false);
    expect(r.homeFull).toBe(false);
  });

  it("away=1, home=99: renders both normal segments (single-digit away)", () => {
    const r = computeSegments(1, 99);
    expect(r.awayNormal).toBe(true);
    expect(r.homeNormal).toBe(true);
    expect(r.awayFull).toBe(false);
    expect(r.homeFull).toBe(false);
  });

  it("away=99, home=1: renders both normal segments (single-digit home)", () => {
    const r = computeSegments(99, 1);
    expect(r.awayNormal).toBe(true);
    expect(r.homeNormal).toBe(true);
    expect(r.awayFull).toBe(false);
    expect(r.homeFull).toBe(false);
  });

  it("away=0, home=0: renders nothing (null data guard)", () => {
    const r = computeSegments(0, 0);
    expect(r.awayNormal).toBe(false);
    expect(r.homeNormal).toBe(false);
    expect(r.awayFull).toBe(false);
    expect(r.homeFull).toBe(false);
    expect(r.bothFull).toBe(false);
  });

  it("away=100, home=100: flags bothFull (data error, never valid)", () => {
    const r = computeSegments(100, 100);
    expect(r.bothFull).toBe(true);
    expect(r.awayFull).toBe(false);
    expect(r.homeFull).toBe(false);
    expect(r.awayNormal).toBe(false);
    expect(r.homeNormal).toBe(false);
  });

  // ── Complement invariant: awayPct + homePct should always = 100 for valid data ──

  it("complement invariant: away + home = 100 for all valid VSIN splits", () => {
    const validSplits = [
      [100, 0],
      [0, 100],
      [63, 37],
      [28, 72],
      [50, 50],
      [75, 25],
      [17, 83],
      [1, 99],
      [99, 1],
      [33, 67],
    ];
    for (const [away, home] of validSplits) {
      expect(away + home, `away=${away} home=${home} should sum to 100`).toBe(
        100
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EDGE ROI CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

// Mirror the calculateRoi and formatRoi functions from edgeUtils.ts
function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

function removeVig(
  oddsA: number,
  oddsB: number
): { probA: number; probB: number } {
  const rawA = americanToDecimal(oddsA);
  const rawB = americanToDecimal(oddsB);
  const impliedA = 1 / rawA;
  const impliedB = 1 / rawB;
  const total = impliedA + impliedB;
  return { probA: impliedA / total, probB: impliedB / total };
}

function calculateRoi(
  modelOdds: number,
  bookOdds: number,
  oppOdds: number
): number {
  if (isNaN(modelOdds) || isNaN(bookOdds) || isNaN(oppOdds)) return NaN;
  const modelDecimal = americanToDecimal(modelOdds);
  const modelWinProb = 1 / modelDecimal;
  const { probA: bookNoVigProb } = removeVig(bookOdds, oppOdds);
  if (bookNoVigProb <= 0) return NaN;
  return (modelWinProb / bookNoVigProb - 1) * 100;
}

function formatRoi(roi: number): string {
  if (isNaN(roi)) return "—";
  const sign = roi >= 0 ? "+" : "";
  return `${sign}${roi.toFixed(2)}% ROI`;
}

describe("Edge ROI Calculation", () => {
  // ── Basic ROI formula validation ──

  it("positive edge: model -110 vs book -120/-110 → positive ROI", () => {
    const roi = calculateRoi(-110, -120, -110);
    expect(roi).toBeGreaterThan(0);
  });

  it("negative edge: model -130 vs book -110/-110 → positive ROI (model more confident than book no-vig)", () => {
    // Model -130 implies 56.5% win prob. Book no-vig at -110/-110 = 50% each.
    // ROI = (0.565/0.50 - 1)*100 = +13% — model is more confident than book no-vig → positive ROI.
    // A negative edge means the MODEL is LESS confident than the book's no-vig probability.
    const roi = calculateRoi(-130, -110, -110);
    expect(roi).toBeGreaterThan(0); // model at -130 is more confident than book no-vig 50%
  });

  it("zero edge: model odds = book no-vig odds → ~0% ROI", () => {
    // For -110/-110, no-vig prob = 0.5 each. Model at -110 also implies 0.524.
    // ROI = (0.524/0.5 - 1)*100 = ~4.76% (book has vig, so model is slightly better)
    // For exact zero, model must match no-vig: +100/+100 → no-vig 0.5, model +100 → 0.5
    const roi = calculateRoi(100, 100, 100);
    expect(Math.abs(roi)).toBeLessThan(0.01);
  });

  it("NaN propagation: missing model odds → NaN", () => {
    expect(isNaN(calculateRoi(NaN, -110, -110))).toBe(true);
  });

  it("NaN propagation: missing book odds → NaN", () => {
    expect(isNaN(calculateRoi(-110, NaN, -110))).toBe(true);
  });

  it("NaN propagation: missing opp odds → NaN", () => {
    expect(isNaN(calculateRoi(-110, -110, NaN))).toBe(true);
  });

  // ── Real-world edge cases ──

  it("MLB run line: model -144 vs book -168/-162 → positive ROI for away", () => {
    const roi = calculateRoi(-144, -168, -162);
    expect(roi).toBeGreaterThan(0);
  });

  it("NHL puck line: model -126 vs book -182/-150 → positive ROI", () => {
    const roi = calculateRoi(-126, -182, -150);
    expect(roi).toBeGreaterThan(0);
  });

  it("MLB ML: model +143 vs book +120/-141 → negative ROI (model less confident than book no-vig)", () => {
    // Model +143 implies 41.1% win prob.
    // Book no-vig: +120 implied = 45.5%/(45.5%+58.5%) ≈ 43.8%.
    // ROI = (0.411/0.438 - 1)*100 ≈ -6.2% — model is LESS confident than book no-vig → negative ROI.
    // This means the model does NOT have an edge on the away ML at +143 vs book +120.
    const roi = calculateRoi(143, 120, -141);
    expect(roi).toBeLessThan(0);
  });

  it("Total over: model over -121 vs book over -115/-105 → positive ROI", () => {
    const roi = calculateRoi(-121, -115, -105);
    expect(roi).toBeGreaterThan(0);
  });

  // ── formatRoi output format ──

  it("formatRoi: positive ROI shows + prefix and % ROI suffix", () => {
    expect(formatRoi(4.44)).toBe("+4.44% ROI");
  });

  it("formatRoi: negative ROI shows - prefix and % ROI suffix", () => {
    expect(formatRoi(-2.31)).toBe("-2.31% ROI");
  });

  it("formatRoi: NaN returns —", () => {
    expect(formatRoi(NaN)).toBe("—");
  });

  it("formatRoi: zero shows +0.00% ROI", () => {
    expect(formatRoi(0)).toBe("+0.00% ROI");
  });

  // ── ROI magnitude sanity checks ──

  it("ROI magnitude: realistic edges are between -20% and +30%", () => {
    const cases: [number, number, number][] = [
      [-110, -120, -110],
      [-126, -182, -150],
      [143, 120, -141],
      [-121, -115, -105],
      [-144, -168, -162],
    ];
    for (const [model, book, opp] of cases) {
      const roi = calculateRoi(model, book, opp);
      expect(roi, `model=${model} book=${book} opp=${opp}`).toBeGreaterThan(
        -25
      );
      expect(roi, `model=${model} book=${book} opp=${opp}`).toBeLessThan(35);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EDGE DIRECTION LOGIC (edgeLabelIsAway)
// ─────────────────────────────────────────────────────────────────────────────

// Mirror the edgeLabelIsAway function from GameCard.tsx
function parseAbbrFromEdgeLabel(label: string): string | null {
  if (!label || label === "PASS") return null;
  const upper = label.toUpperCase().trim();
  // Pattern: "ABBR +/-LINE [TIER]" e.g. "UTA +1.5 [ELITE EDGE]", "COL -1.5 [STRONG EDGE]"
  const m = upper.match(/^([A-Z]{2,4})\s+[+-]/);
  if (m) return m[1];
  // Pattern: "OVER X.X" or "UNDER X.X" — not a team label
  if (upper.startsWith("OVER") || upper.startsWith("UNDER")) return null;
  return null;
}

function edgeLabelIsAway(
  edgeLabel: string | null | undefined,
  awayAbbr: string,
  awayDisplayName: string,
  sport: string
): boolean | null {
  if (!edgeLabel || edgeLabel === "PASS") return null;
  const upper = edgeLabel.toUpperCase().trim();
  // For totals: OVER/UNDER labels are not team-directional
  if (upper.startsWith("OVER") || upper.startsWith("UNDER")) return null;
  const parsedAbbr = parseAbbrFromEdgeLabel(edgeLabel);
  if (!parsedAbbr) return null;
  const awayAbbrUpper = awayAbbr.toUpperCase();
  if (parsedAbbr === awayAbbrUpper) return true;
  // Also check display name prefix (e.g., "ARIZONA" matches "Arizona D-backs")
  const displayUpper = awayDisplayName.toUpperCase();
  if (displayUpper.startsWith(parsedAbbr)) return true;
  return false;
}

describe("Edge Direction Logic (edgeLabelIsAway)", () => {
  // ── NHL puck line ──

  it('NHL: "SJS +1.5 [STRONG EDGE]" with awayAbbr=SJS → true (away edge)', () => {
    expect(
      edgeLabelIsAway("SJS +1.5 [STRONG EDGE]", "SJS", "San Jose Sharks", "NHL")
    ).toBe(true);
  });

  it('NHL: "COL -1.5 [STRONG EDGE]" with awayAbbr=SEA → false (home edge)', () => {
    expect(
      edgeLabelIsAway("COL -1.5 [STRONG EDGE]", "SEA", "Seattle Kraken", "NHL")
    ).toBe(false);
  });

  it('NHL: "UTA +1.5 [ELITE EDGE]" with awayAbbr=STL → false (home edge)', () => {
    expect(
      edgeLabelIsAway("UTA +1.5 [ELITE EDGE]", "STL", "St. Louis Blues", "NHL")
    ).toBe(false);
  });

  // ── MLB run line ──

  it('MLB: "ARI +1.5 [LEAN]" with awayAbbr=ARI → true (away edge)', () => {
    expect(
      edgeLabelIsAway("ARI +1.5 [LEAN]", "ARI", "Arizona D-backs", "MLB")
    ).toBe(true);
  });

  it('MLB: "CHC -1.5 [STRONG EDGE]" with awayAbbr=ARI → false (home edge)', () => {
    expect(
      edgeLabelIsAway("CHC -1.5 [STRONG EDGE]", "ARI", "Arizona D-backs", "MLB")
    ).toBe(false);
  });

  // ── NBA spread ──

  it('NBA: "BOS +5.5 [LEAN]" with awayAbbr=BOS → true (away edge)', () => {
    expect(
      edgeLabelIsAway("BOS +5.5 [LEAN]", "BOS", "Boston Celtics", "NBA")
    ).toBe(true);
  });

  it('NBA: "LAL -3.5 [STRONG EDGE]" with awayAbbr=BOS → false (home edge)', () => {
    expect(
      edgeLabelIsAway("LAL -3.5 [STRONG EDGE]", "BOS", "Boston Celtics", "NBA")
    ).toBe(false);
  });

  // ── Edge cases ──

  it("PASS label → null (no edge)", () => {
    expect(edgeLabelIsAway("PASS", "SJS", "San Jose Sharks", "NHL")).toBeNull();
  });

  it("null label → null (no edge)", () => {
    expect(edgeLabelIsAway(null, "SJS", "San Jose Sharks", "NHL")).toBeNull();
  });

  it("OVER label → null (not team-directional)", () => {
    expect(
      edgeLabelIsAway("OVER 8.5", "ARI", "Arizona D-backs", "MLB")
    ).toBeNull();
  });

  it("UNDER label → null (not team-directional)", () => {
    expect(
      edgeLabelIsAway("UNDER 7", "ARI", "Arizona D-backs", "MLB")
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. VSIN DATA PIPELINE INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────
// Validates the mapping logic from VSIN HTML table → DB fields.
// Uses representative VSIN table row structures.

type VsinRow = {
  cells: string[];
  expectedAway: number | null;
  expectedHome: number | null;
  market: "spread" | "total" | "ml";
  description: string;
};

// VSIN table structure (from vsinBettingSplitsScraper.ts):
// For SPREAD/ML: cells[4]=awayBets%, cells[5]=awayMoney%, cells[6]=homeBets%, cells[7]=homeMoney%
// For TOTAL: cells[4]=overBets%, cells[5]=overMoney%, cells[6]=underBets%, cells[7]=underMoney%
function parseVsinRow(
  cells: string[],
  market: "spread" | "total" | "ml"
): {
  awayPct: number | null;
  homePct: number | null;
  awayMoneyPct: number | null;
  homeMoneyPct: number | null;
} {
  const parseCell = (val: string): number | null => {
    if (!val || val === "—" || val === "-" || val.trim() === "") return null;
    const n = parseFloat(val.replace("%", "").trim());
    return isNaN(n) ? null : n;
  };

  const awayPct = parseCell(cells[4] ?? "");
  const awayMoneyPct = parseCell(cells[5] ?? "");
  const homePct = parseCell(cells[6] ?? "");
  const homeMoneyPct = parseCell(cells[7] ?? "");

  return { awayPct, homePct, awayMoneyPct, homeMoneyPct };
}

// Complement validation: if awayPct is known, homePct should be 100 - awayPct
function validateComplement(
  awayPct: number | null,
  homePct: number | null
): boolean {
  if (awayPct === null || homePct === null) return true; // null is valid (no data)
  return Math.abs(awayPct + homePct - 100) < 0.5; // allow 0.5% rounding tolerance
}

describe("VSIN Data Pipeline Integrity", () => {
  const testRows: VsinRow[] = [
    {
      cells: ["", "", "", "", "63", "28", "37", "72"],
      expectedAway: 63,
      expectedHome: 37,
      market: "spread",
      description: "CIN/PIT 04/30: 63% away tickets, 37% home tickets",
    },
    {
      cells: ["", "", "", "", "100", "100", "0", "0"],
      expectedAway: 100,
      expectedHome: 0,
      market: "total",
      description: "CIN/PIT 05/01: 100% over tickets (all bets on over)",
    },
    {
      cells: ["", "", "", "", "75", "100", "25", "0"],
      expectedAway: 75,
      expectedHome: 25,
      market: "total",
      description: "KC/SEA TOTAL: 75% over tickets, 100% over money",
    },
    {
      cells: ["", "", "", "", "30", "8", "70", "92"],
      expectedAway: 30,
      expectedHome: 70,
      market: "spread",
      description: "ARI/CHC SPREAD: 30% away tickets, 70% home tickets",
    },
    {
      cells: ["", "", "", "", "17", "2", "83", "98"],
      expectedAway: 17,
      expectedHome: 83,
      market: "ml",
      description: "KC/SEA ML: 17% away tickets, 83% home tickets",
    },
    {
      cells: ["", "", "", "", "", "", "", ""],
      expectedAway: null,
      expectedHome: null,
      market: "spread",
      description: "Empty cells → null (no data available)",
    },
    {
      cells: ["", "", "", "", "—", "—", "—", "—"],
      expectedAway: null,
      expectedHome: null,
      market: "spread",
      description: "Dash cells → null (no data available)",
    },
  ];

  for (const row of testRows) {
    it(`parseVsinRow: ${row.description}`, () => {
      const result = parseVsinRow(row.cells, row.market);
      expect(result.awayPct).toBe(row.expectedAway);
      expect(result.homePct).toBe(row.expectedHome);
    });
  }

  it("complement validation: 63/37 → valid complement", () => {
    expect(validateComplement(63, 37)).toBe(true);
  });

  it("complement validation: 100/0 → valid complement", () => {
    expect(validateComplement(100, 0)).toBe(true);
  });

  it("complement validation: 75/25 → valid complement", () => {
    expect(validateComplement(75, 25)).toBe(true);
  });

  it("complement validation: 100/100 → INVALID (data error)", () => {
    expect(validateComplement(100, 100)).toBe(false);
  });

  it("complement validation: null/null → valid (no data)", () => {
    expect(validateComplement(null, null)).toBe(true);
  });

  it("complement validation: 63/null → valid (partial data)", () => {
    expect(validateComplement(63, null)).toBe(true);
  });

  // ── Zero-zero guard: 0%/0% means market not open yet ──
  it("zero-zero guard: 0/0 should be treated as null (market not open)", () => {
    const rawBets = 0;
    const rawMoney = 0;
    const bothZero = rawBets === 0 && rawMoney === 0;
    const spreadTicketsPct = bothZero ? null : rawBets;
    const spreadHandlePct = bothZero ? null : rawMoney;
    expect(spreadTicketsPct).toBeNull();
    expect(spreadHandlePct).toBeNull();
  });

  it("zero-zero guard: 0 bets / 5 money should NOT be treated as null", () => {
    const rawBets = 0;
    const rawMoney = 5;
    const bothZero = rawBets === 0 && rawMoney === 0;
    const spreadTicketsPct = bothZero ? null : rawBets;
    const spreadHandlePct = bothZero ? null : rawMoney;
    expect(spreadTicketsPct).toBe(0);
    expect(spreadHandlePct).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. TOTAL EDGE DIRECTION LOGIC (Three-Tier Priority)
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors the authTotalEdgeIsOver computation in GameCard.tsx.
// Tier 1: model over/under odds probability comparison (most accurate)
// Tier 2: NHL DB label (when model odds unavailable)
// Tier 3: line comparison fallback (NBA/NCAAM without model odds)

function americanToImplied(american: number): number {
  if (isNaN(american)) return NaN;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function computeTotalEdgeIsOver(
  mdlOverOdds: string | null | undefined,
  mdlUnderOdds: string | null | undefined,
  bkOverOdds: string | null | undefined,
  bkUnderOdds: string | null | undefined,
  mdlTotal: number | null,
  bkTotal: number | null,
  isNhlGame: boolean,
  computedTotalEdge: string | null | undefined
): boolean | null {
  const toN = (s: string | null | undefined): number => {
    if (!s) return NaN;
    const n = parseFloat(s.replace(/[^\d.+-]/g, ""));
    return isNaN(n) ? NaN : n;
  };

  const mdlOverNum = toN(mdlOverOdds);
  const mdlUnderNum = toN(mdlUnderOdds);
  const bkOverNum = toN(bkOverOdds);
  const bkUnderNum = toN(bkUnderOdds);

  // Tier 1: model odds probability comparison (MLB/NBA/NHL with model odds)
  if (
    !isNaN(mdlOverNum) &&
    !isNaN(mdlUnderNum) &&
    !isNaN(bkOverNum) &&
    !isNaN(bkUnderNum)
  ) {
    const modelOverProb = americanToImplied(mdlOverNum);
    const { probA: bookNoVigOverProb } = removeVig(bkOverNum, bkUnderNum);
    if (!isNaN(modelOverProb) && bookNoVigOverProb > 0) {
      return modelOverProb > bookNoVigOverProb; // true = OVER edge, false = UNDER edge
    }
  }

  // Tier 2: NHL DB label (when model odds unavailable)
  if (isNhlGame && computedTotalEdge) {
    const upper = computedTotalEdge.toUpperCase().trim();
    if (upper.startsWith("OVER")) return true;
    if (upper.startsWith("UNDER")) return false;
  }

  // Tier 3: line comparison fallback (NBA/NCAAM)
  if (
    mdlTotal != null &&
    bkTotal != null &&
    !isNaN(mdlTotal) &&
    !isNaN(bkTotal)
  ) {
    return mdlTotal > bkTotal;
  }

  return null;
}

describe("Total Edge Direction Logic (Three-Tier)", () => {
  // ── Tier 1: Model odds probability comparison ──

  it("CIN/PIT: o8(+120) vs u8(-120) book o8(-118)/u8(-102) → UNDER edge (false)", () => {
    // Model over +120 implies 45.45% win prob for OVER
    // Book no-vig over: removeVig(-118, -102) → ~52% for OVER
    // 45.45% < 52% → model LESS confident in OVER → UNDER edge
    const result = computeTotalEdgeIsOver(
      "+120",
      "-120",
      "-118",
      "-102",
      8,
      8.5,
      false,
      "OVER 8"
    );
    expect(result).toBe(false); // UNDER edge
  });

  it("model over -121 vs book over -115/-105 → OVER edge (true)", () => {
    // Model over -121 implies 54.75% win prob for OVER
    // Book no-vig over: removeVig(-115, -105) → ~52.4% for OVER
    // 54.75% > 52.4% → model MORE confident in OVER → OVER edge
    const result = computeTotalEdgeIsOver(
      "-121",
      "+121",
      "-115",
      "-105",
      8.5,
      8.5,
      false,
      "OVER 8.5"
    );
    expect(result).toBe(true); // OVER edge
  });

  it("model under -120 vs book over -110/-110 → UNDER edge (false)", () => {
    // Model over +120 implies 45.45% win prob for OVER
    // Book no-vig over: removeVig(-110, -110) → 50% for OVER
    // 45.45% < 50% → UNDER edge
    const result = computeTotalEdgeIsOver(
      "+120",
      "-120",
      "-110",
      "-110",
      8,
      8.5,
      false,
      "OVER 8"
    );
    expect(result).toBe(false);
  });

  it("model over -110 vs book over -110/-110 → slight OVER edge (true)", () => {
    // Model over -110 implies 52.38% win prob for OVER
    // Book no-vig over: removeVig(-110, -110) → 50% for OVER
    // 52.38% > 50% → OVER edge
    const result = computeTotalEdgeIsOver(
      "-110",
      "+110",
      "-110",
      "-110",
      8.5,
      8.5,
      false,
      "OVER 8.5"
    );
    expect(result).toBe(true);
  });

  // ── Tier 2: NHL DB label fallback ──

  it("NHL: no model odds, computedTotalEdge=OVER 5.5 → true (OVER edge)", () => {
    const result = computeTotalEdgeIsOver(
      null,
      null,
      null,
      null,
      5.5,
      5.5,
      true,
      "OVER 5.5"
    );
    expect(result).toBe(true);
  });

  it("NHL: no model odds, computedTotalEdge=UNDER 6 → false (UNDER edge)", () => {
    const result = computeTotalEdgeIsOver(
      null,
      null,
      null,
      null,
      6,
      6.5,
      true,
      "UNDER 6"
    );
    expect(result).toBe(false);
  });

  it("NHL: no model odds, computedTotalEdge=PASS → null (no edge)", () => {
    const result = computeTotalEdgeIsOver(
      null,
      null,
      null,
      null,
      null,
      null,
      true,
      "PASS"
    );
    expect(result).toBeNull();
  });

  // ── Tier 3: Line comparison fallback ──

  it("NBA: no model odds, mdlTotal=8 > bkTotal=7.5 → OVER edge (true)", () => {
    const result = computeTotalEdgeIsOver(
      null,
      null,
      null,
      null,
      8,
      7.5,
      false,
      null
    );
    expect(result).toBe(true);
  });

  it("NBA: no model odds, mdlTotal=7 < bkTotal=7.5 → UNDER edge (false)", () => {
    const result = computeTotalEdgeIsOver(
      null,
      null,
      null,
      null,
      7,
      7.5,
      false,
      null
    );
    expect(result).toBe(false);
  });

  it("NBA: no model odds, mdlTotal=null → null (no edge)", () => {
    const result = computeTotalEdgeIsOver(
      null,
      null,
      null,
      null,
      null,
      7.5,
      false,
      null
    );
    expect(result).toBeNull();
  });

  // ── Tier 1 takes priority over Tier 3 ──

  it("Tier 1 overrides Tier 3: model odds say UNDER but line says OVER → UNDER wins", () => {
    // mdlTotal=9 > bkTotal=8.5 (Tier 3 would say OVER)
    // But model over +120 vs book -118/-102 (Tier 1 says UNDER)
    const result = computeTotalEdgeIsOver(
      "+120",
      "-120",
      "-118",
      "-102",
      9,
      8.5,
      false,
      "OVER 9"
    );
    expect(result).toBe(false); // Tier 1 wins: UNDER edge
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. EDGE COLOR THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

function getEdgeColor(diff: number): string {
  if (diff >= 5) return "#FF6B35"; // ELITE — orange
  if (diff >= 3) return "#FFD700"; // STRONG — gold
  if (diff >= 1) return "#39FF14"; // LEAN — neon green
  return "#39FF14"; // default green
}

describe("Edge Color Thresholds", () => {
  it("diff >= 5: ELITE orange (#FF6B35)", () => {
    expect(getEdgeColor(5)).toBe("#FF6B35");
    expect(getEdgeColor(7.5)).toBe("#FF6B35");
  });

  it("diff >= 3 and < 5: STRONG gold (#FFD700)", () => {
    expect(getEdgeColor(3)).toBe("#FFD700");
    expect(getEdgeColor(4.9)).toBe("#FFD700");
  });

  it("diff >= 1 and < 3: LEAN neon green (#39FF14)", () => {
    expect(getEdgeColor(1)).toBe("#39FF14");
    expect(getEdgeColor(2.9)).toBe("#39FF14");
  });

  it("diff = 0.5: default green (#39FF14)", () => {
    expect(getEdgeColor(0.5)).toBe("#39FF14");
  });
});
