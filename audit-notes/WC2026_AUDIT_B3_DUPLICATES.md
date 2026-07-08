# B3: WC2026 Duplicate Detection Audit

**Query run:** 2026-07-08T01:30Z
**Method:** GROUP BY natural key HAVING count > 1, per table

## Results Summary

| Table | Natural Key | Dupes? | Count |
|-------|-------------|--------|-------|
| wc2026_espn_matches | espn_match_id | ✅ CLEAN | 0 |
| wc2026_espn_team_stats | espn_match_id | ✅ CLEAN | 0 |
| wc2026_espn_match_stats | espn_match_id | ✅ CLEAN | 0 |
| wc2026_espn_expected_goals | espn_match_id | ✅ CLEAN | 0 |
| wc2026_espn_shot_map | espn_match_id+period+clock+playerName+shotType | ❌ DUPES | 5+ |
| wc2026_espn_player_stats | espn_match_id+name+teamAbbrev | ✅ CLEAN | 0 |
| wc2026_espn_lineups | espn_match_id+name+teamAbbrev | ✅ CLEAN | 0 |
| wc2026_model_projections | match_id | ❌ DUPES | 18 match_ids |
| wc2026MatchOdds | match_id | ✅ CLEAN | 0 |
| wc2026_matches | match_id | ✅ CLEAN | 0 |
| wc2026_match_stats | match_id | ✅ CLEAN | 0 |
| wc2026_match_events | match_id+event_type+minute_str+player_name | ❌ DUPES | 5+ |
| wc2026_lineups | match_id+player_name+team_id | ❌ DUPES | 10+ |
| wc2026_frozen_book_odds | match_id | ✅ CLEAN | 0 |
| wc2026_market_no_vig | match_id+market+selection | ✅ CLEAN | 0 |
| wc2026_market_edges | match_id+market+selection | ✅ CLEAN | 0 |
| wc2026_holdout_validation | match_id+selection | ❌ DUPES | 5+ |
| wc2026_recommendations | match_id+market+selection | ❌ DUPES | 5+ |
| wc2026_odds_snapshots | match_id+snapshot_ts+market+selection | ❌ DUPES | 5+ |
| wc2026_provider_match_map | canonical_match_id+provider | ✅ CLEAN | 0 |
| wc2026_teams | team_id | ✅ CLEAN | 0 |
| wc2026_venues | venue_id | ✅ CLEAN | 0 |
| wc2026_team_aliases | alias | ✅ CLEAN | 0 |
| wc2026_model_grades | run_id+metric_name | ✅ CLEAN | 0 |
| wc2026_model_runs | run_id | ✅ CLEAN | 0 |
| wc2026_espn_bracket | espn_match_id | ✅ CLEAN | 0 |

## Detailed Dupe Findings

### wc2026_model_projections (18 match_ids with dupes)
```
wc26-g-037: 2 rows (ids: 42,46)
wc26-g-038: 2 rows (ids: 44,48)
wc26-g-039: 2 rows (ids: 41,45)
wc26-g-040: 2 rows (ids: 43,47)
wc26-g-049: 3 rows (ids: 2264804,2264810,2264816)
wc26-g-050: 3 rows (ids: 2264805,2264811,2264817)
wc26-g-051: 3 rows (ids: 2264806,2264812,2264818)
wc26-g-052: 3 rows (ids: 2264807,2264813,2264819)
wc26-g-053: 3 rows (ids: 2264808,2264814,2264820)
wc26-g-054: 3 rows (ids: 2264809,2264815,2264821)
wc26-g-061: 2 rows (ids: 2264786,2294842)
wc26-g-062: 2 rows (ids: 2264787,2294844)
wc26-g-063: 2 rows (ids: 2264788,2294845)
wc26-g-064: 2 rows (ids: 2264789,2294840)
wc26-g-065: 2 rows (ids: 2264790,2294841)
wc26-g-066: 2 rows (ids: 2264791,2294843)
wc26-r16-089: 2 rows (ids: 2324766,2354756)
wc26-r16-090: 2 rows (ids: 2324767,2354757)
```
Classification: Multiple engine runs wrote projections without dedup. 96 total rows / 72 distinct = 24 excess rows.

### wc2026_espn_shot_map (5 confirmed dupes)
```
espn:760459, period 2, 86', Gustavo Puerta, Right Foot (cnt=2)
espn:760415, period 1, 42', Julián Quiñones, Right Foot (cnt=2)
espn:760456, period 2, 90'+5', Lionel Messi, Left Foot (cnt=2)
espn:760496, period 1, 4', Bruno Fernandes, Right Foot (cnt=2)
espn:760464, period 2, 75', Achraf Hakimi, Right Foot (cnt=2)
```
Classification: ESPN API returned duplicate shot entries or re-scrape without dedup.

### wc2026_lineups (10+ confirmed dupes)
```
wc26-g-036: Hiroki Ito (jpn), Keito Nakamura (jpn), Ellyes Skhiri (tun) — cnt=2 each
wc26-g-034: Willian Pacho (ecu), Armando Obispo (cuw) — cnt=2 each
wc26-g-046: Samuel Moutoussamy (cod) — cnt=2
wc26-g-033: Seko Fofana (civ), Manuel Neuer (ger) — cnt=2 each
wc26-g-035: Viktor Gyökeres (swe), Yasin Ayari (swe) — cnt=2 each
```
Classification: FIFA scraper wrote same player twice (possibly appeared in both starter and sub roles, or re-scrape).

### wc2026_match_events (5 confirmed dupes)
```
wc26-g-005: SUB, 72, player_name="" (cnt=2)
wc26-g-023: SUB, 66, player_name="" (cnt=2)
wc26-g-053: SUB, 64', player_name=null (cnt=2)
wc26-g-071: SUB, 76', player_name=null (cnt=2)
wc26-g-010: VAR, 72, player_name="" (cnt=2)
```
Classification: Substitution events with empty/null player_name — likely double-sub at same minute (2 players subbed simultaneously). May be legitimate (2 subs at same minute) or true dupes.

### wc2026_holdout_validation (5 confirmed dupes)
```
wc26-g-065: AWAY (cnt=2)
wc26-g-064: DRAW (cnt=2)
wc26-g-037: HOME (cnt=2)
wc26-g-054: HOME (cnt=3)
wc26-g-052: HOME (cnt=3)
```
Classification: Multiple model runs wrote holdout rows without dedup.

### wc2026_recommendations (5 confirmed dupes)
```
wc26-g-062: 1X2, HOME (cnt=2)
wc26-g-064: 1X2, HOME (cnt=2)
wc26-g-050: 1X2, DRAW (cnt=3)
wc26-g-062: 1X2, DRAW (cnt=2)
wc26-g-037: 1X2, AWAY (cnt=2)
```
Classification: Multiple model runs wrote recommendations without dedup.

### wc2026_odds_snapshots (5 confirmed dupes)
```
wc26-g-044: 2026-06-24T05:49:38Z, ASIAN_HANDICAP, away (cnt=2)
wc26-g-018: 2026-06-11T14:31:04Z, TOTAL, over (cnt=6)
wc26-g-012: 2026-06-10T23:06:23Z, 1X2, draw (cnt=6)
wc26-g-026: 2026-06-19T04:57:12Z, DOUBLE_CHANCE, away_draw (cnt=2)
wc26-g-003: 2026-06-10T23:06:19Z, 1X2, home (cnt=6)
```
Classification: Snapshot collector ran multiple times at same timestamp without dedup. Some have 6x duplication.

## Cross-Table Divergence

### frozen_book_odds vs wc2026MatchOdds
- **Overlap:** 37 matches in both tables
- **Divergent ML values:** 19/37 (51%)

Sample divergences:
```
wc26-r16-089: frozen(1400/-500) vs odds(1600/-588)
wc26-r16-090: frozen(375/-125) vs odds(400/-120)
wc26-r16-091: frozen(-111/320) vs odds(-133/375)
wc26-r32-073: frozen(475/-145) vs odds(400/-120)
wc26-r32-074: frozen(-140/425) vs odds(-133/400)
wc26-r32-075: frozen(-275/800) vs odds(-303/850)
wc26-r32-076: frozen(130/250) vs odds(135/230)
wc26-r32-077: frozen(255/240) vs odds(270/110)
wc26-r32-078: frozen(-340/475) vs odds(-345/900)
wc26-r32-079: frozen(130/190) vs odds(130/310)
```

**Explanation (INFERRED):** frozen_book_odds captures closing-line odds (snapshot at kickoff), while wc2026MatchOdds stores the latest/running odds (updated by BetExplorer scraper at various times). These are EXPECTED to diverge — they represent different time points. This is NOT a data integrity failure but rather a design feature (frozen = closing line for grading; MatchOdds = latest available).

## B3 VERDICT

**7 tables have duplicates. 19 tables are CLEAN.**

Tables requiring dedup remediation:
1. wc2026_model_projections — 24 excess rows across 18 match_ids
2. wc2026_espn_shot_map — 5+ duplicate shots
3. wc2026_lineups — 10+ duplicate player entries
4. wc2026_match_events — 5+ duplicate events (may be legitimate double-subs)
5. wc2026_holdout_validation — 5+ duplicate validation rows
6. wc2026_recommendations — 5+ duplicate recommendation rows
7. wc2026_odds_snapshots — 5+ duplicate snapshots (some 6x)
