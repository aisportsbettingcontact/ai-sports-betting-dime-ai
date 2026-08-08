import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeBreakerConfig } from "./edgeCircuitBreaker";
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
  //
  // `EdgeBreakerConfig` is annotated EXPLICITLY (2026-08-07 review, Important 2).
  // This object previously omitted `bypassAlertFraction`/`bypassAlertWindows`,
  // which are REQUIRED on the interface — and because tsconfig.json excludes
  // `**/*.test.ts`, `tsc --noEmit` never saw the error. Both read `undefined` at
  // runtime, and `unverifiedFraction >= undefined` / `consecutiveBypassSuspect >=
  // undefined` are ALWAYS false (edgeCircuitBreaker.ts:249,269), so partial-bypass
  // detection was silently dead in this harness rather than deliberately off.
  //
  // The type annotation is the real fix: it makes any future omission a compile
  // error in every checker that reads this file (the out-of-band tsc run in the
  // header comment below, and editors/CI that do not honour the test exclude).
  //
  // The VALUES keep detection deliberately INERT, so the five pre-existing
  // trip/recover assertions keep asserting exactly what they asserted before —
  // no `edge_partial_bypass_*` event can enter their event streams. Two
  // independently sufficient inerts, neither relying on the other:
  //   - fraction 2 is structurally unreachable: unverifiedFraction is
  //     (total - verified) / total, which is <= 1 by construction.
  //   - MAX_SAFE_INTEGER consecutive suspect windows is unreachable in a test
  //     that closes at most six.
  // Detection ON is exercised separately, by BYPASS_ALERT_CFG below.
  const cfg: EdgeBreakerConfig = {
    windowMs: 1000,
    minSample: 2,
    verifiedFloor: 0,
    tripWindows: 2,
    recoverFloor: 2,
    bypassAlertFraction: 2, // inert: no fraction can reach 2
    bypassAlertWindows: Number.MAX_SAFE_INTEGER, // inert: never reached
    disabled: false,
  };
  const UNVERIFIED = { "x-forwarded-for": "203.0.113.4" }; // non-CF, no secret
  const VERIFIED = { "x-dime-edge-secret": SECRET, "x-forwarded-for": CF_IP };

  /**
   * Detection ON. Separate from `cfg` on purpose: the trip/recover tests must
   * keep the partial-bypass path inert (see `cfg`), while THIS config proves
   * originLock actually routes the two alert-only breaker events to onEvent —
   * a path with zero coverage anywhere in the suite before 2026-08-07.
   *
   * A window here is bypass-suspect when it closes with >= minSample
   * observations, at least one VERIFIED request (so not starved — the two
   * conditions are disjoint by design), and >= 50% unverified.
   */
  const BYPASS_ALERT_CFG: EdgeBreakerConfig = {
    ...cfg,
    tripWindows: Number.MAX_SAFE_INTEGER, // never trip: isolate the alert path
    bypassAlertFraction: 0.5,
    bypassAlertWindows: 2,
  };

  function harness(breakerConfig: EdgeBreakerConfig = cfg) {
    const now = { t: 0 };
    const events: OriginLockEvent[] = [];
    const mw = originLock(k => events.push(k), {
      breakerConfig,
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

  it("partial-bypass detection is INERT under `cfg` — the trip/recover tests measure only the trip path", () => {
    // Pins the inert values as INTENT rather than accident. Under the old
    // harness these two fields were `undefined`, which produced the same
    // (empty) result for the opposite reason — a type hole, not a decision.
    // The sustained 2/3-unverified pattern below is exactly the shape
    // BYPASS_ALERT_CFG flags in the next test, so a green here is a real
    // statement about the config, not about the traffic.
    const { events, fire, at } = harness();
    for (let w = 0; w < 6; w++) {
      at(w * 1000);
      fire(UNVERIFIED);
      fire(UNVERIFIED);
      fire(VERIFIED);
    }
    expect(events).not.toContain("edge_partial_bypass_suspected");
    expect(events).not.toContain("edge_partial_bypass_cleared");
  });

  it("ALERT-ONLY: routes edge_partial_bypass_suspected → cleared to onEvent, and NEVER changes enforcement", () => {
    const { events, fire, at } = harness(BYPASS_ALERT_CFG);

    // w0: 3 unverified + 1 verified → not starved, 75% unverified → suspect
    at(0);
    fire(UNVERIFIED);
    fire(UNVERIFIED);
    fire(UNVERIFIED);
    fire(VERIFIED);
    // w1: the first fire closes w0 (consecutiveBypassSuspect = 1)
    at(1000);
    fire(UNVERIFIED);
    fire(UNVERIFIED);
    fire(UNVERIFIED);
    fire(VERIFIED);
    expect(events).not.toContain("edge_partial_bypass_suspected"); // 1 < 2 windows
    // w2: the first fire closes w1 (consecutiveBypassSuspect = 2) → ALERT
    at(2000);
    fire(VERIFIED);
    expect(events).toContain("edge_partial_bypass_suspected");
    expect(events).not.toContain("edge_breaker_tripped"); // disjoint from starvation

    // ENFORCEMENT UNCHANGED — the load-bearing property. A fraction rule must
    // never be able to drop the lock (an attacker controls the numerator).
    expect(fire(UNVERIFIED).res.statusCode).toBe(403);

    // w2 now holds 1 unverified + 2 verified... top it up to a clean window so
    // it closes below the alert fraction.
    fire(VERIFIED);
    fire(VERIFIED);
    // w3: the first fire closes w2 (33% unverified < 50%) → streak 0 → CLEARED
    at(3000);
    fire(VERIFIED);
    expect(events).toContain("edge_partial_bypass_cleared");
    expect(fire(UNVERIFIED).res.statusCode).toBe(403); // still enforcing
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

/**
 * Task 5.3 Step 4 — the BOOT assertion.
 *
 * The fault "EDGE_MODE is armed but no origin secret is configured" used to be
 * discoverable only on the FIRST REQUEST that reached the middleware. Railway's
 * healthcheck probes `/health`, which the lock exempts, so a misconfigured
 * deploy went green and stayed silent until real traffic arrived. These tests
 * pin the one-shot boot-time signal: it fires at CONSTRUCTION (no request is
 * ever dispatched in this block), it is tagged `[boot]` so it is distinguishable
 * from the per-request escalation in server/_core/index.ts, it does not fire
 * when a secret IS configured (either variable), it stays silent while the
 * feature is dormant, it never throws, and it never emits an OriginLockEvent
 * (which would consume index.ts's once-per-minute edge_no_secret budget and
 * suppress the first real request's escalation).
 */
describe("originLock — boot assertion when armed with no origin secret (Task 5.3 §4)", () => {
  const orig = {
    mode: process.env.EDGE_MODE,
    s: process.env.EDGE_ORIGIN_SECRET,
    p: process.env.EDGE_ORIGIN_SECRET_PREV,
  };
  // Captured explicitly rather than read back off the spy's `.mock.calls`:
  // tsconfig excludes **/*.test.ts from `tsc --noEmit`, so a loosely-typed
  // accumulator here would silently degrade to `any` and never fail a gate.
  // Typechecked out-of-band against the repo tsconfig with the exclude lifted.
  let consoleErrors: string[] = [];
  /**
   * EVERY boot-time console line, across error/warn/log. The no-leak test needs
   * the whole surface, not just console.error: originLock()'s boot path also
   * reaches cfCidrStalenessWarning() (console.warn), and a leak on any channel
   * is a leak. (2026-08-07 review, Minor 3.)
   */
  let consoleAll: string[] = [];
  let restoreConsole: () => void = () => {};

  beforeEach(() => {
    delete process.env.EDGE_MODE;
    delete process.env.EDGE_ORIGIN_SECRET;
    delete process.env.EDGE_ORIGIN_SECRET_PREV;
    consoleErrors = [];
    consoleAll = [];
    const capture =
      (sink: string[][]) =>
      (...args: unknown[]) => {
        const line = args.map(a => String(a)).join(" ");
        for (const s of sink) s.push(line);
      };
    const spies = [
      vi
        .spyOn(console, "error")
        .mockImplementation(capture([consoleErrors, consoleAll])),
      vi.spyOn(console, "warn").mockImplementation(capture([consoleAll])),
      vi.spyOn(console, "log").mockImplementation(capture([consoleAll])),
    ];
    restoreConsole = () => spies.forEach(s => s.mockRestore());
  });
  afterEach(() => {
    restoreConsole();
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

  /** Only the boot-tagged CRITICAL lines, ignoring any other console.error. */
  const bootCriticals = (): string[] =>
    consoleErrors.filter(l => l.includes("[edge][origin-lock][boot]"));

  it("on + NO secret: fires the CRITICAL boot line at construction, before any request", () => {
    process.env.EDGE_MODE = "on"; // secret intentionally unset
    const events: OriginLockEvent[] = [];
    originLock(k => events.push(k)); // CONSTRUCT ONLY — no request dispatched
    const lines = bootCriticals();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("CRITICAL");
    expect(lines[0]).toContain("EDGE_MODE=on");
    expect(lines[0]).toContain("EDGE_ORIGIN_SECRET");
    // No OriginLockEvent at boot: routing this through onEvent would burn
    // index.ts's once-per-minute edge_no_secret escalation budget and silence
    // the first real request.
    expect(events).toEqual([]);
  });

  it("log + NO secret: also fires (an unverifiable soak must not be used as an arming gate)", () => {
    process.env.EDGE_MODE = "log";
    originLock();
    const lines = bootCriticals();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("EDGE_MODE=log");
  });

  it("on + secret configured: SILENT — no boot line at all", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    originLock();
    expect(bootCriticals()).toEqual([]);
  });

  it("on + ONLY _PREV configured: SILENT — mid-rotation overlap still counts as configured", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET_PREV = SECRET;
    originLock();
    expect(bootCriticals()).toEqual([]);
  });

  it("off/unset + NO secret: SILENT — the dormant feature must stay inert at boot", () => {
    originLock(); // EDGE_MODE unset
    expect(bootCriticals()).toEqual([]);
    process.env.EDGE_MODE = "off";
    originLock();
    expect(bootCriticals()).toEqual([]);
  });

  it("never throws and never crashes boot (anti-lockout: unprotected must not become offline)", () => {
    process.env.EDGE_MODE = "on";
    expect(() => originLock()).not.toThrow();
    // and the constructed middleware still serves the request (anti-lockout)
    const mw = originLock();
    const res = mockRes();
    const next = vi.fn();
    mw(mkReq({ "x-forwarded-for": "203.0.113.4" }), res as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
  });

  it("the boot line is tagged distinctly from the per-request escalation", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET_PREV = SECRET;
    originLock();
    expect(bootCriticals()).toEqual([]); // configured → silent

    // now the unconfigured case: the line exists
    delete process.env.EDGE_ORIGIN_SECRET_PREV;
    consoleErrors.length = 0;
    originLock();
    const lines = bootCriticals();
    expect(lines).toHaveLength(1);
    // The per-request escalation in index.ts logs "[edge][origin-lock] CRITICAL
    // EDGE_MODE=on but no EDGE_ORIGIN_SECRET configured — anti-lockout ...".
    // The boot line must NOT be mistakable for it in log search.
    expect(lines[0]).not.toContain("anti-lockout downgrade to observe-only");
  });

  it("with both secrets CONFIGURED the boot console surface is empty — nowhere for a value to leak", () => {
    // 2026-08-07 review, Minor 3. The previous version asserted
    // `expect(lines[0]).not.toContain(SECRET)` against the *unconfigured* boot
    // line, taken AFTER `delete process.env.EDGE_ORIGIN_SECRET_PREV`. At that
    // instant no secret existed anywhere in the process, so nothing could have
    // leaked and the assertion could not fail in any universe. And it is
    // structurally vacuous, not merely lucky: the boot line fires ONLY when
    // `hasOriginSecretConfigured()` is false, so a state with both a secret and
    // a boot line does not exist.
    //
    // The only non-vacuous form of "it does not leak" is therefore a POSITIVE
    // claim about the whole boot surface while secrets ARE configured: it emits
    // NOTHING. That assertion can go red — any future boot line (leaking or
    // not) breaks it and forces a review — whereas `not.toContain` over an
    // empty capture never can. Verified empty out-of-band under
    // EDGE_MODE=on + both variables set.
    const PREV = "f".repeat(48);
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = SECRET;
    process.env.EDGE_ORIGIN_SECRET_PREV = PREV;
    originLock();

    // The whole surface, not just console.error: nothing on error, warn, or log.
    // (`cfCidrStalenessWarning()` is the one line that may legitimately appear
    // here; if it ever does, allowlist it explicitly rather than loosening this
    // to a substring check.)
    expect(consoleAll).toEqual([]);

    // POSITIVE CONTROL, same capture, same construction path: prove the harness
    // above is actually wired to originLock's boot output, so the empty array
    // means "emitted nothing", not "captured nothing".
    delete process.env.EDGE_ORIGIN_SECRET;
    delete process.env.EDGE_ORIGIN_SECRET_PREV;
    originLock();
    expect(consoleAll).toHaveLength(1);
    expect(consoleAll[0]).toContain("[edge][origin-lock][boot] CRITICAL");
    // ...and that line names the VARIABLES, never their values (it cannot
    // contain a value — none is set when it fires; that is the whole point).
    expect(consoleAll[0]).toContain("EDGE_ORIGIN_SECRET_PREV");
    expect(consoleAll[0]).not.toContain(SECRET);
  });
});
