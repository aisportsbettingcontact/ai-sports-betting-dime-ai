/**
 * harness.ts — CI perf harness.
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads a set of routes on the LIVE deployed app with a real headless Chromium,
 * measures load-time + weight metrics, and enforces perf budgets + a regression
 * guard against a committed baseline (perf/baseline.json). Fails (exit 1) on any
 * violation so a slow deploy is caught (daily run — not a merge-blocking check).
 *
 * Usage:
 *   PERF_TARGET_URL=https://your-app.up.railway.app npx tsx perf/harness.ts
 *   ... npx tsx perf/harness.ts --update-baseline   # write a reviewable candidate artifact
 *
 * Behind the Cloudflare edge, also set EDGE_AGENT_BYPASS_KEY: headless document-
 * route loads are otherwise 403'd by Super Bot Fight Mode, and the harness would
 * measure the block page. The key is presented as the x-dime-agent header,
 * host-scoped to the target origin so it never leaks to a third party; without it
 * a blocked route now fails loud (HTTP 4xx) instead of scoring a false green.
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
import { collectBrowserMetricsInPage } from "./browserMetrics";
import {
  evaluatePerfRun,
  type PerfSample,
  type PerfBudget,
} from "./regression";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(HERE, "baseline.json");
const RESULTS_PATH = path.join(HERE, "..", "perf-results.json");
const BASELINE_CANDIDATE_PATH = path.join(
  HERE,
  "..",
  "perf-baseline-candidate.json"
);

/** Routes to measure. Keep small — each adds ~a few s of CI wall-clock. */
const ROUTES = ["/", "/landingpage-v2", "/checkout?plan=monthly"];

/** Trusted-agent bypass for the armed Cloudflare edge (see collectRoute). */
type AgentBypass = { key: string; origin: string };

function log(line: string): void {
  console.log(line);
}

async function collectRoute(
  browser: Browser,
  base: string,
  route: string,
  agent?: AgentBypass
): Promise<PerfSample> {
  const url = `${base.replace(/\/$/, "")}${route}`;
  log(`[INPUT] measuring ${url}`);
  const context = await browser.newContext();
  if (agent) {
    // Host-scoped trusted-agent bypass. The production Cloudflare edge (Super Bot
    // Fight Mode "definitely automated → Block") 403s headless traffic on document
    // routes; presenting EDGE_AGENT_BYPASS_KEY as the x-dime-agent header is waved
    // through by the "Trusted agent bypass" WAF rule. Scope the header to the
    // target origin ONLY so the secret never leaks to a third party (e.g.
    // js.stripe.com, loaded by /checkout). Mirrors scripts/dime-production-auth.mjs.
    // No key → no interception → the local/baseline path is unchanged.
    await context.route("**/*", async r => {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(r.request().url()).origin === agent.origin;
      } catch {
        /* non-URL request target — leave unmodified */
      }
      await r.continue(
        sameOrigin
          ? { headers: { ...r.request().headers(), "x-dime-agent": agent.key } }
          : undefined
      );
    });
  }
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: "load",
      timeout: 45_000,
    });
    // Never silently score a non-page response. Behind the armed edge a missing or
    // wrong key yields a 403 bot-block page that still fires `load` and measures
    // tiny + fast — a false-green perf pass that blinds this monitor. Fail loud on
    // any 4xx/5xx instead of measuring the block page.
    const status = response?.status();
    if (status !== undefined && status >= 400) {
      throw new Error(
        `${route} returned HTTP ${status} — refusing to measure a non-page ` +
          `response (likely a Cloudflare bot-block). Set EDGE_AGENT_BYPASS_KEY so ` +
          `the harness presents x-dime-agent and measures the app, not the block page.`
      );
    }
    // Give LCP a moment to settle after load, then read buffered entries.
    await page.waitForTimeout(1500);

    // Serialized into the page — must stay browser-safe; see perf/browserMetrics.ts.
    const metrics = await page.evaluate(collectBrowserMetricsInPage);

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
    log(
      `[VERIFY] GET /health → HTTP ${res.status} in ${Date.now() - started}ms`
    );
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

  // Optional trusted-agent bypass for the armed Cloudflare edge (see collectRoute):
  // present EDGE_AGENT_BYPASS_KEY as x-dime-agent, host-scoped to the target origin.
  const agentKey = (process.env.EDGE_AGENT_BYPASS_KEY ?? "").trim();
  let agent: AgentBypass | undefined;
  if (agentKey) {
    try {
      agent = { key: agentKey, origin: new URL(base).origin };
      log(
        `[STEP] trusted-agent bypass enabled (x-dime-agent, host-scoped to ${agent.origin})`
      );
    } catch {
      log(
        "[STEP] EDGE_AGENT_BYPASS_KEY set but PERF_TARGET_URL is not a valid URL — bypass disabled"
      );
    }
  }
  log(`[STEP] launching headless Chromium against ${base}`);

  const config = loadBaseline();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const samples: PerfSample[] = [];
  try {
    await probeHealth(base);
    for (const route of ROUTES) {
      try {
        samples.push(await collectRoute(browser, base, route, agent));
      } catch (err) {
        log(`[FAIL] could not measure ${route}: ${(err as Error).message}`);
        throw err;
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    RESULTS_PATH,
    JSON.stringify({ target: base, samples }, null, 2)
  );
  log(`[STEP] wrote raw metrics → ${RESULTS_PATH}`);

  if (updateBaseline) {
    const nextBaseline: Record<string, Record<string, number>> = {};
    for (const s of samples) nextBaseline[s.route] = s.metrics;
    const updated: PerfBudget = { ...config, baseline: nextBaseline };
    writeFileSync(
      BASELINE_CANDIDATE_PATH,
      JSON.stringify(updated, null, 2) + "\n"
    );
    log(
      `[OUTPUT] baseline candidate generated → ${BASELINE_CANDIDATE_PATH} ` +
        `(committed baseline unchanged)`
    );
    return;
  }

  const evaluation = evaluatePerfRun(samples, config);
  log(
    `[STEP] evaluated ${evaluation.checked} metric gates across ${samples.length} routes`
  );
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

main().catch(err => {
  log(`[FAIL] perf harness crashed: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
