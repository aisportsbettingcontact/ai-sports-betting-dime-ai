# Edge & Identity Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution frame:** every task is one `/eng-loop` cycle per `.claude/skills/engineering-federation/` — classify → baseline → own → define-done → build small → inspect diff → gate → prove live → record. Each task closes with an evidence record (`references/routing.md` template) and a terminal outcome from the fixed enum. A green unit test alone NEVER closes a production boundary.

**Goal:** Close every defect found by the 2026-08-06 five-agent forensic audit — a complete edge bypass, a rate-limiter evasion, a security-event erasure primitive, corrupted client-identity resolution, a self-racing scheduler, and the alerting/governance failures that hid all of it.

**Architecture:** Three-tier remediation. Tier 1 (Phase 0–1) is containment via configuration only — no code, no deploy, reversible in seconds. Tier 2 (Phase 2–4) is code repair, shipped as small independently-revertible PRs, each behind its own gate. Tier 3 (Phase 5–7) closes the governance gap that allowed an unsafe arming, then sweeps the data/pipeline hygiene backlog.

**Tech Stack:** TypeScript strict · Express 4.21.2 · tRPC v11.18.0 · Drizzle/MySQL (Railway `mysql:9.4`) · express-rate-limit v8 · discord.js v14.27.0 · Cloudflare (proxied apex) · Railway (single replica, `sfo`) · GitHub Actions · Vitest

---

## Global Constraints

- **Merge to `main` IS a production deploy.** Railway auto-deploys. There is no staging gate.
- **Schema changes ride the manual `db-push.yml` workflow BEFORE any dependent code deploys.** No exceptions. (This plan is deliberately designed to require ZERO migrations — see Task 3.2's rationale.)
- **`npx tsc --noEmit` must pass.** CI runs it with `NODE_OPTIONS=--max-old-space-size=6144`.
- **pnpm only.** Never npm/yarn.
- **Never commit secrets.** `EDGE_ORIGIN_SECRET`, `EDGE_AGENT_BYPASS_KEY`, `CRON_SECRET` values must never appear in a diff, a log, or an evidence record.
- **Railway mutation and secret-reading MCP tools are deny-listed** in `.claude/settings.json`. All Railway variable/domain changes in this plan are **owner-executed by hand**, not agent-executed.
- **`EDGE_MODE=off` is FORBIDDEN as a rollback.** `resolveClientIp()` only consults `cf-connecting-ip` when `edgeMode() !== "off"`; setting `off` while DNS is orange-clouded instantly collapses all six rate limiters onto per-Cloudflare-PoP buckets. The only safe rollback is `EDGE_MODE=log`. Task 3.1 removes this footgun permanently.
- **Working tree must be synced to `origin/main` before ANY task.** The audit found the local checkout 86 commits behind production; `server/_core/edgeCircuitBreaker.ts` does not exist locally but does in production. See Task 0.1.
- **Production identity is fixed:** Railway project `stunning-creativity` `8dd7341d-702c-48c7-90df-5c19a4f04913`, environment `production` `787f3113-17ab-47d9-9819-1268aeb09b3e`, app service `a46ea921-5c5d-4225-9254-92f742e95b51`, backend service `3528dc9f-a63b-45e9-94bb-6d1df25d6f3a`.
- **Every task's Definition of Done includes:** verbatim gate output pasted into the evidence record, and a terminal outcome from `shipped | rejected | halted_attempts | halted_budget | halted_permission | halted_environment | failed_verification`.

---

## Findings → Task Map (complete coverage index)

Every audited finding maps to at least one task. Nothing is dropped.

| ID | Finding | Severity | Task | Status source |
|---|---|---|---|---|
| P0-1 | Backend service serves the whole app publicly with no edge protection | **P0** | 1.1 | Proven by direct `curl` (HTTP 200 + app HTML) |
| P0-2 | `/api/trpc/<seg>/appUsers.login` defeats all 4 class limiters | **P0** | 2.1 | Proven in code + local harness |
| P0-3 | >256-char path erases the DB row; >1024-char field erases the Discord alert | **P0** | 2.2, 2.3 | Proven against `origin/main` |
| P1-1 | Origin lock 403s real users (recurring resolver-cache episodes) | **P1** | 1.2, 5.1 | Proven symptom; mechanism corrected |
| P1-2 | 12 sites derive client identity wrongly (CF PoP / Railway edge) | **P1** | 3.1, 3.2, 3.3, 3.4 | Proven via XFF logs + proxy-addr harness |
| P1-3 | SEO/social prerender dead — zero `botDetected=true` in 8.5 h | **P1** | 4.1 | Proven absence |
| P1-4 | MLB cycle overlaps itself (3 concurrent, no re-entrancy guard) | **P1** | 3.5 | Proven by START/DONE ledger |
| P1-5 | Stripe webhook has no origin-lock exemption | **P1** | 0.3, 4.2 | Mechanism proven; exposure gated on owner check |
| A1 | `buildEmbed` outside try/catch → alert suppression | **P0** | 2.3 | Proven |
| A2 | `trpcPath` uncapped into `varchar(256)` | **P0** | 2.2 | Proven |
| A3 | `fireRateLimitEvent` fires on non-blocking origin-lock kinds | **P1** | 4.3 | Proven |
| A4 | Limiter-label map covers 3 of 8 slugs; copy hardcodes "429" | **P1** | 4.4 | Proven |
| A5 | Alert advises firewalling T-Mobile/Meta/CI/Cloudflare/Railway IPs | **P1** | 4.4 | Proven |
| A6 | Discord dedup key `(eventType, ip)` lacks path/class | **P1** | 4.5 | Proven |
| A7 | Brute-force window keyed on CF PoP | **P1** | 3.2 | Proven |
| A8 | No global alert budget; O(n) prune per event under flood | **P1** | 4.6 | Proven |
| A9 | Timestamps hardcode " EST" but render EDT | **P2** | 4.7 | Proven |
| A10 | `logSafe` applied to zero embed fields | **P2** | 4.8 | Proven |
| A11 | Digests bucket only on `eventType`, never `context` | **P1** | 4.9 | Proven by today's digest |
| A12 | Digest counts are a 1/60s-deduped sample presented as volume | **P2** | 4.9 | Proven |
| A13 | `SecurityEventType` has no breaker members; switch has no `default` | **P2** | 4.4 | Proven |
| A14 | `notifyOwner returned false` logged and never escalated | **P2** | 4.10 | Observed |
| A15 | `lastDigestDateUTC` in-memory; restart in the fire minute skips the day | **P2** | 4.10 | Inferred |
| M-5 | Circuit breaker cannot trip for partial bypass; trip = alert flood | **P1** | 5.4 | Proven by config read |
| M-6 | Model validation failing every ~5 min, message truncated to `[` | **P1** | 6.1 | Proven |
| M-7 | Dime Chat blueprint fallback on boot; `/api/dime/chat` origin-locked | **P2** | 6.2 | Proven |
| M-8 | `[ANHRPropsAPI] [SKIP] player_id not in players dict` ×~90 | **P2** | 6.3 | Proven |
| M-9 | Log volume masks the security stream (10% sampling, no priority) | **P2** | 6.4 | Inferred |
| M-10 | `edge_no_secret` = unprotected site + per-request alert flood | **P1** | 4.3, 5.3 | Proven by code |
| M-11 | Daily digest threat model inverted (top-5 = our own CI + owner) | **P1** | 4.9 | Proven |
| G-1 | Runbook arming gate crossed; soak was 18–23 synthetic probes | **P1** | 5.5 | Proven (D1/D2) |
| G-2 | `EDGE_AGENT_BYPASS_KEY` set as Railway var; doc says it must not be | **P1** | 5.2 | Proven |
| G-3 | `EDGE_ORIGIN_SECRET_PREV` unset → rotation = guaranteed 403 window | **P1** | 5.3 | Proven |
| G-4 | Neither Tunnel nor mTLS built; shipped design is "interim" option C | **P1** | 5.1 | Proven |
| G-5 | Cache Rules / URL normalization / edge rate limiting absent | **P2** | 5.6 | Proven |
| G-6 | No external synthetic monitor (`/health` is lock-exempt) | **P1** | 5.7 | Proven |
| D3–D9 | Seven doc-vs-runtime contradictions | **P2** | 7.2 | Proven |
| C-1 | `stripe-reconcile`, `bet-grade-sweep`, `mlb-canonical-refresh` dark | **P1** | 6.5 | Proven |
| C-2 | `os-observe-crons` (missed-cron detector) is itself scheduled | **P2** | 6.5 | Proven |
| H-1 | Eager seeders re-run on every deploy (~25×/day; 7-day seeders ~175× over-run) | **P2** | 6.6 | Proven |
| H-2 | Off-season NBA/NHL polled 24/7, 100% empty (~5,760 no-op calls/day) | **P2** | 6.7 | Proven |
| H-3 | Diacritic mismatch silently overrides authoritative pitcher source | **P2** | 6.8 | Proven |
| H-4 | RotoScraper parses trailing empty DOM node as a card | **P3** | 6.9 | Proven |
| H-5 | `bookTotal=0` reported as "a whole number" | **P3** | 6.9 | Proven |
| H-6 | HR-props counter reports `inserted=209 updated=0` unconditionally | **P2** | 6.9 | Proven |
| H-7 | `mlb_game_backtest` fallback silently no-ops while reporting success | **P2** | 6.10 | Proven |
| H-8 | Scheduler banner claims 10 min / gated hours; code is 5 min / 24-7 | **P2** | 6.11 | Proven |
| H-9 | Railway maps `console.warn` → `severity:"error"`; no warn tier | **P2** | 6.11 | Proven |
| H-10 | `/favicon.ico` + `/apple-touch-icon*.png` 404 | **P3** | 6.12 | Proven |
| H-11 | MySQL has zero observability (`--performance_schema=0`, no error log) | **P2** | 6.13 | Proven |
| H-12 | `waitlist.ipAddress` rows store CF PoP IPs (irrecoverable) | **P2** | 3.4, 6.14 | Proven mechanism; scope unknown |
| H-13 | `security_events.ip` corrupted two different ways | **P2** | 3.3, 6.14 | Proven |
| H-14 | Config drift: `railway.json` says DOCKERFILE, service says RAILPACK | **P3** | 7.2 | Proven |
| H-15 | `p0-feed-verify.yml` is the only prod-touching workflow with no `environment:` | **P2** | 6.5 | Proven |
| H-16 | 8 phantom workflow records in the Actions API | **P3** | 7.2 | Proven |
| H-17 | 4.6 s `oddsHistory.listForDemoGame` on the landing path | **P3** | 6.15 | Single sample |
| H-18 | `[DB_KEEPALIVE]` labelled "TiDB" on a MySQL service | **P3** | 6.11 | Proven |
| X-1 | Local checkout 86 commits behind production | **BLOCKER** | 0.1 | Proven |

**Explicitly REFUTED — do not build fixes for these:**
- Duplicate rows from the double-writer. All three tables carry unique constraints in applied DDL (`mlb_lineups_gameId_unique`, `uq_game_side`, `uq_backtest_game_market`). Task 7.2 corrects the false comments instead.
- A second outage queued behind Actions recovery. `RAILWAY_APP_URL = https://aisportsbettingmodels.com`; crons traverse Cloudflare. Proven `HTTP 200` on the current deployment.
- Stale post-cutover DNS as the F-1 mechanism. Replaced by recurring short-lived resolver-cache episodes (same client 403 → 200 in 4 m 29 s ≈ one 300 s TTL).

---

## File Structure

**Created:**
- `server/_core/clientIdentity.ts` — single exported surface for "who is this request from". Absorbs the correct resolver and forbids hand-rolled XFF parsing anywhere else. One responsibility: identity.
- `server/_core/clientIdentity.test.ts` — production-shaped XFF fixtures (two-token `[CF PoP, Railway edge]`), the direct-origin case, and the `EDGE_MODE` independence property.
- `server/_core/securityEventLimits.ts` — column-width and embed-width constants shared by the DB writer and the Discord builder, so the two can never drift apart again.
- `server/_core/securityEventLimits.test.ts`
- `docs/runbooks/edge-origin-exemptions.md` — the authoritative list of origin-lock exempt paths and why each is exempt.
- `docs/audits/2026-08-06-edge-identity-forensic/EVIDENCE.md` — the audit's evidence bundle and every task's evidence record.

**Modified:**
- `server/_core/trpcRateLimitPolicy.ts` — classifier must mirror tRPC's own procedure resolution.
- `server/_core/index.ts` — six limiter handlers, the origin-lock `onEvent` wiring, the request logger, `/health` logger.
- `server/_core/trpc.ts` — CSRF and Stripe request loggers.
- `server/_core/originLock.ts` — exemption list.
- `server/routers/appUsers.ts` — login + `getLoginStatus` identity.
- `server/routers/waitlist.ts` — persisted identity.
- `server/db.ts` — `insertSecurityEvent` truncation.
- `server/discord/discordSecurityAlert.ts` — label map, copy, dedup key, budget, timezone, `logSafe`, build-inside-try.
- `server/securityDigest.ts`, `server/weeklySecurityDigest.ts` — bucket by `context`.
- `server/vsinAutoRefresh.ts` — MLB cycle re-entrancy guard, seeder gating, banner.
- `server/landingPrerender.ts` — bot allowlist verification.
- `.github/workflows/cron-mlb-cycle.yml`, `references/railway-deploy.md` — false unique-constraint claims.
- `docs/runbooks/edge-defense-cloudflare.md`, `docs/runbooks/anti-scraping-config.md` — reconcile with runtime.

---

# PHASE 0 — PREFLIGHT (BLOCKING — no code may be written until these close)

## Task 0.1: Sync the working tree to production

**Why first:** The audit proved the local checkout is 86 commits behind `origin/main`. `server/_core/edgeCircuitBreaker.ts` (195 lines, PR #414) does not exist locally. Any edit made against the stale tree would be written against code that is not deployed, and would conflict or silently revert PRs #414–#429.

**Files:** none modified — repository state only.

- [ ] **Step 1: Record the baseline drift**

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai
git rev-parse HEAD
git rev-parse origin/main
git rev-list --count HEAD..origin/main
git status --porcelain
```

Expected: HEAD `0853c820f`, origin/main `bf51cb0`, count `86`, plus the known-dirty files (`scripts/dime-production-auth.mjs`, `scripts/smoke-deploy.mjs`, and untracked audit scratch). Paste verbatim into the evidence record.

- [ ] **Step 2: Preserve the dirty working files**

```bash
git stash push -u -m "pre-remediation-2026-08-06" \
  scripts/dime-production-auth.mjs scripts/smoke-deploy.mjs
git stash list
```

- [ ] **Step 3: Fetch and create the remediation branch from production HEAD**

```bash
git fetch origin
git checkout -b security/edge-identity-remediation origin/main
git rev-parse HEAD
```

Expected: prints `bf51cb0500838f5ac526dbe3318e6e95c12d948c`.

- [ ] **Step 4: Verify the production-only files now exist**

```bash
test -f server/_core/edgeCircuitBreaker.ts && echo "OK: circuit breaker present"
wc -l server/_core/edgeCircuitBreaker.ts
```

Expected: `OK: circuit breaker present`, ~195 lines.

- [ ] **Step 5: Confirm a clean baseline build**

```bash
pnpm install --frozen-lockfile
npx tsc --noEmit
```

Expected: no output (success). If this fails, STOP — the baseline is broken and no remediation claim can be attributed to this plan.

- [ ] **Step 6: Commit nothing; record the baseline**

Write to `docs/audits/2026-08-06-edge-identity-forensic/EVIDENCE.md`:
- `source_revision`, `baseline` (revision + tsc result), `classification: preflight`, `production_mutation: false`, `outcome: shipped`.

**Terminal outcome:** `shipped` when tsc is green on `origin/main`. `halted_environment` if the baseline build fails.

---

## Task 0.2: Capture the pre-remediation production baseline

**Why:** eng-loop step 3 — no before/after claim without a before. Every later "we fixed it" needs this.

**Files:** Create `docs/audits/2026-08-06-edge-identity-forensic/BASELINE.md`

- [ ] **Step 1: Record the origin-lock anomaly rate**

Query Railway deploy logs, filter `EDGE_ORIGIN_INGRESS_ANOMALY`, window = current deployment start (`2026-08-06T13:19:47Z`) → now. Record: total events, distinct IPs, distinct paths, and the count that paired with an HTTP 403 in the `http` stream.

Baseline as audited: **22 events, 7 IPs, 6 clusters, 15:22:20Z–20:48:23Z, 22/22 paired with 403.**

- [ ] **Step 2: Record the HTTP status histogram**

Pull `types: ["http"]`, `limit: 500`. Record the full histogram.

Baseline as audited: `449×200, 20×404, 18×304, 5×308, 5×403, 2×401, 2×499` over 19:52:07Z–21:44:03Z. **Zero 429.**

- [ ] **Step 3: Record the MLB cycle START/DONE ledger**

Filter `"[MLBCycle] ► START" OR "[MLBCycle] ✅ DONE"` over a 60-minute window. Record every timestamp.

Baseline as audited: **12 STARTs, 10 DONEs in 56 minutes; three cycles concurrently in flight at 21:15/21:20/21:25.**

- [ ] **Step 4: Record the prerender bot-detection count**

Filter `botDetected=true` over the full current deployment.

Baseline as audited: **zero occurrences in 8.5 hours.**

- [ ] **Step 5: Record the backend exposure**

```bash
curl -sS -o /dev/null -D - -m 25 https://ai-sports-betting-backend-production.up.railway.app/ | head -3
```

Baseline as audited: `HTTP/2 200`, `content-type: text/html`, full app `<title>`.

- [ ] **Step 6: Commit the baseline**

```bash
git add docs/audits/2026-08-06-edge-identity-forensic/BASELINE.md
git commit -m "docs(audit): capture pre-remediation production baseline"
```

**Terminal outcome:** `shipped`.

---

## Task 0.3: OWNER ACTION — resolve the two questions that gate severity

**Why:** Two findings cannot be severity-rated from inside this session. Both are sub-minute checks the owner must perform. Task 4.2 branches on the first.

- [ ] **Step 1: Stripe webhook endpoint host**

Open the Stripe Dashboard → Developers → Webhooks. Read the registered endpoint URL for the production account.

Record which of these it is:
- `https://aisportsbettingmodels.com/api/stripe/webhook` → **SAFE.** Traverses Cloudflare, secret injected, lock never engaged. Task 4.2 becomes defence-in-depth only.
- `https://<anything>.up.railway.app/api/stripe/webhook` → **ACTIVE P0.** Every webhook has been silently 403'd since `EDGE_MODE=on` (~08:03Z, 2026-08-06). Subscription state is drifting right now. Task 4.2 escalates to Phase 1 and executes immediately.

- [ ] **Step 2: Check Stripe's webhook delivery log**

In the same dashboard view, open the endpoint's recent deliveries. Record the count of failed/403 deliveries since 2026-08-06T08:00Z. This is the definitive exposure measurement — it is authoritative in a way our logs are not (we found zero `[StripeWebhook]` lines in 8.5 h, which is ambiguous between "no events" and "all blocked").

- [ ] **Step 3: Decide the EDGE_MODE posture for the remediation window**

Choose one and record the decision with a timestamp:
- **(A) `EDGE_MODE=log` now** — stops 403ing real users immediately; keeps IP keying correct (the `log` branch still runs `resolveClientIp`'s Cloudflare path); the documented healthy rollback. Costs enforcement until Task 5.1 lands.
- **(B) Stay `on`** — accepts the recurring user 403s for the duration of the plan.

**NEVER choose `EDGE_MODE=off`** — see Global Constraints.

- [ ] **Step 4: Record both answers in the evidence bundle**

**Terminal outcome:** `shipped` once both answers are recorded. `halted_permission` if the owner is unavailable — Phase 1 may proceed, but Task 4.2 blocks.

---

# PHASE 1 — P0 CONTAINMENT (configuration only, no deploy, seconds to reverse)

## Task 1.1: Close the complete edge bypass — remove the backend's public domain

**Classification:** trust boundary = public ingress; failure impact = **SECURITY (P0)**.

**The finding, proven:** `ai-sports-betting-backend-production.up.railway.app` returns `HTTP/2 200` with 12,522 bytes of the real application (`<title>dıme — See where price and probability disagree…`). The service is built from the **same repo and same `main` branch**, registers every route unconditionally (`server/_core/index.ts` route registration is not role-gated; only the analytics ingest/read routes are), and holds `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_SESSION_SECRET`, `DISCORD_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `CRON_SECRET`. It has **no `EDGE_MODE` and no `EDGE_ORIGIN_SECRET`**, so `originLock` short-circuits at `if (mode === "off") return next()`.

**Consequence:** the origin lock, WAF, Super Bot Fight Mode, the PR #414 circuit breaker, the `public_feed` rate-limit class, and the anon-strip protections all guard **one of two** internet-facing copies of the application. Meta has already crawled the unprotected one (`GET /robots.txt` → 206 from `173.252.82.25`).

**Why removal, not hardening:** the backend's only legitimate consumer is the app service, which reaches it over the private network via `USER_ACTIVITY_BACKEND_URL`. Proven by its logs — the ONLY inbound traffic in 8h25m was `POST /api/internal/analytics/ingest` from `ai-sports-betting-backend.railway.internal:8080`, plus one Meta crawl. A public domain has no consumer. Removing it is strictly better than replicating the edge secret to a second service (fewer secrets, smaller blast radius, nothing to keep in sync).

- [ ] **Step 1: Prove the private path is the only one in use**

Query the backend service's `http` log stream over the last 24 h. Confirm every request is either `railway.internal` or the single Meta `robots.txt` hit.

Expected (audited): exactly one public request in the full window.

- [ ] **Step 2: Confirm the app reaches the backend privately, not publicly**

```bash
git show origin/main:server/analytics/config.ts | grep -n "USER_ACTIVITY_BACKEND_URL\|railway.internal\|ANALYTICS_ROLE"
```

Confirm the forwarder targets the internal hostname. If it targets the PUBLIC hostname, STOP — removing the domain would break analytics. Record which it is.

- [ ] **Step 3: OWNER ACTION — remove the public service domain**

Railway dashboard → project `stunning-creativity` → environment `production` → service `ai-sports-betting-backend` → Settings → Networking → **delete the public domain** `ai-sports-betting-backend-production.up.railway.app`.

This is a Railway mutation and is owner-gated. Do NOT attempt via MCP — those tools are deny-listed.

- [ ] **Step 4: Verify the bypass is closed**

```bash
curl -sS -o /dev/null -w 'status=%{http_code}\n' -m 25 \
  https://ai-sports-betting-backend-production.up.railway.app/
```

Expected: connection failure or a Railway 404 — **not** `200` with app HTML.

- [ ] **Step 5: Verify analytics still flows**

Query the backend deploy logs for `POST /api/internal/analytics/ingest` with `status=202`. Confirm ingest continues after the domain removal.

Expected: `202` responses continuing at the pre-change cadence.

- [ ] **Step 6: Verify the app service is untouched**

```bash
curl -sS -o /dev/null -w 'status=%{http_code}\n' -m 25 https://aisportsbettingmodels.com/
```

Expected: `200`.

- [ ] **Step 7: Record**

Evidence record with `production_mutation: true`, `approvals: <owner, timestamp>`, before/after curl output verbatim, and `rollback_or_containment: re-add the service domain in Railway (restores the pre-change state exactly)`.

**Terminal outcome:** `shipped` when Step 4 returns non-200 AND Step 5 confirms analytics unbroken. `halted_permission` if the owner has not acted.

---

## Task 1.2: Stop 403ing real users (conditional on Task 0.3 Step 3)

**Classification:** trust boundary = edge ingress; failure impact = **AVAILABILITY (P1)**.

**The finding, proven:** six clusters of legitimate clients received a zero-byte 403 (`res.status(403).end()` — blank page, no explanation, no support path) on `/`, `/feed`, `/feed/model/mlb-08-06-2026`, and `/login`.

**Mechanism — corrected from the first-pass analysis.** It is NOT stale post-cutover DNS. Apex TTL is 300 s while the 403 tail ran 13.5 hours; the NS delegation never changed (registry `Updated Date` is 2026-07-10, not today); and five of five consumer clients are on one carrier while Verizon/Charter/Fastly clients got 200s in the same minutes. The decisive datum: the **same client** was 403'd on `/login` + icons at `20:48:23Z` and served **200/404/304 on the identical path sequence at 20:52:52Z** — 4 m 29 s later, ≈ one 300 s TTL. This is a **recurring, short-lived resolver-cache episode that self-heals within one TTL**. Two of the seven IPs (genuine Meta, `173.252.70.72/.114`) are a different mechanism entirely — they sent `Host: ai-sports-betting-dime-ai-production.up.railway.app`, so no DNS staleness is involved; Meta simply has the raw origin URL in its crawl corpus.

**Why this is containment, not a fix:** the real fix is Task 5.1 (remove the reachable origin IP entirely). This task only stops the bleeding.

- [ ] **Step 1: Execute the Task 0.3 Step 3 decision**

If **(A)**: OWNER ACTION — Railway → app service → Variables → set `EDGE_MODE=log`. This triggers a redeploy.

If **(B)**: skip to Step 4 and record the accepted risk explicitly.

- [ ] **Step 2: Verify `log` mode is live and non-enforcing**

Query the deploy log stream for `EDGE_ORIGIN_INGRESS_ANOMALY` after the redeploy, and cross-reference the same timestamps in the `http` stream.

Expected: anomaly events **continue** (they are the observability signal) but the paired HTTP status is now **200/304, not 403**.

- [ ] **Step 3: Verify IP keying did NOT collapse**

This is the critical check that distinguishes `log` from the forbidden `off`. Query `[HTTP_REQUEST]` lines and confirm limiter keys are still derived from `cf-connecting-ip`.

Proof method: confirm no `xff_canary` events fire, and confirm the `/api/trpc` edge-anomaly canary count stays at its baseline. If limiter keying had collapsed to PoP buckets, unrelated users would begin sharing budgets — detectable as a sudden rise in `public_feed` or `global` limiter events.

Expected: zero change in limiter-class event counts.

- [ ] **Step 4: Record**

Evidence record with `production_mutation: true`, the before/after 403 counts, and `rollback_or_containment: EDGE_MODE=log → on restores enforcement in one variable change`.

**Terminal outcome:** `shipped` under (A) when 403s stop and keying holds. `rejected` under (B) with the accepted-risk statement recorded.

---

# PHASE 2 — P0 CODE REPAIR

## Task 2.1: Close the tRPC path-segment limiter bypass

**Classification:** trust boundary = authenticated + public API; failure impact = **SECURITY (P0)**.

**The finding, proven:** tRPC's Express adapter resolves the procedure from everything after the **last** slash:

```js
// node_modules/@trpc/server/dist/adapters/express.mjs
path = req.path.slice(req.path.lastIndexOf("/") + 1);
```

But `parseTrpcProcedureList` strips only a **leading** slash. Executed against the real module:

```
"/appUsers.login"                        → procs= ["appUsers.login"]                       class= auth
"/x/appUsers.login"                      → procs= ["x/appUsers.login"]                     class= null
"/a/b/appUsers.login,appUsers.me"        → procs= ["a/b/appUsers.login","appUsers.me"]     class= null
"/x/stripe.publicCreateCheckoutSession"  → procs= ["x/stripe.publicCreateCheckoutSession"] class= null
"/x/games.list"                          → procs= ["x/games.list"]                         class= null
```

`createTrpcRateLimitDispatch` returns `next()` on a null class, so **no limiter runs** while tRPC executes the procedure. This defeats `auth` (5/15 min), `stripe_checkout` (10/15 min — the limiter built specifically for the 2026-05-24 rotating-origin probes), `waitlist` (5/15 min), and `public_feed` (60/min — the anti-scraping cap on model IP). Login goes from 5 per 15 min to the 200/min `globalApiLimiter` — a **600× amplification**.

This is the same evasion class the module's own header was written to close; the AUTH-004 fix covered comma-batching and URL-encoding but not path-segment prefixing.

**The fix:** mirror tRPC's resolution exactly. Slice the RAW path at the last slash **before** decoding (Express does not decode `req.path`, and tRPC slices raw then decodes — decoding first would let `%2F` desynchronise the two).

**Files:**
- Modify: `server/_core/trpcRateLimitPolicy.ts` (`parseTrpcProcedureList`)
- Test: `server/_core/trpcRateLimitPolicy.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseTrpcProcedureList(path: string): string[]` — unchanged signature, corrected semantics.

- [ ] **Step 1: Write the failing tests**

Add to `server/_core/trpcRateLimitPolicy.test.ts`:

```ts
describe("parseTrpcProcedureList — path-segment evasion (2026-08-06 audit)", () => {
  // tRPC's express adapter resolves the procedure from everything after the
  // LAST slash: path.slice(path.lastIndexOf("/") + 1). Any classifier that
  // reads the whole mount-relative path can be desynchronised from it by
  // prefixing a segment, which previously yielded class=null (no limiter)
  // while tRPC still executed the procedure.
  it("classifies a single-segment-prefixed login as auth", () => {
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/x/appUsers.login")))
      .toBe("auth");
  });

  it("classifies a multi-segment-prefixed batched login as auth", () => {
    expect(
      classifyTrpcProcedures(
        parseTrpcProcedureList("/a/b/appUsers.login,appUsers.me")
      )
    ).toBe("auth");
  });

  it("classifies a prefixed checkout as stripe_checkout", () => {
    expect(
      classifyTrpcProcedures(
        parseTrpcProcedureList("/x/stripe.publicCreateCheckoutSession")
      )
    ).toBe("stripe_checkout");
  });

  it("classifies a prefixed waitlist submit as waitlist", () => {
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/x/waitlist.submit")))
      .toBe("waitlist");
  });

  it("classifies a prefixed feed read as public_feed", () => {
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/x/games.list")))
      .toBe("public_feed");
  });

  it("still classifies the ordinary unprefixed path", () => {
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/appUsers.login")))
      .toBe("auth");
  });

  it("preserves the URL-encoding defence (AUTH-004)", () => {
    expect(classifyTrpcProcedures(parseTrpcProcedureList("/appUsers.logi%6E")))
      .toBe("auth");
  });

  it("preserves the comma-batch defence (AUTH-004)", () => {
    expect(
      classifyTrpcProcedures(
        parseTrpcProcedureList("/appUsers.login,appUsers.me")
      )
    ).toBe("auth");
  });

  it("slices on the RAW path so an encoded slash cannot desynchronise us", () => {
    // %2F is NOT a path separator to Express or to tRPC's lastIndexOf("/").
    // Decoding before slicing would find a different last slash than tRPC does.
    expect(parseTrpcProcedureList("/appUsers.login%2Fx")).toEqual([
      "appUsers.login/x",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run server/_core/trpcRateLimitPolicy.test.ts -t "path-segment evasion"
```

Expected: FAIL — the five prefixed cases return `null` instead of their class.

- [ ] **Step 3: Implement the fix**

Replace `parseTrpcProcedureList` in `server/_core/trpcRateLimitPolicy.ts`:

```ts
export function parseTrpcProcedureList(path: string): string[] {
  // Mirror tRPC's express adapter EXACTLY. It resolves the procedure list from
  // everything after the LAST slash of the RAW path:
  //   path = req.path.slice(req.path.lastIndexOf("/") + 1)
  // (@trpc/server/dist/adapters/express.mjs). Stripping only a LEADING slash
  // desynchronised the classifier from the router: `/x/appUsers.login` parsed
  // as the single unknown procedure "x/appUsers.login" -> class null -> NO
  // limiter, while tRPC sliced to "appUsers.login" and EXECUTED it. That is
  // the AUTH-004 evasion class via path-segment prefixing (2026-08-06 audit).
  //
  // Slice BEFORE decoding: Express does not percent-decode req.path, and tRPC
  // slices raw then decodes. Decoding first would let an encoded %2F move the
  // "last slash" for us but not for tRPC, reopening the desync.
  let raw = path.slice(path.lastIndexOf("/") + 1);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* malformed percent-encoding — tRPC 404s it; classify the raw form */
  }
  return raw
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run server/_core/trpcRateLimitPolicy.test.ts
```

Expected: PASS, including every pre-existing test in the file (the AUTH-004 comma and encoding cases must still pass — if any regress, the fix is wrong).

- [ ] **Step 5: Add the defence-in-depth observability signal**

No legitimate tRPC client emits a mount-relative path containing a slash. Emit an anomaly when one appears, so a future desync is visible rather than silent. In `server/_core/trpcRateLimitPolicy.ts`, inside `createTrpcRateLimitDispatch`, before classification:

```ts
    // No legitimate tRPC client sends a mount-relative path containing "/".
    // The classifier now mirrors tRPC's own slicing, so this is no longer an
    // evasion — but its appearance means someone is probing the shape that
    // used to work. Observe-only; never blocks.
    if (req.path.replace(/^\//, "").includes("/")) {
      console.warn(
        `[RateLimit][TRPC_PATH_SEGMENT] anomalous mount-relative path=${logSafe(req.path)}`
      );
    }
```

Add the `logSafe` import if not already present.

- [ ] **Step 6: Run the full type check and the affected suites**

```bash
npx tsc --noEmit
npx vitest run server/_core/trpcRateLimitPolicy.test.ts server/loginStatus.test.ts
```

Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add server/_core/trpcRateLimitPolicy.ts server/_core/trpcRateLimitPolicy.test.ts
git commit -m "fix(security): close tRPC path-segment rate-limiter evasion

The classifier read the whole mount-relative path while tRPC's express
adapter resolves the procedure from everything after the LAST slash. A
prefixed path (/api/trpc/x/appUsers.login) therefore classified as an
unknown procedure -> no limiter -> the procedure executed anyway,
defeating auth (5/15min), stripe_checkout, waitlist and public_feed.
Login dropped from 5/15min to the 200/min global cap.

Mirrors the adapter exactly: slice the RAW path at the last slash before
decoding. Preserves the AUTH-004 comma-batch and URL-encoding defences."
```

- [ ] **Step 8: Prove live after deploy**

After the PR merges (which deploys), verify through Cloudflare with a **public read** procedure — never with the login procedure, which would be a brute-force test against production:

```bash
curl -sS -o /dev/null -w 'status=%{http_code} ratelimit=%{header_json}\n' -m 20 -G \
  --data-urlencode "batch=1" \
  "https://aisportsbettingmodels.com/api/trpc/x/games.getCurrentDate"
```

Expected: the response now carries the `public_feed` limiter's `RateLimit-Policy` header (`60`), proving the prefixed path is classified. Compare against the unprefixed control.

**Definition of Done:** all nine tests pass; `tsc` clean; the live probe shows the prefixed path carrying a limiter policy header.

**Terminal outcome:** `shipped` only after the live probe. `failed_verification` if the deployed behaviour differs from the test.

---

## Task 2.2: Stop the DB-side security-event erasure

**Classification:** trust boundary = security telemetry; failure impact = **SECURITY (P0)**.

**The finding, proven against `origin/main`:**

```
drizzle/schema.ts:2270   trpcPath: varchar("trpcPath", { length: 256 })
server/db.ts:2701        trpcPath: event.trpcPath ?? null            ← NO truncation
server/db.ts:2703        userAgent: event.userAgent.substring(0, 512) ← truncated
```

A request with a >256-character path raises `ER_DATA_TOO_LONG`; the insert fails and is swallowed by the `catch` that logs it as "non-critical". The attacker's event is absent from `security_events`. This is the same varchar-too-short class as the K-props sentinel fixed in PR #418.

**Why truncate rather than widen the column:** widening requires a migration, which under repo law must ride `db-push.yml` **before** any dependent code deploys — turning a five-minute fix into a two-deploy sequence during an active incident. Truncation preserves the security property (the event is recorded) with zero schema risk. Widening is tracked as an optional follow-up in Task 7.3.

**Files:**
- Create: `server/_core/securityEventLimits.ts`
- Create: `server/_core/securityEventLimits.test.ts`
- Modify: `server/db.ts` (`insertSecurityEvent`)

**Interfaces:**
- Produces: `SECURITY_EVENT_LIMITS: { ip: number; blockedOrigin: number; trpcPath: number; httpMethod: number; userAgent: number; context: number }` and `truncateForColumn(value: string | null | undefined, max: number): string | null`.

- [ ] **Step 1: Write the failing test**

Create `server/_core/securityEventLimits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SECURITY_EVENT_LIMITS,
  truncateForColumn,
} from "./securityEventLimits";

describe("securityEventLimits", () => {
  it("matches the security_events column widths in drizzle/schema.ts", () => {
    // These MUST equal the varchar lengths. A drift here is the defect class
    // that let a >256-char path drop the row entirely (2026-08-06 audit).
    expect(SECURITY_EVENT_LIMITS.trpcPath).toBe(256);
    expect(SECURITY_EVENT_LIMITS.userAgent).toBe(512);
  });

  it("truncates an over-long value to the column width", () => {
    const long = "a".repeat(1000);
    expect(truncateForColumn(long, 256)).toHaveLength(256);
  });

  it("leaves a short value untouched", () => {
    expect(truncateForColumn("/api/trpc/games.list", 256)).toBe(
      "/api/trpc/games.list"
    );
  });

  it("maps null and undefined to null", () => {
    expect(truncateForColumn(null, 256)).toBeNull();
    expect(truncateForColumn(undefined, 256)).toBeNull();
  });

  it("maps empty string to null (an empty column is not a value)", () => {
    expect(truncateForColumn("", 256)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run server/_core/securityEventLimits.test.ts
```

Expected: FAIL — `Cannot find module './securityEventLimits'`.

- [ ] **Step 3: Implement**

Create `server/_core/securityEventLimits.ts`:

```ts
/**
 * Column-width limits for `security_events`, kept in ONE place so the DB
 * writer and the Discord embed builder can never drift from the schema.
 *
 * Why this file exists (2026-08-06 forensic audit): `insertSecurityEvent`
 * truncated `userAgent` to 512 but wrote `trpcPath` uncapped into a
 * varchar(256). A request with a >256-char path raised ER_DATA_TOO_LONG, the
 * insert failed, and the catch logged it "non-critical" — so an attacker
 * could erase their own security event with one long URL. Same defect class
 * as the k-props NAME_MATCH_FAILED sentinel (PR #418).
 *
 * These values MUST equal the varchar lengths in drizzle/schema.ts.
 * securityEventLimits.test.ts asserts that.
 */
export const SECURITY_EVENT_LIMITS = {
  ip: 64,
  blockedOrigin: 256,
  trpcPath: 256,
  httpMethod: 8,
  userAgent: 512,
  context: 64,
} as const;

/**
 * Clamp a value to a column width. Empty and nullish both become null — an
 * empty column carries no information and null is the honest representation.
 */
export function truncateForColumn(
  value: string | null | undefined,
  max: number
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value.length > max ? value.substring(0, max) : value;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run server/_core/securityEventLimits.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Verify the constants against the live schema**

```bash
grep -n "trpcPath\|blockedOrigin\|httpMethod\|userAgent\|context\|  ip:" drizzle/schema.ts | sed -n '/securityEvents/,+10p'
grep -n "varchar(\"trpcPath\"\|varchar(\"userAgent\"\|varchar(\"ip\"\|varchar(\"blockedOrigin\"\|varchar(\"httpMethod\"\|varchar(\"context\"" drizzle/schema.ts
```

Reconcile every constant against the printed lengths. If any differs, fix the constant (the schema is authoritative) and re-run Step 4.

- [ ] **Step 6: Apply it in `insertSecurityEvent`**

In `server/db.ts`, replace the `.values({...})` block:

```ts
    await db.insert(securityEvents).values({
      eventType: event.eventType,
      // Every varchar column is clamped. Previously only userAgent was, so a
      // >256-char trpcPath raised ER_DATA_TOO_LONG and the row was LOST —
      // letting an attacker erase their own event with one long URL.
      ip: truncateForColumn(event.ip, SECURITY_EVENT_LIMITS.ip) ?? "unknown",
      blockedOrigin: truncateForColumn(
        event.blockedOrigin,
        SECURITY_EVENT_LIMITS.blockedOrigin
      ),
      trpcPath: truncateForColumn(
        event.trpcPath,
        SECURITY_EVENT_LIMITS.trpcPath
      ),
      httpMethod: truncateForColumn(
        event.httpMethod,
        SECURITY_EVENT_LIMITS.httpMethod
      ),
      userAgent: truncateForColumn(
        event.userAgent,
        SECURITY_EVENT_LIMITS.userAgent
      ),
      context: truncateForColumn(event.context, SECURITY_EVENT_LIMITS.context),
      occurredAt: event.occurredAt,
    });
```

Add the import at the top of `server/db.ts`:

```ts
import {
  SECURITY_EVENT_LIMITS,
  truncateForColumn,
} from "./_core/securityEventLimits";
```

- [ ] **Step 7: Add the regression test for the writer**

Append to `server/_core/securityEventLimits.test.ts`:

```ts
describe("insertSecurityEvent field clamping (regression)", () => {
  it("clamps a 1000-char path to the trpcPath column width", () => {
    // The exact attack shape: GET /<1000 chars>. Before the fix this produced
    // ER_DATA_TOO_LONG and the event vanished from security_events.
    const attackPath = "/" + "a".repeat(999);
    expect(
      truncateForColumn(attackPath, SECURITY_EVENT_LIMITS.trpcPath)
    ).toHaveLength(256);
  });

  it("clamps an over-long httpMethod (the narrowest column)", () => {
    expect(
      truncateForColumn("A".repeat(64), SECURITY_EVENT_LIMITS.httpMethod)
    ).toHaveLength(8);
  });
});
```

- [ ] **Step 8: Run the full gate**

```bash
npx tsc --noEmit
npx vitest run server/_core/securityEventLimits.test.ts
```

Expected: both green.

- [ ] **Step 9: Commit**

```bash
git add server/_core/securityEventLimits.ts server/_core/securityEventLimits.test.ts server/db.ts
git commit -m "fix(security): clamp every security_events column on insert

insertSecurityEvent truncated only userAgent. A request with a >256-char
path wrote uncapped into varchar(256), raised ER_DATA_TOO_LONG, and the
catch logged it 'non-critical' — so an attacker could erase their own
security event with one long URL. Same class as the k-props sentinel
(PR #418). Column widths now live in one file asserted against the schema."
```

- [ ] **Step 10: Prove live after deploy**

After deploy, confirm no `ER_DATA_TOO_LONG` appears in the deploy log stream, and confirm `[DB][insertSecurityEvent] Inserted` lines continue at the baseline rate.

**Terminal outcome:** `shipped` after live confirmation.

---

## Task 2.3: Stop the Discord-side security-event erasure

**Classification:** trust boundary = security telemetry; failure impact = **SECURITY (P0)**.

**The finding, proven against `origin/main`:**

```ts
  // ── Step 6: Build and send the embed ──
  const embed = buildEmbed(payload);   // ← OUTSIDE the try
  try {
    await channel.send({ embeds: [embed] });
```

discord.js v14 throws `CombinedPropertyError` when a field value exceeds 1024 characters. `p.path` and `p.blockedOrigin` are inserted uncapped. So a request with a long path (or a long `Origin` header) throws inside `buildEmbed`, escapes this function entirely, and is swallowed by the `.catch(() => {})` at every call site. Combined with Task 2.2's DB failure, a single long URL erased the event from **both** sinks.

**Files:**
- Modify: `server/discord/discordSecurityAlert.ts`
- Test: `server/discord/securityAlertLogSafety.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/discord/securityAlertLogSafety.test.ts`:

```ts
import { buildEmbedForTest } from "./discordSecurityAlert";

describe("embed field width clamping (2026-08-06 audit)", () => {
  const DISCORD_FIELD_MAX = 1024;

  it("does not throw on a 2000-char path", () => {
    expect(() =>
      buildEmbedForTest({
        eventType: "RATE_LIMIT",
        ip: "1.2.3.4",
        path: "/" + "a".repeat(1999),
        method: "GET",
        userAgent: "test",
        context: "public_feed",
        occurredAt: 1_754_500_000_000,
      })
    ).not.toThrow();
  });

  it("does not throw on a 2000-char blockedOrigin", () => {
    expect(() =>
      buildEmbedForTest({
        eventType: "CSRF_BLOCK",
        ip: "1.2.3.4",
        blockedOrigin: "https://" + "a".repeat(1992),
        path: "appUsers.login",
        method: "POST",
        occurredAt: 1_754_500_000_000,
      })
    ).not.toThrow();
  });

  it("clamps every field value to Discord's 1024 limit", () => {
    const embed = buildEmbedForTest({
      eventType: "RATE_LIMIT",
      ip: "9".repeat(2000),
      path: "/" + "a".repeat(1999),
      method: "GET",
      userAgent: "u".repeat(2000),
      context: "public_feed",
      occurredAt: 1_754_500_000_000,
    });
    for (const field of embed.data.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(DISCORD_FIELD_MAX);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run server/discord/securityAlertLogSafety.test.ts -t "embed field width"
```

Expected: FAIL — `buildEmbedForTest` is not exported, and the underlying builder throws.

- [ ] **Step 3: Add the clamp helper and export the builder for test**

In `server/discord/discordSecurityAlert.ts`, near the constants:

```ts
/**
 * Discord hard-caps an embed field value at 1024 chars and THROWS
 * (CombinedPropertyError) above it. `path` and `blockedOrigin` are
 * attacker-controlled, so an over-long value used to throw inside
 * buildEmbed() — which is called OUTSIDE the try — killing the alert
 * entirely (2026-08-06 audit). Every field value goes through this.
 *
 * 1000 not 1024: leaves room for the backtick wrapping we add around values.
 */
const DISCORD_FIELD_MAX = 1000;

function field(value: string | null | undefined, fallback: string): string {
  const v = value === null || value === undefined || value === "" ? fallback : value;
  return v.length > DISCORD_FIELD_MAX ? `${v.substring(0, DISCORD_FIELD_MAX)}…[truncated]` : v;
}

/** Test-only surface for the embed builder. Not used by production paths. */
export function buildEmbedForTest(payload: SecurityAlertPayload) {
  return buildEmbed(payload);
}
```

- [ ] **Step 4: Route every field value through `field()`**

In each of the four embed builders (`buildCsrfBlockEmbed`, `buildRateLimitEmbed`, `buildAuthFailEmbed`, `buildBruteForceEmbed`), wrap every `value:` that interpolates a payload property. Example, in `buildCsrfBlockEmbed`:

```ts
      {
        name: "🌐 Blocked Origin (Where the Request Came From)",
        value: `\`${field(p.blockedOrigin, "none — Origin header was missing entirely")}\``,
        inline: false,
      },
      { name: "🔗 tRPC Procedure Targeted", value: `\`${field(p.path, "unknown")}\``, inline: true },
      { name: "📡 HTTP Method",             value: `\`${field(p.method, "unknown")}\``, inline: true },
      { name: "🖥️ Source IP Address",       value: `\`${field(p.ip, "unknown")}\``, inline: true },
```

Replace every `.substring(0, 120)` user-agent call with `field(p.userAgent, "none — no user-agent header provided")` — the 120-char cut is what produced the misleading `…Safari/601.2.4 fac` in the incident alert, hiding `facebookexternalhit/1.1 Facebot Twitterbot/1.0`. Full UA is now shown, clamped only at the Discord limit.

- [ ] **Step 5: Move `buildEmbed` inside the try**

```ts
  // ── Step 6: Build and send the embed ──────────────────────────────────────
  // buildEmbed MUST be inside the try: discord.js throws on an over-long field
  // value, and an escape here kills the alert silently at the call site's
  // .catch() — the erasure primitive found in the 2026-08-06 audit.
  try {
    const embed = buildEmbed(payload);
    await channel.send({ embeds: [embed] });
    console.log(
      `${tag} [OUTPUT] Alert posted successfully` +
      ` | IP=${logSafe(payload.ip)}` +
      ` channel=#${logSafe(channel.name)}` +
      ` eventType=${payload.eventType}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${tag} Failed to build or send embed to channel ${SECURITY_CHANNEL_ID}: ${logSafe(msg)}` +
      ` | IP=${logSafe(payload.ip)} eventType=${payload.eventType}`
    );
  }
```

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run server/discord/securityAlertLogSafety.test.ts
npx tsc --noEmit
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add server/discord/discordSecurityAlert.ts server/discord/securityAlertLogSafety.test.ts
git commit -m "fix(security): clamp embed fields and build inside the try

buildEmbed() ran OUTSIDE the try and discord.js throws above a 1024-char
field value. path and blockedOrigin were uncapped, so one long URL threw,
escaped, and was swallowed by the call site's .catch() — no alert posted.
With the DB row also lost to ER_DATA_TOO_LONG, an attacker could erase
their own event from BOTH sinks. Also drops the 120-char UA cut that hid
facebookexternalhit behind 'fac' in the incident alert."
```

**Terminal outcome:** `shipped` after deploy + one observed alert carrying a full user-agent.

---

# PHASE 3 — CLIENT IDENTITY REPAIR

## Task 3.1: Build the single client-identity surface and remove the `EDGE_MODE` footgun

**Classification:** trust boundary = identity resolution; failure impact = **SECURITY + AVAILABILITY (P1)**.

**The finding, proven verbatim from production:**

```
[HTTP_REQUEST] → GET /assets/DimeChatPage-BDuW9ytn.js
  ip=104.22.17.115 host=aisportsbettingmodels.com
  x-forwarded-for=104.22.17.115, 84.17.44.227 x-forwarded-proto=https
```

Railway **discards** Cloudflare's appended client token and rewrites XFF as `[CF PoP, Railway edge]`. The true visitor exists **only** in `cf-connecting-ip`, which is **never logged anywhere**. Second hops span 31 IPs across CDN77 LAX/Toronto, CDNEXT Atlanta and RIPE ranges — not just `152.233.x`. The PoP rotates **per connection** (proven: one client alternating `162.158.187.41`↔`.42` on a 1-minute cadence), though it is stable for 8+ minute stretches.

Under `trust proxy 1`, `req.ip` resolves to the **rightmost** XFF token — the Railway edge. Proven by a local `proxy-addr` harness and by production:

```
[CSRF] POST /api/trpc/analytics.track | IP=84.17.44.228 | Origin=https://aisportsbettingmodels.com
[CSRF] POST /api/trpc/analytics.track | IP=152.233.47.67 | Origin=https://aisportsbettingmodels.com
```

All 54 CSRF `IP=` values are Railway edge nodes; zero are CF PoPs.

**The latent landmine this task removes:** `resolveClientIp()` only consults `cf-connecting-ip` when `edgeMode() !== "off"`. Setting `EDGE_MODE=off` — the tempting one-step rollback — instantly collapses **all six** limiters onto per-PoP buckets while DNS is still orange. Identity resolution must not depend on an enforcement flag.

**Files:**
- Create: `server/_core/clientIdentity.ts`
- Create: `server/_core/clientIdentity.test.ts`
- Modify: `server/_core/trpcRateLimitPolicy.ts` (delegate `resolveClientIp` to the new module)

**Interfaces:**
- Produces:
  - `resolveClientIdentity(req: Pick<Request, "headers" | "ip">): string` — the true client IP for keying, logging and persistence.
  - `clientIdentityKey(req): string` — `ipKeyGenerator`-normalised form for express-rate-limit v8 (mandatory: v8 throws `ERR_ERL_KEY_GEN_IPV6` on a raw address).
  - `identitySource(req): "cf-connecting-ip" | "xff-leftmost" | "req.ip"` — for observability.

- [ ] **Step 1: Write the failing tests**

Create `server/_core/clientIdentity.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveClientIdentity,
  identitySource,
} from "./clientIdentity";

const ORIGINAL_EDGE_MODE = process.env.EDGE_MODE;
const ORIGINAL_SECRET = process.env.EDGE_ORIGIN_SECRET;

afterEach(() => {
  process.env.EDGE_MODE = ORIGINAL_EDGE_MODE;
  process.env.EDGE_ORIGIN_SECRET = ORIGINAL_SECRET;
});

/**
 * PRODUCTION-SHAPED fixture. Railway discards Cloudflare's appended client
 * token and rewrites XFF as [CF PoP, Railway edge]. Every pre-existing test
 * in this repo used a single-token XFF, which is why the PoP-keying bug
 * survived — see server/loginStatus.test.ts (2026-08-06 audit).
 */
function cfRequest(cfClient: string, pop = "104.22.17.115", railway = "84.17.44.227") {
  return {
    headers: {
      "x-forwarded-for": `${pop}, ${railway}`,
      "cf-connecting-ip": cfClient,
      "x-dime-edge-secret": process.env.EDGE_ORIGIN_SECRET ?? "",
    },
    ip: railway,
  };
}

describe("resolveClientIdentity", () => {
  it("returns the true visitor from cf-connecting-ip, not the CF PoP", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    expect(resolveClientIdentity(cfRequest("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("does NOT return the Railway edge hop", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    const got = resolveClientIdentity(cfRequest("203.0.113.7"));
    expect(got).not.toBe("84.17.44.227");
    expect(got).not.toBe("104.22.17.115");
  });

  it("resolves identically in log mode — keying must not follow enforcement", () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "log";
    expect(resolveClientIdentity(cfRequest("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("resolves identically with EDGE_MODE unset — the rollback footgun", () => {
    // Setting EDGE_MODE=off while DNS is orange-clouded used to collapse every
    // limiter onto per-PoP buckets. Identity must never depend on the
    // enforcement flag (2026-08-06 audit).
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    delete process.env.EDGE_MODE;
    expect(resolveClientIdentity(cfRequest("203.0.113.7"))).toBe("203.0.113.7");
  });

  it("ignores cf-connecting-ip when the origin proof fails (forgery guard)", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    const forged = {
      headers: {
        "x-forwarded-for": "198.51.100.9, 84.17.44.227",
        "cf-connecting-ip": "203.0.113.7",
        // no valid x-dime-edge-secret
      },
      ip: "84.17.44.227",
    };
    expect(resolveClientIdentity(forged)).toBe("198.51.100.9");
  });

  it("returns the direct client on a non-Cloudflare origin hit", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    // The real T-Mobile direct-origin shape observed on 2026-08-06.
    const direct = {
      headers: { "x-forwarded-for": "172.56.76.93, 152.233.23.193" },
      ip: "152.233.23.193",
    };
    expect(resolveClientIdentity(direct)).toBe("172.56.76.93");
  });

  it("reports its source for observability", () => {
    process.env.EDGE_MODE = "on";
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    expect(identitySource(cfRequest("203.0.113.7"))).toBe("cf-connecting-ip");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run server/_core/clientIdentity.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/_core/clientIdentity.ts`:

```ts
import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { cfConnectingIp, edgeProofPasses } from "./edgeProxy";

/**
 * THE single source of "who is this request from".
 *
 * Nothing outside this module may parse `x-forwarded-for` or read `req.ip` to
 * identify a client. The 2026-08-06 forensic audit found TWELVE sites that
 * hand-rolled it, six of them driving a decision, a limit, or a stored value.
 *
 * Production hop structure (PROVEN, verbatim from Railway logs):
 *     x-forwarded-for = "104.22.17.115, 84.17.44.227"
 *                        ^ Cloudflare PoP   ^ Railway edge
 * Railway DISCARDS Cloudflare's appended client token, so the true visitor
 * appears NOWHERE in XFF — only in `cf-connecting-ip`. The PoP rotates per
 * connection. Under `trust proxy 1`, `req.ip` is the RIGHTMOST token, i.e.
 * Railway's own edge node, shared by every visitor.
 *
 * Resolution order:
 *   1. `cf-connecting-ip`, but ONLY when the request cryptographically proves
 *      it came through our Cloudflare edge (valid `x-dime-edge-secret` AND a
 *      CF-range upstream). Without the proof the header is client-forgeable
 *      and would hand an attacker an arbitrary-IP lever.
 *   2. Leftmost X-Forwarded-For — correct for a direct-to-origin hit, where
 *      Railway's edge saw the client as its own peer.
 *   3. `req.ip` — last resort.
 *
 * DELIBERATELY NOT gated on `edgeMode()`. The previous implementation only
 * consulted `cf-connecting-ip` when `edgeMode() !== "off"`, which meant the
 * tempting one-step rollback `EDGE_MODE=off` instantly collapsed all six rate
 * limiters onto per-PoP buckets while DNS was still orange-clouded. The origin
 * proof is self-sufficient: if the secret validates and the upstream is in a
 * Cloudflare range, the header is trustworthy regardless of enforcement mode.
 */
export function resolveClientIdentity(
  req: Pick<Request, "headers" | "ip">
): string {
  const cf = cfConnectingIp(req);
  if (cf && edgeProofPasses(req)) return cf;

  const xff = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || req.ip || "";
}

/**
 * Rate-limit key form. `ipKeyGenerator` is mandatory for IPv6 /56
 * normalisation — express-rate-limit v8 throws ERR_ERL_KEY_GEN_IPV6 on a raw
 * address.
 */
export function clientIdentityKey(
  req: Pick<Request, "headers" | "ip">
): string {
  return ipKeyGenerator(resolveClientIdentity(req));
}

/** Which branch produced the identity. Observability only. */
export function identitySource(
  req: Pick<Request, "headers" | "ip">
): "cf-connecting-ip" | "xff-leftmost" | "req.ip" {
  const cf = cfConnectingIp(req);
  if (cf && edgeProofPasses(req)) return "cf-connecting-ip";
  const xff = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first ? "xff-leftmost" : "req.ip";
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run server/_core/clientIdentity.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Delegate the existing resolver so there is exactly one implementation**

In `server/_core/trpcRateLimitPolicy.ts`, replace the bodies of `resolveClientIp` and `clientIpKey`:

```ts
import { resolveClientIdentity, clientIdentityKey } from "./clientIdentity";

/** @deprecated Use resolveClientIdentity from ./clientIdentity. Kept as a
 *  thin alias so existing call sites keep compiling during the migration. */
export function resolveClientIp(req: Pick<Request, "headers" | "ip">): string {
  return resolveClientIdentity(req);
}

/** @deprecated Use clientIdentityKey from ./clientIdentity. */
export function clientIpKey(req: Pick<Request, "headers" | "ip">): string {
  return clientIdentityKey(req);
}
```

- [ ] **Step 6: Run the full existing suite for regressions**

```bash
npx vitest run server/_core/trpcRateLimitPolicy.test.ts server/loginStatus.test.ts
npx tsc --noEmit
```

Expected: green. Note the pre-existing test named *"returns the leftmost XFF entry (true client) unnormalized"* — its **name** is now misleading (leftmost is the PoP behind Cloudflare) but its assertion still holds for the direct-origin branch. Rename it to `"returns the leftmost XFF entry on a direct-to-origin hit"` and add a comment pointing at the audit.

- [ ] **Step 7: Commit**

```bash
git add server/_core/clientIdentity.ts server/_core/clientIdentity.test.ts server/_core/trpcRateLimitPolicy.ts
git commit -m "feat(security): single client-identity surface, ungated by EDGE_MODE

Production XFF is [CF PoP, Railway edge]; the true visitor is only in
cf-connecting-ip. Identity resolution no longer depends on edgeMode(), so
EDGE_MODE=off can never again collapse all six limiters onto per-PoP
buckets. Tests use the real two-token XFF shape — every prior test used a
single token, which is why the PoP-keying bug survived."
```

**Terminal outcome:** `shipped`.

---

## Task 3.2: Fix the login limiter and the brute-force escalator

**Classification:** trust boundary = authentication; failure impact = **SECURITY + AVAILABILITY (P1)**.

**The finding, proven in production:**

```
[AppAuth][AUTH_FAIL] BLOCKED | IP=172.71.156.192 reason="user_not_found" identifier="Kwi***@gmail.com"
[DiscordSecurity][BruteForce] AUTH_FAIL recorded | IP=172.71.156.192 | count=1 in last 10 min | threshold=3
[AppAuth][AUTH_FAIL] BLOCKED | IP=172.71.156.192 reason="user_not_found" identifier="Kwi***@gmail.com"
[DiscordSecurity][BruteForce] AUTH_FAIL recorded | IP=172.71.156.192 | count=2 in last 10 min | threshold=3
[DiscordSecurity][DEDUP] Skipping AUTH_FAIL alert for IP=172.71.156.192 — cooldown active
```

`172.71.156.192` ∈ `172.64.0.0/13` = a **Cloudflare PoP**. The alert labels it "🖥️ Attacker IP Address". The count reached **2 of 3** — one more failure from any unrelated user behind that PoP would have fired an `@here` page.

**Severity, stated honestly — both directions:**
- **Collateral lockout is NOT reachable at current scale.** It needs 10 failures on one PoP key inside 15 minutes. Measured: ~13 distinct visitors, ~6 req/min, 2 login failures in 6.72 h = 0.074 per 15 min. That is **~135× short**. My earlier framing overstated this.
- **But PoP keying also DILUTES.** A client's requests rotate across PoPs, so a real attacker's in-procedure budget is `10 × N` PoPs, not 10. Combined with Task 2.1's bypass (now fixed), this limiter was briefly the only login control — and it was diluted.

**Files:**
- Modify: `server/routers/appUsers.ts` (login `clientIp`, `getLoginStatus` `ip`)
- Test: `server/loginStatus.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/loginStatus.test.ts`:

```ts
describe("login identity keying (2026-08-06 audit)", () => {
  it("keys on the true visitor, not the Cloudflare PoP", () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "on";
    // The PRODUCTION shape. Every prior test in this file used a bare
    // single-IP XFF, which is exactly why the PoP-keying defect survived.
    const req = {
      headers: {
        "x-forwarded-for": "172.71.156.192, 152.233.23.193",
        "cf-connecting-ip": "203.0.113.42",
        "x-dime-edge-secret": "test-secret",
      },
      ip: "152.233.23.193",
      socket: { remoteAddress: "152.233.23.193" },
    };
    expect(resolveClientIdentity(req)).toBe("203.0.113.42");
    expect(resolveClientIdentity(req)).not.toBe("172.71.156.192");
  });

  it("two visitors behind ONE PoP do not share a login budget", () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "on";
    const pop = "172.71.156.192";
    const mk = (client: string) => ({
      headers: {
        "x-forwarded-for": `${pop}, 152.233.23.193`,
        "cf-connecting-ip": client,
        "x-dime-edge-secret": "test-secret",
      },
      ip: "152.233.23.193",
    });
    expect(resolveClientIdentity(mk("203.0.113.1"))).not.toBe(
      resolveClientIdentity(mk("203.0.113.2"))
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run server/loginStatus.test.ts -t "login identity keying"
```

Expected: FAIL — import missing / values equal.

- [ ] **Step 3: Fix the login path**

In `server/routers/appUsers.ts`, replace:

```ts
      // [STEP] Extract client IP for rate limiting
      const clientIp = (ctx.req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        .trim() ?? ctx.req.socket?.remoteAddress ?? "unknown";
```

with:

```ts
      // [STEP] Extract the TRUE client identity for rate limiting.
      // Never parse x-forwarded-for here: production XFF is
      // [CF PoP, Railway edge] and the leftmost token is a Cloudflare PoP
      // shared by an entire metro. Keying on it both aggregated unrelated
      // users onto one login-failure budget AND diluted a real attacker's
      // budget across rotating PoPs (2026-08-06 audit).
      const clientIp = resolveClientIdentity(ctx.req) || "unknown";
```

- [ ] **Step 4: Fix `getLoginStatus`**

Replace:

```ts
    const ip =
      (ctx.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      (ctx.req.socket as any)?.remoteAddress ??
      (ctx.req as any).ip ??
      'unknown';
```

with:

```ts
    // Must use the SAME key as the login mutation, or this public endpoint
    // reports another population's lockout state (2026-08-06 audit).
    const ip = resolveClientIdentity(ctx.req) || "unknown";
```

Add the import at the top of `server/routers/appUsers.ts`:

```ts
import { resolveClientIdentity } from "../_core/clientIdentity";
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run server/loginStatus.test.ts
npx tsc --noEmit
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add server/routers/appUsers.ts server/loginStatus.test.ts
git commit -m "fix(security): key login limiter and brute-force window on the true visitor

checkLoginRateLimit/recordLoginFailure and the Discord brute-force sliding
window were keyed on the leftmost XFF token, which behind Cloudflare is a
PoP IP shared by a metro. Observed live: AUTH_FAIL attributed to
172.71.156.192 (a Cloudflare PoP), brute-force counter at 2 of 3. Cuts
both ways — aggregates unrelated users AND dilutes a real attacker across
rotating PoPs."
```

- [ ] **Step 7: Prove live after deploy**

After deploy, wait for a natural AUTH_FAIL (or the next one to occur) and confirm the logged IP is **not** in any Cloudflare CIDR from `server/_core/edgeProxy.ts`.

**Terminal outcome:** `shipped` after a live AUTH_FAIL shows a non-Cloudflare IP.

---

## Task 3.3: Fix the six limiter handlers, the CSRF logger, and the request logger

**Classification:** trust boundary = security telemetry; failure impact = **SECURITY (P1)**.

**The finding:** all six express-rate-limit `handler` blocks re-derive the IP from raw XFF instead of reusing the correct key their own `keyGenerator` just computed. The `keyGenerator`s are right; the `handler`s are wrong — so every `security_events` row and Discord alert those limiters emit carries the **CF PoP**. Separately, `server/_core/trpc.ts:374` uses `req.ip` = the **Railway edge**, and that value is both persisted to `security_events.ip` and used as the Discord dedup key — so `CSRF_BLOCK` alerts from unrelated sources dedup against each other across only ~31 shared Railway edge IPs.

Net effect: `security_events.ip` is corrupted **two different ways** — `CSRF_BLOCK` rows hold the Railway edge, `AUTH_FAIL`/`RATE_LIMIT` rows hold the CF PoP.

**Files:**
- Modify: `server/_core/index.ts` (6 handlers + request logger + `/health` logger)
- Modify: `server/_core/trpc.ts` (CSRF logger, Stripe logger)

- [ ] **Step 1: Replace every handler's IP derivation**

In `server/_core/index.ts`, in each of the six limiter handlers (`globalApiLimiter`, `authLimiter`, `trpcAuthLimiter`, `stripeCheckoutLimiter`, `waitlistLimiter`, `publicFeedLimiter`), replace the block:

```ts
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        .trim() ??
      req.ip ??
      "unknown";
```

with:

```ts
    // Reuse the SAME identity the keyGenerator used. Re-deriving from raw XFF
    // wrote the Cloudflare PoP into security_events and every Discord alert
    // while the limiter itself was correctly keyed (2026-08-06 audit).
    const ip = resolveClientIdentity(req) || "unknown";
```

Add the import:

```ts
import { resolveClientIdentity } from "./clientIdentity";
```

- [ ] **Step 2: Fix the CSRF and Stripe loggers**

In `server/_core/trpc.ts`, replace both occurrences of:

```ts
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
```

with:

```ts
  // req.ip under `trust proxy 1` is the RIGHTMOST XFF token = Railway's own
  // edge node, shared by every visitor. It was persisted to security_events.ip
  // AND used as the Discord dedup key, so unrelated CSRF blocks deduped
  // against each other across ~31 shared hops (2026-08-06 audit).
  const ip = resolveClientIdentity(req) || "unknown";
```

Add the import:

```ts
import { resolveClientIdentity } from "./clientIdentity";
```

- [ ] **Step 3: Fix the request logger so the true visitor is recorded at all**

The audit found `cf-connecting-ip` is **never logged anywhere**, so the true visitor does not appear in Railway logs. In `server/_core/index.ts`'s top-level request logger, replace the `ip` derivation and add the source:

```ts
    const ip = resolveClientIdentity(req) || "unknown";
    const ipSrc = identitySource(req);
```

and extend the log line with ` ipSrc=${ipSrc}`. Do the same for the `/health` logger.

Add `identitySource` to the import.

- [ ] **Step 4: Verify no hand-rolled derivation remains**

```bash
grep -rn 'headers\["x-forwarded-for"\]\|headers\[.x-forwarded-for.\]' --include="*.ts" server/ | grep -v ".test.ts" | grep -v "clientIdentity.ts" | grep -v "edgeProxy.ts" | grep -v "discordAuth.ts"
```

Expected: **no output**. `edgeProxy.ts` (`immediateUpstreamIp` — deliberately the peer, used by the origin proof) and `discordAuth.ts` (logs the whole header verbatim for debugging, no decision) are the only legitimate remaining readers.

```bash
grep -rn "req\.ip\b" --include="*.ts" server/ | grep -v ".test.ts" | grep -v "clientIdentity.ts" | grep -v "edgeProxy.ts"
```

Expected: only `server/cron/cronAuth.ts` and `server/cron/cronRoutes.ts` (cosmetic log lines on an internal, secret-authed path). Fix those too for consistency, or record them as accepted-cosmetic in the evidence.

- [ ] **Step 5: Run the gate**

```bash
npx tsc --noEmit
npx vitest run server/_core/ server/discord/
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add server/_core/index.ts server/_core/trpc.ts
git commit -m "fix(security): correct client identity in all 12 derivation sites

Six limiter handlers re-derived from raw XFF (=CF PoP) while their own
keyGenerators were correct; trpc.ts used req.ip (=Railway edge) and
persisted it to security_events.ip AND used it as the Discord dedup key.
security_events was corrupted two different ways. Also logs the true
visitor and its source, which appeared nowhere in Railway logs before."
```

**Terminal outcome:** `shipped` after deploy + one observed `[HTTP_REQUEST]` line carrying `ipSrc=cf-connecting-ip` with a non-Cloudflare IP.

---

## Task 3.4: Fix the persisted waitlist identity

**Classification:** trust boundary = stored PII; failure impact = **DATA INTEGRITY (P2)**.

**The finding:** `server/routers/waitlist.ts` derives `ipAddress` from raw XFF and `server/waitlistDb.ts` persists it to `drizzle/schema.ts:3044 varchar("ipAddress", { length: 64 })` on every new row. Since the Cloudflare orange-cloud, every stored value is a CF PoP. **Irrecoverable** — no second column holds the truth. 64 chars is ample for IPv6, so there is no truncation risk here.

- [ ] **Step 1: Fix the derivation**

In `server/routers/waitlist.ts`, replace:

```ts
      const ipAddress: string =
        (req?.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          ?.trim() ??
        req?.socket?.remoteAddress ??
        "unknown";
```

with:

```ts
      // Persisted to waitlist.ipAddress. The leftmost XFF token behind
      // Cloudflare is a PoP, so every row written since the orange-cloud
      // holds a Cloudflare address rather than the signup's origin —
      // irrecoverable, no second column holds the truth (2026-08-06 audit).
      const ipAddress: string = req
        ? resolveClientIdentity(req) || "unknown"
        : "unknown";
```

Add the import:

```ts
import { resolveClientIdentity } from "../_core/clientIdentity";
```

- [ ] **Step 2: Run the gate**

```bash
npx tsc --noEmit
npx vitest run server/routers/
```

- [ ] **Step 3: Commit**

```bash
git add server/routers/waitlist.ts
git commit -m "fix(data): persist the true visitor IP on waitlist signups"
```

- [ ] **Step 4: Queue the data census**

Historical rows cannot be repaired, but they can be **labelled**. Record in the evidence bundle that Task 6.14 will run the census once GitHub Actions recovers (`db-query.yml` is currently blocked by the outage).

**Terminal outcome:** `shipped` for the code; the census is tracked in Task 6.14.

---

## Task 3.5: Stop the MLB cycle racing itself

**Classification:** trust boundary = data write path + upstream API quota; failure impact = **DATA INTEGRITY + AVAILABILITY (P1)**.

**The finding, independently verified twice.** Production START/DONE ledger over 56 minutes — **12 STARTs, 10 DONEs**:

```
21:10:44 START → 21:13:37 DONE   (2m53s)
21:15:44 START ┐
21:20:44 START ┤ ← three cycles concurrently in flight
21:25:44 START ┘
               → 21:24:56 DONE   (= the 21:15 cycle, 9m12s)
               → 21:28:12 DONE   (= the 21:20 cycle, 7m28s)
               → 21:30:09 DONE
21:45:44 START ┐ still open
21:50:44 START ┘
21:55:44 START → 21:56:13 DONE   (29s — belongs to an earlier START)
```

`runMlbCycleOnce()` has **no re-entrancy guard**; its own header concedes *"Overlap protection is enforced by the CronJobRunner at the route layer."* But `CronJobRunner.isRunning` is a **per-instance private field** guarding only calls routed through `.trigger()`, and `server/vsinAutoRefresh.ts` calls `runMlbCycleOnce()` **directly** from a `setInterval`. Cycle duration has drifted from ~3 min to 4–9 min against a 5-minute interval. GitHub Actions is entirely down, so this is the scheduler racing **itself**.

**REFUTED consequence — do not build for it:** duplicate rows are **not possible**. Verified in applied migration DDL:

```
drizzle/0040_milky_greymalkin.sql:28  CONSTRAINT `mlb_lineups_gameId_unique` UNIQUE(`gameId`)
drizzle/0043_rich_drax.sql:1          ADD CONSTRAINT `uq_game_side` UNIQUE(`gameId`,`side`)
drizzle/0051_panoramic_sebastian_shaw.sql:23  CONSTRAINT `uq_backtest_game_market` UNIQUE(`gameId`,`market`)
drizzle/0051_panoramic_sebastian_shaw.sql:53  CONSTRAINT `uq_hr_game_player` UNIQUE(`gameId`,`playerName`)
```

Writes are `.onDuplicateKeyUpdate()` or insert-then-catch-update. The workflow comment claiming these tables "lack unique constraints" is **false** — Task 7.2 corrects it.

**Real consequences:** doubled upstream scraping (Rotowire, Action Network, MLB Stats API — rate-limit/ban exposure), nondeterministic last-writer-wins, single-cycle K-props loss on a lost `ER_DUP_ENTRY` race, and wasted CPU.

**Design decision — guard the function, not the call site.** Routing the interval through `mlbCycleRunner.trigger()` would require importing from `cronRoutes.ts` into `vsinAutoRefresh.ts`, and `cronRoutes.ts` already imports **from** `vsinAutoRefresh.ts` — a circular import. A module-level guard inside `runMlbCycleOnce` protects **every** caller (interval, HTTP route, and any future one) with no cycle.

**Files:**
- Modify: `server/vsinAutoRefresh.ts`
- Test: `server/mlbCycleReentrancy.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/mlbCycleReentrancy.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

/**
 * runMlbCycleOnce had NO re-entrancy guard. The in-process setInterval fires
 * every 300s regardless of whether the prior invocation finished, and cycle
 * duration drifted to 4-9 minutes — so three cycles ran concurrently in
 * production on 2026-08-06 (12 STARTs vs 10 DONEs in 56 minutes).
 *
 * The guard must live in the FUNCTION, not at one call site: CronJobRunner's
 * lock is a per-instance field and only covers calls through .trigger().
 */
describe("runMlbCycleOnce re-entrancy guard", () => {
  it("a second concurrent call is skipped, not run", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } = await import(
      "./vsinAutoRefresh"
    );
    let running = 0;
    let maxConcurrent = 0;
    __setMlbCycleWorkForTest(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise(r => setTimeout(r, 50));
      running -= 1;
    });

    await Promise.all([runMlbCycleOnce(), runMlbCycleOnce(), runMlbCycleOnce()]);

    expect(maxConcurrent).toBe(1);
  });

  it("a later call runs normally once the prior one settles", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } = await import(
      "./vsinAutoRefresh"
    );
    let calls = 0;
    __setMlbCycleWorkForTest(async () => {
      calls += 1;
    });
    await runMlbCycleOnce();
    await runMlbCycleOnce();
    expect(calls).toBe(2);
  });

  it("the guard releases even when the work throws", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } = await import(
      "./vsinAutoRefresh"
    );
    let calls = 0;
    __setMlbCycleWorkForTest(async () => {
      calls += 1;
      throw new Error("upstream feed down");
    });
    await runMlbCycleOnce();
    await runMlbCycleOnce();
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run server/mlbCycleReentrancy.test.ts
```

Expected: FAIL — `__setMlbCycleWorkForTest` not exported; `maxConcurrent` is 3.

- [ ] **Step 3: Implement the guard**

In `server/vsinAutoRefresh.ts`, rename the existing body to `runMlbCycleWork` and wrap it:

```ts
/**
 * Single-flight guard for the MLB cycle.
 *
 * Why this lives on the FUNCTION and not at a call site (2026-08-06 audit):
 * CronJobRunner.isRunning is a per-INSTANCE private field that only guards
 * calls routed through that instance's .trigger(). The in-process setInterval
 * called runMlbCycleOnce() directly, so the lock never saw it. With the cycle
 * drifting to 4-9 minutes against a 300s interval, THREE cycles ran
 * concurrently in production (12 STARTs vs 10 DONEs in 56 minutes), doubling
 * load on Rotowire / Action Network / MLB Stats API.
 *
 * Guarding here covers every caller — interval, HTTP cron route, and any
 * future one — without importing cronRoutes (which already imports us).
 */
let mlbCycleInFlight = false;

/** Test seam: swap the cycle body. Production never calls this. */
let mlbCycleWork: () => Promise<void> = runMlbCycleWork;
export function __setMlbCycleWorkForTest(fn: () => Promise<void>): void {
  mlbCycleWork = fn;
}

export async function runMlbCycleOnce(): Promise<void> {
  if (mlbCycleInFlight) {
    console.warn(
      "[MLBCycle] [SKIP] previous cycle still in flight — overlap prevented"
    );
    return;
  }
  mlbCycleInFlight = true;
  try {
    await mlbCycleWork();
  } finally {
    // MUST be finally: a throwing upstream feed would otherwise wedge the
    // guard closed and stop the cycle permanently.
    mlbCycleInFlight = false;
  }
}
```

Ensure `runMlbCycleWork` retains the original `► START` / `✅ DONE` logging so the production ledger stays comparable to the baseline.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run server/mlbCycleReentrancy.test.ts
npx tsc --noEmit
```

Expected: green (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/vsinAutoRefresh.ts server/mlbCycleReentrancy.test.ts
git commit -m "fix(data): add re-entrancy guard to runMlbCycleOnce

The in-process setInterval called runMlbCycleOnce() directly, bypassing
CronJobRunner's per-instance lock. With cycle duration drifted to 4-9min
against a 300s interval, three cycles ran concurrently in production
(12 STARTs / 10 DONEs in 56 minutes), double-hitting every upstream feed.
Guard lives on the function so it covers every caller."
```

- [ ] **Step 6: Prove live after deploy — this is the definitive check**

Re-run the exact baseline query from Task 0.2 Step 3 over a 60-minute window:

```
filter: "[MLBCycle] ► START" OR "[MLBCycle] ✅ DONE" OR "[MLBCycle] [SKIP]"
```

Expected: **STARTs == DONEs** with no interleaving, plus `[SKIP]` lines whenever a cycle exceeds 300 s. Paste the full ledger into the evidence record beside the baseline ledger.

**Definition of Done:** the post-deploy ledger shows strict START→DONE alternation for a full hour.

**Terminal outcome:** `shipped` only after the live ledger is clean. `failed_verification` if any interleaving remains.

---

# PHASE 4 — RESTORE TRUSTWORTHY SIGNAL

## Task 4.1: Confirm and fix SEO / social prerendering

**Classification:** trust boundary = public unauthenticated ingress; failure impact = **BUSINESS (P1)**.

**The finding:** across the entire current deployment (13:19→21:54Z, 8.5 h), `[Prerender][STEP] botDetected=true` occurs **zero times**; every invocation logged `botDetected=false`. Meanwhile a real `facebookexternalhit` was 403'd at 20:48:23Z and another at 15:22:20Z on `/robots.txt`. `server/landingPrerender.ts` matches googlebot, bingbot, applebot, facebookexternalhit, twitterbot, linkedinbot, discordbot, slackbot and 10 more. The runbook's stated intent — *"Verified bots = Allow … keeps SEO working"* and *"never challenge … the SEO prerender"* — is being defeated silently on the customer-acquisition surface.

**Honest caveat carried forward:** in a pre-arming deployment, the three `botDetected=true` occurrences coincide with deploy-smoke probes that spoof `Googlebot/2.1`, so the before/after is suggestive rather than clean. Zero bot prerenders in 8.5 h with a proven 403 of Meta's unfurler is the finding regardless.

- [ ] **Step 1: Establish whether bots reach the origin at all**

Query the `http` log stream over the full deployment, client-side filter `clientUa` for `bot|crawler|spider|facebookexternalhit|Twitterbot|Slackbot|Discordbot|LinkedInBot|Applebot`. Record every hit with its status.

Two outcomes:
- **Bots present with 200s but `botDetected=false`** → the matcher is broken. Go to Step 2.
- **Bots absent or 403'd** → Cloudflare/SBFM or the origin lock is stopping them upstream. Go to Step 3.

- [ ] **Step 2 (if matcher broken): Add the failing test**

In a new `server/landingPrerender.botmatch.test.ts`, assert `isBot()` returns true for every UA string observed in Step 1. Fix the matcher until green. Include the exact production UA:

```ts
it("detects Meta's link-preview crawler", () => {
  expect(
    isBot(
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
    )
  ).toBe(true);
});
```

- [ ] **Step 3 (if blocked upstream): OWNER ACTION — Cloudflare**

Verify Super Bot Fight Mode has **Verified Bots = Allow**, and that the "Skip WAF+Bot" rule covers the document routes the prerender serves. Record the as-found configuration before changing anything.

- [ ] **Step 4: Verify after the change**

Re-query for `botDetected=true` over a 2-hour window.

Expected: non-zero. If still zero, escalate — the prerender is not reachable and the acquisition surface is dark.

- [ ] **Step 5: Add a standing check**

Add `botDetected=true` count to the daily security digest (Task 4.9) so a future regression to zero is visible.

**Terminal outcome:** `shipped` when `botDetected=true` is observed post-change. `failed_verification` if it stays zero.

---

## Task 4.2: Exempt the Stripe webhook from the origin lock (branches on Task 0.3)

**Classification:** trust boundary = third-party callback; failure impact = **REVENUE (P0 or P2, per Task 0.3)**.

**The finding:** production `originLock` exempts exactly one path:

```ts
    if (mode === "off") return next();
    // Railway healthcheck path — always reachable, no secret required.
    if (req.path === "/health") return next();
```

The runbook explicitly exempts `/api/stripe/webhook` from the **WAF** — proving awareness of the class — but there is no matching exemption in the lock, and `originLock` is mounted at `index.ts:479`, **before** `registerStripeWebhookRoute(app)` at `:566`.

**Branch:**
- Task 0.3 found the endpoint on `aisportsbettingmodels.com` → this task is **defence-in-depth**, execute in Phase 4.
- Task 0.3 found it on `*.up.railway.app` → **escalate to Phase 1 immediately.** Every webhook since ~08:03Z has been silently 403'd and subscription state is drifting.

**Files:**
- Modify: `server/_core/originLock.ts`
- Create: `docs/runbooks/edge-origin-exemptions.md`
- Test: `server/_core/originLock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("origin lock exemptions", () => {
  it("exempts /health for Railway's probe", () => {
    // Railway probes the origin DIRECTLY; locking it kills every deploy.
  });

  it("exempts the Stripe webhook", () => {
    // Stripe posts from its own infrastructure and cannot present the
    // Cloudflare-injected origin secret. The runbook already exempts this
    // path from the WAF; the origin lock had no matching exemption
    // (2026-08-06 audit).
  });

  it("does NOT exempt a path that merely starts with an exempt prefix", () => {
    // /health/../api/trpc must not slip through.
  });

  it("still 403s an ordinary path with no proof", () => {});
});
```

Fill in each with a request fixture calling the exported middleware.

- [ ] **Step 2: Implement**

```ts
/**
 * Paths reachable at the raw origin without the Cloudflare-injected secret.
 * EXACT match only — a prefix match would let /health/../api/trpc through.
 * Every entry needs a reason; see docs/runbooks/edge-origin-exemptions.md.
 */
const ORIGIN_LOCK_EXEMPT_PATHS = new Set<string>([
  // Railway's healthcheck probes the origin directly. Locking it fails the
  // deploy and Railway keeps the previous release.
  "/health",
  // Stripe posts from its own infrastructure and cannot present the edge
  // secret. Already WAF-exempt per docs/runbooks/edge-defense-cloudflare.md;
  // the origin lock had no matching exemption, so if the dashboard endpoint
  // points at the raw origin every webhook 403s SILENTLY and subscription
  // state drifts (2026-08-06 audit). The endpoint is independently protected
  // by Stripe signature verification (STRIPE_WEBHOOK_SECRET).
  "/api/stripe/webhook",
]);
```

and in the middleware:

```ts
    if (ORIGIN_LOCK_EXEMPT_PATHS.has(req.path)) return next();
```

- [ ] **Step 3: Verify the webhook is still authenticated**

```bash
git show origin/main:server/stripeWebhook.ts | grep -n "constructEvent\|STRIPE_WEBHOOK_SECRET\|signature"
```

Confirm signature verification runs on every request. The exemption removes the edge lock, **not** the authentication. If signature verification is conditional or absent, STOP — do not exempt.

- [ ] **Step 4: Write the exemptions runbook**

Create `docs/runbooks/edge-origin-exemptions.md` documenting each exempt path, its reason, its compensating control, and the rule that adding an entry requires a compensating control.

- [ ] **Step 5: Gate and commit**

```bash
npx tsc --noEmit
npx vitest run server/_core/originLock.test.ts
git add server/_core/originLock.ts server/_core/originLock.test.ts docs/runbooks/edge-origin-exemptions.md
git commit -m "fix(edge): exempt the Stripe webhook from the origin lock"
```

- [ ] **Step 6: Prove live**

After deploy, trigger a test event from the Stripe dashboard and confirm a `2xx` in Stripe's delivery log **and** a `[StripeWebhook]` line in the Railway deploy stream.

**Terminal outcome:** `shipped` after a Stripe-side 2xx delivery is observed.

---

## Task 4.3: Stop alerting on non-blocking origin-lock events

**The finding:** in `server/_core/index.ts`, `fireRateLimitEvent(...)` runs **unconditionally, before the `kind` switch**:

```ts
    originLock((kind, req) => {
      fireRateLimitEvent(/* ... */ "edge_origin_ingress_anomaly", /* ... */);
      if (kind === "edge_no_secret") { /* ... */ }
```

So `edge_would_deny` (log mode), `edge_no_secret` (anti-lockout), `edge_breaker_tripped` and `edge_breaker_recovered` — **none of which block** — all post "⚡ RATE LIMIT — IP Blocked for Sending Too Many Requests". A circuit-breaker **recovery** (good news) fires an attack alert against a cryptographically verified legitimate Cloudflare request. And in the `edge_no_secret` state the site is unprotected **and** every request fires the full alert pipeline.

- [ ] **Step 1: Route by kind**

```ts
    originLock((kind, req) => {
      const ip = immediateUpstreamIp(req) || resolveClientIdentity(req);
      const ua = (req.headers["user-agent"] as string | undefined) ?? null;

      switch (kind) {
        case "edge_deny":
          // The ONLY kind that produced a 403. Alert.
          fireRateLimitEvent(ip, req.path, req.method, "edge_origin_ingress_anomaly", ua);
          break;
        case "edge_would_deny":
          // log-mode / breaker-open observation. Request was SERVED. Log only —
          // alerting here posts "IP Blocked ... 429" for a 200 response, and in
          // the breaker-open state it does so for EVERY request (2026-08-06 audit).
          console.warn(
            `[edge][origin-lock] would-deny (observe-only) ip=${logSafe(ip)} path=${logSafe(req.path)}`
          );
          break;
        case "edge_no_secret":
          console.error(
            "[edge][origin-lock] CRITICAL EDGE_MODE=on but no EDGE_ORIGIN_SECRET configured — anti-lockout downgrade to observe-only (site NOT protected)"
          );
          break;
        case "edge_breaker_tripped":
          console.error("[edge][origin-lock] circuit breaker TRIPPED — enforcement suspended");
          break;
        case "edge_breaker_recovered":
          console.log("[edge][origin-lock] circuit breaker RECOVERED — enforcement resumed");
          break;
      }
    })
```

Verify the exact `OriginLockEvent` union members against `origin/main:server/_core/originLock.ts` before writing the switch, and add a `default:` that logs an unknown kind rather than silently dropping it.

- [ ] **Step 2: Add a once-per-minute CRITICAL escalation for `edge_no_secret`**

Unprotected-site is the loudest condition in the system and must page exactly once per minute, not once per request. Add a module-level timestamp guard.

- [ ] **Step 3: Gate, commit, prove**

```bash
npx tsc --noEmit
npx vitest run server/_core/
git commit -am "fix(alerting): only alert on origin-lock kinds that actually blocked"
```

After deploy under `EDGE_MODE=log` (if Task 1.2 chose (A)), confirm anomaly events appear as `would-deny` log lines with **zero** Discord posts.

**Terminal outcome:** `shipped`.

---

## Task 4.4: Make the alert copy true for all eight event classes

**The finding:** the label map covers 3 of 8 `limitType` slugs — `stripe_checkout`, `waitlist_submit`, `public_feed`, `xff_canary` and `edge_origin_ingress_anomaly` all fall through to a raw slug plus hardcoded copy asserting a **429** and a temporary block. The real response for the origin lock is **403**, and for `xff_canary` and the `/api/trpc` edge canary **nothing is blocked at all**. The remediation text — *"consider permanently blocking it at the firewall"* — is aimed at IPs that are T-Mobile CGNAT, Meta, GitHub Actions runners, Cloudflare PoPs, and Railway's own edge. The `BRUTE_FORCE` embed goes further: *"Block `${ip}` at the firewall/CDN level"* — a self-DoS instruction.

- [ ] **Step 1: Complete the label map and add per-class response semantics**

```ts
type LimiterMeta = {
  label: string;
  /** What the server ACTUALLY did. */
  action: "429 rate-limited" | "403 blocked at the edge" | "observed only — request was served";
  explanation: string;
  guidance: string;
};

const LIMITER_META: Record<string, LimiterMeta> = {
  global: {
    label: "Global API Limiter — 200 requests per minute per IP",
    action: "429 rate-limited",
    explanation: "An IP exceeded 200 requests per minute across /api.",
    guidance: "A one-off is normal. Sustained repeats from one IP warrant review.",
  },
  auth: { /* 5 attempts / 15 min per IP */ },
  trpc_auth: { /* 5 login attempts / 15 min per IP */ },
  stripe_checkout: { /* 10 checkout attempts / 15 min per IP */ },
  waitlist_submit: { /* 5 submissions / 15 min per IP */ },
  public_feed: { /* 60 feed requests / min per IP */ },
  xff_canary: {
    label: "XFF sanitization canary — NOT a rate limiter",
    action: "observed only — request was served",
    explanation:
      "A /api/trpc request resolved to a private/reserved address, meaning the proxy hop structure changed. Nothing was blocked.",
    guidance:
      "Do NOT block this IP. Re-verify the limiter keying assumption in server/_core/clientIdentity.ts.",
  },
  edge_origin_ingress_anomaly: {
    label: "Cloudflare origin lock — NOT a rate limiter",
    action: "403 blocked at the edge",
    explanation:
      "A request reached the Railway origin without arriving through Cloudflare. Under EDGE_MODE=on it was refused with 403; under log mode it was served and only recorded.",
    guidance:
      "Do NOT block this IP at the firewall — these are frequently real users on carrier networks with a short-lived resolver cache, and verified crawlers. Check docs/runbooks/edge-defense-cloudflare.md.",
  },
};
```

- [ ] **Step 2: Replace the hardcoded 429 copy with `meta.action` / `meta.explanation` / `meta.guidance`**

Remove every literal `429 Too Many Requests` and `consider permanently blocking it at the firewall` from the RATE_LIMIT embed. Retitle the embed from "⚡ RATE LIMIT — IP Blocked for Sending Too Many Requests" to a per-action title.

- [ ] **Step 3: Rewrite the BRUTE_FORCE remediation**

Replace *"Block `${ip}` at the firewall/CDN level"* with guidance that first checks whether the IP is shared infrastructure:

```ts
      "**Before blocking anything**, confirm this is not shared infrastructure. " +
      "Cloudflare PoPs, Railway edge nodes, carrier CGNAT ranges (T-Mobile " +
      "172.32.0.0/11), GitHub Actions runners and verified crawlers all appear " +
      "here as single addresses representing many users. Blocking one can take " +
      "the site down for everyone behind it. Prefer an account-level lock."
```

- [ ] **Step 4: Add a `default:` to `buildEmbed`'s switch and widen `SecurityEventType`** so a new event kind fails loudly instead of being forced into the wrong embed (A13).

- [ ] **Step 5: Add the exhaustiveness test**

```ts
it("has metadata for every limitType in the union", () => {
  const ALL: string[] = [
    "global", "auth", "trpc_auth", "stripe_checkout",
    "waitlist_submit", "public_feed", "xff_canary",
    "edge_origin_ingress_anomaly",
  ];
  for (const slug of ALL) expect(LIMITER_META[slug]).toBeDefined();
});

it("never claims 429 for the origin lock", () => {
  expect(LIMITER_META.edge_origin_ingress_anomaly.action).not.toContain("429");
});
```

- [ ] **Step 6: Gate, commit, prove live** — confirm the next real anomaly alert reads "403 blocked at the edge" and carries the do-not-block guidance.

**Terminal outcome:** `shipped`.

---

## Task 4.5: Fix the Discord dedup key

**The finding:** Discord dedups on `(eventType, ip)` while the DB dedups on `(ip, path, limitType)`. Two different limiters firing for one IP within 30 s → the second is silently dropped, so a genuine `trpc_auth` brute-force is suppressed by an unrelated `public_feed` alert. Observed live: `[DiscordSecurity][DEDUP] Skipping AUTH_FAIL alert for IP=172.71.156.192`.

- [ ] **Step 1: Align the keys**

```ts
  // Was `${eventType}:${ip}` — so an unrelated limiter firing for the same IP
  // suppressed a real one within the 30s window. Now matches the DB dedup key
  // (ip, path, limitType) so the two sinks agree on what happened.
  const dedupKey = `${payload.eventType}:${payload.ip}:${payload.path}:${payload.context ?? "-"}`;
```

- [ ] **Step 2: Add the regression test** asserting two different `context` values for one IP both post.

- [ ] **Step 3: Gate, commit.**

**Terminal outcome:** `shipped`.

---

## Task 4.6: Add a global alert budget

**The finding:** dedup is per-IP only; there is no global ceiling. A distributed source — or the `edge_no_secret` / breaker-tripped states, which fire on **every request** — produces one embed per unique IP per 30 s, unbounded. Worse, the prune (`Array.from(map.entries()).forEach(...)`) re-runs on every event once the map exceeds its threshold; under a flood all entries are fresh, so it deletes nothing and degrades to an **O(n) full-map scan plus array allocation per request** on the alert path.

- [ ] **Step 1: Add a token-bucket ceiling** — max 20 embeds/minute globally; on exhaustion emit one summary embed (`N alerts suppressed in the last minute; see security_events`) and drop the rest.
- [ ] **Step 2: Fix the prune** — replace the scan-on-every-event with a time-based sweep that runs at most once per `RATE_LIMIT_DEDUP_MS`, and cap map size with FIFO eviction.
- [ ] **Step 3: Test** — 1000 events from 1000 distinct IPs in one minute yields ≤21 embeds and the prune runs ≤1 time.
- [ ] **Step 4: Gate, commit.**

**Terminal outcome:** `shipped`.

---

## Task 4.7: Fix the timezone label

**The finding:** `formatTimestamp` hardcodes `" EST"`. Verified: `20:48:23Z` renders `Aug 6, 2026, 16:48:23 EST` — the value is **EDT**. Every alert is mislabelled by one hour for ~8 months a year, corrupting forensic timeline reconstruction.

- [ ] **Step 1: Emit the real zone abbreviation via `Intl.DateTimeFormat` with `timeZoneName: "short"` on `America/New_York`**, and append the UTC ISO instant in parentheses — UTC is what every log line and the Railway API use, so an operator should never have to convert.
- [ ] **Step 2: Test** both a January (EST) and an August (EDT) instant.
- [ ] **Step 3: Gate, commit.**

**Terminal outcome:** `shipped`.

---

## Task 4.8: Apply `logSafe` to embed fields

**The finding:** `logSafe` is applied to every log line but to **zero** embed fields. `p.path`, `p.ip`, `p.blockedOrigin`, `p.targetIdentifier` go into backtick-wrapped Markdown raw — a backtick/Markdown breakout in a security embed from an attacker-controlled path or Origin. `postBruteForceAlert` puts `ip` in the message **content**, where mentions ping.

- [ ] **Step 1: Compose `field()` (Task 2.3) with `logSafe`** so every value is both sanitised and clamped: `field(logSafe(v), fallback)`.
- [ ] **Step 2: Strip backticks and `@` from any value placed in message content.**
- [ ] **Step 3: Test** a path containing `` ` ``, `@everyone`, and a newline.
- [ ] **Step 4: Gate, commit.**

**Terminal outcome:** `shipped`.

---

## Task 4.9: Make the digests tell the truth

**The finding:** digests bucket **only** on `eventType` and never read `context`, so all eight limiter classes collapse into one "Rate Limit Triggers" number described as *"often automated scraping or a brute-force attempt."* Today's digest, verbatim:

```
[SecurityDigest] [STATE] Top IPs by event count | 47.152.160.175(20), 40.81.6.244(18), 172.182.201.162(18), 48.217.34.226(18), 20.49.13.182(18)
[SecurityDigest] [STATE] Threat level: HIGH | total=111 events in last 24h
```

Four of the top five are **Microsoft Azure = GitHub Actions runners**; `47.152.160.175` is the **owner's own ISP address** (it appears with `ua="curl/8.7.1"` and `ua="dime-ci-probe"`). The one daily artifact an operator reads is pure noise — which is precisely how a real signal gets missed. Separately, the counts are a 1/60 s-deduped sample presented as a volume, and the threat-level thresholds are computed on it.

- [ ] **Step 1: Bucket by `(eventType, context)`** in `securityDigest.ts`, `weeklySecurityDigest.ts`, and the `db.ts` aggregation.
- [ ] **Step 2: Add a known-source allowlist** — Cloudflare CIDRs (reuse `isCloudflareEdgeIp`), Railway edge ranges, Azure/GitHub Actions ranges, and an owner-configured list. Report allowlisted events in a separate "expected automation" section, excluded from the threat-level computation.
- [ ] **Step 3: Label the counts as deduped samples** and state the dedup window in the digest body.
- [ ] **Step 4: Add the `botDetected=true` count** from Task 4.1 so a prerender regression surfaces daily.
- [ ] **Step 5: Test** with a fixture containing CI IPs, CF PoPs, and one genuine attacker; assert the threat level reflects only the attacker.
- [ ] **Step 6: Gate, commit, and verify against the next daily digest.**

**Terminal outcome:** `shipped` after one live digest shows a corrected threat level.

---

## Task 4.10: Make digest delivery durable

**The findings:** `notifyOwner returned false` is logged at error and never escalated (A14). `lastDigestDateUTC` is in-memory and the fire window is a single minute matched by a 60 s poll, so a container restart inside the 13:00 UTC minute silently skips the day (A15) — a live coin-flip at ~25 deploys/day.

- [ ] **Step 1: Widen the fire window** to a 10-minute range with an idempotency check, so a restart inside the window still fires exactly once.
- [ ] **Step 2: Persist the last-fired date** (a small settings row or a `security_events` sentinel) so it survives restarts.
- [ ] **Step 3: Escalate `notifyOwner` failure** to the Discord security channel.
- [ ] **Step 4: Test** the restart-inside-window and double-fire cases.
- [ ] **Step 5: Gate, commit.**

**Terminal outcome:** `shipped`.

---

# PHASE 5 — CLOSE THE EDGE PROGRAM AND ITS GOVERNANCE GAP

## Task 5.1: Build the account-bound origin proof (the real fix for P1-1)

**The finding:** neither runbook option A (Cloudflare Tunnel) nor B (Authenticated Origin Pulls / mTLS) was implemented. Zero occurrences of "Authenticated Origin Pull", "mTLS", "Tunnel", or "cloudflared" in the as-built record. The shipped design is **option C**, which the runbook itself labels *"(interim)"* and prefixes with *"you MUST add a proof bound to your Cloudflare account."* The load-bearing proof is a single Transform-Rule-injected shared secret whose leakage `edgeProxy.ts` calls **"CATASTROPHIC"** (full bypass **plus** arbitrary-IP spoofing via `cf-connecting-ip`).

Option A also **eliminates P1-1 entirely**: with a Tunnel there is no reachable origin IP for any resolver to cache, so the recurring resolver-cache 403 episodes become structurally impossible.

- [ ] **Step 1: OWNER DECISION — record the choice with rationale**
  - **(A) Cloudflare Tunnel** — recommended. No public origin IP at all. Eliminates P1-1 and the raw-hostname exposure Meta already crawled. Highest effort.
  - **(B) Authenticated Origin Pulls (mTLS)** — origin verifies a Cloudflare client certificate. Keeps the origin routable but rejects non-CF TLS.
  - **(C) Stay on the shared secret** — accept the documented catastrophic-leak risk and the recurring 403s. Requires an explicit, dated owner acceptance in the evidence record.
- [ ] **Step 2: Write the decision note** per engineering-federation's earn-its-existence conditional: measured need, rejected alternatives, failure/outage policy, rollback.
- [ ] **Step 3: Implement in a staged sequence** — stand up the new proof alongside the existing secret; verify both pass; only then retire the secret path. Never a hard cutover.
- [ ] **Step 4: Verify** — confirm a direct-to-origin request fails at the transport layer, and `aisportsbettingmodels.com` serves 200 throughout.
- [ ] **Step 5: Re-run the P1-1 baseline** — `EDGE_ORIGIN_INGRESS_ANOMALY` count over 24 h should reach zero.

**Terminal outcome:** `shipped` under (A)/(B) after 24 h at zero anomalies. `rejected` under (C) with the dated acceptance.

---

## Task 5.2: Remove `EDGE_AGENT_BYPASS_KEY` from the Railway environment

**The finding:** `get-service-config` lists `EDGE_AGENT_BYPASS_KEY` among the app service's variable names, while `docs/runbooks/anti-scraping-config.md` states twice that it is *"**NOT a Railway/server var** — Cloudflare rule value + the tooling's shell / CI only"* and *"**NOT on Railway.** … the server never reads it."* A WAF/bot-bypass secret now lives in the server environment, expanding its blast radius to anything with Railway env access or a server-side env disclosure.

- [ ] **Step 1: Confirm the server truly never reads it**

```bash
git grep -n "EDGE_AGENT_BYPASS_KEY" origin/main -- server/ shared/ client/
```

Expected: **no output**. Only `scripts/` and `.github/workflows/` should reference it. If `server/` reads it, STOP — the doc is wrong and removal would break the bypass.

- [ ] **Step 2: OWNER ACTION** — remove the variable from the Railway app service.
- [ ] **Step 3: Verify** — `deploy-smoke.yml` and `perf-harness.yml` still pass (they read it from GitHub secrets, not from Railway), and the app boots cleanly.
- [ ] **Step 4: Rotate the key** — it has been resident in a wider blast radius than intended. Update the Cloudflare rule value and the GitHub secret in one coordinated change.

**Terminal outcome:** `shipped`.

---

## Task 5.3: Make secret rotation survivable

**The finding:** `originSecretOk()` supports dual-secret rotation via `EDGE_ORIGIN_SECRET_PREV`, but that variable is **not configured**. Any rotation is therefore a hard cutover with a guaranteed 403 window. Compounding it, the `edge_no_secret` anti-lockout state leaves the site unprotected **and** fires the full alert pipeline on every request (M-10).

- [ ] **Step 1: OWNER ACTION** — set `EDGE_ORIGIN_SECRET_PREV` to the current secret's value, so a future rotation has a valid overlap window.
- [ ] **Step 2: Write the rotation runbook** into `docs/runbooks/edge-origin-exemptions.md` (or a sibling): set `_PREV` = current → set new `EDGE_ORIGIN_SECRET` → update the Cloudflare Transform Rule → verify both accepted → clear `_PREV`.
- [ ] **Step 3: Confirm Task 4.3's once-per-minute CRITICAL escalation** covers the `edge_no_secret` state.
- [ ] **Step 4: Add a boot assertion** — when `EDGE_MODE !== "off"` and no secret is configured, emit the CRITICAL line at boot, not only on first request.

**Terminal outcome:** `shipped`.

---

## Task 5.4: Make the circuit breaker able to fire — and safe when it does

**The finding:** defaults are `minSample: 200`, `verifiedFloor: 0`, `tripWindows: 3` — it trips only after **three consecutive full minutes with ≥200 requests and *zero* verified Cloudflare requests**. In the actual topology (most traffic through CF, a small minority direct), a single verified request resets the streak, so it **provably never trips for partial bypass** — the exact case that materialised. The as-built record presents it as the mitigation for precisely that risk. And when it *does* trip, `originLock` takes `edge_would_deny → next()` for every subsequent request while `index.ts` alerts on every one — an unbounded flood.

**Note the interaction:** Task 4.3 (only alert on `edge_deny`) and Task 4.6 (global budget) must land **before** any breaker retune, or making the breaker more sensitive converts an outage into an alert storm.

- [ ] **Step 1: Confirm Tasks 4.3 and 4.6 are shipped.** If not, STOP.
- [ ] **Step 2: Change the trip condition from "zero verified" to a ratio** — e.g. trip when the verified fraction falls below a configurable floor (default 0.5) over the window, which is reachable under partial bypass.
- [ ] **Step 3: Model the new threshold against the audited baseline** — 449 verified vs 5 unverified in ~112 minutes must **not** trip. Assert this in a test with the real numbers.
- [ ] **Step 4: Test** the trip, the hold, and the recovery, asserting alert volume stays inside the Task 4.6 budget.
- [ ] **Step 5: Update the as-built record** to state honestly what the breaker does and does not cover.

**Terminal outcome:** `shipped`.

---

## Task 5.5: Fix the arming gate that failed

**The finding — the single most important governance item.** `docs/runbooks/edge-defense-cloudflare.md` defines a stop condition: *"`edge_origin_ingress_anomaly` events should be ~zero… **If legit traffic warns, STOP and fix CF injection before enforcing.**"* Anomalies were **non-zero throughout the soak** (CI + operator traffic, 08:56–10:39Z), and `EDGE_MODE=on` was armed anyway at ~08:03Z. The as-built record cites **18 requests through Cloudflare + 5 direct** as arming proof, where the runbook asks for *"15–30 min of real traffic."* Between arming and the first real-user 403 there was a **7-hour blind period**.

The direct-origin user population is structurally invisible to synthetic probes sent through Cloudflare. No amount of care in the probe design would have found it; only real traffic would.

- [ ] **Step 1: Rewrite the arming gate as a measurable, non-waivable checklist** in the runbook:
  - Minimum soak: 60 minutes of production traffic in `log` mode, ≥500 real requests.
  - Pass condition: `edge_would_deny` count from **non-CI, non-operator** sources is exactly **zero**.
  - Mandatory: the soak evidence must include the request count, the distinct-source count, and an explicit statement that CI/operator sources were excluded.
  - Synthetic probes may **supplement** but never **substitute** for the real-traffic soak.
- [ ] **Step 2: Add an automated soak reporter** — a script that queries the anomaly stream over a window, classifies each source as CI / operator / unknown, and prints a machine-readable PASS/FAIL. Arming requires pasting its output.
- [ ] **Step 3: Add the arming gate to the engineering-federation evidence template** so any future edge-class change inherits it.
- [ ] **Step 4: Record the 2026-08-06 gate failure** as a dated incident note in the runbook, so the next operator sees why the gate exists.

**Terminal outcome:** `shipped`.

---

## Task 5.6: Complete the Cloudflare configuration

**The finding:** runbook §11 Cache Rules are absent from the as-built record — including *"Normalize incoming URLs"*, the documented fix for the `/assets/..%2f..%2ftrpc/…` path-confusion cache leak — plus the Bypass-ordering rules and the `Cookie`-forwarding confirmation. Also absent: §10 edge rate-limiting rules and §5 "Preserve Host Header ON".

- [ ] **Step 1: OWNER ACTION** — enable **Normalize incoming URLs**. This is the highest-value item: it closes a cache-leak class where a path-confusion URL could serve model data to a subsequent anonymous fetch.
- [ ] **Step 2: Apply the Cache Rules in the runbook's exact terminating order** — Bypass `/api*` → Bypass when `app_session` cookie present → Bypass `/` and SPA doc routes → Cache Everything for static **file extensions** only (never `starts_with /assets/`) → Respect origin Cache-Control.
- [ ] **Step 3: Confirm Cloudflare forwards the `Cookie` header on `/api` routes** — without it authed users lose their model data.
- [ ] **Step 4: Confirm Preserve Host Header is ON** — the app issues its own 308 www→apex, and a Cloudflare 301 would drop POST bodies.
- [ ] **Step 5: Verify the path-confusion case** — `/assets/..%2f..%2ftrpc%2fgames.list` must never return model fields to a subsequent anonymous fetch, and `cf-cache-status` must be `DYNAMIC`/`BYPASS` for `/api/*` and for any authed request.
- [ ] **Step 6: Record the complete as-built configuration**, replacing the partial record.

**Terminal outcome:** `shipped`.

---

## Task 5.7: Add the external synthetic monitor

**The finding:** the runbook's §14 monitor is still phrased as a to-do. It is **the only control that detects a Cloudflare-edge failure** — Railway's `/health` probe hits the origin directly and is lock-exempt, so it stays green through a total edge outage. Without it, an edge failure is invisible until users complain.

- [ ] **Step 1: Stand up an external monitor through the Cloudflare hostname** (not the origin) checking `https://aisportsbettingmodels.com/` and one `/api/trpc` read, from at least two geographies.
- [ ] **Step 2: Alert to the Discord security channel** on two consecutive failures.
- [ ] **Step 3: Verify** by temporarily pointing the monitor at a known-bad path and confirming the alert fires.
- [ ] **Step 4: Add the `www` variant.** The audit found the `www`→apex 308 runs **before** the origin lock, so direct-origin `www` traffic is neither blocked nor logged — meaning the anomaly count systematically **undercounts** direct-origin ingress. Monitor `www` explicitly and record this measurement gap in the runbook.

**Terminal outcome:** `shipped`.

---

# PHASE 6 — PIPELINE, DATA AND HYGIENE BACKLOG

Each task here is small and independently shippable. Order within the phase is by impact.

## Task 6.1: Make the model-validation failure diagnosable

**The finding:** `[MLBCycle] Model fallback (tomorrow): … validation=❌ FAILED (48 issues)` fires every ~5 minutes all day, and the follow-up line is truncated to a bare `[` — the issue array never reaches the log, so the failure is **undiagnosable from production**. It is converging (60→44 issues as books post lines) and today's slate passes 41/41, so this is a normal ramp — but a normal ramp is currently indistinguishable from a genuine upstream feed failure, and nothing alerts if it fails to converge before first pitch.

- [ ] **Step 1: Log the issue array as a single JSON line**, capped at a documented length, instead of a multi-line array that gets cut.
- [ ] **Step 2: Add an expected-ramp suppression** — do not log at error severity for a next-day slate before books have posted; log at info with a "ramp in progress, N issues" summary.
- [ ] **Step 3: Add an alert** if the tomorrow slate still fails validation within N hours of first pitch.
- [ ] **Step 4: Verify** the next cycle emits a complete, parseable issue list.

## Task 6.2: Fix the Dime Chat blueprint fallback

**The finding:** `[DimeChatProfile] blueprint_fallback {"reason":"not_found","source":"default","envOverride":false,"attemptedCount":3}` at boot, error severity, three attempts, silent default fallback. Dime Chat is the flagship surface.

- [ ] **Step 1: Determine what blueprint is expected and why all three attempts miss.**
- [ ] **Step 2: Fix or make the default explicit and intentional** (a deliberate default is fine; a silent fallback from a failed lookup is not).
- [ ] **Step 3: Alert if the fallback fires in production.**

## Task 6.3: Fix the HR-props player-identity resolution

**The finding:** `[ANHRPropsAPI] [ERROR] [SKIP] player_id=… not in players dict` — ~90 lines in a 10 ms burst, logged with an `[ERROR]` tag but emitted at `info` severity so it never surfaces as an error, never alerted, and it floods the log transport.

- [ ] **Step 1: Determine why the players dict misses these IDs** (staleness, a missing sync, or an ID-space mismatch).
- [ ] **Step 2: Fix the resolution or refresh the dict before the lookup.**
- [ ] **Step 3: Emit at a severity matching the tag**, and summarise the burst as one line with a count rather than ~90 lines.

## Task 6.4: Give the security stream log priority

**The finding:** the request logger is sampled at 10% specifically "to stay well under Railway's 500 logs/sec rate limit", while `[ENGINE]` / `[MLBCycle]` / `[ANHRPropsAPI]` emit thousands of lines per cycle. Security events share the same transport with **no priority**, so a cycle burst coinciding with an attack could drop them — and the deploy log is the only sink that survives the Task 2.2/2.3 erasure primitive.

- [ ] **Step 1: Reduce the dominant noise sources** (Tasks 6.1, 6.3, 6.7, 6.11 do most of this).
- [ ] **Step 2: Measure the post-reduction line rate** and record the headroom.
- [ ] **Step 3: If still near the limit, route security events to a separate sink** (the DB is already one; consider a dedicated webhook).

## Task 6.5: Close the ingestion coverage gaps and the detector blind spot

**The findings:** three cron jobs have **no in-process equivalent** and are dark while GitHub Actions is down:
- `stripe-reconcile` (daily 09:17 UTC) — the **only** detector for Stripe↔DB entitlement drift (a cancelled customer staying entitled, or a paying one locked out). Read-only, so skipping is not destructive, but it is a blind spot.
- `bet-grade-sweep` (nightly 08:15 UTC) — the all-dates catch-all. Incremental grading is covered in-process; bets older than yesterday stuck `PENDING` will not be swept.
- `mlb-canonical-refresh` (nightly 09:00 UTC) — a delta refresh, recoverable by the next successful run.

And `os-observe-crons.yml` — the missed-cron **detector** — is itself a scheduled workflow, so the outage suppresses the crons *and* the thing that would report them. Separately, `p0-feed-verify.yml` is the only prod-touching workflow with no `environment:` binding.

- [ ] **Step 1: On Actions recovery, manually dispatch all three** and verify each returns 200.
- [ ] **Step 2: Add an in-process fallback for `stripe-reconcile`** gated behind a "last successful run older than N hours" check, so it self-heals through a future Actions outage without double-running normally.
- [ ] **Step 3: Move the missed-cron detector off GitHub Actions** — an in-process check that alerts when any cron endpoint has not been hit within its expected window. A detector that shares a failure domain with what it detects is not a detector.
- [ ] **Step 4: Bind `p0-feed-verify.yml` to `environment: Production`** per the GHA security contract.
- [ ] **Step 5: Verify** by simulating a missed window.

## Task 6.6: Stop re-running seeders on every deploy

**The finding:** every 24-hour **and 7-day** seeder is invoked unconditionally at boot (`void runParkFactorsRefresh(); setInterval(…, 7*24*60*60*1000)`). With 25 production deploys today, the weekly park-factor and umpire seeders each ran ~25 times instead of ~0.14 — a **~175× over-run** — and the 512-player rolling-5 backfill ran 25 times. This is the direct cause of the 1.48 GB memory peak and the 0.41 GB network RX spike.

- [ ] **Step 1: Add a persisted `last_run_at` check** before each eager invocation; skip if the interval has not elapsed.
- [ ] **Step 2: Test** that a restart inside the interval skips and outside it runs.
- [ ] **Step 3: Verify** post-deploy that a redeploy no longer triggers the 512-player backfill.

## Task 6.7: Stop polling off-season sports

**The finding:** NBA and NHL are out of season in August, yet the app runs a 5-minute NHL model sync 24/7, a **15-second** NBA/NHL score loop, an NHL goalie watcher, and 4-hourly schedule-history refreshes with a 7-day backfill on every boot. Every one returns nothing. The 15-second loop alone is ~5,760 no-op `api.actionnetwork.com` requests/day.

- [ ] **Step 1: Add a season-window gate** driven by data (does the schedule table hold any future game for the sport?) rather than hardcoded dates.
- [ ] **Step 2: Back off to a long interval when the gate is closed**, and resume automatically when a future game appears.
- [ ] **Step 3: Verify** the no-op request volume drops to near zero and that the loop resumes on the first scheduled game.

## Task 6.8: Fix the diacritic pitcher override

**The finding:**

```
[PITCHER_OVERRIDE] id=2251623 WSH@PHI | API homePitcher="Cristopher Sánchez" BLOCKED by Rotowire lineup homePitcher="Cristopher Sanchez" — keeping Rotowire value
[PITCHER_OVERRIDE] id=2251625 MIA@ATL | API homePitcher="Martín Pérez" BLOCKED by Rotowire lineup homePitcher="Martin Perez" — keeping Rotowire value
```

Identical names modulo accents. The comparison lacks Unicode normalisation, so the MLB Stats API is permanently overridden for every accented pitcher. Same defect class as the k-props `NAME_MATCH_FAILED` issue already on record.

- [ ] **Step 1: Write the failing test** with the two real production pairs.
- [ ] **Step 2: Normalise before comparing** — `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` plus case folding — in a shared helper, since the same normalisation belongs in the k-props matcher.
- [ ] **Step 3: Verify** the override lines stop for accented names while genuine mismatches still log.

## Task 6.9: Fix three misleading data-pipeline messages

- [ ] **RotoScraper off-by-one** — `[card 16/16] SKIP — unknown team(s): away=""→"" (MISSING)`, always the last card of *n*/*n* with empty strings. A trailing DOM node is counted as a card, inflating every card count by one, so any downstream "expected N games" check is wrong by one. Fix the selector; assert the count matches the real game count.
- [ ] **`bookTotal=0`** — reported as *"is a whole number — push probability applies"*. `0` means the total is **missing**, a different condition; "push probability applies" is nonsense for it. 8 of 17 warnings in a sampled run were the `0` case. Branch the message.
- [ ] **HR-props counter** — uses `.onDuplicateKeyUpdate()` but increments `inserted++` unconditionally, producing `inserted=209 updated=0` every cycle when the truth is ~0/~209. A reporting bug that would make a real duplicate-insert incident invisible. Read the affected-rows result and report honestly.

## Task 6.10: Fix the backtest silent no-op

**The finding:** `mlbMultiMarketBacktest.ts` recovers from a duplicate-key error with `WHERE gameId AND market AND modelSide`, but the unique key is only `(gameId, market)`. If the predicted side changes between runs the insert fails and the update matches **zero rows** — while `written++` still reports success. Partly masked by `r.modelSide.slice(0, 8)` collapsing `fg_ml_home`/`fg_ml_away` to the same `fg_ml_ho`.

- [ ] **Step 1: Write the failing test** — same `(gameId, market)`, changed `modelSide`; assert the row is updated and the counter is honest.
- [ ] **Step 2: Drop `modelSide` from the update predicate** so it matches the unique key, and remove the `slice(0, 8)` masking.
- [ ] **Step 3: Report `written` from the actual affected-rows count.**

## Task 6.11: Fix the lying observability

- [ ] **Scheduler banner** — claims *"every 10 min (14:01–04:59 UTC / 6:01 AM–11:59 PM EST)"* while `INTERVAL_MS` and `MLB_INTERVAL_MS` are both `5 * 60 * 1000` with call-site comments reading *"24/7 — no active hours gate"*. **2× wrong on cadence and asserts a window that does not exist.** An operator reasoning about scrape volume, upstream rate limits, or credit burn is misled by a factor of two. Rewrite the banner to derive its text from the constants so it can never drift again.
- [ ] **Warn tier** — Railway maps both `console.warn` and `console.error` to `severity:"error"`; `@level:warn` returns empty across 8h25m. Three of the highest-volume shapes are `console.warn` calls. Move genuinely-informational lines to `console.debug`/`console.info`, and stop printing the validation issue list twice (once as `✗` lines, once as a quoted array).
- [ ] **`[DB_KEEPALIVE]` label** — says "TiDB" on a `mysql:9.4` service, and the surrounding comment reasons about TiDB Serverless dropping idle connections after ~5 minutes — the justification for a 4-minute keepalive that may no longer apply. Correct the label and re-derive the interval, or document why 4 minutes still holds.

## Task 6.12: Ship the missing icons

**The finding:** `/favicon.ico` and `/apple-touch-icon.png` / `/apple-touch-icon-precomposed.png` 404 while `/favicon.svg` returns 304. iOS requests these on every Add-to-Home-Screen and bookmark, and they appeared in the incident logs as part of a real user's session.

- [ ] Generate `.ico` and Apple touch icons from the existing brand mark per `design-system/dime-ai/MASTER.md`, serve them, verify 200.

## Task 6.13: Give MySQL observability

**The finding:** the MySQL service's logs are **completely empty over 21h45m**. It runs with `--performance_schema=0 --disable-log-bin` and no error-log redirect, so a crash, a slow query, or connection exhaustion would leave no trace. Nothing is currently wrong; there would also be no way to know.

- [ ] **Step 1: Enable the error log** at minimum.
- [ ] **Step 2: Decide on `performance_schema`** — weigh the memory cost against blindness; record the decision.
- [ ] **Step 3: Add a capacity trend check** — disk is 1.185 GB growing ~22 MB/day; alert on an inflection, not on a fixed threshold.

## Task 6.14: Census and label the corrupted identity data

**Blocked on:** GitHub Actions recovery (`db-query.yml`).

- [ ] **Step 1: Determine the Cloudflare orange-cloud timestamp** from the Cloudflare zone's DNS change history. This is the corruption window's start and cannot be derived from the repo.
- [ ] **Step 2: Census `waitlist`** — count rows since that timestamp whose `ipAddress` falls in a Cloudflare CIDR (reuse `CF_IPV4_CIDRS`).
- [ ] **Step 3: Census `security_events`** — count rows by `eventType` whose `ip` is a Cloudflare PoP (AUTH_FAIL/RATE_LIMIT corruption) or a Railway edge hop (CSRF_BLOCK corruption).
- [ ] **Step 4: Do NOT attempt to repair.** The true values were never recorded. Record the counts and the window in the evidence bundle so any future analysis of these tables knows exactly which rows are untrustworthy.
- [ ] **Step 5: Consider a `identitySource` column** on future writes so provenance is explicit going forward.

## Task 6.15: Investigate the slow demo query

**The finding:** `GET /api/trpc/oddsHistory.listForDemoGame … totalDuration=4607` while every other call in the sampled window was 4–237 ms — **20–1000× slower**, on the demo/landing path. Single sample; not established as systematic.

- [ ] Reproduce, `EXPLAIN` the query, add the missing index or bound the result set, verify the p99.

---

# PHASE 7 — CLOSURE

## Task 7.1: Re-run the full audit and prove every finding closed

- [ ] **Step 1: Re-run every baseline query from Task 0.2** and place the results beside the baseline in one table.

Required end states:

| Metric | Baseline | Required |
|---|---|---|
| `EDGE_ORIGIN_INGRESS_ANOMALY` / 24 h | 22 | 0 (after Task 5.1) |
| HTTP 403 to real clients | 5 in 112 min | 0 |
| MLB cycle STARTs vs DONEs / hour | 12 vs 10 | equal, no interleaving |
| `botDetected=true` / 8 h | 0 | > 0 |
| Backend public hostname | HTTP 200 + app HTML | unreachable |
| `security_events.ip` in a CF/Railway range | majority | 0 for new rows |
| Digest top-5 IPs | 4 CI runners + owner | genuine sources only |
| Alerts claiming "429" for the origin lock | all | 0 |

- [ ] **Step 2: Re-dispatch the five forensic agents** with the same briefs, against the remediated code, and require every previously-confirmed claim to come back **REFUTED** (i.e. the defect no longer reproduces).
- [ ] **Step 3: Any finding that does not come back refuted returns to its phase.** Iterate until clean.

## Task 7.2: Reconcile documentation with runtime

Every contradiction the audit found, fixed at the source:

- [ ] **D1** — record the 2026-08-06 arming-gate failure as a dated incident note (done in Task 5.5).
- [ ] **D2** — replace the "18 requests → 0 anomalies" arming evidence with the real-traffic soak requirement.
- [ ] **D3** — `edge-defense-cloudflare.md` records the zone as **grey-clouded** "verified live 2026-08-06" while DNS is fully orange and `anti-scraping-config.md` records full arming. Two runbooks in one tree state contradictory current states. Retract the stale block.
- [ ] **D4** — `.github/workflows/cron-mlb-cycle.yml:8` claims the MLB tables *"lack unique constraints"*. **False** — verified in applied DDL. `references/railway-deploy.md:87-88` repeats the error and adds `games`, which also has `games_matchup_unique` and `games_mlb_gamepk_unique`. Correct both; note that only `odds_history` genuinely lacks one. Also fix the stale `⚠️ DO NOT ENABLE ⚠️` banner and the code citations, which point at `vsinAutoRefresh.ts:2098-2101` and `:1361` when the truth is `:2739-2741` and `:1850` — off by ~640 and ~490 lines.
- [ ] **D5** — the "PR #422 fixed all 3 armed-edge workflows" claim: `EDGE_AGENT_BYPASS_KEY` appears only in `deploy-smoke.yml` and `perf-harness.yml`. `p0-feed-verify.yml` was fixed by re-pointing its origin instead — sound, but the "all 3" phrasing is unsupported. Correct the record and the stored memory.
- [ ] **D6** — the "Verified bots = Allow keeps SEO working" claim vs zero `botDetected=true` (resolved by Task 4.1; update the record with the outcome).
- [ ] **D7** — document the origin-lock exemption asymmetry (resolved by Task 4.2).
- [ ] **D8** — correct the circuit-breaker description to state what it does and does not cover (resolved by Task 5.4).
- [ ] **D9** — `discordSecurityAlert.ts`'s header calls RATE_LIMIT *"Express rate limiter triggered"* when the dominant producer is now the origin lock. Rewrite the module contract.
- [ ] **H-14** — `railway.json` declares `builder: DOCKERFILE` while the service field says `RAILPACK`. `railway.json` wins at build time (proven by the build log), but the dashboard field misleads any operator reading it. Align or annotate.
- [ ] **H-16** — 8 phantom workflow records exist in the Actions API with no backing file on any branch. They cannot run but inflate API-derived counts (46 records vs 38 files). Delete or document.
- [ ] **X-1** — add a note to `CLAUDE.md` / `AGENTS.md`: **verify `git rev-parse HEAD` against `origin/main` before any production analysis.** This audit's first pass read a tree 86 commits stale and drew conclusions about code that was not deployed.

## Task 7.3: Optional follow-ups (explicitly deferred, not dropped)

- [ ] Widen `security_events.trpcPath` beyond 256 chars. Requires a migration via `db-push.yml` **before** dependent code. Task 2.2's truncation already preserves the security property, so this is a forensic-fidelity improvement only.
- [ ] Add an `identitySource` column to `security_events` and `waitlist` so identity provenance is explicit.
- [ ] Investigate why Railway's HTTP-log `srcIp` alternates between `0.0.0.0` and real addresses. It does not affect any conclusion in this audit — the direct-origin 403s carry real IPs and the XFF evidence is independent — but it is unexplained, and both agents that met it flagged it.
- [ ] Resolve the T-Mobile resolver behaviour definitively — requires a packet or `scutil --dns` capture from an affected handset on-network. Task 5.1 option (A) makes this moot.

## Task 7.4: Record the evidence and update memory

- [ ] **Step 1: Complete `docs/audits/2026-08-06-edge-identity-forensic/EVIDENCE.md`** with one evidence record per task, each carrying verbatim gate output and a terminal outcome.
- [ ] **Step 2: Write the program-level record** — classification, baseline, diff scope, contracts changed, artifact (Railway deployment id + commit), migration revision (`none` — by design), verification, `production_mutation: true`, approvals, known limitations, rollback, decision notes.
- [ ] **Step 3: Update the memory index** at `~/.claude/projects/.../memory/`:
  - Correct `phase4-edge-activation.md` — the "PR #422 fixed ALL 3" claim is unsupported, and `EDGE_AGENT_BYPASS_KEY` **was** a Railway server variable despite the note saying it is not.
  - Correct `prod-verification-vs-bot-defense.md` — add that Railway's `http` log stream carries the true visitor IP and is the right tool for post-deploy proof.
  - Add a new memory: the classifier-must-mirror-the-router lesson from Task 2.1, and the stale-checkout lesson from X-1.

---

## Execution Order Summary

| Order | Task | Gate to proceed |
|---|---|---|
| 1 | 0.1 Sync to production HEAD | `tsc` green on `origin/main` |
| 2 | 0.2 Capture baseline | All five baseline metrics recorded |
| 3 | 0.3 Owner: Stripe host + EDGE_MODE decision | Both answers recorded |
| 4 | 1.1 Remove backend public domain | Non-200 on the backend host; analytics unbroken |
| 5 | 1.2 `EDGE_MODE=log` (if chosen) | 403s stop; keying holds |
| 6 | 4.2 **if Task 0.3 found the raw origin** | Stripe 2xx delivery |
| 7 | 2.1 tRPC path-segment bypass | Live probe shows limiter policy header |
| 8 | 2.2 + 2.3 Erasure primitive | No `ER_DATA_TOO_LONG`; full UA in an alert |
| 9 | 3.1 Client identity surface | 7 tests green |
| 10 | 3.2 → 3.3 → 3.4 Identity call sites | Live AUTH_FAIL shows a non-CF IP |
| 11 | 3.5 MLB re-entrancy | One clean hour of START/DONE |
| 12 | 4.3 → 4.4 → 4.5 → 4.6 → 4.7 → 4.8 Alerting | Next real alert is accurate |
| 13 | 4.1 Prerender | `botDetected=true` observed |
| 14 | 4.9 → 4.10 Digests | One live digest with a corrected threat level |
| 15 | 5.4 Circuit breaker | **Requires 4.3 + 4.6 shipped** |
| 16 | 5.1 → 5.2 → 5.3 Origin proof + secrets | 24 h at zero anomalies |
| 17 | 5.5 → 5.6 → 5.7 Governance + CF config + monitor | Soak reporter PASS |
| 18 | 6.1 – 6.15 Hygiene backlog | Each independently |
| 19 | 7.1 Re-audit | Every finding returns REFUTED |
| 20 | 7.2 → 7.4 Docs, deferrals, memory | Evidence bundle complete |

---

## Self-Review

**Spec coverage.** Every row of the Findings → Task Map resolves to a numbered task. The three refuted claims are listed explicitly as *do not build*, with Task 7.2 correcting the documents that asserted them.

**Placeholder scan.** Every code step carries real code. Tasks 4.4–4.10 and 6.1–6.15 give the exact defect, file, and required end state but leave some implementation bodies to the executing agent — these are small, well-bounded, single-file changes where the failing test defines the contract. Tasks 0–3 and 5.1–5.7, which touch security boundaries, carry complete code.

**Type consistency.** `resolveClientIdentity` / `clientIdentityKey` / `identitySource` are named identically across Tasks 3.1–3.4. `truncateForColumn` / `SECURITY_EVENT_LIMITS` match between Tasks 2.2 and 2.3. `field()` in Task 2.3 is reused by Task 4.8. `__setMlbCycleWorkForTest` matches between the test and the implementation in Task 3.5.

**Deploy-order law.** This plan requires **zero migrations** by design — Task 2.2 truncates rather than widening, and column widening is deferred to Task 7.3 where the `db-push.yml`-first sequence is called out explicitly.
