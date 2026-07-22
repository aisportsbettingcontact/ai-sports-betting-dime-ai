/**
 * Dime AI — Settings modal Billing pane (Round 3 Step 4, owner directive 2026-07-22).
 * ---------------------------------------------------------------------------
 * Replaces the Step 2 TODO(step-4) stub (`SettingsModal.tsx`'s old inline
 * `BillingSection`) with the real pane: a state-driven plan card, billing
 * history, payment methods, billing information, and the Upgrade / Renew /
 * Cancel actions — wired to Step 3's four read-only `stripe.*` procedures
 * (`getPlanStatus` / `getInvoices` / `getPaymentMethods` / `getBillingInfo`,
 * server/routers/stripe.ts) plus the pre-existing checkout/portal/cancel/
 * reactivate mutations `ManageAccount.tsx` already established the contract
 * for. Extracted to its own file per the task's >250-line-of-JSX allowance —
 * SettingsModal.tsx now only imports and mounts it.
 *
 * Query gating ("modal-open + billing-section-active, no fetches for other
 * sections"): SettingsModal.tsx's section switcher (`.dc-sm-content`'s
 * `section === "account" ? <AccountSection/> : <BillingSection/>`) already
 * fully unmounts this component whenever the Billing tab isn't active, and
 * the whole dialog (this component included) never mounts while `open` is
 * false (SettingsModal's `if (!open || !appUser) return null;` sits before
 * any of this ever renders). That mount lifecycle is the actual gate —
 * react-query never issues a request for an unmounted component. The one
 * additional signal that lifecycle can't express on its own is "this account
 * has no billing to fetch" (owner accounts): the four data queries live
 * inside PlanCard/BillingHistoryTable/PaymentMethodsList/BillingInfoCard
 * below, and this component early-returns the owner stub BEFORE any of those
 * four ever mount — so an owner's session never even calls the hooks that
 * would fetch, let alone fetches. (The mutations further down — portal/
 * cancel/reactivate — stay hook-order-safe either way since `.useMutation()`
 * itself never fetches; only `.mutate()` does, and that's user-triggered.)
 *
 * Apple discipline (.claude/skills/apple-design/SKILL.md):
 *  - No layout jumps between loading/loaded/error/empty: every card reserves
 *    space for its content (`.dc-sm-plan-card` etc. carry a min-height) so a
 *    query resolving doesn't shrink-wrap or jump the dialog around it —
 *    the same discipline Step 2's `.dc-sm-content` min-height already
 *    established for the section-switch case.
 *  - The cancel-confirm panel enters on MASTER.md's one 160ms curve
 *    (`dcBillingPanelIn`), collapses under `prefers-reduced-motion`, and
 *    (matching the dialog's own established precedent, r3-task-2-report.md:
 *    "No exit animation... Motion dial 2/10 'Subtle' doesn't need a
 *    symmetric close beat") has no exit animation — Keep Plan simply
 *    unmounts it.
 *  - Feedback kinds (§16): every mutation's pending state is a plain label
 *    change ("Cancelling…"), not a spinner — matching AccountSection's own
 *    "Sending…"/"Reset email sent" convention in this exact modal.
 *
 * Dime brand skin (design-system/dime-ai/MASTER.md): mint stays reserved for
 * signal (the Upgrade pill mirrors the frozen `.dc-btn-upgrade`/`.dc-link`
 * mint treatment already established for CTAs and links in this app); the
 * cancel-confirm's destructive button is the ONE owner-directed exception to
 * "no red" (see the `--dime-danger` token + comment in conversation.css) and
 * is not reused anywhere else — errors/empty states stay grey per MASTER.md's
 * "negative/no-edge states are grey, never red" rule.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";

export interface BillingSectionProps {
  isOwner: boolean;
}

// ── Local, dependency-free formatting helpers ───────────────────────────────
// Long form mirrors sidebarIdentity.ts's formatExpiryLine (this exact modal's
// Account section already uses that convention); short form mirrors
// ManageAccount.tsx's formatExpiry — both existing app conventions, not a new
// third format invented for this pane.

function formatLongDate(ms: number | null): string | null {
  if (ms == null) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatShortDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(2)}`;
}

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function capitalize(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

// Owner's verbatim cancel-confirm copy (round3-constraints.md / task-4-brief.md).
// Hoisted to a single-line constant rather than inline JSX text so the raw
// source always contains it contiguously — no risk of JSX line-wrapping
// splitting the sentence across lines, which would still render identically
// (JSX collapses inter-line whitespace) but would break the source-contract
// test that pins this copy verbatim.
const CANCEL_CONFIRM_COPY =
  "If you cancel, you'll keep full access to your plan features until the end of your billing period.";

export default function BillingSection({ isOwner }: BillingSectionProps) {
  const [, navigate] = useLocation();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const utils = trpc.useUtils();

  const invalidatePlan = () => {
    utils.stripe.getPlanStatus.invalidate();
    utils.stripe.getSubscription.invalidate();
  };

  const portalMutation = trpc.stripe.createPortalSession.useMutation({
    onSuccess: data => {
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
    onError: err => {
      toast.error(err.message || "Couldn't open the billing portal.");
    },
  });

  const cancelMutation = trpc.stripe.cancelSubscription.useMutation({
    onSuccess: () => {
      setCancelConfirmOpen(false);
      invalidatePlan();
      toast.success("Your plan is cancelled. You'll keep access until the period ends.");
    },
    onError: err => {
      toast.error(err.message || "Couldn't cancel your plan.");
    },
  });

  const reactivateMutation = trpc.stripe.reactivateSubscription.useMutation({
    onSuccess: () => {
      invalidatePlan();
      toast.success("Your plan will renew automatically.");
    },
    onError: err => {
      toast.error(err.message || "Couldn't renew your plan.");
    },
  });

  if (isOwner) {
    return (
      <section className="dc-sm-section" aria-label="Billing">
        <div className="dc-sm-section-label">Billing</div>
        <div className="dc-sm-card dc-sm-billing-stub">
          <p className="dc-sm-billing-stub-text">Owner accounts have no billing plan.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="dc-sm-section" aria-label="Billing">
      <div className="dc-sm-section-label">Plan</div>
      <PlanCard
        onUpgrade={() => navigate("/checkout")}
        onRenew={() => reactivateMutation.mutate()}
        renewPending={reactivateMutation.isPending}
        onOpenCancelConfirm={() => setCancelConfirmOpen(true)}
      />

      {cancelConfirmOpen && (
        <CancelConfirm
          pending={cancelMutation.isPending}
          onConfirm={() => cancelMutation.mutate()}
          onKeep={() => setCancelConfirmOpen(false)}
        />
      )}

      <div className="dc-sm-section-label dc-sm-section-label--spaced">Billing History</div>
      <BillingHistoryTable />

      <div className="dc-sm-section-label dc-sm-section-label--spaced">Payment Methods</div>
      <PaymentMethodsList />

      <div className="dc-sm-section-label dc-sm-section-label--spaced">Billing Information</div>
      <BillingInfoCard />

      <button
        type="button"
        className="dc-sm-manage-stripe dc-hv1 dc-focusable dc-pressable"
        disabled={portalMutation.isPending}
        onClick={() => portalMutation.mutate({ origin: window.location.origin })}
      >
        <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
        {portalMutation.isPending ? "Opening…" : "Manage in Stripe"}
      </button>
    </section>
  );
}

// ─── Plan card ──────────────────────────────────────────────────────────────

function PlanCard({
  onUpgrade,
  onRenew,
  renewPending,
  onOpenCancelConfirm,
}: {
  onUpgrade: () => void;
  onRenew: () => void;
  renewPending: boolean;
  onOpenCancelConfirm: () => void;
}) {
  const query = trpc.stripe.getPlanStatus.useQuery();

  if (query.isLoading) {
    return (
      <div className="dc-sm-card dc-sm-plan-card" role="status" aria-live="polite">
        <span className="sr-only">Loading your plan…</span>
        <span className="dc-sm-skel-line" aria-hidden="true" />
        <span className="dc-sm-skel-line dc-sm-skel-line--short" aria-hidden="true" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="dc-sm-card dc-sm-plan-card">
        <p className="dc-sm-billing-error">
          Couldn't load your plan. {query.error?.message || "Please try again."}
        </p>
      </div>
    );
  }

  const status = query.data;
  if (!status) return null;

  const dateStr = formatLongDate(status.governingDate);

  let headline: string;
  switch (status.state) {
    case "active":
      headline = dateStr
        ? `Current Plan — ${status.planLabel} · Renews ${dateStr}`
        : `Current Plan — ${status.planLabel}`;
      break;
    case "cancel_scheduled":
      headline = dateStr ? `Access until ${dateStr}` : "Access ends soon";
      break;
    case "expired":
      headline = dateStr ? `Expired ${dateStr}` : "Expired";
      break;
    case "none":
    default:
      headline = "No plan on file";
      break;
  }

  return (
    <div className="dc-sm-card dc-sm-plan-card">
      <div className="dc-sm-plan-headline">{headline}</div>
      {status.state !== "none" && status.state !== "active" && status.planLabel && (
        <div className="dc-sm-plan-sub">{status.planLabel}</div>
      )}
      {status.state === "none" && (
        <p className="dc-sm-billing-empty-text dc-sm-billing-empty-text--inline">
          You don't have a plan on file. Subscribe to unlock full access.
        </p>
      )}
      <div className="dc-sm-plan-actions">
        {(status.state === "active" || status.state === "none" || status.state === "expired") && (
          <button
            type="button"
            className="dc-sm-pill dc-sm-pill--mint dc-hv1 dc-focusable dc-pressable"
            onClick={onUpgrade}
          >
            Upgrade
          </button>
        )}
        {(status.state === "cancel_scheduled" || status.state === "expired") && (
          <button
            type="button"
            className="dc-sm-pill dc-sm-pill--ghost dc-hv2 dc-focusable dc-pressable"
            disabled={renewPending}
            onClick={onRenew}
          >
            {renewPending ? "Renewing…" : "Renew"}
          </button>
        )}
        {status.state === "active" && (
          <button
            type="button"
            className="dc-sm-pill dc-sm-pill--ghost dc-hv2 dc-focusable dc-pressable"
            onClick={onOpenCancelConfirm}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Cancel confirm — the owner's verbatim copy + the one destructive-red
//     button in the whole app (see the --dime-danger token in
//     conversation.css: destructive-use only, documented exception). ────────

function CancelConfirm({
  pending,
  onConfirm,
  onKeep,
}: {
  pending: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="dc-sm-cancel-confirm dc-sm-cancel-confirm--enter"
      role="alertdialog"
      aria-label="Cancel your plan"
    >
      <p className="dc-sm-cancel-copy">{CANCEL_CONFIRM_COPY}</p>
      <div className="dc-sm-cancel-actions">
        <button
          type="button"
          className="dc-sm-pill dc-sm-pill--ghost dc-hv2 dc-focusable dc-pressable"
          onClick={onKeep}
        >
          Keep plan
        </button>
        <button
          type="button"
          className="dc-sm-pill dc-sm-pill--danger dc-focusable dc-pressable"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? "Cancelling…" : "Cancel plan"}
        </button>
      </div>
    </div>
  );
}

// ─── Billing history ────────────────────────────────────────────────────────

function BillingHistoryTable() {
  const query = trpc.stripe.getInvoices.useQuery();

  if (query.isLoading) {
    return (
      <div className="dc-sm-card dc-sm-bill-table-wrap" role="status" aria-live="polite">
        <span className="sr-only">Loading your billing history…</span>
        <span className="dc-sm-skel-line" aria-hidden="true" />
        <span className="dc-sm-skel-line dc-sm-skel-line--short" aria-hidden="true" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="dc-sm-card dc-sm-bill-table-wrap">
        <p className="dc-sm-billing-error">
          Couldn't load your billing history. {query.error?.message || "Please try again."}
        </p>
      </div>
    );
  }

  const invoiceList = query.data ?? [];
  if (invoiceList.length === 0) {
    return (
      <div className="dc-sm-card dc-sm-bill-table-wrap">
        <p className="dc-sm-billing-empty-text">No billing history yet.</p>
      </div>
    );
  }

  return (
    <div className="dc-sm-card dc-sm-bill-table-wrap">
      <table className="dc-sm-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
            <th scope="col">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {invoiceList.map((inv, idx) => (
            <tr key={inv.hostedInvoiceUrl ?? `${inv.date}-${idx}`}>
              <td>{formatShortDate(inv.date)}</td>
              <td>{formatCents(inv.amountCents, inv.currency)}</td>
              <td className="dc-sm-table-status">{capitalize(inv.status)}</td>
              <td>
                {inv.hostedInvoiceUrl ? (
                  <a
                    href={inv.hostedInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dc-sm-receipt-link"
                  >
                    View receipt
                  </a>
                ) : (
                  <span className="dc-sm-field-value--muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Payment methods ────────────────────────────────────────────────────────

function PaymentMethodsList() {
  const query = trpc.stripe.getPaymentMethods.useQuery();

  if (query.isLoading) {
    return (
      <div className="dc-sm-card dc-sm-pm-list" role="status" aria-live="polite">
        <span className="sr-only">Loading your payment methods…</span>
        <span className="dc-sm-skel-line dc-sm-skel-line--short" aria-hidden="true" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="dc-sm-card dc-sm-pm-list">
        <p className="dc-sm-billing-error">
          Couldn't load your payment methods. {query.error?.message || "Please try again."}
        </p>
      </div>
    );
  }

  const methods = query.data ?? [];
  if (methods.length === 0) {
    return (
      <div className="dc-sm-card dc-sm-pm-list">
        <p className="dc-sm-billing-empty-text">No payment method on file.</p>
      </div>
    );
  }

  return (
    <div className="dc-sm-card dc-sm-pm-list">
      {methods.map((pm, idx) => (
        <div className="dc-sm-field dc-sm-pm-row" key={`${pm.brand}-${pm.last4}-${idx}`}>
          <div className="dc-sm-field-text">
            <span className="dc-sm-field-label">{capitalize(pm.brand)}</span>
            <span className="dc-sm-field-value">
              •••• {pm.last4}
            </span>
          </div>
          <div className="dc-sm-pm-meta">
            <span className="dc-sm-field-note">
              Exp {String(pm.expMonth).padStart(2, "0")}/{String(pm.expYear).slice(-2)}
            </span>
            {pm.isDefault && <span className="dc-sm-pm-default">Default</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Billing information ────────────────────────────────────────────────────

function BillingInfoCard() {
  const query = trpc.stripe.getBillingInfo.useQuery();

  if (query.isLoading) {
    return (
      <div className="dc-sm-card dc-sm-billing-info" role="status" aria-live="polite">
        <span className="sr-only">Loading your billing information…</span>
        <span className="dc-sm-skel-line" aria-hidden="true" />
        <span className="dc-sm-skel-line dc-sm-skel-line--short" aria-hidden="true" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="dc-sm-card dc-sm-billing-info">
        <p className="dc-sm-billing-error">
          Couldn't load your billing information. {query.error?.message || "Please try again."}
        </p>
      </div>
    );
  }

  const info = query.data;
  const address = info?.address ?? null;
  const hasAny = !!(info?.name || info?.email || address);

  if (!hasAny) {
    return (
      <div className="dc-sm-card dc-sm-billing-info">
        <p className="dc-sm-billing-empty-text">No billing information on file.</p>
      </div>
    );
  }

  const addressLine = address ? [address.line1, address.line2].filter(Boolean).join(", ") : null;
  const cityLine = address
    ? [address.city, address.state, address.postal_code].filter(Boolean).join(", ")
    : null;
  // Local, non-optional variables (not info?.name / info.name repeated) — keeps
  // the narrowing simple/robust and gives the JSX below a single source of
  // truth for "is this field present" per field.
  const name = info?.name ?? null;
  const email = info?.email ?? null;

  return (
    <div className="dc-sm-card dc-sm-billing-info">
      {name && (
        <div className="dc-sm-field">
          <div className="dc-sm-field-text">
            <span className="dc-sm-field-label">Name</span>
            <span className="dc-sm-field-value">{name}</span>
          </div>
        </div>
      )}
      {email && (
        <div className="dc-sm-field">
          <div className="dc-sm-field-text">
            <span className="dc-sm-field-label">Email</span>
            <span className="dc-sm-field-value">{email}</span>
          </div>
        </div>
      )}
      {address && (
        <div className="dc-sm-field">
          <div className="dc-sm-field-text">
            <span className="dc-sm-field-label">Address</span>
            <span className="dc-sm-field-value">
              {addressLine || "—"}
              {cityLine ? (
                <>
                  <br />
                  {cityLine}
                </>
              ) : null}
              {address.country ? (
                <>
                  <br />
                  {address.country}
                </>
              ) : null}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
