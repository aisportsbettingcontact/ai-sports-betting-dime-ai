# WC2026 Recovery Discovery Report (R1–R4)

**Date:** 2026-07-07  
**Scope:** Read-only discovery — identify recoverable artifacts, classify gaps, produce source-split population plan  
**Status:** COMPLETE — awaiting WRITE authorization  
**New finding:** DATA-001 (P1) — frozen_book_odds r16-089/r16-090 match_id swap

---

## R1: Historical Run Artifact Inventory

### Summary

| Category | Count | Coverage |
|----------|-------|----------|
| ESPN ingest test logs | 85 files | 760414–760498 (group + R32 073-085) |
| ESPN forensic audit | 1 report | 4 R32 matches (ELITE verdict) |
| BetExplorer data files | 10 files | R16 089-092 (Jul 4-5 odds) |
| Seed scripts (frozen_book_odds) | 5 scripts | R32 073-085 (13 matches) |
| Seed scripts (model_projections) | 28 scripts | Jun 11 – Jul 5 |
| Model engine outputs | 2 files | R16 091-092 (v19, Jul 5) |
| 500X audit report | 1 report | Full system state Jul 6 |
| Pipeline state reference | 1 file | Architecture + row counts Jul 6 |
| Cloud computer (wc_v12) | WC2018+WC2022 only | NOT relevant to WC2026 gaps |

### Key Artifact Details

**ESPN Ingest Tests (.manus-logs/espn_ingest_test_*.txt)**
- Run date: 2026-07-01 (00:44–11:32 UTC)
- 72 FULL PASS (all 9 tables, 77/77 checks, ~130 rows/match)
- 7 PARTIAL (2 fails each — shot map goal count = 0, likely 0-0 draws)
- 6 FAILED (760493-498 = R32 080-085, tested BEFORE match kickoff)

**ESPN Forensic Audit (.manus-logs/WC2026_ESPN_FORENSIC_AUDIT_REPORT.md)**
- Run: 2026-06-30T10:06:03Z
- 4 R32 matches: 1101 PASS / 0 FAIL / 2 WARN (100.0%)
- TRUTH ANCHOR: 760487 Japan vs Brazil (1-2)

**BetExplorer Root-Level Files (R16 odds, Jul 4-5)**
- `jul4_fresh_scrape.json`: wc26-r16-089, r16-090 — structured multi-market
- `jul4_final_state.json`: wc26-r16-089, r16-090 — full publication state
- `jul5_complete_book_odds.txt`: wc26-r16-091, r16-092 — all markets
- `jul5_final_state.txt`: wc26-r16-091, r16-092 — full publication state

**Seed Scripts (frozen_book_odds writers)**
- seedJune28CAN_RSA.mjs → r32-073
- seedJune29Direct.ts → r32-074, 075, 076
- seedJune30Direct.ts → r32-077, 078, 079
- seedJuly1Direct.ts → r32-080, 081, 082
- seedJuly2BookOdds.ts → r32-083, 084, 085
- **Missing:** R32 086-088, ALL R16

**fix_seeded_odds_v2.mjs** — Correction script for 12 matches (R32 080-085 + R16 089-091). Defines correct values. **NEVER APPLIED TO LIVE DB** (see DATA-001).

---

## R2: Coverage Match — Per-Gap Source Buckets

### Gap 1: wc2026_odds_snapshots (18 missing played matches)

| Matches | Count | Bucket | Source |
|---------|-------|--------|--------|
| r32-073 to r32-088 | 16 | REQUIRES RE-SCRAPE | No odds_snapshots artifact for R32. Scraper ran group stage only. |
| r16-091, r16-092 | 2 | REQUIRES RE-SCRAPE | Jul5 text files have bet365 odds but not in snapshots format. |

### Gap 2: wc2026_model_projections (24 missing = g-001 to g-024)

| Matches | Count | Bucket | Source |
|---------|-------|--------|--------|
| g-001 to g-024 | 24 | ACCEPT GAP | No seed output exists. seedModelOddsJune11.mjs exists but DB confirms 0 rows. Model was not run for Matchday 1-2. |

### Gap 3: wc2026_frozen_book_odds (53 missing of 90 played)

| Matches | Count | Bucket | Source |
|---------|-------|--------|--------|
| g-001 to g-072 | 72 | OWNER DECISION | Could derive from odds_snapshots closing values. New data product, not recovery. |
| r32-086, 087, 088 | 3 | RECOVERABLE | wc2026MatchOdds has book columns for these. |
| r16-089, r16-090 | 2 | ALREADY PRESENT (SWAPPED) | DATA-001 bug. Fix script exists. |
| r16-091, r16-092 | 2 | ALREADY PRESENT | Correctly populated. |
| r16-093 to r16-096 | 4 | NOT YET PLAYED | Scheduled matches. |

### Gap 4: ESPN stats (2-3 missing per table)

| ESPN ID | Match | Missing Tables | Bucket |
|---------|-------|----------------|--------|
| 760504 | r16-091 BRA vs NOR | team_stats, match_stats, xG, shot_map, player_stats, lineups | REQUIRES RE-SCRAPE |
| 760505 | r16-092 MEX vs ENG | team_stats, match_stats, xG, shot_map, player_stats, lineups | REQUIRES RE-SCRAPE |
| 760499 | r32-086 or r32-087 | shot_map only | REQUIRES RE-SCRAPE |

### Gap 5: wc2026_lineups (30 missing)

| Matches | Bucket | Source |
|---------|--------|--------|
| 30 across group + R32 + R16 | REQUIRES RE-SCRAPE | No lineup artifact. RotowireLineupsScraper only does upcoming. ESPN lineups exist for most. |

### Gap 6: wc2026_match_stats / match_events (27-28 missing)

| Matches | Bucket | Source |
|---------|--------|--------|
| 27 matches (Jun 18-22 group + R32 + R16) | RECOVERABLE (propagation) | ESPN data EXISTS in espn_* tables. Just needs propagation via wc2026Ingester. |

### Gap 7: wc2026MatchOdds (12 missing group matches)

| Matches | Bucket | Source |
|---------|--------|--------|
| g-025 to g-028, g-037 to g-044 | RECOVERABLE | odds_snapshots has closing data for all 72 group matches. Derive consolidated row. |

---

## R3: Artifact Validation

### Spot Check Results

| # | Match | Table | Artifact | DB | Verdict |
|---|-------|-------|----------|-----|---------|
| 1 | wc26-r16-089 (PAR vs FRA) | frozen_book_odds | jul4_fresh_scrape: 1600/600/-588 | 375/250/-125 | **BUG** — DB has r16-090's data |
| 2 | wc26-r32-080 (ENG vs COD) | frozen_book_odds | fix_seeded_odds_v2: -345/400/1100 | -345/400/1100 | **MATCH ✓** |
| 3 | wc26-g-001 | model_projections | seedModelOddsJune11.mjs exists | 0 rows | **Gap REAL** — seed never applied |
| 4 | wc26-r16-091 (BRA vs NOR) | ESPN tables | espn_matches row exists | team_stats=0, player_stats=0 | **RECOVERABLE** — re-scrape |

### Provenance Assessment

- **ESPN ingest tests (72 FULL PASS):** Validated by forensic audit (1101 PASS). High confidence.
- **Seed scripts (frozen_book_odds):** fix_seeded_odds_v2.mjs defines correct values, verified against domain logic. High confidence.
- **BetExplorer root files (jul4/jul5):** Timestamped, match-specific, multi-market. Medium-high confidence (different source/time than DB values — expected for different books).
- **Model engine outputs (v19):** DB write confirmed in log. High confidence.

---

## NEW FINDING: DATA-001 (P1)

**frozen_book_odds r16-089/r16-090 match_id swap**

| Field | r16-089 (PAR vs FRA) | r16-090 (CAN vs MAR) |
|-------|---------------------|---------------------|
| DB actual | homeML=375, draw=250, awayML=-125 | homeML=1400, draw=600, awayML=-500 |
| Correct (v2) | homeML=1400, draw=600, awayML=-500 | homeML=375, draw=250, awayML=-125 |
| Domain check | France is massive fav → away_ml should be ~-500 ✓ | Canada slight fav → homeML should be ~-125 ✓ |

**Root cause:** fix_seeded_odds_v2.mjs was written to correct this swap but was NEVER applied to the live DB. The original seeder had the match_ids transposed.

**Impact:** DIME edge calculations for r16-089 and r16-090 are computed against wrong book odds. Any published edges for these matches are incorrect.

**Remediation:** Run fix_seeded_odds_v2.mjs (atomic: 2 UPDATE statements). Can be done independently of schema alignment.

---

## R4: Revised Population Plan (Source-Split)

### Priority 1: RECOVER FROM ARTIFACT (zero-risk, high-fidelity)

| # | Action | Matches | Source | Effort |
|---|--------|---------|--------|--------|
| 1a | Fix DATA-001 swap | r16-089, r16-090 | fix_seeded_odds_v2.mjs | 2 SQL UPDATEs |
| 1b | Derive wc2026MatchOdds for 12 group matches | g-025–g-028, g-037–g-044 | odds_snapshots closing values | SQL SELECT → INSERT |
| 1c | Seed frozen_book_odds for R32 086-088 | 3 matches | wc2026MatchOdds book columns | SQL SELECT → INSERT |
| 1d | Propagate ESPN → match_stats/events | 27 matches | espn_* tables (already populated) | wc2026Ingester batch |

### Priority 2: RE-SCRAPE (ESPN — low risk, data exists on ESPN.com)

| # | Action | Matches | Script | Effort |
|---|--------|---------|--------|--------|
| 2a | ESPN full ingest: 760504, 760505 | r16-091, r16-092 | wc2026ESPNScraper.mjs | 2 runs |
| 2b | ESPN full ingest: 760493-760498 | r32-080–r32-085 | wc2026ESPNScraper.mjs | 6 runs |
| 2c | ESPN shot_map: 760499 | 1 match | wc2026ESPNScraper.mjs | 1 run |
| 2d | Propagate new ESPN data → lineups | ~30 matches | wc2026Ingester | Batch |

### Priority 3: RE-SCRAPE (BetExplorer — medium risk)

| # | Action | Matches | Script | Risk |
|---|--------|---------|--------|------|
| 3a | odds_snapshots for R32 | r32-073–r32-088 (16) | betexplorer_scraper.py | Historical odds may differ from match-time |
| 3b | odds_snapshots for R16 | r16-089–r16-092 (4) | betexplorer_scraper.py | Same risk |

### Priority 4: ACCEPT GAP or OWNER DECISION

| # | Gap | Matches | Decision Required |
|---|-----|---------|-------------------|
| 4a | Model projections g-001–g-024 | 24 | Accept as historical gap (no match-time model existed) |
| 4b | frozen_book_odds for group stage | 72 | Derive from odds_snapshots closing? (new data product, not recovery) |

### Execution Sequence

```
Schema alignment (DB-007 + DB-013) ─── GATE ───┐
                                                │
DATA-001 fix (atomic, no schema dep) ──────────┤
                                                │
                                                ▼
Priority 1 (RECOVER) → Priority 2 (ESPN) → Priority 3 (BetExplorer) → Priority 4 (decisions)
```

### Guardrails (unchanged from reconciliation report)
- All writes require explicit WRITE authorization
- Schema alignment must complete first (except DATA-001 which is schema-independent)
- Each batch: validate row counts before/after
- Spot-check 3 matches per batch against source
- No silent failures — log every INSERT/UPDATE with match_id + row count

---

## Summary Statistics

| Bucket | Matches Affected | Tables Affected | Effort |
|--------|-----------------|-----------------|--------|
| RECOVERABLE FROM ARTIFACT | 42 (12+3+27) | 3 tables | SQL only |
| ALREADY PRESENT (with bug) | 2 | 1 table | 2 UPDATEs |
| ALREADY PRESENT (correct) | 2 | 1 table | None |
| REQUIRES RE-SCRAPE (ESPN) | 9 | 6 tables | 9 scraper runs |
| REQUIRES RE-SCRAPE (BetExplorer) | 20 | 1 table | 1 scraper batch |
| ACCEPT GAP | 24 | 1 table | None |
| OWNER DECISION | 72 | 1 table | Derivation if approved |
| NOT YET PLAYED | 4 | — | Future |

**Recovery-first approach saves:** ~42 matches worth of re-scraping by using existing DB data and propagation scripts.
