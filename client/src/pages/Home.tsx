// Home — Paywall landing page with inline login panel
// Unauthenticated users see the landing; authenticated users are redirected to the dashboard.
//
// [FIX 2026-05-14] iOS Safari "string did not match expected pattern" fix:
//   ROOT CAUSE: The label text "Username or Email" contains the word "email".
//   Safari's AutoFill heuristic scans label text for keywords. When it finds
//   "email", it classifies the field as email-type and applies email pattern
//   validation BEFORE the submit event fires — completely ignoring noValidate.
//   "Chip" fails the email regex → "The string did not match the expected pattern".
//
//   FIX: Replace <form> with <div role="form"> + button onClick handler.
//   The browser's constraint validation API only applies to <form> elements.
//   A <div> is 100% invisible to Safari's validation engine.
//   Label changed to "Username" to remove the "email" keyword trigger.
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { BarChart3, TrendingUp, Zap, Shield, Eye, EyeOff, LogIn, Loader2, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";
import { formatMutationError } from "@/lib/errorUtils";
import { ForgotPasswordModal } from "@/components/ForgotPasswordModal";
import { LoginAttemptBanner } from "@/components/LoginAttemptBanner";

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
  const { appUser, loading: authLoading, refetch } = useAppAuth();

  // Auth loading timeout — if auth check takes > 4s, show the login page anyway
  // This prevents the infinite black spinner on slow connections or dead server instances
  const [authTimedOut, setAuthTimedOut] = useState(false);
  useEffect(() => {
    if (!authLoading) return;
    const timer = setTimeout(() => setAuthTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  // Login form state
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const [credential, setCredential] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [loginFailureTrigger, setLoginFailureTrigger] = useState(0);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Redirect authenticated users straight to the projections feed
  useEffect(() => {
    if (!authLoading && appUser) {
      setLocation("/feed");
    }
  }, [appUser, authLoading, setLocation]);

  // Close panel on outside click
  useEffect(() => {
    if (!showLoginPanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowLoginPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLoginPanel]);

  // Fire-and-forget session open — creates a user_sessions row for DAU/MAU/WAU tracking
  const openSessionMutation = trpc.metrics.openSession.useMutation();

  const loginMutation = trpc.appUsers.login.useMutation({
    onSuccess: () => {
      openSessionMutation.mutate();
      refetch();
      toast.success("Welcome back!");
      setLocation("/feed");
    },
    onError: (e) => {
      setLoginFailureTrigger(prev => prev + 1);
      toast.error(formatMutationError(e));
    },
  });

  // [FIX] Pure JS handler — NOT attached to a <form> onSubmit.
  // Bypasses Safari's pre-submit validation engine entirely.
  const handleLogin = () => {
    if (!credential.trim() || !password.trim()) {
      toast.error("Please enter your username and password.");
      return;
    }
    loginMutation.mutate({
      emailOrUsername: credential.trim(),
      password,
      stayLoggedIn,
    });
  };

  // Allow Enter key in either input to trigger login
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loginMutation.isPending) {
      e.preventDefault();
      handleLogin();
    }
  };

  // Belt-and-suspenders: suppress any residual invalid events
  const suppressInvalid = (e: React.InvalidEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.nativeEvent as Event).stopImmediatePropagation();
  };

  // Show spinner only while loading AND within the 4-second timeout window
  if (authLoading && !authTimedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
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

        <button type="button" onClick={() => setShowLoginPanel(true)}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground border border-border hover:text-foreground hover:border-primary/40 transition-colors"
        >
          Sign in
        </button>
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

        {/* CTA */}
        <button type="button" onClick={() => setShowLoginPanel(true)}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-sm text-white bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          <LogIn className="w-4 h-4" />
          Sign in to continue
          <ChevronRight className="w-4 h-4 ml-auto" />
        </button>

        <p className="mt-5 text-center text-xs text-muted-foreground/50">
          By signing in you agree to gamble responsibly. This tool is for informational purposes only.
        </p>
      </main>

      {/* ── Inline Login Panel (slide-in overlay) ── */}
      {showLoginPanel && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0">
          <div
            ref={panelRef}
            className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold text-foreground tracking-wide">Member Sign In</span>
              </div>
              <button type="button" onClick={() => setShowLoginPanel(false)}
                className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/*
              [FIX] <div role="form"> instead of <form>.
              Safari's constraint validation API only fires on <form> elements.
              A <div> is completely invisible to Safari's validation engine.
              Keyboard submission handled via onKeyDown on each input.
            */}
            <div
              role="form"
              aria-label="Member Sign In"
              className="px-5 py-5 space-y-4"
            >
              <div className="space-y-1">
                {/*
                  [FIX] Label changed from "Username or Email" to "Username".
                  Safari scans label text for the keyword "email" and misclassifies
                  the field as email-type, applying email pattern validation.
                  Removing "email" from the label prevents this misclassification.
                  Users can still enter their email — the backend accepts both.
                */}
                <label
                  htmlFor="home-login-username"
                  className="text-xs font-semibold tracking-wider uppercase text-muted-foreground"
                >
                  Username
                </label>
                <input
                  type="text"
                  id="home-login-username"
                  name="username"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="@username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  aria-required="true"
                  aria-label="Username"
                  onInvalid={suppressInvalid}
                  className="w-full px-3 py-2.5 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="home-login-password"
                  className="text-xs font-semibold tracking-wider uppercase text-muted-foreground"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    id="home-login-password"
                    name="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-required="true"
                    onInvalid={suppressInvalid}
                    className="w-full px-3 py-2.5 pr-10 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Stay logged in */}
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div
                  onClick={() => setStayLoggedIn(!stayLoggedIn)}
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    stayLoggedIn
                      ? "bg-primary border-primary"
                      : "bg-secondary border-border hover:border-primary/50"
                  }`}
                >
                  {stayLoggedIn && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                      <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">Stay logged in</span>
              </label>

              <LoginAttemptBanner failureTrigger={loginFailureTrigger} />

              {/* [FIX] type="button" + onClick — not type="submit". No <form> to submit. */}
              <button
                type="button"
                onClick={handleLogin}
                disabled={loginMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loginMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                {loginMutation.isPending ? "Signing in…" : "Sign In"}
              </button>

              {/* Forgot password link */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors underline-offset-2 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {/* Forgot Password Modal */}
            <ForgotPasswordModal
              open={showForgotPassword}
              onClose={() => setShowForgotPassword(false)}
            />

            <div className="px-5 pb-4 text-center">
              <p className="text-xs text-muted-foreground/50">
                This tool is for informational purposes only. Gamble responsibly.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
