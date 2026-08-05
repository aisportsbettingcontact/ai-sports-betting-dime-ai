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
