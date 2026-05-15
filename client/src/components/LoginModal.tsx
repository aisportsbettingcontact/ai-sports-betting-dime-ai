/**
 * LoginModal — reusable sign-in modal for ModelProjections, BettingSplits, and any other page.
 *
 * Uses trpc.appUsers.login (username/password) — same mutation as Home.tsx.
 * On success: calls onSuccess() so the parent can refetch auth state.
 * On close: calls onClose().
 *
 * [FIX 2026-05-12] Created to fix broken Sign In button that was calling
 * setLocation('/login') which redirects to /feed — doing nothing visible.
 *
 * [FIX 2026-05-14] iOS Safari "string did not match expected pattern" — DEFINITIVE FIX:
 *
 * Safari's AutoFill heuristic runs a multi-signal scan on every input in the
 * DOM. ANY of the following signals can cause it to classify a text input as
 * "email-type" and apply email pattern validation (requires @) BEFORE any JS
 * fires — even on a <div>, even with noValidate, even with onInvalid handlers:
 *
 *   SIGNAL 1 — Label text contains "email" or "e-mail"
 *   SIGNAL 2 — Placeholder contains "email" ("@username" is fine)
 *   SIGNAL 3 — aria-label contains "email"
 *   SIGNAL 4 — autoComplete="username" (iOS 17+: treated as email field when
 *               adjacent to a password field)
 *   SIGNAL 5 — name="username" + adjacent name="password" (email login pattern)
 *   SIGNAL 6 — Dynamic type switching (type={show ? "text" : "password"})
 *               causes Safari to re-run its heuristic on the sibling username
 *               field, sometimes triggering email validation retroactively
 *   SIGNAL 7 — autoFocus on username field triggers AutoFill scan on mount
 *
 * DEFINITIVE FIX (all 7 signals eliminated):
 *   1. <div role="form"> — constraint validation API is form-element-only
 *   2. Label: "Username" (no "email" keyword)
 *   3. aria-label: "Username" (no "email" keyword)
 *   4. autoComplete="off" on username (not "username" — avoids Signal 4)
 *   5. No name attribute on either field (avoids Signal 5)
 *   6. Password: ALWAYS type="password", use CSS -webkit-text-security for show/hide
 *   7. No autoFocus (avoids Signal 7)
 */
import { useState } from "react";
import { Eye, EyeOff, LogIn, Loader2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ForgotPasswordModal } from "./ForgotPasswordModal";
import { LoginAttemptBanner } from "./LoginAttemptBanner";

interface LoginModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export function LoginModal({ onClose, onSuccess }: LoginModalProps) {
  const [credential, setCredential] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [loginFailureTrigger, setLoginFailureTrigger] = useState(0);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const loginMutation = trpc.appUsers.login.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Welcome back${data.user?.username ? `, @${data.user.username}` : ""}!`);
        onClose();
        onSuccess?.();
        // Reload to refresh auth state across the page
        setTimeout(() => window.location.reload(), 300);
      }
    },
    onError: (err) => {
      setLoginFailureTrigger(prev => prev + 1);
      // Server throws TRPCError with UNAUTHORIZED/FORBIDDEN on bad credentials
      const msg = err.message ?? "Login failed. Please try again.";
      if (msg.includes("Invalid credentials")) {
        toast.error("Invalid username or password.");
      } else if (msg.includes("expired")) {
        toast.error("Your account has expired. Contact support.");
      } else if (msg.includes("disabled")) {
        toast.error("Account access is disabled. Contact support.");
      } else {
        toast.error(msg);
      }
    },
  });

  // [FIX] Pure JS submit handler — NOT attached to a <form> onSubmit.
  // This bypasses Safari's pre-submit validation entirely.
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

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-foreground tracking-wide">Member Sign In</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/*
          [FIX] <div> instead of <form> — eliminates ALL browser constraint validation.
          Safari's pattern/email validation only fires on <form> elements.
          A <div> is 100% invisible to Safari's validation engine.
          Keyboard submission is handled via onKeyDown on each input.
          Screen readers: role="form" + aria-label preserve accessibility semantics.
        */}
        <div
          role="form"
          aria-label="Member Sign In"
          className="px-5 py-5 space-y-4"
        >
          <div className="space-y-1">
            {/*
              [FIX] Label changed from "Username or Email" to "Username".
              Safari's AutoFill heuristic scans label text for the keyword "email".
              When found, it misclassifies the field as email-type and applies
              email pattern validation. Removing "email" from the label prevents
              this misclassification entirely. Users can still enter their email
              address — the backend accepts both username and email.
            */}
            <label
              htmlFor="login-username"
              className="text-xs font-semibold tracking-wider uppercase text-muted-foreground"
            >
              Username
            </label>
            {/*
              [FIX Signal 4] autoComplete="off" — not "username" (iOS 17+ treats
                "username" as email field when adjacent to password field).
              [FIX Signal 5] No name attribute — removes username+password
                adjacency pattern that Safari uses to infer email login.
              [FIX Signal 7] No autoFocus — prevents AutoFill scan on mount.
            */}
            <input
              type="text"
              id="login-username"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="@username"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-required="true"
              aria-label="Username"
              onInvalid={suppressInvalid}
              className="w-full px-3 py-2.5 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="login-password"
              className="text-xs font-semibold tracking-wider uppercase text-muted-foreground"
            >
              Password
            </label>
            <div className="relative">
              {/*
                [FIX Signal 6] ALWAYS type="password" — NEVER switch to type="text".
                Dynamic type switching causes Safari to re-run its heuristic on
                the sibling username field, triggering email validation.
                Show/hide uses CSS -webkit-text-security instead:
                  hidden: default password dots (type="password" default)
                  shown:  -webkit-text-security: none (plain text visible)
                [FIX Signal 5] No name attribute — removes adjacency pattern.
              */}
              <input
                type="password"
                id="login-password"
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
                style={showPassword ? { WebkitTextSecurity: "none" } as React.CSSProperties : undefined}
                className="w-full px-3 py-2.5 pr-10 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
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

          {/* [FIX] type="button" — not type="submit". No form to submit. */}
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
  );
}
