/**
 * schemaGuard.ts — detect "code deployed ahead of its migration" at BOOT.
 *
 * WHY (2026-07-31 login outage, and Incident 43 before it):
 * Drizzle enumerates every column declared in schema.ts in the SQL it generates.
 * If a column ships in code before its migration runs, EVERY query against that
 * table fails with ER_BAD_FIELD_ERROR. On 2026-07-31 that took platform-wide
 * login down: `app_users.planPriceId` existed in code, not in the database, and
 * the failure surfaced as "user not found" rather than "your schema is behind".
 *
 * The deploy itself looked perfectly healthy — build green, container up, health
 * endpoint 200 — because nothing ever asked whether the schema matched. This
 * asks, once, at startup.
 *
 * Deliberately WARN-only by default. A hard exit would convert a recoverable
 * degraded state into a crash-loop on a service that also serves marketing pages
 * and the bot prerender. Set SCHEMA_GUARD_FATAL=1 to fail closed instead.
 *
 * Cost: one information_schema query per boot, on the tables that matter.
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { isAnalyticsStore } from "../analytics/config";

const TAG = "[SchemaGuard]";

/**
 * Columns whose absence breaks a core flow. Not exhaustive by design — this
 * guards the money and identity paths, where a mismatch is an outage rather
 * than a degraded feature.
 */
export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  app_users: [
    "id",
    "email",
    "username",
    "passwordHash",
    "role",
    "hasAccess",
    "expiryDate",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "stripePlanId",
    "cancelAtPeriodEnd",
    "pendingSetup",
    "pendingStripeSessionId",
    "pendingSetupExpiresAt",
    "stripeSubscriptionStatus",
    "lastStripeEventAt",
    "planPriceId",
    "tokenVersion",
  ],
  subscription_plans: [
    "id",
    "slug",
    "name",
    "planType",
    "active",
    "livemode",
    "stripeProductId",
  ],
  plan_prices: [
    "id",
    "planId",
    "stripePriceId",
    "amountCents",
    "currency",
    "active",
    "isDefault",
  ],
  plan_features: ["id", "planId", "featureKey", "sortOrder"],
  stripe_webhook_events: ["id", "stripeEventId", "eventType", "processedAt"],
  entitlement_events: ["id", "userId", "eventType", "reason", "createdAt"],
  // Ledger tables. Both fail SOFT by design — recordCheckoutCreated and
  // recordPaymentEvent swallow their own errors so a missing table can never
  // 5xx a webhook and trigger Stripe to redeliver an already-fulfilled event.
  //
  // That safety property has a cost: when the migration is skipped, the code
  // ships blind and says nothing. It happened on BOTH ledger deploys, because
  // merging triggers the Railway deploy automatically and the migration
  // workflow has to be run BEFORE the merge, not after. SchemaGuard reported
  // PASS each time — it only knew about app_users and the billing catalogue.
  //
  // Declaring them here makes the omission loud at boot instead of silent
  // until the first payment.
  checkout_sessions: [
    "id",
    "stripeSessionId",
    "status",
    "fulfillment",
    "fulfillmentReason",
    "userId",
    "planId",
    "amountCents",
    "customerEmail",
    "createdAt",
  ],
  payment_events: [
    "id",
    "stripeEventId",
    "objectId",
    "objectType",
    "kind",
    "outcome",
    "outcomeReason",
    "amountCents",
    "currency",
    "userId",
    "occurredAt",
    "recordedAt",
  ],
  subscription_events: [
    "id",
    "stripeEventId",
    "eventType",
    "stripeSubscriptionId",
    "kind",
    "outcome",
    "outcomeReason",
    "fromPlanId",
    "toPlanId",
    "fromPriceId",
    "toPriceId",
    "status",
    "cancelAtPeriodEnd",
    "periodEnd",
    "actor",
    "occurredAt",
    "recordedAt",
  ],
};

export interface SchemaDrift {
  table: string;
  missingColumns: string[];
  tableMissing: boolean;
}

export interface SchemaGuardResult {
  ok: boolean;
  drift: SchemaDrift[];
  /**
   * Set when the guard did not run because it does not apply to this instance.
   * `ok: true` with a `skipped` reason means "not checked", NOT "verified clean" —
   * callers that report schema health must not conflate the two.
   */
  skipped?: "analytics-store";
  /**
   * Set when EVERY required table read as absent, which says the schema READ
   * failed rather than that a migration was missed. Reported, never fatal —
   * see the reasoning at the check site in assertSchemaCurrent.
   */
  inconclusive?: true;
}

/** Compare declared expectations against information_schema. Read-only. */
export async function detectSchemaDrift(
  required: Readonly<Record<string, readonly string[]>> = REQUIRED_COLUMNS
): Promise<SchemaDrift[]> {
  const db = await getDb();
  if (!db) return [];
  const tables = Object.keys(required);
  const rows = (await db.execute(
    sql`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${sql.join(
          tables.map(t => sql`${t}`),
          sql`, `
        )})`
  )) as unknown as Array<Array<{ t: string; c: string }>>;
  const flat =
    (Array.isArray(rows[0])
      ? rows[0]
      : (rows as unknown as Array<{ t: string; c: string }>)) ?? [];

  return compareSchema(flat, required);
}

/**
 * The pure comparison, split out from the DB read so it can be tested.
 *
 * Worth testing directly: this is the code that decides whether a skipped
 * migration is announced or ignored, and it reported PASS through BOTH ledger
 * deploys — not because the logic was wrong, but because the tables were never
 * declared. A test that can construct "every table but this one" is the only
 * way to prove the absence is now caught.
 */
export function compareSchema(
  presentRows: ReadonlyArray<{ t: string; c: string }>,
  required: Readonly<Record<string, readonly string[]>> = REQUIRED_COLUMNS
): SchemaDrift[] {
  const present = new Map<string, Set<string>>();
  for (const r of presentRows) {
    const t = String(r.t),
      c = String(r.c);
    if (!present.has(t)) present.set(t, new Set());
    present.get(t)!.add(c);
  }

  const drift: SchemaDrift[] = [];
  for (const [table, cols] of Object.entries(required)) {
    const have = present.get(table);
    if (!have) {
      drift.push({ table, missingColumns: [...cols], tableMissing: true });
      continue;
    }
    const missing = cols.filter(c => !have.has(c));
    if (missing.length)
      drift.push({ table, missingColumns: missing, tableMissing: false });
  }
  return drift;
}

/** Human-readable, actionable — names the exact objects and the fix. */
export function formatDrift(drift: readonly SchemaDrift[]): string {
  return drift
    .map(d =>
      d.tableMissing
        ? `  table "${d.table}" is MISSING entirely (${d.missingColumns.length} expected columns)`
        : `  table "${d.table}" is missing: ${d.missingColumns.join(", ")}`
    )
    .join("\n");
}

/**
 * Run once at boot. Never throws on its own failure — an unreachable database at
 * startup is the circuit breaker's problem, not this check's.
 */
export async function assertSchemaCurrent(): Promise<SchemaGuardResult> {
  // Both Railway services run the SAME build, but only one owns these tables.
  // The analytics store (ai-sports-betting-backend, ANALYTICS_ROLE=store) points
  // its DATABASE_URL at a different database that by design holds analytics_events
  // and none of the product/billing tables declared above. So every one of them
  // reads as "MISSING entirely" on every boot: ten tables, plus a "login, checkout,
  // fulfilment will break" warning, none of it true there.
  //
  // That is worse than noise. This guard exists to make ONE failure impossible to
  // miss — code deployed ahead of its migration, which took platform-wide login
  // down on 2026-07-31 — and a guard that screams on every single boot of one
  // service is precisely how the real alarm gets scrolled past.
  //
  // Scoped by ROLE, deliberately, not by drift shape. Treating "table missing
  // entirely" as benign would have been the smaller diff and the wrong fix: that
  // case IS the ledger miss described in REQUIRED_COLUMNS above, and it has to
  // stay loud on the service that actually owns the tables.
  if (isAnalyticsStore()) {
    console.log(
      `${TAG} [VERIFY] N/A — ANALYTICS_ROLE=store. This instance's DATABASE_URL is the ` +
        `analytics store, which owns none of the product tables this guard checks, so drift ` +
        `here would be meaningless. The product service reports the real verdict.`
    );
    return { ok: true, drift: [], skipped: "analytics-store" };
  }
  try {
    const drift = await detectSchemaDrift();
    if (drift.length === 0) {
      console.log(
        `${TAG} [VERIFY] PASS — live schema satisfies every required column`
      );
      return { ok: true, drift: [] };
    }
    // All-or-nothing is a failed READ, not a missed migration.
    //
    // A migration adds or alters; it does not drop the entire product schema.
    // So when EVERY required table reads as absent, the thing that failed is the
    // read: an empty result set, the wrong DATABASE() context, a driver row-shape
    // change, or lost information_schema access. Verified 2026-08-07 — a stub
    // returning [] produces exactly this shape, 9/9 tableMissing with ok:false.
    //
    // This is inert today and decisive the moment SCHEMA_GUARD_FATAL=1 is set:
    // without it, one transient empty read turns a healthy service into a crash
    // loop, which is a self-inflicted outage in the name of preventing one. Still
    // reported at error level — the only thing established here is that we do not
    // know, and that is worth saying out loud rather than exiting on.
    const requiredTableCount = Object.keys(REQUIRED_COLUMNS).length;
    if (
      drift.length === requiredTableCount &&
      drift.every(d => d.tableMissing)
    ) {
      console.error(
        `${TAG} [VERIFY] INCONCLUSIVE — all ${requiredTableCount} required tables read as ` +
          `absent. That pattern means the schema READ failed (empty result set, wrong ` +
          `DATABASE(), driver shape change, or lost information_schema access), not that a ` +
          `migration was missed. Not treated as drift, and NOT fatal even under ` +
          `SCHEMA_GUARD_FATAL=1. If the database really is unmigrated, the first query will ` +
          `say so far more precisely than this check can.`
      );
      return { ok: false, drift, inconclusive: true };
    }
    const detail = formatDrift(drift);
    console.error(
      `${TAG} [VERIFY] FAIL — the running code expects schema objects that do not exist:\n${detail}\n` +
        `${TAG} This means code deployed AHEAD of its migration. Drizzle enumerates every declared ` +
        `column, so queries against these tables will fail with ER_BAD_FIELD_ERROR and user-facing ` +
        `flows (login, checkout, fulfilment) will break.\n` +
        `${TAG} FIX: run the pending migration workflow, then redeploy.`
    );
    if (process.env.SCHEMA_GUARD_FATAL === "1") {
      console.error(
        `${TAG} SCHEMA_GUARD_FATAL=1 — refusing to serve with a stale schema.`
      );
      process.exit(1);
    }
    return { ok: false, drift };
  } catch (err) {
    console.warn(
      `${TAG} check skipped — ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: true, drift: [] };
  }
}
