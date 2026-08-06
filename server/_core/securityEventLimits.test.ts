import { describe, it, expect } from "vitest";
import {
  SECURITY_EVENT_LIMITS,
  truncateForColumn,
  truncateForTextColumn,
} from "./securityEventLimits";

describe("securityEventLimits", () => {
  it("matches the security_events column widths in drizzle/schema.ts", () => {
    // These MUST equal the varchar lengths. A drift here is the defect class
    // that let a >256-char path drop the row entirely (2026-08-06 audit).
    expect(SECURITY_EVENT_LIMITS.ip).toBe(64);
    expect(SECURITY_EVENT_LIMITS.blockedOrigin).toBe(512);
    expect(SECURITY_EVENT_LIMITS.trpcPath).toBe(256);
    expect(SECURITY_EVENT_LIMITS.httpMethod).toBe(16);
    expect(SECURITY_EVENT_LIMITS.userAgent).toBe(512);
    // `context` is `text("context")` in drizzle/schema.ts (see
    // drizzle/0054_short_annihilus.sql: `context` text) — a MySQL TEXT
    // column, not a varchar. It has no declared { length } in the schema;
    // its real ceiling is MySQL's implicit TEXT storage cap of 65,535 bytes.
    expect(SECURITY_EVENT_LIMITS.context).toBe(65535);
  });

  it("truncates an over-long value to the column width", () => {
    const long = "a".repeat(1000);
    expect(truncateForColumn(long, 256)).toHaveLength(256);
  });

  it("leaves a short value untouched", () => {
    expect(truncateForColumn("/api/trpc/games.list", 256)).toBe(
      "/api/trpc/games.list"
    );
  });

  it("maps null and undefined to null", () => {
    expect(truncateForColumn(null, 256)).toBeNull();
    expect(truncateForColumn(undefined, 256)).toBeNull();
  });

  it("maps empty string to null (an empty column is not a value)", () => {
    expect(truncateForColumn("", 256)).toBeNull();
  });
});

describe("insertSecurityEvent field clamping (regression)", () => {
  it("clamps a 1000-char path to the trpcPath column width", () => {
    // The exact attack shape: GET /<1000 chars>. Before the fix this produced
    // ER_DATA_TOO_LONG and the event vanished from security_events.
    const attackPath = "/" + "a".repeat(999);
    expect(
      truncateForColumn(attackPath, SECURITY_EVENT_LIMITS.trpcPath)
    ).toHaveLength(256);
  });

  it("clamps an over-long httpMethod (the narrowest varchar column)", () => {
    // httpMethod is varchar(16) in drizzle/schema.ts, not 8 — see the
    // reconciliation note in securityEventLimits.ts.
    expect(
      truncateForColumn("A".repeat(64), SECURITY_EVENT_LIMITS.httpMethod)
    ).toHaveLength(16);
  });

  it("drops a lone high surrogate at the cut point instead of splitting the pair", () => {
    // "𝌆" (U+1D306) is a 2-code-unit surrogate pair. Placing it so the cut
    // falls between the high and low surrogate must drop both rather than
    // emit a lone (invalid) high surrogate.
    const value = "a".repeat(9) + "𝌆"; // 9 ascii + 2-code-unit astral char = length 11
    const result = truncateForColumn(value, 10);
    expect(result).toHaveLength(9);
    expect(result).toBe("a".repeat(9));
    // Confirm no lone surrogate survived.
    const lastCode = result!.charCodeAt(result!.length - 1);
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
  });
});

describe("truncateForTextColumn (byte-aware clamp for TEXT columns)", () => {
  it("clamps a value with multi-byte characters to stay within the byte cap", () => {
    // 30,000 four-byte utf8mb4 characters (emoji) = 120,000 bytes, well over
    // the 65,535-byte TEXT cap. A character-based clamp (truncateForColumn)
    // would keep all 30,000 characters — 120,000 bytes — and overflow the
    // column. The byte-aware clamp must not.
    const value = "😀".repeat(30000);
    const result = truncateForTextColumn(value, SECURITY_EVENT_LIMITS.context);
    expect(result).not.toBeNull();
    const byteLength = new TextEncoder().encode(result!).length;
    expect(byteLength).toBeLessThanOrEqual(SECURITY_EVENT_LIMITS.context);
  });

  it("never splits a multi-byte sequence, so no replacement character appears", () => {
    const value = "😀".repeat(30000);
    const result = truncateForTextColumn(value, SECURITY_EVENT_LIMITS.context);
    expect(result).not.toBeNull();
    expect(result).not.toContain("�");
  });

  it("leaves a pure-ASCII value under the cap unchanged", () => {
    const value = "rate_limit_exceeded";
    expect(truncateForTextColumn(value, SECURITY_EVENT_LIMITS.context)).toBe(
      value
    );
  });

  it("leaves a multi-byte value already under the byte cap unchanged", () => {
    const value = "😀 user_not_found 日本語";
    const byteLength = new TextEncoder().encode(value).length;
    expect(byteLength).toBeLessThanOrEqual(SECURITY_EVENT_LIMITS.context);
    expect(truncateForTextColumn(value, SECURITY_EVENT_LIMITS.context)).toBe(
      value
    );
  });

  it("maps null, undefined, and empty string to null", () => {
    expect(truncateForTextColumn(null, 65535)).toBeNull();
    expect(truncateForTextColumn(undefined, 65535)).toBeNull();
    expect(truncateForTextColumn("", 65535)).toBeNull();
  });
});
