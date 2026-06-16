const ROWS = [
  { feature: "Shows model projections", us: true, them: false },
  { feature: "Book vs. model comparison", us: true, them: false },
  { feature: "Betting splits and trends", us: true, them: true },
  { feature: "Line movement tracking", us: true, them: true },
  { feature: "Sharp-side indicators", us: true, them: false },
  { feature: "Daily lineups and cheat sheets", us: true, them: false },
  { feature: "K props and player props", us: true, them: false },
  { feature: "No picks, no lock-of-the-day hype", us: true, them: false },
  { feature: "Transparent methodology", us: true, them: false },
];
export default function ComparisonSection() {
  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)" }}>
      <div className="max-w-screen-lg mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}>
            Not Picks. Not Hype.<br /><span style={{ color: "#39FF14" }}>Betting Intelligence.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>Most services sell you picks. We give you the data to make your own.</p>
        </div>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
          <div className="grid grid-cols-3 text-[12px] font-bold uppercase tracking-wider p-4" style={{ background: "rgba(255,255,255,0.05)", color: "#6b7280" }}>
            <span>Feature</span>
            <span className="text-center text-[#39FF14]">AI Sports Betting Models</span>
            <span className="text-center">Others</span>
          </div>
          {ROWS.map((row, i) => (
            <div key={row.feature} className="grid grid-cols-3 p-4 text-[13px]" style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="text-[#d1d5db]">{row.feature}</span>
              <span className="text-center">{row.us ? <span className="text-[#39FF14] font-bold">Yes</span> : <span className="text-red-400">No</span>}</span>
              <span className="text-center">{row.them ? <span className="text-[#9ca3af]">Sometimes</span> : <span className="text-red-400">No</span>}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
