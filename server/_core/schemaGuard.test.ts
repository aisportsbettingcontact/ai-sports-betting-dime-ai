/**
 * Reproduces the 2026-07-31 login outage in miniature: app_users.planPriceId
 * existed in the Drizzle schema but not in the database, so every user lookup
 * failed and surfaced as "user not found".
 */
import { describe, it, expect } from "vitest";
import {
  formatDrift,
  REQUIRED_COLUMNS,
  isInconclusiveRead,
  INCONCLUSIVE_MIN_TABLES,
  type SchemaDrift,
} from "./schemaGuard";
import { isSchemaError } from "../db";

describe("isSchemaError", () => {
  it("[SE-1] treats the exact outage error as a SCHEMA fault, not a missing row", () => {
    expect(
      isSchemaError({
        code: "ER_BAD_FIELD_ERROR",
        message: "Unknown column 'planPriceId' in 'field list'",
      })
    ).toBe(true);
  });

  it("[SE-2] covers the other code-ahead-of-migration shapes", () => {
    for (const code of [
      "ER_NO_SUCH_TABLE",
      "ER_PARSE_ERROR",
      "ER_BAD_TABLE_ERROR",
      "ER_WRONG_FIELD_SPEC",
    ])
      expect(isSchemaError({ code }), code).toBe(true);
  });

  it("[SE-3] leaves TRANSIENT faults fail-soft — those should degrade, not 500", () => {
    for (const code of [
      "PROTOCOL_CONNECTION_LOST",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ER_LOCK_DEADLOCK",
    ])
      expect(isSchemaError({ code }), code).toBe(false);
    expect(isSchemaError(new Error("circuit breaker open"))).toBe(false);
    expect(isSchemaError(null)).toBe(false);
    expect(isSchemaError(undefined)).toBe(false);
  });
});

describe("REQUIRED_COLUMNS", () => {
  it("[RC-1] guards the column whose absence caused the outage", () => {
    expect(REQUIRED_COLUMNS.app_users).toContain("planPriceId");
  });

  it("[RC-2] guards the identity + money path tables", () => {
    for (const t of [
      "app_users",
      "subscription_plans",
      "plan_prices",
      "plan_features",
      "stripe_webhook_events",
      "entitlement_events",
    ])
      expect(Object.keys(REQUIRED_COLUMNS), t).toContain(t);
  });

  it("[RC-4] guards all THREE ledgers — a ledger deployed ahead of its migration ships blind", () => {
    for (const t of [
      "checkout_sessions",
      "payment_events",
      "subscription_events",
    ])
      expect(Object.keys(REQUIRED_COLUMNS), t).toContain(t);
    // The columns the lifecycle queries depend on (from→to plan transition).
    expect(REQUIRED_COLUMNS.subscription_events).toEqual(
      expect.arrayContaining([
        "kind",
        "outcome",
        "fromPriceId",
        "toPriceId",
        "occurredAt",
      ])
    );
  });

  it("[RC-3] includes the columns the webhook idempotency + audit trail depend on", () => {
    expect(REQUIRED_COLUMNS.stripe_webhook_events).toContain("stripeEventId");
    expect(REQUIRED_COLUMNS.entitlement_events).toContain("reason");
    expect(REQUIRED_COLUMNS.app_users).toEqual(
      expect.arrayContaining(["hasAccess", "expiryDate", "stripePlanId"])
    );
  });
});

describe("formatDrift", () => {
  it("[FD-1] names the exact missing column so the fix is obvious from the log", () => {
    const drift: SchemaDrift[] = [
      {
        table: "app_users",
        missingColumns: ["planPriceId"],
        tableMissing: false,
      },
    ];
    const out = formatDrift(drift);
    expect(out).toContain("app_users");
    expect(out).toContain("planPriceId");
  });

  it("[FD-2] distinguishes a missing TABLE from missing columns", () => {
    const out = formatDrift([
      {
        table: "entitlement_events",
        missingColumns: ["id", "userId"],
        tableMissing: true,
      },
    ]);
    expect(out).toMatch(/MISSING entirely/);
  });

  it("[FD-3] reports every drifting table, not just the first", () => {
    const out = formatDrift([
      {
        table: "app_users",
        missingColumns: ["planPriceId"],
        tableMissing: false,
      },
      {
        table: "plan_features",
        missingColumns: ["sortOrder"],
        tableMissing: false,
      },
    ]);
    expect(out).toContain("app_users");
    expect(out).toContain("plan_features");
  });
});

/**
 * The inconclusive rule reasons from coincidence: nine tables do not vanish at
 * once from a skipped migration, so all-nine-missing must be a failed read.
 * That reasoning weakens as the guarded list shrinks and collapses at one, where
 * "everything is missing" and "the one table I guard is missing" are the same
 * event — a total, genuine drift waved through as merely unknown.
 *
 * Demonstrated 2026-08-08 against the then-shipped code: with REQUIRED_COLUMNS
 * cut to a single table, an absent app_users returned inconclusive:true and did
 * NOT exit, even with SCHEMA_GUARD_FATAL=1 — which is now armed in production.
 */
const missing = (...tables: string[]): SchemaDrift[] =>
  tables.map(t => ({ table: t, missingColumns: ["id"], tableMissing: true }));

describe("isInconclusiveRead — the floor under the coincidence argument", () => {
  it("[IR-1] at the shipped list size, all-missing reads as inconclusive", () => {
    const n = Object.keys(REQUIRED_COLUMNS).length;
    expect(
      isInconclusiveRead(missing(...Object.keys(REQUIRED_COLUMNS)), n)
    ).toBe(true);
  });

  it("[IR-2] below the floor it is NEVER inconclusive — real drift stays fatal", () => {
    // The bug this closes. One guarded table, that table absent: identical
    // shape to "everything missing", but it is unambiguously real drift.
    expect(isInconclusiveRead(missing("app_users"), 1)).toBe(false);
    expect(isInconclusiveRead(missing("app_users", "plan_prices"), 2)).toBe(
      false
    );
  });

  it("[IR-3] the floor is inclusive — exactly INCONCLUSIVE_MIN_TABLES qualifies", () => {
    const n = INCONCLUSIVE_MIN_TABLES;
    const tables = Array.from({ length: n }, (_, i) => `t${i}`);
    expect(isInconclusiveRead(missing(...tables), n)).toBe(true);
    // One below must not.
    expect(isInconclusiveRead(missing(...tables.slice(1)), n - 1)).toBe(false);
  });

  it("[IR-4] partial drift is never inconclusive, however long the list", () => {
    // 8 of 9 missing is a migration problem, not a failed read.
    expect(
      isInconclusiveRead(missing("a", "b", "c", "d", "e", "f", "g", "h"), 9)
    ).toBe(false);
  });

  it("[IR-5] missing COLUMNS never read as inconclusive, only missing TABLES", () => {
    const columnDrift: SchemaDrift[] = Array.from({ length: 9 }, (_, i) => ({
      table: `t${i}`,
      missingColumns: ["planPriceId"],
      tableMissing: false,
    }));
    expect(isInconclusiveRead(columnDrift, 9)).toBe(false);
  });

  it("[IR-6] INVARIANT: REQUIRED_COLUMNS must stay above the floor", () => {
    // This is the assertion that actually protects production. The floor inside
    // isInconclusiveRead is defence in depth; what keeps the guard honest is
    // that the guarded list stays long enough for the coincidence argument to
    // hold. If a future change shrinks it, this fails here rather than silently
    // downgrading a real outage to "inconclusive" on a live, FATAL-armed box.
    expect(Object.keys(REQUIRED_COLUMNS).length).toBeGreaterThanOrEqual(
      INCONCLUSIVE_MIN_TABLES
    );
  });
});
