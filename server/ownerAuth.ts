import type { AppUser } from "../drizzle/schema";
import type { AppUserLookupResult } from "./db";
import type { CachedAppUserEntry } from "./dbCircuitBreaker";

/** Privileged access may survive a short DB incident, but never for five minutes. */
export const OWNER_FALLBACK_MAX_AGE_MS = 60_000;

export type OwnerIdentityResult =
  | { ok: true; user: AppUser; source: "database" | "fallback" }
  | {
      ok: false;
      reason:
        | "not_found"
        | "fallback_missing"
        | "fallback_stale"
        | "access_disabled"
        | "not_owner"
        | "token_version_missing"
        | "token_version_mismatch";
    };

type ResolveOwnerIdentityInput = {
  lookup: AppUserLookupResult;
  fallback: CachedAppUserEntry | null;
  tokenVersion: number | null | undefined;
  now?: number;
};

/**
 * Apply the owner authorization and outage policy to an authoritative lookup.
 * A definitive missing row never falls back. During an outage, only a recent
 * last-known-good owner row with a matching tokenVersion may be used.
 */
export function resolveOwnerIdentity({
  lookup,
  fallback,
  tokenVersion,
  now = Date.now(),
}: ResolveOwnerIdentityInput): OwnerIdentityResult {
  if (lookup.status === "not_found") return { ok: false, reason: "not_found" };

  let user: AppUser;
  let source: "database" | "fallback";
  if (lookup.status === "found") {
    user = lookup.user;
    source = "database";
  } else {
    if (!fallback) return { ok: false, reason: "fallback_missing" };
    if (now - fallback.cachedAt > OWNER_FALLBACK_MAX_AGE_MS) {
      return { ok: false, reason: "fallback_stale" };
    }
    user = fallback.user;
    source = "fallback";
  }

  if (!user.hasAccess) return { ok: false, reason: "access_disabled" };
  if (user.role !== "owner") return { ok: false, reason: "not_owner" };
  if (tokenVersion === null || tokenVersion === undefined) {
    return { ok: false, reason: "token_version_missing" };
  }
  if (user.tokenVersion !== tokenVersion) {
    return { ok: false, reason: "token_version_mismatch" };
  }

  return { ok: true, user, source };
}
