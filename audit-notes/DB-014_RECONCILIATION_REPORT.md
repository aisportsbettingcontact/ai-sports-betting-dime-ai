# DB-014 Reconciliation Report

**Date:** 2026-07-07  
**Status:** PARTIALLY CORRECT — 59 of 84 rows have WRONG odds_source

---

## Question 1: Why did the 60 gs_metadata rows get 'betexplorer' not 'google_sheets_seed'?

**Answer:** The design (§2, Slice 4) specified:

```sql
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method LIKE 'gs_metadata_backfill%';
```

This UPDATE was executed as-designed. The design's reasoning was: "Group stage rows (seeded from Google Sheets, book odds from BetExplorer via engines)." The assumption was that engines (v19, v20, etc.) had subsequently written BetExplorer-sourced book odds into these rows.

**That assumption was WRONG for 59 of the 60 rows.**

The evidence:

| insert_method | last_insert_method | has_book_ml | count |
|---------------|-------------------|-------------|-------|
| gs_metadata_backfill_v1 | group_stage_to_advance_null_hardcode | NO (all NULL) | 59 |
| gs_metadata_backfill_v1 | wc2026_betexplorer_scraper_v4.py | YES | 1 |

The `last_insert_method='group_stage_to_advance_null_hardcode'` tells us: a script ran AFTER the initial seed and explicitly nulled out the match-result book columns. These 59 rows are **metadata-only shells** — they contain team IDs, stage, round, but **zero book odds values**. Every `book_*` column (ML, draw, total, over, under, spread, BTTS, to_advance) is NULL.

Only 1 of the 60 (wc26-g-001) was actually updated by `wc2026_betexplorer_scraper_v4.py` and has real BetExplorer odds (book_home_ml=-238, book_draw=333, book_away_ml=750, book_total=2.5).

---

## Question 2: If odds truly came from BetExplorer, 'betexplorer' is right and design was wrong — say so. PROVE it.

**The design WAS wrong.** The 59 rows do NOT have odds from BetExplorer or any source. Their book_* values are ALL NULL. Labeling them `odds_source='betexplorer'` is a mislabel — it claims provenance for data that doesn't exist.

**Proof (column-level):**

```
59 rows WHERE insert_method='gs_metadata_backfill_v1' AND last_insert_method='group_stage_to_advance_null_hardcode':
  book_home_ml: 0 non-null / 59 total
  book_draw: 0 non-null / 59 total  
  book_away_ml: 0 non-null / 59 total
  book_total: 0 non-null / 59 total
  book_over_odds: 0 non-null / 59 total
  book_under_odds: 0 non-null / 59 total
  book_btts_yes: 0 non-null / 59 total
  book_btts_no: 0 non-null / 59 total
  book_primary_spread: 0 non-null / 59 total
  book_home_to_advance: 0 non-null / 59 total
  book_away_to_advance: 0 non-null / 59 total
```

**Which engine wrote the book_* values?** NONE. No engine ever wrote book odds to these 59 rows. The `group_stage_to_advance_null_hardcode` script was the last writer, and it explicitly nulled the columns. The original `gs_metadata_backfill_v1` created the rows with metadata only (team IDs, ESPN match IDs, stage, round). No subsequent engine (v19, v20, v21, v22) touched these group-stage rows — engines only wrote to R16 rows.

**Correct label for these 59 rows:** `'no_book_odds'` or `'metadata_shell_only'` — NOT 'betexplorer', NOT 'google_sheets_seed'. The provenance question is moot because there are no odds to attribute.

**The 1 valid row (wc26-g-001):** `odds_source='betexplorer'` IS correct — it was last updated by `wc2026_betexplorer_scraper_v4.py` with real odds values.

---

## Question 3: Paste the 5 UPDATEs as-executed vs design's 5; divergence answers #1.

### Design's 5 UPDATEs (from SCHEMA-ALIGNMENT-DESIGN.md §4, Slice 4):

```sql
-- 1. Group stage rows
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method LIKE 'gs_metadata_backfill%';

-- 2. R32 rows
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method LIKE 'r32_metadata_backfill%';

-- 3. v19 rows
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method LIKE 'v19%';

-- 4. v20 row (null odds_source)
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'null' AND insert_method LIKE 'v20%';

-- 5. BetExplorer scraper row
UPDATE wc2026MatchOdds SET odds_source = 'betexplorer'
WHERE odds_source = 'ESPN_INGEST' AND insert_method = 'wc2026_betexplorer_scraper_v4.py';
```

### As-Executed (reconstructed from current state):

The execution followed the design exactly — all 5 UPDATEs were run as written. Evidence: the current distribution matches what these 5 statements would produce:

| UPDATE # | WHERE clause | Rows affected | Current odds_source |
|----------|-------------|---------------|---------------------|
| 1 | insert_method LIKE 'gs_metadata_backfill%' | 60 | betexplorer |
| 2 | insert_method LIKE 'r32_metadata_backfill%' | 15 | betexplorer |
| 3 | insert_method LIKE 'v19%' | 4 | betexplorer |
| 4 | insert_method LIKE 'v20%' (was NULL) | 1 | betexplorer |
| 5 | insert_method = 'wc2026_betexplorer_scraper_v4.py' | 1 | betexplorer |

Total: 81 rows set to 'betexplorer'. Plus 2 rows (v22) = 'betexplorer+draftkings_manual_advance' and 1 row (v21) = 'betexplorer_bet365'. Grand total: 84/84 non-null.

### Divergence Analysis:

**There is NO divergence between design and execution.** The UPDATEs were executed exactly as designed. The error is in the **design itself** — specifically UPDATE #1, which assumed the 60 gs_metadata rows had BetExplorer odds. They don't. 59 of them have ALL book_* = NULL.

---

## Corrected Status

**DB-014 is NOT fully resolved.** The non-NULL requirement is met (84/84 have a value), but **provenance correctness** is violated for 59 rows.

### Correct provenance mapping:

| Rows | insert_method | last_insert_method | has_book_odds | Correct odds_source |
|------|--------------|-------------------|---------------|---------------------|
| 59 | gs_metadata_backfill_v1 | group_stage_to_advance_null_hardcode | NO | `'no_book_odds'` |
| 1 | gs_metadata_backfill_v1 | wc2026_betexplorer_scraper_v4.py | YES | `'betexplorer'` ✓ |
| 11 | r32_metadata_backfill_v1 | forensic_audit_fix_v2_identity_dc_correction | YES | `'betexplorer'` ✓ |
| 3 | r32_metadata_backfill_v1 | seedToAdvanceJuly2.mjs | YES | `'betexplorer'` ✓ |
| 1 | r32_metadata_backfill_v2 | forensic_audit_fix_v2_identity_dc_correction | YES | `'betexplorer'` ✓ |
| 2 | v19... | v18... | YES | `'betexplorer'` ✓ |
| 2 | v19...-JUL5 | v19...-JUL5 | YES | `'betexplorer'` ✓ |
| 1 | v20...-JUL6 | v20...-JUL6 | YES | `'betexplorer'` ✓ |
| 1 | v21.1... | v21.1... | YES | `'betexplorer_bet365'` ✓ |
| 2 | v22...-JUL7 | v22...-JUL7 | YES | `'betexplorer+draftkings_manual_advance'` ✓ |
| 1 | wc2026_betexplorer_scraper_v4.py | forensic_audit_fix_v2_identity_dc_correction | YES | `'betexplorer'` ✓ |

**25 rows with actual odds: correctly labeled.**  
**59 rows with NO odds: incorrectly labeled 'betexplorer' — should be 'no_book_odds'.**

### Proposed Fix (requires owner decision):

```sql
UPDATE wc2026MatchOdds SET odds_source = 'no_book_odds'
WHERE insert_method = 'gs_metadata_backfill_v1' 
  AND last_insert_method = 'group_stage_to_advance_null_hardcode';
-- Expected: 59 rows affected
```

This is Authorization A (reversible, data-only UPDATE). Awaiting owner go/no-go.

---

## Full Provenance Matrix (raw query output)

```
insert_method | last_insert_method | odds_source | has_odds | no_odds | total
gs_metadata_backfill_v1 | group_stage_to_advance_null_hardcode | betexplorer | 0 | 59 | 59
gs_metadata_backfill_v1 | wc2026_betexplorer_scraper_v4.py | betexplorer | 1 | 0 | 1
r32_metadata_backfill_v1 | forensic_audit_fix_v2_identity_dc_correction | betexplorer | 11 | 0 | 11
r32_metadata_backfill_v1 | seedToAdvanceJuly2.mjs | betexplorer | 3 | 0 | 3
r32_metadata_backfill_v2 | forensic_audit_fix_v2_identity_dc_correction | betexplorer | 1 | 0 | 1
v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16 | v18.0-KO26-RECALIBRATED-16MATCH-R16 | betexplorer | 2 | 0 | 2
v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL5 | v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL5 | betexplorer | 2 | 0 | 2
v20.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL6 | v20.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL6 | betexplorer | 1 | 0 | 1
v21.1-RECAL-USA-FAV-1M-MC | v21.1-RECAL-USA-FAV-1M-MC | betexplorer_bet365 | 1 | 0 | 1
v22.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL7 | v22.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL7 | betexplorer+draftkings_manual_advance | 2 | 0 | 2
wc2026_betexplorer_scraper_v4.py | forensic_audit_fix_v2_identity_dc_correction | betexplorer | 1 | 0 | 1
```
