import { describe, expect, it } from "vitest";
import { isDimeProductLocation, parseDimeProductRoute } from "./productRoute";

describe("parseDimeProductRoute", () => {
  it("classifies chat and tracker", () => {
    expect(parseDimeProductRoute("/chat")).toEqual({ pane: "chat" });
    expect(parseDimeProductRoute("/bet-tracker")).toEqual({ pane: "tracker" });
  });

  it("preserves combined and split feed route segments", () => {
    expect(parseDimeProductRoute("/feed/model/mlb-07-11-2026")).toEqual({
      pane: "feed",
      sportSegment: "mlb-07-11-2026",
      dateSegment: undefined,
    });
    expect(parseDimeProductRoute("/feed/model/wc/07-11-2026")).toEqual({
      pane: "feed",
      sportSegment: "wc",
      dateSegment: "07-11-2026",
    });
  });

  it("preserves combined, split, and bare splits route segments", () => {
    expect(parseDimeProductRoute("/betting-splits")).toEqual({
      pane: "splits",
    });
    expect(parseDimeProductRoute("/betting-splits/mlb-07-11-2026")).toEqual({
      pane: "splits",
      sportSegment: "mlb-07-11-2026",
      dateSegment: undefined,
    });
    expect(parseDimeProductRoute("/betting-splits/mlb/07-11-2026")).toEqual({
      pane: "splits",
      sportSegment: "mlb",
      dateSegment: "07-11-2026",
    });
  });

  it("does not claim mobile-owner, admin, or similarly prefixed routes", () => {
    for (const location of [
      "/m/chat",
      "/admin/model-status",
      "/chat-history",
      "/",
    ]) {
      expect(isDimeProductLocation(location)).toBe(false);
    }
  });
});
