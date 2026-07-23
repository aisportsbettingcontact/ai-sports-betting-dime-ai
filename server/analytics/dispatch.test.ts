import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchStoredEvent } from "./dispatch";
import type { StoredEvent } from "./store";

const base: StoredEvent = {
  eventId: "e1abc234",
  eventName: "login",
  schemaVersion: 1,
  sourceUserId: 7,
  surface: "server",
  occurredAtUtc: 1,
  environment: "test",
};

describe("dispatchStoredEvent", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it("is a no-op when disabled", async () => {
    delete process.env.ANALYTICS_ROLE;
    delete process.env.USER_ACTIVITY_BACKEND_URL;
    await expect(dispatchStoredEvent(base)).resolves.toEqual({ routed: "disabled" });
  });
  it("never throws even if a sink fails", async () => {
    process.env.ANALYTICS_ROLE = "store"; // store path will throw without a DB
    const r = await dispatchStoredEvent(base);
    expect(["stored", "error"]).toContain(r.routed);
  });
});
