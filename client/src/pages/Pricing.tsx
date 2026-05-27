/**
 * Pricing.tsx — Standalone /pricing page
 *
 * Renders the full pricing section with nav and footer.
 * Accessible at /pricing and linked from the Sign Up button on the login page.
 *
 * Layout:
 *   - LandingNav (sticky top)
 *   - PricingCTA (full pricing cards with per-day callout + auto-renewal disclosure)
 *   - LandingFooter
 *
 * SEO: sets document.title on mount.
 */

import { useEffect, Suspense, lazy } from "react";
import LandingNav from "./landing/components/LandingNav";
import LandingFooter from "./landing/components/LandingFooter";

const PricingCTA = lazy(() => import("./landing/components/PricingCTA"));

export default function Pricing() {
  useEffect(() => {
    document.title = "Pricing — AI Sports Betting Models";
    return () => {
      document.title = "AI Sports Betting Models";
    };
  }, []);

  return (
    <div
      className="min-h-screen"
      style={{ background: "#050810", color: "#ffffff" }}
    >
      <LandingNav />

      {/* Top padding to clear the fixed nav (64px height) */}
      <div style={{ paddingTop: "64px" }}>
        <Suspense fallback={null}>
          <PricingCTA />
        </Suspense>
      </div>

      <LandingFooter />
    </div>
  );
}
