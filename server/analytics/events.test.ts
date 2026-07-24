import { describe, it, expect } from "vitest";
import { trackInputSchema, sanitizeProps, qualifiesActive, ALL_EVENTS, ACTION_ALLOWLIST, FEATURE_EVENTS } from "./events";

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

describe("action_performed contract (D3)", () => {
  const actionBase = { eventId: "act_abcdefgh", schemaVersion: 1, occurredAtUtc: 1700000000000 };
  it("accepts action_performed with a valid curated action_name", () => {
    const r = trackInputSchema.safeParse({ ...actionBase, eventName: "action_performed", actionName: "chat_message_sent" });
    expect(r.success).toBe(true);
  });
  it("rejects action_performed with no action_name (refine)", () => {
    const r = trackInputSchema.safeParse({ ...actionBase, eventName: "action_performed" });
    expect(r.success).toBe(false);
  });
  it("rejects an action_name outside the curated allowlist", () => {
    const r = trackInputSchema.safeParse({ ...actionBase, eventName: "action_performed", actionName: "delete_everything" });
    expect(r.success).toBe(false);
  });
  it("accepts feature-lifecycle event names", () => {
    for (const n of FEATURE_EVENTS) {
      expect(trackInputSchema.safeParse({ ...actionBase, eventName: n }).success).toBe(true);
      expect(ALL_EVENTS).toContain(n);
    }
  });
  it("includes action_performed in the allowlist but never qualifies it as active", () => {
    expect(ALL_EVENTS).toContain("action_performed");
    expect(qualifiesActive("action_performed")).toBe(false);
    for (const n of FEATURE_EVENTS) expect(qualifiesActive(n)).toBe(false);
    // Every curated action is a non-active diagnostic carried under action_performed.
    for (const a of ACTION_ALLOWLIST) expect(qualifiesActive(a)).toBe(false);
  });
  it("keeps the curated allowlist at the documented actions (17 + 2 P0 profiling)", () => {
    expect(ACTION_ALLOWLIST).toHaveLength(19);
    expect(ACTION_ALLOWLIST).toContain("results_viewed");
    expect(ACTION_ALLOWLIST).toContain("referral_landed");
  });
  it("accepts the P0 profiling action names on action_performed", () => {
    const base = { eventId: "act_abcdefgh", schemaVersion: 1, occurredAtUtc: 1700000000000, eventName: "action_performed" as const };
    expect(trackInputSchema.safeParse({ ...base, actionName: "results_viewed" }).success).toBe(true);
    expect(trackInputSchema.safeParse({ ...base, actionName: "referral_landed" }).success).toBe(true);
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
