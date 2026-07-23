import { describe, it, expect } from "vitest";
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
