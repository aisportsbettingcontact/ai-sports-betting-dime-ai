import { describe, it, expect, afterEach } from "vitest";
import { forwardEvent } from "./forward";
import type { StoredEvent } from "./store";

const evt: StoredEvent = {
  eventId: "evt_abcdefgh",
  eventName: "chat_response_completed",
  schemaVersion: 1,
  sourceUserId: 1,
  surface: "web",
  occurredAtUtc: 1700000000000,
  environment: "test",
};

const saved = {
  url: process.env.USER_ACTIVITY_BACKEND_URL,
  secret: process.env.ANALYTICS_INGEST_SECRET,
};
afterEach(() => {
  process.env.USER_ACTIVITY_BACKEND_URL = saved.url;
  process.env.ANALYTICS_INGEST_SECRET = saved.secret;
  if (saved.url === undefined) delete process.env.USER_ACTIVITY_BACKEND_URL;
  if (saved.secret === undefined) delete process.env.ANALYTICS_INGEST_SECRET;
});

describe("forwardEvent", () => {
  it("reports not_configured when backend URL or secret is missing", async () => {
    delete process.env.USER_ACTIVITY_BACKEND_URL;
    delete process.env.ANALYTICS_INGEST_SECRET;
    const r = await forwardEvent(evt, (async () => new Response("{}")) as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, reason: "not_configured" });
  });

  it("posts to the PRIVATE ingest path with the secret header when configured", async () => {
    process.env.USER_ACTIVITY_BACKEND_URL = "http://ai-sports-betting-backend.railway.internal:3000";
    process.env.ANALYTICS_INGEST_SECRET = "sekret";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const r = await forwardEvent(evt, fake);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("http://ai-sports-betting-backend.railway.internal:3000/api/internal/analytics/ingest");
    expect((calls[0].init.headers as Record<string, string>)["x-analytics-secret"]).toBe("sekret");
    expect(JSON.parse(String(calls[0].init.body)).eventName).toBe("chat_response_completed");
  });

  it("never throws on network failure", async () => {
    process.env.USER_ACTIVITY_BACKEND_URL = "http://x";
    process.env.ANALYTICS_INGEST_SECRET = "s";
    const boom = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    await expect(forwardEvent(evt, boom)).resolves.toEqual({ ok: false, reason: "network" });
  });
});
