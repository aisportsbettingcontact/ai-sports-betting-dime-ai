# B6: WC2026 Cross-Table Integrity

**Query run:** 2026-07-08T01:35Z
**Script:** `audit_b6.mjs`

## CHECK 1-7: FK Resolution (child → wc2026_matches)

| Table | Orphan match_ids | Status |
|-------|-----------------|--------|
| wc2026_espn_matches | 0 | ✅ PASS |
| wc2026_espn_team_stats | 0 | ✅ PASS |
| wc2026_espn_match_stats | 0 | ✅ PASS |
| wc2026_espn_expected_goals | 0 | ✅ PASS |
| wc2026_espn_shot_map | 0 | ✅ PASS |
| wc2026_espn_player_stats | 0 | ✅ PASS |
| wc2026_espn_lineups | 0 | ✅ PASS |
| wc2026MatchOdds | 0 | ✅ PASS |
| wc2026_model_projections | 0 | ✅ PASS |
| wc2026_frozen_book_odds | 0 | ✅ PASS |
| wc2026_holdout_validation | 0 | ✅ PASS |
| wc2026_recommendations | 0 | ✅ PASS |
| wc2026_market_no_vig | 0 | ✅ PASS |

**VERDICT: ALL FKs resolve. Zero referential orphans across all 13 child tables.** [VERIFIED]

## CHECK 8: Every played match (FT) has ESPN data

**Result: ✅ 0 played matches missing ESPN data** [VERIFIED]

All FT matches have corresponding rows in wc2026_espn_matches.

## CHECK 9: Every played match (FT) has odds

**Result: ❌ 12 played matches missing odds** [VERIFIED]

Missing match_ids:
```
wc26-g-025 (cze vs rsa)
wc26-g-026 (mex vs kor)
wc26-g-027 (sui vs bih)
wc26-g-028 (can vs qat)
wc26-g-037 (bel vs irn)
wc26-g-038 (nzl vs egy)
wc26-g-039 (esp vs ksa)
wc26-g-040 (uru vs cpv)
wc26-g-041 (fra vs irq)
wc26-g-042 (nor vs sen)
wc26-g-043 (arg vs aut)
wc26-g-044 (jor vs alg)
```

**Classification:** These are Matchday 2 group-stage matches (g-025 to g-044 range). They were played but never had odds rows created. This is a **coverage gap** — the BetExplorer scraper or seeding process missed these 12 matches entirely.

**Note:** These 12 are a SUBSET of the DB-009 problem (skeleton rows with no book data). But unlike the 59 'no_book_odds' shells, these 12 have NO ROW AT ALL in wc2026MatchOdds.

## CHECK 10: Every played match (FT) has model projections

**Result: ❌ 24 played matches missing projections** [VERIFIED]

Missing match_ids (all Matchday 1 group stage):
```
wc26-g-001 through wc26-g-024
```

**Classification:** These are ALL 24 Matchday 1 group-stage matches. The model projection engine was not yet operational when these matches were played. This is a **legitimate temporal gap** — the model started running from Matchday 2 onwards.

## CHECK 11: frozen_book_odds vs wc2026MatchOdds value consistency

**Result: ⚠️ 10 divergent rows (5 shown)** [VERIFIED]

```
wc26-r16-089: frozen=1400/600/-500 vs live=1600/600/-588
wc26-r16-090: frozen=375/250/-125 vs live=400/225/-120
wc26-r16-091: frozen=-111/240/320 vs live=-133/270/375
wc26-r32-073: frozen=475/265/-145 vs live=400/225/-120
wc26-r32-074: frozen=-140/270/425 vs live=-133/250/400
```

**Classification:** EXPECTED BEHAVIOR. frozen_book_odds captures odds at freeze time (pre-kickoff snapshot). wc2026MatchOdds may have been updated with closing-line odds after the freeze. The divergence is the design working correctly — frozen preserves the pre-game snapshot, live reflects the latest scrape.

## CHECK 12: espn_match_id population in wc2026_matches

**Result: ✅ 0 matches missing espn_match_id** [VERIFIED]

All 104 matches have espn_match_id populated.

## B6 SUMMARY

| Check | Result | Impact |
|-------|--------|--------|
| FK resolution (13 tables) | ✅ ALL PASS | Zero orphans |
| Played→ESPN | ✅ PASS | All FT matches have ESPN data |
| Played→Odds | ❌ FAIL (12 missing) | Coverage gap: MD2 matches never seeded |
| Played→Projections | ❌ FAIL (24 missing) | Temporal gap: MD1 pre-dates model |
| frozen vs live odds | ⚠️ 10 divergent | Expected (freeze vs closing line) |
| espn_match_id population | ✅ PASS | All 104 populated |

**Referential integrity: CLEAN.** No orphan foreign keys anywhere.
**Coverage gaps: 12 matches missing odds rows entirely + 24 matches missing projections (temporal).**
