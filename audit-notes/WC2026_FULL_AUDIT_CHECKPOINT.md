# WC2026 Full DB Completeness + Accuracy Audit

**Timestamp:** 2026-07-08T02:00 UTC  
**Type:** Read-only audit, zero writes/DDL  
**Ground truth:** 104 total matches; 92 played (FT); 12 unplayed  
**Played breakdown:** GROUP=72 (Jun 11–Jun 28), R32=16 (Jun 28–Jul 4), R16=4 (Jul 5–Jul 7)

---

## PART 1: B3 DUPLICATE DETECTION (Full Keys)

Evidence file: `audit-notes/EVIDENCE_PART1.txt`

### Tables with Duplicates

| Table | Natural Key | Dupe Groups | Unique Constraint? | Sample Keys |
|-------|-------------|-------------|-------------------|-------------|
| wc2026_model_projections | match_id, model_version | 18 | YES (uq_match_version) | wc26-g-037 v4.2, wc26-g-049 v4.2, wc26-g-050 v4.2 (cnt=2-3) |
| wc2026_espn_shot_map | espn_match_id, period, clock, playerName, shotType | 17 | NO (PRIMARY only) | Multiple matches with duplicate shot entries |
| wc2026_lineups | match_id, player_name, team_id | 157 | NO (PRIMARY only) | Widespread across 60 matches |
| wc2026_match_events | match_id, event_type, minute, player | 80+ | NO (PRIMARY only) | wc26-g-001 VAR min=25, wc26-g-002 SUB min=64 (cnt=2-3) |
| wc2026_holdout_validation | match_id, selection | 48 | YES (uq_holdout) | wc26-g-037 HOME/AWAY/DRAW (cnt=2), wc26-g-049 (cnt=3) |
| wc2026_recommendations | match_id, market, selection | 48 | YES (uq_rec_*) | Same match set as holdout (wc26-g-037 through g-066) |
| wc2026_odds_snapshots | match_id, snapshot_ts, market, selection | 670+ | NO (PRIMARY only) | wc26-g-035 1X2 home (cnt=9), massive duplication |

### Unique Constraint Status [VERIFIED]

| Table | Constraints |
|-------|-------------|
| wc2026_model_projections | PRIMARY, uq_match_version |
| wc2026_holdout_validation | PRIMARY, uq_holdout |
| wc2026_recommendations | PRIMARY, uq_rec_match_ver_mkt_sel, uq_rec_match_model_market_selection |
| wc2026_espn_shot_map | PRIMARY only |
| wc2026_lineups | PRIMARY only |
| wc2026_match_events | PRIMARY only |
| wc2026_odds_snapshots | PRIMARY only |

**Finding:** Tables WITH unique constraints (model_projections, holdout, recommendations) should NOT have dupes — indicates constraint was added AFTER data was inserted, or ON DUPLICATE KEY logic failed. Tables WITHOUT constraints (shot_map, lineups, match_events, odds_snapshots) have no guard against re-insertion.

---

## PART 2: COMPLETENESS TARGETS + ACCEPT-GAP RECLASSIFICATION

Evidence file: `audit-notes/EVIDENCE_PART23.txt`

### Completeness Target Definition

| Table | Target | Rationale |
|-------|--------|-----------|
| wc2026_matches | 104 | All fixtures (played + unplayed) |
| wc2026_espn_matches | 92 | All played matches |
| wc2026_espn_team_stats | 92 | All played matches |
| wc2026_espn_match_stats | 92 | All played matches |
| wc2026_espn_expected_goals | 92 | All played matches |
| wc2026_espn_shot_map | 92 | All played matches |
| wc2026_espn_player_stats | 92 | All played matches |
| wc2026_espn_lineups | 92 | All played matches |
| wc2026MatchOdds | 92 | All played matches (pre-match odds) |
| wc2026_model_projections | 68 (92 minus 24 MD1) | Model didn't exist for MD1 |
| wc2026_frozen_book_odds | 92 | All played matches (snapshot at kickoff) |
| wc2026_holdout_validation | 68 | Same as model_projections |
| wc2026_recommendations | 68 | Same as model_projections |
| wc2026_market_edges | 68 | Derived from model vs book |
| wc2026_market_no_vig | 68 | Derived from book odds |
| wc2026_match_stats | 92 | All played matches |
| wc2026_match_events | 92 | All played matches |
| wc2026_lineups | 92 | All played matches |
| wc2026_odds_snapshots | 92 | All played matches |

### ACCEPT-GAP: 24 MD1 Matches (g-001 to g-024) [VERIFIED]

**Evidence:**
- MD1 matches played: 2026-06-11 to 2026-06-18
- First model projection created: 2026-06-19T04:53:34Z (match_id=wc26-g-029, model_version=v7.0)
- Model projections for MD1: **0 rows** [VERIFIED]
- Holdout validation for MD1: **0 rows** [VERIFIED]
- Recommendations for MD1: **0 rows** [VERIFIED]
- Market edges for MD1: **0 rows** [VERIFIED]
- Market no-vig for MD1: **1 match** (wc26-g-001 only) [VERIFIED]
- Frozen book odds for MD1: **0 rows** [VERIFIED]

**Verdict:** MD1 gap is a **TEMPORAL GAP** — the model system was not operational until Jun 19. These 24 matches are permanently missing from model-derived tables. ACCEPT-GAP classification: **LEGITIMATE-UNPLAYED-EQUIVALENT** (system didn't exist).

### Cross-Table Odds Divergence [VERIFIED]

**19 matches** have different odds values between `wc2026_frozen_book_odds` and `wc2026MatchOdds`:

| Match | FBO home_ml | MO home_ml | FBO away_ml | MO away_ml |
|-------|-------------|------------|-------------|------------|
| wc26-r32-073 | 475 | 400 | -145 | -120 |
| wc26-r32-074 | -140 | -133 | 425 | 400 |
| wc26-r32-075 | -275 | -303 | 800 | 850 |
| wc26-r32-077 | 255 | 270 | 240 | 110 |
| wc26-r32-078 | -340 | -345 | 475 | 900 |
| wc26-r32-081 | 115 | -110 | 270 | 320 |
| wc26-r32-087 | -588 | -714 | 1400 | 1800 |
| wc26-r16-089 | 1400 | 1600 | -500 | -588 |
| ... | ... | ... | ... | ... |

**Interpretation [INFERRED]:** `frozen_book_odds` = snapshot at kickoff time; `wc2026MatchOdds` = latest BetExplorer scrape (may be closing line). Both are legitimate but represent DIFFERENT timestamps. This is expected behavior, not a data integrity issue, IF the design intent is frozen=kickoff vs MatchOdds=closing. However, if both should represent the same moment, this is a B5 accuracy failure for one of them.

---

## PART 3: B2 GAP EVIDENCE (Missing Match IDs)

Evidence file: `audit-notes/EVIDENCE_PART1.txt` (section 1.3)

### ESPN Tables

| Table | Have | Target | Missing IDs | Classification |
|-------|------|--------|-------------|----------------|
| wc2026_espn_matches | 92 | 92 | NONE | COMPLETE |
| wc2026_espn_team_stats | 90 | 92 | r16-091, r16-092 | COVERAGE-GAP |
| wc2026_espn_match_stats | 90 | 92 | r16-091, r16-092 | COVERAGE-GAP |
| wc2026_espn_expected_goals | 90 | 92 | r16-091, r16-092 | COVERAGE-GAP |
| wc2026_espn_shot_map | 89 | 92 | r16-091, r16-092, r32-086 | COVERAGE-GAP |
| wc2026_espn_player_stats | 89 | 92 | r16-091, r16-092, r32-086 | COVERAGE-GAP |
| wc2026_espn_lineups | 89 | 92 | r16-091, r16-092, r32-086 | COVERAGE-GAP |

### Odds/Model Tables

| Table | Have | Target | Missing IDs | Classification |
|-------|------|--------|-------------|----------------|
| wc2026MatchOdds | 84 | 92 | g-025..g-028, g-037..g-044 (12 total) | COVERAGE-GAP (DB-009) |
| wc2026_model_projections | 72 | 68 | g-001..g-024 (ACCEPT-GAP) | EXCEEDS TARGET (+4 extra versions) |
| wc2026_frozen_book_odds | 37 | 92 | 55 matches missing | MAJOR COVERAGE-GAP |
| wc2026_holdout_validation | 64 | 68 | g-001..g-024 (ACCEPT), r16-091/092/095/096 | COVERAGE-GAP (4 R16) |
| wc2026_recommendations | 66 | 68 | g-001..g-024 (ACCEPT), r16-095/096 | COVERAGE-GAP (2 R16) |
| wc2026_market_edges | 18 | 68 | 74 missing (only R16+some R32 covered) | MAJOR COVERAGE-GAP |
| wc2026_market_no_vig | 21 | 68 | 73 missing | MAJOR COVERAGE-GAP |
| wc2026_odds_snapshots | 72 | 92 | All R32+R16 (20 missing) | COVERAGE-GAP |

### Match Stats/Events/Lineups (non-ESPN)

| Table | Have | Target | Missing IDs | Classification |
|-------|------|--------|-------------|----------------|
| wc2026_match_stats | 63 | 92 | 29 missing (g-025..g-028, g-037..g-044, all R32+R16) | COVERAGE-GAP |
| wc2026_match_events | 62 | 92 | 30 missing | COVERAGE-GAP |
| wc2026_lineups | 60 | 92 | 32 missing | COVERAGE-GAP |

---

## PART 4: FRESH-CONTEXT RE-VERIFICATION (8 Tables)

Evidence file: `audit-notes/EVIDENCE_PART4_REVERIFY.txt`  
Timestamp: 2026-07-08T01:57:59.895Z

| Table | Row Count | Distinct IDs | Dupe Groups | Prior Report Match? |
|-------|-----------|--------------|-------------|---------------------|
| wc2026_matches | 104 | 104 | 0 | YES [VERIFIED] |
| wc2026_espn_matches | 92 | 92 | 0 | YES [VERIFIED] |
| wc2026_espn_shot_map | 2251 | 89 | 17 | YES [VERIFIED] |
| wc2026MatchOdds | 84 | 84 | 0 | YES [VERIFIED] |
| wc2026_model_projections | 96 | 72 | 18 | YES [VERIFIED] |
| wc2026_holdout_validation | 258 | 64 | 48 | YES [VERIFIED] |
| wc2026_odds_snapshots | 4384 | 72 | 670 | YES [VERIFIED] |
| wc2026_lineups | 2484 | 60 | 157 | YES [VERIFIED] |

**All 8 tables match prior report exactly.** No drift between runs.

---

## PART 5: B5 ACCURACY SPOT-CHECKS

Evidence file: `audit-notes/EVIDENCE_PART5_ACCURACY.txt`

| Match | ESPN ID | DB Score | Live Score | Team Match | Score Match | Possession Match |
|-------|---------|----------|------------|------------|-------------|------------------|
| wc26-g-001 (MEX vs RSA) | 760415 | 2-0 | 2-0 | PASS [VERIFIED] | PASS [VERIFIED] | DB=60.5% LIVE=60.5% PASS [VERIFIED] |
| wc26-r32-073 (RSA vs CAN) | 760486 | 0-1 | 0-1 | PASS [VERIFIED] | PASS [VERIFIED] | DB=58.4% LIVE=58.4% PASS [VERIFIED] |
| wc26-r16-096 (SUI vs COL) | 760508 | 0-0 | 0-0 | PASS [VERIFIED] | PASS [VERIFIED] | DB=53.2% LIVE=53.2% PASS [VERIFIED] |

**Live source URLs (reproducible):**
- https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760415
- https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760486
- https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760508

**Result: 3/3 PASS on all axes. Zero accuracy failures.**

---

## B7: TRIPLE-GATE SCORECARD

### Gate Definitions
- **COMPLETE (B2):** Distinct match_id count = target (or ACCEPT-GAP documented)
- **CLEAN (B3):** Zero duplicate groups on natural key
- **ACCURATE (B5):** Spot-check values match live source

| Table | COMPLETE | CLEAN | ACCURATE | VERDICT |
|-------|----------|-------|----------|---------|
| wc2026_matches | PASS (104/104) | PASS (0 dupes) | N/A (reference) | **PASS** |
| wc2026_espn_matches | PASS (92/92) | PASS (0 dupes) | PASS (3/3) | **PASS** |
| wc2026_espn_team_stats | FAIL (90/92, -2) | PASS (0 dupes) | PASS (possession) | **FAIL** |
| wc2026_espn_match_stats | FAIL (90/92, -2) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_espn_expected_goals | FAIL (90/92, -2) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_espn_shot_map | FAIL (89/92, -3) | FAIL (17 dupes) | N/A | **FAIL** |
| wc2026_espn_player_stats | FAIL (89/92, -3) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_espn_lineups | FAIL (89/92, -3) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_espn_glossary | PASS (20 static) | PASS (0 dupes) | N/A | **PASS** |
| wc2026MatchOdds | FAIL (84/92, -8) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_model_projections | PASS (72/68 target) | FAIL (18 dupes) | N/A | **FAIL** |
| wc2026_frozen_book_odds | FAIL (37/92, -55) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_holdout_validation | FAIL (64/68, -4) | FAIL (48 dupes) | N/A | **FAIL** |
| wc2026_recommendations | FAIL (66/68, -2) | FAIL (48 dupes) | N/A | **FAIL** |
| wc2026_market_edges | FAIL (18/68, -50) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_market_no_vig | FAIL (21/68, -47) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_match_stats | FAIL (63/92, -29) | PASS (0 dupes) | N/A | **FAIL** |
| wc2026_match_events | FAIL (62/92, -30) | FAIL (80+ dupes) | N/A | **FAIL** |
| wc2026_lineups (non-ESPN) | FAIL (60/92, -32) | FAIL (157 dupes) | N/A | **FAIL** |
| wc2026_odds_snapshots | FAIL (72/92, -20) | FAIL (670 dupes) | N/A | **FAIL** |

### Summary: **3 PASS, 17 FAIL**

---

## POPULATION PLAN (Dependency-Ordered, No Execution)

### Priority 0: Deduplication (prerequisite for all population)

| Table | Action | Rows Affected (est.) |
|-------|--------|---------------------|
| wc2026_odds_snapshots | DELETE dupes keeping MIN(id) per natural key | ~3000+ |
| wc2026_lineups (non-ESPN) | DELETE dupes keeping MIN(id) per natural key | ~1200+ |
| wc2026_match_events | DELETE dupes keeping MIN(id) per natural key | ~300+ |
| wc2026_espn_shot_map | DELETE dupes keeping MIN(id) per natural key | ~34 |
| wc2026_model_projections | DELETE dupes keeping latest per match_id+model_version | ~24 |
| wc2026_holdout_validation | DELETE dupes keeping latest per match_id+selection | ~48 |
| wc2026_recommendations | DELETE dupes keeping latest per match_id+market+selection | ~48 |

**Then:** Add UNIQUE constraints on natural keys for tables that lack them.

### Priority 1: ESPN Coverage Gaps (3 matches)

| Match | ESPN ID | Missing From | Source | Method |
|-------|---------|-------------|--------|--------|
| wc26-r16-091 | 760504 | team_stats, match_stats, xG, shot_map, player_stats, lineups | ESPN API (live) | Run espnDbIngester scoped to 760504 |
| wc26-r16-092 | 760505 | team_stats, match_stats, xG, shot_map, player_stats, lineups | ESPN API (live) | Run espnDbIngester scoped to 760505 |
| wc26-r32-086 | 760499 | shot_map, player_stats, lineups | ESPN API (live) | Run espnDbIngester scoped to 760499 |

### Priority 1b: Odds Population (DB-009 resolution)

- 8 matches missing from wc2026MatchOdds entirely (g-025..g-028, g-037..g-044 minus existing)
- 59 skeleton rows needing real book odds (DB-009/DB-014 cross-ref)
- Source: wc2026_odds_snapshots (has 72 matches of historical data) + BetExplorer re-scrape for missing
- **MUST write odds_source with real provenance on every row**

### Priority 2: Frozen Book Odds (55 matches missing)

- Reconstruct from wc2026_odds_snapshots (last snapshot before kickoff_utc per match)
- For matches without snapshots: BetExplorer historical closing lines
- 37 currently populated; need 55 more

### Priority 3: Model-Derived Tables (market_edges, market_no_vig)

- Depends on: MatchOdds being complete (Priority 1b)
- Re-run model pipeline for all matches with complete odds
- Expected coverage: 68 matches (92 minus 24 MD1 ACCEPT-GAP)

### Priority 4: Non-ESPN Match Stats/Events/Lineups (29-32 matches)

- Source: UNKNOWN — these tables appear to be populated by a separate pipeline (not ESPN ingester)
- Missing: all R32 (76-88) + some group matches (25-28, 37-44) + all R16
- Need to identify the writer/source before population

### Tables That CANNOT Reach 100%

| Table | Max Achievable | Reason |
|-------|---------------|--------|
| wc2026_model_projections | 68/92 (74%) | 24 MD1 matches pre-date model existence. Permanent gap. |
| wc2026_holdout_validation | 68/92 (74%) | Same as model_projections |
| wc2026_recommendations | 68/92 (74%) | Same as model_projections |
| wc2026_market_edges | 68/92 (74%) | Derived from model; same limitation |
| wc2026_market_no_vig | 68/92 (74%) | Derived from book odds; MD1 odds may be recoverable but model isn't |

---

## CARRY-FORWARD ITEMS (Not Executed)

- **FE/DB-015** (P3): Penalty-status enum gap. 2 vulnerable consumers identified. Remediation scoped.
- **DB-014** (HALF-OPEN): 6-site engine-code fix scoped. Closes when it ships.
- **DB-013 DROP** (Authorization B): 10 backup tables. Gated on mysqldump + explicit go.
- **Cross-table divergence:** 19 matches with FBO≠MO odds. Needs design-intent clarification (frozen=kickoff vs closing).

---

## EVIDENCE FILES

All raw query outputs preserved in:
- `audit-notes/EVIDENCE_PART1.txt` — B3 dupes + B2 gaps
- `audit-notes/EVIDENCE_PART23.txt` — Completeness targets + cross-table divergence
- `audit-notes/EVIDENCE_PART4_REVERIFY.txt` — Fresh re-verification
- `audit-notes/EVIDENCE_PART5_ACCURACY.txt` — Live ESPN API spot-checks

**HOLD.** No writes executed. Population plan gated on DB-013 DROP + backup + explicit go.
