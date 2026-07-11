import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guard for the WC2026 bracket-sync ESM defect.
 *
 * Defect (P0, WC feed blocker): the production server is bundled by esbuild with
 * --format=esm, where the CommonJS `__dirname` global is undefined. The
 * bracket-sync handler used `join(__dirname, "wc2026BracketScraper.mjs")`, so
 * every POST /api/scheduled/wc2026-bracket-sync threw
 * `ReferenceError: __dirname is not defined` (HTTP 500). R16 winners therefore
 * never propagated into the QF/SF/Final slots, leaving knockout `home_team_id`/
 * `away_team_id` as "tbd" on the feed. Two things had to be fixed:
 *   1. Derive __dirname from import.meta.url (ESM-safe).
 *   2. Copy the standalone scraper .mjs into dist at build time (it was never
 *      copied, so even with __dirname fixed the spawn would ENOENT in prod).
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const heartbeatSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "wc2026Heartbeat.ts"),
  "utf8",
);
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

describe("WC2026 bracket-sync ESM safety", () => {
  it("derives __dirname from import.meta.url (ESM-safe)", () => {
    expect(heartbeatSrc).toMatch(/fileURLToPath\(import\.meta\.url\)/);
    expect(heartbeatSrc).toMatch(/const __dirname\s*=\s*dirname\(fileURLToPath\(import\.meta\.url\)\)/);
  });

  it("still spawns the bracket scraper by filename (path resolved via __dirname)", () => {
    expect(heartbeatSrc).toMatch(/join\(__dirname,\s*"wc2026BracketScraper\.mjs"\)/);
  });

  it("build:server copies the bracket scraper into dist", () => {
    const buildServer = pkg.scripts?.["build:server"] ?? "";
    expect(buildServer).toContain(
      "cp server/wc2026/wc2026BracketScraper.mjs dist/wc2026BracketScraper.mjs",
    );
  });

  it("the bracket scraper file exists to be copied", () => {
    expect(
      fs.existsSync(path.join(repoRoot, "server", "wc2026", "wc2026BracketScraper.mjs")),
    ).toBe(true);
  });
});
