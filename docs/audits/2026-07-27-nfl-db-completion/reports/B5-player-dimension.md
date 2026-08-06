# B5 — Player dimension: referential completeness and identity integrity

## Verdict

**PASS WITH EXCEPTIONS** — `lib/player_dimension.py` builds a 26,517-row dimension in which
**every one of the 11,593 `gsis_id` values referenced anywhere in `nfl.db` resolves to a row (0
orphans, down from 1,482)**, and in which `pfr_id` and `espn_id` are unique where present; the
exceptions are 207 pre-existing rows whose crosswalk keys no available source publishes, 10
same-human/two-`gsis_id` splits that cannot be collapsed without rewriting fact tables, and 4
recorded ESPN↔nflverse contradictions.

`nfl.db` is **not modified** — B5 does not own it. The deliverable is the importable module the
coordinator integrates.

---

## What I checked

Full population, no sampling.

| Question | Scope |
|---|---|
| Orphans | All 4 fact tables (`player_game_stats` 286,843 · `snap_count` 324,611 · `roster_season` 43,856 · `depth_chart` 552,514) **and** `game.away_qb_id` / `game.home_qb_id`, 4,648 games |
| Orphans, upstream | Same question against the raw CSVs, so a defect the loader hid would still surface: `players.csv` (25,035), `rosters.csv` (43,856), `player_stats.csv` (287,184), `depth_charts.csv` (1,106,729) |
| Uniqueness | `gsis_id`, `pfr_id`, `espn_id`, `esb_id` over all 25,035 live rows and all 26,517 built rows, case- and whitespace-insensitive |
| Same human, two ids | Cross-product of the 1,482 orphans × 25,035 player rows on `esb_id`, `smart_id`, `gsis_it_id`↔`nfl_id`, `pfr_id`, `espn_id`, and a scored fuzzy pass on normalised name + college + height + weight + rookie year. Plus a within-`player` pass on name+birth_date and name+college |
| Coverage | Every season 2010–2026, every fact table |
| External verification | ESPN core/site API — 9 athlete records, 4 college records, 24 name searches, 1 team roster. All cached under `scripts/data/nfl-db/cache/b5/` |
| Third-party crosswalk | DynastyProcess `db_playerids.csv` (12,468 rows, 7,733 with a `gsis_id`) |

`player` proved to be a verbatim 1:1 image of `raw/players.csv` — 25,035 rows in, 25,035 rows out,
same id set (`build_db.py:122-142`). The live nflverse `players` release was re-downloaded during
this audit and contains **exactly the same 25,035 `gsis_id` values** as the local extract, so the
extract is current and re-pulling it resolves nothing.

---

## Results

### 1. Referential completeness

Orphan = a non-NULL `gsis_id` in a fact table with no matching row in `player`. Distinct from a
NULL id (B1's defect class).

| Source | Rows | Distinct ids | Orphan rows (before) | Orphan ids (before) | Orphan rows (after) |
|---|---:|---:|---:|---:|---:|
| `player_game_stats` | 286,843 | 7,749 | 0 | 0 | 0 |
| `snap_count` (non-NULL gsis) | 324,384 | 7,065 | 0 | 0 | 0 |
| `roster_season` (non-NULL gsis) | 43,838 | 11,591 | **1,590** | **1,482** | **0** |
| `depth_chart` | 552,514 | 7,890 | **1** | **1** | **0** |
| `game.away_qb_id` | 4,363 | 221 | 0 | 0 | 0 |
| `game.home_qb_id` | 4,363 | 216 | 0 | 0 | 0 |
| **Total** | | **11,593 distinct** | **1,591** | **1,482** | **0** |

**Who the 1,482 are, and why they were missing.** All 1,482 come from `raw/rosters.csv` and none
from `raw/players.csv`. They are offseason and practice-squad roster churn: **1,324 carry status
`CUT`**, 83 `ACT`, 32 `DEV`, 17 `RES`, 8 `RET`, 5 `INA`, 4 `NWT`, 9 blank. The nflverse *players*
release is a career-summary product and does not emit a row for a player who never reached an
active regular-season roster; the *rosters* release is a week-level panel and does. The cause is
structural, one release scoped differently from the other — not corruption.

The discontinuity is visible in the source: `rosters.csv` carries ~2,150 rows/season for 2010–2015
and ~3,100 rows/season from 2016 on. Orphans track that exactly — 0 before 2014, 167–236/season
from 2016.

The single `depth_chart` orphan is `00-0029389` (Phil Bates), which is also a duplicate-identity
case — see §2.

**Resolution.** `build_player_dimension()` adds all 1,482 from `rosters.csv`. No row is invented;
every field is a value the feed publishes. Fill rates on the added rows:

| field | filled | | field | filled |
|---|---:|---|---|---:|
| `display_name` | 1,482 (100.0%) | | `esb_id` | 1,394 (94.1%) |
| `last_season` | 1,482 (100.0%) | | `height` | 1,333 (89.9%) |
| `position` | 1,474 (99.5%) | | `rookie_year` | 1,317 (88.9%) |
| `weight` | 1,472 (99.3%) | | `college` | 1,188 (80.2%) |
| `status` | 1,473 (99.4%) | | `headshot_url` | 926 (62.5%) |
| `birth_date` | 226 (15.2%) | | `espn_id` | 35 (2.4%) |
| `draft_team` | 5 (0.3%) | | `pfr_id` | 1 (0.1%) |

`draft_year`, `draft_round` and `position_group` are deliberately left NULL on these rows.
`rosters.csv` publishes none of them. `build_db.py`'s alias chain would silently fall through to
`entry_year` for `draft_year` — for 1,324 `CUT` players that would write a draft that never
happened. `_row_from_roster_rows()` blocks that alias.

### 2. Uniqueness and identity integrity

**`gsis_id` is genuinely unique.** 25,035 rows / 25,035 distinct values / 0 NULL or empty / 25,035
distinct under `LOWER(TRIM())`. It is the table's PRIMARY KEY, so SQLite enforces it.

One caveat a consumer must know: **6,098 of the 25,035 do not match `^00-\d{7}$`.** nflverse
back-fills `gsis_id` with `esb_id` for players who never received a GSIS id (mostly pre-2000 —
`ABB498348` Vince Abbott, `ADA083058` Mike Adamle, …). That is a format quirk, not a duplicate. One
`snap_count` row keys on such an id (`BAT138483`). A loader that regex-validates `gsis_id` will
reject a quarter of the dimension.

**`pfr_id` and `espn_id` are unique where present — 0 duplicates each.**

| key | present | distinct | duplicates |
|---|---:|---:|---:|
| `pfr_id` (live) | 22,554 / 25,035 (90.09%) | 22,554 | **0** |
| `espn_id` (live) | 16,768 / 25,035 (66.98%) | 16,768 | **0** |
| `esb_id` (live) | 25,035 / 25,035 | 25,034 | **1** |
| `pfr_id` (built, 26,517 rows) | 22,558 | 22,558 | **0** |
| `espn_id` (built, 26,517 rows) | 16,807 | 16,807 | **0** |

The snap crosswalk and the depth-chart recovery are therefore **safe on `pfr_id` and `espn_id`**.
Adding the 1,482 rows introduces 1 new `pfr_id` and 35 new `espn_id` values; none collides with an
existing value and none is duplicated among themselves.

**Keys that are NOT safe, enumerated.** Every collision found is in `DUPLICATE_KEYS`:

| key | value | ids | verdict |
|---|---|---|---|
| `esb_id` | `PRY456541` | `00-0040792`, `PRY456541` | **Same human** (Layne Pryor). nflverse back-filled one row's `gsis_id` with the `esb_id`. |
| `esb_id` | `REE257783` | `00-0032387`, `00-0039642` | **Two humans.** The id is Jarran Reed's (it is embedded in his `smart_id` `32005245-4525-**7783**-…`). `rosters.csv` stamps it on X'Zauvea Gadlin's lone 2024 TEN row. **An esb-keyed crosswalk misattributes Gadlin to Jarran Reed.** |
| `smart_id` | `3200474f-5204-5716-a75e-4ec8e313a651` | `00-0035988`, `00-0036200`, `00-0035915` | **Three humans.** The uuid encodes esb `GOR045716` = Anthony Gordon. `rosters.csv` also stamps it on Dustin Woodard and Jake Benzinger. |
| `smart_id` | `32004a41-4e43-9601-3bc3-9d2a327c58fc` | `JAN439601`, `00-0039604` | **Two humans — twin brothers.** The uuid encodes esb `JAN439601` = Jaxon Janke; his twin Jadon Janke's roster row carries it. Same name, same school, same year: only `esb_id` separates them. |
| `gsis_it_id` ↔ `nfl_id` | 16 values | 2018 entry class | **Unreliable.** Agrees for 7,886 players, disagrees for 16 in a way that points at a *different real player* — Saquon Barkley's roster row carries `46208` = R.J. McIntosh; Baker Mayfield's carries `46073` = Denzel Ward. Do not use as an identity key. |
| `birth_date` + name | `1992-06-25` / Kevin White | `00-0031545`, `00-0031683` | **Two humans** (WVU WR, TCU CB — different `esb_id`, college, position). nflverse records the same birth date for both; ESPN knows only one NFL Kevin White. **name+birth_date is not a sufficient identity test in this dataset.** |

**The same human as two `gsis_id`s — 10 pairs.** Nine are orphan↔player splits; the tenth
(Layne Pryor) is inside `players.csv`.

| canonical | alias | player | evidence |
|---|---|---|---|
| `BAT138483` | `00-0029389` | Phil Bates, WR | 73in/220lb, rookie 2012 on both sides. ESPN athlete 15554: Phil Bates, WR, 73/220, dob 1989-09-20, debut 2012, college 195 = Ohio. **Decisive:** `snap_count` has one row keyed `BAT138483` for `pfr_game_id 2014_08_SEA_CAR`, and `roster_season` has the matching 2014 wk8 SEA row keyed `00-0029389` — same player, same week, same team, two ids. nflverse gives them *different* `esb_id`s (`BAT138483` vs `BAT137358`), which is why no key join finds this pair. |
| `HAR805951` | `00-0035012` | Nate Harvey, DE | shared `esb_id` **and** `smart_id`; 73/225, East Carolina, rookie 2019 |
| `FAL374501` | `00-0035712` | Lo Falemaka, C | shared `esb_id` **and** `smart_id`; Utah, rookie 2019 |
| `JOH382488` | `00-0036141` | Johnathon Johnson, WR | shared `esb_id` **and** `smart_id`; 70/180, Missouri, rookie 2020 |
| `LOV131275` | `00-0035937` | Josh Love, QB | shared `esb_id`; 74/205, San Jose State |
| `KEL755800` | `00-0036581` | Xavier Kelly, DT | shared `esb_id`; 77/311, Arkansas, rookie 2021 |
| `VIT313230` | `00-0037036` | Mark Vital, TE | shared `esb_id`; 77/250, Baylor |
| `JAN439601` | `00-0039605` | Jaxon Janke, WR | shared `esb_id` **and** `smart_id`; 75/210, South Dakota State, rookie 2024 |
| `MAT090108` | `00-0038325` | Alex Matheson, LS | one "Matheson" in each feed, both LS / California Lutheran / LA / 2023. ESPN 3163372 = Alexander Matheson, LS, dob 1995-03-30, team 14 (LA) |
| `PRY456541` | `00-0040792` | Layne Pryor, TE | both inside `players.csv`, sharing `esb_id`, `smart_id`, birth_date 2002-12-09 and Northern Iowa |

**Resolution:** both ids stay in the dimension — the fact tables reference both sides and this
module does not rewrite fact tables. The `canonical` row keeps sole ownership of `pfr_id`/`espn_id`;
`_row_from_roster_rows()` strips those keys from the 10 alias ids, which is what keeps both key
columns at 0 duplicates. `CANONICAL_GSIS` exports the alias→canonical map so downstream
aggregation can collapse them.

**False positives rejected** (looked like duplicates, are not): 79 orphans share an exact
`display_name` with an existing player. All but Phil Bates and Alex Matheson differ in college,
birth date and `esb_id` — Najee Harris LB/Wagner vs Najee Harris RB/Alabama, Elijah Mitchell
DB/Nevada vs Elijah Mitchell RB/Louisiana-Lafayette, and so on. Three more (Nyles Morgan, Juante
Baldwin, Bo Bower) match an existing player *only* through the corrupted `gsis_it_id` column and
are also not duplicates.

**Key coverage before → after.**

| population | metric | before | after |
|---|---|---:|---:|
| all rows | rows | 25,035 | 26,517 |
| all rows | `pfr_id` present | 22,554 (90.09%) | 22,558 (85.07%) |
| all rows | `espn_id` present | 16,768 (66.98%) | 16,807 (63.38%) |
| referenced by facts (11,593 ids) | has a dimension row at all | 10,111 (87.22%) | **11,593 (100%)** |
| referenced by facts | `pfr_id` present | 9,918 | 9,922 |
| referenced by facts | `espn_id` present | 10,090 | 10,129 |
| referenced **and already present** (10,111) | `pfr_id` present | 9,918 (98.09%) | 9,921 (98.12%) |
| referenced **and already present** (10,111) | `espn_id` present | 10,090 (99.79%) | 10,094 (99.83%) |

The whole-table rates *fall* because the denominator grows by 1,482 rows the feed publishes almost
no crosswalk keys for. That is a scope change, not a regression — the actionable gap is the
right-hand block: among players the fact tables actually reference and that already had a row,
**193 lacked `pfr_id` and 21 lacked `espn_id` before; 190 and 17 after.**

**Backfill attempted and what it yielded.** Four sources were tried:

| source | `pfr_id` filled | `espn_id` filled |
|---|---:|---:|
| `raw/rosters.csv` (both keys, per season) | 0 | 2 (already present via the added rows) |
| `raw/depth_charts.csv` `espn_id` column (2,985 gsis) | — | 0 |
| `snap_count`'s own `gsis_id`↔`pfr_player_id` pairs (7,065, zero conflicts) | 0 | — |
| DynastyProcess `db_playerids.csv` | 3 | 2 |
| ESPN name search + athlete verification (24 searches) | — | 2 |

All 7 fills are in `MANUAL_ADDITIONS` with an inline citation. `rosters.csv` cannot help because
its own `pfr_id` coverage is 43% and it is empty for exactly the players `players.csv` is empty
for. Nothing was written that could not be sourced.

DynastyProcess's `espn_id` column was found to be **unreliable** and was not trusted unverified: it
disagrees with nflverse on 4 players where both are populated (Deonte Banks `4428328` vs `42873`;
Houston Bates `2511350` vs `2516049`; LeGarrette Blount `3166800` vs `13213`; Daniel Brown
`2544798` vs `2519013`). Only its two *fills* were used, and both were confirmed against the ESPN
athlete endpoint before acceptance.

### 3. Coverage against the seasons in scope

Every distinct `gsis_id` active in any 2010–2026 stat line, snap count, roster row or depth chart,
against the dimension:

| season | active ids | missing before | missing after |
|---:|---:|---:|---:|
| 2010 | 2,036 | 0 | 0 |
| 2011 | 2,022 | 0 | 0 |
| 2012 | 2,031 | 0 | 0 |
| 2013 | 2,032 | 0 | 0 |
| 2014 | 2,055 | 1 | 0 |
| 2015 | 2,065 | 0 | 0 |
| 2016 | 3,061 | 167 | 0 |
| 2017 | 3,082 | 213 | 0 |
| 2018 | 3,141 | 236 | 0 |
| 2019 | 3,112 | 190 | 0 |
| 2020 | 3,068 | 54 | 0 |
| 2021 | 2,960 | 57 | 0 |
| 2022 | 3,133 | 159 | 0 |
| 2023 | 3,089 | 161 | 0 |
| 2024 | 3,216 | 201 | 0 |
| 2025 | 3,133 | 150 | 0 |
| **union** | **11,593** | **1,482** | **0** |

2026 has **zero** player-level rows in every fact table (`player_game_stats`, `roster_season` and
`snap_count` end at 2025; `depth_chart` at 2024), and the 2026 `game` rows carry no QB ids either —
**structurally not applicable**, not a gap. Across all seasons `game` holds 8,726 non-NULL QB
references over 437 distinct players, and every one resolves.

**Upstream check.** `raw/player_stats.csv` has 7,749 distinct `player_id`, **0** absent from
`players.csv`. `raw/depth_charts.csv` has 8,695 distinct `gsis_id`, **1** absent (Phil Bates,
already covered). `raw/snap_counts.csv` carries no `gsis_id` column at all — it keys on
`pfr_player_id`, which is why `snap_count.gsis_id` is nullable. So the loader hid no orphan: the
1,482 are the complete population.

`player` holds **14,924 rows never referenced by any 2010–2026 fact row** — pre-2010 career rows
carried by the players release. Expected, not a defect.

### 4. Coordination with B1 (the 227 NULL `snap_count.gsis_id` rows)

`scripts/data/nfl-db/lib/snap_crosswalk.py` **did not exist** when this analysis was run (`lib/`
held only `rowloss.py`), so the question was resolved independently. B1's module landed before this
report was filed and was then cross-checked against the built dimension — see the verification at
the end of this section. Recording the dependency and the answer:

Those 227 rows are exactly the rows whose `pfr_player_id` has no match in `player.pfr_id` — **30
distinct pfr ids**, and every one of their snap rows is NULL-gsis (39+31+30+…+1 = 227). Resolving
them against `players.csv`/`rosters.csv` by name, team and season:

- **29 of 30 resolve to a `gsis_id` that is already in `player`.** Six needed a name variant:
  `BrowJo03`→`00-0032835` (Jon Brown), `CartNa00`→`00-0040547` (Nate Carter),
  `CudjYa00`→`00-0032033` (Yannik Cudjoe-Virgil), `McCrRo00`→`00-0034326` (Robert McCray),
  `TaylAl02`→`00-0036120` (Armani Taylor-Prioleau, formerly Alex Taylor),
  `WillRo08`→`00-0037451` (Rod Williams). `OkoyCJ00` ("CJ Okoye") is `00-0039176` Basil Okoye.
- **1 does not resolve at all:** `CoopBu00`, "Bump Cooper", CB, BAL, 2024 week 8 vs CLE, 6 special-teams
  snaps. No player of that name exists anywhere in `players.csv` or `rosters.csv`, and ESPN's
  player search returns nothing.
- **Zero of the 30 map to any of the 1,482 orphans.**

**Answer to the question B5 was asked to anticipate: B1's work introduces no new `gsis_id`.** The
dimension in this module is sufficient for it. `MANUAL_ADDITIONS` already supplies
`pfr_id='JameRo99'` for `00-0026278`, which closes one of the 30 from the dimension side.

**Cross-check against B1's delivered module** (run after `lib/snap_crosswalk.py` appeared):

```bash
python3 - <<'PY'
import sys; sys.path.insert(0, "lib")
from player_dimension import build_player_dimension
import snap_crosswalk as sc, sqlite3
dim = {r["gsis_id"] for r in build_player_dimension()}
live = {r[0] for r in sqlite3.connect("nfl.db").execute("SELECT gsis_id FROM player")}
tgt = {v[0] if isinstance(v, tuple) else v for v in sc.build_pfr_to_gsis().values()}
tgt = {v for v in tgt if v}
print(len(tgt), "targets;", len(tgt - dim), "missing from built dim;", len(tgt - live), "missing from live player")
PY
# -> 22583 targets; 0 missing from built dim; 1 missing from live player
```

**Zero of B1's 22,583 crosswalk targets are missing from the built dimension. One is missing from
the live `player` table**: `JackKh00` → `00-0039856` (Khyree Jackson, DB, MIN 2024 — one of the
1,482). It has 0 `snap_count` rows today, so nothing breaks now, but it means **the two modules must
be integrated in order: the player dimension first, then the snap crosswalk.** Applying B1's
crosswalk against the current `player` table would write a `gsis_id` with no dimension row the
moment that pfr id appears in a future snap extract.

B1 also resolved `CoopBu00` — my E6 — to `00-0039245` (Ryan Cooper Jr.) via `depth_charts.csv`'s
name→`espn_id` mapping (`espn_id` 5085881), a route this audit did not try. That closes E6.

---

## Exceptions

### E1 — 190 referenced players have no `pfr_id` in any available source

Cause: nflverse's players release leaves `pfr_id` empty for them (9.9% of the table overall);
`rosters.csv` is empty for the same players; they have no `snap_count` row carrying a
`pfr_player_id` (0 of 190 appear in `snap_count`); DynastyProcess covers only 3. 149 are
roster-only, 12 depth-chart-only, 29 have a stat line. Evidence and the full list:
`scripts/data/nfl-db/cache/b5/nopfr_appendix.md`. Reproduce with the query in §Reproduce.
Not fabricable — a PFR id is a site-assigned slug with disambiguating suffixes; constructing one
would be a guess.

### E2 — 17 referenced players have no `espn_id`

ESPN's player search index does not carry them (20 of 24 searches returned zero NFL athletes; the
index is thin for 2010–2012 fringe players). Individually:

| gsis_id | name | pos | seasons | pfr_id | referenced by |
|---|---|---|---|---|---|
| 00-0020895 | Chris Smith | OT | 2002-2002 | SmitCh06 | snap |
| 00-0024467 | Dave Tollefson | DE | 2006-2012 | TollDa99 | play+rost+dept |
| 00-0026916 | Rhett Bomar | QB | 2009-2010 | BomaRh00 | rost+dept |
| 00-0026924 | Herman Johnson | G | 2009-2010 | JohnHe23 | rost+dept |
| 00-0027216 | Dorian Brooks | G | 2010-2010 | (none) | rost |
| 00-0027329 | Joe Joseph | DT | 2010-2010 | JoseJo21 | rost+dept |
| 00-0027482 | Josh Pinkard | CB | 2010-2010 | PinkJo00 | rost+dept |
| 00-0027512 | Ko Quaye | DT | 2010-2010 | QuayKo00 | rost |
| 00-0027617 | Shay Hodge | WR | 2010-2010 | HodgSh00 | rost+dept |
| 00-0027800 | Scotty McGee | DB | 2010-2011 | McGeSc99 | rost+dept |
| 00-0028123 | Greg K. Jones | LB | 2011-2012 | JoneGr02 | play+rost+dept |
| 00-0028743 | Adi Kunalic | K | 2011-2011 | KunaAd00 | rost+dept |
| 00-0028822 | Caleb King | RB | 2011-2011 | KingCa01 | rost+dept |
| 00-0031683 | Kevin White | CB | 2015-2015 | (none) | rost |
| 00-0036120 | Armani Taylor-Prioleau | OT | 2020-2024 | (none) | rost+dept |
| 00-0036454 | Pete Guerrerio | RB | 2020-2020 | GuerPe00 | rost |
| 00-0037451 | Rod Williams | TE | 2022-2024 | (none) | play+rost+dept |

`00-0031683` (Kevin White, CB, TCU) is a hard negative, not merely unfound: ESPN's search for
"Kevin White" returns exactly one NFL athlete and it is the WVU wide receiver.

### E3 — 1,447 of the 1,482 added rows have no `espn_id`, 1,481 no `pfr_id`

Cause: `rosters.csv` publishes `espn_id` for 2.4% and `pfr_id` for 0.1% of this pool. These players
were cut in camp; neither ESPN nor PFR ever created a page for most of them. Only 226 of 1,482 have
a birth date for the same reason. Recorded as a bounded, named absence — these ids are referenced
only by `roster_season` (and one `depth_chart` row), never by a stat line or a snap count, so no
performance data depends on them.

### E4 — 10 same-human pairs remain as two rows

Listed in full in §2 and in `DUPLICATE_KEYS["same_human_two_gsis"]`. Cannot be collapsed here: the
fact tables reference both sides and B5 does not own `nfl.db`, `build_db.py` or `schema.sql`.
Mitigated — the alias row carries no `pfr_id`/`espn_id`, and `CANONICAL_GSIS` exports the mapping.
**Coordinator decision required:** either (a) rewrite the alias ids in `roster_season`/`depth_chart`
to the canonical id and drop the alias rows, or (b) ship both and require consumers to apply
`CANONICAL_GSIS`. Option (a) is the only one that makes a per-player career query correct without
extra work.

### E5 — 4 ESPN↔nflverse contradictions, recorded not resolved

| player | field | nflverse | ESPN | note |
|---|---|---|---|---|
| Alex Matheson `MAT090108` | college | California Lutheran University | college 2364 = Minnesota State | identity not in doubt (unique name, same position/team/season) |
| Alex Matheson `MAT090108` | height/weight | 77in / 245lb (`players.csv`), 75in / 230lb (`rosters.csv`) | 77in / 245lb | nflverse disagrees with *itself* between its two releases |
| Cameron Fleming `00-0031067` | birth_date | 1992-09-03 | 1993-09-03 | same month/day, one year apart; position, height, weight, college and debut all agree exactly |
| Kevin White `00-0031683` | birth_date | 1992-06-25 | no ESPN record | identical to the *other* Kevin White's birth date; likely copied, unverifiable |

None was written into the dimension.

### E6 — `CoopBu00` "Bump Cooper" — CLOSED by B1

BAL, 2024 week 8 vs CLE, 6 ST snaps, 1 `snap_count` row (NULL `gsis_id`). This audit could not
identify him: absent from `players.csv`, absent from `rosters.csv` (the 2024 BAL roster carries no
Cooper other than the ones already mapped), and ESPN player search returns nothing. Recorded
because resolving him was the one path by which B1's work could have required a *new* dimension
row. **B1 subsequently resolved it** to `00-0039245` (Ryan Cooper Jr.) through
`depth_charts.csv`'s name→`espn_id` mapping (`espn_id` 5085881, matching `players.csv` for that
gsis) — a route this audit did not try. That id is already in the dimension, so no new row is
needed. Left in the exception list as a record of the method gap, not an open item.

### E7 — 18 `roster_season` rows carry a NULL `gsis_id` (adjacent defect, not an orphan)

Not in B5's assigned scope (B1 owns the NULL class in `snap_count`; nobody was assigned the
`roster_season` NULLs), but found while auditing and reported so it is not lost. **17 of 18 resolve
unambiguously** by name + franchise + season against `players.csv`:

| season | team | name | resolves to |
|---|---|---|---|
| 2010 | CHI | John Babinecz | `BAB726754` |
| 2010–2015 (6 rows) | NE | Dick Conn | `CON352988` |
| 2018 | NE | Darren Andrews | `00-0034584` |
| 2019 | ATL | Tavonn Salter | `SAL776196` |
| 2020 | GB | J.J. Molson | **unresolved — no match in either CSV** |
| 2021 | KC | Mark Vital | `VIT313230` |
| 2022 | JAX | Nathan Rourke | `00-0038150` |
| 2023 | DEN | Durell Nchami | `00-0039207` |
| 2024 | NO | Tra Fluellen | `00-0039959` |
| 2025 | GB | Dante Barnett | `BAR591037` |
| 2025 | IND | Wyett Ekeler | `EKE233145` |
| 2025 | HOU | Layne Pryor | `PRY456541` (rookie/last 2025, latest_team HOU — the *canonical* side of the duplicate pair) |
| 2025 | NYJ | Paschal Ekeji | `EKE080143` |

These were **not** written — B5 does not own `nfl.db` or the loader. Handing them to the coordinator.

### E8 — `raw/depth_charts.csv` loses half its rows to CSV quoting

1,106,729 raw rows, of which 554,215 have an unparseable `season` (embedded newlines in the
`depth_position` field — visible in the one orphan row, whose `depth_position` renders as
`"WR\n    "`); `depth_chart` holds 552,514, exactly the well-formed remainder. Flagged only:
`lib/rowloss.py` exists, so another agent owns row-loss accounting. It does **not** affect this
audit's conclusion — the dropped rows contribute no `gsis_id` that the parsed rows do not.

---

## Reproduce

All commands run from `scripts/data/nfl-db/`.

```bash
# 0. Self-check. Builds the dimension, asserts key uniqueness, reports orphans
#    before/after against the live DB, exits non-zero if any orphan remains.
python3 lib/player_dimension.py

# 1. Orphan counts per fact table (the "before" column)
sqlite3 nfl.db "
SELECT 'player_game_stats' AS tbl, COUNT(*) AS orphan_rows, COUNT(DISTINCT gsis_id) AS orphan_ids
  FROM player_game_stats WHERE gsis_id IS NOT NULL AND gsis_id NOT IN (SELECT gsis_id FROM player)
UNION ALL SELECT 'snap_count', COUNT(*), COUNT(DISTINCT gsis_id) FROM snap_count
  WHERE gsis_id IS NOT NULL AND gsis_id NOT IN (SELECT gsis_id FROM player)
UNION ALL SELECT 'roster_season', COUNT(*), COUNT(DISTINCT gsis_id) FROM roster_season
  WHERE gsis_id IS NOT NULL AND gsis_id NOT IN (SELECT gsis_id FROM player)
UNION ALL SELECT 'depth_chart', COUNT(*), COUNT(DISTINCT gsis_id) FROM depth_chart
  WHERE gsis_id IS NOT NULL AND gsis_id NOT IN (SELECT gsis_id FROM player)
UNION ALL SELECT 'game.away_qb_id', COUNT(*), COUNT(DISTINCT away_qb_id) FROM game
  WHERE away_qb_id IS NOT NULL AND away_qb_id NOT IN (SELECT gsis_id FROM player)
UNION ALL SELECT 'game.home_qb_id', COUNT(*), COUNT(DISTINCT home_qb_id) FROM game
  WHERE home_qb_id IS NOT NULL AND home_qb_id NOT IN (SELECT gsis_id FROM player);"
# -> player_game_stats|0|0  snap_count|0|0  roster_season|1590|1482
#    depth_chart|1|1  game.away_qb_id|0|0  game.home_qb_id|0|0

# 2. gsis_id uniqueness and the esb-form quirk
sqlite3 nfl.db "
SELECT COUNT(*) rows, COUNT(DISTINCT gsis_id) distinct_ids,
       COUNT(DISTINCT LOWER(TRIM(gsis_id))) distinct_ci,
       SUM(gsis_id IS NULL OR TRIM(gsis_id)='') nulls,
       SUM(gsis_id NOT GLOB '00-[0-9][0-9][0-9][0-9][0-9][0-9][0-9]') non_gsis_form
FROM player;"
# -> 25035|25035|25035|0|6098

# 3. pfr_id / espn_id / esb_id duplicates (case- and whitespace-insensitive)
sqlite3 nfl.db "SELECT UPPER(TRIM(pfr_id)),COUNT(*),GROUP_CONCAT(gsis_id) FROM player
  WHERE TRIM(COALESCE(pfr_id,''))<>'' GROUP BY 1 HAVING COUNT(*)>1;"   # -> (empty)
sqlite3 nfl.db "SELECT UPPER(TRIM(espn_id)),COUNT(*),GROUP_CONCAT(gsis_id) FROM player
  WHERE TRIM(COALESCE(espn_id,''))<>'' GROUP BY 1 HAVING COUNT(*)>1;"  # -> (empty)
sqlite3 nfl.db "SELECT UPPER(TRIM(esb_id)),COUNT(*),GROUP_CONCAT(gsis_id||':'||display_name,' | ')
  FROM player WHERE TRIM(COALESCE(esb_id,''))<>'' GROUP BY 1 HAVING COUNT(*)>1;"
# -> PRY456541|2|00-0040792:Layne Pryor | PRY456541:Layne Pryor

# 4. Key coverage, whole table and referenced subset
sqlite3 nfl.db "
WITH used AS (
  SELECT DISTINCT gsis_id FROM player_game_stats WHERE gsis_id IS NOT NULL
  UNION SELECT gsis_id FROM snap_count     WHERE gsis_id IS NOT NULL
  UNION SELECT gsis_id FROM roster_season  WHERE gsis_id IS NOT NULL
  UNION SELECT gsis_id FROM depth_chart    WHERE gsis_id IS NOT NULL
  UNION SELECT away_qb_id FROM game        WHERE away_qb_id IS NOT NULL
  UNION SELECT home_qb_id FROM game        WHERE home_qb_id IS NOT NULL)
SELECT (SELECT COUNT(*) FROM used)                                             AS referenced_ids,
       (SELECT COUNT(*) FROM used u JOIN player p USING(gsis_id))              AS present,
       (SELECT COUNT(*) FROM used u LEFT JOIN player p USING(gsis_id)
          WHERE p.gsis_id IS NULL)                                             AS orphans,
       (SELECT COUNT(*) FROM used u JOIN player p USING(gsis_id)
          WHERE TRIM(COALESCE(p.pfr_id,''))='')                                AS no_pfr,
       (SELECT COUNT(*) FROM used u JOIN player p USING(gsis_id)
          WHERE TRIM(COALESCE(p.espn_id,''))='')                               AS no_espn,
       (SELECT COUNT(*) FROM player p LEFT JOIN used u USING(gsis_id)
          WHERE u.gsis_id IS NULL)                                             AS never_referenced;"
# -> 11593|10111|1482|193|21|14924

# 5. The 227 NULL-gsis snap rows collapse to 30 pfr ids, none of them an orphan
sqlite3 nfl.db "
SELECT s.pfr_player_id, COUNT(*) n, MIN(s.season), MAX(s.season),
       SUM(s.gsis_id IS NULL) null_gsis
FROM snap_count s LEFT JOIN player p ON p.pfr_id = s.pfr_player_id
WHERE s.pfr_player_id IS NOT NULL AND p.gsis_id IS NULL
GROUP BY 1 ORDER BY n DESC;"          # -> 30 rows, SUM(n) = 227, null_gsis = n for every row

# 6. Upstream: raw CSVs carry no id the DB hides
python3 - <<'PY'
import csv
P={r['gsis_id'] for r in csv.DictReader(open('raw/players.csv',newline='',encoding='utf-8'))}
for name,path,col in [('rosters','raw/rosters.csv','gsis_id'),
                      ('player_stats','raw/player_stats.csv','player_id'),
                      ('depth_charts','raw/depth_charts.csv','gsis_id')]:
    ids={(r.get(col) or '').strip() for r in csv.DictReader(open(path,newline='',encoding='utf-8'))}
    ids.discard(''); ids.discard('NA')
    print(f'{name:13} distinct={len(ids):6} not_in_players.csv={len(ids-P)}')
PY
# -> rosters 11591 / 1482 ; player_stats 7749 / 0 ; depth_charts 8695 / 1

# 7. The live nflverse players release is identical to the local extract
curl -sSL -o cache/b5/live_players.csv \
  https://github.com/nflverse/nflverse-data/releases/download/players/players.csv
python3 -c "
import csv
a={r['gsis_id'] for r in csv.DictReader(open('raw/players.csv',newline='',encoding='utf-8'))}
b={r['gsis_id'] for r in csv.DictReader(open('cache/b5/live_players.csv',newline='',encoding='utf-8'))}
print(len(a), len(b), 'live-only:', len(b-a), 'local-only:', len(a-b))"
# -> 25035 25035 live-only: 0 local-only: 0

# 8. ESPN evidence (all cached; re-fetch only if the cache is gone)
#   cache/b5/espn_athlete_15554.json    Phil Bates
#   cache/b5/espn_athlete_3163372.json  Alexander Matheson
#   cache/b5/espn_athlete_3917058.json  Roderic Teamer
#   cache/b5/espn_athlete_3042435.json  Kevin White (WR)
#   cache/b5/espn_athlete_16932.json    Cam Fleming
#   cache/b5/espn_athlete_17764.json    Brandon Moore
#   cache/b5/espn_college_{24,195,201,2364}.json
#   cache/b5/espn_search_*.json         24 name searches
#   cache/b5/dp_playerids.csv           DynastyProcess crosswalk
#   cache/b5/{hardkey_matches,fuzzy_same_human,name_collisions,
#             snap_pfr_unmatched,dp_backfill}.json
```

Programmatic use:

```python
import sys; sys.path.insert(0, "scripts/data/nfl-db/lib")
from player_dimension import (build_player_dimension, as_tuples, PLAYER_COLUMNS,
                              MANUAL_ADDITIONS, DUPLICATE_KEYS, CANONICAL_GSIS)

dim = build_player_dimension("raw/players.csv", "raw/rosters.csv")   # 26,517 rows
conn.executemany("INSERT INTO player VALUES (" + ",".join("?"*21) + ")", as_tuples(dim))
```

---

## Appendix A — the full orphan list (1,482)

`DUP->` marks an id confirmed to be the same human as an existing `player` row (see §2).

| gsis_id | name | pos | seasons | teams | status | college |
|---|---|---|---|---|---|---|
| 00-0029389 | Phil Bates | WR | 2014 | CLE,SEA |  |  DUP->BAT138483 |
| 00-0029818 | Troy Stoudermire | WR | 2016 | MIN | ACT |  |
| 00-0029930 | Marquis Jackson | DL | 2016 | CHI | CUT | Portland State |
| 00-0030153 | Otha Foster | DB | 2017 | BAL | CUT | West Alabama |
| 00-0030314 | Frank Beltre | LB | 2017 | NYJ | CUT | Towson |
| 00-0030350 | Jonathan Amosa | RB | 2016 | SEA | CUT |  |
| 00-0030373 | Mitchell White | DB | 2017 | PHI | CUT | Michigan State |
| 00-0030797 | Derel Walker | WR | 2017 | TB | CUT | Texas A&M |
| 00-0031756 | Ray Vinopal | DB | 2016 | PIT | CUT |  |
| 00-0031776 | Dominique Davis | DL | 2016 | KC | CUT |  |
| 00-0031789 | Tom Obarski | K | 2016 | NYG | CUT |  |
| 00-0031810 | Montell Garner | DB | 2016 | PIT | CUT |  |
| 00-0031879 | Quinterrius Eatmon | OL | 2018 | CAR | CUT | South Florida |
| 00-0031913 | Levi Norwood | WR | 2016 | PIT | CUT |  |
| 00-0031977 | John Peters | TE | 2016 | CIN | ACT |  |
| 00-0031986 | Cameron Stingily | RB | 2016 | PIT | CUT |  |
| 00-0032213 | Mike Reilly | LB | 2016 | PIT | CUT |  |
| 00-0032237 | Jimmay Mundine | TE | 2016 | BUF | ACT |  |
| 00-0032270 | A.J. Cruz | WR | 2016 | MIA | CUT |  |
| 00-0032276 | Chris Highland | LS | 2016 | NO | ACT |  |
| 00-0032286 | Jarrod West | WR | 2016 | TEN | ACT |  |
| 00-0032331 | Matt Dooley | LS | 2016 | PIT | CUT |  |
| 00-0032333 | Anthony Dable | WR | 2016,2017 | ATL,NYG | CUT | No College |
| 00-0032334 | Xavier Rush | WR | 2016,2017 | NO,PHI | CUT | Tulane |
| 00-0032338 | Drew Ferris | LS | 2018 | TB | CUT | Florida |
| 00-0032342 | Danny Anthrop | WR | 2016 | IND | ACT |  |
| 00-0032346 | Daniel Davie | DB | 2016 | TB | ACT |  |
| 00-0032356 | Anthony Sarao | LB | 2016 | IND | ACT |  |
| 00-0032357 | Delvon Simmons | DL | 2016 | IND | ACT |  |
| 00-0032359 | Ron Thompson | LB | 2017 | WSH | CUT | Syracuse |
| 00-0032360 | Darius White | DB | 2016 | IND | ACT |  |
| 00-0032364 | Michael Cooper | TE | 2016 | PIT | CUT |  |
| 00-0032372 | Valdez Showers | WR | 2017 | IND | CUT | Florida |
| 00-0032478 | David Perkins | DL | 2016 | SEA | CUT |  |
| 00-0032483 | Bobo Beathard |  | 2016 | ARI |  |  |
| 00-0032487 | Amir Carlisle | WR | 2016 | ARI | ACT |  |
| 00-0032490 | Jake Coker | QB | 2016 | ARI | ACT |  |
| 00-0032494 | Danny Dillon | LS | 2016 | ARI | ACT |  |
| 00-0032504 | Jamison Lalk | OL | 2016 | BUF | ACT |  |
| 00-0032505 | Garrett Swanson | P | 2016 | ARI | ACT |  |
| 00-0032509 | Keith Lumpkin | OL | 2016 | IND | CUT |  |
| 00-0032510 | Calvin Heurtelou | DL | 2017 | GB | CUT | Miami (Fla.) |
| 00-0032513 | Eric Striker | LB | 2016 | BUF | ACT |  |
| 00-0032516 | Julian Whigham | DB | 2016 | PIT | CUT |  |
| 00-0032526 | David Moala | DL | 2017 | ARI | CUT | Utah State |
| 00-0032527 | Max Wittek | QB | 2016 | JAX | ACT |  |
| 00-0032531 | Will Monday | P | 2016,2017 | CIN,PIT | CUT | Duke |
| 00-0032532 | Giorgio Newberry | DL | 2016,2017 | DET,PIT | CUT | Florida State |
| 00-0032533 | Christian Powell | RB | 2016 | PIT | CUT |  |
| 00-0032534 | David Reeves | TE | 2016 | CLE | ACT |  |
| 00-0032538 | DeVaunte Sigler | DL | 2016 | PIT | CUT |  |
| 00-0032541 | Alex Cooper | OL | 2016 | CIN | ACT |  |
| 00-0032544 | Antwane Grant | WR | 2016 | CIN | ACT |  |
| 00-0032545 | Darien Harris | LB | 2016 | CIN | ACT |  |
| 00-0032551 | John Weidenaar | OL | 2016 | CIN | ACT |  |
| 00-0032554 | Quinshad Davis | WR | 2016 | DET | CUT |  |
| 00-0032557 | Adam Fuehne | TE | 2016 | DET | CUT |  |
| 00-0032572 | Mario Ojemudia | LB | 2016 | BAL | ACT |  |
| 00-0032576 | V'Angelo Bentley | DB | 2016 | NE | CUT |  |
| 00-0032585 | Will Ratelle | RB | 2016 | ATL | CUT |  |
| 00-0032586 | Ivan McLennan | LB | 2016 | ATL | CUT |  |
| 00-0032588 | Jake Reed | OL | 2016 | ATL | CUT |  |
| 00-0032590 | Gerald Dixon Jr. | DL | 2016 | DAL | CUT |  |
| 00-0032594 | David Mims II | DB | 2016 | ATL | CUT |  |
| 00-0032601 | Jordan Sefon | DB | 2016 | ATL | CUT |  |
| 00-0032604 | Malachi Jones | WR | 2018 | CHI | CUT | Appalachian State |
| 00-0032607 | Theiren Cockran | DL | 2016 | MIN | ACT |  |
| 00-0032608 | Jake Ganus | LB | 2016 | MIN | ACT |  |
| 00-0032610 | Denzell Perine | DL | 2016 | MIN | ACT |  |
| 00-0032612 | Brandon Ross | RB | 2016 | GB | CUT |  |
| 00-0032613 | Claudell Louis | DL | 2016 | MIN | ACT |  |
| 00-0032618 | Gabe Hughes | TE | 2016 | MIA | CUT |  |
| 00-0032619 | Tyler Gray | LB | 2016 | MIA | CUT |  |
| 00-0032623 | Akil Blount | LB | 2016 | MIA | CUT |  |
| 00-0032624 | Ruben Carter | OL | 2016,2017 | MIA,PIT | CUT | Toledo |
| 00-0032629 | Beniquez Brown | LB | 2016 | GB | CUT |  |
| 00-0032639 | Marshaun Coprich | RB | 2016 | NYG | CUT |  |
| 00-0032640 | Randall Jette | DB | 2016 | GB | CUT |  |
| 00-0032644 | Peter Mortell | P | 2016 | GB | CUT |  |
| 00-0032647 | Melvin Lewis |  | 2016 | NYG |  |  |
| 00-0032654 | Greg Milhouse | DL | 2016,2017 | NYG,SEA | CUT | Campbell |
| 00-0032657 | Mike Rose | DL | 2016 | NYG | CUT |  |
| 00-0032662 | Dan Buchholz | OL | 2016 | DAL | CUT |  |
| 00-0032665 | Derek Keaton | WR | 2016 | CHI | ACT |  |
| 00-0032684 | Ian Seau | DL | 2017 | BUF | CUT | Nevada |
| 00-0032690 | Tarow Barney | DL | 2016 | NYJ | ACT |  |
| 00-0032695 | Ross Martin | K | 2016,2017,2018 | CLE,NYJ | CUT | Duke |
| 00-0032696 | Helva Matungulu | DL | 2016 | NYJ | ACT |  |
| 00-0032700 | Caleb Azubike |  | 2016 | DAL |  |  |
| 00-0032704 | Arjen Colquhoun | DB | 2016 | DAL | CUT |  |
| 00-0032706 | David Hedelin |  | 2016 | DAL |  |  |
| 00-0032709 | Ryan Mack | OL | 2016 | DAL | CUT |  |
| 00-0032711 | Jason Neill | LB | 2016 | CLE | ACT |  |
| 00-0032712 | Boston Stiverson | OL | 2016 | DAL | CUT |  |
| 00-0032732 | Richard Mullaney | WR | 2016,2017 | CLE,DAL | CUT | Alabama |
| 00-0032746 | Taylor Fallin | OL | 2016 | TB | ACT |  |
| 00-0032754 | Elijah Shumate | DB | 2016 | TB | ACT |  |
| 00-0032811 | Jake Bernstein | OL | 2016 | ARI | ACT |  |
| 00-0032816 | Tre Jones | DB | 2016 | KC | CUT | Mount Union |
| 00-0032822 | Trip Thurman | OL | 2016 | CIN | ACT |  |
| 00-0032823 | Corey Tindal | DB | 2016 | CIN | ACT |  |
| 00-0032824 | David Glidden | WR | 2016 | ATL | CUT |  |
| 00-0032825 | Dominique Robertson |  | 2016 | TB |  |  |
| 00-0032826 | Shahbaz Ahmed | OL | 2016 | PIT | CUT |  |
| 00-0032828 | Brandon Williams | DL | 2016 | ATL | CUT |  |
| 00-0032837 | Bruce Johnson | OL | 2016 | PHI | ACT |  |
| 00-0032840 | Myke Tavarres | LB | 2016 | PHI | ACT |  |
| 00-0032843 | Demetris Anderson | DL | 2016 | GB | CUT |  |
| 00-0032845 | Alstevis Squirewell | RB | 2016 | GB | CUT |  |
| 00-0032846 | Cory Tucker | OL | 2016 | CLE | ACT |  |
| 00-0032847 | Darrin Peterson | WR | 2016 | CHI | ACT |  |
| 00-0032853 | Micah Awe | LB | 2016 | TB | ACT |  |
| 00-0032854 | Travis Britz | DL | 2016 | TB | ACT |  |
| 00-0032855 | Kelby Johnson | OL | 2016 | TB | ACT |  |
| 00-0032857 | John DePalma | LS | 2016 | PHI | ACT |  |
| 00-0032861 | Lamarcus Brutus | DB | 2016 | TEN | ACT |  |
| 00-0032866 | Terrell Lathan | DL | 2016 | TEN | NWT |  |
| 00-0032869 | Nick Ritcher | OL | 2016 | TEN | ACT |  |
| 00-0032878 | Sione Houma | RB | 2016 | NO | ACT |  |
| 00-0032880 | Dillon Lee | LB | 2016 | NO | ACT |  |
| 00-0032882 | Dominique Tovell | LB | 2016 | DET | CUT |  |
| 00-0032908 | Mike McQueen | OL | 2016 | DAL | CUT |  |
| 00-0032910 | Shaq Petteway | LB | 2016 | LAC | ACT |  |
| 00-0032912 | DeAndre Reaves | WR | 2016 | LAC | ACT |  |
| 00-0032913 | Larry Scott | DB | 2016,2017 | KC,LAC | CUT | Oregon State |
| 00-0032914 | Matt Weiser | TE | 2016,2017,2018 | LAC,TB | CUT | Buffalo |
| 00-0032919 | Shannon Edwards | DB | 2016 | KC | ACT | Fresno State |
| 00-0032920 | Garrick Mayweather | OL | 2016 | KC | CUT |  |
| 00-0032924 | Ryan Langford | LB | 2016,2017 | ARI,HOU | CUT | New Mexico |
| 00-0032925 | Matt Smalley | DB | 2016 | NYG | CUT |  |
| 00-0032928 | Kyrie Wilson | LB | 2016 | LV | CUT |  |
| 00-0032961 | Adrian Bellard | OL | 2016 | CHI | CUT | Texas State |
| 00-0032982 | Louis Palmer | DL | 2016 | DET | CUT |  |
| 00-0032985 | Mikell Everette | DB | 2016 | CLE | ACT |  |
| 00-0032992 | A.J. Stamps |  | 2016 | CLE |  |  |
| 00-0033000 | Jared Dangerfield | WR | 2016 | NO | ACT |  |
| 00-0033012 | Kenton Adeyemi | DL | 2016 | CLE | ACT |  |
| 00-0033013 | Sam Bergen | RB | 2016 | TEN | ACT |  |
| 00-0033015 | Kieren Duncan | WR | 2016 | CHI | ACT |  |
| 00-0033016 | Ben LeCompte |  | 2016 | CHI |  |  |
| 00-0033017 | Ben Roberts | WR | 2016 | TEN | ACT |  |
| 00-0033018 | Michael Smith | DL | 2016 | TEN | ACT |  |
| 00-0033020 | Vi Teofilo | OL | 2016 | LAC | ACT |  |
| 00-0033023 | Joe Hansley | WR | 2016 | LV | CUT |  |
| 00-0033026 | Torian White | OL | 2016 | LV | CUT |  |
| 00-0033027 | Joe Licata | QB | 2016 | CIN | ACT |  |
| 00-0033036 | Donovan Williams | OL | 2016 | IND | ACT |  |
| 00-0033041 | Mariel Cooper | DB | 2017 | TB | CUT | The Citadel |
| 00-0033067 | James Ross | LB | 2016 | LAC | ACT |  |
| 00-0033068 | Jarrett Grace | LB | 2016 | CHI | ACT |  |
| 00-0033071 | Marquise Williams | QB | 2016 | GB | CUT |  |
| 00-0033081 | Ben McCord | TE | 2016 | DET | CUT |  |
| 00-0033089 | Devon Bell | PR | 2016 | DET | CUT |  |
| 00-0033092 | Reece Horn | WR | 2016,2019 | MIA,TEN | CUT | Indianapolis |
| 00-0033099 | Paul Lang | TE | 2016 | PIT | CUT |  |
| 00-0033105 | Dalyn Williams |  | 2016 | CHI |  |  |
| 00-0033116 | Bryce Cheek | DB | 2016 | KC | CUT |  |
| 00-0033133 | Warren Gatewood | DB | 2016 | GB | CUT |  |
| 00-0033134 | Ra'Zahn Howard | DL | 2016 | HOU | CUT |  |
| 00-0033135 | Mandel Dixon | TE | 2016 | PIT | CUT |  |
| 00-0033139 | Joel Hale | OL | 2016 | TB | ACT |  |
| 00-0033141 | Rashaun Simonise | WR | 2016 | CIN | ACT |  |
| 00-0033144 | Jack Gangwish | DL | 2016 | CIN | ACT |  |
| 00-0033148 | Harvey Binford | WR | 2016 | GB | CUT | Lindenwood, Ill. |
| 00-0033150 | Montario Hunter | WR | 2016 | SEA | CUT |  |
| 00-0033152 | Franky Okafor | WR | 2016 | ARI | ACT |  |
| 00-0033153 | Clayton Echard | TE | 2016 | SEA | CUT |  |
| 00-0033157 | Jamal Golden | DB | 2016 | NO | ACT |  |
| 00-0033158 | Jordan Walsh | OL | 2016 | ATL | CUT |  |
| 00-0033160 | Terry Williams | RB | 2016 | NYJ | ACT |  |
| 00-0033162 | Matt Pierson | OL | 2016 | HOU | CUT |  |
| 00-0033165 | Malcolm Jackson | DB | 2016 | KC | CUT |  |
| 00-0033166 | Alex Chisum | WR | 2016 | DET | CUT |  |
| 00-0033171 | Jesse Schmitt | LS | 2016 | GB | CUT |  |
| 00-0033173 | Chase Price | RB | 2016 | IND | ACT |  |
| 00-0033177 | Wade Hansen | OL | 2016 | PIT | CUT |  |
| 00-0033178 | Khaynin Mosley-Smith | DL | 2016 | PIT | CUT |  |
| 00-0033179 | Darius White | WR | 2016 | BAL | ACT |  |
| 00-0033180 | Andrew Opoku | WR | 2016 | IND | ACT |  |
| 00-0033182 | Justin Berger | WR | 2016 | IND | CUT |  |
| 00-0033184 | Jake Metz | DL | 2016,2017 | PHI | CUT | Shippensburg |
| 00-0033188 | Alex Bazzie | LB | 2017 | ARI | CUT | Marshall |
| 00-0033191 | Jeff Knox | LB | 2017,2018 | TB,TEN | CUT | California (PA) |
| 00-0033197 | Quayvon Hicks | RB | 2017 | TB | CUT | Georgia |
| 00-0033200 | Taylor Symmank | P | 2017 | MIN | CUT | Texas Tech |
| 00-0033202 | Chris Briggs | WR | 2017 | IND | CUT | Southeastern Louisiana |
| 00-0033205 | Winston Chapman | LS | 2017 | MIA | CUT | Mississippi State |
| 00-0033209 | Joe Fortunato | LS | 2022 | DEN | DEV | Delaware |
| 00-0033214 | Jacob Lindsey | LB | 2017 | BUF | CUT | Harvard |
| 00-0033218 | Sam Irwin-Hill | P | 2017,2019 | ATL,DAL | DEV | Arkansas |
| 00-0033223 | Reginald Davis | WR | 2017 | ATL | CUT | Texas Tech |
| 00-0033225 | Wil Freeman | OL | 2017 | ATL | CUT | Southern Mississippi |
| 00-0033230 | Robert Leff | OL | 2017 | GB | CUT | Auburn |
| 00-0033231 | Josh Magee | WR | 2017 | ATL | CUT | South Alabama |
| 00-0033235 | Tyler Renew | RB | 2017 | ATL | CUT | The Citadel |
| 00-0033237 | Christian Tago | LB | 2017 | PHI | CUT | San Jose State |
| 00-0033239 | Deron Washington | DB | 2017 | ATL | CUT | Pittsburg State |
| 00-0033241 | Terrish Webb | DB | 2017 | PIT | CUT | Pittsburgh |
| 00-0033244 | Kevin Davis | LB | 2017 | LAR | CUT | Colorado State |
| 00-0033247 | Folarin Orimolade | LB | 2017 | LAR | CUT | Dartmouth |
| 00-0033248 | Casey Sayles | DL | 2017,2018,2019 | LAR,PIT | CUT | Ohio U. |
| 00-0033250 | Sae Tautu | LB | 2017 | NO | CUT | Brigham Young |
| 00-0033252 | James Quick | WR | 2017 | WSH | CUT | Louisville |
| 00-0033257 | Dalton Crossan | RB | 2017,2018 | IND,TB | CUT | New Hampshire |
| 00-0033262 | Colin Jeter | TE | 2018 | TB | CUT | LSU |
| 00-0033264 | Jerome Lane | WR | 2017 | NYG | CUT | Akron |
| 00-0033276 | Levern Jacobs | WR | 2017 | WSH | CUT | Maryland |
| 00-0033278 | Christian Brown | DL | 2017 | PIT | CUT | West Virginia |
| 00-0033311 | Zach Franklin | DB | 2017 | SF | CUT | Washburn |
| 00-0033318 | Tyler McCloskey | RB | 2017 | SF | CUT | Houston |
| 00-0033330 | Sam McCaskill | DL | 2017 | MIN | CUT | Boise State |
| 00-0033331 | Terrell Newby | RB | 2017 | MIN | CUT | Nebraska |
| 00-0033340 | Karel Hamilton | WR | 2017 | DAL | CUT | Samford |
| 00-0033341 | Darrin Laufasa | RB | 2017 | CIN | CUT | Texas-El Paso |
| 00-0033342 | Landon Lechler | OL | 2017 | CIN | CUT | North Dakota State |
| 00-0033349 | Stanley Williams | RB | 2017 | DEN | CUT | Kentucky |
| 00-0033354 | Thomas Evans | OL | 2017 | GB | CUT | Richmond |
| 00-0033356 | Cody Heiman | LB | 2017 | GB | CUT | Washburn |
| 00-0033360 | Aaron Peck | TE | 2017 | GB | CUT | Fresno State |
| 00-0033361 | Kalif Phillips | RB | 2017 | GB | CUT | North Carolina-Charlotte |
| 00-0033365 | Kenny Allen | P | 2017 | BAL | CUT | Michigan |
| 00-0033370 | Carlos Davis | DB | 2017 | LAR | CUT | Mississippi |
| 00-0033394 | Max Rich | OL | 2017 | NE | CUT | Harvard |
| 00-0033395 | Dwayne Thomas | DB | 2017 | JAX | CUT | LSU |
| 00-0033398 | Corey Vereen | DL | 2017 | NE | CUT | Tennessee |
| 00-0033401 | Larry Hope | DB | 2017 | MIA | CUT | Akron |
| 00-0033404 | Praise Martin-Oguike | DL | 2017,2018 | ARI,MIA | CUT | Temple |
| 00-0033418 | Kwayde Miller | OL | 2017 | MIA | CUT | San Diego State |
| 00-0033419 | Alex Kozan | OL | 2017 | LAR | CUT | Auburn |
| 00-0033429 | Sefo Liufau | QB | 2017 | TB | CUT | Colorado |
| 00-0033431 | Paul Magloire | DB | 2017 | TB | CUT | Arizona |
| 00-0033437 | Chauncey Briggs | OL | 2017 | LV | CUT | Southern Methodist |
| 00-0033440 | Anthony Cioffi | DB | 2017,2020 | LV | CUT | Rutgers |
| 00-0033442 | Chris Humes | DB | 2017 | LV | CUT | Arkansas State |
| 00-0033451 | Ishmael Zamora | WR | 2017 | LV | CUT | Baylor |
| 00-0033472 | Gabe Marks | WR | 2017 | NYJ | CUT | Washington State |
| 00-0033475 | Chris Casher | LB | 2017 | NYG | CUT | Faulkner University |
| 00-0033476 | Najee Harris | LB | 2017 | LV | CUT | Wagner |
| 00-0033478 | Gabriel Mass | DL | 2017 | CAR | CUT | Lane |
| 00-0033484 | Alonzo Moore | WR | 2017 | KC | CUT | Nebraska |
| 00-0033485 | J.R. Nelson | DB | 2017 | KC | CUT | Montana |
| 00-0033487 | Tony Stevens | WR | 2017 | KC | CUT | Auburn |
| 00-0033488 | Corin Brooks | OL | 2017 | NYG | CUT | Texas-Permian Basin |
| 00-0033489 | Chris Bordelon | OL | 2017 | NYJ | CUT | Nicholls State |
| 00-0033492 | Aarion Penton | DB | 2017 | LAR | CUT | Missouri |
| 00-0033497 | Richard Levy | OL | 2017 | NYG | CUT | Connecticut |
| 00-0033504 | John Robinson-Woodgett | RB | 2017 | NO | CUT | Massachusetts |
| 00-0033506 | Josh Letuligasenoa | LB | 2017 | GB | CUT | Cal Poly-S.L.O. |
| 00-0033508 | William Stanback | RB | 2017,2020 | GB | CUT | Virginia Union |
| 00-0033510 | Aaron Taylor | DB | 2017 | GB | CUT | Ball State |
| 00-0033515 | Devine Redding | RB | 2017,2018 | KC,TB | CUT | Indiana |
| 00-0033516 | Jamari Staples | WR | 2017 | WSH | CUT | Louisville |
| 00-0033593 | Jordan Carrell | DL | 2017 | DAL | CUT | Colorado |
| 00-0033602 | Ironhead Gallon | DB | 2017,2018 | ARI,PHI | CUT | Georgia Southern |
| 00-0033603 | De'Chavon Hayes | DB | 2017 | ARI | CUT | Arizona State |
| 00-0033609 | Jonathan McLaughlin | OL | 2017 | ARI | CUT | Virginia Tech |
| 00-0033615 | Steven Wroblewski | TE | 2017 | IND | CUT | Southern Utah |
| 00-0033616 | Jordan Johnson | RB | 2017 | BUF | CUT | Buffalo |
| 00-0033618 | Greg Pyke | OL | 2017,2018 | ARI,BUF | CUT | Georgia |
| 00-0033621 | B.T. Sanders | DB | 2017 | BUF | CUT | Nicholls State |
| 00-0033625 | Zach Voytek | OL | 2017 | BUF | CUT | New Haven |
| 00-0033626 | Nigel Williams | DL | 2017,2018 | ARI,BUF | CUT | Virginia Tech |
| 00-0033629 | Andy Phillips | K | 2017 | CHI | CUT | Utah |
| 00-0033632 | Hendrick Ekpe | DL | 2017 | TB | CUT | Minnesota |
| 00-0033637 | Mitchell Kirsch | OL | 2017 | CHI | CUT | James Madison |
| 00-0033638 | Alex Scearce | LB | 2017 | CHI | CUT | Coastal Carolina |
| 00-0033640 | Freddie Stevenson | RB | 2017 | CHI | CUT | Florida State |
| 00-0033644 | Ladell Fleming | LB | 2017 | CLE | CUT | Northern Illinois |
| 00-0033645 | J.D. Harmon | DB | 2017 | CLE | CUT | Kentucky |
| 00-0033646 | Alvin Hill | DB | 2017 | CLE | CUT | Maryland |
| 00-0033647 | Jamal Marcus | DL | 2017 | CLE | CUT | Akron |
| 00-0033648 | Taylor McNamara | TE | 2017 | CLE | CUT | USC |
| 00-0033650 | Kenneth Olugbode | LB | 2017 | CLE | CUT | Colorado |
| 00-0033651 | Karter Schult | DL | 2017,2018,2019 | CAR,CLE,MIN | CUT | Northern Iowa |
| 00-0033654 | Woody Baron | DL | 2017 | DAL | CUT | Virginia Tech |
| 00-0033665 | Lucas Wacha | LB | 2017 | DAL | CUT | Wyoming |
| 00-0033666 | Deon Hollins | LB | 2017 | DEN | CUT | UCLA |
| 00-0033669 | Anthony Nash | WR | 2017 | DEN | CUT | Duke |
| 00-0033670 | Dontrell Nelson | DB | 2017 | DEN | CUT | Memphis |
| 00-0033677 | Dante Barnett | DB | 2017 | DEN | CUT | Kansas State |
| 00-0033680 | Caleb Bluiett | TE | 2017 | JAX | CUT | Texas |
| 00-0033682 | Parker Collins | OL | 2017,2018,2019 | CAR,LAR,PIT | CUT | Appalachian State |
| 00-0033685 | P.J. Davis | LB | 2017 | JAX | CUT | Georgia Tech |
| 00-0033689 | Justin Horton | LB | 2017 | JAX | CUT | Jacksonville |
| 00-0033690 | Tueni Lupeamanu | DL | 2017 | JAX | CUT | Idaho |
| 00-0033694 | Ezra Robinson | DB | 2017 | JAX | CUT | Tennessee State |
| 00-0033695 | Kenneth Walker | WR | 2017 | JAX | CUT | UCLA |
| 00-0033707 | Brandon Stewart | DB | 2017 | LAC | CUT | Kansas |
| 00-0033708 | Brad Watson | DB | 2017 | LAC | CUT | Wake Forest |
| 00-0033710 | DaShaun Amos | DB | 2017,2020 | GB,NYG | CUT | East Carolina |
| 00-0033721 | Nigel Tribune | DB | 2017 | NYG | CUT | Iowa State |
| 00-0033722 | Robert Wheelwright | WR | 2017 | KC | CUT | Wisconsin |
| 00-0033724 | Nelson Adams | DL | 2017 | DEN | CUT | Mississippi State |
| 00-0033730 | Tyler Orlosky | OL | 2017 | PHI | CUT | West Virginia |
| 00-0033736 | Algernon Brown | RB | 2017,2018 | KC,NYJ | CUT | Brigham Young |
| 00-0033741 | Nick Usher | LB | 2017,2020 | LV,NE | CUT | Texas-El Paso |
| 00-0033753 | Michael Rector | WR | 2017 | DET | CUT | Stanford |
| 00-0033754 | Maurice Swain | DL | 2017 | KC | CUT | Auburn |
| 00-0033772 | Shaq Hill | WR | 2017 | TB | CUT | Eastern Washington |
| 00-0033775 | Dayon Pratt | LB | 2017 | HOU | CUT | East Carolina |
| 00-0033777 | Jake Simonich | OL | 2017 | TEN | CUT | Utah State |
| 00-0033778 | Malik Smith | DB | 2017 | HOU | CUT | San Diego State |
| 00-0033780 | Avery Williams | LB | 2017 | HOU | CUT | Temple |
| 00-0033801 | Bra'lon Cherry | WR | 2017 | ATL | CUT | North Carolina State |
| 00-0033803 | Gio Pascascio | WR | 2017 | TEN | CUT | Louisville |
| 00-0033805 | Jonah Pirsig | OL | 2017 | TEN | CUT | Minnesota |
| 00-0033806 | DeAngelo Brown | DL | 2017 | TEN | CUT | Louisville |
| 00-0033810 | John Green | DB | 2017 | DAL | CUT | Connecticut |
| 00-0033814 | Kevin Maurice | DL | 2017 | JAX | CUT | Nebraska |
| 00-0033817 | Khalid Abdullah | RB | 2017 | NYG | CUT | James Madison |
| 00-0033818 | Trey Robinson | DB | 2017 | NYG | CUT | Furman |
| 00-0033820 | Ken Ekanem | LB | 2017 | DEN | CUT | Virginia Tech |
| 00-0033821 | Tevin Homer | DB | 2017 | WSH | CUT | Florida Atlantic |
| 00-0033822 | Kevin Snead | WR | 2017 | NYG | CUT | Carson-Newman |
| 00-0033823 | Larry Clark | WR | 2017 | ARI | CUT | Colorado State-Pueblo |
| 00-0033824 | Randy Allen | LB | 2017 | BAL | CUT | South Alabama |
| 00-0033828 | Dante Blackmon | DB | 2017 | IND | CUT | Kennesaw St. (GA) |
| 00-0033829 | Tyson Graham | DB | 2017,2018 | ATL,IND | CUT | South Dakota |
| 00-0033832 | Marcus McWilson | DB | 2017 | LV | CUT | Kentucky |
| 00-0033835 | Abner Logan | LB | 2017 | BUF | CUT | Albany |
| 00-0033837 | C.J. Robbins | DL | 2017 | TEN | CUT | Northwestern |
| 00-0033842 | De'Mard Llorens | RB | 2017 | IND | CUT | Northwestern State-Louisiana |
| 00-0033848 | Freddie Tagaloa | OL | 2017 | MIN | CUT | Arizona |
| 00-0033850 | Phazahn Odom | TE | 2017 | PIT | CUT | Fordham |
| 00-0033851 | Nico Marley | LB | 2017 | WSH | CUT | Tulane |
| 00-0033852 | Darnell Leslie | DL | 2017,2018 | DAL,PIT | CUT | Monmouth (N.J.) |
| 00-0033864 | Mitchell Paige | WR | 2017 | LAC | CUT | Indiana |
| 00-0033865 | Mikey Bart | DL | 2017 | NE | CUT | North Carolina |
| 00-0033866 | Bart Houston | QB | 2017 | PIT | CUT | Wisconsin |
| 00-0033978 | Toby Baker | P | 2017 | LAC | CUT | Arkansas |
| 00-0033979 | Sam Cotton | TE | 2017 | NE | CUT | Nebraska |
| 00-0033981 | A.J. Jefferson | DL | 2017 | ATL | CUT | Mississippi State |
| 00-0033984 | Mark Spelman | OL | 2017 | TEN | CUT | Illinois State |
| 00-0033985 | William Likely | DB | 2017 | NE | CUT | Maryland |
| 00-0033986 | Jack Lynn | LB | 2017 | ATL | CUT | Minnesota |
| 00-0033987 | Daniel Gray | DB | 2017 | NYG | CUT | Utah State |
| 00-0033988 | Daquan Holmes | DB | 2017 | GB | CUT | American International |
| 00-0033989 | Ryan Reid | DB | 2017 | LAC | CUT | Baylor |
| 00-0033991 | Cameron Posey | WR | 2017 | LAC | CUT | Purdue |
| 00-0033993 | Manny Abad | DB | 2017 | TEN | CUT | Florida Tech |
| 00-0033996 | Kareem Are | OL | 2017,2018 | LV,MIN | CUT | Florida State |
| 00-0033999 | Dane Evans | QB | 2017 | PHI | CUT | Tulsa |
| 00-0034000 | Adam Zaruba | TE | 2017,2018 | PHI | CUT | Simon Fraser (Canada) |
| 00-0034001 | Dejaun Butler | DB | 2017 | DAL | CUT | Hawaii |
| 00-0034002 | Larson Graham | OL | 2017,2018 | ATL,PIT | CUT | Duquesne |
| 00-0034003 | Noor Davis | LB | 2017 | MIN | CUT | Stanford |
| 00-0034004 | Jordan Westerkamp | WR | 2017 | MIA | CUT | Nebraska |
| 00-0034006 | Jonathan Walton | LB | 2017 | NO | CUT | South Carolina |
| 00-0034014 | Derrick Nelson | OL | 2017 | BAL | CUT | Rutgers |
| 00-0034015 | C.J. Germany | WR | 2017 | NYG | CUT | Unknown |
| 00-0034017 | Barrett Gouger | OL | 2017 | LAC | CUT | Vanderbilt |
| 00-0034018 | Jeremy Faulk | DL | 2017,2018 | CLE,NYJ | CUT | Garden City CC KS |
| 00-0034020 | Terence Waugh | LB | 2017 | ARI | CUT | Kent State |
| 00-0034021 | Darrell Brown | OL | 2017 | SEA | CUT | Louisiana Tech |
| 00-0034022 | Nate Iese | TE | 2017 | CLE | CUT | UCLA |
| 00-0034023 | Pig Howard | WR | 2017 | CHI | CUT | Tennessee |
| 00-0034024 | Mike Estes | TE | 2017 | LAC | CUT | Gardner-Webb |
| 00-0034025 | Marvin Bracy | WR | 2017,2018 | IND,SEA | CUT | Florida State |
| 00-0034028 | Brian Riley | WR | 2017 | IND | CUT | San Diego |
| 00-0034029 | Jimmy Herman | LB | 2017 | NYG | CUT | Purdue |
| 00-0034031 | Malik Foreman | DB | 2017 | NO | CUT | Tennessee |
| 00-0034032 | Keevan Lucas | WR | 2017 | PHI | CUT | Tulsa |
| 00-0034033 | Kendall Pace | OL | 2017 | WSH | CUT | Columbia |
| 00-0034036 | Austin Gearing | LB | 2017 | PIT | CUT | Miami (Ohio) |
| 00-0034037 | Germone Hopper | WR | 2017 | HOU | CUT | Clemson |
| 00-0034039 | Connor Bozick | OL | 2017 | DET | CUT | Delaware |
| 00-0034040 | Andrew Price | TE | 2017 | DET | CUT | Nevada-Las Vegas |
| 00-0034041 | Rodney Butler | LB | 2017 | SEA | CUT | New Mexico State |
| 00-0034042 | Darrius Sims | DB | 2017 | TEN | CUT | Vanderbilt |
| 00-0034044 | Mitch Leidner | QB | 2017 | MIN | CUT | Minnesota |
| 00-0034046 | Tyquwan Glass | DB | 2017 | LAR | CUT | Fresno State |
| 00-0034047 | Willie Mays | LB | 2017 | LAR | CUT | Tiffin University |
| 00-0034048 | Elijah Mitchell | DB | 2017 | NO | CUT | Nevada |
| 00-0034050 | Armagedon Draughn | DB | 2017 | NYJ | CUT | Albany State (Ga.) |
| 00-0034053 | Chris Bazile | TE | 2018 | ARI | CUT | Grambling State |
| 00-0034063 | Kacy Rodgers | DB | 2018 | NYJ | CUT | Miami (Fla.) |
| 00-0034066 | Moubarak Djeri | DL | 2018 | ARI | CUT | No College |
| 00-0034069 | Jerod Fernandez | LB | 2018 | WSH | CUT | North Carolina State |
| 00-0034074 | Jack Heneghan | QB | 2018 | SF | CUT | Dartmouth |
| 00-0034075 | Alan Knott | OL | 2018 | SF | CUT | South Carolina |
| 00-0034082 | McKay Murphy | DL | 2018 | LAR | CUT | Weber State |
| 00-0034083 | Ricky Jeune | WR | 2018 | DAL | CUT | Georgia Tech |
| 00-0034086 | Lashard Durr | DB | 2018 | IND | CUT | Mississippi State |
| 00-0034092 | William Ossai | LB | 2018 | IND | CUT | San Jose State |
| 00-0034093 | Henre' Toliver | DB | 2018,2019 | IND,NYG | CUT | Arkansas |
| 00-0034094 | Corey Griffin | DB | 2018 | SF | CUT | Georgia Tech |
| 00-0034105 | Ranthony Texada | DB | 2018 | WSH | CUT | Texas Christian |
| 00-0034106 | John Diarse | WR | 2018 | DEN | CUT | Texas Christian |
| 00-0034108 | Leon Johnson | OL | 2018 | DEN | CUT | Temple |
| 00-0034119 | Elijah Wellman | RB | 2018 | WSH | CUT | West Virginia |
| 00-0034120 | Curtis Mikell | DB | 2018 | LAR | CUT | Southern Mississippi |
| 00-0034124 | Chris Schleuger | OL | 2018 | PIT | CUT | Alabama-Birmingham |
| 00-0034127 | Cory Helms | OL | 2018 | CIN | CUT | South Carolina |
| 00-0034133 | Dontez Byrd | WR | 2018 | ATL | CUT | Tennessee Tech |
| 00-0034134 | Mackendy Cheridor | DL | 2018 | ATL | CUT | Georgia State |
| 00-0034136 | Secdrick Cooper | DB | 2018 | ATL | CUT | Louisiana Tech |
| 00-0034137 | Justin Crawford | RB | 2018 | ATL | CUT | West Virginia |
| 00-0034138 | Jon Cunningham | DL | 2018 | ATL | CUT | Kent State |
| 00-0034144 | Lamar Jordan | WR | 2018 | ATL | CUT | New Mexico |
| 00-0034146 | Troy Mangen | TE | 2018 | ATL | CUT | Ohio U. |
| 00-0034147 | David Marvin | K | 2018 | ATL | CUT | Georgia |
| 00-0034148 | Daniel Marx | RB | 2018 | SEA | CUT | Stanford |
| 00-0034149 | Luke McNitt | RB | 2018 | MIN | CUT | Nebraska |
| 00-0034156 | Malik Williams | RB | 2018,2019 | ATL,PIT | CUT | Louisville |
| 00-0034172 | Alex Officer | OL | 2018 | KC | CUT | Pittsburgh |
| 00-0034175 | Jacob Alsadek | OL | 2018 | DAL | CUT | Arizona |
| 00-0034180 | Jaelon Acklin | WR | 2018 | BAL | CUT | Western Illinois |
| 00-0034181 | Naashon Hughes | LB | 2018 | GB | CUT | Texas |
| 00-0034183 | C.J. Johnson | LB | 2018 | GB | CUT | East Texas Baptist |
| 00-0034188 | Kyle Meadows | OL | 2018 | PIT | CUT | Kentucky |
| 00-0034191 | Marcus Porter | LB | 2018 | GB | CUT | Fairmont State |
| 00-0034194 | Conor Sheehy | DL | 2018,2019 | GB,PIT | CUT | Wisconsin |
| 00-0034205 | Jarvion Franklin | RB | 2018 | PIT | CUT | Western Michigan |
| 00-0034212 | Chris Gonzalez | OL | 2018 | SF | CUT | San Jose State |
| 00-0034214 | Tyler Hoppes | TE | 2018 | MIN | CUT | Nebraska |
| 00-0034219 | Peter Pujals | QB | 2018 | MIN | CUT | Holy Cross |
| 00-0034220 | Korey Robertson | WR | 2018 | MIN | CUT | Southern Mississippi |
| 00-0034222 | Jake Wieneke | WR | 2018 | MIN | CUT | South Dakota State |
| 00-0034226 | Austin Golson | OL | 2018 | NYJ | CUT | Auburn |
| 00-0034228 | Lord Hyeamang | DL | 2018 | LAR | CUT | Columbia |
| 00-0034230 | Mychealon Thomas | DL | 2018 | NYJ | CUT | Texas Tech |
| 00-0034231 | Darius James | OL | 2018 | NYJ | CUT | Auburn |
| 00-0034233 | Tanner Carew | LS | 2018 | CHI | CUT | Oregon |
| 00-0034235 | Marcell Frazier | DL | 2018 | CLE | CUT | Missouri |
| 00-0034236 | Jason Hall | DB | 2018 | SEA | CUT | Texas |
| 00-0034238 | Warren Long | LB | 2018 | NYG | CUT | Northwestern |
| 00-0034241 | Skyler Phillips | OL | 2018 | SEA | CUT | Idaho State |
| 00-0034242 | Jake Pugh | LB | 2018 | SEA | CUT | Florida State |
| 00-0034244 | Ka'Raun White | WR | 2018 | CIN | CUT | West Virginia |
| 00-0034245 | Taj Williams | WR | 2018 | ATL | CUT | Texas Christian |
| 00-0034246 | Eddy Wilson | DL | 2018 | CIN | CUT | Purdue |
| 00-0034247 | Evan Berry | WR | 2018 | CLE | CUT | Tennessee |
| 00-0034252 | Micah Hannemann | DB | 2018 | LAC | CUT | Brigham Young |
| 00-0034254 | Fred Lauina | OL | 2018 | CLE | CUT | Oregon State |
| 00-0034257 | Trenton Thompson | DL | 2018 | CLE | CUT | Georgia |
| 00-0034260 | Nick Callender | OL | 2018 | IND | CUT | Colorado State |
| 00-0034290 | Dee Liner | DL | 2018,2019 | KC,LAC | CUT | Arkansas State |
| 00-0034292 | Blake Mack | WR | 2018 | KC | CUT | Arkansas State |
| 00-0034293 | Elijah Marks | WR | 2018 | KC | CUT | Northern Arizona |
| 00-0034304 | Julian Allen | TE | 2018 | CLE | CUT | Southern Mississippi |
| 00-0034306 | Ryan Smith | TE | 2018 | GB | CUT | Miami (Ohio) |
| 00-0034312 | Brett Taylor | LB | 2018 | MIN | CUT | Western Illinois |
| 00-0034314 | Henry Poggi | RB | 2018 | NE | CUT | Michigan |
| 00-0034321 | Parker Cothren | DL | 2018 | PIT | CUT | Penn State |
| 00-0034324 | Jamar Summers | DB | 2018,2019 | DET,PIT | CUT | Connecticut |
| 00-0034329 | Malik Reaves | DB | 2018 | PIT | CUT | Villanova |
| 00-0034443 | Johnathan Alston | DB | 2018,2019 | DET,MIA | CUT | North Carolina State |
| 00-0034451 | Claudy Mathieu | DL | 2018 | MIA | CUT | Notre Dame College (Ohio) |
| 00-0034453 | Anthony Moten | DL | 2018 | MIA | CUT | Miami (Fla.) |
| 00-0034459 | Aaron Evans | OL | 2018 | PHI | CUT | Central Florida |
| 00-0034460 | Danny Ezechukwu | DL | 2018 | PHI | CUT | Purdue |
| 00-0034462 | Anthony Mahoungou | WR | 2018 | PHI | CUT | Purdue |
| 00-0034464 | Ian Park | OL | 2018 | PHI | CUT | Slippery Rock |
| 00-0034466 | Stephen Roberts | DB | 2018 | PHI | CUT | Auburn |
| 00-0034467 | Dominick Sanders | DB | 2018 | DAL | CUT | Georgia |
| 00-0034471 | Elijah Battle | DB | 2018 | SEA | CUT | West Virginia |
| 00-0034472 | Alec Bloom | TE | 2018 | ARI | CUT | Connecticut |
| 00-0034480 | Mike Needham | LB | 2018 | MIN | CUT | Southern Utah |
| 00-0034482 | Owen Obasuyi | DL | 2018 | ARI | CUT | Hampton |
| 00-0034484 | Matthew Oplinger | LB | 2018 | ARI | CUT | Yale |
| 00-0034492 | Brant Weiss | OL | 2018,2019 | ARI,LAC | CUT | Toledo |
| 00-0034493 | Corey Willis | WR | 2018 | ARI | CUT | Central Michigan |
| 00-0034494 | Stephen Baggett | TE | 2018 | CLE | CUT | East Carolina |
| 00-0034497 | Tyrell Chavis | DL | 2018 | NYG | CUT | Penn State |
| 00-0034498 | Aaron Davis | DB | 2018 | TB | CUT | Georgia |
| 00-0034504 | Jonah Trinnaman | WR | 2018 | NYJ | CUT | Brigham Young |
| 00-0034506 | Ryan Carter | DB | 2018 | BUF | CUT | Clemson |
| 00-0034507 | Tyler Davis | K | 2018 | BUF | CUT | Penn State |
| 00-0034513 | Mo Porter | OL | 2018 | BUF | CUT | Baylor |
| 00-0034518 | Reggie Hunter | LB | 2018 | JAX | CUT | North Carolina Central |
| 00-0034519 | Darius Jackson | DL | 2018 | JAX | CUT | Jacksonville State |
| 00-0034525 | Andrew Motuapuaka | LB | 2018 | JAX | CUT | Virginia Tech |
| 00-0034528 | Devonte Boyd | WR | 2018 | CIN | CUT | Nevada-Las Vegas |
| 00-0034530 | Austin Fleer | OL | 2018 | DEN | CUT | Mesa State |
| 00-0034534 | Junior Joseph | LB | 2018 | CIN | CUT | Connecticut |
| 00-0034535 | Ray Lawry | RB | 2018 | KC | CUT | Old Dominion |
| 00-0034538 | Mat Boesen | DL | 2018 | BUF | CUT | Texas Christian |
| 00-0034541 | B.J. Clay | DB | 2018 | LAC | CUT | Georgia State |
| 00-0034544 | Marcus Edmond | DB | 2018 | LAC | CUT | Clemson |
| 00-0034547 | Albert Havili | DL | 2018 | BUF | CUT | Eastern Washington |
| 00-0034549 | Cole Hunt | TE | 2018,2019 | CAR,LAC | CUT | Texas Christian |
| 00-0034554 | James Hearns | DL | 2018 | GB | CUT | Louisville |
| 00-0034555 | Bryce Johnson | OL | 2018 | DAL | CUT | St. Cloud State |
| 00-0034557 | Ben Johnson | TE | 2018,2019 | LAC | CUT | Kansas |
| 00-0034558 | Joel Lanning | LB | 2018 | DAL | CUT | Iowa State |
| 00-0034561 | Marchie Murdock | WR | 2018 | DAL | CUT | Iowa State |
| 00-0034563 | Anthony Manzo-Lewis | RB | 2018 | LAC | CUT | Albany |
| 00-0034564 | DeQuinton Osborne | DL | 2018 | DEN | CUT | Oklahoma State |
| 00-0034572 | Dalton Sturm | QB | 2018 | DAL | CUT | Texas-San Antonio |
| 00-0034574 | Nic Shimonek | QB | 2018 | LAC | CUT | Texas Tech |
| 00-0034576 | Shane Tripucka | P | 2018 | LAC | CUT | Texas A&M |
| 00-0034579 | Kyle Bosch | OL | 2018 | DAL | CUT | West Virginia |
| 00-0034580 | Chris Frey | LB | 2018 | CAR | CUT | Michigan State |
| 00-0034583 | Tracy Sprinkle | DL | 2018,2019 | CAR,HOU | CUT | Ohio State |
| 00-0034592 | Garrett Johnson | WR | 2018 | CHI | CUT | Kentucky |
| 00-0034595 | Nyles Morgan | LB | 2018 | TEN | CUT | Notre Dame |
| 00-0034598 | Shane Wimann | TE | 2018 | NE | CUT | Northern Illinois |
| 00-0034599 | Elijah Norris | LB | 2018 | CHI | CUT | Shepherd |
| 00-0034600 | Nick Orr | DB | 2018 | CHI | CUT | Texas Christian |
| 00-0034605 | Cavon Walker | DL | 2018,2019,2020 | CHI,KC,PIT | CUT | Maryland |
| 00-0034608 | Austin Allen | QB | 2018 | TB | CUT | Arkansas |
| 00-0034615 | Josh Liddell | DB | 2018 | TB | CUT | Arkansas |
| 00-0034616 | Trevor Moore | K | 2018 | TB | CUT | North Texas |
| 00-0034617 | Evan Perrizo | DL | 2018 | TB | CUT | Minnesota State |
| 00-0034618 | Ervin Philips | WR | 2018 | TB | CUT | Syracuse |
| 00-0034619 | Jason Reese | TE | 2018 | CAR | CUT | Missouri |
| 00-0034620 | Antonio Simmons | DL | 2018 | DEN | CUT | Georgia Tech |
| 00-0034630 | Kingsley Opara | DL | 2018 | HOU | CUT | Maryland |
| 00-0034632 | Terry Swanson | RB | 2018 | HOU | CUT | Toledo |
| 00-0034634 | Jalen Wilkerson | DL | 2018 | WSH | CUT | Florida State |
| 00-0034635 | Al-Rasheed Benton | LB | 2018 | DET | CUT | West Virginia |
| 00-0034637 | Antwuan Davis | DB | 2018 | LV | CUT | Texas |
| 00-0034638 | Josh Fatu | DL | 2018 | DET | CUT | USC |
| 00-0034642 | Kyle Lewis | WR | 2018 | GB | CUT | Cal Poly-S.L.O. |
| 00-0034643 | Chad Meredith | LB | 2018 | DET | CUT | Southeast Missouri State |
| 00-0034644 | John Montelus | OL | 2018 | DET | CUT | Virginia |
| 00-0034645 | Beau Nunn | OL | 2018 | DET | CUT | Appalachian State |
| 00-0034656 | Matt Diaz | OL | 2018 | DAL | CUT | Wagner |
| 00-0034665 | Mike Ramsay | DL | 2018 | TEN | CUT | Duke |
| 00-0034666 | Larry Rose | RB | 2018 | LAR | CUT | New Mexico State |
| 00-0034670 | Akrum Wadley | RB | 2018 | TEN | CUT | Iowa |
| 00-0034689 | Manase Hungalu | LB | 2018 | JAX | CUT | Oregon State |
| 00-0034690 | Brandon Smith | OL | 2018 | JAX | CUT | East Carolina |
| 00-0034693 | Jared Machorro | OL | 2018 | IND | CUT | Texas A&M-Commerce |
| 00-0034694 | Zach Olstad | RB | 2018 | BUF | CUT | Winona State |
| 00-0034695 | Tyrice Beverette | DB | 2018 | CIN | CUT | Stony Brook |
| 00-0034696 | Chris Okoye | DL | 2018,2021 | CIN,LAC | DEV | Ferris State |
| 00-0034697 | Brogan Roback | QB | 2018 | CLE | CUT | Eastern Michigan |
| 00-0034701 | Mike Jones | DB | 2018 | NYG | CUT | Temple |
| 00-0034703 | Tim Wilson | WR | 2018 | PHI | CUT | East Stroudsburg |
| 00-0034704 | Matt Fleming | WR | 2018 | CHI | CUT | Benedictine |
| 00-0034709 | C.J. Duncan | WR | 2018 | ARI | CUT | Vanderbilt |
| 00-0034711 | Airius Moore | LB | 2018 | ARI | CUT | North Carolina State |
| 00-0034713 | Vontae Diggs | LB | 2018 | WSH | CUT | Connecticut |
| 00-0034714 | Josh Okonye | DB | 2018 | DET | CUT | Purdue |
| 00-0034716 | Clayton Wilson | TE | 2018 | SEA | CUT | Northwest Missouri State |
| 00-0034717 | Joseph Este | DB | 2018 | TEN | CUT | Tennessee-Martin |
| 00-0034718 | Connor Flagel | DL | 2018 | LV | CUT | Central Missouri State |
| 00-0034719 | Tobenna Okeke | LB | 2018 | TEN | CUT | Fresno State |
| 00-0034722 | Kendall Calhoun | OL | 2018 | WSH | CUT | Cincinnati |
| 00-0034724 | KeShun Freeman | LB | 2018 | NO | CUT | Georgia Tech |
| 00-0034727 | Drew Scott | LS | 2018,2019 | DAL,LV | CUT | Kansas State |
| 00-0034733 | Nick Holley | RB | 2018 | LAR | CUT | Kent State |
| 00-0034734 | Afolabi Laguda | DB | 2018 | LAR | CUT | Colorado |
| 00-0034738 | Brian Womac | DL | 2018 | LAR | CUT | Rice |
| 00-0034742 | Blaine Woodson | DL | 2018 | CLE | CUT | Delaware |
| 00-0034749 | Eldridge Massington | WR | 2018 | NO | CUT | UCLA |
| 00-0034758 | Shaheed Salmon | LB | 2018 | TB | CUT | Samford |
| 00-0034761 | Kayaune Ross | WR | 2018 | CIN | CUT | Kentucky |
| 00-0034783 | Garrett Hudson | TE | 2018 | WSH | CUT | Richmond |
| 00-0034786 | Sherman Badie | RB | 2018 | ARI | CUT | Tulane |
| 00-0034820 | Bentley Spain | OL | 2018 | KC | CUT | North Carolina |
| 00-0034821 | Juante Baldwin | DB | 2018 | IND | CUT | Pittsburg State |
| 00-0034822 | Trevor Darling | OL | 2018 | NO | CUT | Miami (Fla.) |
| 00-0034823 | Josh Smith | WR | 2018 | NO | CUT | Tennessee |
| 00-0034826 | Bo Bower | LB | 2018 | DEN | CUT | Iowa |
| 00-0034850 | Ro'Derrick Hoskins | LB | 2018 | CHI | CUT | Florida State |
| 00-0034852 | J.P. Quinn | OL | 2018 | MIN | CUT | Central Michigan |
| 00-0034853 | Aaron Lacombe | WR | 2018 | LAR | CUT | California Lutheran |
| 00-0034859 | Adonis Jennings | WR | 2018 | GB | CUT | Temple |
| 00-0034861 | Mark Chapman | WR | 2018 | DEN | CUT | Central Michigan |
| 00-0034862 | Jared Murphy | WR | 2018 | CIN | CUT | Miami (Ohio) |
| 00-0034863 | Cam Serigne | TE | 2018 | CAR | CUT | Wake Forest |
| 00-0034865 | Adam Reth | DL | 2018 | TB | CUT | Northern Iowa |
| 00-0034868 | Erick Wren | OL | 2018 | LAC | CUT | Oklahoma |
| 00-0034871 | Christian Boutte | DB | 2018 | CLE | CUT | Nicholls State |
| 00-0034873 | Du'Vonta Lampkin | DL | 2018 | TEN | CUT | Oklahoma |
| 00-0034877 | Marcus Peterson | WR | 2018 | LAC | CUT | Seton Hill |
| 00-0034878 | Bryce Bobo | WR | 2018 | DEN | CUT | Colorado |
| 00-0034879 | Dante Sawyer | DL | 2018 | WSH | CUT | South Carolina |
| 00-0034880 | Nathan Bazata | DL | 2018 | TB | CUT | Iowa |
| 00-0034882 | Mike Basile | DB | 2018 | NYG | CUT | Monmouth (N.J.) |
| 00-0034883 | Gerald Holmes | RB | 2018 | SEA | CUT | Michigan State |
| 00-0034884 | Bryce Canady | DB | 2018 | JAX | CUT | Florida International |
| 00-0034885 | Davond Dade | LB | 2018 | TEN | CUT | Portland State |
| 00-0034886 | Simeyon Robinson | DL | 2018 | CIN | CUT | James Madison |
| 00-0034888 | Darren Carrington | WR | 2018 | DAL | CUT | Utah |
| 00-0034889 | Austin Wolf | WR | 2018 | ARI | CUT | Akron |
| 00-0034891 | Allenzae Staggers | WR | 2018 | WSH | CUT | Southern Mississippi |
| 00-0034892 | Darius Prince | WR | 2018 | PHI | CUT | Penn State-Beaver |
| 00-0034893 | Kobe McCrary | RB | 2018 | MIN | CUT | Minnesota |
| 00-0034895 | Jacob Judd | OL | 2018 | MIN | CUT | Western Illinois |
| 00-0034896 | Jacob Ohnesorge | OL | 2018,2019 | ARI,DAL | CUT | South Dakota State |
| 00-0034897 | Connor Jessop | QB | 2018 | WSH | CUT | Shepherd |
| 00-0034898 | Jaboree Williams | LB | 2018 | PHI | CUT | Wake Forest |
| 00-0034900 | Ja'Quan Gardner | RB | 2018 | SF | CUT | Humboldt State |
| 00-0034905 | Jameer Thurman | LB | 2019 | CHI | CUT | Indiana State |
| 00-0034915 | Damon Sheehy-Guiseppi | WR | 2019 | CLE | CUT | Phoenix Coll. AZ (J.C.) |
| 00-0034916 | Andrew Ankrah | LB | 2019 | WSH | CUT | James Madison |
| 00-0034923 | B.J. Blunt | LB | 2019 | WSH | CUT | McNeese State |
| 00-0034924 | Juwann Bushell-Beatty | OL | 2019 | DAL | CUT | Michigan |
| 00-0034926 | JoJo McIntosh | DB | 2019 | WSH | CUT | Washington |
| 00-0034935 | Devontae Jackson | RB | 2019 | DEN | CUT | West Georgia |
| 00-0034938 | Brian Wallace | OL | 2019 | SEA | CUT | Arkansas |
| 00-0034950 | Ian Berryman | P | 2019 | PIT | CUT | Western Carolina |
| 00-0034965 | Ryan Davis | WR | 2019 | NE | CUT | Auburn |
| 00-0035012 | Nate Harvey | DL | 2019 | NYG | RES | East Carolina DUP->HAR805951 |
| 00-0035015 | James O'Hagan | OL | 2019 | NYG | CUT | Buffalo |
| 00-0035023 | Jamell Garcia-Williams | DL | 2019,2021 | ARI,SF | DEV | Alabama-Birmingham |
| 00-0035032 | Johnny Robinson | DL | 2019 | IND | CUT | Charleston Southern |
| 00-0035033 | Jordan Thompson | DL | 2019 | SF | CUT | Northwestern |
| 00-0035034 | Tyree Mayfield | TE | 2019 | SF | CUT | Wyoming |
| 00-0035037 | Wilton Speight | QB | 2019 | SF | CUT | UCLA |
| 00-0035038 | Dorian Baker | WR | 2019 | CLE | CUT | Kentucky |
| 00-0035041 | Brian Fineanganofo | OL | 2019 | CLE | CUT | Idaho State |
| 00-0035046 | Jarrell Owens | DL | 2019 | CLE | CUT | Oklahoma State |
| 00-0035047 | Jermaine Ponder | DB | 2019 | HOU | CUT | St. Francis (PA) |
| 00-0035049 | Anthony Stubbs | LB | 2019 | CLE | CUT | Prairie View A&M |
| 00-0035052 | Dedrick Young II | LB | 2019 | CLE | CUT | Nebraska |
| 00-0035053 | Daryle Banfield | DL | 2019 | CHI | CUT | Brown |
| 00-0035054 | John Wirtel | LS | 2019 | CHI | CUT | Kansas |
| 00-0035055 | Marquez Tucker | OL | 2019 | CHI | CUT | Southern Utah |
| 00-0035057 | Ellis Richardson | TE | 2019 | CHI | CUT | Georgia Southern |
| 00-0035063 | Matt Betts | DL | 2019,2024 | CHI,DET | CUT | Laval, Can. |
| 00-0035066 | Joe Lowery | OL | 2019 | CHI | CUT | Ohio U. |
| 00-0035069 | Clifton Duck | DB | 2019 | CHI | CUT | Appalachian State |
| 00-0035072 | Doyin Jibowu | DB | 2019 | CHI | CUT | Fort Hays State |
| 00-0035078 | Matthew Eaton | WR | 2019 | TB | CUT | Iowa State |
| 00-0035080 | Nydair Rouse | DB | 2019 | GB | CUT | West Chester |
| 00-0035081 | Javien Hamilton | DB | 2019 | GB | CUT | Mississippi |
| 00-0035088 | Davante Davis | DB | 2019 | SEA | CUT | Texas |
| 00-0035089 | Mik'Quan Deane | TE | 2019 | CLE | CUT | Western Kentucky |
| 00-0035091 | Jalen Harvey | DB | 2019 | SEA | CUT | Arizona State |
| 00-0035095 | Derrek Thomas | DB | 2019,2020 | CAR,PIT | CUT | Baylor |
| 00-0035107 | E.J. Ejiya | LB | 2019 | BAL | CUT | North Texas |
| 00-0035110 | Tito Odenigbo | DL | 2019 | MIN | CUT | Miami (Fla.) |
| 00-0035111 | Markus Jones | LB | 2019 | GB | CUT | Angelo State |
| 00-0035113 | Anree Saint-Amour | DL | 2019 | MIN | CUT | Georgia Tech |
| 00-0035122 | Silas Stewart | LB | 2019 | BAL | CUT | Incarnate Word (Tex.) |
| 00-0035123 | Koa Farmer | LB | 2019 | LV | CUT | Notre Dame |
| 00-0035134 | Tyler Roemer | OL | 2019 | LV | CUT | San Diego State |
| 00-0035138 | Ryan Anderson | P | 2019 | NYG | CUT | Rutgers |
| 00-0035158 | Gary Johnson | LB | 2019 | WSH | CUT | Texas |
| 00-0035162 | Dakari Monroe | DB | 2019 | KC | CUT | San Jose State |
| 00-0035165 | James Williams | RB | 2019 | DET | CUT | Washington State |
| 00-0035169 | Chris Nelson | DL | 2019 | TEN | CUT | Texas |
| 00-0035170 | Trevor Wood | TE | 2019 | PIT | CUT | Texas A&M |
| 00-0035171 | Cole Hedlund | K | 2019 | IND | CUT | North Texas |
| 00-0035174 | Tenny Adewusi | DB | 2019 | NYG | CUT | Delaware |
| 00-0035175 | Jhavonte Dean | DB | 2019 | PIT | CUT | Miami (Fla.) |
| 00-0035176 | Trayone Gray | RB | 2019 | CLE | CUT | Miami (Fla.) |
| 00-0035178 | Sterling Shippy | DL | 2019 | IND | CUT | Alcorn State |
| 00-0035180 | Tommy Doles | OL | 2019 | CHI | CUT | Northwestern |
| 00-0035185 | Jake Powell | TE | 2019 | NYG | CUT | Monmouth (N.J.) |
| 00-0035193 | Parker Baldwin | DB | 2019 | ATL | CUT | San Diego State |
| 00-0035194 | Shawn Bane | WR | 2019 | ATL | CUT | Northwest Missouri State |
| 00-0035195 | Yurik Bethune | LB | 2019 | ATL | CUT | Alabama A&M |
| 00-0035198 | Tre' Crawford | LB | 2019 | ATL | CUT | Alabama-Birmingham |
| 00-0035200 | Kahlil Lewis | WR | 2019 | SEA | CUT | Cincinnati |
| 00-0035201 | Chandler Miller | OL | 2019 | ATL | CUT | Tulsa |
| 00-0035203 | Jaelin Robinson | OL | 2019 | ATL | CUT | Temple |
| 00-0035204 | Durrant Miles | LB | 2019 | ATL | CUT | Boise State |
| 00-0035205 | Kyle Vasey | LS | 2019 | ATL | CUT | Penn State |
| 00-0035206 | C.J. Worton | WR | 2019 | ATL | CUT | Florida International |
| 00-0035211 | Andrew Soroh | DB | 2019 | KC | CUT | Florida Atlantic |
| 00-0035212 | Travon McMillian | RB | 2019 | PIT | CUT | Colorado |
| 00-0035224 | Dravon Askew-Henry | DB | 2019,2020 | NYG,PIT | CUT | West Virginia |
| 00-0035225 | Garrett Brumfield | OL | 2019 | PIT | CUT | LSU |
| 00-0035333 | Micah St. Andrew | OL | 2019 | DET | CUT | Fresno State |
| 00-0035335 | Ryan Anderson | OL | 2019 | NYJ | CUT | Wake Forest |
| 00-0035337 | Wesley Farnsworth | LS | 2019,2020 | MIA | CUT | Nevada |
| 00-0035348 | Cory Thomas | DL | 2019 | MIA | CUT | Mississippi State |
| 00-0035349 | Tre Watson | LB | 2019 | MIA | CUT | Maryland |
| 00-0035360 | Shane Bowman | DL | 2019 | TB | CUT | Washington |
| 00-0035361 | Tyre Brady | WR | 2019 | JAX | CUT | Marshall |
| 00-0035362 | Khairi Clark | DL | 2019 | WSH | CUT | Florida |
| 00-0035366 | Raphael Leonard | WR | 2019 | JAX | CUT | Southern Illinois |
| 00-0035372 | Bunchy Stallings | OL | 2019 | JAX | CUT | Kentucky |
| 00-0035377 | Andrew Williams | DL | 2019 | JAX | CUT | Auburn |
| 00-0035385 | DeAndre Thompkins | WR | 2019,2020 | PHI,PIT | CUT | Penn State |
| 00-0035388 | Jay Liggins | DB | 2019 | PHI | CUT | Dickinson |
| 00-0035398 | Tyree Kinnel | DB | 2019 | CIN | CUT | Michigan |
| 00-0035411 | Larry Allen Jr. | OL | 2019 | LAC | CUT | Harvard |
| 00-0035421 | Ricky Walker | DL | 2019,2020 | CLE,DAL | CUT | Virginia Tech |
| 00-0035425 | Blake Camper | OL | 2019 | LAC | CUT | South Carolina |
| 00-0035426 | Josh Corcoran | DL | 2019 | LAC | CUT | Northern Illinois |
| 00-0035429 | Reggie Howard | DL | 2019 | LAC | CUT | Toledo |
| 00-0035430 | Bradford Lemmons | DB | 2019 | LAC | CUT | Furman |
| 00-0035433 | Tyler Newsome | P | 2019 | LAC | CUT | Notre Dame |
| 00-0035435 | Rodney Randle | DB | 2019,2023 | LAC,NE | CUT | Lamar |
| 00-0035440 | Elijah Zeise | LB | 2019 | LAC | CUT | Pittsburgh |
| 00-0035441 | Corrion Ballard | DB | 2019 | CAR | CUT | Utah |
| 00-0035445 | Jesse Aniebonam | LB | 2019 | HOU | CUT | Maryland |
| 00-0035451 | Johnny Dwight | DL | 2019 | HOU | CUT | Alabama |
| 00-0035458 | Drew Lewis | LB | 2019 | NO | CUT | Colorado |
| 00-0035460 | Stephen Louis | WR | 2019 | HOU | CUT | North Carolina State |
| 00-0035461 | Chase Middleton | LB | 2019 | ATL | CUT | Georgia State |
| 00-0035476 | Dare Odeyingbo | DL | 2019 | CIN | CUT | Vanderbilt |
| 00-0035477 | Brock Ruble | OL | 2019 | TB | CUT | Toledo |
| 00-0035479 | Cortrelle Simpson | WR | 2019 | TB | CUT | Richmond |
| 00-0035488 | James Folston Jr. | LB | 2019 | GB | CUT | Pittsburgh |
| 00-0035490 | Ryan Pulley | DB | 2019 | CAR | CUT | Arkansas |
| 00-0035493 | Immanuel Turner | DL | 2019 | CIN | CUT | Louisiana Tech |
| 00-0035496 | Justin Alexandre | DL | 2019 | NYJ | CUT | Incarnate Word (Tex.) |
| 00-0035501 | Fred Jones | DL | 2019 | DET | CUT | Florida State |
| 00-0035503 | Toa Lobendahn | OL | 2019 | NYJ | CUT | USC |
| 00-0035508 | Santos Ramirez | DB | 2019 | NYJ | CUT | Arkansas |
| 00-0035509 | Trevon Sanders | DL | 2019 | NYJ | CUT | Troy |
| 00-0035511 | MyQuon Stout | DL | 2019 | NYJ | CUT | Appalachian State |
| 00-0035512 | Alex Barnes | RB | 2019 | TEN | CUT | Kansas State |
| 00-0035514 | Hamp Cheevers | DB | 2019 | ATL | CUT | Boston College |
| 00-0035517 | A.T. Hall | OL | 2019 | TEN | CUT | Stanford |
| 00-0035522 | JoJo Tillery | DB | 2019 | TEN | CUT | Wofford |
| 00-0035524 | Isaac Zico | WR | 2019 | ARI | CUT | Purdue |
| 00-0035543 | Jordan Agasiva | OL | 2019 | JAX | CUT | Utah |
| 00-0035545 | Kirk Barron | OL | 2019 | CIN | CUT | Purdue |
| 00-0035550 | Sterling Sheffield | LB | 2019 | CIN | CUT | Maine |
| 00-0035552 | Michael Colubiale | TE | 2019 | JAX | CUT | Central Florida |
| 00-0035554 | Jocquez Kalili | DB | 2019 | GB | CUT | Nevada-Las Vegas |
| 00-0035555 | Joshua Moon | DB | 2019,2021 | JAX,SEA | CUT | Georgia Southern |
| 00-0035559 | Moral Stephens | TE | 2019 | DEN | CUT | Florida |
| 00-0035561 | Abraham Wallace | DB | 2019 | BUF | CUT | West Alabama |
| 00-0035563 | Jerald Foster | OL | 2019 | WSH | CUT | Nebraska |
| 00-0035566 | Austin Maloata | DL | 2019 | WSH | CUT | Austin Peay State |
| 00-0035568 | Tyler Sigler | DB | 2019 | ARI | CUT | Wheaton |
| 00-0035569 | Dontae Strickland | RB | 2019 | ARI | CUT | Syracuse |
| 00-0035570 | Jalan McClendon | QB | 2019 | WSH | CUT | Baylor |
| 00-0035571 | Patrick Vahe | OL | 2019 | BAL | CUT | Texas |
| 00-0035575 | D'Andre Payne | DB | 2019 | TEN | CUT | Iowa State |
| 00-0035576 | LaDarius Wiley | DB | 2019 | TEN | CUT | Vanderbilt |
| 00-0035578 | Damian Prince | OL | 2019 | PIT | CUT | Maryland |
| 00-0035580 | Juwon Young | LB | 2019 | SEA | CUT | Marshall |
| 00-0035581 | David Kenney | LB | 2019 | TB | CUT | Illinois State |
| 00-0035582 | Riley Mayfield | OL | 2019 | PHI | CUT | North Texas |
| 00-0035583 | A.J. Ouellette | RB | 2019 | CLE | CUT | Ohio U. |
| 00-0035601 | Joe Horn | WR | 2019 | BAL | CUT | Missouri Western State |
| 00-0035604 | Romello Brooker | TE | 2019 | LAR | CUT | Houston |
| 00-0035606 | Matt Colburn | RB | 2019 | LAR | CUT | Wake Forest |
| 00-0035610 | Jalen Greene | WR | 2019 | LAR | CUT | Utah State |
| 00-0035612 | Vitas Hrynkiewicz | OL | 2019 | LAR | CUT | Youngstown State |
| 00-0035614 | Johnathan Lloyd | WR | 2019 | LAR | CUT | Duke |
| 00-0035618 | Boogie Roberts | DL | 2019 | LAR | CUT | San Jose State |
| 00-0035622 | Bryant Jones | DL | 2019 | LAR | CUT | Mississippi Valley State |
| 00-0035627 | Ketner Kupp | LB | 2019 | LAR | CUT | Eastern Washington |
| 00-0035635 | Floyd Allen | WR | 2019 | HOU | CUT | Mississippi |
| 00-0035675 | Isaiah Langley | DB | 2019 | IND | CUT | USC |
| 00-0035682 | Kalani Vakameilalo | DL | 2019 | JAX | CUT | Oregon State |
| 00-0035690 | Abdul Beecham | OL | 2019 | LAR | CUT | Kansas State |
| 00-0035691 | Josh Caldwell | RB | 2019 | CHI | CUT | Northwest Missouri State |
| 00-0035706 | Jamarius Way | WR | 2019 | DEN | CUT | South Alabama |
| 00-0035712 | Lo Falemaka | OL | 2019 | CLE | RES | Utah DUP->FAL374501 |
| 00-0035721 | Jawuan Johnson | LB | 2019 | SEA | CUT | Texas Christian |
| 00-0035722 | John Yarbrough | OL | 2019 | CAR | CUT | Richmond |
| 00-0035723 | Vincent Testaverde | QB | 2019 | TB | CUT | Albany |
| 00-0035724 | Martez Ivey | OL | 2019,2021 | CAR,NE | CUT | Florida |
| 00-0035730 | Nyqwan Murray | WR | 2019 | SEA | CUT | Florida State |
| 00-0035731 | Patrick Lawrence | OL | 2019 | ARI | CUT | Baylor |
| 00-0035732 | Jackson Harris | TE | 2019 | SEA | CUT | Georgia |
| 00-0035733 | Joe Walker | WR | 2019 | CHI | CUT | Delaware |
| 00-0035737 | DeJuan Neal | DB | 2019,2022 | WSH | CUT | Shepherd |
| 00-0035738 | Thomas Costigan | DL | 2019 | LAC | CUT | Bryant University |
| 00-0035740 | Micky Crum | TE | 2019 | PIT | CUT | Louisville |
| 00-0035744 | Quart'e Sapp | LB | 2019 | TEN | CUT | Tennessee |
| 00-0035745 | Marquis Young | RB | 2019 | IND | CUT | Massachusetts |
| 00-0035746 | Fisayo Awolaja | OL | 2019 | NO | CUT | Northern Colorado |
| 00-0035747 | Bryson Allen-Williams | LB | 2019 | LV | CUT | South Carolina |
| 00-0035748 | Jordan Holland | DB | 2019 | SF | CUT | Prairie View A&M |
| 00-0035749 | Logan Tago | DL | 2019 | SEA | CUT | Washington State |
| 00-0035765 | Trey Dishon | DL | 2020 | CIN | CUT | Kansas State |
| 00-0035767 | Marcel Spears Jr. | LB | 2020 | CIN | CUT | Iowa State |
| 00-0035773 | Cam Sutton | TE | 2021 | SEA | DEV | Fresno State |
| 00-0035775 | Hinwa Allieu | DL | 2020 | ATL | CUT | Nebraska-Kearney |
| 00-0035781 | Justin Gooseberry | OL | 2020 | ATL | CUT | Rice |
| 00-0035785 | Sailosi Latu | DL | 2020 | ATL | CUT | San Jose State |
| 00-0035786 | Jalen McCleskey | WR | 2020 | ATL | CUT | Tulane |
| 00-0035792 | Bryson Young | LB | 2021 | ARI | CUT | Oregon |
| 00-0035793 | Mikey Daniel | RB | 2020 | ATL | CUT | South Dakota State |
| 00-0035798 | Clay Cordasco | OL | 2020 | CIN | CUT |  |
| 00-0035834 | Marvelle Ross | WR | 2020 | JAX | CUT | Notre Dame College, Ohio |
| 00-0035847 | Bryce Sterk | TE | 2020 | CIN | CUT | Montana State |
| 00-0035854 | Travis Reed | DB | 2020 | IND | CUT | South Alabama |
| 00-0035855 | Donald Rutledge | DB | 2020 | IND | CUT | Georgia Southern |
| 00-0035866 | Hunter Watts | OL | 2020 | DEN | CUT | Central Arkansas |
| 00-0035888 | Justice Shelton-Mosley | WR | 2020 | KC | CUT | Vanderbilt |
| 00-0035894 | Christian Montano | OL | 2021 | NO | CUT | Tulane |
| 00-0035902 | Joshua Dunlop | OL | 2020 | LAC | CUT | Texas-San Antonio |
| 00-0035905 | Bobby Holly | RB | 2020 | LAC | CUT | Louisiana Tech |
| 00-0035907 | Kevin McGill | DB | 2020 | LAC | CUT | Eastern Michigan |
| 00-0035909 | Ryan Roberts | OL | 2020 | LAC | CUT | Florida State |
| 00-0035915 | Jake Benzinger | OL | 2021 | TB | CUT | Wake Forest |
| 00-0035919 | Steven Gonzalez | OL | 2020 | ARI | CUT | Penn State |
| 00-0035931 | Earnest Edwards | WR | 2020 | LAR | CUT | Maine |
| 00-0035936 | Bryan London | LB | 2020 | LAR | CUT |  |
| 00-0035937 | Josh Love | QB | 2021 | CAR | DEV | San Jose State DUP->LOV131275 |
| 00-0035955 | David Reese II | LB | 2020 | MIN | CUT | Florida |
| 00-0035977 | Nevelle Clarke | DB | 2020,2023 | MIN,PIT | CUT | Central Florida |
| 00-0035980 | Jordan Fehr | LB | 2020 | MIN | CUT |  |
| 00-0035983 | Jake Lacina | OL | 2020 | MIN | CUT | Augustana, S.D. |
| 00-0035990 | Debione Renfro | DB | 2020 | SEA | CUT | Texas A&M |
| 00-0035996 | Manasseh Bailey | WR | 2020 | LAC | DEV | Morgan State |
| 00-0036009 | Jeremiah Dinson | DB | 2020 | DET | CUT |  |
| 00-0036038 | Romeo Finley | LB | 2020 | LAC | CUT | Miami |
| 00-0036055 | Seth Dawkins | WR | 2020 | SEA | CUT | Louisville |
| 00-0036071 | Dylan Stapleton | TE | 2020 | HOU | CUT | James Madison |
| 00-0036074 | Michael Dereus | WR | 2020 | BAL | CUT | Georgetown, D.C. |
| 00-0036075 | Sean Pollard | OL | 2020 | BAL | CUT |  |
| 00-0036097 | Kyahva Tezino | LB | 2023,2024 | PIT,SF | CUT | San Diego State |
| 00-0036098 | Jeff Thomas | WR | 2020 | NE | NWT | Miami |
| 00-0036108 | Solomon Ajayi | LB | 2020 | CLE | CUT | Liberty |
| 00-0036112 | Kevin Davidson | QB | 2020 | CLE | CUT | Princeton |
| 00-0036141 | Johnathon Johnson | WR | 2020 | WSH | CUT | Missouri DUP->JOH382488 |
| 00-0036146 | George Campbell | WR | 2020 | NYJ | CUT | West Virginia |
| 00-0036153 | Sterling Johnson | DL | 2020 | NYJ | CUT |  |
| 00-0036169 | Siaosi Mariner | WR | 2021 | BAL | CUT | Utah State |
| 00-0036174 | Khaylan Kearse-Thomas | LB | 2020 | TEN | NWT |  |
| 00-0036179 | Cameron Scarlett | RB | 2020 | TEN | NWT | Stanford |
| 00-0036200 | Dustin Woodard | OL | 2020 | NE | RES | Memphis |
| 00-0036207 | Trevon McSwain | DL | 2020 | CHI | CUT | Duke |
| 00-0036211 | Ahmad Wagner | WR | 2020 | CHI | CUT | Kentucky |
| 00-0036467 | Darius Clark | RB | 2021 | CAR | CUT | Newberry |
| 00-0036468 | Kai Locksley | QB | 2021 | MIA | DEV | Texas-El Paso |
| 00-0036475 | Darece Roberson | WR | 2021 | SEA | DEV | Wayne State, Mich. |
| 00-0036477 | Shaq Smith | LB | 2021 | NO | CUT | Maryland |
| 00-0036478 | Evan Heim | OL | 2021 | DET | DEV | Minn. State-Mankato |
| 00-0036484 | Alex Hoffman | OL | 2021 | NO | RET | Carroll, Mont. |
| 00-0036494 | Isaiah Kaufusi | LB | 2021 | IND | DEV | Brigham Young |
| 00-0036499 | Corey Straughter | DB | 2021 | JAX | DEV | Louisiana-Monroe |
| 00-0036516 | Jordyn Peters | DB | 2021 | NYG | DEV | Auburn |
| 00-0036524 | Max Richardson | LB | 2021 | LV | CUT | Boston College |
| 00-0036525 | Darius Stills | DL | 2021 | KC | RES | West Virginia |
| 00-0036532 | Lamont Wade | DB | 2021 | PIT | DEV | Penn State |
| 00-0036533 | Jamar Watson | LB | 2021 | PIT | DEV | Kentucky |
| 00-0036547 | Eric Burrell | DB | 2021 | NO | CUT | Wisconsin |
| 00-0036548 | Stevie Scott | RB | 2021,2023 | ARI,DEN | CUT | Indiana |
| 00-0036581 | Xavier Kelly | DL | 2021 | BAL | RES | Arkansas DUP->KEL755800 |
| 00-0036594 | Jaytlin Askew | DB | 2021 | MIA | DEV | Georgia Tech |
| 00-0036601 | Brontae Harris | DB | 2021 | LAR | DEV | Alabama-Birmingham |
| 00-0036602 | Jeremiah Haydel | WR | 2021 | LAR | DEV | Texas State |
| 00-0036609 | Jake Burton | OL | 2021,2024 | DET,NYG | CUT | Baylor |
| 00-0036680 | Marlon Character | DB | 2021 | KC | CUT | Louisville |
| 00-0036687 | Emmanuel Rugamba | DB | 2021 | CLE | CUT | Miami, O. |
| 00-0036694 | Chandon Herring | OL | 2021 | TEN | CUT | Brigham Young |
| 00-0036702 | Scooter Harrington | TE | 2021 | CHI | CUT | Stanford |
| 00-0036707 | Khalil McClain | WR | 2021 | MIA | CUT | Troy |
| 00-0036709 | Dionte Ruffin | DB | 2021 | CHI | CUT | Western Kentucky |
| 00-0036712 | Gunnar Vogel | OL | 2021 | CIN | DEV | Northwestern |
| 00-0036713 | Darius Harper | OL | 2021 | LAC | DEV | Cincinnati |
| 00-0036737 | JaQuan Bailey | DL | 2021 | PHI | CUT | Iowa State |
| 00-0036751 | Dedrick Mills | RB | 2021 | DET | DEV | Nebraska |
| 00-0036771 | Brenden Knox | RB | 2021 | KC | RES | Marshall |
| 00-0036772 | Artayvious Lynn | TE | 2021 | DAL | CUT | Texas Christian |
| 00-0036778 | Jared Goldwire | DL | 2021 | LAC | RET | Louisville |
| 00-0036790 | Christian Uphoff | DB | 2021 | GB | CUT | Illinois State |
| 00-0036791 | Deuce Wallace | DB | 2021 | NO | CUT | Louisiana-Lafayette |
| 00-0036794 | Aashari Crosswell | DB | 2021 | SEA | DEV | Arizona State |
| 00-0036806 | Cary Angeline | TE | 2021 | PHI | CUT | North Carolina State |
| 00-0036809 | Cam Murray | DL | 2021 | ARI | CUT | Oklahoma State |
| 00-0036814 | Zeandae Johnson | DL | 2021 | MIN | DEV | California |
| 00-0036823 | Zac Dawe | DL | 2021 | ATL | CUT | Brigham Young |
| 00-0036834 | Antonio Nunn | WR | 2021 | ATL | CUT | Buffalo |
| 00-0036835 | J.R. Pace | DB | 2021 | ATL | CUT | Northwestern |
| 00-0036840 | Erroll Thompson | LB | 2021 | ATL | CUT | Mississippi State |
| 00-0036864 | Lorenzo Neal | DL | 2021 | KC | RES | Purdue |
| 00-0036911 | Jovan Swann | DL | 2021 | BAL | CUT | Indiana |
| 00-0036958 | Willie Yarbary | DL | 2021 | LAC | CUT | Wake Forest |
| 00-0037023 | K.J. Sails | DB | 2021 | LAC | CUT | South Florida |
| 00-0037029 | Devonte Dedmon | WR | 2022 | MIA | CUT | William &amp; Mary |
| 00-0037032 | Brayden Lenius | TE | 2022 | ATL | CUT | New Mexico |
| 00-0037033 | Brandin Dandridge | DB | 2022 | KC | CUT | Missouri Western |
| 00-0037036 | Mark Vital | TE | 2022 | KC | CUT | Baylor DUP->VIT313230 |
| 00-0037044 | Marcus Santos-Silva | TE | 2022 | CLE | CUT | Texas Tech |
| 00-0037045 | Jake Dixon | OL | 2022 | PIT | CUT | Duquesne |
| 00-0037047 | T.D. Moultry | LB | 2022 | PIT | INA | Auburn |
| 00-0037048 | Chris Owens | OL | 2022 | PIT | CUT | Alabama |
| 00-0037058 | Caesar Williams | DB | 2022 | LAR | CUT | Wisconsin |
| 00-0037059 | Jamal Pettigrew | TE | 2022 | LAR | CUT | McNeese State |
| 00-0037060 | Tyree Johnson | DL | 2022 | PIT | INA | Texas A&amp;M |
| 00-0037063 | Grayson Gunter | TE | 2022 | JAX | CUT | Southern Mississippi |
| 00-0037065 | Andrew Mevis | K | 2022 | JAX | CUT | Iowa State |
| 00-0037071 | Lujuan Winningham | WR | 2022 | JAX | CUT | Central Arkansas |
| 00-0037072 | Shabari Davis | DB | 2022 | JAX | CUT | Southeast Missouri |
| 00-0037101 | C.J. Avery | LB | 2022 | CHI | ACT | Louisville |
| 00-0037104 | Allie Green | DB | 2022 | CHI | ACT | Missouri |
| 00-0037114 | Kevin Shaa | WR | 2022 | CHI | CUT | Liberty |
| 00-0037116 | Caliph Brice | LB | 2022 | GB | CUT | Florida Atlantic |
| 00-0037117 | Ellis Brooks | LB | 2022 | GB | CUT | Penn State |
| 00-0037118 | Akial Byers | DL | 2022 | GB | CUT | Missouri |
| 00-0037119 | Danny Davis | WR | 2022 | GB | CUT | Wisconsin |
| 00-0037123 | Chauncey Manac | LB | 2022 | GB | CUT | Louisiana-Lafayette |
| 00-0037125 | Hauati Pututau | DL | 2022 | GB | CUT | Utah |
| 00-0037126 | Cole Schneider | OL | 2022,2023 | GB | CUT | Central Florida |
| 00-0037127 | Tre Sterling | DB | 2022 | GB | CUT | Oklahoma State |
| 00-0037128 | Raleigh Texada | DB | 2022 | GB | CUT | Baylor |
| 00-0037135 | Ali Fayad | DL | 2022 | PHI | CUT | Western Michigan |
| 00-0037143 | Cade Brewer | TE | 2022 | SEA | CUT | Texas |
| 00-0037144 | Shamarious Gilmore | OL | 2022 | SEA | CUT | Georgia State |
| 00-0037151 | Josh Valentine-Turner | DB | 2022 | SEA | CUT | Florida International |
| 00-0037154 | Tay Williams | DB | 2022 | SEA | CUT | Nebraska |
| 00-0037159 | Keshunn Abram | WR | 2022 | NYJ | CUT | Kent State |
| 00-0037160 | De'Vante Cross | DB | 2022 | GB | CUT | Virginia |
| 00-0037161 | Josh Drayden | DB | 2022 | WSH | CUT | California |
| 00-0037162 | Jequez Ezzard | WR | 2022 | WSH | CUT | Sam Houston State |
| 00-0037165 | Cole Kelley | QB | 2022 | WSH | CUT | Southeastern Louisiana |
| 00-0037166 | Jacub Panasiuk | DL | 2022 | WSH | CUT | Michigan State |
| 00-0037169 | Devin Taylor | DB | 2022 | WSH | CUT | Bowling Green |
| 00-0037170 | Tre Walker | LB | 2022 | WSH | CUT | Idaho |
| 00-0037176 | Trevon Clark | WR | 2022 | BAL | CUT | California |
| 00-0037178 | Zakoby McClain | LB | 2022 | BAL | CUT | Auburn |
| 00-0037187 | Devon Williams | WR | 2022 | BAL | CUT | Oregon |
| 00-0037189 | Denzel Williams | DB | 2022 | BAL | CUT | Villanova |
| 00-0037200 | Jake Julien | P | 2022 | NE | CUT | Eastern Michigan |
| 00-0037209 | Dustin Crum | QB | 2022 | KC | CUT | Kent State |
| 00-0037211 | Tayon Fleet-Davis | RB | 2022 | KC | CUT | Maryland |
| 00-0037212 | Nasir Greer | DB | 2022 | KC | CUT | Wake Forest |
| 00-0037215 | Mike Rose | LB | 2022,2024 | KC,NO | CUT | Iowa State |
| 00-0037217 | Christian Albright | LB | 2022 | CHI | ACT | Ball State |
| 00-0037218 | Jon Alexander | DB | 2022 | CHI | CUT | North Carolina-Charlotte |
| 00-0037219 | Antonio Ortiz | LS | 2022 | CHI | ACT | Texas Christian |
| 00-0037220 | De'Montre Tuggle | RB | 2022 | CHI | CUT | Ohio |
| 00-0037223 | Carson Taylor | DL | 2022 | CHI | CUT | Northern Arizona |
| 00-0037226 | Mataeo Durant | RB | 2022 | PIT | CUT | Duke |
| 00-0037227 | Jordan Tucker | OL | 2022 | PIT | CUT | North Carolina |
| 00-0037335 | Travell Harris | WR | 2022 | CLE | CUT | Washington State |
| 00-0037338 | Silas Kelly | LB | 2022 | CLE | CUT | Coastal Carolina |
| 00-0037339 | Glen Logan | DL | 2022 | CLE | CUT | Louisiana State |
| 00-0037342 | Ben Petrula | OL | 2022 | CLE | CUT | Boston College |
| 00-0037345 | Blaise Andries | OL | 2022 | MIA | CUT | Minnesota |
| 00-0037350 | Elijah Hamilton | DB | 2022,2023 | GB,MIA | CUT | Louisiana Tech |
| 00-0037351 | Tommy Heatherly | P | 2022 | MIA | CUT | Florida International |
| 00-0037352 | Deandre Johnson | LB | 2022,2023 | GB,MIA | RES | Miami |
| 00-0037358 | Jordan Williams | DL | 2022 | MIA | CUT | Virginia Tech |
| 00-0037365 | Andrew Parchment | WR | 2022 | CAR | CUT | Florida State |
| 00-0037367 | Khalan Tolson | LB | 2022 | CAR | CUT | Illinois |
| 00-0037371 | Jabari Ellis | DL | 2022 | NYG | CUT | South Carolina |
| 00-0037374 | Jeremiah Hall | TE | 2022 | NYG | CUT | Oklahoma |
| 00-0037376 | Josh Rivas | OL | 2022 | NYG | CUT | Kansas State |
| 00-0037388 | Kadofi Wright | LB | 2022 | DEN | CUT | Buffalo |
| 00-0037389 | Max Borghi | RB | 2022 | PIT | CUT | Washington State |
| 00-0037390 | Jack Coan | QB | 2022 | IND | CUT | Notre Dame |
| 00-0037391 | Kekoa Crawford | WR | 2022 | IND | CUT | California |
| 00-0037397 | Alex Mollette | OL | 2023 | DET | CUT | Marshall |
| 00-0037398 | Samson Nacua | WR | 2022,2024 | IND,NO | CUT | Brigham Young |
| 00-0037399 | Scott Patchan | DL | 2022 | IND | CUT | Colorado State |
| 00-0037402 | Josh Seltzner | OL | 2022 | IND | CUT | Wisconsin |
| 00-0037403 | James Skalski | LB | 2022 | IND | CUT | Clemson |
| 00-0037405 | C.J. Verdell | RB | 2022 | IND | CUT | Oregon |
| 00-0037407 | Cullen Wick | DL | 2022 | IND | CUT | Tulsa |
| 00-0037416 | Jaivon Heiligh | WR | 2022 | CIN | CUT | Coastal Carolina |
| 00-0037417 | Clarence Hicks | LB | 2022 | CIN | CUT | Texas-San Antonio |
| 00-0037419 | Shermari Jones | RB | 2022 | CIN | CUT | Coastal Carolina |
| 00-0037423 | Brendan Radley-Hiles | DB | 2022 | CIN | CUT | Washington |
| 00-0037425 | Jack Sorenson | WR | 2022 | CIN | CUT | Miami, O. |
| 00-0037426 | Tariqious Tisdale | DL | 2022 | CIN | CUT | Mississippi |
| 00-0037427 | Carson Wells | LB | 2022,2023 | CIN,NE | CUT | Colorado |
| 00-0037430 | Travon Fuller | DB | 2022 | BUF | CUT | Tulsa |
| 00-0037432 | Derek Kerstetter | OL | 2022 | BUF | CUT | Texas |
| 00-0037434 | Neil Pau'u | WR | 2022 | BUF | CUT | Brigham Young |
| 00-0037438 | Cedric Boswell | DB | 2022 | DET | CUT | Miami, O. |
| 00-0037439 | Derrick Deese | TE | 2022 | DET | DEV | San Jose State |
| 00-0037444 | Corey Sutton | WR | 2022 | DET | RET | Appalachian State |
| 00-0037446 | Jermaine Waller | DB | 2022 | DET | RET | Virginia Tech |
| 00-0037453 | Damion Daniels | DL | 2022 | HOU | CUT | Nebraska |
| 00-0037462 | Nolan Givan | TE | 2022 | DET | CUT | Southeastern Louisiana |
| 00-0037463 | Zein Obeid | OL | 2022 | DET | RET | Ferris State |
| 00-0037465 | Trevon Bradford | WR | 2022 | LAC | CUT | Oregon State |
| 00-0037466 | Leddie Brown | RB | 2022 | LAC | CUT | West Virginia |
| 00-0037467 | Erik Krommenhoek | TE | 2022 | LAC | CUT | Southern California |
| 00-0037470 | Kevin Marks | RB | 2022 | LAC | CUT | Buffalo |
| 00-0037472 | Brandon Peters | QB | 2022 | LAC | CUT | Illinois |
| 00-0037473 | Brandon Sebastian | DB | 2022 | LAC | CUT | Boston College |
| 00-0037476 | Skyler Thomas | DB | 2022 | LAC | CUT | Liberty |
| 00-0037479 | Curtis Blackwell | OL | 2022 | TB | CUT | Ball State |
| 00-0037489 | Jordan Young | LB | 2022 | TB | CUT | Old Dominion |
| 00-0037490 | Ben Beise | TE | 2022 | TB | CUT | Wisconsin-River Falls |
| 00-0037498 | Tyarise Stevenson | DL | 2022 | MIN | CUT | Tulsa |
| 00-0037502 | Abu Daramy-Swaray | DB | 2022 | CIN | CUT | Colgate |
| 00-0037504 | Qwynnterrio Cole | DB | 2022 | LV | CUT | Louisville |
| 00-0037508 | Justin Hall | WR | 2022,2024 | LV,MIN | CUT | Ball State |
| 00-0037510 | Malkelm Morrison | DB | 2022 | LV | RET | Army |
| 00-0037511 | Bam Olaseni | OL | 2022 | LV | DEV | Utah |
| 00-0037518 | Will Adams | DB | 2022 | WSH | CUT | Virginia State |
| 00-0037519 | Kevin Atkins | DL | 2022,2023 | NYG,SF | CUT | Fresno State |
| 00-0037520 | Jeremiah Gemmel | LB | 2022 | DEN | CUT | North Carolina |
| 00-0037523 | Taysir Mack | WR | 2022 | SF | ACT | Pittsburgh |
| 00-0037528 | Leon O'Neal | DB | 2022 | SF | ACT | Texas A&amp;M |
| 00-0037531 | Dohnovan West | OL | 2022,2025 | ARI,SF | CUT | Arizona State |
| 00-0037534 | Joel Dublanko | LB | 2022 | SEA | CUT | Cincinnati |
| 00-0037541 | Isaiah Pryor | DB | 2022 | NO | CUT | Notre Dame |
| 00-0037543 | Derek Schweiger | OL | 2022 | NO | CUT | Iowa State |
| 00-0037546 | Abram Smith | RB | 2022,2023 | MIN,NO | CUT | Baylor |
| 00-0037555 | JaVonta Payton | WR | 2022 | ARI | DEV | Tennessee |
| 00-0037566 | Ty Fryfogle | WR | 2022,2023 | KC | CUT | Indiana |
| 00-0037567 | Jonathan Garibay | K | 2022 | DAL | CUT | Texas Tech |
| 00-0037568 | Aaron Hansford | LB | 2022 | DAL | CUT | Texas A&amp;M |
| 00-0037575 | Amon Simon | OL | 2022 | DAL | CUT | Texas A&amp;M-Commerce |
| 00-0037586 | Tyshaun James | WR | 2022 | ATL | CUT | Central Connecticut State |
| 00-0037588 | Bryce Rodgers | DL | 2022 | ATL | CUT | California-Davis |
| 00-0037595 | Haskell Garrett | DL | 2022 | TEN | CUT | Ohio State |
| 00-0037597 | Michael Griffin | DB | 2022 | TEN | CUT | South Dakota State |
| 00-0037599 | Brandon Lewis | WR | 2022 | TEN | CUT | Air Force |
| 00-0037623 | Nijuel Hill | DB | 2022 | WSH | CUT | Delaware |
| 00-0037624 | Bryce Notree | LB | 2022 | WSH | CUT | Southern Illinois |
| 00-0037626 | Kameron Brown | WR | 2022 | TB | CUT | Coastal Carolina |
| 00-0037630 | Keric Wheatfall | WR | 2022 | PHI | CUT | Fresno State |
| 00-0037635 | Jairon McVea | DB | 2022 | LAR | CUT | Baylor |
| 00-0037636 | Jack Snyder | OL | 2022,2023 | LAR,MIN | CUT | San Jose State |
| 00-0037642 | Naz Bohannon | TE | 2022 | JAX | CUT | Clemson |
| 00-0037646 | Tyler Snead | WR | 2022 | PIT | CUT | East Carolina |
| 00-0037647 | Kenneth George | DB | 2022 | TEN | CUT | Tennessee |
| 00-0037648 | Ryan McDaniel | WR | 2022 | JAX | CUT | North Carolina Central |
| 00-0037651 | Greg Long | OL | 2022 | ARI | CUT | Purdue |
| 00-0037652 | T.J. Pledger | RB | 2022 | ARI | CUT | Utah |
| 00-0037653 | Jared Smart | WR | 2022 | ARI | CUT | Hawaii |
| 00-0037655 | Tre Webb | DB | 2022 | ATL | CUT | Montana State |
| 00-0037656 | Ross Reiter | LS | 2022 | NE | CUT | Colorado State |
| 00-0037657 | Elijah Jones | DB | 2022 | SEA | CUT | Oregon State |
| 00-0037668 | Daniel Joseph | DL | 2022 | BUF | CUT | North Carolina State |
| 00-0037750 | Josh Black | DL | 2022 | NO | CUT | Syracuse |
| 00-0037806 | Diego Fagot | LB | 2022,2023 | BAL,NE | RES | Navy |
| 00-0037820 | Drew Jordan | DL | 2022 | CAR | DEV | Michigan State |
| 00-0037824 | Khalique Washington | OL | 2022 | NO | CUT | Southern Mississippi |
| 00-0038044 | Caeveon Patton | DL | 2022,2023 | ATL,IND | CUT | Texas State |
| 00-0038146 | Nate Wieland | LB | 2022 | NE | CUT | Grand View |
| 00-0038148 | Corey Dublin | OL | 2022 | CHI | CUT | Tulane |
| 00-0038151 | Tyrell Ford | DB | 2023 | GB | CUT | Waterloo, Can. |
| 00-0038199 | Ryan Nelson | OL | 2025 | LAC | CUT |  |
| 00-0038253 | Antwuan Jackson | DL | 2023 | CAR | CUT | Ohio State |
| 00-0038295 | Willie Taylor | LB | 2023 | JAX | CUT | Eastern Kentucky |
| 00-0038297 | Malik Fisher | DL | 2024 | HOU | CUT | Villanova |
| 00-0038309 | Keonte Schad | DL | 2024 | GB | CUT | Oregon State |
| 00-0038325 | Alex Matheson | LS | 2023 | LAR | DEV | California Lutheran DUP->MAT090108 |
| 00-0038356 | Tyler Hudson | WR | 2023 | LAR | CUT | Louisville |
| 00-0038361 | Tyon Davis | DB | 2023 | LAR | CUT | Tulsa |
| 00-0038365 | Braxton Burmeister | QB | 2023 | LAR | CUT | San Diego State |
| 00-0038369 | Jordan Jones | DB | 2023 | LAR | CUT | Rhode Island |
| 00-0038370 | Ryan Smenda | LB | 2023 | LAR | CUT | Wake Forest |
| 00-0038371 | Jaiden Woodbey | LB | 2023 | LAR | CUT | Boston College |
| 00-0038384 | Sean Maginn | OL | 2023 | LAR | CUT | Wake Forest |
| 00-0038422 | Aron Cruickshank | WR | 2023 | PIT | CUT | Rutgers |
| 00-0038424 | Bobby Haskins | OL | 2023 | CHI | CUT | Southern California |
| 00-0038425 | Gabe Houy | OL | 2023 | CHI | RES | Pittsburgh |
| 00-0038430 | Cody Chrest | WR | 2023 | GB | CUT | Sam Houston State |
| 00-0038432 | Emil Ekiyor | OL | 2023 | IND | CUT | Alabama |
| 00-0038433 | Darius Hagans | RB | 2023 | PIT | CUT | Virginia State |
| 00-0038434 | Johnny King | WR | 2023 | PHI | CUT | Southeast Missouri |
| 00-0038439 | Caleb Sampson | DL | 2023 | IND | CUT | Kansas |
| 00-0038445 | Trey Botts | DL | 2023 | BAL | CUT | Colorado State-Pueblo |
| 00-0038446 | Kai Caesar | DL | 2023 | BAL | CUT | Ohio |
| 00-0038453 | Corey Mayfield | DB | 2023 | BAL | CUT | Texas-San Antonio |
| 00-0038460 | Jake Guidone | OL | 2023 | BAL | CUT | Connecticut |
| 00-0038461 | Kelle Sanders | LB | 2023 | BAL | CUT | Alabama-Birmingham |
| 00-0038464 | Chuck Filiaga | OL | 2023,2024 | MIN,NO | CUT | Minnesota |
| 00-0038466 | Jason Lewan | DL | 2023 | GB | CUT | Illinois State |
| 00-0038467 | Camren McDonald | TE | 2023 | LAR | CUT | Florida State |
| 00-0038469 | Jimmy Phillips | LB | 2023 | GB | CUT | Southern Methodist |
| 00-0038473 | Habakkuk Baldonado | DL | 2023 | NYG | CUT | Pittsburgh |
| 00-0038478 | Gemon Green | DB | 2023,2024 | GB,NYG | CUT | Michigan |
| 00-0038481 | Cameron Lyons | LS | 2023,2024 | CHI,NYG | CUT | North Carolina-Charlotte |
| 00-0038483 | Jadon Haselwood | WR | 2023 | PHI | CUT | Arkansas |
| 00-0038485 | Chim Okorafor | OL | 2023,2024 | CLE,MIN | CUT | Benedictine, Kan. |
| 00-0038486 | Trevor Reid | OL | 2023,2024 | ATL,MIN | RES | Louisville |
| 00-0038495 | Travis Dye | RB | 2023 | NYJ | CUT | Southern California |
| 00-0038501 | Derrick Langford | DB | 2023 | NYJ | CUT | Washington State |
| 00-0038503 | Marquis Waters | DB | 2023 | NYJ | CUT | Texas Tech |
| 00-0038510 | Anthony Cook | DB | 2023 | KC | CUT | Texas |
| 00-0038517 | Isaiah Norman | DB | 2023 | KC | CUT | Marshall |
| 00-0038520 | Ty Scott | WR | 2023,2024 | KC,SEA | DEV | Missouri State |
| 00-0038524 | D'Anthony Jones | DL | 2023 | CHI | CUT | Houston |
| 00-0038525 | Josh Lugg | OL | 2023 | CHI | CUT | Notre Dame |
| 00-0038526 | Bralen Trahan | DB | 2023 | CHI | CUT | Louisiana-Lafayette |
| 00-0038528 | Broughton Hatcher | LS | 2023 | GB | RES | Old Dominion |
| 00-0038530 | Antonio Moultrie | DL | 2023 | GB | CUT | Miami |
| 00-0038531 | Tyler Adams | WR | 2023 | IND | CUT | Butler |
| 00-0038532 | Kody Case | WR | 2023 | IND | CUT | Illinois |
| 00-0038533 | Matthew Vanderslice | OL | 2023 | IND | CUT | Northern Iowa |
| 00-0038534 | Jamal Woods | DL | 2023 | MIA | CUT | Illinois |
| 00-0038539 | Bumper Pool | LB | 2023 | CAR | CUT | Arkansas |
| 00-0038631 | Raymond Vohasek | DL | 2023 | JAX | CUT | North Carolina |
| 00-0038650 | Brad Cecil | OL | 2023 | DET | CUT | South Florida |
| 00-0038659 | Zach Morton | DL | 2024 | GB | CUT | Akron |
| 00-0038670 | Samuel Jackson | OL | 2023,2025 | JAX,NYJ | CUT | Central Florida |
| 00-0038672 | Oliver Martin | WR | 2023 | JAX | CUT | Nebraska |
| 00-0038675 | D.J. Dale | DL | 2023 | BUF | CUT | Alabama |
| 00-0038683 | James Blackman | QB | 2023 | MIA | CUT | Arkansas State |
| 00-0038686 | Randy Charlton | DL | 2023 | MIA | CUT | Mississippi State |
| 00-0038687 | Chris Coleman | WR | 2023 | MIA | CUT | Cal Poly |
| 00-0038688 | Daewood Davis | WR | 2023 | MIA | CUT | Western Kentucky |
| 00-0038691 | Aubrey Miller | LB | 2023 | MIA | CUT | Jackson State |
| 00-0038692 | Anthony Montalvo | DL | 2023 | WSH | CUT | Central Florida |
| 00-0038706 | Joel Honigford | TE | 2023 | ARI | CUT | Michigan |
| 00-0038707 | Marvin Pierre | LB | 2023 | GB | CUT | Kent State |
| 00-0038709 | Kyle Soelle | LB | 2023 | ARI | CUT | Arizona State |
| 00-0038712 | Caleb Biggers | DB | 2023 | CLE | CUT | Boise State |
| 00-0038713 | Thomas Greaney | TE | 2023 | CLE | CUT | Albany, N.Y. |
| 00-0038721 | Tyler Beach | OL | 2023,2024 | HOU,PIT | CUT | Wisconsin |
| 00-0038725 | Darius Joiner | DB | 2023 | HOU | CUT | Duke |
| 00-0038730 | Jose Barbon | WR | 2023 | DAL | CUT | Temple |
| 00-0038733 | Myles Brooks | DB | 2023 | DAL | CUT | Louisiana Tech |
| 00-0038743 | Jordan Byrd | RB | 2023 | PIT | CUT | San Diego State |
| 00-0038745 | James Nyamwaya | DL | 2023 | PIT | CUT | Merrimack |
| 00-0038747 | Monte Pottebaum | LB | 2023 | PIT | RET | Iowa |
| 00-0038754 | Cam Bright | LB | 2023 | CLE | CUT | Washington |
| 00-0038755 | Arquon Bush | DB | 2023 | SEA | CUT | Cincinnati |
| 00-0038757 | Robert Cooper | DL | 2023,2024 | MIA,PHI | CUT | Florida State |
| 00-0038759 | John Hall | WR | 2023 | SEA | CUT | Northwood, Mich. |
| 00-0038767 | Kendall Randolph | OL | 2023 | SEA | CUT | Alabama |
| 00-0038771 | Jacob Sykes | DL | 2023,2025 | PHI,SEA | DEV | UCLA |
| 00-0038777 | Camerun Peoples | RB | 2023 | CAR | CUT | Appalachian State |
| 00-0038779 | Colby Richardson | DB | 2023 | DET | CUT | Louisiana State |
| 00-0038780 | Josh Vann | WR | 2023 | CAR | CUT | South Carolina |
| 00-0038784 | Seth Benson | LB | 2023 | DEN | CUT | Iowa |
| 00-0038789 | Taylor Grimes | WR | 2023 | DEN | CUT | Incarnate Word |
| 00-0038798 | Alan Ali | OL | 2023 | MIN | CUT | Texas Christian |
| 00-0038799 | Calvin Avery | DL | 2023 | MIN | CUT | Illinois |
| 00-0038802 | Jacky Chen | OL | 2023 | HOU | CUT | Pace |
| 00-0038804 | Wilson Huber | LB | 2023 | MIN | CUT | Cincinnati |
| 00-0038808 | Jack Podlesny | K | 2024 | GB | INA | Georgia |
| 00-0038814 | Taye Barber | WR | 2023 | TB | CUT | Texas Christian |
| 00-0038816 | Ronnie Brown | RB | 2023 | TB | CUT | Shepherd |
| 00-0038825 | Chris Murray | OL | 2023 | TB | CUT | Oklahoma |
| 00-0038829 | Kade Warner | WR | 2023 | TB | CUT | Kansas State |
| 00-0038831 | Zion Bowens | WR | 2023 | WSH | CUT | Hawaii |
| 00-0038837 | Kendall Smith | DB | 2023 | WSH | CUT | Illinois |
| 00-0038838 | D.J. Stirgus | DB | 2023 | WSH | CUT | Missouri Western |
| 00-0038846 | Steven Jones | DB | 2023 | TEN | CUT | Appalachian State |
| 00-0038857 | Tyler Baker-Williams | DB | 2023 | LAC | CUT | North Carolina State |
| 00-0038858 | Johari Branch | OL | 2023 | LAC | CUT | Maryland |
| 00-0038859 | Cameron Brown | DB | 2023 | LAC | CUT | Ohio State |
| 00-0038863 | Nathan East | LB | 2023 | LAC | CUT | Samford |
| 00-0038864 | Michael Ezeike | TE | 2023,2024 | LAC,SEA | CUT | UCLA |
| 00-0038867 | Tyler Hoosman | RB | 2023 | LAC | CUT | North Dakota |
| 00-0038869 | Terrance Lang | DL | 2023 | LAC | CUT | Colorado |
| 00-0038873 | Pokey Wilson | WR | 2023,2025 | LAC,NYJ | CUT | Florida State |
| 00-0038885 | Avery Young | DB | 2023 | TB | CUT | Rutgers |
| 00-0038886 | Malachi Carter | WR | 2023 | CIN | CUT | Georgia Tech |
| 00-0038887 | Mac Hippenhammer | WR | 2023 | CIN | CUT | Miami, O. |
| 00-0038889 | Larry Brooks | DB | 2023 | CIN | CUT | Tulane |
| 00-0038894 | Jaylen Moody | LB | 2023 | CIN | CUT | Alabama |
| 00-0038897 | Christian Trahan | TE | 2023 | CIN | CUT | Houston |
| 00-0038898 | Calvin Tyler | RB | 2023 | CIN | CUT | Utah State |
| 00-0038899 | Nick Anderson | LB | 2023 | NO | CUT | Tulane |
| 00-0038901 | Jerron Cage | DL | 2023 | NO | CUT | Ohio State |
| 00-0038909 | Alex Pihlstrom | OL | 2023 | NO | CUT | Illinois |
| 00-0038918 | Jordan Perryman | DB | 2023 | LV | RES | Washington |
| 00-0038919 | Adam Plant | DL | 2023 | LV | CUT | Nevada-Las Vegas |
| 00-0038921 | George Tarlas | DL | 2023 | LV | CUT | Boise State |
| 00-0038927 | Mike Jones | LB | 2023 | ATL | CUT | Louisiana State |
| 00-0038929 | Justin Marshall | WR | 2023 | SEA | CUT | Buffalo |
| 00-0038943 | Kelechi Anyalebechi | LB | 2023 | LAR | CUT | Incarnate Word |
| 00-0038944 | Collin Duncan | DB | 2023 | CAR | CUT | Mississippi State |
| 00-0038948 | Christian Sims | TE | 2023 | LAR | CUT | Bowling Green |
| 00-0038949 | DeAndre Square | LB | 2023 | LAR | CUT | Kentucky |
| 00-0038950 | Rashad Torrence | DB | 2023 | LAR | RES | Florida |
| 00-0038955 | Latavious Brini | DB | 2023 | JAX | CUT | Arkansas |
| 00-0038959 | Kedrick Whitehead | DB | 2023 | TB | RES | Delaware |
| 00-0038962 | Gavin Holmes | WR | 2023 | TEN | CUT | Baylor |
| 00-0038964 | Adrian Frye | DB | 2023 | NO | CUT | Texas Tech |
| 00-0038967 | Clifford Chattman | DB | 2023 | ATL | CUT | Texas-San Antonio |
| 00-0038968 | Timarcus Davis | DB | 2023 | LAR | CUT | Arizona State |
| 00-0038991 | Taron Vincent | DL | 2023 | LAR | CUT | Ohio State |
| 00-0039011 | Brian Cobbs | WR | 2023 | ARI | CUT | Utah State |
| 00-0039012 | Justus Tavai | DL | 2023 | NE | CUT | San Diego State |
| 00-0039016 | Toby Ndukwe | DL | 2023 | PIT | CUT | Sam Houston State |
| 00-0039022 | Jadakis Bonds | WR | 2023 | GB | CUT | Hampton |
| 00-0039033 | Jerome Kapp | WR | 2023 | NYJ | CUT | Kutztown |
| 00-0039037 | Jordan Ferguson | DL | 2023 | SEA | CUT | Middle Tennessee |
| 00-0039043 | Garett Maag | WR | 2023 | MIN | CUT | North Dakota |
| 00-0039045 | Nick Williams | WR | 2023 | DEN | CUT | Nevada-Las Vegas |
| 00-0039099 | Bo Bauer | LB | 2024 | WSH | CUT | Notre Dame |
| 00-0039159 | Gunnar Oakes | TE | 2025 | DET | CUT |  |
| 00-0039168 | Milton Wright | WR | 2023 | LAC | CUT | Purdue |
| 00-0039170 | Wayne Taulapapa | RB | 2023 | SEA | CUT | Washington |
| 00-0039186 | Avery Davis | WR | 2023 | DET | CUT | Notre Dame |
| 00-0039188 | Lachlan Pitts | TE | 2023 | CHI | CUT | William &amp; Mary |
| 00-0039189 | Micah Vanterpool | OL | 2023 | NE | CUT | Hawaii |
| 00-0039191 | Aaron Dykes | RB | 2023 | MIN | CUT | Richmond |
| 00-0039192 | Caleb Sanders | DL | 2023 | PHI | CUT | South Dakota State |
| 00-0039206 | Lwal Uguak | DL | 2024 | TB | CUT | Texas Christian |
| 00-0039224 | Marvin Moody | LB | 2024,2025 | CLE | CUT | Tulane |
| 00-0039252 | Randen Plattner | LS | 2024 | KC | CUT | Kansas State |
| 00-0039254 | Mike Rigerman | TE | 2024 | BAL | CUT | Findlay |
| 00-0039255 | Tayvion Robinson | WR | 2024 | CAR | CUT | Kentucky |
| 00-0039256 | Riley Sharp | TE | 2024 | BAL | CUT | Oregon State |
| 00-0039257 | Darrell Simpson | OL | 2024 | BAL | CUT | Tulsa |
| 00-0039258 | Jordan Toles | DB | 2024 | BAL | CUT | Morgan State |
| 00-0039260 | Tramel Walthour | DL | 2024 | BAL | CUT | Georgia |
| 00-0039261 | Isaiah Washington | WR | 2024 | BAL | CUT | Rutgers |
| 00-0039271 | Jarveon Howard | RB | 2024,2025 | BUF,GB | CUT | Alcorn State |
| 00-0039273 | Trente Jones | OL | 2024 | GB | RET | Michigan |
| 00-0039276 | Al Blades Jr. | DB | 2024 | NYJ | CUT | Duke |
| 00-0039278 | Tyler Harrell | WR | 2024 | NYJ | CUT | Miami |
| 00-0039281 | Tyreek Johnson | DL | 2024 | NYJ | CUT | South Carolina |
| 00-0039282 | Myles Jones | DB | 2024 | NYJ | CUT | Duke |
| 00-0039283 | Brady Latham | OL | 2024 | NYJ | CUT | Arkansas |
| 00-0039287 | Lincoln Sefcik | TE | 2024 | NYJ | CUT | South Alabama |
| 00-0039290 | Willie Tyler | OL | 2024 | NYJ | CUT | Louisville |
| 00-0039293 | Sundiata Anderson | DL | 2024 | SEA | CUT | Grambling |
| 00-0039294 | Nelson Ceaser | DL | 2024,2025 | BUF,SEA | CUT | Houston |
| 00-0039296 | Easton Gibbs | LB | 2024 | SEA | CUT | Wyoming |
| 00-0039298 | Hayden Hatten | WR | 2024 | SEA | CUT | Idaho |
| 00-0039300 | Carlton Johnson | DB | 2024 | SEA | CUT | Fresno State |
| 00-0039302 | Kobe Lewis | RB | 2024 | SEA | CUT | Florida Atlantic |
| 00-0039307 | Rason Williams | DL | 2024 | SEA | ACT | Louisiana Tech |
| 00-0039308 | TaMerik Williams | RB | 2024 | SEA | ACT | North Dakota State |
| 00-0039314 | Phillip Brooks | WR | 2024 | KC | CUT | Kansas State |
| 00-0039320 | Griffin McDowell | OL | 2024 | KC | CUT | Chattanooga |
| 00-0039322 | D.J. Miller | DB | 2024,2025 | DET,KC | CUT | Kent State |
| 00-0039326 | Nick Torres | OL | 2024 | KC | CUT | Villanova |
| 00-0039327 | Luquay Washington | LB | 2024 | PIT | CUT | Central Connecticut State |
| 00-0039328 | Buddha Jones | DL | 2024 | SEA | CUT | Troy |
| 00-0039330 | Dimitri Stanley | WR | 2024 | GB | CUT | Iowa State |
| 00-0039334 | Andrew Peasley | QB | 2024 | NYJ | CUT | Wyoming |
| 00-0039336 | Jaaron Hayek | WR | 2024 | KC | CUT | Villanova |
| 00-0039439 | Jalon Calhoun | WR | 2024 | DET | CUT | Duke |
| 00-0039440 | Steele Chambers | LB | 2024 | NE | CUT | Ohio State |
| 00-0039441 | Duke Clemens | OL | 2024 | DET | CUT | UCLA |
| 00-0039443 | Chelen Garnes | DB | 2024 | DET | CUT | Wake Forest |
| 00-0039449 | James Turner | K | 2024 | DET | CUT | Michigan |
| 00-0039452 | Isaac Rex | TE | 2024 | LAC | CUT | Brigham Young |
| 00-0039455 | Daijun Edwards | RB | 2024 | PIT | CUT | Georgia |
| 00-0039462 | Peter LeBlanc | WR | 2024 | CHI | CUT | Louisiana-Lafayette |
| 00-0039463 | Keith Randolph Jr. | DL | 2024,2025 | CHI,GB | CUT | Illinois |
| 00-0039467 | Keaton Bills | OL | 2024 | BUF | CUT | Utah |
| 00-0039468 | Gunner Britton | OL | 2024,2025 | BUF,DET | CUT | Auburn |
| 00-0039476 | Rondell Bothroyd | DL | 2024 | BUF | CUT | Oklahoma |
| 00-0039478 | David Ugwoegbu | DL | 2024 | BUF | CUT | Houston |
| 00-0039479 | Je'Quan Burton | WR | 2024 | MIA | CUT | Florida Atlantic |
| 00-0039482 | Gavin Hardison | QB | 2024 | MIA | ACT | Texas-El Paso |
| 00-0039487 | Leonard Payne | DL | 2024 | MIA | CUT | Colorado |
| 00-0039492 | Jeremiah Crawford | OL | 2024 | CAR | CUT | Tennessee |
| 00-0039493 | Willie Drew | DB | 2024 | CAR | CUT | Virginia State |
| 00-0039496 | Clayton Isbell | DB | 2024 | NYG | CUT | Coastal Carolina |
| 00-0039503 | Jaden Shirden | RB | 2024 | CAR | CUT | Monmouth, N.J. |
| 00-0039504 | Ayir Asante | WR | 2024 | NYG | CUT | Wyoming |
| 00-0039514 | Dyshawn Gales | DB | 2024 | CLE | CUT | South Dakota State |
| 00-0039519 | Myles Murphy | DL | 2024 | ARI | CUT | North Carolina |
| 00-0039520 | Joe Shimko | LS | 2024 | ARI | CUT | North Carolina State |
| 00-0039522 | Corey Crooms | WR | 2024 | DAL | CUT | Minnesota |
| 00-0039523 | Josh DeBerry | DB | 2024 | DAL | CUT | Texas A&amp;M |
| 00-0039524 | Alec Holler | TE | 2024 | DAL | CUT | Central Florida |
| 00-0039527 | Jason Johnson | LB | 2024 | DAL | CUT | Central Florida |
| 00-0039529 | Nathaniel Peat | RB | 2024 | DAL | CUT | Missouri |
| 00-0039531 | Byron Vaughns | LB | 2024 | DAL | CUT | Baylor |
| 00-0039533 | Clark Barrington | OL | 2024 | LV | CUT | Baylor |
| 00-0039538 | TJ Franklin | DL | 2024 | LV | CUT | Baylor |
| 00-0039540 | Demarcus Governor | DB | 2024 | LV | CUT | Northern Iowa |
| 00-0039546 | Noah Shannon | DL | 2024 | LV | CUT | Iowa |
| 00-0039547 | Ja'Quan Sheppard | DB | 2024 | LV | CUT | Maryland |
| 00-0039548 | Ron Stone | DL | 2024 | LV | CUT | Washington State |
| 00-0039549 | Rayshad Williams | DB | 2024 | LV | CUT | Texas Tech |
| 00-0039551 | Andre Carter | DL | 2024 | CIN | CUT | Indiana |
| 00-0039553 | Brevin Easton | WR | 2024 | JAX | CUT | Albany, N.Y. |
| 00-0039556 | Trey Kiser | LB | 2024 | NYG | CUT | South Alabama |
| 00-0039557 | Lorenzo Lingard | RB | 2024 | NYG | CUT | Akron |
| 00-0039559 | Josh Proctor | DB | 2024 | JAX | CUT | Ohio State |
| 00-0039560 | Wayne Ruby | WR | 2024 | JAX | RES | Mount Union |
| 00-0039561 | Joseph Scates | WR | 2024 | JAX | CUT | Memphis |
| 00-0039564 | Jaylon Allen | DL | 2024,2025 | DEN,SF | CUT | Memphis |
| 00-0039569 | Brandon Matterson | DL | 2024 | TB | CUT | Texas-San Antonio |
| 00-0039571 | Alec Mock | LB | 2024 | DEN | CUT | Air Force |
| 00-0039574 | Dylan Leonard | TE | 2024 | DEN | ACT | Georgia Tech |
| 00-0039579 | Xavier White | WR | 2024 | IND | CUT | Texas Tech |
| 00-0039583 | Judge Culpepper | DL | 2024 | TB | CUT | Toledo |
| 00-0039584 | Xavier Delgado | OL | 2024 | TB | CUT | Missouri |
| 00-0039590 | Avery Jones | OL | 2024 | TB | DEV | Auburn |
| 00-0039591 | Latreal Jones | WR | 2024 | TB | CUT | Southern Mississippi |
| 00-0039593 | Chris McDonald | DB | 2024 | TB | CUT | Toledo |
| 00-0039594 | Shaun Peterson | DL | 2024 | TB | CUT | Central Florida |
| 00-0039597 | Zack Annexstad | QB | 2024 | TB | CUT | Illinois State |
| 00-0039598 | Christian Duffie | OL | 2024 | CAR | CUT | Kansas State |
| 00-0039602 | Tarique Barnes | LB | 2024 | HOU | CUT | Illinois |
| 00-0039604 | Jadon Janke | WR | 2024 | MIA | CUT | South Dakota State |
| 00-0039605 | Jaxon Janke | WR | 2024 | HOU | DEV | South Dakota State DUP->JAN439601 |
| 00-0039608 | Ulumoo Ale | DL | 2024 | CAR | CUT | Washington |
| 00-0039616 | Lawrence Johnson | DB | 2024 | NO | CUT | Southeast Missouri |
| 00-0039618 | Nathan Latu | DL | 2024 | NO | CUT | Oklahoma State |
| 00-0039619 | Nouredin Nouili | OL | 2024 | NO | INA |  |
| 00-0039621 | Kyle Sheets | WR | 2024 | KC | CUT | Slippery Rock |
| 00-0039625 | Justin Blazek | DL | 2024 | CIN | CUT | Wisconsin-Platteville |
| 00-0039627 | Noah Cain | RB | 2024 | CIN | CUT | Louisiana State |
| 00-0039628 | Aaron Casey | LB | 2024 | CIN | CUT | Indiana |
| 00-0039629 | Elijah Collins | RB | 2024 | CIN | CUT | Oklahoma State |
| 00-0039633 | Rocky Lombardi | QB | 2024 | CIN | CUT | Northern Illinois |
| 00-0039635 | Eric Miller | OL | 2024 | CIN | CUT | Louisville |
| 00-0039636 | Tre Mosley | WR | 2024 | CIN | CUT | Michigan State |
| 00-0039639 | Brian Dooley | OL | 2024 | TEN | CUT | Eastern Michigan |
| 00-0039641 | Keaton Ellis | DB | 2024 | TEN | CUT | Penn State |
| 00-0039642 | X'Zauvea Gadlin | OL | 2024 | TEN | CUT | Liberty |
| 00-0039645 | Robert Javier | DB | 2024 | TEN | CUT | Towson |
| 00-0039651 | Sam Schnee | RB | 2024 | TEN | CUT | Northern Iowa |
| 00-0039654 | Steven Stilianos | TE | 2024,2025 | DET,TEN | CUT | Iowa |
| 00-0039657 | Casey Bauman | QB | 2024 | LAC | CUT | Augustana, S.D. |
| 00-0039658 | Akeem Dent | DB | 2024 | LAC | CUT | Florida State |
| 00-0039661 | Zach Heins | TE | 2024 | LAC | CUT | South Dakota State |
| 00-0039662 | Savion Jackson | DL | 2024 | LAC | CUT | North Carolina State |
| 00-0039665 | Leon Johnson | WR | 2024 | LAC | CUT | Oklahoma State |
| 00-0039666 | Robert Kennedy | DB | 2024 | LAC | CUT | North Carolina State |
| 00-0039667 | Shane Lee | LB | 2024 | LAC | CUT | Southern California |
| 00-0039668 | Micheal Mason | DL | 2024 | LAC | CUT | Coastal Carolina |
| 00-0039671 | Willis Patrick | OL | 2024 | LAC | CUT | Texas Christian |
| 00-0039672 | Jalyn Phillips | DB | 2024 | LAC | CUT | Clemson |
| 00-0039673 | Tyler Smith | OL | 2024 | CAR | CUT | Western Carolina |
| 00-0039674 | Zamari Walton | DB | 2024 | LAC | CUT | Mississippi |
| 00-0039678 | Austin Jones | RB | 2024 | WSH | CUT | Southern California |
| 00-0039680 | David Nwaogwugwu | OL | 2024 | WSH | CUT | Toledo |
| 00-0039688 | Kaleb Ford-Dement | DB | 2024 | NO | CUT | Texas State |
| 00-0039689 | Zuri Henry | OL | 2024 | NE | CUT | Texas-El Paso |
| 00-0039690 | Jontrey Hunter | LB | 2024 | NE | INA | Georgia State |
| 00-0039691 | John Morgan | DL | 2024 | NE | CUT | Arkansas |
| 00-0039693 | Charles Turner III | OL | 2024 | NE | CUT | Louisiana State |
| 00-0039694 | Mikey Victor | DB | 2024,2025 | NE,PIT | CUT | Alabama State |
| 00-0039695 | Jacob Warren | TE | 2024 | NE | CUT | Tennessee |
| 00-0039698 | Briason Mays | OL | 2024 | SF | CUT | Southern Mississippi |
| 00-0039708 | Devron Harper | WR | 2024 | MIN | CUT | Mercer |
| 00-0039709 | Ty James | WR | 2024 | MIN | CUT | Mercer |
| 00-0039711 | Trey Knox | TE | 2024 | MIN | CUT | South Carolina |
| 00-0039717 | Owen Porter | DL | 2024 | MIN | CUT | Marshall |
| 00-0039723 | John Paddock | QB | 2024 | ATL | CUT | Illinois |
| 00-0039724 | Nolan Potter | OL | 2024 | ATL | CUT | Northern Illinois |
| 00-0039727 | Anthony Sao | DB | 2024 | ATL | CUT | MidAmerica Nazarene |
| 00-0039728 | Austin Stogner | TE | 2024 | ATL | CUT | Oklahoma |
| 00-0039729 | Trey Vaval | DB | 2024 | ATL | CUT | Minn. State-Mankato |
| 00-0039730 | Isaiah Wooden | WR | 2024 | LAC | CUT | Southern Utah |
| 00-0039758 | Ryan Johnson | OL | 2024 | TB | CUT | Youngstown State |
| 00-0039759 | Jay Person | LB | 2024 | TB | CUT | Chattanooga |
| 00-0039762 | Paul Moala | DB | 2024 | CHI | CUT | Georgia Tech |
| 00-0039765 | Andrew Hayes | DB | 2024 | TB | CUT | Central Arkansas |
| 00-0039766 | Ramon Jefferson | RB | 2024 | TB | CUT | Kentucky |
| 00-0039768 | Nathan Pickering | DL | 2024 | SEA | CUT | Mississippi State |
| 00-0039777 | Kenny Logan | DB | 2024 | LAR | CUT | Kansas |
| 00-0039778 | Tuli Letuligasenoa | DL | 2024 | LAR | CUT | Washington |
| 00-0039781 | JJ Laap | WR | 2024 | LAR | CUT | Cortland State |
| 00-0039785 | Hamze El-Zayat | WR | 2024 | NYJ | CUT | Eastern Michigan |
| 00-0039786 | Markese Stepp | RB | 2024 | NYJ | CUT | Western Kentucky |
| 00-0039787 | Shon Stephens | DB | 2024 | PHI | CUT | Ferris State |
| 00-0039788 | Leon Jones | DB | 2024 | CHI | CUT | Arkansas State |
| 00-0039804 | Ireland Brown | OL | 2024 | MIA | ACT | Rutgers |
| 00-0039820 | Mario Kendricks | DL | 2024 | SEA | CUT | Virginia Tech |
| 00-0039848 | OJ Hiliare | WR | 2024 | ATL | CUT | Bowling Green |
| 00-0039856 | Khyree Jackson | DB | 2024 | MIN | CUT | Oregon |
| 00-0039865 | Gable Steveson | DL | 2024 | BUF | CUT | Minnesota |
| 00-0039869 | David Wallis | WR | 2024 | NE | CUT | Randolph-Macon |
| 00-0039885 | Shayne Simon | LB | 2024 | BUF | CUT | Pittsburgh |
| 00-0039891 | Derek Slywka | WR | 2024 | IND | CUT | Ithaca |
| 00-0039892 | Clay Fields III | DB | 2024 | IND | CUT | Chattanooga |
| 00-0039909 | Alex Gubner | DL | 2024 | KC | CUT | Montana |
| 00-0039928 | Devin Carter | WR | 2024 | CAR | CUT | West Virginia |
| 00-0039939 | Oliver Jervis | OL | 2024 | DEN | CUT | Colorado State |
| 00-0039940 | Kairee Robinson | RB | 2024 | SEA | CUT | San Jose State |
| 00-0039941 | Geor'Quarius Spivey | TE | 2024,2025 | KC | CUT | Mississippi State |
| 00-0039942 | Mason Fairchild | TE | 2024 | NO | CUT | Kansas |
| 00-0039943 | Landon Honeycutt | LB | 2024 | CLE | CUT | Mars Hill |
| 00-0039947 | Willie Roberts | DB | 2024 | SEA | CUT | Louisiana Tech |
| 00-0039949 | Jaylon Hutchings | DL | 2024 | CHI | CUT | Texas Tech |
| 00-0039951 | Mike Smith Jr. | LB | 2024 | IND | CUT | Baylor |
| 00-0039952 | Devon Garrison | TE | 2024 | SEA | CUT | Pittsburg State |
| 00-0039953 | Christian McCarroll | DL | 2024 | NE | CUT | Grand Valley State |
| 00-0039954 | Aaron Beasley | LB | 2024 | CAR | CUT | Tennessee |
| 00-0039957 | Ajou Ajou | WR | 2025 | IND | CUT |  |
| 00-0040029 | BJ Mayes | DB | 2025 | IND | CUT |  |
| 00-0040030 | Taylor Morin | WR | 2025 | PHI | CUT |  |
| 00-0040032 | ShunDerrick Powell | RB | 2025 | PHI | CUT |  |
| 00-0040040 | J.J. Lippe | OL | 2025 | GB | CUT |  |
| 00-0040050 | Tyler Neville | TE | 2025 | DAL | CUT |  |
| 00-0040051 | Mike Smith Jr. | DB | 2025 | DAL | CUT |  |
| 00-0040052 | Zy Alexander | DB | 2025 | BUF | CUT |  |
| 00-0040080 | Elijhah Badger | WR | 2025 | KC | CUT |  |
| 00-0040082 | Will Brooks | DB | 2025 | TB | CUT |  |
| 00-0040084 | Jacobe Covington | DB | 2025 | KC | CUT |  |
| 00-0040091 | Glendon Miller | DB | 2025 | KC | CUT |  |
| 00-0040095 | Elijah Young | RB | 2025 | BUF | CUT |  |
| 00-0040096 | Jahmal Banks | WR | 2025 | BAL | CUT |  |
| 00-0040103 | Desmond Igbinosun | DB | 2025 | BAL | CUT |  |
| 00-0040114 | James Burnip | P | 2025 | NO | CUT |  |
| 00-0040115 | Paris Shand | DL | 2025 | BUF | CUT |  |
| 00-0040119 | Major Williams | DB | 2025 | KC | CUT |  |
| 00-0040239 | Kaden Prather | WR | 2025 | BUF | CUT |  |
| 00-0040256 | Jason Ivey | OL | 2025 | CLE | CUT |  |
| 00-0040266 | Dartanyan Tinsley | OL | 2025 | CLE | CUT |  |
| 00-0040276 | Jereme Robinson | DL | 2025 | PHI | CUT |  |
| 00-0040278 | JaTravis Broughton | DB | 2025 | CAR | CUT |  |
| 00-0040281 | Jacolby George | WR | 2025 | CAR | CUT |  |
| 00-0040282 | Isaac Gifford | DB | 2025 | CAR | CUT |  |
| 00-0040285 | Kobe Hudson | WR | 2025 | CAR | CUT |  |
| 00-0040286 | Luke Kandra | OL | 2025 | CAR | CUT |  |
| 00-0040287 | Steven Losoya | OL | 2025 | CAR | CUT |  |
| 00-0040288 | Kayron Lynch-Adams | RB | 2025 | CAR | CUT |  |
| 00-0040297 | BJ Adams | DB | 2025 | MIA | CUT |  |
| 00-0040306 | Nate Noel | RB | 2025 | IND | CUT |  |
| 00-0040312 | Addison West | OL | 2025 | MIA | CUT |  |
| 00-0040324 | Cam Camper | WR | 2025 | JAX | CUT |  |
| 00-0040325 | James Carpenter | DL | 2025 | JAX | CUT |  |
| 00-0040327 | John Copenhaver | TE | 2025 | JAX | CUT |  |
| 00-0040334 | Darius Lassiter | WR | 2025 | JAX | CUT |  |
| 00-0040340 | Dorian Singer | WR | 2025 | JAX | CUT |  |
| 00-0040343 | Aydan White | DB | 2025 | JAX | CUT |  |
| 00-0040345 | Devonta Davis | DL | 2025 | IND | CUT |  |
| 00-0040346 | Solomon DeShields | LB | 2025 | IND | CUT |  |
| 00-0040348 | Joe Evans | DL | 2025 | PHI | CUT |  |
| 00-0040350 | Tyler Kahmann | WR | 2025 | IND | CUT |  |
| 00-0040351 | Desmond Little | DL | 2025 | IND | CUT |  |
| 00-0040353 | Landon Parker | WR | 2025 | IND | CUT |  |
| 00-0040354 | Blayne Taylor | WR | 2025 | IND | CUT |  |
| 00-0040355 | Ladarius Tennison | DB | 2025 | IND | CUT |  |
| 00-0040356 | Maddux Trujillo | K | 2025 | BUF | RES |  |
| 00-0040367 | Rush Reimer | OL | 2025 | BUF | CUT |  |
| 00-0040368 | Quali Conley | RB | 2025 | CIN | CUT |  |
| 00-0040373 | Jamoi Mayes | WR | 2025 | CIN | CUT |  |
| 00-0040376 | Rashod Owens | WR | 2025 | CIN | CUT |  |
| 00-0040378 | Payton Thorne | QB | 2025 | CIN | CUT |  |
| 00-0040381 | Oscar Cardenas | TE | 2025 | ARI | CUT |  |
| 00-0040389 | Ian Kennelly | DB | 2025 | DET | CUT |  |
| 00-0040402 | Dymere Miller | WR | 2025 | NYJ | CUT |  |
| 00-0040407 | Aaron Smith | LB | 2025 | NYJ | CUT |  |
| 00-0040412 | Daniel Jackson | WR | 2025 | HOU | CUT |  |
| 00-0040423 | Roman Parodie | DB | 2025 | TB | CUT |  |
| 00-0040424 | Warren Peeples | DL | 2025 | TB | CUT |  |
| 00-0040426 | Shilo Sanders | DB | 2025 | TB | CUT |  |
| 00-0040430 | Jordan Bly | WR | 2025 | NYG | CUT |  |
| 00-0040435 | O'Donnell Fortune | DB | 2025 | NYG | CUT |  |
| 00-0040437 | Makari Paige | DB | 2025 | NYG | CUT |  |
| 00-0040439 | Jaison Williams | OL | 2025 | NYG | CUT |  |
| 00-0040447 | Jerjuan Newton | WR | 2025 | DEN | CUT |  |
| 00-0040448 | Joshua Pickett | DB | 2025 | DEN | CUT |  |
| 00-0040457 | Jermaine Terry | TE | 2025 | NYG | CUT |  |
| 00-0040463 | Kylan Guidry | LB | 2025 | LAC | CUT |  |
| 00-0040465 | Corey Stewart | OL | 2025 | LAC | CUT |  |
| 00-0040469 | Stevo Klotz | TE | 2025 | LAC | CUT |  |
| 00-0040474 | Jaylen Jones | DB | 2025 | LAC | CUT |  |
| 00-0040477 | Anthony Booker | DL | 2025 | LV | CUT |  |
| 00-0040479 | Hudson Clark | DB | 2025 | LV | CUT |  |
| 00-0040481 | Mello Dotson | DB | 2025 | CAR | CUT |  |
| 00-0040483 | Jarrod Hufford | OL | 2025 | LV | CUT |  |
| 00-0040484 | John Humphrey | DB | 2025 | LV | CUT |  |
| 00-0040485 | Matt Jones | LB | 2025 | LV | CUT |  |
| 00-0040486 | Jah Joyner | DL | 2025 | LV | CUT |  |
| 00-0040491 | Parker Clements | OL | 2025 | LV | CUT |  |
| 00-0040502 | Robert Lewis | WR | 2025 | MIN | CUT |  |
| 00-0040505 | Mishael Powell | DB | 2025 | MIN | CUT |  |
| 00-0040510 | Micah Bernard | RB | 2025 | NE | CUT |  |
| 00-0040511 | Philip Blidi | DL | 2025 | NE | CUT |  |
| 00-0040513 | Desmond Evans | DL | 2025 | TEN | CUT |  |
| 00-0040515 | Jermari Harris | DB | 2025 | TEN | CUT |  |
| 00-0040516 | Garnett Hollis Jr. | DB | 2025 | BUF | CUT |  |
| 00-0040520 | Devonte O'Malley | DL | 2025 | GB | CUT |  |
| 00-0040523 | Davion Ross | DB | 2025 | TEN | CUT |  |
| 00-0040526 | Tre Stewart | RB | 2025 | MIN | CUT |  |
| 00-0040536 | Jasheen Davis | DL | 2025 | NO | CUT |  |
| 00-0040538 | Moochie Dixon | WR | 2025 | NO | CUT |  |
| 00-0040540 | Tyreem Powell | LB | 2025 | NO | CUT |  |
| 00-0040542 | Omari Thomas | DL | 2025 | NO | CUT |  |
| 00-0040544 | Marcus Yarns | RB | 2025 | NO | CUT |  |
| 00-0040549 | Nick Kubitz | LB | 2025 | ATL | CUT |  |
| 00-0040553 | Quincy Skinner Jr. | WR | 2025 | ATL | CUT |  |
| 00-0040555 | Jordan Williams | OL | 2025 | ATL | CUT |  |
| 00-0040569 | Ben Wooldridge | QB | 2025 | NE | CUT |  |
| 00-0040575 | Jordan Polk | DB | 2025 | NE | CUT |  |
| 00-0040591 | Taylor Elgersma | QB | 2025 | GB | CUT |  |
| 00-0040596 | Josh Pearcy | LB | 2025 | LAR | CUT |  |
| 00-0040605 | Ketron Jackson Jr. | WR | 2025 | LV | CUT |  |
| 00-0040606 | Key'Shawn Smith | WR | 2025 | KC | CUT |  |
| 00-0040607 | Wesley Steiner | LB | 2025 | SEA | CUT |  |
| 00-0040608 | Shaquan Loyal | DB | 2025 | CIN | CUT |  |
| 00-0040610 | Jeremiah Walker | DB | 2025 | CHI | CUT |  |
| 00-0040612 | Malik Dixon-Williams | DB | 2025 | LAR | CUT |  |
| 00-0040614 | Ben Dooley | OL | 2025 | LAR | CUT |  |
| 00-0040622 | D'Eryk Jackson | LB | 2025 | SEA | CUT |  |
| 00-0040626 | Dvon J-Thomas | DL | 2025 | TB | CUT |  |
| 00-0040627 | T.J. Sheffield | WR | 2025 | TEN | CUT |  |
| 00-0040657 | Da'Jon Terry | DL | 2025 | LAR | CUT |  |
| 00-0040664 | Michael Gonzalez | OL | 2025 | MIN | CUT |  |
| 00-0040665 | Michael Fletcher | DL | 2025 | NYJ | CUT |  |
| 00-0040671 | Nate McCollum | WR | 2025 | ARI | CUT |  |
| 00-0040681 | R.J. Moten | DB | 2025 | NE | CUT |  |
| 00-0040703 | Ife Adeyi | WR | 2025 | PHI | CUT |  |
| 00-0040707 | Decarius Hawthorne | DL | 2025 | LAR | CUT |  |
| 00-0040717 | Joey Lombard | OL | 2025 | KC | CUT |  |
| 00-0040732 | Tyson Russell | DB | 2025 | DET | CUT |  |
| 00-0040750 | Kam Alexander | DB | 2025 | PIT | CUT |  |
| 00-0040755 | J.J. Weaver | LB | 2025 | CAR | CUT |  |
| 00-0040760 | Jonathan Mendoza | OL | 2025 | NO | CUT |  |
| 00-0040768 | Oscar Chapman | P | 2025 | MIN | CUT |  |
| 00-0040773 | Nay'Quan Wright | RB | 2025 | IND | CUT |  |
| 00-0040774 | Nate Matlack | DL | 2025 | KC | CUT |  |
| 00-0040775 | Shane Watts | RB | 2025 | NE | CUT |  |
| 00-0040776 | Alphonzo Tuputala | LB | 2025 | SEA | CUT |  |
| 00-0040777 | JayVian Farr | DB | 2025 | TB | CUT |  |
| 00-0040778 | Roderick Daniels Jr. | WR | 2025 | NO | CUT |  |
| 00-0040779 | Phil Lutz | WR | 2025 | NE | CUT |  |
| 00-0040780 | Xander Mueller | LB | 2025 | KC | CUT |  |
| 00-0040781 | Joseph Vaughn | LB | 2025 | IND | CUT |  |
| 00-0040783 | Jake Chaney | LB | 2025 | IND | CUT |  |

## Appendix B — referenced players with no `pfr_id` from any source (190)

| gsis_id | name | pos | seasons | referenced by |
|---|---|---|---|---|
| 00-0018613 | Cornell Green | OT | 2000-2010 | play+rost+dept |
| 00-0020457 | Stephen Neal | G | 2001-2010 | play+rost+dept |
| 00-0022078 | Jonathan Stinchcomb | OT | 2003-2010 | play+rost+dept |
| 00-0025981 | J.J. Finley | TE | 2008-2011 | rost+dept |
| 00-0026519 | Domonique Johnson | DB | 2009-2012 | play+rost+dept |
| 00-0026638 | Robert Bruggeman | C | 2009-2011 | rost+dept |
| 00-0026691 | Chris Williams | WR | 2009-2014 | play+rost+dept |
| 00-0026764 | Dobson Collins | WR | 2009-2016 | rost |
| 00-0026799 | Jeremiah Johnson | RB | 2009-2012 | play+rost+dept |
| 00-0027216 | Dorian Brooks | G | 2010-2010 | rost |
| 00-0027311 | Dennis Landolt | OT | 2010-2012 | rost+dept |
| 00-0027384 | R.J. Archer | QB | 2010-2010 | rost |
| 00-0028194 | Cory Brandon | OT | 2012-2012 | rost+dept |
| 00-0028349 | Jordan Miller | DT | 2011-2013 | play+rost+dept |
| 00-0028493 | David Sims | S | 2011-2012 | play+rost+dept |
| 00-0028522 | Mike Higgins | TE | 2011-2013 | play+rost+dept |
| 00-0028627 | Marcus Harris | WR | 2011-2015 | rost |
| 00-0029455 | Nick Guess | LS | 2012-2012 | rost |
| 00-0030202 | Eric Rogers | WR | 2016-2016 | rost |
| 00-0030762 | Ryan White | DB | 2016-2016 | rost |
| 00-0030805 | Je'Ron Hamm | TE | 2014-2018 | play+rost+dept |
| 00-0030856 | Tony Washington | WR | 2014-2016 | play+rost+dept |
| 00-0031164 | Erle Ladson | OT | 2015-2015 | rost |
| 00-0031487 | Douglas McNeil | WR | 2014-2015 | rost |
| 00-0031505 | Issac Blakeney | WR | 2015-2015 | rost |
| 00-0031518 | Zack Hodges | OLB | 2015-2015 | rost |
| 00-0031529 | Reggie Bell | WR | 2015-2015 | rost |
| 00-0031666 | Derek Akunne | LB | 2015-2015 | rost |
| 00-0031679 | Joshua Stangby | WR | 2015-2015 | rost |
| 00-0031683 | Kevin White | CB | 2015-2015 | rost |
| 00-0031693 | Chuka Ndulue | NT | 2015-2016 | rost |
| 00-0031746 | George Farmer | RB | 2015-2016 | play+rost+dept |
| 00-0031753 | Joel Ross | CB | 2015-2015 | rost |
| 00-0031790 | Floyd Raven | DB | 2015-2015 | rost |
| 00-0031803 | Blake Renaud | RB | 2015-2015 | rost |
| 00-0031926 | Dan Pettinato | DE | 2015-2016 | rost |
| 00-0031965 | Abou Toure | RB | 2015-2015 | rost |
| 00-0032013 | Mitchell Bell | G | 2015-2015 | rost |
| 00-0032020 | Terry Williams | DT | 2015-2015 | rost |
| 00-0032026 | Cyril Lemon | G | 2015-2015 | rost |
| 00-0032029 | R.J. Harris | WR | 2015-2015 | rost |
| 00-0032033 | Yannik Cudjoe-Virgil | OLB | 2015-2015 | rost+dept |
| 00-0032036 | Derrick Lott | DT | 2015-2015 | rost |
| 00-0032038 | Mike Meyer | K | 2017-2017 | rost |
| 00-0032073 | Jake Heaps | QB | 2016-2016 | rost |
| 00-0032080 | Titus Davis | WR | 2015-2016 | rost |
| 00-0032100 | Shakim Phillips | WR | 2015-2015 | rost |
| 00-0032193 | Antoine Everett | G | 2015-2015 | rost |
| 00-0032258 | Collin Rahrig | G | 2015-2015 | rost |
| 00-0032267 | Kevin Short | DB | 2015-2016 | rost |
| 00-0032279 | Tyrequek Zimmerman | DB | 2015-2015 | rost |
| 00-0032283 | Kevin Monangai | RB | 2015-2015 | rost |
| 00-0032287 | Ed Williams | WR | 2015-2015 | rost |
| 00-0032312 | Michael Bennett | WR | 2015-2015 | rost |
| 00-0032352 | Michael Miller | TE | 2016-2016 | rost |
| 00-0032467 | Christian French | LB | 2017-2017 | rost |
| 00-0032500 | Chris King | WR | 2016-2016 | rost |
| 00-0032558 | Deonte Gibson | DE | 2016-2016 | rost |
| 00-0032611 | Jhurrell Pressley | RB | 2016-2018 | rost+dept |
| 00-0032615 | Ryan DiSalvo | LS | 2017-2017 | rost |
| 00-0032702 | Chris Brown | WR | 2016-2016 | rost |
| 00-0032817 | Mitch Mathews | WR | 2016-2016 | rost |
| 00-0032835 | Jon Brown | K | 2017-2020 | play+rost+dept |
| 00-0032874 | Joseph Cheek | OT | 2016-2018 | rost |
| 00-0032877 | Marcus Henry | C | 2018-2021 | rost+dept |
| 00-0032947 | Avery Young | OT | 2016-2017 | rost |
| 00-0032948 | Aaron Epps | OT | 2016-2016 | rost |
| 00-0033007 | Terran Vaughn | G | 2016-2016 | rost |
| 00-0033042 | M.J. McFarland | TE | 2016-2016 | rost |
| 00-0033086 | Kyle Coleman | LB | 2017-2017 | rost |
| 00-0033161 | Isaiah Williams | OT | 2016-2021 | play+rost+dept |
| 00-0033211 | Jordan Mudge | G | 2017-2017 | rost |
| 00-0033227 | Jarnor Jones | DB | 2017-2017 | rost |
| 00-0033233 | Jordan Moore | DB | 2017-2018 | rost |
| 00-0033273 | Jerry Ugokwe | OT | 2017-2017 | rost |
| 00-0033328 | Caleb Kidder | DE | 2017-2017 | rost |
| 00-0033358 | Izaah Lunsford | DT | 2017-2017 | rost |
| 00-0033389 | David Jones | DB | 2017-2018 | rost |
| 00-0033457 | Connor Harris | LB | 2017-2017 | rost |
| 00-0033496 | B.J. Johnson | WR | 2017-2017 | rost |
| 00-0033622 | Daikiel Shorts | WR | 2017-2017 | rost |
| 00-0033743 | Jeremy Liggins | DT | 2017-2017 | rost |
| 00-0033774 | Tevon Mutcherson | DB | 2018-2018 | rost |
| 00-0033843 | Shakeir Ryan | WR | 2017-2017 | rost |
| 00-0033867 | Ezekiel Bigger | LB | 2017-2017 | rost |
| 00-0033990 | Steve Donatell | TE | 2017-2017 | rost |
| 00-0033994 | Fred Brown | WR | 2017-2020 | play+rost+dept |
| 00-0034027 | De'Quan Hampton | WR | 2021-2021 | rost |
| 00-0034035 | Daniel Williams | WR | 2017-2018 | rost |
| 00-0034100 | Shay Fields | WR | 2018-2018 | rost |
| 00-0034113 | Jimmy Williams | WR | 2018-2018 | rost |
| 00-0034178 | Austin Davis | C | 2018-2018 | rost |
| 00-0034187 | Justin Evans | OT | 2018-2018 | rost |
| 00-0034195 | Christian LaCouture | DE | 2018-2018 | rost |
| 00-0034240 | Marcus Martin | DE | 2018-2018 | rost |
| 00-0034305 | Greer Martini | LB | 2018-2018 | rost |
| 00-0034326 | Robert McCray | DE | 2018-2019 | play+rost |
| 00-0034447 | Lucas Gravelle | LS | 2018-2018 | rost |
| 00-0034455 | Quincy Redmon | DE | 2018-2018 | rost |
| 00-0034477 | Alec James | DE | 2018-2018 | rost |
| 00-0034517 | Mike Hughes | DT | 2018-2018 | rost |
| 00-0034543 | Chris Durant | OT | 2018-2018 | rost |
| 00-0034568 | Steven Richardson | DT | 2018-2018 | rost |
| 00-0034589 | Rashard Fant | DB | 2018-2018 | rost |
| 00-0034627 | Mason Gentry | G | 2018-2018 | rost |
| 00-0034692 | Marko Myers | DB | 2018-2019 | rost |
| 00-0034736 | Steven Parker | DB | 2018-2022 | play+rost+dept |
| 00-0034737 | Luis Perez | QB | 2018-2018 | rost |
| 00-0034849 | Tony Adams | G | 2018-2018 | rost |
| 00-0034851 | Kiante Anderson | DE | 2018-2018 | rost |
| 00-0034890 | Justin Stockton | RB | 2018-2018 | rost |
| 00-0034894 | Julian Williams | WR | 2018-2018 | rost |
| 00-0034919 | Cody Brown | DB | 2019-2019 | rost |
| 00-0035056 | Josh Simmons | DB | 2019-2019 | rost |
| 00-0035077 | Manny Wilkins | QB | 2019-2019 | rost |
| 00-0035108 | Nathan Meadors | DB | 2019-2023 | play+rost+dept |
| 00-0035161 | John Lovett | FB | 2019-2022 | play+rost+dept |
| 00-0035332 | Ray Smith | DT | 2019-2019 | rost |
| 00-0035424 | Chris Brown | G | 2019-2019 | rost |
| 00-0035456 | Chris Johnson | SAF | 2019-2019 | rost |
| 00-0035467 | Bruce Anderson | RB | 2019-2020 | rost |
| 00-0035474 | Anthony Johnson | WR | 2019-2020 | rost |
| 00-0035502 | Tyler Jones | G | 2019-2019 | rost |
| 00-0035727 | Durval Queiroz | G | 2019-2021 | rost |
| 00-0035891 | Cody White | WR | 2020-2026 | play+rost+dept |
| 00-0035892 | Darryl Williams | C | 2020-2023 | rost |
| 00-0035896 | Keith Washington | CB | 2020-2020 | rost |
| 00-0035916 | T.J. Carter | DE | 2022-2022 | rost+dept |
| 00-0036019 | JoJo Ward | WR | 2020-2020 | rost |
| 00-0036093 | Bill Murray | G | 2020-2025 | rost+dept |
| 00-0036120 | Armani Taylor-Prioleau | OT | 2020-2024 | rost+dept |
| 00-0036486 | David Moore | G | 2021-2022 | rost |
| 00-0036696 | Briley Moore | TE | 2021-2022 | rost |
| 00-0036761 | Elijah Ponder | LB | 2021-2021 | rost+dept |
| 00-0036784 | Jacob Capra | G | 2021-2021 | rost+dept |
| 00-0036808 | Bruno Labelle | TE | 2021-2021 | rost |
| 00-0037035 | Jordan Murray | OT | 2022-2022 | rost |
| 00-0037052 | T.J. Carter | CB | 2022-2022 | play+rost |
| 00-0037152 | Matt Gotel | NT | 2023-2024 | rost |
| 00-0037186 | Chuck Wiley | OLB | 2022-2022 | rost |
| 00-0037221 | Calvin Jackson | WR | 2022-2022 | rost |
| 00-0037234 | John Lovett | RB | 2022-2022 | rost |
| 00-0037372 | Darren Evans | DB | 2022-2022 | rost |
| 00-0037386 | Dylan Parham | TE | 2022-2022 | rost |
| 00-0037409 | Michael Young Jr. | WR | 2022-2022 | rost |
| 00-0037428 | Alec Anderson | OT | 2022-2026 | play+rost+dept |
| 00-0037442 | Josh Johnson | WR | 2022-2022 | rost |
| 00-0037451 | Rod Williams | TE | 2022-2024 | play+rost+dept |
| 00-0037485 | Joe Ozougwu | DE | 2022-2022 | rost |
| 00-0037641 | Willie Johnson | WR | 2022-2022 | rost |
| 00-0037670 | Arnold Tarpley | SAF | 2023-2023 | rost |
| 00-0038419 | Robert Burns | RB | 2023-2024 | rost |
| 00-0038499 | Caleb Johnson | LB | 2023-2023 | rost |
| 00-0038658 | Adrian Martinez | QB | 2024-2026 | play+rost |
| 00-0038661 | Chris Smith | DT | 2023-2026 | play+rost |
| 00-0038700 | Ezekiel Vandenburgh | LB | 2023-2023 | rost |
| 00-0038907 | Anthony Johnson | CB | 2023-2023 | rost |
| 00-0038920 | John Shenker | TE | 2023-2024 | play+rost+dept |
| 00-0038928 | Xavier Malone | WR | 2023-2023 | rost |
| 00-0038957 | Alfonzo Graham | RB | 2023-2023 | rost |
| 00-0038990 | Ayinde Eley | LB | 2023-2023 | rost |
| 00-0038999 | Jordan Murray | TE | 2023-2024 | rost |
| 00-0039015 | LaTrell Bumphus | NT | 2023-2023 | rost |
| 00-0039176 | Basil Okoye | DT | 2023-2026 | play+rost |
| 00-0039247 | Joe Evans | LB | 2024-2024 | rost |
| 00-0039265 | Gabe Hall | DT | 2024-2026 | rost |
| 00-0039286 | Marcus Riley | WR | 2024-2024 | rost |
| 00-0039474 | Lawrence Keys | WR | 2026-2026 | rost |
| 00-0039483 | Isaiah Johnson | CB | 2024-2025 | play+rost |
| 00-0039555 | Steven Jones | G | 2024-2026 | rost |
| 00-0039570 | Jordan Miller | DT | 2024-2026 | rost |
| 00-0039607 | Maxwell Tooley | LB | 2024-2024 | rost |
| 00-0039704 | Matthew Cindric | C | 2024-2024 | rost |
| 00-0039716 | Doug Nester | G | 2024-2026 | rost |
| 00-0039958 | Jack Wilson | OT | 2024-2025 | rost |
| 00-0040098 | Gerad Lichtenhan | OT | 2025-2026 | rost |
| 00-0040099 | Xavier Guillory | WR | 2026-2026 | rost |
| 00-0040105 | Jayson Jones | DT | 2025-2026 | rost |
| 00-0040253 | Maximilian Mang | TE | 2025-2025 | rost |
| 00-0040299 | Eugene Asante | LB | 2025-2025 | rost |
| 00-0040310 | John Saunders Jr. | SAF | 2025-2026 | rost |
| 00-0040375 | Jordan Moore | WR | 2025-2026 | rost |
| 00-0040400 | Donovan Edwards | RB | 2025-2026 | rost |
| 00-0040445 | Courtney Jackson | WR | 2025-2026 | rost |
| 00-0040446 | Joseph Michalski | C | 2025-2025 | rost |
| 00-0040468 | Eric Rogers | CB | 2025-2026 | rost |
| 00-0040547 | Nate Carter | RB | 2025-2026 | play+rost |
| 00-0040697 | Thomas Gordon | TE | 2025-2026 | rost |
| 00-0040702 | Mitch Van Vooren | TE | 2026-2026 | rost |
| 00-0040769 | Jaden Smith | WR | 2025-2026 | rost |
