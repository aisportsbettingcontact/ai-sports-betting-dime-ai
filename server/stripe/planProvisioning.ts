/**
 * server/stripe/planProvisioning.ts
 *
 * Owner-only Stripe WRITE layer for the plan catalog. Creating a plan from the
 * admin dashboard provisions a Stripe Product + recurring Price via the API and
 * persists the returned IDs into subscription_plans / plan_prices.
 *
 * Test/live safety: uses STRIPE_TEST_SECRET_KEY when it is set (sandbox dev) and
 * falls back to the live STRIPE_SECRET_KEY only when it is not. This keeps plan
 * provisioning on the sandbox while checkout stays on the live key — set the test
 * var on a dev/staging service, leave it unset in production. `isProvisioningTestMode()`
 * lets the UI show a loud TEST badge so the owner always knows which account
 * they're writing to.
 *
 * Prices are immutable in Stripe: "editing" an amount/interval is archive + create
 * (Phase 3). Here we create; archivePlan deactivates the Product + row.
 */
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { withCircuitBreaker } from "../dbCircuitBreaker";
import { subscriptionPlans, planPrices } from "../../drizzle/schema";
import { getPlanBySlug, invalidatePlanCache, type BillingInterval } from "./planStore";

const TAG = "[Stripe][Provisioning]";
const API_VERSION = "2026-04-22.dahlia";
/** Stripe USD minimum chargeable amount (cents). */
const MIN_AMOUNT_CENTS = 50;

let _client: Stripe | null = null;
let _clientKeyTail: string | null = null;

/** Resolve the provisioning key — test key wins (sandbox dev), else live. */
function resolveProvisioningKey(): { key: string; testMode: boolean } {
  const testKey = process.env.STRIPE_TEST_SECRET_KEY?.trim();
  if (testKey) return { key: testKey, testMode: true };
  const liveKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!liveKey) throw new Error("Neither STRIPE_TEST_SECRET_KEY nor STRIPE_SECRET_KEY is set");
  const testish = liveKey.startsWith("sk_test_") || liveKey.startsWith("rk_test_");
  return { key: liveKey, testMode: testish };
}

/** True when plan provisioning is writing to a Stripe TEST/sandbox account. */
export function isProvisioningTestMode(): boolean {
  try {
    return resolveProvisioningKey().testMode;
  } catch {
    return false;
  }
}

/** Singleton Stripe client for provisioning; re-inits if the key env changes. */
export function getProvisioningStripe(): Stripe {
  const { key, testMode } = resolveProvisioningKey();
  const tail = key.slice(-6);
  if (_client && _clientKeyTail === tail) return _client;
  console.log(`${TAG} init Stripe client mode=${testMode ? "TEST" : "LIVE"} api=${API_VERSION}`);
  _client = new Stripe(key, {
    // Must match the installed stripe npm package's pinned version.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiVersion: API_VERSION as any,
    typescript: true,
  });
  _clientKeyTail = tail;
  return _client;
}

/** kebab-case, ≤48 chars, non-empty. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "plan";
}

/** A slug not already taken by an existing plan. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (await getPlanBySlug(slug)) {
    slug = `${base}-${n}`;
    n += 1;
    if (n > 200) {
      slug = `${base}-${Date.now()}`;
      break;
    }
  }
  return slug;
}

/** Stripe caps a recurring billing interval at ≤ 1 year. */
function clampCount(interval: BillingInterval, count: number): number {
  const max = interval === "year" ? 1 : interval === "month" ? 12 : interval === "week" ? 52 : 365;
  return Math.min(Math.max(1, Math.floor(count)), max);
}

function validateAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < MIN_AMOUNT_CENTS) {
    throw new Error(`amountCents must be an integer ≥ ${MIN_AMOUNT_CENTS} (got ${amountCents})`);
  }
}

export interface NewPriceInput {
  amountCents: number;
  currency?: string;
  interval: BillingInterval;
  intervalCount: number;
  label?: string;
  trialPeriodDays?: number;
}

export interface NewPlanInput {
  name: string;
  description?: string;
  price: NewPriceInput;
  maxSubscribers?: number | null;
}

/** Create a Stripe Product + recurring Price and persist them. */
export async function provisionPlan(
  input: NewPlanInput,
): Promise<{ planId: number; slug: string; stripeProductId: string; stripePriceId: string }> {
  validateAmount(input.price.amountCents);
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const stripe = getProvisioningStripe();
  const slug = await uniqueSlug(input.name);
  const currency = (input.price.currency ?? "usd").toLowerCase();
  const intervalCount = clampCount(input.price.interval, input.price.intervalCount);

  // 1) Product (idempotent by slug so a retried mutation doesn't double-create).
  const product = await stripe.products.create(
    {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      metadata: { dime_plan_slug: slug },
    },
    { idempotencyKey: `plan-product-${slug}` },
  );

  // 2) Price. NO payment_method_types anywhere (dynamic payment methods).
  const price = await stripe.prices.create(
    {
      product: product.id,
      unit_amount: input.price.amountCents,
      currency,
      recurring: { interval: input.price.interval, interval_count: intervalCount },
      metadata: { dime_plan_slug: slug },
    },
    { idempotencyKey: `plan-price-${slug}-${input.price.amountCents}-${input.price.interval}${intervalCount}` },
  );

  // 3) Persist plan + default price.
  const planRes = await withCircuitBreaker(async () =>
    db.insert(subscriptionPlans).values({
      slug,
      name: input.name,
      description: input.description ?? null,
      planType: "recurring",
      stripeProductId: product.id,
      active: true,
      livemode: product.livemode,
      maxSubscribers: input.maxSubscribers ?? null,
      sortOrder: 0,
    }),
  );
  const planId = Number(planRes?.[0]?.insertId ?? 0);
  if (!planId) throw new Error("failed to persist subscription_plans row");

  await withCircuitBreaker(async () =>
    db.insert(planPrices).values({
      planId,
      stripePriceId: price.id,
      label: input.price.label ?? null,
      amountCents: input.price.amountCents,
      currency,
      interval: input.price.interval,
      intervalCount,
      trialPeriodDays: input.price.trialPeriodDays ?? null,
      active: true,
      isDefault: true,
      livemode: price.livemode,
    }),
  );

  invalidatePlanCache();
  console.log(`${TAG} provisioned plan slug=${slug} product=${product.id} price=${price.id}`);
  return { planId, slug, stripeProductId: product.id, stripePriceId: price.id };
}

/** Archive a plan: deactivate its Stripe Product + mark the row inactive. */
export async function archivePlan(planId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1),
  )) as Array<{ stripeProductId: string | null }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);

  if (row.stripeProductId) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, { active: false });
    } catch (err) {
      console.warn(`${TAG} archive: Stripe product deactivate failed — ${(err as Error).message}`);
    }
  }
  await withCircuitBreaker(async () =>
    db
      .update(subscriptionPlans)
      .set({ active: false, archivedAt: Date.now() })
      .where(eq(subscriptionPlans.id, planId)),
  );
  invalidatePlanCache();
  console.log(`${TAG} archived plan ${planId}`);
}

/** Edit plan metadata (name/description/maxSubscribers). Amount/interval are immutable — a new price is Phase 3. */
export async function updatePlanMeta(
  planId: number,
  patch: { name?: string; description?: string | null; maxSubscribers?: number | null },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1),
  )) as Array<{ stripeProductId: string | null }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);

  if (row.stripeProductId && (patch.name !== undefined || patch.description !== undefined)) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? "" } : {}),
      });
    } catch (err) {
      console.warn(`${TAG} updateMeta: Stripe product update failed — ${(err as Error).message}`);
    }
  }
  await withCircuitBreaker(async () =>
    db
      .update(subscriptionPlans)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.maxSubscribers !== undefined ? { maxSubscribers: patch.maxSubscribers } : {}),
      })
      .where(eq(subscriptionPlans.id, planId)),
  );
  invalidatePlanCache();
  console.log(`${TAG} updated plan meta ${planId}`);
}
