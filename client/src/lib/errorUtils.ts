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
 *   4. FORBIDDEN                       → "You don't have permission to perform this action."
 *   5. CONFLICT                        → pass through (e.g. "Email already in use")
 *   6. BAD_REQUEST                     → pass through (e.g. "Username already taken")
 *   7. INTERNAL_SERVER_ERROR           → "An unexpected server error occurred. Please try again."
 *   8. All others                      → pass through (already user-friendly from server)
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

  // [CHECK 3] Session expired
  if (msg === "Please login (10001)" || msg === "Not authenticated" || msg === "Invalid session") {
    return "Session expired. Please sign in again.";
  }

  // [CHECK 4] Permission denied
  if (msg === "Owner access required" || msg === "Access denied" || msg.includes("permission")) {
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

  // [CHECK 6] Internal server error — generic fallback
  if (msg === "Internal server error" || msg.includes("INTERNAL_SERVER_ERROR")) {
    return "An unexpected server error occurred. Please try again.";
  }

  // [DEFAULT] Pass through — message is already user-friendly (CONFLICT, BAD_REQUEST, etc.)
  return msg;
}
