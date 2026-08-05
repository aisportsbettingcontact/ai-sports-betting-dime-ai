import { describe, expect, it, vi } from "vitest";
import type { Request, RequestHandler, Response } from "express";
import {
  TRPC_PROCEDURE_CLASSES,
  classifyTrpcProcedures,
  clientIpKey,
  createTrpcRateLimitDispatch,
  isReservedOrInternalIp,
  isTrpcRequest,
  parseTrpcProcedureList,
  resolveClientIp,
  sendRateLimitResponse,
  trpcRateLimitEnvelope,
} from "./trpcRateLimitPolicy";

function req(partial: Partial<Request>): Request {
  return { headers: {}, ...partial } as Request;
}

describe("parseTrpcProcedureList", () => {
  it("parses a single unbatched procedure path", () => {
    expect(parseTrpcProcedureList("/appUsers.login")).toEqual([
      "appUsers.login",
    ]);
  });

  it("parses a comma-batched procedure path into every segment", () => {
    expect(parseTrpcProcedureList("/appUsers.login,appUsers.me")).toEqual([
      "appUsers.login",
      "appUsers.me",
    ]);
  });

  it("ignores empty segments and whitespace", () => {
    expect(parseTrpcProcedureList("/a.b, ,c.d,")).toEqual(["a.b", "c.d"]);
    expect(parseTrpcProcedureList("/")).toEqual([]);
    expect(parseTrpcProcedureList("")).toEqual([]);
  });

  it("percent-decodes before splitting, exactly as tRPC routes (evasion fix)", () => {
    // tRPC does decodeURIComponent(path).split(",") and EXECUTES the decoded
    // procedure. If the classifier reads the raw path, `appUsers.logi%6E`
    // classifies as nothing → no limiter → yet tRPC runs appUsers.login. Decode
    // first so the classifier sees exactly what tRPC routes on.
    expect(parseTrpcProcedureList("/appUsers.logi%6E")).toEqual(["appUsers.login"]);
    expect(parseTrpcProcedureList("/appUsers%2Elogin")).toEqual(["appUsers.login"]);
    // %2C is an encoded comma → must split into two procedures
    expect(parseTrpcProcedureList("/appUsers.login%2Cx")).toEqual([
      "appUsers.login",
      "x",
    ]);
  });

  it("leaves a malformed percent-sequence untouched (tRPC 404s it anyway)", () => {
    expect(parseTrpcProcedureList("/appUsers.login%ZZ")).toEqual([
      "appUsers.login%ZZ",
    ]);
  });
});

describe("classifyTrpcProcedures — URL-encoding evasion is closed", () => {
  it("classifies percent-encoded rate-limited procedures by their decoded name", () => {
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/appUsers.logi%6E"))).toBe(
      "auth"
    );
    expect(
      classifyTrpcProcedures(parseTrpcProcedureList("/stripe.publicCreateCheckoutSessio%6E"))
    ).toBe("stripe_checkout");
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/waitlist.submi%74"))).toBe(
      "waitlist"
    );
    // encoded-comma batch-split evasion: login%2Cx → [login, x] → auth
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/appUsers.login%2Cx"))).toBe(
      "auth"
    );
  });
});

describe("classifyTrpcProcedures", () => {
  it("classifies login procedures as auth regardless of batch position", () => {
    // AUTH-004 batch evasion: appending ANY second procedure used to skip the
    // path-prefix-mounted limiter entirely. Classification must be position-blind.
    expect(classifyTrpcProcedures(["appUsers.login"])).toBe("auth");
    expect(classifyTrpcProcedures(["auth.login"])).toBe("auth");
    expect(classifyTrpcProcedures(["appUsers.login", "appUsers.me"])).toBe(
      "auth"
    );
    expect(classifyTrpcProcedures(["appUsers.me", "appUsers.login"])).toBe(
      "auth"
    );
  });

  it("classifies every rate-limited stripe procedure", () => {
    for (const p of [
      "stripe.publicCreateCheckoutSession",
      "stripe.publicCreateEmbeddedCheckoutSession",
      "stripe.publicAttachCheckoutIdentity",
      "stripe.getCheckoutSessionUser",
      "stripe.completeAccountSetup",
    ]) {
      expect(classifyTrpcProcedures([p])).toBe("stripe_checkout");
      expect(classifyTrpcProcedures([p, "appUsers.me"])).toBe(
        "stripe_checkout"
      );
    }
  });

  it("classifies waitlist.submit including batch-evasion shapes", () => {
    expect(classifyTrpcProcedures(["waitlist.submit"])).toBe("waitlist");
    expect(classifyTrpcProcedures(["waitlist.submit", "appUsers.me"])).toBe(
      "waitlist"
    );
  });

  it("returns null for unclassified procedures", () => {
    expect(classifyTrpcProcedures(["appUsers.me"])).toBeNull();
    expect(classifyTrpcProcedures(["appUsers.me", "someOther.thing"])).toBeNull();
    expect(classifyTrpcProcedures([])).toBeNull();
  });

  it("classifies public feed reads as public_feed", () => {
    for (const p of [
      "games.list",
      "games.getCurrentDate",
      "games.getAvailableDates",
      "games.lastRefresh",
      "wc2026.matchesByDate",
    ]) {
      expect(classifyTrpcProcedures([p])).toBe("public_feed");
    }
    // a feed batch with an unclassified member is still public_feed
    expect(classifyTrpcProcedures(["appUsers.me", "games.list"])).toBe(
      "public_feed"
    );
  });

  it("applies strictest-class-wins priority for mixed batches", () => {
    // auth > stripe_checkout > waitlist (documented in the class map)
    expect(
      classifyTrpcProcedures([
        "stripe.publicCreateCheckoutSession",
        "appUsers.login",
      ])
    ).toBe("auth");
    expect(
      classifyTrpcProcedures(["waitlist.submit", "stripe.completeAccountSetup"])
    ).toBe("stripe_checkout");
  });

  it("covers every mapped procedure with a valid class", () => {
    for (const [proc, cls] of TRPC_PROCEDURE_CLASSES) {
      expect(["auth", "stripe_checkout", "waitlist", "public_feed"]).toContain(
        cls
      );
      expect(classifyTrpcProcedures([proc])).toBe(cls);
    }
  });
});

describe("createTrpcRateLimitDispatch", () => {
  function makeStubs() {
    const calls: string[] = [];
    const stub = (name: string): RequestHandler =>
      vi.fn(((_req, _res, next) => {
        calls.push(name);
        next();
      }) as RequestHandler);
    const limiters = {
      auth: stub("auth"),
      stripe_checkout: stub("stripe_checkout"),
      waitlist: stub("waitlist"),
      public_feed: stub("public_feed"),
    };
    return { calls, limiters };
  }

  function run(path: string, limiters: Record<string, RequestHandler>) {
    const dispatch = createTrpcRateLimitDispatch(
      limiters as Parameters<typeof createTrpcRateLimitDispatch>[0]
    );
    const next = vi.fn();
    dispatch({ path } as Request, {} as Response, next);
    return next;
  }

  it("routes a batched login request through the auth limiter (evasion closed)", () => {
    const { calls, limiters } = makeStubs();
    const next = run("/appUsers.login,appUsers.me", limiters);
    expect(calls).toEqual(["auth"]);
    expect(next).toHaveBeenCalledTimes(1); // stub called next()
  });

  it("routes batch-evading waitlist shapes through the waitlist limiter", () => {
    const { calls, limiters } = makeStubs();
    run("/waitlist.submit,appUsers.me", limiters);
    expect(calls).toEqual(["waitlist"]);
  });

  it("routes public feed reads to the public_feed limiter", () => {
    const { calls, limiters } = makeStubs();
    run("/games.list,wc2026.matchesByDate", limiters);
    expect(calls).toEqual(["public_feed"]);
  });

  it("prefers auth over public_feed for the login+feed batch shape", () => {
    const { calls, limiters } = makeStubs();
    run("/appUsers.login,games.list", limiters);
    expect(calls).toEqual(["auth"]);
  });

  it("passes a batch of only-unknown procedures straight through", () => {
    const { calls, limiters } = makeStubs();
    const next = run("/appUsers.me,someOther.thing", limiters);
    expect(calls).toEqual([]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN when the public_feed limiter throws (feed availability wins)", () => {
    const throwing: RequestHandler = vi.fn(() => {
      throw new Error("limiter store exploded");
    });
    const stub = (): RequestHandler => vi.fn((_q, _s, n) => n());
    const dispatch = createTrpcRateLimitDispatch({
      auth: stub(),
      stripe_checkout: stub(),
      waitlist: stub(),
      public_feed: throwing,
    } as Parameters<typeof createTrpcRateLimitDispatch>[0]);
    const next = vi.fn();
    dispatch({ path: "/games.list" } as Request, {} as Response, next);
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1); // request continued, not 5xx'd
  });

  it("fails OPEN when the public_feed limiter REJECTS async (real express-rate-limit shape)", async () => {
    // express-rate-limit wraps its middleware in an async fn, so real store
    // faults surface as a rejected promise / next(error), never a sync throw.
    const rejecting: RequestHandler = vi.fn(async () => {
      throw new Error("async store outage");
    });
    const stub = (): RequestHandler => vi.fn((_q, _s, n) => n());
    const dispatch = createTrpcRateLimitDispatch({
      auth: stub(),
      stripe_checkout: stub(),
      waitlist: stub(),
      public_feed: rejecting,
    } as Parameters<typeof createTrpcRateLimitDispatch>[0]);
    const next = vi.fn();
    dispatch(
      { path: "/games.list" } as Request,
      { headersSent: false } as Response,
      next
    );
    await new Promise(r => setImmediate(r)); // let the rejection settle
    expect(next).toHaveBeenCalledTimes(1); // request continued, not 5xx'd
  });

  it("does NOT fail open for auth — a throwing auth limiter propagates", () => {
    const throwing: RequestHandler = vi.fn(() => {
      throw new Error("auth limiter exploded");
    });
    const stub = (): RequestHandler => vi.fn((_q, _s, n) => n());
    const dispatch = createTrpcRateLimitDispatch({
      auth: throwing,
      stripe_checkout: stub(),
      waitlist: stub(),
      public_feed: stub(),
    } as Parameters<typeof createTrpcRateLimitDispatch>[0]);
    expect(() =>
      dispatch({ path: "/appUsers.login" } as Request, {} as Response, vi.fn())
    ).toThrow(/auth limiter exploded/);
  });
});

describe("clientIpKey", () => {
  it("keys on the true client (leftmost sanitized XFF), not the rotating edge hop", () => {
    // Railway sanitizes inbound XFF and writes [trueClient, edgeInternal].
    // Verified in production 2026-08-05: an injected XFF is discarded, and the
    // edge hop (152.233.x.x) rotates per connection. Keying on req.ip lands on
    // that rotating hop; the true client is the leftmost entry.
    const a = clientIpKey(
      req({ headers: { "x-forwarded-for": "99.168.78.109, 152.233.40.1" }, ip: "152.233.40.1" })
    );
    const b = clientIpKey(
      req({ headers: { "x-forwarded-for": "99.168.78.109, 152.233.47.68" }, ip: "152.233.47.68" })
    );
    // Same client, different edge hop → SAME key (the bug this fixes).
    expect(a).toBe(b);
    expect(a).toContain("99.168.78.109");
  });

  it("distinguishes different true clients sharing one edge hop", () => {
    const a = clientIpKey(req({ headers: { "x-forwarded-for": "1.1.1.1, 152.233.40.1" } }));
    const b = clientIpKey(req({ headers: { "x-forwarded-for": "2.2.2.2, 152.233.40.1" } }));
    expect(a).not.toBe(b);
  });

  it("falls back to req.ip when no XFF is present", () => {
    expect(clientIpKey(req({ ip: "203.0.113.9" }))).toContain("203.0.113.9");
  });

  it("normalizes IPv6 to its /56 prefix (ipKeyGenerator), never throwing", () => {
    const key = clientIpKey(
      req({ headers: { "x-forwarded-for": "2001:db8:abcd:1234:5678:9abc:def0:1, 152.233.40.1" } })
    );
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });
});

describe("resolveClientIp", () => {
  it("returns the leftmost XFF entry (true client) unnormalized", () => {
    expect(
      resolveClientIp(req({ headers: { "x-forwarded-for": "99.1.2.3, 152.233.40.1" } }))
    ).toBe("99.1.2.3");
  });
  it("falls back to req.ip when no XFF", () => {
    expect(resolveClientIp(req({ ip: "8.8.8.8" }))).toBe("8.8.8.8");
  });
  it("returns empty string when nothing is resolvable", () => {
    expect(resolveClientIp(req({}))).toBe("");
  });
});

describe("isReservedOrInternalIp — the XFF-sanitization canary", () => {
  it("flags RFC1918 / CGNAT / link-local / ULA (impossible for a real internet client)", () => {
    for (const ip of [
      "10.0.0.5",
      "172.16.9.9",
      "172.31.255.1",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "100.127.255.254",
      "fe80::1",
      "fd00::abcd",
      "::ffff:10.1.2.3", // IPv4-mapped private
    ]) {
      expect(isReservedOrInternalIp(ip)).toBe(true);
    }
  });
  it("does NOT flag ordinary public clients or loopback (self-ping)", () => {
    for (const ip of ["47.152.160.175", "8.8.8.8", "152.233.40.1", "2001:db8::1"]) {
      expect(isReservedOrInternalIp(ip)).toBe(false);
    }
    // loopback is intentionally NOT flagged — the app's own keep-alive/self
    // health calls originate there and must not trip the canary.
    expect(isReservedOrInternalIp("127.0.0.1")).toBe(false);
    expect(isReservedOrInternalIp("::1")).toBe(false);
  });
  it("never throws on garbage input", () => {
    expect(() => isReservedOrInternalIp("")).not.toThrow();
    expect(() => isReservedOrInternalIp("not-an-ip")).not.toThrow();
    expect(isReservedOrInternalIp("not-an-ip")).toBe(false);
  });
});

describe("isTrpcRequest", () => {
  it("detects tRPC by originalUrl regardless of mount-relative path", () => {
    expect(
      isTrpcRequest(req({ originalUrl: "/api/trpc/games.list?batch=1", path: "/games.list" }))
    ).toBe(true);
    expect(isTrpcRequest(req({ originalUrl: "/api/discord-auth", path: "/api/discord-auth" }))).toBe(
      false
    );
    expect(isTrpcRequest(req({ originalUrl: "/feed", path: "/feed" }))).toBe(false);
  });
});

describe("trpcRateLimitEnvelope", () => {
  it("returns one TOO_MANY_REQUESTS error entry per batched procedure", () => {
    const env = trpcRateLimitEnvelope(3);
    expect(env).toHaveLength(3);
    for (const entry of env) {
      expect(entry.error.json.code).toBe(-32029); // tRPC TOO_MANY_REQUESTS
      expect(entry.error.json.data.code).toBe("TOO_MANY_REQUESTS");
      expect(entry.error.json.data.httpStatus).toBe(429);
    }
  });

  it("always returns at least one entry (unbatched call)", () => {
    expect(trpcRateLimitEnvelope(0)).toHaveLength(1);
    expect(trpcRateLimitEnvelope(1)).toHaveLength(1);
  });
});

describe("sendRateLimitResponse", () => {
  function resStub() {
    const r: Record<string, unknown> = {};
    r.status = vi.fn((code: number) => {
      r.statusCode = code;
      return r;
    });
    r.json = vi.fn((body: unknown) => {
      r.body = body;
      return r;
    });
    return r as unknown as Response & { statusCode: number; body: unknown };
  }

  it("sends a tRPC envelope array at 429 for tRPC batch requests", () => {
    const res = resStub();
    sendRateLimitResponse(
      req({ originalUrl: "/api/trpc/appUsers.login,appUsers.me?batch=1", path: "/appUsers.login,appUsers.me" }),
      res,
      "Too many login attempts."
    );
    expect(res.statusCode).toBe(429);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body as unknown[]).toHaveLength(2); // one per batched procedure
  });

  it("sends a plain error object at 429 for non-tRPC routes", () => {
    const res = resStub();
    sendRateLimitResponse(
      req({ originalUrl: "/api/discord-auth", path: "/api/discord-auth" }),
      res,
      "Too many attempts."
    );
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "Too many attempts." });
  });
});
