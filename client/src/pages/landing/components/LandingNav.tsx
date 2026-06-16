/**
 * LandingNav.tsx
 *
 * Fixed top navigation bar for the public landing page.
 *
 * Desktop layout (≥ md / 768px):
 *   [Logo]  [Features] [Waitlist]  ··  [LOGIN] [Join Waitlist]
 *
 * Mobile layout (< md):
 *   [Logo]  ··  [LOGIN] [Join Waitlist]
 *   (nav links are hidden on mobile to keep the bar single-row)
 *
 * Logging convention:
 *   [LandingNav][MOUNT]  — component mounted, scroll listener attached
 *   [LandingNav][SCROLL] — scrolled state change
 *   [LandingNav][ACTION] — user-initiated interactions (scroll-to, login click)
 *   [LandingNav][VERIFY] — post-render assertions
 */

import { useState, useEffect, useCallback } from "react";

const LOGO_URL = "/manus-storage/logo-aisportsbetting_429c188f.jpg";

// ─── Scroll threshold (px) before the nav background solidifies ───────────────
const SCROLL_THRESHOLD = 40;

export default function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  // ── Scroll listener ────────────────────────────────────────────────────────
  useEffect(() => {
    console.log("[LandingNav][MOUNT] Attaching scroll listener — threshold:", SCROLL_THRESHOLD, "px");

    const handler = () => {
      const isScrolled = window.scrollY > SCROLL_THRESHOLD;
      setScrolled((prev) => {
        if (prev !== isScrolled) {
          console.log(
            `[LandingNav][SCROLL] scrollY=${window.scrollY} → scrolled=${isScrolled}`
          );
        }
        return isScrolled;
      });
    };

    // Fire once on mount to sync initial state
    handler();

    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      console.log("[LandingNav][MOUNT] Removing scroll listener");
      window.removeEventListener("scroll", handler);
    };
  }, []);

  // ── Smooth-scroll helper ───────────────────────────────────────────────────
  const scrollTo = useCallback((id: string) => {
    console.log(`[LandingNav][ACTION] scrollTo — target id="${id}"`);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      console.log(`[LandingNav][VERIFY] scrollTo — element found and scrolled ✓`);
    } else {
      console.warn(`[LandingNav][VERIFY] scrollTo — element id="${id}" NOT FOUND in DOM`);
    }
  }, []);

  // ── Login click handler ────────────────────────────────────────────────────
  const handleLoginClick = useCallback(() => {
    console.log("[LandingNav][ACTION] LOGIN button clicked — navigating to /login");
  }, []);

  // ── Post-render verification (dev only) ───────────────────────────────────
  useEffect(() => {
    const loginBtn = document.querySelector("[data-nav-login]");
    const joinBtn  = document.querySelector("[data-nav-join]");
    console.log(
      "[LandingNav][VERIFY] DOM check — loginBtn present:", !!loginBtn,
      "| joinBtn present:", !!joinBtn,
      "| loginBtn visible:", loginBtn
        ? window.getComputedStyle(loginBtn as Element).display !== "none"
        : false
    );
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background:   scrolled ? "rgba(5,8,16,0.95)" : "rgba(5,8,16,0.6)",
        backdropFilter: "blur(12px)",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "none",
      }}
    >
      <div
        className="max-w-screen-2xl mx-auto"
        style={{ padding: "0 clamp(16px, 4vw, 64px)" }}
      >
        <div className="flex items-center justify-between h-16">

          {/* ── Logo ─────────────────────────────────────────────────────── */}
          <a href="/" className="flex items-center shrink-0">
            <img
              src={LOGO_URL}
              alt="AI Sports Betting"
              className="w-9 h-9 rounded-lg object-cover"
              onError={(e) => {
                console.warn("[LandingNav][VERIFY] Logo image failed to load — showing fallback badge");
                const el = e.currentTarget;
                el.style.display = "none";
                const badge = el.nextElementSibling as HTMLElement | null;
                if (badge) badge.style.display = "flex";
              }}
            />
            {/* Fallback badge — hidden by default, shown if image 404s */}
            <span
              className="w-9 h-9 rounded-lg items-center justify-center text-black text-xs font-black"
              style={{ background: "#39FF14", display: "none" }}
            >
              AI
            </span>
          </a>

          {/* ── Nav links — desktop only (≥ md / 768px) ──────────────────── */}
          <nav className="hidden md:flex items-center gap-6">
            {[
              { label: "Features", id: "features" },
              { label: "Waitlist", id: "waitlist" },
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

          {/* ── CTA buttons — visible on ALL screen sizes ─────────────────
              Both buttons use `inline-flex` with NO `hidden` / `sm:` prefix
              so they render on every viewport width, including phones.
          ─────────────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2">

            {/* LOGIN — ghost style, visible on all breakpoints */}
            <a
              href="/login"
              data-nav-login
              onClick={handleLoginClick}
              className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-semibold text-white border border-white/20 hover:border-white/40 hover:bg-white/5 transition-all duration-150 whitespace-nowrap"
            >
              LOGIN
            </a>

            {/* Join Waitlist — primary CTA, visible on all breakpoints */}
            <a
              href="/#waitlist"
              data-nav-join
              className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-bold text-black transition-all duration-150 hover:brightness-110 whitespace-nowrap"
              style={{ background: "#39FF14" }}
            >
              Join Waitlist
            </a>

          </div>
        </div>
      </div>
    </header>
  );
}
