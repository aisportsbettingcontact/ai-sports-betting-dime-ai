/**
 * Home.tsx — Login page (/login)
 *
 * Layout:
 *   1. Logo + site name
 *   2. Username / Password form  (calls trpc.appUsers.login)
 *   3. Forgot Password link      (calls trpc.appUsers.requestPasswordReset)
 *   4. Divider
 *   5. Login with Discord button (for lifetime / Discord members)
 *   6. Sign Up link              → /#pricing (Stripe checkout creates the account)
 *
 * Error handling:
 *   - Discord OAuth errors shown as a banner (from ?discord_error= URL param)
 *   - Form errors shown inline below the submit button
 *   - Transient server errors auto-retry after 5s
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye, EyeOff } from "lucide-react";
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
      const returnPath = searchParams.get("returnPath") ?? "/feed";
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
  const returnPath   = searchParams.get("returnPath") ?? "/feed";
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
      identifier: identifier.trim(),
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
      identifier: forgotIdentifier.trim(),
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
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: "#050810" }}
    >
      {/* ── Card ── */}
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 p-7 flex flex-col gap-6"
        style={{ background: "rgba(10,14,22,0.97)" }}
      >
        {/* ── Logo + title ── */}
        <div className="flex flex-col items-center gap-3">
          <a href="/" aria-label="Home">
            <img
              src="/manus-storage/logo-aisportsbetting_429c188f.jpg"
              alt="AI Sports Betting"
              className="w-14 h-14 rounded-xl object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </a>
          <div className="text-center">
            <h1 className="text-lg font-black text-white tracking-tight">AI Sports Betting</h1>
            <p className="text-[12px] text-[#6b7280] mt-0.5">Sign in to your account</p>
          </div>
        </div>

        {/* ── Discord error banner ── */}
        {discordErrorMsg && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[12px] text-red-400 text-center space-y-1.5">
            <p>{discordErrorMsg}</p>
            {isTransientError && retryCountdown !== null && (
              <p className="text-red-400/70 animate-pulse">Retrying in {retryCountdown}s…</p>
            )}
            {isTransientError && (
              <button
                onClick={() => { window.location.href = loginUrl; }}
                className="text-xs underline text-red-300 hover:text-red-200 transition-colors"
              >
                Retry now
              </button>
            )}
          </div>
        )}

        {/* ── Username / Password form ── */}
        {!forgotOpen ? (
          <form onSubmit={handleFormSubmit} className="flex flex-col gap-3" noValidate>
            {/* Identifier */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="identifier" className="text-[12px] font-semibold text-[#9ca3af]">
                Username or Email
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="your_username"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white placeholder-[#4b5563] border border-white/10 bg-white/5 focus:outline-none focus:border-[#39FF14]/50 focus:bg-white/8 transition-colors"
                disabled={loginMutation.isPending}
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[12px] font-semibold text-[#9ca3af]">
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
                  className="w-full px-3.5 py-2.5 pr-10 rounded-lg text-sm text-white placeholder-[#4b5563] border border-white/10 bg-white/5 focus:outline-none focus:border-[#39FF14]/50 focus:bg-white/8 transition-colors"
                  disabled={loginMutation.isPending}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-[#9ca3af] transition-colors"
                  tabIndex={-1}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Forgot password link */}
            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={() => { setForgotOpen(true); setFormError(null); }}
                className="text-[11px] text-[#39FF14] hover:text-[#39FF14]/80 transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {/* Form error */}
            {formError && (
              <p className="text-[12px] text-red-400 text-center -mt-1">{formError}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-lg font-bold text-sm text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "#39FF14" }}
            >
              {loginMutation.isPending ? (
                <><Loader2 size={15} className="animate-spin" /> Signing in…</>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        ) : (
          /* ── Forgot password form ── */
          <form onSubmit={handleForgotSubmit} className="flex flex-col gap-3" noValidate>
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
              <div className="px-4 py-3 rounded-xl bg-[#39FF14]/10 border border-[#39FF14]/30 text-[12px] text-[#39FF14] text-center">
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
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white placeholder-[#4b5563] border border-white/10 bg-white/5 focus:outline-none focus:border-[#39FF14]/50 transition-colors"
                  disabled={requestResetMutation.isPending}
                />
                <button
                  type="submit"
                  disabled={requestResetMutation.isPending || !forgotIdentifier.trim()}
                  className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-lg font-bold text-sm text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: "#39FF14" }}
                >
                  {requestResetMutation.isPending ? (
                    <><Loader2 size={15} className="animate-spin" /> Sending…</>
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
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[11px] text-[#4b5563] font-medium">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
        )}

        {/* ── Discord login ── */}
        {!forgotOpen && (
          <div className="flex flex-col gap-2">
            <a
              href={loginUrl}
              onClick={handleDiscordClick}
              aria-disabled={isDiscordRedirecting}
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3 rounded-lg font-bold text-sm text-white transition-all active:scale-[0.98]"
              style={{
                backgroundColor: "#5865F2",
                opacity: isDiscordRedirecting ? 0.75 : 1,
                pointerEvents: isDiscordRedirecting ? "none" : "auto",
              }}
            >
              {isDiscordRedirecting ? (
                <><Loader2 size={15} className="animate-spin" /> Redirecting to Discord…</>
              ) : (
                <><DiscordIcon size={18} /> Login with Discord</>
              )}
            </a>
            <p className="text-center text-[11px] text-[#4b5563] leading-relaxed">
              For lifetime access members and Discord subscribers
            </p>
          </div>
        )}

        {/* ── Sign Up link ── */}
        {!forgotOpen && (
          <p className="text-center text-[12px] text-[#6b7280]">
            Don't have an account?{" "}
            <a
              href="/#pricing"
              className="font-semibold transition-colors"
              style={{ color: "#39FF14" }}
            >
              Sign Up
            </a>
          </p>
        )}
      </div>

      {/* ── Disclaimer ── */}
      <p className="mt-5 text-center text-[11px] text-[#374151] max-w-xs">
        By signing in you agree to gamble responsibly. This tool is for informational purposes only.
      </p>
    </div>
  );
}
