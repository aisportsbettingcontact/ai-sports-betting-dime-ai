/**
 * Payment ledger writer.
 *
 * Records every money movement locally: successful charges, failed renewals,
 * refunds, disputes. Before this, none of it was persisted — `entitlement_events`
 * recorded that access changed and `checkout_sessions` that a checkout resolved,
 * but no row carried an AMOUNT, so the database could not answer "what did we
 * collect", "which renewals failed", or "how much is in dispute".
 *
 * The failure paths matter most. `invoice.payment_failed` was three log lines
 * and a `break` — correct behaviour, since Stripe owns the retry schedule, but
 * completely invisible to us. Under a recurring model the first question is
 * which members are failing to pay, and that was unanswerable.
 *
 * DESIGN RULE, same as the checkout ledger: bookkeeping must never break the
 * money path. Every function swallows its own errors and returns a boolean. A
 * ledger outage must not cause a webhook to 5xx, because a 5xx makes Stripe
 * redeliver an event we already fulfilled.
 */
import { getDb } from "../db";
import { paymentEvents } from "../../drizzle/schema";
import { isDuplicateKeyError } from "../db";

const TAG = "[PaymentLedger]";

/** What happened to the money, as Stripe reports it. */
export type PaymentKind = "succeeded" | "failed" | "refunded" | "disputed" | "uncollectible";

/**
 * What WE did in response. Deliberately separate from `kind`: Stripe capturing
 * money and us granting access are different facts, and a row where
 * kind='succeeded' but outcome='noop' is exactly the silent drop worth alerting on.
 */
export type PaymentOutcome = "recorded" | "granted" | "revoked" | "noop";

export type RecordPaymentInput = {
  stripeEventId: string;
  eventType: string;
  livemode: boolean;
  objectId: string;
  objectType: string;
  kind: PaymentKind;
  outcome?: PaymentOutcome;
  outcomeReason?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  amountRefundedCents?: number | null;
  userId?: number | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
  customerEmail?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  attemptCount?: number | null;
  /** Stripe event timestamp in ms. Falls back to now when absent. */
  occurredAt?: number | null;
};

/** Trim to the column width so an over-long value can never abort the insert. */
function cap(v: string | null | undefined, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Record one money movement. Returns true when a row exists afterwards.
 *
 * Idempotent on (stripeEventId, objectId): Stripe delivers at least once, and a
 * redelivery must not double-count revenue. A duplicate is the guarantee
 * working, not an error.
 */
export async function recordPaymentEvent(input: RecordPaymentInput): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`${TAG} [WARN] no database — ${input.eventType}/${input.objectId} not recorded`);
      return false;
    }
    const now = Date.now();
    await db.insert(paymentEvents).values({
      stripeEventId: input.stripeEventId,
      eventType: cap(input.eventType, 64) ?? "unknown",
      livemode: input.livemode,
      objectId: cap(input.objectId, 64) ?? "unknown",
      objectType: cap(input.objectType, 32) ?? "unknown",
      kind: input.kind,
      outcome: input.outcome ?? "recorded",
      outcomeReason: cap(input.outcomeReason, 160),
      amountCents: input.amountCents ?? null,
      currency: cap(input.currency, 8),
      amountRefundedCents: input.amountRefundedCents ?? null,
      userId: input.userId ?? null,
      stripeCustomerId: cap(input.stripeCustomerId, 64),
      stripeSubscriptionId: cap(input.stripeSubscriptionId, 64),
      stripeInvoiceId: cap(input.stripeInvoiceId, 64),
      customerEmail: cap(input.customerEmail, 255),
      failureCode: cap(input.failureCode, 64),
      failureMessage: cap(input.failureMessage, 255),
      attemptCount: input.attemptCount ?? null,
      occurredAt: input.occurredAt ?? now,
      recordedAt: now,
    });

    // Failures and disputes are logged at error level so they surface without a
    // query. A successful charge is routine; a failed renewal is not.
    const loud = input.kind === "failed" || input.kind === "disputed" || input.outcome === "noop";
    const money = input.amountCents != null ? ` ${(input.amountCents / 100).toFixed(2)} ${(input.currency ?? "usd").toUpperCase()}` : "";
    const line =
      `${TAG} [STATE] ${input.eventType} ${input.objectId} kind=${input.kind} outcome=${input.outcome ?? "recorded"}${money}` +
      (input.outcomeReason ? ` reason=${input.outcomeReason}` : "") +
      (input.failureCode ? ` failure=${input.failureCode}` : "");
    if (loud) console.error(line);
    else console.log(line);
    return true;
  } catch (err) {
    // A redelivery of an already-recorded movement is the idempotency guarantee
    // working — never an error, and never a double-count.
    if (isDuplicateKeyError(err)) {
      console.log(`${TAG} [STATE] ${input.eventType}/${input.objectId} already recorded — idempotent no-op`);
      return true;
    }
    console.error(`${TAG} [FAIL] could not record ${input.eventType}/${input.objectId}: ${(err as Error)?.message ?? err}`);
    return false;
  }
}
