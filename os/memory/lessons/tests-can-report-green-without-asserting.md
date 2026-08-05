# A green test suite hides two failure classes no allowlist can see: unmatched globs and vacuous passes

**Verified 2026-08-05.**

1. `client/src/pages/admin/DeviceActivityPanel.test.tsx` **matches no vitest include glob and has
   never executed.** Not a skip, not a failure — invisible.
2. `server/kenpomCredentials.test.ts` `return`s early when `KENPOM_*` is absent, so it **reports
   GREEN with zero assertions on every CI run** — and is counted among the 3,778 passing cases. It
   routes around the environment allowlist by using `return` instead of `it.skip`.

The repo's environment-failure allowlist is genuinely good — machine-enforced, detects stale entries,
treats collection errors as fatal. Neither defect is a *skip* or a *failure*, so **no allowlist
mechanism can see either one.**

**Why it mattered:** this repo already knows how to defend against exactly this class — it wrote
`server/dbSuiteRegistration.test.ts` specifically to break when a DB suite is half-wired. The
defence just was not generalised.

**How to apply:**
- Add the two analogous meta-checks: "every test file matches an include glob" and "every test case
  executed at least one assertion."
- Use `it.skip` with a declared reason, never a bare `return`, when gating on environment.
- Green is not evidence. Count executed assertions, not passing cases.

Related: [[gates-must-be-required-to-be-gates]].
