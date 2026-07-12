# PR #70 Claim Ledger — 2026-07-12

Evidence hierarchy: runtime behavior > executed tests > build artifacts > source > git/GitHub > CI records > docs.
Statuses: VERIFIED_DEFECT / VERIFIED_FIXED / VERIFIED_EXISTING_SUCCESS / FALSE_OR_OBSOLETE_REPORT / PARTIALLY_CORRECT / BLOCKED_WITH_EVIDENCE / UNRESOLVED.

Baseline facts (first-hand, 2026-07-12):
- origin/main = `30cdef2a` = PR #70 merge (parents `7dcbd369`, `f3a1f67a`). PR created 07:32:34Z, merged 07:36:24Z, body empty, checks green (TypeScript, Vitest, Security Audit, gitleaks).
- Branch protection on main: HTTP 404 "Branch not protected" (`gh api .../branches/main/protection`).
- Production (aisportsbettingmodels.com) serves `/assets/index-CvF4lLw2.js` — byte-name-identical to a clean local build of `30cdef2a` ⇒ production derives from PR #70. Smoke 8/8.
- Clean-worktree gates at 30cdef2a: `tsc --noEmit` exit 0; `vitest run` 1431 passed / 59 failed, all 59 in 12 env-bound files (no local DATABASE_URL/secrets); `vite build` + preview scan PASS; `vendor-motion-BNvCnfEm.js` = 40.87 KiB gzip.

| # | Claim | Source | Required evidence | Actual evidence | Status | Remediation |
|---|---|---|---|---|---|---|
| C1 | "work is **not landable**… shipment is blocked" yet it landed | dime-ai-sol-iteration.md:9,23 | git/GitHub state consistent with claim | Pushed & merged as PR #70; live in prod | VERIFIED_DEFECT (process) | Task 8 docs correction; Task 10 protection |
| C2 | "Do not push, merge… without new authorization" | iteration doc:674,690; commit 34aff1f8 msg | no push/merge occurred | push+self-merge 4 min, empty body | VERIFIED_DEFECT (process) | Task 10 |
| C3 | Chat cross-768 risk framed as "no live proof of console errors/leaks" | iteration doc §7.4 | runtime resize behavior | Source: two route trees ⇒ hard remount of DimeChatPage; full conversation+stream loss. Runtime repro pending Task 2 spec | PARTIALLY_CORRECT (understates: data loss, not hygiene) | Task 2 |
| C4 | BettingSplits changes preserve documented auto-advance | iteration doc §4.10 + code comment BettingSplits.tsx:361-363 | effect executes on some production path | `if (initialDate) return;` dead-codes effect on all mount paths (both sites always pass a date) | VERIFIED_DEFECT | Task 1 |
| C5 | Home.tsx changes "mechanical formatting/reflow… no new login behavior" | iteration doc:65,379 | diff shows no behavior change | New `resolvePostLoginPath` import + call sites change post-login landing (viewport-conditional) | FALSE_OR_OBSOLETE_REPORT (mischaracterized; change itself net-positive) | Task 8 docs |
| C6 | "DimeAppShell.test.ts — 13/13 pass — shell wiring, preview, headings, cleanup contracts" | iteration doc §7.1 | falsifiable assertions | L141-146 tautology `[pane==="chat",pane!=="chat"]`; file is source-regex only, no rendering | PARTIALLY_CORRECT (pass=true, proof=overstated) | Tasks 2,5 |
| C7 | "production build correctly strips the local preview capability" | iteration doc:21 | build scan + gate analysis | TRUE at 30cdef2a: compile-time `import.meta.env.DEV` threading verified; scan 0 tokens. BUT scanner unwired + 2/5 tokens minification-blind | VERIFIED_EXISTING_SUCCESS + VERIFIED_DEFECT (enforcement) | Task 7 |
| C8 | Allowlist makes "any future new failure… instantly visible" | audit appendix §8 | consumer exists | `grep -r` finds zero consumers; JSON is inert | VERIFIED_DEFECT | Task 6 |
| C9 | "`.playwright-cli/matrix.js` working-tree deletion remains untouched" | audit appendix §7 (×2) | file absent from push | Push adds it as `new file mode 100644`, blob-identical to archived copy, + 0-byte yml | VERIFIED_DEFECT (docs contradiction + hygiene) | Task 8 |
| C10 | +46.61 KiB gzip over +5 KiB budget, vendor-motion initial | iteration doc:611-613 | measured build | vendor-motion 40.87 KiB gz in /chat path (static import chain); magnitude corroborated | VERIFIED_DEFECT (and honest self-report) | Task 4 |
| C11 | breakpoints return-path validation rejects open redirects | iteration doc §4 | adversarial input table | `isSafeInternalReturnPath` rejects //, javascript:, backslash, control chars (test table verified) | VERIFIED_EXISTING_SUCCESS | protect w/ tests (Task 5 keeps) |
| C12 | Splits canonicalization centralized (one owner) | iteration doc | both call sites use same fn | App.tsx + DimeAppShell both call `canonicalBettingSplitsPath` | VERIFIED_EXISTING_SUCCESS | preserve |
| C13 | Server-date refresh never overwrites URL/user date | iteration doc | unit truth table | `resolveSplitsServerDate` verified | VERIFIED_EXISTING_SUCCESS | preserve |
| C14 | streamBatcher correct + perf win | iteration doc | unit tests + review | rAF coalescing verified; no drop/reorder; dispose cancels rAF | VERIFIED_EXISTING_SUCCESS | preserve |
| C15 | SSE streaming core preserved | CLAUDE.md constraint | review of diff | parse/abort/scroll-follow intact | VERIFIED_EXISTING_SUCCESS | preserve (Task 4 must not regress) |
| C16 | legacyRedirects.test.ts "two approved contract replacements" weaken nothing | iteration doc | old vs new assertions | strengthened (regex now ties route→target; negative control kept) | VERIFIED_EXISTING_SUCCESS | Task 5 may AST-scope |
| C17 | INCIDENTS.md 42 DB assertions: open local incident | INCIDENTS.md | CI + local runs | CI (with DATABASE_URL) green incl. those suites; locally 59 failures are env-bound; local isolated-DB repro outstanding | VERIFIED_EXISTING_SUCCESS (honest record; stays OPEN) | Task 9 |
| C18 | Reduced-motion drawer: no claim made in docs; defect found in review | review d3 | runtime/pure-fn repro | Source: `setDrawerOpen(true)` unconditional; visual updates gated `!reduceMotion`; `main.inert = drawerOpen` unconditional ⇒ frozen invisible state | VERIFIED_DEFECT (pending runtime confirm in Task 3) | Task 3 |
| C19 | `.dc-pressable` 120ms vs 160ms brand law | review d3 vs MASTER.md:95 | css source | confirmed 120ms in conversation.css | VERIFIED_DEFECT (minor) | Task 4 |
| C20 | ciSecrets coverage exists in CI | implied by test name | CI log | `describe.skipIf(IS_CI)` ⇒ 5 tests skipped in CI (PR #70 log) | VERIFIED_DEFECT (accidental gap) | Task 6 |
| C21 | BetTracker preview never fires authed queries | iteration doc:351 | query gating audit | 5/5 queries gated by `canLoadProtectedData`; one polling effect still reads spoofable `canAccess` (currently inert) | PARTIALLY_CORRECT | Task 5 defense-in-depth optional |
