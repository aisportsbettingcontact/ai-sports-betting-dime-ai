/**
 * stripeWebhook.ts
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
 */

import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";

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

// ─── Webhook event processor (async, fire-and-forget after 200 response) ─────
async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  const tag = `[Stripe][Webhook][${event.type}][${event.id}]`;
  console.log(`${tag} Processing event at ${new Date(event.created * 1000).toISOString()}`);

  switch (event.type) {
    // ── Checkout completed ──────────────────────────────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`${tag} Checkout session completed`);
      console.log(`${tag}   session_id=${session.id}`);
      console.log(`${tag}   customer=${session.customer}`);
      console.log(`${tag}   client_reference_id=${session.client_reference_id}`);
      console.log(`${tag}   payment_status=${session.payment_status}`);
      console.log(`${tag}   metadata=${JSON.stringify(session.metadata)}`);
      // TODO: grant access / update subscription status in DB
      // Example: await grantUserAccess(session.client_reference_id, session.customer as string);
      break;
    }

    // ── Subscription lifecycle ──────────────────────────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      console.log(`${tag} Subscription ${event.type.split(".").pop()}`);
      console.log(`${tag}   subscription_id=${sub.id}`);
      console.log(`${tag}   customer=${sub.customer}`);
      console.log(`${tag}   status=${sub.status}`);
      // billing_cycle_anchor is available in all API versions
      console.log(`${tag}   billing_cycle_anchor=${sub.billing_cycle_anchor}`);
      // TODO: update user subscription status in DB
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      console.log(`${tag} Subscription cancelled`);
      console.log(`${tag}   subscription_id=${sub.id}`);
      console.log(`${tag}   customer=${sub.customer}`);
      // TODO: revoke user access in DB
      break;
    }

    // ── Invoice / payment ───────────────────────────────────────────────────
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`${tag} Invoice paid`);
      console.log(`${tag}   invoice_id=${invoice.id}`);
      console.log(`${tag}   customer=${invoice.customer}`);
      console.log(`${tag}   amount_paid=${invoice.amount_paid}`);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`${tag} Invoice payment FAILED`);
      console.log(`${tag}   invoice_id=${invoice.id}`);
      console.log(`${tag}   customer=${invoice.customer}`);
      console.log(`${tag}   attempt_count=${invoice.attempt_count}`);
      // TODO: notify user of failed payment
      break;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log(`${tag} PaymentIntent succeeded`);
      console.log(`${tag}   payment_intent_id=${pi.id}`);
      console.log(`${tag}   amount=${pi.amount}`);
      console.log(`${tag}   customer=${pi.customer}`);
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log(`${tag} PaymentIntent FAILED`);
      console.log(`${tag}   payment_intent_id=${pi.id}`);
      console.log(`${tag}   last_error=${pi.last_payment_error?.message}`);
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
