const POINTS = [
  { title: "We show our work", desc: "Every projection is built on a documented model. No black boxes. No mystery picks." },
  { title: "We do not sell picks", desc: "We give you the data and the analysis. You make the decision. That is how it should work." },
  { title: "We flag uncertainty", desc: "When the data is thin or the edge is marginal, we say so. No inflated confidence." },
  { title: "We update in real time", desc: "Odds, splits, and line movement refresh continuously. You always have the current picture." },
];
export default function TrustBoundary() {
  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)", background: "rgba(255,255,255,0.01)" }}>
      <div className="max-w-screen-lg mx-auto">
        <div className="text-center mb-12">
          <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}>
            Built for Serious Bettors,<br /><span style={{ color: "#39FF14" }}>Not Blind Tailing.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>We built this for bettors who want to understand why before they bet.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {POINTS.map((p) => (
            <div key={p.title} className="rounded-xl p-6 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#39FF14] shrink-0" />
                <h3 className="font-bold text-white text-[15px]">{p.title}</h3>
              </div>
              <p className="text-[#9ca3af] text-[13px] leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
