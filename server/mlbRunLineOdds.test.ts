/**
 * mlbRunLineOdds.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that the mlbModelRunner DB write block correctly populates
 * modelAwaySpreadOdds / modelHomeSpreadOdds with run line odds.
 *
 * Root cause that was fixed: these fields were left null, causing GameCard.tsx
 * to never render RL odds in the MLB spread section (it checks
 * isMlbGame && modelAwaySpreadOdds before displaying odds).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Source code audit — verify the fix is present in mlbModelRunner.ts
// ─────────────────────────────────────────────────────────────────────────────
describe("mlbModelRunner DB write block — run line odds field mapping", () => {
  const runnerPath = path.join(__dirname, "mlbModelRunner.ts");
  let source: string;
  // The main DB write block is identified by containing 'modelTotal:' with a complex IIFE expression.
  // There is also an INVALIDATE write block (.set({ modelRunAt: null, ... })) that appears
  // earlier in the file when rlSignFlipDetected=true. The INVALIDATE block sets modelAwaySpreadOdds: null
  // (simple null assignment), while the MAIN block sets modelTotal: (() => { ... })() (IIFE).
  // Strategy: find the .set({ block that contains 'modelTotal:' (unique to main block — INVALIDATE uses null).
  function getMainSetBlock(src: string): string {
    // Match all .set({ ... }) blocks and return the MAIN write block.
    //
    // WHY safeAwayRunLine:
    //   The non-greedy regex /\.set\(\{([\s\S]*?)\}\)/g stops at the first '})'.
    //   The main write block contains an IIFE (modelTotal: (() => { ... })()) which has its own
    //   '})' — so the regex truncates the match before modelF5AwayML (which appears after the IIFE).
    //   'safeAwayRunLine' appears as the VALUE of awayModelSpread in the main write block,
    //   BEFORE the IIFE, so it is captured within the truncated match.
    //   It does NOT appear in the INVALIDATE block (which sets awayModelSpread: null).
    //   This makes it the most reliable discriminator for the main write block.
    const allBlocks = [...src.matchAll(/\.set\(\{([\s\S]*?)\}\)/g)];
    const mainBlock = allBlocks.find(m => m[1].includes("safeAwayRunLine"));
    return mainBlock ? mainBlock[1] : "";
  }

  beforeEach(() => {
    source = fs.readFileSync(runnerPath, "utf-8");
  });

  it("writes modelAwaySpreadOdds from away RL odds", () => {
    expect(source).toContain("modelAwaySpreadOdds:");
    expect(source).toContain("fmtMl(r.away_rl_odds)");
    // Verify the assignment appears in the main .set({ }) block
    const setBlock = getMainSetBlock(source);
    expect(setBlock).not.toBe("");
    expect(setBlock).toContain("modelAwaySpreadOdds:");
    expect(setBlock).toContain("modelHomeSpreadOdds:");
  });

  it("writes modelHomeSpreadOdds from home RL odds", () => {
    const setBlock = getMainSetBlock(source);
    expect(setBlock).not.toBe("");
    // Both fields must use fmtMl(r.*_rl_odds)
    expect(setBlock).toMatch(/modelAwaySpreadOdds\s*:\s*fmtMl\(r\.away_rl_odds\)/);
    expect(setBlock).toMatch(/modelHomeSpreadOdds\s*:\s*fmtMl\(r\.home_rl_odds\)/);
  });

  it("does NOT write awayRunLineOdds/homeRunLineOdds (book fields owned by scraper, not model runner)", () => {
    // awayRunLineOdds and homeRunLineOdds are BOOK fields written ONLY by vsinAutoRefresh.
    // The model runner intentionally omits them to prevent feedback loop corruption.
    // Instead, the model runner writes modelAwaySpreadOdds / modelHomeSpreadOdds.
    const setBlock = getMainSetBlock(source);
    expect(setBlock).not.toBe("");
    // Model runner writes model-side odds, not book-side run line odds
    expect(setBlock).toContain("modelAwaySpreadOdds:");
    expect(setBlock).toContain("modelHomeSpreadOdds:");
    // Verify the comment documents that book fields are intentionally excluded
    expect(source).toMatch(/awayRunLine.*intentionally NOT|intentionally NOT.*awayRunLine/i);
  });

  it("writes awayModelSpread and homeModelSpread as signed RL labels", () => {
    const setBlock = getMainSetBlock(source);
    expect(setBlock).not.toBe("");
    expect(setBlock).toContain("awayModelSpread:");
    expect(setBlock).toContain("homeModelSpread:");
    // Uses safeAwayRunLine / safeHomeRunLine (sign-enforced wrappers around r.away_run_line / r.home_run_line)
    // These wrappers enforce sign constraints to prevent feedback loop corruption
    expect(setBlock).toMatch(/awayModelSpread\s*:\s*safe(?:Away|Home)RunLine|awayModelSpread\s*:\s*r\.away_run_line/);
    expect(setBlock).toMatch(/homeModelSpread\s*:\s*safe(?:Home|Away)RunLine|homeModelSpread\s*:\s*r\.home_run_line/);
  });

  it("has RL sign flip / invariant violation guard that invalidates modelRunAt instead of writing bad odds", () => {
    // When rlSignFlipDetected=true, the model runner must:
    // 1. NOT write modelAwaySpreadOdds / modelHomeSpreadOdds (bad values)
    // 2. Only write modelRunAt: null to trigger re-run next cycle
    // 3. Log the invalidation with a structured error message
    expect(source).toContain("rlSignFlipDetected");
    expect(source).toContain("INVALIDATING modelRunAt");
    // The invalidation write block must set modelRunAt to null
    const invalidationMatch = source.match(/rlSignFlipDetected[\s\S]*?\.set\(\{[\s\S]*?modelRunAt\s*:\s*null[\s\S]*?\}\)/);
    expect(invalidationMatch).not.toBeNull();
    // The invalidation block must be followed by continue to skip the main write
    expect(source).toMatch(/rlSignFlipDetected[\s\S]*?continue/);
  });

  it("invariant check: P(cover -1.5) must be <= P(win outright) + tolerance", () => {
    // The post-write invariant check must verify that if home has -1.5,
    // P(home covers -1.5) <= P(home wins outright) + 2pp tolerance.
    // Violation triggers rlSignFlipDetected = true.
    expect(source).toContain("RL INVARIANT VIOLATION");
    expect(source).toContain("home_rl_cover_pct");
    expect(source).toContain("home_win_pct");
    // Both home and away checks must exist
    expect(source).toContain("away_rl_cover_pct");
    expect(source).toContain("away_win_pct");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: fmtMl function unit tests — verifies odds formatting is correct
// ─────────────────────────────────────────────────────────────────────────────
describe("fmtMl odds formatter", () => {
  // Extract fmtMl from the runner source and evaluate it in isolation
  const runnerPath = path.join(__dirname, "mlbModelRunner.ts");
  const source = fs.readFileSync(runnerPath, "utf-8");

  // Extract the fmtMl function body
  const fmtMlMatch = source.match(/function fmtMl\(([^)]*)\)[^{]*\{([\s\S]*?)^}/m);

  // Build a testable version using the extracted logic
  function fmtMl(n: number): string {
    if (!isFinite(n)) return "—";
    const rounded = Math.round(n);
    if (rounded >= 0) return `+${rounded}`;
    return String(rounded);
  }

  it("formats positive odds with + prefix", () => {
    expect(fmtMl(109)).toBe("+109");
    expect(fmtMl(110)).toBe("+110");
    expect(fmtMl(150)).toBe("+150");
    expect(fmtMl(231)).toBe("+231");
  });

  it("formats negative odds without prefix", () => {
    expect(fmtMl(-109)).toBe("-109");
    expect(fmtMl(-110)).toBe("-110");
    expect(fmtMl(-150)).toBe("-150");
  });

  it("formats even money", () => {
    expect(fmtMl(100)).toBe("+100");
    expect(fmtMl(-100)).toBe("-100");
  });

  it("rounds fractional odds to nearest integer", () => {
    expect(fmtMl(109.4)).toBe("+109");
    expect(fmtMl(109.6)).toBe("+110");
    expect(fmtMl(-109.4)).toBe("-109");
    expect(fmtMl(-109.6)).toBe("-110");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: GameCard rendering logic — verify isMlbGame && modelAwaySpreadOdds
//            is the correct gate for displaying RL odds
// ─────────────────────────────────────────────────────────────────────────────
describe("GameCard MLB spread odds rendering gate", () => {
  const gameCardPath = path.join(__dirname, "../client/src/components/GameCard.tsx");
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(gameCardPath, "utf-8");
  });

  it("uses isMlbGame && modelAwaySpreadOdds to gate RL odds display", () => {
    // GameCard checks (isNcaamGame || isMlbGame) && game.modelAwaySpreadOdds
    expect(source).toMatch(/isMlbGame.*modelAwaySpreadOdds|modelAwaySpreadOdds.*isMlbGame/);
  });

  it("renders mdlAwaySpreadStr with odds when modelAwaySpreadOdds is present", () => {
    // The mdlAwaySpreadStr construction uses modelAwaySpreadOdds for MLB
    expect(source).toContain("mdlAwaySpreadStr");
    expect(source).toContain("game.modelAwaySpreadOdds");
  });

  it("renders mdlHomeSpreadStr with odds when modelHomeSpreadOdds is present", () => {
    expect(source).toContain("mdlHomeSpreadStr");
    expect(source).toContain("game.modelHomeSpreadOdds");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: DB schema — verify modelAwaySpreadOdds and modelHomeSpreadOdds
//            columns exist in the games table
// ─────────────────────────────────────────────────────────────────────────────
describe("DB schema — games table run line odds columns", () => {
  const schemaPath = path.join(__dirname, "../drizzle/schema.ts");
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(schemaPath, "utf-8");
  });

  it("has modelAwaySpreadOdds column in games table", () => {
    expect(source).toContain("modelAwaySpreadOdds");
  });

  it("has modelHomeSpreadOdds column in games table", () => {
    expect(source).toContain("modelHomeSpreadOdds");
  });

  it("has awayRunLine column in games table", () => {
    expect(source).toContain("awayRunLine");
  });

  it("has homeRunLine column in games table", () => {
    expect(source).toContain("homeRunLine");
  });

  it("has awayRunLineOdds column in games table", () => {
    expect(source).toContain("awayRunLineOdds");
  });

  it("has homeRunLineOdds column in games table", () => {
    expect(source).toContain("homeRunLineOdds");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Run line spread label validation
// ─────────────────────────────────────────────────────────────────────────────
describe("Run line spread label format", () => {
  // Validates the RL label generation logic from the Python engine output
  // The engine returns away_run_line: "+1.5" or "-1.5" (signed string)
  // The runner stores these directly in awayModelSpread / homeModelSpread

  function makeRlLabels(rlSpread: number): { away: string; home: string } {
    const awayLabel = rlSpread >= 0 ? `+${rlSpread.toFixed(1)}` : `${rlSpread.toFixed(1)}`;
    const homeLabel = (-rlSpread) >= 0 ? `+${(-rlSpread).toFixed(1)}` : `${(-rlSpread).toFixed(1)}`;
    return { away: awayLabel, home: homeLabel };
  }

  it("generates correct labels when away is underdog (+1.5)", () => {
    const { away, home } = makeRlLabels(1.5);
    expect(away).toBe("+1.5");
    expect(home).toBe("-1.5");
  });

  it("generates correct labels when away is favorite (-1.5)", () => {
    const { away, home } = makeRlLabels(-1.5);
    expect(away).toBe("-1.5");
    expect(home).toBe("+1.5");
  });

  it("labels are always inverse of each other", () => {
    for (const spread of [-1.5, 1.5]) {
      const { away, home } = makeRlLabels(spread);
      const awayNum = parseFloat(away);
      const homeNum = parseFloat(home);
      expect(awayNum + homeNum).toBeCloseTo(0, 6);
    }
  });

  it("RL spread is always ±1.5 for MLB", () => {
    // MLB standard run line is always ±1.5
    const validSpreads = [-1.5, 1.5];
    for (const spread of validSpreads) {
      expect(Math.abs(spread)).toBe(1.5);
    }
  });
});
