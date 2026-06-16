export default function FinalCTA() {
  return (
    <section
      className="w-full text-center"
      style={{ padding: "5rem clamp(16px, 4vw, 64px)", background: "rgba(57,255,20,0.04)" }}
    >
      <div className="max-w-screen-sm mx-auto flex flex-col items-center gap-6">
        <h2
          className="font-black text-white"
          style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)", letterSpacing: "-0.04em" }}
        >
          Get the Dashboard
          <br />
          <span style={{ color: "#39FF14" }}>Before Your Next Bet.</span>
        </h2>
        <p className="text-[#9ca3af]" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
          Stop researching the hard way. Start betting with the full picture.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-black transition-all hover:brightness-110"
            style={{ background: "#39FF14", fontSize: "15px" }}
          >
            View Today&apos;s Projections
          </a>
          <a
            href="/#pricing"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-semibold text-white transition-all hover:bg-white/10"
            style={{ border: "1px solid rgba(255,255,255,0.15)", fontSize: "15px" }}
          >
            See Plans
          </a>
        </div>
        <p className="text-[#4b5563] text-[12px]">No picks. No hype. Cancel anytime.</p>
      </div>
    </section>
  );
}
