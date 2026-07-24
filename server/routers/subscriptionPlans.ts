/**
 * subscriptionPlans.ts — owner-only tRPC router for the DB-backed plan catalog.
 *
 * Every procedure is ownerProcedure (only @prez reaches it). Mutations provision
 * real Stripe objects via server/stripe/planProvisioning.ts (test-key aware) and
 * persist them; queries read the cached catalog. This is the API behind the
 * admin "Subscription Plans" dashboard.
 */
import { z } from "zod";
import { ownerProcedure } from "./appUsers";
import { router } from "../_core/trpc";
import { listAllPlans } from "../stripe/planStore";
import {
  provisionPlan,
  archivePlan,
  updatePlanMeta,
  isProvisioningTestMode,
} from "../stripe/planProvisioning";
import { backfillStaticPlans } from "../stripe/backfillPlans";

const intervalEnum = z.enum(["day", "week", "month", "year"]);

const newPlanSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  price: z.object({
    amountCents: z.number().int().min(50),
    currency: z.string().min(3).max(8).optional(),
    interval: intervalEnum,
    intervalCount: z.number().int().min(1).max(365),
    label: z.string().max(80).optional(),
    trialPeriodDays: z.number().int().min(0).max(365).optional(),
  }),
  maxSubscribers: z.number().int().min(1).nullable().optional(),
});

export const subscriptionPlansRouter = router({
  /** Whether provisioning writes to a Stripe TEST/sandbox account (UI badge). */
  testMode: ownerProcedure.query(async () => ({ testMode: isProvisioningTestMode() })),

  /** All plans (incl. archived) with their prices, for the admin table. */
  list: ownerProcedure.query(async () => listAllPlans()),

  /** Create a plan → provisions a Stripe Product + recurring Price, persists them. */
  create: ownerProcedure.input(newPlanSchema).mutation(async ({ input }) => {
    const tag = "[tRPC][subscriptionPlans.create]";
    console.log(`${tag} [INPUT] name="${input.name}" amount=${input.price.amountCents} ${input.price.interval}x${input.price.intervalCount}`);
    const result = await provisionPlan(input);
    console.log(`${tag} [OUTPUT] slug=${result.slug} product=${result.stripeProductId} price=${result.stripePriceId}`);
    return result;
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
});
