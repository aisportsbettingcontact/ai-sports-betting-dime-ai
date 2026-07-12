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
};

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
 * Initials for the brand-styled avatar fallback: first letters of the first
 * and last word-ish segments, or the first two letters of a single segment.
 */
export function deriveInitials(username: string | null | undefined): string {
  const parts = (username ?? "").trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const raw =
    parts.length === 1
      ? parts[0].slice(0, 2)
      : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return raw.toUpperCase();
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
