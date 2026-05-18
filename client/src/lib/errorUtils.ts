/**
 * errorUtils.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Utility for converting raw tRPC / network errors into user-friendly messages.
 *
 * Problem: tRPC's onError handler receives the raw error object. When the server
 * returns a non-JSON response (e.g. Cloudflare 503 HTML page), the tRPC client
 * throws a TRPCClientError whose .message is the raw JSON.parse() failure:
 *   "Unexpected token 'S', 'Service Unavailable' is not valid JSON"
 *
 * This is confusing and unhelpful for users. This utility maps such errors to
 * clean, actionable messages.
 *
 * CRITICAL DESIGN NOTE:
 * Do NOT use broad substring matches like msg.includes("permission") for the
 * FORBIDDEN check. Server error messages from third-party APIs (e.g. Discord Bot
 * token errors) may contain the word "permission" and would be incorrectly mapped
 * to "You don't have permission to perform this action." — masking the real cause.
 * Always use exact string equality for FORBIDDEN message matching.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Convert a tRPC mutation/query error into a user-friendly string.
 *
 * [INPUT]  error  — raw error from onError handler (TRPCClientError or unknown)
 * [OUTPUT] string — clean, human-readable error message
 *
 * Mapping rules (in priority order):
 *   1. Non-JSON response (parse error) → "Server temporarily unavailable. Please try again."
 *   2. Network failure (fetch error)   → "Network error. Check your connection and try again."
 *   3. UNAUTHORIZED                    → "Session expired. Please sign in again."
 *   4. FORBIDDEN (exact match only)    → "You don't have permission to perform this action."
 *   5. DB/circuit breaker errors       → "Database temporarily unavailable. Please try again."
 *   6. Request timeout                 → "The request took too long. Please try again."
 *   7. Pass-through specific messages  → return msg as-is (already user-friendly from server)
 *   8. Generic INTERNAL_SERVER_ERROR   → pass through server message (it's already descriptive)
 *   9. All others                      → pass through (already user-friendly from server)
 */
export function formatMutationError(error: unknown): string {
  if (!error) return "An unexpected error occurred.";

  const msg = error instanceof Error ? error.message : String(error);

  // [CHECK 1] Non-JSON parse error — server returned HTML/text (e.g. Cloudflare 503)
  if (
    msg.includes("is not valid JSON") ||
    msg.includes("Unexpected token") ||
    msg.includes("Service Unavailable") ||
    msg.includes("Bad Gateway") ||
    msg.includes("Gateway Timeout")
  ) {
    return "Server temporarily unavailable. Please try again in a moment.";
  }

  // [CHECK 2] Network failure — fetch itself failed (no response received)
  if (
    msg === "Failed to fetch" ||
    msg.includes("NetworkError") ||
    msg.includes("net::ERR_")
  ) {
    return "Network error. Check your connection and try again.";
  }

  // [CHECK 3] Session expired — exact matches only
  if (msg === "Please login (10001)" || msg === "Not authenticated" || msg === "Invalid session") {
    return "Session expired. Please sign in again.";
  }

  // [CHECK 4] Permission denied — EXACT matches only.
  // IMPORTANT: Do NOT use msg.includes("permission") here.
  // Server messages from third-party APIs (e.g. "Discord Bot token is invalid or
  // missing permissions") contain "permission" and would be incorrectly suppressed,
  // hiding the real actionable error from the user.
  if (
    msg === "Owner access required" ||
    msg === "Access denied" ||
    msg === "Handicapper access required" ||
    msg === "You do not have required permission (10002)"
  ) {
    return "You don't have permission to perform this action.";
  }

  // [CHECK 5] DB/circuit breaker errors — pass through specific message from server
  if (
    msg.includes('Database temporarily unavailable') ||
    msg.includes('Circuit is OPEN') ||
    msg.includes('Database not available')
  ) {
    return 'Database temporarily unavailable. Please try again in a moment.';
  }

  // [CHECK 6] Request timeout — server-side 25s timeout fired
  if (
    msg.includes('Request timed out') ||
    msg.includes('timed out after') ||
    msg.includes('ETIMEDOUT')
  ) {
    return 'The request took too long. Please try again in a moment.';
  }

  // [CHECK 7] Pass through specific server messages that are already user-friendly
  // (e.g. "Failed to update account. Please try again." from updateUser catch block)
  if (
    msg.includes('Failed to update') ||
    msg.includes('Failed to delete') ||
    msg.includes('Failed to create')
  ) {
    return msg;
  }

  // [CHECK 8] Internal server error — pass through the server message directly.
  // Server-side INTERNAL_SERVER_ERROR messages are already descriptive and actionable
  // (e.g. "Discord Bot token is expired or revoked. Please regenerate it...").
  // Replacing them with a generic message would hide critical diagnostic information.
  if (msg === "Internal server error" || msg.includes("INTERNAL_SERVER_ERROR")) {
    return "An unexpected server error occurred. Please try again.";
  }

  // [DEFAULT] Pass through — message is already user-friendly (CONFLICT, BAD_REQUEST, etc.)
  return msg;
}
