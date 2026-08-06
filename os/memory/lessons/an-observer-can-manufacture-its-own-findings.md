# An observer can manufacture its own findings

**Origin:** the LOOP-002 precision audit · 2026-08-06

LOOP-002 measures whether Dime's scheduled workflows run at the cadence they declare. Its first
observation found real drift — four production pipelines running at 4–22% of declared cadence, every
run green. Audited afterwards, the *instrument* turned out to have three ways of reporting drift that
did not exist:

1. **It measured a partial day.** The default window was *today*, and the daily workflow fires at
   10:40 UTC. A perfectly honoured five-minute job can only have produced 129 of the day's 288 runs
   by then — **45%, under the 50% floor**. Every high-frequency workflow would have been reported
   unhonoured every single day, forever, regardless of reality.
2. **It scored workflows that did not exist.** `12-nightly-verification.yml` reached `main` at
   2026-08-06T04:38Z and was reported as **0 of 1 for 2026-08-05** — a cadence finding about a file
   that did not exist at its own scheduled time. That false positive was the most alarming line in
   the published observation.
3. **It could report a floor as a count.** `gh run list --limit 300` binds on high-frequency
   workflows. It happened to reach back far enough, but nothing checked, so a future measurement
   could have silently undercounted and invented drift.

**Why it mattered:** the first defect is the worst, and it is not "a bug that reports the wrong
number". A check that is red every day is **indistinguishable from a check nobody wrote**, and it
would have destroyed the credibility of the real finding sitting next to it. The whole point of
LOOP-002 was to notice a silence nobody else could see; an instrument that cries wolf daily makes
that signal unfindable.

The second is worse in a different way: it is a **false accusation with a name attached**, published
in a governance artifact and cited by a decision record put in front of the DRI.

**How to apply:**

1. **An observer must not measure a window that has not closed.** Compare complete periods to
   complete expectations, or say explicitly that the period is partial. Default to the last complete
   one.
2. **Ask "could the thing being measured have existed for the whole window?"** For anything
   versioned, git answers this offline and authoritatively. A subject that did not exist cannot have
   failed.
3. **Any paged API is a floor until you prove coverage.** If the result set is capped and the oldest
   row is newer than the measured period, the count is a lower bound. Refuse rather than report.
4. **Mutation-test the DEFAULT path, not just the explicit one.** Every test here passed an explicit
   `--date`, so reverting the default to *today* left the suite green while restoring defect 1 — and
   the default is precisely the path the daily workflow takes. The uncovered path was the one that
   ran in production.
5. Before publishing a measurement, ask of every alarming row: *what else, other than the thing I am
   claiming, could produce this number?* Item 2 was found by asking exactly that about a single 0%.

Related: [[a-green-cron-is-not-a-run]] — the finding this instrument exists to surface;
[[an-exit-code-cannot-tell-a-diagnosis-from-a-crash]] — the same failure to distinguish "broken" from
"measured", one layer down.
