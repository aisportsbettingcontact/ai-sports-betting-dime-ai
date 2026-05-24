/**
 * FeatureShowcase.tsx
 *
 * 4-feature showcase.
 * - model-projections, daily-lineups, cheat-sheets: real UI screenshots
 * - betting-splits: live interactive demo (BettingSplitsDemo)
 *
 * Layout: alternating left/right on desktop, stacked on mobile.
 */

import { motion, useReducedMotion } from "framer-motion";
import BettingSplitsDemo from "./BettingSplitsDemo";

interface StaticFeature {
  id: string;
  label: string;
  headline: string;
  description: string;
  type: "image";
  imgUrl: string;
  imgAlt: string;
}

interface InteractiveFeature {
  id: string;
  label: string;
  headline: string;
  description: string;
  type: "interactive";
  component: React.ReactNode;
}

type Feature = StaticFeature | InteractiveFeature;

const FEATURES: Feature[] = [
  {
    id: "model-projections",
    type: "image",
    label: "AI Model Projections",
    headline: "Book vs. Model. Side by side.",
    description:
      "Our models price every spread, total, and moneyline. See exactly where the edge is — and how much.",
    imgUrl: "/manus-storage/feature-model-projections_ae909adc.jpeg",
    imgAlt: "AI Model Projections — Book vs Model odds comparison",
  },
  {
    id: "betting-splits",
    type: "interactive",
    label: "Betting Splits",
    headline: "Follow the money, not the crowd.",
    description:
      "Real-time ticket and money percentages across spreads, totals, and moneylines. Know where sharp action is moving.",
    component: <BettingSplitsDemo />,
  },
  {
    id: "daily-lineups",
    type: "image",
    label: "Daily Lineups",
    headline: "Starting pitchers. Batting orders. Confirmed.",
    description:
      "Full lineup cards with player photos, positions, handedness, and pitcher stats — updated as confirmations come in.",
    imgUrl: "/manus-storage/feature-daily-lineups_4bdb1e2c.jpeg",
    imgAlt: "Daily Lineups — Starting pitchers and batting order",
  },
  {
    id: "cheat-sheets",
    type: "image",
    label: "Cheat Sheets",
    headline: "NRFI, props, and edge signals — all in one view.",
    description:
      "Quick-scan cheat sheets surface the highest-edge plays of the day. Book price, model price, and ROI signal in one row.",
    imgUrl: "/manus-storage/feature-cheat-sheets_3b5d7079.jpeg",
    imgAlt: "Cheat Sheets — NRFI edge signal with Book vs Model",
  },
];

export default function FeatureShowcase() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      id="features"
      className="py-14 px-4 sm:px-6 lg:px-8"
      style={{ background: "#050810" }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white"
            style={{ letterSpacing: "-0.03em" }}
          >
            Everything you need to bet smarter.
          </h2>
        </motion.div>

        {/* Feature rows */}
        <div className="flex flex-col gap-14">
          {FEATURES.map((feature, i) => {
            const isEven = i % 2 === 0;

            return (
              <motion.div
                key={feature.id}
                initial={shouldReduce ? false : { opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className={`flex flex-col ${
                  isEven ? "lg:flex-row" : "lg:flex-row-reverse"
                } items-center gap-8 lg:gap-14`}
              >
                {/* Text side */}
                <div className="flex-1 flex flex-col gap-3 text-center lg:text-left">
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

                {/* Visual side */}
                <div className="flex-1 w-full">
                  {feature.type === "interactive" ? (
                    /* Interactive demo — no wrapper border/shadow (component handles it) */
                    feature.component
                  ) : (
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
                        onError={(e) => {
                          console.error(
                            `[FeatureShowcase] Failed to load image: ${feature.imgUrl}`,
                            e
                          );
                        }}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
