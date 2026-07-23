import { describe, it, expect } from "vitest";
import { toRoutePattern, sanitizeRoutePattern } from "./routePattern";

describe("server toRoutePattern (defense-in-depth)", () => {
  it("keeps static routes verbatim", () => {
    expect(toRoutePattern("/chat")).toBe("/chat");
    expect(toRoutePattern("/betting-splits")).toBe("/betting-splits");
  });
  it("collapses sport + date segments", () => {
    expect(toRoutePattern("/feed/model/mlb/2026-07-23")).toBe("/feed/model/:sport/:date");
    expect(toRoutePattern("/mlb/team/new-york-yankees")).toBe("/mlb/team/:slug");
  });
  it("collapses numeric ids and opaque tokens a raw client could inject", () => {
    expect(toRoutePattern("/account/98217")).toBe("/account/:id");
    // A password-reset token must NOT survive as raw PII in the analytics store.
    expect(toRoutePattern("/reset/deadbeefcafe1234567890")).toBe("/reset/:id");
  });
});

describe("sanitizeRoutePattern", () => {
  it("returns null for missing input", () => {
    expect(sanitizeRoutePattern(null)).toBeNull();
    expect(sanitizeRoutePattern(undefined)).toBeNull();
    expect(sanitizeRoutePattern("")).toBeNull();
  });
  it("re-collapses a client-sent raw path (never trusts the client's pattern)", () => {
    expect(sanitizeRoutePattern("/feed/model/nba/2026-01-02")).toBe("/feed/model/:sport/:date");
    expect(sanitizeRoutePattern("/account/12345")).toBe("/account/:id");
  });
  it("bounds the result to the store column width (96)", () => {
    const long = "/" + "a".repeat(200);
    expect(sanitizeRoutePattern(long)!.length).toBeLessThanOrEqual(96);
  });
});
