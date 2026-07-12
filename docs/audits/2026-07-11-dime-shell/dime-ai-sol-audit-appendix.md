# Dime AI Sol Audit Appendix: Code-Verification Evidence Bundle

- **Purpose:** convert the narrative handoff in `dime-ai-sol-iteration.md` into the code-level evidence package requested by Claude Code Fable 5
- **Repository:** `/Users/danielwalker/Developer/ai-sports-betting-dime-ai`
- **Base commit:** `7dcbd369371a315169e3eea58197badc14d1640d`
- **Local checkpoint / current HEAD:** `34aff1f8e8ac8310061dea33a06c2ec2bf1cb0c0`
- **Branch:** `local/checkpoint-shell-wip`
- **Evidence snapshot:** current working tree on 2026-07-11 in `America/Los_Angeles`
- **Scope boundary:** Dime Chat, unified tablet/desktop shell, route/date/auth seams, their tests, and audit evidence. Unrelated skill/plugin state is excluded.

---

## 1. Direct answer: was every requested item already in the thesis?

No. The thesis accurately explains the implementation and cites the important code, but it did not carry every raw artifact Fable needs for an independent code verdict. The following matrix distinguishes narrative coverage from code-verification coverage.

| Fable request | Coverage in `dime-ai-sol-iteration.md` | What was missing | Evidence supplied by this appendix | Final status |
|---|---|---|---|---|
| Tier 1.1 — 70-line instruction addendum | Requirements are reflected throughout, but the addendum is not reproduced | Authoritative verbatim instruction payload | `dime-sol-recovery-instruction-addendum.txt` | **VERIFIED** |
| Tier 1.2 — full 32-file base-to-current scope diff | §2.4 and §4 describe changes; §8 describes boundaries | Actual implementation hunks | `dime-shell-scope.patch` | **VERIFIED** |
| Tier 1.3 — four current test files | §4 and §7 summarize contracts and pass counts | Direct source-level grading surface and immutable hashes | Current test files plus the ledger in §4 below | **VERIFIED** |
| Tier 2.4 — `manualChunks`, `drawerMotion`, and critical import path | §3.3 and §7.3 identify Motion as the bundle blocker | Exact static import chain and why chunk naming does not defer it | §5 | **VERIFIED diagnosis; remediation NOT IMPLEMENTED** |
| Tier 2.5 — archived Playwright matrix | §7.4 lists blocked checks; §8 gives a recovery command | Harness source and requirement-by-requirement coverage grade | `dime-shell-archived-matrix-34aff1f8.js` and §6 | **VERIFIED; existing harness covers 0/4 new live gates** |
| Tier 3.6 — incident ledger and environment allowlist | §4.17 and §7.1 summarize the 42 + 17 split | Full entries and hashes for spot-checking | Both files are included in the 32-file patch and linked in §7 | **VERIFIED** |
| Tier 3.7 — original named-file plan | §2 and §8 discuss scope, not the original plan text | Original expected-files section and precise drift comparison | `dime-shell-original-named-plan.md` and §8 | **VERIFIED from the local Codex session transcript** |

The correct conclusion is therefore: the original thesis is an accurate orientation document, but it is not by itself the complete code-audit package. This appendix and its companion artifacts close that evidence gap.

---

## 2. Review bundle and recommended order

Fable should review these files in this order:

1. [`dime-sol-recovery-instruction-addendum.txt`](./dime-sol-recovery-instruction-addendum.txt) — the binding recovery rulings and evidence demands.
2. [`dime-shell-scope.patch`](./dime-shell-scope.patch) — every implementation and audit hunk across the reconstructed 32-file scope.
3. The four current test files listed in §4 — direct grading of rigor rather than reliance on pass counts.
4. [`vite.config.ts`](../../../vite.config.ts), [`drawerMotion.ts`](../../../client/src/pages/dime-chat/drawerMotion.ts), [`DimeChatPage.tsx`](../../../client/src/pages/dime-chat/DimeChatPage.tsx), and [`DimeAppShell.tsx`](../../../client/src/pages/dime-shell/DimeAppShell.tsx) — bundle-blocker design surface.
5. [`dime-shell-archived-matrix-34aff1f8.js`](./dime-shell-archived-matrix-34aff1f8.js) — checkpoint-exact archived harness source.
6. [`INCIDENTS.md`](../../../INCIDENTS.md) and [`vitest.environment-failure-allowlist.json`](../../../vitest.environment-failure-allowlist.json) — exact failure ledgers.
7. [`dime-shell-original-named-plan.md`](./dime-shell-original-named-plan.md) — recovered original plan and expected-files list.
8. [`dime-ai-sol-iteration.md`](../../../dime-ai-sol-iteration.md) — architectural thesis and overall handoff context.

### 2.1 Artifact integrity ledger

| Artifact | Lines | Bytes | SHA-256 |
|---|---:|---:|---|
| `dime-shell-scope.patch` | 4,613 | 187,915 | `2e49a9d25f5871c55b542de174ad46fb11163ff38c4897c693f02eac4f66a1d2` |
| `dime-sol-recovery-instruction-addendum.txt` | 71 | 10,496 | `3b924cf4da5249fee954a01c52fc9a1a3f424ae734aa78213779ecb2efee5c4a` |
| `dime-shell-original-named-plan.md` | 258 | 14,917 | `c676a33e54da883e20503eaa99319f250b1cab3f263c3232486dc3e5f600a41d` |
| `dime-shell-archived-matrix-34aff1f8.js` | 220 | 11,112 | `f64f0f004b1cd96ef2eb74d54260154f2fcbaf5842bd5f404384bec172738f96` |

The authoritative addendum attachment is `/Users/danielwalker/.codex/attachments/32baf655-2f7d-4133-a0f3-c6f89f085ee2/pasted-text.txt`. It contains 71 logical lines but no terminal newline, so `wc -l` reports 70. Its source SHA-256 is `cf2a7ee62094f4032d24a695deb130ea79f9f372c7ddab56ae8d53423fdb49aa`. The repository copy preserves all logical content and adds one conventional terminal newline.

The original plan was recovered from `/Users/danielwalker/.codex/sessions/2026/07/11/rollout-2026-07-11T21-03-11-019f547e-4cd6-7c93-95f8-7c8afa678a68.jsonl`, event line 384, timestamp `2026-07-12T04:03:11.354Z`. Its expected-files section is preserved at `dime-shell-original-named-plan.md:204-220`.

The recovered plan and generated scope patch are hash-frozen raw evidence. They intentionally preserve source whitespace, so a whole-bundle `git diff --check` reports those evidence bytes. The implementation-only diff check is clean. Do not normalize either raw artifact merely to silence that diagnostic; doing so would invalidate the frozen hashes and make the supplied patch differ from the audited snapshot.

---

## 3. Tier 1.1 — authoritative instruction addendum

The raw addendum is now locally reviewable at `dime-sol-recovery-instruction-addendum.txt`. Its binding structure is:

| Logical lines | Authority |
|---:|---|
| 13-15 | Recovery-session status and evidence-before-status rule |
| 17-21 | Two rulings: narrow legacy-test authority and browser remains BLOCKED |
| 23-27 | Gate 1 normalized proof for delete/recreate repairs |
| 29-31 | Gate 2 six-route Splits convergence on standalone and shell owners |
| 33-35 | Exact replacement contract for two legacy redirect assertions |
| 37-39 | Narrow Vitest environment fixture authority and full-suite truth rules |
| 41-59 | Bundle, preview, redirect safety, date truth table, endpoint, history, agent, local-only, and heading evidence demands |
| 61-63 | Bucket-(c) quarantine and landing sequence |
| 65-67 | Execution order, stop condition, no merge/push/DNS action |
| 71 | Founder-only browser-blocker note |

This was not embedded in the original thesis. It is now supplied as a first-class audit input, so adherence can be graded against the actual instruction text rather than inferred from the report.

---

## 4. Tier 1.2 — full 32-file scope patch

### 4.1 Construction rule

The 32-file count is reconstructed from git evidence, not invented from the thesis:

- `33` tracked paths differ from `7dcbd369`.
- Exclude three pre-existing bucket-(c) operations files: `.claude/commands/ship.md`, `.gitignore`, and `CLAUDE.md`.
- Exclude unrelated `skills-lock.json`.
- This leaves `29` tracked Dime implementation/evidence paths.
- Add the three legitimate untracked audit artifacts: `INCIDENTS.md`, `scripts/verify-preview-production.mjs`, and `vitest.environment-failure-allowlist.json`.
- Result: exactly `32` files.

This definition also excludes `access-features.png`, the narrative reports themselves, and the archived Playwright harness, which is a separately supplied checkpoint artifact rather than a base-to-current product change.

### 4.2 Complete patch manifest

| # | Base status | Patch line | Path |
|---:|:---:|---:|---|
| 1 | M | 1 | `client/src/App.tsx` |
| 2 | M | 488 | `client/src/lib/feedRoutes.test.ts` |
| 3 | M | 690 | `client/src/lib/feedRoutes.ts` |
| 4 | M | 843 | `client/src/pages/BetTracker.tsx` |
| 5 | M | 940 | `client/src/pages/BettingSplits.tsx` |
| 6 | M | 1,102 | `client/src/pages/DimeModelFeed.tsx` |
| 7 | M | 1,168 | `client/src/pages/Home.tsx` |
| 8 | M | 1,216 | `client/src/pages/dime-chat/DimeChatPage.tsx` |
| 9 | M | 2,783 | `client/src/pages/dime-chat/conversation.css` |
| 10 | A | 3,171 | `client/src/pages/dime-chat/drawerMotion.test.ts` |
| 11 | A | 3,216 | `client/src/pages/dime-chat/drawerMotion.ts` |
| 12 | A | 3,273 | `client/src/pages/dime-chat/streamBatcher.test.ts` |
| 13 | A | 3,342 | `client/src/pages/dime-chat/streamBatcher.ts` |
| 14 | A | 3,412 | `client/src/pages/dime-shell/DimeAppShell.test.ts` |
| 15 | A | 3,598 | `client/src/pages/dime-shell/DimeAppShell.tsx` |
| 16 | A | 3,762 | `client/src/pages/dime-shell/breakpoints.test.ts` |
| 17 | A | 3,838 | `client/src/pages/dime-shell/breakpoints.ts` |
| 18 | A | 3,898 | `client/src/pages/dime-shell/previewGate.test.ts` |
| 19 | A | 3,949 | `client/src/pages/dime-shell/previewGate.ts` |
| 20 | A | 3,983 | `client/src/pages/dime-shell/productRoute.test.ts` |
| 21 | A | 4,059 | `client/src/pages/dime-shell/productRoute.ts` |
| 22 | A | 4,119 | `client/src/pages/dime-shell/shell.css` |
| 23 | A | 4,205 | `client/src/pages/dime-shell/splitsDateState.test.ts` |
| 24 | A | 4,243 | `client/src/pages/dime-shell/splitsDateState.ts` |
| 25 | A | 4,262 | `client/src/pages/dime-shell/useDimeShellViewport.ts` |
| 26 | M | 4,287 | `client/src/pages/dimeModelFeed.test.ts` |
| 27 | M | 4,408 | `package.json` |
| 28 | M | 4,420 | `server/legacyRedirects.test.ts` |
| 29 | M | 4,458 | `vitest.config.ts` |
| 30 | A, untracked | 4,472 | `INCIDENTS.md` |
| 31 | A, untracked | 4,538 | `scripts/verify-preview-production.mjs` |
| 32 | A, untracked | 4,586 | `vitest.environment-failure-allowlist.json` |

Patch summary: `32 files changed, 3,196 insertions(+), 461 deletions(-)`.

### 4.3 Reproduction and validation

The tracked body was produced with `git diff --binary --full-index 7dcbd369 --` across the first 29 paths. A normal `git diff` silently omits untracked files, even when they appear in the pathspec. Each of the final three additions was therefore appended with `git diff --binary --full-index --no-index /dev/null <path>`.

The finished patch was validated against a temporary index loaded from the exact base, without changing the repository index or worktree:

```bash
GIT_INDEX_FILE=/tmp/dime-audit-index git read-tree 7dcbd369371a315169e3eea58197badc14d1640d
GIT_INDEX_FILE=/tmp/dime-audit-index git apply --check --cached docs/audits/2026-07-11-dime-shell/dime-shell-scope.patch
```

Both commands exited `0`. The patch is therefore syntactically valid and applies cleanly to the declared base.

### 4.4 Explicit exclusions

The following are not in the patch:

- `.claude/commands/ship.md`, `.gitignore`, and `CLAUDE.md`: pre-existing bucket-(c) operations changes, quarantined from the product patch.
- `skills-lock.json` and every `.agents/skills/higgsfield-*` path: unrelated Higgsfield scope, explicitly ignored.
- `.playwright-cli/matrix.js` and its archived snapshot: absent at both base and current working tree; the harness is supplied separately from checkpoint `34aff1f8`.
- `access-features.png`: unrelated untracked image artifact.
- `dime-ai-sol-iteration.md`, this appendix, and their evidence copies: audit delivery artifacts, not implementation hunks.

---

## 5. Tier 1.3 — direct test-rigor ledger

These are the four exact current files Fable requested. The hashes freeze the reviewed versions independently of pass-count reporting.

| Test source | Lines | SHA-256 | Direct contracts |
|---|---:|---|---|
| `client/src/pages/dime-shell/DimeAppShell.test.ts` | 180 | `9f0f88facb8557c68638cc7119901dd0b1dde2fb802014f884859adf7d4d2fc6` | shell ownership; URL-derived pane; persistent Chat; deferred lazy pane; compile-time preview propagation; shared Splits canonicalizer; sport/date carryover; scroll/focus; embedding; Tracker query safety; abort/disposal source contract |
| `client/src/pages/dime-shell/breakpoints.test.ts` | 70 | `d8147febc227b25ff6297468b5f59f85b2f3d26b01ff37db5426db8492878e2b` | one inclusive 768 boundary; no false ownership; desktop/mobile defaults; explicit deep link preservation; malicious return-path rejection |
| `client/src/pages/dime-shell/splitsDateState.test.ts` | 32 | `27ef24b0c405caaa9b38187e7fc2492801c7eb1a1b1123ef2c7987fadaac7cdf` | URL date wins; untouched dateless view adopts server date; user-picked dateless date survives server sync |
| `client/src/lib/feedRoutes.test.ts` | 194 | `32fa48e4c139a79b5c29d699d613808ef51fe65d3eb0d218546a9e9f43a7299b` | feed and Splits builders; parser formats and invalid dates; six-input/two-owner convergence; legacy tab/sport/date mapping; no legacy output |

Important grading limitation: several shell tests are source-contract tests. They can prove that wiring, guards, exact JSX patterns, and cleanup calls exist, but they cannot prove browser runtime behavior. In particular, `DimeAppShell.test.ts:171-178` verifies the presence of abort/disposal cleanup; it does not establish that a real mid-stream cross-768 transition produces no console errors or leaked connection. The browser gate remains separate and blocked.

---

## 6. Tier 2.4 — bundle blocker and motion critical-path dossier

### 6.1 Exact static import path

```text
App.tsx
  -> lazy route chunk: dime-shell/DimeAppShell.tsx
     -> static import at DimeAppShell.tsx:12: DimeChatPage
        -> static import at DimeChatPage.tsx:28-39: framer-motion
        -> static import at DimeChatPage.tsx:57-61: drawerMotion helpers

vite.config.ts:183-214
  -> manualChunks("framer-motion") returns "vendor-motion"
  -> names/separates the dependency as a chunk
  -> does not convert a static dependency into a deferred dependency
```

`vite.config.ts:183-214` assigns Framer Motion to `vendor-motion`. The Vite configuration is unchanged from both the base and checkpoint; both revisions resolve to blob `073424c50102337efcf97a43109828bfab1c55c9`. Its comment says Motion is deferred after route resolution, which is true generically but no longer sufficient for direct tablet/desktop `/chat`: the route resolves to `DimeAppShell`, the shell statically imports its always-mounted Chat host, and that host statically imports Framer Motion.

`drawerMotion.ts` is not the dependency source. It is a 51-line pure math module with no imports; checkpoint blob `954a3f2988b857a1cefbeec98486a6aaa7bb2ec9`. It provides pointer-intent classification, target resolution, and rubber-band math. The Framer dependency enters through `DimeChatPage.tsx:28-39`.

### 6.2 Why `manualChunks` alone cannot fix the gate

The current chunk rule makes the bundle easier to cache and measure, but the browser must still fetch `vendor-motion` because the initial shell graph statically requires it. Renaming the chunk or moving the `manualChunks` condition cannot change reachability. The loading seam must change.

The measured critical-path increase remains `+47,726` gzip bytes, of which `vendor-motion` accounts for `+40,871`. The accepted ceiling is `+5 KiB`, so the current build is blocked.

### 6.3 Exact remediation design surface

No remediation is implemented or authorized by this appendix. Fable should evaluate these seams while preserving the invariants below:

1. `DimeChatPage.tsx:28-39` — static Framer imports are the primary de-criticalization seam.
2. `DimeChatPage.tsx:317-383` — animated sidebar/menu helpers and Motion-backed component definitions.
3. `DimeChatPage.tsx:710-755` — motion values, reduced-motion state, and animation controls.
4. `DimeChatPage.tsx:1,270-1,593` — Motion-rendered drawer, main pane, composer, settings menu, and external-pane layers.
5. `DimeAppShell.tsx:12` and `144-155` — Chat must remain the one persistent shell host; solving the bundle by unmounting Chat would violate stream/draft persistence.

Any acceptable design must retain:

- one mounted Chat instance across pane changes;
- the existing stream, draft, recent-chat, and drawer ownership;
- interruptible gestures and presentation-value continuity;
- reduced-motion behavior;
- the frozen tablet/desktop visual language;
- no duplicate sidebar;
- no new dependency;
- a remeasured direct `/chat` critical-path delta of `<=5 KiB` versus `7dcbd369`.

A credible solution must either defer a narrowly isolated Motion adapter without deferring Chat state, or replace the affected presentation primitives with existing platform/CSS/Web Animations capabilities while preserving the tested motion semantics. Merely editing `vite.config.ts` is not sufficient.

---

## 7. Tier 2.5 — archived Playwright harness audit

The canonical checkpoint artifact is `34aff1f8:.playwright-cli/matrix.js`, git blob `5ab6995537a30d68c565bc330e0cae5c41a206c8`, 220 lines, 11,112 bytes. It has been copied without restoring the deleted worktree path to `dime-shell-archived-matrix-34aff1f8.js`.

### 7.1 Coverage against the four locked live requirements

| Locked requirement | Existing archived coverage | Evidence | Verdict |
|---|---|---|---|
| A4 — resize across 768 during an active stream; clean abort; no console error/leak | The SSE fixture is returned as one complete body; each cell changes viewport before a fresh navigation | archived matrix lines 30-39 and 182-199 | **NOT COVERED** |
| A7 — Feed and Splits sticky headers inside shell scroll container at 768/1024/1440, both themes | Harness visits only `/chat`; it never opens Feed/Splits, scrolls `.dc-shell-external-scroll`, or measures sticky geometry | lines 175-199 | **NOT COVERED** |
| R2 — back, forward, refresh, and deep-link route restoration | No `goBack`, `goForward`, `reload`, deep-link matrix, or navigation-type assertion | entire 220-line source | **NOT COVERED** |
| Live focus and exactly one exposed heading | Collector never inspects `document.activeElement`, headings, `aria-hidden`, or the accessibility tree | lines 78-162 | **NOT COVERED** |

Coverage score against the new shell live gate: **0/4**.

### 7.2 What the harness does cover

The harness remains useful legacy Chat evidence. It covers:

- two themes × four viewports (`375`, `768`, `1024`, `1440`) × home/conversation = 16 cells;
- console warnings/errors and page errors;
- local tRPC identity and complete-body SSE fixtures;
- theme switching;
- horizontal overflow, composer fit and font size;
- gradients and viewport-gate remnants;
- wordmark, pill snap, fixed-bottom owner tabs, drawer/menu geometry;
- rough layout-shift collection;
- screenshots for every cell.

It should be extended rather than represented as proof of the four new shell requirements. The original `.playwright-cli/matrix.js` working-tree deletion remains untouched.

---

## 8. Tier 3.6 — exact failure ledgers

| Ledger | Current state | Count | SHA-256 | Audit meaning |
|---|---|---:|---|---|
| `INCIDENTS.md` | untracked product-audit artifact; included in scope patch | 42 exact DB test entries | `a70810a9a8b08e42a6783337f71d20facc4491cbd482b9f3d29fd25560cd202e` | Every newly exposed real-database failure is named; all report `Database not available` |
| `vitest.environment-failure-allowlist.json` | untracked product-audit artifact; included in scope patch | 17 unique exact entries | `a0c7bc194a57ee0333323d2ae11fafc6d482d7ce04205f3a9211d32bb068a6c8` | Narrow credential/environment allowlist; no wildcard and no DB failures |

The 32-file patch includes both ledgers in full at lines 4,472-4,537 and 4,586-4,613. It also includes the production preview verifier at lines 4,538-4,585. Fable can therefore spot-check every name without trusting the thesis summary.

The recorded full-suite partition remains:

- `1,490` tests discovered;
- `1,431` passed;
- `59` failed;
- `17` exact credential/environment failures;
- `42` real-database failures;
- `0` client failures;
- `0` stale allowlist entries.

This is a truth-run ledger, not a claim that the entire suite is green.

---

## 9. Tier 3.7 — recovered original named-file plan and scope drift

The original plan is no longer UNKNOWN. Its full assistant message was recovered from the local Codex session transcript and saved as `dime-shell-original-named-plan.md`. The exact expected-files section is at lines 204-220.

### 9.1 Original expected-files contract

The plan explicitly named:

- `client/src/App.tsx`;
- `client/src/pages/dime-shell/DimeAppShell.tsx`;
- `client/src/pages/dime-shell/breakpoints.ts`;
- `client/src/pages/dime-shell/productRoute.ts`;
- shell-focused unit tests and CSS with `derived:` citations;
- `client/src/pages/dime-chat/DimeChatPage.tsx`;
- `client/src/pages/dime-chat/conversation.css`;
- `client/src/lib/feedRoutes.ts`;
- `client/src/lib/feedRoutes.test.ts`;
- `client/src/pages/DimeModelFeed.tsx`;
- `client/src/pages/BettingSplits.tsx`;
- `client/src/pages/BetTracker.tsx` only if a nonvisual embedding prop became necessary;
- `client/src/pages/Home.tsx`.

It also explicitly prohibited server, mobile-owner-tab, logo-registry, asset, landing, checkout, admin, deployment, and CI files.

### 9.2 Plan-to-actual ledger

| Actual path class | Relationship to original plan | Authority/status |
|---|---|---|
| App, shell host, breakpoint/parser modules, Chat host/CSS, route helpers/tests, Feed, Splits, conditional Tracker prop, Home | Explicitly named | **Within original plan** |
| `DimeAppShell.test.ts`, `breakpoints.test.ts`, `productRoute.test.ts`, `shell.css`, `useDimeShellViewport.ts` | Materialization of “shell-focused unit tests/CSS” and new shell module | **Within categorical plan scope** |
| `previewGate.ts/.test.ts`, `splitsDateState.ts/.test.ts` | Later seam-specific shell safety and preview work | **Within shell directory; later recovery/user requirements supplied exact authority** |
| `drawerMotion.ts/.test.ts`, `streamBatcher.ts/.test.ts` | Prior responsive Chat scope already present before the unified-shell plan | **Carried into the base-to-current patch; not shell-plan drift** |
| `dimeModelFeed.test.ts` | Not named explicitly | **Scope drift; retroactively approved by addendum §2 contingent on normalized proof** |
| `server/legacyRedirects.test.ts` | Original plan said no server files | **Scope drift; narrowly approved by addendum §1 and §4; test-only, no server runtime edit** |
| `vitest.config.ts` | Not in original expected list | **Scope drift; narrowly approved by addendum §5 for one test-only session secret** |
| `package.json`, `scripts/verify-preview-production.mjs` | Not in original expected list | **Scope drift; authorized by addendum §6.2 repeatable production-output check** |
| `INCIDENTS.md`, `vitest.environment-failure-allowlist.json` | Not in original expected list | **Scope drift; required by addendum §5’s failure classification and exact allowlist freeze** |

One wording nuance must be preserved for reviewers: the addendum says `feedRoutes.ts/.test.ts` exceeded “the plan’s named files,” while the recovered original shell plan explicitly names both at lines 213-214. The most defensible interpretation is that the addendum refers to the narrower delete/recreate recovery plan, not the original shell implementation plan. It should not be used to claim that route-helper work was absent from the original shell scope.

### 9.3 No unexplained product path

Every file in the reconstructed 32-file patch is now attributable to one of four buckets:

1. explicitly named original shell work;
2. shell-module/test/CSS materialization;
3. prior responsive Chat scope carried forward;
4. later, narrowly authorized recovery evidence or repair.

No unrelated skill/plugin path is part of any bucket. No logo/crest/flag asset path, deployment file, CI file, database schema, or server runtime implementation is present in the patch.

---

## 10. Final handoff verdict for Fable 5

Fable can now move the following judgments from narrative-dependent to code-verifiable:

- instruction adherence against the actual 71-logical-line addendum;
- zero-MISSED and implementation-quality review against the full 32-file patch;
- direct grading of the four requested test sources;
- exact identification of the Motion critical-path seam;
- direct inspection of the archived harness and its 0/4 coverage gap;
- exact spot-checking of all 42 DB incidents and 17 environment failures;
- precise comparison between the original expected-files plan and actual scope.

This appendix does not change the shipment verdict. The product remains **not landable** because the direct `/chat` critical path exceeds the `+5 KiB` gzip gate by `42,606` bytes and the required live browser matrix remains blocked. No motion remediation, commit, merge, push, deployment, DNS action, or restoration of the deleted `.playwright-cli` worktree file was performed while assembling this evidence.

---

## 11. Final closure evidence: addendum, C1, C4, and C5

### 11.1 The recovery addendum is now VERIFIED

The authoritative attachment and repository audit copy were compared by logical content and match exactly. The only byte-level difference is the repository copy's conventional terminal newline.

| Copy | SHA-256 | Result |
|---|---|---|
| `/Users/danielwalker/.codex/attachments/32baf655-2f7d-4133-a0f3-c6f89f085ee2/pasted-text.txt` | `cf2a7ee62094f4032d24a695deb130ea79f9f372c7ddab56ae8d53423fdb49aa` | Authoritative source; 71 logical lines, no terminal newline |
| `dime-sol-recovery-instruction-addendum.txt` | `3b924cf4da5249fee954a01c52fc9a1a3f424ae734aa78213779ecb2efee5c4a` | Content-identical audit copy; terminal newline added |

Verdict: **VERIFIED**, replacing the final instruction-adherence inference.

### 11.2 C1 manual-chunk mapping is VERIFIED

The current full file is [`vite.config.ts`](../../../vite.config.ts), SHA-256 `c0f18129b4b9e077e9005898705838b327fd6c75f1bbdad975f5b113d0b51be7`.

The controlling mapping is:

```ts
// vite.config.ts:211-214
if (id.includes('framer-motion')) {
  return 'vendor-motion';
}
```

Both `7dcbd369:vite.config.ts` and `34aff1f8:vite.config.ts` resolve to git blob `073424c50102337efcf97a43109828bfab1c55c9`. The mapping predates this workstream and is unchanged.

Verdict: **VERIFIED**. C1 must address static dependency reachability from `DimeAppShell -> DimeChatPage -> framer-motion`; changing the `manualChunks` name alone cannot de-criticalize the chunk.

### 11.3 C4 BetTracker protected-query gate is VERIFIED

Exact negative-control command for the next Sol/Fable session:

```bash
rg -n 'enabled:\s*canAccess' client/src/pages/BetTracker.tsx
```

Current result:

```text
exit 1
no output
```

There is no remaining query gate using bare `canAccess`. The positive control is:

```bash
rg -n 'canLoadProtectedData|enabled:\s*canLoadProtectedData' client/src/pages/BetTracker.tsx
```

Current output:

```text
1566:  const canLoadProtectedData = canAccess && !!appUser;
1758:      enabled:   canLoadProtectedData && !!formDate,
1796:      enabled: canLoadProtectedData,
1827:      enabled: canLoadProtectedData && isOwnerOrAdmin,
1864:      enabled: canLoadProtectedData && mlbDates.length > 0,
1932:    { enabled: canLoadProtectedData && isOwnerOrAdmin && activeTab === "LOGS", staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 }
3259:          {canLoadProtectedData && (
```

Verdict: **VERIFIED**. Preview chrome cannot activate protected Tracker reads without a real `appUser`.

### 11.4 C5 dateless mobile Splits route is VERIFIED live

The originally requested command is:

```bash
rg -n 'BettingSplits' client/src/features/mobileOwnerTabs/
```

It returns one scraper-name comment:

```text
client/src/features/mobileOwnerTabs/screens/MobileSplits.tsx:9: * server/vsinBettingSplitsScraper.ts (5-min cache); book lines joined from
```

That match alone does not settle URL emission. The next-session one-liner should therefore retain the requested term while also searching the route and helper forms:

```bash
rg -n 'BettingSplits|betting-splits/MLB|bettingSplitsPath' client/src/features/mobileOwnerTabs/
```

The decisive current match is:

```text
client/src/features/mobileOwnerTabs/config.ts:31:  { id: "splits", label: "Splits", path: "/betting-splits/MLB", iconName: "BarChart3" },
```

Verdict: **VERIFIED — yes, a live mobile-owner-tab destination still emits the dateless uppercase route.** It is outside the tablet/desktop implementation scope and was not changed here. On navigation, the standalone Splits owner at `client/src/App.tsx:160-171` performs client canonicalization to the dated lowercase form. Whether to make the mobile tab emit the dated canonical URL directly is now a founder decision, not an unknown fact.

### 11.5 Closure ledger

| Item | Final status |
|---|---|
| 70-line §2-§7 gates addendum | **VERIFIED** |
| C1 `manualChunks` mapping before remediation | **VERIFIED** |
| C4 no `enabled: canAccess` remnants | **VERIFIED** |
| C5 dateless Splits target live anywhere | **VERIFIED: yes, mobile config line 31** |
| Change mobile tab emitter now? | **RATIFIED FOUNDER DECISION REQUIRED; outside current tablet/desktop scope** |
