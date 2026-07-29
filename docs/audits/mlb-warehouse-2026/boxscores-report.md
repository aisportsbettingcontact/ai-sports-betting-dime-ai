# Boxscores group — forensic profile (mlb_boxscore_batting + mlb_boxscore_pitching)

Audit date: 2026-07-29. Scope: all 49,419 games, seasons 2006-2026, production TiDB warehouse.
Method: every claim below is an executed aggregate over the full population (no sampling);
one game (490136) additionally ground-truthed against statsapi.mlb.com.

**Verdict: zero ingestion defects found.** Every anomaly in both tables traces to a verifiable
real-world event (ties, the 2025 All-Star swing-off, rain-called mid-inning games, catcher's
interference, the Danny Jansen two-team game). Internal consistency between the two boxscore
tables, mlb_games, and mlb_pitches is exact to the row.

## 1. Coverage

- **49,419 / 49,419 games have batting rows and pitching rows** (distinct game_pk in both
  tables = mlb_games row count). Zero-coverage games by season+type: **0 in every cell**
  (all 21 seasons x game types R/D/L/W/F/A) — see `boxscores-coverage-by-season-type.csv`.
- No orphan game_pks in either boxscore table (0 rows referencing games absent from mlb_games).
- 0 rows where team_id is not the game's away_team_id or home_team_id (both tables).
- Row totals: batting **1,186,159**, pitching **408,375**. (Task brief said ~506K for
  pitching; actual is 408,375 — the brief's figure appears stale, not the table.)
- Rows per game: batting 18–58 (mode 20; >45 rows only in All-Star games), pitching 2–25
  (mode 8; min 2 = both starters went the distance, 56 games). Distributions in
  `boxscores-rows-per-game-batting.csv` / `-pitching.csv`.
- Era shift, not a defect: avg batting rows/game is ~25.1 for 2006–2019 and 2021, ~21.0 in
  2020 and ~20.9 from 2022 on — the universal DH removed pitcher batting lines. Confirmed by
  position mix (`boxscores-position-mix-by-season.csv`): P batting rows ~10.5–11.4K/season
  pre-2020, 71 in 2020, ~150–235 in 2022+; DH rows ~2.6K → ~5.4K; PH rows ~4.0K → ~1.3K.

## 2. Reconciliation (core)

All per-season tables in the CSVs named below; headline numbers here.

| Check | Result |
|---|---|
| SUM(batting.r) by team vs mlb_games away/home_score | **1 mismatch / 49,419 games** (`boxscores-runs-reconciliation-by-season.csv`) |
| SUM(pitching.r) by team vs opponent score | same **1 game** (`boxscores-pitching-runs-er-reconciliation-by-season.csv`) |
| Team-game SUM(er) > SUM(r) | **0** |
| Row-level negatives; strikes > pitches | **0** |
| Batting SO vs opposing pitching SO (per team, per game) | **0 mismatches**, all seasons (`boxscores-so-hr-crosscheck-by-season.csv`) |
| Batting HR vs opposing pitching HR (per team, per game) | **0 mismatches**, all seasons |
| Batting H vs mlb_games away/home_hits AND vs opposing pitching H | **0 mismatches**; game hit columns never NULL (`boxscores-hits-reconciliation-by-season.csv`) |
| SUM(pitching.pitches) per season vs COUNT(mlb_pitches) | **exact equality every season** (ratio 1.0000; `boxscores-pitchcount-vs-pitch-table-by-season.csv`) |

The single run mismatch (exemplar list — only one exists in the whole warehouse, so 20 could
not be produced; `boxscores-run-mismatch-exemplars.csv`): **game 778566, 2025 All-Star Game
(FW "Final: Tied (won in tiebreaker)")** — official score 7–6 but both batting lines sum to 6
because the HR-swing-off tiebreaker run is not attributed to any player. Real-world scoring
quirk, correctly ingested.

**Outs vs innings** (`boxscores-outs-innings-by-season.csv`, walk-off-aware rule: home-pitcher
outs = innings*3; away-pitcher outs = innings*3 when home didn't win, else in
[(innings-1)*3, innings*3-1]):
- Home-pitcher side exact in 49,378/49,419 (99.92%); away side in-band in 49,355/49,419 (99.87%).
- **All 79 distinct deviant games carry early-completion/tie status codes**: 75 FR
  (Completed Early: Rain — ended mid-inning), 1 FG (wet grounds), 1 FO, 1 FT, 1 FW.
  **Zero deviants among the 49,291 status-F games.** Full list in
  `boxscores-outs-innings-deviant-games.csv`.

**batters_faced** vs opponent (ab+bb+hbp+sac_bunts+sac_flies) per team-game: exact in
97,894/98,838; +1 in 916 and +2 in 23 (catcher's interference — a PA with no AB/BB/HBP/sac;
~46 CI events/season implied, matching real MLB rates); −1 in 5 (0.005%). Ground truth: for
game 490136 StatsAPI's own battersFaced equals the warehouse value exactly, and StatsAPI's
official plateAppearances also differs from the naive component sum — an official-scoring edge
case, **not** an ingestion defect.

## 3. Flags

- **Exactly one win and one loss in 49,417/49,419 games.** The only 2 exceptions are the only
  2 tie games in the warehouse — 449244 (2016-09-29 CHC@PIT, FT "Final: Tied") and 778566
  (2025 ASG, FW) — both is_tie=1 with zero W/L flags, which is correct. No game has >1 win or
  >1 loss (`boxscores-winloss-flag-counts-by-season.csv`).
- **save ≤ 1 in every game** (0 violations). 24,889 save flags total.
- Win flag is never on the losing team's roster (0 violations).
- **W/L/save pitcher-id agreement with mlb_games is 100%**: all 49,417 win rows match
  winner_pitcher_id, all 49,417 loss rows match loser_pitcher_id, all 24,889 save rows match
  save_pitcher_id; no win/loss flag exists where the game-level id is NULL
  (`boxscores-winloss-id-agreement-by-season.csv`).

## 4. Semantics

- **batting_order** uses the MLB StatsAPI hundreds encoding: `slot*100 + substitution_sequence`
  (100 = starter batting 1st, 901 = first replacement in slot 9, …, max observed 917). Lineup
  completeness is perfect: each slot value X00 appears exactly **98,838** times = 2 teams x
  49,419 games (`boxscores-batting-order-values.csv`). Slot 9 has by far the deepest sub
  chains (pitcher slot in the pre-2022 NL). **28 rows (0.002%) have NULL batting_order** — all
  are position-P entries with all-zero batting lines (pitchers surfaced in the batters section
  without a lineup slot); benign, but consumers should tolerate NULL.
- **position vocabulary**: exactly 12 values, all standard — P, C, 1B, 2B, 3B, SS, LF, CF, RF,
  DH, PH, PR. No NULLs, no numeric codes, no generic OF/IF (`boxscores-position-vocabulary.csv`).
- **lob**: 0 NULLs in all 1,186,159 batting rows — no era pattern at all
  (`boxscores-batting-nullability-by-season.csv`).
- **pitches / strikes / hold** (pitching): 0 NULLs in all 408,375 rows in every season
  (`boxscores-pitching-nullability-by-season.csv`). Despite per-pitch *physics* being
  era-limited (PitchFX ~2008–2016, Statcast 2015+), boxscore pitch **counts** are complete
  back to 2006 and reconcile exactly with mlb_pitches row counts every season — so any
  thinness in old per-pitch data is era-absence, not boxscore ingestion loss.
- Player-on-both-teams: exactly **1** case in 21 seasons — Danny Jansen, game 746942
  (2024-06-26 TOR@BOS, suspended June 26, resumed Aug 26 after his trade; the first such event
  in MLB history). Real event, correctly captured under the game_pk+mlbam_id+team_id PK.

## Files

All in `docs/audits/mlb-warehouse-2026/` (this directory):
report `boxscores-report.md`; CSVs `boxscores-coverage-by-season-type.csv`,
`boxscores-rows-per-game-batting.csv`, `boxscores-rows-per-game-pitching.csv`,
`boxscores-runs-reconciliation-by-season.csv`, `boxscores-run-mismatch-exemplars.csv`,
`boxscores-pitching-runs-er-reconciliation-by-season.csv`,
`boxscores-outs-innings-by-season.csv`, `boxscores-outs-innings-deviant-games.csv`,
`boxscores-so-hr-crosscheck-by-season.csv`, `boxscores-hits-reconciliation-by-season.csv`,
`boxscores-winloss-flag-counts-by-season.csv`, `boxscores-winloss-id-agreement-by-season.csv`,
`boxscores-batting-nullability-by-season.csv`, `boxscores-pitching-nullability-by-season.csv`,
`boxscores-batting-order-values.csv`, `boxscores-position-vocabulary.csv`,
`boxscores-position-mix-by-season.csv`, `boxscores-pitchcount-vs-pitch-table-by-season.csv`.
