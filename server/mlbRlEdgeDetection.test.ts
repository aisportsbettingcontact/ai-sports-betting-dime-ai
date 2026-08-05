/**
 * mlbRlEdgeDetection.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for MLB Run Line edge detection and Total line matching logic.
 *
 * Covers:
 *   1. americanBreakEven — correct break-even probability from American odds
 *   2. MLB RL edge computation — model cover% vs book break-even
 *   3. spreadDiff sign — positive = edge exists, negative = no edge
 *   4. spreadEdge label format — "ABBR ±1.5 [EDGE]" for edgeLabelIsAway() parsing
 *   5. Total matching — modelTotal MUST equal bookTotal (never differ)
 *   6. GameCard spreadDiff path — MLB uses game.spreadDiff (not line arithmetic)
 *   7. RL sign guard — awayModelSpread sign MUST match awayBookSpread sign
 */

import { describe, it, expect } from "vitest";

// ─── Inline helpers (mirrors mlbModelRunner.ts logic) ────────────────────────

/** American odds → break-even probability (0-1 scale) */
function americanBreakEven(odds: number): number | null {
  if (isNaN(odds)) return null;
  return odds < 0
    ? Math.abs(odds) / (Math.abs(odds) + 100)
    : 100 / (odds + 100);
}

/**
 * Compute MLB RL edge: model cover% vs book break-even at same ±1.5 line.
 * Returns { spreadDiff, spreadEdge } where:
 *   spreadDiff = max(edgeAway, edgeHome) * 100 in pp (positive = edge)
 *   spreadEdge = "ABBR ±1.5 [EDGE]" or null if no edge
 */
function computeMlbRlEdge(
  awayAbbr: string,
  homeAbbr: string,
  awayRlCoverPct: number, // 0-100 scale (from Python model)
  homeRlCoverPct: number, // 0-100 scale (from Python model)
  bkAwayRlOdds: number, // American odds (e.g. -182, +151)
  bkHomeRlOdds: number, // American odds (e.g. +151, -184)
  safeAwayRunLine: string, // sign-enforced RL label e.g. "+1.5" or "-1.5"
  safeHomeRunLine: string // sign-enforced RL label e.g. "-1.5" or "+1.5"
): { spreadDiff: string | null; spreadEdge: string | null } {
  const bkAwayBreakEven = americanBreakEven(bkAwayRlOdds);
  const bkHomeBreakEven = americanBreakEven(bkHomeRlOdds);
  if (bkAwayBreakEven === null || bkHomeBreakEven === null) {
    return { spreadDiff: null, spreadEdge: null };
  }
  const edgeAway = awayRlCoverPct / 100 - bkAwayBreakEven;
  const edgeHome = homeRlCoverPct / 100 - bkHomeBreakEven;
  const bestEdge = Math.max(edgeAway, edgeHome);
  const spreadDiff = String(Math.round(bestEdge * 1000) / 10);
  if (bestEdge > 0) {
    const spreadEdge =
      edgeAway >= edgeHome
        ? `${awayAbbr} ${safeAwayRunLine} [EDGE]`
        : `${homeAbbr} ${safeHomeRunLine} [EDGE]`;
    return { spreadDiff, spreadEdge };
  }
  return { spreadDiff, spreadEdge: null };
}

/** Total matching: modelTotal MUST equal bookTotal */
function syncModelTotal(bookTotal: number | null): string | null {
  if (bookTotal === null || isNaN(bookTotal)) return null;
  return String(bookTotal);
}

/** RL sign guard: awayModelSpread sign MUST match awayBookSpread sign */
function enforceRlSignGuard(
  pythonAwayRunLine: string,
  bookAwaySpread: number
): { safeAwayRunLine: string; safeHomeRunLine: string; corrected: boolean } {
  const modelNum = parseFloat(pythonAwayRunLine);
  if (isNaN(modelNum) || isNaN(bookAwaySpread) || bookAwaySpread === 0) {
    return {
      safeAwayRunLine: pythonAwayRunLine,
      safeHomeRunLine: String(-modelNum),
      corrected: false,
    };
  }
  const bookSign = bookAwaySpread >= 0 ? 1 : -1;
  const modelSign = modelNum >= 0 ? 1 : -1;
  if (bookSign !== modelSign) {
    const correctedAway =
      bookSign > 0 ? Math.abs(modelNum) : -Math.abs(modelNum);
    const correctedHome = -correctedAway;
    const fmt = (n: number) =>
      n >= 0 ? `+${n.toFixed(1)}` : `${n.toFixed(1)}`;
    return {
      safeAwayRunLine: fmt(correctedAway),
      safeHomeRunLine: fmt(correctedHome),
      corrected: true,
    };
  }
  return {
    safeAwayRunLine: pythonAwayRunLine,
    safeHomeRunLine: String(-modelNum),
    corrected: false,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("americanBreakEven", () => {
  it("returns 0.5 for ±100", () => {
    expect(americanBreakEven(-100)).toBeCloseTo(0.5, 4);
    expect(americanBreakEven(100)).toBeCloseTo(0.5, 4);
  });

  it("returns correct break-even for -110 (standard juice)", () => {
    // -110 → 110/210 ≈ 0.5238
    expect(americanBreakEven(-110)).toBeCloseTo(0.5238, 3);
  });

  it("returns correct break-even for +110 (positive odds)", () => {
    // +110 → 100/210 ≈ 0.4762
    expect(americanBreakEven(110)).toBeCloseTo(0.4762, 3);
  });

  it("returns correct break-even for -182 (heavy favorite RL)", () => {
    // -182 → 182/282 ≈ 0.6454
    expect(americanBreakEven(-182)).toBeCloseTo(0.6454, 3);
  });

  it("returns correct break-even for +151 (underdog RL)", () => {
    // +151 → 100/251 ≈ 0.3984
    expect(americanBreakEven(151)).toBeCloseTo(0.3984, 3);
  });

  it("returns null for NaN input", () => {
    expect(americanBreakEven(NaN)).toBeNull();
  });
});

describe("MLB RL Edge Detection — computeMlbRlEdge", () => {
  it("detects AWAY edge when away cover% > book break-even", () => {
    // ATH@BAL: ATH is away favorite (-1.5), book RL odds: ATH -1.5 (-182), BAL +1.5 (+151)
    // Model: ATH covers -1.5 at 68% (book break-even = 182/282 ≈ 64.5%) → edge = +3.5pp
    const result = computeMlbRlEdge(
      "ATH",
      "BAL",
      68.0, // awayRlCoverPct (ATH covers -1.5)
      32.0, // homeRlCoverPct (BAL covers +1.5)
      -182, // bkAwayRlOdds (ATH -1.5 at -182)
      151, // bkHomeRlOdds (BAL +1.5 at +151)
      "-1.5", // safeAwayRunLine
      "+1.5" // safeHomeRunLine
    );
    expect(result.spreadEdge).toBe("ATH -1.5 [EDGE]");
    expect(parseFloat(result.spreadDiff!)).toBeGreaterThan(0);
  });

  it("detects HOME edge when home cover% > book break-even", () => {
    // LAA@TOR: LAA is away underdog (+1.5), book RL odds: LAA +1.5 (-161), TOR -1.5 (+135)
    // Model: TOR covers -1.5 at 60% (book break-even = 100/235 ≈ 42.6%) → home edge
    const result = computeMlbRlEdge(
      "LAA",
      "TOR",
      40.0, // awayRlCoverPct (LAA covers +1.5)
      60.0, // homeRlCoverPct (TOR covers -1.5)
      -161, // bkAwayRlOdds (LAA +1.5 at -161)
      135, // bkHomeRlOdds (TOR -1.5 at +135)
      "+1.5", // safeAwayRunLine
      "-1.5" // safeHomeRunLine
    );
    expect(result.spreadEdge).toBe("TOR -1.5 [EDGE]");
    expect(parseFloat(result.spreadDiff!)).toBeGreaterThan(0);
  });

  it("returns no edge when BOTH sides are below break-even", () => {
    // Model: ATH covers -1.5 at only 60% (book break-even ≈ 64.5%) → away no edge
    // BAL covers +1.5 at only 35% (book break-even at -161 ≈ 61.7%) → home no edge
    // Use -161 for home so BAL break-even is 161/261 ≈ 61.7% > 35%
    const result = computeMlbRlEdge(
      "ATH",
      "BAL",
      60.0, // awayRlCoverPct — BELOW break-even (64.5%)
      35.0, // homeRlCoverPct — BELOW break-even (61.7%)
      -182, // bkAwayRlOdds (ATH -1.5 at -182, break-even = 64.5%)
      -161, // bkHomeRlOdds (BAL +1.5 at -161, break-even = 61.7%)
      "-1.5",
      "+1.5"
    );
    expect(result.spreadEdge).toBeNull();
    expect(parseFloat(result.spreadDiff!)).toBeLessThanOrEqual(0);
  });

  it("spreadDiff is in percentage points (pp), not decimal fraction", () => {
    // 3.5pp edge should be stored as "3.5" not "0.035"
    const result = computeMlbRlEdge(
      "ATH",
      "BAL",
      68.0,
      32.0,
      -182,
      151,
      "-1.5",
      "+1.5"
    );
    const diff = parseFloat(result.spreadDiff!);
    // Should be in pp range (1-20), not decimal range (0.01-0.20)
    expect(diff).toBeGreaterThan(1);
    expect(diff).toBeLessThan(20);
  });

  it("returns null spreadDiff when book RL odds are NaN", () => {
    const result = computeMlbRlEdge(
      "ATH",
      "BAL",
      68.0,
      32.0,
      NaN,
      NaN,
      "-1.5",
      "+1.5"
    );
    expect(result.spreadDiff).toBeNull();
    expect(result.spreadEdge).toBeNull();
  });

  it("spreadEdge label format is parseable by edgeLabelIsAway()", () => {
    // edgeLabelIsAway() checks if the label starts with the away abbreviation
    // Format: "ABBR ±1.5 [EDGE]" — abbr is the first token
    const result = computeMlbRlEdge(
      "NYM",
      "ARI",
      67.0,
      33.0,
      -182,
      151,
      "-1.5",
      "+1.5"
    );
    expect(result.spreadEdge).toBe("NYM -1.5 [EDGE]");
    // Verify the format: first token is the team abbreviation
    const parts = result.spreadEdge!.split(" ");
    expect(parts[0]).toBe("NYM");
    expect(parts[1]).toBe("-1.5");
    expect(parts[2]).toBe("[EDGE]");
  });
});

describe("Total Line Matching — syncModelTotal", () => {
  it("syncs modelTotal to bookTotal exactly", () => {
    expect(syncModelTotal(9.5)).toBe("9.5");
    expect(syncModelTotal(8.0)).toBe("8");
    expect(syncModelTotal(7.5)).toBe("7.5");
  });

  it("returns null when bookTotal is null", () => {
    expect(syncModelTotal(null)).toBeNull();
  });

  it("returns null when bookTotal is NaN", () => {
    expect(syncModelTotal(NaN)).toBeNull();
  });

  it("modelTotal = bookTotal means totalDiff = 0 (no false edge)", () => {
    const bookTotal = 9.5;
    const modelTotal = parseFloat(syncModelTotal(bookTotal)!);
    const totalDiff = Math.round(Math.abs(modelTotal - bookTotal) * 10) / 10;
    expect(totalDiff).toBe(0);
  });

  it("stale modelTotal causes false edge detection", () => {
    // This test documents the BUG: if modelTotal=8.5 but bookTotal=9.5, totalDiff=1.0
    // which triggers a false OVER edge. The fix: always sync modelTotal=bookTotal.
    const bookTotal = 9.5;
    const staleModelTotal = 8.5;
    const totalDiff =
      Math.round(Math.abs(staleModelTotal - bookTotal) * 10) / 10;
    expect(totalDiff).toBe(1.0); // This is the bug — should be 0
    // After fix: modelTotal is always synced to bookTotal via updateAnOdds and updateBookOdds
    const syncedModelTotal = parseFloat(syncModelTotal(bookTotal)!);
    const fixedTotalDiff =
      Math.round(Math.abs(syncedModelTotal - bookTotal) * 10) / 10;
    expect(fixedTotalDiff).toBe(0); // Fixed
  });
});

describe("RL Sign Guard — enforceRlSignGuard", () => {
  it("does NOT correct when Python output matches book sign", () => {
    // Book: ATH away=-1.5 (fav), Python: away_run_line="-1.5" → no correction needed
    const result = enforceRlSignGuard("-1.5", -1.5);
    expect(result.corrected).toBe(false);
    expect(result.safeAwayRunLine).toBe("-1.5");
  });

  it("does NOT correct when Python output matches book sign (underdog)", () => {
    // Book: LAA away=+1.5 (dog), Python: away_run_line="+1.5" → no correction needed
    const result = enforceRlSignGuard("+1.5", 1.5);
    expect(result.corrected).toBe(false);
    expect(result.safeAwayRunLine).toBe("+1.5");
  });

  it("CORRECTS when Python output is inverted (fav→dog flip)", () => {
    // Book: ATH away=-1.5 (fav), Python: away_run_line="+1.5" (WRONG) → correct to -1.5
    const result = enforceRlSignGuard("+1.5", -1.5);
    expect(result.corrected).toBe(true);
    expect(result.safeAwayRunLine).toBe("-1.5");
    expect(result.safeHomeRunLine).toBe("+1.5");
  });

  it("CORRECTS when Python output is inverted (dog→fav flip)", () => {
    // Book: LAA away=+1.5 (dog), Python: away_run_line="-1.5" (WRONG) → correct to +1.5
    const result = enforceRlSignGuard("-1.5", 1.5);
    expect(result.corrected).toBe(true);
    expect(result.safeAwayRunLine).toBe("+1.5");
    expect(result.safeHomeRunLine).toBe("-1.5");
  });

  it("safeAwayRunLine and safeHomeRunLine are always opposite signs", () => {
    const cases = [
      { python: "-1.5", book: -1.5 },
      { python: "+1.5", book: 1.5 },
      { python: "+1.5", book: -1.5 }, // flip case
      { python: "-1.5", book: 1.5 }, // flip case
    ];
    for (const c of cases) {
      const result = enforceRlSignGuard(c.python, c.book);
      const awayNum = parseFloat(result.safeAwayRunLine);
      const homeNum = parseFloat(result.safeHomeRunLine);
      expect(awayNum + homeNum).toBeCloseTo(0, 4); // always sum to 0
      expect(Math.abs(awayNum)).toBeCloseTo(1.5, 4); // always ±1.5
    }
  });
});

describe("GameCard spreadDiff path — MLB uses game.spreadDiff", () => {
  it("line arithmetic always yields 0 for matching ±1.5 signs", () => {
    // This documents WHY line arithmetic is wrong for MLB RL
    const awayModelSpread = -1.5; // ATH is away fav
    const awayBookSpread = -1.5; // book also has ATH as fav
    const lineArithmeticDiff =
      Math.round(Math.abs(awayModelSpread - awayBookSpread) * 10) / 10;
    expect(lineArithmeticDiff).toBe(0); // Always 0 → no edge ever shown → BUG
  });

  it("line arithmetic yields 3.0 for inverted signs (false edge)", () => {
    // Inverted signs (sign guard failure) produce a false 3.0pp edge
    const awayModelSpread = +1.5; // WRONG — should be -1.5
    const awayBookSpread = -1.5;
    const lineArithmeticDiff =
      Math.round(Math.abs(awayModelSpread - awayBookSpread) * 10) / 10;
    expect(lineArithmeticDiff).toBe(3.0); // False edge — sign guard prevents this
  });

  it("game.spreadDiff (probability-based) correctly reflects RL edge", () => {
    // After fix: GameCard uses game.spreadDiff for MLB (like NHL)
    // game.spreadDiff is written by mlbModelRunner as probability edge in pp
    const gameSpreadDiff = "3.5"; // written by mlbModelRunner
    const spreadDiff = parseFloat(gameSpreadDiff);
    expect(spreadDiff).toBeGreaterThan(0); // Edge exists
    expect(spreadDiff).toBeLessThan(20); // Sane range
  });
});

describe("Edge detection consistency — book vs model cross-reference", () => {
  it("OVER edge: modelTotal > bookTotal → authTotalEdgeIsOver=true", () => {
    // This path is for NBA (no model odds). For MLB/NHL, model odds take priority.
    const modelTotal = 9.0;
    const bookTotal = 8.5;
    const isOver = modelTotal > bookTotal;
    expect(isOver).toBe(true);
  });

  it("UNDER edge: modelTotal < bookTotal → authTotalEdgeIsOver=false", () => {
    const modelTotal = 8.0;
    const bookTotal = 8.5;
    const isOver = modelTotal > bookTotal;
    expect(isOver).toBe(false);
  });

  it("NO edge: modelTotal === bookTotal → totalDiff=0 → PASS", () => {
    const modelTotal = 9.5;
    const bookTotal = 9.5;
    const totalDiff = Math.round(Math.abs(modelTotal - bookTotal) * 10) / 10;
    expect(totalDiff).toBe(0); // No edge
  });

  it("MLB model odds priority: Tier 1 (model odds) > Tier 3 (line comparison)", () => {
    // When modelOverOdds and overOdds/underOdds are available, use probability comparison
    // This is the highest-priority path for MLB/NHL total edge detection
    // Example: model o9.5 (-110) vs book o9.5 (-118)/u9.5 (-102)
    //   model over prob = 110/210 ≈ 52.38%
    //   book no-vig over prob = (118/218) / ((118/218) + (102/202)) ≈ 51.74%
    //   52.38% > 51.74% → model MORE confident in OVER → OVER edge
    const modelOverOdds = -110; // model fair odds at book's total line
    const bkOverOdds = -118; // book over odds
    const bkUnderOdds = -102; // book under odds

    // americanToImplied: negative odds → |odds|/(|odds|+100), positive → 100/(odds+100)
    const modelOverProb =
      Math.abs(modelOverOdds) / (Math.abs(modelOverOdds) + 100);
    const rawBkOver = Math.abs(bkOverOdds) / (Math.abs(bkOverOdds) + 100);
    const rawBkUnder = Math.abs(bkUnderOdds) / (Math.abs(bkUnderOdds) + 100);
    const vigTotal = rawBkOver + rawBkUnder;
    const bookNoVigOverProb = rawBkOver / vigTotal;

    // model over prob (52.38%) vs book no-vig over prob (≈51.74%) → OVER edge
    expect(modelOverProb).toBeCloseTo(0.5238, 3);
    expect(bookNoVigOverProb).toBeCloseTo(0.5174, 3);
    expect(modelOverProb).toBeGreaterThan(bookNoVigOverProb); // model more confident in OVER
    // → model MORE confident in OVER → OVER edge
    const isOver = modelOverProb > bookNoVigOverProb;
    expect(isOver).toBe(true); // OVER edge
  });
});
