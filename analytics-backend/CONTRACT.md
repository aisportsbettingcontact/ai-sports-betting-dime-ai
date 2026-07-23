# User Activity analytics — data & API contract

Reference contract for the dedicated `MySQL: Dime AI` analytics pipeline. Implemented
by `ai-sports-betting-backend`; the `ai-sports-betting-dime-ai` web service only
proxies to it. **Not yet built/verified from this session** (no backend/Railway access).

## 1. Canonical "active user" (owner directive §6)

A distinct, authenticated, **eligible human** who completes **≥1 released, versioned,
value-bearing foreground event** in the window. Explicitly **NOT** active-qualifying:
login/refresh, passive route loads, prefetch, polling, **heartbeats**, background tabs,
notifications/webhooks, scheduled jobs, failed/aborted/stale/unauthorized workflows,
and staff/test/internal/bot activity.

> This supersedes the interim shipped metric (which counted heartbeat-bearing
> `user_sessions`). The live `MAU 19` is legacy session data, **not** value events, and
> must not be labeled "monthly active" once this pipeline is authoritative.

## 2. Candidate qualifying events (VERIFY against the product before freezing)

| event_name | qualifies_active | completion condition |
|---|---|---|
| `projection_evaluation_viewed` | yes | a complete, trustworthy projection (all required fields, valid edge or supported `No Edge`, fresh) is rendered to the user |
| `chat_response_completed` | yes | a Dime Chat response finishes successfully and is available |
| `tracker_entry_saved` | yes | a released Bet Tracker save/evaluate workflow completes |
| `session_segment` | **no** | foreground engagement interval — continuity only, never qualifies |

Names are past-tense `lower_snake_case`. Each is a row in `analytics_event_definitions`
(event_name, schema_version, definition_version, surface, qualifies_active,
required_outcome, allowed_props, introduced/retired). Do **not** invent features or treat
a page open as value.

## 3. Event envelope (owner directive §7)

Client supplies: `event_id` (idempotency key), `event_name`, `schema_version`,
`occurred_at`, `session_id`, `tab_id`, optional `workflow_id`/`feature_id`, `surface`,
`outcome`, allowlisted `props`. **Server derives and OVERRIDES:** `subject → source_user_id`,
`received_at`, `environment`, `app_version`, `is_test`, staff/entitlement flags.

Ingestion rules: reject/ignore any client-supplied identity/plan/entitlement/authorization;
dedupe on `event_id`; quarantine conflicting reuse; record both clocks + a documented
clock-skew bound (no silent backdating); **ACK only after durable commit**; at-least-once +
deterministic dedupe; bounded batches/retries; analytics failure must never break the
product; `sendBeacon`/keepalive only where supported and never assumed guaranteed on unload.
Validate auth, origin, CSRF, event name, schema version, payload size, prop allowlist, rate
limits. **Never** store raw event JSON, prompts, model responses, payment/wager data,
credentials, or unnecessary PII.

## 4. Metric contract (owner directive §10)

Windows (half-open, UTC, one `as_of` per dashboard response):
`DAU=[as_of−24h, as_of)`, `WAU=[as_of−7d, as_of)`, `MAU=[as_of−30d, as_of)`. Invariant
`DAU ≤ WAU ≤ MAU` under a shared cutoff+definition. Sessions use foreground non-idle
engagement; duration buckets `[0,5m) [5m,30m) [30m,2h) [2h,∞)`; no valid closed sessions ⇒
`not_measured`, never `0s`.

Every metric response includes: `metric_key`, `value` (nullable), `state`, `reason`,
`as_of`, `data_through`, `coverage_start`, `coverage_end`, `freshness_seconds`,
`definition_version`, `sample_size`. States: `measured | true_zero | not_measured | partial
| stale | conflicting | error`. Render `0` only when coverage is complete and the verified
numerator is genuinely zero.

## 5. Backend HTTP API (private; called only by the web proxy)

Backend binds Railway's assigned `$PORT` (do not hardcode). All routes require the
web→backend service auth (shared secret / signed header) — never a public bare endpoint.

- `POST /internal/analytics/events` — batch ingest. Body: `{ events: Envelope[] }`.
  Returns `{ accepted, deduped, quarantined }` **after durable commit**.
- `GET /internal/analytics/overview?as_of=…` — DAU/WAU/MAU/session/account cards (metric
  contract §4).
- `GET /internal/analytics/trends`, `/retention`, `/sessions`, `/features`,
  `/high-signal-users`, `/research-queue`, `/founder-queue`, `/data-quality` — paginated,
  bounded date ranges, `as_of` + `definition_version` consistent, no raw payloads/secrets.

## 6. Web-service same-origin proxy (this repo's ONLY role)

`Browser → /api/analytics/* (same-origin) → server proxy → USER_ACTIVITY_BACKEND_URL`.

- **Server-only** env var `USER_ACTIVITY_BACKEND_URL` = `http://ai-sports-betting-backend.railway.internal:<$PORT>`
  (Railway service-reference; resolve port from the backend's verified config — do not guess).
- The browser calls only the same-origin `/api/analytics/*` path. The `.railway.internal`
  hostname, the backend URL, and DB connection strings **never** appear in browser code,
  `VITE_*` vars, API responses, logs, commits, screenshots, or bundles.
- Proxy enforces: existing session auth (derive `source_user_id` server-side), strict
  origin/CORS, CSRF, per-user + global rate limits, payload size caps; forwards the derived
  identity + `is_test`/staff flags to the backend; strips any client identity claims.
- Feature-flagged OFF until `USER_ACTIVITY_BACKEND_URL` is set AND the backend contract is
  verified — returns `503 { state: "not_measured", reason: "analytics backend not configured" }`
  otherwise, so the product never breaks.

## 7. Emitters (next phase, after the path is verified)

Wire the §2 qualifying events on their released surfaces to `POST /api/analytics/events`
(fire-and-forget, bounded retry, never blocking the product). The admin User Activity tab
reads **only** via the proxy → backend → dedicated MySQL (owner directive §8) — no direct
DB reads for UA once this path is live.
