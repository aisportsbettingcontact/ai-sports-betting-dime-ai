# Incidents

## 2026-07-17 — Recurring ERR_HTTP_HEADERS_SENT / restart loop after slow /api/trpc requests

Status: FIX SHIPPED (root-cause mechanism confirmed by local reproduction; one
runtime evidence item still owed from Railway logs — see "Remaining evidence").

Production symptom (deployments carrying PR #124/#125): `ERR_HTTP_HEADERS_SENT`,
`ERR_STREAM_WRITE_AFTER_END`, fatal process termination, automatic Railway
restart; several failures followed `GET /api/trpc/games.list` responses logged
as 304/200.

Confirmed mechanism (reproduced against the installed @trpc/server 11.11.0 +
express 4.21.2 + compression 1.8.1 on Node 22, mirroring the production
middleware order):

1. The 60s request-timeout middleware in `server/_core/index.ts` and the tRPC
   adapter BOTH owned the response. Any tRPC request slower than 60s (cold
   TiDB, pool-acquire queueing — `createPool` has `connectionLimit: 20`,
   `queueLimit: 100` and no acquire timeout) got a body written by the timeout
   middleware; when the procedure later resolved, the adapter's
   `writeResponse()` called `res.setHeader()` on the already-sent response →
   `ERR_HTTP_HEADERS_SENT` (surfaced through tRPC's `internal_exceptionHandler`,
   which then calls `res.end()` on the ended stream).
2. The middleware's `isTrpc` check read `req.path` at timer-fire time. Inside
   the `app.use("/api/trpc", ...)` mount Express strips the mount prefix, so
   `isTrpc` evaluated FALSE for every in-flight tRPC request — the "tRPC
   envelope" branch was unreachable and clients received a bare
   `503 {"error":"Request timeout"}` (the historical "Server temporarily
   unavailable" toast).
3. The envelope/503 was written via `res.json()`, which stamps an ETag on a
   constant error body — conditional-request (304) bait for any client that
   cached it.
4. `server/_core/fatalErrorHandler.ts` converts any uncaughtException into
   `process.exit(1)`; on Node 22, write-after-end on an HTTP ServerResponse is
   silent, but the same operation on a plain stream.Writable/zlib stream DOES
   escalate to uncaughtException — the exact writer that produced the fatal
   `ERR_STREAM_WRITE_AFTER_END` is still being pinned (leading candidates:
   compressed SSE stream on the Dime chat routes, child-process stdin for the
   Python model runners).

Fix (single-writer rule), shipped on `claude/ai-sports-betting-dime-ai-vrkdx7`:

- `server/_core/trpc.ts`: procedure-level timeout (`procedureTimeout`, 55s,
  `TRPCError TIMEOUT`) applied to all four base procedures — the tRPC adapter
  is now the ONLY writer on `/api/trpc`, and timeouts produce a well-formed
  408 envelope the client already maps (errorUtils CHECK 6 keys on
  "Request timed out").
- `server/_core/requestTimeout.ts` (new): the express-level 60s guard now
  covers non-tRPC routes only, detects tRPC mount-safely via
  `req.originalUrl`, and writes its 503 with raw `writeHead`/`end` +
  `Cache-Control: no-store` — no ETag, no Express freshness/304 machinery.
- `server/_core/index.ts`: response-stream `error` listener (always logged as
  `[RES_STREAM_ERROR]`) so a rogue second writer can never escalate to
  uncaughtException → `exit(1)` again.
- Regression suite `server/_core/requestTimeout.test.ts` (6 tests) pins the
  single-writer invariants and reproduces the legacy collision ([SW-4]).

Remaining evidence owed (owner/Railway):

- The `[FATAL] Uncaught exception — shutting down safely <error>` log lines
  from the crash windows: the attached error object identifies the exact
  writer behind the fatal `ERR_STREAM_WRITE_AFTER_END`.
- Confirmation that crash windows correlate with `[TIMEOUT] Request timed out`
  entries (the >60s precondition).

## 2026-07-11 — Real-database Vitest suites cannot run locally

Status: OPEN (pre-existing environment/integration failure)

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
