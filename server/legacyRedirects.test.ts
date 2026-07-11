import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guards for the 2026-07-11 navigation reconstruction
 * (docs/plans/2026-07-11-navigation-reconstruction.md).
 *
 * Protected properties:
 *   1. ERADICATION — no client link/redirect may emit the legacy slugs
 *      (/feed, /feed?tab=…, /splits, /projections, /dashboard).
 *   2. PERMANENCE — the server issues real HTTP 308s for full-page loads of
 *      the legacy slugs, and App.tsx redirects SPA navigations.
 *   3. CANONICAL ROUTES — /feed/model/:sport(-date) and /betting-splits/:sport
 *      stay registered behind RequireAuth.
 */

const read = (...segs: string[]) =>
  fs.readFileSync(path.join(import.meta.dirname, ...segs), "utf8");

const serverSrc = read("_core", "index.ts");
const appSrc = read("..", "client", "src", "App.tsx");
const configSrc = read("..", "client", "src", "features", "mobileOwnerTabs", "config.ts");
const tabsSrc = read("..", "client", "src", "features", "mobileOwnerTabs", "MobileOwnerBottomTabs.tsx");
const homeSrc = read("..", "client", "src", "pages", "Home.tsx");

describe("Legacy slug eradication — server 308 layer", () => {
  it("registers the 308 handler for all four legacy slugs", () => {
    expect(serverSrc).toMatch(
      /app\.get\(\["\/feed", "\/splits", "\/projections", "\/dashboard"\]/,
    );
    expect(serverSrc).toMatch(/res\.redirect\(308, target\)/);
  });

  it("maps /splits and ?tab=splits to /betting-splits/MLB", () => {
    expect(serverSrc).toMatch(/req\.path === "\/splits" \|\| tab === "splits"/);
    expect(serverSrc).toMatch(/target = "\/betting-splits\/MLB"/);
  });

  it("maps everything else to the dated canonical feed slug", () => {
    expect(serverSrc).toMatch(/target = `\/feed\/model\/\$\{sport\}-\$\{slugDate\}`/);
  });

  it("uses the 07:00 UTC (00:00 PT) feed rollover for the default date", () => {
    expect(serverSrc).toMatch(/const FEED_CUTOFF_UTC_HOUR = 7;/);
  });
});

describe("Legacy slug eradication — client router", () => {
  it("App.tsx no longer routes ModelProjections or SplitsLive", () => {
    expect(appSrc).not.toMatch(/ModelProjections/);
    expect(appSrc).not.toMatch(/SplitsLive/);
  });

  it("legacy slugs are wouter Redirects into the canonical helpers", () => {
    expect(appSrc).toMatch(
      /path="\/feed">\{\(\) => <Redirect to=\{legacyFeedRedirectTarget\(window\.location\.search\)\} replace \/>/,
    );
    expect(appSrc).toMatch(/path="\/splits">\{\(\) => <Redirect to=\{bettingSplitsPath\("MLB"\)\} replace \/>/);
    expect(appSrc).toMatch(/path="\/dashboard">\{\(\) => <Redirect to=\{feedModelPath\("MLB"\)\} replace \/>/);
    expect(appSrc).toMatch(/path="\/projections">\{\(\) => <Redirect to=\{feedModelPath\("MLB"\)\} replace \/>/);
  });

  it("canonical routes stay registered behind RequireAuth", () => {
    expect(appSrc).toMatch(/path="\/feed\/model\/:sport\/:date"/);
    expect(appSrc).toMatch(/path="\/feed\/model\/:sport"/);
    expect(appSrc).toMatch(/path="\/betting-splits\/:sport"/);
    expect(appSrc).toMatch(/<RequireAuth><BettingSplits initialSport=\{sport\} \/><\/RequireAuth>/);
  });

  it("RootRoute lands authenticated users on the canonical feed", () => {
    expect(appSrc).toMatch(/const target = feedModelPath\("MLB"\)/);
    expect(appSrc).not.toMatch(/navigate\("\/splits"\)/);
  });
});

describe("Legacy slug eradication — navigation hooks", () => {
  it("mobile tab config carries no query-string hooks", () => {
    expect(configSrc).not.toMatch(/\?tab=/);
    expect(configSrc).toMatch(/"\/feed\/model\/mlb"/);
    expect(configSrc).toMatch(/"\/betting-splits\/MLB"/);
    expect(configSrc).toMatch(/"\/m\/props"/);
  });

  it("bottom tabs never fall back to full-page query navigation", () => {
    expect(tabsSrc).not.toMatch(/window\.location\.href = path/);
    expect(tabsSrc).not.toMatch(/tab\.path\.includes\("\?"\)/);
  });

  it("login returnPath defaults to the canonical feed, not /splits", () => {
    expect(homeSrc).toMatch(/returnPath"\) \?\? "\/feed\/model\/mlb"/);
    expect(homeSrc).not.toMatch(/\?\? "\/splits"/);
  });
});
