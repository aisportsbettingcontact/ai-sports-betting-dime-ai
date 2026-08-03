/**
 * paymentLinkGuard.test.ts — the guard that stops a reprice from silently
 * breaking a Stripe Payment Link.
 *
 * A Payment Link binds to a SPECIFIC Price. `repriceInterval` archives the old
 * Price, and Stripe does not update, disable, or warn about links pointing at
 * it — the link just stops working. Two links in this account already point at
 * prices archived by earlier edits, and there is now a LIVE one-time payment
 * link that must not break.
 *
 * Pure logic + a stubbed Stripe SDK; NO network, NO database. The Stripe module
 * is mocked exactly as planRepricing.test.ts mocks it, so importing the
 * provisioning module stays side-effect free.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub Stripe: the constructor hands back a fake client whose paymentLinks
// methods each test programs. `vi.hoisted` because vi.mock factories are
// hoisted above ordinary consts.
const { stripeStub } = vi.hoisted(() => ({
  stripeStub: {
    paymentLinks: {
      list: vi.fn(),
      listLineItems: vi.fn(),
    },
  },
}));
// vitest 4: `new Stripe()` needs a constructable mock (arrows lost `new` support).
vi.mock("stripe", () => ({ default: vi.fn(function () { return stripeStub; }) }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../dbCircuitBreaker", () => ({ withCircuitBreaker: vi.fn((fn: () => unknown) => fn()) }));
vi.mock("./planStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planStore")>();
  return { ...actual, getPlanBySlug: vi.fn(async () => null), invalidatePlanCache: vi.fn() };
});

// getProvisioningStripe() resolves a key before constructing the (mocked) client.
process.env.STRIPE_TEST_SECRET_KEY = "sk_test_vitest_not_a_real_key";

import {
  findPaymentLinksForPrice,
  evaluatePaymentLinkGuard,
  guardPaymentLinksBeforeArchive,
  checkoutTrialPeriodDays,
  type PaymentLinkRef,
} from "./planProvisioning";

const PRICE = "price_target";
const OTHER = "price_unrelated";

/** One page of `paymentLinks.list` with line items already expanded. */
function page(
  links: Array<{ id: string; url: string; active: boolean; prices: string[] }>,
  hasMore = false,
) {
  return {
    has_more: hasMore,
    data: links.map((l) => ({
      id: l.id,
      url: l.url,
      active: l.active,
      line_items: { data: l.prices.map((p) => ({ price: { id: p } })) },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeStub.paymentLinks.list.mockReset();
  stripeStub.paymentLinks.listLineItems.mockReset();
});

describe("findPaymentLinksForPrice — which links sell this price", () => {
  it("returns only the links whose line items reference the price, with their active flag", async () => {
    stripeStub.paymentLinks.list.mockResolvedValue(
      page([
        { id: "plink_a", url: "https://buy.stripe.com/a", active: true, prices: [PRICE] },
        { id: "plink_b", url: "https://buy.stripe.com/b", active: false, prices: [PRICE] },
        { id: "plink_c", url: "https://buy.stripe.com/c", active: true, prices: [OTHER] },
      ]),
    );
    const found = await findPaymentLinksForPrice(PRICE);
    expect(found).toEqual([
      { id: "plink_a", url: "https://buy.stripe.com/a", active: true },
      { id: "plink_b", url: "https://buy.stripe.com/b", active: false },
    ]);
  });

  it("returns [] when the account has no payment links at all", async () => {
    stripeStub.paymentLinks.list.mockResolvedValue({ has_more: false, data: [] });
    expect(await findPaymentLinksForPrice(PRICE)).toEqual([]);
  });

  it("falls back to listLineItems when the expanded line_items are absent", async () => {
    // A link with no expanded line_items must NOT be read as a non-match — that
    // false negative is exactly what the guard exists to prevent.
    stripeStub.paymentLinks.list.mockResolvedValue({
      has_more: false,
      data: [{ id: "plink_x", url: "https://buy.stripe.com/x", active: true }],
    });
    stripeStub.paymentLinks.listLineItems.mockResolvedValue({ data: [{ price: { id: PRICE } }] });
    const found = await findPaymentLinksForPrice(PRICE);
    expect(stripeStub.paymentLinks.listLineItems).toHaveBeenCalledWith("plink_x", { limit: 100 });
    expect(found).toEqual([{ id: "plink_x", url: "https://buy.stripe.com/x", active: true }]);
  });

  it("accepts a bare price id string on a line item as well as an expanded object", async () => {
    stripeStub.paymentLinks.list.mockResolvedValue({
      has_more: false,
      data: [
        { id: "plink_s", url: "https://buy.stripe.com/s", active: true, line_items: { data: [{ price: PRICE }] } },
      ],
    });
    expect(await findPaymentLinksForPrice(PRICE)).toEqual([
      { id: "plink_s", url: "https://buy.stripe.com/s", active: true },
    ]);
  });

  it("paginates and LOGS — never silently caps — when the scan is truncated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Every page reports has_more, so the 5-page cap is hit.
    stripeStub.paymentLinks.list.mockImplementation(async () =>
      page([{ id: `plink_${Math.random()}`, url: "https://buy.stripe.com/z", active: true, prices: [OTHER] }], true),
    );
    await findPaymentLinksForPrice(PRICE);
    expect(stripeStub.paymentLinks.list).toHaveBeenCalledTimes(5);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/TRUNCATED/);
    warn.mockRestore();
  });
});

describe("guardPaymentLinksBeforeArchive — block / allow semantics", () => {
  it("BLOCKS when an ACTIVE link sells the price, naming its id and url", async () => {
    stripeStub.paymentLinks.list.mockResolvedValue(
      page([{ id: "plink_live", url: "https://buy.stripe.com/live", active: true, prices: [PRICE] }]),
    );
    await expect(guardPaymentLinksBeforeArchive(PRICE)).rejects.toThrow(/plink_live/);
    await expect(guardPaymentLinksBeforeArchive(PRICE)).rejects.toThrow(
      /https:\/\/buy\.stripe\.com\/live/,
    );
  });

  it("does NOT block on an INACTIVE link — it is already off", async () => {
    stripeStub.paymentLinks.list.mockResolvedValue(
      page([{ id: "plink_dead", url: "https://buy.stripe.com/dead", active: false, prices: [PRICE] }]),
    );
    const outcome = await guardPaymentLinksBeforeArchive(PRICE);
    expect(outcome.status).toBe("clear");
    expect(outcome.activeLinks).toEqual([]);
    expect(outcome.inactiveCount).toBe(1);
  });

  it("proceeds with a loud warning when the override is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeStub.paymentLinks.list.mockResolvedValue(
      page([{ id: "plink_live", url: "https://buy.stripe.com/live", active: true, prices: [PRICE] }]),
    );
    const outcome = await guardPaymentLinksBeforeArchive(PRICE, { allowBreakingPaymentLinks: true });
    expect(outcome.status).toBe("override");
    expect(outcome.activeLinks).toEqual([
      { id: "plink_live", url: "https://buy.stripe.com/live", active: true },
    ]);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/PAYMENT-LINK-OVERRIDE.*plink_live/s);
    warn.mockRestore();
  });

  it("does NOT block when the Stripe lookup itself FAILS — the guard is a net, not a dependency", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeStub.paymentLinks.list.mockRejectedValue(new Error("Stripe is down"));
    const outcome = await guardPaymentLinksBeforeArchive(PRICE);
    expect(outcome.status).toBe("failed");
    expect(outcome.summary).toMatch(/Stripe is down/);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/PAYMENT-LINK-CHECK.*FAILED/s);
    warn.mockRestore();
  });

  it("proceeds silently when no link references the price", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeStub.paymentLinks.list.mockResolvedValue(
      page([{ id: "plink_c", url: "https://buy.stripe.com/c", active: true, prices: [OTHER] }]),
    );
    const outcome = await guardPaymentLinksBeforeArchive(PRICE);
    expect(outcome.status).toBe("clear");
    expect(outcome.activeLinks).toEqual([]);
    expect(outcome.inactiveCount).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("evaluatePaymentLinkGuard — the decision, in isolation", () => {
  const activeLink: PaymentLinkRef = { id: "plink_1", url: "https://buy.stripe.com/1", active: true };
  const deadLink: PaymentLinkRef = { id: "plink_2", url: "https://buy.stripe.com/2", active: false };

  it("is clear for an empty list", () => {
    expect(evaluatePaymentLinkGuard(PRICE, []).status).toBe("clear");
  });

  it("throws for any active link, however many inactive ones surround it", () => {
    expect(() => evaluatePaymentLinkGuard(PRICE, [deadLink, activeLink, deadLink])).toThrow(/plink_1/);
  });

  it("counts inactive links without blocking on them", () => {
    const outcome = evaluatePaymentLinkGuard(PRICE, [deadLink, deadLink]);
    expect(outcome.status).toBe("clear");
    expect(outcome.inactiveCount).toBe(2);
  });

  it("says so in the summary when the scan was truncated", () => {
    expect(evaluatePaymentLinkGuard(PRICE, [], { truncated: true }).summary).toMatch(/TRUNCATED/);
  });
});

/**
 * LIFE-004 — `trialPeriodDays` is stored but has to be SPENT at the checkout
 * session (`subscription_data.trial_period_days`). This helper is the single
 * place that decides what value the session builder should send.
 */
describe("checkoutTrialPeriodDays — what checkout must send", () => {
  it("returns the day count for a recurring interval with a trial", () => {
    expect(checkoutTrialPeriodDays({ interval: "month", trialPeriodDays: 7 })).toBe(7);
  });

  it("returns undefined for no trial, a 0-day trial, or a negative value (Stripe's minimum is 1)", () => {
    expect(checkoutTrialPeriodDays({ interval: "month", trialPeriodDays: null })).toBeUndefined();
    expect(checkoutTrialPeriodDays({ interval: "month", trialPeriodDays: 0 })).toBeUndefined();
    expect(checkoutTrialPeriodDays({ interval: "month", trialPeriodDays: -3 })).toBeUndefined();
  });

  it("returns undefined for a one-time / Lifetime price — mode:payment has no subscription to trial", () => {
    expect(checkoutTrialPeriodDays({ interval: null, trialPeriodDays: 14 })).toBeUndefined();
  });
});
