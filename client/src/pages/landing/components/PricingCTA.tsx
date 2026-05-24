/**
 * PricingCTA.tsx
 *
 * Pricing section for the landing page.
 *
 * Layout rules (all viewports):
 *   - ALWAYS side-by-side (grid-cols-2), never stacked
 *   - Both cards are IDENTICAL height — achieved via `items-stretch` + `h-full`
 *   - No transform scale on Annual — prominence via border, glow, badge, color
 *   - On mobile (< 480px) cards are compact: clamp-based padding, no description
 *
 * Checkout flow (NO MODAL):
 *   - Unauthenticated user clicks "Click Here"
 *     → publicCreateCheckoutSession (no auth required) → Stripe Checkout
 *     → Stripe collects email + "Desired Username" custom field + payment
 *   - Authenticated user clicks "Click Here"
 *     → createCheckoutSession → Stripe Checkout
 *     → email + username prefilled from account
 *   - Same-tab redirect (window.location.href) — no popup blocker issues
 *
 * Annual savings callout:
 *   - Badge: "Best Value — Save 58%"
 *   - Equivalent monthly cost: "$41.67/mo"
 *   - Savings amount: "Save $699.89/year vs monthly"
 */

import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";


// ─── Plan definitions ─────────────────────────────────────────────────────────

const MONTHLY_PRICE = 99.99;
const ANNUAL_PRICE = 499.99;
const ANNUAL_EQUIV_MONTHLY = (ANNUAL_PRICE / 12).toFixed(2); // 41.67
const ANNUAL_SAVINGS = ((MONTHLY_PRICE * 12) - ANNUAL_PRICE).toFixed(2); // 699.89
const ANNUAL_SAVINGS_PCT = Math.round(((MONTHLY_PRICE * 12 - ANNUAL_PRICE) / (MONTHLY_PRICE * 12)) * 100); // 58

const PLANS = [
  {
    id: "monthly" as const,
    name: "Monthly",
    price: "$99.99",
    period: "/month",
    savingsLine: null as string | null,
    equivLine: null as string | null,
    description: "Full access to all models, projections, splits, and edge tools. Cancel anytime.",
    features: [
      "All AI model projections",
      "Betting splits & money %",
      "No-vig fair odds",
      "ROI edge signals",
      "Multi-sport coverage",
      "Mobile-optimized dashboard",
    ],
    cta: "Click Here",
    highlight: false,
    badge: null as string | null,
  },
  {
    id: "annual" as const,
    name: "Annual",
    price: "$499.99",
    period: "/year",
    savingsLine: `Save $${ANNUAL_SAVINGS}/year vs monthly`,
    equivLine: `Only $${ANNUAL_EQUIV_MONTHLY}/mo — ${ANNUAL_SAVINGS_PCT}% off`,
    badge: `Best Value — Save ${ANNUAL_SAVINGS_PCT}%`,
    description: `Lock in full-year access. Equivalent to just $${ANNUAL_EQUIV_MONTHLY}/month.`,
    features: [
      "Everything in Monthly",
      "Priority model updates",
      "Historical backtesting access",
      "Advanced simulation outputs",
      "Early access to new sports",
      "Dedicated support",
    ],
    cta: "Click Here",
    highlight: true,
  },
] as const;

type PlanId = "monthly" | "annual";

// ─── Main component ───────────────────────────────────────────────────────────

export default function PricingCTA() {
  const shouldReduce = useReducedMotion();
  const { appUser, loading: authLoading } = useAppAuth();
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  // ── Authenticated checkout mutation ──────────────────────────────────────────
  const createCheckoutSession = trpc.stripe.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      console.log("[PricingCTA] [OUTPUT] Authenticated checkout session created — redirecting to:", data.url);
      window.location.replace(data.url);
      setLoadingPlan(null);
    },
    onError: (err) => {
      console.error("[PricingCTA] [VERIFY] FAIL — Authenticated checkout error:", err.message);
      setLoadingPlan(null);
    },
  });

  // ── Public (unauthenticated) checkout mutation ────────────────────────────────
  const publicCreateCheckoutSession = trpc.stripe.publicCreateCheckoutSession.useMutation({
    onSuccess: (data) => {
      console.log("[PricingCTA] [OUTPUT] Public checkout session created — redirecting to:", data.url);
      window.location.replace(data.url);
      setLoadingPlan(null);
    },
    onError: (err) => {
      console.error("[PricingCTA] [VERIFY] FAIL — Public checkout error:", err.message);
      setLoadingPlan(null);
    },
  });

  // ── Handle button click ───────────────────────────────────────────────────────
  const handlePlanClick = (planId: PlanId) => {
    console.log(`[PricingCTA] [INPUT] handlePlanClick planId=${planId} appUser=${appUser?.id ?? "anon"} authLoading=${authLoading}`);

    if (loadingPlan !== null) {
      console.log("[PricingCTA] [STATE] Already loading — ignoring duplicate click");
      return;
    }

    setLoadingPlan(planId);

    if (!authLoading && appUser) {
      // ── Authenticated path: email + username prefilled from account ──────────
      console.log(`[PricingCTA] [STATE] Authenticated — calling createCheckoutSession planId=${planId}`);
      createCheckoutSession.mutate({ planId, origin: window.location.origin });
    } else {
      // ── Unauthenticated path: straight to Stripe, no modal ──────────────────
      // Stripe Checkout will collect: email (native), Desired Username (custom field), payment
      console.log(`[PricingCTA] [STATE] Unauthenticated — calling publicCreateCheckoutSession planId=${planId}`);
      publicCreateCheckoutSession.mutate({ planId, origin: window.location.origin });
    }
  };

  // ── Safety reset if auth state resolves while loading ────────────────────────
  useEffect(() => {
    if (!authLoading && loadingPlan === null) return;
    // No-op: loading state is cleared in mutation callbacks
  }, [authLoading, loadingPlan]);

  return (
    <section
      id="pricing"
      className="py-14 px-4 sm:px-6 lg:px-8"
      style={{
        background:
          "radial-gradient(ellipse 80% 50% at 50% 100%, rgba(57,255,20,0.05) 0%, transparent 60%), rgba(5,8,16,0.95)",
      }}
    >
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={shouldReduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white mb-3"
            style={{ letterSpacing: "-0.03em" }}
          >
            One Subscription. Full Access.
          </h2>
          <p className="text-[#9ca3af] text-base">
            No tiers. No feature gating. Every tool, every sport, every model.
          </p>
        </motion.div>

        {/*
          ── Card grid ──────────────────────────────────────────────────────────
          Rules:
          - grid-cols-2 at ALL viewport widths (never stacked)
          - items-stretch so both cells are the same height
          - NO transform scale on Annual — equal heights via h-full flex-col
          - Badge sits INSIDE the card at the top to avoid height mismatch
        */}
        <div className="grid grid-cols-2 gap-3 sm:gap-5 items-stretch">
          {PLANS.map((plan, i) => {
            const isLoading = loadingPlan === plan.id;

            return (
              <motion.div
                key={plan.id}
                initial={shouldReduce ? false : { opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                className="relative flex flex-col h-full"
              >
                <div
                  className="rounded-xl border flex flex-col h-full"
                  style={{
                    borderColor: plan.highlight ? "rgba(57,255,20,0.55)" : "rgba(255,255,255,0.1)",
                    background: plan.highlight
                      ? "linear-gradient(145deg, rgba(57,255,20,0.08) 0%, rgba(10,14,22,0.98) 100%)"
                      : "rgba(10,14,22,0.95)",
                    boxShadow: plan.highlight
                      ? "0 0 56px rgba(57,255,20,0.14), 0 8px 32px rgba(0,0,0,0.5)"
                      : "0 4px 16px rgba(0,0,0,0.3)",
                    padding: "clamp(12px, 3vw, 28px)",
                    gap: "clamp(10px, 2vw, 20px)",
                  }}
                >
                  {/* ── Badge (inside card, top) ── */}
                  {plan.badge && (
                    <div className="flex justify-center">
                      <span
                        className="px-3 py-1 rounded-full font-bold text-black"
                        style={{
                          background: "#39FF14",
                          fontSize: "clamp(9px, 1.8vw, 11px)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {plan.badge}
                      </span>
                    </div>
                  )}

                  {/* ── Plan name ── */}
                  <div>
                    <span
                      className="font-bold tracking-widest uppercase"
                      style={{
                        color: plan.highlight ? "#39FF14" : "#6b7280",
                        fontSize: "clamp(9px, 1.8vw, 11px)",
                      }}
                    >
                      {plan.name}
                    </span>

                    {/* Price */}
                    <div className="flex items-baseline gap-1 mt-1">
                      <span
                        className="font-black text-white"
                        style={{
                          fontSize: "clamp(1.4rem, 4.5vw, 2.5rem)",
                          letterSpacing: "-0.04em",
                          lineHeight: 1,
                        }}
                      >
                        {plan.price}
                      </span>
                      <span
                        className="text-[#6b7280]"
                        style={{ fontSize: "clamp(10px, 1.8vw, 14px)" }}
                      >
                        {plan.period}
                      </span>
                    </div>

                    {/* Annual: equivalent monthly + savings callout */}
                    {plan.equivLine && (
                      <div className="mt-1.5 space-y-0.5">
                        <p
                          className="font-bold"
                          style={{
                            color: "#39FF14",
                            fontSize: "clamp(10px, 2vw, 13px)",
                          }}
                        >
                          {plan.equivLine}
                        </p>
                        <p
                          className="text-[#9ca3af]"
                          style={{ fontSize: "clamp(9px, 1.6vw, 11px)" }}
                        >
                          {plan.savingsLine}
                        </p>
                      </div>
                    )}

                    {/* Description — hidden on very small screens to keep cards compact */}
                    <p
                      className="text-[#9ca3af] mt-1.5 leading-relaxed hidden xs:block sm:block"
                      style={{ fontSize: "clamp(10px, 1.8vw, 12px)" }}
                    >
                      {plan.description}
                    </p>
                  </div>

                  {/* ── Features ── */}
                  <ul className="space-y-1.5 flex-1">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-1.5 text-[#d1d5db]"
                        style={{ fontSize: "clamp(10px, 1.8vw, 13px)" }}
                      >
                        <svg
                          viewBox="0 0 14 14"
                          fill="none"
                          className="flex-shrink-0 mt-0.5"
                          style={{ width: "clamp(11px, 2vw, 14px)", height: "clamp(11px, 2vw, 14px)" }}
                        >
                          <circle cx="7" cy="7" r="7" fill="rgba(57,255,20,0.15)" />
                          <path
                            d="M4.5 7l1.8 1.8L9.5 5.5"
                            stroke="#39FF14"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* ── CTA button ── */}
                  <button
                    onClick={() => handlePlanClick(plan.id)}
                    disabled={loadingPlan !== null}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg font-bold transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
                      plan.highlight
                        ? "text-black"
                        : "text-white border border-white/15 bg-white/5 hover:bg-white/10"
                    }`}
                    style={{
                      background: plan.highlight ? "#39FF14" : undefined,
                      padding: "clamp(8px, 2vw, 12px) clamp(10px, 2.5vw, 16px)",
                      fontSize: "clamp(11px, 2vw, 14px)",
                      width: "100%",
                    }}
                  >
                    {isLoading ? (
                      <>
                        <svg
                          className="animate-spin"
                          style={{ width: "clamp(11px, 2vw, 13px)", height: "clamp(11px, 2vw, 13px)" }}
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            cx="12" cy="12" r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeDasharray="31.4 31.4"
                            strokeLinecap="round"
                          />
                        </svg>
                        Opening...
                      </>
                    ) : (
                      <>
                        {plan.cta}
                        <svg
                          style={{ width: "clamp(10px, 1.8vw, 13px)", height: "clamp(10px, 1.8vw, 13px)" }}
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M3 8h10M9 4l4 4-4 4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Payment methods */}
        <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
          <span className="text-[11px] text-[#4b5563]">Accepted:</span>
          {["Visa", "Mastercard", "Amex", "Apple Pay", "Google Pay", "Affirm", "Afterpay", "Klarna"].map((method) => (
            <span
              key={method}
              className="text-[10px] font-medium text-[#6b7280] border border-white/10 rounded px-2 py-0.5"
            >
              {method}
            </span>
          ))}
        </div>
        <p className="text-center text-[11px] text-[#4b5563] mt-2">
          Payments processed securely by Stripe. Cancel anytime.
        </p>
      </div>
    </section>
  );
}
