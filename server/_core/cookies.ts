import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  // Railway (and most reverse proxies) terminate TLS upstream and forward the
  // original scheme via x-forwarded-proto. req.protocol only reflects this
  // header when `app.set("trust proxy", ...)` is configured, so we also check
  // the header directly here as a defensive fallback.
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

/**
 * Determines whether the incoming request is same-origin (frontend and
 * backend served from the same host — the current Railway setup, where both
 * live at https://ai-sports-betting-dime-ai-production.up.railway.app) or
 * cross-origin (the legacy setup where a separate Vercel-hosted frontend
 * called this backend).
 *
 * We compare the host in the Origin (or, failing that, Referer) header
 * against the request's own host. If there is no Origin/Referer header at
 * all — e.g. the OAuth provider's redirect back to our own callback route —
 * there is no cross-site request in play, so we treat it as same-origin.
 */
function isSameOriginRequest(req: Request): boolean {
  const rawHost = req.headers["x-forwarded-host"] ?? req.headers.host;
  if (!rawHost) return true;
  const requestHost = Array.isArray(rawHost) ? rawHost[0] : rawHost;

  const rawOrigin = req.headers.origin ?? req.headers.referer;
  if (!rawOrigin) return true;
  const originHeader = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;

  try {
    return new URL(originHeader).host === requestHost;
  } catch {
    // Malformed Origin/Referer header — fail safe to same-origin behavior
    // rather than accidentally forcing sameSite:"none" without a valid reason.
    return true;
  }
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);
  const sameOrigin = isSameOriginRequest(req);

  if (sameOrigin) {
    // Same-origin (current Railway deployment): "lax" is sufficient to allow
    // the cookie on top-level navigations — including the redirect back from
    // Discord's OAuth callback — while still blocking cross-site requests.
    // No domain attribute is set; the browser scopes the cookie to the exact
    // host automatically, which is exactly what we want for a single-origin app.
    return {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
    };
  }

  // Cross-origin (legacy setup: a separate frontend, e.g. on Vercel, calling
  // this backend). sameSite:"none" is required for the cookie to be attached
  // to cross-site requests, and browsers require secure:true whenever
  // sameSite is "none".
  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}
