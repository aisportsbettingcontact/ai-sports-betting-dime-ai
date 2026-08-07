# nfl-db: audit the 2026 slice, then freeze it

**Status:** QUEUED — not started. Blocked on nothing; deliberately deferred.
**Raised by:** the frozen-vs-live split (`lib/season_pins.py`), 2026-08-07.
**Owner decision that created it:** ship the assertion split first, audit the new
rows as backlog.

## Why this exists

`build_db.py` used to assert aggregate row counts with exact equality. Those
constants came from the 2026-07-27 extract, taken before the 2026 season had
published anything. When nflverse started serving 2026, a fresh
`fetch_raw.py` + `build_db.py` run failed three assertions and exited 1.

The split fixed the *mechanism*: settled seasons (`<= FROZEN_THROUGH`, currently
2025) stay pinned exactly; the in-progress season is conserved and reported. What
it deliberately did **not** do is vouch for the 2026 rows. They are now loaded
and carried by the row-level invariants (every row resolves a real season, a real
franchise, a real player), but nobody has compared them against an independent
source the way PR #425 did for 2010-2025.

So the current state is honest but incomplete: **2026 data is loaded and
structurally sound, not independently verified.**

## Scope

Live counts measured 2026-08-07 (they grow daily):

| Table | 2026 rows | Notes |
| --- | --- | --- |
| `depth_chart` | 410,431 | shape B; publishing daily since ~2026-08 |
| `roster_season` | 2,930 | the 07-27 R extract requested 2010-2025 only |
| `player_game_stats` | 0 | upstream 404 until the season is played |
| `snap_count` | 0 | upstream 404 until the season is played |

Settled history needs no re-audit: every season `<= 2025` matched live nflverse
exactly on 2026-08-07, across all four tables, with zero drift.

## What the audit has to establish

1. **Depth-chart snapshot semantics.** Shape B is a timestamped snapshot feed,
   not a per-week table: 410,431 rows across a handful of August days, all
   resolving to `season=2026, week=1`. Confirm that is the intended reading and
   that the natural key `(dt, team, scheme, slot, rank)` stays unique as the
   season progresses — the 2025 slice was audited as a completed season, and a
   live one may behave differently.
2. **Roster churn.** 2,930 rows for a season whose games have not started. Verify
   against ESPN/PFR that this is a real camp roster and not a partial publish.
3. **Cross-source agreement**, the #425 method: partition every 2026 row, compare
   against ESPN / NFL.com / Pro-Football-Reference, and prove coverage by having
   per-agent totals sum to the grand total with zero remainder.
4. **The 2012 snap-count hole is still open** upstream — `snap_counts_2012.csv`
   is still 154 bytes header-only as of 2026-08-07, against nflverse's own
   manifest claiming 266 games. Recoverable from PFR. Unrelated to 2026, but it
   is the other known gap and belongs in the same pass.

## Then, and only then

Bump `FROZEN_THROUGH` to 2026 and add the audited counts to `FROZEN_COUNTS` —
after the 2026 season ends (2027-02) and its rows stop moving. Both edits land
together in one PR that cites the audit.

**Do not bump `FROZEN_THROUGH` to make a build pass.** That discards exactly the
protection it exists to provide. `lib/season_pins.py` says so at the constant.

## Known future break, not fixed here

`lib/rowloss.py:210` manifests `player_game_stats: {"no_player_id": 341}` —
"11 seasons x 21 weeks (2010-2020) + 5 seasons x 22 weeks (2021-2025) = 341".
When 2026 player stats begin publishing (September 2026), that count grows and
`pass_rowloss`'s `player_game_stats` branch requires `not rec.manifest_errors`,
so the build will fail again on the same class of staleness.

It is left alone on purpose: the correct 2026 residual count is not knowable
until the season runs, and inventing one would be worse than the failure. Fix it
when the number exists — either by scoping the manifest per season, or by
deriving the residual from the source instead of pinning it.

(`depth_chart`'s manifest entry has the same shape but does **not** gate: it is
in `pass_rowloss`'s `count_only` set, where the check is `loaded == source_rows`
and manifest errors are ignored. Documented at `build_db.py:962-966`.)
