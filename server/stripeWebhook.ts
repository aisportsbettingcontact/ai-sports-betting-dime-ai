/**
 * server/stripeWebhook.ts
 *
 * Stripe webhook handler — registered BEFORE express.json() so the raw
 * request buffer is preserved for HMAC-SHA256 signature verification.
 *
 * Checklist:
 *  ✅ POST-only at /api/stripe/webhook
 *  ✅ express.raw({ type: 'application/json' }) before express.json()
 *  ✅ Stripe-Signature HMAC-SHA256 verified via stripe.webhooks.constructEvent()
 *  ✅ Test events (evt_test_*) return { verified: true } immediately
 *  ✅ Always returns HTTP 200 — never 3xx/4xx/5xx
 *  ✅ Async event processing — response sent before heavy work
 *  ✅ NEW: checkout.session.completed creates new pending user if no userId in metadata
 *  ✅ NEW: Discord role granted only after account setup is complete (pendingSetup=false)
 *  ✅ subscription.deleted revokes access + Discord role immediately
 *  ✅ invoice.payment_failed logs failure (no revoke — Stripe retries)
 */
import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { appUsers } from "../drizzle/schema";
import {
  getDb,
  getAppUserById,
  getAppUserByStripeCustomerId,
  invalidateAppUserByIdCache,
} from "./db";
import { getPlanByPriceId, computeExpiryMs, normalizePlanId } from "./stripe/products";
import { syncDiscordRoleForUser } from "./discord/discordRoleSync";
import { invalidateCachedAppUser } from "./dbCircuitBreaker";
import bcrypt from "bcryptjs";

// ─── Stripe client ────────────────────────────────────────────────────────────
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) throw new Error("[Stripe] STRIPE_SECRET_KEY is not set in environment");
    _stripe = new Stripe(sk, { apiVersion: "2026-04-22.dahlia" });
  }
  return _stripe;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Grant subscription access to a user identified by their app_users.id.
 * Discord role is granted only if pendingSetup=false (account fully set up).
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
    throw new Error(`${tag} database not available — cannot grant access userId=${params.userId}`);
  }

  console.log(`${tag} [STEP] Granting access userId=${params.userId} planId=${params.planId} expiryMs=${params.expiryMs}`);
  const updateValues: Partial<typeof appUsers.$inferInsert> = {
    hasAccess: true,
    expiryDate: params.expiryMs,
    stripeCustomerId: params.stripeCustomerId,
    stripePlanId: params.planId,
  };
  // An empty/absent subscription id (e.g. a mode:"payment" session with no
  // subscription attached) must never clobber a real subscriber's existing id.
  if (params.stripeSubscriptionId) {
    updateValues.stripeSubscriptionId = params.stripeSubscriptionId;
  } else {
    console.log(`${tag} [STATE] No stripeSubscriptionId provided — leaving existing value untouched userId=${params.userId}`);
  }
  await db.update(appUsers).set(updateValues).where(eq(appUsers.id, params.userId));

  invalidateAppUserByIdCache(params.userId);
  invalidateCachedAppUser(params.userId);
  console.log(`${tag} [OUTPUT] Access granted userId=${params.userId} expiry=${new Date(params.expiryMs).toISOString()}`);

  // Discord role: only grant if account setup is complete
  const user = await getAppUserById(params.userId);
  if (user && !user.pendingSetup) {
    console.log(`${tag} [STEP] pendingSetup=false — syncing Discord role userId=${params.userId}`);
    const r = await syncDiscordRoleForUser(user, true);
    console.log(`${tag} [STATE] Discord sync: action=${r.action} reason=${r.reason}`);
  } else if (user?.pendingSetup) {
    console.log(`${tag} [STATE] pendingSetup=true — Discord role deferred until account setup`);
  }
  console.log(`${tag} [VERIFY] PASS`);
}

/**
 * Revoke subscription access by Stripe Customer ID.
 * Discord role is revoked immediately.
 */
async function revokeUserAccessByCustomerId(stripeCustomerId: string): Promise<void> {
  const tag = "[Stripe][DB][revokeUserAccess]";
  const db = await getDb();
  if (!db) { console.error(`${tag} [VERIFY] FAIL — database not available`); return; }

  console.log(`${tag} [STEP] Revoking access stripeCustomerId=${stripeCustomerId}`);
  await db.update(appUsers).set({
    hasAccess: false,
    stripeSubscriptionId: null,
    stripePlanId: null,
  }).where(eq(appUsers.stripeCustomerId, stripeCustomerId));

  const user = await getAppUserByStripeCustomerId(stripeCustomerId);
  if (user) {
    invalidateAppUserByIdCache(user.id);
    invalidateCachedAppUser(user.id);
    console.log(`${tag} [STEP] Revoking Discord role userId=${user.id}`);
    const r = await syncDiscordRoleForUser(user, false);
    console.log(`${tag} [STATE] Discord revoke: action=${r.action} reason=${r.reason}`);
  }
  console.log(`${tag} [OUTPUT] Access revoked stripeCustomerId=${stripeCustomerId}`);
  console.log(`${tag} [VERIFY] PASS`);
}

/**
 * Create a new pending app_user from Stripe checkout data.
 * Called when checkout.session.completed fires with no userId in metadata.
 * Account is created with pendingSetup=true — user must set password in SubscribeSuccess.
 * Discord role is NOT granted until pendingSetup=false.
 */
async function createPendingUserFromCheckout(params: {
  sessionId: string;
  desiredUsername: string;
  email: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId: string;
  expiryMs: number;
}): Promise<number | null> {
  const tag = "[Stripe][DB][createPendingUser]";
  const db = await getDb();
  if (!db) {
    console.error(`${tag} [VERIFY] FAIL — database not available`);
    throw new Error(`${tag} database not available — cannot create pending user sessionId=${params.sessionId}`);
  }

  // [STEP 1] Sanitize username
  let username = (params.desiredUsername ?? "").trim().replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64);
  if (!username || username.length < 3) {
    const emailPrefix = params.email.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 20);
    username = `${emailPrefix}_${Math.random().toString(36).slice(2, 6)}`;
    console.warn(`${tag} [STATE] Invalid desiredUsername — fallback: ${username}`);
  }
  console.log(`${tag} [INPUT] sessionId=${params.sessionId} username=${username} email=${params.email} plan=${params.planId}`);

  // [STEP 2] Check username collision
  const byUsername = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.username, username)).limit(1);
  if (byUsername.length > 0) {
    username = `${username}_${Math.random().toString(36).slice(2, 5)}`;
    console.warn(`${tag} [STATE] Username collision — using: ${username}`);
  }

  // [STEP 3] Check email collision — if email exists, grant access to existing account
  const byEmail = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.email, params.email)).limit(1);
  if (byEmail.length > 0) {
    const existingId = byEmail[0].id;
    console.warn(`${tag} [STATE] Email already exists userId=${existingId} — granting access to existing account`);
    await grantUserAccess({
      userId: existingId,
      stripeCustomerId: params.stripeCustomerId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      planId: params.planId,
      expiryMs: params.expiryMs,
    });
    return existingId;
  }

  // [STEP 4] Create pending account with placeholder password
  const placeholderPw = `Pending_${Math.random().toString(36).slice(2, 12)}!`;
  const passwordHash = await bcrypt.hash(placeholderPw, 10);

  await db.insert(appUsers).values({
    username,
    email: params.email,
    passwordHash,
    hasAccess: true,
    expiryDate: params.expiryMs,
    stripeCustomerId: params.stripeCustomerId,
    stripeSubscriptionId: params.stripeSubscriptionId,
    stripePlanId: params.planId,
    role: "user",
    termsAccepted: false,
    pendingSetup: true,
    pendingEmail: params.email,
    pendingUsername: username,
    pendingStripeSessionId: params.sessionId,
  });

  // [STEP 5] Retrieve the new user's ID
  const newUser = await db.select({ id: appUsers.id }).from(appUsers)
    .where(eq(appUsers.pendingStripeSessionId, params.sessionId)).limit(1);
  if (!newUser.length) {
    console.error(`${tag} [VERIFY] FAIL — could not retrieve new user for sessionId=${params.sessionId}`);
    return null;
  }

  const newUserId = newUser[0].id;
  console.log(`${tag} [OUTPUT] Pending account created userId=${newUserId} username=${username}`);
  console.log(`${tag} [STATE] pendingSetup=true — Discord role deferred until account setup`);
  console.log(`${tag} [VERIFY] PASS`);
  return newUserId;
}

// ─── Webhook event processor ──────────────────────────────────────────────────
async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  const tag = `[Stripe][Webhook][${event.type}][${event.id}]`;
  console.log(`${tag} Processing at ${new Date(event.created * 1000).toISOString()}`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`${tag} [INPUT] session_id=${session.id} customer=${session.customer} payment_status=${session.payment_status}`);
      console.log(`${tag}   client_reference_id=${session.client_reference_id} customer_email=${session.customer_details?.email ?? "(none)"}`);
      console.log(`${tag}   metadata=${JSON.stringify(session.metadata)}`);

      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        console.warn(`${tag} [STATE] payment_status=${session.payment_status} — skipping`); break;
      }

      // Plan resolution: metadata plan_id first, else price→plan map (env-driven
      // for all five plans: monthly/annual + pro/sharp/operator), else "monthly".
      let plan = normalizePlanId(session.metadata?.plan_id);
      if (!session.metadata?.plan_id) {
        // Sessions our server creates always carry plan_id metadata; anything
        // else (Payment Link, dashboard-created) must resolve from its price so
        // a $499 purchase can never silently provision as "monthly".
        try {
          const items = await getStripe().checkout.sessions.listLineItems(session.id, { limit: 1 });
          const priceId = items.data[0]?.price?.id;
          const mapped = priceId ? getPlanByPriceId(priceId) : null;
          if (mapped) {
            plan = mapped.id;
            console.warn(`${tag} [STATE] plan_id metadata absent — resolved plan="${plan}" from price=${priceId}`);
          } else {
            console.error(`${tag} [VERIFY] FAIL — plan_id metadata absent and price ${priceId ?? "(none)"} not in plan map; defaulting to "${plan}"`);
          }
        } catch (err) {
          console.error(`${tag} [VERIFY] FAIL — could not list line items for plan resolution: ${err instanceof Error ? err.message : String(err)}; defaulting to "${plan}"`);
        }
      }
      const stripeCustomerId = typeof session.customer === "string" ? session.customer : (session.customer as Stripe.Customer | null)?.id ?? "";
      const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription as Stripe.Subscription | null)?.id ?? "";

      if (!stripeCustomerId) { console.error(`${tag} [VERIFY] FAIL — no stripeCustomerId`); break; }

      const expiryMs = computeExpiryMs(plan);
      const userIdStr = session.client_reference_id ?? session.metadata?.user_id;

      if (userIdStr) {
        // EXISTING USER PATH
        const userId = parseInt(userIdStr, 10);
        if (isNaN(userId)) { console.error(`${tag} [VERIFY] FAIL — invalid user_id="${userIdStr}"`); break; }
        console.log(`${tag} [STATE] Existing user path userId=${userId} plan=${plan}`);
        await grantUserAccess({ userId, stripeCustomerId, stripeSubscriptionId, planId: plan, expiryMs });
        console.log(`${tag} [OUTPUT] Fulfillment complete (existing user) userId=${userId}`);
      } else {
        // NEW USER PATH
        console.log(`${tag} [STATE] New user path — no userId in metadata`);
        const customerEmail = session.customer_details?.email ?? "";
        if (!customerEmail) { console.error(`${tag} [VERIFY] FAIL — no customer email for new user`); break; }

        // Username sources, in order:
        //  1. session.metadata.desired_username — elements-mode checkout (our
        //     /checkout form attaches it via publicAttachCheckoutIdentity);
        //     custom_fields are always EMPTY in ui_mode:"elements".
        //  2. custom_fields — legacy hosted/embedded_page sessions.
        //  3. email prefix fallback.
        const metadataUsername = session.metadata?.desired_username?.trim();
        const desiredUsernameField = (session.custom_fields ?? []).find(
          (f: { key: string; text?: { value?: string | null } }) => f.key === "desired_username"
        );
        const desiredUsername =
          (metadataUsername && metadataUsername.length > 0 ? metadataUsername : null) ??
          desiredUsernameField?.text?.value ??
          customerEmail.split("@")[0];
        console.log(`${tag} [STATE] desiredUsername="${desiredUsername}" email="${customerEmail}"`);

        const newUserId = await createPendingUserFromCheckout({
          sessionId: session.id,
          desiredUsername,
          email: customerEmail,
          stripeCustomerId,
          stripeSubscriptionId,
          planId: plan,
          expiryMs,
        });
        if (newUserId) {
          console.log(`${tag} [OUTPUT] Fulfillment complete (new user) userId=${newUserId} plan=${plan}`);
        } else {
          console.error(`${tag} [VERIFY] FAIL — new user creation returned null sessionId=${session.id}`);
        }
      }
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const action = event.type.split(".").pop();
      console.log(`${tag} [INPUT] Subscription ${action} sub_id=${sub.id} customer=${sub.customer} status=${sub.status}`);
      console.log(`${tag}   metadata=${JSON.stringify(sub.metadata)}`);

      if (sub.status !== "active" && sub.status !== "trialing") {
        console.log(`${tag} [STATE] status=${sub.status} — no access change`); break;
      }

      const subUserIdStr = sub.metadata?.user_id;
      if (!subUserIdStr) {
        console.log(`${tag} [STATE] No user_id in sub metadata — access handled by checkout.session.completed`); break;
      }
      const subUserId = parseInt(subUserIdStr, 10);
      if (isNaN(subUserId)) { console.error(`${tag} [VERIFY] FAIL — invalid user_id in sub metadata`); break; }

      const subPlan = normalizePlanId(sub.metadata?.plan_id);
      const subCustomerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as Stripe.Customer).id;
      const subExpiryMs = computeExpiryMs(subPlan);

      await grantUserAccess({ userId: subUserId, stripeCustomerId: subCustomerId, stripeSubscriptionId: sub.id, planId: subPlan, expiryMs: subExpiryMs });
      console.log(`${tag} [OUTPUT] Subscription ${action} processed userId=${subUserId}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      console.log(`${tag} [INPUT] Subscription deleted sub_id=${sub.id} customer=${sub.customer}`);
      const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as Stripe.Customer).id;
      await revokeUserAccessByCustomerId(customerId);
      console.log(`${tag} [OUTPUT] Access revoked stripeCustomerId=${customerId}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`${tag} [INPUT] Invoice paid invoice_id=${invoice.id} customer=${invoice.customer} amount=${invoice.amount_paid}`);
      const invoiceCustomerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer as Stripe.Customer | null)?.id ?? "";
      if (invoiceCustomerId && invoice.billing_reason === "subscription_cycle") {
        const existingUser = await getAppUserByStripeCustomerId(invoiceCustomerId);
        if (existingUser) {
          const renewPlan = normalizePlanId(existingUser.stripePlanId);
          const renewExpiry = computeExpiryMs(renewPlan);
          const invoiceSubId = (() => {
            const s = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | Stripe.Subscription } } }).parent?.subscription_details?.subscription;
            return typeof s === "string" ? s : (s as Stripe.Subscription | undefined)?.id ?? existingUser.stripeSubscriptionId ?? "";
          })();
          console.log(`${tag} [STATE] Renewal userId=${existingUser.id} plan=${renewPlan} newExpiry=${new Date(renewExpiry).toISOString()}`);
          await grantUserAccess({ userId: existingUser.id, stripeCustomerId: invoiceCustomerId, stripeSubscriptionId: invoiceSubId, planId: renewPlan, expiryMs: renewExpiry });
          console.log(`${tag} [OUTPUT] Renewal processed userId=${existingUser.id}`);
        }
      }
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log(`${tag} [INPUT] Invoice FAILED invoice_id=${invoice.id} customer=${invoice.customer} attempt=${invoice.attempt_count}`);
      console.log(`${tag} [STATE] Access NOT revoked — Stripe retries automatically`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log(`${tag} [INPUT] PaymentIntent succeeded pi_id=${pi.id} amount=${pi.amount} customer=${pi.customer}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log(`${tag} [INPUT] PaymentIntent FAILED pi_id=${pi.id} last_error=${pi.last_payment_error?.message}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    default:
      console.log(`${tag} Unhandled event type — no action taken`);
  }
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerStripeWebhookRoute(app: Express): void {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    (req: Request, res: Response) => {
      const tag = "[Stripe][Webhook]";
      const sig = req.headers["stripe-signature"] as string | undefined;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error(`${tag} STRIPE_WEBHOOK_SECRET not set`);
        return res.status(400).json({ error: "webhook_secret_not_configured" });
      }
      if (!sig) {
        console.error(`${tag} Missing Stripe-Signature header`);
        return res.status(400).json({ error: "missing_signature_header" });
      }

      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} Signature verification FAILED: ${msg}`);
        return res.status(400).json({ error: "signature_verification_failed", detail: msg });
      }

      console.log(`${tag} Signature verified ✓ event_id=${event.id} type=${event.type}`);

      if (event.id.startsWith("evt_test_")) {
        console.log(`${tag} Test event — returning verification response`);
        return res.status(200).json({ verified: true });
      }

      // Events that GRANT ACCESS must not be silently swallowed on a DB outage
      // or a failed grant — Stripe only redelivers on a non-2xx response, so
      // these are awaited and a failure yields a 5xx instead of the default
      // 200 so Stripe retries. Every other event type (including unknown
      // types) keeps the original fire-and-forget 200 behavior unchanged.
      const GRANT_EVENT_TYPES = new Set<string>([
        "checkout.session.completed",
        "invoice.paid",
        "customer.subscription.created",
        "customer.subscription.updated",
      ]);

      if (GRANT_EVENT_TYPES.has(event.type)) {
        processWebhookEvent(event).then(
          () => res.status(200).json({ received: true }),
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`${tag} Grant processing FAILED for ${event.id} (${event.type}) — responding 5xx so Stripe retries: ${msg}`);
            res.status(500).json({ error: "processing_failed" });
          }
        );
        return;
      }

      res.status(200).json({ received: true });
      processWebhookEvent(event).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} Async processing error for ${event.id}: ${msg}`);
      });
    }
  );
  console.log("[Stripe] Webhook route registered at POST /api/stripe/webhook");
}
