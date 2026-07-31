/**
 * planEditor.test.ts — pure unit contract for the Edit Plan modal's draft model.
 *
 * Runs under vitest's node environment (no DOM, no React). Everything the edit
 * flow decides — seeding the form from a StoredPlan, toggling a feature, and
 * converting the draft into the subscriptionPlans.update payload — lives in
 * planTypes.ts precisely so it can be pinned here. If the draft ever drifts from
 * the plan it was opened on, or a feature list reaches the server out of
 * canonical order, this fails.
 */
import { describe, it, expect } from "vitest";
import { buildPlanUpdateInput, planEditDraftFrom, toggleFeatureKey } from "./planTypes";
import type { StoredPlan } from "./planTypes";
import { PLAN_FEATURE_KEYS } from "@shared/planFeatures";

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

  it("never carries prices or inventory into the payload", () => {
    const built = buildPlanUpdateInput(7, planEditDraftFrom(plan()));
    expect(Object.keys(built as object).sort()).toEqual([
      "description",
      "features",
      "maxSubscribers",
      "name",
      "planId",
    ]);
  });
});
