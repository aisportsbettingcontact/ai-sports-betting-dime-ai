import { describe, it, expect } from "vitest";
import { trackInputSchema, sanitizeProps, qualifiesActive, ALL_EVENTS } from "./events";

describe("trackInputSchema", () => {
  const base = { eventId: "evt_abcdefgh", eventName: "chat_response_completed", schemaVersion: 1, occurredAtUtc: 1700000000000 };
  it("accepts a valid qualifying event", () => {
    expect(trackInputSchema.safeParse(base).success).toBe(true);
  });
  it("accepts an engagement event name (login is now value-agnostic)", () => {
    expect(trackInputSchema.safeParse({ ...base, eventName: "login" }).success).toBe(true);
  });
  it("rejects a too-short event id", () => {
    expect(trackInputSchema.safeParse({ ...base, eventId: "x" }).success).toBe(false);
  });
  it("requires schemaVersion and occurredAtUtc", () => {
    expect(trackInputSchema.safeParse({ eventId: base.eventId, eventName: base.eventName }).success).toBe(false);
  });
  it("defaults surface to 'web'", () => {
    expect(trackInputSchema.parse(base).surface).toBe("web");
  });
});

describe("sanitizeProps", () => {
  it("keeps scalars, caps string length, drops non-scalars", () => {
    const out = sanitizeProps({ a: "x".repeat(500), b: 3, c: true, d: { nested: 1 } as unknown as string });
    expect(out?.a).toHaveLength(256);
    expect(out?.b).toBe(3);
    expect(out?.c).toBe(true);
    expect(out).not.toHaveProperty("d");
  });
  it("returns null for empty or absent props", () => {
    expect(sanitizeProps(null)).toBeNull();
    expect(sanitizeProps({})).toBeNull();
  });
  it("caps the number of props at 20", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 50; i++) many[`k${i}`] = i;
    expect(Object.keys(sanitizeProps(many) ?? {}).length).toBe(20);
  });
});

describe("event allowlist (broadened)", () => {
  it("accepts engagement + value event names", () => {
    for (const n of ["session_started","screen_viewed","login","chat_response_completed","tracker_entry_saved","projection_evaluation_viewed"]) {
      expect(ALL_EVENTS).toContain(n);
    }
  });
  it("qualifies only value events as active", () => {
    expect(qualifiesActive("chat_response_completed")).toBe(true);
    expect(qualifiesActive("tracker_entry_saved")).toBe(true);
    expect(qualifiesActive("screen_viewed")).toBe(false);
    expect(qualifiesActive("session_started")).toBe(false);
    expect(qualifiesActive("login")).toBe(false);
  });
  it("rejects an unknown event name", () => {
    const r = trackInputSchema.safeParse({ eventId: "abc123xyz", eventName: "totally_made_up", schemaVersion: 1, occurredAtUtc: 1 });
    expect(r.success).toBe(false);
  });
});

describe("device/route fields on the input contract", () => {
  it("accepts the coarse device block + route pattern", () => {
    const r = trackInputSchema.safeParse({
      eventId: "abcd1234efgh", eventName: "screen_viewed", schemaVersion: 1, occurredAtUtc: 2,
      route: "/feed/model/:sport", viewportClass: "md", orientation: "portrait",
      isTouch: true, pointerType: "coarse", isStandalone: false, connectionClass: "4g",
      appSurface: "web-mobile-shell",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an out-of-vocabulary viewportClass", () => {
    const r = trackInputSchema.safeParse({
      eventId: "abcd1234efgh", eventName: "screen_viewed", schemaVersion: 1, occurredAtUtc: 2, viewportClass: "huge",
    });
    expect(r.success).toBe(false);
  });
});
