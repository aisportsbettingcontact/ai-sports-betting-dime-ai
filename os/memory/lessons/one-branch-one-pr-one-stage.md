# Never add commits to a branch whose PR is already open — open a new PR instead

**Verified twice, 2026-08-05.** Both times the work was finished, pushed, and simply did not land.

| Stage | Pushed | PR merged | Result |
|---|---|---|---|
| Stage 2 (21 files) | 14:24:51Z | #369 at **14:09:59Z** | Missed by 15 min |
| Stage 3 (18 files) | ~14:56Z | #377 at **14:57:42Z** | Missed by ~1 min |

In both cases the push succeeded, the branch head moved, and `main` never saw it — because GitHub
merges the branch state **at merge time**, and the PR was already closed.

**Why it mattered:** Prez merges fast (366 PRs in 28 days, ~13/day). Any window between "PR opened"
and "more commits pushed" is a window where the PR can merge without them. The work then sits on a
branch attached to a closed PR, which is a new species of dark state — it *looks* shipped because
the push succeeded and the PR is green.

Both times it was caught only because the merge was explicitly verified afterwards. **Neither the
push nor the PR gave any signal.**

**How to apply:**
1. **One branch, one PR, one unit of work.** When a unit is done, push and open its PR. The next
   unit gets a **new branch off current `main`** — never a second commit onto an open PR's branch.
2. After any push, verify the commit is an **ancestor of `origin/main`** before calling it shipped:
   `git merge-base --is-ancestor <sha> origin/main`. A successful `git push` proves nothing about
   `main`.
3. If a PR merged without your later commit, do not force-push to "fix" it — that is forbidden.
   Cherry-pick onto a fresh branch off current `main` and open a new PR.

Related: [[owner-gated-is-not-a-terminal-state]], [[fixture-verified-is-not-production-verified]].
