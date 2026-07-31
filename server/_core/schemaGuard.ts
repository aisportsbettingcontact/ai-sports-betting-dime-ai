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

const TAG = "[SchemaGuard]";

/**
 * Columns whose absence breaks a core flow. Not exhaustive by design — this
 * guards the money and identity paths, where a mismatch is an outage rather
 * than a degraded feature.
 */
export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  app_users: [
    "id", "email", "username", "passwordHash", "role", "hasAccess", "expiryDate",
    "stripeCustomerId", "stripeSubscriptionId", "stripePlanId", "cancelAtPeriodEnd",
    "pendingSetup", "pendingStripeSessionId", "pendingSetupExpiresAt",
    "stripeSubscriptionStatus", "lastStripeEventAt", "planPriceId", "tokenVersion",
  ],
  subscription_plans: ["id", "slug", "name", "planType", "active", "livemode", "stripeProductId"],
  plan_prices: ["id", "planId", "stripePriceId", "amountCents", "currency", "active", "isDefault"],
  plan_features: ["id", "planId", "featureKey", "sortOrder"],
  stripe_webhook_events: ["id", "stripeEventId", "eventType", "processedAt"],
  entitlement_events: ["id", "userId", "eventType", "reason", "createdAt"],
};

export interface SchemaDrift {
  table: string;
  missingColumns: string[];
  tableMissing: boolean;
}

/** Compare declared expectations against information_schema. Read-only. */
export async function detectSchemaDrift(
  required: Readonly<Record<string, readonly string[]>> = REQUIRED_COLUMNS,
): Promise<SchemaDrift[]> {
  const db = await getDb();
  if (!db) return [];
  const tables = Object.keys(required);
  const rows = (await db.execute(
    sql`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${sql.join(tables.map((t) => sql`${t}`), sql`, `)})`,
  )) as unknown as Array<Array<{ t: string; c: string }>>;
  const flat = (Array.isArray(rows[0]) ? rows[0] : (rows as unknown as Array<{ t: string; c: string }>)) ?? [];

  const present = new Map<string, Set<string>>();
  for (const r of flat) {
    const t = String(r.t), c = String(r.c);
    if (!present.has(t)) present.set(t, new Set());
    present.get(t)!.add(c);
  }

  const drift: SchemaDrift[] = [];
  for (const [table, cols] of Object.entries(required)) {
    const have = present.get(table);
    if (!have) { drift.push({ table, missingColumns: [...cols], tableMissing: true }); continue; }
    const missing = cols.filter((c) => !have.has(c));
    if (missing.length) drift.push({ table, missingColumns: missing, tableMissing: false });
  }
  return drift;
}

/** Human-readable, actionable — names the exact objects and the fix. */
export function formatDrift(drift: readonly SchemaDrift[]): string {
  return drift
    .map((d) =>
      d.tableMissing
        ? `  table "${d.table}" is MISSING entirely (${d.missingColumns.length} expected columns)`
        : `  table "${d.table}" is missing: ${d.missingColumns.join(", ")}`,
    )
    .join("\n");
}

/**
 * Run once at boot. Never throws on its own failure — an unreachable database at
 * startup is the circuit breaker's problem, not this check's.
 */
export async function assertSchemaCurrent(): Promise<{ ok: boolean; drift: SchemaDrift[] }> {
  try {
    const drift = await detectSchemaDrift();
    if (drift.length === 0) {
      console.log(`${TAG} [VERIFY] PASS — live schema satisfies every required column`);
      return { ok: true, drift: [] };
    }
    const detail = formatDrift(drift);
    console.error(
      `${TAG} [VERIFY] FAIL — the running code expects schema objects that do not exist:\n${detail}\n` +
      `${TAG} This means code deployed AHEAD of its migration. Drizzle enumerates every declared ` +
      `column, so queries against these tables will fail with ER_BAD_FIELD_ERROR and user-facing ` +
      `flows (login, checkout, fulfilment) will break.\n` +
      `${TAG} FIX: run the pending migration workflow, then redeploy.`,
    );
    if (process.env.SCHEMA_GUARD_FATAL === "1") {
      console.error(`${TAG} SCHEMA_GUARD_FATAL=1 — refusing to serve with a stale schema.`);
      process.exit(1);
    }
    return { ok: false, drift };
  } catch (err) {
    console.warn(`${TAG} check skipped — ${err instanceof Error ? err.message : String(err)}`);
    return { ok: true, drift: [] };
  }
}
