/**
 * The feature catalog is the contract between the admin picker, the tRPC
 * validator and the `plan_features` table. Keys are persisted, so a silent
 * rename here would orphan rows that no longer render.
 */
import { describe, it, expect } from "vitest";
import {
  PLAN_FEATURES,
  PLAN_FEATURE_KEYS,
  isPlanFeatureKey,
  planFeatureLabel,
  normalizePlanFeatures,
} from "./planFeatures";

describe("plan feature catalog", () => {
  it("[CAT-1] exposes exactly the seven requested features, in order", () => {
    expect(PLAN_FEATURES.map((f) => f.label)).toEqual([
      "Dime AI Model Projections",
      "Daily Lineups",
      "Betting Splits",
      "Historical Odds + Line Movement",
      "Player Prop Projections",
      "Personalized Bet Tracker",
      "Early Access to Features",
    ]);
  });

  it("[CAT-2] keys are unique and stable — these are persisted values", () => {
    expect(new Set(PLAN_FEATURE_KEYS).size).toBe(PLAN_FEATURE_KEYS.length);
    // Pinned deliberately: changing a key requires a data migration.
    expect(PLAN_FEATURE_KEYS).toEqual([
      "ai_model_projections",
      "daily_lineups",
      "betting_splits",
      "historical_odds_line_movement",
      "player_prop_projections",
      "personalized_bet_tracker",
      "early_access_features",
    ]);
  });

  it("[CAT-3] every feature carries a label and helper description", () => {
    for (const f of PLAN_FEATURES) {
      expect(f.label.length, f.key).toBeGreaterThan(0);
      expect(f.description.length, f.key).toBeGreaterThan(0);
    }
  });
});

describe("isPlanFeatureKey", () => {
  it("[KEY-1] accepts catalog keys and rejects everything else", () => {
    expect(isPlanFeatureKey("daily_lineups")).toBe(true);
    expect(isPlanFeatureKey("Daily Lineups")).toBe(false);
    expect(isPlanFeatureKey("not_a_feature")).toBe(false);
    expect(isPlanFeatureKey(undefined)).toBe(false);
    expect(isPlanFeatureKey(42)).toBe(false);
  });
});

describe("planFeatureLabel", () => {
  it("[LBL-1] maps keys to labels", () => {
    expect(planFeatureLabel("betting_splits")).toBe("Betting Splits");
  });

  it("[LBL-2] falls back to the raw key so an unknown value is visible, not blank", () => {
    expect(planFeatureLabel("retired_key")).toBe("retired_key");
  });
});

describe("normalizePlanFeatures", () => {
  it("[NRM-1] returns canonical order regardless of input order", () => {
    expect(normalizePlanFeatures(["early_access_features", "daily_lineups", "ai_model_projections"]))
      .toEqual(["ai_model_projections", "daily_lineups", "early_access_features"]);
  });

  it("[NRM-2] de-duplicates", () => {
    expect(normalizePlanFeatures(["betting_splits", "betting_splits"])).toEqual(["betting_splits"]);
  });

  it("[NRM-3] drops unknown keys rather than persisting them", () => {
    expect(normalizePlanFeatures(["betting_splits", "bogus", ""])).toEqual(["betting_splits"]);
  });

  it("[NRM-4] handles null/undefined/empty as no features", () => {
    expect(normalizePlanFeatures(null)).toEqual([]);
    expect(normalizePlanFeatures(undefined)).toEqual([]);
    expect(normalizePlanFeatures([])).toEqual([]);
  });

  it("[NRM-5] is idempotent", () => {
    const once = normalizePlanFeatures(["player_prop_projections", "daily_lineups"]);
    expect(normalizePlanFeatures(once)).toEqual(once);
  });
});
