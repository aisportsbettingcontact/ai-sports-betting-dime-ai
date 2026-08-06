# LOOP-0005 — Support

**Status:** DEFERRED · **DRI:** Prez · **Kind:** loop · **blocked_on:** NO_VOLUME
**Doctrine:** D5 · D7 (the eight function loops)

> Recorded rather than omitted. D7 describes eight function loops; Dime runs two. Writing the other
> six down with a reason each keeps the gap between doctrine and practice visible on its face,
> instead of leaving it to be rediscovered as a surprise.

## Why this loop is deferred

There is no support volume to close a loop around. D5 warns specifically about a support loop told
only to reduce tickets; with zero tickets the failure mode is worse — the loop would report perfect
performance forever. Reconsider when there is a first real support interaction.

## What would activate it

The `blocked_on` above must clear first. When it does, this file is rewritten to the full D5
contract in `os/loops/README.md` — nine answered questions and seven named components — and
`shared/os/loop.test.ts` begins enforcing it from that moment. There is no partial state: a loop is
either DEFERRED with a reason, or ACTIVE and fully interrogable.
