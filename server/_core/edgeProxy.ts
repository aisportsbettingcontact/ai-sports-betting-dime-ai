import crypto from "node:crypto";
import type { Request } from "express";

/**
 * Phase 4 — Cloudflare edge defense: pure, flag-gated helpers.
 *
 * DESIGN LAW (from the Phase 4 adversarial review — see
 * docs/runbooks/edge-defense-cloudflare.md and the security-hardening plan):
 *
 *  1. Nothing here changes behavior until `EDGE_MODE` is set to "log" or "on".
 *     With EDGE_MODE unset/"off" every consumer short-circuits BEFORE calling
 *     these functions, so importing this module is inert (no side effects on
 *     import, env read at call time). This keeps a merge byte-identical to
 *     today — the #370 deploy-order lesson: never ship a latent behavior flip.
 *
 *  2. The load-bearing origin proof is NOT the Cloudflare IP range. Any party
 *     can route the origin through their OWN free Cloudflare zone and arrive
 *     from a genuine CF PoP IP, so `isCloudflareEdgeIp` is a SECOND, defence-in
 *     -depth / observability factor only. The real gate is the shared secret
 *     `x-dime-edge-secret` (constant-time compared here) PLUS, at the infra
 *     layer, Cloudflare Authenticated Origin Pulls (mTLS) or a Cloudflare
 *     Tunnel so the public *.up.railway.app origin cannot be reached directly
 *     at all. Treat EDGE_ORIGIN_SECRET leakage as CATASTROPHIC and rotate.
 *
 *  3. True client IP behind Cloudflare comes ONLY from `cf-connecting-ip` (the
 *     header Cloudflare overwrites and manages). We deliberately do NOT fall
 *     back to `true-client-ip` — that header is client/zone-forgeable on
 *     non-Enterprise plans and would hand an attacker an arbitrary-IP lever.
 */

export type EdgeMode = "off" | "log" | "on";

/** Current edge mode, read from env at call time. Unset/unknown → "off". */
export function edgeMode(): EdgeMode {
  const v = (process.env.EDGE_MODE ?? "").trim().toLowerCase();
  return v === "on" || v === "log" ? v : "off";
}

/**
 * The IP of the host that connected to Railway's edge (the "immediate
 * upstream"): the LEFTMOST sanitized X-Forwarded-For token, else req.ip.
 * Behind Cloudflare this is the CF PoP egress IP; on a direct origin hit it
 * is the caller's own public IP. Same extraction the legacy limiter keying
 * uses, exposed here so the edge proof can classify who actually connected.
 */
export function immediateUpstreamIp(
  req: Pick<Request, "headers" | "ip">
): string {
  const xff = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || req.ip || "";
}

/**
 * The true client IP as asserted by Cloudflare. ONLY `cf-connecting-ip` — see
 * design law #3 (no `true-client-ip` fallback). null when absent/empty.
 */
export function cfConnectingIp(req: Pick<Request, "headers">): string | null {
  const h = req.headers?.["cf-connecting-ip"];
  const v = (Array.isArray(h) ? h[0] : h)?.trim();
  return v ? v : null;
}

// ─── Cloudflare edge IP ranges ──────────────────────────────────────────────
// Snapshot of https://www.cloudflare.com/ips-v4 + /ips-v6 as of 2026-08-05.
// SECOND-FACTOR / observability ONLY (design law #2) — a stale list degrades
// defence-in-depth, never the primary secret gate. Refresh cadence + a boot
// staleness alert are documented as a fast-follow in the runbook.
export const CF_IPV4_CIDRS: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

export const CF_IPV6_CIDRS: readonly string[] = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;

/**
 * Boot guard: throw if the checked-in CF range snapshot is empty/corrupt so a
 * bad list can never silently open the second factor OR (worse) 403-storm.
 * Call ONLY when edgeMode() !== "off" — a corrupt list must not crash boot
 * while the feature is dormant (preserves the inertness guarantee).
 */
export function assertNonEmptyCfRanges(): void {
  if (CF_IPV4_CIDRS.length === 0 || CF_IPV6_CIDRS.length === 0) {
    throw new Error(
      "[edgeProxy] Cloudflare CIDR snapshot is empty — refusing to arm edge mode"
    );
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

/**
 * Expand an IPv6 address (incl. "::" and embedded IPv4) to its 8 16-bit
 * hextet groups. Returns null on malformed input. No BigInt — the CIDR test
 * compares group-by-group, which keeps this ES2019-safe.
 */
function ipv6ToGroups(ip: string): number[] | null {
  let addr = ip;
  // Embedded IPv4 (e.g. ::ffff:1.2.3.4) → convert the tail to two hextets.
  const v4tail = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4tail) {
    const v4 = ipv4ToInt(v4tail[1]);
    if (v4 === null) return null;
    const hi = (v4 >>> 16) & 0xffff;
    const lo = v4 & 0xffff;
    addr =
      addr.slice(0, v4tail.index) + hi.toString(16) + ":" + lo.toString(16);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - (head.length + tail.length);
  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (missing < 0) {
    return null;
  }
  const parts =
    halves.length === 2
      ? [...head, ...Array(missing).fill("0"), ...tail]
      : head;
  if (parts.length !== 8) return null;
  const out: number[] = [];
  for (const g of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipN = ipv4ToInt(ip);
  const netN = ipv4ToInt(net);
  if (ipN === null || netN === null || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) >>> 0 === (netN & mask) >>> 0;
}

function inCidrV6(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipG = ipv6ToGroups(ip);
  const netG = ipv6ToGroups(net);
  if (ipG === null || netG === null || bits < 0 || bits > 128) return false;
  let remaining = bits;
  for (let i = 0; i < 8; i++) {
    if (remaining <= 0) break;
    const take = remaining >= 16 ? 16 : remaining;
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((ipG[i] & mask) !== (netG[i] & mask)) return false;
    remaining -= 16;
  }
  return true;
}

/**
 * True when `ip` falls within a published Cloudflare edge range. Handles the
 * IPv4-mapped IPv6 form (::ffff:a.b.c.d) by testing the embedded v4. SECOND
 * FACTOR ONLY (design law #2). Never throws.
 */
export function isCloudflareEdgeIp(ip: string): boolean {
  if (!ip) return false;
  const bare = ip.replace(/^::ffff:/i, "");
  if (bare.includes(".") && !bare.includes(":")) {
    return CF_IPV4_CIDRS.some(c => inCidrV4(bare, c));
  }
  return CF_IPV6_CIDRS.some(c => inCidrV6(ip, c));
}

// ─── Origin shared secret (constant-time) ───────────────────────────────────

function sha256(v: string): Buffer {
  return crypto.createHash("sha256").update(v, "utf8").digest();
}

/** True when EDGE_ORIGIN_SECRET (or _PREV) is configured. */
export function hasOriginSecretConfigured(): boolean {
  return Boolean(
    (process.env.EDGE_ORIGIN_SECRET ?? "").trim() ||
    (process.env.EDGE_ORIGIN_SECRET_PREV ?? "").trim()
  );
}

/**
 * Constant-time comparison of the presented `x-dime-edge-secret` header value
 * against EDGE_ORIGIN_SECRET and (for zero-downtime rotation) _PREV. Digest
 * comparison keeps the timing independent of length. False when the header is
 * missing or when no secret is configured (so a missing secret can never pass).
 */
export function originSecretOk(headerVal: string | undefined | null): boolean {
  if (!headerVal) return false;
  const presented = sha256(headerVal);
  const candidates = [
    (process.env.EDGE_ORIGIN_SECRET ?? "").trim(),
    (process.env.EDGE_ORIGIN_SECRET_PREV ?? "").trim(),
  ].filter(Boolean);
  if (candidates.length === 0) return false;
  let ok = false;
  for (const c of candidates) {
    // timingSafeEqual over equal-length sha256 digests; OR-accumulate so the
    // number of comparisons does not depend on which (if any) matched.
    if (crypto.timingSafeEqual(presented, sha256(c))) ok = true;
  }
  return ok;
}

/**
 * The cryptographic edge proof, independent of EDGE_MODE: the request carries
 * a valid origin secret AND arrived from a Cloudflare-range immediate upstream.
 * Consumed by BOTH resolveClientIp (to trust cf-connecting-ip) and originLock
 * (to allow the request in "on" mode). The secret is the load-bearing factor;
 * the CF-range check is defence-in-depth (design law #2).
 */
export function edgeProofPasses(req: Pick<Request, "headers" | "ip">): boolean {
  const h = req.headers?.["x-dime-edge-secret"];
  const secretVal = Array.isArray(h) ? h[0] : h;
  if (!originSecretOk(secretVal)) return false;
  return isCloudflareEdgeIp(immediateUpstreamIp(req));
}
