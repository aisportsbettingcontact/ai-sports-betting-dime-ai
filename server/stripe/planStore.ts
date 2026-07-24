/**
 * server/stripe/planStore.ts
 *
 * DB-backed read layer for the subscription plan catalog (subscription_plans +
 * plan_prices) — the go-forward replacement for the static PLANS record in
 * server/stripe/products.ts. Checkout and the webhook resolve plans/prices
 * through here instead of code/env.
 *
 * `computeExpiryMsForPrice` is pure. It uses EXACT interval windows (owner-
 * specified 2026-07-24: 1d=24h, 1w=7d, 1mo=30d, 1yr=365d); a no-interval price
 * ("Lifetime" / one-time) grants far-future lifetime access. Reads are cached
 * in-process (60s TTL) and invalidated by the provisioning service on any write.
 */
import { getDb } from "../db";
import { withCircuitBreaker } from "../dbCircuitBreaker";
import {
  subscriptionPlans,
  planPrices,
  type SubscriptionPlan,
  type PlanPrice,
} from "../../drizzle/schema";

const TAG = "[Stripe][PlanStore]";

export type PlanType = "recurring" | "one_time" | "fixed_date";
export type BillingInterval = "day" | "week" | "month" | "year";

export type PromoType = "percent" | "amount";

export interface StoredPrice {
  id: number;
  stripePriceId: string;
  label: string | null;
  amountCents: number;
  currency: string;
  interval: BillingInterval | null;
  intervalCount: number | null;
  trialPeriodDays: number | null;
  /** Per-interval promo. null = none. percent → 1–100; amount → cents off. */
  promoType: PromoType | null;
  promoValue: number | null;
  promoCode: string | null;
  /** Stripe coupon applied at checkout for this price (null when no promo). */
  stripeCouponId: string | null;
  active: boolean;
  isDefault: boolean;
  /** Owner-hidden: retained but not offered at checkout / shown publicly. */
  hidden: boolean;
  /** Display order among the plan's intervals (drag-to-reorder). */
  sortOrder: number;
  livemode: boolean;
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
  /** Auto-restock FOMO loop — see schema. availableQuantity null = unlimited. */
  autoRestock: boolean;
  availableQuantity: number | null;
  restockThreshold: number | null;
  restockAmount: number | null;
  discordRoleId: string | null;
  telegramChatId: string | null;
  livemode: boolean;
  prices: StoredPrice[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A one-time / lifetime purchase grants access until 2100 — effectively forever. */
export const LIFETIME_ACCESS_UNTIL_MS = 4102444800000; // 2100-01-01T00:00:00Z

/**
 * Exact interval length in ms (owner-specified 2026-07-24): 1 day = 24h,
 * 1 week = 7 days, 1 month = 30 days, 1 year = 365 days. No calendar/leap
 * buffers — a plan's access window is precisely intervalCount × this.
 */
function intervalMs(interval: BillingInterval): number {
  switch (interval) {
    case "day":
      return DAY_MS; // 24 hours
    case "week":
      return 7 * DAY_MS; // 7 days
    case "month":
      return 30 * DAY_MS; // 30 days
    case "year":
      return 365 * DAY_MS; // 365 days
  }
}

/**
 * Access-expiry timestamp (UTC ms) a price grants on its plan, measured from
 * `fromMs`.
 *   - recurring price (has an interval)  → fromMs + interval×count (exact days).
 *   - one-time / "Lifetime" price (no interval) → far-future (lifetime); a
 *     fixed_date plan overrides with its accessUntil.
 *   - fixed_date plan → plan.accessUntil.
 */
export function computeExpiryMsForPrice(
  price: Pick<StoredPrice, "interval" | "intervalCount">,
  plan: Pick<StoredPlan, "planType" | "accessUntil">,
  fromMs: number,
): number | null {
  if (plan.planType === "fixed_date") {
    return plan.accessUntil ?? null;
  }
  // No recurring interval → a single payment grants lifetime access.
  if (!price.interval) {
    return plan.accessUntil ?? LIFETIME_ACCESS_UNTIL_MS;
  }
  const count = price.intervalCount && price.intervalCount > 0 ? price.intervalCount : 1;
  return fromMs + intervalMs(price.interval) * count;
}

// ─── Cached DB reads ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
let _cache: { at: number; plans: StoredPlan[] } | null = null;

/** Drop the in-process plan cache — called by the provisioning service on writes. */
export function invalidatePlanCache(): void {
  _cache = null;
}

function mapPrice(pr: PlanPrice): StoredPrice {
  return {
    id: pr.id,
    stripePriceId: pr.stripePriceId,
    label: pr.label,
    amountCents: pr.amountCents,
    currency: pr.currency,
    interval: pr.interval,
    intervalCount: pr.intervalCount,
    trialPeriodDays: pr.trialPeriodDays,
    promoType: pr.promoType,
    promoValue: pr.promoValue,
    promoCode: pr.promoCode,
    stripeCouponId: pr.stripeCouponId,
    active: pr.active,
    isDefault: pr.isDefault,
    hidden: pr.hidden,
    sortOrder: pr.sortOrder,
    livemode: pr.livemode,
  };
}

/** Loads all plans + their prices from the DB. Fail-closed: [] on DB error. */
async function loadAllPlans(): Promise<StoredPlan[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await withCircuitBreaker(async () => {
      const planRows = (await db.select().from(subscriptionPlans)) as SubscriptionPlan[];
      const priceRows = (await db.select().from(planPrices)) as PlanPrice[];
      const byPlan = new Map<number, StoredPrice[]>();
      for (const pr of priceRows) {
        const arr = byPlan.get(pr.planId) ?? [];
        arr.push(mapPrice(pr));
        byPlan.set(pr.planId, arr);
      }
      return planRows.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        planType: p.planType,
        stripeProductId: p.stripeProductId,
        active: p.active,
        accessUntil: p.accessUntil ?? null,
        maxSubscribers: p.maxSubscribers ?? null,
        autoRestock: p.autoRestock,
        availableQuantity: p.availableQuantity ?? null,
        restockThreshold: p.restockThreshold ?? null,
        restockAmount: p.restockAmount ?? null,
        discordRoleId: p.discordRoleId ?? null,
        telegramChatId: p.telegramChatId ?? null,
        livemode: p.livemode,
        prices: (byPlan.get(p.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
      }));
    });
  } catch (err) {
    console.warn(`${TAG} loadAllPlans failed: ${(err as Error).message}`);
    return [];
  }
}

async function getCachedPlans(): Promise<StoredPlan[]> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.plans;
  const plans = await loadAllPlans();
  _cache = { at: now, plans };
  return plans;
}

/** Active, non-archived plans (for pricing + admin listing), sortOrder-agnostic caller sorts. */
export async function listActivePlans(): Promise<StoredPlan[]> {
  return (await getCachedPlans()).filter((p) => p.active);
}

/** All plans incl. archived — for the owner admin table. */
export async function listAllPlans(): Promise<StoredPlan[]> {
  return getCachedPlans();
}

export async function getPlanBySlug(slug: string): Promise<StoredPlan | null> {
  return (await getCachedPlans()).find((p) => p.slug === slug) ?? null;
}

/** Reverse map a Stripe price ID → its plan + price (used by checkout + webhook). */
export async function getPriceById(
  stripePriceId: string,
): Promise<{ plan: StoredPlan; price: StoredPrice } | null> {
  for (const plan of await getCachedPlans()) {
    const price = plan.prices.find((pr) => pr.stripePriceId === stripePriceId);
    if (price) return { plan, price };
  }
  return null;
}

/** The default (or first active) price for a plan — the one checkout charges. */
export function defaultPriceOf(plan: StoredPlan): StoredPrice | null {
  return (
    plan.prices.find((pr) => pr.active && pr.isDefault) ??
    plan.prices.find((pr) => pr.active) ??
    null
  );
}

/**
 * Default active price MATCHING the given Stripe mode. Live checkout (live key)
 * must never be handed a test/sandbox price — Stripe rejects it — so checkout
 * resolves through here with wantLivemode = (the checkout key is live).
 */
export function defaultPriceForMode(plan: StoredPlan, wantLivemode: boolean): StoredPrice | null {
  // Hidden intervals are retained but never offered at checkout.
  const inMode = plan.prices.filter((pr) => pr.active && !pr.hidden && pr.livemode === wantLivemode);
  return inMode.find((pr) => pr.isDefault) ?? inMode[0] ?? null;
}

type RestockConfig = Pick<
  StoredPlan,
  "availableQuantity" | "autoRestock" | "restockThreshold" | "restockAmount"
>;

/**
 * The availableQuantity a limited-quantity plan should hold AFTER one more
 * subscribe. Decrements by one; when autoRestock is on and the result drops
 * BELOW restockThreshold, it resets to restockAmount instead — the endless
 * FOMO loop. Returns null when the plan is not limited-quantity (no counter).
 * Pure, so the loop is unit-tested without a DB.
 */
export function computeNextQuantity(plan: RestockConfig): number | null {
  if (plan.availableQuantity == null) return null;
  const next = plan.availableQuantity - 1;
  if (
    plan.autoRestock &&
    plan.restockThreshold != null &&
    plan.restockAmount != null &&
    next < plan.restockThreshold
  ) {
    return plan.restockAmount;
  }
  return Math.max(0, next);
}

/** A limited-quantity plan with no spots left — checkout must refuse it. */
export function isSoldOut(plan: Pick<StoredPlan, "availableQuantity">): boolean {
  return plan.availableQuantity != null && plan.availableQuantity <= 0;
}
