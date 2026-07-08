# Phase 3: UNIQUE Pre-Check — Evidence

**Timestamp:** 2026-07-08T04:53Z

## Critical Finding

**UNIQUE(match_id, minute_num, team_id, event_type) is UNSAFE.** 155 legitimate multi-row cases exist where different players share the same 4-column key.

## Classification

| Category | Count | Description |
|---|---|---|
| Legitimate multi-row | 155 | Different player_names → distinct events sharing key |
| Ambiguous (NULL player) | 200 | All VAR events with no player attribution |
| Genuine dupes (same player) | 0 | None found post-population |

## Legitimate Multi-Row Breakdown

| event_type | Groups | Explanation |
|---|---|---|
| SUB | 153 | Multiple substitutions in same minute (common: double/triple subs) |
| YELLOW | 2 | Two different players carded in same minute |

## Examples

```
wc26-g-002 | min=64 | team=cze | type=SUB | cnt=3 | players: Adam Hlozek | Michal Sadílek | Tomás Chorý
wc26-g-003 | min=45 | team=bih | type=YELLOW | cnt=2 | players: Ermedin Demirovic | Jovo Lukic
wc26-g-004 | min=60 | team=qat | type=SUB | cnt=3 | players: Ahmed Alaaeldin | Ahmed Fathy | Karim Boudiaf
```

## Implication for Constraint Design

The 4-column key `(match_id, minute_num, team_id, event_type)` cannot be made UNIQUE without data loss. The key needs a **5th dimension**.

**Options:**
1. `player_name` as 5th column → works for populated events (SUB, YELLOW, GOAL, RED) but NOT for VAR (all NULL)
2. `sequence_num` (auto-increment within group) → works universally but requires backfill
3. Composite: UNIQUE on `(match_id, minute_num, team_id, event_type, player_name)` with a DEFAULT for NULL player_name

**Recommended:** UNIQUE on `(match_id, minute_num, team_id, event_type, player_name)` — this naturally distinguishes legitimate multi-row (different players) while still catching genuine dupes (same player). For VAR events (player_name = NULL), the 200 ambiguous groups need separate handling.

## Verdict

**CONSTRAINT_UNSAFE on 4-column key. Decision deferred to owner.**

## Impact on Dedup

The 0 genuine dupes (same player) post-population means the v2 analysis (360 groups, 455 excess rows) was correct BEFORE population. After population, the dupes now have different player_names (because ESPN matched them to different events in the same minute). This means:

- The original 360 collision groups from the pre-population B3 analysis were genuine dupes
- Post-population, many of those groups now show different players (because the population script consumed ESPN events in order, assigning different players to what were actually duplicate rows)
- The correct dedup approach: use the ORIGINAL collision analysis (pre-population state) OR re-analyze with the understanding that population may have assigned different names to duplicate rows

**This is a critical sequencing insight.** The population-first strategy was correct for completeness, but it has a side effect: duplicate rows that were byte-identical pre-population now differ in player_name because the population script assigned different ESPN events to each copy.
