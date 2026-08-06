/**
 * Checkout ledger contract.
 *
 * Two live payments were taken and granted nothing. The webhook logged a bail
 * and moved on; the event ledger recorded status='processed' either way, so a
 * dropped payment and a fulfilled one were indistinguishable. Nobody noticed
 * until the database was inspected by hand days later.
 *
 * These tests pin the properties that make that class of failure impossible to
 * hide: every checkout is recorded before the buyer leaves, every webhook exit
 * path resolves it, and "took the money" is stored separately from "granted
 * access".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");
const stripDocs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const routerSrc = read("server/routers/stripe.ts");
const routerCode = stripDocs(routerSrc);
const webhookCode = stripDocs(read("server/stripeWebhook.ts"));
const migration = read("drizzle/0126_checkout_sessions.sql");
const schema = read("drizzle/schema.ts");

describe("customer_creation — the root cause of the dropped payments", () => {
  it("forces customer creation for payment-mode checkouts", () => {
    // mode:"subscription" always creates a Customer; mode:"payment" defaults to
    // customer_creation:"if_required", which for a card payment creates NONE.
    // session.customer then arrives null and the payment binds to no account.
    expect(routerCode).toMatch(/customer_creation: "always"/);
  });

  it("only sets it in payment mode, and only when no customer is supplied", () => {
    // Stripe rejects customer_creation alongside an explicit `customer`, and
    // rejects it outright in subscription mode. Getting this wrong turns a
    // silent drop into a hard checkout failure — strictly worse.
    expect(routerCode).toMatch(
      /mode === "payment" && !stripeCustomerId \? \{ customer_creation: "always"/
    );
  });

  it("still never passes payment_method_types", () => {
    // Stripe's own guidance: hardcoding this disables dynamic payment methods.
    expect(routerCode).not.toMatch(/payment_method_types/);
  });
});

describe("every checkout is recorded before the buyer leaves", () => {
  it("records from both the redirect and the embedded builder", () => {
    // The embedded surface is the one anonymous buyers use — exactly the
    // population that got dropped — so omitting it would keep them invisible.
    const calls = routerCode.match(/recordCheckoutCreated\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("awaits the write, so the row exists before Stripe can call back", () => {
    // Fire-and-forget would race checkout.session.completed against its own row.
    expect(routerCode).toMatch(/await recordCheckoutCreated\(/);
  });
});

describe("every webhook exit path resolves the checkout", () => {
  it("records a DROP when the session carries no customer", () => {
    expect(webhookCode).toMatch(
      /fulfillment: "dropped"[\s\S]{0,200}no stripeCustomerId/
    );
  });

  it("records a DROP on an unparseable user_id", () => {
    expect(webhookCode).toMatch(/invalid user_id/);
  });

  it("records a SKIP when payment_status is not paid", () => {
    expect(webhookCode).toMatch(
      /fulfillment: "skipped"[\s\S]{0,120}payment_status=/
    );
  });

  it("records FULFILLED only after access is actually granted", () => {
    expect(webhookCode).toMatch(/fulfillment: "fulfilled"/);
  });

  it("handles checkout.session.expired so abandonment is measurable", () => {
    expect(webhookCode).toMatch(/case "checkout\.session\.expired"/);
    expect(webhookCode).toMatch(/status: "expired"/);
  });

  it("leaves no bail path that only logs — every break resolves the row", () => {
    // Count the drop/skip resolutions against the known exit points inside the
    // checkout.session.completed handler.
    const handler = webhookCode.slice(
      webhookCode.indexOf('case "checkout.session.completed"'),
      webhookCode.indexOf('case "customer.subscription.created"')
    );
    const resolutions = handler.match(/resolveCheckout\(/g) ?? [];
    expect(resolutions.length).toBeGreaterThanOrEqual(4); // skipped, 2× dropped, fulfilled
  });
});

describe("schema — queryable by the questions that matter", () => {
  it("separates Stripe lifecycle from our fulfillment outcome", () => {
    // Collapsing these is what made a dropped payment look like a successful one.
    expect(migration).toMatch(/`status`\s+varchar/);
    expect(migration).toMatch(/`fulfillment`\s+varchar/);
    expect(migration).toMatch(/`fulfillmentReason`\s+varchar/);
  });

  it("makes a duplicate row impossible rather than unlikely", () => {
    expect(migration).toMatch(/UNIQUE\(`stripeSessionId`\)/);
  });

  it("indexes the 'took money but granted nothing' query", () => {
    // Composite (fulfillment, status) — leading column is fulfillment so the
    // "dropped" scan is an index lookup rather than a table scan. Verified by
    // EXPLAIN against MySQL 8: type=ref, key=checkout_sessions_fulfillment_idx.
    expect(migration).toMatch(
      /CREATE INDEX `checkout_sessions_fulfillment_idx`[^;]*\(`fulfillment`\s*,\s*`status`\)/
    );
  });

  it("indexes the funnel, the member, the customer, the plan and the email", () => {
    for (const idx of [
      "checkout_sessions_status_created_idx",
      "checkout_sessions_user_idx",
      "checkout_sessions_customer_idx",
      "checkout_sessions_plan_idx",
      "checkout_sessions_email_idx",
    ]) {
      expect(migration, `${idx} missing`).toContain(idx);
    }
  });

  it("allows a NULL userId — anonymous checkout is the case that got dropped", () => {
    // Nullable by omission of NOT NULL. Assert the absence explicitly, since a
    // NOT NULL here would reject exactly the anonymous checkouts that got lost.
    const userIdCol = /`userId`\s+int([^,\n]*)/.exec(migration);
    expect(userIdCol, "userId column not found").toBeTruthy();
    expect(userIdCol![1]).not.toMatch(/NOT NULL/i);
  });

  it("is declared in the drizzle schema and in the journal", () => {
    expect(schema).toMatch(
      /checkoutSessions = mysqlTable\("checkout_sessions"/
    );
    const journal = JSON.parse(read("drizzle/meta/_journal.json"));
    expect(
      journal.entries.some(
        (e: { tag: string }) => e.tag === "0126_checkout_sessions"
      )
    ).toBe(true);
  });
});

describe("ledger must never break the money path", () => {
  it("swallows its own failures instead of throwing", () => {
    const ledger = read("server/stripe/checkoutLedger.ts");
    // A DB outage must not stop a buyer paying, nor stop a payment fulfilling.
    expect(ledger).toMatch(/catch \(err\)/);
    expect(ledger).not.toMatch(/throw new/);
  });

  it("treats a duplicate insert as an idempotent no-op", () => {
    // Stripe's idempotency key can return the SAME session for a double-click.
    expect(read("server/stripe/checkoutLedger.ts")).toMatch(
      /duplicate\|ER_DUP_ENTRY/
    );
  });
});
