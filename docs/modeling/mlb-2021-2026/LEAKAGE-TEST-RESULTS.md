# Leakage Test Results

1. **Strictly-prior features**: every rolling aggregate uses shift(1) before windowing (code-
   audited in build_datasets.py); pitcher/batter state attaches via merge_asof on the entity's
   own PRIOR appearance dates; lineup pools use the prior-20-games window with index<date
   lookups. PASS (construction-level guarantee + spot audit).
2. **Same-day exclusion**: as-of keyed by official_date with strict '<' — same-day earlier
   games excluded (conservative vs live). PASS.
3. **No same-game inputs**: feature sources are E1/E2/E4 tables keyed to OTHER games only via
   the shift(1); outcomes attach post-prediction in the harness. PASS.
4. **Fold hygiene**: preprocessing medians, model fits, and calibration fit only on train/
   calibration windows (code path audited); thresholds preregistered in the frozen contract.
   PASS.
5. **Starter knowledge**: deployable uses reconstructed starters only (49.8% hit rate —
   measured and reported); actual starters isolated to the ORACLE series, excluded from
   verdicts. PASS.
6. **Season-boundary test**: 2021 fold trained through 2020 only; empirical check that no
   feature column in the 2021 test rows correlates >0.999 with any outcome column. PASS
   (matrix audit).
7. **Cross-run disclosure**: prior app-model work touched 2026 outcomes outside this run;
   within-run 2026 is untouched; disclosed in contract + report. DISCLOSED.
