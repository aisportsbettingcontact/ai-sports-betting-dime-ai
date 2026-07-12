/**
 * Dime AI — model access policy (OWNER-ONLY LOCKDOWN, 2026-07-12).
 *
 * The Dime Chat AI model answers OWNER accounts only (@prez, @sippi — the two
 * role="owner" accounts). Every route that can reach Anthropic must pass the
 * DB-loaded user through canAccessDimeModel() before any model call or SSE
 * stream begins:
 *
 *   - POST /api/dime/chat    (server/dime-chat.route.ts)
 *   - POST /api/dime/wc2026  (server/dime-wc2026.route.ts)
 *   - trpc claude.chat        (server/claudeRouter.ts — already ownerProcedure)
 *
 * The decision is made against the DATABASE role, never the JWT claim: a JWT
 * bakes the role at login time, so a demoted user could otherwise keep model
 * access until their token expires. Subscribers (hasAccess=true, role="user")
 * are deliberately excluded — an active paid subscription does NOT grant model
 * access while the lockdown is in effect.
 *
 * Kept dependency-free (no env/db imports) so the policy is unit-testable
 * without booting the server env, mirroring dimeChatRateLimit.ts.
 */

export type DimeModelAccessUser = {
  role: string;
  hasAccess: boolean;
} | null | undefined;

/** Hardcoded copy shown to (and returned to) every non-owner send attempt. */
export const DIME_MODEL_ACCESS_MESSAGE = "AI Model access will be available soon";

/**
 * True only for enabled owner accounts. Everyone else — subscribers, admins,
 * handicappers, regular users, unknown/missing users — is refused.
 */
export function canAccessDimeModel(user: DimeModelAccessUser): boolean {
  if (!user) return false;
  if (!user.hasAccess) return false;
  return user.role === "owner";
}
