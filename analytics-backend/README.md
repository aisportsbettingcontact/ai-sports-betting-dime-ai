# User Activity analytics — dedicated MySQL pipeline (backend-destined)

Owner directive 2026-07-23: User Activity analytics must live in a **dedicated
`MySQL: Dime AI`** database, **separate** from the product TiDB database, and be
written/read **only** through `ai-sports-betting-backend`. This directory holds the
reference schema + contract for that pipeline. **The files here are destined for the
`ai-sports-betting-backend` repository** — this web repo (`ai-sports-betting-dime-ai`)
contributes only the same-origin proxy + emitters (see `CONTRACT.md` §6–7).

## Required architecture

```
Product browser
  → public Dime AI web service (same-origin /api/analytics/*)
  → authenticated server-side proxy (server-only USER_ACTIVITY_BACKEND_URL)
  → ai-sports-betting-backend.railway.internal   (binds Railway $PORT)
  → USER_ACTIVITY_DATABASE_URL                    (Railway service-reference)
  → MySQL: Dime AI  (mysql.railway.internal)
```

**Invariants:** browser never touches `.railway.internal` or the DB; no private
hostname / connection string in browser code, `VITE_*`, API responses, logs, commits,
or bundles; only the backend connects to MySQL; the global `DATABASE_URL` (TiDB, product
data) is **not** reused/repointed; UA data is **never** written to TiDB and there is no
silent TiDB fallback; activity keys to the account via immutable `source_user_id` (no
cross-DB foreign keys).

## What changed in THIS repo (safe local work)

- **Neutralized** the previously-merged event-ingestion seam that wrote `analytics_events`
  to **TiDB** via the shared `DATABASE_URL` (removed the table from `drizzle/schema.ts`,
  migration `0115`, `server/analytics/eventStore.ts`, `server/routers/analytics.ts` + its
  registration, and the ingestion test). That path contradicted "never write UA to TiDB",
  so it was removed rather than left as a dormant landmine. The DB-agnostic honesty helpers
  (`server/analytics/metricDefinitions.ts`) and the interim session read-path are kept —
  the live admin page keeps rendering (from TiDB) until the backend path is authorized.
- **Added** this reference schema + contract for the dedicated MySQL pipeline.

## BLOCKED (needs access I don't have this session)

The authoritative pieces cannot be built or verified from here:

1. `ai-sports-betting-backend` **repository is not in my session scope** (`list_repos`
   returns only `ai-sports-betting-dime-ai`; it cannot be added). I cannot implement the
   backend's ingestion handler, MySQL connection, aggregation, or admin API.
2. **No Railway access** (CLI absent; MCP unauthenticated). I cannot: resolve service-ID
   `3528dc9f-…`, map services↔repos, create/confirm the `USER_ACTIVITY_DATABASE_URL`
   service-reference, confirm it resolves to `MySQL: Dime AI`, read the assigned `$PORT`,
   or reconcile the deployed SHA.
3. **No MySQL access** — cannot run `SELECT 1` / verify engine, version, schema, or writes.

Per the directive, the DB target is **not guessed** and nothing here is claimed applied,
deployed, or verified.

## Verification runbook (run when backend + Railway access exists)

1. Resolve service-ID `3528dc9f-…` → confirm web vs backend; record both service IDs,
   project/env IDs, and deployed SHAs.
2. Confirm `USER_ACTIVITY_DATABASE_URL` is a service-reference to `MySQL: Dime AI`
   (metadata only — never print the value). Confirm the backend binds `$PORT`.
3. From the backend only: `SELECT 1`; record engine/version; confirm the DB is the
   dedicated MySQL, not TiDB/SQLite/another env.
4. Apply this schema via the backend's migration framework; confirm tables/indexes;
   confirm re-run is a no-op.
5. Deploy backend, then web; confirm health and that the web proxy reaches the backend
   over private DNS (server-side only).
6. **Bundle scan:** grep built client assets for `railway.internal`, DB host, or any
   connection string → must be zero.
7. **Excluded canary** (separately authorized): one `is_test=true` event via the normal
   public path → exactly one durable MySQL row → readback < 60s → excluded from all
   real DAU/WAU/MAU/retention/feature/high-signal metrics. Remove only disposable test data.

## Membership invariant (unchanged)

`Lifetime Access + Recurring Paid + No Active Access = Total Accounts`; Discord-linked is
a cross-cut and is never added to the total. (Live page confirms 76 + 1 + 1 = 78.)
