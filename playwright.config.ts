import { defineConfig, devices } from "@playwright/test";

/**
 * PR #70 remediation — Task 2 (chat mount stability across the 768px shell
 * boundary). Chromium only, single worker: this spec asserts DOM node
 * *identity* (element handles staying connected) across viewport resizes,
 * which must not race against other tests or browsers.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5199",
    trace: "retain-on-failure",
    // Sandboxed environments (e.g. Claude Code on the web) ship a system
    // chromium instead of the per-version Playwright download. Point
    // PW_CHROMIUM_PATH at it to skip `playwright install`; unset = default.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Invoke vite's binary directly: `pnpm exec` re-runs pnpm's
    // packageManager version check, which fails under a newer global pnpm
    // than package.json pins and kills the web server before it starts.
    command: "node node_modules/vite/bin/vite.js dev --port 5199 --strictPort",
    port: 5199,
    reuseExistingServer: true,
  },
});
