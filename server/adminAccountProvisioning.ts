/**
 * server/adminAccountProvisioning.ts
 *
 * Pure helpers behind the owner-only Create Account flow (appUsers.createUser).
 *
 * WHY THIS EXISTS: the modal used to submit free-form expiry dates while the
 * plan/interval assignment lived in the owner's head — an account could claim
 * "Sharp Lifetime" with a 30-day expiry, or a plan slug that matched no
 * catalog row. These helpers make the server derive slug + expiry from the ONE
 * client-sent fact (`planPriceId`), through the SAME `computeExpiryMsForPrice`
 * the Stripe webhook uses, so a hand-created member and a webhook-provisioned
 * member can never disagree about what an interval means.
 *
 * Dependency-free by design (catalog passed in, no DB, no Stripe, crypto only)
 * so server/adminAccountProvisioning.test.ts runs without secrets — the same
 * boundary convention as planStatus.ts / entitlementAssignment.test.ts.
 */
import crypto from "crypto";
import { buildInviteCode } from "../shared/inviteCode";
import {
  computeExpiryMsForPrice,
  LIFETIME_ACCESS_UNTIL_MS,
  type StoredPlan,
  type StoredPrice,
} from "./stripe/planStore";

const TAG = "[AdminProvisioning]";

/**
 * Claim links are owner-forwarded (Discord DM, text), not clicked-from-inbox
 * like a self-serve reset — 30 minutes would strand most members. 7 days,
 * single-use, sha256 at rest: same storage columns as the reset flow.
 */
export const CLAIM_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Entitlement derivation ───────────────────────────────────────────────────

export interface DerivedEntitlement {
  stripePlanId: string;
  planPriceId: number;
  /** UTC ms, or NULL for lifetime — matching app_users.expiryDate semantics. */
  expiryDate: number | null;
}

export type DeriveResult =
  | { ok: true; entitlement: DerivedEntitlement }
  | { ok: false; error: string };

/** Locate a price by its NUMERIC plan_prices.id (getPriceById keys on the Stripe id). */
export function findPriceByNumericId(
  plans: StoredPlan[],
  planPriceId: number,
): { plan: StoredPlan; price: StoredPrice } | null {
  for (const plan of plans) {
    const price = plan.prices.find((pr) => pr.id === planPriceId);
    if (price) return { plan, price };
  }
  return null;
}

/**
 * planPriceId → { slug, planPriceId, expiryDate }, validated against the live
 * catalog. Inactive plans/prices are rejected: "available and exist within the
 * plan selected" is the modal's contract, and a retired SKU assigned by typo
 * would be invisible to every active-catalog query.
 *
 * `LIFETIME_ACCESS_UNTIL_MS` (the webhook's far-future lifetime sentinel) maps
 * to NULL here because every existing lifetime row uses expiryDate NULL and
 * the whole admin surface (formatExpiry, entitled predicate) reads NULL as
 * lifetime. fixed_date plans keep their real accessUntil.
 */
export function deriveEntitlementFromPrice(
  plans: StoredPlan[],
  planPriceId: number,
  nowMs: number,
): DeriveResult {
  const found = findPriceByNumericId(plans, planPriceId);
  if (!found) {
    console.warn(`${TAG}[derive] [VERIFY] FAIL — planPriceId=${planPriceId} not in catalog`);
    return { ok: false, error: `Unknown plan interval (planPriceId=${planPriceId}).` };
  }
  const { plan, price } = found;
  if (!plan.active) {
    console.warn(`${TAG}[derive] [VERIFY] FAIL — plan=${plan.slug} inactive`);
    return { ok: false, error: `Plan "${plan.name}" is inactive.` };
  }
  if (!price.active) {
    console.warn(`${TAG}[derive] [VERIFY] FAIL — planPriceId=${planPriceId} inactive on plan=${plan.slug}`);
    return { ok: false, error: `That interval is inactive on plan "${plan.name}".` };
  }

  const rawExpiry = computeExpiryMsForPrice(price, plan, nowMs);
  const expiryDate = rawExpiry === LIFETIME_ACCESS_UNTIL_MS ? null : rawExpiry;
  console.log(
    `${TAG}[derive] [OUTPUT] planPriceId=${planPriceId} slug=${plan.slug}` +
    ` interval=${price.interval ?? "lifetime"} expiryDate=${expiryDate ?? "null (lifetime)"}`
  );
  return { ok: true, entitlement: { stripePlanId: plan.slug, planPriceId, expiryDate } };
}

// ─── Claim link ───────────────────────────────────────────────────────────────

export interface ClaimToken {
  /**
   * Goes in the URL, never stored. 16 CSPRNG bytes as 22 base64url chars —
   * 128 bits of entropy, which for a sha256-hashed-at-rest, single-use,
   * 7-day token is far beyond guessable; the shorter alphabet exists purely
   * so invite links stay send-able (owner request 2026-08-03). Long-form
   * 64-hex reset tokens remain valid — the consumer hashes whatever string
   * it is handed.
   */
  rawToken: string;
  /** sha256(rawToken) — what app_users.passwordResetToken stores. */
  tokenHash: string;
  /** UTC ms — app_users.passwordResetExpiresAt. */
  expiresAt: number;
}

export function mintClaimToken(nowMs: number): ClaimToken {
  const rawToken = crypto.randomBytes(16).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash, expiresAt: nowMs + CLAIM_LINK_TTL_MS };
}

/**
 * Compact form: `/invite/<uid base36>.<token>` (shared/inviteCode.ts codec).
 * The route itself implies the first-time "welcome" treatment, and the same
 * resetPassword mutation consumes the token — /reset-password links already
 * in the wild are untouched.
 */
export function buildClaimUrl(origin: string, userId: number, rawToken: string): string {
  return `${origin.replace(/\/$/, "")}/invite/${buildInviteCode(userId, rawToken)}`;
}

// ─── Password policy at creation ─────────────────────────────────────────────

export type PasswordResolution =
  | { ok: true; password: string; generated: boolean }
  | { ok: false; error: string };

/**
 * Owner-typed password wins. With a claim link and no password, a CSPRNG
 * throwaway is minted (the member replaces it when claiming — nobody ever
 * knows it). No password and no claim link is a hard error: that account
 * could never be logged into.
 */
export function resolveCreationPassword(input: {
  password: string | null | undefined;
  generateClaimLink: boolean;
}): PasswordResolution {
  const typed = input.password?.trim() ?? "";
  if (typed.length >= 8) return { ok: true, password: typed, generated: false };
  if (typed.length > 0) return { ok: false, error: "Password must be at least 8 characters." };
  if (input.generateClaimLink) {
    return { ok: true, password: crypto.randomBytes(24).toString("base64url"), generated: true };
  }
  return { ok: false, error: "Provide a password or enable the invite link." };
}
