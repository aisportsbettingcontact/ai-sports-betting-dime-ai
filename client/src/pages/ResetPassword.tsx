/**
 * ResetPassword page
 *
 * Accessed via the reset link: /reset-password?token=<rawToken>&uid=<userId>
 *
 * Flow:
 *   1. Parse token + uid from URL params
 *   2. Show password + confirm password form
 *   3. On submit: call appUsers.resetPassword mutation
 *   4. On success: redirect to home with success toast
 *   5. On error: show specific error message (expired, invalid, etc.)
 *
 * iOS SAFARI FIX (same as LoginModal / ForgotPasswordModal):
 *   Safari 15-17 fires native constraint validation on <form> elements BEFORE
 *   the onSubmit event, even when noValidate is set. This causes "The string did
 *   not match the expected pattern." on password fields when AutoFill injects
 *   credentials. The fix is to replace <form> with <div role="form"> and use
 *   type="button" + onClick instead of type="submit".
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";

/** Suppress any residual browser validation events — belt-and-suspenders. */
const suppressInvalid = (e: React.InvalidEvent<HTMLInputElement>) => {
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.nativeEvent.stopImmediatePropagation === "function") {
    e.nativeEvent.stopImmediatePropagation();
  }
};

export default function ResetPassword() {
  const [, navigate] = useLocation();

  // Parse URL params
  const params = new URLSearchParams(window.location.search);
  const rawToken = params.get("token") ?? "";
  const uidStr = params.get("uid") ?? "";
  const uid = parseInt(uidStr, 10);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate URL params on mount
  const paramsValid =
    rawToken.length === 64 &&
    /^[0-9a-fA-F]+$/.test(rawToken) &&
    !isNaN(uid) &&
    uid > 0;

  useEffect(() => {
    console.log("[ResetPassword] Mounted | uid=%s tokenLength=%d paramsValid=%s",
      uid, rawToken.length, paramsValid);
  }, []);

  const resetPassword = trpc.appUsers.resetPassword.useMutation({
    onSuccess: () => {
      setSuccess(true);
      console.log("[ResetPassword] Password reset successful | uid=%s", uid);
      toast.success("Password reset successfully! You can now sign in.");
      setTimeout(() => navigate("/"), 2500);
    },
    onError: (err) => {
      console.error("[ResetPassword] Reset error:", err.message);
    },
  });

  // [FIX] Pure JS handler — NOT attached to a <form> onSubmit.
  // Called by the button's onClick and by onKeyDown Enter on each input.
  function handleReset() {
    setValidationError(null);

    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setValidationError("Passwords do not match.");
      return;
    }

    console.log("[ResetPassword] Submitting reset | uid=%s", uid);
    resetPassword.mutate({ uid, token: rawToken, password });
  }

  // Allow Enter key to submit from either input
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleReset();
    }
  }

  // Invalid link params
  if (!paramsValid) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Invalid Reset Link</h1>
          <p className="text-white/60 text-sm mb-6">
            This password reset link is invalid or malformed. Please request a new one.
          </p>
          <Button
            onClick={() => navigate("/")}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Back to Sign In
          </Button>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Password Reset</h1>
          <p className="text-white/60 text-sm mb-2">
            Your password has been updated. All existing sessions have been signed out.
          </p>
          <p className="text-white/40 text-xs">Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  const serverError = resetPassword.error?.message;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-xl p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Reset Password</h1>
            <p className="text-white/50 text-xs">Enter your new password below</p>
          </div>
        </div>

        {/*
          [FIX] <div role="form"> instead of <form>.
          Safari's constraint validation API only fires on <form> elements.
          A <div> is 100% invisible to Safari's validation engine.
          Keyboard submission is handled via onKeyDown on each input.
          Screen readers: role="form" + aria-label preserve accessibility.
        */}
        <div
          role="form"
          aria-label="Reset Password"
          className="flex flex-col gap-4"
        >
          {/* New Password */}
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="rp-password"
              className="text-xs font-semibold tracking-widest text-white/70 uppercase"
            >
              New Password
            </Label>
            <div className="relative">
{/* [FIX] type="password" always + -webkit-text-security for show/hide; no name attr (removes Safari adjacency pattern Signal 5, 6) */}
              <Input
                id="rp-password"
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                onInvalid={suppressInvalid}
                disabled={resetPassword.isPending}
                style={showPassword ? { WebkitTextSecurity: "none" } as React.CSSProperties : undefined}
                className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="rp-confirm"
              className="text-xs font-semibold tracking-widest text-white/70 uppercase"
            >
              Confirm Password
            </Label>
            <div className="relative">
{/* [FIX] type="password" always + -webkit-text-security for show/hide; no name attr */}
              <Input
                id="rp-confirm"
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                onInvalid={suppressInvalid}
                disabled={resetPassword.isPending}
                style={showConfirm ? { WebkitTextSecurity: "none" } as React.CSSProperties : undefined}
                className="bg-white/5 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                tabIndex={-1}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Validation / Server error */}
          {(validationError || serverError) && (
            <div className="flex items-start gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{validationError ?? serverError}</span>
            </div>
          )}

          {/* [FIX] type="button" + onClick — not type="submit". No <form> to submit. */}
          <Button
            type="button"
            onClick={handleReset}
            disabled={resetPassword.isPending || !password || !confirmPassword}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white mt-1"
          >
            {resetPassword.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Resetting...
              </span>
            ) : (
              "Reset Password"
            )}
          </Button>

          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-white/40 hover:text-white/70 text-xs text-center transition-colors"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
