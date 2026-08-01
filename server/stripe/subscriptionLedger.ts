/**
 * Subscription lifecycle ledger writer.
 *
 * Records every subscription transition locally: creation, plan changes,
 * scheduled/reverted cancellations, status moves, deletion, renewals, and
 * trial/renewal previews. Before this, none of it was persisted — plan changes
 * route through the Stripe Customer Portal (the recommended pattern), which
 * means the ONLY trace of "who moved from which plan to which plan, and when"
 * lived inside Stripe. `entitlement_events` records that access changed and
 * `payment_events` that money moved, but no row carried a from→to transition,
 * so the database could not answer "who downgraded last month", "how many
 * cancellations were scheduled and then reverted", or "which subscription did
 * this renewal extend".
 *
 * Same separation as the other two ledgers: `kind` is what happened in the
 * subscription's life (Stripe's fact, or the member's request), `outcome` is
 * what WE did about it. A row where kind='renewed' but outcome='noop' is a
 * renewal that extended nobody — exactly the silent drop worth alerting on.
 *
 * DESIGN RULE, same as checkoutLedger and paymentLedger: bookkeeping must
 * never break the money path. Every function swallows its own errors and
 * returns a boolean. A ledger outage must not cause a webhook to 5xx, because
 * a 5xx makes Stripe redeliver an event we already fulfilled.
 */
import type Stripe from "stripe";
import { getDb } from "../db";
import { subscriptionEvents } from "../../drizzle/schema";
import { isDuplicateKeyError } from "../db";

const TAG = "[SubscriptionLedger]";

/** What happened in the subscription's life. */
export type SubscriptionKind =
  | "created"
  | "plan_changed"
  | "cancel_scheduled"
  | "cancel_reverted"
  | "status_changed"
  | "updated"
  | "deleted"
  | "renewed"
  | "trial_ending"
  | "renewal_upcoming";

/** What WE did in response — deliberately the same vocabulary as payment_events. */
export type SubscriptionOutcome = "recorded" | "granted" | "revoked" | "noop";

/** Who initiated it: Stripe delivery, the member in-app, the owner, or a sweep. */
export type SubscriptionActor = "webhook" | "user" | "owner" | "system";

export type RecordSubscriptionInput = {
  /** NULL for app-initiated actions (cancel/reactivate mutations). */
  stripeEventId?: string | null;
  /** Stripe event type, or a synthetic `app.*` type for in-app actions. */
  eventType: string;
  livemode: boolean;
  stripeSubscriptionId: string;
  stripeCustomerId?: string | null;
  userId?: number | null;
  kind: SubscriptionKind;
  outcome?: SubscriptionOutcome;
  outcomeReason?: string | null;
  /** Plan slugs (app_users.stripePlanId vocabulary). */
  fromPlanId?: string | null;
  toPlanId?: string | null;
  /** Stripe price ids — immutable, so they pin the exact SKU either side. */
  fromPriceId?: string | null;
  toPriceId?: string | null;
  /** Billing intervals ('day'|'week'|'month'|'year'), when known. */
  fromInterval?: string | null;
  toInterval?: string | null;
  /** Stripe subscription status AFTER this event. */
  status?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  /** End of the period this event governs, UTC ms. */
  periodEnd?: number | null;
  actor?: SubscriptionActor;
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
 * Record one subscription transition. Returns true when a row exists afterwards.
 *
 * Idempotent on (stripeEventId, kind): Stripe delivers at least once, and a
 * redelivery must not double-record a transition. stripeEventId is NULL for
 * app-initiated rows, which MySQL exempts from the unique constraint — correct,
 * because a member scheduling, reverting, and re-scheduling a cancellation is
 * three real acts, not one deduplicated one.
 */
export async function recordSubscriptionEvent(input: RecordSubscriptionInput): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`${TAG} [WARN] no database — ${input.eventType}/${input.stripeSubscriptionId} not recorded`);
      return false;
    }
    const now = Date.now();
    await db.insert(subscriptionEvents).values({
      stripeEventId: cap(input.stripeEventId, 255),
      eventType: cap(input.eventType, 64) ?? "unknown",
      livemode: input.livemode,
      stripeSubscriptionId: cap(input.stripeSubscriptionId, 64) ?? "unknown",
      stripeCustomerId: cap(input.stripeCustomerId, 64),
      userId: input.userId ?? null,
      kind: input.kind,
      outcome: input.outcome ?? "recorded",
      outcomeReason: cap(input.outcomeReason, 160),
      fromPlanId: cap(input.fromPlanId, 64),
      toPlanId: cap(input.toPlanId, 64),
      fromPriceId: cap(input.fromPriceId, 64),
      toPriceId: cap(input.toPriceId, 64),
      fromInterval: cap(input.fromInterval, 16),
      toInterval: cap(input.toInterval, 16),
      status: cap(input.status, 24),
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? null,
      periodEnd: input.periodEnd ?? null,
      actor: input.actor ?? "webhook",
      occurredAt: input.occurredAt ?? now,
      recordedAt: now,
    });

    // Transitions that end or shrink a membership surface at error level so
    // they are visible without a query; routine bookkeeping stays quiet.
    const loud = input.kind === "deleted" || input.kind === "cancel_scheduled" || input.outcome === "noop";
    const move =
      input.fromPriceId || input.toPriceId
        ? ` ${input.fromPriceId ?? "(none)"}→${input.toPriceId ?? "(none)"}`
        : "";
    const line =
      `${TAG} [STATE] ${input.eventType} ${input.stripeSubscriptionId} kind=${input.kind} outcome=${input.outcome ?? "recorded"}${move}` +
      (input.outcomeReason ? ` reason=${input.outcomeReason}` : "");
    if (loud) console.error(line);
    else console.log(line);
    return true;
  } catch (err) {
    // A redelivery of an already-recorded transition is the idempotency
    // guarantee working — never an error.
    if (isDuplicateKeyError(err)) {
      console.log(`${TAG} [STATE] ${input.eventType}/${input.stripeSubscriptionId} already recorded — idempotent no-op`);
      return true;
    }
    console.error(`${TAG} [FAIL] could not record ${input.eventType}/${input.stripeSubscriptionId}: ${(err as Error)?.message ?? err}`);
    return false;
  }
}

// ─── Pure classification of customer.subscription.updated ────────────────────

/** The fields of a subscription this module compares. All optional — Stripe's
 * `previous_attributes` is a sparse partial. */
export type SubscriptionSnapshot = {
  priceId?: string | null;
  interval?: string | null;
  status?: string | null;
  cancelAtPeriodEnd?: boolean | null;
};

export type SubscriptionDiff = {
  kind: Extract<SubscriptionKind, "plan_changed" | "cancel_scheduled" | "cancel_reverted" | "status_changed" | "updated">;
  detail: string;
};

/** Pull the comparable fields out of a live Stripe subscription object. */
export function snapshotOfSubscription(sub: Stripe.Subscription): SubscriptionSnapshot {
  const item = sub.items?.data?.[0];
  return {
    priceId: item?.price?.id ?? null,
    interval: item?.price?.recurring?.interval ?? null,
    status: sub.status ?? null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? null,
  };
}

/** Pull the comparable fields out of `event.data.previous_attributes`. Sparse:
 * a field Stripe did not report as changed comes back undefined. */
export function snapshotOfPreviousAttributes(prev: Record<string, unknown> | undefined | null): SubscriptionSnapshot {
  if (!prev) return {};
  const out: SubscriptionSnapshot = {};
  const items = prev["items"] as { data?: Array<{ price?: { id?: string; recurring?: { interval?: string } } }> } | undefined;
  const prevPrice = items?.data?.[0]?.price;
  if (prevPrice?.id !== undefined) out.priceId = prevPrice.id ?? null;
  if (prevPrice?.recurring?.interval !== undefined) out.interval = prevPrice.recurring.interval ?? null;
  if (prev["status"] !== undefined) out.status = (prev["status"] as string) ?? null;
  if (prev["cancel_at_period_end"] !== undefined) out.cancelAtPeriodEnd = Boolean(prev["cancel_at_period_end"]);
  return out;
}

/**
 * Classify what a customer.subscription.updated event MEANS.
 *
 * Priority order is deliberate: a plan change outranks a cancellation toggle
 * outranks a bare status move, because when Stripe reports several fields
 * changed at once the ledger should name the transition a human cares about
 * most. The classifier is pure so the priority order is testable without a
 * webhook in the loop.
 *
 * This is what closes the Customer Portal gap (avenue #3): the Portal never
 * calls our API, but every plan switch it performs fires
 * customer.subscription.updated with `previous_attributes.items`, which lands
 * here as kind='plan_changed' with both price ids.
 */
export function classifySubscriptionUpdate(prev: SubscriptionSnapshot, current: SubscriptionSnapshot): SubscriptionDiff {
  if (prev.priceId !== undefined && prev.priceId !== current.priceId) {
    return {
      kind: "plan_changed",
      detail: `price ${prev.priceId ?? "(none)"} → ${current.priceId ?? "(none)"}`,
    };
  }
  if (prev.cancelAtPeriodEnd !== undefined && prev.cancelAtPeriodEnd !== current.cancelAtPeriodEnd) {
    return current.cancelAtPeriodEnd
      ? { kind: "cancel_scheduled", detail: "cancel_at_period_end false → true" }
      : { kind: "cancel_reverted", detail: "cancel_at_period_end true → false" };
  }
  if (prev.status !== undefined && prev.status !== current.status) {
    return {
      kind: "status_changed",
      detail: `status ${prev.status ?? "(none)"} → ${current.status ?? "(none)"}`,
    };
  }
  return { kind: "updated", detail: "no tracked field changed" };
}

/**
 * The period end of a subscription in ms, tolerating the API-version move of
 * `current_period_end` from the subscription onto its items (the same shape
 * drift cancelSubscription already handles).
 */
export function subscriptionPeriodEndMs(sub: Stripe.Subscription): number | null {
  const itemEnd = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const raw = (sub as unknown as { cancel_at?: number | null }).cancel_at
    ?? itemEnd
    ?? (sub as unknown as { current_period_end?: number }).current_period_end
    ?? null;
  return raw != null ? raw * 1000 : null;
}
