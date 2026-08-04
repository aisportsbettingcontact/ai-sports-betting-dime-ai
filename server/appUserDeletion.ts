/**
 * appUserDeletion.ts — the rule that stops account deletion orphaning data.
 *
 * `deleteAppUser` was a bare `DELETE FROM app_users WHERE id = ?`. Fourteen
 * tables hold an `app_users.id`, and ZERO foreign keys reference `app_users`
 * (all 56 FKs in the schema are in the World Cup tables), so nothing at the
 * database level stopped a delete from stranding that user's rows.
 *
 * It already happened. Account 60002 — a real, authenticated handicapper —
 * was hard-deleted, leaving 278 verified bets, a login session and an
 * owner-reviewed edit request pointing at an id with no row. Those bets were
 * invisible in the owner/admin picker for months and were still counted in
 * every global total. `user_sessions` orphans 1050001 as well;
 * `user_favorite_games` orphans 150003 and 180002. With 87 live accounts this
 * was going to keep happening.
 *
 * The rule here is deliberately conservative: REFUSE, do not cascade. Cascading
 * would mean deleting `payment_events` and `entitlement_events` rows — a
 * financial audit trail — as a side effect of an admin clicking delete. If an
 * account genuinely must go, the operator disables it (`hasAccess = false`),
 * which preserves history and attribution, exactly as the 60002 archival row
 * now demonstrates.
 *
 * The decision is a pure function so it can be tested without a database.
 */

/**
 * Every table that stores an `app_users.id`, with the column that holds it.
 *
 * Derived from information_schema against production on 2026-08-04 rather than
 * from memory: these are the columns that actually contain user ids, verified
 * by matching known-real accounts. Keep it in sync when a new table starts
 * referencing a user — the guard is only as complete as this list.
 */
export const APP_USER_DEPENDENT_TABLES = [
  { table: "tracked_bets", column: "userId", label: "tracked bets" },
  { table: "bet_edit_requests", column: "requestedBy", label: "edit requests raised" },
  { table: "bet_edit_requests", column: "reviewedBy", label: "edit requests reviewed" },
  { table: "user_sessions", column: "userId", label: "login sessions" },
  { table: "user_favorite_games", column: "appUserId", label: "favourite games" },
  { table: "dime_chat_threads", column: "userId", label: "chat threads" },
  { table: "dime_chat_turns", column: "userId", label: "chat turns" },
  { table: "dime_chat_sessions", column: "userId", label: "chat sessions" },
  { table: "dime_chat_generations", column: "userId", label: "chat generations" },
  { table: "checkout_sessions", column: "userId", label: "checkout sessions" },
  { table: "payment_events", column: "userId", label: "payment events" },
  { table: "entitlement_events", column: "userId", label: "entitlement events" },
  { table: "discord_invite_tokens", column: "createdBy", label: "discord invites created" },
  { table: "discord_invite_tokens", column: "targetUserId", label: "discord invites received" },
  { table: "waitlist", column: "reviewedBy", label: "waitlist reviews" },
] as const;

export type DependentCounts = Record<string, number>;

/**
 * Decide whether a hard delete may proceed.
 *
 * Returns null when the account owns nothing and can be removed cleanly, or an
 * explanatory message naming what would be stranded. The message is written for
 * the operator who clicked delete, so it says what to do instead.
 */
export function describeDeletionBlock(
  userId: number,
  counts: DependentCounts,
): string | null {
  const held = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  if (held.length === 0) return null;

  const total = held.reduce((sum, [, n]) => sum + n, 0);
  const detail = held.map(([label, n]) => `${n} ${label}`).join(", ");

  return (
    `Cannot delete user ${userId}: ${total} row${total === 1 ? "" : "s"} reference this account ` +
    `(${detail}). No foreign key would clean them up, so deleting the account strands them — ` +
    `they stay in global totals while becoming unattributable, which is exactly what happened ` +
    `to account 60002. Disable the account instead (set hasAccess = false), which preserves the ` +
    `history and keeps it attributed.`
  );
}

/** Thrown instead of silently orphaning rows. */
export class AppUserHasDataError extends Error {
  readonly userId: number;
  readonly counts: DependentCounts;
  constructor(userId: number, counts: DependentCounts, message: string) {
    super(message);
    this.name = "AppUserHasDataError";
    this.userId = userId;
    this.counts = counts;
  }
}
