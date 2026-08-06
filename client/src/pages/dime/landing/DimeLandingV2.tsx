/**
 * Dime AI — landing v2 (root landing page at /; formerly /landingpage-v2)
 * ---------------------------------------
 * Category-positioned homepage: sports betting intelligence software.
 * 16 componentized sections; content in landing-content.ts; tokens in
 * landing-v2.css (scoped .dlv2). Brand law: design-system/dime-ai/MASTER.md.
 *
 * Visitor journey (customer-journey framing):
 *   first impression (Hero) → product comprehension (Console + Chat + Mechanism)
 *   → trust (Signals w/ Pass, Trust module, Objections) → pricing → checkout.
 *
 * The live funnel at /landingpage is untouched; this route swaps in after
 * approval. Checkout stays in-domain via /checkout (Stripe Embedded Checkout).
 */

import { Suspense, lazy, useEffect } from "react";
import "./landing-v2.css";

import Nav from "./components/Nav";
import Hero from "./components/Hero";
// Both live-product demos are LAZY on purpose. The landing page is the
// first paint for every unauthenticated visitor (App.tsx keeps it eager for
// exactly that reason), and these two sections pull in real product code —
// the chat thread renderer + conversation.css, and the odds-history panel.
// Code-splitting them keeps that critical path byte-identical to before;
// the chunks arrive after paint, each inside a height-reserved frame so
// nothing shifts when they land.
const ChatDemo = lazy(() => import("./components/ChatDemo"));
const OddsHistoryDemo = lazy(() => import("./components/OddsHistoryDemo"));
import ProblemSection from "./components/ProblemSection";
import Mechanism from "./components/Mechanism";
import MarketSignals from "./components/MarketSignals";
import FeatureGrid from "./components/FeatureGrid";
import TrustArchitecture from "./components/TrustArchitecture";
import Pricing from "./components/Pricing";
import ObjectionHandling from "./components/ObjectionHandling";
import FAQSection from "./components/FAQSection";
import FinalCTA from "./components/FinalCTA";
import FooterSection from "./components/FooterSection";
import StickyCta from "./components/StickyCta";

export default function DimeLandingV2() {
  useEffect(() => {
    document.title = "dıme — See where price and probability disagree";
    return () => {
      // Keep the Dime title on unmount; routes that want a different title
      // set their own (never reset to the retired pre-rebrand name).
      document.title = "dıme — See where price and probability disagree";
    };
  }, []);

  // Cross-page fragment navigation (audit D-PRICING-HASH): wouter does not
  // scroll to #fragments, so /#pricing from login/checkout/404 landed at the
  // top of the page. Scroll after first paint; honor reduced motion.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      el.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="dlv2">
      <Nav />
      <main>
        <Hero /> {/* includes Dime Market Console + stats strip */}
        <Suspense fallback={<div className="sec-reserve" aria-hidden="true" />}>
          <ChatDemo />
        </Suspense>
        <ProblemSection />
        <Mechanism />
        <MarketSignals />
        <Suspense fallback={<div className="sec-reserve" aria-hidden="true" />}>
          <OddsHistoryDemo />
        </Suspense>
        <FeatureGrid />
        <TrustArchitecture />
        <Pricing />
        <ObjectionHandling />
        <FAQSection />
        <FinalCTA />
      </main>
      <FooterSection />
      <StickyCta />
    </div>
  );
}
