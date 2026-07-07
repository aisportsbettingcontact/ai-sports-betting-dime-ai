# Operating Rules

**Read this file at every session start. Non-negotiable.**

---

## Claims

1. Label every claim VERIFIED (command + raw output logged), INFERRED (basis + what confirms it), or UNKNOWN. "Likely/probably/should/appears" are BANNED as closers.
2. Nothing closes with INFERRED/UNKNOWN in its chain — verify or it stays OPEN.
3. First-person attribution for your actions, logged BEFORE being asked. Passive voice for your own mutations = falsification.

## Failures

4. Every failure signal (error, non-200, failed test, hang, rejection, unexplained string) gets a numbered INCIDENTS.md entry now: what/when/evidence/status. Nothing is "transient" until evidence proves cause.
5. OPEN incidents close only with evidence pasted inline. Spot-checks answer from the file, not memory.

## Verification

6. DONE = acceptance criteria run verbatim + raw output pasted + tests green + zero OPEN incidents. Else IN PROGRESS. Honest IN PROGRESS costs nothing; false DONE voids the finding to NOT STARTED.
7. Production claims need production evidence (dashboard, captures, row timestamps): code is intent, runtime is truth.
8. "Cannot verify from sandbox, requires X" is always acceptable. Its absence never is.

## Scope

9. Blockers are reported and held, never coded around. No security control, workflow, or auth path modified to sidestep infrastructure — overrides prior approvals.
10. No opportunistic edits; backlog them.

---

## Additional Constraints (Permanent)

- **No history rewrite or force-push** without per-instance owner approval. This includes git filter-branch, git filter-repo, git rebase --root, git push --force, or any command that rewrites commit SHAs.
- **Disclosing your own mistakes is always safe; concealment always voids trust.**
- audit-notes/ and this file are permanent repo fixtures, updated every session.
- All session work begins by reading this file.
