/**
 * SubscriptionPlans — owner-only admin surface for the DB-backed plan catalog.
 *
 * Route /admin/plans. UI on top of the `subscriptionPlans` tRPC router
 * (server/routers/subscriptionPlans.ts):
 *   - Create a plan with ONE OR MORE billing intervals (variants). Each interval
 *     carries its own price, cadence, free-trial days, and optional promo
 *     (% or fixed amount, with an optional shareable code) — e.g. Dime Pro at
 *     $99/mo AND $49/wk, 50% off the monthly and 25% off the weekly.
 *   - Manage an existing plan: add or remove intervals, edit the auto-restock
 *     "limited quantity" FOMO counter.
 *   - Archive a plan, import legacy static plans, and run an owner-only test
 *     checkout for sandbox plans.
 *
 * Auth: CLIENT (cosmetic) half of the owner lockdown — the real boundary is the
 * server-verified ownerProcedure on EVERY subscriptionPlans procedure.
 *
 * Design: Dime brand law (design-system/dime-ai/MASTER.md) — semantic tokens
 * only, Familjen Grotesk for values/headings, IBM Plex Mono for micro-labels +
 * money + Stripe IDs, rounded-xl cards, 160ms motion, visible focus rings, mint
 * as the sole signal. The ONE destructive-red carve-out (--dime-danger) appears
 * only on the Archive / remove-interval confirms, per MASTER.md's exception.
 * Layout uses the shared fluid `.admin-container` so it fills the screen.
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "wouter";
import {
  RefreshCw,
  CreditCard,
  Loader2,
  Plus,
  Check,
  DownloadCloud,
  FlaskConical,
  X,
  Tag,
  Package,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import { AdminShell } from "@/pages/admin/AdminShell";
import { IntervalPicker } from "@/pages/admin/IntervalPicker";
import { DEFAULT_INTERVAL } from "@/pages/admin/planTypes";
import type { StoredPlan, StoredPrice, IntervalValue, PromoType } from "@/pages/admin/planTypes";

// ─── Draft model (create form + add-interval form) ───────────────────────────

interface IntervalDraft {
  key: string;
  price: string; // dollars
  interval: IntervalValue;
  trialDays: string;
  promoOn: boolean;
  promoType: PromoType;
  promoValue: string; // percent (int) or dollars
  promoCode: string;
}

function blankInterval(): IntervalDraft {
  return {
    key: Math.random().toString(36).slice(2),
    price: "",
    interval: DEFAULT_INTERVAL,
    trialDays: "",
    promoOn: false,
    promoType: "percent",
    promoValue: "",
    promoCode: "",
  };
}

/** Validated price payload for the tRPC create/addInterval mutations. */
interface PricePayload {
  amountCents: number;
  interval: IntervalValue["interval"];
  intervalCount: number;
  trialPeriodDays?: number;
  promo?: { type: PromoType; value: number; code?: string };
}

/**
 * Validate + convert one interval draft to a mutation payload. Returns the
 * payload, or an error string (with a 1-based row label) for inline display.
 */
function buildPricePayload(iv: IntervalDraft, label: string): PricePayload | string {
  const amountCents = Math.round(parseFloat(iv.price) * 100);
  if (Number.isNaN(amountCents) || amountCents < 50) return `${label}: enter a price of at least $0.50.`;

  let trialPeriodDays: number | undefined;
  if (iv.trialDays.trim()) {
    const t = parseInt(iv.trialDays, 10);
    if (Number.isNaN(t) || t < 0) return `${label}: free trial days must be 0 or more.`;
    trialPeriodDays = t;
  }

  let promo: PricePayload["promo"];
  if (iv.promoOn) {
    const raw = iv.promoValue.trim();
    if (!raw) return `${label}: enter a promo value.`;
    let value: number;
    if (iv.promoType === "percent") {
      value = parseInt(raw, 10);
      if (Number.isNaN(value) || value < 1 || value > 100) return `${label}: percent promo must be 1–100.`;
    } else {
      value = Math.round(parseFloat(raw) * 100);
      if (Number.isNaN(value) || value < 1) return `${label}: enter a valid discount amount.`;
      if (value >= amountCents) return `${label}: discount must be less than the price.`;
    }
    const code = iv.promoCode.trim();
    if (code && !/^[A-Za-z0-9_-]{2,64}$/.test(code)) {
      return `${label}: promo code must be 2–64 chars (letters, numbers, - or _).`;
    }
    promo = { type: iv.promoType, value, ...(code ? { code } : {}) };
  }

  return {
    amountCents,
    interval: iv.interval.interval,
    intervalCount: iv.interval.intervalCount,
    ...(trialPeriodDays !== undefined ? { trialPeriodDays } : {}),
    ...(promo ? { promo } : {}),
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** ` / month` or ` / 3 week`; empty when the price has no interval. */
function per(price: StoredPrice): string {
  if (!price.interval) return "";
  const count = price.intervalCount && price.intervalCount > 1 ? `${price.intervalCount} ` : "";
  return ` / ${count}${price.interval}`;
}

/** The discounted amount a promo yields, or null when there is no promo. */
function discountedCents(price: StoredPrice): number | null {
  if (!price.promoType || price.promoValue == null) return null;
  if (price.promoType === "percent") {
    return Math.max(0, Math.round(price.amountCents * (1 - price.promoValue / 100)));
  }
  return Math.max(0, price.amountCents - price.promoValue);
}

function promoLabel(price: StoredPrice): string | null {
  if (!price.promoType || price.promoValue == null) return null;
  return price.promoType === "percent" ? `${price.promoValue}% off` : `${money(price.promoValue)} off`;
}

/** The default (or first active) price on a plan — the one checkout charges. */
function defaultActivePrice(plan: StoredPlan): StoredPrice | null {
  return (
    plan.prices.find((p) => p.active && p.isDefault) ??
    plan.prices.find((p) => p.active) ??
    plan.prices[0] ??
    null
  );
}

function truncateId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 19)}…` : id;
}

// ─── Shared styling ──────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors duration-150 focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";
const labelClass = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";
const chipBtn =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

// ─── Interval fields (reused by create rows + add-to-existing) ───────────────

function IntervalFields({
  value,
  onChange,
}: {
  value: IntervalDraft;
  onChange: (patch: Partial<IntervalDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* Price */}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Price (USD)</label>
        <input
          type="text"
          inputMode="decimal"
          value={value.price}
          onChange={(e) => onChange({ price: e.target.value })}
          placeholder="99.00"
          className={`${inputClass} font-mono`}
        />
      </div>

      {/* Interval */}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Billing interval</label>
        <IntervalPicker value={value.interval} onChange={(interval) => onChange({ interval })} />
      </div>

      {/* Trial days */}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>
          Free trial days <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <input
          type="number"
          min={0}
          value={value.trialDays}
          onChange={(e) => onChange({ trialDays: e.target.value })}
          placeholder="0"
          className={`${inputClass} font-mono`}
        />
      </div>

      {/* Promo toggle */}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Promo</label>
        <button
          type="button"
          onClick={() => onChange({ promoOn: !value.promoOn })}
          aria-pressed={value.promoOn}
          className={`inline-flex h-[42px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            value.promoOn
              ? "border-primary text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <Tag className="h-4 w-4" aria-hidden="true" />
          {value.promoOn ? "Promo on" : "Add promo"}
        </button>
      </div>

      {/* Promo detail row — only when enabled */}
      {value.promoOn && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:col-span-4">
          {/* Type */}
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Discount type</label>
            <div className="inline-flex rounded-lg border border-border p-1">
              {(["percent", "amount"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChange({ promoType: t })}
                  aria-pressed={value.promoType === t}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                    value.promoType === t
                      ? "bg-[var(--row-active)] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "percent" ? "% off" : "$ off"}
                </button>
              ))}
            </div>
          </div>

          {/* Value */}
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>
              {value.promoType === "percent" ? "Percent (1–100)" : "Amount off (USD)"}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={value.promoValue}
              onChange={(e) => onChange({ promoValue: e.target.value })}
              placeholder={value.promoType === "percent" ? "50" : "25.00"}
              className={`${inputClass} font-mono`}
            />
          </div>

          {/* Code */}
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>
              Code <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={value.promoCode}
              onChange={(e) => onChange({ promoCode: e.target.value })}
              placeholder="LAUNCH50"
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SubscriptionPlans() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && (!appUser || appUser.role !== "owner")) {
      console.warn(
        `[SubscriptionPlans] Unauthorized: user=${appUser?.username ?? "unauthenticated"} role=${appUser?.role ?? "none"} → redirecting`,
      );
      navigate("/feed/model/mlb");
    }
  }, [loading, appUser, navigate]);

  const isOwner = !loading && !!appUser && appUser.role === "owner";

  // ── Create-form state ──────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [intervals, setIntervals] = useState<IntervalDraft[]>([blankInterval()]);
  const [maxSubs, setMaxSubs] = useState("");
  const [limitedQty, setLimitedQty] = useState(false);
  const [availableQty, setAvailableQty] = useState("");
  const [autoRestock, setAutoRestock] = useState(false);
  const [restockThreshold, setRestockThreshold] = useState("");
  const [restockAmount, setRestockAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; stripeProductId: string; stripePriceId: string } | null>(null);

  // ── Per-row UI state ───────────────────────────────────────────────────────
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // ── Data (owner-gated) ─────────────────────────────────────────────────────
  const testModeQuery = trpc.subscriptionPlans.testMode.useQuery(undefined, { enabled: isOwner, staleTime: 60_000 });
  const listQuery = trpc.subscriptionPlans.list.useQuery(undefined, { enabled: isOwner, staleTime: 15_000 });
  const utils = trpc.useUtils();

  function patchInterval(key: string, patch: Partial<IntervalDraft>) {
    setIntervals((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function resetForm() {
    setName("");
    setDescription("");
    setIntervals([blankInterval()]);
    setMaxSubs("");
    setLimitedQty(false);
    setAvailableQty("");
    setAutoRestock(false);
    setRestockThreshold("");
    setRestockAmount("");
    setFormError(null);
  }

  const createMutation = trpc.subscriptionPlans.create.useMutation({
    onSuccess: (result) => {
      setCreated(result);
      resetForm();
      utils.subscriptionPlans.list.invalidate();
      toast.success("Plan created", { description: `${result.slug} · ${result.stripeProductId}` });
    },
    onError: (err) => setFormError(err.message),
  });

  const archiveMutation = trpc.subscriptionPlans.archive.useMutation({
    onSuccess: () => {
      setConfirmArchiveId(null);
      utils.subscriptionPlans.list.invalidate();
      toast.success("Plan archived");
    },
    onError: (err) => toast.error("Archive failed", { description: err.message }),
  });

  const backfillMutation = trpc.subscriptionPlans.backfill.useMutation({
    onSuccess: (result) => {
      utils.subscriptionPlans.list.invalidate();
      toast.success("Legacy plans imported", { description: `${result.inserted} inserted · ${result.skipped} skipped` });
    },
    onError: (err) => toast.error("Import failed", { description: err.message }),
  });

  const testCheckoutMutation = trpc.subscriptionPlans.createTestCheckoutSession.useMutation({
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Test checkout opened", { description: "Finish it with a Stripe test card in the new tab." });
    },
    onError: (err) => toast.error("Test checkout failed", { description: err.message }),
  });

  const addIntervalMutation = trpc.subscriptionPlans.addInterval.useMutation({
    onSuccess: () => {
      utils.subscriptionPlans.list.invalidate();
      toast.success("Interval added");
    },
    onError: (err) => toast.error("Add interval failed", { description: err.message }),
  });

  const removeIntervalMutation = trpc.subscriptionPlans.removeInterval.useMutation({
    onSuccess: () => {
      utils.subscriptionPlans.list.invalidate();
      toast.success("Interval removed");
    },
    onError: (err) => toast.error("Remove failed", { description: err.message }),
  });

  const updateRestockMutation = trpc.subscriptionPlans.updateRestock.useMutation({
    onSuccess: () => {
      utils.subscriptionPlans.list.invalidate();
      toast.success("Quantity settings saved");
    },
    onError: (err) => toast.error("Save failed", { description: err.message }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreated(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }

    const prices: PricePayload[] = [];
    for (let i = 0; i < intervals.length; i++) {
      const built = buildPricePayload(intervals[i], `Interval ${i + 1}`);
      if (typeof built === "string") {
        setFormError(built);
        return;
      }
      prices.push(built);
    }

    let maxSubscribers: number | null = null;
    if (maxSubs.trim()) {
      const m = parseInt(maxSubs, 10);
      if (Number.isNaN(m) || m < 1) {
        setFormError("Max subscribers must be 1 or more (leave blank for unlimited).");
        return;
      }
      maxSubscribers = m;
    }

    let restock:
      | { autoRestock: boolean; availableQuantity: number | null; restockThreshold: number | null; restockAmount: number | null }
      | null = null;
    if (limitedQty) {
      const avail = parseInt(availableQty, 10);
      if (Number.isNaN(avail) || avail < 0) {
        setFormError("Available quantity must be 0 or more.");
        return;
      }
      if (autoRestock) {
        const thr = parseInt(restockThreshold, 10);
        const amt = parseInt(restockAmount, 10);
        if (Number.isNaN(thr) || thr < 0) {
          setFormError("Restock threshold must be 0 or more.");
          return;
        }
        if (Number.isNaN(amt) || amt < 1) {
          setFormError("Restock amount must be 1 or more.");
          return;
        }
        restock = { autoRestock: true, availableQuantity: avail, restockThreshold: thr, restockAmount: amt };
      } else {
        restock = { autoRestock: false, availableQuantity: avail, restockThreshold: null, restockAmount: null };
      }
    }

    createMutation.mutate({
      name: trimmedName,
      description: description.trim() || undefined,
      prices,
      maxSubscribers,
      restock,
    });
  }

  if (loading || (!loading && (!appUser || appUser.role !== "owner"))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3">
        <RefreshCw className="w-5 h-5 text-foreground animate-spin" />
        <span className="text-sm text-foreground">{loading ? "Authenticating..." : "Redirecting..."}</span>
      </div>
    );
  }

  const testMode = testModeQuery.data?.testMode === true;
  const plans: StoredPlan[] = listQuery.data ?? [];

  return (
    <AdminShell active="plans">
      <div className="w-full bg-muted/30 text-foreground">
        <div className="admin-container py-6 sm:py-8">
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
                  Subscription Plans
                </h1>
                {testMode && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-wider text-primary"
                    title="Plans are provisioned in the Stripe sandbox, not the live account."
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                    Sandbox / Test Mode
                  </span>
                )}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                Build a plan with any number of billing intervals — each with its own price, free trial, and
                promo. Add or remove intervals anytime, and run a limited-quantity auto-restock loop.
              </p>
            </div>

            <button
              type="button"
              onClick={() => backfillMutation.mutate()}
              disabled={backfillMutation.isPending}
              className="inline-flex flex-shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {backfillMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <DownloadCloud className="h-4 w-4" aria-hidden="true" />
              )}
              Import legacy plans
            </button>
          </div>

          {/* ── Create panel ───────────────────────────────────────────────── */}
          <form onSubmit={handleCreate} className="mb-8 rounded-xl border border-border bg-card px-4 py-4 sm:px-6 sm:py-5">
            <div className="mb-4 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold tracking-tight">Create a plan</h2>
            </div>

            {/* Plan basics */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-name" className={labelClass}>
                  Name
                </label>
                <input
                  id="plan-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dime Pro"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-description" className={labelClass}>
                  Description <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="plan-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What subscribers get with this plan."
                  className={inputClass}
                />
              </div>
            </div>

            {/* Intervals */}
            <div className="mt-6 flex items-center justify-between">
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Billing intervals
              </h3>
              <button type="button" onClick={() => setIntervals((r) => [...r, blankInterval()])} className={chipBtn}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add interval
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-4">
              {intervals.map((iv, i) => (
                <div key={iv.key} className="rounded-lg border border-border bg-background/40 p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Interval {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIntervals((r) => (r.length > 1 ? r.filter((x) => x.key !== iv.key) : r))}
                      disabled={intervals.length === 1}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                      title={intervals.length === 1 ? "A plan needs at least one interval" : "Remove interval"}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                  <IntervalFields value={iv} onChange={(patch) => patchInterval(iv.key, patch)} />
                </div>
              ))}
            </div>

            {/* Limited quantity / FOMO */}
            <div className="mt-6 rounded-lg border border-border bg-background/40 p-3 sm:p-4">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={limitedQty}
                  onChange={(e) => setLimitedQty(e.target.checked)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Limited quantity
                </span>
              </label>

              {limitedQty && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>Available quantity</label>
                    <input
                      type="number"
                      min={0}
                      value={availableQty}
                      onChange={(e) => setAvailableQty(e.target.value)}
                      placeholder="5"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex cursor-pointer items-center gap-2.5 pb-2.5">
                      <input
                        type="checkbox"
                        checked={autoRestock}
                        onChange={(e) => setAutoRestock(e.target.checked)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="text-sm text-foreground">Auto restock</span>
                    </label>
                  </div>
                  {autoRestock && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Restock when below</label>
                        <input
                          type="number"
                          min={0}
                          value={restockThreshold}
                          onChange={(e) => setRestockThreshold(e.target.value)}
                          placeholder="2"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Reset available to</label>
                        <input
                          type="number"
                          min={1}
                          value={restockAmount}
                          onChange={(e) => setRestockAmount(e.target.value)}
                          placeholder="3"
                          className={`${inputClass} font-mono`}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex flex-col gap-1.5 sm:col-span-2 xl:col-span-4">
                    <span className="text-xs text-muted-foreground">
                      Each subscribe drops the counter by one
                      {autoRestock
                        ? "; when it falls below the threshold it resets — a perpetual scarcity loop."
                        : "; at zero the plan is sold out."}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Max subscribers */}
            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor="plan-maxsubs" className={labelClass}>
                Max subscribers <span className="normal-case tracking-normal">(blank = unlimited hard cap)</span>
              </label>
              <input
                id="plan-maxsubs"
                type="number"
                min={1}
                value={maxSubs}
                onChange={(e) => setMaxSubs(e.target.value)}
                placeholder="Unlimited"
                className={`${inputClass} font-mono sm:max-w-[220px]`}
              />
            </div>

            {formError && (
              <p className="mt-4 text-sm text-muted-foreground" role="alert">
                {formError}
              </p>
            )}

            {created && (
              <div className="mt-4 flex flex-col gap-1 rounded-lg border border-primary/40 bg-card px-3.5 py-3 text-sm">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  Plan created — {created.slug}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Product {created.stripeProductId} · Default price {created.stripePriceId}
                </span>
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )}
                {createMutation.isPending ? "Creating…" : "Create plan"}
              </button>
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Provisions Stripe on submit
              </span>
            </div>
          </form>

          {/* ── Plans table ────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3.5 sm:px-6">
              <h2 className="text-lg font-semibold tracking-tight">Plans</h2>
              {listQuery.isFetching && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Refreshing
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-y border-border">
                    {["Name", "Intervals", "Quantity", "Status", "Stripe product", ""].map((h, i) => (
                      <th
                        key={h || `action-${i}`}
                        className={`px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:px-6 ${
                          i === 5 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listQuery.isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center sm:px-6">
                        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Loading plans…
                        </span>
                      </td>
                    </tr>
                  ) : listQuery.isError ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center sm:px-6">
                        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                          <span>Failed to load plans: {listQuery.error.message}</span>
                          <button type="button" onClick={() => listQuery.refetch()} className={chipBtn}>
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : plans.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center text-sm text-muted-foreground sm:px-6">
                        No plans yet — create your first above.
                      </td>
                    </tr>
                  ) : (
                    plans.map((plan) => (
                      <PlanRow
                        key={plan.id}
                        plan={plan}
                        expanded={expandedId === plan.id}
                        onToggleExpand={() => setExpandedId((id) => (id === plan.id ? null : plan.id))}
                        confirmArchive={confirmArchiveId === plan.id}
                        onArchiveClick={() => setConfirmArchiveId(plan.id)}
                        onArchiveCancel={() => setConfirmArchiveId(null)}
                        onArchiveConfirm={() => archiveMutation.mutate({ planId: plan.id })}
                        archivePending={archiveMutation.isPending}
                        onTestCheckout={() =>
                          testCheckoutMutation.mutate({ slug: plan.slug, origin: window.location.origin })
                        }
                        testCheckoutPending={
                          testCheckoutMutation.isPending && testCheckoutMutation.variables?.slug === plan.slug
                        }
                        onAddInterval={(price) => addIntervalMutation.mutate({ planId: plan.id, price })}
                        addIntervalPending={addIntervalMutation.isPending}
                        onRemoveInterval={(priceId) => removeIntervalMutation.mutate({ priceId })}
                        onSaveRestock={(restock) => updateRestockMutation.mutate({ planId: plan.id, restock })}
                        saveRestockPending={updateRestockMutation.isPending}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

// ─── Plan row (summary + expandable management panel) ────────────────────────

interface PlanRowProps {
  plan: StoredPlan;
  expanded: boolean;
  onToggleExpand: () => void;
  confirmArchive: boolean;
  onArchiveClick: () => void;
  onArchiveCancel: () => void;
  onArchiveConfirm: () => void;
  archivePending: boolean;
  onTestCheckout: () => void;
  testCheckoutPending: boolean;
  onAddInterval: (price: PricePayload) => void;
  addIntervalPending: boolean;
  onRemoveInterval: (priceId: number) => void;
  onSaveRestock: (restock: {
    autoRestock: boolean;
    availableQuantity: number | null;
    restockThreshold: number | null;
    restockAmount: number | null;
  }) => void;
  saveRestockPending: boolean;
}

function PlanRow(props: PlanRowProps) {
  const { plan } = props;
  const activePrices = plan.prices.filter((p) => p.active);
  const defaultPrice = defaultActivePrice(plan);
  const soldOut = plan.availableQuantity != null && plan.availableQuantity <= 0;

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<IntervalDraft>(blankInterval());
  const [addError, setAddError] = useState<string | null>(null);

  function submitAdd() {
    setAddError(null);
    const built = buildPricePayload(draft, "Interval");
    if (typeof built === "string") {
      setAddError(built);
      return;
    }
    props.onAddInterval(built);
    setDraft(blankInterval());
    setAdding(false);
  }

  return (
    <>
      <tr className={`transition-colors duration-150 ${plan.active ? "" : "opacity-60"}`}>
        {/* Name + expand */}
        <td className="px-4 py-3.5 align-top sm:px-6">
          <button
            type="button"
            onClick={props.onToggleExpand}
            className="flex items-start gap-1.5 text-left focus-visible:outline-none"
          >
            {props.expanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span>
              <span className="block font-semibold text-foreground">{plan.name}</span>
              <span className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {plan.slug}
              </span>
            </span>
          </button>
        </td>

        {/* Intervals (default + count) */}
        <td className="px-4 py-3.5 align-top sm:px-6">
          {defaultPrice ? (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-foreground">
                {money(defaultPrice.amountCents)}
                <span className="text-muted-foreground">{per(defaultPrice)}</span>
              </span>
              {promoLabel(defaultPrice) && (
                <span className="font-mono text-[11px] text-primary">{promoLabel(defaultPrice)}</span>
              )}
              {activePrices.length > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  +{activePrices.length - 1} more interval{activePrices.length - 1 > 1 ? "s" : ""}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* Quantity */}
        <td className="whitespace-nowrap px-4 py-3.5 align-top font-mono sm:px-6">
          {plan.availableQuantity != null ? (
            <span className={soldOut ? "text-muted-foreground" : "text-foreground"}>
              {soldOut ? "Sold out" : `${plan.availableQuantity} left`}
              {plan.autoRestock && <span className="text-primary"> ↻</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">Unlimited</span>
          )}
        </td>

        {/* Status */}
        <td className="whitespace-nowrap px-4 py-3.5 align-top sm:px-6">
          {plan.active ? (
            <span className="inline-flex items-center gap-1.5 text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              Active
            </span>
          ) : (
            <span className="text-muted-foreground">Archived</span>
          )}
        </td>

        {/* Stripe product */}
        <td className="whitespace-nowrap px-4 py-3.5 align-top sm:px-6">
          {plan.stripeProductId ? (
            <span className="font-mono text-xs text-muted-foreground" title={plan.stripeProductId}>
              {truncateId(plan.stripeProductId)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* Actions */}
        <td className="whitespace-nowrap px-4 py-3.5 text-right align-top sm:px-6">
          {!plan.active ? (
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">—</span>
          ) : props.confirmArchive ? (
            <div className="inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Archive?</span>
              <button type="button" onClick={props.onArchiveCancel} className={chipBtn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={props.onArchiveConfirm}
                disabled={props.archivePending}
                style={{ backgroundColor: "var(--dime-danger, #E5484D)" }}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {props.archivePending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                Archive
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2">
              {!plan.livemode && (
                <button
                  type="button"
                  onClick={props.onTestCheckout}
                  disabled={props.testCheckoutPending}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  title="Open a Stripe test-mode checkout for this sandbox plan."
                >
                  {props.testCheckoutPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <FlaskConical className="h-3 w-3" aria-hidden="true" />
                  )}
                  Test checkout
                </button>
              )}
              <button type="button" onClick={props.onArchiveClick} className={chipBtn}>
                Archive
              </button>
            </div>
          )}
        </td>
      </tr>

      {/* Expanded management panel */}
      {props.expanded && plan.active && (
        <tr>
          <td colSpan={6} className="bg-background/40 px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-5">
              {/* Intervals list */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Intervals
                  </span>
                  <button type="button" onClick={() => setAdding((a) => !a)} className={chipBtn}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add interval
                  </button>
                </div>
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {activePrices.map((price) => (
                    <div key={price.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-foreground">
                          {money(price.amountCents)}
                          <span className="text-muted-foreground">{per(price)}</span>
                        </span>
                        {price.isDefault && (
                          <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            Default
                          </span>
                        )}
                        {price.trialPeriodDays != null && price.trialPeriodDays > 0 && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {price.trialPeriodDays}d trial
                          </span>
                        )}
                        {promoLabel(price) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary px-1.5 py-0.5 font-mono text-[10px] text-primary">
                            <Tag className="h-3 w-3" aria-hidden="true" />
                            {promoLabel(price)}
                            {price.promoCode ? ` · ${price.promoCode}` : ""}
                            {discountedCents(price) != null ? ` → ${money(discountedCents(price)!)}` : ""}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => props.onRemoveInterval(price.id)}
                        disabled={activePrices.length === 1}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                        title={activePrices.length === 1 ? "Archive the plan to remove its last interval" : "Remove interval"}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                {adding && (
                  <div className="mt-3 rounded-lg border border-border bg-card p-3 sm:p-4">
                    <IntervalFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
                    {addError && (
                      <p className="mt-3 text-sm text-muted-foreground" role="alert">
                        {addError}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={submitAdd}
                        disabled={props.addIntervalPending}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                      >
                        {props.addIntervalPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                        Add
                      </button>
                      <button type="button" onClick={() => setAdding(false)} className={chipBtn}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Restock editor */}
              <RestockEditor plan={plan} onSave={props.onSaveRestock} pending={props.saveRestockPending} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Restock / limited-quantity editor for an existing plan ──────────────────

function RestockEditor({
  plan,
  onSave,
  pending,
}: {
  plan: StoredPlan;
  onSave: (restock: {
    autoRestock: boolean;
    availableQuantity: number | null;
    restockThreshold: number | null;
    restockAmount: number | null;
  }) => void;
  pending: boolean;
}) {
  const [limited, setLimited] = useState(plan.availableQuantity != null);
  const [available, setAvailable] = useState(plan.availableQuantity != null ? String(plan.availableQuantity) : "");
  const [auto, setAuto] = useState(plan.autoRestock);
  const [threshold, setThreshold] = useState(plan.restockThreshold != null ? String(plan.restockThreshold) : "");
  const [amount, setAmount] = useState(plan.restockAmount != null ? String(plan.restockAmount) : "");
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    if (!limited) {
      onSave({ autoRestock: false, availableQuantity: null, restockThreshold: null, restockAmount: null });
      return;
    }
    const avail = parseInt(available, 10);
    if (Number.isNaN(avail) || avail < 0) {
      setErr("Available quantity must be 0 or more.");
      return;
    }
    if (auto) {
      const thr = parseInt(threshold, 10);
      const amt = parseInt(amount, 10);
      if (Number.isNaN(thr) || thr < 0) {
        setErr("Restock threshold must be 0 or more.");
        return;
      }
      if (Number.isNaN(amt) || amt < 1) {
        setErr("Restock amount must be 1 or more.");
        return;
      }
      onSave({ autoRestock: true, availableQuantity: avail, restockThreshold: thr, restockAmount: amt });
    } else {
      onSave({ autoRestock: false, availableQuantity: avail, restockThreshold: null, restockAmount: null });
    }
  }

  return (
    <div>
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Limited quantity
      </div>
      <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={limited}
            onChange={(e) => setLimited(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Enable limited quantity
          </span>
        </label>

        {limited && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Available now</label>
              <input
                type="number"
                min={0}
                value={available}
                onChange={(e) => setAvailable(e.target.value)}
                placeholder="5"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2.5 pb-2.5">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span className="text-sm text-foreground">Auto restock</span>
              </label>
            </div>
            {auto && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Restock when below</label>
                  <input
                    type="number"
                    min={0}
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    placeholder="2"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Reset available to</label>
                  <input
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="3"
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {err && (
          <p className="mt-3 text-sm text-muted-foreground" role="alert">
            {err}
          </p>
        )}

        <div className="mt-4">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            Save quantity settings
          </button>
        </div>
      </div>
    </div>
  );
}
