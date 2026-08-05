/**
 * Driver-error classification through drizzle's wrapper.
 *
 * These tests exist because BOTH classifiers in db.ts originally read the
 * top-level `.code` of the thrown error, and drizzle-orm does not put it there.
 * The e2e harness (scripts/stripe-e2e.mjs) caught the consequence in production
 * code: a duplicate webhook delivery was rethrown as a processing failure and
 * answered 5xx, which made Stripe redeliver, which failed the same way — a
 * self-sustaining retry storm that also fired a billing alert per cycle.
 *
 * The shapes below are not invented. They were captured from drizzle-orm 0.45.2
 * against MySQL 8 by issuing a real duplicate insert and a real unknown-column
 * select. If a drizzle upgrade changes the wrapper, these fail loudly — which is
 * the point, because the failure mode is otherwise silent and expensive.
 */
import { describe, it, expect } from "vitest";
import {
  classifyAppUsersProbeError,
  driverErrorCode,
  isSchemaError,
  isDuplicateKeyError,
} from "./db";

/** Reproduces drizzle-orm's DrizzleQueryError: no own `.code`, driver on `.cause`. */
function drizzleWrapped(
  driverCode: string,
  errno: number,
  sqlText: string
): Error {
  const driver = Object.assign(new Error(`${driverCode}: driver message`), {
    code: driverCode,
    errno,
    sqlState: driverCode === "ER_DUP_ENTRY" ? "23000" : "42S22",
  });
  const wrapper = new Error(`Failed query: ${sqlText} params: a,b`);
  wrapper.name = "DrizzleQueryError";
  (wrapper as Error & { cause?: unknown }).cause = driver;
  return wrapper;
}

const WRAPPED_DUP = drizzleWrapped(
  "ER_DUP_ENTRY",
  1062,
  "insert into `stripe_webhook_events` (…) values (?, ?)"
);
const WRAPPED_BAD_FIELD = drizzleWrapped(
  "ER_BAD_FIELD_ERROR",
  1054,
  "select `id`, `planPriceId` from `app_users`"
);

describe("driverErrorCode", () => {
  it("finds the code on a bare mysql2 error", () => {
    expect(
      driverErrorCode(Object.assign(new Error("x"), { code: "ER_DUP_ENTRY" }))
    ).toBe("ER_DUP_ENTRY");
  });

  it("finds the code THROUGH drizzle's wrapper, where the wrapper has none", () => {
    expect((WRAPPED_DUP as { code?: unknown }).code).toBeUndefined(); // the trap
    expect(driverErrorCode(WRAPPED_DUP)).toBe("ER_DUP_ENTRY");
  });

  it("walks more than one level of nesting", () => {
    const outer = new Error("outer");
    (outer as Error & { cause?: unknown }).cause = WRAPPED_BAD_FIELD;
    expect(driverErrorCode(outer)).toBe("ER_BAD_FIELD_ERROR");
  });

  it("returns null rather than throwing on junk", () => {
    for (const junk of [
      null,
      undefined,
      "string",
      42,
      {},
      new Error("no code"),
    ]) {
      expect(driverErrorCode(junk)).toBeNull();
    }
  });

  it("terminates on a self-referential cause chain", () => {
    const loop = new Error("loop") as Error & { cause?: unknown };
    loop.cause = loop;
    expect(driverErrorCode(loop)).toBeNull();
  });
});

describe("isDuplicateKeyError", () => {
  it("is TRUE for a drizzle-wrapped duplicate — the regression that caused 5xx retry storms", () => {
    expect(isDuplicateKeyError(WRAPPED_DUP)).toBe(true);
  });

  it("is true for a bare duplicate", () => {
    expect(
      isDuplicateKeyError(
        Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" })
      )
    ).toBe(true);
  });

  it("falls back to errno 1062 when the string code is stripped", () => {
    const wrapper = new Error("Failed query: insert …") as Error & {
      cause?: unknown;
    };
    wrapper.cause = Object.assign(new Error("dup"), { errno: 1062 });
    expect(isDuplicateKeyError(wrapper)).toBe(true);
  });

  it("does NOT swallow unrelated failures — those must still rethrow", () => {
    expect(isDuplicateKeyError(WRAPPED_BAD_FIELD)).toBe(false);
    expect(
      isDuplicateKeyError(
        Object.assign(new Error("gone"), { code: "ECONNRESET" })
      )
    ).toBe(false);
    expect(isDuplicateKeyError(new Error("Failed query: insert into x"))).toBe(
      false
    );
    expect(isDuplicateKeyError(null)).toBe(false);
  });

  it("does not rely on the word 'duplicate' appearing in the message", () => {
    expect(/duplicate/i.test(WRAPPED_DUP.message)).toBe(false); // why the old test failed
    expect(isDuplicateKeyError(WRAPPED_DUP)).toBe(true);
  });
});

describe("isSchemaError", () => {
  it("is TRUE for a drizzle-wrapped unknown column — otherwise #281's fail-loud guard is inert", () => {
    expect(isSchemaError(WRAPPED_BAD_FIELD)).toBe(true);
  });

  it("covers the rest of the schema-drift codes through the wrapper", () => {
    for (const code of [
      "ER_NO_SUCH_TABLE",
      "ER_PARSE_ERROR",
      "ER_WRONG_FIELD_SPEC",
      "ER_BAD_TABLE_ERROR",
    ]) {
      expect(isSchemaError(drizzleWrapped(code, 1146, "select 1"))).toBe(true);
    }
  });

  it("still treats transient faults as fail-soft, not schema drift", () => {
    for (const code of [
      "ECONNRESET",
      "ETIMEDOUT",
      "PROTOCOL_CONNECTION_LOST",
      "ER_DUP_ENTRY",
    ]) {
      expect(isSchemaError(drizzleWrapped(code, 0, "select 1"))).toBe(false);
    }
    expect(isSchemaError(null)).toBe(false);
  });
});

describe("classifyAppUsersProbeError — the health-gate is COLUMN-scoped", () => {
  it("a missing COLUMN (ER_BAD_FIELD_ERROR) is a schema_mismatch — the #370 class the gate exists for", () => {
    expect(classifyAppUsersProbeError(WRAPPED_BAD_FIELD)).toBe(
      "schema_mismatch"
    );
    // through an extra wrapper layer too
    const outer = new Error("outer") as Error & { cause?: unknown };
    outer.cause = WRAPPED_BAD_FIELD;
    expect(classifyAppUsersProbeError(outer)).toBe("schema_mismatch");
  });

  it("a missing TABLE (ER_NO_SUCH_TABLE) is NOT a mismatch → unknown (fixes the zombie-backend false-positive, 2026-08-05)", () => {
    // The secondary service connects to a DB without app_users; failing health
    // there blocked its deploys for no real drift. Missing table ≠ column drift.
    expect(
      classifyAppUsersProbeError(
        drizzleWrapped("ER_NO_SUCH_TABLE", 1146, "select 1")
      )
    ).toBe("unknown");
  });

  it("other schema-DDL codes and transient faults are unknown (never freeze deploys)", () => {
    for (const code of [
      "ER_PARSE_ERROR",
      "ER_WRONG_FIELD_SPEC",
      "ER_BAD_TABLE_ERROR",
      "ECONNRESET",
      "ETIMEDOUT",
      "PROTOCOL_CONNECTION_LOST",
    ]) {
      expect(
        classifyAppUsersProbeError(drizzleWrapped(code, 0, "select 1"))
      ).toBe("unknown");
    }
    expect(classifyAppUsersProbeError(null)).toBe("unknown");
    expect(classifyAppUsersProbeError(new Error("no code"))).toBe("unknown");
  });
});
