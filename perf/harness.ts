/**
 * harness.ts — CI perf harness.
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads a set of routes on the LIVE deployed app with a real headless Chromium,
 * measures load-time + weight metrics, and enforces perf budgets + a regression
 * guard against a committed baseline (perf/baseline.json). Fails (exit 1) on any
 * violation so a slow deploy can't merge silently.
 *
 * Usage:
 *   PERF_TARGET_URL=https://your-app.up.railway.app npx tsx perf/harness.ts
 *   ... npx tsx perf/harness.ts --update-baseline   # reseed baseline from this run
 *
 * Metrics per route (lower is better):
 *   ttfbMs            responseStart − requestStart (server + network)
 *   domContentLoaded  DCL relative to navigation start
 *   loadMs            load event relative to navigation start
 *   fcpMs             first-contentful-paint
 *   lcpMs             largest-contentful-paint (buffered observer)
 *   transferBytes     Σ transferSize of the navigation + all resources
 *
 * Also probes GET /health for status + latency (informational; not budgeted so a
 * DB circuit-breaker flap doesn't fail the perf gate — that's a separate concern).
 *
 * Logging follows the house [INPUT]/[STEP]/[OUTPUT]/[VERIFY] convention.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { chromium, type Browser } from "playwright";
import { evaluatePerfRun, type PerfSample, type PerfBudget } from "./regression";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(HERE, "baseline.json");
const RESULTS_PATH = path.join(HERE, "..", "perf-results.json");

/** Routes to measure. Keep small — each adds ~a few s of CI wall-clock. */
const ROUTES = ["/", "/landingpage-v2", "/checkout?plan=monthly"];

interface CollectedMetrics {
  ttfbMs: number;
  domContentLoaded: number;
  loadMs: number;
  fcpMs: number;
  lcpMs: number;
  transferBytes: number;
}

function log(line: string): void {
  console.log(line);
}

async function collectRoute(browser: Browser, base: string, route: string): Promise<PerfSample> {
  const url = `${base.replace(/\/$/, "")}${route}`;
  log(`[INPUT] measuring ${url}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    // Give LCP a moment to settle after load, then read buffered entries.
    await page.waitForTimeout(1500);

    const metrics = await page.evaluate<CollectedMetrics>(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((p) => p.name === "first-contentful-paint");
      const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
      const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1] : undefined;
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const resourceBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
      const navBytes = nav?.transferSize || 0;

      const round = (n: number | undefined) => (typeof n === "number" ? Math.round(n) : 0);
      return {
        ttfbMs: round(nav ? nav.responseStart - nav.requestStart : 0),
        domContentLoaded: round(nav?.domContentLoadedEventEnd),
        loadMs: round(nav?.loadEventEnd),
        fcpMs: round(fcp?.startTime),
        lcpMs: round(lcp?.startTime),
        transferBytes: navBytes + resourceBytes,
      };
    });

    log(
      `[OUTPUT] ${route} ttfb=${metrics.ttfbMs}ms dcl=${metrics.domContentLoaded}ms ` +
      `load=${metrics.loadMs}ms fcp=${metrics.fcpMs}ms lcp=${metrics.lcpMs}ms ` +
      `weight=${(metrics.transferBytes / 1024).toFixed(0)}KB`
    );
    return { route, metrics: metrics as unknown as Record<string, number> };
  } finally {
    await context.close();
  }
}

async function probeHealth(base: string): Promise<void> {
  const url = `${base.replace(/\/$/, "")}/health`;
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    log(`[VERIFY] GET /health → HTTP ${res.status} in ${Date.now() - started}ms`);
  } catch (err) {
    log(`[VERIFY] GET /health → ERROR ${(err as Error).message}`);
  }
}

function loadBaseline(): PerfBudget {
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as PerfBudget;
  return raw;
}

async function main(): Promise<void> {
  const base = process.env.PERF_TARGET_URL;
  const updateBaseline = process.argv.includes("--update-baseline");

  if (!base) {
    log("[FAIL] PERF_TARGET_URL is not set");
    process.exit(2);
  }
  log(`[STEP] launching headless Chromium against ${base}`);

  const config = loadBaseline();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const samples: PerfSample[] = [];
  try {
    await probeHealth(base);
    for (const route of ROUTES) {
      try {
        samples.push(await collectRoute(browser, base, route));
      } catch (err) {
        log(`[FAIL] could not measure ${route}: ${(err as Error).message}`);
        throw err;
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(RESULTS_PATH, JSON.stringify({ target: base, samples }, null, 2));
  log(`[STEP] wrote raw metrics → ${RESULTS_PATH}`);

  if (updateBaseline) {
    const nextBaseline: Record<string, Record<string, number>> = {};
    for (const s of samples) nextBaseline[s.route] = s.metrics;
    const updated: PerfBudget = { ...config, baseline: nextBaseline };
    writeFileSync(BASELINE_PATH, JSON.stringify(updated, null, 2) + "\n");
    log(`[OUTPUT] baseline reseeded from this run → ${BASELINE_PATH}`);
    return;
  }

  const evaluation = evaluatePerfRun(samples, config);
  log(`[STEP] evaluated ${evaluation.checked} metric gates across ${samples.length} routes`);
  if (evaluation.pass) {
    log(`[VERIFY] PASS — all routes within budget and regression tolerance`);
    return;
  }
  log(`[VERIFY] FAIL — ${evaluation.violations.length} violation(s):`);
  for (const v of evaluation.violations) {
    log(`  ✗ [${v.kind}] ${v.message}`);
  }
  process.exit(1);
}

main().catch((err) => {
  log(`[FAIL] perf harness crashed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
