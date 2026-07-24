import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 2.5 owner-only TEST checkout — safety invariants pinned as
 * source-contract assertions (same technique as server/routers/stripe.test.ts:
 * the real path needs a live Stripe sandbox + DB, so what we pin is the
 * structure the feature's safety depends on).
 *
 * Two invariants matter:
 *  1. createTestCheckoutSession is owner-only, test-mode-only, and can ONLY ever
 *     be handed a TEST price (defaultPriceForMode(plan, false)) via the TEST
 *     provisioning client — it must never open checkout against a live price.
 *  2. The webhook NEVER applies fulfillment to production data for a test-mode
 *     event (event.livemode === false) — a Stripe test card must not mint a real
 *     subscriber row or grant live access — yet still verifies its signature.
 */

const routerSrc = fs.readFileSync(
  path.join(import.meta.dirname, "routers", "subscriptionPlans.ts"),
  "utf8",
);
const webhookSrc = fs.readFileSync(
  path.join(import.meta.dirname, "stripeWebhook.ts"),
  "utf8",
);

describe("createTestCheckoutSession — owner-only, test-mode-only, test-price-only", () => {
  const body = (() => {
    const idx = routerSrc.indexOf("createTestCheckoutSession:");
    expect(idx).toBeGreaterThan(-1);
    return routerSrc.slice(idx);
  })();

  it("is bound to ownerProcedure (not a public purchase path)", () => {
    expect(routerSrc).toMatch(/createTestCheckoutSession:\s*ownerProcedure\b/);
  });

  it("refuses unless provisioning is in TEST/sandbox mode", () => {
    expect(body).toMatch(/if\s*\(!isProvisioningTestMode\(\)\)/);
  });

  it("selects the TEST price only — defaultPriceForMode(plan, false), never (…, true)", () => {
    expect(body).toMatch(/defaultPriceForMode\(plan,\s*false\)/);
    expect(body).not.toMatch(/defaultPriceForMode\(plan,\s*true\)/);
  });

  it("drives the TEST provisioning Stripe client, not the live checkout client", () => {
    expect(body).toContain("getProvisioningStripe()");
  });
});

describe("webhook — test-mode events never touch production data", () => {
  it("returns early (skips fulfillment) when event.livemode === false", () => {
    expect(webhookSrc).toMatch(/if\s*\(event\.livemode === false\)\s*\{[\s\S]*?return;/);
  });

  it("the livemode guard sits before the event switch — no fulfillment branch can run first", () => {
    const guardIdx = webhookSrc.indexOf("event.livemode === false");
    const switchIdx = webhookSrc.indexOf("switch (event.type)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(switchIdx);
  });

  it("still verifies the signature, incl. against the optional test webhook secret", () => {
    expect(webhookSrc).toContain("STRIPE_TEST_WEBHOOK_SECRET");
    expect(webhookSrc).toMatch(/constructEvent\(req\.body,\s*sig,\s*secret\)/);
  });
});
