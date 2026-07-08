# B4: WC2026 NULL/Incompleteness Audit

**Query run:** 2026-07-08T01:35Z

## wc2026MatchOdds (84 rows)

| Column | NULL Count | Rate | Notes |
|--------|-----------|------|-------|
| book_home_ml | 59 | 70% | ALL 59 are odds_source='no_book_odds' (DB-009 shells) |
| book_draw | 59 | 70% | Same 59 rows |
| book_away_ml | 59 | 70% | Same 59 rows |
| book_total | 59 | 70% | Same 59 rows |
| book_over_odds | 59 | 70% | Same 59 rows |
| book_under_odds | 59 | 70% | Same 59 rows |
| book_btts_yes | 59 | 70% | Same 59 rows |
| book_btts_no | 59 | 70% | Same 59 rows |
| odds_source | 0 | 0% | All rows have a source label |

**CONFIRMED:** The 59 'no_book_odds' rows are the ONLY book-null set. 0 rows with odds_source != 'no_book_odds' have NULL book_home_ml. No hidden null sets.

## wc2026_model_projections (96 rows)

| Column | NULL Count | Rate | Notes |
|--------|-----------|------|-------|
| model_home_ml | 0 | 0% | Complete |
| model_away_ml | 0 | 0% | Complete |
| model_spread | 23 | 24% | Early group matches (pre-spread-calculation) |
| model_total | 15 | 16% | Early group matches |
| home_win_prob | 6 | 6% | Early prototype rows |
| draw_prob | 6 | 6% | Same 6 rows |
| away_win_prob | 6 | 6% | Same 6 rows |
| home_lambda | 0 | 0% | Complete |
| away_lambda | 0 | 0% | Complete |
| model_version | 0 | 0% | Complete |

## wc2026_espn_matches (92 rows)

| Column | NULL Count | Rate | Notes |
|--------|-----------|------|-------|
| homeScore | 2 | 2% | espn:760504 (BRA-NOR) + espn:760505 (MEX-ENG) — statusState='pre', Scheduled |
| awayScore | 2 | 2% | Same 2 matches |
| homeTeamName | 0 | 0% | Complete |
| awayTeamName | 0 | 0% | Complete |
| matchDateUtc | 0 | 0% | Complete |

**Note:** The 2 NULL-score rows are r16-091 (BRA-NOR) and r16-092 (MEX-ENG). These were inserted as pre-match placeholders (statusState='pre'). They were played today but the ESPN scrape hasn't been re-run post-match to populate scores. This is the same gap identified in B2 (r16-091, r16-092 missing from child tables).

## wc2026_matches (104 rows)

- Played matches with NULL scores: **0** (all 92 FT matches have scores populated)

## wc2026_frozen_book_odds (37 rows)

| Column | NULL Count | Rate | Notes |
|--------|-----------|------|-------|
| book_home_ml | 0 | 0% | Complete |
| book_draw | 0 | 0% | Complete |
| book_away_ml | 0 | 0% | Complete |
| book_total | 0 | 0% | Complete |

All 37 rows are fully populated with no NULLs on critical columns.

## wc2026_espn_match_stats (90 rows)

- 86 columns of detailed match statistics
- Key columns: homeXG, awayXG, possession (via homeShotsOnGoal etc.)
- No possession column directly — possession is derived from pass stats

## Played Matches Missing ESPN Team Stats

**Count: 2** — wc26-r16-091, wc26-r16-092

These are the same matches identified in B2 as coverage gaps (played today, ESPN scrape not yet executed post-match).

## Summary

| Finding | Status |
|---------|--------|
| DB-009 shells (59 rows) are the ONLY book-null set | ✅ CONFIRMED |
| No hidden null sets outside DB-009 | ✅ CONFIRMED |
| All played matches in wc2026_matches have scores | ✅ CONFIRMED |
| 2 ESPN matches have NULL scores (pre-match placeholders) | Expected — scrape pending |
| model_projections has some NULL spread/total (early rows) | Expected — prototype runs |
| frozen_book_odds fully populated (0 NULLs) | ✅ CONFIRMED |
