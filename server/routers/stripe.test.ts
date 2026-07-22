import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * server/routers/stripe.ts — procedure-binding source contract
 * (pre-merge fix, final-branch-review owner directive 2026-07-22).
 *
 * Why source-contract, not a live-call test: exercising the real request
 * pipeline needs a live Stripe customer + DB row (same DB-dependence caveat
 * server/adminProcedureLockdown.test.ts documents for ownerProcedure). What
 * this suite pins is the thing the final reviewer actually flagged — WHICH
 * middleware each mutation is bound to — using the same
 * declaration-regex technique adminProcedureLockdown.test.ts already
 * established for stripeAppUserProcedure's sibling, ownerProcedure.
 *
 * The bug this pins against regressing: BillingSection.tsx's "Manage in
 * Stripe" button is reachable (and rendered) for EVERY non-owner state,
 * including expired/revoked — but stripeAppUserProcedure's hasAccess/expiry
 * gate threw FORBIDDEN before createPortalSession's body ever ran for that
 * exact caller, so the button always errored for the one audience (a lapsed
 * subscriber trying to fix a card or pull an invoice) Stripe's own portal
 * model is built to serve. createPortalSession now runs on
 * billingAppUserProcedure (session-valid, access-gate-free) instead —
 * reactivateSubscription and cancelSubscription are untouched: their own
 * mutation bodies already gate correctly for the states they're reachable
 * from (see the "still stripeAppUserProcedure-bound" tests below).
 */

const source = fs.readFileSync(
  path.join(import.meta.dirname, "stripe.ts"),
  "utf8"
);

describe("createPortalSession — moved off the access-gated procedure", () => {
  it("is bound to billingAppUserProcedure (session-valid, no hasAccess/expiry gate)", () => {
    expect(source).toMatch(/createPortalSession:\s*billingAppUserProcedure\b/);
  });

  it("is NOT bound to stripeAppUserProcedure anymore", () => {
    expect(source).not.toMatch(/createPortalSession:\s*stripeAppUserProcedure\b/);
  });

  it("the binding carries a comment explaining why (lapsed/expired callers are the whole point)", () => {
    const declIdx = source.search(/createPortalSession:\s*billingAppUserProcedure\b/);
    expect(declIdx).toBeGreaterThan(-1);
    const precedingComment = source.slice(Math.max(0, declIdx - 1200), declIdx);
    expect(precedingComment).toMatch(/billingAppUserProcedure, not stripeAppUserProcedure/);
    expect(precedingComment).toMatch(/lapsed|expired|revoked/i);
    expect(precedingComment).toMatch(/reactivateSubscription stays on stripeAppUserProcedure/);
  });
});

describe("reactivateSubscription and cancelSubscription — still stripeAppUserProcedure-bound", () => {
  it("reactivateSubscription is untouched — its own cancel_scheduled-only guard makes the access gate correct for its only reachable caller", () => {
    expect(source).toMatch(/reactivateSubscription:\s*stripeAppUserProcedure\.mutation/);
  });

  it("cancelSubscription is untouched — only reachable while hasAccess=true (an active plan), so the gate never misfires for it", () => {
    expect(source).toMatch(/cancelSubscription:\s*stripeAppUserProcedure\.mutation/);
  });
});

describe("billingAppUserProcedure — the middleware createPortalSession now shares with the read-only billing-data procedures", () => {
  it("is defined once, built on stripeProcedure, and its body skips the hasAccess/expiry checks by design", () => {
    const defIdx = source.indexOf("const billingAppUserProcedure = stripeProcedure.use(");
    expect(defIdx).toBeGreaterThan(-1);
    const defEnd = source.indexOf("\n});", defIdx);
    const body = source.slice(defIdx, defEnd);
    expect(body).not.toContain("user.hasAccess");
    expect(body).not.toContain("user.expiryDate && Date.now()");
  });

  it("still requires a valid app_session cookie + JWT + tokenVersion match (session validity is not dropped, only the access gate)", () => {
    const defIdx = source.indexOf("const billingAppUserProcedure = stripeProcedure.use(");
    expect(defIdx).toBeGreaterThan(-1);
    const defEnd = source.indexOf("\n});", defIdx);
    const body = source.slice(defIdx, defEnd);
    expect(body).toContain("getAppSessionToken(ctx.req)");
    expect(body).toContain("verifyAppUserToken(token)");
    expect(body).toMatch(/payload\.tv !== null && payload\.tv !== user\.tokenVersion/);
  });

  it("getPlanStatus/getInvoices/getPaymentMethods/getBillingInfo all share this same procedure", () => {
    for (const name of ["getPlanStatus", "getInvoices", "getPaymentMethods", "getBillingInfo"]) {
      const re = new RegExp(`${name}:\\s*billingAppUserProcedure\\b`);
      expect(source, `${name} should be billingAppUserProcedure-bound`).toMatch(re);
    }
  });
});
