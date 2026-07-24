# User Activity → Customer Profiling Infrastructure — Master Plan

> Scope: turn `/admin/activity` from a metrics dashboard into the platform's strongest
> customer-profiling system. Answers, with accurate per-user data: **who uses what**,
> **who our power users are**, **which features are strongest**, **what to prioritize**,
> **how to retain**, **how to become the go-to AI sports betting platform**, **what to cut**.
>
> This plan integrates: product-vision, product-strategy, ideal-customer-profile,
> customer-journey-map, growth-loops, gtm-strategy, marketing-ideas, brainstorm-ideas
> (new/existing), brainstorm-experiments (new/existing), ui-ux-pro-max, apple-design,
> ui-design-asset, stop-slop. Pipeline state: D0–D3 live and verified in production
> (device-aware events flowing; `projection_opened`, `feed_date_navigated` recorded;
> value users and device mix rendering).

---

## 0. Where we are (verified live)

- **Base:** 78 accounts, 77 Discord-linked, 76 lifetime / 1 recurring / 1 no-access. 7 DAU / 24 MAU.
- **Events flowing:** VALUE (`projection_evaluation_viewed`, `chat_response_completed`, `tracker_entry_saved`); ENGAGEMENT (`session_started`, `screen_viewed`, `login`); ACTION_PERFORMED (17-name allowlist across chat/feed/splits/tracker); FEATURE lifecycle. Every event carries `source_user_id` (pseudonymous), `session_id`, `device_type`/`os_family`/`browser_family`, `route`, `occurred_at_utc`, `is_test`.
- **Read/UI today:** global aggregates only — DAU/WAU/MAU value users, value events, total/unique/top actions, device mix.
- **The gap:** everything today is *global*. Profiling requires *per-user* resolution, *identity*, *cohorts*, and *segments*. Sections 6–8 below are the engineering spine that unlocks the strategy in Sections 1–5.

**Problem framing (product-strategy):** acquisition is solved. The constraint is **depth and habit** — converting a lifetime-access base into daily loyalists. Profiling data is the instrument that tells us which surface earns habit for which bettor, and which surfaces are dead weight.

---

## 1. Product Vision & Strategy

**Vision.** *Turn every tap a bettor makes into a living portrait of how they hunt edges — so Dime knows each user's game before they do, and meets them there.* The User Activity page becomes Dime's **customer graph**: a per-user, device-aware profile fusing which surfaces a bettor lives in (feed, chat, splits, tracker), how deeply, on what cadence, and where they drop off. It enables (a) segment-targeted product decisions over gut calls, (b) lifecycle intervention that catches a cooling power user *before* churn, (c) per-segment personalization, and (d) a behavioral data moat no competitor with anonymous accounts can copy.

**North Star Metric:** weekly **Active Edge-Takers** — distinct users with ≥1 VALUE event in the week. **OMTM this quarter:** feed→tracker session co-occurrence rate.

**Strategic bets** (each with a win condition and a signal already in our taxonomy):

| Bet | Win condition | Proof signal |
|---|---|---|
| **A. Feed→Tracker is the core habit** | opens convert to logged bets, rising | session co-occurrence `projection_opened → tracker_entry_saved` > 30% of feed sessions |
| **B. Chat is the retention multiplier** | chat users out-retain non-chat | 4-wk return of users with ≥1 `chat_response_completed` vs. without ≥ +15pp |
| **C. MLB depth over surface breadth** | fewer, deeper surfaces beat sprawl | per-surface `feature_completed`/`feature_failed` + action volume identifies cuts; DAU flat as surface count drops |
| **D. Lifetime → recurring** | power-user density rises among 76 lifetime | count crossing the power-user threshold MoM grows → upsell test |
| **E. Kill silent churn** | at-risk users re-activate post-nudge | trailing-14-day `session_started` gap flips back to active |

**Trade-offs:** no new sports until MLB depth proves the loop; deprioritize any surface with high `feature_failed` and near-zero actions across segments (candidate: Splits).

---

## 2. Ideal Customer Profile & Segments

**ICP:** the **serious recreational MLB bettor, Discord-native, multi-session/week**, who trusts model edges enough to log real bets and returns to check results. JTBD: *"When a slate drops, help me find and validate the highest-edge bets fast, and remember what I did."* **Ideal-of-ideal:** a daily-active user firing all three VALUE events weekly — our upsell and case-study core.

**Segment taxonomy — every segment computable from live events** (weekly window unless noted):

| Segment | Identifying signal (from our events) |
|---|---|
| **Whale / Power Bettor** | active ≥4 days AND ≥3 of 4 surfaces AND ≥12 `projection_opened` AND ≥3 `tracker_entry_saved` |
| **Model-Truster** | ≥10 `projection_opened` + ≥2 `projection_favorited` + `projection_evaluation_viewed`, `chat_message_sent` < 2 |
| **Chat-Native** | ≥15 `chat_message_sent` + `chat_response_completed` + ≥1 `chat_starred`, `projection_opened` < 3 |
| **Tracker-Diligent** | ≥3 `tracker_entry_saved` across ≥2 sessions + ≥1 `bet_edited`, sustained ≥3 weeks |
| **Splits-Scanner** | ≥6 splits actions but 0 VALUE events — consumes public money, doesn't commit |
| **Casual Dabbler** | 1–3 active days, < 5 actions/session, single surface, ≥1 VALUE, no multi-week streak |
| **Lurker / At-Risk** | *Lurker:* sessions + screen views, ~0 actions, 0 VALUE over 14d. *At-Risk:* was VALUE-active, now 0 sessions in 14d **or** VALUE down > 60% WoW |

Migration *between* segments (Dabbler→Model-Truster, Whale→At-Risk) is itself the highest-value profiling signal and drives the lifecycle plays in §4.

---

## 3. Profiling Engine (the math)

### 3.1 Customer Journey Map

Surface derivation used throughout: `feed` = route `/feed%` or action `projection_*`/`feed_*`; `chat` = `/chat%` or `chat_*`; `splits` = `/splits%` or `splits_*`; `tracker` = `/tracker%`, `bet_*`, or `tracker_entry_saved`.

| Stage | Instrumenting event(s) | Advance when… | Drop-off signal | Health metric |
|---|---|---|---|---|
| **Discover** | first `login`/`session_started` | ≥1 action AND ≥1 VALUE within 24h | session with only `screen_viewed` | Discover→Activate rate |
| **Activate** | first `projection_opened`/`chat_message_sent` → first VALUE | ≥1 VALUE on ≥2 distinct days | activated, no 7d return | TTV = median(first login → first VALUE) |
| **Habituate** | recurring sessions across days | active ≥3 distinct days in rolling 7d | active-days declining WoW | D7 return rate |
| **Value** | VALUE volume across surfaces | ≥4 VALUE/wk across ≥2 surfaces incl. ≥1 tracker save | VALUE/wk trending to 0 | VALUE events / active user / wk |
| **Retain** | recurring sessions across weeks | active ≥3 of last 4 weeks | no session in ≥14d | 4-wk rolling retention |
| **Advocate/Refer** | `chat_starred`, `projection_favorited`; Discord link | favorites/stars or Discord invite | 0 stars among retained | favorites/retained user (add native `referral_sent` for true k-factor) |

Aha moment = first `projection_evaluation_viewed` or `chat_response_completed`. Primary churn trigger = the 14-day session gap.

### 3.2 Power-User Score

30-day window per `source_user_id`, `is_test=0`, staff excluded. Six components in [0,1], weights sum to 1:

- **R Recency:** `EXP(-0.099 · days_since_last_active)` (7-day half-life)
- **F Frequency:** `LEAST(active_days / 30, 1)`
- **B Breadth:** `distinct_surfaces / 4`
- **V Value volume:** `LN(1 + value_events) / LN(61)` (log-damped, cap ≈ 60)
- **S Streak:** `LEAST(longest_consecutive_run / 14, 1)`
- **D Depth:** `LEAST((action_events / sessions) / 12, 1)`

**Score = 100 · (0.25R + 0.20F + 0.15B + 0.20V + 0.10S + 0.10D)**

Tiers (recency-gated): `Power ≥70`, `Core 50–69`, `Casual 30–49`, `At-Risk 15–29`; `days_since > 14` caps at At-Risk, `> 30` = Dormant. A user scores high only by being recent, frequent, multi-surface, value-producing, consistent, *and* deep — not from one loud day. Ranking descending answers **"who are our power users"** (expect ~5–10 given 7 DAU / 24 MAU). Reference SQL (window functions + gaps-and-islands streak) lives in the engineering ticket; validated against the live table shape.

### 3.3 Feature-Strength Scorecard

Per surface over window `P`; `A` = distinct active users. Four axes:

- **Adoption** = `users_used(s) / A`
- **Engagement** = `surface_actions(s) / users_used(s)` (min-max normalized across surfaces)
- **Stickiness** = `users on s in P AND P+1 / users on s in P`
- **Value-linkage** = `sessions on s with (or ≤24h before) a VALUE event / sessions on s` (Splits has no native VALUE event → linkage = splits session preceding a `projection_evaluation_viewed`/`tracker_entry_saved`)

**Composite = 100 · (0.25 Adoption + 0.20 Engagement + 0.25 Stickiness + 0.30 Value-linkage)**

**KEEP / INVEST / FIX / CUT quadrant** — X = Adoption (reach), Y = Stickiness × Value-linkage (retained value):

| | Low reach | High reach |
|---|---|---|
| **High value** | **INVEST** (underexposed) | **KEEP** (protect/scale) |
| **Low value** | **CUT** | **FIX** (used, not converting) |

Given live signal: **Feed** = KEEP (opens precede evaluations). **Chat** = KEEP (`chat_response_completed` is first-class value). **Tracker** = INVEST (deep value, thin adoption). **Splits** = CUT candidate (actions ≈ 0, no native value) — confirm with a full window before acting. This answers **"strongest features"** (KEEP, highest composite) and **"what to cut"** (low-reach/low-value).

### 3.4 Which features are used by whom

Recompute the scorecard with `GROUP BY tier, surface` (or `segment, surface`) → a tier × surface matrix. If Power/Core users drive nearly all Feed and Chat value-linkage while Splits is touched only by Casual/At-Risk at near-zero engagement, the CUT decision is both **confirmed and attributed**. Same events, three lenses — stage (where they are), score (how hard they use), scorecard (what they use).

---

## 4. Growth, Retention & GTM

### 4.1 Growth loops (each with its turning signal)

- **A. Value→Habit (core):** slate drops → `projection_evaluation_viewed` → one-tap `tracker_entry_saved` → next-day graded result → pulled back tomorrow. Compounds because logged history is non-portable sunk value. **Signal:** rising weekly `tracker_entry_saved / projection_evaluation_viewed`; D7 login conditioned on holding a graded entry.
- **B. Discord referral/community:** a pick cashes → user posts to Discord → recognition + public proof → peers click → `session_started` with referral attribution. 77/78 linked = zero-cost push. **Signal:** referral-attributed sessions per active user per week.
- **C. Model-trust:** open Model Results/Backtest → transparent ROI raises confidence → more evaluations → more logs → own record validates the model. **Signal:** cohort firing `results_viewed` shows higher 48h `tracker_entry_saved` vs. non-viewers.
- **D. Chat-as-router:** question → DimeChat → `chat_response_completed` surfaces an edge → deep-link into feed card → evaluation/log. **Signal:** chat→value handoff = share of `chat_response_completed` sessions that also fire a VALUE event.

### 4.2 GTM positioning

*For serious 21+ bettors buried in scattered tools and gut-feel picks, Dime AI is the AI decision cockpit that fuses model projections, public splits, and your own tracked results into one graded workflow — unlike touts, tip channels, and static model sites, every edge is backtested, transparent, and measured against the bets you actually logged.*

**Proof metrics, all native to this infrastructure:** (1) auditable model ROI (event-verified `results_viewed`), (2) actionability rate (`projection_evaluation_viewed → tracker_entry_saved`), (3) graded accountability (settled tracker record). Device tags split mobile game-time bettors from desktop researchers; per-user VALUE mix classifies chat-led vs feed-led vs tracker-led for targeting.

### 4.3 Lifecycle plays (cohort-triggered; 21+ · 1-800-GAMBLER on player-facing copy)

| Play | Cohort (from events) | Channel | Success signal |
|---|---|---|---|
| **Win-back at-risk** | ≥3 VALUE prior 30d, then 0 sessions 14d | Discord DM → email | session + evaluation within 72h |
| **Power-user VIP** | top-decile tracker saves + login freq | Discord "Sharp" role + private channel | sustained weekly saves + referrals |
| **Feed→Tracker nudge** | ≥5 evaluations lifetime, 0 tracker saves | in-app card + DM | first `tracker_entry_saved` |
| **Chat activation** | session in 14d, 0 chat completions lifetime | in-app empty-state + DM | first `chat_response_completed` |
| **Lifetime→paid upsell** | lifetime, top engagement + `results_viewed` | email + DM | recurring conversion (grow past 1) |
| **Onboarding-to-habit** | account < 7d, linked, < 2 VALUE | Discord DM sequence | ≥1 tracker save + graded-result view in week 1 |
| **Splits cross-sell** | feed+tracker active, 0 splits actions | in-app + Discord | first splits action + return session |

---

## 5. Ideas & Experiments backlog

### 5.1 Enhance the page (existing-product ideation)
Per-user profile drill-down · drop-off/dead-session finder · feature scorecard · retention cohort grid · path/next-action (Sankey) · segment explorer with saved filters · surface-affinity matrix · power-user leaderboard · funnel builder · real-time stream + anomaly flags · session-quality score · sport-focus profiler.

### 5.2 New bold capabilities (net-new)
Predictive churn score · Discord-identity join → named leaderboard · automatic segment discovery (clustering) · next-best-action per user · gateway-feature finder (retention-lift graph) · LTV/upsell-propensity model · model-trust profiler (evaluate→log ratio).

### 5.3 Experiments on existing events (hypothesis · metric · guardrail)
1. Chat-onboarding → D7 VALUE retention; guardrail session-1 abandonment ≤ +5pp.
2. Feed→Tracker prompt → save rate/feed session; guardrail browse depth steady.
3. Sport-focus default → returning-session VALUE rate; guardrail multi-sport users unharmed.
4. Silent-user Discord nudge → 72h reactivation; guardrail mute/opt-out < 10%.
5. Starred-chat prompt → D14 retention of starrers vs not; guardrail completion steady.
6. Promote search entry → time-to-first-VALUE; guardrail zero-result < 25%.
7. Results-first onboarding → week-1 tracker saves; guardrail onboarding completion steady.

### 5.4 New validation experiments (XYZ hypotheses)
- ≥40% of MAU open ≥4 days/wk with a concierge "daily slate" DM.
- ≥25% same-session `evaluation → tracker save` with no nudge (measure baseline).
- ≥15% of linked-inactive return via a fake-door premium teaser.
- ≥30% of leaderboard top-quartile submit a priced alerts-tier pre-order.
- ≥50% of next 10 signups reach first VALUE in 24h under Wizard-of-Oz onboarding.
- ≥20% of MAU touch ≥3 surfaces (true "platform").

---

## 6. Instrumentation & data-model gaps (what makes it 100% accurate)

The current pipeline answers *global* questions. To answer everything *per user* we add:

1. **Per-user aggregates in the read layer.** `read.ts` emits only global counts today. Add per-user rollups (score inputs, surface breakdown, VALUE counts) so Segments, leaderboard, and profiles render. No new events.
2. **Identity via read-time join — privacy-preserving.** Keep the analytics store **pseudonymous** (owner directive: no PII in MySQL: Dime AI). Enrich at **read time** on the web/forwarder instance, which has product-DB (`app_users`) access: `source_user_id → {discord_handle, discord_id, membership_tier, role, created_at}`. Named leaderboards, cohort dates, tier filters, and staff exclusion — with **no PII moved into the analytics DB**. Owner-only surface.
3. **Cohort / first-seen** from `app_users.created_at` via the join (retention grid, onboarding funnels).
4. **Staff exclusion** — exclude `role IN (owner, admin)` at read time. The owner (id=1) currently inflates value-user counts; complements the `is_test` canary.
5. **Two new action names** the growth model needs but the allowlist lacks — a backward-compatible **D3.1 contract bump** (still inert):
   - `results_viewed` — Model Results/Backtest opened (powers the model-trust loop + GTM auditability proof).
   - `referral_landed` — session arrived via a Discord referral (powers Loop B k-factor).
6. **Derived rollups** — nightly per-user power-score, feature-scorecard, and retention-cohort tables computed on the store, so the admin page stays fast as data grows.
7. **Session-quality classification** — bounce/browse/value/power from per-session event composition (we already carry `session_id`).

**Architecture note (identity join):** the back office returns pseudonymous aggregates + per-user rows keyed by `source_user_id`; the web forwarder joins those ids to `app_users` for display only, in the owner-only view. This preserves the pseudonymous store while enabling names, tiers, and cohorts.

---

## 7. Cockpit design (IA + components)

Single scrolling column → **left rail + tabbed workspace** with a sticky global filter bar (date range, membership, device, segment). Dime brand law throughout: `#000` base → `#0A0A0A` cards → hairline `#262626`, one-accent mint `#45E0A8`, Familjen Grotesk + IBM Plex Mono, 160ms motion, mono tabular numerals, no gradients/shadows-heavy.

**Tabs:** Overview (today's platform metrics + segment-distribution strip + value-user sparkline) · Segments (cohort table + chip filmstrip + size treemap) · Power Users (leaderboard + score-distribution histogram) · Feature Scorecard (4×4 grid + KEEP/INVEST/FIX/CUT quadrant) · Journeys & Funnels (configurable funnel + stage table + drop-off callouts) · Retention (weekly cohort grid + curve overlay) · Device & Tech (current device-aware widgets) · **Per-User Profile = a drawer** (opens over any table row).

**Marquee components:** (a) Segment/cohort table — virtualized, sortable (`aria-sort`), segment chips, mini surface bars, honest `—` for not-measured (never a fake 0). (b) Per-user profile drawer — Discord identity join, score + segment + journey-stage pill, surface breakdown bars, event timeline, device; slide-in, interruptible, Esc to dismiss. (c) Feature scorecard grid — mint-opacity cells + mono numerals, quadrant scatter with position+label (never color-only). (d) Retention cohort grid — **stepped mint-opacity heat on `#0A0A0A`** (no rainbow), mono % in every cell, horizontal scroll inside its own container. (e) Power-user leaderboard — rank, handle, segment, score with under-bar; row → drawer. (f) Funnel — aligned full-width bars (not a tapering ribbon) for exact comparison.

**Motion (apple-design):** 160ms, ease-out in / faster ease-in out; animate only bar/heat fills, tab crossfade, drawer slide (interruptible); critically damped (no bounce — analytical, not playful); depth via hairline + `#0A0A0A` layering, not heavy shadows; full `prefers-reduced-motion` / `prefers-reduced-transparency` fallbacks.

**Heat rule (accessibility-safe):** single-hue mint ramp quantized to ~6 opacity steps on `#0A0A0A`; every cell pairs the step with a mono numeral (never color-only); numeral flips dark on high-opacity mint for contrast; one legend, one meaning system-wide (scorecard, score bars, funnel, retention all share the ramp).

---

## 8. Prioritized roadmap (RICE-informed)

RICE adapted for an internal profiling tool: **Reach** = how many of the 8 owner questions it answers × decision cadence; **Impact** = decision leverage; **Confidence**; **Effort**.

**P0 — Data spine (unlocks everything).** Per-user aggregates in `read.ts`; read-time identity join (source_user_id → app_users); staff exclusion; add `results_viewed` + `referral_landed` to the allowlist (D3.1). *Ships inert-compatible; no user-facing change.* **Highest RICE — every downstream item depends on it.**

**P1 — Cockpit MVP (the profiling answer).** Tabbed IA; Segments table + segment computation; Power-User leaderboard + score; Per-User Profile drawer; Feature Scorecard + quadrant. **Directly answers: who uses what · power users · strongest features · what to cut.**

**P2 — Retention & funnels.** Retention cohort grid; Journey funnel builder; drop-off/dead-session finder; path/next-action. **Answers: how to retain · what to prioritize.**

**P3 — Intelligence & activation.** Predictive churn score; segment auto-discovery (clustering); next-best-action; LTV/upsell propensity; wire lifecycle plays to Discord/email triggers. **Answers: keep people on the app · become the go-to platform.**

**Success metrics for the infrastructure itself:** (1) every owner question answerable from the page without SQL; (2) power-user cohort named and interviewable (Discord join); (3) at least one feature CUT/INVEST decision made from the scorecard within 30 days; (4) one lifecycle play (win-back at-risk) live and measured by P3.

**Guardrails carried from D0–D3:** server-gated + inert until enabled; no PII in the analytics store; honest states (never a fabricated 0); bundle budget respected on any client additions; staff/test traffic excluded from real metrics.

---

## 9. Immediate next step

Build **P0** (data spine) first — it is the prerequisite for all profiling and ships without user-facing risk. Recommended first ticket: per-user aggregate query + read-time identity join + staff exclusion, behind the existing owner-only `analytics.overview` surface, with `results_viewed` + `referral_landed` added to the allowlist.
