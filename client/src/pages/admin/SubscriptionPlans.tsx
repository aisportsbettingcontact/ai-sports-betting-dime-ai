/**
 * SubscriptionPlans — owner-only admin surface for the DB-backed plan catalog.
 *
 * Route /admin/plans. Layout mirrors the Winible structure the owner asked for:
 * Active / Archived tabs, plans rendered as cards, and a Create Plan button that
 * opens a modal. A second button opens a "Create Personalized Subscription" modal
 * for one-off (one_time) memberships — the only place a Max Subscribers hard cap
 * is offered.
 *
 * Recurring plans hold any number of billing intervals (variants), each with its
 * own price, cadence, free-trial days, and promo (% or fixed, optional code).
 * Intervals can be drag-reordered (⠿) and hidden/unhidden (eyeball) at any time,
 * on both the create form and existing plan cards.
 *
 * Auth: CLIENT (cosmetic) half of the owner lockdown — the real boundary is the
 * server-verified ownerProcedure on EVERY subscriptionPlans procedure.
 *
 * Design: Dime brand law (design-system/dime-ai/MASTER.md) — semantic tokens,
 * Familjen Grotesk for values, IBM Plex Mono for micro-labels + money + Stripe
 * IDs, rounded-xl cards, 160ms motion, visible focus rings, mint as the sole
 * signal, destructive-red only on remove/archive. Fills the screen via the shared
 * fluid `.admin-container`.
 */
import { useEffect, useMemo, useState } from "react";
import type { DragEvent, FormEvent, ReactNode } from "react";
import { useLocation } from "wouter";
import {
  RefreshCw,
  CreditCard,
  Loader2,
  Plus,
  Check,
  FlaskConical,
  X,
  Tag,
  Package,
  GripVertical,
  Eye,
  EyeOff,
  Users,
  Sparkles,
  Archive,
  ArchiveRestore,
  Paperclip,
  Copy,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import { AdminShell } from "@/pages/admin/AdminShell";
import { IntervalPicker } from "@/pages/admin/IntervalPicker";
import { DEFAULT_INTERVAL } from "@/pages/admin/planTypes";
import type { StoredPlan, StoredPrice, IntervalValue, PromoType, BillingInterval } from "@/pages/admin/planTypes";

type PlanWithCount = StoredPlan & { subscriberCount: number };

// ─── Draft model ─────────────────────────────────────────────────────────────

interface IntervalDraft {
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

function blankInterval(): IntervalDraft {
  return {
    key: Math.random().toString(36).slice(2),
    price: "",
    interval: DEFAULT_INTERVAL,
    trialDays: "",
    hidden: false,
    promoOn: false,
    promoType: "percent",
    promoValue: "",
    promoCode: "",
  };
}

interface PricePayload {
  amountCents: number;
  /** Absent → a one-time (single-payment) price, i.e. the "Lifetime" cadence. */
  interval?: BillingInterval;
  intervalCount?: number;
  trialPeriodDays?: number;
  promo?: { type: PromoType; value: number; code?: string };
  hidden?: boolean;
}

/** Validate + convert one interval draft to a mutation payload, or an error string. */
function buildPricePayload(iv: IntervalDraft, label: string, recurring: boolean): PricePayload | string {
  const amountCents = Math.round(parseFloat(iv.price) * 100);
  if (Number.isNaN(amountCents) || amountCents < 50) return `${label}: enter a price of at least $0.50.`;

  const payload: PricePayload = { amountCents };

  // "Lifetime" is a one-time interval — even inside a recurring plan it carries no
  // cadence and no trial; omitting `interval` makes the server mint a one-time
  // Stripe price (mode:"payment" at checkout).
  if (recurring && iv.interval.interval !== "lifetime") {
    payload.interval = iv.interval.interval;
    payload.intervalCount = iv.interval.intervalCount;
    if (iv.trialDays.trim()) {
      const t = parseInt(iv.trialDays, 10);
      if (Number.isNaN(t) || t < 0) return `${label}: free trial days must be 0 or more.`;
      payload.trialPeriodDays = t;
    }
  }

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
    payload.promo = { type: iv.promoType, value, ...(code ? { code } : {}) };
  }

  if (iv.hidden) payload.hidden = true;
  return payload;
}

/** Move an array element from `from` to `to` (immutable). */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function per(price: StoredPrice): string {
  if (!price.interval) return " one-time";
  const count = price.intervalCount && price.intervalCount > 1 ? `${price.intervalCount} ` : "";
  return ` / ${count}${price.interval}`;
}

function discountedCents(price: StoredPrice): number | null {
  if (!price.promoType || price.promoValue == null) return null;
  if (price.promoType === "percent") return Math.max(0, Math.round(price.amountCents * (1 - price.promoValue / 100)));
  return Math.max(0, price.amountCents - price.promoValue);
}

function promoLabel(price: StoredPrice): string | null {
  if (!price.promoType || price.promoValue == null) return null;
  return price.promoType === "percent" ? `${price.promoValue}% off` : `${money(price.promoValue)} off`;
}

// ─── Shared styling ──────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors duration-150 focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";
const labelClass = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";
const chipBtn =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const primaryBtn =
  "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50";

// ─── Modal ───────────────────────────────────────────────────────────────────

function Modal({ title, icon, onClose, children }: { title: string; icon: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="my-4 w-full max-w-3xl rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-border bg-card px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            {icon}
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Interval fields (price / cadence / trial / promo) ───────────────────────

function IntervalFields({
  value,
  onChange,
  oneTime = false,
}: {
  value: IntervalDraft;
  onChange: (patch: Partial<IntervalDraft>) => void;
  oneTime?: boolean;
}) {
  // A "Lifetime" cadence is a single payment — no free-trial field applies.
  const lifetime = value.interval.interval === "lifetime";
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {!oneTime && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Billing interval</label>
            <IntervalPicker value={value.interval} onChange={(interval) => onChange({ interval })} />
          </div>
          {!lifetime && (
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
          )}
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Promo</label>
        <button
          type="button"
          onClick={() => onChange({ promoOn: !value.promoOn })}
          aria-pressed={value.promoOn}
          className={`inline-flex h-[42px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            value.promoOn ? "border-primary text-primary" : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <Tag className="h-4 w-4" aria-hidden="true" />
          {value.promoOn ? "Promo on" : "Add promo"}
        </button>
      </div>

      {value.promoOn && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:col-span-4">
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
                    value.promoType === t ? "bg-[var(--row-active)] text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "percent" ? "% off" : "$ off"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>{value.promoType === "percent" ? "Percent (1–100)" : "Amount off (USD)"}</label>
            <input
              type="text"
              inputMode="decimal"
              value={value.promoValue}
              onChange={(e) => onChange({ promoValue: e.target.value })}
              placeholder={value.promoType === "percent" ? "50" : "25.00"}
              className={`${inputClass} font-mono`}
            />
          </div>
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

// ─── Create Plan modal (recurring, multi-interval) ───────────────────────────

function CreatePlanModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [intervals, setIntervals] = useState<IntervalDraft[]>([blankInterval()]);
  const [limitedQty, setLimitedQty] = useState(false);
  const [availableQty, setAvailableQty] = useState("");
  const [autoRestock, setAutoRestock] = useState(false);
  const [restockThreshold, setRestockThreshold] = useState("");
  const [restockAmount, setRestockAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const create = trpc.subscriptionPlans.create.useMutation({
    onSuccess: (r) => {
      utils.subscriptionPlans.list.invalidate();
      toast.success("Plan created", { description: `${r.slug} · ${r.stripeProductId}` });
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  function patch(key: string, p: Partial<IntervalDraft>) {
    setIntervals((rows) => rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const prices: PricePayload[] = [];
    for (let i = 0; i < intervals.length; i++) {
      const built = buildPricePayload(intervals[i], `Interval ${i + 1}`, true);
      if (typeof built === "string") {
        setError(built);
        return;
      }
      prices.push(built);
    }
    let restock:
      | { autoRestock: boolean; availableQuantity: number | null; restockThreshold: number | null; restockAmount: number | null }
      | null = null;
    if (limitedQty) {
      const avail = parseInt(availableQty, 10);
      if (Number.isNaN(avail) || avail < 0) {
        setError("Available quantity must be 0 or more.");
        return;
      }
      if (autoRestock) {
        const thr = parseInt(restockThreshold, 10);
        const amt = parseInt(restockAmount, 10);
        if (Number.isNaN(thr) || thr < 0) {
          setError("Restock threshold must be 0 or more.");
          return;
        }
        if (Number.isNaN(amt) || amt < 1) {
          setError("Restock amount must be 1 or more.");
          return;
        }
        restock = { autoRestock: true, availableQuantity: avail, restockThreshold: thr, restockAmount: amt };
      } else {
        restock = { autoRestock: false, availableQuantity: avail, restockThreshold: null, restockAmount: null };
      }
    }
    create.mutate({ name: name.trim(), description: description.trim() || undefined, planType: "recurring", prices, restock });
  }

  return (
    <Modal title="Create a plan" icon={<CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden="true" />} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dime Pro" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>
              Description <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What subscribers get." className={inputClass} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className={labelClass}>Billing intervals</span>
          <button type="button" onClick={() => setIntervals((r) => [...r, blankInterval()])} className={chipBtn}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add interval
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {intervals.map((iv, i) => (
            <div
              key={iv.key}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                if (dragIndex != null && dragIndex !== i) setIntervals((r) => moveItem(r, dragIndex, i));
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={`rounded-lg border border-border bg-background/40 p-3 sm:p-4 ${iv.hidden ? "opacity-60" : ""} ${
                dragIndex === i ? "ring-2 ring-primary" : ""
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground active:cursor-grabbing" aria-hidden="true" />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Interval {i + 1}</span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => patch(iv.key, { hidden: !iv.hidden })}
                    aria-pressed={iv.hidden}
                    title={iv.hidden ? "Hidden from customers — click to show" : "Visible — click to hide"}
                    className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {iv.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIntervals((r) => (r.length > 1 ? r.filter((x) => x.key !== iv.key) : r))}
                    disabled={intervals.length === 1}
                    className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                    title={intervals.length === 1 ? "A plan needs at least one interval" : "Remove interval"}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <IntervalFields value={iv} onChange={(p) => patch(iv.key, p)} />
            </div>
          ))}
        </div>

        {/* Limited quantity / FOMO */}
        <div className="rounded-lg border border-border bg-background/40 p-3 sm:p-4">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={limitedQty} onChange={(e) => setLimitedQty(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Limited quantity
            </span>
          </label>
          {limitedQty && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <label className={labelClass}>Available quantity</label>
                <input type="number" min={0} value={availableQty} onChange={(e) => setAvailableQty(e.target.value)} placeholder="5" className={`${inputClass} font-mono`} />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2.5 pb-2.5">
                  <input type="checkbox" checked={autoRestock} onChange={(e) => setAutoRestock(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                  <span className="text-sm text-foreground">Auto restock</span>
                </label>
              </div>
              {autoRestock && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>Restock when below</label>
                    <input type="number" min={0} value={restockThreshold} onChange={(e) => setRestockThreshold(e.target.value)} placeholder="2" className={`${inputClass} font-mono`} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass}>Reset available to</label>
                    <input type="number" min={1} value={restockAmount} onChange={(e) => setRestockAmount(e.target.value)} placeholder="3" className={`${inputClass} font-mono`} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-muted-foreground" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={create.isPending} className={primaryBtn}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {create.isPending ? "Creating…" : "Create plan"}
          </button>
          <button type="button" onClick={onClose} className={chipBtn}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Create Personalized Subscription modal (one_time) ───────────────────────

function CreatePersonalizedModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState<IntervalDraft>(blankInterval());
  const [maxSubs, setMaxSubs] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.subscriptionPlans.create.useMutation({
    onSuccess: (r) => {
      utils.subscriptionPlans.list.invalidate();
      toast.success("Personalized membership created", { description: `${r.slug} · ${r.stripeProductId}` });
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const built = buildPricePayload(price, "Price", false); // one_time → no cadence/trial
    if (typeof built === "string") {
      setError(built);
      return;
    }
    let maxSubscribers: number | null = null;
    if (maxSubs.trim()) {
      const m = parseInt(maxSubs, 10);
      if (Number.isNaN(m) || m < 1) {
        setError("Max subscribers must be 1 or more (leave blank for unlimited).");
        return;
      }
      maxSubscribers = m;
    }
    create.mutate({ name: name.trim(), description: description.trim() || undefined, planType: "one_time", prices: [built], maxSubscribers });
  }

  return (
    <Modal
      title="Create personalized subscription"
      icon={<Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          A one-time membership — a single payment grants lifetime access. Cap the number of members with Max
          Subscribers (a personalized, limited offer).
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Founding Member" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>
              Description <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this member gets." className={inputClass} />
          </div>
        </div>

        <IntervalFields value={price} onChange={(p) => setPrice((d) => ({ ...d, ...p }))} oneTime />

        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>
            Max subscribers <span className="normal-case tracking-normal">(blank = unlimited hard cap)</span>
          </label>
          <input
            type="number"
            min={1}
            value={maxSubs}
            onChange={(e) => setMaxSubs(e.target.value)}
            placeholder="Unlimited"
            className={`${inputClass} font-mono sm:max-w-[220px]`}
          />
        </div>

        {error && (
          <p className="text-sm text-muted-foreground" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={create.isPending} className={primaryBtn}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {create.isPending ? "Creating…" : "Create membership"}
          </button>
          <button type="button" onClick={onClose} className={chipBtn}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Plan card ───────────────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: PlanWithCount }) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.subscriptionPlans.list.invalidate();
  const activePrices = useMemo(() => plan.prices.filter((p) => p.active), [plan.prices]);
  const soldOut = plan.availableQuantity != null && plan.availableQuantity <= 0;

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<IntervalDraft>(blankInterval());
  const [addError, setAddError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const oneTime = plan.planType === "one_time";

  const archive = trpc.subscriptionPlans.archive.useMutation({ onSuccess: () => { invalidate(); setConfirmArchive(false); toast.success("Plan archived"); }, onError: (e) => toast.error("Archive failed", { description: e.message }) });
  const unarchive = trpc.subscriptionPlans.unarchive.useMutation({ onSuccess: () => { invalidate(); toast.success("Plan restored"); }, onError: (e) => toast.error("Restore failed", { description: e.message }) });
  const duplicate = trpc.subscriptionPlans.duplicate.useMutation({ onSuccess: (r) => { invalidate(); toast.success("Plan duplicated", { description: r.slug }); }, onError: (e) => toast.error("Duplicate failed", { description: e.message }) });
  const del = trpc.subscriptionPlans.delete.useMutation({ onSuccess: () => { invalidate(); setConfirmDelete(false); toast.success("Plan deleted"); }, onError: (e) => toast.error("Delete failed", { description: e.message }) });
  const addInterval = trpc.subscriptionPlans.addInterval.useMutation({ onSuccess: () => { invalidate(); setAdding(false); setDraft(blankInterval()); toast.success("Interval added"); }, onError: (e) => toast.error("Add failed", { description: e.message }) });
  const removeInterval = trpc.subscriptionPlans.removeInterval.useMutation({ onSuccess: invalidate, onError: (e) => toast.error("Remove failed", { description: e.message }) });
  const setHidden = trpc.subscriptionPlans.setIntervalHidden.useMutation({ onSuccess: invalidate, onError: (e) => toast.error("Update failed", { description: e.message }) });
  const reorder = trpc.subscriptionPlans.reorderIntervals.useMutation({ onSuccess: invalidate, onError: (e) => toast.error("Reorder failed", { description: e.message }) });
  const testCheckout = trpc.subscriptionPlans.createTestCheckoutSession.useMutation({
    onSuccess: ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); toast.success("Test checkout opened"); },
    onError: (e) => toast.error("Test checkout failed", { description: e.message }),
  });

  /** Copy a public per-interval checkout link to send to a prospective customer. */
  function copyCheckoutLink(price: StoredPrice) {
    const url = `${window.location.origin}/checkout?plan=${encodeURIComponent(plan.slug)}&price=${price.id}`;
    const done = () => toast.success("Checkout link copied", { description: url });
    const fail = () => toast.error("Could not copy link", { description: url });
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, fail);
    } else {
      fail();
    }
  }

  function submitAdd() {
    setAddError(null);
    const built = buildPricePayload(draft, "Interval", !oneTime);
    if (typeof built === "string") {
      setAddError(built);
      return;
    }
    addInterval.mutate({ planId: plan.id, price: built });
  }

  function dropAt(index: number) {
    if (dragIndex == null || dragIndex === index) {
      setDragIndex(null);
      return;
    }
    const reordered = moveItem(activePrices, dragIndex, index).map((p) => p.id);
    reorder.mutate({ planId: plan.id, orderedPriceIds: reordered });
    setDragIndex(null);
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold uppercase tracking-tight text-foreground">{plan.name}</h3>
          <span className="mt-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {plan.subscriberCount.toLocaleString()} subscriber{plan.subscriberCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {oneTime && (
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              One-time
            </span>
          )}
          {!plan.livemode && (
            <span className="rounded-full border border-primary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
              Sandbox
            </span>
          )}
        </div>
      </div>

      {plan.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>}

      {/* Quantity */}
      {plan.availableQuantity != null && (
        <p className="mt-3 font-mono text-xs">
          <span className={soldOut ? "text-muted-foreground" : "text-primary"}>
            {soldOut ? "Sold out" : `${plan.availableQuantity} spots left`}
          </span>
          {plan.autoRestock && <span className="text-primary"> ↻ auto-restock</span>}
        </p>
      )}

      {/* Pricing options */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className={labelClass}>Pricing options</span>
          {plan.active && (
            <button type="button" onClick={() => setAdding((a) => !a)} className={chipBtn}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {activePrices.map((price, i) => (
            <div
              key={price.id}
              draggable={plan.active && activePrices.length > 1}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={(e: DragEvent) => { e.preventDefault(); dropAt(i); }}
              onDragEnd={() => setDragIndex(null)}
              className={`flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2.5 ${
                price.hidden ? "opacity-50" : ""
              } ${dragIndex === i ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {plan.active && activePrices.length > 1 && (
                  <GripVertical className="h-4 w-4 flex-shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" aria-hidden="true" />
                )}
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {money(price.amountCents)}
                    <span className="font-normal text-muted-foreground">{per(price)}</span>
                  </span>
                  {price.isDefault && (
                    <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Default
                    </span>
                  )}
                  {price.trialPeriodDays != null && price.trialPeriodDays > 0 && (
                    <span className="font-mono text-[11px] text-muted-foreground">{price.trialPeriodDays}d trial</span>
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
              </div>
              {plan.active && (
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => copyCheckoutLink(price)}
                    title="Copy a checkout link for this option to send to a customer"
                    aria-label="Copy checkout link"
                    className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHidden.mutate({ priceId: price.id, hidden: !price.hidden })}
                    title={price.hidden ? "Hidden — click to show" : "Visible — click to hide"}
                    className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {price.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeInterval.mutate({ priceId: price.id })}
                    disabled={activePrices.length === 1}
                    title={activePrices.length === 1 ? "Archive the plan to remove its last interval" : "Remove interval"}
                    className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {adding && (
          <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
            <IntervalFields value={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} oneTime={oneTime} />
            {addError && (
              <p className="mt-3 text-sm text-muted-foreground" role="alert">
                {addError}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={submitAdd}
                disabled={addInterval.isPending}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {addInterval.isPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                Add
              </button>
              <button type="button" onClick={() => setAdding(false)} className={chipBtn}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {!plan.livemode && plan.active && (
          <button
            type="button"
            onClick={() => testCheckout.mutate({ slug: plan.slug, origin: window.location.origin })}
            disabled={testCheckout.isPending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-primary px-2.5 py-1.5 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            {testCheckout.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />}
            Test checkout
          </button>
        )}

        {plan.active ? (
          confirmArchive ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Archive?</span>
              <button type="button" onClick={() => setConfirmArchive(false)} className={chipBtn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => archive.mutate({ planId: plan.id })}
                disabled={archive.isPending}
                style={{ backgroundColor: "var(--dime-danger, #E5484D)" }}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {archive.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Archive
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmArchive(true)} className={chipBtn}>
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              Archive
            </button>
          )
        ) : (
          <button type="button" onClick={() => unarchive.mutate({ planId: plan.id })} disabled={unarchive.isPending} className={chipBtn}>
            {unarchive.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />}
            Unarchive
          </button>
        )}

        {/* Duplicate — provisions an independent copy (new plan/price IDs). */}
        <button type="button" onClick={() => duplicate.mutate({ planId: plan.id })} disabled={duplicate.isPending} className={chipBtn}>
          {duplicate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          Duplicate
        </button>

        {/* Delete — permanently removes the plan (confirm first). */}
        {confirmDelete ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Delete permanently?</span>
            <button type="button" onClick={() => setConfirmDelete(false)} className={chipBtn}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => del.mutate({ planId: plan.id })}
              disabled={del.isPending}
              style={{ backgroundColor: "var(--dime-danger, #E5484D)" }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {del.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Delete
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} title="Permanently delete this plan" className={chipBtn}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SubscriptionPlans() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && (!appUser || appUser.role !== "owner")) {
      navigate("/feed/model/mlb");
    }
  }, [loading, appUser, navigate]);

  const isOwner = !loading && !!appUser && appUser.role === "owner";

  const [tab, setTab] = useState<"active" | "archived">("active");
  const [modal, setModal] = useState<null | "plan" | "personalized">(null);

  const testModeQuery = trpc.subscriptionPlans.testMode.useQuery(undefined, { enabled: isOwner, staleTime: 60_000 });
  const listQuery = trpc.subscriptionPlans.list.useQuery(undefined, { enabled: isOwner, staleTime: 15_000 });

  if (loading || (!loading && (!appUser || appUser.role !== "owner"))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3">
        <RefreshCw className="w-5 h-5 text-foreground animate-spin" />
        <span className="text-sm text-foreground">{loading ? "Authenticating..." : "Redirecting..."}</span>
      </div>
    );
  }

  const testMode = testModeQuery.data?.testMode === true;
  const plans: PlanWithCount[] = (listQuery.data ?? []) as PlanWithCount[];
  const shown = plans.filter((p) => (tab === "active" ? p.active : !p.active));

  return (
    <AdminShell active="plans">
      <div className="w-full bg-muted/30 text-foreground">
        <div className="admin-container py-6 sm:py-8">
          {/* Header */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
                Create and manage subscription plans and one-time memberships.
              </p>
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setModal("personalized")}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                Create Personalized Subscription
              </button>
              <button type="button" onClick={() => setModal("plan")} className={primaryBtn}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create Plan
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex items-center gap-1 border-b border-border">
            {(["active", "archived"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-current={tab === t ? "page" : undefined}
                className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none ${
                  tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "active" ? "Active Plans" : "Archived plans"}
              </button>
            ))}
            {listQuery.isFetching && <RefreshCw className="ml-2 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
          </div>

          {/* Cards */}
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading plans…
            </div>
          ) : listQuery.isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
              <span>Failed to load plans: {listQuery.error.message}</span>
              <button type="button" onClick={() => listQuery.refetch()} className={chipBtn}>
                Retry
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {tab === "active" ? "No active plans yet — create your first above." : "No archived plans."}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {shown.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          )}
        </div>
      </div>

      {modal === "plan" && <CreatePlanModal onClose={() => setModal(null)} />}
      {modal === "personalized" && <CreatePersonalizedModal onClose={() => setModal(null)} />}
    </AdminShell>
  );
}
