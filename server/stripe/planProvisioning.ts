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
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { withCircuitBreaker } from "../dbCircuitBreaker";
import { subscriptionPlans, planPrices } from "../../drizzle/schema";
import {
  getPlanBySlug,
  invalidatePlanCache,
  computeNextQuantity,
  type BillingInterval,
} from "./planStore";

const TAG = "[Stripe][Provisioning]";
const API_VERSION = "2026-04-22.dahlia";
/** Stripe USD minimum chargeable amount (cents). */
const MIN_AMOUNT_CENTS = 50;
/** one_time memberships grant access until 2100 — effectively lifetime (a single
 *  payment, no renewals). computeExpiryMsForPrice maps one_time → accessUntil. */
const ONE_TIME_ACCESS_UNTIL_MS = 4102444800000; // 2100-01-01T00:00:00Z

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

// ─── DB-write diagnostics ────────────────────────────────────────────────────

interface DbErrorInfo {
  message: string;
  code?: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
  /** True when the DB rejected a column/table the code expects — i.e. the
   *  deployed schema is ahead of the database (db-push not run). */
  schemaMismatch: boolean;
  /** The specific missing column, when the driver names one. */
  missingColumn?: string;
}

/**
 * Pull the articulate, actionable fields out of a mysql2/Drizzle write error.
 * mysql2 surfaces `code`/`errno`/`sqlMessage`; Drizzle sometimes nests the
 * driver error under `.cause`. A missing column (ER_BAD_FIELD_ERROR / errno
 * 1054) or missing table (ER_NO_SUCH_TABLE / 1146) means the schema is out of
 * date — the single most common provisioning failure, and one a raw "Failed
 * query" dump hides. Pure + exported so it is unit-tested without a DB.
 */
export function describeDbError(err: unknown): DbErrorInfo {
  const raw = err as { message?: string; code?: string; errno?: number; sqlState?: string; sqlMessage?: string; cause?: unknown };
  // Prefer the driver-level error (has code/sqlMessage), which Drizzle may nest.
  const driver =
    raw && (raw.code || raw.sqlMessage)
      ? raw
      : ((raw?.cause as typeof raw) ?? raw ?? {});
  const message = driver.message ?? raw?.message ?? String(err);
  const sqlMessage = driver.sqlMessage;
  const code = driver.code;
  const errno = driver.errno;
  const probe = sqlMessage ?? message ?? "";
  const schemaMismatch =
    code === "ER_BAD_FIELD_ERROR" ||
    code === "ER_NO_SUCH_TABLE" ||
    errno === 1054 ||
    errno === 1146 ||
    /Unknown column|doesn't exist|no such table/i.test(probe);
  const missingColumn = /Unknown column '([^']+)'/i.exec(probe)?.[1];
  return { message, code, errno, sqlState: driver.sqlState, sqlMessage, schemaMismatch, missingColumn };
}

/**
 * Run a single DB write with pinpointed logging. On failure it emits ONE
 * articulate line naming the step, table, driver code, and sqlMessage — and,
 * for a schema mismatch, a second line with the exact remedy — then throws a
 * clean, user-facing message (not the raw SQL) so the admin sees WHY, not a
 * query dump.
 */
async function persist<T>(step: string, table: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const d = describeDbError(err);
    if (d.schemaMismatch) {
      console.error(
        `${TAG} [DB-FAIL] step=${step} table=${table} SCHEMA-MISMATCH` +
          `${d.missingColumn ? ` missingColumn="${d.missingColumn}"` : ""}` +
          ` code=${d.code ?? "?"} errno=${d.errno ?? "?"} sqlMessage="${d.sqlMessage ?? d.message}"`,
      );
      console.error(
        `${TAG} [DB-FAIL] → the deployed schema is AHEAD of the database. Run the "DB Push (apply schema migrations)" workflow, then retry.`,
      );
      throw new Error(
        `Database schema is out of date${d.missingColumn ? ` — column "${d.missingColumn}" is missing from ${table}` : ` — ${table} is missing a required column`}. ` +
          `Run the db-push workflow, then try again.`,
      );
    }
    console.error(
      `${TAG} [DB-FAIL] step=${step} table=${table} code=${d.code ?? "?"} errno=${d.errno ?? "?"} sqlState=${d.sqlState ?? "?"} sqlMessage="${d.sqlMessage ?? d.message}"`,
    );
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export interface PromoInput {
  /** percent → value is 1–100; amount → value is a discount in cents. */
  type: "percent" | "amount";
  value: number;
  /** Optional shareable code registered as a Stripe promotion code. */
  code?: string;
}

/** A promo must be a sane percent (1–100) or a cents amount below the price. */
function validatePromo(promo: PromoInput, amountCents: number): void {
  if (!Number.isInteger(promo.value) || promo.value < 1) {
    throw new Error(`promo value must be a positive integer (got ${promo.value})`);
  }
  if (promo.type === "percent" && promo.value > 100) {
    throw new Error(`percent promo must be 1–100 (got ${promo.value})`);
  }
  if (promo.type === "amount" && promo.value >= amountCents) {
    throw new Error(`amount promo (${promo.value}c) must be less than the price (${amountCents}c)`);
  }
  if (promo.code && !/^[A-Za-z0-9_-]{2,64}$/.test(promo.code)) {
    throw new Error(`promo code must be 2–64 chars of letters, numbers, - or _`);
  }
}

/**
 * Provision a Stripe coupon (duration=forever) for a per-interval promo and,
 * when a code is given, a shareable promotion code on it. Returns the ids to
 * persist on the plan_prices row; the coupon is applied at checkout.
 */
async function provisionPromo(
  stripe: Stripe,
  promo: PromoInput,
  currency: string,
  idemBase: string,
): Promise<{ couponId: string; promoCodeId: string | null }> {
  const couponParams: Stripe.CouponCreateParams =
    promo.type === "percent"
      ? { percent_off: promo.value, duration: "forever", name: `${promo.value}% off` }
      : { amount_off: promo.value, currency, duration: "forever", name: `$${(promo.value / 100).toFixed(2)} off` };
  const coupon = await stripe.coupons.create(couponParams, { idempotencyKey: `coupon-${idemBase}` });
  let promoCodeId: string | null = null;
  if (promo.code) {
    const pc = await stripe.promotionCodes.create(
      { promotion: { type: "coupon", coupon: coupon.id }, code: promo.code },
      { idempotencyKey: `promocode-${idemBase}` },
    );
    promoCodeId = pc.id;
  }
  return { couponId: coupon.id, promoCodeId };
}

export type PlanType = "recurring" | "one_time";

export interface NewPriceInput {
  amountCents: number;
  currency?: string;
  /** Required for recurring plans; omitted for one_time (single-payment) plans. */
  interval?: BillingInterval;
  intervalCount?: number;
  label?: string;
  trialPeriodDays?: number;
  promo?: PromoInput | null;
  hidden?: boolean;
}

export interface RestockInput {
  autoRestock: boolean;
  availableQuantity: number | null;
  restockThreshold: number | null;
  restockAmount: number | null;
}

export interface NewPlanInput {
  name: string;
  description?: string;
  /** "recurring" (default) → subscription prices; "one_time" → single payment. */
  planType?: PlanType;
  /** One or more intervals (variants). The first visible one is the default. */
  prices: NewPriceInput[];
  maxSubscribers?: number | null;
  restock?: RestockInput | null;
}

/**
 * Create ONE Stripe Price (+ its optional promo coupon) under a product and
 * persist the plan_prices row. Shared by provisionPlan and addPriceToPlan.
 */
async function createAndPersistPrice(
  stripe: Stripe,
  planId: number,
  productId: string,
  slug: string,
  input: NewPriceInput,
  opts: { isDefault: boolean; sortOrder: number; planType: PlanType },
): Promise<{ priceId: string; rowId: number }> {
  validateAmount(input.amountCents);
  const currency = (input.currency ?? "usd").toLowerCase();
  const recurring = opts.planType !== "one_time";
  const interval: BillingInterval | null = recurring ? input.interval ?? "month" : null;
  const intervalCount: number | null = recurring ? clampCount(interval as BillingInterval, input.intervalCount ?? 1) : null;
  // sortOrder keeps idempotency keys distinct even for same-amount one-time prices.
  const idemTag = `${slug}-${input.amountCents}-${recurring ? `${interval}${intervalCount}` : "once"}-${opts.sortOrder}`;

  const price = await stripe.prices.create(
    {
      product: productId,
      unit_amount: input.amountCents,
      currency,
      ...(recurring ? { recurring: { interval: interval as BillingInterval, interval_count: intervalCount as number } } : {}),
      metadata: { dime_plan_slug: slug },
    },
    { idempotencyKey: `plan-price-${idemTag}` },
  );

  let couponId: string | null = null;
  let promoCodeId: string | null = null;
  if (input.promo) {
    validatePromo(input.promo, input.amountCents);
    const provisioned = await provisionPromo(stripe, input.promo, currency, idemTag);
    couponId = provisioned.couponId;
    promoCodeId = provisioned.promoCodeId;
  }

  const res = await withCircuitBreaker(async () =>
    db_insert_price(planId, price, input, currency, interval, intervalCount, opts, {
      promoType: input.promo?.type ?? null,
      promoValue: input.promo?.value ?? null,
      promoCode: input.promo?.code ?? null,
      stripeCouponId: couponId,
      stripePromoCodeId: promoCodeId,
    }),
  );
  return { priceId: price.id, rowId: Number(res?.[0]?.insertId ?? 0) };
}

/** Small insert wrapper so createAndPersistPrice reads top-to-bottom. */
async function db_insert_price(
  planId: number,
  price: Stripe.Price,
  input: NewPriceInput,
  currency: string,
  interval: BillingInterval | null,
  intervalCount: number | null,
  opts: { isDefault: boolean; sortOrder: number },
  promo: {
    promoType: "percent" | "amount" | null;
    promoValue: number | null;
    promoCode: string | null;
    stripeCouponId: string | null;
    stripePromoCodeId: string | null;
  },
): Promise<Array<{ insertId: number }>> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  return persist("insert-price", "plan_prices", () =>
    db.insert(planPrices).values({
      planId,
      stripePriceId: price.id,
      label: input.label ?? null,
      amountCents: input.amountCents,
      currency,
      interval,
      intervalCount,
      trialPeriodDays: input.trialPeriodDays ?? null,
      promoType: promo.promoType,
      promoValue: promo.promoValue,
      promoCode: promo.promoCode,
      stripeCouponId: promo.stripeCouponId,
      stripePromoCodeId: promo.stripePromoCodeId,
      active: true,
      isDefault: opts.isDefault,
      hidden: input.hidden ?? false,
      sortOrder: opts.sortOrder,
      livemode: price.livemode,
    }),
  );
}

/**
 * Create a Stripe Product with ONE OR MORE recurring Prices (billing variants),
 * each with its own optional free trial and promo coupon, and persist the plan
 * + its price rows. The first price is the default. `restock` seeds the
 * auto-restock FOMO counter (see schema).
 */
export async function provisionPlan(
  input: NewPlanInput,
): Promise<{ planId: number; slug: string; stripeProductId: string; stripePriceId: string }> {
  if (!input.prices || input.prices.length === 0) {
    throw new Error("a plan needs at least one interval");
  }
  // Validate every interval (amount + promo) up front so a bad input fails
  // before ANY Stripe object is created — no orphaned product/coupons.
  input.prices.forEach((p) => {
    validateAmount(p.amountCents);
    if (p.promo) validatePromo(p.promo, p.amountCents);
  });
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const stripe = getProvisioningStripe();
  const slug = await uniqueSlug(input.name);
  const restock = input.restock ?? null;

  // 1) Product (idempotent by slug so a retried mutation doesn't double-create).
  const product = await stripe.products.create(
    {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      metadata: { dime_plan_slug: slug },
    },
    { idempotencyKey: `plan-product-${slug}` },
  );

  // 2) Plan row first (incl. auto-restock config) so price rows can reference it.
  console.log(`${TAG} [STEP] Stripe product ready id=${product.id} livemode=${product.livemode} — inserting subscription_plans row slug=${slug}`);
  const planRes = await persist("insert-plan", "subscription_plans", () =>
    withCircuitBreaker(async () =>
      db.insert(subscriptionPlans).values({
        slug,
        name: input.name,
        description: input.description ?? null,
        planType: input.planType ?? "recurring",
        stripeProductId: product.id,
        active: true,
        accessUntil: (input.planType ?? "recurring") === "one_time" ? ONE_TIME_ACCESS_UNTIL_MS : null,
        livemode: product.livemode,
        maxSubscribers: input.maxSubscribers ?? null,
        autoRestock: restock?.autoRestock ?? false,
        availableQuantity: restock?.availableQuantity ?? null,
        restockThreshold: restock?.restockThreshold ?? null,
        restockAmount: restock?.restockAmount ?? null,
        sortOrder: 0,
      }),
    ),
  );
  const planId = Number(planRes?.[0]?.insertId ?? 0);
  if (!planId) throw new Error("failed to persist subscription_plans row");
  console.log(`${TAG} [STEP] subscription_plans row inserted id=${planId} — provisioning ${input.prices.length} price(s)`);

  // 3) Each interval → a Stripe Price (+ optional promo coupon) + a row. The
  //    first interval is the default price checkout charges by default.
  const planType = input.planType ?? "recurring";
  let defaultPriceId = "";
  for (let i = 0; i < input.prices.length; i++) {
    const created = await createAndPersistPrice(stripe, planId, product.id, slug, input.prices[i], {
      isDefault: i === 0,
      sortOrder: i,
      planType,
    });
    if (i === 0) defaultPriceId = created.priceId;
  }

  invalidatePlanCache();
  console.log(`${TAG} provisioned plan slug=${slug} type=${planType} product=${product.id} intervals=${input.prices.length} default=${defaultPriceId}`);
  return { planId, slug, stripeProductId: product.id, stripePriceId: defaultPriceId };
}

/** Add one more interval (billing variant) to an existing plan. */
export async function addPriceToPlan(
  planId: number,
  input: NewPriceInput,
): Promise<{ priceId: string; rowId: number }> {
  validateAmount(input.amountCents);
  if (input.promo) validatePromo(input.promo, input.amountCents);
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1),
  )) as Array<{ slug: string; stripeProductId: string | null; planType: PlanType }>;
  const plan = rows[0];
  if (!plan) throw new Error(`plan ${planId} not found`);
  if (!plan.stripeProductId) throw new Error(`plan ${planId} has no Stripe product`);

  const existing = (await withCircuitBreaker(async () =>
    db.select().from(planPrices).where(eq(planPrices.planId, planId)).limit(1000),
  )) as Array<{ sortOrder: number }>;
  const nextSort = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;

  const stripe = getProvisioningStripe();
  const created = await createAndPersistPrice(stripe, planId, plan.stripeProductId, plan.slug, input, {
    isDefault: false,
    sortOrder: nextSort,
    planType: plan.planType,
  });
  invalidatePlanCache();
  console.log(`${TAG} added interval to plan ${planId}: price=${created.priceId}`);
  return created;
}

/**
 * Remove (deactivate) one interval from a plan: archive its Stripe Price and
 * mark the row inactive. If it was the default and other active prices remain,
 * one of those is promoted to default so the plan always has a chargeable price.
 * Refuses to remove the last active price (archive the whole plan instead).
 */
export async function removePriceFromPlan(priceId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const targetRows = (await withCircuitBreaker(async () =>
    db.select().from(planPrices).where(eq(planPrices.id, priceId)).limit(1),
  )) as Array<{ id: number; planId: number; stripePriceId: string; isDefault: boolean }>;
  const target = targetRows[0];
  if (!target) throw new Error(`price ${priceId} not found`);
  const siblingRows = (await withCircuitBreaker(async () =>
    db.select().from(planPrices).where(eq(planPrices.planId, target.planId)).limit(1000),
  )) as Array<{ id: number; active: boolean }>;
  const siblings = siblingRows.filter((r) => r.id !== priceId && r.active);
  if (siblings.length === 0) {
    throw new Error("cannot remove the last active interval — archive the plan instead");
  }

  try {
    await getProvisioningStripe().prices.update(target.stripePriceId, { active: false });
  } catch (err) {
    console.warn(`${TAG} removePrice: Stripe price deactivate failed — ${(err as Error).message}`);
  }
  await withCircuitBreaker(async () =>
    db.update(planPrices).set({ active: false, isDefault: false }).where(eq(planPrices.id, priceId)),
  );
  // Guarantee exactly one default among the survivors.
  if (target.isDefault) {
    const promote = siblings[0].id;
    await withCircuitBreaker(async () =>
      db.update(planPrices).set({ isDefault: true }).where(eq(planPrices.id, promote)),
    );
  }
  invalidatePlanCache();
  console.log(`${TAG} removed interval price ${priceId} from plan ${target.planId}`);
}

/** Reorder a plan's intervals — sets sortOrder to match the given id order. */
export async function reorderPlanIntervals(planId: number, orderedPriceIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await withCircuitBreaker(async () => {
    for (let i = 0; i < orderedPriceIds.length; i++) {
      await db
        .update(planPrices)
        .set({ sortOrder: i })
        .where(and(eq(planPrices.id, orderedPriceIds[i]), eq(planPrices.planId, planId)));
    }
  });
  invalidatePlanCache();
  console.log(`${TAG} reordered ${orderedPriceIds.length} intervals for plan ${planId}`);
}

/** Show/hide one interval (eyeball). Hidden intervals are retained but never sold. */
export async function setIntervalHidden(priceId: number, hidden: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await withCircuitBreaker(async () =>
    db.update(planPrices).set({ hidden }).where(eq(planPrices.id, priceId)),
  );
  invalidatePlanCache();
  console.log(`${TAG} interval ${priceId} hidden=${hidden}`);
}

/** Update a plan's auto-restock / limited-quantity configuration. */
export async function updateRestockConfig(planId: number, restock: RestockInput): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await withCircuitBreaker(async () =>
    db
      .update(subscriptionPlans)
      .set({
        autoRestock: restock.autoRestock,
        availableQuantity: restock.availableQuantity,
        restockThreshold: restock.restockThreshold,
        restockAmount: restock.restockAmount,
      })
      .where(eq(subscriptionPlans.id, planId)),
  );
  invalidatePlanCache();
  console.log(`${TAG} updated restock config plan ${planId}`);
}

/**
 * Apply ONE subscribe to a limited-quantity plan's counter: decrement, and when
 * auto-restock fires (drops below threshold) reset to restockAmount. No-op for
 * plans that aren't limited-quantity. Called from the webhook on fulfillment.
 * (Reads through the cache; a rare concurrent-purchase race can skip one tick —
 * acceptable for a marketing FOMO counter, not a hard inventory ledger.)
 */
export async function applyPurchaseToPlanQuantity(slug: string): Promise<void> {
  const plan = await getPlanBySlug(slug);
  if (!plan || plan.availableQuantity == null) return;
  const next = computeNextQuantity(plan);
  if (next == null) return;
  const db = await getDb();
  if (!db) return;
  await withCircuitBreaker(async () =>
    db.update(subscriptionPlans).set({ availableQuantity: next }).where(eq(subscriptionPlans.id, plan.id)),
  );
  invalidatePlanCache();
  console.log(`${TAG} plan ${plan.slug} quantity ${plan.availableQuantity} → ${next}${next !== plan.availableQuantity - 1 ? " (restocked)" : ""}`);
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

/** Unarchive a plan: reactivate its Stripe Product + mark the row active again. */
export async function unarchivePlan(planId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1),
  )) as Array<{ stripeProductId: string | null }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);
  if (row.stripeProductId) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, { active: true });
    } catch (err) {
      console.warn(`${TAG} unarchive: Stripe product reactivate failed — ${(err as Error).message}`);
    }
  }
  await withCircuitBreaker(async () =>
    db.update(subscriptionPlans).set({ active: true, archivedAt: null }).where(eq(subscriptionPlans.id, planId)),
  );
  invalidatePlanCache();
  console.log(`${TAG} unarchived plan ${planId}`);
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
