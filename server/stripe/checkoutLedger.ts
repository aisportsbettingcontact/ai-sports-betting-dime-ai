/**
 * Checkout attempt ledger.
 *
 * Every Checkout Session is recorded here BEFORE the buyer leaves for Stripe,
 * and resolved when the webhook reports back. This exists because a checkout
 * previously lived only inside Stripe: the sole local trace was
 * `app_users.pendingStripeSessionId`, written only for logged-in buyers, so an
 * anonymous purchase left no row and an abandoned one left nothing at all.
 *
 * Two live payments were dropped without anyone noticing. The webhook bailed,
 * nothing recorded the bail, and the only evidence was a console line. This
 * module turns that class of failure into a row you can query.
 *
 * DESIGN RULE — never let ledger bookkeeping break the money path. Recording a
 * checkout is strictly observability; if the DB is unavailable, the buyer must
 * still reach Stripe, and a payment must still be fulfilled. Every function
 * here therefore swallows its own errors and reports success as a boolean.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { checkoutSessions } from "../../drizzle/schema";

const TAG = "[CheckoutLedger]";

/** Stripe-side lifecycle of the session. */
export type CheckoutStatus = "created" | "completed" | "expired";

/**
 * What WE did about the session — deliberately independent of `status`.
 * A session can be completed (Stripe took the money) yet dropped (we granted
 * nothing). Collapsing these two is what hid the incident.
 */
export type CheckoutFulfillment = "pending" | "fulfilled" | "dropped" | "skipped";

export type RecordCheckoutInput = {
  stripeSessionId: string;
  livemode: boolean;
  mode: string;
  userId?: number | null;
  planId?: string | null;
  planPriceId?: number | null;
  stripePriceId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  desiredUsername?: string | null;
  customerEmail?: string | null;
  stripeCustomerId?: string | null;
  origin?: string | null;
};

/** Trim to a column's max length so an over-long value can never abort the insert. */
function cap(v: string | null | undefined, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Record a checkout at creation time. Returns true when the row was written.
 *
 * Called on the redirect path, so it must be cheap and must never throw: a
 * ledger failure may not stop a buyer from paying.
 */
export async function recordCheckoutCreated(input: RecordCheckoutInput): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`${TAG} [WARN] no database — checkout ${input.stripeSessionId} not recorded`);
      return false;
    }
    await db.insert(checkoutSessions).values({
      stripeSessionId: input.stripeSessionId,
      livemode: input.livemode,
      mode: cap(input.mode, 16) ?? "unknown",
      status: "created",
      fulfillment: "pending",
      userId: input.userId ?? null,
      planId: cap(input.planId, 64),
      planPriceId: input.planPriceId ?? null,
      stripePriceId: cap(input.stripePriceId, 64),
      amountCents: input.amountCents ?? null,
      currency: cap(input.currency, 8),
      desiredUsername: cap(input.desiredUsername, 64),
      customerEmail: cap(input.customerEmail, 255),
      stripeCustomerId: cap(input.stripeCustomerId, 64),
      origin: cap(input.origin, 255),
      createdAt: Date.now(),
    });
    console.log(
      `${TAG} [STATE] recorded ${input.stripeSessionId} mode=${input.mode} plan=${input.planId ?? "(none)"} ` +
        `user=${input.userId ?? "anon"}`
    );
    return true;
  } catch (err) {
    // A duplicate is benign: Stripe's idempotency key can return the SAME
    // session for a double-click, and re-recording it is a no-op, not a fault.
    const msg = (err as Error)?.message ?? String(err);
    if (/duplicate|ER_DUP_ENTRY/i.test(msg)) {
      console.log(`${TAG} [STATE] ${input.stripeSessionId} already recorded — idempotent no-op`);
      return true;
    }
    console.error(`${TAG} [FAIL] could not record ${input.stripeSessionId}: ${msg}`);
    return false;
  }
}

export type ResolveCheckoutInput = {
  stripeSessionId: string;
  status: CheckoutStatus;
  fulfillment: CheckoutFulfillment;
  /** Required whenever fulfillment !== "fulfilled" — the whole point is knowing WHY. */
  reason?: string | null;
  userId?: number | null;
  customerEmail?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePaymentIntentId?: string | null;
  paymentStatus?: string | null;
  amountCents?: number | null;
  currency?: string | null;
};

/**
 * Resolve a checkout once the webhook has decided its outcome.
 *
 * Keyed on the UNIQUE stripeSessionId, so replays overwrite rather than
 * duplicate — safe under Stripe's at-least-once delivery.
 *
 * If no row exists (checkout created before this table shipped, or created by a
 * Payment Link outside our own flow) one is inserted, so a session that the app
 * never originated is still visible instead of silently absent.
 */
export async function resolveCheckout(input: ResolveCheckoutInput): Promise<boolean> {
  const now = Date.now();
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`${TAG} [WARN] no database — ${input.stripeSessionId} not resolved`);
      return false;
    }

    const patch = {
      status: input.status,
      fulfillment: input.fulfillment,
      fulfillmentReason: input.fulfillment === "fulfilled" ? null : cap(input.reason, 120),
      resolvedAt: now,
      ...(input.status === "completed" ? { completedAt: now } : {}),
      ...(input.userId != null ? { userId: input.userId } : {}),
      ...(input.customerEmail ? { customerEmail: cap(input.customerEmail, 255) } : {}),
      ...(input.stripeCustomerId ? { stripeCustomerId: cap(input.stripeCustomerId, 64) } : {}),
      ...(input.stripeSubscriptionId ? { stripeSubscriptionId: cap(input.stripeSubscriptionId, 64) } : {}),
      ...(input.stripePaymentIntentId ? { stripePaymentIntentId: cap(input.stripePaymentIntentId, 64) } : {}),
      ...(input.paymentStatus ? { paymentStatus: cap(input.paymentStatus, 32) } : {}),
      ...(input.amountCents != null ? { amountCents: input.amountCents } : {}),
      ...(input.currency ? { currency: cap(input.currency, 8) } : {}),
    };

    const res = await db
      .update(checkoutSessions)
      .set(patch)
      .where(eq(checkoutSessions.stripeSessionId, input.stripeSessionId));

    // drizzle/mysql2 reports affectedRows; 0 means we have never seen this session.
    const affected = (res as unknown as { affectedRows?: number })?.affectedRows ?? 0;
    if (affected === 0) {
      await db.insert(checkoutSessions).values({
        stripeSessionId: input.stripeSessionId,
        livemode: true,
        mode: "unknown",
        createdAt: now,
        ...patch,
      });
      console.log(`${TAG} [STATE] back-filled unseen session ${input.stripeSessionId} (originated outside this app)`);
    }

    const level = input.fulfillment === "dropped" ? "error" : "log";
    console[level === "error" ? "error" : "log"](
      `${TAG} [STATE] ${input.stripeSessionId} status=${input.status} fulfillment=${input.fulfillment}` +
        (input.fulfillment === "fulfilled" ? "" : ` reason=${input.reason ?? "(unspecified)"}`)
    );
    return true;
  } catch (err) {
    console.error(`${TAG} [FAIL] could not resolve ${input.stripeSessionId}: ${(err as Error)?.message ?? err}`);
    return false;
  }
}
