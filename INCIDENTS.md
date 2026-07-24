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
