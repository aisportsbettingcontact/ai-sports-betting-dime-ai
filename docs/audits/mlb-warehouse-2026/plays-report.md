# mlb_plays forensic profile (group: plays)

Warehouse: production TiDB, 21 seasons (2006-2026). Table `mlb_plays`, 3,767,228 rows,
PK (`game_pk`, `at_bat_index`), joined to `mlb_games` (49,419 games) for season context.
Every claim below comes from an executed aggregate over the full population; StatsAPI
spot-checks are illustration on top of aggregates, not substitutes.

## Verdict

`mlb_plays` is in exceptional shape. Zero zero-play games, zero at_bat_index continuity
breaks, zero inning/half monotonicity violations, 100.000% pitch_count reconciliation
against `mlb_pitches` in every season, exactly one final-score mismatch (the 2025
All-Star swing-off, a real-world quirk), and 11 impossible ball/strike counts that are
verifiably inherited from the upstream MLB feed. No ingestion defects found.

## 1. Per-season volume and plays/game

Full table: `plays-per-season.csv`. Highlights:

| Season | Games | Plays | Plays/game |
|---|---|---|---|
| 2006 | 2,460 | 190,792 | 77.56 |
| 2013 | 2,470 | 188,105 | 76.16 |
| 2020 | 951 | 70,667 | 74.31 |
| 2023 | 2,472 | 187,676 | 75.92 |
| 2026 (in progress) | 1,602 | 121,518 | 75.85 |

- Every season lands 74.3-77.8 plays/game — inside the ~75-80 PA/game sanity band.
  The mild secular decline (77.6 in 2006 → ~75.5 in the 2020s) matches the real-league
  strikeout/offense era shift, not data loss.
- 2020 has 951 games (COVID-shortened season) and 2026 is the in-progress season
  (1,602 games loaded through late July) — both era-expected, not defects.
- Per game_type distribution (`plays-distribution-by-season-type.csv`): regular-season
  min play counts of 37-54 are all rain/other-shortened finals (status `FR`/`FT`,
  5-6 innings; e.g. game 382057, 2014, 5 innings, 37 plays); maxes of 135-168 are
  extra-inning games. Nothing anomalous.

**Zero-play games: NONE.** Anti-join of all 49,419 `mlb_games` rows against `mlb_plays`
returns zero games in every season and game_type (`plays-zero-play-games.csv` is
intentionally empty). No era gap and no defect — even 2006 games carry full play-by-play.

**at_bat_index continuity: PERFECT.** For all 49,419 games, MIN(at_bat_index)=0 and
MAX(at_bat_index)+1 = COUNT(*) — zero offenders (`plays-index-continuity-mismatches.csv`
intentionally empty).

## 2. event_type vocabulary

50 distinct values (`plays-event-type-frequency.csv`; per-season long format in
`plays-event-type-by-season.csv`). Top of table: field_out 1,536,051; strikeout 769,761;
single 556,918; walk 295,263; double 168,866; home_run 108,081.

Drift analysis (first/last season per type):

- All 29 event types with >=76 occurrences span all 21 seasons continuously — no
  vocabulary appearing or vanishing mid-archive.
- The only genuinely era-bound types are `game_advisory` (2017+, 16 rows — StatsAPI
  added this administrative event type; era-absent before 2017, not a defect) and
  `unknown` (2006-2015 only, 17 rows — a legacy-era scoring artifact that MLB stopped
  emitting).
- Every other presence gap tracks pure rarity, not ingestion: e.g. `pickoff_error_2b`
  (1 row ever), `stolen_base_home` (1), `strikeout_triple_play` (1),
  `defensive_substitution` (1), `ejection` (2). Stolen-base/caught-stealing play-result
  types are rare by design — in StatsAPI these usually live in playEvents, and only
  odd/inning-ending cases surface as the play result.

## 3. State integrity

**Final-play score vs mlb_games final score: 1 mismatch in 49,419 games.**
Per-season counts in `plays-score-mismatches.csv` companion (`score` column of the
report table below is exhaustive: all seasons 0 except 2025 = 1). The single mismatch
is game_pk 778566, the 2025 All-Star Game (`status_code FW`, "Final: Tied (won in
tiebreaker)"): play-by-play correctly ends 6-6; `mlb_games` records 7 for the home team
from the swing-off tiebreaker. Real-world quirk, not a defect. There is no "20 worst"
list because there is only one mismatch (abs diff 1).

**Inning/half monotonicity: 0 violations** across all 3,767,228 plays (window-function
LAG scan per game ordered by at_bat_index; a violation = inning decreasing, or half
going bottom→top within the same inning). `plays-inning-monotonicity-violations.csv`
intentionally empty. `half` is exactly {top: 1,920,640; bottom: 1,846,588} — no NULLs,
no third value.

**outs_end: fully within 0-3, no NULLs.** Distribution: 0 → 422,886; 1 → 1,253,850;
2 → 1,212,162; 3 → 878,330 (sums to full row count).

**balls_end/strikes_end (bonus check):** 10 plays have balls_end=5 and 1 play has
strikes_end=4 — impossible counts (`plays-impossible-count-rows.csv`). Verified against
statsapi.mlb.com for game 40737 ab 56: the upstream feed itself carries
`count: {balls: 5, strikes: 2}` on that walk. These 11 rows (0.0003% of the table) are
**source-inherited scorer errors faithfully ingested**, not pipeline defects. Spread
2006-2025, so no era pattern.

**pitch_count vs mlb_pitches: 100.000% in every season.** For all 3,767,228
(game_pk, at_bat_index) pairs, `mlb_plays.pitch_count` equals the count of
`is_pitch=1` rows in `mlb_pitches` — zero over, zero under, zero plays with a positive
pitch_count and no pitch rows (`plays-pitchcount-match-by-season.csv`). The two tables
were evidently loaded from the same feed atomically. (Note: this is internal
consistency; per-pitch physics-field coverage by era is the pitches group's scope.)

## 4. runners JSON

- **Coverage:** 100.00% of plays in every season have non-NULL `runners`; only 37 rows
  across 21 seasons hold an empty array, and per full aggregate every one of them is an
  administrative event (exact split: `unknown` 17, `game_advisory` 13,
  `pitching_substitution` 6, `defensive_substitution` 1), i.e. plays with no batter
  outcome. Expected.
- **Average entries per play:** 1.34-1.38, stable across all seasons
  (`plays-runners-by-season.csv`).
- **Shape:** a full-population GROUP BY over JSON_KEYS of the first array element
  returns exactly one key-set for all 3,767,191 non-empty plays:
  `{earned, end, id, out, rbi, start}` — a flattened normalization of StatsAPI's
  runner objects (movement/details/credits collapsed). Sample entry:
  `{"id": 606466, "start": "1B", "end": "2B", "out": false, "rbi": false, "earned": false}`;
  batter-out entries use `start: null, end: null, out: true`. Uniform schema, no drift.

## 5. Ground-truth spot checks (illustration)

| game_pk | Season | Warehouse | StatsAPI | Match |
|---|---|---|---|---|
| 39939 | 2006 | 76 plays; last-play score 4-10 | 76 allPlays; 4-10 | yes |
| 825108 | 2026 | 83 plays; SUM(pitch_count)=342; last-play 6-9 | 83 allPlays; 342 isPitch events; 6-9 | yes |
| 40737 ab 56 | 2006 | walk, balls_end=5 | upstream also balls=5 | source-inherited |

## Deliverables

All in this directory, prefixed `plays-`:
- `plays-report.md` (this file)
- `plays-per-season.csv` — season, games, plays, plays/game
- `plays-distribution-by-season-type.csv` — min/avg/max/sd plays per game by season+game_type
- `plays-event-type-frequency.csv` / `plays-event-type-by-season.csv`
- `plays-score-mismatches.csv` (1 row, classified)
- `plays-index-continuity-mismatches.csv`, `plays-zero-play-games.csv`,
  `plays-inning-monotonicity-violations.csv` (verified-empty populations)
- `plays-impossible-count-rows.csv` (11 rows, classified source-inherited)
- `plays-pitchcount-match-by-season.csv`, `plays-runners-by-season.csv`
