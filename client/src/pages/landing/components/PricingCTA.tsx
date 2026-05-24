/**
 * PricingCTA.tsx
 *
 * Pricing section for the landing page.
 * Clicking a plan button calls trpc.stripe.createCheckoutSession which
 * returns a Stripe Checkout URL — opened in a new tab.
 *
 * Payment methods enabled (via Stripe's automatic_payment_methods):
 *   Cards, Apple Pay, Google Pay, Affirm, Afterpay/Clearpay, Klarna, Link
 */

import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";

const PLANS = [
  {
    id: "monthly" as const,
    name: "Monthly",
    price: "$99.99",
    period: "/month",
    description: "Full access to all models, projections, splits, and edge tools. Cancel anytime.",
    features: [
      "All AI model projections",
      "Betting splits & money %",
      "No-vig fair odds",
      "ROI edge signals",
      "Multi-sport coverage",
      "Mobile-optimized dashboard",
    ],
    cta: "Start Monthly",
    highlight: false,
  },
  {
    id: "annual" as const,
    name: "Annual",
    price: "$499.99",
    period: "/year",
    badge: "Save 58%",
    description: "Best value. Lock in full-year access at over 58% off the monthly rate.",
    features: [
      "Everything in Monthly",
      "Priority model updates",
      "Historical backtesting access",
      "Advanced simulation outputs",
      "Early access to new sports",
      "Dedicated support",
    ],
    cta: "Start Annual",
    highlight: true,
  },
];

export default function PricingCTA() {
  const shouldReduce = useReducedMotion();
  const { appUser, loading: authLoading } = useAppAuth();
  const [loadingPlan, setLoadingPlan] = useState<"monthly" | "annual" | null>(null);

  const createCheckoutSession = trpc.stripe.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      // Open Stripe Checkout in a new tab
      window.open(data.url, "_blank");
      toast.success("Redirecting to secure checkout...");
      console.log("[PricingCTA] [OUTPUT] Checkout session created — opened in new tab");
      setLoadingPlan(null);
    },
    onError: (err) => {
      console.error("[PricingCTA] [VERIFY] FAIL — Checkout session error:", err.message);
      toast.error(err.message ?? "Failed to start checkout. Please try again.");
      setLoadingPlan(null);
    },
  });

  // [FIX] Auto-trigger checkout when user returns from login with ?checkout=<plan>.
  // Flow: unauthenticated click → sessionStorage.pendingCheckout set → redirect to /login
  // → Discord login → RootRoute reads pendingCheckout → redirects to /?checkout=<plan>
  // → LandingPage renders PricingCTA → this effect fires and auto-triggers checkout.
  useEffect(() => {
    if (authLoading || !appUser) return;
    const searchParams = new URLSearchParams(window.location.search);
    const checkoutParam = searchParams.get("checkout");
    if (checkoutParam !== "monthly" && checkoutParam !== "annual") return;
    console.log(`[PricingCTA] [INPUT] Auto-trigger checkout from URL param: checkout=${checkoutParam}`);
    // Remove the param from URL without triggering navigation
    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", newUrl);
    // Trigger checkout
    setLoadingPlan(checkoutParam);
    createCheckoutSession.mutate({
      planId: checkoutParam,
      origin: window.location.origin,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, appUser]);

  const handlePlanClick = (planId: "monthly" | "annual") => {
    console.log(`[PricingCTA] [INPUT] handlePlanClick — planId=${planId} appUser=${appUser?.id ?? "null"} authLoading=${authLoading}`);

    // [FIX] If the user is not logged in, store the pending checkout in sessionStorage
    // and redirect to /login. After Discord login, RootRoute reads pendingCheckout
    // and redirects to /?checkout=<plan> which auto-triggers checkout via useEffect above.
    // This avoids ANY Manus OAuth redirect from the pricing buttons.
    if (!authLoading && !appUser) {
      console.log(`[PricingCTA] [STATE] Unauthenticated — storing pendingCheckout=${planId} and redirecting to /login`);
      sessionStorage.setItem("pendingCheckout", planId);
      toast.info("Please sign in with Discord to continue to checkout.", { duration: 3000 });
      // Redirect to /login with returnPath=/ so after login they land on the landing page
      // where the auto-trigger effect will fire.
      window.location.href = `/login?returnPath=${encodeURIComponent("/")}`;
      return;
    }

    setLoadingPlan(planId);
    toast.info("Opening secure checkout...", { duration: 2000 });

    createCheckoutSession.mutate({
      planId,
      origin: window.location.origin,
    });
  };

  return (
    <section
      id="pricing"
      className="py-24 px-4 sm:px-6 lg:px-8"
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
          className="text-center mb-12"
        >
          <h2
            className="text-3xl sm:text-4xl font-bold text-white mb-4"
            style={{ letterSpacing: "-0.03em" }}
          >
            One Subscription. Full Access.
          </h2>
          <p className="text-[#9ca3af] text-lg">
            No tiers. No feature gating. Every tool, every sport, every model.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-5">
          {PLANS.map((plan, i) => {
            const isLoading = loadingPlan === plan.id;

            return (
              <motion.div
                key={plan.id}
                initial={shouldReduce ? false : { opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                className={`relative rounded-xl border p-8 flex flex-col gap-6 ${
                  plan.highlight ? "border-[#39FF14]/40" : "border-white/10"
                }`}
                style={{
                  background: plan.highlight
                    ? "linear-gradient(145deg, rgba(57,255,20,0.05) 0%, rgba(10,14,22,0.98) 100%)"
                    : "rgba(10,14,22,0.95)",
                  boxShadow: plan.highlight ? "0 0 40px rgba(57,255,20,0.08)" : "none",
                }}
              >
                {plan.badge && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold text-black"
                    style={{ background: "#39FF14" }}
                  >
                    {plan.badge}
                  </div>
                )}

                <div>
                  <span className="text-[12px] font-bold text-[#6b7280] tracking-widest uppercase">
                    {plan.name}
                  </span>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span
                      className="text-4xl font-black text-white"
                      style={{ letterSpacing: "-0.04em" }}
                    >
                      {plan.price}
                    </span>
                    <span className="text-[#6b7280] text-sm">{plan.period}</span>
                  </div>
                  <p className="text-[13px] text-[#9ca3af] mt-2 leading-relaxed">
                    {plan.description}
                  </p>
                </div>

                <ul className="space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-[13px] text-[#d1d5db]">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        className="flex-shrink-0"
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
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePlanClick(plan.id)}
                  disabled={isLoading || loadingPlan !== null}
                  className={`mt-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-bold text-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
                    plan.highlight
                      ? "text-black"
                      : "text-white border border-white/15 bg-white/5 hover:bg-white/10"
                  }`}
                  style={plan.highlight ? { background: "#39FF14" } : {}}
                >
                  {isLoading ? (
                    <>
                      {/* Spinner */}
                      <svg
                        className="animate-spin"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeDasharray="31.4 31.4"
                          strokeLinecap="round"
                        />
                      </svg>
                      Opening Checkout...
                    </>
                  ) : (
                    <>
                      {plan.cta}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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
              </motion.div>
            );
          })}
        </div>

        {/* Payment method logos row */}
        <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
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
        <p className="text-center text-[11px] text-[#4b5563] mt-3">
          Payments processed securely by Stripe. Cancel anytime.
        </p>
      </div>
    </section>
  );
}
