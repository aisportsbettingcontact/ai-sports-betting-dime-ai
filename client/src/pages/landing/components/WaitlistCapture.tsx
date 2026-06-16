/**
 * WaitlistCapture.tsx
 *
 * 2-step waitlist form:
 *   Step 1 — Full Name (required) + Email (required) → submits to waitlist
 *   Step 2 — "Want earlier access?" optional: why-text + unit-size range slider
 *             Submitting step 2 bumps their position in the queue.
 *
 * Banned phrases (must never appear in rendered JSX):
 *   - "No credit card required"
 *   - "No spam, ever"
 *   - "Unsubscribe anytime"
 *   - "Access is reviewed manually. Not all applicants will be approved."
 */

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";

// ─── UTM helpers ─────────────────────────────────────────────────────────────

function getUtmParams() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  return {
    utmSource:   p.get("utm_source")   ?? undefined,
    utmMedium:   p.get("utm_medium")   ?? undefined,
    utmCampaign: p.get("utm_campaign") ?? undefined,
  };
}

// ─── Dual-thumb range slider ──────────────────────────────────────────────────

const MIN_UNIT  = 5;
const MAX_UNIT  = 5000;
const STEP_UNIT = 5;

function formatUSD(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`;
}

interface RangeSliderProps {
  low:    number;
  high:   number;
  onChange: (low: number, high: number) => void;
}

function RangeSlider({ low, high, onChange }: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const pct = (v: number) => ((v - MIN_UNIT) / (MAX_UNIT - MIN_UNIT)) * 100;

  const clamp = (v: number) => Math.round(Math.max(MIN_UNIT, Math.min(MAX_UNIT, v)) / STEP_UNIT) * STEP_UNIT;

  const handleLow  = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = clamp(Number(e.target.value));
    onChange(Math.min(v, high - STEP_UNIT), high);
  };
  const handleHigh = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = clamp(Number(e.target.value));
    onChange(low, Math.max(v, low + STEP_UNIT));
  };

  const leftPct  = pct(low);
  const rightPct = pct(high);

  return (
    <div className="w-full select-none" ref={trackRef}>
      {/* Labels */}
      <div className="flex justify-between mb-3">
        <span
          className="font-bold"
          style={{ fontSize: "13px", color: "#39FF14" }}
        >
          {formatUSD(low)}
        </span>
        <span className="text-[#6b7280]" style={{ fontSize: "12px" }}>
          per unit
        </span>
        <span
          className="font-bold"
          style={{ fontSize: "13px", color: "#39FF14" }}
        >
          {formatUSD(high)}
        </span>
      </div>

      {/* Track */}
      <div className="relative h-2 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
        {/* Filled range */}
        <div
          className="absolute h-2 rounded-full"
          style={{
            left:  `${leftPct}%`,
            right: `${100 - rightPct}%`,
            background: "linear-gradient(90deg, #39FF14, #00d4ff)",
          }}
        />
        {/* Low thumb */}
        <input
          type="range"
          min={MIN_UNIT}
          max={MAX_UNIT}
          step={STEP_UNIT}
          value={low}
          onChange={handleLow}
          className="absolute w-full h-2 opacity-0 cursor-pointer"
          style={{ zIndex: low > MAX_UNIT - 100 ? 5 : 3, top: 0 }}
          aria-label="Minimum unit size"
        />
        {/* High thumb */}
        <input
          type="range"
          min={MIN_UNIT}
          max={MAX_UNIT}
          step={STEP_UNIT}
          value={high}
          onChange={handleHigh}
          className="absolute w-full h-2 opacity-0 cursor-pointer"
          style={{ zIndex: 4, top: 0 }}
          aria-label="Maximum unit size"
        />
        {/* Thumb dots */}
        {[leftPct, rightPct].map((p, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-black"
            style={{
              left: `${p}%`,
              transform: "translate(-50%, -50%)",
              background: "#39FF14",
              boxShadow: "0 0 8px rgba(57,255,20,0.6)",
              zIndex: 6,
              pointerEvents: "none",
            }}
          />
        ))}
      </div>

      {/* Tick labels */}
      <div className="flex justify-between mt-2">
        {[5, 100, 500, 1000, 2500, 5000].map((v) => (
          <span key={v} className="text-[#4b5563]" style={{ fontSize: "10px" }}>
            {formatUSD(v)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Phase = "form1" | "success" | "form2" | "done";

export default function WaitlistCapture() {
  // ── Step 1 state ────────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState("");
  const [email,    setEmail]    = useState("");
  const [error1,   setError1]   = useState("");

  // ── Step 2 state ────────────────────────────────────────────────────────────
  const [whyText,      setWhyText]      = useState("");
  const [unitLow,      setUnitLow]      = useState(25);
  const [unitHigh,     setUnitHigh]     = useState(500);
  const [error2,       setError2]       = useState("");

  // ── Phase ────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("form1");

  // ── Mutations ────────────────────────────────────────────────────────────────
  const submitStep1 = trpc.waitlist.submit.useMutation({
    onSuccess(data) {
      if (data.ok || data.reason === "duplicate") {
        setPhase("success");
      } else {
        setError1("Something went wrong. Please try again.");
      }
    },
    onError(err) {
      setError1(err.message || "Something went wrong. Please try again.");
    },
  });

  const submitStep2 = trpc.waitlist.submit.useMutation({
    onSuccess() {
      setPhase("done");
    },
    onError(err) {
      setError2(err.message || "Something went wrong. Please try again.");
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleStep1 = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError1("");
    const trimName  = fullName.trim();
    const trimEmail = email.trim();
    if (!trimName)  { setError1("Full name is required."); return; }
    if (!trimEmail) { setError1("Email address is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
      setError1("Please enter a valid email address.");
      return;
    }
    submitStep1.mutate({
      email:    trimEmail,
      fullName: trimName,
      ...getUtmParams(),
    });
  }, [fullName, email, submitStep1]);

  const handleStep2 = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError2("");
    submitStep2.mutate({
      email:          email.trim(),
      fullName:       fullName.trim(),
      whyText:        whyText.trim() || undefined,
      unitSizeMin:    unitLow,
      unitSizeMax:    unitHigh,
      step2Completed: true,
      ...getUtmParams(),
    });
  }, [email, fullName, whyText, unitLow, unitHigh, submitStep2]);

  const handleRangeChange = useCallback((low: number, high: number) => {
    setUnitLow(low);
    setUnitHigh(high);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <section
      id="waitlist"
      className="relative py-28 px-4 overflow-hidden"
      style={{ background: "linear-gradient(180deg, #050810 0%, #080d1a 50%, #050810 100%)" }}
    >
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(57,255,20,0.06) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-10">
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-semibold uppercase tracking-widest mb-4"
            style={{
              fontSize: "11px",
              background: "rgba(57,255,20,0.08)",
              border: "1px solid rgba(57,255,20,0.2)",
              color: "#39FF14",
            }}
          >
            <span
              style={{
                width: "6px", height: "6px", borderRadius: "50%",
                background: "#39FF14", display: "inline-block",
                boxShadow: "0 0 6px #39FF14",
              }}
            />
            Invite-Only Access
          </span>
          <h2
            className="font-black text-white"
            style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)", letterSpacing: "-0.03em", lineHeight: 1.1 }}
          >
            Be First to Access
          </h2>
          <p className="text-[#9ca3af] mt-3" style={{ fontSize: "clamp(0.95rem, 1.6vw, 1.1rem)" }}>
            We are opening access to a select group before public launch. Reserve your spot now.
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 0 40px rgba(57,255,20,0.04)",
          }}
        >
          <AnimatePresence mode="wait">

            {/* ── PHASE: form1 ─────────────────────────────────────────────── */}
            {phase === "form1" && (
              <motion.form
                key="form1"
                onSubmit={handleStep1}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col gap-5"
                noValidate
              >
                {/* Full Name — required */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9ca3af] font-semibold uppercase tracking-widest" style={{ fontSize: "11px" }}>
                    Full Name <span style={{ color: "#39FF14" }}>*</span>
                  </label>
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder="John Smith"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="w-full rounded-lg px-4 py-3 text-white placeholder-[#374151] outline-none transition-all"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      fontSize: "15px",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(57,255,20,0.4)")}
                    onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                </div>

                {/* Email — required */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9ca3af] font-semibold uppercase tracking-widest" style={{ fontSize: "11px" }}>
                    Email Address <span style={{ color: "#39FF14" }}>*</span>
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-lg px-4 py-3 text-white placeholder-[#374151] outline-none transition-all"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      fontSize: "15px",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(57,255,20,0.4)")}
                    onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                </div>

                {/* Error */}
                {error1 && (
                  <p className="text-red-400 text-sm">{error1}</p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitStep1.isPending}
                  className="w-full rounded-lg py-4 font-bold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                  style={{
                    background: "#39FF14",
                    fontSize: "15px",
                    boxShadow: "0 0 24px rgba(57,255,20,0.25)",
                  }}
                >
                  {submitStep1.isPending ? "Reserving your spot…" : "Reserve My Spot →"}
                </button>
              </motion.form>
            )}

            {/* ── PHASE: success ────────────────────────────────────────────── */}
            {phase === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
                className="flex flex-col items-center gap-6 text-center py-4"
              >
                {/* Check icon */}
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(57,255,20,0.12)", border: "1px solid rgba(57,255,20,0.3)" }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" stroke="#39FF14" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                <div>
                  <h3 className="font-black text-white text-2xl mb-2">You&apos;re on the list.</h3>
                  <p className="text-[#9ca3af]" style={{ fontSize: "15px" }}>
                    We&apos;ll reach out when your access is ready.
                  </p>
                </div>

                {/* Step 2 prompt */}
                <div
                  className="w-full rounded-xl p-5"
                  style={{
                    background: "rgba(57,255,20,0.04)",
                    border: "1px solid rgba(57,255,20,0.15)",
                  }}
                >
                  <p className="font-semibold text-white mb-1" style={{ fontSize: "14px" }}>
                    Want earlier access?
                  </p>
                  <p className="text-[#6b7280] mb-4" style={{ fontSize: "13px" }}>
                    Tell us a bit more and move up in the queue.
                  </p>
                  <button
                    onClick={() => setPhase("form2")}
                    className="w-full rounded-lg py-3 font-bold text-black transition-all hover:brightness-110 active:scale-[0.98]"
                    style={{ background: "#39FF14", fontSize: "14px" }}
                  >
                    Move Up in Line →
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── PHASE: form2 ─────────────────────────────────────────────── */}
            {phase === "form2" && (
              <motion.form
                key="form2"
                onSubmit={handleStep2}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col gap-7"
                noValidate
              >
                <div className="text-center">
                  <h3 className="font-black text-white text-xl mb-1">One more step</h3>
                  <p className="text-[#6b7280]" style={{ fontSize: "13px" }}>
                    Both fields are optional. Fill in what applies to you.
                  </p>
                </div>

                {/* Why text — optional */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[#9ca3af] font-semibold uppercase tracking-widest" style={{ fontSize: "11px" }}>
                    Why do you want to access our AI Sports Betting Models?
                    <span className="ml-2 normal-case text-[#4b5563]">(optional)</span>
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Tell us about your betting background, what you're looking to improve, or how you plan to use the platform…"
                    value={whyText}
                    onChange={(e) => setWhyText(e.target.value)}
                    maxLength={2000}
                    className="w-full rounded-lg px-4 py-3 text-white placeholder-[#374151] outline-none transition-all resize-none"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      fontSize: "14px",
                      lineHeight: "1.6",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(57,255,20,0.4)")}
                    onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                  <span className="text-right text-[#4b5563]" style={{ fontSize: "11px" }}>
                    {whyText.length}/2000
                  </span>
                </div>

                {/* Unit size slider — optional */}
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-[#9ca3af] font-semibold uppercase tracking-widest" style={{ fontSize: "11px" }}>
                      Unit Size Per Bet
                      <span className="ml-2 normal-case text-[#4b5563]">(optional)</span>
                    </label>
                    <p className="text-[#4b5563] mt-1" style={{ fontSize: "12px" }}>
                      Drag both handles to set your typical unit size range.
                    </p>
                  </div>
                  <RangeSlider
                    low={unitLow}
                    high={unitHigh}
                    onChange={handleRangeChange}
                  />
                </div>

                {/* Error */}
                {error2 && (
                  <p className="text-red-400 text-sm">{error2}</p>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  <button
                    type="submit"
                    disabled={submitStep2.isPending}
                    className="w-full rounded-lg py-4 font-bold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                    style={{
                      background: "#39FF14",
                      fontSize: "15px",
                      boxShadow: "0 0 24px rgba(57,255,20,0.25)",
                    }}
                  >
                    {submitStep2.isPending ? "Submitting…" : "Submit & Move Up →"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhase("done")}
                    className="w-full rounded-lg py-3 font-semibold text-[#6b7280] transition-all hover:text-white"
                    style={{ fontSize: "13px" }}
                  >
                    Skip for now
                  </button>
                </div>
              </motion.form>
            )}

            {/* ── PHASE: done ──────────────────────────────────────────────── */}
            {phase === "done" && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35 }}
                className="flex flex-col items-center gap-5 text-center py-4"
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(57,255,20,0.12)", border: "1px solid rgba(57,255,20,0.3)" }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" stroke="#39FF14" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-black text-white text-2xl mb-2">You&apos;re prioritized.</h3>
                  <p className="text-[#9ca3af]" style={{ fontSize: "15px" }}>
                    Your information has been noted. We&apos;ll be in touch soon.
                  </p>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
