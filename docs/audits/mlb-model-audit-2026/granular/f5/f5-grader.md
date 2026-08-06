# F5 — GRADER: grading-integrity proof (granular 5x5 backtest)

Role: re-derive EVERY F5 grade from raw actuals; zero-mismatch or enumerate.
Window: all final 2026 regular-season games 2026-03-25..2026-07-24 (**population n=1,556**;
1,555 with `mlbGamePk`; the All-Star exhibition 4110001 is exempt per census EX-ALLSTAR).
Run: 2026-07-25T21:09:47Z. Every number below comes from a named, executed script; the whole
population was processed by code (no sampling except the StatsAPI external ground-truth, which
is explicitly permitted for that purpose only).

Scripts (in `granular/tools/`):
- `f5-grader-audit.mjs` — main pass: linescore cross-check (every game), games-column
  re-derivation (every game), `mlb_game_backtest` f5\_\* re-derivation (all 8,288 rows),
  `mlb_replay_grades` f5\_\* reconciliation (all 9,646 rows at snapshot).
- `f5-grader-statsapi-groundtruth.mjs` — external check: 5 disputed + 62 stratified games
  against MLB StatsAPI linescores (67 fetches).
- `f5-grader-truth-impact.mjs` — enumerates every stored grade on the 3 corrupt-actuals games
  against StatsAPI truth across all three stores.

Outputs (this directory): `f5-grader-games-rederivation.csv` (1,556),
`f5-grader-games-mismatches.csv` (13), `f5-grader-actuals-crosscheck-issues.csv` (8),
`f5-grader-line-plausibility.csv` (101), `f5-grader-backtest-rederivation.csv` (8,288),
`f5-grader-backtest-mismatches.csv` (1,685 — all WARN-class, see §C),
`f5-grader-backtest-uncovered-games.csv` (1 = ASG), `f5-grader-replay-grades-rederivation.csv`
(9,646), `f5-grader-replay-grades-mismatches.csv` (0), `f5-grader-statsapi-groundtruth.csv`
(67), `f5-grader-truth-impact.csv` (65), `f5-grader-summary.json`.

## Verdict in one paragraph

The F5 grading machinery is **arithmetically sound**: 100% of derivable stored grades in all
three stores reconcile with the raw actuals they were computed from — games columns
(1,536/1,536 f5Ml, 842/842 f5Rl, 1,298/1,298 brierF5Ml, 0 legacy-corrupt Briers), bet ledger
(2,002/2,002 actioned rows), replay ledger (9,646/9,646 rows, zero defects). The residue is a
**substrate defect, not a grading defect**: exactly 3 games (the D-011 doubleheader-twin score
swaps) still carry the twin's F5 scores in `games.actualF5AwayScore/actualF5HomeScore`
(StatsAPI-verified wrong), which poisons 8 stored grade values in `games` and 9 rows in
`mlb_replay_grades`; plus 7 orphan grade values on 2 games from the abandoned pre-M-101 writer
that the B6 regrade could not touch (missing model inputs). Fix the 3 substrate rows + null the
7 orphans and the F5 grading state is exactly zero-mismatch.

## A. Actuals substrate cross-check (every game — `f5-grader-audit.mjs`)

| Check | n |
|---|---|
| games.actualF5\* vs `mlb_replay_linescores` f5 sums — agree | 1,552 |
| — disagree | **3** |
| — linescore row missing | 1 (ASG only; substrate is 1,555/1,555 for real games) |
| games.actualF5\* missing | 1 (ASG only) |
| linescore gamePk vs games.mlbGamePk mismatch | 0 |
| actualF5Total vs actualF5Away+Home — agree | 1,550 |
| — disagree | **3** (same 3 games) |
| — actualF5Total NULL though scores present | 2 (3270003 HOU@BAL 4/30 G2, 3270004 SF@PHI 4/30 G2 — the B3b manual DH rows) |

External ground truth (`f5-grader-statsapi-groundtruth.mjs`, 67 games = 5 disputed + 62
stratified): `mlb_replay_linescores` agreed with StatsAPI **67/67**; `games.actualF5*` agreed
64/67, the 3 disagreements being exactly the disputed set:

| gameId | game | games.actualF5 | StatsAPI/linescores truth | actualF5Total |
|---|---|---|---|---|
| 2250733 | STL@CIN 2026-05-23 G2 (pk 824516) | 3-1 | **1-5** | 6 = correct |
| 2250738 | DET@BAL 2026-05-24 G1 (pk 824839) | 4-1 | **2-0** | 2 = correct |
| 2251290 | MIL@STL 2026-07-07 G2 (pk 823035) | 2-3 | **3-0** | 3 = correct |

These are the same 3 games whose FG scores were corrected in remediation B3 (finding D-011:
final rows held the DH twin's score). The FG fix and the B4 `actualF5Total` fill landed, but
**`actualF5AwayScore`/`actualF5HomeScore` still hold the twin's F5 split** — the games rows are
now internally inconsistent (total ≠ away+home on exactly these 3 rows).

**DEFECT F5-G1 (P1)** — 3 games with DH-twin F5 scores in `actualF5AwayScore/HomeScore`
(StatsAPI-verified). Downstream impact enumerated in §E.
**DEFECT F5-G4 (P3)** — 2 games with derivable-but-NULL `actualF5Total`.

## B. `games` grade columns re-derived from raw actuals (every game)

Method: canonical rules from `server/mlbOutcomeIngestor.ts` (M-101 forward path) and the B6/B6b
audit regrade — both writer conventions computed where they differ; a stored value matching
either counts as match and the convention is recorded per row.

| Column | match | mismatch | both-null | stored-null-derivable | stored-not-derivable |
|---|---|---|---|---|---|
| f5MlResult | 1,536 | 0 | 19 | 0 | **1** (2250006) |
| f5RlResult | 842 | 0 | 712 | 0 | **2** (2250006, 2250068) |
| f5TotalResult | 842 | 2* | 712 | 0 | 0 |
| brierF5Ml | 1,298 | 0 | 258 | 0 | 0 |
| brierF5Total | 841 | 2* | 713 | 0 | 0 |

\* The 4 starred "mismatches" (f5TotalResult + brierF5Total on 2250733 and 2250738) are cases
where the **stored value is right and the naive re-derivation from
actualF5Away+Home is wrong**: B6 graded totals from `actualF5Total` (which matches StatsAPI)
while the away/home columns hold the twin's scores (F5-G1). Verified via
`f5-grader-truth-impact.mjs`.

Companion `*Correct` columns: f5MlCorrect 1 mismatch, f5RlCorrect 2, f5TotalCorrect 3 — every
one of them is either an F5-G1 game or an orphan row below; zero independent errors.

Push/vocabulary/scale checks, all clean:
- F5 ML ties → result PUSH, correct NULL: 238 pushes stored, 1,537−1,299=238 ✓ (15.5% tie rate).
- f5TotalResult vocabulary: 0 rows left in legacy WIN/LOSS domain (B6b conversion complete);
  0 PUSH rows stored and 0 derivable (all 845 graded book F5 totals are half-lines).
- brierF5Total: **0 rows match the legacy /100 corrupted formula (M-203/F-3)** — the garbage-
  Brier era is fully eradicated from the window.
- `f5BacktestRunAt` present on every row carrying any F5 grade (0 missing).

**DEFECT F5-G2 (P2) — orphan pre-M-101 grades survive on 2 games.**
2250006 (NYY@SF 2026-03-25, F5 7-0): `f5MlResult=WIN, f5MlCorrect=1, f5RlResult=WIN,
f5RlCorrect=1, f5TotalCorrect=1` with **all model F5 columns NULL** — nothing to grade; the
values follow the abandoned fixed-away-side rule (away won the F5) documented in M-101.
2250068 (COL@TOR 2026-03-31): `f5RlResult=WIN, f5RlCorrect=1` with **f5AwayRunLine NULL** — an
RL grade with no line. B6 regraded only derivable rows, so these 7 stale values persist and
pollute any `f5*Correct` aggregate. Recommendation: NULL them.

**FINDING F5-G5 (P2) — the two live writer conventions disagree on 59% of RL picks.**
Stored f5Rl grades match the B6 convention (pick from `modelF5AwayRLCoverPct>50`) on all 842
rows: 502 match it exclusively, 340 match both conventions, **0 match only the production
ingestor's margin convention** (pick from modelF5Away−Home margin + f5AwayRunLine). But the two
conventions produce **different results on 498/842 games (59.1%)** — the tie-excluded RL cover
probability picks AWAY far less often than the margin rule does on +0.5 lines. When the
production forward path (`mlbOutcomeIngestor.gradeRunLinePick`, margin-based) grades future
games, the stored `f5Rl*` series will silently switch definition mid-stream. Pick one
convention (the probability the model actually publishes seems the defensible one) and align
`mlbOutcomeIngestor` with it.

**FINDING F5-G6 (P2) — brierF5Ml is 100% away-base today, but the forward path writes
home-base.** All 1,298 stored values match the B6 away-base formula ((pAway−yAway)², 0 match
home-base). The production ingestor computes (pHome−yHome)². For F5 these are NOT
interchangeable: the stored win pcts are push-inclusive and sum to ≈85, so away-base and
home-base Briers differ row by row (e.g. 2250733: 0.2604 away-base vs a different home-base
value). First nightly ingest after a final will start a mixed-definition Brier series.
Align the ingestor to away-base or regrade-declare home-base.

## C. `mlb_game_backtest` f5\_\* bet ledger (all rows — `f5-grader-audit.mjs`)

8,288 rows across f5_ml_home/away (1,555 each), f5_rl_home/away (1,555 each), f5_over/f5_under
(1,034 each). Result mix: WIN 942, LOSS 973, PUSH 87, NO_ACTION 4,196, QUARANTINED 1,948,
MISSING_DATA 118, VOID 24. Coverage: 1,555/1,556 population games have rows (ASG exempt),
0 games partially covered on ML/RL, 0 duplicate (gameId, market) pairs.

**Grading re-derivation: 0 defects on 2,002 actioned rows** — every stored WIN/LOSS/PUSH and
its `correct` flag reproduces from `games.actualF5*` given the row's recorded line. Three
writer eras coexist and require different line handling (all honored):
- live writer + `audit-backfill-20260725`: hardcoded home −0.5 / away +0.5, margin rule
  (tie ⇒ home LOSS / away WIN);
- `v2026-full-audit-1.0`: records the **real FD line per side** (signs vary; alt lines
  −5.5..+5.5 present) and grades against it. A first-pass derivation that assumed the hardcoded
  convention produced 43 false mismatches — corrected; the final rule grades each row against
  its own `bookLine` (fallback to the canonical ±0.5), after which stored results are
  100% consistent.
- Push handling: 87 PUSHes are all f5_ml ties (42 home + 45 away); RL rows have 0 pushes (all
  lines half-valued) ✓.

Conventions recorded, not defects (all confined to auditVersion `v2026-full-audit-1.0`, which
by design grades every row and stores actionability separately): 1,333 actioned rows with
`confidencePassed=0`, 352 NO_ACTION with `confidencePassed=1`. Threshold-consistency
(informational, thresholds changed over time): 1,469 rows would flip actioned/NO_ACTION under
today's rules (edge≥0.05 ML/RL, p≥0.60 totals). All 1,948 QUARANTINED and 24 VOID rows carry
reasons (0 missing). **INFO**: 114 MISSING_DATA rows are now derivable from present actuals
(backfill candidates); the 4 non-derivable ones are f5_over/under on 2 games with no F5 total
line (2250996, 2251100).

On the 3 F5-G1 games the bet ledger is **unharmed**: 15 of their 18 f5 rows are not actioned
(quarantined/no-action) and the 1 actioned row is correct vs StatsAPI truth
(`f5-grader-truth-impact.mjs`).

## D. `mlb_replay_grades` f5\_\* unified ledger (snapshot — pipeline was running)

Snapshot at 2026-07-25T21:09Z (recorded in `f5-grader-summary.json`): f5_ml 1,527 live /
1,545 p1 / 1,545 p2; f5_rl 837 / 838 / 838; f5_total 838 / 839 / 839 — 9,646 rows, versions
`live`, `wf-19288f01-p1`, `wf-19288f01-p2` (no `-p2d` yet at run time). 0 duplicate
(gameId, market, source, modelVersion) keys.

**Reconciliation: 9,646/9,646 rows internally consistent — 0 defects.** Verified per row:
actual-side field (incl. the TIE encoding for f5_ml pushes and numeric actual for f5_total),
result/correct from stored pick vs raw actuals, Brier = (prob−y)² to 6dp (null on push),
pick↔prob coherence (pick = side of 0.5), f5_total signedError = projValue − actual to 3dp, and
for the whole `live_pregame` series a full re-derivation of prob/line/projValue from the games
row (`modelF5AwayWinPct/100`, `modelF5AwayRLCoverPct/100`, `modelF5OverRate` unit-scale,
`f5AwayRunLine`, `f5Total`, `modelF5Total`) — all consistent.

Truth overlay (F5-G1): because the replay grader reads `games.actualF5AwayScore/HomeScore`
first, **9 rows are wrong against StatsAPI truth** — 2250733 f5_ml+f5_rl × (live, p1, p2) = 6
rows, 2251290 f5_ml × 3 = 3 rows (2250738's grades survive by coincidence: away won under both
the twin's and the true score). f5_total rows are all correct (grader prefers `actualF5Total`).
Exact ids in `f5-grader-truth-impact.csv`. These self-heal on regrade once F5-G1 is fixed.

Coverage note (snapshot, not a defect — pipeline live): 10 model-bearing games lacked a
live-source f5_ml row, including the ASG and both DH-twin partners of the F5-G1 games
(ids in run log: 2250103, 2250376, 2250506, 2250508, 2250710, 2250726, 2251041, 2251100,
2251321, 4110001).

## E. Consolidated defect ledger

| # | Sev | Defect | Exact scope |
|---|---|---|---|
| F5-G1 | P1 | `games.actualF5AwayScore/HomeScore` hold the DH-twin's F5 scores on 3 games (D-011 residue; StatsAPI-verified) | 6 wrong actuals values → 8 wrong stored grades in `games` (2250733: f5MlResult LOSS→WIN, f5MlCorrect 0→1, brierF5Ml 0.260406→0.239806, f5RlResult WIN→LOSS, f5RlCorrect 1→0; 2251290: f5MlResult WIN→LOSS, f5MlCorrect 1→0, brierF5Ml 0.241769→0.258369) + 9 wrong `mlb_replay_grades` rows; bet ledger unaffected |
| F5-G2 | P2 | Orphan pre-M-101 grades with NULL inputs survived B6 | 7 values on 2 games (2250006: 5 values incl. f5MlResult=WIN w/o any model; 2250068: f5RlResult/Correct w/o a line) |
| F5-G5 | P2 | RL pick convention split: stored series is 100% B6 prob-convention; production forward path uses margin-convention which differs on 498/842 games (59.1%) | future `f5Rl*` writes change definition silently |
| F5-G6 | P2 | brierF5Ml base split: stored 1,298/1,298 away-base; forward path writes home-base; bases are not interchangeable for F5 (win pcts sum ≈85, push-inclusive) | future `brierF5Ml` writes change definition silently |
| F5-G3 | P2 | F5 book-line contamination: 73 games carry `f5AwayRunLine` ≠ ±0.5 (26 at \|line\|≥2.5) and 35 games carry `f5Total` outside [3,7] (11 at ≤1.5 — first-inning-like; 8 at ≥8.5 — full-game-like). Grades are consistent *with the stored line*, but for the near-certain-contaminated subset the line is not an F5 market, so those grades are economically meaningless. 101 games enumerated in `f5-grader-line-plausibility.csv` | affects up to 844 graded f5Rl/f5Total rows' interpretation; scraper-side root cause (ActionNetwork period extraction) is the ingestion agent's lane |
| F5-G4 | P3 | `actualF5Total` NULL though F5 scores present (StatsAPI-verified derivable) | 2 games (3270003, 3270004) |
| — | INFO | 114 MISSING_DATA bet-ledger rows now derivable; 4 legitimately underivable (no line) | backfill candidates |

## F. Recommendations

1. Patch the 3 F5-G1 rows from `mlb_replay_linescores` (already StatsAPI-exact) and regrade
   those games' F5 columns + replay rows (17 values self-correct).
2. NULL the 7 F5-G2 orphan values (or regrade-declare them exempt) so `f5*Correct` aggregates
   are pure.
3. Before the next nightly ingest touches a final, align `mlbOutcomeIngestor` with the stored
   conventions (F5-G5 RL pick, F5-G6 Brier base) — otherwise both series become
   mixed-definition on day one.
4. Fill the 2 F5-G4 totals; backfill the 114 derivable MISSING_DATA ledger rows.
5. Treat the F5-G3 contaminated-line subset as void for any F5 performance claims (hand to
   ingestion/assessor lanes for scraper fix + line re-validation against an odds archive).
