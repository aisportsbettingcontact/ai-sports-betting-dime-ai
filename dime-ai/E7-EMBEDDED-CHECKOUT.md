# E7 — On-site Stripe checkout: options and migration plan

**Decision:** move subscription checkout on-site with **Embedded Checkout**
(Checkout Session `ui_mode: 'embedded'`). Status: proposed. Scope: checkout stage only.
Governing guidance: `.agents/skills/stripe-best-practices/SKILL.md` + `references/payments.md`,
`references/billing.md`, `references/security.md`.

---

## 1. Current integration (evidence)

| Piece | Where | Notes |
|---|---|---|
| Session builder | `server/routers/stripe.ts:58` (`buildStripeCheckoutSession`) | `mode: "subscription"` (:112), `line_items` from price ID (:113), `allow_promotion_codes: true` (:159), `success_url` → `/subscribe/success?session_id={CHECKOUT_SESSION_ID}&plan=` (:86), `cancel_url` → `/#pricing` (:87), returns `{ sessionId, url }` (:185) |
| Username capture | `server/routers/stripe.ts:131-143` | Required `custom_fields` text input `desired_username` (3–64 chars), duplicated into `metadata.desired_username` (:126) |
| Fulfillment metadata | `server/routers/stripe.ts:122-127, 147-157` | `client_reference_id` + `metadata.user_id` + `metadata.plan_id` on session and `subscription_data.metadata` |
| Public endpoint | `server/routers/stripe.ts:204` (`publicCreateCheckoutSession`) | Unauthenticated, on `stripeProcedure` (`server/_core/trpc.ts:519`, CSRF-exempt) |
| Authed endpoint | `server/routers/stripe.ts:234` (`createCheckoutSession`) | On `stripeAppUserProcedure`, which **rejects `hasAccess === false`** (`server/routers/appUsers.ts:275-278`; middleware defined :253) — so it only serves already-subscribed users. Only `client/src/pages/dime/DimeLanding.tsx:126-128` explicitly branches on `appUser?.hasAccess`; `PricingCTA.tsx:132` branches on `appUser` truthiness alone, which is safe only because sessions with `hasAccess=false` cannot exist — the `appUserProcedure` gate (`server/routers/appUsers.ts:225-227`) plus the login-time gates (:136, :181, :407) guarantee it. Rely on that invariant, not on PricingCTA's branch, when reasoning about this trap |
| Payment methods | `server/routers/stripe.ts:119` | `payment_method_collection: "if_required"` on the session builder |
| Plans | `server/stripe/products.ts:36-63` | monthly 9999¢ / annual 49999¢; price IDs from `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` env with **hardcoded live-price fallbacks** (:45, :58) |
| Webhook | `server/stripeWebhook.ts:355-396` | Raw-body + `constructEvent` signature verification (:375) per security.md. `checkout.session.completed` (:208) drives entitlement: existing user via `client_reference_id`/`metadata.user_id` → `grantUserAccess` (:233); anonymous → `createPendingUserFromCheckout` (:247) reading email from `customer_details` and username from `session.custom_fields` (:241-244). Renewals via `invoice.paid` (:305); revoke via `customer.subscription.deleted` (:295) |
| Post-pay account setup | `server/routers/stripe.ts:339` (`getCheckoutSessionUser`), `:374` (`completeAccountSetup`) | Keyed on `pendingStripeSessionId` = Checkout Session id |
| Clients | `client/src/pages/landing/components/PricingCTA.tsx:96-119, 122-141` and `client/src/pages/dime/DimeLanding.tsx:119-131` | Both call the tRPC mutation then `window.location.replace(data.url)` — full redirect to Stripe-hosted page |
| Keys | `server/stripe/client.ts:23` (`STRIPE_SECRET_KEY` env only), webhook secret `server/stripeWebhook.ts:362` | No publishable key exists in the client bundle today; no `@stripe/stripe-js` / `@stripe/react-stripe-js` in `package.json` (server `stripe: ^22.1.1` only) |

Already skill-compliant: no `payment_method_types` anywhere (SKILL.md "Critical rules";
payments.md "Dynamic payment methods"), webhook signatures verified (security.md "Webhook
security"), secret key from env, never client-side (security.md "API keys").

---

## 2. Options

Skill baseline (payments.md "Integration surfaces"): prefer, in order, Payment Links →
**Checkout (hosted or embedded)** → Payment Element; billing.md: "Combine Billing APIs with
Stripe Checkout … `mode: 'subscription'` handles the initial payment, trial management, and
proration automatically."

### (a) Status quo — hosted Checkout redirect
- **UX:** full-page redirect to `checkout.stripe.com`; brand break, but battle-tested conversion.
- **PCI:** SAQ A (card fields never touch our origin).
- **Changes:** none.
- **Username/webhook flow:** unchanged.
- **Promo codes/tax:** `allow_promotion_codes` works; Stripe Tax one flag away.
- **Effort:** zero. Fails the stated goal (whitelabel, no off-site hop).

### (b) Embedded Checkout — `ui_mode: 'embedded'` ★ recommended
Same Checkout Session object rendered as a Stripe-managed iframe inside our page
(`@stripe/react-stripe-js` `<EmbeddedCheckout>`). Second rung of the skill's preference ladder —
still "Checkout", just embedded.
- **UX:** customer stays on our domain; page shell, nav, responsible-gaming footer are ours.
  Inner form styling is Stripe's (limited theming).
- **PCI:** SAQ A — card inputs remain in Stripe-hosted iframes.
- **Server changes:** one builder gains `ui_mode: 'embedded'` + `return_url` (replaces
  `success_url`/`cancel_url`, which are invalid in embedded mode) and returns
  `session.client_secret` instead of `session.url`. Everything else identical.
- **Username capture:** `custom_fields` **is supported in embedded Checkout** — the
  "Desired Username" field renders inside the iframe; webhook reads `session.custom_fields`
  exactly as today (`server/stripeWebhook.ts:241-244`). Zero webhook changes.
- **Entitlement flow:** still `checkout.session.completed` with the same session id, metadata,
  `client_reference_id`; `pendingStripeSessionId` linkage and `/subscribe/success` page survive
  via `return_url` containing `{CHECKOUT_SESSION_ID}`.
- **Promo codes:** `allow_promotion_codes` supported. **Tax:** `automatic_tax` supported.
- **Effort class:** **Small** (≈1 dev-day + test pass). One server param, one client page,
  two call-site edits.

### (c) Payment Element + Subscriptions API — fully custom
Build our own form: create Customer + Subscription (`payment_behavior:
'default_incomplete'`) or a `ui_mode: 'custom'` Checkout Session, mount `<PaymentElement>`,
confirm client-side.
- **UX:** maximal — fully Dime-branded fields, one-page flow, total layout control.
- **PCI:** still SAQ A (Elements iframes), but we own the payment page: error states, 3DS/SCA
  redirect handling, Link, wallets, per-method quirks.
- **Changes:** new server endpoints (create/confirm), rebuild in React: email + username inputs
  (Stripe no longer renders `custom_fields` — we must pass username via metadata ourselves),
  promo-code input + `Promotion Codes API` lookup, price summary, tax display
  (`automatic_tax` needs Checkout/Invoice preview plumbing), incomplete-subscription cleanup.
- **Webhook:** `checkout.session.completed` never fires in the raw-Subscriptions variant — the
  entire new-user fulfillment path (`server/stripeWebhook.ts:208-264`) must be re-keyed to
  `invoice.paid`/`payment_intent.succeeded` + subscription metadata. High-risk rewrite of
  revenue-critical code. billing.md warns against hand-rolling what Billing+Checkout automates.
- **Effort class:** **Large** (1–2 weeks + hardening), for styling gains only.

---

## 3. Recommendation

**Option (b), Embedded Checkout.** Rationale for Dime specifically:

1. **Whitelabel goal met at the right cost** — checkout happens on our domain inside the Dime
   shell; only the payment widget itself is visibly Stripe (which also reads as trust on a
   sports-betting product).
2. **Revenue is live and the operator is solo** — the webhook fulfillment machine
   (pending-user creation, Discord roles, expiry math) keeps firing on the *same events with
   the same payloads*. Option (c) rewrites that machine; a fulfillment bug directly costs money.
3. **Skill alignment** — payments.md ranks Checkout (hosted **or embedded**) above Payment
   Element; billing.md explicitly pairs Billing with Checkout Sessions for subscriptions.
4. Option (c) remains a later upgrade path; nothing in (b) forecloses it.

**Key trade-off accepted:** the form inside the iframe stays Stripe-styled (no Familjen
Grotesk/mint inside the widget). We control everything around it, not the inputs themselves.

---

## 4. Migration plan (Embedded Checkout)

### Server — `server/routers/stripe.ts`
1. Extend `BuildSessionParams` (:45) with `uiMode?: 'hosted' | 'embedded'` (default `'hosted'`
   → instant rollback path).
2. In `buildStripeCheckoutSession` (:58), when embedded: set `ui_mode: 'embedded'`,
   `return_url: `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}&plan=${planId}``,
   omit `success_url`/`cancel_url` (:86-87, :160-161); keep `mode`, `line_items`, metadata,
   `custom_fields`, `subscription_data`, `allow_promotion_codes` untouched. Continue to omit
   `payment_method_types` (SKILL.md critical rule).
3. Return `{ sessionId, url, clientSecret: session.client_secret }`; relax the `:174` URL guard
   to only require `url` when hosted / `client_secret` when embedded.
4. Accept `uiMode` in the zod input of `publicCreateCheckoutSession` (:204) and
   `createCheckoutSession` (:234). No auth changes: anonymous and logged-in-unsubscribed users
   keep using the public endpoint (the `hasAccess` gate at `server/routers/appUsers.ts:275`
   stays as-is; do **not** route new buyers through `createCheckoutSession`).

### Client
5. `npm i @stripe/stripe-js @stripe/react-stripe-js`.
6. New `client/src/pages/CheckoutEmbedded.tsx` (route `/checkout?plan=monthly|annual`):
   `loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)` once at module scope;
   `<EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>` where
   `fetchClientSecret` calls one of the **two** existing tRPC mutations with `uiMode: 'embedded'`
   — the `/checkout` page must replicate DimeLanding's `hasAccess` branch: the public
   `publicCreateCheckoutSession` for everyone (anonymous *and* logged-in-without-access),
   the authed `createCheckoutSession` only for `appUser?.hasAccess` subscribers; render
   `<EmbeddedCheckout />` inside the Dime shell (brand law: chrome only, per MASTER.md).
7. `PricingCTA.tsx` (:97-119) and `DimeLanding.tsx` (:113-131): replace
   `window.location.replace(data.url)` with SPA navigation to `/checkout?plan=…`.
8. `/subscribe/success` (`getCheckoutSessionUser` / `completeAccountSetup`,
   `server/routers/stripe.ts:339, :374`) is reached via `return_url` — no changes.

### Keys & env (security.md)
9. Add `VITE_STRIPE_PUBLISHABLE_KEY` (`pk_…`) — publishable keys are safe in the client bundle;
   the secret stays server-only (`server/stripe/client.ts:23`). Never expose `sk_`/`rk_` or the
   webhook secret client-side; separate test/live values per environment. Set the new var in
   production before deploying — Railway auto-deploys `main` (see `references/railway-deploy.md`).
10. Opportunistic hardening per security.md: replace `STRIPE_SECRET_KEY` with a **restricted
    key** (`rk_`) scoped to Checkout Sessions, Subscriptions, Billing Portal, Customers, and
    webhook verification; remove the hardcoded live price-ID fallbacks at
    `server/stripe/products.ts:45, :58` (env-only, fail loudly).
11. Webhook: endpoint, secret, and signature verification (`server/stripeWebhook.ts:375`)
    unchanged. If the app sets CSP headers, allow `https://js.stripe.com` (script/frame) and
    `https://api.stripe.com` (connect).

### Test plan (Stripe test mode)
- Test keys (`sk_test_`/`pk_test_` or sandbox via `stripe sandbox create`), test price IDs in
  `STRIPE_PRICE_*`; `stripe listen --forward-to localhost:<port>/api/stripe/webhook` with the
  CLI webhook secret.
- Cases: (1) anonymous monthly + card `4242 4242 4242 4242` → iframe shows email + "Desired
  Username" → webhook creates pending user → return_url → `completeAccountSetup` → login works;
  (2) annual w/ promotion code applied inside embedded form → correct discounted amount in
  Dashboard; (3) 3DS challenge card `4000 0027 6000 3184`; (4) declined card `4000 0000 0000
  0002` stays in-page with inline error; (5) logged-in subscriber portal/cancel/reactivate paths
  unaffected; (6) hosted fallback (`uiMode` omitted) still returns a redirect URL.
- `npx tsc --noEmit` passes (repo convention); manual smoke on mobile viewport (iframe height).

---

## 5. Risks & rollback

| Risk | Mitigation |
|---|---|
| Embedded form conversion differs from hosted | Both paths live behind `uiMode`; compare Dashboard conversion before deleting hosted |
| CSP / ad-blockers blocking `js.stripe.com` iframe | Test with common blockers; keep hosted fallback CTA on load failure |
| `return_url` mistakes strand paying users | Webhook — not the redirect — is the source of truth for entitlement (already true today); `getCheckoutSessionUser` recovers by session id |
| Env var missing in production (`VITE_STRIPE_PUBLISHABLE_KEY`) | Build-time assert + deploy checklist line (`references/railway-deploy.md`) |
| Iframe styling clashes with Dime dark theme | Checkout appearance settings in Dashboard (branding colors/logo); accept limits per §3 trade-off |

**Rollback:** flip clients back to hosted (`uiMode` omitted → redirect behavior identical to
today). No webhook, schema, or Stripe Dashboard changes to unwind. Single revertable PR.

## 6. Out of scope

- Pricing/plan changes, trials, usage-based billing (would route to Metronome per billing.md).
- Embedding the Customer Portal (stays hosted — billing.md recommends the hosted Portal).
- Enabling `automatic_tax` / Stripe Tax registrations (separate decision; supported by (b)).
- Option (c) full Payment Element rebuild; revisit only if embedded theming proves insufficient.
- Auth-flow refactor of the `hasAccess` gate at `server/routers/appUsers.ts:275`.
