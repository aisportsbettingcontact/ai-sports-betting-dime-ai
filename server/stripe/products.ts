/**
 * server/stripe/products.ts
 *
 * Single source of truth for all Stripe product and price definitions.
 *
 * IMPORTANT: Price IDs must be created in the Stripe Dashboard first.
 * Set them via environment variables so they can differ between test and live mode:
 *
 *   STRIPE_PRICE_MONTHLY   — price_xxx for the $99.99/month recurring plan
 *   STRIPE_PRICE_ANNUAL    — price_xxx for the $499.99/year recurring plan
 *   STRIPE_PRICE_TEST      — price_1Tb3LgPa3TFEAkkYF9s5T8no ($1/month, internal E2E test only)
 *
 * If the env vars are not set, the checkout procedure will throw a descriptive
 * error rather than silently using a wrong or missing price.
 */

const TAG = "[Stripe][Products]";

// ─── Plan IDs (used as keys throughout the codebase) ─────────────────────────

export type PlanId = "monthly" | "annual" | "test";

// ─── Plan metadata (mirrors landing page PricingCTA) ─────────────────────────

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Amount in USD cents */
  amountCents: number;
  /** Human-readable price string */
  priceDisplay: string;
  interval: "month" | "year";
  /** Stripe Price ID — loaded from env at runtime (or hardcoded for test plan) */
  priceId: () => string;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  monthly: {
    id: "monthly",
    name: "AI Sports Betting — Monthly",
    amountCents: 9999,
    priceDisplay: "$99.99/month",
    interval: "month",
    priceId: () => {
      // Primary: env var (allows override). Fallback: hardcoded live price ID.
      const id = process.env.STRIPE_PRICE_MONTHLY ?? "price_1TaVc2Pa3TFEAkkYucDoFPcW";
      console.log(`${TAG} [STATE] monthly priceId=${id}`);
      return id;
    },
  },
  annual: {
    id: "annual",
    name: "AI Sports Betting — Annual",
    amountCents: 49999,
    priceDisplay: "$499.99/year",
    interval: "year",
    priceId: () => {
      // Primary: env var (allows override). Fallback: hardcoded live price ID.
      const id = process.env.STRIPE_PRICE_ANNUAL ?? "price_1TaVdfPa3TFEAkkY0tW4eKSV";
      console.log(`${TAG} [STATE] annual priceId=${id}`);
      return id;
    },
  },
  // ─── INTERNAL E2E TEST PLAN ─────────────────────────────────────────────────
  // $1/month recurring — used ONLY to verify the full purchase → account setup
  // → Discord role pipeline in live mode without spending $99.
  // Product: prod_UaDn0BxbjZn3ci  |  Price: price_1Tb3LgPa3TFEAkkYF9s5T8no
  // REMOVE THIS PLAN AFTER TESTING IS COMPLETE.
  test: {
    id: "test",
    name: "AI Sports Betting — $1 E2E Test",
    amountCents: 100,
    priceDisplay: "$1.00/month",
    interval: "month",
    priceId: () => {
      // Hardcoded live price ID — this plan is internal only, no env var needed.
      const id = "price_1Tb3LgPa3TFEAkkYF9s5T8no";
      console.log(`${TAG} [STATE] test priceId=${id} [INTERNAL E2E TEST ONLY]`);
      return id;
    },
  },
};

/**
 * Resolve a PlanId from a Stripe Price ID.
 * Used in the webhook handler to map completed checkout sessions back to a plan.
 * Returns null if the price ID doesn't match any known plan.
 */
export function getPlanByPriceId(priceId: string): PlanDefinition | null {
  const monthlyId = process.env.STRIPE_PRICE_MONTHLY;
  const annualId = process.env.STRIPE_PRICE_ANNUAL;
  const testId = "price_1Tb3LgPa3TFEAkkYF9s5T8no";

  if (monthlyId && priceId === monthlyId) return PLANS.monthly;
  if (annualId && priceId === annualId) return PLANS.annual;
  if (priceId === testId) return PLANS.test;

  console.warn(`${TAG} [VERIFY] Unknown priceId=${priceId} — not matched to any plan`);
  return null;
}

/**
 * Compute the subscription expiry timestamp (UTC ms) for a given plan.
 * Monthly / Test: now + 31 days (buffer for billing cycle variance)
 * Annual:         now + 366 days (buffer for leap year)
 */
export function computeExpiryMs(planId: PlanId): number {
  const now = Date.now();
  const bufferDays = planId === "annual" ? 366 : 31;
  const expiryMs = now + bufferDays * 24 * 60 * 60 * 1000;
  console.log(
    `${TAG} [STATE] computeExpiryMs planId=${planId} bufferDays=${bufferDays} expiryMs=${expiryMs} (${new Date(expiryMs).toISOString()})`
  );
  return expiryMs;
}
