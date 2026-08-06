# Source Boundary — MLB Modeling Run 2021-2026

Exclusive factual source: the ten warehouse tables documented and verified by
`docs/audits/mlb-warehouse-2026/` (manifest: WAREHOUSE-COVERAGE-MANIFEST.csv, 64/64 files).
All access read-only through the enforced query runner; every query shape registered in the
run's query-registry.csv; every extraction ledgered with row counts and artifact hashes.

Used: mlb_games, mlb_plays, mlb_pitches, mlb_boxscore_batting, mlb_boxscore_pitching,
mlb_people (native ids + hands only), mlb_officials (HP assignment), mlb_venues, mlb_seasons,
mlb_franchises (team_id identity only — slugs/alignment BLOCKED per W-1/W-3).

Not used (prohibited or blocked): internet/StatsAPI retrieval; application tables (games,
mlb_schedule_history, props, odds_history, replay tables); crosswalk ids (null in production,
W-1); external constants (linear weights, park factors, league baselines are all fit
in-window from warehouse rows inside the run's scripts).

BLOCKED_BY_DATA_BOUNDARY: all betting metrics (ROI/CLV/edge-vs-price) — the warehouse package
contains no odds, lines, prices, or quote timestamps. The precise missing requirement:
a verified table keyed game_pk + market + period + side + line + price + source +
quote_timestamp. Also blocked: app-model Iteration-0 exact reproduction (its 2021-2025
predictions never existed; its 2026 predictions live in application tables outside this
boundary — recorded as partially reproducible only).
