# r16-096 ESPN Scrape Run Log

## Match Details
- ESPN Match ID: 760508
- Teams: SUI (Switzerland, home, id=475) vs COL (Colombia, away, id=208)
- Date: 2026-07-07T20:00Z
- Venue: Inglewood
- DB Fixture: wc26-r16-096, home_team_id=sui, away_team_id=col

## Pre-Flight Gate: PASSED
- State: post (FINAL)
- Detail: FT-Pens
- Teams verified: SUI + COL present in payload
- Date verified: 2026-07-07

## Scoreline Gate: PASSED
- Regulation score (90 min): SUI 0 - 0 COL
- Extra time score (120 min): SUI 0 - 0 COL
- Penalty shootout: SUI 4 - 3 COL
- Advancement method: PENALTIES
- Winner: Switzerland
- Linescores: SUI [0|0|0|0|4], COL [0|0|0|0|3]
- Scoring plays in regulation/ET: 0 (correct)

### Shootout Detail
Colombia (3/5):
1. Juan Fernando Quintero — SCORED
2. Davinson Sánchez — MISSED
3. Jáminton Campaz — SCORED
4. Cucho Hernández — MISSED
5. Luis Díaz — SCORED

Switzerland (4/5):
1. Granit Xhaka — SCORED
2. Zeki Amdouni — SCORED
3. Manuel Akanji — MISSED
4. Cedric Itten — SCORED
5. Rubén Vargas — SCORED

## DB State Before Write
- wc2026_espn_matches: NO EXISTING ROW for 760508 (clean insert)
- wc2026_matches fixture: exists (wc26-r16-096), home_score=NULL, away_score=NULL, status=SCHEDULED

## Scraper Architecture
- File: server/wc2026/espnDbIngester.ts
- Entry point: `scrapeAndIngest(gameId, { dryRun })` 
- Calls: espnPageScraper.ts → scrapeEspnMatchPage(gameId)
- Then: ingestEspnMatchData(data, opts)
- 8 phases writing to 8 tables
- Upsert strategy: INSERT ON DUPLICATE KEY UPDATE
- Has dryRun mode

## Execution Plan
1. Call scrapeAndIngest("760508", { dryRun: true }) first — dry run
2. Review output
3. Call scrapeAndIngest("760508", { dryRun: false }) — production write
4. Post-write re-read all 8 tables

## Production Write Results

### Execution
- Command: `npx tsx server/wc2026/_espn_ingest_runner_760508.ts`
- Exit code: 0
- Duration: 7377ms
- Mode: PRODUCTION WRITE (not dry-run)

### Per-Table Ledger (match-scoped, espn_match_id=760508)

| Phase | Table | Rows Written | Status |
|-------|-------|-------------|--------|
| 1/9 | wc2026_espn_matches | 1 | PASS |
| 3/9 | wc2026_espn_team_stats | 1 | PASS |
| 4/9 | wc2026_espn_match_stats | 1 | PASS |
| 5/9 | wc2026_espn_expected_goals | 1 | PASS |
| 6/9 | wc2026_espn_shot_map | 32 | PASS |
| 7/9 | wc2026_espn_player_stats | 33 | PASS |
| 8/9 | wc2026_espn_lineups | 49 | PASS |
| 9/9 | wc2026_espn_glossary | 20 | PASS |
| **TOTAL** | | **138** | **8/8 active phases PASS** |

### Total Row Counts (All Matches, Post-Write)

| Table | Total Rows |
|-------|------------|
| wc2026_espn_matches | 92 |
| wc2026_espn_team_stats | 90 |
| wc2026_espn_match_stats | 90 |
| wc2026_espn_expected_goals | 90 |
| wc2026_espn_shot_map | 2251 |
| wc2026_espn_player_stats | 2806 |
| wc2026_espn_lineups | 4559 |
| wc2026_espn_glossary | 20 |

Baseline was ~129 rows for r16-095. This match: 138 rows (more due to ET/penalties = more shots, subs, player stats).

### Post-Write Cross-Checks

**Match Record:**
- homeTeamAbbrev=SUI, awayTeamAbbrev=COL
- homeScore=0, awayScore=0 (regulation/ET score correctly recorded)
- statusState=post, statusDetail=FT-Pens, statusDisplay="Final Score - After Penalties"
- venue=BC Place, attendance=52497
- homeFormation=4-2-3-1, awayFormation=4-4-1-1
- homeLinescores=["0","0","0","0","4"], awayLinescores=["0","0","0","0","3"]
- matchGameDate=2026-07-07, matchKickoffEt=16:00

**Shot Map Cross-Check:**
- Total shots: 32
- iconType breakdown: goal=7, blocked=5, offTarget=14, save=6
- Regulation/ET goals (period<=4): 0 ✔ (matches 0-0 scoreline)
- Penalty period goals (period=5): 7 (SUI 4 + COL 3 = 7) ✔
- Shots by period: P1=7, P2=6, P3(ET1)=5, P4(ET2)=4, P5(Pens)=10

**Lineups Cross-Check:**
- Total: 49 players
- Starters: 22 (11+11) ✔
- Substitutes: 11 (6 SUI + 5 COL)
- Unused: 16 (6 SUI + 10 COL)
- GK SUI: Gregor Kobel (#1, starter) ✔
- GK COL: Camilo Vargas (#12, starter) ✔

**Expected Goals:**
- homeXG=0.350, awayXG=1.030
- homeXGOpenPlay=0.290, awayXGOpenPlay=0.800
- Per-player JSON: 33 entries

**Match Stats:**
- homeXG=0.350, awayXG=1.030
- homeShotsOnGoal=2, awayShotsOnGoal=3
- homeAccuratePasses=546, awayAccuratePasses=454
- homeGkSaves=3

**Player Stats:** 33 rows (16 home + 15 away + 2 GKs = 33)

### Discrepancies

1. **TEST-001 false-negative (pre-cleared):** `success=false` because code expects 9/9 phases but Phase 2 was removed. All 8 active phases PASS. Known harness issue.
2. **Shot map goal count note:** "goals in map=7 vs scoreGoals=0" logged by ingester. This is CORRECT behavior for a penalty-decided match: the 7 goals are all in period 5 (shootout), regulation/ET score is 0-0.
3. **Rubén Vargas (SUI, #17) matched by GK name query:** False positive from LIKE '%Vargas%' — he's an outfield player (substitute). The actual COL GK is Camilo Vargas (#12). Both real GKs confirmed present.

## Feed Publish (2026-07-07T23:58Z)

### Fixture UPDATE
```sql
UPDATE wc2026_matches SET home_score=0, away_score=0, status='FT', advancing_team_id='sui'
WHERE match_id='wc26-r16-096'
```
- Rows affected: 1
- First attempt with `status='FT-PEN'` failed (WARN_DATA_TRUNCATED) — enum only allows `('SCHEDULED','LIVE','HT','ET','SHOOTOUT','FT')`
- Used `FT` + `advancing_team_id='sui'` to encode penalty outcome

### Feed Verification
- Endpoint: `wc2026.todayWithOdds`
- r16-096 present: homeScore=0, awayScore=0, status=FT, advancingTeamId=sui
- Shootout display: Score shows 0-0 (regulation), NOT 4-3 (shootout) ✔
- DK odds present, model projections present

### Grading Gap
- Model predicted SUI to advance (toAdvanceHomeOdds=-139). Correct outcome.
- No automated grading system exists. Flagged, not fabricated.

---

### Paths (Persistent)
- Raw ESPN API payload: `audit-notes/run-logs/raw/espn_760508_raw.json` (440KB)
- Scraper page data: `audit-notes/run-logs/raw/espn_760508_scrape_payload.json` (750KB)
- Ingest result JSON: `audit-notes/run-logs/raw/espn_760508_ingest_result.json`
- Production write log: `audit-notes/r16-096_production_write.log`
- Runner script: `server/wc2026/_espn_ingest_runner_760508.ts`
