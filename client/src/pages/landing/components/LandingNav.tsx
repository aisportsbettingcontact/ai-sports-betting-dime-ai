import { useState, useEffect } from "react";

const LOGO_URL = "/manus-storage/logo-aisportsbetting_429c188f.jpg";

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
        background: scrolled ? "rgba(5,8,16,0.95)" : "rgba(5,8,16,0.6)",
        backdropFilter: "blur(12px)",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a
            href="/"
            className="flex items-center gap-2.5 shrink-0"
          >
            <img
              src={LOGO_URL}
              alt="AI Sports Betting"
              className="w-9 h-9 rounded-lg object-cover"
              onError={(e) => {
                // Fallback to text badge if image fails
                const el = e.currentTarget;
                el.style.display = "none";
                const badge = el.nextElementSibling as HTMLElement;
                if (badge) badge.style.display = "flex";
              }}
            />
            {/* Fallback badge — hidden by default */}
            <span
              className="w-9 h-9 rounded-lg items-center justify-center text-black text-xs font-black hidden"
              style={{ background: "#39FF14" }}
            >
              AI
            </span>
            <span className="hidden sm:block text-white font-bold text-sm tracking-tight" style={{ letterSpacing: "-0.02em" }}>
              AI Sports Betting
            </span>
          </a>

          {/* Nav links — desktop only */}
          <nav className="hidden md:flex items-center gap-6">
            {[
              { label: "Features", id: "features" },
              { label: "Pricing", id: "pricing" },
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

          {/* Auth buttons */}
          <div className="flex items-center gap-2">
            <a
              href="/login"
              className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-semibold text-white border border-white/20 hover:border-white/40 hover:bg-white/5 transition-all duration-150"
            >
              View Today's Edges
            </a>
            <a
              href="/#pricing"
              className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-bold text-black transition-all duration-150 hover:brightness-110"
              style={{ background: "#39FF14" }}
            >
              Get AI Model Access
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
