# A4 — betting lines and derived results integrity

## Verdict

**PASS WITH EXCEPTIONS** — every one of the 9,270 `team_game` derived values recomputes
exactly from `game` + `game_line` with zero arithmetic disagreements, the home/away sign
convention and push handling are confirmed against an independent archive on all 4,363
priced games, and the only line-level defects found are 34 stale `rest_days` values, two
overloaded NULL columns, and four individually-adjudicated bad prices — all itemized below.

---

## What I checked

**Full population, no sampling, for everything internal.** 9,270 `team_game` rows,
4,363 `game_line` rows, 4,648 `game` rows. Every derived column was recomputed from
scratch inside `scripts/data/nfl-db/verify/a4_lines.py` — from `game.away_score` /
`game.home_score` and `game_line.spread_line` / `total_line` / moneylines — and compared
to what the loader wrote. `build_db.py`'s arithmetic was read only to know what conventions
to *test*, never used as the expected value.

**External cross-checks (both cached under `scripts/data/nfl-db/cache/a4/`, 2.4 MB gzipped):**

| Archive | Coverage | Purpose |
|---|---|---|
| SportsOddsHistory (`covers.com/sportsoddshistory/nfl-game-season/?y=YYYY`) | **all 16 seasons, all 4,363 games** | independent spread / total / favourite / score / ATS+O-U result |
| ESPN core API `.../events/{id}/competitions/{id}/odds` | 215-game stratified + targeted sample (8 random per season × 16 + 87 targeted), **190 returned odds**, 1,671 provider quotes | multi-book adjudication of every disputed and extreme line |
| ESPN site API `summary?event=` | 2 games | scoring-play level adjudication |
| nflverse `nfldata/data/games.csv` | all 7,548 upstream rows | transport check — proves the loader corrupted nothing and isolates the manual patch |

Pro-Football-Reference was attempted and **returns HTTP 403** to scripted requests
(`https://www.pro-football-reference.com/boxscores/201311240htx.htm` → 403, 5,861 bytes).
ESPN's multi-provider odds feed replaced it and is strictly better for this job because it
carries spread, total *and* both moneylines per book.

**Result: 77/77 checks pass. `a4_lines.py` exits 0; `a4_lines.py --strict` exits 1
because registered exceptions exist.**

---

## Results

### 1. Sign conventions — proved, not assumed

`game_line.spread_line` is stated from the **home** team's perspective (positive = home
favoured = the home team's expected margin of victory). Four independent proofs:

| Test | Value | If the sign were inverted |
|---|---|---|
| `corr(game.result, spread_line)` | **+0.4312** | −0.4312 |
| `mean(result − spread_line)` (ATS margin) | **+0.0833** | +4.1615 |
| `corr(spread_line, de-vigged home win prob)` | **+0.9883** | −0.9883 |
| home spread-favourites winning outright | **1862/2770 = 67.2%** | 32.8% |
| away spread-favourites winning outright | **1023/1588 = 64.4%** | 35.6% |

`team_game.spread` is that team's perspective: `+spread_line` on the home row,
`−spread_line` on the away row. **Verified on all 8,726 priced rows — 0 disagreements**,
and every game's two rows are exact negatives of each other (`a.spread = −b.spread`, 0
violations).

`total_line` is likewise not inverted: `corr(game.total, total_line) = +0.3051`,
`mean(total − total_line) = +0.5238`.

### 2. Derived columns — full recomputation, 9,270 rows

| Recomputed column | Disagreements |
|---|---|
| `franchise_id` / `opponent_id` side assignment | **0** |
| `points_for` / `points_against` | **0** |
| `margin` (= own score − opponent score, from `game`) | **0** |
| `won` (sign of margin) | **0** |
| `spread` (team perspective) | **0** |
| `covered` (margin vs spread) | **0** |
| `total_line` carried through | **0** |
| `moneyline` mapped to the right side | **0** |
| `rest_days` vs `game.away_rest`/`home_rest` | **0** |
| `game_number` gapless 1..n per team-season (544 team-seasons) | **0** |
| `game_number` chronological by `kickoff_utc` | **0** |
| `game_number` vs week / playoff-round order | **0** |
| two sides mirror each other (margin, spread, points) | **0** |
| a game with two winners, two losers, or two coverers | **0** |
| games without exactly two `team_game` rows | **0** |

### 3. Ties — 13 games, none counted as a loss

There are exactly **13 tie games** in 2010–2025 (26 `team_game` rows). Every one has
`won IS NULL`. `SELECT COUNT(*) FROM team_game WHERE margin = 0 AND won = 0` → **0**, and
`... AND won = 1` → **0**. Ties are *not* silently losses.

`2012_10_STL_SF`, `2013_12_MIN_GB`, `2014_06_CAR_CIN`, `2016_07_SEA_ARI`, `2016_08_WAS_CIN`,
`2018_01_PIT_CLE`, `2018_02_MIN_GB`, `2019_01_DET_ARI`, `2020_03_CIN_PHI`, `2021_10_DET_PIT`,
`2022_01_IND_HOU`, `2022_13_WAS_NYG`, `2025_04_GB_DAL`.

Note that `covered` is still correctly *set* on tie rows (margin 0 vs the spread is a
normal comparison), e.g. `2013_12_MIN_GB` GB `spread=+6.0 margin=0 covered=0`, MIN
`spread=−6.0 margin=0 covered=1`.

### 4. Pushes — enumerated and represented distinctly

| Market | Pushes | Representation |
|---|---|---|
| ATS (`margin == spread`) | **109 games / 218 rows** | `team_game.covered IS NULL`; `v_backtest.ats_winner = 'push'` |
| Totals (`game.total == total_line`) | **45 games** | `v_backtest.total_result = 'push'` |

Cross-consistency checks, all zero: every `v_backtest` push is a `covered IS NULL` pair in
`team_game` (0 violations); no non-push priced game has a NULL `covered` (0 violations);
`v_backtest` partitions cleanly — ATS home 2091 + away 2163 + push 109 = 4363, totals over
2139 + under 2179 + push 45 = 4363.

**A push is never a loss.** But see EX-01: the *encoding* of a push is ambiguous.

### 5. Line plausibility sweep — every outlier adjudicated

Hard invariants, all clean over 4,363 rows: every spread and total sits on the half-point
grid (0 violations); `|spread| ≤ 27`; `total_line ∈ [28.5, 63.5]`; **no moneyline or juice
value sits strictly inside ±100** (0 violations — the impossible-quote test); no game has
both moneylines positive; spread juice and total juice never imply a negative hold.

**Every |spread| ≥ 18 game, adjudicated individually.** All ten are real.

| Game | DB | SportsOddsHistory | ESPN providers | Verdict |
|---|---|---|---|---|
| `2013_06_JAX_DEN` | **+27.0**, ML +2173/−5000 | DEN −26.5 | 26.5 ×2, 27.0 ×1; teamrankings ML **+2173/−5000 identical** | REAL — the largest closing spread in NFL history |
| `2019_03_MIA_DAL` | +22.0, −2540 | DAL −22 | 21.5 ×5, 22.0, 22.5 ×5 | REAL |
| `2011_13_IND_NE` | +20.5, −2400 | NE −20.5 | *(ESPN has no odds for 2011)* | REAL — SOH exact match |
| `2019_03_NYJ_NE` | +20.5, −1962 | NE −20.5 | 20.5 ×6, 21.0 ×5 | REAL |
| `2021_07_HOU_ARI` | +20.5, −1766 | ARI −18 | 20.0 ×13, 19.5, 20.5 | REAL (SOH low by 2.5) |
| `2020_08_NYJ_KC` | +20.0, −1965 | KC −20 | 19.5 ×8, 20.0, 20.5 | REAL |
| `2013_03_JAX_SEA` | +19.5, −4500 | SEA −20 | 19.5, 19.0, 16.5; teamrankings ML **+2000/−4500 identical** | REAL |
| `2024_18_CLE_BAL` | +19.5, −2400 | BAL −19.5 | ESPN BET 20.5 | REAL |
| `2021_04_HOU_BUF` | +19.0, −1500 | BUF −17.5 | 18.5 ×6, 19.0 ×4, 18.0 ×2, 17.5 ×2, 16.5 | REAL |
| `2019_02_NE_MIA` | −18.0, −1300 | NE −18 | −18.0 ×4, −18.5 ×3, −17.5 ×3 | REAL |

**Extreme totals.** `total_line` max **63.5** (`2018_11_KC_LA`, the 54–51 Monday-nighter) —
SOH 63.5, ESPN 63.0/63.5/64.0. Min **28.5** (`2023_18_NYJ_NE`) — SOH 28.5, ESPN 28.5 ×8.
Both real; nothing falls outside a ~28–65 band.

**Extreme moneylines.** The three largest favourites (−5000, −4500, −2540) belong to the
three largest spreads above and two of the three are byte-identical to ESPN teamrankings.
`2024_15_BAL_NYG` −1800 → ESPN BET −2000. All real.

**Moneylines strictly inside ±100: zero.** **Juice strictly inside ±100: zero.**

### 6. Moneyline / spread coherence

Excluding the 5 true pick'ems (`spread_line = 0`, which can price either side) and the 22
games with two identical moneylines (which name no favourite), **13 of 4,336 evaluable
games** have the moneyline favouring the opposite side to the spread. **All 13 are
`|spread| = 1.0`**
with an implied-probability gap of 0.0–2.4 percentage points — inside the noise of two
quotes on a coin-flip market.

**The decisive test: there is not one single moneyline/spread disagreement on any game with
`|spread| ≥ 2`.** A swapped home/away column would produce hundreds. It produced zero.

Independently, `corr(spread_line, de-vigged home win probability) = 0.9883` and the largest
residual against the median probability at that spread is 0.059 (`2011_15_DET_OAK`,
`spread = −1`).

### 7. External cross-check — SportsOddsHistory, full population

All 16 seasons parsed, **4,363 / 4,363 games matched, 0 unmatched.**

| Test | Result |
|---|---|
| home/away orientation on non-neutral games | **0 disagreements / 4,363** |
| neutral-site games where SOH publishes no `@` marker | 31 — *structurally not applicable*, not a gap |
| final scores | **1 disagreement** (SOH typo, EX-11) |
| **ATS result** where both archives publish the *identical* spread | **0 disagreements / 2,709 games, including 68 pushes** |
| **over/under result** where both publish the *identical* total | **0 disagreements / 2,565 games, including 25 pushes** |
| favourite side disagreements with `|spread| ≥ 2` | 5 (EX-10, all adjudicated in the DB's favour) |

Restricting the result comparison to games where the two archives carry the *same* number
is what makes it a clean test of the arithmetic: it removes source-to-source line variance
and leaves only the sign convention and the push rule. **Both are confirmed on 5,274
independent comparisons with 93 pushes among them.**

Line agreement between the two publishers (this is *variance*, not error):

```
spread delta (SOH − DB):  identical 2709/4363   within 1pt 4101/4363   |delta|>=2 on 139
total  delta (SOH − DB):  identical 2565/4363   within 1pt 4197/4363   |delta|>=2 on  70
```

The delta distribution is symmetric and centred on zero (−0.5: 600, +0.5: 496), exactly
what two different closing-line publishers produce.

### 8. External cross-check — ESPN, multi-book

190 games returned odds across 1,671 provider quotes (excluding the two in-play "Live Odds"
providers). Spread identical to the DB on 847, total on 837. ESPN's `teamrankings` provider
is the closest match (spread 120/152, total 120/152, full moneyline pair 64/152 — several
byte-identical, which suggests a shared upstream and is why ESPN is used here to *adjudicate
disputes* rather than as a wholly independent population check).

**No reputable ESPN provider puts the favourite on the opposite side for any game with
`|spread| ≥ 2`, outside the four registered disputes.** The `Caesars Sportsbook` (generic),
`Opening` and `consensus` rows were excluded as demonstrably unreliable for historical games
— e.g. ESPN's `Caesars Sportsbook` returns `ARI −4.5` with a total of `21.5` for
`2017_14_TEN_ARI` where nine other providers say `TEN −2.5 / 42.0`.

### 9. Coverage — exact, not "approximately"

| Claim | Result |
|---|---|
| `game_line` rows | **4,363** |
| orphan line rows (no `game`) | **0** |
| 2010–2025 games without a line row | **0** |
| 2010–2025 games not `final` | **0** |
| 2026 games | 285 (272 scheduled + 13 tbd), **0 with a line** |
| upstream nflverse 2010–2025 rows with a spread the DB lacks | **0** |
| upstream 2010–2025 rows *without* a spread | **0** — so 4,363 is the complete priced universe |
| NULLs across all 8 price columns + `odds_source` | **0** |
| `team_game` = 2 rows per resolvable game | 4,635 games × 2 = 9,270 ✓ |

Per-season: 267 for 2010–2019, 269 for 2020 (14-team playoff), 285 for 2021 and 2023–2025,
**284 for 2022** — the missing game is the abandoned `BUF@CIN` week 17, correctly absent.

`team_game` excludes the 13 `tbd` 2026 playoff placeholders (no franchises assigned), which
is why it is 9,270 and not 9,296.

### 10. Upstream transport + the manual patch

Diffing every one of the 8 price columns on all 4,363 rows against
`nflverse/nfldata/data/games.csv`:

```
db line rows not found upstream      : 0
value differences vs upstream        : 6   <- all six on 2017_04_CHI_GB
upstream 2010-2025 priced rows missing from the DB : 0
score disagreements vs upstream      : 0
```

The six are exactly `away_moneyline, home_moneyline, away_spread_odds, home_spread_odds,
over_odds, under_odds` on `2017_04_CHI_GB`, and **upstream is empty for all six** — nothing
was overwritten. **`spread_line = 7.5` and `total_line = 44.0` are byte-identical to
nflverse**, confirming the reverted 7.5 → 7 override left no trace.

`odds_source` = `{nflverse: 4362, manual-2026-07-27: 1}`. **No other row was silently
patched.**

**New finding — the owner-supplied moneylines are independently corroborated.** ESPN's
odds feed for event `400951678` (`2017_04_CHI_GB`) returns, from `teamrankings`:

```
details = "GB -7.5"   overUnder = 44.0   away moneyLine = +311   home moneyLine = -357
```

`+311 / −357` are **exactly** the two hand-supplied values, and the spread and total match
too. `Unibet` also returns `−357` on the home side. The two moneylines are therefore no
longer unsourced. The four `−110` juice values remain assumed — see EX-09.

Caution worth recording: `−110` on all four juice columns is **not** a marker of the patch.
**108 plain `nflverse` rows** carry the same all-`−110` pattern (67 of them in 2023 alone).
`odds_source` is the only reliable discriminator.

---

## Exceptions

Twelve distinct findings, 61 exception rows. All are registered in `a4_lines.py`, which
fails if the set drifts.

### EX-01 — `team_game.covered IS NULL` is overloaded (structural, affects backtests)

762 NULLs = **544** rows with no line or no result (the 272 scheduled 2026 games × 2) +
**218** genuine ATS-push rows. The column alone **cannot distinguish a push from an absent
line**. A backtest that reads `covered IS NULL` as "push" will silently absorb 544 unplayed
2026 rows. Correct usage: `WHERE spread IS NOT NULL AND margin IS NOT NULL AND covered IS NULL`.
The schema has no third state; the data itself is not wrong.

### EX-02 — `team_game.won IS NULL` is overloaded (structural)

570 NULLs = **544** unplayed + **26** tie rows. Ties are correctly *not* losses, but a tie
and an unplayed game are indistinguishable by the column. Qualify with `margin IS NOT NULL`.

### EX-03 — 34 `rest_days` rows disagree with the real calendar (17 games)

`rest_days` is inherited verbatim from nflverse's `away_rest` / `home_rest`. Recomputing it
from consecutive `game.gameday` values in week order: **8,180 of 8,214 comparable rows match
exactly; 34 do not.** Root cause, in every case: nflverse computes rest against the
**originally scheduled** date, not the played date.

The first game of each season carries a nominal `7` by convention (510 of 512 team-seasons);
the two `14`s are `2017_02_MIA_LAC` (MIA) and `2017_02_CHI_TB` (TB), whose week-1 game was
postponed by Hurricane Irma — correct and explainable.

| Cluster | Rows | Cause |
|---|---|---|
| 2019 wk16/17 Saturday specials (BUF@NE, LAR@SF, HOU@TB) | 12 | stored 7 where the calendar gap is 6, then 7 where it is 8 |
| 2021 covid reschedules (LV@CLE Sat→Mon, SEA@LAR and WAS@PHI Sun→Tue, and each team's next game) | 14 | rest measured against the abandoned original date |
| 2021 wk15/wk18 Saturday specials (NE@IND, DAL@PHI, KC@DEN and follow-ons) | 6 | stored 7 where the calendar gap is 6 |
| 2022 wk18 after the abandoned BUF–CIN game | 2 | `2022_18_NE_BUF` (BUF) and `2022_18_BAL_CIN` (CIN) store `6`; both teams had actually been idle **15 days** |

The 2022 pair is the most consequential: any "short rest" filter will bucket Buffalo and
Cincinnati as playing on 6 days' rest in the week-18 games when they had a fortnight off.
The full 34-row list with each cause is in `REST_EXCEPTIONS` in `a4_lines.py` and printed by
`a4_lines.py -v`.

### EX-04 — `2020_01_LV_CAR` moneyline pair implies a negative hold

`away_moneyline = −124`, `home_moneyline = +134` → implied probabilities sum to **0.9809**,
a risk-free arbitrage that no single book can post. It is the only such row in 4,363.
The away price is the outlier: **all 10 ESPN providers for this event quote the away side
between −148 and −159** while agreeing with the DB's home side (+130/+135), its spread
(`LV −3`) and its total (48.0); SportsOddsHistory also has `LV −3 / 48`. Treat this row's
moneylines as unreliable; its spread and total are corroborated.

### EX-05 — `2021_10_DET_PIT` spread contradicted by both external archives

DB: `spread_line = +9.0` (PIT −9), `home_moneyline = −359`.
SportsOddsHistory: **PIT −6**. All 16 pre-game ESPN providers: **PIT −5.5 / −6, ML ≈ −250**.
Roethlisberger was a covid scratch, which moves the line *toward* Detroit, so `−9` runs the
wrong way. The row is internally coherent (spread and moneyline agree with each other), so
it is not a column swap — it looks like an upstream nflverse price error. **This game ended
16–16, so it is also one of the 13 ties.** Unresolved; recorded, not silently fixed.

### EX-06 — `2021_15_NE_IND` spread contradicted externally *and* internally

DB: `spread_line = −1.0` (NE, the away team, favoured by 1). ESPN majority: **IND −1 / −1.5**
(home). The DB's own moneyline (`NE −102 / IND −109`) also leans **IND**, so this row
disagrees with itself. It is one of the 13 `|spread| = 1` coherence exceptions (EX-08) and
the strongest single candidate for a genuine upstream sign error. Unresolved.

### EX-07 — `2021_17_CLE_PIT` spread contradicted externally

DB: `spread_line = −1.0` (CLE), corroborated by its own moneyline (`CLE −117 / PIT +105`).
ESPN majority: **PIT −1** (home). A near-pick'em where the two archives disagree by 2
points. Unresolved; both values recorded.

### EX-08 — 13 games where the moneyline favourite is not the spread favourite

All at `|spread| = 1.0`, implied-probability gap 0.0–2.4 pp. Adjudicated as normal
two-sided quote noise on a coin-flip market, **not** a swapped column (there are zero such
disagreements at `|spread| ≥ 2`).

`2010_15_CLE_CIN`, `2011_16_SD_DET`, `2013_15_CHI_CLE`, `2016_09_DEN_OAK`, `2017_05_SF_IND`,
`2017_10_MIN_WAS`, `2017_14_NYJ_DEN`, `2018_09_LAC_SEA`, `2020_09_BAL_IND`, `2021_04_CLE_MIN`,
`2021_15_NE_IND` (also EX-06), `2022_08_SF_LA`, `2024_17_TEN_JAX`.

### EX-09 — `2017_04_CHI_GB`: four assumed juice values

`away_spread_odds`, `home_spread_odds`, `over_odds`, `under_odds` are all `−110`, **assumed
standard juice, not observed prices**. The two moneylines (`+311 / −357`) are now
independently corroborated by ESPN teamrankings (above), and the spread (7.5) and total (44)
are byte-identical to nflverse. Any juice-sensitive analysis must filter
`odds_source = 'nflverse'`; note that this still leaves 108 nflverse rows carrying all-`−110`.

### EX-10 — 5 SportsOddsHistory favourite-side disagreements, all resolved in the DB's favour

| Game | SOH | Adjudication |
|---|---|---|
| `2013_12_JAX_HOU` | JAX −2 | ESPN consensus **HOU −10**, numberfire HOU −10.5, teamrankings HOU −10.5 with ML **+400/−470 identical to the DB**. DB right. |
| `2014_04_MIA_OAK` | OAK −3.5 | Wembley neutral site. All 9 ESPN providers say **MIA −3.5/−4**; teamrankings ML −190/+171 identical to the DB. DB right. |
| `2021_15_LV_CLE` | CLE −3 | All 14 pre-game ESPN providers say **LV −2.5/−3** after Cleveland's QB room went on the covid list. SOH is the pre-outbreak number. DB right. |
| `2024_14_NO_NYG` | NYG −5.5 | ESPN BET **NO −5.5** (ML −275/+225); DB's own ML is −245 NO. SOH mislabelled the favourite. DB right. |
| `2025_18_BAL_PIT` | PIT −5 | ESPN DraftKings **BAL −4.5** (ML −205/+170); DB's own ML is −225 BAL. DB right. |

### EX-11 — 1 SportsOddsHistory score disagreement, resolved in the DB's favour

`2025_20_HOU_NE`: SOH prints `NE 28–15`. ESPN summary `401772983` gives **HOU 16**
(linescore 3+7+6+0) and NE 28, matching the DB and nflverse. SOH typo.

### EX-12 — 1 ESPN minority dissent, resolved in the DB's favour

`2012_02_NO_CAR`: ESPN `numberfire` says `CAR −3` while quoting a self-contradictory
moneyline (`NO −135 / CAR +115`), and ESPN `consensus` says `CAR −6.5`. ESPN `teamrankings`
says **`NO −3` with ML −152/+137, byte-identical to the DB**, `accuscore` agrees, and
SportsOddsHistory also has NO as the favourite. DB right.

### Not exceptions — explicitly classified as structurally not applicable

- **31 neutral-site games** where SportsOddsHistory publishes no `@` marker (London,
  São Paulo, Super Bowls). The DB retains a nominal home team; SOH does not. This is a
  definitional difference, not a data gap, and the *favourite* still agrees in all 31.
- **544 `team_game` rows with NULL `spread` / `total_line` / `moneyline` / `rest_days` /
  `margin`** — the 272 scheduled 2026 games × 2 sides. Unplayed and unpriced by
  construction, not missing.
- **1,392 spread and 1,632 total values that differ from SportsOddsHistory by 0.5–1.0
  points** (and a further 123 spreads / 96 totals by 1.5). Two publishers, two closing
  numbers. The delta distribution is symmetric around zero; not error.

---

## Reproduce

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai

# The whole audit, read-only, from the cached evidence. 77 checks, exits 0.
python3 scripts/data/nfl-db/verify/a4_lines.py

# Same, but fail rather than skip if any external cache artefact is missing.
python3 scripts/data/nfl-db/verify/a4_lines.py --require-cache

# Print every one of the 61 exception rows instead of a capped sample.
python3 scripts/data/nfl-db/verify/a4_lines.py -v

# Zero-tolerance mode: exits 1 because registered exceptions exist.
python3 scripts/data/nfl-db/verify/a4_lines.py --strict ; echo "exit=$?"
```

Re-fetching the evidence cache (only needed if `scripts/data/nfl-db/cache/a4/` is lost;
files may be stored plain or gzipped — the script reads either):

```bash
CACHE=scripts/data/nfl-db/cache/a4
mkdir -p "$CACHE/espn"

# upstream nflverse, for the transport check
curl -sS -o "$CACHE/nflverse_games.csv" \
  https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv

# SportsOddsHistory, one page per season (rate-limited, 3s apart)
for y in $(seq 2010 2025); do
  curl -sS -L -A "Mozilla/5.0" -o "$CACHE/soh_${y}.html" \
    "https://www.covers.com/sportsoddshistory/nfl-game-season/?y=${y}"
  sleep 3
done

# ESPN odds for one event (the script reads every odds_<espn_event_id>.json it finds)
E=400951678   # 2017_04_CHI_GB - the manual patch corroboration
curl -sS -o "$CACHE/espn/odds_${E}.json" \
  "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${E}/competitions/${E}/odds"

gzip -9 "$CACHE"/*.csv "$CACHE"/*.html "$CACHE"/espn/*.json   # optional, 19M -> 2.4M
```

Spot-check queries used in this report:

```bash
# sign convention + push/tie inventory
sqlite3 scripts/data/nfl-db/nfl.db "
  SELECT 'ATS pushes', COUNT(*)/2 FROM team_game
    WHERE margin IS NOT NULL AND spread IS NOT NULL AND margin = spread
  UNION ALL SELECT 'ties', COUNT(*)/2 FROM team_game WHERE margin = 0
  UNION ALL SELECT 'ties recorded as losses', COUNT(*) FROM team_game WHERE margin = 0 AND won = 0
  UNION ALL SELECT 'OU pushes', COUNT(*) FROM game g JOIN game_line l USING(game_id)
    WHERE g.total = l.total_line;"

# moneyline / spread coherence at |spread| >= 2  -> must be empty
sqlite3 scripts/data/nfl-db/nfl.db "
  SELECT l.game_id, l.spread_line, l.away_moneyline, l.home_moneyline
  FROM game_line l
  WHERE ABS(l.spread_line) >= 2 AND l.away_moneyline <> l.home_moneyline
    AND ((l.spread_line > 0) <> (l.home_moneyline < l.away_moneyline));"

# odds_source isolation
sqlite3 scripts/data/nfl-db/nfl.db \
  "SELECT odds_source, COUNT(*) FROM game_line GROUP BY 1;"
```

**Read-only guarantee:** `nfl.db` is opened with `file:...?mode=ro`. Its MD5 after this
audit (`1d2b0bea3e85edf467ef446db807bc7d`) is identical to
`nfl.db.pre-completion-backup`. `build_db.py` and `schema.sql` were read but not modified.
