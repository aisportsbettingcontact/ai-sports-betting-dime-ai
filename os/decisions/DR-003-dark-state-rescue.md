# DR-003 — Dark-state rescue: getting finished work into the repository

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 by the executor (Stage 2)
**Urgency:** HIGH — single-disk exposure on work that already mutated production
**Doctrine:** D6 (minimize invisible consequential state) · D12-L2 (artifact system) · D16 (no dark
state — a certification criterion) · D15 #3 (unqueryable work)

---

## The question

**What gets committed, in what order, and where does the 52 GB that cannot go in git actually live?**

## What is actually true — VERIFIED 2026-08-05

Four distinct bodies of finished work exist outside the repository.

### 1. The MLB forensic audit branch
`local/audit-mlb-model-2026` — **26 commits ahead of `main`**, tip `8190a7d96` (2026-07-29).
`git branch -r --contains` → **empty**. Never pushed to any remote.

It contains, per its own `MASTER-REPORT.md`:
- The forensic audit itself (`FINDINGS.md`, `MASTER-REPORT.md`, a 9-verdict `GATE-TABLE.json`)
- **A provenance regime** *"that keeps replay strictly separated from what was actually published
  live"* — this is gap **F5**, which the Stage 1 audit lists as having *no mechanism on `main`*
- **The revived publication gate with per-market `publish_*` switches**, plus tRPC and client wiring
  — this is gap **F3.2**
- The strikeout-props units fix, a fitted walk-forward totals environment multiplier, and a rebuilt
  NRFI walk-forward logistic model
- The backfill/remediation tooling (`tools/remediation/b1..b9`) **that already mutated production**
  on 2026-07-25: 13,408 regrades, 8,464 new ledger rows, 7,632 CLV backfills

### 2. The AI-native program
`docs/ai-native/` (17 files), `shared/loop/` (4), `server/loop/` (2) — 22 files, 3,351 lines.
`git ls-files` → 0. `git log` → empty. Unchanged since 2026-07-29 00:02.
Includes the best artifact primitive in the repo: `shared/loop/envelope.ts` + `ledger.ts`
(append-only, prev-hash chained, tamper-evident, 32 adversarial tests).

### 3. Seven untracked `server/*.ts` modules
`aiCostMeter`, `mlbRecalibrationGate`, `mlbClosingLineResolver`, `mlbModelIdentity`,
`mlbBacktestIntegrity`, `schemaCapabilities` (+ tests). Cross-import each other; imported by nothing
shipped.

### 4. ~52 GB of evidence corpora
47 GB MLB feed corpus + 3.8 GB NFL DB + 1.2 GB audit evidence. Local disk only. **This is the
evidence base under every forensic claim Dime has made.**

### The blocker that applies to all of it
**The working tree does not typecheck.** `server/_core/aiCostMeter.ts:20` imports `aiWorkflowCosts`
from `drizzle/dime.schema`, which has no such export — collateral damage from the Incident-43 column
revert. Any commit of this tree fails CI on the first push.

## Why this is contested

Not *whether* to rescue it — D16 makes "no dark state" a certification criterion, so this is
mandatory. The contest is **how much review these get on the way in**.

The audit branch is 26 commits of model changes that alter customer-facing output. The AI-native
modules are unwired leaf code. Those deserve very different treatment, and lumping them into one
"rescue" PR would be the fastest way to get a large, unreviewable diff parked as a permanent open PR
— i.e. dark state with a URL.

There is also a real ordering hazard: `docs/ai-native/execution-state.json` records six items as
`IMPLEMENTED_UNVERIFIED (production)` when Stage 1 proved **every integration point is absent**.
Committing those files as-is imports false completion claims into the repository as though they were
true.

## Options

### Option 1 — One rescue PR containing everything
- **Pros:** one action, done today · nothing left behind
- **Cons:** an enormous mixed diff spanning model behaviour, docs, and unwired modules · unreviewable
  in practice, so it becomes a long-lived open PR · imports false status claims verbatim · a model
  change and a doc change in one PR cannot be reverted independently
- **Effort:** S to open, L to ever land · **Risk:** high
- **Doctrine fit:** poor. Trades one dark-state problem for an unmergeable one.

### Option 2 — Preserve-first, then triage in separate reviewed PRs ✅ RECOMMENDED
Two phases.

**Phase A — stop the bleeding, today, no review required.** Push the branches as-is to `origin`
under preservation names. **`git push` of a non-`main` branch is not a deploy** (Railway deploys only
`main`), so this is a zero-risk, fully reversible action that removes the single-disk exposure
immediately.
- `git push origin local/audit-mlb-model-2026:archive/mlb-model-audit-2026`
- commit the untracked AI-native tree + 7 modules to `archive/ai-native-program-2026-07-28` **exactly
  as found**, with a commit message stating plainly that `execution-state.json`'s
  `IMPLEMENTED_UNVERIFIED` claims were **disproved by the Stage 1 audit** and the files are preserved
  as a historical record, not as truth.

**Phase B — triage into reviewable PRs, in dependency order:**
1. **Typecheck fix** (XS) — remove or stub the `aiWorkflowCosts` import so the tree is committable.
2. **`shared/loop/` + `server/loop/`** (S) — pure, DB-free, 32 tests, zero production reach. Lowest
   risk, highest reuse; it is the artifact primitive DR-006 wants.
3. **Provenance regime + publication-gate wiring** from the audit branch (M) — this is F5 + F3.2 and
   is gated on **DR-001**.
4. **Model fixes** (K-props units, totals multiplier, NRFI rebuild) (M) — customer-facing; needs its
   own evidence bundle and a db-push check.
5. **The 7 server modules** (S) — only after 2 and 3 give them call sites; otherwise they land as
   more dead code.

- **Pros:** exposure ends in minutes, review happens properly afterward · each PR independently
  revertable · false claims are quarantined rather than imported as fact · matches the repo's own
  law that new columns go db-push-first
- **Cons:** several PRs instead of one · requires discipline to finish Phase B (mitigated by DR-008,
  which is the mechanism that makes an unfinished phase loud)
- **Effort:** XS for Phase A, L total · **Risk:** low
- **Doctrine fit:** strongest. Preservation is not the same act as adoption, and doctrine only
  requires that consequential state stop being invisible.

### Option 3 — Rebuild from scratch on `main`; keep the branches only as reference
- **Pros:** clean history, no inherited defects, everything reviewed as new work
- **Cons:** **discards a real forensic audit, a fitted environment multiplier, a rebuilt NRFI model,
  and a working provenance regime** · high risk of silently not reproducing a fix · directly repeats
  the mistake being corrected, by leaving the originals unpushed
- **Effort:** XL · **Risk:** high
- **Doctrine fit:** poor. D8 — the specification and evaluation are the controlling assets, and those
  are exactly what the branch holds.

## Recommendation

**Option 2 — preserve first (today, unreviewed, zero-risk), then triage in five reviewed PRs.**

The decisive point: **pushing a non-`main` branch is not a deploy.** Railway auto-deploys `main`
only. So Phase A carries no production risk whatsoever, requires no review, and eliminates the
single-disk exposure in one command. There is no reason for that exposure to survive this
conversation.

Separating preservation from adoption also resolves the false-claims hazard cleanly: the files get
preserved *as evidence of what was believed on 2026-07-28*, with the disproof recorded in the commit
message, and nothing is imported as current truth.

**Grafted from the runners-up:**
- From Option 3 — the AI-native program's **status files** (`execution-state.json`,
  `verification-report.md`, packet 003's completion claims) should **not** be adopted into the live
  `/os/` tree. They stay in the archive branch as history. `/os/` gets fresh artifacts whose claims
  were verified in Stage 1.
- From Option 1 — Phase A really should be a single action for all four bodies at once, not spread
  over days.

**On the 52 GB:** it cannot go in git and should not. Recommend the smallest honest thing: a
**manifest** committed to `/os/` recording, for each corpus, its identity, size, file count, a
checksum roll-up, how it was produced, and the command that regenerates it. That converts
"52 GB on one disk" from *invisible* state into *known, locatable, regenerable* state, which is what
D6 actually requires. Off-site backup of the bytes is a separate operational decision I am flagging,
not deciding.

## Requested ruling

> **Prez: authorize Phase A now — push `local/audit-mlb-model-2026` to `origin` as
> `archive/mlb-model-audit-2026`, and commit the untracked AI-native tree and the 7 server modules
> to `archive/ai-native-program-2026-07-28` exactly as found, with their disproved status claims
> annotated in the commit message. Neither branch is `main`; neither deploys anything.**

**A yes commits you to:** two new archive branches on `origin`; the audit's contents becoming visible
to anyone with repo access (note: they contain production-mutation records and model findings — they
are internal, but the repo is private, and I will run a secret scan before pushing regardless).

**Also requested:** confirm the five-PR Phase B ordering above, and tell me whether the 52 GB
manifest should include per-file checksums (accurate, slow, large) or per-shard roll-ups (fast,
smaller, sufficient for detecting drift).

## Depends on

- **DR-001** gates Phase B item 3 (publication-gate wiring).
- **DR-006** (artifact schema) decides whether `shared/loop/` is adopted or superseded — Phase B item
  2 should land before DR-006 is ruled on, since it is the cheapest way to make that primitive
  reviewable.
- **DR-008** (loud silence) is the mechanism that prevents Phase B from stalling the way the original
  work did. **If DR-008 is deferred, Phase B will very likely repeat 2026-07-28.**

## Open unknowns

- Whether the audit branch contains any secret material — it holds production remediation tooling and
  DB query output. **I will run a full `gitleaks` scan over all 26 commits before pushing**, and will
  not push if it flags anything.
- Whether the production writes of 2026-07-25 are still intact or have since been overwritten by the
  live drift loop — resolvable only with a production read.
- Whether `archive/*` branch names conflict with any existing protection rule or workflow trigger —
  I will check the ruleset before pushing.
