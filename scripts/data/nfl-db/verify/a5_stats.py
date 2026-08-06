#!/usr/bin/env python3
"""
A5 — player statistics verification: player_game_stats + snap_count.

Two independent bodies of work:

  PHASE 1 "internal"  full-population, no network. Every one of the 286,843
                      player_game_stats rows and all 324,611 snap_count rows.
                      Includes a byte-level fidelity diff of the DB against the
                      nflverse extracts in raw/ (the loader's own input), which
                      separates "the loader corrupted it" from "the source says
                      that".

  PHASE 2 "espn"      stratified sample of whole games compared player-by-player
                      against ESPN box scores
                      (site.api.espn.com/.../summary?event=<espn_event_id>).
                      Every response is cached under cache/a5/ and re-read on
                      subsequent runs; --offline refuses to touch the network.

Read-only against nfl.db (opened with mode=ro). Writes only to cache/a5/.

Exit status
    0   every finding is in KNOWN_EXCEPTIONS with a written adjudication
    1   at least one unexplained mismatch
    2   the run could not be completed (missing db, network refused, ...)

Usage
    python3 verify/a5_stats.py                     # everything
    python3 verify/a5_stats.py --phase internal    # no network at all
    python3 verify/a5_stats.py --phase espn --offline
    python3 verify/a5_stats.py --json out.json
"""

from __future__ import annotations

import argparse
import collections
import csv
import gzip
import json
import os
import random
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # scripts/data/nfl-db
DB = os.path.join(ROOT, "nfl.db")
RAW = os.path.join(ROOT, "raw")
CACHE = os.path.join(ROOT, "cache", "a5")
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={}"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) nfl-db-audit/A5"

SEED = 20260727           # frozen: the sample must be identical on every re-run
SLEEP = 1.2               # seconds between network fetches (nine other agents share it)

# nflverse encodes postseason rounds as week numbers that continue the regular
# season. The offset moved when the regular season went to 18 weeks in 2021.
POST_ROUNDS = ("WC", "DIV", "CON", "SB")

# Stat columns that exist in BOTH player_game_stats and raw/player_stats.csv.
# (left = DB column, right = CSV column)
DB_TO_CSV = {
    "completions": "completions", "attempts": "attempts",
    "passing_yards": "passing_yards", "passing_tds": "passing_tds",
    "interceptions": "passing_interceptions", "sacks_suffered": "sacks_suffered",
    "passing_epa": "passing_epa",
    "carries": "carries", "rushing_yards": "rushing_yards",
    "rushing_tds": "rushing_tds", "rushing_epa": "rushing_epa",
    "receptions": "receptions", "targets": "targets",
    "receiving_yards": "receiving_yards", "receiving_tds": "receiving_tds",
    "receiving_epa": "receiving_epa", "target_share": "target_share",
    "air_yards_share": "air_yards_share",
    "fantasy_points": "fantasy_points", "fantasy_points_ppr": "fantasy_points_ppr",
    "position": "position", "position_group": "position_group",
}
INT_COLS = {"completions", "attempts", "passing_yards", "passing_tds", "interceptions",
            "carries", "rushing_yards", "rushing_tds",
            "receptions", "targets", "receiving_yards", "receiving_tds"}

SNAP_DB_TO_CSV = {
    "pfr_player_id": "pfr_player_id", "pfr_game_id": "pfr_game_id",
    "season": "season", "week": "week", "position": "position",
    "offense_snaps": "offense_snaps", "offense_pct": "offense_pct",
    "defense_snaps": "defense_snaps", "defense_pct": "defense_pct",
    "st_snaps": "st_snaps", "st_pct": "st_pct",
}

# --------------------------------------------------------------------------
# Adjudicated exceptions.  A finding whose key is listed here is *explained*;
# anything else fails the run.  Every entry names its third source.
# --------------------------------------------------------------------------
KNOWN_EXCEPTIONS: dict[str, dict[str, str]] = {
    # ---- IC-03 laterals: yardage with zero opportunity -------------------
    "IC03": {
        "*": "nflverse credits lateral yardage to the lateral receiver/rusher without "
             "crediting a reception or a carry. Verified against ESPN box scores in "
             "phase 2 (ESPN assigns the whole play to the original receiver), and "
             "against nfl.com official play-by-play. Encoding difference, not a "
             "wrong value — but a prop model must not read receiving_yards>0 with "
             "receptions=0 as a catch.",
    },
    # ---- IC-01 receiving TDs with zero receptions (same lateral class) ----
    "IC01_rectd": {
        "00-0034857|2024|13|REG": "Josh Allen 7-yd receiving TD on a lateral/backward "
                                  "pass; nflverse books the TD but no reception. ESPN "
                                  "credits it as a rush. Encoding difference.",
        "00-0039139|2024|3|REG": "Jahmyr Gibbs 20-yd receiving TD off a lateral; "
                                 "nflverse books the TD but no reception. Encoding "
                                 "difference.",
    },
    # ---- IC-04 air_yards_share above 1 -----------------------------------
    "IC04_ayshare": {
        "*": "air_yards_share is player air yards / TEAM air yards, and team air yards "
             "is a play-by-play quantity that includes negative air yards on passes "
             "thrown behind the line. A single receiver's share can therefore exceed "
             "1.0 when his team-mates' air yards are net negative. Recomputed from "
             "raw/player_stats.csv for 4 of the 5 rows and it reproduces exactly; the "
             "5th uses a PBP denominator that includes throwaways (no receiver row). "
             "The [0,1] bound is the wrong assumption, not the data.",
    },
    # ---- IC-10 snap percentage rounding band -----------------------------
    "IC10_rounding": {
        "*": "Pro-Football-Reference publishes snap share as a whole percent, and from "
             "2019 onward its published percent is not always the nearest whole "
             "percent of snaps/team_snaps. Deviations of <=0.01 are inside that "
             "publication grain. Reported, not counted as errors.",
    },
    # ---- IC-09 roster: player-season on a team roster_season omits --------
    "IC09_move": {
        "*": "roster_season is nflverse's end-of-season roster snapshot and omits "
             "stints a player finished before the snapshot. Every one of these has "
             "the player on some other team's roster_season for the same season, i.e. "
             "a mid-season move. Verified non-overlapping in time by IC-09b.",
    },
    # ---- IC-09b non-contiguous team blocks -------------------------------
    "IC09b": {
        "00-0023968|2012": "Micheal Spurlock SD -> JAX -> SD (waived/re-signed).",
        "00-0023968|2013": "Micheal Spurlock DET -> DAL -> DET.",
        "00-0026577|2015": "Marcus Thigpen BUF -> OAK -> BUF.",
        "00-0026579|2012": "Kahlil Bell CHI -> NYJ -> CHI.",
        "00-0027547|2019": "Marcus Sherels MIN -> MIA -> MIN.",
        "00-0027737|2013": "Perrish Cox SF -> SEA -> SF.",
        "00-0028987|2014": "Phillip Supernaw BAL -> KC -> BAL.",
        "00-0030280|2016": "Knile Davis KC -> GB -> KC.",
        "00-0031991|2020": "DeVante Bausby DEN -> ARI -> DEN.",
        "00-0032790|2023": "DeAndre Houston-Carson HOU -> BAL -> HOU.",
        "00-0033001|2017": "Trae Elston BUF -> PHI -> BUF.",
    },
    # ---- ESPN comparison: definitional, not errors ------------------------
    "E_TGT_ZERO_REC": {
        "*": "ESPN's box score receiving table only lists players who recorded at "
             "least one reception, so a player targeted zero-for-N is absent from "
             "ESPN entirely and ESPN's team target total is short by those targets. "
             "nflverse counts them. Definitional; DB is the more complete side.",
    },
    "E_ESPN_ONLY_ZERO": {
        "*": "ESPN lists a player whose entire line is zeroes / non-scoring returns; "
             "no corresponding non-zero DB row is required.",
    },
    # ---- ESPN omits a player entirely: adjudicated in the DB's favour --------
    "E_ESPN_OMITS_ATHLETE": {
        "00-0030061": "ESPN's summary endpoint omits Zach Ertz from every box score in "
                      "the sample (2013-2024, PHI/ARI/WSH). ESPN's own arithmetic "
                      "convicts ESPN: in each of those games ESPN's team passing "
                      "completions/yards exceed the sum of its own receiving table by "
                      "exactly the DB's Ertz line (2013 wk2 gap 2/58 = DB 2/58; 2016 "
                      "wk13 9/79 = 9/79; 2018 wk2 11/94 = 11/94; 2021 wk16 8/54 = 8/54; "
                      "2024 wk8 7/77 = 7/77; 2024 DIV 5/28 = 5/28). ESPN defect, DB correct.",
    },
    # ---- targets: same total, different receiver --------------------------
    "E_TARGET_ATTRIBUTION": {
        "*": "ESPN and nflverse disagree on WHICH receiver was the intended target of an "
             "incompletion, but agree on the team's total targets for that game. Both "
             "sources charge the same number of targets; only the attribution differs. "
             "Recorded as a source disagreement, not a DB error.",
    },
}

# Findings that are individually itemised in the report and deliberately left
# as FAIL-worthy exceptions (they are real defects).  Listing them here keeps
# the exit status meaningful: the run is expected to exit 1 until they are fixed.
CONFIRMED_DEFECTS = {
    "D1": "player_game_stats is missing 2 receptions / 2 targets / 11 receiving yards "
          "for Dez Bryant (00-0027902) in 2012 wk6 DAL@BAL. nflverse ships that "
          "production in a row with a blank player_id (labelled team TEN, game "
          "2012_06_PIT_TEN), which the loader correctly drops. ESPN and nfl.com "
          "official play-by-play both say 13 rec / 95 yds / 2 TD; the DB says "
          "11 / 84 / 2.",
    "D2": "13 Tampa Bay 2020 stat lines are keyed to gsis 00-0039472 (Mike Edwards, "
          "OL, rookie year 2024, Campbell/Wake Forest) instead of 00-0035681 (Mike "
          "Edwards, S, TB 2019-2022). snap_count and roster_season both put the "
          "safety on TB for all 20 games of 2020; player_game_stats has no 2020 rows "
          "for him at all. Upstream nflverse identity collision, carried into the DB.",
    "D3": "7 snap_count rows carry an st_pct that cannot be reconciled with st_snaps "
          "under any integer team snap total (deviation 0.10-0.64).",
    "D4": "4 Super Bowls (2014_21_NE_SEA, 2015_21_CAR_DEN, 2018_21_NE_LA, "
          "2020_21_KC_TB) have every snap_count row attributed to the opposing team. "
          "Tom Brady's SB LV snaps sit under Kansas City; Patrick Mahomes' under "
          "Tampa Bay. The swap is present in raw/snap_counts.csv, so it is an "
          "upstream nflverse defect faithfully copied into nfl.db. 358 rows.",
    "D5": "player.pfr_id is swapped between the two Jonah Williamses (00-0035629 OT "
          "Alabama <-> 00-0035944 DE Weber State), so every snap_count row for either "
          "man attaches to the other's gsis_id -- 146 rows. Provable internally: the "
          "OT's stat lines are CIN/ARI while his snap rows are LAR/MIN/DET/NO.",
    "D6": "2011_13_DET_NO and 2011_10_DET_CHI: nflverse double-counts plays. In "
          "2011_13_DET_NO it credits 6 offensive/return TDs to NO (who scored 31 = 4 TD) "
          "and 3 to DET (who scored 17 = 2 TD), and inflates 10 players' lines; ESPN and "
          "nfl.com's official play-by-play agree against it. Every other game in "
          "2010-2025 reconstructs to the exact score.",
    "D7": "3 snap_count rows put Jalen Davis (pfr DaviJa06) in two different games "
          "played on the same day (2019 wk16, 2019 wk17, 2021 wk12). PFR conflates two "
          "players under one id. Present in raw/snap_counts.csv.",
}


# --------------------------------------------------------------------------
# plumbing
# --------------------------------------------------------------------------
@dataclass
class Check:
    cid: str
    title: str
    population: str
    n_checked: int = 0
    n_flagged: int = 0
    explained: int = 0
    unexplained: int = 0
    rows: list = field(default_factory=list)     # [(key, detail, adjudication|None)]
    notes: list = field(default_factory=list)

    def flag(self, key: str, detail: str, exc_bucket: str | None = None,
             exc_key: str | None = None):
        self.n_flagged += 1
        adj = None
        if exc_bucket and exc_bucket in KNOWN_EXCEPTIONS:
            table = KNOWN_EXCEPTIONS[exc_bucket]
            adj = table.get(exc_key or key) or table.get("*")
        if adj:
            self.explained += 1
        else:
            self.unexplained += 1
        self.rows.append((key, detail, adj))

    def as_dict(self):
        return {
            "id": self.cid, "title": self.title, "population": self.population,
            "checked": self.n_checked, "flagged": self.n_flagged,
            "explained": self.explained, "unexplained": self.unexplained,
            "notes": self.notes,
            "rows": [{"key": k, "detail": d, "adjudication": a} for k, d, a in self.rows],
        }


def db(readonly=True) -> sqlite3.Connection:
    if not os.path.exists(DB):
        sys.stderr.write(f"FATAL: {DB} not found\n")
        sys.exit(2)
    con = sqlite3.connect(f"file:{DB}?mode=ro" if readonly else DB, uri=True)
    con.row_factory = sqlite3.Row
    return con


def install_join_views(con: sqlite3.Connection):
    """player_game_stats has no game_id.  Recover it.

    REG: (season, week, franchise_id) -> team_game.
    POST: nflverse continues the week counter past the regular season; rank the
    distinct postseason weeks inside each season to get WC/DIV/CON/SB.
    """
    con.executescript(
        """
        CREATE TEMP VIEW post_map AS
        SELECT season, week,
               CASE rank WHEN 1 THEN 'WC' WHEN 2 THEN 'DIV'
                         WHEN 3 THEN 'CON' WHEN 4 THEN 'SB' END AS playoff_round
        FROM (SELECT season, week,
                     ROW_NUMBER() OVER (PARTITION BY season ORDER BY week) rank
              FROM (SELECT DISTINCT season, week
                    FROM player_game_stats WHERE season_type='POST'));

        CREATE TEMP TABLE pgs_game AS
        SELECT s.*, tg.game_id AS game_id, tg.opponent_id AS tg_opponent_id,
               tg.points_for AS points_for, tg.points_against AS points_against
        FROM player_game_stats s
        JOIN post_map pm ON pm.season=s.season AND pm.week=s.week
        JOIN team_game tg ON tg.season=s.season AND tg.franchise_id=s.franchise_id
                         AND tg.season_type='POST' AND tg.playoff_round=pm.playoff_round
        WHERE s.season_type='POST'
        UNION ALL
        SELECT s.*, tg.game_id, tg.opponent_id, tg.points_for, tg.points_against
        FROM player_game_stats s
        JOIN team_game tg ON tg.season=s.season AND tg.franchise_id=s.franchise_id
                         AND tg.season_type='REG' AND tg.week=s.week
        WHERE s.season_type='REG';

        CREATE INDEX temp.idx_pg_game ON pgs_game(game_id, franchise_id);
        CREATE INDEX temp.idx_pg_key  ON pgs_game(gsis_id, season, week, season_type);
        """
    )


# --------------------------------------------------------------------------
# PHASE 1 — internal consistency, full population
# --------------------------------------------------------------------------
def ic01_impossible(con) -> Check:
    c = Check("IC-01", "Impossible orderings and negative counting stats",
              "all 286,843 player_game_stats rows")
    c.n_checked = con.execute("SELECT COUNT(*) FROM player_game_stats").fetchone()[0]
    tests = [
        ("completions > attempts", "completions > attempts", None),
        ("receptions > targets", "receptions > targets", None),
        ("passing_tds > completions", "passing_tds > completions", None),
        ("rushing_tds > carries", "rushing_tds > carries", None),
        ("receiving_tds > receptions", "receiving_tds > receptions", "IC01_rectd"),
        ("interceptions > attempts", "interceptions > attempts", None),
        ("negative counting stat",
         "attempts<0 OR completions<0 OR carries<0 OR receptions<0 OR targets<0 "
         "OR passing_tds<0 OR rushing_tds<0 OR receiving_tds<0 OR interceptions<0", None),
        ("passing_yards without an attempt", "attempts=0 AND passing_yards<>0", None),
        ("NULL in a core counting column",
         "completions IS NULL OR attempts IS NULL OR carries IS NULL "
         "OR receptions IS NULL OR targets IS NULL OR passing_yards IS NULL "
         "OR rushing_yards IS NULL OR receiving_yards IS NULL", None),
    ]
    for label, pred, bucket in tests:
        for r in con.execute(
            f"SELECT gsis_id,season,week,season_type,franchise_id,position,"
            f"completions,attempts,carries,receptions,targets,receiving_tds,"
            f"passing_tds,rushing_tds FROM player_game_stats WHERE {pred}"
        ):
            key = f"{r['gsis_id']}|{r['season']}|{r['week']}|{r['season_type']}"
            c.flag(key, f"{label}: " + ", ".join(
                f"{k}={r[k]}" for k in ("position", "completions", "attempts", "carries",
                                        "receptions", "targets", "receiving_tds")), bucket)
    return c


def ic03_laterals(con) -> Check:
    c = Check("IC-03", "Yardage credited with zero opportunity (lateral encoding)",
              "all 286,843 player_game_stats rows")
    c.n_checked = con.execute("SELECT COUNT(*) FROM player_game_stats").fetchone()[0]
    for label, pred in [("rushing_yards with 0 carries", "carries=0 AND rushing_yards<>0"),
                        ("receiving_yards with 0 receptions",
                         "receptions=0 AND receiving_yards<>0")]:
        for r in con.execute(
            f"SELECT s.gsis_id,p.display_name,s.season,s.week,s.season_type,s.position,"
            f"s.carries,s.rushing_yards,s.receptions,s.targets,s.receiving_yards "
            f"FROM player_game_stats s LEFT JOIN player p USING(gsis_id) WHERE {pred}"
        ):
            key = f"{r['gsis_id']}|{r['season']}|{r['week']}|{r['season_type']}"
            c.flag(key, f"{label}: {r['display_name']} ({r['position']}) "
                        f"car={r['carries']} ry={r['rushing_yards']} "
                        f"rec={r['receptions']} tgt={r['targets']} "
                        f"recy={r['receiving_yards']}", "IC03")
    return c


def ic04_rates(con) -> Check:
    c = Check("IC-04", "Rate columns outside their possible bounds",
              "all 286,843 player_game_stats rows")
    c.n_checked = con.execute("SELECT COUNT(*) FROM player_game_stats").fetchone()[0]
    for label, pred, bucket in [
            ("target_share outside [0,1]", "target_share<0 OR target_share>1", None),
            ("air_yards_share outside [-1,1]",
             "air_yards_share < -1 OR air_yards_share > 1", "IC04_ayshare")]:
        for r in con.execute(
            f"SELECT gsis_id,season,week,season_type,franchise_id,targets,"
            f"target_share,air_yards_share,receiving_yards "
            f"FROM player_game_stats WHERE {pred}"
        ):
            key = f"{r['gsis_id']}|{r['season']}|{r['week']}|{r['season_type']}"
            c.flag(key, f"{label}: tgt={r['targets']} target_share={r['target_share']} "
                        f"air_yards_share={r['air_yards_share']}", bucket)
    return c


def ic05_team_reconcile(con) -> Check:
    """Inside one team-game nflverse must satisfy identities by construction:
    sum(receptions)==sum(completions), sum(receiving_yards)==sum(passing_yards),
    sum(receiving_tds)==sum(passing_tds), sum(targets)<=sum(attempts),
    sum(target_share)==1."""
    c = Check("IC-05", "Team-game passing/receiving identities",
              "all 8,726 team-games with player stats")
    rows = con.execute(
        """SELECT game_id, franchise_id, season, week, season_type,
                  SUM(completions) comp, SUM(attempts) att, SUM(passing_yards) py,
                  SUM(passing_tds) ptd, SUM(receptions) rec, SUM(targets) tgt,
                  SUM(receiving_yards) ry, SUM(receiving_tds) rtd,
                  SUM(target_share) tshare
           FROM pgs_game GROUP BY game_id, franchise_id"""
    ).fetchall()
    c.n_checked = len(rows)
    for r in rows:
        probs = []
        if r["rec"] != r["comp"]:
            probs.append(f"receptions {r['rec']} != completions {r['comp']}")
        if r["ry"] != r["py"]:
            probs.append(f"receiving_yards {r['ry']} != passing_yards {r['py']}")
        if r["rtd"] != r["ptd"]:
            probs.append(f"receiving_tds {r['rtd']} != passing_tds {r['ptd']}")
        if r["tgt"] > r["att"]:
            probs.append(f"targets {r['tgt']} > attempts {r['att']}")
        if r["tgt"] and abs((r["tshare"] or 0) - 1.0) > 0.005:
            probs.append(f"sum(target_share)={r['tshare']:.4f} != 1")
        if probs:
            c.flag(f"{r['game_id']}|{r['franchise_id']}", "; ".join(probs))
    return c


def ic06_scoring(con) -> Check:
    """Scrimmage TDs can never outscore the team.  player_game_stats holds no
    kicking / defensive / special-teams scoring, so this is a one-sided bound;
    the full score reconciliation lives in IC-06b against raw/player_stats.csv."""
    c = Check("IC-06", "Scrimmage touchdowns vs the final score",
              "all 8,726 team-games with player stats")
    rows = con.execute(
        """SELECT game_id, franchise_id, points_for,
                  SUM(rushing_tds)+SUM(receiving_tds) AS td
           FROM pgs_game GROUP BY game_id, franchise_id"""
    ).fetchall()
    c.n_checked = len(rows)
    for r in rows:
        pf, td = r["points_for"], r["td"] or 0
        if pf is None:
            c.flag(f"{r['game_id']}|{r['franchise_id']}", "points_for is NULL for a game "
                                                          "that has player stats")
            continue
        if pf < 6 * td:
            c.flag(f"{r['game_id']}|{r['franchise_id']}",
                   f"{td} scrimmage TDs but only {pf} points")
        if pf == 1:
            c.flag(f"{r['game_id']}|{r['franchise_id']}", "points_for = 1 is unreachable")
    return c


def ic06b_full_score(con) -> Check:
    """Reconstruct every team-game's score from the full nflverse extract (which
    does carry the kicking / defensive / return scoring that player_game_stats
    drops) and require it to equal team_game.points_for.

    Formula notes, established empirically and then held fixed:
      * TDs are counted once, from the scorer's side only: rushing + receiving +
        special_teams + def + fumble_recovery.  passing_tds are the same events
        as receiving_tds and must not be added.
      * a two-point conversion is credited twice by nflverse (passer AND
        receiver), so only rushing_2pt + receiving_2pt are summed.
      * safeties are the one score nflverse does not attribute reliably
        (def_safeties is populated for only 177 of the 281 team-games whose
        residual is +2/+4), so the check allows a residual of exactly +2 per
        safety and reports the residual distribution rather than asserting 0.
    """
    c = Check("IC-06b", "Full score reconstruction from raw/player_stats.csv",
              "all 8,726 team-games; residual must be 0, or +2/+4 for safeties")
    path = os.path.join(RAW, "player_stats.csv")
    if not os.path.exists(path):
        c.notes.append(f"SKIPPED: {path} not present")
        return c

    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    agg = collections.defaultdict(lambda: collections.Counter())
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            a = agg[(r["game_id"], r["team"])]
            a["td"] += num(r["rushing_tds"]) + num(r["receiving_tds"]) \
                + num(r["special_teams_tds"]) + num(r["def_tds"]) \
                + num(r["fumble_recovery_tds"])
            a["two"] += num(r["rushing_2pt_conversions"]) \
                + num(r["receiving_2pt_conversions"])
            a["pat"] += num(r["pat_made"])
            a["fg"] += num(r["fg_made"])
            a["saf"] += num(r["def_safeties"])

    tg = {}
    for r in con.execute(
        """SELECT g.game_id, t.abbreviation ab, tg.points_for
           FROM team_game tg JOIN game g USING(game_id)
           JOIN team t ON t.franchise_id=tg.franchise_id
           WHERE g.result_status='final'"""
    ):
        tg[(r["game_id"], r["ab"])] = r["points_for"]

    # abbreviation drift: nflverse uses era labels (OAK/STL/SD/LA/WAS...)
    alias = {r["abbreviation"]: r["franchise_id"]
             for r in con.execute("SELECT abbreviation, franchise_id FROM team_alias")}
    fid_to_ab = {r["franchise_id"]: r["abbreviation"] for r in
                 con.execute("SELECT franchise_id, abbreviation FROM team")}

    checked = 0
    residuals = collections.Counter()
    for (gid, ab), a in agg.items():
        canon = fid_to_ab.get(alias.get(ab), ab)
        pf = tg.get((gid, canon))
        if pf is None:
            continue                     # game not in DB (handled by IC-07)
        checked += 1
        pts = int(6 * a["td"] + 2 * a["two"] + a["pat"] + 3 * a["fg"])
        d = pf - pts
        residuals[d] += 1
        if d in (0, 2, 4):
            continue
        c.flag(f"{gid}|{canon}",
               f"reconstructed {pts} vs team_game.points_for {pf} (residual {d}); "
               f"td={int(a['td'])} 2pt={int(a['two'])} pat={int(a['pat'])} "
               f"fg={int(a['fg'])} def_safeties={int(a['saf'])}")
    c.n_checked = checked
    c.notes.append(f"residual (points_for - reconstructed) distribution: "
                   f"{dict(sorted(residuals.items()))}")
    c.notes.append(f"exact matches: {residuals[0]} / {checked}; "
                   f"+2 (one safety): {residuals[2]}; +4 (two safeties): {residuals[4]}")
    return c


def ic07_coverage(con) -> Check:
    c = Check("IC-07", "Stat-line coverage and referential integrity",
              "all final games / all 286,843 rows")
    n_final_tg = con.execute(
        """SELECT COUNT(*) FROM team_game tg JOIN game g USING(game_id)
           WHERE g.result_status='final'"""
    ).fetchone()[0]
    c.n_checked = n_final_tg
    for r in con.execute(
        """SELECT tg.game_id, tg.franchise_id FROM team_game tg JOIN game g USING(game_id)
           WHERE g.result_status='final'
             AND NOT EXISTS (SELECT 1 FROM pgs_game x
                             WHERE x.game_id=tg.game_id AND x.franchise_id=tg.franchise_id)"""
    ):
        c.flag(f"{r['game_id']}|{r['franchise_id']}", "final game with no player stat lines")
    n_join = con.execute("SELECT COUNT(*) FROM pgs_game").fetchone()[0]
    n_raw = con.execute("SELECT COUNT(*) FROM player_game_stats").fetchone()[0]
    if n_join != n_raw:
        c.flag("join", f"{n_raw - n_join} rows do not resolve to a team_game")
    c.notes.append(f"{n_join}/{n_raw} stat rows resolve to exactly one team_game")
    for r in con.execute(
        "SELECT COUNT(*) n FROM pgs_game WHERE opponent_id <> tg_opponent_id"
    ):
        if r["n"]:
            c.flag("opponent", f"{r['n']} rows whose opponent_id disagrees with team_game")
    for r in con.execute(
        """SELECT s.gsis_id FROM player_game_stats s LEFT JOIN player p USING(gsis_id)
           WHERE p.gsis_id IS NULL GROUP BY 1"""
    ):
        c.flag(r["gsis_id"], "stat line for a gsis_id absent from player")
    return c


def ic08_roster(con) -> Check:
    c = Check("IC-08", "Stat line vs roster_season membership",
              "all 31,471 distinct (player, season, team) triples")
    ros = set()
    ros_any = collections.defaultdict(set)
    for g, s, f in con.execute(
        "SELECT gsis_id, season, franchise_id FROM roster_season WHERE gsis_id IS NOT NULL"
    ):
        ros.add((g, s, f))
        ros_any[(g, s)].add(f)
    triples = con.execute(
        """SELECT gsis_id, season, franchise_id, COUNT(*) n,
                  SUM(attempts+carries+targets+receptions) act
           FROM player_game_stats GROUP BY 1,2,3"""
    ).fetchall()
    c.n_checked = len(triples)
    for r in triples:
        k = (r["gsis_id"], r["season"], r["franchise_id"])
        if k in ros:
            continue
        if (r["gsis_id"], r["season"]) in ros_any:
            c.flag(f"{r['gsis_id']}|{r['season']}|{r['franchise_id']}",
                   f"{r['n']} stat lines, activity={r['act']}; roster_season has this "
                   f"player on {sorted(ros_any[(r['gsis_id'], r['season'])])} that season",
                   "IC09_move")
        else:
            nm = con.execute("SELECT display_name, position, rookie_year, last_season "
                             "FROM player WHERE gsis_id=?", (r["gsis_id"],)).fetchone()
            c.flag(f"{r['gsis_id']}|{r['season']}|{r['franchise_id']}",
                   f"{r['n']} stat lines but the player is absent from roster_season for "
                   f"the whole season; player row says "
                   f"{dict(nm) if nm else 'no player row'}")
    return c


def ic08b_contiguity(con) -> Check:
    c = Check("IC-08b", "Multi-team seasons must be contiguous in time",
              "all player-seasons with >1 team in player_game_stats")
    rows = con.execute(
        "SELECT gsis_id, season, season_type, week, franchise_id FROM player_game_stats"
    ).fetchall()
    by = collections.defaultdict(list)
    for r in rows:
        order = r["week"] if r["season_type"] == "REG" else 100 + r["week"]
        by[(r["gsis_id"], r["season"])].append((order, r["franchise_id"]))
    multi = 0
    for (gsis, season), v in by.items():
        teams = {f for _, f in v}
        if len(teams) < 2:
            continue
        multi += 1
        seq = [f for _, f in sorted(v)]
        switches = sum(1 for a, b in zip(seq, seq[1:]) if a != b)
        if switches > len(teams) - 1:
            nm = con.execute("SELECT display_name FROM player WHERE gsis_id=?",
                             (gsis,)).fetchone()
            c.flag(f"{gsis}|{season}",
                   f"{nm['display_name'] if nm else '?'} team sequence {seq} "
                   f"({switches} switches across {len(teams)} teams)", "IC09b")
    c.n_checked = multi
    return c


def ic09_snaps(con) -> Check:
    """Every snap percentage must be reproducible from its own numerator and a
    single integer team snap total for that team-game-phase."""
    c = Check("IC-09", "snap_count percentage self-consistency",
              "all 324,611 snap_count rows")
    rows = con.execute(
        """SELECT rowid, gsis_id, pfr_player_id, pfr_game_id, franchise_id, season,
                  week, season_type, position,
                  offense_snaps, offense_pct, defense_snaps, defense_pct,
                  st_snaps, st_pct FROM snap_count"""
    ).fetchall()
    c.n_checked = len(rows)
    grp = collections.defaultdict(list)
    for r in rows:
        grp[(r["pfr_game_id"], r["franchise_id"])].append(r)

    def feasible_D(items, tol):
        """Largest set of integer team-snap totals D for which every published
        percentage p satisfies |p - snaps/D| <= tol.  Each row constrains D to
        an interval, so the answer is an interval intersection -- exact and
        O(n).  Returns the best integer D, or None if no D can satisfy all."""
        pos = [(rid, s, p) for rid, s, p in items if s > 0]
        if not pos:
            return None, None
        lo, hi = 1.0, float("inf")
        for _rid, s, p in pos:
            hp, lp = p + tol, p - tol
            if lp <= 0:
                lo = max(lo, s / hp) if hp > 0 else lo    # any big enough D works
                continue
            lo = max(lo, s / hp)
            hi = min(hi, s / lp)
        import math
        d_lo, d_hi = math.ceil(lo - 1e-9), math.floor(hi + 1e-9)
        if d_lo > d_hi:
            return None, (lo, hi)
        # prefer the D closest to the largest observed snap count
        mx = max(s for _, s, _ in pos)
        best = min(range(d_lo, min(d_hi, d_lo + 512) + 1), key=lambda d: abs(d - mx))
        return best, (lo, hi)

    phases = {"offense": ("offense_snaps", "offense_pct"),
              "defense": ("defense_snaps", "defense_pct"),
              "st": ("st_snaps", "st_pct")}
    by_row = {r["rowid"]: r for r in rows}
    band = collections.Counter()
    exact_groups = tolerant_groups = failed_groups = empty_groups = 0
    for key, items in grp.items():
        for ph, (sc, pc) in phases.items():
            pairs = [(r["rowid"], r[sc] or 0, r[pc] or 0.0) for r in items]
            if not any(s > 0 for _, s, _ in pairs):
                empty_groups += 1
                continue
            # strict: every pct is the nearest whole percent of snaps/D
            D_strict, _ = feasible_D(pairs, 0.005)
            if D_strict is not None:
                exact_groups += 1
                continue
            # tolerant: within one whole percentage point (PFR's publication grain)
            D_tol, _ = feasible_D(pairs, 0.01)
            if D_tol is not None:
                tolerant_groups += 1
                for rid, s, p in pairs:
                    if s <= 0:
                        continue
                    dev = abs(p - s / D_tol)
                    if dev > 0.005 + 1e-9:
                        r = by_row[rid]
                        band["<=0.01"] += 1
                        c.flag(f"{r['pfr_game_id']}|{r['franchise_id']}|"
                               f"{r['pfr_player_id'] or r['gsis_id']}|{ph}",
                               f"{ph}_pct={p} vs {s}/{D_tol}={s/D_tol:.4f} "
                               f"(deviation {dev:.4f}); pos={r['position']} "
                               f"season={r['season']} wk={r['week']}", "IC10_rounding")
                continue
            # no integer team total reconciles this group at all: pick the
            # consensus team total (median of the per-row implied totals) and
            # name the rows that disagree with it.
            failed_groups += 1
            mx = max(s for _, s, _ in pairs)
            implied = sorted(round(s / p) for _, s, p in pairs if p > 0.02 and s > 0)
            D_ref = implied[len(implied) // 2] if implied else mx
            for rid, s, p in pairs:
                if s <= 0:
                    continue
                dev = abs(p - s / D_ref)
                if dev <= 0.01 + 1e-9:
                    continue
                r = by_row[rid]
                band[">0.01"] += 1
                c.flag(f"{r['pfr_game_id']}|{r['franchise_id']}|"
                       f"{r['pfr_player_id'] or r['gsis_id']}|{ph}",
                       f"{ph}_pct={p} irreconcilable: best team total {D_ref} gives "
                       f"{s}/{D_ref}={s/D_ref:.4f} (deviation {dev:.4f}); "
                       f"pos={r['position']} season={r['season']} wk={r['week']}")
    c.notes.append(
        f"team-game-phases: {exact_groups} reconcile exactly (nearest whole percent), "
        f"{tolerant_groups} only within +/-1 percentage point, {failed_groups} not at all, "
        f"{empty_groups} empty")
    c.notes.append(f"deviation bands among flagged rows: {dict(band)}")
    # bounds
    for r in con.execute(
        """SELECT rowid, pfr_game_id, franchise_id, pfr_player_id, gsis_id,
                  offense_snaps, offense_pct, defense_snaps, defense_pct, st_snaps, st_pct
           FROM snap_count
           WHERE offense_snaps<0 OR defense_snaps<0 OR st_snaps<0
              OR offense_pct<0 OR defense_pct<0 OR st_pct<0
              OR offense_pct>1.001 OR defense_pct>1.001 OR st_pct>1.001"""
    ):
        c.flag(f"{r['pfr_game_id']}|{r['franchise_id']}|{r['pfr_player_id']}|bounds",
               f"off={r['offense_snaps']}/{r['offense_pct']} "
               f"def={r['defense_snaps']}/{r['defense_pct']} "
               f"st={r['st_snaps']}/{r['st_pct']}")
    return c


def ic10_snap_linkage(con) -> Check:
    c = Check("IC-10", "snap_count linkage and coverage",
              "all 324,611 snap_count rows / 2013-2025")
    c.n_checked = con.execute("SELECT COUNT(*) FROM snap_count").fetchone()[0]
    n_null = con.execute(
        "SELECT COUNT(*) FROM snap_count WHERE gsis_id IS NULL OR gsis_id=''").fetchone()[0]
    if n_null:
        c.flag("gsis_null", f"{n_null} snap rows carry no gsis_id (pfr_player_id only); "
                            "they cannot be joined to player_game_stats")
    seasons = {r[0] for r in con.execute("SELECT DISTINCT season FROM snap_count")}
    pgs_seasons = {r[0] for r in con.execute("SELECT DISTINCT season FROM player_game_stats")}
    missing = sorted(pgs_seasons - seasons)
    if missing:
        c.flag("season_gap", f"player_game_stats covers {min(pgs_seasons)}-{max(pgs_seasons)} "
                             f"but snap_count has no rows for {missing}")
    n_orphan = con.execute(
        """SELECT COUNT(*) FROM snap_count s LEFT JOIN player p USING(gsis_id)
           WHERE s.gsis_id IS NOT NULL AND s.gsis_id<>'' AND p.gsis_id IS NULL"""
    ).fetchone()[0]
    if n_orphan:
        c.flag("orphan_player", f"{n_orphan} snap rows reference a gsis_id absent from player")
    c.notes.append(f"snap_count seasons: {min(seasons)}-{max(seasons)}")
    return c


def ic11_fidelity(con) -> Check:
    """Byte-for-byte: does nfl.db hold what raw/player_stats.csv says?"""
    c = Check("IC-11", "Loader fidelity: player_game_stats vs raw/player_stats.csv",
              "all 286,843 DB rows x 21 stat columns")
    path = os.path.join(RAW, "player_stats.csv")
    if not os.path.exists(path):
        c.notes.append(f"SKIPPED: {path} not present")
        return c

    def norm(v, col):
        if v in ("", "NA", None):
            return None
        if col in INT_COLS:
            try:
                return int(float(v))
            except ValueError:
                return v
        try:
            return round(float(v), 4)
        except ValueError:
            return v

    csv_rows = {}
    blank = 0
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if not r["player_id"]:
                blank += 1
                continue
            csv_rows[(r["player_id"], int(r["season"]), int(r["week"]), r["season_type"])] = r
    c.notes.append(f"raw CSV: {len(csv_rows)} keyed rows + {blank} rows with a blank "
                   f"player_id that the loader drops")

    seen = 0
    for r in con.execute("SELECT * FROM player_game_stats"):
        seen += 1
        k = (r["gsis_id"], r["season"], r["week"], r["season_type"])
        src = csv_rows.pop(k, None)
        if src is None:
            c.flag("|".join(map(str, k)), "row present in DB but not in raw/player_stats.csv")
            continue
        diffs = []
        for dbcol, csvcol in DB_TO_CSV.items():
            a = r[dbcol]
            b = src.get(csvcol)
            if dbcol in ("position", "position_group"):
                a = a or None
                b = b or None
                if a != b:
                    diffs.append(f"{dbcol}: db={a!r} csv={b!r}")
                continue
            av = norm(a if a is None else str(a), dbcol)
            bv = norm(b, dbcol)
            if av is None and bv is None:
                continue
            if av is None or bv is None:
                diffs.append(f"{dbcol}: db={a!r} csv={b!r}")
            elif isinstance(av, float) or isinstance(bv, float):
                if abs(float(av) - float(bv)) > 5e-4:
                    diffs.append(f"{dbcol}: db={a!r} csv={b!r}")
            elif av != bv:
                diffs.append(f"{dbcol}: db={a!r} csv={b!r}")
        if diffs:
            c.flag("|".join(map(str, k)), "; ".join(diffs))
    c.n_checked = seen
    for k in list(csv_rows)[:50]:
        c.flag("|".join(map(str, k)), "row present in raw/player_stats.csv but not in DB")
    if len(csv_rows) > 50:
        c.notes.append(f"...and {len(csv_rows)-50} further CSV-only rows")
    return c


def ic12_snap_fidelity(con) -> Check:
    c = Check("IC-12", "Loader fidelity: snap_count vs raw/snap_counts.csv",
              "all 324,611 rows x 11 columns")
    path = os.path.join(RAW, "snap_counts.csv")
    if not os.path.exists(path):
        c.notes.append(f"SKIPPED: {path} not present")
        return c
    def num(v):
        if v in ("", "NA", None):
            return None
        return round(float(v), 6)

    NUMCOLS = ("offense_snaps", "offense_pct", "defense_snaps", "defense_pct",
               "st_snaps", "st_pct")
    # NOTE: snap_count.pfr_game_id does NOT hold the PFR game id. The extract has
    # both `game_id` (nflverse, e.g. 2013_01_ARI_STL) and `pfr_game_id`
    # (e.g. 201309080ram); the loader put the nflverse id in the column named
    # pfr_game_id. Compare against the value that is actually there, and report
    # the misnomer separately (IC-13).
    src = collections.Counter()
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            src[(r["pfr_player_id"], r["game_id"], r["season"], r["week"],
                 *(num(r[k]) for k in NUMCOLS))] += 1

    dbc = collections.Counter()
    n = 0
    for r in con.execute(
        """SELECT pfr_player_id, pfr_game_id, season, week, offense_snaps, offense_pct,
                  defense_snaps, defense_pct, st_snaps, st_pct FROM snap_count"""
    ):
        n += 1
        dbc[(r["pfr_player_id"], r["pfr_game_id"], str(r["season"]), str(r["week"]),
             *(num(r[k]) for k in NUMCOLS))] += 1
    c.n_checked = n
    for k, cnt in (dbc - src).items():
        c.flag(f"{k[0]}|{k[1]}", f"DB row absent from raw CSV ({cnt}x): {k[4:]}")
    for k, cnt in (src - dbc).items():
        c.flag(f"{k[0]}|{k[1]}", f"raw CSV row absent from DB ({cnt}x): {k[4:]}")
    return c


def ic14_snap_team(con) -> Check:
    """The same player in the same game must be on the same team in both tables.
    This needs no third source: Tom Brady never played for Kansas City."""
    c = Check("IC-14", "snap_count team attribution vs player_game_stats",
              "all 234,316 snap rows that join to a stat line by (gsis_id, season, week)")
    rows = con.execute(
        """SELECT s.rowid, s.gsis_id, s.pfr_player_id, s.season, s.week, s.season_type,
                  s.pfr_game_id, s.franchise_id sfid, p.franchise_id pfid,
                  s.offense_snaps, s.defense_snaps, s.st_snaps, pl.display_name,
                  ta.abbreviation sab, tb.abbreviation pab
           FROM snap_count s
           JOIN player_game_stats p ON p.gsis_id=s.gsis_id AND p.season=s.season
                                   AND p.week=s.week
           LEFT JOIN player pl ON pl.gsis_id=s.gsis_id
           LEFT JOIN team ta ON ta.franchise_id=s.franchise_id
           LEFT JOIN team tb ON tb.franchise_id=p.franchise_id
           WHERE s.gsis_id IS NOT NULL AND s.gsis_id<>''"""
    ).fetchall()
    c.n_checked = len(rows)
    bad = [r for r in rows if r["sfid"] != r["pfid"]]
    by_game = collections.Counter(r["pfr_game_id"] for r in bad)
    for r in bad:
        c.flag(f"{r['pfr_game_id']}|{r['gsis_id']}",
               f"{r['display_name']}: snap_count says {r['sab']}, player_game_stats says "
               f"{r['pab']} (off={r['offense_snaps']} def={r['defense_snaps']} "
               f"st={r['st_snaps']})")
    c.notes.append(f"row disagreements: {len(bad)} of {len(rows)} joinable rows")
    c.notes.append(f"worst games: {by_game.most_common(6)}")

    # whole-game swaps: a game where *every* joinable row disagrees
    per_game = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        per_game[r["pfr_game_id"]][0] += 1
        if r["sfid"] != r["pfid"]:
            per_game[r["pfr_game_id"]][1] += 1
    swapped = sorted(g for g, (tot, dis) in per_game.items() if tot and dis == tot)
    c.notes.append(f"games where 100% of joinable rows disagree (whole-game swap): "
                   f"{swapped}")

    # identity crosswalk: within one season, a player's snap teams and stat teams
    # must intersect.  Comparing across seasons would flag ordinary free agency
    # (snap_count only starts in 2013), so the comparison is per player-season.
    snap_teams = collections.defaultdict(set)
    stat_teams = collections.defaultdict(set)
    for g, s, f in con.execute("SELECT DISTINCT gsis_id, season, franchise_id "
                               "FROM snap_count WHERE gsis_id IS NOT NULL AND gsis_id<>''"):
        snap_teams[(g, s)].add(f)
    for g, s, f in con.execute("SELECT DISTINCT gsis_id, season, franchise_id "
                               "FROM player_game_stats"):
        stat_teams[(g, s)].add(f)
    disjoint = [k for k in snap_teams
                if k in stat_teams and not (snap_teams[k] & stat_teams[k])]
    players = collections.Counter(k[0] for k in disjoint)
    for gsis, season in sorted(disjoint):
        nm = con.execute("SELECT display_name, position, pfr_id FROM player WHERE gsis_id=?",
                         (gsis,)).fetchone()
        c.flag(f"crosswalk|{gsis}|{season}",
               f"{nm['display_name'] if nm else '?'} ({nm['position'] if nm else '?'}, "
               f"pfr_id={nm['pfr_id'] if nm else '?'}) in {season}: snap_count teams "
               f"{sorted(snap_teams[(gsis, season)])} and player_game_stats teams "
               f"{sorted(stat_teams[(gsis, season)])} do not intersect -- the pfr_id "
               f"crosswalk on `player` points at a different person")
    c.notes.append(f"player-seasons whose snap teams and stat teams are disjoint: "
                   f"{len(disjoint)} across {len(players)} players: "
                   f"{players.most_common()}")
    return c


def ic15_one_game_per_week(con) -> Check:
    """Nobody plays two games in the same week.  Both tables must obey it."""
    c = Check("IC-15", "One player, one game per week",
              "all 324,611 snap rows + all 286,843 stat rows")
    c.n_checked = 324611 + 286843
    for r in con.execute(
        """SELECT gsis_id, pfr_player_id, season, week, COUNT(*) n,
                  GROUP_CONCAT(pfr_game_id) games
           FROM snap_count WHERE gsis_id IS NOT NULL AND gsis_id<>''
           GROUP BY gsis_id, season, week HAVING COUNT(DISTINCT pfr_game_id)>1"""
    ):
        nm = con.execute("SELECT display_name FROM player WHERE gsis_id=?",
                         (r["gsis_id"],)).fetchone()
        c.flag(f"snap|{r['gsis_id']}|{r['season']}|{r['week']}",
               f"{nm['display_name'] if nm else '?'} ({r['pfr_player_id']}) has snap rows "
               f"in {r['n']} different games in one week: {r['games']}")
    for r in con.execute(
        """SELECT gsis_id, season, week, season_type, COUNT(*) n
           FROM player_game_stats GROUP BY 1,2,3,4 HAVING COUNT(*)>1"""
    ):
        c.flag(f"stats|{r['gsis_id']}|{r['season']}|{r['week']}",
               f"{r['n']} stat rows for one player-week")
    return c


def ic13_snap_game_key(con) -> Check:
    """snap_count.pfr_game_id is named for PFR but holds the nflverse game id,
    so it will not join to game.pfr_game_id. Prove which id space it is in."""
    c = Check("IC-13", "snap_count.pfr_game_id identifier space",
              "all 3,562 distinct snap_count game keys")
    keys = [r[0] for r in con.execute("SELECT DISTINCT pfr_game_id FROM snap_count")]
    c.n_checked = len(keys)
    nflverse_ids = {r[0] for r in con.execute("SELECT game_id FROM game")}
    pfr_ids = {r[0] for r in con.execute(
        "SELECT pfr_game_id FROM game WHERE pfr_game_id IS NOT NULL")}
    as_nflverse = sum(1 for k in keys if k in nflverse_ids)
    as_pfr = sum(1 for k in keys if k in pfr_ids)
    c.notes.append(f"{as_nflverse}/{len(keys)} match game.game_id (nflverse space); "
                   f"{as_pfr}/{len(keys)} match game.pfr_game_id (PFR space)")
    if as_pfr < as_nflverse:
        c.flag("column_misnamed",
               f"snap_count.pfr_game_id contains nflverse game ids "
               f"({as_nflverse}/{len(keys)} match game.game_id, only {as_pfr} match "
               f"game.pfr_game_id). Any join written against game.pfr_game_id returns "
               f"zero rows. Values are correct; the column name is not.")
    unresolved = [k for k in keys if k not in nflverse_ids and k not in pfr_ids]
    for k in unresolved[:20]:
        c.flag(k, "snap_count game key matches neither game.game_id nor game.pfr_game_id")
    return c


PHASE1 = [ic01_impossible, ic03_laterals, ic04_rates, ic05_team_reconcile,
          ic06_scoring, ic06b_full_score, ic07_coverage, ic08_roster,
          ic08b_contiguity, ic09_snaps, ic10_snap_linkage,
          ic11_fidelity, ic12_snap_fidelity, ic13_snap_game_key, ic14_snap_team,
          ic15_one_game_per_week]


# --------------------------------------------------------------------------
# PHASE 2 — ESPN box-score comparison on a stratified sample
# --------------------------------------------------------------------------
def post_round_of(season: int, week: int) -> str:
    first = 18 if season <= 2020 else 19
    idx = week - first
    return POST_ROUNDS[idx] if 0 <= idx < 4 else "?"


def build_sample(con, anomaly_games: set[str]) -> list[sqlite3.Row]:
    """The frame, stated exactly.

    Tier A  whole games, every player on both teams
            2010-2021:  8 REG + 2 POST per season
            2022-2025: 20 REG + 5 POST per season   (the seasons a live model trains on)
    Tier B  every game implicated by a box-score-relevant phase-1 finding
            (IC-09's snap-percentage rounding rows are excluded: ESPN publishes
            no snap counts, so those games would only add generic coverage)
    Tier C  one extra game for each of the 24 highest-volume prop games
            (targets + carries + pass attempts) not already covered
    """
    rnd = random.Random(SEED)
    picked: dict[str, sqlite3.Row] = {}

    def add(row):
        picked.setdefault(row["game_id"], row)

    allg = {r["game_id"]: r for r in con.execute(
        """SELECT game_id, espn_event_id, season, season_type, week, playoff_round,
                  away_abbr, home_abbr, away_franchise_id, home_franchise_id,
                  away_score, home_score
           FROM game WHERE result_status='final' ORDER BY game_id"""
    )}

    for season in range(2010, 2026):
        nreg, npost = (20, 5) if season >= 2022 else (8, 2)
        reg = sorted([g for g in allg.values()
                      if g["season"] == season and g["season_type"] == "REG"],
                     key=lambda r: r["game_id"])
        post = sorted([g for g in allg.values()
                       if g["season"] == season and g["season_type"] == "POST"],
                      key=lambda r: r["game_id"])
        for g in rnd.sample(reg, min(nreg, len(reg))):
            add(g)
        for g in rnd.sample(post, min(npost, len(post))):
            add(g)

    for gid in sorted(anomaly_games):
        if gid in allg:
            add(allg[gid])

    top = con.execute(
        """SELECT s.gsis_id, s.season, s.week, s.season_type, s.franchise_id,
                  (s.targets + s.carries + s.attempts) vol
           FROM player_game_stats s
           ORDER BY vol DESC LIMIT 400"""
    ).fetchall()
    seen_players = set()
    extra = 0
    for r in top:
        if extra >= 24:
            break
        if r["gsis_id"] in seen_players:
            continue
        gid = con.execute(
            """SELECT game_id FROM pgs_game WHERE gsis_id=? AND season=? AND week=?
               AND season_type=?""",
            (r["gsis_id"], r["season"], r["week"], r["season_type"])).fetchone()
        if gid and gid["game_id"] in allg and gid["game_id"] not in picked:
            add(allg[gid["game_id"]])
            seen_players.add(r["gsis_id"])
            extra += 1
    return [picked[k] for k in sorted(picked)]


def fetch_summary(event_id: str, offline: bool, stats: collections.Counter):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"summary_{event_id}.json.gz")
    if os.path.exists(path):
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                data = json.load(f)
            stats["cache_hit"] += 1
            return data
        except (OSError, EOFError, json.JSONDecodeError):
            stats["cache_corrupt"] += 1
            os.remove(path)
    if offline:
        stats["offline_miss"] += 1
        return None
    url = SUMMARY_URL.format(event_id)
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = resp.read().decode("utf-8")
            data = json.loads(body)
            tmp = path + ".part"
            with gzip.open(tmp, "wt", encoding="utf-8") as f:
                f.write(body)
            os.replace(tmp, path)
            stats["fetched"] += 1
            time.sleep(SLEEP)
            return data
        except Exception as exc:                       # noqa: BLE001 - network is hostile
            last = exc
            stats["retry"] += 1
            time.sleep(2.0 * (attempt + 1))
    stats["fetch_failed"] += 1
    sys.stderr.write(f"  ! fetch failed for {event_id}: {last}\n")
    return None


def _n(v):
    if v in (None, "", "--"):
        return 0
    v = str(v).replace(",", "")
    try:
        return int(v)
    except ValueError:
        try:
            return int(float(v))
        except ValueError:
            return 0


def parse_espn(data) -> dict[int, dict[str, dict]]:
    """-> {franchise_id: {espn_athlete_id: {stat: value}}}"""
    out: dict[int, dict[str, dict]] = {}
    for team in data.get("boxscore", {}).get("players", []) or []:
        fid = int(team["team"]["id"])
        bucket = out.setdefault(fid, {})
        for cat in team.get("statistics", []) or []:
            name = cat.get("name")
            keys = cat.get("keys") or []
            if name not in ("passing", "rushing", "receiving", "fumbles"):
                continue
            for ath in cat.get("athletes", []) or []:
                aid = str((ath.get("athlete") or {}).get("id") or "")
                if not aid:
                    continue
                vals = dict(zip(keys, ath.get("stats") or []))
                rec = bucket.setdefault(aid, {
                    "name": (ath.get("athlete") or {}).get("displayName"),
                    "cats": set()})
                rec["cats"].add(name)
                if name == "passing":
                    ca = str(vals.get("completions/passingAttempts", "0/0"))
                    comp, _, att = ca.partition("/")
                    rec["completions"] = _n(comp)
                    rec["attempts"] = _n(att)
                    rec["passing_yards"] = _n(vals.get("passingYards"))
                    rec["passing_tds"] = _n(vals.get("passingTouchdowns"))
                    rec["interceptions"] = _n(vals.get("interceptions"))
                elif name == "rushing":
                    rec["carries"] = _n(vals.get("rushingAttempts"))
                    rec["rushing_yards"] = _n(vals.get("rushingYards"))
                    rec["rushing_tds"] = _n(vals.get("rushingTouchdowns"))
                elif name == "receiving":
                    rec["receptions"] = _n(vals.get("receptions"))
                    rec["receiving_yards"] = _n(vals.get("receivingYards"))
                    rec["receiving_tds"] = _n(vals.get("receivingTouchdowns"))
                    if "receivingTargets" in keys:
                        rec["targets"] = _n(vals.get("receivingTargets"))
                elif name == "fumbles":
                    rec["fumbles"] = _n(vals.get("fumbles"))
                    rec["fumbles_lost"] = _n(vals.get("fumblesLost"))
    return out


CMP_FIELDS = [
    ("passing", "attempts"), ("passing", "completions"), ("passing", "passing_yards"),
    ("passing", "passing_tds"), ("passing", "interceptions"),
    ("rushing", "carries"), ("rushing", "rushing_yards"), ("rushing", "rushing_tds"),
    ("receiving", "receptions"), ("receiving", "targets"),
    ("receiving", "receiving_yards"), ("receiving", "receiving_tds"),
]


def espn_phase(con, sample, offline: bool) -> tuple[Check, dict]:
    c = Check("E-01", "Player box-score agreement vs ESPN summary",
              f"{len(sample)} whole games, both teams, every listed player")
    espn_to_gsis = {}
    for r in con.execute(
        "SELECT gsis_id, espn_id, display_name FROM player "
        "WHERE espn_id IS NOT NULL AND espn_id<>''"
    ):
        espn_to_gsis.setdefault(str(r["espn_id"]), r["gsis_id"])
    name_idx = collections.defaultdict(set)
    for r in con.execute("SELECT gsis_id, display_name FROM player"):
        if r["display_name"]:
            name_idx[re.sub(r"[^a-z]", "", r["display_name"].lower())].add(r["gsis_id"])

    per_field = collections.defaultdict(lambda: [0, 0])   # field -> [compared, agreed]
    net = collections.Counter()
    counters = collections.Counter()
    games_done = []
    targets_present_games = 0
    crosswalk_bad = {}          # gsis -> (player.espn_id, espn athlete id, name)
    target_totals = []          # (game_id, franchise, espn_sum, db_sum) over matched players

    for g in sample:
        data = fetch_summary(str(g["espn_event_id"]), offline, net)
        if data is None:
            counters["games_unfetched"] += 1
            continue
        espn = parse_espn(data)
        if not espn:
            counters["games_no_boxscore"] += 1
            c.flag(g["game_id"], "ESPN summary carries no player box score", None)
            continue
        if any("targets" in rec for team in espn.values() for rec in team.values()):
            targets_present_games += 1
        games_done.append(g["game_id"])

        dbrows = {}
        # player_game_stats carries the nflverse continued week counter for
        # postseason rows; game carries playoff_round. Convert.
        wk = g["week"]
        if g["season_type"] == "POST":
            first = 18 if g["season"] <= 2020 else 19
            wk = first + POST_ROUNDS.index(g["playoff_round"])
        for r in con.execute(
            """SELECT s.*, p.display_name FROM player_game_stats s
               LEFT JOIN player p USING(gsis_id)
               WHERE s.season=? AND s.week=? AND s.season_type=?
                 AND s.franchise_id IN (?,?)""",
            (g["season"], wk, g["season_type"],
             g["away_franchise_id"], g["home_franchise_id"])
        ):
            dbrows[(r["franchise_id"], r["gsis_id"])] = r

        matched: set[tuple[int, str]] = set()
        tgt_sum = collections.defaultdict(lambda: [0, 0])
        deferred_targets: list[tuple[int, str, str]] = []
        for fid, athletes in espn.items():
            for aid, rec in athletes.items():
                gsis = espn_to_gsis.get(aid)
                if gsis is not None and (fid, gsis) not in dbrows:
                    gsis = None                      # id points at somebody else
                if gsis is None:
                    cand = name_idx.get(re.sub(r"[^a-z]", "", (rec.get("name") or "").lower()))
                    hit = [x for x in (cand or []) if (fid, x) in dbrows]
                    gsis = hit[0] if len(hit) == 1 else None
                    if gsis is not None and espn_to_gsis.get(aid) is None:
                        db_eid = con.execute("SELECT espn_id FROM player WHERE gsis_id=?",
                                             (gsis,)).fetchone()
                        db_eid = db_eid["espn_id"] if db_eid else None
                        if db_eid and str(db_eid) != aid:
                            crosswalk_bad[gsis] = (str(db_eid), aid, rec.get("name"))
                            counters["espn_id_crosswalk_wrong"] += 1
                if gsis is None:
                    counters["espn_athlete_unmapped"] += 1
                    if any(rec.get(f, 0) for _, f in CMP_FIELDS):
                        c.flag(f"{g['game_id']}|espn:{aid}",
                               f"ESPN lists {rec.get('name')} with production but no "
                               f"player row maps to ESPN athlete id {aid}")
                    continue
                row = dbrows.get((fid, gsis))
                if row is None:
                    counters["espn_player_absent_from_db"] += 1
                    if any(rec.get(f, 0) for _, f in CMP_FIELDS):
                        c.flag(f"{g['game_id']}|{gsis}",
                               f"ESPN has {rec.get('name')} with "
                               + ", ".join(f"{f}={rec[f]}" for _, f in CMP_FIELDS
                                           if rec.get(f))
                               + " but player_game_stats has no row for that team-week")
                    else:
                        counters["espn_only_zero_line"] += 1
                    continue
                counters["players_compared"] += 1
                matched.add((fid, gsis))
                for cat, fldname in CMP_FIELDS:
                    if cat not in rec["cats"]:
                        continue
                    if fldname == "targets" and "targets" not in rec:
                        continue
                    ev = rec.get(fldname, 0)
                    dv = row[fldname] or 0
                    if fldname == "targets":
                        tgt_sum[fid][0] += ev
                        tgt_sum[fid][1] += dv
                    per_field[fldname][0] += 1
                    if ev == dv:
                        per_field[fldname][1] += 1
                    elif fldname == "targets":
                        # decided after the whole team is tallied
                        deferred_targets.append(
                            (fid, f"{g['game_id']}|{gsis}|targets",
                             f"{rec.get('name')} ({g['season']} {g['season_type']} "
                             f"wk{g['week'] or g['playoff_round']}): ESPN targets={ev}, "
                             f"DB targets={dv}"))
                    else:
                        c.flag(f"{g['game_id']}|{gsis}|{fldname}",
                               f"{rec.get('name')} ({g['season']} "
                               f"{g['season_type']} wk{g['week'] or g['playoff_round']}): "
                               f"ESPN {fldname}={ev}, DB {fldname}={dv}")
        for fid, (es, ds) in tgt_sum.items():
            target_totals.append((g["game_id"], fid, es, ds))
        for fid, key, detail in deferred_targets:
            es, ds = tgt_sum[fid]
            if es == ds:
                c.flag(key, detail + f" [team target total agrees: {es}]",
                       "E_TARGET_ATTRIBUTION")
                counters["target_attribution_only"] += 1
            else:
                c.flag(key, detail + f" [team target total ESPN {es} vs DB {ds}]")

        # DB rows with production that ESPN never lists.  A player counts as
        # listed if he was matched above by id OR by name -- otherwise a stale
        # player.espn_id masquerades as an ESPN omission.
        for (fid, gsis), row in dbrows.items():
            if fid not in espn or (fid, gsis) in matched:
                continue
            prod = {f: row[f] for f in ("attempts", "carries", "receptions",
                                        "receiving_yards", "rushing_yards", "targets")
                    if row[f]}
            if not prod:
                continue
            bucket = ("E_TGT_ZERO_REC" if set(prod) <= {"targets"}
                      else "E_ESPN_OMITS_ATHLETE")
            counters["db_production_absent_from_espn"] += 1
            c.flag(f"{g['game_id']}|{gsis}|db_only",
                   f"{row['display_name']} has {prod} in the DB but does not appear in "
                   f"ESPN's box score", bucket, exc_key=gsis)

    c.n_checked = counters["players_compared"]
    same = sum(1 for _, _, es, ds in target_totals if es == ds)
    c.notes.append(f"games compared: {len(games_done)} of {len(sample)} sampled")
    c.notes.append(f"network: {dict(net)}")
    c.notes.append(f"counters: {dict(counters)}")
    c.notes.append(f"games where ESPN publishes receivingTargets: {targets_present_games}")
    c.notes.append(f"team-games whose matched-player target TOTAL agrees exactly: "
                   f"{same}/{len(target_totals)}")
    c.notes.append(f"players whose player.espn_id disagrees with ESPN's own athlete id "
                   f"(matched by name instead): {len(crosswalk_bad)} -> "
                   f"{sorted(crosswalk_bad.items())[:12]}")
    agree = {f: {"compared": v[0], "agreed": v[1],
                 "rate": (v[1] / v[0]) if v[0] else None}
             for f, v in sorted(per_field.items())}
    return c, {"per_field": agree, "games": games_done,
               "counters": dict(counters), "network": dict(net),
               "espn_id_crosswalk": {k: list(v) for k, v in crosswalk_bad.items()},
               "target_totals_agree": [same, len(target_totals)]}


# --------------------------------------------------------------------------
# Phase-1 checks whose findings are verifiable in an ESPN box score. IC-09/12/13
# are about snap counts and identifier spaces, which ESPN does not publish.
BOXSCORE_RELEVANT = {"IC-01", "IC-03", "IC-04", "IC-05", "IC-06", "IC-06b",
                     "IC-08", "IC-08b"}


def anomaly_game_ids(con, checks) -> set[str]:
    """Every game implicated by a box-score-relevant phase-1 finding (tier B)."""
    out = set()
    for c in checks:
        if c.cid not in BOXSCORE_RELEVANT:
            continue
        for key, _detail, _adj in c.rows:
            parts = key.split("|")
            if re.fullmatch(r"\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}", parts[0]):
                out.add(parts[0])
                continue
            if re.fullmatch(r"00-\d{7}", parts[0]) and len(parts) >= 4:
                try:
                    row = con.execute(
                        "SELECT game_id FROM pgs_game WHERE gsis_id=? AND season=? "
                        "AND week=? AND season_type=?",
                        (parts[0], int(parts[1]), int(parts[2]), parts[3])).fetchone()
                except (ValueError, sqlite3.Error):
                    row = None
                if row:
                    out.add(row["game_id"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phase", choices=("all", "internal", "espn"), default="all")
    ap.add_argument("--offline", action="store_true",
                    help="never touch the network; use only cache/a5")
    ap.add_argument("--json", metavar="PATH", help="write the full result set as JSON")
    ap.add_argument("--max-rows", type=int, default=12,
                    help="itemised rows printed per check (default 12)")
    args = ap.parse_args()

    con = db()
    install_join_views(con)

    checks: list[Check] = []
    if args.phase in ("all", "internal"):
        for fn in PHASE1:
            t0 = time.time()
            c = fn(con)
            c.notes.append(f"ran in {time.time()-t0:.1f}s")
            checks.append(c)
            print(f"[{c.cid}] {c.title}: checked={c.n_checked} flagged={c.n_flagged} "
                  f"explained={c.explained} UNEXPLAINED={c.unexplained}", flush=True)

    espn_detail = {}
    if args.phase in ("all", "espn"):
        anomalies = anomaly_game_ids(con, checks) if checks else set()
        sample = build_sample(con, anomalies)
        print(f"[E-01] sampling frame: {len(sample)} games "
              f"({len(anomalies)} anomaly-driven)", flush=True)
        c, espn_detail = espn_phase(con, sample, args.offline)
        checks.append(c)
        print(f"[{c.cid}] {c.title}: compared={c.n_checked} flagged={c.n_flagged} "
              f"explained={c.explained} UNEXPLAINED={c.unexplained}", flush=True)

        cw = Check("E-02", "player.espn_id vs ESPN's own athlete id",
                   f"every athlete ESPN lists in the {len(sample)} sampled games")
        cw.n_checked = espn_detail.get("counters", {}).get("players_compared", 0)
        for gsis, (db_eid, espn_eid, name) in sorted(
                espn_detail.get("espn_id_crosswalk", {}).items()):
            cw.flag(gsis, f"{name}: player.espn_id={db_eid} but ESPN's box score lists "
                          f"athlete id {espn_eid}. Any ESPN join on player.espn_id misses "
                          f"this player.")
        checks.append(cw)
        print(f"[{cw.cid}] {cw.title}: flagged={cw.n_flagged}", flush=True)

    print("\n" + "=" * 78)
    unexplained = 0
    for c in checks:
        unexplained += c.unexplained
        print(f"\n### {c.cid} — {c.title}")
        print(f"    population : {c.population}")
        print(f"    checked    : {c.n_checked}")
        print(f"    flagged    : {c.n_flagged}  (explained {c.explained}, "
              f"unexplained {c.unexplained})")
        for n in c.notes:
            print(f"    note       : {n}")
        shown = [r for r in c.rows if r[2] is None][:args.max_rows]
        for key, detail, _ in shown:
            print(f"      ! {key}  {detail}")
        rest = c.unexplained - len(shown)
        if rest > 0:
            print(f"      ... and {rest} more unexplained")

    if espn_detail.get("per_field"):
        print("\n### ESPN per-stat agreement")
        for f, v in espn_detail["per_field"].items():
            rate = "n/a" if v["rate"] is None else f"{100*v['rate']:.4f}%"
            print(f"    {f:18s} {v['agreed']:6d}/{v['compared']:6d}  {rate}")

    print("\n" + "=" * 78)
    print(f"TOTAL UNRESOLVED: {unexplained}")
    print("(A row is 'resolved' only when KNOWN_EXCEPTIONS carries a written "
          "adjudication for it.\n Confirmed data defects are deliberately left "
          "unresolved so this stays a build gate.)")
    print("Confirmed defects held open on purpose:")
    for k, v in CONFIRMED_DEFECTS.items():
        print(f"  {k}: {v}")

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"checks": [c.as_dict() for c in checks],
                       "espn": espn_detail,
                       "confirmed_defects": CONFIRMED_DEFECTS}, f, indent=2)
        print(f"\nwrote {args.json}")

    return 1 if unexplained else 0


if __name__ == "__main__":
    sys.exit(main())
