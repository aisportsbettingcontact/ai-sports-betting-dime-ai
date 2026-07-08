# Dime Signup Flow — Design Direction (E5)

Governing law: `design-system/dime-ai/MASTER.md` (one-accent mint, Familjen Grotesk + IBM Plex
Mono, 160ms curve, listed anti-patterns). Taste doctrine: `.agents/skills/frontend-design/SKILL.md`
(distinctive, subject-grounded, one justified risk). Visual language baseline:
`dime-ai/reference-pages/dime-landing.html`, `dime-home-dark.html`.

---

## 1 · Current-flow map (with evidence)

How accounts exist today: (a) Stripe checkout webhook creates them, (b) the owner creates them
(`appUsers.createUser`, `server/routers/appUsers.ts:621-669`). There is **no self-serve
`register` procedure** — "signup" IS the checkout path.

| # | State | Evidence |
|---|-------|----------|
| S0 | Landing `/` → pricing section | `client/src/App.tsx:128`, `client/src/pages/landing/components/PricingCTA.tsx` |
| S1 | CTA click → checkout session (anon: `publicCreateCheckoutSession`; authed: prefilled) → hard redirect to Stripe | `PricingCTA.tsx:122-141`, `server/routers/stripe.ts:204-216, 234-256` |
| S2 | Stripe-hosted checkout collects email + required **"Desired Username"** custom field | `server/routers/stripe.ts:131-143` |
| S3 | Webhook `checkout.session.completed`, new-user path: pending account created — username sanitized + collision-suffixed silently, placeholder password, `pendingSetup=true`, `termsAccepted=false` | `server/stripeWebhook.ts:136-185, 208-263` |
| S3b | Existing-email path: access granted to the existing account instead; **no** `pendingStripeSessionId` written | `server/stripeWebhook.ts:152-163` |
| S4 | Redirect → `/subscribe/success?session_id&plan`; polls `getCheckoutSessionUser` | `SubscribeSuccess.tsx:100-109`, `server/routers/stripe.ts:339-367` |
| S5 | `pendingSetup=true` → setup form: email (asked **again**, prefilled) + password | `SubscribeSuccess.tsx:245-405` |
| S6 | `completeAccountSetup` → password set, Discord role granted, 90-day session cookie issued (auto-login) → "Enter the Platform" → `/feed` | `server/routers/stripe.ts:374-448`, `SubscribeSuccess.tsx:227` |
| S7 | First `/feed` visit: AgeModal ambush if `!termsAccepted`; Close = logout | `ModelProjections.tsx:466, 965`, `AgeModal.tsx`, `appUsers.ts:559-565` |
| S8 | Alt entry `/login` (Home.tsx): password login + forgot-password + Discord OAuth; "Sign Up" → `/#pricing` | `Home.tsx:146-171, 573`, `server/discordLogin.ts:192-237` |
| S9 | In-product Discord-only LoginModal ("by invitation only") | `LoginModal.tsx:44-158`, `ModelProjections.tsx:966` |
| S10 | `/reset-password` | `App.tsx:146`, `appUsers.ts:981-1153` |

**Rough edges**
1. **Three brand universes in one funnel**: landing (Dime mint) → SubscribeSuccess (legacy neon
   `#39FF14`, gradients, red errors — `SubscribeSuccess.tsx:154, 206, 380`) → `/login` (neon +
   `#050810` + Discord purple — `Home.tsx:240, 479`). Every one violates current anti-patterns.
2. **Discord OAuth errors are swallowed**: `discordLogin.ts` redirects failures to
   `/?discord_error=...` (e.g. `:485, :540`), but the error dictionary renders only on `/login`
   (`Home.tsx:42-64, 386-401`) (the Discord CONNECT flow has its own toast handler on `/feed` —
   `client/src/pages/ModelProjections.tsx:477-517` — a separate dictionary; do not consolidate
   them); LandingPage never reads the param. Dead end.
3. **Duplicate identity steps**: email typed at Stripe, then re-asked on SubscribeSuccess;
   username typed at Stripe can be silently rewritten (`stripeWebhook.ts:136-149`) with no
   confirmation moment.
4. **Webhook race**: `getCheckoutSessionUser` returning `null` is a *success* (no retry,
   `stripe.ts:358-361`) — a slow webhook can render the setup form against a nonexistent row;
   submit then throws NOT_FOUND ("contact support").
5. **S3b dead end**: existing-email purchasers have no `pendingStripeSessionId`, so the success
   page can never resolve them — payment succeeds, screen fails.
6. **Two password rulebooks**: setup demands upper/lower/special (`stripe.ts:378-382`);
   reset/createUser demand only min-8 (`appUsers.ts:1103, 625`).
7. **Terms after the door**: age/terms gate appears post-login inside the product, duplicated in
   two pages, with "Close" = logout.
8. **Contradictory identity narrative**: LoginModal claims "Access is by invitation only"
   (`LoginModal.tsx:140-144`) while the landing sells self-serve subscriptions.

---

## 2 · Design direction — "The Settlement Slip"

**Thesis.** In this product's world every position ends in a *settlement*: a slip is graded, rows
are stamped, the ledger closes. Signing up is the user's first settlement — payment made, handle
claimed, terms stamped, account opened. The entire signup renders as **one vertical slip**: a
narrow (max 440px) `--surface-card` column on the `#0B0B0F` page, hairline-ruled rows, IBM Plex
Mono micro-labels (10-11px, 0.08em, uppercase, `--text-muted`) on the left, Familjen Grotesk 700
values on the right, dotted leaders between them. Rows fill in as the flow progresses. Copy is
plain-verb, sentence case, no hype: buttons say exactly what happens ("Create password", not
"Activate"). Mint appears **only** as state-confirmation — the signup analogue of edge: one
stamped `✓` per settled row, the focus ring, the live "settling" dot. Everything unsettled is grey.

### D1 · Landing pricing entry (`/#pricing`)
Pricing cards restyled per dime-landing.html: `--surface-card`, 1px `--color-border`, 16px radius,
plan name Familjen 700, price 700 at clamp(30-44px), mono eyebrow `PLAN — MONTHLY / ANNUAL`.
Annual prominence via border weight + mono badge `BEST VALUE · SAVE 58%` — never gold, never glow.
CTA = `.btn--mint` "Get monthly access" / "Get annual access". Loading: button opacity 0.85 +
label "Opening checkout…" (no spinner theatrics); error: inline mono `ERROR` row beneath the card
(see States). Keep 21+ / 1-800-GAMBLER line in `--text-faint` under the cards.

### D2 · Stripe-hosted checkout
Out of our CSS reach; align via Stripe branding settings: background `#0B0B0F` family, accent
`#45E0A8`, logo = coin-dot mark. Rename the custom field label to **"Pick your handle"**
(min 3 chars) so it reads as identity, not paperwork. Contract unchanged
(`custom_fields[key=desired_username]`, `stripe.ts:131-143`).

### D3 · `/subscribe/success` — the slip itself (replaces SubscribeSuccess)
One screen, four sequential states of the same slip. Header: wordmark `dıme` + mono eyebrow
`ACCOUNT — SETTLEMENT`.

- **SETTLING** (webhook not yet resolved): slip shows `PAYMENT` row with 7px pulsing mint dot +
  "Confirming with Stripe…" in `--text-secondary`. Poll `getCheckoutSessionUser` until non-null
  (fixes edge 4 — the claim form must never render before the row exists). After 60s: switch to
  the ERROR treatment with order reference and "Contact support" as a real link — payment
  reassurance line stays: "Your payment went through. Your account is still being created."
- **CLAIM** (`pendingSetup=true`): rows in order — `PLAN` (Monthly · $99.99/mo, grey, settled ✓),
  `PAYMENT` (✓ mint), `HANDLE` (@username as delivered by the webhook, **with an inline "Change"
  affordance if it was rewritten** — surfaces edge 3 instead of hiding it), `EMAIL` (prefilled
  input, editable), `PASSWORD` (input + live rule checklist: met = mint ✓, unmet = grey dot —
  never red), `TERMS` (one checkbox row: "I'm 21+ and understand dime is analysis, not a
  sportsbook. If you need help: 1-800-GAMBLER" — writes `termsAccepted`, retiring the S7 ambush).
  Submit: full-width `.btn--mint` "Create password & open account".
- **DONE**: all rows stamped; final row `STATUS — OPEN` with the one celebratory move: the value
  set in Familjen 700 at 20px, mint. CTA "Go to the board" → `/feed`. Secondary grey text link
  "Back to home". No confetti, no scale springs — 160ms fades only. DONE state hosts the
  Discord-connect step (ONBOARDING-ROADMAP O6 step 2) as its single post-completion CTA
  alongside Enter the Platform.
- **ALREADY OPEN** (existing user / S3b fix): if session resolves to an existing account, slip
  shows `PAYMENT ✓` + "This email already has a dime account." CTA "Sign in to attach" → `/login`
  (requires the backend to also match by customer email; flag as an interlock requirement).

### D4 · `/login` — the counter (replaces Home.tsx)
Drop the split-screen marketing panel: people at `/login` already bought the pitch. One centered
slip-column: wordmark, mono eyebrow `SIGN IN`, two mono-labeled inputs (`HANDLE OR EMAIL`,
`PASSWORD`), focus = 3px `--ring` on the row, submit `.btn--mint` "Sign in". Below a hairline:
`.btn--ghost` "Continue with Discord" (Discord glyph in currentColor grey — Discord blurple is
off-palette; the wordmark text is identification enough). Footer links in `--text-secondary`:
"Forgot password" (inline swap, as today) · "No account? See pricing" → `/#pricing`. Discord
OAuth failures must redirect here (`/login?discord_error=…`), where the existing dictionary
renders as an ERROR row (fixes edge 2). Kill the "invitation only" copy everywhere (edge 8).

### States (global rules)
- **Loading**: in-place label change + 0.85 opacity; page-level waits use the 7px pulsing mint
  dot + one grey sentence. Never skeleton-shimmer a four-field form.
- **Error**: a slip row — mono label `ERROR` in `--text-secondary`, message in `--text-primary`,
  row bordered `#2E2E38`. No red (palette is closed); the mono stamp + weight carries severity.
  Every error names the fix ("That handle is taken. Pick another.") and keeps a working exit.
- **Success**: the row it settles gets the mint ✓; the button that did it keeps its name
  ("Sign in" → toast "Signed in").

### Interlocks
Pricing CTA → Stripe → slip → `/feed` is the spine; `/login` is the returning-user branch; both
share the slip column, tokens, and copy register. Checkout-created accounts land on the slip in
CLAIM; owner-created and Discord-linked accounts land at `/login`. Terms live in CLAIM; the
restyled AgeModal (slip-styled, no yellow triangle — Lucide AlertTriangle icon, grey
(`--text-secondary`)) remains only as a legacy fallback for pre-existing accounts with
`termsAccepted=false`. Password rules: adopt the `completeAccountSetup` set
(`stripe.ts:378-382`) as the single rulebook, mirrored at reset.

**E7 interlock.** `E7-EMBEDDED-CHECKOUT.md` (same series) eliminates the Stripe redirect
entirely. If E7 ships first, D2 becomes the embedded checkout iframe hosted **inside** the slip
column at `/checkout`, and D1's CTA navigates to `/checkout` instead of redirecting; the funnel
spine becomes Pricing CTA → `/checkout` (embedded) → slip. The Stripe branding-settings guidance
and the "Pick your handle" label rename in D2 carry over unchanged.

---

## 3 · The one deliberate aesthetic risk

**The settlement-slip ledger composition.** Signup screens are near-universally a floating card
with stacked full-width inputs. Here the whole flow — including its form fields — is typeset as a
graded betting slip: mono micro-labels left, dotted leaders, bold Familjen values right, hairline
rules between rows, states stamped in sequence. Risk: inputs living inside ledger rows is an
unfamiliar form pattern and demands precise spacing (dense 8/10 grid: 12px row padding, 1px
rules) to avoid reading as a broken table. Justification: it is the subject's own vernacular —
this product grades slips for a living, and the signup *is genuinely a sequence*, so the
structure encodes information (what's settled, what's owed) rather than decorating. It is
achieved purely through typography, spacing, and composition; the closed palette is untouched.
Everything around it stays quiet — one risk, spent in one place.

## 4 · Accessibility & anti-pattern compliance (MASTER.md checklist)

- Mint only on signal: settled-✓, live dot, focus ring, active CTA — never decoration; unmet
  password rules and PASS-grade states are grey, never red.
- `--mint-on-light: #0FA36B` for any mint text if a light variant ships; light mode = token swap.
- Familjen Grotesk + IBM Plex Mono only; no Inter/Barlow/JetBrains. All icons brand-SVG/Lucide,
  no emojis (current AgeModal/SubscribeSuccess glyphs replaced).
- All text ≥ 4.5:1 both themes; labels are real `<label for>`; errors linked via
  `aria-describedby`; the slip is a `<form>` with real `<button>`s, not divs.
- Focus: 3px `--ring` on every interactive element; no hover-only affordances (Change-handle
  affordance visible, `:focus-within` supported); `cursor: pointer` everywhere clickable.
- Motion: one curve, `160ms cubic-bezier(0.16,1,0.3,1)`; pulse 1.6s; all animation gated behind
  `prefers-reduced-motion`; no layout-shifting hovers, no scale springs, no framer-motion entrances.
- Responsive 375/768/1024/1440: slip column is fluid `min(440px, 100% − 32px)`; no horizontal
  scroll; no canvas-frame chrome.
- Responsible-gaming: 21+ / 1-800-GAMBLER present on pricing, TERMS row, and login footer.

## 5 · Out of scope (explicit)

- Any code changes — this is direction only; no components, routes, or backend edits.
- Backend contract changes (webhook payloads, `pendingStripeSessionId` mechanics, tRPC
  signatures); the S3b email-match and `/login?discord_error` redirect are *flagged requirements*
  for their own tickets, not designed implementations here. Two more backend interlocks, flagged
  the same way:
  - **TERMS row write path** — `completeAccountSetup` (`server/routers/stripe.ts:374-383`) does
    not accept or write `termsAccepted`. DECISION: the slip calls the existing
    `appUsers.acceptTerms` mutation immediately after the auto-login cookie lands (no backend
    change; keeps the `terms_accepted` instrumentation site in ONBOARDING-ROADMAP §5 valid).
  - **HANDLE row "Change" affordance** — `getCheckoutSessionUser` (`stripe.ts:346-356`) returns
    only the final username; whether it was rewritten is undetectable, and no rename endpoint
    exists at setup time. Downgrade the affordance to a *display-only note* for v1; the rename
    endpoint is listed as a future backend contract.
- Stripe product/pricing structure, plan economics, promo codes, payment methods.
- Discord OAuth internals, invite-token flow, owner admin surfaces (`UserManagement`).
- The `/feed`, `/chat`, `/account`, and reset-password page redesigns (reset inherits D4's
  slip column but is specced elsewhere).
- Light-mode art direction beyond the token-swap rule; email templates; marketing copy overhaul.
