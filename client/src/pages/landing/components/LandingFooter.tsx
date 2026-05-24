export default function LandingFooter() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <footer
      className="border-t border-white/8 py-12 px-4 sm:px-6 lg:px-8"
      style={{ background: "rgba(5,8,16,0.98)" }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                className="w-7 h-7 rounded flex items-center justify-center text-black text-xs font-black"
                style={{ background: "#39FF14" }}
              >
                AI
              </span>
              <span className="text-[14px] font-bold text-white" style={{ letterSpacing: "-0.02em" }}>
                AI Sports Betting
              </span>
            </div>
            <p className="text-[12px] text-[#6b7280] leading-relaxed">
              AI-powered sports betting intelligence. Model projections, no-vig odds, ROI signals, and betting splits in one platform.
            </p>
          </div>

          {/* Platform */}
          <div>
            <h4 className="text-[11px] font-bold text-[#6b7280] tracking-widest uppercase mb-4">Platform</h4>
            <ul className="space-y-2.5">
              {[
                { label: "Model Projections", href: "/feed" },
                { label: "Betting Splits", href: "/feed" },
                { label: "Market Edges", href: "/feed" },
                { label: "Bet Tracker", href: "/feed" },
              ].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[13px] text-[#9ca3af] hover:text-white transition-colors duration-150">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Info */}
          <div>
            <h4 className="text-[11px] font-bold text-[#6b7280] tracking-widest uppercase mb-4">Learn</h4>
            <ul className="space-y-2.5">
              {[
                { label: "How It Works", id: "how-it-works" },
                { label: "Features", id: "features" },
                { label: "Sports Coverage", id: "sports-coverage" },
                { label: "FAQ", id: "faq" },
              ].map((item) => (
                <li key={item.label}>
                  <button
                    onClick={() => scrollTo(item.id)}
                    className="text-[13px] text-[#9ca3af] hover:text-white transition-colors duration-150 text-left"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Account */}
          <div>
            <h4 className="text-[11px] font-bold text-[#6b7280] tracking-widest uppercase mb-4">Account</h4>
            <ul className="space-y-2.5">
              {[
                { label: "Sign In", href: "/feed" },
                { label: "Subscribe", id: "pricing" },
                { label: "Pricing", id: "pricing" },
              ].map((item) => (
                <li key={item.label}>
                  {item.href ? (
                    <a href={item.href} className="text-[13px] text-[#9ca3af] hover:text-white transition-colors duration-150">
                      {item.label}
                    </a>
                  ) : (
                    <button
                      onClick={() => scrollTo(item.id!)}
                      className="text-[13px] text-[#9ca3af] hover:text-white transition-colors duration-150 text-left"
                    >
                      {item.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 border-t border-white/6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] text-[#4b5563]">
            © {new Date().getFullYear()} AI Sports Betting. All rights reserved.
          </p>
          <p className="text-[11px] text-[#4b5563] text-center sm:text-right max-w-md">
            This platform provides sports betting analytics and decision-support tools. It does not guarantee outcomes. Gambling involves risk. Bet responsibly.
          </p>
        </div>
      </div>
    </footer>
  );
}
