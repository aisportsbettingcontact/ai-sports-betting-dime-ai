import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isTestModeFulfillmentAllowed } from "./_core/testModeFulfillment";

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
 *
 * Invariant 2 gained a deliberately narrow exception (2026-07-31): an
 * explicitly-gated harness environment may let livemode=false events run the
 * real money path, because otherwise the claim/grant/renew/refund/revoke code is
 * untestable anywhere. The assertions below were tightened, not relaxed, to
 * match: the skip is still the DEFAULT, the exception must be a consult of
 * server/_core/testModeFulfillment.ts, and that gate must refuse an environment
 * that has not opted in. Removing the guard, or making fulfilment the
 * fall-through, still fails this file.
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
  /**
   * The livemode guard, isolated from the rest of the handler. Bounding the
   * slice at the event switch matters: an unbounded [\s\S]*?return; can satisfy
   * itself with some LATER return elsewhere in the function, so it would keep
   * passing even if the guard body were emptied out.
   */
  const guardIdx = webhookSrc.indexOf("if (event.livemode === false)");
  const switchIdx = webhookSrc.indexOf("switch (event.type)");
  const guardBlock = webhookSrc.slice(guardIdx, switchIdx);

  it("the livemode guard sits before the event switch — no fulfillment branch can run first", () => {
    expect(guardIdx).toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(switchIdx);
  });

  it("the guard also precedes the idempotency claim — nothing is written before it decides", () => {
    const claimIdx = webhookSrc.indexOf("await claimStripeEvent(event)");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(claimIdx);
  });

  it("skipping fulfillment is the DEFAULT — the guard body returns before anything else", () => {
    expect(guardBlock).toMatch(
      /if\s*\(!gate\.allowed\)\s*\{[\s\S]{0,400}?production fulfillment intentionally skipped[\s\S]{0,80}?return;\s*\}/,
    );
  });

  it("the only way past the guard is the explicit gate module, not an inline env read", () => {
    // A bare `process.env.X === "1"` here would be a one-line path to fulfilling
    // live-key/production-DB traffic; the decision must stay in the audited,
    // unit-tested module that also checks the Stripe key mode and the DB host.
    expect(guardBlock).toContain("testModeFulfilmentGate()");
    expect(webhookSrc).toContain('from "./_core/testModeFulfillment"');
    expect(guardBlock).not.toMatch(/process\.env/);
  });

  it("the gate itself refuses an environment that has not explicitly opted in", () => {
    // Behavioural, not textual: whatever the module is rewritten to do, an
    // unconfigured environment — and a live Stripe key — must never be allowed.
    expect(isTestModeFulfillmentAllowed({}).allowed).toBe(false);
    expect(
      isTestModeFulfillmentAllowed({
        ALLOW_TEST_MODE_FULFILLMENT: "1",
        // Assembled rather than written literally: a realistic key string in a
        // committed file trips push protection and the gitleaks gate.
        STRIPE_SECRET_KEY: ["sk", "live", "abc123"].join("_"),
        DATABASE_URL: "mysql://root@127.0.0.1:3306/dime_test",
      }).allowed,
    ).toBe(false);
  });

  it("enabling test-mode fulfilment announces itself loudly", () => {
    expect(webhookSrc).toContain("*** TEST-MODE FULFILMENT ENABLED ***");
  });

  it("still verifies the signature, incl. against the optional test webhook secret", () => {
    expect(webhookSrc).toContain("STRIPE_TEST_WEBHOOK_SECRET");
    expect(webhookSrc).toMatch(/constructEvent\(req\.body,\s*sig,\s*secret\)/);
  });
});
