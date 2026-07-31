/**
 * planEditor.test.ts — pure unit contract for the Edit Plan modal's draft model.
 *
 * Runs under vitest's node environment (no DOM, no React). Everything the edit
 * flow decides — seeding the form from a StoredPlan, toggling a feature, picking
 * the default interval, and converting the draft into the subscriptionPlans
 * .update / .updateInterval payloads — lives in planTypes.ts precisely so it can
 * be pinned here. If the draft ever drifts from the plan it was opened on, a
 * feature list reaches the server out of canonical order, or a lifetime interval
 * starts shipping a cadence, this fails.
 */
import { describe, it, expect } from "vitest";
import {
  buildIntervalUpdateInput,
  buildPlanUpdateInput,
  intervalEditDraftFrom,
  planEditDraftFrom,
  removeIntervalDraft,
  setDefaultIntervalKey,
  toggleFeatureKey,
} from "./planTypes";
import type { IntervalEditDraft, StoredPlan, StoredPrice } from "./planTypes";
import { PLAN_FEATURE_KEYS } from "@shared/planFeatures";

/** A price shaped exactly as subscriptionPlans.list nests it under a plan. */
function price(overrides: Partial<StoredPrice> = {}): StoredPrice {
  return {
    id: 31,
    stripePriceId: "price_abc",
    label: "Monthly",
    amountCents: 4900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    trialPeriodDays: 7,
    promoType: null,
    promoValue: null,
    promoCode: null,
    stripeCouponId: null,
    active: true,
    isDefault: true,
    hidden: false,
    sortOrder: 0,
    livemode: false,
    ...overrides,
  };
}

/** A plan shaped exactly as subscriptionPlans.list returns it. */
function plan(overrides: Partial<StoredPlan> = {}): StoredPlan {
  return {
    id: 7,
    slug: "dime-pro",
    name: "Dime Pro",
    description: "Everything the model prices.",
    planType: "recurring",
    stripeProductId: "prod_123",
    active: true,
    accessUntil: null,
    maxSubscribers: 250,
    autoRestock: true,
    availableQuantity: 5,
    restockThreshold: 2,
    restockAmount: 3,
    discordRoleId: null,
    telegramChatId: null,
    livemode: false,
    prices: [],
    features: ["daily_lineups", "betting_splits"],
    subscriberCount: 42,
    ...overrides,
  };
}

/** The draft row for a price, as the modal would hold it. */
function draftFor(overrides: Partial<StoredPrice> = {}): IntervalEditDraft {
  return intervalEditDraftFrom(price(overrides));
}

describe("planEditDraftFrom", () => {
  it("seeds every field from the plan's current values", () => {
    expect(planEditDraftFrom(plan())).toEqual({
      name: "Dime Pro",
      description: "Everything the model prices.",
      maxSubscribers: "250",
      limitedQuantity: true,
      availableQuantity: "5",
      autoRestock: true,
      restockThreshold: "2",
      restockAmount: "3",
      features: ["daily_lineups", "betting_splits"],
      intervals: [],
    });
  });

  it("seeds the plan's live intervals, skipping retired prices", () => {
    const draft = planEditDraftFrom(
      plan({
        prices: [
          price({ id: 31, amountCents: 4900 }),
          price({ id: 32, stripePriceId: "price_dead", active: false, isDefault: false }),
          price({ id: 33, stripePriceId: "price_year", label: null, amountCents: 49000, interval: "year", isDefault: false }),
        ],
      }),
    );
    expect(draft.intervals.map((iv) => iv.priceId)).toEqual([31, 33]);
    expect(draft.intervals[0]).toEqual({
      key: "price-31",
      priceId: 31,
      price: "49.00",
      interval: { interval: "month", intervalCount: 1 },
      trialDays: "7",
      hidden: false,
      promoOn: false,
      promoType: "percent",
      promoValue: "",
      promoCode: "",
      label: "Monthly",
      isDefault: true,
    });
    expect(draft.intervals[1].label).toBe("");
  });

  it("seeds a cadence-less price as the one-time Lifetime sentinel", () => {
    const draft = draftFor({ interval: null, intervalCount: null, trialPeriodDays: null });
    expect(draft.interval).toEqual({ interval: "lifetime", intervalCount: 1 });
    expect(draft.trialDays).toBe("");
  });

  it("seeds a promo back into the form, in the units its input renders", () => {
    expect(draftFor({ promoType: "percent", promoValue: 25, promoCode: "LAUNCH" })).toMatchObject({
      promoOn: true,
      promoType: "percent",
      promoValue: "25",
      promoCode: "LAUNCH",
    });
    expect(draftFor({ promoType: "amount", promoValue: 1500 })).toMatchObject({
      promoOn: true,
      promoType: "amount",
      promoValue: "15.00",
      promoCode: "",
    });
  });

  it("renders nulls as blank strings and no quantity cap as limitedQuantity:false", () => {
    const draft = planEditDraftFrom(
      plan({
        description: null,
        maxSubscribers: null,
        availableQuantity: null,
        autoRestock: false,
        restockThreshold: null,
        restockAmount: null,
        features: [],
      }),
    );
    expect(draft.description).toBe("");
    expect(draft.maxSubscribers).toBe("");
    expect(draft.limitedQuantity).toBe(false);
    expect(draft.availableQuantity).toBe("");
    expect(draft.restockThreshold).toBe("");
    expect(draft.restockAmount).toBe("");
    expect(draft.features).toEqual([]);
  });

  it("keeps a zero available quantity (sold out) rather than treating it as unset", () => {
    const draft = planEditDraftFrom(plan({ availableQuantity: 0 }));
    expect(draft.limitedQuantity).toBe(true);
    expect(draft.availableQuantity).toBe("0");
  });

  it("normalises features that arrive out of canonical order", () => {
    const draft = planEditDraftFrom(plan({ features: ["betting_splits", "ai_model_projections"] }));
    expect(draft.features).toEqual(["ai_model_projections", "betting_splits"]);
  });
});

describe("toggleFeatureKey", () => {
  it("adds a key that was not selected", () => {
    expect(toggleFeatureKey(["daily_lineups"], "betting_splits")).toEqual(["daily_lineups", "betting_splits"]);
  });

  it("removes a key that was selected", () => {
    expect(toggleFeatureKey(["daily_lineups", "betting_splits"], "daily_lineups")).toEqual(["betting_splits"]);
  });

  it("returns the canonical order regardless of the order keys were picked in", () => {
    const picked = ["early_access_features", "ai_model_projections", "betting_splits"].reduce<string[]>(
      (acc, key) => toggleFeatureKey(acc, key),
      [],
    );
    expect(picked).toEqual(["ai_model_projections", "betting_splits", "early_access_features"]);
  });

  it("de-duplicates a key already present in the incoming list", () => {
    expect(toggleFeatureKey(["daily_lineups", "daily_lineups"], "betting_splits")).toEqual([
      "daily_lineups",
      "betting_splits",
    ]);
  });

  it("drops unknown keys instead of persisting them", () => {
    expect(toggleFeatureKey(["not_a_feature"], "daily_lineups")).toEqual(["daily_lineups"]);
  });

  it("toggling every key on then off ends empty", () => {
    const all = PLAN_FEATURE_KEYS.reduce<string[]>((acc, key) => toggleFeatureKey(acc, key), []);
    expect(all).toEqual([...PLAN_FEATURE_KEYS]);
    expect(PLAN_FEATURE_KEYS.reduce<string[]>((acc, key) => toggleFeatureKey(acc, key), all)).toEqual([]);
  });
});

describe("buildPlanUpdateInput", () => {
  it("round-trips an untouched draft back to the plan's own values", () => {
    const p = plan();
    expect(buildPlanUpdateInput(p.id, planEditDraftFrom(p))).toEqual({
      planId: 7,
      name: "Dime Pro",
      description: "Everything the model prices.",
      maxSubscribers: 250,
      features: ["daily_lineups", "betting_splits"],
      restock: { autoRestock: true, availableQuantity: 5, restockThreshold: 2, restockAmount: 3 },
    });
  });

  it("trims the name and submits a blank description as null", () => {
    const draft = { ...planEditDraftFrom(plan()), name: "  Dime Elite  ", description: "   " };
    const built = buildPlanUpdateInput(7, draft);
    expect(built).toMatchObject({ name: "Dime Elite", description: null });
  });

  it("submits a blank max subscribers as null (unlimited)", () => {
    const built = buildPlanUpdateInput(7, { ...planEditDraftFrom(plan()), maxSubscribers: "" });
    expect(built).toMatchObject({ maxSubscribers: null });
  });

  it("normalises features before submit — canonical order, de-duplicated, unknowns dropped", () => {
    const draft = {
      ...planEditDraftFrom(plan()),
      // Cast: the picker can only emit known keys, but the payload must survive
      // a stale/hand-edited draft without shipping junk to the server.
      features: ["betting_splits", "daily_lineups", "betting_splits", "nope"] as never,
    };
    expect(buildPlanUpdateInput(7, draft)).toMatchObject({ features: ["daily_lineups", "betting_splits"] });
  });

  it("rejects an empty name", () => {
    expect(buildPlanUpdateInput(7, { ...planEditDraftFrom(plan()), name: "   " })).toBe("Name is required.");
  });

  it("rejects a max subscribers below 1", () => {
    expect(buildPlanUpdateInput(7, { ...planEditDraftFrom(plan()), maxSubscribers: "0" })).toBe(
      "Max subscribers must be 1 or more (leave blank for unlimited).",
    );
  });

  it("rejects a non-numeric max subscribers", () => {
    expect(buildPlanUpdateInput(7, { ...planEditDraftFrom(plan()), maxSubscribers: "many" })).toBe(
      "Max subscribers must be 1 or more (leave blank for unlimited).",
    );
  });

  it("carries inventory but never a price into the payload", () => {
    const built = buildPlanUpdateInput(7, planEditDraftFrom(plan({ prices: [price()] })));
    expect(Object.keys(built as object).sort()).toEqual([
      "description",
      "features",
      "maxSubscribers",
      "name",
      "planId",
      "restock",
    ]);
  });
});

describe("buildPlanUpdateInput — restock", () => {
  it("submits null restock when the limited-quantity toggle is off (unlimited)", () => {
    const draft = { ...planEditDraftFrom(plan()), limitedQuantity: false };
    expect(buildPlanUpdateInput(7, draft)).toMatchObject({ restock: null });
  });

  it("nulls the thresholds when the cap is on but auto-restock is off", () => {
    const draft = { ...planEditDraftFrom(plan()), autoRestock: false };
    expect(buildPlanUpdateInput(7, draft)).toMatchObject({
      restock: { autoRestock: false, availableQuantity: 5, restockThreshold: null, restockAmount: null },
    });
  });

  it("keeps a zero available quantity (sold out) rather than reading it as unset", () => {
    const draft = { ...planEditDraftFrom(plan()), availableQuantity: "0", autoRestock: false };
    expect(buildPlanUpdateInput(7, draft)).toMatchObject({
      restock: { autoRestock: false, availableQuantity: 0, restockThreshold: null, restockAmount: null },
    });
  });

  it("rejects a blank or negative available quantity", () => {
    const seed = planEditDraftFrom(plan());
    expect(buildPlanUpdateInput(7, { ...seed, availableQuantity: "" })).toBe("Available quantity must be 0 or more.");
    expect(buildPlanUpdateInput(7, { ...seed, availableQuantity: "-1" })).toBe("Available quantity must be 0 or more.");
  });

  it("rejects restock thresholds that cannot restock anything", () => {
    const seed = planEditDraftFrom(plan());
    expect(buildPlanUpdateInput(7, { ...seed, restockThreshold: "nope" })).toBe("Restock threshold must be 0 or more.");
    expect(buildPlanUpdateInput(7, { ...seed, restockAmount: "0" })).toBe("Restock amount must be 1 or more.");
  });
});

describe("buildIntervalUpdateInput", () => {
  it("round-trips an untouched interval row back to the price's own values", () => {
    const p = price();
    expect(buildIntervalUpdateInput(p, intervalEditDraftFrom(p))).toEqual({
      priceId: 31,
      amountCents: 4900,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      label: "Monthly",
      trialPeriodDays: 7,
      hidden: false,
      isDefault: true,
      promo: null,
    });
  });

  it("maps a lifetime selection to no interval — no cadence, no count, no trial", () => {
    const p = price();
    const draft: IntervalEditDraft = {
      ...intervalEditDraftFrom(p),
      interval: { interval: "lifetime", intervalCount: 1 },
      trialDays: "14",
    };
    const built = buildIntervalUpdateInput(p, draft);
    expect(built).toMatchObject({ interval: null, trialPeriodDays: null });
    expect(built as object).not.toHaveProperty("intervalCount");
  });

  it("keeps a price already stored as one-time one-time", () => {
    const p = price({ interval: null, intervalCount: null, trialPeriodDays: null });
    expect(buildIntervalUpdateInput(p, intervalEditDraftFrom(p))).toMatchObject({ interval: null });
  });

  it("submits a blank label as null", () => {
    const p = price();
    expect(buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), label: "   " })).toMatchObject({ label: null });
  });

  it("carries hidden and isDefault through on every save", () => {
    const p = price();
    expect(
      buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), hidden: true, isDefault: false }),
    ).toMatchObject({ hidden: true, isDefault: false });
  });

  it("rejects a non-positive amount", () => {
    const p = price();
    expect(buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), price: "0" })).toBe(
      "Monthly: enter a price of at least $0.50.",
    );
    expect(buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), price: "-5.00" })).toBe(
      "Monthly: enter a price of at least $0.50.",
    );
  });

  it("rejects a non-numeric amount", () => {
    const p = price();
    expect(buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), price: "free" })).toBe(
      "Monthly: enter a price of at least $0.50.",
    );
  });

  it("names an unlabelled row by its price id in errors", () => {
    const p = price({ label: null });
    expect(buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), price: "" })).toBe(
      "Interval 31: enter a price of at least $0.50.",
    );
  });

  it("rejects a negative free trial", () => {
    const p = price();
    expect(buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), trialDays: "-1" })).toBe(
      "Monthly: free trial days must be 0 or more.",
    );
  });

  it("converts a percent promo as an integer and a dollar promo to cents", () => {
    const p = price();
    const seed = intervalEditDraftFrom(p);
    expect(
      buildIntervalUpdateInput(p, { ...seed, promoOn: true, promoType: "percent", promoValue: "30", promoCode: "LAUNCH30" }),
    ).toMatchObject({ promo: { type: "percent", value: 30, code: "LAUNCH30" } });
    expect(buildIntervalUpdateInput(p, { ...seed, promoOn: true, promoType: "amount", promoValue: "10.00" })).toMatchObject({
      promo: { type: "amount", value: 1000 },
    });
  });

  it("rejects a discount that is not smaller than the price", () => {
    const p = price();
    expect(
      buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), promoOn: true, promoType: "amount", promoValue: "49.00" }),
    ).toBe("Monthly: discount must be less than the price.");
  });

  it("rejects a percent promo outside 1–100", () => {
    const p = price();
    expect(
      buildIntervalUpdateInput(p, { ...intervalEditDraftFrom(p), promoOn: true, promoType: "percent", promoValue: "150" }),
    ).toBe("Monthly: percent promo must be 1–100.");
  });
});

describe("setDefaultIntervalKey / removeIntervalDraft", () => {
  const rows = (): IntervalEditDraft[] => [
    intervalEditDraftFrom(price({ id: 31, label: "Monthly", isDefault: true })),
    intervalEditDraftFrom(price({ id: 32, label: "Annual", isDefault: false })),
    intervalEditDraftFrom(price({ id: 33, label: "Lifetime", isDefault: false })),
  ];

  it("leaves exactly one interval default after a pick", () => {
    const picked = setDefaultIntervalKey(rows(), "price-33");
    expect(picked.filter((iv) => iv.isDefault).map((iv) => iv.priceId)).toEqual([33]);
  });

  it("still leaves exactly one default when the current default is re-picked", () => {
    const picked = setDefaultIntervalKey(rows(), "price-31");
    expect(picked.filter((iv) => iv.isDefault)).toHaveLength(1);
  });

  it("cannot leave two defaults however many times it is applied", () => {
    const picked = ["price-32", "price-33", "price-31"].reduce(setDefaultIntervalKey, rows());
    expect(picked.filter((iv) => iv.isDefault).map((iv) => iv.priceId)).toEqual([31]);
  });

  it("promotes the first survivor when the default row is removed", () => {
    const kept = removeIntervalDraft(rows(), "price-31");
    expect(kept.map((iv) => iv.priceId)).toEqual([32, 33]);
    expect(kept.filter((iv) => iv.isDefault).map((iv) => iv.priceId)).toEqual([32]);
  });

  it("keeps the existing default when a non-default row is removed", () => {
    const kept = removeIntervalDraft(rows(), "price-33");
    expect(kept.filter((iv) => iv.isDefault).map((iv) => iv.priceId)).toEqual([31]);
  });

  it("refuses to remove a plan's last interval", () => {
    const one = [rows()[0]];
    expect(removeIntervalDraft(one, "price-31")).toEqual(one);
  });
});
