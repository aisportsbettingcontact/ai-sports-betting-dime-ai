import { motion, useReducedMotion } from "framer-motion";

const STEPS = [
  {
    num: "01",
    title: "Ingest",
    copy: "Odds, lines, splits, schedules, teams, players, and available market data.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    num: "02",
    title: "Normalize",
    copy: "Remove vig, standardize markets, map teams, clean stale data, and align sportsbook prices.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    num: "03",
    title: "Model",
    copy: "Generate fair projections, win probabilities, totals, spreads, props, and simulation outputs.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    num: "04",
    title: "Surface",
    copy: "Display the clearest model edges with ROI, confidence, and supporting market context.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

export default function HowItWorks() {
  const shouldReduce = useReducedMotion();

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white mb-4"
            style={{ letterSpacing: "-0.03em" }}
          >
            From Raw Odds To Actionable Edges.
          </h2>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 relative">
          {/* Connecting line on desktop */}
          <div
            className="absolute top-10 left-[12.5%] right-[12.5%] h-px hidden lg:block"
            style={{ background: "linear-gradient(90deg, transparent 0%, rgba(57,255,20,0.3) 20%, rgba(57,255,20,0.3) 80%, transparent 100%)" }}
          />

          {STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              initial={shouldReduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className="relative flex flex-col items-center text-center gap-4"
            >
              {/* Icon circle */}
              <div
                className="relative z-10 w-20 h-20 rounded-full flex flex-col items-center justify-center gap-1"
                style={{
                  background: "rgba(10,14,22,0.98)",
                  border: "1px solid rgba(57,255,20,0.25)",
                  boxShadow: "0 0 24px rgba(57,255,20,0.08)",
                }}
              >
                {step.icon}
                <span className="text-[9px] font-black text-[#39FF14] tracking-widest">{step.num}</span>
              </div>

              <div>
                <h3 className="text-[16px] font-bold text-white mb-2" style={{ letterSpacing: "-0.02em" }}>
                  {step.title}
                </h3>
                <p className="text-[13px] text-[#9ca3af] leading-relaxed">{step.copy}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
