import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ensureAnalyticsSchema, insertAnalyticsEvent } from "./store";

/**
 * The critical safety property: the store code must REFUSE to run unless the
 * instance is explicitly the analytics store — so it can never write analytics
 * into the product TiDB database. The vitest env has no ANALYTICS_ROLE=store,
 * so every store entry point must throw at the guard BEFORE any DB access.
 */
describe("store guards — never write analytics to a non-store DB", () => {
  it("ensureAnalyticsSchema refuses when not in store role", async () => {
    await expect(ensureAnalyticsSchema()).rejects.toThrow(/not the analytics store/);
  });

  it("insertAnalyticsEvent refuses when not in store role", async () => {
    await expect(
      insertAnalyticsEvent({
        eventId: "evt_test",
        eventName: "chat_response_completed",
        schemaVersion: 1,
        sourceUserId: 1,
        surface: "web",
        occurredAtUtc: 1,
        environment: "test",
      }),
    ).rejects.toThrow(/not the analytics store/);
  });
});

const src = fs.readFileSync(path.join(import.meta.dirname, "store.ts"), "utf8");
describe("store schema carries the device/route columns", () => {
  for (const col of ["device_type","os_family","browser_family","app_surface","viewport_class","orientation","is_touch","is_standalone","connection_class","route","action_name"]) {
    it(`DDL declares ${col}`, () => expect(src).toContain(col));
  }
  it("INSERT lists device_type and route", () => {
    expect(src).toMatch(/INSERT IGNORE INTO analytics_events[\s\S]*device_type[\s\S]*route/);
  });
  it("indexes device_type and route for slicing", () => {
    expect(src).toContain("idx_device_time");
    expect(src).toContain("idx_route_time");
  });
});
