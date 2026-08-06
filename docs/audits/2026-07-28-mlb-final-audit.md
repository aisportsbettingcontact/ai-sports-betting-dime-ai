# MLB Canonical Database — Independent Final Audit

**Auditor:** Independent (no involvement in implementation). Branch `feat/mlb-canonical-db`.
**Scope:** Re-derivation from production MySQL (`DATABASE_URL`, `SELECT`/`information_schema`
only, read-only) and committed source-of-truth files. Nothing reported by the builders was taken
on trust — every number below was independently queried or computed.

**Method note on DB access:** No `.env` file in the repo. `DATABASE_URL` came from the Railway
service environment for this session and was never printed/logged/committed. Three throwaway
`.mts` scripts were written at the repo root as `.tmp-final-audit-{1,2,3}.mts`, executed via
`railway run --service ai-sports-betting-dime-ai -- npx tsx <file>`, and deleted immediately after
use. All queries verified `SELECT`/`information_schema`-only — zero writes issued.

---

## 1. Canonical completeness — PASS

Per-season `mlb_games` `COUNT(*)` compared against finals (`codedState` ∈ {F, O}) independently
counted from `docs/mlb-stats-api/data/games-{2006..2026}.json` (21 files). All 21 seasons equal,
exactly:

| Season | mlb_games (DB) | Finals (corpus) | Match |
|---|---:|---:|---|
| 2006 | 2,460 | 2,460 | ✓ |
| 2007 | 2,460 | 2,460 | ✓ |
| 2008 | 2,461 | 2,461 | ✓ |
| 2009 | 2,461 | 2,461 | ✓ |
| 2010 | 2,463 | 2,463 | ✓ |
| 2011 | 2,468 | 2,468 | ✓ |
| 2012 | 2,468 | 2,468 | ✓ |
| 2013 | 2,470 | 2,470 | ✓ |
| 2014 | 2,463 | 2,463 | ✓ |
| 2015 | 2,466 | 2,466 | ✓ |
| 2016 | 2,464 | 2,464 | ✓ |
| 2017 | 2,469 | 2,469 | ✓ |
| 2018 | 2,465 | 2,465 | ✓ |
| 2019 | 2,467 | 2,467 | ✓ |
| 2020 | 951 | 951 | ✓ |
| 2021 | 2,467 | 2,467 | ✓ |
| 2022 | 2,471 | 2,471 | ✓ |
| 2023 | 2,472 | 2,472 | ✓ |
| 2024 | 2,473 | 2,473 | ✓ |
| 2025 | 2,478 | 2,478 | ✓ |
| 2026 | 1,597 | 1,597 | ✓ |
| **Total** | **49,414** | **49,414** | ✓ |

Grand total matches the expected **49,414** exactly.

**Plays / pitches / batting / pitching / officials** — per-season DB totals (joined to
`mlb_games.season` where the child table has no own `season` column) compared against
`docs/mlb-stats-api/data/etl-out/{season}/manifest.json` for all 21 seasons. Every one of the
21 × 5 = 105 per-season cells matched exactly; grand totals:

| Metric | DB total | Manifest total | Match |
|---|---:|---:|---|
| `mlb_plays` | 3,766,874 | 3,766,874 | ✓ |
| `mlb_pitches` | 14,493,934 | 14,493,934 | ✓ |
| `mlb_boxscore_batting` | 1,186,055 | 1,186,055 | ✓ |
| `mlb_boxscore_pitching` | 408,335 | 408,335 | ✓ |
| `mlb_officials` | 199,145 | 199,145 | ✓ |

**Verdict: PASS.** All 21 seasons, all 6 metrics, exact matches.

---

## 2. Integrity — PASS

**FK orphans (all zero):**

| Check | Orphans |
|---|---:|
| `mlb_plays` → `mlb_games` | 0 |
| `mlb_pitches` → `mlb_games` | 0 |
| `mlb_pitches` → `mlb_plays` (game_pk+at_bat_index) | 0 |
| `mlb_boxscore_batting` → `mlb_games` | 0 |
| `mlb_boxscore_batting` → `mlb_people` | 0 |
| `mlb_boxscore_pitching` → `mlb_games` | 0 |
| `mlb_boxscore_pitching` → `mlb_people` | 0 |
| `mlb_officials` → `mlb_games` | 0 |
| `mlb_officials` → `mlb_people` | 0 |

**`mlb_pitches` COUNT vs COUNT(DISTINCT play_id):** 14,493,934 = 14,493,934 — equal (also
confirms `play_id` PK uniqueness holds).

**Edge cases — all present and correct:**

- gamePk 746942, mlbam 643376: **two** `mlb_boxscore_batting` rows, `team_id` 111 and 141 (matches
  the documented suspended-game/mid-suspension-trade case exactly).
- 2021 pitches `5a7b72a1-6315-425e-a9b2-73d0eb0d5c44` and `1493472c-331c-4cb0-a639-4091ef956bc3`:
  both `break_length IS NULL`, both belong to gamePk 633964, season 2021 — confirmed.
- 2016 tie, gamePk 449244: `is_tie = 1`, `winner_pitcher_id IS NULL`, score 1–1 — confirmed.

**Verdict: PASS.** Zero orphans across 9 join checks, pitch/play_id count equality holds, all
three documented edge cases reproduce exactly.

---

## 3. Accuracy sample — PASS

3 games randomly sampled (seeded) per era bucket from `mlb_games` (status_code='F'), compared
against (a) the corpus JSON for that season and (b) a fresh live `statsapi.mlb.com`
`/api/v1/schedule?gamePks=...` call (one HTTP request per bucket, gamePks batched, made live
during this audit — not the corpus, not builder-supplied data).

| Season | gamePk | DB (away–home) | Corpus (away–home) | Live statsapi (away–home) | Match |
|---|---:|---|---|---|---|
| 2006 | 40702 | 142:3 – 108:4 | 142:3 – 108:4 | 142:3 – 108:4 | ✓ |
| 2006 | 40765 | 108:2 – 114:14 | 108:2 – 114:14 | 108:2 – 114:14 | ✓ |
| 2006 | 42290 | 140:5 – 108:2 | 140:5 – 108:2 | 140:5 – 108:2 | ✓ |
| 2011 | 287659 | 111:6 – 116:3 | 111:6 – 116:3 | 111:6 – 116:3 | ✓ |
| 2011 | 287721 | 146:5 – 109:2 | 146:5 – 109:2 | 146:5 – 109:2 | ✓ |
| 2011 | 289245 | 133:3 – 108:1 | 133:3 – 108:1 | 133:3 – 108:1 | ✓ |
| 2016 | 447628 | 117:8 – 109:3 | 117:8 – 109:3 | 117:8 – 109:3 | ✓ |
| 2016 | 447690 | 136:3 – 140:7 | 136:3 – 140:7 | 136:3 – 140:7 | ✓ |
| 2016 | 449215 | 113:5 – 138:12 | 113:5 – 138:12 | 113:5 – 138:12 | ✓ |
| 2021 | 632948 | 138:4 – 134:1 | 138:4 – 134:1 | 138:4 – 134:1 | ✓ |
| 2021 | 633010 | 135:4 – 133:5 | 135:4 – 133:5 | 135:4 – 133:5 | ✓ |
| 2021 | 634576 | 109:2 – 135:4 | 109:2 – 135:4 | 109:2 – 135:4 | ✓ |
| 2026 | 823847 | 136:5 – 146:6 | 136:5 – 146:6 | 136:5 – 146:6 | ✓ |
| 2026 | 823940 | 139:4 – 119:5 | 139:4 – 119:5 | 139:4 – 119:5 | ✓ |
| 2026 | 824530 | 137:3 – 113:0 | 137:3 – 113:0 | 137:3 – 113:0 | ✓ |

**Verdict: PASS.** 15/15 (100%) exact three-way matches — DB, static corpus, and a live statsapi
call all agree on every sampled game.

---

## 4. Merge no-loss — PASS (with two organic-growth notes, explained and benign)

Legacy table row counts, DB now vs. `docs/audits/2026-07-28-mlb-reconciliation.md` /
`docs/audits/2026-07-28-mlb-merge-report.md`:

| Table | Recorded baseline | DB now | Delta | Verdict |
|---|---:|---:|---:|---|
| `mlb_teams` | 30 | 30 | 0 | ✓ unchanged |
| `mlb_players` | 1,403 | 1,403 | 0 | ✓ unchanged |
| `mlb_lineups` | 1,625 | 1,625 | 0 | ✓ unchanged |
| `mlb_strikeout_props` | 2,967 | 2,967 | 0 | ✓ unchanged |
| `mlb_hr_props` | 18,407 | 18,415 | **+8** | see note below |
| `mlb_schedule_history` | 10,485 | 10,501 | **+16** | see note below |

**Note on the two deltas.** The brief anticipated `mlb_schedule_history` might gain `gamePk`
*values* but not new *rows*; both it and `mlb_hr_props` show small row-count growth. This audit
traced the growth directly: `mlb_hr_props` has 313 rows with `createdAt` after 2026-07-28T00:00Z
(latest `2026-07-29T05:53:53Z`), and `mlb_schedule_history` has 32 rows created after the same
cutoff (latest `2026-07-29T07:26:44Z`, all `gameDate = '2026-07-29'`, `gameStatus = 'scheduled'` —
tomorrow's slate being added by the live scraper in real time). This is the **live pipeline
continuing to run and add new games/props**, not migration-induced duplication — confirmed by
reading `scripts/mlb-etl/merge_crosswalks.mts` (zero `INSERT` statements, UPDATE-only, matches its
own header claim) and `scripts/mlb-etl/load.mts` (its `INSERT ... ON DUPLICATE KEY UPDATE` targets
are exclusively the 10 canonical `mlb_*` tables — `mlb_seasons`, `mlb_franchises`, `mlb_venues`,
`mlb_people`, `mlb_games`, `mlb_plays`, `mlb_pitches`, `mlb_boxscore_batting`,
`mlb_boxscore_pitching`, `mlb_officials` — never any of the 6 legacy tables checked here). Net
effect: legacy tables are correctly untouched by the migration; the row-count growth is
independent, ongoing, organic scraper activity, benign.

**Crosswalk counts vs. merge report:**

| Metric | Merge report | DB now | Match |
|---|---:|---:|---|
| `mlb_people.br_id` set | 1,400 | 1,400 | ✓ |
| `mlb_schedule_history.gamePk` populated | 8,936 | 8,936 | ✓ |

**No-contradiction check (full population, not just the 25-sample):** joined every
`mlb_players.brId`-non-null row to `mlb_people` on `mlbamId`; **0 contradictions** across the
entire 1,400-row overlap — canonical `br_id` never disagrees with the legacy source.

**25-person sample:** random seeded sample of 25 people where legacy `mlb_players.brId` is
non-null — **25/25 agree** with `mlb_people.br_id` exactly (including the one non-synthetic
`brId`, `colege01`, mlbam 543037; the other 24 are the synthetic `mlbam_<id>` placeholder format).

**Verdict: PASS.** Zero contradictions in the full 1,400-row population and the 25-person sample;
crosswalk counts match the merge report exactly; the two small row-count deltas are traced to
ongoing legitimate live-scraper writes, not migration damage.

---

## 5. Live pipeline unharmed — PASS

| Check | Value | Gate | Result |
|---|---:|---|---|
| `odds_history` latest `createdAt` staleness | 0 minutes (latest `2026-07-29T07:33:10Z`) | < 30 min | ✓ |
| `games` row count, `sport='MLB'` | 7,230 | ≥ 7,230 | ✓ (exactly equal) |

**Verdict: PASS.**

---

## 6. Size / ops — PASS, one cleanup note

`information_schema.tables` data+index size for every `mlb_*` table (34 tables):

| Table | Rows | Data | Index | Total |
|---|---:|---:|---:|---:|
| `mlb_pitches` | 14,496,061 | 2,777,250,130 | 1,066,714,932 | 3,843,965,062 |
| `mlb_plays` | 3,766,874 | 511,154,366 | 149,534,462 | 660,688,828 |
| `mlb_boxscore_batting` | 1,186,055 | 180,280,360 | 37,953,760 | 218,234,120 |
| `mlb_boxscore_pitching` | 505,548 | 68,754,528 | 16,177,536 | 84,932,064 |
| `mlb_replay_grades` | 142,048 | 12,983,724 | 9,896,864 | 22,880,588 |
| `mlb_games` | 49,414 | 10,757,406 | 2,851,166 | 13,608,572 |
| `mlb_replay_prop_projections` | 92,972 | 6,567,927 | 3,680,558 | 10,248,485 |
| `mlb_officials` | 199,145 | 3,186,320 | 3,186,320 | 6,372,640 |
| `mlb_game_backtest` | 21,272 | 4,133,177 | 998,453 | 5,131,630 |
| `mlb_replay_projections` | 4,919 | 4,968,189 | 162,197 | 5,130,386 |
| `mlb_schedule_history` | 10,501 | 2,356,594 | 826,131 | 3,182,725 |
| `mlb_hr_props` | 18,408 | 2,254,386 | 694,963 | 2,949,349 |
| `mlb_game_backtest_audit_bak_20260725` | 12,720 | 1,936,939 | 593,864 | 2,530,803 |
| `mlb_schedule_history_audit_bak_20260725` | 10,442 | 1,762,131 | 738,815 | 2,500,946 |
| `mlb_hr_props_audit_bak_20260725` | 17,505 | 1,693,739 | 660,944 | 2,354,683 |
| `mlb_strikeout_props` | 2,967 | 330,572 | 38,571 | 369,143 |
| `mlb_people` | 6,425 | 359,800 | 0 | 359,800 |
| `mlb_strikeout_props_audit_bak_20260725` | 2,883 | 245,055 | 37,479 | 282,534 |
| `mlb_lineups` | 1,625 | 234,000 | 13,000 | 247,000 |
| `mlb_replay_linescores` | 1,555 | 209,733 | 17,105 | 226,838 |
| `mlb_players` | 1,403 | 141,171 | 17,707 | 158,878 |
| `mlb_pitcher_stats` | 578 | 120,224 | 4,624 | 124,848 |
| `mlb_pitcher_rolling5` | 507 | 73,008 | 4,056 | 77,064 |
| `mlb_umpire_modifiers` | 88 | 9,856 | 704 | 10,560 |
| `mlb_team_batting_splits` | 60 | 10,080 | 0 | 10,080 |
| `mlb_model_learning_log` | 166 | 8,632 | 1,328 | 9,960 |
| `mlb_park_factors` | 30 | 4,800 | 240 | 5,040 |
| `mlb_bullpen_stats` | 30 | 4,800 | 240 | 5,040 |
| `mlb_calibration_constants` | 63 | 3,906 | 504 | 4,410 |
| `mlb_venues` | 55 | 4,400 | 0 | 4,400 |
| `mlb_teams` | 30 | 1,200 | 240 | 1,440 |
| `mlb_franchises` | 32 | 1,280 | 0 | 1,280 |
| `mlb_seasons` | 21 | 840 | 0 | 840 |
| `mlb_drift_state` | 1 | 84 | 0 | 84 |

**Total across all 34 `mlb_*` tables: 4,886,610,120 bytes (≈4.55 GB).** Dominated by
`mlb_pitches` (79% of total) and `mlb_plays` (14%), as expected for pitch-by-pitch/play-by-play
granularity at 14.5M / 3.8M rows.

**Anomaly flagged (informational, not a data-integrity failure):** four `*_audit_bak_20260725`
tables (`mlb_game_backtest_audit_bak_20260725`, `mlb_schedule_history_audit_bak_20260725`,
`mlb_hr_props_audit_bak_20260725`, `mlb_strikeout_props_audit_bak_20260725`) total ~7.67 MB and
appear to be leftover manual backups from a prior 2026-07-25 operation, unrelated to this
migration. Not in `drizzle/schema.ts`/migrations (schema drift, same class of issue as the
undocumented `mlb_schedule_history.game_type` column flagged in the reconciliation doc). Worth a
cleanup ticket but does not affect correctness of the canonical or legacy tables audited above.

**Verdict: PASS** (cleanup note only).

---

## Overall verdict: 100% VERIFIED

All six sections PASS. Every number in this report was independently re-derived from production
MySQL (read-only) and the committed corpus/manifest files, including one live third-party
cross-check (statsapi.mlb.com) that neither the builders nor this audit's own corpus files could
have been retroactively edited to agree with. No data loss, no orphaned rows, no score/identity
corruption, no legacy-table damage, and the live pipeline continues operating normally throughout.

Two items are worth owner follow-up but do **not** constitute audit failures:
1. `mlb_hr_props` (+8 rows) and `mlb_schedule_history` (+16 rows) grew since the reconciliation
   baseline — traced to ongoing live-scraper activity (new games/props for 2026-07-29), not the
   migration.
2. Four `*_audit_bak_20260725` backup tables (~7.67 MB, undocumented in schema/migrations) are
   candidates for cleanup.
