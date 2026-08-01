/**
 * Display helpers for the admin Accounts Overview PLAN column.
 *
 * Extracted from UserManagement.tsx so the formatting rules are unit-testable
 * without mounting the page. The rules are load-bearing: the column previously
 * inferred the term from `stripePlanId === 'annual' ? 'ANNUAL' : 'MONTHLY'`,
 * which reported all 85 lifetime members as MONTHLY the moment plan slugs
 * stopped being those literal strings.
 */

export type PlanDisplay = {
  billingInterval: string | null;
  intervalCount: number | null;
  isLifetime: boolean | null;
  priceResolved: boolean;
};

/**
 * The billing term of a SKU, stated the way the schema means it.
 *
 * `billingInterval == null` on a price is the schema's encoding of "not
 * recurring" — a lifetime / one-off seat — so that case is spelled out rather
 * than falling through to a recurring default.
 */
export function formatBillingTerm(plan: PlanDisplay): string {
  // No price row behind this member: say so instead of implying a cadence.
  if (!plan.priceResolved) return "PLAN ONLY";
  if (plan.billingInterval == null) return "LIFETIME";
  const n = plan.intervalCount ?? 1;
  const unit = plan.billingInterval.toUpperCase();
  if (n !== 1) return `EVERY ${n} ${unit}S`;
  return unit === "DAY" ? "DAILY" : `${unit}LY`;
}

/**
 * Minor units → display currency.
 *
 * Explicitly null-checked rather than falsy-checked: 0 is a real amount (a comped
 * or $0 promo price) and must not render as "no amount".
 */
export function formatAmount(amountCents: number | null, currency: string | null): string {
  if (amountCents == null) return "—";
  const code = (currency ?? "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amountCents / 100);
  } catch {
    // Unknown/invalid ISO code — degrade to a plain number rather than throwing
    // inside a table cell and blanking the whole page.
    return `${(amountCents / 100).toFixed(2)} ${code}`;
  }
}
