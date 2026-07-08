# DIME AI — USER-ONBOARDING ROADMAP

> From "payment completed" to an activated, habitual member.
> Form: `roadmap-planning` — outcome-framed epic hypotheses with success metrics,
> Now/Next/Later, explicit dependencies on `dime-ai/ZERO-TO-ONE-ROADMAP.md` (E1–E8).
> A plan, not a contract; re-sequence as the activation data comes back.

---

## 1. Current journey map (evidence-based, as shipped today)

What actually happens to a brand-new buyer with no prior account:

1. **Stripe checkout completes.** Webhook `checkout.session.completed` creates a *pending*
   account: username from the checkout custom field `desired_username`, sanitized and
   collision-suffixed (`server/stripeWebhook.ts:136-149`, `241-244`); placeholder password,
   `termsAccepted: false`, `pendingSetup: true` (`server/stripeWebhook.ts:170-185`). Discord
   role is deferred until setup completes (`server/stripeWebhook.ts:79-84`). If the email
   already exists, access is silently granted to the *existing* account instead
   (`server/stripeWebhook.ts:152-164`).
2. **Redirect to `/subscribe/success`.** Page polls `stripe.getCheckoutSessionUser` with 5
   exponential-backoff retries (`client/src/pages/SubscribeSuccess.tsx:100-109`).
   - **Friction F1 — webhook race dead end:** if the webhook hasn't landed after ~30s of
     retries, the user sees "Could not confirm your subscription… contact support"
     (`SubscribeSuccess.tsx:174-184`). Paid, but stranded.
3. **Password gate.** New user must set email + password before seeing anything
   (`SubscribeSuccess.tsx:244-407`). Submit → `stripe.completeAccountSetup`
   (`server/routers/stripe.ts:374-475`): clears `pendingSetup`, grants Discord role
   (`stripe.ts:431-437`), issues a 90-day auto-login JWT (`stripe.ts:439-448`; invariants
   locked in `server/completeAccountSetup.test.ts:11-33`), fires a welcome email whose only
   CTA is `/feed` (`server/email.ts:239`, `:263`).
   - **Friction F2:** value is entirely behind the form; no preview, no "what happens next."
4. **"You're In" → "Enter the Platform" → `/feed`** (`SubscribeSuccess.tsx:227-235`).
   `RequireAuth` gates the route and prefetches feed data (`client/src/App.tsx:151`,
   `client/src/components/RequireAuth.tsx:65-118`, `:150-164`).
5. **First-session terms gate.** Because the webhook set `termsAccepted: false`, the
   AgeModal (21+, 1-800-GAMBLER) blocks the feed on first render
   (`client/src/pages/ModelProjections.tsx:466`, `client/src/components/AgeModal.tsx`).
   - **Friction F3 — punitive dead end:** the modal's "Close" button *logs the user out*
     (`ModelProjections.tsx:965` — `onClose={appLogout}`). Accept-or-eject, no explanation.
6. **The feed, cold.** Accepting drops the user into the full projections grid with zero
   guidance — no tour, no "this is an edge," no first-run state. The only empty state is
   "No games found" (`ModelProjections.tsx:1753`), which on an off-day is the *entire*
   first impression (**F4**).
7. **Discord connect** exists only as a small header link when `discordId` is null
   (`ModelProjections.tsx:1025-1072` → `/api/auth/discord/connect`); Profile shows Discord
   only if *already* connected (`client/src/pages/Profile.tsx:188-202`). No pitch for why
   the community matters (**F5**).
8. **Chat is unreachable.** `/chat` (DimeChat) is routed (`App.tsx:180`) with a real empty
   state — "Ask Dime." + suggestion chips (`client/src/pages/DimeChat.tsx:182-206`) — but
   the only nav link lives in the owner-only mobile tabs
   (`client/src/features/mobileOwnerTabs/config.ts:29`; `MOBILE_OWNER_TABS_PUBLIC_ENABLED =
   false` at `:11`, gate at `:40-61`). **F6 — the flagship AI feature is invisible to every
   paying member.** Conversations are also in-memory only (E8 territory).
9. **No Dime entitlements bootstrap.** `dime_user_entitlements` exists
   (`drizzle/dime.schema.ts:161-177`) but neither the webhook nor `completeAccountSetup`
   writes a row, and `server/dime-chat.route.ts:80-91` gates on auth only — no
   entitlement/credit check. **F7:** when credit gating turns on, every existing member is
   an orphan.
10. **Nothing is measured.** `metrics.*` covers sessions only — open/close/heartbeat,
    owner-facing DAU/WAU/MAU (`server/routers/metrics.ts:22-79`). Rich structured logs
    exist (`dimeLog`, `profileLog`) but go to console, not to queryable events (**F8**).

**Net:** a new member's "onboarding" today is: pay → set password → legal modal that can
log them out → dense grid. First value is accidental; chat, the differentiator, is hidden.

## 2. Activation definition + guardrails

**Activated member** (proposed): within **24h of `account_setup_completed`**, the user has
(a) `terms_accepted`, (b) `edge_card_viewed` — opened/expanded ≥1 game card carrying an
edge signal on `/feed`, and (c) `chat_first_message` — sent ≥1 Dime chat question.
Secondary (habit) marker: returns for a second session within 7 days (`metrics.openSession`
already captures this — `server/routers/metrics.ts:61-68`).

**Guardrail metrics** (must not degrade while we push activation):
- Account-setup completion rate (checkout → `completeAccountSetup` success) ≥ today's baseline
- Terms-acceptance rate; no rise in first-session logouts (F3 fix must not weaken the gate)
- Month-1 churn / refund + support-ticket rate (onboarding pressure must not create noise)
- Responsible gaming: RG links present on every new surface; no dark-pattern urgency copy;
  chat's distress handling (`server/dime-chat.route.ts:39`) preserved in all reskins

## 3. Onboarding epics (hypotheses with success metrics)

| # | Epic | Hypothesis | Success metric |
|---|---|---|---|
| O1 | **Activation instrumentation** — persist onboarding events via a `metrics.trackEvent` procedure + server-side emits | We believe we cannot improve what we can't see; wiring 8 events makes activation measurable at all | Funnel dashboard live: checkout→setup→terms→feed→edge→chat; baseline activation % known |
| O2 | **Un-dead-end the doorway** — webhook-race recovery UI, AgeModal "Close" no longer logs out, existing-email path explains which account got access | Removing the three F1/F3/F9 dead ends recovers paid users we currently strand | Setup completion +5pts; zero "contact support" terminal states in the happy path; first-session logout rate ↓ |
| O3 | **Chat surfaced + entitlements bootstrap** — member nav entry to `/chat` on feed header/profile; write a `dime_user_entitlements` row at `completeAccountSetup` | Making Dime chat discoverable to members (it's invisible today) drives the "(c)" leg of activation; the entitlement row future-proofs credit gating | % of new members sending ≥1 chat message in 24h: ~0% → 40%; 100% of new accounts have an entitlement row |
| O4 | **First-edge guided moment** — one-time spotlight on the strongest edge card ("this is a Dime: model vs. book, here's why") | Teaching the edge concept in the first minute converts the grid from noise into the product's aha | `edge_card_viewed` within first session: baseline → 70%; time-to-first-edge < 2 min |
| O5 | **Welcome / first-run tour in Dime brand** — 3-step overlay (Feed → Edges → Ask Dime) per `design-system/dime-ai/MASTER.md`, plus a responsible-gaming touch reframed as care, not eviction | A branded first-run that ends in a chat prompt lifts full activation vs. cold drop-in | 24h activation rate baseline → +20pts; tour completion ≥ 60%; RG link click-through measured, not zero |
| O6 | **Discord community hook** — post-setup step 2 on SubscribeSuccess ("You're in — join the war room"), with role auto-grant already handled (`stripe.ts:431-437`) | Community connection within day 1 raises week-1 return (the habit marker) | Discord-connect rate for new members: baseline (owner metric exists, `metrics.ts:42-48`) → 50%; D7 return rate ↑ |
| O7 | **Lifecycle email re-engagement** — extend `server/email.ts`: day-1 "your first edge" email, day-3 "ask Dime anything," win-back on 7-day silence | The single welcome email (`email.ts:200-263`) is the only touch today; a 3-email activation series recovers non-activated signups | Non-activated → activated conversion from email ≥ 10%; unsubscribe < 1% |

## 4. Now / Next / Later (sequenced against E1–E8)

```
NOW (current UI, no Dime shell needed)      NEXT (needs E2/E3 shell)        LATER (post-E6 launch)
O1 Instrumentation  ──────────────────────► O5 Dime-brand first-run tour    O7 full lifecycle emails
O2 Dead-end fixes (F1/F3/F9)                O4 guided edge moment           re-engagement push /
O3 Chat nav + entitlements bootstrap ─────►    (final form waits on E4      "resume your chat" hooks
O6 Discord hook on SubscribeSuccess            card redesign)               (need E8 persistence)
```

**Dependencies, explicitly:**
- O1 blocks *measuring* everything else — it ships first and alone needs nothing.
- O2, O3, O6 ship **now on the current UI**: they touch `SubscribeSuccess.tsx`,
  `ModelProjections.tsx:965`, nav config, and `stripe.ts:completeAccountSetup` — none of it
  waits for the Dime shell. O3's nav entry gets restyled later by E3, not blocked by it.
- O4 interim version (tooltip spotlight) can ship now; its final form depends on **E4**
  (feed card redesign) so the "edge anatomy" callout matches the new cards.
- O5 depends on **E2 + E3** (Dime shell on feed and chat) — a branded tour over the legacy
  neon-green UI would violate brand law and be rework. It should land *with* or just after
  **E6 cutover** so the first-run a new member sees is the launched Dime.
- O6 hardens alongside **E5** (membership surface) — same Stripe/plan-state code paths.
- O7's day-1/day-3 emails can start in Next (email infra exists); the chat-resume hook
  needs **E8** chat persistence. CI secrets (Vitest) gate O2's webhook-path changes the
  same way they gate E6 — the `completeAccountSetup.test.ts` suite must run before touching
  that flow.

## 5. Instrumentation plan (feeds O1; maps to `server/routers/metrics.ts`)

Extend the existing metrics router (session infra already there, `metrics.ts:51-78`) with a
persisted event log — one `user_events` table (userId, event, metadata JSON, createdAt) and:
- `metrics.trackEvent` — `appUserProcedure` mutation for client emits (whitelisted names)
- Server-side emits (preferred — already console-logged, just persist them):
  - `account_created_pending` — webhook new-user path (`stripeWebhook.ts:196`)
  - `account_setup_completed` — `stripe.ts:429` (also stamp entitlement row here, O3)
  - `terms_accepted` — `appUsers.acceptTerms` (`server/routers/appUsers.ts:559`)
  - `chat_first_message` / `chat_opened` — `dime-chat.route.ts` `dimeLog` sites (`:106`, `:151`)
  - `discord_connected` — OAuth callback success path
- Client emits: `feed_first_view`, `edge_card_viewed` (card expand on a positive-ROI game),
  `tour_step_completed`, `welcome_email_clicked` (UTM on `email.ts:239` CTA)
- Dashboards: activation funnel + D1/D7 return, joined against existing DAU/WAU/MAU
  (`metrics.ts:24-30`) and member metrics (`metrics.ts:42-48`). Owner-only, like today.

## 6. Out of scope

- Pricing, checkout mechanics, Payment Element — owned by **E1/E7**
- Free trials, referral programs, mobile apps, NHL/NBA feed revival (zero-to-one doctrine)
- Changing the legal substance of the age/terms gate (copy tone only; the 21+ /
  1-800-GAMBLER requirements are non-negotiable)
- Chat persistence and Trends surfaces themselves — **E8**; this roadmap only consumes them
- Dime credit *pricing/enforcement* policy — O3 bootstraps the entitlement row; gating
  rules are a separate product decision
