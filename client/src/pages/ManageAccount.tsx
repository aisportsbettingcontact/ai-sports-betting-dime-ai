/**
 * ManageAccount.tsx
 *
 * Dedicated account management page for all authenticated users.
 *
 * FEATURES:
 *   - Displays username, email, plan badge (LIFETIME gold | monthly/annual neon green expiry)
 *   - Forgot Password — sends reset email via requestPasswordReset
 *   - Update Payment Info — opens Stripe Customer Portal (billing portal)
 *   - Cancel Subscription — cancels at period end via stripe.cancelSubscription
 *   - Log Out — clears session cookie and redirects to /
 *
 * RESTRICTIONS (enforced both here and server-side):
 *   - Users CANNOT change their username
 *   - Users CANNOT disconnect their Discord account
 *
 * LAYOUT: Centered card, dark theme, responsive across all breakpoints.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";
import { LogOut, Key, CreditCard, XCircle, ArrowLeft, BarChart3, AlertTriangle, RefreshCw } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatExpiry(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManageAccount() {
  const [, setLocation] = useLocation();
  const { appUser, loading, refetch } = useAppAuth();
  const utils = trpc.useUtils();

  // Local state for cancel confirmation dialog
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelledAt, setCancelledAt] = useState<number | null>(null);

  // Local state for forgot password flow
  const [forgotSent, setForgotSent] = useState(false);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const logoutMutation = trpc.appUsers.logout.useMutation({
    onSuccess: async () => {
      console.log("[ManageAccount][logout] [OUTPUT] Session cleared — redirecting to /");
      utils.appUsers.me.setData(undefined, null);
      await utils.appUsers.me.invalidate();
      window.location.href = "/";
    },
    onError: (err) => {
      console.error("[ManageAccount][logout] [VERIFY] FAIL", err.message);
      toast.error("Logout failed. Please try again.");
    },
  });

  const forgotPasswordMutation = trpc.appUsers.requestPasswordReset.useMutation({
    onSuccess: () => {
      console.log("[ManageAccount][forgotPassword] [OUTPUT] Reset email sent");
      setForgotSent(true);
      toast.success("Password reset email sent. Check your inbox.");
    },
    onError: (err) => {
      console.error("[ManageAccount][forgotPassword] [VERIFY] FAIL", err.message);
      toast.error(err.message || "Failed to send reset email.");
    },
  });

  const portalMutation = trpc.stripe.createPortalSession.useMutation({
    onSuccess: (data) => {
      console.log("[ManageAccount][portal] [OUTPUT] Opening Stripe portal:", data.url.substring(0, 60));
      window.open(data.url, "_blank");
    },
    onError: (err) => {
      console.error("[ManageAccount][portal] [VERIFY] FAIL", err.message);
      toast.error(err.message || "Failed to open billing portal.");
    },
  });

  const cancelMutation = trpc.stripe.cancelSubscription.useMutation({
    onSuccess: (data) => {
      console.log("[ManageAccount][cancel] [OUTPUT] Subscription cancelled at period end:", new Date(data.cancelAt).toISOString());
      setCancelledAt(data.cancelAt);
      setShowCancelConfirm(false);
      refetch();
      utils.appUsers.me.invalidate();
      toast.success("Subscription cancelled. You retain access until your billing period ends.");
    },
    onError: (err) => {
      console.error("[ManageAccount][cancel] [VERIFY] FAIL", err.message);
      toast.error(err.message || "Failed to cancel subscription.");
    },
  });

  const reactivateMutation = trpc.stripe.reactivateSubscription.useMutation({
    onSuccess: () => {
      console.log("[ManageAccount][reactivate] [OUTPUT] Subscription reactivated — will auto-renew");
      setCancelledAt(null);
      refetch();
      utils.appUsers.me.invalidate();
      toast.success("Subscription reactivated! Your plan will auto-renew.");
    },
    onError: (err) => {
      console.error("[ManageAccount][reactivate] [VERIFY] FAIL", err.message);
      toast.error(err.message || "Failed to reactivate subscription.");
    },
  });

  // ── Loading / unauthenticated guard ───────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!appUser) {
    setLocation("/login?returnPath=%2Faccount");
    return null;
  }

  // ── Derived display values ────────────────────────────────────────────────

  const planId = (appUser as { stripePlanId?: string | null }).stripePlanId;
  const expiry = appUser.expiryDate;
  const isLifetime = !expiry || planId === "lifetime";
  const hasStripe = !!(appUser as { stripeCustomerId?: string | null }).stripeCustomerId;
  // cancelAtPeriodEnd: true = set to cancel at period end, still has access
  // !hasAccess: fully expired
  const cancelAtPeriodEnd = (appUser as { cancelAtPeriodEnd?: boolean }).cancelAtPeriodEnd ?? false;
  // Derive button state:
  // 1. Fully expired (no access) → "Renew Subscription" (redirect to pricing)
  // 2. Active but set to cancel → "Reactivate Subscription" (undo cancel)
  // 3. Active and auto-renewing → "Cancel Subscription"
  const subButtonState: 'cancel' | 'reactivate' | 'renew' =
    !appUser.hasAccess ? 'renew'
    : (cancelAtPeriodEnd || cancelledAt !== null) ? 'reactivate'
    : 'cancel';
  console.log(`[ManageAccount][RENDER] subButtonState=${subButtonState} hasAccess=${appUser.hasAccess} cancelAtPeriodEnd=${cancelAtPeriodEnd} cancelledAt=${cancelledAt}`);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Top bar ── */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <button
          type="button"
          onClick={() => setLocation("/feed/model/mlb")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden xs:inline">Back to Feed</span>
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary flex-shrink-0" />
          <span className="font-black text-white tracking-wider text-sm">AI SPORTS BETTING</span>
        </div>
        {/* spacer to balance back button */}
        <div className="w-20 hidden xs:block" />
      </header>

      {/* ── Main card ── */}
      <main className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-4">
          {/* ── Account info card ── */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <h1 className="text-base font-black text-white tracking-wider uppercase">Manage Account</h1>

            {/* Username */}
            <div className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Username</p>
              <p className="text-sm font-bold text-white">@{appUser.username}</p>
              <p className="text-[10px] text-muted-foreground">Username cannot be changed.</p>
            </div>

            {/* Email */}
            <div className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Email</p>
              <p className="text-sm text-foreground">{appUser.email}</p>
            </div>

            {/* Plan badge */}
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Subscription</p>
              {isLifetime ? (
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded text-xs font-black tracking-wider"
                  style={{ background: "#45E0A8", color: "#000", letterSpacing: "0.08em" }}
                >
                  LIFETIME ACCESS
                </span>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-black tracking-wider"
                    style={{ background: "#45E0A8", color: "#000", letterSpacing: "0.06em" }}
                  >
                    {planId === "annual" ? "ANNUAL" : "MONTHLY"} · EXP {formatExpiry(expiry!)}
                  </span>
                  {cancelledAt && (
                    <span className="text-[11px] text-white font-semibold">
                      Cancels {formatExpiry(cancelledAt)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Discord */}
            {appUser.discordId && (
              <div className="space-y-0.5">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Discord</p>
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.132 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  <span className="text-sm text-foreground">@{appUser.discordUsername ?? appUser.discordId}</span>
                  <span className="text-[10px] text-muted-foreground">(cannot be disconnected)</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Action buttons ── */}
          <div className="space-y-3">
            {/* Forgot Password */}
            <button
              type="button"
              disabled={forgotPasswordMutation.isPending || forgotSent}
              onClick={() => {
                console.log("[ManageAccount][forgotPassword] [INPUT] email=", appUser.email);
                forgotPasswordMutation.mutate({ emailOrUsername: appUser.email, origin: window.location.origin });
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-border rounded-xl text-sm font-semibold text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Key className="w-4 h-4 text-white flex-shrink-0" />
              <span className="flex-1 text-left">
                {forgotSent ? "Reset email sent — check your inbox" : "Forgot Password"}
              </span>
              {forgotPasswordMutation.isPending && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0" />
              )}
            </button>

            {/* Update Payment Info — only for Stripe subscribers */}
            {hasStripe && !isLifetime && (
              <button
                type="button"
                disabled={portalMutation.isPending}
                onClick={() => {
                  console.log("[ManageAccount][portal] [INPUT] origin=", window.location.origin);
                  portalMutation.mutate({ origin: window.location.origin });
                }}
                className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-border rounded-xl text-sm font-semibold text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CreditCard className="w-4 h-4 text-[#45E0A8] flex-shrink-0" />
                <span className="flex-1 text-left">Update Payment Information</span>
                {portalMutation.isPending && (
                  <div className="w-4 h-4 border-2 border-[#45E0A8] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
              </button>
            )}

            {/* Subscription action button — 3 states: cancel / reactivate / renew */}
            {hasStripe && !isLifetime && (
              <>
                {subButtonState === 'cancel' && (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-white rounded-xl text-sm font-semibold text-white transition-colors"
                  >
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left">Cancel Subscription</span>
                  </button>
                )}

                {subButtonState === 'reactivate' && (
                  <button
                    type="button"
                    disabled={reactivateMutation.isPending}
                    onClick={() => {
                      console.log("[ManageAccount][reactivate] [INPUT] userId=", appUser.id);
                      reactivateMutation.mutate();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-white rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left">
                      {reactivateMutation.isPending ? "Reactivating…" : "Reactivate Subscription"}
                    </span>
                    {reactivateMutation.isPending && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    )}
                  </button>
                )}

                {subButtonState === 'renew' && (
                  <button
                    type="button"
                    onClick={() => {
                      console.log("[ManageAccount][renew] [INPUT] userId=", appUser.id, "redirecting to pricing");
                      setLocation("/");
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-primary/40 rounded-xl text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left">Renew Subscription</span>
                  </button>
                )}
              </>
            )}

            {/* Log Out */}
            <button
              type="button"
              disabled={logoutMutation.isPending}
              onClick={() => {
                console.log("[ManageAccount][logout] [INPUT] userId=", appUser.id);
                logoutMutation.mutate();
              }}
              className="w-full flex items-center gap-3 px-4 py-3.5 bg-card border border-border rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left">Log Out</span>
              {logoutMutation.isPending && (
                <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin flex-shrink-0" />
              )}
            </button>
          </div>

          {/* ── Disclaimer ── */}
          <p className="text-center text-[11px] text-muted-foreground px-4">
            By using this service you agree to gamble responsibly. This tool is for informational purposes only.
          </p>
        </div>
      </main>

      {/* ── Cancel Confirmation Dialog ── */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-white flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider">Cancel Subscription?</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Your subscription will be cancelled at the end of your current billing period.
                  You will retain full access until then.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-secondary text-sm font-semibold text-foreground hover:bg-accent transition-colors"
              >
                Keep Subscription
              </button>
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  console.log("[ManageAccount][cancel] [INPUT] userId=", appUser.id);
                  cancelMutation.mutate();
                }}
                className="flex-1 px-4 py-2.5 rounded-lg bg-black border border-white text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cancelMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Cancelling…
                  </span>
                ) : (
                  "Yes, Cancel"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
