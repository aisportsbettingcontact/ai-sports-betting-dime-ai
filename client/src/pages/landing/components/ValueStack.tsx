const VALUES = [
  { icon: "📊", title: "AI Model Projections", desc: "Probability-based win/loss projections built from Dixon-Coles Poisson models and Monte Carlo simulation. Every game, every market." },
  { icon: "📈", title: "Betting Splits and Trends", desc: "See where the public money is going and where sharp action is concentrated. Identify line movement before you place your bet." },
  { icon: "⚖️", title: "Book vs. Model Comparison", desc: "Every projection is displayed side by side with the current market line. See the edge — or the lack of one — before you commit." },
  { icon: "🎯", title: "K Props and Player Props", desc: "Strikeout projections and player prop analysis built from pitcher-specific models and park-adjusted data." },
  { icon: "📋", title: "Daily Lineups and Cheat Sheets", desc: "Confirmed starting lineups, pitcher assignments, and pre-game cheat sheets delivered before first pitch." },
  { icon: "🌍", title: "MLB and World Cup 2026", desc: "Full MLB season coverage plus complete World Cup 2026 group stage and knockout round projections. More sports in development." },
];
export default function ValueStack() {
  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}>
            Everything You Need to Read the Board<br /><span style={{ color: "#39FF14" }}>Before You Bet.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>One platform. Every signal that matters. No noise.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {VALUES.map((v) => (
            <div key={v.title} className="rounded-xl p-6 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <span className="text-2xl">{v.icon}</span>
              <h3 className="font-bold text-white text-[15px]">{v.title}</h3>
              <p className="text-[#9ca3af] text-[13px] leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
