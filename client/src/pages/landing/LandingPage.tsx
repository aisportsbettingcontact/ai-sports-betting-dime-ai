import { lazy, Suspense, useEffect, useRef, useState } from "react";
import LandingNav from "./components/LandingNav";
import Hero from "./components/Hero";
const ValueStack         = lazy(() => import("./components/ValueStack"));
const PainSection        = lazy(() => import("./components/PainSection"));
const ProductMechanism   = lazy(() => import("./components/ProductMechanism"));
const MarketWorkflow     = lazy(() => import("./components/MarketWorkflow"));
const FeatureShowcase    = lazy(() => import("./components/FeatureShowcase"));
const ComparisonSection  = lazy(() => import("./components/ComparisonSection"));
const PremiumValueAnchor = lazy(() => import("./components/PremiumValueAnchor"));
const TrustBoundary      = lazy(() => import("./components/TrustBoundary"));
const PricingCTA         = lazy(() => import("./components/PricingCTA"));
const FAQ                = lazy(() => import("./components/FAQ"));
const FinalCTA           = lazy(() => import("./components/FinalCTA"));
const LandingFooter      = lazy(() => import("./components/LandingFooter"));

function LazySection({ children, id }: { children: React.ReactNode; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);
  return (
    <div ref={ref} id={id}>
      {visible ? <Suspense fallback={null}>{children}</Suspense> : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: "#050810", color: "#ffffff" }}>
      <LandingNav />
      <Hero />
      <LazySection id="value-stack"><ValueStack /></LazySection>
      <LazySection id="pain"><PainSection /></LazySection>
      <LazySection id="product"><ProductMechanism /></LazySection>
      <LazySection id="workflow"><MarketWorkflow /></LazySection>
      <LazySection id="features"><FeatureShowcase /></LazySection>
      <LazySection id="comparison"><ComparisonSection /></LazySection>
      <LazySection id="value-anchor"><PremiumValueAnchor /></LazySection>
      <LazySection id="trust"><TrustBoundary /></LazySection>
      <LazySection id="pricing"><PricingCTA /></LazySection>
      <LazySection id="faq"><FAQ /></LazySection>
      <LazySection id="final-cta"><FinalCTA /></LazySection>
      <LazySection id="footer"><LandingFooter /></LazySection>
    </div>
  );
}
