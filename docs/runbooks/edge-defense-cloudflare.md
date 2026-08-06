# Edge Defense Runbook — Cloudflare in front of Railway (Phase 4)

> **Owner-executed. Nothing here is live until you do the DNS/Cloudflare steps AND flip `EDGE_MODE`.**
> The supporting code shipped inert (`EDGE_MODE` unset = byte-identical to today). This runbook is
> the anti-scraping edge layer from the maximum-security program; it was designed against a 5-lens
> adversarial review (origin-bypass, IP-spoof, cache-leak, collateral-damage, rollout-safety) and the
> fixes are baked into both the code and the steps below.
>
> **⚠ CURRENT STATE (verified live 2026-08-06).** The domain is **already a Cloudflare zone** —
> nameservers are `clay.ns.cloudflare.com` / `maria.ns.cloudflare.com` (the domain was purchased on
> Cloudflare) — but the DNS **records are grey-clouded (DNS-only)**, so Cloudflare answers DNS yet does
> **not** proxy HTTP: `aisportsbettingmodels.com` responds `server: railway-hikari`, `x-railway-edge`,
> no `cf-ray`. Records today: apex `A 69.46.46.66`, `www CNAME sg3mq9l9.up.railway.app` (a *proxied*
> record would instead resolve to a Cloudflare `104.x/172.64.x` anycast IP). **The zone already exists
> — activation is flipping those records to Proxied (orange), NOT adding the domain (skip step 4's
> "add to Cloudflare"; the delegation is done).** `EDGE_MODE` MUST stay unset/`off` until the records
> are orange-clouded, the secret Transform Rule is live, AND the `log` soak (step 12) proves Cloudflare
> is injecting the secret — flipping `on` before CF actually proxies would 403 every real request (the
> #370-class outage). The new circuit breaker (§6) now *self-heals* that mistake, but the ordering is
> still the law. `EDGE_MODE=on` is a **Railway env change the owner makes** — no PR merge sets it.

## 0. The one thing to understand first

The app already gates model IP behind login (Phase 3) and keys rate limits on the true client
(Phase 1). Cloudflare adds a **hop** in front of Railway. That hop is powerful (WAF, bot management,
edge rate limiting) but it introduces three failure modes this runbook exists to prevent:

1. **Origin bypass** — if a scraper finds the raw `*.up.railway.app` URL, they skip Cloudflare
   entirely. **The edge is worthless without an origin lock.**
2. **IP mis-resolution** — behind Cloudflare the leftmost `X-Forwarded-For` becomes the *Cloudflare
   PoP* IP, not the visitor. Left unhandled, every user behind a PoP collapses onto one rate-limit
   key and the security canary goes blind. The code fixes this by reading `cf-connecting-ip` **only
   when the request proves it came through our edge**.
3. **Collateral damage** — a WAF in Block mode will 403 legitimate Dime Chat text and betting jargon
   at the edge, before the app ever sees it. The WAF must **skip** the JSON/free-text API surface.

## 1. The `EDGE_MODE` state machine (read at request time)

| `EDGE_MODE` | Origin lock | IP resolution | Use |
| --- | --- | --- | --- |
| unset / `off` | pass-through | legacy leftmost-XFF | **default** — inert, byte-identical to pre-Cloudflare |
| `log` | observe-only (never 403) | **`cf-connecting-ip` when the edge proof passes** | staging soak: confirm CF is injecting the secret on real traffic |
| `on` | **403** non-edge traffic (except `/health`) | `cf-connecting-ip` when the edge proof passes | full enforcement |

**Why `log` already switches IP resolution:** keying is *decoupled* from the 403. That makes `log` a
**fully healthy rollback target** — if enforcement misbehaves under `on`, set `EDGE_MODE=log` and the
site is immediately healthy (correct keys, no 403s, no PoP collapse), no DNS change needed. Only `off`
(meaning "Cloudflare is no longer in front") returns to legacy XFF keying.

### Environment variables

- `EDGE_MODE` = `off` | `log` | `on` (unset ⇒ off).
- `EDGE_ORIGIN_SECRET` = 32+ byte hex (`openssl rand -hex 32`). The value Cloudflare injects as the
  `x-dime-edge-secret` request header. **Railway env only — never logged, never in evidence.**
- `EDGE_ORIGIN_SECRET_PREV` = optional; a second accepted secret for zero-downtime rotation.

**Anti-lockout (two independent self-heals):**

1. `EDGE_MODE=on` with *no* secret configured downgrades to observe-only + a CRITICAL log line — it
   will not 403 the whole site. The fail-closed guarantee holds whenever a secret is set.
2. `EDGE_MODE=on` **with** a secret but Cloudflare not actually in front (DNS not orange-clouded /
   secret typo / CF outage) is caught by the **circuit breaker** (§6): after `EDGE_BREAKER_TRIP_WINDOWS`
   consecutive windows with no verified Cloudflare ingress, enforcement auto-downgrades to observe-only
   and fires a CRITICAL line, then auto-resumes when verified traffic returns. A single genuine CF
   request in any window resets the streak, so an attacker cannot force the downgrade while users flow.

## 2. The origin lock — the load-bearing decision (origin-bypass fix)

The code enforces a **shared secret** (`x-dime-edge-secret`, constant-time compared) plus a
Cloudflare-IP-range check. **The IP-range check is defence-in-depth ONLY** — anyone can route your
origin through their *own* free Cloudflare zone and arrive from a real CF PoP IP, so a leaked secret
alone would be enough to bypass. Therefore you MUST add a proof bound to *your* Cloudflare account.
Pick one (in order of preference):

- **A — Cloudflare Tunnel (recommended for Railway).** Run `cloudflared` as a sidecar; it dials
  **outbound** to Cloudflare, so there is **no public origin ingress at all** — the `*.up.railway.app`
  URL stops serving web traffic. This eliminates origin-bypass by construction. Trade-off: a second
  process in the container. This is the strongest option.
- **B — Authenticated Origin Pulls (mTLS).** Cloudflare presents a client certificate the origin
  validates; an attacker's own CF zone cannot present *your* per-zone cert. Requires the origin to be
  able to validate client certs (Railway terminates TLS at its edge — confirm feasibility before
  relying on this; if Railway can't validate the cert at the origin, use option A).
- **C — Shared secret only (interim).** The code's default. **Treat `EDGE_ORIGIN_SECRET` leakage as
  catastrophic** (full bypass + IP spoofing): rotate on any suspicion (set `_PREV`=old, `SECRET`=new,
  update the CF Transform Rule, then clear `_PREV`), add log/response scrubbing, and alert if the
  secret value ever appears in any output. Do **not** treat the IP-range check as a real second factor.

`/health` is always exempt from the lock (Railway's healthcheck probes the origin directly and must
stay green during a Cloudflare-edge outage).

## 3. Owner setup — ordered

1. **Merge the PR.** `EDGE_MODE` unset, no secret → verified inert. Nothing activates on deploy.
2. `openssl rand -hex 32` → store in your password manager.
3. In **Railway → project `stunning-creativity` → production** set `EDGE_ORIGIN_SECRET`. **Leave
   `EDGE_MODE` unset.** Restart. Confirm the app is unchanged.
4. Add `aisportsbettingmodels.com` to Cloudflare. Create apex + `www` DNS records at the Railway
   origin, initially **DNS-only (grey cloud)**.
5. **SSL/TLS = Full (Strict).** Leave Cloudflare HSTS **off** (the origin emits HSTS). Do **not** add
   any Cloudflare www/http redirect rule — the app issues a 308 www→apex itself (a CF 301 would drop
   POST bodies). Keep **Preserve Host Header ON**.
6. Validate the site end-to-end over HTTPS while still grey-clouded. Then set the origin lock
   (option A tunnel, or B mTLS, or accept C). For A: stand up the tunnel and point DNS at it. For
   B/C: flip apex + `www` to **Proxied (orange)**.
7. **Transform Rule** (skip if using a tunnel that injects at the connector): *Modify Request Header →
   Set* `x-dime-edge-secret` = `<EDGE_ORIGIN_SECRET>` (bind from Cloudflare Secrets Store if available
   so the value isn't visible in the dashboard).
8. **WAF** — Managed Ruleset + OWASP core, **low paranoia**. **SKIP (or Log-only, never Block) for the
   free-text / JSON API surface** — this is the collateral-damage fix, non-negotiable:
   - `/api/dime/chat`, `/api/dime/wc2026` (free-form NL → LLM; SSE stream),
   - `/api/trpc/*` (the comma-batched mutation surface: bet notes, titles, searches),
   - plus the existing `/api/stripe/webhook` and `/health`.
   Also **disable WAF response inspection/buffering on `/api/dime/chat`** (it is Server-Sent Events —
   buffering stalls token streaming). Keep OWASP Block on GET/marketing/static only. The app's Zod
   schemas + `sanitizeDimeChatHistory` + login gating + the six rate limiters are the real input
   defense.
9. **Super Bot Fight Mode:** Verified bots = **Allow** (Googlebot/Bingbot/Applebot/social unfurlers);
   Definitely-automated = Block; Likely-automated = **Managed Challenge scoped OUT of `/api/*` and
   `/`** (never challenge the SPA XHR path or the SEO prerender). Do **not** enable legacy Bot Fight
   Mode or "I'm Under Attack".
10. **Edge Rate Limiting** keyed on `cf.connecting_ip`: login 5/15m challenge; `stripe.publicCreate`
    10/15m block; `waitlist.submit` 5/15m block; `/api/*` 200/min block. (These complement, not
    replace, the app-layer limiters.)
11. **Cache Rules — order matters (cache-leak fix):**
    - Turn **ON "Normalize incoming URLs"** (decode `%2e`, collapse dot-segments) so the edge
      cache-key path equals the app's routed path — closes `/assets/..%2f..%2ftrpc/...` path-confusion.
    - Rule order (terminating, top to bottom): **Bypass** `/api*` → **Bypass** when the `app_session`
      cookie is present → **Bypass** `/` and SPA doc routes → **Cache Everything** ONLY for static
      **file extensions** (`.js .css .woff2 .woff .ttf .png .jpg .svg .avif .map`), **never**
      `starts_with /assets/` → **Respect origin Cache-Control** globally.
    - **Never** use "Override/Ignore origin Edge TTL" on any rule whose match can overlap a dynamic
      path — the origin already emits `private, no-store` on gated endpoints and that must stay
      authoritative.
    - Confirm Cloudflare **forwards the `Cookie` header** to the origin on `/api` routes (else authed
      users lose their model data).
12. **Soak in `log`:** set `EDGE_MODE=log`, restart. Watch 15–30 min of real traffic:
    - No `edge_would_deny` on legitimate traffic (⇒ CF is injecting the secret correctly).
    - `edge_origin_ingress_anomaly` events should be ~zero (⇒ all traffic is arriving through CF).
    - `cf-connecting-ip` resolves to real client IPs (spot-check limiter behavior).
    - **If legit traffic warns, STOP and fix CF injection before enforcing.**
13. **Enforce:** set `EDGE_MODE=on`, restart. Run §4 verification.
14. **Alerting:** page on the CRITICAL "EDGE_MODE=on with no secret" line and on any spike of
    `edge_origin_ingress_anomaly`. Add an **external synthetic monitor through the Cloudflare
    hostname** (Railway's `/health` probes the origin directly and stays green during a CF outage —
    it will not catch an edge failure).

## 4. Verification (run after `EDGE_MODE=on`)

Automated: `SMOKE_EDGE=cloudflare SMOKE_ORIGIN_URL=<direct-railway-origin> node scripts/smoke-deploy.mjs https://aisportsbettingmodels.com`
asserts (a) direct-origin-without-secret → 403, (b) `/health` reachable on the origin, (c) a Dime
Chat POST full of betting jargon / SQLi tokens is **not** edge-blocked (reaches the origin).

Manual spot-checks:

- Direct `*.up.railway.app/api/trpc/games.list` (no secret) → **403**; `/health` direct → **200**.
- Through `aisportsbettingmodels.com` → 200; logged-in user still receives full model fields.
- Anonymous `curl` of `games.list` / `strikeoutProps.getByGame` → commodity only (Phase 3 intact),
  and the response carries `Cache-Control: private, no-store` when authed / `public, max-age=30` when
  anon, `Vary: Cookie` (cache-leak fix).
- `cf-cache-status` is `DYNAMIC`/`BYPASS` for `/api/*` and for an authed request; a path-confusion
  URL (`/assets/..%2f..%2ftrpc%2fgames.list`) never returns model fields to a subsequent anon fetch.
- Googlebot UA on `/` still gets the prerender (`X-Prerender: 1`); Stripe webhook → 200.

## 5. Rollback

- **Enforcement fault (403 spike after `on`):** set `EDGE_MODE=log`. Site is immediately healthy —
  keys stay correct (no PoP collapse), no 403s. Diagnose, then re-arm. *This is the fast path.*
- **Full pre-Cloudflare rollback:** grey-cloud the DNS (remove Cloudflare from the path) **and** set
  `EDGE_MODE=off`. Legacy XFF keying resumes. (A DNS change has propagation lag — the `log` harbor
  above is why you rarely need this.)
- Every env change requires a Railway restart/redeploy; there is no schema/migration coupling, so no
  #370-class deploy-order hazard exists here.

## 6. Documented fast-follows (not in this PR)

- **Stateful auto-downgrade:** ✅ DONE (`server/_core/edgeCircuitBreaker.ts`, hardened against a 4-lens
  adversarial review). If `on` with a secret but Cloudflare stops injecting it (DNS un-orange-clouded /
  secret typo / CF outage), the origin lock judges Cloudflare absent and **auto-downgrades enforcement
  to observe-only** (never 403) + a CRITICAL `edge_breaker_tripped` line, then **auto-recovers**
  (`edge_breaker_recovered`) when `≥ EDGE_BREAKER_RECOVER_FLOOR` (default 3) verified requests return.
  The trip fires **only after `EDGE_BREAKER_TRIP_WINDOWS` (default 3) CONSECUTIVE rolling windows**
  (`EDGE_BREAKER_WINDOW_MS`, default 60 s) each of which closed with `≥ EDGE_BREAKER_MIN_SAMPLE`
  (default 200) requests and `≤ EDGE_BREAKER_VERIFIED_FLOOR` (default 0) verified — i.e. ~3 minutes of
  *sustained, total* Cloudflare absence. This consecutive-window rule is what makes it un-gameable: a
  "verified" request requires the origin secret only *your* Cloudflare forwards, and a **single**
  verified request anywhere in a window marks that window non-starved and **resets the streak**, so an
  attacker flooding the raw origin cannot force a downgrade while real users are reaching the CF-fronted
  domain. A trip degrades only the origin-lock 403 layer — Phase 3 gating + the rate limiters still
  strip/throttle the payload. **Residual:** a *low-traffic* real outage (below `minSample`/window) or a
  genuinely zero-user dead period may not reach the trip threshold or may be trippable by origin noise
  — both are covered by the runbook's external synthetic monitor through the Cloudflare hostname (step
  14), not this passive origin-side breaker. Env knobs (all optional): `EDGE_BREAKER_WINDOW_MS`,
  `EDGE_BREAKER_MIN_SAMPLE`, `EDGE_BREAKER_VERIFIED_FLOOR`, `EDGE_BREAKER_TRIP_WINDOWS`,
  `EDGE_BREAKER_RECOVER_FLOOR`, `EDGE_BREAKER_DISABLED=1` (force unconditional enforcement). Still
  complemented by the mandatory `log` soak + the healthy `log` rollback + loud alerts.
- **CF CIDR snapshot refresh:** ✅ DONE. `CF_CIDR_SNAPSHOT_DATE` + a boot staleness alarm live in
  `server/_core/edgeProxy.ts` (warns when armed and the snapshot is >90d old — observability only,
  never blocks). `scripts/refresh-cf-cidrs.mjs` fetches/validates the published ranges (fail-closed on
  empty/malformed) and rewrites the arrays + date (`--check` for drift detection). The monthly
  read-only `.github/workflows/refresh-cf-cidrs.yml` goes RED on drift (the repo's Actions security
  contract forbids self-mutating/PR-opening workflows); a maintainer then runs the script and opens
  the refresh PR through the normal reviewed flow.
- **Turnstile:** app-embedded widget on `/login` and sensitive forms, verified server-side — never an
  edge HTML interstitial on the XHR path (accessibility).
