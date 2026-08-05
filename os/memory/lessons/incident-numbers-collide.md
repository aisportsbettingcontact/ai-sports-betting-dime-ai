# INCIDENTS.md has no number allocation and no enforced append-only — concurrent writers lose entries

**Verified 2026-08-05.**

Two concurrent sessions on 2026-07-28 both allocated incident numbers 41–43. The Trace v1
workstream's entries are in `INCIDENTS.md`. The AI-native program's three (env-gate stale allowlist
entry, gated-runner race, schema-first column regression) **were never filed at all** — `grep -ni
'ai-native|shared/loop|projectionLoop|recalibration gate|cost meter' INCIDENTS.md` returns zero hits
across all 61 entries. They survive only in untracked prose.

Worse: `execution-ledger.md:60` asserts *"Incidents 41, 42, 43 all RESOLVED with evidence in
INCIDENTS.md."* **That citation is false.** And `loop-registry.yaml` declares
`escalation: INCIDENTS.md entry` for all nine loops — an escalation path that was never exercised.

**Why it mattered:** `INCIDENTS.md` is the claimed single source of truth for incidents, and
"append-only" is a written convention (`OPERATING-RULES.md:15`) with **zero mechanical
enforcement** — no hook, no CI job, no lint. Status lines are already mutated in place. A ledger
that can silently lose records under concurrency is not a source of truth.

**How to apply:**
- Do not hand-pick the next incident number from a stale read. Re-read the tail of the file
  immediately before writing, and prefer a collision-proof id if one becomes available.
- Never cite `INCIDENTS.md` as evidence without grepping for the entry you are citing.
- An append-only claim needs an enforcement mechanism. One already exists in this repo for a
  different subsystem: `shared/loop/ledger.ts` (prev-hash chain, idempotent on `(id, contentHash)`).

Related: [[owner-gated-is-not-a-terminal-state]].
