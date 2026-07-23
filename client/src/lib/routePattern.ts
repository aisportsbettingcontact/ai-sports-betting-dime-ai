/**
 * routePattern.ts — collapse a concrete pathname to a low-cardinality route
 * PATTERN for analytics. Strips ids/slugs/dates so `route` is safe (no PII, no
 * unbounded cardinality). Grounded in client/src/App.tsx's real routes.
 */
const SPORTS = new Set(["mlb", "nba", "nhl", "wc", "wc2026"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toRoutePattern(pathname: string): string {
  const clean = (pathname || "/").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    const prev = out[out.length - 1];
    if (DATE_RE.test(seg)) { out.push(":date"); continue; }
    if (SPORTS.has(seg.toLowerCase()) && (prev === "model" || prev === "betting-splits")) { out.push(":sport"); continue; }
    if (prev === "team") { out.push(":slug"); continue; }
    // Bare numeric / long opaque trailing segment ⇒ :id.
    if (/^\d+$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg)) { out.push(":id"); continue; }
    out.push(seg);
  }
  return "/" + out.join("/");
}
