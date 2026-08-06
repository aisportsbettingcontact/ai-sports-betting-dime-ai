# Shared context — NFL DB completion + ESPN/NFL cross-verification

Read this first. It is the same for every agent on this job.

## The artifact

A SQLite database of NFL games, betting lines, and player performance, 2010–2026, built for
sports-betting trend analysis and player-prop modelling.

| Path | What it is |
|---|---|
| `scripts/data/nfl-db/nfl.db` | The database (209 MB). A pre-job backup sits at `nfl.db.pre-completion-backup` — do not modify or delete it. |
| `scripts/data/nfl-db/schema.sql` | DDL: 12 tables, 51 indexes, 5 views |
| `scripts/data/nfl-db/build_db.py` | The loader that builds `nfl.db` from the sources below |
| `scripts/data/nfl-db/raw/*.csv` | 5 nflverse extracts, 316 MB (players, rosters, snap_counts, player_stats, depth_charts) |
| `scripts/data/nfl-unified-2010-2026/games.json` | 4,648 games, the union feeding the `game` table |
| `scripts/data/nfl-lines-2010-2025/` | 4,363 games with closing betting lines (nflverse) |
| `docs/audits/2026-07-26-nflverse-stack-forensic-audit.md` | Prior forensic audit of the nflverse source stack |

Current row counts: `game` 4,648 | `game_line` 4,363 | `team_game` 9,270 | `player` 25,035 |
`player_game_stats` 286,843 | `snap_count` 324,611 | `roster_season` 43,856 | `depth_chart` 552,514

## Known identity conventions (do not re-litigate these; build on them)

- **Franchises are keyed by ESPN franchise id**, not by abbreviation. Abbreviations are era-specific
  and disagree across feeds; ESPN ids are relocation-stable. `OAK`/`LV` → 13, `STL`/`LA`/`LAR` → 14,
  `SD`/`LAC` → 24, `WAS`/`WSH` → 28.
- **Players are keyed by `gsis_id`** (nflverse's universal player key, format `00-00XXXXX`).
  `pfr_player_id` and `espn_id` are crosswalk keys.
- **Kickoff times**: `kickoff_utc` is the canonical instant; `kickoff_date` is derived in Pacific
  time; nflverse publishes game times in Eastern. There is no `kickoff_time_et` column.
- Regular-season rows carry `week` with `playoff_round` NULL; postseason rows carry `playoff_round`
  (`WC`/`DIV`/`CON`/`SB`) with `week` NULL. A CHECK constraint enforces the exclusivity.

## Standing rules — these are absolute

1. **Never fabricate a value.** If something cannot be sourced, it is an itemized exception with
   evidence and a named cause. A plausible guess written into a data column is the worst possible
   outcome of this job — worse than an admitted gap. This applies with special force to betting
   lines and odds.
2. **No percentage gates.** The prior build passed a "≥95% resolution" gate and shipped 227 orphan
   rows. The target is 100%, or an exception list where every single row is individually explained.
   "99.93%" is a failing answer.
3. **Assert, don't assume.** Every claim you make in a report must be backed by a command someone
   else can re-run. Include the command and its output.
4. **Report contradictions rather than resolving them silently.** If ESPN and nflverse disagree,
   that is a finding — record both values and the evidence. Do not pick a winner on vibes.
5. **Distinguish "absent" from "structurally not applicable."** Weather is NULL for dome games by
   construction; that is not a gap. Say which kind you found.

## Network

ESPN is reachable and unauthenticated:
- `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/teams?limit=40`
- `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD`
- `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={espn_id}`

**Rate-limit yourself**: sequential requests with a short sleep, never more than ~2 in flight.
Ten agents are running at once. **Cache every response to disk** under your own cache directory
(named in your task) and read from the cache on retry — never re-fetch what you already have.
A cached response is also your evidence: keep it.

nfl.com is reachable but 308-redirects; follow redirects and expect HTML, not JSON.

## Output contract

Write your findings to the report path named in your task. Structure:

```markdown
# <Your task id and title>

## Verdict
PASS | FAIL | PASS WITH EXCEPTIONS — one sentence.

## What I checked
Scope, method, sample size or "full population".

## Results
Counts, tables, the actual numbers.

## Exceptions
One row per unresolved item, each with: identifier, what is wrong, why, evidence.
An empty section here means literally zero.

## Reproduce
The exact commands, in order, that regenerate these results.
```

Your final message back to the coordinator is **not** the report. Return: verdict, the headline
numbers, exception count, and anything the coordinator must decide. Keep it under 200 words —
the report file carries the detail.

## File ownership

Your task names the files you own. **Write only to those paths.** Nine other agents are working in
this repo simultaneously. In particular: **do not edit `build_db.py`, `schema.sql`, or `nfl.db`**
unless your task explicitly says you own them. Scope-B agents deliver importable modules; the
coordinator integrates them.
