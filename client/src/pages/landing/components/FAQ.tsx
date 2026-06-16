const FAQS = [
  {
    q: "Is this a picks service?",
    a: "No. AI Sports Betting Models is a research and analytics platform. We provide AI model projections, betting splits, line movement data, and sharp indicators. You make your own decisions. We give you the data to make them better.",
  },
  {
    q: "What sports are covered?",
    a: "Currently MLB baseball and World Cup 2026. Additional sports are in development. MLB coverage includes full season projections, K props, player props, daily lineups, and cheat sheets.",
  },
  {
    q: "How accurate are the model projections?",
    a: "Our models are built on Dixon-Coles Poisson distributions and Monte Carlo simulation using pitcher ERA, team offensive production, park factors, and lineup data. No model is 100% accurate. We show you the model-implied probability and the confidence level — you decide whether to act on it.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel anytime from your account settings. No contracts, no cancellation fees. Monthly subscribers retain access through the end of their billing period.",
  },
  {
    q: "How often is the data updated?",
    a: "Odds and betting splits update continuously throughout the day. Starting lineups and pitcher assignments update as confirmed. Model projections are recalculated when lineup data changes.",
  },
  {
    q: "Do I need to know how to read odds or betting lines?",
    a: "Basic familiarity with American odds (moneylines, spreads, totals) is helpful. The dashboard is designed for bettors who already understand the fundamentals and want better data to inform their decisions.",
  },
  {
    q: "Is sports betting legal where I am?",
    a: "Sports betting laws vary by jurisdiction. It is your responsibility to verify that sports betting is legal in your location before using this platform. AI Sports Betting Models provides data and analysis only — we do not facilitate wagering.",
  },
  {
    q: "Does this guarantee I will win?",
    a: "No. Nothing guarantees winning in sports betting. AI Sports Betting Models provides data-driven analysis to help you make more informed decisions. Sports betting involves risk. Past model performance does not guarantee future results.",
  },
];

import { useState } from "react";

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-md mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}>
            Frequently Asked Questions
          </h2>
        </div>
        <div className="flex flex-col gap-2">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className="rounded-xl overflow-hidden"
              style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}
            >
              <button
                className="w-full flex items-center justify-between gap-4 p-5 text-left"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="font-semibold text-white text-[14px] leading-snug">{faq.q}</span>
                <span className="text-[#39FF14] shrink-0 text-[18px] font-bold">{open === i ? "−" : "+"}</span>
              </button>
              {open === i && (
                <div className="px-5 pb-5">
                  <p className="text-[#9ca3af] text-[13px] leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
