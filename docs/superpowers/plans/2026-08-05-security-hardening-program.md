# Maximum-Security Hardening Program

> **Engineering-federation `/eng-loop` program plan + decision record.** Owner-directed 2026-08-05: "industry-level, production-grade, maximum security; prevent attacks at all costs; protect proprietary IP; data must never be scraped." This is a MULTI-PHASE program across several PRs, not one change. Each phase is its own `/eng-loop` run with TDD + adversarial review + live production proof + evidence record.

## Owner decisions captured (2026-08-05)

1. **Data access → GATE BEHIND LOGIN.** Projections move from public to authenticated-only (or a public teaser + gated full data). This is THE enabler for real anti-scraping.
2. **Edge defense → YES, plan the edge layer** (Cloudflare-class in front of Railway: bot management, WAF, Turnstile challenges). Owner-gated: I produce the runbook; **owner executes the DNS change**.
3. **Browser deterrents → add light deterrents anyway**, explicitly understanding they do not stop scrapers and must not break accessibility.

## The honest ceiling (must stay on the record)

- **Public data cannot be made unscrapeable.** Proven this session: the feed was pulled repeatedly with `curl` — no browser. Copy-paste/right-click/DevTools blocking stops zero real scrapers (they call the API directly) and breaks accessibility; they are *deterrents only*. The real protection is **gating (decision 1)** + **edge bot-blocking (decision 2)** + **per-account controls**.
- Therefore "never scraped, EVER" is achievable only for *gated* data, and even then means "requires an account we can throttle, ban, watermark, and trace" — not a mathematical impossibility, but the maximum a networked product can enforce.

## Classification (all phases)

- **Trust boundary:** public internet → Railway edge → Express/tRPC → MySQL/TiDB. Anonymous + authenticated principals.
- **Failure impact:** security (primary — IP theft, account takeover, brute force), availability (gating/limits must not break legit users or SEO), release (merge = prod deploy; gating touches the feed data contract in `design-system/dime-ai/pages/ai-model-projections.md` — that owner-authored contract must be amended, not silently violated).
- **Gates per phase:** tsc · gated vitest · build · deterministic security scans · live production proof · evidence record with terminal outcome.

---

## Phase 1 — Harden the identity foundation (#1 "Best") · SHIP FIRST · no owner action needed

The rate-limit keying rests on Railway sanitizing inbound `X-Forwarded-For`. Verified once by hand (PR #366). "Best" = make that assumption **self-verifying and self-alarming**, so it can never silently break.

- **Boot/runtime canary:** if `clientIpKey` ever resolves a public request's "client" to a private/Railway-internal range (`10/8`, `172.16/12`, `192.168/16`, `152.233/16`, loopback), emit a loud security alert (`fireRateLimitEvent` + Discord) — this fires the instant Railway changes XFF handling.
- **Deploy self-check:** `scripts/smoke-deploy.mjs` sends two requests to a header-exposing rate-limited path — one plain, one with a spoofed leftmost XFF — and asserts the `RateLimit` counter **decrements together** (shared key), proving injected XFF cannot mint a fresh budget. Converts the one-time manual check into a permanent gate on every deploy.
- **Spoofed-XFF unit coverage** for `clientIpKey` (array headers, injected leftmost, internal-range canary).
- **Scope:** self-contained, no schema, no DNS, no product change. **Owner action: none.**

## Phase 2 — Per-account lockout (#3) · needs schema → db-push BEFORE code

Per-IP limits can't stop a botnet spreading guesses across thousands of IPs. Lock the **account**, not the caller.

- **Schema (rides `db-push.yml` first):** failed-attempt + lockout state keyed by account identifier (count, window, `locked_until`, last-attempt metadata). Expand-only.
- **Logic:** N failed logins against one handle (from anywhere) → progressive backoff → cooldown; owner notified; legit-user recovery path (email unlock / reset) so real fat-fingers aren't punished. Feeds the existing `security_events` + Discord pipeline.
- **CAPTCHA/Turnstile step-up** on the login form after a threshold (the `discordSecurityAlert.ts` "consider enabling CAPTCHA" note becomes real).
- **Owner action:** approve the `db-push.yml` Production run; tune thresholds.

## Phase 3 — Gate the data (#2 core) · reverses a documented product decision → owner UX checkpoint

The biggest change and the only true anti-scraping lever. Because it flips the feed from public to gated, it amends `design-system/dime-ai/pages/ai-model-projections.md` (owner-authored) and affects SEO/marketing.

- **Owner UX checkpoint FIRST:** exactly what a non-logged-in visitor sees — nothing, a teaser (few games / delayed / edges hidden), or a marketing shell. (Owner leaned "gate behind login"; confirm the public-visitor experience before building, because it drives SEO/conversion.)
- **Server:** move the feed procedures from `publicProcedure` to an authenticated procedure; keep a deliberately-limited public teaser endpoint if chosen. Preserve the bot-prerender/SEO path for whatever stays public.
- **Per-account protections unlocked by gating:** per-user rate limits, per-user watermarking/canary values (trace leaks to an account), abuse bans.
- **Owner action:** sign off the public-visitor UX + the feed-contract amendment.

## Phase 4 — Edge bot defense (#2 strongest) · owner-gated DNS change

The strongest anti-scraping layer, before traffic reaches the app.

- **I produce:** a Cloudflare (or equivalent) runbook — proxy in front of Railway, bot-management + WAF rules, Turnstile challenge on sensitive paths, edge rate limiting, per-path caching rules that don't leak gated data, and a rollback plan. Verify the app's `trust proxy`/XFF handling still resolves the true client through the new hop (ties back to Phase 1's canary).
- **Owner executes:** the DNS/proxy change on `aisportsbettingmodels.com`. Nothing goes live without owner action.

## Phase 5 — Browser deterrents (#2 light) · a11y-safe, honest

- Right-click hint, casual copy discouragement on data surfaces, optional DevTools-open notice — **gated behind `@media`/pointer + reduced-motion + never breaking keyboard, screen readers, or password managers** (design-system accessibility law wins). Documented in-code as *deterrent, not protection*.

## Sequencing rationale

Phase 1 first (pure win, no dependencies). Phase 2 next (real brute-force defense; needs db-push). Phase 3 is the anti-scraping keystone but needs the owner UX call + contract amendment. Phase 4 needs owner DNS. Phase 5 is cosmetic, last. Each ships and is verified before the next begins.

---

## INCIDENT 2026-08-05 — Phase 2 (#370) deployed ahead of its migration → total auth outage (RESOLVED)

The exact deploy-order hazard flagged in Phase 2's review **materialized in production.**

- **Sequence:** PR #370 (account lockout) merged to `main` at 14:00:12Z and auto-deployed. Migration `0133_account_lockout` (adds `failedLoginCount`, `firstFailedLoginAt`, `lockedUntil` to `app_users`) was **never applied first** — the owner merged without running `db-push.yml`. The last successful `db-push` was 2026-08-04T22:10 (main), and no run existed for the lockout branch or for 2026-08-05.
- **Impact (SEV1, ~40 min):** the deployed code's `getAppUserById` / `getAppUserByEmail` / `getAppUserByUsername` now `SELECT` the three new columns. Against the un-migrated schema every one threw `Unknown column 'failedlogincount' in 'field list'` (`ER_BAD_FIELD_ERROR`, errno 1054). Server logged `[DB][getAppUserById] SCHEMA ERROR — the app_users query is invalid against the live schema. This usually means code deployed ahead of its migration.` **Every session resolution and every login failed** — a total auth outage. (Anonymous probes returned a deceptively normal `200`/`401` because the failing SELECT was swallowed to `null` → "Invalid credentials" for everyone.)
- **Detection:** the post-merge verification pass (this program's discipline) caught it — the anon HTTP probes looked healthy, so the Railway deployment logs were the ground truth.
- **Remediation:** triggered `db-push.yml` on `main` (run `31016360410`, SUCCESS 14:40:57Z). `pnpm db:push` → `reconciled-migrate.mjs MODE=apply` replays the immutable journal forward and fails closed; `0133` is additive `ADD COLUMN` only (zero data-loss risk). Safe to apply without owner sign-off because it completes the deploy the owner had already initiated and cannot destroy data.
- **Recovery proof (red-green):** on the post-fix deployment (`337b8bf1`, booted 14:41:32Z) four deliberate login probes exercising the previously-failing queries logged `[AppAuth][AUTH_FAIL] ... reason="user_not_found"` — the **healthy** path (query executed, returned no row) — with **zero** `Unknown column` / `SCHEMA ERROR` lines. Same query shape: erroring before, clean after.

### Corrective action (Phase 1½ — fold into the program)

The Phase 1 deploy self-check proves *XFF handling*; it does **not** prove *schema/code agreement*. Add a boot-time / smoke-deploy assertion that the live `app_users` schema satisfies the code's column set (or a generalized "no `ER_BAD_FIELD_ERROR` on the core auth query" canary), so a code-ahead-of-migration deploy **fails the smoke gate instead of silently taking down auth.** The migration-before-code law is documented; make it *enforced*.

---

## Phase 4 — Edge defense (Cloudflare) · BUILT (flag-gated, inert) · owner activates

Shipped the supporting code + the owner runbook (`docs/runbooks/edge-defense-cloudflare.md`).
Everything is behind `EDGE_MODE` (unset ⇒ off ⇒ byte-identical to today), so the merge is inert —
no #370-class deploy-order hazard. Owner activates via Cloudflare setup + `EDGE_MODE=log`→`on`.

**Design method:** a 14-agent `/eng-loop` workflow (5 baseline readers → 3 independent edge
architectures → synthesis → **5 adversarial lenses**). The review found **5 material holes** in the
first-draft design; all 5 are fixed in what shipped:

| # | Lens | Hole | Fix (in this PR) |
| --- | --- | --- | --- |
| 1 | origin-bypass (HIGH) | "CF IP-range" is not attacker-independent — anyone can front the origin with their own free CF zone, so a leaked secret = total bypass | Runbook makes the load-bearing proof **Cloudflare Tunnel / Authenticated Origin Pulls (mTLS)**; IP-range demoted to defence-in-depth/observability; `cfConnectingIp` drops the forgeable `true-client-ip` fallback; secret treated as catastrophic-if-leaked (rotation, scrubbing) |
| 2 | rollout-safety (HIGH) | once CF fronts, `log`/`off` collapse every user behind a PoP onto one key (429 storm); a secret typo under `on` → #370-class total 403; "single-flip rollback" was a lie | **IP-keying decoupled from 403** — `resolveClientIp` applies the edge proof in `log` AND `on`, so `log` is a fully healthy rollback harbor; anti-lockout downgrade when no secret; CIDR boot-assert gated behind `edgeMode()!=='off'` |
| 3 | collateral-damage (HIGH) | WAF Block false-positives on Dime Chat NL + betting jargon → edge-403 before Express, silently breaking the headline feature; SSE buffering stalls streaming | Runbook **WAF SKIP** for `/api/dime/*` + `/api/trpc/*`, response-inspection off on the SSE path; smoke assertion that a jargon/SQLi chat body reaches the origin |
| 4 | cache-leak (MEDIUM) | path-confusion (`/assets/..%2f..%2ftrpc/...`) against a "Cache Everything on /assets/*" rule can edge-store authed model IP; the header-less endpoints set no Cache-Control | **Origin `private, no-store` + `Vary: Cookie`** on strikeout/hr/wc gated endpoints (`setGatedCacheHeaders`, fails closed regardless of edge config); runbook scopes the asset rule by **file-extension**, Respect-origin-TTL, URL normalization on, rule ordering |
| 5 | ip-spoof/canary (MEDIUM) | in `log` the canary went blind (public-but-wrong PoP IP) | canary is edge-aware — new `edge_origin_ingress_anomaly` event fires (log+on) for non-CF ingress the private-range regex can't see; keying-in-log makes the private-range canary honest again |

**Code (all flag-gated / fail-closed):** `server/_core/edgeProxy.ts` (helpers: `edgeMode`,
`cfConnectingIp` [cf-connecting-ip only], CF CIDR matcher [no-BigInt, ES2019-safe], constant-time
`originSecretOk`, `edgeProofPasses`) · `server/_core/originLock.ts` (403 only in `on`; `/health`
exempt; anti-lockout; never logs the secret) · `server/_core/trpcRateLimitPolicy.ts`
(`resolveClientIp` edge branch, log+on) · `server/_core/index.ts` (mount origin lock + edge-aware
canary) · `server/feedGating.ts` + `server/routers.ts` + `server/wc2026/wc2026Router.ts`
(`setGatedCacheHeaders` on 8 gated endpoints) · `scripts/smoke-deploy.mjs` (`SMOKE_EDGE=cloudflare`).

**Gates:** tsc clean · **76 unit tests** across edgeProxy/originLock/policy/feedGating (incl. IPv6
CIDR, constant-time secret, dual-proof, decoupled-keying, anti-lockout, cache headers) · smoke
syntax OK. Terminal outcome: **BUILT — inert on merge; activation owner-gated (DNS + `EDGE_MODE`).**

**Diff review outcome (adversarial, 5 lenses → verify):** 4 findings, **2 confirmed** (the same
tRPC batch-header race from two angles), 2 correctly dismissed (an origin-bypass claim resting on an
inverted XFF topology the code doesn't have; an "inert ETag" that is genuinely inert). **Fix
applied:** `games.list` authed now emits `private, no-store` (was `private, max-age=30`). Because
`games.list` and `wc2026.matchesByDate` co-batch into one tRPC HTTP response sharing one `ctx.res`
(last-writer-wins on `Cache-Control`), making BOTH authed model endpoints `no-store` makes the race
benign AND closes `games.list`'s own standing edge-cache exposure of MLB model IP. Fast-follow noted:
a `responseMeta` most-restrictive-wins hook for arbitrary future batches.

**Inertness precision:** the EDGE_MODE machinery (origin lock mount, `resolveClientIp` CF branch, the
edge canary) is inert when `EDGE_MODE` is unset — verified. The cache-header hardening on the 8 gated
endpoints (+ `games.list`) is **intentionally always-on** (like Phase 3's field gating), not part of
the inert-when-off claim: authed model responses are now uniformly `private, no-store` regardless of
`EDGE_MODE`. This is a strict security improvement with a negligible perf cost (the ETag was already
inert — no 304 is ever emitted).

---

## Phase 1½ — schema/code-agreement deploy gate · BUILT (the #370 corrective action)

Turns the documented "migration before code" law into an ENFORCED, fail-safe gate. The #370 and
2026-07-31 outages were identical: code SELECTing a new `app_users` column deployed before the
migration; every auth read threw `ER_BAD_FIELD_ERROR`, swallowed to "invalid credentials" — a
silent total auth outage that HTTP 200/401 probes could not distinguish from healthy.

- **`server/db.ts` `probeAppUsersSchema()`** — runs the real Drizzle column enumeration against a
  no-match row and SURFACES the schema error as a verdict (`ok` | `schema_mismatch` | `unknown`),
  instead of swallowing it the way `getAppUserById` must for its callers.
- **`server/_core/schemaHealthGate.ts`** — caches the verdict; `/health` reports **503 while the
  live schema is behind the code**, so Railway's deploy healthcheck fails and it **keeps the
  previous healthy deploy** instead of cutting over to the broken one — PREVENTION, not just
  detection. Safety asymmetry: only a CONFIRMED mismatch fails; `unknown` (transient/DB-down) never
  does (the DB-circuit gate already covers DB-down; freezing deploys on a blip would be worse).
  Emergency escape hatch: `SCHEMA_HEALTHGATE=off`.
- **Boot probe before `server.listen`** (bounded 5s so a slow DB never blocks startup) closes the
  race where a premature 200 lets a broken deploy go live; a 60s interval re-probe catches drift.
- **`scripts/smoke-deploy.mjs`** asserts `schema !== schema_mismatch` with the exact remediation.

**Gates:** tsc clean · schema-gate + updated health tests green · gated suite **PASS (3810)** ·
prettier clean. `healthIntegrations.test.ts` updated: the status code is now driven by database
serviceability = DB circuit **+ schema agreement** (still never by integrations). Terminal outcome:
**BUILT — enabled by default; a code-ahead-of-migration deploy now fails its healthcheck instead of
silently downing auth.**
