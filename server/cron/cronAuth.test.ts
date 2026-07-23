/**
 * cronAuth.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TDD spec for the self-contained cron shared-secret guard.
 *
 * WHY THIS EXISTS (systematic-debugging finding):
 *   The legacy /api/scheduled/* endpoints authenticate via sdk.authenticateRequest()
 *   → verifySession() against the legacy OAuth server, and only accept a session whose
 *   openId is prefixed "cron_" (issued exclusively by the legacy heartbeat platform).
 *   GitHub Actions has NO legacy cron cookie, so it can never satisfy that guard.
 *   Moving background jobs to "GitHub Actions on a timer" therefore REQUIRES a
 *   host-independent shared-secret guard. That is what verifyCronSecret provides.
 *
 * SECURITY CONTRACT (the reason these tests are strict):
 *   - Fail CLOSED: if CRON_SECRET is not configured on the server, every request is
 *     rejected 503 — never silently open.
 *   - Constant-time comparison: no early-return on first mismatched byte, and no
 *     throw when the presented token length differs from the configured secret.
 *   - Accept the secret via `Authorization: Bearer <secret>` OR `x-cron-secret`.
 *
 * [INPUT]  a minimal headers bag + process.env.CRON_SECRET
 * [OUTPUT] { ok:true } | { ok:false, status:401|503, error }
 * [VERIFY] each row of the contract above
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { verifyCronSecret } from "./cronAuth";

const SECRET = "s3cr3t-cron-token-abcdef 0123456789";

function headers(h: Record<string, string> = {}) {
  return { headers: h };
}

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.CRON_SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe("verifyCronSecret — fail closed", () => {
  it("rejects with 503 when CRON_SECRET is not configured on the server", () => {
    delete process.env.CRON_SECRET;
    const r = verifyCronSecret(headers({ authorization: `Bearer ${SECRET}` }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it("rejects with 503 when CRON_SECRET is an empty string", () => {
    process.env.CRON_SECRET = "";
    const r = verifyCronSecret(headers({ authorization: `Bearer ${SECRET}` }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });
});

describe("verifyCronSecret — rejects bad credentials with 401", () => {
  beforeEach(() => { process.env.CRON_SECRET = SECRET; });

  it("rejects when no auth header is present", () => {
    const r = verifyCronSecret(headers({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("rejects a wrong token of equal length", () => {
    const wrong = "x".repeat(SECRET.length);
    const r = verifyCronSecret(headers({ authorization: `Bearer ${wrong}` }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("does not throw and rejects when the presented token length differs", () => {
    const r = verifyCronSecret(headers({ authorization: "Bearer short" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("rejects a bare Authorization header without the Bearer scheme", () => {
    const r = verifyCronSecret(headers({ authorization: SECRET }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
});

describe("verifyCronSecret — accepts a valid secret", () => {
  beforeEach(() => { process.env.CRON_SECRET = SECRET; });

  it("accepts Authorization: Bearer <secret>", () => {
    const r = verifyCronSecret(headers({ authorization: `Bearer ${SECRET}` }));
    expect(r.ok).toBe(true);
  });

  it("accepts x-cron-secret: <secret>", () => {
    const r = verifyCronSecret(headers({ "x-cron-secret": SECRET }));
    expect(r.ok).toBe(true);
  });

  it("tolerates extra whitespace in the Bearer value", () => {
    const r = verifyCronSecret(headers({ authorization: `Bearer   ${SECRET}` }));
    expect(r.ok).toBe(true);
  });
});
