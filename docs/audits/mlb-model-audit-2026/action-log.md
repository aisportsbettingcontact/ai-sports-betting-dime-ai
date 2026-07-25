# MLB Model Audit 2026 — Action Log (append-only)

Format: `timestamp (UTC) | phase | action | evidence / findings`

- 2026-07-25T13:18:07Z | setup | Created scratch branch `local/audit-mlb-model-2026` from detached HEAD at `c9b5b903` (latest main merge). Created `docs/audits/mlb-model-audit-2026/{census,grading,calibration,tools}`. | git output in session
- 2026-07-25T13:18:07Z | setup | Verified `DATABASE_URL` is present in env (value never printed). mysql CLI and mysql2 driver both available. No prior progress ledger — fresh run. | shell output in session
- 2026-07-25T13:19:00Z | setup | Wrote `tools/db-query.mjs`: read-only query runner. Enforcement: statement allowlist (SELECT/SHOW/DESCRIBE/EXPLAIN/WITH) + `SET SESSION transaction_read_only = 1` so the server itself refuses writes during Phases 0-2. | file committed on scratch branch
