# A5 — Player statistics vs ESPN box scores

## Verdict

**FAIL.** The loader is byte-perfect — all 286,843 `player_game_stats` rows and all 324,611
`snap_count` rows reproduce their nflverse source exactly — but the source itself carries **seven
distinct defect classes that reach the modelling surface**, including two games whose entire box
score is inflated by duplicated plays, four Super Bowls whose snap counts are attributed to the
wrong team, and a `pfr_id` crosswalk swap that hands one player's snap share to another.
Agreement with ESPN on the 299-game sample is 29,921 / 29,993 individual stat comparisons
(**99.760%**), and **61% of all disagreement lives in two games**.

---

## What I checked

Two independent bodies of work, both re-runnable from
`scripts/data/nfl-db/verify/a5_stats.py` (read-only against `nfl.db`).

### Phase 1 — internal consistency, full population, no network

Fifteen checks over **every** row. Not a sample.

| Check | Population | What it asserts |
|---|---:|---|
| IC-01 | 286,843 | completions ≤ attempts, receptions ≤ targets, TDs ≤ opportunities, no negatives, no NULLs |
| IC-03 | 286,843 | yardage never credited without an opportunity (lateral encoding) |
| IC-04 | 286,843 | `target_share` ∈ [0,1], `air_yards_share` bounded |
| IC-05 | 8,726 team-games | Σreceptions = Σcompletions, Σreceiving_yards = Σpassing_yards, Σreceiving_tds = Σpassing_tds, Σtargets ≤ Σattempts, Σtarget_share = 1 |
| IC-06 | 8,726 team-games | scrimmage TDs cannot outscore the team |
| IC-06b | 8,726 team-games | full score reconstructed from the nflverse extract equals `team_game.points_for` |
| IC-07 | 8,726 team-games | every final game has stat lines for both teams; every stat row resolves to exactly one `team_game`; `opponent_id` agrees; no orphan `gsis_id` |
| IC-08 | 31,471 player-season-teams | every stat line's team appears in `roster_season` |
| IC-08b | 923 player-seasons | multi-team seasons are contiguous in time (a trade is not an error; a shuffle is) |
| IC-09 | 324,611 | every snap percentage is reproducible from its own numerator and one integer team snap total |
| IC-10 | 324,611 | snap rows join to a player; season coverage |
| IC-11 | 286,843 × 21 cols | DB equals `raw/player_stats.csv` exactly |
| IC-12 | 324,611 × 11 cols | DB equals `raw/snap_counts.csv` exactly |
| IC-13 | 3,562 game keys | which identifier space `snap_count.pfr_game_id` is actually in |
| IC-14 | 234,316 joinable rows | the same player in the same game is on the same team in both tables |
| IC-15 | 611,454 | nobody plays two games in one week |

`player_game_stats` has no `game_id`. The script recovers it: REG rows join `team_game` on
`(season, week, franchise_id)`; POST rows carry nflverse's continued week counter (18–21 through
2020, 19–22 from 2021), which is ranked within each season to WC/DIV/CON/SB. **All 286,843 rows
resolve to exactly one `team_game`, and all 286,843 agree with `team_game.opponent_id`** — the
join is proven, not assumed.

### Phase 2 — sampled ESPN box-score comparison

`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={espn_event_id}`.
Every response cached gzipped under `scripts/data/nfl-db/cache/a5/` (299 files, 15 MB) and re-read
on every subsequent run; `--offline` refuses the network entirely.

**Sampling frame — stated exactly, seeded (`SEED = 20260727`), reproducible.**

- **Tier A, whole games, every player on both teams.** 2010–2021: 8 REG + 2 POST per season.
  2022–2025: 20 REG + 5 POST per season — the seasons a live model would train on.
- **Tier B.** Every game implicated by a box-score-relevant Phase-1 finding (59 games). Snap
  percentage findings are deliberately excluded from this tier: ESPN publishes no snap counts, so
  those games would add only generic coverage.
- **Tier C.** One extra game for each of the 24 highest-volume prop games in the database
  (targets + carries + pass attempts), not already covered.

Resulting frame after all three tiers are unioned and de-duplicated:

| | REG | POST | total |
|---|---:|---:|---:|
| 2010–2021 | 151 | 27 | 178 |
| 2022–2025 | 101 | 20 | 121 |
| **all** | **252** | **47** | **299** |

Per season: 2010 10/2 · 2011 14/3 · 2012 17/2 · 2013 12/2 · 2014 14/3 · 2015 11/2 · 2016 11/2 ·
2017 12/2 · 2018 12/2 · 2019 12/2 · 2020 13/3 · 2021 13/2 · 2022 26/5 · 2023 23/5 · 2024 27/5 ·
2025 25/5.

**This is 299 of 4,363 final games — 6.85%. It is not full coverage and nothing below should be
read as full coverage.** Inside those 299 games sit **19,668 DB stat rows, 5,950 of which carry
offensive production** — 6.9% of the 86,301 producing rows league-wide. (The DB lists every
participant; ESPN lists only players with a stat line. 200,542 of the 286,843 rows league-wide are
all-zero participation rows.) **6,258 player lines matched an ESPN box-score entry** and were
compared field by field: **29,993 individual stat comparisons.**

### Third source

`pro-football-reference.com` is behind Cloudflare and returns 403 to every request
(`Just a moment...`), so PFR was unavailable for adjudication. **nfl.com's game pages embed the
NFL's own play-by-play** and were used instead — that is the league's primary record, independent
of both ESPN and nflverse. Where the play-by-play is itself ambiguous, that is said so.

---

## Results

### Loader fidelity — clean

| | rows | mismatches |
|---|---:|---:|
| `player_game_stats` vs `raw/player_stats.csv`, 21 columns | 286,843 | **0** |
| `snap_count` vs `raw/snap_counts.csv`, 11 columns | 324,611 | **0** |

The CSV has 287,184 data rows; 341 carry a blank `player_id` and the loader drops them. Those 341
are nflverse's per-week "Team" residual bucket (14,331 penalty yards, 93 safeties, 120 solo
tackles across 16 seasons) — with **one exception that is a real player's production** (see D1).
Agent B4 reached the same conclusion about the bucket independently.

**Every defect below is therefore upstream in nflverse or PFR, faithfully copied into `nfl.db`.
None of them is a `build_db.py` bug.** That distinction matters for the fix: re-running the loader
will not repair any of them.

### Coverage — clean

- 4,363 final games × 2 = **8,726 team-games; every one has player stat lines.** Zero gaps.
- 286,843 / 286,843 stat rows resolve to a `team_game`; 0 opponent mismatches; 0 orphan `gsis_id`.
- `snap_count` covers **2013–2025 only**. `player_game_stats` covers 2010–2025. Seasons 2010, 2011
  and 2012 have stat lines with no snap data at all — **52,386 stat rows with no usage signal**.
  For 2012 that is an extract gap, not a source gap: nflverse publishes snap counts from 2012.
  For 2010–2011 no snap data exists anywhere; that is structurally not applicable.

### Internal consistency — impossible values

Zero occurrences of: completions > attempts, receptions > targets, passing TDs > completions,
rushing TDs > carries, INTs > attempts, any negative counting stat, passing yards without an
attempt, any NULL in a core counting column, `target_share` outside [0,1], snap counts below zero,
duplicate stat rows for one player-week.

Two rows have `receiving_tds > receptions` (Josh Allen 2024 wk13, Jahmyr Gibbs 2024 wk3) and 57
rows carry yardage with zero opportunity. All 59 are the **lateral encoding**: nflverse credits
lateral yardage and the TD to the lateral receiver without crediting a reception or carry. ESPN
books the whole play to the original receiver. This is a definitional difference, not a wrong
value — but a prop model that reads `receiving_yards > 0 AND receptions = 0` as a catch will be
wrong 57 times.

Five rows have `air_yards_share > 1`. That is arithmetically correct: the denominator is *team*
air yards from play-by-play, which goes down when team-mates catch passes thrown behind the line.
Recomputed from the source for 4 of the 5 and it reproduces exactly; the 5th uses a PBP
denominator that includes throwaways. **The [0,1] bound is the wrong assumption, not the data.**

### Score reconstruction — 8,443 / 8,726 exact

Reconstructing each team-game's score from the full nflverse extract (TDs from the scorer's side
only, 2-point conversions counted once rather than twice, PATs, FGs):

| residual (`points_for` − reconstructed) | team-games |
|---:|---:|
| 0 | 8,443 |
| +2 (one safety) | 278 |
| +4 (two safeties) | 3 |
| −6 | 1 |
| −12 | 1 |

Safeties are the one score nflverse does not attribute reliably — `def_safeties` is populated for
only 177 of the 281 team-games whose residual is +2/+4 — so the check allows exactly 2 points per
safety. The two negative residuals are the same game and are a real defect (D6).

### Snap percentage self-consistency — 324,611 rows, no network

For each team-game-phase, is there an integer team snap total *D* such that every published
percentage equals snaps/*D*?

| | team-game-phases |
|---|---:|
| reconcile exactly (published pct = nearest whole percent of snaps/*D*) | 20,660 |
| reconcile only within ±1 percentage point | 691 |
| no integer *D* works at all | 23 |

2,111 rows sit inside the ±1-point band. PFR publishes snap share as a whole percent and from 2019
onward its published percent is not always the nearest whole percent — that is publication grain,
reported not counted. **56 rows in 23 team-game-phases cannot be reconciled at all**, and 7 of
those are gross (D3). A further 3 rows carry `st_pct = 1.01`, above the possible maximum.

### ESPN agreement — 299 games, 6,258 player lines, 29,993 comparisons

| stat | agreed / compared | rate |
|---|---:|---:|
| passing TDs | 712 / 712 | **100.0000%** |
| interceptions | 712 / 712 | **100.0000%** |
| receiving TDs | 4,773 / 4,773 | **100.0000%** |
| rushing TDs | 2,445 / 2,447 | 99.9183% |
| receiving yards | 4,765 / 4,773 | 99.8324% |
| receptions | 4,765 / 4,773 | 99.8324% |
| carries | 2,442 / 2,447 | 99.7957% |
| rushing yards | 2,442 / 2,447 | 99.7957% |
| attempts | 709 / 712 | 99.5787% |
| completions | 709 / 712 | 99.5787% |
| passing yards | 708 / 712 | 99.4382% |
| **targets** | **4,739 / 4,773** | **99.2877%** |
| **all fields** | **29,921 / 29,993** | **99.7600%** |

**72 disagreements. 48 of them are in four games; 44 in just two.**

| game | disagreements | verdict |
|---|---:|---|
| `2011_13_DET_NO` | 36 | DB wrong (D6) |
| `2011_10_DET_CHI` | 8 | DB wrong (D6) |
| `2012_06_DAL_BAL` | 3 | DB wrong (D1) |
| `2022_16_LAC_IND` | 1 | DB wrong by 1 yard (E4) |
| 18 other games | 24 target rows | source disagreement, no winner |

### Targets — the definitional question, answered before counting errors

The task asked whether ESPN and nflverse count targets identically. **They do not, in two specific
ways, and both were established before any difference was called an error.**

1. **ESPN's receiving table lists only players who caught at least one pass.** A player targeted
   zero-for-N is absent from ESPN's box score entirely, and ESPN's team target total is short by
   exactly those targets. Verified on `2012_06_DAL_BAL`: DAL's DB target sum is 34, ESPN's athlete
   sum is 32, and the gap is Kevin Ogletree's 4 targets on 0 catches (less Dez Bryant's 2 missing
   targets). **7,600 rows league-wide have `targets > 0` with `receptions = 0`; 94 fell inside the
   sample.** All 94 are invisible to ESPN. This is not a DB error — the DB is the more complete
   side — but any ESPN-based target validation will systematically undercount.

2. **Where both sources list a player, they sometimes disagree about *which* receiver was the
   intended target of an incompletion.** Of 34 target disagreements, **14 are pure attribution:
   the team's total target count over matched players is identical, only the receiver differs**
   (e.g. `2010_05_CHI_CAR`, Devin Hester ESPN 4 / DB 5 and Johnny Knox ESPN 5 / DB 4). Comparing
   only players present in both sources, **584 of 598 team-games agree on the target total
   exactly.**

Netting out the two defective 2011 Detroit games and the Dez Bryant row, **10 target rows remain
where the two sources genuinely differ on a team's total, always by 1–2 targets.** Those are
itemized below; each is a single judgment call on a single play (throwaway, spike, or a pass
interference flag). I did not pick a winner.

### Fumbles and two-point conversions

**Structurally not applicable.** `player_game_stats` has no fumble and no two-point-conversion
columns — the loader keeps 21 of the source's 145 columns. ESPN publishes both. They therefore
could not be compared against the DB. The source CSV does carry
`sack_fumbles`/`rushing_fumbles`/`receiving_fumbles`/`fumbles_total`/`fumbles_lost_total` and
`passing_2pt_conversions`/`rushing_2pt_conversions`/`receiving_2pt_conversions`; the 2-point
columns were exercised through IC-06b and are coherent (they reconstruct 8,443 scores exactly,
once you know nflverse credits a passing 2-pointer to both passer and receiver). If fumbles are
ever added to the schema, they should be validated separately — nothing in this report covers them.

---

## Exceptions

Seven confirmed defects and four unresolved source disagreements. Every one is itemized.

### D1 — Dez Bryant's line is short 2 receptions / 11 yards / 2 targets

| | receptions | yards | TDs | targets |
|---|---:|---:|---:|---:|
| `nfl.db` | 11 | 84 | 2 | 13 |
| ESPN | **13** | **95** | 2 | **15** |
| nfl.com official play-by-play | **13** | **95** | 2 | — |

`gsis_id 00-0027902`, 2012 wk6 REG, `2012_06_DAL_BAL`. The missing production sits in nflverse's
blank-`player_id` residual row — which nflverse also mislabels as team `TEN` in game
`2012_06_PIT_TEN`, a different game entirely (`{'receptions': '2', 'targets': '2',
'receiving_yards': '11'}`). The loader correctly drops rows with no player key, so the production
is lost. **Verdict: DB wrong.** This is the only one of the 341 dropped rows that contains real
player production; the other 340 are team-level penalties and safeties.

Corroborated internally: DAL is the only team-game in 16 seasons whose receptions (23) fall short
of its own completions (25) — see E1.

### D2 — 13 Tampa Bay 2020 stat lines keyed to the wrong Mike Edwards

Attached to `00-0039472` = Mike Edwards, **OL**, Campbell/Wake Forest, born 1998, rookie year
**2024**, `pfr_id EdwaMi02`. Belongs to `00-0035681` = Mike Edwards, **S**, drafted by Tampa Bay
in round 3 of 2019.

Provable without leaving the database:

- `snap_count` has all 20 of the safety's 2020 games under `00-0035681`/`EdwaMi01`, including
  71 defensive snaps in the NFC Championship.
- `roster_season` has `00-0035681` on franchise 27 in 2020, `ACT`, jersey 32.
- `player_game_stats` has **no 2020 rows at all** for `00-0035681`.
- The OL has zero snap rows in any season and no roster row before 2024.

Present in `raw/player_stats.csv` with `player_id = 00-0039472`, so upstream. All 13 rows are
all-zero, so no numeric value is wrong — but the identity is, and a join on `gsis_id` will attach a
2024 offensive lineman to a 2020 safety's usage. **Verdict: nflverse identity collision, carried
into the DB.**

### D3 — 7 snap rows whose `st_pct` cannot be reconciled at all

| game | franchise | player | st_snaps | st_pct | best team total | implied | deviation |
|---|---:|---|---:|---:|---:|---:|---:|
| `2025_20_SF_SEA` | 26 | `OTooCo00` (LB) | 17 | 0.07 | 24 | 0.7083 | 0.6383 |
| `2025_12_BUF_HOU` | 34 | `TownTo01` (P) | 11 | 0.00 | 29 | 0.3793 | 0.3793 |
| `2025_18_IND_HOU` | 34 | `MerrKa00` (S) | 13 | 0.03 | 36 | 0.3611 | 0.3311 |
| `2025_16_BUF_CLE` | 5 | `SunaRe00` (LS) | 7 | 0.02 | 24 | 0.2917 | 0.2717 |
| `2025_06_BUF_ATL` | 1 | `GwynJo00` (OL) | 5 | 0.02 | 25 | 0.2000 | 0.1800 |
| `2025_15_NYJ_JAX` | 30 | `StriDa01` (DL) | 8 | 0.12 | 30 | 0.2667 | 0.1467 |
| `2025_15_LV_PHI` | 21 | `BennJa00` (CB) | 3 | 0.07 | 18 | 0.1667 | 0.0967 |

All 2025, all special teams. **Third source unavailable** — PFR is Cloudflare-blocked (403) and
ESPN publishes no snap counts, so these could not be adjudicated externally. The internal evidence
is conclusive on its own: no integer team total reconciles the percentage with its own numerator.
Values are byte-identical to `raw/snap_counts.csv`, so upstream.

Plus **3 rows with `st_pct = 1.01`** (`2021_13_IND_HOU` × 2, `2021_15_SEA_LA` × 1) — above the
possible maximum. And **49 further rows in 16 team-game-phases** deviating 0.01–0.02 (seasons
2019–2024), listed in the script's output.

### D4 — Four Super Bowls have every snap row on the wrong team

| game | snap rows | joinable rows | agree | disagree |
|---|---:|---:|---:|---:|
| `2014_21_NE_SEA` (SB XLIX) | 88 | 58 | **0** | **58** |
| `2015_21_CAR_DEN` (SB 50) | 89 | 66 | **0** | **66** |
| `2018_21_NE_LA` (SB LIII) | 90 | 55 | **0** | **55** |
| `2020_21_KC_TB` (SB LV) | 91 | 61 | **0** | **61** |

The two teams' rows are swapped wholesale. Tom Brady's 74 SB XLIX snaps are filed under Seattle
and his 67 SB LV snaps under Kansas City; Marshawn Lynch's 43 carries-worth of snaps under New
England; Patrick Mahomes' 75 under Tampa Bay; Peyton Manning's 60 under Carolina. The other nine
Super Bowls (2013, 2016, 2017, 2019, 2021–2025) are 100% correct.

The swap is present in `raw/snap_counts.csv` — the CSV's own `team` column says `SEA` for Tom Brady
in `2014_21_NE_SEA` — so it is upstream nflverse, faithfully copied. **358 rows total.**
No external source needed: Tom Brady never played for Kansas City.

### D5 — `player.pfr_id` swapped between the two Jonah Williamses

| gsis | player | college | `player.pfr_id` | stat-line teams | snap-count teams |
|---|---|---|---|---|---|
| `00-0035629` | Jonah Williams, **OT** | Alabama | `WillJo16` | CIN, ARI | LAR, MIN, DET, NO |
| `00-0035944` | Jonah Williams, **DE** | Weber State | `WillJo10` | LAR, MIN, DET, NO | CIN, ARI |

The two `pfr_id` values are exchanged, so `snap_count`'s `pfr_player_id → gsis_id` resolution
attaches every snap row to the wrong man — **146 rows, 45 of them in weeks where both tables have a
row and directly contradict each other.** Ten player-seasons (2021–2025) have snap teams and stat
teams that do not intersect at all. Both men are non-skill positions, so no prop line is currently
poisoned, but the mechanism is generic: a bad `pfr_id` silently redirects a player's entire usage
history.

### D6 — Two 2011 Detroit games have duplicated plays

**`2011_13_DET_NO`** — 10 players inflated across both teams:

| player | stat | ESPN | nfl.db |
|---|---|---:|---:|
| Matthew Stafford | comp / att / yds | 31 / 44 / 408 | **36 / 51 / 461** |
| Drew Brees | comp / att / yds | 26 / 36 / 342 | **29 / 39 / 401** |
| Kevin Smith | car / yds / **TD** | 6 / 34 / **1** | **8 / 42 / 2** |
| Kevin Smith | rec / yds | 6 / 46 | **8 / 69** |
| Mark Ingram II | car / yds / **TD** | 16 / 54 / **1** | **18 / 72 / 2** |
| Robert Meachem | rec / yds | 3 / 119 | **4 / 157** |
| Marques Colston | rec / yds | 6 / 54 | **8 / 75** |
| Maurice Morris | car / yds, rec / yds | 12 / 28, 5 / 47 | **14 / 31, 6 / 58** |
| Nate Burleson | rec / yds | 5 / 93 | **6 / 107** |
| Calvin Johnson | rec / yds | 6 / 69 | **7 / 74** |
| Darren Sproles | car / yds | 4 / 28 | **5 / 29** |

Adjudicated three ways, all against the DB:

1. **The score.** nflverse credits New Orleans 6 offensive/return TDs; New Orleans scored 31
   (4 TD + 4 XP + 1 FG). It credits Detroit 3; Detroit scored 17 (2 TD + 2 XP + 1 FG). This is the
   **only** game in 2010–2025 whose score cannot be reconstructed.
2. **nfl.com's official play-by-play** lists exactly six touchdowns in the game — Ingram 14-yd run,
   Brees→Meachem 67, K. Smith 2-yd run, Brees→Moore 20, Stafford→Morris 9, Brees→Sproles 6.
   Ingram and Smith have one rushing TD each, not two.
3. **Play-level hand count.** Meachem's receptions in the official PBP are 38 + 67 + 14 = 3 for 119
   yards — ESPN exactly; the DB's 157 is 119 + a second copy of the 38-yard catch. Colston's are
   7 + 6 + 7 + 3 + 18 + 13 = 6 for 54 — ESPN exactly; the DB's 75 is 54 + a second copy of the
   3- and 18-yard catches.

**`2011_10_DET_CHI`** — same class, smaller: Stafford ESPN 33/63/329 vs DB 35/66/338; Titus Young
ESPN 7 rec / 74 yds vs DB 9 / 83. The official play-by-play contains the same play twice
(`play-2044` "to T.Young to CHI 22 for 9 yards (T.Jennings) [L.Briggs]" and `play-2080`
"to T.Young ran ob at CHI 22 for 9 yards (T.Jennings)"), which accounts for the extra reception
and the 9 yards exactly. **One reception of the 2-reception gap remains unexplained** — my
play-level count gives Young 8 receptions for 74 yards where ESPN gives 7 for 74, the difference
being a 0-yard catch. Recorded rather than resolved.

Because nfl.com's rendering of `2011_13_DET_NO` also contains duplicated plays (221 play keys for a
~170-play game, 31 with identical text) while its `2011_10_DET_CHI` page does not (183 keys, 5
duplicates), the likeliest root cause is duplicated rows in the NFL's own play-by-play feed for
those games, which nflverse aggregates and inherits and ESPN — collecting independently — does not.

### D7 — One player, two simultaneous games

Three `snap_count` rows put `DaviJa06` (Jalen Davis, CB) in two games kicking off the same day:

| season | week | games |
|---:|---:|---|
| 2019 | 16 | `2019_16_ARI_SEA` + `2019_16_CIN_MIA` |
| 2019 | 17 | `2019_17_ARI_LA` + `2019_17_MIA_NE` |
| 2021 | 12 | `2021_12_CAR_MIA` + `2021_12_PIT_CIN` |

PFR conflates two players under one id. Present in `raw/snap_counts.csv`. Across all 324,611 snap
rows and all 286,843 stat rows these are the only three violations — the rest of the population is
clean.

### E1 — Two team-games break nflverse's own passing/receiving identity

| team-game | disagreement | resolution |
|---|---|---|
| `2012_06_DAL_BAL` / DAL | receptions 23 ≠ completions 25; receiving yards 250 ≠ passing yards 261; Σtarget_share = 0.9444 | **D1** |
| `2022_16_LAC_IND` / IND | receiving yards 143 ≠ passing yards 144 | **E4** |

8,724 of 8,726 team-games satisfy the identity exactly.

### E2 — 10 target rows where ESPN and nflverse disagree on the team total

Excluding the games already convicted above. Each is a single target on a single play; no third
source resolves them, and neither side is obviously right.

| game | player | ESPN | DB | team total ESPN vs DB |
|---|---|---:|---:|---|
| `2010_01_MIN_NO` | Marques Colston | 7 | 6 | 36 vs 35 |
| `2010_12_SF_ARI` | Larry Fitzgerald | 10 | 9 | 33 vs 32 |
| `2010_18_GB_PHI` (WC) | Riley Cooper | 5 | 4 | 36 vs 35 |
| `2011_16_NYG_NYJ` | Victor Cruz | 7 | 8 | 24 vs 25 |
| `2011_16_NYG_NYJ` | Dustin Keller | 19 | 18 | 56 vs 55 |
| `2012_01_PHI_CLE` | DeSean Jackson | 9 | 11 | 54 vs 56 |
| `2012_05_SEA_CAR` | Sidney Rice | 5 | 6 | 22 vs 23 |
| `2012_19_GB_SF` (DIV) | Greg Jennings | 7 | 8 | 35 vs 36 |
| `2013_02_SD_PHI` | Antonio Gates | 11 | 10 | 46 vs 45 |
| `2013_03_ATL_MIA` | Mike Wallace | 4 | 5 | 34 vs 35 |

(Ten rows across nine games — `2011_16_NYG_NYJ` contributes one per team.) All are 2010–2013;
nothing after 2013 disagrees on a team target total outside the defective games. A further 14
target rows differ only in *which* receiver was charged, with the team total identical — recorded
in the script output as `E_TARGET_ATTRIBUTION`, not counted as errors.

### E3 — ESPN omits Zach Ertz from every box score. The DB is right.

16 rows in the sample flagged "DB has production, ESPN does not list him" resolve to one athlete.
ESPN's own arithmetic convicts ESPN: in each of these games ESPN's team passing completions and
yards exceed the sum of its own receiving table by **exactly** the DB's Ertz line.

| game | ESPN team passing | ESPN receiving table | gap | DB Ertz |
|---|---|---|---|---|
| `2013_02_SD_PHI` PHI | 23 comp / 428 yds | 21 / 370 | 2 / 58 | **2 / 58** |
| `2016_13_PHI_CIN` PHI | 36 / 308 | 27 / 229 | 9 / 79 | **9 / 79** |
| `2018_02_PHI_TB` PHI | 35 / 334 | 24 / 240 | 11 / 94 | **11 / 94** |
| `2021_16_IND_ARI` ARI | 27 / 245 | 19 / 191 | 8 / 54 | **8 / 54** |
| `2024_08_CHI_WAS` WSH | 21 / 326 | 14 / 249 | 7 / 77 | **7 / 77** |
| `2024_20_WAS_DET` WSH | 22 / 299 | 17 / 271 | 5 / 28 | **5 / 28** |

**Verdict: ESPN defect, DB correct.** Worth recording because it bounds how far ESPN can be trusted
as an oracle: any future ESPN-based validation must reconcile ESPN's passing totals against its own
receiving table before concluding the DB is wrong.

### E4 — Nick Foles, one yard

`2022_16_LAC_IND`, `00-0029567`. ESPN 143 passing yards, DB 144. The DB is internally inconsistent
here too: IND's `passing_yards` sum is 144 while its own receivers' `receiving_yards` sum to 143,
and ESPN's 143 matches the DB's receiving side. The nfl.com play-by-play hand-sums to 142 across 17
completions, but its renderer collapses "pushed ob at" variants so a single yard is inside its
resolution. **Verdict: the DB's `passing_yards` is the outlier by 1 yard; cause almost certainly a
lateral on a completed pass. Not resolved to certainty.**

### E5 — `player.espn_id` is wrong for 5 players seen in the sample

| gsis | player | `player.espn_id` | ESPN's actual athlete id |
|---|---|---|---|
| `00-0020679` | Shaun Hill | 3923394 | **4260** |
| `00-0027325` | LeGarrette Blount | 3166800 | **13213** |
| `00-0028492` | Henry Hynoski | 2268575 | **14608** |
| `00-0031484` | Chris Manhertz | 4071345 | **2531358** |
| `00-0032098` | Daniel Brown | 2544798 | **2519013** |

Found because 19 box-score lines could not be matched by id and had to fall back to name matching.
Their **stat values agree with ESPN exactly** — only the crosswalk is wrong. This is the `player`
dimension's problem (agent B5) rather than a stats problem, but it will break any ESPN join and
it was found here, so it is recorded here. Only players who appeared in the 299 sampled games were
tested; the true count across all 16,768 populated `espn_id` values is unknown.

### E6 — 1,056 stat lines whose team is absent from `roster_season`

1,055 are mid-season moves: the player is on some **other** team's `roster_season` for the same
season, because nflverse's `roster_season` is an end-of-season snapshot that omits stints finished
before it was taken (James Harrison 2017 PIT→NE, Dwight Freeney 2017 SEA→DET, Terrell Suggs 2019
ARI→KC, …). **A trade is not an error.** Confirmed by IC-08b: of 923 player-seasons with more than
one team, 912 have strictly contiguous team blocks and the 11 that do not are all documented
round-trips (Micheal Spurlock SD→JAX→SD 2012, Knile Davis KC→GB→KC 2016, Marcus Sherels
MIN→MIA→MIN 2019, …). Named individually in the script's `KNOWN_EXCEPTIONS`.

The 1,056th is **D2**.

### E7 — Two structural gaps, stated as gaps

- **`snap_count.pfr_game_id` does not contain PFR game ids.** All 3,562 distinct values match
  `game.game_id` (nflverse space, e.g. `2013_01_ARI_STL`); **0** match `game.pfr_game_id`
  (e.g. `201309080ram`). `raw/snap_counts.csv` ships both columns and the loader took the wrong
  one. The values are correct and usable — the *name* is a trap, and any join written against
  `game.pfr_game_id` returns zero rows silently.
- **227 snap rows have no `gsis_id`** and cannot join to `player_game_stats` at all. Agent B1 has
  resolved all 227 to player identities; nothing further from me.

---

## Limits of this verification — read before trusting the 99.76%

1. **6.85% of games, not 100%.** 299 of 4,363. The per-stat rates above describe the sample. Two
   of the 299 games were badly wrong; if that rate held league-wide it would imply roughly 30
   corrupted games, but the sample was *not* drawn to estimate that rate — Tier B deliberately
   oversampled anomalies. The honest statement is: **two corrupted games found, both in 2011,
   both Detroit, both surfaced by the full-population score reconstruction rather than by ESPN.**
2. **The score reconstruction only catches duplication that moves the score.** `2011_13_DET_NO` was
   caught because the duplicated plays included touchdowns. `2011_10_DET_CHI` was not — it was
   caught only because ESPN happened to sample it. **A full-population detector for
   non-scoring play duplication does not exist in this repo and cannot be built without team-level
   offensive yardage, which `nfl.db` does not store.** That is the single largest residual risk
   to the prop model and the coordinator should treat it as open.
3. **Snap counts have no external oracle.** ESPN publishes none; PFR is Cloudflare-blocked. Every
   snap finding here is internal-consistency or cross-table, which is why D4 and D5 are provable
   but D3 is not adjudicable.
4. **Fumbles and 2-point conversions were not compared** — the columns do not exist in the schema.
5. **`player_game_stats` has no foreign key to `game`.** The `(season, week, season_type,
   franchise_id)` join is provably 1:1 today, but nothing in the schema enforces it.

---

## Reproduce

```bash
cd scripts/data/nfl-db

# everything, cache-only (299 ESPN responses already in cache/a5/), ~20 s
python3 verify/a5_stats.py --phase all --offline --max-rows 500 --json /tmp/a5.json
echo "exit=$?"        # 1 while the confirmed defects remain in the data

# full-population checks only, no network at all, ~60 s
python3 verify/a5_stats.py --phase internal

# re-fetch anything missing from the cache (rate-limited, 1.2 s between requests)
python3 verify/a5_stats.py --phase espn
```

Individual findings, each independently:

```bash
# D1 — Dez Bryant. DB says 11/84; the blank-player_id row holds the missing 2/11.
sqlite3 nfl.db "SELECT p.display_name, s.receptions, s.targets, s.receiving_yards, s.receiving_tds
  FROM player_game_stats s JOIN player p USING(gsis_id)
  WHERE s.gsis_id='00-0027902' AND s.season=2012 AND s.week=6 AND s.season_type='REG';"
python3 -c "
import csv; csv.field_size_limit(10**9)
for r in csv.DictReader(open('raw/player_stats.csv')):
    if not r['player_id'] and r['season']=='2012' and r['week']=='6':
        print({k:v for k,v in r.items() if v not in ('','0','0.0','NA')})"
curl -s 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=321014033' \
  | python3 -c "import json,sys; d=json.load(sys.stdin)
for t in d['boxscore']['players']:
  for st in t['statistics']:
    if st['name']=='receiving' and t['team']['abbreviation']=='DAL':
      [print(a['athlete']['displayName'], a['stats']) for a in st['athletes']]"

# D2 — the two Mike Edwardses. snap_count and roster_season both say the safety played 2020.
sqlite3 nfl.db "SELECT gsis_id, display_name, position, college, rookie_year, pfr_id
  FROM player WHERE display_name='Mike Edwards';"
sqlite3 nfl.db "SELECT season, COUNT(*) FROM player_game_stats WHERE gsis_id='00-0035681' GROUP BY 1;"
sqlite3 nfl.db "SELECT COUNT(*) FROM snap_count WHERE pfr_player_id='EdwaMi01' AND season=2020;"

# D4 — Super Bowl snap swap. Tom Brady, filed under Seattle and Kansas City.
sqlite3 nfl.db "SELECT s.pfr_game_id, t.abbreviation, s.offense_snaps
  FROM snap_count s JOIN team t ON t.franchise_id=s.franchise_id
  WHERE s.gsis_id='00-0019596' AND s.season_type='SB';"

# D5 — Jonah Williams pfr_id swap.
sqlite3 nfl.db "SELECT gsis_id, display_name, position, college, pfr_id FROM player
  WHERE display_name='Jonah Williams';"
sqlite3 nfl.db "SELECT gsis_id, 'snap' src, GROUP_CONCAT(DISTINCT franchise_id) FROM snap_count
  WHERE gsis_id IN ('00-0035629','00-0035944') GROUP BY 1
  UNION ALL SELECT gsis_id, 'stats', GROUP_CONCAT(DISTINCT franchise_id) FROM player_game_stats
  WHERE gsis_id IN ('00-0035629','00-0035944') GROUP BY 1;"

# D6 — the two 2011 Detroit games.
curl -s 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=311204018' > /tmp/detno.json
sqlite3 nfl.db "SELECT p.display_name, s.carries, s.rushing_yards, s.rushing_tds,
  s.receptions, s.receiving_yards, s.completions, s.attempts, s.passing_yards
  FROM player_game_stats s JOIN player p USING(gsis_id)
  WHERE s.season=2011 AND s.week=13 AND s.season_type='REG' AND s.franchise_id IN (8,18)
    AND (s.carries>0 OR s.receptions>0 OR s.attempts>0);"
curl -sL -A 'Mozilla/5.0' 'https://www.nfl.com/games/lions-at-saints-2011-reg-13' \
  | python3 -c "
import re,sys
h=sys.stdin.read().replace(chr(92)+chr(34),chr(34))
p=re.findall(r'detailsSecondaryText\":\"\s*—\s*(.*?)\",\"color\"', h)
[print(x) for x in dict.fromkeys(p) if 'TOUCHDOWN' in x.upper()]"

# D7 — one player, two simultaneous games.
sqlite3 nfl.db "SELECT gsis_id, pfr_player_id, season, week, GROUP_CONCAT(pfr_game_id)
  FROM snap_count WHERE gsis_id IS NOT NULL AND gsis_id<>''
  GROUP BY gsis_id, season, week HAVING COUNT(DISTINCT pfr_game_id)>1;"

# E3 — ESPN omits Zach Ertz; ESPN's own passing total exceeds its own receiving table.
curl -s 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401671885' \
  | python3 -c "import json,sys; d=json.load(sys.stdin)
for t in d['boxscore']['players']:
  c={s['name']:s for s in t['statistics']}
  comp=sum(int(dict(zip(c['passing']['keys'],a['stats']))['completions/passingAttempts'].split('/')[0]) for a in c['passing']['athletes'])
  rec=sum(int(dict(zip(c['receiving']['keys'],a['stats']))['receptions']) for a in c['receiving']['athletes'])
  print(t['team']['abbreviation'], 'passing completions', comp, 'receiving table', rec)"

# E7 — snap_count.pfr_game_id is in the nflverse id space, not PFR's.
sqlite3 nfl.db "SELECT (SELECT COUNT(*) FROM (SELECT DISTINCT pfr_game_id p FROM snap_count)
    WHERE p IN (SELECT game_id FROM game)) AS matches_nflverse,
  (SELECT COUNT(*) FROM (SELECT DISTINCT pfr_game_id p FROM snap_count)
    WHERE p IN (SELECT pfr_game_id FROM game)) AS matches_pfr;"
```

Cached ESPN evidence: `scripts/data/nfl-db/cache/a5/summary_<espn_event_id>.json.gz`, 299 files,
15 MB. Every number in the ESPN section is derivable from those files plus `nfl.db` with no network.
