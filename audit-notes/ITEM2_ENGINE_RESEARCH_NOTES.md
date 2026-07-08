# Item 2 Research Notes — DB-014 Engine-Code Fix Scope

## Key Files to Inspect (for UPDATE sites writing wc2026MatchOdds)

### Webdev project (server/wc2026/):
- `betexplorer_scraper.py` — NOT FOUND in webdev project
- `v19_jul5_engine.mjs` — NOT FOUND in webdev project  
- `v20_jul6_engine.mjs` — NOT FOUND in webdev project
- `v22_jul7_engine.mjs` — NOT FOUND in webdev project

### Cloud PC (~/wc_v12/ or similar):
- Need to search for betexplorer_scraper.py and v19/v20/v22 engines
- Cloud PC has ~/wc_v12/ directory with scripts

### Confirmed from earlier grep (in webdev project):
```
cd /home/ubuntu/ai-sports-betting/server/wc2026 && grep -rn "odds_source" . → 0 results in engine files
```

### What we know about source strings:
- betexplorer_scraper.py → should write 'betexplorer'
- v22_jul7_engine.mjs → should write 'betexplorer+draftkings_manual_advance' (evidence: 2 rows in DB have this value)
- v19_jul5_engine.mjs → VERIFY actual source (don't guess)
- v20_jul6_engine.mjs → VERIFY actual source (don't guess)

### Current DB distribution (from earlier query):
- betexplorer: 22 rows
- no_book_odds: 59 rows (just fixed)
- betexplorer+draftkings_manual_advance: 2 rows
- betexplorer_bet365: 1 row

### Where engines live:
- Earlier grep found: server/wc2026/v22_jul7_engine.mjs, v19_jul5_engine.mjs, v20_jul6_engine.mjs
- betexplorer_scraper.py found at: need to re-check (was searched but 0 odds_source occurrences)

### Next steps for Item 2:
1. Find the actual UPDATE/INSERT statements in each engine that write to wc2026MatchOdds
2. For each: cite file+line, current statement, corrected statement with odds_source
3. Determine correct source string per engine from the data they produce
