# Dime AI Migration — Consolidated Test Theses & Supervision Report

**Date:** 2026-07-10 · **Repo HEAD:** `c0fcb05` (untouched — `git status` clean before and after)
**Method:** 5 parallel test squads over work-queue items Q1–Q20 → independent supervisor
re-verification of 28 load-bearing claims (28/28 VERIFIED, 0 refuted) → 8-item blueprint
corrections register → 6 theses (5 × ~1,500 words + 1 × ~3,000 words).
**Standing rule honored:** write-only audit. Nothing executed, nothing committed, nothing
pushed, no issues filed. The Part III issue queue is DRAFTED, awaiting an explicit go.

**Companion documents (on branch `claude/dime-ai-html-migration-audit-ao6q81`):**
`dime-ai/STANDALONE-HTML-MIGRATION-BLUEPRINT.md` · `dime-ai/FULL-MIGRATION-REPORT.md`
(both now carry 8 known corrections listed in Part I §B — apply via draft issue I-0c).



---

# PART I — SUPERVISOR VERIFICATION (28 claims, corrections register, integrity)

# Supervisor Verification Report — Q1–Q20 Squad Claims

All evidence below reproduced independently (read-only; no files written, script run from squad scratchpad).

## A. Verdict per claim

**Integrity**
- **(0) VERIFIED** — `git status --porcelain` empty (re-checked after all work); HEAD `c0fcb05`, no stash.

**Squad 1 (design)**
- **(1) VERIFIED** — My own WCAG computation: bg = rgba(11,11,15,0.08) over `#45E0A8` → (64.4, 207.0, 155.8); ink at alpha 0.62 → **4.321:1 FAIL**, 0.63 → 4.441 FAIL, **0.64 → 4.564 PASS**. The blueprint's "4.64:1" figure holds only on *bare* mint canvas (I reproduce 4.639 there) — the "≥0.62" spec is insufficient on `--surface2`.
- **(2) VERIFIED** — `client/src/index.css:4` = `@custom-variant dark (&:is(.dark *))`; `client/index.html:2` = `class="dark"`. My count: 45 `dark:` occurrences in ts/tsx, minus 2 object keys (`chart.tsx:7`, `DimeChatPage.tsx:66`) = **43 real Tailwind variants** (squad said 42 — off by one, mechanism fully confirmed).
- **(3) VERIFIED** — `client/src/components/ui/sonner.tsx:1` imports `useTheme` from next-themes; it is the *only* next-themes reference in client/src; `App.tsx:207` uses the local `./contexts/ThemeContext` provider, so sonner's hook is providerless (falls to `"system"`).
- **(4) VERIFIED** — `rgba(57,255,20` = **116 matching lines** (130 occurrences; squad counted lines); `#7FFF00`/`#ADFF2F` = **8** (MlbPropsCard 110-111, useEdgeCalculation 42-43, edgeUtils 113-114, TheModelResults 160, ModelResults 126). Bonus: `#39FF14` = 252 case-sensitive occurrences, matching the blueprint's 252 (+1 lowercase `#39ff14`).
- **(5) VERIFIED** — `--primary` and `--accent` = `oklch(0.55 0.18 275)` (purple, index.css:125/134). ManageAccount.tsx:120 `border-primary`, :164 `text-primary`, :314 `border-primary/40 … text-primary hover:bg-primary/10`; `client/src/pages/BettingSplits.tsx`:446 `text-primary`, :452 `hover:bg-accent`, :637 `text-primary`.
- **(6) VERIFIED** — DimeChatPage.tsx:531: `themeProp ?? (contextTheme === "light" ? "light" : "dark")` — any non-"light" theme (incl. mint) renders dark.

**Squad 2 (chat)**
- **(7) VERIFIED** — `edgeParser.ts:45-46` single anchored fixed-order `BODY_RE`; `parseBody` null → line 111 `pushText(content.slice(open, close + CLOSE.length))` ("malformed → honest raw text"). Any unknown/reordered key degrades the whole block.
- **(8) VERIFIED (nuance)** — `server/dime-chat.route.ts:47-51`: "MAY end that answer with **exactly one** fenced verdict block … **in exactly this format**". Conditional-permissive (only when grounded), not unconditional mandate — at most one, exact format.
- **(9) VERIFIED** — `chatReducer.ts:35-43` union: `append_user | open_assistant | stream_delta | meta | stream_done | stream_error | stream_abort | reset`. No hydrate/load.
- **(10) VERIFIED** — dialog.tsx + sheet.tsx wrap `@radix-ui/react-dialog` (^1.1.15), alert-dialog.tsx wraps react-alert-dialog, drawer.tsx wraps `vaul` (^1.1.2); all four files present.
- **(11) VERIFIED** — `scratchpad/squad2/testrun/` exists; all 6 copied files **byte-identical** to repo originals (diff); `.vite/vitest/results.json` shows vitest **2.1.9**, 3 suites `failed: false`; repo test files contain 15+12+10 = **37** `it(` cases.

**Squad 3 (splits)**
- **(12) VERIFIED — BLUEPRINT IS WRONG** — Ran `squad3/edge-check.mjs` (node 22.22.2) against the real `client/src/lib/edgeUtils.ts`: Pirates ML → **+14.89% ROI** (raw 14.8936), Pirates +1.5 → **+9.05% ROI** (raw 9.0487); all 6 fixtures MATCH. Independent hand-math confirms (0.574468/0.5000−1; 0.653979/0.599714−1). Blueprint:164-165 and FULL-REPORT:181-182 "not derivable" must be corrected.
- **(13) VERIFIED** — `server/splitsAndEdge.test.ts:150` "Mirror the calculateRoi and formatRoi functions"; test's formatRoi returns `'—'` on NaN (:175) vs production `edgeUtils.ts:237` returns `''` — mirrored copy has drifted.
- **(14) VERIFIED** — `games` table = drizzle/schema.ts:188-651, has `createdAt` only (the `updatedAt` at :686 belongs to `nba_teams`), no `splitsUpdatedAt`. `splitsAgoLabel` declared at BettingSplits.tsx:378 and ModelProjections.tsx:906; grep finds **zero other references** repo-wide — computed (from `games.lastRefresh`), never rendered.
- **(15) VERIFIED** — GameCard.tsx:3262 gates the merged panel (ROI computations live in GameCard, :1015+) on `mode === "projections" || mode === "full"`; the `mode === "splits"` branch (:3260-3272) renders `BettingSplitsPanel`, which contains zero ROI references.
- **(16) VERIFIED** — `scratchpad/audit/xdc-template.html:719` and `:722` both carry `min-width: 46px` with 12px mono % labels *inside* the segments. Blueprint Q5 acceptance "97/3 renders 97/3" (:428) is unachievable with labels-inside; FULL-REPORT:270 already prescribes the resolution ("width:% + external label for tiny segments") but the Q5 row omits it.

**Squad 4 (server)**
- **(17) VERIFIED** — dime-wc2026.route.ts: `aborted` set :608, `responseMode = "ANSWER"` initialized **:619, before streaming**; catch (:649) wraps its entire error path in `if (!aborted) { … return; }` — an aborted stream skips the catch body and **falls through to STEP 13 deduction** with responseMode still "ANSWER". (Note: docs already track this as §17-A risk 1 / D9 "deferred by owner".)
- **(18) VERIFIED** — sole runtime `INSERT INTO dime_credit_ledger` is dime-wc2026.route.ts:177 with delta `${-amount}` (negative, under `FOR UPDATE`); no other insert in server/ outside tests/scripts, no drizzle-table writes.
- **(19) VERIFIED** — stripeWebhook.ts:221-238: metadata `plan_id` first, else `listLineItems` → `getPlanByPriceId`; unknown price still defaults `"monthly"` (`normalizePlanId`, products.ts:111-114). Grep confirms **neither doc mentions** listLineItems/getPlanByPriceId.
- **(20) VERIFIED** — `grantUserAccess` (stripeWebhook.ts:52-86) performs an unconditional `db.update(appUsers).set({ … stripeSubscriptionId: params.stripeSubscriptionId … })` — `""` would clobber a subscriber's real subscription id.
- **(21) VERIFIED** — `app_users` (schema.ts:45-136) has no display-name column (only username/email/discordUsername); appUsers router self-service surface = login/logout/acceptTerms/password-reset; `updateUser` is `ownerProcedure`. Q9's "name persists" acceptance (blueprint:434) has no schema/db-push line item.
- **(22) VERIFIED** — `sdk.authenticateRequest(req)` is at dime-chat.route.ts:**91**; blueprint says `:92` at lines 430 and 515 (doc drift).

**Squad 5 (infra)**
- **(23) VERIFIED** — node_modules contains exactly 1 entry (`typescript`), empty `.bin` → in-repo vitest/tsc gates environment-blocked. Consistent with squads 2/3/4's workaround reports.
- **(24) VERIFIED** — server/_core/index.ts:697 `process.env.DISABLE_BACKGROUND_JOBS === '1'` (exact string); cron-vsin-odds.yml POSTs `/api/cron/vsin-odds` every 15 min while in-process `startVsinAutoRefresh` also runs unless the flag is set — double-run hazard real.
- **(25) VERIFIED** — tsconfig.json:3 `"exclude": [..., "**/*.test.ts"]`.
- **(26) VERIFIED** — vitest.config.ts includes `server/**`, `perf/**`, `client/src/**` only; shared/ omitted (currently latent — shared/ has no test files today).
- **(27) VERIFIED** — package.json has `playwright ^1.58.2` + `playwright-extra`, no `@playwright/test`.
- **(28) VERIFIED** — package.json:17 postinstall `pip3 install -r requirements.txt -q 2>/dev/null || true`; no requirements.txt at repo root (failure silently swallowed by `|| true`).

**Cross-squad consistency: no contradictions.** The vitest blocker is reported identically by squads 2/3/4/5 and matches (23); squad 2's out-of-tree run is genuine (byte-identical copies, vitest 2.1.9). Squad 1's alpha finding: 0.64 is the first passing hundredth; a 0.65 recommendation is compatible (margin). Squad 3's Q5 GameCard work vs squad 1's Q16 batching: compatible only with an explicit ownership rule (see C).

## B. Blueprint Corrections Register (definitive)

| # | Doc § / line | Current text | Corrected text |
|---|---|---|---|
| 1 | Blueprint §9 :164-165 | Pirates ML / Pirates +1.5 ROI … "not derivable" | "derivable EXACTLY via `edgeUtils.calculateRoi` (modelImplied / bookNoVig − 1): −110/−135 → +14.89%; −168/−189 → +9.05% (verified against live code)" |
| 2 | FULL-REPORT §9 :181-182 | same "not derivable" rows | same correction as #1 |
| 3 | Blueprint :315, :405 (D1), :425 (Q2); FULL-REPORT :225, :330, :613 | `--text3` alpha "≥0.62" (3.47→4.64:1) | "≥0.64 (recommend 0.65)"; note: 4.64:1 held only on bare mint canvas; on `--surface2` (rgba(11,11,15,0.08) over mint) 0.62 = 4.32:1 FAIL, 0.64 = 4.56:1 PASS |
| 4 | Blueprint Q7 :430 and :515 | `dime-chat.route.ts:92` | `:91` |
| 5 | Blueprint Q9 :434 | files: Profile.tsx, ManageAccount.tsx, appUsers.ts; acceptance "name persists" | add: "**new `app_users` display-name column + `db-push.yml` before code deploy** (no such column exists; router has no self-service name mutation — `updateUser` is owner-only)" |
| 6 | Blueprint Q5 :428 acceptance | "bars width:% (97/3 renders 97/3)" | append "…with external labels for segments <46px (FULL-REPORT remediation); labels-inside invariant is dropped for tiny segments. Tests must import real `edgeUtils` — no mirrored copies (splitsAndEdge.test.ts drift: '—' vs '')" |
| 7 | Blueprint §17-B / Q19 :444 | "today a pack would default to plan 'monthly'…" (no mention of lookup) | document the shipped `stripeWebhook.ts:221-238` listLineItems price→plan fallback; note pack prices are NOT in the plan map, so unknown price still defaults "monthly" — the mode-branch requirement stands unchanged. Also note `grantUserAccess` writes `stripeSubscriptionId` unconditionally (`""` clobber risk for mode:"payment" sessions) |
| 8 | Blueprint Q16 :441 | "252 occurrences" | "252 `#39FF14` + 1 lowercase `#39ff14` — sweep case-insensitively (253); GameCard occurrences transfer to Q5 (ownership rule)" |

## C. Revised execution sequencing (consolidated)

1. **Infra unblock first (gate everything):** restore installability — fix postinstall/requirements.txt (28), decide @playwright/test (27), add `shared/**` to vitest globs (26), reconsider `**/*.test.ts` tsconfig exclusion (25). Without install, no gate below is verifiable in-repo.
2. **Design chain:** D5 (MASTER.md mint column, with alpha **≥0.64/0.65** correction) → Q2 (shared token layer; kills purple `--primary`/`--accent`, claim 5) → Q1 (theme provider unification: single ThemeContext, sonner off next-themes, `@custom-variant` extended beyond `.dark`, DimeChatPage mint coercion removed — claims 2/3/6) → Q3 → Q4.
3. **Money chain, Q19-first law reaffirmed:** Q19 (webhook `session.mode` branch + dedup store via db-push; also fix `grantUserAccess` "" clobber, claim 20) **before any pack price exists** → Q7 (chat auth at `:91`) → Q7b (chat charging: resolve D9 abort-fallthrough policy at build time — claim 17 is the exact code path) → Q9 (own db-push for display-name column precedes UI).
4. **Q5/Q16 GameCard ownership rule:** GameCard.tsx (and BettingSplitsPanel) belong to **Q5** — its splits/ROI rebuild sweeps GameCard's neon in-place; **Q16** sweeps the remaining feed components in per-component batches. Shared exit gate: case-insensitive `#39FF14`/`rgba(57,255,20`/`#7FFF00`/`#ADFF2F` grep = 0.
5. Split bars: proportional `width:%` + external labels for tiny segments (claim 16 resolution, already in FULL-REPORT remediation).

## D. Overall supervision verdict

**All 28 claims stand — zero refutations.** Corrections to squad assertions are marginal: dark: variant count is 43, not 42 (claim 2); the [EDGE] mandate is conditional-permissive, not absolute (claim 8); the abort-fallthrough (claim 17) is real but already owner-deferred as D9/§17-A risk 1 — a confirmed defect, not a new discovery. Squad 3's ROI adjudication is the highest-value finding and is conclusively correct: the blueprint's "not derivable" rows are wrong and Q5 can reuse `calculateRoi` verbatim. Squad 1's alpha correction supersedes the blueprint's 0.62 spec (which was computed against the wrong background).

## E. Repo integrity

`git status --porcelain` empty before and after supervision; HEAD unchanged at `c0fcb05`; no stash entries; no commits created, nothing pushed, no repo files written (only the squads' pre-existing scratchpad artifacts were read/executed).


---

# PART II.0 — SUPERVISOR THESIS (~3,000 words): Cumulative Testing of the Migration Blueprint

# SUPERVISOR THESIS — On the Cumulative Testing of the Dime AI Migration Blueprint

## 1. The central claim: zero refutations and eight corrections are the same finding

Five squads ran adversarial test passes over the twenty-item migration work queue (STANDALONE-HTML-MIGRATION-BLUEPRINT.md §14). I then independently re-verified their twenty-eight most load-bearing claims by reproducing every piece of evidence in the repository — recomputing the contrast math, re-running the ROI script against the live `edgeUtils.ts`, re-reading the control flow, re-counting the greps, re-diffing the test copies. Every claim held. Not one squad assertion was refuted. And yet the same exercise produced an eight-entry corrections register against the blueprint itself.

That combination is the thesis. It is not a paradox; it is the signature of a healthy audit architecture meeting a document that is architecturally sound but decaying at its edges. When squads whose incentive is to find defects produce claims that survive hostile re-verification at a 28-for-28 rate, the multi-agent method is generating truth, not noise. When that same truth, laid against the governing document, forces eight edits, the document's failure surface is exposed with unusual precision — and the pattern of where it failed is more instructive than any individual failure.

The pattern is this: the blueprint is never wrong about architecture. Its account of the theme system, the SSE streaming core, the credit ledger, the webhook shape, the splits pipeline — all of it survived. Where it decays is in exactly two tissue types. First, **computed values embedded in prose**: a contrast ratio proven against the wrong background (the "≥0.62" alpha spec, blueprint:315, :405, :425), a derivability judgment made without running the function (the "not derivable" rows, blueprint:164-165). Second, **acceptance criteria written faster than the code moved under them**: an acceptance line ("97/3 renders 97/3", blueprint:428) at war with an invariant the prototype itself honors; a queue row (Q9, blueprint:434) whose acceptance test — "name persists" — is unsatisfiable against the current schema; a line-number citation (`:92`, blueprint:430, :515) one line stale against the file it points at (`server/dime-chat.route.ts:91`).

Documentation truth decays fastest not where the document is longest or oldest, but where it commits to numbers it did not compute and to acceptance tests it did not attempt. Architecture, once written down, stays true for months. A computed value is stale the moment the computation's premise shifts. That is the reliability class this blueprint occupies: **trustworthy as a map, unreliable as a calculator** — and the entire corrections register is the calculator errata.

## 2. What the blueprint got wrong, and why it was the most valuable finding

The single outright refutation of the blueprint is the ROI derivability row, and it deserves sustained attention because it is the only place the document asserted a negative it had not tested.

Blueprint §9 (:164-165) and FULL-MIGRATION-REPORT §9 (:181-182) both declare the prototype's ROI chips — Pirates ML at **+14.89%** and Pirates +1.5 at **+9.05%** — "not derivable" from platform math, positioning them as prototype-only decoration that Q5 would have to approximate or drop. Squad 3 wrote a six-fixture script importing the *real* `calculateRoi` from `client/src/lib/edgeUtils.ts` (the formula at :225-230: `modelImplied / bookNoVig − 1`). I re-ran it myself under node 22.22.2 and then reproduced the arithmetic by hand: book −110/−110 de-vigs to exactly 0.5000; model −135 implies 0.574468; the ratio minus one is 14.8936% — the chip's +14.89% to the displayed hundredth. The run-line case: −168 against +139 de-vigs to 0.599714; model −189 implies 0.653979; ratio minus one is 9.0487% — the chip's +9.05%. Six fixtures, six matches, including the no-chip cases correctly suppressed by the 1.5pp `EDGE_THRESHOLD_PP` gate.

What this converts is significant. Q5 — the Betting Splits reskin — was scoped as if the prototype's most prominent data element had no backend truth behind it. It does. The chips are not decoration; they are the platform's own edge mathematics rendered by a designer who evidently had the real numbers. Q5 therefore inherits `edgeUtils` verbatim: no new formula, no approximation, no "close enough" tolerance in the acceptance test. The correction (register entry 1-2) flips a design-liberty clause into a bit-exactness requirement.

The methodological lesson generalizes: **auditing rendering and auditing math are different disciplines, and the original audit only did the first.** A human or agent eyeballing a static HTML prototype can verify layout, color, and copy against the source design. It cannot verify a percentage without running the function — and the original auditors, lacking a harness, wrote "not derivable" where the honest entry was "not yet derived." The five-squad pass found this precisely because Squad 3's mandate was to *execute* the platform's functions against the prototype's fixtures rather than compare pixels. Every future audit of this codebase should carry that rule forward: any numeric claim in a spec document is untrusted until a script has reproduced it, and the script should be preserved (as `scratchpad/squad3/edge-check.mjs` was) so the supervisor can re-run rather than re-believe.

## 3. Imprecision that would have shipped defects

Two blueprint entries were not wrong but imprecise in ways that would have survived implementation review and failed in production.

The first is the mint-theme text alpha. The blueprint's D1 ruling (:405) and Q2 acceptance (:425) specify `--text3` alpha "≥0.62," annotated with a computed 4.64:1 contrast ratio. I reproduced that 4.64:1 — **on bare mint canvas**. But the mint theme's `--surface2` is `rgba(11,11,15,0.08)` composited over `#45E0A8` (prototype token block, `xdc-template.html:283`), and text3 text sits on surface2 throughout the sidebar and card chrome. Composited correctly, alpha 0.62 yields **4.321:1 — a WCAG failure** — and the first passing hundredth is 0.64 (4.564:1). The spec as written would pass its own documented check and fail the actual surface. The correction (register entry 3) sets the floor at 0.64 with 0.65 recommended for margin. The decay mechanism here is subtle and worth naming: the computation was *right* but its **premise** — which background the text sits on — was chosen wrong, and nothing in the document records the premise, so no reader could have caught it without recomputing from the token block. Specs that embed computed values must embed the computation's inputs.

The second is the split-bar acceptance. Q5's acceptance (:428) demands "97/3 renders 97/3" — proportional truth. But the prototype itself (`xdc-template.html:719, :722`) puts `min-width:46px` on *both* bar segments because it renders 12px IBM Plex Mono percentage labels *inside* the segments; a 3% segment cannot hold "3%" at that type size. The acceptance criterion and the label-inside invariant are mutually exclusive, and the blueprint asserts both without noticing. FULL-MIGRATION-REPORT:270 actually contains the resolution — proportional widths with external labels for tiny segments — but the Q5 queue row never absorbed it, so an implementer working from the queue alone would have had to rediscover the conflict mid-build or, worse, silently pick one side. Register entry 6 merges the remediation into the acceptance line. The lesson: **when two documents share authority, acceptance criteria must be self-contained**, because implementers execute queue rows, not appendices.

## 4. Incompleteness where the code moved, and guilt where the code stood still

The third tissue type is staleness: places where the code evolved after the audit snapshot. The clearest case is `server/stripeWebhook.ts:221-238`, which now contains a `listLineItems` price→plan resolution block — metadata `plan_id` first, else look up the session's price via `getPlanByPriceId` — that neither document mentions (I grepped both; zero hits). This is a *mitigation* the blueprint doesn't know it has, but crucially it does not retire the blueprint's Q19 hazard: pack prices will not be in the subscription plan map, so `normalizePlanId` (server/stripe/products.ts:111-114) still defaults an unknown price to `"monthly"`, and the misfulfillment walk-through (§17-B) remains exactly as dangerous. Similarly, Q9's file list names `Profile.tsx`, `ManageAccount.tsx`, and the appUsers router — but `app_users` (drizzle/schema.ts:45-136) has no display-name column at all, and the router's only user-record mutation, `updateUser`, is owner-gated. "Name persists" requires a schema migration the queue never scheduled, on a platform where schema changes demand the manual `db-push.yml` workflow before any code deploy. A wave-3 implementer hitting that discovery mid-sprint is a schedule slip; hitting it in the corrections register is a line item.

Then there is the fourth category, the most important for risk posture: **places where the blueprint was right and the code is guilty.** These are confirmed defects, not documentation issues, and I verified each in the source:

- **Abort fallthrough** (`server/dime-wc2026.route.ts`): `responseMode` initializes to `"ANSWER"` at :619, *before* streaming; the client-abort handler sets `aborted` at :608; the catch block (:649-651) wraps its entire error path — including its `return` — in `if (!aborted)`. An aborted stream therefore skips the catch and falls through to STEP 13 (:685+), which deducts credits because `responseMode` is still `"ANSWER"`. A user who disconnects mid-answer is charged. The owner has explicitly deferred the policy decision (D9, blueprint:413), which is legitimate — but the deferral must not become silent porting.
- **The virtual-100 seam** (same file, :129 and :163): balance reads are `COALESCE((SELECT balance_after … ORDER BY id DESC LIMIT 1 FOR UPDATE), 100)`. The `FOR UPDATE` protects users who *have* ledger rows; a user with none has no row to lock, and the 100-credit default is a fiction two concurrent first requests can both read. The sole runtime insert (:177) writes only negative deltas — verified by exhaustive grep, register-relevant because Q19's `+N` pack insert will be the ledger's first-ever credit-side writer.
- **Subscription-id clobber** (`server/stripeWebhook.ts:52-86`): `grantUserAccess` writes `stripeSubscriptionId: params.stripeSubscriptionId` unconditionally; the caller derives that value with a `?? ""` fallback (:240-241), so any mode:"payment" session reaching this path would blank a real subscriber's subscription id. Adjacent and equally quiet: the function's first act on a DB outage is `if (!db) { console.error(…); return; }` — a *paid* grant swallowed with a log line, no retry, no dead-letter.

The blueprint documented the shape of most of these risks; testing converted them from prose warnings into cited, line-anchored defects with verified reproduction. That conversion is what an implementation session actually needs.

## 5. The systemic findings no squad owned — and why they outrank the queue

Four findings emerged only in aggregate, and I argue they matter more than any single Q-item because they are properties of the *platform*, and every queue item inherits them.

**The verification vacuum.** The repository, opened fresh, cannot verify itself: `node_modules` contains exactly one entry (`typescript`, with an empty `.bin`), so neither vitest nor a full `tsc` gate runs in-tree; `tsconfig.json:3` excludes `**/*.test.ts` from typecheck; `vitest.config.ts` include globs omit `shared/` entirely; `package.json` carries runtime `playwright` (^1.58.2) but not `@playwright/test`; and the postinstall hook (`package.json:17`) pip-installs a `requirements.txt` that does not exist, its failure permanently masked by `|| true`. Squad 2 proved the tests themselves are sound — 37/37 green on vitest 2.1.9 via byte-identical out-of-tree copies (I diffed all six files and read the results manifest myself) — which sharpens the point: the test suite is healthy and the *harness around it* is broken. Four squads independently hit this wall; that convergence is itself evidence. Every acceptance criterion in the queue is unenforceable until this is fixed, which is why it heads the execution doctrine below.

**Theme fragmentation.** Dark mode currently rests on four uncoordinated mechanisms: a hardcoded `class="dark"` in `client/index.html:2`; Tailwind's `@custom-variant dark (&:is(.dark *))` keyed to that class (`client/src/index.css:4`, feeding 43 `dark:` usages I counted); a bespoke `ThemeContext` provider (`App.tsx:207`); and a providerless `next-themes` `useTheme` inside `sonner.tsx:1` that silently reports "system." On top of this, `DimeChatPage.tsx:531` coerces every non-"light" theme to "dark" — so the mint theme D1 declares "first-class, sitewide, non-negotiable" would render as dark chat today. No single Q-item owns this; Q1/Q2 touch it, but the fragmentation is a precondition for the *entire* design chain, and shipping mint atop it would produce four different opinions about what theme the user is in.

**The double-run scheduler hazard.** `server/_core/index.ts:697` gates background jobs on the exact string `'1'`, while `.github/workflows/cron-vsin-odds.yml` POSTs `/api/cron/vsin-odds` every 15 minutes. A Railway instance deployed without `DISABLE_BACKGROUND_JOBS=1` (or with `true` instead of `1`) runs VSiN refresh twice on overlapping cadences. This intersects the deploy migration directly: the platform currently lives under *two deploy laws* — Manus production where merging `main` deploys nothing, and the incoming Railway/Vercel world where it deploys everything — and the scheduler flag is exactly the kind of environment contract that shears when the law changes mid-migration.

**The verified-math foundation, stated positively.** Against these hazards sits one systemic *asset* testing established: the edge/ROI mathematics in `edgeUtils.ts` is exact, internally consistent, and reproduces the design source six-for-six. The migration's most user-visible numbers rest on verified ground. (One caveat survives: `server/splitsAndEdge.test.ts:150` tests a *mirrored copy* of `formatRoi` that has already drifted from production — `'—'` at :175 versus `''` at edgeUtils.ts:237 — a small live demonstration of why the doctrine below bans mirrors.)

## 6. The execution doctrine

The consolidated sequencing, with its non-negotiable laws:

**Phase 0 — restore verifiability.** Fix the install path (requirements.txt or a guarded postinstall), reinstate dependencies, add `shared/**` to vitest globs, decide the `@playwright/test` question, and reconsider the tsconfig test exclusion. Nothing downstream is *checkable* until this lands; it converts every acceptance criterion from prose to gate.

**Design chain: D5 → Q2 → Q1 → Q3 → Q4.** MASTER.md's mint column (with the corrected ≥0.64/0.65 alpha) is signed first, because tokens flow downhill; Q2 lays the shared token layer and retires the purple `--primary`/`--accent` (`oklch(0.55 0.18 275)`, index.css:125/:134, consumed today at ManageAccount.tsx:120/:164/:314 and BettingSplits.tsx:446/:452/:637); Q1 collapses the four theme mechanisms to one and deletes the DimeChatPage coercion; only then do surface reskins proceed.

**Money chain: Q19 first, always.** The sequencing laws, each defended by a verified defect: (1) **the webhook `session.mode` branch ships before any pack price exists** — the price→plan fallback does not cover packs, "monthly" remains the default, and `grantUserAccess`'s unconditional subscription-id write is loaded; (2) **auth unification (Q7, at dime-chat.route.ts:91) precedes any charging**, because metering without identity is unattributable; (3) **db-push precedes dependent code, every time** — Q19's dedup store and Q9's display-name column both need it, and the platform's deploy law makes schema drift a production incident; (4) **tests import real functions, never mirrors** — the splitsAndEdge drift is the standing exhibit; (5) **Q7b resolves D9 explicitly at build time** — the abort fallthrough must be decided, not ported.

**Ownership rule: GameCard belongs to Q5.** Both Q5 and Q16 name `GameCard.tsx`; two owners of one 3,000-line file is a merge conflict scheduled in advance. Q5's rebuild sweeps GameCard's neon in place; Q16 takes the remaining feed components in per-component batches; the shared exit gate is a case-insensitive grep to zero (the counts are known: 252 `#39FF14` + 1 lowercase, 116 lines of `rgba(57,255,20`, 8 chartreuse hexes).

## 7. Readiness, honestly stated

For Wave 1, the honest statement is: **verified-ready to build, not yet able to prove it built correctly.** What is now *verified* rather than believed: the chat core's parser and reducer semantics (37/37 green, single-regex degradation behavior confirmed at edgeParser.ts:111); the ROI mathematics; the exact contrast floor; the precise inventory of brand violations; the webhook's real current behavior including its undocumented mitigation; the ledger's single-writer negative-only state; the abort fallthrough's exact control flow. What remains *believed*: anything requiring a running system — DB-dependent test outcomes, deploy behavior on Railway, the scheduler flag's production setting — all blocked behind Phase 0.

The open owner decisions — D2a pack pricing, D9 abort policy, D5 mint-column sign-off, D6 saves — block no preparation. Each is a parameter, not a prerequisite: Q19's branch structure is identical at any pack price; Q7b's code path is identical whichever way D9 resolves (the point is that it resolves); D5 is a one-value amendment now that the correct floor is computed. Preparation can run to the edge of every one of these decisions without crossing it.

## 8. Closing judgment

The process worked, and it is worth saying precisely why. Squads with narrow adversarial mandates generated claims; a supervisor with no authorship stake reproduced every claim from primary evidence — reran the script, redid the arithmetic, re-read the control flow — and the two layers agreed 28 times out of 28 while still finding eight faults in the governing document. That is the property you want from an audit: the *method* catches what any single pass misses (the ROI refutation existed only because one squad executed math instead of comparing pixels; the alpha error existed only because the supervisor recomputed rather than trusted), and disagreement, had it occurred, would have surfaced as evidence conflicts rather than opinion conflicts. The owner should run future audits exactly this way, and should treat any spec number that lacks a reproducing script as unverified by default.

Finally, the standing rule, confirmed at both ends of this engagement: the working tree is clean at `c0fcb05`, nothing was committed, nothing was pushed, no repository file was written. The entire body of work — five squad passes, twenty-eight verifications, eight corrections, one doctrine — is evidence and specification only. It executes nothing and authorizes nothing. It waits, as it should, on an explicit go.


---

# PART II.1 — SQUAD 1 THESIS: Theme & Design Foundation (Q1–Q4, Q16)

# The Foundation Is Sound; the Specification Is One Alpha Value and Four Grep Patterns Away From Failing Itself

## Thesis

Squad 1's testing of work-queue items Q1, Q2, Q3, Q4, and Q16 proves a single central claim: **the Dime theme and design foundation is architecturally ready for the three-theme migration — every load-bearing structure the blueprint assumed was verified present and extractable — but the blueprint's acceptance criteria are calibrated against incomplete measurement, and if executed as written, Wave 1 would merge work that fails its own tests.** The gap is not conceptual. It is arithmetic and enumerative: a contrast fix proven only on the theme canvas but not on the surface where the token is actually used; a neon-debt count that captures 252 of roughly 418 real occurrences; a purple fence whose perimeter excludes two Dime-wave surfaces that demonstrably render purple today. None of this blocks the migration. All of it must be re-specified before the first Wave 1 PR, because each defect lives in an acceptance criterion — the exact place where "done" gets decided.

## One theme, four mechanisms

The blueprint's Q1 diagnosis — "three mechanisms coexist" — understates the fragmentation by one, and its file list understates the edit surface by four files. Verified live today: the app shell is dark-locked by a hardcoded class (`client/index.html:2`, `<html lang="en" class="dark">`) that `ThemeContext.tsx:33-38` maintains via `classList`, typed `"light" | "dark"` with an unvalidated localStorage cast at `:27`; `App.tsx:207` pins `defaultTheme="dark"` with no toggle consumer anywhere in the tree. The chat surface runs a parallel system — `.theme-dark`/`.theme-light` classes plus a `data-theme` attribute mounted at `DimeChatPage.tsx:799` *and* at `:483` inside ViewportGate, a second mount point the blueprint never cites. Tailwind's `dark:` variants hang on a third mechanism, `@custom-variant dark (&:is(.dark *))` at `index.css:4`, feeding 42 usages across 18 files. And a fourth mechanism was found undocumented: `components/ui/sonner.tsx:1` imports `useTheme` from `next-themes` (`package.json:79`) with no provider mounted, so the global `<Toaster/>` at `App.tsx:209` silently follows the OS color scheme on every Dime surface, including future light and mint ones.

The good news the greps delivered: **no component anywhere reads `documentElement.classList` or `data-theme` directly**, and no CSS selector in the repo keys on `[data-theme]` at all — the attribute at `:483`/`:799` is write-only. Unification therefore has no hidden consumers to break; it has only writers to consolidate. But the ordering D5→Q2→Q1→Q3→Q4 is not a preference — it falls out of the acceptance criteria themselves. Q1's exit condition is "chat + shell follow it in all three themes," which is unmeetable before the mint token block exists in `dime-tokens.css`; Q2's exit condition is "tokens match amended MASTER," which is unmeetable before the D5 mint column lands. Q3 extracts the sidebar from the same file Q1 edits (`DimeChatPage.tsx:140-296`), so sequencing them avoids rebase churn; and Q3 itself tested clean — the sidebar closes over exactly two props (`onNewChat`, `recentChats`) and one piece of local state, with the supposed width conflict already resolved in the repo's favor (`frozen-tokens.css:144` declares 264px, matching feed-draft law at `DIME-FEED-MIGRATION-DRAFT.md:98`; only the tablet tier 216–240 lacks a ruling). Q4's `@custom-variant` edit shares `index.css` with the token work and belongs with Q1: removing `class="dark"` without extending that variant kills all 42 `dark:` usages in one stroke — and `index.css:4` is absent from the blueprint's Q1 file column.

## The contrast mathematics: proven on the canvas, failing on the surface

The D1 ruling adopted the prototype's mint block (`xdc-template.html:282-296`) with one correction — `--text3` alpha raised from 0.52 to "≥0.62" — and cited a single computed proof: 4.64:1. My contrast script reproduced that number exactly. It is true. It is also true *only on the canvas*. The mint theme's `--surface2` is `rgba(11,11,15,0.08)` composited over `#45E0A8`, yielding roughly `#40CF9C`, and `--text3` at 0.62 composited onto that surface measures **4.32:1 — a WCAG failure**. This is not hypothetical usage: the prototype renders `--text3` directly on `--surface2` at template lines 561 and 601 — the 11px IBM Plex Mono meta strips on every match and prop card, precisely the small mono text where 4.5:1 is non-negotiable — plus the active states of four icon buttons (`:375`, `:458`, `:613`, `:615`). The alpha sweep shows 0.64 is the first passing value (4.56:1) and **0.65 buys comfortable margin everywhere**: 4.69:1 on the worst surface, 5.07:1 on canvas, passing on all six mint surfaces including the `#EDEDF2` work-bg. The D5 amendment must say 0.65, not "≥0.62," and the Q2 contrast script must iterate the full text-token × surface matrix — the canvas-only proof is exactly the class of gap that produced this defect.

The same exhaustive sweep surfaced something more uncomfortable: **MASTER.md contradicts itself.** The law assigns light-theme `--text-muted` the value `#9A9AA8` (`MASTER.md:39`) for 10–11px mono labels, yet that value measures 2.27–2.78:1 across every light surface — below even the 3:1 large-text bar — while the law's own pre-delivery checklist demands "text contrast 4.5:1 minimum (both themes)" (`MASTER.md:238`). Related and previously unmeasured: `#0FA36B` mint text survives its large-text exemption only on canvas (3.24:1) and card (3.03:1); on the sidebar (2.95), raised (2.66), and bubble (2.85) surfaces it fails at *any* size. The D5 amendment is the moment to resolve both — darken the light muted tier or confine it to decorative use, and write the `#0FA36B` surface conditions into law — because Q2's acceptance criterion is otherwise unmeetable as written.

## The neon debt is 66% larger than counted

The blueprint's figure of 252 `#39FF14` occurrences verified *exactly* — a credit to the audit. But "definitive" requires the full pattern family, and the family is larger: one lowercase `#39ff14` (`PublishProjections.tsx:2201`) that a case-sensitive grep misses; **116 occurrences of `rgba(57,255,20,…)`** — the same neon in alpha form — across 15 files including GameCard, OddsHistoryPanel, and the BetTracker suite; 8 occurrences of the intermediate tier hexes `#7FFF00`/`#ADFF2F`; and **41 server-side occurrences**, most of them test fixtures (`server/splitsAndEdge.test.ts`, `gameCardEdgeGate.test.ts`, the wc2026 tests) that assert the very colors being removed — meaning each component batch that swaps a hex without shipping its fixture update breaks CI. The true debt is ~418 occurrences across four patterns and two tiers of the stack.

The swap-difficulty sampling matters as much as the count. `MobileOwnerBottomTabs.tsx:41/:44` is mechanical — a constants block — though entangled with a "PERMANENT — DO NOT CHANGE" comment (`:6`) that D1 now supersedes, and telemetry that logs the hex values (`:73-90`). `GameCard.tsx:1520-1536` is semi-mechanical: conditional `isEdge` branches over five alpha variants of neon, plus an off-brand orange `#F5A623` that appears in no count at all; it needs alpha-capable mint tokens from Q2, not find-replace. But `edgeUtils.ts:110-118` — duplicated at `useEdgeCalculation.ts:41` — is genuinely entangled: `getEdgeColor()` is a six-tier return-value scale ending in red `#FF2244`, and MASTER.md:216 bans red for negative edge outright. That swap is a design decision (mint / dimmed-mint / grey tier mapping), not a substitution, even though the thresholds themselves stay untouched. The acceptance criterion must therefore be a **ratchet, not a snapshot**: a CI grep over the four-pattern set whose count may only decrease, with fixture updates in the same PR as each component batch.

## The mint doctrine and the violation hiding in a namespace

D1a's ruling — all mint is brand `#45E0A8`, everywhere, with `#0FA36B` surviving only as text-on-light — was swept against every proposed value in both audit documents. The dark and mint blocks comply fully. The violation hides in the light theme's splits namespace: `--sp-mint: #0FA36B` (template `:277`) is a **fill** — it paints the split bars and ROI chips — paired with `--sp-bar-ink: #FFFFFF`, white ink on `#0FA36B` at 3.24:1. Both documents state the generic correction ("fills stay #45E0A8") but neither names `--sp-mint` or `--sp-bar-ink`, and Q5's acceptance doesn't catch it; an implementer copying the sp-namespace verbatim ships a D1a violation and a contrast failure in one move. The corrected pair — `#45E0A8` fill, `#0B0B0F` ink — measures 11.68:1. The same doctrine reaches the derived washes: light `--mint-soft`/`--mint-border` are `rgba(15,163,107,…)`, alternate-green derivatives that should rebuild from `rgba(69,224,168,…)`.

## What must be true before Wave 1 merges

The risk posture is favorable: no blocked items, no architectural unknowns, and the repo repeatedly turned out *better* than the blueprint assumed — sidebar already at law width, wordmark already spec-correct, no rogue theme readers. The residual risk is entirely specification risk, and it closes with five preconditions. First, D5 amends MASTER with the mint column at `--text3` alpha **0.65**, the light `--text-muted` resolution, and the `#0FA36B` surface conditions. Second, Q1's file list grows to its verified twelve touchpoints — including `index.css:4`, `DimeChatPage.tsx:483` and the mint-coercing ternary at `:532`, `conversation.css`'s 27 theme-scoped rules, and a decision on sonner. Third, Q4's fence perimeter annexes `ManageAccount.tsx:120/:164/:314` and `BettingSplits.tsx:446/:452/:637`, where purple provably renders on Dime-wave surfaces today. Fourth, Q16's acceptance becomes the four-pattern ratchet with lockstep fixture updates. Fifth, the light `--sp-mint`/`--sp-bar-ink` correction is written into Q5 by name. With those five amendments, the order D5→Q2→Q1→Q3→Q4 is not just right — it is the only sequence in which every item's acceptance criterion is satisfiable at the moment it is tested.

*(Verdicts: Q1 PASS-WITH-DRIFT · Q2 PASS-WITH-DRIFT · Q3 PASS · Q4 PASS-WITH-DRIFT · Q16 PASS-WITH-DRIFT. Contrast script and full 38-pair output: scratchpad `squad1/contrast_check.py`, `contrast_output.txt`. No repo files were modified.)*


---

# PART II.2 — SQUAD 2 THESIS: Chat & Conversation Surfaces (Q11–Q14)

# Squad 2 Thesis — The Chat Surface Is Nearly Done; What Remains Is One Architectural Decision

## The central claim

The Dime chat surface is in far better shape than a work queue with four open items suggests. Every line of pure logic under `client/src/pages/dime-chat/` — the fenced-block parser, the message reducer, the recents derivation — is tested and green: 37 of 37 tests pass (12 chatReducer, 15 edgeParser, 10 recentChats), verified by executing verbatim copies under vitest 2.1.9 after the in-repo run was blocked by an entirely absent `node_modules` (0 entries, installs forbidden). The streaming core is equally solid: a single `AbortController` per stream (`DimeChatPage.tsx:550,572-573`), a typed SSE frame dispatcher (`:611-626`), and abort semantics the reducer proves in four dedicated tests (empty-row removal, mid-stream partial preservation, for both error and abort). Q13 and Q14 are, respectively, a ten-line reducer addition and a skinning exercise over libraries already in `package.json`. Q12 is gated by other squads' items (Q7, Q10), not by anything in this folder.

That leaves one genuinely open question, and it is the thesis of this report: **Q11's "[EDGE] grammar v2" is a false premise, and the only card architecture consistent with the blueprint's own laws is server-emitted JSON frames, not an extended text grammar.** Everything else in Squad 2's scope is execution; this is the decision the owner actually has to make.

## Why "grammar v2 as extension" cannot work

The v1 grammar carries six flat fields — `verdict`, `market`, `modelLine`, `marketLine`, `edgePct`, `confidence` (`edgeParser.ts:22-29`) — parsed by a single regex (`BODY_RE`, `:45-46`). It is a small masterpiece of defensive design: prefix-stable while streaming (a partial `[EDGE` never flashes as visible text, proven by an exhaustive every-prefix test at `edgeParser.test.ts:114-121`), and honestly degrading (a malformed-but-closed block falls back to raw text rather than a broken card, `edgeParser.ts:111`).

But the prototype's match card (xdc-template.html:508-562, fixtures at dc-script.js:148-198) needs `probs[]` with two to three labeled percentages, three free-text `drivers[]` sentences, a free-text `risk` sentence, projected score, totals, and a book/fair/edge price grid. The prop card (:566-603) needs a *list* of ranked player entries, each with its own evidence array. The flat `key=value` line cannot represent lists at all, and its one concession to multi-word values — `market=(.+?)` matched lazily up to the literal ` model_line=` — only survives because exactly one multi-word field exists in a fixed order. Add a second free-text field and the grammar collapses. "Extending" v1 therefore means inventing new syntax, at which point you are writing JSON inside fences anyway.

The server side compounds this. `DIME_SYSTEM_PROMPT` (`server/dime-chat.route.ts:47-51`) constrains the grammar twice: the model may emit "exactly one fenced verdict block… in exactly this format," and — critically — "the block summarizes numbers already established in the conversation; it is never a source of new ones." A prop-card list violates the one-block rule outright; more fundamentally, any text grammar the LLM emits is by construction *model-authored*, while the blueprint's boundary map (FULL-MIGRATION-REPORT §21) and implementation law (§16) declare model prices, edges, and ROI **server-authoritative** — `edgeUtils` and the `games` table are the only sources, "never client-invented" and never fixture numbers. A grammar that asks Claude to write the card's prices is a compliance hole dressed as a feature.

The clean alternative is already half-built. The client's frame loop dispatches on `event.type` — `delta`, `meta`, `error`, `done` — so a `{type:"card", card:{...}}` frame is purely additive to a protocol that Q7b is about to extend anyway (with `INSUFFICIENT_CREDITS` and `creditsCharged`). Under this design the model emits at most a lightweight intent (a game reference), and the server hydrates real numbers from the database before flushing the frame. Persistence has a reserved slot: the data contract's `Message.edgeBlocks?` field (§22). Two cross-cutting rules survive any option: logos must resolve through the repo's `TeamLogo`/ESPN registry (the prototype's logo component does not exist here), and the ARIA sentence (dc-script.js:169, 198, 424) is derivable client-side from card data — it belongs in no grammar. One deployment caveat: an unknown v2 fence on a v1 client renders as raw visible prose (honest degradation working as designed, but ugly), so client and server ship together or blocks carry a version.

## Reuse over build: the focus-trap question is already answered

Q14 asks for focus-trapped `<DimeSheet>/<DimeDialog>` primitives, and the temptation in a frozen-design codebase is to hand-roll them. The inventory says don't. `package.json` carries `@radix-ui/react-dialog@^1.1.15`, `react-alert-dialog`, `react-dropdown-menu`, and `vaul@^1.1.2`; `client/src/components/ui/` contains the full shadcn set — `dialog.tsx` (with a composition-aware Escape guard at `:96-130`), `sheet.tsx` (built directly on `@radix-ui/react-dialog`, i.e. the HistoryDrawer chassis), `alert-dialog.tsx` (the logout/cancel confirm), and `drawer.tsx` (the vaul bottom sheet the credits and membership sheets want). Radix supplies focus trap, initial focus, restore, Escape, and `aria-modal` for free. DimeSheet and DimeDialog should therefore be *skins*, not components — thin Dime-token wrappers, with one sharp caveat: the shadcn wrappers are styled with the purple oklch variables that Q4 explicitly fences off from Dime surfaces, so the wrappers should compose the *unstyled* Radix primitives with `frozen-tokens.css` classes rather than import shadcn's dressed versions.

The urgency is real, because today the target surfaces have essentially no focus management. The DimeChatPage account menu (`:237-275`) has Escape-and-outside-click closing but no trap, no restore, and inert `div role="menuitem"` children. ManageAccount's cancel-subscription confirm (`:348-392`) is a plain fixed div — no `role="dialog"`, no `aria-modal`, no Escape. LoginModal (`:73-95`) has the roles but no trap and no initial focus. Meanwhile the fully-managed Radix components sit unused three directories away. On the live-region half of Q14: the chat's only announcement today is `role="status"` on the pre-first-delta typing dots (`:446`), and notably the *prototype has no stream live region either* — its only `role="status"` is the toast (:1021). Q14's "SR announces stream completion" acceptance is an improvement beyond the prototype, best met with a visually-hidden status node fired on `stream_done`, never by announcing raw deltas.

## The persistence gap and the localStorage trap

Q12's current state is deliberately, honestly minimal: `recentChats.ts` is a module-level in-memory array whose entries render as inert anchors (`DimeChatPage.tsx:205`, `onClick` → `preventDefault`) and vanish on reload. The reducer assumes a single conversation in three specific ways: no `conversationId` anywhere in `ChatState`; no hydrate action in the action union (the only path to a non-empty thread is replaying sends); and a conversation-global `dataFreshness` flag. All three fixes are additive — one `hydrate` action, nothing existing changes, all 12 reducer tests stay valid.

The router surface needed is exactly blueprint Q10's "CRUD + list-by-user": `list`, `create`, `rename`, `delete` (soft, via `deletedAt` per §22), `get`. Search stays client-side, as the prototype does (dc-script.js:693). But two gates are non-negotiable. Message writes cannot flow through tRPC alone — assistant content finalizes inside the Express SSE route, so `dime-chat.route.ts` must persist on `done`, and that requires the stable `user_id` that only Q7's `app_session` adoption provides (today's `sdk.authenticateRequest` at `:92` yields no scoping identity). And the migration draft's Phase D staging — "localStorage first, `dime_conversations` table later" (DIME-FEED-MIGRATION-DRAFT.md:135-138) — is a trap the blueprint has already superseded: a localStorage interim cannot satisfy Q12's "rename persists" acceptance and is throwaway code. Consistent destination, wrong staging; the blueprint governs. One latent risk to decide before restore ships: `MAX_HISTORY = 24` (`route:26`) silently truncates hydrated long conversations' model context.

## Small items, sequencing, and the verdict

Three sharp small findings. Regenerate is *almost* free: abort machinery and history-parameterized `runStream` mean "abort + re-stream" needs no streaming changes, but the reducer can only remove an *empty* assistant row (`closeRow`, `chatReducer.ts:60-68`) — in-place replacement, as the prototype does (dc-script.js:329-337), needs one additive action. Clipboard has a repo precedent that exactly matches the acceptance: `UserManagement.tsx:598-601` awaits `writeText` before toasting — copy that, not `ClaudeAssistant.tsx:60`'s fire-and-forget, and note the acceptance is deliberately stricter than the prototype's own unconditional toast (dc-script.js:444). And follow-up chips appear in the prototype (:622-627) and the §15 test matrix ("followup chip → send") but in *no* Q-item — orphaned scope, nearest home Q11.

Verdicts: Q11 PASS-WITH-DRIFT, Q12 PASS-WITH-DRIFT, Q13 PASS, Q14 PASS-WITH-DRIFT (REUSE). Sequencing: Q11 is functionally independent of Q7b, but both rewrite `dime-chat.route.ts` and — under Option B — the same SSE frame vocabulary, so the parser generalization and card components should build against fixtures (`__fixtures__/` is already planned in §20) during W3 with zero conflicts, while route, prompt, and frame wiring land after Q7b. Build on this foundation rather than around it: the tests are green, the primitives are installed, and the only real decision — who authors the card's numbers — has, by the blueprint's own laws, already been made.

*(~1,510 words)*


---

# PART II.3 — SQUAD 3 THESIS: Splits & Feed Data (Q5, Q20)

# Squad 3 Thesis — The Splits Prototype Is Already Running Your Math: The Migration Is a Rendering Problem, Not a Modeling Problem

## 1. The central finding: six-for-six, to the hundredth

The most consequential thing Squad 3 established is small enough to fit in one test run. We took the prototype's Braves/Pirates fixture — every book price, every model price, from `dc-script.js:534-556` — and pushed it through the platform's actual production edge functions, imported directly from `client/src/lib/edgeUtils.ts` via Node type-stripping (no copies, no reimplementation; script at `scratchpad/squad3/edge-check.mjs`). The result:

```
Moneyline | Pirates ML   | -110 | -135 | 5.07pp | true | +14.89% ROI | +14.89% ROI | MATCH
Run Line  | Pirates +1.5 | -168 | -189 | 2.71pp | true | +9.05% ROI  | +9.05% ROI  | MATCH
```

All six market sides match: both ROI chips to the hundredth of a percent, all four "no chip" sides correctly suppressed, and the prototype's model-favored highlight flags (`hi:'B'` on Run Line and Moneyline, `hi:null` on Total, dc-script.js:534-543) exactly reproduce `calculateEdge ≥ EDGE_THRESHOLD_PP` (edgeUtils.ts:79-84,141). The Total market is the telling case: the Over shows *positive* raw ROI (+1.56%) but *negative* edge (−1.61pp), and both the prototype and the platform's Option-B rule (edgeUtils.ts:5-22) suppress the chip. Nobody stumbles into that consistency with invented numbers. The prototype's splits page was authored *from* the platform's own math.

This formally corrects any residual reading of the blueprint that treats the prototype's edge numbers as design artifacts to be replaced. They are not artifacts; they are `calculateRoi`/`formatRoi` output (edgeUtils.ts:191-205,236-240) rendered in different clothes. The practical conversion is large: Q5 stops being "rebuild edge computation for a new page" and becomes "rewire existing computation into new markup." The proof is already in the code path — the ROI chips users see on `/feed` are computed inside `DesktopMergedPanel` (`GameCard.tsx:1016-1044`, rendered `:1319-1359`) from fields on the same `game` object that splits mode already passes to `BettingSplitsPanel` (`GameCard.tsx:3260-3272`). The only reason the splits page shows no chips today is that `DesktopMergedPanel` renders exclusively under `mode === "projections" || mode === "full"` (`:3146`), while `BettingSplits.tsx:656` mounts `mode="splits"`. Enabling chips there is a props-and-placement change with zero new formulas. A second consequence: the prototype fixture is now certified safe as a Playwright/visual-regression baseline — its numbers can never diverge from what the platform computes, satisfying the §15 gate that "edge/ROI values match `edgeUtils` output (never artifact numbers)" by construction.

## 2. The guard asymmetry, and what any new reader must copy

The blueprint's claim that only spread markets are server-protected against VSiN's 0%/0% "market not open" sentinel is confirmed at every cited line — and it is slightly better and slightly worse than documented. Confirmed: skip-write guards exist for spread/run-line only (NBA `vsinAutoRefresh.ts:196-199`, NHL `:230-233`, MLB `:742-752`), while totals and moneyline are written unconditionally (`:200-203`, `:234-237`, `:761-764`), so raw zeros land in the live `games` row. Worse than documented: the desktop merged panel's own client guard covers *spread only* (`GameCard.tsx:1052-1059`); totals/ML percentages flow through raw (`:1060-1063`) and depend on `BettingSplitsPanel`'s `bothZero` check (`:316-318`) downstream. Better than documented: the odds-history snapshot path applies the *full* three-market guard before insert (`vsinAutoRefresh.ts:1157-1191`), so `odds_history` is clean where `games` is dirty.

The doctrine for Q5 follows directly: any new UI reading splits from `games` must replicate the `bothZero → "not yet available"` transform for totals and ML, or it will render the false 100% bar the guard exists to prevent. Alternatively, extend the server guard to all three markets — but note the trap: the guard's "preserve existing DB value" semantics (`:747-752`) means preserved splits are silently *old*, which is exactly the invisibility Q20 exists to fix. Don't extend the server guard without shipping freshness alongside it. One more Q5 item verified while we were in there: the `/splits` self-link bug is real and one line — the active tab links to `/splits` (`BettingSplits.tsx:541`) which `App.tsx:137` redirects to `/feed`; the page actually lives at `/betting-splits` (`App.tsx:164`).

## 3. Freshness: the feature is half-built and nobody wired the last inch

Q20's premise — no `splitsUpdatedAt`, staleness invisible — is confirmed and then some. The `games` table (schema.ts:188-639) carries only insert-time `createdAt`; no update timestamp of any kind; zero hits for `splitsUpdatedAt` across the codebase. The archaeology is even conclusive: `.manus/db/db-query-error-1774903409734.json` preserves a failed production query that tried to SELECT `splitsUpdatedAt` from `games` — someone already needed this column and hit the wall.

But the stronger finding is that the *client half of the feature already exists as dead code, twice*. Both `BettingSplits.tsx:375-387` and `ModelProjections.tsx:806,906-915` query the public `games.lastRefresh` endpoint (`routers.ts:548-550`, backed by the in-memory `lastRefreshResult.refreshedAt` set at each VSiN cycle, `vsinAutoRefresh.ts:55-79,1346`) and compute a fully-formed `splitsAgoLabel` ("just now" / "N min ago" / "N hrs ago") — and in both files that variable's only occurrence is its declaration. It is never rendered. The cheapest possible Q20 MVP is inserting an existing string into JSX.

For per-game accuracy, two upgrade paths, tested: (a) the no-schema proxy — `odds_history` rows carry `scrapedAt` (schema.ts:865) plus all six splits columns, inserted every cycle with the clean guard, and `oddsHistory.listForGame` (`routers.ts:1121-1133`) already returns them newest-first. Viable, but lossy in both directions: snapshots copy splits from the `games` row, so a failed VSiN scrape gets restamped fresh; a frozen game gets no snapshot at all; and the router is premium-gated. (b) The correct fix — one additive nullable `bigint splitsUpdatedAt` on `games`, stamped at the three write sites (`vsinAutoRefresh.ts:198,:232,:753`), `db-push.yml` first. With one honest caveat: because the RL guard preserves old values, a single per-game timestamp will overstate run-line freshness whenever RL was skipped while totals/ML wrote — acceptable if the "not yet available" state keeps carrying that meaning.

## 4. Two forms of quiet rot: the acceptance criterion and the test mirrors

Q5's acceptance line "bars width:% (97/3 renders 97/3)" cannot ship as written, and the prototype itself is the witness. The platform's bars carry deliberate min-width guarantees so the percentage label always fits inside its segment (mobile 40/30px, desktop 58/50px — the exact invariant `server/splitsBar.test.ts` exists to protect), and the prototype's own segments carry `min-width:46px` (xdc-template.html:722,725). Neither renders a literal 3% sliver; both render "flex-grow proportional to data, floored by the label guarantee." Proposed rewording: *"segment flex-grow equals the data percentage; visual width may be floored by the label-inside min-width guarantee; labels never render outside their segment; 0% renders nothing."* That keeps the intent (no fabricated proportions) without putting the criterion at war with a tested invariant the prototype honors too.

The second rot is live, not hypothetical. Both splits test suites (`splitsBar.test.ts`, `splitsAndEdge.test.ts` — DB-free, vitest-only imports; our execution was blocked solely by the absent `node_modules`, not by any database dependency) test *mirrored inline copies* of production logic rather than importing it. The mirror has already drifted: the test copy's `formatRoi(NaN)` returns `'—'` (`splitsAndEdge.test.ts:175`) while production returns `''` (`edgeUtils.ts:237`). Today that drift is cosmetic; structurally it means the suites can stay green while the functions they claim to validate change. Q5 should convert the mirrors to direct `edgeUtils` imports as part of touching these surfaces — the same session, not a someday ticket.

On bars and brand: current panels paint segments in *team colors* (`getGameTeamColorsClient`, BettingSplitsPanel.tsx:14,590), which D1a forbids — mint is THE color. The prototype's answer is the right doctrine: one mint segment against a neutral track (`--sp-mint`/`--sp-track`), identity carried by labels and logos, percentage ink via `--sp-bar-ink` for contrast inside mint. What's lost (instant team-side recognition) the prototype recovers with side labels flanking each bar. Adopt it wholesale; also unify the label drift Q5 already names — desktop says "Handle" (`:567`), mobile says "Money" (`:343`), prototype says "Money" — and centralize market naming, since `BettingSplitsPanel` still titles MLB's first market "Spread" (`:658,:688,:726`) while `GameCard.tsx:1275,1342` correctly says "Run Line."

## 5. Sequencing: one owner for GameCard

Q5 and Q16 are both W2 and both claim `#39FF14 = 0` in overlapping files. The efficient order: Q5 first on the splits surfaces (`BettingSplits.tsx`, `BettingSplitsPanel.tsx`), because the reskin deletes or replaces most of the styling Q16 would otherwise retokenize — sweeping first is wasted work plus guaranteed rebase conflict. Q16's per-component batching runs in parallel everywhere else (OddsHistoryPanel, BetTracker*, Mobile*, Calendar*) immediately. GameCard.tsx goes last, under a single-owner rule: exactly one queue touches it, after Q5 settles which splits-mode markup survives and whether the EdgeVerdict chips get wired into splits mode. The math needs no owner at all — as Section 1 showed, it already has one, and it's been shipping this whole time.

*(All quantitative claims above reproduce from the read-only session of 2026-07-10; the runnable evidence is `scratchpad/squad3/edge-check.mjs`.)*


---

# PART II.4 — SQUAD 4 THESIS: Credits & Stripe Server (Q7–Q10, Q17–Q19)

# Squad 4 Thesis — Credits & Stripe Server

## The foundations exist; every trust boundary has a hole

The comforting version of this platform's credit story is that the hard parts are done: a ledger table with atomic `FOR UPDATE` deduction, a Stripe webhook with signature verification, a checkout flow that provisions accounts, and a chat route with an auth gate. All of that is true, and all of it is misleading. What this validation pass found is that the system's *components* are sound but its *boundaries* are not — the seams where identity meets billing, where streaming meets charging, where Stripe's retry semantics meet a fire-and-forget webhook. Before this test cycle, the blueprint expressed these as generalized risk ("fix, don't port"). The code-walk converted that vagueness into five precisely located defects, each with a file and line: an auth-domain mismatch (`server/dime-chat.route.ts:91` vs `server/dime-wc2026.route.ts:85-109`), an abort fallthrough that charges for cancelled answers (`dime-wc2026.route.ts:650-698`), a first-request race that the row lock cannot close (`dime-wc2026.route.ts:161-165`), a ledger index that permits duplicate charges per request (`drizzle/dime.schema.ts:64-67`), and a webhook that would convert a one-time credit pack into a 31-day subscription while corrupting real subscribers' records (`server/stripeWebhook.ts:208-293`). None of these is speculative. Each was reproduced by reading control flow line by line, and each has a specific, small fix. The argument of this thesis is that the fixes have a single correct order, and that order is dictated by which boundary each defect sits on.

## Identity first: the keystone mismatch that costs nothing to fix

Everything a credit system does — check, charge, grant, display — is an operation on a user identity. The platform currently has two. The wc2026 route authenticates the `app_session` JWT against `app_users`, complete with tokenVersion revocation (`dime-wc2026.route.ts:85-109`), and its ledger writes are keyed to that domain. The main chat route authenticates via `sdk.authenticateRequest(req)` (`dime-chat.route.ts:91`), which resolves a *Manus OAuth* cookie against a different `users` table (`server/_core/sdk.ts:319-352`) — and then discards the result. Chat literally does not know who is talking to it in the domain the ledger understands. That is why the blueprint makes Q7 a prerequisite for any chat charge, and the testing confirms the prerequisite is even cheaper than advertised.

Two facts make the swap essentially free. First, the client already sends the right credential: the fetch at `client/src/pages/dime-chat/DimeChatPage.tsx:581-585` passes no `credentials` option, so the browser's same-origin default ships *all* cookies — including `app_session` — with every chat request. The server ignores it today; adopting the wc2026 pattern requires zero client changes. Second, nobody who can currently use chat gets broken. The `/chat` route is wrapped in `RequireAuth` (`client/src/App.tsx:191`), which gates on `appUsers.me` — an app_session check. So the only humans who can complete the full flow today hold *both* cookies: in practice, the Manus-hosted owner who has also logged into the app. Swapping the route's auth strictly widens access to every legitimate member while cutting off only cookie-less direct callers, which is precisely the acceptance criterion. Q7 is the keystone because it unblocks Q7b (charging), Q7c (granting), and Q8 (display) simultaneously, and because it is the rare security fix with no migration cost.

## Money integrity: three defects, one design that collapses two of them

The wc2026 metering path is the best code in this subsystem — transaction, row lock, balance re-check, append-only insert (`dime-wc2026.route.ts:154-184`) — and it still leaks in three places. The abort fallthrough is the sharpest: when a client disconnects mid-stream, `req.on("close")` sets `aborted = true` (:606-612), `stream.finalMessage()` rejects into the catch at :650, and the entire error branch — including its `return` at :673 — sits inside an `if (!aborted)` guard. An aborted request therefore falls straight through to STEP 13 with `responseMode` still `"ANSWER"` (:619, :686-687) and pays full price; a retry pays again. As a garnish, the `done` frame at :649 reports `creditsCharged` *before* the deduction runs, so the client can be told it was charged even when the race check at :688 zeroes the charge.

The second defect is subtler. `SELECT ... LIMIT 1 FOR UPDATE` locks nothing when the user has zero ledger rows, so two concurrent first requests both read the COALESCE-virtual 100 and both write `balance_after=99` — forked history. The fix requires a seed row, and the testing confirmed no code writes one: the *only* `INSERT INTO dime_credit_ledger` in the runtime tree is the debit at `dime-wc2026.route.ts:177`; the webhook never touches the ledger. Third, the schema itself permits double-charging: `idx_credit_request` is a plain index (`dime.schema.ts:64-67`); the unique guard exists only on the audit table (`uq_dime_request_id`, :89), which records but does not prevent.

Here the recommendation matters more than the diagnosis. The charge policy for aborted streams is an open owner decision (D9), but one option dominates: pre-stream escrow — deduct inside the transaction *before* flushing headers, and write a compensating `REFUND` row when the response ends in anything other than a completed answer. Escrow keeps the 402 a clean pre-flush HTTP response, eliminates the disconnect-for-free-answers abuse that a no-charge-on-abort policy invites, and — critically — collapses the fallthrough defect entirely: if the charge has already happened once, idempotently, under a unique `(request_id, reason)` key, the post-stream code path can no longer double-charge no matter how control falls through. One design decision retires two defects and the append-only ledger absorbs it naturally. The unique index and seed row remain necessary regardless, and both are additive schema changes that fit the manual `db-push.yml` law.

## Packs: why Q19 must land before a single pack price exists

The blueprint's misfulfillment walk-through was re-derived independently and it holds — with two aggravators the blueprint undersells and one drift it missed. A hypothetical `mode:"payment"` pack session hitting today's webhook passes the `payment_status` check (:214), fails plan resolution — and here is the drift: the handler now attempts a price→plan lookup via `listLineItems` (:221-238), a mitigation added since the audit, but a pack price is not in the five-plan map (`server/stripe/products.ts:121-136`), so it logs a failure and defaults to `"monthly"` anyway (:111-114). The terminal behavior is unchanged; the blueprint's description of the resolution chain is merely incomplete. From there, `session.subscription` is null, so `stripeSubscriptionId=""` (:240), and the outcomes fork. An anonymous buyer most likely dead-ends at the no-customer check (:242) — money taken, nothing granted, no record. A known buyer reaches `grantUserAccess` (:52-86) and receives 31 days of subscription access with zero credits. And the worst case is the one the blueprint didn't spell out: for a user with an *active* subscription, the grant overwrites their real `stripeSubscriptionId` with the empty string — which breaks `cancelSubscription`/`reactivateSubscription` (`server/routers/stripe.ts:721`) and flips the wc2026 entitlement check to invalid (`dime-wc2026.route.ts:119`). Buying a top-up pack would eventually *revoke* the chat access the customer is topping up.

Nothing upstream can guard this: both session builders hardcode `mode:"subscription"` and always attach `subscription_data` (`routers/stripe.ts:144, :179-185, :259-260, :270-276`), and `zodPlanId` (:40) cannot express a pack id — so Q17/Q18 must build new paths, not reuse. Meanwhile the webhook 200s before processing with no processed-events store (:417-421), so Stripe retries double-fulfill, and refunds fall to an unhandled `default:` (:377-379). The sequencing law follows ineluctably, and should be tightened: Q19's `session.mode` branch — placed *before* the drifted plan-resolution block — plus an event-id dedup store must be deployed before any pack price id exists in env or Stripe. The dedup design has repo precedent to copy: `INSERT ... ON DUPLICATE KEY UPDATE` upserts throughout `server/db.ts` (:247, :356) and existing `uniqueIndex` guards.

## Grants, the promise gap, and free idempotency

The pricing page promises 1,000/3,000/8,000 monthly credits (`client/src/pages/dime/CheckoutPage.tsx:71, :94, :109`). No mechanism exists. `dime_user_entitlements` has zero runtime readers or writers — schema (`dime.schema.ts:161-177`), snapshots, and docs only. The good news: the grant hook has everything it needs at the natural attachment points — `grantUserAccess` receives `planId` explicitly from all three callers, and `invoice.paid` (:333-353) already isolates `subscription_cycle` renewals. The trap is that those three callers fire for the *same* logical activation, so a naive grant multi-grants per cycle. The clean answer is to key grants on the Stripe invoice id: it is unique per billing cycle by construction, so a unique ledger key on it yields exactly-once semantics with no cron and no new state machine — the same idempotency spine Q19 builds.

## Closing: the honest failure mode, and the order of work

One last hazard deserves the owner's attention because it is about honesty, not theft: `checkCredits` returns `{sufficient:false, balance:0}` when the DB is unreachable (`dime-wc2026.route.ts:126`). An outage tells every paying customer they are broke. The Q8 credit pill has an "error" state for exactly this; the server must be able to say "unavailable" rather than "zero." Test-first order: Q7 (auth swap, trivially testable), Q19 core (mode branch + dedup, unit-testable against constructed events once `getDb`/`getStripe` are injectable), Q7b (unique index, seed row, escrow per D9), Q7c (invoice-keyed grants), then Q8, then — and only then — pack prices. One caveat recorded verbatim: the test run itself was blocked (`vitest` unresolvable; dependencies not installed in this read-only environment), and no dedicated credit tests exist in `server/` today — the acceptance suite is net-new work, and it should be written before the fixes it verifies.

*(~1,480 words)*


---

# PART II.5 — SQUAD 5 THESIS: Platform Infrastructure (Q15 + probe)

# Squad 5 Thesis — The Platform Runs on Timers Nobody Can Verify

**Central claim:** the operational truth of this platform does not live in its code so much as in a forest of in-process `setInterval` timers, a pair of GitHub Actions crons pointed at shared-secret HTTP endpoints, and two deployment doctrines that currently contradict each other in writing. Meanwhile, the migration's foundational promise — "every wave keeps `tsc --noEmit` green and the test suite passing" — is not verifiable from a fresh sandbox at all, because the sandbox has no dependencies installed. Until that verification vacuum is closed and the scheduler/cron duality is made fail-loud, every migration wave is gating on faith, and the single most likely production incident during cutover is not a code bug but an operator following the wrong one of two documented deploy laws.

The evidence for each leg of this argument follows.

## The verification vacuum: no gate is runnable from here

The repo's own gate is precise: CI runs `npx tsc --noEmit` under `NODE_OPTIONS: --max-old-space-size=6144` (`.github/workflows/ci.yml:172-176`), a flag that exists because "the project outgrew Node's default ~2 GB heap — tsc was dying with 'JavaScript heap out of memory' (exit 134)" (`ci.yml:169-171`). I ran that exact command. It exited 2 with:

```
error TS2688: Cannot find type definition file for 'node'.
error TS2688: Cannot find type definition file for 'vite/client'.
tsconfig.json(16,5): error TS5101: Option 'baseUrl' is deprecated and will stop
functioning in TypeScript 7.0.
```

None of these are code errors. `node_modules/` in this environment contains exactly one thing: `typescript/tsbuildinfo`, 84K, no `.bin/` — an incremental-build artifact left behind by `tsconfig.json`'s `tsBuildInfoFile: "./node_modules/typescript/tsbuildinfo"`. Dependencies were never installed. So `npx` fetched the *latest* TypeScript from the registry instead of the repo's pinned `typescript: 5.9.3` (`package.json:132`), and a wrong-major compiler evaluated the project. The vitest smoke was blocked the same way: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest'` before a single test could load.

Two real findings hide inside that noise. First, the TS5101 `baseUrl` deprecation is a time-bomb: harmless under the pinned 5.9.3, fatal under any future TS 6.x/7.x bump — and ci.yml already documents a sibling pin-trap (`@types/express@4` blocking the express-v5/path-to-regexp fix, `ci.yml:91-93`). Dependency-bump waves need to know the toolchain has cliffs. Second, and more important: **environment bootstrap is the P0 that precedes every wave gate.** The wave plan assumes an agent can run the typecheck before pushing. Today it cannot; the only green light available is CI history on GitHub, which arrives *after* a push. A SessionStart hook or setup step running `pnpm install --frozen-lockfile` (the exact Dockerfile install path, which also needs `patches/` and `.npmrc allow-build=puppeteer` present — `Dockerfile:60-63`) converts every subsequent gate from aspiration to fact. Note also that local `pnpm check` lacks the CI memory flag (`package.json:12`), so even a bootstrapped sandbox will see spurious OOM exits until the flag is added or inherited.

## The scheduler forest and the double-run hazard

Boot the server (`server/_core/index.ts`) and, inside the `server.listen` callback, a single guard decides the platform's operational mode: `if (process.env.DISABLE_BACKGROUND_JOBS === '1')` (`index.ts:697`). Exact string, one site in the entire codebase. When the flag is absent, the process starts **fifteen-plus always-on loops**: VSiN odds refresh every 30 minutes plus six daily/weekly stat refreshers (`server/vsinAutoRefresh.ts:1666-2196`), NBA/NHL/MLB model syncs, the NHL goalie watcher, the Discord bot, three schedule-history refreshers, bet auto-grading on three intervals (`server/betAutoGradeScheduler.ts:414-430`), nightly outcome ingestion and drift recalibration, and two security digests. Crucially, a second tier of timers runs **regardless of the flag**: the 4-minute TiDB keep-alive (`index.ts:767`), the 30-minute lineup cache refresh (`index.ts:833`), cache pre-warms, and the 11:00 UTC cutoff invalidation. "Web-only" is not "timer-free."

The migration's answer to metered-host credit burn is to move the two critical freshness jobs off-process: `cron-vsin-odds.yml` (every 15 minutes) and `cron-scores.yml` (every 10) curl `POST /api/cron/vsin-odds` and `/api/cron/scores` on Railway, authenticated by `CRON_SECRET` and serialized by a run-lock (`server/cron/cronRoutes.ts`). The design is sound. The failure mode is the seam: if Railway's `DISABLE_BACKGROUND_JOBS` is set to `true`, `"1 "` with a space, or simply forgotten, the in-process schedulers *and* the Actions crons run the same scrapes concurrently — duplicate VSiN logins, duplicate Discord posts, doubled credit burn — and nothing complains. Add the third actor: Manus Heartbeats still target `/api/scheduled/fg-lineups`, `/roto-lineups`, and three WC2026 endpoints (`index.ts:610-627`), deliberately namespaced apart from `/api/cron/*` "so the two mechanisms never collide during the migration" (`cronRoutes.ts:13-14`) — which prevents route collision but not work duplication while both hosts are alive.

And there is a gap that cuts the other way. cronRoutes.ts states it plainly: "DELIBERATELY NOT wired here: MLB model sync. runMlbModelForDate() spawns /usr/bin/python3 (400k Monte-Carlo sims) which fails on Railway with `spawn /usr/bin/python3 ENOENT`" (`cronRoutes.ts:22-27`). That ENOENT is the very reason the Dockerfile exists — node:22-bookworm-slim ships Python 3.11 at the exact hardcoded paths the runners use (`server/mlbModelRunner.ts:37`, `server/nhlModelEngine.ts:151`). But the *scheduling* of the MLB model lives only in the flag-gated block (`startMlbModelSyncScheduler`, `index.ts:734`). Consequence: a web-only Railway with Actions crons keeps odds and scores fresh **and silently stops modeling games** — the flagship projections feed goes stale with every health check green. The model run needs a home (Python-in-the-Actions-runner with DB write-back, per the file's own note, or a dedicated worker service) *before* Railway goes web-only, not after. A related fossil: `postinstall` runs `pip3 install -r requirements.txt || true` against a file that does not exist at the repo root — Python deps arrive only via the Dockerfile's apt layer, so any non-Docker execution path must solve them independently.

## The testing architecture: 66 files, one design decision away from a real gate

The census: 66 test files (57 in `server/`, 3 in `server/wc2026`, 2 in `server/cron`, 3 in `client/src/pages/dime-chat`, 1 in `perf/`). Twelve import the DB or the app router — including `strikeoutProps.test.ts`, whose appRouter import triggers a full connection-pool init that forced the global timeout to 15 s (`vitest.config.ts:25-28`), and `ciSecrets.test.ts`, which *by design* asserts every GitHub secret is present. The other 54 are pure or nearly so (caveats: `kenpomCredentials.test.ts` spawns `/usr/bin/python3.11`; `perf/regression.test.ts` targets a live URL).

Three structural facts follow. First, in any environment without the full secret set, the suite fails for non-code reasons — which is precisely why `RELEASING.md:18` describes the merge gate as "Security Audit + TypeScript required; **Vitest once secrets land**": within ci.yml the test job fail-hards, but at the branch-protection layer it is effectively advisory. Q15's "required-green vitest" cannot happen until the suite splits into `test:unit` (DB-free, always required) and `test:integration` (secrets-dependent). Second, `tsconfig.json` excludes `**/*.test.ts` from the typecheck — type-broken tests sail through the tsc gate and detonate only in the secrets-dependent stage. Third, for visual baselines: `@playwright/test` is absent from package.json (only runtime `playwright@^1.58.2` for scrapers), there is no `playwright.config.ts`, no axe-core anywhere in the lockfile — while Chromium 1194 sits ready at `/opt/pw-browsers` with `PLAYWRIGHT_BROWSERS_PATH` set. The browsers are provisioned; the harness is not. An axe/visual job slots naturally parallel to `test` with `needs: typecheck`, needing zero DB secrets if it serves the built client with mocked API.

## Two deploy laws, one operator

`RELEASING.md:3-7` is unambiguous: "**THE LAW:** merging to `main` does NOT deploy… code ships ONLY when you press Deploy/Publish inside Manus… No GitHub workflow deploys code." Yet `deploy-smoke.yml` triggers **on push to main**, sleeps 240 seconds because "Railway auto-deploys pushes to main once the repo is connected," and asserts eight live checks via `scripts/smoke-deploy.mjs` (its own header says "five" — the file grew three checks past its documentation, a miniature of the larger drift). `railway.json` and `vercel.json` are fully built for the new world, down to Vercel rewriting `/api/:path*` to the Railway production domain. CLAUDE.md reconciles this as "migration in progress," but the repo currently gives a diligent operator two authoritative, opposite answers to "does my merge ship?" During the overlap window, the likeliest incident is procedural: a schema change merged under the Railway assumption without the manual `db-push.yml` dispatch (`workflow_dispatch` only, `pnpm db:push`), or a "safe" merge under the Manus assumption that Railway promptly auto-deploys. One line at the top of RELEASING.md stating which law is live today is the cheapest insurance in the repo.

## What must precede W1

In priority order: **(1)** environment bootstrap — `pnpm install --frozen-lockfile` on session start, so tsc (with the 6144 MB flag) and the pure vitest subset become runnable gates rather than CI-lagged hopes; **(2)** the unit/integration test split, prerequisite to required-green vitest and to any honest wave gate; **(3)** decide the MLB model-run home before Railway goes web-only, or projections silently stop; **(4)** make the flag seam fail-loud — startup alert when production-on-Railway lacks `DISABLE_BACKGROUND_JOBS=1`, explicit Manus Heartbeat decommission at cutover; **(5)** reconcile the deploy-law documents the day cutover lands. Everything else — the Playwright/axe scaffold, the TS 6 `baseUrl` fix, the requirements.txt fossil — is important but survivable. These five are not: they are the difference between a migration that is verified and one that is merely believed.

*(Squad 5, read-only; no repo files modified.)*


---

# PART III — PLAN, USER STORIES, ROADMAP, DRAFTED ISSUE QUEUE

# Part III — Execution Plan, User Stories, Roadmap Alignment, and Drafted Issue Queue

> Authored under the writing-plans, user-story, and roadmap-planning disciplines from the
> verified squad findings and the supervisor's corrections register. **Plan only — nothing
> below has been executed, and no issues have been filed.**

## III.1 Phased Implementation Plan (plan only)

**Phase 0 — Environment & spec preconditions** (gates every later phase)
- T0.1 Sandbox bootstrap: SessionStart hook running `pnpm install --frozen-lockfile` (needs `patches/`, `.npmrc allow-build=puppeteer`); add `NODE_OPTIONS=--max-old-space-size=6144` to local `check`. Files: `.claude/settings.json` hook, `package.json:12`. Verify: `npx tsc --noEmit` exits 0 in-sandbox on pinned TS 5.9.3.
- T0.2 Test split: `test:unit` (DB-free) vs `test:integration` (secrets); fix postinstall `requirements.txt` fossil; decide `**/*.test.ts` tsconfig exclusion. Files: `package.json`, `vitest.config.ts`, `tsconfig.json:3`. Verify: `pnpm test:unit` green with no secrets.
- T0.3 Apply the supervisor's 8-item corrections register to both audit docs (alpha ≥0.64/0.65; ROI derivability; Q9 schema note; Q5 acceptance rewording; Q1 file list; §17-B webhook drift; :91 line fix; Q16 case-insensitive 253). Verify: docs re-read clean against the register.
- T0.4 Owner sign-off D5 (MASTER mint column @ alpha 0.65, light `--text-muted` resolution, `#0FA36B` surface conditions, tablet sidebar 240).
- Out of scope: any dependency version bumps (TS 6 `baseUrl` cliff noted, deferred).

**Phase 1 — Design chain: D5 → Q2 → Q1 → Q3 → Q4** (Wave 1)
- T1.1 Q2 `client/src/styles/dime-tokens.css`: three themes; mint from prototype block with `--text3` alpha 0.65; light `--sp-mint`→`#45E0A8` + `--sp-bar-ink`→`#0B0B0F`; mint-soft/border washes rebuilt from `rgba(69,224,168,…)`. Verify: exhaustive text×surface contrast script ≥4.5:1 ×3 themes (incl. `--surface2` composites).
- T1.2 Q1 theme unification across the verified 12 touchpoints: ThemeContext typed `'dark'|'light'|'mint'` + validated localStorage read + `data-theme` on `<html>`; `index.css:4` variant extended `(&:is(.dark *, [data-theme="dark"] *))`; DimeChatPage `:483/:531/:799` mint coercion removed; `conversation.css` 27 rules bridged; sonner bridged to ThemeContext; static `data-theme="dark"` in `index.html` (FOUC). Verify: all three themes render on `/chat`; 43 `dark:` variants unaffected; toasts follow app theme.
- T1.3 Q3 `DimeShell` at `/dime`: lift sidebar (2 props, 1 local state) out of `DimeChatPage.tsx:140-296`; own border-box stylesheet (do NOT carry `.dc-page` content-box quirk); active row from `useLocation`; desktop 264px / tablet 240px / mobile chrome. Verify: shell renders 390/768/1440 ×3 themes; existing routes pixel-unchanged.
- T1.4 Q4 fence + fonts: retheme/fence `--primary/--accent/--ring`; annex `ManageAccount.tsx:120/:164/:314` + `BettingSplits.tsx:446/:452/:637`; body font Inter→Familjen (`index.css:173`); drop Inter/JetBrains link (`client/index.html:19-22`); fix `profile.css:23`. Verify: no oklch purple computed under Dime routes; fonts request count −1.

**Phase 2 — Data surfaces (Wave 2): Q5 → Q20 → Q16 (single-owner rule)**
- T2.1 Q5 splits reskin: prototype layout over VSiN columns; Book+Model columns + model-favored highlight + ROI chips via existing `edgeUtils` (verified exact); proportional `width:%` bars with external labels <46px; "Money" label unification; `/splits` self-link fix (`BettingSplits.tsx:541`); replicate 0/0 guard for Total/ML; convert mirrored tests to real `edgeUtils` imports; `marketLabel(sport)` helper ("Run Line" for MLB). GameCard.tsx neon swept here (owner: Q5).
- T2.2 Q20 freshness: render the existing dead `splitsAgoLabel` (both pages) as MVP; additive `games.splitsUpdatedAt` via `db-push.yml` for per-game accuracy.
- T2.3 Q16 ratchet sweep everywhere else, per-component batches with server fixture updates in the same PR; CI grep ratchet over `{#39FF14/i, rgba(57,255,20, #7FFF00, #ADFF2F}`.
- Verify (phase): 3-theme visual baselines on splits; splits tests green importing production functions; ratchet count monotonic.

**Phase 3 — Money chain (Wave 3): Q19 → Q7 → Q7b → Q7c → Q8 → Q17 → Q18; Q9/Q10 parallel**
- T3.1 Q19 FIRST: webhook `session.mode === "payment"` branch placed BEFORE the `:221-238` plan-resolution block; `dime_stripe_events` dedup store (db-push); `charge.refunded` clawback; fix `grantUserAccess` unconditional `stripeSubscriptionId` write ("" clobber). Verify: constructed-event unit tests — replay grants once; payment-mode never calls grantUserAccess; subscription path regression-green.
- T3.2 Q7 chat auth swap at `dime-chat.route.ts:91` to the wc2026 JWT pattern (zero client changes — cookies already sent). Verify: 401 matrix (no cookie / Manus-only / bad tokenVersion).
- T3.3 Q7b metering: unique `(request_id, reason)` index + seed-grant row (db-push); D2a price decided; D9 abort policy decided (recommend escrow+refund — collapses the fallthrough defect); pre-flush 402; `INSUFFICIENT_CREDITS` + `creditsCharged` SSE frames; `dimeCredits` tRPC router on `appUserProcedure` with explicit "unavailable ≠ zero" error shape and role-based `unlimited`.
- T3.4 Q7c plan grants keyed on Stripe invoice id (exactly-once per cycle for free); wire or formally drop `dime_user_entitlements`.
- T3.5 Q8 pill/sheet (7 server-derived states) · T3.6 Q17 pack catalog → Q18 payment-mode builder → only then create pack prices · T3.7 Q9 (needs new display-name column — db-push, the dependency the queue missed) · T3.8 Q10 conversations schema (skip the localStorage interim).

**Phase 4 — Interaction (Wave 4): Q11 → Q12 → Q13 → Q14**
- T4.1 Q11 structured cards as server-emitted `{type:"card"}` SSE frames (Option B — the only design consistent with server-authoritative numbers); parser generalization + components buildable on fixtures during Phase 3; route/prompt wiring after Q7b; absorb the orphaned follow-up chips scope.
- T4.2 Q12 history drawer on Q10 + Q7 (persist on `done` in the SSE route; `hydrate` reducer action; `MAX_HISTORY=24` truncation decision).
- T4.3 Q13 copy (await pattern per `UserManagement.tsx:598-601`) + regenerate (one additive reducer action for in-place replace).
- T4.4 Q14 `DimeSheet`/`DimeDialog` as skins over unstyled Radix/vaul (REUSE); visually-hidden completion announcement on `stream_done`.

**Phase 5 — Hardening + cutover (Waves 5–6)** — Q15 Playwright/axe scaffold (`@playwright/test` + `@axe-core/playwright` devDeps, config, PR job parallel to `test` with `needs: typecheck`); fail-loud `DISABLE_BACKGROUND_JOBS` startup check; MLB model-run home decided BEFORE Railway goes web-only; RELEASING.md deploy-law reconciliation at cutover.

**Unknowns / risks:** D2a, D9, D6 open (build-time); TS 6 cliff; VSiN markup coupling; mint rollout breadth across 418 neon sites.

## III.2 User Stories (with Gherkin acceptance)

**S1 — Theme system (M)** As a Dime member, I want to switch between dark, light, and mint themes anywhere in the app, so that the product matches my preference on every surface.
- Given I select Mint on my profile, When I navigate to chat/splits/profile, Then every surface renders the mint token set and my choice survives reload.
- Given I use a screen at 200% zoom in any theme, When I read secondary text, Then contrast is ≥4.5:1 (verified by the token contrast script incl. `--surface2` composites).
- Given the OS is in light mode but I chose dark, When a toast appears, Then it renders in dark (sonner follows the app theme, not the OS).
- Assumption: mint = brand `#45E0A8` fills everywhere (D1a). Open: landing mint styling details.

**S2 — Credit balance & metering (L — split: S2a router/pill, S2b chat charging)** As a Dime member, I want to see my real credit balance and have analyses charge it server-side, so that usage is honest and consistent across devices.
- Given I have 80 credits and price is 40, When I run two analyses, Then my balance is 0 on the server and both cards show "40 credits".
- Given zero credits, When I send a message, Then I get the insufficient-credits state before any stream begins and the credits sheet opens.
- Given the database is unreachable, When my pill loads, Then it shows "Credits unavailable" — never "0 credits".
- Open: D2a price; D9 abort policy (recommended escrow+refund).

**S3 — Credit top-up packs (L — split: S3a webhook fulfillment, S3b catalog+checkout UI)** As a member low on credits, I want to buy a one-time credit pack in-app, so that I can keep running analyses without changing my subscription.
- Given an active subscriber buys a pack, When the webhook processes it, Then a +N ledger row is written exactly once (replay-safe) and their subscription record is untouched.
- Given Stripe refunds a pack, When the refund webhook arrives, Then a clawback row is written, floored at current balance.
- Law: no pack price exists in Stripe/env until fulfillment (Q19) is deployed.

**S4 — Betting Splits page (M)** As a bettor, I want the splits page to show tickets vs money, book vs model prices, and model-edge ROI chips on live VSiN data in the Dime skin, so that I can read edges at a glance.
- Given Braves/Pirates data, When the page renders, Then ROI chips equal `edgeUtils.calculateRoi` output exactly and unopened (0/0) Total/ML markets show "Splits not yet available", never a 100% bar.
- Given a 97/3 money split, When the bar renders, Then flex-grow equals the data with the small segment's label rendered outside it.
- Given splits are 40 minutes old, When I view the page, Then an "as of" label says so.

**S5 — Structured chat cards (M, after S2)** As a member, I want match-analysis and prop cards in chat with server-authoritative numbers, so that I can trust every price on a card.
- Given the model references a game, When the answer completes, Then the card's prices come from a server-emitted card frame hydrated from `games` + `edgeUtils` (never model-authored numbers) with the composed ARIA sentence.
- Given a v1 client receives an unknown frame, When it renders, Then the message text still renders cleanly (no broken card).

**S6 — Chat history persistence (M, after Q7+Q10)** As a member, I want my conversations saved with search, rename, and delete, so that I can return to past analyses on any device.
- Given I rename a conversation and reload on another device, When I open the drawer, Then the new title appears (server-persisted).
- Given I tap delete once, When I look at the row, Then it asks "Delete?" and only a second tap removes it (soft-delete server-side).

## III.3 Roadmap Alignment

Waves map unchanged onto the ZERO-TO-ONE epics (W1→E2 shell, W2→E3/E4 skins, W3→E5+credits, W4→E3 completion, W5/6→E6 cutover; Trends/persistence extras→E8) with three verified amendments: **Phase-0 infra now precedes W1** (verification vacuum); the **money chain starts at Q19**, not Q17; and **GameCard has a single owner (Q5)**. Now/Next/Later: NOW = Phase 0 + D5 sign-off; NEXT = design chain + Q5/Q20; LATER = money chain (behind D2a/D9), interaction parity, cutover.

## III.4 Drafted /gh-fix Issue Queue (specs ready to file — NOT filed)

Each becomes one GitHub issue run through `/gh-fix <n>` (issue → worktree → fix → PR) when the owner says go. Bodies = the corresponding plan task + verified evidence + acceptance criteria from this report.

| # | Draft title | Plan task | Gate |
|---|---|---|---|
| I-0a | Sandbox bootstrap + local typecheck memory flag | T0.1 | none |
| I-0b | Split vitest unit/integration + postinstall fossil | T0.2 | none |
| I-0c | Apply audit-doc corrections register (8 items) | T0.3 | none |
| I-1 | Dime token layer ×3 themes (mint α=0.65, sp-mint fix) | T1.1 | D5 signed |
| I-2 | Theme mechanism unification (12 touchpoints incl. sonner) | T1.2 | I-1 |
| I-3 | DimeShell at /dime (sidebar lift, 264/240) | T1.3 | I-2 |
| I-4 | Purple fence annexation + font cleanup | T1.4 | I-1 |
| I-5 | Splits reskin on VSiN (+ /splits fix, guards, mirrors→imports, GameCard neon) | T2.1 | I-1 |
| I-6 | Splits freshness (dead label render + splitsUpdatedAt) | T2.2 | db-push |
| I-7 | Neon ratchet sweep (4-pattern CI grep, per-component batches) | T2.3 | I-1 |
| I-8 | Webhook payment-mode branch + event dedup + refund clawback + "" clobber fix | T3.1 | db-push; BEFORE any pack price |
| I-9 | Chat auth unification (:91 → app_session) | T3.2 | none |
| I-10 | Chat metering + dimeCredits router + ledger integrity (unique idx, seed row) | T3.3 | I-8, I-9, D2a, D9, db-push |
| I-11 | Plan-credit grants keyed on invoice id | T3.4 | I-8, I-10 |
| I-12 | Credit pill + sheet (7 server states) | T3.5 | I-10 |
| I-13 | Pack catalog + payment-mode checkout | T3.6 | I-8 deployed |
| I-14 | Profile consolidation + display-name column | T3.7 | db-push |
| I-15 | Conversations schema + router | T3.8 | db-push |
| I-16 | Card SSE frames + match/prop components | T4.1 | I-10 (wiring); fixtures now |
| I-17 | History drawer + hydrate action | T4.2 | I-9, I-15 |
| I-18 | Copy/regenerate actions | T4.3 | — |
| I-19 | DimeSheet/DimeDialog Radix skins + stream live region | T4.4 | I-1 |
| I-20 | Playwright/axe CI scaffold + baselines | T5 | I-3 |
| I-21 | Ops hardening: flag fail-loud, MLB model home, deploy-law reconcile | T5 | before web-only Railway |
