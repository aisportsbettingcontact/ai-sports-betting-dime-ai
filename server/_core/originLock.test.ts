import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originLock, type OriginLockEvent } from "./originLock";

const SECRET = "e".repeat(48);
const CF_IP = "104.16.9.9"; // in 104.16.0.0/13

type MockRes = {
  statusCode: number | null;
  ended: boolean;
  status: (c: number) => MockRes;
  end: () => void;
};
function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: null,
    ended: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    end() {
      this.ended = true;
    },
  };
  return res;
}
const mkReq = (
  headers: Record<string, string> = {},
  path = "/api/trpc/games.list"
) => ({ headers, ip: "10.0.0.9", path }) as any;

function run(reqHeaders: Record<string, string>, path?: string) {
  const events: OriginLockEvent[] = [];
  const mw = originLock(k => events.push(k));
  const req = mkReq(reqHeaders, path);
  const res = mockRes();
  const next = vi.fn();
  mw(req, res as any, next);
  return { req, res, next, events };
}

describe("originLock", () => {
  const orig = {
    mode: process.env.EDGE_MODE,
    s: process.env.EDGE_ORIGIN_SECRET,
    p: process.env.EDGE_ORIGIN_SECRET_PREV,
  };
  beforeEach(() => {
    delete process.env.EDGE_MODE;
    delete process.env.EDGE_ORIGIN_SECRET;
    delete process.env.EDGE_ORIGIN_SECRET_PREV;
  });
  afterEach(() => {
    orig.mode === undefined
      ? delete process.env.EDGE_MODE
      : (process.env.EDGE_MODE = orig.mode);
    orig.s === undefined
      ? delete process.env.EDGE_ORIGIN_SECRET
      : (process.env.EDGE_ORIGIN_SECRET = orig.s);
    orig.p === undefined
      ? delete process.env.EDGE_ORIGIN_SECRET_PREV
      : (process.env.EDGE_ORIGIN_SECRET_PREV = orig.p);
  });

  it("off/unset: pure pass-through, no edgeVerified, no events", () => {
    const { res, next, req, events } = run({ "x-forwarded-for": "1.2.3.4" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
    expect(req.edgeVerified).toBeUndefined();
    expect(events).toEqual([]);
  });

  it("on + valid secret + CF-range upstream: next() and edgeVerified=true", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    const { res, next, req } = run({
      "x-dime-edge-secret": SECRET,
      "x-forwarded-for": CF_IP,
    });
    expect(next).toHaveBeenCalledOnce();
    expect(req.edgeVerified).toBe(true);
    expect(res.ended).toBe(false);
  });

  it("on + no secret header: 403 on the API path", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    const { res, next, events } = run({ "x-forwarded-for": CF_IP });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.ended).toBe(true);
    expect(events).toContain("edge_deny");
  });

  it("on + valid secret but NON-CF upstream: 403 (direct-origin spoof with a leaked secret still needs a CF hop)", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    const { res } = run({
      "x-dime-edge-secret": SECRET,
      "x-forwarded-for": "203.0.113.4",
    });
    expect(res.statusCode).toBe(403);
  });

  it("on + wrong secret: 403", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    const { res } = run({
      "x-dime-edge-secret": "nope",
      "x-forwarded-for": CF_IP,
    });
    expect(res.statusCode).toBe(403);
  });

  it("on: /health is always reachable without a secret", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    const { res, next } = run({}, "/health");
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
  });

  it("on + NO secret configured: anti-lockout — next() (no 403) + edge_no_secret event", () => {
    process.env.EDGE_MODE = "on"; // secret intentionally unset
    const { res, next, events } = run({ "x-forwarded-for": "203.0.113.4" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
    expect(events).toContain("edge_no_secret");
  });

  it("log: bad proof does NOT block — next() + edge_would_deny", () => {
    process.env.EDGE_MODE = "log";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    const { res, next, events } = run({ "x-forwarded-for": "203.0.113.4" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
    expect(events).toContain("edge_would_deny");
  });

  it("log: good proof sets edgeVerified (honest keying during the soak)", () => {
    process.env.EDGE_MODE = "log";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    const { req, next } = run({
      "x-dime-edge-secret": SECRET,
      "x-forwarded-for": CF_IP,
    });
    expect(next).toHaveBeenCalledOnce();
    expect(req.edgeVerified).toBe(true);
  });

  it("on: the PREV secret is accepted (zero-downtime rotation)", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "new-value-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.EDGE_ORIGIN_SECRET_PREV = SECRET;
    const { req, res, next } = run({
      "x-dime-edge-secret": SECRET,
      "x-forwarded-for": CF_IP,
    });
    expect(next).toHaveBeenCalledOnce();
    expect(req.edgeVerified).toBe(true);
    expect(res.statusCode).toBeNull();
  });
});

describe("originLock — self-healing circuit breaker (Phase 4 residual)", () => {
  const orig = {
    mode: process.env.EDGE_MODE,
    s: process.env.EDGE_ORIGIN_SECRET,
  };
  beforeEach(() => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
  });
  afterEach(() => {
    orig.mode === undefined
      ? delete process.env.EDGE_MODE
      : (process.env.EDGE_MODE = orig.mode);
    orig.s === undefined
      ? delete process.env.EDGE_ORIGIN_SECRET
      : (process.env.EDGE_ORIGIN_SECRET = orig.s);
  });

  // tiny config: trip needs 2 CONSECUTIVE starved windows (>=2 unverified, 0 verified)
  const cfg = {
    windowMs: 1000,
    minSample: 2,
    verifiedFloor: 0,
    tripWindows: 2,
    recoverFloor: 2,
    disabled: false,
  };
  const UNVERIFIED = { "x-forwarded-for": "203.0.113.4" }; // non-CF, no secret
  const VERIFIED = { "x-dime-edge-secret": SECRET, "x-forwarded-for": CF_IP };

  function harness() {
    const now = { t: 0 };
    const events: OriginLockEvent[] = [];
    const mw = originLock(k => events.push(k), {
      breakerConfig: cfg,
      now: () => now.t,
    });
    const fire = (headers: Record<string, string>, path?: string) => {
      const res = mockRes();
      const next = vi.fn();
      mw(mkReq(headers, path), res as any, next);
      return { res, next };
    };
    const at = (t: number) => {
      now.t = t;
    };
    return { events, fire, at };
  }

  it("enforces (403) through starved windows, AUTO-DOWNGRADES only after tripWindows consecutive", () => {
    const { events, fire, at } = harness();
    // window 1: unverified → still enforcing → 403 (one starved window is NOT enough)
    at(0);
    expect(fire(UNVERIFIED).res.statusCode).toBe(403);
    expect(fire(UNVERIFIED).res.statusCode).toBe(403);
    // window 2: closes w1 (consec=1) — still enforcing → 403
    at(1000);
    expect(fire(UNVERIFIED).res.statusCode).toBe(403);
    expect(fire(UNVERIFIED).res.statusCode).toBe(403);
    // window 3: closes w2 (consec=2) → TRIP → this request is downgraded
    at(2000);
    const trip = fire(UNVERIFIED);
    expect(trip.res.statusCode).toBeNull();
    expect(events).toContain("edge_breaker_tripped");
    // stays downgraded (site up)
    expect(fire(UNVERIFIED).res.statusCode).toBeNull();
  });

  it("UN-GAMEABLE: one genuine Cloudflare request per window blocks the trip forever", () => {
    const { events, fire, at } = harness();
    // every window mixes a real CF user in with the flood → no window is ever starved
    for (let w = 0; w < 5; w++) {
      at(w * 1000);
      fire(UNVERIFIED);
      fire(UNVERIFIED);
      fire(VERIFIED);
    }
    expect(events).not.toContain("edge_breaker_tripped");
    // enforcement still live: an unverified request is 403'd
    at(6000);
    expect(fire(UNVERIFIED).res.statusCode).toBe(403);
  });

  it("recovers when verified Cloudflare traffic returns, resuming enforcement", () => {
    const { events, fire, at } = harness();
    at(0);
    fire(UNVERIFIED);
    fire(UNVERIFIED);
    at(1000);
    fire(UNVERIFIED);
    fire(UNVERIFIED);
    at(2000);
    fire(UNVERIFIED); // trips
    expect(events).toContain("edge_breaker_tripped");
    // verified traffic returns → recoverFloor(2) reached → recovered
    fire(VERIFIED);
    fire(VERIFIED);
    expect(events).toContain("edge_breaker_recovered");
    at(3000);
    expect(fire(UNVERIFIED).res.statusCode).toBe(403); // enforcement resumed
  });

  it("never observes/trips in 'log' mode (no 403 to prevent)", () => {
    process.env.EDGE_MODE = "log";
    const { events, fire, at } = harness();
    for (let w = 0; w < 6; w++) {
      at(w * 1000);
      expect(fire(UNVERIFIED).res.statusCode).toBeNull();
      expect(fire(UNVERIFIED).res.statusCode).toBeNull();
    }
    expect(events).not.toContain("edge_breaker_tripped");
    expect(events).toContain("edge_would_deny");
  });

  it("does NOT feed the breaker in on+no-secret mode (no spurious trip; anti-lockout only)", () => {
    delete process.env.EDGE_ORIGIN_SECRET; // EDGE_MODE=on but secret unset
    const { events, fire, at } = harness();
    for (let w = 0; w < 6; w++) {
      at(w * 1000);
      fire(UNVERIFIED);
      fire(UNVERIFIED);
    }
    // the breaker never observed → no misleading edge_breaker_tripped;
    // every request took the anti-lockout downgrade instead
    expect(events).not.toContain("edge_breaker_tripped");
    expect(events).toContain("edge_no_secret");
  });
});
