import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAppAuth } from "@/_core/hooks/useAppAuth";

export default function Hero() {
  const { appUser, loading } = useAppAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && appUser) setLocation("/feed");
  }, [loading, appUser, setLocation]);

  return (
    <section
      className="w-full flex flex-col items-center justify-center text-center"
      style={{ padding: "clamp(5rem, 12vw, 9rem) clamp(16px, 4vw, 64px) clamp(4rem, 8vw, 7rem)" }}
    >
      <div className="max-w-screen-md mx-auto flex flex-col items-center gap-6">
        {/* Trust line above headline */}
        <p className="text-[#6b7280] text-[12px] uppercase tracking-widest font-semibold">
          MLB · World Cup 2026 · More Sports Coming
        </p>

        {/* Primary headline */}
        <h1
          className="font-black text-white"
          style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)", lineHeight: 1.08, letterSpacing: "-0.04em" }}
        >
          The Betting Intelligence Dashboard
          <br />
          <span style={{ color: "#39FF14" }}>Built for Serious Bettors.</span>
        </h1>

        {/* Subheadline */}
        <p
          className="text-[#9ca3af] leading-relaxed"
          style={{ fontSize: "clamp(1rem, 1.8vw, 1.25rem)", maxWidth: "52ch" }}
        >
          AI model projections, betting splits, line movement, and sharp indicators — all in one dashboard. Research smarter. Bet with conviction.
        </p>

        {/* Dual CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <a
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-bold text-black transition-all hover:brightness-110"
            style={{ background: "#39FF14", fontSize: "15px" }}
          >
            View Today&apos;s Projections
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a
            href="/#pricing"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-lg font-semibold text-white transition-all hover:bg-white/10"
            style={{ border: "1px solid rgba(255,255,255,0.15)", fontSize: "15px" }}
          >
            Get Access Now
          </a>
        </div>

        {/* Trust line below CTAs */}
        <p className="text-[#4b5563] text-[12px]">
          No picks. No lock-of-the-day hype. Just the data.
        </p>

        {/* 3 conversion bullets */}
        <div className="flex flex-col sm:flex-row gap-4 mt-4 text-[13px] text-[#9ca3af]">
          {[
            "Dixon-Coles Poisson model + Monte Carlo simulation",
            "Book vs. model comparison on every game",
            "Cancel anytime. No contracts.",
          ].map((bullet) => (
            <div key={bullet} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#39FF14] shrink-0" />
              {bullet}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
