# PR #70 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every reproduced defect PR #70 landed on `main` (chat state loss at 768px, dead splits auto-advance, reduced-motion freeze, +46.61 KiB bundle breach, unenforced gates, tautological tests, repo hygiene, untruthful docs) on branch `remediation/pr70-hotfix`, replacing honor-system documentation with executable gates, without regressing PR #70's verified successes.

**Architecture:** Minimal-diff hotfix per defect domain. One stable mounted owner for chat across viewport boundaries; explicit date provenance for splits; honest accessibility states for the drawer; framer-motion off the `/chat` critical path (CSS + hand-rolled settle per Apple-design guidance); test gates become scripts wired into CI + branch protection.

**Tech Stack:** React 19, Wouter, tRPC, Vitest 2 (node env), Playwright 1.58 (already a dep), vite 7, pnpm.

## Global Constraints (verbatim from spec/brand law)

- Base: `30cdef2a` (origin/main). Branch: `remediation/pr70-hotfix`. Worktree: `<scratchpad>/remediation`. NEVER touch `/Users/danielwalker/Developer/ai-sports-betting-dime-ai` (owner's agent working there).
- No merge, no deploy, no DNS, no production DB writes, no revert of PR #70, no direct commits to main.
- Bundle budget: `/chat` critical path ≤ baseline(7dcbd369) + 5 KiB gzip. Do not change the budget; do not hide bytes by renaming chunks.
- Brand law (design-system/dime-ai/MASTER.md): one accent mint #45E0A8 (#0FA36B on light), Familjen Grotesk + IBM Plex Mono, 160ms standard motion, no gradients/purple/neon-green/gold.
- Mobile (<768px) behavior preserved except where a reproduced defect requires change.
- Every fix: reproduce first (test fails on baseline), minimal change, regression test with negative control, evidence logged to `<scratchpad>/evidence/`.
- Do not weaken/delete tests, broaden allowlists, or skip suites to go green.
- Status vocabulary for every finding: VERIFIED_DEFECT / VERIFIED_FIXED / VERIFIED_EXISTING_SUCCESS / FALSE_OR_OBSOLETE_REPORT / PARTIALLY_CORRECT / BLOCKED_WITH_EVIDENCE / UNRESOLVED.

---

### Task 1 (Track B): Betting Splits date provenance + auto-advance restoration

**Files:**
- Modify: `client/src/pages/dime-shell/splitsDateState.ts` (add pure `shouldAutoAdvance` + `SplitsDateSource` type)
- Modify: `client/src/pages/dime-shell/splitsDateState.test.ts` (truth-table incl. negative control)
- Modify: `client/src/pages/BettingSplits.tsx` (replace `if (initialDate) return;` at ~L364 with provenance check; accept `initialDateSource` prop)
- Modify: `client/src/pages/dime-shell/DimeAppShell.tsx` (thread `initialDateSource`: `'url-explicit'` when URL had a date segment, `'app-default'` for `defaultSplitsState()`)
- Modify: `client/src/App.tsx` `StandaloneSplitsRoute` (same threading: bare `/betting-splits` → `'app-default'`, dated deep link → `'url-explicit'`)

**Interfaces:**
- Produces: `type SplitsDateSource = 'url-explicit' | 'app-default'`; `shouldAutoAdvance(args: { dateSource: SplitsDateSource; userSelected: boolean; hasGamesOnSelectedDate: boolean; datesLoaded: boolean; selectedDateBeforeEffectiveWindow: boolean }): boolean`
- Contract: auto-advance ONLY when `dateSource === 'app-default' && !userSelected && datesLoaded && !hasGamesOnSelectedDate && selectedDateBeforeEffectiveWindow`. Explicit URL dates and user selections are never overridden (documented product rule; matches design-system/dime-ai/pages/ai-model-projections.md contract).

**Steps:** write failing truth-table tests (must show old `if (initialDate)` semantics fail the app-default row) → implement pure fn → thread props → wire effect → all splits tests pass → commit `fix(splits): restore auto-advance via explicit date provenance`.

### Task 2 (Track A1): Chat mount stability across the 768px boundary

**Files:**
- Modify: `client/src/App.tsx` (route ownership: when `location` is the chat route at ANY width, or a shell-claimed product route at ≥768px, render ONE stable `<RequireAuth><DimeAppShell mode=.../></RequireAuth>` at the same tree position; `<768` non-chat routes keep the legacy `<Switch>` exactly as today)
- Modify: `client/src/pages/dime-shell/DimeAppShell.tsx` (new `mode: 'shell' | 'chat-only'`; `chat-only` renders `DimeChatPage` with no shell chrome, no lazy pane mounts, no URL-sync effects — presentation identical to today's mobile standalone chat)
- Modify: `client/src/pages/dime-shell/DimeAppShell.test.ts` (REMOVE tautological block at L141-146; replace with real assertions per Task 5)
- Create: `e2e/chat-resize.spec.ts`, `playwright.config.ts`, `package.json` script `test:e2e`
- Test (behavioral, must FAIL on baseline 30cdef2a): Playwright vs `vite dev` + `/chat?preview=1`: type draft text → grab composer element handle → resize 900→700→900 → assert (a) draft text preserved, (b) original composer DOM node still connected (same instance ⇒ no remount), (c) repeat ×5 across 767/768/769.

**Interfaces:**
- Consumes: `useDimeShellViewport()`, `isDimeProductLocation()`, `allowsLocalDimePreview()` (unchanged).
- Produces: `DimeAppShellProps.mode`. Constraint: `DimeChatPage` element must occupy an identical React tree position in both modes (same parent chain) — that is the fix.

**Steps:** write Playwright spec → run against baseline, record FAIL evidence → implement → spec passes → run full existing shell/route unit tests → commit `fix(shell): keep one mounted chat owner across the 768px boundary`.

### Task 3 (Track A2): Reduced-motion drawer correctness

**Files:**
- Modify: `client/src/pages/dime-chat/DimeChatPage.tsx` (`moveDrawerGesture` ~L972-1008; modal-semantics effect ~L889-936)
- Modify: `client/src/pages/dime-chat/drawerMotion.ts` + `.test.ts` (extract pure `resolveDrawerAccessibility({open, moving, visibleFraction, reduceMotion}) → {mainInert}`)
- Extend: `e2e/chat-resize.spec.ts` with reduced-motion scenario (`emulateMedia({reducedMotion:'reduce'})`, 800px, edge-swipe drag → main pane must never be `inert` while drawer invisible; drawer button open → instant/160ms-fade visible state; Escape closes; focus returns to trigger).

**Model chosen (mandate option 1):** under `prefers-reduced-motion`, edge-swipe does not claim a progressive gesture; the drawer opens/closes via button/keyboard with immediate state + 160ms opacity fade; `inert` applies only when the drawer is actually visible-open. Never trap focus in an invisible region.

**Steps:** failing unit truth-table for `resolveDrawerAccessibility` (baseline semantics = inert while invisible ⇒ test fails) → failing e2e → implement → pass → commit `fix(a11y): reduced-motion drawer never freezes the main pane`.

### Task 4 (Track A3): Bundle budget — framer-motion off the /chat critical path

**Files:**
- Modify: `client/src/pages/dime-chat/DimeChatPage.tsx` (remove top-level `framer-motion` import; replace `m.*`/`AnimatePresence`/motion values: FLIP/ghost/menu → restore the 160ms CSS transitions deleted by PR #70 — recover exact rules from `git show 7dcbd369:client/src/pages/dime-chat/conversation.css`; drawer drag → pointer events + direct transform writes on rAF using existing `drawerMotion.ts` helpers; settle → hand-rolled critically-damped spring w/ velocity handoff per Apple-design §4-6, damping 1.0 default / 0.8 drawer, ~160ms-equivalent response)
- Create: `client/src/lib/springSettle.ts` + `springSettle.test.ts` (pure integrator: `stepSpring(state, target, dt)`; deterministic tests incl. velocity carry and interruption re-target)
- Modify: `client/src/pages/dime-chat/conversation.css`, `client/src/pages/dime-shell/DimeAppShell.tsx` (if `m.section` used there), `vite.config.ts` (`build.manifest: true`)
- Create: `scripts/check-bundle-budget.mjs` (walk manifest static-import graph for entry + chat route chunk; sum gzip; compare to `bundle-budget.json` baseline; exit 1 over budget; write machine-readable report)
- Create: `bundle-budget.json` (baseline numbers measured from a clean build of `7dcbd369` — measure once in a temp worktree, record command + output in evidence)
- Modify: `package.json` (script `check:bundle`), `.github/workflows/ci.yml` deferred to Task 7 (single CI owner)

**Acceptance:** `vendor-motion` absent from `/chat` critical path; delta ≤ +5120 bytes gzip vs baseline; `.dc-pressable` corrected 120ms→160ms (brand law); reduced-motion honored; drawer feel preserved (interruptible, velocity handoff, rubber-band retained). Negative control: temporarily re-add an eager `import "framer-motion"` → `check:bundle` must fail (record, then remove).

**Steps:** measure baseline(7dcbd369) + current(30cdef2a) → implement CSS/spring replacement → visual parity check at 160ms tokens → budget script green → negative control → commit `perf(chat): remove framer-motion from critical path; add enforced bundle budget`.

### Task 5 (Track A4): Replace tautological/weak tests

**Files:**
- Modify: `client/src/pages/dime-shell/DimeAppShell.test.ts` (delete `[pane==="chat", pane!=="chat"]` tautology; where runtime behavior is now covered by e2e, keep only compile-time contracts, AST-scoped via `ts.createSourceFile` if regex could false-pass; test names must state what is actually proven)
- Modify: `server/legacyRedirects.test.ts` (keep strengthened assertions; add AST-scoping only where a stray fragment could false-pass — do not broaden)
- Mutation checks (manual, recorded): break heading exposure in `DimeChatPage` → test must fail; break `StandaloneSplitsRoute` render target → redirect test must fail.

**Steps:** per file: demonstrate current test passes under an intentional contract break (evidence of weakness) → rewrite → show new test fails under same break → restore → commit `test(shell): replace tautological assertions with falsifiable contracts`.

### Task 6 (Track C): Executable environment-failure gate + ciSecrets strategy

**Files:**
- Create: `scripts/check-environment-failures.mjs` (input: vitest JSON reporter output; profiles: `--profile=local` — failures must be an exact subset of allowlist, allowlisted tests that PASS while their env var is absent → stale error; `--profile=ci` — allowlist not applied, any failure fails, unexpected skips fail; always emits `{passed, failed, skipped, notExecuted, environmentBound}` JSON report)
- Create: `scripts/__tests__/check-environment-failures.test.ts` + fixtures (canned vitest JSON: known allowlisted failure → pass; new failure → fail; stale entry → fail; functional regression mislabeled → fail; CI-skipped suite → fail in ci profile; allowlisted-begins-passing → fail)
- Modify: `vitest.environment-failure-allowlist.json` (add schema header: `{version, entries:[{file, test, requiredEnv}]}` — migrate 17 names, keyed to the env var whose absence explains them)
- Modify: `server/ciSecrets.test.ts` (investigate `describe.skipIf(IS_CI)`: flip to run in CI on push/PR-with-secrets; skip only for fork/dependabot contexts where secrets are structurally absent, with logged reason — decision recorded with ci.yml trigger evidence)
- Modify: `package.json` (`test:gated:local`, `test:gated:ci`)

**Steps:** fixtures first (failing) → implement checker → all fixture cases correct → run real `--profile=local` in worktree (must pass with current 12 env-bound files ⊆ allowlist, else reconcile allowlist honestly) → commit `test(gate): enforce environment-failure allowlist as executable check`.

### Task 7 (Track D): Preview verification hardening + CI/Docker wiring (single CI owner)

**Files:**
- Modify: `client/src/pages/dime-shell/previewGate.ts` (embed canary literal `"__DIME_PREVIEW_GATE__"` inside the DEV-only branch so any survival of the gate to production yields a minification-proof token)
- Modify: `scripts/verify-preview-production.mjs` (drop reliance on identifier names — keep as advisory; load-bearing tokens: `__DIME_PREVIEW_GATE__`, `preview=1`, `get("preview")`/`get('preview')`; also scan `.map` files when present; exportable `scanDist(dir)` for tests; exit codes: 0 clean, 1 leak, 2 usage error)
- Create: `scripts/__tests__/verify-preview-production.test.ts` (fixture dist dirs; NEGATIVE CONTROL: fixture containing canary → scanner must exit 1)
- Modify: `package.json` (`build` → `build:client && node scripts/verify-preview-production.mjs dist/public && build:server` so the Railway image build fails on leak), `Dockerfile` (no change needed if `pnpm run build` path covers it — verify), `.github/workflows/ci.yml` (add steps: preview verification, bundle budget from Task 4, env-failure gate from Task 6 — this task owns ALL ci.yml edits to avoid conflicts)
- Runtime check: after `vite build`, `vite preview` + Playwright: request `/chat?preview=1` unauthenticated → must NOT render shell panes (RequireAuth path) — add to `e2e/preview-production.spec.ts`.

**Steps:** scanner tests (failing) → refactor scanner → canary in previewGate → full build + scan pass → negative control recorded → wire package.json/Dockerfile/ci.yml → commit `build(security): enforce preview stripping in build pipeline with minification-proof canary`.

### Task 8 (Track F): Repository hygiene + documentation truth

**Files:**
- Delete: `.playwright-cli/matrix.js` (restored duplicate of archived copy — canonical stays at `docs/audits/2026-07-11-dime-shell/dime-shell-archived-matrix-34aff1f8.js`), `.playwright-cli/page-2026-07-12T03-01-46-681Z.yml` (0-byte artifact)
- Modify: `.gitignore` (ignore `.playwright-cli/` session artifacts)
- Modify: `dime-ai-sol-iteration.md` (append dated "2026-07-12 post-landing corrections" section: disposition contradiction — pushed/merged as PR #70 despite "do not push"; Home.tsx post-login change is behavioral, not reflow; DimeAppShell "13/13" claim corrected to source-shape checks; bundle-breach remediation state)
- Modify: `docs/audits/2026-07-11-dime-shell/dime-ai-sol-audit-appendix.md` (dated erratum: matrix.js WAS restored in `f3a1f67a`, contradicting §7)
- Modify: `INCIDENTS.md` (keep OPEN; append dated note: CI-with-secrets passes the 42 assertions (PR #70 run evidence); local isolated-DB reproduction still outstanding — see Task 9 status)
- Rule: never state a gate is enforced unless the executable config landed in Tasks 6/7.

**Steps:** each edit → cross-check statement against repo/git/GitHub state → commit `docs: correct contradicted claims; archive-only playwright matrix`.

### Task 9 (Track E): Isolated database strategy — expected BLOCKED on this machine

Docker absent (verified: `command not found`). Sub-steps: check for local MySQL (`mysql --version`, port 3306); if none: deliver `docker-compose.test.yml` + `scripts/test-db-setup.sh` (create ephemeral schema, run `drizzle-kit migrate`, seed, safety check: refuse if host not localhost/name not `dime_test`) + CI job using `mysql:8` service container, and mark the 42 local assertions `BLOCKED_WITH_EVIDENCE` with the exact commands the owner runs. Do NOT close INCIDENTS.md.

### Task 10 (Track G): Governance

- Confirm exact check names from `gh api repos/.../commits/30cdef2a/check-runs`.
- `gh api -X PUT .../branches/main/protection`: require PR before merge (`required_approving_review_count: 0` — solo-owner, no lockout), required status checks strict + exact names, block force-push/deletion, `enforce_admins: false` (documented owner recovery path). Capture protection JSON before and after.
- Create `.github/pull_request_template.md` with mandate's required fields.
- Commit template; protection is a repo setting (evidence-only).

### Task 11: Verification matrix, independent verifier, evidence package, draft PR

- Clean checkout of final SHA into a fresh temp dir → full matrix: pnpm frozen install, tsc, vitest via env-gate (local profile), build + preview scan + bundle budget, Playwright e2e suite, live read-only smoke (`scripts/smoke-deploy.mjs`), `git diff --stat` scope check, clean-worktree check.
- Dispatch INDEPENDENT verifier subagent (no implementation agent reused) with the evidence dir + branch → adversarial checklist from mandate.
- Assemble ledgers + reports; push branch (only if local gates green); open DRAFT PR with complete body; explicitly not authorized to merge.

## Risks / Unknowns
- Task 2's route-tree unification is the highest-risk change; mitigated by e2e negative-control-first and keeping `<768` non-chat routing untouched.
- framer-motion may be imported by other surfaces (verify with grep; if so, dependency stays, only chat path changes).
- Playwright browsers may need `npx playwright install chromium` (~1 network fetch) — record.
- Vitest JSON reporter shape (v2) to be confirmed against fixture before checker design hardens.
- LCP/INP/CLS on a production-like origin: not measurable representatively in this environment → will be reported PARTIALLY/BLOCKED with the exact profile needed.

## Out of scope
Revert of PR #70; visual redesign; mobile `<768` non-chat behavior; DNS/Railway config; merging/deploying; changing the +5 KiB budget; owner's local checkout.
