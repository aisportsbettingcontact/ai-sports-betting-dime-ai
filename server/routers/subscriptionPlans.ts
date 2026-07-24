/**
 * subscriptionPlans.ts — owner-only tRPC router for the DB-backed plan catalog.
 *
 * Every procedure is ownerProcedure (only @prez reaches it). Mutations provision
 * real Stripe objects via server/stripe/planProvisioning.ts (test-key aware) and
 * persist them; queries read the cached catalog. This is the API behind the
 * admin "Subscription Plans" dashboard.
 */
import { z } from "zod";
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
  updateRestockConfig,
  archivePlan,
  unarchivePlan,
  updatePlanMeta,
  duplicatePlan,
  deletePlan,
  isProvisioningTestMode,
  getProvisioningStripe,
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

const restockSchema = z.object({
  autoRestock: z.boolean(),
  availableQuantity: z.number().int().min(0).nullable(),
  restockThreshold: z.number().int().min(0).nullable(),
  restockAmount: z.number().int().min(1).nullable(),
});

const newPlanSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  planType: z.enum(["recurring", "one_time"]).optional(),
  // One or more intervals (variants); the first visible one is the default price.
  prices: z.array(priceSchema).min(1).max(12),
  maxSubscribers: z.number().int().min(1).nullable().optional(),
  restock: restockSchema.nullable().optional(),
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
    const result = await provisionPlan(input);
    console.log(`${tag} [OUTPUT] slug=${result.slug} product=${result.stripeProductId} default=${result.stripePriceId}`);
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
      await updatePlanMeta(planId, patch);
      return { ok: true };
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
