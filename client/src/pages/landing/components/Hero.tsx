/**
 * Hero.tsx
 *
 * Full-viewport hero section.
 * Fluid padding: clamp(16px, 4vw, 64px) horizontal.
 * Tight vertical spacing — no dead zones above or below.
 * No em dashes in copy.
 */

import { motion, useReducedMotion } from "framer-motion";

export default function Hero() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="relative overflow-hidden w-full"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(57,255,20,0.08) 0%, transparent 60%), linear-gradient(180deg, #080c12 0%, #050810 100%)",
      }}
    >
      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* pt clears fixed nav (h-16=64px). Tight pb to close gap with features section. */}
      <div
        className="relative z-10 w-full max-w-screen-2xl mx-auto text-center"
        style={{ padding: "5rem clamp(16px, 4vw, 64px) 2rem" }}
      >
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center gap-5"
        >
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full bg-[#39FF14]"
              style={
                shouldReduce
                  ? {}
                  : { animation: "pulse-green 2s ease-in-out infinite" }
              }
            />
            <span className="text-[11px] font-bold text-[#39FF14] tracking-widest uppercase">
              AI-Powered Betting Intelligence
            </span>
          </div>

          {/* H1 — fluid font size scales from 3rem on mobile to 6vw on wide screens */}
          <h1
            className="font-bold text-white leading-[1.0] w-full"
            style={{
              letterSpacing: "-0.04em",
              fontSize: "clamp(2.75rem, 6vw, 6rem)",
            }}
          >
            Find The Edge
            <br />
            <span style={{ color: "#39FF14" }}>Before The Market</span>
            <br />
            Moves.
          </h1>

          {/* Sub-copy — fluid font size, no em dash */}
          <p
            className="text-[#9ca3af] leading-relaxed w-full"
            style={{ fontSize: "clamp(1rem, 1.6vw, 1.35rem)", maxWidth: "60ch" }}
          >
            AI model projections, betting splits, daily lineups, and cheat
            sheets. All in one clean dashboard.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{
                background: "#39FF14",
                letterSpacing: "-0.01em",
                fontSize: "clamp(0.875rem, 1.2vw, 1rem)",
              }}
            >
              View Today's Edges
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>

          {/* Microcopy */}
          <p className="text-[12px] text-[#9ca3af]">
            No guaranteed outcomes. Just sharper data and faster market comparison.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
