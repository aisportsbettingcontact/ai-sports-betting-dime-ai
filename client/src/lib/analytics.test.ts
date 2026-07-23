import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { newEventId, buildClientEnvelope } from "./analytics";

describe("newEventId", () => {
  it("is unique across many calls (idempotency key)", () => {
    const s = new Set(Array.from({ length: 500 }, () => newEventId()));
    expect(s.size).toBe(500);
  });
});

describe("buildClientEnvelope", () => {
  it("builds a non-authoritative envelope with sane defaults", () => {
    const e = buildClientEnvelope("chat_response_completed");
    expect(e.eventName).toBe("chat_response_completed");
    expect(e.schemaVersion).toBe(1);
    expect(e.surface).toBe("web");
    expect(typeof e.eventId).toBe("string");
    expect(typeof e.tabId).toBe("string");
    // The client never sets authoritative identity — server derives source_user_id.
    expect(e).not.toHaveProperty("sourceUserId");
  });
  it("includes optional fields only when provided", () => {
    const bare = buildClientEnvelope("tracker_entry_saved");
    expect(bare).not.toHaveProperty("featureId");
    expect(bare).not.toHaveProperty("outcome");
    const full = buildClientEnvelope("tracker_entry_saved", {
      featureId: "bet_tracker",
      outcome: "success",
      props: { n: 1 },
    });
    expect(full.featureId).toBe("bet_tracker");
    expect(full.outcome).toBe("success");
    expect(full.props).toEqual({ n: 1 });
  });
});

const src = fs.readFileSync(path.join(import.meta.dirname, "analytics.ts"), "utf8");
describe("useAnalytics wiring (source contract)", () => {
  it("posts to the same-origin tRPC analytics.track — never a private host", () => {
    expect(src).toMatch(/trpc\.analytics\.track\.useMutation/);
    expect(src).not.toMatch(/railway\.internal/);
  });
  it("is fire-and-forget and never throws (swallows errors)", () => {
    expect(src).toMatch(/onError: \(\) =>/);
    expect(src).toMatch(/catch \{/);
  });
});
