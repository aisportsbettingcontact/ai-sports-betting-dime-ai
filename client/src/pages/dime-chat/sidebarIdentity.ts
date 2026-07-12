/**
 * Dime AI — chat sidebar identity derivation (plan Phase 1, 2026-07-12).
 * Replaces the frozen "PREZ BETS" sample identity with the real session user.
 * Pure and dependency-free so every rule is unit-testable (sidebarIdentity.test.ts).
 */

export type SidebarUser = {
  username: string;
  role: string;
  hasAccess: boolean;
  expiryDate: number | null;
  discordUsername: string | null;
  stripePlanId: string | null;
  /** Discord snowflake + avatar hash — present when the account is linked;
   *  used to build the CDN avatar URL (optional so test fixtures stay lean). */
  discordId?: string | null;
  discordAvatar?: string | null;
};

/**
 * Lifetime membership (repo convention, ManageAccount.tsx): no expiry date or
 * the explicit 'lifetime' plan id. Lifetime members have no plan to upgrade
 * or cancel, so the sidebar hides those CTAs (product requirement 2026-07-12).
 */
export function isLifetimeMember(user: SidebarUser): boolean {
  return user.expiryDate == null || user.stripePlanId === "lifetime";
}

/** Sidebar profile-row name — the frozen design renders it in caps (D/L:75). */
export function displaySidebarName(username: string | null | undefined): string {
  return (username ?? "").trim().toUpperCase();
}

/** Menu handle — always "@" + the stored username, untransformed. */
export function formatHandle(username: string | null | undefined): string {
  return `@${(username ?? "").trim()}`;
}

/** The prez photo stays exclusive to the prez account (plan assumption A2). */
export function isPrezAccount(username: string | null | undefined): boolean {
  return (username ?? "").trim().toLowerCase() === "prez";
}

/**
 * Tier label. Owner accounts outrank plan labels; the rest mirrors
 * derivePlanLabel in pages/Profile.tsx so both surfaces agree.
 */
export function deriveTierLabel(user: SidebarUser | null | undefined): string {
  if (!user) return "";
  if (user.role === "owner") return "Owner";
  if (user.expiryDate == null) return "Lifetime";
  if (user.stripePlanId === "annual") return "Annual";
  if (user.stripePlanId === "monthly") return "Monthly";
  if (user.stripePlanId === "pro") return "Pro";
  if (user.stripePlanId === "sharp") return "Sharp";
  if (user.stripePlanId === "operator") return "Operator";
  return user.hasAccess ? "Active" : "Expired";
}

/**
 * Expiry line for the settings menu, e.g. "Expires August 8, 2026".
 * Null when the account has no expiry (owners, lifetime) — the row is hidden,
 * never a placeholder date.
 */
export function formatExpiryLine(
  expiryDate: number | null | undefined
): string | null {
  if (expiryDate == null) return null;
  const date = new Date(expiryDate);
  if (Number.isNaN(date.getTime())) return null;
  return `Expires ${date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
}
