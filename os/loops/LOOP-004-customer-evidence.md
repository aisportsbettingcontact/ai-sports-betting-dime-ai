# LOOP-0004 — Customer Evidence

**Status:** DEFERRED · **DRI:** Prez · **Kind:** loop · **blocked_on:** DR-001
**Doctrine:** D5 · D7 (the eight function loops)

> Recorded rather than omitted. D7 describes eight function loops; Dime runs two. Writing the other
> six down with a reason each keeps the gap between doctrine and practice visible on its face,
> instead of leaving it to be rediscovered as a surprise.

## Why this loop is deferred

Every grading surface is owner-only today, so there is no customer-visible output to gather evidence
about. DR-001 (publish posture) decides whether that changes. Designating this loop first would
produce a loop whose Outcome column could only ever read 'nobody saw it'.

## What would activate it

The `blocked_on` above must clear first. When it does, this file is rewritten to the full D5
contract in `os/loops/README.md` — nine answered questions and seven named components — and
`shared/os/loop.test.ts` begins enforcing it from that moment. There is no partial state: a loop is
either DEFERRED with a reason, or ACTIVE and fully interrogable.
