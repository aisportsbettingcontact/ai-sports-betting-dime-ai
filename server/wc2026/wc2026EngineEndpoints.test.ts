import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guards for the owner-triggered WC2026 model/audit/backfill endpoints that run
 * INSIDE Railway (where DATABASE_URL is valid), added because the GitHub-Actions
 * runner cannot reach the live TiDB cluster (empty DATABASE_URL secret / rotated
 * TARGET creds). Three things must stay wired together or a deploy silently loses
 * the ability to model the Jul-11 QFs:
 *   1. The three routes are registered.
 *   2. The v24 engine + audit engine + the audit's JSON ground-truth are copied
 *      into dist at build time (spawned by filename via __dirname, so they must
 *      sit next to dist/index.js in production — same lesson as bracket-sync).
 *   3. The spawned files exist to be copied.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const heartbeatSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "wc2026Heartbeat.ts"),
  "utf8",
);
const engineSrc = fs.readFileSync(
  path.join(repoRoot, "server", "wc2026", "v24_jul11_engine.mjs"),
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

  it("spawns the engine/audit .mjs by filename (resolved via __dirname)", () => {
    expect(heartbeatSrc).toMatch(/spawnMjs\("v24_jul11_engine\.mjs"/);
    expect(heartbeatSrc).toMatch(/spawnMjs\("wc2026AuditEngine\.mjs"/);
    expect(heartbeatSrc).toMatch(/join\(__dirname,\s*scriptFile\)/);
  });

  it("build:server copies the engine, audit engine, and the audit JSON into dist", () => {
    expect(buildServer).toContain("cp server/wc2026/v24_jul11_engine.mjs dist/v24_jul11_engine.mjs");
    expect(buildServer).toContain("cp server/wc2026/wc2026AuditEngine.mjs dist/wc2026AuditEngine.mjs");
    expect(buildServer).toContain("cp server/wc2026/groupStageGameIds.json dist/groupStageGameIds.json");
  });

  it("the spawned files exist to be copied", () => {
    for (const f of ["v24_jul11_engine.mjs", "wc2026AuditEngine.mjs", "groupStageGameIds.json"]) {
      expect(fs.existsSync(path.join(repoRoot, "server", "wc2026", f))).toBe(true);
    }
  });

  it("v24 engine targets the two Jul-11 QFs with the scraped bet365 book odds", () => {
    expect(engineSrc).toMatch(/fid:'wc26-qf-099',\s*home:'NOR',\s*away:'ENG',\s*espnId:'760512'/);
    expect(engineSrc).toMatch(/fid:'wc26-qf-100',\s*home:'ARG',\s*away:'SUI',\s*espnId:'760513'/);
    // A distinctive scraped line (NOR home ML +300) proves JUL11_BOOK was filled.
    expect(engineSrc).toContain("bookHomeMl: 300");
    // No stale qf-097 targeting left behind.
    expect(engineSrc).not.toMatch(/fid:'wc26-qf-097'/);
  });

  it("carries the owner-provided book to-advance (to-qualify) lines for both QFs", () => {
    // qf-099: NOR +160 / ENG -200 ; qf-100: ARG -310 / SUI +240.
    expect(engineSrc).toMatch(/bookHomeAdv:\s*160,\s*bookAwayAdv:\s*-200/);
    expect(engineSrc).toMatch(/bookHomeAdv:\s*-310,\s*bookAwayAdv:\s*240/);
    // The advance columns must no longer be null for these QFs.
    expect(engineSrc).not.toMatch(/bookHomeAdv:\s*null,\s*bookAwayAdv:\s*null/);
  });
});
