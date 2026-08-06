# A1 — every game in the database verified against ESPN

## Verdict

**FAIL — 114 of 4,648 game rows carry a confirmed defect.** Every one of the 172 field-level
differences between the `game` table and ESPN is now accounted for: 56 are explained by three
systematic source-convention rules where the database is right and ESPN is wrong (or both are right
under different definitions), and 120 are confirmed database errors across 114 rows, each itemised
below with a third source. **Zero differences remain unexplained.**

The headline: `season`, `season_type`, `week`/`playoff_round`, home/away **orientation**,
score presence, ESPN venue id, and `time_valid` agree on **all 4,648 rows, with no exceptions**.
The suspected mass failure — a systematic ET-vs-UTC offset on `kickoff_utc` — **does not exist**;
4,608 of 4,648 kickoff instants match ESPN to the second.

## What I checked

**Full population. All 4,648 rows, 2010–2026.** No sampling.

ESPN was swept by `(season, seasontype, week)` slate rather than per-event: 391 scoreboard requests
(17 seasons x 18 regular-season weeks + 17 seasons x 5 postseason weeks) indexing **4,663 ESPN
events**, plus 16 `summary?event=` fallbacks for one slate that 504'd on the first pass. Every
response is cached under `scripts/data/nfl-db/cache/a1/` and is the evidence for every claim here; a
re-run from cache takes 0.47s and re-fetches nothing.

Compared per game: `espn_event_id` resolution, `season`, `season_type`, `week`/`playoff_round`,
home and away franchise **by ESPN franchise id** (never abbreviation), home/away orientation,
`kickoff_utc` as an instant, `away_score`/`home_score`, score presence vs. played status,
neutral-site flag, ESPN `venue_id`, stadium text where decidable, `time_valid`, and `gameday`.
Both directions were checked for missing rows. Third sources (Wikipedia game boxes citing NFL.com,
AP News and ESPN news) were used for every contested fact. The database was opened read-only
(`file:nfl.db?mode=ro`); nothing was modified.

Pro-Football-Reference is behind Cloudflare (HTTP 403) and nfl.com blurs scores in markup
(`data-testid="blurrable-score"` with empty content), so Wikipedia's `Americanfootballbox`
templates — which carry the local kickoff time, venue and citations — were the third source.

## Results

### Per-field agreement across all 4,648 rows

| Field | Checked | Agree | Differ |
|---|---:|---:|---:|
| `espn_event_id` resolves to an ESPN event | 4,648 | 4,648 | 0 |
| `season` | 4,648 | 4,648 | 0 |
| `season_type` (REG/POST; no preseason leak) | 4,648 | 4,648 | 0 |
| `week` / `playoff_round` | 4,648 | 4,648 | 0 |
| home franchise (ESPN franchise id) | 4,648 | 4,647 | 1 |
| away franchise (ESPN franchise id) | 4,648 | 4,647 | 1 |
| **home/away orientation (flip check)** | 4,648 | **4,648** | **0** |
| `kickoff_utc` (as an instant) | 4,648 | 4,608 | 40 |
| `away_score` | 4,363 | 4,362 | 1 |
| `home_score` | 4,363 | 4,362 | 1 |
| score presence vs. played status | 4,648 | 4,648 | 0 |
| neutral-site flag (`location`) | 4,648 | 4,622 | 26 |
| ESPN `venue_id` (where populated) | 4,648 | 4,648 | 0 |
| stadium text (where decidable) | 80 | 65 | 15 |
| `time_valid` | 4,648 | 4,648 | 0 |
| `gameday` (local calendar date) | 4,648 | 4,557 | 91 |

`venue_id` is NULL on 4,375 rows. That is **absent, not wrong** — the column is only populated for
the 273 ESPN-sourced 2026 rows. `stadium_text` is only decidable for the 80 games ESPN places away
from the home franchise's modal venue for that season; a blanket name comparison is meaningless
because ESPN retro-renames venues (see rule R3).

### No home/away flip anywhere

The check that matters most for downstream spreads: for every one of the 4,648 rows, the DB's
`home_franchise_id`/`away_franchise_id` pair matches ESPN's `homeAway` designation in the same
orientation. There is not a single silent swap. The one franchise disagreement (E1) is a wrong join
key, not an inverted matchup.

### No preseason leak, and the postseason mapping is correct

Every `espn_event_id` in the table resolves inside ESPN's `seasontype=2`/`seasontype=3` universe.
No row maps to a preseason event, and the kickoff-month distribution contains no August games
(Sep 917, Oct 1,082, Nov 1,051, Dec 1,174, Jan 407, Feb 17 — exactly one February game per season).

The week-numbering divergence the task warned about is real but the database already encodes it
correctly. **Established mapping:** ESPN `seasontype=3` week `1 -> WC`, `2 -> DIV`, `3 -> CON`,
`4 -> Pro Bowl (not a game; correctly absent from the DB)`, `5 -> SB`. I verified this against
ESPN's own `competitions[0].notes[0].headline` ("AFC Wild Card Playoffs", "Pro Bowl Games",
"Super Bowl LVIII") rather than trusting the week number, and the DB agrees on all 210 postseason
rows. Note `build_db.py`'s manifest calls ESPN postseason week 4 "the pre-Super-Bowl bye"; ESPN
labels it the Pro Bowl Games. Same slot, better name.

### Systematic differences (rules, not per-row defects) — 56 records

**R1 — ESPN's `neutralSite` flag is unpopulated before 2014 and for relocations. 16 rows.
The database is right; ESPN is wrong.** ESPN reports `neutralSite: false` for every neutral-site
game the DB flags before the 2014 season, and for every pandemic/disaster relocation in any season.
In all 16 cases ESPN's own `venue` data contradicts its own flag — the game is demonstrably not at
the home franchise's stadium:

| Game | DB | ESPN flag | ESPN venue |
|---|---|---|---|
| `2010_08_DEN_SF` | Neutral | false | Wembley Stadium (London, England) |
| `2010_14_NYG_MIN` | Neutral | false | Ford Field (Detroit) — Metrodome roof collapse |
| `2010_21_PIT_GB` | Neutral | false | AT&T Stadium (Arlington) — Super Bowl XLV |
| `2011_07_CHI_TB` | Neutral | false | Wembley Stadium (London, England) |
| `2011_21_NYG_NE` | Neutral | false | Lucas Oil Stadium — Super Bowl XLVI |
| `2012_08_NE_STL` | Neutral | false | Wembley Stadium (London, England) |
| `2012_21_BAL_SF` | Neutral | false | Caesars Superdome — Super Bowl XLVII |
| `2013_04_PIT_MIN` | Neutral | false | Wembley Stadium (London, England) |
| `2013_08_SF_JAX` | Neutral | false | Wembley Stadium (London, England) |
| `2013_13_ATL_BUF` | Neutral | false | Rogers Centre (Toronto, Canada) |
| `2013_21_SEA_DEN` | Neutral | false | MetLife Stadium — Super Bowl XLVIII |
| `2020_13_BUF_SF` | Neutral | false | State Farm Stadium (Glendale) — COVID relocation |
| `2020_14_WAS_SF` | Neutral | false | State Farm Stadium (Glendale) — COVID relocation |
| `2020_17_SEA_SF` | Neutral | false | State Farm Stadium (Glendale) — COVID relocation |
| `2021_01_GB_NO` | Neutral | false | EverBank Stadium (Jacksonville) — Hurricane Ida |
| `2024_19_MIN_LA` | Neutral | false | State Farm Stadium (Glendale) — LA wildfires |

From 2014 onward ESPN's flag is reliable: of the 77 rows the DB marks `Neutral`, ESPN agrees on 61
and disagrees on exactly these 16. **Do not backfill `location` from ESPN for seasons before 2014.**

**R2 — nflverse stores the scheduled slot, ESPN stores the observed kickoff. 32 rows.
Both are right under different definitions.** Every difference is under 90 minutes and none moves a
game's date, week, matchup or result. Confirmed by third source on the three largest:

| Game | DB (scheduled) | ESPN (observed) | Wikipedia |
|---|---|---|---|
| `2024_05_DAL_PIT` | `2024-10-07T00:20Z` (8:20pm ET) | `01:45Z` (9:45pm ET) | "scheduled for 8:20 p.m., but was postponed to 9:45 p.m. due to thunderstorms" (AP News cited) |
| `2018_01_ATL_PHI` | `2018-09-07T00:20Z` (8:20pm ET) | `00:55Z` (8:55pm ET) | time = 9:05 p.m. EDT (weather delay; all three sources differ on the exact restart) |
| `2021_04_LV_LAC` | `2021-10-05T00:15Z` (8:15pm ET) | `00:50Z` (8:50pm ET) | time = 5:15 p.m. PDT (= DB); article notes "After lightning delay" |

The remaining 29 differ by 60s–35min. Distribution of all 40 non-exact kickoffs, and which finding
each bucket belongs to:

| Bucket (\|espn − db\|) | Count | Belongs to |
|---|---:|---|
| exact −12h | 5 | defect E2 (all five London rows) |
| other (>1h, non-round) | 3 | defect E1 (11,700s), defect E3 `2016_02_TB_ARI` (11,100s), rule R2 `2024_05_DAL_PIT` (5,100s weather delay) |
| exact +1h | 1 | defect E3 `2014_01_SD_ARI` |
| ≤1h non-round | 22 | rule R2 |
| ≤5min | 5 | rule R2 |
| ≤60s | 4 | rule R2 (all four are Super Bowl / conference-final rows off by exactly 60s) |

**R3 — ESPN applies a venue's current name to historical games. 8 rows.
The database keeps the era-correct name, which is better.** `TCF Bank Stadium` /
`Huntington Bank Stadium`, `Cowboys Stadium` / `AT&T Stadium`, `Mercedes-Benz Superdome` /
`Caesars Superdome` (x2), `University of Phoenix Stadium` / `State Farm Stadium`,
`TIAA Bank Stadium` / `EverBank Stadium`, `Deutsche Bank Park` / `Frankfurt Stadium` (x2).
**Do not "correct" the `stadium` column from ESPN.**

### The 2026 season (285 unplayed rows)

Schedule, matchups, kickoff instants, venue ids and score-absence all verify against ESPN. All 285
rows correctly carry no scores; all 272 regular-season rows are `scheduled` and the 13 postseason
rows are `tbd`, matching ESPN's own TBD placeholders one-for-one. Two defects are 2026-specific: the
missing neutral-site flags (E4) and the `gameday` convention (E5).

### Games one source has and the other does not

Four ESPN events in the regular/post-season universe are not in the database. Three are correct:

| ESPN id | Game | ESPN status | Adjudication |
|---|---|---|---|
| `400554331` | 2014 wk12 NYJ @ BUF | `STATUS_POSTPONED` | Buffalo snowstorm. ESPN keeps both the abandoned original **and** the played game `400607990`, which the DB has (`2014_12_NYJ_BUF`, Ford Field, `location='Neutral'`). Correct. |
| `400951581` | 2017 wk1 TB @ MIA | `STATUS_POSTPONED` | Hurricane Irma. ESPN keeps both the abandoned original **and** the rescheduled week-11 game `400981391`, which the DB has (`2017_11_TB_MIA`, TB 30 MIA 20). Correct. |
| `401437947` | 2022 wk17 BUF @ CIN | `STATUS_CANCELED` | Abandoned after Damar Hamlin's cardiac arrest and never resumed. ESPN carries a cancelled shell with no result; nflverse omits the row. The DB therefore holds **271** regular-season games for 2022, and BUF and CIN are the only franchises in the whole 2010–2026 window with an off-nominal game count (16 instead of 17). Both representations are defensible; the DB's is the one a model should see. |

The fourth, `301114030`, is defect E1.

**No database row is missing from ESPN**, and no ESPN regular/post-season game other than the above
is missing from the database.

## Exceptions

120 defect records across **114 distinct game rows**. Every one has a named cause and evidence.

### E1 — `2010_10_HOU_JAX` carries another game's `espn_event_id` (1 row)

| | Value |
|---|---|
| DB `espn_event_id` | `301114022` |
| That ESPN event actually is | SEA 36 @ ARI 18, `2010-11-14T21:15Z`, State Farm Stadium |
| DB row's own facts | HOU 24 @ JAX 31, `2010-11-14T18:00Z`, EverBank Field |
| **Correct ESPN id** | **`301114030`** — ESPN confirms HOU 24 @ JAX 31, `2010-11-14T18:00Z` |

The DB row is right about the game; only the crosswalk key is wrong, so it drags four other fields
(both franchises, both scores) and the kickoff into false disagreement. This was known upstream —
`scripts/data/nfl-unified-2010-2026/build.py` documents it as gate G17, "espnEventId duplicates are
exactly the one documented upstream defect" — but the correct value was never established. It is
now, and it is derivable rather than guessed: ESPN's pre-2014 event ids encode
`3 + <last digit of year> + MM + DD + <3-digit home franchise id>`. **1,067 of 1,068 rows from
2010–2013 conform; the single violator is this row.** JAX is franchise 30, so the id must end `030`.

```sql
WITH x AS (SELECT game_id, espn_event_id,
  '3'||substr(gameday,4,1)||substr(gameday,6,2)||substr(gameday,9,2)
     ||substr('00'||home_franchise_id,-3) AS expected
  FROM game WHERE season<=2013)
SELECT * FROM x WHERE espn_event_id <> expected;
-- 2010_10_HOU_JAX|301114022|301114030
```

Because `espn_event_id` is indexed but not unique, this also means ESPN event `301114030` looks
"missing" from the DB while `301114022` is claimed twice. **Impact: any join to ESPN on this key
attributes the SEA@ARI game's data to HOU@JAX and double-counts the Cardinals game.**

### E2 — the 09:30 ET London slate is stored 12 hours late (5 rows)

`kickoff_utc` and `gametime_et` are 12 hours off, putting these games on the wrong UTC calendar day.
Three independent sources agree against the DB.

| Game | DB `kickoff_utc` / `gametime_et` | ESPN | Wikipedia (local) | Correct |
|---|---|---|---|---|
| `2017_03_BAL_JAX` | `2017-09-25T01:30Z` / `21:30` | `2017-09-24T13:30Z` | Sep 24, 2:30 p.m. BST, Wembley | `2017-09-24T13:30Z` |
| `2017_04_NO_MIA` | `2017-10-02T01:30Z` / `21:30` | `2017-10-01T13:30Z` | Oct 1, 2:30 p.m. BST, Wembley | `2017-10-01T13:30Z` |
| `2017_08_MIN_CLE` | `2017-10-30T01:30Z` / `21:30` | `2017-10-29T13:30Z` | Oct 29, 1:30 p.m. GMT, Twickenham | `2017-10-29T13:30Z` |
| `2018_07_TEN_LAC` | `2018-10-22T01:30Z` / `21:30` | `2018-10-21T13:30Z` | Oct 21, 6:30 a.m. PDT / 2:30 p.m. BST, Wembley | `2018-10-21T13:30Z` |
| `2018_08_PHI_JAX` | `2018-10-29T01:30Z` / `21:30` | `2018-10-28T13:30Z` | Oct 28, 1:30 p.m. GMT, Wembley | `2018-10-28T13:30Z` |

This is an AM/PM inversion confined to 2017–2018. **Every other international 09:30 ET game in
2014–2025 (30 of them) carries `gametime_et='09:30'` and the correct instant** — the corruption is
these five and only these five. Note `gameday` and `weekday` on these rows are *correct*, so each
row is internally self-contradictory: `weekday='Sunday'` with a `kickoff_utc` that lands on Monday.

**Impact: `away_rest`/`home_rest`, day-of-week features, and any date join are wrong for these five
games and for the games adjacent to them in each team's schedule.**

### E3 — two Arizona home games have the wrong kickoff (2 rows)

| Game | DB | ESPN | Wikipedia (local, Arizona is MST year-round) | Correct |
|---|---|---|---|---|
| `2016_02_TB_ARI` | `2016-09-18T17:00Z` (13:00 ET) | `2016-09-18T20:05Z` | Sep 18, **1:05 p.m.** MST = 16:05 ET | `20:05Z` |
| `2014_01_SD_ARI` | `2014-09-09T01:20Z` (21:20 ET) | `2014-09-09T02:20Z` | Sep 8, **7:20 p.m.** MST = 22:20 ET | `02:20Z` |

Wikipedia's local time converts to ESPN's UTC exactly in both cases. The DB's `2016_02_TB_ARI`
value is additionally impossible on its face: 13:00 ET is 10:00 a.m. in Arizona, and the NFL does
not schedule 10 a.m. local kickoffs. `2014_01_SD_ARI` was the nightcap of the week-1 Monday
doubleheader. These are the only two Arizona-home-game time errors in 4,648 rows — there is no
systematic Arizona timezone problem.

### E4 — 10 of the 2026 season's games are neutral-site but flagged `location='Home'`

The database's own `venue_id` column already points at the correct foreign stadium on every one of
these rows (the `venue_id` check passed 4,648/4,648); only `location` was never derived. Wikipedia,
citing NFL.com and ESPN.com announcements, independently confirms every venue.

| Game | Matchup | DB `location` | Actual venue |
|---|---|---|---|
| `2026_01_SF_LAR` | SF @ LAR | Home | Melbourne Cricket Ground, Melbourne, Australia |
| `2026_03_BAL_DAL` | BAL @ DAL | Home | Maracanã Stadium, Rio de Janeiro, Brazil |
| `2026_04_IND_WSH` | IND @ WSH | Home | Tottenham Hotspur Stadium, London |
| `2026_05_PHI_JAX` | PHI @ JAX | Home | Tottenham Hotspur Stadium, London |
| `2026_06_HOU_JAX` | HOU @ JAX | Home | Wembley Stadium, London |
| `2026_07_PIT_NO` | PIT @ NO | Home | Stade de France, Saint-Denis, France |
| `2026_09_CIN_ATL` | CIN @ ATL | Home | Santiago Bernabéu, Madrid, Spain |
| `2026_10_NE_DET` | NE @ DET | Home | FC Bayern Munich Stadium, Munich, Germany |
| `2026_11_MIN_SF` | MIN @ SF | Home | Estadio Banorte, Mexico City, Mexico |
| `2026_POST_SB_401873270` | Super Bowl LXI | Home | SoFi Stadium, Inglewood |

The 2026 season has **zero** rows with `location='Neutral'`, against 4–8 per season for 2010–2025.
The Super Bowl row is the clearest tell: a Super Bowl is neutral by definition, and it is the only
one of the 13 `tbd` postseason rows with `location` populated at all (the other 12 are NULL).

**Impact: this inverts home-field advantage on 10 games of the season the model will actually be
betting.**

### E5 — every 2026 row's `gameday` is the UTC date, not the local date (91 rows wrong)

All 285 ESPN-sourced 2026 rows have `gameday = substr(kickoff_utc,1,10)` — the UTC calendar date.
All 4,363 nflverse rows use the local calendar date (Eastern and Pacific coincide for every NFL
kickoff, so the finding does not depend on which convention CONTEXT.md's "derived in Pacific" means).

```sql
-- 2026: gameday is the UTC date on all 285 rows
SELECT count(*), sum(gameday = substr(kickoff_utc,1,10)) FROM game WHERE season=2026;
-- 285|285
-- nflverse: gameday is the local date on all 4,363 rows, and differs from the UTC date on 858
SELECT count(*), sum(gameday = date(kickoff_utc,'-5 hours')),
       sum(gameday = substr(kickoff_utc,1,10)) FROM game WHERE data_source='nflverse';
-- 4363|4363|3505
```

For the 194 afternoon kickoffs the two coincide. For the **91 evening kickoffs** (Thursday night,
Sunday night, Monday night, and the 36 flex-scheduled placeholder rows at `05:00Z`) `gameday` is one
day late. Full list in `cache/a1/out/a1_result.json` under `db_defects` where `field == "gameday_pt"`.

**Impact: date joins, rest calculations and any "games on date D" query are wrong for a third of the
2026 season.** The 36 rows at `05:00Z` are correctly flagged `time_valid = 0` (ESPN's `timeValid` is
`false` on exactly the same 36) — the placeholder is honest, but the derived date is still wrong.

### E6 — 7 of the 2025 international games record the home team's stadium, not the venue (7 rows)

`location='Neutral'` is correct on all seven; `stadium`, `stadium_id`, `roof` and `surface` are the
designated home team's.

| Game | DB `stadium` [`stadium_id`] | DB `roof`/`surface` | Actual venue (ESPN + Wikipedia) |
|---|---|---|---|
| `2025_01_KC_LAC` | SoFi Stadium [`LAX01`] | dome / — | Corinthians Arena, São Paulo, Brazil |
| `2025_04_MIN_PIT` | Acrisure Stadium [`PIT00`] | outdoors / grass | Croke Park, Dublin, Ireland |
| `2025_05_MIN_CLE` | FirstEnergy Stadium [`CLE00`] | outdoors / grass | Tottenham Hotspur Stadium, London |
| `2025_06_DEN_NYJ` | MetLife Stadium [`NYC01`] | outdoors / grass | Tottenham Hotspur Stadium, London |
| `2025_07_LA_JAX` | TIAA Bank Stadium [`JAX00`] | outdoors / grass | Wembley Stadium, London |
| `2025_10_ATL_IND` | Lucas Oil Stadium [`IND00`] | **closed** / grass | Olympiastadion, Berlin, Germany |
| `2025_11_WAS_MIA` | Hard Rock Stadium [`MIA00`] | outdoors / grass | Santiago Bernabéu, Madrid, Spain |

This is a 2025-only regression: the 2024 São Paulo and Munich games carry correct international
stadium codes (`SAO00`, `GER00`), as do every London/Mexico City/Frankfurt game from 2013 to 2024.

**Two secondary consequences, flagged rather than asserted:**
- `2025_10_ATL_IND` has `roof='closed'` (Lucas Oil) *and* populated `temp=46, wind=2`. Under the
  DB's own construction a closed-roof game has NULL weather. The weather is therefore probably
  Berlin's while the roof/surface/stadium are Indianapolis's — **mixed provenance within one row.**
- Five of the seven carry `temp`/`wind` attributed to a venue the game was not played at. I cannot
  determine from the available sources whether the values are the actual foreign-city weather with a
  stale venue label, or the home city's weather. **Recorded as unverifiable provenance, not as a
  proven wrong value** — but no model should consume these five weather readings until it is
  resolved.

### Contradiction (not silently resolved) — the Bills Toronto Series

Four games, same venue, same `stadium_id`, two different `location` values:

| Game | Season | Venue | `stadium_id` | DB `location` | ESPN `neutralSite` |
|---|---|---|---|---|---|
| `2010_09_CHI_BUF` | 2010 | Rogers Centre, Toronto | `BUF01` | **Home** | false |
| `2011_08_WAS_BUF` | 2011 | Rogers Centre, Toronto | `BUF01` | **Home** | false |
| `2012_15_SEA_BUF` | 2012 | Rogers Centre, Toronto | `BUF01` | **Home** | false |
| `2013_13_ATL_BUF` | 2013 | Rogers Centre, Toronto | `BUF01` | **Neutral** | false |

ESPN is no help — its flag is `false` for all four (rule R1). The database is internally
inconsistent: three of four out-of-country Bills home games are `Home` and the fourth is `Neutral`,
inherited from nflverse. Under the convention the rest of the table follows (out-of-market games
are Neutral, same-market substitutions such as `2010_15_CHI_MIN` at TCF Bank Stadium are Home) all
four should be Neutral. **Per CONTEXT.md rule 4 I am not picking a winner**: recorded as a
contradiction for the coordinator, with the note that Buffalo had no home-field advantage in any of
the four, so a modelling consumer should treat them identically whichever label is chosen.

## Reproduce

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai

# Full verification. Cache-first; re-fetches nothing that is already on disk.
# Exits 1 while confirmed defects remain — that is the gate.
python3 scripts/data/nfl-db/verify/a1_games_espn.py

# Cache-only re-run (no network at all), 0.47s:
python3 scripts/data/nfl-db/verify/a1_games_espn.py --no-network

# Machine-readable result, including every defect record, the venue table,
# and all 40 kickoff deltas:
#   scripts/data/nfl-db/cache/a1/out/a1_result.json

# --- individual claims ---

# E1: exactly one row violates ESPN's pre-2014 event-id encoding
sqlite3 scripts/data/nfl-db/nfl.db "
WITH x AS (SELECT game_id, espn_event_id,
  '3'||substr(gameday,4,1)||substr(gameday,6,2)||substr(gameday,9,2)
     ||substr('00'||home_franchise_id,-3) AS expected
  FROM game WHERE season<=2013)
SELECT count(*) total, sum(espn_event_id=expected) ok,
       sum(espn_event_id<>expected) bad FROM x;"        # 1068|1067|1

# E1: and ESPN says 301114030 is the real HOU@JAX
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=301114030" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); c=d['header']['competitions'][0]; \
print(c['date'], [(x['homeAway'], x['team']['abbreviation'], x['score']) for x in c['competitors']])"

# E2: every other international 09:30 ET game is stored correctly
sqlite3 scripts/data/nfl-db/nfl.db "
SELECT gametime_et, count(*) FROM game
WHERE location='Neutral' AND gametime_et IN ('09:30','21:30') GROUP BY 1;"   # 09:30|30  21:30|5

# E4: the 2026 season has no neutral-site games at all
sqlite3 scripts/data/nfl-db/nfl.db "
SELECT season, count(*) FROM game WHERE location='Neutral' GROUP BY 1 ORDER BY 1;"  # stops at 2025

# E5: 2026 gameday is the UTC date on all 285 rows
sqlite3 scripts/data/nfl-db/nfl.db "
SELECT count(*), sum(gameday = substr(kickoff_utc,1,10)) FROM game WHERE season=2026;"  # 285|285

# 2022 BUF/CIN are the only franchises with an off-nominal regular-season count
sqlite3 scripts/data/nfl-db/nfl.db "
WITH tg AS (SELECT season, home_franchise_id fid FROM game WHERE season_type='REG'
            UNION ALL SELECT season, away_franchise_id FROM game WHERE season_type='REG')
SELECT season, fid, count(*) n FROM tg GROUP BY 1,2
HAVING n <> (CASE WHEN season<=2020 THEN 16 ELSE 17 END);"                  # 2022|2|16, 2022|4|16
```

**Evidence on disk** (all under `scripts/data/nfl-db/cache/a1/`): 391 ESPN scoreboard slates in
`scoreboard/`, 14 `summary/` per-event fallbacks, 13 Wikipedia revisions in `thirdsource/`, and the
full result set in `out/a1_result.json`.

## What the coordinator must decide

1. **E1 is a one-line fix with a proven value** — set `2010_10_HOU_JAX.espn_event_id = '301114030'`.
   Gate G17 in `scripts/data/nfl-unified-2010-2026/build.py` asserts the duplicate still exists and
   will fail once it is fixed; that gate needs to be inverted, not the fix reverted.
2. **E4 and E5 both live in the 2026 ESPN loader**, not in the nflverse path — one fix each,
   affecting 10 and 91 rows.
3. **E6's weather values need a decision**, not a patch: either source the actual foreign-city
   weather or NULL the five readings. Fabricating either way would violate standing rule 1.
4. **The Bills Toronto contradiction needs a ruling** on what `location` means for out-of-country
   home games, applied to all four rows.
