import { useState, useEffect } from "react";

export default function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled
          ? "rgba(5,8,16,0.92)"
          : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a
            href="/"
            className="flex items-center gap-2 text-white font-bold text-sm tracking-tight"
            style={{ letterSpacing: "-0.02em" }}
          >
            <span
              className="w-6 h-6 rounded flex items-center justify-center text-black text-xs font-black"
              style={{ background: "#39FF14" }}
            >
              AI
            </span>
            <span className="hidden sm:block">AI Sports Betting</span>
          </a>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-6">
            {[
              { label: "Features", id: "features" },
              { label: "How It Works", id: "how-it-works" },
              { label: "Sports", id: "sports-coverage" },
              { label: "Pricing", id: "pricing" },
              { label: "FAQ", id: "faq" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="text-[13px] font-semibold text-[#9ca3af] hover:text-white transition-colors duration-150"
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* CTA */}
          <a
            href="/feed"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold text-black transition-all duration-150 hover:brightness-110"
            style={{ background: "#39FF14", letterSpacing: "-0.01em" }}
          >
            View Today's Edges
          </a>
        </div>
      </div>
    </header>
  );
}
