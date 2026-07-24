import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared spies (hoisted so the vi.mock factories can close over them).
const h = vi.hoisted(() => {
  const productsCreate = vi.fn(async (_p: unknown) => ({ id: "prod_TEST123", livemode: false }));
  const productsUpdate = vi.fn(async () => ({}));
  const pricesCreate = vi.fn(async (_p: unknown) => ({ id: "price_TEST123", livemode: false }));
  const couponsCreate = vi.fn(async (_p: unknown) => ({ id: "coupon_TEST123" }));
  const promotionCodesCreate = vi.fn(async (_p: unknown) => ({ id: "promo_TEST123" }));
  const inserts: Array<Record<string, unknown>> = [];
  return { productsCreate, productsUpdate, pricesCreate, couponsCreate, promotionCodesCreate, inserts };
});

vi.mock("stripe", () => ({
  default: vi.fn(() => ({
    products: { create: h.productsCreate, update: h.productsUpdate },
    prices: { create: h.pricesCreate },
    coupons: { create: h.couponsCreate },
    promotionCodes: { create: h.promotionCodesCreate },
  })),
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        h.inserts.push(vals);
        return Promise.resolve([{ insertId: h.inserts.length }]);
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{}]) }) }),
  })),
}));
vi.mock("../dbCircuitBreaker", () => ({ withCircuitBreaker: vi.fn((fn: () => unknown) => fn()) }));
vi.mock("./planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planStore")>();
  return { ...actual, getPlanBySlug: vi.fn(async () => null), invalidatePlanCache: vi.fn() };
});

import { provisionPlan, slugify, isProvisioningTestMode } from "./planProvisioning";

beforeEach(() => {
  vi.clearAllMocks();
  h.inserts.length = 0;
  process.env.STRIPE_TEST_SECRET_KEY = "rk_test_fake_key_for_unit_tests_only";
});

describe("slugify", () => {
  it("kebab-cases and trims", () => {
    expect(slugify("Pro Weekly!!")).toBe("pro-weekly");
    expect(slugify("  Sharp — $249/mo  ")).toBe("sharp-249-mo");
    expect(slugify("")).toBe("plan");
  });
});

describe("isProvisioningTestMode", () => {
  it("is true when STRIPE_TEST_SECRET_KEY is set", () => {
    expect(isProvisioningTestMode()).toBe(true);
  });
});

describe("provisionPlan", () => {
  it("creates a Stripe Product then Price and persists both", async () => {
    const result = await provisionPlan({
      name: "Pro Weekly",
      description: "Weekly access",
      prices: [{ amountCents: 999, interval: "week", intervalCount: 1 }],
    });

    expect(result).toEqual({
      planId: 1,
      slug: "pro-weekly",
      stripeProductId: "prod_TEST123",
      stripePriceId: "price_TEST123",
    });

    // Product created with the slug in metadata + an idempotency key.
    const [prodParams, prodOpts] = h.productsCreate.mock.calls[0] as [Record<string, unknown>, { idempotencyKey?: string }];
    expect(prodParams).toMatchObject({ name: "Pro Weekly", metadata: { dime_plan_slug: "pro-weekly" } });
    expect(prodOpts.idempotencyKey).toContain("pro-weekly");

    // Price created recurring, correct amount/interval, NO payment_method_types.
    const [priceParams] = h.pricesCreate.mock.calls[0] as [Record<string, unknown>];
    expect(priceParams).toMatchObject({
      product: "prod_TEST123",
      unit_amount: 999,
      currency: "usd",
      recurring: { interval: "week", interval_count: 1 },
    });
    expect(JSON.stringify(priceParams)).not.toContain("payment_method_types");

    // Persisted a plan row + a default price row.
    const planRow = h.inserts.find((v) => "slug" in v);
    const priceRow = h.inserts.find((v) => "stripePriceId" in v);
    expect(planRow).toMatchObject({ slug: "pro-weekly", stripeProductId: "prod_TEST123", planType: "recurring", livemode: false });
    expect(priceRow).toMatchObject({ stripePriceId: "price_TEST123", isDefault: true, active: true, amountCents: 999, livemode: false });
  });

  it("rejects an amount below the Stripe minimum (50c)", async () => {
    await expect(
      provisionPlan({ name: "Too Cheap", prices: [{ amountCents: 10, interval: "month", intervalCount: 1 }] }),
    ).rejects.toThrow(/amountCents/);
    expect(h.productsCreate).not.toHaveBeenCalled();
  });

  it("clamps a recurring interval to ≤ 1 year (year × 5 → 1)", async () => {
    await provisionPlan({ name: "Yearly", prices: [{ amountCents: 49900, interval: "year", intervalCount: 5 }] });
    const [priceParams] = h.pricesCreate.mock.calls[0] as [{ recurring: { interval_count: number } }];
    expect(priceParams.recurring.interval_count).toBe(1);
  });

  it("creates multiple intervals under one product, with a promo coupon per promo'd interval", async () => {
    const result = await provisionPlan({
      name: "Dime Pro",
      prices: [
        { amountCents: 9900, interval: "month", intervalCount: 1, promo: { type: "percent", value: 50, code: "MONTH50" } },
        { amountCents: 4900, interval: "week", intervalCount: 1, promo: { type: "percent", value: 25 } },
      ],
    });
    // One product, two prices.
    expect(h.productsCreate).toHaveBeenCalledTimes(1);
    expect(h.pricesCreate).toHaveBeenCalledTimes(2);
    // A coupon per interval; a promotion code only for the one with a code.
    expect(h.couponsCreate).toHaveBeenCalledTimes(2);
    expect(h.promotionCodesCreate).toHaveBeenCalledTimes(1);
    const [promoParams] = h.promotionCodesCreate.mock.calls[0] as [{ code: string; coupon: string }];
    expect(promoParams.code).toBe("MONTH50");
    // First interval is the default; its price id is returned.
    expect(result.slug).toBe("dime-pro");
    const priceRows = h.inserts.filter((v) => "stripePriceId" in v);
    expect(priceRows).toHaveLength(2);
    expect(priceRows[0]).toMatchObject({ isDefault: true, promoType: "percent", promoValue: 50, promoCode: "MONTH50", stripeCouponId: "coupon_TEST123" });
    expect(priceRows[1]).toMatchObject({ isDefault: false, promoType: "percent", promoValue: 25, promoCode: null });
  });

  it("rejects a percent promo above 100", async () => {
    await expect(
      provisionPlan({ name: "Bad Promo", prices: [{ amountCents: 9900, interval: "month", intervalCount: 1, promo: { type: "percent", value: 150 } }] }),
    ).rejects.toThrow(/percent/);
  });

  it("rejects a fixed promo that meets or exceeds the price", async () => {
    await expect(
      provisionPlan({ name: "Over Discount", prices: [{ amountCents: 5000, interval: "month", intervalCount: 1, promo: { type: "amount", value: 5000 } }] }),
    ).rejects.toThrow(/less than the price/);
  });

  it("provisions a one_time plan — a non-recurring Stripe price + lifetime accessUntil", async () => {
    await provisionPlan({
      name: "Lifetime VIP",
      planType: "one_time",
      prices: [{ amountCents: 49900 }],
      maxSubscribers: 10,
    });
    // The Stripe price carries no `recurring` block.
    const [priceParams] = h.pricesCreate.mock.calls[0] as [Record<string, unknown>];
    expect(priceParams).not.toHaveProperty("recurring");
    // The plan row is one_time, capped, and granted a far-future (lifetime) accessUntil.
    const planRow = h.inserts.find((v) => "slug" in v)!;
    expect(planRow).toMatchObject({ planType: "one_time", maxSubscribers: 10 });
    expect(typeof planRow.accessUntil).toBe("number");
    expect(planRow.accessUntil as number).toBeGreaterThan(4000000000000);
    // The price row has no interval and default sort/hidden.
    const priceRow = h.inserts.find((v) => "stripePriceId" in v)!;
    expect(priceRow).toMatchObject({ interval: null, intervalCount: null, sortOrder: 0, hidden: false, isDefault: true });
  });
});
