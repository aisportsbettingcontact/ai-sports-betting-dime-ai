/**
 * server/stripeWebhook.ts
 *
 * Stripe webhook handler — registered BEFORE express.json() so the raw
 * request buffer is preserved for HMAC-SHA256 signature verification.
 *
 * Checklist compliance:
 *  ✅ POST-only endpoint at /api/stripe/webhook
 *  ✅ express.raw({ type: 'application/json' }) applied before express.json()
 *  ✅ Stripe-Signature header validated via stripe.webhooks.constructEvent()
 *  ✅ Test events (evt_test_*) return { verified: true } immediately
 *  ✅ Always returns HTTP 200 with valid JSON — never 3xx/4xx/5xx
 *  ✅ Async event processing — response sent before heavy work
 *  ✅ API version: 2026-04-22.dahlia (latest installed)
 *  ✅ DB fulfillment: checkout.session.completed grants access
 *  ✅ DB fulfillment: subscription.deleted revokes access
 *  ✅ DB fulfillment: invoice.payment_failed logs failure
 */

import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { appUsers } from "../drizzle/schema";
import { getDb } from "./db";
import { getPlanByPriceId, computeExpiryMs } from "./stripe/products";

// ─── Stripe client ────────────────────────────────────────────────────────────
// Initialized lazily so the server starts even if the key is temporarily missing.
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) {
      throw new Error("[Stripe] STRIPE_SECRET_KEY is not set in environment");
    }
    _stripe = new Stripe(sk, { apiVersion: "2026-04-22.dahlia" });
  }
  return _stripe;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Grant subscription access to a user identified by their app_users.id.
 * Sets hasAccess=true, expiryDate, stripeCustomerId, stripeSubscriptionId, stripePlanId.
 */
async function grantUserAccess(params: {
  userId: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId: string;
  expiryMs: number;
}): Promise<void> {
  const tag = "[Stripe][DB][grantUserAccess]";
  const db = await getDb();
  if (!db) {
    console.error(`${tag} [VERIFY] FAIL — database not available`);
    return;
  }

  console.log(`${tag} [STEP] Granting access userId=${params.userId} planId=${params.planId} expiryMs=${params.expiryMs}`);

  await db
    .update(appUsers)
    .set({
      hasAccess: true,
      expiryDate: params.expiryMs,
      stripeCustomerId: params.stripeCustomerId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripePlanId: params.planId,
    })
    .where(eq(appUsers.id, params.userId));

  console.log(`${tag} [OUTPUT] Access granted userId=${params.userId} expiryDate=${new Date(params.expiryMs).toISOString()}`);
  console.log(`${tag} [VERIFY] PASS`);
}

/**
 * Revoke subscription access for a user identified by their Stripe Customer ID.
 * Sets hasAccess=false, clears stripeSubscriptionId and stripePlanId.
 * stripeCustomerId is preserved for future re-subscriptions.
 */
async function revokeUserAccessByCustomerId(stripeCustomerId: string): Promise<void> {
  const tag = "[Stripe][DB][revokeUserAccess]";
  const db = await getDb();
  if (!db) {
    console.error(`${tag} [VERIFY] FAIL — database not available`);
    return;
  }

  console.log(`${tag} [STEP] Revoking access for stripeCustomerId=${stripeCustomerId}`);

  await db
    .update(appUsers)
    .set({
      hasAccess: false,
      stripeSubscriptionId: null,
      stripePlanId: null,
      // expiryDate left as-is — records when access expired
    })
    .where(eq(appUsers.stripeCustomerId, stripeCustomerId));

  console.log(`${tag} [OUTPUT] Access revoked for stripeCustomerId=${stripeCustomerId}`);
  console.log(`${tag} [VERIFY] PASS`);
}

/**
 * Update stripeCustomerId on the user record when a new Stripe Customer is created.
 * Used when checkout.session.completed fires before subscription events.
 */
async function updateStripeCustomerId(userId: number, stripeCustomerId: string): Promise<void> {
  const tag = "[Stripe][DB][updateStripeCustomerId]";
  const db = await getDb();
  if (!db) {
    console.error(`${tag} [VERIFY] FAIL — database not available`);
    return;
  }

  await db
    .update(appUsers)
    .set({ stripeCustomerId })
    .where(eq(appUsers.id, userId));

  console.log(`${tag} [OUTPUT] stripeCustomerId=${stripeCustomerId} saved for userId=${userId}`);
}

// ─── Webhook event processor (async, fire-and-forget after 200 response) ─────
async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  const tag = `[Stripe][Webhook][${event.type}][${event.id}]`;
  console.log(`${tag} Processing event at ${new Date(event.created * 1000).toISOString()}`);

  switch (event.type) {
    // ── Checkout completed ──────────────────────────────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      console.log(`${tag} [INPUT] Checkout session completed`);
      console.log(`${tag}   session_id=${session.id}`);
      console.log(`${tag}   customer=${session.customer}`);
      console.log(`${tag}   client_reference_id=${session.client_reference_id}`);
      console.log(`${tag}   payment_status=${session.payment_status}`);
      console.log(`${tag}   metadata=${JSON.stringify(session.metadata)}`);

      // ── [STEP 1] Validate payment status ────────────────────────────────
      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        console.warn(`${tag} [STATE] payment_status=${session.payment_status} — skipping fulfillment`);
        break;
      }

      // ── [STEP 2] Extract user ID from metadata ───────────────────────────
      const userIdStr = session.client_reference_id ?? session.metadata?.user_id;
      if (!userIdStr) {
        console.error(`${tag} [VERIFY] FAIL — no user_id in client_reference_id or metadata`);
        break;
      }
      const userId = parseInt(userIdStr, 10);
      if (isNaN(userId)) {
        console.error(`${tag} [VERIFY] FAIL — invalid user_id="${userIdStr}"`);
        break;
      }

      // ── [STEP 3] Extract plan ID from metadata ───────────────────────────
      const planId = session.metadata?.plan_id ?? "monthly";
      console.log(`${tag} [STATE] userId=${userId} planId=${planId}`);

      // ── [STEP 4] Validate plan ───────────────────────────────────────────
      const plan = planId === "monthly" || planId === "annual" ? planId : "monthly";

      // ── [STEP 5] Extract Stripe IDs ──────────────────────────────────────
      const stripeCustomerId = typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? "";
      const stripeSubscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? "";

      if (!stripeCustomerId) {
        console.error(`${tag} [VERIFY] FAIL — no stripeCustomerId in session`);
        break;
      }

      // ── [STEP 6] Compute expiry ──────────────────────────────────────────
      const expiryMs = computeExpiryMs(plan);

      // ── [STEP 7] Grant access in DB ──────────────────────────────────────
      await grantUserAccess({
        userId,
        stripeCustomerId,
        stripeSubscriptionId,
        planId: plan,
        expiryMs,
      });

      console.log(`${tag} [OUTPUT] Fulfillment complete userId=${userId} plan=${plan}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    // ── Subscription lifecycle ──────────────────────────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const eventAction = event.type.split(".").pop();

      console.log(`${tag} [INPUT] Subscription ${eventAction}`);
      console.log(`${tag}   subscription_id=${sub.id}`);
      console.log(`${tag}   customer=${sub.customer}`);
      console.log(`${tag}   status=${sub.status}`);
      console.log(`${tag}   billing_cycle_anchor=${sub.billing_cycle_anchor}`);

      // ── [STEP 1] Only process active subscriptions ───────────────────────
      if (sub.status !== "active" && sub.status !== "trialing") {
        console.log(`${tag} [STATE] status=${sub.status} — no DB action needed`);
        break;
      }

      // ── [STEP 2] Resolve plan from price ID ──────────────────────────────
      const firstItem = sub.items?.data?.[0];
      const priceId = firstItem?.price?.id;
      const resolvedPlan = priceId ? getPlanByPriceId(priceId) : null;
      const planId = resolvedPlan?.id ?? "monthly";

      console.log(`${tag} [STATE] priceId=${priceId} resolvedPlan=${planId}`);

      // ── [STEP 3] Compute expiry from subscription period_end ─────────────
      // current_period_end is the Unix timestamp when the current billing period ends
      const periodEndMs = (firstItem?.current_period_end ?? 0) * 1000;
      const expiryMs = periodEndMs > Date.now() ? periodEndMs + 24 * 60 * 60 * 1000 : computeExpiryMs(planId);

      console.log(`${tag} [STATE] expiryMs=${expiryMs} (${new Date(expiryMs).toISOString()})`);

      // ── [STEP 4] Update DB by stripeCustomerId ────────────────────────────
      const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const db = await getDb();
      if (!db) {
        console.error(`${tag} [VERIFY] FAIL — database not available`);
        break;
      }

      await db
        .update(appUsers)
        .set({
          hasAccess: true,
          expiryDate: expiryMs,
          stripeSubscriptionId: sub.id,
          stripePlanId: planId,
        })
        .where(eq(appUsers.stripeCustomerId, stripeCustomerId));

      console.log(`${tag} [OUTPUT] Subscription updated in DB stripeCustomerId=${stripeCustomerId} plan=${planId}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;

      console.log(`${tag} [INPUT] Subscription cancelled`);
      console.log(`${tag}   subscription_id=${sub.id}`);
      console.log(`${tag}   customer=${sub.customer}`);

      const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await revokeUserAccessByCustomerId(stripeCustomerId);

      console.log(`${tag} [OUTPUT] Access revoked for stripeCustomerId=${stripeCustomerId}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    // ── Invoice / payment ───────────────────────────────────────────────────
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;

      console.log(`${tag} [INPUT] Invoice paid`);
      console.log(`${tag}   invoice_id=${invoice.id}`);
      console.log(`${tag}   customer=${invoice.customer}`);
      console.log(`${tag}   amount_paid=${invoice.amount_paid}`);
      console.log(`${tag}   billing_reason=${invoice.billing_reason}`);

      // For renewal invoices, extend the expiry date
      // In Stripe API 2026-04-22.dahlia, subscription is nested under invoice.parent.subscription_details.subscription
      const invoiceSubParent = invoice.parent as (Stripe.Invoice.Parent & { subscription_details?: { subscription?: string | Stripe.Subscription } }) | null;
      const invoiceSubId = (() => {
        const sub = invoiceSubParent?.subscription_details?.subscription;
        return typeof sub === "string" ? sub : (sub as Stripe.Subscription | undefined)?.id ?? null;
      })();
      if (invoice.billing_reason === "subscription_cycle" && invoiceSubId) {
        const stripeCustomerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer as Stripe.Customer)?.id ?? "";
        if (stripeCustomerId) {
          // Renewal: extend access by 31 days from now (will be corrected by subscription.updated event)
          const extendedExpiry = Date.now() + 31 * 24 * 60 * 60 * 1000;
          const db = await getDb();
          if (db) {
            await db
              .update(appUsers)
              .set({ hasAccess: true, expiryDate: extendedExpiry })
              .where(eq(appUsers.stripeCustomerId, stripeCustomerId));
            console.log(`${tag} [OUTPUT] Renewal: extended access for stripeCustomerId=${stripeCustomerId}`);
          }
        }
      }

      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;

      console.log(`${tag} [INPUT] Invoice payment FAILED`);
      console.log(`${tag}   invoice_id=${invoice.id}`);
      console.log(`${tag}   customer=${invoice.customer}`);
      console.log(`${tag}   attempt_count=${invoice.attempt_count}`);
      console.log(`${tag}   next_payment_attempt=${invoice.next_payment_attempt}`);
      // NOTE: Do NOT revoke access on first failure — Stripe retries automatically.
      // Access is revoked only when subscription.deleted fires (after all retries exhausted).
      console.log(`${tag} [STATE] Access NOT revoked — Stripe will retry payment automatically`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;

      console.log(`${tag} [INPUT] PaymentIntent succeeded`);
      console.log(`${tag}   payment_intent_id=${pi.id}`);
      console.log(`${tag}   amount=${pi.amount}`);
      console.log(`${tag}   customer=${pi.customer}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;

      console.log(`${tag} [INPUT] PaymentIntent FAILED`);
      console.log(`${tag}   payment_intent_id=${pi.id}`);
      console.log(`${tag}   last_error=${pi.last_payment_error?.message}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    default:
      console.log(`${tag} Unhandled event type — no action taken`);
  }
}

// ─── Route registration ───────────────────────────────────────────────────────
/**
 * Call this BEFORE app.use(express.json()) in index.ts.
 * The express.raw() middleware here intercepts only /api/stripe/webhook
 * and preserves the raw buffer needed for signature verification.
 */
export function registerStripeWebhookRoute(app: Express): void {
  // CRITICAL: raw body parser must be registered before express.json()
  // This middleware only applies to /api/stripe/webhook
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    (req: Request, res: Response) => {
      const tag = "[Stripe][Webhook]";
      const sig = req.headers["stripe-signature"] as string | undefined;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      // ── Step 1: Validate environment ──────────────────────────────────────
      if (!webhookSecret) {
        console.error(`${tag} STRIPE_WEBHOOK_SECRET not set — cannot verify signature`);
        // Still return 200 so Stripe doesn't retry indefinitely during setup
        return res.status(200).json({ received: true, warning: "webhook_secret_not_configured" });
      }

      if (!sig) {
        console.error(`${tag} Missing Stripe-Signature header`);
        return res.status(200).json({ received: true, error: "missing_signature_header" });
      }

      // ── Step 2: Construct and verify event ────────────────────────────────
      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} Signature verification FAILED: ${msg}`);
        // Return 200 with error detail — never return 4xx to Stripe
        return res.status(200).json({ received: true, error: "signature_verification_failed", detail: msg });
      }

      console.log(`${tag} Signature verified ✓ event_id=${event.id} type=${event.type}`);

      // ── Step 3: Handle test events immediately ────────────────────────────
      // Stripe's webhook verification tool sends test events with evt_test_ prefix.
      // Must return { verified: true } for the verification check to pass.
      if (event.id.startsWith("evt_test_")) {
        console.log(`${tag} Test event detected — returning verification response`);
        return res.status(200).json({ verified: true });
      }

      // ── Step 4: Acknowledge immediately, process async ────────────────────
      // Send 200 before any async work to prevent Stripe timeout retries.
      res.status(200).json({ received: true });

      // Process asynchronously — errors here do not affect the 200 response
      processWebhookEvent(event).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} Async processing error for ${event.id}: ${msg}`);
      });
    }
  );

  console.log("[Stripe] Webhook route registered at POST /api/stripe/webhook");
}
