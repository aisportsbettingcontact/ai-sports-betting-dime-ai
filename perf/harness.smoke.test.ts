/**
 * harness.smoke.test.ts — regression lock for the browser-evaluation defect
 * that crashed every retained perf-harness run from 2026-07-10 to 2026-07-25
 * (`ReferenceError: __name is not defined`) before a single metric was
 * collected.
 *
 * [VERIFY] 1) the page.evaluate payload remains standalone under CI's actual
 *             tsx transform, with buffered PerformanceObserver LCP collection;
 *          2) the exact harness entrypoint collects positive LCP metrics;
 *          3) unsupported or missing LCP fails instead of becoming a false 0;
 *          4) baseline mode writes a reviewable candidate without mutating the
 *             committed baseline;
 *          5) route collection failures still exit nonzero.
 *
 * The required Vitest CI job and perf-harness workflow both install Chromium,
 * so every test below executes in GitHub. Local prerequisite:
 * pnpm exec playwright install chromium
 */

import { execFile } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { promisify } from "util";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBrowserMetricsInPage } from "./browserMetrics";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const HARNESS = path.join(HERE, "harness.ts");
const BASELINE_PATH = path.join(HERE, "baseline.json");
const RESULTS_PATH = path.join(REPO_ROOT, "perf-results.json");
const BASELINE_CANDIDATE_PATH = path.join(REPO_ROOT, "perf-baseline-candidate.json");

let chromiumAvailable = false;
try {
  chromiumAvailable = existsSync(chromium.executablePath());
} catch {
  chromiumAvailable = false;
}

describe("perf harness browser evaluation", () => {
  it(
    "page.evaluate payload serializes without host-only esbuild helpers under the CI tsx transform",
    async () => {
      // Spawn real tsx (the CI runtime) on a fixture that serializes the
      // browser callback exactly the way Playwright does (Function.toString).
      const dir = mkdtempSync(path.join(tmpdir(), "perf-serialize-"));
      const fixture = path.join(dir, "serialize-probe.ts");
      const browserMetricsUrl = pathToFileURL(path.join(HERE, "browserMetrics.ts")).href;
      writeFileSync(
        fixture,
        `import { collectBrowserMetricsInPage } from ${JSON.stringify(browserMetricsUrl)};\n` +
          `process.stdout.write(collectBrowserMetricsInPage.toString());\n`
      );
      try {
        const { stdout } = await execFileAsync(TSX_BIN, [fixture], { cwd: REPO_ROOT });
        // The exact defect: tsx keepNames wraps name-inferred inner function
        // expressions in __name(), which does not exist in the page.
        expect(stdout).not.toContain("__name");
        // No esbuild host helper of any kind may ride along.
        expect(stdout).not.toMatch(/__[a-zA-Z]+\s*\(/);
        // Sanity: it is still the real metrics collector.
        expect(stdout).toContain('performance.getEntriesByType("navigation")');
        expect(stdout).toContain("PerformanceObserver");
        expect(stdout).toContain("largest-contentful-paint");
        expect(stdout).toMatch(/buffered\s*:\s*true/);
        expect(stdout).toContain("transferBytes");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000
  );
});

describe.skipIf(!chromiumAvailable)(
  "perf harness end-to-end (requires Playwright chromium: pnpm exec playwright install chromium)",
  () => {
    let server: Server;
    let base = "";

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          "<!doctype html><html><head><title>perf probe</title>" +
            "<style>h1{font:700 48px sans-serif}</style></head>" +
            "<body><h1>perf harness smoke fixture</h1></body></html>"
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no server port");
      base = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (existsSync(RESULTS_PATH)) unlinkSync(RESULTS_PATH);
      if (existsSync(BASELINE_CANDIDATE_PATH)) unlinkSync(BASELINE_CANDIDATE_PATH);
    });

    it(
      "collects metrics for every route and exits 0 through the CI entrypoint",
      async () => {
        const { stdout } = await execFileAsync(TSX_BIN, [HARNESS], {
          cwd: REPO_ROOT,
          env: { ...process.env, PERF_TARGET_URL: base },
        });
        // The formerly failing evaluation must now execute and produce numbers.
        expect(stdout).not.toContain("__name is not defined");
        expect(stdout).toContain("[OUTPUT] / ttfb=");
        expect(stdout).toContain("[VERIFY] PASS");

        const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as {
          samples: Array<{ route: string; metrics: Record<string, number> }>;
        };
        expect(results.samples).toHaveLength(3);
        for (const sample of results.samples) {
          expect(typeof sample.metrics.ttfbMs).toBe("number");
          // A real navigation always produces a positive DCL timestamp.
          expect(sample.metrics.domContentLoaded).toBeGreaterThan(0);
          // The fixture has an obvious contentful heading. Reporting zero
          // would silently bypass the LCP budget instead of measuring it.
          expect(sample.metrics.lcpMs).toBeGreaterThan(0);
        }
      },
      120_000
    );

    it("fails clearly when the browser does not support LCP observation", async () => {
      const browser = await chromium.launch({ args: ["--no-sandbox"] });
      const page = await browser.newPage();
      try {
        await page.addInitScript({
          content:
            'Object.defineProperty(PerformanceObserver, "supportedEntryTypes", { value: [] });',
        });
        await page.goto("data:text/html,<h1>unsupported LCP fixture</h1>");
        await expect(
          page.evaluate(collectBrowserMetricsInPage)
        ).rejects.toThrow("PERF_LCP_UNSUPPORTED");
      } finally {
        await browser.close();
      }
    }, 30_000);

    it("fails clearly when a page produces no LCP candidate", async () => {
      const browser = await chromium.launch({ args: ["--no-sandbox"] });
      const page = await browser.newPage();
      try {
        await page.goto("about:blank");
        await expect(
          page.evaluate(collectBrowserMetricsInPage)
        ).rejects.toThrow("PERF_LCP_MISSING");
      } finally {
        await browser.close();
      }
    }, 30_000);

    it("writes a reviewable baseline candidate without modifying the committed baseline", async () => {
      const originalBaseline = readFileSync(BASELINE_PATH, "utf8");
      if (existsSync(BASELINE_CANDIDATE_PATH))
        unlinkSync(BASELINE_CANDIDATE_PATH);
      try {
        const { stdout } = await execFileAsync(
          TSX_BIN,
          [HARNESS, "--update-baseline"],
          {
            cwd: REPO_ROOT,
            env: { ...process.env, PERF_TARGET_URL: base },
          }
        );

        expect(readFileSync(BASELINE_PATH, "utf8")).toBe(originalBaseline);
        expect(existsSync(BASELINE_CANDIDATE_PATH)).toBe(true);
        expect(stdout).toContain("[OUTPUT] baseline candidate generated");

        const candidate = JSON.parse(
          readFileSync(BASELINE_CANDIDATE_PATH, "utf8")
        ) as {
          baseline: Record<string, Record<string, number>>;
        };
        expect(Object.keys(candidate.baseline).sort()).toEqual([
          "/",
          "/checkout?plan=monthly",
          "/landingpage-v2",
        ]);
        for (const metrics of Object.values(candidate.baseline)) {
          expect(metrics.lcpMs).toBeGreaterThan(0);
        }
      } finally {
        writeFileSync(BASELINE_PATH, originalBaseline);
        if (existsSync(BASELINE_CANDIDATE_PATH))
          unlinkSync(BASELINE_CANDIDATE_PATH);
        if (existsSync(RESULTS_PATH)) unlinkSync(RESULTS_PATH);
      }
    }, 120_000);

    it(
      "still exits nonzero when a route cannot be measured",
      async () => {
        // Port 1 refuses immediately: navigation fails, the harness must fail.
        const run = execFileAsync(TSX_BIN, [HARNESS], {
          cwd: REPO_ROOT,
          env: { ...process.env, PERF_TARGET_URL: "http://127.0.0.1:1" },
        });
        await expect(run).rejects.toMatchObject({ code: 1 });
        const err = (await run.catch((e) => e)) as { stdout?: string };
        expect(err.stdout ?? "").toContain("[FAIL] could not measure");
      },
      120_000
    );
  }
);
