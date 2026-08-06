/**
 * useIsDesktop — Singleton matchMedia hook.
 *
 * WHY: GameCard.tsx currently creates a separate matchMedia('(min-width: 1024px)')
 * listener inside each card instance. With 15 MLB games, that's 15 listeners all
 * firing simultaneously on resize. This hook uses a module-level singleton so only
 * ONE listener ever exists regardless of how many cards are mounted.
 *
 * Tailwind lg breakpoint = 1024px.
 */
import { useState, useEffect } from "react";

const BREAKPOINT = 1024;

// Module-level singleton state — shared across all hook instances
let listeners: ((v: boolean) => void)[] = [];
let currentValue =
  typeof window !== "undefined" ? window.innerWidth >= BREAKPOINT : false;

if (typeof window !== "undefined") {
  const mql = window.matchMedia(`(min-width: ${BREAKPOINT}px)`);
  mql.addEventListener("change", e => {
    currentValue = e.matches;
    // Notify all mounted hook instances simultaneously
    listeners.forEach(fn => fn(currentValue));
  });
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(currentValue);

  useEffect(() => {
    // Sync to current value in case it changed between render and effect
    setIsDesktop(currentValue);
    listeners.push(setIsDesktop);
    return () => {
      listeners = listeners.filter(fn => fn !== setIsDesktop);
    };
  }, []);

  return isDesktop;
}
