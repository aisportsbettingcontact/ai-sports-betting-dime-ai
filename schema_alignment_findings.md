# Schema Alignment Design — Findings (Read-Only Inspection)

## DATA-002 CLOSE-OUT (3 items)

### Item 1: Spread Edge Before/After
```
r16-089: spread_edge=0 (book=+1.5, model=+1.5) — UNCHANGED ✓
r16-090: spread_edge=-1 (book=+0.5, model=-0.5) — CHANGED from false-zero ✓
r16-092: spread_edge=0 (book=+0.5, model=+0.5) — UNCHANGED ✓
```
Expected behavior confirmed: r16-089/092 edges unchanged (both flipped together), r16-090 edge changed from 0 to -1.

### Item 2: r16-090 Model Convention — DEFINITIVE ANSWER
- model_spread=-0.5 IS correct HOME convention
- Model projects CAN 2.013 goals vs MAR 1.651 goals → CAN is model favorite
- model_spread=-0.5 means "home (CAN) gives 0.5 goals" = CAN is spread favorite ✓
- model_H_odds=+113 means CAN -0.5 is slight underdog on spread (must win by 1+, model only projects +0.36 margin)
- This is internally consistent: model sees CAN as slight favorite but not enough to reliably cover -0.5
- Cross-check with r16-089: model_spread=+1.5 (PAR gets 1.5), model_H_odds=-20509 (near-certain cover) — HOME convention confirmed
- **CONCLUSION: model_spread=-0.5 for r16-090 is correct HOME convention. Fix correctly left it unchanged.**

### Item 3: Provenance/Schema Check on 3 Touched Rows
```
r16-089: odds_source=ESPN_INGEST, insert_method=v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16
r16-090: odds_source=ESPN_INGEST, insert_method=v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16
r16-092: odds_source=ESPN_INGEST, insert_method=v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL5
```
- odds_source is stale (ESPN_INGEST) — known DB-014 issue, NOT touched by DATA-002 fix
- DATA-002 only modified spread columns via raw SQL — DB-008 dual-def doesn't affect it
- No re-stamp needed for DATA-002 scope; DB-014 handles odds_source separately

---

## §2 CURRENT-STATE MODEL

### Orphan Tables (18 in live DB, NOT in Drizzle)

| Table | Rows | Classification |
|-------|------|---------------|
| wc2026_data_lineage | 8 | PRODUCTION (audit trail) |
| wc2026_edges_bak_t3r | 54 | BACKUP (Tier 3 rollback) |
| wc2026_holdout_validation | 258 | PRODUCTION (model validation) |
| wc2026_market_edges | 54 | PRODUCTION (edge calculations) |
| wc2026_market_no_vig | 63 | PRODUCTION (no-vig probabilities) |
| wc2026_model_grades | 57 | PRODUCTION (model grading) |
| wc2026_model_runs | 20 | PRODUCTION (run tracking) |
| wc2026_mp_bak | 0 | BACKUP (empty, DROP candidate) |
| wc2026_mp_dedup_archive | 14 | BACKUP (dedup archive) |
| wc2026_novig_bak_t3r | 63 | BACKUP (Tier 3 rollback) |
| wc2026_odds_bak_t2 | 0 | BACKUP (empty, DROP candidate) |
| wc2026_odds_bak_tier2 | 92 | BACKUP (Tier 2 rollback) |
| wc2026_orphan_match_odds_quarantine | 12 | BACKUP (quarantine) |
| wc2026_proj_bak_t3r | 92 | BACKUP (Tier 3 rollback) |
| wc2026_proj_bak_tier2 | 92 | BACKUP (Tier 2 rollback) |
| wc2026_provider_match_map | 92 | PRODUCTION (provider ID mapping) |
| wc2026_rec_bak_t3r | 264 | BACKUP (Tier 3 rollback) |
| wc2026_recommendations | 264 | PRODUCTION (bet recommendations) |

**DROP candidates (8 backup/quarantine tables):**
- wc2026_edges_bak_t3r (54 rows)
- wc2026_mp_bak (0 rows)
- wc2026_mp_dedup_archive (14 rows)
- wc2026_novig_bak_t3r (63 rows)
- wc2026_odds_bak_t2 (0 rows)
- wc2026_odds_bak_tier2 (92 rows)
- wc2026_orphan_match_odds_quarantine (12 rows)
- wc2026_proj_bak_t3r (92 rows)
- wc2026_proj_bak_tier2 (92 rows)
- wc2026_rec_bak_t3r (264 rows)

**ADOPT candidates (8 production tables):**
- wc2026_data_lineage
- wc2026_holdout_validation
- wc2026_market_edges
- wc2026_market_no_vig
- wc2026_model_grades
- wc2026_model_runs
- wc2026_provider_match_map
- wc2026_recommendations

### DB-008: wc2026MatchOdds 3-Way Diff

**Live DB (52 columns):** Full CREATE TABLE captured — includes all columns from both schema files plus extras.

**schema.ts:2993 definition:** Need to read and compare.
**wc2026.schema.ts:533 definition:** Need to read and compare.

Key observations from live DB CREATE TABLE:
- 52 columns total
- Primary key: id (bigint unsigned AUTO_INCREMENT)
- Unique key: uq_wc2026_match_odds_match (match_id)
- Index: idx_wc2026_match_odds_match (match_id)
- Includes: espn_match_id, espn_slug, bet_explorer_match_id, bet_explorer_slug
- Includes: world_cup_stage (enum), world_cup_round (enum)
- Includes: inserted_at, insert_method, last_inserted_at, last_insert_method
- Includes: all book_* and model_* columns
- Includes: lamba_home/away, model_projected_home/away_goals
- Includes: odds_updated_at, odds_source, market_status

### DB-007: wc2026_model_projections Drift

**Live DB columns (from SHOW CREATE):**
- id, match_id, model_version, engine_version, lambda_home, lambda_away
- home_win_prob, draw_prob, away_prob, nv_home_prob, nv_draw_prob, nv_away_prob
- home_edge, draw_edge, away_edge, model_lean, lean_prob
- fav_fragility_score, draw_quality_score, underdog_viability, xg_balance_ratio
- book_odds (json), top_scorelines (json), home_goal_dist (json), away_goal_dist (json)
- home_win_by_1/2/3plus, away_win_by_1/2/3plus
- full_output (json), modeled_at, created_at
- nv_dc_1x, nv_dc_x2, dc_1x_odds, dc_x2_odds
- nv_no_draw_home, nv_no_draw_away, no_draw_home_odds, no_draw_away_odds
- btts_yes_odds, btts_no_odds
- to_advance_home_prob/away_prob, to_advance_home_odds/away_odds
- is_frozen, frozen_at, calculation_method, actual_simulations
- xg_source, holdout_validated, integrity_flags (json)
- UNIQUE KEY uq_match_version (match_id, model_version)

### Production Orphan Table Schemas (SHOW CREATE captured):
- wc2026_data_lineage: 8 rows, tracks data operations
- wc2026_holdout_validation: 258 rows, model holdout test results
- wc2026_market_edges: 54 rows, edge calculations per market/selection
- wc2026_market_no_vig: 63 rows, no-vig probability calculations
- wc2026_model_grades: 57 rows, model quality metrics
- wc2026_model_runs: 20 rows, engine run tracking
- wc2026_provider_match_map: 92 rows, ESPN/BetExplorer ID mapping
- wc2026_recommendations: 264 rows, bet recommendations with status

---

## STILL NEEDED (next steps in analysis):
1. Read Drizzle definitions for wc2026MatchOdds from both schema files → complete 3-way diff
2. Read Drizzle definition for wc2026_model_projections → column delta vs live
3. Drizzle-kit hang diagnosis (inspect journal, test generate)
4. DB-014: insert_method → real-source mapping
5. §4-§6: Failure modes, dependency slices, readiness gate
