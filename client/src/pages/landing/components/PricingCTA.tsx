import { motion, useReducedMotion } from "framer-motion";

const PLANS = [
  {
    id: "monthly",
    name: "Monthly",
    price: "$49",
    period: "/month",
    description: "Full access to all models, projections, splits, and edge tools. Cancel anytime.",
    features: [
      "All AI model projections",
      "Betting splits & money %",
      "No-vig fair odds",
      "ROI edge signals",
      "Multi-sport coverage",
      "Mobile-optimized dashboard",
    ],
    cta: "Start Monthly",
    highlight: false,
  },
  {
    id: "annual",
    name: "Annual",
    price: "$399",
    period: "/year",
    badge: "Save 32%",
    description: "Best value. Lock in full-year access at a significant discount versus monthly.",
    features: [
      "Everything in Monthly",
      "Priority model updates",
      "Historical backtesting access",
      "Advanced simulation outputs",
      "Early access to new sports",
      "Dedicated support",
    ],
    cta: "Start Annual",
    highlight: true,
  },
];

export default function PricingCTA() {
  const shouldReduce = useReducedMotion();

  return (
    <section
      id="pricing"
      className="py-24 px-4 sm:px-6 lg:px-8"
      style={{
        background:
          "radial-gradient(ellipse 80% 50% at 50% 100%, rgba(57,255,20,0.05) 0%, transparent 60%), rgba(5,8,16,0.95)",
      }}
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
            One Subscription. Full Access.
          </h2>
          <p className="text-[#9ca3af] text-lg">
            No tiers. No feature gating. Every tool, every sport, every model.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-5">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={shouldReduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className={`relative rounded-xl border p-8 flex flex-col gap-6 ${
                plan.highlight
                  ? "border-[#39FF14]/40"
                  : "border-white/10"
              }`}
              style={{
                background: plan.highlight
                  ? "linear-gradient(145deg, rgba(57,255,20,0.05) 0%, rgba(10,14,22,0.98) 100%)"
                  : "rgba(10,14,22,0.95)",
                boxShadow: plan.highlight
                  ? "0 0 40px rgba(57,255,20,0.08)"
                  : "none",
              }}
            >
              {plan.badge && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold text-black"
                  style={{ background: "#39FF14" }}
                >
                  {plan.badge}
                </div>
              )}

              <div>
                <span className="text-[12px] font-bold text-[#6b7280] tracking-widest uppercase">
                  {plan.name}
                </span>
                <div className="flex items-baseline gap-1 mt-2">
                  <span
                    className="text-4xl font-black text-white"
                    style={{ letterSpacing: "-0.04em" }}
                  >
                    {plan.price}
                  </span>
                  <span className="text-[#6b7280] text-sm">{plan.period}</span>
                </div>
                <p className="text-[13px] text-[#9ca3af] mt-2 leading-relaxed">
                  {plan.description}
                </p>
              </div>

              <ul className="space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-[13px] text-[#d1d5db]">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="flex-shrink-0"
                    >
                      <circle cx="7" cy="7" r="7" fill="rgba(57,255,20,0.15)" />
                      <path
                        d="M4.5 7l1.8 1.8L9.5 5.5"
                        stroke="#39FF14"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <a
                href="/feed"
                className={`mt-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-bold text-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98] ${
                  plan.highlight
                    ? "text-black"
                    : "text-white border border-white/15 bg-white/5 hover:bg-white/10"
                }`}
                style={
                  plan.highlight ? { background: "#39FF14" } : {}
                }
              >
                {plan.cta}
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </motion.div>
          ))}
        </div>

        <p className="text-center text-[11px] text-[#4b5563] mt-6">
          Payments processed securely by Stripe. Cancel anytime. Apple Pay, Google Pay, Affirm, Afterpay, and Klarna accepted.
        </p>
      </div>
    </section>
  );
}
