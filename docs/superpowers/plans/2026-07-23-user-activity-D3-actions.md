# User Activity — D3 (P1): action_performed + feature lifecycle

> REQUIRED SUB-SKILL: subagent-driven-development. Ships INERT (server-gated) like D0–D2.

**Goal:** Capture **total actions, unique actions, and most-used actions per device** by emitting a curated `action_performed { action_name }` event at real user-action points, plus feature-lifecycle events — all device-tagged (the D0 device block auto-attaches), all non-qualifying (engagement diagnostics, never the active numerator).

**Architecture:** Reuse the whole D0–D2 pipeline unchanged. Only add: (1) new event names + a curated **action allowlist** to the server contract (`events.ts`), persisting the existing `action_name` store column; (2) a client `trackAction()` helper on top of `useAnalytics`/the bridge; (3) emitter calls at real action points on each surface; (4) read-path aggregation of action counts per device.

## Global constraints
- **Server-gated / inert** — no new behavior until the Railway vars are set. Fire-and-forget; never throws.
- **Curated allowlist, not raw clicks** — only the named actions below; unknown `action_name` rejected server-side.
- **Guardrails** — no wager amounts/PII/text; `action_name` is a fixed enum; props are allowlisted scalars.
- **Bundle** — `DimeChatPage` is critical-path: chat actions emit via the existing `analyticsBridge` (`emitEvent`), never a direct `useAnalytics` import. `npm run check:bundle` must stay under 215,882 B.
- **`tsc --noEmit` clean; build green.** Non-qualifying: `qualifiesActive()` stays false for all D3 events.

## Curated action allowlist (§4 of EVENT-CATALOG, scoped to high-value)
`chat_message_sent · chat_started · chat_starred · chat_deleted · projection_opened · projection_favorited · feed_filtered · feed_sport_switched · feed_date_navigated · splits_sorted · splits_filtered · splits_date_navigated · splits_sport_switched · bet_edited · bet_deleted · pane_switched · search_performed`
Feature-lifecycle event names: `feature_opened · feature_completed · feature_failed`.

---

## Task 1 — Server contract: action_performed + allowlist (events.ts)
**Files:** modify `server/analytics/events.ts` + `server/analytics/events.test.ts`; modify `server/routers/analytics.ts` (persist `actionName`).
- Add `ACTION_ALLOWLIST` (the 17 names above, `as const`) and `FEATURE_EVENTS = ["feature_opened","feature_completed","feature_failed"]`.
- Add `"action_performed"` to the event names; add `ENGAGEMENT_EVENTS`-style inclusion so `ALL_EVENTS` includes `action_performed` + the feature events. Keep `qualifiesActive` false for all.
- Add `actionName: z.enum(ACTION_ALLOWLIST).nullish()` to `trackInputSchema`; add a refine: when `eventName === "action_performed"`, `actionName` is required.
- Router: pass `actionName: input.actionName ?? null` into the `StoredEvent` (the store already has the `action_name` column + `idx_action_time`).
- Tests: accepts `action_performed` + valid `action_name`; rejects unknown `action_name`; `qualifiesActive("action_performed") === false`.

## Task 2 — Client helper: trackAction (analytics.ts + analyticsBridge.ts)
**Files:** modify `client/src/lib/analytics.ts`, `client/src/lib/analyticsBridge.ts` + tests.
- Broaden `AnalyticsEventName` to include `"action_performed"` + the feature events; add an `actionName` field to `TrackOptions` (typed to the allowlist union).
- Export `useTrackAction()` → `(actionName, opts?) => void` that calls `track("action_performed", { actionName, ...opts })`.
- Bridge: `emitAction(actionName, opts?)` mirroring `emitEvent`, for critical-path (chat) callers.
- Tests: envelope carries `eventName:"action_performed"` + `actionName`; device block still attached.

## Tasks 3–6 — Per-surface emitters (PARALLEL — disjoint files)
Each wires `trackAction`/`emitAction` at the real action points; device-tagged automatically. **Do not** change product logic — add fire-and-forget emits only.
- **Task 3 — Chat** (`client/src/pages/dime-chat/DimeChatPage.tsx`, + mobile `MobileChat` if trivial): `chat_message_sent` (on send), `chat_started` (new conversation), `chat_starred`, `chat_deleted`. **Use `emitAction` from the bridge** (critical-path). Verify bundle.
- **Task 4 — Feed** (`client/src/pages/DimeModelFeed.tsx`): `projection_opened` (card expand), `projection_favorited` (favorites.toggle), `feed_filtered`, `feed_sport_switched`, `feed_date_navigated`. Lazy page → `useTrackAction`.
- **Task 5 — Splits/Tools** (`client/src/pages/BettingSplits.tsx`): `splits_sorted`, `splits_filtered`, `splits_date_navigated`, `splits_sport_switched`.
- **Task 6 — Tracker** (`client/src/pages/BetTracker.tsx`): `bet_edited` (update success), `bet_deleted` (delete success). (`bet_added` already emits the `tracker_entry_saved` value event.)

## Task 7 — Read-path aggregation (per-device action metrics)
**Files:** modify `server/analytics/read.ts` + `read.test.ts`; `client/src/pages/admin/DeviceActivityPanel.tsx`.
- Extend `getAnalyticsOverview()` with: `totalActions` (COUNT of `action_performed`, is_test=0), `uniqueActions` (COUNT DISTINCT action_name), `topActions` (top-5 action_name by count), and per-`device_type` action counts (extend the device mix).
- Add the mysql2 `[rows,fields]` extraction (reuse `rowsOf`/`numAt`).
- UI: add a "Total actions / Unique actions / Top actions" card + fold action counts into the device-mix rows. Honest states preserved.

## Verification
- `tsc` clean; `build:client` green; `check:bundle` under budget (chat is critical-path).
- Full analytics suite green; new events.test.ts + read.test.ts assertions pass.
- Inert proof: disabled role → nothing stored. Guardrail scan: only allowlisted action_name enums, no PII/wager.

## Out of scope (later phases)
- D4 perf/error/data-quality; D5 monetization + power-user score + queues.
- Enablement (owner-driven Railway vars).

## Execution waves
- **Wave A:** Task 1 (contract) + Task 2 (client helper) — foundational, do first (controller).
- **Wave B (parallel):** Tasks 3–6 (per-surface emitters, disjoint files) — subagents.
- **Wave C:** Task 7 (read aggregation) — controller.
- **Wave D:** verify + PR.
