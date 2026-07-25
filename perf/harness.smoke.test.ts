/**
 * harness.smoke.test.ts — regression lock for the browser-evaluation defect
 * that crashed every retained perf-harness run from 2026-07-10 to 2026-07-25
 * (`ReferenceError: __name is not defined`) before a single metric was
 * collected.
 *
 * [VERIFY] 1) the page.evaluate payload serializes to standalone browser-safe
 *             JS under the same tsx/esbuild transform CI uses — no host-only
 *             esbuild helper (`__name(...)`) may appear in the serialized body;
 *          2) a full harness run through the exact CI entrypoint
 *             (`tsx perf/harness.ts`) collects real metrics against a local
 *             page and exits 0;
 *          3) a harness run that cannot measure still exits nonzero — repair
 *             must not convert failures into false successes.
 *
 * Tests 2–3 need the Playwright chromium binary. The CI vitest job does not
 * install browsers (only perf-harness.yml does), so they skip there — declared
 * in vitest.environment-failure-allowlist.json expectedCiSkips. Run locally
 * with: pnpm exec playwright install chromium
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

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const HARNESS = path.join(HERE, "harness.ts");
const RESULTS_PATH = path.join(REPO_ROOT, "perf-results.json");

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
          "<!doctype html><html><head><title>perf probe</title></head>" +
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
        }
      },
      120_000
    );

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
