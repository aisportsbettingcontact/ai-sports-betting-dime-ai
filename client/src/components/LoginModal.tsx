/**
 * LoginModal — reusable sign-in modal for ModelProjections, BettingSplits, and any other page.
 *
 * Uses trpc.appUsers.login (username/password) — same mutation as Home.tsx.
 * On success: calls onSuccess() so the parent can refetch auth state.
 * On close: calls onClose().
 *
 * [FIX 2026-05-12] Created to fix broken Sign In button that was calling
 * setLocation('/login') which redirects to /feed — doing nothing visible.
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!credential.trim() || !password.trim()) {
      toast.error("Please enter your username/email and password.");
      return;
    }
    loginMutation.mutate({
      emailOrUsername: credential.trim(),
      password,
      stayLoggedIn,
    });
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

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className="px-5 py-5 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Username or Email
            </label>
            <input
              type="text"
              id="login-username"
              name="username"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="@username or email"
              autoComplete="username"
              autoFocus
              aria-required="true"
              onInvalid={(e) => e.preventDefault()}
              className="w-full px-3 py-2.5 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                id="login-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-required="true"
                onInvalid={(e) => e.preventDefault()}
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
          <button
            type="submit"
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
        </form>

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
