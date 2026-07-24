/**
 * server/stripe/planStore.ts
 *
 * DB-backed read layer for the subscription plan catalog (subscription_plans +
 * plan_prices) — the go-forward replacement for the static PLANS record in
 * server/stripe/products.ts. Checkout and the webhook resolve plans/prices
 * through here instead of code/env.
 *
 * `computeExpiryMsForPrice` is pure and preserves the legacy expiry windows
 * (month ≈ 31d, year ≈ 366d buffers from products.ts) so entitlement behaviour
 * is unchanged after the migration. Reads are cached in-process (60s TTL) and
 * invalidated by the provisioning service on any write.
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
  discordRoleId: string | null;
  telegramChatId: string | null;
  livemode: boolean;
  prices: StoredPrice[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Approx interval length in ms — preserves the legacy month≈31d / year≈366d buffers. */
function intervalMs(interval: BillingInterval): number {
  switch (interval) {
    case "day":
      return DAY_MS;
    case "week":
      return 7 * DAY_MS;
    case "month":
      return 31 * DAY_MS; // legacy buffer (products.ts computeExpiryMs)
    case "year":
      return 366 * DAY_MS; // legacy leap-year buffer
  }
}

/**
 * Access-expiry timestamp (UTC ms) a price grants on its plan, measured from
 * `fromMs`. `null` means no time-box (lifetime) — matching app_users.expiryDate
 * NULL. recurring → fromMs + interval×count; fixed_date/one_time → plan.accessUntil.
 */
export function computeExpiryMsForPrice(
  price: Pick<StoredPrice, "interval" | "intervalCount">,
  plan: Pick<StoredPlan, "planType" | "accessUntil">,
  fromMs: number,
): number | null {
  if (plan.planType === "fixed_date" || plan.planType === "one_time") {
    return plan.accessUntil ?? null;
  }
  if (!price.interval) return null;
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
    active: pr.active,
    isDefault: pr.isDefault,
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
        discordRoleId: p.discordRoleId ?? null,
        telegramChatId: p.telegramChatId ?? null,
        livemode: p.livemode,
        prices: byPlan.get(p.id) ?? [],
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
  const inMode = plan.prices.filter((pr) => pr.active && pr.livemode === wantLivemode);
  return inMode.find((pr) => pr.isDefault) ?? inMode[0] ?? null;
}
