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

export async function collectBrowserMetricsInPage(): Promise<CollectedMetrics> {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes.includes(
      "largest-contentful-paint"
    )
  ) {
    throw new Error(
      "PERF_LCP_UNSUPPORTED: largest-contentful-paint is unavailable"
    );
  }

  let lcpMs = 0;
  await new Promise<void>(resolve => {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        lcpMs = Math.max(1, Math.round(entry.startTime));
      }
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });

    // Buffered entries are delivered asynchronously. Drain anything still
    // queued before disconnecting so a late callback cannot become a false 0.
    setTimeout(() => {
      for (const entry of observer.takeRecords()) {
        lcpMs = Math.max(1, Math.round(entry.startTime));
      }
      observer.disconnect();
      resolve();
    }, 250);
  });

  if (!Number.isFinite(lcpMs) || lcpMs <= 0) {
    throw new Error(
      "PERF_LCP_MISSING: no valid largest-contentful-paint candidate"
    );
  }

  const nav = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  const paints = performance.getEntriesByType("paint");
  const fcp = paints.find(p => p.name === "first-contentful-paint");
  const resources = performance.getEntriesByType(
    "resource"
  ) as PerformanceResourceTiming[];
  const resourceBytes = resources.reduce(
    (sum, r) => sum + (r.transferSize || 0),
    0
  );
  const navBytes = nav?.transferSize || 0;

  return {
    ttfbMs: Math.round(nav ? nav.responseStart - nav.requestStart : 0),
    domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
    loadMs: Math.round(nav?.loadEventEnd ?? 0),
    fcpMs: Math.round(fcp?.startTime ?? 0),
    lcpMs,
    transferBytes: navBytes + resourceBytes,
  };
}
