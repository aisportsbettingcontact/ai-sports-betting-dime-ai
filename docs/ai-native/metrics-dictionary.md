# Metrics dictionary — loop + model quality (v1)

Extends, and never duplicates, the product-analytics dictionary
(`server/analytics/metricDefinitions.ts`, `ua-metrics-v1` — DAU/WAU/MAU, honest
`{state,value,reason}` points, staff exclusion). All conventions below inherit that honesty
contract: a metric with no evidence is `not_measured`, thin evidence is `incomplete`; a
fabricated zero is a defect. Reporting timezone UTC; timestamps epoch-ms.

These four performance layers are DISTINCT and must never be substituted for one another
(truth contract):

| Layer | Question | Metrics | Source of truth |
|---|---|---|---|
| Model | Is the probability estimate good? | Brier mean (per model version), calibration buckets, **CLV mean** vs closing no-vig | `grading_record` artifacts / `mlb_game_backtest` (once wired) via `gradingByModelVersion()` |
| Policy | Do the recommendation thresholds make money at flat stake? | W/L/push record, profit units, flat-stake ROI (−110 convention, `calcRoi`) | same grading records filtered to EDGE decisions |
| Product | Does anyone see/use it? | feed views, decision-time views served, stale-display rate | `display_artifact` artifacts + product analytics |
| Economics | Is the spend worth it? | `usdPerVerifiedOutcome`, tokens per workflow, budget breaches | `workflow_cost` artifacts via `costPerVerifiedOutcome()` |

## Definitions (lineage explicit)

- **Graded record**: a non-superseded `grading_record` artifact. Corrections supersede;
  aggregates count only survivors (tested: "regrades through a correction").
- **Brier (record-level)**: `(modelProb − outcome)²`, computed only for WIN/LOSS records;
  VOID/PUSH/QUARANTINED/UNGRADED are excluded, never imputed.
- **CLV**: `modelProb − noVigProb(closingOdds, closingOddsOpposite)` (`calcCLV`,
  `server/mlbBacktestAuditCore.ts:330`). Null with a stated reason when no closing snapshot
  exists — never zero-filled.
- **Quarantine rate**: quarantined / graded, per model version. Zero-tolerance input to the
  promotion gate: any open quarantine blocks approval.
- **Verified outcome** (economics denominator): a grading record with settled grade
  (WIN/LOSS/PUSH). Verified leverage = value of verified outcome ÷ total workflow cost.
- **Minimum sample**: `MIN_GRADED_SAMPLE = 5` (fixture floor; production floor stays the
  audited n≥30/market from `server/mlbPublicationGate.ts` when wired).

## Reconciliation checks
- Sum of W+L+push+void+quarantined+ungraded per version == graded (enforced by construction
  in `gradingByModelVersion`; regression-tested).
- Every aggregate carries `evidence: artifactId[]` so any dashboard number can be traced to
  rows (queryable-company requirement).
- The model layer must never be reported as the policy layer: Brier/CLV speak to probability
  skill; ROI speaks to thresholds. A dashboard mixing them without labels is a defect.
