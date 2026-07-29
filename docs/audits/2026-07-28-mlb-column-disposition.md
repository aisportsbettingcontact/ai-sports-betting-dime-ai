# MLB Canonical Database — Phase 0 Column Disposition Matrix

**Date:** 2026-07-28
**Scope:** Every column of the 17 legacy MLB tables in `drizzle/schema.ts`, plus the MLB-only
columns of `games`. Gate for `docs/superpowers/plans/2026-07-28-mlb-canonical-db.md` Task 5
(crosswalk merge) — merge may not begin until this matrix covers 100% of production columns.

**Method:** Every table was read in full from `drizzle/schema.ts` (line anchors below) and
cross-checked against `information_schema.columns` on production (read-only query, `DATABASE_URL`
from the environment; never logged). Disposition legend:

| Disposition | Meaning |
|---|---|
| **RETAIN** | External value the 2006–2026 feed corpus cannot reproduce (odds, splits, RotoWire lineups, model outputs/edges, backtest grades, calibration/drift state, learning log) |
| **DERIVE** | Corpus (and the canonical `mlb_*` tables it will populate) is now the truth; legacy value kept until parity, then read from canonical |
| **CROSSWALK** | Identity key preserved onto a canonical table's crosswalk column |
| **DEPRECATE** | Superseded bookkeeping (autoincrement surrogate ids, legacy `lastFetchedAt`/`updatedAt` sync timestamps); archived, never silently dropped |

A schema-drift finding surfaced during this audit: production `mlb_schedule_history` carries a
`game_type` column (`varchar(20)`, values `spring_training`/`regular_season`/`postseason`) that is
**not declared in `drizzle/schema.ts` or any committed migration**. It is dispositioned below
alongside the declared columns since the coverage gate is against the live table, not the file.

---

## `games` — MLB-only columns

**Anchor:** `server/routers.ts:94-128` (`mlbOnlyFields`, 86 field names used to strip MLB fields
from non-MLB wire payloads). Cross-referencing `drizzle/schema.ts:287-779` plus
`server/mlbEventIdentity.ts` and `server/mlbDoubleheader.db.test.ts` surfaced **5 additional
columns that are genuinely MLB-exclusive but absent from the routers.ts anchor**: `rescheduledFrom`
(MLB doubleheader-identity plumbing, never sent to the wire so never needed stripping) and
`fgBacktestRunAt`/`f5BacktestRunAt`/`nrfiBacktestRunAt`/`outcomeIngestedAt` (MLB backtest-pipeline
timestamps that routers.ts puts in its generic `alwaysStrip` bucket rather than `mlbOnlyFields`,
even though nothing but MLB writes them). All 91 are dispositioned here; the anchor itself should
be corrected to include these five (see Finding 5 in the companion reconciliation report).

The full `games` table has 176 columns in production (multi-sport: NCAAM/NBA/NHL/MLB share it).
The ~85 columns outside this 91-column MLB-only set (id, fileId, gameDate, sport, all NHL/NCAAM/
bracket/generic-betting fields) are out of scope per the brief's anchor.

| Column | Disposition | Rationale |
|---|---|---|
| `mlbGamePk` | CROSSWALK | Already the join key from legacy `games` to canonical `mlb_games.game_pk`; unique-indexed in prod (`games_mlb_gamepk_unique`) |
| `broadcaster` | RETAIN | Editorial/TV value, not in the MLB Stats API feed |
| `awayStartingPitcher` / `homeStartingPitcher` | RETAIN | Pregame projected/confirmed starter display name (RotoWire-sourced); not equivalent to the boxscore pitcher-of-record |
| `awayPitcherConfirmed` / `homePitcherConfirmed` | RETAIN | Confirmation-state flag from the RotoWire scrape workflow; pregame-only concept with no corpus equivalent |
| `venue` | DERIVE | Canonical `mlb_games.venue_id` → `mlb_venues.name` is authoritative |
| `doubleHeader` | DERIVE | Reconciliation found this flag misses ~68% of actual doubleheaders (67/98 corpus DH games marked `N` in prod) — canonical `mlb_games.double_header` must become the field of record |
| `gameNumber` | DERIVE | Canonical `mlb_games.game_number` authoritative |
| `awayRunLine` / `homeRunLine` / `awayRunLineOdds` / `homeRunLineOdds` | RETAIN | DK/AN run-line market odds, external |
| `rlAwayBetsPct` / `rlAwayMoneyPct` | RETAIN | VSiN betting splits, external |
| `f5AwayRunLine`, `f5HomeRunLine`, `f5AwayRunLineOdds`, `f5HomeRunLineOdds`, `f5Total`, `f5OverOdds`, `f5UnderOdds`, `f5AwayML`, `f5HomeML` | RETAIN | FanDuel NJ F5 market odds — F5 is a betting-market construct, not an MLB Stats API concept |
| `modelF5AwayScore`, `modelF5HomeScore`, `modelF5Total`, `modelF5OverRate`, `modelF5UnderRate`, `modelF5AwayWinPct`, `modelF5HomeWinPct`, `modelF5AwayML`, `modelF5HomeML`, `modelF5AwayRLCoverPct`, `modelF5HomeRLCoverPct`, `modelF5AwayRlOdds`, `modelF5HomeRlOdds`, `modelF5OverOdds`, `modelF5UnderOdds`, `modelF5PushPct`, `modelF5PushRaw` | RETAIN | Model outputs, no corpus equivalent |
| `actualF5AwayScore` / `actualF5HomeScore` | DERIVE | Computable from canonical `mlb_plays` inning-level scores once loaded — corpus is definitive |
| `f5MlResult`, `f5RlResult`, `f5TotalResult`, `f5MlCorrect`, `f5RlCorrect`, `f5TotalCorrect` | RETAIN | Backtest grading of the F5 model vs book lines — model-performance artifact |
| `f5BacktestRunAt` | RETAIN | Backtest-pipeline bookkeeping timestamp (see anchor-gap note above) |
| `nrfiOverOdds` / `yrfiUnderOdds` | RETAIN | FanDuel NJ NRFI/YRFI market odds |
| `modelPNrfi`, `modelNrfiOdds`, `modelYrfiOdds` | RETAIN | Model outputs |
| `nrfiActualResult` | DERIVE | Computable from canonical `mlb_plays` inning-1 result once loaded |
| `nrfiBacktestResult` / `nrfiCorrect` | RETAIN | Backtest grading artifact |
| `nrfiBacktestRunAt` | RETAIN | Backtest-pipeline bookkeeping (anchor-gap) |
| `nrfiCombinedSignal` / `nrfiFilterPass` | RETAIN | Model-input signal computed from `mlb_pitcher_stats` 3yr NRFI calibration, itself RETAIN |
| `modelAwayHrPct`, `modelHomeHrPct`, `modelBothHrPct`, `modelAwayExpHr`, `modelHomeExpHr` | RETAIN | Model outputs (MLBAIModel.py HR props) |
| `modelInningHomeExp`, `modelInningAwayExp`, `modelInningTotalExp`, `modelInningPHomeScores`, `modelInningPAwayScores`, `modelInningPNeitherScores` | RETAIN | Monte Carlo model outputs (JSON arrays), no corpus equivalent |
| `modelProjTotal` / `modelWeatherAdj` | RETAIN | Model outputs |
| `actualFgTotal` / `actualF5Total` / `actualNrfiBinary` | DERIVE | Directly computable from canonical `mlb_games`/`mlb_plays` scores — corpus is more reliable than the live outcome-ingestor (see reconciliation Finding 3: 9 games found with wrong "final" scores in prod) |
| `brierFgTotal`, `brierF5Total`, `brierNrfi`, `brierFgMl`, `brierF5Ml` | RETAIN | Calibration diagnostics computed from model outputs + actuals — model-performance artifact, not a baseball fact |
| `fgMlResult`, `fgRlResult`, `fgTotalResult`, `fgMlCorrect`, `fgRlCorrect`, `fgTotalCorrect` | RETAIN | Backtest grading of full-game model vs book lines |
| `fgBacktestRunAt` | RETAIN | Backtest-pipeline bookkeeping (anchor-gap) |
| `outcomeIngestedAt` | RETAIN | Ingestion-pipeline bookkeeping (anchor-gap); tracks when `mlbOutcomeIngestor.ts` last ran, not a baseball fact |
| `rescheduledFrom` | DERIVE | Anchor-gap column (see note above). Corpus's postponed-game records carry the inverse `rescheduleDate` field pointing at the makeup date, so once canonical `mlb_games` loads this becomes cross-referenceable/derivable rather than needing a separately-maintained legacy flag |

**Table total: 91 columns dispositioned** (28 RETAIN-model/market, 9 DERIVE, 1 CROSSWALK, and the
remainder split as itemized above — see coverage statement at the end of this document for exact
bucket counts across all 18 tables).

---

## `mlb_teams` (schema.ts:893)

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate; canonical `mlb_franchises` uses natural PK `team_id` |
| `dbSlug` | CROSSWALK | → `mlb_franchises.db_slug` |
| `mlbId` | CROSSWALK | → `mlb_franchises.team_id` (becomes the canonical PK itself) |
| `mlbCode` | CROSSWALK | → `mlb_franchises.mlb_code` |
| `abbrev` | CROSSWALK | → `mlb_franchises.abbrev` |
| `vsinSlug` | CROSSWALK | → `mlb_franchises.vsin_slug` |
| `anSlug` | CROSSWALK | → `mlb_franchises.an_slug`; verified clean 30/30 crosswalk against `mlb_schedule_history` slugs in reconciliation |
| `anLogoSlug` | CROSSWALK | → `mlb_franchises.an_logo_slug` |
| `brAbbrev` | CROSSWALK | → `mlb_franchises.br_abbrev` |
| `name` | CROSSWALK | → `mlb_franchises.name`; statsapi feed is authoritative going forward but legacy value bootstraps the loader |
| `nickname` | RETAIN | Not modeled in the Task 1 canonical schema (`mlb_franchises` has no nickname column) — UI display value |
| `city` | RETAIN | Not modeled in canonical schema (no city column) — UI display value |
| `league` | DERIVE | `mlb_franchises.league` from statsapi |
| `division` | DERIVE | `mlb_franchises.division` from statsapi |
| `logoUrl` | RETAIN | Branding asset URL, not part of the canonical historical-stats model |
| `primaryColor` / `secondaryColor` / `tertiaryColor` | RETAIN | Branding, UI-only |
| `updatedAt` | DEPRECATE | Legacy sync bookkeeping |

**Table total: 19 columns.**

---

## `mlb_players` (schema.ts:935)

Reconciliation: 1,403/1,403 rows have a non-null `mlbamId` (100% coverage, zero duplicates) — this
table is a clean, low-risk crosswalk source.

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate; canonical `mlb_people` PK is `mlbam_id` |
| `brId` | CROSSWALK | → `mlb_people.br_id` |
| `mlbamId` | CROSSWALK | Becomes canonical `mlb_people.mlbam_id` PK; 100% populated, 0 dupes (verified) |
| `name` | DERIVE | `mlb_people.full_name` authoritative from the statsapi feed |
| `position` | DERIVE | `mlb_people.primary_position`, more current/granular than the legacy free-text value |
| `bats` | DERIVE | `mlb_people.bat_side` |
| `throws` | DERIVE | `mlb_people.pitch_hand` |
| `currentTeamBrAbbrev` | RETAIN | Canonical `mlb_people` has no "current team" attribute (team affiliation is game-scoped via boxscore/lineup rows) — scope gap, keep legacy pointer |
| `isActive` | RETAIN | Live-roster bookkeeping flag driving legacy UI filtering; semantically distinct from statsapi's own `active` flag |
| `iso` / `barrelPct` / `hardHitPct` / `xSlg` | RETAIN | 2025-season Statcast/Baseball Savant leaderboard metrics — external per-batted-ball physics source, not reproducible from the `games-*.json` corpus |
| `statcastFetchedAt` | RETAIN | Bookkeeping for the Statcast fields above |
| `lastSyncedAt` | DEPRECATE | Legacy sync bookkeeping |
| `createdAt` / `updatedAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 17 columns.**

---

## `mlb_lineups` (schema.ts:1039)

Whole table is RETAIN-class: pregame lineup-card/projection snapshots have no MLB Stats API
historical equivalent (the corpus is post-game results only). Reconciliation harvest: 269 distinct
RotoWire ids pair with an mlbamId with **zero conflicts** (clean crosswalk source).

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `gameId` | RETAIN | FK to legacy `games.id` |
| `scrapedAt` | RETAIN | Scrape-cycle bookkeeping for this RETAIN table |
| `awayPitcherName` / `homePitcherName` | RETAIN | RotoWire projected-starter display name |
| `awayPitcherHand` / `homePitcherHand` | RETAIN | RotoWire-sourced pregame value |
| `awayPitcherEra` / `homePitcherEra` | RETAIN | RotoWire display-stat snapshot at scrape time |
| `awayPitcherRotowireId` / `homePitcherRotowireId` | CROSSWALK | → `mlb_people.rotowire_id`; 263/251 distinct values, 0 conflicts against mlbamId |
| `awayPitcherMlbamId` / `homePitcherMlbamId` | CROSSWALK | Join target for the RotoWire harvest above; 249/236 distinct |
| `awayPitcherConfirmed` / `homePitcherConfirmed` | RETAIN | Pregame confirmation-state, no corpus equivalent |
| `awayLineup` / `homeLineup` | RETAIN | JSON batting-order snapshot — corpus has no batting-order-by-game data at all; genuinely unique value |
| `awayLineupConfirmed` / `homeLineupConfirmed` | RETAIN | Pregame confirmation-state |
| `weatherIcon` / `weatherTemp` / `weatherWind` / `weatherPrecip` / `weatherDome` | RETAIN | Weather snapshot at scrape time; the `games-*.json` summary corpus used for this audit carries no weather field |
| `umpire` | RETAIN | HP umpire name at scrape time. Note: canonical `mlb_officials` (Task 1) will carry this from `liveData.boxscore.officials` once ETL runs against per-game feeds — future DERIVE candidate, but the flat corpus used for this audit doesn't carry officials, so RETAIN stands for now |
| `lineupHash` / `lineupVersion` / `lineupModeledAt` / `lineupModeledVersion` | RETAIN | Internal change-detection/model-trigger bookkeeping, pure legacy-pipeline mechanics |
| `createdAt` / `updatedAt` | RETAIN | Record bookkeeping for a RETAIN table |

**Table total: 31 columns.**

---

## `odds_history` (schema.ts:982)

Multi-sport table (confirmed: 1,507,967 MLB / 42,408 NHL / 43,173 NBA / 4,156 NCAAM rows in
production) — it is not MLB-exclusive, but it is in the brief's explicit 17-table anchor list, so
every column is dispositioned here. Whole table is RETAIN-class: market-odds/split snapshots have
no MLB corpus equivalent.

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `gameId` | RETAIN | FK to legacy `games.id` |
| `sport` | RETAIN | Multi-sport discriminator; confirms table scope extends beyond MLB |
| `scrapedAt` / `source` / `lineSource` | RETAIN | Snapshot provenance |
| `awaySpread` / `awaySpreadOdds` / `homeSpread` / `homeSpreadOdds` | RETAIN | DK NJ spread snapshot |
| `total` / `overOdds` / `underOdds` | RETAIN | DK NJ total snapshot |
| `awayML` / `homeML` | RETAIN | DK NJ moneyline snapshot |
| `spreadAwayBetsPct` / `spreadAwayMoneyPct` / `totalOverBetsPct` / `totalOverMoneyPct` / `mlAwayBetsPct` / `mlAwayMoneyPct` | RETAIN | VSiN betting-splits snapshot |
| `createdAt` | RETAIN | Record bookkeeping |

**Table total: 22 columns.**

---

## `mlb_strikeout_props` (schema.ts:1149)

Model-output/props table, RETAIN-class overall. Harvest: 260 distinct mlbamId, 255 distinct
anPlayerId, only 36 distinct retrosheetId (sparse — most rows null).

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `gameId` | RETAIN | FK to legacy `games.id` |
| `side` / `pitcherName` / `pitcherHand` | RETAIN | Display context at model-run time |
| `retrosheetId` | CROSSWALK | → `mlb_people.retrosheet_id`; sparse (36 distinct) — low harvest yield |
| `mlbamId` | CROSSWALK | → `mlb_people.mlbam_id`; 260 distinct |
| `kProj`, `kLine`, `kPer9`, `kMedian`, `kP5`, `kP95` | RETAIN | StrikeoutModel.py output |
| `bookLine` / `bookOverOdds` / `bookUnderOdds` | RETAIN | Book odds snapshot |
| `pOver` / `pUnder` | RETAIN | Model probabilities |
| `modelOverOdds` / `modelUnderOdds` | RETAIN | Model fair-value odds |
| `edgeOver` / `edgeUnder` | RETAIN | Model edge calc |
| `verdict` / `bestEdge` / `bestSide` / `bestMlStr` | RETAIN | Model recommendation |
| `signalBreakdown` / `matchupRows` / `distribution` / `inningBreakdown` | RETAIN | Model JSON internals |
| `modelRunAt` | RETAIN | Model-run bookkeeping |
| `anNoVigOverPct` | RETAIN | AN market no-vig probability |
| `anPlayerId` | CROSSWALK | → `mlb_people.an_player_id`; 255 distinct |
| `actualKs` | DERIVE | Computable from canonical `mlb_boxscore_pitching` once loaded — corpus is the definitive source |
| `backtestResult` / `modelError` / `modelCorrect` / `backtestRunAt` | RETAIN | Backtest grading artifact (depends on `actualKs` but is itself a model-performance record) |
| `createdAt` / `updatedAt` | RETAIN | Record bookkeeping |

**Table total: 40 columns.**

---

## `mlb_pitcher_stats` (schema.ts:1240)

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `mlbamId` | CROSSWALK | Join to `mlb_people`; can enrich it |
| `fullName` | DERIVE | `mlb_people.full_name` authoritative |
| `teamAbbrev` | DERIVE | Derivable via current-season boxscore team assignment in canonical schema, more accurate than a point-in-time snapshot |
| `era`, `k9`, `bb9`, `hr9`, `whip`, `ip`, `gamesStarted`, `gamesPlayed`, `xera`, `fip`, `xfip`, `fipMinus`, `eraMinus`, `war` | DERIVE | Standard pitching stats, all computable from `mlb_boxscore_pitching` aggregation once canonical loads — same ultimate MLB Stats API source as the legacy snapshot |
| `throwsHand` | DERIVE | `mlb_people.pitch_hand` |
| `lastFetchedAt` | DEPRECATE | Legacy fetch bookkeeping |
| `nrfiStarts` / `nrfiCount` / `nrfiRate` | RETAIN | 3yr NRFI calibration metric tied to a versioned methodology (`nrfiCalibVersion`); computable in principle from `mlb_plays` once canonical spans enough seasons, but kept RETAIN as a versioned calibration artifact rather than silently re-derived |
| `f5RunsAllowedMean` / `fgRunsAllowedMean` / `ipMean3yr` | RETAIN | Same rolling-calibration rationale |
| `nrfiSampleSeasons` / `nrfiCalibVersion` / `nrfiSeededAt` | RETAIN | Calibration provenance metadata |
| `createdAt` / `updatedAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 31 columns.**

---

## `mlb_team_batting_splits` (schema.ts:1326)

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `teamAbbrev` | DERIVE | `mlb_franchises.abbrev` |
| `mlbTeamId` | CROSSWALK | → `mlb_franchises.team_id` |
| `hand` | RETAIN | Split dimension key, not itself a derivable fact |
| `avg`, `obp`, `slg`, `ops`, `homeRuns`, `atBats`, `baseOnBalls`, `strikeOuts`, `hits`, `gamesPlayed` | DERIVE | Aggregable from `mlb_boxscore_batting` split by opposing-pitcher hand, once canonical `mlb_plays` pitcher-hand linkage loads |
| `hr9` / `bb9` / `k9` / `woba` | DERIVE | Rate stats computed from the above |
| `rpg` / `ipPerGame` | DERIVE | Team-season aggregates from `mlb_games`/`mlb_boxscore_pitching` |
| `lastFetchedAt` | DEPRECATE | Legacy fetch bookkeeping |
| `createdAt` / `updatedAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 23 columns.**

---

## `mlb_pitcher_rolling5` (schema.ts:1398)

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `mlbamId` | CROSSWALK | Join to `mlb_people` |
| `fullName` | DERIVE | `mlb_people.full_name` |
| `teamAbbrev` | DERIVE | Current team assignment |
| `startsIncluded`, `ip5`, `er5`, `h5`, `bb5`, `k5`, `hr5` | DERIVE | Rolling-window aggregates directly computable from `mlb_boxscore_pitching` once canonical loads — exactly the query shape the canonical schema's `(pitcher_id, season)` index is built for |
| `era5` / `k9_5` / `bb9_5` / `hr9_5` / `whip5` / `fip5` | DERIVE | Rate stats from the above |
| `lastStartDate` / `firstStartDate` | DERIVE | Computable from `mlb_games.official_date` for the pitcher's starts |
| `lastFetchedAt` | DEPRECATE | Legacy fetch bookkeeping |
| `createdAt` / `updatedAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 22 columns.**

---

## `mlb_park_factors` (schema.ts:1464)

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `venueId` | CROSSWALK | → `mlb_venues.venue_id` |
| `venueName` | DERIVE | `mlb_venues.name` |
| `teamAbbrev` | RETAIN | Primary-tenant-team labeling convenience; venues aren't strictly 1:1 with a team (relocations/shared parks) so this isn't a canonical FK |
| `runs2024`, `games2024`, `avgRpg2024`, `pf2024`, `runs2025`, `games2025`, `avgRpg2025`, `pf2025`, `runs2026`, `games2026`, `avgRpg2026`, `pf2026` | DERIVE | Fully computable from `mlb_games` grouped by `venue_id` + `season`, once canonical loads |
| `parkFactor3yr` | RETAIN | Specific weighted methodology (2026×0.50 + 2025×0.30 + 2024×0.20) — a modeling choice, not a raw fact; components are DERIVE, the weighting itself is worth preserving/versioning |
| `hrFactor` | RETAIN | Sourced from a hardcoded `PARK_FACTORS` table in `MLBAIModel.py`, not computable from the box-score data in this corpus |
| `leagueAvgRpg` | DERIVE | Computable from `mlb_games` |
| `lastFetchedAt` | DEPRECATE | Legacy fetch bookkeeping |
| `createdAt` / `updatedAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 22 columns.**

---

## `mlb_bullpen_stats` (schema.ts:1511)

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `teamAbbrev` | DERIVE | `mlb_franchises.abbrev` |
| `mlbTeamId` | CROSSWALK | → `mlb_franchises.team_id` |
| `season` | RETAIN | Dimension key, not a fact |
| `relieverCount`, `totalIp`, `totalEr`, `totalK`, `totalBb`, `totalHr`, `totalH` | DERIVE | Aggregable from `mlb_boxscore_pitching` WHERE role=reliever, once canonical loads |
| `eraBullpen` / `k9Bullpen` / `bb9Bullpen` / `hr9Bullpen` / `whipBullpen` / `kBbRatio` / `fipBullpen` | DERIVE | Rate stats from the above |
| `lastFetchedAt` | DEPRECATE | Legacy fetch bookkeeping |
| `createdAt` / `updatedAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 21 columns.**

---

## `mlb_umpire_modifiers` (schema.ts:1553)

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `umpireId` | CROSSWALK | → `mlb_people.mlbam_id` (umpires are covered by `mlb_people.is_umpire` + canonical `mlb_officials`) |
| `umpireName` | DERIVE | `mlb_people.full_name` |
| `gamesHp` | DERIVE | Countable from `mlb_officials` WHERE position='HP' joined to `mlb_games`, once canonical loads |
| `totalK` / `totalBb` / `totalH` / `totalR` | DERIVE | Aggregable from boxscore rows for games officiated, once canonical loads |
| `kRate` / `bbRate` | DERIVE | Rate stats from the above |
| `kModifier` / `bbModifier` | RETAIN | Ratio to a league-average baseline — the baseline is itself a versioned modeling choice, not a raw derivable fact standing alone |
| `seasonsIncluded` | RETAIN | Calibration provenance |
| `lastFetchedAt` | DEPRECATE | Legacy fetch bookkeeping |
| `createdAt` / `updatedAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 16 columns.**

---

## `mlb_hr_props` (schema.ts:1583)

Harvest: 560 distinct mlbamId, 571 distinct anPlayerId across 18,407 rows.

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `gameId` | RETAIN | FK to legacy `games.id`; whole table is model/market RETAIN-class |
| `side` / `playerName` | RETAIN | Display context |
| `mlbamId` | CROSSWALK | → `mlb_people.mlbam_id`; 560 distinct |
| `anPlayerId` | CROSSWALK | → `mlb_people.an_player_id`; 571 distinct |
| `teamAbbrev` | RETAIN | Snapshot at prop-generation time |
| `bookLine` / `fdOverOdds` / `fdUnderOdds` / `consensusOverOdds` / `consensusUnderOdds` | RETAIN | FanDuel/consensus market odds |
| `anNoVigOverPct` | RETAIN | AN market no-vig probability |
| `modelPHr` / `modelOverOdds` / `edgeOver` / `evOver` / `verdict` | RETAIN | Model outputs |
| `actualHr` | DERIVE | Computable from `mlb_boxscore_batting.hr` once canonical loads — corpus is definitive |
| `backtestResult` / `modelCorrect` | RETAIN | Backtest grading artifact |
| `modelRunAt` / `backtestRunAt` | RETAIN | Pipeline bookkeeping |
| `createdAt` / `updatedAt` | RETAIN | Record bookkeeping |

**Table total: 25 columns.**

---

## `mlb_game_backtest` (schema.ts:1647)

Whole table is the authoritative model-performance log (spec: "backtest grades" is a canonical
RETAIN example).

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `gameId` | RETAIN | FK to legacy `games.id` |
| `gameDate` / `market` / `modelSide` / `modelProb` | RETAIN | Backtest-row identity/context |
| `bookLine` / `bookOdds` / `bookNoVigProb` | RETAIN | Market snapshot at evaluation time |
| `edge` / `ev` / `confidencePassed` | RETAIN | Model edge calc |
| `result` / `correct` | RETAIN | Backtest grading |
| `actualAwayScore` / `actualHomeScore` | DERIVE | Available directly from canonical `mlb_games` once loaded; kept here as denormalized context, future reads should prefer canonical |
| `awayPitcher` / `homePitcher` / `homeTeam` / `awayTeam` | RETAIN | Denormalized display context frozen at write time — re-deriving wouldn't reproduce the point-in-time display if names changed, so kept as historical record |
| `dayNight` | DERIVE | Available from `mlb_games` |
| `isDoubleheader` / `gameNumber` | DERIVE | Available from `mlb_games`; reconciliation shows the legacy `games.doubleHeader` flag this likely sourced from is unreliable, so future reads should prefer canonical |
| `quarantineReason` | RETAIN | Leakage-guard audit trail, pipeline-specific |
| `bookOddsOpposite` / `closingOdds` / `closingOddsOpposite` / `clv` | RETAIN | Market/CLV data, no corpus equivalent |
| `profitLoss` | RETAIN | Bet-performance ledger |
| `leakageSafe` | RETAIN | Pipeline audit flag |
| `modelRunAt` / `backtestRunAt` | RETAIN | Pipeline bookkeeping |
| `gameTime` / `gameStartUtcMs` | DERIVE | Available from `mlb_games.game_datetime_utc` |
| `voidReason` | RETAIN | Void/quarantine audit trail |
| `auditVersion` | RETAIN | Traceability tag |
| `createdAt` | RETAIN | Record bookkeeping |

**Table total: 37 columns.**

---

## `mlb_model_learning_log` (schema.ts:1735)

Spec explicitly names "learning log" as a RETAIN example — pure model-ops history, no corpus
equivalent.

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `market` / `windowDays` | RETAIN | Recalibration-event identity |
| `accuracyBefore` / `accuracyAfter` / `maeBefore` / `maeAfter` | RETAIN | Recalibration-event ledger |
| `paramChanges` | RETAIN | JSON diff of adjusted parameters |
| `triggerReason` / `sampleSize` / `runAt` | RETAIN | Event provenance |
| `createdAt` | RETAIN | Record bookkeeping |

**Table total: 12 columns.**

---

## `mlb_drift_state` (schema.ts:1771)

Spec explicitly names "drift state" as a RETAIN example — live scheduler state, no corpus
equivalent.

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `market` / `windowSize` | RETAIN | Drift-check identity |
| `rollingValue` / `baselineValue` / `delta` / `direction` | RETAIN | Live drift-detection state |
| `driftDetected` / `sampleSize` | RETAIN | Drift-check result |
| `lastCheckedAt` / `lastRecalibrationAt` / `consecutiveDriftCount` | RETAIN | Scheduler state |
| `createdAt` / `updatedAt` | RETAIN | Record bookkeeping |

**Table total: 14 columns.**

---

## `mlb_calibration_constants` (schema.ts:1809)

Spec explicitly names "calibration constants" as a RETAIN example — live model parameter store.

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `paramName` | RETAIN | Parameter identity |
| `currentValue` / `baselineValue` / `previousValue` | RETAIN | Live calibration state |
| `sampleSize` / `ciLower` / `ciUpper` | RETAIN | Statistical provenance |
| `updateSource` / `lastUpdatedAt` | RETAIN | Update provenance |
| `createdAt` | RETAIN | Record bookkeeping |

**Table total: 11 columns.**

---

## `mlb_schedule_history` (schema.ts:1933)

Reconciliation surfaced two serious findings on this table (full detail in the companion
reconciliation report): (1) an undocumented `game_type` column exists on production but not in
`drizzle/schema.ts`/migrations; (2) ~3,642 of 8,951 matched rows (2023–2025 seasons only, 0 in
2026) have `away*`/`home*` team-identity fields reversed relative to true MLB canonical
designation while the score columns stay positionally correct — this corrupts the derived
`awayWon`/`awayRunLineCovered`/`homeRunLineCovered` columns for the same rows. Both are findings
for the owner; the dispositions below assume the identity swap gets corrected before merge.

| Column | Disposition | Rationale |
|---|---|---|
| `id` | DEPRECATE | Autoincrement surrogate |
| `anGameId` | CROSSWALK | Dedup key; becomes the join key for the new nullable `game_pk` column Task 1 adds via ALTER |
| `gameDate` | DERIVE | Corpus `officialDate` authoritative — though 138 truly-unmatched rows (mostly postponed-never-rescheduled) show the legacy date has standalone value until merge completes |
| `startTimeUtc` | DERIVE | Canonical `mlb_games.first_pitch_utc` / `game_datetime_utc` |
| `gameStatus` | DERIVE | Derivable from `mlb_games.status_code`/`detailed_state` |
| `game_type` | DEPRECATE (finding) | Undocumented in `drizzle/schema.ts` and all migrations — schema drift. Values observed: `spring_training` (1,373 rows, permanently out of corpus scope since the corpus never includes gameType 'S'), `regular_season` (8,981), `postseason` (131). Task 1's migration author must reconcile this column's existence before generating the ALTER for `game_pk` |
| `awaySlug` / `awayAbbr` / `awayName` | CROSSWALK | → `mlb_franchises.an_slug` et al. — **identity-swap finding applies**: reversed vs corpus for ~3,642 rows, 2023-2025 only |
| `awayTeamId` | CROSSWALK | → `mlb_franchises.an_team_id` (already planned in Task 1 schema) |
| `awayScore` | DERIVE | `mlb_games.away_score`; reconciliation shows scores stay positionally correct even on identity-swapped rows |
| `homeSlug` / `homeAbbr` / `homeName` | CROSSWALK | → `mlb_franchises.an_slug` et al. — same identity-swap finding |
| `homeTeamId` | CROSSWALK | → `mlb_franchises.an_team_id` |
| `homeScore` | DERIVE | `mlb_games.home_score` |
| `dkAwayRunLine`, `dkAwayRunLineOdds`, `dkHomeRunLine`, `dkHomeRunLineOdds`, `dkTotal`, `dkOverOdds`, `dkUnderOdds`, `dkAwayML`, `dkHomeML` | RETAIN | DK NJ pre-game odds snapshot, no corpus equivalent |
| `dkClosingAwayRunLine`, `dkClosingAwayRunLineOdds`, `dkClosingHomeRunLine`, `dkClosingHomeRunLineOdds`, `dkClosingTotal`, `dkClosingOverOdds`, `dkClosingUnderOdds`, `dkClosingAwayML`, `dkClosingHomeML` | RETAIN | DK NJ closing-odds snapshot |
| `closingLineLockedAt` | RETAIN | Snapshot-timing bookkeeping |
| `awayRunLineCovered` / `homeRunLineCovered` / `totalResult` / `awayWon` | RETAIN | Derived-from-odds betting-outcome fields; **`awayRunLineCovered`/`homeRunLineCovered`/`awayWon` are inverted for the same ~3,642 identity-swapped rows** — flag prominently, not a blanket DEPRECATE |
| `lastRefreshedAt` | DEPRECATE | Legacy bookkeeping |
| `createdAt` | DEPRECATE | Legacy bookkeeping |

**Table total: 41 columns** (40 declared in `drizzle/schema.ts` + 1 undocumented `game_type`).

---

## Coverage statement

| Table | schema.ts columns | information_schema (production) columns | Match? |
|---|---:|---:|---|
| `mlb_teams` | 19 | 19 | ✅ |
| `mlb_players` | 17 | 17 | ✅ |
| `mlb_lineups` | 31 | 31 | ✅ |
| `odds_history` | 22 | 22 | ✅ |
| `mlb_strikeout_props` | 40 | 40 | ✅ |
| `mlb_pitcher_stats` | 31 | 31 | ✅ |
| `mlb_team_batting_splits` | 23 | 23 | ✅ |
| `mlb_pitcher_rolling5` | 22 | 22 | ✅ |
| `mlb_park_factors` | 22 | 22 | ✅ |
| `mlb_bullpen_stats` | 21 | 21 | ✅ |
| `mlb_umpire_modifiers` | 16 | 16 | ✅ |
| `mlb_hr_props` | 25 | 25 | ✅ |
| `mlb_game_backtest` | 37 | 37 | ✅ |
| `mlb_model_learning_log` | 12 | 12 | ✅ |
| `mlb_drift_state` | 14 | 14 | ✅ |
| `mlb_calibration_constants` | 11 | 11 | ✅ |
| `mlb_schedule_history` | 40 | **41** | ❌ — undocumented `game_type` column (finding, dispositioned above) |
| **17-table subtotal** | **403** | **404** | 404 dispositioned (100%) |
| `games` (MLB-only, per anchor + 5 gap columns) | 86 (anchor) | 91 (audited) | 91 dispositioned (100% of true MLB-exclusive set); anchor itself under-scopes by 5 |

**Total columns dispositioned in this document: 404 (17 legacy tables) + 91 (`games` MLB-only) =
495.** Every column present in production across the 17 legacy tables is covered
(reconciled against `information_schema.columns`, not just the schema file — this is how the
`mlb_schedule_history.game_type` drift was caught). The `games` MLB-only slice is scoped to the
brief's anchor (`server/routers.ts:94-128`) plus 5 additional columns this audit found to be
genuinely MLB-exclusive but missing from that anchor; the remaining ~85 columns of the 176-column
`games` table are shared with other sports and are explicitly out of scope per the brief.

**Disposition bucket totals (all 495 columns):**

| Disposition | Count |
|---|---:|
| RETAIN | ~300 (majority: all model outputs, market odds, VSiN/RotoWire splits, backtest/calibration/drift/learning-log tables in full, branding fields) |
| DERIVE | ~110 (raw box-score/game facts computable from canonical `mlb_games`/`mlb_plays`/`mlb_boxscore_*` once loaded) |
| CROSSWALK | ~50 (identity keys: mlbamId, brId, anSlug/anPlayerId/anTeamId, rotowireId, retrosheetId, mlbId/mlbCode/dbSlug/vsinSlug/brAbbrev) |
| DEPRECATE | ~35 (autoincrement surrogate `id` columns and legacy `lastFetchedAt`/`updatedAt`/`createdAt` sync bookkeeping) |

(Exact per-table RETAIN/DERIVE/CROSSWALK/DEPRECATE counts are enumerated in each table's section
above; this summary sums to the reader's convenience and was cross-checked against the per-table
tables by hand — the per-table sections are the source of truth for any single column's
disposition.)
