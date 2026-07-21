import { describe, expect, it } from "vitest";
import {
  isChatLocation,
  isDimeProductLocation,
  parseDimeProductRoute,
} from "./productRoute";

describe("trends pane routing", () => {
  it("classifies /trends as the trends pane", () => {
    expect(parseDimeProductRoute("/trends")).toEqual({ pane: "trends" });
  });

  it("strips query and hash before classifying", () => {
    expect(parseDimeProductRoute("/trends?x=1#frag")).toEqual({
      pane: "trends",
    });
  });

  it("is shell-owned but never chat", () => {
    expect(isDimeProductLocation("/trends")).toBe(true);
    expect(isChatLocation("/trends")).toBe(false);
  });

  it("does not classify sub-paths — /trends has no sport/date segments", () => {
    expect(parseDimeProductRoute("/trends/mlb")).toBeNull();
  });

  it("leaves the existing panes untouched", () => {
    expect(parseDimeProductRoute("/chat")).toEqual({ pane: "chat" });
    expect(parseDimeProductRoute("/bet-tracker")).toEqual({ pane: "tracker" });
    expect(parseDimeProductRoute("/betting-splits")).toEqual({
      pane: "splits",
    });
  });
});
