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
import { getDb, invalidateAppUserByIdCache, updateAppUser } from "../db";
import { appUsers } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { syncDiscordRoleForUser } from "../discord/discordRoleSync";
import { invalidateCachedAppUser } from "../dbCircuitBreaker";
import { signAppUserToken, APP_USER_COOKIE } from "./appUsers";
import { getSessionCookieOptions } from "../_core/cookies";

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
      // description is shown on the Stripe Checkout page and in Stripe-generated
      // customer emails, providing explicit auto-renewal disclosure.
      subscription_data: {
        description: planId === 'annual'
          ? 'AI Sports Betting Models — Annual Plan ($499.99/year). Auto-renews annually at $499.99 until cancelled. Cancel anytime before renewal.'
          : planId === 'monthly'
          ? 'AI Sports Betting Models — Monthly Plan ($99.99/month). Auto-renews monthly at $99.99 until cancelled. Cancel anytime before renewal.'
          : 'AI Sports Betting Models — Test Plan ($1.00/month). Auto-renews monthly.',
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

  /**
   * getCheckoutSessionUser
   * Looks up the pending user account created by a Stripe checkout session.
   * Called by SubscribeSuccess page after redirect from Stripe.
   */
  getCheckoutSessionUser: stripeProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) => {
      console.log(`${TAG}[getCheckoutSessionUser] [INPUT] sessionId=${input.sessionId}`);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db.select({
        id: appUsers.id,
        username: appUsers.username,
        email: appUsers.email,
        pendingSetup: appUsers.pendingSetup,
        pendingEmail: appUsers.pendingEmail,
        pendingUsername: appUsers.pendingUsername,
        hasAccess: appUsers.hasAccess,
        stripePlanId: appUsers.stripePlanId,
        expiryDate: appUsers.expiryDate,
      }).from(appUsers).where(eq(appUsers.pendingStripeSessionId, input.sessionId)).limit(1);

      if (!rows.length) {
        console.warn(`${TAG}[getCheckoutSessionUser] [STATE] No user found for sessionId=${input.sessionId}`);
        return null;
      }

      const user = rows[0];
      console.log(`${TAG}[getCheckoutSessionUser] [OUTPUT] userId=${user.id} username=${user.username} pendingSetup=${user.pendingSetup}`);
      console.log(`${TAG}[getCheckoutSessionUser] [VERIFY] PASS`);
      return user;
    }),

  /**
   * completeAccountSetup
   * Sets the user's email and password, marks pendingSetup=false, grants Discord role.
   * Password requirements: min 8 chars, 1 uppercase, 1 lowercase, 1 special character.
   */
  completeAccountSetup: stripeProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      email: z.string().email("Please enter a valid email address"),
      password: z.string()
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Z]/, "Password must contain at least 1 uppercase letter")
        .regex(/[a-z]/, "Password must contain at least 1 lowercase letter")
        .regex(/[^A-Za-z0-9]/, "Password must contain at least 1 special character"),
    }))
    .mutation(async ({ input, ctx }) => {
      const TAG2 = `${TAG}[completeAccountSetup]`;
      console.log(`${TAG2} [INPUT] sessionId=${input.sessionId} email=${input.email}`);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // [STEP 1] Find the pending user
      const rows = await db.select().from(appUsers)
        .where(eq(appUsers.pendingStripeSessionId, input.sessionId)).limit(1);
      if (!rows.length) {
        console.error(`${TAG2} [VERIFY] FAIL — no user found for sessionId=${input.sessionId}`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found. Please contact support." });
      }
      const user = rows[0];
      console.log(`${TAG2} [STATE] Found userId=${user.id} username=${user.username} pendingSetup=${user.pendingSetup}`);

      if (!user.pendingSetup) {
        console.log(`${TAG2} [STATE] Account already set up — returning success`);
        return { success: true, username: user.username, alreadySetup: true };
      }

      // [STEP 2] Check email uniqueness (excluding this user)
      const emailConflict = await db.select({ id: appUsers.id }).from(appUsers)
        .where(eq(appUsers.email, input.email)).limit(1);
      if (emailConflict.length > 0 && emailConflict[0].id !== user.id) {
        console.error(`${TAG2} [VERIFY] FAIL — email already in use: ${input.email}`);
        throw new TRPCError({ code: "CONFLICT", message: "That email address is already in use. Please use a different email." });
      }

      // [STEP 3] Hash password
      console.log(`${TAG2} [STEP] Hashing password cost=10`);
      const passwordHash = await bcrypt.hash(input.password, 10);
      console.log(`${TAG2} [STATE] Password hash OK`);

      // [STEP 4] Update account: set email, password, clear pendingSetup
      await db.update(appUsers).set({
        email: input.email,
        passwordHash,
        pendingSetup: false,
        pendingEmail: null,
        pendingStripeSessionId: null,
      }).where(eq(appUsers.id, user.id));

      invalidateAppUserByIdCache(user.id);
      invalidateCachedAppUser(user.id);
      console.log(`${TAG2} [OUTPUT] Account setup complete userId=${user.id} email=${input.email}`);

      // [STEP 5] Grant Discord role now that setup is complete
      if (user.hasAccess) {
        console.log(`${TAG2} [STEP] Granting Discord role userId=${user.id}`);
        const updatedUser = { ...user, pendingSetup: false, email: input.email };
        const discordResult = await syncDiscordRoleForUser(updatedUser, true);
        console.log(`${TAG2} [STATE] Discord role grant: action=${discordResult.action} reason=${discordResult.reason}`);
      }

      // [STEP 6] Issue JWT session cookie — auto-logs the user in immediately
      // so "Enter the Platform" navigates directly to /feed without a re-login prompt.
      console.log(`${TAG2} [STEP] Issuing app_session JWT cookie userId=${user.id} role=${user.role} tv=${user.tokenVersion}`);
      const token = await signAppUserToken(user.id, user.role, user.tokenVersion);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(APP_USER_COOKIE, token, {
        ...cookieOptions,
        maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days — same as stayLoggedIn=true
      });
      console.log(`${TAG2} [STATE] app_session cookie set — user is now authenticated`);

      // [STEP 7] Send branded welcome email (non-blocking — failure does not abort setup)
      const planLabelMap: Record<string, string> = {
        monthly: 'Monthly Plan',
        annual: 'Annual Plan',
        lifetime: 'Lifetime Access',
        test: 'Monthly Plan',
      };
      const planLabel = planLabelMap[user.stripePlanId ?? ''] ?? 'Subscription';
      import('../email').then(({ sendWelcomeEmail }) => {
        sendWelcomeEmail({
          toEmail: input.email,
          username: user.username,
          planLabel,
          expiryDate: user.expiryDate ? new Date(user.expiryDate) : null,
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`${TAG2} [STATE] Welcome email failed (non-critical): ${msg}`);
        });
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${TAG2} [STATE] Welcome email import failed (non-critical): ${msg}`);
      });

      console.log(`${TAG2} [VERIFY] PASS`);
      return { success: true, username: user.username, alreadySetup: false };
    }),

  /**
   * cancelSubscription
   *
   * Cancels the user's Stripe subscription at period end.
   * The user retains access until expiryDate; hasAccess is NOT immediately revoked.
   * The webhook (customer.subscription.deleted) handles final revocation.
   */
  cancelSubscription: stripeAppUserProcedure.mutation(async ({ ctx }) => {
    const TAG3 = '[Stripe][cancelSubscription]';
    const user = ctx.appUser;
    console.log(`${TAG3} [INPUT] userId=${user.id} subId=${user.stripeSubscriptionId ?? 'none'}`);

    if (!user.stripeSubscriptionId) {
      console.warn(`${TAG3} [VERIFY] FAIL — no stripeSubscriptionId userId=${user.id}`);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No active subscription found.',
      });
    }

    const stripe = getStripe();
    let sub;
    try {
      sub = await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG3} [VERIFY] FAIL — Stripe API error: ${msg}`);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to cancel subscription. Please try again.',
      });
    }

    // Stripe SDK v17: billing_cycle_anchor replaces current_period_end on Subscription
    // Use cancel_at (set when cancel_at_period_end=true) or fall back to current_period_end
    const rawEnd = (sub as unknown as Record<string, number>).cancel_at
      ?? (sub as unknown as Record<string, number>).current_period_end
      ?? Math.floor(Date.now() / 1000 + 30 * 86400);
    const periodEnd = rawEnd * 1000; // convert to ms
    // [STEP] Persist cancel_at_period_end flag to DB so frontend can read it without a Stripe API call
    await updateAppUser(user.id, { cancelAtPeriodEnd: true });
    console.log(`${TAG3} [STATE] DB updated cancelAtPeriodEnd=true userId=${user.id}`);
    console.log(`${TAG3} [OUTPUT] cancel_at_period_end=true periodEnd=${new Date(periodEnd).toISOString()}`);
    console.log(`${TAG3} [VERIFY] PASS`);
    return { success: true, cancelAt: periodEnd };
  }),

  /**
   * reactivateSubscription
   *
   * Removes cancel_at_period_end from the Stripe subscription so it auto-renews.
   * Only valid when the subscription is still active (hasAccess=true, cancelAtPeriodEnd=true).
   */
  reactivateSubscription: stripeAppUserProcedure.mutation(async ({ ctx }) => {
    const TAG4 = '[Stripe][reactivateSubscription]';
    const user = ctx.appUser;
    console.log(`${TAG4} [INPUT] userId=${user.id} subId=${user.stripeSubscriptionId ?? 'none'} cancelAtPeriodEnd=${user.cancelAtPeriodEnd}`);

    if (!user.stripeSubscriptionId) {
      console.warn(`${TAG4} [VERIFY] FAIL — no stripeSubscriptionId userId=${user.id}`);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No active subscription found.',
      });
    }

    if (!user.hasAccess) {
      console.warn(`${TAG4} [VERIFY] FAIL — subscription fully expired userId=${user.id}`);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Subscription has fully expired. Please subscribe again.',
      });
    }

    const stripe = getStripe();
    try {
      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });
      console.log(`${TAG4} [STATE] Stripe cancel_at_period_end=false subId=${user.stripeSubscriptionId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG4} [VERIFY] FAIL — Stripe API error: ${msg}`);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to reactivate subscription. Please try again.',
      });
    }

    // [STEP] Clear cancelAtPeriodEnd flag in DB
    await updateAppUser(user.id, { cancelAtPeriodEnd: false });
    console.log(`${TAG4} [STATE] DB updated cancelAtPeriodEnd=false userId=${user.id}`);
    console.log(`${TAG4} [OUTPUT] subscription reactivated userId=${user.id}`);
    console.log(`${TAG4} [VERIFY] PASS`);
    return { success: true };
  }),
});
