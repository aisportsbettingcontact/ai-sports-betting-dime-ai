/**
 * SubscriptionPlans — owner-only admin surface for the DB-backed plan catalog.
 *
 * Route /admin/plans. The UI on top of the `subscriptionPlans` tRPC router
 * (server/routers/subscriptionPlans.ts): list the catalog, create a plan (which
 * provisions a real Stripe Product + recurring Price), archive a plan, and
 * one-shot import the legacy static plans.
 *
 * Auth: CLIENT (cosmetic) half of the owner lockdown — the real boundary is the
 * server-verified ownerProcedure on EVERY subscriptionPlans procedure. The guard
 * below mirrors UserActivity.tsx verbatim in structure; owner-only queries are
 * additionally `enabled`-gated so they never fire for a non-owner.
 *
 * Design: Dime brand law (design-system/dime-ai/MASTER.md) — semantic tokens
 * only, Familjen Grotesk for values/headings, IBM Plex Mono for micro-labels +
 * money + Stripe IDs, rounded-xl cards, 160ms motion, visible focus rings, mint
 * as the sole signal. The ONE destructive-red carve-out (--dime-danger) appears
 * only on the Archive confirm button, per MASTER.md's documented exception.
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation } from "wouter";
import { RefreshCw, CreditCard, Loader2, Plus, Check, DownloadCloud, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import { AdminShell } from "@/pages/admin/AdminShell";
import { IntervalPicker } from "@/pages/admin/IntervalPicker";
import { DEFAULT_INTERVAL } from "@/pages/admin/planTypes";
import type { StoredPlan, StoredPrice, IntervalValue } from "@/pages/admin/planTypes";

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** The default (or first active) price on a plan — the one checkout charges. */
function defaultActivePrice(plan: StoredPlan): StoredPrice | null {
  return (
    plan.prices.find((p) => p.active && p.isDefault) ??
    plan.prices.find((p) => p.active) ??
    plan.prices[0] ??
    null
  );
}

/** `$99.00 / month` or `$25.00 / 3 month`; bare `$X.XX` when there is no interval. */
function formatPrice(price: StoredPrice): string {
  const amount = `$${(price.amountCents / 100).toFixed(2)}`;
  if (!price.interval) return amount;
  const count = price.intervalCount && price.intervalCount > 1 ? `${price.intervalCount} ` : "";
  return `${amount} / ${count}${price.interval}`;
}

/** Truncate a long Stripe id for the table, keeping the readable prefix. */
function truncateId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 19)}…` : id;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SubscriptionPlans() {
  const { appUser, loading } = useAppAuth();
  const [, navigate] = useLocation();

  // Redirect if not owner — MUST be in useEffect, never in render body (a
  // render-phase navigate() crashes React 19 to a blank screen). Defense-in-depth
  // behind the route-level RequireOwner wrapper.
  useEffect(() => {
    if (!loading && (!appUser || appUser.role !== "owner")) {
      console.warn(
        `[SubscriptionPlans] Unauthorized: user=${appUser?.username ?? "unauthenticated"} role=${appUser?.role ?? "none"} → redirecting to /feed/model/mlb`,
      );
      navigate("/feed/model/mlb");
    }
  }, [loading, appUser, navigate]);

  const isOwner = !loading && !!appUser && appUser.role === "owner";

  // ── Create-form state ──────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [intervalValue, setIntervalValue] = useState<IntervalValue>(DEFAULT_INTERVAL);
  const [trialDays, setTrialDays] = useState("");
  const [maxSubs, setMaxSubs] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    planId: number;
    slug: string;
    stripeProductId: string;
    stripePriceId: string;
  } | null>(null);

  // ── Per-row archive confirmation (inline, not window.confirm) ───────────────
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null);

  // ── Data (owner-gated so nothing fires for a non-owner) ─────────────────────
  const testModeQuery = trpc.subscriptionPlans.testMode.useQuery(undefined, {
    enabled: isOwner,
    staleTime: 60_000,
  });
  const listQuery = trpc.subscriptionPlans.list.useQuery(undefined, {
    enabled: isOwner,
    staleTime: 15_000,
  });

  const utils = trpc.useUtils();

  function resetForm() {
    setName("");
    setDescription("");
    setPriceInput("");
    setIntervalValue(DEFAULT_INTERVAL);
    setTrialDays("");
    setMaxSubs("");
    setFormError(null);
  }

  const createMutation = trpc.subscriptionPlans.create.useMutation({
    onSuccess: (result) => {
      console.log(
        `[SubscriptionPlans] create ✓ slug=${result.slug} product=${result.stripeProductId} price=${result.stripePriceId}`,
      );
      setCreated(result);
      resetForm();
      utils.subscriptionPlans.list.invalidate();
      toast.success("Plan created", { description: `${result.slug} · ${result.stripeProductId}` });
    },
    onError: (err) => {
      console.error(`[SubscriptionPlans] create failed: ${err.message}`);
      setFormError(err.message);
    },
  });

  const archiveMutation = trpc.subscriptionPlans.archive.useMutation({
    onSuccess: (_, vars) => {
      console.log(`[SubscriptionPlans] archive ✓ planId=${vars.planId}`);
      setConfirmArchiveId(null);
      utils.subscriptionPlans.list.invalidate();
      toast.success("Plan archived");
    },
    onError: (err) => {
      console.error(`[SubscriptionPlans] archive failed: ${err.message}`);
      toast.error("Archive failed", { description: err.message });
    },
  });

  const backfillMutation = trpc.subscriptionPlans.backfill.useMutation({
    onSuccess: (result) => {
      console.log(
        `[SubscriptionPlans] backfill ✓ inserted=${result.inserted} skipped=${result.skipped}`,
      );
      utils.subscriptionPlans.list.invalidate();
      toast.success("Legacy plans imported", {
        description: `${result.inserted} inserted · ${result.skipped} skipped`,
      });
    },
    onError: (err) => {
      console.error(`[SubscriptionPlans] backfill failed: ${err.message}`);
      toast.error("Import failed", { description: err.message });
    },
  });

  // Owner-only TEST checkout (Phase 2.5): opens a Stripe test-mode Checkout
  // Session for a sandbox plan in a new tab so the owner can run the full
  // subscribe flow with a test card before publishing live plans.
  const testCheckoutMutation = trpc.subscriptionPlans.createTestCheckoutSession.useMutation({
    onSuccess: ({ url }) => {
      console.log(`[SubscriptionPlans] test checkout ✓ opening ${url}`);
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Test checkout opened", {
        description: "Finish it with a Stripe test card in the new tab.",
      });
    },
    onError: (err) => {
      console.error(`[SubscriptionPlans] test checkout failed: ${err.message}`);
      toast.error("Test checkout failed", { description: err.message });
    },
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

    const amountCents = Math.round(parseFloat(priceInput) * 100);
    if (Number.isNaN(amountCents) || amountCents < 50) {
      setFormError("Enter a price of at least $0.50.");
      return;
    }

    let trialPeriodDays: number | undefined;
    if (trialDays.trim()) {
      const t = parseInt(trialDays, 10);
      if (Number.isNaN(t) || t < 0) {
        setFormError("Free trial days must be 0 or more.");
        return;
      }
      trialPeriodDays = t;
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

    createMutation.mutate({
      name: trimmedName,
      description: description.trim() || undefined,
      price: {
        amountCents,
        interval: intervalValue.interval,
        intervalCount: intervalValue.intervalCount,
        ...(trialPeriodDays !== undefined ? { trialPeriodDays } : {}),
      },
      maxSubscribers,
    });
  }

  // Keep owner-only queries from firing until the caller is confirmed owner.
  if (loading || (!loading && (!appUser || appUser.role !== "owner"))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center gap-3">
        <RefreshCw className="w-5 h-5 text-foreground animate-spin" />
        <span className="text-sm text-foreground">
          {loading ? "Authenticating..." : "Redirecting..."}
        </span>
      </div>
    );
  }

  const testMode = testModeQuery.data?.testMode === true;
  const plans: StoredPlan[] = listQuery.data ?? [];

  // Shared input classes — semantic tokens, visible focus, 160ms motion.
  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors duration-150 focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40";
  const labelClass =
    "font-mono text-[11px] uppercase tracking-wider text-muted-foreground";

  return (
    <AdminShell active="plans">
      <div className="w-full bg-muted/30 text-foreground">
        <div className="admin-container py-6 sm:py-8">
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1
                  className="text-3xl font-bold tracking-tight sm:text-4xl"
                  style={{ letterSpacing: "-0.02em" }}
                >
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
                Create and manage subscription plans. Creating a plan provisions a real Stripe
                product and recurring price, then persists it to the catalog checkout reads from.
              </p>
            </div>

            {/* One-time legacy import */}
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
          <form
            onSubmit={handleCreate}
            className="mb-8 rounded-xl border border-border bg-card px-4 py-4 sm:px-6 sm:py-5"
          >
            <div className="mb-4 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-lg font-semibold tracking-tight">Create a plan</h2>
            </div>

            {/* Fields tile across the fluid container: 1 col on phones, 2 at
                sm, 4 at xl so the row fills wide screens instead of stretching
                two fields to absurd widths. Ordered so each breakpoint's rows
                stay full (name/price/interval/trial, then full-width blocks). */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-name" className={labelClass}>
                  Name
                </label>
                <input
                  id="plan-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pro Monthly"
                  className={inputClass}
                />
              </div>

              {/* Price */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-price" className={labelClass}>
                  Price (USD)
                </label>
                <input
                  id="plan-price"
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  placeholder="99.00"
                  className={`${inputClass} font-mono`}
                />
              </div>

              {/* Interval */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-interval" className={labelClass}>
                  Billing interval
                </label>
                <IntervalPicker
                  id="plan-interval"
                  value={intervalValue}
                  onChange={setIntervalValue}
                />
              </div>

              {/* Trial days */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-trial" className={labelClass}>
                  Free trial days <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="plan-trial"
                  type="number"
                  min={0}
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  placeholder="0"
                  className={`${inputClass} font-mono`}
                />
              </div>

              {/* Description — full width */}
              <div className="flex flex-col gap-1.5 sm:col-span-2 xl:col-span-4">
                <label htmlFor="plan-description" className={labelClass}>
                  Description <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  id="plan-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="What subscribers get with this plan."
                  className={`${inputClass} resize-y`}
                />
              </div>

              {/* Max subscribers — full width on its own row */}
              <div className="flex flex-col gap-1.5 sm:col-span-2 xl:col-span-4">
                <label htmlFor="plan-maxsubs" className={labelClass}>
                  Max subscribers{" "}
                  <span className="normal-case tracking-normal">(blank = unlimited)</span>
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
            </div>

            {/* Inline validation / mutation error (grey, per brand law) */}
            {formError && (
              <p className="mt-4 text-sm text-muted-foreground" role="alert">
                {formError}
              </p>
            )}

            {/* Success line with the provisioned Stripe ids */}
            {created && (
              <div className="mt-4 flex flex-col gap-1 rounded-lg border border-primary/40 bg-card px-3.5 py-3 text-sm">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  Plan created — {created.slug}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Product {created.stripeProductId} · Price {created.stripePriceId}
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
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-y border-border">
                    {["Name", "Price", "Trial", "Max subs", "Status", "Stripe product", ""].map(
                      (h, i) => (
                        <th
                          key={h || `action-${i}`}
                          className={`px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:px-6 ${
                            i === 6 ? "text-right" : "text-left"
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {listQuery.isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center sm:px-6">
                        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Loading plans…
                        </span>
                      </td>
                    </tr>
                  ) : listQuery.isError ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center sm:px-6">
                        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                          <span>Failed to load plans: {listQuery.error.message}</span>
                          <button
                            type="button"
                            onClick={() => listQuery.refetch()}
                            className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : plans.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-14 text-center text-sm text-muted-foreground sm:px-6"
                      >
                        No plans yet — create your first above.
                      </td>
                    </tr>
                  ) : (
                    plans.map((plan) => {
                      const price = defaultActivePrice(plan);
                      const trial = price?.trialPeriodDays ?? null;
                      const isConfirming = confirmArchiveId === plan.id;
                      return (
                        <tr
                          key={plan.id}
                          className={`transition-colors duration-150 ${
                            plan.active ? "" : "opacity-60"
                          }`}
                        >
                          {/* Name */}
                          <td className="px-4 py-3.5 sm:px-6">
                            <div className="font-semibold text-foreground">{plan.name}</div>
                            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                              {plan.slug}
                            </div>
                          </td>

                          {/* Price */}
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono text-foreground sm:px-6">
                            {price ? formatPrice(price) : <span className="text-muted-foreground">—</span>}
                          </td>

                          {/* Trial */}
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono text-foreground sm:px-6">
                            {trial && trial > 0 ? (
                              `${trial}d`
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Max subs */}
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono text-foreground sm:px-6">
                            {plan.maxSubscribers != null ? (
                              plan.maxSubscribers.toLocaleString()
                            ) : (
                              <span className="text-muted-foreground">Unlimited</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="whitespace-nowrap px-4 py-3.5 sm:px-6">
                            {plan.active ? (
                              <span className="inline-flex items-center gap-1.5 text-primary">
                                <span
                                  className="h-1.5 w-1.5 rounded-full bg-primary"
                                  aria-hidden="true"
                                />
                                Active
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Archived</span>
                            )}
                          </td>

                          {/* Stripe product id */}
                          <td className="whitespace-nowrap px-4 py-3.5 sm:px-6">
                            {plan.stripeProductId ? (
                              <span
                                className="font-mono text-xs text-muted-foreground"
                                title={plan.stripeProductId}
                              >
                                {truncateId(plan.stripeProductId)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Row action */}
                          <td className="whitespace-nowrap px-4 py-3.5 text-right sm:px-6">
                            {!plan.active ? (
                              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                                —
                              </span>
                            ) : isConfirming ? (
                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Archive?</span>
                                <button
                                  type="button"
                                  onClick={() => setConfirmArchiveId(null)}
                                  className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => archiveMutation.mutate({ planId: plan.id })}
                                  disabled={archiveMutation.isPending}
                                  style={{ backgroundColor: "var(--dime-danger, #E5484D)" }}
                                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                                >
                                  {archiveMutation.isPending && (
                                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                  )}
                                  Archive
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-2">
                                {/* Sandbox plans get an owner-only TEST checkout. */}
                                {!plan.livemode && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      testCheckoutMutation.mutate({
                                        slug: plan.slug,
                                        origin: window.location.origin,
                                      })
                                    }
                                    disabled={testCheckoutMutation.isPending}
                                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-primary px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                                    title="Open a Stripe test-mode checkout for this sandbox plan."
                                  >
                                    {testCheckoutMutation.isPending &&
                                    testCheckoutMutation.variables?.slug === plan.slug ? (
                                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <FlaskConical className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    Test checkout
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setConfirmArchiveId(plan.id)}
                                  className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                  Archive
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
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
