/**
 * server/stripeWebhook.test.ts
 *
 * TEST-001 — the webhook handler had ZERO test coverage despite being the
 * single highest-risk file in the money path (fulfilment, account creation,
 * grant, revoke, renewal).
 *
 * Two kinds of assertion here:
 *  1. Behavioural unit tests over the pure helpers that are safe to import
 *     without a database (`isStaleEvent`, the plan-expiry resolver).
 *  2. Source-contract tests, matching this repo's existing convention (see
 *     server/routers/stripe.test.ts and server/stripeTestModeSafety.test.ts),
 *     for invariants that can only be broken by editing the handler — mount
 *     order, acknowledgement semantics, and the idempotency gate. These would
 *     otherwise need a live Express + Stripe + TiDB stack to observe.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { isStaleEvent, PENDING_SETUP_TTL_MS, RENEWAL_GRACE_MS } from "./stripeWebhook";
import { computeExpiryMsForPrice, LIFETIME_ACCESS_UNTIL_MS } from "./stripe/planStore";

const ROOT = path.resolve(__dirname, "..");
const WEBHOOK_SRC = fs.readFileSync(path.join(ROOT, "server/stripeWebhook.ts"), "utf8");
const SERVER_SRC = fs.readFileSync(path.join(ROOT, "server/_core/index.ts"), "utf8");

describe("stripeWebhook — out-of-order guard (WBHK-003)", () => {
  it("[OO-1] accepts an event newer than the watermark", () => {
    expect(isStaleEvent({ lastStripeEventAt: 1_000 }, 2_000)).toBe(false);
  });

  it("[OO-2] rejects an event older than the watermark — a stale 'active' must not resurrect access", () => {
    expect(isStaleEvent({ lastStripeEventAt: 2_000 }, 1_000)).toBe(true);
  });

  it("[OO-3] accepts when no watermark exists yet (first event for the user)", () => {
    expect(isStaleEvent({ lastStripeEventAt: null }, 1_000)).toBe(false);
    expect(isStaleEvent(null, 1_000)).toBe(false);
    expect(isStaleEvent(undefined, 1_000)).toBe(false);
  });

  it("[OO-4] treats an identical timestamp as NOT stale (redelivery is caught by the idempotency gate, not this one)", () => {
    expect(isStaleEvent({ lastStripeEventAt: 1_000 }, 1_000)).toBe(false);
  });
});

describe("stripeWebhook — lifetime interval semantics (context for CAT-001)", () => {
  const NOW = 1_700_000_000_000;

  // CAT-001 (a $99 one-time price on the `dime-lifetime` plan selling access to
  // 2100) is a CATALOG DATA defect, not a code defect. These tests pin the rule
  // it depends on, so a future "fix" does not break selling lifetime at book
  // price via a no-interval interval on a recurring plan.
  it("[LT-1] a no-interval price grants lifetime on a one_time plan", () => {
    expect(
      computeExpiryMsForPrice({ interval: null, intervalCount: null }, { planType: "one_time", accessUntil: null }, NOW)
    ).toBe(LIFETIME_ACCESS_UNTIL_MS);
  });

  it("[LT-2] a no-interval price ALSO grants lifetime on a recurring plan — this is the book-price lifetime interval, and must keep working", () => {
    expect(
      computeExpiryMsForPrice({ interval: null, intervalCount: null }, { planType: "recurring", accessUntil: null }, NOW)
    ).toBe(LIFETIME_ACCESS_UNTIL_MS);
  });

  it("[LT-3] an explicit accessUntil overrides the lifetime sentinel", () => {
    expect(
      computeExpiryMsForPrice({ interval: null, intervalCount: null }, { planType: "recurring", accessUntil: NOW + 5_000 }, NOW)
    ).toBe(NOW + 5_000);
  });

  it("[LT-4] recurring prices are unaffected", () => {
    expect(
      computeExpiryMsForPrice({ interval: "month", intervalCount: 1 }, { planType: "recurring", accessUntil: null }, NOW)
    ).toBe(NOW + 30 * 24 * 60 * 60 * 1000);
  });
});

describe("stripeWebhook — grace and TTL constants", () => {
  it("[C-1] the setup claim expires (AUTH-001) and is measured in hours, not forever", () => {
    expect(PENDING_SETUP_TTL_MS).toBeGreaterThan(0);
    expect(PENDING_SETUP_TTL_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("[C-2] renewals carry a grace buffer so a 31-day month cannot lock out a paid subscriber (LIFE-002)", () => {
    expect(RENEWAL_GRACE_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe("stripeWebhook — exactly-once processing (WBHK-001)", () => {
  it("[ID-1] every event is claimed before the switch dispatches any side effect", () => {
    const claimIdx = WEBHOOK_SRC.indexOf("await claimStripeEvent(event)");
    const switchIdx = WEBHOOK_SRC.indexOf("switch (event.type)");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(switchIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(switchIdx);
  });

  it("[ID-2] a duplicate claim short-circuits to a no-op instead of re-running fulfilment", () => {
    expect(WEBHOOK_SRC).toMatch(/if \(!claimed\)[\s\S]{0,200}return;/);
  });

  it("[ID-3] the claim is keyed on the Stripe event id and relies on a duplicate-key error, not a prior SELECT", () => {
    expect(WEBHOOK_SRC).toContain("stripeEventId: event.id");
    expect(WEBHOOK_SRC).toMatch(/ER_DUP_ENTRY/);
  });
});

describe("stripeWebhook — acknowledgement semantics (WBHK-002)", () => {
  it("[AK-1] revocation-class events are awaited so a failure returns 5xx and Stripe retries", () => {
    const setMatch = WEBHOOK_SRC.match(/ACCESS_CHANGING_EVENT_TYPES = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(setMatch).toBeTruthy();
    const body = setMatch![1];
    for (const evt of [
      "checkout.session.completed",
      "invoice.paid",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "charge.refunded",
      "charge.dispute.created",
    ]) {
      expect(body).toContain(evt);
    }
  });

  it("[AK-2] a failed access-changing event responds 500, never 200", () => {
    expect(WEBHOOK_SRC).toMatch(/res\.status\(500\)\.json\(\{ error: "processing_failed" \}\)/);
  });

  it("[AK-3] the revoke helper throws when the database is unavailable rather than returning silently", () => {
    const fn = WEBHOOK_SRC.slice(WEBHOOK_SRC.indexOf("async function revokeUserAccessByCustomerId"));
    const head = fn.slice(0, fn.indexOf("// Read BEFORE"));
    expect(head).toMatch(/throw new Error\(/);
    expect(head).not.toMatch(/if \(!db\) \{ console\.error\([^)]*\); return; \}/);
  });
});

describe("stripeWebhook — refunds and disputes revoke entitlement (WBHK-004)", () => {
  it("[RF-1] charge.refunded is handled and revokes on a full refund", () => {
    expect(WEBHOOK_SRC).toContain('case "charge.refunded"');
    expect(WEBHOOK_SRC).toMatch(/fullyRefunded[\s\S]{0,400}revokeUserAccessByCustomerId/);
  });

  it("[RF-2] charge.dispute.created is handled and revokes", () => {
    expect(WEBHOOK_SRC).toContain('case "charge.dispute.created"');
    expect(WEBHOOK_SRC).toMatch(/DISPUTE_OPENED/);
  });
});

describe("stripeWebhook — signature handling", () => {
  it("[SG-1] a bad signature returns 400", () => {
    expect(WEBHOOK_SRC).toMatch(/res\.status\(400\)\.json\(\{ error: "signature_verification_failed" \}\)/);
  });

  it("[SG-2] the Stripe library's error text is NOT echoed to the caller (WBHK-007)", () => {
    expect(WEBHOOK_SRC).not.toMatch(/signature_verification_failed",\s*detail:/);
  });

  it("[SG-3] signature failures raise an alert", () => {
    expect(WEBHOOK_SRC).toContain("WEBHOOK_SIGNATURE_FAILURE");
  });
});

describe("stripeWebhook — raw body integrity (mount order)", () => {
  it("[RB-1] the webhook route is registered BEFORE express.json() so the raw buffer survives", () => {
    // Match the actual mount, not the prose: the comment above the route also
    // contains the string "express.json()".
    const webhookIdx = SERVER_SRC.indexOf("registerStripeWebhookRoute(app)");
    const jsonIdx = SERVER_SRC.indexOf("app.use(express.json(");
    expect(webhookIdx).toBeGreaterThan(-1);
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(webhookIdx).toBeLessThan(jsonIdx);
  });

  it("[RB-2] the route uses express.raw for application/json", () => {
    expect(WEBHOOK_SRC).toMatch(/express\.raw\(\{\s*type:\s*"application\/json"\s*\}\)/);
  });

  it("[RB-3] the webhook is mounted before the global API rate limiter so Stripe retries can never be throttled", () => {
    const webhookIdx = SERVER_SRC.indexOf("registerStripeWebhookRoute(app)");
    const limiterIdx = SERVER_SRC.indexOf('app.use("/api", globalApiLimiter)');
    expect(limiterIdx).toBeGreaterThan(-1);
    expect(webhookIdx).toBeLessThan(limiterIdx);
  });
});

describe("stripeWebhook — unverified email cannot rebind an account (STRIPE-001)", () => {
  it("[EM-1] an email match against an account with a DIFFERENT Stripe customer is refused, not silently rebound", () => {
    expect(WEBHOOK_SRC).toMatch(/existingCustomer && existingCustomer !== params\.stripeCustomerId/);
    expect(WEBHOOK_SRC).toContain("CUSTOMER_LINK_CONFLICT_REFUSED");
  });

  it("[EM-2] the refusal returns null rather than granting entitlement", () => {
    const branch = WEBHOOK_SRC.slice(
      WEBHOOK_SRC.indexOf("existingCustomer && existingCustomer !== params.stripeCustomerId"),
    );
    const upToReturn = branch.slice(0, branch.indexOf("return null;"));
    expect(upToReturn).not.toContain("await grantUserAccess(");
  });
});

describe("stripeWebhook — durable audit trail (OPS-002)", () => {
  it("[AU-1] grants and revokes both write an entitlement_events row", () => {
    expect(WEBHOOK_SRC).toMatch(/recordEntitlementEvent\(\{[\s\S]{0,400}reason: "GRANT"/);
    expect(WEBHOOK_SRC).toMatch(/reason: opts\.reason \?\? "SUBSCRIPTION_DELETED"/);
  });

  it("[AU-2] audit rows carry the Stripe event id for correlation", () => {
    expect(WEBHOOK_SRC).toMatch(/stripeEventId: params\.stripeEventId \?\? null/);
  });
});

describe("stripeWebhook — outbound calls deferred past the ack (WBHK-005)", () => {
  it("[DF-1] Discord role syncs are queued, not awaited inside fulfilment", () => {
    expect(WEBHOOK_SRC).toContain("deferRoleSync(");
    expect(WEBHOOK_SRC).toContain("flushDeferredRoleSyncs()");
  });

  it("[DF-2] the flush happens after the 200 is sent", () => {
    const okIdx = WEBHOOK_SRC.indexOf('res.status(200).json({ received: true });\n            // Outbound Discord');
    expect(okIdx).toBeGreaterThan(-1);
  });
});
