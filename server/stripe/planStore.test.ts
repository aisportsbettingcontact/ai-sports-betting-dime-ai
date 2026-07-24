import { describe, it, expect } from "vitest";
import {
  computeExpiryMsForPrice,
  defaultPriceOf,
  defaultPriceForMode,
  computeNextQuantity,
  isSoldOut,
  LIFETIME_ACCESS_UNTIL_MS,
  type StoredPlan,
  type StoredPrice,
} from "./planStore";

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
  promoType: null,
  promoValue: null,
  promoCode: null,
  stripeCouponId: null,
  active: true,
  isDefault: false,
  hidden: false,
  sortOrder: 0,
  livemode: true,
  ...over,
});

describe("computeExpiryMsForPrice — recurring (exact durations, owner-specified 2026-07-24)", () => {
  it("month × 1 → +30 days (exact, no calendar buffer)", () => {
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: 1 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 30 * DAY);
  });
  it("year × 1 → +365 days (exact, no leap buffer)", () => {
    expect(computeExpiryMsForPrice(price({ interval: "year", intervalCount: 1 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 365 * DAY);
  });
  it("day × 14 → +14 days (1 day = exactly 24h)", () => {
    expect(computeExpiryMsForPrice(price({ interval: "day", intervalCount: 14 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 14 * DAY);
  });
  it("week × 2 → +14 days (1 week = exactly 7 days)", () => {
    expect(computeExpiryMsForPrice(price({ interval: "week", intervalCount: 2 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 14 * DAY);
  });
  it("null/zero intervalCount is treated as 1", () => {
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: null }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 30 * DAY);
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: 0 }), { planType: "recurring", accessUntil: null }, BASE)).toBe(BASE + 30 * DAY);
  });
  it("recurring with no interval (Lifetime) → far-future lifetime access", () => {
    expect(computeExpiryMsForPrice(price({ interval: null }), { planType: "recurring", accessUntil: null }, BASE)).toBe(LIFETIME_ACCESS_UNTIL_MS);
  });
});

describe("computeExpiryMsForPrice — fixed_date / one_time / lifetime", () => {
  it("fixed_date → the plan's accessUntil, ignoring interval", () => {
    const until = BASE + 90 * DAY;
    expect(computeExpiryMsForPrice(price({ interval: "month", intervalCount: 1 }), { planType: "fixed_date", accessUntil: until }, BASE)).toBe(until);
  });
  it("a no-interval (one-time / Lifetime) price → the plan's accessUntil, else far-future lifetime", () => {
    // one_time plans persist a far-future accessUntil, so that timestamp wins.
    expect(computeExpiryMsForPrice(price({ interval: null }), { planType: "one_time", accessUntil: BASE + DAY }, BASE)).toBe(BASE + DAY);
    // A recurring plan's "Lifetime" interval carries no plan accessUntil → far-future.
    expect(computeExpiryMsForPrice(price({ interval: null }), { planType: "one_time", accessUntil: null }, BASE)).toBe(LIFETIME_ACCESS_UNTIL_MS);
  });
});

describe("defaultPriceOf", () => {
  const plan = (prices: StoredPrice[]): StoredPlan => ({
    id: 1, slug: "p", name: "P", description: null, planType: "recurring",
    stripeProductId: null, active: true, accessUntil: null, maxSubscribers: null,
    autoRestock: false, availableQuantity: null, restockThreshold: null, restockAmount: null,
    discordRoleId: null, telegramChatId: null, livemode: true, prices,
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

describe("defaultPriceForMode — live checkout must never be handed a test price", () => {
  const plan = (prices: StoredPrice[]): StoredPlan => ({
    id: 1, slug: "p", name: "P", description: null, planType: "recurring",
    stripeProductId: null, active: true, accessUntil: null, maxSubscribers: null,
    autoRestock: false, availableQuantity: null, restockThreshold: null, restockAmount: null,
    discordRoleId: null, telegramChatId: null, livemode: true, prices,
  });
  const live = price({ id: 1, stripePriceId: "price_live", livemode: true, isDefault: true });
  const test = price({ id: 2, stripePriceId: "price_test", livemode: false, isDefault: true });

  it("returns the mode-matched price (live for wantLive, test otherwise)", () => {
    const p = plan([live, test]);
    expect(defaultPriceForMode(p, true)?.stripePriceId).toBe("price_live");
    expect(defaultPriceForMode(p, false)?.stripePriceId).toBe("price_test");
  });
  it("returns null when no active price matches the mode — the safety guard", () => {
    expect(defaultPriceForMode(plan([test]), true)).toBeNull(); // only a sandbox price → live checkout gets nothing
    expect(defaultPriceForMode(plan([live]), false)).toBeNull();
  });
  it("prefers the default within the mode and skips inactive", () => {
    const liveDefault = price({ id: 3, stripePriceId: "price_live_def", livemode: true, isDefault: true });
    const liveOther = price({ id: 4, stripePriceId: "price_live_other", livemode: true, isDefault: false });
    expect(defaultPriceForMode(plan([liveOther, liveDefault]), true)?.stripePriceId).toBe("price_live_def");
    const inactiveLive = price({ id: 5, stripePriceId: "price_x", livemode: true, active: false, isDefault: true });
    expect(defaultPriceForMode(plan([inactiveLive]), true)).toBeNull();
  });
  it("skips hidden intervals — a hidden price is never the checkout default", () => {
    const hiddenDefault = price({ id: 6, stripePriceId: "price_hidden", livemode: true, isDefault: true, hidden: true });
    const visible = price({ id: 7, stripePriceId: "price_visible", livemode: true, isDefault: false, hidden: false });
    expect(defaultPriceForMode(plan([hiddenDefault, visible]), true)?.stripePriceId).toBe("price_visible");
    expect(defaultPriceForMode(plan([hiddenDefault]), true)).toBeNull();
  });
});

describe("computeNextQuantity — the auto-restock FOMO loop", () => {
  const cfg = (over: Partial<Parameters<typeof computeNextQuantity>[0]> = {}) => ({
    availableQuantity: 5,
    autoRestock: false,
    restockThreshold: null,
    restockAmount: null,
    ...over,
  });

  it("returns null when the plan is not limited-quantity", () => {
    expect(computeNextQuantity(cfg({ availableQuantity: null }))).toBeNull();
  });
  it("decrements by one on a normal subscribe", () => {
    expect(computeNextQuantity(cfg({ availableQuantity: 5 }))).toBe(4);
  });
  it("clamps at zero (never negative) with no restock", () => {
    expect(computeNextQuantity(cfg({ availableQuantity: 0 }))).toBe(0);
  });
  it("resets to restockAmount when the result drops BELOW the threshold", () => {
    // 3 → 2, which is < threshold 2? no (2 is not < 2). 2 stays.
    expect(computeNextQuantity(cfg({ availableQuantity: 3, autoRestock: true, restockThreshold: 2, restockAmount: 3 }))).toBe(2);
    // 2 → 1, which IS < 2 → reset to 3.
    expect(computeNextQuantity(cfg({ availableQuantity: 2, autoRestock: true, restockThreshold: 2, restockAmount: 3 }))).toBe(3);
  });
  it("recycles indefinitely — a reset value re-decrements next time", () => {
    const c = cfg({ availableQuantity: 3, autoRestock: true, restockThreshold: 2, restockAmount: 3 });
    const a = computeNextQuantity(c)!; // 3 → 2
    const b = computeNextQuantity({ ...c, availableQuantity: a })!; // 2 → reset 3
    expect([a, b]).toEqual([2, 3]);
  });
  it("ignores restock when autoRestock is off (drains to 0)", () => {
    expect(computeNextQuantity(cfg({ availableQuantity: 1, autoRestock: false, restockThreshold: 5, restockAmount: 9 }))).toBe(0);
  });
});

describe("isSoldOut", () => {
  it("true only for a limited-quantity plan at 0", () => {
    expect(isSoldOut({ availableQuantity: 0 })).toBe(true);
    expect(isSoldOut({ availableQuantity: 1 })).toBe(false);
    expect(isSoldOut({ availableQuantity: null })).toBe(false); // unlimited never sells out
  });
});
