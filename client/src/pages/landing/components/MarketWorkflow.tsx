const STEPS = [
  { num: "01", title: "Check the Model Board", desc: "See AI projections for every game. Identify where the model disagrees with the market." },
  { num: "02", title: "Review Betting Splits", desc: "Check public money percentages and sharp-side indicators. See who is betting what and why." },
  { num: "03", title: "Verify the Lineup", desc: "Confirm starting pitchers, batting orders, and any late scratches before placing your bet." },
  { num: "04", title: "Analyze Line Movement", desc: "Track how the line moved from open to current. Identify steam moves and reverse line movement." },
  { num: "05", title: "Place with Confidence", desc: "You have done the research. You have the data. Now bet with a clear picture of the edge." },
];
export default function MarketWorkflow() {
  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)", background: "rgba(255,255,255,0.01)" }}>
      <div className="max-w-screen-lg mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}>
            A Cleaner Workflow<br /><span style={{ color: "#39FF14" }}>Before Every Bet.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>Five steps. One platform. No more tab-switching.</p>
        </div>
        <div className="flex flex-col gap-4">
          {STEPS.map((step) => (
            <div key={step.num} className="flex items-start gap-5 rounded-xl p-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <span className="font-black text-[#39FF14] text-[20px] shrink-0 w-8">{step.num}</span>
              <div>
                <h3 className="font-bold text-white text-[15px] mb-1">{step.title}</h3>
                <p className="text-[#9ca3af] text-[13px] leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
