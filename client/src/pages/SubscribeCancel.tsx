/**
 * SubscribeCancel.tsx
 *
 * Shown when the user cancels out of Stripe Checkout.
 * Provides a clear path back to the pricing section or the platform.
 */

import { useLocation } from "wouter";
import { motion } from "framer-motion";

export default function SubscribeCancel() {
  const [, navigate] = useLocation();

  const params = new URLSearchParams(window.location.search);
  const plan = params.get("plan") ?? "monthly";

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#000000" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="max-w-md w-full text-center"
      >
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{
            background: "transparent",
            border: "1px solid #FFFFFF",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M8 14h12" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <h1
          className="text-2xl font-black text-white mb-2"
          style={{ letterSpacing: "-0.03em" }}
        >
          Checkout cancelled
        </h1>
        <p className="text-white text-sm mb-8">
          No charge was made. You can return to the pricing page anytime to subscribe.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => {
              navigate("/");
              // Small delay to let navigation complete, then scroll to pricing
              setTimeout(() => {
                document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
              }, 100);
            }}
            className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg font-bold text-sm text-black transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            style={{ background: "#45E0A8" }}
          >
            View pricing
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => navigate("/")}
            className="text-[13px] text-white hover:text-white transition-colors"
          >
            Back to home
          </button>
        </div>

        <p className="text-[11px] text-white mt-8">
          Questions? Contact support. We're here to help.
        </p>
      </motion.div>
    </div>
  );
}
