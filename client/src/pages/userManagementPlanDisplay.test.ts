/**
 * The PLAN column's display logic.
 *
 * This exists because the column previously rendered
 * `stripePlanId === 'annual' ? 'ANNUAL' : 'MONTHLY'`, which silently became
 * wrong the moment plan slugs stopped being the literal strings "monthly" and
 * "annual". Every one of the 85 lifetime members was labelled MONTHLY, and the
 * row's own EXPIRY cell said "Lifetime" directly beside it. Nothing failed; the
 * table just lied.
 *
 * The fixtures below are the REAL production shapes: dime-sharp / price 120005 /
 * $999.99 / billingInterval NULL.
 */
import { describe, it, expect } from "vitest";
import { formatBillingTerm, formatAmount } from "./userManagementPlanDisplay";

const LIFETIME = {
  billingInterval: null,
  intervalCount: null,
  isLifetime: true,
  priceResolved: true,
};

describe("formatBillingTerm", () => {
  it("calls the real production SKU LIFETIME, not MONTHLY — the regression", () => {
    expect(formatBillingTerm(LIFETIME)).toBe("LIFETIME");
  });

  it("names recurring intervals", () => {
    expect(
      formatBillingTerm({
        billingInterval: "month",
        intervalCount: 1,
        isLifetime: false,
        priceResolved: true,
      })
    ).toBe("MONTHLY");
    expect(
      formatBillingTerm({
        billingInterval: "year",
        intervalCount: 1,
        isLifetime: false,
        priceResolved: true,
      })
    ).toBe("YEARLY");
    expect(
      formatBillingTerm({
        billingInterval: "week",
        intervalCount: 1,
        isLifetime: false,
        priceResolved: true,
      })
    ).toBe("WEEKLY");
  });

  it("renders DAILY rather than the naive DAYLY", () => {
    expect(
      formatBillingTerm({
        billingInterval: "day",
        intervalCount: 1,
        isLifetime: false,
        priceResolved: true,
      })
    ).toBe("DAILY");
  });

  it("handles multi-interval prices", () => {
    expect(
      formatBillingTerm({
        billingInterval: "month",
        intervalCount: 3,
        isLifetime: false,
        priceResolved: true,
      })
    ).toBe("EVERY 3 MONTHS");
  });

  it("admits when the plan came from the slug alone rather than inventing a term", () => {
    expect(
      formatBillingTerm({
        billingInterval: null,
        intervalCount: null,
        isLifetime: null,
        priceResolved: false,
      })
    ).toBe("PLAN ONLY");
  });
});

describe("formatAmount", () => {
  it("formats the real lifetime price", () => {
    expect(formatAmount(99999, "usd")).toBe("$999.99");
  });

  it("treats 0 as a real amount, not as missing", () => {
    expect(formatAmount(0, "usd")).toBe("$0.00");
  });

  it("renders an em dash only when there is genuinely no amount", () => {
    expect(formatAmount(null, "usd")).toBe("—");
  });

  it("defaults a missing currency to USD instead of throwing", () => {
    expect(formatAmount(99999, null)).toBe("$999.99");
  });

  it("does not throw on an unknown currency code", () => {
    expect(() => formatAmount(99999, "xyz")).not.toThrow();
  });
});
