import { describe, expect, it, vi } from "vitest";
import type { Request, RequestHandler, Response } from "express";
import {
  TRPC_PROCEDURE_CLASSES,
  classifyTrpcProcedures,
  createTrpcRateLimitDispatch,
  parseTrpcProcedureList,
} from "./trpcRateLimitPolicy";

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
    expect(classifyTrpcProcedures(["games.list"])).toBeNull();
    expect(classifyTrpcProcedures(["games.list", "wc2026.matchesByDate"])).toBeNull();
    expect(classifyTrpcProcedures([])).toBeNull();
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
      expect(["auth", "stripe_checkout", "waitlist"]).toContain(cls);
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

  it("passes unclassified feed reads straight through", () => {
    const { calls, limiters } = makeStubs();
    const next = run("/games.list,wc2026.matchesByDate", limiters);
    expect(calls).toEqual([]);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
