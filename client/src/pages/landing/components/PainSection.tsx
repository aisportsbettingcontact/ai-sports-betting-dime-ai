const PAIN_POINTS = [
  "Jumping between 4 different sites to find splits, lines, and lineups",
  "Getting picks from someone who does not show their work",
  "Betting on gut feel because the data is too scattered to use",
  "Missing line movement because you checked too late",
  "Paying for tools that give you data but no context",
];
export default function PainSection() {
  return (
    <section className="w-full" style={{ padding: "5rem clamp(16px, 4vw, 64px)", background: "rgba(255,255,255,0.01)" }}>
      <div className="max-w-screen-lg mx-auto">
        <div className="text-center mb-10">
          <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}>
            Most Bettors Are Still<br /><span style={{ color: "#39FF14" }}>Researching the Hard Way.</span>
          </h2>
          <p className="text-[#9ca3af] mt-4" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)", maxWidth: "56ch", margin: "1rem auto 0" }}>
            If your pre-bet research looks like this, you are leaving edge on the table before you even place a bet.
          </p>
        </div>
        <ul className="flex flex-col gap-3 max-w-2xl mx-auto">
          {PAIN_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-3 rounded-lg p-4" style={{ background: "rgba(255,59,48,0.05)", border: "1px solid rgba(255,59,48,0.12)" }}>
              <span className="text-red-400 mt-0.5 shrink-0">✕</span>
              <span className="text-[#d1d5db] text-[14px] leading-relaxed">{point}</span>
            </li>
          ))}
        </ul>
        <p className="text-center text-[#9ca3af] mt-8 text-[14px]">There is a better way. One dashboard. Everything you need. Before you bet.</p>
      </div>
    </section>
  );
}
