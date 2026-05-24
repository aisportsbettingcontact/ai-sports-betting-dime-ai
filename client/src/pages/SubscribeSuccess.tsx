/**
 * SubscribeSuccess.tsx
 *
 * Post-checkout success page.
 * Stripe redirects here after a completed checkout session with:
 *   ?session_id=cs_live_...&plan=monthly|annual
 *
 * This page:
 *   1. Confirms the subscription to the user
 *   2. Invalidates the subscription query so the app reflects new access
 *   3. Provides a CTA to enter the platform
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { motion } from "framer-motion";

export default function SubscribeSuccess() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // Parse query params
  const params = new URLSearchParams(window.location.search);
  const plan = params.get("plan") ?? "monthly";
  const sessionId = params.get("session_id");

  // Invalidate subscription query so the app picks up new access immediately
  useEffect(() => {
    console.log("[SubscribeSuccess] Checkout completed — invalidating subscription cache");
    console.log(`[SubscribeSuccess] plan=${plan} session_id=${sessionId}`);
    utils.stripe.getSubscription.invalidate();
  }, [utils, plan, sessionId]);

  const planLabel = plan === "annual" ? "Annual" : "Monthly";
  const planPrice = plan === "annual" ? "$399/year" : "$49/month";

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #050810 0%, #0a0e16 100%)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="max-w-md w-full text-center"
      >
        {/* Success icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{
            background: "radial-gradient(circle, rgba(57,255,20,0.2) 0%, rgba(57,255,20,0.05) 100%)",
            border: "2px solid rgba(57,255,20,0.4)",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path
              d="M8 18l7 7L28 11"
              stroke="#39FF14"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          <h1
            className="text-3xl font-black text-white mb-2"
            style={{ letterSpacing: "-0.03em" }}
          >
            You're In.
          </h1>
          <p className="text-[#9ca3af] text-base mb-1">
            Your <span className="text-white font-semibold">{planLabel} Plan</span> is now active.
          </p>
          <p className="text-[#6b7280] text-sm mb-8">
            {planPrice} · Full access to all models, projections, and edge tools.
          </p>
        </motion.div>

        {/* Feature summary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="rounded-xl border border-white/10 p-5 mb-8 text-left"
          style={{ background: "rgba(10,14,22,0.95)" }}
        >
          <p className="text-[11px] font-bold text-[#6b7280] tracking-widest uppercase mb-3">
            What you now have access to
          </p>
          <ul className="space-y-2">
            {[
              "AI model projections across MLB, NBA, NFL, NHL",
              "Betting splits & public money percentages",
              "No-vig fair odds & ROI edge signals",
              "Live game feed with real-time updates",
              "Bet tracker & performance analytics",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-[13px] text-[#d1d5db]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
                  <circle cx="6" cy="6" r="6" fill="rgba(57,255,20,0.15)" />
                  <path d="M3.5 6l1.8 1.8L8.5 4.5" stroke="#39FF14" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.4 }}
          className="flex flex-col gap-3"
        >
          <button
            onClick={() => navigate("/feed")}
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-bold text-sm text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            style={{ background: "#39FF14" }}
          >
            Enter the Platform
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => navigate("/")}
            className="text-[13px] text-[#6b7280] hover:text-[#9ca3af] transition-colors"
          >
            Back to home
          </button>
        </motion.div>

        {/* Session ID for support */}
        {sessionId && (
          <p className="text-[10px] text-[#374151] mt-6">
            Order ref: {sessionId.slice(0, 24)}...
          </p>
        )}
      </motion.div>
    </div>
  );
}
