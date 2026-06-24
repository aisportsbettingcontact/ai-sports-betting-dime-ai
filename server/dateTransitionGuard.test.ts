/**
 * [FIX 2026-06-24] Date-transition guard unit tests
 *
 * ROOT CAUSE: When user navigates to a new date, React Query's placeholderData: (prev) => prev
 * returns the PREVIOUS date's games while the new query is in-flight (gamesLoading=false, gamesFetching=true).
 * The useMemo filters those games out (wrong gameDate) → sortedDates=[] while gamesFetching=true.
 * Without the fix, sortedDates.length===0 triggers "No games found" even though a real query is in-flight.
 *
 * THE FIX: Replace `gamesLoading ? <Skeleton> : sortedDates.length===0 ? <Empty>`
 * with `(gamesLoading || (gamesFetching && sortedDates.length===0)) ? <Skeleton> : sortedDates.length===0 ? <Empty>`
 *
 * These tests validate the boolean logic of the guard condition.
 */

import { describe, it, expect } from 'vitest';

// ── Core guard logic (extracted from ModelProjections.tsx) ────────────────────
// This is the exact boolean expression used in all 5 view branches after the fix.
function shouldShowSkeleton(gamesLoading: boolean, gamesFetching: boolean, sortedDatesLength: number): boolean {
  return gamesLoading || (gamesFetching && sortedDatesLength === 0);
}

function shouldShowEmptyState(gamesLoading: boolean, gamesFetching: boolean, sortedDatesLength: number): boolean {
  return !shouldShowSkeleton(gamesLoading, gamesFetching, sortedDatesLength) && sortedDatesLength === 0;
}

describe('[FIX 2026-06-24] Date-transition guard — shouldShowSkeleton / shouldShowEmptyState', () => {

  // ── Scenario 1: Initial load (query just fired, no placeholder data) ──────
  it('[VERIFY] Initial load: gamesLoading=true → show skeleton, not empty state', () => {
    // [INPUT] gamesLoading=true, gamesFetching=true, sortedDates=[]
    // [STATE] Query is in-flight, no placeholder data yet
    // [OUTPUT] shouldShowSkeleton=true, shouldShowEmptyState=false
    expect(shouldShowSkeleton(true, true, 0)).toBe(true);
    expect(shouldShowEmptyState(true, true, 0)).toBe(false);
    console.log('[VERIFY] PASS — Initial load shows skeleton, not empty state');
  });

  // ── Scenario 2: DATE TRANSITION (the bug scenario) ────────────────────────
  it('[VERIFY] Date transition: gamesLoading=false, gamesFetching=true, sortedDates=[] → show skeleton (NOT empty state)', () => {
    // [INPUT] gamesLoading=false (placeholderData active), gamesFetching=true (new query in-flight)
    // [STATE] allGames = prev date's games, filtered by new date → sortedDates=[]
    // [OUTPUT] shouldShowSkeleton=true (fix), shouldShowEmptyState=false (fix)
    // [VERIFY] Without fix: gamesLoading=false → skip skeleton → sortedDates.length===0 → show "No games found" (BUG)
    // [VERIFY] With fix: (gamesLoading || (gamesFetching && sortedDates.length===0)) = (false || (true && true)) = true → show skeleton
    expect(shouldShowSkeleton(false, true, 0)).toBe(true);
    expect(shouldShowEmptyState(false, true, 0)).toBe(false);
    console.log('[VERIFY] PASS — Date transition shows skeleton, not false "No games found"');
  });

  // ── Scenario 3: Games loaded successfully ─────────────────────────────────
  it('[VERIFY] Games loaded: gamesLoading=false, gamesFetching=false, sortedDates=10 → show games', () => {
    // [INPUT] gamesLoading=false, gamesFetching=false, sortedDates=10
    // [STATE] Query resolved, games filtered correctly for selected date
    // [OUTPUT] shouldShowSkeleton=false, shouldShowEmptyState=false → render game cards
    expect(shouldShowSkeleton(false, false, 10)).toBe(false);
    expect(shouldShowEmptyState(false, false, 10)).toBe(false);
    console.log('[VERIFY] PASS — Loaded games render game cards');
  });

  // ── Scenario 4: Genuine empty day (no games scheduled) ───────────────────
  it('[VERIFY] Genuine empty: gamesLoading=false, gamesFetching=false, sortedDates=0 → show empty state', () => {
    // [INPUT] gamesLoading=false, gamesFetching=false, sortedDates=0
    // [STATE] Query resolved with 0 games — this is a genuine off-day
    // [OUTPUT] shouldShowSkeleton=false, shouldShowEmptyState=true → show "No games found"
    expect(shouldShowSkeleton(false, false, 0)).toBe(false);
    expect(shouldShowEmptyState(false, false, 0)).toBe(true);
    console.log('[VERIFY] PASS — Genuine empty day shows "No games found"');
  });

  // ── Scenario 5: Background refetch with games present ─────────────────────
  it('[VERIFY] Background refetch with games: gamesFetching=true, sortedDates=10 → show games (not skeleton)', () => {
    // [INPUT] gamesLoading=false, gamesFetching=true, sortedDates=10
    // [STATE] 60s background refetch fires while games are already displayed
    // [OUTPUT] shouldShowSkeleton=false → games stay visible (no flicker)
    // [VERIFY] The (gamesFetching && sortedDates.length===0) guard ONLY fires when sortedDates=0
    //          So background refetches with existing games don't trigger skeleton
    expect(shouldShowSkeleton(false, true, 10)).toBe(false);
    expect(shouldShowEmptyState(false, true, 10)).toBe(false);
    console.log('[VERIFY] PASS — Background refetch with existing games does not trigger skeleton');
  });

  // ── Scenario 6: Sport switch (same mechanism as date switch) ──────────────
  it('[VERIFY] Sport switch: gamesLoading=false, gamesFetching=true, sortedDates=0 → show skeleton', () => {
    // [INPUT] gamesLoading=false, gamesFetching=true, sortedDates=0
    // [STATE] User switches from MLB to NHL; placeholder data from MLB filtered out (wrong sport)
    // [OUTPUT] shouldShowSkeleton=true → show skeleton during sport transition
    expect(shouldShowSkeleton(false, true, 0)).toBe(true);
    expect(shouldShowEmptyState(false, true, 0)).toBe(false);
    console.log('[VERIFY] PASS — Sport switch shows skeleton, not false empty state');
  });

  // ── Scenario 7: Pre-fix behavior (regression test) ────────────────────────
  it('[VERIFY] Pre-fix behavior would show empty state during date transition (regression proof)', () => {
    // [INPUT] gamesLoading=false, gamesFetching=true, sortedDates=0
    // [STATE] The bug scenario
    // [VERIFY] Pre-fix: (gamesLoading ? skeleton : sortedDates===0 ? empty) = (false ? skeleton : 0===0 ? empty) = EMPTY (BUG)
    const preFix_showSkeleton = (gamesLoading: boolean, sortedDatesLength: number): boolean => gamesLoading;
    const preFix_showEmpty = (gamesLoading: boolean, sortedDatesLength: number): boolean => !gamesLoading && sortedDatesLength === 0;
    expect(preFix_showSkeleton(false, 0)).toBe(false); // pre-fix: no skeleton
    expect(preFix_showEmpty(false, 0)).toBe(true);     // pre-fix: shows empty state (BUG)
    // Post-fix: skeleton shown instead
    expect(shouldShowSkeleton(false, true, 0)).toBe(true);  // post-fix: skeleton
    expect(shouldShowEmptyState(false, true, 0)).toBe(false); // post-fix: no empty state
    console.log('[VERIFY] PASS — Regression proof: pre-fix showed empty state, post-fix shows skeleton');
  });
});
