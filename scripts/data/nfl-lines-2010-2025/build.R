#!/usr/bin/env Rscript
# Build the 2010-2025 NFL schedule + betting-lines extract from nflverse.
#
# Window rationale (from the 2026-07-27 nflverse forensic audit, NFLV-013):
# spread_line and total_line are complete back to 1999, but moneylines and
# odds prices only start in 2006 and are not fully populated until 2010.
# 2010-2025 is the widest window where every line and price column is present.
#
# Reproduce:  Rscript --vanilla scripts/data/nfl-lines-2010-2025/build.R

suppressMessages(library(nflreadr))

OUT_DIR    <- "scripts/data/nfl-lines-2010-2025"
SEASON_MIN <- 2010L
SEASON_MAX <- 2025L

raw <- nflreadr::load_schedules(TRUE)

# The package returns an empty frame with only a warning when a fetch fails,
# and memoise caches that empty frame as a success (audit NFLV-003). Never
# trust a loader result without an explicit floor check.
if (nrow(raw) < 5000L) {
  stop("load_schedules() returned ", nrow(raw), " rows - refusing to write a ",
       "truncated extract. Run nflreadr::clear_cache() and retry.")
}

df <- raw[raw$season >= SEASON_MIN & raw$season <= SEASON_MAX & !is.na(raw$result), ]
df <- df[order(df$season, df$week, df$gameday, df$game_id), ]

# ---------------------------------------------------------------------------
# Manual odds patches.
#
# nflverse ships no price data for these games and the public archives do not
# carry it either (SportsOddsHistory has no moneyline columns for 2017 at all).
# Values below are supplied out-of-band and are NOT observed nflverse data, so
# every patched row is stamped oddsSource = "manual-2026-07-27" and each field's
# basis is recorded in the manifest. Never widen a patch silently.
#
# `assumed` fields are standard juice, not a recorded market price.
PATCHES <- list(
  `2017_04_CHI_GB` = list(
    away_moneyline   = 311,    # observed  (user-supplied source)
    home_moneyline   = -357,   # observed  (user-supplied source)
    away_spread_odds = -110,   # assumed   (standard juice)
    home_spread_odds = -110,   # assumed
    over_odds        = -110,   # assumed
    under_odds       = -110    # assumed
  )
)

# Corrections replace a value nflverse already carries. Each asserts the prior
# value it expects, so if upstream ever revises the field the build fails loudly
# instead of silently re-applying a stale correction.
#
# 2026-07-27: a spread_line 7.5 -> 7 correction was applied here and then
# reverted at the owner's direction. nflverse and SportsOddsHistory both record
# the close at 7.5, so the field is left as published. No corrections active.
CORRECTIONS <- list()

patched_ids <- character(0)
for (gid in names(PATCHES)) {
  i <- which(df$game_id == gid)
  if (length(i) != 1L) {
    stop("patch target ", gid, " matched ", length(i), " rows - refusing to apply")
  }
  for (fld in names(PATCHES[[gid]])) {
    if (!is.na(df[[fld]][i])) {
      stop("patch target ", gid, ".", fld, " is already populated (",
           df[[fld]][i], ") - refusing to overwrite observed data")
    }
    df[[fld]][i] <- PATCHES[[gid]][[fld]]
  }
  patched_ids <- c(patched_ids, gid)
}

corrected_ids <- character(0)
for (gid in names(CORRECTIONS)) {
  i <- which(df$game_id == gid)
  if (length(i) != 1L) {
    stop("correction target ", gid, " matched ", length(i), " rows")
  }
  for (fld in names(CORRECTIONS[[gid]])) {
    spec <- CORRECTIONS[[gid]][[fld]]
    actual <- df[[fld]][i]
    if (is.na(actual) || !isTRUE(all.equal(actual, spec$from))) {
      stop("correction ", gid, ".", fld, " expected prior value ", spec$from,
           " but upstream now has ", actual, " - review before rebuilding")
    }
    df[[fld]][i] <- spec$to
  }
  corrected_ids <- c(corrected_ids, gid)
}

cat("applied", length(patched_ids), "odds patch(es),", length(corrected_ids),
    "correction(s):", paste(unique(c(patched_ids, corrected_ids)), collapse = ", "), "\n")

# Canonical kickoff instant. nflverse stores gameday as a date and gametime as
# "HH:MM" always in Eastern time regardless of venue; the project convention is
# to persist a UTC instant and derive display time at read (kickoff-datetime
# convention memory). Convert via the IANA zone so DST is handled, never by a
# fixed offset.
et <- as.POSIXct(paste(df$gameday, df$gametime), tz = "America/New_York",
                 format = "%Y-%m-%d %H:%M")
kickoff_utc <- format(as.POSIXct(et, tz = "UTC"), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")

num <- function(x) ifelse(is.na(x), NA, as.numeric(x))
int <- function(x) ifelse(is.na(x), NA, as.integer(x))
chr <- function(x) ifelse(is.na(x), NA, as.character(x))

games <- lapply(seq_len(nrow(df)), function(i) {
  r <- df[i, ]
  list(
    gameId          = chr(r$game_id),
    espnId          = chr(r$espn),
    season          = int(r$season),
    seasonType      = chr(r$game_type),
    week            = int(r$week),
    kickoffUtc      = if (is.na(kickoff_utc[i])) NULL else kickoff_utc[i],
    gameday         = chr(r$gameday),
    gametimeEt      = chr(r$gametime),
    awayTeam        = chr(r$away_team),
    homeTeam        = chr(r$home_team),
    awayScore       = int(r$away_score),
    homeScore       = int(r$home_score),
    result          = num(r$result),
    total           = num(r$total),
    overtime        = int(r$overtime),
    divGame         = int(r$div_game),
    spreadLine      = num(r$spread_line),
    totalLine       = num(r$total_line),
    awayMoneyline   = num(r$away_moneyline),
    homeMoneyline   = num(r$home_moneyline),
    awaySpreadOdds  = num(r$away_spread_odds),
    homeSpreadOdds  = num(r$home_spread_odds),
    overOdds        = num(r$over_odds),
    underOdds       = num(r$under_odds),
    roof            = chr(r$roof),
    surface         = chr(r$surface),
    stadiumId       = chr(r$stadium_id),
    stadium         = chr(r$stadium),
    # --- situational / modelling features (Tier 1) ---
    location        = chr(r$location),       # Home | Neutral - neutral sites break home-field assumptions
    weekday         = chr(r$weekday),
    awayRest        = int(r$away_rest),
    homeRest        = int(r$home_rest),
    temp            = int(r$temp),           # NA for dome/closed roof by construction, not a gap
    wind            = int(r$wind),
    awayQbId        = chr(r$away_qb_id),     # gsis id - joins to the player dimension
    homeQbId        = chr(r$home_qb_id),
    awayQbName      = chr(r$away_qb_name),
    homeQbName      = chr(r$home_qb_name),
    awayCoach       = chr(r$away_coach),
    homeCoach       = chr(r$home_coach),
    referee         = chr(r$referee),
    # --- cross-source join keys: the bridge to every other nflverse dataset ---
    gsisId          = chr(r$gsis),
    pfrId           = chr(r$pfr),
    ftnId           = chr(r$ftn),
    oldGameId       = chr(r$old_game_id),
    oddsSource      = if (r$game_id %in% c(patched_ids, corrected_ids))
                        "manual-2026-07-27" else "nflverse"
  )
})

pct <- function(col) round(100 * mean(!is.na(df[[col]])), 4)
line_cols <- c("result", "total", "spread_line", "total_line",
               "away_moneyline", "home_moneyline", "away_spread_odds",
               "home_spread_odds", "over_odds", "under_odds")

manifest <- list(
  dataset      = "nfl-lines-2010-2025",
  description  = "NFL schedules with final results and closing betting lines, 2010-2025",
  source       = "nflverse/nfldata via nflreadr::load_schedules()",
  sourceLicense = "CC-BY-4.0 (nflverse-data); underlying NFL data governed by its owners",
  nflreadrVersion = as.character(utils::packageVersion("nflreadr")),
  generatedUtc = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  seasonMin    = SEASON_MIN,
  seasonMax    = SEASON_MAX,
  seasons      = length(unique(df$season)),
  gameCount    = nrow(df),
  joinKey      = "espnId (preferred) - do not join on team abbreviations (audit NFLV-019)",
  completeness = setNames(as.list(sapply(line_cols, pct)), line_cols),
  knownGaps    = list(),
  manualEdits  = list(list(
    gameId       = "2017_04_CHI_GB",
    appliedOn    = "2026-07-27",
    oddsSource   = "manual-2026-07-27",
    reason       = paste(
      "nflverse ships no price data for this game and the public archives do not",
      "carry it either - SportsOddsHistory (the canonical historical closing-line",
      "archive, now at covers.com) has NO moneyline columns for 2017 at all.",
      "Values were supplied out-of-band by the project owner."),
    filled       = list(
      awayMoneyline  = list(value = 311,   basis = "supplied (CHI +311)"),
      homeMoneyline  = list(value = -357,  basis = "supplied (GB -357)"),
      awaySpreadOdds = list(value = -110,  basis = "assumed standard juice"),
      homeSpreadOdds = list(value = -110,  basis = "assumed standard juice"),
      overOdds       = list(value = -110,  basis = "assumed standard juice"),
      underOdds      = list(value = -110,  basis = "assumed standard juice")
    ),
    corrected    = list(),
    unchanged    = paste(
      "spreadLine 7.5 and totalLine 44 are left exactly as nflverse publishes them,",
      "both independently confirmed by SportsOddsHistory. A 7.5 -> 7 spread override",
      "was briefly applied on 2026-07-27 and then reverted at the owner's direction,",
      "so this row's line fields are now unmodified upstream values.",
      "(OddsShark's 45.5 total was a 2017-09-26 pre-game number, not the close.)"),
    sources      = c(
      "https://www.covers.com/sportsoddshistory/nfl-game-season/?y=2017",
      "https://www.oddsshark.com/nfl/chicago-bears-green-bay-packers-betting-september-28-2017-788213"),
    caution      = paste(
      "Four of the six filled values are assumed juice, not recorded market prices.",
      "Query oddsSource = 'nflverse' to restrict any analysis to purely observed data.")
  )),
  provenance   = "docs/audits/2026-07-26-nflverse-stack-forensic-audit.md"
)

dir.create(OUT_DIR, recursive = TRUE, showWarnings = FALSE)
writeLines(jsonlite::toJSON(games, auto_unbox = TRUE, pretty = TRUE, na = "null"),
           file.path(OUT_DIR, "games.json"))
writeLines(jsonlite::toJSON(manifest, auto_unbox = TRUE, pretty = TRUE, na = "null"),
           file.path(OUT_DIR, "manifest.json"))

cat(sprintf("wrote %d games (%d seasons, %d-%d)\n",
            nrow(df), length(unique(df$season)), SEASON_MIN, SEASON_MAX))
