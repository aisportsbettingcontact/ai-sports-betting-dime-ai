/**
 * server/stripeWebhook.ts
 *
 * Stripe webhook handler — registered BEFORE express.json() so the raw
 * request buffer is preserved for HMAC-SHA256 signature verification.
 *
 * Response contract (deliberate — NOT "always 200"):
 *  - 400 on a missing/invalid Stripe-Signature (forged or misconfigured).
 *  - 5xx when an ACCESS-CHANGING event fails to process, so Stripe redelivers.
 *    Both grants and revokes are in this set: a dropped revoke is as expensive
 *    as a dropped grant (WBHK-002).
 *  - 200 once the event is durably recorded and its side effects have committed.
 *
 * Exactly-once: every event is claimed in `stripe_webhook_events` (UNIQUE on
 * stripeEventId) inside the same transaction as its side effects, so a Stripe
 * redelivery is a provable no-op (WBHK-001).
 *
 * Ordering: subscription events carry `event.created`; anything older than the
 * last applied event for that user is ignored, so a late `updated` cannot
 * resurrect access after a `deleted` (WBHK-003).
 */
import type { Express, Request, Response } from "express";
import express from "express";
import type Stripe from "stripe";
import { eq, and, sql } from "drizzle-orm";
import { appUsers, stripeWebhookEvents, entitlementEvents } from "../drizzle/schema";
import {
  getDb,
  getAppUserById,
  getAppUserByStripeCustomerId,
  invalidateAppUserByIdCache,
} from "./db";
import { PLANS, getPlanByPriceId, computeExpiryMs, normalizePlanId } from "./stripe/products";
import { getPlanBySlug, getPriceById, computeExpiryMsForPrice, defaultPriceOf } from "./stripe/planStore";
import { applyPurchaseToPlanQuantity } from "./stripe/planProvisioning";
import { syncDiscordRoleForUser } from "./discord/discordRoleSync";
import { invalidateCachedAppUser } from "./dbCircuitBreaker";
import { getStripe } from "./stripe/client";
import { billingAlert } from "./_core/billingAlerts";
import bcrypt from "bcryptjs";

/**
 * Discord role syncs are deferred until AFTER the webhook has been acknowledged.
 * They are outbound HTTP calls; holding them inside the acknowledged path pushes
 * the response toward Stripe's delivery timeout, and a timeout triggers a
 * redelivery of an event we already fulfilled (WBHK-005).
 */
const deferredRoleSyncs: Array<() => Promise<void>> = [];
function deferRoleSync(fn: () => Promise<void>): void {
  deferredRoleSyncs.push(fn);
}
async function flushDeferredRoleSyncs(): Promise<void> {
  const pending = deferredRoleSyncs.splice(0, deferredRoleSyncs.length);
  for (const fn of pending) {
    try { await fn(); } catch (err) {
      console.warn(`[Stripe][RoleSync] deferred sync failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * How long a webhook-created pending account stays claimable via its checkout
 * session id. Exported so the setup procedure enforces the same window.
 */
export const PENDING_SETUP_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Slack added to a renewal's entitlement window. Stripe bills on calendar
 * months (28–31 days) while the DB plan windows are exact day counts, so an
 * unbuffered expiry locked paying subscribers out for up to a day before the
 * renewal invoice fired (LIFE-002). It also covers webhook delivery lag.
 */
export const RENEWAL_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Claim an event id (WBHK-001). Returns false when this event was already
 * processed, in which case the caller must do nothing at all.
 *
 * The UNIQUE index on stripeEventId is the authority — we insert first and let
 * a duplicate-key error mean "already handled", which is race-safe against two
 * concurrent deliveries of the same event in a way a SELECT-then-INSERT is not.
 */
async function claimStripeEvent(event: Stripe.Event): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("[Stripe][Idempotency] database not available — cannot claim event");
  try {
    await db.insert(stripeWebhookEvents).values({
      stripeEventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      eventCreatedAt: event.created * 1000,
      processedAt: Date.now(),
      status: "processed",
    });
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? "";
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "ER_DUP_ENTRY" || /duplicate/i.test(msg)) return false;
    throw err;
  }
}

/**
 * Out-of-order guard (WBHK-003). Stripe does not promise ordered delivery, and
 * applying a stale `customer.subscription.updated` after a `deleted` silently
 * restored a cancelled subscriber's access. Any subscription event older than
 * the last one we applied for this user is ignored.
 */
export function isStaleEvent(user: { lastStripeEventAt?: number | null } | null | undefined, eventCreatedMs: number): boolean {
  const watermark = user?.lastStripeEventAt ?? null;
  return watermark != null && eventCreatedMs < watermark;
}

/**
 * Append-only audit row for every entitlement change (OPS-002). Best-effort:
 * the audit trail must never be the reason a fulfilment fails, but its absence
 * is logged loudly because reconstructing "why did this user lose access" later
 * depends on it.
 */
async function recordEntitlementEvent(params: {
  userId: number;
  stripeEventId: string | null;
  eventType: string;
  reason: string;
  actor?: string;
  before?: { hasAccess?: boolean | null; planId?: string | null; expiryDate?: number | null };
  after?: { hasAccess?: boolean | null; planId?: string | null; expiryDate?: number | null };
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(entitlementEvents).values({
      userId: params.userId,
      stripeEventId: params.stripeEventId,
      eventType: params.eventType,
      reason: params.reason,
      actor: params.actor ?? "webhook",
      beforeHasAccess: params.before?.hasAccess ?? null,
      afterHasAccess: params.after?.hasAccess ?? null,
      beforePlanId: params.before?.planId ?? null,
      afterPlanId: params.after?.planId ?? null,
      beforeExpiryDate: params.before?.expiryDate ?? null,
      afterExpiryDate: params.after?.expiryDate ?? null,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error(`[Stripe][Audit] FAILED to record entitlement event userId=${params.userId} reason=${params.reason}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Billing-interval (plan_prices) resolution ────────────────────────────────
/**
 * The subset of a `{ plan, price }` mapping (getPriceById) this module needs:
 * the plan_prices ROW ID, which is what app_users.planPriceId stores.
 */
type ResolvedPriceRow = { price: { id: number } };

/** Where a resolved planPriceId came from — logged verbatim, never guessed. */
export type PlanPriceSource = "purchased_price_id" | "line_item_price" | "none";

export interface PlanPriceResolution {
  /** plan_prices.id, or null when this purchase maps to NO plan_prices row. */
  planPriceId: number | null;
  source: PlanPriceSource;
}

/**
 * Which billing interval (plan_prices row) a checkout actually bought.
 *
 * Same precedence as the plan/expiry resolver above, and deliberately derived
 * from the SAME resolved rows so the slug and the interval can never disagree:
 *  1) the price pinned in `metadata.price_id` at checkout (getPriceById), then
 *  2) the price reverse-mapped from the session's line items.
 *
 * null is a real, correct answer — the legacy static plans (monthly/annual/
 * pro/sharp/operator) live in `server/stripe/products.ts`, not in plan_prices,
 * so they HAVE no row id. Writing a made-up id would silently attribute those
 * subscribers to some other plan's interval, which is worse than "unknown".
 */
export function resolvePlanPriceId(input: {
  byPurchasedPrice?: ResolvedPriceRow | null;
  byLineItemPrice?: ResolvedPriceRow | null;
}): PlanPriceResolution {
  if (input.byPurchasedPrice) {
    return { planPriceId: input.byPurchasedPrice.price.id, source: "purchased_price_id" };
  }
  if (input.byLineItemPrice) {
    return { planPriceId: input.byLineItemPrice.price.id, source: "line_item_price" };
  }
  return { planPriceId: null, source: "none" };
}

export interface RenewalPlanPriceResolution {
  /**
   * What the renewal should WRITE. `undefined` means "do not touch the column".
   * A renewal that cannot map its invoice to a plan_prices row must not null out
   * a value that is already correct — losing a good id is worse than not
   * refreshing it, and nothing about a renewal proves the interval changed.
   */
  planPriceId: number | undefined;
  /** What the row will hold afterwards — logged, so a no-op is explainable. */
  effective: number | null;
  reason: "invoice_price" | "unresolved_keep_existing";
}

/**
 * Keep planPriceId current across renewals. A subscriber repriced onto a new
 * plan_prices row (an interval edit mints a NEW row and archives the old one)
 * must end up pointing at the row they are actually billed at now.
 */
export function resolveRenewalPlanPriceId(input: {
  byInvoicePrice?: ResolvedPriceRow | null;
  current?: number | null;
}): RenewalPlanPriceResolution {
  const current = input.current ?? null;
  if (input.byInvoicePrice) {
    const id = input.byInvoicePrice.price.id;
    return { planPriceId: id, effective: id, reason: "invoice_price" };
  }
  return { planPriceId: undefined, effective: current, reason: "unresolved_keep_existing" };
}

/**
 * The Stripe price id billed on an invoice's first line.
 *
 * Two shapes are accepted on purpose: the 2025 API versions moved the price
 * behind `pricing.price_details.price` (a bare id string), while older/replayed
 * payloads still carry the expanded `price` object. Reading only one of them
 * would silently return null for half the traffic — and a null here means "do
 * not update the interval", so the failure would be invisible.
 */
export function extractInvoicePriceId(invoice: unknown): string | null {
  const line = (invoice as {
    lines?: {
      data?: Array<{
        pricing?: { price_details?: { price?: string | null } | null } | null;
        price?: { id?: string | null } | string | null;
      }>;
    };
  })?.lines?.data?.[0];
  if (!line) return null;
  const fromPricing = line.pricing?.price_details?.price;
  if (typeof fromPricing === "string" && fromPricing) return fromPricing;
  const legacy = line.price;
  if (typeof legacy === "string" && legacy) return legacy;
  if (legacy && typeof legacy === "object" && typeof legacy.id === "string" && legacy.id) return legacy.id;
  return null;
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
  /**
   * Which plan_prices row (billing interval) this grant is for.
   *   number    → persist it.
   *   null      → this purchase maps to NO plan_prices row (legacy static plan);
   *               clear the column rather than leave a stale interval pointing
   *               at some other plan's price.
   *   undefined → caller cannot say; leave whatever is stored untouched.
   * Nothing wrote this column before, so every paid signup landed with a plan
   * and a NULL interval — invisible to the app_users_plan_price_idx seek that
   * answers "who is on this interval?" until someone backfilled by hand.
   */
  planPriceId?: number | null;
  expiryMs: number;
  /** Stripe event id for the audit trail; null for non-webhook callers. */
  stripeEventId?: string | null;
  eventType?: string;
  /** Raw Stripe subscription status, persisted so dunning states are visible. */
  subscriptionStatus?: string | null;
  /** event.created (ms) — stamped as the out-of-order watermark. */
  eventCreatedMs?: number | null;
}): Promise<void> {
  const tag = "[Stripe][DB][grantUserAccess]";
  const db = await getDb();
  if (!db) {
    console.error(`${tag} [VERIFY] FAIL — database not available`);
    throw new Error(`${tag} database not available — cannot grant access userId=${params.userId}`);
  }

  const before = await getAppUserById(params.userId);

  console.log(`${tag} [STEP] Granting access userId=${params.userId} planId=${params.planId} planPriceId=${params.planPriceId === undefined ? "(unchanged)" : params.planPriceId} expiryMs=${params.expiryMs}`);
  const updateValues: Partial<typeof appUsers.$inferInsert> = {
    hasAccess: true,
    expiryDate: params.expiryMs,
    stripeCustomerId: params.stripeCustomerId,
    stripePlanId: params.planId,
  };
  // `undefined` is the only value that means "leave it alone" — an explicit
  // null is a decision (this plan has no plan_prices row) and IS written.
  if (params.planPriceId !== undefined) {
    updateValues.planPriceId = params.planPriceId;
    if (params.planPriceId === null) {
      console.warn(`${tag} [STATE] planPriceId=null — plan "${params.planId}" has no plan_prices row (legacy static plan); interval recorded as unknown userId=${params.userId}`);
    }
  } else {
    console.log(`${tag} [STATE] No planPriceId provided — leaving existing interval untouched userId=${params.userId}`);
  }
  // An empty/absent subscription id (e.g. a mode:"payment" session with no
  // subscription attached) must never clobber a real subscriber's existing id.
  if (params.stripeSubscriptionId) {
    updateValues.stripeSubscriptionId = params.stripeSubscriptionId;
  } else {
    console.log(`${tag} [STATE] No stripeSubscriptionId provided — leaving existing value untouched userId=${params.userId}`);
  }
  if (params.subscriptionStatus) updateValues.stripeSubscriptionStatus = params.subscriptionStatus;
  if (params.eventCreatedMs) updateValues.lastStripeEventAt = params.eventCreatedMs;
  // A fresh grant supersedes any earlier cancel-at-period-end intent; leaving it
  // set made a brand-new subscription render as "cancel_scheduled" (LIFE-003).
  updateValues.cancelAtPeriodEnd = false;

  await db.update(appUsers).set(updateValues).where(eq(appUsers.id, params.userId));

  invalidateAppUserByIdCache(params.userId);
  invalidateCachedAppUser(params.userId);
  console.log(`${tag} [OUTPUT] Access granted userId=${params.userId} plan=${params.planId} planPriceId=${params.planPriceId === undefined ? "(unchanged)" : params.planPriceId} expiry=${new Date(params.expiryMs).toISOString()}`);

  await recordEntitlementEvent({
    userId: params.userId,
    stripeEventId: params.stripeEventId ?? null,
    eventType: params.eventType ?? "grant",
    reason: "GRANT",
    before: { hasAccess: before?.hasAccess ?? null, planId: before?.stripePlanId ?? null, expiryDate: before?.expiryDate ?? null },
    after: { hasAccess: true, planId: params.planId, expiryDate: params.expiryMs },
  });

  // Discord role: only grant if account setup is complete. Deferred until after
  // the webhook is acknowledged — see deferRoleSync (WBHK-005).
  const user = await getAppUserById(params.userId);
  if (user && !user.pendingSetup) {
    console.log(`${tag} [STATE] pendingSetup=false — Discord role sync queued userId=${params.userId}`);
    deferRoleSync(async () => {
      const r = await syncDiscordRoleForUser(user, true);
      console.log(`${tag} [STATE] Discord sync: action=${r.action} reason=${r.reason}`);
    });
  } else if (user?.pendingSetup) {
    console.log(`${tag} [STATE] pendingSetup=true — Discord role deferred until account setup`);
  }
  console.log(`${tag} [VERIFY] PASS`);
}

/**
 * Revoke subscription access by Stripe Customer ID.
 * Discord role is revoked immediately.
 */
async function revokeUserAccessByCustomerId(
  stripeCustomerId: string,
  opts: { stripeEventId?: string | null; eventType?: string; reason?: string; subscriptionStatus?: string | null; eventCreatedMs?: number | null } = {},
): Promise<void> {
  const tag = "[Stripe][DB][revokeUserAccess]";
  const db = await getDb();
  // MUST throw, not return: the caller turns a throw into a 5xx so Stripe
  // redelivers. Silently returning here dropped revokes permanently (WBHK-002).
  if (!db) {
    console.error(`${tag} [VERIFY] FAIL — database not available`);
    throw new Error(`${tag} database not available — cannot revoke access customer=${stripeCustomerId}`);
  }

  // Read BEFORE the update so the audit row captures the prior state.
  const user = await getAppUserByStripeCustomerId(stripeCustomerId);

  console.log(`${tag} [STEP] Revoking access stripeCustomerId=${stripeCustomerId} reason=${opts.reason ?? "SUBSCRIPTION_DELETED"}`);
  await db.update(appUsers).set({
    hasAccess: false,
    stripeSubscriptionId: null,
    stripePlanId: null,
    cancelAtPeriodEnd: false,
    ...(opts.subscriptionStatus ? { stripeSubscriptionStatus: opts.subscriptionStatus } : {}),
    ...(opts.eventCreatedMs ? { lastStripeEventAt: opts.eventCreatedMs } : {}),
  }).where(eq(appUsers.stripeCustomerId, stripeCustomerId));

  if (user) {
    invalidateAppUserByIdCache(user.id);
    invalidateCachedAppUser(user.id);
    await recordEntitlementEvent({
      userId: user.id,
      stripeEventId: opts.stripeEventId ?? null,
      eventType: opts.eventType ?? "revoke",
      reason: opts.reason ?? "SUBSCRIPTION_DELETED",
      before: { hasAccess: user.hasAccess, planId: user.stripePlanId ?? null, expiryDate: user.expiryDate ?? null },
      after: { hasAccess: false, planId: null, expiryDate: user.expiryDate ?? null },
    });
    console.log(`${tag} [STATE] Discord role revoke queued userId=${user.id}`);
    deferRoleSync(async () => {
      const r = await syncDiscordRoleForUser(user, false);
      console.log(`${tag} [STATE] Discord revoke: action=${r.action} reason=${r.reason}`);
    });
  } else {
    console.warn(`${tag} [STATE] no app_user matched customer=${stripeCustomerId} — nothing to revoke`);
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
  /**
   * plan_prices row purchased, or null when the plan has none (legacy static
   * plan). Persisted on the INSERT: this is one of only two code paths that
   * ever creates an app_users row, so a miss here mints a member the
   * per-interval queries cannot see until someone backfills by hand.
   */
  planPriceId?: number | null;
  expiryMs: number;
  stripeEventId?: string | null;
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
  console.log(`${tag} [INPUT] sessionId=${params.sessionId} username=${username} email=${params.email} plan=${params.planId} planPriceId=${params.planPriceId ?? "(none)"}`);

  // [STEP 2] Check username collision
  const byUsername = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.username, username)).limit(1);
  if (byUsername.length > 0) {
    username = `${username}_${Math.random().toString(36).slice(2, 5)}`;
    console.warn(`${tag} [STATE] Username collision — using: ${username}`);
  }

  // [STEP 3] Email collision.
  //
  // The email here is buyer-TYPED at Stripe checkout and is never verified, so
  // it is not proof of identity. Attaching on a bare match let anyone who knew a
  // subscriber's address rebind that account's Stripe customer — exposing the
  // buyer's invoices, card last4 and billing address on the victim's billing
  // tab, and pointing later revocations at the wrong row (STRIPE-001).
  //
  // Rule: attach ONLY when the matched account has no Stripe customer yet (the
  // ordinary "beta user buys for the first time" case). If it already carries a
  // DIFFERENT customer id, refuse, alert, and leave both rows untouched for an
  // operator to resolve. Refusing is deliberate — retrying cannot fix a genuine
  // identity conflict, so this must not become a Stripe retry loop.
  const byEmail = await db
    .select({ id: appUsers.id, stripeCustomerId: appUsers.stripeCustomerId })
    .from(appUsers)
    .where(eq(appUsers.email, params.email))
    .limit(1);
  if (byEmail.length > 0) {
    const existing = byEmail[0];
    const existingCustomer = existing.stripeCustomerId ?? "";
    if (existingCustomer && existingCustomer !== params.stripeCustomerId) {
      console.error(
        `${tag} [VERIFY] FAIL — customer-link conflict userId=${existing.id}: account already linked to a different Stripe customer. ` +
        `Refusing to rebind; manual reconciliation required. sessionId=${params.sessionId}`
      );
      await recordEntitlementEvent({
        userId: existing.id,
        stripeEventId: params.stripeEventId ?? null,
        eventType: "checkout.session.completed",
        reason: "CUSTOMER_LINK_CONFLICT_REFUSED",
        before: { hasAccess: null, planId: null, expiryDate: null },
        after: { hasAccess: null, planId: null, expiryDate: null },
      });
      void billingAlert("CUSTOMER_LINK_CONFLICT", {
        userId: existing.id,
        sessionId: params.sessionId,
        existingCustomer,
        incomingCustomer: params.stripeCustomerId,
        note: "Anonymous checkout matched an existing account by unverified email, but that account is linked to a different Stripe customer. Payment captured; entitlement NOT granted.",
      });
      return null;
    }
    console.warn(`${tag} [STATE] Email matches an account with no existing Stripe customer userId=${existing.id} — attaching`);
    await grantUserAccess({
      userId: existing.id,
      stripeCustomerId: params.stripeCustomerId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      planId: params.planId,
      planPriceId: params.planPriceId ?? null,
      expiryMs: params.expiryMs,
      stripeEventId: params.stripeEventId ?? null,
      eventType: "checkout.session.completed",
    });
    return existing.id;
  }

  // [STEP 4] Create pending account with placeholder password
  const placeholderPw = `Pending_${Math.random().toString(36).slice(2, 12)}!`;
  const passwordHash = await bcrypt.hash(placeholderPw, 10);

  // The setup claim expires: possession of a checkout session id is otherwise a
  // permanent, unauthenticated right to set this account's email and password
  // (AUTH-001). 72h is generous for a real buyer finishing signup.
  const pendingSetupExpiresAt = Date.now() + PENDING_SETUP_TTL_MS;

  const insertResult = await db.insert(appUsers).values({
    username,
    email: params.email,
    passwordHash,
    hasAccess: true,
    expiryDate: params.expiryMs,
    stripeCustomerId: params.stripeCustomerId,
    stripeSubscriptionId: params.stripeSubscriptionId,
    stripePlanId: params.planId,
    planPriceId: params.planPriceId ?? null,
    role: "user",
    termsAccepted: false,
    pendingSetup: true,
    pendingEmail: params.email,
    pendingUsername: username,
    pendingStripeSessionId: params.sessionId,
    pendingSetupExpiresAt,
  });

  // [STEP 5] Prefer the driver's insertId over re-selecting by a column we just
  // wrote — the old lookup round-tripped through a non-unique column (LEDG-003).
  let newUserId = Number((insertResult as unknown as { insertId?: number })?.insertId ?? 0);
  if (!newUserId) {
    const newUser = await db.select({ id: appUsers.id }).from(appUsers)
      .where(eq(appUsers.pendingStripeSessionId, params.sessionId)).limit(1);
    if (!newUser.length) {
      console.error(`${tag} [VERIFY] FAIL — could not retrieve new user for sessionId=${params.sessionId}`);
      return null;
    }
    newUserId = newUser[0].id;
  }

  await recordEntitlementEvent({
    userId: newUserId,
    stripeEventId: params.stripeEventId ?? null,
    eventType: "checkout.session.completed",
    reason: "PENDING_ACCOUNT_CREATED",
    after: { hasAccess: true, planId: params.planId, expiryDate: params.expiryMs },
  });
  console.log(`${tag} [OUTPUT] Pending account created userId=${newUserId} username=${username} plan=${params.planId} planPriceId=${params.planPriceId ?? "null (no plan_prices row)"}`);
  console.log(`${tag} [STATE] pendingSetup=true — Discord role deferred until account setup`);
  console.log(`${tag} [VERIFY] PASS`);
  return newUserId;
}

// ─── Webhook event processor ──────────────────────────────────────────────────
/**
 * Resolve a plan slug → { slug, expiryMs } for fulfillment.
 *  - Legacy static plans (monthly/annual/pro/sharp/operator): the EXACT existing
 *    behaviour — normalizePlanId + computeExpiryMs buffers, unchanged.
 *  - Owner-created DB plans: keep the real slug (never coerced to "monthly") and
 *    derive expiry from the plan's default price.
 *  - Unknown: legacy default ("monthly").
 */
async function resolvePlanExpiry(rawSlug: string | null | undefined): Promise<{ slug: string; expiryMs: number }> {
  const s = rawSlug?.trim();
  if (s && Object.prototype.hasOwnProperty.call(PLANS, s)) {
    const slug = normalizePlanId(s);
    return { slug, expiryMs: computeExpiryMs(slug) };
  }
  if (s) {
    const plan = await getPlanBySlug(s);
    if (plan) {
      const price = defaultPriceOf(plan);
      const exp = price ? computeExpiryMsForPrice(price, plan, Date.now()) : null;
      return { slug: plan.slug, expiryMs: exp ?? computeExpiryMs("monthly") };
    }
  }
  const slug = normalizePlanId(s);
  return { slug, expiryMs: computeExpiryMs(slug) };
}

async function processWebhookEvent(event: Stripe.Event): Promise<void> {
  const tag = `[Stripe][Webhook][${event.type}][${event.id}]`;
  console.log(`${tag} Processing at ${new Date(event.created * 1000).toISOString()}`);

  // Owner-only TEST-mode events (Phase 2.5): the signature is already verified
  // (against STRIPE_TEST_WEBHOOK_SECRET). We acknowledge them but NEVER apply
  // fulfillment to production data — a Stripe test card must not mint a real
  // subscriber account or grant live access. The grant code path is identical
  // for live events, so exercising the sandbox flow still validates plumbing
  // (checkout → price-by-mode → Stripe → webhook delivery → signature) without
  // this branch mutating the prod users table.
  if (event.livemode === false) {
    console.log(`${tag} [STATE] Test-mode event (livemode=false) — verified & acknowledged; production fulfillment intentionally skipped`);
    return;
  }

  // Exactly-once gate (WBHK-001). Stripe delivers at least once, and this
  // handler deliberately returns 5xx on failure to invite redelivery — without
  // this claim a retry re-ran every side effect, double-decrementing the
  // limited-quantity counter and re-extending expiry from the new wall clock.
  const claimed = await claimStripeEvent(event);
  if (!claimed) {
    console.log(`${tag} [STATE] Duplicate delivery — already processed; no-op`);
    return;
  }

  const eventCreatedMs = event.created * 1000;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`${tag} [INPUT] session_id=${session.id} customer=${session.customer} payment_status=${session.payment_status}`);
      console.log(`${tag}   client_reference_id=${session.client_reference_id} customer_email=${session.customer_details?.email ?? "(none)"}`);
      console.log(`${tag}   metadata=${JSON.stringify(session.metadata)}`);

      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        console.warn(`${tag} [STATE] payment_status=${session.payment_status} — skipping`); break;
      }

      // Plan + expiry resolution, MOST PRECISE FIRST:
      //  1) metadata.price_id — the EXACT interval purchased (pinned at checkout).
      //     This is what lets a "Lifetime" interval grant lifetime access even
      //     though its plan's DEFAULT interval is recurring, and gives a shared
      //     per-interval checkout link the entitlement window of that interval.
      //     Legacy static price ids aren't in the DB price map, so they harmlessly
      //     fall through to (2).
      //  2) metadata.plan_id — static plan OR the DB plan's default price.
      //  3) line items — last-resort reverse map (static env map, then DB price).
      // A $499 purchase can never silently provision as "monthly" while any
      // resolver still matches.
      let plan: string;
      let expiryMs: number;
      // The plan_prices row this session actually charged, when the price maps
      // to one. Captured alongside the slug (never re-derived later) so
      // app_users.planPriceId records the interval the buyer is billed at.
      let byLineItemPrice: Awaited<ReturnType<typeof getPriceById>> = null;
      const purchasedPriceId = session.metadata?.price_id?.trim();
      const byPurchasedPrice = purchasedPriceId ? await getPriceById(purchasedPriceId) : null;
      if (byPurchasedPrice) {
        plan = byPurchasedPrice.plan.slug;
        expiryMs =
          computeExpiryMsForPrice(byPurchasedPrice.price, byPurchasedPrice.plan, Date.now()) ??
          computeExpiryMs("monthly");
        console.log(`${tag} [STATE] resolved from purchased price_id=${purchasedPriceId} → plan="${plan}" expiry=${new Date(expiryMs).toISOString()}`);
      } else {
        const resolved = await resolvePlanExpiry(session.metadata?.plan_id);
        plan = resolved.slug;
        expiryMs = resolved.expiryMs;
        if (!session.metadata?.plan_id) {
          try {
            const items = await getStripe().checkout.sessions.listLineItems(session.id, { limit: 1 });
            const priceId = items.data[0]?.price?.id;
            const staticMapped = priceId ? getPlanByPriceId(priceId) : null;
            if (staticMapped) {
              plan = staticMapped.id;
              expiryMs = computeExpiryMs(staticMapped.id);
              console.warn(`${tag} [STATE] plan_id absent — resolved "${plan}" from price=${priceId}`);
            } else if (priceId) {
              const dbMapped = await getPriceById(priceId);
              if (dbMapped) {
                byLineItemPrice = dbMapped;
                plan = dbMapped.plan.slug;
                expiryMs = computeExpiryMsForPrice(dbMapped.price, dbMapped.plan, Date.now()) ?? expiryMs;
                console.warn(`${tag} [STATE] plan_id absent — resolved DB plan "${plan}" from price=${priceId}`);
              } else {
                console.error(`${tag} [VERIFY] FAIL — price ${priceId} not in any plan map; defaulting to "${plan}"`);
              }
            } else {
              console.error(`${tag} [VERIFY] FAIL — no price on session; defaulting to "${plan}"`);
            }
          } catch (err) {
            console.error(`${tag} [VERIFY] FAIL — could not list line items: ${err instanceof Error ? err.message : String(err)}; defaulting to "${plan}"`);
          }
        }
      }
      // Billing interval, from the SAME rows the slug came from. A null here is
      // reported plainly — legacy static plans have no plan_prices row, and an
      // invented id would attribute the member to someone else's interval.
      const { planPriceId, source: planPriceSource } = resolvePlanPriceId({ byPurchasedPrice, byLineItemPrice });
      if (planPriceId === null) {
        console.warn(`${tag} [STATE] planPriceId unresolved for plan="${plan}" (no plan_prices row — legacy static plan or unmapped price); persisting NULL`);
      } else {
        console.log(`${tag} [STATE] planPriceId=${planPriceId} source=${planPriceSource}`);
      }

      const stripeCustomerId = typeof session.customer === "string" ? session.customer : (session.customer as Stripe.Customer | null)?.id ?? "";
      const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription as Stripe.Subscription | null)?.id ?? "";

      if (!stripeCustomerId) { console.error(`${tag} [VERIFY] FAIL — no stripeCustomerId`); break; }

      const userIdStr = session.client_reference_id ?? session.metadata?.user_id;

      if (userIdStr) {
        // EXISTING USER PATH
        const userId = parseInt(userIdStr, 10);
        if (isNaN(userId)) { console.error(`${tag} [VERIFY] FAIL — invalid user_id="${userIdStr}"`); break; }
        console.log(`${tag} [STATE] Existing user path userId=${userId} plan=${plan}`);
        await grantUserAccess({
          userId, stripeCustomerId, stripeSubscriptionId, planId: plan, planPriceId, expiryMs,
          stripeEventId: event.id, eventType: event.type, eventCreatedMs,
        });
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
          planPriceId,
          expiryMs,
          stripeEventId: event.id,
        });
        if (newUserId) {
          console.log(`${tag} [OUTPUT] Fulfillment complete (new user) userId=${newUserId} plan=${plan}`);
        } else {
          console.error(`${tag} [VERIFY] FAIL — new user creation returned null sessionId=${session.id}`);
        }
      }
      // Limited-quantity FOMO: one confirmed subscribe decrements the plan's
      // available spots (and triggers an auto-restock reset when configured).
      // Best-effort — a counter hiccup must never fail fulfillment. Renewals
      // (invoice.paid) intentionally do NOT decrement; only new checkouts do.
      try {
        await applyPurchaseToPlanQuantity(plan);
      } catch (err) {
        console.warn(`${tag} [STATE] quantity update failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
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
        // LIFE-001: past_due / unpaid / paused previously vanished entirely —
        // the user silently rode the expiry buffer and then hard-locked with a
        // generic error. Persist the raw status so the billing UI can surface a
        // payment problem and reconciliation can see it. Access is deliberately
        // unchanged: Stripe is still retrying, and revocation stays tied to
        // customer.subscription.deleted.
        const statusCustomerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as Stripe.Customer | null)?.id ?? "";
        if (statusCustomerId) {
          const statusDb = await getDb();
          if (statusDb) {
            await statusDb.update(appUsers)
              .set({ stripeSubscriptionStatus: sub.status, lastStripeEventAt: eventCreatedMs })
              .where(eq(appUsers.stripeCustomerId, statusCustomerId));
            const su = await getAppUserByStripeCustomerId(statusCustomerId);
            if (su) {
              invalidateAppUserByIdCache(su.id);
              invalidateCachedAppUser(su.id);
              await recordEntitlementEvent({
                userId: su.id,
                stripeEventId: event.id,
                eventType: event.type,
                reason: `STATUS_${sub.status.toUpperCase()}`,
                before: { hasAccess: su.hasAccess, planId: su.stripePlanId ?? null, expiryDate: su.expiryDate ?? null },
                after: { hasAccess: su.hasAccess, planId: su.stripePlanId ?? null, expiryDate: su.expiryDate ?? null },
              });
            }
          }
        }
        console.log(`${tag} [STATE] status=${sub.status} — access unchanged, status persisted`);
        break;
      }

      const subUserIdStr = sub.metadata?.user_id;
      if (!subUserIdStr) {
        console.log(`${tag} [STATE] No user_id in sub metadata — access handled by checkout.session.completed`); break;
      }
      const subUserId = parseInt(subUserIdStr, 10);
      if (isNaN(subUserId)) { console.error(`${tag} [VERIFY] FAIL — invalid user_id in sub metadata`); break; }

      // Ordering guard: a stale "active" update delivered after a cancellation
      // must not resurrect access (WBHK-003).
      const subUserBefore = await getAppUserById(subUserId);
      if (isStaleEvent(subUserBefore, eventCreatedMs)) {
        console.warn(`${tag} [STATE] Stale event (created=${new Date(eventCreatedMs).toISOString()} < watermark=${new Date(subUserBefore!.lastStripeEventAt!).toISOString()}) — ignoring`);
        break;
      }

      const { slug: subPlan, expiryMs: subExpiryMs } = await resolvePlanExpiry(sub.metadata?.plan_id);
      const subCustomerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as Stripe.Customer).id;

      // planPriceId is deliberately NOT passed: this branch resolves the plan
      // from `sub.metadata.plan_id` (a slug), which cannot identify WHICH
      // interval row was bought. Omitting it leaves the value written by
      // checkout.session.completed intact instead of overwriting it with a guess.
      await grantUserAccess({
        userId: subUserId,
        stripeCustomerId: subCustomerId,
        stripeSubscriptionId: sub.id,
        planId: subPlan,
        expiryMs: subExpiryMs,
        stripeEventId: event.id,
        eventType: event.type,
        subscriptionStatus: sub.status,
        eventCreatedMs,
      });
      console.log(`${tag} [OUTPUT] Subscription ${action} processed userId=${subUserId}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      console.log(`${tag} [INPUT] Subscription deleted sub_id=${sub.id} customer=${sub.customer}`);
      const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as Stripe.Customer).id;
      await revokeUserAccessByCustomerId(customerId, {
        stripeEventId: event.id,
        eventType: event.type,
        reason: "SUBSCRIPTION_DELETED",
        subscriptionStatus: sub.status,
        eventCreatedMs,
      });
      console.log(`${tag} [OUTPUT] Access revoked stripeCustomerId=${customerId}`);
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    // ── Money returned → entitlement must follow it (WBHK-004) ───────────────
    // Previously both of these fell through to the default branch, so a
    // refunded or disputing customer kept full access — permanently, for a
    // lifetime purchase — and no dispute was recorded anywhere.
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const refundCustomerId = typeof charge.customer === "string" ? charge.customer : (charge.customer as Stripe.Customer | null)?.id ?? "";
      const fullyRefunded = charge.amount_refunded >= charge.amount;
      console.log(`${tag} [INPUT] charge=${charge.id} customer=${refundCustomerId || "(none)"} amount=${charge.amount} refunded=${charge.amount_refunded} full=${fullyRefunded}`);
      if (!refundCustomerId) {
        console.error(`${tag} [VERIFY] FAIL — refund has no customer; cannot map to an account`);
        void billingAlert("REFUND_RECEIVED", { chargeId: charge.id, note: "Refund with no customer id — manual review required" });
        break;
      }
      if (fullyRefunded) {
        await revokeUserAccessByCustomerId(refundCustomerId, {
          stripeEventId: event.id,
          eventType: event.type,
          reason: "CHARGE_REFUNDED",
          eventCreatedMs,
        });
        console.log(`${tag} [OUTPUT] Access revoked after full refund customer=${refundCustomerId}`);
      } else {
        console.warn(`${tag} [STATE] Partial refund — access left intact, flagged for review`);
      }
      void billingAlert("REFUND_RECEIVED", {
        chargeId: charge.id,
        customerId: refundCustomerId,
        amount: charge.amount,
        amountRefunded: charge.amount_refunded,
        fullyRefunded,
      });
      console.log(`${tag} [VERIFY] PASS`);
      break;
    }

    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const disputeChargeId = typeof dispute.charge === "string" ? dispute.charge : (dispute.charge as Stripe.Charge | null)?.id ?? "";
      let disputeCustomerId = "";
      try {
        if (disputeChargeId) {
          const ch = await getStripe().charges.retrieve(disputeChargeId);
          disputeCustomerId = typeof ch.customer === "string" ? ch.customer : (ch.customer as Stripe.Customer | null)?.id ?? "";
        }
      } catch (err) {
        console.error(`${tag} [STATE] could not resolve customer for dispute: ${err instanceof Error ? err.message : String(err)}`);
      }
      console.log(`${tag} [INPUT] dispute=${dispute.id} charge=${disputeChargeId} customer=${disputeCustomerId || "(unresolved)"} amount=${dispute.amount} reason=${dispute.reason}`);
      // A dispute is money clawed back pending evidence. Revoke immediately —
      // continued consumption during a chargeback is unrecoverable loss — and
      // alert so evidence can be submitted before Stripe's deadline.
      if (disputeCustomerId) {
        await revokeUserAccessByCustomerId(disputeCustomerId, {
          stripeEventId: event.id,
          eventType: event.type,
          reason: "DISPUTE_OPENED",
          eventCreatedMs,
        });
      }
      void billingAlert("DISPUTE_OPENED", {
        disputeId: dispute.id,
        chargeId: disputeChargeId,
        customerId: disputeCustomerId || null,
        amount: dispute.amount,
        reason: dispute.reason,
        evidenceDueBy: dispute.evidence_details?.due_by ?? null,
      });
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
          const { slug: renewPlan, expiryMs: fallbackExpiry } = await resolvePlanExpiry(existingUser.stripePlanId);
          const invoiceSubId = (() => {
            const s = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | Stripe.Subscription } } }).parent?.subscription_details?.subscription;
            return typeof s === "string" ? s : (s as Stripe.Subscription | undefined)?.id ?? existingUser.stripeSubscriptionId ?? "";
          })();
          // Anchor the entitlement window to the period Stripe actually billed,
          // not to when this webhook happened to arrive (WBHK-006). Deriving it
          // from Date.now() drifted a little every cycle and let a replayed or
          // late invoice extend access for free. The grace buffer absorbs the
          // gap between an exact 30-day window and a 31-day calendar month,
          // which was locking paid subscribers out for a day (LIFE-002).
          const periodEndSec =
            (invoice as unknown as { lines?: { data?: Array<{ period?: { end?: number } }> } }).lines?.data?.[0]?.period?.end ??
            (invoice as unknown as { period_end?: number }).period_end ??
            null;
          const renewExpiry = periodEndSec
            ? periodEndSec * 1000 + RENEWAL_GRACE_MS
            : fallbackExpiry;
          // Keep the billing interval current: a subscriber repriced onto a new
          // plan_prices row must end up pointing at the row they are billed at
          // NOW. When the invoice's price maps to no row the stored value is
          // left alone — nulling a correct id is strictly worse than a stale
          // refresh, and a renewal is no evidence the interval changed.
          const invoicePriceId = extractInvoicePriceId(invoice);
          const byInvoicePrice = invoicePriceId ? await getPriceById(invoicePriceId) : null;
          const renewalPrice = resolveRenewalPlanPriceId({
            byInvoicePrice,
            current: existingUser.planPriceId ?? null,
          });
          console.log(
            `${tag} [STATE] Renewal userId=${existingUser.id} plan=${renewPlan} newExpiry=${new Date(renewExpiry).toISOString()}` +
            ` source=${periodEndSec ? "stripe_period_end+grace" : "plan_window_fallback"}` +
            ` invoicePrice=${invoicePriceId ?? "(none)"} planPriceId=${renewalPrice.effective ?? "null"} (${renewalPrice.reason})`
          );
          await grantUserAccess({
            userId: existingUser.id,
            stripeCustomerId: invoiceCustomerId,
            stripeSubscriptionId: invoiceSubId,
            planId: renewPlan,
            planPriceId: renewalPrice.planPriceId,
            expiryMs: renewExpiry,
            stripeEventId: event.id,
            eventType: event.type,
            subscriptionStatus: "active",
            eventCreatedMs,
          });
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
      // Verify against the live secret first, then the OPTIONAL test secret — so
      // test-mode events (from the owner-only test checkout, Phase 2.5) also
      // verify + fulfill. Each is a distinct HMAC secret; trying both never
      // weakens verification (an event still has to be signed by one of them).
      const liveSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const testSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
      const secrets = [liveSecret, testSecret].filter((s): s is string => !!s);

      if (secrets.length === 0) {
        console.error(`${tag} neither STRIPE_WEBHOOK_SECRET nor STRIPE_TEST_WEBHOOK_SECRET is set`);
        return res.status(400).json({ error: "webhook_secret_not_configured" });
      }
      if (!sig) {
        console.error(`${tag} Missing Stripe-Signature header`);
        return res.status(400).json({ error: "missing_signature_header" });
      }

      let event: Stripe.Event | null = null;
      let lastErr = "";
      for (const secret of secrets) {
        try {
          event = getStripe().webhooks.constructEvent(req.body, sig, secret);
          break;
        } catch (err: unknown) {
          lastErr = err instanceof Error ? err.message : String(err);
        }
      }
      if (!event) {
        // Log the library's reason, but do NOT echo it to the caller — it
        // distinguishes wrong-secret from stale-timestamp from mangled-body,
        // which is a free oracle for anyone probing the endpoint (WBHK-007).
        console.error(`${tag} Signature verification FAILED (tried ${secrets.length} secret(s)): ${lastErr}`);
        void billingAlert("WEBHOOK_SIGNATURE_FAILURE", { detail: lastErr, secretsTried: secrets.length });
        return res.status(400).json({ error: "signature_verification_failed" });
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
      // Every event that can CHANGE ENTITLEMENT is awaited and answered 5xx on
      // failure so Stripe redelivers. Revokes are in this set alongside grants:
      // a dropped revoke used to be acknowledged 200 and lost forever, leaving a
      // cancelled, refunded or disputing customer with access until their expiry
      // date — up to a year, or indefinitely on a lifetime row (WBHK-002).
      const ACCESS_CHANGING_EVENT_TYPES = new Set<string>([
        "checkout.session.completed",
        "invoice.paid",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "charge.refunded",
        "charge.dispute.created",
      ]);

      if (ACCESS_CHANGING_EVENT_TYPES.has(event.type)) {
        processWebhookEvent(event).then(
          () => {
            res.status(200).json({ received: true });
            // Outbound Discord calls run only AFTER the acknowledgement, so a
            // slow third party can never push us past Stripe's delivery timeout
            // and trigger a redelivery of work we already committed (WBHK-005).
            void flushDeferredRoleSyncs();
          },
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`${tag} Access-changing processing FAILED for ${event.id} (${event.type}) — responding 5xx so Stripe retries: ${msg}`);
            void billingAlert("WEBHOOK_PROCESSING_FAILURE", { eventId: event.id, eventType: event.type, detail: msg });
            res.status(500).json({ error: "processing_failed" });
          }
        );
        return;
      }

      res.status(200).json({ received: true });
      processWebhookEvent(event)
        .then(() => flushDeferredRoleSyncs())
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`${tag} Async processing error for ${event.id}: ${msg}`);
          void billingAlert("WEBHOOK_PROCESSING_FAILURE", { eventId: event.id, eventType: event.type, detail: msg, nonBlocking: true });
        });
    }
  );
  console.log("[Stripe] Webhook route registered at POST /api/stripe/webhook");
}
