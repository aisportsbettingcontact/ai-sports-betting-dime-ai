# Fixture-verified is not production-verified — code is intent, runtime is truth

**Source:** `OPERATING-RULES.md` §7; repeatedly confirmed 2026-08-05.

The AI-native loop slice passes 32 adversarial tests in 293 ms with zero credentials. It has also
**never closed a single cycle outside that test run**: it has no importers in shipped code, its
ledger is a JS array constructed fresh per test, and its JSONL persistence is implemented, tested,
and never called by anything that writes a file.

Two related traps observed in the same audit:
- A work packet marked `VERIFIED_COMPLETE` whose one-line fix **is not on `main`**, in a packet file
  that is itself uncommitted.
- `execution-state.json` recording six items as `IMPLEMENTED_UNVERIFIED (production)` when the
  correct status was "written to disk, never integrated" — every claimed integration point was
  absent.

**Why it mattered:** passing tests measure the code you wrote against the world you imagined. Six
modules cross-imported each other perfectly and connected to nothing.

**How to apply:**
- State the scope in the same breath as the verdict: "32/32 **on synthetic fixtures**".
- Before claiming an integration exists, grep the *consumer* for the import — not the producer for
  the export.
- A production-behaviour claim needs production evidence: a row, a timestamp, a dashboard, a capture.
  "Cannot verify from here, requires X" is always acceptable; its absence never is.

Related: [[owner-gated-is-not-a-terminal-state]], [[numbers-in-narratives-are-usually-generated]].
