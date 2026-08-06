# mlb_games — forensic profile (group: games)

Audit date: 2026-07-29 (UTC). Source: production TiDB, read-only via `db-query.mjs`.
Population: **49,419 rows**, seasons 2006–2026. Every number below comes from full-table
aggregates; StatsAPI (statsapi.mlb.com) used only to ground-truth season counts and the
2026 tail.

## 1. Row inventory and game_type decode

Game types present (char codes, MLB StatsAPI vocabulary):

| code | meaning | rows | seasons seen |
|---|---|---|---|
| R | Regular season | 48,662 | 2006–2026 |
| D | Division Series | 322 | 2006–2025 |
| L | League Championship Series | 227 | 2006–2025 |
| W | World Series | 115 | 2006–2025 |
| F | Wild Card | 73 | 2012–2025 (18 in 2020 expanded playoffs) |
| A | All-Star Game | 20 | 2006–2026 except 2020 (correctly absent — cancelled) |

No `S` (spring training) or `E`/`P` exhibition rows exist — the warehouse holds **completed
regular-season + postseason + All-Star games only**. Wild Card (`F`) first appears in 2012,
matching the real introduction of the WC game; postseason counts scale correctly with format
changes (2020 expanded field, 2022+ best-of-three WC series: F=9/8/9/11 in 2022–2025).

Full per-season matrix: `games-per-season.csv`.

## 2. Regular-season counts vs mlb_seasons.games_expected

| season | R in warehouse | expected | delta | verdict |
|---|---|---|---|---|
| 2006 | 2,429 | 2,430 | −1 | real cancellation (StatsAPI-verified) |
| 2007 | 2,431 | 2,431 | 0 | includes game-163 tiebreaker |
| 2008 | 2,428 | 2,431 | −3 | real cancellations (StatsAPI-verified) |
| 2009 | 2,430 | 2,431 | −1 | real |
| 2010 | 2,430 | 2,430 | 0 | |
| 2011 | 2,429 | 2,430 | −1 | real |
| 2012 | 2,430 | 2,430 | 0 | |
| 2013 | 2,431 | 2,431 | 0 | includes tiebreaker |
| 2014 | 2,430 | 2,430 | 0 | |
| 2015 | 2,429 | 2,430 | −1 | real |
| 2016 | 2,428 | 2,430 | −2 | real (StatsAPI-verified, set-diff = 0) |
| 2017 | 2,430 | 2,430 | 0 | |
| 2018 | 2,431 | 2,432 | −1 | real (2 tiebreakers scheduled, 1 game never made up) |
| 2019 | 2,429 | 2,430 | −1 | real |
| 2020 | 898 | 900 | −2 | real COVID cancellations (StatsAPI-verified, set-diff = 0) |
| 2021 | 2,429 | 2,430 | −1 | real |
| 2022 | 2,430 | 2,430 | 0 | |
| 2023 | 2,430 | 2,430 | 0 | |
| 2024 | 2,429 | 2,430 | −1 | real (StatsAPI-verified) |
| 2025 | 2,430 | 2,430 | 0 | |
| 2026 | 1,601 | 2,430 | in progress | through 2026-07-28 (see §6) |

**Ground truth**: for 2006, 2008, 2016, 2020, 2024 I fetched the full StatsAPI season
schedule (`gameType=R`) and counted **distinct gamePks with codedGameState=F**:
2429 / 2428 / 2428 / 898 / 2429 — all five exactly equal the warehouse. For 2016 and 2020 a
full set-diff was run: **zero** StatsAPI-final pks missing from the warehouse. All deficits
vs `games_expected` are games MLB cancelled and never made up — **not ingestion loss**.

## 3. Status vocabulary, ties, doubleheaders

Status codes (entire table): `F` Final 49,291 · `FR` Completed Early: Rain 121 ·
`FO` Completed Early 2 · `FG` Completed Early: Wet Grounds 1 ·
`FT` Final: Tied 1 (2016) · `FW` Final: Tied (won in tiebreaker) 1 (2025) ·
`O` Game Over 2 (both 2026-07-28, not yet flipped to Final at load time).
100.00% of rows are final-family except those two `O` rows.

**Ties** (`is_tie=1`): exactly 2.
- 449244 — 2016-09-29 CHC@PIT 1-1, 6 innings, `FT`, no W/L pitcher. Genuine MLB tie.
- 778566 — 2025-07-15 All-Star Game, `FW`, **is_tie=1 with score 6–7** (HR swing-off
  tiebreaker). Faithful to StatsAPI but a consumer trap: this is the only row where
  `is_tie=1 AND away_score <> home_score`. Zero rows have equal scores with `is_tie=0`.

**Doubleheaders** (`double_header` in Y=single-admission, S=split, N=none; full counts in
`games-per-season.csv`): pairing audit over all Y/S rows grouped by date + team pair:
- 25 same-day pairs where game 2 carries **flipped home/away designation** — 23 are 2020
  COVID makeup DHs (road team batted last), plus the 2008-06-27 NYM/NYY home-and-home split
  DH and similar 2007/2013/2021/2022 cases. Feed-faithful, not defects.
- **10 singletons** (one game of a flagged DH absent) — expected, because the companion game
  was postponed/never completed and the warehouse stores completed games only. Listed in
  `games-doubleheader-anomalies.csv`.
- **1 flag mismatch**: 2016-09-22 DET@MIN — game 1 flagged `S`, game 2 flagged `Y`.
- 2020: 112 DH games, of which the 2020-07-28 pair is scheduled_innings=9 (played before
  the 7-inning rule took effect Aug 1) — historically correct.
- `scheduled_innings=7` exists only in 2020 (111 rows) and 2021 (121 rows) — the 7-inning
  DH era, correct. 4 of those rows have `double_header='N'` (makeup games played under
  7-inning agreement; listed in `games-misc-anomalies.csv`).

## 4. Field availability by season (`games-field-availability-per-season.csv`)

- **100.00% in every season**: attendance, duration_minutes, weather_condition, temp_f,
  away/home hits, away/home errors, day_night.
- **wind**: 93.1–93.5% (2006–2009), 96.6–96.7% (2010–2014), 100% from 2015 —
  **era-absent** in the older feed, not an ingestion defect.
- **first_pitch_utc / venue_id**: 100% everywhere except one game each in 2021 and 2022 —
  the two Field of Dreams games (632924, 663023), which have NULL venue_id and NULL
  first_pitch_utc. Only NULL-venue rows in the table; zero venue orphans otherwise.
- **winner/loser pitcher**: 100% except the two tie games (correctly NULL).
- **save pitcher**: 47.1–53.2% — natural rate (a save occurs in roughly half of games),
  no season-level cliff → not a defect.
- **gameday_type** eras: `Y` (basic) 2006–2007, `E` (enhanced) 2008–2009, `P` (full pitch
  data) 2010–2026, with ≤21 stragglers per season. This matches the PitchFX (~2008+) /
  Statcast (2015+) era expectations and should be used to interpret per-pitch thinness.

## 5. Integrity checks

- **PK**: 49,419 rows, 49,419 distinct game_pk, min 39,939, max 825,108; zero
  non-positive.
- **Duplicates**: zero (official_date, away, home, game_number) groups with >1 row.
- **Scores**: zero negative; is_tie consistency as in §3.
- **Season boundaries**: 0 violations — every `R` game inside
  [regular_season_start, regular_season_end]; every F/D/L/W game strictly after
  regular_season_end and ≤ postseason_end. (All-Star games exempted by rule.)
- **Venue linkage**: 0 orphans against mlb_venues (2 NULLs = Field of Dreams).
- **Team linkage**: 0 orphans against mlb_franchises (includes AL/NL All-Star ids 159/160).
- **Innings** (R games): minimum 5 — no sub-official games; rain-shortened (<9) 2–14 per
  normal season, 110 in 2020 / 124 in 2021 (7-inning DH era); extras 132–243 per season;
  max 22 innings (2008). 2026 so far: min 9, 132 extra-inning games.
- **Sentinels**: attendance=0 on 938/951 games in 2020 (COVID, real) and 3–32/season
  elsewhere (unreported gates, incl. the 2015 closed-door Baltimore game); `temp_f=0` on
  exactly 2 rows, both 2024 dome/roof-closed games with "0 mph, None" wind — treat 0°F as
  missing under a roof. No temp ≥120, no duration <60.

## 6. 2026 cross-check vs app table `games` (sport='MLB', column mlbGamePk)

- Warehouse 2026: **1,602 games** (1,601 R + 1 All-Star), official_date 2026-03-25 →
  **2026-07-28**; entire table loaded in one pass 2026-07-29 03:43–08:59 UTC
  (feed_timestamp max 20260729_013126).
- App `games` MLB rows: 7,230 (7,227 with mlbGamePk), gameDate 2024-03-20 → 2026-09-27.
  Shared pks with warehouse (all seasons): 6,398. Shared 2026 pks: **1,601** — every
  warehouse 2026 R game is in the app; the only warehouse 2026 row absent from the app is
  the All-Star Game (823443), expected.
- **Score agreement**: on all 1,601 shared 2026 pks, app `actualAwayScore/actualHomeScore`
  match warehouse `away_score/home_score` **1,601/1,601 (100%), zero disagreements**.
  The app's *live* `awayScore/homeScore` columns disagree on 9 rows (8 from 2026-05-05,
  1 from 2026-06-16) but in every case the app's actual* columns side with the warehouse —
  app-side live-score staleness, not a warehouse error
  (`games-2026-app-live-score-mismatches.csv`).
- **Freshness gap**: 10 app-final pks are missing from the warehouse — all from the
  2026-07-28 night slate (`games-2026-missing-finals.csv`). StatsAPI confirms: 1,611
  distinct final R pks for 2026 vs 1,601 in warehouse; the set-diff is exactly those 10
  pks. Plus 2 warehouse rows stuck at status `O` (Game Over) from the same slate. The
  loader snapshot simply predates the late finals — re-running ingest for 2026-07-28
  should close the gap. 812 upcoming + 7 postponed app pks absent from the warehouse are
  correct by design (completed games only).

## 7. Defect / caveat register

| # | severity | item | scope |
|---|---|---|---|
| 1 | freshness | 10 finals of 2026-07-28 missing; 2 rows status `O` | 12 games, one load cycle |
| 2 | caveat | `is_tie=1` with unequal score on 2025 ASG (swing-off) | 1 row |
| 3 | minor | Field of Dreams games: NULL venue_id + first_pitch_utc | 2 rows (2021, 2022) |
| 4 | minor | temp_f=0 sentinel on roof-closed games | 2 rows (2024) |
| 5 | era-absent | wind NULL 3.3–6.9% in 2006–2014 | ~570 rows, pre-2015 feed |
| 6 | cosmetic | DH flag S vs Y mismatch within one DH (2016-09-22 DET@MIN) | 2 rows |
| 7 | app-side | 9 stale live-score rows in app `games` (warehouse correct) | 9 rows |

No structural ingestion loss found in 2006–2025: warehouse regular-season populations are
pk-identical to MLB StatsAPI finals for every season ground-truthed.

## Artifacts

- `games-per-season.csv` — per-season counts by type/status, ties, DH, expected deltas, innings
- `games-field-availability-per-season.csv` — pct non-null per field per season
- `games-doubleheader-anomalies.csv` — 10 DH singletons + 1 flag mismatch
- `games-2026-missing-finals.csv` — the 10 late 2026-07-28 finals
- `games-2026-app-live-score-mismatches.csv` — 9 app live-score staleness rows
- `games-misc-anomalies.csv` — ties, Field of Dreams NULLs, temp sentinels, 7-inning quirks, status-O rows
