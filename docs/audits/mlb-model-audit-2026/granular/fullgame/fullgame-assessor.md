# Full-Game ASSESSOR — Residual Structure Hunt (every 2026 final)

Role: ASSESSOR, fullgame market group, 5x5 granular season backtest. Question: **where does the
model still miss and why** — signed total error (projection − actual) and moneyline Brier, sliced
seven ways over the entire population, live series vs replay p1 (raw fixed model) vs replay p2
(monthly walk-forward calibrated).

Every number below comes from a named script run this session (2026-07-25):

| Script (granular/tools/) | Invocation | Output |
|---|---|---|
| `fullgame-assessor-extract.sh` | `bash fullgame-assessor-extract.sh <data-dir>` | full-population JSON dumps via read-only `db-query.mjs` |
| `fullgame-assessor-analyze.py` | `venv/bin/python fullgame-assessor-analyze.py <data-dir> granular/fullgame census/game-universe.csv` | all CSVs + summary JSON, headline/slice/worst-50 numbers |
| `fullgame-assessor-followups.py` | `venv/bin/python fullgame-assessor-followups.py fullgame-assessor-per-game.csv` | venue splits, away-fav persistence, COL probe, hand CIs (`fullgame-assessor-followups.txt`) |
| `fullgame-assessor-groundtruth.py` | `venv/bin/python fullgame-assessor-groundtruth.py fullgame-assessor-per-game.csv 35` | external StatsAPI sample check |
| `fullgame-assessor-mdtable.py` | `python3 fullgame-assessor-mdtable.py fullgame-assessor-flagged-slices.csv` | flagged-slice table below |

## Population accounting (exhaustive by construction)

- `games` finals 2026-03-25..2026-07-24: **1,556**. Exempt: AL@NL 2026-07-14 (All-Star, no
  `mlbGamePk`). **Analyzed: 1,555** — every one processed by `fullgame-assessor-analyze.py`
  into `fullgame-assessor-per-game.csv` (one row per game).
- Replay series at run time: `mlb_replay_projections` had `wf-19288f01-p1` = 1,555 and
  `wf-19288f01-p2` = 1,555 rows (all with `projTotal` and `pAwayMl`); **no `-p2d` rows existed
  yet**. `mlb_replay_grades` was **EMPTY** when this run executed (~13:45 local) — the grading
  pipeline had not written; per protocol this is context, not a defect. All replay grading here
  is re-derived directly from `mlb_replay_projections`.
- Integrity: `games.actual*` vs `mlb_replay_linescores` finals — **0 mismatches / 1,555**.
  External ground truth: stride-35 sample of 45 games vs MLB StatsAPI — **45/45 exact score
  match** (`fullgame-assessor-groundtruth.py`).
- Live-series coverage inside the population: ML probability (`modelAwayWinPct`) on 1,536 games;
  pure projected total (`modelProjTotal`) on 947; grading-rule total (`modelProjTotal ??
  modelTotal`) on 1,537 — the 590-game fallback uses the **book line** as "projection"
  (see D-6). 346/1,555 games (22.2%) are provenance-quarantined (`modelRunAt` ≥ first pitch;
  33 more undetermined for lack of a schedule link) — larger than the 286 in GRADING-REPORT
  because that count was over its enrolled subset. Sensitivity: excluding quarantined rows,
  live-rule bias = −0.463 [−0.716, −0.210] (n=1,191), Brier 0.2480 (n=1,190) — all headline
  conclusions survive.

## Grading rules

Signed total error = projection − actual total (negative = model too low). Live P(away) =
`modelAwayWinPct`/100; replay = `pAwayMl`. Brier on away-win indicator. Slices: month, park
(home team), day/night at **venue-local** hour (<17:00 = day; grade-season.mjs had used ET —
this report's classification is corrected), favorite side from book ML (games row, DK closing,
DK pregame fallback), total-line bucket (<8 / 8–9 / >9), starter-handedness pair (away-hand →
home-hand, from `mlb_replay_linescores`, 94 games unknown), and team (each game counted for
both participants). Flag rule per task spec: n ≥ 40 AND (bias 95% CI excludes 0 OR |slice
Brier − series Brier| > 0.01).

## Headline series metrics (fullgame-assessor-analyze.py)

| Series | n | Total bias [95% CI] | MAE | ML n | Brier | Hit | mean P(away) | actual away rate |
|---|---|---|---|---|---|---|---|---|
| live (pure `modelProjTotal`) | 947 | **−0.533 [−0.822, −0.245]** | 3.529 | — | — | — | — | — |
| live (grading rule) | 1,537 | **−0.543 [−0.767, −0.319]** | 3.511 | 1,536 | 0.2472 | 55.2% | 0.4488 | 0.4759 |
| replay p1 (raw fixed) | 1,555 | **−0.233 [−0.454, −0.012]** | 3.501 | 1,555 | 0.2471 | 55.4% | 0.4375 | 0.4785 |
| replay p2 (calibrated) | 1,555 | −0.049 [−0.270, +0.173] | 3.528 | 1,555 | 0.2471 | 55.4% | 0.4543 | 0.4785 |

Paired deltas (same games): p2 − live_rule total bias +0.487 [+0.449, +0.526] (n=1,537);
p2 − live ML Brier −0.0004 [−0.0031, +0.0023] (n=1,536 — **no ML skill change**).

Verdict in one line: **p2 removed the global run-environment offset (C-001) but bought zero
sharpness — MAE and Brier are unchanged — and the remaining structure is directional (ML home
lean), geographic (PIT, relocated ATH venues), and temporal (walk-forward lag).**

## Flagged slices (n ≥ 40; B = bias CI excludes 0, b = differs from series mean, R = Brier dev > 0.01)

41 of 80 slices trigger at least one flag in at least one series. Full metric set for all 80:
`fullgame-assessor-slices.csv`; the flagged subset: `fullgame-assessor-flagged-slices.csv`.
Live bias flags must be read against the live series' global −0.54: a "B" with no "b" is the
global offset surfacing in that slice, not slice-specific structure.

| dim | slice | n | live bias [95% CI] | p1 bias | p2 bias [95% CI] | live Brier dev | p2 Brier dev | flags (live / p2) |
|---|---|---|---|---|---|---|---|---|
| month | 2026-04 | 392 | -0.8492 [-1.2843, -0.4141] | -0.427 | -0.427 [-0.8692, 0.0152] | 0.0014 | 0.004 | B / - |
| month | 2026-05 | 419 | -0.1139 [-0.5383, 0.3105] | 0.1737 | 0.5746 [0.1698, 0.9794] | -0.0009 | -0.0016 | b / Bb |
| month | 2026-06 | 394 | -0.7076 [-1.151, -0.2643] | -0.457 | -0.319 [-0.7588, 0.1208] | -0.0005 | -0.0009 | B / - |
| park | ATH | 50 | -2.222 [-3.9226, -0.5214] | -1.491 | -1.2482 [-2.9333, 0.4369] | -0.0027 | 0.0016 | B / - |
| park | BOS | 52 | -0.0888 [-1.0677, 0.8901] | 0.3013 | 0.4806 [-0.4714, 1.4326] | 0.0031 | 0.0032 | - / - |
| park | CHC | 52 | -1.1612 [-2.5564, 0.2341] | -0.7835 | -0.6006 [-1.9975, 0.7962] | -0.0005 | -0.0185 | - / R |
| park | CLE | 53 | -0.6381 [-1.672, 0.3957] | -0.2157 | -0.0413 [-1.0558, 0.9732] | 0.0119 | 0.0005 | R / - |
| park | COL | 53 | -0.4255 [-1.6983, 0.8473] | 0.6983 | 0.9655 [-0.2404, 2.1713] | 0.012 | 0.0077 | R / - |
| park | CWS | 49 | -0.4992 [-1.8396, 0.8412] | -0.6551 | -0.4742 [-1.7833, 0.8349] | -0.0114 | -0.0041 | R / - |
| park | DET | 52 | -0.0657 [-1.1558, 1.0244] | 0.1842 | 0.3718 [-0.74, 1.4837] | -0.0007 | -0.0118 | - / R |
| park | KC | 53 | -1.1071 [-2.5911, 0.3768] | -0.9872 | -0.7925 [-2.2437, 0.6588] | -0.0001 | 0.0133 | - / R |
| park | LAD | 50 | 0.1616 [-0.9862, 1.3094] | 0.336 | 0.5135 [-0.6066, 1.6336] | -0.015 | -0.0092 | R / - |
| park | MIA | 52 | 0.2114 [-0.8139, 1.2367] | 0.4452 | 0.6281 [-0.3804, 1.6365] | -0.0134 | 0.0005 | R / - |
| park | MIN | 52 | -0.3623 [-1.5976, 0.873] | 0.0921 | 0.267 [-0.935, 1.469] | 0.0052 | 0.0106 | - / R |
| park | NYM | 50 | -1.1514 [-2.4819, 0.1791] | -0.3354 | -0.1704 [-1.5246, 1.1839] | 0.0148 | 0.0229 | R / R |
| park | PHI | 53 | -0.76 [-1.9723, 0.4523] | -0.1051 | 0.0712 [-1.1475, 1.29] | -0.0159 | -0.0185 | R / R |
| park | PIT | 52 | -2.1281 [-3.6287, -0.6275] | -1.7398 | -1.5513 [-3.0449, -0.0577] | 0.0213 | 0.0211 | BbR / BbR |
| park | SF | 48 | -0.4665 [-1.6894, 0.7565] | -0.2152 | -0.0527 [-1.2295, 1.1241] | 0.0101 | 0.0047 | R / - |
| park | TB | 51 | -0.8667 [-2.1045, 0.3712] | -0.6155 | -0.4276 [-1.6712, 0.8159] | -0.0186 | -0.0131 | R / R |
| park | WSH | 52 | -1.4482 [-2.835, -0.0615] | -0.9715 | -0.7348 [-2.0694, 0.5999] | -0.0009 | -0.0018 | B / - |
| day_night | day | 585 | -0.5027 [-0.8728, -0.1327] | -0.2263 | -0.0495 [-0.4116, 0.3126] | -0.0005 | -0.0 | B / - |
| day_night | night | 970 | -0.5671 [-0.8486, -0.2856] | -0.2369 | -0.0485 [-0.3284, 0.2315] | 0.0004 | -0.0001 | B / - |
| fav | home_fav | 1038 | -0.6058 [-0.8771, -0.3344] | -0.2969 | -0.1178 [-0.3851, 0.1495] | -0.0023 | -0.0017 | B / - |
| bucket | 8-9 | 874 | -0.4903 [-0.7853, -0.1953] | -0.2295 | -0.0519 [-0.3436, 0.2398] | -0.0024 | -0.0018 | B / - |
| bucket | <8 | 399 | -0.5902 [-1.005, -0.1753] | -0.1544 | 0.0092 [-0.4038, 0.4221] | 0.0005 | 0.0005 | B / - |
| bucket | >9 | 281 | -0.6407 [-1.2322, -0.0491] | -0.3538 | -0.1197 [-0.6995, 0.46] | 0.0071 | 0.0047 | B / - |
| hand | L-L | 128 | -0.8908 [-1.7617, -0.0198] | -0.6747 | -0.5075 [-1.3671, 0.352] | -0.0033 | -0.0026 | B / - |
| hand | R-L | 303 | -0.6071 [-1.1356, -0.0786] | -0.3026 | -0.1073 [-0.625, 0.4104] | 0.0038 | -0.0045 | B / - |
| hand | R-R | 738 | -0.5617 [-0.8782, -0.2452] | -0.2233 | -0.0453 [-0.3576, 0.267] | -0.0019 | 0.0025 | B / - |
| team | ARI | 104 | -0.2351 [-1.0853, 0.615] | 0.2454 | 0.443 [-0.4301, 1.3161] | -0.0057 | -0.0085 | - / - |
| team | BOS | 102 | -0.0188 [-0.7175, 0.6799] | 0.4809 | 0.6529 [-0.0434, 1.3492] | 0.0103 | 0.0026 | R / b |
| team | CLE | 105 | -0.2238 [-0.9735, 0.526] | 0.0856 | 0.2621 [-0.4764, 1.0006] | 0.014 | 0.0017 | R / - |
| team | CWS | 102 | -0.8116 [-1.7011, 0.0779] | -0.9043 | -0.7336 [-1.5963, 0.129] | -0.0051 | 0.0008 | - / - |
| team | DET | 104 | -0.1409 [-0.9014, 0.6197] | 0.1566 | 0.3305 [-0.4425, 1.1035] | -0.0015 | -0.0096 | - / - |
| team | LAA | 104 | -0.6621 [-1.5758, 0.2515] | -0.5395 | -0.3642 [-1.29, 0.5616] | -0.0094 | -0.0082 | - / - |
| team | MIN | 105 | -1.3345 [-2.257, -0.412] | -0.9275 | -0.7439 [-1.6294, 0.1415] | 0.0021 | 0.005 | B / - |
| team | PHI | 104 | -0.1903 [-1.0579, 0.6773] | 0.3377 | 0.5248 [-0.3552, 1.4048] | -0.0063 | -0.0124 | - / R |
| team | PIT | 104 | -1.4637 [-2.4563, -0.4711] | -1.1278 | -0.9432 [-1.9231, 0.0368] | 0.0127 | 0.0102 | BR / R |
| team | TB | 103 | -0.5677 [-1.4463, 0.3108] | -0.4074 | -0.2326 [-1.0993, 0.6342] | -0.0163 | -0.0073 | R / - |
| team | TEX | 103 | -0.8248 [-1.5551, -0.0944] | -0.4069 | -0.2329 [-0.8991, 0.4333] | 0.001 | -0.0027 | B / - |
| team | WSH | 104 | -1.3561 [-2.3301, -0.3821] | -0.9987 | -0.7978 [-1.7453, 0.1497] | 0.0113 | 0.0094 | BR / - |

## Structure narratives (the "why")

### S1 (P1) — Away-favorite moneyline lean: present live, **kept by p2**, growing over the season
The single largest residual. Live: on 488 away-favorite games the model's mean P(away) is 0.490
vs an actual away win rate of 0.559 — gap −6.9pp, z = −3.08. p1: −9.1pp (z = −4.06); p2:
−8.4pp (z = −3.76). Home favorites are essentially perfectly calibrated (live z = −0.54, p2
z = +0.19). Hit rates split accordingly: live 50.7% on away favorites vs 57.3% on home
favorites (p2: 53.0% / 56.7%). Monthly live gap: Mar −6.3pp, Apr −1.0pp, May −7.0pp, Jun
−9.5pp, Jul **−12.6pp** — worsening as the season progressed; p2 tracks it almost identically
(−12.0pp in July). Mechanism: the flat `FG_ML_HOME_EDGE = +0.03` shim (MLBAIModel.py:1617-1621)
is also in the replay (`replay_driver.py` `--home-edge`, pass-1 default 0.03), and p2's
temperature scaling is symmetric around 0.5 — it cannot remove a directional shift. The
worst-50 ML misses are this defect's tail: **49/50 are away teams winning** while priced
0.29–0.39 (only 4 were book away-favorites). The fix did not remove this structure; for
away favorites it never touched it.

### S2 (P2) — Walk-forward calibration chases the month and overshoots: structure **moved**, not removed
Monthly actual runs/game vs p2 signed bias (analyze.py month slices + calibMeta): Mar 8.62
(−0.13), Apr 9.11 (**−0.43**, seed months have mult=1.0), May 8.61 (**+0.57**, centered-flag),
Jun 9.35 (−0.32), Jul 9.21 (−0.05). May's `league_env_mult` = 1.0456 was fitted on a hot April
after a cool March; May then cooled and p2 became the *only* series that over-projected it
(live May bias −0.11, p1 +0.17). June's mult (1.0155) then under-corrected a hot June. The
monthly expanding-window refit converts a static level error into an alternating-sign monthly
error of ±0.3–0.6 runs. April's under-projection (live −0.85 [−1.28, −0.41]) remains in p2 by
construction (seed).

### S3 (P2) — Venue-blind park factors: the relocated-Athletics stand and Mexico City
Park factors key off the home-team abbreviation in both live and replay paths. The data shows
ATH "home" games at **two venues** (`fullgame-assessor-followups.txt`): Sutter Health Park
(n=44) and **Las Vegas Ballpark (n=6, 2026-06-08..06-14)**. The Las Vegas stand averaged
**17.0 actual runs/game**; every series under-projected it by ~5 runs/game (p2 mean error
−5.07). The two worst total misses of the entire season in all three series are that stand
(COL@ATH 32 actual vs 11.84 p2-projected; MIL@ATH 29 vs 10.26). Sutter Health itself: live
−1.74 [−3.22, −0.26] but p2 −0.73 (ns) — the DB factor (`mlb_park_factors` ATH 1.248/1.44)
plus p2's env mult roughly covers Sacramento; nothing covers Las Vegas. Same pattern in
miniature: ARI played 2 games at Estadio Alfredo Harp Helú (Mexico City altitude), 14.5 actual
RPG. Any venue-relocated event inherits the wrong park model.

### S4 (P2) — PIT is the one park the fix could not touch
PIT is the only park slice bias-flagged in **both** live and p2: live −2.13 [−3.63, −0.63],
p1 −1.74, p2 **−1.55 [−3.04, −0.06]** (also centered-flagged in both). It is persistent within
season — PNC mean actual total by month 10.1 / 10.9 / 10.8 / 10.9, p2 bias −1.3 / −1.7 / −1.8 /
−1.4 — and it is the worst ML park too (Brier dev **+0.021 in both live and p2**). The inputs
explain it: the live static table carries PNC as a pitcher's park (r=97) and the DB 3-yr factor
is 1.051, while 2026 PNC games ran ~10.6 RPG (~18% above league). Both models trust 2024-25
priors that 2026 falsified; the monthly league-level mult cannot fix a single park. PIT as a
*team* shows the same shape (live −1.46 [−2.46, −0.47]; p2 −0.94 [−1.92, +0.04], borderline).

### S5 (P3) — Starter-handedness pair: live under-projects lefty-lefty games; p2 attenuates but keeps the spread
Live: L-L −0.89 [−1.76, −0.02], R-L −0.61 [−1.14, −0.08], R-R −0.56 [−0.88, −0.25], L-R −0.18
(ns) — a 0.71-run L-L vs L-R spread. p2 clears every CI (L-L −0.51 ns, L-R +0.30 ns) but the
L-L↔L-R spread actually widens to 0.80 runs. Consistent with the replay protocol's documented
hand-split approximation (static L/R ratio applied to as-of overall rate) and the live engine's
unimplemented per-batter platoon logic (P4-B, fullgame dossier).

### S6 (P3) — Team-level residuals: p2 cleans up the level, three teams stay nominally low, COL shows the calibration's blind spot
Live team bias flags: MIN −1.33 [−2.26, −0.41], PIT −1.46, WSH −1.36 [−2.33, −0.38], TEX −0.82
[−1.56, −0.09] — all cleared by p2 (largest remaining: PIT −0.94, WSH −0.80, MIN −0.74, all ns).
BOS is the one team p2 over-corrects (+0.65, centered-flag). On the ML side, COL exposes the
temperature layer's cost: COL as away team won 34.6% of 52 games; live priced them 0.392
(gap +4.6pp, Brier 0.2370) but p2's compression toward 0.5 prices them 0.450 — Brier degrades
to 0.2489, worse than live. Uniform temperature helps mid-range probabilities and hurts teams
that deserve extreme prices; 7 of the worst-50 ML misses are COL-away games.

### S7 — Where the model is fine
Day/night (bias identical to global in both halves; p2 −0.05 both), total-line buckets (p2:
<8 +0.01, 8–9 −0.05, >9 −0.12, all ns), and home-favorite calibration are clean. ML Brier park
deviations >0.01 that appear only in one series (live: CLE/COL/CWS/LAD/MIA/NYM/PHI/SF/TB; p2:
CHC/DET/KC/MIN/NYM/PHI/TB) are mostly n≈50 noise around strong/weak teams — only PIT (+0.021)
and NYM (+0.015/+0.023) repeat across series on the bad side, TB (−0.019/−0.013) and PHI on
the good side.

## Worst-50 tables (CSVs alongside this report)

- `fullgame-assessor-worst50-total.csv` — ranked by |live signed error|. **All 50 are
  under-projections**, 9.9 to 21.6 runs; 15/50 are quarantined rows. Head: COL@ATH 2026-06-14
  (32 actual vs 10.44 live / 11.84 p2), MIL@ATH 2026-06-08 (29 vs 9.38 / 10.26), KC@NYM
  2026-07-07 (28 vs 9.83 / 9.97), SD@CHC 2026-07-01 (26 vs 8.42 / 9.36). p2 has the smaller
  absolute error on 43/50 (its higher global level), but no series is within 12 runs of the
  ATH-Las-Vegas games — these are environment misses, not variance misses.
- `fullgame-assessor-worst50-ml.csv` — ranked by live Brier (0.393–0.507). 49/50 away winners
  (S1); away-team frequency: COL 7, SF 6, WSH 4. p2 Brier is lower on 48/50 — the mechanical
  benefit of compression on tail misses, already offset in aggregate (overall Brier unchanged).

## Defects found

| # | Sev | Finding |
|---|---|---|
| D-1 | P1 | Away-favorite ML lean: model P(away) 6.9–9.1pp below realized away-favorite win rate (z ≤ −3.1 in all three series), worsening Mar→Jul (−12.6pp in July); root cause flat +0.03 home edge carried into the replay; p2 temperature cannot and did not fix it (S1). |
| D-2 | P2 | Walk-forward monthly env-mult lags the environment: p2 May +0.57 over-projection (only over-projecting series), Apr −0.43 kept from seed; level error converted to alternating monthly error (S2). |
| D-3 | P2 | Park factors are home-team-keyed, venue-blind: ATH's 6-game Las Vegas Ballpark stand missed by ~5 runs/game in every series (the two worst total misses of the season); ARI Mexico City games likewise unmodeled (S3). |
| D-4 | P2 | PIT residual survives everything: park bias-flagged in live AND p2 (−2.13 → −1.55, CI excludes 0), worst ML park in both (Brier dev +0.021), persistent in all four months; 2024-25 park priors (DB 1.051, static 97) falsified by 2026 PNC (~10.6 RPG) (S4). |
| D-5 | P3 | Live L-L starter-pair under-projection −0.89* ; p2 leaves a 0.80-run L-L vs L-R spread (protocol's static hand-split approximation) (S5). |
| D-6 | P3 | Grading-rule contamination: 590/1,537 live "signed total errors" use `modelTotal` (= book line) because `modelProjTotal` is null — those rows measure the book, not the model (pure-projection subset reported separately: −0.533 [−0.82, −0.24], n=947). |
| D-7 | P3 | 15 phantom rows: `modelTotal` populated with `modelRunAt` null (book echo without an engine run) — the population's live-graded n must be defined off `modelRunAt`/`modelProjTotal`, not `modelTotal`. |
| D-8 | P3 | Uniform temperature scaling degrades extreme-prior teams: COL-away Brier live 0.2370 → p2 0.2489 while global Brier is flat — calibration moved error onto the tails (S6). |
| D-9 | note | Quarantine scale at population level is 346/1,555 (22.2%), above the 286 previously reported on the enrolled subset; all conclusions robust to exclusion. |

## Recommendations

1. Replace the flat +0.03 home edge with a favorite-status- (or odds-) conditional correction
   fitted walk-forward; acceptance test = away-favorite slice gap |z| < 2 with no home-favorite
   regression. This is the highest-value single change for ML.
2. Swap monthly env-mult refits for a shrunk rolling window (e.g., 30-day exponentially
   weighted, shrunk toward season-to-date) to stop month-boundary overshoot.
3. Key park factors by StatsAPI venue id, not home-team abbr, with an explicit special-event
   table (Las Vegas Ballpark, Estadio Alfredo Harp Helú, future relocations).
4. Add an in-season per-park empirical-Bayes update (PIT alone is worth ~1.5 runs of bias on
   ~50 games/season); flag any park whose season-to-date residual exceeds ±1 run on n≥25.
5. Grade signed total error on `modelProjTotal` only; never fall back to the book-anchored
   `modelTotal` (D-6/D-7).
6. When p2d (daily calibration) lands, re-run this exact script set: the May-overshoot test
   (S2) and the away-favorite gap (S1) are the two acceptance metrics that distinguish "removed"
   from "moved".

## Files

- `fullgame-assessor-per-game.csv` — 1,555 rows, every game, all series errors + context.
- `fullgame-assessor-slices.csv` / `fullgame-assessor-flagged-slices.csv` — 80 / 41 slices.
- `fullgame-assessor-worst50-total.csv`, `fullgame-assessor-worst50-ml.csv`.
- `fullgame-assessor-followups.txt` — venue/fav/COL/hand/PIT probes (raw output).
- `fullgame-assessor-summary.json` — population accounting, overall metrics, paired deltas,
  calibration constants, p2 worst-10s, venue anomalies.
