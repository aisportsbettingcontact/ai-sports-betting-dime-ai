import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared spies (hoisted so the vi.mock factories can close over them).
const h = vi.hoisted(() => {
  const productsCreate = vi.fn(async (_p: unknown) => ({ id: "prod_TEST123", livemode: false }));
  const productsUpdate = vi.fn(async () => ({}));
  const pricesCreate = vi.fn(async (_p: unknown) => ({ id: "price_TEST123", livemode: false }));
  const inserts: Array<Record<string, unknown>> = [];
  return { productsCreate, productsUpdate, pricesCreate, inserts };
});

vi.mock("stripe", () => ({
  default: vi.fn(() => ({
    products: { create: h.productsCreate, update: h.productsUpdate },
    prices: { create: h.pricesCreate },
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
      price: { amountCents: 999, interval: "week", intervalCount: 1 },
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
      provisionPlan({ name: "Too Cheap", price: { amountCents: 10, interval: "month", intervalCount: 1 } }),
    ).rejects.toThrow(/amountCents/);
    expect(h.productsCreate).not.toHaveBeenCalled();
  });

  it("clamps a recurring interval to ≤ 1 year (year × 5 → 1)", async () => {
    await provisionPlan({ name: "Yearly", price: { amountCents: 49900, interval: "year", intervalCount: 5 } });
    const [priceParams] = h.pricesCreate.mock.calls[0] as [{ recurring: { interval_count: number } }];
    expect(priceParams.recurring.interval_count).toBe(1);
  });
});
