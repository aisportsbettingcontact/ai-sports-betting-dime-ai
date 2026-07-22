/**
 * server/stripe/planStatus.ts
 *
 * Pure plan-status derivation for the billing data layer (Round-3 Step 3).
 *
 * Deliberately dependency-free (no DB, no Stripe API, no tRPC) so
 * `derivePlanStatus` is unit-testable in any container without secrets —
 * see server/stripe/planStatus.test.ts.
 *
 * Consumed by server/routers/stripe.ts's `getPlanStatus` procedure.
 */

import type { AppUser } from "../../drizzle/schema";
import { PLANS, normalizePlanId, type PlanId } from "./products";

const TAG = "[Stripe][PlanStatus]";

export type PlanStatusState = "active" | "cancel_scheduled" | "expired" | "none";

export interface PlanStatus {
  state: PlanStatusState;
  /** null only when state === "none" */
  planId: PlanId | null;
  /** null only when state === "none" */
  planLabel: string | null;
  /**
   * ms epoch (UTC). Meaning depends on state:
   *   active          → next renewal date
   *   cancel_scheduled→ date access ends (no further renewal)
   *   expired         → the date access already ended
   *   none            → null (nothing to govern)
   * Can be null even for a real plan when expiryDate is NULL (lifetime access).
   */
  governingDate: number | null;
}

/** Only the columns derivePlanStatus needs — keeps unit tests light. */
export type PlanStatusUser = Pick<
  AppUser,
  "stripeCustomerId" | "stripePlanId" | "expiryDate" | "cancelAtPeriodEnd" | "hasAccess"
>;

/**
 * derivePlanStatus
 *
 * Pure function — no I/O. Same boundary convention as the auth middlewares
 * elsewhere in this codebase (appUsers.ts): expiry is checked with a strict
 * `now > governingDate`, so a governingDate equal to `now` is NOT expired yet.
 *
 * [INPUT]  user — the caller's own row (or a Pick of the five billing columns).
 *          hasAccess=false (admin revocation — fraud/chargeback/ToS) forces
 *          state="expired" even when stripePlanId/expiryDate still look live.
 *          now  — ms epoch, defaults to Date.now() (pass explicitly in tests)
 * [OUTPUT] PlanStatus — never throws, never hits the network.
 */
export function derivePlanStatus(user: PlanStatusUser, now: number = Date.now()): PlanStatus {
  // ── [STEP 1] No Stripe customer or no plan on file → nothing to report ──────
  if (!user.stripeCustomerId || !user.stripePlanId) {
    console.log(`${TAG}[derivePlanStatus] [OUTPUT] state=none (no stripeCustomerId/stripePlanId)`);
    return { state: "none", planId: null, planLabel: null, governingDate: null };
  }

  const planId = normalizePlanId(user.stripePlanId);
  const planLabel = PLANS[planId].name;
  const governingDate = user.expiryDate ?? null;

  // ── [STEP 2] Past expiry — strictly greater than, matching appUserProcedure ─
  if (governingDate !== null && now > governingDate) {
    console.log(`${TAG}[derivePlanStatus] [OUTPUT] state=expired planId=${planId} governingDate=${governingDate}`);
    return { state: "expired", planId, planLabel, governingDate };
  }

  // ── [STEP 2.5] Access explicitly revoked (fraud/chargeback/ToS) ─────────────
  // hasAccess=false can be set by the admin-update endpoint independently of
  // stripePlanId/expiryDate (server/routers/appUsers.ts). Without this check a
  // revoked user would still read "active"/"cancel_scheduled" here — misleading
  // on the billing tab and inconsistent with the billing middleware's honest-
  // state rationale. Revoked access reads as expired on the billing surface;
  // renew/checkout remains available (this does not touch the "none" path —
  // webhook revocation already nulls stripePlanId, landing on "none" above).
  if (!user.hasAccess) {
    console.log(`${TAG}[derivePlanStatus] [OUTPUT] state=expired planId=${planId} governingDate=${governingDate} (hasAccess=false)`);
    return { state: "expired", planId, planLabel, governingDate };
  }

  // ── [STEP 3] Still within the paid period but set to lapse ──────────────────
  if (user.cancelAtPeriodEnd) {
    console.log(`${TAG}[derivePlanStatus] [OUTPUT] state=cancel_scheduled planId=${planId} governingDate=${governingDate}`);
    return { state: "cancel_scheduled", planId, planLabel, governingDate };
  }

  // ── [STEP 4] Active and set to auto-renew ────────────────────────────────────
  console.log(`${TAG}[derivePlanStatus] [OUTPUT] state=active planId=${planId} governingDate=${governingDate}`);
  return { state: "active", planId, planLabel, governingDate };
}
