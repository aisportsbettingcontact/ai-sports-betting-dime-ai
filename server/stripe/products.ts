/**
 * server/stripe/products.ts
 *
 * Single source of truth for all Stripe product and price definitions.
 *
 * IMPORTANT: Price IDs must be created in the Stripe Dashboard first.
 * Set them via environment variables so they can differ between test and live mode:
 *
 *   STRIPE_PRICE_MONTHLY          — price_xxx for the legacy $99.99/month plan
 *   STRIPE_PRICE_ANNUAL           — price_xxx for the legacy $499.99/year plan
 *   STRIPE_PRICE_PRO_MONTHLY      — price_xxx for the Pro $99/month plan
 *   STRIPE_PRICE_SHARP_MONTHLY    — price_xxx for the Sharp $249/month plan
 *   STRIPE_PRICE_OPERATOR_MONTHLY — price_xxx for the Operator $499/month plan
 *
 * The three v2 plan price IDs have NO hardcoded fallbacks (SEC-006): if the
 * env var is missing, priceId() throws and the checkout mutation surfaces a
 * clean PRECONDITION_FAILED "plan not yet available" — never a wrong price.
 */

const TAG = "[Stripe][Products]";

// ─── Plan IDs (used as keys throughout the codebase) ─────────────────────────

export type PlanId = "monthly" | "annual" | "pro" | "sharp" | "operator";

/** v2 ladder plans — env-driven price IDs only, no fallbacks (SEC-006). */
export const NEW_PLAN_IDS: ReadonlySet<PlanId> = new Set<PlanId>([
  "pro",
  "sharp",
  "operator",
]);

/** Resolve a v2 price ID from env — throws (no fallback) when unset. */
function requirePriceEnv(envVar: string): string {
  const id = process.env[envVar]?.trim();
  if (!id) {
    console.error(
      `${TAG} [VERIFY] FAIL — ${envVar} is not set (no fallback by design)`
    );
    throw new Error(`${envVar} is not set`);
  }
  console.log(`${TAG} [STATE] ${envVar} priceId=${id}`);
  return id;
}

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
      const id =
        process.env.STRIPE_PRICE_MONTHLY ?? "price_1TaVc2Pa3TFEAkkYucDoFPcW";
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
      const id =
        process.env.STRIPE_PRICE_ANNUAL ?? "price_1TaVdfPa3TFEAkkY0tW4eKSV";
      console.log(`${TAG} [STATE] annual priceId=${id}`);
      return id;
    },
  },
  pro: {
    id: "pro",
    name: "Dime AI — Pro",
    amountCents: 9900,
    priceDisplay: "$99/month",
    interval: "month",
    priceId: () => requirePriceEnv("STRIPE_PRICE_PRO_MONTHLY"),
  },
  sharp: {
    id: "sharp",
    name: "Dime AI — Sharp",
    amountCents: 24900,
    priceDisplay: "$249/month",
    interval: "month",
    priceId: () => requirePriceEnv("STRIPE_PRICE_SHARP_MONTHLY"),
  },
  operator: {
    id: "operator",
    name: "Dime AI — Operator",
    amountCents: 49900,
    priceDisplay: "$499/month",
    interval: "month",
    priceId: () => requirePriceEnv("STRIPE_PRICE_OPERATOR_MONTHLY"),
  },
};

/**
 * Normalize a raw plan string (webhook metadata, DB column) to a known PlanId.
 * Unknown/missing values fall back to "monthly" — the legacy default.
 */
export function normalizePlanId(raw: string | null | undefined): PlanId {
  if (raw && Object.prototype.hasOwnProperty.call(PLANS, raw))
    return raw as PlanId;
  return "monthly";
}

/**
 * Resolve a PlanId from a Stripe Price ID.
 * Used in the webhook handler to map completed checkout sessions back to a plan.
 * Returns null if the price ID doesn't match any known plan.
 */
export function getPlanByPriceId(priceId: string): PlanDefinition | null {
  const monthlyId = process.env.STRIPE_PRICE_MONTHLY;
  const annualId = process.env.STRIPE_PRICE_ANNUAL;
  const proId = process.env.STRIPE_PRICE_PRO_MONTHLY?.trim();
  const sharpId = process.env.STRIPE_PRICE_SHARP_MONTHLY?.trim();
  const operatorId = process.env.STRIPE_PRICE_OPERATOR_MONTHLY?.trim();

  if (monthlyId && priceId === monthlyId) return PLANS.monthly;
  if (annualId && priceId === annualId) return PLANS.annual;
  if (proId && priceId === proId) return PLANS.pro;
  if (sharpId && priceId === sharpId) return PLANS.sharp;
  if (operatorId && priceId === operatorId) return PLANS.operator;

  console.warn(
    `${TAG} [VERIFY] Unknown priceId=${priceId} — not matched to any plan`
  );
  return null;
}

/**
 * Compute the subscription expiry timestamp (UTC ms) for a given plan.
 *
 * EXACT windows (owner directive 2026-08-01: "No grace periods allowed.
 * Period."): monthly = 30 days, annual = 365 days — matching the DB plans'
 * exact interval spec (planStore: 1d=24h, 1w=7d, 1mo=30d, 1yr=365d). The old
 * 31/366-day "billing cycle variance" padding was a grace period by another
 * name and is repealed; a renewal re-anchors the window to Stripe's billed
 * period end, so nothing needs slack.
 */
export function computeExpiryMs(planId: PlanId): number {
  const now = Date.now();
  const windowDays = planId === "annual" ? 365 : 30;
  const expiryMs = now + windowDays * 24 * 60 * 60 * 1000;
  console.log(
    `${TAG} [STATE] computeExpiryMs planId=${planId} windowDays=${windowDays} expiryMs=${expiryMs} (${new Date(expiryMs).toISOString()})`
  );
  return expiryMs;
}
