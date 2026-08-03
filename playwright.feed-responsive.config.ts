import { defineConfig, devices } from "@playwright/test";

/**
 * AI Model Projections feed — browser-engine parity gate.
 *
 * This configuration is intentionally separate from playwright.config.ts.
 * The global configuration remains Chromium-only because it contains unrelated
 * DOM-identity tests whose execution contract is single-browser and
 * single-worker. This file scopes Firefox and WebKit coverage exclusively to
 * e2e/feed-responsive.spec.ts and its production-build layout contracts.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "feed-responsive.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "playwright-report/feed-responsive-cross-browser",
        open: "never",
      },
    ],
  ],
  outputDir: "test-results/feed-responsive-cross-browser",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The spec fronts the built app server with a per-run self-signed TLS
    // proxy so the CSP `upgrade-insecure-requests` directive behaves exactly
    // as it does on the production origin in every engine (WebKit upgrades
    // loopback subresources; Chromium/Firefox exempt them). Trust that cert.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
