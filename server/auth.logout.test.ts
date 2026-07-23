/**
 * auth.logout.test.ts
 *
 * Tests the auth.logout tRPC procedure.
 *
 * [INPUT]  Authenticated TrpcContext with mocked req/res
 * [STEP]   Call auth.logout via appRouter.createCaller
 * [OUTPUT] Cookie cleared, success: true returned
 * [VERIFY] Cookie name, maxAge, secure, sameSite, httpOnly, path all match
 *
 * Mock req includes req.get() and req.method to satisfy the CSRF Origin check
 * middleware in trpc.ts. A missing Origin header (undefined) is the server-to-server
 * pattern — the CSRF check always allows it, so tests pass without needing a real origin.
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

/**
 * Build a minimal TrpcContext suitable for unit testing tRPC procedures.
 *
 * The mock req includes:
 *   - req.get(name)  — returns undefined for all headers (no Origin = server-to-server, CSRF allows)
 *   - req.method     — "POST" (mutations use POST in tRPC)
 *   - req.ip         — "127.0.0.1" (test loopback)
 *   - req.socket     — { remoteAddress: "127.0.0.1" }
 *
 * These fields satisfy the CSRF Origin check middleware without requiring a real HTTP server.
 */
function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "discord",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
      // req.method: tRPC mutations are POST. CSRF check runs on non-GET methods.
      method: "POST",
      // req.get(name): Express method for reading request headers.
      // Returning undefined for "origin" simulates a server-to-server call
      // (no browser Origin header), which the CSRF middleware always allows.
      get: (_name: string) => undefined,
      // req.ip + req.socket: used by CSRF middleware for audit logging
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as NodeJS.Socket,
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    // [INPUT] Authenticated context with mocked req/res
    const { ctx, clearedCookies } = createAuthContext();
    console.log("[INPUT] Mock context: user.id=1 req.method=POST req.get('origin')=undefined");

    const caller = appRouter.createCaller(ctx);

    // [STEP] Call auth.logout
    const result = await caller.auth.logout();
    console.log(`[STATE] logout result: ${JSON.stringify(result)}`);
    console.log(`[STATE] clearedCookies: ${JSON.stringify(clearedCookies)}`);

    // [OUTPUT] Verify success response
    expect(result).toEqual({ success: true });
    console.log("[VERIFY] PASS — result.success === true");

    // [OUTPUT] Verify exactly one cookie was cleared
    expect(clearedCookies).toHaveLength(1);
    console.log(`[VERIFY] PASS — exactly 1 cookie cleared: "${clearedCookies[0]?.name}"`);

    // [OUTPUT] Verify cookie name matches session cookie constant
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    console.log(`[VERIFY] PASS — cookie name === "${COOKIE_NAME}"`);

    // [OUTPUT] Verify cookie options enforce expiry and security flags
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
    console.log("[VERIFY] PASS — cookie options: maxAge=-1 secure=true sameSite=none httpOnly=true path=/");
  });
});
