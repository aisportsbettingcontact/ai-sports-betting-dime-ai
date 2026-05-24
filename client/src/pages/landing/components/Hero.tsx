/**
 * Hero.tsx
 *
 * Clean, minimal hero section.
 * No fake data widgets. Headline + sub-copy + single CTA.
 * "View Today's Edges" → /login (requires Discord auth)
 */

import { motion, useReducedMotion } from "framer-motion";

export default function Hero() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="relative overflow-hidden"
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

      {/* pt-24 clears the fixed nav (h-16 = 64px), pb-12 gives breathing room below CTA */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 text-center">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center gap-6"
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

          {/* H1 */}
          <h1
            className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-[1.0]"
            style={{ letterSpacing: "-0.04em" }}
          >
            Find The Edge
            <br />
            <span style={{ color: "#39FF14" }}>Before The Market</span>
            <br />
            Moves.
          </h1>

          {/* Sub-copy */}
          <p className="text-[#9ca3af] text-lg sm:text-xl leading-relaxed max-w-2xl">
            AI model projections, betting splits, daily lineups, and cheat
            sheets — all in one clean dashboard.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-lg font-bold text-sm text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{ background: "#39FF14", letterSpacing: "-0.01em" }}
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
          <p className="text-[12px] text-[#4b5563]">
            No guaranteed outcomes. Just sharper data and faster market comparison.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
