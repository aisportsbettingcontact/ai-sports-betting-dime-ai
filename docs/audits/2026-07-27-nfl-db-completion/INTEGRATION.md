# Integration ledger — coordinator decisions

Durable record of what must change in `build_db.py` / `schema.sql` and in what order.
Written as agents report; survives context loss. Nothing here is applied until all 10 land.

## Ordering constraint (from B5)

Modules have a real dependency chain. Apply in this order:

1. **`player_dimension`** — must be first. B5 found `00-0039856`, one of B1's crosswalk targets,
   does not exist in the current `player` table. Loading the snap crosswalk first would re-orphan it.
2. **`team_aliases`** — needed by every fact-table loader.
3. **`snap_crosswalk`** — depends on the expanded dimension.
4. **`depth_charts`** (B3) — depends on aliases and the espn_id crosswalk.
5. **`rowloss`** (B4) — wired in last, as a build gate rather than a loader.

## Confirmed defects to fix

| # | Defect | Evidence | Fix |
|---|---|---|---|
| D1 | `v_player_game` returns NULL game context for **all 12,050 POST rows**. `game` stores postseason as `week IS NULL` + `playoff_round`; `player_game_stats` stores weeks 18–22. `g.week = p.week` never matches. | Verified directly: `SELECT season_type, SUM(game_id IS NULL) FROM v_player_game GROUP BY 1` → POST 12050/12050 | Add `game_id` to `player_game_stats` (B4 C1: the source CSV resolves it for 286,843/286,843 rows and the loader discards it) and join on it. Removes the week-encoding dependency entirely. |
| D2 | `v_player_game` snap join lacks a franchise condition, so a player with snaps for two teams in one week fans out and gets the wrong team's usage. | Jalen Davis `00-0034446`, 2021 wk 12: snap rows in both `2021_12_CAR_MIA` (fid 15) and `2021_12_PIT_CIN` (fid 4). View returns 274,794 REG rows vs 274,793 base. | Add `AND s.franchise_id = p.franchise_id` to the snap join. |
| D3 | Alias lookup is `.get()` with no fallback → silent NULL team. The 2026 players release relabelled `ARI`→`AZ`; 92 rows would have loaded team-less with no error. | B2 census, 2,446,721 values / 44 distinct | Use `team_aliases.resolve()`, which raises on unknown input. |
| D4 | 227 snap rows with NULL `gsis_id` — orphaned from the player dimension. Gate was `≥95%`, passed at 99.93%. | B1, all 227 itemized | `build_pfr_to_gsis(players, rosters, player_stats)`; delete the percentage gate, assert zero. |
| D5 | 1,482 player ids referenced by fact tables absent from `player` (1,590 rows in `roster_season`, 1 in `depth_chart`). | B5 | `build_player_dimension()` → 26,517 rows, 0 orphans. |
| D6 | `depth_chart` missing the entire 2025 season — 554,215 rows excluded on a false premise (they carry `dt`, `espn_id` 100%, `gsis_id` 98.9%). | B3: shape split is clean and total, 552,514 A / 554,215 B, zero ambiguous | Adopt B3's module + DDL. Table goes 552,514 → **1,106,729**. All shape-B rows land in season 2025 via a game-calendar dead-zone midpoint; nearest snapshot is 70 days from the boundary, so it is not a judgement call. |
| D7 | `snap_count.pfr_game_id` holds the *nflverse* game id, not PFR's. Mislabelled column. | B4 C3 | Rename or populate correctly. |
| D8 | **`depth_chart.week` is a continuous 1–22 counter, not a regular-season week.** Any join to `game` on `(season, week)` is silently wrong. | Verified: 26,532 REG rows sit past their season's final REG week; POST rows carry weeks 18–22; an `SBBYE` type carries NULL weeks | Re-encode to the schema's `week` / `playoff_round` convention, matching `game`. |

| D9 | **`espn_event_id` collision.** `301114022` is stored on both `2010_10_HOU_JAX` and `2010_10_SEA_ARI`. ESPN says that id is ARI/SEA; HOU/JAX is `301114030`. Upstream nflverse error — the bad value appears twice in `nfl-unified-2010-2026/games.json` too, so the merge did not introduce it. | A2, confirmed against ESPN `summary` for both ids | Correct `2010_10_HOU_JAX` → `301114030`, as a stamped correction with the prior value asserted. **Add a UNIQUE constraint on `espn_event_id`** — the audit tells everyone to join on this key, so a collision must be impossible, not merely absent. |

| D10 | **All 2026 neutral-site games flagged `location='Home'`** — 9 international + Super Bowl LXI. Inverts home-field on 10 games of the season being bet. | Verified: 2026 has **0** `Neutral` rows vs 8 in 2025, 7 in 2024, 6 in 2023. `2026_POST_SB_401873270` reads `Home`. A Super Bowl is neutral by definition. | Set `location='Neutral'` from `venue_id` for all 10. **Add a check that every SB row is Neutral** and that each season's neutral count is non-zero. |
| D11 | **All 285 2026 rows set `gameday` from the UTC date; 91 land a day late.** | A1 E5 | Derive `gameday` from `kickoff_utc` in the venue's local zone, per the project's kickoff-datetime convention. |
| D12 | 5 London 09:30 ET games stored +12h → wrong calendar day; 2 Arizona kickoffs wrong. | A1 E2/E3, third-sourced to Wikipedia BST/GMT times | Correct the 7 kickoffs with prior values asserted. |
| D13 | 7 of 2025's international games record the **home team's** stadium / `stadium_id` / `roof` / `surface` instead of the actual venue. 5 carry weather of unverifiable provenance. | A1 E6 | Correct venue attributes. **Do not patch the weather** — rule 1; flag as unverifiable. |

### Systematic differences — DB is right, do NOT "fix" (A1)

- ESPN's `neutralSite` is unpopulated pre-2014 and for relocations → never backfill `location` from ESPN.
- nflverse stores the *scheduled* slot, ESPN the *observed* kickoff → 32 weather-delay rows, both correct.
- ESPN retro-renames venues → 8 rows, both correct.

| D14 | **Overloaded NULLs in `team_game`.** `covered IS NULL` means *push* **or** *no line* (762 = 218 + 544); `won IS NULL` means *tie* **or** *unplayed* (570 = 26 + 544). | Verified. The trap demonstrated: a naive ATS win-rate reads **45.89%** where the correct answer is **50.00%** — the 544 unplayed 2026 rows masquerade as losses and look like a profitable fade signal. | Add explicit `ats_result` / `ou_result` / `su_result` TEXT columns, CHECK-constrained to `W`/`L`/`P`(/`T`), NULL **only** where genuinely unpriced or unplayed. Stop encoding three states in a boolean. |
| D15 | **34 stale `rest_days`** across 17 games — nflverse computes rest against *originally scheduled* dates. `2022_18_NE_BUF` and `2022_18_BAL_CIN` store 6 days when BUF and CIN had actually been idle 15 after the abandoned Hamlin game. | A4 EX-03 | Recompute from actual played kickoffs. Rest is a modelling feature; actual rest is the true value. Keep the upstream value in a separate column so the divergence stays visible. |

### A5 — upstream source defects (loader is clean: 286,843 + 324,611 rows reproduce byte-exactly)

| # | Defect | Evidence |
|---|---|---|
| D16 | **4 Super Bowls have every snap row on the wrong team** (SB XLIX, 50, LIII, LV) — 358 rows. | Verified on SB LV `2020_21_KC_TB`: Brady 67 snaps and Gronkowski 59 under **KC**; Mahomes 75 and Kelce 69 under **TB**. |
| D17 | **nflverse duplicates plays** in `2011_13_DET_NO` and `2011_10_DET_CHI` — 10 players inflated. Brees 26/36/342 → 29/39/401; Ingram and K. Smith each gain a **phantom rushing TD**. | Convicted three ways: score reconstruction, ESPN, nfl.com official PBP. |
| D18 | `player.pfr_id` swapped between the two **Jonah Williamses** — 146 snap rows on the wrong man. | A5 D5 |
| D19 | 13 Tampa Bay 2020 stat lines keyed to a 2024 rookie OL instead of the safety. | A5 D2 |
| D20 | **`snap_count.season_type` uses a different vocabulary than `game`** — it stores `SB`/`WC`/`DIV`/`CON` where `game` stores `POST` + `playoff_round`. Any snap↔game join on `season_type` silently returns zero rows. | Found while verifying D16: `WHERE season_type='POST'` returned nothing for SB LV. Same class of defect as D8. |
| D21 | Snap counts start in **2013** — 52,386 stat rows (2010–2012) have no usage signal at all. Not a defect, but a hard modelling boundary that must be documented, not discovered. | A5 |

**Open risk A5 could not close:** non-scoring play duplication is undetectable league-wide because
`nfl.db` stores **no team offensive yardage** to reconcile against. `2011_10_DET_CHI` was found by
chance sampling. Adding team-game yardage totals would make this class of error detectable.

**Targets — ESPN and nflverse genuinely differ, do not "fix":** ESPN omits zero-reception targets
entirely (7,600 rows league-wide) and sometimes charges an incompletion to a different receiver.
584/598 sampled team-games agree on the total; only 10 rows are genuine disagreements.

### Contradictions — recorded, NOT resolved (rule 4)

- **`2021_10_DET_PIT`**: DB has PIT −9.0 / −359; SportsOddsHistory says −6 and all 16 pre-game ESPN
  providers say −5.5/−6 at ML ≈ −250. Probable upstream error. **Not silently changed** — owner call.
- **`2020_01_LV_CAR`**: moneylines imply a 0.9809 overround, i.e. a arbitrage. Away −124 vs
  −148…−159 at all 10 ESPN books. Spread and total are fine.
- **Bills Toronto Series** (4 games): stored 3× `Home` / 1× `Neutral` at the same venue. ESPN cannot
  arbitrate (its neutral flag is unpopulated pre-2014). Needs a contemporaneous-source ruling.

## Coordinator corrections (S1 audited this ledger; these are my errors)

- **D3 was overstated.** I wrote that 92 rows "would have loaded team-less." `player` has no
  `latest_team` column — only `draft_team` — and there are 0 NULL franchise ids. The `AZ` alias gap
  is real in the *source* feed but **latent, not live**. Severity drops accordingly.
- **D21 was miscategorised.** I called the 2010–2012 snap gap "not a defect." S1 is right that it is
  a defect for 2012, where snap data exists upstream.
- **D1 was understated.** The postseason join failure also NULLs `spread_line` and `total_line` on
  all 12,050 POST rows, not just the game context.

### Newly found — structural, and nobody's task covered them

| # | Defect | Evidence |
|---|---|---|
| D22 | **`PRAGMA foreign_keys = 0`.** SQLite disables FK enforcement by default and it is a *per-connection* setting, never persisted in the file. Every FK declared in `schema.sql` is decorative. All prior "referential integrity" claims rest on constraints that never fired. | Verified: `PRAGMA foreign_keys` → `0`, while `player_game_stats` declares 3 FKs and `snap_count` / `roster_season` / `depth_chart` declare 1 each. |
| D23 | **Three of the largest tables have no primary key**: `snap_count` (324,611), `roster_season` (43,856), `depth_chart` (552,514). Duplicate rows are structurally possible. | Verified via `pragma_table_info` — 0 columns with `pk>0`. |
| D24 | `roster_season` payload never audited by anyone; its semantics were mis-stated by both A3 and A5. No index on `player.espn_id`. `SBBYE` season attribution unresolved. | S1 coverage-gap analysis |

### Corroboration strength (S1) — read findings with this caveat

**4 of 5 cross-confirmations are correlated, not independent.** The Super Bowl transposition and the
Jonah Williams swap share a detector; **Jalen Davis rests on a single `GROUP BY … HAVING` with no
external source at all — its cause remains a hypothesis**; and A1/A2 reached `301114030` by the same
id-encoding heuristic, not by different routes (it is safe only because both then hit ESPN directly).
Only Mike Edwards is genuinely part-independent. Treat the rest as one finding each, not two.

### The four assumed −110 values (S1 flags as a live rule-1 violation)

S1 is right that four fabricated juice values sit in `game_line` today in the same columns as
observed prices. **This was an explicit owner instruction**, is stamped `oddsSource =
'manual-2026-07-27'`, and is documented in the extract manifest — so it stays. But S1's point stands
that isolation depends on every consumer filtering `oddsSource = 'nflverse'`, which nothing enforces.
Recommend a generated column or view that makes observed-only the default path.

## Decisions taken

- **Split identities (B5, 10 cases — one human, two `gsis_id`s):** do **not** rewrite ids in fact
  tables. Rewriting breaks byte-level reconciliation against nflverse, which every reproducibility
  check rests on. Add a `canonical_gsis_id` column on `player` plus a `CANONICAL_GSIS` map; keep
  source ids intact. Reversible; preserves both fidelity and correct aggregation.
- **The 341 missing stat rows (B4): legitimate exclusion, confirmed.** All have `player_id = ''` —
  nflverse's per-week team-level residual bucket (exactly one per season-week: 11×21 + 5×22 = 341).
  Payload is penalties and safeties. Actual data forfeited: **11 receiving yards** (2012 wk 6).
  A NULL player id cannot be stored in a player fact table. Document, do not "fix".
- **Source contradictions are recorded, never silently resolved** (B1's two pfr-id disagreements,
  B2's `player_stats` era-label inconsistency). They live in exported constants with evidence.

## Open — needs the remaining agents

- B3's depth-chart DDL and the season/week derivation rule for offseason snapshots.
- Whether `players.csv` `latest_team` / `draft_team` become resolved franchise columns (B2). If yes,
  the `HOU`≤1996 → fid 10 and `BAL`≤1983 → fid 11 season-gating becomes mandatory.
- 190 unsourceable `pfr_id` and 17 `espn_id` (B5) — confirm each is genuinely absent upstream.
- All five A-agent verdicts against ESPN / NFL.
