# Forensic Audit — The New MLB Warehouse (2026-07-29)

Ten tables landed in the production TiDB schema 2026-07-27→29 via `scripts/mlb-crawl` +
`scripts/mlb-etl` (branch `feat/mlb-games-2006-2025`; PRs #207/#223/#224, merged to main).
Six parallel profilers audited the full population (no sampling for any claim); their section
reports and CSVs sit beside this file. Verdict up front: **this is a clean, referentially
airtight, finals-only MLB StatsAPI warehouse spanning 21 seasons (2006–2026), pitch-level,
with two real defect clusters: the identity crosswalks were wiped on the way to production,
and the 2026 freshness path (nightly delta cron) was unproven at audit time.**

## What it contains, over how many seasons
- **Seasons: 21 (2006–2026)**, per-season calendars in `mlb_seasons` (2020 COVID season
  correctly 900-expected; 2026 in progress). All ground-truthed seasons (2006/2008/2016/2020/2024)
  are pk-identical with StatsAPI; regular-season deficits vs expected are real MLB cancellations.
- **49,419 completed games** (48,662 regular season; 757 postseason incl. wild-card era; 20
  All-Star; zero spring/exhibition; finals-only by design — no scheduled/live rows).
- **3,767,228 plays** (plate-appearance events with runners JSON, in-state counts, running score).
- **14,495,317 pitches** (physics + Statcast contact fields; `is_pitch=1` only — pickoff/action
  events were not ingested, a design limitation).
- **1,186,159 batting + 408,375 pitching boxscore lines** (the 506K figure in TiDB's stats is a
  stale estimator).
- Registries: 6,425 people (referenced-subset + never-debuted strays), 199K per-game official
  assignments (100% HP-umpire coverage in every season), 32 franchises, 55 venues with park
  dimensions, 21 season rows.

## How it is stored
Snake_case warehouse conventions, natural StatsAPI keys throughout: `game_pk` (games PK; plays
PK `game_pk+at_bat_index`; boxscores `game_pk+mlbam_id+team_id`; officials `game_pk+mlbam_id`),
GUID `play_id` for pitches, `mlbam_id` for people. Provenance columns on games: `loaded_at`
(three batch stamps: 45,350-game bulk 07-28 20:43 UTC; 2021 repair re-load 22:40 after a
break-length fix; 2026 bootstrap 07-29 01:59) and `feed_timestamp` (genuine Gameday stamps
2010+; crawl-time placeholders for 2006–2009 where originals don't exist). Crawler: 1 req/s,
retry/backoff, atomic resumable writes, feed/manifest verification gates. Forward maintenance:
`cron-mlb-canonical-refresh.yml` (nightly 09:00 UTC delta) — authored but zero runs at audit time.

## Integrity verdict (full-population checks)
- **Zero orphans** across 11 referential sweeps (plays/pitches/boxscores/officials/W-L-SV
  pitchers → people; games → franchises/venues: perfect bijections).
- **Zero zero-play games; zero at_bat_index gaps; zero inning/half monotonicity violations.**
- **`pitch_count` ⇔ pitch rows: 100.000% exact in every season.** Boxscore pitches ⇔ pitch rows:
  exact every season. Batting-vs-pitching SO/HR/H cross-checks: zero mismatches.
- **Final-score reconciliation: 49,418/49,419** from plays and from summed batting runs — the
  single exception is the 2025 All-Star swing-off (status FW, score 7-6 vs 6-6 play-by-play),
  a real-world quirk consumers must special-case.
- Play-count and outs/innings deviants all trace to verified real events (rain-shortened FR
  finals, ties); 11 impossible ball/strike end-counts are source-inherited (StatsAPI carries
  the same values) — faithful ingestion.

## The era-availability matrix (what models can use, per season)
- **PitchFX physics** (speed, px/pz, break length/angle): 2006 ≈ 0.7% (October pilot), 2007 ≈
  46% (mid-season rollout), **2008–2016 ≈ 97–100%** (spin noisy; no extension/vertical break).
- **Statcast contact** (launch speed/angle/distance): from **2015** (87–91% of balls in play
  2015–2019, 99.3%+ from 2020).
- **Statcast pitch tracking** (extension, plate time, vertical/horizontal break): from **2017**
  (99.6%+).
- Always-available all 21 seasons: call codes, counts, zones, sz bounds (heuristic pre-2008),
  hit coordinates, trajectory; weather/attendance/duration 100% on games (wind 93–97% pre-2015).
- Modeling hygiene notes: clamp PitchFX-era outliers (22,828 |px|>4 rows; 1,047 spin>3700), merge
  FA→FF for 2006-07 fastballs, retro-applied ST/SV labels exist back to 2011, two garbage
  coordinate rows identified by play_id.

## Defect register (prioritized)
| # | Sev | Finding |
|---|---|---|
| W-1 | HIGH | **Identity crosswalks wiped in production**: `mlb_people` br/AN/Rotowire/Retrosheet ids and ALL `mlb_franchises` slug/id/mapping columns are 0% populated — despite the branch's merge report showing ~1,400/862/812/35 person cells + 180 franchise cells loaded. Enrichment never reached prod (or was clobbered). This is the app-integration blocker; re-run the enrichment step. |
| W-2 | HIGH→ops | **Freshness path unproven**: 10 finals from the 07-28 slate missing (evening games ended after the bootstrap load), 2 rows frozen at status `O`, and the nightly delta cron had 0 runs at audit time. The delta also diffs on pk-existence only, so `O`-status rows are never revisited — fix the delta to re-pull non-F rows. |
| W-3 | MED | `mlb_franchises` is current-alignment-only — historical league/division reads are wrong pre-realignment (e.g., Astros 2006–2012 shown AL West); `first_season/last_season` null. |
| W-4 | MED (app-side) | `mlb_umpire_modifiers` (app table) missing 8 of 95 HP umpires active 2025–26 — the warehouse's officials data is the natural refresh source. |
| W-5 | LOW | Non-pitch events (pickoffs/step-offs) not ingested — per-pitch pickoff features impossible without a crawler extension. |
| W-6 | LOW | Cosmetics: '' pitch_type on 3,398 rows; Field-of-Dreams games null venue; temp_f=0 roof sentinels; one DH flag mismatch (2016-09-22 DET@MIN); 28 null batting_order rows; is_tie/FW swing-off semantics. |
| W-7 | INFO (app-side, warehouse correct) | 9 app `games` rows carry stale live-score display columns (8 from the May 5 outage window, 1 from 6/16); `actual*` columns agree with the warehouse 1,601/1,601 on shared 2026 pks. |

## Cross-check against the existing model stack
All 1,601 shared 2026 regular-season pks agree with the app's `games` table on final scores
(zero mismatches). `mlb_schedule_history` untouched (snapshot diff = organic growth; closings
intact and growing). No existing model table altered. The warehouse and the model stack are
consistent and complementary: this is precisely the historical substrate the backtesting
roadmap called for — 21 seasons of as-of trainable game logs, umpire assignments, park
dimensions, and pitch-level features, replacing StatsAPI-crawl reconstruction with local joins.
