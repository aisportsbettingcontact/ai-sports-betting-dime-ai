/**
 * Entitlement audit-trail writer (OPS-002), shared between the webhook and the
 * owner-facing admin mutations.
 *
 * This function used to live private inside stripeWebhook.ts, which meant only
 * Stripe-driven changes were audited: an owner creating a member with access,
 * flipping hasAccess in User Management, or running backfillEntitlement left NO
 * entitlement_events row — the exact blind spot that made "why does this user
 * have access with no plan?" unanswerable from the database (the rudedog case,
 * 2026-08-01). Every path that changes who can get in now writes the same
 * append-only record, with `actor` naming who did it.
 *
 * Best-effort by design: the audit trail must never be the reason a fulfilment
 * or an admin action fails, but its absence is logged loudly because
 * reconstructing "why did this user gain/lose access" later depends on it.
 */
import { getDb } from "../db";
import { entitlementEvents } from "../../drizzle/schema";

export type EntitlementSnapshot = {
  hasAccess?: boolean | null;
  planId?: string | null;
  expiryDate?: number | null;
};

export async function recordEntitlementEvent(params: {
  userId: number;
  stripeEventId: string | null;
  eventType: string;
  reason: string;
  /** 'webhook' (default) | 'owner' | 'admin' | 'cron' | 'backfill' */
  actor?: string;
  before?: EntitlementSnapshot;
  after?: EntitlementSnapshot;
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
    console.error(
      `[Stripe][Audit] FAILED to record entitlement event userId=${params.userId} reason=${params.reason}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
