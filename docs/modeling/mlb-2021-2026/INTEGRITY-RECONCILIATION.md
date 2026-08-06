# Integrity Reconciliation — 400k Contract (joint-nb-v2)

## Population reconciliation

| Quantity | Expected | Observed | Status |
|---|---|---|---|
| Game-state simulations | 3 × 26,731 = 80,193 | 80,193 | PASS |
| Trajectories | 80,193 × 400,000 = 32,077,200,000 | 32,077,200,000 (400,000 in every artifact) | PASS |
| Unique (game_pk, fold) per state | 26,731 | 26,731 / 26,731 / 26,731 | PASS |
| Per-game internal gates | all PASS | 80,193/80,193 PASS | PASS |
| Shard errors | 0 | 0 (24 shard logs clean, 24/24 DONE) | PASS |

Per-game gates (asserted inside the engine, recorded in each artifact):
1. trajectory count == 400,000
2. FG reconciliation: home_wins + away_wins == 400,000 (no unresolved ties)
3. F5 reconciliation: f5_home + f5_away + f5_tie == 400,000
4. histogram sums: margin, total, F5 margin, F5 total each == 400,000

## Hash chain

- Per game: 80 batch hashes (SHA256 over running counts) → `agg_hash` (SHA256 over the
  concatenation), stored in artifact + `SIMULATION-MANIFEST.parquet` (80,193 rows).
- Ledger: append-only JSONL with SHA-256 event chain; `ledger.py verify` passes; final
  checksum recorded in `LEDGER-FINAL.md`.

## Role separation

Recalibration heads were fit **only** on calibration-role simulations (13,016 per
state) and applied to score-role games (13,715 per state); the role column travels
with `engine_params_v2_{state}.parquet` and is joined by (game_pk, fold), which is
unique across roles because fold labels are score-year-keyed.

## Superseded v1 sweep

The joint-nb-v1 sweep (ledger events 29–31) also completed its full 400k contract with
identical gate results but was found to have an intercept-collapsed mean model at
scoring time. It is preserved as history (run directory `simulations/`), issued **no**
verdicts, and shares no RNG stream with v2 (model_version is inside the seed payload).

## Boundary compliance

All inputs derive from the frozen warehouse snapshot (max_loaded_at
2026-07-29T08:59:20Z) within `docs/audits/mlb-warehouse-2026/` boundaries. No internet,
no new StatsAPI requests, no external odds/injury/weather, no app tables, no fuzzy
identity joins. Betting/pricing metrics remain BLOCKED_BY_DATA_BOUNDARY and are
additionally out of objective per the governing directive.
