# MLB Canonical Database — Phase 0 Row-Level Reconciliation

**Date:** 2026-07-28
**Scope:** Read-only row-level cross-reference of production MySQL (`DATABASE_URL`, read-only
queries only — `SELECT`/`information_schema`, never logged) against the local feed corpus
(`docs/mlb-stats-api/data/games-{2006..2026}.json`). Gate for
`docs/superpowers/plans/2026-07-28-mlb-canonical-db.md` Task 5.

**Method note on DB access:** No `.env` file exists in the repo; `DATABASE_URL` was already present
in the shell environment for this session and used directly (never printed/logged/committed).
Throwaway `.mts` scripts were written under `/private/tmp/mlb-audit/` (outside the repo) with a
symlinked `node_modules` pointing at the repo's install so `mysql2/promise` resolves under `npx
tsx`; all queries were verified `SELECT`-only. Per the controller's note, the 10 new canonical
`mlb_*` tables that already exist in production were excluded from every query below — scope is
strictly the 17 legacy tables + `games`.

Adjudication rule applied throughout: **corpus wins for DERIVE fields** (scores, schedule,
identity); mismatches on fields this audit dispositioned RETAIN, or mismatches that reveal a
pipeline bug independent of this migration, are **findings for the owner**.

---

## 1. `games` (sport='MLB') vs. corpus by `mlbGamePk`

Production `games` (sport='MLB') covers 2024-03-20 through 2026-09-27 (the live pipeline's active
window; the corpus's full 2006-2026 range is far wider — this table only ever held recent seasons).

| Metric | Count |
|---|---:|
| Total `games` rows, sport='MLB' | 7,230 |
| Matched to corpus by `mlbGamePk` | 7,227 |
| Unmatched — `mlbGamePk IS NULL` (fallback key attempted) | 3 |
| Duplicate `mlbGamePk` values | 0 (unique-indexed, verified clean) |

### Unmatched (no `mlbGamePk`) — fallback by gameDate+teams+gameNumber

| id | gameDate | Matchup | gameStatus | Adjudication |
|---|---|---|---|---|
| 2250429 | 2026-04-29 | HOU @ BAL | postponed | **Accept, not a gap.** Corpus has no record for this date because the game was never played on 2026-04-29 (rained out, made up 2026-04-30 as part of the same series under a different `gamePk`, 824848/824850). This is a postponement-placeholder row, expected to stay unmatched by exact-date key. |
| 2250432 | 2026-04-29 | SF @ PHI | postponed | Same as above — made up 2026-04-30/gamePk 823472/823471 (split doubleheader). |
| 4110001 | 2026-07-14 | AL @ NL | final | **Finding.** This is the All-Star Game. It exists in the corpus as `gamePk 823443` (score 4-0, exact match to prod's 4-0) but prod's `mlbGamePk` was never backfilled — a genuine identity-crosswalk gap, not a missing game. |

### Score mismatches (both sides "final") — 9 of 7,227 matched

| gamePk | prod (away,home) | corpus (away,home) | Date |
|---|---|---|---|
| 822986 | (3,2) | (3,4) | 2026-05-05 |
| 823469 | (0,1) | (1,9) | 2026-05-05 |
| 823873 | (7,4) | (9,7) | 2026-05-05 |
| 822743 | (6,2) | (11,3) | 2026-05-05 |
| 823553 | (3,3) | (4,7) | 2026-05-05 |
| 824682 | (1,0) | (2,3) | 2026-05-05 |
| 824119 | (0,2) | (3,5) | 2026-05-05 |
| 824200 | (0,0) | (1,2) | 2026-05-05 |
| 824912 | (3,2) | (7,2) | 2026-06-16 |

**Adjudication: corpus wins (DERIVE) — and finding for owner.** 8 of these 9 fall on the same
calendar date (2026-05-05), out of 13 total MLB games that day — the other 5 games that day match
the corpus exactly. `823553` (TEX@NYY "final" 3-3) is an impossible final score for 9 innings with
no tie declared, strong evidence these 8 rows have a stale/incomplete score frozen as "final" by
the live outcome-ingestion pipeline rather than a genuine data-entry error on 8 unrelated games.
This looks like an isolated live-pipeline incident on 2026-05-05 (plus one more on 2026-06-16),
worth flagging to the owner as a production bug independent of this migration — it is not something
Task 5's merge logic should try to "fix" by rewriting `games`, since `games` stays untouched
(global constraint: legacy data is never overwritten).

### Status mismatches: 0

No case where one side reports final and the other doesn't.

### Doubleheader-flag mismatches — 68 of 7,227 matched

| prod `doubleHeader` | corpus `doubleHeader` | Count |
|---|---|---:|
| N | N | 7,128 |
| N | S | 46 |
| S | S | 26 |
| N | Y | 21 |
| Y | Y | 5 |
| S | N | 1 |

**Adjudication: corpus wins (DERIVE).** Of 98 corpus games flagged as part of a doubleheader
(Y or S), prod's `doubleHeader` column only agrees on 31 (32%) and silently reports `N` for 67 of
them. This is a systemic, consequential gap — the legacy `games.doubleHeader` flag is unreliable
and canonical `mlb_games.double_header` must become the field of record for any doubleheader-aware
logic (per-doc `mlbEventIdentity.ts` comment about the 2026-07-17 TB@BOS incident class, this is
exactly the failure mode that code was hardened against — the hardening evidently didn't
retroactively fix historical rows).

### Date mismatches (`gameDate` vs corpus `officialDate`) — 8 of 7,227 matched

| gamePk | prod gameDate | corpus officialDate | Cause |
|---|---|---|---|
| 823543 | 2026-05-23 | 2026-09-22 | Postponed, rescheduled (corpus `rescheduleDate` confirms) |
| 824514 | 2026-05-24 | 2026-08-17 | Postponed, rescheduled |
| 823539 | 2026-06-06 | 2026-08-29 | Postponed, rescheduled |
| 824589 | 2026-06-11 | 2026-08-20 | Postponed, rescheduled |
| 824424 | 2026-06-14 | 2026-09-04 | Postponed, rescheduled |
| 824911 | 2026-06-18 | 2026-08-31 | Postponed, rescheduled |
| 824664 | 2026-06-21 | 2026-08-06 | Postponed, rescheduled |
| 823177 | 2026-08-30 | 2026-08-29 | **Not a postponement** — corpus shows `codedState='S'` (Scheduled, upcoming) |

**Adjudication:** the first 7 are **accept-with-note** — all are `gameStatus='postponed'` rows in
prod (7 of prod's 9 total postponed MLB rows, the other 2 have no `mlbGamePk` per above) where prod
correctly keeps the *original* scheduled date and the corpus's `officialDate` reflects the makeup
date per `rescheduleDate`. This is expected staleness for a non-final row, not a data-quality bug —
canonical `mlb_games` will resolve it automatically once loaded (the makeup game gets its own
`game_pk`). Row `823177` (ARI@SF, split doubleheader game 1) is a **genuine 1-day schedule drift on
an upcoming game** — finding for owner, corpus wins.

---

## 2. `mlb_schedule_history` mapped to a `gamePk`

Matching key: `gameDate` + AN-slug crosswalked teams (via `mlb_teams.anSlug → mlbId`, 30/30 clean)
+ chronological ordering within same-day same-matchup groups (for doubleheader disambiguation,
since `mlb_schedule_history` has no explicit game-number column).

| Metric | Count |
|---|---:|
| Total rows | 10,485 |
| `spring_training` (out of scope — corpus never contains gameType `'S'`, verified across 2023-2026) | 1,373 |
| `cancelled` status (never played, no corpus record expected) | 4 |
| No AN-slug crosswalk (`american-league`/`national-league` — All-Star Game rows) | 4 |
| **Eligible rows** | 9,104 |
| Matched to a `gamePk` (direct orientation) | 5,267 |
| Matched to a `gamePk` (**swap** orientation — see Finding below) | 3,684 |
| **Total matched** | **8,951 / 9,104 (98.3%)** |
| Truly unmatched | 138 |

### Truly unmatched (138) breakdown

| Reason | Count | Adjudication |
|---|---:|---|
| `postponed`, never rescheduled/re-tracked | 122 | Accept-with-note — same staleness pattern as `games` §1: a postponed placeholder that was never given a corresponding tracked makeup row |
| `suspended` | 1 | Accept-with-note |
| `complete`, dated 2024-03-20 or 2025-03-18 | 15 | **Finding (data-quality mislabel).** These are pre-season "Big League"/exhibition openers (2024-03-20 Seoul-window exhibitions; 2025-03-18 similar) mislabeled `game_type='regular_season'` in `mlb_schedule_history`. The corpus correctly excludes them (they are not real regular-season games). Sample `anGameId`s: 221966, 221967, 221968, 221971, 221972, 221974, 221975, 221976, 250678, 250680, 250682, 250683, 250684, 250685, 250687 |
| `complete`, 2025-08-03 ATL@CIN | 1 | Minor — this is the real "Speedway Classic" game at Bristol Motor Speedway (`gamePk 776907`), scores match exactly (4-2) once located; the corpus's `officialDate` is 2025-08-02 vs. `mlb_schedule_history`'s 2025-08-03, a one-day encoding difference for this single special-venue event. Accept-with-note. |

### 🔴 Finding — away/home team identity reversed for ~41% of matched rows (2023-2025 only)

Of the 8,951 matched rows, **3,684 matched only after reversing which team was recorded as away vs.
home** (i.e. `mlb_schedule_history` says Team A is away/Team B is home on date D, but the corpus
says Team B is away/Team A is home on that same date D — the two sides can't both be describing a
different real game, since MLB never schedules the same two teams against each other twice on one
calendar date outside a doubleheader, which this key already disambiguates for).

Breakdown by season (eligible rows only):

| Season | Direct match | Swap match |
|---|---:|---:|
| 2023 | 1,222 | 1,250 |
| 2024 | 1,244 | 1,229 |
| 2025 | 1,198 | 1,211 |
| 2026 | 1,612 | **0** |

Roughly half of every 2023-2025 season needs the swap; **2026 has zero swapped rows** — whatever
caused this was fixed for the current season but never backfilled.

Deeper analysis of the swapped rows found the bug is more precise than a simple label swap: **only
the team-identity fields (`awaySlug`/`awayAbbr`/`awayName`/`awayTeamId` and the `home*`
counterparts) are reversed — the `awayScore`/`homeScore` columns stay in their original position**.
Concretely: for 3,642 of the 3,684 swapped rows, `mlb_schedule_history.awayScore ==
corpus.awayScore` and `.homeScore == corpus.homeScore` when compared *positionally*, even though
the team name attached to the "away" slot is wrong. Example (`anGameId 190578`, 2023-03-30):
`mlb_schedule_history` says away=Boston Red Sox (score 10), home=Baltimore Orioles (score 9);
corpus says away=Baltimore Orioles (score 10), home=Boston Red Sox (score 9) — the runs (10, 9) are
correct in the away/home slots, only the team labels in those slots are swapped.

**Consequence:** because `awayRunLineCovered`, `homeRunLineCovered`, and `awayWon` are all defined
relative to "away"/"home" team identity, **these derived columns are also inverted for the same
~3,642 rows** (a bettor-facing "who covered" field would name the wrong team).

**Adjudication: finding for owner, corpus wins on identity.** This must be corrected — a positional
swap of the four identity fields per affected row — before `mlb_schedule_history` is joined into
canonical `mlb_games` in Task 5. It is not an edge case to route around; it affects a large,
well-defined subset (2023-2025, ~44% of eligible rows) and is precisely characterized enough to
fix mechanically (detect via the AN-slug/date swap-match test in the reconciliation script, then
swap `away*`↔`home*` and re-derive `awayRunLineCovered`/`homeRunLineCovered`/`awayWon`).

### Score mismatches beyond the identity swap — 56 rows

After accounting for the identity swap (comparing positionally), 43 of the 3,684 swap-matched rows
*still* have a genuine score discrepancy (not explained by the swap), plus 13 of the 5,267
direct-matched rows. Total: 56 rows with real score errors independent of the identity-swap bug.
Sample `anGameId`s: 194010, 194009, 194063, 193488, 196304, 198324, 202585, 197235, 204449, 202324
(swap-oriented set — full list retained in `/private/tmp/mlb-audit/schedule_history_score_mismatches.json`,
not committed per the no-bulk-data-export rule) plus 190578's sibling direct-set entries surfaced
during the initial pass. **Adjudication: corpus wins (DERIVE).**

### 🔴 Finding — undocumented `game_type` column

`mlb_schedule_history.game_type` (`varchar(20)`, default `'regular_season'`, nullable) exists in
production but is **absent from `drizzle/schema.ts` and every committed migration** —
`grep -rl "game_type" drizzle/*.sql` returns nothing. This is schema drift: someone ran a manual
`ALTER TABLE` against production outside the Drizzle workflow. Values: `regular_season` (8,981),
`spring_training` (1,373), `postseason` (131). It is load-bearing for this audit (it's what let us
correctly exclude spring-training rows from the corpus comparison) and Task 1's migration author
needs to account for it explicitly — it isn't in the Task 1 plan's ALTER list (which only adds
`game_pk`), so `npx drizzle-kit generate` will likely try to "add" a column that already exists in
production unless the schema file is updated first.

---

## 3. `mlb_players.mlbamId` coverage

| Metric | Count |
|---|---:|
| Total rows | 1,403 |
| With `mlbamId` | 1,403 (100%) |
| Without `mlbamId` | 0 |
| Duplicate `mlbamId` values | 0 |
| Active (`isActive=1`) | 1,325 |
| Inactive (`isActive=0`) | 78 |

**Clean.** No null-`mlbamId` rows to enumerate — this table is fully crosswalk-ready and low-risk
for the Task 5 merge (`mlb_players.mlbamId` → `mlb_people.mlbam_id`, `mlb_players.brId` →
`mlb_people.br_id`).

---

## 4. Crosswalk-harvest counts (`mlb_lineups` / `mlb_strikeout_props` / `mlb_hr_props`)

| Table | Rows | Distinct `mlbamId` | Distinct `rotowireId` | Distinct `anPlayerId` | Distinct `retrosheetId` |
|---|---:|---:|---:|---:|---:|
| `mlb_lineups` | 1,625 | away 249 / home 236 | away 263 / home 251 | — | — |
| `mlb_strikeout_props` | 2,967 | 260 | — | 255 | 36 (sparse) |
| `mlb_hr_props` | 18,407 | 560 | — | 571 | — |

- **RotoWire↔MLBAM crosswalk quality (from `mlb_lineups`):** 269 distinct RotoWire ids pair with a
  non-null `mlbamId`; **zero rotowireId maps to more than one mlbamId** — this is a clean 1:1
  crosswalk source, safe to harvest directly (first-seen-wins conflict logic in Task 5 will find no
  conflicts to report from this table).
- **Union distinct `mlbamId` across all three harvest tables:** 847.
- **Of those 847, only 2 are not already present in `mlb_players`:** `671734` and `677651`. The
  crosswalk-harvest merge's main value is populating `rotowire_id`/`an_player_id`/`retrosheet_id`
  on `mlb_people` rows already known via `mlb_players`, not discovering new person identities — at
  most 2 net-new people will surface from this harvest.

---

## Adjudication summary (mismatch classes → disposition)

| Mismatch class | Count | Adjudication |
|---|---:|---|
| `games`: no `mlbGamePk`, postponed-and-unplayed-that-day | 2 | Accept, not a gap |
| `games`: All-Star Game missing `mlbGamePk` crosswalk | 1 | Finding for owner |
| `games`: score wrong on "final" rows | 9 | Corpus wins (DERIVE) + finding for owner (live-pipeline bug, 2026-05-05) |
| `games`: doubleheader flag under-reports | 67 | Corpus wins (DERIVE) |
| `games`: stale date on rescheduled-but-not-final rows | 7 | Accept-with-note |
| `games`: genuine 1-day schedule drift, upcoming game | 1 | Finding for owner |
| `mlb_schedule_history`: spring training / cancelled | 1,377 | Accept, out of corpus scope by design |
| `mlb_schedule_history`: All-Star rows, no slug crosswalk | 4 | Finding, minor (easy fix: special-case AL/NL) |
| `mlb_schedule_history`: postponed/suspended never re-tracked | 123 | Accept-with-note |
| `mlb_schedule_history`: mislabeled exhibition games as regular_season | 15 | Finding (data-quality mislabel) |
| `mlb_schedule_history`: one-day officialDate encoding drift (Speedway Classic) | 1 | Accept-with-note |
| `mlb_schedule_history`: away/home identity reversed, 2023-2025 | 3,642 | **Finding for owner — must fix before Task 5 merge** |
| `mlb_schedule_history`: genuine score errors | 56 | Corpus wins (DERIVE) |
| `mlb_schedule_history`: undocumented `game_type` column | 1 column | Finding for owner — Task 1 migration must account for it |
| `mlb_players`: null `mlbamId` | 0 | N/A — clean |

---

## Headline counts

- `games` sport='MLB': **7,230 total, 7,227 matched to corpus by `mlbGamePk` (99.96%)**, 3
  fallback-key rows (2 expected postponement placeholders, 1 crosswalk gap).
- `mlb_schedule_history`: **10,485 total, 8,951 mapped to a `gamePk` (98.3% of the 9,104 eligible
  rows)**, 138 truly unmatched (mostly expected postponement staleness).
- `mlb_players`: **1,403 / 1,403 (100%) have `mlbamId`**, 0 nulls, 0 duplicates.
- Crosswalk harvest yields at most **2 net-new person identities** beyond `mlb_players`, but
  populates `rotowire_id` (269 clean pairs), `an_player_id` (up to 826 distinct across props
  tables), and `retrosheet_id` (36, sparse) crosswalk columns for the merge.

## Gate status

Both required documents are complete. All mismatches enumerated above carry an explicit
adjudication (corpus-wins / accept-with-note / finding-for-owner) per the brief's gate rule. **The
`mlb_schedule_history` away/home identity-swap finding and the undocumented `game_type` column are
the two items that most need owner attention before Task 5 (crosswalk merge) proceeds** — both are
well-characterized and mechanically fixable, but should not be silently patched by the merge script
without an explicit decision recorded.
