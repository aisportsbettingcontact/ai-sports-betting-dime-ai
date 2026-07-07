/**
 * drizzle/dime.schema.ts — Dime AI Chat system tables
 *
 * DB-002: Drizzle schema definitions for the 6 dime_* tables that exist in production.
 * These must match production exactly so `pnpm db:push` shows zero drift.
 *
 * Tables:
 *   1. dime_context_audit
 *   2. dime_credit_ledger
 *   3. dime_request_audit
 *   4. dime_response_audit
 *   5. dime_soak_test_results
 *   6. dime_user_entitlements
 */

import {
  mysqlTable,
  int,
  bigint,
  varchar,
  text,
  datetime,
  timestamp,
  tinyint,
  decimal,
  mysqlEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ─── 1. dime_context_audit ──────────────────────────────────────────────────────
export const dimeContextAudit = mysqlTable(
  "dime_context_audit",
  {
    id: int("id").primaryKey().autoincrement(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    contextHash: varchar("context_hash", { length: 64 }).notNull(),
    contextStatus: varchar("context_status", { length: 20 }).notNull().default("PENDING"),
    matchCount: int("match_count").notNull().default(0),
    recommendationCount: int("recommendation_count").notNull().default(0),
    missingFieldCount: int("missing_field_count").notNull().default(0),
    freshnessStatus: varchar("freshness_status", { length: 20 }).notNull().default("UNKNOWN"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_context_request").on(table.requestId),
    index("idx_context_user").on(table.userId),
  ]
);

// ─── 2. dime_credit_ledger ──────────────────────────────────────────────────────
export const dimeCreditLedger = mysqlTable(
  "dime_credit_ledger",
  {
    id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    requestId: varchar("request_id", { length: 128 }),
    deltaCredits: int("delta_credits").notNull(),
    balanceAfter: int("balance_after").notNull(),
    reason: varchar("reason", { length: 128 }).notNull(),
    createdAt: datetime("created_at").notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_credit_user").on(table.userId),
    index("idx_credit_request").on(table.requestId),
  ]
);

// ─── 3. dime_request_audit ──────────────────────────────────────────────────────
export const dimeRequestAudit = mysqlTable(
  "dime_request_audit",
  {
    id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    userId: varchar("user_id", { length: 128 }),
    authStatus: varchar("auth_status", { length: 32 }).notNull(),
    entitlementStatus: varchar("entitlement_status", { length: 32 }),
    creditStatus: varchar("credit_status", { length: 32 }),
    intent: varchar("intent", { length: 64 }),
    contextStatus: varchar("context_status", { length: 32 }),
    responseStatus: varchar("response_status", { length: 32 }),
    tokensUsed: int("tokens_used"),
    creditsCharged: int("credits_charged"),
    refusalReason: varchar("refusal_reason", { length: 255 }),
    createdAt: datetime("created_at").notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_dime_request_id").on(table.requestId),
  ]
);

// ─── 4. dime_response_audit ─────────────────────────────────────────────────────
export const dimeResponseAudit = mysqlTable(
  "dime_response_audit",
  {
    id: int("id").primaryKey().autoincrement(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    responseMode: varchar("response_mode", { length: 20 }).notNull(),
    refusalReason: varchar("refusal_reason", { length: 40 }),
    contextHash: varchar("context_hash", { length: 64 }),
    tokensInput: int("tokens_input").default(0),
    tokensOutput: int("tokens_output").default(0),
    creditsCharged: int("credits_charged").default(0),
    answerHash: varchar("answer_hash", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_response_request").on(table.requestId),
    index("idx_response_user").on(table.userId),
  ]
);

// ─── 5. dime_soak_test_results ──────────────────────────────────────────────────
export const dimeSoakTestResults = mysqlTable(
  "dime_soak_test_results",
  {
    id: int("id").primaryKey().autoincrement(),
    runId: varchar("run_id", { length: 64 }).notNull(),
    testCaseId: varchar("test_case_id", { length: 64 }).notNull(),
    testType: mysqlEnum("test_type", [
      "ANSWER",
      "PASS_NO_BET",
      "UNSUPPORTED_REFUSAL",
      "AUTH_FAIL",
      "SUB_FAIL",
      "CREDIT_FAIL",
      "DUPLICATE_IDEMPOTENCY",
      "RATE_LIMIT",
      "MALFORMED",
    ]).notNull(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    question: text("question").notNull(),
    expectedHttpStatus: int("expected_http_status").notNull(),
    actualHttpStatus: int("actual_http_status"),
    expectedOutcome: varchar("expected_outcome", { length: 64 }).notNull(),
    actualOutcome: varchar("actual_outcome", { length: 64 }),
    creditBefore: decimal("credit_before", { precision: 10, scale: 2 }),
    creditAfter: decimal("credit_after", { precision: 10, scale: 2 }),
    creditDelta: decimal("credit_delta", { precision: 10, scale: 2 }),
    requestAuditRowCreated: tinyint("request_audit_row_created").default(0),
    responseAuditRowCreated: tinyint("response_audit_row_created").default(0),
    contextAuditRowCreated: tinyint("context_audit_row_created").default(0),
    claudeCalled: tinyint("claude_called").default(0),
    hallucinationDetected: tinyint("hallucination_detected").default(0),
    latencyMs: int("latency_ms"),
    errorMessage: text("error_message"),
    passFail: mysqlEnum("pass_fail", ["PASS", "FAIL"]).notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_soak_run").on(table.runId),
    index("idx_soak_type").on(table.testType),
    index("idx_soak_pass").on(table.passFail),
  ]
);

// ─── 6. dime_user_entitlements ──────────────────────────────────────────────────
export const dimeUserEntitlements = mysqlTable(
  "dime_user_entitlements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    entitlementStatus: varchar("entitlement_status", { length: 32 }).notNull(),
    tier: varchar("tier", { length: 64 }),
    source: varchar("source", { length: 64 }),
    startsAt: datetime("starts_at"),
    expiresAt: datetime("expires_at"),
    createdAt: datetime("created_at").notNull().$defaultFn(() => new Date()),
    updatedAt: datetime("updated_at"),
  },
  (table) => [
    uniqueIndex("uq_dime_entitlement_user").on(table.userId),
  ]
);
