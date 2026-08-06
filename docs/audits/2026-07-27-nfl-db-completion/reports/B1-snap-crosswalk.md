# B1 — Resolve 100% of snap counts to a player identity

## Verdict

**PASS.** All 227 orphaned `snap_count` rows (30 distinct players) resolve to a `gsis_id`.
`scripts/data/nfl-db/lib/snap_crosswalk.py` maps every one of the 7,095 distinct
`pfr_player_id` values in `raw/snap_counts.csv`, covering **324,611 / 324,611 rows (0
unresolved)**. `UNRESOLVABLE` is empty. Every resolution carries at least two independent
signals, and all 227 rows are corroborated per-row against nflverse `weekly_rosters` at the
exact season + week + team.

## What I checked

Full population, not a sample.

1. **Enumerated the orphans.** `SELECT ... FROM snap_count WHERE gsis_id IS NULL` → 227 rows,
   **30 distinct `pfr_player_id`** values, zero blank ids. Season distribution matches the
   brief exactly (2013:4, 2014:7, 2015:3, 2016:7, 2019:31, 2020:21, 2021:34, 2022:8, 2023:14,
   2024:42, 2025:56). Pulled every field for those rows from `raw/snap_counts.csv`.
2. **Diagnosed the cause** against `raw/players.csv`, `raw/rosters.csv`,
   `raw/player_stats.csv`, `raw/depth_charts.csv`.
3. **Resolved each player** through the source hierarchy in the brief, then **verified every
   individual snap row** against nflverse `weekly_rosters` (a release `build_db.py` does not
   currently consume), plus ESPN for the one identity that needed external confirmation.
4. **Back-tested the automated inference tiers** leave-one-out over the 7,065 snap-count pfr
   ids that already have a direct mapping, to put a measured number on them rather than a claim.

## Results

### Root cause — two distinct causes, with a third checked and ruled out

The brief warned not to assume a single cause. There are two, in very different proportions,
and the third candidate (players missing from the dimension entirely) does not occur.

| Cause | Distinct players | Snap rows | Detail |
| --- | --: | --: | --- |
| **A. Blank `pfr_id` in `players.csv`** | 28 | 225 | The value was never populated. 2,481 of `players.csv`'s 25,035 rows have an empty `pfr_id`. Not a mismatch, not a collision — an upstream omission. |
| **B. `players.csv` records a *different* pfr id than the snap feed uses** | 2 | 2 | `00-0039245` Ryan "Bump" Cooper Jr. (`CoopRy00` vs `CoopBu00`); `00-0040317` Jacoby Jones (`JoneJa15` vs `JoneJa16`). |
| **C. Player absent from `players.csv` entirely** | 0 | 0 | Checked and ruled out — all 30 resolved gsis ids exist in the `player` dimension, so the fix genuinely closes the join. |

Compounding factors, each of which defeats a naive name match:

- **Name disagreement between PFR and nflverse** — PFR builds its id from its own spelling.
  `Nathan Meadors` / PFR `Nate Meadors`; `Rod Williams` / PFR `Rodney Williams`; `Yannik` /
  PFR `Yannick Cudjoe-Virgil`; `John Shenker` / PFR `John Samuel Shenker`; `Jon Brown` / PFR
  `Jonathan Brown`; `Robert McCray` / PFR `Rob McCray`; `Nate Carter` / PFR `Nathan Carter`.
- **Legal name changes** — `Alex Taylor` → `Armani Taylor-Prioleau` (`TaylAl02` is built from
  the *old* name; nflverse's `players.csv` carries only the new one, `rosters.csv` has both).
- **Nicknames only ESPN/depth-charts know** — `Basil Okoye` is PFR's and ESPN's `CJ Okoye`;
  `Ryan Cooper Jr.` is PFR's and ESPN's `Bump Cooper`.
- **Same-name, same-team, same-season collisions** — two different `T.J. Carter`s on the 2022
  Rams (`CartTJ00` and `CartTJ01`), one a TCU DB, one a Kentucky DL.
- **Practice-squad elevations** — season-level `rosters.csv` hides them. `CoopBu00`'s single
  snap row is on BAL, but season rosters place him on SEA for 2024; only *weekly* rosters show
  the week-8 elevation.

### This is an upstream gap, not a stale local extract

I re-fetched the live `players` release from nflverse-data today and it has the **identical**
gap: 28 of the 30 still blank, and the other 2 still carry the contradicting ids. So the
crosswalk module is a standing requirement, not a one-off patch.

```
live players release rows: 25035
live release supplies any of the 30 target pfr ids: 0
  00-0039245 Ryan Cooper Jr.  pfr_id='CoopRy00'      (snap feed uses CoopBu00)
  00-0040317 Jacoby Jones     pfr_id='JoneJa15'      (snap feed uses JoneJa16)
  ...the other 28 all pfr_id=''
```

### Coverage after the fix

```
crosswalk entries        22585
  tier 0a players.csv    22554
  tier 0b rosters.csv    1
  tier 1  name-prefix    12
  tier 2  era-filtered   7
  tier 3  manual         11
snap rows                324611
snap rows resolved       324611
snap rows UNRESOLVED     0
distinct pfr ids         7095
distinct ids UNRESOLVED  0
UNRESOLVABLE constant    0

OK  every snap_counts row resolves to a gsis_id
```

### End-to-end: the fix actually closes the join

Filling `gsis_id` is only useful if the value hits a real row in the `player` dimension. All 30
do, so all 227 rows become joinable — this is the check that matters for the prop models, and
it is stronger than "the column is no longer NULL":

```
resolved gsis present in nfl.db player table: 30/30
missing (would still orphan the join): []
orphan snap rows that would now join to player: 227 of 227
```

### How the module resolves

| Tier | Rule | Distinct ids | Snap rows |
| --- | --- | --: | --: |
| 0a | Direct `pfr_id` → `gsis_id` from `players.csv` | 22,554 | 324,384 |
| 0b | Direct `pfr_id` → `gsis_id` from `rosters.csv` (a source `build_db.py` ignored) | 1 | 0 |
| 1 | Name-prefix inference: a PFR id is `<Last4><First2><NN>`; accept only when exactly one candidate gsis for that prefix is unclaimed by another pfr id | 12 | 115 |
| 2 | As tier 1, then keep only candidates with a documented season ≥ 2012 (snap_counts does not exist before then, so an older-only player cannot be the referent). Accept only if exactly one survives | 7 | 71 |
| 3 | `MANUAL_PFR_TO_GSIS` — hand-resolved with cited evidence | 11 | 41 |

**Tiers 1 and 2 are measured, not asserted.** Leave-one-out back-test over the 7,065
snap-count pfr ids that already have a direct mapping — hide the mapping, ask the tier to
reproduce it:

```
testable snap pfr ids with a direct mapping: 7065
  tier1: produced 5645  agree 5644  disagree 1  precision 99.982%
  tier2: produced 462   agree 462   disagree 0  precision 100.000%
  combined: produced 6107  agree 6106  disagree 1  precision 99.984%  abstain 958
  MISMATCH MichJo00 (tier1): direct=00-0039019 inferred=00-0040446
```

The single mismatch is a real name collision — PFR renders John Michael Schmitz as
`MichJo00` (treating "Michael" as the surname), which my rule cannot distinguish from Joe
Michalski. It is irrelevant in production: `MichJo00` has a direct tier-0a mapping, so the
inference tiers never fire for it. The tiers only ever run for ids with **no** direct mapping.

Independently of the back-test, all 19 tier-1/tier-2 results were verified by hand against
weekly rosters (below) and agree 30/30 with the module's output.

### Per-row corroboration — all 227 rows

Every one of the 227 rows was checked against the nflverse `weekly_rosters` release for its
season: is the resolved `gsis_id` on **that team** in **that week**?

```
rows: 227  {'ACT': 220, 'ROSTER': 7}
rows with NO weekly-roster confirmation: 0
```

The 7 non-`ACT` rows are all Chris Williams / CHI / 2014, whose `status` column reads `CUT`
(nflverse stores the player's *end-of-season* status there) while
`status_description_abbr` reads `A01` = active roster for those weeks. So all 227 rows are
confirmed on the active game-day roster. This is a labelling quirk in the source, not a gap.

### Contradictions found (recorded, not silently reconciled)

Per CONTEXT.md rule 4. Both are exported from the module as
`KNOWN_SOURCE_CONTRADICTIONS`.

| gsis_id | Player | `players.csv` `pfr_id` | pfr id used by `snap_counts` | Occurrences of each in `snap_counts.csv` | Assessment |
| --- | --- | --- | --- | --- | --- |
| `00-0039245` | Ryan "Bump" Cooper Jr. | `CoopRy00` | `CoopBu00` | `CoopRy00`: 0, `CoopBu00`: 1 | Identity not in doubt — both sources agree on ESPN id `5085881`, and ESPN's own athlete record renders him "Bump Cooper" (CB, Oregon State). PFR generated the id from the nickname; nflverse stored the given name. Only the id string differs. |
| `00-0040317` | Jacoby Jones | `JoneJa15` | `JoneJa16` | `JoneJa15`: 0, `JoneJa16`: 1 | Same player (WAS 2025, ESPN `5083297`), different PFR disambiguation suffix. nflverse's stored value does not match what PFR publishes in the snap feed. |

Neither is resolved "on vibes": in both cases the id nflverse records appears **zero** times in
the snap feed, so it cannot be the referent of any snap row.

### The hard cases, and how each was separated

The 11 manual entries. For each, the rejected same-name candidates were shown to be **absent
or inactive** on that team in that week — a negative control, not just a positive match.

| pfr_id | Player | Why the automated tiers could not reach it | Discriminating evidence |
| --- | --- | --- | --- |
| `CartTJ00` | T.J. Carter (DB) | Two T.J. Carters on the same 2022 team | weekly_rosters 2022: `00-0037052` (TCU, DB #20) is **ACT/A01** in wk16 and wk18, while `00-0035916` is DEV/P01 in both — exactly CartTJ00's two snap rows. Snap position `DB` matches. `player_stats.csv` has a `00-0037052` CB line in game `2022_16_DEN_LA`. |
| `CartTJ01` | T.J. Carter (DE) | Same | Mirror image: `00-0035916` (Kentucky, DL #98) is **ACT** in wk13 and wk15 while `00-0037052` is DEV/P01 in both — exactly CartTJ01's two snap rows. Snap position `DE` matches. `depth_charts.csv` lists `00-0035916` as the 2022 LA DE. |
| `CoopBu00` | Bump Cooper | PFR name (`Bump`) is a nickname nflverse's `players.csv` does not carry | ESPN athlete `5085881` displayName = "Bump Cooper", CB, Oregon State — the same ESPN id `players.csv` records for `00-0039245`. `depth_charts.csv` maps the string "Bump Cooper"/`5085881` to that gsis. weekly_rosters 2024 shows him **ACT/A01 on BAL in wk8 only** (DEV every other BAL week) — the single snap row is BAL wk8. |
| `OkoyCJ00` | CJ Okoye | PFR/ESPN nickname `CJ`; nflverse says `Basil Okoye` | `depth_charts.csv` carries the alias "CJ Okoye" on gsis `00-0039176` with espn_id `5144942`, the same espn_id `players.csv` records for that gsis. weekly_rosters 2025: ACT/A01 on BAL for all 12 snap weeks; `player_stats.csv` lists `00-0039176` as a 2025 BAL DT. The other Okoye lineman (`00-0034696`) is absent from BAL in all 12. |
| `JoneJa16` | Jacoby Jones | pfr id contradiction (above) | `player_stats.csv` has a `00-0040317` WR line in `2025_11_WAS_MIA` — the exact game of the single snap row; weekly_rosters 2025 wk11 WAS WR #84 ACT/A01. The other four Ja*-Jones candidates are absent from WAS that week. |
| `BrowJo03` | Jonathan Brown (K) | 3 unclaimed Jo* Browns | weekly_rosters 2020: `00-0032835` ACT/A01 on JAX in **wk6 only** — the single snap row (JAX wk6 vs DET, 4 ST snaps); `player_stats.csv` has `00-0032835` for game `2020_06_DET_JAX`. `players.csv` gives his `first_name` as "Jonathan" (display_name "Jon Brown"). Other two candidates absent from JAX. |
| `LoveJo02` | John Lovett | 4 unclaimed John Lovetts | Only `00-0035161` (Princeton, #45) is ever on GB. weekly_rosters 2020: ACT/A01 in all 8 snap weeks (1–4, 6–9), listed at **TE** in wks 2–7 matching the snap position. Other three absent from GB in every one. |
| `MillJo01` | Jordan Miller | 2 unclaimed Jordan Millers | weekly_rosters 2013: `00-0028349` (DT #96) ACT/A01 on JAX in wk16 and wk17 — exactly the two snap rows. `00-0039570` is a 2024 Denver rookie with no 2013 existence. |
| `WillCh06` | Chris Williams | 3 unclaimed Chris Williamses | Only `00-0026691` (WR #82) is on CHI in 2014; weekly_rosters has him on the active roster (`A01`) in all seven snap weeks. Other two absent from CHI in every one. |
| `WillDa14` | Darryl Williams | 6 unclaimed Da* Williamses | weekly_rosters 2022 wk4: only `00-0035892` (Mississippi State, OL #60) is on JAX, **ACT/A01** — his single active week and the single snap row. Other five absent. |
| `WillIs02` | Isaiah Williams | 2 unclaimed Isaiah Williamses | weekly_rosters 2021: `00-0033161` (Akron, OL, depth-chart position **G**, #71) ACT/A01 on NYJ in all four snap weeks (4, 5, 7, 16); snap position `G` matches. `00-0026864` is a WR whose last documented season is 2012 and who never appears on NYJ. |

### Deliverable

`scripts/data/nfl-db/lib/snap_crosswalk.py` — importable, **no side effects at import**
(verified: import takes 0.011 s and `LAST_BUILD_STATS` is empty until a build is requested).

```python
build_pfr_to_gsis(players_csv, rosters_csv, player_stats_csv,
                  targets=None, snap_counts_csv=...) -> dict[str, str]
MANUAL_PFR_TO_GSIS: dict[str, tuple[str, str]]      # pfr_id -> (gsis_id, justification)
UNRESOLVABLE: dict[str, str]                        # empty
KNOWN_SOURCE_CONTRADICTIONS: dict[str, tuple[str, str, str]]
resolve(pfr_id) -> str | None
pfr_prefix(first, last) -> str | None
```

The two extra parameters are optional and keyword-defaulted, so the required
`build_pfr_to_gsis(players_csv, rosters_csv, player_stats_csv)` call works unchanged.
`targets` is the set of pfr ids the inference tiers are asked to cover — tiers 1–3 only fire
for ids with no direct mapping, so the domain has to come from outside; it defaults to every
`pfr_player_id` in `raw/snap_counts.csv`, which is this crosswalk's reason for existing.

**Integration note for the coordinator.** In `build_db.py` the snap loader currently builds
`pfr2gsis` inline from `players.csv` (lines ~238–242) and counts `sc_unresolved`. Replace that
block with `from lib.snap_crosswalk import build_pfr_to_gsis` /
`pfr2gsis = build_pfr_to_gsis(players_csv, rosters_csv, player_stats_csv)`. Runtime cost of the
build is ~3.6 s (it re-reads `player_stats.csv` for name variants). I did **not** edit
`build_db.py`, `schema.sql`, or `nfl.db`.

## Exceptions

**None.** Zero unresolved snap rows, zero unresolved `pfr_player_id` values, `UNRESOLVABLE` is
empty. Nothing on this task required a fabricated or guessed value.

Two items are *findings* rather than exceptions, and are recorded above and exported as
`KNOWN_SOURCE_CONTRADICTIONS`: nflverse's `pfr_id` for `00-0039245` and `00-0040317`
disagrees with the id PFR publishes in the snap feed. Both players are correctly resolved;
the disagreement is in the id string, not the identity.

One structural note, per CONTEXT.md rule 5: the 30 blank `pfr_id` values are **absent**, not
structurally-not-applicable. Every one of these players has a real PFR page (PFR publishes
their snap counts); nflverse simply never filled the column. The live nflverse release
confirms the gap is upstream and current.

## Reproduce

All commands from the repo root.

```bash
# 1. The gap, before the fix
sqlite3 scripts/data/nfl-db/nfl.db \
  "SELECT COUNT(*), SUM(gsis_id IS NULL) FROM snap_count;"
# -> 324611|227
sqlite3 scripts/data/nfl-db/nfl.db \
  "SELECT season, COUNT(*) FROM snap_count WHERE gsis_id IS NULL GROUP BY season ORDER BY season;"
sqlite3 scripts/data/nfl-db/nfl.db \
  "SELECT pfr_player_id, COUNT(*) n FROM snap_count WHERE gsis_id IS NULL
   GROUP BY pfr_player_id ORDER BY n DESC;"      # -> 30 rows, none blank

# 2. The fix: zero unresolved (exits 0; exits 1 if any snap row is unresolved)
python3 scripts/data/nfl-db/lib/snap_crosswalk.py ; echo "EXIT=$?"

# 3. Measured precision of the inference tiers (leave-one-out, ~60 s)
python3 scripts/data/nfl-db/lib/snap_crosswalk.py --backtest

# 3b. End-to-end: every resolved id hits a real player row, so all 227 rows join
python3 - <<'PY'
import sys, sqlite3
sys.path.insert(0, 'scripts/data/nfl-db/lib'); import snap_crosswalk as sc
con = sqlite3.connect('scripts/data/nfl-db/nfl.db')
known = {r[0] for r in con.execute('SELECT gsis_id FROM player')}
orphans = list(con.execute(
    'SELECT pfr_player_id, COUNT(*) FROM snap_count WHERE gsis_id IS NULL GROUP BY pfr_player_id'))
joinable = sum(n for p, n in orphans if sc.resolve(p) in known)
print(f'orphan pfr ids: {len(orphans)}; rows that would now join to player: '
      f'{joinable} of {sum(n for _, n in orphans)}')
PY
# -> orphan pfr ids: 30; rows that would now join to player: 227 of 227

# 4. Confirm no import-time side effects and spot-check resolve()
python3 -c "
import sys,time; sys.path.insert(0,'scripts/data/nfl-db/lib')
t=time.time(); import snap_crosswalk as sc
print('import %.3fs, LAST_BUILD_STATS=%s' % (time.time()-t, sc.LAST_BUILD_STATS))
print(sc.resolve('CartTJ00'), sc.resolve('CartTJ01'), sc.resolve('OkoyCJ00'), sc.resolve('NOPE99'))"
# -> import 0.011s, LAST_BUILD_STATS={}
# -> 00-0037052 00-0035916 00-0039176 None

# 5. Re-fetch the corroborating nflverse weekly rosters (cached; ~145 MB, gitignored)
cd scripts/data/nfl-db/cache/b1
for y in 2013 2014 2015 2016 2019 2020 2021 2022 2023 2024 2025; do
  [ -f "nflverse_roster_weekly_$y.csv" ] && continue
  curl -sL -o "nflverse_roster_weekly_$y.csv" \
    "https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_$y.csv"
  sleep 2
done
curl -sL -o nflverse_players.csv \
  "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"

# 6. ESPN identity confirmation for Bump Cooper (cached response in the same directory)
curl -s "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/5085881" \
  | python3 -c "import json,sys; a=json.load(sys.stdin)['athlete']; \
    print(a['displayName'], a['position']['abbreviation'], a['college']['name'])"
# -> Bump Cooper CB Oregon State
```

Cached evidence, all under `scripts/data/nfl-db/cache/b1/`:

| File | What it is | In git |
| --- | --- | --- |
| `resolution_table.csv` / `.json` | the 227-row table below, machine-readable | yes |
| `weekly_roster_evidence.csv` | 1,292 nflverse weekly-roster rows — every week for all 30 resolved players **and** for every rejected same-name candidate (the negative control) | yes |
| `orphan_snap_rows.json` | the 227 raw `snap_counts.csv` rows | yes |
| `row_verification.json` | per-row weekly-roster match result | yes |
| `espn_athlete_5085881.json` (+`.meta`) | ESPN athlete record for Bump Cooper — the identity evidence | yes |
| `sb_20241027.json`, `summary_401671852.json` (+`.meta`) | ESPN scoreboard for 2024-10-27 (used to find event `401671852`, BAL@CLE) and that game's summary | yes |
| `nflverse_roster_weekly_*.csv`, `nflverse_players.csv` | bulk source downloads, ~145 MB | no — `.gitignore`d, re-fetch with step 5 |

ESPN was queried 4 times total, sequentially, with a 1.5 s sleep between calls; every response
was cached to disk and read from cache on repeat. Two of the four were dead ends and proved
nothing, recorded here so the trail is complete: `summary?event=401671852` has no `rosters`
key for this game (only `boxscore`, which lists just players with recorded stats — a
special-teamer with 6 snaps and no stat line does not appear), and
`.../competitions/401671852/competitors/33/roster` returned an empty `items` array. That is
why the game-day roster question was settled with nflverse `weekly_rosters` instead, which
carries the practice-squad/elevation status ESPN would not give up.

## Appendix — all 227 rows

`tier` is how the module resolved that player: **T1** name-prefix inference, **T2** as T1 plus
the ≥2012 snap-era filter, **T3** `MANUAL_PFR_TO_GSIS`. `off/def/st` are the offensive,
defensive and special-teams snap counts on that row. The evidence column is the nflverse
`weekly_rosters` row matched on the *exact* season + week + team of the snap row, showing
position, depth-chart position, jersey, roster status and the name as nflverse spells it.

| # | pfr_id | player | team | season | wk | type | pos | off/def/st | resolved gsis_id | tier | evidence (nflverse weekly_rosters row for that exact season+week+team) |
| --: | --- | --- | --- | --: | --: | --- | --- | --- | --- | --- | --- |
| 1 | `AndeAl01` | Alec Anderson | BUF | 2024 | 1 | REG | G | 10/0/12 | `00-0037428` | T1 | 2024 wk1 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 2 | `AndeAl01` | Alec Anderson | BUF | 2024 | 2 | REG | G | 13/0/9 | `00-0037428` | T1 | 2024 wk2 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 3 | `AndeAl01` | Alec Anderson | BUF | 2024 | 3 | REG | G | 16/0/11 | `00-0037428` | T1 | 2024 wk3 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 4 | `AndeAl01` | Alec Anderson | BUF | 2024 | 4 | REG | G | 19/0/9 | `00-0037428` | T1 | 2024 wk4 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 5 | `AndeAl01` | Alec Anderson | BUF | 2024 | 5 | REG | G | 17/0/4 | `00-0037428` | T1 | 2024 wk5 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 6 | `AndeAl01` | Alec Anderson | BUF | 2024 | 6 | REG | G | 15/0/9 | `00-0037428` | T1 | 2024 wk6 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 7 | `AndeAl01` | Alec Anderson | BUF | 2024 | 7 | REG | G | 6/0/9 | `00-0037428` | T1 | 2024 wk7 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 8 | `AndeAl01` | Alec Anderson | BUF | 2024 | 8 | REG | G | 21/0/5 | `00-0037428` | T1 | 2024 wk8 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 9 | `AndeAl01` | Alec Anderson | BUF | 2024 | 9 | REG | G | 11/0/11 | `00-0037428` | T1 | 2024 wk9 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 10 | `AndeAl01` | Alec Anderson | BUF | 2024 | 10 | REG | G | 6/0/11 | `00-0037428` | T1 | 2024 wk10 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 11 | `AndeAl01` | Alec Anderson | BUF | 2024 | 11 | REG | G | 6/0/5 | `00-0037428` | T1 | 2024 wk11 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 12 | `AndeAl01` | Alec Anderson | BUF | 2024 | 13 | REG | G | 32/0/6 | `00-0037428` | T1 | 2024 wk13 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 13 | `AndeAl01` | Alec Anderson | BUF | 2024 | 14 | REG | G | 9/0/10 | `00-0037428` | T1 | 2024 wk14 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 14 | `AndeAl01` | Alec Anderson | BUF | 2024 | 15 | REG | G | 13/0/14 | `00-0037428` | T1 | 2024 wk15 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 15 | `AndeAl01` | Alec Anderson | BUF | 2024 | 16 | REG | G | 11/0/5 | `00-0037428` | T1 | 2024 wk16 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 16 | `AndeAl01` | Alec Anderson | BUF | 2024 | 17 | REG | G | 19/0/10 | `00-0037428` | T1 | 2024 wk17 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 17 | `AndeAl01` | Alec Anderson | BUF | 2024 | 18 | REG | G | 67/0/3 | `00-0037428` | T1 | 2024 wk18 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 18 | `AndeAl01` | Alec Anderson | BUF | 2024 | 19 | WC | G | 22/0/5 | `00-0037428` | T1 | 2024 wk19 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 19 | `AndeAl01` | Alec Anderson | BUF | 2024 | 20 | DIV | G | 13/0/5 | `00-0037428` | T1 | 2024 wk20 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 20 | `AndeAl01` | Alec Anderson | BUF | 2024 | 21 | CON | G | 10/0/4 | `00-0037428` | T1 | 2024 wk21 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 21 | `AndeAl01` | Alec Anderson | BUF | 2025 | 1 | REG | T | 3/0/6 | `00-0037428` | T1 | 2025 wk1 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 22 | `AndeAl01` | Alec Anderson | BUF | 2025 | 2 | REG | T | 10/0/6 | `00-0037428` | T1 | 2025 wk2 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 23 | `AndeAl01` | Alec Anderson | BUF | 2025 | 3 | REG | T | 2/0/6 | `00-0037428` | T1 | 2025 wk3 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 24 | `AndeAl01` | Alec Anderson | BUF | 2025 | 4 | REG | T | 3/0/6 | `00-0037428` | T1 | 2025 wk4 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 25 | `AndeAl01` | Alec Anderson | BUF | 2025 | 5 | REG | T | 0/0/4 | `00-0037428` | T1 | 2025 wk5 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 26 | `AndeAl01` | Alec Anderson | BUF | 2025 | 6 | REG | T | 1/0/2 | `00-0037428` | T1 | 2025 wk6 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 27 | `AndeAl01` | Alec Anderson | BUF | 2025 | 8 | REG | T | 12/0/9 | `00-0037428` | T1 | 2025 wk8 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 28 | `AndeAl01` | Alec Anderson | BUF | 2025 | 9 | REG | T | 1/0/8 | `00-0037428` | T1 | 2025 wk9 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 29 | `AndeAl01` | Alec Anderson | BUF | 2025 | 10 | REG | T | 1/0/6 | `00-0037428` | T1 | 2025 wk10 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 30 | `AndeAl01` | Alec Anderson | BUF | 2025 | 11 | REG | T | 1/0/11 | `00-0037428` | T1 | 2025 wk11 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 31 | `AndeAl01` | Alec Anderson | BUF | 2025 | 12 | REG | T | 1/0/9 | `00-0037428` | T1 | 2025 wk12 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 32 | `AndeAl01` | Alec Anderson | BUF | 2025 | 13 | REG | T | 74/0/5 | `00-0037428` | T1 | 2025 wk13 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 33 | `AndeAl01` | Alec Anderson | BUF | 2025 | 14 | REG | T | 0/0/9 | `00-0037428` | T1 | 2025 wk14 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 34 | `AndeAl01` | Alec Anderson | BUF | 2025 | 15 | REG | T | 1/0/15 | `00-0037428` | T1 | 2025 wk15 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 35 | `AndeAl01` | Alec Anderson | BUF | 2025 | 16 | REG | T | 2/0/14 | `00-0037428` | T1 | 2025 wk16 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 36 | `AndeAl01` | Alec Anderson | BUF | 2025 | 17 | REG | T | 2/0/8 | `00-0037428` | T1 | 2025 wk17 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 37 | `AndeAl01` | Alec Anderson | BUF | 2025 | 18 | REG | T | 75/0/3 | `00-0037428` | T1 | 2025 wk18 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 38 | `AndeAl01` | Alec Anderson | BUF | 2025 | 19 | WC | T | 3/0/10 | `00-0037428` | T1 | 2025 wk19 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 39 | `AndeAl01` | Alec Anderson | BUF | 2025 | 20 | DIV | T | 15/0/17 | `00-0037428` | T1 | 2025 wk20 BUF OL/G #70 ACT/A01 "Alec Anderson" |
| 40 | `BrowFr01` | Fred Brown | DEN | 2019 | 4 | REG | WR | 3/0/23 | `00-0033994` | T2 | 2019 wk4 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 41 | `BrowFr01` | Fred Brown | DEN | 2019 | 5 | REG | WR | 9/0/14 | `00-0033994` | T2 | 2019 wk5 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 42 | `BrowFr01` | Fred Brown | DEN | 2019 | 6 | REG | WR | 8/0/16 | `00-0033994` | T2 | 2019 wk6 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 43 | `BrowFr01` | Fred Brown | DEN | 2019 | 7 | REG | WR | 6/0/22 | `00-0033994` | T2 | 2019 wk7 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 44 | `BrowFr01` | Fred Brown | DEN | 2019 | 8 | REG | WR | 46/0/0 | `00-0033994` | T2 | 2019 wk8 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 45 | `BrowFr01` | Fred Brown | DEN | 2019 | 9 | REG | WR | 7/0/15 | `00-0033994` | T2 | 2019 wk9 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 46 | `BrowFr01` | Fred Brown | DEN | 2019 | 11 | REG | WR | 8/0/17 | `00-0033994` | T2 | 2019 wk11 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 47 | `BrowFr01` | Fred Brown | DEN | 2019 | 12 | REG | WR | 0/0/16 | `00-0033994` | T2 | 2019 wk12 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 48 | `BrowFr01` | Fred Brown | DEN | 2019 | 13 | REG | WR | 1/0/19 | `00-0033994` | T2 | 2019 wk13 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 49 | `BrowFr01` | Fred Brown | DEN | 2019 | 14 | REG | WR | 0/0/15 | `00-0033994` | T2 | 2019 wk14 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 50 | `BrowFr01` | Fred Brown | DEN | 2019 | 15 | REG | WR | 7/0/13 | `00-0033994` | T2 | 2019 wk15 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 51 | `BrowFr01` | Fred Brown | DEN | 2019 | 16 | REG | WR | 1/0/18 | `00-0033994` | T2 | 2019 wk16 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 52 | `BrowFr01` | Fred Brown | DEN | 2019 | 17 | REG | WR | 4/0/14 | `00-0033994` | T2 | 2019 wk17 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 53 | `BrowFr01` | Fred Brown | DEN | 2020 | 8 | REG | WR | 5/0/16 | `00-0033994` | T2 | 2020 wk8 DEN WR/WR #19 ACT/A01 "Fred Brown" |
| 54 | `BrowJo03` | Jonathan Brown | JAX | 2020 | 6 | REG | K | 0/0/4 | `00-0032835` | T3 | 2020 wk6 JAX K/K #1 ACT/A01 "Jon Brown" |
| 55 | `CartNa00` | Nathan Carter | ATL | 2025 | 2 | REG | RB | 1/0/2 | `00-0040547` | T1 | 2025 wk2 ATL RB/RB #38 ACT/A01 "Nate Carter" |
| 56 | `CartNa00` | Nathan Carter | ATL | 2025 | 3 | REG | RB | 7/0/4 | `00-0040547` | T1 | 2025 wk3 ATL RB/RB #38 ACT/A01 "Nate Carter" |
| 57 | `CartNa00` | Nathan Carter | ATL | 2025 | 8 | REG | RB | 2/0/0 | `00-0040547` | T1 | 2025 wk8 ATL RB/RB #38 ACT/A01 "Nate Carter" |
| 58 | `CartNa00` | Nathan Carter | ATL | 2025 | 11 | REG | RB | 0/0/10 | `00-0040547` | T1 | 2025 wk11 ATL RB/RB #38 ACT/A01 "Nate Carter" |
| 59 | `CartNa00` | Nathan Carter | ATL | 2025 | 13 | REG | RB | 0/0/16 | `00-0040547` | T1 | 2025 wk13 ATL RB/RB #38 ACT/A01 "Nate Carter" |
| 60 | `CartNa00` | Nathan Carter | ATL | 2025 | 15 | REG | RB | 0/0/9 | `00-0040547` | T1 | 2025 wk15 ATL RB/RB #38 ACT/A01 "Nate Carter" |
| 61 | `CartNa00` | Nathan Carter | ATL | 2025 | 18 | REG | RB | 2/0/8 | `00-0040547` | T1 | 2025 wk18 ATL RB/RB #38 ACT/A01 "Nate Carter" |
| 62 | `CartTJ00` | T.J. Carter | LA | 2022 | 16 | REG | DB | 0/4/14 | `00-0037052` | T3 | 2022 wk16 LA DB/DB #20 ACT/A01 "T.J. Carter" |
| 63 | `CartTJ00` | T.J. Carter | LA | 2022 | 18 | REG | DB | 0/2/16 | `00-0037052` | T3 | 2022 wk18 LA DB/DB #20 ACT/A01 "T.J. Carter" |
| 64 | `CartTJ01` | T.J. Carter | LA | 2022 | 13 | REG | DE | 0/1/5 | `00-0035916` | T3 | 2022 wk13 LA DL/DE #98 ACT/A01 "T.J. Carter" |
| 65 | `CartTJ01` | T.J. Carter | LA | 2022 | 15 | REG | DE | 0/4/0 | `00-0035916` | T3 | 2022 wk15 LA DL/DE #98 ACT/P01 "T.J. Carter" |
| 66 | `CoopBu00` | Bump Cooper | BAL | 2024 | 8 | REG | CB | 0/0/6 | `00-0039245` | T3 | 2024 wk8 BAL DB/CB #31 ACT/A01 "Ryan Cooper Jr." |
| 67 | `CudjYa00` | Yannick Cudjoe-Virgil | TEN | 2015 | 12 | REG | LB | 0/5/2 | `00-0032033` | T1 | 2015 wk12 TEN LB #40 RES/A01 "Yannik Cudjoe-Virgil" |
| 68 | `CudjYa00` | Yannick Cudjoe-Virgil | TEN | 2015 | 13 | REG | LB | 0/7/10 | `00-0032033` | T1 | 2015 wk13 TEN LB #40 RES/A01 "Yannik Cudjoe-Virgil" |
| 69 | `FarmGe02` | George Farmer | SEA | 2016 | 12 | REG | WR | 17/0/0 | `00-0031746` | T2 | 2016 wk12 SEA RB/RB #41 ACT/ "George Farmer" |
| 70 | `FarmGe02` | George Farmer | SEA | 2016 | 13 | REG | RB | 9/0/0 | `00-0031746` | T2 | 2016 wk13 SEA RB/RB #39 ACT/A01 "George Farmer" |
| 71 | `HallGa01` | Gabe Hall | PHI | 2025 | 1 | REG | DT | 0/5/4 | `00-0039265` | T2 | 2025 wk1 PHI DL/DT #96 ACT/A01 "Gabe Hall" |
| 72 | `HallGa01` | Gabe Hall | PHI | 2025 | 6 | REG | DT | 0/8/0 | `00-0039265` | T2 | 2025 wk6 PHI DL/DT #96 ACT/P01 "Gabe Hall" |
| 73 | `HammJe01` | Je'Ron Hamm | WAS | 2015 | 13 | REG | TE | 3/0/20 | `00-0030805` | T1 | 2015 wk13 WAS TE #87 TRD/A01 "Je'Ron Hamm" |
| 74 | `HammJe01` | Je'Ron Hamm | SF | 2016 | 5 | REG | TE | 0/0/6 | `00-0030805` | T1 | 2016 wk5 SF TE/TE #85 ACT/A01 "Je'Ron Hamm" |
| 75 | `HammJe01` | Je'Ron Hamm | SF | 2016 | 6 | REG | TE | 2/0/17 | `00-0030805` | T1 | 2016 wk6 SF TE/TE #85 ACT/ "Je'Ron Hamm" |
| 76 | `HammJe01` | Je'Ron Hamm | SF | 2016 | 9 | REG | TE | 0/0/5 | `00-0030805` | T1 | 2016 wk9 SF TE/TE #85 ACT/A01 "Je'Ron Hamm" |
| 77 | `HammJe01` | Je'Ron Hamm | SF | 2016 | 15 | REG | TE | 27/0/17 | `00-0030805` | T1 | 2016 wk15 SF TE/TE #85 ACT/ "Je'Ron Hamm" |
| 78 | `HammJe01` | Je'Ron Hamm | SF | 2016 | 16 | REG | TE | 21/0/22 | `00-0030805` | T1 | 2016 wk16 SF TE/TE #85 ACT/ "Je'Ron Hamm" |
| 79 | `HenrMa02` | Marcus Henry | DAL | 2020 | 6 | REG | C | 0/0/3 | `00-0032877` | T1 | 2020 wk6 DAL OL/C #62 ACT/ "Marcus Henry" |
| 80 | `HenrMa02` | Marcus Henry | ARI | 2021 | 10 | REG | C | 4/0/0 | `00-0032877` | T1 | 2021 wk10 ARI OL/C #53 ACT/A01 "Marcus Henry" |
| 81 | `HenrMa02` | Marcus Henry | ARI | 2021 | 11 | REG | C | 0/0/2 | `00-0032877` | T1 | 2021 wk11 ARI OL/C #53 ACT/A01 "Marcus Henry" |
| 82 | `HenrMa02` | Marcus Henry | ARI | 2021 | 15 | REG | C | 0/0/2 | `00-0032877` | T1 | 2021 wk15 ARI OL/C #53 ACT/A01 "Marcus Henry" |
| 83 | `HenrMa02` | Marcus Henry | ARI | 2021 | 18 | REG | C | 0/0/3 | `00-0032877` | T1 | 2021 wk18 ARI OL/C #53 ACT/A01 "Marcus Henry" |
| 84 | `JameRo99` | Robert James | BAL | 2013 | 1 | REG | LB | 0/0/14 | `00-0026278` | T2 | 2013 wk1 BLT ILB #54 TRD/A01 "Robert James" |
| 85 | `JameRo99` | Robert James | KC | 2013 | 18 | WC | LB | 0/0/19 | `00-0026278` | T2 | 2013 wk18 KC ILB #59 TRD/A01 "Robert James" |
| 86 | `JohnIs03` | Isaiah Johnson | MIA | 2025 | 6 | REG | CB | 0/0/11 | `00-0039483` | T1 | 2025 wk6 MIA DB/CB #46 ACT/A01 "Isaiah Johnson" |
| 87 | `JohnIs03` | Isaiah Johnson | MIA | 2025 | 9 | REG | CB | 0/3/13 | `00-0039483` | T1 | 2025 wk9 MIA DB/CB #46 ACT/P01 "Isaiah Johnson" |
| 88 | `JohnIs03` | Isaiah Johnson | MIA | 2025 | 10 | REG | CB | 0/0/14 | `00-0039483` | T1 | 2025 wk10 MIA DB/CB #46 ACT/A01 "Isaiah Johnson" |
| 89 | `JohnIs03` | Isaiah Johnson | MIA | 2025 | 15 | REG | CB | 0/0/15 | `00-0039483` | T1 | 2025 wk15 MIA DB/CB #46 ACT/A01 "Isaiah Johnson" |
| 90 | `JoneJa16` | Jacoby Jones | WAS | 2025 | 11 | REG | WR | 11/0/7 | `00-0040317` | T3 | 2025 wk11 WAS WR/WR #84 ACT/A01 "Jacoby Jones" |
| 91 | `LoveJo02` | John Lovett | GB | 2020 | 1 | REG | TE | 1/0/14 | `00-0035161` | T3 | 2020 wk1 GB QB/QB #45 ACT/A01 "John Lovett" |
| 92 | `LoveJo02` | John Lovett | GB | 2020 | 2 | REG | TE | 11/0/7 | `00-0035161` | T3 | 2020 wk2 GB TE/TE #45 ACT/A01 "John Lovett" |
| 93 | `LoveJo02` | John Lovett | GB | 2020 | 3 | REG | TE | 2/0/15 | `00-0035161` | T3 | 2020 wk3 GB TE/TE #45 ACT/A01 "John Lovett" |
| 94 | `LoveJo02` | John Lovett | GB | 2020 | 4 | REG | TE | 6/0/15 | `00-0035161` | T3 | 2020 wk4 GB TE/TE #45 ACT/A01 "John Lovett" |
| 95 | `LoveJo02` | John Lovett | GB | 2020 | 6 | REG | TE | 5/0/20 | `00-0035161` | T3 | 2020 wk6 GB TE/TE #45 ACT/A01 "John Lovett" |
| 96 | `LoveJo02` | John Lovett | GB | 2020 | 7 | REG | TE | 9/0/16 | `00-0035161` | T3 | 2020 wk7 GB TE/TE #45 ACT/A01 "John Lovett" |
| 97 | `LoveJo02` | John Lovett | GB | 2020 | 8 | REG | TE | 0/0/11 | `00-0035161` | T3 | 2020 wk8 GB QB/QB #45 ACT/A01 "John Lovett" |
| 98 | `LoveJo02` | John Lovett | GB | 2020 | 9 | REG | TE | 11/0/14 | `00-0035161` | T3 | 2020 wk9 GB QB/QB #45 ACT/A01 "John Lovett" |
| 99 | `MartAd00` | Adrian Martinez | SF | 2025 | 9 | REG | QB | 1/0/0 | `00-0038658` | T2 | 2025 wk9 SF QB/QB #4 ACT/A01 "Adrian Martinez" |
| 100 | `McCrRo00` | Rob McCray | CLE | 2019 | 16 | REG | DE | 0/25/2 | `00-0034326` | T1 | 2019 wk16 CLE LB/OLB #52 ACT/A01 "Robert McCray" |
| 101 | `MeadNa00` | Nate Meadors | MIN | 2019 | 2 | REG | CB | 0/3/9 | `00-0035108` | T1 | 2019 wk2 MIN DB/DB #44 ACT/A01 "Nathan Meadors" |
| 102 | `MeadNa00` | Nate Meadors | MIN | 2019 | 3 | REG | CB | 0/8/14 | `00-0035108` | T1 | 2019 wk3 MIN DB/DB #44 ACT/A01 "Nathan Meadors" |
| 103 | `MeadNa00` | Nate Meadors | MIN | 2019 | 19 | DIV | CB | 0/0/13 | `00-0035108` | T1 | 2019 wk19 MIN DB/DB #44 ACT/A01 "Nathan Meadors" |
| 104 | `MeadNa00` | Nate Meadors | MIN | 2020 | 1 | REG | DB | 0/0/14 | `00-0035108` | T1 | 2020 wk1 MIN DB/DB #26 ACT/A01 "Nathan Meadors" |
| 105 | `MillJo01` | Jordan Miller | JAX | 2013 | 16 | REG | DT | 0/35/0 | `00-0028349` | T3 | 2013 wk16 JAX DT #96 ACT/A01 "Jordan Miller" |
| 106 | `MillJo01` | Jordan Miller | JAX | 2013 | 17 | REG | DT | 0/19/0 | `00-0028349` | T3 | 2013 wk17 JAX DT #96 ACT/A01 "Jordan Miller" |
| 107 | `MurrBi00` | Bill Murray | NE | 2022 | 13 | REG | G | 0/0/3 | `00-0036093` | T1 | 2022 wk13 NE OL/G #62 ACT/A01 "Bill Murray" |
| 108 | `MurrBi00` | Bill Murray | CHI | 2024 | 5 | REG | G | 37/0/0 | `00-0036093` | T1 | 2024 wk5 CHI OL/G #60 ACT/A01 "Bill Murray" |
| 109 | `MurrBi00` | Bill Murray | CHI | 2024 | 6 | REG | G | 3/0/0 | `00-0036093` | T1 | 2024 wk6 CHI OL/G #60 ACT/A01 "Bill Murray" |
| 110 | `MurrBi00` | Bill Murray | CHI | 2024 | 8 | REG | G | 2/0/1 | `00-0036093` | T1 | 2024 wk8 CHI OL/G #60 ACT/A01 "Bill Murray" |
| 111 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 5 | REG | DL | 0/38/0 | `00-0039176` | T3 | 2025 wk5 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 112 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 6 | REG | DL | 0/18/3 | `00-0039176` | T3 | 2025 wk6 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 113 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 8 | REG | DL | 0/16/2 | `00-0039176` | T3 | 2025 wk8 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 114 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 9 | REG | DL | 0/13/3 | `00-0039176` | T3 | 2025 wk9 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 115 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 10 | REG | DL | 0/17/3 | `00-0039176` | T3 | 2025 wk10 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 116 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 11 | REG | DL | 0/14/4 | `00-0039176` | T3 | 2025 wk11 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 117 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 12 | REG | DL | 0/14/3 | `00-0039176` | T3 | 2025 wk12 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 118 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 13 | REG | DL | 0/16/8 | `00-0039176` | T3 | 2025 wk13 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 119 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 14 | REG | DL | 0/14/6 | `00-0039176` | T3 | 2025 wk14 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 120 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 15 | REG | DL | 0/16/0 | `00-0039176` | T3 | 2025 wk15 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 121 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 17 | REG | DL | 0/3/4 | `00-0039176` | T3 | 2025 wk17 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 122 | `OkoyCJ00` | CJ Okoye | BAL | 2025 | 18 | REG | DL | 0/11/5 | `00-0039176` | T3 | 2025 wk18 BAL DL/DT #91 ACT/A01 "Basil Okoye" |
| 123 | `ParkSt00` | Steven Parker | MIA | 2019 | 1 | REG | FS | 0/16/15 | `00-0034736` | T1 | 2019 wk1 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 124 | `ParkSt00` | Steven Parker | MIA | 2019 | 2 | REG | FS | 0/16/4 | `00-0034736` | T1 | 2019 wk2 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 125 | `ParkSt00` | Steven Parker | MIA | 2019 | 3 | REG | FS | 0/39/6 | `00-0034736` | T1 | 2019 wk3 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 126 | `ParkSt00` | Steven Parker | MIA | 2019 | 4 | REG | FS | 0/66/10 | `00-0034736` | T1 | 2019 wk4 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 127 | `ParkSt00` | Steven Parker | MIA | 2019 | 6 | REG | FS | 0/18/16 | `00-0034736` | T1 | 2019 wk6 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 128 | `ParkSt00` | Steven Parker | MIA | 2019 | 8 | REG | FS | 0/7/3 | `00-0034736` | T1 | 2019 wk8 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 129 | `ParkSt00` | Steven Parker | MIA | 2019 | 9 | REG | FS | 0/0/6 | `00-0034736` | T1 | 2019 wk9 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 130 | `ParkSt00` | Steven Parker | MIA | 2019 | 10 | REG | FS | 0/32/1 | `00-0034736` | T1 | 2019 wk10 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 131 | `ParkSt00` | Steven Parker | MIA | 2019 | 11 | REG | FS | 0/31/0 | `00-0034736` | T1 | 2019 wk11 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 132 | `ParkSt00` | Steven Parker | MIA | 2019 | 12 | REG | FS | 0/68/0 | `00-0034736` | T1 | 2019 wk12 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 133 | `ParkSt00` | Steven Parker | MIA | 2019 | 14 | REG | FS | 0/25/3 | `00-0034736` | T1 | 2019 wk14 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 134 | `ParkSt00` | Steven Parker | MIA | 2019 | 15 | REG | FS | 0/0/5 | `00-0034736` | T1 | 2019 wk15 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 135 | `ParkSt00` | Steven Parker | MIA | 2019 | 16 | REG | FS | 0/14/1 | `00-0034736` | T1 | 2019 wk16 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 136 | `ParkSt00` | Steven Parker | MIA | 2019 | 17 | REG | FS | 0/6/5 | `00-0034736` | T1 | 2019 wk17 MIA DB/DB #26 ACT/A01 "Steven Parker" |
| 137 | `ParkSt00` | Steven Parker | DAL | 2020 | 5 | REG | DB | 0/24/12 | `00-0034736` | T1 | 2020 wk5 DAL DB/DB #40 ACT/A01 "Steven Parker" |
| 138 | `ParkSt00` | Steven Parker | DAL | 2020 | 6 | REG | DB | 0/8/10 | `00-0034736` | T1 | 2020 wk6 DAL DB/DB #40 ACT/ "Steven Parker" |
| 139 | `ParkSt00` | Steven Parker | DAL | 2020 | 7 | REG | DB | 0/25/11 | `00-0034736` | T1 | 2020 wk7 DAL DB/DB #40 ACT/A01 "Steven Parker" |
| 140 | `ParkSt00` | Steven Parker | DAL | 2020 | 8 | REG | DB | 0/5/8 | `00-0034736` | T1 | 2020 wk8 DAL DB/FS #40 ACT/A01 "Steven Parker" |
| 141 | `ParkSt00` | Steven Parker | DAL | 2020 | 9 | REG | S | 0/15/8 | `00-0034736` | T1 | 2020 wk9 DAL DB/FS #40 ACT/A01 "Steven Parker" |
| 142 | `ParkSt00` | Steven Parker | DAL | 2020 | 11 | REG | S | 0/0/14 | `00-0034736` | T1 | 2020 wk11 DAL DB/FS #40 ACT/A01 "Steven Parker" |
| 143 | `ParkSt00` | Steven Parker | DAL | 2020 | 12 | REG | S | 0/0/17 | `00-0034736` | T1 | 2020 wk12 DAL DB/FS #40 ACT/A01 "Steven Parker" |
| 144 | `ParkSt00` | Steven Parker | DAL | 2020 | 17 | REG | DB | 0/1/9 | `00-0034736` | T1 | 2020 wk17 DAL DB/FS #40 ACT/A01 "Steven Parker" |
| 145 | `ParkSt00` | Steven Parker | NYG | 2021 | 8 | REG | FS | 0/0/12 | `00-0034736` | T1 | 2021 wk8 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 146 | `ParkSt00` | Steven Parker | NYG | 2021 | 11 | REG | FS | 0/0/12 | `00-0034736` | T1 | 2021 wk11 NYG DB/FS #38 ACT/P06 "Steven Parker" |
| 147 | `ParkSt00` | Steven Parker | NYG | 2021 | 12 | REG | FS | 0/11/8 | `00-0034736` | T1 | 2021 wk12 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 148 | `ParkSt00` | Steven Parker | NYG | 2021 | 13 | REG | FS | 0/1/8 | `00-0034736` | T1 | 2021 wk13 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 149 | `ParkSt00` | Steven Parker | NYG | 2021 | 14 | REG | FS | 0/0/14 | `00-0034736` | T1 | 2021 wk14 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 150 | `ParkSt00` | Steven Parker | NYG | 2021 | 15 | REG | FS | 0/0/9 | `00-0034736` | T1 | 2021 wk15 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 151 | `ParkSt00` | Steven Parker | NYG | 2021 | 16 | REG | FS | 0/12/15 | `00-0034736` | T1 | 2021 wk16 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 152 | `ParkSt00` | Steven Parker | NYG | 2021 | 17 | REG | FS | 0/0/11 | `00-0034736` | T1 | 2021 wk17 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 153 | `ParkSt00` | Steven Parker | NYG | 2021 | 18 | REG | FS | 0/0/9 | `00-0034736` | T1 | 2021 wk18 NYG DB/FS #38 ACT/A01 "Steven Parker" |
| 154 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 4 | REG | TE | 5/0/12 | `00-0038920` | T1 | 2024 wk4 LV TE/TE #86 ACT/A01 "John Shenker" |
| 155 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 5 | REG | TE | 10/0/15 | `00-0038920` | T1 | 2024 wk5 LV TE/TE #86 ACT/A01 "John Shenker" |
| 156 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 6 | REG | TE | 8/0/15 | `00-0038920` | T1 | 2024 wk6 LV TE/TE #86 ACT/A01 "John Shenker" |
| 157 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 7 | REG | TE | 14/0/11 | `00-0038920` | T1 | 2024 wk7 LV TE/TE #86 ACT/A01 "John Shenker" |
| 158 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 8 | REG | TE | 23/0/10 | `00-0038920` | T1 | 2024 wk8 LV TE/TE #86 ACT/A01 "John Shenker" |
| 159 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 16 | REG | TE | 1/0/15 | `00-0038920` | T1 | 2024 wk16 LV TE/TE #86 ACT/A01 "John Shenker" |
| 160 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 17 | REG | TE | 4/0/20 | `00-0038920` | T1 | 2024 wk17 LV TE/TE #86 ACT/A01 "John Shenker" |
| 161 | `ShenJo00` | John Samuel Shenker | LV | 2024 | 18 | REG | TE | 0/0/13 | `00-0038920` | T1 | 2024 wk18 LV TE/TE #86 ACT/A01 "John Shenker" |
| 162 | `TaylAl02` | Alex Taylor-Prioleau | CLE | 2020 | 17 | REG | T | 0/0/4 | `00-0036120` | T1 | 2020 wk17 CLE OL/T #60 ACT/A01 "Alex Taylor" |
| 163 | `TaylAl02` | Alex Taylor-Prioleau | CLE | 2021 | 6 | REG | T | 0/0/2 | `00-0036120` | T1 | 2021 wk6 CLE OL/T #70 ACT/A01 "Alex Taylor" |
| 164 | `TaylAl02` | Alex Taylor-Prioleau | CLE | 2021 | 7 | REG | T | 0/0/4 | `00-0036120` | T1 | 2021 wk7 CLE OL/T #70 ACT/A01 "Alex Taylor" |
| 165 | `TaylAl02` | Alex Taylor-Prioleau | DAL | 2022 | 18 | REG | T | 0/0/1 | `00-0036120` | T1 | 2022 wk18 DAL OL/T #69 ACT/A01 "Alex Taylor" |
| 166 | `WhitCo05` | Cody White | PIT | 2021 | 3 | REG | WR | 9/0/0 | `00-0035891` | T2 | 2021 wk3 PIT WR/WR #15 ACT/A01 "Cody White" |
| 167 | `WhitCo05` | Cody White | PIT | 2021 | 4 | REG | WR | 2/0/1 | `00-0035891` | T2 | 2021 wk4 PIT WR/WR #15 ACT/A01 "Cody White" |
| 168 | `WhitCo05` | Cody White | PIT | 2021 | 5 | REG | WR | 16/0/4 | `00-0035891` | T2 | 2021 wk5 PIT WR/WR #15 ACT/A01 "Cody White" |
| 169 | `WhitCo05` | Cody White | PIT | 2021 | 6 | REG | WR | 0/0/8 | `00-0035891` | T2 | 2021 wk6 PIT WR/WR #15 ACT/A01 "Cody White" |
| 170 | `WhitCo05` | Cody White | PIT | 2021 | 8 | REG | WR | 0/0/3 | `00-0035891` | T2 | 2021 wk8 PIT WR/WR #15 ACT/A01 "Cody White" |
| 171 | `WhitCo05` | Cody White | PIT | 2021 | 9 | REG | WR | 2/0/7 | `00-0035891` | T2 | 2021 wk9 PIT WR/WR #15 ACT/A01 "Cody White" |
| 172 | `WhitCo05` | Cody White | PIT | 2021 | 10 | REG | WR | 12/0/10 | `00-0035891` | T2 | 2021 wk10 PIT WR/WR #15 ACT/A01 "Cody White" |
| 173 | `WhitCo05` | Cody White | PIT | 2021 | 11 | REG | WR | 0/0/10 | `00-0035891` | T2 | 2021 wk11 PIT WR/WR #15 ACT/A01 "Cody White" |
| 174 | `WhitCo05` | Cody White | PIT | 2021 | 12 | REG | WR | 0/0/11 | `00-0035891` | T2 | 2021 wk12 PIT WR/WR #15 ACT/A01 "Cody White" |
| 175 | `WhitCo05` | Cody White | PIT | 2021 | 13 | REG | WR | 1/0/8 | `00-0035891` | T2 | 2021 wk13 PIT WR/WR #15 ACT/A01 "Cody White" |
| 176 | `WhitCo05` | Cody White | PIT | 2021 | 14 | REG | WR | 0/0/5 | `00-0035891` | T2 | 2021 wk14 PIT WR/WR #15 ACT/A01 "Cody White" |
| 177 | `WhitCo05` | Cody White | PIT | 2021 | 15 | REG | WR | 0/0/8 | `00-0035891` | T2 | 2021 wk15 PIT WR/WR #15 ACT/A01 "Cody White" |
| 178 | `WhitCo05` | Cody White | PIT | 2021 | 16 | REG | WR | 28/0/10 | `00-0035891` | T2 | 2021 wk16 PIT WR/WR #15 ACT/A01 "Cody White" |
| 179 | `WhitCo05` | Cody White | PIT | 2021 | 17 | REG | WR | 0/0/10 | `00-0035891` | T2 | 2021 wk17 PIT WR/WR #15 ACT/A01 "Cody White" |
| 180 | `WhitCo05` | Cody White | PIT | 2021 | 18 | REG | WR | 7/0/10 | `00-0035891` | T2 | 2021 wk18 PIT WR/WR #15 ACT/A01 "Cody White" |
| 181 | `WhitCo05` | Cody White | PIT | 2022 | 12 | REG | WR | 10/0/9 | `00-0035891` | T2 | 2022 wk12 PIT WR/WR #15 ACT/P06 "Cody White" |
| 182 | `WhitCo05` | Cody White | SEA | 2024 | 9 | REG | WR | 35/0/11 | `00-0035891` | T2 | 2024 wk9 SEA WR/WR #82 ACT/A01 "Cody White" |
| 183 | `WhitCo05` | Cody White | SEA | 2024 | 11 | REG | WR | 4/0/14 | `00-0035891` | T2 | 2024 wk11 SEA WR/WR #82 ACT/A01 "Cody White" |
| 184 | `WhitCo05` | Cody White | SEA | 2024 | 12 | REG | WR | 17/0/12 | `00-0035891` | T2 | 2024 wk12 SEA WR/WR #82 ACT/A01 "Cody White" |
| 185 | `WhitCo05` | Cody White | SEA | 2024 | 13 | REG | WR | 6/0/12 | `00-0035891` | T2 | 2024 wk13 SEA WR/WR #82 ACT/A01 "Cody White" |
| 186 | `WhitCo05` | Cody White | SEA | 2025 | 1 | REG | WR | 5/0/6 | `00-0035891` | T2 | 2025 wk1 SEA WR/WR #82 ACT/A01 "Cody White" |
| 187 | `WhitCo05` | Cody White | SEA | 2025 | 9 | REG | WR | 36/0/7 | `00-0035891` | T2 | 2025 wk9 SEA WR/WR #82 ACT/A01 "Cody White" |
| 188 | `WhitCo05` | Cody White | SEA | 2025 | 10 | REG | WR | 45/0/15 | `00-0035891` | T2 | 2025 wk10 SEA WR/WR #82 ACT/A01 "Cody White" |
| 189 | `WhitCo05` | Cody White | SEA | 2025 | 11 | REG | WR | 22/0/14 | `00-0035891` | T2 | 2025 wk11 SEA WR/WR #82 ACT/A01 "Cody White" |
| 190 | `WhitCo05` | Cody White | SEA | 2025 | 12 | REG | WR | 11/0/15 | `00-0035891` | T2 | 2025 wk12 SEA WR/WR #82 ACT/A01 "Cody White" |
| 191 | `WhitCo05` | Cody White | SEA | 2025 | 13 | REG | WR | 14/0/17 | `00-0035891` | T2 | 2025 wk13 SEA WR/WR #82 ACT/A01 "Cody White" |
| 192 | `WhitCo05` | Cody White | SEA | 2025 | 14 | REG | WR | 17/0/15 | `00-0035891` | T2 | 2025 wk14 SEA WR/WR #82 ACT/A01 "Cody White" |
| 193 | `WhitCo05` | Cody White | SEA | 2025 | 15 | REG | WR | 9/0/9 | `00-0035891` | T2 | 2025 wk15 SEA WR/WR #82 ACT/A01 "Cody White" |
| 194 | `WhitCo05` | Cody White | SEA | 2025 | 16 | REG | WR | 6/0/17 | `00-0035891` | T2 | 2025 wk16 SEA WR/WR #82 ACT/A01 "Cody White" |
| 195 | `WhitCo05` | Cody White | SEA | 2025 | 17 | REG | WR | 0/0/2 | `00-0035891` | T2 | 2025 wk17 SEA WR/WR #82 ACT/A01 "Cody White" |
| 196 | `WillCh06` | Chris Williams | CHI | 2014 | 2 | REG | WR | 1/0/0 | `00-0026691` | T3 | 2014 wk2 CHI WR #82 CUT/A01 "Chris Williams" |
| 197 | `WillCh06` | Chris Williams | CHI | 2014 | 5 | REG | WR | 1/0/6 | `00-0026691` | T3 | 2014 wk5 CHI WR #82 CUT/A01 "Chris Williams" |
| 198 | `WillCh06` | Chris Williams | CHI | 2014 | 6 | REG | WR | 2/0/4 | `00-0026691` | T3 | 2014 wk6 CHI WR #82 CUT/A01 "Chris Williams" |
| 199 | `WillCh06` | Chris Williams | CHI | 2014 | 7 | REG | WR | 0/0/6 | `00-0026691` | T3 | 2014 wk7 CHI WR #82 CUT/A01 "Chris Williams" |
| 200 | `WillCh06` | Chris Williams | CHI | 2014 | 8 | REG | WR | 0/0/10 | `00-0026691` | T3 | 2014 wk8 CHI WR #82 CUT/A01 "Chris Williams" |
| 201 | `WillCh06` | Chris Williams | CHI | 2014 | 10 | REG | WR | 8/0/12 | `00-0026691` | T3 | 2014 wk10 CHI WR #82 CUT/A01 "Chris Williams" |
| 202 | `WillCh06` | Chris Williams | CHI | 2014 | 11 | REG | WR | 3/0/9 | `00-0026691` | T3 | 2014 wk11 CHI WR #82 CUT/A01 "Chris Williams" |
| 203 | `WillDa14` | Darryl Williams | JAX | 2022 | 4 | REG | C | 0/0/3 | `00-0035892` | T3 | 2022 wk4 JAX OL/C #60 ACT/A01 "Darryl Williams" |
| 204 | `WillIs02` | Isaiah Williams | NYJ | 2021 | 4 | REG | G | 0/0/5 | `00-0033161` | T3 | 2021 wk4 NYJ OL/G #71 ACT/A01 "Isaiah Williams" |
| 205 | `WillIs02` | Isaiah Williams | NYJ | 2021 | 5 | REG | G | 0/0/3 | `00-0033161` | T3 | 2021 wk5 NYJ OL/G #71 ACT/A01 "Isaiah Williams" |
| 206 | `WillIs02` | Isaiah Williams | NYJ | 2021 | 7 | REG | G | 0/0/2 | `00-0033161` | T3 | 2021 wk7 NYJ OL/G #71 ACT/A01 "Isaiah Williams" |
| 207 | `WillIs02` | Isaiah Williams | NYJ | 2021 | 16 | REG | G | 7/0/0 | `00-0033161` | T3 | 2021 wk16 NYJ OL/G #71 ACT/A01 "Isaiah Williams" |
| 208 | `WillRo08` | Rodney Williams | PIT | 2023 | 5 | REG | TE | 4/0/7 | `00-0037451` | T2 | 2023 wk5 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 209 | `WillRo08` | Rodney Williams | PIT | 2023 | 7 | REG | TE | 11/0/12 | `00-0037451` | T2 | 2023 wk7 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 210 | `WillRo08` | Rodney Williams | PIT | 2023 | 8 | REG | TE | 12/0/13 | `00-0037451` | T2 | 2023 wk8 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 211 | `WillRo08` | Rodney Williams | PIT | 2023 | 9 | REG | TE | 3/0/13 | `00-0037451` | T2 | 2023 wk9 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 212 | `WillRo08` | Rodney Williams | PIT | 2023 | 10 | REG | TE | 3/0/21 | `00-0037451` | T2 | 2023 wk10 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 213 | `WillRo08` | Rodney Williams | PIT | 2023 | 11 | REG | TE | 0/0/16 | `00-0037451` | T2 | 2023 wk11 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 214 | `WillRo08` | Rodney Williams | PIT | 2023 | 12 | REG | TE | 4/0/12 | `00-0037451` | T2 | 2023 wk12 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 215 | `WillRo08` | Rodney Williams | PIT | 2023 | 13 | REG | TE | 5/0/12 | `00-0037451` | T2 | 2023 wk13 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 216 | `WillRo08` | Rodney Williams | PIT | 2023 | 14 | REG | TE | 4/0/14 | `00-0037451` | T2 | 2023 wk14 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 217 | `WillRo08` | Rodney Williams | PIT | 2023 | 15 | REG | TE | 2/0/15 | `00-0037451` | T2 | 2023 wk15 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 218 | `WillRo08` | Rodney Williams | PIT | 2023 | 16 | REG | TE | 2/0/17 | `00-0037451` | T2 | 2023 wk16 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 219 | `WillRo08` | Rodney Williams | PIT | 2023 | 17 | REG | TE | 4/0/15 | `00-0037451` | T2 | 2023 wk17 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 220 | `WillRo08` | Rodney Williams | PIT | 2023 | 18 | REG | TE | 1/0/22 | `00-0037451` | T2 | 2023 wk18 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 221 | `WillRo08` | Rodney Williams | PIT | 2023 | 19 | WC | TE | 2/0/16 | `00-0037451` | T2 | 2023 wk19 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 222 | `WillRo08` | Rodney Williams | PIT | 2024 | 3 | REG | TE | 2/0/19 | `00-0037451` | T2 | 2024 wk3 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 223 | `WillRo08` | Rodney Williams | PIT | 2024 | 4 | REG | TE | 0/0/17 | `00-0037451` | T2 | 2024 wk4 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 224 | `WillRo08` | Rodney Williams | PIT | 2024 | 5 | REG | TE | 0/0/15 | `00-0037451` | T2 | 2024 wk5 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 225 | `WillRo08` | Rodney Williams | PIT | 2024 | 6 | REG | TE | 2/0/17 | `00-0037451` | T2 | 2024 wk6 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 226 | `WillRo08` | Rodney Williams | PIT | 2024 | 7 | REG | TE | 0/0/17 | `00-0037451` | T2 | 2024 wk7 PIT TE/TE #87 ACT/A01 "Rod Williams" |
| 227 | `WillRo08` | Rodney Williams | PIT | 2024 | 8 | REG | TE | 1/0/20 | `00-0037451` | T2 | 2024 wk8 PIT TE/TE #87 ACT/A01 "Rod Williams" |