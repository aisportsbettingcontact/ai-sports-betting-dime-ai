/**
 * subscriptionLedger.test.ts — the pure classification layer of the
 * subscription lifecycle ledger (avenues #3/#4/#8).
 *
 * The classifier decides what a customer.subscription.updated event MEANS —
 * including the Customer Portal plan switches that never touch our API. It is
 * pure so the priority order (plan change > cancel toggle > status move) is
 * provable without a webhook in the loop. These tests are DB-free by design:
 * the writer itself is exercised by the e2e harness against a real database.
 */
import { describe, it, expect } from "vitest";
import {
  classifySubscriptionUpdate,
  snapshotOfPreviousAttributes,
  type SubscriptionSnapshot,
} from "./subscriptionLedger";

const now = (
  over: Partial<SubscriptionSnapshot> = {}
): SubscriptionSnapshot => ({
  priceId: "price_new",
  interval: "month",
  status: "active",
  cancelAtPeriodEnd: false,
  ...over,
});

describe("classifySubscriptionUpdate", () => {
  it("[CL-1] a Customer Portal plan switch classifies as plan_changed with both price ids", () => {
    const prev: SubscriptionSnapshot = {
      priceId: "price_old",
      interval: "month",
    };
    const d = classifySubscriptionUpdate(prev, now());
    expect(d.kind).toBe("plan_changed");
    expect(d.detail).toContain("price_old");
    expect(d.detail).toContain("price_new");
  });

  it("[CL-2] cancel_at_period_end false→true is cancel_scheduled; true→false is cancel_reverted", () => {
    expect(
      classifySubscriptionUpdate(
        { cancelAtPeriodEnd: false },
        now({ cancelAtPeriodEnd: true })
      ).kind
    ).toBe("cancel_scheduled");
    expect(
      classifySubscriptionUpdate(
        { cancelAtPeriodEnd: true },
        now({ cancelAtPeriodEnd: false })
      ).kind
    ).toBe("cancel_reverted");
  });

  it("[CL-3] a bare status move (active→past_due) is status_changed", () => {
    const d = classifySubscriptionUpdate(
      { status: "active" },
      now({ status: "past_due" })
    );
    expect(d.kind).toBe("status_changed");
    expect(d.detail).toContain("past_due");
  });

  it("[CL-4] PRIORITY — a plan change reported alongside a status move names the plan change", () => {
    // Stripe can report several changed fields in one event. The ledger names
    // the transition a human cares about most; the detail string keeps nothing
    // hidden because the row also stores status and cancelAtPeriodEnd.
    const prev: SubscriptionSnapshot = {
      priceId: "price_old",
      status: "trialing",
      cancelAtPeriodEnd: false,
    };
    const d = classifySubscriptionUpdate(
      prev,
      now({ status: "active", cancelAtPeriodEnd: true })
    );
    expect(d.kind).toBe("plan_changed");
  });

  it("[CL-5] an update touching no tracked field is the generic 'updated', not a fabricated transition", () => {
    // e.g. default_payment_method changed — previous_attributes carries only
    // that field, so every tracked field is undefined in prev.
    const d = classifySubscriptionUpdate({}, now());
    expect(d.kind).toBe("updated");
  });

  it("[CL-6] undefined prev fields NEVER classify — absence of evidence is not a transition", () => {
    // prev.priceId undefined means Stripe did NOT report the price as changed;
    // comparing undefined !== 'price_new' must not fabricate a plan_changed.
    const d = classifySubscriptionUpdate(
      { status: "active" },
      now({ status: "active" })
    );
    expect(d.kind).toBe("updated");
  });
});

describe("snapshotOfPreviousAttributes", () => {
  it("[SN-1] extracts the old price and interval from a sparse items partial", () => {
    const s = snapshotOfPreviousAttributes({
      items: {
        data: [{ price: { id: "price_old", recurring: { interval: "year" } } }],
      },
    });
    expect(s.priceId).toBe("price_old");
    expect(s.interval).toBe("year");
  });

  it("[SN-2] leaves unreported fields undefined so the classifier cannot misread them", () => {
    const s = snapshotOfPreviousAttributes({ cancel_at_period_end: false });
    expect(s.cancelAtPeriodEnd).toBe(false);
    expect(s.priceId).toBeUndefined();
    expect(s.status).toBeUndefined();
  });

  it("[SN-3] null/undefined previous_attributes yields the empty snapshot (subscription.created path)", () => {
    expect(snapshotOfPreviousAttributes(undefined)).toEqual({});
    expect(snapshotOfPreviousAttributes(null)).toEqual({});
  });
});
