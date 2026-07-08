# Write Window Final State (saved 2026-07-08T05:43Z)

## ALL PHASES COMPLETE

### Phase 0: Preconditions
- [x] 0a: Full live-DB backup (47MB, 196 tables, 2.5M rows) + restore verify PASS
- [x] 0b: Git checkpoint 078a1875
- [x] 0c: r16 feed quiet (0 live matches)

### Phase 1: DB-013 DROP
- [x] 10 backup tables archived individually + dropped (192→182)
- Evidence: audit-notes/run-logs/phase1_db013_drop_evidence.md

### Phase 2: DATA-016 player_name population
- [x] 906/1422 rows populated (63.7%) from ESPN keyEvents
- GOAL: 160/160 (100%), SUB: 573/576 (99%), YELLOW: 156/157 (99%)
- VAR: 1/508 (0%) — ESPN doesn't include VAR events with player attribution
- Also fixed: 352 team_id values populated for early matches

### Phase 3: UNIQUE pre-check
- [x] NULL UNIQUE behavior correction: MySQL allows multiple NULLs in UNIQUE — VERIFIED
- [x] Disjointness proof: 155 legitimate groups DISJOINT from 360 pre-pop dupe groups
- [x] Keep-rule verification: GOAL=0 collision groups remain, YELLOW=2 are LEGITIMATE (different players)
- CRITICAL FINDING: Post-population, 0 genuine dupe groups remain among named events
- Only 200 VAR groups (NULL player_name) remain as genuine dupes

### Phase 4: Dedup
- [x] 200 VAR groups deduped: 257 excess rows archived + deleted (corrected from 258 — see reconciliation note)
- [x] Post-dedup: 0 collision groups on 4-column key for VAR events
- Archive: audit-notes/archives/match_events_var_dupes_2026-07-08.json

### Phase 5: ESPN Reconciliation
- [x] 62/62 matches PASS — no attribution corruption
- [x] Under-count is pre-existing completeness gap, NOT caused by dedup

### Phase 6: UNIQUE Constraint + Ingester Fix
- [x] UNIQUE constraint `uq_me_natural_key(match_id, minute_num, team_id, event_type, player_name)` — APPLIED
- [x] Ingester idempotency fix: check-before-insert pattern for named events + VAR
- [x] TypeScript: 0 errors

### Phase 7 (DB-014): odds_source fix — 6 sites patched
- [x] betexplorer_scraper.py INSERT #1 (line 2250): 'betexplorer'
- [x] betexplorer_scraper.py INSERT #2 (line 2811): 'betexplorer'
- [x] v19_jul4_engine.mjs UPDATE (line 680): 'betexplorer'
- [x] v19_jul5_engine.mjs UPDATE (line 674): 'betexplorer'
- [x] v20_jul6_engine.mjs UPDATE (line 670): 'betexplorer'
- [x] v22_jul7_engine.mjs UPDATE (line 690): 'betexplorer+draftkings_manual_advance'

### Phase 8 (DB-015): FT_PEN enum + context fix
- [x] Schema: Added 'FT_PEN' to wc2026_matches status enum
- [x] Migration 0111 applied to live DB
- [x] wc2026Ingester.ts: detects "FT-Pens" from ESPN statusDesc → writes FT_PEN
- [x] wc2026Ingester.ts: skip logic updated for FT_PEN
- [x] fifaLiveScraper.ts: DbStatus type updated, penalty cases write FT_PEN
- [x] seedAdvancingTeams.ts: status type + resolvedAdvancers include FT_PEN
- [x] wc2026Heartbeat.ts: post-FT hook includes FT_PEN
- [x] WorldCup2026.tsx: isFinal includes FT_PEN
- [x] DB updated: 4 matches set to FT_PEN (wc26-r16-096, wc26-r32-075, wc26-r32-076, wc26-r32-086)
- [x] TypeScript: 0 errors

## Large File Note
- full_live_db_2026-07-08T03-59-21.sql moved to /home/ubuntu/full_live_db_backup.sql (outside project)
