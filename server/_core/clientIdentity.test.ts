import { describe, it, expect, afterEach } from "vitest";
import {
  resolveClientIdentity,
  identitySource,
} from "./clientIdentity";

const ORIGINAL_EDGE_MODE = process.env.EDGE_MODE;
const ORIGINAL_SECRET = process.env.EDGE_ORIGIN_SECRET;

afterEach(() => {
  process.env.EDGE_MODE = ORIGINAL_EDGE_MODE;
  process.env.EDGE_ORIGIN_SECRET = ORIGINAL_SECRET;
});

/**
 * PRODUCTION-SHAPED fixture. Railway discards Cloudflare's appended client
 * token and rewrites XFF as [CF PoP, Railway edge]. Every pre-existing test
 * in this repo used a single-token XFF, which is why the PoP-keying bug
 * survived — see server/loginStatus.test.ts (2026-08-06 audit).
 */
function cfRequest(cfClient: string, pop = "104.22.17.115", railway = "84.17.44.227") {
  return {
    headers: {
      "x-forwarded-for": `${pop}, ${railway}`,
      "cf-connecting-ip": cfClient,
      "x-dime-edge-secret": process.env.EDGE_ORIGIN_SECRET ?? "",
    },
    ip: railway,
  };
}

describe("resolveClientIdentity", () => {
  it("returns the true visitor from cf-connecting-ip, not the CF PoP", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    expect(resolveClientIdentity(cfRequest("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("does NOT return the Railway edge hop", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    const got = resolveClientIdentity(cfRequest("203.0.113.7"));
    expect(got).not.toBe("84.17.44.227");
    expect(got).not.toBe("104.22.17.115");
  });

  it("resolves identically in log mode — keying must not follow enforcement", () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "log";
    expect(resolveClientIdentity(cfRequest("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("resolves identically with EDGE_MODE unset — the rollback footgun", () => {
    // Setting EDGE_MODE=off while DNS is orange-clouded used to collapse every
    // limiter onto per-PoP buckets. Identity must never depend on the
    // enforcement flag (2026-08-06 audit).
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    delete process.env.EDGE_MODE;
    expect(resolveClientIdentity(cfRequest("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("ignores cf-connecting-ip when the origin proof fails (forgery guard)", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    const forged = {
      headers: {
        "x-forwarded-for": "198.51.100.9, 84.17.44.227",
        "cf-connecting-ip": "203.0.113.7",
        // no valid x-dime-edge-secret
      },
      ip: "84.17.44.227",
    };
    expect(resolveClientIdentity(forged)).toBe("198.51.100.9");
  });

  it("returns the direct client on a non-Cloudflare origin hit", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    // The real T-Mobile direct-origin shape observed on 2026-08-06.
    const direct = {
      headers: { "x-forwarded-for": "172.56.76.93, 152.233.23.193" },
      ip: "152.233.23.193",
    };
    expect(resolveClientIdentity(direct)).toBe("172.56.76.93");
  });

  it("reports its source for observability", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    expect(identitySource(cfRequest("203.0.113.7"))).toBe("cf-connecting-ip");
  });
});
