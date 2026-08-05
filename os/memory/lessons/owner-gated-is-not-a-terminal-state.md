# "Owner-gated" is a loop stage, not a terminal state — and silence must be made loud

**Source:** the 2026-07-28/29 AI-native program (`docs/ai-native/`), verified 2026-08-05.

That program produced genuinely high-quality work: an 11-gap forensic audit still accurate 8 days
later, a 9-loop registry, an artifact envelope, a tamper-evident append-only ledger, 32 adversarial
tests. It then declared its last mile — commit, wire, deploy, observe — "owner-gated" and stopped.
Eight days later **not one byte was in git**, its 5-item queue was untouched, and `main` had taken
~350 commits in other directions.

**Why it mattered:** the failure mode was not sloppiness. The program's labeling discipline was
rigorous (VERIFIED/INFERRED/UNKNOWN, explicit "fixture scope" qualifiers, honest refusal to estimate
its own USD). It failed because **nothing in the system could notice that nothing was happening.**
An open loop fails silently when inputs shift (D5). This is the single most expensive lesson Dime
has recorded.

**How to apply:**
1. Any item that blocks on a human gets an artifact with an **age** and an **escalation trigger**.
   A queue nobody watches is not a queue.
2. Never leave finished work uncommitted "pending review." Commit it to a branch immediately —
   review gates the *merge*, not the *existence* of the record.
3. When a program declares itself complete, the completion claim must name what would falsify it
   later, and something must re-check that. `execution-state.json` had no such mechanism.

Related: [[fixture-verified-is-not-production-verified]], [[incident-numbers-collide]].
