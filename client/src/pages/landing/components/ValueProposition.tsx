import { motion, useReducedMotion } from "framer-motion";

const CARDS = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
    title: "Model-Originated Lines",
    copy: "The platform creates independent projections instead of only reacting to sportsbook prices.",
    detail: "Our models run statistical simulations using team performance data, historical trends, and market signals — generating fair lines before the public shapes them.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
      </svg>
    ),
    title: "No-Vig Fair Odds",
    copy: "Markets are normalized so you can compare true probability instead of juiced book pricing.",
    detail: "We strip the sportsbook margin from every market to expose the implied probability the book actually believes — not the inflated price you're being offered.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
    title: "ROI-Based Edge Detection",
    copy: "The platform highlights where model probability is stronger than the market price.",
    detail: "When the model's win probability exceeds the market's implied probability, the system flags the gap as a positive ROI signal — giving you a clear, data-backed reason to consider the bet.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "Betting Splits Intelligence",
    copy: "Ticket and money percentages help reveal where the public is betting and where the money is moving.",
    detail: "When ticket percentage and money percentage diverge, it often signals sharp action on the minority side. The platform surfaces these divergences clearly.",
  },
];

export default function ValueProposition() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      style={{ padding: "6rem clamp(16px, 4vw, 64px)", background: "rgba(5,8,16,0.8)" }}
    >
      <div className="max-w-screen-2xl mx-auto">
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
            Stop Guessing. Start Comparing
            <br className="hidden sm:block" /> The Market Against The Model.
          </h2>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={shouldReduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="group relative rounded-xl border border-white/8 p-6 flex flex-col gap-4 cursor-default transition-all duration-200 hover:border-[#39FF14]/25 hover:bg-white/3"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              {/* Subtle glow on hover */}
              <div
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(57,255,20,0.06) 0%, transparent 70%)",
                }}
              />
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(57,255,20,0.1)" }}>
                {card.icon}
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-white mb-2" style={{ letterSpacing: "-0.02em" }}>
                  {card.title}
                </h3>
                <p className="text-[13px] text-[#9ca3af] leading-relaxed">{card.copy}</p>
              </div>
              {/* Expanded detail on hover */}
              <div className="overflow-hidden max-h-0 group-hover:max-h-24 transition-all duration-300">
                <p className="text-[12px] text-[#6b7280] leading-relaxed pt-2 border-t border-white/5">
                  {card.detail}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
