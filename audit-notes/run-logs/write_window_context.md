# Write Window Execution Context

## Authorization
Full write window authorized 2026-07-08. Execute Phases 0-8 in strict order.

## Phase Status
- [x] Phase 0a: Full live-DB backup (47MB, 196 tables, 2.5M rows) + restore verify PASS
- [ ] Phase 0b: Git checkpoint committed (done: 078a1875)
- [ ] Phase 0c: Confirm r16 feed quiet (no live match in progress)
- [ ] Phase 1: DB-013 DROP (10 backup tables)
- [ ] Phase 2: DATA-016 player_name population from ESPN
- [ ] Phase 3: UNIQUE pre-check
- [ ] Phase 4: Dedup (455 excess rows)
- [ ] Phase 5: ADD UNIQUE constraint
- [ ] Phase 6: DB-014 engine-code fix (6 sites)
- [ ] Phase 7: FE/DB-015 FT_PEN
- [ ] Phase 8: Close-out

## DB Connection
- Host: gateway04.us-east-1.prod.aws.tidbcloud.com
- Port: 4000
- DB: MW3FicTy7ae3qrm8dx8Lua
- User: 3AW8r3RRauadYzS.root
- SSL required, TiDB Serverless v8.5.3

## Key Tables in Scope
- wc2026_match_events: 1,422 rows (455 genuine dupes to remove)
- wc2026MatchOdds: 84 rows (DB-014 odds_source fix)
- wc2026_matches: 104 rows (FE/DB-015 FT_PEN status)

## DB-013 DROP: 10 Backup Tables to Remove
From prior audit, these are the backup/orphan tables:
- wc2026_edges_bak_t3r
- wc2026_mp_bak
- wc2026_mp_dedup_archive
- wc2026_novig_bak_t3r
- wc2026_odds_bak_t2
- wc2026_odds_bak_tier2
- wc2026_proj_bak_t3r
- wc2026_proj_bak_tier2
- wc2026_rec_bak_t3r
- wc2026_orphan_match_odds_quarantine

## DB-014: 6 Engine-Code Sites
- betexplorer_scraper.py:2246 → 'betexplorer'
- betexplorer_scraper.py:2806 → 'betexplorer'
- v19_jul4:665 → 'betexplorer'
- v19_jul5:659 → 'betexplorer'
- v20_jul6:655 → 'betexplorer'
- v22_jul7:675 → 'betexplorer+draftkings_manual_advance'

## FE/DB-015: FT_PEN
- Add 'FT_PEN' to status enum in schema + DB ALTER
- Fix wc2026Context.ts:182 — score_if_final must carry advancement
- Update consumers: WorldCup2026.tsx isFinal, any status==="FT" check
- Update r16-096 fixture to status='FT_PEN'

## ESPN Event API for DATA-016
- ESPN match events endpoint pattern: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={espn_match_id}
- Need to map wc2026_match_events.match_id → espn_match_id via wc2026_espn_matches table
- Extract player names from commentary/keyEvents in the response

## Dedup Details
- True key: (match_id, minute_num, team_id, event_type)
- 360 collision groups, 455 excess rows
- Tiebreak: KEEP lowest id (original write)
- Archive table: wc2026_match_events_archive
- Expected post-dedup count: ~967 rows
