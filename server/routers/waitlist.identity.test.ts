/**
 * server/routers/waitlist.identity.test.ts
 *
 * Task 3.4 (2026-08-06 audit): waitlist.submit derived `ipAddress` from raw
 * leftmost XFF and persisted it to waitlist.ipAddress on every new signup
 * row. Since the Cloudflare orange-cloud, Railway's XFF is
 * [Cloudflare PoP, Railway edge] — Railway discards Cloudflare's appended
 * client token, so the true visitor exists only in `cf-connecting-ip`. Every
 * stored value has therefore been a Cloudflare PoP, not the signup's origin
 * — IRRECOVERABLE, because no second column holds the truth. Fixed by
 * routing through the single resolveClientIdentity() surface
 * (server/_core/clientIdentity.ts, already unit-tested in isolation by
 * clientIdentity.test.ts).
 *
 * A test that only calls resolveClientIdentity() directly proves nothing
 * about whether THIS call site was actually migrated — that exact failure
 * mode already happened once in this program (see the header comment on
 * server/_core/clientIdentityCallSites.test.ts). So this test drives the
 * real waitlist.submit mutation through appRouter.createCaller with a
 * production-shaped request and asserts on the ipAddress value that
 * actually reaches submitWaitlist — submitWaitlist itself is mocked so no
 * real database is touched.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../waitlistDb", async importOriginal => {
  const original = await importOriginal<typeof import("../waitlistDb")>();
  return {
    ...original,
    submitWaitlist: vi.fn().mockResolvedValue({ ok: true, id: 1 }),
  };
});

import { appRouter } from "../routers";
import * as waitlistDb from "../waitlistDb";
import type { TrpcContext } from "../_core/context";

const POP = "104.22.17.115"; // Cloudflare PoP
const RAILWAY_EDGE = "84.17.44.227"; // Railway's own edge node — the rightmost XFF token under trust proxy 1
const TRUE_CLIENT = "203.0.113.7"; // the real signup origin — appears ONLY in cf-connecting-ip
const EDGE_SECRET = "test-secret";

const ORIGINAL_EDGE_MODE = process.env.EDGE_MODE;
const ORIGINAL_EDGE_ORIGIN_SECRET = process.env.EDGE_ORIGIN_SECRET;

/** Production-shaped request: [CF PoP, Railway edge] XFF + verified cf-connecting-ip. */
function cfReq() {
  const headers: Record<string, string> = {
    "x-forwarded-for": `${POP}, ${RAILWAY_EDGE}`,
    "cf-connecting-ip": TRUE_CLIENT,
    "x-dime-edge-secret": EDGE_SECRET,
    "user-agent": "vitest-waitlist-identity",
  };
  return {
    method: "POST",
    headers,
    ip: RAILWAY_EDGE, // trust proxy 1 => req.ip resolves to the rightmost XFF token
    socket: { remoteAddress: RAILWAY_EDGE },
    get(name: string) {
      // No Origin header set — isOriginAllowed() treats absent Origin as a
      // server-to-server call and passes the CSRF check (see trpc.ts).
      const v = headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
  } as unknown as TrpcContext["req"];
}

describe("waitlist.submit — persists the true visitor via resolveClientIdentity, not raw XFF (2026-08-06 audit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_EDGE_MODE === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = ORIGINAL_EDGE_MODE;
    if (ORIGINAL_EDGE_ORIGIN_SECRET === undefined)
      delete process.env.EDGE_ORIGIN_SECRET;
    else process.env.EDGE_ORIGIN_SECRET = ORIGINAL_EDGE_ORIGIN_SECRET;
  });

  it("submitWaitlist is called with cf-connecting-ip's true client, not the Cloudflare PoP or the Railway edge hop", async () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = EDGE_SECRET;

    const ctx: TrpcContext = {
      req: cfReq(),
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    const result = await caller.waitlist.submit({
      email: "signup@example.com",
    });

    expect(result.ok).toBe(true);

    const mockSubmit = waitlistDb.submitWaitlist as ReturnType<typeof vi.fn>;
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const callArgs = mockSubmit.mock.calls[0][0] as { ipAddress?: string };

    // This is the assertion a raw-XFF regression flips: it would resolve to
    // POP instead of TRUE_CLIENT.
    expect(callArgs.ipAddress).toBe(TRUE_CLIENT);
    expect(callArgs.ipAddress).not.toBe(POP);
    expect(callArgs.ipAddress).not.toBe(RAILWAY_EDGE);
  });
});
