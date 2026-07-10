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
 * Checkout flow (NO MODAL, NO STRIPE-HOSTED PAGE):
 *   - Every CTA navigates to /checkout?plan=<id> — the on-domain page that
 *     mounts Stripe Embedded Checkout. Owner directive: Stripe must never
 *     redirect off-site; the embedded page is the only checkout surface.
 */

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";


// ─── Plan definitions ─────────────────────────────────────────────────────────

const MONTHLY_PRICE = 99;
const ANNUAL_PRICE = 499;
const ANNUAL_EQUIV_MONTHLY = Math.round(ANNUAL_PRICE / 12); // 42
const ANNUAL_SAVINGS = (MONTHLY_PRICE * 12) - ANNUAL_PRICE; // 689
const ANNUAL_SAVINGS_PCT = Math.round(((MONTHLY_PRICE * 12 - ANNUAL_PRICE) / (MONTHLY_PRICE * 12)) * 100); // 58
const MONTHLY_PER_DAY = (MONTHLY_PRICE / 30).toFixed(2);  // 3.30
const ANNUAL_PER_DAY  = (ANNUAL_PRICE  / 365).toFixed(2); // 1.37

const PLANS = [
  {
    id: "monthly" as const,
    name: "Monthly",
    price: "$99",
    period: "/month",
    perDay: `$${MONTHLY_PER_DAY}/day`,
    billedAs: "billed $99 monthly",
    savingsLine: null as string | null,
    equivLine: null as string | null,
    description: "Full access to all models, projections, splits, and market signals. Auto-renews monthly. Cancel anytime.",
    features: [
      "All AI model projections",
      "Betting splits & money %",
      "No-vig fair odds",
      "Sharp market signals",
      "Multi-sport coverage",
      "Mobile-optimized dashboard",
    ],
    cta: "Get Monthly Access",
    highlight: false,
    badge: null as string | null,
  },
  {
    id: "annual" as const,
    name: "Annual",
    price: "$499",
    period: "/year",
    perDay: `$${ANNUAL_PER_DAY}/day`,
    billedAs: "billed $499 annually",
    savingsLine: `Save $${ANNUAL_SAVINGS}/year vs monthly`,
    equivLine: `Only $${ANNUAL_EQUIV_MONTHLY}/mo, ${ANNUAL_SAVINGS_PCT}% off`,
    badge: `Best Value. Save ${ANNUAL_SAVINGS_PCT}%`,
    description: `Lock in full-year access. Equivalent to just $${ANNUAL_EQUIV_MONTHLY}/month. Auto-renews annually.`,
    features: [
      "All AI model projections",
      "Betting splits & money %",
      "Priority model updates",
      "Historical backtesting access",
      "Advanced simulation outputs",
      "Early access to new sports",
      "Dedicated priority support",
    ],
    cta: "Get Annual Access",
    highlight: true,
  },
] as const;

type PlanId = "monthly" | "annual";

// ─── Main component ───────────────────────────────────────────────────────────

export default function PricingCTA() {
  const shouldReduce = useReducedMotion();
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  // ── Handle button click — embedded checkout only, never a hosted redirect ────
  const handlePlanClick = (planId: PlanId) => {
    console.log(`[PricingCTA] [INPUT] handlePlanClick planId=${planId} — navigating to embedded /checkout`);
    if (loadingPlan !== null) return;
    setLoadingPlan(planId);
    window.location.assign(`/checkout?plan=${planId}`);
  };

  return (
    <section
      id="pricing"
      style={{
        padding: "3.5rem clamp(16px, 4vw, 64px)",
        background:
          "radial-gradient(ellipse 80% 50% at 50% 100%, rgba(57,255,20,0.05) 0%, transparent 60%), rgba(5,8,16,0.95)",
      }}
    >
      <div className="max-w-screen-2xl mx-auto">
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
            Choose monthly flexibility or lock in annual savings. Full access on every plan.
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
                          fontSize: "clamp(10px, 1.8vw, 11px)",
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
                        color: plan.highlight ? "#39FF14" : "#9ca3af",
                        fontSize: "clamp(11px, 1.8vw, 11px)",
                      }}
                    >
                      {plan.name}
                    </span>

                    {/* Price + per-day */}
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
                        className="text-[#9ca3af]"
                        style={{ fontSize: "clamp(11px, 1.8vw, 14px)" }}
                      >
                        {plan.period}
                      </span>
                    </div>
                    {/* Per-day callout */}
                    <div className="mt-1 flex flex-col gap-0.5">
                      <span
                        className="font-bold"
                        style={{
                          color: plan.highlight ? "#39FF14" : "#d1d5db",
                          fontSize: "clamp(11px, 2.2vw, 15px)",
                        }}
                      >
                        {plan.perDay}
                      </span>
                      <span
                        className="text-[#9ca3af]"
                        style={{ fontSize: "clamp(11px, 1.6vw, 11px)" }}
                      >
                        {plan.billedAs}
                      </span>
                    </div>

                    {/* Annual: equivalent monthly + savings callout */}
                    {plan.equivLine && (
                      <div className="mt-1.5 space-y-0.5">
                        <p
                          className="font-bold"
                          style={{
                            color: "#39FF14",
                            fontSize: "clamp(11px, 2vw, 13px)",
                          }}
                        >
                          {plan.equivLine}
                        </p>
                        <p
                          className="text-[#9ca3af]"
                          style={{ fontSize: "clamp(11px, 1.6vw, 11px)" }}
                        >
                          {plan.savingsLine}
                        </p>
                      </div>
                    )}

                    {/* Description — hidden on very small screens to keep cards compact */}
                    <p
                      className="text-[#9ca3af] mt-1.5 leading-relaxed hidden xs:block sm:block"
                      style={{ fontSize: "clamp(11px, 1.8vw, 12px)" }}
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
                        style={{ fontSize: "clamp(11px, 1.8vw, 13px)" }}
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
                    {loadingPlan === plan.id ? (
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
                            strokeDashoffset="10"
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

        {/* Payment methods — real SVG logos */}
        <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
          <span className="text-[11px] text-[#9ca3af] mr-1">Accepted:</span>
          {/* Visa */}
          <svg viewBox="0 0 780 500" height="20" aria-label="Visa">
            <rect width="780" height="500" rx="40" fill="#1A1F71"/>
            <path d="M293.2 348.7l33.4-195.7h53.4l-33.4 195.7h-53.4zm246.9-191c-10.6-3.9-27.2-8.1-47.9-8.1-52.8 0-90 26.5-90.3 64.5-.3 28.1 26.6 43.8 46.9 53.1 20.8 9.6 27.8 15.7 27.7 24.3-.1 13.1-16.6 19.1-32 19.1-21.4 0-32.8-3-50.4-10.4l-6.9-3.1-7.5 43.7c12.5 5.4 35.6 10.2 59.6 10.4 56.2 0 92.7-26.2 93.1-66.8.2-22.2-14-39.2-44.7-53.1-18.6-9-30-15-29.9-24.2 0-8.1 9.6-16.8 30.5-16.8 17.4-.3 30 3.5 39.8 7.4l4.8 2.2 7.2-42.2zm137.5-4.7h-41.3c-12.8 0-22.4 3.5-28 16.2l-79.4 179.5h56.1s9.2-24.1 11.2-29.4c6.1 0 60.5.1 68.3.1 1.6 6.8 6.5 29.3 6.5 29.3h49.6l-43-195.7zm-65.5 126.3c4.4-11.2 21.2-54.5 21.2-54.5-.3.5 4.4-11.3 7.1-18.6l3.6 16.8s10.2 46.5 12.3 56.3h-44.2zm-424.4-126.3l-52.4 133.5-5.6-27.2c-9.7-31.2-40-65-73.9-81.9l47.9 171.2 56.5-.1 84.1-195.5h-56.6z" fill="#fff"/>
            <path d="M146.9 153h-86.2l-.7 4c67.1 16.2 111.5 55.3 129.9 102.3l-18.7-89.9c-3.2-12.4-12.6-16.1-24.3-16.4z" fill="#F9A533"/>
          </svg>
          {/* Mastercard */}
          <svg viewBox="0 0 131.39 86.9" height="20" aria-label="Mastercard">
            <rect width="131.39" height="86.9" rx="7" fill="#252525"/>
            <circle cx="47.5" cy="43.45" r="27.45" fill="#EB001B"/>
            <circle cx="83.89" cy="43.45" r="27.45" fill="#F79E1B"/>
            <path d="M65.7 21.1a27.45 27.45 0 0 1 0 44.7 27.45 27.45 0 0 1 0-44.7z" fill="#FF5F00"/>
          </svg>
          {/* Amex */}
          <svg viewBox="0 0 750 471" height="20" aria-label="American Express">
            <rect width="750" height="471" rx="40" fill="#2557D6"/>
            <path d="M0 169h750v133H0z" fill="#2557D6"/>
            <path d="M74 169l-74 133h64l10-25h73l10 25h65l-74-133H74zm31 39l22 55H83l22-55zm120-39v133h57v-43h18l40 43h69l-47-50c20-7 33-23 33-44 0-30-22-39-55-39h-115zm57 44h51c11 0 17 5 17 14s-6 14-17 14h-51v-28zm130-44v133h170v-37h-113v-15h110v-35h-110v-15h113v-31H412zm195 0l-55 63 55 70h68l-53-67 53-66h-68zm72 0v133h57v-133h-57z" fill="#fff"/>
          </svg>
          {/* Apple Pay */}
          <svg viewBox="0 0 165.521 105.965" height="20" aria-label="Apple Pay">
            <rect width="165.521" height="105.965" rx="10" fill="#000"/>
            <path d="M43.234 35.077c-2.08 2.469-5.412 4.406-8.744 4.13-.414-3.332 1.218-6.871 3.125-9.064 2.08-2.538 5.722-4.337 8.675-4.475.345 3.47-1.012 6.871-3.056 9.409zm2.987 4.751c-4.82-.276-8.951 2.745-11.237 2.745-2.322 0-5.861-2.607-9.71-2.538-5.00.069-9.64 2.917-12.18 7.426-5.24 9.02-1.38 22.41 3.71 29.77 2.47 3.61 5.44 7.6 9.33 7.46 3.71-.14 5.17-2.4 9.64-2.4 4.48 0 5.79 2.4 9.71 2.33 4.03-.07 6.56-3.61 9.02-7.22 2.81-4.1 3.96-8.06 4.03-8.27-.07-.07-7.77-3.0-7.84-11.86-.07-7.39 6.04-10.94 6.32-11.1-3.47-5.1-8.88-5.65-10.8-5.72z" fill="#fff"/>
            <path d="M82.697 30.162v45.22h7.01v-15.47h9.71c8.88 0 15.1-6.08 15.1-14.9 0-8.81-6.08-14.85-14.82-14.85h-17zm7.01 5.93h8.09c6.08 0 9.57 3.26 9.57 8.95 0 5.69-3.49 8.98-9.6 8.98h-8.06v-17.93zm38.99 39.63c4.41 0 8.5-2.23 10.35-5.76h.14v5.41h6.49V50.2c0-6.52-5.24-10.73-13.29-10.73-7.49 0-13.02 4.27-13.23 10.14h6.32c.52-2.79 3.12-4.61 6.63-4.61 4.27 0 6.67 1.99 6.67 5.65v2.47l-8.71.52c-8.09.48-12.47 3.81-12.47 9.57 0 5.83 4.54 9.64 11.1 9.64zm1.89-5.44c-3.74 0-6.12-1.79-6.12-4.54 0-2.85 2.29-4.47 6.67-4.72l7.77-.48v2.54c0 4.06-3.46 7.2-8.32 7.2zm28.72 17.54c6.84 0 10.07-2.61 12.88-10.56l12.33-34.66h-7.15l-8.26 26.81h-.14l-8.26-26.81h-7.39l11.93 33.01-.65 2.02c-1.09 3.43-2.85 4.75-6.01 4.75-.56 0-1.65-.07-2.09-.14v5.44c.48.14 2.47.14 2.81.14z" fill="#fff"/>
          </svg>
          {/* Google Pay */}
          <svg viewBox="0 0 41 17" height="20" aria-label="Google Pay">
            <rect width="41" height="17" rx="3" fill="#fff"/>
            <path d="M19.526 8.374v3.09h-.98V3.986h2.6c.662 0 1.225.22 1.687.66.47.44.705.976.705 1.608 0 .648-.235 1.186-.705 1.614-.454.428-1.017.642-1.688.642h-1.62v-.136zm0-3.44v2.49h1.64c.39 0 .716-.134.977-.4.268-.267.402-.59.402-.962 0-.365-.134-.685-.402-.96-.261-.268-.587-.402-.977-.41h-1.64v.242zm6.463 1.21c.727 0 1.3.194 1.72.583.42.388.63.92.63 1.594v3.22h-.935v-.726h-.042c-.405.597-.944.896-1.618.896-.575 0-1.056-.17-1.443-.51-.388-.34-.582-.766-.582-1.278 0-.54.204-.97.612-1.287.408-.322.953-.483 1.635-.483.582 0 1.062.107 1.44.32v-.225c0-.34-.134-.63-.402-.87-.268-.24-.583-.36-.944-.36-.545 0-.975.23-1.29.69l-.862-.54c.47-.676 1.17-1.014 2.1-1.014zm-1.263 3.79c0 .255.107.47.32.643.214.172.462.258.743.258.402 0 .76-.15 1.073-.45.314-.3.47-.65.47-1.05-.295-.234-.706-.35-1.233-.35-.384 0-.703.093-.957.28-.255.185-.416.42-.416.67zm9.286-3.62l-3.28 7.54h-1.013l1.217-2.634-2.155-4.906h1.07l1.554 3.754h.02l1.514-3.754h1.073z" fill="#3C4043"/>
            <path d="M13.8 8.07c0-.3-.026-.587-.075-.862H9.6v1.63h2.35c-.1.544-.407 1.005-.866 1.315v1.09h1.4c.82-.755 1.293-1.868 1.293-3.172z" fill="#4285F4"/>
            <path d="M9.6 12.4c1.18 0 2.17-.39 2.893-1.057l-1.4-1.09c-.39.263-.89.418-1.493.418-1.148 0-2.12-.775-2.468-1.817H5.69v1.126C6.41 11.59 7.9 12.4 9.6 12.4z" fill="#34A853"/>
            <path d="M7.132 8.854c-.088-.263-.138-.543-.138-.834s.05-.57.138-.834V6.06H5.69C5.39 6.65 5.22 7.31 5.22 8.02s.17 1.37.47 1.96l1.442-1.126z" fill="#FBBC04"/>
            <path d="M9.6 5.37c.647 0 1.228.222 1.685.658l1.264-1.264C11.77 4.01 10.78 3.6 9.6 3.6 7.9 3.6 6.41 4.41 5.69 5.98l1.442 1.126C7.48 6.065 8.452 5.37 9.6 5.37z" fill="#EA4335"/>
          </svg>
          {/* Affirm */}
          <svg viewBox="0 0 60 24" height="18" aria-label="Affirm">
            <rect width="60" height="24" rx="4" fill="#060809"/>
            <text x="6" y="17" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="12" fill="#fff" letterSpacing="0.5">affirm</text>
          </svg>
          {/* Afterpay */}
          <svg viewBox="0 0 80 24" height="18" aria-label="Afterpay">
            <rect width="80" height="24" rx="4" fill="#B2FCE4"/>
            <text x="8" y="17" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="11" fill="#000">afterpay</text>
          </svg>
          {/* Klarna */}
          <svg viewBox="0 0 60 24" height="18" aria-label="Klarna">
            <rect width="60" height="24" rx="4" fill="#FFB3C7"/>
            <text x="8" y="17" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="12" fill="#17120E">klarna</text>
          </svg>
        </div>
        <p className="text-center text-[11px] text-[#9ca3af] mt-2">
          Payments processed securely by Stripe. Subscriptions auto-renew at the end of each billing period. Cancel anytime before renewal to avoid the next charge.
        </p>
      </div>
    </section>
  );
}
