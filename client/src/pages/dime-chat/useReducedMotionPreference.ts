import { useEffect, useState } from "react";

/**
 * `prefers-reduced-motion: reduce` — the same media query framer-motion's
 * `useReducedMotion()` hook read internally. Pulled local (PR #70
 * bundle-budget remediation) so the /chat critical path no longer needs to
 * import framer-motion at all; the dependency stays for other, lazily-loaded
 * pages (GameCard, ModelProjections, Subscribe*).
 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Pure: resolves a MediaQueryList (or its absence) to a boolean preference. */
export function resolveReducedMotionPreference(
  mql: Pick<MediaQueryList, "matches"> | null | undefined
): boolean {
  return !!mql?.matches;
}

function getReducedMotionMediaQueryList(): MediaQueryList | null {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

/** Live `prefers-reduced-motion: reduce` preference; updates on OS change. */
export function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(() =>
    resolveReducedMotionPreference(getReducedMotionMediaQueryList())
  );

  useEffect(() => {
    const mql = getReducedMotionMediaQueryList();
    if (!mql) return;
    setReduced(resolveReducedMotionPreference(mql));
    const onChange = (event: MediaQueryListEvent) =>
      setReduced(resolveReducedMotionPreference(event));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
