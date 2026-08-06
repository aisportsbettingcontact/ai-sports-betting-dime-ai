# INT — integration: applying the audit to `nfl.db`

## Verdict

**PASS WITH EXCEPTIONS** — all five `lib/` modules are wired in in the mandated order, 20 of the
24 defects are applied and asserted against the **built database**, the build gates now catch 43 of
43 deliberate corruptions, and four items are deferred with named reasons (three need an owner
ruling, one is outside this task's file ownership).

`nfl.db.pre-completion-backup` is untouched: md5 `1d2b0bea3e85edf467ef446db807bc7d`, identical at
the start and the end of this work.

```
$ md5 nfl.db.pre-completion-backup
MD5 (nfl.db.pre-completion-backup) = 1d2b0bea3e85edf467ef446db807bc7d
```

## What I changed

| Path | Change |
|---|---|
| `scripts/data/nfl-db/schema.sql` | 12 tables → 13 (`data_correction` added), 43 → 51 named indexes, 5 → 6 views |
| `scripts/data/nfl-db/build_db.py` | rewritten around the five modules; 3 passes → 4; 55 → 163 checks |
| `scripts/data/nfl-db/lib/corrections.py` | **new** — 10 defects, 624 stamped field corrections |
| `scripts/data/nfl-db/nfl.db` | rebuilt, 209 MB → 487 MB |

No `reports/*.md`, `INTEGRATION.md`, `CONTEXT.md`, `lib/*` (other than the new `corrections.py`) or
`verify/*` file was modified. The five existing modules and five verifiers are used **as shipped**.

## 1. Module wiring — the mandated order

`player_dimension` → `team_aliases` → `snap_crosswalk` → `depth_charts` → `rowloss`.

The order is load-bearing and is enforced by the code path, not by comment. `build()` loads the
player dimension before anything else because `game` FKs the QB ids and all four fact tables now
FK `player(gsis_id)`; the snap crosswalk runs third and its targets are asserted present in the
dimension. B5's example, `00-0039856`, resolves:

```
$ sqlite3 -readonly nfl.db "SELECT gsis_id,display_name FROM player WHERE gsis_id='00-0039856';"
00-0039856|Isaiah Land
$ sqlite3 -readonly nfl.db "SELECT COUNT(*) FROM snap_count WHERE gsis_id='00-0039856';"
6
```

`rowloss` is wired as a gate, not a loader (PASS 2b).

## 2. Row counts, before and after

| Table | Before | After | Why |
|---|---:|---:|---|
| `team` | 32 | 32 | — |
| `team_alias` | 37 | **44** | B2's full census (41) + the 3 era-split abbreviations that are unambiguous inside 2010–2026 (`HOU`→34, `BAL`→33, `STL`→14) |
| `player` | 25,035 | **26,517** | D5 — B5's union; 1,482 ids that fact tables referenced and `players.csv` omits |
| `game` | 4,648 | 4,648 | — |
| `game_line` | 4,363 | 4,363 | — |
| `team_game` | 9,270 | 9,270 | — |
| `player_game_stats` | 286,843 | 286,843 | — (13 rows *re-keyed* by D19, not added or dropped) |
| `snap_count` | 324,611 | 324,611 | — |
| `roster_season` | 43,856 | 43,856 | — |
| `depth_chart` | 552,514 | **1,106,729** | D6 — shape B recovered (552,514 A + 554,215 B) |
| `data_correction` | — | **624** | new audit table, one row per corrected field value |

Column additions: `player.canonical_gsis_id`; `game.away_rest_upstream` / `home_rest_upstream`;
`team_game.su_result` / `ats_result` / `ou_result` / `rest_days_upstream`;
`player_game_stats.game_id`; `snap_count.game_id` / `playoff_round` / `source_game_type` /
`source_week` / `franchise_id_upstream`; `roster_season.roster_row_id` / `season_type` / `week` /
`playoff_round` / `source_game_type` / `source_week` / `source_ordinal`; `depth_chart` replaced
wholesale with B3's DDL plus `depth_chart_id` and `source_ordinal`.

## 3. Defects applied

| # | Applied | Evidence in the built database |
|---|---|---|
| D1 | ✅ | `player_game_stats.game_id NOT NULL REFERENCES game`, resolved 286,843/286,843. `v_player_game` joins on it. POST rows with NULL game context: **12,050 → 0**; NULL `spread_line`: **12,050 → 0** |
| D2 | ✅ | snap join carries `AND s.franchise_id = p.franchise_id AND s.game_id = p.game_id`. See §6 — this is a *structural* fix whose data effect is now zero, and I say why |
| D3 | ✅ | every abbreviation goes through `team_aliases.resolve()`, which raises. `dict.get()` is gone from the loader |
| D4 | ✅ | `snap_count.gsis_id NOT NULL` + FK. NULLs **227 → 0**. The `≥95%` gate is deleted; no percentage threshold remains anywhere in `build_db.py` |
| D5 | ✅ | 0 orphans from all six fact sources, asserted in SQL against the built DB |
| D6 | ✅ | `depth_chart` 552,514 → 1,106,729; 2025 season present |
| D7 | ✅ | `snap_count.game_id` = nflverse id, `pfr_game_id` = PFR's own. A5's own IC-13 now reads `0/3562 match game.game_id; 3562/3562 match game.pfr_game_id` |
| D8 | ✅ | `depth_chart.week` CHECK 1–18 + `playoff_round`; nflverse's 1–22 counter preserved as `source_week` |
| D9 | ✅ | `2010_10_HOU_JAX` → `301114030`; `espn_event_id` is **UNIQUE**; 0 collisions |
| D10 | ✅ | 2026 neutral-site games **0 → 10**, incl. Super Bowl LXI. Invariants added: every SB row is Neutral, every season has ≥1 neutral game |
| D11 | ✅ | 91 gamedays corrected. A1's own `gameday_pt` check now reads **4648/4648 agree, 0 mismatch** |
| D12 | ✅ | 7 kickoffs. A1's `kickoff_utc` mismatches **39 → 32**, and all 32 remaining are its own R2 "do not fix" rule |
| D13 | ⚠️ partial | 7 venues renamed to the actual stadium; `stadium_id`/`roof`/`surface` filled for the 4 with in-DB precedent, **NULLed** for the 3 without. Weather **not touched**. See §7 |
| D14 | ✅ | `ats_result`/`ou_result`/`su_result`, CHECK-constrained against their own inputs. Naive ATS **45.89%**, explicit **50.00%**. All three NULL on exactly the 544 unplayed rows and nothing else |
| D15 | ✅ | 34 `rest_days` recomputed in `game` **and** `team_game` (68 values); upstream preserved in `*_upstream`. PASS 3 asserts the divergence from live nflverse is exactly those 34 |
| D16 | ✅ | 358 Super Bowl snap rows swapped; `franchise_id_upstream` preserves nflverse's. Brady's SB LV snaps now sit on TB (27). A3 independently reports `snap_super_bowl_swapped_rows: 0` |
| D17 | ✅ | 44 field values across 14 player-games. A3/A5's ESPN check E-01 unexplained **58 → 14** |
| D18 | ✅ | `pfr_id` swapped in `player` **and** in B1's crosswalk (or the two tables would disagree); the 4 draft fields moved to the OT. Snap split now 79 OT / 67 DE. A3 reports `snap_pfr_swap_candidates: 0` |
| D19 | ✅ | 13 rows re-keyed to the safety `00-0035681`; `position` OL → SAF. A3 reports `gap_fill_misattributions: 0` |
| D20 | ✅ | `snap_count.season_type` CHECK `('REG','POST')` + `playoff_round`; source vocabulary kept in `source_game_type`. Asserted to agree with `game` on all 324,611 rows |
| D21 | ❌ deferred | Extract gap, not a loader defect — see §7 |
| D22 | ✅ | `connect()` sets and *verifies* `PRAGMA foreign_keys` on every connection; player FKs added to `snap_count`/`roster_season`/`depth_chart` so `foreign_key_check` is no longer vacuous; **5 negative controls** prove enforcement is live |
| D23 | ✅ | PKs on all three: `snap_count(pfr_player_id, pfr_game_id)`, `roster_season(roster_row_id)` + UNIQUE natural key, `depth_chart(depth_chart_id)` + B3's partial UNIQUE. A PASS-1 probe asserts each table declares a PK |
| D24 | ✅ | `idx_player_espn`; the planner is asserted to choose it |

Also applied, from S1's omissions list: **N8** (`roster_season` now keeps `week`/`game_type`),
**S1's D18 widening** (the 4 draft fields), **S1's `v_game_line_observed` recommendation** for N1,
and **G-8** (`season_type` CHECKs on `team_game`, `snap_count`, `depth_chart`; week/round
exclusivity on `team_game`).

## 4. Gate results — every gate perturbed

43 deliberate corruptions on scratch copies of the rebuilt database. **43 caught, 0 missed.**
Harness: `perturb.py` (scratchpad; reproduce section below).

**20 refused by the schema** (the write itself raises `IntegrityError`):

| Perturbation | Refused by |
|---|---|
| `snap_count.gsis_id` set to NULL (D4/S2 EX-2) | `NOT NULL` |
| `snap_count` / `roster_season` / `depth_chart`.`gsis_id` → non-player (D5) | FK ×3 |
| duplicate `espn_event_id` (D9) | `UNIQUE` |
| `player_game_stats.game_id` NULLed / → non-game (D1) | `NOT NULL`, FK |
| `snap_count.game_id` → non-game (D22) | FK |
| duplicate `snap_count` row (D23) | PK |
| duplicate `roster_season` natural key (D23) | `UNIQUE` |
| duplicate `depth_chart` snapshot slot (D23) | `UNIQUE` |
| `ats_result` flipped / NULLed; `su_result` on an unplayed game; a push relabelled a loss (D14) | 4 CHECKs |
| `snap_count.season_type` → `'SB'`; postseason row given a week (D20) | CHECK ×2 |
| `depth_chart.week` → 22; `season_type` → `'SBBYE'` (D8) | CHECK ×2 |
| `data_correction.source` emptied | CHECK |

**23 caught by a build assertion** (the write is legal; a named check flips to FAIL):

| Perturbation | Caught by |
|---|---|
| `espn_event_id` changed to an unrelated value | `D9: 2010_10_HOU_JAX carries espn_event_id 301114030` |
| a 2026 neutral site flipped back to Home | `D10: 2026 has 10 neutral-site games (was 0)` |
| Super Bowl LXI flipped back to Home | same |
| a corrected gameday reverted to the UTC date | `D11: 91 of the 285 2026 gamedays no longer equal the UTC date` |
| a London kickoff reverted by +12h | `D12: no neutral-site game is still stored at 21:30 ET` |
| a 2025 international venue reverted to the home team's | `D13: 2025_04_MIN_PIT records its actual venue` |
| one of the 5 unverifiable weather readings silently NULLed | `D13: the 5 unverifiable weather readings are untouched (rule 1)` |
| a corrected `rest_days` reverted | `D15: all 34 rest_days corrected, all 34 upstream values preserved` |
| `game` and `team_game` rest pushed out of step | `D15: team_game.rest_days and game.{home,away}_rest stay in step` |
| one Super Bowl snap row un-swapped | `D16: all 358 Super Bowl snap rows swapped, upstream preserved` |
| a duplicated-play correction reverted | `D17: all 44 duplicated-play values corrected` |
| a phantom rushing TD restored | same |
| the Jonah Williams `pfr_id` swap reverted | `D18: the Alabama OT holds WillJo10 and the 2019 R1 P11 pick` |
| the misattributed draft pick restored | `D18: the Weber State DE holds WillJo16 and is undrafted` |
| a re-keyed row moved back to the 2024 lineman | `D19: the 2024 lineman no longer holds a 2020 season` |
| the recovered 2025 depth-chart season deleted | `depth_chart holds every source row, both shapes (D6)` |
| 1,000 **fact-referenced** players deleted from the dimension (the pre-fix orphan state) | `roster_season.gsis_id: zero orphans against the player dimension` (D5) |
| `v_player_game` rebuilt without the franchise predicate | `v_player_game's snap join carries the franchise predicate (D2)` |
| `v_player_game` rebuilt with the pre-fix `(season, week)` join | `v_player_game joins game on game_id, not (season, week) (D1)` |
| `idx_player_espn` dropped | `planner uses an index for espn_id player lookup` (D24) |
| `pfr_game_id` refilled with the nflverse id | `snap_count.pfr_game_id no longer holds the nflverse game id (D7)` |
| a correction deleted from the ledger | `data_correction covers all 10 corrected defects` |

Two perturbations failed to fire on the first attempt. Both are reported rather than
quietly fixed, because a gate that passes on broken data is a failure of this work.

**(a) A harness error, not a gate weakness — D5.** My first D5 perturbation deleted 1,000 players
that *no* fact table references, which produces zero orphans by construction, and asserted against a
check whose expected value my harness read back out of the perturbed database (self-referential).
Retargeted at 1,000 **referenced** players: caught immediately by the orphan assertion.

**(b) A real gap in my own work — D2.** My first D2 perturbation
— rebuilding `v_player_game` without the franchise predicate — was **NOT caught**. That is a real
finding about my own work and it is reported here rather than quietly fixed:

- Once `player_game_stats` carries `game_id` (D1) and `snap_count` has a primary key (D23),
  `(gsis_id, game_id)` is already unique, so removing the franchise predicate changes **zero rows**.
  Measured: `234,440` snap attachments with the predicate, `234,440` without, and **0** rows where a
  player's snap franchise disagrees with their stat franchise (that count was 358 before D16).
- So D2's fan-out (274,794 vs 274,793) is eliminated by the `game_id` join, not by the predicate.
  Jalen Davis's two 2021-wk-12 snap rows are in two *different games*; `(season, week)` could not
  tell them apart, `game_id` can.
- The predicate is still what makes the wrong-team attachment structurally impossible rather than
  merely absent, so I made it falsifiable by asserting it against the view's own SQL in
  `sqlite_master`. Three PASS-1 checks now do this. Re-perturbed: caught.

## 5. Build result

```
PASS 1 (structural):     45/45
PASS 2 (reconciliation): 106/106
PASS 2b is inside PASS 2's count (8 rowloss gates)
PASS 3 (external, live nflverse via R): 12/12
TOTAL: 163/163
```

PASS 3 re-fetched nflverse live and confirmed scores, week/round, spreads, starting QBs, the
preserved upstream rest values, and every 2023 player-week stat line still match — while asserting
that the *corrected* rest column diverges from upstream on exactly D15's 34 rows and nowhere else.

## 6. The ten shipped executables, re-run against the rebuilt database

| Executable | Exit | Verdict | Stale, or is the rebuild wrong? |
|---|---|---|---|
| `lib/team_aliases.py` | 0 | PASS | valid |
| `lib/snap_crosswalk.py` | 0 | PASS — 0 unresolved of 324,611 | valid |
| `lib/depth_charts.py` | 0 | PASS | valid |
| `lib/player_dimension.py` | 0 | PASS — 0 orphans before *and* after | valid |
| `lib/rowloss.py` | **1** | FAIL on 7 tables | **verifier stale, by design of the fixes** — see below |
| `verify/a1_games_espn.py --no-network` | **0** | **VERDICT: PASS** — confirmed DB defects **120 → 0** (was exit 1) | valid; it now agrees |
| `verify/a2_franchise.py --offline` | **0** | **PASS — zero mismatches** (was exit 1, 1 mismatch) | valid; D9 closed it |
| `verify/a3_players.py` | 1 | fatal by design; SB swaps **358 → 0**, pfr-swap candidates **→ 0**, gap-fill misattributions **→ 0** | valid |
| `verify/a4_lines.py` | 0 | PASS WITH EXCEPTIONS, 77/77 | check valid; **EX-03's printed text is stale** |
| `verify/a5_stats.py --offline` | 1 | 4 checks newly flag | **3 stale, 1 valid** — see below |

### `rowloss.py` — stale, and exactly how

`rowloss.py` replays the **previous** loader. Six tables changed shape, so its comparisons no longer
address them. I did not edit it; instead the build's PASS 2b consults it per table with the
strongest claim that still holds, and names the ones that do not:

- `game`, `game_line`, `team_game` — fully valid, all pass.
- `player` — keys valid; the 1,482 extras are D5's deliberate expansion, asserted as exactly 1,482.
- `player_game_stats` — keys valid; the gate is "the ONLY key movement is D19's 13 documented
  re-keys", which I verified exhaustively against the source CSV:

  ```
  value differences DB vs raw/player_stats.csv: 44   (all 44 are D17 targets, none outside)
  CSV keys absent from DB:                      13   (all 13 are D19 re-keys)
  ```

- `snap_count` — its key is `(pfr_player_id, pfr_game_id)` and **D7 changed what that column
  holds**, so its key comparison is stale as a direct consequence of the fix it recommended.
- `roster_season`, `depth_chart` — its key is `<whole row>` via `SELECT *`; any added column breaks
  it. For `depth_chart` the *manifest* is also superseded: it expects 554,215 excluded rows and D6
  loads all of them.

  For those three the gate asserts `loaded == source_rows` (324,611 / 43,856 / 1,106,729), which is
  strictly stronger than the manifest it replaces.

**`rowloss.py`'s `EXPECTED_EXCLUSIONS` needs a coordinator-approved widening** to cover D19's 13
re-keys and the retirement of the 554,215 depth-chart exclusion. I did not edit it — it is not mine.

### `a5_stats.py` — three stale checks, one valid

- **IC-12 (649,222 flagged): stale.** It joins DB to CSV on `pfr_game_id`, which now holds PFR's id
  (D7). Nothing matches, so every row reports twice. This is precisely the false-pass S2 caught in
  its own work ("a join that matches zero rows must be an assertion failure, not a pass") — except
  A5 fails loudly instead of passing, which is the correct behaviour. **IC-13 in the same script
  confirms the fix**: `3562/3562 match game.pfr_game_id`.
- **IC-11 (40 flagged): stale.** Every flag is a D17 correction; verified exhaustively above.
- **IC-15 (4,226 flagged): stale.** It groups on `(gsis_id, season, week)` and `snap_count.week` is
  now NULL for postseason rows (D20). It must group on `source_week` or on
  `(week, playoff_round)`. It still correctly finds Jalen Davis.
- **IC-10 (1 flagged): valid and unchanged.** The 2010–2012 snap gap, D21. See §7.
- **IC-14: 358 → 1.** D16 closed 358; the 1 remaining is Jalen Davis, deliberately unresolved.
- **IC-05 / IC-06b (2 each): unchanged and correct.** Both reconstruct from `raw/player_stats.csv`,
  so they still see the upstream duplication D17 corrects in the database.

### `a4_lines.py` — check valid, printed text stale

Its rest check now takes the `rest_days == calendar_gap` branch for all 34 rows and passes. But
lines 618–619 unconditionally print `REST_EXCEPTIONS`'s hardcoded strings, so EX-03 still reports
`rest_days=7, real calendar gap=6` for rows the database now stores as 6. The **gate** is right; the
**exception listing** describes a state that no longer exists.

### `a1_games_espn.py` — it now agrees

Its own per-field table, unedited:

| field | before (A1's report) | after |
|---|---:|---:|
| `gameday_pt` mismatches | 91 | **0** |
| `neutral_site` mismatches | 26 | **16** (all 16 are its own R1 do-not-fix rule) |
| `kickoff_utc` mismatches | 39 | **32** (all 32 are its own R2 do-not-fix rule) |
| `stadium_text` mismatches | 17 | **8** (all 8 are its own R3 do-not-fix rule) |
| total mismatch records | 176 | **56** — every one covered by R1/R2/R3 |
| confirmed DB defects | **120** | **0** |
| exit code | 1 | **0**, `VERDICT: PASS` |

Its first re-run reported 2 remaining defects, both of which were my transliteration of a venue name
(`Olympiastadion Berlin`, `Santiago Bernabeu`). I adopted ESPN's own strings — `Olympic Stadium
Berlin` and `Santiago Bernabéu` — which are better-cited than mine, and re-ran.

## 7. Not applied, and why

| # | Item | Why not |
|---|---|---|
| **D13 (partial)** | `stadium_id` / `roof` / `surface` for Croke Park, Olympic Stadium Berlin and Santiago Bernabéu | **No source exists.** A1 sourced the venue *name* for all seven but no code, roof or surface for any. Four are played at venues this database already has its own code and attributes for (`SAO00`, `LON02`×2, `LON00`) — that is a citation. Three have no precedent anywhere in the repo. Minting three stadium codes and sourcing their roof/surface is an owner action. The stored values are the *home team's* and provably wrong, so they are NULLed: absent is true, wrong is not. **Rule 1.** |
| **D13 (weather)** | the 5 unverifiable `temp`/`wind` readings | Explicitly forbidden by the ledger and by rule 1. Left exactly as found, and a gate now fails if anything changes them. `2025_10_ATL_IND` keeps its mixed provenance visible: weather populated, roof now NULL rather than Indianapolis's `closed`. |
| **D21** | the 2012 snap gap | S1 is right that 2012 is a defect, but it is an **extract** gap: nflverse publishes snap counts from 2012 and `raw/snap_counts.csv` starts at 2013. Fixing it means re-fetching the source, not changing the loader. Recorded in `corrections.UNRESOLVED_EXCEPTIONS`. |
| **N9** | 18 `roster_season` rows with NULL `gsis_id` | Not on this task's correction list. B5 E7 resolves 17 unambiguously. The rows load with a NULL FK, which is legal. Recorded. |

### Open contradictions — recorded, not resolved (rule 4)

`corrections.OPEN_CONTRADICTIONS` carries all six with evidence, and **none is silently changed**:
`2021_10_DET_PIT`, `2020_01_LV_CAR`, the Bills Toronto Series (the three the brief names), plus
S1's two omitted A4 disputes `2021_15_NE_IND` and `2021_17_CLE_PIT`, plus the Jalen Davis anomaly —
which is *proven* while its stated cause (PFR conflating two cornerbacks) remains a hypothesis with
no external source, exactly as S1 X4 requires.

## 8. Needs a coordinator decision

1. **D11's timezone rule — the ledger contradicts CONTEXT.md.** `INTEGRATION.md` D11 says derive
   `gameday` "in the venue's local zone"; `CONTEXT.md`'s identity conventions say Pacific, and
   Pacific is what A1 actually implemented and verified. They disagree on **exactly one row**:
   `2026_01_SF_LAR` at the Melbourne Cricket Ground (Pacific `2026-09-10`, venue-local
   `2026-09-11`). I applied **Pacific** — it is the standing convention, it is the verified rule,
   and no venue→timezone map exists anywhere in the repo (ESPN publishes no timezone field). Flag
   raised rather than silently chosen.
2. **Three stadium codes to mint** (D13, above).
3. **`rowloss.py`'s `EXPECTED_EXCLUSIONS` needs widening** for D19's 13 re-keys and the retirement
   of the 554,215 depth-chart exclusion. That file is not mine to edit.
4. **`scripts/data/nfl-unified-2010-2026/build.py` gate G17 will now fail.** It asserts the
   `espn_event_id` duplicate *still exists*. D9 removes it. **Invert the gate, do not revert the
   fix.** That file is outside this task's ownership and was not touched.
5. **`ou_result` uses `O`/`U`/`P`, not `W`/`L`/`P`.** Over/under has no team perspective — both
   sides share one total — so nominating "over" as a win would assert something that is not a fact
   about the game. The ledger's `(/T)` already implies per-column vocabularies. Deliberate, flagged.
6. **D16's fix verb is my inference.** A5 and A3 both describe the transposition and neither states
   a remedy; A3 says "Coordinator decision." Swapping `franchise_id` is what their description
   implies, the direction is pinned four ways, and `franchise_id_upstream` preserves nflverse's
   value on every row — but the verb is mine and is labelled as such in `corrections.py`.
7. **D18: A3 says "clear" the draft fields, S1 says they "belong to `00-0035629`".** I moved them
   rather than clearing them, because the pick is a fact about the OT and ESPN athlete 4040726
   carries it. Divergence recorded rather than silently resolved.
8. **None of this is in git** (S2 EX-10). `git ls-files scripts/data/nfl-db` still returns 0.
   `build_db.py`, `schema.sql` and `lib/` are untracked, not ignored, and should be committed.

## 9. Reproduce

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai/scripts/data/nfl-db

# 0. the backup is untouched
md5 nfl.db.pre-completion-backup            # 1d2b0bea3e85edf467ef446db807bc7d

# 1. the correction module's own self-check (no file I/O)
python3 lib/corrections.py                  # 19 checks, PASS

# 2. full rebuild (PASS 3 needs Rscript + nflreadr; --no-external skips it)
python3 build_db.py                         # 163/163

# 3. the ten shipped executables
for f in team_aliases snap_crosswalk depth_charts rowloss player_dimension; do
  python3 lib/$f.py; echo "$f -> $?"; done
python3 verify/a1_games_espn.py --no-network; echo "a1 -> $?"
python3 verify/a2_franchise.py --offline;     echo "a2 -> $?"
python3 verify/a3_players.py;                 echo "a3 -> $?"
python3 verify/a4_lines.py;                   echo "a4 -> $?"
python3 verify/a5_stats.py --offline;         echo "a5 -> $?"

# 4. the headline results
sqlite3 -readonly nfl.db "
  SELECT ROUND(100.0*SUM(covered=1)/COUNT(*),2)                              AS naive_ats,
         ROUND(100.0*SUM(ats_result='W')/SUM(ats_result IN ('W','L')),2)     AS explicit_ats,
         SUM(ats_result IS NULL) AS null_ats FROM team_game;"    -- 45.89 | 50.0 | 544
sqlite3 -readonly nfl.db "SELECT season_type,COUNT(*),SUM(game_id IS NULL),
  SUM(spread_line IS NULL) FROM v_player_game GROUP BY 1;"       -- POST|12050|0|0
sqlite3 -readonly nfl.db "SELECT COUNT(*) FROM snap_count WHERE gsis_id IS NULL;"   -- 0
sqlite3 -readonly nfl.db "SELECT season,SUM(location='Neutral') FROM game
  WHERE season>=2022 GROUP BY 1;"                                -- 2026|10
sqlite3 -readonly nfl.db "SELECT COUNT(*) FROM depth_chart;"     -- 1106729
sqlite3 -readonly nfl.db "SELECT defect,COUNT(*) FROM data_correction GROUP BY 1;"

# 5. every correction, with its prior value and citation
sqlite3 -readonly nfl.db "SELECT defect,target_key,column_name,upstream_value,
  corrected_value,source FROM data_correction WHERE defect='D15' LIMIT 3;"

# 6. the negative control (42 perturbations on scratch copies; never touches nfl.db)
python3 <scratchpad>/perturb.py             # 43 perturbations, 43 caught, 0 NOT caught
```

The perturbation harness lives in the session scratchpad rather than the repo because it is a
verification artifact, not a shipped module; it is ~250 lines and is reproduced verbatim in the
transcript. It copies `nfl.db` to a scratch file, applies one corruption, re-runs
`build_db.pass_structural` and `build_db.pass_reconciliation` against the perturbed copy, and
asserts the named check flips to FAIL.
