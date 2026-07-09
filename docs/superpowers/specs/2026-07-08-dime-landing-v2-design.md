# Dime AI Landing v2 — design + build spec (2026-07-08)

**Route:** `/` — the root landing page (route swap executed 2026-07-09; `/landingpage-v2` now redirects to `/`, v1 remains at `/landingpage` as a comparison hook, and the bot prerender + index.html shell/SEO block carry v2 parity).
**Positioning:** Sports betting intelligence software — decision advantage, never "AI picks".
**Core promise:** See where price and probability disagree. Every market resolves to **Pass / Monitor / Edge Detected**.

## Structure (client/src/pages/dime/)

- `landing/DimeLandingV2.tsx` — page shell (16 sections)
- `landing/landing-content.ts` — ALL copy/demo data/pricing/CTA metadata + `LANDING_MODE: "waitlist" | "paid"` (currently `"paid"`)
- `landing/landing-v2.css` — token system scoped `.dlv2` (brand law: mint #45E0A8 only, Familjen Grotesk + IBM Plex Mono, 160ms, reduced-motion kill)
- `landing/components/` — Nav, Hero (+ MarketConsole + stats strip), ChatDemo, ProblemSection, Mechanism, MarketSignals, FeatureGrid, TrustArchitecture, Pricing, ControlledAccess, ObjectionHandling, FAQSection, FinalCTA, FooterSection, StickyCta, shared
- `CheckoutPage.tsx` — `/checkout?plan=monthly|annual`

## Signature objects

- **Dime Market Console** (hero): framed console, market tabs (one per state), scan-progress rail, animated probability comparison, movement timeline, risk pills, replay, credit meter, locked Elite/Max insight rows. All demo data uses abstract teams and a visible `Demo — sample markets` tag.
- **Dime Chat demo:** 5 scripted prompt chips → restrained answers + classification cards. Real chat lives at `/chat`.

## Money mapping (no placeholder CTAs — hard rule)

| Tier | Reality |
|---|---|
| Free Preview | On-page demos (`#console`) |
| Pro $99.99/mo | Real Stripe `planId: "monthly"` → `/checkout?plan=monthly` |
| Elite $499.99/yr | Real Stripe `planId: "annual"` → `/checkout?plan=annual` |
| Founder | Application via real `trpc.waitlist.submit` (`utmSource: "landing-v2-founder"`) |
| Dime Credits | Demo usage mechanics + explainer only — no SKU exists yet |

## Checkout

- Server: `stripe.publicCreateEmbeddedCheckoutSession` (`ui_mode: "embedded_page"`, returns `clientSecret`; same rate limiter as hosted variant).
- Client: Stripe Embedded Checkout via `@stripe/stripe-js` (`createEmbeddedCheckoutPage`) when `VITE_STRIPE_PUBLISHABLE_KEY` is present at build time; otherwise transparent fallback to the existing hosted redirect. Success returns to `/subscribe/success` (existing fulfillment).

## Compliance (locked)

Honesty law: no fabricated records/testimonials/win rates, no guarantees, PASS first-class; whitelisted claims only. RG block (21+, 1-800-GAMBLER) in footer + near checkout. No #39FF14 (brand law forbids neon green — overrides the build prompt's allowance).

## CTA tracking

Every CTA carries `data-cta-id`, `data-cta-location`, `data-mode`, and `data-plan` where applicable (19 tracked CTAs on the page).
