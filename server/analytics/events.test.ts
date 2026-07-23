import { describe, it, expect } from "vitest";
import { trackInputSchema, sanitizeProps } from "./events";

describe("trackInputSchema", () => {
  const base = { eventId: "evt_abcdefgh", eventName: "chat_response_completed", schemaVersion: 1, occurredAtUtc: 1700000000000 };
  it("accepts a valid qualifying event", () => {
    expect(trackInputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects an unknown event name (login is not value-bearing)", () => {
    expect(trackInputSchema.safeParse({ ...base, eventName: "login" }).success).toBe(false);
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
