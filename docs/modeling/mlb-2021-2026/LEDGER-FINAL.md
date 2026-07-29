# Final Ledger Checksum — MLB 2021–2026 Modeling Run

- Ledger file: `ledger.jsonl` (copy of the run's `mlb-modeling-ledger.jsonl`)
- Events: 41 (append-only, monotonic ids, SHA-256 hash chain)
- Chain verification: `ledger.py verify` → **OK, chain intact**
- Head event hash: `c30a8a090c1d6c61` (event 41, `run-complete-reconciliation`)
- File SHA-256: `20efb041082646770eb818045c974015388f514c04c3843e72fb5cb2e4e02572`

Key events: 1–22 P0–P5 (extraction → ladder → verdicts v1), 23 P6 directive, 24–28
states/screening/engine/smoke, 29 v1 400k completion, 31 v1 mean-model defect finding,
32–34 v2 refit + screening, 35–36 v2 400k launch/completion, 37 v2 scoring, 38 revised
verdicts (7× REINFORCE), 39 P5-report metric erratum, 40 deliverables, 41 completion
reconciliation.

Any modification to any event invalidates every subsequent event hash; re-verify with:
`python ledger.py verify` (run directory) or by recomputing the chain from this copy.
