import { motion, useReducedMotion } from "framer-motion";

const ROWS = [
  { feature: "AI model projections (Poisson + Monte Carlo)", us: true, them: false },
  { feature: "Book vs. model price comparison", us: true, them: false },
  { feature: "Betting splits and public money %", us: true, them: true },
  { feature: "Line movement tracking", us: true, them: true },
  { feature: "Sharp-side indicators and steam moves", us: true, them: false },
  { feature: "Daily lineups and pitcher assignments", us: true, them: false },
  { feature: "K props and player prop models", us: true, them: false },
  { feature: "No picks, no lock-of-the-day hype", us: true, them: false },
  { feature: "Transparent methodology — see the model", us: true, them: false },
];

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="8" fill="rgba(57,255,20,0.15)" />
    <path d="M5 8l2 2 4-4" stroke="#39FF14" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="8" fill="rgba(255,59,48,0.1)" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const SometimesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="8" fill="rgba(250,204,21,0.1)" />
    <path d="M5 8h6" stroke="#facc15" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export default function ComparisonSection() {
  const shouldReduce = useReducedMotion();

  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-lg mx-auto">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2
            className="font-bold text-white"
            style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}
          >
            Not Picks. Not Hype.
            <br />
            <span style={{ color: "#39FF14" }}>Betting Intelligence.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
            Most services sell you picks. We give you the data to make your own.
          </p>
        </motion.div>

        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(57,255,20,0.15)" }}
        >
          {/* Header */}
          <div
            className="grid grid-cols-3 text-[11px] font-bold uppercase tracking-wider p-4"
            style={{ background: "rgba(57,255,20,0.06)", borderBottom: "1px solid rgba(57,255,20,0.12)" }}
          >
            <span className="text-[#6b7280]">Feature</span>
            <span className="text-center" style={{ color: "#39FF14" }}>AI Sports Betting Models</span>
            <span className="text-center text-[#6b7280]">Others</span>
          </div>

          {/* Rows */}
          {ROWS.map((row, i) => (
            <div
              key={row.feature}
              className="grid grid-cols-3 p-4 text-[13px]"
              style={{
                background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent",
                borderTop: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span className="text-[#d1d5db] leading-snug pr-2">{row.feature}</span>
              <span className="flex items-center justify-center">
                {row.us ? <CheckIcon /> : <XIcon />}
              </span>
              <span className="flex items-center justify-center">
                {row.them === true ? <SometimesIcon /> : <XIcon />}
              </span>
            </div>
          ))}

          {/* Footer */}
          <div
            className="p-4 text-center"
            style={{ background: "rgba(57,255,20,0.04)", borderTop: "1px solid rgba(57,255,20,0.1)" }}
          >
            <a
              href="/#waitlist"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-black transition-all hover:brightness-110"
              style={{ background: "#39FF14", fontSize: "13px" }}
            >
              Get Access Now
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
