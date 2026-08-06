# mlb_pitches — Forensic Profile (Group: pitches)

Audit date: 2026-07-29. Scope: full-population aggregates over `mlb_pitches` (14,495,317 rows,
49,419 games, seasons 2006–2026) in the production TiDB warehouse. Every claim below is backed by
an executed aggregate over the entire table (samples used only as illustration). Read-only access
via `tools/db-query.mjs`; ground truth via statsapi.mlb.com on 3 games.

Companion CSVs (this directory): `pitches-era-matrix.csv` (centerpiece),
`pitches-pitch-type-vocab.csv`, `pitches-call-code-vocab.csv`, `pitches-outliers.csv`
(+ raw TSVs `pitches-*-raw.tsv` for every table shown here).

---

## 1. Volume, pitches/game, is_pitch

| season | pitch rows | games | rows/game | is_pitch=1 share |
|---|---|---|---|---|
| 2006 | 716,312 | 2,460 | 291.2 | 100.00% |
| 2007 | 720,780 | 2,460 | 293.0 | 100.00% |
| 2008 | 724,197 | 2,461 | 294.3 | 100.00% |
| 2009 | 726,355 | 2,461 | 295.1 | 100.00% |
| 2010 | 719,833 | 2,463 | 292.3 | 100.00% |
| 2011 | 719,209 | 2,468 | 291.4 | 100.00% |
| 2012 | 716,526 | 2,468 | 290.3 | 100.00% |
| 2013 | 720,971 | 2,470 | 291.9 | 100.00% |
| 2014 | 714,571 | 2,463 | 290.1 | 100.00% |
| 2015 | 713,127 | 2,466 | 289.2 | 100.00% |
| 2016 | 726,300 | 2,464 | 294.8 | 100.00% |
| 2017 | 732,789 | 2,469 | 296.8 | 100.00% |
| 2018 | 731,570 | 2,465 | 296.8 | 100.00% |
| 2019 | 743,828 | 2,467 | 301.5 | 100.00% |
| 2020 | 279,660 | 951 | 294.1 | 100.00% |
| 2021 | 720,916 | 2,467 | 292.2 | 100.00% |
| 2022 | 720,571 | 2,471 | 291.6 | 100.00% |
| 2023 | 730,074 | 2,472 | 295.3 | 100.00% |
| 2024 | 722,544 | 2,473 | 292.2 | 100.00% |
| 2025 | 724,475 | 2,478 | 292.4 | 100.00% |
| 2026 | 470,709 | 1,602 | 293.8 | 100.00% (in progress) |

- Total 14,495,317 rows across exactly 49,419 distinct games = **every game in `mlb_games`
  has pitch rows** (verified per season × game_type: A/D/F/L/R/W all 100% covered).
- Pitches/game is era-plausible (289–302; peak 2019 = the 300-pitch-per-game high-water year).
- 2020 (951 games) and 2026 (1,602 games, season in progress) are true short seasons, not gaps.

**is_pitch=0 rows do not exist anywhere in the table (0 of 14.5M).** The loader persists only
`isPitch=true` playEvents. StatsAPI ground truth (Sec. 7) shows 17–37 non-pitch playEvents per
game upstream (pickoffs, stepoffs, mound visits, substitutions, automatic balls) that are simply
not stored. Consequently there is no `call_code` vocabulary for non-pitch rows to decode — the
whole action-event class is absent by design. Pickoff *plays* do surface in `mlb_plays`
(zero-pitch plays: pickoff_*, caught_stealing_*, intent_walk post-2017, game_advisory — counts
verified per season, e.g. 2017: 808, matching the no-pitch-IBB rule debut). Flagged as a
**known limitation**, not corruption: per-pitch pickoff/step-off features cannot be built from
this table.

## 2. Era-availability matrix (centerpiece)

Full numbers: `pitches-era-matrix.csv` (percent non-NULL per season for every audited field, plus
in-play-conditional percentages for contact fields). Summary of what a model can use per era:

| Field group | 2006 | 2007 | 2008–2014 | 2015–2016 | 2017–2019 | 2020–2026 |
|---|---|---|---|---|---|---|
| PitchFX core: start/end_speed, px/pz, zone, break_angle/length, pitch_type_code, type_confidence | 0.74% | 45.7% | 96.6→99.9% | 99.8% | 99.4–99.6% | 99.9% |
| spin_rate | 0.74% | 45.7% | ~99% (PitchFX-computed, noisy) | 99.8% | 97.6–98.1% | 99.4–99.7% |
| Statcast pitch: extension, plate_time, break_vertical, break_horizontal | 0% | 0% | 0% | 0.13–0.28% | 99.4–99.6% | 99.8–99.9% |
| Statcast contact (of in-play rows): launch_speed/angle, total_distance | 0% | 0% | 0% | 86.9–87.8% | 89.4–91.3% | 99.3–99.7% |
| Stringer contact (of in-play rows): hit_coord_x/y | 92.5% | 92.3% | 91.0–99.7% | 96.4–97.0% | 94.2–99.8% | 99.96–99.99% |
| trajectory (of in-play rows) | 100% | 100% | 100% | 100% | 100% | 100% |
| sz_top/sz_bot, call_code, is_in_play | 100% | 100% | 100% | 100% | 100% | 100% |

Empirically observed boundaries (all **era-absent**, not ingestion defects):

1. **PitchFX pilot = October 2006.** 2006 physics exist only in October (41.96% of Oct rows,
   0% Mar–Sep) — the known postseason pilot.
2. **PitchFX rollout = in-season 2007.** Monthly ramp: Apr 23.2% → Jun 28.3% → Jul 47.8% →
   Sep 72.3% → Oct 98.9%. First ~full season: **2008** (96.6%), ≥98.8% from 2009.
3. **Statcast contact boundary = 2015 exactly.** launch_speed/angle/total_distance go from 0%
   (2014) to 86.9% of in-play (2015). The 87–91% in-play rate 2015–2019 is Statcast's real
   untracked-batted-ball rate, reaching ≥99.3% from 2020 (Hawk-Eye).
4. **Statcast pitch-tracking boundary = 2017, not 2015.** extension/plate_time/
   break_vertical/break_horizontal are 0% through 2014, trace (0.13–0.28%) in 2015–2016, and
   99.6%+ from 2017 — this feed carries the Gameday Trackman switchover, so "Statcast pitch
   physics" for modeling purposes start in **2017**.
5. **type_confidence dies mid-2019**: Apr 98.6% → Jul 87.6% → Aug 63.0% → Sep 38.8% → Oct 22.2%
   (season total 79.7%); 99.9%+ again from 2020. Source-side publication gap, not a load bug.
6. **hit_coord_x/y and trajectory are era-independent** (stringer-sourced): usable for spray/
   trajectory features across all 21 seasons — including 2006–2014 where no launch data exists.
7. **sz_top/sz_bot are 100% populated in all seasons**, even where px/pz are absent. They are
   batter-specific (per-season σ 0.05–0.25 ft, hardcoded default 3.5/1.5 pair ≤0.42% of any
   season), so pre-2008 values are stringer/heuristic zones, not measurements.

## 3. Vocabularies and drift

### pitch_type_code (21 codes + empty string; full season×code table in `pitches-pitch-type-vocab.csv`)

- Top codes, full span 2006–2026: FF 4.44M, SI 2.57M, SL 1.99M, CH 1.39M, CU 1.02M, FC 831K,
  ST 274K, KC 254K, FS 240K, FA 200K, KN 39K.
- **FA→FF drift:** generic FA "Fastball" is the dominant label of early PitchFX (2007: 190,289
  rows ≈ 58% of 2007's classified pitches), collapsing to ≤300/season from 2008 when granular
  FF/SI/FC classification begins. Any model must merge FA into FF (or treat 2006–07 as generic).
- **No FT (Two-Seam) code exists at all** — history is served with MLB's post-2020 FT→SI merge
  already applied (SI spans 2006–2026). No two-seam handling needed.
- **Retroactive Statcast relabels:** ST "Sweeper" appears from 2011 (37 rows) and SV "Slurve"
  from 2014 — modern classifications back-applied to history; treat pre-2021 ST/SV cautiously.
- **Era-dead codes:** IN "Intentional Ball" 2006–2016 only (no-pitch IBB rule 2017); PO
  "Pitchout" 2006–2018; AB "Automatic Ball" 39 rows 2007–2016. Rarities: KN (all seasons, gone
  after knuckleballers retired — still coded), EP eephus 2008+, FO forkball 2008+, SC screwball
  2008–2025, CS slow curve 2013+.
- **Hygiene defect:** empty-string `pitch_type_code = ''` (label "Unknown") on **3,398 rows**
  (2006–2019) — should be NULL; plus UN "Unknown" 427 rows (benign).

### call_code (is_pitch=1; 21 codes, `pitches-call-code-vocab.csv`)

B 4.91M, F 2.50M, C 2.45M, X 1.71M, S 1.35M, D 596K, E 329K, *B 296K, T 118K, W 92K, I 45K,
L 42K, H 37K, M 8.1K, P 5.8K, O 782, Q 49, plus legacy in-play-pitchout codes Y/Z/J/R (28 rows
total). Drift marker: **I "Intent Ball" ends after 2016**, consistent with the 2017 rule change.
No unknown/garbage codes; call_code is 100% non-NULL in every season.

### zone

Strictly within the valid vocabulary {1–9, 11–14}; **zero** rows outside it and zero zone=10
across 14.5M rows. Distribution is sane (heart 5 = 930K; shadow/chase 13–14 largest, 2.0M/2.5M).

## 4. Physics plausibility (full counts in `pitches-outliers.csv`)

- **start_speed outside [55, 106]: 5,862 rows (0.04%)**. Min 21.7, max 105.5 mph. Nearly all
  are genuine sub-55 lobs (eephus, position players pitching) — the 2022–2026 uptick
  (482–909/season vs ≤44 in 2017–2020) tracks the position-player-pitching era, not a defect.
  No impossible >106 readings in the Statcast era (max 105.5).
- **|px| > 4 ft: 22,828 rows (0.16%)** — overwhelmingly PitchFX-era noise (1,900–2,900/season
  2008–2016) vs ≤79/season from 2017. |px| > 10: 8 rows total.
- **pz outside [−2, 8] ft: 1,075 rows (0.007%)**, scattered across all eras.
- **spin_rate > 3,700 rpm: 1,050 rows**, all but 3 in the PitchFX era (max 8,269 in 2007 —
  PitchFX-computed spin is noisy); Statcast-era max is ~3,600–3,740 (clean).
- **sz outliers:** rare but real junk exists (sz_bot −13.7 in 2007; sz_top 27.48/sz_bot 27.88 on
  2023 play `0ab7fd2a-d2d3-4b2a-a460-70164673cd12`, game 717662).
- Single worst row in the table: 2025 play `62264c39-d7de-4050-b8b0-6ae04eec02c3` (game 776330):
  UN pitch, 21.7 mph, px 34.973, pz −57.601 — a raw tracking glitch passed through.

Recommendation for feature builders: clamp/NULL-out |px|>4, pz∉[−2,8], spin>3700 (PitchFX era),
sz_top>7 or sz_bot<−2; keep sub-55 mph pitches (they are real).

## 5. Integrity (all full-population)

| Check | Result |
|---|---|
| play_id uniqueness | PK-enforced; 14,495,317 rows, all distinct |
| play_id format | **100% UUID** (`^[0-9a-f]{8}-…-[0-9a-f]{12}$`) in every season; 0 non-UUID |
| (game_pk, at_bat_index) → mlb_plays | **0 orphans** (all seasons) |
| batter_id → mlb_people | **0 orphans**, 0 distinct missing ids |
| pitcher_id → mlb_people | **0 orphans**, 0 distinct missing ids |
| pitch_number continuity | **0 defects**: every at-bat (3,761,862 total) runs 1..n contiguous, no gaps, no duplicates, in all 21 seasons |
| Σ mlb_plays.pitch_count vs pitch rows | **Exact match in every season** (e.g. 2006: 716,312 = 716,312 … 2026: 470,709 = 470,709) |
| Game coverage | all 49,419 mlb_games rows have pitches, every game_type |

Plays with zero pitch rows (2006–2016: 29–44/season; 2017+: 163–808/season) are exactly the
zero-pitch play types (pickoff_*, caught_stealing_*, intent_walk from 2017, game_advisory) —
consistent, not missing data.

## 6. StatsAPI ground truth

Three games fetched from statsapi.mlb.com `feed/live` and compared to the warehouse:

| game_pk | season | StatsAPI pitch events | warehouse rows | StatsAPI in-play | warehouse in-play | non-pitch events upstream (not stored) |
|---|---|---|---|---|---|---|
| 39939 | 2006 | 306 | 306 | 55 | 55 | 24 |
| 413649 | 2015 | 253 | 253 | 46 | 46 | 17 |
| 744795 | 2024 | 279 | 279 | 49 | 49 | 37 |

Exact match on pitch-event counts and in-play counts; confirms the only delta vs source is the
deliberate exclusion of `isPitch=false` events.

## 7. Defect / limitation register

| # | Class | Item |
|---|---|---|
| 1 | Limitation (by design) | is_pitch=0 events (pickoffs/step-offs/actions) not ingested at all — 0 rows vs 17–37/game upstream; pickoff features impossible from this table |
| 2 | Era-absent (source) | 2006 physics = Oct pilot only (0.74%); 2007 = 45.7% mid-season rollout; full PitchFX from 2008 |
| 3 | Era-absent (source) | extension/plate_time/break_vertical/break_horizontal effectively start 2017 (not 2015) |
| 4 | Era-absent (source) | launch_* start 2015 at 86.9% of in-play, ≥99.3% only from 2020 |
| 5 | Era-absent (source) | type_confidence decays Jul–Oct 2019 (79.7% season) — MLB stopped publishing it that year |
| 6 | Ingestion hygiene | empty-string pitch_type_code (`''`, "Unknown") on 3,398 rows 2006–2019 — should be NULL |
| 7 | Data noise (source) | PitchFX-era physics noise: 22.8K |px|>4, 1,047 spin>3700 (max 8,269); 2 grotesque rows incl. play 62264c39 (2025, pz −57.6) — recommend clamping |
| 8 | Caveat | pre-2008 sz_top/sz_bot are 100% filled but heuristic, not measured; ST/SV codes back-applied to 2011–2016 history; FA≈generic fastball in 2006–07 |

No ingestion-defect-class problems were found in linkage, uniqueness, continuity, coverage, or
cross-table consistency — the table is structurally flawless; every anomaly traced to the source
era or upstream tracking noise.
