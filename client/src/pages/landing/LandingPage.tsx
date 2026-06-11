/**
 * LandingPage.tsx
 *
 * Minimal, clean landing page.
 * Structure:
 *   1. LandingNav      — sticky top nav
 *   2. Hero            — headline + CTAs
 *   3. FeatureShowcase — 4 features with real UI screenshots
 *   4. PricingCTA      — Monthly / Annual plans
 *   5. FAQ             — objection handling before the final ask
 *   6. FinalCTA        — last conversion push
 *   7. LandingFooter   — minimal footer
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";

// ── Critical path: always eager ──────────────────────────────────────────────
import LandingNav from "./components/LandingNav";
import Hero from "./components/Hero";

// ── Deferred: lazy-loaded below the fold ─────────────────────────────────────
const FeatureShowcase = lazy(() => import("./components/FeatureShowcase"));
const PricingCTA      = lazy(() => import("./components/PricingCTA"));
const FAQ             = lazy(() => import("./components/FAQ"));
const FinalCTA        = lazy(() => import("./components/FinalCTA"));
const LandingFooter   = lazy(() => import("./components/LandingFooter"));

/**
 * LazySection — renders children only when the section scrolls into view.
 * Uses a 400px rootMargin so content loads before the user reaches it.
 * No minHeight placeholder — avoids dead whitespace.
 */
function LazySection({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);

  return (
    <div ref={ref} id={id}>
      {visible ? (
        <Suspense fallback={null}>
          {children}
        </Suspense>
      ) : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div
      className="min-h-screen"
      style={{ background: "#050810", color: "#ffffff" }}
    >
      <LandingNav />
      <Hero />

      <LazySection id="features">
        <FeatureShowcase />
      </LazySection>

      <LazySection id="pricing">
        <PricingCTA />
      </LazySection>

      <LazySection id="faq">
        <FAQ />
      </LazySection>

      <LazySection id="final-cta">
        <FinalCTA />
      </LazySection>

      <LazySection id="footer">
        <LandingFooter />
      </LazySection>
    </div>
  );
}
