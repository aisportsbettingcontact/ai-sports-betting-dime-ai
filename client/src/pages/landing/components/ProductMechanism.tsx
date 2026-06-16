import { motion, useReducedMotion } from "framer-motion";

const SIGNALS = [
  {
    label: "Model Projections",
    detail: "Dixon-Coles Poisson win probabilities and Monte Carlo-derived implied odds for every game",
    color: "#39FF14",
  },
  {
    label: "Book vs. Model Gap",
    detail: "Side-by-side comparison showing where the market price and model output diverge",
    color: "#39FF14",
  },
  {
    label: "Betting Splits",
    detail: "Public money percentages and ticket counts on every side of every game",
    color: "#39FF14",
  },
  {
    label: "Line Movement",
    detail: "Track how lines have moved from open to current across all major books",
    color: "#39FF14",
  },
  {
    label: "Sharp Indicators",
    detail: "Reverse line movement and steam move alerts for identifying sharp-side positioning",
    color: "#39FF14",
  },
  {
    label: "Starting Lineups",
    detail: "Confirmed lineups and pitcher assignments updated before first pitch",
    color: "#39FF14",
  },
];

export default function ProductMechanism() {
  const shouldReduce = useReducedMotion();

  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: copy */}
          <motion.div
            initial={shouldReduce ? false : { opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
            className="flex flex-col gap-6"
          >
            <div>
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "#39FF14",
                  textTransform: "uppercase",
                  marginBottom: "12px",
                }}
              >
                The Mechanism
              </p>
              <h2
                className="font-bold text-white"
                style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                One Dashboard.
                <br />
                <span style={{ color: "#39FF14" }}>The Signals That Matter</span>
                <br />
                Before You Bet.
              </h2>
            </div>
            <p className="text-[#9ca3af] leading-relaxed" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
              Stop switching tabs. Stop guessing. AI Sports Betting Models consolidates every signal you need into a single premium dashboard built for serious pre-bet research.
            </p>
            <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: "rgba(57,255,20,0.04)", border: "1px solid rgba(57,255,20,0.12)" }}>
              <p className="text-[#d1d5db] text-[13px] leading-relaxed">
                <span className="font-bold text-white">The model runs first.</span> Dixon-Coles Poisson distributions generate win probabilities from pitcher ERA, team offensive production, park factors, and lineup data. Monte Carlo simulation produces a probability distribution across thousands of outcomes. The result: a model-implied price you can compare directly to the book.
              </p>
            </div>
            <a
              href="/#pricing"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-black self-start transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: "#39FF14", fontSize: "14px", boxShadow: "0 0 20px rgba(57,255,20,0.25)" }}
            >
              Get Access Now
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </motion.div>

          {/* Right: signal cards */}
          <motion.div
            initial={shouldReduce ? false : { opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {SIGNALS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={shouldReduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 + i * 0.06, duration: 0.35 }}
                className="rounded-lg p-4 flex flex-col gap-1.5"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: s.color,
                      flexShrink: 0,
                      boxShadow: `0 0 4px ${s.color}80`,
                    }}
                  />
                  <span className="font-semibold text-white text-[13px]">{s.label}</span>
                </div>
                <p className="text-[#6b7280] text-[12px] leading-relaxed pl-3.5">{s.detail}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
