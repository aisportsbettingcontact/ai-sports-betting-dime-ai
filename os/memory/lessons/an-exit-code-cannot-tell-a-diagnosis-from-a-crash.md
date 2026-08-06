# An exit code cannot tell a diagnosis from a crash

**Origin:** mutation-testing the PR #400 audit fixes · 2026-08-06

`scripts/os/contradiction.mts` deliberately fails on a corrupt ledger: it prints why and exits 1,
so a broken governance input can never read as a clean result. A new test covered that path:

```ts
expect(code, "a corrupt ledger must fail the run").not.toBe(0);
expect(out).not.toMatch(/contradiction/);
```

Then the mutation run replaced the deliberate `die()` with a silent skip — and **the test still
passed.** The skip left a `null` in the cycle array, which threw a `TypeError` two lines later, which
also exits non-zero. The assertion could not distinguish *"the program diagnosed the problem"* from
*"the program crashed near the problem."*

**Why it mattered:** every other assertion in that suite was mutation-verified and caught its defect.
This one looked identical in shape and was hollow. The deliberate failure path — the whole point of
`die()` — could have been deleted with the suite green, and the symptom would only appear later as a
confusing stack trace instead of a clear message. Exit codes are a *very* coarse signal: almost any
bug produces a non-zero one, so asserting on the code alone tests approximately nothing about
intent.

**How to apply:**

1. When testing a deliberate failure, assert the **diagnosis** — the message that names the cause —
   not just the exit code. `expect(err).toMatch(/not valid JSON|corrupt/i)`.
2. Assert the absence of an accidental failure too: `expect(err).not.toMatch(/TypeError/)`. That is
   what actually separates "failed on purpose" from "fell over."
3. Do not trust a fail-path test you have not mutation-tested. Delete the `throw`/`die`/`exit` it
   covers and confirm the test goes red *for the right reason*. Five of six mutations in this batch
   were caught; the sixth was invisible until it was tried.

Related: [[tests-can-report-green-without-asserting]] and
[[the-script-that-runs-is-not-the-code-thats-tested]] — the same family. There the assertion bound
nothing, or bound the wrong artifact; here it bound something real but too coarse to mean what it
claimed.
