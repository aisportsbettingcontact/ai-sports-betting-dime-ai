# S1 — Cross-reference and adjudication of the ten agent reports

## Verdict

**FAIL — the ledger is not yet safe to act on.** The ten reports are individually sound, but
across them I find **9 contradictions** (5 resolved against the report that is wrong, 4 left
open), **4 of the 5 "independent corroborations" are correlated rather than independent**,
**7 confirmed defects are missing from `INTEGRATION.md` entirely** — including a live
standing-rule-1 violation (four fabricated juice values sitting in `game_line` today) and two
disputed spreads A4 could not resolve — and **3 entries in `INTEGRATION.md` are stated more
strongly than the reports support**. Two coverage areas were scoped out of all ten tasks and
nobody checked them: `roster_season`'s payload, and constraint/index correctness as opposed to
presence.

`nfl.db` was opened read-only throughout. md5 `1d2b0bea3e85edf467ef446db807bc7d`, identical to
`nfl.db.pre-completion-backup`, verified at the start and end of this task.

---

## What I checked

Full population of the deliverables: `CONTEXT.md`, `INTEGRATION.md`, and all ten reports
(8,348 lines). Every cross-report claim below was re-derived from primary evidence rather than
from the reports — 24 read-only SQL probes against `nfl.db`, 3 passes over
`raw/depth_charts.csv` / `raw/player_stats.csv`, `build_db.py` lines 41–120 and 255–295,
`schema.sql` DDL as loaded, and the agents' own cached artefacts
(`cache/a3/athletes/**`, `cache/a3/missing_espn_resolution.json`).

I did **not** re-fetch anything from ESPN. Where a claim rests on an agent's network evidence I
say so and name whose cache carries it.

---

## Results

### 1. Corroboration analysis — is the second finding actually a second witness?

The test applied to each: *if the first agent's method had produced a wrong answer, would the
second agent's method have produced the same wrong answer?* If yes, the corroboration is
correlated and carries roughly the weight of one finding, not two.

| Finding | Agents | Shared method? | Shared source? | Verdict |
|---|---|---|---|---|
| Super Bowl snap-team transposition | A3 E-10, A5 D4 | **yes** | **yes** | **Correlated — but externally grounded. Confirmed.** |
| Two Jonah Williamses | A3 E-9, A5 D5 | **yes** | A3 adds ESPN | **Correlated. Rests on A3 alone.** |
| Mike Edwards misattribution | A3 E-1, A5 D2 | partly | A3 adds ESPN | **Partly independent. Confirmed.** |
| Jalen Davis, two simultaneous games | A3 E-11, A5 D7, B4 D6 | **yes** | **yes** | **Fully correlated — one query, three restatements.** |
| `2010_10_HOU_JAX` → `301114030` | A1 E1, A2 exc. 1 | **yes** (not "different routes") | both ESPN `summary` | **Correlated discovery, independently confirmed value. Confirmed.** |

#### (a) Super Bowl snap-team transposition — **correlated, externally grounded, confirmed**

A3 and A5 ran the same detector: join `snap_count` to `player_game_stats` on
`(gsis_id, season, week)` and compare `franchise_id`. They report *identical* per-game joinable
counts (58 / 66 / 55 / 61) and the identical total of 358 rows, which is itself the signature of
one query run twice. Both then confirmed the swap is present in `raw/snap_counts.csv`. Method and
source are shared, so this is one witness.

It nevertheless survives, for two reasons neither of which depends on the shared method:

- **A3 ran a third-table control that A5 did not.** `depth_chart` carries its own `gsis_id`,
  its own team, and is loaded through the *same* `alias2fid` map as `snap_count`. Its Super Bowl
  rows agree with the player's own stat row **1,106 / 1,106**. That excludes the two rival
  hypotheses — "the loader's abbreviation→franchise map is wrong" and "`player_game_stats` is the
  wrong side of the comparison" — without appealing to any external source.
- **A5's decisive argument needs no source at all.** Tom Brady never played for Kansas City.

**Confirmed.** Note that both agents' 358 is the *total rows in the four games*, while the
0/58, 0/66, 0/55, 0/61 splits are only the *joinable* subset; the register below uses 358.

#### (b) Two Jonah Williamses — **correlated; the finding rests on A3 alone**

Same detector again (snap teams vs stat teams do not intersect), same count (146 = 67 + 79). A5
offers **no external evidence** — its entire case is the internal contradiction, which is exactly
what A3's detector produced. If the internal signal were being misread, both would misread it
together.

A3 alone broke the symmetry, and did it properly: ESPN athletes **4040726** (OT, b.1997-11-17,
draft 2019 R1 P11) and **4032481** (DE, b.1995-08-17, undrafted), whose `statisticslog`
season/team sequences reproduce each man's `player_game_stats` history exactly. That is what
establishes *which* way the swap runs, and it is a single agent's single cache.

A3 also found a consequence A5 missed and `INTEGRATION.md` does not carry: **`draft_year`,
`draft_round`, `draft_pick` and `draft_team` on `00-0035944` belong to `00-0035629`** — the DB
gives an undrafted Weber State DE Cincinnati's 2019 first-round, eleventh-overall pick. D18 must
be widened from "146 snap rows" to "146 snap rows + 4 draft fields".

#### (c) Mike Edwards — **partly independent; confirmed; A3's severity is not**

A3 and A5 share the cross-table argument (the safety's 2020 gap; `snap_count` and
`roster_season` both placing him on TB in 2020). A3 adds **two orthogonal methods**:

1. The `gsis_id` **sequence-outlier** detector — `00-0039472` sits 1,323 above the 2022 debut
   cohort's maximum while claiming a 2020 season. This shares nothing with the gap-fill argument
   and would fire even if every fact table were internally consistent.
2. ESPN `statisticslog`: `4362015` has no record before 2024.

That is genuine independent corroboration. **Confirmed.**

**But the two agents contradict each other on impact, and A5 is right.** A3 calls it "a full
season of defensive performance attributed to a human who was not in the NFL" and rates it
*highest* severity; A5 says "all 13 rows are all-zero, so no numeric value is wrong". I checked
all 13 rows across every stored column:

```
2020|1..14 REG + 18..21 POST | franchise 27 | completions..receiving_yards all 0
```

**Every value is zero.** `player_game_stats` stores 21 offensive columns; a safety has no
offensive production, so nothing numeric is misattributed. The real harm is narrower and should
be stated that way: the safety's 2020 *participation record is missing*, and any `gsis_id` join
attaches a 2024 offensive lineman to the 2020 Super Bowl run. That is an identity defect, not a
performance defect. **A3's "highest" is not supported by the payload.**

#### (d) Jalen Davis — **fully correlated; A5's row count is wrong**

Three agents, one query: `GROUP BY gsis_id, season, week HAVING COUNT(DISTINCT …) > 1` over
`snap_count`. A3 E-11, A5 D7 and B4 D6 are three renderings of it. **No agent consulted an
external source** — PFR is Cloudflare-blocked and ESPN publishes no snap counts — so the stated
cause ("PFR conflates two cornerbacks under `DaviJa06`") is an *inference from `roster_season`*,
not a verified fact. It should be recorded as a hypothesis.

The three also disagree on scale. Ground truth:

```
00-0034446|2019|15|REG|15         |2019_15_MIA_NYG                  |1   <- stray, single row
00-0034446|2019|16|REG|22,15      |2019_16_ARI_SEA,2019_16_CIN_MIA  |2
00-0034446|2019|17|REG|22,15      |2019_17_ARI_LA,2019_17_MIA_NE    |2
00-0034446|2021|12|REG|15,4       |2021_12_CAR_MIA,2021_12_PIT_CIN  |2
```

**6 rows in 3 impossible weeks** (plus a 4th single-row Miami stray in 2019 wk 15 that only A3
counts). B4's "6 snap rows, 3 player-weeks" and A3's table are correct; **A5's "Three
`snap_count` rows" is wrong** — it counts weeks as rows.

#### (e) `2010_10_HOU_JAX` → `301114030` — **not "different routes"**

The task premise is that A1 and A2 reached this by different routes. On the **detection** step
they did not: both used the same ESPN pre-2014 event-id encoding, both report the same
1,067/1,068 conformance over the same 1,068 legacy rows. A2's prose statement of the rule
(`3` + `YYMMDD` + home id — ten digits for a nine-digit id) is a garbled restatement of A1's
correct one (`3` + last digit of year + MMDD + zero-padded home id); A2's *query*
(`SUBSTR(espn_event_id,7,3)`) is right regardless, so the error is cosmetic.

They *were* independent on two other things:

- **A1's slate sweep found it without the encoding rule at all.** A1 indexed 4,663 ESPN events by
  `(season, seasontype, week)` and found `301114030` as an ESPN event with no DB row. That route
  shares nothing with the id heuristic.
- **Both independently pulled ESPN `summary?event=301114030`** and got HOU 24 @ JAX 31; A1 also
  matched the kickoff instant `2010-11-14T18:00Z` and the venue.

**Verdict: correlated discovery, independently confirmed value.** The correction is
over-determined — the DB row's own scores, franchise ids and kickoff already agree with ESPN's
`301114030` — so it is safe. But the corroboration between A1 and A2 adds nothing; what makes it
safe is the direct ESPN lookup, which is a single source.

Verified independently:

```
sqlite> SELECT espn_event_id, group_concat(game_id) FROM game GROUP BY 1 HAVING COUNT(*)>1;
301114022|2010_10_HOU_JAX,2010_10_SEA_ARI          -- exactly one duplicate in 4,648 rows
```

---

### 2. Contradiction register

Nine places where two reports state incompatible things. Five I resolve; four I leave open,
per standing rule 4.

#### C-01 — `espn_id`: B3 says unstable, A3 says zero collisions. **Both are right; they measure different things.** RESOLVED

This is the most consequential to get right, because it determines how every future join is
written.

| | What was actually measured | Result |
|---|---|---|
| **A3 §1** | Injectivity of **one column in one table** — `player.espn_id`, sourced entirely from `raw/players.csv` | 0 values map to two `gsis_id`s, over 25,035 rows |
| **A3 §6** | Whether that column points at the right human | 16,765 of 16,768 fetched; 54 MISMATCH, of which **1** carries fact rows |
| **B3 C2** | Stability of `espn_id` for one human **across nflverse files and seasons** | Jaylon Jones `00-0037106`: `4685145` (2024 rosters), `4047655` (2025 rosters), `4241278` (depth charts) — three values |
| **B3 C1** | Whether **ESPN itself** issues one id per human | No — Jordan Davis is `3043133` *and* `4381558`, same DOB, same college |

Nothing here conflicts. A3 measured a column; B3 measured a *key relation across sources*. And
A3 independently corroborates B3 without saying so: A3 §8 found **19 players where
`players.csv` and `rosters.csv` disagree on `espn_id`, and in 11 of them `rosters.csv` points at
a different human** (the two Michael Carters are literally crossed). That is B3's C2, measured a
different way.

**The rule that follows, which no single report states:**

- `player.espn_id` **is** safe as a unique attribute *inside* `nfl.db`.
- `espn_id` is **not** safe as a join key against other nflverse files — `rosters.csv` and
  `depth_charts.csv` publish different values for the same human.
- `espn_id` is **not** safe as a join key against ESPN itself without a name/DOB fallback,
  because ESPN carries ≥2 athlete records for an unknown number of humans.
- `gsis_id` remains the only stable player key. **B3's conclusion is correct; A3's measurement
  does not refute it.**

#### C-02 — A5 says `player.espn_id` is wrong for 5 players. **It is not. A3 is right.** RESOLVED

A5 E5 lists five `espn_id` values as "wrong" because ESPN's box scores use a different id. I
pulled A3's cached ESPN athlete documents for all five:

| `player.espn_id` | DB row | ESPN record at that id | A5 called it |
|---|---|---|---|
| `3923394` | Shaun Hill, QB, b.1980-01-09, rookie 2002 | **Shaun Hill**, b.**1980-01-09**, debut **2002** | wrong |
| `3166800` | LeGarrette Blount, RB, b.1986-12-05, rookie 2010 | **Legarrette Blount**, b.**1986-12-05**, debut **2010** | wrong |
| `2268575` | Henry Hynoski, FB, b.1988-12-30, rookie 2011 | **Henry Hynoski**, FB, b.**1988-12-30**, debut **2011** | wrong |
| `4071345` | Chris Manhertz, TE, b.1992-04-10 | **Chris Manhertz**, TE, b.**1992-04-10** | wrong |
| `2544798` | Daniel Brown, TE, b.1992-05-26, rookie 2015 | **Daniel Brown**, WR, b.**1992-05-26**, debut **2015** | wrong |

**All five point at the correct human**, matching on name, exact birthdate and debut year. A5
misdiagnosed a *duplicate ESPN record* as a *wrong id* — the same phenomenon A3 documented for
Blount and Manhertz explicitly, and the same phenomenon B3 documented as C1 for Jordan Davis.

**Resolution: A5 E5 is not a `player` defect and must not enter the ledger as one.** A5's
operational point survives in weaker form and belongs in the register as a distinct class:
*ESPN publishes duplicate athlete records; `player.espn_id` sometimes holds the record ESPN's
box scores do not use, so an ESPN box-score join by `espn_id` silently returns nothing.* That
class is corroborated three ways (B3 C1, A3 E-7/Blount/Manhertz, A5 E5) and is currently
**absent from `INTEGRATION.md`**. A5's closing caveat — "the true count across all 16,768
populated `espn_id` values is unknown" — was already closed by A3 at 16,765/16,768.

#### C-03 — B5's "190 unsourceable `pfr_id` / 17 `espn_id`" vs A3's "full ESPN coverage of 16,768". **Different denominators; both correct; they agree exactly on the overlap.** RESOLVED

I reconstructed both populations:

```
player rows                                       25,035
  with espn_id                                    16,768   <- A3's denominator
  with pfr_id                                     22,554
ids referenced by any fact table                  11,593
  ... and present in `player`                     10,111   <- B5's denominator
      of those, no espn_id                            21   <- B5 "before"; 17 after 4 backfills
      of those, no pfr_id                            193   <- B5 "before"; 190 after 3 backfills
players with NO espn_id that carry any fact row       21   <- A3 §"structurally blind", counted independently
```

**21 = 21, exactly.** B5's 17 is a strict subset of A3's 8,267 no-`espn_id` rows. There is no
contradiction, and the two agents' independent counts of the fact-bearing subset match to the
row. This is the strongest genuine independent corroboration in the whole job and neither agent
noticed it.

#### C-04 — B5 says the 17 are unsourceable; **A3 resolved 12 of them.** RESOLVED against B5

B5 E2: "ESPN's player search index does not carry them (20 of 24 searches returned zero NFL
athletes)." A3 E-6: "Of the 21 players that carry fact rows but no `espn_id`, 16 were resolved
to a unique ESPN athlete." From A3's own artefact:

```
$ python3 -c "…json.load(open('cache/a3/missing_espn_resolution.json'))…"
Counter({'RESOLVED_UNIQUE': 16, 'UNRESOLVED_NO_ESPN_MATCH': 3,
         'RESOLVED_AMBIGUOUS': 1, 'UNRESOLVED_NOT_IN_INDEX': 1})
```

Mapping A3's result onto B5's list of 17: **12 RESOLVED_UNIQUE with a named ESPN id** (e.g.
`00-0020895`→4312, `00-0024467`→9839, `00-0026916`→12465, `00-0026924`→12673,
`00-0027216`→13539, `00-0027482`→13438, `00-0027512`→13441, `00-0027617`→13687,
`00-0027800`→13418, `00-0028123`→14172, `00-0028743`→14752, `00-0028822`→14852),
**1 ambiguous** (`00-0031683` Kevin White — B5's own E5), **4 genuinely unresolvable**
(`00-0027329`, `00-0036120`, `00-0036454`, `00-0037451`).

**`INTEGRATION.md`'s open item "17 `espn_id` (B5) — confirm each is genuinely absent upstream"
is already answered and the coordinator did not notice.** The residue is 4, not 17. B5's
search method was weaker than A3's; B5's report should be read as superseded here.

#### C-05 — B5 E8 blames CSV quoting for the 554,215 depth-chart rows. **B2, B3 and B4 all say it is a second file format. B5 is wrong.** RESOLVED against B5

B5 E8: "1,106,729 raw rows, of which 554,215 have an unparseable `season` (embedded newlines in
the `depth_position` field)". That is a parser-failure diagnosis. It is wrong:

```
$ python3 …raw/depth_charts.csv…
shapeB rows: 554215  min dt: 2025-08-03T10:09:07Z  max dt: 2026-03-14T07:32:09Z
shapeA rows: 552514
```

Every one of the 554,215 parses cleanly and carries a `dt`, an `espn_id` and a `team`; the
`season` column is *empty by design* because the header is a union of two shapes. B3 proved this
over the full population, B4 independently confirmed it is one contiguous block from CSV line
552,516, and B2 called it "two files stapled together". **Three agents against one.** B5's
conclusion (it does not change B5's orphan analysis) happens to hold, but its stated cause would
send anyone who acts on it to fix a non-existent CSV bug. The coordinator correctly took B3's
version into D6; the contradiction should still be recorded so B5's E8 is not cited later.

#### C-06 — B2 says shape-B snapshots run "2025-03 → 2026-07". **They run 2025-08-03 → 2026-03-14.** RESOLVED against B2

B2's date range is wrong at both ends (see the command above). This is not cosmetic: **B2
derived shape-B's season "using a March league-year boundary"**, and 36,364 shape-B rows are
dated 2026-03 or later. Under B2's rule those rows fall in league year 2026; under B3's
dead-zone-midpoint rule all 554,215 fall in season 2025. **B2's census season labels for
`depth_charts.csv::team` are therefore unreliable**, and B3's rule — which B3 shows is
insensitive to boundary placement because the nearest snapshot is 70 days from the edge — is the
one to adopt. D6 already does. B2's census *counts* are unaffected; only its season attribution
is.

#### C-07 — B2 says `LAR` and `WSH` are missing aliases. **They are not. A2 is right.** RESOLVED against B2

B2 headline: "Aliases missing from the shipped table: **3** (`AZ`, `LAR`, `WSH`)" and
"187 rows currently unmappable (92 `AZ` + 78 `LAR` + 17 `WSH`)". Both are false.

```
sqlite> SELECT abbreviation, franchise_id, is_current FROM team_alias
        WHERE abbreviation IN ('AZ','LAR','WSH');
LAR|14|1
WSH|28|1        -- AZ absent; LAR and WSH present and current
```

`build_db.py:113` builds `abbr2fid` from `teams.json`, whose abbreviations are ESPN's — i.e.
`LAR` and `WSH` *are* `team.abbreviation` and land in both `team_alias` and `alias2fid`. A2
verified all 37 alias rows against ESPN and found no uncovered abbreviation; the DB agrees.
Live impact:

```
pgs null franchise_id   0
snap null franchise_id  0
roster null franchise_id 0
depth null franchise_id  0
game abbrs unresolved    0
```

**Only `AZ` is genuinely absent, and it currently maps zero rows** — see C-08. B2's exception 1
should read "1 missing alias, 0 rows affected today", not "3 / 187".

#### C-08 — A2 says "no source feeding `nfl.db` emits `AZ`". **`players.csv` does — 92 rows. But it never reaches a column.** RESOLVED, both partly right

B2's census is correct: `AZ` appears 92 times in `players.csv::latest_team`, season 2026 only, a
clean `ARI`→`AZ` cutover. A2's blanket statement is therefore wrong as written. But A2's
*effective* claim holds, because `player` has no `latest_team` column at all:

```
sqlite> PRAGMA table_info(player);
gsis_id display_name first_name last_name position position_group birth_date height weight
college draft_year draft_round draft_pick draft_team rookie_year last_season status esb_id
pfr_id espn_id headshot_url
```

`build_db.py` never reads `latest_team`. **The 92 `AZ` values reach no franchise column today.**
See §5 for what this does to `INTEGRATION.md` D3.

#### C-09 — B4 calls the `D.Bryant` residual row a meaningless artifact; A5 proves it is a real player line. **A5 is right; B4's fact #4 is half wrong.** RESOLVED

B4's fourth "independent fact" about the 341 rows is that their `team` / `game_id` /
`player_name` columns are `first()`-of-group artifacts carrying no meaning, and it cites the
2012 week-6 row: "labelled `TEN` yet its leaked name is `D.Bryant`". A5 took the same
observation and *identified the player*. Ground truth from the CSV:

```
{'player_name': 'D.Bryant', 'season': '2012', 'week': '6', 'game_id': '2012_06_PIT_TEN',
 'team': 'TEN', 'receptions': '2', 'targets': '2', 'receiving_yards': '11',
 'receiving_air_yards': '17', 'receiving_first_downs': '1', 'target_share': '0.0454…',
 'penalties': '2', 'fantasy_points': '1.1', 'fantasy_points_ppr': '3.1'}
```

The DB has Dez Bryant at 11 rec / 84 yds / 13 tgt for `2012_06_DAL_BAL`; **11 + 2 = 13 and
84 + 11 = 95, which is exactly what ESPN and nfl.com's official play-by-play both publish.**
The `team` label is an artifact; the *name* is not. B4's exclusion decision is still right (a
NULL `player_id` cannot be stored) but its characterisation "not a real loss" understates the
consequence: DAL is the only team-game in 16 seasons whose receptions fall short of its own
completions.

For completeness, the other leaked-name row is benign: `R.Rodgers`, 2018 wk 11, penalties only,
zero production. **A5's "the only one of the 341 with real player production" is confirmed.**

#### Left open (standing rule 4)

| # | Open contradiction | Why I am not resolving it |
|---|---|---|
| O-1 | `roster_season` semantics. A3: "a *final-week snapshot*… every row the loader keeps is the highest week present". A5: "an end-of-season snapshot that omits stints finished before it was taken". The data: **551 player-seasons carry 2–4 rows, 547 of them across different franchises**, and `build_db.py:262-268` loads every `rosters.csv` row with a season — it does no week filtering at all. | Neither stated model matches the table. Deciding what the table *means* is an owner call, and it changes how A5's 1,056 "mid-season move" rows and A3's 14 ESPN disagreements should be read. |
| O-2 | Snap-era boundary. B1 tier 2 filters on "documented season ≥ **2012** (snap_counts does not exist before then)"; A5 and the DB say `snap_count` covers **2013**–2025, and A5 says nflverse publishes from 2012 so 2012 is a *local extract gap*. | The two numbers are not in conflict — B1's ≥2012 is a deliberately loose superset and cannot produce a false positive — but the boundary is stated as 2012 in one deliverable and 2013 in another, and D21 records only 2013. Needs one stated convention. |
| O-3 | A1's Bills Toronto Series (3× `Home`, 1× `Neutral`, same venue). | Already correctly open in the ledger. |
| O-4 | A4's four disputed prices — `2021_10_DET_PIT`, `2020_01_LV_CAR`, `2021_15_NE_IND`, `2021_17_CLE_PIT`. | Open by design, but **only two of the four are in the ledger** — see §5. |

---

### 3. Coverage gaps — what no agent checked

Ten task scopes were drawn by the coordinator; scoping errors are invisible from inside them.

**G-1 — `roster_season`'s payload was never validated by anyone.** B5 audited its *keys*
(orphans, uniqueness). B4 classified its *NULLs*. A3 checked 14 `ACT` rows' team assignment
against ESPN. **Nobody validated a single value in `status`, `position`,
`depth_chart_position`, `jersey_number` or `years_exp` across 43,856 rows against any source.**
The distribution is at least plausible (`ACT` 26,940 · `RES` 5,628 · `CUT` 5,014 · `DEV` 4,233
· `INA` 1,486 · 8 more codes · 25 blank), but "plausible" is not a check, and this is the table
A5's E6 and A3's team-history analysis both lean on. Compounding: **`roster_season` has no
primary key and no unique index** — B4's 4 indistinguishable duplicate rows are a symptom, not
the disease.

**G-2 — Constraint enforcement, as opposed to constraint declaration.**
`PRAGMA foreign_keys` is **0** in the shipped database, so *no declared foreign key is enforced
at runtime*. Worse, the three tables that actually produce orphans declare no player FK at all:

```
snap_count      -> team(franchise_id) only
roster_season   -> team(franchise_id) only
depth_chart     -> team(franchise_id) only
player_game_stats -> player(gsis_id) ✓  (0 violations)
```

`PRAGMA foreign_key_check` returns **zero rows** — which reads like a clean bill of health and
is in fact a measure of how little is declared. B4 correctly says "no FK on the column, so they
load silently"; nobody stated the general form.

**G-3 — Index *correctness*, as opposed to presence.** 43 explicit indexes exist (51 with
SQLite's 8 autoindexes, matching CONTEXT.md). Three concrete problems nobody raised:

- **There is no index on `player.espn_id`** (`player` has only `display_name`, `pfr_id`,
  `position`). Every report in this audit instructs consumers to join on `espn_id`; the column
  is neither indexed nor unique-constrained.
- `idx_snap_game` indexes `snap_count(pfr_game_id)` — the column D7 shows is mislabelled and
  actually holds the nflverse `game_id`. B4's proposed C3 rename must rebuild this index or the
  index name will point at the *new*, empty `pfr_game_id`.
- `idx_game_espn_event` is non-unique, which is what let D9's collision exist. D9 already
  proposes the UNIQUE constraint; nobody checked whether any *other* cross-source join key is
  similarly unconstrained (`gsis_game_id`, `pfr_game_id`, `old_game_id`, `ftn_game_id` are all
  non-unique).

**G-4 — The four views other than `v_player_game`.** Only `v_player_game` was audited (B4 D2 →
D1/D2). I exercised the rest; **all four are internally coherent** and I record that as a
positive result so nobody re-opens it: `v_game` 4,648 rows (no join loss), `v_team_game` 9,270 =
base (its three INNER JOINs drop nothing), `v_backtest` 4,363 partitioning cleanly as
home 2,091 / away 2,163 / push 109 and agreeing with `team_game.covered` on every row,
`v_season_coverage` sane in all 17 seasons. **`v_backtest` inherits EX-01's overloaded-NULL
trap** — it filters `spread_line IS NOT NULL` so it is safe today, but it is the view a
backtester will use and the trap lives one join away.

**G-5 — D1's blast radius is larger than the ledger says.** `v_player_game`'s broken postseason
join does not merely null the game context; because `spread_line`/`total_line` are joined
*through* `g.game_id`, it nulls the betting lines too:

```
POST | 12050 rows | game_id NULL 12050 | spread_line NULL 12050 | kickoff_utc NULL 12050 | roof NULL 12050
REG  | 274794     |                  0 |                      0 |                      0 |             0
```

**Every postseason player-prop row in the modelling view has no spread and no total.** That is
the single most betting-relevant consequence in the ledger and D1 does not state it.

**G-6 — `team_game.game_number` semantics.** A4 verified it is gapless 1..n, chronological by
`kickoff_utc`, and consistent with week/playoff order (0 violations each) — better coverage than
the brief assumed. What is undocumented: it is a **continuous counter across REG and POST**
(`REG` 1–17, `POST` 17–21), so a bye week makes `game_number ≠ week` and a team's first playoff
game continues the regular-season sequence. Any join or filter treating it as a week is wrong.

**G-7 — `SBBYE`.** 3,390 `depth_chart` rows carry `season_type = 'SBBYE'`, a sixth value in a
column the rest of the schema restricts to `('REG','POST')`. B3 flagged the vocabulary clash and
B4 classified the NULL weeks as structural, but **no agent verified that those 3,390 rows are
attributed to the correct season** — an SB-bye snapshot falls in late January/early February,
i.e. the calendar year *after* its season. Given B3 found the `week` column is a continuous
1–22 counter that is wrong on 26,532 other rows, the SBBYE season attribution deserves the same
scrutiny and got none.

**G-8 — `season_type` has no CHECK on three tables.** `game` and `game_line` are
CHECK-constrained; `team_game`, `snap_count` and `depth_chart` are not. That is precisely how
`snap_count` came to hold `SB`/`WC`/`DIV`/`CON` (D20) and `depth_chart` came to hold `SBBYE`
(D8) without anything failing. `team_game` also lacks the week/playoff_round exclusivity CHECK
that `game` enforces — it happens to satisfy it on all 9,270 rows today, unenforced.

**G-9 — Nobody re-ran another agent's verifier.** Ten scripts under `verify/` and `lib/`, each
asserted to exit non-zero on failure, and no cross-check that any of them actually does.
`rowloss.py` is the only one with a documented negative control against a perturbed copy; A3's
`--selftest` is the only classifier with one.

**G-10 — A5's open risk is not in the ledger's risk list.** A5 states plainly that
non-scoring play duplication is **undetectable league-wide** because `nfl.db` stores no team
offensive yardage, and that `2011_10_DET_CHI` was found by chance. `INTEGRATION.md` records it
as a note under the A5 block; it belongs in the register as the largest *unquantified* residual.

---

### 4. The authoritative register

Ranked by **betting-decision impact** — how wrong an answer a real query returns — not by row
count. `⊕` = my additions, absent from `INTEGRATION.md`. Corroboration is the §1 verdict where
applicable.

| # | Defect | Rows | Found by | Corroboration | Origin | Severity |
|---|---|---:|---|---|---|---|
| **D14** | `team_game.covered`/`won` encode three states in a boolean; a naive ATS win-rate reads **45.89%** where the truth is **50.00%** | 762 + 570 NULLs, poisons every aggregate | A4 EX-01/02 | single, verified by me | local schema | **CRITICAL** — produces a false 4.1pp profitable-fade signal across the entire backtest surface |
| **D10** | All 10 2026 neutral-site games flagged `location='Home'`, including Super Bowl LXI | 10 | A1 E4 | single, ESPN venue + Wikipedia | local (2026 ESPN loader) | **CRITICAL** — inverts home-field on 10 games of the season being bet |
| **D1** ⊕ | `v_player_game` nulls game context **and `spread_line`/`total_line`/`kickoff_utc`/`roof`** on all POST rows | 12,050 | B4 D2; extension mine | verified by me | local view | **CRITICAL** — every playoff prop row in the modelling view is unpriced |
| **N1** ⊕ | `2017_04_CHI_GB` carries **four assumed `−110` juice values that were never observed** (`odds_source='manual-2026-07-27'`) | 1 row / 4 values | A4 EX-09 | single | local patch | **CRITICAL** — a fabricated price in a betting column; the exact failure standing rule 1 names. Not in the ledger |
| **D11** | All 285 2026 rows derive `gameday` from the UTC date; 91 land a day late | 91 | A1 E5 | single | local (2026 loader) | **HIGH** — date joins and rest wrong for a third of the season being bet |
| **N2** ⊕ | Two further disputed spreads A4 could not resolve: `2021_15_NE_IND` (−1.0 NE; ESPN majority IND −1/−1.5 and **the DB's own moneyline leans IND**) and `2021_17_CLE_PIT` | 2 | A4 EX-06/07 | ESPN multi-book + internal | upstream nflverse | **HIGH** — EX-06 is A4's "strongest single candidate for a genuine upstream sign error". Not in the ledger |
| **D16** | 4 Super Bowls have every snap row on the opponent's team | 358 | A3 E-10, A5 D4 | **correlated, externally grounded** | upstream nflverse | **HIGH** — destroys usage features for the 4 highest-leverage games |
| **D17** | `2011_13_DET_NO` and `2011_10_DET_CHI` inflated by duplicated plays; Ingram and K. Smith each gain a **phantom rushing TD** | 10 players / 2 games | A5 D6 | 3 ways: score reconstruction, ESPN, nfl.com PBP | upstream nflverse | **HIGH** — directly wrong prop outcomes (anytime-TD, yardage) |
| **D8** | `depth_chart.week` is a continuous 1–22 counter; 26,532 REG rows sit past their season's final REG week | 552,514 | B3 C3 | single, full population | local encoding | **HIGH** — any `(season, week)` join to `game` is silently wrong |
| **D20** | `snap_count.season_type` uses `SB`/`WC`/`DIV`/`CON` where `game` uses `POST`+`playoff_round` | 14,136 postseason rows | A5 | single, verified by me | local encoding | **HIGH** — snap↔game joins on `season_type` return zero rows silently |
| **D9** | `espn_event_id` `301114022` on both `2010_10_HOU_JAX` and `2010_10_SEA_ARI`; correct value `301114030` | 1 | A1 E1, A2 exc.1 | **correlated discovery, confirmed value** | upstream (also in `games.json`) | **HIGH** — attributes SEA@ARI to HOU@JAX and double-counts ARI on any ESPN join |
| **D18** ⊕ | Jonah Williams `pfr_id` swap — 146 snap rows **plus the 4 draft fields on `00-0035944`** | 146 + 4 fields | A3 E-9, A5 D5 | **correlated; rests on A3's ESPN check** | upstream `players.csv` | **HIGH** — a bad `pfr_id` silently redirects an entire usage history; ledger omits the draft fields |
| **D15** | 34 stale `rest_days` across 17 games; `2022_18_NE_BUF`/`2022_18_BAL_CIN` store 6 where the truth is 15 | 34 | A4 EX-03 | recomputed full population | upstream nflverse | **HIGH** — rest is a first-class modelling feature; a "short rest" filter buckets BUF/CIN backwards |
| **D12** | 5 London 09:30 ET games stored +12h (wrong calendar day); 2 Arizona kickoffs wrong | 7 | A1 E2/E3 | ESPN + Wikipedia, third-sourced | upstream nflverse | **HIGH** — wrong day-of-week and wrong rest for these games *and their schedule neighbours* |
| **D13** | 7 of 2025's international games record the home team's stadium/`stadium_id`/`roof`/`surface`; 5 carry weather of unverifiable provenance | 7 | A1 E6 | ESPN + Wikipedia | local (2025 path) | **MEDIUM-HIGH** — roof/surface/weather are model inputs; `2025_10_ATL_IND` has `roof='closed'` *and* populated weather, i.e. mixed provenance in one row |
| **N3** ⊕ | ESPN publishes **duplicate athlete records**; `player.espn_id` sometimes holds the one ESPN's box scores do not use | ≥6 known (Shaun Hill, Blount, Hynoski, Manhertz, D. Brown, Jordan Davis) + Ertz's dead `15835` | B3 C1, A3 E-7, A5 E5 | **three agents, three routes — genuinely independent** | upstream ESPN | **MEDIUM** — silent zero-row joins against ESPN; **is not** the "5 wrong espn_ids" A5 reported (see C-02) |
| **D6** | `depth_chart` missing 554,215 recoverable rows (the whole 2025 season) | 554,215 | B3 | B4 confirmed the arithmetic; B2 confirmed the shape split | local exclusion on a false premise | **MEDIUM** — half the feed absent, but it is depth-chart context, not price or production |
| **D5** | 1,482 ids referenced by fact tables absent from `player` | 1,590 roster + 1 depth | B5 | single, full population | upstream release scoping | **MEDIUM** — broken joins, no wrong number |
| **D4** | 227 `snap_count` rows with NULL `gsis_id`; the shipped gate was `≥95%` and passed at 99.93% | 227 | B1 | per-row against nflverse weekly rosters | upstream `pfr_id` gaps | **MEDIUM** — the *gate* is the defect; B1 resolves all 227 |
| **N4** ⊕ | 6 `snap_count` rows put Jalen Davis in two games at once (3 impossible weeks) | 6 | A3 E-11, A5 D7, B4 D6 | **fully correlated, no external source** | upstream PFR conflation (**hypothesis**) | **MEDIUM** — the anomaly is proven; the *cause* is not. A5's "three rows" is wrong |
| **D7** | `snap_count.pfr_game_id` holds the nflverse `game_id`, never PFR's | 324,611 | B4 C3, A5 E7 | independent (both full population) | local loader `pick()` | **MEDIUM** — any join to `game.pfr_game_id` returns zero rows silently |
| **N5** ⊕ | 6 Detroit 2024 DT snap rows credited via `SmitCh06` to a 2002 offensive tackle | 6 | A3 E-2 | ESPN `statisticslog` closes the loop | upstream `players.csv` | **MEDIUM** — same mechanism as D18, unlisted in the ledger |
| **D19** | 13 Tampa Bay 2020 stat lines keyed to a 2024 rookie OL instead of the safety | 13 (**all zero-valued**) | A3 E-1, A5 D2 | **partly independent — confirmed** | upstream `player_stats.csv` | **MEDIUM** — identity, not production. **A3's "highest" severity is not supported**: every value in all 13 rows is 0 |
| **N6** ⊕ | `PRAGMA foreign_keys = 0`; `snap_count`, `roster_season` and `depth_chart` declare no player FK and have **no primary key or unique index at all** | 3 tables | mine (§3 G-1/G-2) | — | local schema | **MEDIUM** — orphans and duplicates cannot be caught structurally; `foreign_key_check` returning 0 is misleading |
| **D3** | Alias lookup is `.get()` with no fallback | **0 rows today** | B2 | contradicted in part by A2 — see C-07/C-08 | local loader | **LOW-MEDIUM** — real hazard, zero live impact; ledger's stated 92-row consequence is unsupported (§5) |
| **D2** | `v_player_game` snap join lacks a franchise predicate | 1 extra row today | B4 D6 | verified by me (286,844 vs 286,843) | local view | **LOW-MEDIUM** — small today, but the proposed fix is incomplete (§5) |
| **N7** ⊕ | 7 `st_pct` values reconcile against no integer team total; 3 more carry `st_pct = 1.01` | 10 | A5 D3 | internal only — **no external oracle exists** | upstream nflverse | **LOW-MEDIUM** — special-teams share only; unadjudicable, not in the ledger |
| **N8** ⊕ | `roster_season` discards the source's `week` and `game_type`; 4 player-seasons become indistinguishable duplicate rows | 2 columns / 4 collisions | B4 D5 | single | local loader | **LOW** — not in the ledger |
| **N9** ⊕ | 18 `roster_season` rows carry a NULL `gsis_id`; **17 resolve unambiguously**, 1 (J.J. Molson) does not | 18 | B5 E7 | single | upstream | **LOW** — nobody was assigned this class; not in the ledger |
| **D21** | Snap counts start in **2013**; 52,386 stat rows (2010–2012) have no usage signal | 52,386 | A5 | verified by me | **2010–11 structural; 2012 is a local extract gap** | **LOW** — modelling boundary, but see §5: "not a defect" is wrong for 2012 |
| **N10** ⊕ | 46 `espn_id` values point at a different human (all with zero stat and zero snap rows); 6 more are ESPN birthdate errors; 2 are ESPN name errors | 54 `player` rows, **1** fact-bearing | A3 E-4 | ESPN, full population, with a negative control | upstream `players.csv` | **LOW** — forward-looking only; not in the ledger |
| **N11** ⊕ | Kevin White `00-0031683` carries the *other* Kevin White's birthdate, destroying the collision set's only discriminator | 1 | A3 E-5, B5 §2 | **independent — two agents, two methods** | upstream | **LOW** today, dormant hazard |
| **N12** ⊕ | Layne Pryor occupies two `player` rows sharing one `esb_id`; `REE257783` and two `smart_id`s each span 2–3 different humans | 4 key collisions | B5 §2, A3 E-3 | independent | upstream | **LOW** — dormant; would split a career the moment either accrues rows |
| **N13** ⊕ | **Open risk, unquantified:** non-scoring play duplication is undetectable league-wide because `nfl.db` stores no team offensive yardage | unknown | A5 | — | upstream | **UNQUANTIFIED** — A5 found 2 corrupted games, one by chance. Belongs in the register, not a footnote |

---

### 5. Where `INTEGRATION.md` overstates or omits

**Overstated — the reports do not support these as written:**

1. **D3's stated consequence.** "The 2026 players release relabelled `ARI`→`AZ`; **92 rows would
   have loaded team-less with no error**." The `player` table has no `latest_team` column and
   `build_db.py` never reads it (C-08), so those 92 values reach no franchise column in any
   scenario. Zero NULL `franchise_id` values exist in any fact table today. The `.get()` hazard
   is real and the fix is right; the 92-row consequence is not. Restate as: *0 rows affected
   today; the hazard is that the next relabelling lands in a column the loader does read.*
   D3's supporting figure "3 missing aliases" is also wrong — it is 1 (C-07).

2. **D21's "Not a defect."** A5 says explicitly: "For 2012 that is an **extract gap, not a
   source gap**: nflverse publishes snap counts from 2012. For 2010–2011 no snap data exists
   anywhere." The ledger collapses both into "not a defect". **2012 is a fixable local gap**
   — roughly a third of the 52,386 dark stat rows — and should be an action item, not a
   documented boundary.

3. **A3's severity on D19**, carried implicitly by the ledger's ordering. All 13 rows are
   all-zero (C-c above). The defect is real; "a full season of defensive performance" is not.

**Incomplete — right, but the fix as written will not close it:**

4. **D2's fix.** Adding `AND s.franchise_id = p.franchise_id` is necessary and correct. But the
   same snap join *also* has no `season_type` predicate, and D20 says the two tables use
   incompatible `season_type` vocabularies. It is safe today only by coincidence — I measured
   0 disagreements, because REG and POST week ranges happen not to overlap within a season. Fix
   D20 first, or the "obvious" hardening of D2 will silently drop every postseason snap.

5. **D1's blast radius.** It nulls `spread_line`, `total_line`, `kickoff_utc` and `roof` on all
   12,050 POST rows, not just the game id (G-5). State it, because it is the single most
   betting-relevant line in the ledger.

6. **D18's scope.** 146 snap rows *and* four wrong draft fields on `00-0035944` (§1b).

7. **The 341 decision.** "Actual data forfeited: **11 receiving yards**." B4's own report says
   2 receptions, 2 targets, 11 receiving yards, 1.1 / 3.1 fantasy points; A5 adds the ESPN and
   nfl.com confirmation (13/95) and the broken DAL team-game identity. The undercount is the
   coordinator's summary, not B4's finding.

**Omitted — confirmed findings with no ledger entry:**

8. A4 **EX-09** — four assumed `−110` juice values live in `game_line` (register N1). This is
   the only *fabricated* value the audit found still sitting in the database.
9. A4 **EX-06 / EX-07** — two disputed spreads, one of which A4 calls the strongest candidate
   for a genuine upstream sign error (N2). The ledger's contradiction section carries 2 of A4's
   4.
10. A3 **E-2** — 6 Detroit snap rows on a 2002 tackle (N5).
11. A5 **D3** — 10 unreconcilable `st_pct` values (N7).
12. B4 **D5** — `roster_season` discards `week`/`game_type` (N8).
13. B5 **E7** — 18 NULL-`gsis_id` roster rows, 17 resolvable (N9).
14. A3 **E-4 / E-5** and B5's key-collision table (N10–N12).

**Already closed, still listed as open:**

15. "190 unsourceable `pfr_id` and **17 `espn_id`** (B5) — confirm each is genuinely absent
    upstream." A3 resolved **12 of the 17** to named ESPN athlete ids with evidence (C-04). The
    residue is 4 unresolvable + 1 ambiguous.

---

## Exceptions

Items I could not resolve from the reports and the database alone.

| # | Item | Why unresolved |
|---|---|---|
| S1-X1 | `roster_season` semantics (O-1) | Three incompatible descriptions and none matches the data. Resolving it requires deciding what the table is *for*; it is an owner call, and it changes the reading of A5 E6 and A3 §7. |
| S1-X2 | Snap-era boundary: 2012 (B1) vs 2013 (A5, DB) (O-2) | Not a data conflict — B1's filter is a safe superset — but the project has no single stated convention, and D21 records only one of the two numbers. |
| S1-X3 | Whether `depth_chart`'s 3,390 `SBBYE` rows carry the correct `season` (G-7) | No agent checked, and I have no non-`nfl.db` source to check against without network access I was not asked to use. Flagged, not asserted. |
| S1-X4 | Cause of the Jalen Davis anomaly (N4) | Three agents assert "PFR conflates two cornerbacks". No external source was or can currently be consulted (PFR 403s; ESPN publishes no snaps). The anomaly is proven; the cause is a hypothesis and should be labelled one. |
| S1-X5 | A4's EX-06 / EX-07 spreads | Genuine source disagreement. Recorded, not resolved, per rule 4. |
| S1-X6 | Whether any `verify/` or `lib/` script actually fails when it should (G-9) | Only `rowloss.py` and A3's `--selftest` document a negative control. Re-running eight scripts was outside my scope and would have taken network access. |

---

## Reproduce

Every number above. All read-only; none touches `nfl.db`.

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai/scripts/data/nfl-db

# 0. The database is unchanged (run before and after).
md5 nfl.db nfl.db.pre-completion-backup   # both 1d2b0bea3e85edf467ef446db807bc7d

# --- §1c: the 13 Mike Edwards rows are all zero ---
sqlite3 -readonly nfl.db "SELECT season,week,season_type,completions,attempts,passing_yards,
  carries,rushing_yards,receptions,targets,receiving_yards
  FROM player_game_stats WHERE gsis_id='00-0039472' ORDER BY week;"

# --- §1d: 6 rows in 3 impossible weeks, not 3 rows ---
sqlite3 -readonly nfl.db "SELECT gsis_id,season,week,group_concat(DISTINCT franchise_id),
  group_concat(DISTINCT pfr_game_id),count(*) FROM snap_count
  WHERE gsis_id='00-0034446' AND season IN (2019,2021) GROUP BY 1,2,3;"

# --- §1e: exactly one duplicate espn_event_id in 4,648 rows ---
sqlite3 -readonly nfl.db "SELECT espn_event_id,group_concat(game_id) FROM game
  GROUP BY 1 HAVING COUNT(*)>1;"

# --- C-02: A5's five 'wrong' espn_ids resolve to the right humans (A3's cache) ---
python3 - <<'PY'
import json,glob
for i in ('3923394','3166800','2268575','4071345','2544798'):
    d=json.load(open(glob.glob(f'cache/a3/athletes/*/{i}.json')[0]))
    print(i, d.get('fullName'), (d.get('dateOfBirth') or '')[:10], d.get('debutYear'))
PY

# --- C-03: the denominators reconcile; 21 = 21 ---
sqlite3 -readonly nfl.db "
WITH refd AS (SELECT DISTINCT gsis_id g FROM player_game_stats
  UNION SELECT gsis_id FROM snap_count     WHERE gsis_id IS NOT NULL
  UNION SELECT gsis_id FROM roster_season  WHERE gsis_id IS NOT NULL
  UNION SELECT gsis_id FROM depth_chart    WHERE gsis_id IS NOT NULL
  UNION SELECT away_qb_id FROM game WHERE away_qb_id IS NOT NULL
  UNION SELECT home_qb_id FROM game WHERE home_qb_id IS NOT NULL)
SELECT COUNT(*), SUM(p.espn_id IS NULL OR p.espn_id=''), SUM(p.pfr_id IS NULL OR p.pfr_id='')
FROM refd JOIN player p ON p.gsis_id=refd.g;"          # 10111 | 21 | 193

# --- C-04: A3 resolved 16 of the 21; only 4 are unresolvable ---
python3 -c "import json,collections;d=json.load(open('cache/a3/missing_espn_resolution.json'));
print(collections.Counter(v['status'] for v in d.values()))"

# --- C-05 / C-06: shape B parses cleanly and runs Aug 2025 -> Mar 2026 ---
python3 - <<'PY'
import csv; csv.field_size_limit(10**9)
mn=mx=None; nB=nA=0; late=0
for r in csv.DictReader(open("raw/depth_charts.csv",newline="",encoding="utf-8",errors="replace")):
    dt=(r.get("dt") or "").strip()
    if dt:
        nB+=1; late+= dt>="2026-03"
        mn=dt if mn is None or dt<mn else mn; mx=dt if mx is None or dt>mx else mx
    else: nA+=1
print("shapeB",nB,mn,"->",mx,"| 2026-03+:",late,"| shapeA",nA)
PY
# shapeB 554215 2025-08-03T10:09:07Z -> 2026-03-14T07:32:09Z | 2026-03+: 36364 | shapeA 552514

# --- C-07 / C-08: LAR and WSH are present; AZ is not; zero live impact ---
sqlite3 -readonly nfl.db "SELECT abbreviation,franchise_id,is_current FROM team_alias
  WHERE abbreviation IN ('AZ','LAR','WSH');"
sqlite3 -readonly nfl.db "
SELECT (SELECT COUNT(*) FROM player_game_stats WHERE franchise_id IS NULL OR opponent_id IS NULL),
       (SELECT COUNT(*) FROM snap_count    WHERE franchise_id IS NULL),
       (SELECT COUNT(*) FROM roster_season WHERE franchise_id IS NULL),
       (SELECT COUNT(*) FROM depth_chart   WHERE franchise_id IS NULL);"   # 0|0|0|0
sqlite3 -readonly nfl.db "PRAGMA table_info(player);" | grep -c latest_team   # 0

# --- C-09: the D.Bryant residual row is real production; R.Rodgers is not ---
python3 - <<'PY'
import csv; csv.field_size_limit(10**9)
for r in csv.DictReader(open("raw/player_stats.csv",newline="",encoding="utf-8",errors="replace")):
    if not r["player_id"] and r.get("player_name","").strip() in ("D.Bryant","R.Rodgers"):
        print({k:v for k,v in r.items() if v not in ("","0","0.0","NA","NaN")})
PY

# --- O-1: roster_season is not a one-row-per-player-season snapshot ---
sqlite3 -readonly nfl.db "
SELECT n_rows, COUNT(*) FROM (SELECT gsis_id,season,COUNT(*) n_rows FROM roster_season
  WHERE gsis_id IS NOT NULL GROUP BY 1,2) GROUP BY 1;"   # 1|42680  2|498  3|50  4|3
sed -n '261,269p' build_db.py                            # no week filtering in the loader

# --- G-2 / G-3 / G-8: enforcement, indexes, CHECKs ---
sqlite3 -readonly nfl.db "PRAGMA foreign_keys;"          # 0  -- FKs not enforced
sqlite3 -readonly nfl.db "PRAGMA foreign_key_check;"     # 0 rows -- because little is declared
for t in snap_count roster_season depth_chart player_game_stats; do
  echo "-- $t"; sqlite3 -readonly nfl.db "PRAGMA foreign_key_list($t);"; done
sqlite3 -readonly nfl.db "SELECT COUNT(*) FROM sqlite_master
  WHERE type='index' AND tbl_name='player' AND sql LIKE '%espn_id%';"      # 0
sqlite3 -readonly nfl.db "SELECT group_concat(DISTINCT season_type) FROM snap_count;"   # REG,WC,DIV,CON,SB
sqlite3 -readonly nfl.db "SELECT group_concat(DISTINCT season_type) FROM depth_chart;"  # +SBBYE

# --- G-4: the four unaudited views are coherent ---
sqlite3 -readonly nfl.db "
SELECT (SELECT COUNT(*) FROM v_game),(SELECT COUNT(*) FROM v_team_game),
       (SELECT COUNT(*) FROM team_game),(SELECT COUNT(*) FROM v_backtest);"  # 4648|9270|9270|4363
sqlite3 -readonly nfl.db "SELECT b.ats_winner, tg.covered, COUNT(*) FROM v_backtest b
  JOIN team_game tg ON tg.game_id=b.game_id AND tg.is_home=1 GROUP BY 1,2;"

# --- G-5: D1 also nulls the betting lines on every POST row ---
sqlite3 -readonly nfl.db "SELECT season_type,COUNT(*),SUM(game_id IS NULL),
  SUM(spread_line IS NULL),SUM(kickoff_utc IS NULL),SUM(roof IS NULL)
  FROM v_player_game GROUP BY 1;"        # POST|12050|12050|12050|12050|12050

# --- G-6: game_number is continuous across REG and POST ---
sqlite3 -readonly nfl.db "SELECT season_type,MIN(game_number),MAX(game_number)
  FROM team_game GROUP BY 1;"            # POST|17|21   REG|1|17

# --- register spot-checks: D14, D10, D21 ---
sqlite3 -readonly nfl.db "SELECT ROUND(100.0*SUM(covered=1)/COUNT(*),2),
  ROUND(100.0*SUM(covered=1)/SUM(covered IS NOT NULL),2), SUM(covered IS NULL) FROM team_game;"
# 45.89 | 50.0 | 762
sqlite3 -readonly nfl.db "SELECT season,SUM(location='Neutral') FROM game WHERE season>=2022 GROUP BY 1;"
# 2022|7  2023|6  2024|7  2025|8  2026|0
sqlite3 -readonly nfl.db "SELECT COUNT(*) FROM player_game_stats WHERE season<=2012;"   # 52386
```

**Files I own and wrote:** this report only. `nfl.db`, `nfl.db.pre-completion-backup`,
`build_db.py`, `schema.sql`, `INTEGRATION.md` and the other nine reports are unmodified.
