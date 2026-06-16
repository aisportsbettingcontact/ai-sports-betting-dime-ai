import { motion, useReducedMotion } from "framer-motion";

const STEPS = [
  {
    num: "01",
    title: "Check Today's Projections",
    desc: "See AI-generated win probabilities for every game. Identify where the model price diverges from the current book line.",
  },
  {
    num: "02",
    title: "Review Betting Splits",
    desc: "Check public money percentages and sharp-side indicators. See where the money is going and whether the line is moving with or against the public.",
  },
  {
    num: "03",
    title: "Verify the Lineup",
    desc: "Confirm starting pitchers, batting orders, and any late scratches before placing your bet. Lineup data updates as confirmations come in.",
  },
  {
    num: "04",
    title: "Analyze Line Movement",
    desc: "Track how the line moved from open to current. Identify steam moves and reverse line movement that signal sharp positioning.",
  },
  {
    num: "05",
    title: "Bet with Full Context",
    desc: "You have done the research. You have the model output, the market data, and the splits. Now make your decision with a complete picture.",
  },
];

export default function MarketWorkflow() {
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
            A Cleaner Workflow
            <br />
            <span style={{ color: "#39FF14" }}>Before Every Bet.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
            Five steps. One platform. No more tab-switching.
          </p>
        </motion.div>

        <div className="flex flex-col gap-0 relative">
          {/* Vertical connecting line */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "calc(clamp(12px, 2.5vw, 20px) + 13px)",
              top: "40px",
              bottom: "40px",
              width: "1px",
              background: "linear-gradient(180deg, rgba(57,255,20,0.3) 0%, rgba(57,255,20,0.05) 100%)",
            }}
          />

          {STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              initial={shouldReduce ? false : { opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="flex items-start gap-5 rounded-xl p-5 relative"
              style={{
                background: i === 4 ? "rgba(57,255,20,0.04)" : "rgba(255,255,255,0.03)",
                border: i === 4 ? "1px solid rgba(57,255,20,0.15)" : "1px solid rgba(255,255,255,0.07)",
                marginBottom: i < STEPS.length - 1 ? "8px" : "0",
              }}
            >
              {/* Step number circle */}
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: i === 4 ? "#39FF14" : "rgba(57,255,20,0.12)",
                  border: `1px solid ${i === 4 ? "#39FF14" : "rgba(57,255,20,0.3)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  zIndex: 1,
                  position: "relative",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    color: i === 4 ? "#000" : "#39FF14",
                    lineHeight: 1,
                  }}
                >
                  {step.num}
                </span>
              </div>
              <div>
                <h3 className="font-bold text-white mb-1" style={{ fontSize: "15px" }}>
                  {step.title}
                </h3>
                <p className="text-[#9ca3af] leading-relaxed" style={{ fontSize: "13px" }}>
                  {step.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
