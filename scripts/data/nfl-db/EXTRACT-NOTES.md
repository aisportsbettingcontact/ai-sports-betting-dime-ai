# nflverse player-level extraction — notes

Extracted 2026-07-27, R 4.6.1 (aarch64-apple-darwin25.4.0), nflreadr 1.5.1. Total wall time: 1.44
minutes for all 5 datasets (nflverse serves these as pre-built per-season release assets, not live
scrapes, so this was fast). All row counts were validated against a 90%-of-expected floor **before**
any CSV was written, per the safety rule in the task (nflreadr can return an empty frame with only a
warning, and memoise can cache that empty result as a false "success").

## Status: all 5 OK on the first attempt — zero retries, zero gaps

| dataset | status | rows written | cols written | bytes | file |
|---|---|---:|---:|---:|---|
| players | OK (attempt 1) | 25,035 | 39 | 8,303,356 | players.csv |
| rosters | OK (attempt 1) | 43,856 | 36 | 15,254,224 | rosters.csv |
| snap_counts | OK (attempt 1) | 324,611 | 16 | 34,505,950 | snap_counts.csv |
| player_stats | OK (attempt 1) | 287,184 | 145 | 130,674,992 | player_stats.csv |
| depth_charts | OK (attempt 1) | 1,106,729 | 26 | 142,380,043 | depth_charts.csv |

**Total: 331,118,565 bytes (315.8 MB / 329 MB on disk, `du -sh`)** across the 5 CSVs. Every load hit
its expected row count on the first attempt — the retry-once-then-record-a-gap path was never
triggered.

Row counts were independently re-verified by re-parsing the *written CSV files* with a real CSV
parser (`data.table::fread`), not just trusted from the in-memory R object that produced them. That
check caught a real, worth-knowing discrepancy — see the depth_charts CSV-quoting note below.

---

## 1. players.csv — 25,035 rows x 39 cols

**Columns (39):** `gsis_id, display_name, common_first_name, first_name, last_name, short_name,
football_name, suffix, esb_id, nfl_id, pfr_id, pff_id, otc_id, espn_id, smart_id, birth_date,
position_group, position, ngs_position_group, ngs_position, height, weight, headshot, college_name,
college_conference, jersey_number, rookie_season, last_season, latest_team, status, ngs_status,
ngs_status_short_description, years_of_experience, pff_position, pff_status, draft_year, draft_round,
draft_pick, draft_team`

**Join key: `gsis_id`** — 100.00% populated (25,035 / 25,035), **25,035 distinct = exactly one row
per player, no duplicate values.** This is the canonical key for this table and the best of the 8
ID columns present.
- Other ID columns, all weaker: `esb_id` 100.00% populated but only 25,034 distinct (see data-quality
  note below), `smart_id` 100.00%/25,034 distinct, `pfr_id` 90.09%, `espn_id` 66.98%, `nfl_id` 48.27%,
  `pff_id` 44.92%, `otc_id` 37.30%.
- **Data-quality footnote (spot-checked, not exhaustively audited):** `gsis_id` is 100%-populated and
  row-unique, but not perfectly clean. Example found: player "Layne Pryor" appears as two rows
  sharing the same `esb_id`/`smart_id` (`PRY456541` / `32005052-5945-6541-b8ff-63047ad93bc7`) — one
  row has a correctly-formatted `gsis_id` (`00-0040792`), the other has `gsis_id` seemingly
  back-filled with the `esb_id` value (`PRY456541`) instead of the `00-XXXXXXX` format. A downstream
  loader that assumes every `gsis_id` matches `^00-\d{7}$` should validate rather than trust blindly.

**Season columns:** `rookie_season`, `last_season` — both integer, 0% NA, 53 distinct values each,
range **1974–2026**.

**Week columns:** none.

**Team columns:** `latest_team` (0% NA, 33 distinct), `draft_team` (51.16% NA — undrafted players,
32 distinct when present).
- `latest_team`: `ARI, ATL, AZ, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, GB, HOU, IND, JAX, KC, LA,
  LAC, LV, MIA, MIN, NE, NO, NYG, NYJ, PHI, PIT, SEA, SF, TB, TEN, WAS` — note **both "ARI" and "AZ"**
  appear for the same Arizona franchise, a within-column inconsistency.
- `draft_team`: same list minus "AZ" (32 values).
- No OAK/SD/STL/WSH anywhere — this table only ever shows current-era abbreviations.

---

## 2. rosters.csv — 43,856 rows x 36 cols

**Columns (36):** `season, team, position, depth_chart_position, jersey_number, status, full_name,
first_name, last_name, birth_date, height, weight, college, gsis_id, espn_id, sportradar_id,
yahoo_id, rotowire_id, pff_id, pfr_id, fantasy_data_id, sleeper_id, years_exp, headshot_url,
ngs_position, week, game_type, status_description_abbr, football_name, esb_id, gsis_it_id, smart_id,
entry_year, rookie_year, draft_club, draft_number`

**Join key: `gsis_id`** — 99.96% populated (43,838 / 43,856), 11,591 distinct (expected — this is a
season×player panel, not one-row-per-player). Alternates: `esb_id` 99.75%, `smart_id` 99.67%,
`gsis_it_id` 86.69%; `sportradar_id`/`sleeper_id`/`rotowire_id`/`espn_id`/`pff_id`/`yahoo_id`/
`fantasy_data_id` all 43–58%; `pfr_id` 43.02%.

**Season column:** `season`, integer, 0% NA, **2010–2025** (16 seasons, exactly as requested).

**Week column:** `week`, integer, 0% NA, values 1–22. Rosters here are recorded **per week**, not
one snapshot per player-season — plan joins accordingly.

**game_type** (2015 sample): `CON, DIV, REG, SB, WC` — playoffs broken into round, not collapsed to
a single "POST" (contrast with player_stats, below).

**Team columns:** `team` (39 distinct) and `draft_club` (42 distinct) — **the messiest team columns
of all 5 datasets.** Both mix three different abbreviation conventions in the same column:
- `team`: `ARI, ARZ, ATL, BAL, BLT, BUF, CAR, CHI, CIN, CLE, CLV, DAL, DEN, DET, GB, HOU, HST, IND,
  JAX, KC, LA, LAC, LV, MIA, MIN, NE, NO, NYG, NYJ, OAK, PHI, PIT, SD, SEA, SF, SL, TB, TEN, WAS`
- `draft_club`: same plus `JAC` (alongside `JAX`), `LAR` (alongside `LA`), `STL` (alongside `SL`):
  `ARI, ARZ, ATL, BAL, BLT, BUF, CAR, CHI, CIN, CLE, CLV, DAL, DEN, DET, GB, HOU, HST, IND, JAC, JAX,
  KC, LA, LAC, LAR, LV, MIA, MIN, NE, NO, NYG, NYJ, OAK, PHI, PIT, SD, SEA, SF, SL, STL, TB, TEN, WAS`
- Historical relocation codes present: **OAK, SD** (team) / **OAK, SD, STL** (draft_club). Plus a
  *second*, non-relocation-related short-code convention layered in: `ARZ` (vs ARI), `BLT` (vs BAL),
  `CLV` (vs CLE), `HST` (vs HOU), `SL`/`JAC` (vs STL/JAX) — these look like an alternate source's
  short codes bleeding into the same column, not franchise-relocation variants.

---

## 3. snap_counts.csv — 324,611 rows x 16 cols

**Columns (16):** `game_id, pfr_game_id, season, game_type, week, player, pfr_player_id, position,
team, opponent, offense_snaps, offense_pct, defense_snaps, defense_pct, st_snaps, st_pct`

**Join key: no `gsis_id`/`player_id` column exists in this dataset at all.** The only stable ID is
**`pfr_player_id`** (Pro-Football-Reference format), 100.00% populated, 7,095 distinct. There's also
a free-text `player` display-name column, not a stable key.
- **Practical consequence:** joining snap_counts to the other 4 (gsis_id-keyed) tables requires a
  crosswalk hop through `players.csv.pfr_id` (90.09% populated there): `snap_counts.pfr_player_id`
  → `players.pfr_id` → `players.gsis_id`. The sibling `scripts/data/nfl-db/build_db.py` (untracked,
  being developed separately — see note at the end) currently does `pick(r, "gsis_id", "player_id")`
  for snap_count rows; neither column exists in this file, so under that code `snap_count.gsis_id`
  loads as NULL for every row unless the two-hop crosswalk is added.
- `game_id` (as opposed to `pfr_game_id`) is in the **same format/value-space as `player_stats.game_id`**
  (verified: 100% of a 2015-season sample of `player_stats.game_id` values, e.g. `2015_01_BAL_DEN`,
  were found verbatim in `snap_counts.game_id`) — a safe, confirmed join key between those two tables
  specifically. `pfr_game_id` is a separate PFR-format id (e.g. `201509130den`).

**Season column:** `season`, integer, 0% NA, **2013–2025** (13 seasons — snap counts genuinely start
in 2013, as flagged in the task).

**Week column:** `week`, integer, 0% NA, 1–22.

**game_type:** `CON, DIV, REG, SB, WC` (same 5-value vocabulary as rosters.game_type).

**Team columns:** `team` and `opponent` — identical 35-value set for both:
`ARI, ATL, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, GB, HOU, IND, JAX, KC, LA, LAC, LV, MIA, MIN,
NE, NO, NYG, NYJ, OAK, PHI, PIT, SD, SEA, SF, STL, TB, TEN, WAS`. Historical codes present: **OAK,
SD, STL**. Standard nflverse codes only — no ARZ/BLT/CLV-style oddities like rosters.csv has.

---

## 4. player_stats.csv — 287,184 rows x 145 cols

**Columns (145):** `player_id, player_name, player_display_name, position, position_group,
headshot_url, season, week, season_type, game_id, team, opponent_team, completions, attempts,
passing_yards, passing_tds, passing_interceptions, sacks_suffered, sack_yards_lost, sack_fumbles,
sack_fumbles_lost, passing_air_yards, passing_yards_after_catch, passing_first_downs, passing_epa,
passing_cpoe, passing_2pt_conversions, pacr, passing_10, passing_16, passing_20, passing_40, carries,
rushing_yards, rushing_tds, rushing_fumbles, rushing_fumbles_lost, rushing_first_downs, rushing_epa,
rushing_2pt_conversions, rushing_10, rushing_12, rushing_20, rushing_40, receptions, targets,
receiving_yards, receiving_tds, receiving_fumbles, receiving_fumbles_lost, receiving_air_yards,
receiving_yards_after_catch, receiving_first_downs, receiving_epa, receiving_2pt_conversions,
receiving_10, receiving_16, receiving_20, receiving_40, racr, target_share, air_yards_share, wopr,
special_teams_tds, def_tackles_solo, def_tackles_with_assist, def_tackle_assists,
def_tackles_for_loss, def_tackles_for_loss_yards, def_fumbles_forced, def_sacks, def_sack_yards,
def_qb_hits, def_interceptions, def_interception_yards, def_pass_defended, def_tds, def_fumbles,
def_safeties, misc_yards, fumble_recovery_own, fumble_recovery_yards_own, fumble_recovery_opp,
fumble_recovery_yards_opp, fumble_recovery_tds, penalties, penalty_yards, fumbles_forced_by_opp,
fumbles_not_forced, fumbles_out_of_bounds, fumbles_total, fumbles_lost_total, punt_returns,
punt_return_yards, kickoff_returns, kickoff_return_yards, fg_made, fg_att, fg_missed, fg_blocked,
fg_long, fg_pct, fg_made_0_19, fg_made_20_29, fg_made_30_39, fg_made_40_49, fg_made_50_59,
fg_made_60_, fg_missed_0_19, fg_missed_20_29, fg_missed_30_39, fg_missed_40_49, fg_missed_50_59,
fg_missed_60_, fg_made_list, fg_missed_list, fg_blocked_list, fg_made_distance, fg_missed_distance,
fg_blocked_distance, pat_made, pat_att, pat_missed, pat_blocked, pat_pct, gwfg_made, gwfg_att,
gwfg_missed, gwfg_blocked, gwfg_distance, pt_att, pt_blocked, pt_long, pt_yards, pt_inside_20,
pt_out_of_bounds, pt_downed, pt_touchback, pt_fair_caught, pt_returned, pt_return_yards,
pt_return_tds, pt_net_yards, fantasy_points, fantasy_points_ppr`

**Join key: `player_id`** (note the different name from every other dataset's `gsis_id`, but same
GSIS-format ID space — `build_db.py` already handles this via `pick(r, "player_id", "gsis_id")`).
99.88% populated (286,843 / 287,184 — **341 rows have no player_id**, a real small gap), 7,749
distinct players.

**Season columns:** `season` (0% NA, 2010–2025, 16 seasons) and `season_type` (0% NA, only 2 values:
`POST, REG`). **Naming/granularity mismatch vs rosters/snap_counts/depth_charts' `game_type`:**
those carry `CON, DIV, REG, SB, WC` (playoff round is directly recoverable); player_stats collapses
all playoff rounds into a single `POST` — the round is not recoverable from this file alone.

**Week column: `week`, 0% NA, values 1–22 — confirmed genuinely ambiguous across the 2021
realignment**, exactly the hazard `schema.sql`'s header comment warns about for the `game` table.
Verified directly:
- 2015 (17-week regular season era): `POST` rows have `week` 18–21.
- 2021 (18-week regular season era): `POST` rows have `week` 19–22.

So `week == 18` means **Wild Card round** in a 2015 row but **the last week of the regular season**
in a 2021 row. Any downstream use of this file's `week` column for playoff games must combine it with
`season_type` *and* `season` (to know which era's numbering applies) — never use raw `week` alone.

**Team columns:** `team`, `opponent_team` — 32 distinct each:
`ARI, ATL, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, GB, HOU, IND, JAX, KC, LA, LAC, LV, MIA, MIN,
NE, NO, NYG, NYJ, PHI, PIT, SEA, SF, TB, TEN, WAS`. **Zero occurrences of OAK, SD, or STL across all
16 seasons — this is the one dataset of the 5 that normalizes historical teams to their CURRENT
abbreviation** (e.g. a 2011 Raiders row says `LV`, not `OAK`). This is the opposite behavior from
rosters/snap_counts/depth_charts(club_code), which all preserve era-correct historical labels — see
the franchise-mapping table below.

**Other collision notes verified for this file:**
- `position_group` vocabulary confirmed **identical** to players.csv: `DB, DL, LB, OL, QB, RB, SPEC,
  TE, WR`. Safe to treat as the same taxonomy.
- `game_id` confirmed same format/value-space as `snap_counts.game_id` (see above).
- `headshot_url` here is the same concept as players.csv's `headshot` column, just a different name
  (not caught by exact-name collision matching, worth knowing for anyone writing generic mapping code).

---

## 5. depth_charts.csv — 1,106,729 rows x 26 cols

**This is two structurally different schemas unioned together** — see the dedicated investigation
section below for the full finding. Short version: seasons 2010–2024 come from one source format
(15 columns, includes `season`), and the "2025" fetch comes from a completely different source format
(12 columns, no `season`/`week`/`game_type` at all). Combined, the file has 26 columns because only
`gsis_id` is shared by name between the two; every row is NA in the ~11–15 columns that belong to
whichever schema it *isn't*.

**Columns (26):** `season, club_code, week, game_type, depth_team, last_name, first_name,
football_name, formation, gsis_id, jersey_number, position, elias_id, depth_position, full_name, dt,
team, player_name, espn_id, pos_grp_id, pos_grp, pos_id, pos_name, pos_abb, pos_slot, pos_rank`

**Join key: `gsis_id`** — 99.50% populated (1,101,152 / 1,106,729), 8,695 distinct players. Also
`espn_id`, but only populated for the 2025/schema-B half (50.08% overall, 3,189 distinct).

**CSV-quoting gotcha (verified, not cosmetic):** the `depth_position` column contains **8,176 values
with an embedded newline/carriage-return character** (confirmed via `grepl("[\\r\\n]", x)` against the
loaded data). `write.csv` correctly RFC4180-quotes those fields, so the file is valid CSV — but a
naive line-counter (`wc -l`) reports **1,114,905** data lines, which is *not* the row count. The true
row count, independently re-verified by parsing the written file with `data.table::fread` (a real
quoted-CSV parser), is **exactly 1,106,729**, matching the validated in-memory count. **Use a real CSV
parser on this file — never split on raw newlines.**

**Season column:** `season` — 50.08% NA overall. See investigation below for why; short answer: NA
for every 2025/schema-B row, 0% NA for schema-A rows (2010–2024).

**Week column:** `week` — 50.38% NA, same schema-A-only pattern, values 1–22 when present.

**Team columns:** `club_code` (schema A, 35 distinct, includes historical **OAK, SD, STL**:
`ARI, ATL, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, GB, HOU, IND, JAX, KC, LA, LAC, LV, MIA, MIN,
NE, NO, NYG, NYJ, OAK, PHI, PIT, SD, SEA, SF, STL, TB, TEN, WAS`) and `team` (schema B / 2025 only,
32 distinct, current-era only: `ARI, ATL, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, GB, HOU, IND,
JAX, KC, LA, LAC, LV, MIA, MIN, NE, NO, NYG, NYJ, PHI, PIT, SEA, SF, TB, TEN, WAS`).

### The season-column investigation (task's flagged question)

`names(df)`:
```
[1] "season"  "club_code"  "week"  "game_type"  "depth_team"  "last_name"  "first_name"
[8] "football_name"  "formation"  "gsis_id"  "jersey_number"  "position"  "elias_id"
[14] "depth_position"  "full_name"  "dt"  "team"  "player_name"  "espn_id"  "pos_grp_id"
[21] "pos_grp"  "pos_id"  "pos_name"  "pos_abb"  "pos_slot"  "pos_rank"
```

`str(df)` (combined 2010–2025 object) shows exactly two disjoint sets of populated columns depending
on the row, confirmed by row split:

```
has_season
 FALSE   TRUE
554215 552514
```

**Root cause: nflverse changed the depth_charts release format starting with the 2025 season file.**
This is not an extraction bug and not something to paper over with a synthesized column. The two
schemas:

- **Schema A — seasons 2010–2024, 552,514 rows, 15 columns:** `season, club_code, week, game_type,
  depth_team, last_name, first_name, football_name, formation, gsis_id, jersey_number, position,
  elias_id, depth_position, full_name`. Traditional team-submitted weekly depth chart: `season` +
  `week` + `game_type` + `club_code` identify the (team, week) context, `depth_team` is the depth
  rank ("1"/"2"/"3"), `position`/`depth_position` are simple 2–3 letter codes (e.g. WR, K, OLB, CB).
  Confirmed populated season values: `2010 2011 2012 2013 2014 2015 2016 2017 2018 2019 2020 2021
  2022 2023 2024` (exactly 15, matching the requested 2010–2025 range minus 2025).

- **Schema B — the "2025" fetch, 554,215 rows, 12 columns:** `dt, team, player_name, espn_id,
  gsis_id, pos_grp_id, pos_grp, pos_id, pos_name, pos_abb, pos_slot, pos_rank`. `gsis_id` is the
  *only* column shared by name with schema A. This looks like an ESPN-sourced near-daily
  depth-chart snapshot feed, not a weekly one: `dt` is an ISO-8601 timestamp (`"2026-03-14T07:32:09Z"`
  style) with **221 distinct snapshot times**, ranging from **2025-08-03T10:09:07Z to
  2026-03-14T07:32:09Z** (training camp through the end of the 2025 postseason). **There is no
  season, week, or game_type column anywhere in this schema.** Position is encoded completely
  differently: `pos_grp` is one of 4 personnel/formation groupings (`"Base 4-3 D"`, `"Base 3-4 D"`,
  `"3WR 1TE"`, `"Special Teams"`), and `pos_id`/`pos_name`/`pos_abb`/`pos_slot`/`pos_rank` form a
  slot-based scheme (e.g. `pos_abb` "LDE"/"RDT"/"WLB" for "Left Defensive End" etc.) — **not the same
  vocabulary as schema A's `position`/`depth_position`.**

**Per the task instruction, no season value was guessed or synthesized for the schema-B rows** — the
column is left exactly as nflreadr returns it (NA). What can be said factually: every schema-B row's
`dt` falls in the Aug-2025–Mar-2026 window, consistent with "the 2025 NFL season", and the row's
membership in "season 2025" is knowable only from *which fetch produced it* (i.e. it was requested as
`load_depth_charts(2025)`), never from a value in the row itself.

**Downstream consequence found (informational, not something I changed):** the sibling
`scripts/data/nfl-db/build_db.py` (currently untracked in git, being developed separately from this
task) loads depth_charts with `for r in dc if as_int(pick(r, "season"))` — i.e. it already defends
against a missing/unparseable season by dropping the row. Under that logic as currently written, it
will silently drop **all 554,215 schema-B rows** (the entire 2025 season's depth-chart data) rather
than erroring, since none of them have a populated `season` value under any of the picked column
names. Flagging this because it's a direct, concrete consequence of the exact schema gap this task
asked me to investigate.

Columns entirely NA when `season` is populated (i.e., schema-B-only): `dt, team, player_name,
espn_id, pos_grp_id, pos_grp, pos_id, pos_name, pos_abb, pos_slot, pos_rank`.
Columns entirely NA when `season` is NA (i.e., schema-A-only): `season, club_code, week, game_type,
depth_team, last_name, first_name, football_name, formation, jersey_number, position, elias_id,
depth_position, full_name`.

---

## Team abbreviations by dataset — franchise-mapping reference

| dataset.column | distinct | historical relocation codes? | notes |
|---|---:|---|---|
| players.latest_team | 33 | no (current-only) | has both "ARI" and "AZ" for the same franchise |
| players.draft_team | 32 | no (current-only) | 51.16% NA (undrafted players) |
| rosters.team | 39 | **yes: OAK, SD** | plus non-standard ARZ/BLT/CLV/HST/SL alongside standard codes |
| rosters.draft_club | 42 | **yes: OAK, SD, STL** | also adds JAC (w/ JAX) and LAR (w/ LA) — messiest column of the 5 datasets |
| snap_counts.team / .opponent | 35 (identical sets) | **yes: OAK, SD, STL** | clean, standard nflverse codes only |
| player_stats.team / .opponent_team | 32 each | **no** — normalized to current-era | confirmed zero OAK/SD/STL across all 16 seasons |
| depth_charts.club_code (schema A, 2010-2024) | 35 | **yes: OAK, SD, STL** | |
| depth_charts.team (schema B, 2025 only) | 32 | no (current-only) | expected — single current season |

**Bottom line: `player_stats.csv` is the one dataset that will never show era-correct historical
abbreviations** — a season-aware alias table (like `team_alias`/`is_current` in `schema.sql`) is
necessary for rosters, snap_counts, and depth_charts' `club_code`, but must resolve straight to the
current abbreviation for player_stats — applying season-aware logic there would incorrectly expect
"OAK"/"SD"/"STL" that never appear. `rosters.csv` additionally carries a second, unrelated short-code
convention (ARZ/BLT/CLV/HST/SL/JAC) mixed into the same columns as the standard/relocation codes —
this is not a relocation artifact and needs its own mapping.

---

## Cross-dataset column-name collisions

Exact column-name matches across the 5 files, with the R class in each:

| column | present in | same meaning? |
|---|---|---|
| `gsis_id` | players, rosters, depth_charts | yes — the core join key |
| `first_name`, `last_name`, `football_name` | players, rosters, depth_charts | yes |
| `esb_id`, `pfr_id`, `pff_id`, `smart_id` | players, rosters | yes |
| `espn_id` | players, rosters, depth_charts | yes (same ESPN athlete-id space) |
| `birth_date` | players (character), rosters (Date) | same meaning, different R type (both serialize as `YYYY-MM-DD` text in the CSV) |
| `position_group` | players, player_stats | **yes — confirmed identical vocabulary**: `DB, DL, LB, OL, QB, RB, SPEC, TE, WR` |
| `position` | players, rosters, snap_counts, player_stats, depth_charts | same general concept everywhere, but **not the same controlled vocabulary/granularity** — depth_charts schema-B has no `position` value at all (uses `pos_abb`/`pos_name` instead, a different, slot-based taxonomy) |
| `ngs_position` | players, rosters | yes |
| `height` | players (integer), rosters (numeric) | same meaning, different R type |
| `weight` | players (integer), rosters (integer) | yes |
| `jersey_number` | players, rosters, depth_charts | yes (all stored as character) |
| `status` | players, rosters | **same general concept, NOT the same controlled vocabulary** — players.status has 14 codes (`ACT, CUT, DEV, EXE, INA, NWT, PUP, RES, RET, RLS, RSN, RSR, SUS, UDF`), rosters.status (2023 sample) has 11 (`ACT, CUT, DEV, EXE, INA, PUP, RES, RET, TRC, TRD, TRT`) — overlapping core but each has codes the other lacks |
| `season` | rosters, snap_counts, player_stats, depth_charts | yes when populated; depth_charts is NA for its schema-B/2025 half (see investigation) |
| `week` | rosters, snap_counts, player_stats, depth_charts | **same column name, but not safely comparable across the 2021 realignment for playoff rows** — see player_stats section; raw week number needs season_type + season to disambiguate |
| `team` | rosters, snap_counts, player_stats, depth_charts | same general concept, **different abbreviation conventions per dataset** — see franchise-mapping table above |
| `full_name` | rosters, depth_charts | yes |
| `game_id` | snap_counts, player_stats | **confirmed same format/value-space** (100% sample overlap, e.g. `2015_01_BAL_DEN`) — safe join key between these two specifically |
| `player_name` | player_stats, depth_charts | player_stats' is a real column throughout; depth_charts' `player_name` only exists for schema-B (2025) rows |

**Near-miss naming inconsistencies** (different names, same concept — not caught by exact-name
matching, worth knowing for generic column-mapping code):
- `headshot` (players.csv) vs `headshot_url` (rosters.csv, player_stats.csv) — same concept.
- `game_type` (rosters, snap_counts, depth_charts-schema-A: 5 values `CON/DIV/REG/SB/WC`) vs
  `season_type` (player_stats: only 2 values `POST/REG`) — same concept, different name **and**
  different granularity (player_stats loses the playoff round).
- `player_id` (player_stats) vs `gsis_id` (players, rosters, depth_charts) — same GSIS-format ID
  space, different column name only in player_stats.
- `pfr_player_id` (snap_counts) vs `pfr_id` (players, rosters) — same PFR-format ID space, different
  column name in snap_counts.

---

## Gaps

**None.** All 5 datasets met the 90%-of-expected row-count floor on the first attempt; the
retry-and-record-a-gap path was never exercised.

## Reproducibility

Load calls used (in this order), each validated on row count before writing, each written with
`write.csv(as.data.frame(x), file, row.names = FALSE, na = "")`:

```r
players      <- nflreadr::load_players()
rosters      <- nflreadr::load_rosters(2010:2025)
snap_counts  <- nflreadr::load_snap_counts(2013:2025)
player_stats <- nflreadr::load_player_stats(2010:2025, summary_level = "week")
depth_charts <- nflreadr::load_depth_charts(2010:2025)
```

R 4.6.1 (aarch64-apple-darwin25.4.0) / nflreadr 1.5.1. The extraction script itself was run from a
scratch location outside the repo (per the task's "don't modify anything outside raw/" constraint)
and is not checked in; the calls above plus the `write.csv` invocation fully reproduce it. Total wall
time was 1.44 minutes for all 5 datasets combined — nflverse serves these as pre-built per-season
release assets, so no scraping or rate-limiting was involved.

**Note on `scripts/data/nfl-db/schema.sql` and `build_db.py`:** both were observed as untracked
(`git status`) during this extraction, evidently under active development in a separate work stream
that already anticipates these exact 5 filenames and the `gsis_id`/`player_id` and `team`/`club_code`
naming splits described above. This extraction did not modify either file.
