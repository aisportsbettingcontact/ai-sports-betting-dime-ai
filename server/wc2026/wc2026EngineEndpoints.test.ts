import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guards for the owner-triggered WC2026 model/audit/backfill endpoints that run
 * INSIDE Railway (where DATABASE_URL is valid), added because the GitHub-Actions
 * runner cannot reach the live TiDB cluster (empty DATABASE_URL secret / rotated
 * TARGET creds). Three things must stay wired together or a deploy silently loses
 * the ability to model the current matchday (now the Jul-15 SF):
 *   1. The three routes are registered.
 *   2. The active engine + audit engine + the audit's JSON ground-truth are copied
 *      into dist at build time (spawned by filename via __dirname, so they must
 *      sit next to dist/index.js in production — same lesson as bracket-sync).
 *   3. The spawned files exist to be copied.
 *
 * The active engine is swapped per matchday: v24 modeled the Jul-11 QFs, v25 the
 * Jul-14 SF (FRA vs ESP), v26 the Jul-15 SF (ENG vs ARG, wc26-sf-102). These
 * guards track v26.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const heartbeatSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "wc2026Heartbeat.ts"),
  "utf8",
);
const engineSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "v26_jul15_engine.mjs"),
  "utf8",
);
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const buildServer: string = pkg.scripts?.["build:server"] ?? "";

describe("WC2026 owner-triggered engine/audit/backfill endpoints", () => {
  it("registers the three owner-triggered routes", () => {
    expect(heartbeatSrc).toMatch(/app\.post\("\/api\/scheduled\/wc2026-engine",\s*handleWc2026Engine\)/);
    expect(heartbeatSrc).toMatch(/app\.post\("\/api\/scheduled\/wc2026-audit",\s*handleWc2026Audit\)/);
    expect(heartbeatSrc).toMatch(/app\.post\("\/api\/scheduled\/wc2026-espn-backfill",\s*handleWc2026EspnBackfill\)/);
  });

  it("guards every handler behind the cron secret", () => {
    for (const name of ["wc2026-engine", "wc2026-audit", "wc2026-espn-backfill"]) {
      expect(heartbeatSrc).toContain(`requireCronSecret(req, res, "${name}")`);
    }
  });

  it("spawns the active (v26) engine + audit .mjs by filename (resolved via __dirname)", () => {
    expect(heartbeatSrc).toMatch(/spawnMjs\("v26_jul15_engine\.mjs"/);
    expect(heartbeatSrc).toMatch(/spawnMjs\("wc2026AuditEngine\.mjs"/);
    expect(heartbeatSrc).toMatch(/join\(__dirname,\s*scriptFile\)/);
    // The retired v25 engine must no longer be the one spawned.
    expect(heartbeatSrc).not.toMatch(/spawnMjs\("v25_jul14_engine\.mjs"/);
  });

  it("build:server copies the active (v26) engine, audit engine, and the audit JSON into dist", () => {
    expect(buildServer).toContain("cp server/wc2026/v26_jul15_engine.mjs dist/v26_jul15_engine.mjs");
    expect(buildServer).toContain("cp server/wc2026/wc2026AuditEngine.mjs dist/wc2026AuditEngine.mjs");
    expect(buildServer).toContain("cp server/wc2026/groupStageGameIds.json dist/groupStageGameIds.json");
  });

  it("the spawned files exist to be copied", () => {
    for (const f of ["v26_jul15_engine.mjs", "wc2026AuditEngine.mjs", "groupStageGameIds.json"]) {
      expect(fs.existsSync(path.join(repoRoot, "server", "wc2026", f))).toBe(true);
    }
  });

  it("v26 engine targets the Jul-15 SF (ENG home vs ARG away, ESPN 760515)", () => {
    expect(engineSrc).toMatch(/fid:'wc26-sf-102',\s*home:'ENG',\s*away:'ARG',\s*espnId:'760515'/);
    expect(engineSrc).toMatch(/beId:'pKVyGJbD',\s*beSlug:'england-argentina'/);
    // No stale SF-101 targeting left behind from the v25 clone.
    expect(engineSrc).not.toMatch(/fid:'wc26-sf-101'/);
    expect(engineSrc).not.toMatch(/beId:'pU0PQ9nR'/);
  });

  it("refuses to run on an unfilled placeholder book (completeness + to-advance guards)", () => {
    // The six BetExplorer markets are hand-filled from wc-jul15-probe.yml and the
    // to-advance line is owner-provided; until then they are null and the
    // projection loop must hard-fail rather than model against a missing book.
    expect(engineSrc).toMatch(/BOOK COMPLETENESS GUARD/);
    expect(engineSrc).toMatch(/JUL15_BOOK not filled from probe/);
    expect(engineSrc).toMatch(/const missing = required\.filter\(k => book\[k\] == null\)/);
    expect(engineSrc).toMatch(/to-advance book lines missing/);
  });

  it("writes model Double Chance into wc2026_model_projections (feed reads DC from there, not wc2026MatchOdds)", () => {
    expect(engineSrc).toMatch(/dc_1x_odds,\s*dc_x2_odds,\s*no_draw_home_odds/);
    expect(engineSrc).toMatch(/dc_1x_odds=VALUES\(dc_1x_odds\)/);
    expect(engineSrc).toMatch(/markets\.mlHomeWD,\s*markets\.mlAwayWD,\s*markets\.mlNoDraw,\s*\n\s*markets\.spreadLine/);
  });

  it("leaves the SF venue untouched (venueCityLike null) — no unverified stadium hardcode", () => {
    expect(engineSrc).toMatch(/venueCityLike:null/);
    expect(engineSrc).toMatch(/SELECT venue_id, city FROM wc2026_venues WHERE LOWER\(city\) LIKE/);
    expect(engineSrc).toMatch(/UPDATE wc2026_matches SET venue_id = \? WHERE match_id = \?/);
  });

  it("has an orientation guard that hard-fails when the book favorite disagrees with the model favorite", () => {
    expect(engineSrc).toMatch(/ORIENTATION GUARD/);
    expect(engineSrc).toMatch(/const bookFav = book\.bookHomeMl <= book\.bookAwayMl/);
    expect(engineSrc).toMatch(/const modelFav = markets\.mlHome <= markets\.mlAway/);
    expect(engineSrc).toMatch(/bookFav !== modelFav && gap > 0\.08/);
    expect(engineSrc).toMatch(/likely home\/away flip; refusing to write/);
  });

  it("asserts the live wc2026_matches orientation (ENG home / ARG away) before writing", () => {
    expect(engineSrc).toMatch(/LIVE ORIENTATION ASSERTION/);
    expect(engineSrc).toMatch(/SELECT home_team_id, away_team_id FROM wc2026_matches WHERE match_id = \?/);
    expect(engineSrc).toMatch(/orientation flip; refusing to model\/write/);
  });

  it("buckets the SF on the PT kickoff-day (Jul 15) with the non-destructive match_date repair", () => {
    expect(engineSrc).toMatch(/seedDatePT:'2026-07-15'/);
    expect(engineSrc).toMatch(/UPDATE wc2026_matches SET match_date = \? WHERE match_id = \? AND DATE\(match_date\) <> \?/);
  });

  it("carries the owner-provided to-advance line (ENG -135 home / ARG +110 away)", () => {
    // BetExplorer has no to-advance market; these are owner-provided (bound to the
    // ENG home / ARG away orientation) and must not be null.
    expect(engineSrc).toMatch(/bookHomeAdv: -135, bookAwayAdv: 110/);
    expect(engineSrc).not.toMatch(/bookHomeAdv: null, bookAwayAdv: null/);
  });

  it("bracket scraper Phase D seeds match_date on the PT kickoff-day, not the UTC day", () => {
    const scraperSrc = fs.readFileSync(
      path.join(repoRoot, "server", "wc2026", "wc2026BracketScraper.mjs"),
      "utf8",
    );
    expect(scraperSrc).toMatch(/toLocaleDateString\("en-CA", \{ timeZone: "America\/Los_Angeles" \}\)/);
    expect(scraperSrc).not.toMatch(/const espnDateStr = espnDate\.toISOString\(\)\.slice\(0, 10\)/);
  });
});
