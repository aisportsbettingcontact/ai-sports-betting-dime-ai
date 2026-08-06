# Notes — Task 6 (WS-F): API & schema inventory

Evidence log, gaps, data-quality observations, and self-review for Steps 1–5. Machine-generated
counts below come verbatim from `scripts/step1_step2.R` and `scripts/step5_acceptance.R`
(both under `evidence/ws-f/scripts/`, run via `Rscript --vanilla`, no network calls made anywhere
in this task).

## Run metadata

- R.version.string: R version 4.6.1 (2026-06-24)
- Run timestamp: 2026-07-27 05:46:59 UTC
- Library path used (read-only): `/opt/homebrew/lib/R/4.6/site-library`
- All 6 target packages loaded successfully on the first attempt via `requireNamespace(pkg, lib.loc = LIB)` — no retries needed, no load failures.

## Package load + version check (all match the brief's pinned targets exactly)

| package | loaded | version |
|---|---|---|
| nflverse | TRUE | 1.0.3 |
| nflreadr | TRUE | 1.5.1 |
| nflfastR | TRUE | 5.2.0 |
| nflseedR | TRUE | 2.0.2 |
| nfl4th | TRUE | 1.0.7 |
| nflplotR | TRUE | 1.6.0 |

## Step 1: export inventory — per-package counts

Total rows written to `exports.csv`: **132**. Sort order: `package,symbol`, locale-independent
radix (C-locale byte order), per the brief's "Sort by package,symbol" instruction.

| package | total exports | function | data | reexport | error |
|---|---|---|---|---|---|
| nflverse | 4 | 2 | 0 | 2 | 0 |
| nflreadr | 54 | 52 | 2 | 0 | 0 |
| nflfastR | 27 | 21 | 0 | 6 | 0 |
| nflseedR | 12 | 11 | 0 | 1 | 0 |
| nfl4th | 7 | 7 | 0 | 0 | 0 |
| nflplotR | 28 | 23 | 3 | 2 | 0 |
| **all 6** | **132** | **116** | **5** | **11** | **0** |

**Kind classification method actually used** (per brief: "detect re-exports via
environment(get(sym)) namespace **or** the pkg's reexports Rd" — implemented as an OR of both
detectors, union'd):
1. `is.function(obj)` — FALSE and not a reexport ⇒ `kind="data"` (catch-all for non-function
   exports: 2 S4 `classRepresentation` objects in nflreadr, 3 `ggproto` layer objects in
   nflplotR — see "data-quality / shape observations" below).
2. Detector A: `environmentName(environment(obj)) != pkg` and that name is a currently-loaded
   namespace ⇒ reexport, source package = that environment name.
3. Detector B: symbol appears in that package's own `reexports.Rd` alias list (if one exists).
4. `kind="reexport"` if EITHER detector fires; otherwise `function` if `is.function`, else `data`.
5. `signature`: `is.function(obj)` only ⇒ `paste(deparse(args(obj)), collapse=" ")`, then
   whitespace-squeezed to one line (`gsub("\\s+"," ", ...)` + `trimws`); `""` for non-functions.
   This literally leaves the `NULL` that `deparse(args(fn))` always appends (the standard R
   idiom for a formals-only closure) — not stripped, since the brief specifies the signature as
   `deparse(args())` collapsed with no further transformation named.
6. `title`: alias→title map built from **every** Rd file in `tools::Rd_db(pkg)` (not just
   `reexports.Rd`), because some packages document a re-exported symbol under its own dedicated
   Rd instead of the generic reexports topic (see nflverse/nflplotR case below). `""` if no Rd
   alias matches the exported symbol anywhere in that package's own Rd database.

**Reexports detected (symbol <- source namespace), all 11:**
```
nflverse::%>% <- magrittr
nflverse::nflverse_sitrep <- nflreadr
nflfastR::load_pbp <- nflreadr
nflfastR::load_player_stats <- nflreadr
nflfastR::load_rosters <- nflreadr
nflfastR::load_schedules <- nflreadr
nflfastR::load_team_stats <- nflreadr
nflfastR::nflverse_sitrep <- nflreadr
nflseedR::load_schedules <- nflreadr
nflplotR::element_path <- ggpath
nflplotR::nflverse_sitrep <- nflreadr
```

**Reexport-Rd-documentation nuance found during Step 1 (worth recording — it's why the alias map
had to scan every Rd, not just `reexports.Rd`):** `nflverse` and `nflplotR` both re-export
`nflverse_sitrep` from `nflreadr` (confirmed via `identical(nflplotR::nflverse_sitrep,
nflreadr::nflverse_sitrep)` == `TRUE`), but **neither** package documents it in a generic
`reexports.Rd` topic — each ships its own dedicated `nflverse_sitrep.Rd` with the real title
("Get a Situation Report on System, nflverse Package Versions and Dependencies"). `nflplotR`'s
`reexports.Rd` topic exists but only covers `element_path`; had detection relied on
`reexports.Rd` alone (a literal reading of half the brief's "or" clause), `nflverse_sitrep` would
have been missed as a reexport in both `nflverse` and `nflplotR`, or would have shown a blank/
wrong title. The environment-based detector (the other half of the "or") caught both; the
full-Rd-database alias scan (rather than reexports.Rd-only) supplied the correct, non-generic
title in both cases.

**Exported symbols with NO Rd title match (`title=""` in exports.csv) — only 2 of 132:**
```
nflreadr::.__C__nflverse_data   (kind=data; S4 classRepresentation object, class union support type)
nflreadr::.__C__nflverse_sitrep (kind=data; S4 classRepresentation object, class union support type)
```
Both are R's auto-generated S4 class-representation bindings (the `.__C__<classname>` naming
convention), exported as a side effect of `setClass()`/`setClassUnion()` — not user-facing API,
and not documented by their own dedicated Rd topic anywhere in nflreadr's Rd database. This is
the brief's anticipated "some re-exports have no local Rd" case, generalized: these aren't
re-exports, they're auto-generated non-reexport exports with no Rd at all. Recorded per
instruction ("use \"\" and note it") rather than fabricating a title.

**Data-quality / shape observations from Step 1 (not gaps, just notable structure):**
- `nflreadr`'s 2 non-function exports are S4 `classRepresentation` objects
  (`.__C__nflverse_data`, `.__C__nflverse_sitrep`) — internal class-union machinery for
  `as.nflverse_data()`, not datasets in the ordinary sense.
- `nflplotR`'s 3 non-function exports (`GeomNFLheads`, `GeomNFLwordmark`, `GeomNFLlogo`) are
  `ggproto`/`Geom`/`gg`-classed objects — ggplot2 layer definitions, not datasets either. Both
  packages' "data" kind bucket is therefore a genuine catch-all for "non-function, non-reexport
  export," per the brief's 3-bucket kind scheme, not strictly "dataset."

## Step 1 self-review: spot-checked signatures/titles (4, exceeds the required 3)

Independently re-derived (fresh `get()` + `args()` + `Rd_db()` calls, outside the main script) and
diffed against the corresponding row in `exports.csv`. All 4 matched exactly (CSV shows
`""`-escaped embedded quotes per standard CSV convention, e.g. `sim_include = c(""DRAFT"", ...)`
represents the literal string `"DRAFT"` — confirmed correct, not corruption):

| package::symbol | signature match | title match |
|---|---|---|
| `nflseedR::simulate_nfl` | exact | exact ("Simulate an NFL Season") |
| `nflplotR::geom_nfl_logos` | exact | exact ("ggplot2 Layer for Visualizing NFL Team Logos") |
| `nflfastR::calculate_player_stats` | exact | exact ("Get Official Game Stats") |
| `nflverse::nflverse_packages` | exact | exact ("List all packages in the nflverse") |

## Step 2: dictionary dump — field counts (nrow of each shipped dictionary)

`data(package="nflreadr")` lists **26** total datasets. **22** match `^dictionary_`; all 22 were
written to `dictionaries/*.csv`. The other 4 (`nflverse_data_timezone`, `player_name_mapping`,
`team_abbr_mapping`, `team_abbr_mapping_norelocate`) are reference/lookup data, not
`dictionary_*`-named, and are out of Step 2's contracted scope (not written as CSVs there) — but
`team_abbr_mapping` was read directly (in-memory, not written to `dictionaries/`) to source the
team-abbreviation row in `dime-mapping.md`, cited there as package data rather than a dictionary
CSV.

| dictionary | fields (nrow) | columns (ncol) | column names |
|---|---|---|---|
| dictionary_combine | 18 | 3 | field, data_type, description |
| dictionary_contracts | 15 | 3 | field, data_type, description |
| dictionary_depth_charts | 12 | 3 | field, data_type, description |
| dictionary_draft_picks | 36 | 3 | field, data_type, description |
| dictionary_espn_qbr | 23 | 3 | field, data_type, description |
| dictionary_ff_opportunity | 218 | 4 | Field, Type, Dataframe, Description |
| dictionary_ff_playerids | 35 | 3 | field, data_type, description |
| dictionary_ff_rankings | 25 | 3 | field, data_type, description |
| dictionary_ftn_charting | 28 | 5 | field_name, field_type, ftn_field_name, order, description |
| dictionary_injuries | 16 | 3 | field, data_type, description |
| dictionary_nextgen_stats | 51 | 3 | field, data_type, description |
| dictionary_participation | 26 | 3 | Field, Type, Description |
| dictionary_pbp | 372 | 3 | Field, Description, Type |
| dictionary_pfr_passing | 28 | 3 | field, data_type, description |
| dictionary_player_stats | 114 | 3 | field, data_type, description |
| dictionary_players | 39 | 3 | field, data_type, description |
| dictionary_roster_status | 19 | 2 | status, description |
| dictionary_rosters | 37 | 3 | field, data_type, description |
| dictionary_schedules | 45 | 3 | field, data_type, description |
| dictionary_snap_counts | 16 | 3 | field, data_type, description |
| dictionary_team_stats | 102 | 3 | field, data_type, description |
| dictionary_trades | 11 | 3 | field, data_type, description |

Sum of all `dictionary_*` field rows across the 22 files: **1,286**.
Largest: `dictionary_pbp` (372). Smallest: `dictionary_trades` (11).

**Column-naming inconsistency observed (nflreadr-side, not a gap, just worth flagging):** column
names are not standardized across dictionaries. Most use lowercase `field, data_type,
description`, but `dictionary_pbp` uses `Field, Description, Type` (capitalized, and the middle
two columns swapped relative to the "field/type/description" order everywhere else),
`dictionary_participation` uses `Field, Type, Description` (capitalized, canonical order),
`dictionary_ff_opportunity` adds a 4th column (`Dataframe`), `dictionary_ftn_charting` uses an
entirely different 5-column shape (`field_name, field_type, ftn_field_name, order, description`),
and `dictionary_roster_status` is a 2-column status-code lookup, not a field dictionary at all.
Every dictionary was written to CSV byte-for-byte as shipped — no column renaming/normalization
was applied, per the "dump verbatim" instruction.

## Step 2 self-review: dictionary recount (required by the task)

Re-ran independently via `scripts/step5_acceptance.R` Check B: `data(package="nflreadr")`
dictionary_* count = 22; `dictionaries/*.csv` file count = 22; `setdiff()` both directions =
empty; `identical(sort(dicts), sort(have))` = `TRUE`. Exact 1:1 match confirmed, not just count
equality.

## Data-quality observations found while building schema-summary.md (Step 3) — genuine forensic findings, reported factually

1. **`game_id` / `old_game_id`: `dictionary_pbp` and `dictionary_schedules` disagree with each
   other, and each is internally inconsistent, for the same field name:**
   - `dictionary_pbp` row `game_id`: `type=character`, description *"Ten digit identifier for
     NFL game."*
   - `dictionary_schedules` row `game_id`: `type=numeric`, description *"A human-readable game
     ID. It consists of: the season, an underscore, the two-digit week number, an underscore,
     the away team, an underscore, the home team."*
   - The real format (confirmed via `nflreadr::nflverse_game_id(season, week, away, home)`,
     whose Rd documents `Value: A character vector` and example
     `nflverse_game_id(2022, 2, "LAC", "KC")`) is the underscore-joined string — i.e.
     `dictionary_schedules`' prose is right but its declared type (`numeric`) is wrong;
     `dictionary_pbp`'s declared type (`character`) is right but its prose ("ten digit
     identifier") looks like it was copied from `old_game_id`'s legacy-NFL-numeric-id concept,
     not `game_id`'s actual shape. Same pattern repeats for `old_game_id`
     (`dictionary_pbp`: character / "Legacy NFL game ID"; `dictionary_schedules`: numeric /
     "The old id for the game assigned by the NFL").
   - Reported as observed, not resolved — this is upstream nflverse documentation, not something
     in scope to fix here.
2. **`espn_id` declared type is inconsistent across dictionaries for what is conceptually the
   same column:** `dictionary_rosters.espn_id` = numeric; `dictionary_players.espn_id` =
   character; `dictionary_depth_charts.espn_id` = character; `dictionary_ff_playerids.espn_id` =
   character. Also `height`/`weight`: `dictionary_rosters` declares both **character**;
   `dictionary_players` declares both **numeric** (inches/lbs) for the same concept.
3. **`nflfastR::teams_colors_logos`'s own Rd `\format` header text disagrees with its own field
   list:** header prose says *"A data frame with 36 rows and 10 variables"*; the `\format` block
   immediately below it enumerates 15 named fields (`team_abbr` through `team_league_logo`).
   Recorded in `schema-summary.md` section 3.

## Gaps (per constraint: retried once, then recorded here rather than fabricated or forced)

1. **`teams` frame has no field-level offline documentation.** `nflreadr::load_teams()` is a
   network loader (fetches team graphics/colors/logos at call time); per the hard constraint
   "NO network needed... do not call remote loaders," it was not executed. Its Rd `\value` is
   qualitative only ("A tibble of team-level image URLs and hex color codes") with no per-field
   breakdown, and no `dictionary_teams` dataset exists among the 22 shipped dictionaries (confirmed
   by the full listing above). Substitute evidence used instead: `nflfastR::teams_colors_logos`,
   a static Rd-documented (not network-fetched) dataset with a 15-field `\format` block — cited
   explicitly as a substitute, not conflated with `load_teams()`'s actual output shape, since the
   two are not confirmed to be field-identical.
2. **`load_rosters_weekly()` has no dictionary cross-reference in its own Rd.** Unlike
   `load_rosters()` (which explicitly "See Also"-links `dictionary_rosters`),
   `load_rosters_weekly.Rd` has no such pointer. `schema-summary.md` section 5 does not assert its
   field list overlaps `dictionary_rosters` — plausible, but undocumented, so left as a gap rather
   than assumed.
3. **Several loaders' Rd files do not state an explicit start year** for their `seasons` argument
   (only "`TRUE` returns all available data", no year given): `load_schedules`, `load_contracts`,
   `load_trades`, `load_player_stats`, `load_team_stats`, `load_ff_opportunity`. Recorded as-is in
   `schema-summary.md` per row rather than backfilling a remembered year from outside knowledge —
   the one exception is `load_schedules`, where `nflverse_game_id.Rd`'s documented season range
   ("between 1999 and `most_recent_season()`") is cited as separate corroborating (not equivalent)
   evidence, explicitly flagged as such.
4. No R error/warning conditions were encountered in Steps 1–2 (Check F in the acceptance script:
   0 `ERROR`-kind rows across all 132 exports); no retries were needed for package loading. This
   task had no genuine execution failures — the "gaps" above are all documentation-coverage gaps
   in the upstream packages, not tooling failures in this audit.

## Step 5: acceptance check — full output (`scripts/step5_acceptance.R`)

```
Check A: exports.csv non-empty per package        -> PASS (nflverse=4, nflreadr=54, nflfastR=27, nflseedR=12, nfl4th=7, nflplotR=28)
Check B: every dictionary_* has a CSV (recount)    -> PASS (22 == 22, exact set match, no missing/extra)
Check C: every dictionary CSV non-empty & parses   -> PASS (all 22)
Check D: exports.csv header matches contract       -> PASS (package,symbol,kind,signature,title)
Check E: exports.csv sorted by package,symbol      -> PASS (radix/locale-independent order)
Check F: no ERROR kind rows                        -> PASS (0 of 132)
TOTAL ROWS: 132
```

`dime-mapping.md`'s 10-row comparison table was also checked programmatically (small Python
script parsing the markdown table into cells) for empty cells: **0 empty cells found** across 10
rows × 6 columns = 60 cells.

## Scope note

Per the global constraint ("You write only in `$ROOT/evidence/ws-f/` and your report file"), all
R/Python scratch scripts used for exploration during this task were written under
`evidence/ws-f/scripts/` or, for early throwaway exploration before that directory existed, under
the session's own `/tmp` scratch area and deleted after use — none were written into the repo, the
read-only `$LIB`, or anywhere outside the scratchpad. Two repo files were read (not modified) to
verify the Dime-side schema claims in `dime-mapping.md` beyond what the memory files alone assert:
`drizzle/nfl.schema.ts`, `drizzle/0118_dark_gateway.sql`, `shared/kickoffDate.ts`, and the seed
JSONs under `scripts/data/nfl-2026/` (`teams.json`, `games.json`, `players.json`) — all read-only,
consistent with the brief's own "Interfaces: Consumes... repo files under `server/` for NFL schema
if referenced by those memories" allowance (the actual schema lives in `drizzle/`, which is what
those memory files describe; `scripts/data/nfl-2026/` is the seed data the memory's player/game
counts refer to).

## Correction (2026-07-27)

Aggregate field-row count corrected from 1,270 to 1,286 after independent recomputation of CSV row counts.
