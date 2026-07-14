import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PREZ_EMAIL, PREZ_USERNAME, runGrantOwnerPrez } from "./grantOwnerAccess";

/**
 * Guards for the single-target owner grant. This endpoint restores @prez to
 * role="owner" so he can reach /admin/users. The security property that MUST
 * hold is that it can only ever touch prez — there is no caller-supplied target.
 * These lock the hardcoded selectors, the DB-free signature, and the CRON-gated
 * route registration together.
 */

describe("grant-owner single-target scope", () => {
  it("hardcodes the @prez selectors (email + username)", () => {
    expect(PREZ_EMAIL).toBe("prez@aisportsbettingmodels.com");
    expect(PREZ_USERNAME).toBe("prez");
  });

  it("exposes runGrantOwnerPrez taking ONLY { dryRun } — no id/email/username input", () => {
    // Arity 1 (the opts object). If a caller-supplied target were ever added the
    // signature would grow and this guard would need a conscious update.
    expect(typeof runGrantOwnerPrez).toBe("function");
    expect(runGrantOwnerPrez.length).toBe(1);
  });

  it("never reads a user id/email/username from a request (source-level scope guard)", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "grantOwnerAccess.ts"), "utf8");
    // The only selectors are the two hardcoded constants.
    expect(src).toContain('getAppUserByEmail(PREZ_EMAIL)');
    expect(src).toContain('getAppUserByUsername(PREZ_USERNAME)');
    // No request-derived targeting may leak into this module.
    expect(src).not.toMatch(/req\.(body|query|params)/);
    expect(src).not.toMatch(/input\.(id|email|username|userId)/);
  });

  it("refuses to write when email and username resolve to different records (ambiguity guard)", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "grantOwnerAccess.ts"), "utf8");
    expect(src).toContain('matchedBy: "ambiguous"');
    expect(src).toContain("uniqueById.size > 1");
  });
});

describe("grant-owner write endpoint", () => {
  const cronRoutesSrc = fs.readFileSync(
    path.join(import.meta.dirname, "cron", "cronRoutes.ts"),
    "utf8",
  );

  it("registers POST /api/cron/grant-owner guarded by the cron secret", () => {
    expect(cronRoutesSrc).toMatch(/app\.post\("\/api\/cron\/grant-owner"/);
    expect(cronRoutesSrc).toMatch(/requireCronSecret\(req, res, "grant-owner"\)/);
    expect(cronRoutesSrc).toContain("runGrantOwnerPrez");
  });

  it("passes ONLY { dryRun } to the grant (no target forwarded from the request)", () => {
    expect(cronRoutesSrc).toContain("runGrantOwnerPrez({ dryRun })");
  });
});
