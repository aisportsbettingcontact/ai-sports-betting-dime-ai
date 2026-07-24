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
import { ownerProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import { listAllPlans, getPlanBySlug, defaultPriceForMode } from "../stripe/planStore";
import {
  provisionPlan,
  addPriceToPlan,
  removePriceFromPlan,
  updateRestockConfig,
  archivePlan,
  updatePlanMeta,
  isProvisioningTestMode,
  getProvisioningStripe,
} from "../stripe/planProvisioning";
import { backfillStaticPlans } from "../stripe/backfillPlans";

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
  interval: intervalEnum,
  intervalCount: z.number().int().min(1).max(365),
  label: z.string().max(80).optional(),
  trialPeriodDays: z.number().int().min(0).max(365).optional(),
  promo: promoSchema.nullable().optional(),
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
  // One or more billing intervals (variants); the first is the default price.
  prices: z.array(priceSchema).min(1).max(12),
  maxSubscribers: z.number().int().min(1).nullable().optional(),
  restock: restockSchema.nullable().optional(),
});

export const subscriptionPlansRouter = router({
  /** Whether provisioning writes to a Stripe TEST/sandbox account (UI badge). */
  testMode: ownerProcedure.query(async () => ({ testMode: isProvisioningTestMode() })),

  /** All plans (incl. archived) with their prices, for the admin table. */
  list: ownerProcedure.query(async () => listAllPlans()),

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
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: price.stripePriceId, quantity: 1 }],
        metadata: { plan_id: plan.slug, dime_test: "1" },
        subscription_data: { metadata: { plan_id: plan.slug } },
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
