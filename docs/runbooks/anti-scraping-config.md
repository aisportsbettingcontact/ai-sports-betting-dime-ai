# Anti-Scraping & Edge Security — Program Record + As-Built Configuration

> **What this is.** The complete, reference-grade record of the layered anti-scraping /
> IP-protection program for Dime AI: every defensive layer, the exact production
> configuration as deployed, the activation procedure we executed, the verification
> methodology and results, operations/rollback, and the key findings. Written to be
> stored and returned to.
>
> **Companion docs.**
> - `docs/runbooks/edge-defense-cloudflare.md` — the technical edge runbook (design law, the
>   `EDGE_MODE` state machine, the full Cloudflare setup + WAF/cache rules, rollout safety).
> - This file — the *program-wide* record (all layers, not just the edge) + the *as-built*
>   config as actually deployed + how it was verified.
>
> **Secret hygiene.** No secret values appear here. `EDGE_ORIGIN_SECRET` and friends are
> referenced by name only. Cloudflare account IDs are intentionally omitted. Never paste a
> secret or credential into this file.
>
> **Last updated:** 2026-08-06 · edge layer live (`EDGE_MODE=on`) + Cloudflare WAF/Bot active.

---

## 0. The mandate

Owner directive, standing:

> *Industry-level, production-grade, maximum security. Prevent attacks at all costs. Protect
> proprietary IP. Our data must never be scraped, EVER.*

The **proprietary IP** is the model output: projections, win probabilities, edges/differentials,
fair odds, recommended lines, Brier scores, backtest grades. Schedules, book lines, betting
splits, lineups, and actual game results are **commodity** (anyone can get them from a
sportsbook) and stay public.

The program implements **defense in depth**: no single control is trusted alone. If one layer
is bypassed, the next still protects the payload.

---

## 1. Threat model

| Attacker | Vector | Primary control |
| --- | --- | --- |
| Anonymous scraper | `curl` the public API for model fields | **Layer 1** — anon-strip gating (model IP nulled for logged-out callers) |
| Authenticated scraper | a paying user harvesting the full model at volume | **Layer 2** — per-IP feed rate limiting on every model-bearing endpoint |
| IP-rotation / credential stuffing | botnet spreads guesses across many IPs | **Layer 2** true-client keying + **Layer 6** per-account lockout |
| Cross-user data theft | one user reads another's data via an id (IDOR) | **Layer 3** — access-control ownership funnels |
| XSS / injection | attack payloads in requests, or script exfiltration | **Layer 4** security headers (CSP, Permissions-Policy) + **Layer 7** Cloudflare WAF/OWASP |
| **Origin bypass** | scraper finds the raw Railway origin and skips Cloudflare | **Layer 6** — origin lock (`EDGE_MODE=on`) 403s any non-Cloudflare request |
| Bots / automated crawlers | headless/scripted harvesting through the edge | **Layer 7** — Cloudflare Super Bot Fight Mode |

---

## 2. Defense-in-depth architecture

```
                         ┌─────────────────────────────────────────────┐
 Internet ──▶ Cloudflare │ L7  WAF (Managed + OWASP) · Super Bot Fight  │
                         │ L7  Transform Rule: inject x-dime-edge-secret│
                         └───────────────────┬─────────────────────────┘
                                             │  (only Cloudflare has the secret)
                                             ▼
                         ┌─────────────────────────────────────────────┐
 Railway edge  ──▶  App  │ L6  originLock  — 403 unless CF-secret + CF  │
   (69.46.46.66)         │     upstream (EDGE_MODE=on) + circuit breaker│
                         │ L4  helmet: CSP/HSTS/Permissions-Policy      │
                         │ L2  rate limiters (feed / auth / stripe / …) │
                         │ L1  feedGating: strip model IP for anon      │
                         │ L3  access control: ownership funnels        │
                         │ L6  accountLockout: per-account brute-force  │
                         └─────────────────────────────────────────────┘
```

A request must survive **all** layers to reach model IP. Anonymous callers are stripped at L1
even if every edge control were removed; the edge (L6/L7) is defense-in-depth on top.

---

## 3. The layers, in detail

### 3.1 Layer 1 — Model-IP gating (Phase 3) · `server/feedGating.ts`

For **anonymous** callers, model fields are nulled at the wire layer before serialization.
Authenticated callers get the full payload (the feed UX is already `RequireAuth`-gated).

Two independent strip rules, applied per model-bearing table:

1. **Name rule** — any field whose name contains `"model"` (case-insensitive) is nulled.
   Catches `modelTotal`, `awayModelSpread`, `modelPHr`, `modelRunAt`, and anything added later.
2. **Explicit lists** — `*_PROPRIETARY_FIELDS` arrays for model-*relative* fields whose names
   lack a `"model"` token (the recurring blind spot — see below).

Strip functions: `stripGameModelFields`, `stripStrikeoutPropModelFields`, `stripHrPropModelFields`,
`stripWcMatchupModelFields`, plus the db-layer NCAAM `publishedModel` gate.

**The recurring bug class — "model-relative fields lacking a `model` token"** (leaked and fixed
4×). These slip past the name rule and get forgotten from the explicit lists:
- `games.list`: `brier*` scores (algebraically reconstruct the nulled model probabilities on
  finals), `nrfiCombinedSignal` / `nrfiFilterPass`, the `*Correct` correctness flags.
- `strikeoutProps`: `kLine` (schema: *"Model recommended line"*), `matchupRows`, `inningBreakdown`,
  `bestMlStr`, `modelError`.
- `wc2026`: the `book_id = 0` fair-odds snapshot (the model's fair odds).
- `hrProps.backtestResult` (**PR #402**) — WIN/LOSS *only when the model's verdict was OVER*, so
  it re-identifies the model's actionable pick list. Confirmed live-leaking, then fixed.
- Latent residuals swept in **PR #404**: `games.nrfiBacktestResult`, `{fg,f5,nrfi}BacktestRunAt`,
  `strikeout.backtestRunAt`.

**Distinguish commodity from IP by definition:** a K-prop `backtestResult` is OVER/UNDER/PUSH vs
the *book* line (commodity, kept); an HR-prop `backtestResult` is WIN/LOSS vs the *model's*
verdict (IP, stripped). Actual outcomes (`actualHr`, `actualKs`, final scores, `nrfiActualResult`)
stay public.

**Rule to apply going forward:** every new model-bearing tRPC procedure or `mlb_*_props` / `games`
column → audit every field the anon strip returns and ask *"is this value defined relative to the
model's own pick/verdict/probability?"* If yes, add it to the field's `*_PROPRIETARY_FIELDS`.

**Cache headers** (`setGatedCacheHeaders`): authed responses carry `private, no-store` (no shared /
edge cache can store model IP and cross-serve it to an anon scraper); anon responses get a short
public cache; always `Vary: Cookie`.

### 3.2 Layer 2 — Rate-limit coverage · `server/_core/trpcRateLimitPolicy.ts` (PR #408)

The client uses `httpBatchLink`, so tRPC calls arrive as a comma-separated procedure list
(`/api/trpc/a.b,c.d`). A naive path-prefix mount is *batch-evadable* (a comma breaks the match).
All procedure-scoped limiters therefore dispatch through **one classifier**
(`createTrpcRateLimitDispatch`) that percent-decodes and splits the batch, takes the **strictest**
class present, and is keyed **class-stable + IP-derived** (never path-derived, so an attacker
can't mint a fresh budget per batch composition).

Classes: `auth` (login 5/15min), `stripe_checkout` (10/15min), `waitlist` (5/15min), and
**`public_feed`** — the scraper hot path, `feedProcedureLimiter` = **60/min/IP**, fails **open**
(the feed is the product; a limiter fault must never 5xx).

**PR #408 closed a coverage gap:** several model-bearing feed procedures were anon-stripped but
absent from `public_feed`, so they rode only the loose global limiter (~200/min). They return
stripped data to anon but full model IP to authenticated callers, and the `*ByGames` batch shapes
return a whole slate's IP in one call → prime authenticated-scraper targets. Added to `public_feed`:
`strikeoutProps.getByGame` / `getByGames`, `hrProps.getByGame` / `getByGames`,
`wc2026.todayWithOdds` / `closingOdds` / `latestOdds`.

**True-client keying** (`clientIpKey` → `resolveClientIp`): keys on the **leftmost sanitized
`X-Forwarded-For`** entry (the true client), *not* `req.ip` (which under `trust proxy = 1` is the
rotating Railway edge node). When Cloudflare is armed (`EDGE_MODE` ≠ `off`) and the request
cryptographically proves it came through our edge, it keys on `cf-connecting-ip` instead (so a
whole CF PoP doesn't collapse onto one budget). IPv6 is /56-normalized via `ipKeyGenerator`.

**Live discriminator** (how to prove which limiter is active): both `globalApiLimiter` (200) and
the feed limiter (60) emit draft-7 headers; the feed dispatch mounts *after* the global limiter,
so for a `public_feed` procedure the feed header overwrites the global one. Probe production and
read `RateLimit-Policy`: **`60;w=60` = feed-capped, `200;w=60` = global only.** Verified live: all
covered procedures report 60 and share one `ip:public_feed` bucket; non-covered report 200.

### 3.3 Layer 2b — XFF-sanitization ratification (verified live)

The rate-limit keying above assumes Railway's edge **discards** any client-supplied
`X-Forwarded-For` and rewrites it. **Ratified in production:** sending three *different* injected
`x-forwarded-for` values decremented the **same** feed rate-limit bucket → Railway keys on the
true client, not the injected value. An attacker cannot rotate spoofed XFF to mint fresh buckets.
A **live canary** (`server/_core/index.ts`, on `/api/trpc`) fires a security alert if a public
request ever resolves to a reserved/internal IP (`isReservedOrInternalIp`) — i.e. if Railway's hop
structure ever changes and the assumption breaks.

### 3.4 Layer 3 — Broken Access Control / IDOR (OWASP #1 — audited airtight)

A 6-agent adversarial audit classified **53 authenticated procedures** across `betTracker`,
`dimeChats`, `appUsers`, favorites, and wc2026; each suspected cross-user access got an
"construct-the-exploit" verification. **Result: 0 IDOR.** Enforcement patterns (preserve these
when adding authed by-id procedures):
- `betTracker` reads funnel through `resolveScopeChecked → resolveViewUserId` (`betTrackerCore.ts`;
  a `user`/`handicapper` role can read *only self*; owner/admin cross-user is by design);
  mutations use `decideBetMutation` after loading `existing.userId`.
- `dimeChats` uses `getOwnedThread(db, id, ctx.appUser.id)` for every by-id op; list is
  `eq(dimeChatThreads.userId, ctx.appUser.id)`.
- `appUsers` mutations act only on `ctx.appUser.id` with whitelisted fields (no mass-assignment;
  never trust a client-supplied `userId`).
- The one unauthenticated Express endpoint (`GET /api/dime/wc2026/audit/:requestId`) is a
  122-bit random `crypto.randomUUID()` capability URL, never disclosed cross-user, returns no
  `user_id` — not an IDOR.

**Rule:** a new authed by-id read/mutation needs a user-id-scoped `WHERE` *or* a load-then-check on
the owner column — not merely a reference to `ctx.appUser.id`.

### 3.5 Layer 4 — Security headers · helmet + `server/_core/securityHeaders.ts` (PR #410)

Live posture (verified in production):
- **CSP** — `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'self'`; `base-uri 'self'`;
  `form-action 'self'`; `upgrade-insecure-requests`; `script-src 'self' 'unsafe-inline' https://js.stripe.com`;
  Stripe origins in `frame-src`; fonts scoped.
- **HSTS** — `max-age=31536000; includeSubDomains` (origin-owned; Cloudflare HSTS left off to keep
  a single source of truth).
- `X-Frame-Options: SAMEORIGIN` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: no-referrer`
  · `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy: same-origin` ·
  `X-XSS-Protection: 0` · no `X-Powered-By`.
- **Permissions-Policy** (PR #410 — helmet dropped it in v5+, so it's set explicitly): denies every
  unused device/sensor capability (`camera`, `microphone`, `geolocation`, `usb`, `serial`,
  `bluetooth`, `hid`, `midi`, `accelerometer`, `gyroscope`, `magnetometer`) so a successful XSS
  can't reach them; opts out of FLoC/Topics (`interest-cohort`, `browsing-topics`);
  **`payment=(self "https://js.stripe.com" "https://checkout.stripe.com")`**.
  **⚠ Never deny `payment`** — it breaks Apple/Google Pay inside Stripe Embedded Checkout.

### 3.6 Layer 6a — Account lockout · `server/accountLockout.ts`

Per-**account**, DB-backed on `app_users` (defeats distributed credential stuffing that per-IP
limiting can't). Checked before bcrypt; returns a generic `UNAUTHORIZED "Invalid credentials"`
whether the account is locked or the password is wrong (no username-existence oracle); counts
atomically (`SELECT … FOR UPDATE`, fail-open); auto-expires; cleared on success and on password
reset; fires `account_locked_triggered` alerts so targeted lockout campaigns are visible.
**Documented DoS tradeoff:** a time-boxed lockout is a mild DoS lever (an attacker who knows a
username can lock it for the cooldown) — accepted as the standard shape because the alternative
(no lockout) leaves stuffing wide open. Tunable via `ACCOUNT_LOCKOUT_*` env vars.

### 3.7 Layer 6b — Edge origin lock (Phase 4) · `server/_core/originLock.ts`, `edgeProxy.ts`, `edgeCircuitBreaker.ts` (PR #414)

Renders a direct hit on the raw Railway origin useless once armed: any request that does not carry
a valid `x-dime-edge-secret` **and** arrive from a Cloudflare-range upstream is **403**'d — except
`/health` (Railway's probe must stay green through a CF-edge outage).

**`EDGE_MODE` state machine** (read at request time):

| `EDGE_MODE` | Origin lock | Use |
| --- | --- | --- |
| unset / `off` | pass-through (byte-identical to pre-Cloudflare) | default / rollback-to-legacy |
| `log` | observe-only, never 403; emits `edge_would_deny` | the soak: prove CF injects the secret before enforcing |
| `on` | **403** non-edge traffic (except `/health`) | full enforcement |

**The proof** (`edgeProofPasses`): a valid origin secret (constant-time compared, supports
zero-downtime rotation via `EDGE_ORIGIN_SECRET_PREV`) **AND** a Cloudflare-range immediate upstream.
The secret is the load-bearing factor; the CF-range check is defense-in-depth. Only Cloudflare
holds the secret (injected by the Transform Rule), so without CF in front, *no* request passes.

**Anti-lockout self-heals** (two, so arming can't cause a #370-class outage):
1. `on` with **no secret** configured → downgrade to observe-only + CRITICAL log (never 403 the
   whole site).
2. `on` with a secret but **Cloudflare not actually in front** (DNS not orange, secret typo, CF
   outage) → the **circuit breaker** (`edgeCircuitBreaker.ts`, PR #414) auto-downgrades enforcement.

**Circuit breaker design (hardened against a 4-lens adversarial review that broke a naive
version):** trip **only** after `EDGE_BREAKER_TRIP_WINDOWS` (default 3) **consecutive** windows
(`EDGE_BREAKER_WINDOW_MS`, 60 s) each closing with `≥ minSample` (200) requests and
`≤ verifiedFloor` (0) verified — i.e. ~3 minutes of *sustained, total* CF absence. A "verified"
request requires the secret only Cloudflare forwards, and a **single** verified request anywhere in
a window resets the streak → un-gameable by a direct-origin flood while real users flow. A trip
downgrades **only** the origin-lock 403 layer; L1 gating + L2 limiters still protect the payload;
auto-recovers when verified traffic returns. Ships inert (`EDGE_MODE=off` → never runs). Tunable via
`EDGE_BREAKER_*`.

**CF CIDR freshness:** `CF_CIDR_SNAPSHOT_DATE` + a boot staleness warning (armed only); refresher
script `scripts/refresh-cf-cidrs.mjs` (`--check` for drift) and monthly read-only workflow
`.github/workflows/refresh-cf-cidrs.yml` (goes red on drift; a maintainer runs the script and opens
the PR through the normal reviewed flow).

### 3.8 Layer 7 — Cloudflare WAF + Bot Fight Mode (Step 5)

The application's functional surface is entirely under `/api/*` (+ `/health`, `/dime-storage/*`) and
is already hardened by L1–L6. It also carries exactly what a WAF false-positives on: SSE streams,
free-text bet notes in batched tRPC, a signature-verified Stripe webhook, OAuth callbacks, and cron.
So the design is: **skip the managed WAF + Bot challenges for the entire `/api` surface; apply them
to the browseable web surface** (`/`, `/feed`, `/splits`, `/projections`, `/dashboard`, static
assets), where OWASP rules are safe and valuable. Exact config in §4.

---

## 4. Cloudflare — as-built configuration (the record)

Zone: `aisportsbettingmodels.com` (Cloudflare plan: Pro). Origin: Railway.

### 4.1 DNS
- Root `@` → **CNAME** `t8orqjm9.up.railway.app` — **Proxied (orange)**
- `www` → **CNAME** `sg3mq9l9.up.railway.app` — **Proxied (orange)**
- `MX` (smtp.google.com), `SPF` / `DMARC` / `DKIM` `TXT`, `_railway-verify` `TXT` — **DNS-only (grey)**

> **Each Railway custom domain gets its own `*.up.railway.app` target** — apex and www are *not* the
> same target. Never point the root at www's target. The raw `*.up.railway.app` hostnames return
> `404 Application not found` on their own (Railway routes by Host header). A *proxied* record
> resolves to a Cloudflare `104.x / 172.64.x` anycast IP — that's how to confirm orange is live.

### 4.2 SSL/TLS
- Mode: **Full (Strict)** (Railway serves a valid cert for the custom domain).
- Cloudflare "Always Use HTTPS" / HSTS: **off** (origin emits HSTS; single source of truth).

### 4.3 Transform Rule (origin-secret injection)
- Rules → Transform Rules → **Modify Request Header** → *Set static*:
  `x-dime-edge-secret` = the value of Railway's `EDGE_ORIGIN_SECRET`. (Use Cloudflare Secrets Store
  if available so the value isn't visible in the dashboard.) Applies to all requests.

### 4.4 WAF — Custom rule #1 (the exemption; order **First**, Active)
Name: **`Skip WAF+Bot for app API`** · Action: **Skip** →
`All remaining custom rules` + `All managed rules` + `All Super Bot Fight Mode Rules`.

Expression:
```
(starts_with(http.request.uri.path, "/api/")) or (http.request.uri.path eq "/health") or (starts_with(http.request.uri.path, "/dime-storage/"))
```
This fences the entire app API/chat/webhook/cron surface off from **both** the firewall and bot
fighting — so Stripe webhooks, cron, OAuth, SSE chat, and batched tRPC are never blocked.
(A separate "managed rules exception" with the same expression also exists — redundant with this
custom rule for the managed-rules part; harmless.)

### 4.5 WAF — Managed rulesets (execute on all requests; API skipped by rule #1)
- **Cloudflare Managed Ruleset** — Ruleset action **Default** (Cloudflare's per-rule tuning),
  Ruleset status **Default**.
- **Cloudflare OWASP Core Ruleset** — Anomaly Score Threshold **Medium (40+)**, Paranoia **PL1**,
  Action **Managed Challenge** (softer than Block — real browsers pass an invisible check; a false
  positive doesn't hard-403 a human).

### 4.6 Super Bot Fight Mode
- **Verified bots: Allow** (Google/Bing/Apple/social unfurlers — keeps SEO working)
- **Definitely automated traffic: Block**
- JS Detections: **Off** (avoids conflict with the strict CSP) · Static resource protection: **Off**
  · Optimize for WordPress: **Off**
- Legacy "Bot Fight Mode" / "I'm Under Attack": **not enabled**.

---

## 5. Environment variables reference (all set in Railway → `stunning-creativity` → production)

| Variable | Purpose | Value in prod |
| --- | --- | --- |
| `EDGE_MODE` | origin-lock state (`off`/`log`/`on`) | **`on`** |
| `EDGE_ORIGIN_SECRET` | shared secret Cloudflare injects as `x-dime-edge-secret` | set (secret) |
| `EDGE_ORIGIN_SECRET_PREV` | second accepted secret for zero-downtime rotation | optional / unset |
| `EDGE_BREAKER_WINDOW_MS` | circuit-breaker rolling window | default 60000 |
| `EDGE_BREAKER_MIN_SAMPLE` | min requests/window before a trip is possible | default 200 |
| `EDGE_BREAKER_VERIFIED_FLOOR` | a window is "starved" at ≤ this many verified | default 0 |
| `EDGE_BREAKER_TRIP_WINDOWS` | consecutive starved windows to trip | default 3 |
| `EDGE_BREAKER_RECOVER_FLOOR` | verified requests to auto-recover | default 3 |
| `EDGE_BREAKER_DISABLED` | `1` = force unconditional enforcement (no auto-downgrade) | unset |
| `FEED_RATE_LIMIT_MAX` | feed limiter cap (per min/IP) | default 60 |
| `FEED_RATE_LIMIT_DISABLED` | `1` = kill-switch for the feed class only | unset |
| `ACCOUNT_LOCKOUT_THRESHOLD` / `_WINDOW_MS` / `_COOLDOWN_MS` / `_DISABLED` | per-account lockout tuning | defaults (10 / 15min / 15min / off) |

> **Secret law:** never print, persist in evidence, or move these values between scopes. Railway env
> only. Schema changes ride `db-push.yml` before dependent code (deploy-order law); env-only changes
> just redeploy the same commit.

---

## 6. Activation procedure (executed 2026-08-06, in order)

1. **Secret** — `openssl rand -hex 32` → Railway `EDGE_ORIGIN_SECRET` (left `EDGE_MODE` unset).
2. **SSL** — Cloudflare SSL/TLS → **Full (Strict)**.
3. **Orange cloud** — DNS: apex + www → **Proxied**. (Verified live: apex now resolves to a
   Cloudflare anycast IP; `cf-ray` present; site 200. The safe "orange but not enforcing" state —
   the origin lock is still off, so nothing can lock out.)
4. **Transform Rule** — inject `x-dime-edge-secret` = the secret.
5. **WAF + Bots** — the exemption custom rule (§4.4) **first**, then the managed rulesets (§4.5),
   then Super Bot Fight Mode (§4.6).
6. **Soak** — `EDGE_MODE=log`. Verified (see §7) that legit CF traffic passes the proof and
   direct-origin traffic is flagged — *before* enforcing.
7. **Arm** — `EDGE_MODE=on`. Verified enforcement live (§7).

> **The golden ordering rule:** never set `EDGE_MODE=on` until the `log` soak proves Cloudflare is
> injecting the secret on every request. Arming before CF is truly in front would 403 all traffic;
> the circuit breaker now self-heals that, but the ordering is still the law.

---

## 7. Verification methodology + results (all run against production)

Three probe techniques were used (client-side; `curl` is not on the sandbox PATH so Node `fetch` /
`tls` was used):

**A. Through Cloudflare** — plain `fetch` to `https://aisportsbettingmodels.com/…` (carries `cf-ray`;
the Transform Rule stamps the secret).

**B. Direct-origin bypass** — a raw TLS connection to Railway's edge IP with an **SNI/Host override**
(`tls.connect({ host: <railwayIP>, servername: "aisportsbettingmodels.com" })` + `Host:` header).
This reaches the app *around* Cloudflare — the exact attack the origin lock defends against.

**C. Railway logs** — `edge_would_deny` / `edge_deny` surface as
`[RateLimit][EDGE_ORIGIN_INGRESS_ANOMALY] BLOCKED | IP=… path=… ua=…`; `xff_canary` similarly.
(Cloudflare-edge blocks never reach Railway, so CF-side blocks are confirmed via probes A/B, not
Railway logs.)

**Results:**

| Check | Result |
| --- | --- |
| XFF sanitization (3 spoofed XFF → one bucket) | ✅ Railway keys on true client |
| Rate-limit coverage (`RateLimit-Policy` on covered vs non-covered) | ✅ 60 (feed) vs 200 (global), shared feed bucket |
| Permissions-Policy live + exact value; other headers intact | ✅ no regression |
| `log` soak — 18 requests **through** Cloudflare | ✅ **0** anomalies (proof passes for CF traffic) |
| `log` soak — 5 requests **direct** to `69.46.46.66` (bypass) | ✅ 5× `EDGE_ORIGIN_INGRESS_ANOMALY` + Discord alert (proof correctly fails; log mode = observe-only, still served) |
| `on` — site through Cloudflare (`/`, `/health`, `/api/trpc`) | ✅ 200 / 200 / 400 (served, **not** 403) |
| `on` — direct-origin bypass to `/api/trpc` | ✅ **403 Forbidden** (hole closed) |
| `on` — direct-origin bypass to `/health` | ✅ 200 (exempt; Railway probe stays green) |
| `on` — real-user false-blocks in logs | ✅ only the probe IP; **0** real users blocked |
| WAF/Bot — `/api/*` (trpc/chat/webhook/health) through CF | ✅ reachable (400 / 401 / 400 / 200) — **payments safe** |
| WAF/Bot — web surface via automated probe | ✅ **403** (firewall + bot active on the web surface) |
| WAF/Bot — real browser loads homepage + feed | ✅ confirmed by owner (bot mode not over-blocking humans) |

---

## 8. Operations — monitoring, alerts, rollback

- **Alerts.** Origin-lock anomalies and rate-limit blocks post to the Discord security channel via
  `fireRateLimitEvent`. A CRITICAL log line fires on `edge_no_secret` and on `edge_breaker_tripped`.
  Add an **external synthetic monitor through the Cloudflare hostname** — Railway's `/health` probes
  the origin directly and stays green through a CF-edge outage, so it will **not** catch an edge
  failure.
- **Rollback (fast path).** Set `EDGE_MODE=log` in Railway → the site is instantly healthy (correct
  rate-limit keys, no 403s), no DNS change, no propagation wait. Diagnose, then re-arm.
- **Rollback (full).** Grey-cloud the DNS records **and** set `EDGE_MODE=off` → legacy behavior.
- **WAF over-blocking.** If real users report being blocked on the web surface, soften Super Bot
  Fight Mode's **Definitely-automated** from `Block` → `Managed Challenge`; lower OWASP paranoia
  stays PL1; the `/api` exemption already shields all app functionality.
- **Secret rotation.** Set `EDGE_ORIGIN_SECRET_PREV` = old, `EDGE_ORIGIN_SECRET` = new, update the
  Cloudflare Transform Rule, then clear `_PREV`.

---

## 9. Key findings & gotchas (learned the hard way)

- **The origin-bypass vector was real and open.** Before arming, a TLS+SNI probe to Railway's edge
  IP `69.46.46.66` with `Host: aisportsbettingmodels.com` reached the app (real tRPC response,
  no `cf-ray`). `EDGE_MODE=on` is what closes it. `69.46.46.66` is Railway's edge anycast IP (it was
  also the domain's old apex `A` record).
- **Railway routes by Host header.** The raw `*.up.railway.app` hostnames 404 on their own; only the
  custom-domain Host reaches the app. Each custom domain has its **own** `*.up.railway.app` target.
- **The naive circuit-breaker design was attacker-trippable** — a single-tumbling-window trip could
  be forced by a direct-origin flood, disabling the lock. Caught by a 4-lens adversarial review
  *before* shipping; redesigned to the consecutive-window, un-gameable form (§3.7).
- **"model" substring rule creates false confidence** — model-relative derived/backtest/timing
  fields without a `model` token are the blind spot (leaked 4×). Audit every field by definition.
- **Never deny `payment`** in Permissions-Policy — breaks Apple/Google Pay in Stripe Embedded
  Checkout.
- **WAF exemption must cover BOTH the managed rules AND Super Bot Fight Mode** — a "managed rules
  exception" alone does not exempt bots; without the bot skip, `Definitely automated: Block` would
  block the Stripe webhook (automated, non-browser) at the edge and break payments.
- **Cloudflare-edge blocks don't appear in Railway logs** (they never reach the origin) — verify
  edge behavior with client-side probes, not app logs.

---

## 10. Known open issue (NOT edge-related)

**Dime Chat — `claude-fable-5` model call returns 400 `APIError`.** The chat request traverses the
full edge cleanly (`dime.chat.request` → `dime.chat.context` → `dime.chat.stream.start` all succeed);
only the **outbound** LLM call to `claude-fable-5` fails with a 400 after ~3.3 s. This is an
app/model-gateway bug, independent of Cloudflare / the origin lock / the WAF (the request reaches
the app; the failure is the server→gateway call). Triage separately: trace the model config in the
chat handler, inspect the 400 body from the gateway, and determine whether it's the model ID, the
request shape/params, or a gateway/quota issue.

---

## 11. Change index (PRs & commits)

| PR | Layer | Summary | Merge commit |
| --- | --- | --- | --- |
| #402 | L1 | HR-prop `backtestResult` model-IP leak (live-confirmed) fixed | — |
| #404 | L1 | Exhaustive sweep of latent model-relative gating residuals | — |
| #408 | L2 | Put every model-bearing feed read on the `public_feed` rate cap | `f9c481175` |
| #410 | L4 / L3 | `Permissions-Policy` header + Broken-Access-Control audit (airtight) | `8090ce285` |
| #414 | L6 | Self-healing origin-lock circuit breaker + Phase 4/lockout/XFF ratification | `646bb7dec` |

Related source files: `server/feedGating.ts`, `server/_core/trpcRateLimitPolicy.ts`,
`server/_core/originLock.ts`, `server/_core/edgeProxy.ts`, `server/_core/edgeCircuitBreaker.ts`,
`server/_core/securityHeaders.ts`, `server/accountLockout.ts`, `server/_core/index.ts`,
`docs/runbooks/edge-defense-cloudflare.md`. `EDGE_MODE=on` first went live on Railway deployment
`dabf0453` (2026-08-06).

---

## 12. Cheat sheet

```bash
# Prove the feed rate-limit cap is active on a procedure (read RateLimit-Policy header):
#   60;w=60 = feed-capped (public_feed)   |   200;w=60 = global only
node -e 'fetch("https://aisportsbettingmodels.com/api/trpc/games.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D").then(r=>console.log(r.headers.get("ratelimit-policy")))'

# Prove the origin lock is enforcing (direct-origin bypass must be 403):
#   TLS to Railway edge IP with Host override — see §7 technique B.

# Confirm orange is live (must include cf-ray + resolve to a Cloudflare 104.x/172.64.x IP):
node -e 'fetch("https://aisportsbettingmodels.com/health",{redirect:"manual"}).then(r=>console.log(r.status,r.headers.get("server"),r.headers.get("cf-ray")))'
```

**Rollback, one move:** `EDGE_MODE=log` in Railway → instantly healthy, blocks nothing.

**The mandate, restated:** proprietary model IP must never be scraped. Anonymous callers get
commodity data only; authenticated callers are rate-capped; the origin cannot be reached around
Cloudflare; the web surface has WAF + bot protection. Defense in depth — no single layer is trusted
alone.
