# Incidents

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
