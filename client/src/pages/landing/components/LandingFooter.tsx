export default function LandingFooter() {

  return (
    <footer
      className="text-center border-t"
      style={{
        padding: "2.5rem clamp(16px, 4vw, 64px)",
        borderColor: "rgba(255,255,255,0.06)",
        background: "#050810",
      }}
    >
      <div className="max-w-screen-md mx-auto flex flex-col gap-3">
        <p className="text-[12px] text-[#9ca3af]">
          © 2026 Tailered Sports, Inc. All rights reserved.
        </p>
        <p className="text-[11px] leading-relaxed" style={{ color: "#4b5563" }}>
          AI Sports Betting Models is a data and analytics platform. It is not a picks service and does not provide financial, investment, or gambling advice. All model projections are for informational and research purposes only. Sports betting involves substantial risk of loss. Past model performance does not guarantee future results. You are solely responsible for any betting decisions you make. Verify that sports betting is legal in your jurisdiction before wagering. Bet responsibly and only with money you can afford to lose.
        </p>
        <div className="flex items-center justify-center gap-4 mt-1">
          <a href="/terms" className="text-[11px] text-[#6b7280] hover:text-[#9ca3af] transition-colors">Terms of Service</a>
          <span className="text-[#374151]">·</span>
          <a href="/privacy" className="text-[11px] text-[#6b7280] hover:text-[#9ca3af] transition-colors">Privacy Policy</a>
          <span className="text-[#374151]">·</span>
          <a href="mailto:support@aisportsbettingmodels.com" className="text-[11px] text-[#6b7280] hover:text-[#9ca3af] transition-colors">Support</a>
        </div>
      </div>
    </footer>
  );
}
