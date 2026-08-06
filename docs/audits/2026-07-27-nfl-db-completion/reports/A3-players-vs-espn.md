# A3 — Player identity vs ESPN

*Task: verify player identity against ESPN, target zero misattributions. Five were found.*

## Verdict

**FAIL** — five separate misattributions of performance to the wrong human or the wrong team, each
individually proven: a full 13-game 2020 Buccaneers season including the Super Bowl LV run credited
to a player who was not in the NFL until 2024; 146 snap rows swapped between the two Jonah
Williamses; 358 Super Bowl snap rows carrying the opponent's team; six 2024 Detroit snap rows
credited to a player last seen in 2002; and three physically impossible player-weeks in which one
person is recorded playing two games at once. Separately, 46 `player.espn_id` values point
at a different, modern ESPN athlete than the historic player they sit on.

The prop-relevant core is clean: all 35 players with ≥ 200 `player_game_stats` rows and all
868 verifiable 2023–2025 QB/RB/WR/TE verify against ESPN with no identity mismatch;
867 of the 870 same-name collision sets are separable by a discriminator that is unique inside the
set, and the remaining 3 are individually adjudicated below (**E-3**, **E-5**, and one pair with no
fact rows).

## What I checked

`player` (25,035 rows) and the four fact tables that hang off it: `player_game_stats` (286,843),
`snap_count` (324,611), `roster_season` (43,856), `depth_chart` (552,514).

Five lines of evidence, four of which need no network and are therefore **exhaustive over the
whole database**, and one of which is a stratified ESPN fetch:

| # | Check | Coverage |
|---|---|---|
| 1 | Key uniqueness — `espn_id` / `pfr_id` / `esb_id` mapping to more than one `gsis_id`, and one human split across two `gsis_id`s | full population, 25,035 rows |
| 2 | Career-window violations — a fact row dated outside the player's own `[rookie_year, last_season]` | full population, 1.2 M fact rows |
| 3 | `gsis_id` sequence outliers — ids are issued chronologically, so an id far ahead of its debut cohort means the rows were hung on someone who did not exist yet | full population |
| 4 | Same-name gap-fill — player A missing an interior season of his own career that a same-named player B, not in the league that year, is carrying | full population, all 870 collision sets |
| 5 | `snap_count` crosswalk — the only fact table resolved through `pfr_id` instead of `gsis_id`, checked three ways: impossible player-weeks, team disagreement against the player's own stat rows, and position-group swaps | full population, 324,611 rows |
| 6 | ESPN athlete identity — `sports.core.api.espn.com/.../athletes/{espn_id}` compared on name, birthdate, draft year/round/pick, college, position, height, weight and debut year | stratified, see below |

A seventh check — ESPN's own season/team log (`/athletes/{id}/statisticslog`) versus the seasons in
`player_game_stats` — was run over the prop-relevant strata.

### Sampling frame — stated exactly

**No sampling was needed in the end. The ESPN check reached the full population.**

16,768 of the 25,035 `player` rows carry an `espn_id`; the other 8,267 have nothing to look up. Of
those 16,768, **16,765 were fetched and compared — 100.0%**. The three that were not are not a
sampling choice: ESPN returns HTTP 404 for those ids from every endpoint, and each is itemised as
**E-7**. The fetch ran at two requests in flight per CONTEXT.md, ~4.1 documents/second, took roughly
72 minutes, and every response is cached under `scripts/data/nfl-db/cache/a3/athletes/` (16,796
athlete documents, 902 season logs, 586 college records, 126 MB).

The queue was nevertheless sorted by risk tier before the first request, so that a partial run would
still have been a defensible stratified frame rather than an arbitrary first-N. That ordering is
reported below because it is what makes the *intermediate* states of this run interpretable, and
because it shows the strata the task mandates were finished first rather than by luck.

The fetch order **is** the stratification — the queue was sorted by risk tier before the first
request, so any prefix of it is a justified frame rather than an arbitrary first-N:

Tiers are **exclusive** — a player lands in the highest-risk tier he qualifies for, so a 2024 WR
with 250 stat rows who also shares a name with someone else counts once, in tier 0.

| tier | stratum | in frame | fetched |
|---|---|---|---|
| 0 | ≥ 200 rows in `player_game_stats` | 35 | 35 of 35 |
| 1 | 2023–2025 QB/RB/WR/TE (any volume) | 864 | 863 of 864 |
| 2 | member of a same-name collision set | 1207 | 1207 of 1207 |
| 3 | 100–199 `player_game_stats` rows | 505 | 505 of 505 |
| 4 | 25–99 `player_game_stats` rows | 2310 | 2310 of 2310 |
| 5 | 1–24 `player_game_stats` rows | 3533 | 3532 of 3533 |
| 6 | no stat rows, but present in `snap_count` / `roster_season` / `depth_chart` | 2213 | 2212 of 2213 |
| 7 | no fact rows at all | 6101 | 6101 of 6101 |

Within each tier the order is descending stat volume, then most-recent season. Every tier is
complete except for the three 404s:

```text
$ python3 verify/a3_players.py --markdown   # "stratum coverage"
| every player row            | 25035 | 16768 | 16765 |
| any player_game_stats row   |  7749 |  7742 | 7740 |
| >=200 player_game_stats rows|    35 |    35 | 35 |
| 2023-2025 QB/RB/WR/TE       |   870 |   869 | 868 |
```

Surname rarity and era therefore need no quota argument — every stratum is exhausted. For the
record, the population spans 6,867 players whose surname is unique in the table, 3,856 sharing a
surname with one or two others, 4,046 with 4–10, 5,246 with 11–50 and 5,020 with a surname shared by
50+ players; and by debut decade, 5,685 in the 2010s, 3,922 in the 2020s, 3,670 in the 2000s, 2,702
in the 1990s, 761 in the 1980s and 28 before 1980.

### Where the espn_id check is structurally blind

8,267 players have no `espn_id`. That is not a sampling gap; there is no key to check. It matters
only where such a player carries fact rows, and that is a small, fully-enumerated set:

| `espn_id` present? | players | with `player_game_stats` rows | with any fact row |
|---|---|---|---|
| yes | 16,768 | 7,742 | — |
| no | 8,267 | 7 | 21 |

All 21 were resolved individually through ESPN's search index; see *Exceptions*.

## Results

### 1. Key uniqueness (full population)

```text
$ sqlite3 nfl.db "select espn_id, count(*) n from player where espn_id<>'' group by espn_id having n>1;"   -> 0 rows
$ sqlite3 nfl.db "select pfr_id,  count(*) n from player where pfr_id<>''  group by pfr_id  having n>1;"   -> 0 rows
$ sqlite3 nfl.db "select esb_id,  count(*) n from player where esb_id<>''  group by esb_id  having n>1;"   -> 1 row
```

**No `espn_id` maps to two `gsis_id`s. No `pfr_id` does either.** In the other direction `gsis_id`
is the primary key, so the mapping is 1:1 by construction.

One `esb_id` collision: `PRY456541` on two rows — see *Exception E-3*.

`player` is a byte-faithful reload of `raw/players.csv` for all four identity columns
(`espn_id`, `pfr_id`, `esb_id`, `birth_date`): 25,035 CSV rows, 25,035 DB rows, **0 differing**.
Every identity defect below therefore originates upstream in nflverse, not in `build_db.py`.

### 2. Career-window violations (full population, 1.2 M fact rows)

| table | players | rows | detector blind spot |
|---|---|---|---|
| `player_game_stats` | **1** | **13** | 0 — every stat-bearing player has both bounds populated |
| `snap_count` | **1** | **6** | 0 |
| `depth_chart` | 0 | 0 | 0 |
| `roster_season` | 2,156 | 2,343 | 0 — see note |

`roster_season` is *not* a defect count. nflverse's `rookie_year`/`last_season` track game
appearances, while `roster_season` legitimately carries practice-squad, injured-reserve and camp
rows for seasons in which the player never appeared. That is CONTEXT.md's "structurally not
applicable", not a gap. It is excluded from the failing count for that reason and reported here so
the number is not mistaken for a silent omission.

The two real violations are **E-1** and **E-2** below.

### 3. `snap_count` crosswalk (full population, 324,611 rows)

`snap_count` carries no `gsis_id` of its own; `build_db.py` resolves it through `pfr_id`
against the `player` dimension. It is therefore the one fact table where a single bad
crosswalk entry silently moves rows between humans, and it is checked three ways:

| test | result | exception |
|---|---|---|
| player with snap rows in two different games in the same week | **3 player-weeks** | E-11 |
| snap row whose team contradicts the player's own `player_game_stats` row, Super Bowl | **358 rows across 4 Super Bowls** | E-10 |
| snap row whose team contradicts the player's own stat row, all other games | 46 rows | 45 are E-9, 1 is E-11 |
| player whose snap positions share no position group with his own stat positions *and* who has ≥2 team disagreements | **2 players** | E-9 |

Regular-season team agreement is otherwise near-total: 224,314 of 224,360 joinable rows agree,
and wild-card, divisional and conference-championship rows agree 9,131 out of 9,131 — which is
what makes the Super Bowl result stand out as a defect rather than noise.

**`depth_chart` is the control.** It carries its own `gsis_id` and its own team, and it is loaded
through the same `alias2fid` team mapping as `snap_count`. Its Super Bowl rows agree with the
player's own stat row **1,106 out of 1,106**. So the swap in E-10 is in `raw/snap_counts.csv`, not
in `build_db.py`'s abbreviation-to-franchise mapping.

**`depth_chart` also shows why the impossible-week test does not transfer.** Twelve players appear
on two teams' depth charts in the same week — Randy Moss (MIN→NE, 2010 wk 5), Martellus Bennett
(GB→NE, 2017 wk 10), Preston Smith (GB→PIT, 2024 wk 10), Mike Williams (NYJ→PIT, 2024 wk 10),
Vernon Hargreaves III (TB→HOU, 2019 wk 11) and seven more, all mid-week transactions. A depth chart
is a weekly *published list*, so being on two of them in one week is normal. A snap count is a
record of having been on the field, so being in two of them in one week is not. That is the
distinction CONTEXT.md asks for between "absent" and "structurally not applicable", and it is why
the 12 `depth_chart` cases are not counted as defects while the 3 `snap_count` cases are.

`player_game_stats` has **zero** players with two franchises in one season-week.

### 4. `gsis_id` sequence outliers (full population)

`gsis_id`s are issued in rough chronological order, so the highest id in each debut cohort should
climb monotonically. It does, across all sixteen seasons, with exactly one exception:

| first stat season | 2018 | 2019 | **2020** | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|---|
| highest `gsis_id` | 34881 | 35726 | **39472** | 37013 | 38149 | 39169 | 39934 | 40784 |

`00-0039472` sits 1,323 above the *2022* cohort's maximum while claiming a 2020 season. It is the
same row the career-window detector flags, found by an independent method.

### 5. Same-name collisions — the highest-risk class

The collision set was derived from the data, not from a list. Names are normalised (accents
stripped, punctuation removed, Jr./Sr./II–V suffixes dropped) before grouping, which merges 828 raw
`display_name` duplicates into **870 collision sets covering 1,969 players**.

Each set is classed by whether its members are separable by a discriminator that is unique inside
the set — ESPN athlete id, birthdate, or PFR id — and by whether their careers overlap and how many
carry stat rows:

| classification | sets |
|---|---|
| SAFE / careers disjoint / 0 members with stats | 350 |
| SAFE / careers disjoint / 1 member with stats | 274 |
| SAFE / careers disjoint / ≥2 members with stats | 36 |
| SAFE / careers overlap / 0 members with stats | 89 |
| SAFE / careers overlap / 1 member with stats | 54 |
| **SAFE / careers overlap / ≥2 members with stats** | **64** |
| WEAKLY_SEPARATED | 3 |
| **total** | **870** |

**867 of 870 sets are fully separable.** The 64 highest-risk sets — same name, overlapping
careers, two or more members accumulating statistics — all carry unique birthdates, and 55 of the
64 additionally carry unique ESPN ids *and* unique PFR ids. The named examples in the brief all
land in this group and all resolve cleanly:

| set (members) | resolution | discriminators |
|---|---|---|
| **Adrian Peterson** (2) | RB `00-0025394` b.1985-03-21 espn 10452 pfr PeteAd01 — 140 g, the Vikings back / RB `00-0021306` b.1979-07-01 espn 3776 pfr PeteAd00 — 0 g, the Bears back. Careers overlap 2007–2009 and both are RBs; only the keys and birthdate separate them, and all three do. | espn_id + birth_date + pfr_id |
| **Josh Allen** (2) | QB `00-0034857` b.1996-05-21 espn 3918298 — 141 g / C `00-0030833` b.1991-12-30 espn 17102 — 1 g. The Jacksonville edge rusher is **not** in this set: the DB carries him as **"Josh Hines-Allen"** `00-0035642`, DE, Kentucky, 2019 R1 P7, espn 3915239 — correctly distinct. | espn_id + birth_date + pfr_id |
| **Steve Smith** (5) | WR `00-0020337` b.1979-05-12 espn 2622 — 101 g (the "Sr.") / WR `00-0025438` b.1985-05-06 espn 10495 — 23 g (the Giants receiver) / FB `00-0015306` b.1964-08-30 / OT `SMI723840` b.1944-05-29 / DB `00-0021346` b.1979-06-28 — the last three have no stat rows. Two members lack an `espn_id`, so the set separates on birthdate + PFR id. | birth_date + pfr_id |
| **Chris Johnson** (7) | RB `00-0026164` b.1985-09-23 — 99 g / DB `00-0021949` b.1979-09-25 — 18 g, plus five with no stat rows. Three members lack both `espn_id` and `pfr_id`; all seven birthdates are distinct. | birth_date |
| **Mike Williams** (9) | WR `00-0033536` b.1994-10-04 — 103 g / WR `00-0027702` b.1987-05-18 — 59 g / WR `00-0023452` b.1984-01-04 — 27 g, plus six with no stat rows. Three of the WRs have overlapping careers and the same position; all nine birthdates are distinct. | birth_date |
| **Marvin Jones** (3) | WR `00-0029293` b.1990-03-12 espn 15072 — 152 g / MLB `00-0008819` b.1972-06-28 espn 459 / LB `00-0040973` **"Marvin Jones Jr."** b.2004-06-08 espn 4685425. The Jr. suffix is stripped by normalisation, so this *is* a collision set — and it separates cleanly on all three keys. | espn_id + birth_date + pfr_id |
| **Justin Jefferson** (2) | WR `00-0036322` b.1999-06-16 espn 4262921 — 96 g / LB `00-0041075` b.2003-03-20 espn 5150249 — 0 g. **Van Jefferson** `00-0036415` is a set of one — a different forename, so he never collides with Justin at all. | espn_id + birth_date + pfr_id |
| **Alex Smith** (2) | QB `00-0023436` b.1984-05-07 espn 8416 — 138 g / TE `00-0023506` b.1982-05-22 espn 8485 — 31 g. Both debuted in 2005; fully separated. | espn_id + birth_date + pfr_id |
| **Michael Carter** (3) | CB `00-0036501` "II" b.1999-03-08 espn 4240456 — 65 g / RB `00-0036924` b.1999-05-07 espn 4240657 — 61 g / NT `CAR716523` b.1960-10-29 — 0 g. The two Jets rookies of 2021 are correct in `player`, but nflverse's *other* file has them **crossed** — see §8. The NT's `espn_id` is one of the 17 in **E-4**. | espn_id + birth_date + pfr_id |
| **Josh Johnson** (4) | QB `00-0026300` b.1986-05-15 — 37 g / CB `00-0030322` b.1989-09-10 — 4 g / RB `00-0036799` b.1997-12-26 — 1 g / WR `00-0037442` b.1999-08-10 — 0 g | espn_id + birth_date |
| **Josh Jones** (2) | S `00-0033903` b.1994-09-20 espn 3051716 — 59 g / OT `00-0036363` b.1997-06-22 espn 3914630 — 15 g | espn_id + birth_date + pfr_id |
| **Mike Edwards** (2) | SAF `00-0035681` b.1996-05-18 espn 3155647 / OL `00-0039472` b.1998-11-10 espn 4362015. Separable in the dimension — but **the fact rows are not**: see **E-1**. | espn_id + birth_date + pfr_id |

Suffix pairs deserve a note because normalisation deliberately merges them: Jr./Sr./II–V are
stripped before grouping, so "Marvin Jones Jr." collides with "Marvin Jones" and "Michael Carter
II" with "Michael Carter" *by design*. That is the conservative choice — it widens the set of
things that must be checked rather than narrowing it. Every such pair in the data separates on
birthdate and on both crosswalk keys. There is no "Steve Smith Sr." row in `player`; the receiver
usually written that way is `00-0020337`, stored as plain "Steve Smith".

The three WEAKLY_SEPARATED sets are **E-3** (Layne Pryor), **E-5** (Kevin White) and Andrew Jones
(`JON031942` G 2020 espn 4682830, birthdate NULL / `JON033220` RB 1975-76 pfr JoneAn00) — the last
separable by ESPN id and PFR id, with zero fact rows on either side, so no attribution risk.

The full 870-set table with each set's discriminators, overlap flag and ESPN verdict is appended
at the end of this report and machine-readable at
`scripts/data/nfl-db/cache/a3/verify_result.json` → `collisions.all`.

#### Gap-fill test

Eighteen collision sets contain a member with an interior gap in his stat seasons that a same-named
player fills. Seventeen are benign — the other player was genuinely active that year, which is
exactly what two concurrent same-name careers look like. **One has the diagnostic shape**: the
carrier's *only* stat season is the gap year and it falls outside his own career window. That is
**E-1**.

### 6. espn_id correctness (stratified, 16,765 players)

| outcome | players | meaning |
|---|---|---|
| OK | 15,554 | name plus at least one non-forgeable corroborator, no disagreements |
| CONFLICT | 1,144 | identity settled, but ESPN and nflverse disagree on a field — reported, not resolved |
| WEAK | 13 | name matched and neither source offered a corroborating field |
| **MISMATCH** | **54** | **the ESPN athlete at that id is a different human** |

"MISMATCH" is separated from "CONFLICT" by an explicit rule rather than by judgement. Identity is
treated as settled ("pinned") when the evidence could not plausibly arise between two different
people: same name plus an exact draft year/round/pick triple; or same name plus the same entry era
plus two matching physical attributes; or the same surname plus an exact birthdate plus strong
corroboration. Once identity is pinned, a disagreeing birthdate or a differently-published forename
becomes a *contradiction to record* (standing rule 4), not a wrong human. Where identity is not
pinned, a birthdate disagreement stands as evidence of a different person.

The decisive discriminator turned out to be **era**: ESPN's `debutYear` (or draft year) against
nflverse's `rookie_year`. NFL careers run one to twenty seasons, so a gap of four or more years
between the two sources' idea of when a person entered the league means they are not describing the
same person, whatever the name says. Every one of the 19 espn_id misattributions below has an era
gap of 4 to 50 years.

#### Is the detector actually able to fail?

A verification that passes everything is worthless if it would also pass a deliberately wrong
answer, so the classifier was run as a negative control against pairings that are known to be wrong:
every sampled player compared against (a) a randomly chosen other ESPN athlete, and (b) an athlete
belonging to a *different player with the same surname* — which is the shape a real crosswalk error
actually takes.

| control | n | MISMATCH | CONFLICT | WEAK | **false pass (OK)** |
|---|---|---|---|---|---|
| random wrong athlete | 4,000 | 4,000 | 0 | 0 | **0** |
| same-surname wrong athlete | 4,000 | 3,994 | 2 | 4 | **0** |

```text
$ python3 verify/a3_players.py --selftest      # exits non-zero on any false pass
```

The six non-MISMATCH results in the hard control are not false passes — CONFLICT and WEAK rows are
both enumerated for review rather than accepted — but they are the cases the classifier finds
genuinely hard, and they are all twins or near-twins sharing a surname, a birthdate and a build.

This control also found a real bug. `norm_name` originally split on apostrophes, so `Ja'Mori`
became the tokens `ja` + `mori`, and the initial-vs-forename rule then matched **Ja'Mori Maclin**
to **Jeremy Maclin** as an OK. Apostrophes now bind rather than separate; the control went from one
false pass to zero.

Two ESPN encoding quirks were characterised and are *not* counted as defects:

- **ESPN's `draft.selection` is the pick within the round for the 2001–2005 drafts and the overall
  pick for later ones.** Every apparent draft mismatch in that window resolved to a constant offset
  per (year, round) — all three 2002 round-6 cases differed by exactly 172, all three 2003 round-5
  cases by exactly 135, both 2002 round-5 cases by exactly 135 — which is an encoding change, not a
  data error. The comparison now accepts either encoding and only treats a *round* or *year*
  disagreement as evidence.
- **ESPN emits position abbreviation `-` ("No Position") for most players who left the league
  before it began tracking positions.** That is an ESPN-side gap and is normalised to absent.

### 7. Position and team-history agreement

**Position.** Comparing `player_game_stats.position_group` against `player.position_group` over all
286,843 stat rows returns 9 players with a disagreement: seven are the LB↔DL edge-rusher
reclassification (Trey Hendrickson, Dre'Mont Jones, A.J. Epenesa, Sam Williams, James Houston,
Tyrus Wheat, Donovan Ezeiruaku), one is Bo Melton's genuine WR→CB conversion with Green Bay, and one
is Jack Westover TE/FB. **Zero misattributions.**

Against ESPN, 235 verified players disagree on position. The large majority are the
LB/OLB↔DE edge-rusher boundary, and every one that is not was checked individually: they are real
position changes the two sources label differently — Taysom Hill (QB/TE), Tim Tebow (QB/TE), Landon
Collins (S/LB), Scott Matlock (DT/FB), Avery Williams (CB/RB), Devin Funchess (WR/TE), Bo Melton
(WR/CB). **None indicates a wrong person**, and none of them is classed as a MISMATCH — a position
disagreement alone never is, precisely because position is the least stable field in either source.

**Team history.** `roster_season` cannot be used as a team history and this needs stating, because
using it that way produces 1,056 false alarms. It is a *final-week snapshot*: 42,680 of 43,231
player-seasons have exactly one row, and that row is the team the player was on in the last week of
the season. `raw/rosters.csv` makes this explicit — it carries a `week` column, and every row the
loader keeps is the highest week present. Ezekiel Elliott's 2024 row is `team=LAC, week=19,
status=DEV, jersey=24` in the source and `franchise_id 24` in the DB, while his 15 games that year
were for Dallas (`franchise_id 6`). Nothing is wrong with either value; they answer different
questions. `player_game_stats.franchise_id` is the authoritative per-game team.

So team history was verified against ESPN's own season/team log instead
(`/athletes/{id}/statisticslog`, which yields `(season, ESPN team id)` pairs directly from the
`$ref` URLs; `roster_season.franchise_id` and `team.franchise_id` are already ESPN franchise ids per
CONTEXT.md):

| result | players |
|---|---|
| checked (ESPN season log present) | 902 |
| every DB season/team corroborated by ESPN | 887 |
| `player_game_stats` has a season on a team ESPN never lists for that season | 3 |
| `roster_season` ACT row on a team ESPN never lists for a season ESPN covers | 14 |
| DB has a season predating ESPN's first record of the athlete by 2+ years | 1 |
| ESPN carries no season log (not evidence — see note) | 0 |

The `roster_season` test is deliberately narrowed to `status = 'ACT'` rows in seasons ESPN itself
covers, because the table's practice-squad and injured rows describe seasons in which a player never
took a snap and ESPN therefore has nothing to compare against. Widening it beyond that measures the
snapshot semantics, not the data.

Absence of a statisticslog is not evidence of anything: where ESPN holds two athlete records for
the same human, only one carries stats. LeGarrette Blount is the clean example — `espn_id 3166800`
(the value in `player`) resolves to the right person but 404s on `statisticslog`, while ESPN's
other record for him, `13213`, holds the log.

**All 3 `player_game_stats` disagreements are postseason-only, and the DB is right in every
one.** ESPN's `statisticslog` is regular-season scoped, so a player who joins a team after the
regular season and appears only in the playoffs gets no season/team entry there:

| player | DB season/team ESPN omits | the rows | ESPN's log for that season |
|---|---|---|---|
| Dalvin Cook `00-0033893` | 2023, franchise 33 (BAL) | 1 row, **week 20 POST**, 8 carries 23 yds | 2023 → 20 (NYJ) only |
| Dan Chisena `00-0035976` | 2023, franchise 33 (BAL) | 2 rows, **weeks 20–21 POST** | 2023 → 22 (ARI) only |
| Elijah Moore `00-0036980` | 2025, franchise 7 (DEN) | 1 row, **week 21 POST**, 1 rec 4 yds | 2025 → 2 (BUF) only |

```text
$ sqlite3 nfl.db "select season_type, week, count(*) from player_game_stats
    where gsis_id='00-0033893' and season=2023 and franchise_id=33 group by 1,2;"   -> POST|20|1
```

The 14 `roster_season` disagreements are the same phenomenon one step earlier — a
final-week roster row on the team a player joined late, which ESPN's stats log does not represent
because he recorded nothing there. Hendon Hooker's 2025 row on franchise 20 against ESPN's
`(2024, 8) (2025, 8)`, and Cole Turner's 2025 row on franchise 10 against ESPN's four straight
seasons on 28, are typical. **Zero of the 14 is a mapping failure**; each is the
snapshot semantics described above meeting a source that only records where statistics accrued.

### 8. Cross-source adjudication of the espn_id column

`player.espn_id` comes from `raw/players.csv`. `raw/rosters.csv` carries its own independent
`espn_id` per roster row. Where the two disagree, one of them maps the player to the wrong human —
so every disagreement was put to ESPN.

| | players |
|---|---|
| both sources present and agreeing | 4,925 |
| **disagreeing** | **19** |
| `player.espn_id` blank, `rosters.csv` supplies one | 2 |
| no `espn_id` in `rosters.csv` to compare | 20,089 |

Resolution of the 21:

| ESPN says the correct value is… | count |
|---|---|
| `players.csv` — i.e. **the DB is right** | 11 |
| both ids resolve to the same human (ESPN holds duplicate athlete records) | 7 |
| `rosters.csv` — the DB is blank or holds a dead id | 3 |
| neither | 0 |

**In none of the 21 disagreements does `player.espn_id` point at a different human.** In eleven of
them `rosters.csv` does, and some of those are exactly the failure mode this task is about. (This is
a statement about the 21 disagreements only — the 19 bad `espn_id` values in **E-4** are
cases where `rosters.csv` has no competing value to disagree with, so they do not appear here.)

| gsis_id | player | `rosters.csv` espn_id resolves to |
|---|---|---|
| `00-0036501` | Michael Carter II (CB, Duke, 2021 R5 P154) | Michael Carter (RB, UNC, 2021 R4 P107) — **crossed with the row below** |
| `00-0036924` | Michael Carter (RB, UNC, 2021 R4 P107) | Michael Carter II (CB, Duke, 2021 R5 P154) — **crossed** |
| `00-0038549` | DJ Turner II (CB, Michigan, b.2000-11-09) | DJ Turner (WR, b.1997-01-18) |
| `00-0037106` | Jaylon Jones (CB, b.1997-10-14) | Jaylon Jones (CB, b.2002-04-03) — the other one |
| `00-0029112` | Jacquies Smith (DE) | Bryce Davis (C) |
| `00-0031059` | Marqueston Huff (DB) | Steven Miller (RB) |
| `00-0031087` | Andre Hal (S, b.1992) | Andre Hall (CB, b.1982) |
| `00-0031612` | Aaron Ripkowski (FB) | Alonzo Harris (RB) |
| `00-0032430` | David Morgan (TE) | Kyle Carter (TE) |
| `00-0034956` | Josh Watson (LB, b.1996) | Josh Watson (LB, b.1990) — the other one |
| `00-0032667` | Roy Robertson-Harris (DT) | ESPN 404 |

The DB picked the right column. This is a genuine strength worth recording, and it means any future
work that reaches for `rosters.csv`'s `espn_id` would introduce eleven misattributions the DB
currently does not have.

## Exceptions

Every unresolved item, with evidence. Nothing here has been corrected — this report is read-only on
`nfl.db`.

| # | what | rows affected | severity | fix owner |
|---|---|---|---|---|
| **E-1** | 2020 Buccaneers season, incl. Super Bowl LV run, credited to the wrong Mike Edwards | 13 `player_game_stats` | **highest** | upstream nflverse `player_stats.csv`; re-key in loader |
| **E-2** | 2024 Detroit DT snaps credited to a 2002 offensive tackle (`SmitCh06`) | 6 `snap_count` | high | upstream `players.csv` `pfr_id` assignment |
| **E-3** | Layne Pryor occupies two `player` rows sharing one `esb_id` | 0 (dormant) | low today | upstream; dedupe before he accrues rows |
| **E-4** | `espn_id` fails identity verification — 46 point at a different human, 2 are ESPN name errors, 6 are ESPN birthdate errors | 54 `player` rows; **1** of them carries fact rows | low | upstream `players.csv` |
| **E-5** | Kevin White (CB) carries the *other* Kevin White's birthdate, destroying the collision set's only discriminator | 1 `player` row | medium | upstream; correct to 1992-07-15 per ESPN 2514500 |
| **E-6** | Four fact-bearing players cannot be resolved against ESPN | 4 `player` rows | low | none available — recorded as unverifiable |
| **E-7** | Three `espn_id` values 404 at ESPN, one of them Zach Ertz's | 3 `player` rows | medium | Tay Gowan fixable from `rosters.csv`; Ertz unverifiable |
| **E-8** | ESPN and nflverse disagree on birthdate | 228 `player` rows | low | contradiction, not a defect — record both |
| **E-9** | The two Jonah Williamses have swapped `pfr_id`s | 146 `snap_count` + 4 draft fields | **high** | upstream `players.csv`; swap and reload snaps |
| **E-10** | Four Super Bowls have `team`/`opponent` transposed in `snap_count` | 358 `snap_count` | **high** | upstream `snap_counts.csv`; may belong to the team/game owner |
| **E-11** | Three physically impossible player-weeks (one person, two games) | 3 player-weeks | medium | upstream PFR id conflation; no target row to move them to |

---

### E-1 — MISATTRIBUTION: 13 games of the 2020 Buccaneers, including the Super Bowl LV run, credited to the wrong Mike Edwards

**Severity: highest.** This is a full season of defensive performance attributed to a human who was
not in the NFL.

| | `00-0035681` | `00-0039472` |
|---|---|---|
| name | Mike Edwards | Mike Edwards |
| position | SAF (DB) | OL |
| birth date | 1996-05-18 | 1998-11-10 |
| college | Kentucky | Campbell / Wake Forest |
| draft | 2019 R3 P99 | undrafted |
| career per nflverse | 2019–2025 | 2024–2024 |
| `espn_id` | 3155647 | 4362015 |
| `roster_season` | TB 2019, **TB 2020**, TB 2021, TB 2022, KC 2023, BUF+TB 2024, KC 2025 | BUF 2024 (DEV), BUF 2025 (CUT) |
| `player_game_stats` | 2019, **— 2020 missing —**, 2021, 2022, 2023, 2024, 2025 | **2020 TB, 13 games** |

The 13 rows are seasons 2020 weeks 1, 3, 6, 7, 8, 9, 10, 11, 14 REG plus weeks 18–21 POST — the
wild card, divisional, conference championship and Super Bowl LV.

Five independent proofs, any one of which is sufficient:

1. **Career window.** `00-0039472`'s only stat season, 2020, lies outside his own
   `[rookie_year, last_season] = [2024, 2024]`. He is the only such player in all 286,843 rows.
2. **`gsis_id` sequence.** Id 39472 is 1,323 higher than the maximum id of the 2022 debut cohort.
3. **Gap-fill.** `00-0035681` is missing 2020 from an otherwise continuous 2019–2025 run, and the
   only player carrying a 2020 Buccaneers "Mike Edwards" line is `00-0039472`.
4. **nflverse contradicts itself.** `raw/rosters.csv` places `00-0035681` (Kentucky, b.1996-05-18,
   espn 3155647, jersey 32) on TB in 2020 at week 21 — the Super Bowl — while `raw/player_stats.csv`
   keys the same season's stat lines to `00-0039472` with `position=OL`.
5. **ESPN.** `/athletes/3155647/statisticslog` lists `(2020, team 27)` for the safety.
   `/athletes/4362015/statisticslog` lists only `(2024, team 2)` and `(2025, team 2)` — ESPN has no
   record of the offensive lineman before 2024.

**Cause:** upstream defect in nflverse's `player_stats.csv`, which assigns `player_id`
`00-0039472` to the 2020 Buccaneers safety. `build_db.py` reproduces it faithfully; the `player`
table is a byte-exact reload of `players.csv`.

**Not fixed here** — this report is read-only on `nfl.db`. The correction is to re-key those 13
`player_game_stats` rows from `00-0039472` to `00-0035681`, which also restores the safety's 2020
season. Coordinator decision.

```text
$ sqlite3 nfl.db "select s.gsis_id, p.display_name, p.position, p.rookie_year, p.last_season,
    s.season, s.franchise_id, count(*) from player_game_stats s join player p using(gsis_id)
    where s.gsis_id in ('00-0035681','00-0039472') group by 1,6,7;"
```

---

### E-2 — MISATTRIBUTION: six 2024 Detroit snap-count rows credited to a player last seen in 2002

`snap_count` carries no `gsis_id`; `build_db.py` resolves it through `pfr_id` using the
`player` dimension (`build_db.py`, "snap_counts carries NO gsis_id"). The map is 1:1 — no duplicate
`pfr_id` exists in `players.csv` — so the resolution is only as good as the `pfr_id` assignment,
and for one PFR id that assignment is wrong.

| | value |
|---|---|
| PFR id | `SmitCh06` |
| snap rows | 2024 weeks 1, 9, 16, 17, 18, 20 — franchise 8 (Detroit), position **DT** |
| resolved to | `00-0020895` Chris Smith, **OT**, UC Davis, b.1979-10-09, career 2002–2002 |
| ESPN on `00-0020895` | athlete 4312, b.1979-10-09, 6′8″ 285 lb — confirms the DB row is the 2002 tackle |
| the actual 2024 Detroit DT | `00-0038661` Chris Smith, Notre Dame/Harvard, b.1999-12-15, espn 4367835 — 3 `player_game_stats` rows for 2024 Detroit and **zero snap rows**, because his `pfr_id` is blank |

A 2002 offensive tackle did not take defensive-tackle snaps for Detroit in 2024. `players.csv`
assigned `SmitCh06` to the wrong Chris Smith and left the right one's `pfr_id` empty.

ESPN closes the loop on where the six rows belong. `/athletes/4367835/statisticslog` — the id on
`00-0038661` — returns `(2023, team 8) (2024, team 8) (2025, team 8)`: Detroit in each of the three
seasons, matching the snap rows' franchise and season exactly. `00-0020895` has no `espn_id` at all
to check, which is itself consistent with him being a one-season 2002 player.

```text
$ sqlite3 nfl.db "select gsis_id, pfr_player_id, season, week, franchise_id, position
    from snap_count where pfr_player_id='SmitCh06';"
$ sqlite3 nfl.db "select gsis_id, display_name, position, birth_date, college, rookie_year,
    last_season, pfr_id, espn_id from player where display_name='Chris Smith';"
```

**Not fixed here.** Coordinator decision.

---

### E-3 — Duplicate person: Layne Pryor occupies two `player` rows and one `esb_id`

| | `00-0040792` | `PRY456541` |
|---|---|---|
| name / position | Layne Pryor / TE | Layne Pryor / TE |
| birth date | 2002-12-09 | 2002-12-09 |
| college | Northern Iowa | Northern Iowa |
| height / weight | 74 / 250 | 75 / 251 |
| `esb_id` | **PRY456541** | **PRY456541** |
| `pfr_id` / `espn_id` | — / — | PryoLa00 / 4878842 |
| rookie / last season | 2026 / 2026 | 2025 / 2025 |
| status | ACT | DEV |

One human, two keys — the second row uses the ESB id *as* the `gsis_id`, which is nflverse's
fallback when no GSIS id has been issued yet. It is the only `esb_id` collision in the table.

**Live risk: none today.** Both rows have zero rows in all four fact tables:

```text
$ for g in 00-0040792 PRY456541; do for t in player_game_stats snap_count roster_season depth_chart; do
    sqlite3 nfl.db "select '$g $t', count(*) from $t where gsis_id='$g';"; done; done
```

It is a dormant risk: `PryoLa00` and `espn_id 4878842` sit on the fallback row, so any future
`snap_count` load would resolve his snaps to `PRY456541` while `player_game_stats` (which keys on
GSIS) would land on `00-0040792` — splitting one player across two keys, silently.

ESPN also disagrees with nflverse on his birthdate: ESPN 4878842 says 2003-04-05, both nflverse
rows say 2002-12-09. Position, height and weight all match, so the identity is not in doubt.

---

### E-4 — 54 `espn_id` values fail identity verification, in three distinct groups

Every MISMATCH is listed. They are not one failure mode but three, and the difference matters for
what should be done about each.

#### E-4a — the `espn_id` points at a different human (46 rows)

Each is a historic player whose `espn_id` resolves to a *different* ESPN athlete of the same name
who entered the league 4–50 years later. Nothing corroborates the match beyond the
name — no birthdate, no draft slot, and in most cases not even a position or build.

| gsis_id | DB name / pos / born / rookie | espn_id | ESPN athlete at that id | corroborated | fact rows p/s/r/d |
|---|---|---|---|---|---|
| `00-0001040` | Mike Bell / DE / b.1957-08-30 / 1979 | `3918044` | Mike Bell / LB / b.1997-12-12 / debut 41y later | height | 0/0/0/0 |
| `00-0003940` | Andre Davis / DT / b.1975-10-07 / 1996 | `2515882` | Andre Davis / G / b.1991-12-01 / debut 19y later | height, weight | 0/0/0/0 |
| `00-0004806` | Emil Ekiyor / DE / b.1974-12-25 / 2000 | `4372028` | Emil Ekiyor / G / b.2000-01-22 | **nothing** | 0/0/0/0 |
| `00-0007405` | Alonzo Highsmith / RB / b.1965-02-26 / 1987 | `16384` | Alonzo Highsmith / LB / b.1989-11-21 / debut 28y later | height, weight | 0/0/0/0 |
| `00-0008884` | Tony Jones / WR / b.1965-12-30 / 1990 | `2511102` | Tony Jones / WR / b.1992-03-21 / debut 25y later | pos | 0/0/0/0 |
| `00-0009879` | Leo Lewis / WR / b.1956-09-17 / 1981 | `3917288` | Leo Lewis / LB / b.1996-11-02 / debut 39y later | **nothing** | 0/0/0/0 |
| `00-0009968` | David Little / ILB / b.1959-01-03 / 1981 | `15729` | David Little / WR / b.1988-06-03 / debut 31y later | height | 0/0/0/0 |
| `00-0011237` | Blake Miller / C / b.1968-08-23 / 1992 | `5081450` | Blake Miller / OT / b.2004-02-25 / debut 34y later | pos_group | 0/0/0/0 |
| `00-0014091` | James Rouse / RB / b.1966-12-18 / 1990 | `2470365` | James Rouse / - / b.1991-04-13 / debut 25y later | **nothing** | 0/0/0/0 |
| `00-0016078` | Aaron Taylor / G / b.1975-01-21 / 1998 | `2972063` | Aaron Taylor / S / b.1993-12-25 / debut 19y later | **nothing** | 0/0/0/0 |
| `00-0017213` | Frank Warren / NT / b.1959-09-14 / 1981 | `6656` | Frank Warren / RB / b.1989-04-18 / debut 30y later | **nothing** | 0/0/0/0 |
| `00-0017692` | Gary Wilkins / RB / b.1963-11-23 / 1986 | `2509739` | Gary Wilkins / DE / b.1992-02-02 / debut 29y later | height, weight | 0/0/0/0 |
| `00-0017865` | Larry Williams / G / b.1963-07-03 / 1986 | `3059734` | Larry Williams / G / b.1995-02-22 / debut 33y later | height, pos | 0/0/0/0 |
| `00-0020191` | Kendrick Rogers / OT / b.1976-10-10 / 2002 | `4035255` | Kendrick Rogers / WR / b.1997-08-07 / debut 18y later | height | 0/0/0/0 |
| `00-0021878` | Brandon Williams / CB / b.1980-11-17 / 2003 | `2184059` | Brandon Williams / DE / b.1994-04-04 / debut 13y later | **nothing** | 0/0/0/0 |
| `00-0026966` | Freddie Brown / WR / b.1986-06-24 / 2009 | `12637` | Freddie Brown / WR / b.1993-12-01 / debut 8y later | height, pos | 0/0/0/0 |
| `00-0027452` | James Williams / OT / b.1988-07-03 / 2010 | `3884368` | James Williams / RB / b.1996-05-17 / debut 9y later | **nothing** | 0/0/0/0 |
| `00-0035470` | Lukas Denis / DB / b.1997-04-13 / 2023 | `3915291` | Lukas Denis / S / b.2001-11-30 / debut 4y later | college, height, pos_group, weight | 0/0/3/0 |
| `BAI173035` | David Bailey / DE / b.1965-09-03 / 1990 | `4685248` | David Bailey / LB / b.2003-08-28 / debut 36y later | height | 0/0/0/0 |
| `BRO140760` | Larry Brooks / DT / b.1950-06-10 / 1974 | `4361807` | Larry Brooks / S / b.2000-09-30 | **nothing** | 0/0/0/0 |
| `BRO459816` | Greg Brown / DE / b.1957-01-05 / 1981 | `16050` | Greg Brown / DB / b.1990-01-21 / debut 32y later | college | 0/0/0/0 |
| `CAR716523` | Michael Carter / NT / b.1960-10-29 / 1984 | `17343` | Michael Carter / DB / b.1991-04-22 / debut 30y later | **nothing** | 0/0/0/0 |
| `CLA560106` | Steven Clark / DE / b.1959-10-29 / 1981 | `16979` | Steven Clark / P / b.1991-07-20 / debut 34y later | height | 0/0/0/0 |
| `EMB415290` | Jon Embree / TE / b.1965-10-15 / 1987 | `15657` | Jon Embree / WR / b.1988-10-03 / debut 25y later | height | 0/0/0/0 |
| `FLA103822` | Harry Flaherty / LB / b.1961-12-25 / 1987 | `14385` | Harry Flaherty / TE / b.1989-04-26 / debut 25y later | **nothing** | 0/0/0/0 |
| `GRE415251` | A.J. Greene / DB / b.1966-06-24 / 1991 | `15491` | A.J. Greene / OT / b.1989-09-25 / debut 21y later | **nothing** | 0/0/0/0 |
| `HAR352846` | Cliff Harris / FS / b.1948-11-12 / 1974 | `15644` | Cliff Harris / CB / b.1990-12-12 / debut 39y later | height, pos_group, weight | 0/0/0/0 |
| `HAR447512` | John Harris / FS / b.1956-06-13 / 1978 | `2514269` | John Harris / WR / b.1991-11-11 / debut 37y later | height | 0/0/0/0 |
| `JAC595848` | Tim Jackson / DB / b.1965-11-07 / 1989 | `17490` | Tim Jackson / DT / b.1991-10-24 / debut 25y later | **nothing** | 0/0/0/0 |
| `JOH339990` | Jason Johnson / WR / b.1965-11-08 / 1988 | `4570858` | Jason Johnson / LB / b.2001-06-01 | **nothing** | 0/0/0/0 |
| `JOH752835` | Will Johnson / LB / b.1964-12-04 / 1987 | `2576086` | Will Johnson / P / b.1993-03-05 / debut 29y later | **nothing** | 0/0/0/0 |
| `JON039864` | Anthony Jones / TE / b.1960-05-16 / 1984 | `3914305` | Anthony Jones / RB / b.1997-02-07 / debut 36y later | **nothing** | 0/0/0/0 |
| `JON132880` | Bryant Jones / DB / b.1963-12-05 / 1987 | `3932392` | Bryant Jones / DT / b.1997-04-15 / debut 32y later | **nothing** | 0/0/0/0 |
| `MOS355956` | Anthony Mosley / RB / b.1965-06-17 / 1987 | `15254` | Anthony Mosley / CB / b.1989-08-31 / debut 25y later | **nothing** | 0/0/0/0 |
| `ROB577792` | Johnny Robinson / DE / b.1959-02-14 / 1981 | `3933656` | Johnny Robinson / DT / b.- / debut 38y later | height, pos_group, weight | 0/0/0/0 |
| `ROB640988` | Matt Robinson / QB / b.1955-06-28 / 1977 | `2512549` | Matt Robinson / LB / b.1991-12-31 / debut 38y later | height | 0/0/0/0 |
| `ROS664440` | Oliver Ross / RB / b.1949-09-18 / 1974 | `1532` | Oliver Ross / OG / b.1949-09-18 / debut 24y later | dob | 0/0/0/0 |
| `SMI510400` | Matt Smith / LB / b.1965-09-01 / 1987 | `16229` | Matt Smith / C / b.1990-05-01 / debut 26y later | **nothing** | 0/0/0/0 |
| `SMI651920` | Robert Smith / DE / b.1962-12-03 / 1985 | `2576502` | Robert Smith / S / b.1992-12-22 / debut 31y later | **nothing** | 0/0/0/0 |
| `SMI751680` | Tim Smith / WR / b.1957-03-20 / 1980 | `2467155` | Tim Smith / WR / b.1991-03-22 / debut 34y later | pos, weight | 0/0/0/0 |
| `TAY796650` | Willie Taylor / WR / b.1955-12-09 / 1978 | `4245162` | Willie Taylor III / LB / b.1999-07-07 | **nothing** | 0/0/0/0 |
| `WAL167706` | Gary Walker / C / b.1963-12-15 / 1987 | `16583` | Gary Walker / DB / b.1991-05-10 / debut 26y later | **nothing** | 0/0/0/0 |
| `WAS569019` | Mike Washington / DB / b.1953-07-01 / 1976 | `4686658` | Mike Washington Jr. / RB / b.- / debut 50y later | height | 0/0/0/0 |
| `WIL303714` | Greg Williams / DB / b.1959-08-01 / 1982 | `15656` | Greg Williams / LB / b.1988-12-06 / debut 30y later | **nothing** | 0/0/0/0 |
| `WIL533115` | Terry Williams / DB / b.1965-10-14 / 1988 | `4040172` | Terry Williams / RB / b.1992-03-11 / debut 28y later | weight | 0/0/0/0 |
| `WIL801288` | Tim Wilson / RB / b.1954-01-14 / 1977 | `4339828` | Tim Wilson / WR / b.1994-02-16 / debut 41y later | **nothing** | 0/0/0/0 |

**Live risk: low but not zero.** Every one of these has **zero rows in `player_game_stats` and zero
in `snap_count`**, so no performance is currently misattributed. The risk is forward-looking: any
enrichment that follows `espn_id` — headshots, biography, ESPN game logs — pulls a stranger's record
onto these rows.

**Cause:** upstream. `raw/players.csv` carries these values verbatim, and `rosters.csv` has no
competing value for any of them.

#### E-4b — ESPN publishes a different name for the same human (2 rows)

Here the `espn_id` is arguably *correct* and ESPN's own record carries the wrong or an alternative
name. Each is corroborated by an exact birthdate plus matching entry era, position, height and
weight — five independent attributes.

| gsis_id | DB name / pos / born / rookie | espn_id | ESPN athlete at that id | corroborated | fact rows p/s/r/d |
|---|---|---|---|---|---|
| `00-0033358` | Izaah Lunsford / DT / b.1993-10-21 / 2017 | `2972118` | Izaah Burks / DT / b.1993-10-21 | college, dob, era, height, pos, weight | 0/0/2/0 |
| `00-0033734` | Jomal Wiltz / CB / b.1994-10-23 / 2017 | `3892777` | Jamal Perry / CB / b.1994-10-23 | college, dob, era, height, pos, weight | 26/31/7/39 |

- **`00-0033358` Izaah Lunsford → ESPN 2972118 "Izaah Burks".** A legal name change rather than an
  error — same birthdate, era, college, position and build.
- **`00-0033734` Jomal Wiltz → ESPN 3892777 "Jamal Perry".** The only one of the three carrying fact
  rows (26 `player_game_stats`, 31 `snap_count`, 2019–2021 Miami). Birthdate 1994-10-23, height 70,
  weight 182, debut 2017, position CB and college Iowa State (ESPN college id 66) all match Wiltz
  exactly. Jamal Perry is a different, real Dolphins cornerback. **Nothing is misattributed inside
  the DB** — the fact rows key on `gsis_id` — but ESPN enrichment through this id would surface the
  wrong name.

#### E-4c — ESPN's birthdate is wrong or a placeholder (6 rows)

Position, height, weight and college agree; only the birthdate does not, and the ESPN value is
usually the implausible one.

| gsis_id | DB name / pos / born / rookie | espn_id | ESPN athlete at that id | corroborated | fact rows p/s/r/d |
|---|---|---|---|---|---|
| `00-0007737` | Mike Horan / P / b.1959-02-01 / 1984 | `140` | Mike Horan / P / b.1951-02-01 | college, height, pos | 0/0/0/0 |
| `00-0019785` | Al Blades / DB / b.1977-03-19 / 2001 | `4362500` | Al Blades Jr. / S / b.1999-10-24 | height, pos_group | 0/0/0/0 |
| `00-0037349` | Kellen Diesch / OT / b.1997-08-23 / 2022 | `4035251` | Kellen Diesch / OT / b.2000-03-28 | college, height, pos, weight | 0/0/3/0 |
| `00-0039679` | Ben Nikkel / WR / b.1999-09-24 / 2024 | `4874465` | Ben Nikkel / S / b.2001-05-12 | college, height, weight | 0/0/2/0 |
| `00-0040684` | Patrick Jenkins / DE / b.2003-08-20 / 2025 | `4431172` | Patrick Jenkins / DE / b.2001-01-01 | college, height, pos, weight | 0/0/1/0 |
| `JOH399522` | Lawrence Johnson / S / b.1957-09-11 / 1979 | `4368881` | Lawrence Johnson / S / b.1999-09-02 | height, pos, weight | 0/0/0/0 |

`00-0040684` Patrick Jenkins is the clearest: ESPN gives `2001-01-01`, a placeholder date, against
the DB's 2003-08-20, while position, height (74), weight (293) and college all match exactly.
`00-0019785` Al Blades → ESPN "Al Blades Jr." is a generational pair rather than an ESPN error — the
DB row is the father (b.1977, 2001 rookie) and ESPN's record is the son (b.1999), so this one is a
genuine wrong-`espn_id`; it is listed here rather than in E-4a only because its evidence signature is
the same shape.

These are left as MISMATCH rather than tuned into contradictions: a multi-year birthdate gap with no
draft slot and no exact-date corroboration is legitimate evidence of a different person, and the
audit's job is to surface it, not to explain it away. All 6 have zero rows in
`player_game_stats` and `snap_count`.

**Across all 54 MISMATCH rows, exactly one carries fact data** — `00-0033734` Jomal Wiltz in
E-4b, and that one is an ESPN-side name error with nothing misattributed inside the DB. Every other
failing `espn_id` sits on a `player` row with zero `player_game_stats` and zero `snap_count` rows.

```text
$ python3 -c "import json,sqlite3
d=json.load(open('cache/a3/verify_result.json'))
con=sqlite3.connect('file:nfl.db?mode=ro',uri=True)
f={r[0]:r[1] for r in con.execute('select gsis_id,count(*) from player_game_stats group by 1')}
print([g for g in d['mismatch'] if f.get(g,0)])"
-> ['00-0033734']
```

### E-5 — Kevin White: the DB's birthdate makes automated crosswalking point at the wrong human

`player` holds two Kevin Whites, both entering the league in 2015, **both recorded with birthdate
1992-06-25**. ESPN says otherwise:

| | `00-0031545` | `00-0031683` |
|---|---|---|
| DB position / height / weight | WR / 75 / 216 | CB / 70 / 174 |
| DB college | West Virginia; Lackawanna JC | TCU |
| DB draft | 2015 R1 P7 (CHI) | undrafted |
| DB birth date | 1992-06-25 | **1992-06-25** |
| `espn_id` in DB | *(blank)* | *(blank)* |
| correct ESPN athlete | **3042435** — WR, b.1992-06-25, 75/216, 2015 R1 P7, college 277 = West Virginia | **2514500** — CB, b.**1992-07-15**, 70/174, debut 2015, college 2628 = TCU |

ESPN 2514500 matches the cornerback on position, height, weight, debut year *and* college — five
independent attributes — and disagrees only on the birthdate. **`player.birth_date` for
`00-0031683` carries the wide receiver's birthdate.**

College is the cleanest single discriminator here, and it points the opposite way to the birthdate:
ESPN college id 2628 on athlete 2514500 resolves to **TCU**, which is what the DB records for
`00-0031683`; ESPN college id 277 on athlete 3042435 resolves to **West Virginia**, which is what
the DB records for `00-0031545`. Birthdate says the two rows are the same person; college, position,
height and weight all say they are not.

This is more than a wrong field: it destroys the only discriminator this collision set has. Run
naively, the resolver picks ESPN 3042435 (the receiver) for *both* rows, because the shared
birthdate outweighs the cornerback's own physical profile. `scripts/data/nfl-db/cache/a3/`
`missing_espn_resolution.json` records `00-0031683` as `RESOLVED_AMBIGUOUS` with both candidates
and their evidence rather than asserting a single answer.

**Live risk today: none** — `00-0031683` has zero `player_game_stats` rows and a single
`roster_season` row. `00-0031545`'s 19 stat rows are correctly his.

`rosters.csv` independently confirms `00-0031545` → ESPN 3042435 across 2016–2021.

---

### E-6 — Four fact-bearing players cannot be resolved against ESPN

Of the 21 players that carry fact rows but no `espn_id`, 16 were resolved to a unique ESPN athlete,
1 resolved ambiguously (E-5) and 4 were not resolved at all:

| gsis_id | player | fact rows (pgs/snap/roster/depth) | why unresolved |
|---|---|---|---|
| `00-0037451` | Rod Williams, TE, Tennessee-Martin, b.2000-04-10 | 7 / 0 / 3 / 20 | The only "Roderick Williams" ESPN holds is a DB born 1986-05-27 from Alcorn State who debuted 2013 — wrong on birthdate, era, college, position, height and weight simultaneously. |
| `00-0036120` | Armani Taylor-Prioleau, OT, b.1997-04-21 | 0 / 0 / 5 / 3 | Absent from ESPN's NFL search index under "Armani Taylor-Prioleau", "Armani Taylor" or "Taylor-Prioleau". |
| `00-0027329` | Joe Joseph, DT, Miami, b.1985-10-20 | 0 / 0 / 1 / 1 | The surname query returns only Sebastian Joseph-Day (b.1995, Rutgers) and Joshua Josephs (2026 entrant, Tennessee, LB). Neither matches on birthdate, era, college or position. |
| `00-0036454` | Pete Guerrerio, RB, Monmouth | 0 / 0 / 1 / 0 | ESPN holds **4262315 "Pete Guerri*e*ro"**, RB, debut 2020 — position, height 70, weight 190 and debut all consistent. nflverse spells the surname *Guerrerio* in `players.csv` and *Guerriero* in `rosters.csv`, so the name test refuses the match. Almost certainly the same human; recorded as unresolved rather than asserted, and the `player.display_name`/`last_name` misspelling is itself a defect. |

The 16 that did resolve uniquely include Dave Tollefson (ESPN 9839, draft 2006 R7 P253 exact) and
Cameron Fleming (ESPN 16932 "Cam Fleming", draft 2014 R4 P140 exact, height 77, weight 320) — both
with a birthdate contradiction recorded under E-8. The seventeenth, Kevin White `00-0031683`, is
`RESOLVED_AMBIGUOUS` by design: see E-5.

---

### E-7 — Three `espn_id` values return HTTP 404 from ESPN

| gsis_id | player | `espn_id` | evidence |
|---|---|---|---|
| `00-0039501` | Jack Plummer, QB — 0 stat rows, 2 `roster_season`, 1 `depth_chart` | `2961162` | 404. Both nflverse files agree on the value across 2024–2025, so it is internally consistent and externally unresolvable. The id is also out of era: 2.96 M sits in ESPN's ~2016-recruit range, while Plummer is a 2024 entrant whose id should be ≈4.4 M. Suspicious as well as dead. |
| `00-0030061` | **Zach Ertz**, TE — 2013–2025, **191 `player_game_stats` rows, 192 `snap_count`, 210 `depth_chart`** | `15835` | 404 on `sports.core.api`, `site.api` and `site.web.api`; 404 on `/seasons/{2013,2018,2021,2024}/athletes/15835`; 404 on `espn.com/nfl/player/_/id/15835`; ESPN's NFL search index returns no Zach Ertz at all (only his Stanford college record, `s:20~l:23~a:482590`). Both nflverse files agree on 15835 across all 13 seasons, so the value is internally consistent — it simply cannot be confirmed or refuted against ESPN today. |
| `00-0036897` | Tay Gowan, CB | `4568981` | 404. `rosters.csv` carries **4038967**, which resolves to Tay Gowan, CB, b.1998-01-07, drafted 2021 R6 P223 — exact match on birthdate and draft slot. Here `rosters.csv` holds the live id and `player.espn_id` holds a dead one. |

These are the only athlete lookups in the entire run that failed. `misses.json` holds 5 entries in total: 3 athlete 404s (the three above) and 2 `statisticslog` 404s — `15835` again, and `4071345` (Chris Manhertz), whose athlete record resolves correctly but who has no season log because ESPN keeps his stats under a second record. Against 16,765 successful athlete fetches.

Per standing rule 1 these are recorded as unverifiable, not guessed at.

---

### E-8 — ESPN and nflverse disagree on birthdate for 228 verified players

Recorded, not resolved, per standing rule 4. In each case identity is pinned by evidence a
coincidence cannot produce — an exact draft year/round/pick triple, or matching entry era plus
position, height and weight — so these are source disagreements about a field, not wrong humans.
Representative cases, with the corroborating evidence that settles identity:

| gsis_id | player | DB birth date | ESPN birth date | identity pinned by |
|---|---|---|---|---|
| `00-0024467` | Dave Tollefson | 1982-07-10 | 1981-05-19 | draft 2006 R7 P253 exact, DE, debut 2006 |
| `00-0031067` | Cameron Fleming | 1992-09-03 | 1993-09-03 | draft 2014 R4 P140 exact, OT, 77 in / 320 lb exact |
| `00-0027881` | Jerry Hughes | 1988-08-13 | 1988-08-31 | draft exact, position, height, weight — transposed digits |
| `00-0038656` | Mohamed Ibrahim | 1999-09-08 | 1998-09-08 | RB, height, weight — year off by one |
| `00-0039757` | Terrell Jennings | 2001-01-03 | 2001-03-01 | RB, height, weight — transposed month/day |
| `00-0032637` | Andrew Adams | 1993-08-28 | 1992-10-28 | DB, height, weight, debut |
| `00-0037460` | Johnny Johnson III | 1999-05-14 | 1999-05-04 | WR, height, weight |
| `00-0040429` | Josh Williams | 2000-06-09 | 2001-06-09 | RB, height, weight |

The full list is in `scripts/data/nfl-db/cache/a3/verify_result.json` → `conflict`, filtered on a
`birth_date` reason.

None of these affects attribution: all four fact tables key on `gsis_id`, and `birth_date` is
carried only in the `player` dimension. The risk is that `birth_date` is the discriminator of last
resort for same-name players — which is exactly how E-5 becomes dangerous.

---

### E-9 — MISATTRIBUTION: the two Jonah Williamses have swapped `pfr_id`s, moving 146 snap rows between them

**Severity: high.** Both players are current starters and both are affected in every season since 2020.

| | `00-0035629` | `00-0035944` |
|---|---|---|
| name / position | Jonah Williams / **OT** | Jonah Williams / **DE** |
| birth date | 1997-11-17 | 1995-08-17 |
| college | Alabama | Weber State |
| height / weight | 77 / 312 | 77 / 280 |
| `espn_id` | 4040726 | 4032481 |
| `pfr_id` | **WillJo16** | **WillJo10** |
| draft in DB | *(blank)* | **2019 R1 P11 CIN** |
| `player_game_stats` (keyed on `gsis_id`, correct) | OT — CIN 2020–2023, ARI 2024–2025 | DE — LAR 2021–2023, DET+LAR+MIN 2024, NO 2025 |
| `snap_count` (keyed via `pfr_id`) | **DE/DT — LAR 2021–2023, DET+LAR+MIN 2024, NO 2025 (67 rows)** | **OT/T — CIN 2020–2023, ARI 2024–2025 (79 rows)** |

ESPN settles both identities and both directions of the swap:

- ESPN **4040726**: Jonah Williams, OT, b.1997-11-17, 6′5″ 312 lb, debut 2019, **draft 2019 R1 P11**;
  `statisticslog` gives `(2020,4) (2021,4) (2022,4) (2023,4) (2024,22) (2025,22)` — Cincinnati then
  Arizona. That is `00-0035629`'s `player_game_stats` history exactly.
- ESPN **4032481**: Jonah Williams, DE, b.1995-08-17, 6′5″ 280 lb, debut 2020, **undrafted**;
  `statisticslog` gives `(2021,14) (2022,14) (2023,14) (2024,8) (2024,14) (2024,16) (2025,18)` —
  the Rams, then Detroit/Rams/Minnesota, then New Orleans. That is `00-0035944`'s history exactly.

So the `espn_id` on each row is **correct**, and each player's `player_game_stats` rows are
**correct**. What is wrong is the `pfr_id`: PFR's `WillJo10` is the tackle (its snap rows are
`T`/`OT` for Cincinnati and Arizona) but sits on the DE's row, and PFR's `WillJo16` is the pass
rusher (its snap rows are `DE`/`DT` for the Rams and New Orleans) but sits on the tackle's row.

Consequences in the DB:

1. **146 `snap_count` rows are attributed to the wrong human** — 67 defensive-line rows credited to
   the left tackle, 79 offensive-line rows credited to the edge rusher.
2. **`draft_year` / `draft_round` / `draft_pick` / `draft_team` on `00-0035944` belong to
   `00-0035629`.** ESPN and PFR both have the Weber State player undrafted; the DB gives him the
   tackle's 2019 first-round, eleventh-overall selection by Cincinnati.

Caught by two detectors jointly — a position-group non-overlap between a player's snaps and his own
stat rows, *plus* ≥ 2 team disagreements. Either signal alone is noisy (edge rushers are routinely
labelled LB by one source and DE by the other, producing 65 position-only candidates); together
they isolate exactly these two players out of 7,749.

```text
$ sqlite3 nfl.db "select gsis_id, pfr_player_id, season, franchise_id, position, count(*)
    from snap_count where gsis_id in ('00-0035629','00-0035944') group by 1,2,3,4,5 order by 1,3;"
$ sqlite3 nfl.db "select gsis_id, season, franchise_id, position, count(*)
    from player_game_stats where gsis_id in ('00-0035629','00-0035944') group by 1,2,3,4 order by 1,2;"
```

**Not fixed here.** Coordinator decision: the `pfr_id` values need swapping and the draft fields on
`00-0035944` cleared, after which `snap_count` must be reloaded.

---

### E-10 — MISATTRIBUTION: 358 Super Bowl snap rows carry the opponent's team

In four of the thirteen Super Bowls in the data, **every** `snap_count` row has `team` and
`opponent` transposed, so every player's snaps are credited to the team he was playing against.

| season | Super Bowl | joinable rows | agree with the player's own stat row | disagree |
|---|---|---|---|---|
| 2013 | XLVIII | 73 | 73 | 0 |
| **2014** | **XLIX** | **58** | **0** | **58** |
| **2015** | **50** | **66** | **0** | **66** |
| 2016 | LI | 66 | 66 | 0 |
| 2017 | LII | 58 | 58 | 0 |
| **2018** | **LIII** | **55** | **0** | **55** |
| 2019 | LIV | 62 | 62 | 0 |
| **2020** | **LV** | **61** | **0** | **61** |
| 2021 | LVI | 59 | 59 | 0 |
| 2022 | LVII | 64 | 64 | 0 |
| 2023 | LVIII | 68 | 68 | 0 |
| 2024 | LIX | 69 | 69 | 0 |
| 2025 | LX | 66 | 66 | 0 |

The 0/100 split is the point: this is not drift, it is four whole games inverted. Total rows in the
four affected games, including players with no stat row to join against: **358**.

Spot checks, comparing `snap_count.franchise_id` against the same player's
`player_game_stats.franchise_id` for the same season and week:

| player | actual team | `snap_count` says |
|---|---|---|
| Tom Brady, SB XLIX (2014) | NE (17) | SEA (26) |
| Cam Newton, SB 50 (2015) | CAR (29) | DEN (7) |
| Peyton Manning, SB 50 (2015) | DEN (7) | CAR (29) |
| Von Miller, SB 50 (2015) | DEN (7) | CAR (29) |
| Tom Brady, SB LV (2020) | TB (27) | KC (12) |
| Patrick Mahomes, SB LV (2020) | KC (12) | TB (27) |
| Travis Kelce, SB LV (2020) | KC (12) | TB (27) |

**Cause: upstream, and visible in the raw file.** In `raw/snap_counts.csv`, game
`2014_21_NE_SEA` records Russell Wilson, Russell Okung, Max Unger, J.R. Sweezy, Justin Britt and
James Carpenter — all Seahawks — with `team=NE, opponent=SEA`:

```text
$ python3 -c "import csv; csv.field_size_limit(10**7)
[print({k:r[k] for k in ('game_id','player','team','opponent')})
 for r in csv.DictReader(open('raw/snap_counts.csv'))
 if r['season']=='2014' and r['game_type']=='SB'][:6]"
```

For contrast, wild-card, divisional and conference-championship rows agree with the player's own
stat row **9,131 times out of 9,131**, and regular-season rows 224,314 out of 224,360.

This is a *team* misattribution rather than a player-identity one, so the fix may belong with
whoever owns the team/game dimension — flagging it here because it moves a player's measured
workload onto the wrong franchise in the highest-leverage game of the season, which is exactly what
a prop model must not have.

**Not fixed here.** Coordinator decision.

---

### E-11 — MISATTRIBUTION: three physically impossible player-weeks

Nobody plays two games in one week. `snap_count` contains three player-weeks where one `gsis_id`
holds rows from two different games for two different franchises — so at least one row in each pair
belongs to a different human.

| gsis_id | player | `pfr_id` | season | week | franchises | rows |
|---|---|---|---|---|---|---|
| `00-0034446` | Jalen Davis, CB | `DaviJa06` | 2019 | 16 | 22 (ARI), 15 (MIA) | 2 |
| `00-0034446` | Jalen Davis, CB | `DaviJa06` | 2019 | 17 | 22 (ARI), 15 (MIA) | 2 |
| `00-0034446` | Jalen Davis, CB | `DaviJa06` | 2021 | 12 | 15 (MIA), 4 (CIN) | 2 |

All three sit on one PFR id, which accumulates snaps for Miami (2018, 2019, 2021), Arizona (2019)
and Cincinnati (2020–2025). The DB's own `roster_season` gives `00-0034446` a single trajectory —
MIA 2018 → ARI 2019 → CIN 2020–2025 — and `player_game_stats` agrees (MIA 2018, CIN 2020–2025). On
that evidence the four Miami rows dated 2019 wk 15–17 and 2021 wk 12 are the strays, and PFR's
`DaviJa06` is conflating two cornerbacks named Jalen Davis, only one of whom exists in `player`.

Stated as evidence rather than conclusion: **which** row of each impossible pair is wrong is
inferable from `roster_season`, but the second human has no row in `player` to move them to, so no
correction is proposed here. Per standing rule 1, the rows are flagged, not reassigned.

```text
$ sqlite3 nfl.db "select gsis_id, season, week, group_concat(distinct franchise_id), count(*)
    from snap_count where gsis_id is not null and franchise_id is not null
    group by gsis_id, season, week having count(distinct franchise_id) > 1;"
```

This detector is exhaustive over all 324,611 `snap_count` rows and returns exactly these three.

---

## Reproduce

All ESPN responses are cached under `scripts/data/nfl-db/cache/a3/`; the verifier is offline and
read-only once the cache exists.

```bash
cd scripts/data/nfl-db

# 1. Fill the cache. Two requests in flight, 0.12 s sleep, ~3.9 docs/s.
#    Resumable: re-running skips anything already cached or recorded as a miss.
python3 verify/a3_players.py --fetch --statlog --workers 2 --sleep 0.12

# 2. Resolve ESPN college $refs to names (needed for the college corroborator)
python3 verify/a3_players.py --colleges

# 3. Name-resolve the 21 fact-bearing players that carry no espn_id
python3 verify/a3_players.py --resolve-missing

# 4. Adjudicate players.csv vs rosters.csv espn_id disagreements against ESPN
python3 verify/a3_players.py --cross-source

# 5. Negative control. Offline. Exits non-zero if the classifier passes a
#    known-wrong pairing — run this before trusting step 6.
python3 verify/a3_players.py --selftest ; echo "exit=$?"

# 6. Verify. Offline. Exits non-zero if any identity mismatch remains.
python3 verify/a3_players.py ; echo "exit=$?"

# 7. Regenerate this report's data sections
python3 verify/a3_players.py --markdown
```

Artefacts written by the above, all under `scripts/data/nfl-db/cache/a3/`:

| file | contents |
|---|---|
| `athletes/**.json` | one ESPN athlete document per fetched `espn_id` |
| `statlog/**.json` | ESPN season/team logs for the prop-relevant strata |
| `colleges/**.json` | ESPN college id → name |
| `search/**.json` | ESPN search responses used to resolve players with no `espn_id` |
| `misses.json` | every id that 404'd or errored, with the reason |
| `verify_result.json` | full machine-readable result: every mismatch, conflict, collision set, career-window violation and coverage figure |
| `missing_espn_resolution.json` | per-player resolution of the 21 fact-bearing players with no `espn_id` |
| `cross_source_espn.json` | the `players.csv` vs `rosters.csv` adjudication |
| `selftest.json` | the negative-control result, including any false pass |

Standalone SQL for the four network-free detectors:

```bash
# career-window violations
sqlite3 nfl.db "select f.gsis_id, p.display_name, p.position, p.rookie_year, p.last_season,
  min(f.season), max(f.season), count(*) from player_game_stats f join player p using(gsis_id)
  where (p.rookie_year<>'' and f.season < cast(p.rookie_year as integer))
     or (p.last_season<>'' and f.season > cast(p.last_season as integer)) group by 1;"

# gsis_id sequence outliers
sqlite3 nfl.db "with x as (select gsis_id, cast(substr(gsis_id,4) as integer) num, min(season) mn
  from player_game_stats where gsis_id glob '00-0*' group by 1,2),
  m as (select mn, max(num) mx from x group by mn)
  select x.gsis_id, p.display_name, x.mn, x.num, m.mx from x join player p using(gsis_id)
  join m on m.mn = x.mn+2 where x.num > m.mx;"

# key collisions
sqlite3 nfl.db "select 'espn_id', espn_id, count(*) from player where espn_id<>'' group by 2 having count(*)>1
  union all select 'pfr_id', pfr_id, count(*) from player where pfr_id<>'' group by 2 having count(*)>1
  union all select 'esb_id', esb_id, count(*) from player where esb_id<>'' group by 2 having count(*)>1;"

# duplicate persons
sqlite3 nfl.db "select display_name, birth_date, count(*), group_concat(gsis_id,' ; ')
  from player where birth_date<>'' group by 1,2 having count(*)>1;"

# snap_count: physically impossible player-weeks
sqlite3 nfl.db "select gsis_id, season, week, group_concat(distinct franchise_id), count(*)
  from snap_count where gsis_id is not null and franchise_id is not null
  group by gsis_id, season, week having count(distinct franchise_id) > 1;"

# snap_count: team disagreement against the player's own stat rows, by game type
sqlite3 nfl.db "select s.season_type, count(*),
  sum(case when s.franchise_id = g.franchise_id then 1 else 0 end) agree,
  sum(case when s.franchise_id <> g.franchise_id then 1 else 0 end) disagree
  from snap_count s join player_game_stats g
    on g.gsis_id=s.gsis_id and g.season=s.season and g.week=s.week
  where s.franchise_id is not null and g.franchise_id is not null group by 1;"
```

`verify_result.json` carries the machine-readable form of every one of these under
`career_window`, `gap_fill_swaps`, `snap_crosswalk`, `collisions`, `key_dupes` and `mismatch`.

---

## Appendix — all 870 same-name collision sets

Discriminators are listed strongest-first. "n" is the number of `player` rows sharing the name;
"stats" is how many of them carry `player_game_stats` rows. ESPN verdicts are per member, in
descending stat-volume order; `NOT_` means the member was outside the fetched frame (it has no
`espn_id`, or sits in a tier the fetch had not reached).

| name | n | discriminators | overlap | stats | ESPN verdicts |
|---|---|---|---|---|---|
| a j davis | 2 | birth_date | no | 0 | NOT_,OK |
| a j green | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| a j jenkins | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| aaron brewer | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| aaron brown | 5 | birth_date | no | 1 | OK,OK,OK,NOT_,NOT_ |
| aaron jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| aaron smith | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| aaron taylor | 2 | espn_id+birth_date | yes | 0 | OK,MISM |
| aaron wallace | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| adam walker | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| adrian jones | 2 | birth_date | no | 0 | NOT_,CONF |
| adrian martinez | 2 | birth_date | no | 1 | OK,NOT_ |
| adrian peterson | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| ahmad brooks | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| al harris | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| al jackson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| al johnson | 2 | birth_date | no | 0 | NOT_,OK |
| albert reese | 2 | espn_id+birth_date | no | 0 | OK,OK |
| alex brown | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| alex carter | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| alex green | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| alex johnson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| alex lewis | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| alex smith | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| alfred jackson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| allen aldridge | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| allen degraffenreid | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| alonzo johnson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| andre brown | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| andre carter | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| andre coleman | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| andre davis | 3 | espn_id+birth_date+pfr_id | no | 0 | MISM,OK,OK |
| andre hardy | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| andre johnson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| andre jones | 2 | birth_date+pfr_id | no | 1 | CONF,NOT_ |
| andre smith | 3 | espn_id+birth_date+pfr_id | yes | 3 | CONF,OK,OK |
| andrew jackson | 3 | birth_date+pfr_id | no | 1 | OK,OK,NOT_ |
| andrew jones | 2 | **none** | no | 0 | OK,NOT_ |
| anthony allen | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| anthony anderson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| anthony brown | 3 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK,OK |
| anthony davis | 4 | birth_date+pfr_id | no | 1 | OK,OK,OK,NOT_ |
| anthony dunn | 2 | espn_id+birth_date | no | 0 | OK,OK |
| anthony harris | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| anthony hill | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| anthony johnson | 5 | espn_id+birth_date | yes | 2 | OK,OK,OK,OK,OK |
| anthony lucas | 2 | birth_date | no | 0 | WEAK,NOT_ |
| anthony mcfarland | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| anthony miller | 3 | espn_id+birth_date | no | 1 | OK,OK,OK |
| anthony parker | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| anthony smith | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,OK,OK |
| anthony thompson | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| antoine winfield | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| antonio brown | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| antonio gibson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| antonio johnson | 3 | espn_id+birth_date | no | 2 | OK,OK,OK |
| antonio smith | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| antonio williams | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| asante samuel | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| austin brown | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| austin davis | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| austin johnson | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| b j johnson | 2 | birth_date | no | 0 | OK,NOT_ |
| beau gardner | 2 | espn_id+birth_date | no | 0 | OK,OK |
| ben williams | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| benny sapp | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| bernard jackson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| bill johnson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| billy davis | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| blake miller | 2 | birth_date | no | 0 | MISM,NOT_ |
| bob jones | 2 | birth_date | no | 0 | OK,NOT_ |
| bob nelson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| bob thomas | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| bobby bell | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| bobby brooks | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| bobby brown | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| bobby jackson | 2 | birth_date | no | 0 | NOT_,NOT_ |
| bobby johnson | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| brad smith | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| brandon banks | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| brandon barnes | 2 | espn_id+birth_date+pfr_id | no | 0 | CONF,OK |
| brandon coleman | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| brandon harrison | 2 | birth_date | no | 0 | OK,NOT_ |
| brandon johnson | 3 | espn_id+birth_date+pfr_id | yes | 3 | OK,OK,OK |
| brandon jones | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,OK,OK |
| brandon king | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| brandon marshall | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| brandon miller | 2 | birth_date | no | 0 | NOT_,NOT_ |
| brandon mitchell | 2 | birth_date | no | 0 | OK,NOT_ |
| brandon moore | 4 | birth_date+pfr_id | yes | 2 | OK,NOT_,OK,NOT_ |
| brandon smith | 3 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK,OK |
| brandon stephens | 2 | espn_id+birth_date | no | 1 | OK,OK |
| brandon williams | 6 | espn_id+birth_date | yes | 4 | OK,OK,OK,OK,MISM,OK |
| brian allen | 4 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK,OK,OK |
| brian clark | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| brian johnson | 2 | espn_id+birth_date | no | 1 | OK,OK |
| brian johnston | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| brian jones | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| brian mitchell | 2 | espn_id+birth_date+pfr_id | yes | 0 | CONF,CONF |
| brian parker | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| brian price | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,CONF |
| brian smith | 4 | birth_date | no | 1 | OK,NOT_,OK,NOT_ |
| brian williams | 4 | birth_date+pfr_id | yes | 1 | OK,OK,OK,NOT_ |
| bruce davis | 3 | birth_date+pfr_id | yes | 1 | OK,NOT_,NOT_ |
| bruce taylor | 2 | birth_date | no | 0 | OK,NOT_ |
| bruce thornton | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| bryan cox | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| bryan johnson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| bryan thomas | 2 | espn_id+birth_date | no | 1 | CONF,OK |
| byron murphy | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| byron young | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| c j brewer | 2 | espn_id+birth_date | no | 1 | OK,OK |
| c j mosley | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| c j wilson | 3 | espn_id+birth_date+pfr_id | yes | 3 | CONF,OK,OK |
| caleb johnson | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| calvin jackson | 2 | espn_id+birth_date | no | 0 | OK,OK |
| calvin jones | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| cam johnson | 2 | espn_id+birth_date+pfr_id | no | 1 | CONF,OK |
| cam miller | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| cam newton | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| cam thomas | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| carlos henderson | 2 | birth_date | no | 0 | OK,NOT_ |
| cedric jones | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| cedric tillman | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| cedrick wilson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| chad brown | 2 | espn_id+birth_date | yes | 0 | CONF,OK |
| chad johnson | 2 | espn_id+birth_date | yes | 1 | OK,CONF |
| chad williams | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| chandler jones | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| charles anthony | 2 | birth_date | no | 0 | NOT_,NOT_ |
| charles bennett | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| charles davis | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| charles grant | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| charles jackson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| charles johnson | 4 | birth_date | yes | 1 | OK,NOT_,NOT_,NOT_ |
| charles washington | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| charlie hall | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| charlie johnson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| charlie jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| charlie smith | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| charlie thomas | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| chase allen | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| chris akins | 2 | birth_date | no | 0 | NOT_,OK |
| chris baker | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| chris brazzell | 2 | espn_id+birth_date+pfr_id | no | 0 | CONF,OK |
| chris brooks | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| chris brown | 7 | birth_date | yes | 0 | NOT_,OK,OK,CONF,OK,NOT_,NOT_ |
| chris campbell | 2 | espn_id+birth_date | no | 0 | OK,OK |
| chris canty | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| chris carter | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| chris clemons | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| chris combs | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| chris cooper | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| chris davis | 6 | birth_date | yes | 1 | OK,NOT_,OK,NOT_,OK,NOT_ |
| chris edmonds | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| chris givens | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| chris harper | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| chris harris | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| chris henry | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| chris jackson | 3 | espn_id+birth_date | no | 1 | OK,OK,OK |
| chris johnson | 7 | birth_date | yes | 2 | OK,OK,OK,NOT_,OK,OK,NOT_ |
| chris jones | 7 | birth_date | yes | 4 | OK,OK,OK,OK,NOT_,NOT_,NOT_ |
| chris lindstrom | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| chris martin | 3 | espn_id+birth_date+pfr_id | no | 0 | OK,OK,OK |
| chris miller | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| chris morris | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| chris samuels | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| chris sanders | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| chris scott | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| chris smith | 6 | birth_date | yes | 4 | CONF,OK,OK,OK,NOT_,NOT_ |
| chris thomas | 2 | espn_id+birth_date | no | 0 | OK,OK |
| chris thompson | 3 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK,OK |
| chris ward | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| chris warren | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| chris white | 4 | birth_date+pfr_id | no | 1 | OK,OK,NOT_,NOT_ |
| chris williams | 5 | birth_date | yes | 3 | OK,OK,CONF,NOT_,NOT_ |
| chris young | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| christian jones | 3 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK,OK |
| chuck bradley | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| chuck evans | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| chuck harris | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| chuck wiley | 2 | espn_id+birth_date | no | 0 | CONF,CONF |
| clarence williams | 5 | birth_date | yes | 0 | OK,OK,OK,NOT_,NOT_ |
| clay matthews | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| clifton smith | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| cody brown | 2 | espn_id+birth_date | no | 0 | CONF,OK |
| cody white | 2 | espn_id+birth_date | no | 1 | OK,OK |
| connor mcgovern | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| corey brown | 2 | birth_date | no | 1 | OK,NOT_ |
| corey fuller | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| corey harris | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| corey moore | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| corey robinson | 2 | espn_id+birth_date | no | 1 | OK,OK |
| corey white | 2 | espn_id+birth_date | no | 1 | OK,CONF |
| cornell green | 2 | birth_date | no | 1 | CONF,NOT_ |
| courtney brown | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| courtney jackson | 2 | birth_date | no | 0 | NOT_,OK |
| craig james | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| curtis anderson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| curtis brown | 3 | birth_date | no | 1 | OK,NOT_,NOT_ |
| curtis johnson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| curtis marsh | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| d d lewis | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| d j hall | 2 | birth_date | no | 0 | NOT_,OK |
| d j johnson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| d j jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| d j williams | 3 | espn_id+birth_date+pfr_id | yes | 3 | OK,OK,OK |
| dan alexander | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| dan moore | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| dan morgan | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| dan williams | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| daniel hardy | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| daniel thomas | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| danny johnson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| darrell jackson | 2 | espn_id+birth_date | no | 0 | OK,OK |
| darrell williams | 3 | espn_id+pfr_id | yes | 1 | OK,OK,OK |
| darren evans | 2 | espn_id+birth_date | no | 0 | OK,OK |
| darryl hall | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| darryl harris | 2 | birth_date+pfr_id | no | 0 | CONF,NOT_ |
| darryl williams | 2 | espn_id+birth_date | no | 0 | OK,OK |
| daryl porter | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| daryl smith | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| dave brown | 3 | birth_date+pfr_id | yes | 0 | OK,NOT_,NOT_ |
| dave costa | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| dave edwards | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| dave tipton | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| dave williams | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| david bailey | 2 | birth_date | no | 0 | NOT_,MISM |
| david caldwell | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| david carter | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| david douglas | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| david green | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| david howard | 2 | birth_date | no | 0 | NOT_,NOT_ |
| david johnson | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| david jones | 4 | birth_date | no | 1 | OK,NOT_,OK,NOT_ |
| david king | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| david long | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| david martin | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| david mims | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| david moore | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| david nelson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| david rivers | 2 | birth_date | no | 0 | NOT_,OK |
| david sims | 2 | birth_date | no | 1 | OK,NOT_ |
| david terrell | 2 | espn_id+birth_date+pfr_id | yes | 0 | CONF,OK |
| david thompson | 2 | birth_date | no | 0 | OK,NOT_ |
| david white | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| david williams | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| david wilson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| dennis johnson | 6 | birth_date | yes | 1 | OK,OK,NOT_,NOT_,NOT_,NOT_ |
| dennis smith | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| derek brown | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| derrick barnes | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| derrick graham | 2 | espn_id+birth_date | no | 0 | OK,OK |
| derrick harmon | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| derrick johnson | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| derrick jones | 3 | birth_date | no | 1 | OK,NOT_,NOT_ |
| derrick martin | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| derrick moore | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| derrick thomas | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| derwin gray | 2 | espn_id+birth_date+pfr_id | no | 0 | CONF,CONF |
| devin bush | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| devin moore | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| devin neal | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| devin smith | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| devonta smith | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| dexter davis | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| dexter jackson | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| dj turner | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| don jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| don smith | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| donald brown | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| doug martin | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| doug smith | 3 | birth_date+pfr_id | yes | 0 | NOT_,NOT_,NOT_ |
| doug williams | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| drake jackson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| duke williams | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| dylan parham | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| earl thomas | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| ed reynolds | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| ed smith | 3 | birth_date | no | 0 | OK,NOT_,NOT_ |
| ed williams | 3 | birth_date | no | 0 | OK,NOT_,NOT_ |
| eddie brown | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| eddie jackson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| eddie johnson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| elijah ponder | 2 | espn_id+birth_date | no | 1 | CONF,OK |
| elijah williams | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| eric brown | 3 | birth_date+pfr_id | no | 0 | OK,NOT_,NOT_ |
| eric green | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| eric hill | 2 | birth_date | no | 0 | CONF,NOT_ |
| eric johnson | 4 | birth_date+pfr_id | yes | 1 | OK,OK,OK,NOT_ |
| eric lane | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| eric martin | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| eric moore | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| eric rogers | 2 | espn_id+birth_date | no | 0 | OK,OK |
| eric smith | 4 | birth_date+pfr_id | no | 1 | OK,NOT_,OK,OK |
| eric stokes | 3 | birth_date+pfr_id | no | 1 | OK,OK,NOT_ |
| eric thomas | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| eric williams | 3 | birth_date+pfr_id | yes | 0 | OK,NOT_,NOT_ |
| eric wilson | 3 | birth_date | no | 1 | OK,NOT_,NOT_ |
| eric wright | 3 | birth_date+pfr_id | no | 1 | OK,NOT_,NOT_ |
| ernest jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| ernie jones | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| eugene rowell | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| frank garcia | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| frank gore | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| frank middleton | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| fred coleman | 2 | birth_date+pfr_id | no | 0 | NOT_,CONF |
| fred davis | 3 | birth_date | no | 1 | OK,NOT_,WEAK |
| fred dean | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| fred jones | 3 | birth_date+pfr_id | no | 0 | OK,OK,NOT_ |
| fred weary | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| freddie scott | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| freddie solomon | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| gabe hall | 2 | espn_id+birth_date | no | 0 | OK,OK |
| gary anderson | 3 | birth_date+pfr_id | yes | 0 | CONF,OK,NOT_ |
| gary brown | 2 | birth_date+pfr_id | yes | 0 | NOT_,OK |
| gary johnson | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| gary lewis | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| gary smith | 2 | birth_date+pfr_id | no | 0 | NOT_,WEAK |
| gary walker | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,MISM |
| gene washington | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| george atkinson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| george cooper | 2 | birth_date | no | 0 | NOT_,NOT_ |
| george farmer | 3 | birth_date | no | 1 | OK,OK,NOT_ |
| george williams | 2 | birth_date | no | 0 | NOT_,OK |
| glen young | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| greg bell | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| greg boyd | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| greg clark | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| greg gaines | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| greg hill | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| greg johnson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| greg jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| greg latta | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| greg lee | 2 | birth_date | no | 0 | NOT_,NOT_ |
| greg lewis | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| greg little | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| greg lloyd | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| greg orton | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| greg roberts | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| greg robinson | 3 | birth_date+pfr_id | no | 1 | OK,NOT_,NOT_ |
| greg smith | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| greg taylor | 2 | birth_date | no | 0 | NOT_,NOT_ |
| greg townsend | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| hardy nickerson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| harrison smith | 2 | birth_date | no | 1 | OK,NOT_ |
| henry hynoski | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| henry thomas | 2 | birth_date | yes | 0 | CONF,NOT_ |
| henry williams | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| howard cross | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| irv smith | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| isaiah johnson | 4 | espn_id+birth_date | yes | 4 | OK,OK,OK,OK |
| isaiah williams | 3 | espn_id+birth_date | no | 2 | OK,OK,OK |
| j j jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| j r reed | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| j t thomas | 3 | birth_date | no | 1 | OK,NOT_,CONF |
| jack campbell | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| jacoby jones | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| jake scott | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| james allen | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| james atkins | 2 | espn_id+birth_date+pfr_id | no | 0 | CONF,OK |
| james black | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| james brown | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| james burgess | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| james butler | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| james davis | 3 | birth_date+pfr_id | no | 1 | OK,OK,NOT_ |
| james hall | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| james harris | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| james hunter | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| james johnson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| james jones | 5 | birth_date | yes | 1 | OK,OK,OK,NOT_,NOT_ |
| james lee | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| james lynch | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| james reed | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| james robinson | 2 | birth_date | no | 1 | OK,NOT_ |
| james stewart | 2 | espn_id+birth_date | yes | 0 | OK,OK |
| james thompson | 2 | birth_date+pfr_id | no | 0 | NOT_,WEAK |
| james washington | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| james white | 3 | birth_date | no | 1 | OK,NOT_,NOT_ |
| james wilder | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| james williams | 4 | espn_id+birth_date | no | 1 | OK,OK,MISM,OK |
| james wright | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| jason davis | 2 | birth_date | yes | 0 | NOT_,OK |
| jason johnson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,MISM |
| jason moore | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| jason phillips | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,WEAK |
| jason taylor | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| jay taylor | 2 | espn_id+birth_date+pfr_id | no | 0 | CONF,OK |
| jaylon jones | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| jaylon moore | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| jeff fuller | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| jeff george | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| jeff graham | 2 | birth_date | yes | 0 | NOT_,OK |
| jeff kelly | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| jeff moore | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| jeff smith | 5 | birth_date | yes | 1 | OK,NOT_,OK,NOT_,NOT_ |
| jeff wright | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| jeremiah trotter | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| jeremy clark | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| jermaine smith | 2 | birth_date | no | 0 | NOT_,CONF |
| jerome boyd | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| jerome davis | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| jerry butler | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| jerry reese | 3 | birth_date+pfr_id | no | 0 | NOT_,NOT_,CONF |
| jerry rice | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| jesse james | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| jim jensen | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| jim kelly | 2 | birth_date+pfr_id | no | 0 | CONF,NOT_ |
| jim miller | 3 | birth_date | no | 0 | OK,NOT_,NOT_ |
| jim mills | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| jim mitchell | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| jim turner | 2 | birth_date | no | 0 | NOT_,NOT_ |
| jim yarbrough | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| jimmie jones | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| jimmy robinson | 2 | birth_date | no | 0 | NOT_,NOT_ |
| jimmy smith | 3 | birth_date+pfr_id | no | 1 | OK,NOT_,OK |
| jimmy williams | 4 | espn_id+birth_date | yes | 0 | OK,OK,OK,OK |
| joe fields | 2 | birth_date | no | 0 | NOT_,NOT_ |
| joe jackson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| joe johnson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| joe jones | 3 | birth_date | no | 1 | OK,NOT_,NOT_ |
| joe phillips | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| joe reed | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| joe thomas | 3 | birth_date+pfr_id | yes | 2 | OK,OK,NOT_ |
| joe walker | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| joe williams | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| joel williams | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| joey porter | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| john andrews | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| john clay | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| john davis | 2 | espn_id+birth_date | no | 0 | OK,OK |
| john henderson | 2 | birth_date | yes | 1 | OK,NOT_ |
| john jackson | 3 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK,OK |
| john jenkins | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| john johnson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| john jones | 2 | birth_date | no | 0 | OK,NOT_ |
| john lee | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| john lewis | 2 | birth_date | no | 0 | NOT_,NOT_ |
| john lovett | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| john miller | 3 | birth_date+pfr_id | no | 1 | OK,NOT_,NOT_ |
| john saunders | 2 | birth_date | no | 0 | OK,NOT_ |
| john simon | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| john smith | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| john stephens | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| john sullivan | 3 | birth_date+pfr_id | no | 1 | OK,NOT_,NOT_ |
| john taylor | 2 | espn_id+birth_date | no | 0 | OK,OK |
| john thornton | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| john walker | 2 | birth_date | no | 0 | NOT_,NOT_ |
| john washington | 2 | birth_date | no | 0 | OK,NOT_ |
| john williams | 4 | birth_date | no | 0 | CONF,OK,NOT_,NOT_ |
| johnny johnson | 3 | birth_date | no | 0 | CONF,NOT_,CONF |
| jon runyan | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| jonah williams | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| jonathan brown | 2 | birth_date | no | 0 | NOT_,OK |
| jonathan stewart | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| jordan miller | 3 | espn_id+birth_date | no | 2 | OK,OK,OK |
| jordan moore | 2 | espn_id+birth_date | no | 0 | OK,OK |
| jordan morgan | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| jordan murray | 2 | espn_id+birth_date | no | 0 | OK,OK |
| jordan phillips | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| josh allen | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| josh cooper | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| josh davis | 2 | birth_date | no | 0 | NOT_,NOT_ |
| josh evans | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| josh harris | 3 | espn_id+birth_date | yes | 2 | OK,OK,OK |
| josh johnson | 4 | espn_id+birth_date | yes | 3 | OK,OK,OK,OK |
| josh jones | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| josh norman | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| josh robinson | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| josh shaw | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| josh simmons | 2 | espn_id+birth_date | no | 1 | OK,OK |
| josh thomas | 3 | espn_id+birth_date+pfr_id | no | 2 | OK,OK,OK |
| josh thompson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| josh williams | 2 | espn_id+birth_date+pfr_id | no | 1 | CONF,OK |
| justin anderson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| justin britt | 2 | birth_date | no | 1 | OK,NOT_ |
| justin evans | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| justin green | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| justin hamilton | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| justin jackson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| justin jefferson | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| justin jones | 2 | espn_id+birth_date | no | 1 | OK,OK |
| justin rogers | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF,CONF |
| justin smith | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| justin watson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| kaleb johnson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| keith bishop | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| keith browner | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| keith jackson | 2 | espn_id+birth_date | no | 0 | OK,OK |
| keith jones | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| keith lewis | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| keith smith | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| keith taylor | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| keith washington | 2 | espn_id+birth_date | no | 0 | CONF,OK |
| keith williams | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| keith willis | 2 | birth_date | no | 0 | OK,NOT_ |
| keith wright | 2 | birth_date | no | 0 | NOT_,NOT_ |
| kellen winslow | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| ken anderson | 2 | birth_date | no | 0 | NOT_,NOT_ |
| ken brown | 4 | birth_date+pfr_id | no | 0 | NOT_,NOT_,NOT_,NOT_ |
| ken clark | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| ken johnson | 5 | birth_date | yes | 0 | NOT_,NOT_,NOT_,NOT_,NOT_ |
| kenneth harris | 2 | birth_date | no | 0 | WEAK,NOT_ |
| kenny clark | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| kenny king | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| kenny moore | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| kevin alexander | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| kevin belcher | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| kevin brown | 2 | birth_date | no | 0 | NOT_,NOT_ |
| kevin curtis | 2 | birth_date | no | 1 | OK,NOT_ |
| kevin donnalley | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| kevin greene | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| kevin harris | 2 | birth_date | no | 1 | OK,NOT_ |
| kevin house | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| kevin huntley | 2 | birth_date | no | 0 | NOT_,NOT_ |
| kevin johnson | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF,OK |
| kevin jordan | 2 | birth_date | no | 0 | NOT_,NOT_ |
| kevin lewis | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| kevin long | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| kevin murphy | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| kevin scott | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| kevin smith | 5 | birth_date | yes | 2 | CONF,OK,NOT_,OK,CONF |
| kevin thomas | 3 | birth_date+pfr_id | no | 1 | OK,NOT_,CONF |
| kevin turner | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| kevin walker | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| kevin white | 2 | **none** | yes | 1 | NOT_,NOT_ |
| kevin williams | 5 | birth_date | no | 1 | OK,OK,NOT_,NOT_,NOT_ |
| kris jenkins | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| kwamie lassiter | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| kyle fuller | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| kyle murphy | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| kyle williams | 4 | espn_id+birth_date+pfr_id | yes | 3 | OK,OK,OK,OK |
| kyle wilson | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| lamar jackson | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| larry brown | 6 | birth_date | yes | 0 | OK,NOT_,NOT_,NOT_,NOT_,NOT_ |
| larry jones | 2 | birth_date | no | 0 | NOT_,NOT_ |
| larry parker | 2 | espn_id+birth_date | no | 0 | OK,OK |
| larry smith | 3 | birth_date+pfr_id | no | 0 | OK,NOT_,NOT_ |
| larry webster | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| lawrence jackson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| layne pryor | 2 | **none** | no | 0 | NOT_,CONF |
| leon brown | 2 | birth_date | no | 0 | NOT_,OK |
| leon mcquay | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| leonard taylor | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| leonard williams | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| leroy harris | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| leshun daniels | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| levi brown | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| lonnie johnson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| lorenzo styles | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| malcolm johnson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| marcus allen | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,OK,OK |
| marcus bell | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| marcus brown | 2 | birth_date | no | 0 | NOT_,OK |
| marcus freeman | 2 | birth_date | no | 0 | NOT_,NOT_ |
| marcus green | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| marcus harris | 3 | espn_id+birth_date | yes | 1 | OK,OK,OK |
| marcus henry | 2 | birth_date | no | 0 | NOT_,CONF |
| marcus jackson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| marcus johnson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| marcus jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| marcus martin | 2 | espn_id | yes | 1 | OK,OK |
| marcus riley | 2 | birth_date | no | 0 | NOT_,OK |
| marcus smith | 3 | espn_id+birth_date | yes | 2 | OK,OK,OK |
| marcus spears | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| marcus thomas | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,CONF |
| marcus williams | 3 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK,OK |
| mario edwards | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| mario williams | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| marion barber | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mark bell | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| mark brown | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| mark campbell | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| mark carrier | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| mark clayton | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| mark fields | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| mark ingram | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| mark jackson | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| mark johnson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| mark lewis | 2 | birth_date | no | 0 | NOT_,NOT_ |
| mark miller | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| mark murphy | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| mark nichols | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| mark robinson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mark thomas | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| mark washington | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| mark wheeler | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| marlon jones | 2 | birth_date | no | 0 | WEAK,NOT_ |
| marvin allen | 2 | birth_date | no | 0 | NOT_,NOT_ |
| marvin harrison | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| marvin jones | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,OK,OK |
| marvin powell | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| matt gay | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| matt jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| matt murphy | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,CONF |
| matt stevens | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| maurice alexander | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| maurice hurst | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| maurice smith | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| mel gray | 2 | birth_date+pfr_id | no | 0 | CONF,NOT_ |
| mel mitchell | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| michael adams | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| michael bennett | 4 | espn_id+birth_date | yes | 3 | OK,OK,OK,OK |
| michael brooks | 3 | birth_date+pfr_id | yes | 1 | OK,NOT_,NOT_ |
| michael carter | 3 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK,MISM |
| michael davis | 2 | birth_date | no | 1 | CONF,NOT_ |
| michael grant | 2 | birth_date | no | 0 | NOT_,NOT_ |
| michael harris | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| michael haynes | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| michael jackson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| michael johnson | 3 | birth_date+pfr_id | yes | 2 | OK,OK,NOT_ |
| michael mitchell | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| michael pittman | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| michael reid | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| michael smith | 3 | birth_date | no | 1 | OK,NOT_,NOT_ |
| michael thomas | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| michael wiley | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| michael williams | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| michael young | 2 | espn_id+birth_date | no | 0 | OK,OK |
| mickey shuler | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike adams | 3 | birth_date+pfr_id | yes | 2 | OK,OK,NOT_ |
| mike barber | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| mike bell | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,MISM |
| mike black | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| mike brown | 4 | birth_date | yes | 2 | OK,OK,OK,NOT_ |
| mike caldwell | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| mike cofer | 2 | espn_id+birth_date+pfr_id | yes | 0 | CONF,OK |
| mike crawford | 2 | birth_date+pfr_id | no | 0 | CONF,NOT_ |
| mike davis | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,OK,OK |
| mike edwards | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| mike evans | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike ford | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike green | 3 | birth_date+pfr_id | no | 1 | OK,OK,NOT_ |
| mike hawkins | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| mike holmes | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| mike hughes | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| mike hull | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike jenkins | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| mike johnson | 4 | birth_date | no | 1 | OK,CONF,NOT_,NOT_ |
| mike jones | 5 | birth_date | yes | 0 | OK,NOT_,NOT_,NOT_,NOT_ |
| mike jordan | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| mike kelley | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| mike lee | 2 | birth_date | no | 0 | OK,NOT_ |
| mike martin | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike mccoy | 3 | birth_date | yes | 0 | NOT_,NOT_,NOT_ |
| mike mcdonald | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| mike montgomery | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| mike morgan | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike morris | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| mike murphy | 2 | birth_date | no | 0 | NOT_,NOT_ |
| mike reid | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,CONF |
| mike reilly | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| mike richardson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike robinson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| mike smith | 3 | birth_date+pfr_id | no | 0 | OK,NOT_,NOT_ |
| mike thomas | 3 | birth_date+pfr_id | no | 2 | OK,OK,NOT_ |
| mike warren | 2 | birth_date | no | 0 | OK,NOT_ |
| mike washington | 2 | birth_date+pfr_id | no | 0 | NOT_,MISM |
| mike wells | 3 | birth_date+pfr_id | no | 0 | OK,NOT_,NOT_ |
| mike white | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| mike williams | 9 | birth_date | yes | 3 | OK,OK,OK,OK,OK,OK,NOT_,NOT_,NOT_ |
| mike wilson | 3 | birth_date+pfr_id | yes | 0 | NOT_,NOT_,NOT_ |
| mike woods | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| nate allen | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| nate davis | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| nate evans | 2 | espn_id+birth_date | no | 0 | OK,OK |
| nate johnson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| nate jones | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| nate turner | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| nick harris | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| nick martin | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| nick miller | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| nick moore | 2 | birth_date | no | 1 | OK,NOT_ |
| nick perry | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| nick williams | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| oliver ross | 2 | birth_date+pfr_id | no | 0 | NOT_,MISM |
| omar brown | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,OK,OK |
| orlando brown | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| oronde gadsden | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,CONF |
| paris johnson | 2 | birth_date | no | 1 | OK,NOT_ |
| pat johnson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| pat thomas | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| pat williams | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| patrick robinson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| patrick scott | 2 | birth_date | no | 0 | NOT_,NOT_ |
| paul richardson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| paul smith | 3 | birth_date | no | 0 | CONF,NOT_,NOT_ |
| perry williams | 3 | birth_date+pfr_id | yes | 0 | OK,NOT_,NOT_ |
| phillip thomas | 2 | espn_id+birth_date | no | 1 | OK,OK |
| preston brown | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| quincy wilson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| randy clark | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| randy jackson | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| randy johnson | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| randy rasmussen | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| ray agnew | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| ray brown | 3 | birth_date | yes | 0 | OK,NOT_,NOT_ |
| ray hamilton | 2 | birth_date | no | 0 | OK,NOT_ |
| ray perkins | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| ray phillips | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| ray williams | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| reggie brown | 5 | espn_id+birth_date | yes | 0 | OK,OK,OK,OK,WEAK |
| reggie davis | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| reggie jones | 3 | espn_id+birth_date+pfr_id | no | 0 | OK,OK,CONF |
| reggie lewis | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| reggie mckenzie | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| reggie nelson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| reggie smith | 3 | birth_date+pfr_id | yes | 1 | OK,NOT_,NOT_ |
| reggie stephens | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| reggie walker | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| reggie white | 4 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK,OK,OK |
| reggie williams | 3 | birth_date | no | 0 | NOT_,OK,NOT_ |
| rich coady | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| richard johnson | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| richard jones | 2 | birth_date | no | 0 | CONF,NOT_ |
| richard williams | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| rick razzano | 2 | birth_date | no | 0 | NOT_,NOT_ |
| ricky bell | 3 | birth_date | no | 0 | OK,NOT_,NOT_ |
| ricky brown | 2 | birth_date | no | 1 | OK,NOT_ |
| ricky ray | 2 | birth_date | no | 0 | NOT_,NOT_ |
| ricky williams | 3 | birth_date+pfr_id | yes | 1 | OK,OK,NOT_ |
| rob carpenter | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| rob johnson | 2 | birth_date | yes | 0 | OK,NOT_ |
| robert griffin | 2 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK |
| robert hardy | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| robert hunt | 2 | birth_date | no | 1 | OK,NOT_ |
| robert jackson | 4 | birth_date+pfr_id | yes | 1 | OK,NOT_,NOT_,NOT_ |
| robert james | 2 | birth_date | no | 1 | OK,NOT_ |
| robert johnson | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| robert jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| robert smith | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,MISM |
| robert thomas | 3 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK,OK |
| robert turner | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| robert williams | 4 | birth_date | no | 0 | OK,NOT_,OK,NOT_ |
| robert wilson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| robert woods | 3 | birth_date+pfr_id | yes | 1 | OK,NOT_,NOT_ |
| rod jones | 3 | birth_date+pfr_id | yes | 0 | CONF,NOT_,OK |
| rod smith | 3 | espn_id+birth_date+pfr_id | yes | 1 | OK,OK,OK |
| rodney smith | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| rodney thomas | 3 | birth_date+pfr_id | no | 1 | OK,NOT_,OK |
| ron brown | 3 | birth_date | yes | 0 | NOT_,NOT_,NOT_ |
| ron carpenter | 2 | birth_date | no | 0 | CONF,NOT_ |
| ron edwards | 2 | birth_date | no | 1 | OK,NOT_ |
| ron heller | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| ron johnson | 5 | birth_date+pfr_id | yes | 0 | OK,NOT_,NOT_,NOT_,NOT_ |
| ron lewis | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| ron smith | 3 | birth_date | no | 0 | NOT_,NOT_,NOT_ |
| roosevelt nix | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| roy williams | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| rufus brown | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| russell davis | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| ryan benjamin | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| ryan grant | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| ryan griffin | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| ryan miller | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| ryan taylor | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| sam adams | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| sam rogers | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| sam williams | 3 | birth_date+pfr_id | no | 2 | OK,OK,NOT_ |
| scott davis | 2 | birth_date+pfr_id | yes | 0 | NOT_,OK |
| scott miller | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| sean jones | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| sean ryan | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| sean smith | 4 | pfr_id | no | 1 | OK,OK,NOT_,NOT_ |
| shaun smith | 2 | birth_date | yes | 1 | OK,NOT_ |
| sherman smith | 2 | birth_date | no | 0 | NOT_,NOT_ |
| spencer brown | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| stan white | 2 | birth_date | no | 0 | NOT_,NOT_ |
| stanford samuels | 2 | birth_date | no | 1 | OK,NOT_ |
| stanley morgan | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| stanley wilson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| steve broussard | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| steve bryant | 2 | birth_date | no | 0 | NOT_,NOT_ |
| steve clark | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| steve foley | 2 | birth_date+pfr_id | no | 0 | NOT_,CONF |
| steve griffin | 3 | birth_date | yes | 0 | NOT_,NOT_,NOT_ |
| steve jackson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| steve johnson | 2 | birth_date+pfr_id | no | 1 | CONF,NOT_ |
| steve jordan | 2 | birth_date+pfr_id | yes | 0 | NOT_,OK |
| steve martin | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| steve parker | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| steve rogers | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| steve smith | 5 | birth_date+pfr_id | yes | 2 | OK,OK,NOT_,OK,NOT_ |
| steve williams | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| steve wilson | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| steve young | 2 | birth_date+pfr_id | no | 0 | CONF,NOT_ |
| steven harris | 2 | espn_id+birth_date | yes | 0 | OK,OK |
| steven jackson | 2 | birth_date | yes | 1 | OK,NOT_ |
| t j carter | 2 | espn_id+birth_date | yes | 1 | OK,CONF |
| t j turner | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| taiwan jones | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| ted karras | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| ted washington | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| terrance smith | 2 | birth_date | no | 1 | OK,NOT_ |
| terry jackson | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| terry jones | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| terry miller | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| terry williams | 2 | espn_id+birth_date | no | 0 | MISM,OK |
| terry wright | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| thomas brown | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| thomas gordon | 2 | espn_id+birth_date | no | 0 | OK,OK |
| thomas williams | 2 | birth_date | no | 1 | OK,NOT_ |
| tim anderson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| tim brown | 2 | birth_date | no | 0 | NOT_,OK |
| tim carter | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| tim foley | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| tim harris | 3 | birth_date+pfr_id | no | 1 | OK,OK,NOT_ |
| tim johnson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| tim ryan | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,OK |
| tim smith | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,MISM |
| tim watson | 2 | birth_date | no | 0 | OK,NOT_ |
| todd thomas | 2 | birth_date | no | 0 | OK,NOT_ |
| tom brown | 2 | birth_date | yes | 0 | NOT_,NOT_ |
| tom humphrey | 2 | birth_date | no | 0 | NOT_,NOT_ |
| tom neville | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| tommy thompson | 2 | birth_date | no | 0 | NOT_,OK |
| tony adams | 3 | birth_date | no | 1 | OK,NOT_,OK |
| tony baker | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| tony brown | 5 | birth_date+pfr_id | yes | 2 | OK,OK,NOT_,NOT_,OK |
| tony carter | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| tony cline | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| tony elliott | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| tony hill | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| tony hunter | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| tony jones | 4 | espn_id+birth_date+pfr_id | yes | 1 | OK,MISM,OK,OK |
| tony mcgee | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| tony simmons | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| tony smith | 2 | birth_date | yes | 0 | NOT_,OK |
| tony stewart | 2 | birth_date | no | 0 | NOT_,OK |
| tony taylor | 2 | espn_id+birth_date+pfr_id | no | 0 | CONF,OK |
| tony washington | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| tony woods | 2 | birth_date+pfr_id | yes | 0 | NOT_,OK |
| tracy porter | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| travis brown | 2 | birth_date | no | 0 | OK,NOT_ |
| travis davis | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| travis williams | 2 | birth_date | no | 0 | NOT_,OK |
| travis wilson | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,OK |
| troy davis | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| troy johnson | 2 | birth_date+pfr_id | yes | 0 | OK,NOT_ |
| troy smith | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| troy wilson | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| trumaine johnson | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| tyler davis | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| tyrone davis | 2 | birth_date+pfr_id | no | 0 | NOT_,OK |
| tyrone jones | 2 | birth_date+pfr_id | no | 0 | NOT_,NOT_ |
| tyrone wheatley | 2 | espn_id+birth_date+pfr_id | no | 0 | OK,CONF |
| tyrone williams | 2 | espn_id+birth_date+pfr_id | no | 0 | CONF,OK |
| victor jones | 2 | espn_id+birth_date+pfr_id | yes | 0 | OK,CONF |
| vince williams | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| vincent brown | 2 | espn_id+birth_date+pfr_id | no | 1 | OK,OK |
| walter johnson | 2 | birth_date | no | 0 | NOT_,NOT_ |
| wayne davis | 2 | birth_date+pfr_id | yes | 0 | NOT_,NOT_ |
| wendell davis | 3 | espn_id+birth_date+pfr_id | yes | 0 | CONF,OK,OK |
| will allen | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| will davis | 2 | espn_id+birth_date+pfr_id | no | 2 | OK,OK |
| will hill | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| will johnson | 3 | espn_id+birth_date+pfr_id | no | 2 | OK,OK,MISM |
| will smith | 2 | espn_id+birth_date+pfr_id | no | 1 | CONF,OK |
| willie gaston | 2 | birth_date | no | 0 | NOT_,OK |
| willie jones | 2 | birth_date | no | 0 | OK,NOT_ |
| willie parker | 2 | birth_date | no | 0 | NOT_,OK |
| willie smith | 2 | birth_date+pfr_id | no | 1 | OK,NOT_ |
| willie spencer | 2 | birth_date | no | 0 | NOT_,NOT_ |
| willie williams | 3 | birth_date+pfr_id | yes | 0 | CONF,OK,NOT_ |
| willie wright | 2 | birth_date+pfr_id | no | 0 | OK,NOT_ |
| willie young | 2 | birth_date | no | 1 | OK,NOT_ |
| zach allen | 2 | espn_id+pfr_id | no | 1 | OK,OK |
| zach brown | 2 | espn_id+birth_date | yes | 1 | OK,OK |
| zach miller | 2 | espn_id+birth_date+pfr_id | yes | 2 | OK,OK |
| zach thomas | 3 | espn_id+birth_date+pfr_id | no | 1 | OK,OK,OK |
