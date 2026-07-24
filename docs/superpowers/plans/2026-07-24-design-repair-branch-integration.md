# Design-Repair Branch Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the parked design-repair branch `claude/repo-skills-setup-uh9c35` current with
`origin/main` (`f17d2cf`), verify it still typechecks/builds/tests, and open a PR for the 26
verified defect fixes that remain unshipped.

**Architecture:** The branch diverged at `310bf72`. Since then `main` gained 5 commits, two of
which (PR #195 `d5b1216`, PR #196 `2b06823`) shipped a *squashed subset of this very branch's own
content* — the 14 dead-file deletions and the Discord platform exception — plus an unrelated
`osv-scanner.toml` ignore entry. Integration therefore has to reconcile the same content authored
twice on two histories. We integrate with a **merge**, not a rebase, on measured evidence (see
Route Decision). The merge commit is the only new history; all 10 existing commits keep their
hashes, so the audit trail behind the evidence report stays valid.

**Tech Stack:** git, pnpm 9, TypeScript 5 (strict), Vitest, Vite 6, esbuild.

## Global Constraints

- Development happens on branch `claude/repo-skills-setup-uh9c35`. Never push to another branch.
- Push with `git push -u origin claude/repo-skills-setup-uh9c35`; on network failure retry up to 4
  times with exponential backoff (2s, 4s, 8s, 16s).
- `npx tsc --noEmit` must pass. CI runs it with `NODE_OPTIONS=--max-old-space-size=6144`.
- Use `pnpm`, never `npm` — `npm install` fails on a vite peer conflict (ERESOLVE).
- DB-dependent Vitest specs require `DATABASE_URL` and fail locally by design. Report their status
  honestly as ENVIRONMENT-BLOCKED; never claim the full suite passed locally.
- Never commit secrets. Do not redistribute `dime-ai/design-bundle/uploads/`.
- Brand law: `design-system/dime-ai/MASTER.md` is authoritative. One-accent mint `#45E0A8`
  (`#0FA36B` for mint text on light). No gradients/purple/neon-green/gold.
- The Discord platform exception (`#5865F2`, GG Sans) is owner-approved and already on `main` —
  do not revert or re-author it.
- Do not open a PR for any scope beyond the design-repair work already committed on this branch.

## Route Decision (measured, not assumed)

Both routes were dry-run in throwaway worktrees at `310bf72`:

| Route | Result |
|---|---|
| `git rebase origin/main` | Conflicts at commit **1 of 10**. **6 of the 10** commits touch the 5 files `main` also changed, so the same already-merged content must be re-resolved repeatedly. Replays `fa9943b`, whose `THREE-COLOR-LAW.md` content is byte-**identical** to `main`'s. |
| `git merge origin/main` | **1** conflicted file (`client/index.html`); `index.css`, `Home.tsx`, `conversation.css`, `MASTER.md` all auto-merged. |

Merge selected. The single conflict is **comment prose only** — both sides document the same
`@font-face` block; `main`'s wording is a strict superset (it adds the "4 errors per page view"
consequence). Resolution: take `origin/main`'s side.

Per-file overlap classification (`310bf72` → both heads): 14 files `BOTH-DEL` (no conflict
possible), 5 files `IDENTICAL`, 6 files `DIVERGED` — of which `osv-scanner.toml` is untouched by
the branch and merges clean.

## File Structure

No new source files. One new plan document (this file). Files touched by the integration itself:

- Modify: `client/src/index.html` — conflict resolution only (comment text).
- Create: `docs/superpowers/plans/2026-07-24-design-repair-branch-integration.md` — this plan.

The PR's *payload* is the 23 files already committed across B1–B8 + `fa9943b`, unchanged by this
plan. Net diff vs `origin/main` after merge: **23 files, +673 / −183**.

---

### Task 1: Integrate `origin/main` into the branch

**Files:**
- Modify: `client/index.html:33-50` (conflict hunk — comment block above the GG Sans `@font-face`)

**Interfaces:**
- Consumes: `origin/main` at `f17d2cf`; branch head `fa9943b`.
- Produces: a merge commit on `claude/repo-skills-setup-uh9c35` whose tree contains both the
  design-repair work and all three already-merged scopes. Later tasks verify this tree.

- [ ] **Step 1: Confirm the starting state**

```bash
git checkout claude/repo-skills-setup-uh9c35
git rev-parse --short HEAD          # expect fa9943b
git fetch origin main
git rev-parse --short origin/main   # expect f17d2cf
```

- [ ] **Step 2: Merge, expecting exactly one conflict**

```bash
git merge origin/main
```

Expected: `CONFLICT (content): Merge conflict in client/index.html` and nothing else conflicted.
Confirm with `git diff --name-only --diff-filter=U` — it must print exactly `client/index.html`.
If any *other* file conflicts, stop: the branch moved since this plan was written; re-run the
overlap classification before proceeding.

- [ ] **Step 3: Resolve by taking main's comment wording**

```bash
git checkout --theirs client/index.html
git add client/index.html
```

Then confirm no marker survived:

```bash
grep -c '^<<<<<<<\|^>>>>>>>\|^=======$' client/index.html   # expect 0
```

- [ ] **Step 4: Verify the resolved file still declares the font correctly**

```bash
grep -c "font-family: 'GG Sans'" client/index.html      # expect 1
grep -c 'font-display: swap' client/index.html          # expect >=1
grep -c 'preconnect' client/index.html                  # expect >=1
```

- [ ] **Step 5: Commit the merge**

```bash
git commit --no-edit
```

- [ ] **Step 6: Assert the three already-merged scopes survived**

```bash
grep -c 'GHSA-mh99-v99m-4gvg' osv-scanner.toml     # expect 1  (PR #196)
grep -c 'discord-blurple' client/src/index.css      # expect 2  (PR #195)
test ! -e client/src/pages/ModelProjections.tsx && echo "deletions intact"
```

- [ ] **Step 7: Assert the net PR scope is design-repair only**

```bash
git diff --stat origin/main HEAD | tail -1
```

Expected: 23 files changed, ~673 insertions, ~183 deletions. If the file count is materially
higher, an unintended scope crept in — inspect before continuing.

---

### Task 2: Verify the integrated tree

**Files:** none modified. This task only runs commands and records their output.

**Interfaces:**
- Consumes: the merge commit from Task 1.
- Produces: a pass/fail record per gate, used by Task 3 (debug) and Task 4 (finish).

- [ ] **Step 1: Install dependencies with the repo's package manager**

```bash
pnpm install --frozen-lockfile
```

`npm install` is **wrong here** — it fails on a vite peer conflict.

- [ ] **Step 2: Typecheck (the hard CI gate)**

```bash
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

Expected: exit 0, no output. This is the gate most at risk: B7 realigned source-contract tests
against files deleted on both histories, and the merge could have resurrected a reference.

- [ ] **Step 3: Run the test suite, separating real failures from env-blocked ones**

The repo already has a script for exactly this split — use it rather than eyeballing failures:

```bash
pnpm test:gated:local
```

It runs Vitest, then `scripts/check-environment-failures.mjs --profile=local` classifies each
failure and writes `env-gate-report.json`. Read that report:

```bash
node -e "const r=require('./env-gate-report.json'); console.log(JSON.stringify(r,null,2))" | head -60
```

Failures classified as environment (missing `DATABASE_URL` etc.) are ENVIRONMENT-BLOCKED, not
regressions — CI supplies those secrets. Any failure *not* so classified is a real regression and
sends you to Task 3. Record the split explicitly; never report a clean suite when it was gated.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: exit 0. Note this script chains `build:client`, `verify-preview-production.mjs`, and
`build:server` — a failure in the preview verifier is a real failure, not a warning.

- [ ] **Step 5: Check the bundle budget the branch itself recalibrated**

B7 touched `bundle-budget.json`, and the merge brought in `main`'s deletions, which change bundle
size. Run the repo's budget gate against the build output from Step 4:

```bash
pnpm check:bundle
```

Expected: exit 0. A breach here means `bundle-budget.json` needs re-baselining against the merged
tree — that is a Task 3 fix, and the new numbers must be justified, not merely raised to fit.

- [ ] **Step 6: Record results — no commit**

This task produces evidence, not changes. If every gate passes, go to Task 4 and skip Task 3.

---

### Task 3: Debug any gate failure (conditional — skip if Task 2 is green)

**Files:** determined by the failure.

**Interfaces:**
- Consumes: failing command output from Task 2.
- Produces: a fix commit, plus a re-run of the failed gate showing it green.

- [ ] **Step 1: Reproduce the failure in isolation**

Re-run only the failing gate, capturing full output. Do not proceed on a summary line — read the
actual error and the file:line it names.

- [ ] **Step 2: Locate the root cause before proposing a fix**

The two most likely causes, given what the merge combined:

1. **A resurrected reference to a deleted file.** `main` deleted 14 files; so did this branch. If
   any surviving import points at one, `tsc` fails with `TS2307: Cannot find module`. Find callers
   with `grep -rn "<BaseName>" client/src`.
2. **A duplicated CSS token.** Both histories edited `client/src/index.css`. An auto-merge could
   have produced two declarations of the same custom property. Check with:
   `grep -n 'discord-blurple\|--font-discord' client/src/index.css` — each should appear once in
   the token block.

State the demonstrated root cause before editing. A guess is not a root cause.

- [ ] **Step 3: Fix, then re-run the exact failing command**

Show the command output as evidence. Re-run the *full* Task 2 gate list afterwards — a fix in one
place can break another.

- [ ] **Step 4: Commit**

```bash
git add <files>
git commit -m "fix: <demonstrated root cause>"
```

---

### Task 4: Finish the branch

**Files:** none modified.

**Interfaces:**
- Consumes: a green (or honestly-qualified) verification record from Task 2/3.
- Produces: a pushed branch and an open PR.

- [ ] **Step 1: Push with retry**

```bash
git push -u origin claude/repo-skills-setup-uh9c35
```

On network failure retry up to 4 times with backoff 2s, 4s, 8s, 16s.

- [ ] **Step 2: Check for a PR template**

Look for `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, root
`PULL_REQUEST_TEMPLATE.md`, `docs/PULL_REQUEST_TEMPLATE.md`. If one exists, mirror its section
headings and populate them from the diff. Skip any section asking for credentials, tokens, env
vars, or internal hostnames.

- [ ] **Step 3: Open the PR**

Body must state, with exact numerators/denominators and no unqualified completion language:
- 26 defects resolved and independently verified; 15 deferred with reasons; 3 rejected with
  evidence. Source: `docs/superpowers/plans/2026-07-24-sitewide-design-repair-report.md`.
- Which gates were run and which were ENVIRONMENT-BLOCKED.
- That the Discord exception and the 14 deletions already shipped in #195 and are **not** part of
  this PR's net diff.

Prohibited in the body: "all devices", "fully responsive", "100% covered", "fully tested", or any
completion claim without a stated evidence-backed denominator.

- [ ] **Step 4: Report CI status honestly**

Watch the checks. Report actual conclusions. If Security Audit or Secret Scan fails, determine
whether the failure is inherited from `main` before attributing it to this PR — that exact
misattribution already cost a cycle on #195.

---

## Risks and Unknowns

| Risk | Likelihood | Mitigation |
|---|---|---|
| `tsc` fails on a reference to a both-deleted file | Medium | Task 3 Step 2 cause #1; B7 already realigned these, and both histories deleted the same 14 files |
| Duplicated CSS custom property from auto-merged `index.css` | Medium | Task 3 Step 2 cause #2 — explicit grep |
| Bundle budget breach after merge | Low | Task 2 Step 5 |
| Vitest cannot run fully here | **Certain** | Not a risk to fix — report as ENVIRONMENT-BLOCKED; CI has the secrets |
| Reviewer expects a literal `git rebase` | Certain | Route Decision documents the measured reason merge was chosen; flagged to the owner in chat |

## Out of Scope

- The 15 deferred defects (X-HEX-EPIDEMIC ~2,000 raw hex literals, X-DUAL-SYSTEMS GameCard vs
  ProjectionCard, X-PY-CARDGEN legacy palette in `StrikeoutModel.py`, D-BG-SEAM, D-MOTION-LAW).
  These need owner decisions and are documented in the report.
- Live-deploy verification of GG Sans rendering. Egress to `aisportsbettingmodels.com` is denied
  by this environment's network policy (proxy returns 403 to CONNECT). Cannot be done here.
- Deleting the stale remote branch `claude/probe-brace-expansion-uh9c35` — the git proxy rejects
  branch deletion (HTTP 403). Requires the GitHub UI.
- Removing the `GHSA-mh99-v99m-4gvg` ignore entry. That is a quarterly review item, gated on
  `puppeteer-extra-plugin-stealth` shipping on `glob@10+`/`rimraf@4+`.
- Any schema change. Those require the manual `db-push.yml` workflow before a code deploy.
