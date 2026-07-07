export default function PremiumValueAnchor() {
  return (
    <section className="w-full" style={{ padding: "4rem clamp(16px, 4vw, 64px)", background: "rgba(57,255,20,0.03)" }}>
      <div className="max-w-screen-md mx-auto text-center flex flex-col gap-5">
        <h2 className="font-bold text-white" style={{ fontSize: "clamp(1.5rem, 3vw, 2.5rem)", letterSpacing: "-0.03em" }}>
          Premium Betting Intelligence for Less Than<br /><span style={{ color: "#39FF14" }}>the Cost of One Serious Mistake.</span>
        </h2>
        <p className="text-[#9ca3af] leading-relaxed" style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.1rem)" }}>
          One bad bet on incomplete information can cost you more than a full month of access. AI Sports Betting Models gives you the research infrastructure that serious bettors need, at a price that makes sense.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-2">
          <div className="rounded-xl p-5 text-center flex-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-[#39FF14] font-black text-[2rem]">$99</div>
            <div className="text-[#9ca3af] text-[13px] mt-1">per month</div>
            <div className="text-white text-[12px] mt-2">Full dashboard access</div>
          </div>
          <div className="rounded-xl p-5 text-center flex-1" style={{ background: "rgba(57,255,20,0.08)", border: "1px solid rgba(57,255,20,0.3)" }}>
            <div className="text-[#39FF14] font-black text-[2rem]">$499</div>
            <div className="text-[#9ca3af] text-[13px] mt-1">per year</div>
            <div className="text-white text-[12px] mt-2">Save 58% vs monthly</div>
          </div>
        </div>
        <a href="/#waitlist" className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-black self-center transition-all hover:brightness-110" style={{ background: "#39FF14", fontSize: "15px" }}>
          View Plans
        </a>
      </div>
    </section>
  );
}
