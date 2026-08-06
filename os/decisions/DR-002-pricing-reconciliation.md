# DR-002 — Pricing reconciliation: three contradictory price sets ship simultaneously

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 by the executor (Stage 2)
**observe_by:** 2026-08-12
**Urgency:** HIGH — live, customer-facing, and indexed by search engines
**Doctrine:** D6 (artifact law / no unqueryable claims) · D15 #8 (weak tests) · §19 compliance gate

---

## The question

**Which price set is canonical, and does the bot-facing prerender get reconciled to it or removed?**

## What is actually true — VERIFIED 2026-08-05

Three different price sets ship on the same page today.

### Set A — the live React page (what a human sees and clicks)
`client/src/pages/dime/landing/landing-content.ts:292-343`, rendered by `components/Pricing.tsx`

| Tier | Price | Checkout plan id |
|---|---|---|
| **Pro** | **$49.99**/month | `dime-pro` |
| **Sharp** | **$99.99**/month | `dime-sharp` |
| **Max** | **$199.99**/month | `dime-max` |

### Set B — the bot-facing prerender (what Google indexes)
`server/landingPrerender.ts:393-399`, served to crawlers via `server/_core/vite.ts:48,112`

| Tier | Price | Link |
|---|---|---|
| Free Preview | $0 | — |
| **Pro** | **$99**/month · "≈$3.30/day" | `/checkout?plan=pro` |
| **Sharp** | **$249**/month · "≈$8.30/day" | `/checkout?plan=sharp` |
| **Operator** | **$499**/month · "≈$16.63/day" | `/checkout?plan=operator` |
| Founder | By application | — |

Plus **schema.org `SoftwareApplication` offers** at `landingPrerender.ts:350` declaring
`Pro 99 / Sharp 249 / Operator 499 USD`, and a **`FAQPage` answer** at `:351` stating
*"Pro is $99/month, Sharp is $249/month and Operator is $499/month."*

### Set C — the objections block on the live page
`landing-content.ts:398-399,422` — *"That's ≈ $3.30 a day…"*, `stamp: "≈ $3.30/day"`, and
*"Sharp and Operator add earlier access…"*, *"New sports ship to Sharp, Operator and Founder tiers
first."*

### And the governance mechanism itself is stale
The **HONESTY LAW header** (`landing-content.ts:7-14`) — the claim whitelist that exists to prevent
exactly this — declares the whitelisted claims as *"Pro $99/mo, Sharp $249/mo, Operator $499/mo"*.
**The whitelist blesses Set B and contradicts Set A in the same file, 280 lines above it.**

### Who actually sees Set B — RESOLVED 2026-08-05

`server/landingPrerender.ts:22-60` gates the landing prerender to **bots only**; human browsers get
the SPA shell (Set A, correct prices). The bot list includes `googlebot`, `bingbot`,
`facebookexternalhit`, `twitterbot`, `linkedinbot`, `discordbot`, `slackbot`, `applebot`, the SEO
crawlers — **and the AI crawlers: `claude-web`, `anthropic`, `claudebot`, `openai`, `chatgpt`,
`gpt-crawler`, `perplexitybot`.**

This **narrows** the exposure in one way and **widens** it in another:

- **Narrowed:** nobody is quoted $99 and then charged $49.99 inside the purchase flow. A human who
  reaches the page in a browser sees the real price before paying.
- **Widened:** *every* discovery surface states the wrong price — Google results and rich snippets
  (via the schema.org `offers`), every social link preview, and **every AI assistant that answers
  "how much does Dime AI cost?"** The FAQ answer at `:351` is written in exactly the form an
  assistant will quote verbatim.

So the correct characterisation is not "customers are being overcharged" — it is **"every published
and machine-readable statement of Dime's price is wrong, including the ones Dime does not control
once indexed."**

## Why this is contested, and why it is worse than a copy bug

Three things compound:

1. **Every indexed, previewed, and AI-answered surface states roughly double the real price.** Pro
   reads $99 where checkout charges $49.99.
2. **The prerender's checkout links use plan slugs that do not exist.** It links
   `/checkout?plan=pro|sharp|operator`; the real plan ids are `dime-pro|dime-sharp|dime-max`, and
   **"Operator" is not a tier at all** — it was renamed Max. So the bot-facing page advertises a
   product that cannot be bought at a price that is not charged.
3. **Structured price data misstating price is the one category the HONESTY LAW exists to prevent**,
   and it is the category search engines act on. It is also the category most exposed to a
   consumer-protection complaint, in a regulated vertical, on marketing surfaces that must already
   carry 21+ and 1-800-GAMBLER.

The genuine judgment call is **not** "should this be fixed" — it is **which direction**. Set B is a
richer, better-converting page (a free-preview tier, a Founder tier, per-day framing, an FAQ) that
the React page does not have. Someone deliberately built it. Reconciling downward to Set A discards
that work; reconciling upward is a **price increase** to real customers.

## Options

### Option 1 — Reconcile everything to Set A (live checkout is truth) ✅ RECOMMENDED
Make `landing-content.ts` `TIERS` the single source. Generate the prerender's pricing table, its
schema.org offers, and its FAQ answer **from `TIERS` at build time** rather than hand-maintaining a
second copy. Rewrite the objections block to the real numbers and tiers. Update the HONESTY LAW
header to match. Delete the `Operator` references or re-map them to `Max`.

- **Pros:** the only option where no customer is quoted a price Dime does not charge · removes the
  entire duplicate-copy failure mode permanently rather than resyncing it once · no revenue change ·
  no customer communication needed · directly closes gap **F6** (a stated rule with no verification)
- **Cons:** loses the Free Preview and Founder tiers from the indexed page unless they are added to
  `TIERS` · a search-visible price drop from $99 → $49.99 may briefly look like a discount
- **Effort:** S · **Risk:** low
- **Doctrine fit:** strongest. D6 — one artifact, one truth, generated not duplicated.

### Option 2 — Reconcile everything to Set B (raise prices to $99/$249/$499)
Change `TIERS` and the Stripe price ids to match the indexed page.

- **Pros:** keeps the indexed page and its SEO intact · larger revenue per customer · matches the
  HONESTY LAW whitelist as written
- **Cons:** **this is a real price increase on live customers** and needs grandfathering, Stripe
  price migration, and customer comms · "Operator" would have to be un-renamed or Max re-priced ·
  it lets a stale artifact dictate company pricing, which is backwards
- **Effort:** L · **Risk:** high (billing migration + churn)
- **Doctrine fit:** weak. Pricing should be a founder decision, not an inherited copy artifact.

### Option 3 — Delete the prerender pricing block; keep only the SPA as the pricing surface
Strip the pricing table, the schema.org `offers`, and the pricing FAQ from `landingPrerender.ts`,
leaving positioning and responsible-gaming copy. Fix the objections block.

- **Pros:** fastest path to "no false price is published anywhere" (single deletion) · zero
  duplication risk by construction
- **Cons:** loses rich-result eligibility for pricing · crawlers see no price at all, which is worse
  for conversion than a correct price · does not fix the objections block or the stale whitelist on
  its own
- **Effort:** XS · **Risk:** low
- **Doctrine fit:** adequate but incomplete — it removes the symptom, not the duplication.

## Recommendation

**Option 1 — reconcile to Set A, and generate the prerender from `TIERS` rather than resyncing it.**

Set A is what the payment processor actually charges; every other number is a claim Dime cannot
honour at checkout. That is precisely the standard already applied in this same file, where
`CREDITS_NOTE` is set `show: false` with the comment *"Advertising a monthly allowance the code never
provisions is a claim we cannot honour at checkout (audit PROD-001)."* **The precedent is Prez's own
and it points at Option 1.**

Reconciling by hand would fix it once; the same drift recurs the next time tiers change. Generating
the prerender's pricing from `TIERS` makes the duplication structurally impossible.

**Grafted from the runners-up:**
- From Option 3 — if generation cannot land quickly, **delete the prerender price block immediately
  as a stopgap.** A missing price is not a false price. Do this first if Option 1 will take more than
  a day.
- From Option 2 — the Free Preview and Founder tiers are genuinely good. Add them to `TIERS` as
  non-checkout entries (`action: {type:"scroll"}` and `{type:"apply"}`, both of which the `Tier` type
  already supports at `:289`) so they survive into the generated page.

**Also in scope, because it is the same defect class:** the HONESTY LAW whitelist must become
executable. Today it is a header comment with no enforcement — which is how this shipped. Add a
vitest assertion that every price string rendered in the prerender is derived from `TIERS`, and that
no tier name appears in copy that is absent from `TIERS`. That converts a convention into a gate and
closes **F6**.

## Requested ruling

> **Prez: confirm that live checkout prices ($49.99 / $99.99 / $199.99, tiers Pro / Sharp / Max) are
> canonical, and authorize reconciling the prerender, the schema.org offers, the FAQ answer, the
> objections block, and the HONESTY LAW header to them — with the prerender pricing generated from
> `TIERS` rather than hand-maintained.**

**A yes commits you to:** no price change for customers; the indexed page showing $49.99 instead of
$99; the "Operator" tier name disappearing from all public copy; and a new required test asserting
prerender-vs-`TIERS` price parity.

**A no means** you intend to raise prices to $99/$249/$499 — which is Option 2 and needs its own
Stripe migration and grandfathering plan. Say so and I will write that plan instead.

**Either way, tell me whether to ship the Option-3 stopgap (delete the prerender price block) today**,
because until one of these lands, a false price is being served to crawlers and to any visitor the
prerender reaches.

## Depends on

Nothing. This is independently shippable and should not wait for the rest of the mission.

## Open unknowns

- Whether any customer has actually been quoted $99 for Pro and converted at $49.99 — resolvable
  from Stripe session history, but a read only Prez should authorise.
- Whether the prerender is served to real human visitors or only to crawlers — `vite.ts:48,112`
  gates on user-agent; the exact match list should be read before estimating human exposure.
- `landingPrerender.ts:384` also claims **"124 enforcement tests"**. The Stage 1 audit counted 14
  landing test cases / 38 assertions. That number is in the whitelist too and is likely a third
  unverified claim — it needs its own count before the whitelist is re-blessed.
