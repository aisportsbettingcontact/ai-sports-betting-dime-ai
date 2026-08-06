# Forensic row-level audit — binding contract

Every agent on this job follows this document exactly. It defines what gets audited, against which
authority, and how every single comparison is logged.

**Goal: every row of every table of every season is examined, and the ledger proves it.**
Not sampled. Not summarised. Every row ends in the ledger with a verdict and a piece of evidence.

Database: `/Users/danielwalker/src/ai-sports-betting-dime-ai/scripts/data/nfl-db/nfl.db`
**READ-ONLY.** Verify its md5 at start and end of your run and record both in your report. If it
changes, stop and report — someone else is writing.

## Table inventory and the authority that rules on each

| Table | Rows | Authority | What that authority can actually prove |
|---|---|---|---|
| `game` | 4,648 | **ESPN** scoreboard + summary | Full: teams, scores, date/time, venue, week, status |
| `team` | 32 | **ESPN** teams + **NFL.com** | Full: identity, conference, division |
| `team_alias` | 44 | **ESPN** + source feeds | Full |
| `player` | 26,517 | **ESPN** athletes | Identity: name, position, birthdate, college, draft |
| `player_game_stats` | 286,843 | **ESPN** box score (`summary?event=`) | Full: every passing/rushing/receiving stat |
| `roster_season` | 43,856 | **ESPN** team roster by season | Membership: was this player on this team that season |
| `game_line` | 4,363 | **covers.com / SportsOddsHistory** (ESPN odds are thin historically) | Closing spread, total, moneyline |
| `team_game` | 9,270 | **Derived** — recompute from `game` + `game_line` | Arithmetic correctness, 100% recomputable |
| `snap_count` | 324,611 | **Pro-Football-Reference** — ESPN does NOT publish snap counts | Offensive/defensive/ST snaps per player-game |
| `depth_chart` | 1,106,729 | **No historical public source exists.** ESPN publishes current only | Internal consistency + structural only — say so, never claim external validation |
| `data_correction` | 624 | **Re-verify each against its cited source** | That every correction we applied is itself correct |

**If an authority cannot rule on a row, the verdict is `NOT_COMPARABLE` with a reason — never
`MATCH`.** A row nobody could check is not a row that passed.

## The ledger — this is the deliverable

Append one JSON object per line to `docs/audits/2026-07-27-nfl-db-forensic/ledger/<AGENT>.jsonl`.
Schema, exact keys:

```json
{"ts":"2026-07-27T12:00:00Z","agent":"S03","table":"game","row_key":"2014_01_GB_SEA",
 "season":2014,"field":"home_score","db_value":36,"authority":"espn",
 "ref_id":"400554689","ref_value":36,"verdict":"MATCH","evidence":"cache/s03/sum_400554689.json"}
```

`verdict` is exactly one of:

- `MATCH` — db and authority agree
- `MISMATCH` — both have a value, they differ. **Always include both values.**
- `DB_ONLY` — row/field exists here, authority has no record (a possible fabrication — investigate)
- `REF_ONLY` — authority has it, we do not (a gap — investigate)
- `NOT_COMPARABLE` — authority structurally cannot rule (put the reason in `note`)
- `UNRESOLVED` — you tried and could not settle it. **Never downgrade this to MATCH.**

### Volume rule

Per-field records for **every** non-`MATCH` outcome, always. For `MATCH`, write one **row-level**
record per row with `field:"*"`, `fields_compared:<n>`, `fields_matched:<n>` — otherwise the ledger
reaches tens of millions of lines. Every row still appears; only clean fields are collapsed.

### Evidence rule — this is what makes it forensic

**Every ledger line must name a cached evidence file that actually exists on disk.** A verdict with
no evidence path, or a path that does not resolve, is treated as a fabricated result by the
supervisors. Cache every HTTP response under `scripts/data/nfl-db/cache/<agent>/` and keep it.
Your audit must be replayable offline from cache alone, with no network.

## Standing rules

1. **Never invent a value, a source, or a verdict.** If ESPN 404s, that is `UNRESOLVED` with the
   404 cached as evidence. Uncertainty logged is worth more than confidence invented.
2. **No sampling in the row-level pass.** Every row of your assigned partition.
3. **Report contradictions, do not resolve them silently.** Where the authority disagrees with the
   database, log the `MISMATCH` and, where a third source exists (nfl.com, Pro-Football-Reference,
   Wikipedia for game facts), record its value too. Do not pick a winner without evidence.
4. **Structural absence is not a gap.** Weather is NULL for dome games by construction; 2026 games
   have no scores because they are unplayed. Classify these `NOT_COMPARABLE`, never `MISMATCH`.
5. **Known-good differences must not be re-litigated.** These were established and third-sourced on
   2026-07-27; treat them as expected, and log them `NOT_COMPARABLE` with a note:
   - ESPN's `neutralSite` is unpopulated before 2014 and for relocated franchises.
   - nflverse stores the *scheduled* kickoff; ESPN stores the *observed* one (weather delays).
   - ESPN retro-renames venues.
   - ESPN omits zero-reception targets entirely, and sometimes charges an incompletion to a
     different receiver.
   - Full context: `docs/audits/2026-07-27-nfl-db-completion/reports/` and `INTEGRATION.md`.
6. **The database was corrected earlier today** — 20 defects, 624 corrections, audit trail in the
   `data_correction` table. Where you find a value differing from raw nflverse, check
   `data_correction` first: it may be a deliberate, evidenced correction. Verify the correction is
   right; do not report it as a new defect.

## Rate limiting

Ten-plus agents share this network. Sequential requests, ~2 in flight maximum, short sleep between.
**Cache first, always** — check your cache before every fetch. Prior agents already cached ~700 ESPN
responses under `scripts/data/nfl-db/cache/a1/`, `a3/`, `a5/`; reuse them rather than re-fetching.

ESPN endpoints:
- `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD`
- `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={id}` ← full box score
- `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{y}/teams?limit=40`
- `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/{id}`

## Deliverables

1. `docs/audits/2026-07-27-nfl-db-forensic/ledger/<AGENT>.jsonl` — the complete ledger.
2. `docs/audits/2026-07-27-nfl-db-forensic/reports/<AGENT>.md` — verdict, per-table row counts
   audited, verdict distribution, **every** `MISMATCH` / `DB_ONLY` / `REF_ONLY` / `UNRESOLVED`
   itemised with both values, and the exact commands to replay.
3. `scripts/data/nfl-db/audit/<agent>.py` — your re-runnable, cache-backed audit script.

**Coverage self-proof.** End your report with, per table: rows in your partition (a `SELECT COUNT(*)`
with your exact WHERE clause), rows in your ledger, and the difference. **The difference must be
zero.** If it is not, say so plainly — an honest gap is recoverable, a hidden one is not.
