/**
 * server/routers/stripe.ts
 *
 * tRPC router for Stripe payment operations.
 *
 * Procedures:
 *   stripe.createCheckoutSession       — creates a Stripe Checkout session (authenticated)
 *   stripe.publicCreateCheckoutSession — creates a Stripe Checkout session (unauthenticated)
 *   stripe.getSubscription             — returns the current user's subscription status
 *   stripe.createPortalSession         — creates a Stripe Customer Portal session
 *
 * Flow:
 *   - Unauthenticated user clicks "Click Here" → publicCreateCheckoutSession is called
 *     → Stripe Checkout page collects email + "Desired Username" custom field + payment
 *   - Authenticated user clicks "Click Here" → createCheckoutSession is called
 *     → email prefilled from account, "Desired Username" prefilled from username
 *
 * Credentials are read from process.env — never hardcoded.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, stripeProcedure } from "../_core/trpc";
import { stripeAppUserProcedure } from "./appUsers";
import { getStripe } from "../stripe/client";
import { PLANS, getPlanByPriceId, computeExpiryMs, type PlanId } from "../stripe/products";
import { getDb } from "../db";
import { appUsers } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const TAG = "[tRPC][stripe]";

// ─── Input validation ─────────────────────────────────────────────────────────

const zodPlanId = z.enum(["monthly", "annual"]);

// ─── Shared checkout session builder ─────────────────────────────────────────
// Used by both authenticated and unauthenticated procedures to avoid duplication.

interface BuildSessionParams {
  planId: PlanId;
  origin: string;
  /** Stripe Customer ID — pass if user already has one to unify billing history */
  stripeCustomerId?: string | null;
  /** Email to prefill on Stripe Checkout */
  prefillEmail?: string;
  /** Desired username — prefilled in the Stripe custom_fields text input */
  desiredUsername?: string;
  /** Internal user ID — stored in metadata for webhook fulfillment */
  userId?: number | null;
}

async function buildStripeCheckoutSession(params: BuildSessionParams) {
  const { planId, origin, stripeCustomerId, prefillEmail, desiredUsername, userId } = params;

  console.log(`${TAG}[buildStripeCheckoutSession] [INPUT] planId=${planId} origin=${origin} userId=${userId ?? "anon"} prefillEmail=${prefillEmail ?? "(none)"} desiredUsername=${desiredUsername ?? "(none)"} stripeCustomerId=${stripeCustomerId ?? "(none)"}`);

  // ── [STEP 1] Resolve plan definition ──────────────────────────────────────
  const plan = PLANS[planId];
  if (!plan) {
    console.error(`${TAG}[buildStripeCheckoutSession] [VERIFY] FAIL — unknown planId=${planId}`);
    throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown plan: ${planId}` });
  }

  // ── [STEP 2] Resolve Stripe Price ID ──────────────────────────────────────
  let priceId: string;
  try {
    priceId = plan.priceId();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG}[buildStripeCheckoutSession] [VERIFY] FAIL — priceId resolution error: ${msg}`);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Stripe price not configured. Contact support.",
    });
  }

  console.log(`${TAG}[buildStripeCheckoutSession] [STATE] plan=${plan.name} priceId=${priceId} amount=${plan.priceDisplay}`);

  // ── [STEP 3] Build success and cancel URLs ─────────────────────────────────
  const successUrl = `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`;
  const cancelUrl = `${origin}/#pricing`;
  console.log(`${TAG}[buildStripeCheckoutSession] [STATE] successUrl=${successUrl} cancelUrl=${cancelUrl}`);

  // ── [STEP 4] Resolve customer parameter ───────────────────────────────────
  // If the user has an existing Stripe Customer ID, reuse it so their payment
  // methods are pre-filled and billing history is unified.
  // Otherwise, pass customer_email so Stripe prefills the email field.
  let customerParam: { customer: string } | { customer_email: string } | Record<string, never> = {};

  if (stripeCustomerId) {
    console.log(`${TAG}[buildStripeCheckoutSession] [STATE] reusing existing stripeCustomerId=${stripeCustomerId}`);
    customerParam = { customer: stripeCustomerId };
  } else if (prefillEmail) {
    console.log(`${TAG}[buildStripeCheckoutSession] [STATE] prefilling customer_email=${prefillEmail}`);
    customerParam = { customer_email: prefillEmail };
  } else {
    console.log(`${TAG}[buildStripeCheckoutSession] [STATE] no email or customer — Stripe will collect email on checkout page`);
  }

  // ── [STEP 5] Create Stripe Checkout Session ────────────────────────────────
  const stripe = getStripe();

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      ...customerParam,
      // ── Payment methods ──────────────────────────────────────────────────
      // automatic_payment_methods lets Stripe show all eligible methods
      // (cards, Apple Pay, Google Pay, Affirm, Afterpay, Klarna, Link)
      // based on the customer's location and cart value.
      payment_method_collection: "if_required",
      // ── Metadata for webhook fulfillment ────────────────────────────────
      // These fields are available in checkout.session.completed webhook.
      client_reference_id: userId != null ? String(userId) : undefined,
      metadata: {
        ...(userId != null ? { user_id: String(userId) } : {}),
        plan_id: planId,
        desired_username: desiredUsername ?? "",
      },
      // ── Custom fields — collected on Stripe Checkout page ───────────────
      // Stripe renders these as form fields above the payment section.
      // "Desired Username" is required and prefilled if already known.
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
      // ── Subscription data ────────────────────────────────────────────────
      subscription_data: {
        metadata: {
          ...(userId != null ? { user_id: String(userId) } : {}),
          plan_id: planId,
        },
      },
      // ── UX ───────────────────────────────────────────────────────────────
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: "auto",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG}[buildStripeCheckoutSession] [VERIFY] FAIL — Stripe API error: ${msg}`);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create checkout session. Please try again.",
    });
  }

  // ── [STEP 6] Validate session ──────────────────────────────────────────────
  if (!session.url) {
    console.error(`${TAG}[buildStripeCheckoutSession] [VERIFY] FAIL — session.url is null session_id=${session.id}`);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Checkout session created but no URL returned.",
    });
  }

  console.log(`${TAG}[buildStripeCheckoutSession] [OUTPUT] session_id=${session.id} url=${session.url.substring(0, 60)}...`);
  console.log(`${TAG}[buildStripeCheckoutSession] [VERIFY] PASS — checkout session created successfully`);

  return { sessionId: session.id, url: session.url };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const stripeRouter = router({
  /**
   * publicCreateCheckoutSession
   *
   * Creates a Stripe Checkout session WITHOUT requiring authentication.
   * Used when an unauthenticated visitor clicks "Click Here" on the pricing section.
   *
   * Stripe Checkout collects:
   *   - Email (native Stripe field)
   *   - Desired Username (custom_fields text input)
   *   - Payment information (card / Apple Pay / Google Pay / Affirm / Klarna / etc.)
   *
   * No pre-checkout modal. No login redirect. Straight to Stripe.
   */
  publicCreateCheckoutSession: stripeProcedure
    .input(
      z.object({
        planId: zodPlanId,
        /** Frontend must pass window.location.origin for correct redirect URLs */
        origin: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      const { planId, origin } = input;
      console.log(`${TAG}[publicCreateCheckoutSession] [INPUT] planId=${planId} origin=${origin} userId=anon`);
      return buildStripeCheckoutSession({ planId, origin });
    }),

  /**
   * createCheckoutSession
   *
   * Creates a Stripe Checkout session for an authenticated app user.
   * Email and username are prefilled from the user's account.
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
  createCheckoutSession: stripeAppUserProcedure
    .input(
      z.object({
        planId: zodPlanId,
        /** Frontend must pass window.location.origin for correct redirect URLs */
        origin: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { planId, origin } = input;
      const user = ctx.appUser;

      console.log(`${TAG}[createCheckoutSession] [INPUT] userId=${user.id} email=${user.email} planId=${planId} origin=${origin}`);

      return buildStripeCheckoutSession({
        planId,
        origin,
        stripeCustomerId: user.stripeCustomerId,
        prefillEmail: user.email ?? undefined,
        desiredUsername: user.username ?? undefined,
        userId: user.id,
      });
    }),

  /**
   * getSubscription
   *
   * Returns the current user's subscription status from the local DB.
   * Does NOT call the Stripe API — reads from app_users columns.
   */
  getSubscription: stripeAppUserProcedure.query(async ({ ctx }) => {
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
  createPortalSession: stripeAppUserProcedure
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
