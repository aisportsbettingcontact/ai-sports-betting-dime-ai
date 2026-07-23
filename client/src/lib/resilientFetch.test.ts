import { describe, it, expect, vi } from "vitest";
import superjson from "superjson";
import { resilientFetch, isRateLimitBody, type ResilientFetchDeps } from "./resilientFetch";

/**
 * Encodes the EXACT tRPC v11 transformResult validation
 * (node_modules/@trpc/server/dist/tracked-*.mjs:83-119): deserialize
 * `response.error`, then require `isObject(error.error) && typeof code === number`.
 * A body that fails this is what makes the client throw
 * "Unable to transform response from server".
 */
function wouldTrpcTransform(bodyJson: unknown): boolean {
  const isObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  const items = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
  for (const response of items as Array<Record<string, unknown>>) {
    try {
      if ("error" in response) {
        const error = superjson.deserialize(response.error as never) as { code?: unknown };
        const merged = { ...response, error };
        if (!isObject(merged.error) || typeof (merged.error as { code?: unknown }).code !== "number") return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

const fastDeps = (fetchImpl: typeof fetch): ResilientFetchDeps => ({
  fetchImpl,
  sleep: async () => {},
  notify: () => {},
});

describe("root cause: express rate-limiter JSON 429 is not tRPC-transformable", () => {
  it("REPRO: the raw limiter body {error:string} fails tRPC's transform", () => {
    expect(wouldTrpcTransform({ error: "Too many login attempts. Please wait 15 minutes." })).toBe(false);
  });
  it("control: a proper tRPC error envelope transforms fine", () => {
    expect(
      wouldTrpcTransform([{ error: { json: { message: "x", code: -32029, data: { code: "TOO_MANY_REQUESTS" } } } }]),
    ).toBe(true);
  });
});

describe("resilientFetch repairs rate-limit responses so tRPC never crashes", () => {
  it("repairs a JSON 429 (the login limiter) into a transformable envelope", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Too many login attempts. Please wait 15 minutes." }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await resilientFetch("/api/trpc/appUsers.login", { method: "POST" }, 0, fastDeps(fetchImpl));
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(wouldTrpcTransform(body)).toBe(true);
  });

  it("still repairs a plain-text 'Rate exceeded.' proxy response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("Rate exceeded.", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const res = await resilientFetch("/api/trpc/x", {}, 0, fastDeps(fetchImpl));
    expect(wouldTrpcTransform(await res.json())).toBe(true);
  });

  it("surfaces the server's message when the 429 body carries one", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Too many login attempts. Please wait 15 minutes." }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await resilientFetch("/api/trpc/appUsers.login", {}, 0, fastDeps(fetchImpl));
    const body = (await res.json()) as Array<{ error: { json: { message: string } } }>;
    expect(body[0].error.json.message).toMatch(/too many login attempts/i);
  });

  it("passes a VALID tRPC 429 envelope through untouched (no retry, no clobber)", async () => {
    // appUsers.login throws a native TRPCError TOO_MANY_REQUESTS → a valid array envelope.
    const trpc429 = JSON.stringify([
      {
        error: {
          json: {
            message: "Too many failed login attempts. Please wait 15 minutes and try again.",
            code: -32029,
            data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, path: "appUsers.login" },
          },
        },
      },
    ]);
    const fetchImpl = vi.fn(
      async () => new Response(trpc429, { status: 429, headers: { "content-type": "application/json" } }),
    );
    const res = await resilientFetch("/api/trpc/appUsers.login", {}, 0, fastDeps(fetchImpl));
    expect(await res.text()).toBe(trpc429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(wouldTrpcTransform(JSON.parse(trpc429))).toBe(true);
  });

  it("fast-paths a valid JSON tRPC response unchanged", async () => {
    const okBody = JSON.stringify([{ result: { data: { json: { ok: true } } } }]);
    const fetchImpl = vi.fn(
      async () => new Response(okBody, { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await resilientFetch("/api/trpc/x", {}, 0, fastDeps(fetchImpl));
    expect(await res.text()).toBe(okBody);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("isRateLimitBody matches known throttle phrases only", () => {
    expect(isRateLimitBody("Rate exceeded.")).toBe(true);
    expect(isRateLimitBody("Too Many Requests")).toBe(true);
    expect(isRateLimitBody("hello world")).toBe(false);
  });
});
