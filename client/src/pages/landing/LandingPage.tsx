import LandingNav from "./components/LandingNav";
import Hero from "./components/Hero";
import TrustBar from "./components/TrustBar";
import ProductPreviewTabs from "./components/ProductPreviewTabs";
import ValueProposition from "./components/ValueProposition";
import ModelProjectionsSection from "./components/ModelProjectionsSection";
import HowItWorks from "./components/HowItWorks";
import EdgeExplanation from "./components/EdgeExplanation";
import FeatureGrid from "./components/FeatureGrid";
import PricingCTA from "./components/PricingCTA";
import FAQ from "./components/FAQ";
import FinalCTA from "./components/FinalCTA";
import LandingFooter from "./components/LandingFooter";

export default function LandingPage() {
  return (
    <div
      className="min-h-screen"
      style={{ background: "#050810", color: "#ffffff" }}
    >
      <LandingNav />
      <Hero />
      <TrustBar />
      <ProductPreviewTabs />
      <ValueProposition />
      <ModelProjectionsSection />
      <HowItWorks />
      <EdgeExplanation />
      <FeatureGrid />
      <PricingCTA />
      <FAQ />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}
