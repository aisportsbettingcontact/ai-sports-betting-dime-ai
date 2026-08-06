/**
 * Column-width limits for `security_events`, kept in ONE place so the DB
 * writer and the Discord embed builder can never drift from the schema.
 *
 * Why this file exists (2026-08-06 forensic audit): `insertSecurityEvent`
 * truncated `userAgent` to 512 but wrote `trpcPath` uncapped into a
 * varchar(256). A request with a >256-char path raised ER_DATA_TOO_LONG, the
 * insert failed, and the catch logged it "non-critical" — so an attacker
 * could erase their own security event with one long URL. Same defect class
 * as the k-props NAME_MATCH_FAILED sentinel (PR #418).
 *
 * These values MUST equal the varchar lengths in drizzle/schema.ts.
 * securityEventLimits.test.ts asserts that.
 *
 * Reconciled 2026-08-06 against drizzle/schema.ts (securityEvents table,
 * confirmed against drizzle/0054_short_annihilus.sql DDL). Three values were
 * corrected from an earlier draft that did not match the live schema:
 *   - blockedOrigin: 256 -> 512  (schema: varchar("blockedOrigin", { length: 512 }))
 *   - httpMethod:      8 ->  16  (schema: varchar("httpMethod", { length: 16 }))
 *   - context:        64 -> 65535 (schema: text("context") — a MySQL TEXT
 *     column, not a varchar; it carries no declared { length }, so its real
 *     ceiling is MySQL's implicit TEXT storage cap of 65,535 bytes, not an
 *     arbitrary short number)
 */
export const SECURITY_EVENT_LIMITS = {
  ip: 64,
  blockedOrigin: 512,
  trpcPath: 256,
  httpMethod: 16,
  userAgent: 512,
  context: 65535,
} as const;

/**
 * Clamp a value to a column width. Empty and nullish both become null — an
 * empty column carries no information and null is the honest representation.
 */
export function truncateForColumn(
  value: string | null | undefined,
  max: number
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value.length > max ? value.substring(0, max) : value;
}
