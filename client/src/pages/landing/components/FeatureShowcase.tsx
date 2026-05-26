/**
 * FeatureShowcase.tsx
 *
 * 4-feature showcase with fluid responsive layout.
 * - Alternating left/right on desktop, stacked on mobile.
 * - Images scale to fill flex-[1.4] column (wider than text).
 * - Text column is flex-1 with fluid font sizes.
 * - No em dashes in copy.
 * - Tight vertical gaps — no dead zones.
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
      "Our models price every spread, total, and moneyline. See exactly where the edge is and how much.",
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
      "Full lineup cards with player photos, positions, handedness, and pitcher stats. Updated as confirmations come in.",
    imgUrl: "/manus-storage/feature-daily-lineups_4bdb1e2c.jpeg",
    imgAlt: "Daily Lineups — Starting pitchers and batting order",
  },
  {
    id: "cheat-sheets",
    type: "image",
    label: "Cheat Sheets",
    headline: "NRFI, props, and edge signals. All in one view.",
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
      className="w-full"
      style={{ background: "#050810", padding: "2rem clamp(16px, 4vw, 64px) 3rem" }}
    >
      <div className="max-w-screen-2xl mx-auto">
        {/* Section header — tight bottom margin */}
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <h2
            className="font-bold text-white"
            style={{
              letterSpacing: "-0.03em",
              fontSize: "clamp(1.75rem, 3vw, 3rem)",
            }}
          >
            Everything you need to bet smarter.
          </h2>
        </motion.div>

        {/* Feature rows — tighter gap between rows */}
        <div className="flex flex-col gap-10">
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
                } items-stretch gap-6 lg:gap-10`}
              >
                {/* Text side — flex-1, vertically centered */}
                <div className="flex-1 flex flex-col justify-center gap-4 text-center lg:text-left">
                  <span
                    className="text-[11px] font-bold tracking-widest uppercase"
                    style={{ color: "#39FF14" }}
                  >
                    {feature.label}
                  </span>
                  <h3
                    className="font-bold text-white"
                    style={{
                      letterSpacing: "-0.025em",
                      fontSize: "clamp(1.5rem, 2.5vw, 2.5rem)",
                    }}
                  >
                    {feature.headline}
                  </h3>
                  <p
                    className="text-[#9ca3af] leading-relaxed"
                    style={{ fontSize: "clamp(0.95rem, 1.3vw, 1.15rem)" }}
                  >
                    {feature.description}
                  </p>
                </div>

                {/* Visual side — flex-[1.4] so images are wider than text */}
                <div className="flex-[1.4] w-full min-w-0">
                  {feature.type === "interactive" ? (
                    feature.component
                  ) : (
                    <div
                      className="rounded-xl overflow-hidden border border-white/10 w-full"
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
                            `[FeatureShowcase] [FAIL] Image load error: ${feature.imgUrl}`,
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
