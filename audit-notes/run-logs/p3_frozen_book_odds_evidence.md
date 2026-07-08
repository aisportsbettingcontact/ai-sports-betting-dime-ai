# P3: FROZEN_BOOK_ODDS Recovery — Evidence Log

**Executed:** 2026-07-08T07:05–07:14 UTC  
**Status:** COMPLETE ✅  
**Coverage:** 92/92 completed matches now have frozen_book_odds (was 37/92)

---

## Pre-Condition

```sql
SELECT COUNT(*) FROM wc2026_frozen_book_odds;
-- 37 (pre-existing: DraftKings=33, DraftKings-Jul2-2026=3, DK_FROZEN=1)

SELECT COUNT(*) FROM wc2026_matches WHERE status IN ('FT','FT_PEN');
-- 92 completed matches

-- Missing: 57 matches (54 group-stage with odds_snapshots, 3 R16 without)
```

---

## Part 1: 54 Group-Stage Matches from odds_snapshots

**Script:** `server/wc2026/p3_frozen_odds_derivation.mjs`  
**Strategy:** For each match, find EARLIEST non-closing snapshot per market/selection → map to frozen_book_odds columns  
**Provenance:** `book_source='odds_snapshots_opening'`, `frozen_by='p3_recovery_script'`

### Column Mapping (odds_snapshots → frozen_book_odds)

| Snapshot market|selection | Frozen column | Value used |
|---|---|---|
| 1X2\|home | book_home_ml | american_odds |
| 1X2\|draw | book_draw | american_odds |
| 1X2\|away | book_away_ml | american_odds |
| 1X2\|no_draw | book_no_draw | american_odds |
| TOTAL\|over | book_total + book_over_odds | line + american_odds |
| TOTAL\|under | book_under_odds | american_odds |
| BTTS\|yes | book_btts_yes | american_odds |
| BTTS\|no | book_btts_no | american_odds |
| DOUBLE_CHANCE\|away_draw | book_away_wd | american_odds |
| DOUBLE_CHANCE\|home_draw | book_home_wd | american_odds |
| DOUBLE_CHANCE\|away | book_no_draw_away_odds | american_odds |
| ASIAN_HANDICAP\|home* | book_primary_spread + book_home_primary_spread_odds | line + american_odds |
| ASIAN_HANDICAP\|away* | book_away_primary_spread_odds | american_odds |

### Execution Result

```
[P3] [INPUT] Found 54 matches with snapshots but no frozen_book_odds
[P3] [INPUT] Match IDs: wc26-g-001 ... wc26-g-054
[P3] [OUTPUT] Inserted/Updated: 54
[P3] [OUTPUT] Errors: 0
[P3] [OUTPUT] Total processed: 54
[P3] [VERIFY] Final frozen_book_odds count: 91
```

### Spot-Checks (3/54)

**wc26-g-001 (MOR vs USA, Jun 11):**
```
Frozen: home_ml=750, draw=350, away_ml=-240, total=2.5
Source snapshot: 1X2|home odds=750, ts=2026-06-10 23:05:24 ✅
```

**wc26-g-028 (Jun 19):**
```
Frozen: home_ml=-132, draw=226, away_ml=703, total=2
Source snapshot: 1X2|draw odds=226, ts=2026-06-19 04:57:12 ✅
```

**wc26-g-054 (Jun 24):**
```
Frozen: home_ml=272, draw=290, away_ml=110, total=2.5
Source snapshot: 1X2|draw odds=290, ts=2026-06-24 10:45:56 ✅
```

### Data Quality

- NULL moneylines (home/draw/away): **0/54** ✅
- NULL totals: **0/54** ✅
- NULL spreads: **1/54** (wc26-g-012 — only had away ASIAN_HANDICAP, no home)
  - **Fixed:** Derived home spread from away line (away=+0.5 → home=-0.5, odds=-135)
  - Post-fix NULL spreads: **0/54** ✅

---

## Part 2: 3 R16 Matches from wc2026MatchOdds

**Script:** `server/wc2026/p3_r16_frozen_odds.mjs`  
**Strategy:** Copy book_* columns directly from `wc2026MatchOdds` table  
**Provenance:** `book_source='wc2026MatchOdds_derived'`, `frozen_by='p3_recovery_script'`

### Execution Result

```
[P3-R16] [INPUT] Found 3 rows in wc2026MatchOdds for R16 matches

wc26-r16-092 (COL vs ENG):
  home_ml=200, draw=220, away_ml=145
  spread=0.5, total=2.5, over=138, under=-175
  btts_yes=100, btts_no=-133
  home_to_advance=100, away_to_advance=-137
  odds_source=betexplorer
  → Inserted ✅

wc26-r16-095 (FRA vs ???):
  home_ml=-303, draw=375, away_ml=1000
  spread=-1.5, total=2.5, over=-102, under=-114
  btts_yes=150, btts_no=-200
  home_to_advance=-900, away_to_advance=550
  odds_source=betexplorer+draftkings_manual_advance
  → Inserted ✅

wc26-r16-096 (SUI vs COL):
  home_ml=250, draw=210, away_ml=125
  spread=0.5, total=2.5, over=130, under=-161
  btts_yes=-105, btts_no=-125
  home_to_advance=125, away_to_advance=-155
  odds_source=betexplorer+draftkings_manual_advance
  → Inserted ✅
```

---

## Post-Condition

```sql
-- Final state:
completed_with_frozen = 92  -- 92/92 completed matches ✅
total_frozen_rows = 94      -- includes 2 upcoming (r16-089, r16-090 SCHEDULED)
total_completed_matches = 92
upcoming_with_frozen = 2    -- pre-existing, not touched

-- Source distribution:
odds_snapshots_opening: 54  (this session)
DraftKings: 33              (pre-existing)
wc2026MatchOdds_derived: 3  (this session)
DraftKings-Jul2-2026: 3     (pre-existing)
DK_FROZEN: 1                (pre-existing)
```

---

## Verdict

**P3 FROZEN_BOOK_ODDS: COMPLETE**

- 57 missing matches populated → 92/92 completed matches now have frozen_book_odds
- 54 from odds_snapshots (earliest opening line)
- 3 from wc2026MatchOdds (engine-derived values)
- 1 spread fix applied (g-012: derived from away AH)
- Zero unrecoverable matches
- All core markets populated (ML, spread, total, BTTS, double chance)
- Provenance stamped on all new rows
