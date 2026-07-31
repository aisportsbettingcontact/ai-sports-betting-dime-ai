/**
 * planRepricing.test.ts — the no-op detector behind repriceInterval.
 *
 * Pure logic only: no database, no Stripe. `billingShapeChanged` decides whether
 * an admin edit needs a NEW (immutable) Stripe Price or can be applied in place,
 * and getting it wrong is expensive in both directions — a false positive mints
 * a throwaway Price for every interval on a plan whenever the owner renames it;
 * a false negative silently keeps charging the old amount.
 */
import { describe, it, expect, vi } from "vitest";

// The module under test pulls in the Stripe SDK and the DB layer at import time.
// Neither is exercised here — stub them so the import stays side-effect free.
vi.mock("stripe", () => ({ default: vi.fn(() => ({})) }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../dbCircuitBreaker", () => ({ withCircuitBreaker: vi.fn((fn: () => unknown) => fn()) }));
vi.mock("./planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planStore")>();
  return { ...actual, getPlanBySlug: vi.fn(async () => null), invalidatePlanCache: vi.fn() };
});

import { billingShapeChanged, type BillingShapeRow } from "./planProvisioning";
import type { NewPriceInput } from "./planProvisioning";

/** A $49.99/month row with no trial and no promo. */
const row: BillingShapeRow = {
  amountCents: 4999,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  trialPeriodDays: null,
  promoType: null,
  promoValue: null,
  promoCode: null,
};

/** The same interval as the admin form would round-trip it, unchanged. */
const sameInput: NewPriceInput = {
  amountCents: 4999,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
};

describe("billingShapeChanged — unchanged shapes must NOT reprice", () => {
  it("is false for an identical billing shape", () => {
    expect(billingShapeChanged(row, sameInput)).toBe(false);
  });

  it("is false when currency is omitted (defaults to usd) or differently cased", () => {
    expect(billingShapeChanged(row, { ...sameInput, currency: undefined })).toBe(false);
    expect(billingShapeChanged(row, { ...sameInput, currency: "USD" })).toBe(false);
  });

  it("is false when intervalCount is omitted (defaults to 1)", () => {
    expect(billingShapeChanged(row, { ...sameInput, intervalCount: undefined })).toBe(false);
  });

  it("treats a 0-day trial and no trial as the same thing", () => {
    expect(billingShapeChanged(row, { ...sameInput, trialPeriodDays: 0 })).toBe(false);
    expect(billingShapeChanged({ ...row, trialPeriodDays: 0 }, sameInput)).toBe(false);
  });

  it("treats an empty promo code and no promo code as the same thing", () => {
    const promoRow: BillingShapeRow = { ...row, promoType: "percent", promoValue: 20, promoCode: null };
    const promoInput: NewPriceInput = { ...sameInput, promo: { type: "percent", value: 20, code: "" } };
    expect(billingShapeChanged(promoRow, promoInput)).toBe(false);
  });

  it("is false for a label-only edit — label is mutable on a live Stripe Price", () => {
    expect(billingShapeChanged(row, { ...sameInput, label: "Best value" })).toBe(false);
    expect(billingShapeChanged(row, { ...sameInput, label: undefined })).toBe(false);
  });

  it("is false for a hidden-only edit — hidden never touches Stripe", () => {
    expect(billingShapeChanged(row, { ...sameInput, hidden: true })).toBe(false);
    expect(billingShapeChanged(row, { ...sameInput, hidden: false })).toBe(false);
  });

  it("is false for a label AND hidden edit together", () => {
    expect(billingShapeChanged(row, { ...sameInput, label: "Popular", hidden: true })).toBe(false);
  });
});

describe("billingShapeChanged — immutable Stripe fields MUST reprice", () => {
  it("is true for a one-cent amount change", () => {
    expect(billingShapeChanged(row, { ...sameInput, amountCents: 5000 })).toBe(true);
    expect(billingShapeChanged(row, { ...sameInput, amountCents: 4998 })).toBe(true);
  });

  it("is true for a currency change", () => {
    expect(billingShapeChanged(row, { ...sameInput, currency: "eur" })).toBe(true);
  });

  it("is true for an interval change", () => {
    expect(billingShapeChanged(row, { ...sameInput, interval: "year", intervalCount: 1 })).toBe(true);
  });

  it("is true when a recurring interval becomes one-time (Lifetime)", () => {
    expect(billingShapeChanged(row, { amountCents: 4999, currency: "usd" })).toBe(true);
  });

  it("is true when a one-time price gains a cadence", () => {
    const oneTime: BillingShapeRow = { ...row, interval: null, intervalCount: null };
    expect(billingShapeChanged(oneTime, sameInput)).toBe(true);
  });

  it("is true for an intervalCount change", () => {
    expect(billingShapeChanged(row, { ...sameInput, intervalCount: 3 })).toBe(true);
  });

  it("is true for a trial change", () => {
    expect(billingShapeChanged(row, { ...sameInput, trialPeriodDays: 7 })).toBe(true);
    expect(billingShapeChanged({ ...row, trialPeriodDays: 7 }, sameInput)).toBe(true);
    expect(billingShapeChanged({ ...row, trialPeriodDays: 7 }, { ...sameInput, trialPeriodDays: 14 })).toBe(true);
  });

  it("is true for a promo added, removed, retyped, revalued or recoded", () => {
    const promoRow: BillingShapeRow = { ...row, promoType: "percent", promoValue: 20, promoCode: "LAUNCH20" };
    // added
    expect(billingShapeChanged(row, { ...sameInput, promo: { type: "percent", value: 20 } })).toBe(true);
    // removed
    expect(billingShapeChanged(promoRow, sameInput)).toBe(true);
    expect(billingShapeChanged(promoRow, { ...sameInput, promo: null })).toBe(true);
    // type changed
    expect(
      billingShapeChanged(promoRow, { ...sameInput, promo: { type: "amount", value: 20, code: "LAUNCH20" } }),
    ).toBe(true);
    // value changed
    expect(
      billingShapeChanged(promoRow, { ...sameInput, promo: { type: "percent", value: 25, code: "LAUNCH20" } }),
    ).toBe(true);
    // shareable code changed
    expect(
      billingShapeChanged(promoRow, { ...sameInput, promo: { type: "percent", value: 20, code: "LAUNCH21" } }),
    ).toBe(true);
  });
});

describe("billingShapeChanged — clamping parity with price creation", () => {
  /**
   * createAndPersistPrice clamps intervalCount to Stripe's ≤1-year ceiling before
   * the Price is created, so the stored row can differ from what the form sent.
   * The comparison must clamp identically or every save of a clamped interval
   * would look like a change and mint a redundant Price.
   */
  it("compares clamped interval counts, not raw input", () => {
    const yearly: BillingShapeRow = { ...row, interval: "year", intervalCount: 1 };
    const input: NewPriceInput = { amountCents: 4999, currency: "usd", interval: "year", intervalCount: 5 };
    expect(billingShapeChanged(yearly, input)).toBe(false);
  });

  it("compares clamped monthly counts (max 12)", () => {
    const monthly6: BillingShapeRow = { ...row, interval: "month", intervalCount: 12 };
    expect(
      billingShapeChanged(monthly6, { amountCents: 4999, interval: "month", intervalCount: 99 }),
    ).toBe(false);
    expect(
      billingShapeChanged(monthly6, { amountCents: 4999, interval: "month", intervalCount: 6 }),
    ).toBe(true);
  });
});
