/**
 * subscriptionPlans.ts — owner-only tRPC router for the DB-backed plan catalog.
 *
 * Every procedure is ownerProcedure (only @prez reaches it). Mutations provision
 * real Stripe objects via server/stripe/planProvisioning.ts (test-key aware) and
 * persist them; queries read the cached catalog. This is the API behind the
 * admin "Subscription Plans" dashboard.
 */
import { z } from "zod";
import { isPlanFeatureKey, PLAN_FEATURE_KEYS } from "../../shared/planFeatures";
import { TRPCError } from "@trpc/server";
import { sql, and, eq, isNotNull } from "drizzle-orm";
import { ownerProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import { getDb } from "../db";
import { withCircuitBreaker } from "../dbCircuitBreaker";
import { appUsers } from "../../drizzle/schema";
import { listAllPlans, getPlanBySlug, defaultPriceForMode } from "../stripe/planStore";
import {
  provisionPlan,
  addPriceToPlan,
  removePriceFromPlan,
  reorderPlanIntervals,
  setIntervalHidden,
  setIntervalDefault,
  repriceInterval,
  updateRestockConfig,
  archivePlan,
  unarchivePlan,
  updatePlanMeta,
  syncPlanSlug,
  duplicatePlan,
  deletePlan,
  isProvisioningTestMode,
  getProvisioningStripe,
  setPlanFeatures,
} from "../stripe/planProvisioning";
import { backfillStaticPlans } from "../stripe/backfillPlans";

/** Count of subscribers (hasAccess) per plan slug — for the admin plan cards. */
async function countSubscribersByPlan(): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  try {
    const rows = (await withCircuitBreaker(async () =>
      db
        .select({ plan: appUsers.stripePlanId, n: sql<number>`count(*)` })
        .from(appUsers)
        .where(and(eq(appUsers.hasAccess, true), isNotNull(appUsers.stripePlanId)))
        .groupBy(appUsers.stripePlanId),
    )) as Array<{ plan: string | null; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) if (r.plan) out[r.plan] = Number(r.n);
    return out;
  } catch (err) {
    console.warn(`[tRPC][subscriptionPlans] subscriber count failed: ${(err as Error).message}`);
    return {};
  }
}

const intervalEnum = z.enum(["day", "week", "month", "year"]);

const promoSchema = z
  .object({
    type: z.enum(["percent", "amount"]),
    value: z.number().int().min(1),
    code: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, "code: letters, numbers, - or _ only")
      .optional(),
  })
  .refine((p) => p.type !== "percent" || p.value <= 100, {
    message: "percent promo must be 1–100",
  });

const priceSchema = z.object({
  amountCents: z.number().int().min(50),
  currency: z.string().min(3).max(8).optional(),
  // Interval is required for recurring plans; omitted for one_time (single payment).
  interval: intervalEnum.optional(),
  intervalCount: z.number().int().min(1).max(365).optional(),
  label: z.string().max(80).optional(),
  trialPeriodDays: z.number().int().min(0).max(365).optional(),
  promo: promoSchema.nullable().optional(),
  hidden: z.boolean().optional(),
});

/**
 * Editing ONE existing interval. Reuses `priceSchema.shape` so the create form
 * and the edit dialog can never drift into two different validators; the three
 * overrides exist because the edit dialog sends the interval's FULL desired
 * state, so it needs an explicit `null` ("Lifetime" / no label / no trial) where
 * the create form expresses the same thing by omission.
 */
const intervalUpdateSchema = z.object({
  ...priceSchema.shape,
  priceId: z.number().int().positive(),
  interval: intervalEnum.nullable().optional(),
  label: z.string().max(80).nullable().optional(),
  trialPeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const restockSchema = z.object({
  autoRestock: z.boolean(),
  availableQuantity: z.number().int().min(0).nullable(),
  restockThreshold: z.number().int().min(0).nullable(),
  restockAmount: z.number().int().min(1).nullable(),
});

/**
 * Feature keys are validated against the shared catalog rather than accepted as
 * free strings, so a typo cannot persist a key the admin picker can never render.
 */
const planFeaturesSchema = z
  .array(z.string().refine(isPlanFeatureKey, { message: "unknown feature key" }))
  .max(PLAN_FEATURE_KEYS.length);

const newPlanSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  planType: z.enum(["recurring", "one_time"]).optional(),
  // One or more intervals (variants); the first visible one is the default price.
  prices: z.array(priceSchema).min(1).max(12),
  maxSubscribers: z.number().int().min(1).nullable().optional(),
  restock: restockSchema.nullable().optional(),
  features: planFeaturesSchema.optional(),
});

export const subscriptionPlansRouter = router({
  /** Whether provisioning writes to a Stripe TEST/sandbox account (UI badge). */
  testMode: ownerProcedure.query(async () => ({ testMode: isProvisioningTestMode() })),

  /** All plans (incl. archived) with prices + subscriber counts, for the cards. */
  list: ownerProcedure.query(async () => {
    const [plans, counts] = await Promise.all([listAllPlans(), countSubscribersByPlan()]);
    return plans.map((p) => ({ ...p, subscriberCount: counts[p.slug] ?? 0 }));
  }),

  /** Create a plan → provisions a Stripe Product + N recurring Prices, persists them. */
  create: ownerProcedure.input(newPlanSchema).mutation(async ({ input }) => {
    const tag = "[tRPC][subscriptionPlans.create]";
    console.log(`${tag} [INPUT] name="${input.name}" intervals=${input.prices.length} restock=${input.restock?.autoRestock ?? false}`);
    const { features, ...planInput } = input;
    const result = await provisionPlan(planInput);
    if (features && features.length > 0) {
      await setPlanFeatures(result.planId, features);
    }
    console.log(`${tag} [OUTPUT] slug=${result.slug} product=${result.stripeProductId} default=${result.stripePriceId} features=${features?.length ?? 0}`);
    return result;
  }),

  /** Add one interval (billing variant) to an existing plan. */
  addInterval: ownerProcedure
    .input(z.object({ planId: z.number().int().positive(), price: priceSchema }))
    .mutation(async ({ input }) => {
      const r = await addPriceToPlan(input.planId, input.price);
      return { ok: true, priceId: r.priceId };
    }),

  /** Remove (deactivate) one interval; refuses to remove a plan's last one. */
  removeInterval: ownerProcedure
    .input(z.object({ priceId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await removePriceFromPlan(input.priceId);
      return { ok: true };
    }),

  /** Reorder a plan's intervals (drag-to-reorder ⠿). */
  reorderIntervals: ownerProcedure
    .input(
      z.object({
        planId: z.number().int().positive(),
        orderedPriceIds: z.array(z.number().int().positive()).min(1).max(24),
      }),
    )
    .mutation(async ({ input }) => {
      await reorderPlanIntervals(input.planId, input.orderedPriceIds);
      return { ok: true };
    }),

  /** Show/hide one interval (eyeball). Hidden intervals are never sold. */
  setIntervalHidden: ownerProcedure
    .input(z.object({ priceId: z.number().int().positive(), hidden: z.boolean() }))
    .mutation(async ({ input }) => {
      await setIntervalHidden(input.priceId, input.hidden);
      return { ok: true };
    }),

  /** Update a plan's auto-restock / limited-quantity FOMO configuration. */
  updateRestock: ownerProcedure
    .input(z.object({ planId: z.number().int().positive(), restock: restockSchema }))
    .mutation(async ({ input }) => {
      await updateRestockConfig(input.planId, input.restock);
      return { ok: true };
    }),

  /** Edit plan metadata (name/description/maxSubscribers). Price is immutable. */
  updateMeta: ownerProcedure
    .input(
      z.object({
        planId: z.number().int().positive(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        maxSubscribers: z.number().int().min(1).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { planId, ...patch } = input;
      // A name change re-derives the slug and repoints every app_users referrer
      // inside updatePlanMeta; report what moved rather than a bare ok.
      const { slugSync } = await updatePlanMeta(planId, patch);
      return { ok: true, slugSync };
    }),

  /**
   * Edit an existing plan from the admin Edit dialog: metadata + restock +
   * features in one call, so a single Save cannot half-apply.
   *
   * `restock` omitted = leave the config alone; `restock: null` = clear it
   * (auto-restock off, no limited quantity).
   *
   * Prices are deliberately NOT edited here — Stripe Prices are immutable once
   * created, so changing an amount means minting a new Price and retiring the
   * old one. That is `updateInterval` (below), kept as its own mutation so a
   * metadata save can never mint Stripe objects as a side effect.
   */
  update: ownerProcedure
    .input(
      z.object({
        planId: z.number().int().positive(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        maxSubscribers: z.number().int().min(1).nullable().optional(),
        restock: restockSchema.nullable().optional(),
        features: planFeaturesSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const tag = "[tRPC][subscriptionPlans.update]";
      const { planId, features, restock, ...patch } = input;
      console.log(`${tag} [INPUT] planId=${planId} fields=${Object.keys(patch).join(",") || "(none)"} restock=${restock === undefined ? "unchanged" : restock === null ? "cleared" : `auto=${restock.autoRestock} qty=${restock.availableQuantity}`} features=${features ? features.length : "unchanged"}`);
      let slugSync: Awaited<ReturnType<typeof updatePlanMeta>>["slugSync"] = null;
      if (Object.keys(patch).length > 0) {
        ({ slugSync } = await updatePlanMeta(planId, patch));
      }
      if (restock !== undefined) {
        await updateRestockConfig(
          planId,
          restock ?? { autoRestock: false, availableQuantity: null, restockThreshold: null, restockAmount: null },
        );
      }
      const applied = features !== undefined ? await setPlanFeatures(planId, features) : undefined;
      console.log(
        `${tag} [OUTPUT] planId=${planId} restock=${restock === undefined ? "unchanged" : "applied"} features=${applied ? applied.join("|") : "unchanged"} slug=${
          slugSync?.changed
            ? `${slugSync.oldSlug} → ${slugSync.newSlug} (${slugSync.referrersUpdated} app_users referrer(s) repointed)`
            : "unchanged"
        }`,
      );
      console.log(`${tag} [VERIFY] PASS`);
      return { ok: true as const, planId, features: applied, slugSync };
    }),

  /**
   * Edit ONE interval of a plan — the price side of the Edit dialog.
   *
   * Stripe Prices are immutable: only `nickname`, `active`, `metadata` and
   * `lookup_key` can be changed on a live Price. So a label/hidden-only edit is
   * applied in place (`changed:false`, no Stripe Price created), while any change
   * to amount / currency / interval / intervalCount / trial / promo mints a NEW
   * Stripe Price on the same Product and retires the old one — in that order, so
   * a Stripe failure leaves the plan sellable.
   *
   * Existing subscriptions keep billing at the OLD price until explicitly
   * migrated; archiving a Price does not re-rate or cancel them.
   */
  updateInterval: ownerProcedure.input(intervalUpdateSchema).mutation(async ({ input }) => {
    const tag = "[tRPC][subscriptionPlans.updateInterval]";
    const { priceId, isDefault, interval, label, trialPeriodDays, ...rest } = input;
    console.log(
      `${tag} [INPUT] priceId=${priceId} amount=${rest.amountCents}c currency=${rest.currency ?? "usd"} interval=${interval ?? "once"}x${rest.intervalCount ?? 1} trial=${trialPeriodDays ?? 0}d label="${label ?? ""}" hidden=${rest.hidden ?? "carry"} promo=${rest.promo ? `${rest.promo.type}:${rest.promo.value}` : "none"} isDefault=${isDefault ?? "unchanged"}`,
    );
    const result = await repriceInterval(priceId, {
      ...rest,
      // null (an explicit "Lifetime" / cleared field) and undefined mean the same
      // thing to the provisioning layer, which takes the interval's full state.
      interval: interval ?? undefined,
      label: label ?? undefined,
      trialPeriodDays: trialPeriodDays ?? undefined,
    });
    // Only `isDefault: true` is actionable — a plan must always have exactly one
    // default, so "unset" is expressed by making a DIFFERENT interval the default.
    // A missing row id is warned about rather than thrown: the reprice already
    // succeeded, and a hard failure here would invite a retry that mints a
    // SECOND Stripe Price for the same edit.
    if (isDefault) {
      if (result.newPriceRowId > 0) {
        await setIntervalDefault(result.newPriceRowId);
      } else {
        console.warn(`${tag} default flag skipped — no row id returned for the replacement price`);
      }
    }
    console.log(
      `${tag} [OUTPUT] priceId=${priceId} ${
        result.changed
          ? `MINTED new Stripe Price ${result.newStripePriceId} (row ${result.newPriceRowId}); old interval archived, existing subscribers keep the OLD amount`
          : `NO new Stripe Price — presentation-only edit applied in place on ${result.newStripePriceId}`
      } default=${isDefault ? "set" : result.carriedDefault ? "carried" : "no"}`,
    );
    console.log(`${tag} [VERIFY] PASS`);
    return {
      ok: true as const,
      changed: result.changed,
      newPriceRowId: result.newPriceRowId,
      newStripePriceId: result.newStripePriceId,
    };
  }),

  /**
   * Repair a stale slug: re-derive it from the plan's CURRENT name and move
   * every referrer with it.
   *
   * `updateMeta`/`update` already do this on every rename. This procedure exists
   * for the plans that were renamed BEFORE that wiring landed and are still
   * answering to their old slug ("Dime Sharp" on `dime-pro-copy`), and it is the
   * only safe way to move one: `subscription_plans.slug` is an FK-by-value target
   * — `app_users.stripePlanId` holds the string and checkout resolves by it — so
   * editing the slug directly in the database would strand every subscriber.
   *
   * `dryRun: true` previews the rename and the referrer count without writing.
   */
  syncSlug: ownerProcedure
    .input(z.object({ planId: z.number().int().positive(), dryRun: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const tag = "[tRPC][subscriptionPlans.syncSlug]";
      console.log(`${tag} [INPUT] planId=${input.planId} dryRun=${input.dryRun ?? false}`);
      const result = await syncPlanSlug(input.planId, { dryRun: input.dryRun });
      console.log(
        `${tag} [OUTPUT] planId=${input.planId} ${
          result.changed
            ? `${input.dryRun ? "WOULD MOVE" : "MOVED"} ${result.oldSlug} → ${result.newSlug}, ${result.referrersUpdated} app_users referrer(s) ${input.dryRun ? "would be" : ""} repointed`
            : `UNCHANGED slug=${result.oldSlug} already matches the plan name; 0 referrers touched`
        }`,
      );
      console.log(`${tag} [VERIFY] PASS`);
      return result;
    }),

  /** Archive a plan — deactivates its Stripe Product + marks the row inactive. */
  archive: ownerProcedure
    .input(z.object({ planId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await archivePlan(input.planId);
      return { ok: true };
    }),

  /** Unarchive a plan — reactivates its Stripe Product + marks the row active. */
  unarchive: ownerProcedure
    .input(z.object({ planId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await unarchivePlan(input.planId);
      return { ok: true };
    }),

  /** Duplicate a plan — new Stripe Product + Prices, a fresh independent copy. */
  duplicate: ownerProcedure
    .input(z.object({ planId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const result = await duplicatePlan(input.planId);
      return { ok: true, ...result };
    }),

  /** Permanently delete a plan — removes its rows and archives the Stripe Product. */
  delete: ownerProcedure
    .input(z.object({ planId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await deletePlan(input.planId);
      return { ok: true };
    }),

  /** One-shot idempotent import of the 5 legacy static plans into the catalog. */
  backfill: ownerProcedure.mutation(async () => backfillStaticPlans()),

  /**
   * Owner-only TEST checkout for a sandbox plan (Phase 2.5). Creates a Stripe
   * TEST-mode hosted Checkout Session (via STRIPE_TEST_SECRET_KEY) for the plan's
   * test price and returns its URL, so the owner can run the full subscribe flow
   * with a Stripe test card before publishing live plans. This never touches live
   * checkout, and being ownerProcedure it is not a public purchase path.
   */
  createTestCheckoutSession: ownerProcedure
    .input(z.object({ slug: z.string().min(1).max(64), origin: z.string().url() }))
    .mutation(async ({ input }) => {
      if (!isProvisioningTestMode()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Test mode not configured — set STRIPE_TEST_SECRET_KEY on this service.",
        });
      }
      const plan = await getPlanBySlug(input.slug);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found." });
      const price = defaultPriceForMode(plan, false);
      if (!price) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This plan has no test-mode price — create a sandbox plan to test.",
        });
      }

      const stripe = getProvisioningStripe(); // the TEST client (test key is set)
      // A price with no cadence (one-time / "Lifetime") checks out as a single
      // payment; a recurring price as a subscription.
      const isRecurring = price.interval != null;
      const session = await stripe.checkout.sessions.create({
        mode: isRecurring ? "subscription" : "payment",
        line_items: [{ price: price.stripePriceId, quantity: 1 }],
        metadata: { plan_id: plan.slug, price_id: price.stripePriceId, dime_test: "1" },
        ...(isRecurring ? { subscription_data: { metadata: { plan_id: plan.slug } } } : {}),
        success_url: `${input.origin}/admin/plans?test=success`,
        cancel_url: `${input.origin}/admin/plans?test=cancel`,
      });
      if (!session.url) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe did not return a checkout URL." });
      }
      console.log(`[tRPC][subscriptionPlans.createTestCheckoutSession] slug=${plan.slug} price=${price.stripePriceId} session=${session.id}`);
      return { url: session.url };
    }),
});
