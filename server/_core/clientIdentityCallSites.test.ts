/**
 * clientIdentityCallSites.test.ts
 *
 * Task 3.3 (2026-08-06 audit): the six express-rate-limit `handler` blocks in
 * server/_core/index.ts re-derived the client IP from raw XFF even though
 * their own `keyGenerator` already computed it correctly via clientIpKey —
 * so every RATE_LIMIT security_events row and every Discord alert those
 * limiters emit carried the Cloudflare PoP, not the true visitor. Separately,
 * server/_core/trpc.ts's CSRF and Stripe loggers used `req.ip`, which under
 * `trust proxy 1` resolves to the RIGHTMOST XFF token — Railway's own edge
 * node, shared by every visitor — and that value was persisted to
 * security_events.ip AND used as the Discord dedup key.
 *
 * Both bugs are fixed by routing every site through the single
 * resolveClientIdentity() surface (server/_core/clientIdentity.ts, already
 * tested in isolation by clientIdentity.test.ts). A test that only calls
 * resolveClientIdentity() directly proves nothing about whether a given call
 * site was actually migrated — so every test below drives the real call
 * site instead.
 *
 * ─── Section A: server/_core/index.ts ────────────────────────────────────
 * index.ts self-executes `startServer()` at import time (binds a port,
 * connects to the DB, starts the Discord bot, background schedulers…), so —
 * as established by server/_core/ledgerGuardAndAlerts.test.ts and
 * server/stripeWebhook.test.ts — it is never imported directly in this
 * repo's tests; it is read as source text instead. This section follows
 * that same pattern, scoped tightly enough per call site (via the unique
 * `fireRateLimitEvent(ip, req.path, req.method, "<type>", ua)` marker each
 * handler already emits) that reverting any ONE handler's ip derivation
 * fails only its own assertion, not the others.
 *
 * ─── Section B: server/_core/trpc.ts ─────────────────────────────────────
 * trpc.ts has no self-execution, so its two loggers are driven LIVE through
 * appRouter.createCaller with a production-shaped request (PoP + Railway
 * edge XFF, cf-connecting-ip, valid edge proof) — the actual call site.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "./context";

// ─── Section A: server/_core/index.ts (source-contract) ──────────────────────

const INDEX_SRC = readFileSync(
  path.join(import.meta.dirname, "index.ts"),
  "utf8"
);

/**
 * Slice the ~400 chars immediately preceding a limiter's unique
 * `fireRateLimitEvent(ip, req.path, req.method, "<type>", ua)` call — this
 * is where each handler's `const ip = ...` derivation lives.
 */
function handlerSlice(limiterType: string): string {
  const marker = `fireRateLimitEvent(ip, req.path, req.method, "${limiterType}", ua);`;
  const idx = INDEX_SRC.indexOf(marker);
  expect(
    idx,
    `marker not found for limiterType=${limiterType} — has index.ts been restructured?`
  ).toBeGreaterThan(-1);
  return INDEX_SRC.slice(Math.max(0, idx - 400), idx);
}

describe("server/_core/index.ts — imports the single client-identity surface", () => {
  it("imports resolveClientIdentity + identitySource from ./clientIdentity", () => {
    expect(INDEX_SRC).toMatch(
      /import\s*\{\s*resolveClientIdentity\s*,\s*identitySource\s*\}\s*from\s*"\.\/clientIdentity";/
    );
  });
});

describe("server/_core/index.ts — six rate-limit handlers key their security telemetry off resolveClientIdentity, not a re-derived raw XFF (2026-08-06 audit)", () => {
  const sites: Array<[type: string, limiterName: string]> = [
    ["global", "globalApiLimiter"],
    ["auth", "authLimiter"],
    ["trpc_auth", "trpcAuthLimiter"],
    ["stripe_checkout", "stripeCheckoutLimiter"],
    ["waitlist_submit", "waitlistSubmitLimiter"],
    ["public_feed", "feedProcedureLimiter"],
  ];

  for (const [type, name] of sites) {
    it(`${name}'s handler resolves ip via resolveClientIdentity(req), matching its own keyGenerator's identity`, () => {
      const body = handlerSlice(type);
      expect(body).toMatch(
        /const ip = resolveClientIdentity\(req\) \|\| "unknown";/
      );
      // The old bug: re-splitting x-forwarded-for by hand inside the handler,
      // which — unlike clientIpKey/resolveClientIdentity — never consulted
      // cf-connecting-ip, so it always resolved to the Cloudflare PoP.
      expect(body).not.toMatch(/x-forwarded-for/);
      expect(body).not.toMatch(/\?\.split\(","\)\[0\]/);
    });
  }
});

describe("server/_core/index.ts — request + health loggers record the true visitor and its source", () => {
  it("top-level request logger uses resolveClientIdentity + identitySource, and the entry log line carries ipSrc", () => {
    const start = INDEX_SRC.indexOf("Top-level request logger");
    expect(start).toBeGreaterThan(-1);
    const end = INDEX_SRC.indexOf("non-www canonical redirect");
    expect(end).toBeGreaterThan(start);
    const block = INDEX_SRC.slice(start, end);

    expect(block).toMatch(
      /const ip = resolveClientIdentity\(req\) \|\| "unknown";/
    );
    expect(block).toMatch(/const ipSrc = identitySource\(req\);/);
    expect(block).toMatch(/\[HTTP_REQUEST\] → .*ipSrc=\$\{ipSrc\}/);
    expect(block).not.toMatch(/x-forwarded-for"\]\s*as string/);
  });

  it("/health logger uses resolveClientIdentity + identitySource and logs ipSrc", () => {
    const start = INDEX_SRC.indexOf('app.get("/health"');
    expect(start).toBeGreaterThan(-1);
    const end = INDEX_SRC.indexOf('app.get("/api/db-status"');
    expect(end).toBeGreaterThan(start);
    const block = INDEX_SRC.slice(start, end);

    expect(block).toMatch(
      /const ip = resolveClientIdentity\(req\) \|\| "unknown";/
    );
    expect(block).toMatch(/const ipSrc = identitySource\(req\);/);
    expect(block).toMatch(
      /\[HEALTH_CHECK\] GET \/health \| ip=\$\{logSafe\(ip\)\} ipSrc=\$\{ipSrc\}/
    );
  });
});

// ─── Section B: server/_core/trpc.ts (live middleware, actual call sites) ────

const POP = "104.22.17.115"; // Cloudflare PoP
const RAILWAY_EDGE = "84.17.44.227"; // Railway's own edge node — the rightmost XFF token under trust proxy 1, shared by every visitor
const TRUE_CLIENT = "203.0.113.7"; // the real visitor — appears ONLY in cf-connecting-ip
const EDGE_SECRET = "test-secret";

const ORIGINAL_EDGE_MODE = process.env.EDGE_MODE;
const ORIGINAL_EDGE_ORIGIN_SECRET = process.env.EDGE_ORIGIN_SECRET;

/** Production-shaped request: [CF PoP, Railway edge] XFF + verified cf-connecting-ip. */
function cfReq(opts: { method: string; origin?: string }) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `${POP}, ${RAILWAY_EDGE}`,
    "cf-connecting-ip": TRUE_CLIENT,
    "x-dime-edge-secret": EDGE_SECRET,
  };
  return {
    method: opts.method,
    headers,
    ip: RAILWAY_EDGE, // trust proxy 1 => req.ip resolves to the rightmost XFF token
    socket: { remoteAddress: RAILWAY_EDGE },
    get(name: string) {
      if (name.toLowerCase() === "origin") return opts.origin;
      const v = headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
  } as unknown as TrpcContext["req"];
}

function captureConsole(): string[] {
  const lines: string[] = [];
  const sink = (...args: unknown[]) =>
    lines.push(args.map(a => String(a)).join(" "));
  vi.spyOn(console, "log").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  return lines;
}

describe("server/_core/trpc.ts — CSRF + Stripe loggers key off resolveClientIdentity, not req.ip (2026-08-06 audit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_EDGE_MODE === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = ORIGINAL_EDGE_MODE;
    if (ORIGINAL_EDGE_ORIGIN_SECRET === undefined)
      delete process.env.EDGE_ORIGIN_SECRET;
    else process.env.EDGE_ORIGIN_SECRET = ORIGINAL_EDGE_ORIGIN_SECRET;
  });

  it("csrfOriginCheck's audit log records the true cf-connecting-ip visitor, not the Railway edge — driven through the real appUsers.login mutation", async () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = EDGE_SECRET;
    const lines = captureConsole();

    const ctx: TrpcContext = {
      req: cfReq({
        method: "POST",
        origin: "https://not-an-allowed-origin.example",
      }),
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    // CSRF blocks (throws FORBIDDEN) before any DB query, so this needs no
    // DATABASE_URL — same reasoning as server/loginStatus.test.ts.
    await expect(
      caller.appUsers.login({
        emailOrUsername: "someone@example.com",
        password: "irrelevant",
        stayLoggedIn: false,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const csrfLines = lines.filter(l => l.startsWith("[CSRF]"));
    expect(csrfLines.length).toBeGreaterThan(0);
    const joined = csrfLines.join("\n");
    expect(joined).toContain(`IP=${TRUE_CLIENT}`);
    expect(joined).not.toContain(`IP=${RAILWAY_EDGE}`);
    expect(joined).not.toContain(`IP=${POP}`);
  });

  it("the Stripe procedure logger records the true cf-connecting-ip visitor, not the Railway edge — driven through the real stripe.publicGetConfig query", async () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = EDGE_SECRET;
    const lines = captureConsole();

    const ctx: TrpcContext = {
      req: cfReq({ method: "GET" }),
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    // publicGetConfig is synchronous and DB-free — safe with no DATABASE_URL.
    await caller.stripe.publicGetConfig();

    const stripeLines = lines.filter(l => l.startsWith("[Stripe]"));
    expect(stripeLines.length).toBeGreaterThan(0);
    const joined = stripeLines.join("\n");
    expect(joined).toContain(`IP=${TRUE_CLIENT}`);
    expect(joined).not.toContain(`IP=${RAILWAY_EDGE}`);
    expect(joined).not.toContain(`IP=${POP}`);
  });
});
