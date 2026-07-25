# Findings Register — MLB Model Audit 2026

Status values: OPEN / FIX EXECUTED (evidence) / RECOMMENDED ONLY. Nothing below has been fixed;
all writes are gated behind CHECKPOINT ALPHA. Series: M (model logic), D (data/coverage),
C (calibration/bias), P (pipeline/process). Evidence class per claim: VERIFIED unless marked
INFERRED. Locations reference the audit artifacts that contain the full evidence.

| ID | Sev | Market(s) | Finding | Evidence | Status |
|---|---|---|---|---|---|
| M-101 | **P0** | F5, NRFI, FG | `games` grading columns grade a fixed away-side bet, not the model's pick; 104/104 stored `f5MlCorrect` follow "away won F5"; `nrfiCorrect` source vanished; `fgMlCorrect` never populated. Any consumer of these columns misreports accuracy. | GRADING-REPORT §M-101; query log 13:5x UTC | OPEN |
| M-103 | P1 | K props | Stored grades contradict raw data: 108/1,945 side labels, 197/1,943 correct flags, `modelError` matches no consistent definition. | grading/consistency-k-mismatches.csv | OPEN |
| C-001 | P1 | FG total | Totals under-projected −0.54 ±0.23 runs (n=1,467); survives leakage exclusion (−0.575 ±0.283, n=966); present in all slices, Apr/Jun/Jul. | GRADING-REPORT §C-001 | OPEN |
| C-002 | **P0** | K props | `kProj` biased −0.99 ±0.11 K; published over-probabilities anti-calibrated in tails (stated 7% → observed 46%; stated 84% → observed 31%); 87% of picks forced UNDER. | GRADING-REPORT §C-002; reliability tables | OPEN |
| C-003 | P1 | HR props | Negative Brier skill vs 10.97% base rate (0.09867 vs 0.09767, n=7,529); mean predicted 0.094 vs 0.110 actual (≈4.4σ low). | GRADING-REPORT §C-003 | OPEN |
| C-004 | P1 | NRFI | No signal: hit 51.3% ±2.5, Brier 0.2502 ≈ coin flip, non-monotone reliability. | GRADING-REPORT §C-004 | OPEN |
| C-005 | P2 | FG/F5 ML | Probabilities compressed toward 0.5 (underconfident); monotone reliability → scaling candidate. | GRADING-REPORT §C-005 | OPEN |
| D-001 | P1 | all | 11 completed games (8 DH game-2s) never created in `games`; zero projections, silently absent from product. | CENSUS-REPORT §D-001 | OPEN |
| D-002 | P1 | all | May 5–7 outage: 37 zombie games stuck live/upcoming, no outcome ingestion. | CENSUS-REPORT §D-002 | OPEN |
| D-003 | P2 | all | BOS@BAL 4/25→4/26 reschedule left a reverse orphan + unlinked schedule row. | CENSUS-REPORT §D-003 | OPEN |
| D-004 | P1 | game markets | 17 completed games lack all projections (incl. Opening Day NYY@SF). | CENSUS-REPORT §D-004 | OPEN |
| D-005 | P2 | NRFI | 512 games: `nrfiActualResult` set, `actualNrfiBinary` null (pure derivation). | CENSUS-REPORT §D-005 | OPEN |
| D-006 | P1 | HR props | June outage: 368/392 June games have zero HR props; Apr 5,529 rows lack projections; 1,990 rows on completed games lack actuals. | CENSUS-REPORT §D-006 | OPEN |
| D-007 | P1 | all game markets | Backtest ledger enrollment collapsed June onward: 654 completed games absent (Jun 341, Jul 202, May 111). | CENSUS-REPORT §D-007 | OPEN |
| D-008 | P1 | all | CLV/closingOdds never populated (0/12,720 rows) despite closing lines captured since 4/11; closing capture itself only ~65%. | CENSUS-REPORT §D-008 | OPEN |
| D-009 | P2 | K props | 539 completed-game prop rows lack `actualKs`; presumed scratches, needs row-level verification. | CENSUS-REPORT §D-009 | OPEN |
| D-010 | P2 | all | March: 100% of games quarantined in ledger (provenance, odds, actuals gaps). | CENSUS-REPORT §D-010 | OPEN |
| P-001 | P1 | all | Projection provenance destroyed: `modelRunAt` clobbered by re-runs (286 games ≥ first pitch, props avg +8.9h); pregame provenance unprovable; INFERRED values are genuine pregame (poor accuracy inconsistent with post-hoc contamination). | GRADING-REPORT §P-001 | OPEN |
| P-002 | P1 | all | No projection-level grading existed in production; ledger grades bets only; games grading columns dead. | GRADING-REPORT §P-002 | OPEN |
| P-003 | P2 | all | Probability scale inconsistency across columns (0–100 vs 0–1: `modelOverRate` vs `modelF5OverRate`/`modelPNrfi`). | schema + scale probes, action log | OPEN |
| P-004 | P2 | all | Zombie statuses (`live`/`upcoming` on past games) also poison `gameStatus`-derived logic; 2 games have `gameNumber=2` with `doubleHeader='N'`. | census probes | OPEN |

M-2xx reserved for Phase 0 dossier finding candidates (workflow in flight at time of writing;
appended after verification).

Not confirmed (logged to prevent re-litigation): F5 RL 47.7% (CI reaches 51%), FG-total tail
buckets (n small), June F5-total bias −1.5 (outage-contaminated sample). Retest post-backfill.
