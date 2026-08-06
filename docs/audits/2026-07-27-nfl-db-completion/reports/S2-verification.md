# S2 — independent verification of the ten agents

## Verdict

**PASS WITH EXCEPTIONS** — the job's *data* findings are sound and reproduce independently
(38 claims re-derived, 0 data claims refuted), but **5 reporting claims are refuted**, **6 are
unsupported by shipped evidence**, and **3 shipped checks pass on deliberately broken data**.

Database integrity: `nfl.db` md5 `1d2b0bea3e85edf467ef446db807bc7d` — **identical to
`nfl.db.pre-completion-backup` at both the start and the end of my work.** No agent modified it.

## What I checked

Full adversarial pass in four stages. (1) Ran all ten shipped executables and re-ran them from a
foreign cwd. (2) Perturbed **seven** classes of value on scratch copies of the database and on a
scratch copy of `snap_counts.csv`, and recorded which checks caught them. (3) Re-derived every
headline number myself from `nfl.db` and the raw CSVs with my own implementations, never reusing an
agent's code. (4) Spot-checked ESPN with a **stratified 18-game sample chosen from the 4,041 final
games no other agent had cached**, plus the three named targets.

The real database was opened `mode=ro` throughout. All mutation happened in
`/private/tmp/.../scratchpad/s2/`. My ESPN responses are cached under `cache/s2/` (26 files,
sequential, 1.2 s sleep).

## Results

### 1. Every verifier runs. None is unrunnable.

| Executable | Exit | Notes |
|---|---|---|
| `lib/team_aliases.py` | 0 | 2,446,721 values resolved, 6 sources |
| `lib/snap_crosswalk.py` | 0 | 324,611/324,611 rows resolved |
| `lib/depth_charts.py` | 0 | shape split reproduced |
| `lib/rowloss.py` | 0 | every source row loaded or manifested |
| `lib/player_dimension.py` | 0 | 26,517 rows, 0 orphans |
| `verify/a1_games_espn.py --no-network` | 1 | FAIL by design (120 itemised defects) |
| `verify/a2_franchise.py --offline` | 1 | FAIL by design (1 mismatch) |
| `verify/a3_players.py` | 1 | fatal by design |
| `verify/a4_lines.py` | 0 | 77/77 checks, 61 registered exceptions |
| `verify/a5_stats.py --offline` | 1 | FAIL by design (defects held open) |

All five `lib/` modules are **cwd-independent** (re-run from `/Users/danielwalker`, all exit 0).
All five verifiers run **fully offline from the shipped cache** — no verifier depends on live
network. A1 and A3 are **deterministic**: re-running them produced byte-identical stdout.

### 2. Testing the tests — perturbation results

**Checks that correctly caught deliberate corruption:**

| Perturbation | Check | Result |
|---|---|---|
| `covered` 1→0, `won` 1→0, `margin` +3, `moneyline`→−9999 | A4 | **Caught all four**, itemised, exit 1; also tripped 3 mirror-consistency checks and the SportsOddsHistory cross-check |
| 3 home/away franchise swaps + 1 fid-only change | A1 | **Caught all four**, including the subtle fid-only change; verdict flipped to "unexplained differences remain" |
| `game.home_abbr` → wrong team | A2 | **Caught** — C7 mismatches 0→1 |
| `receiving_yards` +7, `passing_yards` −13, `offense_snaps` +5 | A5 | **Caught** — IC-11 0→2, IC-12 0→2, each itemised `db=` vs `csv=` |
| unmappable `pfr_player_id` injected into `snap_counts.csv` | B1 | **Caught** — exit 1, itemised |
| `resolve()` on `XXX` / `''` / `None` / `'ari'` / `'ARIZ'` | B2 | **Raises `UnknownTeamAbbr` on every one.** Era-split `STL`/`BAL`/`HOU` correctly refuse to resolve without a season |

**False-confidence defects — checks that PASSED on deliberately broken data:**

- **F1 (severe). B1's self-check never opens the database.** I set a `snap_count.gsis_id` to NULL
  (227→228 NULLs) and `lib/snap_crosswalk.py` still printed
  `OK every snap_counts row resolves to a gsis_id`, exit 0. `grep -c sqlite3 lib/snap_crosswalk.py`
  → 0. Its "227/227 resolved, zero remaining" is a **projection of an unapplied fix**, not a
  statement about `nfl.db`. The database still has 227 NULLs today. This is the exact shape of the
  original "99.93% passed the gate" failure.
- **F2 (moderate). B5 silently shrinks its own denominator.** The same perturbation moved B5's
  `snap_count` row count 324,384 → 324,383 with no warning and a `PASS`. The orphan queries are
  `WHERE gsis_id IS NOT NULL` (`lib/player_dimension.py:629`). Disclosure is adequate in the B5
  report, but **combined with F1 no shipped check anywhere asserts that `snap_count.gsis_id` is
  non-NULL in the database** — D4's own defect class is unguarded.
- **F3 (moderate). A3's gate ignores coverage.** I changed one `player.espn_id` to `9999999`.
  `verified` fell 16,765 → 16,764, `misses` stayed 5, **nothing was flagged and the exit code did
  not change**. `fatal` (`verify/a3_players.py:1223`) tests hard mismatches, key dupes, dup persons,
  swaps, career windows and snap anomalies — **not** whether every `espn_id`-bearing player was
  actually verified. An id that silently stops resolving at ESPN will never fail this gate.

Credit where due: **A3 ships its own negative control** (`--selftest`): 4,000 random wrong athletes
→ 4,000 MISMATCH, and 3,992 same-surname wrong athletes → 0 false passes. That is exactly the
discipline the rest of the job needs.

### 3. Independently re-derived headline numbers

Every figure below was recomputed by me from `nfl.db` and `raw/*.csv` with my own code.

| Claim | Claimed by | My re-derived value | Status |
|---|---|---|---|
| 227 snap rows with NULL `gsis_id`; 30 distinct pfr ids | B1 / D4 | 227 rows, 30 ids | **VERIFIED** |
| None of the 30 resolvable by direct `pfr_id` lookup | B1 | 0 of 30 resolvable directly | **VERIFIED** |
| 227/227 resolve; tiers 12 name-prefix + 7 era + 11 manual | B1 | tiers sum to exactly 30 = the 30 orphan ids | **VERIFIED** |
| All 227 rows corroborated on season+week+team | B1 | **227/227** against cached `nflverse_roster_weekly_*.csv` | **VERIFIED** |
| depth_chart 552,514 A + 554,215 B = 1,106,729, 0 ambiguous | B3 / B4 / D6 | 552,514 + 554,215 = 1,106,729, ambiguous **0** | **VERIFIED** |
| 341 missing `player_game_stats` rows, all `player_id=''` | B4 | 287,184 − 341 = 286,843 = table count | **VERIFIED** |
| 341 = 11×21 + 5×22, exactly one per season-week | B4 | 341 buckets, **0** with more than one | **VERIFIED** |
| Only real loss is 11 receiving yards (2012 wk 6) | B4 / A5 D1 | 11 rec yds, 2 rec, 2 tgt, 17 air yds — D.Bryant 2012 wk6 | **VERIFIED** (see EX-6) |
| All 9,270 `team_game` derived values recompute exactly | A4 | **0 mismatches / 139,050 value comparisons** | **VERIFIED** |
| `covered` NULL 762 = 544 + 218; `won` NULL 570 = 544 + 26 | D14 | 762 = 544 + 218; 570 = 544 + 26 | **VERIFIED** |
| Naive ATS 45.89% vs correct 50.00% | D14 | 45.89% / 50.00% | **VERIFIED** |
| 16,765 of 16,768 `espn_id`-bearing players verified | A3 | 16,768 bearing; 16,765 verified; 3 = the 3 ESPN 404s, itemised | **VERIFIED** |
| All 286,843 stat rows reproduce their CSV byte-exactly | A5 | **0 differences / 6,884,232 comparisons** (24 shared cols) | **VERIFIED** |
| All 324,611 snap rows reproduce byte-exactly | A5 | **0 differences / 1,947,666 comparisons**, incl. team→franchise_id | **VERIFIED** |
| 4 Super Bowls transposed, 358 rows | D16 | 88+89+90+91 = **358**; all other SBs correct | **VERIFIED** |
| 146 snap rows on the wrong Jonah Williams | D18 | 67 + 79 = **146**; snap teams and roster teams perfectly crossed | **VERIFIED** |
| 13 TB 2020 stat lines on a 2024 rookie OL | D19 | 00-0039472: 13 stat / 0 snap; 00-0035681: 0 stat / 20 snap | **VERIFIED** |
| 52,386 stat rows with no snap signal (2010–12) | D21 | 52,386; snaps span 2013–2025 | **VERIFIED** |
| `v_player_game`: all 12,050 POST rows NULL game context | D1 | POST 12,050 / 12,050 NULL; REG 0 | **VERIFIED** |
| Snap fan-out: 274,794 view rows vs 274,793 base | D2 | 274,794 vs 274,793, delta 1 | **VERIFIED** |
| 1,590 `roster_season` + 1 `depth_chart` orphans, 1,482 ids | D5 | 1,590 + 1 = 1,591 rows, 1,482 distinct ids | **VERIFIED** |
| `depth_chart.week` is a 1–22 counter | D8 | range 1–22 vs `game` REG max 18; 30,195 rows >18 | **VERIFIED** |
| `snap_count.pfr_game_id` holds the nflverse id | D7 | DB `2013_01_ARI_STL` vs CSV `201309080ram` | **VERIFIED** |
| `snap_count.season_type` uses `SB`/`WC`/… not `POST` | D20 | SB LV rows carry `SB`; `WHERE season_type='POST'` → **0 rows** | **VERIFIED** |
| 2026 has 0 neutral rows vs 8/7/6 in 2025/24/23 | D10 | 2026 = 0; 2025 = 8, 2024 = 7, 2023 = 6 | **VERIFIED** |
| `301114022` is the only `espn_event_id` collision | D9 | exactly 1 collision; 4,647 distinct of 4,648 | **VERIFIED** |
| The bad id is upstream in `games.json`, not the merge | D9 | `espnEventId` `301114022` appears **twice** in games.json | **VERIFIED** |

### 4. My own ESPN spot-checks

The three named targets, confirmed against ESPN directly (responses in `cache/s2/`):

- **`2010_10_HOU_JAX` event id (D9).** ESPN `301114022` = **SEA 36 @ ARI 18**, State Farm Stadium.
  ESPN `301114030` = **HOU 24 @ JAX 31**, EverBank Stadium. The DB row stores scores 24–31 and
  franchise ids 34/30 — i.e. **the DB's game data matches `301114030` exactly and only the id is
  wrong.** Confirmed, and confirmed to be an upstream `games.json` defect.
- **2026 Super Bowl neutral-site flag (D10).** ESPN `401873270`: `neutralSite=**True**`, venue
  SoFi Stadium **id 7065**. The DB row `2026_POST_SB_401873270` stores `venue_id = 7065` — the same
  venue — but `location = 'Home'`. Confirmed.
- **Super Bowl LV snap transposition (D16).** ESPN `401220403`: home **TB 31**, away **KC 9**.
  In `snap_count`: Brady 67, Gronkowski 59 and Mike Evans 54 sit under **franchise 12 (KC)**;
  Mahomes 75, Kelce 69 and Tyreek Hill 69 sit under **franchise 27 (TB)**. Complete transposition,
  confirmed independently.

**My independent 18-game sample** (one game per season 2010–2025 plus 3 postseason, all drawn from
games no other agent had cached): **18/18 clean** on score, kickoff date and neutral-site flag. No
new defect class emerged outside the itemised set.

### 5. What the numbers hide

Confirmed by re-derivation, not by reading:

- **A1's `venue_id` row reads `4,648 | 4,648 | 0`.** `venue_id` is non-NULL on **273 rows**
  (2026 only); 4,375 NULLs were counted as agreeing. A1 *does* disclose this in prose
  ("`venue_id` is NULL on 4,375 rows") and labels the row "(where populated)" — but the tabulated
  denominator is still inflated 17×, and line 239 restates "the `venue_id` check passed 4,648/4,648"
  **without** the qualifier, using the inflated figure to support defect E4.
- **A2 says "Full population, not a sample", but C9 is 1,311 of 4,648 rows (28.2%).** I re-derived
  1,311 = the REG-only game count across exactly 2015/2017/2020/2022/2026. **All 201 postseason
  rows are excluded and the report never says so.**
- **A1's verdict arithmetic is wrong.** The per-field table's Differ column sums to **176**
  (0+0+0+0+1+1+0+40+1+1+0+26+0+15+0+91) and the report's own split is 56 explained + 120 confirmed
  = **176**. The verdict states **172**.
- **A5's report and A5's executable disagree.** The report says "Seven confirmed defects and four
  unresolved source disagreements. Every one is itemized." The shipped script prints
  `TOTAL UNRESOLVED: 430` and `flagged 182 (explained 124, unexplained 58)`. Neither 430 nor the
  58 unexplained ESPN disagreements appear in the report. **The executable is the more conservative
  artifact.**
- **A5's byte-exactness is column-scoped, and says so**: "286,843 × 21 cols", "the loader keeps 21
  of the source's 145 columns". True and disclosed; the 21 are never enumerated by name.
- **A5's 299-game ESPN sample is the best-disclosed in the job** — "This is 299 of 4,363 final
  games — 6.85%. It is not full coverage and nothing below should be read as full coverage."
- **Itemization audit** (counted from the reports' own tables):

| Report | Claimed | Actually itemised | Verdict |
|---|---:|---:|---|
| B1 | 227 rows | **227** | complete |
| B3 | 34 unresolved espn_ids | **34** | complete |
| B4 | 341 excluded rows | **341** | complete |
| B5 | 1,482 orphans / 190 no-pfr | **1,482 / 190** | complete |
| A3 | 54 MISMATCH / 870 collision sets / 3 unfetched | **54 / 870 / 3** | complete |
| A2 | 2 exceptions | **2** | complete |
| A1 | 120 defects across 114 rows | **~50 game_ids named** | **incomplete** |
| A4 | 61 exception rows | **~27 identified** | **incomplete** |
| A5 | row-level exception lists | deferred to script constants | **incomplete** |

  A1's E5 (91 rows, 80% of its defect population) exists only in
  `cache/a1/out/a1_result.json` — which holds 199 distinct game_ids against 50 in the report, and
  is **gitignored**. A4's EX-03 (34 rest_days rows) is deferred to `REST_EXCEPTIONS` inside
  `a4_lines.py`.

## Exceptions

Every item below is a defect in the *verification work*, not in the database.

- **EX-1 — B1's self-check cannot fail on a broken database.** `lib/snap_crosswalk.py` contains no
  `sqlite3` reference. Verified: NULLing a `snap_count.gsis_id` leaves it exit 0.
  *Cause:* source-side scope. *Fix:* the loader-side assertion in D4 must be a DB assertion.
- **EX-2 — No shipped check asserts `snap_count.gsis_id IS NOT NULL`.** B1 does not read the DB;
  B5 filters NULLs out of its denominator. The D4 defect class is unguarded post-integration.
- **EX-3 — A3's `fatal` gate omits coverage.** Verified: a corrupted `espn_id` reduced `verified`
  by one with no flag and no exit-code change. *Fix:* add `verified == has_espn_id or every gap is
  in misses.json` to `fatal`.
- **EX-4 — A1's verdict says 172; its own table and its own 56+120 split both say 176.**
- **EX-5 — A1's `venue_id` denominator is 273, tabulated as 4,648**, and restated unqualified at
  line 239 in support of E4.
- **EX-6 — B4's "payload is penalties and safeties" understates the 341 rows.** My re-derivation of
  the aggregate payload also finds **120 def_tackles_solo, 53 punt_return_yards, 27 def_sack_yards,
  6 def_sacks, 3 def_qb_hits, 3 def_fumbles_forced**. The *decision* (drop rows with a NULL player
  id) is right and the receiving-yards figure is right; the characterisation is incomplete.
- **EX-7 — A2's "Full population, not a sample" is false for C9** (1,311 of 4,648 = 28.2%,
  regular season only, postseason exclusion undisclosed).
- **EX-8 — A5's report claims complete itemization; A5's script reports 58 unexplained ESPN
  disagreements and 430 total unresolved.** The report should carry the script's numbers.
- **EX-9 — B1's evidence table marks 6 files "In git: yes". All 6 are gitignored.** Verified with
  `git check-ignore` on `resolution_table.csv`, `weekly_roster_evidence.csv`,
  `row_verification.json`, `orphan_snap_rows.json`. `cache/b1/.gitignore` repeats the false claim
  ("The distilled, reviewable extracts ... ARE committed").
- **EX-10 — nothing in this job is in version control.** `git ls-files scripts/data/nfl-db` → **0
  files**. `nfl.db` is caught by `*.db`; `raw/` and `cache/` are ignored wholesale. The `lib/` and
  `verify/` sources are **not** ignored — merely untracked, so they can and should be committed.
  Until then no claim in any of the eleven reports is reproducible from a clean clone.
- **EX-11 — cache frames do not reconcile to stated samples.** `cache/a5` holds **308**
  `summary_*.json.gz` against a stated 299-game frame; `cache/a4/espn` holds **220** odds files
  against a stated 215-game sample. Both are over-fetches, harmless, but neither ties out.
- **EX-12 — two derived cache files were rewritten during my own perturbation runs** and restored.
  `cache/a3/verify_result.json` and `cache/a1/out/a1_result.json` are written through
  `__file__`-relative paths, so a mirrored tree with a symlinked cache writes back to the real one.
  I restored both by re-running the real scripts against the real database and confirmed the
  stdout is **byte-identical** to my clean baselines (`all_players.verified` back to 16,765).
  Flagged so nobody mistakes the mtimes for tampering. *Both verifiers are deterministic, which is
  what made the restore provable.*

### Two false passes I produced myself, reported as method warnings

Both are the same defect class this job exists to find, and both are worth guarding against in the
integrated loader:

1. My first snap_count byte-comparison joined on `pfr_game_id`, matched **nothing**, and still
   printed "ZERO differences". Cause: D7 — the column holds the nflverse id. **A join that matches
   zero rows must be an assertion failure, not a pass.** I added `assert matched > 0` and re-ran.
2. My first `games.json` collision sweep looked for `espnId`/`espn_event_id` and found no
   duplicates, appearing to refute D9. The real key is `espnEventId`. D9 is correct.

## Reproduce

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai/scripts/data/nfl-db

# 0. integrity (must match at start and end)
md5 nfl.db nfl.db.pre-completion-backup        # 1d2b0bea3e85edf467ef446db807bc7d

# 1. every shipped executable
for f in team_aliases snap_crosswalk depth_charts rowloss player_dimension; do
  python3 lib/$f.py; echo "$f -> $?"; done
python3 verify/a1_games_espn.py --no-network;  echo "a1 -> $?"
python3 verify/a2_franchise.py --offline;      echo "a2 -> $?"
python3 verify/a3_players.py;                  echo "a3 -> $?"
python3 verify/a4_lines.py;                    echo "a4 -> $?"
python3 verify/a5_stats.py --offline;          echo "a5 -> $?"
python3 verify/a3_players.py --selftest        # A3's own negative control

# 2. cwd-independence
cd /Users/danielwalker && for f in team_aliases snap_crosswalk depth_charts rowloss player_dimension; do
  python3 /Users/danielwalker/src/ai-sports-betting-dime-ai/scripts/data/nfl-db/lib/$f.py >/dev/null; echo "$f -> $?"; done

# 3. perturbation (NEVER on the real db)
S=/tmp/s2 && mkdir -p $S && cp nfl.db $S/p.db
sqlite3 $S/p.db "UPDATE team_game SET covered=0 WHERE game_id='2018_01_ATL_PHI' AND franchise_id=21;"
python3 verify/a1_games_espn.py --no-network --db $S/p.db     # A1 accepts --db
# A4/A5/A2/A3 resolve the db from __file__; mirror lib/ + verify/ into a scratch tree,
# COPY (do not symlink) cache/a1, cache/a3 to avoid writing back into the real cache.

# 4. B2 strictness
python3 -c "import sys;sys.path.insert(0,'lib');import team_aliases as T
for a in ['XXX','',None,'ari','ARIZ']:
  try: print(a,'->',T.resolve(a))
  except Exception as e: print(a,'RAISED',e)"

# 5. the three named ESPN checks (cached under cache/s2/)
for e in 301114022 301114030 401873270 401220403; do
  curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=$e" \
   | python3 -c "import json,sys;d=json.load(sys.stdin);c=d['header']['competitions'][0]
print([(x['homeAway'],x['team']['abbreviation'],x.get('score')) for x in c['competitors']], c.get('neutralSite'), d['gameInfo']['venue']['fullName'])"
  sleep 2; done

# 6. the itemization audit
git ls-files scripts/data/nfl-db | wc -l                      # 0
git check-ignore -v scripts/data/nfl-db/cache/b1/resolution_table.csv
```

Re-derivation scripts for the headline numbers are inline in this session's transcript; each is a
short standalone `python3 - <<'PY'` block reading `nfl.db` with `mode=ro` and the CSVs in `raw/`.

## Bottom line for the coordinator

**The data findings can be trusted.** D1–D21 all re-derive exactly; I could not refute a single
one, and my independent ESPN sample found nothing new. The four defects most likely to corrupt a
model — the SB snap transposition, the overloaded `covered`/`won` NULLs, the event-id collision and
the 2026 neutral-site inversion — are real, correctly scoped and correctly attributed to upstream
where upstream is at fault.

**The reporting needs three corrections before this is published** (A1's 172→176 and its
`venue_id` denominator, A2's "full population" claim for C9, A5's report/script divergence), and
**three gates need strengthening before integration** (EX-1/EX-2 snap NULL assertion, EX-3 A3
coverage gate). **EX-10 is the largest structural risk**: none of this work is in git.
