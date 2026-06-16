import { motion, useReducedMotion } from "framer-motion";

const POINTS = [
  {
    title: "We show our work",
    desc: "Every projection is built on a documented model — Dixon-Coles Poisson distributions, Monte Carlo simulation, pitcher ERA, park factors. No black boxes. No mystery picks.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
        <rect x="9" y="3" width="6" height="4" rx="1" stroke="#39FF14" strokeWidth="1.8"/>
        <path d="M9 12h6M9 16h4" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: "We do not sell picks",
    desc: "We give you the model output, the market data, and the splits. You make the decision. That is how it should work for serious bettors.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="#39FF14" strokeWidth="1.8"/>
        <path d="M15 9l-6 6M9 9l6 6" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: "We flag uncertainty",
    desc: "When the data is thin or the model confidence is marginal, we say so. No inflated confidence. No manufactured conviction.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 9v4M12 17h.01" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    title: "We update in real time",
    desc: "Odds, splits, and line movement refresh continuously. You always have the current picture when you need it most — before first pitch.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <polyline points="23 4 23 10 17 10" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" stroke="#39FF14" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

export default function TrustBoundary() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="w-full"
      style={{ padding: "5rem clamp(16px, 4vw, 64px)", background: "rgba(255,255,255,0.01)" }}
    >
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
            Built for Serious Bettors,
            <br />
            <span style={{ color: "#39FF14" }}>Not Blind Tailing.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
            We built this for bettors who want to understand why before they bet.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {POINTS.map((p, i) => (
            <motion.div
              key={p.title}
              initial={shouldReduce ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="rounded-xl p-6 flex flex-col gap-3"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "10px",
                    background: "rgba(57,255,20,0.08)",
                    border: "1px solid rgba(57,255,20,0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {p.icon}
                </div>
                <h3 className="font-bold text-white" style={{ fontSize: "15px" }}>
                  {p.title}
                </h3>
              </div>
              <p className="text-[#9ca3af] leading-relaxed" style={{ fontSize: "13px" }}>
                {p.desc}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Compliance note */}
        <motion.p
          initial={shouldReduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center text-[#4b5563] mt-8"
          style={{ fontSize: "12px", maxWidth: "60ch", margin: "2rem auto 0" }}
        >
          AI Sports Betting Models is an analytics and research platform. We do not facilitate wagering, guarantee outcomes, or provide financial advice. Sports betting involves risk. Bet responsibly.
        </motion.p>
      </div>
    </section>
  );
}
