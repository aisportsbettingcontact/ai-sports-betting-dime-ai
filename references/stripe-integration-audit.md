# Stripe integration audit — vs Payment Element / Checkout best practices (2026-07-10)

Audited against Stripe's Payment Element integration best practices,
Express Checkout Element / Payment Request Button deprecation notes,
Payment Method Messaging (BNPL) docs, and Confirmation Tokens migration.
Account: Tailered Sports, Inc. (`acct_1SKTfGPa3TFEAkkY`).

## Verdict: the integration already follows the recommended architecture

| Checklist item | Status |
|---|---|
| Use **Checkout Sessions API** (not Payment Intents) | ✅ `stripe.checkout.sessions.create`, `ui_mode: "embedded_page"`, `mode: "subscription"` — embedded, on-domain, no redirect (owner directive) |
| No `payment_method_types` → dynamic payment methods | ✅ Omitted everywhere; methods come from Dashboard settings |
| Searchable `metadata` | ✅ `user_id`, `plan_id`, `desired_username` on every session |
| Latest API version | ✅ Pinned `2026-04-22.dahlia` — exactly what installed stripe-node 22.1.1 targets. Do NOT bump the string without bumping the SDK. |
| Deprecated Payment Request Button | ✅ Not used anywhere |
| Legacy Card Element | ✅ Not used anywhere |
| Confirmation Tokens migration | ✅ N/A — that migration applies to Payment Intents integrations only |
| Express Checkout Element | ✅ N/A as a separate component — Embedded Checkout renders Apple Pay / Google Pay / Link automatically when eligible |
| Webhook signature verification | ✅ `express.raw()` mounted before JSON parser; HMAC verified in `server/stripeWebhook.ts` |
| CSP for Stripe.js + checkout iframe | ✅ helmet allows `js.stripe.com`, `*.js.stripe.com`, `checkout.stripe.com`, `hooks.stripe.com` — guarded by smoke check 8 |

## Deliberately NOT added: Payment Method Messaging Element (BNPL)

The docs recommend promoting Affirm/Afterpay/Klarna ahead of checkout — but
our sessions are `mode: "subscription"`, and the live embedded form for
these sessions offers **Card only** (verified 2026-07-10 via a live-session
render). Mounting BNPL messaging on the pricing/checkout pages would
advertise installment plans the checkout cannot fulfill — a conversion and
compliance own-goal. Revisit only after BNPL-compatible billing is enabled
and the embedded form actually shows those methods.

## Dashboard follow-ups (owner actions, not code)

1. **Payment methods**: to offer wallets/Link (or BNPL where subscription-
   compatible), enable them at dashboard.stripe.com/settings/payment_methods —
   the embedded form picks them up with zero code changes.
2. **Apple Pay domain registration**: wallets in Embedded Checkout require
   registering the serving domains (Railway domain now; the app domain at
   cutover) under Settings → Payment method domains.
3. **One real transaction** end-to-end (charge → webhook → fulfillment) —
   keys are live-mode, so the agent verification stopped short of submitting
   a payment.
