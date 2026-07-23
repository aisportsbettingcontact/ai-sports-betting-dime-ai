# Dime AI — Exhaustive Event Catalog (device-aware, 100× granular)

Companion to `EVENT-TAXONOMY.md` (which holds the *strategy*: North Star, metric
constellation, journey, power-user model). **This** doc is the *catalog*: every trackable
event on every real surface — desktop **and** the distinct mobile shell — with a
**device/platform dimension on every single event**, and rich per-event analytical
dimensions.

> **Grounded, not invented.** Every event below maps to a surface that exists in this repo:
> desktop routes in `client/src/App.tsx`, the mobile shell in
> `client/src/features/mobileNav/` (`/m/feed|splits|chat|props|profile` + Bet Tracker), the
> 768 px device boundary in `client/src/pages/dime-shell/breakpoints.ts`, and the existing
> `MobileNavEvent` vocabulary in `mobileNav/config.ts`. Nothing here assumes a feature the
> product does not ship.

**Guardrails (unchanged, enforced at ingest):** active-user = **value events only** (a login,
a page view, a heartbeat never makes anyone "active"); **no** wager amounts / losses / stakes /
chat text / prompts / model responses / payment data / credentials / raw URLs-with-ids / PII in
any event; **power-user ranking never uses betting signals**. Props are allowlisted scalars,
capped (20 keys / 256 chars), validated against `analytics_event_definitions`.

**Resolved open decisions (this catalog assumes them):**
1. **Curated allowlist, exhaustively enumerated** — we track a large, named set of *meaningful*
   actions (below), **not** literally every click/scroll/mousemove. "100× granular" = breadth of
   named actions + a device dimension on all of them, **not** raw-DOM capture.
2. **Two-layer metrics** — `qualifies_active` stays value-events-only; screen-time, action
   counts, and device mix are **engagement diagnostics** that never inflate the active numerator.
3. **Guardrails hold** — nothing below stores a betting signal or PII; device fields are coarse
   buckets, never fingerprints.

---

## 1. The universal envelope — now device-aware (applies to EVERY event)

Every event carries the base envelope **plus** the device block. The device block is what makes
"capture mobile, desktop, or tablet for all tasks/actions" true across the whole catalog — no
event is device-blind.

### 1a. Base envelope (existing)
`event_id` (idempotency key) · `event_name` · `schema_version` · `definition_version` ·
`source_user_id` *(server-derived, authoritative)* · `session_id` · `tab_id` · `feature_id` ·
`surface` · `outcome` · `occurred_at_utc` *(client)* · `received_at_utc` *(server, authoritative)* ·
`environment` · `app_version` · `is_test` · `props_json` *(allowlisted scalars)*.

### 1b. Device / platform block (NEW — on every event)

| field | values (coarse buckets) | who sets it | why it's honest |
|---|---|---|---|
| `device_type` | `mobile` \| `tablet` \| `desktop` | **server-authoritative** from `User-Agent`, **reconciled** with client `viewport_class` + `pointer_type` | UA distinguishes tablet↔mobile↔desktop; viewport alone can't (a narrow desktop window ≠ a phone). Conflicts logged, server wins. |
| `os_family` | `ios` \| `ipados` \| `android` \| `macos` \| `windows` \| `linux` \| `other` | server (UA) | coarse family only — never version fingerprint |
| `browser_family` | `safari` \| `chrome` \| `firefox` \| `edge` \| `samsung` \| `other` | server (UA) | coarse family only |
| `app_surface` | `web-desktop-shell` \| `web-mobile-shell` \| `web-responsive` | client (which shell mounted: `DimeAppShell` vs `MobileNavShell` `/m/*`) | tells apart "phone on `/m/*`" vs "phone hitting the responsive desktop route" |
| `viewport_class` | `xs` (<480) \| `sm` (480–767) \| `md` (768–1023) \| `lg` (1024–1439) \| `xl` (≥1440) | client (bucketed at the 768/1024 matchMedia boundaries) | bucket, never raw px → not a fingerprint |
| `orientation` | `portrait` \| `landscape` | client (matchMedia) | mobile/tablet ergonomics |
| `is_touch` | bool | client (`pointer: coarse` / touch points) | separates touch from mouse use |
| `pointer_type` | `fine` \| `coarse` \| `none` | client (matchMedia `pointer`) | cross-checks `device_type` |
| `is_standalone` | bool | client (`display-mode: standalone`) | PWA / home-screen install adoption |
| `connection_class` | `slow-2g` \| `2g` \| `3g` \| `4g` \| `unknown` | client (`navigator.connection.effectiveType`, when present) | perf segmentation; absent ⇒ `unknown`, never guessed |
| `dpr_bucket` | `1x` \| `2x` \| `3x+` | client (`devicePixelRatio` bucketed) | retina/hi-dpi share (bucketed) |

**Device resolution rule (server):** `device_type` is derived from the UA server-side (never
trusted from the client). The client-reported `viewport_class`/`pointer_type`/`is_touch` are a
**cross-check**, applied narrowly: the ONLY case that reclassifies is the well-known
**iPadOS-as-Mac** signature — `os_family === "macos"` **and** a coarse pointer — which upgrades
`desktop` to `tablet` (or `mobile` for a phone viewport). Every other desktop-UA-but-touch device
(Windows touchscreen laptops, ChromeOS convertibles) **stays `desktop`** and is merely flagged
with `props.device_conflict=true` for data-quality review — never reclassified. This keeps
**tablet** a real, separable category rather than "big phone / small laptop" without polluting it
with touch laptops. `route` is likewise re-collapsed to a pattern server-side (never trusting the
client's value), so ids/tokens/dates cannot leak into the store.

**Every metric in this catalog is sliceable by `device_type` (and by `app_surface`, `os_family`).**
That is the point of the block: *screen time per page* becomes *screen time per page per device*;
*power users* can be *mobile-first power users*; *most-important features* can be *most-important on
mobile vs desktop*.

---

## 2. Schema deltas required for this catalog

`analytics_events` today has no device/route/action columns. To land this catalog, add (additive,
back-compatible; bump `definition_version`):

```sql
ALTER TABLE analytics_events
  ADD COLUMN route            VARCHAR(96)  NULL,   -- pattern, e.g. '/feed/model/:sport' — NEVER raw ids
  ADD COLUMN action_name      VARCHAR(64)  NULL,   -- for action_performed family
  ADD COLUMN object_type      VARCHAR(32)  NULL,   -- 'projection' | 'chat' | 'bet' | 'split' | ...
  ADD COLUMN sport            VARCHAR(16)  NULL,    -- 'mlb' | 'nba' | 'nhl' | 'wc' | NULL
  ADD COLUMN device_type      VARCHAR(12)  NULL,   -- 'mobile' | 'tablet' | 'desktop'
  ADD COLUMN os_family        VARCHAR(16)  NULL,
  ADD COLUMN browser_family   VARCHAR(16)  NULL,
  ADD COLUMN app_surface      VARCHAR(24)  NULL,   -- 'web-desktop-shell' | 'web-mobile-shell' | 'web-responsive'
  ADD COLUMN viewport_class   VARCHAR(8)   NULL,
  ADD COLUMN orientation      VARCHAR(10)  NULL,
  ADD COLUMN is_touch         TINYINT(1)   NULL,
  ADD COLUMN is_standalone    TINYINT(1)   NULL,
  ADD COLUMN connection_class VARCHAR(12)  NULL,
  ADD COLUMN latency_ms       INT          NULL,   -- for *_completed / *_failed timing
  ADD KEY idx_device_time  (device_type, occurred_at_utc),
  ADD KEY idx_route_time   (route, occurred_at_utc),
  ADD KEY idx_action_time  (action_name, occurred_at_utc),
  ADD KEY idx_surface_dev  (app_surface, device_type);
```

Plus a rebuildable daily rollup keyed by device, so device slices don't table-scan raw events:

```sql
CREATE TABLE IF NOT EXISTS analytics_device_day (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  day_utc DATE NOT NULL,
  source_user_id BIGINT NOT NULL,
  device_type VARCHAR(12) NOT NULL,
  app_surface VARCHAR(24) NOT NULL,
  engaged_ms BIGINT NOT NULL DEFAULT 0,       -- foreground, non-idle
  actions INT NOT NULL DEFAULT 0,
  distinct_actions INT NOT NULL DEFAULT 0,
  qualifying_events INT NOT NULL DEFAULT 0,
  definition_version INT NOT NULL,
  UNIQUE KEY uq_user_device_day (day_utc, source_user_id, device_type, app_surface, definition_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`route` is always a **path pattern** (`/feed/model/:sport`, `/mlb/team/:slug`), never a raw URL
with ids — that keeps it low-cardinality and PII-free.

---

## 3. Event families (exhaustive)

Legend — **Q** = `qualifies_active` (value event). **Dev** = which device variants emit it. Every
event also carries the full §1b device block; the "device notes" column calls out where the
*mobile* emission differs from *desktop*.

### 3.0 Lifecycle & session — *total active screen time* (per device)
| event | trigger (real) | Q | key props | device notes |
|---|---|---|---|---|
| `app_booted` | first authenticated shell mount in a tab | no | cold_start, from_pwa | `app_surface` distinguishes `/m/*` boot from desktop boot |
| `session_started` | authenticated foreground open | no | entry_route | device block captures the device the session runs on |
| `session_heartbeat` | ~30 s while **visible + not idle** | no | route | primary feed for **active screen time**, split by `device_type` |
| `session_paused` | tab hidden / blur / app backgrounded | no | reason | mobile: `visibilitychange` on backgrounding |
| `session_resumed` | tab visible again / foregrounded | no | gap_ms_bucket | mobile foreground return |
| `session_ended` | logout / pagehide / 30-min idle | no | reason, duration_bucket | `sendBeacon` on mobile unload (best-effort) |
| `device_context_captured` | once per session, on first heartbeat | no | *(full §1b block)* | the canonical device snapshot for the session |
| `device_switched` | same user, new `device_type` vs their last session | no | from_device, to_device | derived server-side; powers cross-device analysis |

### 3.1 Navigation & screen-time — *screen time per page, where time goes* (per device)
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `screen_viewed` | every route/pane change (foreground) | no | route, pane, from_route | Δ-to-next-view = per-page dwell, sliced by `device_type` |
| `pane_switched` | in-shell pane change (chat↔feed↔splits↔tracker) | no | from_pane, to_pane | desktop shell panes **and** mobile floating-nav tabs |
| `tab_tapped` | mobile floating-nav tab tap | no | tab_id | **mobile-only** (`MobileNavEvent.tab_tapped`) |
| `tab_changed` | mobile active-tab commit | no | from_tab, to_tab | **mobile-only** (`MobileNavEvent.tab_changed`) |
| `shell_mounted` / `shell_unmounted` | mobile nav shell lifecycle | no | — | **mobile-only** (`MobileNavEvent`) |
| `nav_opened` / `nav_closed` | desktop drawer / settings nav toggled | no | which | desktop drawer vs mobile pill |
| `deep_link_opened` | arrival via shared/canonical URL | no | route, referrer_class | e.g. dated feed URL |
| `scroll_depth_reached` | 25/50/75/100 % of a long surface (throttled, milestone-only) | no | route, depth | **not** raw scroll — milestone buckets only |

### 3.2 Auth & identity — *last sign in* (per device)
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `login` | server-authoritative auth success | no | method, is_returning | **last sign in per device_type**, new-vs-returning |
| `login_failed` | auth rejected | no | reason_class | friction; never stores the credential |
| `logout` | explicit sign out | no | — | which device signed out |
| `signup_completed` | account created | no | method | first-touch device |
| `password_reset_requested` / `password_reset_completed` | reset flow | no | step | |
| `session_expired` | token/cookie expiry forces re-auth | no | — | silent re-auth vs bounce |
| `discord_link_started` / `discord_linked` / `discord_unlinked` | Discord OAuth | no | — | community loop |

### 3.3 Chat surface (`/chat` desktop · `/m/chat` mobile)
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `chat_opened` | chat surface entered | no | entry_source | desktop `DimeChatPage` vs `MobileChat` |
| `chat_started` | a new conversation created (`dimeChats.new`) | no | — | |
| `chat_message_sent` | user sends a prompt (`ai.chat`) | no | msg_len_bucket | **length bucket only — never text** |
| `chat_stream_started` | assistant stream opens (SSE) | no | — | TTFB timing anchor |
| **`chat_response_completed`** | stream `done`, answer usable | **YES** | latency_ms, tokens_bucket | ✅ **value event**; wire in `DimeChatPage` (critical-path — bundle-safe) + `MobileChat` |
| `chat_response_failed` | stream error/abort/empty | no | error_class, latency_ms | friction |
| `chat_stopped` | user cancels a stream | no | latency_ms | |
| `chat_regenerated` | user asks to regenerate | no | — | |
| `chat_starred` / `chat_unstarred` | `dimeChats.star` | no | — | |
| `chat_archived` / `chat_deleted` | `dimeChats.archive/delete` | no | — | |
| `chat_history_opened` | conversation list opened | no | — | mobile drawer vs desktop rail |
| `chat_copied` | user copies a response | no | — | value signal (not qualifying) |
| `chat_settings_changed` | model/settings modal commit | no | setting_key | never stores values that are PII |

### 3.4 Feed / AI Model Projections (`/feed/model/:sport[/:date]` · `/m/feed`)
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `feed_opened` | feed surface entered | no | sport, date_class | desktop `DimeModelFeed` vs `MobileFeed` |
| `feed_sport_switched` | sport toggle (mlb/nba/nhl) | no | from_sport, to_sport | |
| `feed_date_navigated` | date prev/next/picker | no | direction | |
| `feed_filtered` | filter applied | no | filter_key | |
| `feed_sorted` | sort changed | no | sort_key | |
| `projection_opened` | a projection card expanded | no | sport, market_type, object_type | tap (mobile) vs click (desktop) |
| **`projection_evaluation_viewed`** | a **complete, trustworthy** projection rendered (all fields, valid edge or supported `No Edge`, fresh) | **YES** | sport, market_type, data_freshness_state | ✅ **value event**; wire in feed. **not** a mere feed load |
| `projection_favorited` / `unfavorited` | `favorites.toggle` | no | sport, object_type | |
| `projection_shared` | share/copy link | no | sport | |
| `feed_empty_state_shown` | no games / no edge / off-season | no | reason | honest empty-state, not a failure |
| `feed_stale_state_shown` | data past freshness budget | no | freshness_seconds | data-quality |
| `feed_load_failed` | fetch error | no | error_class, latency_ms | friction |

### 3.5 Betting Splits / Tools / Trends (`/betting-splits/:sport[/:date]` · `/m/splits`)
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `splits_opened` | splits/odds surface entered ("Tools") | no | sport | desktop `BettingSplits` vs `MobileSplits` |
| `splits_sport_switched` | sport toggle | no | from_sport, to_sport | |
| `splits_date_navigated` | date change | no | direction | |
| `splits_sorted` | column/sort change | no | sort_key | |
| `splits_filtered` | filter applied | no | filter_key | |
| `odds_history_opened` | odds-history view expanded | no | object_type | |
| `trends_opened` | trends surface (redirects to splits) | no | — | route redirect captured |
| `splits_empty_state_shown` | no games/off-season | no | reason | |
| `splits_load_failed` | fetch error | no | error_class | |

### 3.6 Bet Tracker (`/bet-tracker` · mobile Bet Tracker)
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `tracker_opened` | Bet Tracker entered | no | — | desktop `BetTracker` vs `MobileBetTracker` |
| `bet_add_started` | add-entry form opened | no | entry_source | |
| **`tracker_entry_saved`** | a real (non-duplicate) bet saved (`betTracker.create`) | **YES** | — | ✅ **built + wired** (BetTracker.tsx). Add mobile emission. **No amounts/odds/stakes.** |
| `bet_edit_requested` | edit initiated | no | — | |
| `bet_edited` | `betTracker.update` succeeds | no | field_class | never stores the value |
| `bet_deleted` | `betTracker.delete` | no | — | |
| `bet_save_duplicate_blocked` | duplicate guard fires | no | — | data-quality (why a save didn't count) |
| `bet_save_failed` | save error | no | error_class | friction |
| `tracker_filtered` / `tracker_sorted` | list controls | no | key | |
| `tracker_summary_viewed` | performance/summary panel viewed | no | — | **counts, never $ amounts** |

### 3.7 Account / Billing / Subscription (`/account` · `/profile` · `/checkout` · `/subscribe/*`)
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `account_opened` | account/settings entered | no | — | desktop vs `MobileProfile` |
| `profile_opened` | profile entered | no | — | |
| `profile_updated` | profile save | no | field_class | never stores values |
| `pricing_viewed` | pricing/paywall seen | no | plan_context | |
| `paywall_viewed` | gated surface blocked | no | gated_feature | |
| `checkout_started` | Stripe checkout begun | no | plan | |
| `checkout_completed` | **server/Stripe-webhook authoritative** | no | plan | authoritative, not client-trusted |
| `checkout_abandoned` | left checkout without completing | no | step | churn precursor |
| `subscription_cancelled` | `cancelSubscription` | no | — | churn |
| `subscription_reactivated` | reactivate | no | — | winback |
| `billing_portal_opened` | manage-billing entered | no | — | |

### 3.8 Resources / WC2026 / Team pages / Props
| event | trigger | Q | key props | device notes |
|---|---|---|---|---|
| `resources_opened` | `/resources` entered | no | — | |
| `resource_item_opened` | a specific resource opened | no | object_type | |
| `wc2026_opened` | `/wc2026` entered | no | — | seasonal surface |
| `team_page_opened` | `/mlb|nba|nhl/team/:slug` | no | sport | **slug is not stored raw** — only `sport` + hashed object_id if needed |
| `props_opened` | `/m/props` mobile props screen | no | sport | **mobile-only** surface |
| `search_performed` | in-app search executed | no | scope, result_count_bucket | **never the query text** |

### 3.9 Feature lifecycle (cross-surface) — *most-important features / friction*
| event | trigger | Q | props | feeds |
|---|---|---|---|---|
| `feature_opened` | a feature/pane entered | no | feature_id | adoption, by device |
| `feature_completed` | feature's core task done | no | feature_id, outcome, latency_ms | task success + importance, by device |
| `feature_failed` | error / empty / insufficient-data | no | feature_id, error_class | friction / repair, by device |

### 3.10 Errors, performance & data-quality (cross-surface)
| event | trigger | Q | props | device notes |
|---|---|---|---|---|
| `client_error_captured` | unhandled client error (bounded, deduped) | no | error_class, route | **never** stack text/PII — class only |
| `api_request_failed` | a product API call fails | no | endpoint_class, status_bucket, latency_ms | segment by device/connection |
| `surface_perf_measured` | route interactive (LCP/TTI milestone) | no | route, ms_bucket | perf by `device_type` × `connection_class` |
| `slow_surface_flagged` | interactive beyond budget | no | route, ms_bucket | mobile/slow-connection friction |
| `data_freshness_observed` | surface rendered with a freshness state | no | state, freshness_seconds | honest fresh/stale/not-measured |

### 3.11 Admin surfaces (staff — `is_test`/staff-flagged, **excluded** from active/power metrics)
Tracked for **ops observability only**, never counts toward active users or power-user rank.
`admin_screen_viewed` (route), `admin_action_performed` (action_name, e.g. publish, ingest,
model-status toggle), `admin_export_performed`. All carry `is_staff=true` server-side ⇒ filtered
out of every product metric.

---

## 4. Actions — `action_performed { action_name }` — *total & unique actions* (per device)

Everything in §3.3–§3.8 tagged as a discrete user action also increments the action counters via a
single `action_performed` row (or is emitted as its named event and counted by name). The curated
allowlist (exhaustive, meaningful — **not** raw clicks):

- **Chat:** `chat_message_sent` · `chat_started` · `chat_regenerated` · `chat_stopped` ·
  `chat_starred` · `chat_unstarred` · `chat_archived` · `chat_deleted` · `chat_copied` ·
  `chat_history_opened` · `chat_settings_changed`
- **Feed:** `projection_opened` · `projection_favorited` · `projection_unfavorited` ·
  `projection_shared` · `feed_sport_switched` · `feed_date_navigated` · `feed_filtered` ·
  `feed_sorted`
- **Splits/Trends:** `splits_sorted` · `splits_filtered` · `splits_date_navigated` ·
  `splits_sport_switched` · `odds_history_opened` · `trends_opened`
- **Tracker:** `bet_add_started` · `bet_added` · `bet_edit_requested` · `bet_edited` ·
  `bet_deleted` · `tracker_filtered` · `tracker_sorted` · `tracker_summary_viewed`
- **Account/Billing:** `pricing_viewed` · `checkout_started` · `subscription_cancelled` ·
  `subscription_reactivated` · `billing_portal_opened` · `profile_updated`
- **Nav/Global:** `pane_switched` · `tab_tapped` *(mobile)* · `search_performed` ·
  `resources_opened` · `account_opened` · `profile_opened` · `wc2026_opened` · `team_page_opened`
- **Community:** `discord_link_started` · `discord_linked` · `discord_unlinked`

→ **total actions** = COUNT(action rows); **unique actions** = COUNT(DISTINCT action_name);
**most-used** = top-N. **Each is sliceable by `device_type` / `app_surface`** — e.g. "unique
actions on mobile", "most-used desktop action", "power users' action mix by device".

---

## 5. Device analytics (the new lens this catalog unlocks)

Because §1b rides on every event, these become first-class, evidence-backed metrics:

| metric | definition | fed by |
|---|---|---|
| **device mix** | share of sessions / engaged-ms / value-events by `device_type` | session + value events |
| **per-user primary device** | the `device_type` with the most engaged-ms per user (30 d) | `analytics_device_day` |
| **cross-device users** | users with ≥2 distinct `device_type` in the window | `device_switched` / device_day |
| **mobile-shell vs responsive** | `/m/*` shell usage vs desktop-route-on-phone | `app_surface` |
| **PWA adoption** | share with `is_standalone=true` | device block |
| **screen time per page per device** | dwell Δ grouped by `route` × `device_type` | `screen_viewed` |
| **feature importance by device** | completion/adoption split desktop vs mobile | feature lifecycle |
| **perf by device × connection** | interactive ms bucketed by `device_type` × `connection_class` | `surface_perf_measured` |
| **power users by device** | composite score sliced by primary device | all of the above |
| **orientation/touch mix** | portrait/landscape, touch vs mouse share | device block |

Every owner-named metric now has a device cut: *last sign in* → **last sign in per device**;
*total active screen time* → **per device**; *where users spend time* → **per device**;
*most-important features* → **per device**; *power users* → **mobile-first vs desktop-first**.

---

## 6. Instrumentation plan (device-first, bundle-safe, phased)

Build order keeps the critical-path bundle safe (DimeChatPage is direct-imported; feed/tracker/
session islands are lazy) and lands the device dimension **once, centrally**, so every event
inherits it for free.

| Phase | Delivers | Notes |
|---|---|---|
| **D0** | central **device-context resolver**: client `viewport_class`/`orientation`/`is_touch`/`pointer`/`is_standalone`/`connection_class` + server UA→`device_type`/`os`/`browser` reconciliation; attach §1b to every envelope | one place; all events inherit it |
| **D1 (P0)** | `session_*` + `screen_viewed` + the 3 value events + `login`, **all device-tagged** | → active screen time, per-page dwell, active users, TTFV, **last sign in** — all sliceable by device |
| **D2** | schema deltas (§2) + `analytics_device_day` rollup + read path/dashboard device cuts | prove the loop end-to-end with a device breakdown |
| **D3 (P1)** | `action_performed` allowlist (§4) + feature lifecycle | **total/unique actions per device**, feature importance per device |
| **D4** | perf/error/data-quality family (§3.10) | friction by device × connection |
| **D5 (P2)** | monetization funnel + **power-user score** (device-sliced) + research/founder queues | power users mobile-vs-desktop |

Each phase: `sp-plan` the slice → `sp-execute` on the branch (no deploy) → `sp-verify`
(tsc / tests / bundle budget + evidence) → `sp-finish`. Nothing goes live without owner
authorization + a green **excluded canary**. Emitters ship **inert** (server-gated) until the
Railway vars are set — wiring them changes nothing in production until you flip the pipeline on.

---

## 7. What is intentionally NOT captured (guardrail ledger)

- ❌ wager amounts, odds, stakes, losses, bankroll, P&L — **ever**, on any surface
- ❌ chat prompt/response text, search query text, message contents (only length/count buckets)
- ❌ raw URLs with ids, team slugs stored raw, emails, names, payment details, credentials, tokens
- ❌ raw clicks / mousemoves / keystrokes / scroll positions (milestone buckets only)
- ❌ device fingerprints (only coarse family/bucket fields; no font/canvas/precise-UA hashing)
- ❌ betting signals in the power-user score (engagement/breadth/tenure only)
- ❌ staff/test activity in any product metric (server-flagged, filtered)
