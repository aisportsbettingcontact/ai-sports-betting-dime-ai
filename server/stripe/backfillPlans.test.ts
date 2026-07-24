import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB + resilience + store lookups so we test the backfill orchestration
// (idempotency, skip-on-missing-env) without a live database.
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../dbCircuitBreaker", () => ({
  withCircuitBreaker: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("./planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planStore")>();
  return { ...actual, getPlanBySlug: vi.fn(async () => null), invalidatePlanCache: vi.fn() };
});

import { backfillStaticPlans } from "./backfillPlans";
import { getDb } from "../db";
import { getPlanBySlug } from "./planStore";

const PRICE_ENVS = [
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_ANNUAL",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_SHARP_MONTHLY",
  "STRIPE_PRICE_OPERATOR_MONTHLY",
] as const;

/** A fake drizzle db that records inserted values and hands back an insertId. */
function makeFakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        inserts.push(vals);
        return Promise.resolve([{ insertId: inserts.length }]);
      },
    }),
  };
  return { db, inserts };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Unset all price envs: legacy monthly/annual resolve via hardcoded fallback
  // (so they import); v2 pro/sharp/operator throw (so they skip) — deterministic.
  for (const v of PRICE_ENVS) delete process.env[v];
});

describe("backfillStaticPlans", () => {
  it("imports the resolvable legacy plans and skips v2 plans with no price env", async () => {
    const { db, inserts } = makeFakeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getPlanBySlug).mockResolvedValue(null);

    const result = await backfillStaticPlans();

    // monthly + annual import (hardcoded fallback price IDs); pro/sharp/operator skip.
    expect(result).toEqual({ inserted: 2, skipped: 3 });
    const planRows = inserts.filter((v) => "slug" in v);
    const priceRows = inserts.filter((v) => "stripePriceId" in v);
    expect(planRows.map((v) => v.slug).sort()).toEqual(["annual", "monthly"]);
    expect(priceRows).toHaveLength(2);
    expect(priceRows.every((v) => v.isDefault === true && v.active === true)).toBe(true);
  });

  it("is idempotent — inserts nothing when every plan already exists", async () => {
    const { db, inserts } = makeFakeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getPlanBySlug).mockResolvedValue({ slug: "exists" } as never);

    const result = await backfillStaticPlans();

    expect(result).toEqual({ inserted: 0, skipped: 5 });
    expect(inserts).toHaveLength(0);
  });

  it("no-ops safely when the DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    expect(await backfillStaticPlans()).toEqual({ inserted: 0, skipped: 0 });
  });
});
