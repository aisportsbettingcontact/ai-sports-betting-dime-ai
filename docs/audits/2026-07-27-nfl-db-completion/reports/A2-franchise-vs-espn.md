# A2 — Franchise dimension verified against ESPN and NFL.com

## Verdict

**PASS WITH EXCEPTIONS** — the franchise dimension is correct: all 32 rows of `team` match ESPN and
NFL.com on id, name, abbreviation, conference and division; all 5 identity changes across the 4
franchises that moved or rebranded keep a stable ESPN franchise id *and* a stable ESPN `guid`; all 37
`team_alias` rows map to the right franchise; and 1,311/1,311 sampled games carry franchise ids
identical to ESPN's own home/away assignment. Two exceptions, neither a franchise error: one wrong
`espn_event_id` on `2010_10_HOU_JAX`, and one NFL.com club code (`AZ`) that `team_alias` cannot
resolve.

## What I checked

Full population, not a sample.

| Scope | Population | Source of truth |
|---|---|---|
| `team` rows | 32 × 17 seasons = 544 franchise-seasons | ESPN core API, per season |
| Conference / division | 544 franchise-seasons | ESPN season group refs + NFL.com team pages |
| Names / abbreviations | 32 current + 544 historical | ESPN core API, ESPN site API, NFL.com |
| Relocations & rebrands | all 4 in-window moves | ESPN, at the boundary season on both sides |
| `team_alias` | all 37 rows | ESPN (17 seasons, both APIs) + NFL.com |
| `game` abbr ↔ franchise | all 4,648 rows | `team_alias` join |
| `game` franchise ↔ ESPN | 1,311 games across 2015/2017/2020/2022/2026 | ESPN per-team schedules |
| Legacy ESPN id encoding | 1,068 games (2010–2013) | ESPN's own id scheme |
| Games per franchise/season | 544 franchise-seasons | `game` + ESPN per-team schedules |

**Method.** `scripts/data/nfl-db/verify/a2_franchise.py` — read-only on `nfl.db`, every HTTP response
cached under `scripts/data/nfl-db/cache/a2/` (949 files) and re-read from cache on rerun, so the
evidence is retained and a rerun costs zero network. Requests were sequential with a 300 ms floor,
one in flight. Exits non-zero on any mismatch.

Checks are labelled C1–C11 in the script and referenced by label below.

## Results

### 1. The 32-row franchise table (C1, C2, C4, C5b)

ESPN returned exactly 32 teams for every one of the 17 seasons 2010–2026, and the id set is
identical to `team` in all 17 — no missing id, no extra id, in any season.

`ESPN abbr` and `ESPN name` are ESPN's values for the latest season (2026). `NFL.com code` is NFL's
own club code, taken from the ad-targeting call and logo path on each team page.

| fid | DB name | DB abbr | ESPN name (2026) | ESPN abbr | NFL.com page | NFL.com code | Conf | Division | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Atlanta Falcons | ATL | Atlanta Falcons | ATL | atlanta-falcons | ATL | NFC | NFC South | AGREE |
| 2 | Buffalo Bills | BUF | Buffalo Bills | BUF | buffalo-bills | BUF | AFC | AFC East | AGREE |
| 3 | Chicago Bears | CHI | Chicago Bears | CHI | chicago-bears | CHI | NFC | NFC North | AGREE |
| 4 | Cincinnati Bengals | CIN | Cincinnati Bengals | CIN | cincinnati-bengals | CIN | AFC | AFC North | AGREE |
| 5 | Cleveland Browns | CLE | Cleveland Browns | CLE | cleveland-browns | CLE | AFC | AFC North | AGREE |
| 6 | Dallas Cowboys | DAL | Dallas Cowboys | DAL | dallas-cowboys | DAL | NFC | NFC East | AGREE |
| 7 | Denver Broncos | DEN | Denver Broncos | DEN | denver-broncos | DEN | AFC | AFC West | AGREE |
| 8 | Detroit Lions | DET | Detroit Lions | DET | detroit-lions | DET | NFC | NFC North | AGREE |
| 9 | Green Bay Packers | GB | Green Bay Packers | GB | green-bay-packers | GB | NFC | NFC North | AGREE |
| 10 | Tennessee Titans | TEN | Tennessee Titans | TEN | tennessee-titans | TEN | AFC | AFC South | AGREE |
| 11 | Indianapolis Colts | IND | Indianapolis Colts | IND | indianapolis-colts | IND | AFC | AFC South | AGREE |
| 12 | Kansas City Chiefs | KC | Kansas City Chiefs | KC | kansas-city-chiefs | KC | AFC | AFC West | AGREE |
| 13 | Las Vegas Raiders | LV | Las Vegas Raiders | LV | las-vegas-raiders | LV | AFC | AFC West | AGREE |
| 14 | Los Angeles Rams | LAR | Los Angeles Rams | LAR | los-angeles-rams | LA *and* LAR | NFC | NFC West | AGREE (note 3) |
| 15 | Miami Dolphins | MIA | Miami Dolphins | MIA | miami-dolphins | MIA | AFC | AFC East | AGREE |
| 16 | Minnesota Vikings | MIN | Minnesota Vikings | MIN | minnesota-vikings | MIN | NFC | NFC North | AGREE |
| 17 | New England Patriots | NE | New England Patriots | NE | new-england-patriots | NE | AFC | AFC East | AGREE |
| 18 | New Orleans Saints | NO | New Orleans Saints | NO | new-orleans-saints | NO | NFC | NFC South | AGREE |
| 19 | New York Giants | NYG | New York Giants | NYG | new-york-giants | NYG | NFC | NFC East | AGREE |
| 20 | New York Jets | NYJ | New York Jets | NYJ | new-york-jets | NYJ | AFC | AFC East | AGREE |
| 21 | Philadelphia Eagles | PHI | Philadelphia Eagles | PHI | philadelphia-eagles | PHI | NFC | NFC East | AGREE |
| 22 | Arizona Cardinals | ARI | Arizona Cardinals | ARI | arizona-cardinals | **AZ** | NFC | NFC West | AGREE (exception 2) |
| 23 | Pittsburgh Steelers | PIT | Pittsburgh Steelers | PIT | pittsburgh-steelers | PIT | AFC | AFC North | AGREE |
| 24 | Los Angeles Chargers | LAC | Los Angeles Chargers | LAC | los-angeles-chargers | LAC | AFC | AFC West | AGREE |
| 25 | San Francisco 49ers | SF | San Francisco 49ers | SF | san-francisco-49ers | SF | NFC | NFC West | AGREE |
| 26 | Seattle Seahawks | SEA | Seattle Seahawks | SEA | seattle-seahawks | SEA | NFC | NFC West | AGREE |
| 27 | Tampa Bay Buccaneers | TB | Tampa Bay Buccaneers | TB | tampa-bay-buccaneers | TB | NFC | NFC South | AGREE |
| 28 | Washington Commanders | WSH | Washington Commanders | WSH | washington-commanders | **WAS** | NFC | NFC East | AGREE (note 2) |
| 29 | Carolina Panthers | CAR | Carolina Panthers | CAR | carolina-panthers | CAR | NFC | NFC South | AGREE |
| 30 | Jacksonville Jaguars | JAX | Jacksonville Jaguars | JAX | jacksonville-jaguars | JAX | AFC | AFC South | AGREE |
| 33 | Baltimore Ravens | BAL | Baltimore Ravens | BAL | baltimore-ravens | BAL | AFC | AFC North | AGREE |
| 34 | Houston Texans | HOU | Houston Texans | HOU | houston-texans | HOU | AFC | AFC South | AGREE |

**32/32 agree on name, conference and division across all three publishers.** ESPN and the DB agree
on the abbreviation for 32/32. NFL.com uses a different club code for 3 franchises — recorded below
as contradictions, not resolved.

### 2. Relocation and rebrand timeline — the id is stable across every move (C3, C6)

ESPN's seasonal team resource is **era-correct for relocations**: it reports the identity the team
actually played under in that season, not the current one. That was verified rather than assumed —
if ESPN had backfilled current branding onto a pre-move season, C6 would have failed hard.

Full ESPN identity history for the four franchises whose label changed in-window:

| fid | ESPN identity by season | ESPN abbr |
|---|---|---|
| 13 | 2010–2019 Oakland Raiders → 2020–2026 Las Vegas Raiders | OAK → LV |
| 14 | 2010–2015 St. Louis Rams → 2016–2026 Los Angeles Rams | STL → LAR |
| 24 | 2010–2016 San Diego Chargers → 2017–2026 Los Angeles Chargers | SD → LAC |
| 28 | 2010–2018 Washington Redskins → 2019–2021 Washington → 2022–2026 Washington Commanders | WSH throughout |

Id stability at each boundary, checked on both sides of the move:

| Move | Effective | id before | id after | ESPN name before → after | ESPN guid before → after | Stable? |
|---|---|---|---|---|---|---|
| Rams St. Louis → Los Angeles | 2016 | **14** (2015) | **14** (2016) | St. Louis Rams → Los Angeles Rams | `2e1473b2-…5986` → `2e1473b2-…5986` | **YES** |
| Chargers San Diego → Los Angeles | 2017 | **24** (2016) | **24** (2017) | San Diego Chargers → Los Angeles Chargers | `84caf62b-…4294` → `84caf62b-…4294` | **YES** |
| Raiders Oakland → Las Vegas | 2020 | **13** (2019) | **13** (2020) | Oakland Raiders → Las Vegas Raiders | `b18540eb-…8da9` → `b18540eb-…8da9` | **YES** |
| Washington Redskins → Football Team | 2020 | **28** (2019) | **28** (2020) | Washington → Washington | `fbeaf73e-…1f90` → `fbeaf73e-…1f90` | **YES** |
| Washington Football Team → Commanders | 2022 | **28** (2021) | **28** (2022) | Washington → Washington Commanders | `fbeaf73e-…1f90` → `fbeaf73e-…1f90` | **YES** |

**ESPN has never changed a franchise id across any of these moves.** The property the schema depends
on holds.

A second, independent confirmation: across all 17 seasons, **all 32 franchises have exactly one ESPN
`guid`** (0 franchises with more than one guid, 0 guids served under more than one id). An id that
had been re-pointed at a different franchise would show up here even if the id itself never moved.

Era windows in `game` are consistent with those effective dates (C6), with zero violations:

| Label | fid | First season in `game` | Last season in `game` | Expected window |
|---|---|---|---|---|
| STL | 14 | 2010 | 2015 | ≤ 2015 ✓ |
| LA | 14 | 2016 | 2025 | ≥ 2016 ✓ |
| LAR | 14 | 2026 | 2026 | ≥ 2016 ✓ |
| SD | 24 | 2010 | 2016 | ≤ 2016 ✓ |
| LAC | 24 | 2017 | 2026 | ≥ 2017 ✓ |
| OAK | 13 | 2010 | 2019 | ≤ 2019 ✓ |
| LV | 13 | 2020 | 2026 | ≥ 2020 ✓ |

### 3. Conference and division alignment per season (C4, C11)

Divisions are stable across this window — verified, not assumed, three independent ways:

1. **ESPN season groups.** For all 544 franchise-seasons, the conference and division resolved from
   ESPN's per-season group refs match `team`. No franchise is reported by ESPN under more than one
   division at any point in 2010–2026, so `team`'s single-division-per-franchise design cannot be
   encoding a current division over a different historical one. There was no realignment to miss.
2. **NFL.com team pages.** All 32 divisions and conferences match.
3. **The 6-divisional-games rule.** Since the 2002 realignment every team plays its three division
   rivals home and away. Deriving divisional games from `team.division` gives **exactly 6 for all 544
   (season, franchise) cells — 0 deviations**. If any franchise sat in the wrong division for any
   season, its count could not be 6.

Additionally, nflverse ships its own `div_game` flag: it agrees with `team.division` on
**4,363 of 4,363** rows that carry it (the 285 NULLs are the ESPN-sourced 2026 rows, which have no
such flag by construction — structurally not applicable, not a gap). Division shape is 8 divisions
of exactly 4.

### 4. `team_alias` — all 37 rows map to the correct franchise (C5, C5b, C5c)

- **37/37 alias rows point at a franchise that exists and is the right one.** No alias resolves to a
  franchise ESPN attributes elsewhere.
- **Every one of the 32 franchises has exactly one `is_current` alias, equal to `team.abbreviation`.**
- **Every abbreviation ESPN has published in 2010–2026 has an alias row** (0 uncovered).
- **Every alias row is actually used by `game`** (0 dead aliases).
- **ESPN's core API and site API agree on every label**, across 160 (season, franchise) cells in the
  five probe seasons — including the historically interesting ones (2015 Rams = `STL` in both).

The two labels called out as high-risk:

| Label | DB → franchise | ESPN uses it for | Used in `game`? | Verdict |
|---|---|---|---|---|
| `LA` | 14 — Los Angeles Rams | **never** (ESPN uses `LAR`) | yes, 2016–2025 (nflverse label) | **CORRECT** |
| `SL` | *not present* | **never** (ESPN uses `STL`) | no | **CORRECTLY ABSENT** |

`LA` is unambiguous in this database despite both LA teams existing since 2017: ESPN never uses `LA`
for either team, and the only feed that emits `LA` is nflverse, which uses it exclusively for the
Rams and `LAC` for the Chargers. Confirmed empirically — the abbreviation→franchise mapping over all
4,648 games is 1:1 for all 37 labels, with zero ambiguous labels. `SL` is not an ESPN, NFL.com, or
nflverse label anywhere in the window; the St. Louis Rams are `STL` in all three. Its absence is
correct, not a gap.

### 5. `game` franchise ids agree with ESPN (C7, C9, C10)

This is the check that would have caught "Buffalo written as 17".

- **C7 — abbreviation ↔ franchise id inside `game`: 0 mismatches on all 4,648 rows.** Every
  `away_abbr`/`home_abbr` resolves through `team_alias` to exactly the `away_franchise_id`/
  `home_franchise_id` stored on the row.
- **C9 — franchise ids vs ESPN's own home/away assignment: 1,311 of 1,311 matched, 0 mismatched.**
  Probe seasons 2015, 2017, 2020, 2022 and 2026 were chosen so that every era label is exercised
  (2015 STL/SD/OAK, 2017 LA+LAC, 2020 LV+WAS, 2026 LAR/WSH). For each of the 32 franchises in each
  probe season, ESPN's per-team schedule was pulled and its `homeAway` + `team.id` compared against
  the `game` row with the same `espn_event_id`. Every single one agrees.
- **C10 — legacy id encoding: 1,067 of 1,068 agree.** ESPN's pre-2014 event ids have the shape
  `3` + `YYMMDD` + zero-padded home franchise id (`301114022` = 2010-11-14, home franchise 22 =
  Arizona). That makes every 2010–2013 row a free, ESPN-authored cross-check on `home_franchise_id`.
  1,067 of 1,068 agree. The single disagreement is exception 1 below, and it is a wrong event id,
  not a wrong franchise.

Supporting structural check: `team_game` (9,270 rows) agrees with `game` on franchise attribution on
**0 disagreements**, and its row count is exactly `4,648 × 2 − 13 tbd games × 2 = 9,270`.

### 6. Games per franchise per season (C8)

Expected: 16 regular-season games 2010–2020, 17 from 2021. Cell format is `REG` or `REG+POST`;
**bold** marks a deviation from the expected regular-season count.

| fid | Team | 2010 | 2011 | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ATL | 16+1 | 16+1 | 16+2 | 16 | 16 | 16 | 16+3 | 16+2 | 16 | 16 | 16 | 17 | 17 | 17 | 17 | 17 | 17 |
| 2 | BUF | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16+1 | 16 | 16+1 | 16+3 | 17+2 | **16**+2 | 17+2 | 17+3 | 17+2 | 17 |
| 3 | CHI | 16+2 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16+1 | 16 | 16+1 | 17 | 17 | 17 | 17 | 17+2 | 17 |
| 4 | CIN | 16 | 16+1 | 16+1 | 16+1 | 16+1 | 16+1 | 16 | 16 | 16 | 16 | 16 | 17+4 | **16**+3 | 17 | 17 | 17 | 17 |
| 5 | CLE | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16+2 | 17 | 17 | 17+1 | 17 | 17 | 17 |
| 6 | DAL | 16 | 16 | 16 | 16 | 16+2 | 16 | 16+1 | 16 | 16+2 | 16 | 16 | 17+1 | 17+2 | 17+1 | 17 | 17 | 17 |
| 7 | DEN | 16 | 16+2 | 16+1 | 16+3 | 16+1 | 16+3 | 16 | 16 | 16 | 16 | 16 | 17 | 17 | 17 | 17+1 | 17+2 | 17 |
| 8 | DET | 16 | 16+1 | 16 | 16 | 16+1 | 16 | 16+1 | 16 | 16 | 16 | 16 | 17 | 17 | 17+3 | 17+1 | 17 | 17 |
| 9 | GB | 16+4 | 16+1 | 16+2 | 16+1 | 16+2 | 16+2 | 16+3 | 16 | 16 | 16+2 | 16+2 | 17+1 | 17 | 17+2 | 17+1 | 17+1 | 17 |
| 10 | TEN | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16+2 | 16 | 16+3 | 16+1 | 17+1 | 17 | 17 | 17 | 17 | 17 |
| 11 | IND | 16+1 | 16 | 16+1 | 16+2 | 16+3 | 16 | 16 | 16 | 16+2 | 16 | 16+1 | 17 | 17 | 17 | 17 | 17 | 17 |
| 12 | KC | 16+1 | 16 | 16 | 16+1 | 16 | 16+2 | 16+1 | 16+1 | 16+2 | 16+3 | 16+3 | 17+3 | 17+3 | 17+4 | 17+3 | 17 | 17 |
| 13 | LV | 16 | 16 | 16 | 16 | 16 | 16 | 16+1 | 16 | 16 | 16 | 16 | 17+1 | 17 | 17 | 17 | 17 | 17 |
| 14 | LAR | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16+1 | 16+3 | 16 | 16+2 | 17+4 | 17 | 17+1 | 17+2 | 17+3 | 17 |
| 15 | MIA | 16 | 16 | 16 | 16 | 16 | 16 | 16+1 | 16 | 16 | 16 | 16 | 17 | 17+1 | 17+1 | 17 | 17 | 17 |
| 16 | MIN | 16 | 16 | 16+1 | 16 | 16 | 16+1 | 16 | 16+2 | 16 | 16+2 | 16 | 17 | 17+1 | 17 | 17+1 | 17 | 17 |
| 17 | NE | 16+1 | 16+3 | 16+2 | 16+2 | 16+3 | 16+2 | 16+3 | 16+3 | 16+3 | 16+1 | 16 | 17+1 | 17 | 17 | 17 | 17+4 | 17 |
| 18 | NO | 16+1 | 16+2 | 16 | 16+2 | 16 | 16 | 16 | 16+2 | 16+2 | 16+1 | 16+2 | 17 | 17 | 17 | 17 | 17 | 17 |
| 19 | NYG | 16 | 16+4 | 16 | 16 | 16 | 16 | 16+1 | 16 | 16 | 16 | 16 | 17 | 17+2 | 17 | 17 | 17 | 17 |
| 20 | NYJ | 16+3 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 17 | 17 | 17 | 17 | 17 | 17 |
| 21 | PHI | 16+1 | 16 | 16 | 16+1 | 16 | 16 | 16 | 16+3 | 16+2 | 16+1 | 16 | 17+1 | 17+3 | 17+1 | 17+4 | 17+1 | 17 |
| 22 | ARI | 16 | 16 | 16 | 16 | 16+1 | 16+2 | 16 | 16 | 16 | 16 | 16 | 17+1 | 17 | 17 | 17 | 17 | 17 |
| 23 | PIT | 16+3 | 16+1 | 16 | 16 | 16+1 | 16+2 | 16+3 | 16+1 | 16 | 16 | 16+1 | 17+1 | 17 | 17+1 | 17+1 | 17+1 | 17 |
| 24 | LAC | 16 | 16 | 16 | 16+2 | 16 | 16 | 16 | 16 | 16+2 | 16 | 16 | 17 | 17+1 | 17 | 17+1 | 17+1 | 17 |
| 25 | SF | 16 | 16+2 | 16+3 | 16+3 | 16 | 16 | 16 | 16 | 16 | 16+3 | 16 | 17+3 | 17+3 | 17+3 | 17 | 17+2 | 17 |
| 26 | SEA | 16+2 | 16 | 16+2 | 16+3 | 16+3 | 16+2 | 16+2 | 16 | 16+1 | 16+2 | 16+1 | 17 | 17+1 | 17 | 17 | 17+3 | 17 |
| 27 | TB | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16+4 | 17+2 | 17+1 | 17+2 | 17+1 | 17 | 17 |
| 28 | WSH | 16 | 16 | 16+1 | 16 | 16 | 16+1 | 16 | 16 | 16 | 16 | 16+1 | 17 | 17 | 17 | 17+3 | 17 | 17 |
| 29 | CAR | 16 | 16 | 16 | 16+1 | 16+2 | 16+3 | 16 | 16+1 | 16 | 16 | 16 | 17 | 17 | 17 | 17 | 17+1 | 17 |
| 30 | JAX | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16+3 | 16 | 16 | 16 | 17 | 17+2 | 17 | 17 | 17+1 | 17 |
| 33 | BAL | 16+2 | 16+2 | 16+4 | 16 | 16+2 | 16 | 16 | 16 | 16+1 | 16+1 | 16+2 | 17 | 17+1 | 17+2 | 17+2 | 17 | 17 |
| 34 | HOU | 16 | 16+2 | 16+2 | 16 | 16 | 16+1 | 16+2 | 16 | 16+1 | 16+2 | 16 | 17 | 17 | 17+2 | 17+2 | 17+2 | 17 |

**Exactly 2 deviations in 544 franchise-seasons, both in 2022, both genuine.**

Postseason counts are also sane: 12 playoff teams per season 2010–2019 and 14 from 2020 (matching
the field expansion), a maximum of 4 postseason games for any team, and every one of the 9 teams
with 4 is a real no-bye Super Bowl participant (2010 GB, 2011 NYG, 2012 BAL, 2020 TB, 2021 CIN and
LAR, 2023 KC, 2024 PHI, 2025 NE).

#### The 2022 Buffalo / Cincinnati exception is genuine — verified, not taken on faith

| Evidence | Result |
|---|---|
| DB regular-season games, BUF (fid 2) and CIN (fid 4), 2022 | 16 each |
| DB regular-season rows, 2022, all franchises | 271 (not 272) |
| DB has no week-17 row for either team | confirmed — BUF goes wk 16 → wk 18, CIN goes wk 16 → wk 18 |
| ESPN per-team schedule, BUF 2022 | 17 events **listed**, 16 **played** |
| ESPN per-team schedule, CIN 2022 | 17 events **listed**, 16 **played** |
| The 17th event | id `401437947`, 2023-01-03, CIN vs BUF, **`STATUS_CANCELED`**, `completed: false` |
| Is `401437947` present in `game`? | **No** — 0 rows. Correctly absent, not stored as a phantom 0-0 |
| ESPN games played, all 32 franchises, 2022 | **only** fid 2 and fid 4 are below 17 — matches the DB deviation set exactly |

This is the game abandoned after Damar Hamlin's cardiac arrest (BUF @ CIN, 2 January 2023), never
resumed and never replayed. ESPN retains the fixture on both teams' schedules with `STATUS_CANCELED`;
the DB stores games played, so it correctly has no row. **There are no other deviations** — ESPN
independently confirms that every other franchise played a full 17 in 2022, and every other
franchise-season in the matrix hits the expected 16 or 17.

## Exceptions

Two. Neither is a franchise-dimension error; both are itemised with evidence and a named cause.

### Exception 1 — `2010_10_HOU_JAX` carries the wrong `espn_event_id` (C10)

| Field | Value |
|---|---|
| Identifier | `game.game_id = '2010_10_HOU_JAX'` |
| What is wrong | `espn_event_id` is `301114022`. That id belongs to a different game. |
| Cause | Collision inherited from `scripts/data/nfl-unified-2010-2026/games.json`. `301114022` is also stored on `2010_10_SEA_ARI`, making it the only duplicated `espn_event_id` in the table. |
| Evidence | ESPN `summary?event=301114022` → home id 22 ARI 18, away id 26 SEA 36. ESPN `summary?event=301114030` → home id 30 JAX 31, away id 34 HOU 24. |
| Correct value | `301114030`. Both DB rows' scores and franchise ids match ESPN exactly for the *other* id, so `2010_10_SEA_ARI` legitimately owns `301114022`. |
| Franchise impact | **None.** `2010_10_HOU_JAX` stores `away_franchise_id = 34` (HOU) and `home_franchise_id = 30` (JAX), which is what ESPN says. Only the join key is wrong. |
| Detected by | ESPN's pre-2014 id scheme encodes the home franchise id; 1,067 of 1,068 legacy rows agree, this one does not. |

Owner decision: this belongs to whoever owns `game`/`espn_event_id` — I am read-only on `nfl.db` and
have not changed it. It matters because `espn_event_id` is indexed and used as a cross-source join
key, and today it is non-unique and points at the wrong game for this row.

### Exception 2 — NFL.com's club code `AZ` has no `team_alias` row (C5b)

| Field | Value |
|---|---|
| Identifier | label `AZ`, franchise 22 (Arizona Cardinals) |
| What is wrong | NFL.com's own club code for Arizona is `AZ`. `team_alias` has `ARI` but not `AZ`. |
| Cause | Coverage gap against a publisher the build does not currently ingest. ESPN and nflverse both use `ARI`, which *is* present and correct. |
| Evidence | `https://www.nfl.com/teams/arizona-cardinals/` — `setTargeting('team','AZ')` and `league/api/clubs/logos/AZ`. |
| Impact today | **None.** No source feeding `nfl.db` emits `AZ`; all 4,648 game rows resolve. |
| Impact if NFL.com is ever ingested | `AZ` would fail to resolve to a franchise. |

Classified as a gap rather than a mismatch — nothing in the DB is *wrong* about Arizona. The script
records it as a note by default and fails on it under `--strict`, so it can be gated once an
NFL.com-derived feed exists.

## Contradictions recorded, not resolved

Per standing rule 4 — both values recorded, no winner picked on vibes.

1. **ESPN does not preserve Washington's 2019–2021 names.** ESPN's seasonal team resource reports
   franchise 28 as plain `Washington` for 2019, 2020 and 2021. In reality the team played 2019 as the
   Washington Redskins (the name was retired in July 2020) and 2020–2021 as the Washington Football
   Team. ESPN's abbreviation stayed `WSH` throughout.
   *Consequence:* ESPN's seasonal team endpoint is era-correct for the three **relocations** but must
   **not** be used to derive an era-correct display name for Washington 2019–2021. This does not make
   the DB wrong — `team` stores only the current name (`Washington Commanders`, matching ESPN 2026)
   and has no historical-name column.

2. **NFL.com and ESPN disagree on three club codes.** NFL.com: `WAS`, `AZ`, and `LA`/`LAR` for the
   Rams. ESPN: `WSH`, `ARI`, `LAR`. The DB stores the ESPN form as canonical in `team.abbreviation`
   and carries `WAS` as an alias to franchise 28. Only `AZ` is unresolvable (exception 2).

3. **NFL.com is internally inconsistent for the Rams**, emitting both `LA` and `LAR` on the same
   page. Both map to franchise 14 in `team_alias`, so either resolves correctly.

4. **Two ESPN events are deliberately absent from `game`** — fixtures, not games, so this is
   "structurally not applicable", not a gap:
   - `400951581`, 2017-09-10, TB @ MIA, `STATUS_POSTPONED` — the Hurricane Irma postponement. The
     game was replayed in week 11 (2017-11-19) under a **different** event id, `400981391`, which is
     in the DB. TB and MIA each still played 16 in 2017, and TB's weeks run 2–17.
   - `401437947`, 2023-01-03, BUF @ CIN, `STATUS_CANCELED` — the abandoned game (exception detail
     above).

## Reproduce

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai

# Full verification. First run populates scripts/data/nfl-db/cache/a2/ (~950 files, 66 MB,
# ~6 min, sequential with a 300 ms floor); every later run reads the cache and is instant.
# Exits non-zero on any mismatch.
python3 scripts/data/nfl-db/verify/a2_franchise.py

# Replay from cache only, no network at all:
python3 scripts/data/nfl-db/verify/a2_franchise.py --offline

# Also fail on cross-publisher labels team_alias cannot resolve (i.e. AZ):
python3 scripts/data/nfl-db/verify/a2_franchise.py --offline --strict

# Machine-readable findings:
python3 scripts/data/nfl-db/verify/a2_franchise.py --offline --json-out /tmp/a2.json

# Narrow to specific seasons:
python3 scripts/data/nfl-db/verify/a2_franchise.py --seasons 2015,2016
```

Individual claims, each independently re-runnable:

```bash
cd scripts/data/nfl-db

# The 32 team rows
sqlite3 -header -column nfl.db \
  "SELECT franchise_id, abbreviation, display_name, conference, division FROM team ORDER BY franchise_id;"

# The 37 alias rows and what they resolve to
sqlite3 -header -column nfl.db \
  "SELECT a.abbreviation, a.franchise_id, t.display_name, a.is_current, a.note
     FROM team_alias a LEFT JOIN team t ON t.franchise_id = a.franchise_id
    ORDER BY a.franchise_id, a.abbreviation;"

# C7: abbreviation vs franchise id inside game -> expect 0
sqlite3 nfl.db \
  "SELECT COUNT(*) FROM game g
     LEFT JOIN team_alias aa ON aa.abbreviation = g.away_abbr
     LEFT JOIN team_alias ha ON ha.abbreviation = g.home_abbr
    WHERE (g.away_abbr IS NOT NULL AND aa.franchise_id IS NOT g.away_franchise_id)
       OR (g.home_abbr IS NOT NULL AND ha.franchise_id IS NOT g.home_franchise_id);"

# C8: regular-season games per franchise per season -> 16 x32 (2010-2020), 17 x32 (2021+),
#     except 2022 which is 17 x30 and 16 x2
sqlite3 -header -column nfl.db \
  "WITH pf AS (
     SELECT season, season_type, away_franchise_id AS fid FROM game WHERE away_franchise_id IS NOT NULL
     UNION ALL
     SELECT season, season_type, home_franchise_id FROM game WHERE home_franchise_id IS NOT NULL),
   c AS (SELECT season, fid, COUNT(*) n FROM pf WHERE season_type='REG' GROUP BY season, fid)
   SELECT season, n AS reg_games, COUNT(*) AS n_franchises FROM c GROUP BY season, n ORDER BY season, n;"

# C11: divisional games per franchise per season -> 6 in all 544 cells
sqlite3 -header -column nfl.db \
  "WITH pf AS (
     SELECT g.season, g.away_franchise_id fid FROM game g
       JOIN team ta ON ta.franchise_id=g.away_franchise_id
       JOIN team th ON th.franchise_id=g.home_franchise_id
      WHERE g.season_type='REG' AND ta.division=th.division
     UNION ALL
     SELECT g.season, g.home_franchise_id FROM game g
       JOIN team ta ON ta.franchise_id=g.away_franchise_id
       JOIN team th ON th.franchise_id=g.home_franchise_id
      WHERE g.season_type='REG' AND ta.division=th.division)
   SELECT n AS div_games, COUNT(*) occurrences FROM (SELECT season, fid, COUNT(*) n FROM pf GROUP BY season, fid) GROUP BY n;"

# C10: the one legacy-id disagreement
sqlite3 -header -column nfl.db \
  "SELECT game_id, espn_event_id, gameday, away_abbr, home_abbr, home_franchise_id,
          CAST(SUBSTR(espn_event_id,7,3) AS INTEGER) AS encoded_home
     FROM game
    WHERE season BETWEEN 2010 AND 2013
      AND CAST(SUBSTR(espn_event_id,7,3) AS INTEGER) <> home_franchise_id;"
```

Direct source calls behind the key claims (all cached under `scripts/data/nfl-db/cache/a2/`):

```bash
# Rams keep id 14 and guid across the 2016 move
curl -s "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2015/teams/14" | python3 -m json.tool | head -20
curl -s "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2016/teams/14" | python3 -m json.tool | head -20

# The abandoned 2022 fixture on Buffalo's schedule
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/2/schedule?season=2022&seasontype=2" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); [print(e['week']['number'], e['date'][:10], e['name'], e['competitions'][0]['status']['type']['name']) for e in d['events']]"

# Exception 1: what the two ids actually are
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=301114022" | python3 -c "import json,sys; c=json.load(sys.stdin)['header']['competitions'][0]; [print(x['homeAway'], x['team']['id'], x['team']['abbreviation'], x['score']) for x in c['competitors']]"
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=301114030" | python3 -c "import json,sys; c=json.load(sys.stdin)['header']['competitions'][0]; [print(x['homeAway'], x['team']['id'], x['team']['abbreviation'], x['score']) for x in c['competitors']]"
```

## Artefacts

| Path | What |
|---|---|
| `scripts/data/nfl-db/verify/a2_franchise.py` | The verifier. Read-only on `nfl.db`, cache-backed, exits non-zero on mismatch. |
| `scripts/data/nfl-db/cache/a2/` | 949 cached HTTP responses (66 MB) — the evidence for every claim above. |
| `docs/audits/2026-07-27-nfl-db-completion/reports/A2-franchise-vs-espn.md` | This report. |

`nfl.db`, `build_db.py` and `schema.sql` were not modified.
