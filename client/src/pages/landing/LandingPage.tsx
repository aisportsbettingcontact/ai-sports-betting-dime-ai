/**
 * LandingPage.tsx
 *
 * Performance architecture:
 *   CRITICAL PATH (above the fold — always eager):
 *     LandingNav, Hero, TrustBar
 *     These three are the first pixels the user sees. They must render synchronously.
 *
 *   DEFERRED PATH (below the fold — lazy + IntersectionObserver):
 *     ProductPreviewTabs, ValueProposition, ModelProjectionsSection, HowItWorks,
 *     EdgeExplanation, FeatureGrid, PricingCTA, FAQ, FinalCTA, LandingFooter
 *     Each is React.lazy(). They are loaded only when the user scrolls near them.
 *     This removes ~80% of the landing page JS from the initial parse budget.
 *
 * [LOG] Console logs trace which sections are loading/loaded for debugging.
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";

// ── Critical path: always eager ──────────────────────────────────────────────
import LandingNav from "./components/LandingNav";
import Hero from "./components/Hero";
import TrustBar from "./components/TrustBar";

// ── Deferred: lazy-loaded below the fold ─────────────────────────────────────
const ProductPreviewTabs      = lazy(() => { console.log("[LandingPage] Loading ProductPreviewTabs"); return import("./components/ProductPreviewTabs"); });
const ValueProposition        = lazy(() => { console.log("[LandingPage] Loading ValueProposition"); return import("./components/ValueProposition"); });
const ModelProjectionsSection = lazy(() => { console.log("[LandingPage] Loading ModelProjectionsSection"); return import("./components/ModelProjectionsSection"); });
const HowItWorks              = lazy(() => { console.log("[LandingPage] Loading HowItWorks"); return import("./components/HowItWorks"); });
const EdgeExplanation         = lazy(() => { console.log("[LandingPage] Loading EdgeExplanation"); return import("./components/EdgeExplanation"); });
const FeatureGrid             = lazy(() => { console.log("[LandingPage] Loading FeatureGrid"); return import("./components/FeatureGrid"); });
const PricingCTA              = lazy(() => { console.log("[LandingPage] Loading PricingCTA"); return import("./components/PricingCTA"); });
const FAQ                     = lazy(() => { console.log("[LandingPage] Loading FAQ"); return import("./components/FAQ"); });
const FinalCTA                = lazy(() => { console.log("[LandingPage] Loading FinalCTA"); return import("./components/FinalCTA"); });
const LandingFooter           = lazy(() => { console.log("[LandingPage] Loading LandingFooter"); return import("./components/LandingFooter"); });

/**
 * SectionPlaceholder — a minimal height placeholder rendered while a lazy section
 * is not yet in the viewport. Once the IntersectionObserver fires, it is replaced
 * with the real component wrapped in Suspense.
 *
 * rootMargin="400px" means sections start loading 400px before they enter the viewport,
 * ensuring they are ready before the user scrolls to them.
 */
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
          console.log(`[LandingPage] Section "${id ?? "unknown"}" entered viewport — loading component`);
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
  console.log("[LandingPage] Rendering — critical path: Nav + Hero + TrustBar eager, rest deferred");

  return (
    <div
      className="min-h-screen"
      style={{ background: "#050810", color: "#ffffff" }}
    >
      {/* ── Critical path: renders immediately, zero JS loading delay ── */}
      <LandingNav />
      <Hero />
      <TrustBar />

      {/* ── Deferred sections: each loads when scrolled near ─────────── */}
      <LazySection id="product-preview" minHeight="600px">
        <ProductPreviewTabs />
      </LazySection>

      <LazySection id="value-proposition" minHeight="400px">
        <ValueProposition />
      </LazySection>

      <LazySection id="model-projections" minHeight="500px">
        <ModelProjectionsSection />
      </LazySection>

      <LazySection id="how-it-works" minHeight="400px">
        <HowItWorks />
      </LazySection>

      <LazySection id="edge-explanation" minHeight="400px">
        <EdgeExplanation />
      </LazySection>

      <LazySection id="features" minHeight="400px">
        <FeatureGrid />
      </LazySection>

      <LazySection id="pricing" minHeight="600px">
        <PricingCTA />
      </LazySection>

      <LazySection id="faq" minHeight="400px">
        <FAQ />
      </LazySection>

      <LazySection id="final-cta" minHeight="300px">
        <FinalCTA />
      </LazySection>

      <LazySection id="footer" minHeight="200px">
        <LandingFooter />
      </LazySection>
    </div>
  );
}
