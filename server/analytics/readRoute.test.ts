import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dirname, "readRoute.ts"), "utf8");

describe("analytics read route", () => {
  it("serves GET /api/internal/analytics/overview", () => {
    expect(src).toMatch(/app\.get\(\s*["'`]\/api\/internal\/analytics\/overview/);
  });
  it("404s unless store role and 401s on secret mismatch", () => {
    expect(src).toMatch(/isAnalyticsStore/);
    expect(src).toMatch(/secretsMatch/);
    expect(src).toMatch(/x-analytics-secret/);
  });
  it("does not leak the private host into this module", () => {
    expect(src).not.toMatch(/railway\.internal/);
  });
});
