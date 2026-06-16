import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { motion } from "framer-motion";

export default function Hero() {
  const { appUser, loading } = useAppAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && appUser) setLocation("/feed");
  }, [loading, appUser, setLocation]);

  return (
    <section
      className="w-full relative overflow-hidden"
      style={{
        padding: "clamp(5rem, 12vw, 9rem) clamp(16px, 4vw, 64px) clamp(4rem, 8vw, 7rem)",
        background: "linear-gradient(180deg, rgba(57,255,20,0.04) 0%, rgba(5,8,16,0) 60%)",
      }}
    >
      {/* Background grid pattern */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(57,255,20,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(57,255,20,0.04) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Radial glow */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "80vw",
          height: "60vw",
          maxWidth: "900px",
          maxHeight: "600px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(57,255,20,0.07) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div className="max-w-screen-md mx-auto flex flex-col items-center gap-6 text-center relative z-10">
        {/* Eyebrow trust line */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2"
        >
          <span
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-semibold uppercase tracking-widest"
            style={{
              fontSize: "11px",
              background: "rgba(57,255,20,0.08)",
              border: "1px solid rgba(57,255,20,0.2)",
              color: "#39FF14",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#39FF14",
                display: "inline-block",
                boxShadow: "0 0 6px #39FF14",
              }}
            />
            MLB · World Cup 2026 · More Sports Coming
          </span>
        </motion.div>

        {/* Primary headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="font-black text-white"
          style={{
            fontSize: "clamp(2.25rem, 6vw, 5rem)",
            lineHeight: 1.06,
            letterSpacing: "-0.04em",
          }}
        >
          The Betting Intelligence Dashboard
          <br />
          <span style={{ color: "#39FF14" }}>Built for Serious Bettors.</span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16 }}
          className="text-[#9ca3af] leading-relaxed"
          style={{ fontSize: "clamp(1rem, 1.8vw, 1.25rem)", maxWidth: "52ch" }}
        >
          AI model projections, betting splits, line movement, and sharp indicators — all in one dashboard. Research smarter. Bet with conviction.
        </motion.p>

        {/* Dual CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.24 }}
          className="flex flex-col sm:flex-row gap-3 mt-2"
        >
          <a
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-black transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ background: "#39FF14", fontSize: "15px", boxShadow: "0 0 24px rgba(57,255,20,0.3)" }}
          >
            View Today&apos;s Projections
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a
            href="/#waitlist"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-semibold text-white transition-all hover:bg-white/10 active:scale-[0.98]"
            style={{ border: "1px solid rgba(255,255,255,0.15)", fontSize: "15px" }}
          >
            Join the Waitlist
          </a>
        </motion.div>

        {/* Trust line below CTAs */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.32 }}
          className="text-[#4b5563] text-[12px]"
        >
          No picks. No lock-of-the-day hype. Just the data.
        </motion.p>

        {/* 3 conversion bullets */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.38 }}
          className="flex flex-col sm:flex-row gap-4 mt-2 text-[13px] text-[#9ca3af]"
        >
          {[
            "Dixon-Coles Poisson model + Monte Carlo simulation",
            "Book vs. model comparison on every game",
            "Cancel anytime. No contracts.",
          ].map((bullet) => (
            <div key={bullet} className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: "#39FF14", boxShadow: "0 0 4px rgba(57,255,20,0.6)" }}
              />
              {bullet}
            </div>
          ))}
        </motion.div>

        {/* Social proof / trust badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.46 }}
          className="flex flex-wrap items-center justify-center gap-4 mt-4 pt-4"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {[
            { label: "Invite-Only Access", icon: "🔒" },
            { label: "Cancel Anytime", icon: "✓" },
            { label: "Real-Time Data", icon: "⚡" },
            { label: "No Picks Service", icon: "📊" },
          ].map(({ label, icon }) => (
            <div key={label} className="flex items-center gap-1.5 text-[#6b7280]" style={{ fontSize: "12px" }}>
              <span style={{ fontSize: "11px" }}>{icon}</span>
              <span>{label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
