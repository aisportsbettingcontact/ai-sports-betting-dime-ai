/**
 * FeatureShowcase.tsx
 *
 * 4-feature showcase using real UI screenshots.
 * Layout: alternating left/right on desktop, stacked on mobile.
 * Each feature: label + headline + 1-line description + screenshot.
 *
 * CDN URLs are permanent webdev-hosted assets — no expiry.
 */

import { motion, useReducedMotion } from "framer-motion";

const FEATURES = [
  {
    id: "model-projections",
    label: "AI Model Projections",
    headline: "Book vs. Model. Side by side.",
    description:
      "Our models price every spread, total, and moneyline. See exactly where the edge is — and how much.",
    imgUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/manus-storage/feature-model-projections_2a6e6afa.jpeg",
    imgAlt: "AI Model Projections — Book vs Model odds comparison",
  },
  {
    id: "betting-splits",
    label: "Betting Splits",
    headline: "Follow the money, not the crowd.",
    description:
      "Real-time ticket and money percentages across spreads, totals, and moneylines. Know where sharp action is moving.",
    imgUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/manus-storage/feature-betting-splits_8ac62dc6.jpeg",
    imgAlt: "Betting Splits — Ticket and money percentage bars",
  },
  {
    id: "daily-lineups",
    label: "Daily Lineups",
    headline: "Starting pitchers. Batting orders. Confirmed.",
    description:
      "Full lineup cards with player photos, positions, handedness, and pitcher stats — updated as confirmations come in.",
    imgUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/manus-storage/feature-daily-lineups_f1d776a4.jpeg",
    imgAlt: "Daily Lineups — Starting pitchers and batting order",
  },
  {
    id: "cheat-sheets",
    label: "Cheat Sheets",
    headline: "NRFI, props, and edge signals — all in one view.",
    description:
      "Quick-scan cheat sheets surface the highest-edge plays of the day. Book price, model price, and ROI signal in one row.",
    imgUrl:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663397752079/MW3FicTy7ae3qrm8dx8Lua/manus-storage/feature-cheat-sheets_fb04ef82.jpeg",
    imgAlt: "Cheat Sheets — NRFI edge signal with Book vs Model",
  },
];

export default function FeatureShowcase() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="py-20 px-4 sm:px-6 lg:px-8"
      style={{ background: "#050810" }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white"
            style={{ letterSpacing: "-0.03em" }}
          >
            Everything you need to bet smarter.
          </h2>
        </motion.div>

        {/* Feature rows */}
        <div className="flex flex-col gap-20">
          {FEATURES.map((feature, i) => {
            const isEven = i % 2 === 0;

            return (
              <motion.div
                key={feature.id}
                initial={shouldReduce ? false : { opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.55, ease: "easeOut" }}
                className={`flex flex-col ${
                  isEven ? "lg:flex-row" : "lg:flex-row-reverse"
                } items-center gap-10 lg:gap-16`}
              >
                {/* Text side */}
                <div className="flex-1 flex flex-col gap-4 text-center lg:text-left">
                  <span
                    className="text-[11px] font-bold tracking-widest uppercase"
                    style={{ color: "#39FF14" }}
                  >
                    {feature.label}
                  </span>
                  <h3
                    className="text-2xl sm:text-3xl font-bold text-white"
                    style={{ letterSpacing: "-0.025em" }}
                  >
                    {feature.headline}
                  </h3>
                  <p className="text-[#9ca3af] text-base leading-relaxed max-w-sm mx-auto lg:mx-0">
                    {feature.description}
                  </p>
                </div>

                {/* Screenshot side */}
                <div className="flex-1 w-full">
                  <div
                    className="rounded-xl overflow-hidden border border-white/10"
                    style={{
                      boxShadow:
                        "0 0 40px rgba(57,255,20,0.04), 0 16px 48px rgba(0,0,0,0.5)",
                    }}
                  >
                    <img
                      src={feature.imgUrl}
                      alt={feature.imgAlt}
                      className="w-full h-auto block"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
