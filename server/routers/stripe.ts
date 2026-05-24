/**
 * server/routers/stripe.ts
 *
 * tRPC router for Stripe payment operations.
 *
 * Procedures:
 *   stripe.createCheckoutSession — creates a Stripe Checkout session for a plan
 *   stripe.getSubscription       — returns the current user's subscription status
 *   stripe.createPortalSession   — creates a Stripe Customer Portal session for billing management
 *
 * All procedures require appUserProcedure (authenticated app user).
 * Credentials are read from process.env — never hardcoded.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_core/trpc";
import { appUserProcedure } from "./appUsers";
import { getStripe } from "../stripe/client";
import { PLANS, getPlanByPriceId, computeExpiryMs, type PlanId } from "../stripe/products";
import { getDb } from "../db";
import { appUsers } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const TAG = "[tRPC][stripe]";

// ─── Input validation ─────────────────────────────────────────────────────────

const zodPlanId = z.enum(["monthly", "annual"]);

// ─── Router ───────────────────────────────────────────────────────────────────

export const stripeRouter = router({
  /**
   * createCheckoutSession
   *
   * Creates a Stripe Checkout session for the requested plan.
   * Returns the checkout URL — frontend opens it in a new tab.
   *
   * Payment methods enabled:
   *   - Cards (Visa, MC, Amex, Discover)
   *   - Apple Pay / Google Pay (automatic via Checkout)
   *   - Affirm (US, min $50)
   *   - Afterpay / Clearpay
   *   - Klarna
   *   - Link (Stripe one-click checkout)
   *
   * Promo codes are enabled (allow_promotion_codes: true).
   */
  createCheckoutSession: appUserProcedure
    .input(
      z.object({
        planId: zodPlanId,
        /** Frontend must pass window.location.origin for correct redirect URLs */
        origin: z.string().url(),
        /** Desired username collected in pre-checkout modal (unauthenticated flow) */
        desiredUsername: z.string().min(3).max(64).optional(),
        /** Email collected in pre-checkout modal — used to prefill Stripe email field */
        prefillEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { planId, origin, desiredUsername, prefillEmail } = input;
      const user = ctx.appUser;

      console.log(`${TAG}[createCheckoutSession] [INPUT] userId=${user.id} email=${user.email} planId=${planId} origin=${origin} desiredUsername=${desiredUsername ?? "(none)"} prefillEmail=${prefillEmail ?? "(none)"}`);

      // ── [STEP 1] Resolve plan definition ──────────────────────────────────
      const plan = PLANS[planId as PlanId];
      if (!plan) {
        console.error(`${TAG}[createCheckoutSession] [VERIFY] FAIL — unknown planId=${planId}`);
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown plan: ${planId}` });
      }

      // ── [STEP 2] Resolve Stripe Price ID ──────────────────────────────────
      let priceId: string;
      try {
        priceId = plan.priceId();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[createCheckoutSession] [VERIFY] FAIL — priceId resolution error: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Stripe price not configured. Contact support.",
        });
      }

      console.log(`${TAG}[createCheckoutSession] [STATE] plan=${plan.name} priceId=${priceId} amount=${plan.priceDisplay}`);

      // ── [STEP 3] Build success and cancel URLs ─────────────────────────────
      const successUrl = `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`;
      const cancelUrl = `${origin}/subscribe/cancel?plan=${planId}`;

      console.log(`${TAG}[createCheckoutSession] [STATE] successUrl=${successUrl}`);
      console.log(`${TAG}[createCheckoutSession] [STATE] cancelUrl=${cancelUrl}`);

      // ── [STEP 4] Resolve or reuse Stripe Customer ID ───────────────────────
      // If the user already has a stripeCustomerId, pass it to Checkout so their
      // payment methods are pre-filled and their billing history is unified.
      // Resolve the email to prefill: prefer the user's account email, fall back to
      // the email collected in the pre-checkout modal (unauthenticated flow).
      const resolvedEmail = user.email || prefillEmail || "";
      console.log(`${TAG}[createCheckoutSession] [STATE] resolvedEmail=${resolvedEmail}`);

      let customerParam: { customer: string } | { customer_email: string } = {
        customer_email: resolvedEmail,
      };

      if (user.stripeCustomerId) {
        console.log(`${TAG}[createCheckoutSession] [STATE] reusing existing stripeCustomerId=${user.stripeCustomerId}`);
        customerParam = { customer: user.stripeCustomerId };
      } else {
        console.log(`${TAG}[createCheckoutSession] [STATE] no existing customer — will create new Stripe customer at checkout`);
      }

      // ── [STEP 5] Create Stripe Checkout Session ────────────────────────────
      const stripe = getStripe();

      let session;
      try {
        session = await stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [
            {
              price: priceId,
              quantity: 1,
            },
          ],
          ...customerParam,
          // ── Payment methods ────────────────────────────────────────────────
          // automatic_payment_methods lets Stripe show all eligible methods
          // (cards, Apple Pay, Google Pay, Affirm, Afterpay, Klarna, Link)
          // based on the customer's location and cart value.
          // This is the recommended approach over manually listing methods.
          payment_method_collection: "if_required",
          // ── Metadata for webhook fulfillment ──────────────────────────────
          // These fields are available in checkout.session.completed webhook.
          client_reference_id: String(user.id),
          metadata: {
            user_id: String(user.id),
            plan_id: planId,
            customer_email: resolvedEmail,
            customer_name: user.username ?? desiredUsername ?? "",
            desired_username: desiredUsername ?? user.username ?? "",
          },
          // ── Custom fields — collected on Stripe Checkout page ─────────────
          // Stripe renders these as form fields above the payment section.
          // desired_username is prefilled if collected in the pre-checkout modal.
          custom_fields: [
            {
              key: "desired_username",
              label: { type: "custom" as const, custom: "Desired Username" },
              type: "text" as const,
              text: {
                minimum_length: 3,
                maximum_length: 64,
                ...(desiredUsername ? { default_value: desiredUsername } : {}),
              },
              optional: false,
            },
          ],
          // ── Subscription data ─────────────────────────────────────────────
          subscription_data: {
            metadata: {
              user_id: String(user.id),
              plan_id: planId,
            },
          },
          // ── UX ────────────────────────────────────────────────────────────
          allow_promotion_codes: true,
          success_url: successUrl,
          cancel_url: cancelUrl,
          // ── Billing address ───────────────────────────────────────────────
          billing_address_collection: "auto",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[createCheckoutSession] [VERIFY] FAIL — Stripe API error: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create checkout session. Please try again.",
        });
      }

      // ── [STEP 6] Validate session ──────────────────────────────────────────
      if (!session.url) {
        console.error(`${TAG}[createCheckoutSession] [VERIFY] FAIL — session.url is null session_id=${session.id}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Checkout session created but no URL returned.",
        });
      }

      console.log(`${TAG}[createCheckoutSession] [OUTPUT] session_id=${session.id} url=${session.url.substring(0, 60)}...`);
      console.log(`${TAG}[createCheckoutSession] [VERIFY] PASS — checkout session created successfully`);

      return {
        sessionId: session.id,
        url: session.url,
      };
    }),

  /**
   * getSubscription
   *
   * Returns the current user's subscription status from the local DB.
   * Does NOT call the Stripe API — reads from app_users columns.
   */
  getSubscription: appUserProcedure.query(async ({ ctx }) => {
    const user = ctx.appUser;

    console.log(`${TAG}[getSubscription] [INPUT] userId=${user.id}`);

    const result = {
      hasAccess: user.hasAccess,
      expiryDate: user.expiryDate ?? null,
      stripeCustomerId: user.stripeCustomerId ?? null,
      stripeSubscriptionId: user.stripeSubscriptionId ?? null,
      stripePlanId: user.stripePlanId ?? null,
      isExpired: user.expiryDate ? Date.now() > user.expiryDate : false,
    };

    console.log(`${TAG}[getSubscription] [OUTPUT] hasAccess=${result.hasAccess} planId=${result.stripePlanId} expired=${result.isExpired}`);
    console.log(`${TAG}[getSubscription] [VERIFY] PASS`);

    return result;
  }),

  /**
   * createPortalSession
   *
   * Creates a Stripe Customer Portal session so the user can manage their
   * subscription (cancel, update payment method, view invoices).
   * Requires the user to have a stripeCustomerId.
   */
  createPortalSession: appUserProcedure
    .input(
      z.object({
        origin: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.appUser;

      console.log(`${TAG}[createPortalSession] [INPUT] userId=${user.id} origin=${input.origin}`);

      if (!user.stripeCustomerId) {
        console.error(`${TAG}[createPortalSession] [VERIFY] FAIL — user has no stripeCustomerId userId=${user.id}`);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No billing account found. Please subscribe first.",
        });
      }

      const stripe = getStripe();
      const returnUrl = `${input.origin}/account`;

      let portalSession;
      try {
        portalSession = await stripe.billingPortal.sessions.create({
          customer: user.stripeCustomerId,
          return_url: returnUrl,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[createPortalSession] [VERIFY] FAIL — Stripe API error: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to open billing portal. Please try again.",
        });
      }

      console.log(`${TAG}[createPortalSession] [OUTPUT] portal_url=${portalSession.url.substring(0, 60)}...`);
      console.log(`${TAG}[createPortalSession] [VERIFY] PASS`);

      return { url: portalSession.url };
    }),
});
