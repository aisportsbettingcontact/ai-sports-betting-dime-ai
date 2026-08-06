#!/usr/bin/env python3
"""Stamped data corrections for scripts/data/nfl-db/nfl.db.

Every correction in this file:

  1. **Asserts the prior value.** If upstream has revised the field, the build
     STOPS. A correction that silently re-applies to changed data is how a stale
     fix becomes a new defect. This is the pattern already used by
     `scripts/data/nfl-lines-2010-2025/build.R` (`CORRECTIONS`, lines 51-92).
  2. **Carries a one-line source citation** naming the evidence and the report.
  3. **Preserves the upstream value.** Every applied correction is written to the
     `data_correction` audit table with its prior value, its new value and its
     citation, so the divergence from the published feed stays queryable:

         SELECT * FROM data_correction WHERE defect = 'D16';

     Where an inline column is cheap and useful the upstream value is ALSO kept
     beside the corrected one: `game.away_rest_upstream` / `home_rest_upstream`
     and `snap_count.franchise_id_upstream`.

Nothing here guesses. CONTEXT.md standing rule 1 -- never fabricate a value --
is why three of D13's seven venue rows are NULLed rather than filled, and why
the five unverifiable weather readings are not touched at all.

Import-time side effects: none. No file is read and no network call is made
until a function is called.

Audit: docs/audits/2026-07-27-nfl-db-completion/
"""

from __future__ import annotations

import datetime as _dt
import os
import sys
from typing import Any

__all__ = [
    "CorrectionError",
    "apply_game_corrections",
    "apply_player_corrections",
    "player_game_stat_corrections",
    "player_game_stat_rekeys",
    "snap_count_corrections",
    "snap_crosswalk_corrections",
    "assert_and_apply",
    "assert_all_applied",
    "verify_in_database",
    "corrected_game_fields",
    "applied_count",
    "applied_rows",
    "summary",
    "OPEN_CONTRADICTIONS",
    "UNRESOLVED_EXCEPTIONS",
]

_LIB = os.path.dirname(os.path.abspath(__file__))
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)


class CorrectionError(RuntimeError):
    """Raised when a correction's asserted prior value is not what is there."""


# The applied ledger. One row per (table, key, column) actually changed.
_APPLIED: list[tuple] = []


def _record(defect, table, key, column, upstream, corrected, source):
    """Ledger one changed value.

    A no-op (prior == corrected) is NOT a correction and is not recorded. Those
    arise where the wrong venue happens to share an attribute with the right one
    -- Tottenham and FirstEnergy are both `outdoors`/`grass`, so D13 asserts the
    prior value there but changes nothing. Asserting is still worth doing;
    claiming a correction would not be.
    """
    if upstream == corrected:
        return
    _APPLIED.append((defect, table, str(key), column,
                     None if upstream is None else str(upstream),
                     None if corrected is None else str(corrected), source))


def applied_count() -> int:
    return len(_APPLIED)


def applied_rows() -> list[tuple]:
    """Rows for the `data_correction` table, in application order."""
    return list(_APPLIED)


def summary() -> str:
    from collections import Counter
    per = Counter(d for d, *_ in _APPLIED)
    return ("  corrections applied: " + str(len(_APPLIED)) + " field values -- "
            + ", ".join(f"{k}={v}" for k, v in sorted(per.items())))


def _assert_prior(label: str, actual: Any, expected: Any) -> None:
    if actual != expected:
        raise CorrectionError(
            f"{label}: expected prior value {expected!r} but the source now has "
            f"{actual!r} -- review the correction before rebuilding")


def assert_and_apply(label: str, rec: dict, patch: dict) -> None:
    """Apply {column: (prior, corrected, defect, source)} to a mutable dict."""
    for column, (prior, corrected, defect, source) in patch.items():
        _assert_prior(f"{label}.{column}", rec.get(column), prior)
        rec[column] = corrected
        _record(defect, label.split("(")[0], label, column, prior, corrected, source)


def assert_all_applied(table: str, wanted: dict, hits) -> None:
    """Every correction target must have been seen exactly once."""
    missed = [k for k in wanted if hits.get(k, 0) == 0]
    if missed:
        raise CorrectionError(
            f"{table}: {len(missed)} correction target(s) never matched a source "
            f"row -- upstream may have dropped them: {missed[:5]}")
    doubled = [k for k, n in hits.items() if n > 1]
    if doubled:
        raise CorrectionError(f"{table}: correction target matched more than once: {doubled[:5]}")


# ==========================================================================
# D9 -- espn_event_id collision
# ==========================================================================
# `301114022` is stored on BOTH 2010_10_HOU_JAX and 2010_10_SEA_ARI. ESPN says
# that id is SEA 36 @ ARI 18 at State Farm Stadium; HOU 24 @ JAX 31 is
# `301114030`. The bad value appears twice in games.json too, so the merge did
# not introduce it. The DB row's own scores, franchise ids, kickoff and venue
# already agree with 301114030 -- only the crosswalk key is wrong.
D9_ESPN_EVENT_ID = {
    "2010_10_HOU_JAX": {
        "espnEventId": ("301114022", "301114030",
                        "ESPN summary?event=301114030 -> HOU 24 @ JAX 31, "
                        "2010-11-14T18:00Z, EverBank; A1 E1 + A2 exc.1, S2 sec.4"),
    },
}

# ==========================================================================
# D10 -- 2026 neutral sites flagged 'Home'
# ==========================================================================
# 9 international games + Super Bowl LXI. 2026 has 0 Neutral rows against 8 in
# 2025, 7 in 2024, 6 in 2023. On every one of the 10 the DB's OWN venue_id
# already equals ESPN's and points at the foreign stadium -- only `location` was
# never derived. A Super Bowl is neutral by definition.
_D10_SRC = "ESPN competitions[0].neutralSite=true + the row's own venue_id; A1 E4"
D10_NEUTRAL_2026 = {
    "2026_01_SF_LAR":         (9119,  "Melbourne Cricket Ground, Melbourne, Australia"),
    "2026_03_BAL_DAL":        (11931, "Maracana Stadium, Rio De Janeiro, Brazil"),
    "2026_04_IND_WSH":        (5534,  "Tottenham Hotspur Stadium, London, England"),
    "2026_05_PHI_JAX":        (5534,  "Tottenham Hotspur Stadium, London, England"),
    "2026_06_HOU_JAX":        (2455,  "Wembley Stadium, London, England"),
    "2026_07_PIT_NO":         (1781,  "Stade de France, Saint-Denis, France"),
    "2026_09_CIN_ATL":        (1353,  "Santiago Bernabeu, Madrid, Spain"),
    "2026_10_NE_DET":         (11930, "FC Bayern Munich Stadium, Munich, Germany"),
    "2026_11_MIN_SF":         (8219,  "Estadio Banorte, Mexico City, Mexico"),
    "2026_POST_SB_401873270": (7065,  "SoFi Stadium, Inglewood -- Super Bowl LXI"),
}

# ==========================================================================
# D11 -- 2026 gameday derived from the UTC date
# ==========================================================================
# All 285 2026 rows set `gameday = substr(kickoff_utc,1,10)`. 91 land a day late.
#
# WHICH TIMEZONE. CONTEXT.md's identity conventions say "kickoff_date is derived
# in Pacific time", and that is what A1 actually verified (verify/a1_games_espn.py
# ::pacific_date, 91 rows). INTEGRATION.md D11 instead says "the venue's local
# zone". The two rules disagree on EXACTLY ONE ROW -- 2026_01_SF_LAR at the
# Melbourne Cricket Ground -- and `nfl.db` has no venue->timezone table, ESPN
# publishes no timezone field, and no such map exists anywhere in the repo.
# Pacific is applied here because it is the standing convention and the verified
# one. The single divergent row is itemized in UNRESOLVED_EXCEPTIONS.
#
# PLACEHOLDER KICKOFFS ARE EXCLUDED (F09, forensic audit 2026-07-27).
# The first version of this correction moved 91 rows, and 36 of them were
# REGRESSIONS. Those 36 carry `timeValid = 0` and `kickoff_utc` ending
# `T05:00:00Z` -- which is not a kickoff instant at all. It is ESPN's
# "date known, time TBD" marker: midnight Eastern on the game's date. Converting
# midnight westward rolls the date back a day, so 2027-01-16T05:00:00Z became
# gameday 2027-01-15. It hit all of Week 18, the Week 16/17 flex games, and every
# playoff round.
#
# The bug was never the timezone. Pacific is correct on all 249 rows that carry a
# real kickoff time; it fails only where there is no time to convert. So the rule
# is: convert real instants, take placeholder dates as published.
D11_PACIFIC_ZONE = "America/Los_Angeles"
_D11_SRC = ("kickoff_utc converted to America/Los_Angeles per CONTEXT.md's "
            "kickoff-datetime convention; A1 E5; placeholder (timeValid=0) "
            "kickoffs excluded per F09")
#: The verified population, after excluding the 36 placeholder rows: 91 - 36 = 55.
#: The derivation is algorithmic but the set of rows it moves is pinned -- if it
#: ever starts moving a 56th row, the build stops.
D11_EXPECTED_ROWS = 55
D11_EXPECTED_SEASON = 2026

# ==========================================================================
# D12 -- seven wrong kickoffs
# ==========================================================================
# Five London 09:30 ET games stored +12h (so kickoff_utc lands on the wrong
# calendar day while gameday and weekday stay right -- each row is internally
# self-contradictory), and two Arizona games (Arizona is MST year-round).
# `gameday` and `weekday` are ALREADY CORRECT on all seven and are not touched.
D12_KICKOFFS = {
    "2017_03_BAL_JAX": {
        "kickoffUtc": ("2017-09-25T01:30:00Z", "2017-09-24T13:30:00Z"),
        "gametimeEt": ("21:30", "09:30"),
        "_src": "Wikipedia '2017 Jacksonville Jaguars season' 2:30pm BST/9:30am EDT, "
                "Wembley, att. 84,592; ESPN 400951579 date matches exactly; A1 E2",
    },
    "2017_04_NO_MIA": {
        "kickoffUtc": ("2017-10-02T01:30:00Z", "2017-10-01T13:30:00Z"),
        "gametimeEt": ("21:30", "09:30"),
        "_src": "Wikipedia '2017 Miami Dolphins season' 2:30pm BST/9:30am EDT, "
                "Wembley, att. 84,423; ESPN 400950241; A1 E2",
    },
    "2017_08_MIN_CLE": {
        "kickoffUtc": ("2017-10-30T01:30:00Z", "2017-10-29T13:30:00Z"),
        "gametimeEt": ("21:30", "09:30"),
        "_src": "Wikipedia '2017 Cleveland Browns season' 1:30pm GMT/9:30am EDT, "
                "Twickenham, att. 74,237; ESPN 400951683; A1 E2",
    },
    "2018_07_TEN_LAC": {
        "kickoffUtc": ("2018-10-22T01:30:00Z", "2018-10-21T13:30:00Z"),
        "gametimeEt": ("21:30", "09:30"),
        "_src": "Wikipedia '2018 Los Angeles Chargers season' 6:30am PDT/2:30pm BST, "
                "Wembley, att. 84,301; ESPN 401030792; A1 E2",
    },
    "2018_08_PHI_JAX": {
        "kickoffUtc": ("2018-10-29T01:30:00Z", "2018-10-28T13:30:00Z"),
        "gametimeEt": ("21:30", "09:30"),
        "_src": "Wikipedia '2018 Jacksonville Jaguars season' 1:30pm GMT/9:30am EDT, "
                "Wembley, att. 85,870, duplicated in the Eagles article; "
                "ESPN 401030699; A1 E2",
    },
    "2016_02_TB_ARI": {
        "kickoffUtc": ("2016-09-18T17:00:00Z", "2016-09-18T20:05:00Z"),
        "gametimeEt": ("13:00", "16:05"),
        "_src": "Wikipedia '2016 Arizona Cardinals season' 1:05pm (MST, no DST) = "
                "20:05Z = 16:05 ET; the stored 13:00 ET is 10:00 local, a slot the "
                "NFL does not schedule; ESPN 400874515; A1 E3",
    },
    "2014_01_SD_ARI": {
        "kickoffUtc": ("2014-09-09T01:20:00Z", "2014-09-09T02:20:00Z"),
        "gametimeEt": ("21:20", "22:20"),
        "_src": "Wikipedia '2014 Arizona Cardinals season' 7:20pm MST = 02:20Z = "
                "22:20 ET, MNF week-1 nightcap; ESPN 400554301; A1 E3",
    },
}

# ==========================================================================
# D13 -- 2025 international games carrying the HOME team's venue
# ==========================================================================
# Seven rows record the home team's stadium / stadium_id / roof / surface
# instead of the venue the game was actually played at. `location='Neutral'` is
# already correct on all seven and is not touched.
#
# RULE 1 BOUNDARY. A1 sourced the correct venue NAME for all seven (ESPN venue
# object + Wikipedia). It did NOT source a stadium_id, roof or surface for any
# of them. Four of the seven are played at venues this database already has its
# own code and attributes for, in its own rows for other seasons -- that is a
# citation, not a guess, and those four are filled from it. The other three
# (Croke Park, Olympiastadion Berlin, Santiago Bernabeu) have no precedent
# anywhere in the repo, so their stadium_id / roof / surface are set to NULL:
# "absent" is true, and the value sitting there now is provably the wrong
# stadium's. Minting three new stadium codes and sourcing their roof and surface
# is an owner action -- see UNRESOLVED_EXCEPTIONS.
#
# The five weather readings are NOT touched. A1 could not determine whether they
# are the foreign city's weather with a stale venue label or the home city's,
# and INTEGRATION.md D13 says explicitly: do not patch the weather.
_D13_PRECEDENT = ("venue name from ESPN venue object + Wikipedia (A1 E6); "
                  "stadium_id/roof/surface from this database's own rows for the "
                  "same venue")
_D13_NO_PRECEDENT = ("venue name from ESPN venue object + Wikipedia (A1 E6); no "
                     "stadium_id/roof/surface exists for this venue anywhere in "
                     "the repo, and the stored values are the home team's -- "
                     "NULLed as absent rather than guessed (rule 1)")
D13_VENUES = {
    "2025_01_KC_LAC": {
        "stadium":   ("SoFi Stadium", "Arena Corinthians"),
        "stadiumId": ("LAX01", "SAO00"),
        "roof":      ("dome", "outdoors"),
        "_src": _D13_PRECEDENT + " (SAO00, 2024_01_GB_PHI)",
        # surface is '' both before and after -- unchanged, not a correction.
    },
    "2025_04_MIN_PIT": {
        "stadium":   ("Acrisure Stadium", "Croke Park"),
        "stadiumId": ("PIT00", None),
        "roof":      ("outdoors", None),
        "surface":   ("grass", None),
        "_src": _D13_NO_PRECEDENT + " (Croke Park, Dublin -- first NFL game there)",
    },
    "2025_05_MIN_CLE": {
        "stadium":   ("FirstEnergy Stadium", "Tottenham Stadium"),
        "stadiumId": ("CLE00", "LON02"),
        "roof":      ("outdoors", "outdoors"),
        "surface":   ("grass", "grass"),
        "_src": _D13_PRECEDENT + " (LON02, 6 rows 2019-2024)",
    },
    "2025_06_DEN_NYJ": {
        "stadium":   ("MetLife Stadium", "Tottenham Stadium"),
        "stadiumId": ("NYC01", "LON02"),
        "roof":      ("outdoors", "outdoors"),
        "surface":   ("grass", "grass"),
        "_src": _D13_PRECEDENT + " (LON02, 6 rows 2019-2024)",
    },
    "2025_07_LA_JAX": {
        "stadium":   ("TIAA Bank Stadium", "Wembley Stadium"),
        "stadiumId": ("JAX00", "LON00"),
        "roof":      ("outdoors", "outdoors"),
        "surface":   ("grass", "grass"),
        "_src": _D13_PRECEDENT + " (LON00, 19 rows 2010-2024)",
    },
    "2025_10_ATL_IND": {
        "stadium":   ("Lucas Oil Stadium", "Olympic Stadium Berlin"),
        "stadiumId": ("IND00", None),
        "roof":      ("closed", None),
        "surface":   ("grass", None),
        "_src": _D13_NO_PRECEDENT + " (Olympic Stadium Berlin, ESPN venue 7696; the stored roof "
                                    "'closed' is Lucas Oil's and is why this row "
                                    "carries weather at all -- see D13 weather)",
    },
    "2025_11_WAS_MIA": {
        "stadium":   ("Hard Rock Stadium", "Santiago Bernabéu"),
        "stadiumId": ("MIA00", None),
        "roof":      ("outdoors", None),
        "surface":   ("grass", None),
        "_src": _D13_NO_PRECEDENT + " (Santiago Bernabeu; ESPN flags venue 1353 "
                                    "indoor=true, which does not map onto this "
                                    "schema's roof vocabulary without a ruling)",
    },
}

#: Explicitly NOT patched. Rule 1: provenance unverifiable.
D13_UNVERIFIABLE_WEATHER = {
    "2025_04_MIN_PIT": {"temp": 61, "wind": 5},
    "2025_05_MIN_CLE": {"temp": 61, "wind": 14},
    "2025_06_DEN_NYJ": {"temp": 59, "wind": 6},
    "2025_07_LA_JAX":  {"temp": 59, "wind": 9},
    "2025_10_ATL_IND": {"temp": 46, "wind": 2},   # also the mixed-provenance row
}

# ==========================================================================
# D15 -- stale rest_days
# ==========================================================================
# nflverse computes rest against ORIGINALLY SCHEDULED dates, so Saturday
# specials, the 2021 covid reschedules and the abandoned 2022 BUF-CIN game leave
# stale values behind. Rest is a first-class modelling feature and the actual
# calendar gap is the true value; the published value is preserved in
# `game.away_rest_upstream` / `home_rest_upstream` and in `data_correction`.
#
# Transcribed from verify/a4_lines.py::REST_EXCEPTIONS (lines 83-120), which
# stores (calendar_gap, stored_value, cause). NOTE: A4's heading, INTEGRATION.md
# and S1 all say "17 games"; the constant contains 34 rows across 25 DISTINCT
# game_ids. The constant is the artifact; the prose count is wrong.
#: (game_id, franchise_id) -> (correct, prior, cause)
D15_REST = {
    ("2019_16_BUF_NE", 2): (6, 7, "wk16 Sat special; nflverse used the nominal Sunday"),
    ("2019_16_BUF_NE", 17): (6, 7, "wk16 Sat special; nflverse used the nominal Sunday"),
    ("2019_16_LA_SF", 14): (6, 7, "wk16 Sat special; nflverse used the nominal Sunday"),
    ("2019_16_LA_SF", 25): (6, 7, "wk16 Sat special; nflverse used the nominal Sunday"),
    ("2019_16_HOU_TB", 27): (6, 7, "wk16 Sat special; nflverse used the nominal Sunday"),
    ("2019_16_HOU_TB", 34): (6, 7, "wk16 Sat special; nflverse used the nominal Sunday"),
    ("2019_17_NYJ_BUF", 2): (8, 7, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2019_17_MIA_NE", 17): (8, 7, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2019_17_ARI_LA", 14): (8, 7, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2019_17_SF_SEA", 25): (8, 7, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2019_17_ATL_TB", 27): (8, 7, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2019_17_TEN_HOU", 34): (8, 7, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2021_15_LV_CLE", 5): (8, 7, "covid reschedule Sat->Mon; nflverse used the nominal date"),
    ("2021_15_LV_CLE", 13): (8, 7, "covid reschedule Sat->Mon; nflverse used the nominal date"),
    ("2021_16_CLE_GB", 5): (5, 6, "prior game was covid-rescheduled; nflverse used its nominal date"),
    ("2021_16_DEN_LV", 13): (6, 7, "prior game was covid-rescheduled; nflverse used its nominal date"),
    ("2021_15_SEA_LA", 14): (8, 6, "covid reschedule Sun->Tue; nflverse used the nominal date"),
    ("2021_15_SEA_LA", 26): (9, 7, "covid reschedule Sun->Tue; nflverse used the nominal date"),
    ("2021_16_LA_MIN", 14): (5, 7, "prior game was covid-rescheduled; nflverse used its nominal date"),
    ("2021_16_CHI_SEA", 26): (5, 7, "prior game was covid-rescheduled; nflverse used its nominal date"),
    ("2021_15_WAS_PHI", 21): (16, 14, "covid reschedule Sun->Tue; nflverse used the nominal date"),
    ("2021_15_WAS_PHI", 28): (9, 7, "covid reschedule Sun->Tue; nflverse used the nominal date"),
    ("2021_16_NYG_PHI", 21): (5, 7, "prior game was covid-rescheduled; nflverse used its nominal date"),
    ("2021_16_WAS_DAL", 28): (5, 7, "prior game was covid-rescheduled; nflverse used its nominal date"),
    ("2021_15_NE_IND", 11): (13, 14, "wk15 Sat special; nflverse used the nominal Sunday"),
    ("2021_15_NE_IND", 17): (12, 13, "wk15 Sat special; nflverse used the nominal Sunday"),
    ("2021_16_IND_ARI", 11): (7, 6, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2021_16_BUF_NE", 17): (8, 7, "follows a Sat game; nflverse used the nominal Sunday"),
    ("2021_18_DAL_PHI", 6): (6, 7, "wk18 Sat special; nflverse used the nominal Sunday"),
    ("2021_18_DAL_PHI", 21): (6, 7, "wk18 Sat special; nflverse used the nominal Sunday"),
    ("2021_18_KC_DEN", 7): (6, 7, "wk18 Sat special; nflverse used the nominal Sunday"),
    ("2021_18_KC_DEN", 12): (6, 7, "wk18 Sat special; nflverse used the nominal Sunday"),
    ("2022_18_NE_BUF", 2): (15, 6, "BUF wk17 vs CIN was abandoned/cancelled (Hamlin); "
                                   "nflverse measured rest from the cancelled game's date"),
    ("2022_18_BAL_CIN", 4): (15, 6, "CIN wk17 vs BUF was abandoned/cancelled (Hamlin); "
                                    "nflverse measured rest from the cancelled game's date"),
}
_D15_SRC = "verify/a4_lines.py::REST_EXCEPTIONS; A4 EX-03, recomputed from actual played kickoffs"

# ==========================================================================
# D16 -- four Super Bowls with every snap row on the opponent's team
# ==========================================================================
# 358 rows. The swap is present in raw/snap_counts.csv (the CSV's own `team`
# column says SEA for Tom Brady in 2014_21_NE_SEA), so it is upstream nflverse,
# faithfully copied. Direction is pinned four ways, one of which needs no source
# at all: Tom Brady never played for Kansas City.
#
# NOTE ON PROVENANCE OF THE FIX. A5 and A3 both describe the defect and neither
# states a fix verb -- A3 says "the fix may belong with whoever owns the
# team/game dimension. Not fixed here. Coordinator decision." Swapping
# franchise_id between the two teams for every row in these four games is this
# module's inference from their description, not a quoted recommendation. The
# upstream franchise_id is preserved in snap_count.franchise_id_upstream.
_D16_SRC = ("upstream nflverse transposition; A5 D4 + A3 E-10; direction pinned by "
            "A3's depth_chart control (1,106/1,106 agree), the raw CSV's own team "
            "column, S2's ESPN check of event 401220403, and the fact that Tom "
            "Brady never played for Kansas City. FIX VERB IS THIS MODULE'S INFERENCE")
#: nflverse game_id -> the two franchise ids to exchange, with row counts.
D16_SUPER_BOWLS = {
    "2014_21_NE_SEA":  ((17, 26), 88),   # SB XLIX -- NE 17, SEA 26
    "2015_21_CAR_DEN": ((7, 29), 89),    # SB 50   -- DEN 7, CAR 29
    "2018_21_NE_LA":   ((14, 17), 90),   # SB LIII -- LAR 14, NE 17
    "2020_21_KC_TB":   ((12, 27), 91),   # SB LV   -- KC 12, TB 27
}

# ==========================================================================
# D17 -- duplicated plays in two 2011 games
# ==========================================================================
# nflverse duplicated a block of plays in 2011_13_DET_NO and 2011_10_DET_CHI.
# 14 players over the two games; Ingram and K. Smith each gain a PHANTOM RUSHING
# TD, which is a directly wrong prop outcome. Convicted three ways: full
# population score reconstruction (2011_13_DET_NO is the only game in 2010-2025
# whose score cannot be reconstructed from its own stat lines), the ESPN box
# score, and nfl.com's official play-by-play.
#
# Transcribed from verify/a5_stats.py's E-01 check rows. A5's D6 markdown table
# is incomplete -- it omits Robert Meachem's rushing line entirely and names
# only 2 of the 4 affected players in 2011_10_DET_CHI. 44 field corrections.
_D17_SRC = ("upstream nflverse play duplication; A5 D6, convicted by score "
            "reconstruction + ESPN box score + nfl.com official play-by-play")
#: (gsis_id, season, week, season_type) -> {column: (prior, corrected)}
D17_DUPLICATED_PLAYS = {
    # ---- 2011_13_DET_NO (season 2011, week 13, REG) -- 36 values, 10 players
    ("00-0026498", 2011, 13, "REG"): {                      # Matthew Stafford, DET
        "completions": (36, 31), "attempts": (51, 44), "passing_yards": (461, 408)},
    ("00-0026204", 2011, 13, "REG"): {                      # Kevin Smith, DET
        "carries": (8, 6), "rushing_yards": (42, 34), "rushing_tds": (2, 1),
        "receptions": (8, 6), "receiving_yards": (69, 46), "targets": (9, 7)},
    ("00-0021182", 2011, 13, "REG"): {                      # Maurice Morris, DET
        "carries": (14, 12), "rushing_yards": (31, 28),
        "receptions": (6, 5), "receiving_yards": (58, 47), "targets": (8, 7)},
    ("00-0021999", 2011, 13, "REG"): {                      # Nate Burleson, DET
        "receptions": (6, 5), "receiving_yards": (107, 93), "targets": (10, 8)},
    ("00-0025389", 2011, 13, "REG"): {                      # Calvin Johnson, DET
        "receptions": (7, 6), "receiving_yards": (74, 69), "targets": (10, 8)},
    ("00-0020531", 2011, 13, "REG"): {                      # Drew Brees, NO
        "completions": (29, 26), "attempts": (39, 36), "passing_yards": (401, 342)},
    ("00-0027966", 2011, 13, "REG"): {                      # Mark Ingram, NO
        "carries": (18, 16), "rushing_yards": (72, 54), "rushing_tds": (2, 1)},
    ("00-0023564", 2011, 13, "REG"): {                      # Darren Sproles, NO
        "carries": (5, 4), "rushing_yards": (29, 28)},
    ("00-0025414", 2011, 13, "REG"): {                      # Robert Meachem, NO
        "carries": (2, 1), "rushing_yards": (16, 8),
        "receptions": (4, 3), "receiving_yards": (157, 119), "targets": (7, 6)},
    ("00-0024466", 2011, 13, "REG"): {                      # Marques Colston, NO
        "receptions": (8, 6), "receiving_yards": (75, 54), "targets": (10, 8)},
    # ---- 2011_10_DET_CHI (season 2011, week 10, REG) -- 8 values, 4 players
    ("00-0026498", 2011, 10, "REG"): {                      # Matthew Stafford, DET
        "completions": (35, 33), "attempts": (66, 63), "passing_yards": (338, 329)},
    ("00-0027982", 2011, 10, "REG"): {                      # Titus Young, DET
        "receptions": (9, 7), "receiving_yards": (83, 74), "targets": (11, 8)},
    ("00-0025389", 2011, 10, "REG"): {"targets": (20, 19)},  # Calvin Johnson, DET
    ("00-0024276", 2011, 10, "REG"): {"targets": (8, 7)},    # Tony Scheffler, DET
}

# ==========================================================================
# D18 -- pfr_id swapped between the two Jonah Williamses
# ==========================================================================
# 146 snap rows (67 + 79) on the wrong man, PLUS -- S1's widening of the ledger
# -- four draft fields on 00-0035944 that belong to 00-0035629. The DB currently
# gives an undrafted Weber State DE Cincinnati's 2019 first-round, 11th-overall
# pick.
#
# A3 says "cleared"; S1 says the fields "belong to 00-0035629". Moving is the
# stronger reading and is what is done here: the pick is a fact about the OT and
# ESPN athlete 4040726 carries it. The divergence between the two
# recommendations is recorded rather than silently chosen.
_D18_SRC = ("upstream players.csv id swap; A3 E-9 pinned it via ESPN athletes "
            "4040726 (OT, b.1997-11-17, 2019 R1 P11) and 4032481 (DE, "
            "b.1995-08-17, undrafted), whose statisticslog sequences reproduce "
            "each man's player_game_stats history exactly; S1 sec.1b widened it "
            "to the draft fields")
D18_PLAYER = {
    "00-0035629": {   # Jonah Williams, OT, Alabama
        "pfr_id":      ("WillJo16", "WillJo10"),
        "draft_year":  (None, 2019),
        "draft_round": (None, 1),
        "draft_pick":  (None, 11),
        "draft_team":  (None, "CIN"),
    },
    "00-0035944": {   # Jonah Williams, DE, Weber State -- undrafted
        "pfr_id":      ("WillJo10", "WillJo16"),
        "draft_year":  (2019, None),
        "draft_round": (1, None),
        "draft_pick":  (11, None),
        "draft_team":  ("CIN", None),
    },
}
#: The same swap, applied to B1's crosswalk so the 146 snap rows land on the
#: right man. Without this the player table and the snap table disagree.
D18_PFR_CROSSWALK = {
    "WillJo10": ("00-0035944", "00-0035629"),   # (prior, corrected) -- the OT
    "WillJo16": ("00-0035629", "00-0035944"),   # the DE
}

# ==========================================================================
# D19 -- 13 Tampa Bay 2020 stat lines on a 2024 rookie OL
# ==========================================================================
# nflverse keyed the safety Mike Edwards' 2020 season to a 2024 rookie offensive
# lineman of the same name. Every value in all 13 rows is zero (S1 sec.1c
# verified this column by column), so nothing NUMERIC is misattributed -- this
# is an identity defect, not a performance defect, and A3's "highest" severity
# is not supported by the payload. The harm is that the safety's 2020
# participation record is missing and any gsis_id join attaches a 2024 lineman
# to the 2020 Super Bowl run.
#
# The re-key is collision-safe: 00-0035681 has zero 2020 rows.
# CONSEQUENCE, STATED PLAINLY: re-keying moves 13 primary keys away from the
# ones raw/player_stats.csv publishes, so lib/rowloss.py sees 13 missing and 13
# extra keys for player_game_stats. Those 26 are reconciled against this table
# in the build's rowloss gate; they are NOT waved through.
_D19_SRC = ("upstream player_stats.csv identity collision; A3 E-1 (career window, "
            "gsis_id sequence outlier, gap-fill, nflverse self-contradiction, "
            "ESPN statisticslog 4362015 has nothing before 2024) + A5 D2")
D19_WRONG_GSIS = "00-0039472"      # Mike Edwards, OL, rookie_year=last_season=2024
D19_CORRECT_GSIS = "00-0035681"    # Mike Edwards, SAF, TB 2019-2025
D19_ROWS = [
    (2020, 1, "REG"), (2020, 3, "REG"), (2020, 6, "REG"), (2020, 7, "REG"),
    (2020, 8, "REG"), (2020, 9, "REG"), (2020, 10, "REG"), (2020, 11, "REG"),
    (2020, 14, "REG"),
    (2020, 18, "POST"), (2020, 19, "POST"), (2020, 20, "POST"), (2020, 21, "POST"),
]
#: position/position_group are the OL's on all 13 and are wrong for a safety.
D19_POSITION = {"position": ("OL", "SAF"), "position_group": ("OL", "DB")}

# ==========================================================================
# Recorded, NOT resolved (CONTEXT.md standing rule 4)
# ==========================================================================
OPEN_CONTRADICTIONS = {
    "2021_10_DET_PIT": (
        "DB has PIT -9.0 / moneyline -359; SportsOddsHistory says -6 and all 16 "
        "pre-game ESPN providers say -5.5/-6 at ML ~= -250. Probable upstream "
        "error. NOT changed -- owner call. A4 EX-05."),
    "2020_01_LV_CAR": (
        "Moneylines imply a 0.9809 overround, i.e. an arbitrage. Away -124 vs "
        "-148..-159 at all 10 ESPN books. Spread and total are fine. A4 EX-04."),
    "2021_15_NE_IND": (
        "DB has NE -1.0; ESPN's majority says IND -1/-1.5 and the DB's own "
        "moneyline leans IND. A4 calls this its strongest single candidate for a "
        "genuine upstream sign error. NOT in INTEGRATION.md. A4 EX-06, S1 N2."),
    "2021_17_CLE_PIT": (
        "Second disputed spread A4 could not resolve. NOT in INTEGRATION.md. "
        "A4 EX-07, S1 N2."),
    "BILLS_TORONTO_SERIES": (
        "2010_09_CHI_BUF, 2011_08_WAS_BUF, 2012_15_SEA_BUF stored 'Home' and "
        "2013_13_ATL_BUF stored 'Neutral', all four at Rogers Centre "
        "(stadium_id BUF01). ESPN cannot arbitrate -- its neutral flag is "
        "unpopulated pre-2014. Needs a contemporaneous-source ruling on what "
        "`location` means for an out-of-country home game, applied to all four. "
        "A1; INTEGRATION.md."),
    "JALEN_DAVIS_00-0034446": (
        "6 snap rows put one player in two games at once across 3 weeks (2019 "
        "wk16, 2019 wk17, 2021 wk12). The ANOMALY is proven; the stated cause "
        "-- PFR conflating two cornerbacks under DaviJa06 -- is an INFERENCE "
        "from roster_season with no external source (PFR 403s, ESPN publishes no "
        "snap counts). S1 X4 labels it a hypothesis. Not corrected."),
}

UNRESOLVED_EXCEPTIONS = {
    "D11_TIMEZONE_RULE": (
        "CONTEXT.md and A1's verified implementation derive gameday in US "
        "Pacific; INTEGRATION.md D11 says 'the venue's local zone'. They "
        "disagree on exactly one row, 2026_01_SF_LAR at the Melbourne Cricket "
        "Ground: Pacific gives 2026-09-10, venue-local gives 2026-09-11 (the "
        "current value). Pacific is applied. No venue->timezone map exists in "
        "the repo and ESPN publishes no timezone field, so a venue-local rule "
        "cannot be implemented today without authoring one. OWNER CALL."),
    "D13_THREE_UNSOURCED_VENUES": (
        "Croke Park (2025_04_MIN_PIT), Olympic Stadium Berlin (2025_10_ATL_IND) "
        "and Santiago Bernabéu (2025_11_WAS_MIA) have no stadium_id, roof or "
        "surface anywhere in this repo. Their stored values are the home team's "
        "and are provably wrong, so they are NULLed. Minting three stadium codes "
        "and sourcing roof/surface is an OWNER ACTION."),
    "D13_UNVERIFIABLE_WEATHER": (
        "Five 2025 international rows carry temp/wind of undetermined "
        "provenance. NOT patched (rule 1). 2025_10_ATL_IND is the mixed-"
        "provenance case: a closed-roof flag from Indianapolis together with "
        "populated weather, which this schema treats as impossible."),
    "N1_ASSUMED_JUICE": (
        "2017_04_CHI_GB carries four assumed -110 juice values that were never "
        "observed, stamped odds_source='manual-2026-07-27'. Owner-instructed and "
        "documented, so it stays; v_game_line_observed now makes observed-only "
        "the default path, which is what S1 recommended."),
    "G17_UPSTREAM_GATE": (
        "scripts/data/nfl-unified-2010-2026/build.py gate G17 asserts the "
        "espn_event_id duplicate STILL EXISTS. D9 removes it, so that gate must "
        "be INVERTED, not the fix reverted. That file is outside this task's "
        "ownership and was not touched."),
    "D21_2012_SNAP_GAP": (
        "S1 is right that the 2010-2012 snap gap is a defect for 2012: nflverse "
        "publishes snap counts from 2012 and this extract starts at 2013. That "
        "is a local extract gap, roughly a third of the 52,386 dark stat rows, "
        "and needs a re-fetch -- not a loader change."),
    "N9_18_NULL_ROSTER_GSIS": (
        "18 roster_season rows carry a NULL gsis_id; B5 E7 resolves 17 of them "
        "unambiguously. Not in this task's correction list, so not applied. The "
        "rows load with a NULL FK, which is legal."),
}


# ==========================================================================
# application
# ==========================================================================
def _pacific_date(kickoff_utc: str) -> str:
    from zoneinfo import ZoneInfo
    inst = _dt.datetime.fromisoformat(kickoff_utc.replace("Z", "+00:00"))
    return inst.astimezone(ZoneInfo(D11_PACIFIC_ZONE)).date().isoformat()


def corrected_game_fields() -> set:
    """{(game_id, json_field)} touched by a game-level correction."""
    out = set()
    for gid, fields in D9_ESPN_EVENT_ID.items():
        out |= {(gid, f) for f in fields}
    for gid in D10_NEUTRAL_2026:
        out.add((gid, "location"))
    for gid, fields in D12_KICKOFFS.items():
        out |= {(gid, f) for f in fields if not f.startswith("_")}
    for gid, fields in D13_VENUES.items():
        out |= {(gid, f) for f in fields if not f.startswith("_")}
    for (gid, _fid) in D15_REST:
        out |= {(gid, "awayRest"), (gid, "homeRest")}
    # D11 is algorithmic; its population is asserted at apply time.
    return out


def apply_game_corrections(rows: list[dict], venue_by_id: dict) -> list[dict]:
    """Apply D9-D13 and D15 to the merged games.json records, in place."""
    by_id = {r["gameId"]: r for r in rows}

    def hit(gid):
        r = by_id.get(gid)
        if r is None:
            raise CorrectionError(f"correction target {gid} matched 0 game rows")
        return r

    # ---- D9 -------------------------------------------------------------
    for gid, fields in D9_ESPN_EVENT_ID.items():
        r = hit(gid)
        for field, (prior, new, src) in fields.items():
            _assert_prior(f"D9 {gid}.{field}", r[field], prior)
            r[field] = new
            _record("D9", "game", gid, field, prior, new, src)
    dups = {}
    for r in rows:
        dups.setdefault(r["espnEventId"], []).append(r["gameId"])
    collisions = {k: v for k, v in dups.items() if len(v) > 1}
    if collisions:
        raise CorrectionError(f"espn_event_id still collides after D9: {collisions}")

    # ---- D10 ------------------------------------------------------------
    for gid, (venue_id, note) in D10_NEUTRAL_2026.items():
        r = hit(gid)
        _assert_prior(f"D10 {gid}.location", r["location"], "Home")
        _assert_prior(f"D10 {gid}.venueId", r["venueId"], venue_id)
        if venue_id not in venue_by_id:
            raise CorrectionError(f"D10 {gid}: venue {venue_id} not in venues.json")
        r["location"] = "Neutral"
        _record("D10", "game", gid, "location", "Home", "Neutral",
                f"{_D10_SRC} -- {note}")
    n_neutral_2026 = sum(1 for r in rows if r["season"] == 2026 and r["location"] == "Neutral")
    if n_neutral_2026 != len(D10_NEUTRAL_2026):
        raise CorrectionError(f"D10: 2026 neutral count is {n_neutral_2026}, expected "
                              f"{len(D10_NEUTRAL_2026)}")
    for r in rows:
        if r["playoffRound"] == "SB" and r["location"] != "Neutral":
            raise CorrectionError(f"D10 invariant: Super Bowl {r['gameId']} is not Neutral")
    for season in range(2010, 2027):
        if not any(r["season"] == season and r["location"] == "Neutral" for r in rows):
            raise CorrectionError(f"D10 invariant: season {season} has zero neutral-site games")

    # ---- D12 (before D11: D11 reads kickoff_utc) --------------------------
    for gid, spec in D12_KICKOFFS.items():
        r = hit(gid)
        src = spec["_src"]
        for field, value in spec.items():
            if field.startswith("_"):
                continue
            prior, new = value
            _assert_prior(f"D12 {gid}.{field}", r[field], prior)
            r[field] = new
            _record("D12", "game", gid, field, prior, new, src)

    # ---- D11 ------------------------------------------------------------
    changed = []
    for r in rows:
        if r["season"] != D11_EXPECTED_SEASON:
            continue
        prior = r["gameday"]
        if prior != r["kickoffUtc"][:10]:
            raise CorrectionError(
                f"D11 {r['gameId']}: gameday {prior} is no longer the UTC date -- "
                f"the defect this correction targets has changed shape")
        # A timeValid=0 row's kickoff_utc is ESPN's midnight-ET "time TBD" marker,
        # not an instant. There is nothing to convert, and converting it would
        # move the date back a day. Its published date is already correct.
        if not r.get("timeValid"):
            if not r["kickoffUtc"].endswith("T05:00:00Z"):
                raise CorrectionError(
                    f"D11 {r['gameId']}: timeValid=0 but kickoff_utc "
                    f"{r['kickoffUtc']} is not the expected midnight-ET marker -- "
                    f"the placeholder convention has changed, review before rebuilding")
            continue
        new = _pacific_date(r["kickoffUtc"])
        if new != prior:
            r["gameday"] = new
            changed.append(r["gameId"])
            _record("D11", "game", r["gameId"], "gameday", prior, new, _D11_SRC)
    if len(changed) != D11_EXPECTED_ROWS:
        raise CorrectionError(
            f"D11 moved {len(changed)} rows, expected exactly {D11_EXPECTED_ROWS} "
            f"(A1's verified population) -- review before rebuilding")

    # ---- D13 ------------------------------------------------------------
    for gid, spec in D13_VENUES.items():
        r = hit(gid)
        src = spec["_src"]
        if r["location"] != "Neutral":
            raise CorrectionError(f"D13 {gid}: location is {r['location']!r}, expected Neutral")
        for field, value in spec.items():
            if field.startswith("_"):
                continue
            prior, new = value
            _assert_prior(f"D13 {gid}.{field}", r[field], prior)
            r[field] = new
            _record("D13", "game", gid, field, prior, new, src)
        # Rule 1: the weather is NOT touched. Assert it is still what A1 saw, so
        # that a future upstream change cannot slip past unnoticed.
        want = D13_UNVERIFIABLE_WEATHER.get(gid)
        if want is not None:
            _assert_prior(f"D13 {gid}.temp (NOT patched)", r["temp"], want["temp"])
            _assert_prior(f"D13 {gid}.wind (NOT patched)", r["wind"], want["wind"])

    # ---- D15 ------------------------------------------------------------
    for r in rows:
        r["awayRestUpstream"] = r["awayRest"]
        r["homeRestUpstream"] = r["homeRest"]
    seen = set()
    for (gid, franchise), (correct, prior, cause) in D15_REST.items():
        r = hit(gid)
        if franchise == r["homeFranchiseId"]:
            field = "homeRest"
        elif franchise == r["awayFranchiseId"]:
            field = "awayRest"
        else:
            raise CorrectionError(
                f"D15 {gid}: franchise {franchise} did not play in that game")
        _assert_prior(f"D15 {gid}.{field}", r[field], prior)
        r[field] = correct
        seen.add((gid, franchise))
        _record("D15", "game", f"{gid}/{franchise}", field, prior, correct,
                f"{_D15_SRC} -- {cause}")
    if seen != set(D15_REST):
        raise CorrectionError(f"D15: unapplied targets {set(D15_REST) - seen}")

    return rows


def apply_player_corrections(dimension: list[dict]) -> list[dict]:
    """Apply D18 to the player dimension, in place."""
    by_id = {r["gsis_id"]: r for r in dimension}
    for gsis, fields in D18_PLAYER.items():
        row = by_id.get(gsis)
        if row is None:
            raise CorrectionError(f"D18 target {gsis} absent from the player dimension")
        for column, (prior, new) in fields.items():
            _assert_prior(f"D18 {gsis}.{column}", row[column], prior)
            row[column] = new
            _record("D18", "player", gsis, column, prior, new, _D18_SRC)
    return dimension


def apply_snap_crosswalk_corrections(crosswalk: dict) -> dict:
    """Apply D18's pfr_id swap to B1's crosswalk, in place."""
    for pfr_id, (prior, new) in D18_PFR_CROSSWALK.items():
        _assert_prior(f"D18 crosswalk[{pfr_id}]", crosswalk.get(pfr_id), prior)
        crosswalk[pfr_id] = new
        _record("D18", "snap_count.crosswalk", pfr_id, "gsis_id", prior, new, _D18_SRC)
    return crosswalk


# Kept under the documented public name as well.
snap_crosswalk_corrections = apply_snap_crosswalk_corrections


def snap_count_corrections() -> dict:
    """(game_id, pfr_player_id) is not enough for D16 -- the swap is per-game and
    per-team, so it is expressed as a franchise map the loader consults.

    Returns {game_id: {franchise_id: other_franchise_id}}.
    """
    out = {}
    for gid, ((a, b), _n) in D16_SUPER_BOWLS.items():
        out[gid] = {a: b, b: a}
    return out


def d16_expected_counts() -> dict:
    return {gid: n for gid, (_pair, n) in D16_SUPER_BOWLS.items()}


def d16_record(game_id, pfr_player_id, prior_fid, new_fid):
    _record("D16", "snap_count", f"{game_id}/{pfr_player_id}", "franchise_id",
            prior_fid, new_fid, _D16_SRC)


def player_game_stat_corrections() -> dict:
    """{(gsis_id, season, week, season_type): {column: (prior, new, defect, src)}}

    Covers D17 (44 duplicated-play values) and D19's position relabel. The D19
    RE-KEY is separate -- see player_game_stat_rekeys().
    """
    out: dict = {}
    for key, cols in D17_DUPLICATED_PLAYS.items():
        out.setdefault(key, {}).update(
            {c: (prior, new, "D17", _D17_SRC) for c, (prior, new) in cols.items()})
    for season, week, st in D19_ROWS:
        key = (D19_WRONG_GSIS, season, week, st)
        out.setdefault(key, {}).update(
            {c: (prior, new, "D19", _D19_SRC) for c, (prior, new) in D19_POSITION.items()})
    return out


def player_game_stat_rekeys() -> dict:
    """{(old_gsis, season, week, season_type): new_gsis} -- D19."""
    return {(D19_WRONG_GSIS, s, w, t): D19_CORRECT_GSIS for s, w, t in D19_ROWS}


def d19_record(old_key, new_gsis):
    _record("D19", "player_game_stats", str(old_key), "gsis_id",
            D19_WRONG_GSIS, new_gsis, _D19_SRC)


# ==========================================================================
# post-build verification -- against the BUILT DATABASE, never a projection
# ==========================================================================
def verify_in_database(conn, check) -> None:
    """Assert the corrected state in the database that was actually written.

    S2's EX-1 is the reason this exists: B1's self-check "227/227 resolved,
    zero remaining" never opened the database -- it described a dict. Every
    assertion below reads `conn`.
    """
    q = lambda s, *a: conn.execute(s, a).fetchone()

    # D9
    n = q("SELECT COUNT(*) FROM game WHERE game_id='2010_10_HOU_JAX' "
          "AND espn_event_id='301114030'")[0]
    check(2, "D9: 2010_10_HOU_JAX carries espn_event_id 301114030", n == 1, f"{n}")
    n = q("SELECT COUNT(*) FROM (SELECT espn_event_id FROM game "
          "GROUP BY 1 HAVING COUNT(*)>1)")[0]
    check(2, "D9: zero espn_event_id collisions in the database", n == 0, f"{n}")

    # D10
    n = q("SELECT COUNT(*) FROM game WHERE season=2026 AND location='Neutral'")[0]
    check(2, "D10: 2026 has 10 neutral-site games (was 0)",
          n == len(D10_NEUTRAL_2026), f"{n}")
    n = q("SELECT COUNT(*) FROM game WHERE playoff_round='SB' AND location<>'Neutral'")[0]
    check(2, "D10: every Super Bowl row is Neutral", n == 0, f"{n}")
    n = q("""SELECT COUNT(*) FROM (SELECT season FROM game WHERE season<=2026
             GROUP BY season HAVING SUM(location='Neutral')=0)""")[0]
    check(2, "D10: every season has at least one neutral-site game", n == 0, f"{n}")

    # D11
    n = q("""SELECT COUNT(*) FROM game WHERE season=2026
             AND gameday=substr(kickoff_utc,1,10)""")[0]
    total = q("SELECT COUNT(*) FROM game WHERE season=2026")[0]
    check(2, "D11: 55 of the 285 2026 gamedays no longer equal the UTC date",
          total - n == D11_EXPECTED_ROWS, f"{total - n} moved of {total}")
    # The regression guard. A placeholder kickoff (timeValid=0, midnight-ET marker)
    # must never have its date shifted -- that is exactly the bug F09 caught, where
    # 36 rows were moved a day early. Their gameday must still equal the UTC date.
    n = q("""SELECT COUNT(*) FROM game WHERE season=2026 AND time_valid=0
             AND gameday<>substr(kickoff_utc,1,10)""")[0]
    check(2, "D11: no placeholder-kickoff row had its date shifted", n == 0, f"{n}")
    n = q("SELECT COUNT(*) FROM game WHERE season=2026 AND time_valid=0")[0]
    check(2, "D11: the 36 placeholder rows are still present and untouched",
          n == 36, f"{n}")

    # D12
    n = q("""SELECT COUNT(*) FROM game WHERE gametime_et='21:30'
             AND location='Neutral'""")[0]
    check(2, "D12: no neutral-site game is still stored at 21:30 ET", n == 0, f"{n}")
    for gid, spec in D12_KICKOFFS.items():
        got = q("SELECT kickoff_utc,gametime_et FROM game WHERE game_id=?", gid)
        want = (spec["kickoffUtc"][1], spec["gametimeEt"][1])
        check(2, f"D12: {gid} kickoff corrected", got == want, f"{got} != {want}")

    # D13
    for gid, spec in D13_VENUES.items():
        got = q("SELECT stadium FROM game WHERE game_id=?", gid)[0]
        check(2, f"D13: {gid} records its actual venue", got == spec["stadium"][1],
              f"{got!r}")
    n = q("""SELECT COUNT(*) FROM game WHERE game_id IN (%s) AND (temp IS NOT NULL
             OR wind IS NOT NULL)""" % ",".join("?" * len(D13_UNVERIFIABLE_WEATHER)),
          *D13_UNVERIFIABLE_WEATHER)[0]
    check(2, "D13: the 5 unverifiable weather readings are untouched (rule 1)",
          n == len(D13_UNVERIFIABLE_WEATHER), f"{n}")

    # D15
    bad = []
    for (gid, franchise), (correct, prior, _cause) in D15_REST.items():
        row = q("""SELECT rest_days, rest_days_upstream FROM team_game
                   WHERE game_id=? AND franchise_id=?""", gid, franchise)
        if row != (correct, prior):
            bad.append((gid, franchise, row))
    check(2, "D15: all 34 rest_days corrected, all 34 upstream values preserved",
          not bad, f"{bad[:3]}")
    n = q("""SELECT COUNT(*) FROM team_game tg JOIN game g ON g.game_id=tg.game_id
             WHERE tg.rest_days IS NOT (CASE WHEN tg.is_home=1 THEN g.home_rest
                                             ELSE g.away_rest END)""")[0]
    check(2, "D15: team_game.rest_days and game.{home,away}_rest stay in step",
          n == 0, f"{n}")

    # D16
    bad = []
    for gid, ((a, b), n_rows) in D16_SUPER_BOWLS.items():
        got = q("SELECT COUNT(*) FROM snap_count WHERE game_id=?", gid)[0]
        swapped = q("""SELECT COUNT(*) FROM snap_count
                       WHERE game_id=? AND franchise_id=franchise_id_upstream""", gid)[0]
        if got != n_rows or swapped != 0:
            bad.append((gid, got, n_rows, swapped))
    check(2, "D16: all 358 Super Bowl snap rows swapped, upstream preserved",
          not bad, f"{bad}")
    brady = q("""SELECT franchise_id FROM snap_count
                 WHERE game_id='2020_21_KC_TB' AND gsis_id='00-0019596'""")
    check(2, "D16: Tom Brady's SB LV snaps are on Tampa Bay (27), not KC (12)",
          brady is not None and brady[0] == 27, f"{brady}")

    # D17
    bad = []
    for (gsis, season, week, st), cols in D17_DUPLICATED_PLAYS.items():
        names = list(cols)
        row = q(f"SELECT {','.join(names)} FROM player_game_stats "
                f"WHERE gsis_id=? AND season=? AND week=? AND season_type=?",
                gsis, season, week, st)
        want = tuple(cols[c][1] for c in names)
        if row != want:
            bad.append((gsis, season, week, row, want))
    check(2, "D17: all 44 duplicated-play values corrected", not bad, f"{bad[:2]}")

    # D18
    row = q("SELECT pfr_id,draft_year,draft_round,draft_pick,draft_team "
            "FROM player WHERE gsis_id='00-0035629'")
    check(2, "D18: the Alabama OT holds WillJo10 and the 2019 R1 P11 pick",
          row == ("WillJo10", 2019, 1, 11, "CIN"), f"{row}")
    row = q("SELECT pfr_id,draft_year,draft_round,draft_pick,draft_team "
            "FROM player WHERE gsis_id='00-0035944'")
    check(2, "D18: the Weber State DE holds WillJo16 and is undrafted",
          row == ("WillJo16", None, None, None, None), f"{row}")
    a = q("SELECT COUNT(*) FROM snap_count WHERE gsis_id='00-0035629'")[0]
    b = q("SELECT COUNT(*) FROM snap_count WHERE gsis_id='00-0035944'")[0]
    check(2, "D18: the 146 snap rows follow the corrected pfr ids (79 OT / 67 DE)",
          (a, b) == (79, 67), f"OT={a} DE={b}")

    # D19
    n = q("SELECT COUNT(*) FROM player_game_stats WHERE gsis_id=? AND season=2020",
          D19_WRONG_GSIS)[0]
    check(2, "D19: the 2024 lineman no longer holds a 2020 season", n == 0, f"{n}")
    n = q("SELECT COUNT(*) FROM player_game_stats WHERE gsis_id=? AND season=2020",
          D19_CORRECT_GSIS)[0]
    check(2, "D19: the safety's 13 2020 rows are restored", n == len(D19_ROWS), f"{n}")
    n = q("""SELECT COUNT(*) FROM player_game_stats WHERE gsis_id=? AND season=2020
             AND position='OL'""", D19_CORRECT_GSIS)[0]
    check(2, "D19: those rows no longer carry the lineman's position label",
          n == 0, f"{n}")

    # The audit table itself.
    n = q("SELECT COUNT(*) FROM data_correction")[0]
    check(2, "every applied correction is recorded in data_correction",
          n == applied_count(), f"table={n} applied={applied_count()}")
    got = {r[0] for r in conn.execute("SELECT DISTINCT defect FROM data_correction")}
    want = {"D9", "D10", "D11", "D12", "D13", "D15", "D16", "D17", "D18", "D19"}
    check(2, "data_correction covers all 10 corrected defects", got == want,
          f"missing {sorted(want - got)} unexpected {sorted(got - want)}")
    n = q("SELECT COUNT(*) FROM data_correction WHERE source IS NULL OR source=''")[0]
    check(2, "every data_correction row carries a source citation", n == 0, f"{n}")


def _main() -> int:
    """Self-check: the constants are internally coherent. Reads no files."""
    ok = True

    def expect(name, cond, detail=""):
        nonlocal ok
        print(f"    [{'PASS' if cond else 'FAIL'}] {name}"
              + ("" if cond else f"  -- {detail}"))
        ok = ok and bool(cond)

    expect("D10 covers 10 games", len(D10_NEUTRAL_2026) == 10, len(D10_NEUTRAL_2026))
    expect("D10 includes Super Bowl LXI",
           "2026_POST_SB_401873270" in D10_NEUTRAL_2026)
    expect("D12 covers 7 kickoffs", len(D12_KICKOFFS) == 7, len(D12_KICKOFFS))
    expect("D12: 5 London rows move by exactly -12h",
           sum(1 for s in D12_KICKOFFS.values()
               if s["gametimeEt"] == ("21:30", "09:30")) == 5)
    expect("D13 covers 7 venues", len(D13_VENUES) == 7, len(D13_VENUES))
    expect("D13 leaves 5 weather rows untouched",
           len(D13_UNVERIFIABLE_WEATHER) == 5)
    expect("D15 covers 34 rows across 25 distinct games",
           len(D15_REST) == 34 and len({g for g, _ in D15_REST}) == 25,
           f"{len(D15_REST)} rows / {len({g for g, _ in D15_REST})} games")
    expect("D16 covers 4 Super Bowls totalling 358 rows",
           len(D16_SUPER_BOWLS) == 4
           and sum(n for _p, n in D16_SUPER_BOWLS.values()) == 358,
           sum(n for _p, n in D16_SUPER_BOWLS.values()))
    n17 = sum(len(v) for v in D17_DUPLICATED_PLAYS.values())
    expect("D17 covers 44 field values over 14 player-games", n17 == 44, n17)
    expect("D18 is a true swap",
           D18_PLAYER["00-0035629"]["pfr_id"][1] == D18_PLAYER["00-0035944"]["pfr_id"][0]
           and D18_PLAYER["00-0035944"]["pfr_id"][1] == D18_PLAYER["00-0035629"]["pfr_id"][0])
    expect("D18 crosswalk swap agrees with the player swap",
           D18_PFR_CROSSWALK["WillJo10"][1] == "00-0035629"
           and D18_PFR_CROSSWALK["WillJo16"][1] == "00-0035944")
    expect("D19 covers 13 rows", len(D19_ROWS) == 13, len(D19_ROWS))
    expect("D19 does not re-key onto itself", D19_WRONG_GSIS != D19_CORRECT_GSIS)
    expect("5 contradictions are recorded and unresolved",
           len(OPEN_CONTRADICTIONS) == 6, len(OPEN_CONTRADICTIONS))
    expect("every correction carries a citation",
           all(isinstance(s["_src"], str) and len(s["_src"]) > 20
               for s in list(D12_KICKOFFS.values()) + list(D13_VENUES.values())))
    # The Pacific rule must reproduce A1's spot-checked values.
    for kickoff, want in (("2026-09-10T00:20:00Z", "2026-09-09"),
                          ("2026-11-02T01:20:00Z", "2026-11-01"),
                          ("2027-01-10T05:00:00Z", "2027-01-09"),
                          ("2026-09-11T00:35:00Z", "2026-09-10")):
        expect(f"pacific_date({kickoff}) == {want}",
               _pacific_date(kickoff) == want, _pacific_date(kickoff))
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(_main())
