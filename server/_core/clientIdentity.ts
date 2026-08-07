import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { cfConnectingIp, edgeProofPasses } from "./edgeProxy";

/**
 * THE single source of "who is this request from".
 *
 * Nothing outside this module may parse `x-forwarded-for` or read `req.ip` to
 * identify a client. The 2026-08-06 forensic audit found TWELVE sites that
 * hand-rolled it, six of them driving a decision, a limit, or a stored value.
 *
 * Production hop structure (PROVEN, verbatim from Railway logs):
 *     x-forwarded-for = "104.22.17.115, 84.17.44.227"
 *                        ^ Cloudflare PoP   ^ Railway edge
 * Railway DISCARDS Cloudflare's appended client token, so the true visitor
 * appears NOWHERE in XFF — only in `cf-connecting-ip`. The PoP rotates per
 * connection. Under `trust proxy 1`, `req.ip` is the RIGHTMOST token, i.e.
 * Railway's own edge node, shared by every visitor.
 *
 * Resolution order:
 *   1. `cf-connecting-ip`, but ONLY when the request cryptographically proves
 *      it came through our Cloudflare edge (valid `x-dime-edge-secret` AND a
 *      CF-range upstream). Without the proof the header is client-forgeable
 *      and would hand an attacker an arbitrary-IP lever.
 *   2. Leftmost X-Forwarded-For — correct for a direct-to-origin hit, where
 *      Railway's edge saw the client as its own peer.
 *   3. `req.ip` — last resort.
 *
 * DELIBERATELY NOT gated on `edgeMode()`. The previous implementation only
 * consulted `cf-connecting-ip` when `edgeMode() !== "off"`, which meant the
 * tempting one-step rollback `EDGE_MODE=off` instantly collapsed all six rate
 * limiters onto per-PoP buckets while DNS was still orange-clouded. The origin
 * proof is self-sufficient: if the secret validates and the upstream is in a
 * Cloudflare range, the header is trustworthy regardless of enforcement mode.
 */
export function resolveClientIdentity(
  req: Pick<Request, "headers" | "ip">
): string {
  const cf = cfConnectingIp(req);
  if (cf && edgeProofPasses(req)) return cf;

  const xff = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || req.ip || "";
}

/**
 * Rate-limit key form. `ipKeyGenerator` is mandatory for IPv6 /56
 * normalisation — express-rate-limit v8 throws ERR_ERL_KEY_GEN_IPV6 on a raw
 * address.
 */
export function clientIdentityKey(
  req: Pick<Request, "headers" | "ip">
): string {
  return ipKeyGenerator(resolveClientIdentity(req));
}

/** Which branch produced the identity. Observability only. */
export function identitySource(
  req: Pick<Request, "headers" | "ip">
): "cf-connecting-ip" | "xff-leftmost" | "req.ip" {
  const cf = cfConnectingIp(req);
  if (cf && edgeProofPasses(req)) return "cf-connecting-ip";
  const xff = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first ? "xff-leftmost" : "req.ip";
}
