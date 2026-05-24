import { motion, useReducedMotion } from "framer-motion";

const FEATURES = [
  { label: "AI Model Projections", copy: "Independent win probabilities and fair lines for every game.", tag: "Live" },
  { label: "No-Vig Fair Odds", copy: "Vig-stripped market prices showing true implied probability.", tag: "Live" },
  { label: "ROI Calculations", copy: "Expected value signals based on model vs. market gap.", tag: "Live" },
  { label: "Betting Splits", copy: "Ticket % and money % to track public and sharp action.", tag: "Live" },
  { label: "Sportsbook Line Comparison", copy: "Book price stacked directly against model price.", tag: "Live" },
  { label: "Market Movement Tracking", copy: "Opening vs. current line to reveal how markets shift.", tag: "Live" },
  { label: "Public vs. Sharp Indicators", copy: "Divergence signals when money and tickets disagree.", tag: "Live" },
  { label: "Game-Level Simulations", copy: "Monte Carlo simulation outputs for spreads and totals.", tag: "Live" },
  { label: "Team-Level Dashboards", copy: "Per-team schedule, performance trends, and model history.", tag: "Live" },
  { label: "Player Prop Modeling", copy: "Strikeout props, home run props, and more.", tag: "Live" },
  { label: "Daily Card Filtering", copy: "Filter by sport, market, confidence, and edge size.", tag: "Live" },
  { label: "Edge Sorting", copy: "Sort all markets by ROI, confidence, or edge percentage.", tag: "Live" },
  { label: "Confidence Tiers", copy: "HIGH / MED / LOW confidence labels on every projection.", tag: "Live" },
  { label: "Real-Time Refresh States", copy: "Timestamps and live indicators show data freshness.", tag: "Live" },
  { label: "Historical Backtesting", copy: "Model performance audit across past seasons.", tag: "Preview" },
  { label: "Mobile-First Experience", copy: "Fully optimized for phones and tablets.", tag: "Live" },
  { label: "Beginner Tooltips", copy: "Plain-English explanations for every betting concept.", tag: "Live" },
  { label: "Advanced Mode", copy: "Full probability, no-vig, and EV data for sharp users.", tag: "Live" },
  { label: "Pricing Normalization", copy: "All markets converted to consistent probability format.", tag: "Live" },
  { label: "Fast Decision Dashboard", copy: "Designed to surface the best bets in under 10 seconds.", tag: "Live" },
];

const TAG_STYLES: Record<string, string> = {
  Live: "bg-[#39FF14]/15 text-[#39FF14]",
  Preview: "bg-amber-500/15 text-amber-400",
  "Coming Soon": "bg-white/8 text-[#6b7280]",
};

export default function FeatureGrid() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="py-24 px-4 sm:px-6 lg:px-8"
      style={{ background: "rgba(5,8,16,0.9)" }}
    >
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
            Everything A Serious Bettor Needs
            <br className="hidden sm:block" /> In One Platform.
          </h2>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.label}
              initial={shouldReduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: (i % 8) * 0.04, duration: 0.35 }}
              className="group rounded-xl border border-white/6 p-4 flex flex-col gap-2 hover:border-white/15 hover:bg-white/3 transition-all duration-150"
              style={{ background: "rgba(255,255,255,0.015)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-white" style={{ letterSpacing: "-0.01em" }}>
                  {f.label}
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide whitespace-nowrap ${TAG_STYLES[f.tag] || TAG_STYLES["Coming Soon"]}`}>
                  {f.tag}
                </span>
              </div>
              <p className="text-[12px] text-[#6b7280] leading-relaxed">{f.copy}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
