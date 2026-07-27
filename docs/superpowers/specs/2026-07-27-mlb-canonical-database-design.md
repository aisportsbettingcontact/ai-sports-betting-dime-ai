# MLB Canonical Database — Design Spec

**Date:** 2026-07-27 · **Status:** Approved by owner (brainstorming session)
**Goal:** Make the verified 2006–2026 feed corpus (49,403 games, local `docs/mlb-stats-api/data/feeds-YYYY/`) the **canonical MLB database inside the Railway production MySQL**, with a forensic audit guaranteeing no existing MLB data of value is lost, omitted, or overlooked during the merge.

## Decisions (owner-confirmed)

1. **Everything lives in the Railway production MySQL** ("MySQL: Dime AI" service) — full pitch-level included.
2. **Forensic audit first.** The corpus is the truth, but every existing MLB column/row is dispositioned before any merge; nothing is dropped without an audit entry.
3. **New canonical tables alongside** the 17 legacy MLB tables; consumers migrate read-by-read behind reconciliation gates; the live feed/props serving path is untouched during migration.

## Non-goals

- No change to the projections-feed contract (`games.list`, props procedures) in this project.
- No Spring Training data. No non-MLB sports. No Tier-B (Okta) MLB endpoints.
- No deletion of legacy tables in this project — deprecation is a marker, not a drop.

## Phase 0 — Forensic audit (read-only, gating)

**Column disposition matrix** covering all 17 legacy MLB tables plus the ~60 MLB-only columns on `games` (enumerated at `server/routers.ts:94-128`). Every column gets exactly one disposition:

| Disposition | Meaning | Examples |
|---|---|---|
| RETAIN | External value the corpus cannot reproduce; preserved as-is and joined | AN/VSiN/DK odds & splits, RotoWire lineups, model outputs/edges, backtest grades, calibration constants, drift state, learning log |
| DERIVE | Corpus is now the truth; legacy value kept until parity, then read from canonical | scores, statuses, schedule, pitcher/team/bullpen stats, park factors, umpire assignments |
| CROSSWALK | Identity keys preserved onto canonical tables | `brId`, `anGameId`, `anPlayerId`, RotoWire ids, 7-way team slug map |
| DEPRECATE | Superseded; archived (exported to file), never silently dropped | one-off backfill artifacts |

**Row-level reconciliation** (pre-merge findings, each adjudicated):
- Every `games` row with `sport='MLB'` vs corpus by `mlbGamePk` (fallback: `gameDate`+teams+`gameNumber`): scores, status, doubleheader identity, dates.
- Every `mlb_schedule_history` row (AN-keyed, 2023–2026) mapped to a gamePk; unmatched rows reported, never dropped.
- `mlb_players.mlbamId` coverage vs corpus people; null-mlbamId rows enumerated.

**Gate:** the merge may not begin until the matrix covers 100% of columns and the reconciliation report exists with all mismatches adjudicated (fix, accept-with-note, or corpus-wins).

## Phase 1 — Canonical schema (`drizzle/mlb.schema.ts`)

Follows the CFB/NFL convention (snake_case, natural PKs, no surrogate ids). Names avoid collisions with legacy `mlb_teams`/`mlb_players`:

| Table | PK | Contents |
|---|---|---|
| `mlb_seasons` | `season` | season config (dates, qualifiers) from seasons endpoint/datasets |
| `mlb_franchises` | `team_id` (MLB Stats API) | franchise/team master + slug crosswalks (vsin, an, br, abbrev) |
| `mlb_venues` | `venue_id` | venue master + field dimensions (from feed `gameData.venue`) |
| `mlb_people` | `mlbam_id` | person master (players, umpires) + crosswalks (`br_id`, `an_player_id`, `rotowire_id`) |
| `mlb_games` | `game_pk` | one row per game, 21 seasons: identity (gameGuid, type, seriesDescription, DH/gameNumber), status, teams, scores, linescore totals, venue, weather, attendance, duration, decisions, umpire crew ids |
| `mlb_plays` | (`game_pk`,`at_bat_index`) | result/event type, description, scores, inning/half, batter/pitcher ids, splits, RBI/outs, win-prob context; runners & credits as JSON columns |
| `mlb_pitches` | `play_id` (UUID) | per-pitch: game_pk, at_bat_index, pitch_number, type/code/call, start/end speed, spin, extension, coordinates (px/pz), zone, per-batter strike zone, breaks, hit data (EV/LA/distance) when in play |
| `mlb_boxscore_batting` / `mlb_boxscore_pitching` | (`game_pk`,`mlbam_id`) | per player-game lines + batting order/position/status |
| `mlb_officials` | (`game_pk`,`mlbam_id`) | umpire assignments per game with position |

Indexes: `mlb_games(official_date)`, `(season, game_type)`, team-side indexes; `mlb_pitches(game_pk)`, `(pitcher_id, season)` via generated/derived column; `mlb_plays(batter_id)`, `(pitcher_id)`. Sizing estimate: ~13M pitches + 3.4M plays + ~3M boxscore lines ≈ 10–15 GB with indexes.

Schema deploys via the manual `db-push.yml` workflow **before** any dependent code (repo law).

## Phase 2 — ETL

- Local Python (`scripts/mlb-etl/`): feed JSON → per-season, per-table NDJSON; then batched multi-row upserts to Railway over `DATABASE_URL` (initial load ~2–4 h, season-resumable, idempotent by natural PK).
- Unit-tested transforms against fixture feeds already in hand (823433 modern; a 2006 feed; the 2016 tie 449244; a 2014 rain-shortened final; a 2020 7-inning DH game).
- Era-awareness is explicit: 2020 rules (7-inn DH, extras runner), ties, shortened finals, ABS-era strike zones (2026+), pre-Statcast fields nullable.
- Loader emits a per-season load manifest (rows in vs rows upserted per table) used by verification.

## Phase 3 — Merge/join (no-loss)

- Crosswalk population: legacy `mlb_teams` → `mlb_franchises` columns; legacy `mlb_players` (`brId`, Statcast metrics noted as 2025-vintage) → `mlb_people`; RotoWire/AN ids from lineups/props tables → `mlb_people`.
- `games.mlbGamePk` already joins the canonical store; `mlb_schedule_history.anGameId` gains a mapped `game_pk` column (audited).
- RETAIN tables unchanged and continue to be written by the live pipeline.

## Phase 4 — Consumer migration (read-by-read, gated)

Order: (1) schedule-history reads (`getLast5ForMatchup`, `getTeamSchedule`, `getSituationalStats`) → canonical `mlb_games` (gain 21 seasons); (2) stat seeders re-pointed only after per-table parity checks vs their legacy outputs; (3) model training/calibration gains historical depth (owner-directed, separate effort). The feed serving path does not change in this project.

## Phase 5 — Freshness

Nightly GitHub Actions cron (CRON_SECRET-authed endpoint or workflow script): rebuild `games-2026` delta → crawl new finals (resumable crawler) → ETL upsert → verify → reconciliation snapshot. Postseason arrives automatically (builder already covers gameTypes R,F,D,L,W,A with `seriesDescription`). All-Star/tie/shortened edge handling inherited from the verifier fixes.

## Phase 6 — Verification, validation, audit, confirmation

- **ETL invariants (CI-able):** `mlb_games` count = 49,403 (+ growth); per-season `mlb_plays` = Σ feed allPlays; `mlb_pitches` = Σ isPitch events, 100% playId-keyed; FK integrity (every play's game exists, every pitch's play exists); score cross-foot (games.linescore totals == Σ play scoring).
- **Cross-source:** sampled live-API three-way checks (API vs canonical DB vs corpus files) per era.
- **Reconciliation report v2:** post-merge re-run of Phase 0 row-level checks; drift monitor stays as a nightly artifact.
- **Independent audit:** a verification-supervisor subagent with no stake in the implementation re-derives all invariants from the production DB before the project is declared done.
- **Perf:** EXPLAIN checks on the hot consumer reads; index adjustments before cutover.

## Execution model

Subagent-driven development per phase (implementer + task reviewer + fix loop), season-parallel load agents for Phase 2, independent verification supervisors at Phase 0 (audit) and Phase 6 (final), one PR per phase, progress ledger throughout.

## Risks

- **Licensing (business action item, not build blocker):** canonical MLB feed data inside the production DB of a commercial betting product requires MLB licensing before public features depend on it.
- **Railway MySQL load:** 13M-row inserts must be batched/throttled to avoid starving the live 5-minute pipeline; load runs season-by-season with health checks.
- **Legacy identity gaps:** null `mlbamId` players and unmatched `anGameId` rows are findings, not silent joins.
- **DB size/backup:** volume growth ~10–15 GB; confirm Railway volume headroom and backup story before load.
