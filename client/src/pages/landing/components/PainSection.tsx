import { motion, useReducedMotion } from "framer-motion";

const PAIN_POINTS = [
  "Jumping between 4 different sites to find splits, lines, and lineups",
  "Getting picks from someone who does not show their work",
  "Betting on gut feel because the data is too scattered to use",
  "Missing line movement because you checked too late",
  "Paying for tools that give you data but no context",
];

const FIX_POINTS = [
  "One dashboard: model odds, book odds, splits, and lineups side by side",
  "No picks — just the raw model output and market data you interpret yourself",
  "Structured pre-bet research with probability distributions on every game",
  "Real-time line movement and sharp money indicators before you act",
  "Data + context: see where the model disagrees with the market and why",
];

export default function PainSection() {
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
          className="text-center mb-10"
        >
          <h2
            className="font-bold text-white"
            style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}
          >
            Most Bettors Are Still
            <br />
            <span style={{ color: "#39FF14" }}>Researching the Hard Way.</span>
          </h2>
          <p
            className="text-[#9ca3af] mt-4"
            style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)", maxWidth: "56ch", margin: "1rem auto 0" }}
          >
            If your pre-bet research looks like this, you are making decisions on incomplete information before you even place a bet.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Pain column */}
          <motion.div
            initial={shouldReduce ? false : { opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <div
              className="rounded-xl p-5 mb-3"
              style={{ background: "rgba(255,59,48,0.04)", border: "1px solid rgba(255,59,48,0.1)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    background: "rgba(255,59,48,0.15)",
                    border: "1px solid rgba(255,59,48,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    color: "#ef4444",
                    fontWeight: 700,
                  }}
                >
                  ✕
                </div>
                <span className="font-bold text-[#ef4444] text-[13px] uppercase tracking-wider">Without the Dashboard</span>
              </div>
              <ul className="flex flex-col gap-3">
                {PAIN_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="text-red-500 mt-0.5 shrink-0 text-[12px]">✕</span>
                    <span className="text-[#9ca3af] text-[13px] leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          {/* Fix column */}
          <motion.div
            initial={shouldReduce ? false : { opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.18 }}
          >
            <div
              className="rounded-xl p-5 mb-3"
              style={{ background: "rgba(57,255,20,0.04)", border: "1px solid rgba(57,255,20,0.15)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <div
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    background: "rgba(57,255,20,0.15)",
                    border: "1px solid rgba(57,255,20,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    color: "#39FF14",
                    fontWeight: 700,
                  }}
                >
                  ✓
                </div>
                <span className="font-bold text-[13px] uppercase tracking-wider" style={{ color: "#39FF14" }}>With AI Sports Betting Models</span>
              </div>
              <ul className="flex flex-col gap-3">
                {FIX_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[12px]" style={{ color: "#39FF14" }}>✓</span>
                    <span className="text-[#d1d5db] text-[13px] leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>

        <motion.p
          initial={shouldReduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center text-[#9ca3af] mt-8 text-[14px]"
        >
          One dashboard. Everything you need. Before you bet.
        </motion.p>
      </div>
    </section>
  );
}
