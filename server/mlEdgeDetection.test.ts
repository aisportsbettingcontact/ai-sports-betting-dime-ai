/**
 * mlEdgeDetection.test.ts
 *
 * Tests for the unified ML edge detection framework.
 *
 * CORE INVARIANT: ML edge direction must ALWAYS match spread edge direction.
 *   - If model likes the away team spread → away ML must be the edge (not home)
 *   - If model likes the home team spread → home ML must be the edge (not away)
 *   - If no spread edge → ML edge falls back to implied-probability comparison
 *
 * This file tests the pure logic functions extracted from GameCard.tsx.
 * No React/DOM required — pure unit tests.
 */

import { describe, it, expect } from "vitest";

// ── Pure logic extracted from GameCard.tsx ────────────────────────────────────

/** Compute implied win probability from a money-line value. */
function mlImpliedProb(ml: string | number | null | undefined): number {
  if (ml == null || ml === "" || ml === "—") return NaN;
  const n =
    typeof ml === "number" ? ml : Number(String(ml).replace(/[^\d.-]/g, ""));
  if (isNaN(n)) return NaN;
  if (n === 100) return 0.5;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

const ML_EDGE_THRESHOLD = 0.02;

/**
 * Unified ML edge detection — mirrors the logic in GameCard.tsx mobile section.
 *
 * Returns { awayMlEdge, homeMlEdge } booleans.
 *
 * @param spreadEdgeIsAway  null = no spread edge; true = away; false = home
 * @param bkAwayMl   book away money-line
 * @param mdlAwayMl  model away money-line
 * @param bkHomeMl   book home money-line
 * @param mdlHomeMl  model home money-line
 */
function computeUnifiedMlEdge(
  spreadEdgeIsAway: boolean | null,
  bkAwayMl: number | string | null,
  mdlAwayMl: number | string | null,
  bkHomeMl: number | string | null,
  mdlHomeMl: number | string | null
): { awayMlEdge: boolean; homeMlEdge: boolean } {
  const bkAwayProb = mlImpliedProb(bkAwayMl);
  const mdlAwayProb = mlImpliedProb(mdlAwayMl);
  const bkHomeProb = mlImpliedProb(bkHomeMl);
  const mdlHomeProb = mlImpliedProb(mdlHomeMl);

  const awayMlProbEdge =
    !isNaN(bkAwayProb) && !isNaN(mdlAwayProb)
      ? mdlAwayProb - bkAwayProb >= ML_EDGE_THRESHOLD
      : false;
  const homeMlProbEdge =
    !isNaN(bkHomeProb) && !isNaN(mdlHomeProb)
      ? mdlHomeProb - bkHomeProb >= ML_EDGE_THRESHOLD
      : false;

  const awayMlEdge: boolean =
    spreadEdgeIsAway !== null ? spreadEdgeIsAway === true : awayMlProbEdge;
  const homeMlEdge: boolean =
    spreadEdgeIsAway !== null ? spreadEdgeIsAway === false : homeMlProbEdge;

  return { awayMlEdge, homeMlEdge };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("mlImpliedProb — implied probability conversion", () => {
  it("converts a positive (underdog) ML correctly", () => {
    // +490 → 100 / (490 + 100) = 0.1695
    expect(mlImpliedProb(490)).toBeCloseTo(0.1695, 3);
  });

  it("converts a negative (favorite) ML correctly", () => {
    // -675 → 675 / (675 + 100) = 0.8710
    expect(mlImpliedProb(-675)).toBeCloseTo(0.871, 3);
  });

  it("converts +100 (even money) to exactly 0.5", () => {
    expect(mlImpliedProb(100)).toBe(0.5);
  });

  it("converts string ML values", () => {
    expect(mlImpliedProb("+490")).toBeCloseTo(0.1695, 3);
    expect(mlImpliedProb("-675")).toBeCloseTo(0.871, 3);
  });

  it("returns NaN for null/empty/dash values", () => {
    expect(mlImpliedProb(null)).toBeNaN();
    expect(mlImpliedProb("")).toBeNaN();
    expect(mlImpliedProb("—")).toBeNaN();
    expect(mlImpliedProb(undefined)).toBeNaN();
  });
});

describe("computeUnifiedMlEdge — UCLA/Rutgers scenario (the reported bug)", () => {
  /**
   * Scenario from screenshot:
   *   Away: RUTGERS  Book ML: +490  Model ML: +369
   *   Home: UCLA     Book ML: -675  Model ML: -369
   *   Spread edge: UCLA (home) → spreadEdgeIsAway = false
   *
   * OLD (buggy) behavior: Rutgers ML also flagged as edge because
   *   mdlAwayProb(+369=0.213) - bkAwayProb(+490=0.169) = 0.044 >= 0.02
   *
   * NEW (correct) behavior: spreadEdgeIsAway=false → only home (UCLA) ML is edge
   */
  it("when spread edge is on home (UCLA), only home ML is edge — never away (Rutgers)", () => {
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      false, // spreadEdgeIsAway = false (UCLA home is the spread edge)
      490, // book away (Rutgers) ML
      369, // model away (Rutgers) ML
      -675, // book home (UCLA) ML
      -369 // model home (UCLA) ML
    );
    expect(awayMlEdge).toBe(false); // Rutgers ML must NOT be edge
    expect(homeMlEdge).toBe(true); // UCLA ML must be edge
  });

  it("when spread edge is on away, only away ML is edge — never home", () => {
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      true, // spreadEdgeIsAway = true (away team is the spread edge)
      490,
      369,
      -675,
      -369
    );
    expect(awayMlEdge).toBe(true); // away ML is edge
    expect(homeMlEdge).toBe(false); // home ML must NOT be edge
  });

  it("away and home ML edges are NEVER both true when spread edge exists", () => {
    // Test with spread edge on away
    const r1 = computeUnifiedMlEdge(true, 490, 369, -675, -369);
    expect(r1.awayMlEdge && r1.homeMlEdge).toBe(false);

    // Test with spread edge on home
    const r2 = computeUnifiedMlEdge(false, 490, 369, -675, -369);
    expect(r2.awayMlEdge && r2.homeMlEdge).toBe(false);
  });
});

describe("computeUnifiedMlEdge — no spread edge (fallback to implied probability)", () => {
  it("uses implied-probability fallback when spreadEdgeIsAway is null", () => {
    // Model gives away team significantly better odds → away ML edge
    // Away: book +200 (prob=0.333), model +130 (prob=0.435) → diff=0.102 >= 0.02 → edge
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      null, // no spread edge
      200, // book away ML
      130, // model away ML (much better odds for away)
      -200, // book home ML
      -130 // model home ML
    );
    expect(awayMlEdge).toBe(true);
    expect(homeMlEdge).toBe(false);
  });

  it("no ML edge when implied prob difference is below threshold", () => {
    // Away: book +200 (0.333), model +195 (0.339) → diff=0.006 < 0.02 → no edge
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      null,
      200,
      195,
      -200,
      -195
    );
    expect(awayMlEdge).toBe(false);
    expect(homeMlEdge).toBe(false);
  });

  it("home ML edge when home implied prob exceeds book by threshold", () => {
    // Home: book -200 (prob=0.667), model -150 (prob=0.600) → diff=-0.067 → no edge for home
    // Actually: model gives home LESS probability → no edge
    // Let's test: book -300 (0.750), model -200 (0.667) → diff = -0.083 → no edge
    const { homeMlEdge } = computeUnifiedMlEdge(null, 300, 200, -300, -200);
    // model home prob (0.667) < book home prob (0.750) → no edge
    expect(homeMlEdge).toBe(false);
  });

  it("home ML edge when model implies higher home win probability", () => {
    // Home: book -130 (prob=0.565), model -200 (prob=0.667) → diff=0.102 >= 0.02 → edge
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      null,
      130, // book away (underdog)
      200, // model away (bigger underdog)
      -130, // book home (favorite)
      -200 // model home (bigger favorite)
    );
    expect(homeMlEdge).toBe(true);
    expect(awayMlEdge).toBe(false);
  });
});

describe("computeUnifiedMlEdge — edge cases", () => {
  it("returns no edge when ML data is missing", () => {
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      null,
      null,
      null,
      null,
      null
    );
    expect(awayMlEdge).toBe(false);
    expect(homeMlEdge).toBe(false);
  });

  it("spread edge overrides even when prob fallback would give opposite result", () => {
    // Spread edge is on away (spreadEdgeIsAway=true)
    // But implied prob says home has the edge
    // → spread direction wins; away ML is edge
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      true, // spread edge on away
      200, // book away
      195, // model away (barely changed — prob fallback would say no away edge)
      -130, // book home
      -200 // model home (prob fallback would say home edge)
    );
    expect(awayMlEdge).toBe(true); // spread direction wins
    expect(homeMlEdge).toBe(false); // home ML suppressed by spread direction
  });

  it("spread edge on home suppresses away ML even if away prob edge is large", () => {
    // Spread edge is on home (spreadEdgeIsAway=false)
    // Away implied prob edge is large (0.044) — this was the Rutgers bug
    const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
      false, // spread edge on home
      490, // book away +490 → prob 0.169
      369, // model away +369 → prob 0.213 (diff=0.044 > threshold)
      -675,
      -369
    );
    expect(awayMlEdge).toBe(false); // suppressed — this was the bug
    expect(homeMlEdge).toBe(true); // home is the correct edge
  });

  it("EV (+100) money line is treated as exactly 50% probability", () => {
    expect(mlImpliedProb(100)).toBe(0.5);
    // Model gives away EV (+100 = 0.500), book gives away +200 (0.333)
    // diff = 0.167 >= 0.02 → away edge when no spread edge
    const { awayMlEdge } = computeUnifiedMlEdge(null, 200, 100, -200, -100);
    expect(awayMlEdge).toBe(true);
  });
});

describe("computeUnifiedMlEdge — consistency invariant", () => {
  it("awayMlEdge and homeMlEdge are NEVER simultaneously true", () => {
    const scenarios: Array<[boolean | null, number, number, number, number]> = [
      [true, 490, 369, -675, -369],
      [false, 490, 369, -675, -369],
      [null, 490, 369, -675, -369],
      [true, 200, 130, -200, -130],
      [false, 200, 130, -200, -130],
      [null, 200, 130, -200, -130],
      [null, 110, 105, -110, -105],
      [
        null,
        null as unknown as number,
        null as unknown as number,
        null as unknown as number,
        null as unknown as number,
      ],
    ];
    for (const [sea, ba, ma, bh, mh] of scenarios) {
      const { awayMlEdge, homeMlEdge } = computeUnifiedMlEdge(
        sea,
        ba,
        ma,
        bh,
        mh
      );
      expect(awayMlEdge && homeMlEdge).toBe(false);
    }
  });
});
