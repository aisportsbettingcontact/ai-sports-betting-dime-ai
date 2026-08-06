# Forensic audit — new findings ledger

Running record of defects the row-level audit found that the earlier completion round missed.
Maintained by the coordinator as agents report. Each entry names its evidence and who found it.

## Confirmed by the coordinator

### N0 — 36 of today's 624 corrections are regressions I introduced (F09) — MUST FIX

**This is the only defect in the database that today's integration created rather than found.**

D11 rewrote 91 `gameday` values from the UTC date to the Pacific date. 55 were genuine fixes.
**36 made the row worse.** Those 36 all carry `time_valid = 0` and `kickoff_utc` ending `T05:00:00Z`
— which is **not a kickoff instant**. It is ESPN's "date known, time TBD" marker: midnight Eastern
on the game's date. Timezone-converting midnight westward rolls the date back a day.

Verified: 2026 has exactly 36 rows with `time_valid = 0`, all 36 carry the `T05:00:00Z` marker, and
`2026_POST_WC_401872910` (`2027-01-16T05:00:00Z`) now reads gameday `2027-01-15` — a day early.
Affects all of Week 18, the Week 16/17 flex games, and **every playoff round**.

**The fix is narrower than F09 proposed, and preserves the project convention.** F09 recommends
switching the derivation to `America/New_York` (which scores 285/285 against ESPN's own date
bucketing, vs Pacific's 249/285). But Pacific is correct on **249 of the 249 rows that carry a real
kickoff time** — it fails *only* on the 36 placeholders. The bug is not the timezone; it is
converting a value that is not an instant.

So: keep the project's Pacific convention (see the `kickoff-datetime-convention` project note), and
**gate `time_valid = 0` rows out of timezone conversion entirely** — take their date as published.
Then re-stamp the 36 D11 corrections and add a build assertion that no `time_valid = 0` row ever has
its date shifted.

**Blocked on:** F02 and F06 are still auditing and both record the database md5 at start and end.
Applying this now would invalidate their reports. Apply after they land.

## Confirmed by the coordinator (continued)

### N1 — D17 was only half applied (F01)

Today's D17 correction fixed the nine **counting** columns inflated by nflverse's duplicated plays in
`2011_13_DET_NO` and `2011_10_DET_CHI`, but left every **derived** column still computed from the
duplicated source: `sacks_suffered` (Stafford +1 in both games, contradicted by ESPN),
`target_share` (25 rows still divide by the uninflated team total — 2/65 where it should be 2/60),
`fantasy_points`, `fantasy_points_ppr`, and the EPA columns.

F01's proof is the cleanest evidence in this audit: recomputing fantasy points across all 34,988
rows in its partition, **exactly 12 rows have a residual that is not a multiple of 2 — and all 12
are in those two games.**

Verified live: Brees still shows 28.04 fantasy points for 2011 wk 13, Ingram 25.2 (including the
phantom rushing TD), Kevin Smith 23.1. Target shares still divide by the inflated total.

**Consequence:** any model using fantasy points, target share, or EPA reads contaminated values for
those games. The correction must be extended to derived columns, or the derived columns recomputed
from the corrected counting stats.

### N2 — `snap_count` is missing all of 2012, and the data exists upstream (F01)

Our database holds **0** snap rows for 2012. nflverse's `snap_counts_2012.csv` is live and returns
real data (verified: the file downloads with a full header and rows).

This corrects an earlier claim of mine. I reported the 2010–2012 snap gap as a genuine upstream
boundary; a supervisor flagged that 2012 might be recoverable, and F01 proved it is. Roughly 23,000
rows of usage data are missing for a full season. 2010 and 2011 remain genuinely absent upstream.

### N3 — the `game_line` authority question is unsettled and material (F01, contradicts A4)

F01: the database reproduces **nflverse exactly** (4,272/4,272 fields), but **SportsOddsHistory
differs on 403 of 534 games in 2010–2011 alone**, by ±0.5 to ±1.5 points.

This contradicts A4's earlier "4,363/4,363 games matched" against the same archive — because A4
matched *games* and then compared ATS outcomes **only where both archives published an identical
spread**, which structurally excludes every disagreement. Both agents are honest; they measured
different things.

**This is the most consequential open question in the audit.** A half-point of spread is the
difference between a push and a loss. Whichever archive is right, a backtest built on the other is
systematically miscalibrated. Needs adjudication against a third source, not a preference.

### N4 — the venue columns are an unreconciled seam in the merge (F05, F08, confirmed)

Verified: the two halves of `game` use **entirely different venue columns, and neither has both.**

| Era | Rows | `venue_id` | `stadium` |
|---|---|---|---|
| 2010–2025 (played, nflverse-sourced) | 4,363 | **0** | 4,363 |
| 2026 (unplayed, ESPN-sourced) | 285 | 273 | **0** |

This is not a missing column — it is the union of two datasets whose venue conventions were never
reconciled. **Any query grouping by venue silently breaks at the 2025/2026 boundary**, so
"how does this team perform at this stadium" cannot be asked across the seam.

Fully recoverable: ESPN publishes `venue_id` for historical games (verified — Super Bowl 50 returns
venue 4738, Levi's Stadium). Backfill all 4,363, and backfill `stadium` for 2026 from ESPN's venue
resource, so both columns are populated across the whole range.

### N3 refinement — the line disagreement looks like book variance, not corruption (F08)

F08 measured 494 `game_line` differences in 2024–2025, of which **~77% are exactly ±0.5** — the
signature of different books or different snapshot times, not a systematic error. **12 exceed 2
points**, and those are the genuine error candidates rather than the whole 403/494 population.

This reframes N3 but does not close it: a half-point still decides pushes. The question is no longer
"which archive is corrupt" but "which archive's snapshot convention do we want, and are the
2+ point outliers real?" Those outliers need individual third-source adjudication.

### N5 — five disputed favourite-side spreads, but zero ATS impact (F04, corrected by coordinator)

F04 found five games where the database and SportsOddsHistory disagree about **which club is
favoured**, all on ~1-point lines: `2016_04_IND_JAX`, `2017_03_CLE_IND`, `2017_05_SF_IND`,
`2017_11_ATL_SEA`, `2017_14_PHI_LA`. On four, two independent sources put the favourite on the other
side; on `2017_14_PHI_LA` the DB is right and SOH is wrong.

The diagnosis is good: nflverse's line is byte-identical to ESPN's `teamrankings` feed, and
teamrankings assigns the favourite one way on near-pick'em games while the rest of the market
assigns it the other. It is one upstream feed's convention, inherited whole — not random noise.

**F04 stated that "a backtest will score them opposite to how most books settled them." That is
wrong, and I verified it directly.** Recomputing ATS with the sign flipped changes **nothing** on
all five games — the margins are 3, 3, 3, −3 and −8, all far outside the ±1 window where a
one-point line flip can alter the outcome:

| game | db spread | home margin | ATS as stored | ATS if sign flipped |
|---|---|---|---|---|
| 2016_04_IND_JAX | 1.0 | 3 | W | W |
| 2017_03_CLE_IND | 1.0 | 3 | W | W |
| 2017_05_SF_IND | −1.0 | 3 | W | W |
| 2017_11_ATL_SEA | 1.0 | −3 | L | L |
| 2017_14_PHI_LA | −1.0 | −8 | L | L |

**The real risk surface is elsewhere: 24 games league-wide have both `|margin| ≤ 1.5` and
`|spread| ≤ 1.5`.** Those are the games where this convention disagreement *would* flip an ATS
result. None of the five disputed games is among them. Whether the same convention affects any of
those 24 is the question actually worth answering — that check has not been run.

So: a genuine data-quality defect in the spread sign, and a real modelling concern for anything
using spread as a feature or computing closing-line value. **Not** an ATS-scoring error.

### N6 — `roster_season` cannot reliably answer "who was on this team in week W" (F07, confirmed + worsened)

F07 found that mid-season movers are recorded only under their final team — 206 ESPN-witnessed
memberships missing in its partition alone. Verified, and the real defect is **inconsistency**:

- Christian McCaffrey, 2022: `roster_season` has **one row, SF**. `player_game_stats` correctly has
  **CAR weeks 1–6 and SF weeks 7–21**. The roster table silently erases his half-season in Carolina.
- Yet **549 player-seasons do carry more than one team row**.

So a single-row player-season is ambiguous: it may mean "never moved" or "moved, and only the final
team survived." Nothing in the data distinguishes them. Any query of the form *was this player on
this roster in week W* is unreliable, and the failure is silent — it returns a confident wrong answer
rather than nothing.

`player_game_stats` holds the truth and can be used to reconstruct week-level membership for players
who appeared. It cannot recover a player who was rostered but inactive.

**This is a schema defect, not a data-entry error** — `roster_season` is keyed per player-season and
has no week dimension. Fixing it means either a week-scoped roster table or an explicit
`is_partial_season` marker so the ambiguity is at least visible.

### N7 — the line-authority question is largely resolved, in our favour (F07)

F07 compared ESPN's multi-book consensus against both archives: **ESPN sides with our database over
covers.com by 89 to 35 on spreads and 88 to 47 on totals.** Combined with F08's finding that ~77% of
differences are exactly ±0.5, the picture is now clear — our lines are the better source, and the
bulk of the disagreement is ordinary inter-book variance.

What remains is the tail: F07 flags **28 games differing by ≥2.0 points** for human review, and
F08 flags 12. Those are the genuine error candidates, roughly 40 games rather than 400.

### Verified sound — worth recording as strongly as the defects

- **The 2025 depth-chart week derivation is leakage-free.** F08 rebuilt the calendar independently
  and re-derived all 554,215 rows from raw `dt`: **0 violations**, tightest margin ~10h40m, and 0
  rows skip an intervening event. A naive calendar-year rule would have **misfiled 194,879 rows**.
- **`team_game` arithmetic is exact** — 1,140/1,140 (F08) and 1,068/1,068 (F01, F05) with zero
  disagreements, recomputed independently from `game` + `game_line`.
- **ESPN cannot serve historical depth charts** — proved, not assumed: identical 92-athlete sets
  returned for the 2023, 2024 and 2025 season paths.

## Reported by agents, pending coordinator verification

| # | Finding | Source |
|---|---|---|
| N5 | `game.referee` misspelled "John Perry" for "John Parry" (`2018_11_MIN_CHI`, `2017_04_OAK_DEN`) | F05 |
| N6 | nflverse **dropped** plays in `2018_02_LAC_BUF` (Allen 17/32/215 vs ESPN's 18/33/245) and `2018_14_NYJ_BUF` — the mirror image of D17's duplication, and evidence the defect class runs both directions | F05 |
| N7 | `player.espn_id` wrong or missing for 13 players / 116 rows (F01) plus 4 more (F05) | F01, F05 |

## Structural limits of this audit — not defects, but they bound every claim

- **Pro-Football-Reference is Cloudflare-403 blocked host-wide** — but **not unreachable.**
  F04, F05 and F08 each declared external snap validation impossible after direct attempts
  (F08 tried real headless Chromium). **F03 obtained PFR pages via the Internet Archive's crawl**
  and externally validated **12,404 of its 47,706 snap rows (26.0%)** across 86,828 comparisons at
  100% agreement.

  This corrects a claim I made to the owner. Snap counts are **not** unvalidatable — the direct
  route is blocked, the archive route works. The other partitions' `snap_count` rows are currently
  internal-only **because their agents stopped at the 403, not because the data is unreachable.**
  Extending F03's method across the remaining ~276,000 rows is now the single largest available
  increase in external coverage in this audit, and it should be assigned rather than written off.
- **ESPN publishes no usable historical rosters** — 149 of 5,845 players in F05's window. Roster
  membership is verified through box-score appearances instead, which proves a player *played* but
  not that he was rostered and inactive.
- **No public source has historical depth charts.** All 1,106,729 rows are internal and structural
  only, logged `NOT_COMPARABLE` with that reason.

## Coordinator's own contract defect

The ledger volume rule required collapsing `MATCH` to row-level but said nothing about
`NOT_COMPARABLE`, which turns out to be the dominant verdict. F04's ledger reached 993 MB as a
direct result. The agents followed the contract as written; the contract was wrong.
Handled by `scripts/data/nfl-db/audit/compact_ledgers.py` (~37:1 compression, findings extracted to
plain text) rather than by asking agents to redo work.
