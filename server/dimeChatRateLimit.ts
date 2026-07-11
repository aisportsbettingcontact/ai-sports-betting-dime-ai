/**
 * Dime AI — per-user rate limiter for the streaming chat endpoint.
 *
 * Kept in its own dependency-free module (no env/db imports) so the window
 * logic is unit-testable without booting the server env. The global /api IP
 * limiter (200/min) is shared across all API traffic and is not a per-user
 * cap, so without this an entitled subscriber could issue unbounded
 * claude-fable-5 streams. Mirrors the fixed-window pattern in
 * dime-wc2026.route.ts.
 */

export const DIME_CHAT_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const DIME_CHAT_RATE_LIMIT_MAX_REQUESTS = 30; // per user per window

export type RateLimitEntry = { count: number; windowStart: number };

const chatRateLimitStore = new Map<number, RateLimitEntry>();

/**
 * Fixed-window per-user rate limiter. Returns true when the request is allowed,
 * false when the user has exhausted their window. `store` and `now` are injected
 * so the same logic can be exercised deterministically in tests.
 */
export function checkDimeChatRateLimit(
  userId: number,
  store: Map<number, RateLimitEntry> = chatRateLimitStore,
  now: number = Date.now(),
  windowMs: number = DIME_CHAT_RATE_LIMIT_WINDOW_MS,
  maxRequests: number = DIME_CHAT_RATE_LIMIT_MAX_REQUESTS,
): boolean {
  const entry = store.get(userId);
  if (!entry || now - entry.windowStart > windowMs) {
    store.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}
