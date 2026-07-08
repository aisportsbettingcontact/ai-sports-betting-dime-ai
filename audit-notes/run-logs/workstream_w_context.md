# Workstream W Context (saved 2026-07-08T06:38Z)

## P0: DONE (checkpoint f8301123)
- 23 artifacts exported to audit-notes/recovery-artifacts/
- INDEX.md written

## P1: DB-009 CLOSURE
- 59 rows in wc2026MatchOdds with odds_source='no_book_odds'
- Plan: derive closing odds from LATEST odds_snapshots per match per market
- Provenance: odds_source='odds_snapshots_closing' (NOT 'betexplorer', NOT 'no_book_odds')
- Validity gate: snapshot exists + plausible range; no snapshot = stays no_book_odds
- Evidence needed: before/after counts, 3 spot-checks, final no_book_odds count

## P2: 3 MISSING ESPN MATCHES
- r16-091 (ESPN 760504, BRA vs NOR)
- r16-092 (ESPN 760505, MEX vs ENG)  
- r32-086 (ESPN 760499, need to confirm match_id mapping)
- Full Phase-5 ESPN protocol: 8 stat blocks, raw payload committed
- FT_PEN-aware (status enum supports it now)
- Evidence: per-table row counts vs baseline + shot-map-goals=score cross-check

## P3: FROZEN_BOOK_ODDS RECOVERY (55/92 gap → now 53/92 after r16-089/090 swap fix)
- Recovery sources: committed artifacts (jul4/jul5 captures, seed scripts)
- Re-scrape BetExplorer only for matches with NO artifact
- frozen semantics: pre-match values ONLY
- Idempotent upsert keyed match_id; book_source + frozen_at stamped

## P4: REMAINING STAT/ODDS COVERAGE GAPS
- 10 FAIL-completeness tables from B7 scorecard
- Skip ACCEPT-GAP items (24 MD1 projections)
- Recovery-first, same gates

## P5: FINAL RECONCILIATION
- Re-run B2 completeness per touched table
- Updated 28-table scorecard
- Per-table 2 source-matched spot-checks

## DB Schema Notes
- wc2026MatchOdds columns: match_id, home_ml, draw_ml, away_ml, home_spread, home_spread_odds, away_spread_odds, over_under_line, over_odds, under_odds, odds_source, insert_method, last_insert_method, created_at, updated_at
- odds_snapshots table: wc2026_odds_snapshots (need to check columns)
- wc2026_frozen_book_odds: separate table for pre-match frozen values

## Key File Paths
- Recovery discovery: audit-notes/WC2026-RECOVERY-DISCOVERY.md
- B7 final report: audit-notes/WC2026_AUDIT_B7_FINAL_REPORT.md
- INCIDENTS.md: audit-notes/INCIDENTS.md
- OPERATING-RULES.md: ./OPERATING-RULES.md
- ESPN ingester: server/wc2026/wc2026Ingester.ts
- BetExplorer scraper: server/wc2026/betexplorer_scraper.py
