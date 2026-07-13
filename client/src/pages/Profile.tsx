/**
 * Profile page — AI Sports Betting (Prez Bets)
 * ---------------------------------------------------------------
 * One job: identity and standing.
 * The membership IS the content here — gold lives on this page
 * and nowhere else. Administration recedes into quiet rows.
 *
 * Route: /profile
 * Bottom-nav Profile tab points here.
 * Styles in profile.css.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import "./profile.css";

// ─── Structured logging (matches repo convention) ────────────────────────────
function profileLog(event: string, meta?: Record<string, unknown>) {
  const payload = { event, ts: new Date().toISOString(), ...meta };
  console.log(`[Profile] ${event}`, JSON.stringify(payload));
}

// ─── Plan label derivation ───────────────────────────────────────────────────
function derivePlanLabel(user: {
  expiryDate: number | null | undefined;
  stripePlanId: string | null | undefined;
  hasAccess: boolean;
}): string {
  if (user.expiryDate === null || user.expiryDate === undefined) {
    return "LIFETIME ACCESS";
  }
  if (user.stripePlanId === "annual") return "ANNUAL";
  if (user.stripePlanId === "monthly") return "MONTHLY";
  if (user.stripePlanId === "pro") return "PRO";
  if (user.stripePlanId === "sharp") return "SHARP";
  if (user.stripePlanId === "operator") return "OPERATOR";
  if (user.hasAccess) return "ACTIVE";
  return "EXPIRED";
}

export default function Profile() {
  const { appUser, loading, refetch } = useAppAuth();
  const utils = trpc.useUtils();
  const hasLoggedView = useRef(false);

  // ─── Unauthenticated redirect ──────────────────────────────────────────────
  useEffect(() => {
    if (!loading && !appUser) {
      window.location.href = "/login";
    }
  }, [loading, appUser]);

  // ─── Structured log: profile.view (once per mount) ─────────────────────────
  useEffect(() => {
    if (appUser && !hasLoggedView.current) {
      hasLoggedView.current = true;
      profileLog("profile.view", { userId: appUser.id });
    }
  }, [appUser]);

  // ─── Logout mutation ───────────────────────────────────────────────────────
  const logoutMutation = trpc.appUsers.logout.useMutation({
    onSuccess: async () => {
      profileLog("profile.logout.click", { userId: appUser?.id });
      utils.appUsers.me.setData(undefined, null);
      await utils.appUsers.me.invalidate();
      window.location.href = "/";
    },
    onError: (err) => {
      profileLog("profile.logout.error", { error: err.message });
      toast.error("Logout failed. Please try again.");
    },
  });

  // ─── Password reset mutation ───────────────────────────────────────────────
  const resetMutation = trpc.appUsers.requestPasswordReset.useMutation({
    onSuccess: () => {
      profileLog("profile.reset_password.click", { userId: appUser?.id });
      toast.success("Password reset email sent. Check your inbox.");
    },
    onError: (err) => {
      profileLog("profile.load.error", {
        errorClass: "PasswordResetError",
        detail: err.message,
      });
      toast.error(err.message || "Failed to send reset email.");
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleLogout = () => {
    profileLog("profile.logout.click", { userId: appUser?.id });
    logoutMutation.mutate();
  };

  const handleResetPassword = () => {
    if (!appUser?.email) return;
    profileLog("profile.reset_password.click", { userId: appUser.id });
    resetMutation.mutate({
      emailOrUsername: appUser.email,
      origin: window.location.origin,
    });
  };

  // ─── Loading state (stable skeleton, no layout shift) ──────────────────────
  if (loading) {
    return (
      <div className="pf-page">
        <header className="pf-hero">
          <div
            className="pf-skeleton pf-skeleton--circle"
            style={{ width: 72, height: 72 }}
          />
          <div
            className="pf-skeleton"
            style={{ width: 120, height: 24, marginTop: 14 }}
          />
          <div
            className="pf-skeleton"
            style={{ width: 160, height: 28, marginTop: 10 }}
          />
          <div
            className="pf-skeleton"
            style={{ width: 100, height: 14, marginTop: 6 }}
          />
        </header>
        <section className="pf-section">
          <div
            className="pf-skeleton"
            style={{ width: "100%", height: 52, borderRadius: 14 }}
          />
        </section>
        <section className="pf-section">
          <div
            className="pf-skeleton"
            style={{ width: "100%", height: 104, borderRadius: 14 }}
          />
        </section>
      </div>
    );
  }

  // ─── Error / unauthenticated state ─────────────────────────────────────────
  if (!appUser) {
    profileLog("profile.load.error", { errorClass: "Unauthenticated" });
    return (
      <div className="pf-page">
        <div className="pf-error">
          <p className="pf-error-text">
            Unable to load your profile. Please log in again.
          </p>
          <button
            className="pf-error-retry"
            onClick={() => (window.location.href = "/login")}
          >
            Log in
          </button>
        </div>
      </div>
    );
  }

  // ─── Derive display values ─────────────────────────────────────────────────
  const planLabel = derivePlanLabel(appUser);
  const isLifetime = planLabel === "LIFETIME ACCESS";
  const displayUsername = appUser.username?.startsWith("@")
    ? appUser.username
    : `@${appUser.username}`;

  return (
    <div className="pf-page">
      {/* ------- Identity ------- */}
      <header className="pf-hero">
        <span className="pf-wordmark" aria-label="dime">
          d<span className="pf-wordmark-i">ı<span className="pf-coindot" /></span>me
        </span>
        <h1 className="pf-username">{displayUsername}</h1>
        <div className="pf-plan">
          <span className="pf-plan-badge">{planLabel}</span>
          {/* member-since: not currently exposed by appUsers.me — rendered conditionally */}
        </div>
      </header>

      {/* ------- Connections ------- */}
      {appUser.discordUsername && (
        <section className="pf-section" aria-labelledby="pf-connections">
          <h2 className="pf-label" id="pf-connections">
            Connections
          </h2>
          <div className="pf-card">
            <div className="pf-row">
              <span className="pf-row-key">Discord</span>
              <span className="pf-row-value">
                @{appUser.discordUsername}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* ------- Account ------- */}
      <section className="pf-section" aria-labelledby="pf-account">
        <h2 className="pf-label" id="pf-account">
          Account
        </h2>
        <div className="pf-card">
          <div className="pf-row">
            <span className="pf-row-key">Email</span>
            <span className="pf-row-value pf-row-value--dim">
              {appUser.email}
            </span>
          </div>
          {isLifetime && (
            <div className="pf-row">
              <span className="pf-row-key">Plan</span>
              <span className="pf-row-value">Lifetime</span>
            </div>
          )}
          <button
            className="pf-row pf-row--action"
            onClick={handleResetPassword}
            disabled={resetMutation.isPending}
          >
            {resetMutation.isPending ? "Sending..." : "Reset password"}
            <span className="pf-chev" aria-hidden="true">
              ›
            </span>
          </button>
        </div>
      </section>

      {/* ------- Session ------- */}
      <section className="pf-section">
        <div className="pf-card">
          <button
            className="pf-row pf-row--action pf-row--quiet"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            {logoutMutation.isPending ? "Logging out..." : "Log out"}
          </button>
        </div>
      </section>

      {/* ------- Footer ------- */}
      <footer className="pf-footer">
        <p>
          For informational purposes only. Please gamble responsibly.
          <br />
          Help is available: 1-800-GAMBLER
        </p>
      </footer>
    </div>
  );
}
