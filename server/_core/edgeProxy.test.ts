import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertNonEmptyCfRanges,
  cfConnectingIp,
  edgeMode,
  edgeProofPasses,
  hasOriginSecretConfigured,
  immediateUpstreamIp,
  isCloudflareEdgeIp,
  originSecretOk,
} from "./edgeProxy";

type H = Record<string, string | string[] | undefined>;
const req = (headers: H, ip = "10.0.0.1") =>
  ({ headers, ip }) as unknown as Parameters<typeof edgeProofPasses>[0];

const SECRET = "s".repeat(48);

describe("edgeProxy — edgeMode", () => {
  const orig = process.env.EDGE_MODE;
  afterEach(() => {
    if (orig === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = orig;
  });
  it("defaults to off when unset or garbage", () => {
    delete process.env.EDGE_MODE;
    expect(edgeMode()).toBe("off");
    process.env.EDGE_MODE = "banana";
    expect(edgeMode()).toBe("off");
    process.env.EDGE_MODE = "";
    expect(edgeMode()).toBe("off");
  });
  it("honors log/on case-insensitively", () => {
    process.env.EDGE_MODE = "LOG";
    expect(edgeMode()).toBe("log");
    process.env.EDGE_MODE = "on";
    expect(edgeMode()).toBe("on");
  });
});

describe("edgeProxy — IP extraction", () => {
  it("immediateUpstreamIp takes the leftmost XFF token, else req.ip", () => {
    expect(
      immediateUpstreamIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))
    ).toBe("1.2.3.4");
    expect(
      immediateUpstreamIp(req({ "x-forwarded-for": ["9.9.9.9, 1.1.1.1"] }))
    ).toBe("9.9.9.9");
    expect(immediateUpstreamIp(req({}, "203.0.113.7"))).toBe("203.0.113.7");
  });
  it("cfConnectingIp reads ONLY cf-connecting-ip (no true-client-ip fallback)", () => {
    expect(cfConnectingIp(req({ "cf-connecting-ip": "8.8.8.8" }))).toBe(
      "8.8.8.8"
    );
    // true-client-ip must be ignored — it is client/zone-forgeable.
    expect(cfConnectingIp(req({ "true-client-ip": "6.6.6.6" }))).toBeNull();
    expect(cfConnectingIp(req({}))).toBeNull();
  });
});

describe("edgeProxy — Cloudflare range membership (second factor only)", () => {
  it("matches known CF v4 addresses", () => {
    expect(isCloudflareEdgeIp("104.16.0.1")).toBe(true); // 104.16.0.0/13
    expect(isCloudflareEdgeIp("162.158.255.254")).toBe(true); // 162.158.0.0/15
    expect(isCloudflareEdgeIp("173.245.48.5")).toBe(true); // 173.245.48.0/20
  });
  it("matches a known CF v6 address and the v4-mapped form", () => {
    expect(isCloudflareEdgeIp("2606:4700::1")).toBe(true); // 2606:4700::/32
    expect(isCloudflareEdgeIp("::ffff:104.16.0.1")).toBe(true);
  });
  it("rejects public non-CF, private, and empty", () => {
    expect(isCloudflareEdgeIp("8.8.8.8")).toBe(false);
    expect(isCloudflareEdgeIp("203.0.113.9")).toBe(false);
    expect(isCloudflareEdgeIp("10.0.0.1")).toBe(false);
    expect(isCloudflareEdgeIp("2001:db8::1")).toBe(false);
    expect(isCloudflareEdgeIp("")).toBe(false);
  });
  it("boot guard passes with the checked-in snapshot", () => {
    expect(() => assertNonEmptyCfRanges()).not.toThrow();
  });
});

describe("edgeProxy — origin secret (constant-time)", () => {
  const orig = {
    s: process.env.EDGE_ORIGIN_SECRET,
    p: process.env.EDGE_ORIGIN_SECRET_PREV,
  };
  beforeEach(() => {
    delete process.env.EDGE_ORIGIN_SECRET;
    delete process.env.EDGE_ORIGIN_SECRET_PREV;
  });
  afterEach(() => {
    orig.s === undefined
      ? delete process.env.EDGE_ORIGIN_SECRET
      : (process.env.EDGE_ORIGIN_SECRET = orig.s);
    orig.p === undefined
      ? delete process.env.EDGE_ORIGIN_SECRET_PREV
      : (process.env.EDGE_ORIGIN_SECRET_PREV = orig.p);
  });
  it("false when no secret configured (missing secret can never pass)", () => {
    expect(hasOriginSecretConfigured()).toBe(false);
    expect(originSecretOk(SECRET)).toBe(false);
  });
  it("true only on exact match of SECRET or PREV", () => {
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    expect(originSecretOk(SECRET)).toBe(true);
    expect(originSecretOk(SECRET + "x")).toBe(false);
    expect(originSecretOk("wrong")).toBe(false);
    expect(originSecretOk("")).toBe(false);
    expect(originSecretOk(undefined)).toBe(false);
  });
  it("accepts the PREV secret for zero-downtime rotation", () => {
    process.env.EDGE_ORIGIN_SECRET = "new-secret-value-aaaaaaaaaaaaaaaaaaaa";
    process.env.EDGE_ORIGIN_SECRET_PREV = SECRET;
    expect(originSecretOk(SECRET)).toBe(true);
    expect(originSecretOk("new-secret-value-aaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(originSecretOk("neither")).toBe(false);
  });
});

describe("edgeProxy — edgeProofPasses (dual proof)", () => {
  const orig = process.env.EDGE_ORIGIN_SECRET;
  beforeEach(() => (process.env.EDGE_ORIGIN_SECRET = SECRET));
  afterEach(() =>
    orig === undefined
      ? delete process.env.EDGE_ORIGIN_SECRET
      : (process.env.EDGE_ORIGIN_SECRET = orig)
  );
  it("passes only with BOTH a valid secret AND a CF-range immediate upstream", () => {
    const cf = "104.16.5.5";
    expect(
      edgeProofPasses(
        req({ "x-dime-edge-secret": SECRET, "x-forwarded-for": cf })
      )
    ).toBe(true);
  });
  it("fails with a valid secret but non-CF upstream (leaked-secret-through-own-zone is NOT sufficient alone here)", () => {
    expect(
      edgeProofPasses(
        req({ "x-dime-edge-secret": SECRET, "x-forwarded-for": "203.0.113.1" })
      )
    ).toBe(false);
  });
  it("fails with a CF-range upstream but no/invalid secret (direct-origin spoof)", () => {
    expect(edgeProofPasses(req({ "x-forwarded-for": "104.16.5.5" }))).toBe(
      false
    );
    expect(
      edgeProofPasses(
        req({ "x-dime-edge-secret": "wrong", "x-forwarded-for": "104.16.5.5" })
      )
    ).toBe(false);
  });
});
