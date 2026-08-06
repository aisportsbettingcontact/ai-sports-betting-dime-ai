/**
 * Reproduces the 2026-07-31 login outage in miniature: app_users.planPriceId
 * existed in the Drizzle schema but not in the database, so every user lookup
 * failed and surfaced as "user not found".
 */
import { describe, it, expect } from "vitest";
import { formatDrift, REQUIRED_COLUMNS, type SchemaDrift } from "./schemaGuard";
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
