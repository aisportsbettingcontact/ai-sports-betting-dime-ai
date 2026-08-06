#!/usr/bin/env python3
"""A4 - betting-line and derived-result integrity verification for scripts/data/nfl-db/nfl.db.

Read-only. Independently recomputes every derived column in `team_game` from `game` +
`game_line` (never from the loader's own arithmetic), sweeps `game_line` for implausible
prices, checks moneyline/spread coherence, and cross-checks the whole population against
two external archives that are cached on disk:

  cache/a4/nflverse_games.csv   upstream nflverse (transport check - proves the loader
                                did not corrupt anything and isolates the manual patch)
  cache/a4/soh_YYYY.html        SportsOddsHistory (covers.com), 16 seasons, full population
  cache/a4/espn/odds_*.json     ESPN core-API odds, 215-game stratified + targeted sample

Exit status
  0  every hard check passed AND the exception set is exactly the audited baseline
  1  a hard check failed, or the exception set drifted from the baseline
  2  bad invocation / database missing

Flags
  --strict          exit 1 if there is any exception at all, registered or not
  --require-cache   treat a missing external cache file as a failure instead of a skip
  -v/--verbose      print every exception row rather than a capped sample

Usage
  python3 scripts/data/nfl-db/verify/a4_lines.py
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime
import glob
import gzip
import html
import io
import json
import os
import re
import sqlite3
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # scripts/data/nfl-db
DB = os.path.join(ROOT, "nfl.db")
CACHE = os.path.join(ROOT, "cache", "a4")
ESPN_CACHE = os.path.join(CACHE, "espn")

# --------------------------------------------------------------------------------------
# Conventions this script asserts (each is proved below, not assumed)
#
#   game_line.spread_line  -- HOME perspective, positive = home favoured, i.e. the home
#                             team's expected margin of victory.  Proved by
#                             corr(game.result, spread_line) > 0 and by
#                             mean(result - spread_line) ~ 0.
#   team_game.spread       -- that team's perspective: +spread_line for the home row,
#                             -spread_line for the away row.
#   team_game.covered      -- 1 iff margin > spread, 0 iff margin < spread,
#                             NULL iff margin == spread (ATS push) OR the row has no
#                             line/result at all.  The NULL is OVERLOADED - see EX-01.
#   team_game.won          -- 1 iff margin > 0, 0 iff margin < 0,
#                             NULL iff margin == 0 (tie) OR the game is unplayed.
#                             The NULL is OVERLOADED - see EX-02.
# --------------------------------------------------------------------------------------

MANUAL_GAME = "2017_04_CHI_GB"
MANUAL_SOURCE = "manual-2026-07-27"
MANUAL_EXPECTED = {
    "spread_line": 7.5, "total_line": 44.0,
    "away_moneyline": 311, "home_moneyline": -357,
    "away_spread_odds": -110, "home_spread_odds": -110,
    "over_odds": -110, "under_odds": -110,
}
# The six columns the patch supplies; upstream nflverse is empty for all six.
MANUAL_PATCHED_COLS = ("away_moneyline", "home_moneyline", "away_spread_odds",
                       "home_spread_odds", "over_odds", "under_odds")

# ---- EX-03: rest_days rows where nflverse's value != the real calendar gap -------------
# nflverse computes rest against ORIGINALLY SCHEDULED dates, so Saturday specials, the
# 2021 covid reschedules and the cancelled 2022 BUF-CIN game leave stale values behind.
# (game_id, franchise_id) -> (calendar_gap, stored_value, cause)
REST_EXCEPTIONS = {
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

# ---- EX-08: moneyline favourite disagrees with the spread favourite -------------------
# Every one is a 1-point spread with the two moneylines inside 10 cents of each other -
# i.e. a market that is a coin flip, where the two quotes are free to land either side.
ML_SPREAD_COHERENCE_EXCEPTIONS = {
    "2010_15_CLE_CIN", "2013_15_CHI_CLE", "2016_09_DEN_OAK", "2018_09_LAC_SEA",
    "2020_09_BAL_IND", "2011_16_SD_DET", "2017_05_SF_IND", "2017_10_MIN_WAS",
    "2017_14_NYJ_DEN", "2021_04_CLE_MIN", "2021_15_NE_IND", "2022_08_SF_LA",
    "2024_17_TEN_JAX",
}

# ---- EX-04: moneyline pair whose two implied probabilities sum to < 1 -----------------
ML_NEGATIVE_HOLD_EXCEPTIONS = {"2020_01_LV_CAR"}

# ---- EX-05..07: games where an independent archive materially contradicts the line ----
EXTERNAL_LINE_DISPUTES = {
    "2021_10_DET_PIT": "DB PIT -9.0 / ML -359. SportsOddsHistory says PIT -6 and all 16 "
                       "pre-game ESPN providers say PIT -5.5/-6 with ML ~-250. "
                       "Roethlisberger was a covid scratch, which moved the line TOWARD "
                       "Detroit, so -9 is very likely an upstream nflverse error.",
    "2021_15_NE_IND": "DB NE -1.0 (away). ESPN majority says IND -1/-1.5 (home). The DB's "
                      "own moneyline (-102 NE / -109 IND) also leans IND, so this row is "
                      "internally inconsistent as well as externally contradicted.",
    "2021_17_CLE_PIT": "DB CLE -1.0 (away), corroborated by its own ML (-117 CLE / +105 "
                       "PIT). ESPN majority says PIT -1 (home). Near-pick'em; unresolved.",
}
# ESPN rows where a MINORITY provider names the other favourite but the DB is corroborated
# by the majority; adjudicated in the DB's favour, kept here so the check stays exact.
ESPN_MINORITY_DISSENT = {
    "2012_02_NO_CAR": "ESPN numberfire says CAR -3 (with a self-contradictory ML of "
                      "-135 NO / +115 CAR) and ESPN consensus says CAR -6.5. ESPN "
                      "teamrankings says NO -3 with ML -152/+137, byte-identical to the "
                      "DB, ESPN accuscore says NO -3, and SportsOddsHistory also has NO "
                      "as the favourite. DB is right; numberfire dissents.",
}
# SportsOddsHistory names the other team as favourite for these five; each has been
# individually adjudicated against ESPN and the DB wins every one.
SOH_SIDE_DISAGREEMENTS = {
    "2013_12_JAX_HOU": "SOH says JAX -2. ESPN consensus HOU -10, numberfire HOU -10.5, "
                       "teamrankings HOU -10.5 with ML +400/-470 (byte-identical to the "
                       "DB). DB is right, SOH is wrong.",
    "2014_04_MIA_OAK": "Wembley neutral site. SOH says OAK -3.5. All 9 ESPN providers say "
                       "MIA -3.5/-4 (teamrankings ML -190/+171 = the DB exactly). "
                       "DB is right, SOH is wrong.",
    "2021_15_LV_CLE": "SOH says CLE -3 (the pre-outbreak number). All 14 pre-game ESPN "
                      "providers say LV -2.5/-3 after Cleveland's QB room went on the "
                      "covid list. DB is right, SOH is stale.",
    "2024_14_NO_NYG": "SOH says NYG -5.5. ESPN BET says NO -5.5 (ML -275/+225); the DB's "
                      "own ML is -245 NO. DB is right, SOH mislabelled the favourite.",
    "2025_18_BAL_PIT": "SOH says PIT -5. ESPN DraftKings says BAL -4.5 (ML -205/+170); "
                       "the DB's own ML is -225 BAL. DB is right, SOH is wrong.",
}
# One SportsOddsHistory score typo, adjudicated against ESPN.
SOH_SCORE_DISAGREEMENTS = {
    "2025_20_HOU_NE": "SOH prints NE 28-15. ESPN summary 401772983 gives HOU 16 "
                      "(linescore 3+7+6+0) and NE 28. DB is right, SOH is a typo.",
}

# Baseline counts. Any drift here is a failure - the point of the script is that these
# numbers stop moving.
BASELINE = {
    "game_rows": 4648,
    "game_line_rows": 4363,
    "team_game_rows": 9270,
    "line_seasons": (2010, 2025),
    "manual_rows": 1,
    "nflverse_rows": 4362,
    "ats_push_games": 109,
    "ou_push_games": 45,
    "tie_games": 13,
    "rest_exceptions": len(REST_EXCEPTIONS),
    "ml_coherence_exceptions": len(ML_SPREAD_COHERENCE_EXCEPTIONS),
}

WEEK_ORDER = {"WC": 101, "DIV": 102, "CON": 103, "SB": 105}


# --------------------------------------------------------------------------------------
class Report:
    def __init__(self, verbose: bool, cap: int = 12):
        self.rows: list[tuple[str, str, str, str]] = []
        self.failed = 0
        self.skipped = 0
        self.exceptions: list[tuple[str, str]] = []
        self.verbose = verbose
        self.cap = cap

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.rows.append(("PASS" if ok else "FAIL", name, detail, ""))
        if not ok:
            self.failed += 1
        return ok

    def skip(self, name: str, why: str) -> None:
        self.rows.append(("SKIP", name, why, ""))
        self.skipped += 1

    def note(self, name: str, detail: str) -> None:
        self.rows.append(("INFO", name, detail, ""))

    def exception(self, ident: str, detail: str) -> None:
        self.exceptions.append((ident, detail))

    def dump(self) -> None:
        w = max(len(r[1]) for r in self.rows) + 2
        for status, name, detail, _ in self.rows:
            print(f"  [{status}] {name.ljust(w)} {detail}")

    def sample(self, items) -> list:
        items = list(items)
        return items if self.verbose else items[: self.cap]


def cached(*parts: str) -> str | None:
    """Resolve a cache path, accepting either the plain or the gzipped form."""
    path = os.path.join(*parts)
    if os.path.exists(path):
        return path
    if os.path.exists(path + ".gz"):
        return path + ".gz"
    return None


def cached_glob(pattern: str) -> list[str]:
    return sorted(glob.glob(pattern) + glob.glob(pattern + ".gz"))


def open_text(path: str) -> io.TextIOBase:
    """Open a cache artefact, transparently decompressing .gz."""
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return open(path, encoding="utf-8", errors="replace")


def connect() -> sqlite3.Connection:
    if not os.path.exists(DB):
        print(f"FATAL: {DB} not found", file=sys.stderr)
        sys.exit(2)
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def imp(ml: int) -> float:
    """American odds -> implied probability."""
    return (-ml) / (-ml + 100.0) if ml < 0 else 100.0 / (ml + 100.0)


def corr(a, b) -> float:
    ma, mb = statistics.mean(a), statistics.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** 0.5
    return num / den


# --------------------------------------------------------------------------------------
# 1. structure and coverage
# --------------------------------------------------------------------------------------
def check_coverage(conn, rep: Report) -> None:
    one = lambda s, *a: conn.execute(s, a).fetchone()[0]

    rep.check("game row count == baseline",
              one("SELECT COUNT(*) FROM game") == BASELINE["game_rows"],
              f"{one('SELECT COUNT(*) FROM game')} (want {BASELINE['game_rows']})")
    rep.check("game_line row count == baseline",
              one("SELECT COUNT(*) FROM game_line") == BASELINE["game_line_rows"],
              f"{one('SELECT COUNT(*) FROM game_line')} (want {BASELINE['game_line_rows']})")
    rep.check("team_game row count == baseline",
              one("SELECT COUNT(*) FROM team_game") == BASELINE["team_game_rows"],
              f"{one('SELECT COUNT(*) FROM team_game')} (want {BASELINE['team_game_rows']})")

    orphans = conn.execute("""SELECT l.game_id FROM game_line l
                              LEFT JOIN game g USING(game_id) WHERE g.game_id IS NULL""").fetchall()
    rep.check("no game_line row orphaned from game", not orphans,
              f"{len(orphans)} orphans")

    missing = conn.execute("""SELECT g.game_id, g.season, g.result_status FROM game g
                              LEFT JOIN game_line l USING(game_id)
                              WHERE g.season BETWEEN ? AND ? AND l.game_id IS NULL""",
                           BASELINE["line_seasons"]).fetchall()
    rep.check("every 2010-2025 game carries a line row", not missing,
              f"{len(missing)} without a line")

    notfinal = conn.execute("""SELECT COUNT(*) FROM game WHERE season BETWEEN ? AND ?
                               AND result_status <> 'final'""", BASELINE["line_seasons"]).fetchone()[0]
    rep.check("every 2010-2025 game is final", notfinal == 0, f"{notfinal} not final")

    y2026 = conn.execute("""SELECT COUNT(*) FROM game g JOIN game_line l USING(game_id)
                            WHERE g.season = 2026""").fetchone()[0]
    n2026 = one("SELECT COUNT(*) FROM game WHERE season = 2026")
    rep.check("the 285 2026 games carry no line row", y2026 == 0 and n2026 == 285,
              f"{n2026} 2026 games, {y2026} with lines")

    nulls = []
    for col in ("spread_line", "total_line", "away_moneyline", "home_moneyline",
                "away_spread_odds", "home_spread_odds", "over_odds", "under_odds",
                "odds_source"):
        n = one(f"SELECT COUNT(*) FROM game_line WHERE {col} IS NULL")
        if n:
            nulls.append((col, n))
    rep.check("every game_line price column is fully populated", not nulls, str(nulls))

    src = dict(conn.execute("SELECT odds_source, COUNT(*) FROM game_line GROUP BY 1").fetchall())
    rep.check("odds_source == {nflverse: 4362, manual: 1}",
              src.get("nflverse") == BASELINE["nflverse_rows"]
              and src.get(MANUAL_SOURCE) == BASELINE["manual_rows"] and len(src) == 2,
              str(src))

    tg_games = one("SELECT COUNT(DISTINCT game_id) FROM team_game")
    resolved = one("SELECT COUNT(*) FROM game WHERE away_franchise_id IS NOT NULL")
    rep.check("team_game is exactly 2 rows per resolvable game",
              tg_games == resolved and BASELINE["team_game_rows"] == 2 * resolved,
              f"{tg_games} games / {resolved} resolvable")


# --------------------------------------------------------------------------------------
# 2. sign conventions - proved, not assumed
# --------------------------------------------------------------------------------------
def check_sign_convention(conn, rep: Report) -> None:
    rs = conn.execute("""SELECT g.result, g.total, l.spread_line, l.total_line,
                                l.away_moneyline, l.home_moneyline
                         FROM game g JOIN game_line l USING(game_id)""").fetchall()
    res = [r["result"] for r in rs]
    sp = [r["spread_line"] for r in rs]
    c1 = corr(res, sp)
    ats = statistics.mean(r - s for r, s in zip(res, sp))
    flipped = statistics.mean(r + s for r, s in zip(res, sp))
    rep.check("spread_line is stated from the HOME perspective "
              "(corr(result, spread_line) > 0)", c1 > 0.3, f"corr={c1:.4f}")
    rep.check("mean ATS margin (result - spread_line) is ~0, "
              "so the sign is not inverted", abs(ats) < 0.5,
              f"mean(result-spread)={ats:+.4f}  vs mean(result+spread)={flipped:+.4f}")

    devig = [imp(r["home_moneyline"]) / (imp(r["home_moneyline"]) + imp(r["away_moneyline"]))
             for r in rs]
    c2 = corr(sp, devig)
    rep.check("moneylines and spreads describe the same favourite "
              "(corr(spread_line, devigged home win prob))", c2 > 0.9, f"corr={c2:.4f}")

    ct = corr([r["total"] for r in rs], [r["total_line"] for r in rs])
    mt = statistics.mean(r["total"] - r["total_line"] for r in rs)
    rep.check("total_line tracks the realised total and is not inverted",
              ct > 0.2 and abs(mt) < 1.5, f"corr={ct:.4f} mean(total-line)={mt:+.4f}")

    hf = conn.execute("""SELECT SUM(g.result > 0), COUNT(*) FROM game g JOIN game_line l
                         USING(game_id) WHERE l.spread_line > 0""").fetchone()
    af = conn.execute("""SELECT SUM(g.result < 0), COUNT(*) FROM game g JOIN game_line l
                         USING(game_id) WHERE l.spread_line < 0""").fetchone()
    rep.check("spread favourites win outright far more than half the time",
              hf[0] / hf[1] > 0.6 and af[0] / af[1] > 0.6,
              f"home favs {hf[0]}/{hf[1]}={hf[0]/hf[1]:.3f}  "
              f"away favs {af[0]}/{af[1]}={af[0]/af[1]:.3f}")


# --------------------------------------------------------------------------------------
# 3. full independent recomputation of every team_game derived column
# --------------------------------------------------------------------------------------
def check_derived(conn, rep: Report) -> None:
    games = {r["game_id"]: r for r in conn.execute("""
        SELECT g.game_id, g.season, g.season_type, g.week, g.playoff_round, g.kickoff_utc,
               g.gameday, g.away_franchise_id, g.home_franchise_id,
               g.away_score, g.home_score, g.away_rest, g.home_rest,
               l.spread_line, l.total_line, l.away_moneyline, l.home_moneyline
        FROM game g LEFT JOIN game_line l USING(game_id)""")}

    bad = collections.defaultdict(list)
    seen_pairs = collections.Counter()
    ties = set()
    ats_push = set()

    for tg in conn.execute("SELECT * FROM team_game"):
        gid = tg["game_id"]
        g = games.get(gid)
        if g is None:
            bad["orphan team_game row"].append((gid, tg["franchise_id"]))
            continue
        seen_pairs[gid] += 1
        is_home = tg["is_home"]

        # ---- side / opponent -----------------------------------------------------
        want_me = g["home_franchise_id"] if is_home else g["away_franchise_id"]
        want_opp = g["away_franchise_id"] if is_home else g["home_franchise_id"]
        if tg["franchise_id"] != want_me or tg["opponent_id"] != want_opp:
            bad["franchise/opponent side"].append((gid, tg["franchise_id"], want_me))

        # ---- points --------------------------------------------------------------
        pf = g["home_score"] if is_home else g["away_score"]
        pa = g["away_score"] if is_home else g["home_score"]
        if tg["points_for"] != pf or tg["points_against"] != pa:
            bad["points_for/against"].append((gid, tg["franchise_id"],
                                              (tg["points_for"], tg["points_against"]), (pf, pa)))

        # ---- margin, recomputed from game.away_score / game.home_score ------------
        margin = None if pf is None else pf - pa
        if tg["margin"] != margin:
            bad["margin"].append((gid, tg["franchise_id"], tg["margin"], margin))

        # ---- won: sign of margin; ties are NULL, never a loss ---------------------
        won = None if margin is None or margin == 0 else int(margin > 0)
        if tg["won"] != won:
            bad["won"].append((gid, tg["franchise_id"], tg["won"], won))
        if margin == 0:
            ties.add(gid)
            if tg["won"] == 0:
                bad["TIE SILENTLY COUNTED AS A LOSS"].append((gid, tg["franchise_id"]))

        # ---- spread from this team's perspective ---------------------------------
        sl = g["spread_line"]
        spread = None if sl is None else (sl if is_home else -sl)
        if tg["spread"] != spread:
            bad["spread (team perspective)"].append((gid, tg["franchise_id"], tg["spread"], spread))

        # ---- covered: > cover, < loss, == push (NULL) -----------------------------
        covered = None
        if margin is not None and spread is not None and margin != spread:
            covered = int(margin > spread)
        if tg["covered"] != covered:
            bad["covered"].append((gid, tg["franchise_id"], tg["covered"], covered,
                                   margin, spread))
        if margin is not None and spread is not None and margin == spread:
            ats_push.add(gid)
            if tg["covered"] is not None:
                bad["PUSH NOT REPRESENTED AS A PUSH"].append(
                    (gid, tg["franchise_id"], tg["covered"], margin, spread))

        # ---- total_line and moneyline carried onto the right side -----------------
        if tg["total_line"] != g["total_line"]:
            bad["total_line"].append((gid, tg["franchise_id"]))
        ml = g["home_moneyline"] if is_home else g["away_moneyline"]
        if tg["moneyline"] != ml:
            bad["moneyline side"].append((gid, tg["franchise_id"], tg["moneyline"], ml))

        # ---- rest_days as carried from nflverse ----------------------------------
        rest = g["home_rest"] if is_home else g["away_rest"]
        if tg["rest_days"] != rest:
            bad["rest_days != game.away_rest/home_rest"].append(
                (gid, tg["franchise_id"], tg["rest_days"], rest))

    for gid, n in seen_pairs.items():
        if n != 2:
            bad["game without exactly two team_game rows"].append((gid, n))

    for label in ("franchise/opponent side", "points_for/against", "margin", "won",
                  "spread (team perspective)", "covered", "total_line", "moneyline side",
                  "rest_days != game.away_rest/home_rest",
                  "TIE SILENTLY COUNTED AS A LOSS", "PUSH NOT REPRESENTED AS A PUSH",
                  "orphan team_game row", "game without exactly two team_game rows"):
        rows = bad.get(label, [])
        rep.check(f"recomputed: {label}", not rows,
                  "0 disagreements" if not rows else f"{len(rows)}: {rep.sample(rows)}")

    # ---- the two sides of a game must mirror each other ---------------------------
    mirror = conn.execute("""SELECT COUNT(*) FROM team_game a JOIN team_game b
        ON a.game_id = b.game_id AND a.franchise_id = b.opponent_id
        WHERE (a.margin IS NOT NULL AND a.margin <> -b.margin)
           OR (a.spread IS NOT NULL AND a.spread <> -b.spread)
           OR (a.points_for IS NOT NULL AND a.points_for <> b.points_against)""").fetchone()[0]
    rep.check("the two sides of every game are exact mirrors "
              "(margin, spread, points)", mirror == 0, f"{mirror} rows")

    opp = conn.execute("""SELECT COUNT(*) FROM team_game a JOIN team_game b
        ON a.game_id = b.game_id AND a.franchise_id <> b.franchise_id
        WHERE a.won IS NOT NULL AND b.won IS NOT NULL AND a.won = b.won""").fetchone()[0]
    rep.check("no game has two winners or two losers", opp == 0, f"{opp} rows")

    both = conn.execute("""SELECT COUNT(*) FROM team_game a JOIN team_game b
        ON a.game_id = b.game_id AND a.franchise_id <> b.franchise_id
        WHERE a.covered IS NOT NULL AND b.covered IS NOT NULL
          AND a.covered = b.covered""").fetchone()[0]
    rep.check("no game has both sides covering (or both failing)", both == 0, f"{both} rows")

    # ---- push / tie enumeration ---------------------------------------------------
    rep.check("ATS push count == baseline", len(ats_push) == BASELINE["ats_push_games"],
              f"{len(ats_push)} games, {2 * len(ats_push)} rows, all covered IS NULL")
    rep.check("tie count == baseline", len(ties) == BASELINE["tie_games"],
              f"{len(ties)} games, {2 * len(ties)} rows, all won IS NULL")
    tie_losses = conn.execute("SELECT COUNT(*) FROM team_game WHERE margin = 0 AND won = 0").fetchone()[0]
    rep.check("no tie is recorded as a loss", tie_losses == 0, f"{tie_losses} rows")
    tie_wins = conn.execute("SELECT COUNT(*) FROM team_game WHERE margin = 0 AND won = 1").fetchone()[0]
    rep.check("no tie is recorded as a win", tie_wins == 0, f"{tie_wins} rows")

    # ---- NULL overloading (EX-01 / EX-02) -----------------------------------------
    cov_null = conn.execute("SELECT COUNT(*) FROM team_game WHERE covered IS NULL").fetchone()[0]
    cov_noline = conn.execute("""SELECT COUNT(*) FROM team_game
        WHERE covered IS NULL AND (spread IS NULL OR margin IS NULL)""").fetchone()[0]
    rep.check("every covered IS NULL is either an ATS push or a row with no line/result",
              cov_null == cov_noline + 2 * len(ats_push),
              f"{cov_null} NULL = {cov_noline} no-line/unplayed + {2*len(ats_push)} push")
    rep.exception("EX-01",
                  f"team_game.covered NULL is OVERLOADED: {cov_null} NULLs = "
                  f"{cov_noline} rows with no line or no result + {2*len(ats_push)} ATS-push "
                  f"rows. The column alone cannot distinguish a push from an absent line. "
                  f"A backtest must qualify with `spread IS NOT NULL AND margin IS NOT NULL` "
                  f"before reading a NULL as a push.")

    won_null = conn.execute("SELECT COUNT(*) FROM team_game WHERE won IS NULL").fetchone()[0]
    won_unplayed = conn.execute("SELECT COUNT(*) FROM team_game WHERE won IS NULL AND margin IS NULL").fetchone()[0]
    rep.check("every won IS NULL is either a tie or an unplayed game",
              won_null == won_unplayed + 2 * len(ties),
              f"{won_null} NULL = {won_unplayed} unplayed + {2*len(ties)} tie")
    rep.exception("EX-02",
                  f"team_game.won NULL is OVERLOADED: {won_null} NULLs = {won_unplayed} "
                  f"unplayed rows + {2*len(ties)} tie rows. Ties are correctly NOT counted "
                  f"as losses, but the column alone cannot distinguish a tie from an "
                  f"unplayed game. Qualify with `margin IS NOT NULL`.")


# --------------------------------------------------------------------------------------
# 4. over/under results (v_backtest) recomputed from game.total
# --------------------------------------------------------------------------------------
def check_totals(conn, rep: Report) -> None:
    bad_ou, bad_ats, bad_marg = [], [], []
    ou_push = ats_push = 0
    for r in conn.execute("""SELECT v.game_id, v.result, v.total, v.spread_line, v.total_line,
                                    v.ats_winner, v.home_ats_margin, v.total_result, v.total_margin
                             FROM v_backtest v"""):
        want_ou = "over" if r["total"] > r["total_line"] else (
            "under" if r["total"] < r["total_line"] else "push")
        want_ats = "home" if r["result"] > r["spread_line"] else (
            "away" if r["result"] < r["spread_line"] else "push")
        if r["total_result"] != want_ou:
            bad_ou.append((r["game_id"], r["total_result"], want_ou))
        if r["ats_winner"] != want_ats:
            bad_ats.append((r["game_id"], r["ats_winner"], want_ats))
        if abs(r["home_ats_margin"] - (r["result"] - r["spread_line"])) > 1e-9 or \
           abs(r["total_margin"] - (r["total"] - r["total_line"])) > 1e-9:
            bad_marg.append(r["game_id"])
        ou_push += want_ou == "push"
        ats_push += want_ats == "push"

    rep.check("recomputed: over/under result", not bad_ou,
              "0 disagreements" if not bad_ou else str(rep.sample(bad_ou)))
    rep.check("recomputed: ATS winner", not bad_ats,
              "0 disagreements" if not bad_ats else str(rep.sample(bad_ats)))
    rep.check("recomputed: ATS and total margins", not bad_marg,
              "0 disagreements" if not bad_marg else str(rep.sample(bad_marg)))
    rep.check("over/under push count == baseline", ou_push == BASELINE["ou_push_games"],
              f"{ou_push} pushes, represented distinctly as total_result='push'")
    rep.check("v_backtest ATS push count agrees with team_game",
              ats_push == BASELINE["ats_push_games"], f"{ats_push} pushes")

    # every ATS push in v_backtest must be a covered-IS-NULL pair in team_game
    mismatch = conn.execute("""SELECT COUNT(*) FROM v_backtest v JOIN team_game t
        ON t.game_id = v.game_id
        WHERE v.ats_winner = 'push' AND t.covered IS NOT NULL""").fetchone()[0]
    rep.check("every v_backtest push is a covered-IS-NULL pair in team_game",
              mismatch == 0, f"{mismatch} rows")
    inverse = conn.execute("""SELECT COUNT(*) FROM v_backtest v JOIN team_game t
        ON t.game_id = v.game_id
        WHERE v.ats_winner <> 'push' AND t.spread IS NOT NULL AND t.margin IS NOT NULL
          AND t.covered IS NULL""").fetchone()[0]
    rep.check("no non-push game has a NULL covered", inverse == 0, f"{inverse} rows")


# --------------------------------------------------------------------------------------
# 5. rest_days recomputed from the calendar
# --------------------------------------------------------------------------------------
def check_rest(conn, rep: Report) -> None:
    rows = conn.execute("""SELECT tg.game_id, tg.franchise_id, tg.season, tg.season_type,
                                  tg.week, tg.playoff_round, tg.rest_days, g.gameday
                           FROM team_game tg JOIN game g USING(game_id)""").fetchall()
    by = collections.defaultdict(list)
    for r in rows:
        by[(r["franchise_id"], r["season"])].append(r)

    order = lambda r: r["week"] if r["season_type"] == "REG" else WEEK_ORDER[r["playoff_round"]]
    unregistered, first_bad, matched = [], [], 0
    for lst in by.values():
        lst = sorted(lst, key=order)
        for i, r in enumerate(lst):
            if r["rest_days"] is None:
                continue
            if i == 0:
                # nflverse convention: the first game of a season carries a nominal 7.
                if r["rest_days"] not in (7, 14):
                    first_bad.append((r["game_id"], r["franchise_id"], r["rest_days"]))
                continue
            gap = (datetime.date.fromisoformat(r["gameday"])
                   - datetime.date.fromisoformat(lst[i - 1]["gameday"])).days
            if gap == r["rest_days"]:
                matched += 1
                continue
            key = (r["game_id"], r["franchise_id"])
            if key in REST_EXCEPTIONS:
                want_gap, want_stored, _ = REST_EXCEPTIONS[key]
                if (gap, r["rest_days"]) != (want_gap, want_stored):
                    unregistered.append((key, gap, r["rest_days"], "drifted from baseline"))
            else:
                unregistered.append((key, gap, r["rest_days"], "NOT REGISTERED"))

    rep.check("rest_days for the first game of a season is the nominal 7 (or 14 after a "
              "postponed opener)", not first_bad, str(rep.sample(first_bad)))
    rep.check("rest_days matches the real calendar gap outside the registered exceptions",
              not unregistered,
              f"{matched} rows verified against the calendar, "
              f"{len(REST_EXCEPTIONS)} registered exceptions"
              if not unregistered else str(rep.sample(unregistered)))
    for (gid, fid), (gap, stored, cause) in sorted(REST_EXCEPTIONS.items()):
        rep.exception("EX-03", f"{gid} fid={fid}: rest_days={stored}, real calendar gap={gap}. {cause}")


# --------------------------------------------------------------------------------------
# 6. game_number
# --------------------------------------------------------------------------------------
def check_game_number(conn, rep: Report) -> None:
    rows = conn.execute("""SELECT tg.game_id, tg.franchise_id, tg.season, tg.season_type,
                                  tg.week, tg.playoff_round, tg.kickoff_utc, tg.game_number
                           FROM team_game tg""").fetchall()
    by = collections.defaultdict(list)
    for r in rows:
        by[(r["franchise_id"], r["season"])].append(r)
    order = lambda r: r["week"] if r["season_type"] == "REG" else WEEK_ORDER[r["playoff_round"]]
    gaps, chrono, weekly = [], [], []
    for key, lst in by.items():
        ns = sorted(r["game_number"] for r in lst)
        if ns != list(range(1, len(lst) + 1)):
            gaps.append((key, ns))
        for i, r in enumerate(sorted(lst, key=lambda x: x["kickoff_utc"]), 1):
            if r["game_number"] != i:
                chrono.append((r["game_id"], r["franchise_id"], r["game_number"], i))
        for i, r in enumerate(sorted(lst, key=order), 1):
            if r["game_number"] != i:
                weekly.append((r["game_id"], r["franchise_id"], r["game_number"], i))
    nulls = conn.execute("SELECT COUNT(*) FROM team_game WHERE game_number IS NULL").fetchone()[0]
    rep.check("game_number is never NULL", nulls == 0, f"{nulls}")
    rep.check("game_number is a gapless 1..n per team-season", not gaps,
              f"{len(by)} team-seasons" if not gaps else str(rep.sample(gaps)))
    rep.check("game_number is chronological by kickoff_utc", not chrono,
              "0 disagreements" if not chrono else str(rep.sample(chrono)))
    rep.check("game_number also agrees with week / playoff-round order", not weekly,
              "0 disagreements" if not weekly else str(rep.sample(weekly)))


# --------------------------------------------------------------------------------------
# 7. line plausibility + moneyline/spread coherence
# --------------------------------------------------------------------------------------
def check_plausibility(conn, rep: Report) -> None:
    rs = conn.execute("""SELECT l.*, g.season, g.away_abbr, g.home_abbr, g.result, g.total
                         FROM game_line l JOIN game g USING(game_id)""").fetchall()

    grid = [r["game_id"] for r in rs
            if (r["spread_line"] * 2) % 1 or (r["total_line"] * 2) % 1]
    rep.check("every spread and total sits on the half-point grid", not grid,
              str(rep.sample(grid)))

    hard_spread = [(r["game_id"], r["spread_line"]) for r in rs if abs(r["spread_line"]) > 30]
    rep.check("no |spread| exceeds 30", not hard_spread, str(rep.sample(hard_spread)))
    hard_total = [(r["game_id"], r["total_line"]) for r in rs
                  if not 25 <= r["total_line"] <= 70]
    rep.check("every total sits in [25, 70]", not hard_total, str(rep.sample(hard_total)))

    bad_ml = [(r["game_id"], r["away_moneyline"], r["home_moneyline"]) for r in rs
              if abs(r["away_moneyline"]) < 100 or abs(r["home_moneyline"]) < 100]
    rep.check("no moneyline sits strictly inside +/-100 (an impossible American quote)",
              not bad_ml, str(rep.sample(bad_ml)))
    bad_juice = [(r["game_id"],) for r in rs
                 if min(abs(r["away_spread_odds"]), abs(r["home_spread_odds"]),
                        abs(r["over_odds"]), abs(r["under_odds"])) < 100]
    rep.check("no juice value sits strictly inside +/-100", not bad_juice,
              str(rep.sample(bad_juice)))
    both_plus = [r["game_id"] for r in rs
                 if r["away_moneyline"] > 0 and r["home_moneyline"] > 0]
    rep.check("no game has both moneylines positive", not both_plus, str(rep.sample(both_plus)))

    # overround (market hold) must be >= 1 for a single book's two-sided quote
    def hold(a, b):
        return imp(a) + imp(b)
    neg_spread = [(r["game_id"], round(hold(r["away_spread_odds"], r["home_spread_odds"]), 4))
                  for r in rs if hold(r["away_spread_odds"], r["home_spread_odds"]) < 1]
    neg_total = [(r["game_id"], round(hold(r["over_odds"], r["under_odds"]), 4))
                 for r in rs if hold(r["over_odds"], r["under_odds"]) < 1]
    rep.check("spread juice never implies a negative hold", not neg_spread, str(rep.sample(neg_spread)))
    rep.check("total juice never implies a negative hold", not neg_total, str(rep.sample(neg_total)))
    neg_ml = {r["game_id"]: round(hold(r["away_moneyline"], r["home_moneyline"]), 4)
              for r in rs if hold(r["away_moneyline"], r["home_moneyline"]) < 1}
    rep.check("moneyline negative-hold set == registered exceptions",
              set(neg_ml) == ML_NEGATIVE_HOLD_EXCEPTIONS, str(neg_ml))
    for gid, ov in neg_ml.items():
        rep.exception("EX-04", f"{gid}: moneyline pair implies an overround of {ov} (<1.0), "
                               "i.e. a risk-free arbitrage, which no single book can post. "
                               "The away price (-124) is the outlier: all 10 ESPN providers "
                               "for this event quote the away side between -148 and -159 "
                               "while agreeing with the DB's home side (+130/+135) and its "
                               "spread (LV -3) and total (48). Treat this row's moneylines "
                               "as unreliable; the spread and total are corroborated.")

    # ---- moneyline favourite vs spread favourite --------------------------------
    disagree = []
    for r in rs:
        if r["spread_line"] == 0:
            continue                     # a true pick'em can price either side
        if r["away_moneyline"] == r["home_moneyline"]:
            continue                     # equal prices name no moneyline favourite
        ml_home_fav = r["home_moneyline"] < r["away_moneyline"]
        sp_home_fav = r["spread_line"] > 0
        if ml_home_fav != sp_home_fav:
            disagree.append((r["game_id"], r["spread_line"], r["away_moneyline"],
                             r["home_moneyline"]))
    ids = {d[0] for d in disagree}
    rep.check("moneyline/spread coherence set == registered exceptions",
              ids == ML_SPREAD_COHERENCE_EXCEPTIONS,
              f"{len(ids)} disagreements; unexpected={sorted(ids - ML_SPREAD_COHERENCE_EXCEPTIONS)}; "
              f"missing={sorted(ML_SPREAD_COHERENCE_EXCEPTIONS - ids)}")
    big = [d for d in disagree if abs(d[1]) >= 2]
    rep.check("NO moneyline/spread disagreement on any game with |spread| >= 2 "
              "(the signature of a swapped home/away column)", not big, str(big))
    for gid, sl, aml, hml in sorted(disagree):
        gap = abs(imp(aml) - imp(hml))
        rep.exception("EX-08", f"{gid}: spread {sl:+} favours the "
                               f"{'home' if sl > 0 else 'away'} team but the moneyline "
                               f"({aml:+}/{hml:+}) favours the other side. "
                               f"|spread|=1 coin-flip market, implied-probability gap "
                               f"{gap*100:.1f}pp - inside normal quote noise.")

    # ---- extreme-line inventory (adjudicated in the report) ----------------------
    ext = [(r["game_id"], r["away_abbr"], r["home_abbr"], r["spread_line"],
            r["away_moneyline"], r["home_moneyline"]) for r in rs if abs(r["spread_line"]) >= 18]
    rep.note("extreme spreads |spread| >= 18", f"{len(ext)} games: "
             + ", ".join(f"{e[0]}({e[3]:+})" for e in sorted(ext, key=lambda x: -abs(x[3]))))
    lo = min(r["total_line"] for r in rs)
    hi = max(r["total_line"] for r in rs)
    rep.note("total_line range", f"[{lo}, {hi}] - both inside the plausible 28-65 band")
    mls = sorted(rs, key=lambda r: min(r["away_moneyline"], r["home_moneyline"]))[:3]
    rep.note("largest moneyline favourites",
             ", ".join(f"{r['game_id']}({min(r['away_moneyline'], r['home_moneyline'])})" for r in mls))

    for gid, cause in sorted(EXTERNAL_LINE_DISPUTES.items()):
        rep.exception("EX-05/06/07", f"{gid}: {cause}")


# --------------------------------------------------------------------------------------
# 8. upstream transport check + the manual patch
# --------------------------------------------------------------------------------------
def check_upstream(conn, rep: Report, require_cache: bool) -> None:
    path = cached(CACHE, "nflverse_games.csv")
    if path is None:
        (rep.check if require_cache else rep.skip)(
            "game_line matches upstream nflverse byte for byte",
            False if require_cache else "cache/a4/nflverse_games.csv[.gz] absent; re-fetch "
            "with curl -o scripts/data/nfl-db/cache/a4/nflverse_games.csv "
            "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv")
        return
    up = {}
    with open_text(path) as fh:
        for r in csv.DictReader(fh):
            up[r["game_id"]] = r

    def num(v):
        v = (v or "").strip()
        return None if v in ("", "NA") else float(v)

    cols = ("spread_line", "total_line", "away_moneyline", "home_moneyline",
            "away_spread_odds", "home_spread_odds", "over_odds", "under_odds")
    diffs, missing = [], []
    for r in conn.execute("SELECT * FROM game_line"):
        u = up.get(r["game_id"])
        if u is None:
            missing.append(r["game_id"])
            continue
        for col in cols:
            b = num(u[col])
            if b is None or abs(float(r[col]) - b) > 1e-9:
                diffs.append((r["game_id"], col, float(r[col]), u[col] or "<empty>"))
    rep.check("every DB line row exists upstream", not missing, str(rep.sample(missing)))

    want = {(MANUAL_GAME, c) for c in MANUAL_PATCHED_COLS}
    got = {(d[0], d[1]) for d in diffs}
    rep.check("the ONLY divergence from upstream is the documented manual patch "
              "(6 values on 1 row)", got == want,
              f"{len(diffs)} diffs; unexpected={sorted(got - want)}; missing={sorted(want - got)}")
    rep.check("upstream is empty for all six patched values (nothing was overwritten)",
              all(d[3] == "<empty>" for d in diffs if (d[0], d[1]) in want),
              str([d for d in diffs if d[3] != "<empty>"]))

    extra = [g for g, u in up.items()
             if BASELINE["line_seasons"][0] <= int(u["season"]) <= BASELINE["line_seasons"][1]
             and num(u["spread_line"]) is not None
             and g not in {r["game_id"] for r in conn.execute("SELECT game_id FROM game_line")}]
    rep.check("upstream has no 2010-2025 priced game that the DB is missing", not extra,
              str(rep.sample(extra)))

    scores = []
    for r in conn.execute("SELECT game_id, away_score, home_score FROM game WHERE result_status='final'"):
        u = up.get(r["game_id"])
        if u and (num(u["away_score"]) != r["away_score"] or num(u["home_score"]) != r["home_score"]):
            scores.append((r["game_id"], (r["away_score"], r["home_score"]),
                           (u["away_score"], u["home_score"])))
    rep.check("every final score matches upstream", not scores, str(rep.sample(scores)))


def check_manual_patch(conn, rep: Report) -> None:
    row = conn.execute("SELECT * FROM game_line WHERE game_id = ?", (MANUAL_GAME,)).fetchone()
    rep.check(f"{MANUAL_GAME} exists", row is not None)
    if row is None:
        return
    bad = {k: (row[k], v) for k, v in MANUAL_EXPECTED.items() if row[k] != v}
    rep.check(f"{MANUAL_GAME} carries the documented values "
              "(spread 7.5, total 44, CHI +311 / GB -357, four -110)", not bad, str(bad))
    rep.check(f"{MANUAL_GAME}.odds_source == '{MANUAL_SOURCE}'",
              row["odds_source"] == MANUAL_SOURCE, row["odds_source"])
    others = conn.execute("SELECT game_id, odds_source FROM game_line WHERE odds_source <> 'nflverse'").fetchall()
    rep.check("no other row is flagged as manually sourced",
              [r["game_id"] for r in others] == [MANUAL_GAME], str([tuple(r) for r in others]))
    # -110 is NOT a marker of the patch: plain nflverse rows carry it too.
    allminus = conn.execute("""SELECT COUNT(*) FROM game_line WHERE odds_source = 'nflverse'
        AND away_spread_odds = -110 AND home_spread_odds = -110
        AND over_odds = -110 AND under_odds = -110""").fetchone()[0]
    rep.note("all-four--110 juice rows sourced from nflverse", f"{allminus} rows - so -110 "
             "cannot be used to identify the patched row; odds_source is the only marker")
    rep.exception("EX-09",
                  f"{MANUAL_GAME}: four of the six patched values (away_spread_odds, "
                  f"home_spread_odds, over_odds, under_odds = -110) are ASSUMED standard "
                  f"juice, not observed prices. The two moneylines (+311/-357) are "
                  f"owner-supplied and are independently corroborated by ESPN's "
                  f"teamrankings feed for event 400951678 (+311 / -357, spread GB -7.5, "
                  f"total 44.0). Restrict any juice-sensitive analysis with "
                  f"`odds_source = 'nflverse'`.")


# --------------------------------------------------------------------------------------
# 9. external archive: SportsOddsHistory (covers.com), full population
# --------------------------------------------------------------------------------------
_MON = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
_SOH_ALIASES = {"st louis rams": 14, "san diego chargers": 24, "oakland raiders": 13,
                "washington redskins": 28, "washington football team": 28}


def _parse_soh(path):
    with open_text(path) as fh:
        doc = fh.read()
    out = []
    for table in re.findall(r"<table.*?</table>", doc, re.S):
        trs = re.findall(r"<tr.*?</tr>", table, re.S)
        if not trs:
            continue
        hdr = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip()
               for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", trs[0], re.S)]
        joined = " ".join(hdr)
        if "Favorite" not in joined or "Over/Under" not in joined:
            continue
        off = 1 if hdr and hdr[0].startswith("Round") else 0
        for tr in trs[1:]:
            cl = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip()
                  for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if len(cl) < 10 + off:
                continue
            m = re.match(r"^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$", cl[1 + off])
            if not m:
                continue
            out.append({
                "date": datetime.date(int(m.group(3)), _MON[m.group(1)], int(m.group(2))),
                "fav_home": "@" in cl[3 + off], "fav": cl[4 + off], "score": cl[5 + off],
                "spread": cl[6 + off], "dog": cl[8 + off], "ou": cl[9 + off]})
    return out


def check_sportsoddshistory(conn, rep: Report, require_cache: bool) -> None:
    files = cached_glob(os.path.join(CACHE, "soh_*.html"))
    if not files:
        (rep.check if require_cache else rep.skip)(
            "SportsOddsHistory cross-check",
            False if require_cache else
            "cache/a4/soh_YYYY.html[.gz] absent; re-fetch each season from "
            "https://www.covers.com/sportsoddshistory/nfl-game-season/?y=YYYY")
        return

    names = {dn.lower(): f for f, dn in conn.execute(
        "SELECT franchise_id, display_name FROM team")}
    names.update(_SOH_ALIASES)

    def fid(n):
        return names[re.sub(r"\s*\(\d+\)\s*$", "", n).strip().lower()]

    db = {}
    for r in conn.execute("""SELECT g.game_id, g.gameday, g.away_franchise_id, g.home_franchise_id,
                                    g.away_score, g.home_score, g.total, g.location,
                                    l.spread_line, l.total_line
                             FROM game g JOIN game_line l USING(game_id)"""):
        db[(r["gameday"], frozenset((r["away_franchise_id"], r["home_franchise_id"])))] = r
    covered = {(g, f): c for g, f, c in conn.execute(
        "SELECT game_id, franchise_id, covered FROM team_game")}

    def mag(s):
        m = re.search(r"(-?\d+(?:\.\d+)?)", s.upper().replace("PK", "0"))
        return None if m is None else abs(float(m.group(1)))

    def letter(s, alphabet):
        m = re.match(r"\s*([" + alphabet + r"])", s.upper())
        return m.group(1) if m else None

    def ou_num(s):
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        return None if m is None else float(m.group(1))

    st = collections.Counter()
    orient, side, ats_mm, ou_mm, score_mm = [], [], [], [], []
    spread_delta, total_delta = collections.Counter(), collections.Counter()

    for path in files:
        for s in _parse_soh(path):
            f_, d_ = fid(s["fav"]), fid(s["dog"])
            row = None
            for off in (0, -1, 1, 2, -2, 3):
                row = db.get(((s["date"] + datetime.timedelta(days=off)).isoformat(),
                              frozenset((f_, d_))))
                if row:
                    break
            if row is None:
                st["unmatched"] += 1
                continue
            st["matched"] += 1
            gid = row["game_id"]
            home_is_fav = row["home_franchise_id"] == f_
            m = mag(s["spread"])
            soh_home = m if home_is_fav else -m

            if m and s["fav_home"] != home_is_fav:
                if row["location"] == "Neutral":
                    st["neutral_site_no_at_marker"] += 1
                else:
                    orient.append((gid, s["fav"], s["dog"]))

            d1 = round(soh_home - row["spread_line"], 2)
            spread_delta[d1] += 1
            if soh_home * row["spread_line"] < 0 and abs(row["spread_line"]) >= 2 and m >= 2:
                side.append((gid, row["spread_line"], soh_home))

            ou = ou_num(s["ou"])
            d2 = round(ou - row["total_line"], 2) if ou is not None else None
            if d2 is not None:
                total_delta[d2] += 1

            sc = re.search(r"(\d+)-(\d+)", s["score"])
            if sc:
                fav_pts, dog_pts = int(sc.group(1)), int(sc.group(2))
                db_fav, db_dog = ((row["home_score"], row["away_score"]) if home_is_fav
                                  else (row["away_score"], row["home_score"]))
                if (fav_pts, dog_pts) != (db_fav, db_dog):
                    score_mm.append((gid, (db_fav, db_dog), (fav_pts, dog_pts)))

            # Derived-result cross-check, restricted to games where the two archives
            # publish the IDENTICAL line - that isolates the arithmetic from the
            # source-to-source line variance.
            if d1 == 0:
                st["ats_compared"] += 1
                want = {"W": 1, "L": 0, "P": None}[letter(s["spread"], "WLP")]
                if want is None:
                    st["ats_push_compared"] += 1
                if covered[(gid, f_)] != want:
                    ats_mm.append((gid, s["fav"], want, covered[(gid, f_)]))
            if d2 == 0:
                st["ou_compared"] += 1
                want = letter(s["ou"], "OUP")
                if want == "P":
                    st["ou_push_compared"] += 1
                got = ("O" if row["total"] > row["total_line"]
                       else "U" if row["total"] < row["total_line"] else "P")
                if want != got:
                    ou_mm.append((gid, row["total_line"], row["total"], want, got))

    rep.check("SportsOddsHistory: every priced game matched",
              st["matched"] == BASELINE["game_line_rows"] and st["unmatched"] == 0,
              f"{st['matched']}/{BASELINE['game_line_rows']} matched, {st['unmatched']} unmatched")
    rep.check("SportsOddsHistory: home/away orientation agrees on every non-neutral game",
              not orient,
              f"0 disagreements over {st['matched']} games "
              f"({st['neutral_site_no_at_marker']} neutral-site games carry no '@' marker "
              f"upstream - structurally not applicable, not a gap)"
              if not orient else str(rep.sample(orient)))
    rep.check("SportsOddsHistory: ATS result agrees wherever the two archives publish "
              "the same spread", not ats_mm,
              f"0 disagreements over {st['ats_compared']} games, "
              f"including {st['ats_push_compared']} pushes"
              if not ats_mm else str(rep.sample(ats_mm)))
    rep.check("SportsOddsHistory: over/under result agrees wherever the two archives "
              "publish the same total", not ou_mm,
              f"0 disagreements over {st['ou_compared']} games, "
              f"including {st['ou_push_compared']} pushes"
              if not ou_mm else str(rep.sample(ou_mm)))
    ids = {s[0] for s in side}
    rep.check("SportsOddsHistory: favourite-side disagreements == registered set",
              ids == set(SOH_SIDE_DISAGREEMENTS),
              f"{len(ids)} disagreements; unexpected={sorted(ids - set(SOH_SIDE_DISAGREEMENTS))}")
    sids = {s[0] for s in score_mm}
    rep.check("SportsOddsHistory: score disagreements == registered set",
              sids == set(SOH_SCORE_DISAGREEMENTS),
              f"{len(sids)}; unexpected={sorted(sids - set(SOH_SCORE_DISAGREEMENTS))}")

    eq = spread_delta.get(0.0, 0)
    half = sum(v for k, v in spread_delta.items() if 0 < abs(k) <= 1.0)
    big = sum(v for k, v in spread_delta.items() if abs(k) >= 2)
    rep.note("SportsOddsHistory spread agreement",
             f"identical {eq}/{st['matched']}, within 1pt {eq+half}/{st['matched']}, "
             f"|delta|>=2 on {big} - normal closing-line variance between two publishers")
    eqt = total_delta.get(0.0, 0)
    halft = sum(v for k, v in total_delta.items() if 0 < abs(k) <= 1.0)
    bigt = sum(v for k, v in total_delta.items() if abs(k) >= 2)
    rep.note("SportsOddsHistory total agreement",
             f"identical {eqt}, within 1pt {eqt+halft}, |delta|>=2 on {bigt}")
    for gid, why in sorted(SOH_SIDE_DISAGREEMENTS.items()):
        rep.exception("EX-10", f"{gid}: {why}")
    for gid, why in sorted(SOH_SCORE_DISAGREEMENTS.items()):
        rep.exception("EX-11", f"{gid}: {why}")


# --------------------------------------------------------------------------------------
# 10. external archive: ESPN core-API odds sample
# --------------------------------------------------------------------------------------
# ESPN publishes in-play numbers under these provider names; they are not closing lines.
LIVE_PROVIDERS = {"Caesars Sportsbook (New Jersey) - Live Odds", "ESPN Bet - Live Odds"}
# ESPN's generic "Caesars Sportsbook" row is demonstrably unreliable for historical games
# (e.g. it returns a -22 spread with a 21.5 total for 2017_01_JAX_HOU).
UNRELIABLE_PROVIDERS = {"Caesars Sportsbook", "Opening", "consensus"}


def check_espn(conn, rep: Report, require_cache: bool) -> None:
    files = cached_glob(os.path.join(ESPN_CACHE, "odds_*.json"))
    if not files:
        (rep.check if require_cache else rep.skip)(
            "ESPN odds cross-check",
            False if require_cache else
            "cache/a4/espn/odds_*.json[.gz] absent; re-fetch from "
            "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/"
            "{id}/competitions/{id}/odds")
        return
    db = {}
    for r in conn.execute("""SELECT g.game_id, g.espn_event_id, l.spread_line, l.total_line,
                                    l.away_moneyline, l.home_moneyline
                             FROM game g JOIN game_line l USING(game_id)"""):
        db[r["espn_event_id"]] = r

    games = side_bad = 0
    sp_eq = sp_n = tot_eq = tot_n = ml_eq = ml_n = 0
    side_rows = []
    for path in files:
        m = re.search(r"odds_(\d+)\.json(?:\.gz)?$", path)
        if not m or m.group(1) not in db:
            continue
        try:
            with open_text(path) as fh:
                doc = json.load(fh)
        except Exception:
            continue
        items = doc.get("items") or []
        if not items:
            continue
        row = db[m.group(1)]
        games += 1
        for it in items:
            prov = (it.get("provider") or {}).get("name", "?")
            if prov in LIVE_PROVIDERS:
                continue
            sp = it.get("spread")
            if sp is not None:
                espn_home = -float(sp)          # ESPN posts the HOME handicap
                sp_n += 1
                sp_eq += abs(espn_home - row["spread_line"]) < 1e-9
                if (prov not in UNRELIABLE_PROVIDERS and sp != 0
                        and espn_home * row["spread_line"] < 0
                        and abs(row["spread_line"]) >= 2 and abs(espn_home) >= 2):
                    side_bad += 1
                    side_rows.append((row["game_id"], prov, row["spread_line"], espn_home))
            ou = it.get("overUnder")
            if ou is not None:
                tot_n += 1
                tot_eq += abs(float(ou) - row["total_line"]) < 1e-9
            hm = (it.get("homeTeamOdds") or {}).get("moneyLine")
            am = (it.get("awayTeamOdds") or {}).get("moneyLine")
            if hm and am:
                ml_n += 1
                ml_eq += int(hm) == row["home_moneyline"] and int(am) == row["away_moneyline"]

    rep.note("ESPN sample", f"{games} games with odds, {sp_n} provider quotes; "
             f"spread identical {sp_eq}/{sp_n}, total identical {tot_eq}/{tot_n}, "
             f"moneyline pair identical {ml_eq}/{ml_n}")
    known = set(EXTERNAL_LINE_DISPUTES) | set(ESPN_MINORITY_DISSENT)
    got = {s[0] for s in side_rows}
    rep.check("ESPN: no reputable provider puts the favourite on the other side "
              "for a game with |spread| >= 2, outside the registered disputes",
              got <= known, f"{len(got)} games; unexpected={sorted(got - known)}")
    for gid, why in sorted(ESPN_MINORITY_DISSENT.items()):
        if gid in got:
            rep.exception("EX-12", f"{gid}: {why}")


# --------------------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero if there is any exception at all")
    ap.add_argument("--require-cache", action="store_true",
                    help="fail instead of skipping when an external cache file is absent")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    conn = connect()
    rep = Report(args.verbose)

    print("A4 - betting-line and derived-result integrity")
    print(f"database: {DB}")
    print(f"cache:    {CACHE}")
    print()
    print("-- coverage ------------------------------------------------------------------")
    check_coverage(conn, rep)
    print("-- sign conventions ----------------------------------------------------------")
    check_sign_convention(conn, rep)
    print("-- derived columns, recomputed from scratch ----------------------------------")
    check_derived(conn, rep)
    print("-- over/under and ATS results ------------------------------------------------")
    check_totals(conn, rep)
    print("-- rest_days -----------------------------------------------------------------")
    check_rest(conn, rep)
    print("-- game_number ---------------------------------------------------------------")
    check_game_number(conn, rep)
    print("-- line plausibility and moneyline coherence ---------------------------------")
    check_plausibility(conn, rep)
    print("-- upstream transport + manual patch -----------------------------------------")
    check_upstream(conn, rep, args.require_cache)
    check_manual_patch(conn, rep)
    print("-- external: SportsOddsHistory (covers.com), all 16 seasons ------------------")
    check_sportsoddshistory(conn, rep, args.require_cache)
    print("-- external: ESPN core-API odds sample ---------------------------------------")
    check_espn(conn, rep, args.require_cache)

    print()
    rep.dump()

    print()
    print(f"exceptions ({len(rep.exceptions)}):")
    groups = collections.OrderedDict()
    for ident, detail in rep.exceptions:
        groups.setdefault(ident, []).append(detail)
    for ident, items in groups.items():
        print(f"  {ident}  ({len(items)})")
        for d in (items if args.verbose else items[:4]):
            print(f"      - {d}")
        if not args.verbose and len(items) > 4:
            print(f"      ... {len(items) - 4} more (-v to list)")

    print()
    checks = sum(1 for r in rep.rows if r[0] in ("PASS", "FAIL"))
    print(f"{checks - rep.failed}/{checks} checks passed, "
          f"{rep.skipped} skipped, {len(rep.exceptions)} registered exceptions")
    if rep.failed:
        print("VERDICT: FAIL")
        return 1
    if args.strict and rep.exceptions:
        print("VERDICT: FAIL (--strict: registered exceptions are present)")
        return 1
    print("VERDICT: PASS WITH EXCEPTIONS"
          if rep.exceptions else "VERDICT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
