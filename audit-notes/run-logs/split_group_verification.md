# Split Group Verification (2026-07-08T06:25Z)

## Context

Post-population, the original 360 collision groups became 355. The "5 disappeared" groups
were those that split because team_id population assigned different values to copies within
the same original group (all had team_id='' pre-population).

## Query

Found 15 groups where same (match_id, minute_num, event_type) has >1 distinct team_id
across the 24 early matches. These are NOT the "5 disappeared" — they are ALL legitimate
multi-team events (both teams subbing/scoring in the same minute).

## Verification Results

### 14 of 15 groups: LEGITIMATE DISTINCT EVENTS

All are simultaneous events by different teams in the same minute. Examples:
- wc26-g-018 min=90 GOAL: Ibrahim Mbaye (SEN) + Kylian Mbappé (FRA) — two goals same minute
- wc26-g-017 min=73 SUB: 4 Norway subs + 2 Iraq subs — mass substitution window
- wc26-g-004 min=79 SUB: Mohamed Manai (QAT) + Zeki Amdouni (SUI) — both teams subbing

Each row has a DIFFERENT player from a DIFFERENT team. These are real events confirmed by
ESPN source data.

### 1 of 15 groups: ESCAPED DUPLICATE (wc26-g-005 min=52 VAR)

| id | team_id | player_name | Status |
|----|---------|-------------|--------|
| 290 | usa | Tim Ream | RETAINED (correct — ESPN confirms VAR Card Upgrade for Tim Ream) |
| 291 | (empty) | (empty) | DELETED — dupe that escaped Phase 4 because population gave id=290 team_id='usa' while id=291 kept team_id='' |

**ESPN source (760417):** Single VAR event at 52' — "VAR - (Red) Card Upgrade" for Tim Ream (USA).
Only ONE VAR event exists at this minute. id=291 is a re-emission copy.

## Action Taken

- id=291 archived (full row JSON above) and DELETED
- Post-delete verification: only id=290 remains at (wc26-g-005, 52, VAR)

## Post-Fix Reconciliation (wc26-g-005 only)

| Type | Our Table | ESPN Source | Match? |
|------|-----------|-------------|--------|
| GOAL | 4 | 4 | ✅ |
| OWN_GOAL | 1 | 1 | ✅ |
| YELLOW | 6 | 6 | ✅ |
| RED | 1 | 1 | ✅ |
| SUB | 9 | 9 | ✅ |
| VAR | 14 | N/A (ESPN doesn't track VAR in keyEvents) | N/A |

Named events: PERFECT MATCH. VAR: not reconcilable against ESPN (ESPN doesn't include VAR events).

## Reconciliation Scope Confirmation

Phase 5 reconciliation (62/62 PASS) compared NAMED events only (GOAL, OWN_GOAL, SUB, YELLOW, RED, PENALTY)
against ESPN keyEvents. ESPN does NOT include VAR events in keyEvents — confirmed during Phase 2 when
0/508 VAR events could be populated from ESPN.

Therefore: the reconciliation is valid for all named events. VAR events are validated only by the
dedup process (byte-identity within groups) and the UNIQUE constraint (prevents future re-emission).

## Total Escaped Dupes

**1 row** (id=291). Now deleted. No other escaped dupes exist (self-join query confirmed count=1).

## Updated Dedup Total

Original: 257 rows deleted in Phase 4
This fix: +1 row deleted (id=291)
**Final total: 258 rows deleted across all dedup passes.**

(Note: this reconciles back to the original "258" figure that was stated verbally — the original
count was accidentally correct for the wrong reason. The archive artifact has 257; this supplemental
delete adds 1 = 258 total.)
