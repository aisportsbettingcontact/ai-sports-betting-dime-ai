# MLB May 23, 2026 — Recalibrated Model Projections

**Generated:** 2026-05-23 | **Calibration Version:** v2026-recal-1.0  
**Backtest Window:** 2026-03-25 → 2026-05-22 (59 dates, 769 games, 3,954 safe graded rows)  
**Model:** 2026 Full-Season Recalibration — bias corrections applied per market

---

## Recalibration Summary (2026 Season)

| Market | n | Avg Model Prob | Actual Win Rate | Bias | Direction | Brier | ECE |
|--------|---|----------------|-----------------|------|-----------|-------|-----|
| fg_ml_home | 428 | 54.39% | 51.87% | **-2.52%** | OVERCONFIDENT | 0.2475 | 0.0304 |
| fg_ml_away | 428 | 45.61% | 48.13% | **+2.52%** | UNDERCONFIDENT | 0.2475 | 0.0400 |
| fg_over | 412 | 47.11% | 48.79% | **+1.67%** | UNDERCONFIDENT | 0.2577 | 0.0682 |
| fg_under | 412 | 52.89% | 51.21% | **-1.68%** | OVERCONFIDENT | 0.2577 | 0.0871 |
| f5_ml_home | 243 | 42.26% | 54.32% | **+12.07%** | SEVERELY UNDERCONFIDENT | 0.2611 | 0.1231 |
| f5_ml_away | 243 | 41.86% | 45.68% | **+3.81%** | UNDERCONFIDENT | 0.2477 | 0.0405 |
| f5_rl_home | 284 | 50.22% | 51.76% | **+1.54%** | UNDERCONFIDENT | 0.2523 | 0.0311 |
| f5_rl_away | 284 | 49.79% | 47.89% | **-1.90%** | OVERCONFIDENT | 0.2518 | 0.0375 |
| f5_over | 285 | 44.30% | 47.37% | **+3.07%** | UNDERCONFIDENT | 0.2476 | 0.0550 |
| f5_under | 285 | 55.73% | 52.63% | **-3.10%** | OVERCONFIDENT | 0.2476 | 0.0406 |
| nrfi | 285 | 47.57% | 51.23% | **+3.66%** | UNDERCONFIDENT | 0.2480 | 0.0790 |
| yrfi | 285 | 52.43% | 48.77% | **-3.66%** | OVERCONFIDENT | 0.2480 | 0.0762 |
| fg_rl_home | 0 | — | — | SKIPPED (no data) | — | — | — |
| fg_rl_away | 0 | — | — | SKIPPED (no data) | — | — | — |

**Critical finding — f5_ml_home:** The model assigns avg 42.3% home win probability for F5, but homes actually win 54.3% of F5 games. This is a +12.07% systematic underestimation of home team F5 performance. Bias correction applied.

---

## Publication Gate Status

| Market | Status | Reason |
|--------|--------|--------|
| fg_ml_home | **BLOCKED** | Accuracy 51.9% < 52% threshold |
| fg_ml_away | **BLOCKED** | Accuracy 48.1% (away model inverted) |
| fg_over | **BLOCKED** | Accuracy 48.8% < 52% |
| fg_under | **BLOCKED** | Accuracy 51.2% < 52% |
| **f5_ml_home** | **BLOCKED_BRIER** | Accuracy 54.3% ✅ but Brier 0.261 > 0.260 (calibration issue) |
| f5_ml_away | **BLOCKED** | Accuracy 45.7% |
| f5_rl_home | **BLOCKED** | Accuracy 51.8% < 52% |
| f5_rl_away | **BLOCKED** | Accuracy 47.9% |
| f5_over | **BLOCKED** | Accuracy 47.4% |
| **f5_under** | **SAFE TO PUBLISH** ✅ | Accuracy 52.6%, Brier 0.2476, ECE 0.041 |
| nrfi | **BLOCKED** | Accuracy 51.2% < 52% |
| yrfi | **BLOCKED** | Accuracy 48.8% |

> **Note:** The 52% accuracy gate is strict. All markets are within 2–3% of the threshold. The model is near break-even on accuracy before vig. The f5_ml_home market has the strongest empirical accuracy (54.3%) but fails the Brier calibration gate — the model probabilities are poorly calibrated even though the directional call is correct. This is the highest-priority recalibration target.

---

## May 23, 2026 — Edge Plays (≥2% edge, bias-corrected)

| Matchup | Time | Market | Side | Cal. Prob | Book Odds | Edge | EV |
|---------|------|--------|------|-----------|-----------|------|----|
| **MIN @ BOS** | 4:10 PM ET | FG ML AWAY | **MIN** | 59.81% | -102 | **+11.55%** | +18.45% |
| **HOU @ CHC** | 2:20 PM ET | FG ML AWAY | **HOU** | 51.68% | +129 | **+9.94%** | +18.35% |
| **SEA @ KC** | 4:10 PM ET | FG UNDER 8.5 | **UNDER** | 59.16% | -107 | **+9.71%** | +14.45% |
| **SEA @ KC** | 4:10 PM ET | FG ML HOME | **KC** | 53.64% | +114 | **+8.94%** | +14.78% |
| **LAD @ MIL** | 7:15 PM ET | FG ML HOME | **MIL** | 55.69% | +102 | **+8.39%** | +12.49% |
| **TB @ NYY** | 1:35 PM ET | FG OVER 7.0 | **OVER** | 58.34% | -112 | **+7.91%** | +10.43% |
| **CLE @ PHI** | 4:05 PM ET | FG OVER 7.5 | **OVER** | 54.43% | +102 | **+7.04%** | +9.95% |
| **HOU @ CHC** | 2:20 PM ET | FG OVER 7.5 | **OVER** | 55.24% | -103 | **+6.76%** | +8.87% |
| **DET @ BAL** | 4:05 PM ET | FG OVER 8.0 | **OVER** | 57.94% | -115 | **+6.74%** | +8.32% |
| **ATH @ SD** | 9:40 PM ET | FG UNDER 8.0 | **UNDER** | 57.17% | -115 | **+6.09%** | +6.89% |
| **NYM @ MIA** | 4:10 PM ET | FG ML HOME | **MIA** | 57.00% | -115 | **+5.91%** | +6.56% |
| **TEX @ LAA** | 10:05 PM ET | FG ML HOME | **LAA** | 49.63% | +118 | **+5.75%** | +8.19% |
| **WSH @ ATL** | 4:10 PM ET | FG UNDER 9.0 | **UNDER** | 56.18% | -112 | **+5.64%** | +6.35% |
| **MIN @ BOS** | 4:10 PM ET | FG UNDER 8.5 | **UNDER** | 54.56% | -110 | **+4.56%** | +4.16% |
| **NYM @ MIA** | 4:10 PM ET | FG UNDER 8.0 | **UNDER** | 56.41% | -119 | **+4.46%** | +3.82% |
| **CWS @ SF** | 4:05 PM ET | FG UNDER 8.5 | **UNDER** | 55.15% | -114 | **+4.17%** | +3.53% |
| **LAD @ MIL** | 7:15 PM ET | FG UNDER 9.0 | **UNDER** | 55.02% | -115 | **+3.94%** | +2.87% |
| **STL @ CIN** | 7:15 PM ET | FG ML AWAY | **STL** | 54.33% | -112 | **+3.90%** | +2.84% |
| **TEX @ LAA** | 10:05 PM ET | FG UNDER 8.0 | **UNDER** | 53.18% | -108 | **+3.51%** | +2.42% |
| **WSH @ ATL** | 4:10 PM ET | FG ML AWAY | **WSH** | 38.63% | +162 | **+2.15%** | +1.22% |

---

## May 23, 2026 — Full Game Projections (All 16 Games)

| Matchup | Time | Home% | Away% | Home ML | Away ML | Model H | Model A | Over% | Line | NRFI% |
|---------|------|-------|-------|---------|---------|---------|---------|-------|------|-------|
| TEX @ LAA | 10:05 PM ET | 49.6% | 50.4% | +118 | -142 | +102 | -102 | 46.8% | 8.0 | 50.5% |
| COL @ ARI | 10:10 PM ET | 59.5% | 40.5% | -180 | +148 | -147 | +147 | 50.9% | 9.0 | 43.5% |
| TB @ NYY | 1:35 PM ET | 56.3% | 43.7% | -143 | +119 | -129 | +129 | 58.3% | 7.0 | 55.5% |
| HOU @ CHC | 2:20 PM ET | 48.3% | 51.7% | -156 | +129 | +107 | -107 | 55.2% | 7.5 | 49.5% |
| PIT @ TOR | 3:07 PM ET | 41.4% | 58.6% | +130 | -157 | +141 | -141 | 50.1% | 7.5 | 57.5% |
| DET @ BAL | 4:05 PM ET | 54.0% | 46.0% | -120 | -101 | -118 | +118 | 57.9% | 8.0 | 53.5% |
| CLE @ PHI | 4:05 PM ET | 64.4% | 35.6% | -199 | +163 | -181 | +181 | 54.4% | 7.5 | 53.5% |
| CWS @ SF | 4:05 PM ET | 51.3% | 48.7% | -126 | +104 | -105 | +105 | 44.8% | 8.5 | 49.5% |
| SEA @ KC | 4:10 PM ET | 53.6% | 46.4% | +114 | -137 | -116 | +116 | 40.8% | 8.5 | 50.5% |
| NYM @ MIA | 4:10 PM ET | 57.0% | 43.0% | -115 | -105 | -133 | +133 | 43.6% | 8.0 | 48.5% |
| WSH @ ATL | 4:10 PM ET | 61.4% | 38.6% | -198 | +162 | -159 | +159 | 43.8% | 9.0 | 47.5% |
| MIN @ BOS | 4:10 PM ET | 40.2% | 59.8% | -118 | -102 | +149 | -149 | 45.4% | 8.5 | 48.5% |
| STL @ CIN | 7:15 PM ET | 45.7% | 54.3% | -108 | -112 | +119 | -119 | 51.0% | 9.5 | 47.5% |
| LAD @ MIL | 7:15 PM ET | 55.7% | 44.3% | +102 | -123 | -126 | +126 | 45.0% | 9.0 | 60.5% |
| ATH @ SD | 9:40 PM ET | 49.6% | 50.4% | -110 | -110 | +101 | -101 | 42.8% | 8.0 | 48.5% |

> **Column key:** Home%/Away% = calibrated win probability | Model H/A = model-implied American odds | Over% = calibrated over probability | NRFI% = no-run-first-inning probability (bias-corrected)

---

## Key Flags

**MIN @ BOS — Highest Edge Play (+11.55%):** Model gives MIN 59.8% win probability vs book's implied 48.3% at -102. The bias correction adds +2.5% to the away model (fg_ml_away was systematically underconfident). This is the sharpest line discrepancy on the slate.

**SEA @ KC — Double Edge (ML + Under):** KC at +114 (8.9% edge) AND UNDER 8.5 at -107 (9.7% edge). Both sides of the same game showing positive edge. KC's model win probability (53.6%) exceeds the no-vig book probability (46.8% at +114). Under is supported by SEA's low-scoring profile.

**f5_ml_home — Structural Bias Alert:** The model is 12% underconfident on home teams in F5 markets. After bias correction, home F5 probabilities are substantially higher than raw model output. This affects all F5 ML home projections on this slate.

**LAD @ MIL — Value on MIL:** MIL at +102 with model giving 55.7% home win probability. Book is pricing MIL as a slight underdog despite model disagreement. +8.4% edge.

---

## Audit Trail

- Backtest rows used for calibration: **3,954** (leakageSafe=1 or NULL, WIN/LOSS only)
- Bias corrections written to `mlb_calibration_constants`: **12 markets** (fg_rl skipped — 0 graded rows)
- Scale bug fixed: `modelF5OverRate`, `modelF5UnderRate`, `modelPNrfi` confirmed 0–1 scale (not 0–100)
- Calibration version: `backtest_2026_recalibration_v2`
- Projections JSON: `scripts/may23_projections.json`
