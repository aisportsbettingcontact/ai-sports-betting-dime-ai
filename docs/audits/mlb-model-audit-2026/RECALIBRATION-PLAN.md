# Recalibration Plan — awaiting CHECKPOINT ALPHA authorization (Phase 4, write-gated)

Validation regime for every change: **walk-forward only** — fit on data through month *m*,
evaluate on month *m+1*, rolling April→July; full-season refit-and-admire is prohibited.
Leakage checklist applies (no future features, lines timestamped pregame, actuals never feed
their own projection). All code changes stay on `local/audit-mlb-model-2026` as reviewable
commits. Regression guard: re-run `tools/grade-season.mjs` on every family before/after; no
other MLB market may degrade, and shared-code sports (NHL/NCAAM paths in shared files) are
diff-checked.

| # | Finding | Preferred fix (root cause) | Fallback (post-hoc) | Acceptance gate |
|---|---|---|---|---|
| R-1 | C-002 K props (P0) | Correct `kProj` inputs in `StrikeoutModel.py` — dossier identifies expected-IP and K-rate blending parameters; bias is a stable −1.0 K so the deterministic input error should be findable | Isotonic recalibration of pOver/pUnder on walk-forward folds + kProj recenter | Walk-forward Brier ≤ 0.25; tail reliability monotone; bias CI contains 0 |
| R-2 | C-001 FG totals | Run-environment root cause (2026 park factors / league RPG / bullpen inputs staleness per dossier config inventory) | Additive +0.5 recenter of projected totals | Walk-forward signed bias CI contains 0; Brier(total O/U) not worse |
| R-3 | C-003 HR props | Statcast feature freshness + park HR factor check | Multiplicative recenter of `modelPHr` to rolling base rate | Positive Brier skill vs base rate on walk-forward months |
| R-4 | C-004 NRFI | None available — the signal does not exist in the current model | **RECOMMENDED ONLY**: suppress published NRFI picks until model rebuild; recalibration cannot conjure discrimination from Brier ≈ 0.25 | product decision at checkpoint |
| R-5 | C-005 ML compression | — | Temperature scaling of FG/F5 ML probabilities | Reliability slope →1 on walk-forward; Brier improves; hit rate unchanged |

Priority order: R-1 (P0, subscriber-facing corruption), R-2, R-3, R-5, R-4 (decision).
Month-heterogeneity caution on R-2: May bias ≈ 0 while Apr/Jun/Jul are strongly negative —
root-cause work must explain May before a constant recenter is trusted.
