# Pre-remediation production baseline — 2026-08-06

Captured per Task 0.2 of `docs/superpowers/plans/2026-08-06-edge-and-identity-remediation.md`.
Every "we fixed it" claim in this program is measured against these numbers.

**Production artifact under measurement:** Railway deployment
`bf99766f-3fd6-4505-9bf7-82eceff1e09d`, commit `bf51cb0500838f5ac526dbe3318e6e95c12d948c`
(PR #429), started `2026-08-06T13:19:47.624Z`, status SUCCESS, no restarts.

**Remediation branch:** `security/edge-identity-remediation`, cut from `origin/main` at
`bf51cb0`. Baseline gate: `npx tsc --noEmit` → **exit 0**.

**Measurement caveat that shapes every number below.** Railway's `get-logs` resolves
serviceId+environmentId to the LATEST deployment only, so this deployment's log history
begins at 13:19:47Z. Anomalies exist earlier (traced back to at least 08:56:59Z on
deployment `92bca8b5`) but the prior 19 deployments are `REMOVED` and Railway serves no
logs for them. Counts below are therefore **lower bounds for the day**, exact for this
deployment. `security_events` is the durable substitute and is queried in Task 6.14.

---

## B-1 · Origin-lock anomaly rate

| Measure | Value |
|---|---|
| `EDGE_ORIGIN_INGRESS_ANOMALY` events | **22** |
| Distinct source IPs | **7** |
| Distinct clusters (grouped by source) | **6** (7 temporal bursts — `172.56.25.79` fires twice) |
| Window | 15:22:20.159Z → 20:48:23.294Z |
| Events paired with an HTTP 403 in the `http` stream | **22 / 22** |

Sources, all verified by whois and against `CF_IPV4_CIDRS` in `server/_core/edgeProxy.ts`:

| IP | Owner | Host sent | Paths |
|---|---|---|---|
| `173.252.70.72`, `.114` | Facebook/Meta AS32934 | `ai-sports-betting-dime-ai-production.up.railway.app` | `/robots.txt` |
| `172.56.145.67` | T-Mobile USA (TMO9) | apex | `/feed/model/mlb-08-06-2026`, `/favicon.ico` |
| `172.56.76.93` | T-Mobile USA | apex | `/`, `/brand/dime-wordmark-on-dark.svg`, `/favicon.ico` (retried +4s) |
| `172.56.25.79` | T-Mobile USA | apex | `/feed/model/mlb-08-06-2026` ×2 (17:35, 17:56) |
| `172.56.208.61` | T-Mobile USA | apex | `/feed`, `/feed/model/mlb-08-03-2026` (retried) |
| `172.58.183.64` | T-Mobile USA | apex | `/login`, `/apple-touch-icon*.png`, `/favicon.ico` |

**Target after Task 5.1: 0 events / 24 h.**

Decisive mechanism datum to preserve: `172.58.183.64` was 403'd at `20:48:23Z` and served
**200/404/304 on the identical path sequence at 20:52:52Z** — 4 m 29 s later, ≈ one 300 s
DNS TTL. Recurring short-lived resolver-cache episode, self-healing within one TTL. NOT
stale post-cutover DNS (apex TTL 300 s vs a 13.5 h tail; NS delegation unchanged since
2026-07-10).

**Known undercount:** the `www`→apex 308 redirect is mounted BEFORE the origin lock, so
direct-origin `www` traffic is neither blocked nor logged. True direct-origin ingress
volume is unmeasured. Task 5.7 Step 4 closes this.

---

## B-2 · HTTP status histogram

Window `19:52:07.142Z → 21:44:03.120Z` (111.9 min, 501 entries — a `limit:500`
truncation boundary, not a natural one).

| Status | Count |
|---|---|
| 200 | 449 |
| 404 | 20 |
| 304 | 18 |
| 308 | 5 |
| **403** | **5** |
| 401 | 2 |
| 499 | 2 |

**Zero 429.** No rate limiter has fired in the observable window: filter `"[RateLimit]["`
returns 22 hits, all `EDGE_ORIGIN_INGRESS_ANOMALY`; zero from `global` / `auth` /
`trpc_auth` / `stripe_checkout` / `waitlist_submit` / `public_feed`. Filter `LoginRateLimit`
returns `[]` across the full deployment.

All 5 × 403 are the single `172.58.183.64` cluster. **No IP that received a 403 ever
received a 200** in the window.

**Target after Task 5.1: 0 × 403 to real clients.**

---

## B-3 · MLB cycle START/DONE ledger — the self-overlap

Two independent captures, both showing ongoing concurrent execution.

**Capture 1 — 21:00:44Z → 21:56:13Z (56 min): 12 STARTs, 10 DONEs.**

```
21:00:44 START → 21:03:44 DONE   (3m00s)
21:05:44 START → 21:08:46 DONE   (3m02s)
21:10:44 START → 21:13:37 DONE   (2m53s)
21:15:44 START ┐
21:20:44 START ┤ ← three cycles concurrently in flight
21:25:44 START ┘
               → 21:24:56 DONE   (= the 21:15 cycle, 9m12s)
               → 21:28:12 DONE   (= the 21:20 cycle, 7m28s)
               → 21:30:09 DONE
21:30:44 START → 21:34:58 DONE   (4m14s)
21:35:44 START → 21:39:59 DONE   (4m15s)
21:40:44 START → 21:44:52 DONE   (4m08s)
21:45:44 START ┐ still open
21:50:44 START ┘
21:55:44 START → 21:56:13 DONE   (29s — belongs to an earlier START)
```

**Capture 2 — 21:55:44Z → 23:08:35Z (73 min): 15 STARTs, 16 DONEs.**

```
22:40:44 START ┐ no DONE before the next START
22:45:44 START ┘ → 22:48:27 DONE
orphan DONEs at 22:13:15 and 22:55:42 (late completions of earlier cycles)
```

Root cause: `runMlbCycleOnce()` has no re-entrancy guard; `CronJobRunner.isRunning` is a
per-instance private field guarding only `.trigger()` calls, and `vsinAutoRefresh.ts`
calls the function directly from a `setInterval` firing every 300 s. Cycle duration ranges
1m40s–9m12s. GitHub Actions has been down since ~15:22Z, so this is the scheduler racing
**itself**, not the cron.

**Target after Task 3.5: STARTs == DONEs, strict alternation, `[SKIP]` lines whenever a
cycle exceeds 300 s.**

**REFUTED consequence — do not remediate for it.** Duplicate rows are impossible. Verified
in applied migration DDL: `mlb_lineups_gameId_unique UNIQUE(gameId)` (`0040:28`),
`uq_game_side UNIQUE(gameId,side)` (`0043:1`), `uq_backtest_game_market UNIQUE(gameId,market)`
(`0051:23`), `uq_hr_game_player UNIQUE(gameId,playerName)` (`0051:53`). Writes are
`.onDuplicateKeyUpdate()` or insert-then-catch-update. The workflow comment claiming these
tables "lack unique constraints" is false — corrected in Task 7.2. Real consequences are
doubled upstream scraping, nondeterministic last-writer-wins, and single-cycle K-props loss
on a lost `ER_DUP_ENTRY` race.

---

## B-4 · SEO / social prerendering

`[Prerender][STEP] botDetected=true` occurrences across the full deployment
(13:19 → 21:54Z, 8.5 h): **0**. Every invocation logged `botDetected=false`.

Concurrently, a genuine `facebookexternalhit` was 403'd at `20:48:23Z` and another at
`15:22:20Z` on `/robots.txt`. `server/landingPrerender.ts` matches googlebot, bingbot,
applebot, facebookexternalhit, twitterbot, linkedinbot, discordbot, slackbot + 10 more.

Honest caveat: in pre-arming deployment `09def22a` (06:32–07:01Z), `botDetected=true`
appears 3 times — but all three coincide with deploy-smoke probes that spoof `Googlebot/2.1`,
so the before/after is suggestive, not clean.

**Target after Task 4.1: > 0.**

---

## B-5 · Backend service public exposure

```
$ curl -sS -D - https://ai-sports-betting-backend-production.up.railway.app/
HTTP/2 200
content-type: text/html; charset=utf-8
x-prerender: 1
content-security-policy: default-src 'self'; … https://js.stripe.com …
<title>dıme — See where price and probability disagree | Sports Betting Intelligence Software</title>
```

12,522 bytes of the real application. Service `3528dc9f-a63b-45e9-94bb-6d1df25d6f3a` is
built from the **same repo and same `main` branch**, registers every route unconditionally,
and holds `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_SESSION_SECRET`,
`DISCORD_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `CRON_SECRET` — with **no `EDGE_MODE` and no
`EDGE_ORIGIN_SECRET`**, so `originLock` short-circuits at `if (mode === "off") return next()`.

Only inbound traffic in 8h25m: `POST /api/internal/analytics/ingest` from
`ai-sports-betting-backend.railway.internal:8080` (status 202), plus exactly one public
request — `GET /robots.txt` from `173.252.82.25` (Meta), status 206.

**Target after Task 1.1: hostname unreachable; private analytics ingest unbroken.**

---

## B-6 · Identity corruption

Production XFF shape, verbatim:

```
x-forwarded-for=104.22.17.115, 84.17.44.227     ← [CF PoP, Railway edge]
x-forwarded-for=172.71.146.42,  84.17.44.228
x-forwarded-for=162.159.99.34,  152.233.47.65
```

238 / 240 sampled leftmost tokens are inside `CF_IPV4_CIDRS`. The 2 exceptions are the
direct-origin T-Mobile 403s. Railway discards Cloudflare's appended client token, so the
true visitor appears **nowhere in XFF** — only in `cf-connecting-ip`, which is **never
logged anywhere**. Second hops span 31 IPs across CDN77 LAX/Toronto, CDNEXT Atlanta and
RIPE ranges. The PoP rotates per connection (one client observed alternating
`162.158.187.41`↔`.42` on a 1-minute cadence).

Under `trust proxy 1`, `req.ip` is the **rightmost** token — Railway's own edge:

```
[CSRF] POST /api/trpc/analytics.track | IP=84.17.44.228 | Origin=https://aisportsbettingmodels.com
[CSRF] POST /api/trpc/analytics.track | IP=152.233.47.67 | Origin=https://aisportsbettingmodels.com
```

All 54 CSRF `IP=` values are Railway edge nodes; zero are CF PoPs.

Live corruption sample:

```
19:57:08 [AppAuth][AUTH_FAIL] BLOCKED | IP=172.71.156.192 reason="user_not_found" identifier="Kwi***@gmail.com"
19:57:08 [DiscordSecurity][BruteForce] AUTH_FAIL recorded | IP=172.71.156.192 | count=1 in last 10 min | threshold=3
19:57:19 [AppAuth][AUTH_FAIL] BLOCKED | IP=172.71.156.192 …
19:57:19 [DiscordSecurity][BruteForce] AUTH_FAIL recorded | IP=172.71.156.192 | count=2 in last 10 min | threshold=3
19:57:19 [DiscordSecurity][DEDUP] Skipping AUTH_FAIL alert for IP=172.71.156.192 — cooldown active
```

`172.71.156.192` ∈ `172.64.0.0/13` = Cloudflare. Labelled "🖥️ Attacker IP Address".
Brute-force counter reached **2 of 3**.

`security_events.ip` is corrupted two different ways: `CSRF_BLOCK` rows hold the Railway
edge; `AUTH_FAIL` / `RATE_LIMIT` rows hold the CF PoP.

**Collateral-lockout exposure, measured:** ~13 distinct visitors, ~6 req/min, 2 login
failures in 6.72 h = 0.074 per 15 min, against a threshold of 10 on one PoP key. **~135×
short — not reachable at current scale.** The inverse also holds: PoP rotation means a real
attacker's in-procedure budget is `10 × N` PoPs, not 10.

**Target after Tasks 3.1–3.4: 0 new rows with a CF or Railway-edge IP.**

---

## B-7 · Alerting fidelity

- Limiter-label map covers **3 of 8** `limitType` slugs; the other five fall through to a
  raw slug plus copy hardcoding "429 Too Many Requests" and "temporarily blocked". The real
  origin-lock response is **403**; `xff_canary` and the `/api/trpc` edge canary block
  **nothing at all**.
- User-agent truncated at exactly 120 chars — reproduced byte-exact, which is why
  `facebookexternalhit/1.1 Facebot Twitterbot/1.0` rendered as `…Safari/601.2.4 fac`.
  Three different truncations exist for the same field: 120 (embed), 60 (deploy log),
  512 (DB).
- Daily digest at 13:00:23Z: `Threat level: HIGH | total=111 events in last 24h`, top-5 IPs
  `47.152.160.175(20), 40.81.6.244(18), 172.182.201.162(18), 48.217.34.226(18), 20.49.13.182(18)`
  — four Microsoft Azure GitHub Actions runners and the owner's own ISP address.
- `formatTimestamp` hardcodes `" EST"`; `20:48:23Z` renders `Aug 6, 2026, 16:48:23 EST`
  when the value is **EDT**.

**Targets: 0 alerts claiming 429 for the origin lock; digest top-5 free of CI/owner
sources; timezone label correct.**

---

## B-8 · Erasure primitive (no production measurement — code-proven)

```
drizzle/schema.ts:2270   trpcPath: varchar("trpcPath", { length: 256 })
server/db.ts:2701        trpcPath: event.trpcPath ?? null            ← no truncation
server/db.ts:2703        userAgent: event.userAgent.substring(0, 512) ← truncated
discordSecurityAlert.ts  const embed = buildEmbed(payload);           ← OUTSIDE the try
```

A >256-char path raises `ER_DATA_TOO_LONG` and the row is lost; a >1024-char field value
throws `CombinedPropertyError` inside `buildEmbed`, escapes, and is swallowed by the call
site's `.catch()`. One long URL erases the event from **both** sinks.

No production instance observed — which is itself the point: an exploited instance would be
invisible by construction. `security_events` counts are a lower bound of unknown tightness.

---

## Blocked measurements

| Measurement | Blocker |
|---|---|
| `waitlist.ipAddress` corrupted row count | `db-query.yml` — GitHub Actions major outage since 15:22:49Z |
| `security_events` census by `eventType` | same |
| Cloudflare orange-cloud timestamp | Cloudflare zone DNS history; no CF API access in session |
| Stripe webhook endpoint host | Owner dashboard check (Task 0.3) |
| Duplicate-row census | `db-query.yml`; schema analysis says impossible, but that is a proof about the constraint, not a census of the data |

---

## CORRECTION — 2026-08-07: section B-4 is WRONG, and Task 4.1 is retracted

**B-4 claimed:** `[Prerender][STEP] botDetected=true` occurrences across deployment `bf99766f`
(13:19→21:54Z, 8.5 h) = **0**, and concluded SEO/social prerendering was dead.

**That claim is false.** A read-only re-query of the *same* deployment ID and window returns six
occurrences:

```
2026-08-06T13:24:08.736Z  [Prerender][STEP] botDetected=true
2026-08-06T13:31:47.104Z  [Prerender][STEP] botDetected=true
2026-08-06T14:08:04.864Z  [Prerender][STEP] botDetected=true
2026-08-06T14:33:27.791Z  [Prerender][STEP] botDetected=true
2026-08-06T16:43:20.988Z  [Prerender][STEP] botDetected=true
2026-08-06T16:43:20.988Z  [Prerender][STEP] botDetected=true
```

Two of these are **genuine, externally-sourced crawlers** reaching `/` through the correctly
Cloudflare-fronted host and being served the prerendered HTML with 200:

- `MJ12bot/v2.0.5` from `51.68.236.71` (OVH) at 16:43:15Z → `botDetected=true`, `PASS — static
  landing HTML sent to crawler`
- `AhrefsBot/7.0` from `51.89.129.148` at 11:06:15Z on the following deployment → same

`isBot()` was additionally tested against every crawler UA actually observed in production —
genuine Meta's literal `facebookexternalhit/1.1 (+http://…)`, the Apple LinkPresentation compound
UA, Googlebot, MJ12bot, AhrefsBot — and classifies all of them correctly, while correctly
rejecting `node` and a vulnerability-scanner string.

**The residual gap is real but far narrower than B-4 described.** Genuine Meta's two 403s
(15:22:20Z on `/robots.txt`, 20:48:23Z on `/login`) were refused by the origin lock because they
arrived at the **raw Railway origin** rather than the Cloudflare-fronted host — and neither path is
gated by the prerender middleware at all, which only inspects `/`, `/privacy` and `/terms`
(`server/landingPrerender.ts:435,450,466`). So those 403s could never have exercised `isBot()`
regardless of outcome. That gap is already owned by Task 1.1 (remove the unprotected second
service's public domain) and the F-1 origin-lock work — not by Task 4.1.

**Disposition: Task 4.1 is RETRACTED.** Nothing in `landingPrerender.ts` needs changing; it is
working as designed and demonstrably firing.

**How the error happened, recorded so it is not repeated.** The "zero occurrences" figure came from
a red-team subagent during the 2026-08-06 audit. It was accepted and propagated as PROVEN without
an independent re-query. This is the second time in this program that a subagent's *negative*
finding (an absence) was reported as proven without verification — the first was the Stripe-webhook
false alarm, where "zero `[StripeWebhook]` lines in 8.5 h" turned out to be a query-window artifact
and webhooks were arriving and returning 200 throughout. **An absence is the single least reliable
class of finding and must always be independently reproduced before it is asserted.**

The original B-4 text above is left intact rather than edited, so the error and its correction both
remain on the record.
