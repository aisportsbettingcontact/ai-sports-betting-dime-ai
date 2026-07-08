# FE/DB-015: Penalty-Status Enum Gap

**Filed:** 2026-07-08T00:15Z
**Priority:** P3 (data-integrity risk, no immediate breakage)
**Status:** OPEN — scoped, gated to next schema session
**Authorization:** None required (filing only)

---

## Finding

`wc2026_matches.status` enum is `('SCHEDULED','LIVE','HT','ET','SHOOTOUT','FT')`. There is no value representing "match decided by penalties after extra time." Penalty-decided matches are encoded as:

```
status = 'FT'
home_score = away_score (equal — regulation+ET score)
advancing_team_id IS NOT NULL
```

The meaning "decided on penalties" exists **only** as a derived 3-condition check. Any consumer that reads `status='FT'` + `homeScore=awayScore` without also checking `advancingTeamId` will misinterpret a penalty shootout as a regulation draw.

---

## Consumer Blast-Radius Inspection

### Consumer 1: `WcFeedInline.tsx` (WcScorePanel) — Frontend feed card
- **File:** `client/src/components/WcFeedInline.tsx`
- **Lines:** 949-1270
- **Status check:** Line 953: `const isFinal = match.status === "FT"`
- **Score coloring:** Lines 1147-1149: `homeWins = homeScoreNum > awayScoreNum`, `isDraw = homeScoreNum === awayScoreNum`
- **Penalty derivation:** Line 1001: `const advancingTeamId = match.advancingTeamId ?? null` → Line 1244: renders "X ADVANCES TO QF" row when `isFinal && advancingFifaCode && advancingTeam`
- **VERDICT: SAFE** [VERIFIED, file+line cited]
  - Score shows 0-0 (correct — regulation score)
  - Score coloring: `isDraw=true` → both scores white/unbolded (no winner highlighted by score alone)
  - Advancing team row renders below scores with explicit "SWITZERLAND ADVANCES TO QF" text
  - The 3-condition derivation IS replicated: `isFinal` + equal scores (implicit from display) + `advancingTeamId` shown
  - **Risk:** Score coloring shows no winner (white/unbolded both sides) which is technically correct for the regulation score but visually ambiguous — user sees "0-0 FINAL" + "SWITZERLAND ADVANCES" without explicit "on penalties" text

### Consumer 2: `WorldCup2026.tsx` (MatchCard) — Secondary page
- **File:** `client/src/pages/WorldCup2026.tsx`
- **Lines:** 234-237
- **Status check:** Line 237: `const isFinal = status === "FT"`
- **Penalty derivation:** NONE — no `advancingTeamId` check, no penalty-specific display
- **VERDICT: VULNERABLE** [VERIFIED, file+line cited]
  - Shows `status="FT"` but does NOT display advancing team
  - A penalty-decided match (0-0 FT, SUI advances) would display as a 0-0 draw with no indication of penalty outcome
  - **Impact:** Low — this page is secondary (group view), KO matches primarily displayed on main feed

### Consumer 3: `wc2026Router.ts` (matchesByDate / todayWithOdds) — API layer
- **File:** `server/wc2026/wc2026Router.ts`
- **Lines:** 225-253
- **Status passthrough:** Line 225: `matches.map((f: WcMatch) => { ...f, advancingTeamId: f.advancingTeamId ?? null })`
- **Penalty derivation:** Passes raw `status` + `advancingTeamId` to frontend — no transformation
- **VERDICT: SAFE (passthrough)** [VERIFIED, file+line cited]
  - Router does not interpret status; it passes all fields including `advancingTeamId`
  - Responsibility for derivation falls on frontend consumers

### Consumer 4: `wc2026Context.ts` (DIME AI context builder)
- **File:** `server/dime/wc2026Context.ts`
- **Line:** 182
- **Status check:** `score_if_final: m.status === "FT" ? \`${m.home_score}-${m.away_score}\` : null`
- **Penalty derivation:** NONE — no `advancing_team_id` in the context object
- **VERDICT: VULNERABLE** [VERIFIED, file+line cited]
  - DIME receives `score_if_final: "0-0"` and `status: "FT"` for a penalty-decided match
  - No field communicates "decided on penalties" or "SUI advances"
  - AI model would interpret this as a 0-0 draw in regulation — technically correct for score, but missing the advancement outcome
  - **Impact:** Medium — DIME recommendations/analysis may not account for the actual match winner in KO context

### Consumer 5: `wc2026Ingester.ts` (ESPN scoreboard ingester)
- **File:** `server/wc2026/wc2026Ingester.ts`
- **Lines:** 284-310, 426, 535
- **Status write:** Line 310: `const matchStatus = isCompleted ? "FT" : isInProgress ? "LIVE" : null`
- **Penalty handling:** ESPN `STATUS_PENALTY` → mapped to `isInProgress` (LIVE path). When completed=true after penalties → writes `status="FT"`
- **VERDICT: SAFE (writer, not reader)** [VERIFIED, file+line cited]
  - This is a WRITER not a READER of status
  - Correctly writes FT for completed matches regardless of how they ended
  - Does NOT write `advancing_team_id` — that's handled by `seedAdvancingTeams.ts`
  - No misinterpretation risk (it's the source of the FT value)

### Consumer 6: `fifaLiveScraper.ts` (FIFA live score updater)
- **File:** `server/wc2026/fifaLiveScraper.ts`
- **Lines:** 79-95
- **Status mapping:** `MatchStatus=0` → `FT`, `Period=11` → `SHOOTOUT`
- **VERDICT: SAFE (writer)** [VERIFIED, file+line cited]
  - During live play: correctly writes `SHOOTOUT` when `Period=11`
  - After match ends: FIFA sets `MatchStatus=0` → writes `FT` (correct final state)
  - Transition: SHOOTOUT → FT happens naturally when FIFA marks match complete
  - No misinterpretation — this is a writer that correctly uses the enum

### Consumer 7: `wc2026Heartbeat.ts` (POST-FT hook / bracket sync trigger)
- **File:** `server/wc2026/wc2026Heartbeat.ts`
- **Lines:** 209-217
- **Status check:** Line 214: `s.status === "FT" || s.status === "AET" || s.status === "PEN"`
- **VERDICT: PARTIALLY SAFE** [VERIFIED, file+line cited]
  - Checks for "FT", "AET", "PEN" in match summary status (from ESPN `statusDesc`)
  - Note: This checks the ESPN-reported status string, NOT the DB enum value
  - The ESPN summary `statusDesc` field contains "Full Time" / "After Extra Time" / "After Penalties" — distinct from DB enum
  - Bracket sync triggers correctly for all completed KO matches
  - **Nuance:** If this ever switches to reading DB status instead of ESPN status, it would lose the penalty distinction

### Consumer 8: `seedAdvancingTeams.ts` (bracket advancement writer)
- **File:** `server/wc2026/seedAdvancingTeams.ts`
- **Lines:** 101, 114-147, 291-303
- **Status handling:** Hardcodes `status: "FT"` for all completed matches (line 303)
- **Penalty handling:** Line 91: "GER vs PAR ended 1-1 FT. FIFA HTML shows PAR as winner (penalty shootout). DB already has home_score=1, away_score=1, status=FT. advancingTeamId = 'par'"
- **VERDICT: SAFE (writer)** [VERIFIED, file+line cited]
  - Correctly writes `status='FT'` + `advancing_team_id` for penalty-decided matches
  - The `advancingMethod` field in its internal data captures "penalty" but this is NOT persisted to DB
  - No misinterpretation — it's the source of the advancing_team_id value

### Consumer 9: `checkScores.ts` (forensic DB query — one-off diagnostic)
- **File:** `server/wc2026/checkScores.ts`
- **Lines:** 47-68
- **Status usage:** Line 63: `status=${r.status}` (display only)
- **VERDICT: SAFE (diagnostic)** [VERIFIED, file+line cited]
  - Read-only forensic script, displays status as-is
  - No decision logic based on status value

### Consumer 10: `betAutoGradeScheduler.ts` (MLB/NBA bet grading)
- **File:** `server/betAutoGradeScheduler.ts`
- **Status usage:** Does NOT read `wc2026_matches` at all
- **VERDICT: NOT APPLICABLE** [VERIFIED]
  - Only grades MLB/NBA/NHL bets, no WC2026 integration

---

## Summary: Blast Radius

| Consumer | Type | Penalty-Aware? | Verdict |
|----------|------|---------------|---------|
| WcFeedInline.tsx (main feed) | Reader | YES (advancingTeamId row) | SAFE |
| WorldCup2026.tsx (group page) | Reader | NO | **VULNERABLE** (low impact) |
| wc2026Router.ts (API) | Passthrough | N/A (passes all fields) | SAFE |
| wc2026Context.ts (DIME) | Reader | NO | **VULNERABLE** (medium impact) |
| wc2026Ingester.ts | Writer | N/A | SAFE |
| fifaLiveScraper.ts | Writer | N/A | SAFE |
| wc2026Heartbeat.ts | Reader (ESPN status) | YES (checks "PEN") | PARTIALLY SAFE |
| seedAdvancingTeams.ts | Writer | N/A | SAFE |
| checkScores.ts | Diagnostic | N/A | SAFE |
| betAutoGradeScheduler.ts | N/A | N/A | NOT APPLICABLE |

**Vulnerable consumers: 2**
- `WorldCup2026.tsx` — would show 0-0 FT with no penalty indication (low impact, secondary page)
- `wc2026Context.ts` — DIME AI gets "0-0 FT" with no advancement info (medium impact, affects AI reasoning)

---

## Proposed Remediation (gated to next schema session)

1. **Add `'FT_PEN'` to status enum** (or `'FT_AET'` + `'FT_PEN'` for full coverage):
   ```sql
   ALTER TABLE wc2026_matches MODIFY COLUMN status ENUM('SCHEDULED','LIVE','HT','ET','SHOOTOUT','FT','FT_AET','FT_PEN');
   ```
2. **Update Drizzle schema** to match
3. **Backfill existing penalty matches:** `UPDATE wc2026_matches SET status='FT_PEN' WHERE status='FT' AND home_score=away_score AND advancing_team_id IS NOT NULL`
4. **Update consumers:**
   - `wc2026Context.ts`: Add `advancing_team_id` to DIME context object
   - `WorldCup2026.tsx`: Add advancing team display for KO matches
   - All `isFinal` checks: change to `isFinal = status === "FT" || status === "FT_PEN" || status === "FT_AET"`
5. **Update writers:**
   - `wc2026Ingester.ts`: Map ESPN `completed=true` + penalty indicators → `FT_PEN`
   - `seedAdvancingTeams.ts`: Write `FT_PEN` when `advancingMethod='penalty'`

**DO NOT execute until next schema session authorization.**

---

## Cross-References

- r16-096 run log: first match where this gap was encountered in production
- r32-075 (GER vs PAR): earlier penalty match, same encoding used
- DB-008 (enum consolidation): related enum work, same table
