# Dime mapping — the standard applied to this repo

Maps each control area of `production-grade-engineering-architecture.md` onto this
repo's real mechanisms. This is a **map, not a compliance certificate**: rows marked
*observed* were verified on 2026-08-05, except the edge, identity, evidence-record, policy
and resilience rows re-verified 2026-08-07 (each dated in place); all must be re-verified
at use time; rows marked
**OPEN** are controls the standard requires that this repo has not adopted — treat them
as candidate work, never as silently satisfied. Per §23, every N/A carries its reason.

## Topology (§1, §6, §17)

| Standard component | Dime reality |
| --- | --- |
| Modular application runtime | Express + tRPC modular monolith (`server/`), stateless app code; correct default per §1 |
| Edge gateway | **Two hops, not one (corrected 2026-08-07 — this row previously described Railway alone).** Public traffic reaches **Cloudflare** (WAF + Super Bot Fight Mode at Block, armed 2026-08-06), which proxies to **Railway's managed edge** (TLS termination, HTTP proxying), which reaches Express. Still no self-hosted Envoy/Caddy — §9.4/§14.5 duties are split across Cloudflare rules, Railway's edge, and Express middleware; `app.set("trust proxy", 1)` remains the Express trust contract (observed). Arming is staged by `EDGE_MODE` = `off` \| `log` \| `on` (`server/_core/edgeProxy.ts`): `off` short-circuits every consumer so the code is inert, `log` observes and emits would-deny events, `on` enforces. **Origin lock** (`originLock.ts`): under `on`, a request lacking a valid `x-dime-edge-secret` (`EDGE_ORIGIN_SECRET`, with `EDGE_ORIGIN_SECRET_PREV` for rotation) from a Cloudflare-range upstream gets 403 — **except `/health`**, which must stay reachable on the direct origin or Railway's healthcheck kills the deploy. Anti-lockout: `on` with no secret configured degrades to log behavior and shouts CRITICAL. **Self-healing circuit breaker** (`edgeCircuitBreaker.ts`) drops enforcement to observe-only if Cloudflare stops injecting the secret, then closes itself. Automated first-party tooling is waved through by the `x-dime-agent` header, matched by a Cloudflare WAF Skip rule — **Cloudflare-side only, never a server env var** (verified: no `server/` or `client/` code reads it). The CF IP-range snapshot (`CF_CIDR_SNAPSHOT_DATE`, 90-day `CF_CIDR_MAX_AGE_DAYS`) is described in-source as defence-in-depth, but note the actual failure direction: `edgeProofPasses` is a logical **AND** (`originSecretOk(...) && isCloudflareEdgeIp(...)`), so a snapshot that has gone stale and is missing a newly published Cloudflare range makes the proof fail for genuine edge traffic — which under `on` is a user-facing 403. (It is *only* a 403: originLock is mounted ahead of the limiters, so a denied request never reaches one and is never keyed. The tier-2 PoP-keying fall-through is the `log`-mode / breaker-tripped / no-secret-configured consequence, not the enforcing one.) **Only the staleness *warning* is observability-only; the snapshot itself is fail-closed.** Refresh it deliberately |
| Identity provider | First-party session auth (`appUsers`, HttpOnly session cookie — the standard's preferred browser boundary) + Discord OAuth. External IdP N/A: local auth accepted under §6.1's "equivalent controls and ownership" rule |
| Policy decision point | **Split since the edge armed.** *Authorization* stays in-application (tRPC `publicProcedure` vs protected procedures; role checks in context) — an external authorization PDP remains N/A, policy does not span services/tenants (§6.1 conditional). *Admission* is now partly external: Cloudflare WAF + Super Bot Fight Mode and the `x-dime-agent` Skip rule deny or wave through requests on rules **no repo code can read**, so that decision is not reviewable in-repo and not testable by unit tests. Changes to it are console-side and need their own record |
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
- Deny-by-default: unauthenticated tRPC calls to protected procedures must fail closed (observed: `POST /api/dime/chat` without a session → 401, asserted by the smoke check named *"POST /api/dime/chat unauthenticated → 401 JSON (auth gate)"*).
- Admin/owner operations follow AGENTS.md operating rules (broker-mediated Railway auth, scope-isolated credentials); those rules outrank anything here.

## Security (§11)

- TLS/certs: owned by the edge (Cloudflare in front of Railway; both automatic). In-app duties: HSTS/cookie attributes, CSP (observed: checkout CSP allows Stripe, asserted by the smoke check *"checkout CSP allows Stripe Embedded (script-src js.stripe.com + frame-src checkout.stripe.com)"*).
- CORS: browser policy only, never authorization. Origin allowlist lives in server config; dev origins stay out of production.
- SQLi: Drizzle parameterized queries; raw SQL confined to reviewed modules; dynamic identifiers allowlisted. MySQL placeholders — the standard's `$1` examples are Postgres-flavored, the rule is identical.
- Rate limiting (§11.4): `express-rate-limit` stack in `server/_core/index.ts` (observed: global `/api` limiter + auth/checkout/waitlist limiters, IPv6-safe `ipKeyGenerator`). **Route-class failure policy for this repo:**

| Route class | Limiter store failure | Rationale |
| --- | --- | --- |
| `/health` | never limited | Railway healthcheck failure kills the deploy |
| Auth, checkout, destructive admin | fail closed | rare, human-paced; unthrottled brute force costs more |
| Public feed reads, HTML pages | fail open + alert | the feed is the product; a limiter fault must not become an outage |
| Expensive AI (Dime Chat) | conservative local limits (`dimeChatRateLimit.ts` pattern) | third-party cost class |

- Identity for limiter keys (**corrected 2026-08-05, re-corrected 2026-08-07 for the Cloudflare hop**). **The rule is: never derive identity at a call site.** Call `clientIpKey` for limiter keys (it wraps `ipKeyGenerator`, mandatory for IPv6 /56 normalization — express-rate-limit v8 throws `ERR_ERL_KEY_GEN_IPV6` on a raw address) or `resolveClientIp` for the raw IP — both in `server/_core/trpcRateLimitPolicy.ts` on `main`. Which header is authoritative is **not** a constant — the resolver picks it in this order:

| # | Condition | Source | Why |
| --- | --- | --- | --- |
| 1 | `edgeMode() !== "off"` **and** the request cryptographically proves it came through our Cloudflare edge (valid origin secret + CF-range upstream) | `cf-connecting-ip` | Behind Cloudflare the leftmost sanitized XFF token is the **CF PoP egress IP**, not the visitor — keying on it collapses every user behind a PoP onto one budget and blinds the private-range canary with a public-but-wrong IP |
| 2 | otherwise | leftmost `X-Forwarded-For` entry | **Direct-to-origin shape only.** Railway's edge **sanitizes inbound XFF** (an injected header is discarded) and writes `[trueClient, railwayEdgeInternal]`. This tier is correct only when the request did NOT come through Cloudflare — through it, XFF is `[cloudflarePoP, railwayEdge]` and the visitor appears nowhere in it, which is exactly why tier 1 exists |
| 3 | otherwise | `req.ip` | Last-resort fallback only — never the rule |

The CF proof runs **inline** in both `log` and `on`, deliberately *not* behind the `originLock` middleware, so IP-keying is decoupled from 403 enforcement. That is what makes `EDGE_MODE=on → log` a healthy rollback target: enforcement stops, keys stay correct. With `EDGE_MODE` unset/`off` the resolver is byte-identical to the legacy leftmost-XFF behavior, so the edge merge is inert.

Why not `req.ip` as the rule: under `trust proxy = 1` Express resolves it to the **rotating** Railway edge node (`152.233.x.x`), which simultaneously multiplied per-client budgets and shared budgets across unrelated clients. **Rejected alternative:** raising `trust proxy` to 2 — rejected because `trust proxy` also governs `x-forwarded-proto`/`req.secure` and would risk the secure-cookie path; keying is scoped to limiters instead. Forensic logs may still show the leftmost XFF.

**Named assumption — still OPEN, and the control that was supposed to close it no longer
closes it.** Tier 2 rests on Railway continuing to sanitize inbound XFF; if that platform
behavior changes, every request on that path becomes spoofable. The re-verifiable control
this row asked for was built — `scripts/smoke-deploy.mjs`, check *"rate-limit keying
resists X-Forwarded-For spoofing (Railway sanitizes)"* — but it was written **before** the
Cloudflare edge and is now **vacuous on the only target it runs against**: `deploy-smoke.yml`
points at `https://aisportsbettingmodels.com` (and its header forbids pointing at the raw
origin), so with `EDGE_MODE=on` tier 1 answers both the plain and the spoofed request from
`cf-connecting-ip` and the injected header is never consulted. The check passes whether or
not Railway still sanitizes. Its only bail-out is a localhost guard, which never fires in
production. **Closing this properly needs the assertion run on a non-CF-proven path**
(raw origin with the origin secret withheld, or a request the edge proof deliberately
fails) — until then treat tier 2 as unverified since 2026-08-06. The live control that
does still work is the private/reserved-range canary in `trpcRateLimitPolicy.ts`, which
alerts when a resolved "client" IP is RFC1918/CGNAT/link-local/ULA (loopback deliberately
excluded — the app's own keep-alive calls originate there).

**OPEN — the "never derive identity at a call site" rule is the target, not the current
state of `main`.** Verified 2026-08-07 on `origin/main`, exactly 11 sites still hand-roll
`x-forwarded-for.split(",")[0]` instead of calling the resolver. They are not equally bad
and a change in this area should know which it is touching:

| Site | What it feeds | Impact under the armed edge |
| --- | --- | --- |
| `server/routers/appUsers.ts` (`login`) | `checkLoginRateLimit(clientIp)` | **Decision-driving.** The brute-force lockout keys on the CF PoP egress IP, so users behind one PoP share a lockout budget — the collapse tier 1 exists to prevent |
| `server/routers/appUsers.ts` (`getLoginStatus`) | reads that lockout state | Same key, same collapse |
| `server/routers/waitlist.ts` | stored `ipAddress` column | **Stored value** is the PoP, not the visitor |
| `server/_core/index.ts` ×6 (`:257`, `:282`, `:316`, `:855`, `:893`, `:939`) | limiter over-limit `handler:` bodies (logs, `security_events`, alerts) | Keying is already correct above them — each has a `keyGenerator` using `clientIpKey` — so only the **forensic record** names the wrong client, and only on over-limit events |
| `server/_core/index.ts` ×2 (`:405`, `:598`) | **not limiters.** `:405` is the top-level request logger (`app.use`, mounted before helmet, originLock, and every limiter); `:598` is inside the `GET /health` handler | **No `keyGenerator` above either** — nothing corrects them. `:405` stamps the wrong client on every sampled request, every 5xx, and every slow request; `/health` is never limited at all. Both fall back to `req.socket?.remoteAddress`, not `req.ip` |

Branch `security/edge-identity-remediation` (unmerged as of 2026-08-07) consolidates these
behind `server/_core/clientIdentity.ts` (`resolveClientIdentity` / `clientIdentityKey`) and
deliberately drops the `edgeMode()` gate in tier 1 — its docblock argues the gate makes
`EDGE_MODE=on → off` collapse every limiter onto per-PoP buckets while DNS is still
orange-clouded. **When that branch merges, tier 1 above and this row both change.** Until
then this section describes `main`, per this file's own rule that the files on disk win.

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
| Live smoke | `node scripts/smoke-deploy.mjs <url>` (local and live; cite checks **by name**, never by count or ordinal — the list grows and every ordinal silently shifts); `deploy-smoke.yml` post-merge. Against armed-edge production this needs `EDGE_AGENT_BYPASS_KEY` set, or Cloudflare 403s it as a bot |
| Runtime proof | `verify` skill: prod build + boot on :3910 + drive |

- Release evidence: Railway deployments carry `meta.commitHash` — the deployed-revision proof (used to verify PR #360's deploy). Pair the deploy id + commit hash in every shipped record.
- Resilience (§16): observed behaviors to preserve — server boots with a dead DB and `/health` stays 200 (lazy pool, `consecutiveFailures` tracking); timeouts on tRPC routes speak the envelope. **The edge added four more, and they are now the largest availability surface:** the `/health` origin-lock exemption (Railway's healthcheck must reach the origin directly or the deploy dies), the anti-lockout downgrade (`on` with no secret configured behaves as `log` rather than 403ing the whole site), the self-healing circuit breaker (`edgeCircuitBreaker.ts` drops enforcement to observe-only when Cloudflare stops injecting the secret, then closes itself), and `EDGE_MODE=on → log` as the fast rollback that stops enforcement while keeping limiter keys correct. Preserve all four. **OPEN:** no formal failure-mode test suite for the §16.2 matrix; classify per-change which rows apply.

## Evidence record (§21.3, Dime-adapted)

Copyable template: `record-template.yaml`. It goes in the **PR body** — owner-ruled
2026-08-07 (DR-014, Ruling 2); do not relocate it to a per-PR file. Detail: `routing.md`,
"Evidence record". Authoritative enum: §21.4 of the vendored standard.

Dime field meanings (names follow §21.3 verbatim):
`source_revision` = commit SHA · `artifact_digest` = Railway deployment id + `meta.commitHash` · `migration_revision` = drizzle journal tag (e.g. `0133_favorite_count`) or `none` · `approvals` = owner directives / `db-push.yml` run URLs / PR approvals · `production_mutation` = true for any merge to main (deploy law) · `verification.full_suite` = the gate table above · `verification.live_proof` = Dime addition, smoke/verify output.
