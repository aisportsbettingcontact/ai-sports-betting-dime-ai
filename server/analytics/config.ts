/**
 * config.ts — role + connection config for the User Activity analytics pipeline.
 *
 * Both Railway services run the SAME build. This module decides, per instance,
 * whether it FORWARDS analytics to the back office or STORES them locally — and
 * it defaults to DISABLED, so a misconfigured instance can NEVER accidentally
 * write analytics into the product TiDB database (owner directive: no silent
 * fallback to TiDB).
 *
 *   role "store"     — the back office (ai-sports-betting-backend). Requires the
 *                      EXPLICIT env `ANALYTICS_ROLE=store`. Its DATABASE_URL is
 *                      the dedicated MySQL: Dime AI, where analytics rows live.
 *   role "forwarder" — the store/web (ai-sports-betting-dime-ai). Has
 *                      `USER_ACTIVITY_BACKEND_URL` set; forwards events over the
 *                      private line and NEVER touches its own DB (TiDB) for analytics.
 *   role "disabled"  — neither signal present. Do nothing. Safe default.
 */
export type AnalyticsRole = "store" | "forwarder" | "disabled";

export function getAnalyticsRole(env: NodeJS.ProcessEnv = process.env): AnalyticsRole {
  // Store mode requires an EXPLICIT opt-in — never inferred — so the web
  // instance (DATABASE_URL = TiDB) can never fall into store mode by accident.
  if (env.ANALYTICS_ROLE === "store") return "store";
  if (env.USER_ACTIVITY_BACKEND_URL && env.USER_ACTIVITY_BACKEND_URL.trim()) return "forwarder";
  return "disabled";
}

export function isAnalyticsStore(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAnalyticsRole(env) === "store";
}

export function isAnalyticsForwarder(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAnalyticsRole(env) === "forwarder";
}

/** Back office private base URL, e.g. http://ai-sports-betting-backend.railway.internal:3000 (trailing slash stripped). */
export function getBackendUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.USER_ACTIVITY_BACKEND_URL?.trim();
  return v ? v.replace(/\/+$/, "") : null;
}

/** Shared secret the store presents and the back office verifies. Server-only. */
export function getIngestSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.ANALYTICS_INGEST_SECRET?.trim();
  return v || null;
}
