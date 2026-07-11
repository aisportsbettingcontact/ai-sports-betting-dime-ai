/**
 * Home.tsx — Login page (/login)
 *
 * Layout: Split-screen on desktop (lg+), stacked on mobile.
 *   LEFT  — Full-height brand panel: logo, headline, feature bullets, gradient bg.
 *   RIGHT — Login form: username/password, forgot password, Discord OAuth, sign-up link.
 *
 * Fluid scaling:
 *   - Both panels use min-h-screen so they always fill the viewport.
 *   - Left panel hides on mobile (hidden lg:flex) to keep the form full-screen on small devices.
 *   - Form panel is always full-screen on mobile, half-screen on desktop.
 *   - All font sizes use clamp() for fluid scaling across all pixel densities.
 *
 * Auth flow:
 *   1. Username/password  → trpc.appUsers.login
 *   2. Forgot password    → trpc.appUsers.requestPasswordReset
 *   3. Discord OAuth      → /api/auth/discord-login/connect?returnPath=...
 *
 * Error handling:
 *   - Discord OAuth errors shown as a banner (from ?discord_error= URL param).
 *   - Form errors shown inline below the submit button.
 *   - Transient server errors auto-retry after 5s.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye, EyeOff, TrendingUp, MessageSquare, ListChecks, Clock } from "lucide-react";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Discord brand icon ────────────────────────────────────────────────────────
function DiscordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// ── Discord OAuth error messages ──────────────────────────────────────────────
const DISCORD_ERRORS: Record<string, string> = {
  no_account:            "No account found for your Discord. Purchase a subscription to get access.",
  access_disabled:       "Your account access has been disabled. Contact support.",
  account_expired:       "Your subscription has expired. Renew to regain access.",
  discord_cancelled:     "Discord sign-in was cancelled.",
  state_expired:         "Login session expired. Please try again.",
  state_mismatch:        "Invalid login state. Please try again.",
  token_exchange_failed: "Discord authentication failed. Please try again.",
  profile_fetch_failed:  "Could not fetch your Discord profile. Please try again.",
  timeout:               "Discord sign-in timed out. Please try again.",
  server_error:          "A server error occurred during sign-in. Please try again.",
  db_unavailable:        "Database unavailable. Please try again in a moment.",
  not_in_guild:          "You are not in the AI Sports Betting Discord server. Join first, then try again.",
  missing_role:          "You do not have the AI Model Sub role. Purchase a subscription to get access.",
  invite_invalid:        "This invite link is invalid, has already been used, or has expired.",
  invite_already_used:   "This invite link has already been used. Each link is single-use.",
  invite_connect_failed: "An error occurred processing your invite link. Please try again.",
  access_revoked:        "Your account access has been revoked. Contact support.",
  user_not_found:        "Your account could not be found. Contact support.",
  discord_not_configured: "Discord integration is not configured. Contact support.",
  discord_error:         "Discord returned an unexpected error. Please try again.",
  invalid_callback:      "Invalid Discord OAuth callback. Please try again.",
};

// ── Feature bullets for the left brand panel (v2 whitelist claims only) ───────
const BRAND_FEATURES = [
  {
    icon: TrendingUp,
    title: "Full projections board",
    desc: "Moneyline, run line, totals, F5, NRFI, K props and HR props — every market priced book vs model.",
  },
  {
    icon: MessageSquare,
    title: "Dime Chat",
    desc: "Ask the engine anything on the slate. Answers trace back to tables the model wrote.",
  },
  {
    icon: ListChecks,
    title: "The Dime Verdict",
    desc: "Every market resolves to Pass, Monitor, or Edge Detected. Most verdicts are Pass.",
  },
  {
    icon: Clock,
    title: "Graded against the close",
    desc: "Odds freeze at first pitch. Every projection is Brier-scored after the final out.",
  },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const { appUser, loading: authLoading } = useAppAuth();

  // ── Auth state ────────────────────────────────────────────────────────────
  const [authTimedOut, setAuthTimedOut] = useState(false);
  useEffect(() => {
    if (!authLoading) return;
    const timer = setTimeout(() => setAuthTimedOut(true), 2000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  useEffect(() => {
    if (!authLoading && appUser) {
      const searchParams = new URLSearchParams(window.location.search);
      // Default post-login destination: canonical AI Model Projections feed
      // (/feed/model/mlb canonicalizes to today's dated URL).
      const returnPath = searchParams.get("returnPath") ?? "/feed/model/mlb";
      console.log(`[Login] [STATE] Already authenticated — redirecting to returnPath=${returnPath}`);
      setLocation(returnPath);
    }
  }, [appUser, authLoading, setLocation]);

  // ── URL params ────────────────────────────────────────────────────────────
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const discordError = searchParams.get("discord_error");
  const discordUser  = searchParams.get("discord_user");
  const returnPath   = searchParams.get("returnPath") ?? "/feed/model/mlb";
  const loginUrl     = `/api/auth/discord-login/connect?returnPath=${encodeURIComponent(returnPath)}`;

  // ── Transient error auto-retry ────────────────────────────────────────────
  const isTransientError = discordError === "server_error" || discordError === "db_unavailable" || discordError === "timeout";
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (!isTransientError) return;
    console.log(`[Login] [AUTO_RETRY] Transient error '${discordError}' — auto-retrying in 5s`);
    let count = 5;
    setRetryCountdown(count);
    const interval = setInterval(() => {
      count--;
      setRetryCountdown(count);
      if (count <= 0) {
        clearInterval(interval);
        window.location.href = loginUrl;
      }
    }, 1_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransientError]);

  // ── Username/password form state ──────────────────────────────────────────
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [showPw, setShowPw]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  const loginMutation = trpc.appUsers.login.useMutation({
    onSuccess: () => {
      console.log("[Login] [OUTPUT] Login successful — redirecting to", returnPath);
      toast.success("Signed in successfully.");
      setLocation(returnPath);
    },
    onError: (err) => {
      console.error("[Login] [VERIFY] FAIL — login error:", err.message);
      setFormError(err.message ?? "Invalid credentials. Please try again.");
    },
  });

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!identifier.trim() || !password) {
      setFormError("Please enter your username/email and password.");
      return;
    }
    console.log(`[Login] [INPUT] handleFormSubmit — identifier=${identifier.trim()} stayLoggedIn=true`);
    loginMutation.mutate({
      emailOrUsername: identifier.trim(),
      password,
      stayLoggedIn: true,
    });
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  const [forgotOpen, setForgotOpen]         = useState(false);
  const [forgotIdentifier, setForgotIdent]  = useState("");
  const [forgotSent, setForgotSent]         = useState(false);

  const requestResetMutation = trpc.appUsers.requestPasswordReset.useMutation({
    onSuccess: () => {
      console.log("[Login] [OUTPUT] Password reset email sent");
      setForgotSent(true);
    },
    onError: (err) => {
      console.error("[Login] [VERIFY] FAIL — requestPasswordReset error:", err.message);
      toast.error(err.message ?? "Failed to send reset email. Please try again.");
    },
  });

  function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotIdentifier.trim()) return;
    console.log(`[Login] [INPUT] handleForgotSubmit — identifier=${forgotIdentifier.trim()}`);
    requestResetMutation.mutate({
      emailOrUsername: forgotIdentifier.trim(),
      origin: window.location.origin,
    });
  }

  // ── Discord redirect state ────────────────────────────────────────────────
  const [isDiscordRedirecting, setIsDiscordRedirecting] = useState(false);
  function handleDiscordClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (isDiscordRedirecting) { e.preventDefault(); return; }
    setIsDiscordRedirecting(true);
    setTimeout(() => setIsDiscordRedirecting(false), 15_000);
  }

  // ── Render guard ──────────────────────────────────────────────────────────
  if (authLoading && !authTimedOut) return null;

  // ── Resolve discord error message ─────────────────────────────────────────
  let discordErrorMsg = discordError
    ? (DISCORD_ERRORS[discordError] ?? "Sign-in failed. Please try again.")
    : null;
  if (discordUser && discordError === "no_account") {
    discordErrorMsg = `No account found for @${discordUser}. Purchase a subscription to get access.`;
  }
  if (discordUser && discordError === "missing_role") {
    discordErrorMsg = `@${discordUser} does not have the AI Model Sub role. Purchase a subscription to get access.`;
  }
  if (discordUser && discordError === "not_in_guild") {
    discordErrorMsg = `@${discordUser} is not in the AI Sports Betting Discord server. Join first, then try again.`;
  }

  return (
    /*
     * Root: full-viewport flex row on desktop, flex column on mobile.
     * [LOG] Layout: lg:flex-row (split-screen) | <lg: flex-col (stacked, form only)
     */
    <div
      className="flex flex-col lg:flex-row min-h-screen w-full"
      style={{ background: "#0B0B0F", fontFamily: "'Familjen Grotesk', sans-serif" /* brand law: never inherit legacy Inter */ }}
    >

      {/* ═══════════════════════════════════════════════════════════════════════
          LEFT PANEL — Brand / feature showcase
          Hidden on mobile (hidden lg:flex) — form takes full screen on small devices.
          Full-height, sticky, fills exactly 50vw on desktop.
      ════════════════════════════════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex flex-col justify-between w-1/2 min-h-screen sticky top-0 self-start"
        style={{
          background:
            "#101014"  /* brand law: flat surface, no gradients */,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          padding: "clamp(2.5rem, 5vw, 5rem) clamp(2rem, 4vw, 4rem)",
        }}
      >
        {/* Top: logo + brand name */}
        <div>
          <a href="/" aria-label="Back to home" className="inline-flex items-center mb-12 group">
            {/* Brand-kit wordmark (430×92) — natural aspect, no crop */}
            <img
              src="/brand/dime-wordmark-on-dark.svg"
              alt="dıme"
              className="group-hover:opacity-90 transition-opacity"
              style={{ width: "clamp(6.5rem, 9vw, 8.5rem)", height: "auto" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </a>

          {/* Headline */}
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-[#45E0A8]" />
              <span className="text-[11px] font-bold text-[#45E0A8] tracking-widest uppercase">
                Sports betting intelligence software
              </span>
            </div>
            <h1
              className="font-bold text-white leading-[1.05]"
              style={{
                fontSize: "clamp(2rem, 3.5vw, 3.75rem)",
                letterSpacing: "-0.04em",
              }}
            >
              See where price
              <br />
              <span style={{ color: "#45E0A8" }}>and probability</span>
              <br />
              disagree.
            </h1>
            <p
              className="text-[#6b7280] mt-4 leading-relaxed"
              style={{ fontSize: "clamp(0.875rem, 1.1vw, 1.05rem)" }}
            >
              Dime AI compares sportsbook prices against projected probability so every
              market resolves to Pass, Monitor, or Edge Detected.
            </p>
          </div>

          {/* Feature bullets */}
          <div className="flex flex-col gap-5">
            {BRAND_FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="flex items-start gap-4">
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-lg"
                    style={{
                      width: "clamp(2rem, 2.5vw, 2.5rem)",
                      height: "clamp(2rem, 2.5vw, 2.5rem)",
                      background: "rgba(69,224,168,0.10)",
                    }}
                  >
                    <Icon
                      style={{
                        color: "#45E0A8",
                        width: "clamp(1rem, 1.2vw, 1.2rem)",
                        height: "clamp(1rem, 1.2vw, 1.2rem)",
                      }}
                    />
                  </div>
                  <div>
                    <p
                      className="font-bold text-white"
                      style={{ fontSize: "clamp(0.8rem, 1vw, 0.95rem)" }}
                    >
                      {f.title}
                    </p>
                    <p
                      className="text-[#6b7280] mt-0.5 leading-snug"
                      style={{ fontSize: "clamp(0.75rem, 0.9vw, 0.875rem)" }}
                    >
                      {f.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom: disclaimer — legible grey (contrast law), full RG language */}
        <p
          className="text-[#9A9AA8] mt-8"
          style={{ fontSize: "clamp(0.65rem, 0.8vw, 0.75rem)" }}
        >
          No guaranteed outcomes. For informational purposes only. 21+ (or legal betting age in
          your jurisdiction). Gambling problem? Call 1-800-GAMBLER.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          RIGHT PANEL — Login form
          Full-screen on mobile, half-screen on desktop.
          Vertically centered, horizontally padded.
      ════════════════════════════════════════════════════════════════════════ */}
      <div
        className="flex-1 flex flex-col items-center justify-center min-h-screen"
        style={{ padding: "clamp(2rem, 5vw, 5rem) clamp(1.5rem, 5vw, 5rem)" }}
      >
        {/* Mobile-only logo (hidden on desktop where left panel shows it) */}
        <div className="flex lg:hidden flex-col items-center gap-3 mb-8">
          <a href="/" aria-label="Back to home">
            <img
              src="/brand/dime-wordmark-on-dark.svg"
              alt="dıme"
              style={{ width: "104px", height: "auto" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </a>
          <div className="text-center">
            <h1 className="text-lg font-bold text-white tracking-tight">dıme</h1>
            <p className="text-[12px] text-[#9A9AA8] mt-0.5">Sign in to your account</p>
          </div>
        </div>

        {/* Form container — max-w keeps it readable on ultra-wide right panels */}
        <div className="w-full" style={{ maxWidth: "clamp(320px, 40vw, 480px)" }}>

          {/* Desktop heading */}
          <div className="hidden lg:block mb-8">
            <h2
              className="font-bold text-white"
              style={{ fontSize: "clamp(1.5rem, 2.2vw, 2.25rem)", letterSpacing: "-0.03em" }}
            >
              Sign in
            </h2>
            <p className="text-[#6b7280] mt-1" style={{ fontSize: "clamp(0.875rem, 1vw, 1rem)" }}>
              Welcome back. Enter your credentials to continue.
            </p>
          </div>

          {/* ── Discord error stamp — grey, never red (signup.md: auth errors are
                mono stamps on neutral surface; red is not in the Dime palette) ── */}
          {discordErrorMsg && (
            <div
              className="mb-5 px-4 py-3 rounded-lg text-[12px] text-[#9A9AA8] text-center space-y-1.5"
              style={{ background: "#1E1E26", border: "1px solid rgba(255,255,255,0.14)" }}
              role="alert"
            >
              <p className="uppercase tracking-widest text-[10px] text-[#6E6E78]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                Sign-in error
              </p>
              <p className="text-white/90">{discordErrorMsg}</p>
              {isTransientError && retryCountdown !== null && (
                <p>Retrying in {retryCountdown}s…</p>
              )}
              {isTransientError && (
                <button
                  onClick={() => { window.location.href = loginUrl; }}
                  className="text-xs underline text-white/80 hover:text-white transition-colors"
                >
                  Retry now
                </button>
              )}
            </div>
          )}

          {/* ── Username / Password form ── */}
          {!forgotOpen ? (
            <form onSubmit={handleFormSubmit} className="flex flex-col gap-4" noValidate>
              {/* Identifier */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="identifier"
                  className="text-[12px] font-semibold text-[#9ca3af]"
                >
                  Username or Email
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="your_username"
                  className="w-full px-4 py-3 rounded-lg text-sm text-white placeholder-[#4b5563] border border-white/10 bg-white/5 focus:outline-none focus:ring-2 focus:ring-[#45E0A8]/35 focus:border-[#45E0A8]/50 focus:bg-white/8 transition-colors"
                  disabled={loginMutation.isPending}
                />
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="password"
                  className="text-[12px] font-semibold text-[#9ca3af]"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 pr-11 rounded-lg text-sm text-white placeholder-[#4b5563] border border-white/10 bg-white/5 focus:outline-none focus:ring-2 focus:ring-[#45E0A8]/35 focus:border-[#45E0A8]/50 focus:bg-white/8 transition-colors"
                    disabled={loginMutation.isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9A9AA8] hover:text-white transition-colors"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Forgot password link — grey: Sign In is this surface's single mint action */}
              <div className="flex justify-end -mt-2">
                <button
                  type="button"
                  onClick={() => { setForgotOpen(true); setFormError(null); }}
                  className="text-[11px] text-[#9A9AA8] hover:text-white underline transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              {/* Form error — grey stamp, never red (signup.md) */}
              {formError && (
                <p className="text-[12px] text-[#9A9AA8] text-center -mt-1" role="alert">{formError}</p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="flex items-center justify-center gap-2 w-full px-5 py-3.5 rounded-lg font-bold text-sm text-black transition-opacity hover:opacity-85 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "#45E0A8" }}
              >
                {loginMutation.isPending ? (
                  <><Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> Signing in…</>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>
          ) : (
            /* ── Forgot password form ── */
            <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4" noValidate>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setForgotOpen(false); setForgotSent(false); setForgotIdent(""); }}
                  className="text-[#6b7280] hover:text-white transition-colors"
                  aria-label="Back to login"
                >
                  ← Back
                </button>
                <span className="text-sm font-semibold text-white">Reset Password</span>
              </div>

              {forgotSent ? (
                <div className="px-4 py-3 rounded-xl bg-[#45E0A8]/10 border border-[#45E0A8]/30 text-[12px] text-[#45E0A8] text-center">
                  If an account exists for that username or email, a reset link has been sent.
                </div>
              ) : (
                <>
                  <p className="text-[12px] text-[#9ca3af]">
                    Enter your username or email and we'll send you a password reset link.
                  </p>
                  <input
                    type="text"
                    autoComplete="username"
                    value={forgotIdentifier}
                    onChange={(e) => setForgotIdent(e.target.value)}
                    placeholder="Username or email"
                    className="w-full px-4 py-3 rounded-lg text-sm text-white placeholder-[#4b5563] border border-white/10 bg-white/5 focus:outline-none focus:ring-2 focus:ring-[#45E0A8]/35 focus:border-[#45E0A8]/50 transition-colors"
                    disabled={requestResetMutation.isPending}
                  />
                  <button
                    type="submit"
                    disabled={requestResetMutation.isPending || !forgotIdentifier.trim()}
                    className="flex items-center justify-center gap-2 w-full px-5 py-3.5 rounded-lg font-bold text-sm text-black transition-opacity hover:opacity-85 disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: "#45E0A8" }}
                  >
                    {requestResetMutation.isPending ? (
                      <><Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> Sending…</>
                    ) : (
                      "Send Reset Link"
                    )}
                  </button>
                </>
              )}
            </form>
          )}

          {/* ── Divider ── */}
          {!forgotOpen && (
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[11px] text-[#4b5563] font-medium">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          )}

          {/* ── Discord login ── */}
          {!forgotOpen && (
            <a
              href={loginUrl}
              onClick={handleDiscordClick}
              aria-disabled={isDiscordRedirecting}
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3.5 rounded-lg font-bold text-sm text-white transition-opacity hover:opacity-85"
              style={{
                backgroundColor: "#1E1E26", border: "1px solid rgba(255,255,255,0.14)",
                opacity: isDiscordRedirecting ? 0.75 : 1,
                pointerEvents: isDiscordRedirecting ? "none" : "auto",
              }}
            >
              {isDiscordRedirecting ? (
                <><Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> Redirecting to Discord…</>
              ) : (
                <><DiscordIcon size={18} /> Continue with Discord</>
              )}
            </a>
          )}

          {/* ── Sign Up link — grey: Sign In keeps the surface's single mint action ── */}
          {!forgotOpen && (
            <p className="text-center text-[12px] text-[#9A9AA8] mt-5">
              Don't have an account?{" "}
              <a
                href="/#pricing"
                className="font-semibold text-white underline hover:text-[#45E0A8] transition-colors"
              >
                Sign Up
              </a>
            </p>
          )}

          {/* ── Disclaimer — legible grey, full RG language ── */}
          <p className="text-center text-[11px] text-[#9A9AA8] mt-6">
            By signing in you agree to gamble responsibly. For informational purposes only. 21+.
            Gambling problem? Call 1-800-GAMBLER.
          </p>
        </div>
      </div>
    </div>
  );
}
