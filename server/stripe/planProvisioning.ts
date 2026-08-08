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
 * Prices are immutable in Stripe: "editing" an amount/interval is create + archive
 * (see repriceInterval — new Price first, old one retired second, live
 * subscriptions left billing at their original amount). Here we create;
 * archivePlan deactivates the Product + row.
 */
import Stripe from "stripe";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import { withCircuitBreaker } from "../dbCircuitBreaker";
import {
  normalizePlanFeatures,
  type PlanFeatureKey,
} from "../../shared/planFeatures";
import {
  subscriptionPlans,
  planPrices,
  planFeatures,
  appUsers,
} from "../../drizzle/schema";
import {
  getPlanBySlug,
  invalidatePlanCache,
  computeNextQuantity,
  LIFETIME_ACCESS_UNTIL_MS,
  type BillingInterval,
} from "./planStore";

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
  if (!liveKey)
    throw new Error(
      "Neither STRIPE_TEST_SECRET_KEY nor STRIPE_SECRET_KEY is set"
    );
  const testish =
    liveKey.startsWith("sk_test_") || liveKey.startsWith("rk_test_");
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
  console.log(
    `${TAG} init Stripe client mode=${testMode ? "TEST" : "LIVE"} api=${API_VERSION}`
  );
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

/**
 * Slug-collision resolution, shared by plan creation and plan rename.
 *
 * `lookup` returns the plan currently holding a slug (or null). It is a
 * parameter rather than a direct getPlanBySlug call so the collision walk —
 * base, base-2, base-3, … — is unit-testable without a database.
 *
 * SELF-COLLISION: when `ownerPlanId` is given, a slug already held by THAT plan
 * is not a collision, it is the status quo. Without this rule, re-saving a plan
 * whose name still slugifies to its own current slug walks the suffix chain and
 * renames `dime-pro` → `dime-pro-2` on every single save — churning the
 * entitlement key that app_users.stripePlanId points at, for no change at all.
 * Creation passes no ownerPlanId (the plan does not exist yet), so its
 * behaviour is unchanged: every existing slug is a collision.
 */
export async function resolveUniqueSlug(
  name: string,
  lookup: (slug: string) => Promise<{ id: number } | null>,
  ownerPlanId?: number | null
): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  for (;;) {
    const holder = await lookup(slug);
    if (!holder) break;
    if (ownerPlanId != null && holder.id === ownerPlanId) break;
    slug = `${base}-${n}`;
    n += 1;
    if (n > 200) {
      slug = `${base}-${Date.now()}`;
      break;
    }
  }
  return slug;
}

/** A slug not already taken by an existing plan. */
async function uniqueSlug(name: string): Promise<string> {
  return resolveUniqueSlug(name, getPlanBySlug);
}

/** Stripe caps a recurring billing interval at ≤ 1 year. */
function clampCount(interval: BillingInterval, count: number): number {
  const max =
    interval === "year"
      ? 1
      : interval === "month"
        ? 12
        : interval === "week"
          ? 52
          : 365;
  return Math.min(Math.max(1, Math.floor(count)), max);
}

function validateAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < MIN_AMOUNT_CENTS) {
    throw new Error(
      `amountCents must be an integer ≥ ${MIN_AMOUNT_CENTS} (got ${amountCents})`
    );
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
  const raw = err as {
    message?: string;
    code?: string;
    errno?: number;
    sqlState?: string;
    sqlMessage?: string;
    cause?: unknown;
  };
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
  return {
    message,
    code,
    errno,
    sqlState: driver.sqlState,
    sqlMessage,
    schemaMismatch,
    missingColumn,
  };
}

/**
 * Run a single DB write with pinpointed logging. On failure it emits ONE
 * articulate line naming the step, table, driver code, and sqlMessage — and,
 * for a schema mismatch, a second line with the exact remedy — then throws a
 * clean, user-facing message (not the raw SQL) so the admin sees WHY, not a
 * query dump.
 */
async function persist<T>(
  step: string,
  table: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const d = describeDbError(err);
    if (d.schemaMismatch) {
      console.error(
        `${TAG} [DB-FAIL] step=${step} table=${table} SCHEMA-MISMATCH` +
          `${d.missingColumn ? ` missingColumn="${d.missingColumn}"` : ""}` +
          ` code=${d.code ?? "?"} errno=${d.errno ?? "?"} sqlMessage="${d.sqlMessage ?? d.message}"`
      );
      console.error(
        `${TAG} [DB-FAIL] → the deployed schema is AHEAD of the database. Run the "DB Push (apply schema migrations)" workflow, then retry.`
      );
      throw new Error(
        `Database schema is out of date${d.missingColumn ? ` — column "${d.missingColumn}" is missing from ${table}` : ` — ${table} is missing a required column`}. ` +
          `Run the db-push workflow, then try again.`
      );
    }
    console.error(
      `${TAG} [DB-FAIL] step=${step} table=${table} code=${d.code ?? "?"} errno=${d.errno ?? "?"} sqlState=${d.sqlState ?? "?"} sqlMessage="${d.sqlMessage ?? d.message}"`
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
    throw new Error(
      `promo value must be a positive integer (got ${promo.value})`
    );
  }
  if (promo.type === "percent" && promo.value > 100) {
    throw new Error(`percent promo must be 1–100 (got ${promo.value})`);
  }
  if (promo.type === "amount" && promo.value >= amountCents) {
    throw new Error(
      `amount promo (${promo.value}c) must be less than the price (${amountCents}c)`
    );
  }
  if (promo.code && !/^[A-Za-z0-9_-]{2,64}$/.test(promo.code)) {
    throw new Error(
      `promo code must be 2–64 chars of letters, numbers, - or _`
    );
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
  idemBase: string
): Promise<{ couponId: string; promoCodeId: string | null }> {
  const couponParams: Stripe.CouponCreateParams =
    promo.type === "percent"
      ? {
          percent_off: promo.value,
          duration: "forever",
          name: `${promo.value}% off`,
        }
      : {
          amount_off: promo.value,
          currency,
          duration: "forever",
          name: `$${(promo.value / 100).toFixed(2)} off`,
        };
  const coupon = await stripe.coupons.create(couponParams, {
    idempotencyKey: `coupon-${idemBase}`,
  });
  let promoCodeId: string | null = null;
  if (promo.code) {
    const pc = await stripe.promotionCodes.create(
      { promotion: { type: "coupon", coupon: coupon.id }, code: promo.code },
      { idempotencyKey: `promocode-${idemBase}` }
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

// ─── TRIALS: where `trialPeriodDays` actually has to be spent (LIFE-004) ─────
//
// READ THIS BEFORE ASSUMING A CONFIGURED TRIAL IS LIVE.
//
// `plan_prices.trialPeriodDays` is the owner's intent ("this interval starts
// with N free days"). Persisting it — and even mirroring it onto the Stripe
// Price below — DOES NOT, ON ITS OWN, GIVE ANYONE A TRIAL. Stripe applies a
// trial to the SUBSCRIPTION, not to the Price.
//
// What the pinned API version (2026-04-22.dahlia / stripe-node 22.1.1) actually
// offers:
//
//   • `Price.recurring.trial_period_days` — ACCEPTED on price creation
//     (PriceCreateParams.Recurring.trial_period_days). But the field is a
//     DEFAULT that is only read when a subscription is created with
//     `trial_from_plan: true`. That flag exists on `subscriptions.create` and
//     on subscription schedules — it does NOT exist on
//     `Checkout.SessionCreateParams.SubscriptionData`. This app sells solely
//     through Checkout Sessions, so the Price field is inert here on its own.
//     It is still set below: it makes the trial visible in the Stripe
//     dashboard, keeps the Price object honest about the plan it represents,
//     and is the value a future `trial_from_plan` path would read.
//
//   • `Checkout.SessionCreateParams.SubscriptionData.trial_period_days` — THE
//     FIELD THAT ACTUALLY CHARGES NOTHING FOR N DAYS. This is the one that must
//     be sent, and the only one Checkout honours.
//
// CONSUMPTION POINT (not owned by this module — server/routers/stripe.ts):
//   1. `resolveCheckoutPlan()` must carry the resolved interval's trial out
//      alongside priceId/description/couponId/mode — the StoredPrice it already
//      reads (`planStore.StoredPrice.trialPeriodDays`) has the value; it is
//      simply dropped on the floor today.
//   2. BOTH session builders — `buildStripeCheckoutSession` and
//      `buildEmbeddedCheckoutSession` — must fold it into their `subscriptionOnly`
//      block:
//          subscription_data: {
//            description,
//            metadata: { ... },
//            ...(trialDays != null ? { trial_period_days: trialDays } : {}),
//          }
//      Use `checkoutTrialPeriodDays()` below to normalize the value: Stripe
//      rejects 0 (the minimum is 1), and a trial is meaningless on a one-time
//      ("Lifetime") price, which checks out in mode:"payment" with no
//      subscription_data at all.
//
// Until step 2 lands, a configured trial is decorative: the buyer is charged
// immediately.

/**
 * The `subscription_data.trial_period_days` value for a stored interval, or
 * `undefined` when no trial applies.
 *
 * Pure and exported so the checkout-session builder has ONE place to ask "does
 * this interval start with a free trial?" and cannot re-derive the rule wrongly.
 * Returns undefined for a non-recurring ("Lifetime" / one_time) price — such a
 * checkout runs in mode:"payment" and has no subscription to put a trial on —
 * and for 0/negative/null days, which Stripe rejects (the minimum is 1).
 */
export function checkoutTrialPeriodDays(price: {
  interval: BillingInterval | null;
  trialPeriodDays: number | null;
}): number | undefined {
  if (!price.interval) return undefined;
  const days = normTrial(price.trialPeriodDays);
  return days ?? undefined;
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
  opts: {
    isDefault: boolean;
    sortOrder: number;
    planType: PlanType;
    idemSalt?: string;
  }
): Promise<{ priceId: string; rowId: number }> {
  validateAmount(input.amountCents);
  const currency = (input.currency ?? "usd").toLowerCase();
  // A price is recurring (has a Stripe `recurring` block) ONLY when the plan is a
  // subscription AND this specific interval carries a cadence. A recurring plan
  // may include a "Lifetime" interval — the client omits `interval` to signal it —
  // which is charged as a single one-time payment (mode:"payment" at checkout).
  const recurring = opts.planType !== "one_time" && input.interval != null;
  const interval: BillingInterval | null = recurring
    ? (input.interval as BillingInterval)
    : null;
  const intervalCount: number | null = recurring
    ? clampCount(interval as BillingInterval, input.intervalCount ?? 1)
    : null;
  // 0 days ≡ no trial (same normalization billingShapeChanged uses), so a form
  // that defaults the trial box to 0 never sends a bogus `trial_period_days`.
  const trialDays = recurring ? normTrial(input.trialPeriodDays) : null;
  // sortOrder keeps idempotency keys distinct even for same-amount one-time prices.
  // `idemSalt` distinguishes repeat *reprices* of the same plan: repriceInterval
  // rewrites the replacement row's sortOrder back to the original's, so sortOrder
  // alone can repeat and a flip-flopping edit ($10→$11→$10→$11) would otherwise
  // replay a 24h-old idempotency key and hand back an ARCHIVED Stripe Price.
  // The trial is part of the key too: it is part of the Price's create params
  // now, and Stripe REJECTS a replayed key whose parameters differ — adding or
  // removing a trial on an otherwise identical shape must be a different key.
  // (Appended only when a trial exists, so keys for untrialled prices are
  // byte-for-byte what they were before trials were wired up.)
  const idemTag =
    `${slug}-${input.amountCents}-${recurring ? `${interval}${intervalCount}` : "once"}-${opts.sortOrder}` +
    (trialDays != null ? `-t${trialDays}` : "") +
    (opts.idemSalt ? `-${opts.idemSalt}` : "");

  const price = await stripe.prices.create(
    {
      product: productId,
      unit_amount: input.amountCents,
      currency,
      ...(recurring
        ? {
            recurring: {
              interval: interval as BillingInterval,
              interval_count: intervalCount as number,
              // Mirrored for dashboard visibility + `trial_from_plan` parity ONLY.
              // Checkout does NOT read this — see the TRIALS note above; the
              // trial reaches the buyer via subscription_data.trial_period_days.
              ...(trialDays != null ? { trial_period_days: trialDays } : {}),
            },
          }
        : {}),
      metadata: { dime_plan_slug: slug },
    },
    { idempotencyKey: `plan-price-${idemTag}` }
  );

  let couponId: string | null = null;
  let promoCodeId: string | null = null;
  if (input.promo) {
    validatePromo(input.promo, input.amountCents);
    const provisioned = await provisionPromo(
      stripe,
      input.promo,
      currency,
      idemTag
    );
    couponId = provisioned.couponId;
    promoCodeId = provisioned.promoCodeId;
  }

  const res = await withCircuitBreaker(async () =>
    db_insert_price(
      planId,
      price,
      input,
      currency,
      interval,
      intervalCount,
      opts,
      {
        promoType: input.promo?.type ?? null,
        promoValue: input.promo?.value ?? null,
        promoCode: input.promo?.code ?? null,
        stripeCouponId: couponId,
        stripePromoCodeId: promoCodeId,
      }
    )
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
  }
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
      // Normalized (0 ≡ null) so the row agrees with what was sent to Stripe and
      // with billingShapeChanged, which would otherwise see 0-vs-null churn. The
      // raw value is otherwise kept as-is — including on a non-recurring price,
      // where it is inert but harmless; suppressing it here would make every
      // subsequent save look like a billing-shape change and reprice in a loop.
      trialPeriodDays: normTrial(input.trialPeriodDays),
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
    })
  );
}

/**
 * Create a Stripe Product with ONE OR MORE recurring Prices (billing variants),
 * each with its own optional free trial and promo coupon, and persist the plan
 * + its price rows. The first price is the default. `restock` seeds the
 * auto-restock FOMO counter (see schema).
 */
export async function provisionPlan(input: NewPlanInput): Promise<{
  planId: number;
  slug: string;
  stripeProductId: string;
  stripePriceId: string;
}> {
  if (!input.prices || input.prices.length === 0) {
    throw new Error("a plan needs at least one interval");
  }
  // Validate every interval (amount + promo) up front so a bad input fails
  // before ANY Stripe object is created — no orphaned product/coupons.
  input.prices.forEach(p => {
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
    { idempotencyKey: `plan-product-${slug}` }
  );

  // 2) Plan row first (incl. auto-restock config) so price rows can reference it.
  console.log(
    `${TAG} [STEP] Stripe product ready id=${product.id} livemode=${product.livemode} — inserting subscription_plans row slug=${slug}`
  );
  const planRes = await persist("insert-plan", "subscription_plans", () =>
    withCircuitBreaker(async () =>
      db.insert(subscriptionPlans).values({
        slug,
        name: input.name,
        description: input.description ?? null,
        planType: input.planType ?? "recurring",
        stripeProductId: product.id,
        active: true,
        accessUntil:
          (input.planType ?? "recurring") === "one_time"
            ? LIFETIME_ACCESS_UNTIL_MS
            : null,
        livemode: product.livemode,
        maxSubscribers: input.maxSubscribers ?? null,
        autoRestock: restock?.autoRestock ?? false,
        availableQuantity: restock?.availableQuantity ?? null,
        restockThreshold: restock?.restockThreshold ?? null,
        restockAmount: restock?.restockAmount ?? null,
        sortOrder: 0,
      })
    )
  );
  const planId = Number(planRes?.[0]?.insertId ?? 0);
  if (!planId) throw new Error("failed to persist subscription_plans row");
  console.log(
    `${TAG} [STEP] subscription_plans row inserted id=${planId} — provisioning ${input.prices.length} price(s)`
  );

  // 3) Each interval → a Stripe Price (+ optional promo coupon) + a row. The
  //    first interval is the default price checkout charges by default.
  const planType = input.planType ?? "recurring";
  let defaultPriceId = "";
  for (let i = 0; i < input.prices.length; i++) {
    const created = await createAndPersistPrice(
      stripe,
      planId,
      product.id,
      slug,
      input.prices[i],
      {
        isDefault: i === 0,
        sortOrder: i,
        planType,
      }
    );
    if (i === 0) defaultPriceId = created.priceId;
  }

  invalidatePlanCache();
  console.log(
    `${TAG} provisioned plan slug=${slug} type=${planType} product=${product.id} intervals=${input.prices.length} default=${defaultPriceId}`
  );
  return {
    planId,
    slug,
    stripeProductId: product.id,
    stripePriceId: defaultPriceId,
  };
}

/**
 * Add one more interval (billing variant) to an existing plan.
 *
 * `opts.idemSalt` (optional) widens the Stripe idempotency key for callers that
 * can legitimately re-create the same billing shape on the same plan — see
 * repriceInterval. Existing callers pass nothing and keep today's behaviour.
 */
export async function addPriceToPlan(
  planId: number,
  input: NewPriceInput,
  opts?: { idemSalt?: string }
): Promise<{ priceId: string; rowId: number }> {
  validateAmount(input.amountCents);
  if (input.promo) validatePromo(input.promo, input.amountCents);
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1)
  )) as Array<{
    slug: string;
    stripeProductId: string | null;
    planType: PlanType;
  }>;
  const plan = rows[0];
  if (!plan) throw new Error(`plan ${planId} not found`);
  if (!plan.stripeProductId)
    throw new Error(`plan ${planId} has no Stripe product`);

  const existing = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(planPrices)
      .where(eq(planPrices.planId, planId))
      .limit(1000)
  )) as Array<{ sortOrder: number }>;
  const nextSort = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;

  const stripe = getProvisioningStripe();
  const created = await createAndPersistPrice(
    stripe,
    planId,
    plan.stripeProductId,
    plan.slug,
    input,
    {
      isDefault: false,
      sortOrder: nextSort,
      planType: plan.planType,
      idemSalt: opts?.idemSalt,
    }
  );
  invalidatePlanCache();
  console.log(
    `${TAG} added interval to plan ${planId}: price=${created.priceId}`
  );
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
    db.select().from(planPrices).where(eq(planPrices.id, priceId)).limit(1)
  )) as Array<{
    id: number;
    planId: number;
    stripePriceId: string;
    isDefault: boolean;
  }>;
  const target = targetRows[0];
  if (!target) throw new Error(`price ${priceId} not found`);
  const siblingRows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(planPrices)
      .where(eq(planPrices.planId, target.planId))
      .limit(1000)
  )) as Array<{ id: number; active: boolean }>;
  const siblings = siblingRows.filter(r => r.id !== priceId && r.active);
  if (siblings.length === 0) {
    throw new Error(
      "cannot remove the last active interval — archive the plan instead"
    );
  }

  try {
    await getProvisioningStripe().prices.update(target.stripePriceId, {
      active: false,
    });
  } catch (err) {
    console.warn(
      `${TAG} removePrice: Stripe price deactivate failed — ${(err as Error).message}`
    );
  }
  await withCircuitBreaker(async () =>
    db
      .update(planPrices)
      .set({ active: false, isDefault: false })
      .where(eq(planPrices.id, priceId))
  );
  // Guarantee exactly one default among the survivors.
  if (target.isDefault) {
    const promote = siblings[0].id;
    await withCircuitBreaker(async () =>
      db
        .update(planPrices)
        .set({ isDefault: true })
        .where(eq(planPrices.id, promote))
    );
  }
  invalidatePlanCache();
  console.log(
    `${TAG} removed interval price ${priceId} from plan ${target.planId}`
  );
}

/** Reorder a plan's intervals — sets sortOrder to match the given id order. */
export async function reorderPlanIntervals(
  planId: number,
  orderedPriceIds: number[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await withCircuitBreaker(async () => {
    for (let i = 0; i < orderedPriceIds.length; i++) {
      await db
        .update(planPrices)
        .set({ sortOrder: i })
        .where(
          and(
            eq(planPrices.id, orderedPriceIds[i]),
            eq(planPrices.planId, planId)
          )
        );
    }
  });
  invalidatePlanCache();
  console.log(
    `${TAG} reordered ${orderedPriceIds.length} intervals for plan ${planId}`
  );
}

/** Show/hide one interval (eyeball). Hidden intervals are retained but never sold. */
export async function setIntervalHidden(
  priceId: number,
  hidden: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  // Hiding the plan's DEFAULT leaves it with a flag nothing can honour:
  // defaultPriceForMode filters `!hidden` BEFORE it looks for isDefault, so the
  // plan silently falls back to whichever interval sorts first — a different
  // cadence from the one every surface advertises, with no error anywhere.
  // Observed on dime-max, whose default sat on a hidden daily row while the
  // card read $199.99/month; a bare ?plan=dime-max resolved to the weekly.
  // Refuse it in the same shape as the archived check in setIntervalDefault.
  if (hidden) {
    const rows = (await withCircuitBreaker(async () =>
      db.select().from(planPrices).where(eq(planPrices.id, priceId)).limit(1)
    )) as Array<{ id: number; isDefault: boolean }>;
    const target = rows[0];
    if (!target) throw new Error(`price ${priceId} not found`);
    if (target.isDefault) {
      throw new Error(
        `price ${priceId} is this plan's default — hiding it would leave the plan with no usable default, and checkout would silently charge whichever interval sorts first. Make a visible interval the default first, then hide this one.`
      );
    }
  }
  await withCircuitBreaker(async () =>
    db.update(planPrices).set({ hidden }).where(eq(planPrices.id, priceId))
  );
  invalidatePlanCache();
  console.log(`${TAG} interval ${priceId} hidden=${hidden}`);
}

/**
 * Make ONE interval the plan's default (the price checkout charges when the
 * buyer doesn't pick a variant) and clear the flag on its siblings — scoped to
 * that plan only, so two plans never fight over a single default.
 */
export async function setIntervalDefault(priceId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db.select().from(planPrices).where(eq(planPrices.id, priceId)).limit(1)
  )) as Array<{
    id: number;
    planId: number;
    active: boolean;
    hidden: boolean;
  }>;
  const target = rows[0];
  if (!target) throw new Error(`price ${priceId} not found`);
  if (!target.active) {
    throw new Error(
      `price ${priceId} is archived — an inactive interval cannot be the default`
    );
  }
  // Same reasoning as archived: a hidden interval is retained but never offered
  // at checkout, so flagging it default produces a plan whose default cannot be
  // honoured — defaultPriceForMode filters `!hidden` first and falls through to
  // whatever sorts first. The flag would look set in admin and mean nothing.
  if (target.hidden) {
    throw new Error(
      `price ${priceId} is hidden — a hidden interval is never offered at checkout, so it cannot be the default. Unhide it first, or make a visible interval the default.`
    );
  }
  // Clear first, then set: the target ends up as the only default even if it
  // was already flagged, and no window exists where the plan has two defaults.
  await withCircuitBreaker(async () =>
    db
      .update(planPrices)
      .set({ isDefault: false })
      .where(eq(planPrices.planId, target.planId))
  );
  await withCircuitBreaker(async () =>
    db
      .update(planPrices)
      .set({ isDefault: true })
      .where(eq(planPrices.id, priceId))
  );
  invalidatePlanCache();
  console.log(
    `${TAG} interval ${priceId} is now the default for plan ${target.planId}`
  );
}

// ─── Repricing (Stripe Prices are immutable) ─────────────────────────────────

/**
 * The subset of a plan_prices row that Stripe FREEZES at Price-creation time.
 * `amount`, `currency`, `recurring.interval`, `recurring.interval_count` and
 * `recurring.trial_period_days` cannot be updated on an existing Stripe Price —
 * only `nickname`, `active`, `metadata` and `lookup_key` are mutable. Changing
 * anything in this shape therefore means minting a NEW Price.
 */
export interface BillingShapeRow {
  amountCents: number;
  currency: string;
  interval: BillingInterval | null;
  intervalCount: number | null;
  trialPeriodDays: number | null;
  promoType: "percent" | "amount" | null;
  promoValue: number | null;
  promoCode: string | null;
}

/** null / undefined / "" all mean "not set" — a blank form field is not a change. */
function normStr(s: string | null | undefined): string | null {
  return s == null || s === "" ? null : s;
}
/** 0 days and NULL both mean "no trial" — treat them as equal, or a form that
 *  defaults the trial box to 0 would reprice every untrialled interval. */
function normTrial(days: number | null | undefined): number | null {
  return days == null || days <= 0 ? null : days;
}

/**
 * True when `input` would need a NEW Stripe Price rather than an in-place edit.
 *
 * Pure and exported so the no-op detector is unit-testable without a DB or a
 * Stripe account. Deliberately compares the NORMALIZED shape (currency cased,
 * intervalCount clamped exactly as createAndPersistPrice clamps it, 0-day trial
 * ≡ no trial, "" ≡ null) so a round-trip through the admin form that changed
 * nothing reads as unchanged. Presentation fields — `label` and `hidden` — are
 * NOT part of the shape: they are mutable on a live Price and must never cause
 * a reprice.
 */
export function billingShapeChanged(
  row: BillingShapeRow,
  input: NewPriceInput
): boolean {
  if (row.amountCents !== input.amountCents) return true;
  if (
    (row.currency ?? "usd").toLowerCase() !==
    (input.currency ?? "usd").toLowerCase()
  )
    return true;

  const oldInterval = row.interval ?? null;
  const newInterval = input.interval ?? null;
  if (oldInterval !== newInterval) return true;
  const oldCount = oldInterval
    ? clampCount(oldInterval, row.intervalCount ?? 1)
    : null;
  const newCount = newInterval
    ? clampCount(newInterval, input.intervalCount ?? 1)
    : null;
  if (oldCount !== newCount) return true;

  if (normTrial(row.trialPeriodDays) !== normTrial(input.trialPeriodDays))
    return true;

  const promo = input.promo ?? null;
  if ((row.promoType ?? null) !== (promo?.type ?? null)) return true;
  if ((row.promoValue ?? null) !== (promo?.value ?? null)) return true;
  if (normStr(row.promoCode) !== normStr(promo?.code)) return true;

  return false;
}

// ─── Payment-link safety net (a reprice ARCHIVES the old Price) ──────────────
//
// A Stripe Payment Link binds to a SPECIFIC Price. Archiving that Price does not
// update the link, disable it, or warn anywhere — the link silently stops
// working, and nothing in this admin would ever say so. It has already happened
// in this account twice: two links still point at prices archived by earlier
// edits. Both links were already deactivated, so no revenue was lost, but the
// mechanism is proven, and there is now a LIVE one-time payment link that must
// not be broken.
//
// So a reprice looks for links selling the price it is about to archive, and
// refuses by default when any ACTIVE link would break.

/** Payment Links per page (Stripe's max) and the page cap for one scan. */
const PAYMENT_LINK_PAGE_SIZE = 100;
const PAYMENT_LINK_PAGE_CAP = 5;

export interface PaymentLinkRef {
  id: string;
  url: string;
  active: boolean;
}

/**
 * A line item's price id. `price` comes back as an expanded Price object on the
 * expand path and can be a bare id string on others — accept both rather than
 * assume, because guessing wrong here makes the guard silently find nothing.
 */
function lineItemPriceId(item: unknown): string | null {
  const price = (item as { price?: unknown } | null)?.price;
  if (typeof price === "string") return price;
  const id = (price as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

/** Does this Payment Link sell `stripePriceId`? */
async function paymentLinkSellsPrice(
  stripe: Stripe,
  link: Stripe.PaymentLink,
  stripePriceId: string
): Promise<boolean> {
  // `line_items` is only populated when expanded. If it is missing, ask the
  // dedicated endpoint rather than treating the link as a non-match — a false
  // "no links reference this" is exactly the failure this guard exists to stop.
  const items =
    link.line_items?.data ??
    (
      await stripe.paymentLinks.listLineItems(link.id, {
        limit: PAYMENT_LINK_PAGE_SIZE,
      })
    ).data;
  return (items ?? []).some(li => lineItemPriceId(li) === stripePriceId);
}

/**
 * Scan Payment Links for ones selling `stripePriceId`, reporting whether the
 * scan was complete. Bounded at PAYMENT_LINK_PAGE_CAP × PAYMENT_LINK_PAGE_SIZE
 * links; a cap hit is returned as `truncated` AND logged, never swallowed.
 */
async function scanPaymentLinksForPrice(
  stripePriceId: string
): Promise<{ links: PaymentLinkRef[]; truncated: boolean; scanned: number }> {
  const stripe = getProvisioningStripe();
  const links: PaymentLinkRef[] = [];
  let startingAfter: string | undefined;
  let truncated = false;
  let scanned = 0;

  for (let page = 0; page < PAYMENT_LINK_PAGE_CAP; page++) {
    const res = await stripe.paymentLinks.list({
      limit: PAYMENT_LINK_PAGE_SIZE,
      expand: ["data.line_items"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const batch = res.data ?? [];
    for (const link of batch) {
      scanned += 1;
      if (await paymentLinkSellsPrice(stripe, link, stripePriceId)) {
        links.push({
          id: link.id,
          url: link.url,
          active: link.active === true,
        });
      }
    }
    if (batch.length === 0 || !res.has_more) break;
    startingAfter = batch[batch.length - 1].id;
    if (page === PAYMENT_LINK_PAGE_CAP - 1) truncated = true;
  }

  if (truncated) {
    console.warn(
      `${TAG} [PAYMENT-LINK-SCAN] TRUNCATED after ${scanned} link(s) (${PAYMENT_LINK_PAGE_CAP} pages × ${PAYMENT_LINK_PAGE_SIZE}) — ` +
        `this account has MORE Payment Links than one scan covers, so links beyond that point were NOT checked against ${stripePriceId}. ` +
        `Treat a "no links found" result as incomplete and verify in the Stripe dashboard.`
    );
  }
  return { links, truncated, scanned };
}

/**
 * Every Payment Link whose line items reference `stripePriceId`, active or not.
 *
 * The `active` flag is returned rather than filtered on: an INACTIVE link is
 * already off and must never block an edit, but the caller still wants to know
 * it exists. Bounded pagination — see scanPaymentLinksForPrice, which logs
 * loudly if the scan is truncated.
 */
export async function findPaymentLinksForPrice(
  stripePriceId: string
): Promise<PaymentLinkRef[]> {
  const { links } = await scanPaymentLinksForPrice(stripePriceId);
  return links;
}

/**
 * - `clear`    — checked, nothing ACTIVE sells the price; safe to archive.
 * - `override` — active links found, but the caller explicitly opted in.
 * - `failed`   — the Stripe lookup itself errored; guard skipped, edit allowed.
 * - `skipped`  — nothing is being archived (presentation-only edit).
 */
export type PaymentLinkGuardStatus =
  "clear" | "override" | "failed" | "skipped";

export interface PaymentLinkGuardOutcome {
  status: PaymentLinkGuardStatus;
  /** ACTIVE links selling the price — non-empty only when status is "override". */
  activeLinks: PaymentLinkRef[];
  /** Inactive links selling the price. Reported, never blocking. */
  inactiveCount: number;
  /** True when the scan hit its page cap and may have missed links. */
  truncated: boolean;
  /** One-line summary for the caller's [OUTPUT] log. */
  summary: string;
}

/** Nothing is being archived, so there is nothing to protect. */
const PAYMENT_LINK_GUARD_SKIPPED: PaymentLinkGuardOutcome = {
  status: "skipped",
  activeLinks: [],
  inactiveCount: 0,
  truncated: false,
  summary: "not checked (no Price archived)",
};

/**
 * Decide whether archiving `stripePriceId` is safe given the links that sell it.
 * THROWS when an ACTIVE link would break and the caller has not opted in.
 *
 * Pure (bar logging) and exported so the block/allow rule is unit-testable
 * without a Stripe account.
 */
export function evaluatePaymentLinkGuard(
  stripePriceId: string,
  links: PaymentLinkRef[],
  opts?: { allowBreakingPaymentLinks?: boolean; truncated?: boolean }
): PaymentLinkGuardOutcome {
  const truncated = opts?.truncated === true;
  const active = links.filter(l => l.active);
  const inactiveCount = links.length - active.length;

  if (active.length === 0) {
    return {
      status: "clear",
      activeLinks: [],
      inactiveCount,
      truncated,
      summary:
        `checked, no ACTIVE payment link sells ${stripePriceId}` +
        (inactiveCount > 0
          ? ` (${inactiveCount} inactive link(s) ignored)`
          : "") +
        (truncated ? " — SCAN TRUNCATED, result may be incomplete" : ""),
    };
  }

  const named = active.map(l => `${l.id} (${l.url})`).join(", ");
  if (!opts?.allowBreakingPaymentLinks) {
    throw new Error(
      `This edit would archive Stripe Price ${stripePriceId}, which ${active.length} ACTIVE Stripe Payment Link(s) still sell: ${named}. ` +
        `Archiving the price breaks those links silently — buyers get an error and nothing in this admin would report it. ` +
        `Point the link(s) at a new price (or deactivate them) first, or re-run this edit with "allow breaking payment links" to proceed anyway.`
    );
  }

  console.warn(
    `${TAG} [PAYMENT-LINK-OVERRIDE] archiving ${stripePriceId} anyway — ${active.length} ACTIVE Payment Link(s) WILL BREAK: ${named}. ` +
      `Proceeding only because allowBreakingPaymentLinks was set explicitly. Repoint or retire those links now.`
  );
  return {
    status: "override",
    activeLinks: active,
    inactiveCount,
    truncated,
    summary: `OVERRIDE — ${active.length} ACTIVE payment link(s) broken: ${named}`,
  };
}

/**
 * Look up the Payment Links selling `stripePriceId` and apply the guard.
 *
 * A Stripe FAILURE HERE IS NOT FATAL. The guard is a safety net, not a
 * dependency: if the lookup errors (outage, key scope, rate limit) the reprice
 * continues with a loud warning, because a Stripe hiccup must never make plan
 * editing impossible. Only a successful lookup that FINDS an active link blocks.
 */
export async function guardPaymentLinksBeforeArchive(
  stripePriceId: string,
  opts?: { allowBreakingPaymentLinks?: boolean }
): Promise<PaymentLinkGuardOutcome> {
  let scan: { links: PaymentLinkRef[]; truncated: boolean };
  try {
    scan = await scanPaymentLinksForPrice(stripePriceId);
  } catch (err) {
    console.warn(
      `${TAG} [PAYMENT-LINK-CHECK] FAILED for ${stripePriceId} — ${(err as Error).message}. ` +
        `Proceeding with the edit: the payment-link guard is a safety net, not a dependency. ` +
        `Verify by hand in the Stripe dashboard that no live Payment Link sold this price.`
    );
    return {
      status: "failed",
      activeLinks: [],
      inactiveCount: 0,
      truncated: false,
      summary: `CHECK FAILED (${(err as Error).message}) — proceeded unguarded`,
    };
  }
  return evaluatePaymentLinkGuard(stripePriceId, scan.links, {
    allowBreakingPaymentLinks: opts?.allowBreakingPaymentLinks,
    truncated: scan.truncated,
  });
}

export interface RepriceOptions {
  /**
   * Proceed even when an ACTIVE Payment Link sells the price being archived.
   * Downgrades the hard block to a loud `console.warn`. Off by default — the
   * admin has to say so consciously.
   */
  allowBreakingPaymentLinks?: boolean;
}

export interface RepriceResult {
  /** True when a NEW Stripe Price was minted (billing shape changed). */
  changed: boolean;
  oldPriceRowId: number;
  /** Same as oldPriceRowId when `changed` is false. */
  newPriceRowId: number;
  newStripePriceId: string;
  /** True when the edited interval was the plan's default and the replacement inherited it. */
  carriedDefault: boolean;
  /** What the payment-link guard did before the old Price was archived. */
  paymentLinks: PaymentLinkGuardOutcome;
}

/**
 * "Edit" one interval of a plan. Because Stripe Prices are immutable, this is
 * two different operations behind one call:
 *
 *  1. **Presentation-only edit** (billing shape unchanged) — no Stripe Price is
 *     created. `label` is written to the row AND to the live Price's `nickname`,
 *     `hidden` is written to the row, and the function returns `changed:false`.
 *     This is what stops a Save that only renamed the plan from minting a fresh
 *     Price for every interval on the plan.
 *  2. **Reprice** (amount / currency / interval / intervalCount / trial / promo
 *     changed) — a NEW Stripe Price is created on the SAME Product, the old row's
 *     `sortOrder` and `hidden` are carried onto it, the default flag moves to it
 *     if the original held it, and only THEN is the original deactivated.
 *
 * ORDERING GUARANTEE: create-then-deactivate, never the reverse. If Stripe fails
 * while minting the replacement, the original is untouched and the plan is still
 * sellable. If deactivating the original fails AFTER the replacement exists, we
 * log a loud `[REPRICE-ORPHAN]` line and still report success — the plan then
 * offers both prices (recoverable) rather than none (an outage).
 *
 * EXISTING SUBSCRIBERS ARE NOT TOUCHED. Stripe keeps billing every live
 * subscription at the Price it was created with, and archiving a Price does not
 * cancel or re-rate those subscriptions. A reprice changes what NEW buyers pay;
 * moving existing subscribers is a separate, explicit migration and is
 * deliberately not done here.
 *
 * `input` is the interval's FULL desired state, not a sparse patch: an omitted
 * `label`/`trialPeriodDays`/`promo` clears it, exactly as it would on create.
 * `hidden` is the one exception — omitted means "carry the current value".
 *
 * PAYMENT-LINK GUARD: a reprice archives the old Stripe Price, which silently
 * breaks any Stripe Payment Link bound to it. Before ANY Stripe write, active
 * links selling that price are looked up and the edit is REFUSED by name unless
 * `opts.allowBreakingPaymentLinks` is set. Inactive links never block, and a
 * failed lookup never blocks. See guardPaymentLinksBeforeArchive.
 */
export async function repriceInterval(
  priceId: number,
  input: NewPriceInput,
  opts?: RepriceOptions
): Promise<RepriceResult> {
  validateAmount(input.amountCents);
  if (input.promo) validatePromo(input.promo, input.amountCents);

  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const targetRows = (await withCircuitBreaker(async () =>
    db.select().from(planPrices).where(eq(planPrices.id, priceId)).limit(1)
  )) as Array<
    BillingShapeRow & {
      id: number;
      planId: number;
      stripePriceId: string;
      label: string | null;
      active: boolean;
      isDefault: boolean;
      hidden: boolean;
      sortOrder: number;
    }
  >;
  const target = targetRows[0];
  if (!target) throw new Error(`price ${priceId} not found`);
  if (!target.active) {
    throw new Error(
      `price ${priceId} is archived — add a new interval instead of repricing it`
    );
  }

  const siblingRows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(planPrices)
      .where(eq(planPrices.planId, target.planId))
      .limit(1000)
  )) as Array<{ id: number; active: boolean }>;
  const otherActive = siblingRows.filter(r => r.id !== priceId && r.active);

  // Presentation resolution: label follows create semantics (omitted = cleared);
  // hidden is carried when omitted, so a reprice never silently un-hides.
  const label = input.label ?? null;
  const hidden = input.hidden ?? target.hidden;

  // GUARD — never let an edit be the thing that makes a plan unsellable. Hiding
  // the plan's ONLY active interval leaves nothing to sell, so refuse it. An
  // interval that was ALREADY hidden is allowed through: the plan is unsellable
  // either way, and blocking the edit would trap the owner (they could not fix
  // the price before unhiding it).
  if (otherActive.length === 0 && hidden && !target.hidden) {
    throw new Error(
      "cannot hide a plan's only active interval — the plan would have nothing to sell. Add another interval first."
    );
  }

  const changed = billingShapeChanged(target, input);

  if (!changed) {
    if (label !== (target.label ?? null)) {
      try {
        // nickname is one of the four mutable fields on a live Stripe Price.
        await getProvisioningStripe().prices.update(target.stripePriceId, {
          nickname: label ?? "",
        });
      } catch (err) {
        console.warn(
          `${TAG} reprice: Stripe price nickname update failed — ${(err as Error).message}`
        );
      }
    }
    await withCircuitBreaker(async () =>
      db
        .update(planPrices)
        .set({ label, hidden })
        .where(eq(planPrices.id, priceId))
    );
    invalidatePlanCache();
    console.log(
      `${TAG} reprice ${priceId}: billing shape UNCHANGED — NO new Stripe Price minted; applied presentation only (label="${label ?? ""}" hidden=${hidden}) on ${target.stripePriceId}`
    );
    return {
      changed: false,
      oldPriceRowId: priceId,
      newPriceRowId: priceId,
      newStripePriceId: target.stripePriceId,
      carriedDefault: target.isDefault,
      // Nothing is archived on this path, so no Payment Link can break.
      paymentLinks: PAYMENT_LINK_GUARD_SKIPPED,
    };
  }

  // GUARD — this edit will archive target.stripePriceId, silently breaking any
  // Payment Link bound to it. Run BEFORE the replacement is minted, not merely
  // before the archive: a block then leaves the plan completely untouched, with
  // no orphan Stripe Price to clean up. Throws unless the caller opted in;
  // never throws on a Stripe lookup failure.
  const paymentLinks = await guardPaymentLinksBeforeArchive(
    target.stripePriceId,
    {
      allowBreakingPaymentLinks: opts?.allowBreakingPaymentLinks,
    }
  );
  console.log(
    `${TAG} reprice ${priceId}: payment-link guard — ${paymentLinks.summary}`
  );

  console.log(
    `${TAG} reprice ${priceId} plan=${target.planId}: billing shape CHANGED ` +
      `(${target.amountCents}${target.currency} ${target.interval ?? "once"}x${target.intervalCount ?? 1} → ${input.amountCents}${(input.currency ?? "usd").toLowerCase()} ${input.interval ?? "once"}x${input.intervalCount ?? 1}) ` +
      `— MINTING a new Stripe Price; existing subscriptions stay on ${target.stripePriceId} at the old amount`
  );

  // 1) Mint the replacement FIRST. A Stripe failure here throws with the plan
  //    untouched and still sellable.
  const created = await addPriceToPlan(
    target.planId,
    { ...input, label: label ?? undefined, hidden },
    { idemSalt: `rp${priceId}` }
  );

  // 2) Carry the old row's presentation/ordering state onto the replacement so
  //    the interval keeps its slot in the plan's list and its default flag.
  await withCircuitBreaker(async () =>
    db
      .update(planPrices)
      .set({
        sortOrder: target.sortOrder,
        hidden,
        ...(target.isDefault ? { isDefault: true } : {}),
      })
      .where(eq(planPrices.id, created.rowId))
  );
  if (target.isDefault) {
    // Clear the old flag BEFORE removePriceFromPlan runs, so it sees a non-default
    // row and does not promote an unrelated sibling over the replacement.
    await withCircuitBreaker(async () =>
      db
        .update(planPrices)
        .set({ isDefault: false })
        .where(eq(planPrices.id, priceId))
    );
  }

  // 3) Only now retire the original. Never fatal: the replacement is already live.
  try {
    await removePriceFromPlan(priceId);
  } catch (err) {
    console.error(
      `${TAG} [REPRICE-ORPHAN] replacement price ${created.priceId} (row ${created.rowId}) IS LIVE but retiring the old interval ${priceId} (${target.stripePriceId}) FAILED — ${(err as Error).message}. ` +
        `Plan ${target.planId} now offers BOTH prices; archive the old interval by hand. Reported as success on purpose — the plan must never be left with zero active prices.`
    );
  }

  invalidatePlanCache();
  console.log(
    `${TAG} repriced interval ${priceId} → row ${created.rowId} price ${created.priceId} ` +
      `plan=${target.planId} sortOrder=${target.sortOrder} hidden=${hidden} carriedDefault=${target.isDefault}`
  );
  return {
    changed: true,
    oldPriceRowId: priceId,
    newPriceRowId: created.rowId,
    newStripePriceId: created.priceId,
    carriedDefault: target.isDefault,
    paymentLinks,
  };
}

/** Update a plan's auto-restock / limited-quantity configuration. */
export async function updateRestockConfig(
  planId: number,
  restock: RestockInput
): Promise<void> {
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
      .where(eq(subscriptionPlans.id, planId))
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
    db
      .update(subscriptionPlans)
      .set({ availableQuantity: next })
      .where(eq(subscriptionPlans.id, plan.id))
  );
  invalidatePlanCache();
  console.log(
    `${TAG} plan ${plan.slug} quantity ${plan.availableQuantity} → ${next}${next !== plan.availableQuantity - 1 ? " (restocked)" : ""}`
  );
}

/** Archive a plan: deactivate its Stripe Product + mark the row inactive. */
export async function archivePlan(planId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1)
  )) as Array<{ stripeProductId: string | null }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);

  if (row.stripeProductId) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, {
        active: false,
      });
    } catch (err) {
      console.warn(
        `${TAG} archive: Stripe product deactivate failed — ${(err as Error).message}`
      );
    }
  }
  await withCircuitBreaker(async () =>
    db
      .update(subscriptionPlans)
      .set({ active: false, archivedAt: Date.now() })
      .where(eq(subscriptionPlans.id, planId))
  );
  invalidatePlanCache();
  console.log(`${TAG} archived plan ${planId}`);
}

/** Unarchive a plan: reactivate its Stripe Product + mark the row active again. */
export async function unarchivePlan(planId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1)
  )) as Array<{ stripeProductId: string | null }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);
  if (row.stripeProductId) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, {
        active: true,
      });
    } catch (err) {
      console.warn(
        `${TAG} unarchive: Stripe product reactivate failed — ${(err as Error).message}`
      );
    }
  }
  await withCircuitBreaker(async () =>
    db
      .update(subscriptionPlans)
      .set({ active: true, archivedAt: null })
      .where(eq(subscriptionPlans.id, planId))
  );
  invalidatePlanCache();
  console.log(`${TAG} unarchived plan ${planId}`);
}

// ─── Slug sync (plan rename → entitlement key + referrers) ───────────────────

export interface SlugSyncResult {
  /** False when the plan's name already agrees with its slug — nothing written. */
  changed: boolean;
  oldSlug: string;
  newSlug: string;
  /** app_users rows moved from oldSlug to newSlug (0 when changed:false). */
  referrersUpdated: number;
}

/**
 * mysql2 reports an UPDATE's row count on the ResultSetHeader; Drizzle hands
 * back the raw driver tuple `[ResultSetHeader, FieldPacket[]]`. Pure + exported
 * so the referrer count is unit-tested without a database.
 */
export function readAffectedRows(result: unknown): number | null {
  const header = Array.isArray(result) ? result[0] : result;
  const n = (header as { affectedRows?: unknown } | null | undefined)
    ?.affectedRows;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Re-derive a plan's slug from its CURRENT name and move every referrer with it.
 *
 * WHY THIS EXISTS: `subscription_plans.slug` is an FK-BY-VALUE target.
 * `app_users.stripePlanId` stores the slug STRING, and checkout resolves plans
 * by slug — so a slug that changes without its referrers changing silently
 * breaks the entitlement lookup for every user still holding the old value.
 * Renaming a plan in the admin previously moved the name only, which is how
 * production ended up with "Dime Sharp" answering to `dime-pro-copy`.
 *
 * ORDER AND ATOMICITY: this repo has no cross-statement transaction helper here,
 * so the plan row is moved first and the referrers immediately after, in the
 * same logical operation. If the referrer update fails, the plan slug is rolled
 * back to `oldSlug` — the invariant being defended is "no app_users row ever
 * points at a slug that does not exist", and the old slug is known-good.
 *
 * `dryRun` reports what WOULD change (including the referrer count) and writes
 * nothing — that is what the admin previews before repairing a stale slug.
 *
 * The Stripe Product's `metadata.dime_plan_slug` is mirrored best-effort: the
 * database is the source of truth for entitlement, and a Stripe outage must not
 * abort a rename that has already been persisted.
 */
export async function syncPlanSlug(
  planId: number,
  opts?: { dryRun?: boolean }
): Promise<SlugSyncResult> {
  const dryRun = opts?.dryRun === true;
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const rows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1)
  )) as Array<{
    id: number;
    slug: string;
    name: string;
    stripeProductId: string | null;
  }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);

  const oldSlug = row.slug;
  // ownerPlanId = this plan: a desired slug already held by THIS row is the
  // status quo, not a collision, so a no-op save cannot append a suffix.
  const newSlug = await resolveUniqueSlug(row.name, getPlanBySlug, planId);

  if (newSlug === oldSlug) {
    console.log(
      `${TAG} slug sync plan=${planId} name="${row.name}" slug=${oldSlug} UNCHANGED`
    );
    return { changed: false, oldSlug, newSlug: oldSlug, referrersUpdated: 0 };
  }

  const countRows = (await withCircuitBreaker(async () =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(appUsers)
      .where(eq(appUsers.stripePlanId, oldSlug))
  )) as Array<{ n: number }>;
  const referrers = Number(countRows[0]?.n ?? 0);

  if (dryRun) {
    console.log(
      `${TAG} slug sync plan=${planId} DRY-RUN ${oldSlug} → ${newSlug} would move ${referrers} referrer(s)`
    );
    return { changed: true, oldSlug, newSlug, referrersUpdated: referrers };
  }

  await withCircuitBreaker(async () =>
    db
      .update(subscriptionPlans)
      .set({ slug: newSlug })
      .where(eq(subscriptionPlans.id, planId))
  );

  let referrersUpdated = 0;
  try {
    const res = await withCircuitBreaker(async () =>
      db
        .update(appUsers)
        .set({ stripePlanId: newSlug })
        .where(eq(appUsers.stripePlanId, oldSlug))
    );
    referrersUpdated = readAffectedRows(res) ?? referrers;
  } catch (err) {
    // Compensate: put the slug back so the referrers we failed to move still
    // resolve. A rename that half-applies is worse than one that did not happen.
    await withCircuitBreaker(async () =>
      db
        .update(subscriptionPlans)
        .set({ slug: oldSlug })
        .where(eq(subscriptionPlans.id, planId))
    );
    invalidatePlanCache();
    console.error(
      `${TAG} slug sync plan=${planId} ROLLED BACK ${newSlug} → ${oldSlug}: referrer update failed — ${(err as Error).message}`
    );
    throw err instanceof Error ? err : new Error(String(err));
  }

  invalidatePlanCache();

  if (row.stripeProductId) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, {
        metadata: { dime_plan_slug: newSlug },
      });
    } catch (err) {
      console.warn(
        `${TAG} slug sync: Stripe product metadata update failed (DB is authoritative) — ${(err as Error).message}`
      );
    }
  }

  console.log(
    `${TAG} slug sync plan=${planId} name="${row.name}" ${oldSlug} → ${newSlug} referrersUpdated=${referrersUpdated}`
  );
  return { changed: true, oldSlug, newSlug, referrersUpdated };
}

/** Edit plan metadata (name/description/maxSubscribers). Amount/interval are immutable — a new price is Phase 3. */
export async function updatePlanMeta(
  planId: number,
  patch: {
    name?: string;
    description?: string | null;
    maxSubscribers?: number | null;
  }
): Promise<{ slugSync: SlugSyncResult | null }> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1)
  )) as Array<{ stripeProductId: string | null }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);

  if (
    row.stripeProductId &&
    (patch.name !== undefined || patch.description !== undefined)
  ) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description ?? "" }
          : {}),
      });
    } catch (err) {
      console.warn(
        `${TAG} updateMeta: Stripe product update failed — ${(err as Error).message}`
      );
    }
  }
  await withCircuitBreaker(async () =>
    db
      .update(subscriptionPlans)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.maxSubscribers !== undefined
          ? { maxSubscribers: patch.maxSubscribers }
          : {}),
      })
      .where(eq(subscriptionPlans.id, planId))
  );
  invalidatePlanCache();

  // A rename must carry the slug — and therefore every app_users.stripePlanId
  // pointing at it — along with the name, or the plan keeps answering to the
  // slug of whatever it used to be called. Runs AFTER the name is persisted, so
  // the slug is derived from the name the plan now has. Self-collision is
  // excluded inside syncPlanSlug, so a save that does not actually change the
  // name writes nothing.
  let slugSync: SlugSyncResult | null = null;
  if (patch.name !== undefined) {
    slugSync = await syncPlanSlug(planId);
  }

  console.log(
    `${TAG} updated plan meta ${planId}${
      slugSync?.changed
        ? ` slug ${slugSync.oldSlug} → ${slugSync.newSlug} (${slugSync.referrersUpdated} referrer(s) moved)`
        : ""
    }`
  );
  return { slugSync };
}

/**
 * Replace a plan's feature set (all-or-nothing).
 *
 * Stored in the indexed `plan_features` join table rather than a JSON column so
 * feature membership stays queryable — "which plans include prop projections?"
 * is an indexed lookup instead of a LIKE over prose.
 *
 * Diff-based rather than delete-then-reinsert: re-saving a plan without touching
 * its features leaves the existing rows (and their ids) untouched, so `createdAt`
 * keeps meaning "when this feature was added to this plan". The UNIQUE index on
 * (planId, featureKey) makes the insert side idempotent even under a double
 * submit.
 *
 * Feature keys are Stripe-irrelevant — they describe entitlement copy, not
 * billing — so nothing is mirrored to the Stripe Product here.
 */
export async function setPlanFeatures(
  planId: number,
  features: readonly string[]
): Promise<PlanFeatureKey[]> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  // normalize drops unknown keys and enforces canonical order, so a malformed
  // request cannot persist a key the picker could never render.
  const desired = normalizePlanFeatures(features);

  const existingRows = (await withCircuitBreaker(async () =>
    db.select().from(planFeatures).where(eq(planFeatures.planId, planId))
  )) as Array<{ id: number; featureKey: string }>;
  const existing = new Set(existingRows.map(r => r.featureKey));
  const desiredSet = new Set<string>(desired);

  const toRemove = existingRows.filter(r => !desiredSet.has(r.featureKey));
  const toAdd = desired.filter(k => !existing.has(k));

  for (const row of toRemove) {
    await withCircuitBreaker(async () =>
      db.delete(planFeatures).where(eq(planFeatures.id, row.id))
    );
  }
  if (toAdd.length > 0) {
    const now = Date.now();
    await withCircuitBreaker(async () =>
      db.insert(planFeatures).values(
        toAdd.map(key => ({
          planId,
          featureKey: key,
          sortOrder: desired.indexOf(key),
          createdAt: now,
        }))
      )
    );
  }

  // Keep stored sortOrder aligned with canonical order for rows that survived,
  // so the admin list and the marketing surface agree on ordering.
  for (const row of existingRows) {
    if (!desiredSet.has(row.featureKey)) continue;
    const want = desired.indexOf(row.featureKey as PlanFeatureKey);
    await withCircuitBreaker(async () =>
      db
        .update(planFeatures)
        .set({ sortOrder: want })
        .where(eq(planFeatures.id, row.id))
    );
  }

  invalidatePlanCache();
  console.log(
    `${TAG} set features plan=${planId} added=${toAdd.length} removed=${toRemove.length} total=${desired.length}`
  );
  return desired;
}

/**
 * Duplicate a plan: re-provision a fresh Stripe Product + Prices from an existing
 * plan's active intervals and persist a brand-new plan (its own new slug/planID and
 * its own new price IDs) so the copy is fully independent of the original. Promo
 * discounts are recreated as fresh coupons; a shareable promo CODE is intentionally
 * dropped on the copy because a Stripe promotion-code string cannot be reused while
 * the original still holds it.
 */
export async function duplicatePlan(planId: number): Promise<{
  planId: number;
  slug: string;
  stripeProductId: string;
  stripePriceId: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const planRows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1)
  )) as Array<{
    name: string;
    description: string | null;
    planType: "recurring" | "one_time" | "fixed_date";
    maxSubscribers: number | null;
    autoRestock: boolean;
    availableQuantity: number | null;
    restockThreshold: number | null;
    restockAmount: number | null;
  }>;
  const plan = planRows[0];
  if (!plan) throw new Error(`plan ${planId} not found`);

  const priceRows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(planPrices)
      .where(eq(planPrices.planId, planId))
      .limit(1000)
  )) as Array<{
    amountCents: number;
    currency: string;
    interval: BillingInterval | null;
    intervalCount: number | null;
    label: string | null;
    trialPeriodDays: number | null;
    promoType: "percent" | "amount" | null;
    promoValue: number | null;
    hidden: boolean;
    active: boolean;
    sortOrder: number;
  }>;
  const active = priceRows
    .filter(r => r.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (active.length === 0)
    throw new Error(`plan ${planId} has no active intervals to duplicate`);

  const prices: NewPriceInput[] = active.map(r => ({
    amountCents: r.amountCents,
    currency: r.currency,
    interval: r.interval ?? undefined,
    intervalCount: r.intervalCount ?? undefined,
    label: r.label ?? undefined,
    trialPeriodDays: r.trialPeriodDays ?? undefined,
    promo:
      r.promoType && r.promoValue != null
        ? { type: r.promoType, value: r.promoValue }
        : null,
    hidden: r.hidden,
  }));

  const restock: RestockInput | null =
    plan.autoRestock || plan.availableQuantity != null
      ? {
          autoRestock: plan.autoRestock,
          availableQuantity: plan.availableQuantity,
          restockThreshold: plan.restockThreshold,
          restockAmount: plan.restockAmount,
        }
      : null;

  const result = await provisionPlan({
    name: `${plan.name} (Copy)`,
    description: plan.description ?? undefined,
    // fixed_date isn't created via this admin flow; treat any non-one_time as recurring.
    planType: plan.planType === "one_time" ? "one_time" : "recurring",
    prices,
    maxSubscribers: plan.maxSubscribers,
    restock,
  });
  // Carry the source plan's features onto the copy — a duplicate that silently
  // lost its feature list would look identical in Stripe but different on the
  // pricing page.
  try {
    const sourceFeatures = (await withCircuitBreaker(async () =>
      db.select().from(planFeatures).where(eq(planFeatures.planId, planId))
    )) as Array<{ featureKey: string; sortOrder: number }>;
    if (sourceFeatures.length > 0) {
      await setPlanFeatures(
        result.planId,
        sourceFeatures
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(f => f.featureKey)
      );
    }
  } catch (err) {
    console.warn(
      `${TAG} duplicate: feature copy failed — ${(err as Error).message}`
    );
  }
  console.log(
    `${TAG} duplicated plan ${planId} → ${result.slug} (planId=${result.planId})`
  );
  return result;
}

/**
 * Permanently delete a plan: remove its plan_prices rows and its subscription_plans
 * row, and deactivate the Stripe Product (Stripe Products that have Prices cannot be
 * hard-deleted, so the product is archived). Unlike archivePlan (reversible), this
 * erases the rows entirely — the plan disappears from the admin table.
 */
export async function deletePlan(planId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const rows = (await withCircuitBreaker(async () =>
    db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1)
  )) as Array<{ stripeProductId: string | null }>;
  const row = rows[0];
  if (!row) throw new Error(`plan ${planId} not found`);

  if (row.stripeProductId) {
    try {
      await getProvisioningStripe().products.update(row.stripeProductId, {
        active: false,
      });
    } catch (err) {
      console.warn(
        `${TAG} delete: Stripe product deactivate failed — ${(err as Error).message}`
      );
    }
  }
  await withCircuitBreaker(async () =>
    db.delete(planPrices).where(eq(planPrices.planId, planId))
  );
  // No FK cascades exist in this schema, so feature rows must be removed
  // explicitly or they orphan and resurface if the id is ever reused.
  await withCircuitBreaker(async () =>
    db.delete(planFeatures).where(eq(planFeatures.planId, planId))
  );
  await withCircuitBreaker(async () =>
    db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId))
  );
  invalidatePlanCache();
  console.log(
    `${TAG} deleted plan ${planId} (rows removed, Stripe product archived)`
  );
}
