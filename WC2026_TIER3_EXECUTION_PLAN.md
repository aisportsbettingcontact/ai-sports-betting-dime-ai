# WC2026 Tier 3 Execution Plan

**Status:** READY FOR EXECUTION (Tier 1 gate passed)  
**Target:** Tier 3 — Paid Edge Intelligence  
**Prerequisite:** Tier 1 Basic Display Safe ✓ (achieved 2026-07-06)

---

## Execution Scope

| # | Work Item | Category | Priority | Estimated Effort |
|---|-----------|----------|----------|-----------------|
| B1 | Canonical provider match mapping table | Data | P0 | 2h |
| B2 | Repair 60 mappable MatchOdds rows | Data | P0 | 1h |
| B3 | Quarantine 12 unmappable MatchOdds rows | Data | P0 | 30m |
| B4 | No-vig probability computation | Model | P0 | 2h |
| B5 | Edge computation (model vs book) | Model | P0 | 2h |
| B6 | Recommendation state engine | Model | P1 | 3h |
| B7 | Point-in-time model leakage fix | Model | P1 | 3h |
| B8 | Dime WC2026 context builder | AI | P1 | 4h |
| B9 | Lineage automation (source tracking) | Pipeline | P2 | 3h |
| B10 | CLV tracking infrastructure | Analytics | P2 | 4h |
| B11 | Warehouse-grade launch gate | Ops | P2 | 2h |

---

## B1: Canonical Provider Match Mapping Table

**Objective:** Create a single truth-source mapping between platform match IDs (wc26-g-XXX) and external provider IDs (ESPN, BetExplorer, StatsBomb).

**Schema:**
```sql
CREATE TABLE wc2026_match_provider_map (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id VARCHAR(16) NOT NULL,
  provider ENUM('espn', 'betexplorer', 'statsbomb', 'sofascore') NOT NULL,
  provider_match_id VARCHAR(64) NOT NULL,
  confidence ENUM('verified', 'inferred', 'quarantined') NOT NULL DEFAULT 'inferred',
  mapped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_match_provider (match_id, provider),
  UNIQUE KEY uq_provider_id (provider, provider_match_id),
  FOREIGN KEY (match_id) REFERENCES wc2026_matches(match_id)
);
```

**Population:** Seed from existing `wc2026_espn_bracket_matches.espn_match_id` → `match_id` mapping.

---

## B2: Repair 60 Mappable MatchOdds Rows

**Objective:** Update 60 MatchOdds rows that use ESPN match IDs (wc26-gs-XXXXXX) to use platform IDs (wc26-g-XXX) via the mapping table.

**Method:**
```sql
UPDATE wc2026MatchOdds o
JOIN wc2026_match_provider_map m 
  ON m.provider = 'espn' AND m.provider_match_id = o.match_id
SET o.match_id = m.match_id
WHERE o.match_id LIKE 'wc26-gs-%';
```

**Verification:** All MatchOdds.match_id values exist in wc2026_matches.match_id.

---

## B3: Quarantine 12 Unmappable MatchOdds Rows

**Objective:** Mark 12 MatchOdds rows with ESPN IDs that have no corresponding platform match as quarantined.

**Method:** Add `status` column to MatchOdds or move to quarantine table.

---

## B4: No-Vig Probability Computation

**Objective:** Compute fair (no-vig) probabilities from book odds for every match with odds data.

**Formula:**
```
implied_prob = |odds| / (|odds| + 100)  [for negative odds]
implied_prob = 100 / (odds + 100)       [for positive odds]
nv_prob = implied_prob / sum(all_implied_probs)
```

**Storage:** Add `nv_home_ml`, `nv_draw_ml`, `nv_away_ml` columns to wc2026_model_projections or create dedicated table.

---

## B5: Edge Computation (Model vs Book)

**Objective:** Compute edge = model_prob - nv_book_prob for each market (ML, spread, total).

**Requirements:**
- Join model projections to MatchOdds via match_id
- Compute no-vig from book odds (B4)
- Calculate edge for: home ML, draw, away ML, over, under
- Store edge values in projections table

**Edge formula:** `edge = model_prob - nv_book_prob`

---

## B6: Recommendation State Engine

**Objective:** Classify each match/market into recommendation states based on edge thresholds.

**States:**
- `STRONG_PLAY` — edge > 8%
- `LEAN` — edge 4-8%
- `NO_BET` — edge < 4% or insufficient data
- `FADE` — negative edge > 4%

**Storage:** Add `rec_state` enum column to projections or create `wc2026_recommendations` table.

---

## B7: Point-in-Time Model Leakage Fix

**Objective:** Fix the xG query in v19 engine to only use data from matches played BEFORE the target match date.

**Current bug:** `buildGSRows()` at line 292 uses ALL xG data including future matches for backtest.

**Fix:**
```javascript
// In buildGSRows, filter xgAll by match date
const cutoffDate = match.kickoff_utc;
const xgFiltered = xgAll.filter(x => new Date(x.match_date) < cutoffDate);
```

**Verification:** Re-run backtest with fix, compare calibration metrics.

---

## B8: Dime WC2026 Context Builder

**Objective:** Inject live WC2026 data into Dime's system prompt so it can answer questions about matches, odds, projections, and edges.

**Architecture:**
1. Create `server/wc2026/dime-context-builder.ts`
2. Query latest projections, odds, standings, and results
3. Format as structured context block
4. Inject into system prompt before Claude call

**Context template:**
```
## WC2026 Live Data (as of {timestamp})
### Upcoming Matches: {list with odds and projections}
### Recent Results: {last 5 matches with scores}
### Current Edges: {matches with edge > 4%}
### Group Standings: {current standings}
```

---

## B9: Lineage Automation

**Objective:** Automatically log every data write to `wc_source_lineage` with provider, timestamp, and row count.

**Current state:** Zero active code writes to lineage table (0% coverage).

**Fix:** Add lineage logging to:
- ESPN heartbeat (after match ingest)
- BetExplorer scraper (after odds ingest)
- Model engine (after projection write)

---

## B10: CLV Tracking Infrastructure

**Objective:** Track Closing Line Value by capturing odds at bet-time and at close.

**Schema:**
```sql
CREATE TABLE wc2026_clv_tracking (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id VARCHAR(16) NOT NULL,
  market ENUM('ml_home', 'ml_draw', 'ml_away', 'spread_home', 'spread_away', 'over', 'under') NOT NULL,
  rec_state VARCHAR(32),
  odds_at_recommendation DOUBLE,
  odds_at_close DOUBLE,
  clv_cents DOUBLE,
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES wc2026_matches(match_id)
);
```

---

## B11: Warehouse-Grade Launch Gate

**Objective:** Define and verify all criteria for Tier 5 warehouse-grade status.

**Criteria:**
- [ ] Zero orphan rows across all tables
- [ ] 100% lineage coverage
- [ ] All model versions have calibration metrics
- [ ] CLV tracking active
- [ ] Dime context builder active with freshness < 1h
- [ ] All odds have source + timestamp
- [ ] All projections have model hash
- [ ] Point-in-time discipline enforced
- [ ] Backtest holdout separation verified

---

## Execution Order

```
Phase 1 (Data Foundation): B1 → B2 → B3
Phase 2 (Edge Intelligence): B4 → B5 → B6
Phase 3 (Model Integrity): B7
Phase 4 (AI Enhancement): B8
Phase 5 (Observability): B9 → B10 → B11
```

**Estimated total:** ~26 hours of focused execution

---

## Non-Negotiable Rules (Carried Forward)

1. Backup before every DB change
2. Pre-state capture before every modification
3. Verify immediately after execution
4. Record rollback for every change
5. Fail closed on ambiguous data
6. Quarantine unknown mappings — never force-map
7. No silent writes
8. No duplicate truth sources
