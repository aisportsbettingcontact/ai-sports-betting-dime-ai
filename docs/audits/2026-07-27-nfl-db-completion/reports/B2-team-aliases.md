# B2 — Team abbreviation → franchise mapping: completeness and correctness

## Verdict

**PASS WITH EXCEPTIONS** — all 2,446,721 non-blank team-like values across every column of all six
sources now resolve to exactly one franchise, but the shipped alias table was **incomplete (3
missing aliases, one of which would have crashed the 2026 players load) and unsafe (`HOU` and `BAL`
are era-split and were mapped flat)**.

## What I checked

Full population, no sampling. Twelve team-bearing columns across six sources:

| Source | Team-bearing columns |
|---|---|
| `raw/players.csv` | `latest_team`, `draft_team` |
| `raw/rosters.csv` | `team`, `draft_club` |
| `raw/snap_counts.csv` | `team`, `opponent` |
| `raw/player_stats.csv` | `team`, `opponent_team` |
| `raw/depth_charts.csv` | `club_code`, `team` |
| `scripts/data/nfl-unified-2010-2026/games.json` | `awayAbbr`, `homeAbbr` |

Plus the abbreviations embedded in the `game_id` / `gameId` strings of `snap_counts.csv`,
`player_stats.csv` and `games.json` (form `SEASON_WEEK_AWAY_HOME`), used as the resolution anchor
rather than as a census target.

Method, in order:

1. **Census** — distinct value × column × season × row count for all twelve columns, including
   blanks and whitespace.
2. **Empirical resolution** — every `snap_counts` and `player_stats` row carries a `game_id`; joined
   to `games.json`, whose `awayFranchiseId` / `homeFranchiseId` were resolved independently from
   ESPN event ids. That gives a per-row franchise truth. `rosters` and `depth_charts` rows were
   linked to it **week-exactly** by `(gsis_id, season, week, season_type)`; `players.csv` by
   `(gsis_id, last_season)`.
3. **ESPN anchoring** — `sports.core.api.espn.com/.../seasons/{year}/teams/{id}` fetched per season
   for all 32 franchises (2026) and for the relocation-sensitive franchises 13/14/22/24/28 across
   2010–2025, plus historic probes at 1983/1984/1987/1988/1994/1995/1996/1997/1999/2002. Cached
   under `scripts/data/nfl-db/cache/b2/` (101 responses: 10 season indexes, 77 team records,
   14 historic era probes).
4. **Cross-feed identity** — for every `gsis_id`, paired `rosters.draft_club` against
   `players.draft_team` to prove the PFR-style spellings denote the same club.

## Results

### Headline

| Measure | Value |
|---|---|
| Team-like values scanned (non-blank) | 2,446,721 |
| Distinct non-blank values | 44 |
| Values unmapped after this work | **0** |
| Aliases missing from the shipped table | **3** (`AZ`, `LAR`, `WSH`) |
| Aliases that are wrong for some season | **2** (`HOU`, `BAL`) |
| Structurally-absent (blank) values | 1,137,405, every one explained below |

### The three missing aliases

| Value | Rows | Where | Franchise | Consequence of the omission |
|---|---:|---|---|---|
| `AZ` | 92 | `players.csv::latest_team`, season 2026 only | 22 Arizona Cardinals | The 2026 players release relabelled `ARI` → `AZ`. Zero `ARI` rows carry `last_season` 2026 and zero `AZ` rows carry anything else, so this is a clean cutover — every 2026 active Cardinal would have lost its team. |
| `LAR` | 78 | `games.json` 2026 (17), `rosters.csv::draft_club` 2025 (61) | 14 Los Angeles Rams | ESPN's own spelling. The 2026 schedule is ESPN-sourced and uses it. |
| `WSH` | 17 | `games.json` 2026 | 28 Washington Commanders | ESPN's own spelling, same cause. |

`AZ` is the dangerous one: it is a *silent* loss, not a crash. `build_db.py` resolves player-feed
teams with `alias2fid.get(...)`, which returns `None` on a miss and writes NULL.

### The two era-split abbreviations — `HOU` and `BAL`

These cannot be a flat `str -> int` map. The proof is a **season gap that exactly matches the
franchise's absence from the city**:

```
players.csv latest_team, seasons present:
  HOU  [(1974, 1996), (2002, 2026)]      <- 5-year gap: no NFL team in Houston 1997-2001
  TEN  [(1997, 2026)]
  BAL  [(1974, 1983), (1996, 2026)]      <- 12-year gap: no NFL team in Baltimore 1984-1995
  IND  [(1984, 2026)]
players.csv draft_team shows the identical gaps.
```

ESPN confirms the split from its own season records:

| Query | ESPN answer |
|---|---|
| `seasons/1995/teams/10` | `HOU` — Houston Oilers |
| `seasons/1996/teams/10` | `HOU` — Houston Oilers |
| `seasons/1997/teams/10` | `TEN` — Tennessee Oilers |
| `seasons/2002/teams/34` | `HOU` — Houston Texans |
| `seasons/1983/teams/11` | `IND` — **Baltimore Colts** (ESPN retro-applies IND) |
| `seasons/1996/teams/33` | `BAL` — Baltimore Ravens |

So `HOU` in a season ≤ 1996 is franchise **10** (Titans lineage), not 34. `BAL` in a season ≤ 1983
is franchise **11** (Colts lineage), not 33. The affected rows:

| Abbr | Rows currently mis-mappable | Site |
|---|---:|---|
| `HOU` ≤ 1996 | 248 | `players.csv::latest_team` (+ matching `draft_team` rows) |
| `BAL` ≤ 1983 | 108 | `players.csv::latest_team` (+ matching `draft_team` rows) |

**These rows do not reach a franchise column today** — `build_db.py` stores `draft_club`/`draft_team`
as raw TEXT in `player` and never reads `latest_team`. This is a latent hazard, not a live bug. It
becomes a live bug the moment anyone resolves those columns. `resolve()` refuses `HOU`/`BAL` without
a season for exactly this reason.

`CLE` looks similar and is **not** era-split: its gap is `[(1974,1995),(1999,2026)]`, the Browns'
1996-98 dormancy, and both sides are franchise 5 (ESPN `seasons/1995/teams/5` and
`seasons/1999/teams/5` both return `CLE` — Cleveland Browns).

### `LA` — the dangerous case, resolved

`LA` is franchise **14 (Rams)** in every season it appears, in every source. It is never the
Chargers. Three independent lines of evidence:

**1. `LAC` occurs disjointly in every site where `LA` occurs.** If `LA` ever meant the Chargers,
`LAC` would have a hole. It does not:

| Site | `LA` seasons | `LAC` seasons |
|---|---|---|
| `games.json::awayAbbr`/`homeAbbr` | 2016–2025 | 2017–2026 |
| `snap_counts::team`/`opponent` | 2016–2025 | 2017–2025 |
| `player_stats::team`/`opponent_team` | 2010–2025 | 2010–2025 |
| `rosters::team` | 2016–2025 | 2017–2025 |
| `depth_charts::club_code` | 2016–2024 | 2017–2024 |
| `players.csv::latest_team` | 1974–2026 | 1974–2026 |

**2. Game-anchored, per row, per season — every season 100% franchise 14, zero rows to 24:**

```
games.json::awayAbbr  LA  2016=>14 8/8 | 2017=>14 8/8 | 2018=>14 9/9 | 2019=>14 8/8 | 2020=>14 10/10
                          2021=>14 11/11 | 2022=>14 8/8 | 2023=>14 10/10 | 2024=>14 9/9 | 2025=>14 12/12
games.json::homeAbbr  LA  2016=>14 8/8 | 2017=>14 9/9 | 2018=>14 10/10 | 2019=>14 8/8 | 2020=>14 8/8
                          2021=>14 10/10 | 2022=>14 9/9 | 2023=>14 8/8 | 2024=>14 10/10 | 2025=>14 8/8
snap_counts::team     LA  2016=>14 719/719 | 2017=>14 764/764 | 2018=>14 856/856 | 2019=>14 721/721
                          2020=>14 831/831 | 2021=>14 968/968 | 2022=>14 786/786 | 2023=>14 827/827
                          2024=>14 861/861 | 2025=>14 932/932
snap_counts::opponent LA  2016=>14 717/717 ... 2025=>14 935/935      (all 10 seasons 100%)
player_stats::team    LA  2011,2012,2013,2015,2016..2025 => 14 at 100%; 2010 463/528 and 2014 456/522
                          (the residual is UNRESOLVED, never franchise 24 — see below)
rosters::team         LA  2016=>14 36/36 | 2017=>14 32/32 | 2018=>14 26/26 | 2019=>14 33/33 | 2020=>14 32/32
                          2021=>14 30/30 | 2022=>14 25/25 | 2023=>14 31/31 | 2024=>14 36/36 | 2025=>14 35/35
depth_charts::club_code LA 2016..2024 => 14 at 99.8%+ (residual is mid-season player movement, see below)
```

Across the whole corpus: **46,000+ game-anchored `LA` rows resolve to franchise 14 and zero resolve
to franchise 24.**

**3. ESPN never emits bare `LA` for anyone.** Its abbreviation for franchise 14 is `STL` (≤2015) then
`LAR` (2016+); for franchise 24 it is `SD` (≤2016) then `LAC` (2017+). There is no season in which
ESPN's vocabulary contains `LA`, so the collision the task worried about cannot arise under the ESPN
key. `LA` is an nflverse-only spelling of `LAR`.

### `SL` and `STL` — St. Louis, resolved

`SL` is franchise **14 (St. Louis Rams)**, never the Cardinals.

- `SL` appears in exactly two places: `rosters.csv::team` (393 rows, seasons 2010–2015) and
  `rosters.csv::draft_club` (265 rows, seasons 2010–2015). Nowhere else.
- 234 of those `team` rows link **week-exactly** to a game: 2010=>14 40/40, 2011=>14 43/43,
  2012=>14 37/37, 2013=>14 33/33, 2014=>14 41/41, 2015=>14 40/40. **100%, zero rows to franchise 22.**
- The Cardinals were in **Arizona for all of 2010–2015** and appear in those same files, those same
  seasons, as `ARZ` (382 `team` rows + 267 `draft_club` rows, all → 22). So both clubs are present
  and separately labelled.
- No `SL` `draft_club` row belongs to a player drafted before **2000** (earliest draft_year in the
  set), so none can predate the Cardinals' 1988 departure from St. Louis.

`STL` is franchise **14** everywhere it occurs (games.json 2010–2015, snap_counts 2013–2015,
depth_charts 2010–2015, rosters.draft_club 2016–2025), all 100% game-anchored.

**But `STL` is genuinely ambiguous in ESPN's own vocabulary**, and this is a real finding:

| Query | ESPN answer |
|---|---|
| `seasons/1987/teams/22` | `STL` — **St. Louis Cardinals** |
| `seasons/1988/teams/22` | `PHO` — Phoenix Cardinals |
| `seasons/1994/teams/14` | `LOS` — Los Angeles Rams |
| `seasons/1995/teams/14` | `STL` — St. Louis Rams |

`STL` therefore means franchise 22 in seasons ≤1987 and franchise 14 in seasons ≥1995. **That case
does not occur in any of the six sources** — but resolving `STL` without a season would be a guess,
so it is in `SEASON_DEPENDENT`.

### `BLT` / `HST` are safe; `ARZ` / `CLV` / `JAC` confirmed

The PFR-style spellings appear only in `rosters.csv`, only in seasons 2010–2015 (`JAC`: 2016 only),
long after the Baltimore Colts and Houston Oilers ceased to exist, so they carry no era ambiguity.
Week-exact resolution, 100% in every season:

```
rosters.csv::team ARZ 2010=>22 38/38 | 2011=>22 37/37 | 2012=>22 37/37 | 2013=>22 35/35 | 2014=>22 41/41 | 2015=>22 34/34
rosters.csv::team BLT 2010=>33 35/35 | 2011=>33 36/36 | 2012=>33 32/32 | 2013=>33 38/38 | 2014=>33 39/39 | 2015=>33 42/42
rosters.csv::team CLV 2010=>5  41/41 | 2011=>5  38/38 | 2012=>5  40/40 | 2013=>5  44/44 | 2014=>5  43/43 | 2015=>5  37/37
rosters.csv::team HST 2010=>34 34/34 | 2011=>34 38/38 | 2012=>34 37/37 | 2013=>34 37/37 | 2014=>34 35/35 | 2015=>34 41/41
```

Cross-feed identity is exact — every `rosters.draft_club` label maps to **one** `players.draft_team`
label for the same `gsis_id`, with zero exceptions:

```
ARZ -> ARI (267)   BLT -> BAL (313)   CLV -> CLE (276)   HST -> HOU (293)   JAC -> JAX (3)
SL  -> LA  (265)   STL -> LA  (194)   LA  -> LA  (340)   LAR -> LA  (61)
OAK -> LV  (654)   SD  -> LAC (443)
```

### Contradictions found between feeds (reported, not resolved)

**1. `player_stats.csv` uses two conventions in the same row.** Its `team` / `opponent_team` columns
are normalised to *current* franchise labels for all 16 seasons — there is no `SD`, `OAK` or `STL`
value anywhere in them — while its own `game_id` column keeps the *era* label. A 2014 Rams-at-
Chargers row reads `team=LA, opponent_team=LAC, game_id=2014_xx_STL_SD`. Both conventions denote the
same franchise, which is precisely why the ESPN-franchise-id key is the right one. This is the sole
cause of the 2,364 rows my game-anchor resolver could not pin to a side (neither label matches
either `game_id` slot); all 36 distinct patterns are `{STL,SD,OAK}` slot pairs against
`{LA,LAC,LV}` labels:

```
season 2015  game_id slots SD@OAK   row labels LV vs LAC    rows=39
season 2010  game_id slots SD@OAK   row labels LAC vs LV    rows=36
season 2014  game_id slots OAK@STL  row labels LA vs LV     rows=35
...  36 distinct patterns, 1,182 games, 2,364 rows
```

They resolve correctly through the flat map; only the *side* of the game was undeterminable by that
method, and the alias identity was never in doubt.

**2. `depth_charts.csv` is two files stapled together.** 552,514 schema-A rows (`season`, `week`,
`club_code`; 2010–2024) and 554,215 schema-B rows (`dt` timestamp, `team`, no season at all;
snapshots dated 2025-03 → 2026-07). `build_db.py` already documents and excludes schema-B. For the
census I derived schema-B's season from `dt` using a March league-year boundary. Its `team` values
are nflverse-normalised (`LA`, `WAS`), not ESPN-normalised (`LAR`, `WSH`) — worth noting because the
column name and shape otherwise look ESPN-derived.

**3. 113 depth-chart cells resolve to more than one franchise in a season, at a 0.1–0.4% noise
floor** (e.g. `club_code=ARI` 2021: 663 rows → 22, 2 rows → 28). These are players listed on team
X's week-W depth chart whose week-W stat line is for team Y — mid-week transactions, not alias
ambiguity. **Zero** such cells exist in `games.json`, `snap_counts`, `player_stats` or
`rosters` — the four game-anchored sites are unanimous.

### Full census

44 distinct non-blank values. Site abbreviations: `pl`=players.csv, `ro`=rosters.csv,
`sc`=snap_counts.csv, `ps`=player_stats.csv, `dc`=depth_charts.csv, `gj`=games.json. Season ranges
are the union across all sites — note that a `draft_club`/`draft_team` row's season is the **roster
season / draft year**, not a season the club played under that name, which is why `OAK`, `SD` and
`STL` show seasons past their relocation.

| Value | Rows | Sites (file.col, rows) | Seasons | Franchise | ESPN abbr |
|---|---:|---|---|---|---|
| `KC` | 82275 | pl.latest(823) pl.draft(394) ro.team(1346) ro.draft(772) sc.team(10847) sc.opp(10882) ps.team(9472) ps.opp(9522) dc.club(19759) dc.team(18153) gj.away(147) gj.home(158) | 1974-2026 | 12 | KC |
| `GB` | 80935 | pl.latest(827) pl.draft(444) ro.team(1332) ro.draft(1000) sc.team(10467) sc.opp(10455) ps.team(9327) ps.opp(9178) dc.club(19688) dc.team(17915) gj.away(153) gj.home(149) | 1974-2026 | 9 | GB |
| `NE` | 79670 | pl.latest(768) pl.draft(448) ro.team(1361) ro.draft(936) sc.team(10705) sc.opp(10673) ps.team(9602) ps.opp(9491) dc.club(18661) dc.team(16719) gj.away(147) gj.home(159) | 1974-2026 | 17 | NE |
| `PIT` | 78438 | pl.latest(678) pl.draft(440) ro.team(1373) ro.draft(812) sc.team(10197) sc.opp(10241) ps.team(9000) ps.opp(9174) dc.club(18344) dc.team(17885) gj.away(148) gj.home(146) | 1974-2026 | 23 | PIT |
| `SF` | 78420 | pl.latest(774) pl.draft(413) ro.team(1351) ro.draft(948) sc.team(10490) sc.opp(10486) ps.team(9251) ps.opp(9244) dc.club(17263) dc.team(17900) gj.away(151) gj.home(149) | 1974-2026 | 25 | SF |
| `SEA` | 78101 | pl.latest(798) pl.draft(389) ro.team(1425) ro.draft(891) sc.team(10507) sc.opp(10508) ps.team(9347) ps.opp(9279) dc.club(18483) dc.team(16174) gj.away(151) gj.home(149) | 1976-2026 | 26 | SEA |
| `BUF` | 77878 | pl.latest(778) pl.draft(416) ro.team(1364) ro.draft(777) sc.team(10477) sc.opp(10375) ps.team(9190) ps.opp(9056) dc.club(17770) dc.team(17382) gj.away(145) gj.home(148) | 1974-2026 | 2 | BUF |
| `PHI` | 77697 | pl.latest(724) pl.draft(391) ro.team(1320) ro.draft(868) sc.team(10479) sc.opp(10467) ps.team(9172) ps.opp(9128) dc.club(17833) dc.team(17019) gj.away(144) gj.home(152) | 1974-2026 | 21 | PHI |
| `NYG` | 77613 | pl.latest(887) pl.draft(393) ro.team(1431) ro.draft(718) sc.team(9776) sc.opp(9859) ps.team(8907) ps.opp(8959) dc.club(17610) dc.team(18788) gj.away(145) gj.home(140) | 1974-2026 | 19 | NYG |
| `NO` | 77077 | pl.latest(892) pl.draft(359) ro.team(1405) ro.draft(668) sc.team(10182) sc.opp(10101) ps.team(9003) ps.opp(8926) dc.club(17512) dc.team(17739) gj.away(144) gj.home(146) | 1974-2026 | 18 | NO |
| `BAL` | 76911 | pl.latest(636) pl.draft(331) ro.team(928) ro.draft(669) sc.team(10281) sc.opp(10191) ps.team(9432) ps.opp(9143) dc.club(18336) dc.team(16667) gj.away(151) gj.home(146) | 1974-1983, 1996-2026 | **11 ≤1983 / 33 ≥1996** | BAL (33) |
| `IND` | 76744 | pl.latest(806) pl.draft(326) ro.team(1449) ro.draft(785) sc.team(10094) sc.opp(10071) ps.team(8914) ps.opp(8917) dc.club(17015) dc.team(18079) gj.away(146) gj.home(142) | 1984-2026 | 11 | IND |
| `HOU` | 76679 | pl.latest(758) pl.draft(392) ro.team(933) ro.draft(497) sc.team(10281) sc.opp(10273) ps.team(9232) ps.opp(9220) dc.club(17127) dc.team(17672) gj.away(147) gj.home(147) | 1974-1996, 2002-2026 | **10 ≤1996 / 34 ≥2002** | HOU (34) |
| `DEN` | 76323 | pl.latest(761) pl.draft(383) ro.team(1305) ro.draft(810) sc.team(10156) sc.opp(10164) ps.team(9123) ps.opp(9072) dc.club(17497) dc.team(16761) gj.away(141) gj.home(150) | 1974-2026 | 7 | DEN |
| `TB` | 76025 | pl.latest(883) pl.draft(374) ro.team(1394) ro.draft(735) sc.team(10108) sc.opp(10191) ps.team(8869) ps.opp(8903) dc.club(16815) dc.team(17465) gj.away(143) gj.home(145) | 1976-2026 | 27 | TB |
| `CIN` | 75969 | pl.latest(664) pl.draft(471) ro.team(1298) ro.draft(949) sc.team(10070) sc.opp(10106) ps.team(8938) ps.opp(9040) dc.club(17433) dc.team(16711) gj.away(146) gj.home(143) | 1974-2026 | 4 | CIN |
| `TEN` | 75954 | pl.latest(539) pl.draft(231) ro.team(1383) ro.draft(750) sc.team(10066) sc.opp(10036) ps.team(8924) ps.opp(8913) dc.club(18237) dc.team(16590) gj.away(144) gj.home(141) | 1997-2026 | 10 | TEN |
| `MIA` | 75782 | pl.latest(829) pl.draft(405) ro.team(1410) ro.draft(795) sc.team(9840) sc.opp(9859) ps.team(8662) ps.opp(8783) dc.club(16243) dc.team(18675) gj.away(142) gj.home(139) | 1974-2026 | 15 | MIA |
| `DAL` | 75775 | pl.latest(706) pl.draft(431) ro.team(1367) ro.draft(892) sc.team(10139) sc.opp(10107) ps.team(8924) ps.opp(8849) dc.club(17044) dc.team(17029) gj.away(143) gj.home(144) | 1974-2026 | 6 | DAL |
| `WAS` | 75747 | pl.latest(984) pl.draft(340) ro.team(1415) ro.draft(747) sc.team(9921) sc.opp(9920) ps.team(8746) ps.opp(8816) dc.club(16939) dc.team(17652) gj.away(134) gj.home(133) | 1974-2026 | 28 | WSH |
| `DET` | 75558 | pl.latest(983) pl.draft(393) ro.team(1414) ro.draft(794) sc.team(10011) sc.opp(9971) ps.team(8774) ps.opp(8709) dc.club(16242) dc.team(17982) gj.away(143) gj.home(142) | 1974-2026 | 8 | DET |
| `NYJ` | 74926 | pl.latest(816) pl.draft(401) ro.team(1404) ro.draft(709) sc.team(9645) sc.opp(9737) ps.team(8713) ps.opp(8783) dc.club(16590) dc.team(17847) gj.away(142) gj.home(139) | 1974-2026 | 20 | NYJ |
| `CAR` | 74907 | pl.latest(639) pl.draft(217) ro.team(1386) ro.draft(755) sc.team(10099) sc.opp(10072) ps.team(8733) ps.opp(8918) dc.club(16654) dc.team(17148) gj.away(142) gj.home(144) | 1995-2026 | 29 | CAR |
| `ARI` | 74885 | pl.latest(650) pl.draft(290) ro.team(1030) ro.draft(517) sc.team(9881) sc.opp(9904) ps.team(8688) ps.opp(8770) dc.club(16372) dc.team(18501) gj.away(142) gj.home(140) | 1988-2026 | 22 | ARI |
| `MIN` | 74410 | pl.latest(715) pl.draft(400) ro.team(1282) ro.draft(897) sc.team(9976) sc.opp(10025) ps.team(8727) ps.opp(8756) dc.club(16706) dc.team(16640) gj.away(144) gj.home(142) | 1974-2026 | 16 | MIN |
| `ATL` | 74383 | pl.latest(860) pl.draft(394) ro.team(1344) ro.draft(752) sc.team(9933) sc.opp(9935) ps.team(8816) ps.opp(8842) dc.club(16053) dc.team(17167) gj.away(142) gj.home(145) | 1974-2026 | 1 | ATL |
| `CHI` | 73956 | pl.latest(746) pl.draft(393) ro.team(1340) ro.draft(700) sc.team(9867) sc.opp(9891) ps.team(8685) ps.opp(8741) dc.club(16758) dc.team(16551) gj.away(140) gj.home(144) | 1974-2026 | 3 | CHI |
| `CLE` | 73901 | pl.latest(824) pl.draft(376) ro.team(1005) ro.draft(567) sc.team(9870) sc.opp(9842) ps.team(8819) ps.opp(8735) dc.club(15688) dc.team(17894) gj.away(142) gj.home(139) | 1974-1995, 1999-2026 | 5 (both eras) | CLE |
| `JAX` | 73768 | pl.latest(607) pl.draft(243) ro.team(1419) ro.draft(768) sc.team(9990) sc.opp(10011) ps.team(8747) ps.opp(8811) dc.club(16536) dc.team(16352) gj.away(142) gj.home(142) | 1995-2026 | 30 | JAX |
| `LA` | 62721 | pl.latest(954) pl.draft(571) ro.team(902) ro.draft(340) sc.team(8265) sc.opp(8301) ps.team(8933) ps.opp(9042) dc.club(9941) dc.team(15291) gj.away(93) gj.home(88) | 1974-2026 | 14 | LAR |
| `LAC` | 61370 | pl.latest(828) pl.draft(396) ro.team(875) ro.draft(289) sc.team(7087) sc.opp(7062) ps.team(8768) ps.opp(8777) dc.club(9344) dc.team(17773) gj.away(88) gj.home(83) | 1974-2026 | 24 | LAC |
| `LV` | 50477 | pl.latest(806) pl.draft(383) ro.team(580) ro.draft(139) sc.team(4758) sc.opp(4753) ps.team(8746) ps.opp(8685) dc.club(5414) dc.team(16094) gj.away(60) gj.home(59) | 1974-2026 | 13 | LV |
| `OAK` | 22392 | ro.team(763) ro.draft(654) sc.team(5064) sc.opp(5062) dc.club(10688) gj.away(81) gj.home(80) | 2010-2025 | 13 | LV |
| `SD` | 14372 | ro.team(531) ro.draft(443) sc.team(2929) sc.opp(2935) dc.club(7420) gj.away(58) gj.home(56) | 2010-2025 | 24 | LAC |
| `STL` | 11087 | ro.draft(194) sc.team(2153) sc.opp(2145) dc.club(6499) gj.away(48) gj.home(48) | 2010-2025 | **22 ≤1987 / 14 ≥1995** (all rows here 14) | LAR (14) |
| `BLT` | 712 | ro.team(399) ro.draft(313) | 2010-2015 | 33 | BAL |
| `HST` | 699 | ro.team(406) ro.draft(293) | 2010-2015 | 34 | HOU |
| `CLV` | 687 | ro.team(411) ro.draft(276) | 2010-2015 | 5 | CLE |
| `SL` | 658 | ro.team(393) ro.draft(265) | 2010-2015 | 14 | LAR |
| `ARZ` | 649 | ro.team(382) ro.draft(267) | 2010-2015 | 22 | ARI |
| `AZ` | 92 | pl.latest(92) | 2026 | 22 | ARI |
| `LAR` | 78 | ro.draft(61) gj.away(8) gj.home(9) | 2025-2026 | 14 | LAR |
| `WSH` | 17 | gj.away(8) gj.home(9) | 2026 | 28 | WSH |
| `JAC` | 3 | ro.draft(3) | 2016 | 30 | JAX |

### ESPN's own abbreviation per franchise, by season

Fetched, not remembered. The relocation-sensitive franchises:

| Franchise | ESPN abbreviation by season |
|---|---|
| 13 Raiders | `OAK` 2010, 2013, 2015, 2016, 2017, 2019 → `LV` 2020, 2024, 2025, 2026 |
| 14 Rams | `LOS` 1994 → `STL` 1995, 2010, 2013, 2015 → `LAR` 2016, 2017, 2019, 2020, 2024, 2025, 2026 |
| 22 Cardinals | `STL` 1987 → `PHO` 1988 → `ARI` 2010, 2013, 2015, 2016, 2017, 2019, 2020, 2024, 2025, 2026 |
| 24 Chargers | `SD` 2010, 2013, 2015, 2016 → `LAC` 2017, 2019, 2020, 2024, 2025, 2026 |
| 28 Washington | `WSH` in every season sampled (1 name change in 2020 and 2022, abbreviation unchanged) |
| 10 Titans | `HOU` 1995, 1996 → `TEN` 1997, 1999, 2026 |
| 11 Colts | `IND` 1983 (displayName "Baltimore Colts"), 1984, 2026 |
| 34 Texans | `HOU` 2002, 2026 |
| 33 Ravens | `BAL` 1996, 2026 |
| 5 Browns | `CLE` 1995, 1999, 2026 |

**ESPN never emits `LA`, `WAS`, `AZ`, `ARZ`, `BLT`, `CLV`, `HST`, `SL` or `JAC` in any season
sampled.** All nine are nflverse/PFR spellings.

### Blank and structurally-absent values

1,137,405 blanks, every one a documented category — **none is a gap**:

| Site | Blanks | Cause |
|---|---:|---|
| `depth_charts.csv::club_code` | 554,215 | schema-B snapshot rows — they carry `team` + `dt` instead |
| `depth_charts.csv::team` | 552,514 | schema-A rows — they carry `club_code` + `season` instead |
| `rosters.csv::draft_club` | 17,841 | player went undrafted |
| `players.csv::draft_team` | 12,807 | player went undrafted |
| `games.json::awayAbbr` / `homeAbbr` | 13 + 13 | 2026 postseason bracket placeholders, matchup not yet determined |
| `player_stats.csv::opponent_team` | 2 | wholly blank rows |

Zero whitespace-only values and zero padded values exist in any of the twelve columns — verified
explicitly, `strip()` is a no-op on every non-blank value.

### Deliverable

`scripts/data/nfl-db/lib/team_aliases.py` — importable, no import-time side effects.

- `ALIASES: dict[str, int]` — 41 season-independent abbreviations, each with an inline comment
  naming the franchise and the sites/seasons where it was observed.
- `SEASON_DEPENDENT: dict[tuple[str, int], int]` — 245 `(abbr, season)` keys covering `HOU`, `BAL`,
  `STL`, plus the ESPN-attested `LOS` and `PHO` (marked as not observed in any source). Materialised
  from a commented `_ERA_SPANS` table so each span carries its evidence.
- `resolve(abbr, season=None) -> int` — raises `UnknownTeamAbbr` on `None`, blank, whitespace,
  unknown abbreviations, era-split abbreviations with no season, and era-split abbreviations in a
  season no span covers. **No default, no fallback.**
- `ESPN_ABBR: dict[int, str]` — ESPN's canonical abbreviation for all 32 franchises.
- `__main__` self-check — scans all six sources, cross-checks `games.json` aliases against the
  franchise ids the feed already carries, asserts the no-fallback guard, exits non-zero on any
  unmapped value.

Self-check output:

```
  resolved values per site:
    depth_charts.csv::club_code          552514
    depth_charts.csv::team               554215
    games.json::awayAbbr                   4635
    games.json::homeAbbr                   4635
    player_stats.csv::opponent_team      287182
    player_stats.csv::team               287184
    players.csv::draft_team               12228
    players.csv::latest_team              25035
    rosters.csv::draft_club               26015
    rosters.csv::team                     43856
    snap_counts.csv::opponent            324611
    snap_counts.csv::team                324611
    TOTAL RESOLVED                      2446721
  no-silent-fallback guard: PASS
  SELF-CHECK PASS: every team-like value in all six sources resolves.
```

The `games.json` cross-check is the strongest single assertion here: for all 9,270 non-null
abbreviation/franchise-id pairs the feed carries, the alias table's answer equals the feed's own
answer. Zero disagreements.

## Exceptions

Two items the coordinator must decide on. Neither is an unresolved value — the mapping is complete.

| # | Item | What is wrong | Why | Evidence |
|---|---|---|---|---|
| 1 | `build_db.py` `alias2fid` is missing `AZ`, `LAR`, `WSH` and maps `HOU`/`BAL` flat | 187 rows currently unmappable (92 `AZ` + 78 `LAR` + 17 `WSH`); 356 `players.csv` rows would be assigned the wrong franchise if `latest_team`/`draft_team` were ever resolved | The table was built reactively from load crashes. `alias2fid.get()` returns `None` silently, so `AZ` would have produced NULL teams for every 2026 active Cardinal rather than an error. | This report; `python3 scripts/data/nfl-db/lib/team_aliases.py` |
| 2 | `STL` ≤1987 and `LOS`/`PHO` are in `SEASON_DEPENDENT` but occur in **zero** source rows | Nothing is wrong; flagged so nobody "simplifies" them away | ESPN's `seasons/1987/teams/22` returns `STL`/St. Louis Cardinals and `seasons/1994/teams/14` returns `LOS`/Los Angeles Rams. The ambiguity is real in the authority the schema is keyed on, even though this corpus starts at 1974 with sparse pre-2010 coverage. | `scripts/data/nfl-db/cache/b2/hist/1987-22.json`, `1994-14.json` |

I did **not** modify `build_db.py`, `schema.sql` or `nfl.db`. Integrating `team_aliases.resolve()`
into the loader — and deciding whether `players.csv`'s `latest_team`/`draft_team` should become
resolved franchise columns rather than raw TEXT — is the coordinator's call.

## Reproduce

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai

# 1. The deliverable's own self-check over all six sources (~8s).
python3 scripts/data/nfl-db/lib/team_aliases.py; echo "EXIT=$?"

# 2. Spot-check the resolver, including every case that must raise.
python3 - <<'PY'
import sys; sys.path.insert(0, "scripts/data/nfl-db/lib")
import team_aliases as T
for a, s in [("LA",2016),("LA",1980),("SL",2013),("STL",2020),("HOU",2015),
             ("HOU",1995),("BAL",2015),("BAL",1980),("AZ",2026),("LAR",2026),("WSH",2026)]:
    print(f"resolve({a!r},{s}) = {T.resolve(a,s)}")
for a, s in [("HOU",None),("BAL",None),("STL",None),("STL",1990),("BAL",1990),
             ("HOU",1999),("XXX",2020),("",2020),(None,2020)]:
    try: print(f"resolve({a!r},{s}) = {T.resolve(a,s)}  <-- MUST RAISE")
    except T.UnknownTeamAbbr: print(f"resolve({a!r},{s}) raised OK")
PY

# 3. The era-gap proof for HOU / BAL / CLE (the whole finding in one command).
python3 - <<'PY'
import csv; csv.field_size_limit(10**9)
rows = list(csv.DictReader(open("scripts/data/nfl-db/raw/players.csv",
                                newline="", encoding="utf-8", errors="replace")))
def spans(label, col, scol):
    ys = sorted({int(r[scol]) for r in rows if r[col] == label and r[scol]})
    out, st, prev = [], None, None
    for y in ys:
        if st is None: st = prev = y
        elif y == prev + 1: prev = y
        else: out.append((st, prev)); st = prev = y
    if st is not None: out.append((st, prev))
    return out
for lbl in ("HOU","TEN","BAL","IND","CLE","ARI","AZ","LA","LAC","LV","WAS"):
    print(f"  {lbl:<4} latest_team {spans(lbl,'latest_team','last_season')}")
    print(f"  {lbl:<4} draft_team  {spans(lbl,'draft_team','draft_year')}")
PY

# 4. ESPN's own per-season abbreviations (cached; delete the cache to re-fetch).
python3 - <<'PY'
import glob, json, os
for f in sorted(glob.glob("scripts/data/nfl-db/cache/b2/hist/*.json")) + \
         sorted(glob.glob("scripts/data/nfl-db/cache/b2/teams/*.json")):
    y, t = os.path.basename(f)[:-5].split("-")
    d = json.load(open(f))
    print(f"  season {y} franchise {t:>3} -> {d.get('abbreviation'):<5} {d.get('displayName')}")
PY

# 5. Cross-feed draft-label identity (proves ARZ/BLT/CLV/HST/JAC/SL/STL/OAK/SD).
python3 - <<'PY'
import csv; from collections import defaultdict, Counter
csv.field_size_limit(10**9)
R = "scripts/data/nfl-db/raw"
pd = {r["gsis_id"]: r["draft_team"]
      for r in csv.DictReader(open(f"{R}/players.csv", newline="", encoding="utf-8",
                                   errors="replace")) if r["draft_team"]}
pair = defaultdict(Counter)
for r in csv.DictReader(open(f"{R}/rosters.csv", newline="", encoding="utf-8", errors="replace")):
    if r["draft_club"] and r["gsis_id"] in pd:
        pair[r["draft_club"]][pd[r["gsis_id"]]] += 1
for k in sorted(pair):
    print(f"  rosters.draft_club {k:<4} -> players.draft_team {dict(pair[k])}")
PY
```

Cached ESPN evidence (101 responses, 1.1 MB, kept as proof): `scripts/data/nfl-db/cache/b2/` —
`espn-teams-{year}.json` (season team indexes), `teams/{year}-{id}.json` (32 franchises for 2026 plus
13/14/22/24/28 across 2010–2025), `hist/{year}-{id}.json` (the historic era probes).
