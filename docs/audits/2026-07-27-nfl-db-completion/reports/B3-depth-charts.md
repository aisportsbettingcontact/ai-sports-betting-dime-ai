# B3 — Recover the 554,215 excluded depth-chart rows

## Verdict

**PASS WITH EXCEPTIONS** — all 554,215 shape-B rows are recoverable and normalise cleanly into
season 2025 with a derived week, a leakage-free week rule, and a 100%-complete position crosswalk;
the only residue is **363 rows (0.066%) belonging to 34 named players who have no `gsis_id`
anywhere in nflverse**, itemised below.

## What I checked

Full population. Every one of the 1,106,729 data rows in `scripts/data/nfl-db/raw/depth_charts.csv`
was classified, normalised, and validated against 16 proposed CHECK constraints. Season/week
boundaries were derived from the `game` table (read-only), never from the calendar year. The
`espn_id → gsis_id` crosswalk was built from `raw/players.csv`, `raw/rosters.csv`, the depth-chart
file itself, and 43 cached ESPN athlete records.

Deliverables:

- `scripts/data/nfl-db/lib/depth_charts.py` — importable, no import-time I/O (0.022 s import).
- Cache/evidence: `scripts/data/nfl-db/cache/b3/`.
- **Nothing was written to `build_db.py`, `schema.sql`, or `nfl.db`.** `nfl.db` was opened
  `file:...?mode=ro` only.

## Results

### 1. The exclusion rationale in `build_db.py` is factually wrong

`build_db.py:271-278` says shape-B rows have "NO season or week column at all" and that they
"cannot be placed in a season without inventing one". Both halves of that are false:

| Claim | Reality |
|---|---|
| "no season or week column" | The columns exist and are *empty*. The header is a **union** of both shapes. |
| "cannot be placed in a season" | Every row carries `dt`, a full ISO-8601 instant. 554,215/554,215 (100%) parse. |
| implied: rows are unidentifiable | `espn_id` on 100%, `gsis_id` on 98.94%, `team` on 100%. |

The shape split is clean and total — there is no third shape and no ambiguous row:

```
$ python3 scripts/data/nfl-db/lib/depth_charts.py
    [PASS] row count is 1106729
    [PASS] shape A = 552514
    [PASS] shape B = 554215 (was dropped entirely)
```

Shape B is a **near-daily ESPN depth-chart scrape**: 219 distinct dates / **221 distinct
timestamps** spanning `2025-08-03` → `2026-03-14`, 216 of them at ~07:00 UTC (a ~3 a.m. ET
overnight cron), 32 teams present on every single snapshot, 2,095–3,264 rows per snapshot
(median 2,350).

### 2. Season assignment — the rule

**Rule.** Season `S` owns the half-open interval `[boundary(S-1), boundary(S))`, where

```
boundary(S) = close(S) + (open(S+1) - close(S)) / 2
open(S)     = MIN(kickoff_utc) FROM game WHERE season = S     -- the week-1 opener
close(S)    = MAX(kickoff_utc) FROM game WHERE season = S     -- the Super Bowl
```

`boundary(S)` is the midpoint of the football-free dead zone between one Super Bowl and the next
season's opener. Calendar year is never used.

For 2025 that gives the window **`[2025-05-24T11:55Z, 2026-05-26T11:55Z)`**, so **all 554,215
shape-B rows are season 2025** — including the 91,790 rows dated after Super Bowl LX, which are the
offseason *following* the 2025 season, not the 2026 season.

**Why the choice of boundary cannot matter here.** The dead zones are 207 days (2025) and 213 days
(2026) wide. The earliest snapshot sits **70 days** after the lower boundary; the latest sits
**73 days** before the upper one. Any boundary placed anywhere inside either dead zone produces
byte-identical output. The rule is not a judgement call in this dataset.

```
$ sqlite3 -readonly scripts/data/nfl-db/nfl.db \
    "SELECT season, MIN(kickoff_utc), MAX(kickoff_utc) FROM game GROUP BY season;"
2024|2024-09-06T00:20:00Z|2025-02-09T23:30:00Z
2025|2025-09-05T00:20:00Z|2026-02-08T23:30:00Z
2026|2026-09-10T00:20:00Z|2027-02-14T23:30:00Z
```

### 3. Week assignment — the rule, and why it is leakage-free

**Rule.** A depth chart is a *forecast*. Each snapshot is stamped with the **first event — regular
season week or playoff round — whose earliest kickoff is strictly later than the snapshot
instant.** "Strictly later" is the whole point: every row labelled week *W* was captured before
**any** week-*W* game started. A snapshot can never be attributed to a week already under way, so
the column cannot leak into a model trained on it.

`bucket` is derived independently, from four landmarks in the `game` table, and names the period
the snapshot was *captured* in:

| bucket | interval |
|---|---|
| `preseason` | `dt < MIN(kickoff_utc)` of season S |
| `regular` | `MIN(kickoff_utc) <= dt <= MAX(kickoff_utc WHERE season_type='REG')` |
| `postseason` | after the last regular-season kickoff, up to and including the Super Bowl kickoff |
| `offseason` | `dt > MAX(kickoff_utc)` of season S |

Resulting distribution (all season 2025):

| bucket | week | round | rows | snapshots |
|---|---|---|---|---|
| preseason | 1 | – | 93,363 | 32 |
| regular | 2 | – | 14,899 | 7 |
| regular | 3–15 | – | 15,080 … 16,340 | 7 each |
| regular | 16 | – | 14,036 | 6 |
| regular | 17 | – | 16,694 | 7 |
| regular | 18 | – | 21,757 | 9 |
| regular / postseason | – | WC | 18,011 | 7 |
| postseason | – | DIV | 18,816 | 7 |
| postseason | – | CON | 19,431 | 7 |
| postseason | – | SB | 39,590 | 14 |
| **offseason** | **NULL** | **NULL** | **91,790** | **34** |
| | | **total** | **554,215** | **221** |

Weeks 2–18 land on a clean seven-snapshot cadence — one per day, the block running from the
morning after week *W-1*'s first kickoff to the morning of week *W*'s first kickoff. Week 16 has 6
and week 18 has 9 because week 17 opens on Christmas Day afternoon and week 18 on a Saturday,
shifting the phase. SB has 14 because of the two-week Super Bowl bye.

Three deliberate decisions worth the coordinator's attention:

1. **The 91,790 post-Super-Bowl rows get `week = NULL`, `playoff_round = NULL`, `bucket =
   'offseason'`.** Season 2025 has no games left to forecast. No week was invented; the bucket is
   the marker, and `snapshot_ts` still orders them.
2. **The 93,363 preseason rows get `week = 1`, `bucket = 'preseason'`.** They precede every week-1
   game, so they cannot leak, and they *are* the forecast of week 1. Consequence to state plainly:
   **week 1 is forecast exclusively by preseason-bucket snapshots** — the 32 preseason dates span
   2025-08-03 → 2025-09-04, and a training-camp chart is not the week-1 chart. Filter
   `bucket = 'preseason'` out, or filter on `snapshot_ts`, if that matters to you. This is a
   one-line flip: set `PRESEASON_WEEK = None` in the module to null those weeks instead.
3. **The week is league-wide, not team-aware.** `derive_season_week()` takes only `dt`, so a team on
   a bye in week *W* still gets week *W*. `snapshot_ts` is preserved so a team-aware or game-aware
   window (`snapshot_ts < game.kickoff_utc`) can always be recomputed downstream. That is the
   correct join for anyone who cares about leakage at the game level rather than the week level.

### 4. Multiple snapshots per week — decision: **keep all rows**

| option | rows kept | rows discarded |
|---|---|---|
| **keep all (chosen)** | **554,215** | **0** |
| latest snapshot per (season, week/round, team) | 54,008 | 500,207 (90.3%) |

**Justification.** Deduplicating to one chart per team-week throws away 90.3% of the data —
precisely the failure this task exists to reverse — and it destroys the single most useful signal in
the feed: *intra-week movement*. A player climbing from `pos_rank` 3 to 1 between Tuesday and
Saturday is a prop-market event; keeping only Saturday erases it.

Keeping every row is safe because the timestamp makes the rows individually addressable. Verified
over the full population, with zero collisions:

```
    [PASS] shape-B natural key (ts, team, scheme, slot, rank) is unique
```

`(snapshot_ts, franchise_id, scheme, pos_slot, depth_order)` is a genuine key — 554,215 distinct
values for 554,215 rows. So is `(snapshot_ts, franchise_id, espn_id, scheme, pos_slot)`. The
proposed DDL enforces the first as a partial UNIQUE index.

### 5. Position vocabulary reconciliation

**The finding that governs this section: in shape B, the position column is not a position.**
`pos_abb` is a *slot* on the chart. Shape A publishes both concepts separately — `position` (the
player's listed position) and `depth_position` (the slot) — and they **disagree on 157,804 of
538,440 crosswalkable shape-A rows (29.3%)**: a WR listed at PR, a punter at H, a guard starting at
RT, a 3-4 DE listed at DT.

Therefore the unified record sets **`position = NULL` for shape B**. Passing a slot label off as a
position would be exactly the "plausible guess written into a data column" the standing rules
forbid. To get a shape-B player's real position, join `player.position` on `gsis_id`.

`POSITION_CROSSWALK` maps the thing the two halves genuinely share — the slot label — onto one
side-agnostic vocabulary. It covers **31 of 31** shape-B `pos_abb` values (complete) and 97.5% of
shape-A `depth_position` rows.

| shape B `pos_grp` → `unit` | shape B `pos_abb` | canonical slot | shape A `depth_position` also mapped |
|---|---|---|---|
| `3WR 1TE` → Offense | QB, RB, FB, WR, TE, C | same | — |
| | LT, RT | **T** | T, LOT, ROT |
| | LG, RG | **G** | G |
| `Base 3-4 D` / `Base 4-3 D` → Defense | LDE, RDE | **DE** | DE, LE, RE, END |
| | LDT, RDT | **DT** | DT, DL |
| | NT | NT | NOSE, N |
| | LILB, RILB | **ILB** | ILB, MILB |
| | MLB | MLB | MIKE, MIL |
| | SLB, WLB | **OLB** | OLB, LOLB, ROLB, MOLB, SAM, WILL, WIL |
| | LCB, RCB, NB | **CB** | CB, NCB, NICK, NICKE, NKL, MCB |
| | FS, SS | same | S, DB |
| `Special Teams` | PK | **K** | K, KO, FG |
| | P, LS | same | — |
| | KR | KR | KOR |
| | PR, H | same | — |

**Where the two halves are NOT equivalent** — four items, all verified:

1. **Slot ≠ position** (above). Shape B has no position column at all.
2. **KR / PR / H are roles.** Both shapes give them first-class slots. They say nothing about what
   the player plays. In shape A the same row carries `position='WR'`, `depth_position='PR'`.
3. **`depth_order` scales differ and are not comparable.** Shape A `depth_team` ∈ {1,2,3} (1st/2nd/3rd
   team; 261,016 / 208,322 / 83,176 rows). Shape B `pos_rank` ∈ 1..15, the rank *within a position*
   at that team. A shape-B `depth_order=4` has no shape-A equivalent. `source_shape` disambiguates.
4. **Shape A's `depth_position` is free text** — 151 distinct values including team-authored scheme
   names (`LEO`, `JACK`, `OTTO`, `$LB`, `RUSH`, `EDGE`) and outright junk (`WR\8`, `RB86`, `K222`,
   `19`, `6`, a bare newline on 8,126 rows). Those are left unmapped rather than guessed —
   `depth_position_canonical` is NULL, `depth_position` keeps the raw string.

Two shape-B-only fields have no shape-A counterpart and are preserved as new columns:
`scheme` (`3WR 1TE` / `Base 3-4 D` / `Base 4-3 D` / `Special Teams` — shape A's `formation` only
knows Offense/Defense/Special Teams, never the defensive front) and `pos_slot` (1–12, the fixed slot
ordinal; e.g. WR occupies slots 1, 2 and 8 of the 3WR-1TE group).

### 6. The 5,577 rows with no `gsis_id` — 5,214 recovered, 363 itemised

204 distinct ESPN athlete ids account for the 5,577 blank-`gsis_id` rows. Five deterministic,
re-runnable tiers resolve 170 of them (5,214 rows):

| tier | method | espn_ids | rows |
|---|---|---|---|
| T0 | same `espn_id` carries a `gsis_id` on another row of this file | 0 | 0 |
| T1 | `players.csv` `espn_id` → `gsis_id` | 14 | 881 |
| T2 | `rosters.csv` `espn_id` → `gsis_id` | 2 | 284 |
| T3 | unique (normalised name, team, **2025** roster) match in `rosters.csv` | 149 | 3,733 |
| T4 | unique (normalised name, college) match, name+college from the ESPN athlete API | 5 | 316 |
| | **resolved** | **170** | **5,214** |
| | **unresolved** | **34** | **363** |

T3 is deliberately constrained to the *derived* season (2025) plus the team on the row. Without the
season constraint it produces false positives — "Matt Jones" matches a 2005 Jaguars WR and a 2015
Washington RB, neither of whom is the 2025 Raiders linebacker. Spot-checked against ESPN:

```
$ cat scripts/data/nfl-db/cache/b3/espn_athletes/4241278.json   # T3 -> 00-0037106
  Jaylon Jones, DOB 1997-10-14, CB     nflverse 00-0037106: DOB 1997-10-14, CHI DB, 2025 roster
```

**Zero identifier contradictions inside the feed.** Across the 2,985 distinct `(gsis_id, espn_id)`
pairs where the feed publishes both, the mapping is 1:1 in both directions and agrees with
`players.csv` on **every** pair (0 disagreements, 0 gsis ids absent from `players.csv`).

### 7. Contradictions found (reported, not resolved on vibes)

**C1 — ESPN publishes duplicate athlete records; nflverse carries only one.**
`espn_id=3043133` (221 rows, PHI, NT slot, `player_name` blank) and `espn_id=4381558` are the same
human: both `fullName='Jordan Davis'`, both `dateOfBirth=2000-01-12T08:00Z`, both college ref
`/colleges/61` (Georgia). Record 4381558 carries `position=DT`, `jersey=90`; record 3043133 carries
`position='-'` and no jersey. `players.csv` records `espn_id=4381558` for `gsis_id=00-0037073`. The
depth-chart feed emitted the *other* id. Resolved to `00-0037073` via T4 (name+college) — DOB,
college, team and slot all agree — but recorded here because it proves ESPN athlete ids are not
unique per player.

**C2 — nflverse itself carries unstable `espn_id`s across seasons.** `gsis_id=00-0037106`
(Jaylon Jones, CHI DB) has `espn_id=4685145` on the 2024 roster row and `espn_id=4047655` on the
2025 roster row; the depth-chart feed uses a third, `4241278`. Consequence: **`espn_id` must never
be used as a join key.** `gsis_id` remains the only stable player key, exactly as CONTEXT.md says.

**C3 — `depth_chart.week` in the current database is a *continuous* season week, not a
regular-season week.** Shape A's `week` column runs 1–22. Postseason rows carry it too:

```
$ sqlite3 -readonly scripts/data/nfl-db/nfl.db \
    "SELECT season_type, MIN(week), MAX(week), COUNT(*) FROM depth_chart GROUP BY season_type;"
CON|20|21|7062
DIV|19|20|11272
REG|1|19|520459
SB|21|22|1852
SBBYE|||3390
WC|18|19|8479
```

This violates the repo's own stated convention (postseason ⇒ `playoff_round` set, `week` NULL) and
the table has no `playoff_round` column at all. Worse, **26,532 rows have `game_type='REG'` at a
week number past the end of that season's regular season** (week 18 in 2010–2020 when there were 17
regular-season weeks; week 19 in 2021–2024 when there were 18). Those are the all-32-team charts
published during wild-card weekend. Joining `depth_chart.week = game.week` on weeks ≥ 18 silently
returns wrong or empty results today. The normaliser fixes this: `week` and `playoff_round` follow
the repo convention, and the raw values survive in `source_week` / `source_game_type`.

**C4 — five snapshot dates are missing from the shape-B scrape**, so the "daily" cadence has holes:
`2025-08-04`, `2025-08-05`, `2025-08-06`, `2025-12-13`, `2026-01-18`. Two dates carry *two*
snapshots (`2025-08-09`, `2025-08-11`), giving 221 timestamps over 219 dates. Source gaps, not
loader gaps; no row is affected.

**C5 — 2014 is short in shape A** (32,542 rows vs a 2010–2024 mean of ~36,900): it is the only
season with zero `SBBYE` rows and zero wild-card-weekend REG rows, and its DIV/CON counts (505/254)
are roughly half every other season's. Upstream gap, pre-existing, out of scope for this task but
it will bias any 2014 postseason depth-chart query.

**C6 — 184 of 193,662 `(dt, team, pos_grp, pos_id)` groups have a hole in the `pos_rank`
sequence** (e.g. ranks `[1,2,4]`) — a player was pulled from the ESPN chart mid-scrape. 0.095% of
groups; ranks are otherwise contiguous 1..N. Recorded, not repaired.

### 8. Proposed DDL

The current `depth_chart` **cannot** hold shape B: there is no snapshot timestamp, no `espn_id`, no
`playoff_round`, no bucket, no scheme/slot, and `season_type` currently holds shape A's raw
`game_type` (`REG`/`WC`/`DIV`/`CON`/`SB`/`SBBYE`), which conflicts with the `('REG','POST')` domain
used everywhere else in the schema.

**I did not edit `schema.sql`.** Proposed replacement — every constraint below was evaluated
against all 1,106,729 normalised rows and holds (`[PASS] all 16 proposed DDL constraints hold on all
1106729 rows`):

```sql
CREATE TABLE depth_chart (
  -- provenance ------------------------------------------------------------
  source_shape   TEXT    NOT NULL CHECK (source_shape IN ('A','B')),
  snapshot_ts    TEXT,                       -- shape B only: ISO-8601 Z capture instant
  -- when ------------------------------------------------------------------
  season         INTEGER NOT NULL CHECK (season BETWEEN 2010 AND 2026),
  season_type    TEXT    CHECK (season_type IN ('REG','POST')),
  week           INTEGER CHECK (week BETWEEN 1 AND 18),
  playoff_round  TEXT    CHECK (playoff_round IN ('WC','DIV','CON','SB')),
  bucket         TEXT    NOT NULL
                 CHECK (bucket IN ('preseason','regular','postseason','offseason')),
  source_game_type TEXT  CHECK (source_game_type IN ('REG','WC','DIV','CON','SB','SBBYE')),
  source_week    INTEGER CHECK (source_week BETWEEN 1 AND 22),  -- nflverse continuous week
  -- who -------------------------------------------------------------------
  franchise_id   INTEGER NOT NULL REFERENCES team(franchise_id),
  gsis_id        TEXT,
  gsis_source    TEXT    CHECK (gsis_source IN ('feed','T0','T1','T2','T3','T4')),
  espn_id        TEXT,
  full_name      TEXT,
  jersey_number  INTEGER,
  -- what ------------------------------------------------------------------
  position       TEXT,     -- shape A only; shape B never publishes a position
  depth_position TEXT,     -- the slot, as published
  depth_position_canonical TEXT,             -- POSITION_CROSSWALK output
  depth_order    INTEGER CHECK (depth_order >= 1),  -- A: 1-3 team; B: 1-15 rank. Not one scale.
  unit           TEXT    CHECK (unit IN ('Offense','Defense','Special Teams')),
  scheme         TEXT    CHECK (scheme IN ('3WR 1TE','Base 3-4 D','Base 4-3 D','Special Teams')),
  pos_slot       INTEGER CHECK (pos_slot BETWEEN 1 AND 12),
  elias_id       TEXT,
  -- week / playoff_round exclusivity, mirroring `game` ----------------------
  CHECK (week IS NULL OR playoff_round IS NULL),
  CHECK ((week          IS NOT NULL AND season_type = 'REG')
      OR (playoff_round IS NOT NULL AND season_type = 'POST')
      OR (week IS NULL AND playoff_round IS NULL AND season_type IS NULL)),
  -- both NULL is legal only where season S has no next event to forecast
  CHECK (week IS NOT NULL OR playoff_round IS NOT NULL
         OR bucket IN ('postseason','offseason')),
  CHECK ((source_shape = 'B') = (snapshot_ts IS NOT NULL)),
  CHECK (gsis_id IS NOT NULL OR espn_id IS NOT NULL)   -- holds for all 363 exceptions too
);

CREATE INDEX idx_depth_player ON depth_chart(gsis_id, season, week);
CREATE INDEX idx_depth_team   ON depth_chart(franchise_id, season, week, depth_position_canonical);
CREATE INDEX idx_depth_snap   ON depth_chart(snapshot_ts);
CREATE INDEX idx_depth_espn   ON depth_chart(espn_id);
CREATE INDEX idx_depth_bucket ON depth_chart(season, bucket);
-- proves the keep-all decision: verified collision-free over all 554,215 shape-B rows
CREATE UNIQUE INDEX uq_depth_snapshot
  ON depth_chart(snapshot_ts, franchise_id, scheme, pos_slot, depth_order)
  WHERE snapshot_ts IS NOT NULL;
```

Resulting table size: **1,106,729 rows**, up from 552,514 (+100.3%).

### 9. Integration note for the coordinator

```python
import sys; sys.path.insert(0, "scripts/data/nfl-db/lib")
from depth_charts import GameCalendar, build_espn_gsis_crosswalk, normalize, load_team_map

cal   = GameCalendar.from_sqlite(conn)          # or .from_db_path(DB_PATH)
xwalk = build_espn_gsis_crosswalk(RAW, season=2025,
                                  espn_identities=json_from("cache/b3/espn_identities.json"))
rows  = [normalize(r, cal, alias2fid, xwalk) for r in read_csv(RAW + "/depth_charts.csv")]
```

`normalize()` raises `ValueError` on anything it cannot place — it never guesses. `build_db.py`'s
existing `alias2fid` is accepted directly as `team_map`; every row resolves a `franchise_id`
(`[PASS] every row resolves a franchise_id`). `build_db.py`'s PASS-1 assertion
`counts["depth"] + counts["depth_excluded_no_season"] == 1106729` will need replacing with
`counts["depth"] == 1106729`.

## Exceptions

**34 ESPN athlete ids / 363 rows (0.066% of shape B) have no `gsis_id` and cannot get one.**

Cause, identical for all 34: nflverse's player universe (`players.csv`, 25,035 rows; `rosters.csv`,
16 seasons) contains **no player with that name AND that college**. Each was verified individually
against ESPN's athlete record (name, DOB, college, position — cached under
`cache/b3/espn_athletes/`) and then searched by surname across both nflverse files; the only
surname hits are demonstrably different people (e.g. ESPN `4695679` "JB Brown", Kansas, born 2002 vs
nflverse `00-0001953` "J.B. Brown", Maryland, born 1967, last season 2000). All 34 are 2025
camp/practice-squad bodies who never reached a roster nflverse publishes, so **no GSIS id was ever
minted**. This is *absent*, not *missing* — the correct value is NULL, and `espn_id` is populated on
every one of the 363 rows.

| espn_id | player | college | pos | teams | rows |
|---|---|---|---|---|---|
| 4605489 | Damien Alford | Utah | WR | NO | 65 |
| 4749258 | Boog Smith | South Carolina State | LB | NYJ | 24 |
| 4361444 | Toa Taua | Nevada | RB | CLE | 18 |
| 4610703 | Jalen White | Georgia Southern | RB | GB | 17 |
| 4695679 | JB Brown | Kansas | LB | DEN | 17 |
| 4427569 | Giles Jackson | Washington | WR | PHI | 17 |
| 4578857 | Bruce Harmon | Stephen F. Austin | CB | DAL | 16 |
| 4572544 | Eli Mostaert | North Dakota State | DT | JAX | 16 |
| 4574571 | Brent Matiscik | TCU | LS | CLE | 15 |
| 4431597 | Roc Taylor | Memphis | WR | PIT | 15 |
| 4570688 | Caden Davis | Ole Miss | PK | BUF | 14 |
| 5278091 | Jordan Petaia | *(none on ESPN)* | TE | LAC | 11 |
| 4587977 | Sam Brown Jr. | Miami | WR | GB | 11 |
| 5082289 | Kelly Akharaiyi | Mississippi State | WR | ARI, BUF | 10 |
| 4426484 | Marcus Major Jr. | Minnesota | RB | BAL | 10 |
| 4578233 | Ryan Coe | California | PK | TB | 10 |
| 4429932 | Christian Johnstone | App State | LS | PHI | 9 |
| 4568671 | Jonathan Kim | Michigan State | PK | CHI | 9 |
| 4426398 | David Gbenda | Texas | LB | TEN | 9 |
| 4362248 | Anthony Torres | Toledo | TE | LA | 8 |
| 4708127 | Monaray Baldwin | Baylor | WR | MIA | 8 |
| 4690170 | DJ Thomas-Jones | South Alabama | FB | PIT | 8 |
| 4430804 | Chris Tyree | Virginia | WR | NO | 7 |
| 4686338 | Josh Minkins | Cincinnati | S | NE | 6 |
| 4427389 | Hayden Harris | Montana | DE | BUF | 3 |
| 4565535 | DK Kaufman | Northern Illinois | RB | SEA | 2 |
| 4578080 | Ozzie Hutchinson | UAlbany | OT | BAL | 1 |
| 4428132 | Tuasivi Nomura | Fresno State | LB | CAR | 1 |
| 4569452 | Winston Wright | East Carolina | WR | CLE | 1 |
| 4596596 | J.J. Jones | North Carolina | WR | JAX | 1 |
| 4569496 | Tank Booker | SMU | DT | LV | 1 |
| 4579667 | Pat Conroy | Old Dominion | TE | LV | 1 |
| 4427243 | Brett Gabbert | Miami (OH) | QB | MIA | 1 |
| 4429488 | Fentrell Cypress II | Florida State | CB | WAS | 1 |
| | | | | **total** | **363** |

The list is asserted in code as `UNRESOLVED_ESPN_IDS`; the self-check fails if the set ever drifts
(`[PASS] unresolved gsis_id is exactly the 34 itemised players`).

**445 shape-B rows have a blank `player_name`.** 221 of them are the Jordan Davis duplicate-id rows
(C1). All 445 still carry `espn_id`, `team`, slot and rank, so no row is lost; `full_name` is NULL
and resolvable through `player.display_name` on `gsis_id`.

## Reproduce

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai

# 1. The self-check. Processes all 1,106,729 rows; exits non-zero if any fails to
#    normalise, if a count drifts, or if any proposed DDL constraint is violated.
python3 scripts/data/nfl-db/lib/depth_charts.py ; echo "exit=$?"     # -> exit=0

# 2. Season/week derivation at the boundaries that matter.
python3 - <<'PY'
import sys; sys.path.insert(0, "scripts/data/nfl-db/lib")
import depth_charts as D
cal = D.GameCalendar.from_db_path("scripts/data/nfl-db/nfl.db")
for ts in ("2025-08-03T07:00:00Z", "2025-09-04T07:00:00Z", "2025-09-05T07:00:00Z",
           "2026-01-06T07:00:00Z", "2026-02-08T07:00:00Z", "2026-02-09T07:00:00Z",
           "2026-03-14T07:32:09Z"):
    print(ts, "->", D.derive_season_week(ts, cal))
PY
# 2025-08-03T07:00:00Z -> (2025, 1, None, 'preseason')
# 2025-09-04T07:00:00Z -> (2025, 1, None, 'preseason')
# 2025-09-05T07:00:00Z -> (2025, 2, None, 'regular')
# 2026-01-06T07:00:00Z -> (2025, None, 'WC', 'postseason')
# 2026-02-08T07:00:00Z -> (2025, None, 'SB', 'postseason')
# 2026-02-09T07:00:00Z -> (2025, None, None, 'offseason')
# 2026-03-14T07:32:09Z -> (2025, None, None, 'offseason')

# 3. Season-boundary evidence (read-only).
sqlite3 -readonly scripts/data/nfl-db/nfl.db \
  "SELECT season, MIN(kickoff_utc), MAX(kickoff_utc) FROM game GROUP BY season;"

# 4. C3 — the continuous-week defect in the currently loaded table (read-only).
sqlite3 -readonly scripts/data/nfl-db/nfl.db \
  "SELECT season_type, MIN(week), MAX(week), COUNT(*) FROM depth_chart GROUP BY season_type;"

# 5. Dedup consequence, both options.
python3 - <<'PY'
import csv, sys; sys.path.insert(0, "scripts/data/nfl-db/lib")
import depth_charts as D
csv.field_size_limit(10**7)
cal = D.GameCalendar.from_db_path("scripts/data/nfl-db/nfl.db")
recs, latest = [], {}
for r in csv.DictReader(open("scripts/data/nfl-db/raw/depth_charts.csv",
                             newline="", encoding="utf-8", errors="replace")):
    if not r.get("dt"): continue
    s, w, pr, b = D.derive_season_week(r["dt"], cal)
    k = (s, w, pr, r["team"]); recs.append((k, r["dt"]))
    if r["dt"] > latest.get(k, ""): latest[k] = r["dt"]
kl = sum(1 for k, ts in recs if ts == latest[k])
print("keep-all:", len(recs), "| latest-per-week:", kl, "| discarded:", len(recs) - kl)
PY
# keep-all: 554215 | latest-per-week: 54008 | discarded: 500207
```

**Cached evidence** (`scripts/data/nfl-db/cache/b3/`): `espn_athletes/*.json` (43 ESPN athlete
records, incl. both Jordan Davis ids), `espn_colleges/*.json`, `espn_identities.json`,
`gsis_resolution_tiers.json`, `t5_namecollege.json`, `nogsis_espn_ids.json`,
`espn_id_disagreements.json` (empty — that is the finding), `game_calendar_2024_2026.json`,
`snapshot_week_map.json`, `dedup_and_buckets.txt`, `selfcheck.txt`.
