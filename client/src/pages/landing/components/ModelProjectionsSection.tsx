import { motion, useReducedMotion } from "framer-motion";
import { SPORTS_COVERAGE } from "../lib/mock-data";

export default function ModelProjectionsSection() {
  const shouldReduce = useReducedMotion();

  return (
    <section id="sports-coverage" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-6"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white mb-4"
            style={{ letterSpacing: "-0.03em" }}
          >
            Model Projections Across Every Key Market.
          </h2>
          <p className="text-[#9ca3af] text-lg max-w-2xl mx-auto">
            View independent model numbers, fair prices, projected outcomes, and
            ROI signals across major sports and betting markets.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
          {SPORTS_COVERAGE.map((sport, i) => (
            <motion.div
              key={sport.sport}
              initial={shouldReduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07, duration: 0.4 }}
              className={`group relative rounded-xl border p-6 flex flex-col gap-4 transition-all duration-200 ${
                sport.status === "available"
                  ? "border-white/8 hover:border-[#39FF14]/30 hover:-translate-y-0.5 cursor-pointer"
                  : "border-white/5 opacity-60"
              }`}
              style={{ background: "rgba(10,14,22,0.95)" }}
            >
              {/* Status badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl leading-none">{sport.emoji}</span>
                  <span className="text-[15px] font-bold text-white" style={{ letterSpacing: "-0.02em" }}>
                    {sport.sport}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-wide ${
                    sport.status === "available"
                      ? "bg-[#39FF14]/15 text-[#39FF14]"
                      : "bg-white/8 text-[#6b7280]"
                  }`}
                >
                  {sport.status === "available" ? "LIVE" : "COMING SOON"}
                </span>
              </div>

              {/* Markets */}
              <div className="flex flex-wrap gap-1.5">
                {sport.markets.map((m) => (
                  <span
                    key={m}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-[#9ca3af] border border-white/8"
                    style={{ background: "rgba(255,255,255,0.03)" }}
                  >
                    {m}
                  </span>
                ))}
              </div>

              {/* Top edge */}
              {sport.topEdge && (
                <div className="pt-3 border-t border-white/5">
                  <span className="text-[10px] text-[#6b7280] block mb-0.5">Top Edge</span>
                  <span className="text-[13px] font-bold" style={{ color: "#39FF14" }}>
                    {sport.topEdge}
                  </span>
                </div>
              )}

              {/* Updated */}
              <div className="flex items-center justify-between mt-auto pt-2">
                <span className="text-[11px] text-[#4b5563]">
                  {sport.updatedAt}
                </span>
                {sport.status === "available" && (
                  <a
                    href="/feed"
                    className="text-[11px] font-bold text-[#39FF14] opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                  >
                    View Edges →
                  </a>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
