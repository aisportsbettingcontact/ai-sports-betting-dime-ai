/**
 * routePattern.ts (server) — server-authoritative re-collapse of the client's
 * `route` into a low-cardinality PATTERN. Defense-in-depth: the client also
 * sends a pattern (client/src/lib/routePattern.ts), but a modified client could
 * send a raw path with ids/tokens/dates. Every other sensitive field is
 * server-derived; `route` gets the same treatment here so the analytics DB's
 * "no PII / bounded cardinality" guarantee holds regardless of client claims.
 *
 * Mirrors the client collapse rules and additionally strips any long/opaque
 * segment (tokens) that the client rules might miss. Pure, dependency-free.
 */
const SPORTS = new Set(["mlb", "nba", "nhl", "wc", "wc2026"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Collapse one concrete pathname to a safe pattern. */
export function toRoutePattern(pathname: string): string {
  const clean = (pathname || "/").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const out: string[] = [];
  for (const seg of parts) {
    const prev = out[out.length - 1];
    if (DATE_RE.test(seg)) { out.push(":date"); continue; }
    if (SPORTS.has(seg.toLowerCase()) && (prev === "model" || prev === "betting-splits")) { out.push(":sport"); continue; }
    if (prev === "team") { out.push(":slug"); continue; }
    // Numeric ids, hex/opaque tokens, or any over-long segment ⇒ :id.
    if (/^\d+$/.test(seg) || /^[0-9a-f]{12,}$/i.test(seg) || seg.length > 24) { out.push(":id"); continue; }
    out.push(seg);
  }
  return "/" + out.join("/");
}

/**
 * Sanitize a client-supplied route: null-safe, re-collapsed to a pattern, and
 * length-bounded to the store column (VARCHAR(96)). Returns null for missing.
 */
export function sanitizeRoutePattern(route: string | null | undefined): string | null {
  if (!route) return null;
  const pattern = toRoutePattern(route);
  return pattern.slice(0, 96);
}
