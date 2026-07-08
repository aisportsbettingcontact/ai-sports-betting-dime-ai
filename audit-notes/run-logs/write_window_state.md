# Write Window Execution State (saved 2026-07-08T05:00Z)

## Completed Phases
- [x] Phase 0a: Full live-DB backup (47MB) + restore verify PASS
- [x] Phase 0b: Git checkpoint 078a1875
- [x] Phase 0c: r16 feed quiet (0 live matches)
- [x] Phase 1: DB-013 DROP — 10 backup tables archived + dropped (192→182)
- [x] Phase 2: DATA-016 player_name populated from ESPN (906/1422 = 63.7%)
- [x] Phase 3: UNIQUE pre-check — CRITICAL FINDING

## Phase 3 Critical Finding
155 legitimate multi-row cases exist (153 SUB + 2 YELLOW) where different players share same (match_id, minute_num, team_id, event_type). 4-column UNIQUE constraint is UNSAFE.

Additionally: Post-population, 0 genuine dupes detected (vs 360 pre-population). This is because the population script assigned different ESPN player names to what were originally byte-identical duplicate rows. The dupes still exist but are now distinguishable by player_name.

The 200 ambiguous groups are all VAR events (player_name = NULL, team_id = '').

## Dedup Strategy Impact
The original B3 analysis found 360 collision groups / 455 excess rows PRE-population.
Post-population, those same rows now have DIFFERENT player_names (assigned by consumption order).
This means:
- Cannot dedup by "same player_name" anymore (population polluted the signal)
- Must use the ORIGINAL pre-population analysis (lowest-id tiebreak) which was correct
- OR: identify dupes by checking if two rows in same group have player_names that are WRONG (assigned to wrong event)

## Recommended Approach for Dedup (Phase 4)
Since the original 360 groups were proven genuine dupes (byte-identical pre-population), and the population script assigned ESPN events in order (first match to first row, second to second), the CORRECT dedup is:
1. For each original collision group, keep the row with lowest id (original write)
2. Delete higher-id rows (re-emissions that got different player names from population)
3. The kept row has the CORRECT player_name (first ESPN match = correct assignment)

## Recommended Approach for UNIQUE Constraint (Phase 5)
5-column key: UNIQUE(match_id, minute_num, team_id, event_type, player_name)
- Works for SUB (different players = different rows, legitimate)
- Works for YELLOW (different players = different rows, legitimate)
- For VAR (all NULL player_name): need to either leave unconstrained or add sequence_num
- Decision: owner must decide

## Remaining Phases
- [ ] Phase 4: Dedup — use original B3 collision groups, keep lowest id, delete rest
- [ ] Phase 5: ADD UNIQUE constraint (5-column or with sequence_num) — owner decision needed
- [ ] Phase 6: DB-014 engine-code fix — 6 sites on cloud-pc
- [ ] Phase 7: FE/DB-015 — FT_PEN enum + context fix
- [ ] Phase 8: Close-out

## DB-014 Details (from pasted_content_22.txt authorization)
6 engine-code sites to fix odds_source:
- betexplorer_scraper.py:2246 → 'betexplorer'
- betexplorer_scraper.py:2806 → 'betexplorer'
- v19_jul4:665 → 'betexplorer'
- v19_jul5:659 → 'betexplorer'
- v20_jul6:655 → 'betexplorer'
- v22_jul7:675 → 'betexplorer+draftkings_manual_advance'
These are on the cloud-pc at /mnt/5l2bduvblitg6a6rt4hluhgza/ubuntu/

## FE/DB-015 Details
- Add 'FT_PEN' to status enum in drizzle schema + DB ALTER
- Fix wc2026Context.ts:182 — score_if_final must carry advancement info
- Update consumers: WorldCup2026.tsx isFinal check, any status==="FT" check
- Update r16-096 fixture to status='FT_PEN' (Germany vs Paraguay)
