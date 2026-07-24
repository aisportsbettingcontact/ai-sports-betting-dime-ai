# Admin-Managed Stripe Subscription Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner create/edit/archive subscription plans from the admin dashboard — each plan provisions real Stripe Products/Prices/Coupons via the API and drives the existing embedded-checkout + webhook + `app_users` entitlement model, replacing today's hardcoded plan catalog.

**Architecture:** Migrate the static `PLANS` record (`server/stripe/products.ts`) to two DB tables (`subscription_plans`, `plan_prices`). A thin owner-only provisioning service calls `stripe.products/prices/coupons.create`, persists the returned `prod_`/`price_` IDs, and the existing checkout + webhook read the price→plan mapping from the DB instead of code. Entitlement stays exactly as it is today (binary access via `app_users` columns); a "plan" remains a pricing tier, not a feature gate.

**Tech Stack:** TypeScript (strict), Drizzle ORM + MySQL, tRPC (`ownerProcedure`), Stripe Node SDK 22.1.1 (API `2026-04-22.dahlia`), React + Vite + Tailwind (Dime brand tokens), Vitest.

## Global Constraints

- **TypeScript strict**; `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` must pass. No `any`.
- **Stripe API version stays `2026-04-22.dahlia`** — it matches installed `stripe` 22.1.1. Do NOT bump the string without bumping the SDK (`references/stripe-integration-audit.md`).
- **Never pass `payment_method_types`** in any Stripe call (dynamic payment methods). Never include `discounts` + `allow_promotion_codes` together on one session.
- **Verify webhook signatures** — the existing `express.raw()` + `stripe.webhooks.constructEvent` path in `server/stripeWebhook.ts` is unchanged.
- **Keys server-side only**, via Railway env. Prefer a **restricted API key (`rk_`)** scoped to Products/Prices/Coupons write + Checkout/Subscriptions for the provisioning service. Never in client code, never logged.
- **Prices are immutable in Stripe** — "editing" an amount/interval = archive old Price (`prices.update {active:false}`) + create new Price. Existing subscribers stay on their original price.
- **Embedded checkout only**, no off-domain redirect (owner directive; `checkout-pricing-v2-plan.md` D1/§9.9). Sessions return `client_secret`.
- **Owner-gated** admin mutations use `ownerProcedure` (`server/routers/appUsers.ts:108`). Only `@prez` reaches the admin dashboard.
- **Schema changes require the manual `db-push.yml` workflow BEFORE any code deploy** (CLAUDE.md Deploy law).
- **Dime brand law** for all UI: `design-system/dime-ai/MASTER.md` — mint `#45E0A8` (`#0FA36B` text on light), Familjen Grotesk + IBM Plex Mono, 160ms motion, no gradients. Semantic Tailwind tokens.
- **Responsible-gaming language** (21+, 1-800-GAMBLER) stays on any customer-facing pricing/checkout copy.
- **Backfill is mandatory, not optional:** the 5 existing plans (`monthly`, `annual`, `pro`, `sharp`, `operator`) must be adopted into the DB with their current Stripe price IDs so live subscribers and `/checkout?plan=<id>` keep working.
- **Dev in Stripe TEST mode.** The repo's keys are LIVE (`client.ts:31`). Do all provisioning development against a TEST-mode key; only touch live objects in the final ops step. See Risk R1.

---

## File Structure

**New files**
- `drizzle/schema.ts` (modify) — add `subscriptionPlans` + `planPrices` tables; widen `app_users.stripePlanId`.
- `server/stripe/planStore.ts` — DB read layer + cache: `getPlanBySlug`, `getPriceById` (reverse map), `listActivePlans`, `computeExpiryMsForPrice`, `invalidatePlanCache`.
- `server/stripe/planProvisioning.ts` — Stripe write layer: `provisionPlan`, `addPriceToPlan`, `archivePrice`, `archivePlan`, `updatePlanMeta`, `createPromoCode`.
- `server/routers/subscriptionPlans.ts` — owner tRPC router (list/create/update/addPrice/archive/promo).
- `server/stripe/backfillPlans.ts` — one-shot idempotent seed importing the 5 static plans.
- `client/src/pages/admin/SubscriptionPlans.tsx` — admin list + create/edit UI (Dime-branded).
- `client/src/pages/admin/planForm/` — form pieces (`PlanForm.tsx`, `PriceVariantRow.tsx`, `IntervalPicker.tsx`).
- Tests: `server/stripe/planStore.test.ts`, `server/stripe/planProvisioning.test.ts`, `server/stripe/backfillPlans.test.ts`, `client/src/pages/admin/planForm/intervalPicker.test.ts`.

**Modified files**
- `server/stripe/products.ts` — delegate `getPlanByPriceId`/`normalizePlanId`/`computeExpiryMs` to `planStore`, keeping env fallback for the legacy two during cutover; eventually reduce to types + fallback.
- `server/routers/stripe.ts` — `zodPlanId` becomes a runtime DB check (`stripe.ts:48`); checkout builders resolve price from `planStore` (`stripe.ts:161`, `:296`); add quantity guard.
- `server/stripeWebhook.ts` — `getPlanByPriceId` call (`:241`) reads DB; expiry from `computeExpiryMsForPrice`.
- `server/_core/env.ts` — register the provisioning RAK var if separate; document new vars.
- `server/routers.ts` — mount `subscriptionPlans` router (`:171` neighborhood).
- `client/src/pages/admin/adminNav.ts` — add "Subscription Plans" nav entry (`:62-82`).
- `client/src/App.tsx` — lazy route for `SubscriptionPlans`.
- `client/src/pages/dime/landing/components/Pricing.tsx` — (Phase 2) render tiers from the DB via a public query instead of hardcoded copy.

---

## Phase 0 — DB-backed catalog + backfill (no behavior change)

**Outcome:** the 5 existing plans live in the DB and resolve identically to today; checkout/webhook still use the static path. Nothing user-visible changes. This de-risks everything after it.

### Task 0.1: Schema — `subscription_plans` + `plan_prices`, widen `stripePlanId`

**Files:**
- Modify: `drizzle/schema.ts` (append tables near the other Stripe columns ~`:94-109`)
- Test: `server/stripe/planStore.test.ts`

**Interfaces:**
- Produces tables consumed by every later task:
```ts
// subscription_plans
{ id:int pk auto, slug:varchar(64) unique notnull, name:varchar(120) notnull,
  description:text|null, planType:enum('recurring','one_time','fixed_date') default 'recurring',
  stripeProductId:varchar(64)|null, active:boolean default true, archivedAt:bigint|null,
  accessUntil:bigint|null,          // fixed_date only
  maxSubscribers:int|null,          // limited quantity; null=unlimited
  discordRoleId:varchar(32)|null, telegramChatId:varchar(64)|null,
  sortOrder:int default 0, createdAt:bigint notnull, updatedAt:bigint notnull }
// plan_prices
{ id:int pk auto, planId:int notnull, stripePriceId:varchar(64) notnull,
  label:varchar(80)|null, amountCents:int notnull, currency:varchar(8) default 'usd',
  interval:enum('day','week','month','year')|null, intervalCount:int|null,
  trialPeriodDays:int|null, active:boolean default true, isDefault:boolean default false,
  createdAt:bigint notnull }
```

- [ ] **Step 1:** Write `subscriptionPlans` and `planPrices` in `drizzle/schema.ts` mirroring the existing `mysqlTable` style (bigint ms timestamps like `expiryDate` at `schema.ts:52`). Change `stripePlanId` `varchar("stripe_plan_id",{length:16})` → `{length:64}` (`schema.ts:103`).
- [ ] **Step 2:** Add a Drizzle relation-free index on `planPrices.stripePriceId` and `subscriptionPlans.slug` (both looked up hot-path in the webhook).
- [ ] **Step 3:** Run `npx tsc --noEmit` — expect PASS (types only, no query yet).
- [ ] **Step 4:** Commit `feat(db): subscription_plans + plan_prices tables (catalog schema)`.

> **Deploy note:** this schema goes live only via the manual `db-push.yml` workflow before any dependent code deploys. Add a checklist line to the PR.

### Task 0.2: `planStore` read layer with cache

**Files:**
- Create: `server/stripe/planStore.ts`
- Test: `server/stripe/planStore.test.ts`

**Interfaces (Produces):**
```ts
export interface StoredPlan { id:number; slug:string; name:string; description:string|null;
  planType:'recurring'|'one_time'|'fixed_date'; stripeProductId:string|null; active:boolean;
  accessUntil:number|null; maxSubscribers:number|null; discordRoleId:string|null;
  telegramChatId:string|null; prices:StoredPrice[]; }
export interface StoredPrice { id:number; stripePriceId:string; label:string|null;
  amountCents:number; currency:string; interval:'day'|'week'|'month'|'year'|null;
  intervalCount:number|null; trialPeriodDays:number|null; active:boolean; isDefault:boolean; }
export async function listActivePlans(): Promise<StoredPlan[]>;
export async function getPlanBySlug(slug:string): Promise<StoredPlan|null>;
export async function getPriceById(stripePriceId:string): Promise<{plan:StoredPlan; price:StoredPrice}|null>;
export function computeExpiryMsForPrice(price:StoredPrice, plan:StoredPlan, fromMs:number): number|null; // null=lifetime/none
export function invalidatePlanCache(): void;
```

- [ ] **Step 1: failing test** — `computeExpiryMsForPrice` for `{interval:'month',intervalCount:1}` from a fixed epoch returns fromMs + ~31d; `{interval:'year',intervalCount:1}` → +366d (match current `computeExpiryMs` windows, `products.ts:143`); `fixed_date` plan → `plan.accessUntil`; `one_time` with null interval → `plan.accessUntil ?? null`.

```ts
import { computeExpiryMsForPrice } from "./planStore";
it("month interval → ~31d window (parity with legacy)", () => {
  const base = 1_000_000_000_000;
  const p = { interval:"month", intervalCount:1 } as any;
  const exp = computeExpiryMsForPrice(p, { planType:"recurring" } as any, base);
  expect(exp).toBe(base + 31*24*60*60*1000);
});
```
- [ ] **Step 2:** Run `npx vitest run server/stripe/planStore.test.ts` — expect FAIL (not implemented).
- [ ] **Step 3:** Implement `planStore.ts`. Cache `listActivePlans()` in a module-level `let cache:{at:number,plans:StoredPlan[]}|null` with a 60s TTL + `invalidatePlanCache()`. Queries use `getDb()` (`server/db.ts`) + Drizzle select with `.leftJoin(planPrices)`, grouped in TS (mysql2 tuple via existing `rowsOf` idiom if using raw SQL). `computeExpiryMsForPrice`: recurring → `intervalMs(interval)*intervalCount` (day=86400000, week×7, month≈31d, year≈366d to preserve legacy behavior); fixed_date → `plan.accessUntil`; one_time → `plan.accessUntil ?? null`.
- [ ] **Step 4:** Run the test — expect PASS.
- [ ] **Step 5:** Commit `feat(stripe): DB plan store with cache + expiry parity`.

### Task 0.3: Backfill the 5 static plans (idempotent)

**Files:**
- Create: `server/stripe/backfillPlans.ts`
- Test: `server/stripe/backfillPlans.test.ts`

**Interfaces:** `export async function backfillStaticPlans(): Promise<{inserted:number; skipped:number}>;`

- [ ] **Step 1: failing test** — given a fake DB with no plans, `backfillStaticPlans()` inserts one `subscription_plans` row + one `plan_prices` row per entry of the legacy `PLANS` record, using each plan's resolved `priceId()` (env) and `amountCents`/`interval` from `products.ts:54`. Running twice inserts 0 the second time (idempotent by `slug`).
- [ ] **Step 2:** Run the test — expect FAIL.
- [ ] **Step 3:** Implement: iterate `Object.entries(PLANS)`; for each, `getPlanBySlug(id)`; if absent, insert plan (`slug=id`, `name`, `planType:'recurring'`, `stripeProductId:null` — legacy products may differ; leave null, fill on next Stripe fetch) + a default `plan_prices` row (`stripePriceId=def.priceId()`, `amountCents`, `interval` mapped from `def.interval`, `intervalCount:1`, `isDefault:true`). Wrap price resolution in try/catch: v2 plans throw if env unset (`products.ts:36`) — skip + log, don't crash.
- [ ] **Step 4:** Run the test — expect PASS.
- [ ] **Step 5:** Add an owner-only tRPC mutation `subscriptionPlans.backfill` (Phase 1 router) to trigger it once in prod, or a guarded startup hook. Commit `feat(stripe): idempotent backfill of legacy plans into the catalog`.

**Phase 0 verification:** `tsc` clean; `vitest run server/stripe/` green; after `db-push.yml` in a test DB, run backfill → 5 plans + 5 prices present; legacy checkout/webhook still use the static path (unchanged). No user-visible change.

---

## Phase 1 — Owner admin CRUD that provisions Stripe (recurring plans)

**Outcome:** the owner creates a recurring plan in the dashboard; it creates a Stripe Product + recurring Price (TEST mode) and appears in the catalog. This is the headline capability.

### Task 1.1: `planProvisioning` Stripe write service

**Files:**
- Create: `server/stripe/planProvisioning.ts`
- Test: `server/stripe/planProvisioning.test.ts` (mock `getStripe()`)

**Interfaces (Produces):**
```ts
export interface NewPlanInput { name:string; description?:string; planType:'recurring';
  price:{ amountCents:number; currency?:string; interval:'day'|'week'|'month'|'year';
    intervalCount:number; label?:string; trialPeriodDays?:number }; maxSubscribers?:number; }
export async function provisionPlan(input:NewPlanInput): Promise<{planId:number; slug:string;
  stripeProductId:string; stripePriceId:string}>;
export async function addPriceToPlan(planId:number, price:NewPlanInput["price"]): Promise<{stripePriceId:string}>;
export async function archivePrice(planPriceId:number): Promise<void>;   // prices.update {active:false} + row active:false
export async function archivePlan(planId:number): Promise<void>;         // products.update {active:false} + row active:false
export async function updatePlanMeta(planId:number, patch:{name?:string; description?:string; maxSubscribers?:number|null}): Promise<void>;
```

- [ ] **Step 1: failing test** — `provisionPlan` calls `stripe.products.create({name, metadata:{dime_plan_slug}})` then `stripe.prices.create({product, unit_amount, currency, recurring:{interval, interval_count}})`, persists both IDs, returns them. Assert **no `payment_method_types`** anywhere and `recurring.interval_count` is passed through. Slug is a stable, unique, kebab/nanoid derived from name (collision-checked against `getPlanBySlug`).
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement using `getStripe()` (`client.ts:20`). Idempotency: pass `{ idempotencyKey }` (name+amount+interval hash) on `products.create`/`prices.create` so a retried mutation doesn't double-provision. On success `invalidatePlanCache()`. Amount validation: integer cents ≥ 50 (Stripe min) — throw `TRPCError BAD_REQUEST` otherwise. `trialPeriodDays` stored on the price row (used at checkout, not on the Price object).
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit `feat(stripe): plan provisioning service (products/prices, idempotent)`.

### Task 1.2: Owner tRPC router

**Files:**
- Create: `server/routers/subscriptionPlans.ts`
- Modify: `server/routers.ts` (mount as `subscriptionPlans`)
- Test: covered via provisioning/store tests + a router shape test

**Interfaces (Produces, all `ownerProcedure`):**
`list()`, `create(NewPlanInput)`, `updateMeta({planId,...})`, `addPrice({planId, price})`, `archivePrice({planPriceId})`, `archivePlan({planId})`, `backfill()`.

- [ ] **Step 1:** Write the router: each mutation validates with zod, calls the matching `planProvisioning`/`planStore` fn, returns the updated plan. Reuse `ownerProcedure` from `appUsers.ts:108`. `create` enforces amount/interval zod bounds (interval_count 1–52 for week/day sanity).
- [ ] **Step 2:** Mount in `server/routers.ts` next to `stripe:` (`routers.ts:171`).
- [ ] **Step 3:** `tsc` clean; add a minimal test asserting the router exposes the 7 procedures and `create` rejects `amountCents<50`.
- [ ] **Step 4:** Commit `feat(api): owner subscriptionPlans router`.

### Task 1.3: Admin UI — list + create/edit form

**Files:**
- Create: `client/src/pages/admin/SubscriptionPlans.tsx`, `client/src/pages/admin/planForm/PlanForm.tsx`, `IntervalPicker.tsx`, `PriceVariantRow.tsx`
- Modify: `client/src/pages/admin/adminNav.ts` (add entry), `client/src/App.tsx` (lazy route)
- Test: `client/src/pages/admin/planForm/intervalPicker.test.ts`

- [ ] **Step 1: failing test** — `IntervalPicker` maps its curated options to Stripe primitives: `monthly→{interval:'month',count:1}`, `quarterly→{month,3}`, `annual→{year,1}`, `weekly→{week,1}`, and (full-flex mode) `2 months→{month,2}`, `Daily→{day,1}`, `14 Days→{day,14}` — matching the Winible list.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Build `IntervalPicker` (pure mapping + `<select>`), then `PlanForm` (Name, Description, Price, IntervalPicker, optional Free Trial days, optional Max subscribers, Active), then `SubscriptionPlans` (owner-guarded page using the `UserManagement.tsx` pattern: `useAppAuth` owner check + `AdminShell`; table of plans via `trpc.subscriptionPlans.list`; "Create Plan" opens `PlanForm`). Dime tokens only. Owner guard identical to `UserActivity.tsx:52-67`.
- [ ] **Step 4:** Run the picker test — expect PASS. `tsc` + `npm run build:client` + `npm run check:bundle` (admin is lazy/off chat-path; expect PASS, note any global-CSS delta).
- [ ] **Step 5:** Commit `feat(admin): Subscription Plans dashboard — create recurring plans`.

**Phase 1 verification:** in Stripe **TEST** mode, create a plan from the dashboard → a Product + recurring Price appear in the Stripe TEST dashboard and in `subscription_plans`/`plan_prices`; archive flips `active` + archives the Stripe Price; `tsc`/tests/build/bundle green.

---

## Phase 2 — Cut checkout + webhook over to the DB (retire the static path)

**Outcome:** a plan created in the dashboard is purchasable end-to-end (embedded checkout) and fulfilled by the webhook, with the same access grant as today. Legacy plans keep working (they're in the DB from backfill).

### Task 2.1: Checkout resolves price from the DB

**Files:** Modify `server/routers/stripe.ts` — `zodPlanId` (`:48`), `buildEmbeddedCheckoutSession` (`:291`), `buildStripeCheckoutSession` (`:155`), price resolution (`:126`).

- [ ] **Step 1: failing test** — a helper `resolveCheckoutPrice(slug)` returns the default active `plan_prices.stripePriceId` for a DB plan; throws `PRECONDITION_FAILED "plan not available"` for missing/inactive (preserving the current clean error at `stripe.ts:126`).
- [ ] **Step 2/3:** Replace `PLANS[planId].priceId()` usage with `planStore.getPlanBySlug(slug)` → default price. Keep `line_items:[{price, quantity:1}]`, `mode:"subscription"`, metadata `plan_id=slug`, **no `payment_method_types`**. `zodPlanId` becomes `z.string()` validated at runtime against `listActivePlans()` (enum can't be static anymore).
- [ ] **Step 4:** `tsc` + tests green.
- [ ] **Step 5:** Commit `refactor(stripe): checkout resolves price from the plan store`.

### Task 2.2: Webhook maps price→plan from the DB; expiry from the price

**Files:** Modify `server/stripeWebhook.ts` (`getPlanByPriceId` at `:241`, expiry compute), `server/stripe/products.ts` (`getPlanByPriceId`/`computeExpiryMs` delegate to `planStore`).

- [ ] **Step 1: failing test** — for a DB price, `getPlanByPriceId(priceId)` returns the plan slug; grant sets `expiryDate = computeExpiryMsForPrice(...)`. Unknown price → falls back to legacy `normalizePlanId` (safety) and logs.
- [ ] **Step 2/3:** Point `products.ts` reverse-map + expiry at `planStore` (async); update the webhook call site. `grantUserAccess` (`stripeWebhook.ts:52`) is otherwise unchanged (`stripePlanId=slug`).
- [ ] **Step 4:** `tsc` + `vitest run server/` green.
- [ ] **Step 5:** Commit `refactor(stripe): webhook resolves plan+expiry from the store`.

### Task 2.3: Public pricing reads the catalog

**Files:** add `subscriptionPlans.publicList` (active, customer-safe fields only) + Modify `client/src/pages/dime/landing/components/Pricing.tsx` to render from it (keep static copy as fallback until parity confirmed).

- [ ] Steps: public query (no owner gate, only `active` plans, no Stripe IDs leaked beyond price id needed for `/checkout?plan=slug`), render tiers, keep RG language. `tsc`/build/bundle green. Commit `feat: landing pricing renders from the plan catalog`.

**Phase 2 verification (TEST mode, Railway preview):** create a plan → it appears on `/pricing` → buy it via embedded `/checkout` (clientSecret only, no redirect) → webhook grants access, `app_users` row shows `hasAccess`, `stripePlanId=slug`, correct `expiryDate` → `subscription.deleted` revokes. `node scripts/smoke-deploy.mjs <origin>` 8/8. Legacy `monthly/annual/pro/sharp/operator` still purchasable.

---

## Phase 2.5 — Owner-only TEST checkout + dual-secret webhook (prove the flow before live)

Goal: let the owner run the full subscribe flow against the Stripe **sandbox** (test key already on the web service) before publishing a single live plan — without opening a public free-access hole and without disturbing live checkout.

### Task 2.5.1: Owner-only test-checkout mutation
**Files:** `server/routers/subscriptionPlans.ts`.
- [x] `createTestCheckoutSession` (ownerProcedure) — precondition `isProvisioningTestMode()`, resolves the plan's **test** price via `defaultPriceForMode(plan, false)` (never a live price), creates a `mode:"subscription"` Checkout Session on the **test** provisioning client, returns `session.url`. Metadata `dime_test:"1"`. No `payment_method_types`.

### Task 2.5.2: Dual-secret webhook verification
**Files:** `server/stripeWebhook.ts`.
- [x] Verify the `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` then the optional `STRIPE_TEST_WEBHOOK_SECRET` (each a distinct HMAC secret; trying both never weakens verification). 400 only if none verify.
- [x] **Test-mode safety guard:** `processWebhookEvent` returns early for `event.livemode === false` — a test card must never mint a real `app_users` row or grant live access. The grant path is identical for live events, so the sandbox run still validates checkout → price-by-mode → Stripe → delivery → signature.

### Task 2.5.3: Admin "Test checkout" button
**Files:** `client/src/pages/admin/SubscriptionPlans.tsx`, `client/src/pages/admin/planTypes.ts`.
- [x] Mirror the server's `livemode` field onto the client `StoredPlan`/`StoredPrice`. Render a mint "Test checkout" action (alongside Archive) only for `plan.active && !plan.livemode` (sandbox plans); on success open the returned URL in a new tab.

**Phase 2.5 verification:** `tsc` clean · 44 module tests + 7 new source-contract safety tests green · build + bundle within budget. **Owner setup (one-time):** in the Stripe **sandbox** dashboard create a webhook endpoint pointing at the prod `POST /api/stripe/webhook`, copy its signing secret to `STRIPE_TEST_WEBHOOK_SECRET` on the Railway **web** service. Then: create a sandbox plan → "Test checkout" → pay with test card `4242…` → webhook verifies and is acknowledged (fulfillment intentionally skipped, prod users untouched) → flip to live only after this passes.

---

## Roadmap — remaining Winible-parity phases (scoped; task-level detail authored at execution time)

Each is additive on the Phase 0–2 foundation and ships independently. Listed with the exact Stripe primitives + files so the next planning increment is mechanical.

### Phase 3 — Billing variants, free trials, promo codes
- **Billing variants** ("Add Billing Variant"): `addPriceToPlan` already exists (Task 1.1). UI: repeatable `PriceVariantRow` per plan (e.g. Monthly + Annual); checkout picks the chosen `plan_prices` row (extend `/checkout?plan=slug&price=<id>`). Files: `SubscriptionPlans.tsx`, `stripe.ts` price resolution, `plan_prices` (already multi-row).
- **Free trial**: `trialPeriodDays` on the price → `subscription_data.trial_period_days` on the session (`billing.md:54`). Files: `stripe.ts` session builders.
- **Promo codes**: `stripe.coupons.create` + `stripe.promotionCodes.create` in `planProvisioning`; new `plan_promos` table; session `allow_promotion_codes:true` (never with `discounts`). Owner UI to mint/list/deactivate codes. Files: `planProvisioning.ts`, new router methods, `SubscriptionPlans.tsx`.
- **Verify:** trial subscription starts unpaid then converts; promo code applies at checkout; variant selection charges the right price.

### Phase 4 — Non-recurring, fixed-date, limited quantity
- **Non-recurring (one-time)**: `plan_prices.interval=null`; checkout `mode:'payment'`; webhook `checkout.session.completed` grants access with `computeExpiryMsForPrice` (one_time → `plan.accessUntil ?? null`). Files: `stripe.ts` (branch on `planType`), `stripeWebhook.ts` (payment-mode grant).
- **Fixed-date**: `planType='fixed_date'` + `accessUntil`; either a one-time payment granting access until the date, or a subscription with `cancel_at`. **Unknown R4** — pick during Phase 4 design. Files: schema (done), `stripe.ts`, webhook.
- **Limited quantity** (`maxSubscribers`): before creating a session, count active subscribers for the plan (`app_users` where `stripePlanId=slug` AND active) and reject at cap; re-check in the webhook (race). Accept small overshoot risk (documented). Files: `stripe.ts` create-session guard, a `countActiveByPlan(slug)` in `server/db.ts`.
- **Verify:** one-time purchase grants time-boxed access; fixed-date expires on schedule; N+1th checkout at a cap is rejected cleanly.

### Phase 5 — Per-plan Discord / Telegram access
- Today grant syncs a single Discord role (`stripeWebhook.ts` grant path). Extend: `subscription_plans.discordRoleId`/`telegramChatId` → on grant/revoke, add/remove the plan's specific role / invite. Needs bot permissions + a Telegram integration (new). Files: the Discord sync in the webhook grant, a new `server/integrations/telegram.ts`, admin UI fields. **Unknown R5** — Telegram bot/access model undefined; treat as its own spec.
- **Verify:** buying plan A grants role A only; cancel removes it; Telegram invite/kick fires.

---

## Risks & Unknowns

- **R1 — Live keys only (highest risk).** `client.ts` uses whatever `STRIPE_SECRET_KEY` is set; it's live. Provisioning + checkout dev MUST run against a **TEST-mode** key (and ideally a TEST **RAK** scoped to products/prices/coupons/checkout/subscriptions). Plan: add a TEST key to a dev/preview env; never create test plans against the live account. Final go-live step re-creates the plans (or flips the key) in live.
- **R2 — Price immutability & subscriber drift.** Editing amount/interval creates a new Price; existing subscribers keep the old one. UI must say "changing price creates a new price; current subscribers are unaffected." Never `prices.update` amount (not allowed).
- **R3 — `db-push.yml` ordering.** Schema (Phase 0) must be pushed before Phase 0.2+ code deploys or queries 500. PR checklist enforces it.
- **R4 — Fixed-date semantics** (Phase 4): subscription-with-`cancel_at` vs one-time-until-date is undecided; affects renewal/proration. Decide with a short spike.
- **R5 — Telegram** (Phase 5): no existing integration; access/kick model, bot hosting, and mapping are unknown. Its own spec.
- **R6 — Quantity race**: app-enforced caps can overshoot under concurrent checkouts. Enforce at session-create + webhook; document acceptable slack, or gate via a short DB transaction/lock if strictness is required.
- **R7 — `stripePlanId` varchar(16)→(64)** is a widening migration; safe, but must ship in the same `db-push` as the new tables.
- **R8 — Client/server catalog divergence** exists today (landing copy is hardcoded). Phase 2.3 removes it; until then keep them in sync.
- **R9 — Bundle budget**: all new UI is admin (lazy, off chat critical path). Low risk, but `npm run check:bundle` must stay green (global CSS only).

## Out of Scope

- **Multi-creator / marketplace** (Stripe Connect). This is single-tenant — the owner's own Stripe account only.
- **Tiered feature entitlement.** Access stays binary (`hasAccess`/`expiryDate`); a plan is a pricing tier, not a per-feature gate. (Revisit as a separate project.)
- **Usage-based / metered billing** (would use Metronome, per `billing.md`).
- **Stripe Tax / VAT / GST.** Note for a follow-up before scaling internationally.
- **Credit ledger / add-on credit packs** (deferred per `checkout-pricing-v2-plan.md` D3).
- **Customer-facing plan self-service beyond the existing Customer Portal** (upgrades/downgrades/proration UI).
- **Multi-currency** beyond a per-price `currency` field defaulting to `usd`.
- **Migrating the live account's existing products** — backfill references existing price IDs; it does not rename/restructure live Stripe objects.

## Self-Review notes
- Spec coverage: create/edit/archive (Tasks 1.1–1.3), Stripe mapping (0.2/1.1/2.1/2.2), full-flex intervals (1.3 IntervalPicker), variants/trial/promo (Phase 3), non-recurring/fixed-date/quantity (Phase 4), Discord/Telegram (Phase 5), backfill (0.3). All present.
- Type consistency: `StoredPlan`/`StoredPrice`/`NewPlanInput` are the shared contracts used across store→provisioning→router→webhook; slug (not int id) is the entitlement key on `app_users.stripePlanId`, backward-compatible with the 5 legacy slugs.
- No live-mode writes anywhere in Phases 0–3 dev (R1).
