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

// ─── Snap-point unit size picker ─────────────────────────────────────────────
// Logarithmically spaced preset values covering $5 → $5,000

const UNIT_PRESETS = [
  { value: 5,    label: "$5" },
  { value: 10,   label: "$10" },
  { value: 25,   label: "$25" },
  { value: 50,   label: "$50" },
  { value: 100,  label: "$100" },
  { value: 250,  label: "$250" },
  { value: 500,  label: "$500" },
  { value: 1000, label: "$1k" },
  { value: 2500, label: "$2.5k" },
  { value: 5000, label: "$5k" },
] as const;

type UnitPresetValue = (typeof UNIT_PRESETS)[number]["value"];

function formatUnitSize(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `$${v}`;
}

interface SnapSliderProps {
  value: UnitPresetValue | null;
  onChange: (v: UnitPresetValue) => void;
}

function SnapSlider({ value, onChange }: SnapSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const presets  = UNIT_PRESETS;
  const selectedIdx = value === null ? -1 : presets.findIndex((p) => p.value === value);

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const idx  = Math.round(pct * (presets.length - 1));
      onChange(presets[idx].value);
    },
    [onChange, presets],
  );

  const fillPct =
    selectedIdx < 0 ? 0 : (selectedIdx / (presets.length - 1)) * 100;

  return (
    <div className="space-y-3">
      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-2 rounded-full cursor-pointer select-none"
        style={{ background: "rgba(255,255,255,0.08)" }}
        onClick={handleTrackClick}
        role="slider"
        aria-valuemin={UNIT_PRESETS[0].value}
        aria-valuemax={UNIT_PRESETS[UNIT_PRESETS.length - 1].value}
        aria-valuenow={value ?? undefined}
        aria-label="Average unit size per bet"
        tabIndex={0}
        onKeyDown={(e) => {
          if (selectedIdx < 0) { onChange(presets[0].value); return; }
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            const next = Math.min(selectedIdx + 1, presets.length - 1);
            onChange(presets[next].value);
          }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            const prev = Math.max(selectedIdx - 1, 0);
            onChange(presets[prev].value);
          }
        }}
      >
        {/* Fill */}
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-150"
          style={{
            width:      `${fillPct}%`,
            background: "linear-gradient(90deg, #39FF14, #22c55e)",
          }}
        />
        {/* Thumb */}
        {selectedIdx >= 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full border-2 border-[#39FF14] bg-[#0d1117] pointer-events-none transition-all duration-150"
            style={{
              left:      `${fillPct}%`,
              boxShadow: "0 0 8px rgba(57,255,20,0.6)",
            }}
          />
        )}
      </div>

      {/* Preset label row */}
      <div className="flex justify-between items-center">
        {presets.map((p, i) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            className="transition-all duration-100 px-0.5 rounded"
            style={{
              fontSize:   "10px",
              fontFamily: "monospace",
              color:      i === selectedIdx ? "#39FF14" : "rgba(255,255,255,0.3)",
              fontWeight: i === selectedIdx ? 700 : 400,
              transform:  i === selectedIdx ? "scale(1.12)" : "scale(1)",
            }}
          >
            {p.label}
          </button>
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

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [whyText,  setWhyText]  = useState("");
  const [unitSize, setUnitSize] = useState<UnitPresetValue | null>(null);
  const [error2,   setError2]   = useState("");

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

  // Step 2 calls enrichStep2 — NOT submit — to update the existing row
  const enrichStep2Mutation = trpc.waitlist.enrichStep2.useMutation({
    onSuccess(data) {
      console.log("[WaitlistCapture][OUTPUT] enrichStep2 onSuccess — ok:", data.ok);
      setPhase("done");
    },
    onError(err) {
      console.error("[WaitlistCapture][ERROR] enrichStep2 mutation error:", err.message);
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

  const handleStep2 = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError2("");

      const trimEmail = email.trim().toLowerCase();
      const trimName  = fullName.trim();
      const trimWhy   = whyText.trim();

      console.log(`[WaitlistCapture][STEP] handleStep2 — email="${trimEmail}" whyText="${trimWhy ? "(set, len=" + trimWhy.length + ")" : "(empty)"}" unitSize=${unitSize ?? "(none)"}`);

      // enrichStep2 updates the existing row — no UTM params needed
      enrichStep2Mutation.mutate({
        email:    trimEmail,
        fullName: trimName  || undefined,
        whyText:  trimWhy   || undefined,
        unitSize: unitSize  ?? undefined,
      });
    },
    [email, fullName, whyText, unitSize, enrichStep2Mutation],
  );

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

                {/* Unit size snap-point slider — optional */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between">
                    <label
                      className="text-[#9ca3af] font-semibold uppercase tracking-widest"
                      style={{ fontSize: "11px" }}
                    >
                      Average Bet Size
                      <span className="ml-2 normal-case text-[#4b5563]">(optional)</span>
                    </label>
                    {unitSize !== null && (
                      <span
                        className="font-bold tabular-nums"
                        style={{ color: "#39FF14", fontSize: "15px" }}
                      >
                        {formatUnitSize(unitSize)} / unit
                      </span>
                    )}
                  </div>
                  <SnapSlider value={unitSize} onChange={setUnitSize} />
                  {unitSize === null && (
                    <p className="text-[#4b5563]" style={{ fontSize: "12px" }}>
                      Click or tap to select your typical unit size per bet.
                    </p>
                  )}
                </div>

                {/* Error */}
                {error2 && (
                  <p className="text-red-400 text-sm">{error2}</p>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-3">
                  <button
                    type="submit"
                    disabled={enrichStep2Mutation.isPending}
                    className="w-full rounded-lg py-4 font-bold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                    style={{
                      background: "#39FF14",
                      fontSize:   "15px",
                      boxShadow:  "0 0 24px rgba(57,255,20,0.25)",
                    }}
                  >
                    {enrichStep2Mutation.isPending ? "Submitting…" : "Submit & Move Up →"}
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
