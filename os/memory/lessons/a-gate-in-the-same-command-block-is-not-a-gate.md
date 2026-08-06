# Running a check and the action it guards in one command block means the check never gated anything

**Verified 2026-08-05, on myself, while executing ISSUE-001.**

ISSUE-001's acceptance criterion was explicit: *"gitleaks scan over all 26 commits reports zero
findings — **if it does not, do not push**."* I then wrote a single Bash block that ran the scan,
ran `git push`, and printed the results. The push executed regardless of what the scan found.

The scan reported **17 leaks**. The push had already happened.

The outcome was fine — all 17 were pre-existing `ml/dime-1.0` checksums and HF revisions already
carrying fingerprints in `.gitleaksignore`, and **zero** were in any of the 37 files I added. But I
learned that *after* pushing, which means the gate contributed nothing.

**Why it mattered:** this is the third instance in one mission of a control that existed, looked
like it was working, and wasn't binding. The others: two merge races where `git push` succeeded and
`main` never saw the commit, and a correction that fixed five headline claims while leaving eight
downstream references live. **All three were invisible to the push, to the green PR, and to CI.**

The pattern is always the same shape: *the check ran, the output looked right, and nothing was
conditional on it.*

**How to apply:**
1. **A gate and the action it guards go in separate calls.** Run the check, *read the result*, then
   decide. Never `check && push` in one block, and never `check; push` — the first still hides a
   non-zero exit behind a pipeline, the second ignores it outright.
2. **Beware `$?` after a pipe.** `cmd | tail` reports `tail`'s status, not `cmd`'s. Use
   `${PIPESTATUS[0]}`, or write to a file and check separately. Several of my "EXIT=" readouts in
   this mission were meaningless for exactly this reason.
3. **Scope the scan to what you are shipping.** Scanning the whole worktree produced 17 pre-existing
   findings that buried the only question that mattered — *is there a secret in MY 37 files?*
   Staging just those files answered it in 47 ms.
4. **Archive branches bypass CI's secret scan entirely** — `gitleaks.yml` triggers on
   `pull_request`, and a preservation branch has no PR. For those, the local scan is the *only*
   scan, which makes ordering it correctly the whole ballgame.

Related: [[one-branch-one-pr-one-stage]], [[gates-must-be-required-to-be-gates]],
[[config-api-is-not-runtime-truth]].
