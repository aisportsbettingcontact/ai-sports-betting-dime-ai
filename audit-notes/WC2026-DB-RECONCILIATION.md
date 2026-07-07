# WC2026 Deep Database Reconciliation Report

**Date:** 2026-07-07  
**Scope:** Read-only analysis of all WC2026 data tables — inventory, coverage, integrity, gaps, and population plan  
**Status:** ANALYSIS COMPLETE — awaiting owner go-ahead before any population work

---

## 1. Executive Summary

The WC2026 data pipeline covers **90 played matches** (of 104 total) across **38 live database tables** (20 in Drizzle schema + 18 orphan/production tables). Referential integrity is **CLEAN** — zero orphan foreign keys across all relationships tested. The primary gaps are:

1. **Model projections** missing for the first 24 group matches (Matchday 1-2)
2. **BetExplorer odds** stopped scraping at Round of 32 (18 matches missing)
3. **wc2026MatchOdds** has 82 rows but only 23 are fully populated (59 skeleton rows)
4. **ESPN data** is near-complete (87-90/90) with only 2-3 recent matches pending ingestion

---

## 2. Ground Truth

| Metric | Value |
|--------|-------|
| Total matches in `wc2026_matches` | 104 |
| Played (status=FT) | 90 |
| Scheduled (future) | 14 |
| Stage breakdown | GROUP=72, R32=16, R16=8, QF=4, SF=2, THIRD=1, FINAL=1 |

The 14 scheduled matches include 6 R16 (Jul 4-7) and 8 QF/SF/THIRD/FINAL (TBD dates).

---

## 3. Table Inventory

### 3.1 Drizzle-Managed Tables (20)

| Table | Rows | Match Coverage | Coverage % |
|-------|------|---------------|-----------|
| wc2026_matches | 104 | — | — |
| wc2026_teams | 49 | — | — |
| wc2026_venues | 16 | — | — |
| wc2026_team_aliases | 26 | — | — |
| wc2026_odds_snapshots | 4,384 | 72/90 | 80% |
| wc2026_lineups | 2,484 | 60/90 | 67% |
| wc2026_match_stats | 63 | 63/90 | 70% |
| wc2026_match_events | 1,422 | 62/90 | 69% |
| wc2026_model_projections | 94 | 70/90 | 78% |
| wc2026_frozen_book_odds | 37 | 37/90 | 41% |
| wc2026_espn_bracket | 32 | — | — |
| wc2026MatchOdds | 82 | 82/90 | 91% |
| wc2026_espn_matches | 90 | 90/90 | **100%** |
| wc2026_espn_team_stats | 88 | 88/90 | 98% |
| wc2026_espn_match_stats | 88 | 88/90 | 98% |
| wc2026_espn_expected_goals | 88 | 88/90 | 98% |
| wc2026_espn_shot_map | 2,195 | 87/90 | 97% |
| wc2026_espn_player_stats | 2,742 | 87/90 | 97% |
| wc2026_espn_lineups | 4,460 | 87/90 | 97% |
| wc2026_espn_glossary | 20 | — | — |

### 3.2 Orphan Tables (18 — in live DB, NOT in Drizzle schema)

| Table | Rows | Classification |
|-------|------|---------------|
| wc2026_market_edges | 54 | **ACTIVE** — DIME reads |
| wc2026_market_no_vig | 63 | **ACTIVE** — DIME reads |
| wc2026_recommendations | 264 | **ACTIVE** — DIME reads |
| wc2026_holdout_validation | 258 | **ACTIVE** — model validation |
| wc2026_model_grades | 57 | **ACTIVE** — model grading |
| wc2026_model_runs | 20 | **ACTIVE** — execution history |
| wc2026_data_lineage | 8 | **ACTIVE** — provenance |
| wc2026_provider_match_map | 92 | **ACTIVE** — ID mapping |
| wc2026_edges_bak_t3r | 54 | BACKUP |
| wc2026_novig_bak_t3r | 63 | BACKUP |
| wc2026_rec_bak_t3r | 264 | BACKUP |
| wc2026_proj_bak_t3r | 92 | BACKUP |
| wc2026_proj_bak_tier2 | 92 | BACKUP |
| wc2026_odds_bak_t2 | 0 | BACKUP (empty) |
| wc2026_odds_bak_tier2 | 92 | BACKUP |
| wc2026_mp_bak | 0 | BACKUP (empty) |
| wc2026_mp_dedup_archive | 14 | ARCHIVE |
| wc2026_orphan_match_odds_quarantine | 12 | QUARANTINE |

**DB-013 Schema Absence Finding:** 8 active production tables (market_edges, market_no_vig, recommendations, holdout_validation, model_grades, model_runs, data_lineage, provider_match_map) are used by DIME and model pipelines but have NO Drizzle schema definitions. These need to be added to `drizzle/wc2026.schema.ts` during the schema-alignment session. (Note: DB-007 is reserved for the original espn_match_id column-drift finding from Session A.)

---

## 4. Gap Analysis — Missing Played Matches

### 4.1 Gap Summary by Table

| Table | Missing | Gap Pattern |
|-------|---------|-------------|
| wc2026_model_projections | 20 matches (g-001→g-024) | Matchday 1-2 never modeled |
| wc2026_lineups | 30 matches | Jun 18-22 + R32 + R16 |
| wc2026_match_events | 28 matches | Jun 18-22 + R32 + R16 |
| wc2026_match_stats | 27 matches | Jun 18-22 + R32 + R16 |
| wc2026_odds_snapshots | 18 matches | All R32 + 2 R16 |
| wc2026MatchOdds | 8 matches (rows) + 59 skeleton | Jun 18-22 batch |
| wc2026_frozen_book_odds | 53 matches | Only 37/90 frozen |
| ESPN stats (team/match/xG) | 2 matches | 760504, 760505 (Jul 5) |
| ESPN detail (shots/players/lineups) | 3 matches | 760499, 760504, 760505 |

### 4.2 Gap Classification

**Category A — Scraper stopped (recoverable via re-run):**
- `wc2026_odds_snapshots`: BetExplorer scraper stopped at R32. The 18 missing matches (16 R32 + 2 R16) can be backfilled by running `betexplorer_scraper.py` or `wc2026_playwright_scraper.py` for those match IDs.
- ESPN tables (2-3 matches): espn_match_ids 760504/760505 are Jul 5 R16 matches. The ESPN heartbeat likely hasn't fired yet. Running `wc2026ESPNScraper.mjs` for these IDs will fill them.

**Category B — Never seeded (requires model re-run):**
- `wc2026_model_projections`: First 24 matches (Jun 11-17) were never modeled. The seed scripts start at `seedModelOddsJune20.mjs`. Backfilling requires running the model for those 24 matches.
- `wc2026_frozen_book_odds`: Only 37/90 matches have frozen odds. This is a design choice — frozen odds are only captured for matches where the model was published pre-match.

**Category C — Ingester gap (ESPN results pipeline):**
- `wc2026_match_stats`, `wc2026_match_events`, `wc2026_lineups`: 27-30 matches missing. These are populated by `wc2026Ingester.ts` (ESPN API → match stats/events/lineups). The gap pattern (Jun 18-22 + R32 + R16) suggests the ingester was offline or failed for those date ranges.

**Category D — Skeleton rows (partial population):**
- `wc2026MatchOdds`: 82 rows exist but 59 have NULL book/model odds. Only 23 rows are fully populated. The BetExplorer scraper writes to this table but only for matches it successfully scraped.

---

## 5. Column-Level Coverage (D4)

### 5.1 Critical NULL Rates

| Table | Column | NULL Rate | Assessment |
|-------|--------|-----------|-----------|
| wc2026_matches | attendance | 30% (27/90) | MODERATE — ESPN doesn't always report |
| wc2026_matches | advancing_team_id | 80% (72/90) | EXPECTED — only knockout matches |
| wc2026_model_projections | model_spread | 24.5% (23/94) | HIGH — early seeds lacked spread |
| wc2026_model_projections | model_total | 16.0% (15/94) | HIGH — early seeds lacked total |
| wc2026_model_projections | NOT frozen | 67.0% (63/94) | Only 31/94 frozen |
| wc2026MatchOdds | book_home_ml | 72.0% (59/82) | **CRITICAL** — skeleton rows |
| wc2026MatchOdds | model_home_ml | 73.2% (60/82) | **CRITICAL** — skeleton rows |
| wc2026_espn_match_stats | (all stats) | 1.1% (1/88) | CLEAN |
| wc2026_frozen_book_odds | (all odds) | 0% (0/37) | CLEAN |

### 5.2 Key Findings

The **wc2026MatchOdds** table is the most concerning: 72% of rows are empty skeleton records. This table is the primary source for the DIME AI context and the Projections Feed. The 59 skeleton rows represent matches where the BetExplorer scraper created the row (with match_id and metadata) but never populated the actual odds columns.

The **wc2026_model_projections** table has 23 rows (24.5%) missing `model_spread` — these are early-tournament seeds that used a simpler model version without spread/total output.

---

## 6. Cross-Table Integrity (D5)

| Relationship | Result |
|-------------|--------|
| wc2026_matches → wc2026_teams | 0 orphans |
| wc2026_matches → wc2026_venues | 0 orphans |
| wc2026_model_projections → wc2026_matches | 0 orphans |
| wc2026_frozen_book_odds → wc2026_matches | 0 orphans |
| wc2026_odds_snapshots → wc2026_matches | 0 orphans |
| wc2026MatchOdds → wc2026_matches | 0 orphans |
| wc2026_espn_matches → wc2026_matches | 0 orphans |
| wc2026_lineups → wc2026_matches | 0 orphans |
| wc2026_match_events → wc2026_matches | 0 orphans |
| wc2026_recommendations → wc2026_matches | 0 orphans |

**Verdict: CLEAN.** Zero referential integrity violations across all tested relationships.

**Note:** 10 matches in `wc2026_model_projections` have multiple rows (3 each for wc26-g-049 through wc26-g-053). This is intentional — multiple model versions per match. The DIME context query selects `MAX(model_version)` to resolve.

---

## 7. Script Inventory & Writer Map

### 7.1 Production Pipeline Scripts (MUTATING)

| Script | Writes To | Trigger |
|--------|-----------|---------|
| `wc2026Heartbeat.ts` | Orchestrator | Scheduled heartbeat |
| `wc2026RotowireLineupsScraper.ts` | wc2026_lineups | Heartbeat (every 10 min) |
| `wc2026Ingester.ts` | wc2026_matches, wc2026_match_stats, wc2026_match_events, wc2026_lineups | Heartbeat (daily) |
| `espnDbIngester.ts` | 8 wc2026_espn_* tables | Via wc2026ESPNScraper |
| `wc2026ESPNScraper.mjs` | (delegates to espnDbIngester) | LiveWatcher / manual |
| `wc2026LiveWatcher.mjs` | None directly (triggers ESPNScraper + BracketScraper) | Manual / cron |
| `wc2026BracketScraper.mjs` | wc2026_espn_bracket, wc2026_matches (advancing_team_id) | Post-KO FT trigger |
| `betexplorer_scraper.py` | wc2026MatchOdds, wc2026_odds_snapshots (via local tables) | Manual |
| `wc2026_playwright_scraper.py` | wc2026_frozen_book_odds (header says so, code outputs JSON) | Manual |

### 7.2 Seed Scripts (One-Shot, Historical)

34 seed scripts in `server/wc2026/seed*.mjs` and `seed*.ts` — each writes to `wc2026_model_projections`, `wc2026_odds_snapshots`, and/or `wc2026_frozen_book_odds` for specific date ranges.

### 7.3 Audit/Diagnostic Scripts (READ-ONLY)

`wc2026AuditEngine.mjs`, `wc2026BatchAudit.mjs`, `wc2026FeedAudit.mjs`, `wc2026DateAudit.mjs`, `wc2026DrizzleTest.mjs`, `wc2026_duplicate_audit.mjs`, `audit_espn_vs_db.mjs`, `audit_espn_vs_db_v2.mjs`, `espn_gameid_unification_audit.mjs`, `wc2026_gameId_forensic_audit.mjs`

### 7.4 Credential Handling (SCRIPT-003)

| Script | Method | Assessment |
|--------|--------|-----------|
| `betexplorer_scraper.py` | `os.environ.get("DATABASE_URL")` | CORRECT — env-only |
| `wc2026ESPNScraper.mjs` | Imports `getDb()` from `server/db.ts` | CORRECT — centralized |
| `wc2026Ingester.ts` | Imports `getDb()` from `server/db.ts` | CORRECT — centralized |
| `wc2026_playwright_scraper.py` | No DB connection in code | CORRECT — outputs JSON only |
| All seed scripts | `mysql2/promise` + `process.env.DATABASE_URL` or `getDb()` | CORRECT |

**SCRIPT-003 Verdict:** All scripts read credentials from environment variables or the centralized `getDb()` helper. No hardcoded credentials found. Finding can be STRUCK.

---

## 8. Prioritized Population Plan (D6)

### Priority 1 — Immediate (existing scripts, no model re-run)

| Gap | Action | Script | Matches |
|-----|--------|--------|---------|
| ESPN stats (2 matches) | Run ESPN scraper for 760504, 760505 | `wc2026ESPNScraper.mjs` | 2 |
| ESPN detail (1 extra match) | Run ESPN scraper for 760499 | `wc2026ESPNScraper.mjs` | 1 |
| Odds snapshots (18 R32+R16) | Run BetExplorer scraper for those match IDs | `betexplorer_scraper.py` | 18 |

### Priority 2 — Medium (requires ingester re-run for historical dates)

| Gap | Action | Script | Matches |
|-----|--------|--------|---------|
| match_stats (27 missing) | Re-run ESPN ingester for Jun 18-22 + R32 + R16 dates | `wc2026Ingester.ts` | 27 |
| match_events (28 missing) | Same as above — ingester writes both | `wc2026Ingester.ts` | 28 |
| lineups (30 missing) | Same as above + Rotowire scraper for current | `wc2026Ingester.ts` | 30 |

### Priority 3 — Low (requires model re-run or design decision)

| Gap | Action | Decision Needed |
|-----|--------|----------------|
| Model projections (24 Matchday 1-2) | Run model for g-001 through g-024 | Owner: worth backfilling completed matches? |
| wc2026MatchOdds (59 skeleton rows) | Populate from odds_snapshots or BetExplorer re-scrape | Owner: which source is authoritative? |
| frozen_book_odds (53 missing) | Only meaningful for future matches | Owner: freeze historical odds retroactively? |
| model_spread NULL (23 rows) | Re-run model with spread output for early matches | Owner: worth the compute? |

### Priority 4 — Schema alignment (DB-007 + DB-013)

Add Drizzle schema definitions for the 8 active orphan tables. This is a prerequisite for safe migrations and should be done before any population work that touches those tables.

---

## 9. Findings Registry

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| DB-013 | 8 active production tables lack Drizzle schema definitions | MEDIUM | OPEN — schema session |
| DB-007 | espn_match_id column drift (17 refs in schema.ts, drizzle-kit generate proposes adding columns) | MEDIUM | OPEN — schema session |
| DB-008 | wc2026MatchOdds dual-definition (schema.ts + wc2026.schema.ts) | LOW | OPEN — resolve in schema session |
| DB-009 | wc2026MatchOdds 72% NULL rate on odds columns (59/82 skeleton) | HIGH | OPEN — population decision |
| DB-010 | Model projections missing model_spread for 24.5% of rows | MEDIUM | OPEN — owner decision |
| DB-011 | BetExplorer scraper stopped at R32 (18 matches unscraped) | HIGH | OPEN — re-run needed |
| DB-012 | ESPN ingester gap: 27-30 matches missing stats/events/lineups | HIGH | OPEN — re-run needed |
| SCRIPT-004 | wc2026_playwright_scraper.py header advertises frozen_book_odds DB upsert but code only writes JSON (json.dump) — silent no-op for anyone expecting DB population; partly explains frozen_book_odds at 37/90 | P3 | OPEN — fix script or update header |

---

## 10. STOP Gate

This report is **READ-ONLY ANALYSIS**. No data has been modified. Population work requires:

1. Owner acceptance of this reconciliation report
2. Owner decisions on Priority 3 items (backfill historical model projections? freeze historical odds?)
3. Schema alignment session resolves DB-007 (column drift) AND DB-013 (orphan tables) with zero-drift proof
4. Then: Priority 1 → Priority 2 → Priority 3 execution in that order

**HOLD for owner go-ahead.**
