/**
 * WaitlistCapture.tsx
 *
 * Replaces the PricingCTA and PremiumValueAnchor sections on the landing page
 * while the platform is in pre-launch / waitlist mode.
 *
 * Design goals:
 *   - Premium, exclusive, invite-only feel
 *   - FOMO-inducing copy ("Limited access", "Spots reserved")
 *   - Clean email capture form with optional name fields
 *   - Animated gradient border on the card
 *   - UTM params captured automatically from URL
 *   - Duplicate submissions handled gracefully (same success message)
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

// ─── UTM capture ─────────────────────────────────────────────────────────────
function getUtmParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource:   params.get("utm_source")   ?? undefined,
    utmMedium:   params.get("utm_medium")   ?? undefined,
    utmCampaign: params.get("utm_campaign") ?? undefined,
  };
}

// ─── Stat badge ───────────────────────────────────────────────────────────────
function StatBadge({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
      <span className="text-[11px] text-zinc-400 uppercase tracking-widest whitespace-nowrap">{label}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function WaitlistCapture() {
  const [email, setEmail]         = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [focused, setFocused]     = useState<string | null>(null);

  // Capture UTM params once on mount
  const [utmParams] = useState(() => getUtmParams());

  const submitMutation = trpc.waitlist.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setError(null);
    },
    onError: (err) => {
      setError(err.message ?? "Something went wrong. Please try again.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter a valid email address.");
      return;
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    submitMutation.mutate({
      email:     trimmedEmail,
      firstName: firstName.trim() || undefined,
      lastName:  lastName.trim() || undefined,
      ...utmParams,
    });
  }

  return (
    <section
      id="waitlist"
      className="relative py-28 px-4 overflow-hidden"
      style={{ background: "linear-gradient(180deg, #050810 0%, #080d1a 50%, #050810 100%)" }}
    >
      {/* ── Ambient glow ─────────────────────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(99,102,241,0.12) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-2xl mx-auto text-center">

        {/* ── Exclusivity badge ─────────────────────────────────────────── */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-xs font-semibold text-indigo-300 tracking-widest uppercase">
            Early Access — Limited Spots
          </span>
        </div>

        {/* ── Headline ──────────────────────────────────────────────────── */}
        <h2
          className="text-4xl sm:text-5xl font-black tracking-tight leading-[1.1] mb-5"
          style={{
            background: "linear-gradient(135deg, #ffffff 0%, #a5b4fc 50%, #818cf8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Be First In Line.
        </h2>

        <p className="text-lg text-zinc-300 leading-relaxed mb-4 max-w-xl mx-auto">
          We're opening access to a select group of serious bettors before the public launch.
          Reserve your spot now — no commitment required.
        </p>

        {/* ── Social proof stats ────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-8 mb-10 py-5 border-y border-white/5">
          <StatBadge value="MLB"      label="Live Now" />
          <div className="w-px h-8 bg-white/10" />
          <StatBadge value="WC 2026"  label="Live Now" />
          <div className="w-px h-8 bg-white/10" />
          <StatBadge value="NBA · NHL" label="Coming Soon" />
        </div>

        {/* ── Form card ─────────────────────────────────────────────────── */}
        {submitted ? (
          /* ── Success state ──────────────────────────────────────────── */
          <div
            className="relative rounded-2xl p-8 text-center"
            style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(16,24,40,0.9) 100%)",
              border: "1px solid rgba(99,102,241,0.4)",
            }}
          >
            {/* Checkmark */}
            <div className="w-16 h-16 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center mx-auto mb-5">
              <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white mb-3">You're on the list.</h3>
            <p className="text-zinc-300 text-base leading-relaxed max-w-sm mx-auto">
              We'll reach out personally when your access is ready. Keep an eye on your inbox.
            </p>
            <p className="mt-4 text-xs text-zinc-500">
              Didn't receive a confirmation? Check your spam folder or contact us at{" "}
              <a href="mailto:support@aisportsbettingmodels.com" className="text-indigo-400 hover:underline">
                support@aisportsbettingmodels.com
              </a>
            </p>
          </div>
        ) : (
          /* ── Form ───────────────────────────────────────────────────── */
          <form
            onSubmit={handleSubmit}
            className="relative rounded-2xl p-8"
            style={{
              background: "rgba(10,14,30,0.85)",
              border: "1px solid rgba(99,102,241,0.25)",
              backdropFilter: "blur(12px)",
            }}
          >
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="flex flex-col gap-1.5 text-left">
                <label htmlFor="wl-first" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  First Name <span className="text-zinc-600">(optional)</span>
                </label>
                <input
                  id="wl-first"
                  type="text"
                  autoComplete="given-name"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onFocus={() => setFocused("first")}
                  onBlur={() => setFocused(null)}
                  maxLength={128}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-600 outline-none transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: focused === "first"
                      ? "1px solid rgba(99,102,241,0.7)"
                      : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: focused === "first" ? "0 0 0 3px rgba(99,102,241,0.12)" : "none",
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5 text-left">
                <label htmlFor="wl-last" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Last Name <span className="text-zinc-600">(optional)</span>
                </label>
                <input
                  id="wl-last"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Smith"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onFocus={() => setFocused("last")}
                  onBlur={() => setFocused(null)}
                  maxLength={128}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-zinc-600 outline-none transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: focused === "last"
                      ? "1px solid rgba(99,102,241,0.7)"
                      : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: focused === "last" ? "0 0 0 3px rgba(99,102,241,0.12)" : "none",
                  }}
                />
              </div>
            </div>

            {/* Email row */}
            <div className="flex flex-col gap-1.5 text-left mb-5">
              <label htmlFor="wl-email" className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Email Address <span className="text-red-400">*</span>
              </label>
              <input
                id="wl-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                required
                maxLength={320}
                className="w-full px-4 py-3.5 rounded-xl text-sm text-white placeholder-zinc-600 outline-none transition-all duration-200"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: focused === "email"
                    ? "1px solid rgba(99,102,241,0.7)"
                    : error
                    ? "1px solid rgba(239,68,68,0.6)"
                    : "1px solid rgba(255,255,255,0.08)",
                  boxShadow: focused === "email" ? "0 0 0 3px rgba(99,102,241,0.12)" : "none",
                }}
              />
            </div>

            {/* Error message */}
            {error && (
              <p className="text-sm text-red-400 mb-4 text-left flex items-center gap-1.5">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {error}
              </p>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="w-full py-4 rounded-xl font-bold text-base tracking-wide transition-all duration-200 relative overflow-hidden group"
              style={{
                background: submitMutation.isPending
                  ? "rgba(99,102,241,0.4)"
                  : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                color: "#ffffff",
                boxShadow: submitMutation.isPending
                  ? "none"
                  : "0 4px 24px rgba(99,102,241,0.35)",
              }}
            >
              <span className="relative z-10">
                {submitMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Reserving your spot...
                  </span>
                ) : (
                  "Reserve My Spot →"
                )}
              </span>
            </button>

            {/* Trust line */}
            <p className="mt-4 text-xs text-zinc-500 text-center">
              No credit card required &nbsp;·&nbsp; No spam, ever &nbsp;·&nbsp; Unsubscribe anytime
            </p>
          </form>
        )}

        {/* ── Scarcity note ─────────────────────────────────────────────── */}
        <p className="mt-8 text-sm text-zinc-500 flex items-center justify-center gap-2">
          <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          Access is reviewed manually. Not all applicants will be approved.
        </p>
      </div>
    </section>
  );
}
