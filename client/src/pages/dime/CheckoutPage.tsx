/**
 * /checkout?plan=monthly|annual — in-domain, Dime-branded Stripe checkout.
 *
 * ONLY path: Stripe Embedded Checkout (ui_mode:"embedded") mounted inside a
 * Dime shell — the URL never leaves the domain and Stripe controls all card
 * inputs (no raw card data ever touches our code). Redirecting to the
 * Stripe-hosted checkout page is FORBIDDEN (owner directive, 2026-07-10) —
 * there is no hosted fallback.
 *
 * Publishable-key resolution: build-time VITE_STRIPE_PUBLISHABLE_KEY when
 * present, otherwise fetched at runtime from stripe.publicGetConfig — so the
 * embedded form works on builds that had no env vars (Railway Docker image,
 * Vercel without project env). If no key is available at all, the page shows
 * an explicit error with retry — never a redirect.
 *
 * States: loading → embedded form | error (+retry).
 * Success returns to /subscribe/success (existing fulfillment page);
 * cancel is simply navigating back — a "Back to pricing" link is always visible.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import "./landing/landing-v2.css";
import { Wordmark } from "./landing/components/shared";

type PlanId = "monthly" | "annual";

const PLAN_COPY: Record<PlanId, { name: string; price: string; period: string; perDay: string; renewal: string }> = {
  monthly: {
    name: "Pro — Monthly",
    price: "$99.99",
    period: "/ month",
    perDay: "≈ $3.30 / day",
    renewal: "Auto-renews monthly at $99.99 until cancelled. Cancel anytime before renewal.",
  },
  annual: {
    name: "Elite — Annual",
    price: "$499.99",
    period: "/ year",
    perDay: "≈ $1.37 / day · save 58% vs monthly",
    renewal: "Auto-renews annually at $499.99 until cancelled. Cancel anytime before renewal.",
  },
};

const PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? "";

function parsePlan(search: string): PlanId {
  const plan = new URLSearchParams(search).get("plan");
  return plan === "annual" ? "annual" : "monthly";
}

export default function CheckoutPage() {
  useLocation(); // subscribe to route changes
  const plan = parsePlan(typeof window !== "undefined" ? window.location.search : "");
  const copy = PLAN_COPY[plan];

  const [phase, setPhase] = useState<"loading" | "embedded" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const mountRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<{ destroy: () => void } | null>(null);
  const startedRef = useRef(false);

  const embedded = trpc.stripe.publicCreateEmbeddedCheckoutSession.useMutation();
  const utils = trpc.useUtils();

  const start = useCallback(async () => {
    const origin = window.location.origin;
    try {
      setPhase("loading");
      console.log(`[Checkout] [INPUT] plan=${plan} buildTimeKey=${PUBLISHABLE_KEY ? "present" : "absent"}`);
      // Key resolution: build-time env first, runtime config endpoint second.
      // NEVER a hosted redirect — embedded checkout is the only path.
      let publishableKey = PUBLISHABLE_KEY;
      if (!publishableKey) {
        const config = await utils.stripe.publicGetConfig.fetch();
        publishableKey = config.publishableKey;
        console.log(`[Checkout] [STEP] runtime key fetch → ${publishableKey ? "present" : "ABSENT"}`);
      }
      if (!publishableKey) {
        throw new Error("Payments are temporarily unavailable (configuration). Please try again shortly.");
      }
      const [{ loadStripe }, session] = await Promise.all([
        import("@stripe/stripe-js"),
        embedded.mutateAsync({ planId: plan, origin }),
      ]);
      const stripe = await loadStripe(publishableKey);
      if (!stripe) throw new Error("Stripe.js failed to load");
      const checkout = await stripe.createEmbeddedCheckoutPage({ clientSecret: session.clientSecret });
      checkoutRef.current = checkout;
      if (mountRef.current) {
        checkout.mount(mountRef.current);
        setPhase("embedded");
        console.log("[Checkout] [VERIFY] PASS — embedded checkout mounted on-domain");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not start checkout.");
      setPhase("error");
      console.error(`[Checkout] [VERIFY] FAIL — ${err instanceof Error ? err.message : err}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
    return () => {
      checkoutRef.current?.destroy();
      checkoutRef.current = null;
    };
  }, [start]);

  return (
    <div className="dlv2" style={{ minHeight: "100vh" }}>
      <nav className="nav" aria-label="Checkout">
        <div className="wrap nav-inner">
          <Link href="/" aria-label="dime home" style={{ textDecoration: "none" }}>
            <Wordmark />
          </Link>
          <span className="mono" style={{ marginLeft: "auto" }}>Secure checkout · Stripe</span>
        </div>
      </nav>

      <div className="checkout-wrap">
        {/* Plan summary rail */}
        <aside className="checkout-summary" aria-label="Plan summary">
          <span className="mono mono--mint">Your plan</span>
          <h2>{copy.name}</h2>
          <div className="rowline">
            <span>Price</span>
            <span className="lead" aria-hidden="true" />
            <b>{copy.price} {copy.period}</b>
          </div>
          <div className="rowline">
            <span>Works out to</span>
            <span className="lead" aria-hidden="true" />
            <b>{copy.perDay}</b>
          </div>
          <div className="rowline">
            <span>Cancellation</span>
            <span className="lead" aria-hidden="true" />
            <b>Anytime, 2 clicks</b>
          </div>
          <span className="fine">{copy.renewal}</span>
          <span className="fine">
            By subscribing you agree to the <Link href="/terms" style={{ color: "var(--text-secondary)" }}>Terms</Link> and{" "}
            <Link href="/privacy" style={{ color: "var(--text-secondary)" }}>Privacy Policy</Link>.
          </span>
          <span className="fine">
            dime is analytical software — statistical model projections, no guaranteed outcomes. 21+ (or legal betting age
            in your jurisdiction). Bet responsibly. Gambling problem? Call 1-800-GAMBLER.
          </span>
          <Link
            href="/"
            className="mono"
            style={{ color: "var(--text-muted)", textDecoration: "none" }}
            data-cta-id="checkout-back"
            data-cta-location="checkout"
            data-plan={plan}
            data-mode="paid"
          >
            ← Back to pricing
          </Link>
        </aside>

        {/* Stripe-controlled payment area */}
        <div>
          {phase === "embedded" || phase === "loading" ? (
            <div style={{ position: "relative" }}>
              {phase === "loading" && (
                <div className="checkout-status" role="status" aria-live="polite">
                  <span className="pulse" aria-hidden="true" />
                  <span>Preparing secure checkout…</span>
                </div>
              )}
              <div ref={mountRef} className="checkout-mount" style={phase === "loading" ? { display: "none" } : undefined} />
            </div>
          ) : (
            <div className="checkout-status" role="alert">
              <span>Checkout couldn't start: {errorMsg}</span>
              <button
                type="button"
                className="btn btn--mint"
                onClick={() => { startedRef.current = false; setErrorMsg(""); void start(); }}
                data-cta-id="checkout-retry"
                data-cta-location="checkout"
                data-plan={plan}
                data-mode="paid"
              >
                Try again
              </button>
              <Link href="/" className="mono" style={{ color: "var(--text-muted)" }}>
                ← Back to pricing
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
