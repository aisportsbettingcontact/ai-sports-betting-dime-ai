/**
 * server/stripe/client.ts
 *
 * Singleton Stripe SDK client.
 * Credentials are injected from the platform environment — never hardcoded.
 * API version is pinned to match the installed stripe npm package.
 */

import Stripe from "stripe";

const TAG = "[Stripe][Client]";

let _stripe: Stripe | null = null;

/**
 * Returns the singleton Stripe instance.
 * Throws immediately if STRIPE_SECRET_KEY is not set so misconfiguration
 * surfaces at call-time rather than silently producing undefined behaviour.
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;

  // ── [INPUT] Validate secret key presence ────────────────────────────────────
  if (!secretKey) {
    console.error(`${TAG} [INPUT] STRIPE_SECRET_KEY is not set in environment`);
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  const keyMode = secretKey.startsWith("sk_live_")
    ? "LIVE"
    : secretKey.startsWith("sk_test_")
    ? "TEST"
    : "UNKNOWN";

  console.log(`${TAG} [STEP] Initialising Stripe SDK`);
  console.log(`${TAG}   key_mode=${keyMode}`);
  console.log(`${TAG}   api_version=2026-04-22.dahlia`);

  _stripe = new Stripe(secretKey, {
    // Must match the version in the installed stripe npm package
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiVersion: "2026-04-22.dahlia" as any,
    typescript: true,
  });

  console.log(`${TAG} [OUTPUT] Stripe SDK initialised ✓ mode=${keyMode}`);
  return _stripe;
}
