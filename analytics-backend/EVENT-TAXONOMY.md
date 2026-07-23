# Dime AI — Complete Event & Action Taxonomy + Measurement Strategy

Grounded in the **actual** released product (not invented features). This is the spec the
instrumentation builds against. Guardrails from the owner directive hold throughout:
**active-user = value events only** (a login/page-view never makes someone "active"); **no
wager amounts / losses / chat text / PII** in any event; **power-user ranking never uses
betting signals**.

Verified surfaces (evidence): panes = `chat` (Dime Chat), `feed` (AI Model Projections),
`splits` (Betting Splits & Odds History), `trends` (Trends), `tracker` (Bet Tracker). Real
actions include: `ai.chat` / `dimeChats.*` (send/new/star/archive/delete), `favorites.toggle`,
projection expand + feed filter/sort/date-nav, `betTracker.create/update/delete`, Stripe
checkout + `cancelSubscription`/reactivate, Discord linking, `login`/`logout`.

---

## 1. Why we measure (product-vision / product-strategy)

Dime AI is an **engagement-and-retention product**: value compounds when a user forms a habit
of consulting the model and acting on it. The measurement system exists to answer, with
evidence, the ten owner questions — collapsed to five decisions:
**(1)** who gets real value and how often, **(2)** what they do and where they spend time,
**(3)** which features earn promotion vs repair, **(4)** who the power users are (and who to
talk to), **(5)** which usage drives paid retention.

**North Star:** *Weekly Users with ≥1 Repeat Value Event* — distinct eligible users who got
value in 2+ distinct days this week. It captures habit (frequency) × value (not vanity) and
leads revenue. Everything below is an **input** to it.

## 2. Metric constellation (metrics-dashboard)

| Group | Metrics | Fed by |
|---|---|---|
| **Activation** | activation rate, time-to-first-value, first→second value gap | value events + `login` |
| **Engagement** | DAU/WAU/MAU (value-based), **total active screen time**, **screen time per page**, sessions/user, return cadence | session + navigation events |
| **Actions** | **total # actions**, **total unique actions**, most-used actions | `action_performed` |
| **Retention** | D1/D7/D30, W1/W4, signup- & activation-cohort curves, paid retention | value events + billing |
| **Feature value** | adoption, completion, repeat use, friction, **most-important features** | feature lifecycle |
| **Power users** | transparent composite score, leaderboards | all of the above |
| **Monetization** | paywall→checkout conversion, churn precursors, paid-vs-free usage | billing + usage |
| **Identity** | **last sign in** | `login` |

## 3. Customer journey → events (customer-journey-map)

| Stage | User is… | Instrumented by |
|---|---|---|
| **Discover** | on landing/pricing | `pricing_viewed`, `paywall_viewed` |
| **Activate** | first login → first value | `login`, `session_started`, first value event (TTFV) |
| **Habit** | returning, browsing panes | `session_*`, `screen_viewed`, `action_performed`, return cadence |
| **Value** | repeatedly acting on the model | value events, feature completion |
| **Retain/Expand** | paying, sticking | billing events, paid retention, Discord link |
| **Advocate** | high-signal / referable | power-user score → research/founder queues |

---

## 4. THE TAXONOMY (every trackable thing, grounded)

All events share the envelope (event_id, schema_version, source_user_id [server-derived],
session_id, tab_id, **route**, surface, occurred/received_at, environment, app_version,
is_test, allowlisted props). `qualifies_active` = counts toward the value-based active-user
metric.

### 4a. Session / engagement — *total active screen time*
| event | trigger (real) | qualifies_active | key props | feeds |
|---|---|---|---|---|
| `session_started` | authenticated app open (foreground) | no | — | sessions, engagement |
| `session_heartbeat` | ~30s while **visible + not idle** | no | route | **total active screen time** |
| `session_ended` | logout / pagehide / 30-min idle | no | reason | session duration |

### 4b. Navigation — *screen time per page, where time goes*
| event | trigger | qualifies_active | key props | feeds |
|---|---|---|---|---|
| `screen_viewed` | every route/pane change | no | route, pane, from_route | **per-page screen time** (Δ to next view, foreground only), time distribution |

### 4c. Actions — `action_performed { action_name }` — *total & unique actions*
Allowlist (curated, meaningful — **not** raw clicks/scrolls):
- **Chat:** `chat_message_sent`, `chat_started`, `chat_starred`, `chat_archived`, `chat_deleted`
- **Feed:** `projection_opened`, `projection_favorited`, `feed_filtered`, `feed_sport_switched`, `feed_date_navigated`
- **Splits/Trends:** `splits_sorted`, `splits_filtered`, `splits_date_navigated`, `trends_opened`
- **Tracker:** `bet_added`, `bet_edited`, `bet_deleted`, `bet_edit_requested`
- **Global:** `pane_switched`, `search_performed`, `resources_opened`, `account_opened`, `profile_opened`

→ **total actions** = COUNT; **unique actions** = COUNT(DISTINCT action_name); most-used = top-N.

### 4d. Feature lifecycle — *most-important features / friction*
| event | trigger | props | feeds |
|---|---|---|---|
| `feature_opened` | pane/feature entered | feature_id | adoption |
| `feature_completed` | feature's core task done | feature_id, outcome | task success, importance |
| `feature_failed` | error/empty/insufficient-data | feature_id, error_class | friction/repair |

### 4e. Value events (qualifies_active) — *the honest "active" numerator*
| event | trigger | notes |
|---|---|---|
| `projection_evaluation_viewed` | a **complete, trustworthy** projection rendered | not a mere feed load |
| `chat_response_completed` | a Dime Chat answer finished successfully | stream `done` |
| `tracker_entry_saved` | a real (non-duplicate) bet saved | ✅ **built** (Bet Tracker) |

### 4f. Auth — *last sign in*
`login` (server-authoritative → **last sign in**, new-vs-returning) · `logout`.

### 4g. Monetization (business-model / gtm-strategy)
`pricing_viewed`, `paywall_viewed`, `checkout_started`, `checkout_completed` (server/Stripe-webhook
authoritative), `subscription_cancelled`, `subscription_reactivated`. → conversion funnel, churn
precursors, paid-vs-free usage.

---

## 5. Power users & ICP (ideal-customer-profile)
Transparent composite (every component shown; normalized by tenure + feature exposure):
`score = w1·active_days_30d + w2·distinct_value_events + w3·feature_breadth + w4·repeat_value_rate + w5·engaged_minutes`.
**Never** wager amounts / frequency / stakes / losses. Power users → refine the **ICP** (who
gets the most value) → feed the **Research Queue** (learn from them) and **Founder Conversation
Queue** (consented, eligible only) — kept independent, no fabricated candidates.

## 6. Growth loops (growth-loops) — measure each loop's health
- **Activation loop:** signup → first value → habit — activation rate, TTFV.
- **Habit loop:** session → value → return — return cadence, active days/week.
- **Retention/monetization loop:** repeated value → paid retention — paid retention, churn.
- **Community loop:** Discord link → engagement lift — engagement of linked vs unlinked.

## 7. Value proposition (value-proposition)
Core promise ≈ "AI model projections that give you an edge." The chain that **proves** it:
`projection_evaluation_viewed` → `bet_added` (acted on it) → returns next day → paid retention.
If that chain is weak, the value prop isn't landing — the taxonomy makes it measurable.

---

## 8. Build priority (prioritize-features — impact × effort)
- **P0 (most metrics, moderate effort):** `session_*` + `screen_viewed` + the 3 value events + `login`.
  → screen time (total + per page), where-time-goes, active users, TTFV, **last sign in**.
- **P1:** `action_performed` allowlist + feature lifecycle → **total/unique actions**, feature importance.
- **P2:** monetization events + **power-user score** + research/founder queues.

## 9. Roadmap (pm-roadmap) + build/verify plan (sp-plan → execute → verify → finish)
| Phase | Delivers | Status |
|---|---|---|
| A | pipeline + role + ingest + 1 emitter (`tracker_entry_saved`) | ✅ done (Steps 1–3) |
| B | **read path** + minimal dashboard (prove loop end-to-end) | next (Step 4) |
| C | schema `route`/`duration` + central instrumentation → **P0 events** | Step 5 |
| D | aggregations → screen time, active time, last sign-in | Step 6 |
| E | **P1** action allowlist + feature lifecycle | Step 7 |
| F | **P2** monetization + power-user score + queues | Step 8 |
| — | deploy + Railway vars + **excluded canary** each phase | you own Railway; I guide |

Every phase: `sp-plan` the slice → `sp-execute` on the branch (no deploy) → `sp-verify`
(tsc/tests/build + evidence) → `sp-finish`. Nothing goes live without your authorization and a
green excluded-canary.
