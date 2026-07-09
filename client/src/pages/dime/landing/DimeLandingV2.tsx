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

import { useEffect } from "react";
import "./landing-v2.css";

import Nav from "./components/Nav";
import Hero from "./components/Hero";
import ChatDemo from "./components/ChatDemo";
import ProblemSection from "./components/ProblemSection";
import Mechanism from "./components/Mechanism";
import MarketSignals from "./components/MarketSignals";
import FeatureGrid from "./components/FeatureGrid";
import TrustArchitecture from "./components/TrustArchitecture";
import Pricing from "./components/Pricing";
import ControlledAccess from "./components/ControlledAccess";
import ObjectionHandling from "./components/ObjectionHandling";
import FAQSection from "./components/FAQSection";
import FinalCTA from "./components/FinalCTA";
import FooterSection from "./components/FooterSection";
import StickyCta from "./components/StickyCta";

export default function DimeLandingV2() {
  useEffect(() => {
    document.title = "dıme — See where price and probability disagree";
    return () => {
      document.title = "AI Sports Betting Models";
    };
  }, []);

  return (
    <div className="dlv2">
      <Nav />
      <main>
        <Hero />           {/* includes Dime Market Console + stats strip */}
        <ChatDemo />
        <ProblemSection />
        <Mechanism />
        <MarketSignals />
        <FeatureGrid />
        <TrustArchitecture />
        <Pricing />
        <ControlledAccess />
        <ObjectionHandling />
        <FAQSection />
        <FinalCTA />
      </main>
      <FooterSection />
      <StickyCta />
    </div>
  );
}
