# Analytics Event Dictionary — ingestion seam v1 (2026-07-23)

Scope of this PR: **the ingestion seam only.** This ships the storage table
(`analytics_events`), the idempotent server-side store, and the `analytics.track`
tRPC procedure. **Emitters are the NEXT phase** — no client code emits events yet.
This document is the contract those future emitters must target.

## Design principles

- **Additive & minimal.** One new table (`analytics_events`), one new router
  (`analytics.track`), one new store module. No existing table/column/route is
  modified.
- **Versioned.** Every event carries a required `schema_version` so a given
  event's payload shape can evolve without breaking historical rows.
- **Pseudonymous, no PII.** The only subject reference is `subjectId`, the
  **server-derived** `app_users.id`. No names, emails, IPs, chat text, wager
  amounts, losses, balances, or payment/entitlement/consent state are accepted
  or stored.
- **Server never trusts client identity.** `subjectId`, `environment`, and
  `receivedAtUtc` are all set server-side. Any client-supplied identity or
  sensitive field is stripped before storage.

## Identity & idempotency rules

| Field | Source | Rule |
|---|---|---|
| `subjectId` | **Server** (`ctx.appUser.id`) | Never client-supplied. Any `subjectId`/`userId`/`role`/`entitlement`/`consent`/`payment` field in the client payload is stripped by `parseTrackInput`. |
| `environment` | **Server** (`NODE_ENV`) | Client cannot set or spoof. |
| `receivedAtUtc` | **Server** (`Date.now()`) | Stamped at write time in `insertAnalyticsEvent`. |
| `occurredAtUtc` | Client | Accepted but bounded (positive int ms, < year 2100). |
| `eventId` | Client | **UNIQUE idempotency key.** Re-delivering the same `eventId` is a no-op; the store returns `{ ok: true, deduped: true }` and inserts nothing. Enforced by the DB `UNIQUE(eventId)` constraint and a duplicate-key catch (`ER_DUP_ENTRY` / errno 1062). |
| `props` | Client | Only **allowlisted** scalar keys survive (see below); all others dropped. Bounded string length and key count. |

Only authenticated app users may emit (`analytics.track` is built on
`appUserProcedure`). The `track` response is `{ ok: true, deduped: boolean }`.

## Event allowlist

Event names are **past-tense `lower_snake_case`** and must appear in
`ANALYTICS_EVENT_ALLOWLIST` (see `server/analytics/eventStore.ts`). Any other
name is rejected with `BAD_REQUEST`. Every event shares the same **required base
fields**; the `props` column below lists the allowlisted, non-sensitive props
that are meaningful for that event.

| Event | schema_version | Required fields (base) | Optional allowlisted props |
|---|---|---|---|
| `feed_viewed` | 1 | `event_id`, `event_name`, `schema_version`, `occurred_at_utc` | `sport`, `tab`, `count` |
| `projection_card_expanded` | 1 | base | `sport`, `card_type` (`cardType`), `position` |
| `sport_tab_switched` | 1 | base | `sport`, `tab` |
| `chat_session_started` | 1 | base | `surface` |
| `chat_message_sent` | 1 | base | `surface`, `count` |
| `checkout_started` | 1 | base | `variant`, `surface` |
| `checkout_completed` | 1 | base | `outcome` (base optional), `variant` |

**Base fields** (every event):

- `event_id` — string, 8–64 chars, unique idempotency key.
- `event_name` — one of the allowlist above.
- `schema_version` — required positive integer.
- `occurred_at_utc` — client UTC ms (bounded).

**Base optional fields** (any event): `session_id`, `source`
(`web`|`ios`|`android`|`server`, default `web`), `outcome`, `data_state`,
`props`.

### Allowlisted prop keys (global)

`sport`, `tab`, `surface`, `cardType`, `position`, `durationMs`, `count`,
`variant`. Values must be short strings, finite numbers, or booleans. Non-listed
keys — including anything sensitive (`balance`, `amount`, `wagerAmount`, `email`,
`ssn`, …) — are silently dropped and never persisted.

## Storage

Table `analytics_events` (see `drizzle/schema.ts`), migration
`drizzle/0115_clumsy_toxin.sql`:

- Columns: `id` (PK), `eventId` (UNIQUE), `eventName`, `schemaVersion`,
  `subjectId`, `sessionId` (nullable), `source`, `environment`, `occurredAtUtc`
  (bigint ms), `receivedAtUtc` (bigint ms), `outcome` (nullable), `dataState`
  (nullable), `propsJson` (nullable text, allowlisted props only), `createdAt`.
- Indexes: `idx_analytics_events_subject_id`, `idx_analytics_events_event_name`,
  `idx_analytics_events_occurred_at`, plus the `UNIQUE(eventId)`.

## Migration provenance

- Generated with the repo's drizzle-kit command:
  `drizzle-kit generate` (invoked via `npx drizzle-kit generate`). `drizzle.config.ts`
  requires `DATABASE_URL` to load, so a **dummy** URL was supplied purely to satisfy
  the config guard — `generate` does **not** connect to any database, it only diffs
  the schema against `drizzle/meta` snapshots.
- Output: `drizzle/0115_clumsy_toxin.sql` (+ `drizzle/meta/0115_snapshot.json` and a
  new `drizzle/meta/_journal.json` entry).
- **Additive-only, verified:** the SQL contains a single `CREATE TABLE
  analytics_events` plus three `CREATE INDEX` statements. It contains **no**
  `DROP`, `ALTER`, `MODIFY`, `RENAME`, `TRUNCATE`, or `DELETE` against any existing
  table.
- **Not applied.** This migration has **NOT** been run against any database (local,
  Railway, or otherwise). Per repo deploy law, schema changes are applied only via
  the manual `db-push.yml` workflow. No claim of live application is made.
