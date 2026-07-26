# K-Props — MODELER report (granular 5x5 backtest)

Role: MODELER, kprops market group. Re-derive and verify the projections themselves,
full population. Run date: 2026-07-25.

Every number below comes from an executed script:

| # | Script (granular/tools/) | Invocation | Outputs (granular/kprops/) |
|---|---|---|---|
| 1 | `kprops-modeler-01-extract.py` | `venv/bin/python kprops-modeler-01-extract.py` | `kprops-modeler-games.csv`, `-live-props.csv`, `-replay-props.csv`, `-kfactors.csv`, `-grades-snapshot.csv` |
| 2 | `kprops-modeler-02-verify.py` | `venv/bin/python kprops-modeler-02-verify.py` | `-line-anchor.csv`, `-replay-recompute.csv`, `-poisson-summary.csv`, `-poisson-violations.csv`, `-p2-factor-check.csv`, `-aggregates.json` |
| 3 | `kprops-modeler-03-followups.py` | `venv/bin/python kprops-modeler-03-followups.py` | `-live-weekly-anchor.csv`, `-ratio-concentration.csv`, `-p2-range-census.csv`, `-integer-lines.csv`, `-followups.json` |

## Population (computed by code, not sampled)

- Finals 2026-03-25..2026-07-24: **1,556** games (1,555 with `mlbGamePk`; the All-Star
  exhibition is exempt per scope).
- **Live** K props (`mlb_strikeout_props` joined to those finals): **2,837 rows** on 1,447
  games; 2,738 have `kProj` (99 rows have a book line but were never modeled); all 2,837 have
  `bookLine`. 48 further rows sit on games outside the population (non-final/out-of-range) and
  are excluded by the join.
- **Replay** K props (`mlb_replay_prop_projections`, propType='K'): **3,110 rows per pass**
  (2 starters x 1,555 games, both sides present for every game), passes present at run time:
  `wf-19288f01-p1` and `wf-19288f01-p2` (no `-p2d` rows existed when the extraction ran).
  2,528 rows carry a book line — exactly the rows whose `(gameId, mlbamId)` has a live
  `mlb_strikeout_props` row for the actual starter; the other 582 (18.7%) have `line` NULL
  and (verified) `pOver` NULL.
- `mlb_replay_grades` snapshot at extraction time (ledger is being written by a running
  pipeline; incompleteness is not a defect): `k_prop` live 2,686 / p1 3,090 / p2 3,090 rows,
  all 2026-03-25..2026-07-24 (`kprops-modeler-grades-snapshot.csv`).

## 1. Line-decoupling: replay projValue vs line, live kProj vs bookLine

OLS per month (`kprops-modeler-line-anchor.csv`; p1 and p2 have identical monthly R² since
p2 is a within-month scalar rescale — a built-in sanity check that passed):

| month | live n | live R² (anchor) | live slope | replay p1 n | replay p1 R² | replay slope |
|---|---|---|---|---|---|---|
| 2026-03 | 107 | **0.8615** | 1.373 | 106 | 0.5332 | 1.462 |
| 2026-04 | 633 | 0.5597 | 1.076 | 542 | 0.2702 | 1.144 |
| 2026-05 | 690 | 0.3914 | 0.845 | 678 | **0.0730** | 0.559 |
| 2026-06 | 771 | 0.4405 | 0.783 | 704 | **0.0511** | 0.456 |
| 2026-07 | 537 | 0.5256 | 0.882 | 498 | **0.1086** | 0.648 |
| season | 2,738 | **0.4634** | 0.910 | 2,528 | **0.1183** | 0.709 |

**Verdict: replay projValue is line-decoupled.** Season R² 0.12 vs live 0.46; from May
onward (when as-of current-season features dominate) replay R² is 0.05–0.11. The higher
March/April replay R² is prior-driven, not mechanical: those months project mostly off 2025
season stats — the same skill signal books price — and the replay ratio `projValue/line` is
wide there (sd 0.31–0.52 vs live's 0.15–0.17 in its anchored weeks;
`kprops-modeler-ratio-concentration.csv`).

The **live anchor is strongest exactly where M-204 predicts**: weekly regression
(`kprops-modeler-live-weekly-anchor.csv`) shows R² 0.831 in W13 (Mar 25–29) with slope 1.34,
0.62–0.80 through W16, then a break at **W17 (2026-04-20..26, R² 0.360)** and a 0.31–0.62
regime after — consistent with the P2-A IP-fallback deploy replacing the v1
`ip_expected = bookLine/pitcher_k9*9` heuristic mid-April. Live mean `kProj/bookLine` runs
0.73–0.89 by month (the "kProj ≈ 0.72×bookLine" structure of M-204), and live mean kProj
(3.50–4.32) sits 0.4–1.3 K below mean actual Ks (4.74–5.10) in every month
(`kprops-modeler-followups.json` level_by_month) — the C-002 under-bias. The replay raw
fixed formula (p1) over-projects instead (mean projValue 5.24–5.97 vs actual 4.74–5.10),
which is what the walk-forward k_factor then corrects (p2 mean 4.50–4.64 from May).

## 2. Poisson exactness of pOver — every replay row recomputed (scipy)

`kprops-modeler-02-verify.py` recomputed pOver for **all 6,220 replay rows** (both passes;
2,528 lined + 582 line-NULL passthrough per pass), `kprops-modeler-replay-recompute.csv`
holds the row-by-row recomputation. Conventions replicated exactly from the writers:

- **p1** (`replay_driver.py`): `pOver = round(clamp(1 − PoissonCDF(floor(line), λ), .03, .85), 5)`,
  λ = projValue — push mass excluded from the over side on integer lines, not renormalized.
- **p2** (`calibrate_and_grade.py::poisson_over_prob`): λ₂ = p1.projValue × k_factor(month);
  half lines `1 − CDF(floor(line))`; integer lines **renormalized** `(1−CDF(l))/(1−PMF(l))`;
  λ floored at 0.05; **no probability clamp**; line-NULL rows pass p1's stored pOver through.

Results (`kprops-modeler-poisson-summary.csv`):

| pass | rows checked | max abs diff | > 1e-6 (strict) | true violators (rounding-aware) |
|---|---|---|---|---|
| wf-19288f01-p1 | 2,528 | 1.53e-05 | 1,811 | **0** |
| wf-19288f01-p2 | 3,110 | 5.00e-06 | 2,010 | **0** |

At the literal 1e-6 tolerance, 1,811 / 2,010 rows differ from the recomputation — **all of it
is storage quantization, none of it is formula error**: `projValue` is stored DECIMAL(7,4)
(the writer used the unrounded λ; ±5e-5 on λ moves the Poisson tail by up to ~1.5e-5) and
`pOver` is stored DECIMAL(7,5) (±5e-6). The rounding-aware check brackets each p1 row with
`f(µ−5e-5)..f(µ+5e-5) ± 5.01e-6` and checks p2 (whose inputs are the stored 4-dp p1 value and
the 5-dp calibMeta factor, i.e. exactly recoverable) at ±5.01e-6: **zero rows in either pass
fall outside** (`kprops-modeler-poisson-violations.csv` is empty). Push handling verified:
all 8 integer-line rows per pass match their respective conventions exactly
(`kprops-modeler-integer-lines.csv`).

Structural invariants (all 6,220 rows): pOver NULL ⇔ line NULL (582/pass, 0 exceptions);
no duplicate `(gameId, mlbamId, side)` keys; p1↔p2 join is 1:1 with 0 missing partners.

## 3. p2 factor application — verified row-wise

`calibMeta` k_factors (extracted from `mlb_replay_projections`, 0 intra-month conflicts
across 1,555 games) match `calibration/before-after.md` exactly: seed 1.0 (Mar, Apr),
0.84278 (May, n_train=936), 0.85849 (Jun, 1,774), 0.87373 (Jul, 2,562).

Row-wise check `p2.projValue == p1.projValue × k_factor(month)` over **all 3,110** p2 rows
(`kprops-modeler-p2-factor-check.csv`):

| month | k_factor | rows | max abs diff | mismatches | implied ratio range |
|---|---|---|---|---|---|
| 2026-03 | 1.0 | 152 | 0.0 | 0 | 1.0–1.0 |
| 2026-04 | 1.0 | 784 | 0.0 | 0 | 1.0–1.0 |
| 2026-05 | 0.84278 | 838 | 4.99e-05 | 0 | 0.842753–0.842815 |
| 2026-06 | 0.85849 | 788 | 4.99e-05 | 0 | 0.858463–0.858521 |
| 2026-07 | 0.87373 | 548 | 5.00e-05 | 0 | 0.873680–0.873769 |

Max diff = DECIMAL(7,4) quantization; **0 mismatches**. Line passthrough p1→p2: 0
mismatches. The walk-forward factor was applied uniformly to every row of its month; no row
was skipped or double-scaled.

## Defects / observations

- **KM-1 (P3, cross-pass convention split — push handling).** p1 uses the fixed live
  service's convention (push mass excluded from OVER only, un-renormalized, then clamped);
  p2 uses renormalized push-excluded odds. On the 8 integer-line rows/pass the two
  conventions differ by mean +0.072, max +0.136 in pOver (`kprops-modeler-aggregates.json`,
  `kprops-modeler-integer-lines.csv`). Tiny population, but p1-vs-p2 Brier deltas on these
  rows are convention artifacts, not calibration effects. Both are code-documented choices;
  the inconsistency between passes is the finding.
- **KM-2 (P3, cross-pass convention split — probability clamp).** p1 (like live) clamps
  pOver to [0.03, 0.85]; the p2 writer publishes unclamped probabilities: **252 rows
  > 0.85 and 82 rows < 0.03** (13.2% of the 2,528 lined p2 rows; max 0.99907, min 0.00046 —
  `kprops-modeler-p2-range-census.csv`). Compounding it, p1 saturates its clamp on 449
  lined rows (409 at 0.85, 40 at 0.03 — 17.8%), so live-vs-p1-vs-p2 probability metrics mix
  clamped and unclamped tails. Cross-series comparisons in `calibration/before-after.md`
  inherit this asymmetry.
- **KM-3 (P2 evidence, confirms M-204/C-002 empirically, full population).** Live kProj is
  book-line-anchored: month-level anchor R² 0.86 → 0.39–0.53 with the regime break dated to
  W17 (2026-04-20..26); live kProj/bookLine mean 0.73–0.89; live under-projects actual Ks in
  every month while the raw fixed replay formula over-projects and the walk-forward factor
  (0.84–0.87) closes it. The replay series is the line-decoupled counterfactual the audit
  needed: R² 0.05–0.11 once as-of in-season features dominate.
- **KM-4 (P3, coverage bound).** 582/3,110 replay rows (18.7%) carry no line/pOver because
  line provenance is limited to `mlb_strikeout_props` rows matching the actual starter —
  their probability metrics are undefined by construction (grading falls back to the live
  book line for pick derivation, per `grade_replay`; outside this role's verification scope).
- **No computational defects found** in the replay projections themselves: 0 Poisson
  violations, 0 factor-application violations, 0 structural-invariant violations across all
  6,220 rows.

## Caveats

- Live `kProj` reflects the last 5-minute model re-run stored for each row (no pre-game
  freeze, finding K-9/M-213), so the live anchor R² measures the stored final state, not
  necessarily the first pre-game publish.
- `mlb_replay_grades` is being written by a running pipeline; the snapshot above records
  what existed at extraction time.
- Only `wf-19288f01-p1`/`-p2` existed for K at run time; if a `-p2d` daily series lands
  later, `kprops-modeler-02-verify.py` already handles it (per-date factor keys) and can be
  re-run as-is.
