import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const STEPS = [
  {
    num: "01",
    title: "Sportsbooks post a market.",
    beginner: "A sportsbook opens a game with a price — like LAD -142 on the moneyline.",
    advanced: "The book sets an opening line based on their own models, public perception, and liability management. The price includes a vig (margin) built in.",
  },
  {
    num: "02",
    title: "The platform removes the vig.",
    beginner: "We strip out the sportsbook's profit margin to find the true implied probability.",
    advanced: "Using standard vig-removal formulas, we convert both sides of the market to their no-vig probabilities. This exposes what the book actually believes — not the inflated price.",
  },
  {
    num: "03",
    title: "The AI model creates an independent projection.",
    beginner: "Our model runs its own analysis and generates a separate win probability for each team.",
    advanced: "The model ingests team performance data, historical matchup trends, lineup information, and market signals to generate independent win probabilities and fair odds for every market.",
  },
  {
    num: "04",
    title: "The system compares model vs. market probability.",
    beginner: "We compare what the model thinks vs. what the sportsbook's price implies.",
    advanced: "Model probability is stacked against no-vig market probability. The delta between the two is the raw edge signal before ROI calculation.",
  },
  {
    num: "05",
    title: "Positive differences become ROI signals.",
    beginner: "If the model thinks a team should win 56% of the time but the book's price implies 52%, that gap is flagged as a potential edge.",
    advanced: "ROI = (Model Win Probability × Net Payout) − Loss Probability. Positive ROI signals appear when model probability exceeds market-implied probability after vig removal.",
  },
];

export default function EdgeExplanation() {
  const [mode, setMode] = useState<"beginner" | "advanced">("beginner");
  const shouldReduce = useReducedMotion();

  return (
    <section
      id="how-it-works"
      className="py-24 px-4 sm:px-6 lg:px-8"
      style={{ background: "rgba(5,8,16,0.9)" }}
    >
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white mb-4"
            style={{ letterSpacing: "-0.03em" }}
          >
            How The Platform Finds Positive ROI.
          </h2>
          <p className="text-[#9ca3af] text-base mb-6">
            An edge appears when the model's fair probability is higher than the market's implied probability.
          </p>

          {/* Beginner / Advanced toggle */}
          <div
            className="inline-flex gap-1 p-1 rounded-lg"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {(["beginner", "advanced"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-md text-[12px] font-bold transition-all duration-150 capitalize ${
                  mode === m
                    ? "text-white bg-white/10"
                    : "text-[#6b7280] hover:text-[#9ca3af]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          {/* Vertical line */}
          <div
            className="absolute left-8 top-0 bottom-0 w-px hidden sm:block"
            style={{ background: "linear-gradient(180deg, transparent 0%, rgba(57,255,20,0.3) 20%, rgba(57,255,20,0.3) 80%, transparent 100%)" }}
          />

          <div className="space-y-6">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                initial={shouldReduce ? false : { opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                className="flex gap-6 sm:gap-8"
              >
                {/* Step number */}
                <div className="flex-shrink-0 w-16 flex flex-col items-center">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black z-10"
                    style={{ background: "rgba(57,255,20,0.15)", border: "1px solid rgba(57,255,20,0.3)", color: "#39FF14" }}
                  >
                    {step.num}
                  </div>
                </div>

                {/* Content */}
                <div
                  className="flex-1 rounded-xl border border-white/8 p-5 mb-2"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <h3 className="text-[15px] font-bold text-white mb-2" style={{ letterSpacing: "-0.02em" }}>
                    {step.title}
                  </h3>
                  <p className="text-[13px] text-[#9ca3af] leading-relaxed">
                    {mode === "beginner" ? step.beginner : step.advanced}
                  </p>

                  {/* Advanced mode: show formula on last step */}
                  {mode === "advanced" && i === 4 && (
                    <div
                      className="mt-3 p-3 rounded-lg font-mono text-[12px]"
                      style={{ background: "rgba(57,255,20,0.06)", border: "1px solid rgba(57,255,20,0.15)" }}
                    >
                      <span className="text-[#6b7280]">ROI = </span>
                      <span style={{ color: "#39FF14" }}>
                        (Model Win% × Net Payout)
                      </span>
                      <span className="text-[#6b7280]"> − Loss%</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-[11px] text-[#4b5563] mt-10">
          This platform provides betting analytics and decision-support tools. It does not guarantee outcomes. Bet responsibly.
        </p>
      </div>
    </section>
  );
}
