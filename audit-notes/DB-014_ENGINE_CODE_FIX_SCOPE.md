# DB-014 Engine-Code Fix Scope

**Filed:** 2026-07-08T00:30Z
**Status:** HALF-OPEN — scoped, not executed, gated to next write window
**Authorization:** Requires explicit go before execution

---

## Summary

ZERO engines currently write `odds_source` to wc2026MatchOdds. All existing `odds_source` values were set by the DB-014 backfill UPDATEs (one-time fix), not by ongoing engine writes. Without this fix, any future engine run will leave `odds_source` stale or NULL on newly-written rows, recreating the DB-014 condition.

---

## Per-Site Table: All UPDATE Sites Writing wc2026MatchOdds

| # | File | Line | ENGINE_VERSION | Current UPDATE SET clause (relevant excerpt) | Missing | Corrected Statement (add to SET) | Correct odds_source Value |
|---|------|------|----------------|----------------------------------------------|---------|----------------------------------|--------------------------|
| 1 | `server/wc2026/betexplorer_scraper.py` | 2246 | N/A (uses SCRAPER_FILENAME = `wc2026_betexplorer_scraper_v4.py`) | INSERT...ON DUPLICATE KEY UPDATE — 16 book columns + metadata. **No `odds_source` in column list.** | `odds_source` | Add `odds_source` to INSERT column list + VALUES + ON DUPLICATE KEY UPDATE clause: `odds_source = VALUES(odds_source)` | `'betexplorer'` [VERIFIED — comment at line 253: "FRESH bet365 book odds scraped from BetExplorer AJAX"] |
| 2 | `server/wc2026/betexplorer_scraper.py` | 2806 | N/A (same SCRAPER_FILENAME) | INSERT...ON DUPLICATE KEY UPDATE — group-stage variant, same structure. **No `odds_source`.** | `odds_source` | Same fix as #1 | `'betexplorer'` [VERIFIED — same scraper, same source] |
| 3 | `server/wc2026/v19_jul4_engine.mjs` | 665 | `v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16` | `UPDATE wc2026MatchOdds SET ... insert_method = ?, last_inserted_at = NOW()` — 35 columns. **No `odds_source`.** Note: only sets `insert_method` (not `last_insert_method`). | `odds_source` | Add `odds_source = ?` to SET clause, add value to params array | `'betexplorer'` [VERIFIED — line 248 comment: "FRESH bet365 book odds (scraped 2026-07-04 from BetExplorer AJAX)"] |
| 4 | `server/wc2026/v19_jul5_engine.mjs` | 659 | `v19.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL5` | `UPDATE wc2026MatchOdds SET ... insert_method = ?, last_inserted_at = NOW(), last_insert_method = ?` — 36 columns. **No `odds_source`.** | `odds_source` | Add `odds_source = ?` to SET clause, add value to params array | `'betexplorer'` [VERIFIED — line 246 comment: "FRESH bet365 book odds (scraped 2026-07-05 19:16 UTC from BetExplorer AJAX)"] |
| 5 | `server/wc2026/v20_jul6_engine.mjs` | 655 | `v20.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL6` | `UPDATE wc2026MatchOdds SET ... insert_method = ?, last_inserted_at = NOW(), last_insert_method = ?` — 36 columns. **No `odds_source`.** | `odds_source` | Add `odds_source = ?` to SET clause, add value to params array | `'betexplorer'` [VERIFIED — line 248 comment: "FRESH bet365 book odds (scraped 2026-07-06 18:33 UTC from BetExplorer AJAX)"] |
| 6 | `server/wc2026/v22_jul7_engine.mjs` | 675 | `v22.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL7` | `UPDATE wc2026MatchOdds SET ... insert_method = ?, last_inserted_at = NOW(), last_insert_method = ?` — 36 columns. **No `odds_source`.** | `odds_source` | Add `odds_source = ?` to SET clause, add value to params array | `'betexplorer+draftkings_manual_advance'` [VERIFIED — line 253 comment: "FRESH bet365 book odds (scraped 2026-07-07 ~16:30 UTC from BetExplorer AJAX)" + lines 262/271 include `bookHomeAdv`/`bookAwayAdv` which are DraftKings to-advance odds manually entered] |

---

## Source String Verification

| Engine | Book Data Source (from code comments) | to_advance Source | Correct odds_source |
|--------|--------------------------------------|-------------------|---------------------|
| betexplorer_scraper.py | BetExplorer AJAX scrape | NULL (not available on BetExplorer — line 2342) | `'betexplorer'` [VERIFIED] |
| v19_jul4_engine.mjs | "FRESH bet365 book odds scraped from BetExplorer AJAX" (line ~248) | Hardcoded in JUL4_BOOK object | `'betexplorer'` [VERIFIED — to_advance from BetExplorer too] |
| v19_jul5_engine.mjs | "FRESH bet365 book odds (scraped 2026-07-05 19:16 UTC from BetExplorer AJAX)" (line 246) | `bookHomeAdv`/`bookAwayAdv` in JUL5_BOOK | `'betexplorer'` [VERIFIED] |
| v20_jul6_engine.mjs | "FRESH bet365 book odds (scraped 2026-07-06 18:33 UTC from BetExplorer AJAX)" (line 248) | `bookHomeAdv`/`bookAwayAdv` in JUL6_BOOK | `'betexplorer'` [VERIFIED] |
| v22_jul7_engine.mjs | "FRESH bet365 book odds (scraped 2026-07-07 ~16:30 UTC from BetExplorer AJAX)" (line 253) | `bookHomeAdv`/`bookAwayAdv` — DraftKings manual entry (not from BetExplorer) | `'betexplorer+draftkings_manual_advance'` [VERIFIED — DB already has this value for v22 rows] |

---

## Why v22 is `'betexplorer+draftkings_manual_advance'` not just `'betexplorer'`

The v22 engine writes `bookHomeAdv`/`bookAwayAdv` (to-advance market odds) that were manually sourced from DraftKings (lines 262, 271), while all other book columns come from BetExplorer. The composite source string accurately reflects this dual provenance. Earlier engines (v19, v20) also have `bookHomeAdv`/`bookAwayAdv` but those values were sourced from BetExplorer's to-advance market (available for some matches), hence just `'betexplorer'`.

**Verification from DB:** The 2 rows with `last_insert_method='v22.0-500X-CORRECT-SCORE-RECALIBRATED-R16-JUL7'` already have `odds_source='betexplorer+draftkings_manual_advance'` (set by DB-014 backfill UPDATE #5 which matched on `last_insert_method`). This confirms the correct value.

---

## Corrected Code Pattern (template for all sites)

### For .mjs engines (v19/v20/v22):
```javascript
// CURRENT (line 675 in v22 as example):
      UPDATE wc2026MatchOdds SET
        model_home_ml = ?, ...
        insert_method = ?, last_inserted_at = NOW(), last_insert_method = ?
      WHERE match_id = ?

// CORRECTED:
      UPDATE wc2026MatchOdds SET
        model_home_ml = ?, ...
        insert_method = ?, last_inserted_at = NOW(), last_insert_method = ?,
        odds_source = ?, odds_updated_at = NOW()
      WHERE match_id = ?

// Add to params array (before match.fid):
      ENGINE_VERSION, ENGINE_VERSION, ODDS_SOURCE_STRING, match.fid
```

### For betexplorer_scraper.py:
```python
# CURRENT (line 2246):
        INSERT INTO `{MYSQL_TABLE}` (
            match_id, espn_match_id, espn_slug,
            ...
        ) VALUES (...)
        ON DUPLICATE KEY UPDATE
            ...

# CORRECTED — add to column list:
            odds_source, odds_updated_at,

# Add to VALUES:
            %s, CURRENT_TIMESTAMP,

# Add to ON DUPLICATE KEY UPDATE:
            odds_source = VALUES(odds_source),
            odds_updated_at = CURRENT_TIMESTAMP,

# Add to params tuple (after book_away_spread_odds):
            'betexplorer',
```

---

## Execution Plan (for next write window)

1. Edit all 6 sites in a single commit
2. Run `npx tsc --noEmit` to confirm no type errors (engines are .mjs so no TS check, but betexplorer_scraper.py is Python — syntax check with `python3 -c "import ast; ast.parse(open('...').read())"`)
3. Dry-run one engine against a test match to confirm the UPDATE includes odds_source
4. Verify DB shows correct odds_source after dry-run
5. Checkpoint

**DB-014 closes when this ships.**

---

## Cross-References

- DB-014 (INCIDENTS.md): HALF-OPEN, awaiting engine-code fix
- DB-009: 59 no_book_odds rows — Priority 1b population must also write odds_source
- FE/DB-015: penalty-status enum gap (separate finding, same table)
