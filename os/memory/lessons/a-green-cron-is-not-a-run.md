# A green cron is not a run — absence has no conclusion

**Origin:** LOOP-002's first observation, [[OBS-0002]] · 2026-08-06

Four of Dime's production data pipelines declare cadences between 5 and 30 minutes. Measured over a
complete 24-hour window, they ran at **4%, 9%, 14% and 22%** of those cadences. `cron-mlb-cycle`
declares every 5 minutes; the median gap between actual runs was **101 minutes**, the longest 202.

Every single recorded run reported `success`. Twelve successes, zero failures — out of 288 expected.

**Why it mattered:** a run that never happened produces no record, and a record is the only thing a
dashboard can colour. Failure is visible; *absence* is not. So four pipelines running at a fraction
of their declared frequency looked perfectly healthy on every instrument Dime had, for as long as
those workflows have existed. `12-nightly-verification` ran zero times in the window and is not red
anywhere either.

This is D5's warning in its purest form — *success is never assumed because planned activity
occurred* — with the twist that the planned activity **did not occur** and still nothing said so.
The monitoring answered "did the runs that happened succeed?" when the question that mattered was
"did the runs happen?"

**How to apply:**

1. For anything scheduled, monitor **rate, not just outcome**. "N runs in the last day" against
   "N expected" is a different question from "did the last run pass", and only the first can see a
   silence.
2. A declared schedule is a claim, and claims get verified. Nothing had ever checked that the cron
   expressions in `.github/workflows/` described what the repository actually did.
3. When declared and observed disagree, **fix the claim before fixing the number.** Raising a
   frequency to compensate for throttling optimises the metric rather than the truth. Rewriting the
   declaration to match reality costs nothing and makes the next divergence a real alarm.
4. Ask what your observer *cannot* see, and write it down where the observer lives. LOOP-002 reads
   GitHub Actions runs; the server also runs 48 in-process `setInterval` schedulers that appear in
   no run list. If one dies, LOOP-002 stays green — the same class of blindness, one layer down.

Related: [[tests-can-report-green-without-asserting]] — green because nothing was checked, rather
than green because something passed.
