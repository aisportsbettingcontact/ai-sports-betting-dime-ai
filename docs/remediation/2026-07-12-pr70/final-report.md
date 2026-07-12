# PR #70 remediation — final report (2026-07-12)

Branch: `remediation/pr70-hotfix`. Base at completion: origin/main `23237394` (merged in;
zero product behavior from main was reverted). Every status below uses the mandated
vocabulary and traces to a command output; the raw evidence index is at the end.

## Finding resolution ledger

| # | Finding | Reproduction | Fix | Status |
|---|---|---|---|---|
| 1 | Unauthorized landing: self-declared unlandable WIP merged to auto-deploy main (PR #70, empty body, 4 minutes create-to-merge, no branch protection) | PR timeline + protection API 404 + prod asset hash = local 30cdef2a build | Branch protection live (4 required strict checks, PRs required); `.github/pull_request_template.md` makes an empty-body merge fail review by construction | VERIFIED_DEFECT, governance remediated |
| 2 | Chat remount at 768px destroys conversation, in-flight SSE stream, composer draft | e2e/chat-resize.spec.ts FAILS on baseline 30cdef2a ("ORIGINAL composer DOM node must stay connected"), PASSES on fix | One route owner for /chat at every width (`isChatLocation` + DimeAppShell `mode` prop); root element fork removed (unconditional `dc-shell-stack` wrapper). Two independent remount causes found and fixed | VERIFIED_FIXED |
| 3 | Splits auto-advance dead-coded by `if (initialDate) return` | Truth-table test red under old semantics (both mount paths always pass a date) | Explicit `SplitsDateSource` provenance (`url-explicit` vs `app-default`), carried across the canonical redirect via history state; `shouldAutoAdvance` truth table (6 rows) | VERIFIED_FIXED |
| 4 | Reduced-motion edge swipe freezes the main pane behind an invisible drawer | Baseline e2e FAIL log (main pane inert while drawer invisible) | No gesture claim under reduce; `resolveDrawerAccessibility` makes `inert` conditional on actual visibility; button/keyboard open instant, Escape closes, focus returns. 2 e2e specs | VERIFIED_FIXED |
| 5 | /chat bundle: framer-motion (+40,360B gzip) on the critical path vs +5,120B budget | Measured 202,323 (7dcbd369) -> 246,834/251,122 (with motion) bytes gzip | framer-motion fully off the /chat path (springSettle.ts closed-form critically-damped spring, CSS transitions, rAF drawer). vendor-motion chunks in path: 0; negative control (re-import) fails the gate at 251,155B | VERIFIED_FIXED, with disclosed residual: final path = 211,525B = +9,202B vs old baseline, +3,319B over the original budget at re-baseline time; cause decomposed inside bundle-budget.json (mount-stability shell chrome + pre-existing entry growth), owner-reviewable |
| 6 | Environment-failure allowlist consumed by nothing | grep: zero consumers | scripts/check-environment-failures.mjs (local/ci profiles, stale-entry + passes-while-env-absent detection), wired as `test:gated:local`/`test:gated:ci`; caught a real regression during development | VERIFIED_FIXED |
| 7 | Preview scanner false confidence (live prod bundle contained `set("preview","1")` while scanner reported PASS) | Live-bundle token scan | Activation canary `__DIME_PREVIEW_GATE_ACTIVE__` + compile-time kill switch in previewGate.ts; scanner decodes source maps, separates load-bearing vs advisory tokens; wired into `pnpm build` and CI. 4-iteration negative-control history, final iteration proves exit 1 | VERIFIED_FIXED |
| 8 | Tautological/weak tests (`[pane==="chat", pane!=="chat"]` length-1 assertion; decorative width parametrization) | Tautology passes any source | Rewritten as verbatim pins of the complementary pane-exposure derivations; two recorded mutation checks (forked derivation; RequireAuth stripped from splits target) each fail the new suites | VERIFIED_FIXED |
| 9 | Playwright hygiene: restored matrix.js contradicting its own audit appendix | Blob-identity vs archived copy | Deleted; `.playwright-cli/` ignored; appendix erratum appended | VERIFIED_FIXED |
| 10 | 42 DB assertions execute nowhere (suites skipIf(IS_CI), no DATABASE_URL secret — repo has exactly 7 secrets, none of the documented set) | Secrets API + skip-guard reading | db-tests CI job (mysql:8 service container, schema via `drizzle-kit push --force`, `--no-file-parallelism`, `DB_TESTS=1`) + scripts/test-db-local.sh (loopback-only safety) | VERIFIED_FIXED: first green execution in history on PR #84 (48/48 passed, run 29195327415). INCIDENTS.md entry RESOLVED with that run as evidence. Getting there surfaced findings 11 and 12 below |

## Upstream churn absorbed during remediation

Main advanced three times while this branch existed (30cdef2a -> 2e6bbbf1 -> 23237394,
PRs #71-#81). The branch was rebased once (zero conflicts) and merged once (12 conflict
hunks, all in files both sides rewrote). The merge preserved main's product behavior in
full — owner-only chatAccess gate, coming-soon state, real sidebar identity, live
account menu — while keeping the remediation architecture: no framer-motion on the
/chat path, one stable chat owner, no root-type fork (main's copy still contained
`if (!shell) return chatPane;` and the standalone DimeChatRoute; neither was
reintroduced). One test updated honestly: comingSoonGate.test.ts pinned the removed
standalone call site; the DEV-gating contract it proves is unchanged and still asserted.

## Finding 11 (NEW, discovered by this branch's own CI): migration history is not replayable

The db-tests job's first run (PR #84) failed at `drizzle-kit migrate` on a fresh
mysql:8 database: `Table 'wc2026_matches' already exists` — migrations
`drizzle/0097_happy_yellow_claw.sql` and `drizzle/0104_outgoing_night_thrasher.sql`
both CREATE that table. No environment had ever replayed the history from scratch
(production's db-push.yml applies increments to the long-lived database), so the
defect was invisible until an isolated database existed. Status: VERIFIED_DEFECT,
worked around — the db-tests job and scripts/test-db-local.sh now provision the test
database from the current TS schema (`drizzle-kit push --force`), which matches what
production effectively runs. The history files themselves are production's deployment
path and were deliberately NOT edited on this branch; repairing them (e.g., making
0104 idempotent) is an owner decision. Until then, a from-scratch environment cannot
be built via `migrate`.

## Finding 12 (NEW, discovered by the db-tests job's second run): the DB suites are not parallel-safe

With provisioning fixed, 47/48 assertions passed on their first-ever execution; the
one failure (register `[ER-1]` expected CONFLICT, received "Session invalidated",
jwt.tv=1 vs db.tv=2) was cross-suite interference, not a product bug:
`tokenVersion.db.test.ts` ran `incrementAllTokenVersions` ("affected 17 users") in a
parallel vitest worker between `[ER-1]`'s two calls, invalidating the register
suite's live owner session. Suites sharing one database where one performs a global
mutation must run sequentially. Status: VERIFIED_DEFECT (in the suites' execution
model, latent since they were written), fixed — `--no-file-parallelism` in the CI
job and scripts/test-db-local.sh, assertions untouched. Third run: 48/48 green
(run 29195327415).

## Final verification matrix (clean checkout of a76b6841, frozen install)

| Gate | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | JS install complete; exit 1 from the repo's own pip postinstall on PEP-668 macOS (pre-existing main behavior, Railway installs python via apt) — excused with evidence |
| Types | `tsc --noEmit` | clean |
| Unit/contract | `pnpm run test:gated:local` | 1561 passed / 59 failed, all 59 environment-bound and excused (17 credential + 42 DB) / 0 skipped / 0 unexplained — gate exit 0 |
| Build + preview scan | `pnpm run build` | exit 0; scanner PASS (93 files, source maps included) |
| Bundle | `node scripts/check-bundle-budget.mjs dist/public` | PASS: 211,525B vs 215,882B ceiling; vendor-motion in path: 0 |
| Runtime | `playwright test` (3 specs) | 3/3 passed |
| Production (read-only) | `node scripts/smoke-deploy.mjs https://aisportsbettingmodels.com` | 8/8 |

## Independent verification

An independent verifier subagent (not an implementer) reviewed the whole branch diff
adversarially before push. Verdict: SHIP-WITH-NOTES — 0 Critical, 1 Important, 7 Minor;
no forbidden test weakening anywhere in the diff; SSE core byte-identical to
origin/main; main's product behavior and the remediation architecture both confirmed
preserved through the merge.

- The Important finding (the environment gate passed test-file collection errors —
  broken imports produce a failed file with zero assertionResults, which the evaluator
  never inspected while `vitest run || true` swallows the exit code) was fixed before
  push with reproduce-first evidence: 3 new fixture tests fail against the old script,
  11/11 pass with the fix (`fix(gate): collection errors are never excusable...`).
- Minor findings accepted as documented limitations (not fixed here):
  1. expectedCiSkips matches per-file, so a future `.skip` inside an already-listed
     file passes CI silently; tighten to per-test ids if skips proliferate.
  2. The preview canary is a `console.debug` literal — enabling esbuild
     `drop_console`/`drop: ['console']` in a future vite config would delete it and
     blind the scanner's primary token. Do not enable those options without moving the
     canary.
  3. The bundle walker seeds `DimeChat-*`/`DimeAppShell-*` chunk names and does not
     walk dynamic imports; re-lazifying DimeChatPage under a new chunk name would
     require adding its pattern (a missing chunk exits 2, which fails CI — the safe
     direction).
  4. Bundle-decomposition byte attributions in the Task 4 report were reproduced for
     HEAD but not re-derived from a fresh 7dcbd369 rebuild by the verifier
     (CANNOT-VERIFY, informational only — the enforced numbers are the measured ones).
- The verifier's second condition — explicit owner ratification of the bundle
  re-baseline (+9,202B at HEAD vs the pre-PR70 baseline, against the original +5,120B
  budget) — is carried on the PR body as an open owner decision.

## Governance

- Branch protection on main: installed this session (was 404), observed gating every
  subsequent merge (#71-#81). Required strict checks: Security Audit, TypeScript Check,
  Vitest, Secret Scan.
- Post-merge follow-up (documented, NOT executed): add "DB Tests" and
  "Build & Preview Gate" to required checks once those names exist on a run.
- This PR is a DRAFT. Merging requires explicit owner authorization; nothing in this
  remediation had or exercised merge/deploy authority.

## Evidence index (session scratchpad `evidence/`)

branch-protection-before/after.json, protection-payload.json,
e2e-chat-resize-baseline-FAIL.log, e2e-chat-resize-remediation-PASS.log,
e2e-drawer-reduced-motion-baseline-FAIL.log, scan-negative-control{1-4}-t7.log,
bundle-negative-control-{build,FAIL}.log, parity/{baseline,remediation}/*.png (3 pairs),
mutation-heading-exposure-FAIL.log, mutation-splits-render-target-FAIL.log,
final-matrix-{install,gated-local,build,e2e}.log, review-package-final.txt,
final-verifier-report.md. In-repo: the plan, claim ledger, skill ledger, and this report
under docs/remediation/2026-07-12-pr70/ and docs/superpowers/plans/.
