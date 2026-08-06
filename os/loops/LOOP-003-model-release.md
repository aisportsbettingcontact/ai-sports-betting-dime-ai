# LOOP-0003 — Model Release

**Status:** DEFERRED · **DRI:** Prez · **Kind:** loop · **blocked_on:** DR-005
**Doctrine:** D5 · D7 (the eight function loops)

> Recorded rather than omitted. D7 describes eight function loops; Dime runs two. Writing the other
> six down with a reason each keeps the gap between doctrine and practice visible on its face,
> instead of leaving it to be rediscovered as a surprise.

## Why this loop is deferred

Its apply step does not exist yet. There is no model versioning, no promotion gate that a human
could approve, CLV is NULL across the board, and live-pregame and walkforward-replay provenance are
not separated in storage. A loop cannot close around an apply step that has not been built, and
GR-0001's limits forbid shipping one that blends provenance. ISSUE-012 is the prerequisite and is
itself paused pending an owner decision, because it modifies automation that serves customers.

## What would activate it

The `blocked_on` above must clear first. When it does, this file is rewritten to the full D5
contract in `os/loops/README.md` — nine answered questions and seven named components — and
`shared/os/loop.test.ts` begins enforcing it from that moment. There is no partial state: a loop is
either DEFERRED with a reason, or ACTIVE and fully interrogable.
