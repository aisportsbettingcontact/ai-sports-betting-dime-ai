/**
 * shared/planFeatures.ts — the single source of truth for subscription-plan
 * feature keys.
 *
 * Shared deliberately: the admin UI renders these as selectable options, the
 * tRPC layer validates against them, and the database stores the KEY (never the
 * label). Storing keys means marketing can reword "Daily Lineups" without a
 * migration, and it keeps `plan_features` queryable — "which plans include prop
 * projections?" is an indexed lookup, not a LIKE over prose.
 *
 * Adding a feature: append to this list. Removing one: retire the key here AND
 * delete its plan_features rows in a migration — a key that vanishes from this
 * file but survives in the table would render as an unknown chip.
 */

export interface PlanFeatureDefinition {
  readonly key: string;
  readonly label: string;
  /** Short helper text shown under the label in the picker. */
  readonly description: string;
}

export const PLAN_FEATURES = [
  {
    key: "ai_model_projections",
    label: "Dime AI Model Projections",
    description: "Full projections board — every game the model prices.",
  },
  {
    key: "daily_lineups",
    label: "Daily Lineups",
    description: "Confirmed and projected lineups as they post.",
  },
  {
    key: "betting_splits",
    label: "Betting Splits",
    description: "Handle and ticket splits across tracked books.",
  },
  {
    key: "historical_odds_line_movement",
    label: "Historical Odds + Line Movement",
    description: "Open-to-close line history and movement charts.",
  },
  {
    key: "player_prop_projections",
    label: "Player Prop Projections",
    description: "Model projections for player prop markets.",
  },
  {
    key: "personalized_bet_tracker",
    label: "Personalized Bet Tracker",
    description: "Track your own bets with model-graded outcomes.",
  },
  {
    key: "early_access_features",
    label: "Early Access to Features",
    description: "New markets and model releases before general availability.",
  },
] as const satisfies readonly PlanFeatureDefinition[];

export type PlanFeatureKey = (typeof PLAN_FEATURES)[number]["key"];

/** Canonical ordering — also the default sortOrder when a plan is saved. */
export const PLAN_FEATURE_KEYS: readonly PlanFeatureKey[] = PLAN_FEATURES.map((f) => f.key);

const FEATURE_BY_KEY = new Map<string, PlanFeatureDefinition>(PLAN_FEATURES.map((f) => [f.key, f]));

export function isPlanFeatureKey(value: unknown): value is PlanFeatureKey {
  return typeof value === "string" && FEATURE_BY_KEY.has(value);
}

/** Human label for a key; falls back to the raw key so an unknown value is visible rather than blank. */
export function planFeatureLabel(key: string): string {
  return FEATURE_BY_KEY.get(key)?.label ?? key;
}

export function planFeatureDefinition(key: string): PlanFeatureDefinition | undefined {
  return FEATURE_BY_KEY.get(key);
}

/**
 * Normalise an arbitrary list into valid, de-duplicated keys in canonical order.
 * Unknown keys are dropped rather than persisted — the picker can only emit
 * known keys, so anything else is a malformed request.
 */
export function normalizePlanFeatures(input: readonly string[] | null | undefined): PlanFeatureKey[] {
  if (!input) return [];
  const seen = new Set<PlanFeatureKey>();
  for (const raw of input) if (isPlanFeatureKey(raw)) seen.add(raw);
  return PLAN_FEATURE_KEYS.filter((k) => seen.has(k));
}
