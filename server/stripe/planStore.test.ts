import { describe, it, expect } from "vitest";
import { computeExpiryMsForPrice, defaultPriceOf, type StoredPlan, type StoredPrice } from "./planStore";

const BASE = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const price = (over: Partial<StoredPrice> = {}): StoredPrice => ({
  id: 1,
  stripePriceId: "price_x",
  label: null,
  amountCents: 9900,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  trialPeriodDays: null,
  active: true,
  isDefault: false,
  ...over,
});

describe("computeExpiryMsForPrice — recurring (legacy-buffer parity)", () => {
  it("month × 1 → +31 days (matches products.ts computeExpiryMs)", () => {
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: 1 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 31 * DAY);
  });
  it("year × 1 → +366 days (leap buffer)", () => {
    expect(computeExpiryMsForPrice(price({ interval: "year", intervalCount: 1 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 366 * DAY);
  });
  it("day × 14 → +14 days", () => {
    expect(computeExpiryMsForPrice(price({ interval: "day", intervalCount: 14 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 14 * DAY);
  });
  it("week × 2 → +14 days", () => {
    expect(computeExpiryMsForPrice(price({ interval: "week", intervalCount: 2 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 14 * DAY);
  });
  it("null/zero intervalCount is treated as 1", () => {
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: null }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 31 * DAY);
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: 0 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 31 * DAY);
  });
  it("recurring with no interval → null (lifetime, defensive)", () => {
    expect(computeExpiryMsForPrice(price({ interval: null }), { planType: "recurring", accessUntil: null }, BASE)).toBeNull();
  });
});

describe("computeExpiryMsForPrice — fixed_date / one_time", () => {
  it("fixed_date → the plan's accessUntil, ignoring interval", () => {
    const until = BASE + 90 * DAY;
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: 1 }), { planType: "fixed_date", accessUntil: until }, BASE)).toBe(until);
  });
  it("one_time with accessUntil → that timestamp; without → null (lifetime)", () => {
    expect(computeExpiryMsForPrice(price({ interval: null }), { planType: "one_time", accessUntil: BASE + DAY }, BASE)).toBe(BASE + DAY);
    expect(computeExpiryMsForPrice(price({ interval: null }), { planType: "one_time", accessUntil: null }, BASE)).toBeNull();
  });
});

describe("defaultPriceOf", () => {
  const plan = (prices: StoredPrice[]): StoredPlan => ({
    id: 1, slug: "p", name: "P", description: null, planType: "recurring",
    stripeProductId: null, active: true, accessUntil: null, maxSubscribers: null,
    discordRoleId: null, telegramChatId: null, prices,
  });
  it("prefers the active default price", () => {
    const d = price({ id: 2, isDefault: true });
    expect(defaultPriceOf(plan([price({ id: 1 }), d]))?.id).toBe(2);
  });
  it("falls back to the first active price when no default", () => {
    expect(defaultPriceOf(plan([price({ id: 3, isDefault: false }), price({ id: 4 })]))?.id).toBe(3);
  });
  it("skips inactive prices and returns null when none active", () => {
    expect(defaultPriceOf(plan([price({ id: 5, active: false, isDefault: true })]))).toBeNull();
  });
});
