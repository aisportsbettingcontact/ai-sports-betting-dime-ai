// Home — Paywall landing page with Discord-only login
// Unauthenticated users see the landing with a "Sign in with Discord" button.
// Authenticated users are redirected to /feed.

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { BarChart3, TrendingUp, Zap, Shield, Loader2 } from "lucide-react";
import { useAppAuth } from "@/_core/hooks/useAppAuth";

// Discord brand icon (inline SVG)
function DiscordIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: TrendingUp,
    title: "Spread & Total Projections",
    desc: "AI-generated model lines for every game — compare directly against the book.",
  },
  {
    icon: Zap,
    title: "Real-Time Model Edges",
    desc: "Instantly see where the model disagrees with the market and by how much.",
  },
  {
    icon: Shield,
    title: "Exclusive Member Access",
    desc: "Private, invite-only tool. Projections are refreshed daily from our model.",
  },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const { appUser, loading: authLoading } = useAppAuth();

  // Auth loading timeout — if auth check takes > 4s, show the login page anyway
  const [authTimedOut, setAuthTimedOut] = useState(false);
  useEffect(() => {
    if (!authLoading) return;
    const timer = setTimeout(() => setAuthTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  // Redirect authenticated users to the feed
  useEffect(() => {
    if (!authLoading && appUser) {
      setLocation("/feed");
    }
  }, [appUser, authLoading, setLocation]);

  // Show error messages from Discord OAuth callback
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const discordError = searchParams.get("discord_error");
  const discordUser  = searchParams.get("discord_user");

  const errorMessages: Record<string, string> = {
    no_account:       discordUser
      ? `No account found for @${discordUser}. Contact the owner to get access.`
      : "No account found for your Discord. Contact the owner to get access.",
    access_disabled:  "Your account access has been disabled. Contact the owner.",
    account_expired:  "Your account subscription has expired. Contact the owner.",
    discord_cancelled: "Discord sign-in was cancelled.",
    state_expired:    "Login session expired. Please try again.",
    state_mismatch:   "Invalid login state. Please try again.",
    token_exchange_failed: "Discord authentication failed. Please try again.",
    profile_fetch_failed:  "Could not fetch your Discord profile. Please try again.",
    timeout:               "Discord sign-in timed out. Please try again.",
    server_error:          "A server error occurred during sign-in. Please try again.",
    db_unavailable:        "Database unavailable. Please try again in a moment.",
    not_in_guild:     discordUser
      ? `@${discordUser} is not in the Prez Bets Discord server. Join the server first, then try again.`
      : "You are not in the Prez Bets Discord server. Join the server first, then try again.",
    missing_role:     discordUser
      ? `@${discordUser} does not have the AI Model Sub role. Purchase a subscription to get access.`
      : "You do not have the AI Model Sub role in the Prez Bets Discord server. Purchase a subscription to get access.",
  };

  const [isRedirecting, setIsRedirecting] = useState(false);

  // prompt=none: if the user is already authenticated with Discord in this browser,
  // Discord skips the consent screen entirely and redirects back immediately.
  // Read returnPath from URL params — RequireAuth passes the original page URL here
  // so after Discord login, the user lands back on the page they were trying to visit.
  const returnPath = searchParams.get("returnPath") ?? "/feed";
  // No prompt param — server defaults to "consent" which always shows the Discord screen.
  // This ensures users with expired Discord sessions are not silently rejected.
  const loginUrl = `/api/auth/discord-login/connect?returnPath=${encodeURIComponent(returnPath)}`;

  function handleDiscordClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (isRedirecting) {
      e.preventDefault();
      return;
    }
    setIsRedirecting(true);
    // Safety reset after 15s in case user cancels or Discord returns an error
    setTimeout(() => setIsRedirecting(false), 15_000);
  }

  // [PERF] No inline loading state — return null so the HTML shell covers the auth wait.
  // The HTML shell (index.html) stays visible until React renders real content into #root.
  // Returning null here means zero double loading screen on the /login route.
  if (authLoading && !authTimedOut) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <span className="text-sm font-black tracking-widest uppercase text-white">PREZ BETS</span>
          <span className="text-border text-sm">|</span>
          <span className="text-sm font-medium tracking-widest uppercase text-muted-foreground">
            AI MODEL PROJECTIONS
          </span>
        </div>
      </header>

      {/* ── Hero + Feature cards ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 max-w-2xl mx-auto w-full">
        {/* Logo */}
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-primary/10 border border-primary/20 mb-6">
          <BarChart3 className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-black tracking-widest uppercase text-white text-center mb-2">
          Model Projections
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-10 max-w-sm">
          AI-powered sports betting model projections — spreads, totals, and edges.
        </p>

        {/* Discord error banner */}
        {discordError && (
          <div className="w-full mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400 text-center">
            {errorMessages[discordError] ?? "Sign-in failed. Please try again."}
          </div>
        )}

        {/* Feature list */}
        <div className="w-full space-y-3 mb-10">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-4 px-5 py-4 rounded-xl bg-secondary/50 border border-border"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Discord Sign In CTA */}
        <div className="w-full max-w-xs space-y-3">
          <a
            href={loginUrl}
            onClick={handleDiscordClick}
            aria-disabled={isRedirecting}
            className="flex items-center justify-center gap-3 w-full px-5 py-3.5 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.98] shadow-lg"
            style={{
              backgroundColor: "#5865F2",
              opacity: isRedirecting ? 0.75 : 1,
              pointerEvents: isRedirecting ? "none" : "auto",
              cursor: isRedirecting ? "default" : "pointer",
            }}
          >
            {isRedirecting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Discord…</>
              : <><DiscordIcon size={20} /> Sign in with Discord</>
            }
          </a>
          {!isRedirecting && (
            <p className="text-center text-xs text-muted-foreground/50">
              Access requires the AI Model Sub role in the Prez Bets Discord server.
            </p>
          )}
          {isRedirecting && (
            <p className="text-center text-xs text-muted-foreground/50 animate-pulse">
              Opening Discord authentication…
            </p>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground/40">
          By signing in you agree to gamble responsibly. This tool is for informational purposes only.
        </p>
      </main>
    </div>
  );
}
