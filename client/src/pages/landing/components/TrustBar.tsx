import { motion, useReducedMotion } from "framer-motion";

const PROOF_POINTS = [
  { icon: "⚡", label: "Model Projections" },
  { icon: "📊", label: "No-Vig Fair Odds" },
  { icon: "📈", label: "ROI Signals" },
  { icon: "🔀", label: "Betting Splits" },
  { icon: "📉", label: "Market Movement" },
  { icon: "🏟️", label: "Multi-Sport Coverage" },
];

export default function TrustBar() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      className="relative border-y border-white/8 overflow-hidden"
      style={{
        background:
          "linear-gradient(90deg, rgba(57,255,20,0.03) 0%, rgba(10,14,22,0.95) 50%, rgba(57,255,20,0.03) 100%)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {PROOF_POINTS.map((pt, i) => (
            <motion.div
              key={pt.label}
              initial={shouldReduce ? false : { opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              className="flex items-center gap-2"
            >
              <span className="text-base leading-none">{pt.icon}</span>
              <span className="text-[12px] font-semibold text-[#9ca3af] tracking-wide whitespace-nowrap">
                {pt.label}
              </span>
              {i < PROOF_POINTS.length - 1 && (
                <span
                  className="hidden sm:block w-px h-3 ml-4"
                  style={{ background: "rgba(57,255,20,0.25)" }}
                />
              )}
            </motion.div>
          ))}
        </div>
        <p className="text-center text-[11px] text-[#4b5563] mt-3">
          Built for disciplined bettors · Compare the model against the market · See where probability and price disagree
        </p>
      </div>
    </section>
  );
}
