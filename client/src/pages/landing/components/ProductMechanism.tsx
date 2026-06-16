const SIGNALS = [
  { label: "Model Projections", detail: "AI-generated win probabilities and implied odds for every game" },
  { label: "Book vs. Model Gap", detail: "Side-by-side comparison showing where the market and model diverge" },
  { label: "Betting Splits", detail: "Public money percentages and ticket counts on every side" },
  { label: "Line Movement", detail: "Track how lines have moved from open to current across all books" },
  { label: "Sharp Indicators", detail: "Reverse line movement and steam move alerts for sharp-side signals" },
  { label: "Starting Lineups", detail: "Confirmed lineups and pitcher assignments before first pitch" },
];
export default function ProductMechanism() {
  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-6">
            <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}>
              One Dashboard.<br /><span style={{ color: "#39FF14" }}>The Signals That Matter</span><br />Before You Bet.
            </h2>
            <p className="text-[#9ca3af] leading-relaxed" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
              Stop switching tabs. Stop guessing. AI Sports Betting Models consolidates every signal you need into a single premium dashboard built for serious pre-bet research.
            </p>
            <a href="/#pricing" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-black self-start transition-all hover:brightness-110" style={{ background: "#39FF14", fontSize: "14px" }}>
              Get Access Now
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SIGNALS.map((s) => (
              <div key={s.label} className="rounded-lg p-4 flex flex-col gap-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#39FF14] shrink-0" />
                  <span className="font-semibold text-white text-[13px]">{s.label}</span>
                </div>
                <p className="text-[#6b7280] text-[12px] leading-relaxed pl-3.5">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
