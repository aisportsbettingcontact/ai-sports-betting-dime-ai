# Registries group — forensic profile (mlb_people, mlb_officials, mlb_franchises, mlb_venues)

Audit date: 2026-07-29. All claims below come from executed aggregates over the full population
(no sampling), via the read-only `db-query.mjs` runner. StatsAPI ground-truth fetches were used
for 3 games (824490, 40767, 632924/663023 venue lookups).

Season span observed in `mlb_games`: **2006-2026** (21 seasons; 2020 COVID-short at 951 games;
2026 in progress at 1,602 games as of the audit date).

---

## 1. mlb_people (6,425 rows)

### Referential integrity — zero orphans in every direction that matters

| Reference source | Distinct ids | Orphans (not in mlb_people) |
|---|---|---|
| `mlb_plays.batter_id` (3.77M rows) | 4,431 | **0** |
| `mlb_plays.pitcher_id` | 3,830 | **0** |
| `mlb_boxscore_batting.mlbam_id` (1.19M rows) | 5,292 | **0** |
| `mlb_boxscore_pitching.mlbam_id` (506K rows) | 3,830 | **0** |
| `mlb_officials.mlbam_id` (199,165 rows) | 181 | **0** |
| `mlb_games` winner/loser/save pitcher ids (49,417 / 49,417 / 24,889 non-null) | — | **0** |
| Union of all of the above | **6,317** | **0** |

### Is 6,425 sufficient for 21 seasons?

Yes — the registry is the **referenced-subset, not a full MLBAM universe dump**. It contains
exactly the 6,317 ids referenced anywhere in the warehouse (6,136 players + 181 umpires) plus
**108 unreferenced rows**. The 108 are *precisely* the set with `mlb_debut IS NULL`
(verified: unreferenced ∩ debut-null = 108 = both sets): 106 never-debuted minor-league
strays plus 2 pseudo-entities, **"American League" (814869)** and **"National League" (814870)**
(`primary_position='X'`), which are also the only 2 "players" missing
bat_side/pitch_hand/birth_date. Consequence: the registry is adequate for all historical joins,
but new call-ups must be appended by the same ingestion run that loads their first game or
future orphans will appear.

is_umpire flag coverage is exact: all 181 distinct official ids are flagged `is_umpire=1`,
no official is unflagged, and no non-official carries the flag (181 flagged total).
`active=1` on 2,397 people; `active` is NULL for all 181 umpires (minor inconsistency —
umpire rows carry no bio/status fields at all).

### Field fill rates (see registries-people-fill-rates.csv)

| Cohort | n | bat_side | pitch_hand | birth_date | mlb_debut | primary_position |
|---|---|---|---|---|---|---|
| Players (is_umpire=0) | 6,244 | 99.97% | 99.97% | 99.97% | 98.27% | 100% |
| Umpires (is_umpire=1) | 181 | 0% | 0% | 0% | 0% | 0% |
| Active 2025-26 (distinct in 2025-26 boxscores) | 1,721 | 100% | — | 100% | — | — |

Umpire zeros are expected (officials have no batting side); the only player-side gaps are the
2 league pseudo-rows and the 108 never-debuted (`mlb_debut` NULL).

### Crosswalks — DEFECT: 100% empty

`br_id`, `an_player_id`, `rotowire_id`, `retrosheet_id` are **NULL on all 6,425 rows** —
0% fill overall and 0% for the 1,721 players active in 2025-2026 (the ids the app needs).
The columns exist but were never populated by the load. This is an **ingestion defect
(or an unexecuted enrichment phase), not era-related** — it affects current players equally.

## 2. mlb_officials (199,165 rows)

### Position vocabulary (clean, 6 values)

Home Plate 49,419 · First Base 49,419 · Third Base 49,419 · Second Base 49,382 ·
Left Field 763 · Right Field 763. Zero duplicated positions within any game
(0 game+position pairs with count>1).

### Crew-size distribution (see registries-officials-by-season.tsv)

- **Every one of the 49,419 games has officials; HP umpire coverage is 100.00% in all 21 seasons.**
- 4-umpire crews: 49,239 games (99.64% of non-6-ump games); 3-umpire crews: 37 games total,
  scattered 0-6 per season 2006-2024 (injury/illness mid-series crews — ground-truthed
  game 40767 (2006-06-03) against StatsAPI: source also lists exactly 3 umpires, matching
  names/ids — **source-true, not ingestion loss**).
- 6-umpire crews: 763 games = **every postseason game** (F 73, D 322, L 227, W 115 — 100% of
  each type) + all 20 All-Star games + 6 regular-season special-event games. No 5-ump games.

### App cross-check (mlb_umpire_modifiers, 88 rows)

- 8 most recent final games' HP umpires all matched `mlb_umpire_modifiers` by **both**
  `umpireId` (= mlbam_id) and exact name including diacritics (e.g. Alfonso Márquez 427315,
  game 824490 — also ground-truthed against StatsAPI: identical 4-man crew).
- All 88 modifier rows join to `mlb_people` by id AND by full_name.
- Gap in the app table, not the warehouse: **8 of 95** distinct 2025-26 HP umpires have no
  modifier row (newer umpires: Tyler Jones 19 HP games, Dexter Kelley 17, Jen Pawol 17,
  Steven Jaschinski 14, Louie Krupa 8, Dillon Wilson 8, Felix Neon 6, David Arrieta 4) —
  see registries-umpire-modifier-gap.csv.

## 3. mlb_franchises (32 rows)

- **30 active clubs + the 2 extras: American League All-Stars (159) and National League
  All-Stars (160)** — both marked `active=1`, league set, division NULL. They are referenced
  by exactly 20 games, all `game_type='A'` (one ASG per season; none in 2020 — correct).
- League/division correctness: exactly 5 clubs in each of the 6 divisions, memberships match
  the current (2026) alignment, including Athletics (133, abbrev ATH) in AL West and
  Cleveland Guardians / AZ naming. **Caveat for modeling: the registry is current-state only**
  — 2006-2012 Astros games join to a row that says AL West, and `first_season`/`last_season`
  are NULL on all 32 rows, so no era-aware franchise history is possible from this table.
- Team-id coverage is a **perfect bijection**: 32 distinct team_ids across games home+away =
  32 franchise rows, 0 orphans either direction; boxscore team_ids (32) also fully covered.
- Crosswalk fill — DEFECT: `vsin_slug`, `an_slug`, `an_team_id`, `br_abbrev`, `mlb_code`,
  `an_logo_slug`, `db_slug` are **NULL on all 32 rows** (0%), same unexecuted-enrichment
  pattern as mlb_people.

## 4. mlb_venues (55 rows)

- Registry = referenced set, exactly: 55 distinct venue_ids used by games ↔ 55 rows,
  0 orphans both ways.
- **2 games have NULL venue_id**: 632924 (2021-08-12, CWS-NYY) and 663023 (2022-08-11,
  CIN-CHC) — the two **Field of Dreams games** (Dyersville). Ground-truthed: StatsAPI itself
  returns `venue: /api/v1/venues/null` for both — **source-absent, not an ingestion defect**.
- Composition (registries-venues-usage.tsv): 26 parks used in all/nearly-all 21 seasons;
  replaced-park lineage is clean and non-overlapping (Shea→Citi, Yankee I (9)→Yankee (3313),
  RFK→Nationals Park, Metrodome→Target Field, Turner→Truist, Ameriquest→Globe Life Field,
  Dolphin→loanDepot); relocation/temporary parks: McAfee Coliseum (Oakland, through 2024) →
  Sutter Health Park (Sacramento, 2025-26) + Las Vegas Ballpark (6 games, 2026);
  Tropicana out for 2025 (hurricane) with Steinbrenner Field (81 games, 2025 only), back 2026;
  COVID-era Sahlen Field (Buffalo 2020-21) and TD Ballpark (Dunedin 2021); international:
  Tokyo Dome, London Stadium, Estadio de Beisbol Monterrey, Estadio Alfredo Harp Helu,
  Hiram Bithorn, Sydney Cricket Ground, Gocheok Sky Dome; one-offs: Fort Bragg Field (2016),
  BB&T Ballpark Williamsport (8 Little League Classics), TD Ameritrade Park (2019),
  Rickwood Field (2024), Bristol Motor Speedway (2025).
- Names are a mixed-era snapshot (current names like "Daikin Park"/"Rate Field"/"UNIQLO Field
  at Dodger Stadium" beside period names like "McAfee Coliseum"/"Ameriquest Field") — cosmetic,
  but don't string-match on names.
- `active` flag: 46 active / 9 inactive; mildly stale — McAfee Coliseum (last used 2024) and
  Ameriquest Field (last used 2019) still `active=1`.
- Fill rates (n=55): roof_type 100%, turf_type 100%, timezone 100%, city 100%,
  capacity 96.4% (missing: Sydney Cricket Ground, Bristol Motor Speedway),
  state 90.9% (5 NULLs, all international: Tokyo, London, Mexico City, Sydney, Seoul).
  Dimensions: left_line/center/right_line 100%; left_center/right_center 83.6% (46/55);
  left_field 29.1% (16/55), right_field 23.6% (13/55) — the sparse intermediate wall points
  mirror StatsAPI `fieldInfo` sparsity (source-absent, not ingestion loss).

---

## Defect summary (ranked)

1. **mlb_people crosswalks 0% populated** (br_id/an_player_id/rotowire_id/retrosheet_id NULL on
   all 6,425 rows, including all 1,721 players active 2025-26). Blocks any join to
   Baseball-Reference / ActionNetwork / Rotowire / Retrosheet keyed data.
2. **mlb_franchises crosswalks + first/last_season 0% populated** (all 7 slug/id columns NULL
   on all 32 rows). Same enrichment phase apparently never ran.
3. mlb_franchises is current-alignment-only (pre-2013 Astros et al. historically mislabeled if
   division is read for old seasons).
4. mlb_umpire_modifiers (app table) missing 8 of 95 umpires who worked HP in 2025-26.
5. Cosmetic: 2 Field-of-Dreams games NULL venue (source-absent); venue `active` stale on 2 rows;
   mixed-era venue names; `mlb_people.active` NULL for umpires.

No referential-integrity defects found: 0 orphans across 11 full-population checks.

## Artifacts

- registries-report.md (this file)
- registries-orphan-checks.csv — all 15 full-population orphan/coverage checks
- registries-people-fill-rates.csv — field + crosswalk fill by cohort
- registries-people-unreferenced.tsv — the 108 unreferenced people rows
- registries-officials-by-season.tsv — per-season crew-size + HP coverage table
- registries-umpire-modifier-gap.csv — 8 HP umpires missing from the app modifiers table
- registries-franchises.tsv — full 32-row decode
- registries-venues-usage.tsv — full 55-row decode with per-venue season usage and dimensions
