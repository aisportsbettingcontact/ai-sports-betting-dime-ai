/**
 * The 2026-07-31 stale-chunk incident: the SPA catch-all answered a missing
 * /assets/*.js with 200 text/html, so browsers parsed HTML as an ES module and
 * threw "Failed to fetch dynamically imported module". These are source-contract
 * assertions (the repo's convention for wiring that would otherwise need a live
 * server) proving the catch-all now distinguishes build assets from SPA routes.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(path.resolve(__dirname, "_core/vite.ts"), "utf8");

describe("static asset fallback", () => {
  it("[SA-1] the catch-all 404s build assets instead of serving index.html", () => {
    expect(SRC).toMatch(/BUILD_ASSET_PATH/);
    expect(SRC).toMatch(/res\.status\(404\)/);
  });

  it("[SA-2] the asset test covers /assets/ and hashed script extensions", () => {
    const assetRe = SRC.match(/const BUILD_ASSET_PATH = (\/.*\/);/)?.[1];
    const extRe = SRC.match(/const STATIC_FILE_EXT = (\/.*\/i);/)?.[1];
    expect(assetRe, "BUILD_ASSET_PATH literal").toBeTruthy();
    expect(extRe, "STATIC_FILE_EXT literal").toBeTruthy();
    // eslint-disable-next-line no-eval
    const asset = eval(assetRe!) as RegExp;
    // eslint-disable-next-line no-eval
    const ext = eval(extRe!) as RegExp;
    // The exact path from the incident.
    expect(asset.test("/assets/Home-BjN98xuQ.js")).toBe(true);
    expect(ext.test("/assets/Home-BjN98xuQ.js")).toBe(true);
    for (const p of [
      "/assets/index-abc123.css",
      "/logo.svg",
      "/fonts/x.woff2",
      "/sw.js",
    ])
      expect(asset.test(p) || ext.test(p), p).toBe(true);
    // SPA routes must still boot the shell — a 404 here would break deep links.
    for (const p of [
      "/admin/users",
      "/login",
      "/checkout",
      "/",
      "/subscribe/success",
    ])
      expect(asset.test(p) || ext.test(p), p).toBe(false);
  });

  it("[SA-3] SPA routes still receive the no-store shell", () => {
    expect(SRC).toMatch(
      /res\.set\(\{ \.\.\.NO_CACHE_HEADERS \}\);[\s\S]{0,120}sendFile/
    );
  });
});
