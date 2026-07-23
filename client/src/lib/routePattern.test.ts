import { describe, it, expect } from "vitest";
import { toRoutePattern } from "./routePattern";

describe("toRoutePattern (low-cardinality, no ids/PII)", () => {
  it("keeps static routes verbatim", () => {
    expect(toRoutePattern("/chat")).toBe("/chat");
    expect(toRoutePattern("/bet-tracker")).toBe("/bet-tracker");
    expect(toRoutePattern("/betting-splits")).toBe("/betting-splits");
  });
  it("collapses sport + date segments", () => {
    expect(toRoutePattern("/feed/model/mlb/2026-07-23")).toBe("/feed/model/:sport/:date");
    expect(toRoutePattern("/feed/model/nba")).toBe("/feed/model/:sport");
    expect(toRoutePattern("/betting-splits/MLB/2026-07-23")).toBe("/betting-splits/:sport/:date");
  });
  it("collapses team slugs and mobile routes", () => {
    expect(toRoutePattern("/mlb/team/new-york-yankees")).toBe("/mlb/team/:slug");
    expect(toRoutePattern("/m/feed")).toBe("/m/feed");
  });
  it("collapses unknown trailing dynamic segments to :id", () => {
    expect(toRoutePattern("/account/98217")).toBe("/account/:id");
  });
});
