# LOOP-0007 — Hiring

**Status:** DEFERRED · **DRI:** Prez · **Kind:** loop · **blocked_on:** NO_DEMAND
**Doctrine:** D5 · D7 (the eight function loops)

> Recorded rather than omitted. D7 describes eight function loops; Dime runs two. Writing the other
> six down with a reason each keeps the gap between doctrine and practice visible on its face,
> instead of leaving it to be rediscovered as a surprise.

## Why this loop is deferred

Dime is one human plus agents, and D12-L4 forbids activating a seat that serves no designated loop.
A hiring loop with nothing to hire for would be the clearest possible instance of that failure. The
agent-seat ladder in os/agents/AUTHORITY.md is the live substitute.

## What would activate it

The `blocked_on` above must clear first. When it does, this file is rewritten to the full D5
contract in `os/loops/README.md` — nine answered questions and seven named components — and
`shared/os/loop.test.ts` begins enforcing it from that moment. There is no partial state: a loop is
either DEFERRED with a reason, or ACTIVE and fully interrogable.
