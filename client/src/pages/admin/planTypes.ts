/**
 * planTypes.ts — CLIENT MIRROR of the subscription-plan catalog shapes.
 *
 * These interfaces intentionally duplicate server/stripe/planStore.ts's
 * `StoredPlan` / `StoredPrice` (verified field-for-field, 2026-07-24). The
 * client must NOT import server code — the tRPC data contract is documented in
 * design-system/dime-ai/pages/ai-model-projections.md's sibling billing spec
 * and re-stated here as the local source of truth for the admin UI.
 *
 * `INTERVAL_OPTIONS` is the curated billing-cadence list the Create Plan form
 * offers (Winible's cadences + Annual). It is pure data with no React
 * dependency so it can be unit-tested in vitest's node environment — which is
 * also why the Edit Plan modal's draft model and its validation live here
 * rather than inside SubscriptionPlans.tsx.
 */
import { normalizePlanFeatures } from "@shared/planFeatures";
import type { PlanFeatureKey } from "@shared/planFeatures";

export type BillingInterval = "day" | "week" | "month" | "year";
export type PlanType = "recurring" | "one_time" | "fixed_date";
export type PromoType = "percent" | "amount";

/**
 * A cadence choice in the Create/Add-interval form. Extends the Stripe billing
 * intervals with the sentinel "lifetime" — a one-time (single-payment) interval:
 * it carries NO Stripe `recurring` block and checks out as mode:"payment", granting
 * lifetime access. buildPricePayload maps "lifetime" → a payload with no `interval`.
 */
export type IntervalChoice = BillingInterval | "lifetime";

/** True when a cadence choice is the one-time "Lifetime" option. */
export function isLifetime(interval: IntervalChoice): boolean {
  return interval === "lifetime";
}

export interface StoredPrice {
  id: number;
  stripePriceId: string;
  label: string | null;
  amountCents: number;
  currency: string;
  interval: BillingInterval | null;
  intervalCount: number | null;
  trialPeriodDays: number | null;
  /** Per-interval promo. null = none. percent → 1–100; amount → cents off. */
  promoType: PromoType | null;
  promoValue: number | null;
  promoCode: string | null;
  stripeCouponId: string | null;
  active: boolean;
  isDefault: boolean;
  /** Owner-hidden interval (eyeball) — retained, not offered at checkout. */
  hidden: boolean;
  /** Display order among the plan's intervals (drag-to-reorder). */
  sortOrder: number;
  /** false → a Stripe TEST/sandbox price (owner-only test checkout); true → live. */
  livemode: boolean;
}

export interface StoredPlan {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  planType: PlanType;
  stripeProductId: string | null;
  active: boolean;
  accessUntil: number | null;
  maxSubscribers: number | null;
  /** Auto-restock FOMO loop. availableQuantity null = unlimited (feature off). */
  autoRestock: boolean;
  availableQuantity: number | null;
  restockThreshold: number | null;
  restockAmount: number | null;
  discordRoleId: string | null;
  telegramChatId: string | null;
  /** false → the plan was provisioned in the Stripe sandbox, not the live account. */
  livemode: boolean;
  prices: StoredPrice[];
  /**
   * Entitlement keys attached to this plan, already in the canonical
   * PLAN_FEATURE_KEYS order the server sorts them into. Empty = no features
   * selected yet.
   */
  features: PlanFeatureKey[];
  /** Count of subscribers with access on this plan (shown on the plan card). */
  subscriberCount: number;
}

/** A single billing-cadence choice: a human label → Stripe interval mapping. */
export interface IntervalOption {
  label: string;
  interval: IntervalChoice;
  intervalCount: number;
}

/** The value the IntervalPicker owns and emits — the Stripe cadence pair. */
export interface IntervalValue {
  interval: IntervalChoice;
  intervalCount: number;
}

/**
 * Curated billing cadences offered in the Create Plan form. Matches the Winible
 * catalog cadences plus an Annual option. NOTE the deliberate encodings:
 *   - "Weekly" is a native {week, 1}, but "Every 2 weeks" is {day, 14} because
 *     Stripe recurring prices do not accept interval_count > 1 on `week`.
 * Keep this list pure (no imports) so it stays unit-testable in node.
 */
export const INTERVAL_OPTIONS: IntervalOption[] = [
  { label: "Daily", interval: "day", intervalCount: 1 },
  { label: "Every 2 days", interval: "day", intervalCount: 2 },
  { label: "Every 3 days", interval: "day", intervalCount: 3 },
  { label: "Every 5 days", interval: "day", intervalCount: 5 },
  { label: "Weekly", interval: "week", intervalCount: 1 },
  { label: "Every 2 weeks", interval: "day", intervalCount: 14 },
  { label: "Monthly", interval: "month", intervalCount: 1 },
  { label: "Every 2 months", interval: "month", intervalCount: 2 },
  { label: "Quarterly", interval: "month", intervalCount: 3 },
  { label: "Semi-annual", interval: "month", intervalCount: 6 },
  { label: "Annual", interval: "year", intervalCount: 1 },
  // One-time: no cadence, no renewal — a single payment that grants lifetime access.
  { label: "Lifetime", interval: "lifetime", intervalCount: 1 },
];

/** The picker's default cadence — Monthly ({month, 1}). */
export const DEFAULT_INTERVAL: IntervalValue = { interval: "month", intervalCount: 1 };

// ─── Edit Plan draft model ───────────────────────────────────────────────────

/**
 * The per-interval form-row state IntervalFields owns, shared by the create
 * modals and the Edit Plan modal. Numbers are held as strings because they come
 * straight off <input> elements; coercion + validation happens once, in
 * buildPricePayload (create) or buildIntervalUpdateInput (edit).
 */
export interface IntervalFormDraft {
  key: string;
  price: string; // dollars
  interval: IntervalValue;
  trialDays: string;
  hidden: boolean;
  promoOn: boolean;
  promoType: PromoType;
  promoValue: string; // percent (int) or dollars
  promoCode: string;
}

/**
 * One interval row inside the Edit Plan modal. `priceId` is null for a row the
 * admin has just added — those are provisioned through addInterval on save,
 * existing rows through updateInterval.
 */
export interface IntervalEditDraft extends IntervalFormDraft {
  priceId: number | null;
  /** "" means "no display label" (submitted as null). */
  label: string;
  /** Radio-style: exactly one row on the plan carries the default price. */
  isDefault: boolean;
}

/** Seed one Edit Plan interval row from the price exactly as the list returned it. */
export function intervalEditDraftFrom(price: StoredPrice): IntervalEditDraft {
  return {
    key: `price-${price.id}`,
    priceId: price.id,
    price: (price.amountCents / 100).toFixed(2),
    // A stored price with no cadence IS the one-time "Lifetime" sentinel.
    interval: { interval: price.interval ?? "lifetime", intervalCount: price.intervalCount ?? 1 },
    trialDays: price.trialPeriodDays == null ? "" : String(price.trialPeriodDays),
    hidden: price.hidden,
    promoOn: price.promoType != null && price.promoValue != null,
    promoType: price.promoType ?? "percent",
    promoValue:
      price.promoValue == null
        ? ""
        : price.promoType === "amount"
          ? (price.promoValue / 100).toFixed(2)
          : String(price.promoValue),
    promoCode: price.promoCode ?? "",
    label: price.label ?? "",
    isDefault: price.isDefault,
  };
}

/**
 * The Edit Plan modal's form state. Numbers are held as strings because they
 * come straight off <input> elements — the same convention IntervalFormDraft
 * uses. Coercion + validation happens once, in buildPlanUpdateInput.
 */
export interface PlanEditDraft {
  name: string;
  /** "" means "clear the description" (submitted as null). */
  description: string;
  /** "" means unlimited (submitted as null). */
  maxSubscribers: string;
  /** Mirrors `availableQuantity != null` — the limited-quantity toggle. */
  limitedQuantity: boolean;
  availableQuantity: string;
  autoRestock: boolean;
  restockThreshold: string;
  restockAmount: string;
  features: PlanFeatureKey[];
  /** The plan's live (active) intervals, in the order the card renders them. */
  intervals: IntervalEditDraft[];
}

/** Seed the Edit Plan modal from the plan exactly as the list query returned it. */
export function planEditDraftFrom(plan: StoredPlan): PlanEditDraft {
  const num = (v: number | null) => (v == null ? "" : String(v));
  return {
    name: plan.name,
    description: plan.description ?? "",
    maxSubscribers: num(plan.maxSubscribers),
    limitedQuantity: plan.availableQuantity != null,
    availableQuantity: num(plan.availableQuantity),
    autoRestock: plan.autoRestock,
    restockThreshold: num(plan.restockThreshold),
    restockAmount: num(plan.restockAmount),
    features: normalizePlanFeatures(plan.features),
    intervals: plan.prices.filter((p) => p.active).map(intervalEditDraftFrom),
  };
}

/** Radio semantics for the default-price selector: exactly one row ever wins. */
export function setDefaultIntervalKey(intervals: readonly IntervalEditDraft[], key: string): IntervalEditDraft[] {
  return intervals.map((iv) => ({ ...iv, isDefault: iv.key === key }));
}

/**
 * Drop one interval row. A plan must keep at least one interval, so removing the
 * last is a no-op; removing the default promotes the first survivor so the plan
 * is never left without a price to check out with.
 */
export function removeIntervalDraft(intervals: readonly IntervalEditDraft[], key: string): IntervalEditDraft[] {
  if (intervals.length <= 1) return intervals.slice();
  const kept = intervals.filter((iv) => iv.key !== key);
  return kept.some((iv) => iv.isDefault) ? kept : setDefaultIntervalKey(kept, kept[0].key);
}

/** Add or remove one key, always returning the canonical de-duplicated order. */
export function toggleFeatureKey(selected: readonly string[], key: string): PlanFeatureKey[] {
  const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
  return normalizePlanFeatures(next);
}

/** The limited-quantity / auto-restock block. null = no quantity cap at all. */
export interface PlanRestockInput {
  autoRestock: boolean;
  availableQuantity: number | null;
  restockThreshold: number | null;
  restockAmount: number | null;
}

/**
 * The subscriptionPlans.update input: everything about the plan that is NOT a
 * Stripe price. Pricing rides on buildIntervalUpdateInput / addInterval /
 * removeInterval instead, because a Stripe Price cannot be edited in place.
 */
export interface PlanUpdateInput {
  planId: number;
  name: string;
  description: string | null;
  maxSubscribers: number | null;
  features: PlanFeatureKey[];
  restock: PlanRestockInput | null;
}

/** Validate + convert an edit draft to the update payload, or an error string. */
export function buildPlanUpdateInput(planId: number, draft: PlanEditDraft): PlanUpdateInput | string {
  const name = draft.name.trim();
  if (!name) return "Name is required.";

  let maxSubscribers: number | null = null;
  if (draft.maxSubscribers.trim()) {
    const m = parseInt(draft.maxSubscribers, 10);
    if (Number.isNaN(m) || m < 1) return "Max subscribers must be 1 or more (leave blank for unlimited).";
    maxSubscribers = m;
  }

  // Toggle off → null, which clears the cap entirely (unlimited spots).
  let restock: PlanRestockInput | null = null;
  if (draft.limitedQuantity) {
    const avail = parseInt(draft.availableQuantity, 10);
    if (Number.isNaN(avail) || avail < 0) return "Available quantity must be 0 or more.";
    if (draft.autoRestock) {
      const thr = parseInt(draft.restockThreshold, 10);
      if (Number.isNaN(thr) || thr < 0) return "Restock threshold must be 0 or more.";
      const amt = parseInt(draft.restockAmount, 10);
      if (Number.isNaN(amt) || amt < 1) return "Restock amount must be 1 or more.";
      restock = { autoRestock: true, availableQuantity: avail, restockThreshold: thr, restockAmount: amt };
    } else {
      restock = { autoRestock: false, availableQuantity: avail, restockThreshold: null, restockAmount: null };
    }
  }

  return {
    planId,
    name,
    description: draft.description.trim() || null,
    maxSubscribers,
    features: normalizePlanFeatures(draft.features),
    restock,
  };
}

// ─── Per-interval update payload ─────────────────────────────────────────────

/** A per-interval promo, matching what the create form collects. */
export interface IntervalPromoInput {
  type: PromoType;
  value: number;
  code?: string;
}

/**
 * The subscriptionPlans.updateInterval input.
 *
 * Every field is sent on every save — a sparse patch would make "clear the
 * trial" indistinguishable from "leave the trial alone". `interval: null` is the
 * one-time ("Lifetime") cadence and carries no intervalCount and no trial.
 *
 * NOTE the Stripe contract this payload rides on: Prices are immutable, so the
 * server answers a changed amount/currency/cadence by minting a NEW Stripe Price
 * and retiring the old one (`changed: true` in the result). Existing subscribers
 * stay on the price they bought until they are migrated.
 */
export interface IntervalUpdateInput {
  priceId: number;
  amountCents: number;
  currency?: string;
  interval?: BillingInterval | null;
  intervalCount?: number;
  label?: string | null;
  trialPeriodDays?: number | null;
  hidden?: boolean;
  isDefault?: boolean;
  promo?: IntervalPromoInput | null;
}

/**
 * Validate + convert one edited interval row to its mutation payload, or an
 * error string — the buildPricePayload idiom, keyed to an existing StoredPrice
 * (which supplies the row's id and its unchanged currency).
 */
export function buildIntervalUpdateInput(
  price: StoredPrice,
  draft: IntervalEditDraft,
  label = draft.label.trim() || `Interval ${price.id}`,
): IntervalUpdateInput | string {
  const amountCents = Math.round(parseFloat(draft.price) * 100);
  if (Number.isNaN(amountCents) || amountCents < 50) return `${label}: enter a price of at least $0.50.`;

  const payload: IntervalUpdateInput = {
    priceId: price.id,
    amountCents,
    currency: price.currency,
    interval: null,
    label: draft.label.trim() || null,
    trialPeriodDays: null,
    hidden: draft.hidden,
    isDefault: draft.isDefault,
    promo: null,
  };

  // "Lifetime" is the one-time sentinel: no cadence, no count, no trial — the
  // server mints a one-time Stripe price (mode:"payment" at checkout).
  if (!isLifetime(draft.interval.interval)) {
    payload.interval = draft.interval.interval as BillingInterval;
    payload.intervalCount = draft.interval.intervalCount;
    if (draft.trialDays.trim()) {
      const t = parseInt(draft.trialDays, 10);
      if (Number.isNaN(t) || t < 0) return `${label}: free trial days must be 0 or more.`;
      payload.trialPeriodDays = t;
    }
  }

  if (draft.promoOn) {
    const raw = draft.promoValue.trim();
    if (!raw) return `${label}: enter a promo value.`;
    let value: number;
    if (draft.promoType === "percent") {
      value = parseInt(raw, 10);
      if (Number.isNaN(value) || value < 1 || value > 100) return `${label}: percent promo must be 1–100.`;
    } else {
      value = Math.round(parseFloat(raw) * 100);
      if (Number.isNaN(value) || value < 1) return `${label}: enter a valid discount amount.`;
      if (value >= amountCents) return `${label}: discount must be less than the price.`;
    }
    const code = draft.promoCode.trim();
    if (code && !/^[A-Za-z0-9_-]{2,64}$/.test(code)) {
      return `${label}: promo code must be 2–64 chars (letters, numbers, - or _).`;
    }
    payload.promo = { type: draft.promoType, value, ...(code ? { code } : {}) };
  }

  return payload;
}
