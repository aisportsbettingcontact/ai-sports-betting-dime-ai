/**
 * The two gaps that let a deploy ship blind.
 *
 * 1. MIGRATION ORDERING. Merging triggers the Railway deploy automatically, so
 *    a migration workflow has to run BEFORE the merge. It was missed on both
 *    ledger deploys. Neither caused an outage — recordCheckoutCreated and
 *    recordPaymentEvent swallow their own errors by design, so a missing table
 *    cannot 5xx a webhook and make Stripe redeliver a fulfilled event — but
 *    that same safety meant the code ran blind and said nothing. SchemaGuard
 *    reported PASS both times, because it only knew about app_users and the
 *    billing catalogue.
 *
 * 2. ALERT TRANSPORT. The ledger logs failed renewals at error level, but
 *    nothing pushed them anywhere, and the "no webhook configured" notice only
 *    appeared once an alert was already firing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_COLUMNS, compareSchema } from "./schemaGuard";

const repoRoot = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

describe("SchemaGuard covers the ledgers the code writes to", () => {
  it("guards checkout_sessions and payment_events", () => {
    expect(Object.keys(REQUIRED_COLUMNS)).toContain("checkout_sessions");
    expect(Object.keys(REQUIRED_COLUMNS)).toContain("payment_events");
  });

  it("requires the columns that carry the whole point of each ledger", () => {
    // fulfillment/outcome are what separate "Stripe took the money" from "we
    // granted access". A table missing those is not a usable ledger.
    expect(REQUIRED_COLUMNS.checkout_sessions).toContain("fulfillment");
    expect(REQUIRED_COLUMNS.checkout_sessions).toContain("fulfillmentReason");
    expect(REQUIRED_COLUMNS.payment_events).toContain("outcome");
    expect(REQUIRED_COLUMNS.payment_events).toContain("amountCents");
  });

  it("REPRODUCES BOTH MISSES: an absent ledger table is reported as drift", () => {
    // Exactly the production state after each merge — every other table
    // present, the new ledger absent. This must not be silent.
    const liveRows = Object.entries(REQUIRED_COLUMNS)
      .filter(([t]) => t !== "payment_events")
      .flatMap(([t, cols]) => cols.map((c) => ({ t, c })));

    const drift = compareSchema(liveRows, REQUIRED_COLUMNS);
    const pe = drift.find((d) => d.table === "payment_events");
    expect(pe, "a missing payment_events must surface as drift").toBeTruthy();
    expect(pe!.tableMissing).toBe(true);
  });

  it("reports a clean schema when every declared table is present", () => {
    const liveRows = Object.entries(REQUIRED_COLUMNS).flatMap(([t, cols]) => cols.map((c) => ({ t, c })));
    expect(compareSchema(liveRows, REQUIRED_COLUMNS)).toHaveLength(0);
  });
});

describe("failed payments actually reach a human", () => {
  const webhook = read("server/stripeWebhook.ts");
  const alerts = read("server/_core/billingAlerts.ts");

  it("PAYMENT_FAILED exists with a severity and a colour", () => {
    // A kind missing from either Record is a TypeScript error, but assert it
    // so the intent is explicit rather than incidental.
    expect(alerts).toMatch(/\| "PAYMENT_FAILED"/);
    expect(alerts).toMatch(/PAYMENT_FAILED: "warn"/);
    expect(alerts).toMatch(/PAYMENT_FAILED: 0x/);
  });

  it("is warn, not error — a retryable decline is not an outage", () => {
    // Stripe Smart Retries own recovery and access is deliberately retained.
    // Filing it as "error" next to a lost grant devalues both.
    expect(alerts).toMatch(/PAYMENT_FAILED: "warn"/);
  });

  it("fires on a failed renewal", () => {
    const body = webhook.slice(webhook.indexOf('case "invoice.payment_failed"'));
    expect(body.slice(0, 2200)).toMatch(/billingAlert\("PAYMENT_FAILED"/);
  });

  it("fires on a declined payment intent", () => {
    const body = webhook.slice(webhook.indexOf('case "payment_intent.payment_failed"'));
    expect(body.slice(0, 1600)).toMatch(/billingAlert\("PAYMENT_FAILED"/);
  });

  it("records to the ledger BEFORE alerting, so the fact survives a transport failure", () => {
    const body = webhook.slice(webhook.indexOf('case "invoice.payment_failed"'));
    const scoped = body.slice(0, 2200);
    expect(scoped.indexOf("recordPaymentEvent(")).toBeLessThan(scoped.indexOf('billingAlert("PAYMENT_FAILED"'));
  });
});

describe("the alert transport announces itself at boot", () => {
  const alerts = read("server/_core/billingAlerts.ts");
  const index = read("server/_core/index.ts");

  it("warns at startup when no webhook URL is configured", () => {
    // Previously this notice only appeared once an alert was already firing —
    // buried in the same log stream the alert existed to escape.
    expect(alerts).toMatch(/export function reportBillingAlertTransport/);
    expect(alerts).toMatch(/CONSOLE-ONLY/);
    expect(index).toMatch(/reportBillingAlertTransport\(\)/);
  });

  it("accepts either the preferred name or the documented alias", () => {
    expect(alerts).toMatch(/BILLING_ALERT_DISCORD_WEBHOOK_URL/);
    expect(alerts).toMatch(/DISCORD_BILLING_WEBHOOK_URL/);
  });
});
