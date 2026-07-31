/**
 * server/entitlementAssignment.test.ts
 *
 * app_users.planPriceId — WHICH billing interval a member is on, and the column
 * behind app_users_plan_price_idx — was written by NOTHING. Every paid
 * signup landed with a plan and a NULL interval; every admin-created member
 * landed with neither, invisible to plan/interval queries until someone
 * backfilled by hand (2026-07-31, @suprax718).
 *
 * Pure logic only: no database, no Stripe. The module under test pulls both in
 * at import time, so they are stubbed the way planRepricing.test.ts does.
 *
 * Two kinds of assertion, matching this file's neighbours:
 *  1. Behavioural tests over the exported resolvers.
 *  2. Source-contract tests for the WIRING — that the resolved id actually
 *     reaches the grant, the INSERT and the renewal. A resolver that returns
 *     the right number into a caller that drops it is the exact bug this fixes,
 *     and observing it otherwise needs a live Stripe + Express + TiDB stack.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("stripe", () => ({ default: vi.fn(() => ({})) }));
vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  getAppUserById: vi.fn(async () => null),
  getAppUserByStripeCustomerId: vi.fn(async () => null),
  invalidateAppUserByIdCache: vi.fn(),
}));
vi.mock("./dbCircuitBreaker", () => ({
  withCircuitBreaker: vi.fn((fn: () => unknown) => fn()),
  invalidateCachedAppUser: vi.fn(),
}));
vi.mock("./stripe/client", () => ({ getStripe: vi.fn(() => ({})) }));

import {
  resolvePlanPriceId,
  resolveRenewalPlanPriceId,
  extractInvoicePriceId,
} from "./stripeWebhook";

const ROOT = path.resolve(__dirname, "..");
const WEBHOOK_SRC = fs.readFileSync(path.join(ROOT, "server/stripeWebhook.ts"), "utf8");
const APPUSERS_SRC = fs.readFileSync(path.join(ROOT, "server/routers/appUsers.ts"), "utf8");

/** A plan_prices row as getPriceById returns it — only the row id matters here. */
const priceRow = (id: number) => ({ price: { id } });

describe("resolvePlanPriceId — the purchased interval reaches the grant", () => {
  it("[PP-1] carries the row id pinned in metadata.price_id", () => {
    expect(resolvePlanPriceId({ byPurchasedPrice: priceRow(42) })).toEqual({
      planPriceId: 42,
      source: "purchased_price_id",
    });
  });

  it("[PP-2] falls back to the price reverse-mapped from the session line item", () => {
    expect(resolvePlanPriceId({ byPurchasedPrice: null, byLineItemPrice: priceRow(7) })).toEqual({
      planPriceId: 7,
      source: "line_item_price",
    });
  });

  it("[PP-3] prefers the pinned purchase over the line item — the exact interval bought wins", () => {
    expect(
      resolvePlanPriceId({ byPurchasedPrice: priceRow(42), byLineItemPrice: priceRow(7) }).planPriceId,
    ).toBe(42);
  });

  it("[PP-4] a legacy static plan (monthly/annual) yields NULL, never a bogus id", () => {
    // These plans live in server/stripe/products.ts and have no plan_prices row
    // at all, so neither resolver matches. Inventing an id here would attribute
    // the subscriber to some other plan's interval.
    expect(resolvePlanPriceId({})).toEqual({ planPriceId: null, source: "none" });
    expect(resolvePlanPriceId({ byPurchasedPrice: null, byLineItemPrice: null })).toEqual({
      planPriceId: null,
      source: "none",
    });
  });
});

describe("resolveRenewalPlanPriceId — a renewal never destroys a good interval", () => {
  it("[RN-1] leaves an existing planPriceId untouched when the invoice price maps to nothing", () => {
    const r = resolveRenewalPlanPriceId({ byInvoicePrice: null, current: 42 });
    // undefined = "do not write the column" — NOT null, which would clear it.
    expect(r.planPriceId).toBeUndefined();
    expect(r.effective).toBe(42);
    expect(r.reason).toBe("unresolved_keep_existing");
  });

  it("[RN-2] still writes nothing when the stored value is already NULL", () => {
    const r = resolveRenewalPlanPriceId({ byInvoicePrice: null, current: null });
    expect(r.planPriceId).toBeUndefined();
    expect(r.effective).toBeNull();
  });

  it("[RN-3] repoints a repriced subscriber at the row they are billed at now", () => {
    const r = resolveRenewalPlanPriceId({ byInvoicePrice: priceRow(99), current: 42 });
    expect(r).toEqual({ planPriceId: 99, effective: 99, reason: "invoice_price" });
  });
});

describe("extractInvoicePriceId — both Stripe invoice line shapes", () => {
  it("[IV-1] reads the 2025 shape (pricing.price_details.price)", () => {
    expect(
      extractInvoicePriceId({ lines: { data: [{ pricing: { price_details: { price: "price_abc" } } }] } }),
    ).toBe("price_abc");
  });

  it("[IV-2] reads the legacy expanded price object", () => {
    expect(extractInvoicePriceId({ lines: { data: [{ price: { id: "price_legacy" } }] } })).toBe("price_legacy");
  });

  it("[IV-3] returns null for an invoice with no usable price — the renewal then leaves the column alone", () => {
    expect(extractInvoicePriceId({})).toBeNull();
    expect(extractInvoicePriceId({ lines: { data: [] } })).toBeNull();
    expect(extractInvoicePriceId({ lines: { data: [{ pricing: { price_details: {} } }] } })).toBeNull();
  });
});

describe("wiring contract — the resolved id must actually be persisted", () => {
  it("[WR-1] grantUserAccess writes planPriceId only when it is not undefined", () => {
    expect(WEBHOOK_SRC).toMatch(/if \(params\.planPriceId !== undefined\) \{\s*\n\s*updateValues\.planPriceId = params\.planPriceId;/);
  });

  it("[WR-2] checkout.session.completed threads the resolved id into BOTH fulfilment paths", () => {
    expect(WEBHOOK_SRC).toContain("resolvePlanPriceId({ byPurchasedPrice, byLineItemPrice })");
    // existing-user grant + new pending account creation
    expect(WEBHOOK_SRC).toContain("planId: plan, planPriceId, expiryMs");
    expect(WEBHOOK_SRC).toMatch(/planId: plan,\s*\n\s*planPriceId,/);
  });

  it("[WR-3] createPendingUserFromCheckout persists planPriceId on the INSERT", () => {
    expect(WEBHOOK_SRC).toMatch(/stripePlanId: params\.planId,\s*\n\s*planPriceId: params\.planPriceId \?\? null,/);
  });

  it("[WR-4] the renewal passes the resolver's verdict, not a raw id", () => {
    expect(WEBHOOK_SRC).toContain("planPriceId: renewalPrice.planPriceId");
  });

  it("[WR-5] admin createUser passes both entitlement fields through to the INSERT", () => {
    expect(APPUSERS_SRC).toMatch(/stripePlanId: input\.stripePlanId,\s*\n\s*planPriceId: input\.planPriceId,/);
  });
});

describe("backfillEntitlement contract — the ad-hoc script, made safe", () => {
  const PROC = APPUSERS_SRC.slice(
    APPUSERS_SRC.indexOf("backfillEntitlement: ownerProcedure"),
    APPUSERS_SRC.indexOf("updateUser: ownerProcedure"),
  );

  it("[BF-1] is owner-only", () => {
    expect(PROC).toContain("backfillEntitlement: ownerProcedure");
  });

  it("[BF-2] only ever touches role='user' rows", () => {
    expect(PROC).toContain(`eq(appUsersTable.role, "user")`);
  });

  it("[BF-3] never writes expiryDate — NULL already means lifetime", () => {
    const setBlock = PROC.slice(
      PROC.indexOf("db.update(appUsersTable).set({"),
      PROC.indexOf("}).where(missingEntitlement)"),
    );
    expect(setBlock).toContain("hasAccess: true");
    expect(setBlock).not.toContain("expiryDate");
  });

  it("[BF-4] is idempotent: NULL-safe predicate excludes rows that already match", () => {
    expect(PROC).toContain("isNull(appUsersTable.stripePlanId)");
    expect(PROC).toContain("isNull(appUsersTable.planPriceId)");
    expect(PROC).toContain("ne(appUsersTable.stripePlanId, input.planSlug)");
    expect(PROC).toContain("ne(appUsersTable.planPriceId, input.planPriceId)");
  });

  it("[BF-5] dryRun returns before any write", () => {
    const dryRunAt = PROC.indexOf("if (input.dryRun)");
    const updateAt = PROC.indexOf("db.update(appUsersTable)");
    expect(dryRunAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(dryRunAt);
  });

  it("[BF-6] invalidates the entitlement caches for every row it changed", () => {
    expect(PROC).toContain("invalidateAppUserByIdCache(r.id)");
    expect(PROC).toContain("invalidateCachedAppUser(r.id)");
  });
});
