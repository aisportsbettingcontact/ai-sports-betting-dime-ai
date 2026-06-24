/**
 * gameCardEdgeGate.test.ts
 *
 * Tests the [FIX 2026-06-24] MODELRUNAT GATE logic:
 * authSpreadEdgeIsAway and authTotalEdgeIsOver MUST be null when
 * game.modelRunAt is null, even when model odds fields are populated.
 *
 * Root cause: RL INVALIDATE sets modelRunAt=null but leaves stale model odds
 * fields in the DB. Without the gate, the frontend renders '—' dashes in
 * neon green (#39FF14) — a false edge signal on a game with no valid model output.
 *
 * This test validates the pure logic of the gate without importing React components.
 * The gate is: const _hasModelRunAt = game.modelRunAt != null;
 *              authSpreadEdgeIsAway = !_hasModelRunAt ? null : <computation>
 *              authTotalEdgeIsOver  = !_hasModelRunAt ? null : <computation>
 */

import { describe, it, expect } from "vitest";

// ── Replicate the exact gate logic from GameCard.tsx ─────────────────────────
// This mirrors the production code at lines 2554-2564 of GameCard.tsx.
// Any change to the gate logic in GameCard.tsx must be reflected here.

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

interface GameLike {
  modelRunAt?: number | null;
  spreadEdge?: string | null;
  totalEdge?: string | null;
  modelOverOdds?: string | null;
  modelUnderOdds?: string | null;
  overOdds?: string | null;
  underOdds?: string | null;
  awayModelSpread?: number | null;
  homeModelSpread?: number | null;
  awayBookSpread?: number | null;
  homeBookSpread?: number | null;
  sport?: string | null;
}

function computeAuthEdges(game: GameLike): {
  authSpreadEdgeIsAway: boolean | null;
  authTotalEdgeIsOver: boolean | null;
} {
  // [FIX 2026-06-24] MODELRUNAT GATE
  const _hasModelRunAt = game.modelRunAt != null;

  const authSpreadEdgeIsAway: boolean | null = !_hasModelRunAt ? null : (() => {
    if (!game.spreadEdge || game.spreadEdge === 'PASS') return null;
    // Simplified: just return non-null to simulate edge detected
    return true;
  })();

  const authTotalEdgeIsOver: boolean | null = !_hasModelRunAt ? null : (() => {
    const mdlOver  = game.modelOverOdds  ? parseFloat(game.modelOverOdds)  : NaN;
    const mdlUnder = game.modelUnderOdds ? parseFloat(game.modelUnderOdds) : NaN;
    const bkOver   = game.overOdds       ? parseFloat(game.overOdds)       : NaN;
    const bkUnder  = game.underOdds      ? parseFloat(game.underOdds)      : NaN;
    if (!isNaN(bkOver) && !isNaN(bkUnder)) {
      const rawBkOver  = americanToImplied(bkOver);
      const rawBkUnder = americanToImplied(bkUnder);
      const overEdge  = !isNaN(mdlOver)  ? americanToImplied(mdlOver)  > rawBkOver  : false;
      const underEdge = !isNaN(mdlUnder) ? americanToImplied(mdlUnder) > rawBkUnder : false;
      if (overEdge  && !underEdge) return true;
      if (underEdge && !overEdge)  return false;
      if (!overEdge && !underEdge) return null;
    }
    return null;
  })();

  return { authSpreadEdgeIsAway, authTotalEdgeIsOver };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("[FIX 2026-06-24] MODELRUNAT GATE — authSpreadEdgeIsAway / authTotalEdgeIsOver", () => {

  // ── CASE 1: modelRunAt = null (model not yet run or invalidated) ─────────────
  // Even with populated model odds, BOTH flags must be null.
  // This is the exact scenario that caused the CHC@NYM green dash bug.
  it("returns null for both flags when modelRunAt is null, even with populated model odds", () => {
    const game: GameLike = {
      modelRunAt: null,
      spreadEdge: "CHC -1.5 [EDGE]",  // stale edge label from previous run
      totalEdge:  "OVER 8.5 [EDGE]",  // stale total edge from previous run
      modelOverOdds:  "-157",          // stale model over odds
      modelUnderOdds: "+157",          // stale model under odds
      overOdds:   "-110",              // current book over odds
      underOdds:  "-109",              // current book under odds
      sport: "MLB",
    };
    const { authSpreadEdgeIsAway, authTotalEdgeIsOver } = computeAuthEdges(game);

    // [VERIFY] Both flags MUST be null when modelRunAt is null
    expect(authSpreadEdgeIsAway).toBeNull();
    expect(authTotalEdgeIsOver).toBeNull();
  });

  // ── CASE 2: modelRunAt = undefined (game not yet modeled) ────────────────────
  it("returns null for both flags when modelRunAt is undefined", () => {
    const game: GameLike = {
      modelRunAt: undefined,
      spreadEdge: "NYM +1.5 [EDGE]",
      totalEdge:  "UNDER 8.5 [EDGE]",
      modelOverOdds:  "+141",
      modelUnderOdds: "-141",
      overOdds:   "-110",
      underOdds:  "-109",
      sport: "MLB",
    };
    const { authSpreadEdgeIsAway, authTotalEdgeIsOver } = computeAuthEdges(game);

    expect(authSpreadEdgeIsAway).toBeNull();
    expect(authTotalEdgeIsOver).toBeNull();
  });

  // ── CASE 3: modelRunAt = 0 (falsy but technically a timestamp) ───────────────
  // 0 is falsy in JS. The gate uses != null (not !modelRunAt) so 0 should pass.
  it("treats modelRunAt=0 as non-null (gate uses != null, not !modelRunAt)", () => {
    const game: GameLike = {
      modelRunAt: 0,  // epoch — technically a valid timestamp (not null/undefined)
      spreadEdge: "CHC -1.5 [EDGE]",
      totalEdge:  "OVER 8.5 [EDGE]",
      modelOverOdds:  "-157",
      modelUnderOdds: "+157",
      overOdds:   "-110",
      underOdds:  "-109",
      sport: "MLB",
    };
    const { authSpreadEdgeIsAway, authTotalEdgeIsOver } = computeAuthEdges(game);

    // modelRunAt=0 is != null, so the gate passes and edge computation runs
    // spreadEdge is "CHC -1.5 [EDGE]" → non-null → authSpreadEdgeIsAway = true (simplified)
    expect(authSpreadEdgeIsAway).not.toBeNull();
    // totalEdge: mdlOver=-157 → implied=61.1% > bkOver=-110 → implied=52.4% → OVER edge
    expect(authTotalEdgeIsOver).toBe(true);
  });

  // ── CASE 4: modelRunAt is a valid timestamp — edge computation runs normally ──
  it("computes edge direction normally when modelRunAt is a valid timestamp", () => {
    const game: GameLike = {
      modelRunAt: 1782260553001,  // valid timestamp (2026-06-24T00:22:33 UTC)
      spreadEdge: "CHC -1.5 [EDGE]",
      totalEdge:  "OVER 8.5 [EDGE]",
      modelOverOdds:  "-157",   // model more confident in OVER (61.1% > 52.4%)
      modelUnderOdds: "+157",   // model less confident in UNDER (38.9% < 47.6%)
      overOdds:   "-110",
      underOdds:  "-109",
      sport: "MLB",
    };
    const { authSpreadEdgeIsAway, authTotalEdgeIsOver } = computeAuthEdges(game);

    // [VERIFY] Gate passes → edge computation runs
    // spreadEdge is "CHC -1.5 [EDGE]" → simplified returns true (away edge)
    expect(authSpreadEdgeIsAway).toBe(true);
    // totalEdge: mdlOver=-157 → implied=61.1% > bkOver=-110 → implied=52.4% → OVER edge
    expect(authTotalEdgeIsOver).toBe(true);
  });

  // ── CASE 5: modelRunAt valid but no edge in spread or total ──────────────────
  it("returns null for both flags when modelRunAt is valid but no edge exists", () => {
    const game: GameLike = {
      modelRunAt: 1782260553001,
      spreadEdge: "PASS",   // no spread edge
      totalEdge:  "PASS",   // no total edge
      modelOverOdds:  "-105",  // model barely more confident in OVER
      modelUnderOdds: "-105",  // symmetric — no clear edge
      overOdds:   "-110",
      underOdds:  "-110",
      sport: "MLB",
    };
    const { authSpreadEdgeIsAway, authTotalEdgeIsOver } = computeAuthEdges(game);

    // spreadEdge = PASS → null
    expect(authSpreadEdgeIsAway).toBeNull();
    // mdlOver=-105 → implied=51.2% vs bkOver=-110 → implied=52.4%: 51.2% < 52.4% → no OVER edge
    // mdlUnder=-105 → implied=51.2% vs bkUnder=-110 → implied=52.4%: 51.2% < 52.4% → no UNDER edge
    // Both false → null
    expect(authTotalEdgeIsOver).toBeNull();
  });

  // ── CASE 6: RL INVALIDATE scenario — modelRunAt null, stale odds populated ───
  // This is the EXACT scenario from the CHC@NYM bug report.
  // The RL INVALIDATE path sets modelRunAt=null but leaves stale model odds.
  // The gate must prevent any edge color from being applied.
  it("handles RL INVALIDATE scenario: modelRunAt=null with stale populated model odds", () => {
    // Simulates the DB state during the ~5-minute window after RL INVALIDATE
    // and before the next successful model run.
    const game: GameLike = {
      modelRunAt: null,                // RL INVALIDATE cleared this
      spreadEdge: "CHC -1.5 [EDGE]",  // stale — from before invalidation
      totalEdge:  "OVER 8.5 [EDGE]",  // stale — from before invalidation
      modelOverOdds:  "-157",          // stale — from before invalidation
      modelUnderOdds: "+157",          // stale — from before invalidation
      overOdds:   "-110",
      underOdds:  "-109",
      sport: "MLB",
    };
    const { authSpreadEdgeIsAway, authTotalEdgeIsOver } = computeAuthEdges(game);

    // [VERIFY] CRITICAL: Both flags MUST be null
    // Without the gate, authSpreadEdgeIsAway=true and authTotalEdgeIsOver=true
    // would cause '—' dashes to render in neon green (#39FF14) in MobileGameCard.
    expect(authSpreadEdgeIsAway).toBeNull();
    expect(authTotalEdgeIsOver).toBeNull();

    // [VERIFY] Confirm the gate is the ONLY reason for null (computation would return non-null)
    // If we bypass the gate by setting modelRunAt to a valid timestamp, computation returns non-null.
    const gameWithModelRun = { ...game, modelRunAt: 1782260553001 };
    const { authSpreadEdgeIsAway: spreadWithRun, authTotalEdgeIsOver: totalWithRun } = computeAuthEdges(gameWithModelRun);
    expect(spreadWithRun).not.toBeNull();  // computation would have returned non-null
    expect(totalWithRun).toBe(true);       // OVER edge confirmed when model has run
  });
});
