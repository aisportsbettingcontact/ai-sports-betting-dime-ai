import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guards for the owner-triggered WC2026 model/audit/backfill endpoints that run
 * INSIDE Railway (where DATABASE_URL is valid), added because the GitHub-Actions
 * runner cannot reach the live TiDB cluster (empty DATABASE_URL secret / rotated
 * TARGET creds). Three things must stay wired together or a deploy silently loses
 * the ability to model the current matchday (now the Jul-18 3rd-place match +
 * Jul-19 Final):
 *   1. The three routes are registered.
 *   2. The active engine + audit engine + the audit's JSON ground-truth are copied
 *      into dist at build time (spawned by filename via __dirname, so they must
 *      sit next to dist/index.js in production — same lesson as bracket-sync).
 *   3. The spawned files exist to be copied.
 *
 * The active engine is swapped per matchday: v24 modeled the Jul-11 QFs, v25 the
 * Jul-14 SF (FRA vs ESP), v26 the Jul-15 SF (ENG vs ARG), v27 the Jul-18/19
 * 3rd-place (FRA vs ENG, wc26-3rd-103) + Final (ESP vs ARG, wc26-final-104).
 * These guards track v27.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const heartbeatSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "wc2026Heartbeat.ts"),
  "utf8",
);
const engineSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "v27_jul18_engine.mjs"),
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

  it("spawns the active (v27) engine + audit .mjs by filename (resolved via __dirname)", () => {
    expect(heartbeatSrc).toMatch(/spawnMjs\("v27_jul18_engine\.mjs"/);
    expect(heartbeatSrc).toMatch(/spawnMjs\("wc2026AuditEngine\.mjs"/);
    expect(heartbeatSrc).toMatch(/join\(__dirname,\s*scriptFile\)/);
    // The retired v26 engine must no longer be the one spawned.
    expect(heartbeatSrc).not.toMatch(/spawnMjs\("v26_jul15_engine\.mjs"/);
  });

  it("build:server copies the active (v27) engine, audit engine, and the audit JSON into dist", () => {
    expect(buildServer).toContain("cp server/wc2026/v27_jul18_engine.mjs dist/v27_jul18_engine.mjs");
    expect(buildServer).toContain("cp server/wc2026/wc2026AuditEngine.mjs dist/wc2026AuditEngine.mjs");
    expect(buildServer).toContain("cp server/wc2026/groupStageGameIds.json dist/groupStageGameIds.json");
  });

  it("the spawned files exist to be copied", () => {
    for (const f of ["v27_jul18_engine.mjs", "wc2026AuditEngine.mjs", "groupStageGameIds.json"]) {
      expect(fs.existsSync(path.join(repoRoot, "server", "wc2026", f))).toBe(true);
    }
  });

  it("v27 engine targets the 3rd-place match (FRA home vs ENG away, ESPN 760516) and the Final (ESP home vs ARG away, ESPN 760517)", () => {
    expect(engineSrc).toMatch(/fid:'wc26-3rd-103',\s*home:'FRA',\s*away:'ENG',\s*espnId:'760516'/);
    expect(engineSrc).toMatch(/beId:'b9l0F3Bj',\s*beSlug:'france-england'/);
    expect(engineSrc).toMatch(/fid:'wc26-final-104',\s*home:'ESP',\s*away:'ARG',\s*espnId:'760517'/);
    expect(engineSrc).toMatch(/beId:'UgbUKPmT',\s*beSlug:'spain-argentina'/);
    // No stale SF-102 projection targeting left behind from the v26 clone (the
    // SF appears only as a BACKTEST entry, never as a projection/book target).
    expect(engineSrc).not.toMatch(/fid:'wc26-sf-102',\s*home:'ENG',\s*away:'ARG',\s*espnId/);
    expect(engineSrc).not.toMatch(/beId:'pKVyGJbD'/);
  });

  it("writes per-fid round labels from the schema enum (third_place / finals), not a hardcoded round", () => {
    expect(engineSrc).toMatch(/'wc26-3rd-103': 'third_place'/);
    // MUST be 'finals' (plural) — the world_cup_round mysqlEnum has no 'final';
    // the singular was rejected live with "Data truncated" (run 29623270569).
    expect(engineSrc).toMatch(/'wc26-final-104': 'finals'/);
    expect(engineSrc).not.toMatch(/'wc26-final-104': 'final'[,\s]/);
    expect(engineSrc).toMatch(/'knockout', ROUND_LABEL\[match\.fid\]/);
  });

  it("refuses to run on an unfilled placeholder book, but treats missing to-advance as expected (no such market for 3rd/final)", () => {
    // The six BetExplorer markets are hand-filled from wc-jul18-probe.yml; until
    // then they are null and the projection loop must hard-fail rather than model
    // against a missing book. To-advance is WARN-only: the 3rd-place match and
    // the Final have no to-advance market, so book_*_to_advance stays NULL while
    // the model still computes model_*_to_advance (win outright via ET+pens).
    expect(engineSrc).toMatch(/BOOK COMPLETENESS GUARD/);
    expect(engineSrc).toMatch(/JUL18_BOOK not filled from probe/);
    expect(engineSrc).toMatch(/const missing = required\.filter\(k => book\[k\] == null\)/);
    expect(engineSrc).toMatch(/no to-advance book lines \(expected/);
    expect(engineSrc).not.toMatch(/to-advance book lines missing/);
  });

  it("carries the scraped bet365 book for both matches (probe run 29622399287) with no market left null", () => {
    // 3rd-103 (b9l0F3Bj): all six markets clean, AH primary -1.5, OU primary 3.5.
    expect(engineSrc).toMatch(/bookHomeMl: -118, bookDraw: 300, bookAwayMl: 290/);
    expect(engineSrc).toMatch(/bookSpread: -1\.5, bookTotal: 3\.5/);
    expect(engineSrc).toMatch(/bookOver: 110, bookUnder: -137/);
    expect(engineSrc).toMatch(/bookBttsY: -227, bookBttsN: 163/);
    expect(engineSrc).toMatch(/bookHomeWD: -400, bookAwayWD: -110, bookNoDraw: -455/);
    expect(engineSrc).toMatch(/bookHomeSpreadOdds: 210, bookAwaySpreadOdds: -286/);
    // final-104 (UgbUKPmT): five clean markets + the scraped -0.75 AH line
    // (primary-rule selection found no passing line; jul15-precedent fallback).
    expect(engineSrc).toMatch(/bookHomeMl: 125, bookDraw: 200, bookAwayMl: 260/);
    expect(engineSrc).toMatch(/bookSpread: -0\.75, bookTotal: 2\.5/);
    expect(engineSrc).toMatch(/bookOver: 120, bookUnder: -149/);
    expect(engineSrc).toMatch(/bookBttsY: -110, bookBttsN: -110/);
    expect(engineSrc).toMatch(/bookHomeWD: -345, bookAwayWD: -161, bookNoDraw: -278/);
    expect(engineSrc).toMatch(/bookHomeSpreadOdds: 168, bookAwaySpreadOdds: -222/);
    // No BetExplorer market left null after the fill (adv is intentionally null).
    expect(engineSrc).not.toMatch(/bookHomeMl: null/);
    expect(engineSrc).not.toMatch(/bookTotal: null/);
  });

  it("grows the backtest with the QF/SF results and their frozen books", () => {
    expect(engineSrc).toMatch(/fid:'wc26-qf-099', home:'NOR', away:'ENG', homeScore:1, awayScore:2/);
    expect(engineSrc).toMatch(/fid:'wc26-sf-101', home:'FRA', away:'ESP', homeScore:0, awayScore:2/);
    expect(engineSrc).toMatch(/fid:'wc26-sf-102', home:'ENG', away:'ARG', homeScore:1, awayScore:2/);
    // Frozen books present for every added backtest fid.
    expect(engineSrc).toMatch(/'wc26-qf-099': \{ bookHomeMl:300/);
    expect(engineSrc).toMatch(/'wc26-sf-101': \{ bookHomeMl:135/);
    expect(engineSrc).toMatch(/'wc26-sf-102': \{ bookHomeMl:170/);
  });

  it("writes model Double Chance into wc2026_model_projections (feed reads DC from there, not wc2026MatchOdds)", () => {
    expect(engineSrc).toMatch(/dc_1x_odds,\s*dc_x2_odds,\s*no_draw_home_odds/);
    expect(engineSrc).toMatch(/dc_1x_odds=VALUES\(dc_1x_odds\)/);
    expect(engineSrc).toMatch(/markets\.mlHomeWD,\s*markets\.mlAwayWD,\s*markets\.mlNoDraw,\s*\n\s*markets\.spreadLine/);
  });

  it("leaves both venues untouched (venueCityLike null) — no unverified stadium hardcode", () => {
    expect(engineSrc).toMatch(/venueCityLike:null, seedDatePT:'2026-07-18'/);
    expect(engineSrc).toMatch(/venueCityLike:null, seedDatePT:'2026-07-19'/);
    expect(engineSrc).toMatch(/SELECT venue_id, city FROM wc2026_venues WHERE LOWER\(city\) LIKE/);
    expect(engineSrc).toMatch(/UPDATE wc2026_matches SET venue_id = \? WHERE match_id = \?/);
  });

  it("orientation guard: hard-fails on internal ML/DC book inconsistency, WARNs (not fails) on genuine model-market divergence", () => {
    expect(engineSrc).toMatch(/ORIENTATION GUARD/);
    expect(engineSrc).toMatch(/const bookFav = book\.bookHomeMl <= book\.bookAwayMl/);
    expect(engineSrc).toMatch(/const dcFav = book\.bookHomeWD <= book\.bookAwayWD/);
    expect(engineSrc).toMatch(/book INTERNALLY inconsistent/);
    expect(engineSrc).toMatch(/MODEL DIVERGES FROM MARKET/);
    // The v26 model-vs-book hard-fail heuristic must be gone — a legitimate
    // model disagreement (Final: model favors ARG, book favors ESP) is an
    // output, not an error.
    expect(engineSrc).not.toMatch(/bookFav !== modelFav && gap > 0\.08/);
    expect(engineSrc).not.toMatch(/likely home\/away flip; refusing to write/);
  });

  it("computes model totals at the BOOK's primary O/U line (not hardcoded 2.5)", () => {
    expect(engineSrc).toMatch(/deriveAllMarkets\(joint, lambdaH, lambdaA, spreadLine, totalLine = 2\.5\)/);
    expect(engineSrc).toMatch(/if \(h\+a>totalLine\) pOver\+=p/);
    expect(engineSrc).toMatch(/deriveAllMarkets\(joint, lH\.lambda, lA\.lambda, spreadLine, book\.bookTotal\)/);
  });

  it("asserts the live wc2026_matches orientation before writing", () => {
    expect(engineSrc).toMatch(/LIVE ORIENTATION ASSERTION/);
    expect(engineSrc).toMatch(/SELECT home_team_id, away_team_id FROM wc2026_matches WHERE match_id = \?/);
    expect(engineSrc).toMatch(/orientation flip; refusing to model\/write/);
  });

  it("buckets both matches on their PT kickoff-days with the non-destructive match_date repair", () => {
    expect(engineSrc).toMatch(/seedDatePT:'2026-07-18'/);
    expect(engineSrc).toMatch(/seedDatePT:'2026-07-19'/);
    expect(engineSrc).toMatch(/UPDATE wc2026_matches SET match_date = \? WHERE match_id = \? AND DATE\(match_date\) <> \?/);
  });

  it("audits both new rows for NULLs after the write", () => {
    expect(engineSrc).toMatch(/WHERE match_id IN \('wc26-3rd-103','wc26-final-104'\)/);
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
