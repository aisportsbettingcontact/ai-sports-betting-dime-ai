/**
 * Payment ledger contract.
 *
 * Before this table the money existed only inside Stripe. entitlement_events
 * recorded that access changed and checkout_sessions that a checkout resolved,
 * but no row carried an AMOUNT — so "what did we collect", "which renewals
 * failed" and "how much is in dispute" all required opening the Dashboard.
 *
 * The failure paths were the worst of it. invoice.payment_failed was three log
 * lines and a `break`: correct, since Stripe Smart Retries own recovery, but
 * completely invisible. Under a recurring model the first question is which
 * members are failing to pay.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");
const webhook = read("server/stripeWebhook.ts");
const ledger = read("server/stripe/paymentLedger.ts");
const migration = read("drizzle/0127_payment_events.sql");

/** The six money-movement events and the kind each must record. */
const MONEY_EVENTS: Array<[string, string]> = [
  ["payment_intent.succeeded", "succeeded"],
  ["payment_intent.payment_failed", "failed"],
  ["invoice.paid", "succeeded"],
  ["invoice.payment_failed", "failed"],
  ["charge.refunded", "refunded"],
  ["charge.dispute.created", "disputed"],
];

describe("every money movement is recorded", () => {
  for (const [ev, kind] of MONEY_EVENTS) {
    it(`${ev} writes a '${kind}' row`, () => {
      const start = webhook.indexOf(`case "${ev}"`);
      expect(start, `${ev} handler not found`).toBeGreaterThan(-1);
      // Bound the search to this handler so a neighbouring case cannot satisfy it.
      const rest = webhook.slice(start);
      const end = rest.indexOf("\n    case ", 1);
      const body = end === -1 ? rest : rest.slice(0, end);
      expect(body, `${ev} does not record a payment event`).toMatch(
        /recordPaymentEvent\(/
      );
      expect(body, `${ev} records the wrong kind`).toMatch(
        new RegExp(`kind: "${kind}"`)
      );
    });
  }
});

describe("outcome is independent of what Stripe did", () => {
  it("a failed renewal REVOKES at the decline (no-grace policy) — noop only when no member matches", () => {
    // Owner directive 2026-08-01: no grace periods on decline. The handler
    // must revoke at the moment of failure AND cancel the subscription at
    // Stripe, with 'noop' reserved for declines that match no revocable
    // member. The subscription guard is load-bearing: a lifetime (one-off)
    // member must never lose their entitlement to a different subscription's
    // decline.
    const body = webhook.slice(
      webhook.indexOf('case "invoice.payment_failed"')
    );
    const caseBody = body.slice(
      0,
      body.indexOf('case "payment_intent.succeeded"')
    );
    expect(caseBody).toMatch(/PAYMENT_FAILED_NO_GRACE/);
    expect(caseBody).toMatch(/outcome: revoked \? "revoked" : "noop"/);
    expect(caseBody).toMatch(/subscriptions\.cancel/);
    expect(caseBody).toMatch(/subscriptionMatches/);
    // The revoke is conditional — a blind customer-wide revoke must not exist.
    expect(caseBody).toMatch(/failedUser\.hasAccess && subscriptionMatches/);
  });

  it("a paid invoice that matches no local user is a noop, not a grant", () => {
    // Money taken from someone the system does not recognise — the recurring
    // equivalent of the dropped checkout.
    expect(webhook).toMatch(
      /invoice paid but no local user matched this customer/
    );
  });

  it("a full refund revokes; a partial refund does not", () => {
    expect(webhook).toMatch(/fullyRefunded \? "revoked" : "noop"/);
  });
});

describe("ledger safety", () => {
  it("never throws — bookkeeping must not make a webhook 5xx", () => {
    // A 5xx makes Stripe redeliver an event we already fulfilled.
    expect(ledger).not.toMatch(/throw new/);
    expect(ledger).toMatch(/catch \(err\)/);
  });

  it("treats a redelivery as an idempotent no-op, never a double-count", () => {
    expect(ledger).toMatch(/isDuplicateKeyError\(err\)/);
    expect(ledger).toMatch(/idempotent no-op/);
  });

  it("logs failures and disputes at error level so they surface without a query", () => {
    expect(ledger).toMatch(
      /kind === "failed" \|\| input\.kind === "disputed" \|\| input\.outcome === "noop"/
    );
  });

  it("caps every string to its column width", () => {
    // An over-long Stripe failure message must not abort the insert and lose
    // the whole record of a failed payment.
    expect(ledger).toMatch(/function cap\(/);
    expect(ledger).toMatch(/failureMessage: cap\(input\.failureMessage, 255\)/);
  });
});

describe("schema is queryable for the questions that matter", () => {
  it("is idempotent on (event, object) so a redelivery cannot double-count revenue", () => {
    expect(migration).toMatch(/UNIQUE\(`stripeEventId`,`objectId`\)/);
  });

  it("carries the amount, currency and refunded amount", () => {
    for (const c of ["amountCents", "currency", "amountRefundedCents"]) {
      expect(migration, `${c} missing`).toContain(`\`${c}\``);
    }
  });

  it("indexes failures-over-time, per-member, per-subscription and per-invoice", () => {
    for (const i of [
      "payment_events_kind_occurred_idx",
      "payment_events_user_idx",
      "payment_events_subscription_idx",
      "payment_events_invoice_idx",
      "payment_events_outcome_idx",
    ]) {
      expect(migration, `${i} missing`).toContain(i);
    }
  });

  it("is declared in the drizzle schema and the journal", () => {
    expect(read("drizzle/schema.ts")).toMatch(
      /paymentEvents = mysqlTable\("payment_events"/
    );
    const j = JSON.parse(read("drizzle/meta/_journal.json"));
    expect(
      j.entries.some((e: { tag: string }) => e.tag === "0127_payment_events")
    ).toBe(true);
  });
});
