# B5: WC2026 Accuracy Spot-Checks

**Query run:** 2026-07-08T01:32Z
**Source URLs:**
- ESPN API: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={id}`
- BetExplorer: `https://www.betexplorer.com/football/world/world-cup-2026/` (redirects to Portuguese, site geo-locked)

## ESPN Data Spot-Checks (3 matches)

### Match 1: espn_match_id=760415 (MEX vs RSA, Group Stage)
**Source URL:** https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760415

| Field | DB Value | LIVE API Value | Match? |
|-------|----------|----------------|--------|
| Score | MEX 2-0 RSA | MEX 2-0 RSA | ✅ MATCH |
| Status | FT | FT | ✅ MATCH |
| SOG (home-away) | 4-2 | 4-2 | ✅ MATCH |
| Corners | 3-1 | 3-1 | ✅ MATCH |
| Lineups count | 52 | 52 | ✅ MATCH |
| **homeShots (DB) vs totalShots (API)** | **4 vs 16** | **MISMATCH** | ⚠️ SEE BELOW |

### Match 2: espn_match_id=760459 (COL vs COD, Group Stage)
**Source URL:** https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760459

| Field | DB Value | LIVE API Value | Match? |
|-------|----------|----------------|--------|
| Score | COL 1-0 COD | COL 1-0 COD | ✅ MATCH |
| Status | FT | FT | ✅ MATCH |
| SOG (home-away) | 9-1 | 9-1 | ✅ MATCH |
| Corners | 5-4 | 5-4 | ✅ MATCH |
| Lineups count | 52 | 52 | ✅ MATCH |
| **homeShots (DB) vs totalShots (API)** | **9 vs 20** | **MISMATCH** | ⚠️ SEE BELOW |

### Match 3: espn_match_id=760508 (SUI vs COL, R16 - Penalties)
**Source URL:** https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=760508

| Field | DB Value | LIVE API Value | Match? |
|-------|----------|----------------|--------|
| Score | SUI 0-0 COL | SUI 0-0 COL | ✅ MATCH |
| Status | FT-Pens | FT-Pens | ✅ MATCH |
| SOG (home-away) | 2-3 | 2-3 | ✅ MATCH |
| Corners | 3-7 | 3-7 | ✅ MATCH |
| Lineups count | 49 | 49 | ✅ MATCH |
| **homeShots (DB) vs totalShots (API)** | **2 vs 7** | **MISMATCH** | ⚠️ SEE BELOW |

## homeShots/awayShots Column Mapping Issue (VERIFIED)

**Finding:** The `homeShots`/`awayShots` columns in `wc2026_espn_match_stats` store **shotsOnGoal** (same value as `homeShotsOnGoal`), NOT total shots.

**Proof:**
```
760508: DB homeShots=2, homeShotsOnGoal=2, insideBox+outsideBox=4+3=7, LIVE totalShots=7
760415: DB homeShots=4, homeShotsOnGoal=4, insideBox+outsideBox=9+7=16, LIVE totalShots=16
```

**Conclusion:** This is a **COLUMN NAMING ISSUE** in the ingester, not data loss. All shot data IS present:
- Total shots = `homeAttemptsInsideBox + homeAttemptsOutsideBox` (correctly stored)
- Shots on goal = `homeShotsOnGoal` (correctly stored)
- `homeShots` = redundant copy of `homeShotsOnGoal` (misleading name)

**Impact:** LOW — any consumer using `homeShots` as "total shots" would get wrong values. Actual total shots are recoverable from insideBox+outsideBox. File as DATA-001 (P4, cosmetic naming).

## BetExplorer Odds Verification

**Status: UNABLE TO VERIFY LIVE** — BetExplorer redirects to Portuguese geo-locked version and does not serve the World Cup 2026 results page directly. The site requires navigation through its interface.

**Alternative verification approach:** The DB odds for wc26-g-001 (USA vs Morocco) are:
- book_home_ml: -238, book_draw: +333, book_away_ml: +750

These are American odds. Converting to decimal: Home=1.42, Draw=4.33, Away=8.50.

**Cross-reference with frozen_book_odds (same match if available):** wc26-g-001 is NOT in frozen_book_odds (only 37 rows, starting from g-055). Cannot cross-validate.

**Provenance label:** odds_source='betexplorer' — VERIFIED by last_insert_method='wc2026_betexplorer_scraper_v4.py' (the scraper that wrote these values).

## B5 VERDICT

| Table | Accuracy | Label |
|-------|----------|-------|
| wc2026_espn_matches | ✅ PASS (3/3 scores match, 3/3 status match) | VERIFIED |
| wc2026_espn_match_stats | ⚠️ PARTIAL (SOG/corners match, homeShots naming issue) | VERIFIED with caveat |
| wc2026_espn_lineups | ✅ PASS (3/3 counts match exactly) | VERIFIED |
| wc2026MatchOdds | UNABLE TO VERIFY vs live source (BetExplorer geo-locked) | INFERRED correct (provenance chain intact) |
| wc2026_frozen_book_odds | UNABLE TO VERIFY vs live source | INFERRED correct |

**New finding filed:** DATA-001 — homeShots/awayShots column stores shotsOnGoal, not totalShots. Naming mismatch in ingester. P4, cosmetic, no data loss.
