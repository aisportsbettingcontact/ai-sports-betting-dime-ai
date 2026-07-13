/**
 * SubscribeSuccess.tsx
 *
 * Post-checkout success page. Stripe redirects here with:
 *   ?session_id=cs_live_...&plan=monthly|annual
 *
 * Flow:
 *   1. Parse session_id from URL
 *   2. Call stripe.getCheckoutSessionUser to find the account created by the webhook
 *   3a. If pendingSetup=true (new user): show "Set Up Your Account" form (email + password)
 *   3b. If pendingSetup=false (existing user): show "You're In" confirmation + "Enter Platform" CTA
 *   4. On form submit: call stripe.completeAccountSetup → activates account + grants Discord role
 *   5. After setup: show confirmation + "Enter Platform" CTA
 *
 * Password requirements (enforced client + server):
 *   - Minimum 8 characters
 *   - At least 1 uppercase letter (A-Z)
 *   - At least 1 lowercase letter (a-z)
 *   - At least 1 special character (!@#$%^&* etc.)
 */
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";

// ─── Password validation ──────────────────────────────────────────────────────
interface PasswordCheck {
  label: string;
  pass: boolean;
}

function getPasswordChecks(pw: string): PasswordCheck[] {
  return [
    { label: "At least 8 characters", pass: pw.length >= 8 },
    { label: "1 uppercase letter (A-Z)", pass: /[A-Z]/.test(pw) },
    { label: "1 lowercase letter (a-z)", pass: /[a-z]/.test(pw) },
    { label: "1 special character (!@#$%^&*...)", pass: /[^A-Za-z0-9]/.test(pw) },
  ];
}

function isPasswordValid(pw: string): boolean {
  return getPasswordChecks(pw).every((c) => c.pass);
}

// ─── Feature list ─────────────────────────────────────────────────────────────
function FeatureList() {
  const features = [
    "AI model projections across MLB, NBA, NFL, NHL",
    "Betting splits & public money percentages",
    "No-vig fair odds & ROI edge signals",
    "Live game feed with real-time updates",
    "Bet tracker & performance analytics",
  ];
  return (
    <div
      className="rounded-xl border border-white p-5 mb-6 text-left"
      style={{ background: "#000000" }}
    >
      <p className="text-[11px] font-bold text-white tracking-widest uppercase mb-3">
        What you now have access to
      </p>
      <ul className="space-y-2">
        {features.map((item) => (
          <li key={item} className="flex items-center gap-2.5 text-[13px] text-white">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
              <circle cx="6" cy="6" r="6" fill="transparent" />
              <path d="M3.5 6l1.8 1.8L8.5 4.5" stroke="#45E0A8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SubscribeSuccess() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const params = new URLSearchParams(window.location.search);
  const plan = params.get("plan") ?? "monthly";
  const sessionId = params.get("session_id") ?? "";

  const planLabel =
    plan === "annual" ? "Annual"
    : plan === "pro" ? "Pro"
    : plan === "sharp" ? "Sharp"
    : plan === "operator" ? "Operator"
    : "Monthly";
  const planPrice =
    plan === "annual" ? "$499.99/year"
    : plan === "pro" ? "$99/month"
    : plan === "sharp" ? "$249/month"
    : plan === "operator" ? "$499/month"
    : "$99.99/month";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);
  const [completedUsername, setCompletedUsername] = useState<string | null>(null);

  const passwordChecks = getPasswordChecks(password);
  const passwordValid = isPasswordValid(password);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const { data: pendingUser, isLoading: isLookingUp, error: lookupError } =
    trpc.stripe.getCheckoutSessionUser.useQuery(
      { sessionId },
      {
        enabled: !!sessionId,
        retry: 5,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 0,
      }
    );

  useEffect(() => {
    if (pendingUser?.pendingEmail && !email) {
      setEmail(pendingUser.pendingEmail);
    }
  }, [pendingUser?.pendingEmail, email]);

  useEffect(() => {
    console.log(`[SubscribeSuccess] [INPUT] plan=${plan} session_id=${sessionId}`);
    utils.stripe.getSubscription.invalidate();
  }, [utils, plan, sessionId]);

  const completeSetup = trpc.stripe.completeAccountSetup.useMutation({
    onSuccess: (data) => {
      console.log(`[SubscribeSuccess] [OUTPUT] Account setup complete username=${data.username} alreadySetup=${data.alreadySetup}`);
      setCompletedUsername(data.username);
      setSetupComplete(true);
      utils.stripe.getSubscription.invalidate();
    },
    onError: (err) => {
      console.error(`[SubscribeSuccess] [VERIFY] FAIL — setup error: ${err.message}`);
      setFormError(err.message);
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      if (!emailValid) { setFormError("Please enter a valid email address."); return; }
      if (!passwordValid) { setFormError("Please meet all password requirements."); return; }
      if (!sessionId) { setFormError("Missing session ID. Please contact support."); return; }
      console.log(`[SubscribeSuccess] [STEP] Submitting account setup sessionId=${sessionId} email=${email}`);
      completeSetup.mutate({ sessionId, email, password });
    },
    [sessionId, email, password, emailValid, passwordValid, completeSetup]
  );

  // No session ID
  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#000000" }}>
        <div className="max-w-md w-full text-center">
          <p className="text-white mb-4">No session ID found. If you just subscribed, please check your email for confirmation.</p>
          <button onClick={() => navigate("/")} className="text-[13px] text-[#45E0A8] hover:underline">Back to home</button>
        </div>
      </div>
    );
  }

  // Loading
  if (isLookingUp) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#000000" }}>
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full border-2 border-transparent border-t-[#45E0A8] animate-spin mx-auto mb-4" />
          <p className="text-white text-sm">Confirming your subscription...</p>
          <p className="text-white text-xs mt-2">This usually takes a few seconds.</p>
        </div>
      </div>
    );
  }

  // Lookup error
  if (lookupError && !pendingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#000000" }}>
        <div className="max-w-md w-full text-center">
          <p className="text-white mb-2 font-semibold">Could not confirm your subscription.</p>
          <p className="text-white text-sm mb-4">Your payment was processed. Please contact support with your order reference below.</p>
          <button onClick={() => navigate("/")} className="mt-4 text-[13px] text-[#45E0A8] hover:underline">Back to home</button>
        </div>
      </div>
    );
  }

  // Existing user or setup complete — show confirmation
  const isExistingUser = pendingUser && !pendingUser.pendingSetup;
  const showConfirmation = isExistingUser || setupComplete;

  if (showConfirmation) {
    const username = completedUsername ?? pendingUser?.username ?? null;
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#000000" }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-md w-full text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{
              background: "transparent",
              border: "2px solid #45E0A8",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <path d="M8 18l7 7L28 11" stroke="#45E0A8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.4 }}>
            <h1 className="text-3xl font-black text-white mb-2" style={{ letterSpacing: "-0.03em" }}>You're In.</h1>
            {username && <p className="text-[#45E0A8] font-semibold text-sm mb-1">@{username}</p>}
            <p className="text-white text-base mb-1">
              Your <span className="text-white font-semibold">{planLabel} Plan</span> is now active.
            </p>
            <p className="text-white text-sm mb-8">{planPrice} · Full access to all models, projections, and edge tools.</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.4 }}>
            <FeatureList />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65, duration: 0.4 }} className="flex flex-col gap-3">
            <button
              onClick={() => navigate("/feed/model/mlb")}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-bold text-sm text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{ background: "#45E0A8" }}
            >
              Enter the Platform
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button onClick={() => navigate("/")} className="text-[13px] text-white hover:text-white transition-colors">Back to home</button>
          </motion.div>

        </motion.div>
      </div>
    );
  }

  // New user — show account setup form
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: "#000000" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="max-w-md w-full"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{
              background: "transparent",
              border: "2px solid #45E0A8",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M6 14l5.5 5.5L22 8" stroke="#45E0A8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
          <h1 className="text-2xl font-black text-white mb-1" style={{ letterSpacing: "-0.03em" }}>Payment Confirmed.</h1>
          <p className="text-white text-sm">Set up your account to access the platform.</p>
          {pendingUser?.pendingUsername && (
            <p className="text-[#45E0A8] text-sm font-semibold mt-1">@{pendingUser.pendingUsername}</p>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-white p-6"
          style={{ background: "#000000" }}
        >
          <p className="text-[11px] font-bold text-white tracking-widest uppercase mb-5">Create Your Account</p>

          {/* Email */}
          <div className="mb-4">
            <label className="block text-[12px] font-semibold text-white mb-1.5">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setFormError(null); }}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white placeholder-white border outline-none transition-all"
              style={{
                background: "#000000",
                borderColor: email && !emailValid ? "#FFFFFF" : "#FFFFFF",
              }}
            />
            {email && !emailValid && (
              <p className="text-[11px] text-white mt-1">Please enter a valid email address.</p>
            )}
          </div>

          {/* Password */}
          <div className="mb-5">
            <label className="block text-[12px] font-semibold text-white mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFormError(null); }}
                placeholder="Create a strong password"
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 pr-10 rounded-lg text-sm text-white placeholder-white border outline-none transition-all"
                style={{
                  background: "#000000",
                  borderColor: password && !passwordValid ? "#FFFFFF" : "#FFFFFF",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white hover:text-white transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            {password.length > 0 && (
              <div className="mt-2.5 space-y-1">
                {passwordChecks.map((check) => (
                  <div key={check.label} className="flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0">
                      {check.pass ? (
                        <>
                          <circle cx="5" cy="5" r="5" fill="transparent" />
                          <path d="M2.5 5l1.5 1.5L7.5 3.5" stroke="#45E0A8" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                        </>
                      ) : (
                        <>
                          <circle cx="5" cy="5" r="5" fill="transparent" />
                          <path d="M3.5 3.5l3 3M6.5 3.5l-3 3" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round" />
                        </>
                      )}
                    </svg>
                    <span className={`text-[11px] ${check.pass ? "text-[#45E0A8]" : "text-white"}`}>{check.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <AnimatePresence>
            {formError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mb-4 px-3.5 py-2.5 rounded-lg border border-white text-[12px] text-white"
                style={{ background: "transparent" }}
              >
                {formError}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={!emailValid || !passwordValid || completeSetup.isPending}
            className="w-full py-3 rounded-lg font-bold text-sm text-black transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
            style={{ background: "#45E0A8" }}
          >
            {completeSetup.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-transparent border-t-black rounded-full animate-spin" />
                Setting up your account...
              </span>
            ) : (
              "Activate My Account"
            )}
          </button>

          <p className="text-[11px] text-white text-center mt-3">
            Your account will be linked to your subscription automatically.
          </p>
        </form>

        <div className="mt-4 text-center">
          <p className="text-[12px] text-white">
            <span className="text-white font-semibold">{planLabel} Plan</span> · {planPrice} · Full access
          </p>
        </div>


      </motion.div>
    </div>
  );
}
