import { describe, it, expect } from "vitest";
import { classifySegment, SEGMENT_ORDER, SEGMENT_LABELS, type UserFacts } from "./segments";

const base: UserFacts = {
  daysSinceLastActive: 0,
  activeDays: 1,
  distinctSurfaces: 1,
  valueEvents: 0,
  actionEvents: 0,
  sessions: 1,
  feedActions: 0,
  chatActions: 0,
  splitsActions: 0,
  trackerValue: 0,
};

describe("classifySegment", () => {
  it("labels a lapsed account (>14d idle) At-Risk regardless of prior volume", () => {
    expect(classifySegment({ ...base, daysSinceLastActive: 20, valueEvents: 40, distinctSurfaces: 4, activeDays: 20 })).toBe("lurker_at_risk");
  });
  it("labels a browsing-but-valueless session as Lurker/At-Risk", () => {
    expect(classifySegment({ ...base, actionEvents: 0, valueEvents: 0, sessions: 2 })).toBe("lurker_at_risk");
  });
  it("labels a broad, valuable, frequent user Whale/Power", () => {
    expect(classifySegment({ ...base, distinctSurfaces: 3, valueEvents: 10, activeDays: 8, feedActions: 5, chatActions: 5 })).toBe("whale");
  });
  it("labels a splits-only, no-value user Splits-Scanner", () => {
    expect(classifySegment({ ...base, splitsActions: 8, valueEvents: 0, actionEvents: 8, distinctSurfaces: 1 })).toBe("splits_scanner");
  });
  it("labels a diligent logger Tracker-Diligent", () => {
    expect(classifySegment({ ...base, trackerValue: 4, valueEvents: 4, actionEvents: 4 })).toBe("tracker_diligent");
  });
  it("labels a chat-dominant user Chat-Native", () => {
    expect(classifySegment({ ...base, chatActions: 12, feedActions: 0, valueEvents: 3, actionEvents: 12 })).toBe("chat_native");
  });
  it("labels a feed-dominant user Model-Truster", () => {
    expect(classifySegment({ ...base, feedActions: 10, chatActions: 0, valueEvents: 3, actionEvents: 10 })).toBe("model_truster");
  });
  it("labels a low-but-real-value user Casual", () => {
    expect(classifySegment({ ...base, valueEvents: 1, actionEvents: 2 })).toBe("casual");
  });
});

describe("segment metadata", () => {
  it("has a label for every ordered key and no duplicates", () => {
    expect(SEGMENT_ORDER).toHaveLength(7);
    expect(new Set(SEGMENT_ORDER).size).toBe(7);
    for (const k of SEGMENT_ORDER) expect(SEGMENT_LABELS[k]).toBeTruthy();
  });
});
