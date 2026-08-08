# Runbook — Rotating `EDGE_ORIGIN_SECRET` without a 403 window

> **Owner-executed.** Every step is a Railway variable change or a Cloudflare dashboard change.
> No PR merge performs a rotation. Nothing here needs `db-push.yml` — there is no schema coupling.
>
> **Scope.** This is the rotation procedure for the origin-lock shared secret
> (`EDGE_ORIGIN_SECRET` / `EDGE_ORIGIN_SECRET_PREV`, injected by Cloudflare as the
> `x-dime-edge-secret` request header). It is **not** the procedure for `EDGE_AGENT_BYPASS_KEY` —
> that is a *client/tooling* secret that never lives on Railway; see
> `docs/runbooks/anti-scraping-config.md` §12.
>
> Companion documents: `docs/runbooks/edge-defense-cloudflare.md` (design + arming),
> `docs/runbooks/anti-scraping-config.md` (as-built Cloudflare record).

---

## 0. Why this document exists

`originSecretOk()` in `server/_core/edgeProxy.ts` has always accepted **two** secrets — the current
one and `EDGE_ORIGIN_SECRET_PREV` — precisely so a rotation can have an overlap window. But `_PREV`
was **never configured in Railway**, which made every rotation a hard cutover: the instant you change
`EDGE_ORIGIN_SECRET`, the value Cloudflare is still injecting matches nothing, and under
`EDGE_MODE=on` **every request through Cloudflare 403s** until the Transform Rule catches up.

The whole procedure below exists to convert that guaranteed outage into a sequence in which **exactly
one secret branch is load-bearing at a time, and each one is proven live before the next step
removes its predecessor.**

### The two facts that shape everything

**1. The lock is a logical AND, not a secret check.**

```ts
// server/_core/edgeProxy.ts
export function edgeProofPasses(req) {
  const h = req.headers?.["x-dime-edge-secret"];
  if (!originSecretOk(Array.isArray(h) ? h[0] : h)) return false;
  return isCloudflareEdgeIp(immediateUpstreamIp(req));   // ← second factor
}
```

A request carrying a **correct** secret from a **non-Cloudflare** upstream still fails the proof.
Consequence for verification: **you cannot test a secret by hand-injecting the header at the raw
origin** — that path 403s no matter which value you send. And you cannot smuggle an alternate value
*through* Cloudflare either, because the Transform Rule is a **Set static** that overwrites whatever
the client sent (`anti-scraping-config.md` §4.3). There is exactly one way to exercise a secret:
**real traffic through Cloudflare.** Every verification below is therefore behavioural.

**2. Railway variable values cannot be read back.**

Agents (and this runbook's tooling) can see that a variable *exists*, never what it *holds* — the
Railway MCP secret/mutation tools are hard-denied in `.claude/settings.json`, and the standing secret
law forbids printing, persisting, or moving these values between scopes. **There is no
"read `EDGE_ORIGIN_SECRET` back and compare it to the Cloudflare rule" step available.** A typo in
either place is discoverable *only* by its effect on traffic. Design the sequence so that effect is
never a user-visible 403 — that is what the `log`-mode canary in Step 2 buys you.

---

## 1. FORBIDDEN: `EDGE_MODE=off` is not a rollback

> ### ⛔ Never set `EDGE_MODE=off` to recover from a rotation problem
>
> `log` is the only safe degradation.

If a rotation goes wrong, the reflex is "turn the edge off". Do not. `off` is not a milder `on`; it is
a *different* posture that removes the protection **and** the instrumentation you need to fix the
problem, while leaving the actual fault in place.

| | `EDGE_MODE=on` | `EDGE_MODE=log` ✅ | `EDGE_MODE=off` ⛔ |
| --- | --- | --- | --- |
| Bad secret 403s users | yes | **no** | no |
| `edge_would_deny` events (the secret-mismatch detector under `log`) | breaker-open only | **yes** | **none — total blindness** |
| `edge_deny` events (⇒ `EDGE_ORIGIN_INGRESS_ANOMALY` from the lock) | yes | no — unreachable in `log` | none |
| `edge_origin_ingress_anomaly` canary (`index.ts` `/api/trpc`) | yes | **yes** — but it never inspects the secret (§2a) | **none — gated on `edgeMode() !== "off"`** |
| `ipSrc=` on `[HTTP_REQUEST]` (the positive detector) | yes | yes | yes — `identitySource()` is ungated by `EDGE_MODE`, so this one survives `off`. It is the *only* one that does. |
| Raw `*.up.railway.app` origin protected | yes | no | no |
| Fixes the secret mismatch | — | — | **no — it only hides it** |

Three specific reasons, each read off the code:

1. **`off` short-circuits the middleware before any event is emitted.** `originLock()`'s handler
   opens with `if (mode === "off") return next();` — no `edge_deny`, no `edge_would_deny`, nothing.
   The `/api/trpc` anomaly canary in `server/_core/index.ts` is likewise wrapped in
   `if (edgeMode() !== "off")`. So `off` deletes the negative detector this runbook's STOP conditions
   are built on — you would be flying blind through exactly the step that needs measurement. (The
   `ipSrc=` positive detector does survive `off`, because `resolveClientIdentity()`/`identitySource()`
   are deliberately ungated — see the historical note below. One surviving signal is not a reason to
   discard the other.) *(PROVEN — `server/_core/originLock.ts`, `server/_core/index.ts`.)*

2. **`off` reopens the origin.** Enforcement stops, so the raw `*.up.railway.app` host serves the app
   to anyone who knows the URL. The rotation problem lasts minutes; leaving the origin unlocked for
   those minutes trades a fixable 403 for an open bypass of the entire anti-scraping edge.

3. **It does not stop the limiter collapse, because the collapse is caused by the mismatch, not by
   the mode.** With a secret Cloudflare injects that matches *neither* variable, `edgeProofPasses()`
   is false in **every** mode, so `resolveClientIdentity()` never trusts `cf-connecting-ip` and falls
   back to the leftmost `X-Forwarded-For` — which, behind Cloudflare, is the **PoP egress IP**. All
   **six** rate limiters (`globalApiLimiter`, `authLimiter`, `trpcAuthLimiter`,
   `stripeCheckoutLimiter`, `waitlistSubmitLimiter`, `feedProcedureLimiter`) then key on that PoP, so
   every visitor behind a PoP shares one bucket. `off` does not undo this; it only removes your
   ability to see it. *(PROVEN — `server/_core/clientIdentity.ts` resolution order;
   `server/_core/index.ts` limiter `keyGenerator`s.)*

   > **Historical note, and why the law survives the fix.** `resolveClientIp` used to consult
   > `cf-connecting-ip` only when `edgeMode() !== "off"`, so `off` *by itself* collapsed all six
   > limiters onto per-PoP buckets. Commit `930ef2be0` made `resolveClientIdentity()` deliberately
   > **ungated** by `EDGE_MODE`, removing that specific tooth. The prohibition stands anyway:
   > reasons 1 and 2 are untouched, and reason 3 still bites during precisely the failure this
   > runbook is about. Re-gating identity on `edgeMode()` would restore the footgun — don't.

**The only full rollback that is ever correct** is the pre-Cloudflare one: grey-cloud the DNS records
**and then** set `EDGE_MODE=off`, in that order. That is an "we are removing Cloudflare from the
architecture" action, not a rotation recovery.

---

## 2. Before you start

| Precondition | How to confirm |
| --- | --- |
| You hold the **current** secret value | It is in the owner's password manager. If it is not, you cannot do a zero-downtime rotation — see §6 "Lost the current value". |
| You can edit Railway → `stunning-creativity` → **production** | `pnpm agent:doctor` for identity preflight; variable edits are owner-executed. |
| You can edit the Cloudflare **Transform Rule** | Rules → Transform Rules → Modify Request Header → the `x-dime-edge-secret` *Set static* rule (`anti-scraping-config.md` §4.3). |
| You know the current `EDGE_MODE` | Behavioural: a secret-less request to the raw origin returns **403** under `on`, **200** under `log`/`off`. |
| `EDGE_AGENT_BYPASS_KEY` is exported in your shell | Required for any probe through the Cloudflare hostname — the WAF/SBFM 403s automated clients by design. `anti-scraping-config.md` §12. |
| You have Railway logs open | This is your primary instrument for the whole procedure. |

**Generate the new value:** `openssl rand -hex 32`. Store it in the password manager **before** you
paste it anywhere. Never echo it into a terminal you will later paste as evidence, never into a PR,
never into Notion.

**Budget:** ~30–45 minutes wall clock, most of it soak time. Every Railway variable change requires a
redeploy/restart to take effect. Do not batch changes across steps — the whole design depends on the
steps landing separately.

---

## 3. The rotation — ordered

Notation: `S_old` = the secret in use now. `S_new` = the value you just generated.

```text
             EDGE_ORIGIN_SECRET   _PREV     CF injects   load-bearing branch
  start          S_old            (unset)     S_old      SECRET
  step 1         S_old            S_old       S_old      SECRET (belt: _PREV also matches)
  step 2         S_new            S_old       S_old      _PREV        ← overlap window
  step 3         S_new            S_old       S_new      SECRET       ← overlap window
  step 4         S_new            (unset)     S_new      SECRET
```

Each step moves exactly one thing, and steps 2 and 3 each isolate a different branch of
`originSecretOk()` — which is what makes the rotation verifiable instead of hopeful.

---

### Step 1 — Set `EDGE_ORIGIN_SECRET_PREV` = the **current** value

Railway → `stunning-creativity` → production → add `EDGE_ORIGIN_SECRET_PREV` = `S_old` (identical to
`EDGE_ORIGIN_SECRET`). Redeploy.

**Verify.** This step must be a **no-op** for traffic — both variables hold the same value, so the
`SECRET` branch still matches and `_PREV` is redundant.

- Railway logs: `edge_deny` / `EDGE_ORIGIN_INGRESS_ANOMALY` count stays at its pre-change baseline.
  Write that number down as the **`on`-mode baseline** — and label it that way, because it is only
  comparable against steps executed under `on` (Steps 3 and 4). It is **not** the comparison basis
  for Step 2's verification: Step 2 runs under `log`, where `edge_deny` cannot occur at all and this
  counter goes structurally flat. Step 2a takes its own, separate `log`-mode baseline. Conflating
  the two is how a broken rotation reads as a pass — see §2c.
- Railway logs: also record the **positive** baseline — over ~5 minutes of sampled
  `[HTTP_REQUEST] →` lines, the share carrying `ipSrc=cf-connecting-ip` versus `ipSrc=xff-leftmost`.
  On a healthy edge essentially all apex traffic is `cf-connecting-ip`. This one is mode-independent
  (`identitySource()` is not gated on `EDGE_MODE`), so it is the only number that stays comparable
  across every step of the rotation.
- Load `https://aisportsbettingmodels.com/feed` in a real browser, logged in. Full model fields render.
- Optional automated pass (see the command block below).

```bash
export EDGE_AGENT_BYPASS_KEY='<the tooling key>'
SMOKE_EDGE=cloudflare SMOKE_ORIGIN_URL=https://<the-railway-origin>.up.railway.app \
  node scripts/smoke-deploy.mjs https://aisportsbettingmodels.com
```

Cite the checks **by name** — `origin lock: direct origin without secret → 403`,
`origin lock: /health reachable on the direct origin (Railway probe)` — never by count or ordinal.

**⚠ What this step does NOT prove.** Because both variables hold the same value, a **typo in `_PREV`
is invisible here** — the `SECRET` branch is still carrying every request. `_PREV` is not exercised
until Step 2. That is the entire reason Step 2 has a canary.

**Rollback.** Delete `EDGE_ORIGIN_SECRET_PREV`, redeploy. Returns exactly to the starting state.
Risk: none.

---

### Step 2 — Set `EDGE_ORIGIN_SECRET` = `S_new` (**the overlap window opens**)

This is the dangerous step, and the only one that needs a canary. The moment it lands, Cloudflare is
still injecting `S_old`, so **`_PREV` — and only `_PREV` — is holding up every request on the site.**
If `_PREV` was mistyped in Step 1, this step is a site-wide 403 event.

#### 2a. Drop to `log` first (recommended default), then prove the instrument is live

Set `EDGE_MODE=log`, redeploy, and confirm the mode took: a secret-less request to the raw origin now
returns 200 instead of 403. In `log` the lock never 403s, so a `_PREV` typo shows up as **log lines
instead of an outage**.

> ##### ⚠ `log` mode silences half the instrument panel — know which half
>
> Dropping to `log` is the right call — and it also **removes the counter most of this document used
> to be written around.** `EDGE_ORIGIN_INGRESS_ANOMALY` has exactly two fire sites in
> `server/_core/index.ts`, and **neither one can detect a secret mismatch under `log`:**
>
> | Signal | fires under `on` | fires under `log` | what it actually proves |
> | --- | --- | --- | --- |
> | `[RateLimit][EDGE_ORIGIN_INGRESS_ANOMALY]` from the origin lock (`index.ts` `case "edge_deny"`) | yes | **never** — `edge_deny` is unreachable in `log` | a request was 403'd |
> | `[RateLimit][EDGE_ORIGIN_INGRESS_ANOMALY]` from the `/api/trpc` canary (`index.ts`, `edgeMode() !== "off"`) | yes | yes | ingress lacked `cf-connecting-ip` **or** a CF-range upstream. It **never inspects the secret**, so real Cloudflare traffic carrying a *wrong* secret satisfies it and it stays flat. |
> | `[edge][origin-lock] would-deny (observe-only, request served)` | breaker-open only | **on every unverified request** | the edge proof **FAILED** on a request that was served — the negative detector |
> | `ipSrc=` on the sampled `[HTTP_REQUEST] →` line | yes | yes | `cf-connecting-ip` ⇒ the edge proof **PASSED** ⇒ the secret Cloudflare injected **was accepted**. The positive detector, and mode-independent. |
> | breaker / partial-bypass events | `on` + secret only | never | — |
>
> `index.ts`'s `case "edge_would_deny"` is a bare `console.warn` with **no** `fireRateLimitEvent`,
> deliberately: alerting a "blocked / 429" outcome for a request that was served (200) is a false
> alarm. The consequence for this runbook is that under `log` the anomaly counter is **blind to a
> `_PREV` typo**, and a verification keyed on it returns PASS on a rotation that is broken.
> *(PROVEN — 500 simulated real-Cloudflare requests through the actual middleware under
> `EDGE_MODE=log`: with `_PREV` mistyped by one character, `EDGE_ORIGIN_INGRESS_ANOMALY` = 0 from
> both fire sites, identical to the healthy run, while `would-deny` = 500 and
> `ipSrc=cf-connecting-ip` fell 500 → 0.)*

**Positive control — do this before you touch Step 2b.** The secret-less raw-origin request you just
made to confirm the mode is *also* your proof that the detector fires. Within seconds it must produce
a line — one per request — carrying **your own** public IP and path:

```text
[edge][origin-lock] would-deny (observe-only, request served) ip=<your public IP> path=<your path>
```

If you got the 200 but **cannot find that line**, stop: your log view, filter, or time range is
wrong, and you have no instrument at all. Fix that first. Everything in 2c depends on being able to
see this line when it exists.

**Take the `log`-mode baselines now** (these, not Step 1's `on`-mode number, are what 2c compares
against). Over ~5 minutes:

- `[edge][origin-lock] would-deny` lines per minute. Expect a low, non-zero floor: with the origin
  now unlocked, scanners and any client pinned to the raw `*.up.railway.app` host land here.
- Sampled `[HTTP_REQUEST] →` lines per minute (your traffic denominator — the request logger samples
  **10%**, so multiply by ~10).
- Of those, the count with `ipSrc=cf-connecting-ip` versus `ipSrc=xff-leftmost`.

#### 2b. Set `EDGE_ORIGIN_SECRET` = `S_new`, redeploy

#### 2c. Verify `_PREV` is actually accepted — the load-bearing check

Watch Railway logs for **10–15 minutes of real traffic**. The verdict has three parts and **all three
must hold**; the first one is what makes this a verification rather than a wish.

- ✅ **PASS — 1/3, POSITIVE.** `ipSrc=cf-connecting-ip` still dominates the sampled
  `[HTTP_REQUEST] →` lines for apex traffic, at the same share as the 2a baseline. This is the only
  signal that **affirms** the value Cloudflare is injecting was accepted: `identitySource()` returns
  `cf-connecting-ip` only when `edgeProofPasses()` is true, which requires `originSecretOk()` to have
  matched `_PREV`. A count you can watch **go up** cannot be faked by an absence of measurement.
- ✅ **PASS — 2/3, NEGATIVE.** `[edge][origin-lock] would-deny` stays at the **2a `log`-mode
  baseline** — the low scanner floor, not zero, and specifically not the Step 1 `on`-mode number.
- ✅ **PASS — 3/3, INSTRUMENT STILL LIVE.** Repeat the 2a raw-origin probe at the **end** of the
  window. It must still produce a fresh `would-deny` line, and `[HTTP_REQUEST]` lines must still be
  arriving at roughly the 2a rate. This is what separates "both secrets work" from "nothing was
  measuring".
- ❌ **FAIL.** `would-deny` jumps to roughly *every* request through Cloudflare **and/or**
  `ipSrc` flips to `xff-leftmost` for apex traffic. `_PREV` does not match what Cloudflare is
  injecting — a typo, a whitespace/newline paste artifact, or a stale value. Under `log` nobody is
  being 403'd yet, but the moment you return to `on` the whole site is.
  **Stop. Do not proceed to Step 3.** Go to the Step 2 rollback.
  *(`ipSrc` is the strictly broader detector of the two: the request logger runs at
  `server/_core/index.ts` **before** the `www`→apex 308 and before the origin lock, so a `www`-host
  request with a bad secret flips `ipSrc` while producing **no** `would-deny` at all — it never
  reaches the lock. `/health` lines are exempt from the lock for the same reason and always read
  `xff-leftmost`; exclude them. A CF-CIDR-snapshot fault, by contrast, raises **both** signals, so it
  cannot be told apart here — use `node scripts/refresh-cf-cidrs.mjs --check`.)*
- ⛔ **INDETERMINATE — not a pass.** Zero `would-deny` **and** little or no `[HTTP_REQUEST]`
  volume, or an end-of-window probe that produced no `would-deny` line. Every counter reading zero
  is exactly what a broken rotation and an unmeasured window look like from the outside; only the
  positive count in 1/3 tells them apart. Extend the window, or restart the rotation in a busier one.

Do not accept a quiet window as a pass. Confirm real traffic is actually flowing (compare
`[HTTP_REQUEST]` volume to the same window yesterday); zero anomalies with zero traffic proves
nothing. This is the same trap that broke the arming gate on 2026-08-06: `edge-defense-cloudflare.md`
§3 step 12 asks for "15–30 min of real traffic", and arming proceeded on a sample of 18 requests
through Cloudflare — after which a 7-hour blind period passed before the first real-user 403
surfaced. The failure this section now guards is the *same defect class one layer up*: a STOP
condition defined on a counter that could not increment in the mode the check runs in.

#### 2d. Return to `on`

Set `EDGE_MODE=on`, redeploy. Confirm enforcement resumed: a secret-less request to the raw origin
403s again, while the CF-fronted site serves normally. That 403 also re-arms the `edge_deny` →
`EDGE_ORIGIN_INGRESS_ANOMALY` path, so it doubles as the positive control for the counter that Steps
3 and 4 use — you should see exactly one `[RateLimit][EDGE_ORIGIN_INGRESS_ANOMALY]` line for your own
probe. If your probe 403s but no anomaly line appears, the counter is not being read correctly and
Steps 3–4's STOP conditions are blind. Fix that before continuing.

Watch for **5 minutes** after the flip: `ipSrc=cf-connecting-ip` must still dominate and the anomaly
count must return to the Step 1 `on`-mode baseline. This is the first moment a `_PREV` problem would
403 real users, so it is the cheapest place to catch anything 2c's sample was too small to see.

**Rollback for Step 2.** Set `EDGE_ORIGIN_SECRET` back to `S_old`, redeploy. Cloudflare is still
injecting `S_old`, so this is an immediate, complete recovery — nothing on the Cloudflare side has
changed yet, which is exactly why the CF flip is Step 3 and not Step 2.

**If you skip the 2a/2d canary** (a hurried rotation under `on`), the only backstop is the circuit
breaker in `server/_core/edgeCircuitBreaker.ts`, and you should know its limits before you rely on
it: it downgrades enforcement to observe-only only after `EDGE_BREAKER_TRIP_WINDOWS` (default **3**)
consecutive windows of `EDGE_BREAKER_WINDOW_MS` (default **60 s**) that each closed with at least
`EDGE_BREAKER_MIN_SAMPLE` (default **200**) requests and zero verified. **Below ~200 requests/minute
it never fires at all**, and the 403s continue until a human acts. Treat it as a safety net with a
hole in it, not as a substitute for the canary.

---

### Step 3 — Point the Cloudflare Transform Rule at `S_new`

Cloudflare → Rules → **Transform Rules** → Modify Request Header → the `x-dime-edge-secret`
*Set static* rule → replace the value with `S_new` → Deploy. (Bind from Cloudflare Secrets Store if
available, so the value is not visible in the dashboard.)

Cloudflare rule changes propagate in seconds — there is no DNS-style propagation wait — but there is
a **brief window where different PoPs may be on either side of the change**. Both values are accepted
right now, so that window is harmless. This is the entire point of the overlap.

**Verify — this step proves the `SECRET` branch on `S_new`:**

- POSITIVE (primary): `ipSrc=cf-connecting-ip` keeps dominating the sampled `[HTTP_REQUEST] →`
  lines. A flip to `ipSrc=xff-leftmost` means the value you pasted into the Transform Rule is not
  being accepted — **roll back**. Unlike the anomaly count, this number rises with healthy traffic,
  so a silent window cannot be mistaken for a healthy one.
- Anomaly count stays at the Step 1 **`on`-mode** baseline. (Valid here, unlike in Step 2c: this
  step runs under `on`, so `edge_deny` is reachable again.) A brief blip during propagation is
  expected; a sustained rise is not.
- Reload the site in a real browser: served normally, full model fields when logged in.
- Re-run the `SMOKE_EDGE=cloudflare` smoke above. Both named origin-lock checks still pass.
- Soak **15 minutes minimum** before Step 4. Do not compress this — Step 4 is what removes your
  ability to fall back.

**Rollback.** Set the Transform Rule value back to `S_old` and Deploy. `_PREV` still holds `S_old`, so
this is instant and total. **This is the last step with a free rollback.**

---

### Step 4 — Clear `EDGE_ORIGIN_SECRET_PREV` (**the overlap window closes**)

Only after Step 3 has soaked cleanly. Railway → delete `EDGE_ORIGIN_SECRET_PREV`. Redeploy.

**Verify.** Nothing should change — if anything did, some traffic was still riding `S_old`, which
means Step 3 did not fully propagate.

- POSITIVE (primary): `ipSrc=cf-connecting-ip` share unchanged from the Step 1 baseline.
- Anomaly count stays at the Step 1 `on`-mode baseline.
- Real browser load, logged in: full model fields.
- `SMOKE_EDGE=cloudflare` smoke: both named origin-lock checks pass.
- Watch one more 15-minute window. A slow-moving cache or an unusual PoP is the last thing that can
  surface here.

**Rollback.** Re-add `EDGE_ORIGIN_SECRET_PREV` = `S_old` and redeploy. This works **only while you
still hold `S_old`** — which you do, because it is in the password manager. Do not destroy `S_old`
until Step 4 has soaked.

**Close-out.** Delete `S_old` from the password manager. Record the rotation as a Notion Decision
record with the date, the reason, and links to the evidence — **never the values**.

---

## 4. Verification cheat sheet

Everything is behavioural. There is no inspection path.

| Question | How to answer it |
| --- | --- |
| Is the lock enforcing? | Secret-less request to the raw `*.up.railway.app` origin → **403** = `on`; **200** = `log` or `off`. |
| Is Cloudflare's injected secret being **accepted**? (positive) | `ipSrc=` on the sampled `[HTTP_REQUEST] →` lines. `ipSrc=cf-connecting-ip` ⇒ `edgeProofPasses()` was true ⇒ the secret matched. Works in **every** mode. This is the only *affirmative* read, and the only one whose absence is distinguishable from "no traffic". |
| Is Cloudflare's injected secret being **rejected**? (negative) | Under `log`: `[edge][origin-lock] would-deny` lines. Under `on`: those **plus** `edge_deny` → `[RateLimit][EDGE_ORIGIN_INGRESS_ANOMALY]`. Compare to a baseline **taken in the same mode** — see the blind spot below. |
| Which mode's baseline do I compare against? | Whichever mode the step runs in. `EDGE_ORIGIN_INGRESS_ANOMALY` is **structurally flat under `log`** for a secret mismatch, so a `log`-mode step compared against an `on`-mode baseline always reads PASS. Step 1 records the `on`-mode baseline (Steps 3–4); Step 2a records a separate `log`-mode baseline (Step 2c). |
| Are real users affected? | Real browser (not headless), logged in, through `aisportsbettingmodels.com`. |
| Did the deploy come up? | **Not a signal.** `/health` is exempt from the lock, so Railway's healthcheck stays green through a completely botched rotation. |
| Did an agent's `curl` / headless run 403? | **Not a signal either.** Automated clients are 403'd by the WAF/SBFM by design. Set `EDGE_AGENT_BYPASS_KEY` (sent as `x-dime-agent`) or the result is meaningless. This has already produced one false P0. |
| Is any secret configured at all? | Boot log: the `[edge][origin-lock][boot] CRITICAL` line fires at startup when `EDGE_MODE != off` and **neither** variable is set. Its **absence** means "at least one is set" — it says nothing about whether the value is *correct*. |

**⚠ Blind spot 1 — the anomaly counter cannot see a secret mismatch under `log`.** Its two fire
sites are `edge_deny` (unreachable in `log`) and the `/api/trpc` ingress canary (which tests for
`cf-connecting-ip` and a CF-range upstream, never the secret value). So under `log` it stays flat no
matter how wrong the secret is. **Never write a STOP condition on this counter for a step that runs
under `log`** — that is the fail-open §2a exists to close. Full table in §2a.

**⚠ Blind spot 2 — `www` traffic never reaches any of these counters.** The anomaly counter is a
**lower bound**, not a measurement: requests on the `www` hostname are 308-redirected to the apex
*before* the origin lock runs, so they never reach the counter, the circuit breaker's sample, or the
partial-bypass detector. See `edge-defense-cloudflare.md` §7. For rotation purposes this is
tolerable — a `www` request only ever receives a redirect, and the client's follow-up apex request
**is** counted — but it means a low anomaly count is never sufficient on its own. Always corroborate
with a real browser load, and never read "zero anomalies" as "zero problems".

**⚠ Blind spot 3 — `ipSrc=xff-leftmost` does not name which factor failed.** `edgeProofPasses()` is
an AND of the secret and the CF-range check, so a flip to `xff-leftmost` proves *the proof* failed,
not *which half*. Disambiguate with `node scripts/refresh-cf-cidrs.mjs --check` and the `would-deny`
count (a CIDR-snapshot fault and a secret fault both raise it; only the CIDR check separates them).

**Log lines you will be reading:**

```text
[HTTP_REQUEST] → GET /… | ts=… ip=… ipSrc=cf-connecting-ip  ← POSITIVE: the secret was ACCEPTED
[HTTP_REQUEST] → GET /… | ts=… ip=… ipSrc=xff-leftmost      ← the edge proof FAILED (see blind spot 3)
[edge][origin-lock] would-deny (observe-only, request served) ip=… path=…
                                                        ← NEGATIVE, and the ONLY origin-lock
                                                          secret detector that fires under `log`
[RateLimit][EDGE_ORIGIN_INGRESS_ANOMALY] ...            ← `on`-mode denials + the ingress canary;
                                                          blind to the secret under `log`
[edge][origin-lock] CRITICAL EDGE_MODE=on but no EDGE_ORIGIN_SECRET configured — …
[edge][origin-lock][boot] CRITICAL EDGE_MODE=… but neither EDGE_ORIGIN_SECRET nor …
[edge][origin-lock] CRITICAL circuit breaker TRIPPED — …
```

Only **10%** of normal requests are sampled into `[HTTP_REQUEST]` (`server/_core/index.ts` —
errors and >1000ms requests are always logged). Multiply by ~10 for a traffic estimate, and never
treat a handful of sampled lines as a soak.

The `[boot]` line and the un-tagged per-request `CRITICAL` are **different signals for the same
fault**: one fires once at startup, the other at most once per minute while requests keep arriving.
Seeing only `[boot]` means the process started misconfigured and no request has hit the lock yet.

---

## 5. Failure modes

| Symptom | Most likely cause | Action |
| --- | --- | --- |
| `would-deny` spikes and `ipSrc` flips to `xff-leftmost` right after **Step 2** (under `log`) | `_PREV` ≠ what Cloudflare injects (typo / whitespace / wrong value) | Step 2 rollback: `EDGE_ORIGIN_SECRET` = `S_old`. Then re-do Step 1 carefully. |
| Step 2c is **all zeros**: no `would-deny`, no `[HTTP_REQUEST]`, no `ipSrc=cf-connecting-ip` | Nothing is measuring — no traffic, wrong log filter, or wrong time range. **This is not a pass.** | Re-run the 2a raw-origin positive control. If it produces no `would-deny` line, your instrument is broken, not your rotation. |
| **Anomalies stayed flat** through Step 2 and you called it a pass | Expected — and meaningless. `EDGE_ORIGIN_INGRESS_ANOMALY` is structurally blind to a secret mismatch under `log` (§2a). | Redo 2c on `would-deny` + `ipSrc`. Do **not** proceed to Step 3 on a flat anomaly count alone. |
| Anomalies spike (or `ipSrc` flips) right after **Step 3** | Transform Rule value ≠ `S_new` | Step 3 rollback: Transform Rule back to `S_old`. `_PREV` still covers you. |
| Anomalies spike (or `ipSrc` flips) right after **Step 4** | Some traffic still riding `S_old` — Step 3 had not fully landed | Re-add `_PREV` = `S_old`, redeploy, soak longer, retry Step 4. |
| 403s but anomalies are *flat*, under `on` | Not the secret. Look at the CF CIDR snapshot (`CF_CIDR_SNAPSHOT_DATE`, fail-closed second factor), the WAF, or SBFM. | `node scripts/refresh-cf-cidrs.mjs --check`. |
| `ipSrc=xff-leftmost` but `would-deny` is flat | You are reading lines that never reached the lock: `www`-host requests (308'd first) or `/health` (lock-exempt). Both are logged with `ipSrc` anyway, because the request logger is mounted before both. Still a real signal if it is apex app traffic — `ipSrc` sees the `www` path that `would-deny` structurally cannot. | Re-read filtering to `host=aisportsbettingmodels.com` and excluding `/health`. If it persists there, treat it as a FAIL and roll back. |
| `[edge][origin-lock][boot] CRITICAL` at startup | A variable was deleted rather than replaced, or the redeploy picked up an empty value | Set `EDGE_ORIGIN_SECRET`, redeploy. The site is **unprotected**, not down, until you do. |
| Circuit breaker `TRIPPED` | Cloudflare is not injecting an accepted secret at all, sustained | Enforcement already self-downgraded. Fix the secret; it auto-recovers. Do **not** set `EDGE_MODE=off`. |
| Rate limits behaving oddly (whole regions throttled together) | Limiters collapsed onto per-PoP buckets — the proof is failing | Same fix: make the secret match. `off` will not help; see §1 reason 3. |

---

## 6. Special cases

**Suspected compromise — rotate immediately.** A leaked `EDGE_ORIGIN_SECRET` is
[**catastrophic**](edge-defense-cloudflare.md#2-the-origin-lock--the-load-bearing-decision-origin-bypass-fix):
it grants full origin bypass. The compressed emergency ordering is **Step 3 first** (point Cloudflare
at `S_new`), **then** set `EDGE_ORIGIN_SECRET` = `S_new` — accepting a few seconds of 403s — and
**never** put the compromised value in `_PREV`. Do not run the normal overlap procedure: it keeps the
leaked value valid for the length of the window, which is the opposite of what you need.

**Lost the current value.** Zero-downtime rotation is impossible — you cannot populate `_PREV` with a
value you do not have. Use the emergency ordering above (Cloudflare first, then Railway), or run the
whole rotation under `EDGE_MODE=log` and return to `on` only after the §2c three-part verdict
confirms the new value is landing — `ipSrc=cf-connecting-ip` holding up as the positive signal and
`would-deny` at the `log`-mode baseline. **Not** the anomaly count: it is blind under `log` (§2a).

**Rotating while the breaker is tripped.** Don't. Fix the underlying cause and let the breaker
recover (`edge_breaker_recovered`) before starting a rotation, or you will not be able to tell your
rotation's signal apart from the pre-existing fault.

---

## 7. What this procedure does not cover

Stated explicitly so nobody reads more assurance into it than it carries.

- **A *wrong* secret is invisible until traffic hits it.** The boot assertion detects "no secret
  configured", never "the configured secret does not match Cloudflare's". The only detectors for a
  mismatch are behavioural, under real traffic, and **which one is live depends on the mode**: under
  `log` it is `[edge][origin-lock] would-deny` (negative) plus `ipSrc=cf-connecting-ip` (positive);
  under `on` those plus `EDGE_ORIGIN_INGRESS_ANOMALY`. That is why Step 2's canary is the
  load-bearing control in this entire document — and why §2a spends a paragraph proving the canary
  can actually fire before Step 2b relies on it. A check that cannot go red is not a check.
- **Low traffic weakens every check here.** Baselines, soaks, and the circuit breaker all assume a
  meaningful request volume. At low volume, rotate during a known-busy window or extend the soaks.
- **Cloudflare-side state is not reviewable in-repo.** The Transform Rule, WAF rules, and SBFM
  settings live in a console no repo code can read. Their correctness is asserted only by these
  behavioural checks and by the as-built record in `anti-scraping-config.md`.
