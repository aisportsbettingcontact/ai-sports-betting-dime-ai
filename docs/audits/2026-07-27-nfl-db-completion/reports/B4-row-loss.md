# B4 — Row-loss reconciliation: every source row loaded, or explained

## Verdict

**PASS WITH EXCEPTIONS.** All 1,806,007 source rows across the eight loaded tables are now
accounted for — 1,251,140 loaded and 554,867 excluded for four named, individually verified
causes, with **zero unexplained loss**. The 341 missing `player_game_stats` rows are nflverse's
per-week residual aggregation bucket: every one carries an empty `player_id`, so none of them is a
player row. That exclusion is legitimate; the defect is that `build_db.py` never counted it.

## What I checked

Full population, not a sample. Every source row of every table, compared to the database twice:

| Comparison | Method | Catches |
|---|---|---|
| **Key identity** | multiset of primary keys, source vs DB, both directions | missing rows, extra rows, duplicate keys |
| **Value identity** | multiset of complete row tuples, source vs DB, both directions | right key, wrong payload |

Multisets, not sets — so a row loaded twice while another is dropped cannot cancel out to a
matching total. Equal counts were treated as proving nothing until both comparisons came back
clean, which they did for all eight tables.

Delivered as `scripts/data/nfl-db/lib/rowloss.py`: re-runnable, importable, exits non-zero on any
unexplained loss or unclassified NULL. It is a build gate, not a one-off script.

`depth_chart` recovery belongs to agent B3; I confirmed its arithmetic only.

---

## Results

### Per-table reconciliation

| Table | Source | Source rows | Loaded | Excluded | Unexplained | Missing keys | Extra keys | Dup keys | Value drift |
|---|---|---|---|---|---|---|---|---|---|
| `player` | `raw/players.csv` | 25,035 | 25,035 | 0 | **0** | 0 | 0 | 0 | 0 |
| `game` | `nfl-unified-2010-2026/games.json` | 4,648 | 4,648 | 0 | **0** | 0 | 0 | 0 | 0 |
| `game_line` | same JSON, `spreadLine` present | 4,648 | 4,363 | 285 | **0** | 0 | 0 | 0 | 0 |
| `team_game` | derived, 2 rows per game | 9,296 | 9,270 | 26 | **0** | 0 | 0 | 0 | 0 |
| `player_game_stats` | `raw/player_stats.csv` | 287,184 | 286,843 | 341 | **0** | 0 | 0 | 0 | 0 |
| `snap_count` | `raw/snap_counts.csv` | 324,611 | 324,611 | 0 | **0** | 0 | 0 | 0 | 0 |
| `roster_season` | `raw/rosters.csv` | 43,856 | 43,856 | 0 | **0** | 0 | 0 | 0 | 0 |
| `depth_chart` | `raw/depth_charts.csv` | 1,106,729 | 552,514 | 554,215 | **0** | 0 | 0 | 0 | 0 |
| **TOTAL** | | **1,806,007** | **1,251,140** | **554,867** | **0** | 0 | 0 | 0 | 0 |

`team_game` source rows are counted per side (2 × 4,648 games = 9,296), because a game with an
unresolved matchup loses *both* of its rows and both must be accounted for.

### The 341 missing `player_game_stats` rows — cause

**Every one of the 341 has `player_id = ''`.** Zero were lost to a primary-key collision, a failed
cast, an unresolved join, or a swallowed exception. The drop happens at `build_db.py:207`:

```python
gid = pick(r, "player_id", "gsis_id")
if not gid or gid not in known_players:
    continue                       # <- 341 rows die here, uncounted
```

Four independent facts identify what these rows are:

1. **`player_id` is empty on all 341.** `position` is empty on all 341. 285 have an empty
   `player_name`; 54 say literally `"Team"`; 2 carry a leaked play-by-play name string
   (`D.Bryant`, `R.Rodgers`).
2. **There is exactly one per (season, week) — 341 of 341, no week has two.**
   11 seasons × 21 weeks (2010–2020) + 5 seasons × 22 weeks (2021–2025) = **341**. That is the
   signature of an R `group_by(player_id, ...)` collapsing every NA-player row in a week into a
   single group.
3. **Their payload is team-level, not player-level.** Penalties are non-zero on 310/341, team
   safeties on 80/341, unattributed solo tackles on 55/341 — events charged to a unit, not a person.
4. **The `team` / `opponent_team` / `game_id` / `player_name` columns on these rows are
   `first()`-of-group artifacts and carry no meaning.** Proof: the 2010 week-2 residual row is
   labelled `ATL` with 8 penalties, but ATL's own penalty total that week is 14; the 2012 week-6
   row is labelled `TEN` yet its leaked name is `D.Bryant`.

**Verdict on each of the 341: legitimate exclusion, not a real loss.** A NULL `player_id` cannot be
stored — `player_game_stats.gsis_id` is `TEXT NOT NULL REFERENCES player(gsis_id)` and part of the
primary key — and inventing an id would violate standing rule 1. The upstream feed itself could not
attribute these plays to a player.

**Data actually forfeited: 11 receiving yards.** Of the 20 stat columns `player_game_stats` stores,
exactly one of the 341 rows has any non-zero value at all — 2012 week 6, carrying 2 receptions,
2 targets, 11 receiving yards, 1.1 fantasy points (3.1 PPR). The other 340 rows are all-zero across
every column the table holds. Full itemization of all 341 in [Appendix A](#appendix-a).

### Primary-key collisions — ruled out with evidence

The task flagged PK collisions as the prime suspect. They are not the cause, and the current key is
not producing silent destruction today:

| Test | Result |
|---|---|
| Source rows colliding on `(gsis_id, season, week, season_type)` | **0** of 287,184 |
| Player-weeks appearing under two different teams (mid-season trade case) | **0** |
| `(gsis_id, season, week)` keys used by both `REG` and `POST` (week-18 ambiguity) | **0** |
| Distinct player-week-seasontype keys in source | 286,843 = rows loaded |

nflverse pre-aggregates to one row per player-week, so the two-teams-in-one-week case never
reaches the loader. The key is nonetheless **structurally unable to represent it**, and the table
carries no `game_id` at all — see [C1](#c1--player_game_stats-must-carry-game_id) and
[C2](#c2--make-the-identity-guard-collision-proof).

### `game_line` — the 285 line-less games are the right 285

| Check | Result |
|---|---|
| `game_line` rows | 4,363 |
| ... all with `game.result_status = 'final'` | 4,363 / 4,363 |
| ... season range | 2010–2025 |
| 2010–2025 games that are not final | 0 |
| 2010–2025 games missing a line | **0** |
| 2026 games carrying a line | **0** |
| Line-less games, by season | 2026: 285. No other season. |
| `nfl-lines-2010-2025/games.json` ids == the `spreadLine`-present subset | exact match |
| Rows in the lines feed with a NULL `spreadLine` | 0 |

4,363 is exactly the 2010–2025 completed set. The 285 line-less games are exactly the 2026 season.
`odds_source`: 4,362 `nflverse` + 1 `manual-2026-07-27`.

### `team_game` — exactly 2× the games it should cover

| Check | Result |
|---|---|
| Rows | 9,270 = 2 × 4,635 |
| Distinct `game_id` | 4,635 |
| Games with ≠ 2 rows | **0** |
| Games where the two rows are not two different franchises | **0** |
| Games where `is_home` is not exactly one 1 and one 0 | **0** |
| Orphan rows (no matching `game`) | **0** |
| Resolved games with no `team_game` row | **0** |
| `(game_id, franchise_id)` duplicates | **0** |
| Side / points / opponent mismatch vs the `game` row | **0** |
| `game_number` not a gapless 1..n per team-season | **0** |
| `spread` sign wrong vs `game_line.spread_line` | **0** |
| Rows carrying a line for a game that has none | **0** |

The 13 games not covered are the 2026 playoff slots with `result_status = 'tbd'` and no matchup —
6 WC, 4 DIV, 2 CON, 1 SB. Each loses both sides, hence 26 excluded rows. Structural.

### `depth_chart` — arithmetic confirmed (B3 owns the fix)

**552,514 + 554,215 = 1,106,729.** Confirmed exactly. The 554,215 excluded rows are one contiguous
block starting at CSV line 552,516, every one carrying a `dt` timestamp and no `season` — the
schema-B ESPN-style snapshot format nflverse introduced for 2025.

---

## Exceptions

Every source row that did not become a database row, with its cause. This list is complete: the
harness fails if a single row falls outside it.

| Table | Cause | Rows | Real loss? | Evidence |
|---|---|---|---|---|
| `player_game_stats` | `no_player_id` — nflverse per-week residual bucket, `player_id` empty | **341** | No, except 11 receiving yards (2012 wk 6) | [Appendix A](#appendix-a); 1 row per (season, week), 341 of 341 |
| `game_line` | `season_2026_unplayed_no_line` — 2026 has not been played | **285** | No — structural | all 285 are `season=2026`; 0 of 2010–2025 missing |
| `team_game` | `tbd_matchup_no_franchise` — 2026 playoff slots, matchup unresolved | **26** (13 games × 2 sides) | No — structural | all 13 are `result_status='tbd'`, `away_abbr IS NULL` |
| `depth_chart` | `no_season_schema_b` — 2025 release format has no season column | **554,215** | **Yes — owned by B3** | contiguous block from CSV line 552,516; every row has `dt`, none has `season` |
| | **Total excluded** | **554,867** | | |

### Secondary defects surfaced by the identity check

These are not row loss. They are wrong or discarded values that a count-based check cannot see.

| # | Defect | Scale | Evidence |
|---|---|---|---|
| D1 | **`player_game_stats` has no `game_id`**, although `player_stats.csv` supplies one that resolves to `game.game_id` for **286,843 of 286,843** loadable rows (100.0000%). It is dropped by the loader. | every row | see [C1](#c1--player_game_stats-must-carry-game_id) |
| D2 | **`v_player_game` fails the game join for all 12,050 `POST` rows** (`game_id IS NULL`). Cause: the view joins `g.week = p.week`, but `game.week` is NULL for postseason rows by CHECK constraint while `player_game_stats.week` holds 18–22. Every playoff player-game in the prop-modelling surface has no game context. | 12,050 rows | `SELECT COUNT(*) FROM v_player_game WHERE game_id IS NULL` → 12050, 100% `POST` |
| D3 | **`snap_count.pfr_game_id` is mislabelled** — it holds the nflverse `game_id` (`2013_01_ARI_STL`) for **324,611 of 324,611** rows, never the PFR id (`201309080ram`). `build_db.py` does `pick(r, "game_id", "pfr_game_id")` and `game_id` always wins. The real PFR game id is discarded entirely. | every row | `WHERE pfr_game_id GLOB '[0-9][0-9][0-9][0-9]_[0-9][0-9]_*'` → 324,611 |
| D4 | **1,608 `roster_season` rows cannot join to `player`** — 18 with a NULL `gsis_id`, 1,590 (1,482 distinct ids) whose `gsis_id` is genuinely absent from `players.csv`. No FK on the column, so they load silently. Example: `00-0029389` "Phil Bates" (2014, WR) is in `rosters.csv` and `depth_charts.csv` but not `players.csv`. | 1,608 rows | see [C4](#c4--roster_season-referential-gap-and-discarded-week-context) |
| D5 | **`roster_season` discards the source's `week` and `game_type`.** `rosters.csv` carries both (`week` 1–22, `game_type` REG/WC/DIV/CON/SB); neither is loaded. Consequence: 4 player-seasons collapse to indistinguishable duplicate rows (Fred Taylor 2010 NE, Thomas Jones 2010 + 2011 KC, Correll Buckhalter 2010 DEN). | 2 columns, 4 collisions | `GROUP BY` all 9 columns → 43,852 distinct of 43,856 |
| D6 | **PFR crosswalk contradiction**: `pfr_player_id = 'DaviJa06'` resolves to `gsis_id 00-0034446` (Jalen Davis, CB) but the source attributes it to two teams in the same week — 2021 wk 12 on both MIA and CIN, and 2019 wks 16/17 on both ARI (as CB) and MIA (as DE). This fans `v_player_game` out to 286,844 rows from 286,843. Reported, not resolved (standing rule 4). | 6 snap rows, 3 player-weeks | cross-reference to B1 |
| D7 | **Seven silent-drop paths in `build_db.py`; only one counts what it drops.** Lines 128, 172, 207, 211, 214, 248 `continue` without a counter. Only line 282 (`dc_no_season`) increments one. This is the mechanism that let the 341 ship green. | systemic | see [C5](#c5--every-drop-path-must-count-what-it-drops) |

---

## Column-level NULL classification

All 165 columns across 10 tables. Classification is empirical, not asserted — each line below was
produced by a query in the Reproduce section.

**Summary:** 43 columns cannot be NULL (NOT NULL / PK), 50 have zero NULLs, 52 are structural,
5 are expected, 4 are mixed, **11 are genuinely missing**, 0 are unclassified.

### `game` (4,648 rows)

| Column | NULLs | Classification |
|---|---|---|
| `gsis_game_id`, `pfr_game_id`, `old_game_id` | 285 each | **structural** — all 285 are the 2026 ESPN rows; these id spaces have no 2026 entries yet |
| `gametime_et`, `weekday`, `overtime`, `div_game`, `away_rest`, `home_rest` | 285 each | **structural** — 2026 ESPN feed does not publish them |
| `away_qb_id`, `home_qb_id`, `away_qb_name`, `home_qb_name`, `away_coach`, `home_coach` | 285 each | **structural** — 2026 starters/staff not yet named. **Zero QB-resolution failures**: 0 NULL on any final game |
| `roof`, `surface`, `stadium_id`, `stadium` | 285 each | **structural** — venue attributes absent from the ESPN feed |
| `away_score`, `home_score`, `result`, `total` | 285 each | **structural** — unplayed; CHECK-enforced |
| `week` / `playoff_round` | 201 / 4,447 | **structural** — mutually exclusive by CHECK |
| `away_franchise_id`, `home_franchise_id`, `away_abbr`, `home_abbr` | 13 each | **structural** — TBD playoff slots |
| `location` | 12 | **structural** — the 12 TBD slots with no determined site; the SB slot has one |
| `venue_id` | 4,375 | **structural** — ESPN-only field; 4,363 nflverse rows never carry it + 12 TBD |
| `broadcast` | 4,399 | **structural** — ESPN-only field; 4,363 nflverse + 36 unannounced 2026 games |
| `note` | 4,635 | **expected** — free text |
| `ftn_game_id` | 2,994 | **mixed**: 2,403 structural (pre-2019, FTN charting did not exist) + 285 structural (2026) + **306 MISSING** — 2023 is **0/285**, 2024 13, 2025 7, 2019 1 |
| `temp`, `wind` | 1,684 each | **mixed**: 285 structural (2026 unplayed) + 1,200 structural (dome/closed roof) + **199 MISSING** (open/outdoors finals; 91 of them in 2022, 41 in 2023) |
| `referee` | 286 | **mixed**: 285 structural (2026 crews unassigned) + **1 MISSING** — `2021_15_NE_IND` |

### `game_line` (4,363 rows)

Zero NULLs. Every column is `NOT NULL` by DDL.

### `team_game` (9,270 rows)

| Column | NULLs | Classification |
|---|---|---|
| `week` / `playoff_round` | 376 / 8,894 | **structural** — mutually exclusive |
| `points_for`, `points_against`, `margin`, `spread`, `total_line`, `moneyline`, `rest_days` | 544 each | **structural** — 544 = the 272 resolved 2026 games × 2 sides; unplayed and line-less |
| `won` | 570 | **structural** — 544 unplayed + 26 ties |
| `covered` | 762 | **structural** — 544 unplayed + pushes + line-less |

### `player` (25,035 rows)

| Column | NULLs | Classification |
|---|---|---|
| `draft_year`, `draft_round`, `draft_pick`, `draft_team` | 12,807 each | **structural** — undrafted players. All four NULL together on all 12,807; **zero partial** rows |
| `espn_id` | 8,267 | **expected** — crosswalk coverage |
| `pfr_id` | 2,481 | **expected** — crosswalk coverage; this is what strands B1's 227 snap rows |
| `headshot_url` | 238 | **MISSING** — absent upstream |
| `college` | 93 | **MISSING** — absent upstream |
| `birth_date` | 35 | **MISSING** — absent upstream |
| `weight` | 11 | **MISSING** — absent upstream |
| `height` | 10 | **MISSING** — absent upstream |

17,286 of the 25,035 players have no `player_game_stats` row. That is not a gap: `players.csv` is
nflverse's full historical player universe, and 7,749 distinct ids appear in `player_stats.csv`.

### `player_game_stats` (286,843 rows)

| Column | NULLs | Classification |
|---|---|---|
| `passing_epa` | 276,269 | **structural** — 276,266 have `attempts = 0`. The 3 exceptions have `attempts = 1` and a blank EPA **in the source file** (verified): a DB, an ILB and a K throwing trick/desperation passes. Upstream NA, not a cast failure |
| `rushing_epa` | 251,342 | **structural** — all 251,342 have `carries = 0` |
| `receiving_epa` | 216,935 | **structural** — all 216,935 have `targets = 0` |
| all other 25 columns | 0 | **none** — including `franchise_id` and `opponent_id`, both fully resolved |

### `roster_season` (43,856 rows)

| Column | NULLs | Classification |
|---|---|---|
| `depth_chart_position` | 12,866 | **expected** — optional upstream field, assigned on 70.7% of rows |
| `years_exp` | 531 | **MISSING** — absent upstream |
| `jersey_number` | 241 | **MISSING** — absent upstream |
| `status` | 25 | **MISSING** — absent upstream |
| `gsis_id` | 18 | **MISSING** — no player id upstream; these rows can never join to `player` (see D4) |
| `position` | 16 | **MISSING** — absent upstream |
| `full_name` | 1 | **MISSING** — absent upstream |

### `snap_count` (324,611 rows)

| Column | NULLs | Classification |
|---|---|---|
| `gsis_id` | 227 | **expected** — the source carries no `gsis_id` at all; 227 rows (30 distinct PFR ids) fail the crosswalk. **Owned by agent B1.** |
| all other 13 columns | 0 | **none** |

### `depth_chart` (552,514 rows)

| Column | NULLs | Classification |
|---|---|---|
| `week` | 3,390 | **structural** — all 3,390 carry `season_type = 'SBBYE'`, the Super Bowl bye-week snapshot, which has no week number by construction |
| all other 8 columns | 0 | **none** (1 row has a `gsis_id` absent from `player`: `00-0029389`) |

### `team` (32 rows) / `team_alias` (37 rows)

`team`: zero NULLs. `team_alias.note`: 32 NULLs — **structural**, a note is written only for the
5 historical relocation aliases.

---

## Proposed schema corrections

Not applied. `build_db.py`, `schema.sql` and `nfl.db` belong to the coordinator.

### C1 — `player_game_stats` must carry `game_id`

`player_stats.csv` supplies a `game_id` on every row, and **286,843 of 286,843** resolve to
`game.game_id`. The loader discards it. Loading it fixes D1 and D2 in one change.

```sql
-- schema.sql: add to the player_game_stats DDL
  game_id  TEXT REFERENCES game(game_id),

-- indexes
CREATE INDEX        idx_pgs_game        ON player_game_stats(game_id);
CREATE UNIQUE INDEX idx_pgs_player_game ON player_game_stats(gsis_id, game_id);
```

```python
# build_db.py, in the player_game_stats row builder
prows.append((gid, season, week, st, pick(r, "game_id"), ...))
```

```sql
-- v_player_game: replace the fuzzy join, which is NULL for all 12,050 POST rows
--   LEFT JOIN game g ON g.season = p.season AND g.week = p.week
--        AND g.season_type = p.season_type
--        AND (g.home_franchise_id = p.franchise_id OR g.away_franchise_id = p.franchise_id)
-- with the exact one:
     LEFT JOIN game g ON g.game_id = p.game_id
```

```sql
-- verification after the change (must return 0)
SELECT COUNT(*) FROM v_player_game WHERE game_id IS NULL;
SELECT COUNT(*) FROM player_game_stats p
  LEFT JOIN game g ON g.game_id = p.game_id WHERE g.game_id IS NULL;
```

### C2 — make the identity guard collision-proof

The existing PK `(gsis_id, season, week, season_type)` has **zero collisions today** — measured, not
assumed. It is still the wrong shape: it cannot represent a player appearing for two franchises in
one week, and if that ever appears upstream the second row is destroyed silently and the count just
comes up short. Keep the PK (query shapes and five indexes depend on its column order) and add the
structural guard from C1:

```sql
-- Collision-proof by construction: one player cannot appear twice in one game.
CREATE UNIQUE INDEX idx_pgs_player_game ON player_game_stats(gsis_id, game_id);
```

With this in place a would-be collision raises `IntegrityError` and aborts the build instead of
silently shrinking the table.

### C3 — `snap_count.pfr_game_id` holds the wrong id

The column named `pfr_game_id` contains the nflverse `game_id` on 324,611 of 324,611 rows, and the
real PFR game id from the source is never loaded.

```sql
ALTER TABLE snap_count RENAME COLUMN pfr_game_id TO game_id;
ALTER TABLE snap_count ADD COLUMN pfr_game_id TEXT;   -- the actual PFR id, e.g. '201309080ram'

DROP INDEX IF EXISTS idx_snap_game;
CREATE INDEX idx_snap_game     ON snap_count(game_id);
CREATE INDEX idx_snap_pfr_game ON snap_count(pfr_game_id);
```

```python
# build_db.py, snap_count row builder: load BOTH, and stop letting pick() choose
sc_rows.append((gsis, pfr, pick(r, "game_id"), pick(r, "pfr_game_id"), season, ...))
```

This also gives `snap_count` a real join to `game` and to `player_game_stats` after C1.

### C4 — `roster_season` referential gap and discarded week context

1,608 rows cannot join to `player`. **Do not add an FK**: 1,482 of the ids are genuinely absent from
`players.csv` upstream, so an FK would abort the build and the honest record would be lost. Surface
them instead, and stop discarding the two columns that make the rows distinguishable:

```sql
-- rosters.csv carries both; build_db.py loads neither.
ALTER TABLE roster_season ADD COLUMN week      INTEGER;
ALTER TABLE roster_season ADD COLUMN game_type TEXT;

-- Make the orphan population visible instead of silent.
CREATE VIEW v_roster_orphan AS
SELECT r.* FROM roster_season r
LEFT JOIN player p ON p.gsis_id = r.gsis_id
WHERE r.gsis_id IS NULL OR p.gsis_id IS NULL;   -- expect exactly 1,608
```

### C5 — every drop path must count what it drops

Seven `continue` statements in `build_db.py`'s `build()` discard rows; six of them count nothing.
That is what let 341 rows vanish behind a green build.

| Line | Table | Condition | Rows today | Counted? |
|---|---|---|---|---|
| 128 | `player` | no gsis id, or duplicate | 0 | no |
| 172 | `team_game` | `awayFranchiseId is None` | 26 | no |
| **207** | `player_game_stats` | **no `player_id`, or id absent from the dimension** | **341** | **no** |
| 211 | `player_game_stats` | no season or week | 0 | no |
| 214 | `player_game_stats` | primary-key collision | 0 | no |
| 248 | `snap_count` | no season | 0 | no |
| 282 | `depth_chart` | no season (schema B) | 554,215 | **yes** |

Line 207 also conflates two different causes — "no id at all" and "id not in the dimension" — behind
one `or`. They must be separate counters: today the first is 341 and the second is 0, and if that
ever flips it means the crosswalk broke, which is a completely different problem.

The durable fix is the harness, wired into the build:

```python
# build_db.py, after build() returns
import sys, os
sys.path.insert(0, os.path.join(HERE, "lib"))
from rowloss import reconcile_all

for name, rec in reconcile_all(db_path=tmp).items():
    check(2, f"{name}: every source row loaded or explained", rec.clean,
          f"{rec.unexplained} unexplained, {len(rec.missing_keys)} missing, "
          f"{len(rec.extra_keys)} extra, {len(rec.duplicate_keys)} duplicate keys")
```

`EXPECTED_EXCLUSIONS` in `rowloss.py` pins every legitimate exclusion to an exact count. Widening it
is a deliberate, reviewable edit; drift fails the build.

---

## Reproduce

Run from the repository root. Every number in this report comes from these commands.

```bash
# 1. The whole reconciliation, all 8 tables, keys + values + NULL census.
#    Exits 0 only when every source row is loaded or explained AND every NULL is classified.
python3 scripts/data/nfl-db/lib/rowloss.py --nulls --json scripts/data/nfl-db/cache/b4/rowloss.json
echo "exit=$?"        # -> 0

# 2. One table at a time.
python3 scripts/data/nfl-db/lib/rowloss.py --tables player_game_stats
python3 scripts/data/nfl-db/lib/rowloss.py --tables depth_chart

# 3. Prove the gate actually fails. Perturb a COPY, never nfl.db.
cp scripts/data/nfl-db/nfl.db /tmp/negtest.db
sqlite3 /tmp/negtest.db "DELETE FROM player_game_stats WHERE gsis_id='00-0033873' AND season=2023 AND week=5;
                         DELETE FROM game_line WHERE game_id='2017_04_CHI_GB';
                         DELETE FROM team_game WHERE game_id='2019_01_GB_CHI' AND is_home=0;
                         UPDATE player SET college='Fabricated U' WHERE gsis_id='00-0033873';"
python3 scripts/data/nfl-db/lib/rowloss.py --db /tmp/negtest.db \
        --tables player,game_line,team_game,player_game_stats
echo "exit=$?"        # -> 1; reports 3 missing keys + 1 value drift with a matching key
rm /tmp/negtest.db
```

```bash
# 4. The 341, straight from the CSV -- no harness involved.
python3 - <<'PY'
import csv, collections
csv.field_size_limit(10**9)
known = {r["gsis_id"] for r in csv.DictReader(
    open("scripts/data/nfl-db/raw/players.csv", newline="", encoding="utf-8", errors="replace"))
    if r["gsis_id"]}
drops, n = [], 0
for r in csv.DictReader(open("scripts/data/nfl-db/raw/player_stats.csv",
                             newline="", encoding="utf-8", errors="replace")):
    n += 1
    if not r["player_id"] or r["player_id"] not in known:
        drops.append(r)
print("source rows:", n, "| dropped:", len(drops))
print("distinct player_id among drops:", {r["player_id"] for r in drops})
print("distinct (season,week) among drops:", len({(r["season"], r["week"]) for r in drops}))
print("rows with a non-zero receiving_yards:",
      sum(1 for r in drops if r["receiving_yards"] not in ("", "NA", "0")))
print("rows with non-zero penalties:",
      sum(1 for r in drops if r["penalties"] not in ("", "NA", "0")))
PY
# -> source rows: 287184 | dropped: 341
#    distinct player_id among drops: {''}
#    distinct (season,week) among drops: 341
#    rows with a non-zero receiving_yards: 1
#    rows with non-zero penalties: 310
```

```bash
# 5. Primary-key collisions: ruled out.
python3 - <<'PY'
import csv, collections
csv.field_size_limit(10**9)
seen = collections.defaultdict(set)
for r in csv.DictReader(open("scripts/data/nfl-db/raw/player_stats.csv",
                             newline="", encoding="utf-8", errors="replace")):
    if r["player_id"]:
        seen[(r["player_id"], r["season"], r["week"], r["season_type"])].add(r["team"])
print("distinct PKs:", len(seen))
print("PKs with >1 team:", sum(1 for v in seen.values() if len(v) > 1))
k3 = collections.Counter((k[0], k[1], k[2]) for k in seen)
print("(gsis,season,week) used by both REG and POST:", sum(1 for v in k3.values() if v > 1))
PY
# -> distinct PKs: 286843 | PKs with >1 team: 0 | REG/POST overlap: 0
```

```bash
# 6. Derived-table and view integrity.
sqlite3 scripts/data/nfl-db/nfl.db <<'SQL'
SELECT 'team_game rows',              COUNT(*) FROM team_game;
SELECT 'games with <>2 sides',        COUNT(*) FROM (SELECT game_id FROM team_game GROUP BY 1 HAVING COUNT(*)<>2);
SELECT 'orphan team_game',            COUNT(*) FROM team_game tg LEFT JOIN game g USING(game_id) WHERE g.game_id IS NULL;
SELECT 'resolved games w/o team_game',COUNT(*) FROM game g LEFT JOIN team_game tg USING(game_id)
                                      WHERE g.home_franchise_id IS NOT NULL AND tg.game_id IS NULL;
SELECT 'game_line non-final',         COUNT(*) FROM game_line l JOIN game g USING(game_id) WHERE g.result_status<>'final';
SELECT '2010-2025 games w/o a line',  COUNT(*) FROM game g LEFT JOIN game_line l USING(game_id)
                                      WHERE g.season<=2025 AND l.game_id IS NULL;
SELECT '2026 games with a line',      COUNT(*) FROM game g JOIN game_line l USING(game_id) WHERE g.season=2026;
SELECT 'v_player_game rows',          COUNT(*) FROM v_player_game;        -- 286844, fans out by 1 (D6)
SELECT 'v_player_game NULL game_id',  COUNT(*) FROM v_player_game WHERE game_id IS NULL;  -- 12050 (D2)
SELECT 'snap pfr_game_id in nflverse format',
       COUNT(*) FROM snap_count WHERE pfr_game_id GLOB '[0-9][0-9][0-9][0-9]_[0-9][0-9]_*';  -- 324611 (D3)
SELECT 'roster rows that cannot join to player',
       (SELECT COUNT(*) FROM roster_season WHERE gsis_id IS NULL)
     + (SELECT COUNT(*) FROM roster_season r LEFT JOIN player p USING(gsis_id)
          WHERE r.gsis_id IS NOT NULL AND p.gsis_id IS NULL);             -- 1608 (D4)
SQL
```

```bash
# 7. NULL classification spot-checks.
sqlite3 scripts/data/nfl-db/nfl.db <<'SQL'
SELECT 'temp NULL: dome/closed (structural)', COUNT(*) FROM game WHERE temp IS NULL AND roof IN ('dome','closed');
SELECT 'temp NULL: open finals (MISSING)',    COUNT(*) FROM game WHERE temp IS NULL AND roof IN ('open','outdoors');
SELECT 'ftn_game_id by season', season, COUNT(*), SUM(ftn_game_id IS NOT NULL) FROM game GROUP BY season HAVING season>=2019;
SELECT 'draft cols partially NULL', COUNT(*) FROM player
  WHERE (draft_year IS NULL)+(draft_round IS NULL)+(draft_pick IS NULL)+(draft_team IS NULL) NOT IN (0,4);
SELECT 'passing_epa NULL with attempts>0', COUNT(*) FROM player_game_stats WHERE passing_epa IS NULL AND attempts>0;
SELECT 'depth_chart NULL week by type', season_type, COUNT(*) FROM depth_chart WHERE week IS NULL GROUP BY 1;
SQL
# -> 1200 | 199 | 2023 is 0/285 | 0 | 3 | SBBYE 3390
```

Evidence artifacts:

| File | What it holds |
|---|---|
| `scripts/data/nfl-db/cache/b4/rowloss-full.txt` | full console transcript of command 1 |
| `scripts/data/nfl-db/cache/b4/rowloss.json` | machine-readable result; exceptions capped at 500 per reason (`--json-cap`, default 500 — the depth_chart exclusion alone is 554,215 rows and dumping it whole produces a 94 MB file) |
| `scripts/data/nfl-db/cache/b4/pgs-341-exceptions.json` | **all 341** `player_game_stats` exceptions, uncapped (`--json-cap 0`) |

---

## Appendix A

All 341 excluded `player_game_stats` rows. Every one has `player_id = ''` and `position = ''`;
`team`, `opponent`, `game_id` and `player_name` are `first()`-of-group artifacts and are **not**
meaningful attributes of the row. `csv line` is the 1-indexed line in
`scripts/data/nfl-db/raw/player_stats.csv` including the header. "storable stats" reports the 20
columns `player_game_stats` actually holds.

| # | csv line | season | wk | type | team | opponent | game_id | player_name | penalties | pen yds | safeties | solo tkl | storable stats |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1052 | 2010 | 1 | REG | NO | MIN | 2010_01_MIN_NO | (blank) | 6 | 30 | 1 | 0 | all zero |
| 2 | 2101 | 2010 | 2 | REG | ATL | ARI | 2010_02_ARI_ATL | Team | 8 | 58 | 1 | 7 | all zero |
| 3 | 3149 | 2010 | 3 | REG | BAL | CLE | 2010_03_CLE_BAL | Team | 5 | 26 | 1 | 4 | all zero |
| 4 | 4073 | 2010 | 4 | REG | ATL | SF | 2010_04_SF_ATL | Team | 7 | 34 | 0 | 6 | all zero |
| 5 | 5018 | 2010 | 5 | REG | BAL | DEN | 2010_05_DEN_BAL | Team | 9 | 55 | 0 | 8 | all zero |
| 6 | 5936 | 2010 | 6 | REG | CHI | SEA | 2010_06_SEA_CHI | (blank) | 6 | 30 | 0 | 0 | all zero |
| 7 | 6870 | 2010 | 7 | REG | ATL | CIN | 2010_07_CIN_ATL | (blank) | 6 | 35 | 0 | 0 | all zero |
| 8 | 7741 | 2010 | 8 | REG | CIN | MIA | 2010_08_MIA_CIN | Team | 1 | 5 | 0 | 8 | all zero |
| 9 | 8599 | 2010 | 9 | REG | ATL | TB | 2010_09_TB_ATL | (blank) | 4 | 30 | 0 | 0 | all zero |
| 10 | 9529 | 2010 | 10 | REG | ATL | BAL | 2010_10_BAL_ATL | (blank) | 4 | 30 | 0 | 0 | all zero |
| 11 | 10603 | 2010 | 11 | REG | MIA | CHI | 2010_11_CHI_MIA | Team | 3 | 20 | 1 | 1 | all zero |
| 12 | 11647 | 2010 | 12 | REG | DET | NE | 2010_12_NE_DET | Team | 0 | 0 | 0 | 6 | all zero |
| 13 | 12687 | 2010 | 13 | REG | PHI | HOU | 2010_13_HOU_PHI | Team | 6 | 29 | 0 | 1 | all zero |
| 14 | 13732 | 2010 | 14 | REG | IND | TEN | 2010_14_IND_TEN | (blank) | 2 | 20 | 0 | 0 | all zero |
| 15 | 14787 | 2010 | 15 | REG | LAC | SF | 2010_15_SF_SD | Team | 3 | 25 | 0 | 1 | all zero |
| 16 | 15821 | 2010 | 16 | REG | CAR | PIT | 2010_16_CAR_PIT | Team | 3 | 20 | 0 | 3 | all zero |
| 17 | 16884 | 2010 | 17 | REG | ATL | CAR | 2010_17_CAR_ATL | (blank) | 1 | 1 | 0 | 0 | all zero |
| 18 | 17131 | 2010 | 18 | POST | NO | SEA | 2010_18_NO_SEA | (blank) | 0 | 0 | 0 | 0 | all zero |
| 19 | 17395 | 2010 | 19 | POST | BAL | PIT | 2010_19_BAL_PIT | Team | 0 | 0 | 0 | 2 | all zero |
| 20 | 17525 | 2010 | 20 | POST | GB | CHI | 2010_20_GB_CHI | Team | 0 | 0 | 0 | 1 | all zero |
| 21 | 17591 | 2010 | 21 | POST | PIT | GB | 2010_21_PIT_GB | (blank) | 0 | 0 | 0 | 0 | all zero |
| 22 | 18628 | 2011 | 1 | REG | GB | NO | 2011_01_NO_GB | (blank) | 3 | 18 | 0 | 0 | all zero |
| 23 | 19677 | 2011 | 2 | REG | LV | BUF | 2011_02_OAK_BUF | Team | 8 | 50 | 0 | 1 | all zero |
| 24 | 20718 | 2011 | 3 | REG | NE | BUF | 2011_03_NE_BUF | Team | 1 | 5 | 1 | 3 | all zero |
| 25 | 21766 | 2011 | 4 | REG | CAR | CHI | 2011_04_CAR_CHI | Team | 1 | 5 | 0 | 2 | all zero |
| 26 | 22615 | 2011 | 5 | REG | PHI | BUF | 2011_05_PHI_BUF | Team | 6 | 50 | 0 | 1 | all zero |
| 27 | 23461 | 2011 | 6 | REG | ATL | CAR | 2011_06_CAR_ATL | Team | 6 | 40 | 0 | 2 | all zero |
| 28 | 24316 | 2011 | 7 | REG | CAR | WAS | 2011_07_WAS_CAR | (blank) | 2 | 10 | 1 | 0 | all zero |
| 29 | 25181 | 2011 | 8 | REG | ARI | BAL | 2011_08_ARI_BAL | (blank) | 0 | 0 | 1 | 0 | all zero |
| 30 | 26106 | 2011 | 9 | REG | BUF | NYJ | 2011_09_NYJ_BUF | Team | 5 | 25 | 1 | 1 | all zero |
| 31 | 27125 | 2011 | 10 | REG | LV | LAC | 2011_10_OAK_SD | (blank) | 3 | 25 | 1 | 0 | all zero |
| 32 | 28057 | 2011 | 11 | REG | DEN | NYJ | 2011_11_NYJ_DEN | Team | 0 | 0 | 0 | 1 | all zero |
| 33 | 29092 | 2011 | 12 | REG | DET | GB | 2011_12_GB_DET | Team | 2 | 10 | 0 | 1 | all zero |
| 34 | 30116 | 2011 | 13 | REG | SEA | PHI | 2011_13_PHI_SEA | Team | 2 | 10 | 0 | 2 | all zero |
| 35 | 31186 | 2011 | 14 | REG | CLE | PIT | 2011_14_CLE_PIT | (blank) | 4 | 36 | 0 | 0 | all zero |
| 36 | 32233 | 2011 | 15 | REG | ATL | JAX | 2011_15_JAX_ATL | Team | 7 | 45 | 0 | 1 | all zero |
| 37 | 33286 | 2011 | 16 | REG | IND | HOU | 2011_16_HOU_IND | (blank) | 1 | 5 | 0 | 0 | all zero |
| 38 | 34330 | 2011 | 17 | REG | GB | DET | 2011_17_DET_GB | (blank) | 0 | 0 | 1 | 0 | all zero |
| 39 | 34579 | 2011 | 18 | POST | HOU | CIN | 2011_18_CIN_HOU | (blank) | 4 | 20 | 1 | 0 | all zero |
| 40 | 34837 | 2011 | 19 | POST | NO | SF | 2011_19_NO_SF | (blank) | 1 | 5 | 0 | 0 | all zero |
| 41 | 34967 | 2011 | 20 | POST | BAL | NE | 2011_20_BAL_NE | (blank) | 1 | 5 | 0 | 0 | all zero |
| 42 | 35031 | 2011 | 21 | POST | NYG | NE | 2011_21_NYG_NE | (blank) | 1 | 5 | 1 | 0 | all zero |
| 43 | 36066 | 2012 | 1 | REG | NYG | DAL | 2012_01_DAL_NYG | Team | 3 | 15 | 0 | 3 | all zero |
| 44 | 37113 | 2012 | 2 | REG | GB | CHI | 2012_02_CHI_GB | (blank) | 6 | 29 | 0 | 0 | all zero |
| 45 | 38159 | 2012 | 3 | REG | NYG | CAR | 2012_03_NYG_CAR | Team | 3 | 40 | 0 | 1 | all zero |
| 46 | 39119 | 2012 | 4 | REG | CLE | BAL | 2012_04_CLE_BAL | (blank) | 1 | 15 | 0 | 0 | all zero |
| 47 | 40044 | 2012 | 5 | REG | LA | ARI | 2012_05_ARI_STL | (blank) | 3 | 25 | 0 | 0 | all zero |
| 48 | 40958 | 2012 | 6 | REG | TEN | PIT | 2012_06_PIT_TEN | D.Bryant | 2 | 10 | 0 | 0 | 2 rec / 2 tgt / 11 rec yds / 1.1 FP |
| 49 | 41804 | 2012 | 7 | REG | SF | SEA | 2012_07_SEA_SF | Team | 3 | 10 | 1 | 1 | all zero |
| 50 | 42706 | 2012 | 8 | REG | MIN | TB | 2012_08_TB_MIN | Team | 0 | 0 | 0 | 1 | all zero |
| 51 | 43641 | 2012 | 9 | REG | LAC | KC | 2012_09_KC_SD | Team | 2 | 10 | 1 | 1 | all zero |
| 52 | 44557 | 2012 | 10 | REG | JAX | IND | 2012_10_IND_JAX | (blank) | 4 | 40 | 0 | 0 | all zero |
| 53 | 45493 | 2012 | 11 | REG | MIA | BUF | 2012_11_MIA_BUF | Team | 2 | 20 | 0 | 4 | all zero |
| 54 | 46541 | 2012 | 12 | REG | DET | HOU | 2012_12_HOU_DET | (blank) | 7 | 50 | 1 | 0 | all zero |
| 55 | 47567 | 2012 | 13 | REG | ATL | NO | 2012_13_NO_ATL | Team | 4 | 20 | 1 | 5 | all zero |
| 56 | 48617 | 2012 | 14 | REG | DEN | LV | 2012_14_DEN_OAK | Team | 6 | 30 | 0 | 3 | all zero |
| 57 | 49662 | 2012 | 15 | REG | CIN | PHI | 2012_15_CIN_PHI | Team | 5 | 39 | 0 | 4 | all zero |
| 58 | 50709 | 2012 | 16 | REG | DET | ATL | 2012_16_ATL_DET | (blank) | 2 | 10 | 0 | 0 | all zero |
| 59 | 51760 | 2012 | 17 | REG | ATL | TB | 2012_17_TB_ATL | Team | 4 | 27 | 0 | 1 | all zero |
| 60 | 52021 | 2012 | 18 | POST | HOU | CIN | 2012_18_CIN_HOU | (blank) | 0 | 0 | 0 | 0 | all zero |
| 61 | 52274 | 2012 | 19 | POST | BAL | DEN | 2012_19_BAL_DEN | (blank) | 3 | 11 | 0 | 0 | all zero |
| 62 | 52391 | 2012 | 20 | POST | ATL | SF | 2012_20_SF_ATL | (blank) | 1 | 5 | 0 | 0 | all zero |
| 63 | 52450 | 2012 | 21 | POST | SF | BAL | 2012_21_BAL_SF | (blank) | 0 | 0 | 0 | 0 | all zero |
| 64 | 53457 | 2013 | 1 | REG | BAL | DEN | 2013_01_BAL_DEN | (blank) | 9 | 45 | 2 | 0 | all zero |
| 65 | 54475 | 2013 | 2 | REG | NE | NYJ | 2013_02_NYJ_NE | Team | 4 | 20 | 1 | 1 | all zero |
| 66 | 55501 | 2013 | 3 | REG | KC | PHI | 2013_03_KC_PHI | Team | 5 | 45 | 0 | 2 | all zero |
| 67 | 56474 | 2013 | 4 | REG | LA | SF | 2013_04_SF_STL | Team | 7 | 35 | 0 | 1 | all zero |
| 68 | 57371 | 2013 | 5 | REG | CLE | BUF | 2013_05_BUF_CLE | Team | 5 | 25 | 0 | 1 | all zero |
| 69 | 58372 | 2013 | 6 | REG | NYG | CHI | 2013_06_NYG_CHI | Team | 6 | 55 | 0 | 2 | all zero |
| 70 | 59342 | 2013 | 7 | REG | ARI | SEA | 2013_07_SEA_ARI | (blank) | 4 | 30 | 0 | 0 | all zero |
| 71 | 60192 | 2013 | 8 | REG | TB | CAR | 2013_08_CAR_TB | Team | 3 | 25 | 0 | 2 | all zero |
| 72 | 61041 | 2013 | 9 | REG | MIA | CIN | 2013_09_CIN_MIA | (blank) | 5 | 25 | 0 | 0 | all zero |
| 73 | 61939 | 2013 | 10 | REG | MIN | WAS | 2013_10_WAS_MIN | (blank) | 4 | 23 | 1 | 0 | all zero |
| 74 | 62914 | 2013 | 11 | REG | TEN | IND | 2013_11_IND_TEN | (blank) | 6 | 30 | 0 | 0 | all zero |
| 75 | 63828 | 2013 | 12 | REG | NO | ATL | 2013_12_NO_ATL | Team | 3 | 25 | 0 | 1 | all zero |
| 76 | 64873 | 2013 | 13 | REG | DET | GB | 2013_13_GB_DET | (blank) | 4 | 20 | 1 | 0 | all zero |
| 77 | 65929 | 2013 | 14 | REG | JAX | HOU | 2013_14_HOU_JAX | (blank) | 6 | 40 | 0 | 0 | all zero |
| 78 | 66945 | 2013 | 15 | REG | DEN | LAC | 2013_15_SD_DEN | (blank) | 5 | 25 | 0 | 0 | all zero |
| 79 | 67982 | 2013 | 16 | REG | MIA | BUF | 2013_16_MIA_BUF | Team | 5 | 21 | 0 | 1 | all zero |
| 80 | 69001 | 2013 | 17 | REG | ATL | CAR | 2013_17_CAR_ATL | (blank) | 1 | 5 | 0 | 0 | all zero |
| 81 | 69249 | 2013 | 18 | POST | KC | IND | 2013_18_KC_IND | (blank) | 0 | 0 | 0 | 0 | all zero |
| 82 | 69497 | 2013 | 19 | POST | NO | SEA | 2013_19_NO_SEA | (blank) | 3 | 25 | 1 | 0 | all zero |
| 83 | 69624 | 2013 | 20 | POST | NE | DEN | 2013_20_NE_DEN | (blank) | 0 | 0 | 0 | 0 | all zero |
| 84 | 69698 | 2013 | 21 | POST | SEA | DEN | 2013_21_SEA_DEN | (blank) | 0 | 0 | 0 | 0 | all zero |
| 85 | 70743 | 2014 | 1 | REG | GB | SEA | 2014_01_GB_SEA | (blank) | 2 | 10 | 0 | 0 | all zero |
| 86 | 71786 | 2014 | 2 | REG | PIT | BAL | 2014_02_PIT_BAL | Team | 8 | 60 | 0 | 1 | all zero |
| 87 | 72849 | 2014 | 3 | REG | ATL | TB | 2014_03_TB_ATL | (blank) | 12 | 63 | 3 | 0 | all zero |
| 88 | 73708 | 2014 | 4 | REG | NYG | WAS | 2014_04_NYG_WAS | (blank) | 7 | 40 | 0 | 0 | all zero |
| 89 | 74703 | 2014 | 5 | REG | GB | MIN | 2014_05_MIN_GB | (blank) | 7 | 35 | 0 | 0 | all zero |
| 90 | 75692 | 2014 | 6 | REG | HOU | IND | 2014_06_IND_HOU | (blank) | 3 | 15 | 0 | 0 | all zero |
| 91 | 76667 | 2014 | 7 | REG | NE | NYJ | 2014_07_NYJ_NE | (blank) | 7 | 34 | 0 | 0 | all zero |
| 92 | 77660 | 2014 | 8 | REG | DEN | LAC | 2014_08_SD_DEN | (blank) | 5 | 22 | 1 | 0 | all zero |
| 93 | 78533 | 2014 | 9 | REG | NO | CAR | 2014_09_NO_CAR | (blank) | 1 | 5 | 0 | 0 | all zero |
| 94 | 79410 | 2014 | 10 | REG | CIN | CLE | 2014_10_CLE_CIN | (blank) | 5 | 31 | 1 | 0 | all zero |
| 95 | 80327 | 2014 | 11 | REG | MIA | BUF | 2014_11_BUF_MIA | (blank) | 3 | 25 | 1 | 0 | all zero |
| 96 | 81323 | 2014 | 12 | REG | KC | LV | 2014_12_KC_OAK | (blank) | 5 | 25 | 0 | 0 | all zero |
| 97 | 82377 | 2014 | 13 | REG | DET | CHI | 2014_13_CHI_DET | (blank) | 6 | 31 | 0 | 0 | all zero |
| 98 | 83426 | 2014 | 14 | REG | DAL | CHI | 2014_14_DAL_CHI | Team | 4 | 30 | 0 | 1 | all zero |
| 99 | 84494 | 2014 | 15 | REG | ARI | LA | 2014_15_ARI_STL | (blank) | 3 | 15 | 2 | 0 | all zero |
| 100 | 85536 | 2014 | 16 | REG | TEN | JAX | 2014_16_TEN_JAX | Team | 4 | 38 | 0 | 1 | all zero |
| 101 | 86588 | 2014 | 17 | REG | BAL | CLE | 2014_17_CLE_BAL | Team | 4 | 30 | 1 | 1 | all zero |
| 102 | 86862 | 2014 | 18 | POST | ARI | CAR | 2014_18_ARI_CAR | (blank) | 2 | 10 | 0 | 0 | all zero |
| 103 | 87122 | 2014 | 19 | POST | BAL | NE | 2014_19_BAL_NE | (blank) | 1 | 5 | 0 | 0 | all zero |
| 104 | 87261 | 2014 | 20 | POST | GB | SEA | 2014_20_GB_SEA | (blank) | 0 | 0 | 0 | 0 | all zero |
| 105 | 87320 | 2014 | 21 | POST | NE | SEA | 2014_21_NE_SEA | (blank) | 1 | 1 | 0 | 0 | all zero |
| 106 | 88347 | 2015 | 1 | REG | PIT | NE | 2015_01_PIT_NE | Team | 1 | 5 | 0 | 3 | all zero |
| 107 | 89398 | 2015 | 2 | REG | DEN | KC | 2015_02_DEN_KC | Team | 5 | 28 | 0 | 5 | all zero |
| 108 | 90459 | 2015 | 3 | REG | WAS | NYG | 2015_03_WAS_NYG | Team | 4 | 30 | 0 | 1 | all zero |
| 109 | 91460 | 2015 | 4 | REG | PIT | BAL | 2015_04_BAL_PIT | Team | 4 | 19 | 0 | 1 | all zero |
| 110 | 92369 | 2015 | 5 | REG | HOU | IND | 2015_05_IND_HOU | Team | 6 | 50 | 0 | 2 | all zero |
| 111 | 93293 | 2015 | 6 | REG | NO | ATL | 2015_06_ATL_NO | (blank) | 3 | 25 | 0 | 0 | all zero |
| 112 | 94221 | 2015 | 7 | REG | SF | SEA | 2015_07_SEA_SF | (blank) | 6 | 30 | 1 | 0 | all zero |
| 113 | 95153 | 2015 | 8 | REG | NE | MIA | 2015_08_MIA_NE | (blank) | 1 | 2 | 1 | 0 | all zero |
| 114 | 95996 | 2015 | 9 | REG | CLE | CIN | 2015_09_CLE_CIN | (blank) | 2 | 10 | 1 | 0 | all zero |
| 115 | 96937 | 2015 | 10 | REG | NYJ | BUF | 2015_10_BUF_NYJ | (blank) | 6 | 27 | 0 | 0 | all zero |
| 116 | 97850 | 2015 | 11 | REG | TEN | JAX | 2015_11_TEN_JAX | (blank) | 7 | 45 | 1 | 0 | all zero |
| 117 | 98916 | 2015 | 12 | REG | PHI | DET | 2015_12_PHI_DET | (blank) | 4 | 30 | 0 | 0 | all zero |
| 118 | 99983 | 2015 | 13 | REG | GB | DET | 2015_13_GB_DET | (blank) | 7 | 45 | 0 | 0 | all zero |
| 119 | 101030 | 2015 | 14 | REG | ARI | MIN | 2015_14_MIN_ARI | (blank) | 1 | 5 | 0 | 0 | all zero |
| 120 | 102094 | 2015 | 15 | REG | LA | TB | 2015_15_TB_STL | (blank) | 5 | 35 | 0 | 0 | all zero |
| 121 | 103153 | 2015 | 16 | REG | LV | LAC | 2015_16_SD_OAK | Team | 5 | 37 | 0 | 1 | all zero |
| 122 | 104225 | 2015 | 17 | REG | NO | ATL | 2015_17_NO_ATL | (blank) | 1 | 5 | 0 | 0 | all zero |
| 123 | 104485 | 2015 | 18 | POST | HOU | KC | 2015_18_KC_HOU | (blank) | 2 | 30 | 0 | 0 | all zero |
| 124 | 104734 | 2015 | 19 | POST | NE | KC | 2015_19_KC_NE | (blank) | 0 | 0 | 0 | 0 | all zero |
| 125 | 104866 | 2015 | 20 | POST | NE | DEN | 2015_20_NE_DEN | (blank) | 1 | 5 | 0 | 0 | all zero |
| 126 | 104933 | 2015 | 21 | POST | DEN | CAR | 2015_21_CAR_DEN | (blank) | 0 | 0 | 0 | 0 | all zero |
| 127 | 105937 | 2016 | 1 | REG | DEN | CAR | 2016_01_CAR_DEN | (blank) | 7 | 57 | 2 | 0 | all zero |
| 128 | 107000 | 2016 | 2 | REG | NYJ | BUF | 2016_02_NYJ_BUF | (blank) | 8 | 44 | 0 | 0 | all zero |
| 129 | 108075 | 2016 | 3 | REG | HOU | NE | 2016_03_HOU_NE | (blank) | 3 | 10 | 0 | 0 | all zero |
| 130 | 109078 | 2016 | 4 | REG | CIN | MIA | 2016_04_MIA_CIN | (blank) | 7 | 35 | 0 | 0 | all zero |
| 131 | 109981 | 2016 | 5 | REG | ARI | SF | 2016_05_ARI_SF | (blank) | 8 | 45 | 1 | 0 | all zero |
| 132 | 110988 | 2016 | 6 | REG | LAC | DEN | 2016_06_DEN_SD | (blank) | 9 | 45 | 1 | 0 | all zero |
| 133 | 111985 | 2016 | 7 | REG | CHI | GB | 2016_07_CHI_GB | (blank) | 3 | 15 | 0 | 0 | all zero |
| 134 | 112831 | 2016 | 8 | REG | TEN | JAX | 2016_08_JAX_TEN | (blank) | 12 | 59 | 0 | 0 | all zero |
| 135 | 113695 | 2016 | 9 | REG | TB | ATL | 2016_09_ATL_TB | Team | 7 | 30 | 0 | 1 | all zero |
| 136 | 114613 | 2016 | 10 | REG | CLE | None | 2016_10_CLE_BAL | (blank) | 6 | 36 | 1 | 0 | all zero |
| 137 | 115538 | 2016 | 11 | REG | NO | CAR | 2016_11_NO_CAR | (blank) | 7 | 40 | 0 | 0 | all zero |
| 138 | 116558 | 2016 | 12 | REG | DET | MIN | 2016_12_MIN_DET | (blank) | 9 | 78 | 3 | 0 | all zero |
| 139 | 117549 | 2016 | 13 | REG | DAL | MIN | 2016_13_DAL_MIN | (blank) | 3 | 11 | 1 | 0 | all zero |
| 140 | 118607 | 2016 | 14 | REG | LV | KC | 2016_14_OAK_KC | (blank) | 5 | 35 | 0 | 0 | all zero |
| 141 | 119655 | 2016 | 15 | REG | LA | SEA | 2016_15_LA_SEA | (blank) | 4 | 20 | 1 | 0 | all zero |
| 142 | 120700 | 2016 | 16 | REG | NYG | PHI | 2016_16_NYG_PHI | (blank) | 12 | 59 | 0 | 0 | all zero |
| 143 | 121773 | 2016 | 17 | REG | BAL | CIN | 2016_17_BAL_CIN | (blank) | 4 | 20 | 1 | 0 | all zero |
| 144 | 122037 | 2016 | 18 | POST | HOU | LV | 2016_18_OAK_HOU | (blank) | 1 | 5 | 0 | 0 | all zero |
| 145 | 122291 | 2016 | 19 | POST | SEA | ATL | 2016_19_SEA_ATL | (blank) | 0 | 0 | 0 | 0 | all zero |
| 146 | 122418 | 2016 | 20 | POST | ATL | GB | 2016_20_GB_ATL | (blank) | 0 | 0 | 0 | 0 | all zero |
| 147 | 122485 | 2016 | 21 | POST | NE | ATL | 2016_21_NE_ATL | (blank) | 0 | 0 | 0 | 0 | all zero |
| 148 | 123462 | 2017 | 1 | REG | NE | KC | 2017_01_KC_NE | (blank) | 3 | 15 | 0 | 0 | all zero |
| 149 | 124518 | 2017 | 2 | REG | HOU | CIN | 2017_02_HOU_CIN | (blank) | 7 | 52 | 0 | 0 | all zero |
| 150 | 125564 | 2017 | 3 | REG | SF | LA | 2017_03_LA_SF | (blank) | 7 | 34 | 0 | 0 | all zero |
| 151 | 126603 | 2017 | 4 | REG | GB | CHI | 2017_04_CHI_GB | (blank) | 2 | 6 | 0 | 0 | all zero |
| 152 | 127522 | 2017 | 5 | REG | NE | TB | 2017_05_NE_TB | (blank) | 7 | 42 | 1 | 0 | all zero |
| 153 | 128431 | 2017 | 6 | REG | PHI | CAR | 2017_06_PHI_CAR | (blank) | 4 | 20 | 2 | 0 | all zero |
| 154 | 129411 | 2017 | 7 | REG | KC | LV | 2017_07_KC_OAK | (blank) | 2 | 3 | 0 | 0 | all zero |
| 155 | 130262 | 2017 | 8 | REG | MIA | BAL | 2017_08_MIA_BAL | (blank) | 0 | 0 | 0 | 0 | all zero |
| 156 | 131129 | 2017 | 9 | REG | NYJ | BUF | 2017_09_BUF_NYJ | (blank) | 3 | 15 | 0 | 0 | all zero |
| 157 | 132055 | 2017 | 10 | REG | SEA | ARI | 2017_10_SEA_ARI | (blank) | 3 | 15 | 0 | 0 | all zero |
| 158 | 132973 | 2017 | 11 | REG | PIT | TEN | 2017_11_TEN_PIT | (blank) | 7 | 45 | 0 | 0 | all zero |
| 159 | 133988 | 2017 | 12 | REG | DET | MIN | 2017_12_MIN_DET | (blank) | 9 | 53 | 0 | 0 | all zero |
| 160 | 135034 | 2017 | 13 | REG | DAL | WAS | 2017_13_WAS_DAL | Team | 4 | 19 | 1 | 1 | all zero |
| 161 | 136102 | 2017 | 14 | REG | NO | ATL | 2017_14_NO_ATL | (blank) | 3 | 25 | 0 | 0 | all zero |
| 162 | 137174 | 2017 | 15 | REG | DEN | IND | 2017_15_DEN_IND | (blank) | 8 | 40 | 1 | 0 | all zero |
| 163 | 138227 | 2017 | 16 | REG | IND | BAL | 2017_16_IND_BAL | (blank) | 9 | 49 | 0 | 0 | all zero |
| 164 | 139271 | 2017 | 17 | REG | GB | DET | 2017_17_GB_DET | (blank) | 4 | 15 | 1 | 0 | all zero |
| 165 | 139524 | 2017 | 18 | POST | KC | TEN | 2017_18_TEN_KC | (blank) | 0 | 0 | 0 | 0 | all zero |
| 166 | 139779 | 2017 | 19 | POST | PHI | ATL | 2017_19_ATL_PHI | (blank) | 0 | 0 | 0 | 0 | all zero |
| 167 | 139903 | 2017 | 20 | POST | NE | JAX | 2017_20_JAX_NE | (blank) | 1 | 5 | 0 | 0 | all zero |
| 168 | 139962 | 2017 | 21 | POST | PHI | NE | 2017_21_PHI_NE | (blank) | 0 | 0 | 0 | 0 | all zero |
| 169 | 141033 | 2018 | 1 | REG | ATL | PHI | 2018_01_ATL_PHI | (blank) | 15 | 73 | 0 | 0 | all zero |
| 170 | 142063 | 2018 | 2 | REG | BAL | CIN | 2018_02_BAL_CIN | (blank) | 8 | 46 | 0 | 0 | all zero |
| 171 | 143125 | 2018 | 3 | REG | CLE | NYJ | 2018_03_NYJ_CLE | (blank) | 21 | 103 | 0 | 0 | all zero |
| 172 | 144103 | 2018 | 4 | REG | MIN | LA | 2018_04_MIN_LA | (blank) | 8 | 36 | 0 | 0 | all zero |
| 173 | 145091 | 2018 | 5 | REG | NE | IND | 2018_05_IND_NE | (blank) | 12 | 58 | 0 | 0 | all zero |
| 174 | 146069 | 2018 | 6 | REG | PHI | NYG | 2018_06_PHI_NYG | (blank) | 14 | 67 | 0 | 0 | all zero |
| 175 | 146964 | 2018 | 7 | REG | ARI | None | 2018_07_DEN_ARI | (blank) | 12 | 65 | 1 | 0 | all zero |
| 176 | 147876 | 2018 | 8 | REG | MIA | HOU | 2018_08_MIA_HOU | (blank) | 13 | 65 | 2 | 0 | all zero |
| 177 | 148735 | 2018 | 9 | REG | LV | SF | 2018_09_OAK_SF | (blank) | 15 | 70 | 0 | 0 | all zero |
| 178 | 149652 | 2018 | 10 | REG | CAR | PIT | 2018_10_CAR_PIT | (blank) | 4 | 30 | 0 | 0 | all zero |
| 179 | 150503 | 2018 | 11 | REG | SEA | GB | 2018_11_GB_SEA | R.Rodgers | 9 | 47 | 0 | 0 | all zero |
| 180 | 151478 | 2018 | 12 | REG | DET | CHI | 2018_12_CHI_DET | (blank) | 23 | 109 | 0 | 0 | all zero |
| 181 | 152523 | 2018 | 13 | REG | DAL | NO | 2018_13_NO_DAL | (blank) | 16 | 95 | 0 | 0 | all zero |
| 182 | 153566 | 2018 | 14 | REG | TEN | JAX | 2018_14_JAX_TEN | (blank) | 12 | 54 | 0 | 0 | all zero |
| 183 | 154612 | 2018 | 15 | REG | KC | LAC | 2018_15_LAC_KC | (blank) | 16 | 90 | 0 | 0 | all zero |
| 184 | 155649 | 2018 | 16 | REG | WAS | TEN | 2018_16_WAS_TEN | (blank) | 18 | 90 | 0 | 0 | all zero |
| 185 | 156690 | 2018 | 17 | REG | BUF | MIA | 2018_17_MIA_BUF | (blank) | 12 | 57 | 0 | 0 | all zero |
| 186 | 156934 | 2018 | 18 | POST | IND | HOU | 2018_18_IND_HOU | (blank) | 3 | 15 | 0 | 0 | all zero |
| 187 | 157188 | 2018 | 19 | POST | IND | KC | 2018_19_IND_KC | (blank) | 5 | 25 | 0 | 0 | all zero |
| 188 | 157320 | 2018 | 20 | POST | NO | LA | 2018_20_LA_NO | (blank) | 2 | 10 | 0 | 0 | all zero |
| 189 | 157376 | 2018 | 21 | POST | NE | LA | 2018_21_NE_LA | (blank) | 3 | 15 | 0 | 0 | all zero |
| 190 | 158404 | 2019 | 1 | REG | GB | CHI | 2019_01_GB_CHI | Team | 12 | 60 | 0 | 1 | all zero |
| 191 | 159469 | 2019 | 2 | REG | TB | CAR | 2019_02_TB_CAR | (blank) | 18 | 79 | 0 | 0 | all zero |
| 192 | 160490 | 2019 | 3 | REG | JAX | TEN | 2019_03_TEN_JAX | (blank) | 12 | 66 | 0 | 0 | all zero |
| 193 | 161450 | 2019 | 4 | REG | PHI | GB | 2019_04_PHI_GB | (blank) | 14 | 70 | 0 | 0 | all zero |
| 194 | 162441 | 2019 | 5 | REG | SEA | LA | 2019_05_LA_SEA | Team | 15 | 81 | 0 | 0 | all zero |
| 195 | 163342 | 2019 | 6 | REG | NE | NYG | 2019_06_NYG_NE | (blank) | 13 | 60 | 0 | 0 | all zero |
| 196 | 164264 | 2019 | 7 | REG | DEN | KC | 2019_07_KC_DEN | (blank) | 12 | 60 | 2 | 0 | all zero |
| 197 | 165234 | 2019 | 8 | REG | MIN | WAS | 2019_08_WAS_MIN | (blank) | 12 | 60 | 0 | 0 | all zero |
| 198 | 166150 | 2019 | 9 | REG | ARI | SF | 2019_09_SF_ARI | (blank) | 10 | 47 | 1 | 0 | all zero |
| 199 | 167011 | 2019 | 10 | REG | LAC | LV | 2019_10_LAC_OAK | (blank) | 15 | 76 | 0 | 0 | all zero |
| 200 | 167934 | 2019 | 11 | REG | PIT | CLE | 2019_11_PIT_CLE | (blank) | 15 | 75 | 0 | 0 | all zero |
| 201 | 168859 | 2019 | 12 | REG | IND | HOU | 2019_12_IND_HOU | (blank) | 14 | 70 | 0 | 0 | all zero |
| 202 | 169892 | 2019 | 13 | REG | CHI | DET | 2019_13_CHI_DET | (blank) | 14 | 70 | 1 | 0 | all zero |
| 203 | 170939 | 2019 | 14 | REG | DAL | CHI | 2019_14_DAL_CHI | (blank) | 8 | 35 | 0 | 0 | all zero |
| 204 | 171981 | 2019 | 15 | REG | NYJ | BAL | 2019_15_NYJ_BAL | (blank) | 22 | 102 | 0 | 1 | all zero |
| 205 | 173020 | 2019 | 16 | REG | TB | HOU | 2019_16_HOU_TB | (blank) | 11 | 52 | 0 | 0 | all zero |
| 206 | 174039 | 2019 | 17 | REG | NYJ | BUF | 2019_17_NYJ_BUF | (blank) | 14 | 69 | 1 | 0 | all zero |
| 207 | 174288 | 2019 | 18 | POST | BUF | HOU | 2019_18_BUF_HOU | (blank) | 7 | 35 | 0 | 0 | all zero |
| 208 | 174544 | 2019 | 19 | POST | MIN | SF | 2019_19_MIN_SF | (blank) | 4 | 20 | 0 | 0 | all zero |
| 209 | 174675 | 2019 | 20 | POST | TEN | KC | 2019_20_TEN_KC | (blank) | 3 | 15 | 0 | 0 | all zero |
| 210 | 174738 | 2019 | 21 | POST | KC | SF | 2019_21_SF_KC | (blank) | 0 | 0 | 0 | 0 | all zero |
| 211 | 175769 | 2020 | 1 | REG | HOU | KC | 2020_01_HOU_KC | (blank) | 15 | 73 | 0 | 0 | all zero |
| 212 | 176815 | 2020 | 2 | REG | CIN | CLE | 2020_02_CIN_CLE | (blank) | 11 | 55 | 0 | 0 | all zero |
| 213 | 177864 | 2020 | 3 | REG | MIA | JAX | 2020_03_MIA_JAX | (blank) | 10 | 47 | 0 | 0 | all zero |
| 214 | 178844 | 2020 | 4 | REG | NYJ | DEN | 2020_04_DEN_NYJ | (blank) | 7 | 30 | 0 | 0 | all zero |
| 215 | 179769 | 2020 | 5 | REG | TB | CHI | 2020_05_TB_CHI | (blank) | 11 | 55 | 1 | 0 | all zero |
| 216 | 180687 | 2020 | 6 | REG | CAR | CHI | 2020_06_CHI_CAR | (blank) | 16 | 77 | 0 | 0 | all zero |
| 217 | 181628 | 2020 | 7 | REG | PHI | NYG | 2020_07_NYG_PHI | (blank) | 7 | 36 | 0 | 0 | all zero |
| 218 | 182541 | 2020 | 8 | REG | ATL | CAR | 2020_08_ATL_CAR | (blank) | 17 | 80 | 1 | 0 | all zero |
| 219 | 183454 | 2020 | 9 | REG | GB | SF | 2020_09_GB_SF | (blank) | 10 | 50 | 0 | 0 | all zero |
| 220 | 184363 | 2020 | 10 | REG | TEN | IND | 2020_10_IND_TEN | (blank) | 20 | 99 | 0 | 1 | all zero |
| 221 | 185295 | 2020 | 11 | REG | SEA | ARI | 2020_11_ARI_SEA | (blank) | 14 | 79 | 1 | 0 | all zero |
| 222 | 186347 | 2020 | 12 | REG | HOU | DET | 2020_12_HOU_DET | (blank) | 16 | 78 | 0 | 0 | all zero |
| 223 | 187335 | 2020 | 13 | REG | ATL | NO | 2020_13_NO_ATL | (blank) | 13 | 64 | 0 | 0 | all zero |
| 224 | 188368 | 2020 | 14 | REG | LA | NE | 2020_14_NE_LA | (blank) | 14 | 70 | 0 | 0 | all zero |
| 225 | 189416 | 2020 | 15 | REG | LV | LAC | 2020_15_LAC_LV | (blank) | 7 | 35 | 2 | 0 | all zero |
| 226 | 190487 | 2020 | 16 | REG | NO | MIN | 2020_16_MIN_NO | (blank) | 16 | 83 | 0 | 0 | all zero |
| 227 | 191512 | 2020 | 17 | REG | BUF | MIA | 2020_17_MIA_BUF | (blank) | 6 | 30 | 1 | 0 | all zero |
| 228 | 191891 | 2020 | 18 | POST | IND | BUF | 2020_18_IND_BUF | (blank) | 6 | 40 | 0 | 0 | all zero |
| 229 | 192152 | 2020 | 19 | POST | LA | GB | 2020_19_LA_GB | (blank) | 0 | 0 | 0 | 0 | all zero |
| 230 | 192277 | 2020 | 20 | POST | TB | GB | 2020_20_TB_GB | (blank) | 2 | 10 | 0 | 0 | all zero |
| 231 | 192340 | 2020 | 21 | POST | TB | KC | 2020_21_KC_TB | (blank) | 0 | 0 | 0 | 0 | all zero |
| 232 | 193421 | 2021 | 1 | REG | TB | DAL | 2021_01_DAL_TB | (blank) | 21 | 96 | 0 | 0 | all zero |
| 233 | 194489 | 2021 | 2 | REG | WAS | NYG | 2021_02_NYG_WAS | (blank) | 9 | 45 | 0 | 0 | all zero |
| 234 | 195537 | 2021 | 3 | REG | CAR | HOU | 2021_03_CAR_HOU | (blank) | 12 | 60 | 0 | 0 | all zero |
| 235 | 196596 | 2021 | 4 | REG | JAX | CIN | 2021_04_JAX_CIN | (blank) | 19 | 86 | 0 | 0 | all zero |
| 236 | 197647 | 2021 | 5 | REG | LA | SEA | 2021_05_LA_SEA | (blank) | 13 | 61 | 1 | 0 | all zero |
| 237 | 198581 | 2021 | 6 | REG | TB | PHI | 2021_06_TB_PHI | (blank) | 17 | 83 | 0 | 0 | all zero |
| 238 | 199470 | 2021 | 7 | REG | CLE | DEN | 2021_07_DEN_CLE | (blank) | 9 | 45 | 1 | 0 | all zero |
| 239 | 200482 | 2021 | 8 | REG | GB | ARI | 2021_08_GB_ARI | (blank) | 17 | 83 | 0 | 0 | all zero |
| 240 | 201430 | 2021 | 9 | REG | NYJ | IND | 2021_09_NYJ_IND | (blank) | 21 | 124 | 0 | 0 | all zero |
| 241 | 202402 | 2021 | 10 | REG | BAL | MIA | 2021_10_BAL_MIA | (blank) | 16 | 71 | 0 | 0 | all zero |
| 242 | 203420 | 2021 | 11 | REG | NE | ATL | 2021_11_NE_ATL | (blank) | 17 | 82 | 0 | 0 | all zero |
| 243 | 204426 | 2021 | 12 | REG | CHI | DET | 2021_12_CHI_DET | (blank) | 12 | 61 | 0 | 0 | all zero |
| 244 | 205341 | 2021 | 13 | REG | NO | DAL | 2021_13_DAL_NO | (blank) | 15 | 69 | 0 | 0 | all zero |
| 245 | 206274 | 2021 | 14 | REG | MIN | PIT | 2021_14_PIT_MIN | (blank) | 14 | 69 | 0 | 0 | all zero |
| 246 | 207318 | 2021 | 15 | REG | LAC | KC | 2021_15_KC_LAC | (blank) | 22 | 118 | 0 | 0 | all zero |
| 247 | 208381 | 2021 | 16 | REG | SF | TEN | 2021_16_SF_TEN | (blank) | 3 | 15 | 1 | 0 | all zero |
| 248 | 209414 | 2021 | 17 | REG | BAL | LA | 2021_17_LA_BAL | (blank) | 10 | 49 | 1 | 0 | all zero |
| 249 | 210468 | 2021 | 18 | REG | DEN | KC | 2021_18_KC_DEN | (blank) | 5 | 25 | 0 | 0 | all zero |
| 250 | 210884 | 2021 | 19 | POST | LV | CIN | 2021_19_LV_CIN | (blank) | 6 | 29 | 0 | 0 | all zero |
| 251 | 211132 | 2021 | 20 | POST | TEN | CIN | 2021_20_CIN_TEN | (blank) | 5 | 21 | 0 | 0 | all zero |
| 252 | 211249 | 2021 | 21 | POST | CIN | KC | 2021_21_CIN_KC | (blank) | 3 | 16 | 0 | 0 | all zero |
| 253 | 211309 | 2021 | 22 | POST | LA | CIN | 2021_22_LA_CIN | (blank) | 2 | 15 | 0 | 0 | all zero |
| 254 | 212350 | 2022 | 1 | REG | BUF | LA | 2022_01_BUF_LA | (blank) | 29 | 148 | 0 | 0 | all zero |
| 255 | 213410 | 2022 | 2 | REG | KC | LAC | 2022_02_LAC_KC | (blank) | 21 | 104 | 1 | 0 | all zero |
| 256 | 214443 | 2022 | 3 | REG | CLE | PIT | 2022_03_PIT_CLE | (blank) | 17 | 80 | 1 | 0 | all zero |
| 257 | 215487 | 2022 | 4 | REG | CIN | MIA | 2022_04_MIA_CIN | (blank) | 18 | 89 | 0 | 0 | all zero |
| 258 | 216560 | 2022 | 5 | REG | IND | DEN | 2022_05_IND_DEN | (blank) | 15 | 69 | 1 | 0 | all zero |
| 259 | 217505 | 2022 | 6 | REG | CHI | WAS | 2022_06_WAS_CHI | (blank) | 17 | 89 | 0 | 0 | all zero |
| 260 | 218420 | 2022 | 7 | REG | NO | ARI | 2022_07_NO_ARI | (blank) | 14 | 61 | 0 | 0 | all zero |
| 261 | 219409 | 2022 | 8 | REG | BAL | TB | 2022_08_BAL_TB | (blank) | 15 | 80 | 0 | 0 | all zero |
| 262 | 220290 | 2022 | 9 | REG | HOU | PHI | 2022_09_PHI_HOU | (blank) | 6 | 30 | 0 | 0 | all zero |
| 263 | 221235 | 2022 | 10 | REG | ATL | CAR | 2022_10_ATL_CAR | (blank) | 13 | 60 | 0 | 0 | all zero |
| 264 | 222176 | 2022 | 11 | REG | TEN | GB | 2022_11_TEN_GB | (blank) | 12 | 60 | 0 | 0 | all zero |
| 265 | 223209 | 2022 | 12 | REG | DET | BUF | 2022_12_BUF_DET | (blank) | 10 | 49 | 0 | 0 | all zero |
| 266 | 224220 | 2022 | 13 | REG | NE | BUF | 2022_13_BUF_NE | (blank) | 11 | 54 | 0 | 0 | all zero |
| 267 | 225106 | 2022 | 14 | REG | LV | LA | 2022_14_LV_LA | (blank) | 5 | 25 | 0 | 0 | all zero |
| 268 | 226166 | 2022 | 15 | REG | SEA | SF | 2022_15_SF_SEA | (blank) | 14 | 66 | 0 | 0 | all zero |
| 269 | 227247 | 2022 | 16 | REG | JAX | NYJ | 2022_16_JAX_NYJ | (blank) | 14 | 81 | 0 | 0 | all zero |
| 270 | 228236 | 2022 | 17 | REG | DAL | TEN | 2022_17_DAL_TEN | (blank) | 16 | 90 | 0 | 0 | all zero |
| 271 | 229290 | 2022 | 18 | REG | KC | LV | 2022_18_KC_LV | (blank) | 15 | 66 | 1 | 0 | all zero |
| 272 | 229679 | 2022 | 19 | POST | SEA | SF | 2022_19_SEA_SF | (blank) | 4 | 19 | 0 | 0 | all zero |
| 273 | 229935 | 2022 | 20 | POST | JAX | KC | 2022_20_JAX_KC | (blank) | 5 | 20 | 0 | 0 | all zero |
| 274 | 230075 | 2022 | 21 | POST | PHI | SF | 2022_21_SF_PHI | (blank) | 4 | 20 | 0 | 0 | all zero |
| 275 | 230140 | 2022 | 22 | POST | PHI | KC | 2022_22_KC_PHI | (blank) | 1 | 5 | 0 | 0 | all zero |
| 276 | 231198 | 2023 | 1 | REG | DET | KC | 2023_01_DET_KC | (blank) | 22 | 104 | 0 | 0 | all zero |
| 277 | 232214 | 2023 | 2 | REG | PHI | MIN | 2023_02_MIN_PHI | (blank) | 10 | 50 | 0 | 0 | all zero |
| 278 | 233251 | 2023 | 3 | REG | SF | NYG | 2023_03_NYG_SF | (blank) | 16 | 80 | 1 | 0 | all zero |
| 279 | 234325 | 2023 | 4 | REG | DET | GB | 2023_04_DET_GB | (blank) | 8 | 37 | 1 | 0 | all zero |
| 280 | 235232 | 2023 | 5 | REG | CHI | WAS | 2023_05_CHI_WAS | (blank) | 18 | 90 | 1 | 0 | all zero |
| 281 | 236211 | 2023 | 6 | REG | DEN | KC | 2023_06_DEN_KC | (blank) | 17 | 91 | 1 | 0 | all zero |
| 282 | 237051 | 2023 | 7 | REG | JAX | NO | 2023_07_JAX_NO | (blank) | 10 | 50 | 0 | 0 | all zero |
| 283 | 238103 | 2023 | 8 | REG | TB | BUF | 2023_08_TB_BUF | (blank) | 17 | 86 | 0 | 0 | all zero |
| 284 | 239049 | 2023 | 9 | REG | PIT | TEN | 2023_09_TEN_PIT | (blank) | 11 | 50 | 0 | 0 | all zero |
| 285 | 239974 | 2023 | 10 | REG | CHI | CAR | 2023_10_CAR_CHI | (blank) | 13 | 75 | 0 | 0 | all zero |
| 286 | 240868 | 2023 | 11 | REG | BAL | CIN | 2023_11_CIN_BAL | (blank) | 15 | 85 | 1 | 0 | all zero |
| 287 | 241915 | 2023 | 12 | REG | GB | DET | 2023_12_GB_DET | (blank) | 13 | 66 | 1 | 0 | all zero |
| 288 | 242776 | 2023 | 13 | REG | DAL | SEA | 2023_13_SEA_DAL | (blank) | 13 | 67 | 1 | 0 | all zero |
| 289 | 243780 | 2023 | 14 | REG | NE | PIT | 2023_14_NE_PIT | (blank) | 12 | 60 | 1 | 0 | all zero |
| 290 | 244862 | 2023 | 15 | REG | LAC | LV | 2023_15_LAC_LV | (blank) | 11 | 48 | 0 | 0 | all zero |
| 291 | 245904 | 2023 | 16 | REG | NO | LA | 2023_16_NO_LA | (blank) | 20 | 100 | 1 | 0 | all zero |
| 292 | 246916 | 2023 | 17 | REG | CLE | NYJ | 2023_17_NYJ_CLE | (blank) | 16 | 79 | 0 | 0 | all zero |
| 293 | 247946 | 2023 | 18 | REG | PIT | BAL | 2023_18_PIT_BAL | (blank) | 13 | 64 | 0 | 0 | all zero |
| 294 | 248334 | 2023 | 19 | POST | CLE | HOU | 2023_19_CLE_HOU | (blank) | 4 | 19 | 1 | 0 | all zero |
| 295 | 248592 | 2023 | 20 | POST | HOU | BAL | 2023_20_HOU_BAL | (blank) | 3 | 15 | 0 | 0 | all zero |
| 296 | 248714 | 2023 | 21 | POST | BAL | KC | 2023_21_KC_BAL | (blank) | 2 | 10 | 0 | 0 | all zero |
| 297 | 248783 | 2023 | 22 | POST | SF | KC | 2023_22_SF_KC | (blank) | 0 | 0 | 0 | 0 | all zero |
| 298 | 249824 | 2024 | 1 | REG | BAL | KC | 2024_01_BAL_KC | (blank) | 23 | 116 | 1 | 0 | all zero |
| 299 | 250873 | 2024 | 2 | REG | MIA | BUF | 2024_02_BUF_MIA | (blank) | 10 | 55 | 0 | 0 | all zero |
| 300 | 251944 | 2024 | 3 | REG | NYJ | NE | 2024_03_NE_NYJ | (blank) | 11 | 52 | 0 | 0 | all zero |
| 301 | 252997 | 2024 | 4 | REG | DAL | NYG | 2024_04_DAL_NYG | (blank) | 20 | 97 | 1 | 0 | all zero |
| 302 | 253934 | 2024 | 5 | REG | ATL | TB | 2024_05_TB_ATL | (blank) | 21 | 101 | 0 | 0 | all zero |
| 303 | 254876 | 2024 | 6 | REG | SEA | SF | 2024_06_SF_SEA | (blank) | 21 | 105 | 0 | 0 | all zero |
| 304 | 255885 | 2024 | 7 | REG | DEN | NO | 2024_07_DEN_NO | (blank) | 14 | 64 | 0 | 0 | all zero |
| 305 | 256964 | 2024 | 8 | REG | MIN | LA | 2024_08_MIN_LA | (blank) | 15 | 75 | 3 | 0 | all zero |
| 306 | 257960 | 2024 | 9 | REG | HOU | NYJ | 2024_09_HOU_NYJ | (blank) | 19 | 93 | 1 | 0 | all zero |
| 307 | 258866 | 2024 | 10 | REG | CIN | BAL | 2024_10_CIN_BAL | (blank) | 11 | 55 | 0 | 0 | all zero |
| 308 | 259794 | 2024 | 11 | REG | PHI | WAS | 2024_11_WAS_PHI | (blank) | 14 | 61 | 0 | 0 | all zero |
| 309 | 260663 | 2024 | 12 | REG | PIT | CLE | 2024_12_PIT_CLE | (blank) | 9 | 45 | 0 | 0 | all zero |
| 310 | 261720 | 2024 | 13 | REG | DET | CHI | 2024_13_CHI_DET | (blank) | 16 | 80 | 0 | 0 | all zero |
| 311 | 262595 | 2024 | 14 | REG | DET | GB | 2024_14_GB_DET | (blank) | 22 | 110 | 0 | 0 | all zero |
| 312 | 263699 | 2024 | 15 | REG | SF | LA | 2024_15_LA_SF | (blank) | 12 | 55 | 0 | 0 | all zero |
| 313 | 264775 | 2024 | 16 | REG | LAC | DEN | 2024_16_DEN_LAC | (blank) | 25 | 124 | 0 | 0 | all zero |
| 314 | 265856 | 2024 | 17 | REG | PIT | KC | 2024_17_KC_PIT | (blank) | 14 | 66 | 0 | 0 | all zero |
| 315 | 266911 | 2024 | 18 | REG | CLE | BAL | 2024_18_CLE_BAL | (blank) | 21 | 110 | 0 | 0 | all zero |
| 316 | 267301 | 2024 | 19 | POST | LAC | HOU | 2024_19_LAC_HOU | (blank) | 5 | 25 | 0 | 0 | all zero |
| 317 | 267560 | 2024 | 20 | POST | KC | HOU | 2024_20_HOU_KC | (blank) | 3 | 13 | 0 | 0 | all zero |
| 318 | 267694 | 2024 | 21 | POST | WAS | PHI | 2024_21_WAS_PHI | (blank) | 1 | 5 | 0 | 0 | all zero |
| 319 | 267764 | 2024 | 22 | POST | PHI | KC | 2024_22_KC_PHI | (blank) | 0 | 0 | 0 | 0 | all zero |
| 320 | 268835 | 2025 | 1 | REG | DAL | PHI | 2025_01_DAL_PHI | (blank) | 25 | 117 | 0 | 0 | all zero |
| 321 | 269943 | 2025 | 2 | REG | GB | WAS | 2025_02_WAS_GB | (blank) | 17 | 89 | 0 | 0 | all zero |
| 322 | 271046 | 2025 | 3 | REG | MIA | BUF | 2025_03_MIA_BUF | (blank) | 12 | 72 | 1 | 0 | all zero |
| 323 | 272153 | 2025 | 4 | REG | ARI | SEA | 2025_04_SEA_ARI | (blank) | 20 | 98 | 0 | 0 | all zero |
| 324 | 273114 | 2025 | 5 | REG | SF | LA | 2025_05_SF_LA | (blank) | 18 | 89 | 0 | 0 | all zero |
| 325 | 274128 | 2025 | 6 | REG | PHI | NYG | 2025_06_PHI_NYG | (blank) | 12 | 56 | 1 | 0 | all zero |
| 326 | 275163 | 2025 | 7 | REG | PIT | CIN | 2025_07_PIT_CIN | (blank) | 20 | 93 | 0 | 0 | all zero |
| 327 | 276055 | 2025 | 8 | REG | MIN | LAC | 2025_08_MIN_LAC | (blank) | 12 | 54 | 1 | 0 | all zero |
| 328 | 277003 | 2025 | 9 | REG | MIA | BAL | 2025_09_BAL_MIA | (blank) | 11 | 51 | 0 | 0 | all zero |
| 329 | 277966 | 2025 | 10 | REG | LV | DEN | 2025_10_LV_DEN | (blank) | 14 | 70 | 0 | 0 | all zero |
| 330 | 278998 | 2025 | 11 | REG | NYJ | NE | 2025_11_NYJ_NE | (blank) | 15 | 72 | 0 | 0 | all zero |
| 331 | 279965 | 2025 | 12 | REG | HOU | BUF | 2025_12_BUF_HOU | (blank) | 19 | 95 | 0 | 0 | all zero |
| 332 | 281046 | 2025 | 13 | REG | GB | DET | 2025_13_GB_DET | (blank) | 17 | 90 | 0 | 0 | all zero |
| 333 | 282020 | 2025 | 14 | REG | DET | DAL | 2025_14_DAL_DET | (blank) | 12 | 60 | 0 | 0 | all zero |
| 334 | 283075 | 2025 | 15 | REG | TB | ATL | 2025_15_ATL_TB | (blank) | 13 | 60 | 0 | 0 | all zero |
| 335 | 284173 | 2025 | 16 | REG | LA | SEA | 2025_16_LA_SEA | (blank) | 14 | 70 | 0 | 0 | all zero |
| 336 | 285236 | 2025 | 17 | REG | DAL | WAS | 2025_17_DAL_WAS | (blank) | 19 | 109 | 0 | 0 | all zero |
| 337 | 286303 | 2025 | 18 | REG | TB | CAR | 2025_18_CAR_TB | (blank) | 17 | 90 | 0 | 0 | all zero |
| 338 | 286701 | 2025 | 19 | POST | CAR | LA | 2025_19_LA_CAR | (blank) | 5 | 25 | 0 | 0 | all zero |
| 339 | 286981 | 2025 | 20 | POST | DEN | BUF | 2025_20_BUF_DEN | (blank) | 2 | 10 | 0 | 0 | all zero |
| 340 | 287118 | 2025 | 21 | POST | DEN | NE | 2025_21_NE_DEN | (blank) | 0 | 0 | 0 | 0 | all zero |
| 341 | 287185 | 2025 | 22 | POST | SEA | NE | 2025_22_SEA_NE | (blank) | 0 | 0 | 0 | 0 | all zero |
