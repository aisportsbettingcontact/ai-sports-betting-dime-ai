# P1: DB-009 Closure — odds_snapshots → wc2026MatchOdds

## Summary
- **Input:** 59 matches with `odds_source = 'no_book_odds'`
- **Output:** 59/59 updated to `odds_source = 'odds_snapshots_closing'`
- **Remaining no_book_odds:** 0

## Method
1. For each no_book_odds match, queried `wc2026_odds_snapshots` for latest snapshot per market+selection
2. Mapped: `1X2|home` → `book_home_ml`, `1X2|draw` → `book_draw`, `1X2|away` → `book_away_ml`
3. Mapped: `ASIAN_HANDICAP|home/away` → `book_primary_spread`, `book_home/away_primary_spread_odds`
4. Mapped: `TOTAL|over/under` → `book_total`, `book_over_odds`, `book_under_odds`
5. Provenance: `odds_source = 'odds_snapshots_closing'`, `odds_updated_at = NOW()`

## Spot Checks (3 matches verified)
- wc26-g-002: home=169, draw=220, away=217 (source: 2026-06-13T11:13 snapshot)
- wc26-g-003: home=271, draw=222, away=138 (source: 2026-06-13T11:08 snapshot)
- wc26-g-004: home=336, draw=227, away=115 (source: 2026-06-13T11:08 snapshot)

## Edge Cases (2 extreme-line matches)
- wc26-g-045: home=6258, draw=355, away=-324 (massive underdog — legitimate closing)
- wc26-g-057: home=882, draw=458, away=-256 (heavy underdog — legitimate closing)

## Final State
| odds_source | count |
|---|---|
| odds_snapshots_closing | 59 |
| betexplorer | (existing) |
| betexplorer+draftkings_manual_advance | (existing) |
| betexplorer_bet365 | (existing) |
| no_book_odds | **0** |

## DB-009 Status: CLOSED
