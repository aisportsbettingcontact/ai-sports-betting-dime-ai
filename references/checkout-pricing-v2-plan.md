# Checkout + Pricing v2 — brainstorm & implementation plan (2026-07-10)

Source of truth: `dime-ai checkout blueprint v1.1` (uploaded), §4.2 (plans), §4.4 (Stripe
pattern mapping), §6.3/§9.1 (env price map, SEC-006), §9.5/9.6 (status machine/webhooks),
§9.9 (pricing-table verdict: custom UI, not the embed), §10 (brand tokens).
Brand law: `design-system/dime-ai/MASTER.md`. Non-negotiable: Stripe never redirects
off-domain; checkout is embedded on `/checkout`.

## Problem (brainstormed, converged)

1. The current `/checkout` uses Checkout Sessions `ui_mode: "embedded_page"` — an iframe
   that renders Stripe's default light theme (white card, Stripe fonts) inside the dark
   Dime rail. `embedded_page` does NOT support the Appearance API; its styling comes only
   from Dashboard branding. "Maximized Dime-branded checkout" is impossible in that mode.
2. The live pricing (Pro $99.99/mo, Elite $499.99/yr) predates the blueprint. Blueprint
   §4.2 defines the go-forward ladder: Free Preview $0 · Pro $99/mo · Sharp $249/mo ·
   Operator $499/mo (+ add-on credit packs $39/$99/$299 one-time).

## Decisions (locked)

- **D1 — ui_mode pivot:** Checkout Sessions stay the API (best practice + webhooks
  unchanged: fulfillment remains `checkout.session.completed`/`invoice.paid`), but
  sessions move to the **elements/custom ui_mode** consumed by
  `stripe.initCheckoutElementsSdk` + a Payment Element themed via the **Appearance API**
  (Familjen Grotesk via fonts cssSrc, mint #45E0A8 accent, ink #0B0B0F surfaces, IBM
  Plex Mono for money, 160ms). We own every pixel outside the secure inputs.
- **D2 — pricing structure (blueprint §4.2 verbatim):** landing pricing grid becomes
  Free Preview $0 / **Pro $99/mo (featured)** / Sharp $249/mo / Operator $499/mo.
  Founder stays where it already lives (ControlledAccess application section), out of
  the grid. Annual "Elite" $499.99 stops being marketed but its Stripe price stays live
  (price immutability; existing subscribers unaffected; `/checkout?plan=annual` keeps
  working).
- **D3 — add-on credit packs: DEFERRED.** They grant credits via webhook; no credit
  ledger exists yet (blueprint Phase 3). Selling them now takes money for nothing
  deliverable. Ship subscriptions only.
- **D4 — Stripe objects:** create 3 new Products (marketing_features populated) + 3
  monthly Prices at $99/$249/$499. Create-only; archive/modify nothing. IDs go to env:
  `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_SHARP_MONTHLY`,
  `STRIPE_PRICE_OPERATOR_MONTHLY` — no hardcoded fallbacks (SEC-006).
- **D5 — plan IDs:** client/server planId enum extends to `pro | sharp | operator`;
  legacy `monthly | annual` remain valid (map to existing prices). Webhook plan
  resolution goes through one env-driven price→plan map.
- **D6 — custom fields:** `custom_fields` (Desired Username) is not allowed in the
  custom/elements ui_mode. The username field becomes OUR form field on /checkout,
  captured before payment and attached to the session (metadata via server update or
  session created after the identity step — research task R3 picks the mechanism).
- **D7 — no `<stripe-pricing-table>`** (blueprint §9.9 verdict: custom UI in-app).

## Work packages

- **R (research, read-only):** exact request-side `ui_mode` value + params compatible
  with `mode: "subscription"`; `initCheckoutElementsSdk` full options/typings from the
  installed `@stripe/stripe-js` d.ts; Appearance API variables + custom fonts; how
  email/billing fields work in elements mode (`checkout.updateEmail` etc.); metadata
  attach mechanism for username (D6); confirm webhooks unchanged. Every claim cited to
  installed d.ts lines or Stripe MCP docs.
- **D (design spec, read-only):** /checkout redesign (two-column: plan rail + branded
  form; mobile stack) + pricing grid restructure for 4 blueprint tiers; exact Appearance
  API variable→Dime token mapping; all states (loading/error/insufficient/succeeded);
  conversion details (per-day framing, trust/RG copy per §15). Strictly MASTER.md —
  no non-Dime colors/fonts/gradients.
- **I (implementation, worktree):** server (env price map, plan enum, session creation
  for elements mode, webhook plan map), client (CheckoutPage rebuild per R+D, landing
  TIERS restructure), tests where cheap. tsc + build + prerender tests green.
- **S (Stripe ops, main session):** create products/prices via Stripe MCP (live,
  create-only), set Railway env vars, redeploy.
- **V (verify, live):** session per tier through the Railway origin (clientSecret-only, no
  hosted URL), themed form pixels via curl-bridge Playwright, smoke 8/8 on the Railway origin.

## Acceptance

1. /checkout renders the payment form in Dime tokens (dark surfaces, Familjen labels,
   mint accent, Plex Mono amounts) — screenshot evidence, no Stripe-default white card.
2. No `checkout.stripe.com` redirect anywhere; sessions return clientSecret only.
3. Landing pricing = blueprint §4.2 tiers; every CTA deep-links `/checkout?plan=<id>`.
4. New plans purchasable end-to-end up to (not including) payment submission; legacy
   monthly/annual unaffected; webhook resolves all five price IDs to plans.
5. tsc, build, prerender tests, smoke 8/8 (Railway origin after deploy).
6. RG language (21+, 1-800-GAMBLER) on checkout at legible contrast.
