# DR-016 — What cadence do Dime's scheduled pipelines actually need?

**Status:** AWAITING RULING · **DRI:** Prez · **Kind:** decision · **observe_by:** 2026-08-13
**Raised:** 2026-08-06 by the executor (LOOP-001) · **Evidence:** [[OBS-0002]]
**Doctrine:** D5 · D7 · D13

> **Cross-link of record.** This decision was recorded by **LOOP-001** (engineering build) and its
> entire evidentiary basis is an artifact produced by **LOOP-002** (operations). It is the
> demonstration that Dime's two active loops are connected rather than parallel —
> `shared/os/loop.test.ts` resolves the citation and fails if it does not exist.

---

## The question

Four production data pipelines declare cadences between 5 and 30 minutes. [[OBS-0002]] measured
what they actually run at:

| Workflow | Declared | Actual/24h | Ratio |
|---|---|---|---|
| `cron-mlb-cycle` | `*/5` — 288/day | 12 | **4%** |
| `cron-scores` | `*/10` — 144/day | 13 | **9%** |
| `cron-vsin-odds` | `*/15` — 96/day | 13 | **14%** |
| `cron-bet-grade` | `*/30` — 49/day | 11 | **22%** |
| `12-nightly-verification` | daily | 0 | **0%** |

Median gap between `cron-mlb-cycle` runs: **101 minutes** against a declared 5. Longest: 202.
**Every one of these reports `success`.**

So: **which of these cadences does the product actually require, and what is Dime willing to do to
get them?** The declared numbers are not a plan — nothing has ever run at them.

## Why this is the DRI's call and not the executor's

The three options trade cost against data freshness, and that trade is a product decision:

1. **Accept the real cadence.** Rewrite the declared expressions to something honest (`0 * * * *`),
   and the drift disappears because the claim now matches reality. Costs nothing. Concedes that MLB
   projections refresh roughly hourly during live games.
2. **Move the hot paths in-process.** The Express server already runs 48 `setInterval` schedulers
   and honours them exactly; `cron-mlb-cycle.yml` even notes it "matches the in-process
   `MLB_INTERVAL_MS`". Costs nothing in money, but moves the work onto the web dyno and **into
   LOOP-002's blind spot** — a CI-side observer cannot see in-process schedulers at all.
3. **Pay for runners that honour the cadence.** Costs money. Keeps observability where it is.

The executor has no basis for choosing. Whether a bettor is harmed by a 101-minute-old projection
during a live game is a question about Dime's product promise.

## Recommendation

**Option 1 for everything except the live-game path, then re-measure.**

Reasoning: the most valuable thing here is not the cadence — it is that a declared schedule and an
observed schedule disagreed by 25× and nothing noticed. Option 1 removes that lie immediately and
costs nothing. It is also the only option that can be evaluated: once declared matches observed,
LOOP-002's daily check becomes a real alarm instead of a permanent red.

The live-game path deserves its own answer, and answering it needs a number nobody has yet: how
stale a projection actually is when a user loads the feed. That is measurable and is not measured.

**Explicitly not recommended: raising the frequency to compensate.** Declaring `*/1` to get more
runs out of a throttled scheduler optimises the number rather than the truth, and is the D15 #14
failure this program exists to avoid.

## Requested ruling

1. Which option for the three MLB/odds pipelines?
2. Is `12-nightly-verification` running zero times acceptable, or is that a real regression?
3. Should the executor measure real feed staleness before you rule on the live-game path?

## Consequences of not ruling

LOOP-002's daily observer will report 5 of 12 schedules unhonoured every day. That is accurate, and
it will also become background noise — the exact failure mode of an alarm nobody can act on. This
record's `observe_by` is **2026-08-13**; past that the clock reports it daily.
