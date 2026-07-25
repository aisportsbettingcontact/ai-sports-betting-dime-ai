# Deferred Design Defects (PR #198) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close or evidence-reject the actionable deferred defects from the 2026-07-24 audit ledger
(`2026-07-24-sitewide-design-repair-report.md`) on top of `main` @ `e660ac7c`, using the
newly-available runtime (Railway service env + ephemeral MySQL + real auth) to inspect the 26
surfaces the audit could never reach.

**Architecture:** Phase 1 stands up a full local stack (ephemeral DB, seeded fixtures, authed
admin session) — the capability unlock every later phase leans on. Phase 2 adjudicates the six
"suspected" defects with runtime evidence (fix-or-reject, never assume). Phase 3 executes the
owner-directed WcFeedInline dead-code carve-out with test realignment. Phase 4 lands the approved
fixes (D-MOTION-LAW, X-PY-CARDGEN chrome, X-PRERENDER-V1, X-ZINDEX, D-BG-SEAM, bounded px).
Phase 5 re-computes the ledger's gate arithmetic honestly. Phase 6 is /sp-verify + PR.

**Tech Stack:** React 19 + wouter + Tailwind 4 (`@theme` in `client/src/index.css`) + Express +
Drizzle/MySQL. Verification: `tsc --noEmit`, gated vitest, Docker `mysql:8`, `railway run` env
injection (DATABASE_URL always overridden to the local container), agent-browser (Chromium)
runtime probes.

## Global Constraints

- THREE-COLOR-LAW (v2+v3) beats MASTER.md; MASTER.md beats any skill suggestion. Mint `#45E0A8`
  is the only accent (`#0FA36B` for mint text on light). Negative states are grey, never red
  (scoped `--loss-red` / `--dime-danger` carve-outs stay as documented).
- Banned everywhere: neon green `#39FF14`, purples (`#B060FF`, `#9050E0`, `#7030C0`), gold,
  gradients. **Protected:** MLB team crest colors (`server/StrikeoutModel.py:161-191`, 60 hex)
  per THREE-COLOR-LAW crest exception; Discord blurple exception (two controls); emoji flags
  (owner directive 2026-07-18).
- One motion curve: `160ms cubic-bezier(0.16,1,0.3,1)`; `prefers-reduced-motion` collapses all.
- Single font: Familjen Grotesk. Micro-label floor 11px; touch targets ≥44px; contrast ≥4.5:1
  small / ≥3:1 large. Dark canvas is Law v2 `#000000`.
- No new `!important` (X-IMPORTANT is deliberately out — its 151 declarations get their own PR).
- Production DB is untouchable: every runtime step overrides `DATABASE_URL` to the local
  container and proves the override before use (probe prints `new URL(url).host`, must be
  `127.0.0.1:3306`). `DISABLE_BACKGROUND_JOBS=1` on every local server run.
- Evidence contract: every claim labeled VERIFIED / PARTIAL / BLOCKED / REJECTED_WITH_EVIDENCE
  with numerators and denominators; no "all/fully/100%" without a stated denominator.

---

### Task 1: Runtime harness — ephemeral DB, seeded fixtures, authed session

**Files:**
- No repo files created or modified (harness is session-local by design; commands recorded here)

**Interfaces:**
- Produces: running local app at `http://localhost:<PORT>` with (a) a normal user and an admin
  user whose credentials are `dev-probe@example.test` / `Probe-198-pass!` and
  `dev-admin@example.test` / `Probe-198-admin!`, (b) ≥2 seeded `games` rows dated today,
  (c) an authed agent-browser session. Every later phase assumes this.

- [ ] **Step 1.1: Container + schema (proven pattern from the #197 verification session)**

```bash
docker run -d --name dime-test-mysql -e MYSQL_ALLOW_EMPTY_PASSWORD=1 \
  -e MYSQL_DATABASE=dime_test -p 3306:3306 mysql:8
mysqladmin ping -h 127.0.0.1 -P 3306 -u root --wait=60 --silent   # retry once if init-restart drops it
cd .claude/worktrees/pr198 && pnpm install --frozen-lockfile
DATABASE_URL=mysql://root@127.0.0.1:3306/dime_test pnpm exec drizzle-kit push --force
mysql -h 127.0.0.1 -P 3306 -u root -e "ALTER USER 'root'@'%' IDENTIFIED BY '$LOCAL_DB_PASSWORD'; FLUSH PRIVILEGES;"
```
Expected: `[✓] Changes applied`, then `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='dime_test'` ≈ 73.

- [ ] **Step 1.2: Discover the dev-server entry + admin column before assuming either**

Run: `python3 -c "import json;print(json.load(open('package.json'))['scripts'].get('dev'))"`
and `grep -n "isAdmin\|is_admin\|role" drizzle/schema.ts | head -8`
Record both; the next steps use whatever these actually say (do not guess names).

- [ ] **Step 1.3: Start the server with injected service env, DB overridden**

```bash
railway run env DATABASE_URL=mysql://root:$LOCAL_DB_PASSWORD@127.0.0.1:3306/dime_test \
  DISABLE_BACKGROUND_JOBS=1 NODE_ENV=development <dev script from 1.2>
```
Preflight probe (same env-injection, before the server): node one-liner printing
`new URL(process.env.DATABASE_URL).host` → must print `127.0.0.1:3306`.
Expected: server listening; `curl localhost:<PORT>/health` → 200.

- [ ] **Step 1.4: Create the two users through the real register flow, promote one to admin**

Register via the app's own register endpoint (agent-browser drives the `/signup` form — same
path production users take; the appUsers.register tests prove it works on this DB). Then:
`mysql -h 127.0.0.1 -P 3306 -u root -p$LOCAL_DB_PASSWORD dime_test -e "UPDATE appUsers SET <admin column from 1.2>=1 WHERE email='dev-admin@example.test';"`
Expected: login succeeds for both; admin routes render for the admin session, redirect for the normal one.

- [ ] **Step 1.5: Seed minimal `games` rows for today**

Discover NOT NULL columns: `grep -n "notNull" drizzle/schema.ts | grep -i game | head -20`.
INSERT two rows (one MLB with model numbers, one without edge → PASS row) dated today via mysql.
Expected: `/feed` shows the two games for the authed session (the material data state the audit
never saw).

- [ ] **Step 1.6: Reachability census — the number that changes the report**

Enumerate routes: `grep -n "path=\|<Route" client/src/App.tsx` (or the router file found there).
For each auth/DB-gated route from the 51-surface inventory, agent-browser visit as admin →
record HTTP/render/console status. Deliverable: `N of 26 previously-blocked surfaces now
runtime-inspected` with the per-route list (goes in the Phase 5 report).

### Task 2: Adjudicate the six suspects — fix-or-reject with runtime evidence

**Files (only if a suspect is CONFIRMED — expected touch set):**
- Modify: `client/src/components/GameCard.tsx` (star anchor, 1023 idiom, overflow-x — as found)
- Modify: `client/src/styles/dime-mobile.css` (loss-red, 1023 idiom — as found; **no `!important` work**)
- Modify: `client/src/pages/admin/*` (scrim alpha — as found)

Each suspect gets the same treatment: probe → verdict → (fix + re-probe) or REJECTED_WITH_EVIDENCE
entry. Verdicts and probe outputs are recorded for the Phase 5 report. Commit per suspect only
when code changed.

- [ ] **2.1 X-STALE-RESIZE:** the static reading (cleanup present at `GlobalMobileNav.tsx:44-45`,
  `DimeChatPage.tsx:1403-1406`) is an input, not a verdict — adjudicate on the runtime evidence
  gathered here. Probe: authed chat + mobile-nav surfaces, resize 320→1440→320, assert no
  duplicated handlers (attach marker, resize, check single fire) and no stale layout. Verdict
  follows the probe output, whichever way it lands.
- [ ] **2.2 X-LOSSRED-D:** `loss-red` appears only in `index.css` + `dime-mobile.css`. Probe the
  authed feed for rendered loss-red usage; law says negative = grey with scoped exception.
  Verdict: if usage is inside the documented scoped exception → REJECT; if it leaks to
  non-sanctioned elements → fix to `--text-secondary` tier and re-probe.
- [ ] **2.3 X-1023-IDIOM:** sites: `dime-mobile.css`, `GameCard.tsx`, `projections/ProjectionCard.css`,
  `DimeModelFeed.tsx` (WcFeedInline dies in Task 3). Check each against the canonical 1024
  breakpoint in `index.css` (audit suspected 1023 vs 1024 off-by-one seams). Probe at exactly
  1023, 1024, 1025 px widths on `/feed` (authed). Fix only measured seams.
- [ ] **2.4 X-OVERFLOW-X:** run the integer width sweep 320–1440 (step 1) on the now-reachable
  `/feed`, `/chat`, and the two heaviest admin routes, authed, seeded. Any overflow >1px → fix
  root cause (never blanket `overflow-x:hidden` — the ledger deferred exactly that hack).
- [ ] **2.5 X-ADMIN-ALPHA:** computed-style probe of admin overlay/scrim alphas vs law surface
  tokens on the reachable admin routes. Fix confirmed off-law scrims to token values; re-probe.
- [ ] **2.6 X-STAR-ANCHOR:** three candidate sites (`GameCard.tsx:1612` SVG `★` text,
  `DimeChatPage.tsx:631`, `UserManagement.tsx:857`). Runtime-inspect each (contrast, size vs
  11px floor, semantics). Fix what measurably violates law (likely the gold-star anti-pattern:
  neutral outline / mint-when-active per MASTER.md); REJECT the rest with screenshots.

### Task 3: WcFeedInline dead-code carve-out (owner-directed, verified)

**Files:**
- Delete: `client/src/components/WcFeedInline.tsx` (≈3,300 lines, 461 hex literals ≈ 28% of the
  1,644 TSX total)
- Modify: `client/src/components/wc2026FeedOrientation.test.ts` (file-reads the deleted file at
  line 21 — realign, do not delete assertions blindly)
- Keep: prose comments in `DimeModelFeed.tsx` (392/615/836/841) and `server/wc2026/htPipeline.test.ts:75`
  — historical provenance notes, not references

**Interfaces:**
- Produces: `client/src/components/WcFeedInline.tsx` no longer exists; total TSX hex count drops
  to ≈1,183; `duration-700/500` file set shrinks to 5.

- [ ] **Step 3.1: Re-prove deadness at HEAD (owner instructed: verify, don't trust)**

```bash
grep -rn "WcFeedInline" client/src server --include="*.ts" --include="*.tsx" | grep -v "^client/src/components/WcFeedInline.tsx"
grep -rn "import(.*WcFeedInline\|lazy(.*WcFeedInline" client/src
```
Expected: zero import/lazy hits; only the orientation test's `path.join` + prose comments.

- [ ] **Step 3.2: Read `wc2026FeedOrientation.test.ts` in full; realign before deleting**

The test asserts orientation contracts by reading the source file. Repoint its invariants at the
live surface that actually renders WC content now (`DimeModelFeed.tsx` WC adapter,
`server/wc2026/htPipeline.ts`) exactly the way #197's B7 realigned the six broken
source-contract tests — strengthen, don't weaken: the away-team-TOP-row invariant must still be
asserted somewhere real.

- [ ] **Step 3.3: Delete the file; run the full gated suite**

Run: `git rm client/src/components/WcFeedInline.tsx && pnpm exec tsc --noEmit && pnpm test:gated:local`
Expected: tsc exit 0; env-gate PASS with the same 64-entry allowlist arithmetic (any new failure
= a missed reference — stop and investigate, do not allowlist).

- [ ] **Step 3.4: Commit** — `refactor: delete dead WcFeedInline (461 hex, X-HEX carve-out) + realign orientation contract test`

- [ ] **Step 3.5: Hex-literal ceiling ratchet test (owner-endorsed scope addition)**

Create `client/src/hexLiteralCeiling.test.ts`, modeled on the repo-walking invariant test #195
introduced (locate it by `grep -rln "readdir\|walk\|glob" client/src --include="*.test.ts"` and
match its traversal idiom). The test IS the canonical metric definition:

- Pattern: `/#[0-9a-fA-F]{3,8}\b/g` (inclusive: shorthand + alpha forms count)
- File set: every `*.ts`, `*.tsx`, `*.css` under `client/src`, **test files included**
- Exemptions: the owner-approved Discord values `#5865F2` and `#4752C4` are not counted
- Fixture: a checked-in `hexLiteralCeilings.json` recording each file's post-Task-3 count;
  the test fails if any file EXCEEDS its recorded ceiling, and instructs (in its failure
  message) to lower ceilings — never raise them — when literals are removed
- This is a ratchet, not the migration: it freezes the ≈1,200-literal remainder so
  X-HEX-EPIDEMIC can burn down in normal-sized PRs

Run: `pnpm exec vitest run client/src/hexLiteralCeiling.test.ts` → green; temporarily add one
hex to any file → red (prove the tripwire), revert, green, commit.

### Task 4: Approved fixes

**Files:**
- Modify: `client/src/components/GameCard.tsx`, `client/src/components/BettingSplitsPanel.tsx`,
  `client/src/components/ui/sheet.tsx`, `client/src/pages/AdminModelStatus.tsx`,
  `client/src/pages/admin/MetricsPanel.tsx` (D-MOTION-LAW: every `duration-700`/`duration-500` →
  the 160ms brand curve, matching the idiom #197 used on landing — check
  `git log -p --follow client/src/pages/dime/landing/landing-v2.css` for the established form)
- Modify: `server/StrikeoutModel.py` (X-PY-CARDGEN chrome only: lines 958, 960, 1001, 1069-1070 +
  any further found by the gate grep; **never** 161-191. The unknown-team `.get()` fallbacks at
  941/944 (verified: `#003087`/`#C4CED4` Yankees, `#FD5A1E`/`#27251F` Giants) convert to neutral
  law greys — owner-delegated call: an unknown team must not wear a specific franchise's colors,
  and must never become mint)
- Modify: `server/landingPrerender.ts` (X-PRERENDER-V1: align the `#262626` tonal tiers to law
  values; fix the stale "IBM Plex Mono" comment at ~line 248; keep the copy-parity tests green —
  `server/landingPrerender.test.ts` guards this file)
- Modify: `client/src/index.css` (D-BG-SEAM: system-default canvas `#121212` → `#000000` —
  **first re-read `dime-ai/THREE-COLOR-LAW.md` and confirm `#000000` is the current Law-version
  dark canvas before setting anything**; locate the declaration by
  `grep -n "121212" client/src/index.css` and confirm it is the System-theme default, then unify.
  Probe all three themes including light — this is the one #198 change that touches every surface
  at once. X-ZINDEX: add the documented z-scale comment where collisions were found)
- Modify (bounded X-PX — **this list is the scope, locked before editing begins; no additions
  without a plan amendment commit**): `client/src/components/GameCard.tsx`,
  `client/src/components/BettingSplitsPanel.tsx`, `client/src/components/ui/sheet.tsx`,
  `client/src/pages/AdminModelStatus.tsx`, `client/src/pages/admin/MetricsPanel.tsx`,
  `client/src/index.css` — within these six files only, convert arbitrary `[Npx]` that violate
  law floors (sub-11px text, <44px targets) to law values; everything else stays deferred

Each fix follows: grep/locate → change → `tsc --noEmit` → runtime re-probe on the Phase 1 stack →
commit with the defect ID in the message. Per-fix verification:

- [ ] **4.1 D-MOTION-LAW:** after edit, `grep -rn "duration-700\|duration-500" client/src` → 0 hits;
  runtime probe: authed feed card + admin panels animate at 160ms (computed transition-duration).
- [ ] **4.2 X-PY-CARDGEN:** gate grep after edit:
  `grep -nE "#39FF14|#B060FF|#9050E0|#7030C0|#FF2D55" server/StrikeoutModel.py` → 0 hits;
  `sed -n '161,191p' server/StrikeoutModel.py` byte-identical to before (protected crest dict);
  fallback lines (located in-step) byte-identical; if the generator has a CLI entry, render one
  sample card and screenshot it for the report.
- [ ] **4.3 X-PRERENDER-V1:** `pnpm exec vitest run server/landingPrerender.test.ts` green; served
  `/privacy` + `/` prerender probe shows law-tier greys (computed styles).
- [ ] **4.4 D-BG-SEAM:** probe `/`, `/privacy`, `/feed` (authed) in dark / light / system —
  `getComputedStyle(document.body).backgroundColor` equals the page container's; System dark
  canvas now `rgb(0, 0, 0)`.
- [ ] **4.5 X-ZINDEX:** census `grep -rEn "z-\[|z-index" client/src | wc -l` before/after; only
  measured stacking conflicts change; scale documented in one `index.css` comment block.
- [ ] **4.6 Bounded X-PX:** in touched files only: `grep -oE "\[[0-9]px\]|\[10px\]" <file>` → 0
  sub-11px text sizes remain; touch targets in those files ≥44px by DOM rect probe.

### Task 5: Ledger + report update

**Files:**
- Create: `docs/superpowers/plans/2026-07-24-deferred-defects-pr198-report.md` (evidence report:
  per-suspect verdicts with probe outputs, reachability census N/26 → new runtime-inspected
  M/51, updated closure arithmetic, every deferred item's new status)
- Modify: `docs/superpowers/plans/2026-07-24-sitewide-design-repair-report.md` (append a dated
  "#198 addendum" section pointing at the new report — do not rewrite history)
- Modify: `design-system/dime-ai/MASTER.md` only if a fix changed a documented value (D-BG-SEAM
  System-canvas note gets a dated supersession line, same style as existing notes)

- [ ] **5.1:** Write the report with exact numerators/denominators (surfaces inspected, suspects
  confirmed/rejected, hex count before/after, duration-* count before/after). No unlabeled claims.
  **Hex-count methodology is written next to every number**: pattern `#[0-9a-fA-F]{3,8}\b`,
  file set `client/src/**/*.{ts,tsx,css}` including tests, Discord exemptions listed — i.e. the
  exact definition the ratchet test executes, so every figure is reproducible by one command.
- [ ] **5.2:** The verdict line stays **`INCOMPLETE`** regardless of #198's outcome:
  X-HEX-EPIDEMIC remains the open HIGH defect (carve-out ≠ closure), and the real-hardware,
  input-method, safe-area, full-Cartesian, and orientation gates remain unexecuted or physically
  blocked. Cross-engine: if WebKit runs on this macOS host (Task 6), the engines gate may
  honestly move — state exactly which engines and versions executed; otherwise it stays FAIL
  (blocked).
- [ ] **5.3:** Commit docs.

### Task 6: /sp-verify + PR #198

- [ ] **6.1 Full gate run (all output shown, per verification-before-completion):**

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit
pnpm test:gated:local                                   # expect env-gate PASS; allowlist may need
                                                        # entry updates ONLY if Task 3 realignment
                                                        # renamed test ids — justify each in the PR
# DB suites, CI parity (container from Task 1):
DATABASE_URL=mysql://root:$LOCAL_DB_PASSWORD@127.0.0.1:3306/dime_test DB_TESTS=1 NODE_ENV=test \
  pnpm exec vitest run --no-file-parallelism server/appUsers.login.test.ts \
  server/appUsers.register.test.ts server/completeAccountSetup.test.ts \
  server/passwordReset.test.ts server/tokenVersion.db.test.ts server/mlbDoubleheader.db.test.ts
pnpm run build:client && node scripts/verify-preview-production.mjs dist/public && pnpm run check:bundle
osv-scanner scan source --lockfile=pnpm-lock.yaml --config=osv-scanner.toml --format=json \
  --output-file=osv-report.json; node scripts/check-osv-scan.mjs --input=osv-report.json
```
Expected: tsc 0; env-gate PASS; DB suites 57/57 (or +N if Task 3 realignment added tests);
preview gate PASS; bundle ≤ ceiling (WcFeedInline deletion should not move the chat critical
path — confirm, don't assume); osv 0 HIGH/CRITICAL.

- [ ] **6.2:** Integer width sweep re-run (320–1440) on `/` + 404 + authed `/feed` — 0 overflow >1px.
- [ ] **6.2b:** WebKit attempt: `pnpm exec playwright install webkit` (local host, macOS). If it
  runs, probe `/`, `/login`, authed `/feed` at 1440×900 + 390×844 — record engine + version in
  the report and move the cross-engine gate only on that evidence. If unavailable, record
  BLOCKED unchanged.
- [ ] **6.3:** Teardown: `docker rm -f dime-test-mysql`; kill the dev server.
- [ ] **6.4:** Push branch, open PR #198 with the #197 body structure (purpose, evidence,
  tests with exact counts, bundle, DB=none, security, a11y, deploy/rollback = revert to
  `e660ac7c`), Authorization checklist unchecked for owner.

### Out of scope (stays deferred, restated for the record)

X-IMPORTANT (151 `!important` in `dime-mobile.css` — owner: own PR), X-HEX-EPIDEMIC remainder
(≈1,183 hex after the carve-out — token-migration project), X-DUAL-SYSTEMS
(GameCard/MobileGameCard/ProjectionCard consolidation), full W×H Cartesian probes,
WebKit/Firefox engines, real-hardware/touch/pen input coverage.

### Risks

- **Task 3 is the #195 failure mode replayed deliberately** — the orientation test file-reads the
  deleted file; realignment is a named step with the full gated suite as the tripwire.
- GameCard duration changes touch the most-rendered card in the product — runtime re-probe on
  seeded feed before commit.
- `StrikeoutModel.py` is a production model runner: chrome-only color edits, protected ranges
  byte-compared, no logic lines touched.
- Local server runs with real service secrets (Stripe live keys render checkout): render-only,
  no purchase flows driven; `DISABLE_BACKGROUND_JOBS=1` always; DB override probe before every
  server start.
- Seeding guesses NOT NULL columns from schema — if the INSERT fights defaults, prefer adding
  columns to the INSERT over relaxing the schema (schema changes are out of scope, full stop).
