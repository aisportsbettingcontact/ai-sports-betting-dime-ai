import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const FAQS = [
  {
    q: "What exactly does this platform give me?",
    a: "AI Sports Betting gives you AI-generated model projections, no-vig fair odds, ROI edge signals, betting splits (ticket % and money %), and market movement data across major sports. It's a betting intelligence dashboard, not a pick service.",
  },
  {
    q: "Does this platform guarantee wins?",
    a: "No. No betting platform can guarantee outcomes. What this platform does is surface data-backed probability comparisons between the model and the market. Positive ROI signals indicate where the model sees value. They do not guarantee results. Bet responsibly.",
  },
  {
    q: "What is a 'no-vig' price?",
    a: "Sportsbooks build a profit margin (vig or juice) into every price. A no-vig price strips that margin out to show the true implied probability the book believes. This gives you a cleaner comparison point against the model.",
  },
  {
    q: "What does ROI signal mean?",
    a: "ROI (Return on Investment) signal = (Model Win Probability × Net Payout) − Loss Probability. When the result is positive, the model sees more value in the bet than the market price implies. It's a mathematical edge indicator, not a guarantee.",
  },
  {
    q: "What sports are covered?",
    a: "Currently: MLB, NBA, NFL, NHL, NCAAB, NCAAF, WNBA, and NWSL. Additional sports are in development and will be added throughout the year.",
  },
  {
    q: "How often is the data updated?",
    a: "Odds and lines update hourly during active hours (3 AM – midnight PST). Model projections update daily. Betting splits refresh throughout the day as sportsbooks report new data.",
  },
  {
    q: "Can I cancel my subscription?",
    a: "Yes. Cancel anytime from your account settings. No contracts, no cancellation fees. Your access continues until the end of your current billing period.",
  },
  {
    q: "What payment methods are accepted?",
    a: "Visa, Mastercard, Amex, Discover, Apple Pay, Google Pay, Affirm, Afterpay, and Klarna. All payments are processed securely by Stripe.",
  },
  {
    q: "Is this legal?",
    a: "The platform provides sports betting analytics and data tools. It does not accept wagers or operate as a sportsbook. Use of the platform is legal in all jurisdictions. Placing bets at sportsbooks is subject to the laws of your jurisdiction.",
  },
  {
    q: "Is there a free trial?",
    a: "There is no free trial at this time. You can view sample data on this page to evaluate the platform before subscribing. If you have questions, contact support.",
  },
];

function FAQItem({ faq, idx }: { faq: { q: string; a: string }; idx: number }) {
  const [open, setOpen] = useState(false);
  const shouldReduce = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduce ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: (idx % 5) * 0.05, duration: 0.35 }}
      className="border-b border-white/8 last:border-0"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#39FF14] rounded"
        aria-expanded={open}
      >
        <span className="text-[14px] font-semibold text-white leading-snug">{faq.q}</span>
        <span
          className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-transform duration-200"
          style={{
            background: open ? "rgba(57,255,20,0.15)" : "rgba(255,255,255,0.06)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke={open ? "#39FF14" : "#9ca3af"} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={shouldReduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-[13px] text-[#9ca3af] leading-relaxed pb-5">{faq.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FAQ() {
  return (
    <section id="faq" style={{ padding: "6rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white mb-4"
            style={{ letterSpacing: "-0.03em" }}
          >
            Frequently Asked Questions.
          </h2>
        </motion.div>

        <div
          className="rounded-xl border border-white/8 px-6"
          style={{ background: "rgba(10,14,22,0.95)" }}
        >
          {FAQS.map((faq, i) => (
            <FAQItem key={faq.q} faq={faq} idx={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
