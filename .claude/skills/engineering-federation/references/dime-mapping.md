# Dime mapping — the standard applied to this repo

Maps each control area of `production-grade-engineering-architecture.md` onto this
repo's real mechanisms. This is a **map, not a compliance certificate**: rows marked
*observed* were verified on 2026-08-05 and must be re-verified at use time; rows marked
**OPEN** are controls the standard requires that this repo has not adopted — treat them
as candidate work, never as silently satisfied. Per §23, every N/A carries its reason.

## Topology (§1, §6, §17)

| Standard component | Dime reality |
| --- | --- |
| Modular application runtime | Express + tRPC modular monolith (`server/`), stateless app code; correct default per §1 |
| Edge gateway | Railway's managed edge (TLS termination, HTTP proxying). No self-hosted Envoy/Caddy layer — §9.4/§14.5 duties split between Railway's edge and Express middleware; `app.set("trust proxy", 1)` is the trust contract (observed) |
| Identity provider | First-party session auth (`appUsers`, HttpOnly session cookie — the standard's preferred browser boundary) + Discord OAuth. External IdP N/A: local auth accepted under §6.1's "equivalent controls and ownership" rule |
| Policy decision point | In-application (tRPC `publicProcedure` vs protected procedures; role checks in context). External PDP N/A: policy does not span services/tenants (§6.1 conditional) |
| Stateless instances | **Single replica pinned** — `railway.json` `numReplicas: 1`; `references/railway-deploy.md` §3b forbids raising it without a distributed lock. Two-instance HA (§17.1) is N/A until the owner changes the replica law; every design must state single-process assumptions it relies on (in-memory caches, MemoryStore limiters, cron singletons) |
| Relational system of record | MySQL-protocol TiDB via Drizzle (`drizzle/schema.ts`) |
| Distributed cache / rate-limit store | **None, deliberately.** In-process caches + MemoryStore limiters are sanctioned by the single-replica law. Adding Valkey/Redis is an earn-its-existence decision (§5.11) |
| Migration runner | `scripts/reconciled-migrate.mjs` (journal `railway-production-v1`, plan/apply modes, `CONFIRM=RECONCILE`) dispatched by `.github/workflows/db-push.yml` (workflow_dispatch, Production environment). Exactly the §13.1 separated runner — never an app-startup side effect |
| Telemetry pipeline | Structured logs + Railway metrics + `security_events` table + Discord alerting + `securityDigest` (observed). **OPEN:** no OpenTelemetry collector/traces (§15.1) |
| Supply chain | Dockerfile built by Railway per deploy; gitleaks + osv-scanner + CodeQL/semgrep + pinned-action enforcement in CI (observed). **OPEN:** SBOM, artifact signing, digest promotion (§14.3) — Railway builds per-deploy rather than promoting one digest; compensating controls are deploy-smoke + Railway's `commitHash`-stamped deployments |

## Contracts (§9)

- **The API contract layer is tRPC routers + zod schemas** (`server/routers.ts`), not OpenAPI. Type-level breaking-change detection = `RouterOutputs` inference + `npx tsc --noEmit` in CI. OpenAPI applies only to non-tRPC public surfaces (`/health`, `/api/dime/chat` SSE, webhook endpoints) — an OpenAPI file for tRPC procedures is N/A (the router *is* the machine-readable contract).
- Error envelope: tRPC's JSON envelope is the Problem-Details equivalent. Hazard (observed precedent in `server/_core/index.ts` timeout middleware): raw `{error:...}` JSON on a tRPC path breaks client parsing — middleware that answers tRPC routes must speak the tRPC envelope, including 429s.
- Batch hazard: tRPC HTTP batching (`/api/trpc/a,b?batch=1`) defeats path-prefix middleware. Any route-classified middleware must parse the comma-separated procedure list and apply the strictest class (AUTH-004 precedent).
- Idempotency (§9.1): mutations behind sessions; client-visible retriable mutations need an idempotency key or natural idempotence (e.g. toggle semantics recomputed from a truth table). Declare which, per mutation.
- WebSockets (§9.3): **none today** — feed uses 60s polling + ETag/304; chat uses SSE (`POST /api/dime/chat`). WebSocket rows N/A (no WS surface); SSE inherits the bounded-stream duties: heartbeat, client disconnect handling, bounded response, auth at request time.

## IAM (§10)

- Browser boundary: server session in HttpOnly cookie — the standard's preferred same-party pattern. JWT verifier rows apply only where a token is actually verified (e.g. provider webhooks/signatures); do not bolt JWT machinery on where sessions already govern.
- Deny-by-default: unauthenticated tRPC calls to protected procedures must fail closed (observed: `POST /api/dime/chat` unauthenticated → 401, deploy-smoke check #5).
- Admin/owner operations follow AGENTS.md operating rules (broker-mediated Railway auth, scope-isolated credentials); those rules outrank anything here.

## Security (§11)

- TLS/certs: owned by Railway's edge (automatic). In-app duties: HSTS/cookie attributes, CSP (observed: checkout CSP allows Stripe, smoke check #8).
- CORS: browser policy only, never authorization. Origin allowlist lives in server config; dev origins stay out of production.
- SQLi: Drizzle parameterized queries; raw SQL confined to reviewed modules; dynamic identifiers allowlisted. MySQL placeholders — the standard's `$1` examples are Postgres-flavored, the rule is identical.
- Rate limiting (§11.4): `express-rate-limit` stack in `server/_core/index.ts` (observed: global `/api` limiter + auth/checkout/waitlist limiters, IPv6-safe `ipKeyGenerator`). **Route-class failure policy for this repo:**

| Route class | Limiter store failure | Rationale |
| --- | --- | --- |
| `/health` | never limited | Railway healthcheck failure kills the deploy |
| Auth, checkout, destructive admin | fail closed | rare, human-paced; unthrottled brute force costs more |
| Public feed reads, HTML pages | fail open + alert | the feed is the product; a limiter fault must not become an outage |
| Expensive AI (Dime Chat) | conservative local limits (`dimeChatRateLimit.ts` pattern) | third-party cost class |

- Identity for limiter keys (**corrected 2026-08-05, live-verified**): key on the **leftmost `X-Forwarded-For` entry** via `clientIpKey` (`server/_core/trpcRateLimitPolicy.ts`), NOT `req.ip`. Verified in production: Railway's edge (a) **sanitizes inbound XFF** — an injected `X-Forwarded-For` is discarded, so the leftmost entry is the true client and is not client-spoofable here — and (b) writes the chain as `[trueClient, railwayEdgeInternal]` where the rightmost entry rotates per connection (`152.233.x.x`). Under `trust proxy = 1`, Express `req.ip` resolves to that **rotating edge node**, so keying on `req.ip` both multiplied per-client budgets and shared budgets across unrelated clients. **Named assumption (revisit trigger):** this rests on Railway continuing to sanitize inbound XFF; if that platform behavior changes, every limiter becomes spoofable — encode a re-verifiable control (a smoke check injecting a spoofed XFF and confirming it is discarded) before relying further. **Rejected alternative:** raising `trust proxy` to 2 so `req.ip` resolves to the client — rejected because `trust proxy` also governs `x-forwarded-proto`/`req.secure` and would risk the secure-cookie path; keying is scoped to limiters instead. Forensic logs may still show the leftmost XFF.
- Secrets: gitleaks in CI; production `DATABASE_URL` only in Actions secrets + Railway; child processes get explicit allowlists (§14.2); AGENTS.md credential-scope rules outrank all of this.

## Performance and data (§12–§13)

- Caching: in-process TTL caches (observed: 60s games-list cache) + HTTP ETag/304 + `Cache-Control`. The cache is disposable; the DB is authoritative; honor the feed data contract's "empty 304 body ≠ no games". A distributed cache is an earn-its-existence decision.
- Indexing (§12.4): MySQL/TiDB — HypoPG N/A (Postgres-only). Use `EXPLAIN`/`EXPLAIN ANALYZE` with representative data; document index purpose + source query in the migration file.
- Migrations (§13.1): expand–migrate–contract over the drizzle journal. Sequence law: **(1)** migration lands in the PR (CI's DB Tests replay the full chain on an isolated DB), **(2)** `db-push.yml` applies it to production from the branch, **(3)** merge deploys dependent code, **(4)** backfill after code is live. Migration files immutable post-apply (journal hash validation). Forward-fix by default.
- Backfills (§13.2): idempotent, dry-run first, Production-workflow only, recompute from a truth table where one exists; bounded by evidence (chunk at scale; a justified single statement on a small table states its size).
- Backup/restore (§13.3): Railway MySQL backups. **OPEN:** restore drills with measured RTO/RPO are not on record — treat any recoverability claim as unverified until drilled.

## Delivery and operations (§14–§16)

- Gates (fitness functions §20 → commands), run per classification:

| Gate | Command / mechanism |
| --- | --- |
| Types | `npx tsc --noEmit` (CI: `NODE_OPTIONS=--max-old-space-size=6144`) |
| Tests | `pnpm run test:gated:local` locally (env-gated); CI DB Tests replay migrations on an isolated DB |
| Build | `pnpm build` (vite + preview-production gate + esbuild server) |
| Secrets | gitleaks (CI) |
| Dependencies | osv-scanner Security Audit (CI); CodeQL/semgrep |
| Workflow security | pinned-action check (`scripts/check-github-actions-security.mjs`) |
| Live smoke | `node scripts/smoke-deploy.mjs <url>` (8 checks, local and live); `deploy-smoke.yml` post-merge |
| Runtime proof | `verify` skill: prod build + boot on :3910 + drive |

- Release evidence: Railway deployments carry `meta.commitHash` — the deployed-revision proof (used to verify PR #360's deploy). Pair the deploy id + commit hash in every shipped record.
- Resilience (§16): observed behaviors to preserve — server boots with a dead DB and `/health` stays 200 (lazy pool, `consecutiveFailures` tracking); timeouts on tRPC routes speak the envelope. **OPEN:** no formal failure-mode test suite for the §16.2 matrix; classify per-change which rows apply.

## Evidence record (§21.3, Dime-adapted)

Template and terminal-outcome enum live in `routing.md`. Dime field mappings:
`source_revision` = commit SHA · `artifact_digest` = Railway deployment id + `meta.commitHash` · `migration_revision` = drizzle journal tag (e.g. `0133_favorite_count`) or `none` · `approvals` = owner directives / `db-push.yml` run URLs / PR approvals · `production_mutation` = true for any merge to main (deploy law).
