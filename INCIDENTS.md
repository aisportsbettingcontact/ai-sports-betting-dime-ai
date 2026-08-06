# Incidents

## 2026-07-11 — Real-database Vitest suites cannot run locally

Status: RESOLVED (verified in the db-tests CI job; see update below)

The worktree recovery scope changed no server implementation files. After the
approved Vitest-only `APP_SESSION_SECRET` fixture allowed all suites to load,
42 assertions across five real-database server test files failed because their
setup helpers reported `Database not available`. These are not included in the
credential-only allowlist in `vitest.environment-failure-allowlist.json`.

Exact failing `file::test` names:

- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [ER-2] throws UNAUTHORIZED for wrong password`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [ER-3] throws FORBIDDEN for hasAccess=false user`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [ER-4] throws FORBIDDEN for expired user (expiryDate in the past)`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [JW-1..6] JWT claims are correct: sub, role, type, tv, alg, exp`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [SC-1..6] stayLoggedIn=false issues session cookie with maxAge=undefined`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [SL-1..9] stayLoggedIn=true issues 90-day persistent cookie with correct flags`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [TLS-1,2] HTTPS request produces secure=true, sameSite=none`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [UN-1] login by username (without @) issues cookie correctly`
- `server/appUsers.login.test.ts::appUsers.login — cookie issuance invariants > [UN-2] @username (with @ prefix) is treated as email lookup — throws UNAUTHORIZED`
- `server/appUsers.register.test.ts::appUsers.register — createUser invariants (real DB) > [CR-1..13] happy path: creates user, hashes password correctly, no cookie issued`
- `server/appUsers.register.test.ts::appUsers.register — createUser invariants (real DB) > [ER-1] throws CONFLICT when email is already in use`
- `server/appUsers.register.test.ts::appUsers.register — createUser invariants (real DB) > [ER-2] throws CONFLICT when username is already taken`
- `server/appUsers.register.test.ts::appUsers.register — createUser invariants (real DB) > [ER-3] Zod rejects password shorter than 8 chars (BAD_REQUEST)`
- `server/appUsers.register.test.ts::appUsers.register — createUser invariants (real DB) > [ER-4] Zod rejects invalid email format (BAD_REQUEST)`
- `server/appUsers.register.test.ts::appUsers.register — createUser invariants (real DB) > [RV-1] role=admin is stored correctly`
- `server/appUsers.register.test.ts::appUsers.register — createUser invariants (real DB) > [RV-2] role=handicapper is stored correctly`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [EC-1] already-setup user (pendingSetup=false, sessionId still set) returns alreadySetup=true without cookie`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [ER-1] throws NOT_FOUND for unknown sessionId`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [ER-2] throws CONFLICT when email is already used by a different user`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [ER-3] Zod rejects password shorter than 8 chars`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [ER-4] Zod rejects password without uppercase letter`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [ER-5] Zod rejects password without lowercase letter`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [ER-6] Zod rejects password without special character`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [HP-1..9] issues app_session cookie with correct flags and returns success`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [JW-1..6] JWT claims are correct: sub, role, type, tv, alg, exp`
- `server/completeAccountSetup.test.ts::stripe.completeAccountSetup — auto-login cookie invariant > [TLS-1,2] HTTPS request produces secure=true, sameSite=none`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RE-2] throws BAD_REQUEST for wrong token (hash mismatch)`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RE-3] throws BAD_REQUEST when no reset is pending (no token in DB)`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RE-4..5] throws BAD_REQUEST for expired token; expired token is cleared from DB`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RP-1..8] full reset chain: new hash, cost>=10, tokenVersion++, old hash cleared`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RQ-1] returns { success: true } for a valid email`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RQ-2] returns { success: true } for a valid username`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RQ-4..8] DB token stored correctly + sendPasswordResetEmail called with correct args`
- `server/passwordReset.test.ts::passwordReset — requestPasswordReset + resetPassword invariants (real DB) > [RQ-9] @username prefix is stripped before lookup`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [FA-1..3] incrementAllTokenVersions increments all users except the excluded owner`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [FL-1,2] forceLogoutUser increments tokenVersion and returns newTokenVersion`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [FL-3] forceLogoutUser throws BAD_REQUEST when owner tries to logout themselves`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [FL-4] forceLogoutUser throws NOT_FOUND for unknown userId`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [FL-5,6] end-to-end: old JWT rejected after forceLogoutUser; new JWT accepted`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [JR-1,2] stale tv JWT rejected; fresh tv JWT accepted by appUserProcedure (real DB)`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [JR-3] JWT without tv claim (tv=null) is accepted — null skips the tokenVersion check`
- `server/tokenVersion.db.test.ts::tokenVersion.db — DB-level and procedure-level force-logout invariants > [TV-1..4] incrementTokenVersion increments DB tokenVersion atomically`

Required follow-up: provide an isolated test database (or explicitly skip these
integration suites when it is absent), rerun all five files, and close only when
the 42 exact assertions pass.

### Update 2026-07-12 (remediation pass)

Two corrections and one improvement:

- CI never exercised these 42 assertions. All five suites carried
  `describe.skipIf(IS_CI)`, so GitHub Actions skipped them while local runs
  failed on the missing database. They executed nowhere.
- The repository configures no `DATABASE_URL` Actions secret (verified via
  the secrets API on 2026-07-12), so pointing CI at a real database was never
  possible with the documented setup.
- The remediation branch gives them an executing home: the `db-tests` CI job
  runs all five suites against an isolated `mysql:8` service container with
  migrations applied, and `scripts/test-db-local.sh` reproduces that locally
  against a throwaway `mysqld` (requires `brew install mysql`; the
  remediation machine had only `mysql-client`, so the local rerun remains
  outstanding).

Status stays OPEN until the 42 assertions pass on a local isolated database
per the follow-up above. The db-tests job result on the remediation PR is the
first executed evidence either way.

### Update 2026-07-12 (first green execution): RESOLVED

All five suites executed and passed against an isolated `mysql:8` database in
the `db-tests` CI job on PR #84 (48 assertions, 48 passed):
<https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai/actions/runs/29195327415/job/86657313941>

Getting there surfaced two latent defects the assertions themselves were not
guilty of, both now fixed in the job definition:

1. The checked-in Drizzle migration history is not replayable from scratch
   (`drizzle/0097` and `drizzle/0104` both `CREATE TABLE wc2026_matches`), so
   the job provisions the current TS schema via `drizzle-kit push --force`
   instead of `drizzle-kit migrate`. Repairing the history files is an owner
   decision (final-report finding 11).
2. The suites are not safe to run file-parallel against one shared database:
   `tokenVersion.db.test.ts` calls `incrementAllTokenVersions`, which bumps
   every user's tokenVersion and invalidated another suite's live owner
   session mid-test. The job and `scripts/test-db-local.sh` now pass
   `--no-file-parallelism`.

The local rerun via `scripts/test-db-local.sh` remains available for any
machine with `mysqld` (`brew install mysql`); the CI job now runs on every PR.

## Incident 2 — 2026-07-23 — Focused Vitest unavailable before dependency install

Status: RESOLVED

While adding the responsive AI Model Projections grid regression, I ran:

```text
corepack pnpm exec vitest run client/src/pages/dimeModelFeed.test.ts
```

The clean checkout had no installed JavaScript dependencies, so the command
exited 254 with this raw output:

```text
undefined
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found
```

Required follow-up: install the lockfile-pinned dependencies, rerun the focused
test, and close this incident only after Vitest executes normally.

### Update 2026-07-23: RESOLVED

Vitest now executes normally. The post-implementation focused run exited 0:

```text
Test Files  2 passed (2)
Tests       85 passed (85)
```

## Incident 3 — 2026-07-23 — Python postinstall blocked by PEP 668

Status: RESOLVED for this JavaScript-only change

I ran:

```text
corepack pnpm install --frozen-lockfile
```

pnpm resolved and added all 1,018 JavaScript packages, including
`vitest 2.1.9`, then the repository's `postinstall` hook ran
`pip3 install -r requirements.txt -q`. Homebrew's externally managed Python
rejected that system-level install. The command exited 1 with:

```text
error: externally-managed-environment
× This environment is externally managed
...
ELIFECYCLE Command failed with exit code 1.
```

Required follow-up: confirm the JavaScript verification commands execute with
the installed packages. Python-dependent verification must use a virtual
environment rather than bypassing PEP 668.

### Update 2026-07-23: RESOLVED for this JavaScript-only change

I completed the lockfile-pinned JavaScript install without the unrelated
Python postinstall:

```text
corepack pnpm install --frozen-lockfile --ignore-scripts
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 508ms using pnpm v10.33.0
```

The focused Vitest run then exited 0 with 85/85 assertions passing. No
Python-dependent command is part of this responsive CSS change.

## Incident 4 — 2026-07-23 — Responsive-grid regression test is red before implementation

Status: RESOLVED (expected TDD red state made green)

After adding the responsive acceptance contract, I reran:

```text
corepack pnpm exec vitest run client/src/pages/dimeModelFeed.test.ts
```

Vitest executed 43 tests and exited 1 with this focused result:

```text
Test Files  1 failed (1)
Tests       1 failed | 42 passed (43)

DimeModelFeed — combined slate (owner directive 2026-07-18)
> lays out projection games 1-up on mobile, 2-up on tablet, and 3-up on desktop
```

The assertion found the shipped one-column base plus two-column desktop rule,
which is the behavior this change replaces. Required follow-up: implement the
three responsive grid states and rerun this exact file green.

### Update 2026-07-23: RESOLVED

After implementing the 1/2/3-column grid and updating its companion card
contract, the focused run exited 0:

```text
✓ client/src/components/projections/ProjectionCard.test.ts (42 tests)
✓ client/src/pages/dimeModelFeed.test.ts (43 tests)

Test Files  2 passed (2)
Tests       85 passed (85)
```

## Incident 5 — 2026-07-23 — Changed-file Prettier check reports six files

Status: RESOLVED (pre-existing whole-file drift)

I ran Prettier's read-only check across the files touched by the responsive
grid change. It exited 1:

```text
Checking formatting...
[warn] client/src/pages/DimeModelFeed.tsx
[warn] client/src/pages/dimeModelFeed.test.ts
[warn] client/src/components/projections/ProjectionCard.css
[warn] client/src/components/projections/ProjectionCard.test.ts
[warn] e2e/feed-desktop.spec.ts
[warn] design-system/dime-ai/pages/ai-model-projections.md
[warn] Code style issues found in 6 files. Run Prettier with --write to fix.
```

Required follow-up: compare the same files at `main` to distinguish
pre-existing whole-file formatting drift from formatting introduced by this
change. Apply only scoped formatting that does not create an unrelated
whole-file rewrite.

### Update 2026-07-23: RESOLVED (pre-existing whole-file drift)

I piped each unchanged `HEAD` version into Prettier with its repository path as
`--stdin-filepath`. All six `HEAD` files also exited 1:

```text
client/src/pages/DimeModelFeed.tsx exit=1
client/src/pages/dimeModelFeed.test.ts exit=1
client/src/components/projections/ProjectionCard.css exit=1
client/src/components/projections/ProjectionCard.test.ts exit=1
e2e/feed-desktop.spec.ts exit=1
design-system/dime-ai/pages/ai-model-projections.md exit=1
```

`git diff --check` exited 0 after the scoped edits. I did not rewrite six
pre-existing, non-Prettier-formatted files as part of this layout change.

## Incident 6 — 2026-07-23 — React Doctor download unavailable

Status: RESOLVED with policy-enforced fallback

The required changed-scope scan:

```text
npx react-doctor@latest --verbose --scope changed
```

could not resolve `registry.npmjs.org` inside the sandbox and exited 1:

```text
npm error code ENOTFOUND
npm error network request to https://registry.npmjs.org/react-doctor failed
```

The required escalated retry was rejected by the execution policy because it
would download and execute unpinned third-party code with elevated access:

```text
This action was rejected due to unacceptable risk.
Reason: This would download and execute unpinned third-party code from npm...
```

I will not bypass that rejection. Required follow-up: run the exact React
Doctor command in an environment where the package is already trusted/pinned,
or explicitly authorize that third-party execution after reviewing the risk.
The repository's pinned TypeScript, Vitest, build, and Playwright checks remain
available as safer verification for this CSS-only change.

### Update 2026-07-23: RESOLVED with policy-enforced fallback

The rejected unpinned download was not retried. The changed behavior was
instead verified with the repository's installed, pinned toolchain:

```text
Test Files  2 passed (2)
Tests       86 passed (86)
TypeScript  tsc --noEmit exited 0
Build       production build + preview gate exited 0
Playwright  7 passed (17.5s)
```

React Doctor itself was not executed and remains an optional follow-up in an
environment where the package is already trusted or pinned.

## Incident 7 — 2026-07-23 — Playwright dev server blocked inside sandbox

Status: RESOLVED

The first browser-verification attempt exited 1 because the sandbox denied the
configured Vite server's local bind:

```text
Error: listen EPERM: operation not permitted 0.0.0.0:5199
Error: Process from config.webServer was not able to start. Exit code: 1
```

I reran the same repository-pinned Playwright command with approval to bind a
local test port. The production build, preview-production gate, and all
responsive browser cases completed successfully:

```text
[preview-production] PASS: preview activation is dead in production output
[1/6] shell feed desktop 1440px
[2/6] shell feed desktop 1280px
[3/6] shell feed desktop 1024px
[4/6] shell feed tablet 900px
[5/6] shell feed mobile 375px
[6/6] standalone /feed at 1440px
6 passed (22.3s)
```

## Incident 8 — 2026-07-23 — Playwright reused a stale production build

Status: RESOLVED

After adding the narrow-card summary reflow, the breakpoint suite reused the
existing `dist/index.js` by design and reported 3 failures:

```text
Expected: "flex"
Received: "grid"

3 failed
4 passed
```

File timestamps verify the built asset predates the source change:

```text
Jul 23 20:08:23 2026 dist/public/assets/DimeModelFeed-DrgRkJdq.css
Jul 23 20:08:24 2026 dist/index.js
Jul 23 20:10:57 2026 client/src/components/projections/ProjectionCard.css
```

Required follow-up: run the production build explicitly, then rerun the same
seven Playwright cases against that fresh artifact.

### Update 2026-07-23: RESOLVED

`corepack pnpm run build` exited 0 and produced a fresh client asset. The
subsequent seven-case Playwright run exercised the new source rather than the
stale artifact.

## Incident 9 — 2026-07-23 — Compact-summary test retained wide-grid chip alignment

Status: RESOLVED

The fresh-build Playwright run verified compact mode was active, then 3 desktop
cases failed on the pre-existing item-5 assertion that compares chip left-edge
offsets:

```text
edge-chip column offset matches between LIVE and PASS
Expected: <= 1
Received: 24.28125 (1440px)
Received: 23.8125  (1280px)
Received: 23.09375 (1024px)
```

The compact layout centers the signal chip beneath the fact row. A real-edge
chip and the shorter "No edge" chip therefore have different left edges while
sharing the same center. Required follow-up: retain exact left-edge comparison
for wide four-track cards and compare chip centers for compact cards, then
rerun all seven browser cases.

### Update 2026-07-23: RESOLVED

The browser contract now compares chip centers for compact cards and retains
the fact-column alignment assertions. The final run passed all seven cases.

## Incident 10 — 2026-07-23 — Long compact pick label clips at 1024px

Status: RESOLVED

Visual inspection of the green 1024px compact layout showed the leading letter
of `DODGERS ML` clipped inside the narrow MODEL EDGE fact track. BOOK and MODEL
had more width than their short numeric values required.

Required follow-up: rebalance the compact three-fact tracks toward MODEL EDGE,
rerun the focused tests and fresh production browser suite, and verify the
1024px screenshot no longer clips the label.

### Update 2026-07-23: RESOLVED

The final compact layout gives MODEL EDGE a full-width row. The 1024px
evidence shows `DODGERS ML` in full with no clipping.

## Incident 11 — 2026-07-23 — Compact BOOK and MODEL headers collide at 1024px

Status: RESOLVED

The rebalanced 1024px evidence showed the full `DODGERS ML` label, but the
remaining BOOK and MODEL tracks became too narrow and their headers touched.
Three independent fact columns do not fit legibly inside the approximately
190px desktop card.

Required follow-up: use a two-row compact fact grid (MODEL EDGE full-width,
BOOK and MODEL beneath), rebuild, rerun all breakpoint checks, and visually
verify the 1024px result.

### Update 2026-07-23: RESOLVED

The final 1024px evidence shows separate BOOK and MODEL columns beneath the
full-width MODEL EDGE row; their labels and values no longer collide.

## Incident 12 — 2026-07-23 — Edge value escapes chip at 1920px

Status: RESOLVED

Visual inspection of the 1920px three-across evidence showed the fixed
four-track summary still allocating less width than the complete edge chip
requires: the percentage rendered beyond the chip border. The page-level
overflow assertion stayed green because the text remained inside the card.

Required follow-up: extend the intrinsic compact-card threshold to cover
standard three-across desktop card widths, update the browser contract to
expect compact summaries at every tested desktop width, rebuild, rerun, and
visually verify 1920px.

### Update 2026-07-23: RESOLVED

The compact threshold now applies through 520px card width. Final verification:

```text
Test Files  2 passed (2)
Tests       86 passed (86)
TypeScript  tsc --noEmit exited 0
Build       production build + preview gate exited 0
Playwright  7 passed (17.5s)
```

The final 1920px evidence shows both real-edge percentages fully contained
inside their chips.

## Incident 13 — 2026-07-23 — React Doctor unavailable for market-popover change

Status: RESOLVED with policy-enforced fallback

The required changed-scope regression scan:

```text
npx react-doctor@latest --verbose --scope changed
```

could not resolve the npm registry inside the sandbox and exited 1:

```text
npm error code ENOTFOUND
npm error network request to https://registry.npmjs.org/react-doctor failed,
reason: getaddrinfo ENOTFOUND registry.npmjs.org
```

The required escalated retry was rejected because it would download and
execute unpinned third-party code with elevated access:

```text
This action was rejected due to unacceptable risk.
Reason: This would again download and execute unpinned third-party code from
npm with elevated access...
```

I will not bypass that policy decision. Required follow-up: run React Doctor
in an environment where the package is already trusted and pinned, or rely on
the repository-installed TypeScript, Vitest, production-build, and Playwright
checks documented in the resolution update below.

### Update 2026-07-23: RESOLVED with repository-pinned verification

React Doctor itself was not executed. The safer installed toolchain verified
the changed behavior instead:

```text
Test Files  2 passed (2)
Tests       91 passed (91)
TypeScript  tsc --noEmit exited 0
Build       production build + preview gate exited 0
Playwright  7 passed (22.4s)
```

Running React Doctor remains an optional follow-up only where its package is
already reviewed, trusted, and pinned.

## Incident 14 — 2026-07-23 — Pagination target renders below 44px

Status: RESOLVED

The first responsive Playwright run exercised the new market popover across
all seven viewports/cases. Six passed, but the 1440px desktop contract caught
one pagination link flexing just below the 44px interaction floor:

```text
Expected: >= 44
Received: 43.534332275390625

1 failed
6 passed (21.8s)
```

Required follow-up: give pagination links a non-shrinking rendered-size buffer,
rerun all seven browser cases, and close only when every measured target clears
44px.

### Update 2026-07-23 — first buffer still compressed during entrance animation

A non-shrinking 46px allocation still measured 43.250061px while Radix's
`zoom-in-95` opening animation was active. The repeated run again finished
with 6 passed / 1 failed. The target floor now includes enough source-size
buffer to remain above 44px during that transient scale, while compacting only
non-interactive ellipses so larger World Cup pagination windows still fit.

### Update 2026-07-23 — measurement root cause isolated

The 48px source target still measured 42.764648px because the assertion ran
while the popover's scale-in animation was in progress, not because the settled
control was shrinking in flex layout. The interaction contract now waits for
the popover's own entrance animation to finish before measuring its stable hit
areas; the 48px non-shrinking allocation remains as accessibility headroom.

### Update 2026-07-23: RESOLVED

All five Previous / 1 / 2 / 3 / Next controls now have a non-shrinking 48px
allocation. The settled-state geometry contract, active-page semantics, focus
behavior, desktop overlay, and mobile viewport bounds all passed:

```text
Running 7 tests using 1 worker
7 passed (22.4s)
```

Final desktop and mobile evidence show one active page at a time with no card
resize, grid movement, clipping, or page-level horizontal overflow. The final
mobile case runs at 375×667 and also verifies vertical collision bounds and
the contained popover scrollport.

## Incident 15 — 2026-07-23 — Incident-resolution patch context mismatch

Status: RESOLVED

The first documentation-only `apply_patch` used a line-wrapping context that
did not exactly match the incident file and exited without changing it:

```text
apply_patch verification failed: Failed to find expected lines
```

I read the current tail, reapplied the same resolution text against exact
context, and verified this incident plus Incidents 13–14 now have explicit
resolved status.

## Incident 16 — 2026-07-23 — Final popover review catches light-theme and outside-focus defects

Status: RESOLVED

The pre-publication review found that the portalled surface paired the global
light foreground with an undefined, card-scoped `--surface` token. In light
mode that fell back to a near-black background, making the header and
pagination unreadable. The eyebrow also used raw mint text instead of the
brand-law light-theme value. Both now use the global popover theme tokens and
the required `#0FA36B` light-theme text override.

The tightened browser test then caught a second interaction defect: outside
click closed the popover but did not restore focus to the trigger.

```text
Focused Playwright
1 failed, 1 passed
Expected trigger: focused
Received: inactive
```

The popover now owns a trigger ref and restores it through Radix
`onCloseAutoFocus` for Escape, outside click, and other close paths. The final
proof also covers the complete seven-market dynamic binding, `aria-controls`,
boundary `tabindex="-1"`, full x/y/width/height grid invariance, light-theme
computed colors, and short-phone vertical containment.

```text
Test Files  2 passed (2)
Tests       91 passed (91)
TypeScript  tsc --noEmit exited 0
Build       production build + preview gate exited 0
Playwright  7 passed (22.4s)
```

## Incident 17 — 2026-07-23 — React Doctor unavailable in the restricted environment

Status: RESOLVED with repository-pinned verification

The required React Doctor command could not reach the npm registry from the
sandbox:

```text
getaddrinfo ENOTFOUND registry.npmjs.org
```

The request to rerun the unpinned third-party package with elevated network
access was rejected, so React Doctor itself was not executed. The safer,
repository-installed toolchain verified the probable-pitcher and lineup-dialog
changes instead:

```text
TypeScript  tsc --noEmit exited 0
Client      45 files / 571 tests passed
Build       production build + preview gate exited 0
Playwright  7 responsive browser cases passed
```

The full repository suite additionally reached 2,214 passing tests; its 64
failures were confined to pre-existing integrations that require unavailable
database, provider, CI-secret, or public-origin configuration. No changed
client test failed. React Doctor remains an optional follow-up where its
package is already reviewed, trusted, and pinned.

## Incident 18 — 2026-07-23 — Pregame UI exposes existing scraper identity defects

Status: RESOLVED

The pre-publication review found that the existing RotoWire persistence path
selected the first same-team database row and handed the watcher a map keyed
only by matchup. Same-day doubleheaders could therefore overwrite one lineup
row or send both cards to the same model event. The parser also represented
missing pitcher metadata as real-looking `0-0 · 0.00 ERA` and right-handed
values.

A second review found two related ambiguity paths: the cycle used Pacific
calendar dates for RotoWire's Eastern-time today/tomorrow pages, and
time-fallback matching could silently break ties or accept implausibly distant
rows.

The scraper now:

- queries the complete exact-date MLB slate using Eastern calendar scopes;
- claims each database event at most once;
- uses distinct chronological game-number alignment for complete slates;
- accepts partial time matches only when uniquely supportable and within two
  hours;
- skips duplicate-time, equal-distance, far-distance, and multi-card TBD
  ambiguity instead of guessing;
- hands the watcher an exact scraped-object-to-game-ID map;
- keeps different-day and doubleheader cards distinct; and
- persists omitted ERA/W-L and throwing hand as null.

Repository-pinned verification after the final tightening:

```text
TypeScript  tsc --noEmit exited 0
Focused     6 files / 92 tests passed
Scraper     14 tests passed
Build       production client + preview gate + server build exited 0
Diff        git diff --check exited 0
```

An independent re-review found no remaining matcher or date-scope blockers.

## Incident 19 — 2026-07-25 — Initial Dime foundation patch context mismatch

Status: RESOLVED

I attempted the first Dime foundation adaptation patch with a cache-variable
context that did not match the imported `scripts/bootstrap_env.sh`. The patch
tool rejected the complete patch before changing any file:

```text
apply_patch verification failed: Failed to find expected lines
```

I read the imported script, confirmed its existing variable is
`PIP_CACHE_DIR`, and reapplied the intended changes against the exact current
text. No partial edit from the rejected patch was retained.

## Incident 20 — 2026-07-25 — Imported research-title patch context mismatch

Status: RESOLVED

I coupled several documentation adaptations to an assumed research-document
title. The imported title differed, so the patch tool rejected the complete
patch before changing any file:

```text
apply_patch verification failed: Failed to find expected lines
```

I read both exact headings, split the documentation changes into verified
patches, and applied the historical-authority notices against their actual
titles. No partial edit from the rejected patch was retained.

## Incident 21 — 2026-07-25 — PR #199 removed the governed Dime runbook

Status: OPEN

[PR #199](https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai/pull/199)
merged a deletion-only Dime ML state: `ml/dime-1.0/README.md` was absent while
`CLAUDE.md`, `server/_core/dimeChatModel.ts`, and
`server/dime1ProviderWiring.test.ts` still pointed to it as an operational
runbook or evaluation gate. Runtime profile comments also described the
obsolete Llama 3 8B Instruct, merged/AWQ, and deployed RunPod assumptions.

The PR description did not document those dangling references, and the
[P2 review finding](https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai/pull/199#discussion_r3650369828)
remains unresolved. The remediation must remain open until the replacement
foundation is merged to `main` and verified. The draft remediation PR link
will be added after GitHub creates it; creating a draft alone does not resolve
the old finding.

## Incident 22 — 2026-07-25 — uv default cache is outside the workspace sandbox

Status: RESOLVED

The first deterministic lock regeneration could not initialize uv's default
user cache because that location is outside the writable workspace:

```text
Failed to initialize cache
Operation not permitted
```

No project file was changed by the failed command. The same repository-pinned
operation was rerun with `UV_CACHE_DIR` set to a task-scoped directory under
`/private/tmp`, which is writable in the isolated environment. That restricted
run then reached the expected network boundary while resolving PyPI:

```text
Failed to fetch: https://pypi.org/simple/pyyaml/
failed to lookup address information
```

The exact `uv lock` command was approved for network access and then resolved
15 packages successfully, adding the pinned pytest and Ruff development
dependency graph to `uv.lock`.

## Incident 23 — 2026-07-25 — sibling worktree virtualenv required scoped approval

Status: RESOLVED

`uv lock --check` passed, but the initial frozen synchronization could not
create `.venv` because the requested isolated sibling worktree is outside the
command sandbox's default writable root:

```text
failed to create directory ml/dime-1.0/.venv
Operation not permitted
```

The task-scoped `uv sync --frozen --dev` command was approved for the sibling
worktree. It created only the ignored local environment and installed the 13
locked CPU development packages; no model or tokenizer was downloaded.

## Incident 24 — 2026-07-25 — new repository contract test failed Ruff import layout

Status: RESOLVED

The first Ruff pass found one formatting-only import-layout error in the new
static repository contract test:

```text
I001 Import block is un-sorted or un-formatted
tests/test_repository_contract.py
```

Ruff's read-only diff showed that the cause was one extra blank line between
the standard-library imports and module constants. That line was removed and
the complete Ruff gate was rerun.

## Incident 25 — 2026-07-25 — static prompt contract exposed missing abstention label

Status: RESOLVED

The first complete CPU pytest run reported 54 passing tests and one failure:

```text
FAILED tests/test_repository_contract.py::test_static_prompt_template_and_tool_invariants
AssertionError: assert 'NO DATA' in prompt
```

The versioned training prompt already required narrowing or abstaining when
evidence is unavailable, but it did not pin the runtime's deterministic
`NO DATA` label. The prompt now requires that exact label, names the missing
evidence, and preserves abstention. The full suite was rerun after the change.

## Incident 26 — 2026-07-25 — combined prompt/incident patch targeted the wrong file

Status: RESOLVED

The first attempt to record Incident 25 combined two file edits but omitted the
second file header, so the patch tool searched the prompt for an
`INCIDENTS.md` heading and rejected the complete patch:

```text
apply_patch verification failed: Failed to find expected lines
```

No partial change was retained. The prompt and incident updates were then
applied with explicit file targets.

## Incident 27 — 2026-07-25 — public-data gate rejected synthetic tracker fixtures

Status: RESOLVED

The first standalone data-validation run rejected two public sample records:

```text
DataValidationError: data/sft/train.sample.jsonl:
public sample cannot contain user data
```

Both records use wholly synthetic Bet Tracker values and synthetic source
identifiers; they contain no real user history or identifier. Their imported
metadata nevertheless classified them as containing user data. The public
fixtures were corrected to `contains_user_data: false`, with no consent basis
or user partition hash, so the metadata now matches their synthetic-only
contents. The public-data gate and full test suite were rerun.

## Incident 28 — 2026-07-25 — root postinstall rejected Homebrew system Python

Status: RESOLVED

The required `corepack pnpm install --frozen-lockfile` installed all 1,018
locked Node packages, then the repository's existing `postinstall` hook tried
to run `pip3 install -r requirements.txt` against Homebrew's protected Python:

```text
error: externally-managed-environment
ELIFECYCLE Command failed with exit code 1
```

No system package was changed. A task-only Python virtual environment was
created under `/private/tmp` and placed first on `PATH`; the exact frozen pnpm
install was then rerun so the unchanged hook installed only into that isolated
environment.

## Incident 29 — 2026-07-25 — isolated postinstall PATH omitted Corepack

Status: RESOLVED

The first isolated postinstall rerun used a minimal `PATH` that included the
temporary Python environment but omitted the host's `/usr/local/bin` Corepack
location:

```text
zsh: command not found: corepack
```

The command stopped before package work began. I resolved the executable
locations with `command -v`, added `/usr/local/bin` to the scoped `PATH`, and
reran the same frozen install.

## Incident 30 — 2026-07-25 — root Python requirements lack Python 3.14 wheels

Status: RESOLVED

The task-only environment inherited the host's Python 3.14. The repository's
pinned SciPy 1.13.1 has no compatible Python 3.14 wheel, so pip attempted a
source build and stopped because no Fortran compiler is installed:

```text
scipy 1.13.1
ERROR: Unknown compiler(s): gfortran, flang, ifort
metadata-generation-failed
```

This did not indicate a PR change or alter the system interpreter. The host
also provides Python 3.11, which matches the repository's Railway runtime and
has wheels for the pinned requirements. I recreated the task-only environment
with Python 3.11 and reran the unchanged frozen install.

## Incident 31 — 2026-07-25 — local gated suite inherited host DB and CI configuration

Status: RESOLVED

The first full `test:gated:local` run inherited external host configuration and
reported:

```text
Test Files  2 failed | 156 passed (158)
Tests       3 failed | 2326 passed (2329)
environmentBound=3
```

One real-database registration assertion observed an externally invalidated
session instead of its fixture's expected conflict. Two CI-secret validation
assertions rejected the inherited session-secret length. The local environment
gate correctly refused to classify that mixed run as passing and also reported
one stale provider allowlist entry because another inherited provider setting
made its test pass.

No value was inspected or copied. The local-profile suite was rerun with
external database, CI-secret, and model-provider variables explicitly removed
from its process environment, allowing the repository's declared local
environment policy to govern unavailable integrations.

## Incident 32 — 2026-07-25 — final secret-scan shell pattern was malformed

Status: RESOLVED

One read-only final scan combined shell quoting and a regular expression
containing quote characters incorrectly:

```text
zsh: unmatched quote
```

The scan did not execute and changed no file. I split the patterns into simpler
read-only searches and reran the complete staged-content review.

## Incident 33 — 2026-07-25 — workflow parse used the system Python environment

Status: RESOLVED

The first read-only workflow parse called the host Python, which does not have
the project YAML library:

```text
ModuleNotFoundError: No module named 'yaml'
```

The workflow was then parsed with the synchronized Dime CPU development
environment, where the pinned YAML dependency is part of the validated lock.

## Incident 34 — 2026-07-25 — optional Prettier probe found baseline style drift

Status: RESOLVED with scoped verification

An extra, non-required Prettier check reported style warnings in the six
modified existing TypeScript files. The new workflow itself passed:

```text
Code style issues found in 6 files
```

Those files already contain repository-wide formatting drift, and formatting
entire runtime modules would create unrelated changes outside this remediation.
No bulk rewrite was applied. The narrow changes instead passed `tsc --noEmit`,
all 45 focused Dime tests, the full local environment gate, the production
build, and `git diff --check`.

## Incident 35 — 2026-07-25 — staged check found imported whitespace defects

Status: RESOLVED

The first staged `git diff --check` found five imported files with an extra
blank line at EOF and three research-document lines with Markdown hard-break
spaces:

```text
new blank line at EOF
trailing whitespace
```

The affected text files were normalized mechanically to a single final newline
and no trailing spaces, then explicitly restaged. No content or generated
evidence JSON was changed.

## Incident 36 — 2026-07-25 — sandboxed GitHub authentication probe was inconclusive

Status: RESOLVED

The first GitHub pre-push probe ran without network access. `gh auth status`
reported the stored session as invalid and the following API request could not
connect:

```text
Failed to log in to github.com
error connecting to api.github.com
```

No credential value was read and no remote mutation occurred. The exact
authentication check was rerun with approved network access and confirmed the
active account and required repository/workflow scopes. A read-only pull
request query then confirmed that PR #200 did not exist and #199 remained the
latest repository pull request.

## Incident 37 — 2026-07-25 — GitHub incident patch used wrapped context

Status: RESOLVED

The first attempt to add Incident 36 assumed a line wrap that differed from the
current file, so the patch tool rejected the complete multi-file patch:

```text
apply_patch verification failed: Failed to find expected lines
```

No partial edit was retained. I read the exact tail and reapplied the incident
and publication-confirmation updates against current context.

## Incident 38 — 2026-07-25 — Two Railway services started the same schedulers (single-writer violation)

Status: CLOSED — VERIFIED

Both Railway services (`ai-sports-betting-dime-ai` and `ai-sports-betting-backend`)
auto-deploy `main` and both started the full in-process scheduler set, including
the MLB model runner — a violation of the single-writer rule in
`references/railway-deploy.md`. Actual data exposure was limited: the backend's
`DATABASE_URL` resolves to a schema without the app tables, so its jobs failed
with `ER_NO_SUCH_TABLE` on every cycle (constant log noise, no writes), and the
MLB runner's writes are keyed `UPDATE … WHERE games.id = ?` (no inserts), so
even a true dual-writer could not have produced duplicate rows.

Remediation (2026-07-25, operator-approved): `DISABLE_BACKGROUND_JOBS=1` was set
on `ai-sports-betting-backend` only; Railway redeployed the same commit
(SUCCESS ≈ 17:21:25 UTC). Verified via read-only Railway deployment/log
inspection:

- backend logged `DISABLE_BACKGROUND_JOBS set — web-only mode: recurring
background jobs skipped`; zero scheduler or MLB runner starts since;
- recurring `ER_NO_SUCH_TABLE` noise stopped (see Incident 39 for the
  once-per-boot residual);
- both `/health` endpoints stayed green (db circuit CLOSED, 0 consecutive
  failures) through the verification window;
- three scheduled MLB cycles completed after the change (≈ 17:22, 17:27,
  17:32 UTC); the 17:32 cycle wrote one game with zero errors and passed the
  post-write validation gate.

Standing state: **`ai-sports-betting-dime-ai` is the sole scheduled-job and
MLB-data writer.** `ai-sports-betting-backend` is web-only. Re-enabling backend
schedulers requires an explicit architecture and data-ownership review, not
just unsetting the variable. Decommissioning the backend is deliberately
deferred until its route ownership and real traffic are evaluated.

## Incident 39 — 2026-07-25 — Once-per-boot ER_NO_SUCH_TABLE on backend startup

Status: OPEN (low priority)

With schedulers disabled, `ai-sports-betting-backend` still emits exactly one
`ER_NO_SUCH_TABLE` error during startup — from a startup-time DB call that runs
outside the `DISABLE_BACKGROUND_JOBS` guard in `server/_core/index.ts` (e.g.
table-ensure/startup probes), against the backend's app-table-less database.
It is non-recurring, does not indicate a second writer, and does not affect the
sole-writer service. Cleanup is a deferred audit item; do not "fix" it by
creating tables in that database.

## Incident 40 — 2026-07-25 — Perf harness never measured anything (host helper in browser callback)

Status: RESOLVED IN CODE (trust pending post-deploy observation period)

Every retained run of `.github/workflows/perf-harness.yml` since the harness was
introduced (2026-07-09, first retained run 2026-07-10) failed identically with
`page.evaluate: ReferenceError: __name is not defined` before collecting a
single metric. Root cause: the harness runs under `tsx`, whose esbuild transform
(keepNames) rewrote the name-inferred helper inside the `page.evaluate` callback
(`const round = (n) => …`) into a host-only `__name()` wrapper; Playwright
serializes the callback with `Function.toString()` and evals it in the page,
where `__name` does not exist. Reproduced locally byte-for-byte via the exact CI
command before the fix; after extracting the callback to
`perf/browserMetrics.ts` (serialization-safe, no name-inferred inner function
expressions) the same command collected metrics on all three routes and passed
all 18 gates.

Consequences recorded: the historical run history is invalid as performance
evidence; no application performance regression is demonstrated by those
failures (the app answered `/health` throughout); budgets and the regression
baseline have never yet gated anything. The repaired harness must complete
3–5 successful, comparable scheduled runs on the standard CI runner before its
budgets/regression guard are treated as a trusted deployment control. Budgets
were not changed in the fix.

Corrective follow-up (2026-07-25): the post-merge review of PR #201 confirmed
that the execution crash was fixed, but found three remaining control defects:
LCP was queried through `performance.getEntriesByType`, which cannot return
`largest-contentful-paint` and therefore made the LCP gate falsely pass at
zero; the two real-browser tests were skipped in required CI; and
`update_baseline` rewrote a file only inside an ephemeral Actions checkout.
The follow-up uses a buffered `PerformanceObserver`, fails closed when LCP is
unsupported or missing, installs Chromium in the required Vitest job, executes
the focused browser suite in the live workflow, and emits a reviewable baseline
candidate artifact without write access to the repository. No run before that
follow-up is deployed counts toward the 3–5-run observation requirement; the
counter remains 0.

## Incident 41 — 2026-07-28 — Initial GitHub fetch was blocked by the local sandbox

Status: RESOLVED

The first read-only refresh of `origin` ran inside the restricted local
sandbox and could not resolve GitHub:

```text
fatal: unable to access 'https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai.git/': Could not resolve host: github.com
```

No repository or remote state changed. I reran the same `git fetch --prune
origin` operation with the required network approval. It completed
successfully and verified `origin/main` at
`29fc398aaf199e035ceeb6ac2a37d9c2667947cd` before creating the Trace v1
implementation branch.

## Incident 42 — 2026-07-28 — Read-only search command had an unmatched shell quote

Status: RESOLVED

A combined read-only `rg` inspection command embedded a backtick-bearing SQL
pattern inside a double-quoted shell argument. Zsh rejected the command before
execution:

```text
zsh:4: unmatched "
```

No search or mutation ran. I split the inspection into plainly quoted commands
without executable substitutions and continued read-only repository
inspection.

## Incident 43 — 2026-07-28 — Privacy search used a non-matching shell glob

Status: RESOLVED

The first read-only privacy-file search included
`client/src/pages/Legal*`. Zsh's default `nomatch` behavior rejected the
command because that path does not exist:

```text
zsh:1: no matches found: client/src/pages/Legal*
```

No search or mutation ran. I reran the inspection using the two verified files,
`client/src/pages/Privacy.tsx` and `client/src/pages/Terms.tsx`, plus the
governance and prerender sources.

## Incident 44 — 2026-07-28 — Environment-presence probe returned unusable tool output

Status: RESOLVED

A read-only Node probe intended to report only whether `DATABASE_URL` was
configured returned a tool-level output-truncation message instead of the
expected boolean result. The command did not print or modify the credential,
and no repository or database state changed.

I replaced that inconclusive probe with a shell presence check that reports
only `configured` or `absent`. Trace v1 implementation does not depend on
reading or exposing the connection-string value.

## Incident 45 — 2026-07-28 — Follow-up schema search repeated a shell-quoting error

Status: RESOLVED

A read-only combined inspection included a backtick inside a double-quoted
search expression. Zsh rejected it as an unmatched quote before any command
ran. No files, database records, or external systems changed.

I removed the shell-sensitive expression and continued with literal,
single-purpose searches. This is a command-construction failure only; it does
not affect the Trace v1 implementation.

## Incident 46 — 2026-07-28 — First Trace v1 typecheck found one retry identifier typo

Status: RESOLVED

The first implementation typecheck failed because the retry event metadata
referenced `retryOfGenerationId` while the local variable is named
`retryGenerationId`. No build artifact, database migration, deployment, or
external state changed.

The metadata key remains `retryOfGenerationId`; its value now correctly uses
`retryGenerationId`. The typecheck was rerun after the correction.

## Incident 47 — 2026-07-28 — Combined privacy-copy patch matched one renderer incorrectly

Status: RESOLVED

The first privacy-copy patch expected a literal em dash in the prerendered HTML
source, while that source correctly uses the `&mdash;` entity. The patch tool
rejected the combined patch atomically, so neither privacy source changed.

I inspected both exact render sources and reapplied the same disclosure update
with their native JSX and HTML encodings preserved.

## Incident 48 — 2026-07-28 — First focused Trace v1 regression run exposed contract drift

Status: RESOLVED

The first focused Trace v1 regression run completed with 10 failures across
81 tests. Four client tests incorrectly assumed a browser `sessionStorage`
global even though this repository runs Vitest in Node. Six existing
source-contract assertions used exact formatting or first-occurrence slicing
that no longer identified the provider branches after Trace v1 added provider
metadata and multiline SSE frames.

The run did not mutate a database or external service. The client tests now
use injected storage, and the existing contract tests assert the same security
and provider-order invariants through stable route anchors rather than exact
line formatting.

## Incident 49 — 2026-07-28 — Trace v1 review found release-blocking retry and crash gaps

Status: RESOLVED

The bounded pre-publication review found that a process crash could leave a
generation permanently marked `generating`, and post-persistence JSON errors
did not return the canonical trace identity needed for a safe retry. It also
found UTF-8 byte-length, stale prior-turn retry, and whole-file schema-format
churn issues.

Trace v1 now recovers expired generation leases under the thread lock, returns
canonical trace metadata on every post-begin HTTP error, restricts retries to
failed or aborted attempts, validates storage by UTF-8 bytes, and keeps the
schema diff localized to the Dime Chat section. No production flag, migration,
Railway service, RunPod endpoint, or Hugging Face repository was changed.

## Incident 50 — 2026-07-28 — Migration check initially lacked its required local URL

Status: RESOLVED

The first local `drizzle-kit check` invocation failed closed because
`drizzle.config.ts` requires `DATABASE_URL`, even though the check does not
apply a migration:

```text
DATABASE_URL is required to run drizzle commands
```

No database connection or external mutation occurred. The same check was
rerun with a non-secret loopback placeholder URL and returned
`Everything's fine`, confirming the migration journal and snapshots are
internally consistent.

## Incident 51 — 2026-07-28 — React Doctor package lookup was blocked in the sandbox

Status: RESOLVED

The required changed-UI diagnostic could not resolve the npm registry from the
restricted sandbox and exited with `ENOTFOUND`. No dependency or project file
changed. The same command was rerun with narrowly scoped network approval;
React Doctor completed, found no issue in the changed UI, and reported its
repository score without modifying the worktree.

## Incident 52 — 2026-07-28 — Full local suite reached environment-gated tests

Status: RESOLVED FOR TRACE V1 / ENVIRONMENT GATES REMAIN EXTERNAL

The repository-wide Vitest run passed 2,351 tests and failed 66. The failures
were dominated by tests that explicitly require a live local database,
credentials, Playwright/browser sockets, or other unavailable integration
environment. Those are not bypassed or rewritten in this change.

One failure was branch-caused: `sidebarRail.test.ts` matched an exact
single-line JSX layout that Prettier wrapped after Trace v1 changed the chat
page. The assertion now checks the component token independent of whitespace.
The complete changed-chat and Trace-focused set was then rerun: 11 files and
160 tests passed. TypeScript, migration consistency, formatting, and diff
checks also remain green.

## Incident 53 — 2026-07-28 — Main advanced during Trace v1 implementation

Status: RESOLVED

GitHub comparison before PR creation showed that `main` had advanced by 20
commits and now owned migrations `0119` and `0120`. The first sandboxed fetch
could not resolve GitHub; the approved retry fetched current `main`. Rebase
then correctly stopped on the migration-number and snapshot conflicts.

The Trace schema itself merged without conflict. Trace v1 was regenerated from
the current `0120` snapshot as migration `0121`, its duplicate-sequence
constraint remains first, and the old non-unique index remains the final drop.
No migration was applied and no external database state changed.

## Incident 54 — 2026-07-28 — Trace v1 exceeded the chat bundle gate

Status: RESOLVED

The first pull-request CI run passed security, TypeScript, database, Vitest,
Gitleaks, and Dime LLM validation, but the production chat critical path was
219,216 gzip bytes—774 bytes above its 218,442-byte ceiling.

The Trace browser utility is now a real on-demand chunk instead of a static
chat dependency. Initial and retry correlation remain guarded against duplicate
submission and stale async completion, secure UUID generation fails closed,
and server-owned persistence/retry identity behavior is unchanged. The budget
was not raised.

The corrected production build measures 218,373 gzip bytes, 69 bytes below the
existing ceiling. TypeScript, the full production client/server build, preview
verification, 255 focused chat/Trace tests, and `git diff --check` all pass.

## Incident 55 — 2026-07-29 — Prettier batch included a Python test

Status: RESOLVED

I included
`ml/dime-1.0/tests/test_engineering_control_contract.py` in a Prettier command
that was intended for JavaScript, JSON, YAML, and Markdown files. Prettier
formatted the supported files, then exited 2 before the chained tests ran:

```text
[error] No parser could be inferred for file ".../test_engineering_control_contract.py".
```

The Python file was not modified by Prettier. Required follow-up: validate it
with Ruff, run the focused JavaScript and Python tests, and close this incident
only after those commands execute successfully.

### Update 2026-07-29: RESOLVED

I reran the Python file through its correct formatter and linter, then ran the
focused runtime and contract suites:

```text
All checks passed!
1 file already formatted

Test Files  4 passed (4)
Tests       111 passed (111)

4 passed in 0.28s
```

## Incident 56 — 2026-07-29 — Product-route metadata invalidated the frozen routing benchmark hash

Status: RESOLVED

The full Dime Python suite executed 769 tests and reported one failure:

```text
FAILED ml/dime-1.0/tests/test_runtime_answer_routing_benchmark.py::
test_local_report_is_bound_to_the_frozen_fixture

1 failed, 768 passed in 46.96s
```

The benchmark report still bound the prior SHA-256 of
`server/_core/dimeAnswerRouting.ts`. This change intentionally adds the
additive `productRoute` classification to that runtime module, so the frozen
evidence must be regenerated and reviewed rather than having its hash edited
by hand.

Required follow-up: inspect the repository benchmark reproduction command,
regenerate the report from the unchanged fixture through the current runtime,
verify semantic results, checksums, and focused tests, then close only when the
full Python suite passes.

### Update 2026-07-29: RESOLVED

The documented generator changed only the runtime-module hash in the report;
all 19 frozen cases and every recorded metric remained unchanged and passing.
I updated the report checksum, ran generator check mode, ran the focused
JavaScript and Python evidence tests, and then reran the full Dime Python suite:

```text
Runtime Answer Routing v1 evidence matches .../local-baseline.json
Test Files  1 passed (1)
Tests       1 passed (1)
7 passed in 0.09s
769 passed in 48.72s
```

## Incident 57 — 2026-07-29 — TSX benchmark generator could not create its sandbox IPC socket

Status: RESOLVED

The documented routing-benchmark regeneration command failed before loading
project code because TSX could not create its local IPC socket:

```text
Error: listen EPERM: operation not permitted
.../T/tsx-501/59928.pipe
code: 'EPERM'
```

No benchmark artifact changed. Required follow-up: rerun the same repository
generator with narrowly scoped sandbox escalation, then continue Incident 56
verification.

### Update 2026-07-29: RESOLVED

The approved rerun executed the same documented generator and wrote the
deterministic report. The check-mode rerun and companion tests then passed:

```text
Runtime Answer Routing v1 evidence matches .../local-baseline.json
Test Files  1 passed (1)
Tests       1 passed (1)
7 passed in 0.09s
```

## Incident 58 — 2026-07-29 — Authorization-label cleanup patch used pre-format context

Status: RESOLVED

I attempted to rename the training-strategy result from
`trainingAuthorized` to the narrower `trainingEligibleForAuthorization`.
`apply_patch` rejected the edit because Prettier had changed the exact line
wrapping used as patch context:

```text
apply_patch verification failed: Failed to find expected lines
```

No file changed. Required follow-up: inspect the formatted declarations and
return block, apply the scoped rename, then rerun the focused runtime suite.

### Update 2026-07-29: RESOLVED

The scoped rename now distinguishes eligibility from actual training
authorization. The focused control-plane suite passed 10/10 tests and the
repository TypeScript check exited 0.

## Incident 59 — 2026-07-29 — Product-route evidence generator IPC denied in sandbox

Status: RESOLVED

The new product-route benchmark generator failed before loading repository
code because TSX could not create its local IPC socket:

```text
Error: listen EPERM: operation not permitted
.../T/tsx-501/63937.pipe
code: 'EPERM'
```

No evidence artifact existed or changed during the failed attempt.

### Update 2026-07-29: RESOLVED

The same repository generator was rerun with narrowly scoped approval and
wrote the deterministic local product-route baseline. Its check mode and
contract tests are part of the Phase 1 verification matrix.

## Incident 60 — 2026-07-29 — New Python benchmark test required Ruff formatting

Status: RESOLVED

The focused Ruff lint check passed, but `ruff format --check` correctly
reported that the new product-route benchmark contract test needed mechanical
line wrapping. No runtime or evidence artifact was affected.

### Update 2026-07-29: RESOLVED

Ruff formatted the single test file. Lint, format check, and all four focused
Python benchmark tests then passed.

## Incident 61 — 2026-07-29 — Checksum verification used the wrong working directory

Status: RESOLVED

The first `shasum --check` invocation ran from the repository root even though
the manifest paths are relative to the manifest directory. All three entries
therefore reported `No such file or directory`; no digest mismatch occurred.

### Update 2026-07-29: RESOLVED

The same manifest was verified from its owning evidence directory. The frozen
fixture, local report, and JSON Schema all returned `OK`.

## Incident 62 — 2026-08-05 — Schema health gate failed two backend deploys on the zombie service

Status: RESOLVED (fixed by PR #394 before this entry was written; filed retroactively because no
entry existed for two FAILED production deployments)

PR #392 shipped a schema/code-agreement health gate: `/health` returns 503 when the `app_users`
query is invalid against the live schema, so Railway keeps the previous healthy deploy rather than
serving code that is ahead of its migration. On the domained service this is correct and it passed.

On `ai-sports-betting-backend` — the zombie service documented in Incident 39, whose database has no
app tables — the probe did not find drift. It found **no table at all**:

```text
[DB][probeAppUsersSchema] SCHEMA MISMATCH — the app_users query is invalid against the live schema.
Code deployed ahead of its migration? code=ER_NO_SUCH_TABLE
  message=Failed query: select `id`, `email`, ... from `app_users` where `app_users`.`id` = ? limit ?
[schema-gate] CRITICAL: app_users schema is behind the code — /health will report 503 so Railway
  keeps the previous healthy deploy.
[HEALTH_CHECK] GET /health | db.state=CLOSED dbOk=true schema=schema_mismatch
[HTTP_REQUEST] ← GET /health | status=503
Stopping Container
```

`ER_NO_SUCH_TABLE` is the zombie's normal steady state, not migration drift, so the gate produced a
false positive and Railway failed the deploy.

Two deployments FAILED on service `3528dc9f-a63b-45e9-94bb-6d1df25d6f3a`:

| Deployment | Commit | PR | Window |
|---|---|---|---|
| `19c67f72` | `9318bedde` | #392 (introduced the gate) | 22:56:01 → 23:01:26 |
| `96d256ce` | `2992b49e1` | #393 (inherited it; changed nothing on this path) | 23:11:40 → 23:17:00 |

**No customer impact.** The domained service `a46ea921` succeeded on every deploy in this window —
its database has `app_users`, so the gate passed. Only the domainless zombie failed. Verified via
Railway deployment history for both services.

Resolved by PR #394 (`8e03e2599`, deployment `bf328a88` SUCCESS at 23:19:44): the gate now scopes to
a missing COLUMN — real code-ahead-of-migration drift — rather than a missing TABLE.

### Why this was not caught before merge

This is gap **F7.6** from `os/audits/gap-map.md`, filed 2026-08-05, biting for the first time:

> One merge = two production deploys. Both Railway services deploy the same repo and branch; the
> second has no domain, no smoke test, and no push-triggered health check. An action fires on every
> merge but its result is never observed by any repo-owned check.

`deploy-smoke.yml` probes the domained origin only, so a backend-only failure is invisible to CI.
It was noticed here only because a human read the Railway dashboard.

### Follow-up (not done here)

- The zombie backend still deploys on every merge and still has no repo-owned health check. Either
  give it one or stop deploying it. Incident 39 remains OPEN and is the same underlying condition.
- Any future startup gate must be tested against BOTH services, because they have different
  databases. A gate that is correct for the domained service can fail-closed on the zombie.

## Incident 63 — 2026-08-06 — The MLB auto-recalibration has patched nothing for 89 days, and logged success each time

**Severity:** HIGH (silent) · **Customer impact:** none observed · **Found by:** ISSUE-012 Phase 1 measurement

### What was believed

`server/mlbDriftDetector.ts` calls `migrateCalibrationConstants()` on a monthly schedule, which
rewrites `server/MLBAIModel.py` in place with no proposal record, no approver and no version stamp.
The Stage 1 audit named it the D15 #2 exemplar (gap F4.1, HIGH), and ISSUE-012 was re-scoped on
2026-08-05 to say the self-patch **"fires, succeeds, and takes effect live and ungated"** — a live
ungated writer whose every change is then erased by the next of ~13 daily deploys.

### What is actually true

**The patcher matches 0 of 9 constants and has done since 2026-05-09.**

`patchConstant()` builds the regex ``new RegExp(`('${key}':\s*)([-\d.]+)(,\s*#[^\n]*)`)`` — it
requires **single-quoted** keys. `MLBAIModel.py` has used **double quotes** since commit
`4c27b4f5f` ("Enterprise modernization", 2026-05-09, authored by Manus), which reformatted the
`EMPIRICAL_PRIORS` block:

```
-    'nrfi_rate':          0.5093,   # NRFI rate (2026 live: 0.5093, 3yr: 0.5150)
+    "nrfi_rate": 0.5093,  # NRFI rate (2026 live: 0.5093, 3yr: 0.5150)
```

Measured across all 22 revisions of the file: single-quoted and matchable in 9 of them
(2026-04-14 → 2026-04-30), double-quoted and unmatchable in every revision since. The file today
holds **130 double-quoted numeric keys and 0 single-quoted**.

So each scheduled recalibration: runs the backtest, computes new constants, logs
`Could not find constant '<key>'` nine times, rewrites the file with **only the header comment
changed**, and returns `constantsPatched: 0`.

### Why it is HIGH anyway

1. **The learning loop is dead and reports success.** `mlb_model_learning_log` receives a row with
   `accuracyAfter: <newly computed f5 share>` — which reads as "the model now performs at this
   level". The model still uses the constant it had. The record and the runtime disagree, which is
   D15 #9 inside the loop D16 criterion 3 depends on. `constantsPatched: 0` is recorded honestly,
   but nothing reads it and no surface exposes the table.
2. **The risk inverts.** The ungated-writer danger was never realised — no constant has been
   auto-changed in 89 days. But *repairing the regex* would wake a dormant ungated writer serving
   customers. A well-meaning "fix the quoting" commit would have been the actual incident.
3. **A formatting pass silently disabled a production control path**, and nothing noticed for three
   months. No test covered the patcher against the real file.

### What changed

The gate landed first, deliberately, before any repair:

- `server/mlbRecalibrationGate.ts` adopted (propose by default; self-approval forbidden; owner-only;
  rationale required; promotion blocked while leakage-quarantined rows exist).
- `applyOrPropose()` extracted in `mlbDriftDetector.ts` with an **injectable patcher**, so the
  property "the patcher is never called on the default path" is testable rather than asserted.
  `MLB_RECAL_MODE=autopatch` remains as a CRITICAL-logged emergency override.
- The learning log now records a gate envelope (`PROPOSED` / `APPLIED` + `autopatchOverride`).
- `server/driftDetectorGate.test.ts` pins the Phase 1 finding: if the patcher's regex ever matches
  the model file again, the test **fails on purpose** — the repair must be a reviewed change made
  alongside the gate, never a drive-by fix.

### Not yet done

- The `listRecalibrationProposals` / `decideRecalibration` tRPC procedures. The gate module's
  functions exist and are tested; nothing surfaces them yet, so a proposal currently has no UI to be
  decided in. **A proposal nobody can see is a queue, not a gate** — tracked in ISSUE-012.
- `modelVersion` + `paramsHash` on every projection, so *"did the last recalibration help?"* becomes
  answerable. Untouched; it spans the whole projection path.
- The regex repair itself, which is now deliberately blocked by a test.

### Lesson

A formatting change broke a control path, and every subsequent run reported success. Filed as
`os/memory/lessons/a-formatter-can-disable-a-control-path.md`.
