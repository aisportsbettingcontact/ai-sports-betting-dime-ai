# LOOP-0006 — Revenue

**Status:** DEFERRED · **DRI:** Prez · **Kind:** loop · **blocked_on:** DR-002
**Doctrine:** D5 · D7 (the eight function loops)

> Recorded rather than omitted. D7 describes eight function loops; Dime runs two. Writing the other
> six down with a reason each keeps the gap between doctrine and practice visible on its face,
> instead of leaving it to be rediscovered as a surprise.

## Why this loop is deferred

Pricing is unreconciled (DR-002). Stripe holds the payment records and the app holds the user
records, and until the reconciliation ruling lands, 'revenue changed' is not a question this repo can
answer from durable evidence — which is the D6 bar a loop's Artifact column has to clear.

## What would activate it

The `blocked_on` above must clear first. When it does, this file is rewritten to the full D5
contract in `os/loops/README.md` — nine answered questions and seven named components — and
`shared/os/loop.test.ts` begins enforcing it from that moment. There is no partial state: a loop is
either DEFERRED with a reason, or ACTIVE and fully interrogable.
