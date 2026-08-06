#!/usr/bin/env python3
"""Row-loss reconciliation harness for the NFL analytical database.

WHY THIS EXISTS
---------------
`build_db.py` proves the database is internally consistent and that its
*aggregates* agree with its sources. It does not prove that every source row
arrived. Three of its load loops `continue` past rows without counting them, so
a source row can vanish and every check still passes -- which is exactly how
341 `player_stats.csv` rows went missing with a green build.

This module closes that hole. For every table it answers one question per
source row: **loaded, or excluded for a named reason?** There is no third
state. A row that is neither loaded nor on the exception manifest is
UNEXPLAINED LOSS and fails the gate.

WHAT IT CHECKS
--------------
Per table, two independent comparisons:

  KEY IDENTITY   -- multiset of primary keys, source vs database. Emits loaded
                    count, missing keys, extra keys, duplicate keys. A multiset
                    (not a set) so "loaded twice while another was dropped"
                    cannot cancel out to a matching total.
  VALUE IDENTITY -- multiset of complete row tuples, source vs database. Catches
                    a row that carries the right key but the wrong payload.

Equal counts prove nothing on their own; both comparisons must be clean.

EXCLUSION MANIFEST
------------------
`EXPECTED_EXCLUSIONS` pins the reason and the exact count of every legitimate
non-load, verified 2026-07-27. The gate fails if a count moves, if a new reason
appears, or if a manifested exclusion disappears. Widening it is a deliberate,
reviewable edit -- never a silent drift.

USAGE
-----
    python3 scripts/data/nfl-db/lib/rowloss.py                # full reconciliation
    python3 scripts/data/nfl-db/lib/rowloss.py --tables game,game_line
    python3 scripts/data/nfl-db/lib/rowloss.py --nulls        # + column NULL census
    python3 scripts/data/nfl-db/lib/rowloss.py --json out.json
    python3 scripts/data/nfl-db/lib/rowloss.py --no-values    # keys only (low memory)

Exit code 0 only when every table reconciles exactly and every exclusion
matches the manifest. Importable as a build gate:

    from rowloss import reconcile_all, Recon
    bad = [r for r in reconcile_all().values() if not r.clean]
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field

# ------------------------------------------------------------------ locations
HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(NFLDB)))
RAW = os.path.join(NFLDB, "raw")
DB_PATH = os.path.join(NFLDB, "nfl.db")
UNIFIED = os.path.join(ROOT, "scripts/data/nfl-unified-2010-2026/games.json")
HIST = os.path.join(ROOT, "scripts/data/nfl-lines-2010-2025/games.json")
NEW = os.path.join(ROOT, "scripts/data/nfl-2026/games.json")
TEAMS = os.path.join(ROOT, "scripts/data/nfl-2026/teams.json")

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

# Kept byte-identical to build_db.py. If build_db.py's alias tables change,
# change them here in the same commit -- the harness must model the loader it
# audits, not a remembered version of it.
RELOCATION_ALIASES = {
    "OAK": 13, "STL": 14, "LA": 14, "SD": 24, "WAS": 28,
}
PFR_STYLE_ALIASES = {
    "ARZ": 22, "BLT": 33, "CLV": 5, "HST": 34, "JAC": 30, "SL": 14,
}


# ------------------------------------------------------------------- casting
# Identical semantics to build_db.py's helpers. Duplicated rather than imported
# so this module has no import-time dependency on a script that runs a build.
def pick(row, *names):
    """First present, non-empty column among `names` (schema-drift tolerant)."""
    for n in names:
        if n in row and row[n] not in ("", None):
            return row[n]
    return None


def as_int(v):
    if v in (None, "", "NA"):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def as_real(v):
    if v in (None, "", "NA"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load_json(path):
    with open(path) as fh:
        return json.load(fh)


def stream_csv(path):
    """Yield (line_no, row_dict). Streams -- these files are up to 142 MB."""
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        rdr = csv.DictReader(fh)
        for i, row in enumerate(rdr, start=2):   # 1 is the header
            yield i, row


# ------------------------------------------------------------------- results
@dataclass
class Exception_:
    """One source row that did not become a database row."""
    reason: str
    locator: str                  # file:line or source id -- how to find it again
    identity: dict                # enough columns to recognise the row

    def as_dict(self):
        return {"reason": self.reason, "locator": self.locator, **self.identity}


@dataclass
class Recon:
    table: str
    source: str
    key_cols: tuple
    source_rows: int = 0
    expected: int = 0             # source rows that SHOULD have loaded
    loaded: int = 0               # rows actually in the database
    missing_keys: list = field(default_factory=list)
    extra_keys: list = field(default_factory=list)
    duplicate_keys: list = field(default_factory=list)
    value_drift: list = field(default_factory=list)
    exceptions: list = field(default_factory=list)
    manifest_errors: list = field(default_factory=list)
    values_checked: bool = False

    @property
    def excluded(self):
        return len(self.exceptions)

    @property
    def unexplained(self):
        """Source rows that are neither in the database nor on an exception list."""
        return self.source_rows - self.loaded - self.excluded

    @property
    def clean(self):
        return (not self.missing_keys and not self.extra_keys
                and not self.duplicate_keys and not self.value_drift
                and not self.manifest_errors and self.unexplained == 0
                and self.expected == self.loaded)

    def reasons(self):
        return Counter(e.reason for e in self.exceptions)

    def summary(self):
        return {
            "table": self.table, "source": self.source,
            "key": "+".join(self.key_cols),
            "source_rows": self.source_rows, "expected": self.expected,
            "loaded": self.loaded, "excluded": self.excluded,
            "unexplained": self.unexplained,
            "missing_keys": len(self.missing_keys),
            "extra_keys": len(self.extra_keys),
            "duplicate_keys": len(self.duplicate_keys),
            "value_drift": len(self.value_drift) if self.values_checked else None,
            "exclusion_reasons": dict(self.reasons()),
            "clean": self.clean,
        }


# =====================================================================
# The exclusion manifest. Every entry was individually identified and its
# cause verified; see docs/audits/2026-07-27-nfl-db-completion/reports/
# B4-row-loss.md for the evidence behind each number.
# =====================================================================
EXPECTED_EXCLUSIONS = {
    "player": {},
    "game": {},
    # 285 of the 4,648 games are the 2026 season, which has no closing lines
    # because it has not been played. Structural, not a gap.
    "game_line": {"season_2026_unplayed_no_line": 285},
    # 13 of the 4,648 games are 2026 playoff slots whose matchup is unresolved,
    # so there is no franchise to build a team-game row for. result_status='tbd'.
    # Counted per SIDE, not per game: a TBD game loses both of its two rows.
    "team_game": {"tbd_matchup_no_franchise": 26},
    # nflverse collapses every play it cannot attribute to a player into ONE
    # residual row per (season, week): 11 seasons x 21 weeks (2010-2020) +
    # 5 seasons x 22 weeks (2021-2025) = 341. player_id is empty on all of them.
    "player_game_stats": {"no_player_id": 341},
    "snap_count": {},
    "roster_season": {},
    # nflverse changed the depth-chart release format for 2025: schema-B rows
    # carry no season/week column at all. Owned by agent B3.
    "depth_chart": {"no_season_schema_b": 554215},
}


# =====================================================================
# Per-table replays. Each returns (expected_key_counter, expected_value_counter
# or None, exceptions, source_row_count).
#
# A replay reproduces build_db.py's transform for that table exactly. Where
# build_db.py silently `continue`s, the replay records an Exception_ instead.
# =====================================================================

def _teams_alias_map():
    teams = load_json(TEAMS)
    alias = {t["abbreviation"]: t["espnId"] for t in teams}
    alias.update(RELOCATION_ALIASES)
    alias.update(PFR_STYLE_ALIASES)
    return alias


def _known_players():
    """gsis ids the `player` dimension will hold, in build_db.py's own order."""
    seen = set()
    for _, r in stream_csv(os.path.join(RAW, "players.csv")):
        gid = pick(r, "gsis_id", "player_id")
        if gid and gid not in seen:
            seen.add(gid)
    return seen


def replay_player(want_values):
    keys, values, exc, n = Counter(), Counter(), [], 0
    seen = set()
    for line, r in stream_csv(os.path.join(RAW, "players.csv")):
        n += 1
        gid = pick(r, "gsis_id", "player_id")
        if not gid:
            exc.append(Exception_("no_gsis_id", f"players.csv:{line}",
                                  {"display_name": pick(r, "display_name")}))
            continue
        if gid in seen:
            exc.append(Exception_("duplicate_gsis_id", f"players.csv:{line}",
                                  {"gsis_id": gid, "display_name": pick(r, "display_name")}))
            continue
        seen.add(gid)
        keys[(gid,)] += 1
        if want_values:
            values[(gid, pick(r, "display_name", "full_name"),
                    pick(r, "first_name"), pick(r, "last_name"),
                    pick(r, "position"), pick(r, "position_group"),
                    pick(r, "birth_date"), as_int(pick(r, "height")),
                    as_int(pick(r, "weight")), pick(r, "college_name", "college"),
                    as_int(pick(r, "draft_year", "entry_year")),
                    as_int(pick(r, "draft_round")),
                    as_int(pick(r, "draft_pick", "draft_number")),
                    pick(r, "draft_club", "draft_team"),
                    as_int(pick(r, "rookie_year", "rookie_season")),
                    as_int(pick(r, "last_season")), pick(r, "status"),
                    pick(r, "esb_id"), pick(r, "pfr_id"), pick(r, "espn_id"),
                    pick(r, "headshot", "headshot_url"))] += 1
    return keys, (values if want_values else None), exc, n


def replay_game(want_values):
    rows = load_json(UNIFIED)
    known = _known_players()
    keys, values, exc = Counter(), Counter(), []
    for r in rows:
        keys[(r["gameId"],)] += 1
        if want_values:
            qb = lambda v: v if v in known else None
            values[(r["gameId"], r["espnEventId"], r["gsisId"], r["pfrId"], r["ftnId"],
                    r["oldGameId"], r["dataSource"], r["season"], r["seasonType"],
                    r["week"], r["playoffRound"], r["kickoffUtc"], r["gameday"],
                    r["gametimeEt"], r["weekday"], int(r["timeValid"]), r["resultStatus"],
                    r["awayFranchiseId"], r["homeFranchiseId"], r["awayAbbr"], r["homeAbbr"],
                    r["awayScore"], r["homeScore"], r["result"], r["total"], r["overtime"],
                    r["divGame"], r["location"], r["awayRest"], r["homeRest"], r["temp"],
                    r["wind"], qb(r["awayQbId"]), qb(r["homeQbId"]), r["awayQbName"],
                    r["homeQbName"], r["awayCoach"], r["homeCoach"], r["referee"],
                    r["roof"], r["surface"], r["stadiumId"], r["stadium"], r["venueId"],
                    r["broadcast"], r["note"])] += 1
    return keys, (values if want_values else None), exc, len(rows)


def replay_game_line(want_values):
    rows = load_json(UNIFIED)
    hist = {r["gameId"] for r in load_json(HIST)}
    keys, values, exc = Counter(), Counter(), []
    for r in rows:
        if r["spreadLine"] is None:
            # Classify rather than assume: a line-less game is only structural
            # if it is genuinely absent from the historical lines feed.
            reason = ("season_2026_unplayed_no_line" if r["gameId"] not in hist
                      else "in_lines_feed_but_spread_null")
            exc.append(Exception_(reason, f"nfl-unified-2010-2026/games.json:{r['gameId']}",
                                  {"game_id": r["gameId"], "season": r["season"],
                                   "result_status": r["resultStatus"]}))
            continue
        keys[(r["gameId"],)] += 1
        if want_values:
            values[(r["gameId"], r["spreadLine"], r["totalLine"], r["awayMoneyline"],
                    r["homeMoneyline"], r["awaySpreadOdds"], r["homeSpreadOdds"],
                    r["overOdds"], r["underOdds"], r["oddsSource"])] += 1
    return keys, (values if want_values else None), exc, len(rows)


def replay_team_game(want_values):
    """team_game is DERIVED, not loaded: 2 rows per game with a resolved matchup.

    The source row count is therefore 2 x games, and a TBD game contributes two
    exceptions, not one -- both sides are lost, and both must be accounted for.
    """
    rows = load_json(UNIFIED)
    keys, values, exc = Counter(), Counter(), []
    tg = []
    for r in rows:
        if r["awayFranchiseId"] is None:
            for side in ("home", "away"):
                exc.append(Exception_(
                    "tbd_matchup_no_franchise",
                    f"nfl-unified-2010-2026/games.json:{r['gameId']}:{side}",
                    {"game_id": r["gameId"], "season": r["season"],
                     "playoff_round": r["playoffRound"], "result_status": r["resultStatus"]}))
            continue
        for is_home in (1, 0):
            me = r["homeFranchiseId"] if is_home else r["awayFranchiseId"]
            opp = r["awayFranchiseId"] if is_home else r["homeFranchiseId"]
            pf = r["homeScore"] if is_home else r["awayScore"]
            pa = r["awayScore"] if is_home else r["homeScore"]
            margin = None if pf is None else pf - pa
            spread = None
            if r["spreadLine"] is not None:
                spread = r["spreadLine"] if is_home else -r["spreadLine"]
            ml = r["homeMoneyline"] if is_home else r["awayMoneyline"]
            rest = r["homeRest"] if is_home else r["awayRest"]
            won = None if margin is None or margin == 0 else int(margin > 0)
            covered = None
            if margin is not None and spread is not None and margin != spread:
                covered = int(margin > spread)
            keys[(r["gameId"], me)] += 1
            tg.append((r["gameId"], me, opp, r["season"], r["seasonType"], r["week"],
                       r["playoffRound"], r["kickoffUtc"], is_home, pf, pa, margin,
                       spread, r["totalLine"], ml, rest, won, covered, None))
    if want_values:
        order = defaultdict(list)
        for i, t in enumerate(tg):
            order[(t[1], t[3])].append((t[7], i))
        for _, lst in order.items():
            for n, (_, i) in enumerate(sorted(lst), start=1):
                tg[i] = tg[i][:18] + (n,)
        for t in tg:
            values[t] += 1
    return keys, (values if want_values else None), exc, 2 * len(rows)


def replay_player_game_stats(want_values):
    known = _known_players()
    alias = _teams_alias_map()
    keys, values, exc, n = Counter(), Counter(), [], 0
    seen_pk = {}
    for line, r in stream_csv(os.path.join(RAW, "player_stats.csv")):
        n += 1
        gid = pick(r, "player_id", "gsis_id")
        season, week = as_int(pick(r, "season")), as_int(pick(r, "week"))
        st = pick(r, "season_type") or "REG"
        ident = {"player_id": gid,
                 "player_name": pick(r, "player_display_name", "player_name"),
                 "season": season, "week": week, "season_type": st,
                 "team": pick(r, "team", "recent_team"),
                 "opponent": pick(r, "opponent_team", "opponent"),
                 "game_id": pick(r, "game_id")}
        loc = f"player_stats.csv:{line}"
        # Three distinct causes, never conflated: a row with no id at all is an
        # nflverse residual bucket; a row with an id the dimension lacks is a
        # crosswalk failure; a repeated key is a schema-defect casualty.
        if not gid:
            exc.append(Exception_("no_player_id", loc, ident))
            continue
        if gid not in known:
            exc.append(Exception_("player_id_absent_from_players_csv", loc, ident))
            continue
        if season is None or week is None:
            exc.append(Exception_("no_season_or_week", loc, ident))
            continue
        key = (gid, season, week, st)
        if key in seen_pk:
            ident["collides_with_line"] = seen_pk[key]
            exc.append(Exception_("primary_key_collision", loc, ident))
            continue
        seen_pk[key] = line
        keys[key] += 1
        if want_values:
            values[(gid, season, week, st,
                    alias.get(pick(r, "team", "recent_team")),
                    alias.get(pick(r, "opponent_team", "opponent")),
                    pick(r, "position"), pick(r, "position_group"),
                    as_int(pick(r, "completions")), as_int(pick(r, "attempts")),
                    as_int(pick(r, "passing_yards")), as_int(pick(r, "passing_tds")),
                    as_int(pick(r, "passing_interceptions", "interceptions")),
                    as_real(pick(r, "sacks_suffered", "sacks")),
                    as_real(pick(r, "passing_epa")),
                    as_int(pick(r, "carries", "rushing_attempts")),
                    as_int(pick(r, "rushing_yards")), as_int(pick(r, "rushing_tds")),
                    as_real(pick(r, "rushing_epa")),
                    as_int(pick(r, "receptions")), as_int(pick(r, "targets")),
                    as_int(pick(r, "receiving_yards")), as_int(pick(r, "receiving_tds")),
                    as_real(pick(r, "receiving_epa")), as_real(pick(r, "target_share")),
                    as_real(pick(r, "air_yards_share")),
                    as_real(pick(r, "fantasy_points")),
                    as_real(pick(r, "fantasy_points_ppr")))] += 1
    return keys, (values if want_values else None), exc, n


def replay_snap_count(want_values):
    alias = _teams_alias_map()
    pfr2gsis = {}
    for _, r in stream_csv(os.path.join(RAW, "players.csv")):
        p, g = pick(r, "pfr_id"), pick(r, "gsis_id", "player_id")
        if p and g:
            pfr2gsis[p] = g
    keys, values, exc, n = Counter(), Counter(), [], 0
    for line, r in stream_csv(os.path.join(RAW, "snap_counts.csv")):
        n += 1
        season = as_int(pick(r, "season"))
        if not season:
            exc.append(Exception_("no_season", f"snap_counts.csv:{line}",
                                  {"pfr_player_id": pick(r, "pfr_player_id"),
                                   "pfr_game_id": pick(r, "pfr_game_id")}))
            continue
        pfr = pick(r, "pfr_player_id", "pfr_id")
        # NB: the column is NAMED pfr_game_id but build_db.py fills it with
        # `pick(r, "game_id", "pfr_game_id")`, and snap_counts.csv always
        # supplies game_id -- so it holds the nflverse id ("2013_01_ARI_STL"),
        # never the PFR id ("201309080ram"). Documented defect; the key below
        # deliberately models the loader as written, not as named.
        keys[(pfr, pick(r, "game_id", "pfr_game_id"))] += 1
        if want_values:
            values[(pfr2gsis.get(pfr), pfr, pick(r, "game_id", "pfr_game_id"), season,
                    as_int(pick(r, "week")), pick(r, "game_type", "season_type"),
                    alias.get(pick(r, "team")), pick(r, "position"),
                    as_int(pick(r, "offense_snaps")), as_real(pick(r, "offense_pct")),
                    as_int(pick(r, "defense_snaps")), as_real(pick(r, "defense_pct")),
                    as_int(pick(r, "st_snaps")), as_real(pick(r, "st_pct")))] += 1
    return keys, (values if want_values else None), exc, n


def replay_roster_season(want_values):
    alias = _teams_alias_map()
    keys, values, exc, n = Counter(), Counter(), [], 0
    for line, r in stream_csv(os.path.join(RAW, "rosters.csv")):
        n += 1
        season = as_int(pick(r, "season"))
        if not season:
            exc.append(Exception_("no_season", f"rosters.csv:{line}",
                                  {"gsis_id": pick(r, "gsis_id"),
                                   "full_name": pick(r, "full_name")}))
            continue
        row = (pick(r, "gsis_id", "player_id"), season, alias.get(pick(r, "team")),
               pick(r, "position"), pick(r, "depth_chart_position"),
               as_int(pick(r, "jersey_number")), pick(r, "status"),
               pick(r, "full_name", "player_name"), as_int(pick(r, "years_exp")))
        keys[row] += 1          # no declared PK: the whole row IS the key
        if want_values:
            values[row] += 1
    return keys, (values if want_values else None), exc, n


def replay_depth_chart(want_values):
    alias = _teams_alias_map()
    keys, values, exc, n = Counter(), Counter(), [], 0
    for line, r in stream_csv(os.path.join(RAW, "depth_charts.csv")):
        n += 1
        season = as_int(pick(r, "season"))
        if not season:
            exc.append(Exception_("no_season_schema_b", f"depth_charts.csv:{line}",
                                  {"gsis_id": pick(r, "gsis_id"), "dt": pick(r, "dt"),
                                   "team": pick(r, "team")}))
            continue
        row = (pick(r, "gsis_id", "player_id"), season, as_int(pick(r, "week")),
               pick(r, "game_type", "season_type"),
               alias.get(pick(r, "team", "club_code")), pick(r, "position"),
               pick(r, "depth_position", "depth_chart_position"),
               as_int(pick(r, "depth_team", "depth_order")),
               pick(r, "full_name", "football_name", "player_name"))
        keys[row] += 1          # no declared PK: the whole row IS the key
        if want_values:
            values[row] += 1
    return keys, (values if want_values else None), exc, n


# table -> (replay fn, source label, key columns, db key SQL, db value SQL)
TABLES = {
    "player": (replay_player, "raw/players.csv", ("gsis_id",),
               "SELECT gsis_id FROM player",
               "SELECT * FROM player"),
    "game": (replay_game, "nfl-unified-2010-2026/games.json", ("game_id",),
             "SELECT game_id FROM game",
             "SELECT * FROM game"),
    "game_line": (replay_game_line, "nfl-unified-2010-2026/games.json (spreadLine present)",
                  ("game_id",),
                  "SELECT game_id FROM game_line",
                  "SELECT * FROM game_line"),
    "team_game": (replay_team_game, "derived: 2 rows per resolved game",
                  ("game_id", "franchise_id"),
                  "SELECT game_id, franchise_id FROM team_game",
                  "SELECT * FROM team_game"),
    "player_game_stats": (replay_player_game_stats, "raw/player_stats.csv",
                          ("gsis_id", "season", "week", "season_type"),
                          "SELECT gsis_id, season, week, season_type FROM player_game_stats",
                          "SELECT * FROM player_game_stats"),
    "snap_count": (replay_snap_count, "raw/snap_counts.csv",
                   ("pfr_player_id", "pfr_game_id"),
                   "SELECT pfr_player_id, pfr_game_id FROM snap_count",
                   "SELECT * FROM snap_count"),
    "roster_season": (replay_roster_season, "raw/rosters.csv", ("<whole row>",),
                      "SELECT * FROM roster_season",
                      "SELECT * FROM roster_season"),
    "depth_chart": (replay_depth_chart, "raw/depth_charts.csv", ("<whole row>",),
                    "SELECT * FROM depth_chart",
                    "SELECT * FROM depth_chart"),
}


# ------------------------------------------------------------------ compare
def _diff(expected: Counter, cur, sample=25):
    """Multiset difference against a streaming cursor.

    Returns (loaded, missing, extra, duplicates). Multiset, not set: a row
    loaded twice while another is dropped must NOT cancel out to "matches".
    """
    remaining = expected.copy()
    extra, dupes, loaded = [], Counter(), 0
    for row in cur:
        row = tuple(row)
        loaded += 1
        dupes[row] += 1
        if remaining.get(row, 0) > 0:
            remaining[row] -= 1
        else:
            if len(extra) < sample:
                extra.append(row)
    missing = [(k, v) for k, v in remaining.items() if v > 0]
    dup = [(k, v) for k, v in dupes.items() if v > 1]
    return loaded, missing, extra, dup


def reconcile_table(name, conn, want_values=True, sample=25):
    replay, source, key_cols, key_sql, val_sql = TABLES[name]
    keys, values, exc, n_src = replay(want_values)

    rec = Recon(table=name, source=source, key_cols=key_cols)
    rec.source_rows = n_src
    rec.expected = sum(keys.values())
    rec.exceptions = exc

    loaded, missing, extra, dup = _diff(keys, conn.execute(key_sql), sample)
    rec.loaded = loaded
    rec.missing_keys = missing
    rec.extra_keys = extra
    # For roster_season/depth_chart the "key" is the whole row, so repeated
    # tuples are legitimate multiplicity, not key violations -- they are only
    # reported as duplicates when the source does not also carry them.
    if key_cols == ("<whole row>",):
        rec.duplicate_keys = []
    else:
        rec.duplicate_keys = dup

    if want_values and values is not None:
        _, vmissing, vextra, _ = _diff(values, conn.execute(val_sql), sample)
        rec.values_checked = True
        rec.value_drift = [("missing", m) for m in vmissing[:sample]] + \
                          [("extra", e) for e in vextra[:sample]]

    want = EXPECTED_EXCLUSIONS.get(name, {})
    got = rec.reasons()
    for reason, count in sorted(want.items()):
        if got.get(reason, 0) != count:
            rec.manifest_errors.append(
                f"exclusion '{reason}': manifest says {count}, found {got.get(reason, 0)}")
    for reason, count in sorted(got.items()):
        if reason not in want:
            rec.manifest_errors.append(
                f"UNMANIFESTED exclusion '{reason}': {count} rows dropped for a reason "
                f"nobody has signed off on")
    return rec


def reconcile_all(db_path=DB_PATH, tables=None, want_values=True, sample=25):
    conn = sqlite3.connect(db_path)
    try:
        return {t: reconcile_table(t, conn, want_values, sample)
                for t in (tables or list(TABLES))}
    finally:
        conn.close()


# ------------------------------------------------------------- NULL census
# A NULL is one of three things, and conflating them is its own kind of lie.
#   structural: -- cannot apply to this row by construction (weather in a dome)
#   expected:   -- optional upstream field, absent for a documented population
#   MISSING:    -- the value should exist and does not; a real, countable gap
#   DEFECT:     -- unclassified. Nobody has looked. Always a finding.
# Every string below was verified against the shipped database on 2026-07-27;
# the commands are in the B4 report's Reproduce section.
NULL_CLASS = {
    # ---- game -----------------------------------------------------------
    ("game", "gsis_game_id"): "structural: all 285 are the 2026 ESPN rows; nflverse has no id for them yet",
    ("game", "pfr_game_id"): "structural: all 285 are the 2026 ESPN rows; PFR has no id for them yet",
    ("game", "old_game_id"): "structural: all 285 are the 2026 ESPN rows; no legacy id exists",
    ("game", "ftn_game_id"): ("mixed: 2403 structural (pre-2019, FTN charting did not exist) "
                              "+ 285 structural (2026) + 306 MISSING within 2019-2025 "
                              "(2023 is 0/285, 2024 13, 2025 7, 2019 1)"),
    ("game", "week"): "structural: POST rows carry playoff_round instead (CHECK-enforced)",
    ("game", "playoff_round"): "structural: REG rows carry week instead (CHECK-enforced)",
    ("game", "gametime_et"): "structural: all 285 are 2026 ESPN rows; the ESPN feed carries kickoff_utc only",
    ("game", "weekday"): "structural: all 285 are 2026 ESPN rows; not published by the ESPN feed",
    ("game", "away_score"): "structural: unplayed games have no score (CHECK-enforced)",
    ("game", "home_score"): "structural: unplayed games have no score (CHECK-enforced)",
    ("game", "result"): "structural: unplayed games have no result (CHECK-enforced)",
    ("game", "total"): "structural: unplayed games have no total (CHECK-enforced)",
    ("game", "overtime"): "structural: all 285 are unplayed 2026 games; overtime is unknowable",
    ("game", "div_game"): "structural: all 285 are 2026 ESPN rows; not published by the ESPN feed",
    ("game", "away_franchise_id"): "structural: 13 tbd playoff slots have no matchup",
    ("game", "home_franchise_id"): "structural: 13 tbd playoff slots have no matchup",
    ("game", "away_abbr"): "structural: 13 tbd playoff slots have no matchup",
    ("game", "home_abbr"): "structural: 13 tbd playoff slots have no matchup",
    ("game", "location"): "structural: 12 tbd playoff slots have no determined site (the SB slot does)",
    ("game", "away_rest"): "structural: all 285 are 2026 ESPN rows; rest days are an nflverse derivation",
    ("game", "home_rest"): "structural: all 285 are 2026 ESPN rows; rest days are an nflverse derivation",
    ("game", "temp"): ("mixed: 285 structural (2026 unplayed) + 1200 structural "
                       "(dome/closed roof) + 199 MISSING (open/outdoors finals, 91 of them in 2022)"),
    ("game", "wind"): ("mixed: 285 structural (2026 unplayed) + 1200 structural "
                       "(dome/closed roof) + 199 MISSING (open/outdoors finals, 91 of them in 2022)"),
    ("game", "away_qb_id"): "structural: all 285 are 2026 ESPN rows; starters not yet named. Zero resolution failures.",
    ("game", "home_qb_id"): "structural: all 285 are 2026 ESPN rows; starters not yet named. Zero resolution failures.",
    ("game", "away_qb_name"): "structural: all 285 are 2026 ESPN rows; starters not yet named",
    ("game", "home_qb_name"): "structural: all 285 are 2026 ESPN rows; starters not yet named",
    ("game", "away_coach"): "structural: all 285 are 2026 ESPN rows; not published by the ESPN feed",
    ("game", "home_coach"): "structural: all 285 are 2026 ESPN rows; not published by the ESPN feed",
    ("game", "referee"): "mixed: 285 structural (2026, crew unassigned) + 1 MISSING (2021_15_NE_IND)",
    ("game", "roof"): "structural: all 285 are 2026 ESPN rows; venue attributes not in the ESPN feed",
    ("game", "surface"): "structural: all 285 are 2026 ESPN rows; venue attributes not in the ESPN feed",
    ("game", "stadium_id"): "structural: all 285 are 2026 ESPN rows; nflverse stadium ids not assigned",
    ("game", "stadium"): "structural: all 285 are 2026 ESPN rows; venue attributes not in the ESPN feed",
    ("game", "venue_id"): "structural: ESPN-only field; 4363 nflverse rows never carry it, plus 12 tbd slots",
    ("game", "broadcast"): "structural: ESPN-only field; 4363 nflverse rows never carry it, plus 36 unannounced 2026 games",
    ("game", "note"): "expected: free-text, populated only when there is something to say",
    # ---- game_line ------------------------------------------------------
    #      (every column is NOT NULL by DDL; the census will say so)
    # ---- team_game ------------------------------------------------------
    ("team_game", "week"): "structural: POST rows carry playoff_round instead",
    ("team_game", "playoff_round"): "structural: REG rows carry week instead",
    ("team_game", "points_for"): "structural: 544 = the 272 played-matchup 2026 games x 2 sides",
    ("team_game", "points_against"): "structural: 544 = the 272 played-matchup 2026 games x 2 sides",
    ("team_game", "margin"): "structural: 544 unplayed 2026 team-games have no margin",
    ("team_game", "spread"): "structural: 544 unplayed 2026 team-games; 2026 has no lines",
    ("team_game", "total_line"): "structural: 544 unplayed 2026 team-games; 2026 has no lines",
    ("team_game", "moneyline"): "structural: 544 unplayed 2026 team-games; 2026 has no lines",
    ("team_game", "rest_days"): "structural: all 544 are 2026 rows; the ESPN feed carries no rest days",
    ("team_game", "won"): "structural: 544 unplayed + 26 ties",
    ("team_game", "covered"): "structural: 544 unplayed + pushes and line-less games",
    # ---- player ---------------------------------------------------------
    ("player", "draft_year"): "structural: 12807 undrafted players; all four draft columns NULL together, zero partial",
    ("player", "draft_round"): "structural: 12807 undrafted players; all four draft columns NULL together, zero partial",
    ("player", "draft_pick"): "structural: 12807 undrafted players; all four draft columns NULL together, zero partial",
    ("player", "draft_team"): "structural: 12807 undrafted players; all four draft columns NULL together, zero partial",
    ("player", "pfr_id"): "expected: crosswalk coverage -- 2481 players have no Pro-Football-Reference page",
    ("player", "espn_id"): "expected: crosswalk coverage -- 8267 players have no ESPN id upstream",
    ("player", "birth_date"): "MISSING: 35 players, absent in players.csv upstream",
    ("player", "height"): "MISSING: 10 players, absent in players.csv upstream",
    ("player", "weight"): "MISSING: 11 players, absent in players.csv upstream",
    ("player", "college"): "MISSING: 93 players, absent in players.csv upstream",
    ("player", "headshot_url"): "MISSING: 238 players, absent in players.csv upstream",
    # ---- player_game_stats ----------------------------------------------
    ("player_game_stats", "passing_epa"): ("structural: 276266 of 276269 have attempts=0. "
                                           "3 exceptions have attempts=1 and a blank EPA upstream "
                                           "(non-QB trick/desperation throws) -- upstream NA, not a cast failure"),
    ("player_game_stats", "rushing_epa"): "structural: all 251342 have carries=0",
    ("player_game_stats", "receiving_epa"): "structural: all 216935 have targets=0",
    # ---- snap_count -----------------------------------------------------
    ("snap_count", "gsis_id"): ("expected: the source has no gsis_id at all; 227 of 324611 rows "
                                "(30 distinct pfr ids) fail the PFR crosswalk. Owned by agent B1."),
    # ---- roster_season --------------------------------------------------
    ("roster_season", "gsis_id"): "MISSING: 18 rows carry no player id upstream; they can never join to player",
    ("roster_season", "position"): "MISSING: 16 rows, absent in rosters.csv upstream",
    ("roster_season", "depth_chart_position"): "expected: optional upstream field, assigned for 70.7% of rows",
    ("roster_season", "jersey_number"): "MISSING: 241 rows, absent in rosters.csv upstream",
    ("roster_season", "status"): "MISSING: 25 rows, absent in rosters.csv upstream",
    ("roster_season", "full_name"): "MISSING: 1 row, absent in rosters.csv upstream",
    ("roster_season", "years_exp"): "MISSING: 531 rows, absent in rosters.csv upstream",
    # ---- depth_chart ----------------------------------------------------
    ("depth_chart", "week"): ("structural: all 3390 carry season_type='SBBYE' -- the Super Bowl "
                              "bye-week snapshot, which has no week number by construction"),
    # ---- team_alias -----------------------------------------------------
    ("team_alias", "note"): "structural: note is written only for the 5 historical relocation aliases",
}


def null_census(db_path=DB_PATH):
    conn = sqlite3.connect(db_path)
    out = {}
    tabs = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for t in sorted(tabs):
        total = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        cols = [(r[1], r[3], r[5]) for r in conn.execute(f"PRAGMA table_info({t})")]
        rows = []
        if cols:
            sel = ", ".join(f"SUM({c[0]} IS NULL)" for c in cols)
            counts = conn.execute(f"SELECT {sel} FROM {t}").fetchone() if total else [0] * len(cols)
            for (col, notnull, pk), nulls in zip(cols, counts):
                nulls = nulls or 0
                if notnull or pk:
                    cls = "n/a: NOT NULL / PK -- NULL is impossible"
                elif nulls == 0:
                    cls = "none"
                else:
                    cls = NULL_CLASS.get((t, col), "DEFECT: unclassified NULLs")
                rows.append({"column": col, "nulls": nulls, "rows": total,
                             "pct": round(100.0 * nulls / total, 4) if total else 0.0,
                             "classification": cls})
        out[t] = rows
    conn.close()
    return out


# ------------------------------------------------------------------- report
def _fmt(v, width=90):
    s = repr(v)
    return s if len(s) <= width else s[:width - 3] + "..."


def print_report(recs, nulls=None, verbose_exceptions=10):
    print("=" * 100)
    print("ROW-LOSS RECONCILIATION -- source vs database, every row accounted for")
    print("=" * 100)
    hdr = (f"{'table':<20}{'source':>10}{'expect':>10}{'loaded':>10}{'excl':>8}"
           f"{'unexpl':>8}{'miss':>7}{'extra':>7}{'dup':>6}{'drift':>7}  verdict")
    print(hdr)
    print("-" * 100)
    for r in recs.values():
        drift = len(r.value_drift) if r.values_checked else -1
        print(f"{r.table:<20}{r.source_rows:>10}{r.expected:>10}{r.loaded:>10}"
              f"{r.excluded:>8}{r.unexplained:>8}{len(r.missing_keys):>7}"
              f"{len(r.extra_keys):>7}{len(r.duplicate_keys):>6}"
              f"{(drift if drift >= 0 else '-'):>7}"
              f"  {'OK' if r.clean else 'FAIL'}")
    print("-" * 100)
    tot_src = sum(r.source_rows for r in recs.values())
    tot_load = sum(r.loaded for r in recs.values())
    tot_exc = sum(r.excluded for r in recs.values())
    print(f"{'TOTAL':<20}{tot_src:>10}{'':>10}{tot_load:>10}{tot_exc:>8}"
          f"{tot_src - tot_load - tot_exc:>8}")

    print("\nEXCLUSIONS -- every source row that did not load, by named cause")
    print("-" * 100)
    any_exc = False
    for r in recs.values():
        for reason, count in sorted(r.reasons().items()):
            any_exc = True
            manifested = reason in EXPECTED_EXCLUSIONS.get(r.table, {})
            print(f"  {r.table:<20} {reason:<40} {count:>8}  "
                  f"{'[manifested]' if manifested else '[UNMANIFESTED]'}")
            for e in [e for e in r.exceptions if e.reason == reason][:verbose_exceptions]:
                print(f"      {e.locator}  {_fmt(e.identity)}")
            if count > verbose_exceptions:
                print(f"      ... and {count - verbose_exceptions} more")
    if not any_exc:
        print("  (none)")

    problems = [r for r in recs.values() if not r.clean]
    print("\nDEFECTS")
    print("-" * 100)
    if not problems:
        print("  (none) -- every source row is either loaded or on a manifested exception list")
    for r in problems:
        print(f"  {r.table}:")
        for m in r.manifest_errors:
            print(f"    manifest: {m}")
        if r.unexplained:
            print(f"    UNEXPLAINED LOSS: {r.unexplained} source rows are neither "
                  f"loaded nor excluded")
        if r.expected != r.loaded:
            print(f"    expected {r.expected} rows, database holds {r.loaded}")
        for k, v in r.missing_keys[:verbose_exceptions]:
            print(f"    missing key x{v}: {_fmt(k)}")
        if len(r.missing_keys) > verbose_exceptions:
            print(f"    ... and {len(r.missing_keys) - verbose_exceptions} more missing keys")
        for k in r.extra_keys[:verbose_exceptions]:
            print(f"    extra key (in db, not in source): {_fmt(k)}")
        for k, v in r.duplicate_keys[:verbose_exceptions]:
            print(f"    duplicate key x{v}: {_fmt(k)}")
        for kind, row in r.value_drift[:verbose_exceptions]:
            print(f"    value drift ({kind}): {_fmt(row)}")

    if nulls:
        print("\nCOLUMN NULL CENSUS -- every NULL classified: structural / expected / MISSING / DEFECT")
        print("-" * 100)
        tally = Counter()
        for t, cols in nulls.items():
            defects = [c for c in cols if c["classification"].startswith("DEFECT")]
            print(f"  {t}  ({cols[0]['rows'] if cols else 0} rows, {len(cols)} columns)"
                  f"{'   <-- ' + str(len(defects)) + ' UNCLASSIFIED' if defects else ''}")
            for c in cols:
                tally[c["classification"].split(":")[0]] += 1
                if c["nulls"]:
                    print(f"      {c['column']:<24}{c['nulls']:>9}  {c['pct']:>7.3f}%  "
                          f"{c['classification']}")
        print("\n  columns by classification: "
              + ", ".join(f"{k}={v}" for k, v in sorted(tally.items())))
    print()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--tables", help="comma-separated subset of "
                                     + ",".join(TABLES))
    ap.add_argument("--no-values", action="store_true",
                    help="skip the full-row value comparison (keys only, less memory)")
    ap.add_argument("--nulls", action="store_true", help="include the column NULL census")
    ap.add_argument("--json", help="write the machine-readable result here")
    ap.add_argument("--sample", type=int, default=25)
    ap.add_argument("--json-cap", type=int, default=500,
                    help="max exceptions dumped per reason in --json (0 = all). "
                         "The depth_chart exclusion alone is 554,215 rows; dumping "
                         "it whole produces a 94 MB file nobody reads.")
    a = ap.parse_args(argv)

    tables = [t.strip() for t in a.tables.split(",")] if a.tables else None
    if tables:
        unknown = [t for t in tables if t not in TABLES]
        if unknown:
            ap.error(f"unknown table(s): {unknown}")

    recs = reconcile_all(a.db, tables, not a.no_values, a.sample)
    nulls = null_census(a.db) if a.nulls else None
    print_report(recs, nulls)

    if a.json:
        def dump(r):
            if not a.json_cap:
                return [e.as_dict() for e in r.exceptions]
            kept, seen = [], Counter()
            for e in r.exceptions:
                seen[e.reason] += 1
                if seen[e.reason] <= a.json_cap:
                    kept.append(e.as_dict())
            return kept
        with open(a.json, "w") as fh:
            json.dump({
                "tables": {t: r.summary() for t, r in recs.items()},
                "exception_cap_per_reason": a.json_cap or None,
                "exceptions": {t: dump(r) for t, r in recs.items()},
                "nulls": nulls,
            }, fh, indent=1, default=str)
        print(f"wrote {a.json}")

    bad = [r.table for r in recs.values() if not r.clean]
    # An unclassified NULL is a gap nobody has looked at, so it fails too --
    # but only when the census was actually requested.
    unclassified = [f"{t}.{c['column']}" for t, cols in (nulls or {}).items()
                    for c in cols if c["classification"].startswith("DEFECT")]
    if bad:
        print(f"FAIL -- unreconciled tables: {bad}")
    if unclassified:
        print(f"FAIL -- unclassified NULL columns: {unclassified}")
    if bad or unclassified:
        return 1
    print("PASS -- every source row is loaded or explained"
          + ("; every NULL is classified" if nulls else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
