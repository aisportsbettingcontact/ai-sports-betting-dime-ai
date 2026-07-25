/**
 * browserMetrics.ts — the code the perf harness runs INSIDE the page.
 *
 * Playwright serializes `collectBrowserMetricsInPage` with Function.toString()
 * and evals it in the browser, so everything here must survive that round trip
 * as standalone browser-safe JS:
 *
 *   - browser globals only (`performance`), no references to module scope;
 *   - no name-inferred inner function expressions (`const f = () => …`) — the
 *     tsx/esbuild transform wraps those in a host-only `__name()` helper that
 *     does not exist in the page, which is exactly the ReferenceError that
 *     crashed every harness run from 2026-07-10 to 2026-07-25 before a single
 *     metric was collected.
 *
 * perf/harness.smoke.test.ts locks this in: it serializes this function through
 * the same tsx transform CI uses and rejects any host-helper reference.
 */

export interface CollectedMetrics {
  ttfbMs: number;
  domContentLoaded: number;
  loadMs: number;
  fcpMs: number;
  lcpMs: number;
  transferBytes: number;
}

export function collectBrowserMetricsInPage(): CollectedMetrics {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const paints = performance.getEntriesByType("paint");
  const fcp = paints.find((p) => p.name === "first-contentful-paint");
  const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
  const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1] : undefined;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const resourceBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
  const navBytes = nav?.transferSize || 0;

  return {
    ttfbMs: Math.round(nav ? nav.responseStart - nav.requestStart : 0),
    domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
    loadMs: Math.round(nav?.loadEventEnd ?? 0),
    fcpMs: Math.round(fcp?.startTime ?? 0),
    lcpMs: Math.round(lcp?.startTime ?? 0),
    transferBytes: navBytes + resourceBytes,
  };
}
