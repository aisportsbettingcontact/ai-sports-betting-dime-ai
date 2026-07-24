/**
 * planTypes.ts — CLIENT MIRROR of the subscription-plan catalog shapes.
 *
 * These interfaces intentionally duplicate server/stripe/planStore.ts's
 * `StoredPlan` / `StoredPrice` (verified field-for-field, 2026-07-24). The
 * client must NOT import server code — the tRPC data contract is documented in
 * design-system/dime-ai/pages/ai-model-projections.md's sibling billing spec
 * and re-stated here as the local source of truth for the admin UI.
 *
 * `INTERVAL_OPTIONS` is the curated billing-cadence list the Create Plan form
 * offers (Winible's cadences + Annual). It is pure data with no React
 * dependency so it can be unit-tested in vitest's node environment.
 */

export type BillingInterval = "day" | "week" | "month" | "year";
export type PlanType = "recurring" | "one_time" | "fixed_date";

export interface StoredPrice {
  id: number;
  stripePriceId: string;
  label: string | null;
  amountCents: number;
  currency: string;
  interval: BillingInterval | null;
  intervalCount: number | null;
  trialPeriodDays: number | null;
  active: boolean;
  isDefault: boolean;
}

export interface StoredPlan {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  planType: PlanType;
  stripeProductId: string | null;
  active: boolean;
  accessUntil: number | null;
  maxSubscribers: number | null;
  discordRoleId: string | null;
  telegramChatId: string | null;
  prices: StoredPrice[];
}

/** A single billing-cadence choice: a human label → Stripe interval mapping. */
export interface IntervalOption {
  label: string;
  interval: BillingInterval;
  intervalCount: number;
}

/** The value the IntervalPicker owns and emits — the Stripe cadence pair. */
export interface IntervalValue {
  interval: BillingInterval;
  intervalCount: number;
}

/**
 * Curated billing cadences offered in the Create Plan form. Matches the Winible
 * catalog cadences plus an Annual option. NOTE the deliberate encodings:
 *   - "Weekly" is a native {week, 1}, but "Every 2 weeks" is {day, 14} because
 *     Stripe recurring prices do not accept interval_count > 1 on `week`.
 * Keep this list pure (no imports) so it stays unit-testable in node.
 */
export const INTERVAL_OPTIONS: IntervalOption[] = [
  { label: "Daily", interval: "day", intervalCount: 1 },
  { label: "Every 2 days", interval: "day", intervalCount: 2 },
  { label: "Every 3 days", interval: "day", intervalCount: 3 },
  { label: "Every 5 days", interval: "day", intervalCount: 5 },
  { label: "Weekly", interval: "week", intervalCount: 1 },
  { label: "Every 2 weeks", interval: "day", intervalCount: 14 },
  { label: "Monthly", interval: "month", intervalCount: 1 },
  { label: "Every 2 months", interval: "month", intervalCount: 2 },
  { label: "Quarterly", interval: "month", intervalCount: 3 },
  { label: "Semi-annual", interval: "month", intervalCount: 6 },
  { label: "Annual", interval: "year", intervalCount: 1 },
];

/** The picker's default cadence — Monthly ({month, 1}). */
export const DEFAULT_INTERVAL: IntervalValue = { interval: "month", intervalCount: 1 };
