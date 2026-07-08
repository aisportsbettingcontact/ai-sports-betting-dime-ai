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

---

## Dedup Gate (Permanent — added 2026-07-08)

No DELETE/dedup operation on any wc2026_* table may execute without ALL of:

1. **TRUE KEY STATED** — with schema evidence (file:line, column definitions, constraint name if exists). The key must identify ONE legitimate row, not merely one match.
2. **GROUPING ON TRUE KEY** — GROUP BY must use the full composite natural key, never just `match_id` for multi-row-per-match tables.
3. **DATA-LOSS IMPACT STATEMENT** — exact count of rows to be deleted vs retained, with PROOF each deleted row is redundant on the true key (not just same match_id).
4. **ARCHIVE-FIRST REVERSIBILITY** — `INSERT INTO {table}_archive SELECT * FROM {table} WHERE id IN (...)` before any DELETE. Archive table must exist and be verified.
5. **EXPLICIT OWNER AUTHORIZATION** — owner must approve after reviewing the impact statement.

No gate = no dedup. Violation = INCIDENT.

---

## Verdict Standards (Permanent — added 2026-07-08)

**"AMBIGUOUS" is not an allowed verdict.** When the expected key column is NULL/missing, the correct move is:

1. Find the ACTUAL identifying key from the schema (SHOW CREATE TABLE + column semantics), OR
2. Label it **UNKNOWN** with the SPECIFIC reason (e.g., "column X is universally NULL, cannot distinguish Y from Z") and state what would resolve it (e.g., "populate column X from source Y").

Never use a soft "ambiguous" that hides whether real dupes exist. The verdict must be one of:

| Verdict | Meaning |
|---------|--------|
| **CLEAN** | 0 collisions on true key |
| **GENUINE DUPLICATES** | N excess rows, evidence of byte-identity on all non-PK columns |
| **LEGITIMATE MULTI-ROW** | Collisions are distinct events (different attribute values prove distinctness) |
| **UNKNOWN** | Cannot determine — with specific reason AND resolution path stated |

Collapsing two separate findings (duplication + completeness) into one non-answer is prohibited. Split them.
