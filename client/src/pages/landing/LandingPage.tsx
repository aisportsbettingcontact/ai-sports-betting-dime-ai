/**
 * LandingPage.tsx
 *
 * Minimal, clean landing page.
 * Structure:
 *   1. LandingNav      — sticky top nav
 *   2. Hero            — headline + CTAs
 *   3. FeatureShowcase — 4 features with real UI screenshots
 *   4. PricingCTA      — Monthly / Annual plans
 *   5. LandingFooter   — minimal footer
 *
 * All sections below the fold are lazy-loaded via IntersectionObserver.
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";

// ── Critical path: always eager ──────────────────────────────────────────────
import LandingNav from "./components/LandingNav";
import Hero from "./components/Hero";

// ── Deferred: lazy-loaded below the fold ─────────────────────────────────────
const FeatureShowcase = lazy(() => import("./components/FeatureShowcase"));
const PricingCTA      = lazy(() => import("./components/PricingCTA"));
const LandingFooter   = lazy(() => import("./components/LandingFooter"));

function LazySection({
  children,
  minHeight = "200px",
  id,
}: {
  children: React.ReactNode;
  minHeight?: string;
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
    <div ref={ref} id={id} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? (
        <Suspense fallback={<div style={{ minHeight }} />}>
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

      <LazySection id="features" minHeight="600px">
        <FeatureShowcase />
      </LazySection>

      <LazySection id="pricing" minHeight="500px">
        <PricingCTA />
      </LazySection>

      <LazySection id="footer" minHeight="100px">
        <LandingFooter />
      </LazySection>
    </div>
  );
}
